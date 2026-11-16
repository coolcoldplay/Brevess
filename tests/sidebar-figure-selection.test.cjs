const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { functionSource } = require('./helpers/r28-full07-source');
const source = fs.readFileSync(require.resolve('../extension/popup.js'), 'utf8');

test('Extended Data and supplemental figures retain distinct labels and source titles', () => {
  const h = load(['compactFigureDisplayNumber', 'figureSummaryPresentation', 'figureSourceCaption'], {
    SciLLM: require('../extension/core/figure-extractor.js')
  });
  assert.equal(h.compactFigureDisplayNumber({ figureLabel: 'Extended Data Fig. 1', isSupplemental: true }), 'ED1');
  assert.equal(h.compactFigureDisplayNumber({ figureLabel: 'Supplementary Figure S1', isSupplemental: true }), 'S1');
  const figureTitle = 'E. coli challenge (A) at 1.5 h. Response after recovery.';
  assert.equal(h.figureSummaryPresentation(null, { figureTitle, figureLabel: 'Figure 1', caption: 'Figure 1 Old cached caption.' }).text, figureTitle);
});

function load(names, context) {
  vm.createContext(context);
  vm.runInContext(names.map(name => functionSource(source, name)).join('\n'), context);
  return context;
}

function batchHarness() {
  const calls = [], selection = new Set();
  const button = new EventTarget();
  Object.assign(button, { dataset: { workspaceTarget: 'figures' }, setAttribute() {}, appendChild() {} });
  const context = { tabId: 3, key: 'paper', url: 'https://example.org/article' };
  const h = load(['performSidebarModuleBatch', 'setupSidebarBatchActions', 'updateFigureSelection'], {
    AbortController, crypto: require('node:crypto').webcrypto,
    activePanelTabContext: { ...context, activated: true },
    currentWorkspaceSnapshot: { documentId: 'paper', documentHash: 'hash' },
    preparedDocumentState: null, analysisMode: 'llm', figureSelectedIds: selection, figureSelectionAnchor: '',
    capturePanelContext: () => context, sidebarBatchKey: () => 'figures', sidebarTaskDocumentId: () => 'paper',
    sidebarBatchIntents: new Map(), sidebarRuntimeTasks: { get: () => null },
    isCurrentPanelContext: () => true, renderSidebarBatchActions() {}, pollSidebarRuntimeTasks: async () => {},
    syncFigureSelectionUi() {}, showStatus: message => { throw new Error(message); },
    document: { querySelectorAll: () => [button], createElement: () => ({ setAttribute() {} }) },
    runFigureAnalysis: async options => { calls.push({ ...options, ids: [...selection] }); }
  });
  h.setupSidebarBatchActions();
  return { h, button, calls, selection };
}

test('bottom figure double click honours Cmd multi-selection and the unselected fallback', async () => {
  const { h, button, calls, selection } = batchHarness();
  const figures = ['f1', 'f2', 'f3', 'f4'].map(figureId => ({ figureId }));
  h.updateFigureSelection('f1', { metaKey: true }, figures);
  h.updateFigureSelection('f3', { metaKey: true }, figures);
  button.dispatchEvent(new Event('dblclick', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0].allFigures, false);
  assert.deepEqual(calls[0].ids, ['f1', 'f3']);
  selection.clear();
  button.dispatchEvent(new Event('dblclick', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[1].allFigures, true);
});

test('Shift+Enter uses the same scope as Ctrl/Shift range selection', async () => {
  const { h, button, calls } = batchHarness();
  const figures = ['f1', 'f2', 'f3', 'f4'].map(figureId => ({ figureId }));
  h.updateFigureSelection('f2', { ctrlKey: true }, figures);
  h.updateFigureSelection('f3', { shiftKey: true }, figures);
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { key: 'Enter', shiftKey: true });
  button.dispatchEvent(event);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0].allFigures, false);
  assert.deepEqual(calls[0].ids, ['f2', 'f3']);
});

test('batch request keeps the selected IDs captured before an async input-mode dialog', async () => {
  const requests = [], statuses = [];
  const selection = new Set(['figure-1', 'figure-3']);
  const context = { tabId: 3, key: 'paper', url: 'https://example.org/article' };
  const h = load(['runFigureAnalysis'], {
    window: new EventTarget(), chrome: { runtime: {} }, figureSelectedIds: selection,
    currentWorkspaceSnapshot: { documentHash: 'paper-hash', figures: { figures: [1, 2, 3, 4].map(n => ({ figureId: 'figure-' + n })) } },
    sidebarBatchIntents: new Map(), sidebarBatchKey: () => 'figures', capturePanelContext: () => context,
    queryPanelTargetTab: async () => ({ id: 3 }), figureTaskGeneration: 1,
    isCurrentPanelContext: () => true, isCurrentFigureTask: () => true, isSidebarOperationStopping: () => false,
    requestFigureInputModeChoice: async options => {
      assert.equal(options.figureLabel, '所选 2 张 Figure');
      selection.clear(); selection.add('figure-4');
      return 'caption_context';
    },
    figureAnalysisState: {}, updateFigureButton() {}, showStatus: message => statuses.push(message),
    waitForFigureSourceResume: async () => {}, startFigureProgressPolling() {}, stopFigureProgressPolling() {},
    observeStoppedFigureNativeRequest: async () => {}, acceptSidebarRuntimeTask() {},
    refreshArticleWorkspace: async () => {}, persistCurrentArticleArchive: async () => ({ saved: { saved: true } }),
    figureBulkAwaitRead: value => value, formatEffectiveRoute: message => message,
    SciLLM: { formatFigureBulkSourceSummary: () => '' },
    sendTabMessage: async (_tab, request) => {
      requests.push(request);
      return { success: true, analyzedCount: 2, totalCount: 2, failedCount: 0 };
    }
  });
  await h.runFigureAnalysis({ operationId: 'selected-test' });
  assert.equal(requests.length, 1, statuses.join('\n'));
  assert.deepEqual(Array.from(requests[0].figureIds), ['figure-1', 'figure-3']);
  assert.equal(requests[0].documentHash, 'paper-hash');
  assert.notEqual(requests[0].allFigures, true);
  assert.equal(h.figureAnalysisState.completedFigures, 2, statuses.join('\n'));
});

const titleHarness = () => load(['figureSourceCaption', 'figureSummaryPresentation'], {
  SciLLM: require('../extension/core/figure-extractor.js')
});

test('initial figure names use the source title without the panel legend or a pending Chinese summary', () => {
  const h = titleHarness();
  const title = 'Neuron-released α-synuclein is engulfed by microglia in vivo.';
  const value = h.figureSummaryPresentation(null, {
    figureLabel: 'Figure 1', caption: 'Fig. 1: ' + title + ' a, b Mice injected with AAV9.'
  });
  assert.equal(value.text, title);
  assert.equal(value.source, 'figureTitle');
  assert.equal(h.figureSummaryPresentation(null, { figureLabel: 'Figure 2', caption: '' }).text, '暂无图标题');
});

test('source-title fallback preserves human names, deliberate blanks and existing Chinese conclusions', () => {
  const h = titleHarness(), figure = { title: 'Original figure title' };
  assert.equal(h.figureSummaryPresentation(null, figure, { displayName: { humanReviewed: true, value: '我的图名' } }).text, '我的图名');
  assert.equal(h.figureSummaryPresentation(null, figure, { displayName: { humanReviewed: true, value: '' } }).state, 'cleared');
  assert.equal(h.figureSummaryPresentation({ coreConclusion: '微胶质细胞清除 α-synuclein' }, figure).text, '微胶质细胞清除 α-synuclein');
  assert.equal(h.figureSummaryPresentation(null, figure).text, 'Original figure title');
});
