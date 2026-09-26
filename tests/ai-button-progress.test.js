const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');

function section(startMarker, endMarker) {
  const start = popup.indexOf(startMarker);
  const end = popup.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return popup.slice(start, end);
}

function classList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    remove: (...names) => names.forEach(name => values.delete(name)),
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : Boolean(force);
      if (enabled) values.add(name); else values.delete(name);
      return enabled;
    },
    contains: name => values.has(name)
  };
}

function element(textContent = '') {
  const attributes = new Map();
  return {
    textContent,
    dataset: {},
    classList: classList(),
    disabled: false,
    hidden: false,
    title: '',
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: name => attributes.delete(name),
    getAttribute: name => attributes.get(name)
  };
}

test('Figure aggregate uses completed, saved, and unresolved checkpoint facts', () => {
  const context = vm.createContext({
    normalizeFigureRecoveryPanelLabels: value => [...new Set(
      (Array.isArray(value) ? value : []).map(String)
    )]
  });
  vm.runInContext(section(
    'function getFigureProgressEntries(status)',
    'function hasRunningFigureProgress(status'
  ), context);
  const status = {
    completedFigures: 1,
    totalFigures: 2,
    figureProgress: [
      {
        figureId: 'fig-1', completed: true, totalFigures: 2,
        savedPanelCount: 5, validatedPanelCount: 5, unresolvedPanels: ['E']
      },
      {
        figureId: 'fig-2', completed: false, totalFigures: 2,
        savedPanelCount: 4, validatedPanelCount: 5, unresolvedPanels: ['C', 'D']
      }
    ]
  };
  const summary = vm.runInContext(
    `summarizeFigureButtonProgress(${JSON.stringify(status)})`, context
  );
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), {
    completedFigures: 1,
    totalFigures: 2,
    savedPanels: 9,
    validatedPanels: 10,
    identifiablePanels: 6
  });
  assert.equal(
    vm.runInContext(`figureButtonProgressLabel(${JSON.stringify(status)})`, context),
    '1/2 图完成 · 已存 9 Panel · 可识别 6 · 已校验 10'
  );
  assert.equal(
    vm.runInContext(`singleFigureButtonProgressLabel(${JSON.stringify({
      savedPanelCount: 5,
      validatedPanelCount: 6,
      expectedPanels: ['A', 'B', 'C', 'D', 'E', 'F'],
      unresolvedPanels: ['E']
    })})`, context),
    '已存 5/6 · 可识别 4 · 已校验 6'
  );
});

test('actual Figure and review buttons expose checkpoint counts and busy state', () => {
  const figure = element();
  const review = element();
  const context = vm.createContext({
    document: {
      getElementById(id) {
        return id === 'analyzeFiguresFromFigures' ? figure
          : id === 'generateReviewOutline' ? review : null;
      }
    },
    figureAnalysisState: {
      running: true, phase: 'figure_model_processing', completedFigures: 1,
      totalFigures: 3,
      figureProgress: [{
        figureId: 'f1', running: true, savedPanelCount: 3,
        validatedPanelCount: 3, unresolvedPanels: ['C']
      }]
    },
    crossFigureLogicRunning: false,
    mechanismGenerationUiController: { presentation: () => ({}) },
    getFigureProgressEntries: status => status.figureProgress || [],
    hasRunningFigureProgress: () => true,
    normalizeFigureRecoveryPanelLabels: value => Array.isArray(value) ? value : [],
    hasUsableLlm: () => true,
    llmUnavailableMessage: () => '',
    updateFigureTaskControls: () => {},
    reviewOutlineState: {
      running: true, phase: 'review_map', completedParagraphs: 12,
      totalParagraphs: 20, completedChunks: 2, totalChunks: 4, hasOutline: false
    }
  });
  vm.runInContext(section(
    'function summarizeFigureButtonProgress(status',
    'function hasRunningFigureProgress(status'
  ) + section('function updateFigureButton()', 'async function openArticleNavigator()'), context);
  vm.runInContext('updateFigureButton(); updateReviewOutlineButton();', context);
  assert.equal(figure.textContent, '1/3 图完成 · 已存 3 Panel · 可识别 2');
  assert.equal(figure.getAttribute('aria-busy'), 'true');
  assert.ok(figure.classList.contains('is-llm-pending'));
  assert.equal(review.textContent, '12/20 段');
  assert.match(review.title, /分块 2\/4/u);
  assert.ok(review.classList.contains('is-llm-pending'));
});

test('highlight progress labels use reported units and update the real action button', () => {
  const apply = element();
  const context = vm.createContext({
    document: { getElementById: id => id === 'applyHighlight' ? apply : null },
    analysisMode: 'llm',
    regexApplyPending: true,
    highlightTaskState: {
      running: true, paused: false, phase: 'paragraph_checkpoint',
      completed: 18, total: 40
    },
    prepareState: 'analyzing',
    selectedCategories: new Set(['result']),
    llmSelectedCategories: new Set(['result']),
    llmSettingsState: { effectiveMode: 'llm' },
    preparedDocumentState: { documentHash: 'hash', fullTextAnalyzed: false },
    preferenceMutationCoordinator: { isPending: () => false },
    updateHighlightTaskControls: () => {}
  });
  vm.runInContext(section(
    'function highlightButtonProgressLabel(state',
    'async function controlActiveAnalysis(scope'
  ), context);
  vm.runInContext('updateApplyButton()', context);
  assert.equal(apply.textContent, '已保存正文段 18/40');
  assert.equal(apply.disabled, true);
  assert.equal(apply.getAttribute('aria-busy'), 'true');
  assert.ok(apply.classList.contains('is-llm-pending'));
});

test('literature note displays real obtained/missing counts before and after persistence', async () => {
  const main = element();
  const mainLabel = element('AI 读取全文填写本模板');
  main.querySelector = selector => selector === 'span' ? mainLabel : null;
  const field = element('AI 生成');
  field.dataset.generateLiteratureNoteField = 'aim';
  let resolvePersist;
  let persistStarted = false;
  const previewRequests = [];
  const persistPromise = new Promise(resolve => { resolvePersist = resolve; });
  const noteState = {
    templateId: 'basic',
    valuesByTemplate: { basic: {} },
    fieldStatusByTemplate: { basic: {} }
  };
  const context = vm.createContext({
    structuredClone,
    Map,
    Set,
    console,
    setTimeout: () => 1,
    literatureNoteAutofillPromise: null,
    literatureNoteButtonFeedbackSequence: 0,
    literatureNoteViewRevision: 0,
    literatureNoteDocumentState: noteState,
    literatureNoteFieldEditVersions: new Map(),
    currentWorkspaceSnapshot: { documentHash: 'doc-hash' },
    preparedDocumentState: null,
    manualAnnotationState: {},
    SciLLM: { stableHash: value => String(value) },
    document: {
      getElementById(id) {
        if (id === 'autofillLiteratureNote') return main;
        if (id === 'literatureNoteFields') return {};
        if (id === 'literatureNoteStatus') return element();
        return null;
      },
      querySelectorAll: selector => selector.includes('generate-literature-note-field')
        ? [field] : []
    },
    requireUsableLlm: () => true,
    literatureNoteTemplates: () => [{
      id: 'basic', fields: [{ id: 'aim', label: '研究目的' }]
    }],
    captureLiteratureNoteContext: () => ({ documentKey: 'doc-key' }),
    literatureNoteDocumentKey: () => 'doc-key',
    capturePanelContext: () => ({ id: 1 }),
    isCurrentPanelContext: () => true,
    isCurrentLiteratureNoteContext: () => true,
    queryPanelTargetTab: async () => ({ id: 7 }),
    sendTabMessage: async () => ({
      success: true,
      result: { templateId: 'basic', documentHash: 'doc-hash', cacheHit: false }
    }),
    validateLiteratureNoteGenerationReceipt: () => true,
    applyLiteratureNoteAutofillResult: () => ({
      counts: { filled: 1, missing: 0, preserved: 0, invalid: 0 },
      changedFields: ['aim'], sourceWarnings: []
    }),
    markLiteratureNoteFieldDirty: () => {},
    updateLiteratureNoteRenderedFields: () => {},
    setLiteratureNotePreview: preview => { previewRequests.push(preview); },
    syncLiteratureNoteTextarea: () => {},
    persistLiteratureNoteDocumentState: () => {
      persistStarted = true;
      return persistPromise;
    },
    createLiteratureNoteAutofillSummary: () => ({
      message: '完成', tone: 'success', success: true, buttonLabel: 'AI 已保存'
    }),
    formatLlmFailureMessage: (_, error) => error.message,
    showStatus: () => {},
    t: value => value
  });
  vm.runInContext(
    section('function literatureNoteOperationLabel(', 'async function autofillLiteratureNoteWithLLM(') +
    section('async function autofillLiteratureNoteWithLLM(',
      'async function autofillLiteratureNoteFieldWithLLM('),
    context
  );
  const operation = vm.runInContext(
    `autofillLiteratureNoteWithLLM({ fieldId: 'aim' })`, context
  );
  for (let index = 0; index < 10 && !persistStarted; index += 1) await Promise.resolve();
  assert.equal(persistStarted, true);
  assert.deepEqual(previewRequests, [true], 'new AI content should render without bypassing persistence');
  assert.equal(mainLabel.textContent, '已取得 1/1，正在保存');
  assert.equal(field.textContent, 'AI 已取得，正在保存');
  resolvePersist({ stale: false });
  const result = await operation;
  assert.equal(result.filledCount, 1);
  assert.equal(mainLabel.textContent, '已保存 1/1 项');
  assert.equal(field.textContent, 'AI 已保存');
  assert.equal(main.disabled, false);
  assert.equal(main.getAttribute('aria-busy'), undefined);
});

test('paper metadata buttons expose only response and committed field counts', () => {
  const button = element('提取创新点');
  button.dataset.paperMetaTask = 'innovation';
  button.dataset.defaultLabel = '提取创新点';
  const state = { running: true, phase: 'saving', changedFields: 3 };
  const context = vm.createContext({
    paperMetaTaskState: { innovation: state },
    document: { querySelectorAll: () => [button] }
  });
  vm.runInContext(section(
    'function paperMetaTaskButtonLabel(state',
    'function createPaperMetaTaskButton(taskKind'
  ), context);
  vm.runInContext(`updatePaperMetaTaskButtons('innovation')`, context);
  assert.equal(button.textContent, '已取得 3 项，正在保存');
  assert.equal(button.disabled, true);
  state.running = false;
  state.phase = 'complete';
  vm.runInContext(`updatePaperMetaTaskButtons('innovation')`, context);
  assert.equal(button.textContent, '已保存 3 项');
});

test('slow edge glow is strong and reduced-motion disables every AI animation', () => {
  assert.match(css, /\.is-llm-pending\s*\{\s*animation:\s*workspace-soft-pulse 2\.6s/u);
  assert.match(css, /0 0 19px rgba\(31, 112, 151, \.34\)/u);
  assert.match(css, /\.mechanism-generation-status\[aria-busy="true"\][\s\S]*workspace-soft-pulse 2\.6s/u);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.is-llm-pending,[\s\S]*\.inline-settings-button\.is-running,[\s\S]*mechanism-generation-status[\s\S]*animation:\s*none/u);
});
