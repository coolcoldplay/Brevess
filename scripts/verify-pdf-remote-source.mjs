import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const PUBLIC_PDF_URL =
  'https://cdn.elifesciences.org/articles/83176/elife-83176-v2.pdf';
export const PUBLIC_PDF_SHA256 =
  '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1';
export const PUBLIC_PDF_PAGE_COUNT = 23;

const repositoryRoot = path.resolve(import.meta.dirname, '..');

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '') : fallback;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeError(value) {
  return String(value?.stack || value?.message || value || '')
    .replace(/[A-Za-z]:\\[^\r\n]*/gu, '[local-path]')
    .slice(0, 500);
}

function normalizedRemoteUrl(value) {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

export function assessRemotePdfSource(observation = {}) {
  const checks = {
    sourceUrlExact: normalizedRemoteUrl(observation.sourceUrl) === PUBLIC_PDF_URL,
    sourceFetched: Number(observation.sourceFetchCount) >= 1,
    sourceStatusOk: Array.isArray(observation.sourceStatuses) &&
      observation.sourceStatuses.length >= 1 &&
      observation.sourceStatuses.every(status => Number(status) >= 200 && Number(status) < 300),
    sourceBytesExact: Array.isArray(observation.sourceByteLengths) &&
      observation.sourceByteLengths.length >= 1 &&
      observation.sourceByteLengths.every(bytes => Number(bytes) === Number(observation.pdfBytes) &&
        Number(bytes) > 0),
    sourceHashExact: Array.isArray(observation.sourceHashes) &&
      observation.sourceHashes.length >= 1 &&
      observation.sourceHashes.every(hash => hash === PUBLIC_PDF_SHA256),
    documentHashExact: observation.documentHash === PUBLIC_PDF_SHA256 &&
      observation.reloadDocumentHash === PUBLIC_PDF_SHA256,
    pageCountExact: observation.pageCount === PUBLIC_PDF_PAGE_COUNT &&
      observation.reloadPageCount === PUBLIC_PDF_PAGE_COUNT,
    originalReady: observation.viewerState === 'ready' &&
      observation.phase === 'text-ready' && observation.firstPageRendered === true &&
      Number(observation.firstPageNonWhitePixels) > 0,
    localTextIndexed: observation.workspaceReady === true &&
      observation.workspaceIndexed === true && Number(observation.paragraphCount) > 0 &&
      Number(observation.characterCount) > 0,
    sourceTitleApplied: /elife-83176-v2/iu.test(String(observation.title || '')) &&
      observation.reloadTitle === observation.title,
    externalLinkClickable: Number(observation.externalLinkCount) > 0 &&
      /^https?:\/\//iu.test(String(observation.externalLinkHref || '')) &&
      observation.externalClickTarget === observation.externalLinkHref,
    internalLinkJumped: Number(observation.internalLinkCount) > 0 &&
      Number(observation.internalTargetPage) > 1 &&
      observation.internalCurrentPage === observation.internalTargetPage,
    localStatePersisted: Number(observation.savedPage) > 1 &&
      observation.reloadCurrentPage === observation.savedPage &&
      Number(observation.savedScale) > 0 &&
      Math.abs(Number(observation.reloadScale) - Number(observation.savedScale)) <= 0.02 &&
      observation.savedPositionHash === PUBLIC_PDF_SHA256,
    sameUrlReloaded: observation.initialReaderUrl === observation.reloadReaderUrl &&
      String(observation.initialReaderUrl || '').includes(encodeURIComponent(PUBLIC_PDF_URL)),
    noModelApi: Number(observation.apiRequestCount) === 0,
    noUnexpectedNetwork: Number(observation.unexpectedHttpRequestCount) === 0,
    noRuntimeErrors: Number(observation.runtimeErrorCount) === 0
  };
  return { pass: Object.values(checks).every(Boolean), checks };
}

function copyExtension(extensionRoot, temporaryExtension) {
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

function writeReport(outputDirectory, report) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const target = path.join(outputDirectory, 'report.json');
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, target);
}

function addArtifact(report, outputDirectory, filename, kind) {
  const target = path.join(outputDirectory, filename);
  report.artifacts.push({
    kind,
    path: filename,
    bytes: fs.statSync(target).size,
    sha256: sha256(fs.readFileSync(target))
  });
}

async function waitForReader(page, options = {}) {
  const pageNumber = Number(options.pageNumber) || 1;
  await page.waitForFunction(({ hash, pages, pageNumber: expectedPage }) => {
    const native = globalThis.__brevessNativePdfDocument;
    const renderedPage = document.querySelector(
      `.pdf-native-page[data-pdf-page-number="${expectedPage}"].is-rendered`
    );
    return document.querySelector('#pdfNativeViewer')?.dataset?.state === 'ready' &&
      native?.structure?.documentHash === hash && native?.pageCount === pages &&
      native?.phase === 'text-ready' && native?.structure?.paragraphs?.length > 0 &&
      document.documentElement.dataset.pdfWorkspaceReady === 'true' &&
      document.documentElement.dataset.pdfWorkspaceIndexed === 'true' && renderedPage;
  }, { hash: PUBLIC_PDF_SHA256, pages: PUBLIC_PDF_PAGE_COUNT, pageNumber },
  { timeout: 120_000 });
  if (options.requireLinks === false) return;
  await page.waitForFunction(() => {
    const layer = document.querySelector(
      '.pdf-native-page[data-pdf-page-number="1"] .pdf-native-link-layer'
    );
    return layer?.querySelectorAll('a.pdf-native-link-hit').length > 0;
  }, null, { timeout: 30_000 });
}

async function sampleNonWhitePixels(page, pageNumber = 1) {
  return page.evaluate(number => {
    const canvas = document.querySelector(
      `.pdf-native-page[data-pdf-page-number="${number}"] canvas`
    );
    if (!canvas?.width || !canvas?.height) return 0;
    const pixels = canvas.getContext('2d', { willReadFrequently: true })
      ?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels) return 0;
    const stride = Math.max(4, Math.floor(Math.min(canvas.width, canvas.height) / 150));
    let count = 0;
    for (let y = 0; y < canvas.height; y += stride) {
      for (let x = 0; x < canvas.width; x += stride) {
        const offset = (y * canvas.width + x) * 4;
        if (pixels[offset + 3] > 0 &&
            (pixels[offset] < 245 || pixels[offset + 1] < 245 || pixels[offset + 2] < 245)) {
          count += 1;
        }
      }
    }
    return count;
  }, pageNumber);
}

async function readerSnapshot(page) {
  return page.evaluate(() => {
    const native = globalThis.__brevessNativePdfDocument;
    const structure = native?.structure;
    const canvas = document.querySelector(
      '.pdf-native-page[data-pdf-page-number="1"] canvas'
    );
    const external = document.querySelector(
      '.pdf-native-page[data-pdf-page-number="1"] a.pdf-native-link-hit[href^="http"]'
    );
    const internal = [...document.querySelectorAll(
      '.pdf-native-page[data-pdf-page-number="1"] a.pdf-native-link-hit[href^="#page="]'
    )].find(link => Number(new URL(link.href).hash.match(/page=(\d+)/u)?.[1]) > 1);
    const links = document.querySelectorAll(
      '.pdf-native-page[data-pdf-page-number="1"] a.pdf-native-link-hit'
    );
    return {
      title: String(document.title || ''),
      subtitle: String(document.querySelector('#pdfReaderSubtitle')?.textContent || ''),
      documentHash: String(structure?.documentHash || ''),
      pageCount: Number(native?.pageCount) || 0,
      phase: String(native?.phase || ''),
      paragraphCount: Array.isArray(structure?.paragraphs) ? structure.paragraphs.length : 0,
      characterCount: Number(structure?.diagnostics?.characterCount) || 0,
      workspaceReady: document.documentElement.dataset.pdfWorkspaceReady === 'true',
      workspaceIndexed: document.documentElement.dataset.pdfWorkspaceIndexed === 'true',
      viewerState: String(document.querySelector('#pdfNativeViewer')?.dataset?.state || ''),
      firstPageRendered: Boolean(canvas?.width && canvas?.height &&
        canvas.closest('.pdf-native-page')?.classList.contains('is-rendered')),
      currentPage: Number(document.querySelector('#pdfReaderPageNumber')?.value) || 0,
      scale: (Number.parseFloat(
        document.querySelector('#pdfReaderZoomValue')?.textContent || ''
      ) || 0) / 100,
      externalLinkCount: [...links].filter(link => /^https?:/iu.test(link.href)).length,
      internalLinkCount: [...links].filter(link => link.getAttribute('href')?.startsWith('#page=')).length,
      externalLinkHref: String(external?.href || ''),
      internalLinkHref: String(internal?.getAttribute('href') || '')
    };
  });
}

async function clickExternalWithoutBrowsing(page, href) {
  await page.evaluate(() => {
    globalThis.__brevessRemoteVerifierExternalTarget = '';
    document.addEventListener('click', event => {
      const link = event.target?.closest?.('a.pdf-native-link-hit[href^="http"]');
      if (!link) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      globalThis.__brevessRemoteVerifierExternalTarget = link.href;
    }, { capture: true, once: true });
  });
  await page.locator(`a.pdf-native-link-hit[href="${href.replaceAll('"', '\\"')}"]`).first().click();
  return page.evaluate(() => String(globalThis.__brevessRemoteVerifierExternalTarget || ''));
}

async function clickInternalLink(page, href) {
  const targetPage = Number(String(href).match(/page=(\d+)/u)?.[1]) || 0;
  assert.ok(targetPage > 1, 'REMOTE_PDF_INTERNAL_LINK_TARGET_MISSING');
  await page.locator(`a.pdf-native-link-hit[href="${href}"]`).first().click();
  await page.waitForFunction(number => {
    const input = Number(document.querySelector('#pdfReaderPageNumber')?.value) || 0;
    const pageNode = document.querySelector(
      `.pdf-native-page[data-pdf-page-number="${number}"].is-rendered`
    );
    return input === number && pageNode;
  }, targetPage, { timeout: 30_000 });
  return {
    targetPage,
    currentPage: await page.locator('#pdfReaderPageNumber').inputValue().then(Number)
  };
}

async function setReadingPosition(page, targetPage = 4) {
  const input = page.locator('#pdfReaderPageNumber');
  await input.fill(String(targetPage));
  await input.dispatchEvent('change');
  await page.waitForFunction(number => Boolean(document.querySelector(
    `.pdf-native-page[data-pdf-page-number="${number}"].is-rendered`
  )), targetPage, { timeout: 30_000 });
  const beforeScale = await page.evaluate(() =>
    (Number.parseFloat(document.querySelector('#pdfReaderZoomValue')?.textContent || '') || 0) / 100);
  await page.locator('#pdfReaderZoomIn').click();
  await page.waitForFunction(previous =>
    (Number.parseFloat(document.querySelector('#pdfReaderZoomValue')?.textContent || '') || 0) /
      100 > previous,
  beforeScale, { timeout: 10_000 });
  await page.waitForTimeout(350);
  return page.evaluate(number => {
    const native = globalThis.__brevessNativePdfDocument;
    const hash = String(native?.structure?.documentHash || '');
    const saved = JSON.parse(localStorage.getItem(`brevess-pdf-position:${hash}`) || 'null');
    return {
      page: Number(document.querySelector('#pdfReaderPageNumber')?.value) || number,
      scale: (Number.parseFloat(
        document.querySelector('#pdfReaderZoomValue')?.textContent || ''
      ) || 0) / 100,
      savedHash: String(saved?.documentHash || ''),
      savedPage: Number(saved?.pageNumber) || 0
    };
  }, targetPage);
}

export async function runRemotePdfSourceVerification(options = {}) {
  const extensionRoot = path.resolve(options.extensionRoot || repositoryRoot);
  const outputDirectory = path.resolve(options.outputDirectory ||
    path.join(repositoryRoot, 'output', 'playwright', 'pdf-remote-source'));
  const headed = options.headed === true;
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-remote-source-'));
  const temporaryExtension = path.join(temporaryRoot, 'extension');
  const profileDirectory = path.join(temporaryRoot, 'profile');
  const report = {
    status: 'RUNNING',
    runKind: 'real-public-remote-pdf-source-zero-api',
    realPdf: true,
    scope: {
      source: PUBLIC_PDF_URL,
      license: 'CC BY',
      evaluates: 'remote source URL, original PDF, local text index, PDF links, and reload state',
      excluded: 'LLM/provider calls, OCR, MinerU, parsed-layout accuracy, and external browsing'
    },
    isolation: {
      temporaryExtension: true,
      temporaryProfile: true,
      dailyBrowserUsed: false,
      modelApiUsed: false
    },
    source: {
      url: PUBLIC_PDF_URL,
      expectedSha256: PUBLIC_PDF_SHA256,
      expectedPageCount: PUBLIC_PDF_PAGE_COUNT
    },
    browser: { engine: 'msedge', headed },
    network: {
      sourceFetches: [],
      unexpectedHttpRequests: [],
      apiRequests: []
    },
    metrics: {},
    diagnostics: { pageErrors: [], consoleErrors: [], workerErrors: [] },
    artifacts: [],
    checks: {},
    error: null
  };
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const name of ['01-remote-original.png', '02-remote-reloaded.png', 'report.json']) {
    fs.rmSync(path.join(outputDirectory, name), { force: true });
  }
  writeReport(outputDirectory, report);

  let context;
  try {
    assert.ok(fs.existsSync(path.join(extensionRoot, 'manifest.json')),
      'REMOTE_PDF_EXTENSION_MANIFEST_MISSING');
    copyExtension(extensionRoot, temporaryExtension);
    report.source.extensionBuildSha256 = extensionBuildHash(temporaryExtension);

    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: 'msedge', headless: !headed, reducedMotion: 'reduce',
      viewport: { width: 1280, height: 1000 },
      args: [`--disable-extensions-except=${temporaryExtension}`,
        `--load-extension=${temporaryExtension}`]
    });
    await context.route(/^https?:\/\//u, async route => {
      const requestUrl = normalizedRemoteUrl(route.request().url());
      if (requestUrl === PUBLIC_PDF_URL) {
        const response = await route.fetch();
        const body = await response.body();
        report.network.sourceFetches.push({
          method: route.request().method(),
          status: response.status(),
          bytes: body.length,
          sha256: sha256(body)
        });
        await route.fulfill({ response, body });
        return;
      }
      const entry = { method: route.request().method(), url: route.request().url() };
      if (/(?:api\.|chat\/completions|responses|openai|anthropic|deepseek|generativelanguage|mineru)/iu
        .test(entry.url)) report.network.apiRequests.push(entry);
      else report.network.unexpectedHttpRequests.push(entry);
      await route.abort('blockedbyclient');
    });

    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    worker.on('console', message => {
      if (message.type() === 'error') report.diagnostics.workerErrors.push(safeError(message.text()));
    });
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    page.on('pageerror', error => report.diagnostics.pageErrors.push(safeError(error)));
    page.on('console', message => {
      if (message.type() === 'error') report.diagnostics.consoleErrors.push(safeError(message.text()));
    });

    const readerUrl = `chrome-extension://${extensionId}/pdf-reader.html?source=${
      encodeURIComponent(PUBLIC_PDF_URL)}`;
    await page.goto(readerUrl, { waitUntil: 'domcontentloaded' });
    await waitForReader(page);
    const initial = await readerSnapshot(page);
    initial.firstPageNonWhitePixels = await sampleNonWhitePixels(page, 1);
    await page.screenshot({
      path: path.join(outputDirectory, '01-remote-original.png'), fullPage: false
    });
    addArtifact(report, outputDirectory, '01-remote-original.png', 'browser-compositor-viewport');

    assert.ok(initial.externalLinkHref, 'REMOTE_PDF_EXTERNAL_LINK_MISSING');
    const externalClickTarget = await clickExternalWithoutBrowsing(page, initial.externalLinkHref);
    assert.ok(initial.internalLinkHref, 'REMOTE_PDF_INTERNAL_LINK_MISSING');
    const internal = await clickInternalLink(page, initial.internalLinkHref);
    const saved = await setReadingPosition(page, 4);
    assert.equal(saved.page, 4, 'REMOTE_PDF_READING_PAGE_NOT_SET');
    assert.equal(saved.savedPage, 4, 'REMOTE_PDF_READING_PAGE_NOT_PERSISTED');
    assert.equal(saved.savedHash, PUBLIC_PDF_SHA256, 'REMOTE_PDF_READING_HASH_NOT_PERSISTED');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForReader(page, { pageNumber: saved.page, requireLinks: false });
    await page.waitForFunction(({ targetPage, targetScale }) => {
      const currentPage = Number(document.querySelector('#pdfReaderPageNumber')?.value) || 0;
      const scale = (Number.parseFloat(
        document.querySelector('#pdfReaderZoomValue')?.textContent || ''
      ) || 0) / 100;
      return currentPage === targetPage && Math.abs(scale - targetScale) <= 0.02;
    }, { targetPage: saved.page, targetScale: saved.scale }, { timeout: 120_000 });
    const reload = await readerSnapshot(page);
    await page.screenshot({
      path: path.join(outputDirectory, '02-remote-reloaded.png'), fullPage: false
    });
    addArtifact(report, outputDirectory, '02-remote-reloaded.png', 'browser-compositor-viewport');

    const fetches = report.network.sourceFetches;
    const observation = {
      sourceUrl: PUBLIC_PDF_URL,
      sourceFetchCount: fetches.length,
      sourceStatuses: fetches.map(item => item.status),
      sourceByteLengths: fetches.map(item => item.bytes),
      sourceHashes: fetches.map(item => item.sha256),
      pdfBytes: fetches[0]?.bytes || 0,
      documentHash: initial.documentHash,
      reloadDocumentHash: reload.documentHash,
      pageCount: initial.pageCount,
      reloadPageCount: reload.pageCount,
      viewerState: initial.viewerState,
      phase: initial.phase,
      firstPageRendered: initial.firstPageRendered,
      firstPageNonWhitePixels: initial.firstPageNonWhitePixels,
      workspaceReady: initial.workspaceReady,
      workspaceIndexed: initial.workspaceIndexed,
      paragraphCount: initial.paragraphCount,
      characterCount: initial.characterCount,
      title: initial.title,
      reloadTitle: reload.title,
      externalLinkCount: initial.externalLinkCount,
      externalLinkHref: initial.externalLinkHref,
      externalClickTarget,
      internalLinkCount: initial.internalLinkCount,
      internalTargetPage: internal.targetPage,
      internalCurrentPage: internal.currentPage,
      savedPage: saved.page,
      reloadCurrentPage: reload.currentPage,
      savedScale: saved.scale,
      reloadScale: reload.scale,
      savedPositionHash: saved.savedHash,
      initialReaderUrl: readerUrl,
      reloadReaderUrl: page.url(),
      apiRequestCount: report.network.apiRequests.length,
      unexpectedHttpRequestCount: report.network.unexpectedHttpRequests.length,
      runtimeErrorCount: report.diagnostics.pageErrors.length +
        report.diagnostics.consoleErrors.length + report.diagnostics.workerErrors.length
    };
    const assessment = assessRemotePdfSource(observation);
    report.metrics = { initial, links: { externalClickTarget, internal }, saved, reload,
      observation };
    report.checks = assessment.checks;
    assert.equal(assessment.pass, true, `REMOTE_PDF_ACCEPTANCE_FAILED:${
      Object.entries(assessment.checks).filter(([, passed]) => !passed)
        .map(([name]) => name).join(',')}`);
    report.status = 'PASS';
    writeReport(outputDirectory, report);
    return report;
  } catch (error) {
    report.status = 'FAIL';
    report.error = safeError(error);
    writeReport(outputDirectory, report);
    throw error;
  } finally {
    await context?.close().catch(() => undefined);
    const expectedPrefix = path.resolve(os.tmpdir()) + path.sep;
    const resolvedTemporary = path.resolve(temporaryRoot);
    if (resolvedTemporary.startsWith(expectedPrefix)) {
      fs.rmSync(resolvedTemporary, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputDirectory = argument('--output', process.env.PDF_REMOTE_OUTPUT || '');
  const extensionRoot = argument('--extension', process.env.SCI_EXTENSION_ROOT || repositoryRoot);
  const headed = argument('--headed', process.env.HEADLESS === '0' ? '1' : '0') === '1';
  await runRemotePdfSourceVerification({
    extensionRoot,
    outputDirectory: outputDirectory || undefined,
    headed
  });
}
