const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const nativeReaderSource = fs.readFileSync(
  path.join(__dirname, '..', 'pdf-native-reader.mjs'),
  'utf8'
);
const contentSource = fs.readFileSync(
  path.join(__dirname, '..', 'content.js'),
  'utf8'
);
const pdfReaderSource = fs.readFileSync(
  path.join(__dirname, '..', 'pdf-reader.js'),
  'utf8'
);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} must precede ${endMarker}`);
  return source.slice(start, end).trim();
}

function extractFunction(source, name) {
  const marker = `async function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must remain available for behavioral testing`);
  const brace = source.indexOf('{', start);
  assert.notEqual(brace, -1);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = brace; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} function body is incomplete`);
}

const installOcrTextLayerSource = extractFunction(
  nativeReaderSource,
  'installOcrTextLayer'
);
const refreshParsedPdfWorkspaceSource = sourceBetween(
  contentSource,
  'async function refreshParsedPdfWorkspace',
  'async function restorePdfFigureBinaryAssets'
);
const capturedUploadFunctionsSource = sourceBetween(
  pdfReaderSource,
  'function capturePdfParseSource',
  'function canRelayBrowserSessionSource'
);
const parseWithPreciseSource = sourceBetween(
  pdfReaderSource,
  'async function parseWithPrecise',
  'function revokeAssetUrls'
);

function createInstallHarness({ pages, convert, nativeMatches = () => true } = {}) {
  const ocrTextPages = new Map();
  const pageRecords = new Map();
  const added = [];
  const unmounted = [];
  const updates = [];
  const publications = [];
  const semanticPages = [];
  const semanticCompletions = [];
  const pdfDocument = {
    numPages: pages.length,
    async getPage(pageNumber) {
      return pages[pageNumber - 1];
    }
  };
  const sandboxGlobal = {
    SciLLM: {
      normalizePdfNativePageText(textContent) {
        return (textContent?.items || []).map(item => item.str || '').join(' ').trim();
      },
      mineruPageToPdfTextContent: convert
    }
  };
  const dependencies = {
    globalThis: sandboxGlobal,
    loadedDocumentHash: 'a'.repeat(64),
    pdfDocument,
    nativeDocumentGeneration: 7,
    nativeDocumentMatches: nativeMatches,
    ocrTextPages,
    pageRecords,
    createPagePlaceholder(pageNumber, page) {
      const record = { pageNumber, page, mounted: false, text: '', textContent: null };
      pageRecords.set(pageNumber, record);
      return record;
    },
    unmountHeavyLayers(record) {
      unmounted.push(record.pageNumber);
      record.mounted = false;
    },
    incrementalDocument: {
      add(value) { added.push(value); }
    },
    createPdfSemanticCanonicalPage(record, textContent) {
      return { pageNumber: record.pageNumber, textContent };
    },
    upsertPdfSemanticPage(record) { semanticPages.push(record.canonicalPage); },
    completePdfSemanticCollection() { semanticCompletions.push(true); },
    currentPageRecord: () => pageRecords.get(1) || null,
    async updatePageWindow(start, end) { updates.push([start, end]); },
    publishNativePdfStructure(outline, records, phase) {
      publications.push({ outline, records, phase });
    },
    outlineCache: []
  };
  const names = Object.keys(dependencies);
  const factory = new Function(
    ...names,
    `${installOcrTextLayerSource}; return installOcrTextLayer;`
  );
  return {
    install: factory(...names.map(name => dependencies[name])),
    hash: dependencies.loadedDocumentHash,
    ocrTextPages,
    pageRecords,
    added,
    unmounted,
    updates,
    publications,
    semanticPages,
    semanticCompletions
  };
}

function pdfPage(nativeText = '') {
  return {
    view: [0, 0, 612, 792],
    rotate: 0,
    async getTextContent() {
      return { items: nativeText ? [{ str: nativeText }] : [] };
    }
  };
}

function ocrPage(pageNumber, text = `OCR page ${pageNumber}`) {
  return {
    pageNumber,
    width: 612,
    height: 792,
    items: [{ str: text, bbox: [10, 10, 100, 24] }]
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createRefreshHarness({ paragraphCount = 0, ensureWorkspace } = {}) {
  const hashA = 'a'.repeat(64);
  const state = { lifecycle: 4, source: 'file:///brevess-local-pdf/a/paper.pdf', hash: hashA };
  const persisted = [];
  const runtimeMessages = [];
  const notifications = [];
  const dataset = {};
  const sandboxGlobal = {
    SciLLM: { isPdfReaderUrl: () => true },
    __brevessNativePdfDocument: { structure: { documentHash: hashA } }
  };
  const dependencies = {
    globalThis: sandboxGlobal,
    location: { href: 'chrome-extension://test/pdf-reader.html' },
    articleWorkspaceLifecycleGeneration: state.lifecycle,
    effectiveArticlePageUrl: () => state.source,
    assertCurrentArticleWorkspaceLifecycle(expected) {
      if (expected !== state.lifecycle) throw new Error('ARTICLE_WORKSPACE_LIFECYCLE_STALE');
    },
    articleExtractionCache: {},
    lastSuccessfulExtraction: {},
    lastSuccessfulStructure: {},
    currentArticleStructure: {},
    canonicalArticleSnapshotCache: {},
    manualPreparedHref: 'old',
    markFigureWorkspaceInventoryDirty: () => {},
    getCanonicalArticleSnapshot: () => ({
      paragraphs: Array.from({ length: paragraphCount }, (_, index) => ({
        paragraphId: `p-${index + 1}`,
        text: `paragraph ${index + 1}`
      }))
    }),
    ensureCurrentArticleWorkspace: ensureWorkspace || (async () => ({
      workspaceId: 'workspace-a', workspaceGeneration: 1
    })),
    persistArticleWorkspaceArtifacts: async () => ({ results: [{ saved: true }] }),
    buildArticleWorkspaceBaselineAssets: () => new Map(),
    persistWorkspaceAssetCheckpoint: async (relativePath, content, options) => {
      options?.commitGuard?.();
      persisted.push({ relativePath, content });
      return { saved: true };
    },
    chrome: {
      runtime: {
        sendMessage(message) {
          runtimeMessages.push(message);
          return Promise.resolve({ success: true, data: {} });
        }
      }
    },
    document: { title: 'Scanned paper', documentElement: { dataset } },
    startArticleStructureObserver: () => {},
    notifyFigureWorkspaceStateChanged: reason => notifications.push(reason)
  };
  const names = Object.keys(dependencies);
  const factory = new Function(
    ...names,
    `${refreshParsedPdfWorkspaceSource}; return refreshParsedPdfWorkspace;`
  );
  return {
    refresh: factory(...names.map(name => dependencies[name])),
    state,
    sandboxGlobal,
    persisted,
    runtimeMessages,
    notifications,
    dataset,
    hashA
  };
}

function namedBlob(name, bytes = 'pdf-a') {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  Object.defineProperty(blob, 'name', { value: name, configurable: true });
  return blob;
}

function createParseLeaseHarness({ file = namedBlob('a.pdf') } = {}) {
  const state = {
    runId: 1,
    localFile: file,
    localFileBytes: null,
    workspaceSourceUrl: 'file:///brevess-local-pdf/a/a.pdf',
    settings: { token: 'test-token' }
  };
  const uploadCalls = [];
  const fetchCalls = [];
  const dependencies = {
    state,
    workspaceSourceUrl: () => state.workspaceSourceUrl,
    fileNameForSource: () => state.localFile?.name || 'article.pdf',
    mineruRequestBody: () => ({ is_ocr: true }),
    canRelayBrowserSessionSource: () => false,
    setProgress: () => {},
    apiJson: async () => ({}),
    SciLLM: { PDF_MINERU_PRECISE_BASE: 'https://mineru.invalid' },
    preciseHeaders: () => ({ Authorization: 'Bearer test-token' }),
    uploadPdfSource: async (...args) => { uploadCalls.push(args); },
    pollPreciseBatchTask: async () => ({ zipUrl: 'unused', taskId: 'unused', pages: 1 }),
    pollPreciseSingleTask: async () => ({ zipUrl: 'unused', taskId: 'unused', pages: 1 }),
    loadPreciseZip: async () => ({ markdown: '# unused' }),
    fetch: async (...args) => {
      fetchCalls.push(args);
      return { ok: true };
    }
  };
  const names = Object.keys(dependencies);
  const factory = new Function(
    ...names,
    `${capturedUploadFunctionsSource}\n${parseWithPreciseSource}; ` +
      'return { capturePdfParseSource, uploadLocalFile, parseWithPrecise };'
  );
  return {
    ...factory(...names.map(name => dependencies[name])),
    state,
    dependencies,
    uploadCalls,
    fetchCalls
  };
}

test('installOcrTextLayer rejects another document hash before reading or mutating pages', async () => {
  let reads = 0;
  const page = pdfPage();
  page.getTextContent = async () => { reads += 1; return { items: [] }; };
  const harness = createInstallHarness({
    pages: [page],
    convert: ocr => ({ items: ocr.items })
  });

  await assert.rejects(
    harness.install({ documentHash: 'b'.repeat(64), pages: [ocrPage(1)] }),
    /PDF_OCR_SOURCE_MISMATCH/
  );
  assert.equal(reads, 0);
  assert.equal(harness.ocrTextPages.size, 0);
  assert.deepEqual(harness.added, []);
  assert.deepEqual(harness.unmounted, []);
});

test('a later invalid OCR page leaves every original page and index untouched', async () => {
  const harness = createInstallHarness({
    pages: [pdfPage(), pdfPage()],
    convert(ocr) {
      if (ocr.pageNumber === 2) throw new Error('BROKEN_OCR_COORDINATES');
      return { items: ocr.items };
    }
  });
  const visible = {
    pageNumber: 1,
    mounted: true,
    canvas: { width: 1224, height: 1584 },
    text: '',
    textContent: null
  };
  harness.pageRecords.set(1, visible);

  await assert.rejects(
    harness.install({ documentHash: harness.hash, pages: [ocrPage(1), ocrPage(2)] }),
    /BROKEN_OCR_COORDINATES/
  );
  assert.equal(harness.ocrTextPages.size, 0, 'OCR pages commit as one validated batch');
  assert.deepEqual(harness.added, [], 'native paragraph index is not partially replaced');
  assert.deepEqual(harness.unmounted, [], 'the visible original page remains mounted');
  assert.equal(visible.canvas.width, 1224);
  assert.deepEqual(harness.updates, []);
  assert.deepEqual(harness.publications, []);
});

test('a source-generation change during validation leaves no partial OCR state', async () => {
  let current = true;
  const second = pdfPage();
  second.getTextContent = async () => {
    current = false;
    return { items: [] };
  };
  const harness = createInstallHarness({
    pages: [pdfPage(), second],
    convert: ocr => ({ items: ocr.items }),
    nativeMatches: () => current
  });

  await assert.rejects(
    harness.install({ documentHash: harness.hash, pages: [ocrPage(1), ocrPage(2)] }),
    /PDF_OCR_SOURCE_MISMATCH/
  );
  assert.equal(harness.ocrTextPages.size, 0);
  assert.deepEqual(harness.added, []);
  assert.deepEqual(harness.unmounted, []);
  assert.deepEqual(harness.publications, []);
});

test('validated OCR augments only low-text pages and publishes the resulting index', async () => {
  const harness = createInstallHarness({
    pages: [pdfPage(), pdfPage('A native text layer that is comfortably longer than thirty characters.')],
    convert: ocr => ({ items: ocr.items })
  });
  harness.pageRecords.set(1, {
    pageNumber: 1,
    mounted: false,
    text: '',
    textContent: null
  });

  const result = await harness.install({
    documentHash: harness.hash,
    pages: [ocrPage(1, 'recognized scan'), ocrPage(2, 'must not replace native text')]
  });

  assert.deepEqual(result.installedPages, [1]);
  assert.equal(result.source, 'mineru-layout');
  assert.equal(harness.ocrTextPages.get(1).items[0].str, 'recognized scan');
  assert.equal(harness.ocrTextPages.has(2), false);
  assert.deepEqual(harness.added, [{ pageNumber: 1, text: 'recognized scan' }]);
  assert.equal(harness.updates.length, 1);
  assert.deepEqual(harness.publications.map(item => item.phase), ['text-ready']);
  assert.deepEqual(harness.semanticPages.map(item => item.pageNumber), [1]);
  assert.equal(harness.semanticPages[0], harness.pageRecords.get(1).canonicalPage);
  assert.equal(harness.semanticCompletions.length, 1);
});

test('a delayed old workspace ensure cannot persist after the PDF source changes', async () => {
  const pendingEnsure = deferred();
  const harness = createRefreshHarness({
    paragraphCount: 1,
    ensureWorkspace: () => pendingEnsure.promise
  });
  const refresh = harness.refresh({
    originalDocumentHash: harness.hashA,
    markdown: '# Parsed A\n\nBody A'
  });

  await Promise.resolve();
  harness.state.source = 'file:///brevess-local-pdf/b/paper.pdf';
  harness.state.hash = 'b'.repeat(64);
  harness.state.lifecycle += 1;
  harness.sandboxGlobal.__brevessNativePdfDocument = {
    structure: { documentHash: harness.state.hash }
  };
  pendingEnsure.resolve({ workspaceId: 'workspace-a', workspaceGeneration: 1 });

  await assert.rejects(refresh, /ARTICLE_WORKSPACE_LIFECYCLE_STALE|PDF_OCR_SOURCE_MISMATCH/);
  assert.deepEqual(harness.persisted, []);
  assert.deepEqual(harness.runtimeMessages, []);
  assert.equal(harness.dataset.pdfWorkspaceReady, undefined);
});

test('bound parsed evidence for a zero-text scan is saved without claiming native indexing', async () => {
  const harness = createRefreshHarness({ paragraphCount: 0 });
  const result = await harness.refresh({
    title: 'Scanned paper',
    originalDocumentHash: harness.hashA,
    markdown: '# Recognized auxiliary text\n\nLocally parsed evidence.',
    ocrError: 'PDF_OCR_COORDINATES_MISSING'
  });

  assert.equal(result.success, true);
  assert.equal(result.indexed, false);
  assert.equal(result.paragraphCount, 0);
  assert.equal(harness.dataset.pdfWorkspaceReady, 'true');
  assert.equal(harness.dataset.pdfWorkspaceIndexed, 'false');
  const documentAsset = harness.persisted.find(item =>
    item.relativePath === 'pdf/document.json'
  )?.content;
  assert.equal(documentAsset.markdown.includes('Locally parsed evidence.'), true);
  assert.equal(documentAsset.originalDocumentHash, harness.hashA);
  assert.equal(documentAsset.ocrError, 'PDF_OCR_COORDINATES_MISSING');
  assert.equal(
    harness.runtimeMessages.some(message => message.type === 'PDF_WORKSPACE_INDEXED'),
    false
  );
  assert.deepEqual(harness.notifications, ['pdf_workspace_ready']);
});

test('a late precise upload URL cannot start an upload after the source lease changes', async () => {
  const uploadAddress = deferred();
  const harness = createParseLeaseHarness();
  harness.dependencies.apiJson = () => uploadAddress.promise;
  const names = Object.keys(harness.dependencies);
  const factory = new Function(
    ...names,
    `${capturedUploadFunctionsSource}\n${parseWithPreciseSource}; return parseWithPrecise;`
  );
  const parseWithPrecise = factory(...names.map(name => harness.dependencies[name]));
  const parsing = parseWithPrecise(1, { token: 'test-token', isOcr: true });

  harness.state.runId = 2;
  harness.state.localFile = namedBlob('b.pdf', 'pdf-b');
  harness.state.workspaceSourceUrl = 'file:///brevess-local-pdf/b/b.pdf';
  uploadAddress.resolve({ batch_id: 'late-batch', file_urls: ['https://upload.invalid/late'] });

  await assert.rejects(parsing, error => error?.name === 'AbortError');
  assert.deepEqual(harness.uploadCalls, []);
  assert.deepEqual(harness.fetchCalls, []);
});

test('a late local arrayBuffer cannot reach fetch after the source lease changes', async () => {
  const bytes = deferred();
  class SlowPdfBlob extends Blob {
    arrayBuffer() { return bytes.promise; }
  }
  const file = new SlowPdfBlob(['old-pdf'], { type: 'application/pdf' });
  Object.defineProperty(file, 'name', { value: 'old.pdf' });
  const harness = createParseLeaseHarness({ file });
  const source = harness.capturePdfParseSource(1);
  const uploading = harness.uploadLocalFile('https://upload.invalid/file', source);

  harness.state.runId = 2;
  harness.state.localFile = namedBlob('new.pdf', 'new-pdf');
  harness.state.workspaceSourceUrl = 'file:///brevess-local-pdf/new/new.pdf';
  bytes.resolve(new TextEncoder().encode('old-pdf').buffer);

  await assert.rejects(uploading, error => error?.name === 'AbortError');
  assert.deepEqual(harness.fetchCalls, []);
});
