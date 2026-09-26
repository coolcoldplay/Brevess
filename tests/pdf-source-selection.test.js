const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');

const root = path.join(__dirname, '..');
const readerSource = fs.readFileSync(path.join(root, 'pdf-reader.js'), 'utf8');

function functionSource(name, nextName) {
  const start = readerSource.indexOf(`async function ${name}`);
  const end = readerSource.indexOf(`\n  async function ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `${name} production function must exist`);
  return readerSource.slice(start, end);
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

class ControlledPdf extends Blob {
  constructor(name, contents, arrayBufferGate = Promise.resolve()) {
    const payload = Buffer.from(contents);
    super([payload], { type: 'application/pdf' });
    this.name = name;
    this.payload = payload;
    this.arrayBufferGate = arrayBufferGate;
  }

  async arrayBuffer() {
    await this.arrayBufferGate;
    return Uint8Array.from(this.payload).buffer;
  }
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function createHarness({ saveOriginalPdfSource } = {}) {
  const events = [];
  const historyUrls = [];
  const savedSources = [];
  const readerViews = [];
  let apiCalls = 0;
  const state = {
    runId: 0,
    localFile: null,
    localFileBytes: null,
    workspaceSourceUrl: '',
    openedPdfHash: '',
    parsedPageBindingCleanup: null,
    nativeFigureAbortController: null,
    positionRestoreKey: '',
    positionRestoring: false
  };
  const document = {
    documentElement: { dataset: {} },
    dispatchEvent(event) {
      events.push({ type: event.type, detail: event.detail });
      return true;
    }
  };
  class TestCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  const context = {
    Blob,
    DOMException,
    CustomEvent: TestCustomEvent,
    Uint8Array,
    String,
    crypto: webcrypto,
    state,
    document,
    location: { href: 'chrome-extension://test/pdf-reader.html' },
    history: {
      state: { fixture: true },
      replaceState(_state, _title, url) { historyUrls.push(url); }
    },
    SciLLM: {
      async saveOriginalPdfSource(hash, file, name) {
        const record = { hash, file, name, bytes: Buffer.from(file.payload) };
        savedSources.push(record);
        if (saveOriginalPdfSource) await saveOriginalPdfSource(record);
      },
      buildLocalPdfWorkspaceUrl(name, hash) {
        return `local-pdf://${hash}/${encodeURIComponent(name)}`;
      },
      withLocalPdfWorkspaceSource(_readerUrl, sourceUrl) {
        return `chrome-extension://test/pdf-reader.html?source=${encodeURIComponent(sourceUrl)}`;
      }
    },
    workspaceSourceUrl: () => state.workspaceSourceUrl || 'initial-source',
    fileNameForSource: () => String(state.localFile?.name || 'article.pdf'),
    saveReaderPreferences() {},
    resetNativePdfSourceOwnership() {},
    syncPdfSaveActions() {},
    element() { return { hidden: false }; },
    showReaderActions() {},
    setProgress() {},
    setReaderView(view) { readerViews.push(view); },
    headlessSupplementalImport: false,
    async runParse() {},
    async waitForOriginalPdfIndex() {},
    async restoreCachedPdfDocument() {},
    async fetch() { apiCalls += 1; throw new Error('Unexpected network call'); }
  };
  const prepare = functionSource('prepareLocalPdfWorkspaceIdentity', 'uploadLocalFile');
  const accept = functionSource('acceptSelectedLocalPdf', 'chooseLocalPdfWithHandle');
  const functions = vm.runInNewContext(
    `${prepare}\n${accept}\n({ prepareLocalPdfWorkspaceIdentity, acceptSelectedLocalPdf })`,
    context,
    { filename: 'pdf-reader-source-selection.vm.js' }
  );
  return {
    ...functions, state, document, events, historyUrls, savedSources, readerViews,
    apiCalls: () => apiCalls
  };
}

test('interleaved A/B selection never binds A bytes to B identity or lets A publish', async () => {
  const aBytesReady = deferred();
  const harness = createHarness();
  const fileA = new ControlledPdf('A.pdf', 'pdf bytes A', aBytesReady.promise);
  const fileB = new ControlledPdf('B.pdf', 'pdf bytes B');

  const selectionA = harness.acceptSelectedLocalPdf(fileA);
  assert.deepEqual(harness.events.map(event => event.type), ['brevess:pdf-source-changing']);
  const selectionB = harness.acceptSelectedLocalPdf(fileB);
  assert.deepEqual(harness.events.map(event => event.type), [
    'brevess:pdf-source-changing', 'brevess:pdf-source-changing'
  ], 'source-changing must be dispatched synchronously for both selections');

  await selectionB;
  aBytesReady.resolve();
  await assert.rejects(selectionA, error => error?.name === 'AbortError');

  const expectedBHash = sha256(fileB.payload);
  assert.equal(harness.savedSources.length, 1);
  assert.equal(harness.savedSources[0].hash, expectedBHash);
  assert.equal(harness.savedSources[0].file, fileB);
  assert.equal(harness.savedSources[0].name, 'B.pdf');
  assert.deepEqual(harness.savedSources[0].bytes, fileB.payload);
  assert.equal(harness.historyUrls.length, 1);
  assert.match(harness.historyUrls[0], new RegExp(expectedBHash));
  assert.equal(harness.state.workspaceSourceUrl,
    `local-pdf://${expectedBHash}/B.pdf`);
  assert.equal(harness.document.documentElement.dataset.pdfSourceUrl,
    harness.state.workspaceSourceUrl);
  assert.equal(harness.state.localFile, fileB);
  assert.deepEqual(harness.events.map(event => event.type), [
    'brevess:pdf-source-changing',
    'brevess:pdf-source-changing',
    'brevess:pdf-document-change'
  ]);
  assert.equal(harness.apiCalls(), 0);
});

test('selection superseded while persistence is pending cannot overwrite URL or emit change', async () => {
  const aSavePending = deferred();
  const aSaveStarted = deferred();
  const harness = createHarness({
    async saveOriginalPdfSource(record) {
      if (record.name !== 'A.pdf') return;
      aSaveStarted.resolve();
      await aSavePending.promise;
    }
  });
  const fileA = new ControlledPdf('A.pdf', 'persistent bytes A');
  const fileB = new ControlledPdf('B.pdf', 'persistent bytes B');

  const selectionA = harness.acceptSelectedLocalPdf(fileA);
  await aSaveStarted.promise;
  const selectionB = harness.acceptSelectedLocalPdf(fileB);
  await selectionB;
  aSavePending.resolve();
  await assert.rejects(selectionA, error => error?.name === 'AbortError');

  assert.equal(harness.savedSources.length, 2,
    'a superseded save may finish, but each key must retain its captured file');
  for (const saved of harness.savedSources) {
    assert.equal(saved.hash, sha256(saved.bytes));
    assert.equal(saved.name, saved.file.name);
    assert.deepEqual(saved.bytes, saved.file.payload);
  }
  assert.equal(harness.historyUrls.length, 1);
  assert.match(harness.historyUrls[0], /B\.pdf/);
  assert.equal(harness.events.filter(event =>
    event.type === 'brevess:pdf-document-change').length, 1);
  assert.equal(harness.apiCalls(), 0);
});

test('identity helper default arguments preserve the headless initialization entry', async () => {
  const harness = createHarness();
  const headlessFile = new ControlledPdf('headless.pdf', 'headless pdf bytes');
  harness.state.localFile = headlessFile;
  harness.state.runId = 17;

  const sourceUrl = await harness.prepareLocalPdfWorkspaceIdentity();

  const expectedHash = sha256(headlessFile.payload);
  assert.equal(sourceUrl, `local-pdf://${expectedHash}/headless.pdf`);
  assert.equal(harness.savedSources[0].file, headlessFile);
  assert.equal(harness.savedSources[0].hash, expectedHash);
  assert.equal(harness.apiCalls(), 0);
});
