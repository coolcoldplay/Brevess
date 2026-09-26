import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const pdfPath = path.join(repositoryRoot, 'tmp', 'public-pdf-acceptance', 'elife-83176-v2.pdf');
const outputDirectory = path.join(repositoryRoot, 'output', 'playwright', 'selection-toolbar-ux-f2');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-selection-toolbar-'));
const temporaryExtension = path.join(temporaryRoot, 'extension');
const profileDirectory = path.join(temporaryRoot, 'profile');
const fixtureUrl = 'https://example.org/brevess-selection-toolbar-f2';
const longCategoryName = '主要研究结果与重复验证证据边界（长类别名称）';
const viewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 768 },
  { width: 720, height: 900 }
];

function sha256File(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function copyExtension() {
  fs.mkdirSync(temporaryExtension, { recursive: true });
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(repositoryRoot, directory), path.join(temporaryExtension, directory), {
      recursive: true
    });
  }
  for (const file of fs.readdirSync(repositoryRoot)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(repositoryRoot, file), path.join(temporaryExtension, file));
    }
  }
  fs.writeFileSync(path.join(temporaryExtension, 'selection-toolbar-rpc.html'),
    '<!doctype html><meta charset="utf-8"><title>Selection toolbar F2 RPC</title>', 'utf8');
}

function fixtureHtml() {
  return `<!doctype html><html><head><meta charset="utf-8">
    <title>Selection toolbar HTML comparison</title>
    <link rel="canonical" href="${fixtureUrl}">
    <link rel="icon" href="data:,">
    <meta name="citation_doi" content="10.1000/selection-toolbar-f2">
    <style>
      body { margin: 0; color: #192d3d; background: #f4f7f9; font-family: Georgia, serif; }
      main { width: min(860px, calc(100% - 40px)); margin: 0 auto; padding: 56px 0 180px; }
      article { padding: clamp(24px, 5vw, 58px); background: white; box-shadow: 0 8px 32px #1e40551a; }
      h1 { line-height: 1.2; }
      p { margin: 26px 0; font-size: 18px; line-height: 1.85; }
    </style></head><body><main><article>
      <h1>Selection toolbar HTML comparison</h1>
      <h2>Results</h2>
      <p id="html-selection">Neuronal activity changed microglial process dynamics while matched controls and repeated measurements constrained the evidence boundary. The same selection toolbar must remain compact in ordinary HTML and native PDF reading.</p>
      <p>Independent observations provide surrounding readable context above and below the selected evidence without becoming part of the toolbar fixture.</p>
    </article></main></body></html>`;
}

async function rpc(page, type, extra = {}) {
  const response = await page.evaluate(async message => chrome.runtime.sendMessage(message), {
    type, ...extra
  });
  assert.equal(response?.success, true,
    `${type} failed: ${JSON.stringify(response?.error || {})}`);
  return response.data;
}

async function prepareHtml(worker, page) {
  const tab = await worker.evaluate(async url =>
    (await chrome.tabs.query({})).find(item => item.url === url), fixtureUrl);
  assert.ok(tab?.id, 'HTML fixture tab is available');
  const response = await worker.evaluate(async target => SciLLM.sendTabMessageWithRecovery(
    chrome,
    target.id,
    { action: 'prepareManualAnnotations' },
    { expectedUrl: target.url, contextKey: 'selection-toolbar-f2' }
  ), tab);
  assert.equal(response?.success, true,
    `prepareManualAnnotations failed: ${JSON.stringify(response?.error || {})}`);
}

async function clearSelectionToolbar(page) {
  await page.evaluate(() => {
    document.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
  });
  await page.waitForFunction(() => !document.getElementById('sci-manual-toolbar'), null, {
    timeout: 3000
  }).catch(() => undefined);
}

async function selectHtmlWithMouse(page) {
  await clearSelectionToolbar(page);
  const points = await page.locator('#html-selection').evaluate(paragraph => {
    const text = paragraph.firstChild;
    const point = offset => {
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, Math.min(text.length, offset + 1));
      const rect = range.getBoundingClientRect();
      return { x: rect.left + Math.max(1, rect.width / 2), y: rect.top + rect.height / 2 };
    };
    return { start: point(1), end: point(31) };
  });
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 16 });
  await page.mouse.up();
  await page.locator('#sci-manual-toolbar').waitFor({ state: 'visible', timeout: 5000 });
}

async function selectPdfWithMouse(page) {
  await clearSelectionToolbar(page);
  await page.evaluate(() => globalThis.__brevessPdfReaderBridge?.command?.('focusPage', 1));
  const firstPage = page.locator('.pdf-native-page[data-pdf-page-number="1"]');
  await firstPage.waitFor({ state: 'visible', timeout: 15000 });
  await firstPage.scrollIntoViewIfNeeded();
  const spans = page.locator(
    '.pdf-native-page[data-pdf-page-number="1"] .pdf-native-text-layer span'
  );
  await page.waitForFunction(() => Array.from(document.querySelectorAll(
    '.pdf-native-page[data-pdf-page-number="1"] .pdf-native-text-layer span'
  )).some(node => {
    const rect = node.getBoundingClientRect();
    return String(node.textContent || '').trim().length >= 22 &&
      rect.width >= 70 && rect.height >= 6 && rect.bottom > 0 && rect.top < innerHeight;
  }), null, { timeout: 15000 });
  const box = await spans.evaluateAll(nodes => {
    const target = nodes.find(node => {
      const rect = node.getBoundingClientRect();
      return String(node.textContent || '').trim().length >= 22 &&
        rect.width >= 70 && rect.height >= 6 && rect.bottom > 0 && rect.top < innerHeight;
    });
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  assert.ok(box?.width > 20 && box?.height > 5, 'PDF target has visible geometry');
  const startX = box.x + 2;
  const endX = box.x + Math.min(box.width - 2, Math.max(24, box.width * .68));
  const centerY = box.y + box.height / 2;
  await page.mouse.move(startX, centerY);
  await page.mouse.down();
  await page.mouse.move(endX, centerY, { steps: 16 });
  await page.mouse.up();
  await page.locator('#sci-manual-toolbar').waitFor({ state: 'visible', timeout: 10000 });
}

async function measureToolbar(page, surface) {
  return page.locator('#sci-manual-toolbar').evaluate((toolbar, sourceSurface) => {
    const rect = toolbar.getBoundingClientRect();
    const selection = getSelection();
    const selectionRect = selection?.rangeCount
      ? selection.getRangeAt(0).getBoundingClientRect() : null;
    const intersection = selectionRect ? Math.max(0,
      Math.min(rect.right, selectionRect.right) - Math.max(rect.left, selectionRect.left)) *
      Math.max(0,
        Math.min(rect.bottom, selectionRect.bottom) - Math.max(rect.top, selectionRect.top)) : 0;
    const primary = toolbar.querySelector('.sci-manual-primary-row');
    const secondary = toolbar.querySelector('.sci-manual-secondary-row');
    const rule = toolbar.querySelector('.sci-manual-rule-row');
    const longCategory = [...toolbar.querySelectorAll('.sci-manual-category')]
      .find(button => button.textContent.includes('长类别名称'));
    const activeStyle = document.activeElement ? getComputedStyle(document.activeElement) : null;
    const toolbarStyle = getComputedStyle(toolbar);
    return {
      surface: sourceSurface,
      viewport: { width: innerWidth, height: innerHeight },
      bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: rect.width, height: rect.height },
      obstructionArea: rect.width * rect.height,
      obstructionRatio: (rect.width * rect.height) / (innerWidth * innerHeight),
      selectionIntersectionArea: intersection,
      toolbarOverflow: { x: toolbarStyle.overflowX, y: toolbarStyle.overflowY,
        scrollWidth: toolbar.scrollWidth, clientWidth: toolbar.clientWidth,
        scrollHeight: toolbar.scrollHeight, clientHeight: toolbar.clientHeight },
      primary: primary ? { overflowX: getComputedStyle(primary).overflowX,
        scrollWidth: primary.scrollWidth, clientWidth: primary.clientWidth,
        count: primary.querySelectorAll('button').length } : null,
      secondary: secondary ? { overflowX: getComputedStyle(secondary).overflowX,
        scrollWidth: secondary.scrollWidth, clientWidth: secondary.clientWidth,
        labels: [...secondary.querySelectorAll('button')].map(button => button.textContent.trim()) } : null,
      ruleWidth: rule?.getBoundingClientRect().width || 0,
      longCategory: longCategory ? {
        text: longCategory.textContent.trim(),
        width: longCategory.getBoundingClientRect().width,
        height: longCategory.getBoundingClientRect().height,
        maxWidth: getComputedStyle(longCategory).maxWidth,
        whiteSpace: getComputedStyle(longCategory).whiteSpace,
        overflowWrap: getComputedStyle(longCategory).overflowWrap
      } : null,
      selectedCharacters: String(selection || '').normalize('NFKC').trim().length,
      activeTag: document.activeElement?.tagName || '',
      activeOutlineWidth: activeStyle?.outlineWidth || '',
      reducedMotion: {
        animationDuration: getComputedStyle(toolbar).animationDuration,
        transitionDuration: toolbar.querySelector('button')
          ? getComputedStyle(toolbar.querySelector('button')).transitionDuration : ''
      },
      documentOverflow: document.documentElement.scrollWidth > innerWidth
    };
  }, surface);
}

function assertToolbar(metrics) {
  const { bounds, viewport } = metrics;
  assert.ok(bounds.left >= 7 && bounds.top >= 7, `${metrics.surface} toolbar starts in viewport`);
  assert.ok(bounds.right <= viewport.width - 7 && bounds.bottom <= viewport.height - 7,
    `${metrics.surface} toolbar ends in viewport`);
  assert.ok(metrics.obstructionRatio <= .2,
    `${metrics.surface} toolbar obstruction ratio ${metrics.obstructionRatio}`);
  assert.equal(metrics.selectionIntersectionArea, 0,
    `${metrics.surface} toolbar must not cover selected text`);
  assert.ok(metrics.selectedCharacters > 3, `${metrics.surface} retains real selection`);
  assert.equal(metrics.toolbarOverflow.x, 'hidden');
  assert.equal(metrics.toolbarOverflow.y, 'auto');
  assert.ok(metrics.toolbarOverflow.scrollWidth <= metrics.toolbarOverflow.clientWidth + 6,
    'outer scroll width may include the visible 3px focus ring, but no content overflow');
  assert.equal(metrics.primary?.overflowX, 'auto');
  assert.equal(metrics.secondary?.overflowX, 'auto');
  assert.ok(metrics.primary?.count > 0);
  assert.ok(metrics.primary?.scrollWidth > metrics.primary?.clientWidth,
    `${metrics.surface} long category row keeps overflow local and scrollable`);
  assert.ok(metrics.secondary?.labels.length > 0);
  assert.ok(metrics.ruleWidth <= metrics.toolbarOverflow.clientWidth + 1);
  assert.equal(metrics.longCategory?.maxWidth, '190px');
  assert.equal(metrics.longCategory?.whiteSpace, 'normal');
  assert.equal(metrics.longCategory?.overflowWrap, 'anywhere');
  assert.ok(['BUTTON', 'SELECT'].includes(metrics.activeTag));
  assert.equal(metrics.activeOutlineWidth, '3px');
  assert.ok(parseFloat(metrics.reducedMotion.transitionDuration) <= .000001);
  assert.equal(metrics.documentOverflow, false);
}

fs.mkdirSync(outputDirectory, { recursive: true });
copyExtension();
const report = {
  status: 'RUNNING',
  scope: 'Current-source real mouse selection toolbar layout only; no semantic-boundary or OCR claim.',
  source: {
    contentCssSha256: sha256File(path.join(temporaryExtension, 'content.css')),
    contentJsSha256: sha256File(path.join(temporaryExtension, 'content.js')),
    pdfSha256: sha256File(pdfPath)
  },
  isolation: { temporaryExtension: true, temporaryProfile: true,
    dailyBrowserUsed: false, computerUseUsed: false },
  network: { apiRequests: 0, externalRequests: 0, blocked: [] },
  diagnostics: { pageErrors: [], consoleErrors: [] },
  measurements: [],
  screenshots: [],
  limitations: [
    'CSS verification does not establish semantic selection boundaries or remove page-header text.',
    'No OCR or model request is made; configured selection actions are inspected but not executed.',
    'The HTML comparison uses a controlled real extension-injected fixture, not a live publisher page.'
  ]
};

let context;
try {
  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: 'msedge', headless: true, reducedMotion: 'reduce',
    viewport: viewports[0],
    args: [`--disable-extensions-except=${temporaryExtension}`,
      `--load-extension=${temporaryExtension}`]
  });
  context.on('request', request => {
    const url = request.url();
    if (!/^https?:\/\//u.test(url) || url === fixtureUrl || url.startsWith('https://example.org/')) return;
    report.network.externalRequests += 1;
    report.network.blocked.push(url.slice(0, 300));
    if (/api\.|responses|completions|generateContent|mineru/iu.test(url)) {
      report.network.apiRequests += 1;
    }
  });
  await context.route(/^https?:\/\//u, async route => {
    const url = route.request().url();
    if (url === fixtureUrl) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
        body: fixtureHtml() });
      return;
    }
    if (url.startsWith('https://example.org/')) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.abort('blockedbyclient');
  });

  const worker = context.serviceWorkers()[0] ||
    await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  const rpcPage = await context.newPage();
  rpcPage.on('pageerror', error => report.diagnostics.pageErrors.push(`rpc: ${error.message}`));
  await rpcPage.goto(`chrome-extension://${extensionId}/selection-toolbar-rpc.html`, {
    waitUntil: 'domcontentloaded'
  });
  await rpc(rpcPage, 'CATEGORY_SAVE_OVERRIDE', { categoryId: 'result',
    override: { name: longCategoryName, color: '#0C6597' } });

  const htmlPage = await context.newPage();
  htmlPage.on('pageerror', error => report.diagnostics.pageErrors.push(`html: ${error.message}`));
  htmlPage.on('console', message => {
    if (message.type() === 'error') report.diagnostics.consoleErrors.push(`html: ${message.text()}`);
  });
  await htmlPage.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
  await prepareHtml(worker, htmlPage);
  for (const viewport of viewports) {
    await htmlPage.setViewportSize(viewport);
    await selectHtmlWithMouse(htmlPage);
    const metrics = await measureToolbar(htmlPage, 'html');
    report.measurements.push(metrics);
    assertToolbar(metrics);
    const filename = `html-${viewport.width}x${viewport.height}.png`;
    await htmlPage.screenshot({ path: path.join(outputDirectory, filename), fullPage: false });
    report.screenshots.push(filename);
  }

  const pdfPage = await context.newPage();
  pdfPage.on('pageerror', error => report.diagnostics.pageErrors.push(`pdf: ${error.message}`));
  pdfPage.on('console', message => {
    if (message.type() === 'error') report.diagnostics.consoleErrors.push(`pdf: ${message.text()}`);
  });
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf-reader.html`, {
    waitUntil: 'domcontentloaded'
  });
  await pdfPage.locator('#pdfLocalFile').setInputFiles(pdfPath);
  await pdfPage.waitForFunction(() =>
    document.getElementById('pdfNativeViewer')?.dataset.state === 'ready' &&
    ['text-ready', 'partial-index'].includes(globalThis.__brevessNativePdfDocument?.phase),
  null, { timeout: 60000 });
  for (const viewport of viewports) {
    await pdfPage.setViewportSize(viewport);
    await pdfPage.evaluate(() => globalThis.__brevessPdfReaderBridge?.command?.('fitWidth'));
    await pdfPage.waitForTimeout(300);
    await selectPdfWithMouse(pdfPage);
    const metrics = await measureToolbar(pdfPage, 'pdf');
    report.measurements.push(metrics);
    assertToolbar(metrics);
    const filename = `pdf-${viewport.width}x${viewport.height}.png`;
    await pdfPage.screenshot({ path: path.join(outputDirectory, filename), fullPage: false });
    report.screenshots.push(filename);
  }

  const htmlActions = report.measurements.find(item => item.surface === 'html')?.secondary.labels || [];
  const pdfActions = report.measurements.find(item => item.surface === 'pdf')?.secondary.labels || [];
  assert.deepEqual(pdfActions, htmlActions, 'HTML and PDF expose the same selection actions');
  assert.ok(htmlActions.some(label => label.includes('翻译')));
  assert.ok(htmlActions.some(label => label.includes('释义')));
  assert.ok(htmlActions.some(label => label.includes('备注')));
  assert.ok(htmlActions.some(label => label.includes('缩略词')));
  assert.equal(report.network.apiRequests, 0);
  assert.equal(report.network.externalRequests, 0);
  assert.deepEqual(report.diagnostics.pageErrors, []);
  assert.deepEqual(report.diagnostics.consoleErrors, []);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => undefined);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: report.status,
    measurements: report.measurements.map(item => ({ surface: item.surface,
      viewport: item.viewport, obstructionRatio: item.obstructionRatio,
      selectionIntersectionArea: item.selectionIntersectionArea,
      documentOverflow: item.documentOverflow })), network: report.network,
    error: report.error || '' }, null, 2)}\n`);
}
