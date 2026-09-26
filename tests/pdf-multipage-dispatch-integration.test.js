const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

require('../core/category-store.js');
require('../core/i18n.js');
require('../core/adaptive-catalog.js');
require('../core/study-profile.js');
require('../core/confidence-policy.js');
require('../core/settings-store.js');
require('../providers/provider-utils.js');
require('../core/prompt-compiler.js');
require('../core/provider-probes.js');
require('../core/chunker.js');
require('../core/result-validator.js');
require('../core/evidence-ledger.js');
require('../core/figure-analysis.js');
require('../core/figure-panel-planner.js');
require('../core/figure-panel-recovery.js');
require('../core/supplemental-materials.js');
require('../core/article-chat-tokenizer.js');
require('../core/article-chat-index.js');
require('../core/article-chat-retrieval.js');
require('../core/article-chat-memory.js');
require('../core/article-chat-citations.js');
require('../core/article-chat-stream.js');
require('../core/article-chat-web-sources.js');
require('../core/article-chat.js');
require('../core/research-evidence.js');
require('../core/research-logic-pipeline.js');
require('../core/reading-tools.js');
require('../core/panel-ledger.js');
require('../core/cross-figure-logic.js');
require('../core/review-outline.js');
require('../core/abbreviation-extractor.js');
require('../core/cache-planner.js');
require('../core/privacy-sanitizer.js');
require('../core/article-workspace.js');
require('../core/article-workspace-save.js');
require('../core/pdf-workspace.js');
require('../core/document-store.js');
require('../core/migration-bundle.js');
require('../core/analysis-pipeline.js');
require('../core/analysis-cache.js');
require('../core/review-outline-pipeline.js');
require('../core/corpus-store.js');
require('../core/pdf-annotations.js');
require('../core/manual-annotations.js');
require('../providers/openai.js');
require('../providers/anthropic.js');
require('../providers/gemini.js');
require('../providers/deepseek.js');
require('../providers/codex-local.js');
require('../providers/openai-compatible.js');
require('../providers/provider-registry.js');
require('../core/provider-model-discovery.js');
require('../core/task-profile-router.js');
require('../core/token-budget.js');
require('../core/article-chat-context-planner.js');
require('../core/operation-control.js');
require('../core/mechanism-operation-coordinator.js');
require('../core/evidence-first-mechanism.js');

const { buildPdfSemanticIndex } = require('../core/pdf-semantic-index.js');
const { orderPdfTextContentForReading } = require('../core/pdf-text-projection.js');
const { extractNativePdfFigures } = require('../core/pdf-native-figures.js');
const {
  createPdfSemanticCompatibilityAdapter
} = require('../core/pdf-semantic-compat.js');
const {
  createPdfFigureContextProductionAdapter
} = require('../core/pdf-figure-context-production.js');
const {
  createPdfFigureAssetRegistry
} = require('../core/figure-asset-registry.js');
const {
  createPdfFigureVisualEvidenceSet
} = require('../core/pdf-figure-request.js');
const {
  createBackgroundRouter
} = require('../core/background-router.js');

const root = path.join(__dirname, '..');
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const publicPdf = path.join(root, 'tmp', 'public-pdf-acceptance',
  'indoor-air-1537588.pdf');
const PUBLIC_PDF_SHA256 =
  '1b6d4c807c729a822c4ca6ef898d1268ddba7d27adc9854510ae75e01069fe3c';
const PAGE_5_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
const PAGE_6_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function extractFunctionSource(name) {
  let start = contentSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const asyncStart = contentSource.lastIndexOf('async ', start);
  if (asyncStart >= 0 && asyncStart > contentSource.lastIndexOf('\n', start)) {
    start = asyncStart;
  }
  const signatureEnd = contentSource.indexOf(') {', start);
  assert.ok(signatureEnd >= 0, `missing signature for ${name}`);
  let depth = 0;
  for (let index = signatureEnd + 2; index < contentSource.length; index += 1) {
    if (contentSource[index] === '{') depth += 1;
    if (contentSource[index] === '}') depth -= 1;
    if (depth === 0) return contentSource.slice(start, index + 1);
  }
  assert.fail(`unterminated ${name}`);
}

function installContentFunctions(context, names) {
  for (const name of names) {
    vm.runInContext(extractFunctionSource(name), context);
  }
}

function createMemoryStorage(initialValues = {}) {
  const values = initialValues;
  return {
    values,
    get(key, callback) { callback({ [key]: values[key] }); },
    set(input, callback) { Object.assign(values, input); callback(); }
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return null; } },
    async text() { return JSON.stringify(body); }
  };
}

function figureMessage(figure, overrides = {}) {
  return {
    type: 'LLM_ANALYZE_FIGURES',
    document: {
      title: 'Indoor Air Remediation Using Biochar from Bark',
      paragraphs: [{
        paragraphId: 'pdf-page-4', sectionTitle: 'Results',
        text: 'Figure 1 compares bark-derived biochar particles at two magnifications.'
      }]
    },
    figures: [figure],
    analysisDepth: 'standard',
    operationScope: 'figure',
    workspaceLifecycle: 205,
    operationId: 'pdf-multipage-dispatch-operation-12345678',
    figureRequestReceipt: 'figure-request-pdf-multipage-dispatch-12345678',
    figureOperationPlan: [{ figureId: 'figure-1', panelCount: 2 }],
    providerAttemptsConsumed: 0,
    forceRefresh: true,
    ...overrides
  };
}

async function createContentFixture() {
  const documentHash = crypto.createHash('sha256')
    .update('indoor-air-1537588-explicit-artwork-manifest').digest('hex');
  const pages = Array.from({ length: 12 }, (_, indexValue) => ({
    pageNumber: indexValue + 1,
    text: `Acceptance fixture page ${indexValue + 1}.`
  }));
  pages[3].text =
    'Figure 1 compares bark-derived biochar particles at two magnifications.';
  pages[4].text =
    '(a) P6 (b) P5 (c) P4 (d) P3 (e) P2 (f) P1 (g) BM (h) P6 (i) P5 (j) P4 (k) P3 (l) P2 Figure 1: Continued.';
  pages[5].text =
    '(m) P1 (n) BM Figure 1: SEM images of the biochar samples with different particle sizes at different magnifications.';
  const index = buildPdfSemanticIndex({ documentHash, revision: 7, pages });
  const structure = {
    version: '1.0.0-pdf-native', adapterId: 'pdf-native',
    documentId: `sha256:${documentHash}`, documentHash, revision: 1,
    paragraphs: pages.map((page, indexValue) => ({
      paragraphId: `pdf-page-${page.pageNumber}`, sourceKey: `pdf-page-${page.pageNumber}`,
      pageNumber: page.pageNumber, order: indexValue, text: page.text,
      displayText: page.text
    })),
    nodes: [], pages: pages.map(page => ({ pageNumber: page.pageNumber }))
  };
  const nativeDocument = { structure, documentGeneration: 13, pageCount: 12 };
  const semanticDocument = {
    schemaVersion: 1, documentId: structure.documentId, adapterId: 'pdf-native',
    documentHash, documentGeneration: 13, revision: 7, pageCount: 12, index
  };
  const compatibility = createPdfSemanticCompatibilityAdapter({
    semanticDocument, nativeDocument
  });
  const analysisImages = [
    { dataUrl: `data:image/png;base64,${PAGE_5_PNG}`, mimeType: 'image/png',
      mediaType: 'image/png', width: 1, height: 1, sourcePage: 5,
      sourceKind: 'pdf-original-page', documentHash, documentGeneration: 13 },
    { dataUrl: `data:image/png;base64,${PAGE_6_PNG}`, mimeType: 'image/png',
      mediaType: 'image/png', width: 1, height: 1, sourcePage: 6,
      sourceKind: 'pdf-original-page', documentHash, documentGeneration: 13 }
  ];
  const figure = {
    figureId: 'figure-1', figureLabel: 'Figure 1',
    caption: 'Figure 1: SEM images of the biochar samples with different particle sizes at different magnifications.',
    pageNumber: 6, pageNumbers: [6], captionPageNumbers: [6],
    artworkPageNumbers: [5, 6], artworkCoverage: 'complete',
    artworkPageEvidence: 'user-selection', captionComplete: true,
    panelHints: ['A', 'M'], sourceKind: 'pdf-page-caption',
    sourceFingerprint: documentHash, analysisImages
  };
  const inventory = [figure];
  const context = vm.createContext({
    console,
    SciLLM: {
      createPdfFigureContextProductionAdapter,
      createPdfFigureAssetRegistry,
      createPdfFigureVisualEvidenceSet,
      pdfFigureSemanticEvidenceDigest: globalThis.SciLLM.pdfFigureSemanticEvidenceDigest,
      pdfFigurePanelDirectoryDigest: globalThis.SciLLM.pdfFigurePanelDirectoryDigest,
      sha256FigureBytes: globalThis.SciLLM.sha256FigureBytes
    },
    chrome: { runtime: { id: 'extension-id' } },
    __brevessPdfSemanticDocument: semanticDocument,
    __brevessPdfSemanticCompatibility: compatibility,
    __brevessNativePdfDocument: nativeDocument,
    __brevessNativePdfFigures: { documentHash, figures: inventory },
    figureWorkspaceInventory: inventory,
    figureWalkthroughState: new Map(),
    pdfFigureAssetRegistry: null,
    pdfFigureAssetRegistryBindingKey: '',
    pdfFigureAssetRegistrySemanticOwner: null,
    pdfFigureAssetRegistryNativeOwner: null,
    pdfFigureProductionEnvelopes: new Map(),
    pdfFigureProductionEnvelopeOwners: new Map(),
    pdfFigureProductionEnvelopeRecords: new Map(),
    pdfFigureProductionEnvelopeRecordOwners: new Map(),
    PDF_FIGURE_PRODUCTION_ENVELOPE_RECORD_LIMIT: 256,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    btoa: value => Buffer.from(value, 'binary').toString('base64')
  });
  installContentFunctions(context, [
    'pdfFigureProductionError', 'freezePdfFigureProductionValue',
    'decodePdfFigureProductionBytes', 'currentPdfFigureProductionBinding',
    'ensurePdfFigureProductionAssetRegistry', 'buildPdfFigureProductionEnvelope',
    'pdfFigureProductionSourceSignature', 'pdfFigureProductionEnvelopeRecordKey',
    'recordPdfFigureProductionEnvelope', 'getPdfFigureProductionEnvelope',
    'samePdfFigureProductionBinding', 'samePdfFigureProductionAssetProof',
    'validatePdfFigureProductionContextRequest',
    'selectNativePdfFigurePanelSource', 'prepareFigurePanelImageVariants'
  ]);
  context.figure = figure;
  context.images = analysisImages;
  const visionEnvelope = await vm.runInContext(
    `buildPdfFigureProductionEnvelope(figure, { route: 'vision', images })`, context
  );
  context.visionEnvelope = visionEnvelope;
  vm.runInContext(`this.preparedImages = images.map(image => ({ ...image,
    pdfSourceSignature: pdfFigureProductionSourceSignature(image) }));
    recordPdfFigureProductionEnvelope('figure-1', visionEnvelope, figure, preparedImages);`,
  context);
  return {
    context, documentHash, figure, analysisImages, visionEnvelope, pages,
    async verifyCurrent(query) {
      context.query = structuredClone(query);
      return vm.runInContext(
        `validatePdfFigureProductionContextRequest(query, { id: 'extension-id' })`,
        context
      );
    }
  };
}

test('public acceptance PDF has Figure 1 artwork on pages 5 and 6, with caption on page 6', async () => {
  assert.ok(fs.existsSync(publicPdf), 'download the pinned open-access acceptance PDF first');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(publicPdf)).digest('hex'),
    PUBLIC_PDF_SHA256);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: new Uint8Array(fs.readFileSync(publicPdf)),
    useSystemFonts: true }).promise;
  try {
    assert.equal(pdf.numPages, 12);
    const text = async pageNumber => {
      const page = await pdf.getPage(pageNumber);
      return (await page.getTextContent()).items.map(item => item.str).join(' ')
        .replace(/\s+/gu, ' ');
    };
    const page5 = await text(5);
    const page6 = await text(6);
    for (const label of ['a', 'b', 'c', 'd', 'e', 'f', 'g',
      'h', 'i', 'j', 'k', 'l']) assert.match(page5, new RegExp(`\\(${label}\\)`));
    assert.match(page5, /Figure\s+1:\s+Continued/iu);
    assert.match(page6, /\(m\)\s*P1/iu);
    assert.match(page6, /\(n\)\s*BM/iu);
    assert.match(page6, /Figure\s+1:\s+SEM images of the biochar samples/iu);
    assert.doesNotMatch(page5, /SEM images of the biochar samples/iu,
      'the final caption is separate from the first artwork page');

    const page6Object = await pdf.getPage(6);
    const rawTextContent = await page6Object.getTextContent({
      includeMarkedContent: true, disableNormalization: true
    });
    const readingOrderTextContent = orderPdfTextContentForReading(
      rawTextContent, page6Object
    );
    const expectedCaption = 'Figure 1: SEM images of the biochar samples with di ff erent ' +
      'particle sizes at di ff erent magni fi cations: (a – g) × 250, (h, k, m, n) × 25K, ' +
      '(i, l) × 10 K, and (h – n) × 15K.';
    for (const [mode, textContent] of [
      ['raw-pdfjs', rawTextContent], ['reader-reading-order', readingOrderTextContent]
    ]) {
      const extracted = extractNativePdfFigures([{
        pageNumber: 6, textContent
      }], { sourceFingerprint: PUBLIC_PDF_SHA256 });
      const figure = extracted.find(item => item.figureId === 'figure-1');
      assert.ok(figure, `${mode} must retain Figure 1`);
      assert.equal(figure.caption, expectedCaption, `${mode} caption boundary`);
      assert.equal(figure.captionComplete, true, `${mode} caption completeness`);
      assert.doesNotMatch(figure.caption, /milling processes|Indoor Air/iu,
        `${mode} must exclude body and page furniture`);
    }
  } finally {
    await pdf.destroy();
  }
});

test('content creates and revalidates an ordered v2 current-owner set; text remains image-free',
  async () => {
    const fixture = await createContentFixture();
    const envelope = fixture.visionEnvelope;
    assert.equal(envelope.version, 'pdf-figure-production-envelope-v2');
    assert.equal(envelope.assetProof, null);
    assert.deepEqual(Array.from(envelope.visualEvidenceSet.requiredArtworkPageNumbers), [5, 6]);
    assert.deepEqual(Array.from(envelope.visualEvidenceSet.assets,
      asset => asset.pageNumber), [5, 6]);
    assert.equal(envelope.images.length, 2);
    assert.match(envelope.visualEvidenceSet.setDigest, /^[a-f0-9]{64}$/u);

    const query = {
      figureId: 'figure-1', binding: envelope.binding,
      semanticContextDigest: envelope.semanticContextDigest,
      assetProof: null, visualEvidenceSet: envelope.visualEvidenceSet
    };
    assert.equal((await fixture.verifyCurrent(query)).success, true);

    fixture.context.reversedImages = [...fixture.analysisImages].reverse();
    await assert.rejects(vm.runInContext(
      `buildPdfFigureProductionEnvelope(figure, {
        route: 'vision', images: reversedImages
      })`, fixture.context), { code: 'PDF_FIGURE_ARTWORK_PAGES_INVALID' });
    fixture.context.missingImages = fixture.analysisImages.slice(0, 1);
    await assert.rejects(vm.runInContext(
      `buildPdfFigureProductionEnvelope(figure, {
        route: 'vision', images: missingImages
      })`, fixture.context), { code: 'PDF_FIGURE_ARTWORK_PAGES_INVALID' });

    fixture.context.figure.analysisImages.reverse();
    assert.throws(() => vm.runInContext(
      `getPdfFigureProductionEnvelope('figure-1', visionEnvelope)`, fixture.context),
    { code: 'PDF_FIGURE_CONTEXT_STALE' });

    const replaced = await createContentFixture();
    replaced.figure.analysisImages[1] = {
      ...replaced.figure.analysisImages[1], dataUrl: replaced.figure.analysisImages[0].dataUrl
    };
    assert.throws(() => vm.runInContext(
      `getPdfFigureProductionEnvelope('figure-1', visionEnvelope)`, replaced.context),
    { code: 'PDF_FIGURE_CONTEXT_STALE' });

    const cloned = await createContentFixture();
    cloned.figure.analysisImages[1] = { ...cloned.figure.analysisImages[1] };
    assert.throws(() => vm.runInContext(
      `getPdfFigureProductionEnvelope('figure-1', visionEnvelope)`, cloned.context),
    { code: 'PDF_FIGURE_CONTEXT_STALE' },
    'an exact-value replacement cannot retain the recorded source slot');

    const deferred = await createContentFixture();
    deferred.context.pdfFigureAssetRegistry = null;
    deferred.context.pdfFigureAssetRegistryBindingKey = '';
    let releaseRegister;
    const registerGate = new Promise(resolve => { releaseRegister = resolve; });
    deferred.context.delayedRegistryFactory = options => {
      const registry = createPdfFigureAssetRegistry(options);
      let first = true;
      return {
        ...registry,
        async register(input) {
          if (first) {
            first = false;
            await registerGate;
          }
          return registry.register(input);
        }
      };
    };
    const pending = vm.runInContext(
      `buildPdfFigureProductionEnvelope(figure, {
        route: 'vision', images, createAssetRegistry: delayedRegistryFactory
      })`, deferred.context);
    deferred.figure.artworkPageNumbers[0] = 4;
    releaseRegister();
    await assert.rejects(pending, { code: 'PDF_FIGURE_CONTEXT_STALE' },
      'an in-place artwork manifest mutation during registry hashing must fail closed');

    const fresh = await createContentFixture();
    const textEnvelope = await vm.runInContext(
      `buildPdfFigureProductionEnvelope(figure, { route: 'text-only', images: [] })`,
      fresh.context
    );
    assert.equal(textEnvelope.version, 'pdf-figure-production-envelope-v1');
    assert.equal(textEnvelope.assetProof, null);
    assert.deepEqual(Array.from(textEnvelope.images), []);
    assert.equal(Object.hasOwn(textEnvelope, 'visualEvidenceSet'), false);

    const missing = structuredClone(fresh.visionEnvelope.visualEvidenceSet);
    missing.assets.pop();
    const wrongQuery = { figureId: 'figure-1', binding: fresh.visionEnvelope.binding,
      semanticContextDigest: fresh.visionEnvelope.semanticContextDigest,
      assetProof: null, visualEvidenceSet: missing };
    assert.equal((await fresh.verifyCurrent(wrongQuery)).success, false);
  });

test('Panel inventory map selects the verified parent page and rejects missing or replaced sources',
  async () => {
    const fixture = await createContentFixture();
    const set = fixture.visionEnvelope.visualEvidenceSet;
    const inventory = {
      version: 'pdf-figure-panel-inventory-v3',
      markers: [
        { label: 'A', clarity: 'clear', pageNumber: 5 },
        { label: 'M', clarity: 'clear', pageNumber: 6 }
      ],
      panelPageMap: { A: 5, M: 6 },
      provenance: {
        figureId: 'figure-1', visualEvidenceSetDigest: set.setDigest,
        semanticEvidenceDigest: await globalThis.SciLLM
          .pdfFigureSemanticEvidenceDigest(fixture.visionEnvelope)
      }
    };
    const inventoryDigest = await globalThis.SciLLM
      .pdfFigurePanelDirectoryDigest(inventory);
    fixture.context.figureWalkthroughState.set('figure-1', {
      standard: {
        pdfEvidenceBinding: {
          figureId: 'figure-1', binding: fixture.visionEnvelope.binding,
          semanticContextDigest: fixture.visionEnvelope.semanticContextDigest,
          assetProof: null, visualEvidenceSet: set
        },
        pdfPanelInventory: inventory,
        pdfPanelInventoryDigest: inventoryDigest
      }
    });
    fixture.context.panelId = 'M';
    const selected = vm.runInContext(
      `selectNativePdfFigurePanelSource(figure, panelId)`, fixture.context
    );
    assert.equal(selected.source.sourcePage, 6);
    assert.equal(selected.source.dataUrl, fixture.analysisImages[1].dataUrl);

    fixture.context.panelId = 'B';
    assert.throws(() => vm.runInContext(
      `selectNativePdfFigurePanelSource(figure, panelId)`, fixture.context),
    { code: 'PDF_FIGURE_PANEL_PAGE_UNVERIFIED' });

    fixture.context.panelId = 'M';
    fixture.figure.analysisImages[1] = { ...fixture.figure.analysisImages[1],
      sourcePage: 5 };
    assert.throws(() => vm.runInContext(
      `selectNativePdfFigurePanelSource(figure, panelId)`, fixture.context),
    { code: 'PDF_FIGURE_PANEL_PAGE_UNVERIFIED' });
  });

test('Panel preparation migrates verified page ownership across generation only for identical pixels and semantics',
  async () => {
    async function scenario({ replaceSecondPage = false, changeBodyText = false,
      tamperDirectory = false, deferredDirectoryTamper = false } = {}) {
      const fixture = await createContentFixture();
      const previousSet = fixture.visionEnvelope.visualEvidenceSet;
      const semanticEvidenceDigest = await globalThis.SciLLM
        .pdfFigureSemanticEvidenceDigest(fixture.visionEnvelope);
      const panelInventory = {
        version: 'pdf-figure-panel-inventory-v3',
        markers: [
          { label: 'A', clarity: 'clear', pageNumber: 5 },
          { label: 'M', clarity: 'clear', pageNumber: 6 }
        ],
        panelPageMap: { A: 5, M: 6 },
        provenance: {
          figureId: 'figure-1', visualEvidenceSetDigest: previousSet.setDigest,
          semanticEvidenceDigest
        }
      };
      fixture.context.figureWalkthroughState.set('figure-1', {
        standard: {
          pdfEvidenceBinding: {
            figureId: 'figure-1', binding: fixture.visionEnvelope.binding,
            semanticContextDigest: fixture.visionEnvelope.semanticContextDigest,
            assetProof: null, visualEvidenceSet: previousSet
          },
          pdfPanelInventory: panelInventory,
          pdfPanelInventoryDigest: await globalThis.SciLLM
            .pdfFigurePanelDirectoryDigest(panelInventory)
        }
      });
      if (tamperDirectory) {
        const standard = fixture.context.figureWalkthroughState.get('figure-1').standard;
        const changed = structuredClone(standard.pdfPanelInventory);
        changed.panelPageMap.M = 5;
        changed.markers.find(marker => marker.label === 'M').pageNumber = 5;
        standard.pdfPanelInventory = changed;
      }
      const pages = fixture.pages.map(page => ({ ...page }));
      if (changeBodyText) pages[3].text += ' Changed semantic evidence.';
      const documentGeneration = 14;
      const index = buildPdfSemanticIndex({
        documentHash: fixture.documentHash, revision: 7, pages
      });
      const structure = {
        ...fixture.context.__brevessNativePdfDocument.structure,
        paragraphs: pages.map((page, indexValue) => ({
          paragraphId: `pdf-page-${page.pageNumber}`,
          sourceKey: `pdf-page-${page.pageNumber}`,
          pageNumber: page.pageNumber, order: indexValue,
          text: page.text, displayText: page.text
        }))
      };
      const nativeDocument = { structure, documentGeneration, pageCount: 12 };
      const semanticDocument = {
        schemaVersion: 1, documentId: structure.documentId, adapterId: 'pdf-native',
        documentHash: fixture.documentHash, documentGeneration, revision: 7,
        pageCount: 12, index
      };
      const compatibility = createPdfSemanticCompatibilityAdapter({
        semanticDocument, nativeDocument
      });
      const analysisImages = fixture.analysisImages.map(image => ({
        ...image, documentGeneration
      }));
      if (replaceSecondPage) analysisImages[1] = {
        ...analysisImages[1], dataUrl: analysisImages[0].dataUrl
      };
      const figure = { ...fixture.figure, analysisImages };
      let releaseDecode;
      let announceDecode;
      const decodeStarted = new Promise(resolve => { announceDecode = resolve; });
      const decodeGate = new Promise(resolve => { releaseDecode = resolve; });
      Object.assign(fixture.context, {
        __brevessPdfSemanticDocument: semanticDocument,
        __brevessPdfSemanticCompatibility: compatibility,
        __brevessNativePdfDocument: nativeDocument,
        __brevessNativePdfFigures: { documentHash: fixture.documentHash, figures: [figure] },
        figure,
        requireFigureTaskAdmission() {},
        async restoreNativePdfFigureArtworkSelection() {},
        async ensureNativePdfFigureImages() {},
        activeNativePdfStructure() { return nativeDocument.structure; },
        FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 5000,
        async admitFigureProviderImages() {
          if (deferredDirectoryTamper) {
            announceDecode();
            await decodeGate;
          }
          return { rejected: false, truncated: false,
            decodedSources: [{ naturalWidth: 1, naturalHeight: 1, width: 1, height: 1 }] };
        },
        admitFigureImageDimensions() {},
        normalizePanelCropGeometry() { return null; },
        encodeFigureImageVariant(_source, maxEdge) {
          return { dataUrl: analysisImages[1].dataUrl, mediaType: 'image/png',
            mimeType: 'image/png', width: 1, height: 1, maxEdge };
        },
        validateFigureProviderImageDimensions(image) { return { image }; },
        figureImageTimeoutError() {
          const error = new Error('FIGURE_IMAGE_PREPARATION_TIMEOUT');
          error.code = 'FIGURE_IMAGE_PREPARATION_TIMEOUT';
          return error;
        },
        figureImageDiagnosticCode(error) { return error?.code || 'FIGURE_IMAGE_INVALID'; },
        releaseFigureImage() {}
      });
      fixture.context.admission = { route: { capabilityMode: 'vision' } };
      const promise = vm.runInContext(
        `prepareFigurePanelImageVariants(figure, 'M', admission, 'panel-M')`,
        fixture.context
      );
      if (deferredDirectoryTamper) {
        await decodeStarted;
        const live = fixture.context.figureWalkthroughState.get('figure-1')
          .standard.pdfPanelInventory;
        live.panelPageMap.M = 5;
        live.markers.find(marker => marker.label === 'M').pageNumber = 5;
        releaseDecode();
      }
      return {
        fixture, promise
      };
    }

    const identical = await scenario();
    const variants = await identical.promise;
    assert.equal(variants.length, 1);
    assert.equal(variants[0].assetProof.sourceType, 'panel');
    assert.equal(variants[0].pdfFigureContext.panelParentVisualEvidenceSet
      .requiredArtworkPageNumbers.join(','), '5,6');

    const changedPixels = await scenario({ replaceSecondPage: true });
    await assert.rejects(changedPixels.promise,
      { code: 'PDF_FIGURE_PANEL_PAGE_UNVERIFIED' });

    const changedText = await scenario({ changeBodyText: true });
    await assert.rejects(changedText.promise,
      { code: 'PDF_FIGURE_PANEL_PAGE_UNVERIFIED' });

    const tamperedDirectory = await scenario({ tamperDirectory: true });
    await assert.rejects(tamperedDirectory.promise,
      { code: 'PDF_FIGURE_PANEL_PAGE_UNVERIFIED' },
      'coordinated marker/map tampering must fail the retained directory digest gate');

    const tamperedDuringDecode = await scenario({ deferredDirectoryTamper: true });
    await assert.rejects(tamperedDuringDecode.promise,
      { code: 'PDF_FIGURE_PANEL_PAGE_UNVERIFIED' },
      'marker/map mutation during image decode must fail before crop/provider dispatch');
  });

test('router sends both artwork pages in manifest order to v3 inventory with caption kept separate',
  async () => {
    const fixture = await createContentFixture();
    const providerRequests = [];
    const router = createBackgroundRouter({
      storageArea: createMemoryStorage(),
      sessionStorageArea: createMemoryStorage(),
      runtimeExtensionId: 'extension-id', sleepImpl: async () => {},
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const content = body.messages[1].content;
        const input = JSON.parse(content.find(part => part.type === 'text').text);
        providerRequests.push({ input, content });
        return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
          panel_marker_inventory: {
            figure_id: input.figure_identity.figure_id,
            visual_evidence_set_digest: input.provenance.visual_evidence_set_digest,
            semantic_context_digest: input.provenance.semantic_context_digest,
            inventory_complete: true,
            markers: [
              { label: 'A', clarity: 'clear', page_number: 5 },
              { label: 'M', clarity: 'clear', page_number: 6 }
            ]
          }
        }) } }] });
      }
    });
    await router.handle({ type: 'LLM_SAVE_PROVIDER', providerId: 'openai-compatible',
      config: { apiKey: 'fixture-key', model: 'vision-model',
        baseUrl: 'https://compatible.example/v1', supportsVision: true } });
    await router.handle({ type: 'LLM_UPDATE_PREFERENCES', preferences: {
      mode: 'llm', providerId: 'openai-compatible', consentGranted: true
    } });
    const routerFigure = {
      figureId: fixture.figure.figureId, figureLabel: fixture.figure.figureLabel,
      panelHints: fixture.figure.panelHints,
      images: fixture.analysisImages.map(image => ({
        dataUrl: image.dataUrl, mediaType: image.mediaType
      })),
      pdfFigureContext: fixture.visionEnvelope
    };
    const owner = {
      trustedExtensionSender: true, senderExtensionId: 'extension-id',
      senderTabId: 205, senderFrameId: 0,
      senderDocumentId: '85858585-8585-4585-8585-858585858585',
      senderUrl: 'chrome-extension://extension-id/pdf-reader.html',
      runtimeBaseUrl: 'chrome-extension://extension-id/',
      verifyPdfFigureContext: fixture.verifyCurrent,
      onProgress(event) {
        if (event.phase === 'figure_inventory_ready') {
          const error = new Error('STOP_AFTER_AUDITED_INVENTORY');
          error.code = 'STOP_AFTER_AUDITED_INVENTORY';
          throw error;
        }
      },
      async onFigureCheckpoint() { return { success: true, savedPanelCount: 0 }; }
    };
    const result = await router.handle(figureMessage(routerFigure), owner);
    assert.equal(result.success, false, 'the harness stops after the audited inventory stage');
    assert.equal(providerRequests.length, 1, JSON.stringify(result));
    const request = providerRequests[0];
    assert.equal(request.input.contract_version, 'pdf-figure-panel-inventory-v3');
    assert.deepEqual(request.input.figure_identity.caption_page_numbers, [6]);
    assert.deepEqual(request.input.figure_identity.artwork_page_numbers, [5, 6]);
    assert.equal(request.input.figure_identity.caption_anchor, fixture.figure.caption);
    assert.deepEqual(request.input.provenance.image_manifest.map(item => item.page_number),
      [5, 6]);
    assert.deepEqual(request.input.provenance.image_manifest.map(item =>
      item.image_content_hash), fixture.visionEnvelope.visualEvidenceSet.assets.map(asset =>
      asset.imageContentHash));
    const imageParts = request.content.filter(part => part.type === 'image_url');
    assert.equal(imageParts.length, 2);
    assert.deepEqual(imageParts.map(part => part.image_url.url),
      fixture.analysisImages.map(image => image.dataUrl));
    assert.doesNotMatch(JSON.stringify(request.input), /data:image/iu,
      'caption/manifest JSON stays separate from provider image parts');
  });
