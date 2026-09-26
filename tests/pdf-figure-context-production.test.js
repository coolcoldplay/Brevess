const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

require('../core/sentence-boundary.js');
require('../core/pdf-figure-context.js');
const {
  buildPdfSemanticIndex
} = require('../core/pdf-semantic-index.js');
const {
  createPdfSemanticCompatibilityAdapter
} = require('../core/pdf-semantic-compat.js');
const {
  createPdfFigureContextProductionAdapter,
  canMigrateCompletedPdfFigureResult
} = require('../core/pdf-figure-context-production.js');
const { createCanonicalPdfPageRecord } = require('../core/pdf-canonical-page.js');
const { createNativePdfArticleStructure } = require('../core/pdf-native-document.js');
const { extractNativePdfFigures } = require('../core/pdf-native-figures.js');
const { orderPdfTextContentForReading } = require('../core/pdf-text-projection.js');
const { validatePdfFigureRequest } = require('../core/pdf-figure-request.js');

const HASH = 'a'.repeat(64);

function makeFixture(options = {}) {
  const pages = options.pages || [{
    pageNumber: 1,
    text: 'Figure ２. Perfusion was quantified.\n\nAs shown in Figure 2, co-\nlocalization increased by'
  }, {
    pageNumber: 2,
    text: ' 20% (P = 0.01).'
  }];
  const revision = options.revision || 7;
  const generation = options.generation || 13;
  const index = buildPdfSemanticIndex({ documentHash: HASH, revision, pages });
  const structure = Object.freeze({
    version: '1.0.0-pdf-native',
    adapterId: 'pdf-native',
    documentId: `sha256:${HASH}`,
    documentHash: HASH,
    revision: 1,
    paragraphs: Object.freeze(pages.map((page, order) => Object.freeze({
      paragraphId: `pdf-page-${page.pageNumber}`,
      sourceKey: `pdf-page-${page.pageNumber}`,
      pageNumber: page.pageNumber,
      order,
      text: page.text,
      displayText: page.text
    }))),
    nodes: Object.freeze([]),
    pages: Object.freeze(pages.map(page => Object.freeze({ pageNumber: page.pageNumber })))
  });
  const nativeDocument = Object.freeze({
    structure,
    documentGeneration: generation,
    pageCount: pages.length
  });
  const semanticDocument = Object.freeze({
    schemaVersion: 1,
    documentId: `sha256:${HASH}`,
    adapterId: 'pdf-native',
    documentHash: HASH,
    documentGeneration: generation,
    revision,
    pageCount: pages.length,
    index
  });
  let currentSemanticDocument = semanticDocument;
  let currentNativeDocument = nativeDocument;
  const compatibility = createPdfSemanticCompatibilityAdapter({
    semanticDocument,
    nativeDocument,
    getCurrentSemanticDocument: () => currentSemanticDocument,
    getCurrentNativeDocument: () => currentNativeDocument
  });
  const figure = Object.freeze({
    figureId: 'figure-2',
    figureLabel: 'Figure 2',
    caption: 'Figure 2. Perfusion was quantified.',
    pageNumber: 1,
    pageNumbers: Object.freeze([1, 2]),
    sourceFingerprint: HASH
  });
  const inventory = Object.freeze([figure]);
  let currentCompatibility = compatibility;
  let currentInventory = inventory;

  function production(overrides = {}) {
    const capturedSemanticDocument = overrides.semanticDocument || semanticDocument;
    const capturedNativeDocument = overrides.nativeDocument || nativeDocument;
    const capturedCompatibility = overrides.compatibility || compatibility;
    const capturedInventory = overrides.figureInventory || inventory;
    return createPdfFigureContextProductionAdapter({
      semanticDocument: capturedSemanticDocument,
      compatibility: capturedCompatibility,
      nativeDocument: capturedNativeDocument,
      figureInventory: capturedInventory,
      getCurrentSemanticDocument: () => overrides.getCurrentSemanticDocument
        ? overrides.getCurrentSemanticDocument()
        : currentSemanticDocument,
      getCurrentCompatibility: () => overrides.getCurrentCompatibility
        ? overrides.getCurrentCompatibility()
        : currentCompatibility,
      getCurrentNativeDocument: () => overrides.getCurrentNativeDocument
        ? overrides.getCurrentNativeDocument()
        : currentNativeDocument,
      getCurrentFigureInventory: () => overrides.getCurrentFigureInventory
        ? overrides.getCurrentFigureInventory()
        : currentInventory
    });
  }

  return {
    pages,
    index,
    nativeDocument,
    semanticDocument,
    compatibility,
    figure,
    inventory,
    production,
    setCurrentSemanticDocument(value) { currentSemanticDocument = value; },
    setCurrentCompatibility(value) { currentCompatibility = value; },
    setCurrentNativeDocument(value) { currentNativeDocument = value; },
    setCurrentInventory(value) { currentInventory = value; }
  };
}

function rawPageByNumber(fixture) {
  return new Map(fixture.index.mappings.map(page => [page.pageNumber, page.rawText]));
}

test('adapts real P2 cross-page and NFKC sentences through the production resolver', async () => {
  const fixture = makeFixture();
  const figure = Object.freeze({ ...fixture.figure,
    captionPageNumbers: Object.freeze([1, 2]),
    artworkPageNumbers: Object.freeze([1]),
    artworkPageEvidence: 'caption-anchor-page',
    artworkCoverage: 'complete' });
  const inventory = Object.freeze([figure]);
  const result = await fixture.production({ figureInventory: inventory,
    getCurrentFigureInventory: () => inventory }).selectFigureContext({
    figureId: fixture.figure.figureId,
    route: 'text-only'
  });

  assert.equal(result.context.binding.valid, true);
  assert.ok(result.context.captionEvidence.length > 0);
  assert.ok(result.context.bodyEvidence.length > 0);
  assert.equal(result.context.capabilities.route, 'text-only');
  assert.equal(result.context.capabilities.canSendImageToModel, false);
  assert.deepEqual(result.visualCoverage, {
    captionPageNumbers: [1, 2],
    artworkPageNumbers: [1],
    artworkPageEvidence: 'caption-anchor-page',
    artworkCoverage: 'partial'
  });
  assert.deepEqual(result.target.pageNumbers, [1, 2],
    'text evidence remains bound to all caption pages');
  assert.match(result.semanticContextDigest, /^[a-f0-9]{64}$/u);

  const pageText = rawPageByNumber(fixture);
  const fragments = result.records.flatMap(record => record.semanticSentences)
    .flatMap(sentence => sentence.sourceFragments);
  assert.ok(fragments.some(fragment => fragment.pageNumber === 1));
  assert.ok(fragments.some(fragment => fragment.pageNumber === 2));
  for (const fragment of fragments) {
    assert.equal(pageText.get(fragment.pageNumber).slice(fragment.start, fragment.end),
      fragment.quote);
  }
  const crossPage = result.records.flatMap(record => record.semanticSentences)
    .find(sentence => sentence.normalizedText.includes('colocalization'));
  assert.ok(crossPage);
  assert.deepEqual([...new Set(crossPage.sourceFragments.map(item => item.pageNumber))], [1, 2]);
  const nfkcCaption = result.records.find(record => record.recordType === 'figure-caption');
  assert.ok(nfkcCaption.semanticSentences.some(sentence =>
    sentence.sourceFragments.some(fragment => fragment.quote.includes('２'))));
  const dehyphenated = result.context.bodyEvidence.find(item => item.text.includes('colocalization'));
  assert.equal(dehyphenated.location.locatorStatus, 'resolved');
  assert.equal(dehyphenated.location.locatorPrecision, 'discontinuous');
  assert.equal(dehyphenated.location.sourceStart, null);
  assert.equal(dehyphenated.location.pageStart, null);
  assert.deepEqual(dehyphenated.location.locatorIssues, []);
  assert.ok(result.context.captionEvidence.some(item =>
    item.location.locatorStatus === 'resolved' &&
    item.location.locatorPrecision === 'normalized-equivalent'));
  assert.ok(!result.context.coverage.omissions.includes('SOURCE_FRAGMENT_QUOTE_MISMATCH'));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.records), true);
  assert.equal(Object.isFrozen(result.records[0].semanticSentences[0].sourceFragments[0]), true);
  assert.doesNotMatch(JSON.stringify(result), /positionRuns|data:image|"rawText"/u);
});

test('passes an ordered multi-page artwork set without changing caption-page semantic scope', async () => {
  const fixture = makeFixture();
  const figure = Object.freeze({ ...fixture.figure,
    captionPageNumbers: Object.freeze([1, 2]),
    artworkPageNumbers: Object.freeze([1, 2]),
    artworkPageEvidence: 'manifest', artworkCoverage: 'complete' });
  const inventory = Object.freeze([figure]);
  const binding = { documentHash: HASH, documentGeneration: 13, semanticRevision: 7 };
  const visualEvidenceSet = {
    version: 'pdf-figure-visual-evidence-set-v1', figureId: 'figure-2', binding,
    requiredArtworkPageNumbers: [1, 2], coverageComplete: true,
    assets: [
      { assetId: 'pdf-figure-page-1', pageNumber: 1,
        imageContentHash: '1'.repeat(64), sourceType: 'page-region' },
      { assetId: 'pdf-figure-page-2', pageNumber: 2,
        imageContentHash: '2'.repeat(64), sourceType: 'page-region' }
    ],
    setDigest: '3'.repeat(64)
  };
  const result = await fixture.production({ figureInventory: inventory,
    getCurrentFigureInventory: () => inventory }).selectFigureContext({
    figureId: 'figure-2', route: 'vision', visualEvidenceSet
  });
  assert.deepEqual(result.target.pageNumbers, [1, 2]);
  assert.deepEqual(result.visualCoverage.artworkPageNumbers, [1, 2]);
  assert.equal(result.context.capabilities.canSendImageToModel, true);
  assert.deepEqual(result.context.imageInputs.map(item => item.pageNumber), [1, 2]);
  assert.equal(result.context.visualEvidenceSet.setDigest, '3'.repeat(64));
});

test('never promotes a selector-truncated raw fragment list to verified production evidence', async () => {
  const fixture = makeFixture({ pages: [{ pageNumber: 1,
    text: 'Figure 2. Perfusion was quantified.\n\nFigure 2 shows ' +
      'co-\nlocalization '.repeat(28) + 'without change.' }] });
  const figure = { ...fixture.figure, pageNumbers: [1] };
  const inventory = [figure];
  await assert.rejects(fixture.production({ figureInventory: inventory,
    getCurrentFigureInventory: () => inventory }).selectFigureContext({ figureId: 'figure-2' }),
  { code: 'PDF_FIGURE_EVIDENCE_UNVERIFIED' });
});

test('rejects an explicitly incomplete native caption before selecting partial evidence', async () => {
  const fixture = makeFixture();
  for (const change of [{ captionComplete: false },
    { reviewReasons: ['missing-caption-continuation'] },
    { reviewReasons: ['caption-truncated'] }]) {
    const inventory = [{ ...fixture.figure, ...change }];
    await assert.rejects(fixture.production({ figureInventory: inventory,
      getCurrentFigureInventory: () => inventory }).selectFigureContext({ figureId: 'figure-2' }),
    { code: 'PDF_FIGURE_CAPTION_INCOMPLETE' });
  }
  const inventory = [{ ...fixture.figure, captionComplete: true,
    reviewReasons: ['cross-page-caption'] }];
  const result = await fixture.production({ figureInventory: inventory,
    getCurrentFigureInventory: () => inventory }).selectFigureContext({ figureId: 'figure-2' });
  assert.ok(result.context.captionEvidence.length);
});

test('uses producer boundaries rather than quote search when normalized sentences repeat', async () => {
  const fixture = makeFixture({
    pages: [{
      pageNumber: 1,
      text: 'Figure 2. Stable caption.\n\nFigure 2 shows no change. Figure 2 shows no change.'
    }]
  });
  const figure = Object.freeze({
    ...fixture.figure,
    caption: 'Figure 2. Stable caption.',
    pageNumbers: Object.freeze([1])
  });
  const figureInventory = Object.freeze([figure]);
  const adapter = fixture.production({ figureInventory,
    getCurrentFigureInventory: () => figureInventory });
  const result = await adapter.selectFigureContext({ figureId: 'figure-2' });
  const repeats = result.records.flatMap(record => record.semanticSentences)
    .filter(sentence => sentence.normalizedText === 'Figure 2 shows no change.');
  assert.equal(repeats.length, 2);
  assert.notEqual(repeats[0].sentenceId, repeats[1].sentenceId);
  assert.notEqual(repeats[0].sourceFragments[0].start, repeats[1].sourceFragments[0].start);
});

test('rejects a tampered P2 sentence range even when the real resolver still resolves the quote', async () => {
  const fixture = makeFixture();
  const tampered = structuredClone(fixture.semanticDocument);
  const bodySentence = tampered.index.sentences.find(sentence =>
    sentence.normalizedText.includes('colocalization'));
  bodySentence.ranges[0].start += 1;
  const adapter = fixture.production({ semanticDocument: tampered,
    getCurrentSemanticDocument: () => tampered });
  await assert.rejects(
    adapter.selectFigureContext({ figureId: 'figure-2' }),
    error => error?.code === 'PDF_FIGURE_SEMANTIC_SENTENCE_TAMPERED'
  );
});

test('rejects document hash, Figure source fingerprint, and page-domain conflicts', async () => {
  const fixture = makeFixture();
  const wrongSource = Object.freeze([{ ...fixture.figure, sourceFingerprint: 'b'.repeat(64) }]);
  await assert.rejects(
    fixture.production({ figureInventory: wrongSource,
      getCurrentFigureInventory: () => wrongSource })
      .selectFigureContext({ figureId: 'figure-2' }),
    error => error?.code === 'PDF_FIGURE_SOURCE_BINDING_CONFLICT'
  );

  const wrongPage = Object.freeze([{ ...fixture.figure, pageNumber: 9,
    pageNumbers: Object.freeze([9]) }]);
  await assert.rejects(
    fixture.production({ figureInventory: wrongPage,
      getCurrentFigureInventory: () => wrongPage })
      .selectFigureContext({ figureId: 'figure-2' }),
    error => error?.code === 'PDF_FIGURE_PAGE_INVALID'
  );

  const wrongHashSemantic = Object.freeze({
    ...fixture.semanticDocument,
    documentHash: 'c'.repeat(64)
  });
  await assert.rejects(
    fixture.production({ semanticDocument: wrongHashSemantic,
      getCurrentSemanticDocument: () => wrongHashSemantic })
      .selectFigureContext({ figureId: 'figure-2' }),
    error => error?.code === 'PDF_FIGURE_DOCUMENT_BINDING_CONFLICT'
  );
});

test('rejects stale object ownership, generation, and semantic revision', async () => {
  const fixture = makeFixture();
  const adapter = fixture.production();
  fixture.setCurrentNativeDocument(Object.freeze({
    ...fixture.nativeDocument,
    documentGeneration: fixture.nativeDocument.documentGeneration + 1
  }));
  await assert.rejects(
    adapter.selectFigureContext({ figureId: 'figure-2' }),
    error => error?.code === 'PDF_FIGURE_CONTEXT_STALE'
  );

  const second = makeFixture();
  const revisionAdapter = second.production();
  second.setCurrentSemanticDocument(Object.freeze({
    ...second.semanticDocument,
    revision: second.semanticDocument.revision + 1
  }));
  await assert.rejects(
    revisionAdapter.selectFigureContext({ figureId: 'figure-2' }),
    error => error?.code === 'PDF_FIGURE_CONTEXT_STALE'
  );
});

test('rejects when a captured owner is cleared while context selection is in flight', async () => {
  const fixture = makeFixture();
  const adapter = fixture.production();
  const pending = adapter.selectFigureContext({
    figureId: fixture.figure.figureId,
    route: 'text-only'
  });
  fixture.setCurrentSemanticDocument(undefined);
  await assert.rejects(
    pending,
    error => error?.code === 'PDF_FIGURE_CONTEXT_STALE'
  );
});

test('omits an unrelated unresolvable paragraph while keeping verified Figure evidence', async () => {
  const fixture = makeFixture({
    pages: [{
      pageNumber: 1,
      text: 'Figure 2. Stable caption.\n\nFigure 2 shows a reproducible effect.\n\nUnrelated methods paragraph.'
    }]
  });
  const semanticDocument = structuredClone(fixture.semanticDocument);
  const unrelated = semanticDocument.index.sentences.find(sentence =>
    sentence.normalizedText === 'Unrelated methods paragraph.');
  unrelated.ranges[0].start += 1;
  const compatibility = createPdfSemanticCompatibilityAdapter({
    semanticDocument,
    nativeDocument: fixture.nativeDocument,
    getCurrentSemanticDocument: () => semanticDocument,
    getCurrentNativeDocument: () => fixture.nativeDocument
  });
  const figure = Object.freeze({
    ...fixture.figure,
    caption: 'Figure 2. Stable caption.',
    pageNumbers: Object.freeze([1])
  });
  const inventory = Object.freeze([figure]);
  const adapter = createPdfFigureContextProductionAdapter({
    semanticDocument,
    compatibility,
    nativeDocument: fixture.nativeDocument,
    figureInventory: inventory,
    getCurrentSemanticDocument: () => semanticDocument,
    getCurrentCompatibility: () => compatibility,
    getCurrentNativeDocument: () => fixture.nativeDocument,
    getCurrentFigureInventory: () => inventory
  });

  const result = await adapter.selectFigureContext({ figureId: figure.figureId });
  assert.ok(result.context.captionEvidence.length > 0);
  assert.ok(result.context.bodyEvidence.length > 0);
  assert.equal(result.omissions.length, 1);
  assert.equal(result.omissions[0].paragraphId, unrelated.paragraphId);
  assert.equal(result.omissions[0].code, 'PDF_FIGURE_SEMANTIC_SENTENCE_TAMPERED');
});

test('binds a caption split across consecutive semantic paragraphs', async () => {
  const fixture = makeFixture({
    pages: [{
      pageNumber: 1,
      text: 'Figure 2. Stable caption begins.\n\nIt continues in the next paragraph.\n\nAs shown in Figure 2, perfusion increased.'
    }]
  });
  const figure = Object.freeze({
    ...fixture.figure,
    caption: 'Figure 2. Stable caption begins. It continues in the next paragraph.',
    pageNumbers: Object.freeze([1])
  });
  const inventory = Object.freeze([figure]);
  const result = await fixture.production({
    figureInventory: inventory,
    getCurrentFigureInventory: () => inventory
  }).selectFigureContext({ figureId: figure.figureId });

  assert.ok(result.context.captionEvidence.length >= 2);
  assert.ok(result.records.find(record => record.recordType === 'figure-caption')
    .paragraphIds.length >= 2);
  assert.ok(result.context.bodyEvidence.some(item =>
    item.text.includes('perfusion increased')));
  assert.deepEqual(
    [...new Set(result.context.captionEvidence.flatMap(item => item.location.pageNumbers))],
    [1]
  );
});

test('keeps adjacent body sentences when caption and body share one paragraph', async () => {
  const fixture = makeFixture({
    pages: [{
      pageNumber: 1,
      text: 'Prior analysis refers to Figure 2. Figure 2. Stable caption. A later result confirms Figure 2.'
    }]
  });
  const figure = Object.freeze({
    ...fixture.figure,
    caption: 'Figure 2. Stable caption.',
    pageNumbers: Object.freeze([1])
  });
  const inventory = Object.freeze([figure]);
  const result = await fixture.production({
    figureInventory: inventory,
    getCurrentFigureInventory: () => inventory
  }).selectFigureContext({ figureId: figure.figureId });

  assert.equal(result.context.captionEvidence.map(item => item.text).join(' '),
    'Figure 2. Stable caption.');
  assert.ok(result.context.bodyEvidence.some(item =>
    item.text.includes('Prior analysis') || item.text.includes('later result')));
});

test('caption punctuation whitespace maps to full original canonical ranges', async () => {
  const text = 'Figure 2. ( a ) Perfusion changed; p < 0.01.\n\nAs shown in Figure 2, the control did not change.';
  const fixture = makeFixture({ pages: [{ pageNumber: 1, text }] });
  const inventory = Object.freeze([Object.freeze({ ...fixture.figure,
    caption: 'Figure 2. (a) Perfusion changed; p < 0.01.', pageNumbers: [1] })]);
  const result = await fixture.production({ figureInventory: inventory,
    getCurrentFigureInventory: () => inventory }).selectFigureContext({ figureId: 'figure-2' });
  assert.equal(result.context.captionEvidence.map(item => item.text).join(' '),
    'Figure 2. ( a ) Perfusion changed; p < 0.01.');
  assert.equal(result.omissions.some(item => item.code === 'PDF_FIGURE_CAPTION_LAYOUT_FRAGMENTED'), false);
  for (const evidence of result.context.captionEvidence) {
    const fragments = evidence.location.sourceFragments;
    assert.ok(fragments.length);
    for (const fragment of fragments) {
      assert.ok(evidence.text.includes(text.slice(fragment.start, fragment.end)));
    }
  }
});

test('fragmented caption fallback never promotes supplement or extended-data children', async () => {
  const fixture = makeFixture({
    pages: [{
      pageNumber: 1,
      text: 'Figure 2—figure supplement 1. Supplemental result only.\n\nExtended Data Figure 2. Extended result only.\n\nAs shown in Figure 2, the main body changes.'
    }]
  });
  const figure = Object.freeze({
    ...fixture.figure,
    caption: 'Figure 2. Main caption is unavailable.',
    pageNumbers: Object.freeze([1])
  });
  const inventory = Object.freeze([figure]);
  await assert.rejects(
    fixture.production({
      figureInventory: inventory,
      getCurrentFigureInventory: () => inventory
    }).selectFigureContext({ figureId: figure.figureId }),
    error => error?.code === 'PDF_FIGURE_CAPTION_BINDING_UNAVAILABLE'
  );
});

test('requires caption and body evidence by default', async () => {
  const fixture = makeFixture({
    pages: [{ pageNumber: 1, text: 'Figure 2. Caption without a body reference.' }]
  });
  const figure = Object.freeze({
    ...fixture.figure,
    caption: 'Figure 2. Caption without a body reference.',
    pageNumbers: Object.freeze([1])
  });
  const figureInventory = Object.freeze([figure]);
  await assert.rejects(
    fixture.production({ figureInventory,
      getCurrentFigureInventory: () => figureInventory })
      .selectFigureContext({ figureId: 'figure-2' }),
    error => error?.code === 'PDF_FIGURE_CONTEXT_INCOMPLETE'
  );
});

test('allows migration only for completed results with all immutable digests reverified', () => {
  const previous = Object.freeze({
    state: 'completed',
    documentHash: HASH,
    semanticContextDigest: 'd'.repeat(64),
    imageContentHash: 'e'.repeat(64)
  });
  assert.equal(canMigrateCompletedPdfFigureResult(previous, {
    ...previous,
    documentGeneration: 22,
    verified: true
  }), true);
  assert.equal(canMigrateCompletedPdfFigureResult({ ...previous, state: 'pending' }, {
    ...previous, verified: true
  }), false);
  assert.equal(canMigrateCompletedPdfFigureResult(previous, {
    ...previous, semanticContextDigest: 'f'.repeat(64), verified: true
  }), false);
  assert.equal(canMigrateCompletedPdfFigureResult(previous, {
    ...previous, imageContentHash: '0'.repeat(64), verified: true
  }), false);
  assert.equal(canMigrateCompletedPdfFigureResult(previous, {
    ...previous, documentHash: '0'.repeat(64), verified: true
  }), false);
  assert.equal(canMigrateCompletedPdfFigureResult(previous, {
    ...previous, verified: false
  }), false);
  const multi = Object.freeze({
    state: 'completed', documentHash: HASH,
    semanticContextDigest: 'd'.repeat(64),
    visualEvidenceSetDigest: '9'.repeat(64)
  });
  assert.equal(canMigrateCompletedPdfFigureResult(multi, {
    ...multi, documentGeneration: 23, verified: true
  }), true);
  assert.equal(canMigrateCompletedPdfFigureResult(multi, {
    ...multi, visualEvidenceSetDigest: '8'.repeat(64), verified: true
  }), false);
});

const PUBLIC_PDF = path.join(__dirname, '..', 'tmp', 'public-pdf-acceptance',
  'elife-83176-v2.pdf');
const PUBLIC_PDF_SHA256 = '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1';

test('real eLife PDF produces verified caption and raw-located body evidence', {
  skip: !fs.existsSync(PUBLIC_PDF) && `public fixture is absent: ${PUBLIC_PDF}`
}, async () => {
  const bytes = fs.readFileSync(PUBLIC_PDF);
  const documentHash = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(documentHash, PUBLIC_PDF_SHA256);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const canonicalPages = [];
  const figurePages = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = orderPdfTextContentForReading(await page.getTextContent({
        includeMarkedContent: true,
        disableNormalization: true
      }), page);
      canonicalPages.push(createCanonicalPdfPageRecord({
        documentHash,
        documentGeneration: 1,
        revision: 1,
        pageNumber,
        textContentOrder: 'reading-order',
        readingOrderContract: 'pdf-reading-order-v1',
        page: { view: [...page.view], rotate: page.rotate },
        viewport: {
          width: viewport.width,
          height: viewport.height,
          rotation: viewport.rotation,
          transform: [...viewport.transform],
          scale: 1
        },
        textContent
      }));
      figurePages.push({ pageNumber, textContent });
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }

  const index = buildPdfSemanticIndex({ documentHash, revision: 1, pages: canonicalPages });
  const structure = Object.freeze(createNativePdfArticleStructure({
    title: 'eLife 83176 v2',
    documentIdentity: documentHash,
    documentHash,
    pageCount: canonicalPages.length,
    pages: canonicalPages.map(page => ({
      pageNumber: page.pageNumber,
      text: page.text,
      textStatus: page.text ? 'full' : 'empty'
    }))
  }));
  const nativeDocument = Object.freeze({
    structure,
    documentGeneration: 1,
    pageCount: canonicalPages.length
  });
  const semanticDocument = Object.freeze({
    schemaVersion: 1,
    documentId: `sha256:${documentHash}`,
    adapterId: 'pdf-native',
    documentHash,
    documentGeneration: 1,
    revision: 1,
    pageCount: canonicalPages.length,
    index
  });
  const compatibility = createPdfSemanticCompatibilityAdapter({
    semanticDocument,
    nativeDocument,
    getCurrentSemanticDocument: () => semanticDocument,
    getCurrentNativeDocument: () => nativeDocument
  });
  const inventory = Object.freeze(extractNativePdfFigures({
    pages: figurePages,
    documentHash
  }));
  assert.deepEqual(inventory.map(figure => figure.figureId),
    ['figure-1', 'figure-2', 'figure-3', 'figure-4'],
    'the actual reader reading-order path must retain all four native captions');
  const adapter = createPdfFigureContextProductionAdapter({
    semanticDocument,
    compatibility,
    nativeDocument,
    figureInventory: inventory,
    getCurrentSemanticDocument: () => semanticDocument,
    getCurrentCompatibility: () => compatibility,
    getCurrentNativeDocument: () => nativeDocument,
    getCurrentFigureInventory: () => inventory
  });

  const result = await adapter.selectFigureContext({
    figureId: 'figure-1',
    route: 'text-only'
  });
  assert.equal(result.context.binding.valid, true);
  for (const figure of inventory) {
    const selected = await adapter.selectFigureContext({ figureId: figure.figureId, route: 'text-only' });
    const captionText = selected.context.captionEvidence.map(item => item.text).join(' ');
    assert.equal(captionText.replace(/\s/gu, ''), figure.caption.replace(/\s/gu, ''),
      `${figure.figureId}: retain the complete caption, including all Panel labels and qualifications`);
    assert.ok(selected.context.bodyEvidence.length, `${figure.figureId}: verified body evidence`);
    const envelope = { version: 'pdf-figure-production-envelope-v1', verified: true,
      route: 'text-only', binding: selected.binding, figure: selected.target,
      textualEvidence: selected.context.textualEvidence,
      semanticContextDigest: selected.semanticContextDigest, assetProof: null, images: [] };
    const admitted = await validatePdfFigureRequest({ ...figure, images: [], pdfFigureContext: envelope }, {
      verifyCurrent: async () => ({ success: true, binding: selected.binding,
        semanticContextDigest: selected.semanticContextDigest, assetProof: null })
    });
    assert.ok(admitted.figure.contextParagraphs.length,
      `${figure.figureId}: actual native semantic evidence must pass the background request contract`);
  }
  assert.ok(result.context.captionEvidence.length > 0);
  assert.ok(result.context.bodyEvidence.length > 0);
  const bodyFragments = result.context.bodyEvidence.flatMap(item =>
    item.location.sourceFragments);
  assert.ok(bodyFragments.length > 0);
  const rawPages = new Map(index.mappings.map(mapping =>
    [mapping.pageNumber, mapping.rawText]));
  const verifiedSentences = new Map(result.records.flatMap(record =>
    record.semanticSentences.map(sentence => [sentence.sentenceId, sentence])));
  for (const evidence of result.context.bodyEvidence) {
    const verified = verifiedSentences.get(evidence.location.sentenceId);
    assert.ok(verified, 'body evidence must retain its verified producer sentence');
    assert.deepEqual(evidence.location.sourceFragments,
      verified.sourceFragments.map(({ pageNumber, start, end }) =>
        ({ pageNumber, start, end })));
    for (const fragment of verified.sourceFragments) {
      assert.equal(rawPages.get(fragment.pageNumber).slice(fragment.start, fragment.end),
        fragment.quote);
    }
  }
  assert.doesNotMatch(JSON.stringify(result), /positionRuns|data:image|"rawText"/u);
});
