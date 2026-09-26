const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildPdfSemanticIndex } = require('../core/pdf-semantic-index.js');
const { createPdfSemanticCompatibilityAdapter } = require('../core/pdf-semantic-compat.js');
const { createPdfFigureContextProductionAdapter } = require('../core/pdf-figure-context-production.js');

const root = path.join(__dirname, '..');
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const pdfReaderHtml = fs.readFileSync(path.join(root, 'pdf-reader.html'), 'utf8');
const HASH = 'a'.repeat(64);

function extractFunction(name, dependencies = {}) {
  const start = contentSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const asyncStart = contentSource.lastIndexOf('async ', start);
  const sourceStart = asyncStart >= 0 && asyncStart > contentSource.lastIndexOf('\n', start)
    ? asyncStart : start;
  const signatureEnd = contentSource.indexOf(') {', sourceStart);
  let depth = 0;
  let end = -1;
  for (let index = signatureEnd + 2; index < contentSource.length; index += 1) {
    if (contentSource[index] === '{') depth += 1;
    if (contentSource[index] === '}') depth -= 1;
    if (depth === 0) { end = index; break; }
  }
  assert.ok(end > sourceStart, `unterminated ${name}`);
  const context = vm.createContext({ console, ...dependencies });
  vm.runInContext(`${contentSource.slice(sourceStart, end + 1)}\nthis.result = ${name};`, context);
  return context.result;
}

function installFunctions(context, names) {
  if (names.includes('buildPdfFigureProductionEnvelope')) {
    names = ['ensurePdfFigureProductionAssetRegistry', ...names];
  }
  if (names.includes('recordPdfFigureProductionEnvelope') || names.includes('getPdfFigureProductionEnvelope')) {
    names = ['pdfFigureProductionSourceSignature',
      'pdfFigureProductionEnvelopeRecordKey', ...names];
  }
  for (const name of names) {
    let start = contentSource.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `missing ${name}`);
    const asyncStart = contentSource.lastIndexOf('async ', start);
    if (asyncStart >= 0 && asyncStart > contentSource.lastIndexOf('\n', start)) start = asyncStart;
    const signatureEnd = contentSource.indexOf(') {', start);
    let depth = 0;
    let end = -1;
    for (let index = signatureEnd + 2; index < contentSource.length; index += 1) {
      if (contentSource[index] === '{') depth += 1;
      if (contentSource[index] === '}') depth -= 1;
      if (depth === 0) { end = index; break; }
    }
    assert.ok(end > start, `unterminated ${name}`);
    vm.runInContext(contentSource.slice(start, end + 1), context);
  }
}

function fixture() {
  const pages = [
    { pageNumber: 1, text: 'Figure 2. Perfusion was quantified.\n\nAs shown in Figure 2, co-\nlocalization increased by' },
    { pageNumber: 2, text: ' 20% (P = 0.01).' }
  ];
  const semanticDocument = Object.freeze({
    schemaVersion: 1, documentId: `sha256:${HASH}`, adapterId: 'pdf-native',
    documentHash: HASH, documentGeneration: 13, revision: 7, pageCount: 2,
    index: buildPdfSemanticIndex({ documentHash: HASH, revision: 7, pages })
  });
  const structure = Object.freeze({
    version: '1.0.0-pdf-native', adapterId: 'pdf-native', documentId: `sha256:${HASH}`,
    documentHash: HASH, revision: 1, paragraphs: Object.freeze([]), nodes: Object.freeze([]),
    pages: Object.freeze(pages.map(page => Object.freeze({ pageNumber: page.pageNumber })))
  });
  const nativeDocument = Object.freeze({ structure, documentGeneration: 13, pageCount: 2 });
  const compatibility = createPdfSemanticCompatibilityAdapter({ semanticDocument, nativeDocument });
  const figure = Object.freeze({
    figureId: 'figure-2', figureLabel: 'Figure 2',
    caption: 'Figure 2. Perfusion was quantified.', pageNumber: 1,
    pageNumbers: Object.freeze([1, 2]),
    captionPageNumbers: Object.freeze([1, 2]),
    artworkPageNumbers: Object.freeze([1]),
    artworkPageEvidence: 'manifest',
    artworkCoverage: 'complete',
    sourceFingerprint: HASH
  });
  return { semanticDocument, nativeDocument, compatibility, figure,
    inventory: Object.freeze([figure]) };
}

test('PDF reader loads production context and asset modules before content', () => {
  const contextScript = pdfReaderHtml.indexOf('src="core/pdf-figure-context.js"');
  const productionScript = pdfReaderHtml.indexOf('src="core/pdf-figure-context-production.js"');
  const assetScript = pdfReaderHtml.indexOf('src="core/figure-asset-registry.js"');
  const contentScript = pdfReaderHtml.indexOf('src="content.js"');
  assert.ok(contextScript >= 0 && productionScript > contextScript);
  assert.ok(assetScript > productionScript && contentScript > assetScript);
});

test('content exposes a current-owner PDF production envelope builder and recorder', async () => {
  const f = fixture();
  const context = vm.createContext({
    console,
    SciLLM: { createPdfFigureContextProductionAdapter, createPdfFigureAssetRegistry: require('../core/figure-asset-registry.js').createPdfFigureAssetRegistry },
    __brevessPdfSemanticDocument: f.semanticDocument,
    __brevessPdfSemanticCompatibility: f.compatibility,
    __brevessNativePdfDocument: f.nativeDocument,
    __brevessNativePdfFigures: { documentHash: HASH, figures: f.inventory },
    figureWorkspaceInventory: f.inventory,
    pdfFigureAssetRegistry: null,
    pdfFigureAssetRegistryBindingKey: '',
    pdfFigureAssetRegistrySemanticOwner: null,
    pdfFigureAssetRegistryNativeOwner: null,
    pdfFigureProductionEnvelopes: new Map(),
    pdfFigureProductionEnvelopeOwners: new Map(),
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    btoa: value => Buffer.from(value, 'binary').toString('base64')
  });
  installFunctions(context, [
    'pdfFigureProductionError', 'freezePdfFigureProductionValue',
    'decodePdfFigureProductionBytes', 'currentPdfFigureProductionBinding',
    'buildPdfFigureProductionEnvelope', 'recordPdfFigureProductionEnvelope'
  ]);
  const text = await vm.runInContext(`buildPdfFigureProductionEnvelope(figureWorkspaceInventory[0], { route: 'text-only' })`, context);
  assert.equal(text.route, 'text-only');
  assert.deepEqual(Array.from(text.images), []);
  assert.ok(text.context.context.captionEvidence.length > 0);
  assert.ok(text.context.context.bodyEvidence.length > 0);
  assert.equal(Object.hasOwn(text.context, 'records'), false,
    'full-document index records must not be duplicated in every request variant');
  const selected = await createPdfFigureContextProductionAdapter({
    semanticDocument: f.semanticDocument, compatibility: f.compatibility,
    nativeDocument: f.nativeDocument, figureInventory: f.inventory
  }).selectFigureContext({ figureId: 'figure-2', route: 'text-only' });
  assert.ok(selected.records.length > 0, 'the selector retains its full local index');
  assert.equal(text.semanticContextDigest, selected.semanticContextDigest);
  assert.equal(JSON.stringify(text.textualEvidence), JSON.stringify(selected.context.textualEvidence));
  assert.equal(text.assetProof, null);
  assert.equal(Object.isFrozen(text), true);
  context.textEnvelope = text;
  context.pdfFigureProductionEnvelopes = new Map();
  const recorded = vm.runInContext(`recordPdfFigureProductionEnvelope('figure-2', textEnvelope)`, context);
  assert.equal(recorded, text);
});

test('vision envelope carries exactly one registered asset and shares text evidence with text-only', async () => {
  const f = fixture();
  const registryApi = require('../core/figure-asset-registry.js');
  const context = vm.createContext({
    console,
    SciLLM: { createPdfFigureContextProductionAdapter, createPdfFigureAssetRegistry: registryApi.createPdfFigureAssetRegistry },
    __brevessPdfSemanticDocument: f.semanticDocument,
    __brevessPdfSemanticCompatibility: f.compatibility,
    __brevessNativePdfDocument: f.nativeDocument,
    __brevessNativePdfFigures: { documentHash: HASH, figures: f.inventory },
    figureWorkspaceInventory: f.inventory,
    pdfFigureAssetRegistry: null,
    pdfFigureAssetRegistryBindingKey: '',
    pdfFigureAssetRegistrySemanticOwner: null,
    pdfFigureAssetRegistryNativeOwner: null,
    pdfFigureProductionEnvelopes: new Map(),
    pdfFigureProductionEnvelopeOwners: new Map(),
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    btoa: value => Buffer.from(value, 'binary').toString('base64')
  });
  installFunctions(context, [
    'pdfFigureProductionError', 'freezePdfFigureProductionValue',
    'decodePdfFigureProductionBytes', 'currentPdfFigureProductionBinding',
    'buildPdfFigureProductionEnvelope'
  ]);
  const text = await vm.runInContext(`buildPdfFigureProductionEnvelope(figureWorkspaceInventory[0], { route: 'text-only' })`, context);
  const vision = await vm.runInContext(`buildPdfFigureProductionEnvelope(figureWorkspaceInventory[0], { route: 'vision', images: [{ dataUrl: 'data:image/png;base64,SGVsbG8=', mimeType: 'image/png', width: 10, height: 10 }] })`, context);
  assert.deepEqual(vision.textualEvidence, text.textualEvidence);
  assert.equal(vision.images.length, 1);
  assert.match(vision.assetProof.assetId, /^pdfa-[a-f0-9]{48}$/u);
  assert.match(vision.assetProof.imageContentHash, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(vision).includes('data:image'), false);
  for (const [pages, sourceKind, expectedType] of [
    [[1], 'pdf-original-page', 'full-figure'],
    [[1, 2], 'pdf-original-page', 'full-figure'],
    [[1], 'pdf-page-crop', 'page-region']
  ]) {
    const inventory = [{ ...f.figure, pageNumbers: pages, captionComplete: true }];
    context.figureWorkspaceInventory = inventory;
    context.__brevessNativePdfFigures = { documentHash: HASH, figures: inventory };
    context.imageSourceKind = sourceKind;
    const pageEnvelope = await vm.runInContext(`buildPdfFigureProductionEnvelope(figureWorkspaceInventory[0], {
      route: 'vision', images: [{ dataUrl: 'data:image/png;base64,SGVsbG8=',
        mimeType: 'image/png', width: 10, height: 10, sourcePage: 1, sourceKind: imageSourceKind }]
    })`, context);
    assert.equal(pageEnvelope.assetProof.sourceType, expectedType,
      'only an original page covering the entire current Figure is eligible for whole-Figure discovery');
  }
});

test('caption-only continuation without artwork proof stays text-usable and rejects vision', async () => {
  const f = fixture();
  const unprovenFigure = Object.freeze({
    figureId: f.figure.figureId,
    figureLabel: f.figure.figureLabel,
    caption: f.figure.caption,
    pageNumber: f.figure.pageNumber,
    pageNumbers: f.figure.pageNumbers,
    captionPageNumbers: f.figure.captionPageNumbers,
    sourceFingerprint: f.figure.sourceFingerprint
  });
  const inventory = Object.freeze([unprovenFigure]);
  const registryApi = require('../core/figure-asset-registry.js');
  const context = vm.createContext({
    console,
    SciLLM: {
      createPdfFigureContextProductionAdapter,
      createPdfFigureAssetRegistry: registryApi.createPdfFigureAssetRegistry
    },
    __brevessPdfSemanticDocument: f.semanticDocument,
    __brevessPdfSemanticCompatibility: f.compatibility,
    __brevessNativePdfDocument: f.nativeDocument,
    __brevessNativePdfFigures: { documentHash: HASH, figures: inventory },
    figureWorkspaceInventory: inventory,
    pdfFigureAssetRegistry: null,
    pdfFigureAssetRegistryBindingKey: '',
    pdfFigureAssetRegistrySemanticOwner: null,
    pdfFigureAssetRegistryNativeOwner: null,
    atob: value => Buffer.from(value, 'base64').toString('binary')
  });
  installFunctions(context, [
    'pdfFigureProductionError', 'freezePdfFigureProductionValue',
    'decodePdfFigureProductionBytes', 'currentPdfFigureProductionBinding',
    'buildPdfFigureProductionEnvelope'
  ]);

  const text = await vm.runInContext(
    `buildPdfFigureProductionEnvelope(figureWorkspaceInventory[0], { route: 'text-only' })`,
    context
  );
  assert.equal(text.route, 'text-only');
  assert.equal(text.assetProof, null);
  assert.ok(text.textualEvidence.captions.length > 0);
  assert.ok(text.textualEvidence.body.length > 0);

  await assert.rejects(
    vm.runInContext(`buildPdfFigureProductionEnvelope(figureWorkspaceInventory[0], {
      route: 'vision', images: [{ dataUrl: 'data:image/png;base64,SGVsbG8=',
        mimeType: 'image/png', width: 10, height: 10, sourcePage: 1,
        sourceKind: 'pdf-original-page' }]
    })`, context),
    error => error?.code === 'PDF_FIGURE_ASSET_BINDING_CONFLICT'
  );
});

test('stale PDF owner or wrong Figure fails closed before envelope creation', async () => {
  const f = fixture();
  const context = vm.createContext({
    console,
    SciLLM: { createPdfFigureContextProductionAdapter, createPdfFigureAssetRegistry: require('../core/figure-asset-registry.js').createPdfFigureAssetRegistry },
    __brevessPdfSemanticDocument: f.semanticDocument,
    __brevessPdfSemanticCompatibility: f.compatibility,
    __brevessNativePdfDocument: f.nativeDocument,
    __brevessNativePdfFigures: { documentHash: HASH, figures: f.inventory },
    figureWorkspaceInventory: f.inventory,
    pdfFigureAssetRegistry: null,
    pdfFigureAssetRegistryBindingKey: '',
    pdfFigureAssetRegistrySemanticOwner: null,
    pdfFigureAssetRegistryNativeOwner: null,
    pdfFigureProductionEnvelopes: new Map(),
    pdfFigureProductionEnvelopeOwners: new Map(),
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    btoa: value => Buffer.from(value, 'binary').toString('base64')
  });
  installFunctions(context, [
    'pdfFigureProductionError', 'freezePdfFigureProductionValue',
    'decodePdfFigureProductionBytes', 'currentPdfFigureProductionBinding',
    'buildPdfFigureProductionEnvelope'
  ]);
  vm.runInContext(`this.buildResult = null`, context);
  await assert.rejects(
    vm.runInContext(`buildPdfFigureProductionEnvelope({ figureId: 'other', figureLabel: 'Figure 9', caption: 'x', pageNumber: 1, pageNumbers: [1], sourceFingerprint: '${HASH}' })`, context),
    error => error?.code === 'PDF_FIGURE_ID_INVALID'
  );
  context.__brevessNativePdfDocument = Object.freeze({ ...f.nativeDocument, documentGeneration: 14 });
  await assert.rejects(
    vm.runInContext(`buildPdfFigureProductionEnvelope(figureWorkspaceInventory[0], { route: 'text-only' })`, context),
    error => ['PDF_FIGURE_CONTEXT_STALE', 'PDF_FIGURE_DOCUMENT_BINDING_CONFLICT']
      .includes(error?.code)
  );
});

test('clearing a live owner during envelope construction cannot revive the captured owner', async () => {
  const f = fixture();
  const context = vm.createContext({
    console,
    SciLLM: { createPdfFigureContextProductionAdapter },
    __brevessPdfSemanticDocument: f.semanticDocument,
    __brevessPdfSemanticCompatibility: f.compatibility,
    __brevessNativePdfDocument: f.nativeDocument,
    __brevessNativePdfFigures: { documentHash: HASH, figures: f.inventory },
    figureWorkspaceInventory: f.inventory,
    pdfFigureAssetRegistry: null,
    pdfFigureAssetRegistryBindingKey: '',
    pdfFigureAssetRegistrySemanticOwner: null,
    pdfFigureAssetRegistryNativeOwner: null,
    pdfFigureProductionEnvelopes: new Map(),
    pdfFigureProductionEnvelopeOwners: new Map(),
    atob: value => Buffer.from(value, 'base64').toString('binary')
  });
  installFunctions(context, [
    'pdfFigureProductionError', 'freezePdfFigureProductionValue',
    'decodePdfFigureProductionBytes', 'currentPdfFigureProductionBinding',
    'buildPdfFigureProductionEnvelope'
  ]);
  const pending = vm.runInContext(
    `buildPdfFigureProductionEnvelope(figureWorkspaceInventory[0], { route: 'text-only' })`,
    context
  );
  context.__brevessPdfSemanticDocument = undefined;
  await assert.rejects(pending, error => error?.code === 'PDF_FIGURE_CONTEXT_STALE');
});

test('recorded envelopes reject cleared owners instead of returning stale data', async () => {
  const f = fixture();
  const context = vm.createContext({
    console,
    SciLLM: { createPdfFigureContextProductionAdapter },
    __brevessPdfSemanticDocument: f.semanticDocument,
    __brevessPdfSemanticCompatibility: f.compatibility,
    __brevessNativePdfDocument: f.nativeDocument,
    __brevessNativePdfFigures: { documentHash: HASH, figures: f.inventory },
    figureWorkspaceInventory: f.inventory,
    pdfFigureAssetRegistry: null,
    pdfFigureAssetRegistryBindingKey: '',
    pdfFigureAssetRegistrySemanticOwner: null,
    pdfFigureAssetRegistryNativeOwner: null,
    pdfFigureProductionEnvelopes: new Map(),
    pdfFigureProductionEnvelopeOwners: new Map(),
    atob: value => Buffer.from(value, 'base64').toString('binary')
  });
  installFunctions(context, [
    'pdfFigureProductionError', 'freezePdfFigureProductionValue',
    'decodePdfFigureProductionBytes', 'currentPdfFigureProductionBinding',
    'buildPdfFigureProductionEnvelope', 'recordPdfFigureProductionEnvelope',
    'getPdfFigureProductionEnvelope'
  ]);
  const envelope = await vm.runInContext(
    `buildPdfFigureProductionEnvelope(figureWorkspaceInventory[0], { route: 'text-only' })`,
    context
  );
  context.envelope = envelope;
  vm.runInContext(`recordPdfFigureProductionEnvelope('figure-2', envelope)`, context);
  context.__brevessNativePdfDocument = undefined;
  assert.throws(
    () => vm.runInContext(`getPdfFigureProductionEnvelope('figure-2')`, context),
    error => error?.code === 'PDF_FIGURE_CONTEXT_STALE'
  );
});

test('PDF multi-image input fails before an envelope or provider-ready payload is created', async () => {
  const context = vm.createContext({
    activeNativePdfStructure: () => ({ documentHash: HASH }),
    restorePdfFigurePreparedImageMetadata: (_figure, image) => image,
    prepareFigureImages: async () => [
      { dataUrl: 'data:image/png;base64,QQ==', sourcePage: 1 },
      { dataUrl: 'data:image/png;base64,Qg==', sourcePage: 2 }
    ],
    buildCalls: 0,
    buildPdfFigureProductionEnvelope: async () => { context.buildCalls += 1; },
    recordPdfFigureProductionEnvelope: () => undefined
  });
  installFunctions(context, [
    'pdfFigureProductionError', 'selectPdfFigureProductionImage',
    'preparePdfFigureProductionInput'
  ]);
  context.figure = { figureId: 'figure-2' };
  context.admission = { route: { capabilityMode: 'vision' } };
  await assert.rejects(
    vm.runInContext(`preparePdfFigureProductionInput(figure, admission)`, context),
    error => error?.code === 'PDF_FIGURE_MULTI_ASSET_UNSUPPORTED'
  );
  assert.equal(context.buildCalls, 0);
});

test('PDF multi-image input prefers one hash-bound durable whole-Figure asset', async () => {
  const durable = {
    dataUrl: 'data:image/png;base64,Qw==',
    sourceKind: 'pdf-whole-figure',
    workspacePath: 'pdf/figures/figure-2.png',
    sha256: 'c'.repeat(64)
  };
  const context = vm.createContext({
    activeNativePdfStructure: () => ({ documentHash: HASH }),
    restorePdfFigurePreparedImageMetadata: (_figure, image) => image,
    prepareFigureImages: async () => [
      { dataUrl: 'data:image/png;base64,QQ==', sourcePage: 1 }, durable
    ],
    capturedImages: null,
    buildPdfFigureProductionEnvelope: async (_figure, options) => {
      context.capturedImages = options.images;
      return { verified: true, figure: { figureId: 'figure-2' } };
    },
    recordPdfFigureProductionEnvelope: () => undefined
  });
  installFunctions(context, [
    'pdfFigureProductionError', 'selectPdfFigureProductionImage',
    'preparePdfFigureProductionInput'
  ]);
  context.figure = { figureId: 'figure-2' };
  context.admission = { route: { capabilityMode: 'vision' } };
  const result = await vm.runInContext(
    `preparePdfFigureProductionInput(figure, admission)`, context);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0], durable);
  assert.equal(context.capturedImages[0], durable);
});

test('HTML Figure preparation remains on the legacy image path', async () => {
  const legacyImages = [{ dataUrl: 'data:image/png;base64,QQ==' },
    { dataUrl: 'data:image/png;base64,Qg==' }];
  const context = vm.createContext({
    activeNativePdfStructure: () => null,
    prepareFigureImages: async () => legacyImages,
    buildPdfFigureProductionEnvelope: async () => {
      throw new Error('PDF builder must not run for HTML');
    }
  });
  installFunctions(context, [
    'pdfFigureProductionError', 'selectPdfFigureProductionImage',
    'requireFigureVisualInput',
    'preparePdfFigureProductionInput'
  ]);
  context.figure = { figureId: 'html-figure' };
  context.admission = { route: { capabilityMode: 'vision' } };
  const result = await vm.runInContext(
    `preparePdfFigureProductionInput(figure, admission)`, context);
  assert.equal(result.envelope, null);
  assert.equal(result.images, legacyImages);
  assert.equal(result.images.length, 2);
});

test('background validation callback returns only current identity proof and rechecks vision asset', async () => {
  const f = fixture();
  const registryApi = require('../core/figure-asset-registry.js');
  const context = vm.createContext({
    console,
    chrome: { runtime: { id: 'extension-id' } },
    SciLLM: {
      createPdfFigureContextProductionAdapter,
      createPdfFigureAssetRegistry: registryApi.createPdfFigureAssetRegistry
    },
    __brevessPdfSemanticDocument: f.semanticDocument,
    __brevessPdfSemanticCompatibility: f.compatibility,
    __brevessNativePdfDocument: f.nativeDocument,
    __brevessNativePdfFigures: { documentHash: HASH, figures: f.inventory },
    figureWorkspaceInventory: f.inventory,
    pdfFigureAssetRegistry: null,
    pdfFigureAssetRegistryBindingKey: '',
    pdfFigureAssetRegistrySemanticOwner: null,
    pdfFigureAssetRegistryNativeOwner: null,
    pdfFigureProductionEnvelopes: new Map(),
    pdfFigureProductionEnvelopeOwners: new Map(),
    atob: value => Buffer.from(value, 'base64').toString('binary')
  });
  installFunctions(context, [
    'pdfFigureProductionError', 'freezePdfFigureProductionValue',
    'decodePdfFigureProductionBytes', 'currentPdfFigureProductionBinding',
    'buildPdfFigureProductionEnvelope', 'recordPdfFigureProductionEnvelope',
    'getPdfFigureProductionEnvelope', 'samePdfFigureProductionBinding',
    'samePdfFigureProductionAssetProof',
    'validatePdfFigureProductionContextRequest'
  ]);
  const envelope = await vm.runInContext(
    `buildPdfFigureProductionEnvelope(figureWorkspaceInventory[0], {
      route: 'vision',
      images: [{ dataUrl: 'data:image/png;base64,SGVsbG8=', mimeType: 'image/png',
        width: 10, height: 10 }]
    })`, context);
  context.envelope = envelope;
  context.sourceFigure = { analysisImages: [{ dataUrl: 'data:image/png;base64,SGVsbG8=' }] };
  vm.runInContext(`recordPdfFigureProductionEnvelope('figure-2', envelope, sourceFigure)`, context);
  context.request = {
    figureId: 'figure-2',
    binding: envelope.binding,
    semanticContextDigest: envelope.semanticContextDigest,
    assetProof: envelope.assetProof
  };
  const response = await vm.runInContext(
    `validatePdfFigureProductionContextRequest(request, { id: 'extension-id' })`, context);
  assert.deepEqual(Object.keys(response).sort(),
    ['assetProof', 'binding', 'semanticContextDigest', 'success']);
  assert.equal(response.success, true);
  assert.equal(response.assetProof.assetId, envelope.assetProof.assetId);
  const wrongSender = await vm.runInContext(
    `validatePdfFigureProductionContextRequest(request, { id: 'other-extension' })`, context);
  assert.equal(wrongSender.success, false);
  assert.equal(wrongSender.code, 'PDF_FIGURE_CONTEXT_STALE');

  for (const forged of [
    { ...context.request, binding: {
      ...envelope.binding, semanticRevision: envelope.binding.semanticRevision + 1
    } },
    { ...context.request, semanticContextDigest: 'f'.repeat(64) },
    { ...context.request, assetProof: {
      ...envelope.assetProof, sourceType: 'panel'
    } },
    { ...context.request, assetProof: {
      ...envelope.assetProof, cropRevision: envelope.assetProof.cropRevision + 1
    } },
    { ...context.request, assetProof: null }
  ]) {
    context.forged = forged;
    const rejected = await vm.runInContext(
      `validatePdfFigureProductionContextRequest(forged, { id: 'extension-id' })`, context);
    assert.equal(rejected.success, false);
    assert.equal(rejected.code, 'PDF_FIGURE_CONTEXT_STALE');
  }

  context.__brevessPdfSemanticCompatibility = undefined;
  const stale = await vm.runInContext(
    `validatePdfFigureProductionContextRequest(request, { id: 'extension-id' })`, context);
  assert.equal(stale.success, false);
  assert.equal(stale.code, 'PDF_FIGURE_CONTEXT_STALE');
});

test('background validation callback accepts current text-only proof without an asset', async () => {
  const f = fixture();
  const context = vm.createContext({
    console,
    chrome: { runtime: { id: 'extension-id' } },
    SciLLM: { createPdfFigureContextProductionAdapter },
    __brevessPdfSemanticDocument: f.semanticDocument,
    __brevessPdfSemanticCompatibility: f.compatibility,
    __brevessNativePdfDocument: f.nativeDocument,
    __brevessNativePdfFigures: { documentHash: HASH, figures: f.inventory },
    figureWorkspaceInventory: f.inventory,
    pdfFigureAssetRegistry: null,
    pdfFigureAssetRegistryBindingKey: '',
    pdfFigureAssetRegistrySemanticOwner: null,
    pdfFigureAssetRegistryNativeOwner: null,
    pdfFigureProductionEnvelopes: new Map(),
    pdfFigureProductionEnvelopeOwners: new Map(),
    atob: value => Buffer.from(value, 'base64').toString('binary')
  });
  installFunctions(context, [
    'pdfFigureProductionError', 'freezePdfFigureProductionValue',
    'decodePdfFigureProductionBytes', 'currentPdfFigureProductionBinding',
    'buildPdfFigureProductionEnvelope', 'recordPdfFigureProductionEnvelope',
    'getPdfFigureProductionEnvelope', 'samePdfFigureProductionBinding',
    'samePdfFigureProductionAssetProof',
    'validatePdfFigureProductionContextRequest'
  ]);
  const envelope = await vm.runInContext(
    `buildPdfFigureProductionEnvelope(figureWorkspaceInventory[0], { route: 'text-only' })`,
    context);
  context.envelope = envelope;
  vm.runInContext(`recordPdfFigureProductionEnvelope('figure-2', envelope)`, context);
  context.request = {
    figureId: 'figure-2',
    binding: envelope.binding,
    semanticContextDigest: envelope.semanticContextDigest,
    assetProof: null
  };
  const response = await vm.runInContext(
    `validatePdfFigureProductionContextRequest(request, { id: 'extension-id' })`, context);
  assert.equal(response.success, true);
  assert.equal(response.assetProof, null);
});

test('content message receiver wires the PDF validation action asynchronously with sender identity', () => {
  assert.match(contentSource,
    /request\.action === 'validatePdfFigureProductionContext'[\s\S]{0,400}validatePdfFigureProductionContextRequest\(request, sender\)[\s\S]{0,400}return true;/u);
});

test('real PDF image preparation preserves measured dimensions and invalidates in-place source replacement', async () => {
  const f = fixture();
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
  const source = { dataUrl, mediaType: 'image/png', width: 999, height: 999,
    sourcePage: 1, sourceKind: 'pdf-original-page', documentHash: HASH, documentGeneration: 13 };
  const figure = { ...f.figure, sourceKind: 'pdf-page-caption', analysisImages: [source] };
  const inventory = [figure];
  const context = vm.createContext({
    console, setTimeout, clearTimeout,
    chrome: { runtime: { id: 'extension-id' } },
    SciLLM: { createPdfFigureContextProductionAdapter,
      createPdfFigureAssetRegistry: require('../core/figure-asset-registry.js').createPdfFigureAssetRegistry },
    __brevessPdfSemanticDocument: f.semanticDocument,
    __brevessPdfSemanticCompatibility: f.compatibility,
    __brevessNativePdfDocument: f.nativeDocument,
    __brevessNativePdfFigures: { documentHash: HASH, figures: inventory },
    activeNativePdfStructure: () => f.nativeDocument.structure,
    pdfFigureArtworkRestoreOwners: new WeakMap(),
    getWorkspaceAssetCheckpoint: async () => null,
    pdfFigureAssetRegistry: null, pdfFigureAssetRegistryBindingKey: '',
    pdfFigureAssetRegistrySemanticOwner: null, pdfFigureAssetRegistryNativeOwner: null,
    pdfFigureProductionEnvelopes: new Map(), pdfFigureProductionEnvelopeOwners: new Map(),
    releasedFigureImages: new WeakSet(),
    FIGURE_IMAGE_MAX_BYTES: 1572864, FIGURE_IMAGE_LIMIT: 4,
    FIGURE_IMAGE_SOURCE_MAX_EDGE: 8192, FIGURE_IMAGE_SOURCE_MAX_PIXELS: 40000000,
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000, FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 12000,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    // Browser image decoding is the only image-layer substitute: the real
    // header parser, admission and final registry hashing still run below.
    loadFigureImage: async () => ({ naturalWidth: 1, naturalHeight: 1, decode: async () => {} })
  });
  installFunctions(context, [
    'figureImageError', 'figureImageTimeoutError', 'figureImageBytesMatchMediaType',
    'admitFigureImageDimensions', 'readFigureImageDimensions', 'matchFigureImageDimensions',
    'validateFigureProviderImage', 'validateFigureProviderImageDimensions',
    'collectValidFigureProviderImages', 'decodeFigureProviderImage', 'admitFigureProviderImages',
    'releaseFigureImage', 'requireFigureTaskAdmission', 'shouldUpgradePersistedFigureImage',
    'ensureNativePdfFigureImages', 'prepareFigureImages', 'preferHigherResolutionFigureImages',
    'pdfFigureProductionError', 'freezePdfFigureProductionValue', 'decodePdfFigureProductionBytes',
    'currentPdfFigureProductionBinding', 'buildPdfFigureProductionEnvelope',
    'recordPdfFigureProductionEnvelope', 'getPdfFigureProductionEnvelope',
    'samePdfFigureProductionBinding', 'samePdfFigureProductionAssetProof',
    'validatePdfFigureProductionContextRequest', 'restorePdfFigurePreparedImageMetadata',
    'selectPdfFigureProductionImage', 'preparePdfFigureProductionInput',
    'pdfFigureArtworkSelectionPath', 'pdfFigureArtworkOwnerSignature',
    'validatedPdfFigureArtworkSelection', 'restoreNativePdfFigureArtworkSelection'
  ]);
  context.figure = figure;
  context.admission = { taskId: 'figure_walkthrough', taskPolicySignature: 'policy-fixture',
    route: { taskType: 'figure_walkthrough', providerId: 'deepseek', capabilityMode: 'vision' } };
  const prepared = await vm.runInContext('preparePdfFigureProductionInput(figure, admission)', context);
  assert.equal(prepared.images.length, 1);
  assert.equal(prepared.images[0].width, 1);
  assert.equal(prepared.images[0].height, 1);
  assert.equal(prepared.envelope.assetProof.sourceType, 'full-figure');
  assert.deepEqual(Array.from(prepared.envelope.assetProof.pageNumbers), [1]);
  assert.equal(prepared.envelope.assetProof.imageContentHash,
    require('node:crypto').createHash('sha256').update(Buffer.from(dataUrl.split(',')[1], 'base64')).digest('hex'));
  context.request = { figureId: figure.figureId, binding: prepared.envelope.binding,
    semanticContextDigest: prepared.envelope.semanticContextDigest, assetProof: prepared.envelope.assetProof };
  assert.equal((await vm.runInContext(
    "validatePdfFigureProductionContextRequest(request, { id: 'extension-id' })", context)).success, true);
  figure.analysisImages = [{ ...source, dataUrl: 'data:image/png;base64,dGFtcGVyZWQ=' }];
  const replaced = await vm.runInContext(
    "validatePdfFigureProductionContextRequest(request, { id: 'extension-id' })", context);
  assert.equal(replaced.success, false);
  assert.equal(replaced.code, 'PDF_FIGURE_CONTEXT_STALE');
  for (const [key, value] of [['sourcePage', 2], ['sourceKind', 'pdf-whole-figure'],
    ['workspacePath', 'pdf/figures/replaced.png'], ['sha256', 'f'.repeat(64)]]) {
    const mutableSource = { ...source };
    figure.analysisImages = [mutableSource];
    context.SciLLM.createPdfFigureContextProductionAdapter = options => {
      const adapter = createPdfFigureContextProductionAdapter(options);
      return { async selectFigureContext(request) {
        const result = await adapter.selectFigureContext(request);
        mutableSource[key] = value;
        return result;
      } };
    };
    await assert.rejects(vm.runInContext('preparePdfFigureProductionInput(figure, admission)', context),
      error => error?.code === 'PDF_FIGURE_CONTEXT_STALE',
      `${key} replacement while building must not bind old pixels to a new source`);
  }
});
