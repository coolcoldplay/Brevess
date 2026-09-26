const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const popupSource = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');

function extractProductionFunction(name, nextName) {
  const start = popupSource.indexOf(`async function ${name}(`);
  const end = popupSource.indexOf(`async function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `could not extract ${name}`);
  return popupSource.slice(start, end);
}

const runFigureAnalysisSource = extractProductionFunction(
  'runFigureAnalysis',
  'showFigureOriginalImage'
);

function createHarness({
  initialView = 'figures',
  becomeStaleAfterResponse = false
} = {}) {
  const events = [];
  let markAnalysisStarted;
  let finishAnalysis;
  const analysisStarted = new Promise(resolve => { markAnalysisStarted = resolve; });
  const responseGate = new Promise(resolve => { finishAnalysis = resolve; });
  const state = {
    activeView: initialView,
    generation: 17,
    refreshes: 0,
    archives: 0,
    pollingStops: 0,
    buttonUpdates: 0,
    crossRuns: 0
  };
  const context = vm.createContext({
    requireUsableLlm: () => true,
    queryPanelTargetTab: async () => ({ id: 42 }),
    figureTaskGeneration: 17,
    isCurrentFigureTask: (token, tabId) => token === state.generation && tabId === 42,
    figureAnalysisState: { running: false, phase: 'idle' },
    updateFigureButton: () => {
      state.buttonUpdates += 1;
      events.push('button');
    },
    showStatus: () => undefined,
    startFigureProgressPolling: () => events.push('poll-start'),
    stopFigureProgressPolling: () => {
      state.pollingStops += 1;
      events.push('poll-stop');
    },
    sendTabMessage: async () => {
      markAnalysisStarted();
      await responseGate;
      if (becomeStaleAfterResponse) state.generation += 1;
      return {
        success: true,
        analyzedCount: 4,
        failedCount: 0,
        totalCount: 4,
        cacheHits: 0,
        visionFallbacks: 0,
        usage: null,
        route: null
      };
    },
    formatEffectiveRoute: message => message,
    runCrossFigureLogic: async () => {
      state.crossRuns += 1;
      events.push('cross');
      return { success: true, status: 'needs_review' };
    },
    switchWorkspaceView: view => {
      state.activeView = view;
      events.push(`view:${view}`);
    },
    refreshFigureAnalysisProgress: async () => ({}),
    refreshArticleWorkspace: async () => {
      state.refreshes += 1;
      events.push('refresh');
      return {};
    },
    persistCurrentArticleArchive: async () => {
      state.archives += 1;
      events.push('archive');
      return {};
    }
  });
  vm.runInContext(`${runFigureAnalysisSource}\nthis.runFigureAnalysis = runFigureAnalysis;`, context, {
    filename: 'popup.js#runFigureAnalysis'
  });
  return { context, events, state, analysisStarted, finishAnalysis };
}

test('late Figure completion refreshes data without stealing the current workspace view', async () => {
  for (const selectedView of ['mechanism', 'chat', 'figures']) {
    const { context, events, state, analysisStarted, finishAnalysis } = createHarness();

    const operation = context.runFigureAnalysis();
    await analysisStarted;
    // User navigation happens while Figure analysis is pending, independently
    // of cross-Figure generation, which now requires an explicit action.
    state.activeView = selectedView;
    assert.equal(state.refreshes, 0);
    assert.equal(state.archives, 0);
    finishAnalysis();
    await operation;

    assert.equal(state.activeView, selectedView,
      `Figure completion must retain the ${selectedView} view selected while it ran`);
    assert.equal(state.crossRuns, 0, 'completion must not implicitly generate cross-Figure logic');
    assert.equal(state.refreshes, 1, 'completion must still refresh the workspace snapshot');
    assert.equal(state.archives, 1, 'completion must still persist the article archive');
    assert.equal(state.pollingStops, 1, 'completion must still stop progress polling');
    assert.deepEqual(events.slice(-4), ['poll-stop', 'button', 'refresh', 'archive']);
  }
});

test('a stale Figure task cannot run completion refresh or archive side effects', async () => {
  const { context, state, analysisStarted, finishAnalysis } = createHarness({
    becomeStaleAfterResponse: true
  });

  const operation = context.runFigureAnalysis();
  await analysisStarted;
  finishAnalysis();
  await operation;

  assert.equal(state.crossRuns, 0, 'stale response must not begin cross-Figure synthesis');
  assert.equal(state.pollingStops, 0, 'stale task must not stop the current task polling');
  assert.equal(state.refreshes, 0, 'stale task must not refresh the new workspace');
  assert.equal(state.archives, 0, 'stale task must not archive the new workspace');
  assert.equal(state.activeView, 'figures');
});
