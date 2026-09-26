const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('PDF reader loads canonical and semantic dependencies before content and native module', () => {
  const html = read('pdf-reader.html');
  const ordered = [
    'core/pdf-canonical-page.js',
    'core/pdf-heading-extractor.js',
    'core/pdf-semantic-index.js',
    'core/pdf-semantic-compat.js',
    'core/pdf-semantic-worker-client.js',
    'core/pdf-semantic-sidecar.js',
    'content.js',
    'pdf-native-reader.mjs'
  ].map(name => ({ name, offset: html.indexOf(`src="${name}"`) }));
  assert.ok(ordered.every(item => item.offset >= 0), JSON.stringify(ordered));
  assert.deepEqual([...ordered].sort((left, right) => left.offset - right.offset)
    .map(item => item.name), ordered.map(item => item.name));
});

test('native reader publishes its first interactive page before semantic work starts', () => {
  const source = read('pdf-native-reader.mjs');
  const start = source.indexOf('async function initializeNativePdf()');
  const end = source.indexOf("document.addEventListener('brevess:focus-native-pdf-page'", start);
  const initialization = source.slice(start, end);
  const ready = initialization.indexOf('bridge.onReady(Object.freeze({');
  const semantic = initialization.indexOf('activatePdfSemanticSidecar(');
  assert.ok(ready >= 0 && semantic > ready, { ready, semantic });
  assert.match(initialization,
    /bridge\.onReady\(Object\.freeze\(\{[\s\S]*activatePdfSemanticSidecar\([\s\S]*indexRemainingPages/u);
  assert.match(source, /createPdfSemanticWorkerClient\([\s\S]*pdf-semantic-worker\.mjs/u);
  assert.match(source,
    /async function indexRemainingPages[\s\S]*__brevessNativePdfDocument[\s\S]*completePdfSemanticCollection\(\)/u);
});

test('canonical records survive virtual unmount while terminal lifecycle paths clear the sidecar', () => {
  const source = read('pdf-native-reader.mjs');
  const unmount = source.slice(source.indexOf('function unmountHeavyLayers('),
    source.indexOf('async function renderMountedPage(', source.indexOf('function unmountHeavyLayers(')));
  assert.match(unmount, /markPdfSemanticPageUnmounted/u);
  assert.doesNotMatch(unmount, /resetPdfSemanticSidecar|\.dispose\(/u);

  const deactivate = source.slice(source.indexOf('function deactivate()'),
    source.indexOf('async function releaseNativeResources', source.indexOf('function deactivate()')));
  assert.match(deactivate, /deactivatePdfSemanticSidecar/u);
  assert.doesNotMatch(deactivate, /resetPdfSemanticSidecar|\.dispose\(/u);

  for (const [name, next] of [
    ['function suspendNativePdfForSourceSelection()', 'async function replaceDocument()'],
    ['async function replaceDocument()', 'function dispose()'],
    ['function dispose()', 'function enterFallback(error)'],
    ['function enterFallback(error)', 'function focusPage(']
  ]) {
    const start = source.indexOf(name);
    const end = source.indexOf(next, start + name.length);
    assert.ok(start >= 0 && end > start, name);
    assert.match(source.slice(start, end), /resetPdfSemanticSidecar/u, name);
  }
});

test('semantic progress event is independent from native workspace readiness', () => {
  const source = read('pdf-native-reader.mjs');
  assert.match(source, /new CustomEvent\('brevess:pdf-semantic-ready'/u);
  const semanticPublisher = source.slice(source.indexOf('function publishPdfSemantic'),
    source.indexOf('\n}', source.indexOf('function publishPdfSemantic')) + 2);
  assert.doesNotMatch(semanticPublisher, /brevess:native-pdf-ready|prepareNativePdfWorkspace/u);
});

test('production semantic progress event exposes exactly the frozen four-field contract', () => {
  const source = read('pdf-native-reader.mjs');
  const start = source.indexOf('function publishPdfSemanticProgress(');
  const end = source.indexOf('\n}\n\nfunction resetPdfSemanticSidecar', start) + 2;
  assert.ok(start >= 0 && end > start);
  const published = [];
  const context = {
    pdfSemanticSidecar: null,
    pdfSemanticPublishedBuilds: 0,
    semanticErrorCode: value => String(value || ''),
    document: { dispatchEvent(event) { published.push(event.detail); } },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init.detail; }
    }
  };
  vm.runInNewContext(`${source.slice(start, end)}\n` +
    `publishPdfSemanticProgress({phase:'degraded',documentGeneration:7,revision:11,` +
    `counts:{canonicalPages:2,buildsFailed:1},coverage:{expectedPages:9},` +
    `degraded:true,errorCode:'PDF_PRIVATE_DETAIL'});`, context);
  assert.equal(published.length, 1);
  assert.deepEqual(Object.keys(published[0]).sort(),
    ['counts', 'documentGeneration', 'phase', 'revision']);
  assert.equal(published[0].counts.buildsFailed, 1);
  assert.equal(Object.isFrozen(published[0]), true);
  assert.equal(Object.isFrozen(published[0].counts), true);
});

test('semantic publication binds a compatibility companion before observers are notified', () => {
  const source = read('pdf-native-reader.mjs');
  const start = source.indexOf('function clearPdfSemanticCompatibility(');
  const end = source.indexOf('\nfunction resetPdfSemanticSidecar', start);
  assert.ok(start >= 0 && end > start);
  const published = [];
  const documentHash = 'a'.repeat(64);
  const sourceDocument = { numPages: 2 };
  const nativeDocument = Object.freeze({
    documentGeneration: 7,
    structure: Object.freeze({
      documentId: `sha256:${documentHash}`,
      adapterId: 'pdf-native',
      documentHash
    })
  });
  const index = Object.freeze({ marker: 'semantic-index' });
  const snapshot = Object.freeze({
    source: Object.freeze({ workspaceDocumentId: `sha256:${documentHash}`,
      documentHash, documentGeneration: 7 }),
    revision: 3,
    phase: 'ready',
    coverage: Object.freeze({ expectedPages: 2, indexedPages: 2 }),
    index
  });
  let adapterInput = null;
  const context = {
    pdfSemanticSidecar: { getSnapshot: () => snapshot },
    pdfSemanticSourceDocument: sourceDocument,
    pdfDocument: sourceDocument,
    loadedDocumentHash: documentHash,
    nativeDocumentGeneration: 7,
    pdfSemanticPublishedBuilds: 0,
    pdfSemanticCompatibilityOwner: null,
    globalThis: null,
    document: { dispatchEvent(event) {
      published.push({ detail: event.detail,
        semantic: context.globalThis.__brevessPdfSemanticDocument,
        companion: context.globalThis.__brevessPdfSemanticCompatibility });
    } },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init.detail; }
    }
  };
  context.globalThis = context;
  context.__brevessNativePdfDocument = nativeDocument;
  context.SciLLM = {
    createPdfSemanticCompatibilityAdapter(input) {
      adapterInput = input;
      return Object.freeze({ marker: 'compatibility-adapter' });
    }
  };
  vm.runInNewContext(`${source.slice(start, end)}\n` +
    `publishPdfSemanticProgress({phase:'ready',documentGeneration:7,revision:3,` +
    `counts:{buildsCommitted:1}});`, context);
  assert.equal(published.length, 1);
  assert.equal(published[0].semantic.index, index);
  assert.equal(published[0].companion.marker, 'compatibility-adapter');
  assert.equal(adapterInput.semanticDocument, published[0].semantic);
  assert.equal(adapterInput.nativeDocument, nativeDocument);
  assert.equal(adapterInput.getCurrentSemanticDocument(), published[0].semantic);
  assert.equal(adapterInput.getCurrentNativeDocument(), nativeDocument);
  assert.deepEqual(Object.keys(published[0].detail).sort(),
    ['counts', 'documentGeneration', 'phase', 'revision']);
});

test('semantic publication fails closed when compatibility construction rejects', () => {
  const source = read('pdf-native-reader.mjs');
  const start = source.indexOf('function clearPdfSemanticCompatibility(');
  const end = source.indexOf('\nfunction resetPdfSemanticSidecar', start);
  assert.ok(start >= 0 && end > start);
  const published = [];
  const documentHash = 'b'.repeat(64);
  const sourceDocument = { numPages: 1 };
  const snapshot = Object.freeze({
    source: Object.freeze({ workspaceDocumentId: `sha256:${documentHash}`,
      documentHash, documentGeneration: 9 }),
    revision: 4,
    phase: 'ready',
    coverage: Object.freeze({ expectedPages: 1, indexedPages: 1 }),
    index: Object.freeze({ marker: 'must-not-publish' })
  });
  const context = {
    pdfSemanticSidecar: { getSnapshot: () => snapshot },
    pdfSemanticSourceDocument: sourceDocument,
    pdfDocument: sourceDocument,
    loadedDocumentHash: documentHash,
    nativeDocumentGeneration: 9,
    pdfSemanticPublishedBuilds: 0,
    pdfSemanticCompatibilityOwner: null,
    globalThis: null,
    document: { dispatchEvent(event) {
      published.push({ detail: event.detail,
        semantic: context.globalThis.__brevessPdfSemanticDocument,
        companion: context.globalThis.__brevessPdfSemanticCompatibility });
    } },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init.detail; }
    }
  };
  context.globalThis = context;
  context.__brevessNativePdfDocument = Object.freeze({
    documentGeneration: 9,
    structure: Object.freeze({ documentId: `sha256:${documentHash}`,
      adapterId: 'pdf-native', documentHash })
  });
  context.__brevessPdfSemanticDocument = Object.freeze({ marker: 'old-semantic' });
  context.__brevessPdfSemanticCompatibility = Object.freeze({ marker: 'old-adapter' });
  context.SciLLM = {
    createPdfSemanticCompatibilityAdapter() {
      const error = new Error('REJECT_FOR_TEST');
      error.code = 'REJECT_FOR_TEST';
      throw error;
    }
  };
  vm.runInNewContext(`${source.slice(start, end)}\n` +
    `publishPdfSemanticProgress({phase:'ready',documentGeneration:9,revision:4,` +
    `counts:{buildsCommitted:1}});`, context);
  assert.equal(published.length, 1);
  assert.equal(published[0].semantic, undefined);
  assert.equal(published[0].companion, undefined);
  assert.equal(context.__brevessPdfSemanticDocument, undefined);
  assert.equal(context.__brevessPdfSemanticCompatibility, undefined);
  assert.equal(context.pdfSemanticPublishedBuilds, 0);
});

test('compatibility refresh clears semantic publication when the native wrapper is missing', () => {
  const source = read('pdf-native-reader.mjs');
  const start = source.indexOf('function clearPdfSemanticCompatibility(');
  const end = source.indexOf('\nfunction resetPdfSemanticSidecar', start);
  const context = {
    pdfSemanticPublishedBuilds: 7,
    globalThis: null,
    SciLLM: { createPdfSemanticCompatibilityAdapter() {
      throw new Error('must not be called without a native wrapper');
    } },
    document: { dispatchEvent() {} },
    CustomEvent: class CustomEvent {}
  };
  context.globalThis = context;
  context.__brevessPdfSemanticDocument = Object.freeze({ marker: 'must-clear' });
  context.__brevessPdfSemanticCompatibility = Object.freeze({ marker: 'must-clear' });
  vm.runInNewContext(`${source.slice(start, end)}\npublishPdfSemanticCompatibility();`, context);
  assert.equal(context.__brevessPdfSemanticDocument, undefined);
  assert.equal(context.__brevessPdfSemanticCompatibility, undefined);
  assert.equal(context.pdfSemanticPublishedBuilds, 0);
});

test('semantic publication rejects factory identity side effects and retries the same build', () => {
  const source = read('pdf-native-reader.mjs');
  const start = source.indexOf('function clearPdfSemanticCompatibility(');
  const end = source.indexOf('\nfunction resetPdfSemanticSidecar', start);
  const documentHash = 'c'.repeat(64);
  const sourceDocument = { numPages: 1 };
  const index = Object.freeze({ marker: 'semantic-index' });
  const snapshot = Object.freeze({
    source: Object.freeze({ workspaceDocumentId: `sha256:${documentHash}`,
      documentHash, documentGeneration: 5 }),
    revision: 8,
    phase: 'ready',
    coverage: Object.freeze({ expectedPages: 1, indexedPages: 1 }),
    index
  });
  const publications = [];
  let poisonIdentity = true;
  const context = {
    pdfSemanticSidecar: { getSnapshot: () => snapshot },
    pdfSemanticSourceDocument: sourceDocument,
    pdfDocument: sourceDocument,
    loadedDocumentHash: documentHash,
    nativeDocumentGeneration: 5,
    pdfSemanticPublishedBuilds: 0,
    pdfSemanticCompatibilityOwner: null,
    globalThis: null,
    document: { dispatchEvent() {
      publications.push({
        semantic: context.__brevessPdfSemanticDocument,
        companion: context.__brevessPdfSemanticCompatibility,
        builds: context.pdfSemanticPublishedBuilds
      });
    } },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init.detail; }
    }
  };
  context.globalThis = context;
  context.__brevessNativePdfDocument = Object.freeze({
    documentGeneration: 5,
    structure: Object.freeze({ documentId: `sha256:${documentHash}`,
      adapterId: 'pdf-native', documentHash })
  });
  context.SciLLM = {
    createPdfSemanticCompatibilityAdapter() {
      if (poisonIdentity) {
        context.__brevessPdfSemanticDocument = Object.freeze({ marker: 'identity-side-effect' });
      }
      return Object.freeze({ marker: 'compatibility-adapter' });
    }
  };
  const script = new vm.Script(`${source.slice(start, end)}\n` +
    `publishPdfSemanticProgress({phase:'ready',documentGeneration:5,revision:8,` +
    `counts:{buildsCommitted:1}});`);
  script.runInNewContext(context);
  assert.equal(publications[0].semantic, undefined);
  assert.equal(publications[0].companion, undefined);
  assert.equal(publications[0].builds, 0);
  poisonIdentity = false;
  script.runInNewContext(context);
  assert.equal(publications[1].semantic.index, index);
  assert.equal(publications[1].companion.marker, 'compatibility-adapter');
  assert.equal(publications[1].builds, 1);
});

test('native wrapper publication refreshes the companion and terminal reset clears it', () => {
  const source = read('pdf-native-reader.mjs');
  const publicationStart = source.indexOf('function createNativePdfDocumentPublication(');
  const checkpointStart = source.indexOf('function publishNativePdfStructure(');
  const checkpointEnd = source.indexOf('\nasync function indexRemainingPages', checkpointStart);
  const finalStart = source.indexOf('async function indexRemainingPages(');
  const finalEnd = source.indexOf('\nasync function initializeNativePdf', finalStart);
  const resetStart = source.indexOf('function resetPdfSemanticSidecar(');
  const resetEnd = source.indexOf('\nfunction activatePdfSemanticSidecar', resetStart);
  assert.ok(publicationStart >= 0 && publicationStart < checkpointStart,
    'native publications must be created through the shared publication factory');
  assert.match(source.slice(publicationStart, checkpointStart),
    /resolveSemanticHighlight\s*=\s*createPdfSemanticHighlightResolver\([\s\S]*return Object\.freeze\(nativeDocument\)/u);
  assert.match(source.slice(checkpointStart, checkpointEnd),
    /__brevessNativePdfDocument\s*=\s*createNativePdfDocumentPublication\(\{[\s\S]*publishPdfSemanticCompatibility\(\)/u);
  assert.match(source.slice(finalStart, finalEnd),
    /__brevessNativePdfDocument\s*=\s*createNativePdfDocumentPublication\(\{[\s\S]*publishPdfSemanticCompatibility\(\)/u);
  assert.match(source.slice(resetStart, resetEnd),
    /clearPdfSemanticPublication\(\)/u);
  assert.match(source.slice(source.indexOf('function clearPdfSemanticCompatibility('), resetStart),
    /delete globalThis\.__brevessPdfSemanticDocument[\s\S]*clearPdfSemanticCompatibility\(\)/u);
  assert.doesNotMatch(source, /__brevessNativePdfDocument\s*=\s*__brevessPdfSemanticCompatibility/u);
});
