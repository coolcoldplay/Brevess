import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const root = path.resolve(process.env.SCI_EXTENSION_ROOT || repositoryRoot);
const output = path.resolve(process.env.SCI_AI_PROGRESS_OUTPUT_DIR ||
  path.join(repositoryRoot, 'output/playwright/ai-button-progress-20260909'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-ai-progress-'));
const extension = path.join(temporary, 'extension');
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

const report = {
  status: 'FAIL',
  scope: 'production DOM/functions with synthetic progress events; no model API',
  checks: [],
  screenshots: [],
  metrics: {},
  externalRequests: 0,
  modelApiCalls: 0
};
let context;
try {
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge',
    headless: true,
    reducedMotion: 'no-preference',
    viewport: { width: 520, height: 844 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route(/^https?:\/\//u, route => {
    report.externalRequests += 1;
    return route.abort('blockedbyclient');
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator('#sidePanelApp').waitFor();
  await page.waitForTimeout(350);

  await page.evaluate(() => {
    activePanelTabContext.activated = true;
    analysisMode = 'llm';
    regexApplyPending = true;
    prepareState = 'analyzing';
    highlightTaskState = {
      running: true, paused: false, cancelled: false,
      phase: 'paragraph_checkpoint', completed: 18, total: 40
    };
    updateApplyButton();

    const fixture = document.createElement('section');
    fixture.id = 'aiProgressVerifier';
    fixture.style.cssText = 'display:grid;gap:10px;margin:12px;padding:12px;border:1px solid #bfd5e1;border-radius:12px;background:#f7fbfd';
    const title = document.createElement('strong');
    title.textContent = 'AI 任务真实进度组件';
    fixture.appendChild(title);
    const review = document.createElement('button');
    review.id = 'generateReviewOutline';
    review.className = 'btn btn-primary';
    fixture.appendChild(review);
    const paper = createPaperMetaTaskButton('innovation', '提取创新点');
    fixture.appendChild(paper);
    const noteField = document.createElement('button');
    noteField.className = 'inline-settings-button is-running';
    noteField.dataset.generateLiteratureNoteField = 'aim';
    noteField.textContent = 'AI 生成中';
    fixture.appendChild(noteField);
    const host = document.querySelector('#highlightControls .container');
    if (!host) throw new Error('The merged highlighter fixture host is missing');
    host.appendChild(fixture);

    reviewOutlineState = {
      running: true, phase: 'review_map', completedParagraphs: 12,
      totalParagraphs: 20, completedChunks: 2, totalChunks: 4,
      message: '', hasOutline: false, globalSynthesisAvailable: null
    };
    updateReviewOutlineButton();
    paperMetaTaskState.innovation.running = true;
    paperMetaTaskState.innovation.phase = 'saving';
    paperMetaTaskState.innovation.changedFields = 3;
    updatePaperMetaTaskButtons('innovation');
    switchWorkspaceView('analysis');
  });
  await page.waitForTimeout(1250);
  const analysis = await page.evaluate(() => {
    const result = {};
    for (const id of ['applyHighlight', 'generateReviewOutline']) {
      const node = document.getElementById(id);
      const style = getComputedStyle(node);
      result[id] = {
        text: node.textContent.trim(),
        label: node.getAttribute('aria-label') || node.textContent.trim(),
        busy: node.getAttribute('aria-busy'),
        pending: node.classList.contains('is-llm-pending'),
        animationName: style.animationName,
        animationDuration: style.animationDuration,
        boxShadow: style.boxShadow
      };
    }
    const paper = document.querySelector('[data-paper-meta-task="innovation"]');
    result.paper = { text: paper.textContent.trim(), busy: paper.getAttribute('aria-busy') };
    const status = document.getElementById('highlightHeaderTaskStatus');
    result.taskStatus = { text: status?.textContent.trim() || '', visible: status?.checkVisibility() === true };
    result.cancelVisible = !document.getElementById('highlightTaskControls').hidden;
    result.overflow = document.documentElement.scrollWidth > innerWidth + 1;
    return result;
  });
  assert.equal(analysis.applyHighlight.text, '处理中');
  assert.equal(analysis.applyHighlight.label, '已保存正文段 18/40');
  assert.deepEqual(analysis.taskStatus, { text: '已保存正文段 18/40', visible: true });
  assert.equal(analysis.generateReviewOutline.text, '12/20 段');
  assert.equal(analysis.paper.text, '已取得 3 项，正在保存');
  assert.equal(analysis.cancelVisible, true);
  assert.equal(analysis.applyHighlight.animationName, 'workspace-soft-pulse');
  assert.equal(analysis.applyHighlight.animationDuration, '2.6s');
  assert.notEqual(analysis.applyHighlight.boxShadow, 'none');
  assert.equal(analysis.overflow, false);
  report.metrics.analysis520 = analysis;
  report.checks.push('520px uses production functions for paragraph, outline, and committed-field progress with cancel controls');
  const analysisShot = path.join(output, '01-ai-progress-analysis-520.png');
  await page.screenshot({ path: analysisShot });
  report.screenshots.push(analysisShot);

  await page.setViewportSize({ width: 320, height: 844 });
  await page.evaluate(() => {
    figureAnalysisState = {
      running: true, paused: false, phase: 'figure_model_processing',
      completedFigures: 1, totalFigures: 3, figureProgress: [
        { figureId: 'figure-1', completed: true, savedPanelCount: 5,
          validatedPanelCount: 5, unresolvedPanels: ['E'] },
        { figureId: 'figure-2', running: true, savedPanelCount: 4,
          validatedPanelCount: 5, unresolvedPanels: ['C', 'D'] }
      ]
    };
    switchWorkspaceView('figures');
    updateFigureButton();
  });
  await page.waitForTimeout(1250);
  const figures = await page.evaluate(() => {
    const button = document.getElementById('analyzeFiguresFromFigures');
    const style = getComputedStyle(button);
    return {
      text: button.textContent.trim(),
      label: button.getAttribute('aria-label') || button.textContent.trim(),
      taskStatus: document.getElementById('figureHeaderTaskStatus')?.textContent.trim() || '',
      taskStatusVisible: document.getElementById('figureHeaderTaskStatus')?.checkVisibility() === true,
      busy: button.getAttribute('aria-busy'),
      disabled: button.disabled,
      animationName: style.animationName,
      animationDuration: style.animationDuration,
      cancelVisible: !document.getElementById('figureTaskControls').hidden,
      overflow: document.documentElement.scrollWidth > innerWidth + 1
    };
  });
  assert.equal(figures.text, '处理中');
  assert.equal(figures.label, '1/3 图完成 · 已存 9 Panel · 可识别 6 · 已校验 10');
  assert.equal(figures.taskStatus, figures.label);
  assert.equal(figures.taskStatusVisible, true);
  assert.equal(figures.busy, 'true');
  assert.equal(figures.disabled, true);
  assert.equal(figures.cancelVisible, true);
  assert.equal(figures.animationName, 'workspace-soft-pulse');
  assert.equal(figures.animationDuration, '2.6s');
  assert.equal(figures.overflow, false);
  report.metrics.figures320 = figures;
  report.checks.push('320px Figure action shows completed/saved/identifiable checkpoint facts and retains cancel');
  const figureShot = path.join(output, '02-ai-progress-figures-320.png');
  await page.screenshot({ path: figureShot });
  report.screenshots.push(figureShot);

  await page.evaluate(() => {
    currentWorkspaceSnapshot = {
      ...(currentWorkspaceSnapshot || {}),
      url: 'fixture://article', revision: 1, paragraphs: [],
      chat: { turns: [], loading: true, error: '' }
    };
    articleChatSelectedProfileId = 'fixture-profile';
    switchWorkspaceView('chat');
    renderArticleChatSnapshot(currentWorkspaceSnapshot);
  });
  const chat = await page.locator('#sendArticleChat').evaluate(node => ({
    mode: node.dataset.mode,
    label: node.getAttribute('aria-label'),
    disabled: node.disabled,
    busy: node.getAttribute('aria-busy'),
    pending: node.classList.contains('is-llm-pending')
  }));
  assert.deepEqual(chat, {
    mode: 'cancel', label: '取消回答', disabled: false, busy: 'true', pending: true
  });
  report.metrics.chat320 = chat;
  report.checks.push('chat glow preserves the active cancel action');
  const chatShot = path.join(output, '03-ai-progress-chat-cancel-320.png');
  await page.screenshot({ path: chatShot });
  report.screenshots.push(chatShot);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    switchWorkspaceView('figures');
    updateFigureButton();
  });
  const reducedAnimation = await page.locator('#analyzeFiguresFromFigures')
    .evaluate(node => getComputedStyle(node).animationName);
  assert.equal(reducedAnimation, 'none');
  report.metrics.reducedMotionAnimation = reducedAnimation;
  report.checks.push('prefers-reduced-motion removes the edge animation while retaining progress text');
  const reducedShot = path.join(output, '04-ai-progress-reduced-motion-320.png');
  await page.screenshot({ path: reducedShot });
  report.screenshots.push(reducedShot);

  await page.evaluate(() => {
    regexApplyPending = false;
    prepareState = 'idle';
    highlightTaskState = {
      running: false, paused: false, cancelled: false,
      phase: '', completed: 0, total: 0
    };
    figureAnalysisState = {
      running: false, phase: 'completed', completedFigures: 3,
      totalFigures: 3, figureProgress: []
    };
    updateApplyButton();
    updateFigureButton();
  });
  const cleanup = await page.evaluate(() => ({
    applyPending: document.getElementById('applyHighlight').classList.contains('is-llm-pending'),
    applyBusy: document.getElementById('applyHighlight').getAttribute('aria-busy'),
    highlightControlsHidden: document.getElementById('highlightTaskControls').hidden,
    figurePending: document.getElementById('analyzeFiguresFromFigures')
      .classList.contains('is-llm-pending'),
    figureBusy: document.getElementById('analyzeFiguresFromFigures').getAttribute('aria-busy'),
    figureControlsHidden: document.getElementById('figureTaskControls').hidden,
    figureText: document.getElementById('analyzeFiguresFromFigures').textContent.trim(),
    figureLabel: document.getElementById('analyzeFiguresFromFigures').getAttribute('aria-label'),
    highlightStatusHidden: document.getElementById('highlightHeaderTaskStatus').hidden,
    figureStatusHidden: document.getElementById('figureHeaderTaskStatus').hidden
  }));
  assert.deepEqual(cleanup, {
    applyPending: false, applyBusy: 'false', highlightControlsHidden: true,
    figurePending: false, figureBusy: 'false', figureControlsHidden: true,
    figureText: '解图', figureLabel: '全部解图',
    highlightStatusHidden: true, figureStatusHidden: true
  });
  report.metrics.cleanup = cleanup;
  report.checks.push('terminal cleanup removes glow/busy state and hides both cancel groups');

  assert.deepEqual(pageErrors, []);
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
      path.basename(resolved).startsWith('brevess-ai-progress-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  status: report.status,
  checks: report.checks.length,
  screenshots: report.screenshots.length,
  externalRequests: report.externalRequests,
  modelApiCalls: report.modelApiCalls,
  error: report.error
}));
