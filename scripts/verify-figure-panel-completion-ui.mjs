// Local browser acceptance for Figure-level presentation after standalone Panel work.
// Uses a retained public Panel result and blocks every HTTP(S) request.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.SCI_EXTENSION_ROOT || path.join(scriptDirectory, '..'));
const retainedPanelPath = path.resolve(process.env.SCI_PANEL_RESULT || path.join(
  root, 'output/playwright/pdf-native-panel-vision-20260919-04/public-panel-result.json'
));
const output = path.resolve(process.env.SCI_QA_OUTPUT_DIR || path.join(
  root, 'output/playwright/figure-panel-completion-ui-20260919'
));
const popupPath = path.join(root, 'popup.js');
const popup = fs.readFileSync(popupPath, 'utf8');
const sourceStart = popup.indexOf('function completedStandaloneFigurePanelIds(');
const sourceEnd = popup.indexOf('\nfunction figureProgressUiSignature(', sourceStart);
assert.ok(sourceStart >= 0 && sourceEnd > sourceStart,
  'FIGURE_PANEL_COMPLETION_SOURCE_NOT_FOUND');
const productionSource = popup.slice(sourceStart, sourceEnd);
const retainedPanel = JSON.parse(fs.readFileSync(retainedPanelPath, 'utf8'));
const report = {
  scenario: 'retained standalone Panel completion rendered locally without provider access',
  validationBoundary: 'UI presentation only; no API call and no scientific revalidation',
  retainedInput: path.relative(root, retainedPanelPath).replaceAll('\\', '/'),
  sourceHashes: {
    'popup.js': crypto.createHash('sha256').update(popup).digest('hex'),
    [path.relative(root, retainedPanelPath).replaceAll('\\', '/')]:
      crypto.createHash('sha256').update(fs.readFileSync(retainedPanelPath)).digest('hex')
  },
  checks: [], blockedNetworkRequests: [], screenshots: [], status: 'FAIL'
};
let browser;

function check(name, value, details = undefined) {
  assert.ok(value, details === undefined ? name : `${name}: ${JSON.stringify(details)}`);
  report.checks.push(details === undefined ? { name, pass: true } : { name, pass: true, details });
  process.stdout.write(`PASS ${name}\n`);
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 560, height: 900 },
      reducedMotion: 'reduce' });
    await context.route(/^https?:\/\//u, route => {
      report.blockedNetworkRequests.push(route.request().url());
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
*{box-sizing:border-box}body{margin:0;padding:12px;color:#202a33;background:#eef3f7;font:13px system-ui,"Microsoft YaHei",sans-serif}
#boundary{margin:0 0 12px;padding:8px 10px;border:1px solid #bad4df;border-radius:9px;color:#315d73;background:#f7fbfd;font-size:11px;line-height:1.45}
#cases{display:grid;gap:10px}.case{padding:11px;border:1px solid #d4e2e8;border-radius:12px;background:#fff}.case h2{margin:0 0 7px;color:#123f59;font-size:13px}
.workspace-figure-progress{padding:8px;border:1px solid #c8dce6;border-radius:8px;background:#f7fbfd}.workspace-figure-progress.is-running{border-inline-start:4px solid #1f7897}.workspace-figure-progress.is-error{border-color:#e0b9b6;background:#fff8f7}
.workspace-figure-completion{display:flex;align-items:center;gap:7px}.workspace-figure-completion-check{display:grid;width:21px;height:21px;place-items:center;border-radius:50%;color:#fff;background:#278261;font-weight:800}.workspace-figure-progress p{margin:0;line-height:1.45}.case-note{margin:6px 0 0;color:#617180;font-size:10px}
</style></head><body><p id="boundary">本地 UI 验收：使用已保留的单 Panel 结果；未调用 API，也不构成新的科学验证。</p><main id="cases"></main></body></html>`);
    await page.addScriptTag({ content: `
function createWorkspaceElement(tag, className = '', text = '') {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text !== '') node.textContent = String(text); return node;
}
function formatFigureProgress(progress = {}) {
  const phase = String(progress.phase || '');
  return { phaseText: progress.failed ? 'Figure 解读失败' :
    phase === 'cancelled' ? '本批 Figure 解读已取消' : '正在处理 Figure',
    details: [], elapsedDetailIndex: -1 };
}
function normalizeFigureRecoveryPanelLabels(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(item => String(item || '').trim().toUpperCase())
    .filter(item => /^[A-Z0-9][A-Z0-9.+-]{0,7}$/.test(item)))];
}
${productionSource}
` });
    const measured = await page.evaluate(panel => {
      const substantiveFigure = { panelAnalyses: { D: panel } };
      const scenarios = [
        { id: 'single-panel', title: '单 Panel 已落地', figure: substantiveFigure,
          progress: { figureId: 'figure-1', completed: true, phase: 'figure', running: false,
            expectedPanels: ['D'], route: { taskType: 'figure_panel_interpretation' } } },
        { id: 'panel-followup', title: 'Panel 追问已完成',
          figure: { ...substantiveFigure, panelFollowups: { D: { answer: '已回答' } } },
          progress: { figureId: 'figure-1', completed: true, phase: 'figure', running: false,
            expectedPanels: ['D'], route: { taskType: 'figure_panel_followup' } } },
        { id: 'full-pending-save', title: '整图结果尚待持久化', figure: {},
          progress: { figureId: 'figure-1', completed: true, phase: 'figure', running: false,
            route: { taskType: 'figure_walkthrough' } } },
        { id: 'full-pending-with-old-panel', title: '已有旧 Panel 的整图仍待持久化',
          figure: substantiveFigure,
          progress: { figureId: 'figure-1', completed: true, phase: 'figure', running: false,
            route: { taskType: 'figure_walkthrough' } } },
        { id: 'checkpoint-pending-save', title: '显式等待保存', figure: substantiveFigure,
          progress: { figureId: 'figure-1', completed: true, phase: 'figure', running: false,
            checkpointStatus: 'pending_save', expectedPanels: ['D'],
            route: { taskType: 'figure_panel_interpretation' } } },
        { id: 'failed', title: '失败', figure: substantiveFigure,
          progress: { figureId: 'figure-1', failed: true, phase: 'failed', running: false,
            route: { taskType: 'figure_panel_interpretation' } } },
        { id: 'cancelled', title: '取消', figure: substantiveFigure,
          progress: { figureId: 'figure-1', phase: 'cancelled', running: false,
            route: { taskType: 'figure_panel_interpretation' } } },
        { id: 'restored', title: '重载后恢复的 Panel', figure: substantiveFigure, progress: null }
      ];
      const host = document.getElementById('cases');
      const results = [];
      for (const scenario of scenarios) {
        const card = document.createElement('section');
        card.className = 'case'; card.dataset.case = scenario.id;
        const status = figureWorkspaceResultStatus({
          figure: scenario.figure, progress: scenario.progress,
          progressDisplay: scenario.progress ? formatFigureProgress(scenario.progress) : null
        });
        card.append(createWorkspaceElement('h2', '', `${scenario.title} · ${status}`));
        if (scenario.progress) renderFigureProgress(
          card, scenario.progress, null, scenario.figure
        );
        card.append(createWorkspaceElement('p', 'case-note',
          scenario.id.includes('pending') ? '仍须等待持久化' : '本地呈现状态'));
        host.append(card);
        const progressBlock = card.querySelector('.workspace-figure-progress');
        results.push({
          id: scenario.id, status, text: card.textContent,
          running: progressBlock?.classList.contains('is-running') === true,
          complete: progressBlock?.classList.contains('is-complete') === true,
          error: progressBlock?.classList.contains('is-error') === true
        });
      }
      return results;
    }, retainedPanel);
    report.measurements = measured;
    const byId = id => measured.find(item => item.id === id);
    check('standalone Panel completion exits saving and reports one Panel',
      byId('single-panel').status === '已解读 1 个 Panel' &&
        !byId('single-panel').running && byId('single-panel').complete &&
        !byId('single-panel').text.includes('正在完成校验与保存'), byId('single-panel'));
    check('Panel follow-up completion leaves no residual saving state',
      byId('panel-followup').status === '已解读 1 个 Panel' &&
        !byId('panel-followup').running &&
        !byId('panel-followup').text.includes('正在完成校验与保存'), byId('panel-followup'));
    check('whole-Figure response without persisted content remains in saving state',
      byId('full-pending-save').status === '正在校验与保存' &&
        byId('full-pending-save').running &&
        byId('full-pending-save').text.includes('正在完成校验与保存'),
      byId('full-pending-save'));
    check('old landed Panel cannot hide a whole-Figure persistence wait',
      byId('full-pending-with-old-panel').status === '正在校验与保存' &&
        byId('full-pending-with-old-panel').running,
      byId('full-pending-with-old-panel'));
    check('explicit pending_save overrides landed Panel presentation',
      byId('checkpoint-pending-save').status === '正在校验与保存' &&
        byId('checkpoint-pending-save').running, byId('checkpoint-pending-save'));
    check('failure and cancellation keep terminal wording without fake saving',
      byId('failed').status === '解读失败' && byId('failed').error &&
        byId('failed').text.includes('Figure 解读失败') &&
        byId('cancelled').status === '待解读' &&
        byId('cancelled').text.includes('本批 Figure 解读已取消') &&
        !byId('failed').text.includes('正在完成校验与保存') &&
        !byId('cancelled').text.includes('正在完成校验与保存'),
      { failed: byId('failed'), cancelled: byId('cancelled') });
    check('restored standalone Panel remains distinguishable from whole-Figure completion',
      byId('restored').status === '已解读 1 个 Panel' &&
        !byId('restored').text.includes('整图'), byId('restored'));
    report.pageErrors = pageErrors;
    check('local browser rendering raised no page errors', pageErrors.length === 0, pageErrors);
    check('local browser rendering made no HTTP or provider request',
      report.blockedNetworkRequests.length === 0, report.blockedNetworkRequests);
    const screenshot = path.join(output, 'figure-panel-completion-560.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    report.screenshots.push(path.relative(root, screenshot).replaceAll('\\', '/'));
    report.status = 'PASS';
    await context.close();
  } catch (error) {
    report.error = error?.stack || String(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({ status: report.status,
    report: path.join(output, 'report.json'), error: report.error || '' })}\n`);
}

await run();
