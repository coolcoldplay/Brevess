import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const root = path.resolve(process.env.SCI_EXTENSION_ROOT || repositoryRoot);
const output = path.resolve(process.env.SCI_FRONTEND_OUTPUT_DIR ||
  path.join(repositoryRoot, 'output/playwright/frontend-fd3-20260906/layout'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-frontend-fd3-'));
const extension = path.join(temporary, 'extension');
const replayArchive = JSON.parse(fs.readFileSync(path.join(
  repositoryRoot, 'output/playwright/frontend-audit-20260906/mechanism-flow/',
  'mechanism-archive-needs-review-redacted.json'
), 'utf8'));
const pendingFixture = replayArchive.workspace?.figureWorkspace?.crossFigureLogic
  ?.pendingResult?.evidenceFirstMechanism;
assert.equal(pendingFixture?.status, 'needs_review');
fs.mkdirSync(extension);
fs.mkdirSync(output, { recursive: true });

for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
  fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
}
for (const file of fs.readdirSync(root)) {
  if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
    fs.copyFileSync(path.join(root, file), path.join(extension, file));
  }
}

const report = { status: 'FAIL', checks: [], screenshots: [], externalRequests: 0 };
let context;
try {
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, reducedMotion: 'reduce',
    viewport: { width: 720, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route(/^https?:\/\//u, route => {
    report.externalRequests += 1;
    return route.abort('blockedbyclient');
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator('#sidePanelApp').waitFor();
  await page.waitForTimeout(1400);

  await page.evaluate(async fixture => {
    activePanelTabContext.activated = true;
    switchWorkspaceView('mechanism');
    const issues = document.getElementById('mechanismChainIssues');
    const host = document.getElementById('mechanismChainList');
    issues.replaceChildren();
    host.replaceChildren();
    const section = await SciLLM.renderMechanismPendingPreview(fixture, {
      mermaid: globalThis.mermaid, mount: issues
    });
    prepareMechanismPendingPreviewNavigation(section, {
      localWorkspace: { canonicalUrl: 'https://example.test/fd3', contentHash: 'fd3' }
    });
    document.body.style.zoom = '200%';
  }, pendingFixture);

  const nav = page.locator('#mechanismSectionNavigation');
  await nav.waitFor({ state: 'visible' });
  assert.equal(await nav.locator('button:not([hidden])').count(), 3);
  assert.equal(await nav.locator('[data-mechanism-region^="saved-"]:not([hidden])').count(), 0);
  for (const [region, target] of [
    ['pending-graph', 'mechanismPendingGraphRegion'],
    ['pending-evidence', 'mechanismPendingEvidenceRegion'],
    ['pending-unresolved', 'mechanismPendingUnresolvedRegion']
  ]) {
    await page.evaluate(() => { activePanelTabContext.activated = true; });
    await nav.locator(`[data-mechanism-region="${region}"]`).click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), target);
  }
  report.checks.push('formal pending-only DOM offers direct candidate graph evidence and unresolved jumps');
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const view = document.querySelector('.workspace-view[data-workspace-view="mechanism"]');
    if (view) view.scrollTop = 0;
  });
  const pendingOnlyScreenshot = path.join(output, 'mechanism-pending-only-200-percent.png');
  await page.screenshot({ path: pendingOnlyScreenshot });
  report.screenshots.push(pendingOnlyScreenshot);

  await page.evaluate(() => {
    const host = document.getElementById('mechanismChainList');
    const graph = document.createElement('section');
    graph.id = 'mechanismGraphRegion';
    graph.tabIndex = -1;
    const evidence = document.createElement('section');
    evidence.id = 'mechanismEvidenceRegion';
    evidence.tabIndex = -1;
    host.append(graph, evidence);
    refreshMechanismSectionNavigation();
  });
  assert.equal(await nav.locator('button:not([hidden])').count(), 5);
  report.checks.push('saved-chain plus pending-candidate state exposes all five accurate destinations');

  await page.evaluate(() => { activePanelTabContext.activated = true; });
  await nav.locator('[data-mechanism-region="pending-graph"]').click();
  const controls = page.locator('[data-mechanism-pending-view-controls]');
  await controls.locator('[data-mechanism-view-mode="actual-size"]').click();
  const pendingDiagram = page.locator('#mechanismPendingGraphRegion .workspace-mechanism-mermaid');
  await pendingDiagram.evaluate(node => node.scrollTo(300, 240));
  await controls.locator('[data-mechanism-view-reset]').click();
  await page.waitForFunction(() => {
    const node = document.querySelector('#mechanismPendingGraphRegion .workspace-mechanism-mermaid');
    return node?.scrollLeft === 0 && node?.scrollTop === 0;
  });
  const graphState = await pendingDiagram.evaluate(node => ({
    mode: node.dataset.viewMode,
    left: node.scrollLeft,
    top: node.scrollTop,
    height: node.getBoundingClientRect().height,
    overflowY: getComputedStyle(node).overflowY
  }));
  assert.equal(graphState.mode, 'fit-width');
  assert.equal(graphState.left, 0);
  assert.equal(graphState.top, 0);
  assert.equal(graphState.overflowY, 'auto');
  assert.ok(graphState.height <= 1042, `200% graph height ${graphState.height}`);
  report.graphState = graphState;
  report.checks.push('reset view restores fit-width and graph origin inside a bounded viewport');

  const zoomMetrics = await page.evaluate(() => ({
    zoom: getComputedStyle(document.body).zoom,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    promise: document.querySelector('#mechanismPendingRegion')?.innerText || ''
  }));
  assert.equal(zoomMetrics.zoom, '2');
  assert.equal(zoomMetrics.overflow, false);
  assert.match(zoomMetrics.promise, /尚未替换已保存机制网络/u);
  report.checks.push('200% zoom has no page-level horizontal overflow and preserves pending-preview promise');

  await page.evaluate(() => SciLLM.setInterfaceLanguage('en'));
  assert.equal(await nav.locator('[data-mechanism-region="pending-graph"]').innerText(), 'Candidate graph');
  assert.equal(await controls.locator('[data-mechanism-view-reset]').innerText(), 'Reset view');
  report.checks.push('mechanism navigation and restore control switch to English');

  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const view = document.querySelector('.workspace-view[data-workspace-view="mechanism"]');
    if (view) view.scrollTop = 0;
  });
  const screenshot = path.join(output, 'mechanism-direct-navigation-200-percent.png');
  await page.screenshot({ path: screenshot });
  report.screenshots.push(screenshot);
  assert.deepEqual(errors, []);

  const pdfPage = await context.newPage();
  const pdfErrors = [];
  pdfPage.on('pageerror', error => pdfErrors.push(error.message));
  await pdfPage.setViewportSize({ width: 1080, height: 800 });
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf-reader.html`, {
    waitUntil: 'domcontentloaded'
  });
  await pdfPage.locator('#pdfReaderControl').waitFor({ state: 'visible' });
  await pdfPage.waitForTimeout(400);
  const pdfMetrics = await pdfPage.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    status: document.getElementById('pdfReaderStatusTitle')?.innerText || ''
  }));
  assert.equal(pdfMetrics.horizontalOverflow, false);
  report.pdfBaseline = { ...pdfMetrics, pageErrors: pdfErrors };
  assert.deepEqual(pdfErrors, [], 'PDF reader must initialize without missing runtime dependencies');
  assert.equal(await pdfPage.evaluate(() => typeof SciLLM.createFigureWorkspaceDraft), 'function');
  const pdfScreenshot = path.join(output, 'pdf-reader-current-baseline.png');
  await pdfPage.screenshot({ path: pdfScreenshot, fullPage: false });
  report.screenshots.push(pdfScreenshot);
  report.checks.push('independent PDF reader baseline captured without horizontal overflow');
  await pdfPage.close();
  assert.equal(report.externalRequests, 0);
  report.status = 'PASS';
} catch (error) {
  report.error = error.stack || error.message;
  process.exitCode = 1;
} finally {
  await context?.close();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const resolved = path.resolve(temporary);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(resolved).startsWith('brevess-frontend-fd3-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  status: report.status, checks: report.checks.length,
  externalRequests: report.externalRequests, error: report.error
}));
