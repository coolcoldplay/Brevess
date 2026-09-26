import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '') : fallback;
}

const pdfPath = path.resolve(argument('--pdf', process.env.PDF_ORIGINAL_PATH || ''));
const extensionRoot = path.resolve(argument('--extension', process.env.SCI_EXTENSION_ROOT || repositoryRoot));
const outputDirectory = path.resolve(argument('--output', process.env.PDF_ORIGINAL_OUTPUT ||
  path.join(repositoryRoot, 'output', 'playwright', 'pdf-original-reading')));
const headed = argument('--headed', process.env.HEADLESS === '0' ? '1' : '0') === '1';
const manualActions = process.argv.includes('--manual');
const expectedText = argument('--expected-text', '');
const deviceScaleFactor = Math.max(1, Math.min(3,
  Number(argument('--device-scale-factor', process.env.PDF_DEVICE_SCALE_FACTOR || '1')) || 1));
const expectedFigureCount = Math.max(0,
  Math.floor(Number(argument('--expected-figures', process.env.PDF_EXPECTED_FIGURES || '0')) || 0));
const figurePage = Math.max(0,
  Math.floor(Number(argument('--figure-page', process.env.PDF_FIGURE_PAGE || '0')) || 0));
const figureOriginalPages = argument('--figure-original-pages',
  process.env.PDF_FIGURE_ORIGINAL_PAGES || '').split(/[\s,]+/u).filter(Boolean)
  .map(value => Number(value));
const figureOriginalFigureId = argument('--figure-original-id',
  process.env.PDF_FIGURE_ORIGINAL_ID || '').trim();
const figureOriginalPanelId = argument('--figure-original-panel',
  process.env.PDF_FIGURE_ORIGINAL_PANEL || 'N').trim().toUpperCase();
const figureOriginalActivePage = Math.floor(Number(argument('--figure-original-active-page',
  process.env.PDF_FIGURE_ORIGINAL_ACTIVE_PAGE || String(figureOriginalPages.at(-1) || 0))) || 0);
const verifyFigureOriginal = figureOriginalPages.length > 0;
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-original-'));
const temporaryExtension = path.join(temporaryRoot, 'extension');
const profileDirectory = path.join(temporaryRoot, 'profile');
const screenshotNames = [
  'original-reader-initial.png', 'original-first-page.png', 'original-reader-reloaded.png'
];
if (manualActions) screenshotNames.push(
  'manual-selection.png', 'manual-highlight-zoomed.png', 'manual-highlight-reloaded.png'
);
if (figurePage) screenshotNames.push(
  `figure-page-${figurePage}-canvas.png`, `figure-page-${figurePage}-viewport.png`
);
if (verifyFigureOriginal) screenshotNames.push(
  'figure-original-active-page.png', 'figure-original-default-page.png'
);

function sha256File(filename) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filename, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let size;
    while ((size = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, size));
    }
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function safeMessage(value) {
  return String(value || '').replace(/[A-Za-z]:\\[^\r\n]*/gu, '[local-path]').slice(0, 300);
}

async function waitForStableRenderedCanvas(page, pageNumber, targetRatio) {
  await page.waitForFunction(({ pageNumber: targetPage, targetRatio: expectedRatio }) => {
    const pageNode = document.querySelector(
      `.pdf-native-page[data-pdf-page-number="${targetPage}"]`
    );
    const canvas = pageNode?.querySelector('canvas');
    const rect = canvas?.getBoundingClientRect();
    const ratioX = rect?.width ? canvas.width / rect.width : 0;
    const ratioY = rect?.height ? canvas.height / rect.height : 0;
    const valid = pageNode?.classList.contains('is-rendered') &&
      canvas.width > 0 && canvas.height > 0 && rect.width > 0 && rect.height > 0 &&
      Math.abs(ratioX - expectedRatio) <= 0.1 &&
      Math.abs(ratioY - expectedRatio) <= 0.1;
    const signature = valid
      ? `${targetPage}:${canvas.width}:${canvas.height}:${rect.width}:${rect.height}` : '';
    const prior = globalThis.__pdfVerifierCanvasStability;
    if (!valid) {
      globalThis.__pdfVerifierCanvasStability = null;
      return false;
    }
    if (!prior || prior.signature !== signature) {
      globalThis.__pdfVerifierCanvasStability = { signature, since: performance.now() };
      return false;
    }
    return performance.now() - prior.since >= 250;
  }, { pageNumber, targetRatio }, { timeout: 30000, polling: 50 });
}

function copyExtension() {
  fs.mkdirSync(temporaryExtension, { recursive: true });
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(extensionRoot, directory), path.join(temporaryExtension, directory), {
      recursive: true
    });
  }
  for (const file of fs.readdirSync(extensionRoot)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(extensionRoot, file), path.join(temporaryExtension, file));
    }
  }
}

function extensionBuildHash(directory) {
  const filenames = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile()) filenames.push(filename);
    }
  };
  visit(directory);
  const hash = crypto.createHash('sha256');
  for (const filename of filenames) {
    hash.update(path.relative(directory, filename).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(filename));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function writeReport(report) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const target = path.join(outputDirectory, 'report.json');
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, target);
}

async function ensureOriginalView(page) {
  if (await page.evaluate(() => document.body.dataset.pdfView === 'original')) return;
  await page.waitForFunction(() => document.body.dataset.pdfView === 'original' ||
    document.querySelector('#pdfReaderViewToggle')?.hidden === false, null, { timeout: 10000 });
  if (await page.evaluate(() => document.body.dataset.pdfView === 'original')) return;
  await page.locator('#pdfReaderViewToggle').click();
  await page.waitForFunction(() => document.body.dataset.pdfView === 'original', null,
    { timeout: 10000 });
}

async function waitForNativeWorkspaceReady(page, expectedPage = 1) {
  await page.waitForFunction(pageNumber => {
    const native = globalThis.__brevessNativePdfDocument;
    const pageNode = document.querySelector(
      `.pdf-native-page[data-pdf-page-number="${pageNumber}"]`
    );
    const canvas = pageNode?.querySelector('canvas');
    const canvasWidth = canvas?.getBoundingClientRect().width || 0;
    const targetRatio = Math.min(2.5, Math.max(1, globalThis.devicePixelRatio || 1));
    return document.querySelector('#pdfNativeViewer')?.dataset?.state === 'ready' &&
      pageNode?.classList.contains('is-rendered') && canvas?.width > 0 && canvas?.height > 0 &&
      canvasWidth > 0 && Math.abs(canvas.width / canvasWidth - targetRatio) <= 0.1 &&
      pageNode.querySelectorAll('.pdf-native-text-layer span').length > 0 &&
      native?.structure?.documentHash && native?.phase === 'text-ready' &&
      document.documentElement.dataset.pdfWorkspaceReady === 'true' &&
      document.documentElement.dataset.pdfWorkspaceIndexed === 'true';
  }, expectedPage, { timeout: 120000 });
}

async function readWorkspaceSnapshotSummary(worker, readerTabId) {
  return worker.evaluate(async tabId => {
    if (!Number.isInteger(tabId) || tabId < 0) {
      return { success: false, error: 'PDF_READER_TAB_NOT_FOUND' };
    }
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'getArticleWorkspaceSnapshot', chatLimit: 0
    });
    const snapshot = response?.snapshot || {};
    return {
      success: response?.success === true,
      documentHash: String(snapshot.documentHash || ''),
      paragraphCount: Array.isArray(snapshot.paragraphs) ? snapshot.paragraphs.length : 0,
      diagnosticParagraphCount: Number(snapshot.diagnostics?.paragraphCount) || 0,
      figureCount: Array.isArray(snapshot.figures?.figures)
        ? snapshot.figures.figures.length : 0
    };
  }, readerTabId);
}

async function sendReaderTabMessage(worker, readerTabId, message) {
  return worker.evaluate(async ({ tabId, payload }) => {
    if (!Number.isInteger(tabId) || tabId < 0) {
      return { success: false, code: 'PDF_READER_TAB_NOT_FOUND' };
    }
    return chrome.tabs.sendMessage(tabId, payload);
  }, { tabId: readerTabId, payload: message });
}

async function waitForFigureOriginalPage(page, pageNumber, targetRatio) {
  await page.waitForFunction(targetPage => {
    const shell = document.querySelector(
      `.pdf-native-page[data-pdf-page-number="${targetPage}"]`
    );
    const rect = shell?.getBoundingClientRect();
    const viewerRect = document.querySelector('#pdfNativeViewer')?.getBoundingClientRect();
    return document.body.dataset.pdfView === 'original' &&
      Number(document.querySelector('#pdfReaderPageNumber')?.value) === targetPage &&
      !document.querySelector('#sci-figure-image-viewer') &&
      shell?.classList.contains('is-rendered') &&
      rect?.bottom > viewerRect?.top && rect?.top < viewerRect?.bottom;
  }, pageNumber, { timeout: 30000 });
  await waitForStableRenderedCanvas(page, pageNumber, targetRatio);
}

async function readStudyNavigationDiagnostics(worker, readerTabId, targetUrl) {
  return worker.evaluate(async ({ tabId, url }) => {
    if (!Number.isInteger(tabId) || tabId < 0) {
      return { found: false, readerLocation: String(url) };
    }
    const current = await chrome.tabs.get(tabId);
    let revision = null;
    try {
      revision = await chrome.tabs.sendMessage(tabId, { action: 'getContentScriptRevision' });
    } catch (error) {
      revision = { error: String(error?.code || error?.message || error).slice(0, 120) };
    }
    return {
      found: true,
      readerLocation: String(url),
      tab: {
        id: tabId,
        url: String(current?.url || ''),
        pendingUrl: String(current?.pendingUrl || ''),
        status: String(current?.status || ''),
        active: current?.active === true
      },
      revision: {
        success: revision?.success === true,
        contentRevision: String(revision?.contentRevision || ''),
        navigationIdentity: String(revision?.navigationIdentity || ''),
        error: String(revision?.error || '').slice(0, 120)
      },
      background: {
        generation: typeof tabSidePanelNavigationGenerations === 'object'
          ? Number(tabSidePanelNavigationGenerations.get(tabId)) || 0 : 0,
        nextGeneration: typeof nextTabSidePanelNavigationGeneration === 'number'
          ? nextTabSidePanelNavigationGeneration : 0
      }
    };
  }, { tabId: readerTabId, url: targetUrl });
}

async function normalizedAnnotationGeometry(locator) {
  const deadline = Date.now() + 15000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await locator.evaluate(node => {
        const pageNode = node.closest('.pdf-native-page');
        if (!node.isConnected || !pageNode) {
          throw new Error('PDF_ANNOTATION_RENDER_NOT_STABLE');
        }
        const width = pageNode.getBoundingClientRect().width || 0;
        const height = pageNode.getBoundingClientRect().height || 0;
        const annotationId = String(node.dataset.annotationId || '');
        const rects = [...pageNode.querySelectorAll(
          `.pdf-native-annotation-hit[data-annotation-id="${CSS.escape(annotationId)}"]`
        )].map(hit => ({
          left: width ? Number.parseFloat(hit.style.left) / width : 0,
          top: height ? Number.parseFloat(hit.style.top) / height : 0,
          width: width ? Number.parseFloat(hit.style.width) / width : 0,
          height: height ? Number.parseFloat(hit.style.height) / height : 0
        }));
        return {
          pageNumber: Number(pageNode.dataset.pdfPageNumber) || 0,
          rects: rects.map(rect => Object.fromEntries(Object.entries(rect)
            .map(([key, value]) => [key, Number(value.toFixed(6))])))
        };
      });
    } catch (error) {
      lastError = error;
      if (!String(error?.message || '').includes('PDF_ANNOTATION_RENDER_NOT_STABLE')) throw error;
      await locator.page().waitForTimeout(100);
    }
  }
  throw lastError || new Error('PDF_ANNOTATION_RENDER_NOT_STABLE');
}

function assertSameNormalizedGeometry(left, right, label) {
  assert.equal(right.pageNumber, left.pageNumber, `${label}_PAGE_CHANGED`);
  assert.equal(right.rects.length, left.rects.length, `${label}_QUAD_COUNT_CHANGED`);
  for (let index = 0; index < left.rects.length; index += 1) {
    for (const key of ['left', 'top', 'width', 'height']) {
      assert.ok(Math.abs(left.rects[index][key] - right.rects[index][key]) <= 0.002,
        `${label}_${key.toUpperCase()}_DRIFTED`);
    }
  }
}

fs.mkdirSync(outputDirectory, { recursive: true });
for (const filename of [...screenshotNames, 'report.json']) {
  fs.rmSync(path.join(outputDirectory, filename), { force: true });
}

const report = {
  status: 'RUNNING',
  scope: {
    source: 'one existing local PDF supplied with --pdf or PDF_ORIGINAL_PATH',
    evaluates: 'unmodified extension startup, native PDF.js first-page rendering, and canvas geometry',
    excluded: manualActions
      ? 'MinerU parsing, provider/API calls, PDF export, and cross-page selections'
      : 'MinerU parsing, provider/API calls, annotations, persistence, and cross-page actions'
  },
  isolation: {
    temporaryExtension: true,
    temporaryProfile: true,
    dailyBrowserUsed: false,
    sourcePdfReadOnly: true
  },
  source: {},
  browser: { headed, deviceScaleFactor },
  manualActions,
  nativeEvents: [],
  metrics: {},
  diagnostics: { pageErrors: [], consoleErrors: [], workerErrors: [] },
  network: { apiRequests: 0, externalRequests: 0, blockedRequestOrigins: [] },
  artifacts: [],
  checks: [],
  error: ''
};
writeReport(report);

let context;
let page;
try {
  assert.ok(pdfPath && fs.existsSync(pdfPath) && fs.statSync(pdfPath).isFile(),
    'PDF_ORIGINAL_INPUT_MISSING');
  assert.match(fs.readFileSync(pdfPath).subarray(0, 5).toString('latin1'), /^%PDF-/u,
    'PDF_ORIGINAL_INPUT_INVALID');
  assert.ok(fs.existsSync(path.join(extensionRoot, 'manifest.json')),
    'EXTENSION_MANIFEST_MISSING');
  copyExtension();
  report.source = {
    pdfSha256: sha256File(pdfPath),
    pdfBytes: fs.statSync(pdfPath).size,
    extensionBuildSha256: extensionBuildHash(temporaryExtension)
  };

  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: 'msedge', headless: !headed, reducedMotion: 'reduce',
    viewport: { width: 1280, height: 1000 }, deviceScaleFactor,
    args: [`--disable-extensions-except=${temporaryExtension}`,
      `--load-extension=${temporaryExtension}`]
  });
  context.on('request', request => {
    const url = request.url();
    if (!/^https?:\/\//u.test(url)) return;
    report.network.externalRequests += 1;
    try {
      const origin = new URL(url).origin;
      if (!report.network.blockedRequestOrigins.includes(origin)) {
        report.network.blockedRequestOrigins.push(origin);
      }
    } catch { /* The request is still blocked below. */ }
    if (/openai|anthropic|generativelanguage|api\.|chat\/completions|responses|mineru/iu.test(url)) {
      report.network.apiRequests += 1;
    }
  });
  await context.route(/^https?:\/\//u, route => route.abort('blockedbyclient'));
  await context.addInitScript(() => {
    globalThis.__pdfOriginalNativeEvents = [];
    globalThis.__pdfOriginalNativeErrors = [];
    document.addEventListener('brevess:native-pdf-ready', event => {
      const detail = event?.detail || {};
      globalThis.__pdfOriginalNativeEvents.push({
        phase: String(detail.phase || ''),
        pageCount: Number(detail.pageCount) || 0,
        outlineCount: Number(detail.outlineCount) || 0,
        paragraphCount: Number(detail.paragraphCount) || 0,
        textCoverage: Number(detail.textCoverage) || 0,
        observedAt: performance.now()
      });
    });
    document.addEventListener('brevess:native-pdf-error', event => {
      globalThis.__pdfOriginalNativeErrors.push({
        message: String(event?.detail?.message || 'PDF_NATIVE_READER_FAILED').slice(0, 300),
        observedAt: performance.now()
      });
    });
  });

  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  worker.on('console', message => {
    if (message.type() === 'error') report.diagnostics.workerErrors.push(safeMessage(message.text()));
  });
  const extensionId = new URL(worker.url()).host;
  page = await context.newPage();
  page.on('pageerror', error => report.diagnostics.pageErrors.push(
    safeMessage(error.stack || error.message)
  ));
  page.on('console', message => {
    if (message.type() === 'error') report.diagnostics.consoleErrors.push(safeMessage(message.text()));
  });
  await page.goto(`chrome-extension://${extensionId}/pdf-reader.html`, {
    waitUntil: 'domcontentloaded'
  });
  const readerTabId = await page.evaluate(async () =>
    Number((await chrome.tabs.getCurrent())?.id) || 0);
  assert.ok(Number.isInteger(readerTabId) && readerTabId > 0,
    'PDF_READER_TAB_NOT_FOUND');
  await page.waitForTimeout(250);
  report.metrics.preInputNativeErrors = await page.evaluate(() => {
    const prior = [...(globalThis.__pdfOriginalNativeErrors || [])];
    globalThis.__pdfOriginalNativeErrors = [];
    return prior.map(item => ({ message: String(item?.message || '').slice(0, 120) }));
  });
  await page.locator('#pdfLocalFile').setInputFiles(pdfPath);
  const firstCanvas = page.locator('.pdf-native-page[data-pdf-page-number="1"] canvas').first();
  await page.waitForFunction(() => Boolean(
    document.querySelector('.pdf-native-page[data-pdf-page-number="1"] canvas') ||
    globalThis.__pdfOriginalNativeErrors?.length
  ), null, { timeout: 45000 });
  const earlyNativeError = await page.evaluate(() =>
    globalThis.__pdfOriginalNativeErrors?.at(-1)?.message || '');
  assert.equal(earlyNativeError, '', `PDF_NATIVE_STARTUP_FAILED:${safeMessage(earlyNativeError)}`);
  await firstCanvas.waitFor({ state: 'attached', timeout: 45000 });
  await waitForNativeWorkspaceReady(page);
  await ensureOriginalView(page);
  await firstCanvas.waitFor({ state: 'visible', timeout: 10000 });
  await waitForStableRenderedCanvas(page, 1, deviceScaleFactor);

  report.nativeEvents = await page.evaluate(() => globalThis.__pdfOriginalNativeEvents || []);
  report.metrics = await page.evaluate(() => {
    const native = globalThis.__brevessNativePdfDocument;
    const viewer = document.querySelector('#pdfNativeViewer');
    const pageNode = document.querySelector('.pdf-native-page[data-pdf-page-number="1"]');
    const canvas = pageNode?.querySelector('canvas');
    const textLayer = pageNode?.querySelector('.pdf-native-text-layer');
    const canvasRect = canvas?.getBoundingClientRect();
    let sampledPixels = 0;
    let nonWhitePixels = 0;
    if (canvas?.width && canvas?.height) {
      const pixels = canvas.getContext('2d', { willReadFrequently: true })
        ?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (pixels) {
        const step = Math.max(4, Math.floor(Math.min(canvas.width, canvas.height) / 180));
        for (let y = 0; y < canvas.height; y += step) {
          for (let x = 0; x < canvas.width; x += step) {
            const offset = (y * canvas.width + x) * 4;
            sampledPixels += 1;
            if (pixels[offset + 3] > 0 &&
                (pixels[offset] < 245 || pixels[offset + 1] < 245 || pixels[offset + 2] < 245)) {
              nonWhitePixels += 1;
            }
          }
        }
      }
    }
    return {
      viewerState: viewer?.dataset?.state || '',
      documentHash: String(native?.structure?.documentHash || ''),
      phase: String(native?.phase || ''),
      pageCount: Number(native?.pageCount) || 0,
      workspaceReady: document.documentElement.dataset.pdfWorkspaceReady === 'true',
      workspaceIndexed: document.documentElement.dataset.pdfWorkspaceIndexed === 'true',
      firstPage: {
        visible: Boolean(canvasRect?.width && canvasRect?.height),
        cssWidth: canvasRect?.width || 0,
        cssHeight: canvasRect?.height || 0,
        backingWidth: canvas?.width || 0,
        backingHeight: canvas?.height || 0,
        pixelRatioX: canvasRect?.width ? canvas.width / canvasRect.width : 0,
        pixelRatioY: canvasRect?.height ? canvas.height / canvasRect.height : 0,
        textSpanCount: textLayer?.querySelectorAll('span').length || 0,
        textCharacterCount: String(textLayer?.textContent || '').length,
        sampledPixels,
        nonWhitePixels
      },
      readerErrorCode: document.documentElement.dataset.pdfErrorCode || ''
    };
  });

  assert.equal(report.metrics.viewerState, 'ready');
  assert.equal(report.metrics.documentHash, report.source.pdfSha256);
  assert.ok(report.metrics.pageCount > 0);
  assert.equal(report.metrics.phase, 'text-ready');
  if (expectedText) {
    const matched = await page.evaluate(needle =>
      (globalThis.__brevessNativePdfDocument?.structure?.paragraphs || [])
        .some(paragraph => String(paragraph.text || '').includes(needle)), expectedText);
    assert.equal(matched, true, 'PDF_EXPECTED_TEXT_NOT_EXTRACTED');
    report.metrics.expectedText = {
      sha256: crypto.createHash('sha256').update(expectedText).digest('hex'), matched
    };
  }
  assert.equal(report.metrics.workspaceReady, true);
  assert.equal(report.metrics.workspaceIndexed, true);
  assert.equal(report.metrics.firstPage.visible, true);
  assert.ok(report.metrics.firstPage.backingWidth >= report.metrics.firstPage.cssWidth);
  assert.ok(report.metrics.firstPage.backingHeight >= report.metrics.firstPage.cssHeight);
  assert.ok(report.metrics.firstPage.pixelRatioX >= 1 && report.metrics.firstPage.pixelRatioX <= 2.6);
  assert.ok(report.metrics.firstPage.pixelRatioY >= 1 && report.metrics.firstPage.pixelRatioY <= 2.6);
  assert.ok(report.metrics.firstPage.textSpanCount > 0);
  assert.ok(report.metrics.firstPage.textCharacterCount > 0);
  assert.ok(report.metrics.firstPage.nonWhitePixels > 0);
  assert.equal(report.network.apiRequests, 0);
  assert.equal(report.network.externalRequests, 0);
  assert.deepEqual(report.diagnostics.pageErrors, []);
  assert.deepEqual(report.diagnostics.consoleErrors, []);
  assert.deepEqual(report.diagnostics.workerErrors, []);

  await page.waitForFunction(() => Boolean(globalThis.__brevessNativePdfFigures), null,
    { timeout: 45000 });
  report.metrics.figures = await page.evaluate(() => {
    const catalog = globalThis.__brevessNativePdfFigures || {};
    return {
      documentHash: String(catalog.documentHash || ''),
      count: Array.isArray(catalog.figures) ? catalog.figures.length : 0,
      items: (catalog.figures || []).map(figure => ({
        figureId: String(figure.figureId || ''),
        pageNumber: Number(figure.pageNumber) || 0,
        pageNumbers: Array.isArray(figure.pageNumbers) ? figure.pageNumbers.map(Number) : [],
        panelHintCount: Array.isArray(figure.panelHints) ? figure.panelHints.length : 0,
        captionSha256Input: String(figure.caption || '')
      }))
    };
  });
  report.metrics.figures.items = report.metrics.figures.items.map(item => ({
    figureId: item.figureId, pageNumber: item.pageNumber, pageNumbers: item.pageNumbers,
    panelHintCount: item.panelHintCount,
    captionSha256: crypto.createHash('sha256').update(item.captionSha256Input).digest('hex')
  }));
  assert.equal(report.metrics.figures.documentHash, report.metrics.documentHash);
  if (expectedFigureCount) assert.equal(report.metrics.figures.count, expectedFigureCount);
  if (verifyFigureOriginal) {
    assert.ok(figureOriginalPages.length >= 2 && figureOriginalPages.length <= 4 &&
      figureOriginalPages.every(value => Number.isSafeInteger(value) && value >= 1 &&
        value <= report.metrics.pageCount) &&
      new Set(figureOriginalPages).size === figureOriginalPages.length,
    'PDF_FIGURE_ORIGINAL_PAGES_INVALID');
    assert.ok(figureOriginalPages.includes(figureOriginalActivePage) &&
      figureOriginalActivePage !== figureOriginalPages[0],
    'PDF_FIGURE_ORIGINAL_ACTIVE_PAGE_INVALID');
    const figure = figureOriginalFigureId
      ? report.metrics.figures.items.find(item => item.figureId === figureOriginalFigureId)
      : report.metrics.figures.items.find(item => item.pageNumbers.includes(figureOriginalActivePage)) ||
        report.metrics.figures.items[0];
    assert.ok(figure?.figureId, 'PDF_FIGURE_ORIGINAL_FIGURE_MISSING');
    const identity = await page.evaluate(() => ({
      documentHash: String(globalThis.__brevessNativePdfDocument?.structure?.documentHash || ''),
      documentGeneration: Number(globalThis.__brevessNativePdfDocument?.documentGeneration) || 0
    }));
    assert.equal(identity.documentHash, report.metrics.documentHash,
      'PDF_FIGURE_ORIGINAL_IDENTITY_MISMATCH');
    assert.ok(Number.isSafeInteger(identity.documentGeneration) && identity.documentGeneration > 0,
      'PDF_FIGURE_ORIGINAL_GENERATION_MISSING');
    const selection = await sendReaderTabMessage(worker, readerTabId, {
      action: 'setPdfFigureArtworkPages', figureId: figure.figureId,
      documentHash: identity.documentHash, pageNumbers: figureOriginalPages,
      coverageConfirmed: true
    });
    assert.equal(selection?.success, true,
      `PDF_FIGURE_ORIGINAL_SELECTION_FAILED:${safeMessage(selection?.code || selection?.error)}`);
    const active = await sendReaderTabMessage(worker, readerTabId, {
      action: 'showFigureOriginalImage', figureId: figure.figureId,
      documentHash: identity.documentHash, documentGeneration: identity.documentGeneration,
      panelId: figureOriginalPanelId, sourcePage: figureOriginalActivePage
    });
    assert.equal(active?.success, true,
      `PDF_FIGURE_ORIGINAL_ACTIVE_FAILED:${safeMessage(active?.code || active?.message)}`);
    assert.equal(active?.mode, 'pdf-page', 'PDF_FIGURE_ORIGINAL_ACTIVE_MODE_MISMATCH');
    assert.equal(active?.open, false, 'PDF_FIGURE_ORIGINAL_OVERLAY_OPENED');
    assert.equal(active?.pageNumber, figureOriginalActivePage,
      'PDF_FIGURE_ORIGINAL_ACTIVE_PAGE_MISMATCH');
    await waitForFigureOriginalPage(page, figureOriginalActivePage, deviceScaleFactor);
    await page.screenshot({
      path: path.join(outputDirectory, 'figure-original-active-page.png'), fullPage: false
    });
    const defaultTarget = figureOriginalPages[0];
    const defaultResult = await sendReaderTabMessage(worker, readerTabId, {
      action: 'showFigureOriginalImage', figureId: figure.figureId,
      documentHash: identity.documentHash, documentGeneration: identity.documentGeneration
    });
    assert.equal(defaultResult?.success, true,
      `PDF_FIGURE_ORIGINAL_DEFAULT_FAILED:${safeMessage(defaultResult?.code || defaultResult?.message)}`);
    assert.equal(defaultResult?.mode, 'pdf-page', 'PDF_FIGURE_ORIGINAL_DEFAULT_MODE_MISMATCH');
    assert.equal(defaultResult?.open, false, 'PDF_FIGURE_ORIGINAL_OVERLAY_OPENED');
    assert.equal(defaultResult?.pageNumber, defaultTarget,
      'PDF_FIGURE_ORIGINAL_DEFAULT_PAGE_MISMATCH');
    await waitForFigureOriginalPage(page, defaultTarget, deviceScaleFactor);
    await page.screenshot({
      path: path.join(outputDirectory, 'figure-original-default-page.png'), fullPage: false
    });
    report.metrics.figureOriginalNavigation = {
      figureId: figure.figureId, artworkPageNumbers: figureOriginalPages,
      activePanelId: figureOriginalPanelId, activePage: active.pageNumber,
      defaultPage: defaultResult.pageNumber, documentGeneration: identity.documentGeneration,
      overlayOpened: false
    };
    await page.evaluate(() => globalThis.__brevessPdfReaderBridge?.command?.('focusPage', 1));
    await page.locator('.pdf-native-page[data-pdf-page-number="1"]')
      .scrollIntoViewIfNeeded();
  }
  if (figurePage) {
    assert.ok(figurePage <= report.metrics.pageCount, 'PDF_FIGURE_PAGE_OUT_OF_RANGE');
    await page.locator('#pdfReaderPageNumber').evaluate((node, value) => {
      node.value = String(value);
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }, figurePage);
    const figurePageShell = page.locator(
      `.pdf-native-page[data-pdf-page-number="${figurePage}"]`
    );
    await figurePageShell.scrollIntoViewIfNeeded();
    await page.waitForFunction(pageNumber => document.querySelector(
      `.pdf-native-page[data-pdf-page-number="${pageNumber}"]`)?.classList.contains('is-rendered'),
    figurePage, { timeout: 20000 });
    const figureCanvas = figurePageShell.locator('canvas').first();
    await figureCanvas.waitFor({ state: 'visible', timeout: 15000 });
    await figureCanvas.scrollIntoViewIfNeeded();
    await waitForStableRenderedCanvas(page, figurePage, deviceScaleFactor);
    report.metrics.figurePage = await figureCanvas.evaluate(canvas => {
      const rect = canvas.getBoundingClientRect();
      const viewerRect = document.querySelector('#pdfNativeViewer')?.getBoundingClientRect();
      const pageRect = canvas.closest('.pdf-native-page')?.getBoundingClientRect();
      const intersection = viewerRect ? {
        left: Math.max(rect.left, viewerRect.left), top: Math.max(rect.top, viewerRect.top),
        right: Math.min(rect.right, viewerRect.right), bottom: Math.min(rect.bottom, viewerRect.bottom)
      } : null;
      const sampleX = intersection ? (intersection.left + intersection.right) / 2 : rect.left + 1;
      const sampleY = intersection ? (intersection.top + intersection.bottom) / 2 : rect.top + 1;
      const elementsAtSample = [...document.elementsFromPoint(sampleX, sampleY)].slice(0, 12)
        .map(node => ({ tag: node.tagName, id: node.id || '', className: String(node.className || '') }));
      const pixels = canvas.getContext('2d', { willReadFrequently: true })
        ?.getImageData(0, 0, canvas.width, canvas.height).data;
      let sampledPixels = 0;
      let nonWhitePixels = 0;
      if (pixels) {
        const step = Math.max(4, Math.floor(Math.min(canvas.width, canvas.height) / 180));
        for (let y = 0; y < canvas.height; y += step) {
          for (let x = 0; x < canvas.width; x += step) {
            const offset = (y * canvas.width + x) * 4;
            sampledPixels += 1;
            if (pixels[offset + 3] > 0 &&
                (pixels[offset] < 245 || pixels[offset + 1] < 245 || pixels[offset + 2] < 245)) {
              nonWhitePixels += 1;
            }
          }
        }
      }
      return {
        cssWidth: rect.width, cssHeight: rect.height,
        backingWidth: canvas.width, backingHeight: canvas.height,
        pixelRatioX: rect.width ? canvas.width / rect.width : 0,
        pixelRatioY: rect.height ? canvas.height / rect.height : 0,
        intersectsViewer: Boolean(viewerRect && rect.bottom > viewerRect.top &&
          rect.top < viewerRect.bottom && rect.right > viewerRect.left && rect.left < viewerRect.right),
        canvasInCompositorStack: elementsAtSample.some(item =>
          item.tag === 'CANVAS' && item.className.includes('pdf-native-page-canvas')),
        elementsAtSample,
        canvasRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewerRect: viewerRect ? { x: viewerRect.x, y: viewerRect.y,
          width: viewerRect.width, height: viewerRect.height } : null,
        pageRect: pageRect ? { x: pageRect.x, y: pageRect.y,
          width: pageRect.width, height: pageRect.height } : null,
        viewerScrollTop: document.querySelector('#pdfNativeViewer')?.scrollTop || 0,
        bodyView: document.body.dataset.pdfView || '',
        originalViewerHidden: Boolean(document.querySelector('#pdfOriginalViewer')?.hidden),
        canvasStyle: { display: getComputedStyle(canvas).display,
          visibility: getComputedStyle(canvas).visibility,
          opacity: getComputedStyle(canvas).opacity },
        sampledPixels, nonWhitePixels
      };
    });
    const canvasDataUrl = await figureCanvas.evaluate(canvas => canvas.toDataURL('image/png'));
    assert.match(canvasDataUrl, /^data:image\/png;base64,/u);
    fs.writeFileSync(path.join(outputDirectory, `figure-page-${figurePage}-canvas.png`),
      Buffer.from(canvasDataUrl.slice(canvasDataUrl.indexOf(',') + 1), 'base64'));
    await page.screenshot({
      path: path.join(outputDirectory, `figure-page-${figurePage}-viewport.png`), fullPage: false
    });
    assert.ok(report.metrics.figurePage.backingWidth > 0 &&
      report.metrics.figurePage.backingHeight > 0);
    assert.ok(report.metrics.figurePage.nonWhitePixels > 0,
      'PDF_FIGURE_PAGE_CANVAS_BLANK');
    assert.equal(report.metrics.figurePage.intersectsViewer, true,
      'PDF_FIGURE_PAGE_NOT_VISIBLE');
    assert.equal(report.metrics.figurePage.canvasInCompositorStack, true,
      'PDF_FIGURE_PAGE_CANVAS_OCCLUDED');
    assert.ok(Math.abs(report.metrics.figurePage.pixelRatioX - deviceScaleFactor) <= 0.1);
    assert.ok(Math.abs(report.metrics.figurePage.pixelRatioY - deviceScaleFactor) <= 0.1);
    await page.evaluate(() => globalThis.__brevessPdfReaderBridge?.command?.('focusPage', 1));
    await page.locator('.pdf-native-page[data-pdf-page-number="1"]')
      .scrollIntoViewIfNeeded();
  }

  await page.screenshot({
    path: path.join(outputDirectory, 'original-reader-initial.png'), fullPage: false
  });
  await firstCanvas.screenshot({ path: path.join(outputDirectory, 'original-first-page.png') });
  const initialDocumentHash = report.metrics.documentHash;
  await page.reload({ waitUntil: 'domcontentloaded' });
  const reloadedCanvas = page.locator('.pdf-native-page[data-pdf-page-number="1"] canvas').first();
  await reloadedCanvas.waitFor({ state: 'attached', timeout: 45000 });
  await waitForNativeWorkspaceReady(page);
  await ensureOriginalView(page);
  await reloadedCanvas.waitFor({ state: 'visible', timeout: 10000 });
  report.metrics.reload = await page.evaluate(() => ({
    viewerState: document.querySelector('#pdfNativeViewer')?.dataset?.state || '',
    documentHash: String(globalThis.__brevessNativePdfDocument?.structure?.documentHash || ''),
    phase: String(globalThis.__brevessNativePdfDocument?.phase || ''),
    pageCount: Number(globalThis.__brevessNativePdfDocument?.pageCount) || 0,
    restored: document.documentElement.dataset.pdfWorkspaceRestored === 'true',
    workspaceReady: document.documentElement.dataset.pdfWorkspaceReady === 'true',
    workspaceIndexed: document.documentElement.dataset.pdfWorkspaceIndexed === 'true',
    firstPageAttached: Boolean(document.querySelector(
      '.pdf-native-page[data-pdf-page-number="1"] canvas'))
  }));
  assert.equal(report.metrics.reload.viewerState, 'ready');
  assert.equal(report.metrics.reload.documentHash, initialDocumentHash);
  assert.equal(report.metrics.reload.pageCount, report.metrics.pageCount);
  assert.equal(report.metrics.reload.firstPageAttached, true);
  assert.equal(report.metrics.reload.phase, 'text-ready');
  assert.equal(report.metrics.reload.workspaceReady, true);
  assert.equal(report.metrics.reload.workspaceIndexed, true);
  await page.screenshot({
    path: path.join(outputDirectory, 'original-reader-reloaded.png'), fullPage: false
  });

  await page.keyboard.press('Control+f');
  assert.equal(await page.locator('#pdfReaderFind').evaluate(node => node === document.activeElement),
    true, 'PDF_FIND_SHORTCUT_DID_NOT_FOCUS');
  const searchQuery = await page.evaluate(() => {
    const counts = new Map();
    for (const paragraph of globalThis.__brevessNativePdfDocument?.structure?.paragraphs || []) {
      for (const match of String(paragraph.text || '').toLowerCase().matchAll(/[a-z]{6,}/g)) {
        counts.set(match[0], (counts.get(match[0]) || 0) + 1);
      }
    }
    return [...counts].sort((left, right) => right[1] - left[1])
      .find(([, count]) => count >= 2)?.[0] || '';
  });
  assert.ok(searchQuery, 'PDF_FIND_REPEATED_QUERY_MISSING');
  await page.locator('#pdfReaderFind').fill(searchQuery);
  await page.waitForFunction(() => /^1\/\d+$/u.test(
    document.querySelector('#pdfReaderFindStatus')?.textContent || ''
  ), null, { timeout: 15000 });
  const firstSearchStatus = await page.locator('#pdfReaderFindStatus').textContent();
  const searchMatchCount = Number(String(firstSearchStatus).split('/')[1]) || 0;
  assert.ok(searchMatchCount >= 2, 'PDF_FIND_NEXT_REQUIRES_MULTIPLE_MATCHES');
  await page.locator('.pdf-native-search-hit').first().waitFor({ state: 'visible', timeout: 15000 });
  const firstSearchPage = Number(await page.locator('#pdfReaderPageNumber').inputValue()) || 0;
  await page.locator('#pdfReaderFindNext').click();
  await page.waitForFunction(status => {
    const current = document.querySelector('#pdfReaderFindStatus')?.textContent || '';
    return current && current !== status;
  }, firstSearchStatus, { timeout: 15000 });
  await page.locator('.pdf-native-search-hit').first().waitFor({ state: 'visible', timeout: 15000 });
  report.metrics.find = {
    shortcutFocused: true,
    querySha256: crypto.createHash('sha256').update(searchQuery).digest('hex'),
    matchCount: searchMatchCount,
    firstPage: firstSearchPage,
    nextPage: Number(await page.locator('#pdfReaderPageNumber').inputValue()) || 0,
    nextAdvanced: true
  };

  await page.evaluate(() => {
    const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    globalThis.__pdfOriginalStudyResponses = [];
    chrome.runtime.sendMessage = (...args) => {
      const pending = originalSendMessage(...args);
      if (args[0]?.type === 'PDF_READER_START_READING') {
        Promise.resolve(pending).then(response => {
          globalThis.__pdfOriginalStudyResponses.push({
            success: response?.success === true,
            error: String(response?.error?.code || response?.error?.message || '').slice(0, 120)
          });
        }, error => {
          globalThis.__pdfOriginalStudyResponses.push({
            success: false, error: String(error?.code || error?.message || error).slice(0, 120)
          });
        });
      }
      return pending;
    };
  });
  report.metrics.studyNavigationBefore = await readStudyNavigationDiagnostics(
    worker, readerTabId, page.url());
  await page.locator('#pdfReaderStudy').click();
  await page.waitForFunction(() => globalThis.__pdfOriginalStudyResponses?.length > 0,
    null, { timeout: 15000 });
  report.metrics.studyButton = await page.evaluate(() => ({
    response: globalThis.__pdfOriginalStudyResponses?.[0] || null,
    visibleStatus: document.querySelector('#pdfReaderSaveStatus')?.hidden === false,
    statusState: document.querySelector('#pdfReaderSaveStatus')?.dataset?.state || '',
    statusText: String(document.querySelector('#pdfReaderSaveStatus')?.textContent || '').slice(0, 120)
  }));
  report.metrics.studyNavigationAfter = await readStudyNavigationDiagnostics(
    worker, readerTabId, page.url());
  assert.equal(report.metrics.studyButton.response?.success, true,
    `PDF_STUDY_BUTTON_FAILED:${safeMessage(report.metrics.studyButton.response?.error)}`);
  assert.notEqual(report.metrics.studyButton.statusState, 'error',
    `PDF_STUDY_BUTTON_STATUS_ERROR:${safeMessage(report.metrics.studyButton.statusText)}`);
  assert.doesNotMatch(report.metrics.studyButton.statusText,
    /TAB_MESSAGE_NAVIGATION_STALE|无法打开|失败/iu, 'PDF_STUDY_BUTTON_VISIBLE_ERROR');
  report.metrics.studySidebarSnapshot = await readWorkspaceSnapshotSummary(worker, readerTabId);
  assert.equal(report.metrics.studySidebarSnapshot.success, true,
    'PDF_STUDY_SNAPSHOT_FAILED');
  assert.equal(report.metrics.studySidebarSnapshot.documentHash, initialDocumentHash,
    'PDF_STUDY_SNAPSHOT_HASH_MISMATCH');
  assert.ok(report.metrics.studySidebarSnapshot.paragraphCount > 0,
    'PDF_STUDY_SNAPSHOT_EMPTY');
  assert.ok(report.metrics.studySidebarSnapshot.diagnosticParagraphCount > 0,
    'PDF_STUDY_DIAGNOSTICS_EMPTY');

  await page.evaluate(() => globalThis.__brevessPdfReaderBridge?.command?.('focusPage', 1));
  await page.locator('.pdf-native-page[data-pdf-page-number="1"]')
    .scrollIntoViewIfNeeded();
  await page.locator('.pdf-native-page[data-pdf-page-number="1"].is-rendered')
    .waitFor({ state: 'attached', timeout: 15000 });
  if (manualActions) {
    const spans = page.locator(
      '.pdf-native-page[data-pdf-page-number="1"] .pdf-native-text-layer span'
    );
    const spanIndex = await spans.evaluateAll(nodes => nodes.findIndex(node => {
      const rect = node.getBoundingClientRect();
      return String(node.textContent || '').trim().length >= 24 && rect.width >= 100 &&
        rect.height >= 8 && rect.top >= 0 && rect.bottom <= innerHeight;
    }));
    assert.ok(spanIndex >= 0, 'PDF_MOUSE_SELECTION_TARGET_MISSING');
    const selectionTarget = spans.nth(spanIndex);
    await selectionTarget.scrollIntoViewIfNeeded();
    const box = await selectionTarget.boundingBox();
    assert.ok(box?.width > 20 && box?.height > 5, 'PDF_MOUSE_SELECTION_TARGET_HIDDEN');
    const startX = box.x + 3;
    const endX = box.x + Math.max(12, box.width - 3);
    const centerY = box.y + box.height / 2;
    await page.mouse.move(startX, centerY);
    await page.mouse.down();
    await page.mouse.move(endX, centerY, { steps: 16 });
    await page.mouse.up();
    const selection = await page.evaluate(() => {
      const value = getSelection();
      const range = value?.rangeCount ? value.getRangeAt(0) : null;
      const layer = range?.startContainer?.parentElement?.closest?.('.pdf-native-text-layer') ||
        range?.startContainer?.closest?.('.pdf-native-text-layer');
      return {
        characterCount: String(value || '').normalize('NFKC').trim().length,
        rangeCount: value?.rangeCount || 0,
        pageNumber: Number(layer?.dataset?.pdfPageNumber) || 0
      };
    });
    assert.ok(selection.characterCount > 0, 'PDF_REAL_MOUSE_SELECTION_EMPTY');
    assert.equal(selection.rangeCount, 1);
    assert.equal(selection.pageNumber, 1);
    report.metrics.manual = { realMouseSelection: selection, selectionMethod: 'mouse' };
    await page.screenshot({
      path: path.join(outputDirectory, 'manual-selection.png'), fullPage: false
    });
    await page.locator('#sci-manual-toolbar').waitFor({ state: 'visible', timeout: 10000 });
    const categoryCount = await page.locator(
      '#sci-manual-toolbar .sci-manual-category:visible'
    ).count();
    assert.ok(categoryCount > 0, 'PDF_MANUAL_CATEGORY_LIST_EMPTY');
    await page.locator('#sci-manual-toolbar .sci-manual-secondary-row button')
      .filter({ hasText: '高亮后写备注' }).click();
    const category = page.locator('#sci-manual-toolbar .sci-manual-category').first();
    await category.click();
    const editor = page.locator('#sci-highlight-context-popover textarea');
    await editor.waitFor({ state: 'visible', timeout: 10000 });
    const note = `PDF original mouse QA ${crypto.randomUUID()}`;
    await editor.fill(note);
    await page.locator('#sci-highlight-context-popover button').filter({ hasText: '保存修改' }).click();
    const hit = page.locator(`.pdf-native-annotation-hit[title="${note}"]`).first();
    await hit.waitFor({ state: 'visible', timeout: 10000 });
    const annotationId = await hit.getAttribute('data-annotation-id');
    assert.ok(annotationId, 'PDF_MOUSE_ANNOTATION_ID_MISSING');
    const geometryBeforeZoom = await normalizedAnnotationGeometry(hit);
    assert.equal(geometryBeforeZoom.pageNumber, 1);
    assert.ok(geometryBeforeZoom.rects.length > 0, 'PDF_MOUSE_ANNOTATION_QUADS_MISSING');
    const widthBeforeZoom = await firstCanvas.evaluate(node => node.getBoundingClientRect().width);
    await page.locator('#pdfReaderZoomIn').click();
    await page.waitForFunction(width => {
      const canvas = document.querySelector(
        '.pdf-native-page[data-pdf-page-number="1"] canvas');
      return canvas && Math.abs(canvas.getBoundingClientRect().width - width) > 1;
    }, widthBeforeZoom, { timeout: 15000 });
    await waitForStableRenderedCanvas(page, 1, deviceScaleFactor);
    await hit.waitFor({ state: 'visible', timeout: 10000 });
    const geometryAfterZoom = await normalizedAnnotationGeometry(hit);
    assertSameNormalizedGeometry(geometryBeforeZoom, geometryAfterZoom,
      'PDF_MOUSE_ANNOTATION_AFTER_ZOOM');
    await page.screenshot({
      path: path.join(outputDirectory, 'manual-highlight-zoomed.png'), fullPage: false
    });
    const farPage = report.metrics.pageCount;
    await page.locator('#pdfReaderPageNumber').evaluate(node => {
      node.value = String(globalThis.__brevessNativePdfDocument?.pageCount || 1);
      node.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator(`.pdf-native-page[data-pdf-page-number="${farPage}"]`)
      .scrollIntoViewIfNeeded();
    await page.locator(`.pdf-native-page[data-pdf-page-number="${farPage}"].is-rendered`)
      .waitFor({ state: 'attached', timeout: 15000 });
    assert.equal(Number(await page.locator('#pdfReaderPageNumber').inputValue()), farPage,
      'PDF_PAGE_INPUT_DID_NOT_NAVIGATE');
    await page.waitForFunction(() => !document.querySelector(
      '.pdf-native-page[data-pdf-page-number="1"] canvas'
    ), null, { timeout: 20000 });
    await page.locator('#pdfReaderPageNumber').evaluate(node => {
      node.value = '1';
      node.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitForStableRenderedCanvas(page, 1, deviceScaleFactor);
    const returnedHit = page.locator(
      `.pdf-native-annotation-hit[data-annotation-id="${annotationId}"][title="${note}"]`
    ).first();
    await returnedHit.waitFor({ state: 'visible', timeout: 15000 });
    const geometryAfterRemount = await normalizedAnnotationGeometry(returnedHit);
    assertSameNormalizedGeometry(geometryBeforeZoom, geometryAfterRemount,
      'PDF_MOUSE_ANNOTATION_AFTER_REMOUNT');
    const readingPositionPage = Math.max(2, Math.min(
      figurePage || report.metrics.pageCount, report.metrics.pageCount
    ));
    await page.locator('#pdfReaderPageNumber').evaluate((node, pageNumber) => {
      node.value = String(pageNumber);
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }, readingPositionPage);
    await page.locator(
      `.pdf-native-page[data-pdf-page-number="${readingPositionPage}"].is-rendered`
    ).waitFor({ state: 'attached', timeout: 15000 });
    await page.evaluate(({ pageNumber, offset }) => {
      const viewer = document.querySelector('#pdfNativeViewer');
      const pageNode = viewer.querySelector(
        `.pdf-native-page[data-pdf-page-number="${pageNumber}"]`
      );
      const viewerRect = viewer.getBoundingClientRect();
      const pageRect = pageNode.getBoundingClientRect();
      viewer.scrollTo({
        top: viewer.scrollTop + pageRect.top - viewerRect.top + pageRect.height * offset,
        behavior: 'instant'
      });
    }, { pageNumber: readingPositionPage, offset: 0.32 });
    await page.waitForTimeout(350);
    const expectedReadingPosition = await page.evaluate(pageNumber => {
      const viewer = document.querySelector('#pdfNativeViewer');
      const pageNode = viewer.querySelector(
        `.pdf-native-page[data-pdf-page-number="${pageNumber}"]`
      );
      const viewerRect = viewer.getBoundingClientRect();
      const pageRect = pageNode.getBoundingClientRect();
      return {
        pageNumber: Number(document.querySelector('#pdfReaderPageNumber')?.value) || 0,
        pageOffset: Math.max(0, Math.min(1,
          (viewerRect.top - pageRect.top) / pageRect.height)),
        zoomValue: document.querySelector('#pdfReaderZoomValue')?.textContent || ''
      };
    }, readingPositionPage);
    assert.equal(expectedReadingPosition.pageNumber, readingPositionPage,
      'PDF_READING_POSITION_TARGET_PAGE_MISMATCH');
    assert.ok(expectedReadingPosition.pageOffset > 0.2 && expectedReadingPosition.pageOffset < 0.45,
      'PDF_READING_POSITION_TARGET_OFFSET_MISMATCH');
    report.metrics.manual.storedReadingPositionBeforeReload = await page.evaluate(hash => {
      try {
        const value = JSON.parse(localStorage.getItem(`brevess-pdf-position:${hash}`) || 'null');
        return value ? {
          documentHash: String(value.documentHash || ''),
          pageNumber: Number(value.pageNumber) || 0,
          pageOffset: Number(value.pageOffset) || 0,
          scale: Number(value.scale) || 0
        } : null;
      } catch {
        return { invalid: true };
      }
    }, initialDocumentHash);
    await context.addInitScript(() => {
      globalThis.__pdfOriginalViewerScrollTrace = [];
      const originalScrollTo = Element.prototype.scrollTo;
      Element.prototype.scrollTo = function (...args) {
        if (this?.id === 'pdfNativeViewer') {
          const options = args[0] && typeof args[0] === 'object' ? args[0] : null;
          globalThis.__pdfOriginalViewerScrollTrace.push({
            type: 'scrollTo', before: Number(this.scrollTop) || 0,
            requestedTop: options ? Number(options.top) || 0 : Number(args[1]) || 0,
            behavior: String(options?.behavior || ''),
            stack: String(new Error().stack || '').slice(0, 900),
            observedAt: performance.now()
          });
        }
        return originalScrollTo.apply(this, args);
      };
      document.addEventListener('scroll', event => {
        if (event.target?.id !== 'pdfNativeViewer') return;
        globalThis.__pdfOriginalViewerScrollTrace.push({
          type: 'scroll', scrollTop: Number(event.target.scrollTop) || 0,
          observedAt: performance.now()
        });
      }, true);
    });
    report.metrics.manual = {
      ...report.metrics.manual,
      annotationIdSha256: crypto.createHash('sha256').update(annotationId).digest('hex'),
      noteSha256: crypto.createHash('sha256').update(note).digest('hex'),
      categoryCount,
      quadCount: geometryBeforeZoom.rects.length,
      normalizedGeometrySha256: crypto.createHash('sha256')
        .update(JSON.stringify(geometryBeforeZoom)).digest('hex'),
      zoomChangedWidth: true,
      normalizedGeometryStableAfterZoom: true,
      farPage,
      firstPageUnmountedAtFarPage: true,
      normalizedGeometryStableAfterRemount: true,
      readingPositionTarget: expectedReadingPosition
    };
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.pdf-native-page canvas')
      .waitFor({ state: 'attached', timeout: 45000 });
    await waitForNativeWorkspaceReady(page, readingPositionPage);
    await ensureOriginalView(page);
    await page.waitForFunction(expected => {
      const viewer = document.querySelector('#pdfNativeViewer');
      const pageNode = viewer?.querySelector(
        `.pdf-native-page[data-pdf-page-number="${expected.pageNumber}"]`
      );
      if (!pageNode?.classList.contains('is-rendered')) return false;
      const viewerRect = viewer.getBoundingClientRect();
      const pageRect = pageNode.getBoundingClientRect();
      const offset = Math.max(0, Math.min(1,
        (viewerRect.top - pageRect.top) / pageRect.height));
      return Number(document.querySelector('#pdfReaderPageNumber')?.value) === expected.pageNumber &&
        document.querySelector('#pdfReaderZoomValue')?.textContent === expected.zoomValue &&
        Math.abs(offset - expected.pageOffset) <= 0.03;
    }, expectedReadingPosition, { timeout: 20000 });
    report.metrics.manual.readingPositionRestoredAfterReload = await page.evaluate(pageNumber => {
      const viewer = document.querySelector('#pdfNativeViewer');
      const pageNode = viewer.querySelector(
        `.pdf-native-page[data-pdf-page-number="${pageNumber}"]`
      );
      const viewerRect = viewer.getBoundingClientRect();
      const pageRect = pageNode.getBoundingClientRect();
      return {
        pageNumber: Number(document.querySelector('#pdfReaderPageNumber')?.value) || 0,
        pageOffset: Number((Math.max(0, Math.min(1,
          (viewerRect.top - pageRect.top) / pageRect.height))).toFixed(4)),
        zoomValue: document.querySelector('#pdfReaderZoomValue')?.textContent || ''
      };
    }, readingPositionPage);
    await page.locator('#pdfReaderPageNumber').evaluate(node => {
      node.value = '1';
      node.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('.pdf-native-page[data-pdf-page-number="1"].is-rendered')
      .waitFor({ state: 'attached', timeout: 15000 });
    await waitForStableRenderedCanvas(page, 1, deviceScaleFactor);
    const restoredHit = page.locator(
      `.pdf-native-annotation-hit[data-annotation-id="${annotationId}"][title="${note}"]`
    ).first();
    await restoredHit.waitFor({ state: 'visible', timeout: 15000 });
    const geometryAfterReload = await normalizedAnnotationGeometry(restoredHit);
    assertSameNormalizedGeometry(geometryBeforeZoom, geometryAfterReload,
      'PDF_MOUSE_ANNOTATION_AFTER_RELOAD');
    report.metrics.manual.annotationRestoredAfterReload = true;
    report.metrics.manual.normalizedGeometryStableAfterReload = true;
    await page.screenshot({
      path: path.join(outputDirectory, 'manual-highlight-reloaded.png'), fullPage: false
    });
  }
  report.artifacts = screenshotNames.map(filename => ({
    filename, sha256: sha256File(path.join(outputDirectory, filename)),
    bytes: fs.statSync(path.join(outputDirectory, filename)).size
  }));
  report.checks = [
    'the supplied bytes loaded in an isolated copy of the complete extension',
    'the native PDF identity equals the SHA-256 of the supplied file',
    'a full page reload restores the same document identity and first-page canvas',
    'page one has a visible canvas, selectable text, and non-white rendered pixels',
    'canvas backing dimensions track CSS dimensions at a bounded device-pixel ratio',
    'the native caption inventory is bound to the same PDF document hash',
    'page-number input, Ctrl+F search, and next-match navigation use the native text projection',
    'the reading sidebar receives a non-empty snapshot bound to the same document hash',
    'startup produced no page, console, worker, API, or external-network errors'
  ];
  if (manualActions) report.checks.push(
    'a real mouse drag creates a one-page browser Selection and production highlight note',
    'the highlight keeps normalized PDF coordinates through zoom, far-page eviction, remount, and reload',
    'reload restores the same non-first page, within-page offset, and native zoom before annotation navigation'
  );
  if (verifyFigureOriginal) report.checks.push(
    'a current-generation PDF Figure request jumps to its active cross-page artwork page without an image overlay',
    'the same Figure without an active panel jumps to the first live artwork page without using cached page state'
  );
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = safeMessage(error?.stack || error?.message || error);
  if (page && !page.isClosed()) {
    report.metrics.failureState = await page.evaluate(() => ({
      bodyView: document.body.dataset.pdfView || '',
      viewerState: document.querySelector('#pdfNativeViewer')?.dataset?.state || '',
      controlState: document.querySelector('#pdfReaderControl')?.dataset?.state || '',
      readerErrorCode: document.documentElement.dataset.pdfErrorCode || '',
      nativeReady: document.documentElement.dataset.brevessNativePdfReady === 'true',
      workspaceReady: document.documentElement.dataset.pdfWorkspaceReady === 'true',
      workspaceIndexed: document.documentElement.dataset.pdfWorkspaceIndexed === 'true',
      nativePhase: String(globalThis.__brevessNativePdfDocument?.phase || ''),
      pageCount: Number(globalThis.__brevessNativePdfDocument?.pageCount) || 0,
      currentPageInput: Number(document.querySelector('#pdfReaderPageNumber')?.value) || 0,
      currentZoomValue: document.querySelector('#pdfReaderZoomValue')?.textContent || '',
      currentVisiblePage: (() => {
        const viewer = document.querySelector('#pdfNativeViewer');
        const viewerRect = viewer?.getBoundingClientRect();
        const pageNode = viewerRect ? [...viewer.querySelectorAll('.pdf-native-page')]
          .find(item => item.getBoundingClientRect().bottom > viewerRect.top + 1) : null;
        const pageRect = pageNode?.getBoundingClientRect();
        return {
          pageNumber: Number(pageNode?.dataset.pdfPageNumber) || 0,
          pageOffset: viewerRect && pageRect?.height ? Number((Math.max(0, Math.min(1,
            (viewerRect.top - pageRect.top) / pageRect.height))).toFixed(4)) : 0,
          viewerScrollTop: viewer?.scrollTop || 0
        };
      })(),
      storedReadingPosition: (() => {
        try {
          const hash = globalThis.__brevessNativePdfDocument?.structure?.documentHash || '';
          const value = JSON.parse(localStorage.getItem(`brevess-pdf-position:${hash}`) || 'null');
          return value ? {
            documentHash: String(value.documentHash || ''),
            pageNumber: Number(value.pageNumber) || 0,
            pageOffset: Number(value.pageOffset) || 0,
            scale: Number(value.scale) || 0
          } : null;
        } catch { return { invalid: true }; }
      })(),
      viewerScrollTrace: (globalThis.__pdfOriginalViewerScrollTrace || []).slice(-32).map(item => ({
        ...item,
        stack: String(item.stack || '').replace(/[A-Za-z]:\\[^\r\n]*/g, '[local-path]')
      })),
      firstPageAttached: Boolean(document.querySelector(
        '.pdf-native-page[data-pdf-page-number="1"] canvas')),
      nativeErrors: (globalThis.__pdfOriginalNativeErrors || []).map(item => ({
        message: String(item?.message || '').replace(/[A-Za-z]:\\[^\r\n]*/g, '[local-path]'),
        observedAt: Number(item?.observedAt) || 0
      })),
      selectionCharacterCount: String(getSelection() || '').normalize('NFKC').trim().length,
      manualToolbarPresent: Boolean(document.querySelector('#sci-manual-toolbar')),
      manualToolbarHidden: document.querySelector('#sci-manual-toolbar')?.hidden ?? null
      , manualSelectionValidation: (() => {
        if (typeof globalThis.describeCurrentManualSelection !== 'function') return null;
        try {
          const value = globalThis.describeCurrentManualSelection();
          return {
            valid: Boolean(value), code: String(value?.validation?.code || value?.code || ''),
            quoteLength: String(value?.quote || '').length,
            blockCount: Array.isArray(value?.blocks) ? value.blocks.length : 0,
            connectedBlockCount: Array.isArray(value?.blocks)
              ? value.blocks.filter(block => block?.element?.isConnected).length : 0,
            anchorQuoteLength: String(value?.pdfAnchor?.quote || '').length
          };
        } catch (failure) {
          return { error: String(failure?.message || failure).slice(0, 160) };
        }
      })()
    })).catch(() => ({}));
    const failureScreenshot = path.join(outputDirectory, 'original-reader-failure.png');
    await page.screenshot({ path: failureScreenshot, fullPage: false }).catch(() => undefined);
    if (fs.existsSync(failureScreenshot)) {
      report.artifacts.push({ filename: path.basename(failureScreenshot),
        sha256: sha256File(failureScreenshot), bytes: fs.statSync(failureScreenshot).size });
    }
    for (const filename of screenshotNames) {
      const artifact = path.join(outputDirectory, filename);
      if (fs.existsSync(artifact) && !report.artifacts.some(item => item.filename === filename)) {
        report.artifacts.push({ filename, sha256: sha256File(artifact),
          bytes: fs.statSync(artifact).size });
      }
    }
  }
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => undefined);
  writeReport(report);
  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  if (resolvedTemporaryRoot.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    fs.rmSync(resolvedTemporaryRoot, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  status: report.status,
  pageCount: report.metrics.pageCount || 0,
  phase: report.metrics.phase || '',
  pageErrors: report.diagnostics.pageErrors.length,
  consoleErrors: report.diagnostics.consoleErrors.length,
  workerErrors: report.diagnostics.workerErrors.length,
  apiRequests: report.network.apiRequests,
  externalRequests: report.network.externalRequests,
  error: report.error
}, null, 2));
