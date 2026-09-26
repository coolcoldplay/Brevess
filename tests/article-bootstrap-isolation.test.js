const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const figureWorkspace = require('../core/figure-workspace.js');

const contentSource = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

function loadContentFunctions(names, dependencies = {}) {
  const context = vm.createContext({ console, ...dependencies });
  for (const name of names) {
    let start = contentSource.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `missing production function ${name}`);
    if (contentSource.slice(start - 6, start) === 'async ') start -= 6;
    const signatureEnd = contentSource.indexOf(') {', start);
    assert.ok(signatureEnd >= 0, `missing production signature ${name}`);
    const bodyStart = signatureEnd + 2;
    let depth = 0;
    let end = -1;
    for (let index = bodyStart; index < contentSource.length; index += 1) {
      if (contentSource[index] === '{') depth += 1;
      if (contentSource[index] === '}') depth -= 1;
      if (depth === 0) { end = index; break; }
    }
    assert.ok(end >= 0, `unterminated production function ${name}`);
    vm.runInContext(contentSource.slice(start, end + 1), context);
  }
  return context;
}

function loadWorkspaceSnapshotMessageListener(dependencies = {}) {
  const context = vm.createContext({ console, ...dependencies });
  const strategyName = 'maintainArticleStructureObserverAfterWorkspaceSnapshot';
  const strategyStart = contentSource.indexOf(`function ${strategyName}(`);
  if (strategyStart >= 0) {
    const strategyEnd = contentSource.indexOf('\n}', strategyStart);
    vm.runInContext(contentSource.slice(strategyStart, strategyEnd + 2), context);
  }
  const prefix = 'chrome.runtime.onMessage.addListener(';
  const listenerStart = contentSource.indexOf(prefix);
  const returnIndex = contentSource.indexOf('return true; // 保持消息通道开放', listenerStart);
  const listenerEnd = contentSource.indexOf('\n});', returnIndex);
  assert.ok(listenerStart >= 0 && returnIndex > listenerStart && listenerEnd > returnIndex,
    'content message listener is missing');
  const callback = contentSource.slice(listenerStart + prefix.length, listenerEnd + 2);
  vm.runInContext(`globalThis.__workspaceMessageListener = ${callback};`, context);
  return context;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function canonicalUrl(value) {
  const url = new URL(String(value));
  url.hash = '';
  return url.href;
}

test('manual message failures preserve the background error code', async () => {
  const context = loadContentFunctions(['sendManualMessage'], {
    chrome: { runtime: { sendMessage: async () => ({
      success: false,
      error: { code: 'PDF_DOCUMENT_IDENTITY_MISMATCH', message: 'identity mismatch' }
    }) } }
  });
  await assert.rejects(context.sendManualMessage({ type: 'DOCUMENT_PREPARE' }),
    error => error?.code === 'PDF_DOCUMENT_IDENTITY_MISMATCH' &&
      error?.message === 'identity mismatch');
});

async function invokeWorkspaceSnapshotMessage(context) {
  return new Promise((resolve, reject) => {
    const keepOpen = context.__workspaceMessageListener(
      { action: 'getArticleWorkspaceSnapshot' }, {}, resolve
    );
    assert.equal(keepOpen, true);
    setTimeout(() => reject(new Error('workspace snapshot response timed out')), 1000);
  });
}

test('successful native snapshot message keeps the HTML observer stopped across virtual mutations', async () => {
  let starts = 0;
  let stops = 0;
  const structure = { adapterId: 'pdf-native', paragraphs: [{ text: 'PDF' }] };
  const context = loadWorkspaceSnapshotMessageListener({
    ensureGlobalAbbreviationMemory: async () => ({}),
    globalAbbreviationMemory: {},
    readArticleWorkspaceSnapshot: async () => ({ documentId: 'pdf-document' }),
    articleStructureObserver: null,
    activeNativePdfStructure: () => structure,
    startArticleStructureObserver() {},
    stopArticleStructureObserver() {},
    withCurrentPdfSemanticNavigation: response => ({
      ...response, pdfSemanticNavigation: { documentId: 'pdf-document' }
    })
  });
  context.articleStructureChangeSequence = 19;
  context.startArticleStructureObserver = () => {
    starts += 1;
    context.articleStructureObserver = {
      simulateVirtualTextLayerMutation() {
        context.articleStructureChangeSequence += 1;
      }
    };
  };
  context.stopArticleStructureObserver = () => {
    stops += 1;
    context.articleStructureObserver = null;
  };

  const response = await invokeWorkspaceSnapshotMessage(context);
  context.articleStructureObserver?.simulateVirtualTextLayerMutation();
  assert.equal(response.success, true);
  assert.equal(starts, 0);
  assert.equal(context.articleStructureObserver, null);
  assert.equal(context.articleStructureChangeSequence, 19);
  assert.ok(stops <= 1);
});

test('successful HTML and legacy PDF snapshot messages retain observer startup', async () => {
  for (const mode of ['html', 'legacy-pdf']) {
    let starts = 0;
    const context = loadWorkspaceSnapshotMessageListener({
      ensureGlobalAbbreviationMemory: async () => ({}),
      globalAbbreviationMemory: {},
      readArticleWorkspaceSnapshot: async () => ({ documentId: `${mode}-document` }),
      articleStructureObserver: null,
      activeNativePdfStructure: () => null,
      startArticleStructureObserver() { starts += 1; },
      stopArticleStructureObserver() {},
      withCurrentPdfSemanticNavigation: response => ({
        ...response, pdfSemanticNavigation: null
      })
    });
    const response = await invokeWorkspaceSnapshotMessage(context);
    assert.equal(response.success, true);
    assert.equal(starts, 1, `${mode} must preserve the HTML observer policy`);
  }
});

test('manual preparation is isolated by article URL and a late A completion cannot clear the pending B lease', async () => {
  let href = 'https://example.test/article-a';
  const preparations = [];
  const context = loadContentFunctions(['prepareManualDocument'], {
    effectiveArticlePageUrl: () => href,
    activeNativePdfStructure: () => null,
    currentManualDocument: null,
    manualPreparedHref: '',
    manualPreparedContentSequence: -1,
    articleStructureChangeSequence: 0,
    manualDocumentEpochState: { lifecycleGeneration: 0 },
    articleWorkspaceLifecycleGeneration: 1,
    currentManualBlocks: [],
    manualPreparePromise: null,
    scheduleManualSelectionInspection() {},
    prepareManualDocumentFresh(articleHref) {
      const pending = deferred();
      preparations.push({ articleHref, ...pending });
      return pending.promise;
    }
  });

  const articleA = context.prepareManualDocument();
  assert.equal(preparations.length, 1);
  assert.equal(context.manualPreparePromise.articleHref, 'https://example.test/article-a');

  href = 'https://example.test/article-b';
  const articleB = context.prepareManualDocument();
  assert.equal(preparations.length, 2, 'B must not reuse the unresolved A preparation');
  assert.notEqual(preparations[0].promise, preparations[1].promise);
  assert.equal(context.manualPreparePromise.articleHref, 'https://example.test/article-b');

  preparations[0].resolve({ documentId: 'document-a' });
  assert.equal((await articleA).documentId, 'document-a');
  assert.equal(context.manualPreparePromise.articleHref, 'https://example.test/article-b',
    'the stale A finally block must not release B\'s lease');

  preparations[1].resolve({ documentId: 'document-b' });
  assert.equal((await articleB).documentId, 'document-b');
  assert.equal(context.manualPreparePromise, null);
});

test('connected manual blocks are not reusable after same-URL article text changes', async () => {
  const fresh = deferred();
  let preparations = 0;
  const oldDocument = { documentId: 'old-document' };
  const context = loadContentFunctions(['prepareManualDocument'], {
    effectiveArticlePageUrl: () => 'https://example.test/article-a',
    activeNativePdfStructure: () => null,
    currentManualDocument: oldDocument,
    manualPreparedHref: 'https://example.test/article-a',
    manualPreparedContentSequence: 3,
    articleStructureChangeSequence: 4,
    manualDocumentEpochState: { lifecycleGeneration: 2 },
    articleWorkspaceLifecycleGeneration: 2,
    currentManualBlocks: [{ blockId: 'old:1', element: { isConnected: true } }],
    manualPreparePromise: null,
    scheduleManualSelectionInspection() {},
    prepareManualDocumentFresh() {
      preparations += 1;
      return fresh.promise;
    }
  });

  const pending = context.prepareManualDocument();
  assert.equal(preparations, 1, 'a new content sequence must bypass connected stale blocks');
  fresh.resolve({ documentId: 'new-document' });
  assert.equal((await pending).documentId, 'new-document');
});

test('manual DOM text rewrites are ignored without hiding later publisher text changes', () => {
  const queuedMicrotasks = [];
  const paragraph = {
    nodeType: 1,
    isConnected: true,
    parentElement: null,
    matches: selector => selector.includes('p'),
    closest: () => null,
    querySelector: () => null,
    contains(node) { return node === this || node?.parentElement === this; }
  };
  const textNode = { nodeType: 3, parentElement: paragraph };
  const internalRoots = new Set();
  const context = loadContentFunctions([
    'withArticleStructureInternalRewriteRoots', 'isArticleStructureMutation'
  ], {
    Node: { ELEMENT_NODE: 1 },
    SciLLM: { selectPublisherAdapter: () => null },
    articleStructureBoundaryRoots: new Map(),
    articleStructureInternalRewriteRoots: internalRoots,
    queueMicrotask: callback => queuedMicrotasks.push(callback)
  });
  const mutation = { type: 'characterData', target: textNode };
  let classifiedDuringRewrite;
  context.withArticleStructureInternalRewriteRoots([paragraph], () => {
    classifiedDuringRewrite = context.isArticleStructureMutation(mutation);
  });
  assert.equal(classifiedDuringRewrite, false,
    'manual mark wrapping must not advance the article content epoch');
  assert.equal(context.isArticleStructureMutation(mutation), false,
    'the rewrite root must stay protected until MutationObserver delivery');
  assert.equal(queuedMicrotasks.length, 1);
  queuedMicrotasks.shift()();
  assert.equal(context.isArticleStructureMutation(mutation), true,
    'the same text node must invalidate once it is no longer owned by a plugin rewrite');
});

test('manual preparation reports failures only to callers that request an accurate code', async () => {
  const failure = Object.assign(new Error('native prepare rejected'), {
    code: 'PDF_DOCUMENT_PREPARE_REJECTED'
  });
  const context = loadContentFunctions(['prepareManualDocument'], {
    effectiveArticlePageUrl: () => 'brevess-local-pdf://document-a',
    activeNativePdfStructure: () => null,
    currentManualDocument: null,
    manualPreparedHref: '',
    manualPreparedContentSequence: -1,
    articleStructureChangeSequence: 0,
    manualDocumentEpochState: { lifecycleGeneration: 0 },
    articleWorkspaceLifecycleGeneration: 1,
    currentManualBlocks: [],
    manualPreparePromise: null,
    scheduleManualSelectionInspection() {},
    prepareManualDocumentFresh: async () => { throw failure; }
  });

  assert.equal(await context.prepareManualDocument(), undefined,
    'automatic UI preparation keeps its historical non-throwing contract');
  await assert.rejects(
    context.prepareManualDocument({ throwOnError: true }),
    error => error?.code === 'PDF_DOCUMENT_PREPARE_REJECTED'
  );
});

test('concurrent automatic manual preparation waiters keep the non-throwing contract', async () => {
  const pending = deferred();
  const failure = Object.assign(new Error('native prepare rejected'), {
    code: 'PDF_DOCUMENT_PREPARE_REJECTED'
  });
  const context = loadContentFunctions(['prepareManualDocument'], {
    effectiveArticlePageUrl: () => 'brevess-local-pdf://document-a',
    activeNativePdfStructure: () => null,
    currentManualDocument: null,
    manualPreparedHref: '',
    manualPreparedContentSequence: -1,
    articleStructureChangeSequence: 0,
    manualDocumentEpochState: { lifecycleGeneration: 0 },
    articleWorkspaceLifecycleGeneration: 1,
    currentManualBlocks: [],
    manualPreparePromise: null,
    scheduleManualSelectionInspection() {},
    prepareManualDocumentFresh: () => pending.promise
  });

  const automaticA = context.prepareManualDocument();
  const automaticB = context.prepareManualDocument();
  const strict = context.prepareManualDocument({ throwOnError: true });
  pending.reject(failure);
  assert.equal(await automaticA, undefined);
  assert.equal(await automaticB, undefined);
  await assert.rejects(strict, error => error?.code === failure.code);
});

test('a late manual preparation cannot commit after the URL or workspace lifecycle changes', async () => {
  let href = 'https://example.test/article-a';
  const preparedResponse = deferred();
  let appliedSettings = 0;
  let restoredAnnotations = 0;
  let epochCommits = 0;
  const context = loadContentFunctions(['prepareManualDocumentFresh'], {
    effectiveArticlePageUrl: () => href,
    activeNativePdfStructure: () => null,
    manualPrepareSequence: 0,
    articleWorkspaceLifecycleGeneration: 4,
    articleStructureChangeSequence: 0,
    manualUiLifecycle: {
      beginDocument: key => ({ key }),
      retain() {},
      isCurrent: () => true
    },
    freezeManualDocumentInteraction() {},
    manualPreparedHref: '',
    currentManualDocument: null,
    currentManualBlocks: [],
    manualDocumentEpochState: { lifecycleGeneration: 0 },
    manualPreparedContentSequence: -1,
    getManualDocumentInputAndBlocks: () => ({
      input: { paragraphs: [{ paragraphId: 'a:1', text: 'article A' }] },
      blocks: [{ blockId: 'a:1', element: { isConnected: true } }]
    }),
    scheduleManualSelectionInspection() {},
    sendManualMessage(message) {
      if (message.type === 'DOCUMENT_PREPARE') return preparedResponse.promise;
      return Promise.resolve({ availableCategories: [] });
    },
    nextManualDocumentEpochState() {
      epochCommits += 1;
      return { lifecycleGeneration: 4 };
    },
    applyManualAnalysisSettings() { appliedSettings += 1; },
    currentManualCategories: [],
    currentManualActiveCategories: [],
    uniqueManualCategories: value => value,
    manualCategoriesForAnalysisMode: () => [],
    currentManualAnalysisModeId: 'default',
    restoreManualAnnotations() { restoredAnnotations += 1; },
    showManualStatus() {}
  });

  const pending = context.prepareManualDocumentFresh(href);
  href = 'https://example.test/article-b';
  context.articleWorkspaceLifecycleGeneration += 1;
  preparedResponse.resolve({
    documentId: 'document-a', activeCategories: [], record: { annotations: [] }
  });

  assert.equal(await pending, undefined);
  assert.equal(context.currentManualDocument, null);
  assert.equal(context.manualPreparedHref, '');
  assert.equal(epochCommits, 0);
  assert.equal(appliedSettings, 0);
  assert.equal(restoredAnnotations, 0);
});

test('native PDF preparation survives virtual text-layer mutations for the same binary generation', async () => {
  const binaryHash = 'a'.repeat(64);
  const structure = {
    documentId: `sha256:${binaryHash}`,
    documentHash: binaryHash,
    revision: 4,
    paragraphs: [{ paragraphId: 'pdf-page-1', text: 'stable native page text' }]
  };
  const preparedResponse = deferred();
  const block = {
    blockId: 'pdf-page-1',
    text: 'stable native page text',
    element: { isConnected: true }
  };
  const context = loadContentFunctions(['prepareManualDocumentFresh'], {
    effectiveArticlePageUrl: () => 'chrome-extension://test/pdf-reader.html',
    activeNativePdfStructure: () => structure,
    __brevessNativePdfDocument: {
      structure,
      documentGeneration: 7,
      phase: 'text-ready'
    },
    manualPrepareSequence: 0,
    articleWorkspaceLifecycleGeneration: 5,
    articleStructureChangeSequence: 10,
    manualUiLifecycle: {
      beginDocument: key => ({ key }),
      retain() {},
      isCurrent: () => true
    },
    freezeManualDocumentInteraction() {},
    manualPreparedHref: '',
    currentManualDocument: null,
    currentManualBlocks: [],
    manualDocumentEpochState: { lifecycleGeneration: 0 },
    manualPreparedContentSequence: -1,
    getManualDocumentInputAndBlocks: () => ({
      input: { paragraphs: structure.paragraphs },
      blocks: [block]
    }),
    scheduleManualSelectionInspection() {},
    sendManualMessage(message) {
      if (message.type === 'DOCUMENT_PREPARE') return preparedResponse.promise;
      return Promise.resolve({ availableCategories: [] });
    },
    nextManualDocumentEpochState: () => ({ documentEpoch: 1, lifecycleGeneration: 5 }),
    applyManualAnalysisSettings() {},
    currentManualCategories: [],
    currentManualActiveCategories: [],
    uniqueManualCategories: value => value,
    manualCategoriesForAnalysisMode: () => [],
    currentManualAnalysisModeId: 'default',
    restoreManualAnnotations() {},
    showManualStatus() {}
  });

  const pending = context.prepareManualDocumentFresh(
    'chrome-extension://test/pdf-reader.html'
  );
  context.articleStructureChangeSequence += 1;
  preparedResponse.resolve({
    documentId: structure.documentId,
    activeCategories: [],
    record: {
      documentHash: binaryHash,
      canonicalUrl: 'chrome-extension://test/pdf-reader.html',
      annotations: []
    }
  });

  const prepared = await pending;
  assert.equal(prepared?.documentId, structure.documentId,
    'PDF.js text-layer mount/unmount must not invalidate the same native binary');
  assert.equal(context.currentManualDocument?.record?.documentHash, binaryHash);
  assert.equal(context.manualPreparedContentSequence, 10,
    'the committed proof records the source sequence captured at preparation start');
});

test('failed same-generation native preparation preserves the current manual document and exact code', async () => {
  const binaryHash = 'c'.repeat(64);
  const sourceUrl = `brevess-local-pdf://${binaryHash}`;
  const structure = {
    documentId: `sha256:${binaryHash}`,
    documentHash: binaryHash,
    revision: 24,
    paragraphs: [{ paragraphId: 'pdf-page-1', text: 'stable native text' }]
  };
  const previousDocument = {
    documentId: structure.documentId,
    record: { documentHash: binaryHash, canonicalUrl: sourceUrl, annotations: [] }
  };
  const previousBlocks = [{ blockId: 'pdf-page-1', text: 'stable native text',
    element: { isConnected: true } }];
  let freezes = 0;
  const context = loadContentFunctions(['prepareManualDocumentFresh'], {
    effectiveArticlePageUrl: () => sourceUrl,
    activeNativePdfStructure: () => structure,
    __brevessNativePdfDocument: { structure, documentGeneration: 3, phase: 'text-ready' },
    manualPrepareSequence: 0,
    articleWorkspaceLifecycleGeneration: 1,
    articleStructureChangeSequence: 0,
    manualUiLifecycle: {
      beginDocument: key => ({ key }), retain() {}, isCurrent: () => true
    },
    freezeManualDocumentInteraction() {
      freezes += 1;
      context.currentManualDocument = null;
      context.currentManualBlocks = [];
    },
    manualPreparedHref: sourceUrl,
    currentManualDocument: previousDocument,
    currentManualBlocks: previousBlocks,
    manualDocumentEpochState: { documentEpoch: 1, lifecycleGeneration: 1 },
    manualPreparedContentSequence: 0,
    getManualDocumentInputAndBlocks: () => ({
      input: { nativePdfIdentity: { documentId: structure.documentId,
        documentHash: binaryHash }, paragraphs: structure.paragraphs },
      blocks: previousBlocks
    }),
    scheduleManualSelectionInspection() {},
    sendManualMessage(message) {
      if (message.type === 'DOCUMENT_PREPARE') {
        throw Object.assign(new Error('native prepare rejected'), {
          code: 'PDF_DOCUMENT_PREPARE_REJECTED'
        });
      }
      return Promise.resolve({ availableCategories: [] });
    },
    showManualStatus() {}
  });

  await assert.rejects(context.prepareManualDocumentFresh(sourceUrl),
    error => error?.code === 'PDF_DOCUMENT_PREPARE_REJECTED');
  assert.equal(freezes, 0);
  assert.equal(context.currentManualDocument, previousDocument);
  assert.equal(context.currentManualBlocks, previousBlocks);
});

test('same-document HTML reprepare keeps persisted marks until replacement commits', async () => {
  const sourceUrl = 'https://example.test/article-a';
  const previousDocument = {
    documentId: 'document-a',
    record: { canonicalUrl: sourceUrl, annotations: [{ annotationId: 'kept' }] }
  };
  const previousBlocks = [{ blockId: 'p1', text: 'stable text',
    element: { isConnected: true } }];
  let freezes = 0;
  const context = loadContentFunctions(['prepareManualDocumentFresh'], {
    effectiveArticlePageUrl: () => sourceUrl,
    activeNativePdfStructure: () => null,
    manualPrepareSequence: 0,
    articleWorkspaceLifecycleGeneration: 1,
    articleStructureChangeSequence: 2,
    manualUiLifecycle: {
      beginDocument: key => ({ key }), retain() {}, isCurrent: () => true
    },
    freezeManualDocumentInteraction() {
      freezes += 1;
      context.currentManualDocument = null;
      context.currentManualBlocks = [];
    },
    manualPreparedHref: sourceUrl,
    currentManualDocument: previousDocument,
    currentManualBlocks: previousBlocks,
    manualDocumentEpochState: { documentEpoch: 1, lifecycleGeneration: 1 },
    manualPreparedContentSequence: 1,
    getManualDocumentInputAndBlocks: () => ({
      input: { paragraphs: [{ paragraphId: 'p1', text: 'stable text' }] },
      blocks: previousBlocks
    }),
    scheduleManualSelectionInspection() {},
    sendManualMessage(message) {
      if (message.type === 'DOCUMENT_PREPARE') {
        throw Object.assign(new Error('prepare rejected'), { code: 'DOCUMENT_PREPARE_REJECTED' });
      }
      return Promise.resolve({ availableCategories: [] });
    },
    showManualStatus() {}
  });

  await assert.rejects(context.prepareManualDocumentFresh(sourceUrl),
    error => error?.code === 'DOCUMENT_PREPARE_REJECTED');
  assert.equal(freezes, 0);
  assert.equal(context.currentManualDocument, previousDocument);
  assert.equal(context.currentManualBlocks, previousBlocks);
});

function readerDependencies(extra = {}) {
  const manual = { documentId: 'document-b' };
  const binding = {
    documentId: 'document-b', documentHash: 'hash-b',
    canonicalUrl: 'https://example.test/article-b',
    workspaceId: 'workspace-b', workspaceGeneration: 2
  };
  return {
    waitForArticleStructureReady: async () => {},
    canonicalArticlePreindexUrl: value => canonicalUrl(value || 'https://example.test/article-b'),
    currentArticleWorkspaceReadUrl: () => canonicalUrl('https://example.test/article-b'),
    articleStructureChangeSequence: 7,
    articleExtractionCache: {},
    getFigureWorkspaceInventory() {},
    extractCurrentArticleStructure: () => ({ paragraphs: [{ paragraphId: 'b:1', text: 'body B' }] }),
    prepareManualDocument: async () => manual,
    currentManualDocument: manual,
    manualPreparedHref: 'https://example.test/article-b',
    ensureCurrentArticleWorkspace: async () => ({ workspaceId: 'workspace-b' }),
    refreshSupplementalFigureAssets: async () => {},
    supplementalFigureAssets: [],
    combinedFigureWorkspaceInventory: () => [],
    populateFigureWorkspaceDraft() {},
    currentFigureWorkspaceRefreshBinding: () => binding,
    articleWorkspaceLifecycleGeneration: 8,
    articleStructureWaiting: false,
    figureWorkspaceInventoryEpoch: 0,
    figureWorkspaceInventorySeedPromise: Promise.resolve(),
    assertCurrentArticleWorkspaceLifecycle(value) { assert.equal(value, 8); },
    sameFigureWorkspaceRefreshBinding: (left, right) =>
      JSON.stringify(left) === JSON.stringify(right),
    buildArticleWorkspaceSnapshot: () => ({
      title: 'Article B', revision: 7,
      paragraphs: [{ paragraphId: 'b:1', text: 'body B' }],
      nodes: [{ nodeId: 'b' }],
      figures: { draft: { revision: 1 }, figures: [] }
    }),
    ensureFigureWorkspaceInventorySeeded: async () => {},
    articleWorkspaceLifecycleError: () => Object.assign(new Error('stale'), { code: 'CANCELLED' }),
    articlePublicPreviewNotice: () => null,
    document: { readyState: 'complete' },
    ...extra
  };
}

test('full PDF article reads restore confirmed artwork pages before returning the sidebar catalog', async () => {
  const figure = { figureId: 'figure-1', artworkPageNumbers: [6], artworkCoverage: 'partial' };
  let restores = 0;
  const context = loadContentFunctions(['readArticleWorkspaceSnapshot'], readerDependencies({
    __brevessNativePdfFigures: { figures: [figure] },
    restoreNativePdfFigureArtworkSelection: async current => {
      assert.equal(current, figure);
      await Promise.resolve();
      restores += 1;
      current.artworkPageNumbers = [5, 6];
      current.artworkCoverage = 'complete';
    },
    buildArticleWorkspaceSnapshot: () => ({
      figures: { figures: [{ ...figure, artworkPageNumbers: [...figure.artworkPageNumbers] }] }
    })
  }));
  const snapshot = await context.readArticleWorkspaceSnapshot();
  assert.equal(restores, 1);
  assert.deepEqual(snapshot.figures.figures[0].artworkPageNumbers, [5, 6]);
  assert.equal(snapshot.figures.figures[0].artworkCoverage, 'complete');
});

test('a failed B preparation cannot leak the old A identity into a workspace read', async () => {
  const oldA = { documentId: 'document-a' };
  let workspaceReads = 0;
  let snapshotBuilds = 0;
  const context = loadContentFunctions(['readArticleWorkspaceSnapshot'], readerDependencies({
    currentManualDocument: oldA,
    manualPreparedHref: 'https://example.test/article-a',
    prepareManualDocument: async () => undefined,
    ensureCurrentArticleWorkspace: async () => { workspaceReads += 1; return {}; },
    buildArticleWorkspaceSnapshot: () => {
      snapshotBuilds += 1;
      return { documentId: 'document-a', figures: { draft: { binding: { documentId: 'document-a' } } } };
    }
  }));

  await assert.rejects(context.readArticleWorkspaceSnapshot(), error =>
    error?.code === 'ARTICLE_DOCUMENT_PREPARE_FAILED');
  assert.equal(workspaceReads, 0);
  assert.equal(snapshotBuilds, 0);
  assert.equal(context.currentManualDocument.documentId, 'document-a',
    'failure may leave the old cache in memory, but the read must never publish it as B');
});

test('workspace lifecycle replacement during prepare reports a retryable page change before identity failure', async () => {
  const preparing = deferred();
  const prepareStarted = deferred();
  const oldA = { documentId: 'document-a' };
  let workspaceReads = 0;
  let snapshotBuilds = 0;
  const context = loadContentFunctions(['readArticleWorkspaceSnapshot'], readerDependencies({
    currentManualDocument: oldA,
    manualPreparedHref: 'https://example.test/article-a',
    prepareManualDocument: () => {
      prepareStarted.resolve();
      return preparing.promise;
    },
    ensureCurrentArticleWorkspace: async () => { workspaceReads += 1; return {}; },
    buildArticleWorkspaceSnapshot: () => {
      snapshotBuilds += 1;
      return { documentId: 'document-a', figures: { draft: null, figures: [] } };
    }
  }));

  const reading = context.readArticleWorkspaceSnapshot();
  await prepareStarted.promise;
  context.articleWorkspaceLifecycleGeneration += 1;
  preparing.resolve(undefined);
  await assert.rejects(reading, error => error?.code === 'ARTICLE_PAGE_LOADING');
  assert.equal(context.articleStructureWaiting, true);
  assert.equal(workspaceReads, 0);
  assert.equal(snapshotBuilds, 0);
  assert.equal(context.currentManualDocument, oldA);
});

test('workspace lifecycle replacement during supplemental refresh cannot publish the stale workspace', async () => {
  const refreshStarted = deferred();
  const refreshRelease = deferred();
  const staleWorkspace = { workspaceId: 'workspace-b' };
  let draftWrites = 0;
  let seedAttempts = 0;
  let snapshotBuilds = 0;
  const context = loadContentFunctions(['readArticleWorkspaceSnapshot'], readerDependencies({
    ensureCurrentArticleWorkspace: async () => staleWorkspace,
    refreshSupplementalFigureAssets: async workspace => {
      assert.equal(workspace, staleWorkspace);
      refreshStarted.resolve();
      await refreshRelease.promise;
    },
    populateFigureWorkspaceDraft() { draftWrites += 1; },
    ensureFigureWorkspaceInventorySeeded: async () => { seedAttempts += 1; },
    buildArticleWorkspaceSnapshot: () => {
      snapshotBuilds += 1;
      return {
        documentId: 'document-b',
        figures: { draft: { binding: { workspaceId: 'workspace-b' } }, figures: [] }
      };
    }
  }));

  const reading = context.readArticleWorkspaceSnapshot();
  await refreshStarted.promise;
  context.articleWorkspaceLifecycleGeneration += 1;
  refreshRelease.resolve();

  await assert.rejects(reading, error => error?.code === 'ARTICLE_PAGE_LOADING');
  assert.equal(context.articleStructureWaiting, true);
  assert.equal(draftWrites, 0);
  assert.equal(seedAttempts, 0);
  assert.equal(snapshotBuilds, 0);
});

test('snapshot supplemental refresh keeps one workspace binding across list, inventory read, and CAS', async t => {
  for (const racePoint of ['list', 'inventory-get', 'cas', 'cas-write-guard']) {
    await t.test(racePoint, async () => {
      const reachedRace = deferred();
      const releaseRace = deferred();
      const oldWorkspace = { workspaceId: 'workspace-b', workspaceGeneration: 2 };
      const replacementWorkspace = { workspaceId: 'workspace-b-next', workspaceGeneration: 3 };
      const initialAssets = [{ materialId: 'already-current', figures: [] }];
      const sourceFigure = {
        figureId: 'supplemental-race-1', identityRevision: 2,
        figureLabel: 'Figure S1', isSupplemental: true
      };
      const listedAsset = {
        relativePath: 'figures/supplemental/material-race.json',
        content: {
          schemaVersion: 2, materialId: 'material-race',
          figures: racePoint.startsWith('cas') ? [sourceFigure] : []
        }
      };
      let context;
      let draftWrites = 0;
      let persistentWrites = 0;
      let casUsedBoundHelpers = false;
      let getCalls = 0;
      const dependencies = readerDependencies({
        currentArticleWorkspace: oldWorkspace,
        ensureCurrentArticleWorkspace: async () => context.currentArticleWorkspace,
        supplementalFigureAssets: initialAssets,
        supplementalFigureAssetsFingerprint: 'already-current-fingerprint',
        supplementalPdfBinding: null,
        SciLLM: {
          SUPPLEMENTAL_FIGURE_ASSET_PREFIX: 'figures/supplemental/'
        },
        articleWorkspaceSaveFrozen: false,
        articleWorkspaceRestorePersistenceGate: {
          allows: () => false,
          consume: () => false
        },
        articleWorkspaceAssetFingerprint: value => JSON.stringify(value),
        articleWorkspaceAssetFingerprints: new Map(),
        articleWorkspaceMutationTail: Promise.resolve(),
        issueFigureWorkspaceCommitGuard: () => '',
        revokeFigureWorkspaceCommitGuard() {},
        assertCurrentArticleWorkspaceLifecycle(expected) {
          if (expected !== context.articleWorkspaceLifecycleGeneration) {
            const error = new Error('ARTICLE_WORKSPACE_LIFECYCLE_CHANGED');
            error.code = 'CANCELLED';
            throw error;
          }
        },
        chrome: { runtime: { sendMessage: async message => {
          if (message.type === 'ARTICLE_WORKSPACE_LIST_ASSETS') {
            assert.equal(message.workspaceId, oldWorkspace.workspaceId);
            assert.equal(message.workspaceGeneration, oldWorkspace.workspaceGeneration);
            if (racePoint === 'list') {
              reachedRace.resolve();
              await releaseRace.promise;
            }
            return { success: true, data: { assets: [listedAsset] } };
          }
          if (message.type === 'ARTICLE_WORKSPACE_GET_ASSET') {
            assert.equal(message.workspaceId, oldWorkspace.workspaceId);
            assert.equal(message.workspaceGeneration, oldWorkspace.workspaceGeneration);
            getCalls += 1;
            if (racePoint === 'inventory-get' && getCalls === 1) {
              reachedRace.resolve();
              await releaseRace.promise;
            }
            return { success: true, data: { asset: {
              revision: 1, contentHash: '1'.repeat(64),
              content: { schemaVersion: 2, figures: [], figureTombstones: [] }
            } } };
          }
          if (message.type === 'ARTICLE_WORKSPACE_SAVE_ASSET') {
            persistentWrites += 1;
            return { success: true, data: {
              saved: true, revision: 2, contentHash: '2'.repeat(64)
            } };
          }
          throw new Error(`unexpected message ${message.type}`);
        } } },
        supplementalFigureIdentityDigest: async () => 'a'.repeat(64),
        reconcileSupplementalFigureAssetDeletions: async (asset, inventory, callbacks) => {
          if (racePoint.startsWith('cas')) {
            await callbacks.reviveNewer({ figure: sourceFigure, deletion: {
              figureId: sourceFigure.figureId, identityRevision: 3
            } });
          }
          return { asset, inventory, deletedFigureIds: [], revivedFigureIds: [] };
        },
        reconcileSupplementalFigureAssetReplicas: async (asset, inventory) => ({
          asset, inventory
        }),
        persistFigureInventoryWithCas: async (incoming, options = {}) => {
          casUsedBoundHelpers = typeof options.getAssetCheckpoint === 'function' &&
            typeof options.persistAssetCheckpoint === 'function';
          const readAsset = options.getAssetCheckpoint || context.getWorkspaceAssetCheckpoint;
          const writeAsset = options.persistAssetCheckpoint || context.persistWorkspaceAssetCheckpoint;
          if (racePoint === 'cas') {
            reachedRace.resolve();
            await releaseRace.promise;
          }
          await readAsset('figures/inventory.json');
          const persisted = await writeAsset('figures/inventory.json', incoming, { force: true });
          return { ...persisted, saved: true, content: incoming };
        },
        populateFigureWorkspaceDraft: async () => { draftWrites += 1; },
        crossFigureLogicState: { result: null },
        invalidateCrossFigureLogic() {}
      });
      context = loadContentFunctions([
        'persistWorkspaceAssetCheckpoint',
        'getWorkspaceAssetCheckpoint',
        'refreshSupplementalFigureAssets',
        'readArticleWorkspaceSnapshot'
      ], dependencies);
      if (racePoint === 'cas-write-guard') {
        context.persistWorkspaceAssetCheckpoint = async (_path, _content, options = {}) => {
          assert.equal(options.workspace.workspaceId, oldWorkspace.workspaceId);
          assert.equal(options.workspace.workspaceGeneration,
            oldWorkspace.workspaceGeneration);
          assert.equal(options.expectedLifecycle, 8);
          assert.equal(typeof options.commitGuard, 'function');
          reachedRace.resolve();
          await releaseRace.promise;
          options.commitGuard();
          persistentWrites += 1;
          return { saved: true };
        };
      }

      const reading = context.readArticleWorkspaceSnapshot();
      await reachedRace.promise;
      context.currentArticleWorkspace = replacementWorkspace;
      context.articleWorkspaceLifecycleGeneration += 1;
      releaseRace.resolve();

      await assert.rejects(reading, error => error?.code === 'ARTICLE_PAGE_LOADING');
      assert.equal(persistentWrites, 0);
      assert.equal(draftWrites, 0);
      assert.equal(context.supplementalFigureAssets, initialAssets);
      assert.equal(context.supplementalFigureAssetsFingerprint,
        'already-current-fingerprint');
      if (racePoint.startsWith('cas')) assert.equal(casUsedBoundHelpers, true);
    });
  }
});

test('supplemental reader reconciliation cannot fall through to the replacement local workspace', async () => {
  const reconcileStarted = deferred();
  const reconcileRelease = deferred();
  const oldWorkspace = { workspaceId: 'workspace-reader', workspaceGeneration: 4 };
  const replacementWorkspace = {
    workspaceId: 'workspace-reader-next', workspaceGeneration: 5
  };
  const parentWorkspace = { workspaceId: 'workspace-parent', workspaceGeneration: 9 };
  const binding = { materialId: 'reader-material' };
  const figure = { figureId: 'reader-supplemental-1', identityRevision: 1 };
  const initialAssets = [{ materialId: 'already-current', figures: [] }];
  let context;
  let localCasWrites = 0;
  let persistentWrites = 0;
  let draftWrites = 0;
  const dependencies = readerDependencies({
    currentArticleWorkspace: oldWorkspace,
    ensureCurrentArticleWorkspace: async () => context.currentArticleWorkspace,
    supplementalFigureAssets: initialAssets,
    supplementalFigureAssetsFingerprint: 'reader-current-fingerprint',
    supplementalPdfBinding: binding,
    supplementalParentWorkspaceTarget: () => parentWorkspace,
    SciLLM: {
      supplementalFigureAssetPath: () =>
        'figures/supplemental/reader-material.json'
    },
    assertCurrentArticleWorkspaceLifecycle(expected) {
      if (expected !== context.articleWorkspaceLifecycleGeneration) {
        const error = new Error('ARTICLE_WORKSPACE_LIFECYCLE_CHANGED');
        error.code = 'CANCELLED';
        throw error;
      }
    },
    chrome: { runtime: { sendMessage: async message => {
      if (message.type === 'ARTICLE_WORKSPACE_GET_ASSET') {
        assert.notEqual(message.workspaceId, replacementWorkspace.workspaceId);
        const local = message.workspaceId === oldWorkspace.workspaceId;
        assert.equal(message.workspaceGeneration,
          local ? oldWorkspace.workspaceGeneration : parentWorkspace.workspaceGeneration);
        return { success: true, data: { asset: {
          revision: 1, contentHash: '1'.repeat(64),
          content: {
            schemaVersion: 2,
            ...(local ? {} : { materialId: binding.materialId }),
            figures: [figure]
          }
        } } };
      }
      if (message.type === 'ARTICLE_WORKSPACE_SAVE_ASSET') {
        persistentWrites += 1;
        assert.notEqual(message.workspaceId, replacementWorkspace.workspaceId);
        return { success: true, data: { saved: true } };
      }
      throw new Error(`unexpected message ${message.type}`);
    } } },
    reconcileSupplementalReaderParentReplicas: async (_local, _parent, callbacks) => {
      reconcileStarted.resolve();
      await reconcileRelease.promise;
      await callbacks.persistLocal({ figure, expectedFigure: figure });
      return {
        local: { schemaVersion: 2, figures: [figure] },
        parent: { schemaVersion: 2, materialId: binding.materialId, figures: [figure] }
      };
    },
    persistFigureInventoryWithCas: async () => {
      localCasWrites += 1;
      return { saved: true };
    },
    normalizeRestoredFigureWorkspace: value => value,
    restoredFigureWorkspaceSnapshot: null,
    populateFigureWorkspaceDraft: async () => { draftWrites += 1; },
    crossFigureLogicState: { result: null },
    invalidateCrossFigureLogic() {}
  });
  context = loadContentFunctions([
    'getWorkspaceAssetCheckpoint',
    'reconcileSupplementalReaderParentWorkspace',
    'refreshSupplementalFigureAssets',
    'readArticleWorkspaceSnapshot'
  ], dependencies);

  const reading = context.readArticleWorkspaceSnapshot();
  await reconcileStarted.promise;
  context.currentArticleWorkspace = replacementWorkspace;
  context.articleWorkspaceLifecycleGeneration += 1;
  reconcileRelease.resolve();

  await assert.rejects(reading, error => error?.code === 'ARTICLE_PAGE_LOADING');
  assert.equal(localCasWrites, 0);
  assert.equal(persistentWrites, 0);
  assert.equal(draftWrites, 0);
  assert.equal(context.supplementalFigureAssets, initialAssets);
  assert.equal(context.supplementalFigureAssetsFingerprint,
    'reader-current-fingerprint');
});

test('parent supplemental saves use an origin lifecycle commit guard without local fingerprint pollution', async t => {
  for (const replaceDuringSave of [false, true]) {
    await t.test(replaceDuringSave ? 'stale origin' : 'current origin', async () => {
      const saveStarted = deferred();
      const saveRelease = deferred();
      const localWorkspace = { workspaceId: 'workspace-reader', workspaceGeneration: 4 };
      const replacementWorkspace = {
        workspaceId: 'workspace-reader-next', workspaceGeneration: 5
      };
      const parentWorkspace = { workspaceId: 'workspace-parent', workspaceGeneration: 9 };
      const binding = { materialId: 'reader-material' };
      const figure = { figureId: 'reader-parent-save-1', identityRevision: 2 };
      const fingerprintCache = new Map([['local-existing.json', 'local-fingerprint']]);
      let context;
      let capturedGuard = null;
      let parentCommits = 0;
      let draftWrites = 0;
      const dependencies = readerDependencies({
        currentArticleWorkspace: localWorkspace,
        ensureCurrentArticleWorkspace: async () => context.currentArticleWorkspace,
        supplementalFigureAssets: [],
        supplementalFigureAssetsFingerprint: '',
        supplementalPdfBinding: binding,
        supplementalParentWorkspaceTarget: () => parentWorkspace,
        SciLLM: {
          supplementalFigureAssetPath: () =>
            'figures/supplemental/reader-material.json'
        },
        articleWorkspaceSaveFrozen: false,
        articleWorkspaceRestorePersistenceGate: {
          allows: () => false,
          consume: () => false
        },
        articleWorkspaceAssetFingerprint: value => JSON.stringify(value),
        articleWorkspaceAssetFingerprints: fingerprintCache,
        articleWorkspaceMutationTail: Promise.resolve(),
        issueFigureWorkspaceCommitGuard: (guardBinding, guard) => {
          capturedGuard = { binding: guardBinding, guard };
          return 'figure-retry-guard-parent-save-0001';
        },
        revokeFigureWorkspaceCommitGuard() {},
        assertCurrentArticleWorkspaceLifecycle(expected) {
          if (expected !== context.articleWorkspaceLifecycleGeneration) {
            const error = new Error('ARTICLE_WORKSPACE_LIFECYCLE_CHANGED');
            error.code = 'CANCELLED';
            throw error;
          }
        },
        chrome: { runtime: { sendMessage: async message => {
          if (message.type === 'ARTICLE_WORKSPACE_GET_ASSET') {
            const local = message.workspaceId === localWorkspace.workspaceId;
            assert.equal(message.workspaceId,
              local ? localWorkspace.workspaceId : parentWorkspace.workspaceId);
            return { success: true, data: { asset: {
              revision: 1, contentHash: '1'.repeat(64),
              content: {
                schemaVersion: 2,
                ...(!local ? { materialId: binding.materialId } : {}),
                figures: [figure]
              }
            } } };
          }
          if (message.type === 'ARTICLE_WORKSPACE_SAVE_ASSET') {
            assert.equal(message.workspaceId, parentWorkspace.workspaceId);
            assert.equal(message.workspaceGeneration, parentWorkspace.workspaceGeneration);
            saveStarted.resolve();
            await saveRelease.promise;
            if (message.commitGuardId) {
              assert.equal(typeof capturedGuard?.guard, 'function');
              assert.equal(capturedGuard.binding.workspaceId, parentWorkspace.workspaceId);
              assert.equal(capturedGuard.binding.workspaceGeneration,
                parentWorkspace.workspaceGeneration);
              capturedGuard.guard();
            }
            parentCommits += 1;
            return { success: true, data: { saved: true } };
          }
          throw new Error(`unexpected message ${message.type}`);
        } } },
        reconcileSupplementalReaderParentReplicas: async (local, parent, callbacks) => {
          await callbacks.persistParent({ figure, expectedFigure: figure });
          return { local, parent };
        },
        persistFigureInventoryWithCas: async (incoming, options = {}) => {
          assert.equal(typeof options.getAssetCheckpoint, 'function');
          assert.equal(typeof options.persistAssetCheckpoint, 'function');
          const durable = await options.getAssetCheckpoint(
            'figures/supplemental/reader-material.json'
          );
          const persisted = await options.persistAssetCheckpoint(
            'figures/supplemental/reader-material.json', incoming, {
              force: true,
              requireDirectoryPersistence: true,
              expectedRevision: durable.revision,
              expectedContentHash: durable.contentHash
            }
          );
          return { ...persisted, saved: true, content: incoming };
        },
        normalizeRestoredFigureWorkspace: value => value,
        restoredFigureWorkspaceSnapshot: null,
        populateFigureWorkspaceDraft: async () => { draftWrites += 1; },
        crossFigureLogicState: { result: null },
        invalidateCrossFigureLogic() {}
      });
      context = loadContentFunctions([
        'persistWorkspaceAssetCheckpoint',
        'getWorkspaceAssetCheckpoint',
        'reconcileSupplementalReaderParentWorkspace',
        'refreshSupplementalFigureAssets',
        'readArticleWorkspaceSnapshot'
      ], dependencies);

      const reading = context.readArticleWorkspaceSnapshot();
      await saveStarted.promise;
      if (replaceDuringSave) {
        context.currentArticleWorkspace = replacementWorkspace;
        context.articleWorkspaceLifecycleGeneration += 1;
      }
      saveRelease.resolve();

      if (replaceDuringSave) {
        await assert.rejects(reading, error => error?.code === 'ARTICLE_PAGE_LOADING');
        assert.equal(parentCommits, 0);
        assert.equal(draftWrites, 0);
      } else {
        const snapshot = await reading;
        assert.equal(snapshot.localWorkspace.workspaceId, localWorkspace.workspaceId);
        assert.equal(parentCommits, 1);
        assert.ok(draftWrites >= 1);
      }
      assert.deepEqual([...fingerprintCache.entries()], [
        ['local-existing.json', 'local-fingerprint']
      ]);
    });
  }
});

test('snapshot message marks a prepare lifecycle change as retryable', async () => {
  const context = loadWorkspaceSnapshotMessageListener({
    ensureGlobalAbbreviationMemory: async () => ({}),
    globalAbbreviationMemory: {},
    readArticleWorkspaceSnapshot: async () => {
      throw Object.assign(new Error('workspace changed'), { code: 'ARTICLE_PAGE_LOADING' });
    },
    articleStructureObserver: null,
    activeNativePdfStructure: () => null,
    startArticleStructureObserver() {},
    stopArticleStructureObserver() {},
    withCurrentPdfSemanticNavigation: response => response
  });
  const response = await invokeWorkspaceSnapshotMessage(context);
  assert.equal(response.success, false);
  assert.equal(response.code, 'ARTICLE_PAGE_LOADING');
  assert.equal(response.retryable, true);
});

test('native workspace reads compare the prepared PDF source identity instead of the reader URL', async () => {
  const binaryHash = 'd'.repeat(64);
  const readerUrl = 'chrome-extension://extension-id/pdf-reader.html';
  const sourceUrl = `brevess-local-pdf://${binaryHash}`;
  const manual = {
    documentId: `sha256:${binaryHash}`,
    record: { documentHash: binaryHash, canonicalUrl: sourceUrl, annotations: [] }
  };
  const structure = {
    adapterId: 'pdf-native', documentId: manual.documentId,
    documentHash: binaryHash, revision: 24,
    paragraphs: [{ paragraphId: 'pdf-page-1', text: 'canonical PDF text' }]
  };
  const context = loadContentFunctions(['readArticleWorkspaceSnapshot'], readerDependencies({
    canonicalArticlePreindexUrl: value => canonicalUrl(
      value === undefined ? readerUrl : value
    ),
    currentArticleWorkspaceReadUrl: () => canonicalUrl(sourceUrl),
    activeNativePdfStructure: () => structure,
    __brevessNativePdfDocument: {
      phase: 'text-ready', structure, documentGeneration: 3,
      getSemanticNavigation: () => ({ documentHash: binaryHash, revision: 24 })
    },
    extractCurrentArticleStructure: () => structure,
    currentManualDocument: manual,
    manualPreparedHref: sourceUrl,
    prepareManualDocument: async options => {
      assert.equal(options?.throwOnError, true);
      return manual;
    },
    ensureCurrentArticleWorkspace: async () => ({
      workspaceId: `workspace:${'e'.repeat(64)}`,
      contentHash: binaryHash
    }),
    buildArticleWorkspaceSnapshot: () => ({
      documentId: manual.documentId, documentHash: binaryHash,
      paragraphs: structure.paragraphs, nodes: [],
      figures: { draft: null, figures: [] }
    })
  }));

  const snapshot = await context.readArticleWorkspaceSnapshot();
  assert.equal(snapshot.documentHash, binaryHash);
  assert.equal(snapshot.localWorkspace.contentHash, binaryHash);
  assert.equal(context.currentManualDocument, manual);
});

test('a restored bound Figure draft with no live controller seeds through the durable controller', async () => {
  const binding = {
    documentId: 'document-b', documentHash: 'hash-b',
    canonicalUrl: 'https://example.test/article-b',
    workspaceId: 'workspace-b', workspaceGeneration: 2
  };
  const restored = { ...figureWorkspace.createFigureWorkspaceDraft([]), binding };
  let writes = 0;
  const controller = figureWorkspace.createFigureWorkspaceDraftController({
    binding,
    initialDraft: restored,
    persist: async () => {
      writes += 1;
      return { revision: writes, contentHash: `saved-${writes}` };
    }
  });
  const context = loadContentFunctions(['sameFigureWorkspaceRefreshBinding',
    'populateFigureWorkspaceDraft'], {
    currentFigureWorkspaceRefreshBinding: () => binding,
    figureWorkspaceDraftForRefreshBinding: draft => draft,
    figureWorkspaceDraft: restored,
    figureWorkspaceDraftController: null,
    figureWorkspaceDraftControllerPromise: null,
    figureWorkspaceInventorySeedPromise: Promise.resolve(restored),
    figureWorkspaceDraftCheckpoint: { revision: 0, contentHash: '' },
    figureWorkspaceDraftCheckpointLoaded: true,
    figureWorkspaceDraftDirty: false,
    articleWorkspaceLifecycleGeneration: 9,
    figureWorkspaceCompletedModelResult: () => null,
    assertCurrentArticleWorkspaceLifecycle(value) { assert.equal(value, 9); },
    articleWorkspaceLifecycleError: () => Object.assign(new Error('stale'), { code: 'CANCELLED' }),
    invalidateArticleWorkspaceLifecycle() { assert.fail('valid restored binding must not invalidate'); },
    SciLLM: {
      createFigureWorkspaceDraft() { assert.fail('valid restored binding must not use memory-only seeding'); },
      publicFigureWorkspaceDraft() { assert.fail('valid restored binding must not use memory-only seeding'); },
      mergeModelIntoFigureWorkspaceDraft() { assert.fail('no completed model is present'); }
    }
  });
  let controllerLoads = 0;
  context.ensureFigureWorkspaceDraftController = async () => {
    controllerLoads += 1;
    context.figureWorkspaceDraftController = controller;
    return controller;
  };

  const inventory = [{ figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ['A'] }];
  const result = await context.populateFigureWorkspaceDraft(inventory);

  assert.equal(controllerLoads, 1);
  assert.equal(writes, 1, 'the restored draft must be saved through the CAS controller');
  assert.ok(result.figures['figure-1']);
  assert.ok(context.figureWorkspaceDraft.figures['figure-1']);
  assert.equal(context.figureWorkspaceDraftCheckpoint.revision, 1);
});

test('a Figure-only mutation during seed await rescans and cannot publish the stale ready revision', async () => {
  let inventoryRevision = 0;
  let committedRevision = 0;
  let inventoryReads = 0;
  let seedStarts = 0;
  const firstSeed = deferred();
  const firstWaitEntered = deferred();
  let context;
  const dependencies = readerDependencies({
    getFigureWorkspaceInventory() {
      inventoryReads += 1;
      inventoryRevision += 1;
      return [{ figureId: `figure-${inventoryRevision}` }];
    },
    combinedFigureWorkspaceInventory: () => [{ figureId: `figure-${inventoryRevision}` }],
    populateFigureWorkspaceDraft(inventory) {
      seedStarts += 1;
      const revision = Number(String(inventory[0]?.figureId || '').split('-')[1]) || 0;
      const seed = seedStarts === 1 ? firstSeed.promise : Promise.resolve();
      context.figureWorkspaceInventorySeedPromise = seed.then(() => {
        committedRevision = revision;
      });
      return context.figureWorkspaceInventorySeedPromise;
    },
    ensureFigureWorkspaceInventorySeeded: async () => {
      firstWaitEntered.resolve();
      await context.figureWorkspaceInventorySeedPromise;
    },
    buildArticleWorkspaceSnapshot: () => ({
      title: 'Article B', revision: 7,
      paragraphs: [{ paragraphId: 'b:1', text: 'body B' }],
      nodes: [{ nodeId: 'b' }],
      figures: { draft: { revision: committedRevision }, figures: [] }
    }),
    figureWorkspaceInventoryDirty: false,
    figureWorkspaceLastFreshnessCheckAt: 1,
    figureWorkspaceChangeNotificationTimer: null,
    clearTimeout() {},
    setTimeout() { return 1; },
    notifyFigureWorkspaceStateChanged() {}
  });
  context = loadContentFunctions(['markFigureWorkspaceInventoryDirty',
    'readArticleWorkspaceSnapshot'], dependencies);

  const reading = context.readArticleWorkspaceSnapshot();
  await firstWaitEntered.promise;
  context.markFigureWorkspaceInventoryDirty();
  firstSeed.resolve();
  const result = await reading;

  assert.equal(inventoryReads, 2,
    'the changed inventory epoch must cause a fresh catalog read before reporting ready');
  assert.equal(seedStarts, 2,
    'the newly read catalog must be seeded rather than reusing the completed stale promise');
  assert.equal(result.figures.inventoryReady, true);
  assert.equal(result.figures.draft.revision, 2);
});

test('a replacement PDF inventory seed installed during await is included in the returned ready snapshot', async () => {
  const firstSeed = deferred();
  const secondSeed = deferred();
  let committedRevision = 0;
  let waits = 0;
  const firstWaitEntered = deferred();
  let context;
  context = loadContentFunctions(['readArticleWorkspaceSnapshot'], readerDependencies({
    figureWorkspaceInventorySeedPromise: firstSeed.promise,
    ensureFigureWorkspaceInventorySeeded: async () => {
      waits += 1;
      const pending = context.figureWorkspaceInventorySeedPromise;
      if (waits === 1) firstWaitEntered.resolve();
      await pending;
    },
    buildArticleWorkspaceSnapshot: () => ({
      title: 'PDF B', revision: 11,
      paragraphs: [{ paragraphId: 'pdf:1', text: 'body' }],
      nodes: [{ nodeId: 'pdf' }],
      figures: { draft: { revision: committedRevision }, figures: [] }
    })
  }));

  const reading = context.readArticleWorkspaceSnapshot();
  await firstWaitEntered.promise;
  context.figureWorkspaceInventoryEpoch += 1;
  context.figureWorkspaceInventorySeedPromise = secondSeed.promise.then(() => {
    committedRevision = 2;
  });
  firstSeed.resolve();
  await Promise.resolve();
  secondSeed.resolve();

  const result = await reading;
  assert.ok(waits >= 2);
  assert.equal(result.figures.inventoryReady, true);
  assert.equal(result.figures.draft.revision, 2);
});
