import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const extensionRoot = path.resolve(process.env.SCI_EXTENSION_ROOT || repositoryRoot);
const outputDirectory = path.resolve(process.env.SCI_SCENARIO_SELECTION_OUTPUT ||
  path.join(repositoryRoot, 'output', 'playwright', 'scenario-selection'));
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-scenario-selection-'));
const temporaryExtension = path.join(temporaryRoot, 'extension');
const profileDirectory = path.join(temporaryRoot, 'profile');
const fixtureUrl = 'https://example.org/brevess-scenario-selection-acceptance';
const forbiddenMessage = /ANALYZ|HIGHLIGHT_DOCUMENT|CALL_PROVIDER|TEST_PROVIDER|TEST_PROFILE/u;

const screenshots = [
  '01-initial-selection.png',
  '02-live-library-and-keyboard-switch-390.png',
  '03-toolbar-boundary-320.png',
  '04-historical-snapshot-320.png'
];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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
  fs.writeFileSync(path.join(temporaryExtension, 'scenario-selection-rpc.html'),
    '<!doctype html><meta charset="utf-8"><title>Scenario selection QA RPC</title>', 'utf8');
}

function fixtureHtml() {
  return `<!doctype html><html><head><meta charset="utf-8">
    <title>Brevess scenario selection acceptance</title>
    <link rel="canonical" href="${fixtureUrl}">
    <link rel="icon" href="data:,">
    <meta name="citation_doi" content="10.1000/brevess-scenario-selection">
    <style>
      body { margin: 24px; color: #18212a; background: #fff; font-family: Arial, sans-serif; }
      article { max-width: 1040px; margin: 0 auto; }
      p { margin: 24px 0; font-size: 18px; line-height: 1.8; }
    </style></head><body><main><article>
      <h1>Brevess scenario selection acceptance</h1>
      <section><h2>Background</h2><p id="selection-a">Established signaling programs coordinate immune adaptation, but the evidence boundary remains important when interpreting causal claims across biological systems.</p></section>
      <section><h2>Methods</h2><p id="selection-b">We used matched controls, orthogonal measurements, and a rescue experiment to distinguish necessary evidence from a merely correlated observation.</p></section>
      <section><h2>Results</h2><p id="selection-c">The intervention increased the measured response, while genetic rescue restored the phenotype and supported the stated interpretation.</p></section>
      <section><h2>Discussion</h2><p id="selection-d">Conflicting evidence and remaining uncertainty define the scope of the conclusion and motivate focused future experiments.</p></section>
    </article></main></body></html>`;
}

function toolbarSnapshot() {
  const toolbar = document.getElementById('sci-manual-toolbar');
  const select = toolbar?.querySelector('.sci-manual-mode-row select');
  return {
    visible: Boolean(toolbar?.checkVisibility()),
    modeId: select?.value || '',
    modeLabel: toolbar?.querySelector('.sci-manual-mode-row span')?.textContent?.trim() || '',
    activeTag: document.activeElement?.tagName || '',
    activeAriaLabel: document.activeElement?.getAttribute?.('aria-label') || '',
    categories: [...(toolbar?.querySelectorAll('.sci-manual-category') || [])].map(button => ({
      name: button.textContent?.trim() || '',
      color: button.style.getPropertyValue('--sci-category-color').trim()
    }))
  };
}

async function selectRange(page, selector, start = 0, end = 64) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.evaluate(({ selector: targetSelector, start: rawStart, end: rawEnd }) => {
    const target = document.querySelector(targetSelector);
    if (!target) throw new Error(`SELECTION_TARGET_MISSING:${targetSelector}`);
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      if (walker.currentNode.textContent) nodes.push(walker.currentNode);
    }
    const locate = rawOffset => {
      let remaining = Math.max(0, rawOffset);
      for (const node of nodes) {
        if (remaining <= node.textContent.length) return { node, offset: remaining };
        remaining -= node.textContent.length;
      }
      const node = nodes.at(-1);
      return { node, offset: node?.textContent.length || 0 };
    };
    const startPoint = locate(rawStart);
    const endPoint = locate(rawEnd);
    const range = document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }, { selector, start, end });
  await page.locator('#sci-manual-toolbar').waitFor({ state: 'visible', timeout: 3000 });
}

async function toolbarBounds(page) {
  return page.locator('#sci-manual-toolbar').evaluate(toolbar => {
    const rect = toolbar.getBoundingClientRect();
    const style = getComputedStyle(toolbar);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      width: rect.width, height: rect.height,
      scrollHeight: toolbar.scrollHeight,
      clientHeight: toolbar.clientHeight,
      overflowY: style.overflowY
    };
  });
}

function assertWithinViewport(bounds, label) {
  assert.ok(bounds.left >= 7, `${label} left boundary`);
  assert.ok(bounds.top >= 7, `${label} top boundary`);
  assert.ok(bounds.right <= bounds.viewport.width - 7, `${label} right boundary`);
  assert.ok(bounds.bottom <= bounds.viewport.height - 7, `${label} bottom boundary`);
}

async function rpc(extensionPage, report, message) {
  report.runtimeMessages.push(String(message?.type || ''));
  const response = await extensionPage.evaluate(
    async value => chrome.runtime.sendMessage(value), message
  );
  assert.equal(response?.success, true,
    `${message.type} failed: ${JSON.stringify(response?.error || {})}`);
  return response.data;
}

async function prepareContent(worker, tab, report) {
  report.runtimeMessages.push('prepareManualAnnotations');
  return worker.evaluate(async target => SciLLM.sendTabMessageWithRecovery(
    chrome,
    target.id,
    { action: 'prepareManualAnnotations' },
    { expectedUrl: target.url, contextKey: 'scenario-selection-acceptance' }
  ), tab);
}

fs.mkdirSync(outputDirectory, { recursive: true });
for (const file of [...screenshots, '01-mouse-selection-initial.png', 'report.json']) {
  fs.rmSync(path.join(outputDirectory, file), { force: true });
}
copyExtension();

const report = {
  status: 'FAIL',
  source: {
    contentSha256: sha256(fs.readFileSync(path.join(temporaryExtension, 'content.js'))),
    contentCssSha256: sha256(fs.readFileSync(path.join(temporaryExtension, 'content.css')))
  },
  isolation: {
    temporaryExtension: true,
    temporaryProfile: true,
    dailyBrowserUsed: false,
    nativeComputerUseUsed: false,
    providerCredentialsConfigured: false
  },
  runtimeMessages: [],
  blockedRequestUrls: [],
  apiRequests: 0,
  externalRequests: 0,
  selection: {},
  boundaries: {},
  checks: [],
  screenshots: []
};

let context;
try {
  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: 'msedge',
    headless: true,
    reducedMotion: 'reduce',
    viewport: { width: 1280, height: 820 },
    args: [
      `--disable-extensions-except=${temporaryExtension}`,
      `--load-extension=${temporaryExtension}`
    ]
  });
  const pageErrors = [];
  const workerErrors = [];
  context.on('serviceworker', worker => {
    worker.on('console', message => {
      if (message.type() === 'error') workerErrors.push(message.text());
    });
  });
  await context.route(/^https?:\/\//u, async route => {
    const url = route.request().url();
    if (url === fixtureUrl) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixtureHtml() });
      return;
    }
    if (url.startsWith('https://example.org/')) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    report.externalRequests += 1;
    report.blockedRequestUrls.push(url.slice(0, 500));
    if (/api\.|\/v\d+\/|responses|completions|generateContent/iu.test(url)) {
      report.apiRequests += 1;
    }
    await route.abort('blockedbyclient');
  });

  const worker = context.serviceWorkers()[0] ||
    await context.waitForEvent('serviceworker', { timeout: 15000 });
  worker.on('console', message => {
    if (message.type() === 'error') workerErrors.push(message.text());
  });
  const extensionId = new URL(worker.url()).host;
  const rpcPage = await context.newPage();
  rpcPage.on('pageerror', error => pageErrors.push(`rpc: ${error.message}`));
  await rpcPage.goto(`chrome-extension://${extensionId}/scenario-selection-rpc.html`, {
    waitUntil: 'domcontentloaded'
  });

  const initialModes = [
    { id: 'quick_story', name: '快速主线验收', description: '快速故事线', categoryIds: ['result', 'method'] },
    { id: 'critical_review', name: '批判审阅验收', description: '审阅证据', categoryIds: ['evidence', 'limitation'] },
    { id: 'review_synthesis', name: '综述综合验收', description: '综合证据', categoryIds: ['interpretation', 'future'] }
  ];
  await rpc(rpcPage, report, {
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { analysisModes: initialModes, readingViewId: 'quick_story', mode: 'regex' }
  });
  await rpc(rpcPage, report, {
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'result',
    override: { name: '现场结果证据', color: '#123456' }
  });

  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
  const tab = await worker.evaluate(async url =>
    (await chrome.tabs.query({})).find(item => item.url === url), fixtureUrl);
  assert.ok(tab?.id, 'fixture tab is available to the extension worker');
  const prepared = await prepareContent(worker, tab, report);
  assert.equal(prepared?.success, true);
  assert.ok(prepared.documentId);

  const mouseCoordinates = await page.locator('#selection-a').evaluate(paragraph => {
    const text = paragraph.firstChild;
    const characterRect = offset => {
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, Math.min(text.textContent.length, offset + 1));
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    return { start: characterRect(1), end: characterRect(34) };
  });
  let mouseSelectionFailure = '';
  try {
    await page.mouse.move(mouseCoordinates.start.x, mouseCoordinates.start.y);
    await page.mouse.down();
    await page.mouse.move(
      mouseCoordinates.end.x,
      mouseCoordinates.end.y,
      { steps: 14 }
    );
    await page.mouse.up();
    const mouseSelectedText = await page.evaluate(() =>
      document.getSelection()?.toString().trim() || '');
    report.selection.mouseSelectedCharacters = mouseSelectedText.length;
    if (mouseSelectedText.length > 3 &&
        await page.locator('#sci-manual-toolbar').count() === 0) {
      await page.evaluate(() => {
        document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      });
      report.selection.mouseEventSynchronization = true;
    }
    await page.locator('#sci-manual-toolbar').waitFor({ state: 'visible', timeout: 2000 });
    const selectedText = await page.evaluate(() => document.getSelection()?.toString() || '');
    assert.ok(selectedText.trim().length > 3);
    report.selection.initialMethod = report.selection.mouseEventSynchronization
      ? 'playwright-mouse-drag-with-selection-event-sync'
      : 'playwright-mouse-drag';
    report.selection.initialSelectedCharacters = selectedText.trim().length;
  } catch (error) {
    mouseSelectionFailure = String(error?.message || error).slice(0, 500);
    await selectRange(page, '#selection-a', 0, 72);
    report.selection.initialMethod = 'programmatic-range-fallback';
    report.selection.initialSelectedCharacters = await page.evaluate(() =>
      document.getSelection()?.toString().trim().length || 0);
  }
  report.selection.mouseSelectionFailure = mouseSelectionFailure;
  report.selection.repeatableChecksMethod = 'programmatic Selection/Range in the real page';

  const initialToolbar = await page.evaluate(toolbarSnapshot);
  assert.equal(initialToolbar.modeId, 'quick_story');
  assert.equal(initialToolbar.modeLabel, '阅读情境');
  assert.deepEqual(initialToolbar.categories.map(item => item.name), ['现场结果证据', '方法描述']);
  assert.equal(initialToolbar.categories[0].color, 'rgb(155, 170, 184)');
  await page.screenshot({
    path: path.join(outputDirectory, screenshots[0]), fullPage: false
  });
  report.screenshots.push(screenshots[0]);
  report.checks.push('real page selection opens the configured quick_story toolbar');
  report.checks.push('built-in result rename and color reach the toolbar');

  await page.getByRole('button', { name: '现场结果证据', exact: true }).click();
  await page.locator('.sci-manual-highlight').waitFor({ state: 'visible', timeout: 3000 });
  const createdAnnotationId = await page.locator('.sci-manual-highlight')
    .getAttribute('data-annotation-id');
  assert.ok(createdAnnotationId);
  const beforeDeletion = await rpc(rpcPage, report, {
    type: 'DOCUMENT_GET', documentId: prepared.documentId
  });
  const storedBeforeDeletion = beforeDeletion.record.annotations.find(
    item => item.annotationId === createdAnnotationId
  );
  assert.deepEqual(storedBeforeDeletion.categorySnapshot,
    { name: '现场结果证据', color: '#123456' });
  report.checks.push('manual annotation persists the effective category snapshot');

  await rpc(rpcPage, report, {
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'method',
    override: { name: '现场方法证据', color: '#0A7B83' }
  });
  await rpc(rpcPage, report, {
    type: 'CATEGORY_SAVE_OVERRIDE', categoryId: 'evidence',
    override: { name: '审阅证据', color: '#9A3412' }
  });
  const seed = await rpc(rpcPage, report, { type: 'CATEGORY_GET', categoryId: 'method' });
  await rpc(rpcPage, report, {
    type: 'LLM_SAVE_CUSTOM_CATEGORY',
    category: {
      ...seed.category,
      categoryId: 'custom_live_scenario',
      name: '即时自定义类别',
      definition: 'A deterministic custom category used only by isolated UI acceptance.',
      decisionQuestion: 'Does the selected text match the isolated acceptance category?',
      color: '#5B21B6',
      persistence: 'saved',
      builtIn: false
    }
  });
  const deleted = await rpc(rpcPage, report, { type: 'CATEGORY_DELETE', categoryId: 'result' });
  assert.equal(deleted.deleted, true);
  const finalModes = [
    { id: 'quick_story', name: '快速主线验收', description: '快速故事线', categoryIds: ['method', 'custom_live_scenario'] },
    { id: 'critical_review', name: '批判审阅验收', description: '审阅证据', categoryIds: ['evidence', 'custom_live_scenario'] },
    { id: 'review_synthesis', name: '综述综合验收', description: '综合证据', categoryIds: ['interpretation', 'future'] }
  ];
  await rpc(rpcPage, report, {
    type: 'LLM_UPDATE_PREFERENCES',
    preferences: { analysisModes: finalModes, readingViewId: 'quick_story' }
  });
  await page.waitForTimeout(250);

  await page.setViewportSize({ width: 390, height: 700 });
  await page.waitForTimeout(120);
  await selectRange(page, '#selection-b', 0, 76);
  const refreshedToolbar = await page.evaluate(toolbarSnapshot);
  assert.equal(refreshedToolbar.modeId, 'quick_story');
  assert.deepEqual(refreshedToolbar.categories.map(item => item.name),
    ['现场方法证据', '即时自定义类别']);
  assert.deepEqual(refreshedToolbar.categories.map(item => item.color),
    ['rgb(152, 200, 203)', 'rgb(186, 162, 224)']);
  assert.equal(refreshedToolbar.categories.some(item => item.name === '现场结果证据'), false);
  report.checks.push('reselection sees live rename, recolor, custom addition, and deletion');

  const modeSelect = page.locator('#sci-manual-toolbar .sci-manual-mode-row select');
  await modeSelect.focus();
  await modeSelect.press('ArrowDown');
  await page.waitForFunction(() =>
    document.querySelector('#sci-manual-toolbar .sci-manual-mode-row select')?.value ===
      'critical_review');
  const criticalToolbar = await page.evaluate(toolbarSnapshot);
  assert.equal(criticalToolbar.activeTag, 'SELECT');
  assert.equal(criticalToolbar.modeId, 'critical_review');
  assert.deepEqual(criticalToolbar.categories.map(item => item.name),
    ['审阅证据', '即时自定义类别']);
  await page.locator('#sci-manual-toolbar .sci-manual-mode-row select').press('ArrowDown');
  await page.waitForFunction(() =>
    document.querySelector('#sci-manual-toolbar .sci-manual-mode-row select')?.value ===
      'review_synthesis');
  const reviewToolbar = await page.evaluate(toolbarSnapshot);
  assert.equal(reviewToolbar.activeTag, 'SELECT');
  assert.deepEqual(reviewToolbar.categories.map(item => item.name), ['结果解释', '未来方向']);
  const bounds390 = await toolbarBounds(page);
  report.boundaries.width390 = bounds390;
  assertWithinViewport(bounds390, '390px toolbar');
  await page.screenshot({
    path: path.join(outputDirectory, screenshots[1]), fullPage: false
  });
  report.screenshots.push(screenshots[1]);
  report.checks.push('native keyboard ArrowDown switches scenarios and retains select focus');
  report.checks.push('390px toolbar remains inside the viewport');

  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(120);
  await selectRange(page, '#selection-c', 0, 82);
  const bounds320 = await toolbarBounds(page);
  report.boundaries.width320 = bounds320;
  await page.screenshot({
    path: path.join(outputDirectory, screenshots[2]), fullPage: false
  });
  report.screenshots.push(screenshots[2]);
  assertWithinViewport(bounds320, '320px toolbar');
  assert.equal(bounds320.overflowY, 'auto');
  report.checks.push('320px toolbar remains inside the viewport with bounded scrolling');

  await page.evaluate(() => {
    document.getSelection()?.removeAllRanges();
    document.getElementById('sci-manual-toolbar')?.remove();
  });
  await page.locator('.sci-manual-highlight').scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  await page.locator('.sci-manual-highlight').focus();
  await page.locator('.sci-manual-highlight').press('Enter');
  await page.locator('#sci-highlight-context-popover').waitFor({ state: 'visible' });
  const historicalUi = await page.evaluate(() => {
    const mark = document.querySelector('.sci-manual-highlight');
    const popover = document.getElementById('sci-highlight-context-popover');
    const historical = popover?.querySelector('.sci-context-manual select option:disabled');
    const rect = popover?.getBoundingClientRect();
    return {
      markCategoryId: mark?.dataset.categoryId || '',
      markCategoryName: mark?.dataset.categoryName || '',
      markCategoryColor: mark?.dataset.categoryColor || '',
      historicalOption: historical?.textContent?.trim() || '',
      historicalSelected: historical?.selected === true,
      bounds: rect ? {
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        viewportWidth: innerWidth, viewportHeight: innerHeight
      } : null
    };
  });
  assert.equal(historicalUi.markCategoryId, 'result');
  assert.equal(historicalUi.markCategoryName, '现场结果证据');
  assert.equal(historicalUi.markCategoryColor, '#123456');
  assert.equal(historicalUi.historicalOption, '现场结果证据（已停用）');
  assert.equal(historicalUi.historicalSelected, true);
  assert.ok(historicalUi.bounds.left >= 7 &&
    historicalUi.bounds.right <= historicalUi.bounds.viewportWidth - 7);
  assert.ok(historicalUi.bounds.top >= 7 &&
    historicalUi.bounds.bottom <= historicalUi.bounds.viewportHeight - 7);
  await page.screenshot({
    path: path.join(outputDirectory, screenshots[3]), fullPage: false
  });
  report.screenshots.push(screenshots[3]);

  const afterDeletion = await rpc(rpcPage, report, {
    type: 'DOCUMENT_GET', documentId: prepared.documentId
  });
  const storedAfterDeletion = afterDeletion.record.annotations.find(
    item => item.annotationId === createdAnnotationId
  );
  assert.equal(afterDeletion.record.annotations.length, 1);
  assert.deepEqual(storedAfterDeletion.categorySnapshot,
    { name: '现场结果证据', color: '#123456' });
  report.checks.push('deleting a category preserves its saved annotation and historical snapshot');

  const finalState = await rpc(rpcPage, report, { type: 'LLM_GET_SETTINGS' });
  assert.deepEqual(finalState.settings.analysisModes.map(mode => mode.id),
    ['quick_story', 'critical_review', 'review_synthesis']);
  assert.equal(finalState.availableCategories.some(item => item.categoryId === 'result'), false);
  assert.equal(finalState.availableCategories.some(item =>
    item.categoryId === 'custom_live_scenario' && item.name === '即时自定义类别'), true);
  assert.equal(report.runtimeMessages.some(type => forbiddenMessage.test(type)), false);
  assert.equal(report.apiRequests, 0);
  assert.equal(report.externalRequests, 0);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(workerErrors, []);
  report.checks.push('no provider task, API request, external request, or browser error occurred');
  report.history = historicalUi;
  report.pageErrors = pageErrors;
  report.workerErrors = workerErrors;
  report.status = 'PASS';
} catch (error) {
  report.error = String(error?.stack || error?.message || error);
  process.exitCode = 1;
} finally {
  await context?.close();
  fs.writeFileSync(path.join(outputDirectory, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const resolvedTemporary = path.resolve(temporaryRoot);
  if (resolvedTemporary.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(resolvedTemporary).startsWith('brevess-scenario-selection-')) {
    fs.rmSync(resolvedTemporary, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  status: report.status,
  checks: report.checks.length,
  apiRequests: report.apiRequests,
  externalRequests: report.externalRequests,
  selectionMethod: report.selection.initialMethod,
  outputDirectory,
  error: report.error
}));
