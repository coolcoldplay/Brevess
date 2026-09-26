const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const reader = fs.readFileSync(require('node:path').join(__dirname, '../pdf-reader.js'), 'utf8');
const content = fs.readFileSync(require('node:path').join(__dirname, '../content.js'), 'utf8');
function slice(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(options = {}) {
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { dataset: {}, hidden: false, textContent: '', style: {} });
    return nodes.get(id);
  };
  element('pdfNativeViewer').dataset.state = 'ready';
  const document = new EventTarget();
  document.documentElement = { dataset: { pdfWorkspaceReady: 'true', pdfWorkspaceIndexed: 'true' } };
  document.getElementById = element;
  const state = { runId: 0, nativeFigureAbortController: null, settings: {}, localFileBytes: null };
  const messages = [], progress = [], actions = [];
  const context = vm.createContext({ document, state, DOMException, AbortController,
    setTimeout, clearTimeout, element, headlessSupplementalImport: false, isLocalSource: false,
    supplementalPdfBinding: null, workspaceSourceUrl: () => 'https://example.org/paper.pdf',
    __brevessNativePdfDocument: { phase: 'text-ready', documentGeneration: 2,
      structure: { documentId: `sha256:${'a'.repeat(64)}`, documentHash: 'a'.repeat(64),
        revision: 1, diagnostics: { characterCount: 11 },
        paragraphs: [{ paragraphId: 'pdf-page-1', text: 'native text' }] } },
    chrome: { storage: { local: { get: options.getSettings || (async () => ({})) } },
      runtime: { sendMessage: async message => messages.push(message) } },
    SciLLM: { PDF_MINERU_SETTINGS_KEY: 'settings', normalizeMineruPdfSettings: () => ({}),
      planOriginalPdfTextEnhancement: () => options.plan || { effectiveSettings: { mode: 'agent' } } },
    setProgress: (...args) => progress.push(args), showReaderActions: value => actions.push(value),
    setReaderView() {}, updateMineruQuotaStatus: async () => {},
    extractWholePdfFigures: options.figures || (async () => null),
    parseWithAgent: options.parse || (async () => { throw new Error('network unavailable'); }),
    parseWithPrecise: options.parse || (async () => ({})),
    cacheRemoteParsedImages: async () => {}, renderParsedDocument: async () => {},
    restoreCachedPageBindingsAfterNativeReady: async () => {},
    friendlyParseError: error => error.message,
    setPdfFigureEngineStatus(message, status) { element('pdfFigureEngineStatus').textContent = message; element('pdfFigureEngineStatus').dataset.state = status; }
  });
  vm.runInContext(slice(reader, '  async function waitForOriginalPdfIndex(', '  async function applyParsedOcrToOriginal(') +
    slice(reader, '  function setPdfEnhancementState(', '  async function acceptSelectedLocalPdf(') +
    '\nglobalThis.api = { runParse, waitForOriginalPdfIndex, setPdfEnhancementState };', context);
  return { ...context.api, context, state, element, document, messages, progress, actions };
}

test('enhancement failure preserves native readiness and reports the actual reason independently', async () => {
  const h = harness();
  await h.runParse();
  assert.equal(h.document.documentElement.dataset.pdfWorkspaceReady, 'true');
  assert.equal(h.document.documentElement.dataset.pdfEnhancementState, 'error');
  assert.equal(h.document.documentElement.dataset.pdfErrorCode, undefined);
  assert.equal(h.element('pdfReaderControl').hidden, false);
  assert.equal(h.progress.at(-1)[2], '增强识别未完成');
  assert.match(h.messages[0].message, /network unavailable.*原页仍可阅读/);
  assert.equal(h.messages[0].scope, 'enhancement');
  assert.equal(h.messages[0].mineruQuotaText, undefined);
});

test('a settings read rejection ends loading and becomes a recoverable error', async () => {
  const h = harness({ getSettings: async () => { throw new Error('storage failed'); } });
  await h.runParse();
  assert.equal(h.element('pdfReaderControl').dataset.state, 'error');
  assert.equal(h.document.documentElement.dataset.pdfEnhancementError, 'storage failed');
});

test('precise mode without token is blocked without leaving the button in loading', async () => {
  let calls = 0;
  const h = harness({ plan: { effectiveSettings: { mode: 'precise', token: '' } }, parse: async () => { calls++; } });
  await h.runParse();
  assert.equal(calls, 0);
  assert.equal(h.document.documentElement.dataset.pdfEnhancementState, 'blocked');
  assert.equal(h.element('pdfReaderControl').dataset.state, 'error');
});

test('retry clears only its own stale enhancement error, preserving an index error', async () => {
  const h = harness(); const data = h.document.documentElement.dataset;
  data.pdfEnhancementError = 'old enhancement'; data.pdfWorkspaceIndexError = 'index write failed'; data.pdfErrorCode = 'index write failed';
  h.setPdfEnhancementState('running');
  assert.equal(data.pdfEnhancementError, undefined);
  assert.equal(data.pdfErrorCode, 'index write failed');
});

test('successful enhancement clears its own error and releases the status surface', async () => {
  const h = harness({ parse: async () => ({}) });
  h.setPdfEnhancementState('error', 'previous failure');
  await h.runParse();
  assert.equal(h.document.documentElement.dataset.pdfEnhancementState, 'ready');
  assert.equal(h.document.documentElement.dataset.pdfEnhancementError, undefined);
  assert.equal(h.element('pdfReaderControl').hidden, true);
});

test('enhancement completion cannot hide a separate index persistence failure', async () => {
  const h = harness({ parse: async () => ({}) });
  h.document.documentElement.dataset.pdfWorkspaceIndexError = 'index write failed';
  await h.runParse();
  assert.equal(h.document.documentElement.dataset.pdfEnhancementState, 'ready');
  assert.equal(h.element('pdfReaderControl').hidden, false);
  assert.equal(h.element('pdfReaderControl').dataset.state, 'error');
  assert.equal(h.progress.at(-1)[2], '文字索引保存未完成');
});

test('a rejected old parse cannot abort a newer run or overwrite its progress', async () => {
  const gate = deferred(); const h = harness({ parse: () => gate.promise });
  const parsing = h.runParse();
  await new Promise(resolve => setImmediate(resolve));
  h.state.runId++;
  const newer = new AbortController(); h.state.nativeFigureAbortController = newer;
  h.setPdfEnhancementState('running');
  gate.reject(new Error('old failure')); await parsing;
  assert.equal(newer.signal.aborted, false);
  assert.equal(h.document.documentElement.dataset.pdfEnhancementState, 'running');
  assert.equal(h.messages.length, 0);
});

test('an enhancement failure cancels its running Figure status instead of leaving it busy', async () => {
  const h = harness();
  h.element('pdfFigureEngineStatus').dataset.state = 'running';
  await h.runParse();
  assert.equal(h.element('pdfFigureEngineStatus').dataset.state, 'cancelled');
});

test('native terminal error wakes an index waiter immediately and removes its listeners', async () => {
  const h = harness(); h.context.__brevessNativePdfDocument.phase = 'indexing';
  const waiting = h.waitForOriginalPdfIndex();
  const event = new Event('brevess:native-pdf-error');
  event.detail = { message: 'invalid PDF', documentGeneration: 2 };
  h.document.dispatchEvent(event);
  await assert.rejects(waiting, /invalid PDF/);
});

test('a terminal failure already present does not wait for the 120 second timeout', async () => {
  const h = harness(); h.context.__brevessNativePdfDocument.phase = 'indexing';
  h.state.nativeReaderFailure = { sourceUrl: h.context.workspaceSourceUrl(), documentGeneration: 2,
    message: 'PDF_NATIVE_READER_FAILED' };
  await assert.rejects(h.waitForOriginalPdfIndex(), /PDF_NATIVE_READER_FAILED/);
});

test('a stale viewer error from the empty reader does not reject a newly selected PDF', async () => {
  const h = harness(); h.context.__brevessNativePdfDocument.phase = 'indexing';
  h.element('pdfNativeViewer').dataset.state = 'error';
  const pending = h.waitForOriginalPdfIndex();
  h.context.__brevessNativePdfDocument.phase = 'text-ready';
  h.document.dispatchEvent(new Event('brevess:native-pdf-ready'));
  assert.equal(await pending, h.context.__brevessNativePdfDocument);
});

test('source selection cancels a waiter, while an old document error cannot reject the new one', async () => {
  const h = harness(); h.context.__brevessNativePdfDocument.phase = 'indexing';
  const waiting = h.waitForOriginalPdfIndex();
  const oldError = new Event('brevess:native-pdf-error'); oldError.detail = { documentGeneration: 1 };
  h.document.dispatchEvent(oldError);
  h.document.dispatchEvent(new Event('brevess:pdf-source-changing'));
  await assert.rejects(waiting, { name: 'AbortError' });
});

test('terminal partial text is a usable index and is not falsely treated as loading', async () => {
  const h = harness(); h.context.__brevessNativePdfDocument.phase = 'partial-index';
  assert.equal(await h.waitForOriginalPdfIndex(), h.context.__brevessNativePdfDocument);
});

test('late native workspace completion cannot dismiss an ongoing or failed enhancement', async () => {
  for (const enhancementState of ['running', 'blocked', 'error']) {
    const h = harness();
    h.setPdfEnhancementState(enhancementState, enhancementState === 'error' ? 'enhancement failed' : '');
    const structure = h.context.__brevessNativePdfDocument.structure;
    const prepared = { documentId: structure.documentId,
      record: { documentHash: structure.documentHash } };
    Object.assign(h.context, {
      activeNativePdfStructure: () => structure, initializeManualAnnotationUi() {},
      currentManualDocument: prepared,
      currentManualBlocks: [{ blockId: 'pdf-page-1', text: 'native text', element: { isConnected: true } }],
      manualDocumentEpochState: { lifecycleGeneration: 1 },
      articleWorkspaceLifecycleGeneration: 1,
      prepareManualDocument: async () => prepared,
      ensureCurrentArticleWorkspace: async () => ({ workspaceId: 'workspace-a' }),
      loadNativePdfWorkspaceCheckpoint: async () => {}, loadNativePdfRegexRestoreFromWorkspace: async () => {},
      persistArticleWorkspaceArtifacts: async () => {}, buildArticleWorkspaceBaselineAssets: () => []
    });
    vm.runInContext(slice(content, 'let nativePdfWorkspacePreparation = null;', 'function nativePdfRegexRestoreReadiness(') +
      '\nglobalThis.prepare = prepareNativePdfWorkspace;', h.context);
    await h.context.prepare();
    assert.equal(h.document.documentElement.dataset.pdfWorkspaceReady, 'true');
    assert.equal(h.document.documentElement.dataset.pdfEnhancementState, enhancementState);
    assert.equal(h.element('pdfReaderControl').hidden, false);
    assert.equal(h.element('pdfReaderControl').dataset.state, enhancementState === 'running' ? 'loading' : 'error');
  }
});

test('native workspace refuses to announce readiness when manual document proof stays empty', async () => {
  const h = harness();
  const structure = h.context.__brevessNativePdfDocument.structure;
  let prepareCalls = 0;
  let workspaceCalls = 0;
  Object.assign(h.document.documentElement.dataset, {
    pdfWorkspaceReady: 'false', pdfWorkspaceIndexed: 'false', pdfWorkspaceRendered: 'false'
  });
  Object.assign(h.context, {
    activeNativePdfStructure: () => structure,
    initializeManualAnnotationUi() {},
    currentManualDocument: null,
    currentManualBlocks: [],
    manualDocumentEpochState: { lifecycleGeneration: 1 },
    articleWorkspaceLifecycleGeneration: 1,
    prepareManualDocument: async () => { prepareCalls += 1; return undefined; },
    ensureCurrentArticleWorkspace: async () => { workspaceCalls += 1; return { workspaceId: 'workspace-a' }; },
    loadNativePdfWorkspaceCheckpoint: async () => {},
    loadNativePdfRegexRestoreFromWorkspace: async () => {},
    persistArticleWorkspaceArtifacts: async () => {},
    buildArticleWorkspaceBaselineAssets: () => []
  });
  vm.runInContext(slice(content, 'let nativePdfWorkspacePreparation = null;',
    'function nativePdfRegexRestoreReadiness(') +
    '\nglobalThis.prepare = prepareNativePdfWorkspace;', h.context);

  await h.context.prepare();

  assert.equal(prepareCalls, 2, 'the coordinator makes one bounded retry');
  assert.equal(workspaceCalls, 0, 'durable workspace work cannot start without manual proof');
  assert.equal(h.document.documentElement.dataset.pdfWorkspaceReady, 'false');
  assert.equal(h.document.documentElement.dataset.pdfWorkspaceIndexed, 'false');
  assert.equal(h.document.documentElement.dataset.pdfWorkspaceRendered, 'false');
  assert.equal(h.messages.some(message => message.type === 'PDF_WORKSPACE_INDEXED'), false);
});

test('cached native workspace completion repairs a missing manual document before reuse', async () => {
  const h = harness();
  const structure = h.context.__brevessNativePdfDocument.structure;
  let prepareCalls = 0;
  let workspaceCalls = 0;
  const prepared = () => ({
    documentId: structure.documentId,
    record: { documentHash: structure.documentHash }
  });
  Object.assign(h.context, {
    activeNativePdfStructure: () => structure,
    initializeManualAnnotationUi() {},
    currentManualDocument: null,
    currentManualBlocks: [],
    manualDocumentEpochState: { lifecycleGeneration: 1 },
    articleWorkspaceLifecycleGeneration: 1,
    prepareManualDocument: async () => {
      prepareCalls += 1;
      const value = prepared();
      h.context.currentManualDocument = value;
      h.context.currentManualBlocks = [{ blockId: 'pdf-page-1', text: 'native text',
        element: { isConnected: true } }];
      return value;
    },
    ensureCurrentArticleWorkspace: async () => {
      workspaceCalls += 1;
      return { workspaceId: 'workspace-a' };
    },
    loadNativePdfWorkspaceCheckpoint: async () => {},
    loadNativePdfRegexRestoreFromWorkspace: async () => {},
    persistArticleWorkspaceArtifacts: async () => {},
    buildArticleWorkspaceBaselineAssets: () => []
  });
  vm.runInContext(slice(content, 'let nativePdfWorkspacePreparation = null;',
    'function nativePdfRegexRestoreReadiness(') +
    '\nglobalThis.prepare = prepareNativePdfWorkspace;', h.context);

  await h.context.prepare();
  assert.equal(prepareCalls, 1);
  h.context.currentManualDocument = null;
  h.context.currentManualBlocks = [];
  await h.context.prepare();

  assert.equal(prepareCalls, 2,
    'same-key workspace reuse must repair the missing manual document proof');
  assert.equal(workspaceCalls, 2,
    'the repaired proof is persisted under a fresh coordinator run');
  assert.equal(h.document.documentElement.dataset.pdfWorkspaceReady, 'true');
});

test('cancelled Figure health check cannot start a late extraction or restore a busy banner', async () => {
  const h = harness(); const health = deferred(); const status = [];
  let extractions = 0;
  h.context.SciLLM.createPdfFigureNativeClient = () => ({ health: () => health.promise,
    extract() { extractions++; }, disconnect() {} });
  h.context.setPdfFigureEngineStatus = (...args) => status.push(args);
  vm.runInContext(slice(reader, '  async function extractWholePdfFigures(', '  function wait(') +
    '\nglobalThis.extract = extractWholePdfFigures;', h.context);
  const extraction = h.context.extract(0);
  h.state.nativeFigureAbortController.abort(); health.resolve({ available: true });
  await assert.rejects(extraction, { name: 'AbortError' });
  assert.equal(extractions, 0);
  assert.equal(status.length, 0);
});
