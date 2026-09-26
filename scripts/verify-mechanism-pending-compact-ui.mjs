// Local rendering acceptance for the retained public pending-mechanism result.
// This verifier blocks HTTP(S) and does not validate or call any model API.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.SCI_EXTENSION_ROOT || path.join(scriptDirectory, '..'));
const retainedResultPath = path.resolve(process.env.SCI_PENDING_PREVIEW_RESULT || path.join(
  root, 'output/playwright/pdf-figure-mechanism-deepseek-text-20260919-04',
  'public-mechanism-result.json'
));
const output = path.resolve(process.env.SCI_QA_OUTPUT_DIR || path.join(
  root, 'output/playwright/pdf-mechanism-compact-ui-20260919'
));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-mechanism-compact-ui-'));
const extension = path.join(temporary, 'extension');
const profile = path.join(temporary, 'profile');
const widths = [380, 560, 900];
const report = {
  scenario: 'retained public pending mechanism result rendered locally at 380/560/900px',
  validationBoundary: 'local rendering only; no new provider or API validation',
  retainedInput: path.relative(root, retainedResultPath).replaceAll('\\', '/'),
  status: 'FAIL', checks: [], screenshots: [], sourceHashes: {}, blockedNetworkRequests: []
};
let context;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function check(name, value, details = undefined) {
  assert.ok(value, details === undefined ? name : `${name}: ${JSON.stringify(details)}`);
  report.checks.push(details === undefined ? { name, pass: true } : { name, pass: true, details });
  process.stdout.write(`PASS ${name}\n`);
}

function prepareFixture() {
  fs.mkdirSync(path.join(extension, 'core'), { recursive: true });
  fs.mkdirSync(path.join(extension, 'vendor', 'mermaid'), { recursive: true });
  for (const relative of [
    'core/evidence-first-mechanism.js', 'core/figure-workspace.js',
    'core/mechanism-network.js', 'core/mechanism-pending-preview.js',
    'vendor/mermaid/mermaid.min.js', 'popup.css'
  ]) {
    const source = path.join(root, relative);
    const target = path.join(extension, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    report.sourceHashes[relative] = sha256(source);
  }
  report.sourceHashes['popup.js'] = sha256(path.join(root, 'popup.js'));
  report.sourceHashes[report.retainedInput] = sha256(retainedResultPath);
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'Brevess compact pending preview QA', version: '1.0.0',
    background: { service_worker: 'fixture-worker.js' },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
    }
  }));
  fs.writeFileSync(path.join(extension, 'fixture-worker.js'), '// fixture worker\n');
  fs.writeFileSync(path.join(extension, 'fixture.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Pending compact UI QA</title>
<link rel="stylesheet" href="popup.css">
<style>
html,body{width:100%;min-width:0}body{padding:10px;background:#eef3f7}
#local-boundary{margin:0 0 10px;padding:8px 10px;border:1px solid #bad4df;border-radius:9px;color:#315d73;background:#f7fbfd;font-size:11px;line-height:1.45}
#host{width:100%;min-width:0}.mechanism-pending-preview{padding:0}
</style></head><body>
<p id="local-boundary">本地渲染验收：使用已保留的 public-mechanism-result.json；未调用 API，也不构成新的科学验证。</p>
<main id="host"></main>
<script src="core/evidence-first-mechanism.js"></script>
<script src="core/figure-workspace.js"></script>
<script src="core/mechanism-network.js"></script>
<script src="vendor/mermaid/mermaid.min.js"></script>
<script src="core/mechanism-pending-preview.js"></script>
</body></html>`);
}

async function inspect(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(80);
  return page.evaluate(viewportWidth => {
    const section = document.querySelector('.mechanism-pending-preview');
    const table = section.querySelector('.mechanism-pending-preview-table');
    const rows = [...table.querySelectorAll('tbody tr')];
    const sourceButtons = [...section.querySelectorAll('[data-mechanism-source-panel]')];
    const disconnected = section.querySelector('.mechanism-pending-preview-nodes');
    const unresolved = section.querySelector('.mechanism-pending-preview-nonrelation-details');
    disconnected.open = true;
    unresolved.open = true;
    const viewportRight = document.documentElement.clientWidth;
    const rowMetrics = rows.map(row => {
      const rect = row.getBoundingClientRect();
      const cells = [...row.cells].map(cell => ({
        label: cell.dataset.label || '', height: cell.getBoundingClientRect().height,
        right: cell.getBoundingClientRect().right, text: cell.textContent.trim().slice(0, 160)
      }));
      return { height: rect.height, right: rect.right, cells };
    });
    return {
      width: viewportWidth,
      status: section.dataset.previewStatus,
      heading: section.querySelector('header h3')?.textContent || '',
      graphHelp: section.querySelector('.workspace-mechanism-mermaid-section p')?.textContent || '',
      svgNodeCount: section.querySelectorAll('.mechanism-pending-preview-diagram svg g.node').length,
      svgEdgeCount: section.querySelectorAll(
        '.mechanism-pending-preview-diagram svg path.flowchart-link, ' +
        '.mechanism-pending-preview-diagram svg g.edgePath'
      ).length,
      relationRows: rows.length,
      sourceButtonCount: sourceButtons.length,
      sourceButtonLabels: sourceButtons.map(button => button.getAttribute('aria-label')),
      sourceButtonsFocusable: sourceButtons.every(button => button.tabIndex >= 0 && !button.disabled),
      disconnectedCount: disconnected.querySelectorAll('li').length,
      unresolvedCount: unresolved.querySelectorAll('li').length,
      disconnectedLabel: disconnected.querySelector('summary')?.textContent || '',
      unresolvedLabel: unresolved.querySelector('summary')?.textContent || '',
      tableDisplay: getComputedStyle(table).display,
      tbodyDisplay: getComputedStyle(table.tBodies[0]).display,
      horizontalOverflow: document.documentElement.scrollWidth - viewportRight,
      tableOverflow: table.parentElement.scrollWidth - table.parentElement.clientWidth,
      rowMetrics,
      boundary: document.getElementById('local-boundary')?.textContent || ''
    };
  }, width);
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  prepareFixture();
  const retained = JSON.parse(fs.readFileSync(retainedResultPath, 'utf8'));
  const preview = retained?.evidenceFirstMechanism;
  check('retained artifact contains the actual needs_review pending preview',
    preview?.status === 'needs_review' && preview.nodes?.length === 20 &&
      preview.relations?.length === 3 && preview.panelDispositions?.length === 33,
    { status: preview?.status, nodes: preview?.nodes?.length,
      relations: preview?.relations?.length, panels: preview?.panelDispositions?.length });
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'msedge', headless: true, reducedMotion: 'reduce',
      viewport: { width: 900, height: 900 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    await context.route(/^https?:\/\//u, route => {
      report.blockedNetworkRequests.push(route.request().url());
      return route.abort('blockedbyclient');
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/fixture.html`, {
      waitUntil: 'domcontentloaded'
    });
    await page.evaluate(async value => {
      const section = await SciLLM.renderMechanismPendingPreview(value, {
        mermaid, mount: document.getElementById('host')
      });
      if (!section) throw new Error('PENDING_PREVIEW_DID_NOT_RENDER');
    }, preview);

    const measurements = [];
    for (const width of widths) {
      const measurement = await inspect(page, width);
      measurements.push(measurement);
      const screenshotPath = path.join(output, `pending-compact-${width}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      report.screenshots.push(path.relative(root, screenshotPath).replaceAll('\\', '/'));
    }
    report.measurements = measurements;
    const first = measurements[0];
    check('connected relation component renders before disconnected node evidence',
      first.svgNodeCount === 5 && first.svgEdgeCount >= 3 && first.disconnectedCount === 15 &&
        /15/u.test(first.disconnectedLabel), first);
    check('all retained relation and non-relation evidence remains available',
      measurements.every(item => item.relationRows === 3 && item.unresolvedCount === 40 &&
        /40/u.test(item.unresolvedLabel)), measurements.map(item => ({
        width: item.width, relations: item.relationRows, unresolved: item.unresolvedCount
      })));
    check('narrow widths use labeled cards without horizontal document or table search',
      measurements.filter(item => item.width < 720).every(item =>
        item.tbodyDisplay === 'block' && item.horizontalOverflow <= 1 && item.tableOverflow <= 1 &&
        item.rowMetrics.every(row => row.cells.every(cell => cell.label && cell.right <= item.width + 1))),
      measurements.slice(0, 2));
    check('wide width retains the semantic table',
      measurements[2].tableDisplay === 'table' && measurements[2].tbodyDisplay === 'table-row-group',
      measurements[2]);
    check('every relation exposes a focusable supporting Panel source action',
      measurements.every(item => item.sourceButtonCount === 3 && item.sourceButtonsFocusable &&
        item.sourceButtonLabels.every(Boolean)), measurements.map(item => ({
        width: item.width, buttons: item.sourceButtonCount, labels: item.sourceButtonLabels
      })));
    check('retained status and saved-network boundary remain explicit',
      measurements.every(item => item.status === 'needs_review' &&
        item.heading.includes('尚未替换已保存机制网络') &&
        item.boundary.includes('本地渲染验收') && item.boundary.includes('未调用 API')), measurements);
    report.pageErrors = pageErrors;
    check('local rendering raised no page errors', pageErrors.length === 0, pageErrors);
    check('local rendering contacted no HTTP or provider endpoint',
      report.blockedNetworkRequests.length === 0, report.blockedNetworkRequests);
    report.status = 'PASS';
  } catch (error) {
    report.error = error?.stack || String(error);
    process.exitCode = 1;
  } finally {
    await context?.close();
    fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    const resolved = path.resolve(temporary);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(resolved).startsWith('brevess-mechanism-compact-ui-')) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
  process.stdout.write(`${JSON.stringify({ status: report.status,
    report: path.join(output, 'report.json'), error: report.error || '' })}\n`);
}

await run();
