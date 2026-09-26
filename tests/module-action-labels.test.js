const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const popup = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');

function source(name, optional = false) {
  const start = popup.search(new RegExp(`^function ${name}\\(`, 'm'));
  if (optional && start < 0) return '';
  assert.ok(start >= 0, name);
  const rest = popup.slice(start);
  const end = rest.slice(1).search(/\n(?:async )?function \w+\(/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}
function element(marked = false) {
  const attributes = new Map();
  const classes = new Set();
  return {
    dataset: marked ? { moduleAction: '' } : {},
    textContent: '', disabled: false, hidden: false, title: '',
    classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains: name => classes.has(name) },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name); },
    removeAttribute(name) { attributes.delete(name); if (name === 'title') this.title = ''; }
  };
}
function fixture(marked = true) {
  const elements = Object.fromEntries([
    'applyHighlight', 'analyzeFiguresFromFigures', 'highlightHeaderTaskStatus',
    'figureHeaderTaskStatus', 'highlightTaskControls', 'pauseHighlightAnalysis',
    'cancelHighlightAnalysis', 'figureTaskControls', 'pauseFigureAnalysis', 'cancelFigureAnalysis'
  ].map(id => [id, element(marked && ['applyHighlight', 'analyzeFiguresFromFigures'].includes(id))]));
  const context = {
    document: { getElementById: id => elements[id] || null },
    analysisMode: 'regex', regexApplyPending: false, prepareState: 'prepared',
    selectedCategories: new Set(['result']), llmSelectedCategories: new Set(['result']),
    llmSettingsState: { effectiveMode: 'llm' },
    preparedDocumentState: { documentHash: 'doc', fullTextAnalyzed: false },
    preferenceMutationCoordinator: { isPending: () => false },
    highlightTaskState: { running: false, paused: false, cancelled: false },
    figureAnalysisState: { running: false, paused: false },
    crossFigureLogicRunning: false,
    mechanismGenerationUiController: { presentation: () => ({ completed: 2, total: 5 }) },
    hasUsableLlm: () => true,
    hasRunningFigureProgress: status => status.running === true,
    figureButtonProgressLabel: () => '1/3 图完成 · 已存 4 Panel · 可识别 3',
    llmUnavailableMessage: () => '请先配置可用模型和正文许可'
  };
  vm.runInNewContext([
    source('setModuleActionLabel', true), source('highlightButtonProgressLabel'),
    source('updateHighlightTaskControls'), source('updateFigureTaskControls'),
    source('updateApplyButton'), source('updateFigureButton')
  ].join('\n'), context);
  return { context, elements };
}

test('tagged highlight action is compact with full accessible action text', () => {
  const { context, elements: e } = fixture();
  context.updateApplyButton();
  assert.equal(e.applyHighlight.textContent, '高亮');
  assert.equal(e.applyHighlight.getAttribute('aria-label'), '应用高亮');
  assert.equal(e.applyHighlight.title, '应用高亮');
  assert.equal(e.applyHighlight.disabled, false);
  assert.equal(e.highlightHeaderTaskStatus.hidden, true);
});

test('highlight checkpoint counts remain visible in the body while header is compact', () => {
  const { context, elements: e } = fixture();
  context.analysisMode = 'llm';
  context.regexApplyPending = true;
  context.highlightTaskState = { running: true, phase: 'paragraph_checkpoint', completed: 18, total: 40 };
  context.updateApplyButton();
  assert.equal(e.applyHighlight.textContent, '处理中');
  assert.equal(e.applyHighlight.getAttribute('aria-label'), '已保存正文段 18/40');
  assert.equal(e.applyHighlight.title, '已保存正文段 18/40');
  assert.equal(e.applyHighlight.disabled, true);
  assert.equal(e.applyHighlight.getAttribute('aria-busy'), 'true');
  assert.equal(e.highlightHeaderTaskStatus.textContent, '已保存正文段 18/40');
  assert.equal(e.highlightHeaderTaskStatus.hidden, false);
  assert.equal(e.highlightTaskControls.hidden, false);
  assert.equal(e.pauseHighlightAnalysis.disabled, false);
  assert.equal(e.cancelHighlightAnalysis.disabled, false);
});

test('API setup action keeps its original enabled CTA behavior', () => {
  const { context, elements: e } = fixture();
  context.analysisMode = 'llm';
  context.llmSettingsState.effectiveMode = 'regex';
  context.updateApplyButton();
  assert.equal(e.applyHighlight.textContent, '设置');
  assert.equal(e.applyHighlight.title, '先配置 API');
  assert.equal(e.applyHighlight.dataset.settingsCta, 'true');
  assert.equal(e.applyHighlight.disabled, false);
});

test('preparing label is compact without changing disabled or busy semantics', () => {
  const { context, elements: e } = fixture();
  context.analysisMode = 'llm';
  context.prepareState = 'preparing';
  context.updateApplyButton();
  assert.equal(e.applyHighlight.textContent, '准备中');
  assert.equal(e.applyHighlight.getAttribute('aria-label'), '正在准备正文');
  assert.equal(e.applyHighlight.disabled, true);
  assert.equal(e.applyHighlight.getAttribute('aria-busy'), 'false');
});

test('busy-to-idle transition clears the previous visible task status', () => {
  const { context, elements: e } = fixture();
  context.analysisMode = 'llm';
  context.regexApplyPending = true;
  context.highlightTaskState.running = true;
  context.updateApplyButton();
  context.regexApplyPending = false;
  context.highlightTaskState.running = false;
  context.updateApplyButton();
  assert.equal(e.highlightHeaderTaskStatus.hidden, true);
  assert.equal(e.highlightHeaderTaskStatus.textContent, '');
  assert.equal(e.applyHighlight.textContent, '高亮');
  assert.equal(e.applyHighlight.getAttribute('aria-label'), '分析全文');
});

test('unmarked highlight actions keep existing full-text presentation', () => {
  const { context, elements: e } = fixture(false);
  context.analysisMode = 'llm';
  context.regexApplyPending = true;
  context.highlightTaskState = { running: true, phase: 'paragraph_checkpoint', completed: 18, total: 40 };
  context.updateApplyButton();
  assert.equal(e.applyHighlight.textContent, '已保存正文段 18/40');
  assert.equal(e.applyHighlight.getAttribute('aria-label'), undefined);
});

test('tagged idle Figure action retains its full action name and readiness hint', () => {
  const { context, elements: e } = fixture();
  context.updateFigureButton();
  assert.equal(e.analyzeFiguresFromFigures.textContent, '解图');
  assert.equal(e.analyzeFiguresFromFigures.getAttribute('aria-label'), '全部解图');
  assert.match(e.analyzeFiguresFromFigures.title, /全部 Figure|全部解图/);
  assert.equal(e.figureHeaderTaskStatus.hidden, true);
});

test('running Figure action preserves checkpoint counts and reachable pause/cancel controls', () => {
  const { context, elements: e } = fixture();
  context.figureAnalysisState.running = true;
  context.updateFigureButton();
  assert.equal(e.analyzeFiguresFromFigures.textContent, '处理中');
  assert.equal(e.analyzeFiguresFromFigures.disabled, true);
  assert.equal(e.analyzeFiguresFromFigures.getAttribute('aria-busy'), 'true');
  assert.equal(e.figureHeaderTaskStatus.textContent, '1/3 图完成 · 已存 4 Panel · 可识别 3');
  assert.equal(e.figureHeaderTaskStatus.hidden, false);
  assert.equal(e.figureTaskControls.hidden, false);
  assert.equal(e.pauseFigureAnalysis.disabled, false);
  assert.equal(e.cancelFigureAnalysis.disabled, false);
});

test('Figure pause state preserves the resume label and original command controls', () => {
  const { context, elements: e } = fixture();
  context.figureAnalysisState = { running: true, paused: true };
  context.updateFigureButton();
  assert.equal(e.pauseFigureAnalysis.textContent, '继续图解');
  assert.equal(e.pauseFigureAnalysis.disabled, false);
  assert.equal(e.cancelFigureAnalysis.disabled, false);
  assert.equal(e.figureHeaderTaskStatus.hidden, false);
});

test('mechanism generation progress remains complete outside the compact Figure button', () => {
  const { context, elements: e } = fixture();
  context.crossFigureLogicRunning = true;
  context.updateFigureButton();
  assert.equal(e.analyzeFiguresFromFigures.textContent, '处理中');
  assert.equal(e.analyzeFiguresFromFigures.disabled, false);
  assert.equal(e.figureHeaderTaskStatus.textContent, '机制关系 2/5');
  assert.equal(e.figureHeaderTaskStatus.hidden, false);
});

test('unavailable Figure action retains its actionable model-setup title', () => {
  const { context, elements: e } = fixture();
  context.hasUsableLlm = () => false;
  context.updateFigureButton();
  assert.equal(e.analyzeFiguresFromFigures.textContent, '解图');
  assert.equal(e.analyzeFiguresFromFigures.title, '请先配置可用模型和正文许可');
});

test('unmarked Figure buttons keep the original full-text checkpoint label', () => {
  const { context, elements: e } = fixture(false);
  context.figureAnalysisState.running = true;
  context.updateFigureButton();
  assert.equal(e.analyzeFiguresFromFigures.textContent, '1/3 图完成 · 已存 4 Panel · 可识别 3');
  assert.equal(e.analyzeFiguresFromFigures.getAttribute('aria-label'), undefined);
});
