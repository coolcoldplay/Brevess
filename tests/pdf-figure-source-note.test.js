const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const popup = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const summaryStart = popup.indexOf('function figureSummaryPresentation(');
const completionStart = popup.indexOf('function completedStandaloneFigurePanelIds(');
const completionEnd = popup.indexOf('\nfunction renderFigureProgress(', completionStart);
const start = popup.indexOf('function renderFigureWorkspaceSnapshot(');
const end = popup.indexOf('\nfunction reconcileArticleWorkspaceSnapshot(', start);
assert.ok(completionStart >= 0 && completionEnd > completionStart,
  'load the actual Figure panel completion presentation');
assert.ok(start >= 0 && end > start, 'load the actual Figure card renderer');

function element(tagName, className = '', textContent = '') {
  return {
    tagName, className, textContent, children: [], dataset: {}, listeners: {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(child) { this.children.push(child); return child; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    setAttribute() {}
  };
}

function descendants(node) {
  return [node, ...node.children.flatMap(descendants)];
}

function renderFigure(overrides = {}, progress = null) {
  const figure = {
    figureId: 'figure-1', figureLabel: 'Figure 1', sourceKind: 'pdf-page-caption',
    sourcePage: 4, hasImage: true, activeDepth: 'standard', ...overrides
  };
  const container = element('div');
  const context = vm.createContext({
    document: { getElementById: id => id === 'figureWorkspace' ? container : null,
      createElement: element, createTextNode: text => element('#text', '', text) },
    figureCaptionSidebarState: { visible: false },
    disposeSupplementalPlacementBindings() {},
    getFigureProgressEntries: state => state?.entries || [],
    figureAnalysisState: { entries: progress ? [{ figureId: figure.figureId, ...progress }] : [] },
    renderSupplementalFigureCoverage() {},
    renderResearchLogicMapSnapshot() {},
    SciLLM: { orderFigureWorkspaceItems: figures => figures },
    figureWorkspaceViewState: { resolve: () => ({ figureAnchorId: 'figure-1', panels: [] }) },
    figureExpansionState: new Map(),
    createWorkspaceElement: element,
    compactFigureResultConclusion: result => result.conclusion || '',
    normalizeFigureRecoveryPanelLabels: panels => Array.isArray(panels)
      ? panels.map(value => String(value || '').trim().toUpperCase()).filter(Boolean)
      : [],
    formatFigureProgress: () => ({ phaseText: '正在精读' }),
    singleFigureButtonProgressLabel: () => '解图中',
    hasUsableLlm: () => true,
    renderFigureProgress() {},
    appendFigureWorkspaceOverview() {},
    appendFigurePanelCatalog() {},
    appendFigureWorkspaceField() {},
    figureRecoveryInputModeBadge: () => '',
    figureRecoveryRetryPresentation: () => ({ labels: [] }),
    renderFigureQuickNav() {},
    // A configured vision profile cannot determine what an existing result used.
    llmSettingsState: { settings: { profiles: { vision: { supportsVision: true } } } }
  });
  vm.runInContext(
    `${popup.slice(summaryStart, completionStart)}\n${popup.slice(completionStart, completionEnd)}\n${popup.slice(
      popup.indexOf('function createPdfFigureArtworkPageControl('), end)}` +
      '\nthis.render = renderFigureWorkspaceSnapshot;',
    context
  );
  const before = structuredClone(figure);
  context.render({ figures: { figures: [figure] } }, { coordinated: true });
  assert.deepEqual(figure, before, 'rendering must not change the model result or Figure');
  const nodes = descendants(container);
  return {
    notes: nodes.filter(node => node.className === 'workspace-source-note' && node.textContent)
      .map(node => node.textContent),
    buttons: nodes.filter(node => node.tagName === 'button')
  };
}

test('PDF text result states that the model used caption and context without reading images', () => {
  const { notes } = renderFigure({ standard: { basis: 'caption_context' } });
  assert.deepEqual(notes, ['文字依据：图注与相关正文（未读取图片）。']);
});

test('PDF vision result retains the page image evidence note', () => {
  const { notes } = renderFigure({ standard: { basis: 'vision_text' } });
  assert.deepEqual(notes, ['图像依据：PDF 第 4 页原页。']);
});

test('PDF Figure without analysis reports unconfirmed artwork coverage', () => {
  assert.deepEqual(renderFigure().notes, ['图像范围待核对；图注所在页可能不包含完整 Figure。']);
  assert.deepEqual(renderFigure({}, { running: true, inputMode: 'whole_figure' }).notes,
    ['图像范围待核对；图注所在页可能不包含完整 Figure。']);
});

test('PDF result with unknown legacy basis does not claim image evidence', () => {
  for (const basis of [undefined, '', 'unknown']) {
    assert.deepEqual(renderFigure({ standard: { basis } }).notes,
      ['图像范围待核对；图注所在页可能不包含完整 Figure。']);
  }
});

test('vision fallback uses actual result basis even with vision progress and input metadata', () => {
  const { notes } = renderFigure({
    standard: { basis: 'caption_context', inputMode: 'whole_figure' }
  }, { completed: true, inputMode: 'whole_figure' });
  assert.deepEqual(notes, ['文字依据：图注与相关正文（未读取图片）。']);
});

test('source note follows the displayed depth and retained result during retry', () => {
  const standard = { basis: 'caption_context' };
  const deep = { basis: 'vision_text', analysisDepth: 'deep' };
  assert.deepEqual(renderFigure({ standard, deep }).notes,
    ['文字依据：图注与相关正文（未读取图片）。']);
  assert.deepEqual(renderFigure({ standard, deep, activeDepth: 'deep' }).notes,
    ['图像依据：PDF 第 4 页原页。']);
  assert.deepEqual(renderFigure({ standard, pendingStandard: deep }, { running: true }).notes,
    ['文字依据：图注与相关正文（未读取图片）。']);
  assert.deepEqual(renderFigure({ pendingStandard: standard }).notes,
    ['文字依据：图注与相关正文（未读取图片）。']);
});

test('PDF boundary-review guidance and original image actions remain available', () => {
  const { notes, buttons } = renderFigure({
    standard: { basis: 'caption_context' }, needsReview: true
  });
  assert.deepEqual(notes,
    ['文字依据：图注与相关正文（未读取图片）。图注边界待复核，可核对原页后再解读。']);
  assert.deepEqual(buttons.map(button => button.textContent),
    ['跳转', '原图', '解图', '核对图像页', '保存图像页']);
  assert.match(buttons[0].title, /PDF 第 4 页/);
  assert.equal(buttons[1].disabled, false);
  assert.equal(typeof buttons[1].listeners.click, 'function');
});

test('HTML Figure rendering retains its existing source-note and action behavior', () => {
  for (const standard of [undefined, { basis: 'caption_context' }, { basis: 'vision_text' }]) {
    const { notes, buttons } = renderFigure({ sourceKind: 'html-figure', standard });
    assert.deepEqual(notes, []);
    assert.deepEqual(buttons.map(button => button.textContent), ['跳转', '原图', '解图']);
    assert.match(buttons[0].title, /正文图注/);
  }
});
