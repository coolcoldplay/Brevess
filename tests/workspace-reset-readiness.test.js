const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, names, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const context = vm.createContext(dependencies);
  for (const name of names) {
    let start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    if (source.slice(start - 6, start) === 'async ') start -= 6;
    const end = source.indexOf('\n}', start) + 2;
    vm.runInContext(source.slice(start, end), context);
  }
  return context;
}

test('incomplete/reset workspace binding cannot invalidate its own bootstrap or create a controller', async () => {
  let controllers = 0;
  let invalidations = 0;
  const draft = { revision: 0, figures: {} };
  const context = load('content.js', ['sameFigureWorkspaceRefreshBinding', 'populateFigureWorkspaceDraft'], {
    currentFigureWorkspaceRefreshBinding: () => ({ documentId: 'old', workspaceId: '' }),
    figureWorkspaceDraft: draft,
    combinedFigureWorkspaceInventory: () => [],
    invalidateArticleWorkspaceLifecycle: () => { invalidations += 1; },
    ensureFigureWorkspaceDraftController: () => { controllers += 1; }
  });
  assert.equal(await context.populateFigureWorkspaceDraft([]), draft);
  assert.equal(controllers, 0);
  assert.equal(invalidations, 0);
});

test('mechanism edit binding uses the live workspace document, not a previously prepared analysis', () => {
  const context = load('popup.js', ['captureFigureWorkspaceEditContext'], {
    currentWorkspaceSnapshot: { documentId: 'full-paper', documentHash: 'full-hash',
      localWorkspace: { workspaceId: 'workspace', workspaceGeneration: 2 },
      figures: { workspaceLifecycle: 6 } },
    preparedDocumentState: { documentId: 'selected-sections', documentHash: 'selected-hash' },
    manualAnnotationState: { documentId: 'old-paper' },
    mechanismWorkspaceDraft: () => ({ revision: 9 }),
    mechanismChainFingerprint: () => 'fingerprint',
    activePanelTabContext: { tabId: 1, key: 'tab1' }
  });
  const binding = context.captureFigureWorkspaceEditContext();
  assert.equal(binding.documentId, 'full-paper');
  assert.equal(binding.documentKey, 'full-hash');
  assert.equal(binding.draftRevision, 9);
});

test('two local invalidations are acknowledged in order before new Figure work; failed ACK is retried', async () => {
  const calls = [];
  let fail = true;
  const context = load('content.js', ['synchronizeFigureWorkspaceLifecycle'], {
    articleWorkspaceLifecycleGeneration: 6,
    figureWorkspaceLifecycleTransitions: [
      { previousWorkspaceLifecycle: 4, workspaceLifecycle: 5 },
      { previousWorkspaceLifecycle: 5, workspaceLifecycle: 6 }
    ],
    figureWorkspaceLifecycleSyncPromise: null,
    async recoverPendingFigureOperationRelease() { calls.push('cleanup'); },
    assertCurrentArticleWorkspaceLifecycle(value) { assert.equal(value, 6); },
    chrome: { runtime: { async sendMessage(message) {
      calls.push(message.workspaceLifecycle);
      if (message.workspaceLifecycle === 6 && fail) throw new Error('worker disconnected');
      return { success: true, data: { workspaceLifecycle: message.workspaceLifecycle } };
    } } }
  });
  await assert.rejects(context.synchronizeFigureWorkspaceLifecycle(), /worker disconnected/);
  assert.deepEqual(calls, ['cleanup', 5, 6]);
  assert.equal(context.figureWorkspaceLifecycleTransitions.length, 1);
  fail = false;
  await context.synchronizeFigureWorkspaceLifecycle();
  assert.deepEqual(calls, ['cleanup', 5, 6, 'cleanup', 6]);
  assert.equal(context.figureWorkspaceLifecycleTransitions.length, 0);
});

test('initial activation prepares the local document without waiting for a view switch', async () => {
  const calls = [];
  const context = load('popup.js', ['initializeCurrentArticle'], {
    articlePreparationSequence: 0, analysisMode: 'llm',
    llmSettingsState: { effectiveMode: 'llm' }, preparedDocumentState: null,
    currentWorkspaceSnapshot: { documentId: 'full' },
    document: { getElementById: () => null },
    renderArticleConnectionStage() {},
    withPreparationDeadline: value => value,
    refreshArticleWorkspace: async () => ({ documentId: 'full' }),
    renderArticleWorkspaceSnapshot() {}, capturePanelContext: () => ({ tabId: 1 }),
    isCurrentPanelContext: () => true,
    tryAutoRestoreCurrentArticleWorkspace: async () => { calls.push('restore'); return true; },
    sendTabMessage: async () => { calls.push('baseline'); },
    async prepareArticleForAdaptiveAnalysis(tabId, options) {
      assert.equal(tabId, 1); assert.equal(options.isCurrent(), true); calls.push('prepare');
    },
    refreshLlmDiagnostics: async () => { calls.push('diagnostics'); },
    restoreFigureAnalysisProgress: async () => {}, restoreReviewOutlineProgress: async () => {},
    renderArticleConnectionFailure(error) { throw error; }, showStatus() {}
  });
  await context.initializeCurrentArticle();
  assert.deepEqual(calls, ['restore', 'baseline', 'prepare', 'diagnostics']);
});

test('workspace change notifications share the initialization refresh instead of superseding it', async () => {
  let release; let reads = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const snapshot = { documentId: 'real-paper', figures: {} };
  const context = load('popup.js', ['refreshArticleWorkspace'], {
    capturePanelContext: () => ({ tabId: 1, key: 'paper', tabContextSequence: 2 }),
    isCurrentPanelContext: () => true, workspaceRefreshInFlight: null,
    async performArticleWorkspaceRefresh() { reads += 1; await gate; return snapshot; }
  });
  const initial = context.refreshArticleWorkspace();
  const changed = context.refreshArticleWorkspace();
  const seeded = context.refreshArticleWorkspace();
  assert.equal(reads, 1);
  release();
  for (const result of await Promise.all([initial, changed, seeded])) assert.equal(result, snapshot);
  assert.equal(context.workspaceRefreshInFlight, null);
});

test('clearing a failed native PDF workspace retries readiness without a page reload', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const resetStart = source.indexOf('function resetNativePdfWorkspacePreparationState()');
  const resumeStart = source.indexOf('async function resumeNativePdfWorkspaceAfterReset()');
  const resetStateEnd = resumeStart;
  const resetWorkspaceStart = source.indexOf('async function resetArticleWorkspaceState(');
  assert.ok(resetStart >= 0 && resumeStart > resetStart && resetWorkspaceStart > resumeStart);
  const context = vm.createContext({
    nativePdfWorkspacePreparation: { key: 'failed-source' },
    SciLLM: { isPdfReaderUrl: () => true },
    location: { href: 'chrome-extension://id/pdf-reader.html' },
    document: { documentElement: { dataset: {
      pdfWorkspaceReady: 'false', pdfWorkspaceIndexed: 'false',
      pdfWorkspaceRendered: 'false', pdfErrorCode: 'PDF_WORKSPACE_SOURCE_CHANGED'
    } } },
    activeNativePdfStructure: () => ({
      documentHash: 'a'.repeat(64), paragraphs: [{ paragraphId: 'p1', text: 'current' }]
    }),
    async prepareNativePdfWorkspace() {
      context.document.documentElement.dataset.pdfWorkspaceReady = 'true';
      context.document.documentElement.dataset.pdfWorkspaceIndexed = 'true';
      return { workspace: { workspaceGeneration: 2 }, paragraphCount: 1 };
    }
  });
  vm.runInContext(source.slice(resetStart, resetStateEnd) +
    source.slice(resumeStart, resetWorkspaceStart), context);
  context.resetNativePdfWorkspacePreparationState();
  assert.equal(context.nativePdfWorkspacePreparation, null);
  assert.equal(context.document.documentElement.dataset.pdfErrorCode, undefined);
  const resumed = await context.resumeNativePdfWorkspaceAfterReset();
  assert.equal(resumed.paragraphCount, 1);
  assert.equal(context.document.documentElement.dataset.pdfWorkspaceReady, 'true');
  assert.equal(context.document.documentElement.dataset.pdfWorkspaceIndexed, 'true');

  const resetBody = source.slice(resetWorkspaceStart,
    source.indexOf('\ndocument.addEventListener(\'brevess:pdf-source-changing\'', resetWorkspaceStart));
  assert.ok(resetBody.indexOf('lastLlmAnalysis = null') <
    resetBody.indexOf('resumeNativePdfWorkspaceAfterReset()'));
  assert.ok(resetBody.indexOf('articleChatState = {') <
    resetBody.indexOf('resumeNativePdfWorkspaceAfterReset()'));
});
