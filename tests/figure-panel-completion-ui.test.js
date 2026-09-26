const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const popup = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const start = popup.indexOf('function completedStandaloneFigurePanelIds(');
const end = popup.indexOf('\nfunction figureProgressUiSignature(', start);
assert.ok(start >= 0 && end > start, 'Figure Panel completion helpers must be extractable');
const source = popup.slice(start, end);

function classList(initial = '') {
  const values = new Set(String(initial).split(/\s+/u).filter(Boolean));
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    remove: (...names) => names.forEach(name => values.delete(name)),
    contains: name => values.has(name),
    toString: () => [...values].join(' ')
  };
}

function element(tag, className = '', text = '') {
  const attributes = new Map();
  const node = {
    tagName: String(tag).toUpperCase(),
    className,
    textContent: String(text || ''),
    children: [],
    dataset: {},
    classList: classList(className),
    appendChild(child) { this.children.push(child); return child; },
    append(...children) { children.forEach(child => this.appendChild(child)); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name); }
  };
  return node;
}

function visibleText(node) {
  return [node?.textContent || '', ...(node?.children || []).map(visibleText)].join(' ')
    .replace(/\s+/gu, ' ').trim();
}

function createContext() {
  const context = vm.createContext({
    String, Number, Array, Object, Math,
    formatFigureProgress(progress) {
      return { phaseText: progress.failed ? 'Figure 解读失败' :
        progress.phase === 'cancelled' ? '本批 Figure 解读已取消' : '正在处理 Figure',
      details: [], elapsedDetailIndex: -1 };
    },
    createWorkspaceElement: element
  });
  context.normalizeFigureRecoveryPanelLabels = value => [...new Set(
    (Array.isArray(value) ? value : []).map(item => String(item || '').trim().toUpperCase())
      .filter(item => /^[A-Z0-9][A-Z0-9.+-]{0,7}$/u.test(item))
  )];
  vm.runInContext(source, context);
  return context;
}

function substantivePanel(panel = 'D') {
  return {
    panel,
    purpose: '比较实验条件',
    directObservation: '处理组信号降低',
    contribution: '支持局部结论'
  };
}

test('landed standalone Panel exits the whole-Figure saving state without claiming full completion', () => {
  const context = createContext();
  const figure = { panelAnalyses: { D: substantivePanel() } };
  const progress = { figureId: 'figure-1', completed: true, phase: 'figure', running: false,
    expectedPanels: ['D'], route: { taskType: 'figure_panel_interpretation' } };
  const state = vm.runInContext(
    `figurePanelCompletionPresentation(${JSON.stringify(figure)}, ${JSON.stringify(progress)}, null)`,
    context
  );
  assert.deepEqual(JSON.parse(JSON.stringify(state)), {
    completed: true,
    panelIds: ['D'],
    panelOnlyComplete: true,
    restoredPanelOnly: false,
    awaitingPersistence: false,
    label: '已解读 1 个 Panel'
  });
  const details = element('details');
  context.renderFigureProgress(details, progress, null, figure);
  assert.equal(details.children.length, 1);
  assert.match(visibleText(details), /已解读 1 个 Panel/u);
  assert.doesNotMatch(visibleText(details), /正在完成校验与保存/u);
  assert.equal(details.children[0].classList.contains('is-running'), false);
  assert.equal(details.children[0].classList.contains('is-complete'), true);
  assert.equal(context.figureWorkspaceResultStatus({ figure, progress }),
    '已解读 1 个 Panel');
});

test('completed follow-up reuses the landed Panel completion without residual saving UI', () => {
  const context = createContext();
  const figure = {
    panelAnalyses: { D: substantivePanel() },
    panelFollowups: { D: { answer: '正文与图注共同支持该结果。' } }
  };
  const progress = { completed: true, phase: 'figure', running: false,
    expectedPanels: ['D'], route: { taskType: 'figure_panel_followup' } };
  const details = element('details');
  context.renderFigureProgress(details, progress, null, figure);
  assert.equal(visibleText(details), '✓ 已解读 1 个 Panel');
  assert.equal(details.children[0].classList.contains('is-running'), false);
});

test('real pending persistence remains busy until validated output is saved', () => {
  const context = createContext();
  const figure = { panelAnalyses: { D: substantivePanel() } };
  for (const scenario of [
    { figure, progress: {
      completed: true, phase: 'figure', checkpointStatus: 'pending_save',
      expectedPanels: ['D'], route: { taskType: 'figure_panel_interpretation' }
    } },
    { figure, progress: {
      completed: true, phase: 'figure',
      expectedPanels: ['D'], route: { taskType: 'figure_walkthrough' }
    } },
    { figure: {}, progress: { completed: true, phase: 'figure',
      route: { taskType: 'figure_walkthrough' } } }
  ]) {
    const details = element('details');
    context.renderFigureProgress(details, scenario.progress, null, scenario.figure);
    assert.match(visibleText(details), /模型结果已返回，正在完成校验与保存/u);
    assert.equal(details.children[0].classList.contains('is-running'), true);
  }
});

test('failed, cancelled, restored, and placeholder-only figures keep their distinct meanings', () => {
  const context = createContext();
  const figure = { panelAnalyses: { D: substantivePanel() } };
  const failed = context.figurePanelCompletionPresentation(
    figure, { completed: true, failed: true, phase: 'failed',
      route: { taskType: 'figure_panel_interpretation' } }, null
  );
  const cancelled = context.figurePanelCompletionPresentation(
    figure, { completed: true, phase: 'cancelled',
      route: { taskType: 'figure_panel_interpretation' } }, null
  );
  const restored = context.figurePanelCompletionPresentation(figure, null, null);
  const placeholder = context.figurePanelCompletionPresentation({
    panelAnalyses: { D: { panel: 'D', purpose: '', directObservation: '', contribution: '' } }
  }, null, null);
  assert.equal(failed.completed, false);
  assert.equal(failed.panelOnlyComplete, false);
  assert.equal(cancelled.completed, false);
  assert.equal(cancelled.panelOnlyComplete, false);
  assert.equal(restored.restoredPanelOnly, true);
  assert.equal(restored.label, '已解读 1 个 Panel');
  assert.equal(context.figureWorkspaceResultStatus({ figure }), '已解读 1 个 Panel');
  assert.equal(placeholder.restoredPanelOnly, false);
  assert.deepEqual(JSON.parse(JSON.stringify(placeholder.panelIds)), []);
  assert.equal(context.figureWorkspaceResultStatus({
    figure, progress: { failed: true, phase: 'failed' }
  }), '解读失败');
  assert.equal(context.figureWorkspaceResultStatus({
    figure, progress: { phase: 'cancelled' }
  }), '待解读');
});

test('a committed whole-Figure result still owns the completion presentation', () => {
  const context = createContext();
  const figure = { panelAnalyses: { D: substantivePanel() } };
  const progress = { completed: true, phase: 'figure',
    route: { taskType: 'figure_walkthrough' } };
  const result = { coreConclusion: '整图结论' };
  const state = context.figurePanelCompletionPresentation(figure, progress, result);
  assert.equal(state.panelOnlyComplete, false);
  assert.equal(state.awaitingPersistence, false);
  const details = element('details');
  context.renderFigureProgress(details, progress, result, figure);
  assert.equal(details.children.length, 0);
});

test('progress render signature includes the fields that distinguish Panel completion from saving', () => {
  assert.match(popup, /checkpointStatus:\s*String\(progress\?\.checkpointStatus/u);
  assert.match(popup, /taskType:\s*String\(progress\?\.taskType/u);
  assert.match(popup, /taskType:\s*String\(route\.taskType/u);
});
