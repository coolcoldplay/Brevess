const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const canonicalPage = require('../core/pdf-canonical-page.js');
const nativeDocument = require('../core/pdf-native-document.js');
const { buildPdfSemanticIndex } = require('../core/pdf-semantic-index.js');

const documentHash = 'a'.repeat(64);
const viewportFor = rotation => ({
  0: { width: 600, height: 800, rotation: 0, transform: [1, 0, 0, -1, 0, 800] },
  90: { width: 800, height: 600, rotation: 90, transform: [0, 1, 1, 0, 0, 0] },
  180: { width: 600, height: 800, rotation: 180, transform: [-1, 0, 0, 1, 600, 0] },
  270: { width: 800, height: 600, rotation: 270, transform: [0, -1, -1, 0, 800, 600] }
}[rotation]);

function item(str, x, y, options = {}) {
  return {
    str,
    width: options.width ?? Math.max(1, str.length * 6),
    height: options.height ?? 10,
    transform: options.transform || [10, 0, 0, 10, x, y],
    fontName: options.fontName || 'Body',
    hasEOL: options.hasEOL === true
  };
}

function recordInput(items, options = {}) {
  const rotation = options.rotation ?? 0;
  return {
    documentHash,
    documentGeneration: options.documentGeneration ?? 3,
    revision: options.revision ?? 7,
    pageNumber: options.pageNumber ?? 2,
    page: { view: [0, 0, 600, 800], rotate: rotation },
    viewport: viewportFor(rotation),
    textContent: { items, styles: {} }
  };
}

test('canonical PDF page module exposes the B0 record factory', () => {
  let moduleApi = {};
  try {
    moduleApi = require('../core/pdf-canonical-page.js');
  } catch { /* The RED phase intentionally starts before the module exists. */ }
  assert.equal(typeof moduleApi.createCanonicalPdfPageRecord, 'function');
});

test('canonical record keeps NFKC text and every span at exact UTF-16 page offsets', () => {
  const items = [
    item('A🧪', 50, 730),
    item('ﬃ', 80, 730),
    item('inter-', 100, 730, { hasEOL: true }),
    item('nal', 50, 710)
  ];
  const record = canonicalPage.createCanonicalPdfPageRecord(recordInput(items));

  assert.equal(record.text, 'A🧪 ffi inter-\nnal');
  assert.deepEqual(record.spans.map(span => span.text), ['A🧪', 'ffi', 'inter-', 'nal']);
  assert.equal(record.spans.every(span =>
    span.start === span.rawStart && span.end === span.rawEnd &&
    record.text.slice(span.rawStart, span.rawEnd) === span.text), true);
  assert.equal(record.spans.every((span, index) => !index ||
    record.spans[index - 1].rawEnd <= span.rawStart), true);
  assert.deepEqual(record.binding, { documentHash, documentGeneration: 3, revision: 7 });
  assert.equal(record.legacyParagraphId, 'pdf-page-2');
  const rebound = canonicalPage.createCanonicalPdfPageRecord(recordInput(items, { revision: 8 }));
  assert.equal(record.contentHash, rebound.contentHash,
    'content hash is page-content stable across binding revisions');
  assert.notEqual(record.pageHash, rebound.pageHash,
    'page hash binds content to document generation and revision');
  assert.equal(record.geometryCoordinateSpace, 'page-viewport-css-px');
  assert.equal(record.geometryScale, 1);
  assert.equal(record.spans.every(span => span.geometryPrecision === 'exact-native-item'), true);
  assert.deepEqual(record.coverage, {
    sourceItemCount: 4, textItemCount: 4, spanCount: 4,
    positionedSpanCount: 4, fallbackSpanCount: 0, droppedItemCount: 0,
    positionedCharacterCount: 15, fallbackCharacterCount: 0,
    positionedPercent: 100, textStatus: 'full'
  });
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.spans[0]), true);
});

test('mixed valid, zero-width, control, invalid-transform and empty items never fabricate geometry', () => {
  const record = canonicalPage.createCanonicalPdfPageRecord(recordInput([
    item('Valid', 30, 700, { width: 32 }),
    item('Zero', 30, 680, { width: 0 }),
    item('A\u0001B', 30, 660, { width: 20 }),
    item('Bad', 30, 640, { transform: [10, 0, 0, 10, Number.NaN, 640] }),
    item('\u0002', 30, 620)
  ]));

  assert.equal(record.text, 'Valid Zero AB Bad');
  assert.deepEqual(record.spans.map(span => [span.text, span.geometryStatus,
    span.fallbackReason || '']), [
    ['Valid', 'positioned', ''],
    ['Zero', 'fallback', 'zero-width'],
    ['AB', 'fallback', 'control-character'],
    ['Bad', 'fallback', 'invalid-transform']
  ]);
  assert.equal(record.spans[0].rect.right > record.spans[0].rect.left, true);
  assert.equal(record.spans.slice(1).every(span => !('rect' in span) &&
    !('quadPoints' in span)), true);
  assert.equal(record.spans.slice(1).every(span => span.geometryPrecision === 'fallback'), true);
  assert.deepEqual(record.coverage, {
    sourceItemCount: 5, textItemCount: 4, spanCount: 4,
    positionedSpanCount: 1, fallbackSpanCount: 3, droppedItemCount: 1,
    positionedCharacterCount: 5, fallbackCharacterCount: 9,
    positionedPercent: 25, textStatus: 'full'
  });
});

test('viewport transforms produce positive in-page rectangles at every supported page rotation', () => {
  const expectedRects = {
    0: { left: 100, top: 90, right: 130, bottom: 100 },
    90: { left: 700, top: 100, right: 710, bottom: 130 },
    180: { left: 470, top: 700, right: 500, bottom: 710 },
    270: { left: 90, top: 470, right: 100, bottom: 500 }
  };
  for (const rotation of [0, 90, 180, 270]) {
    const record = canonicalPage.createCanonicalPdfPageRecord(recordInput([
      item(`R${rotation}`, 100, 700, { width: 30, height: 10 })
    ], { rotation }));
    const rect = record.spans[0].rect;
    assert.equal(record.rotation, rotation);
    assert.equal(record.pageWidth, viewportFor(rotation).width);
    assert.equal(record.pageHeight, viewportFor(rotation).height);
    assert.deepEqual(rect, expectedRects[rotation]);
    assert.equal(rect.left >= 0 && rect.top >= 0 && rect.right <= record.pageWidth &&
      rect.bottom <= record.pageHeight && rect.right > rect.left && rect.bottom > rect.top, true);
  }
});

test('two-column source items use stable reading order without mutating PDF.js input', () => {
  const items = [
    item('Left one.', 50, 700, { width: 180, height: 12 }),
    item('Right one.', 350, 700, { width: 180, height: 12 }),
    item('Left two.', 50, 675, { width: 180, height: 12 }),
    item('Right two.', 350, 675, { width: 180, height: 12 })
  ];
  const original = items.map(entry => entry.str);
  const record = canonicalPage.createCanonicalPdfPageRecord(recordInput(items));
  assert.deepEqual(record.spans.map(span => span.text),
    ['Left one.', 'Left two.', 'Right one.', 'Right two.']);
  assert.deepEqual(record.spans.map(span => span.sourceOrder), [0, 2, 1, 3]);
  assert.deepEqual(record.spans.map(span => span.readingOrder), [0, 1, 2, 3]);
  assert.deepEqual(record.readingOrderStatus, {
    inputOrder: 'source', contract: 'pdf-reading-order-v1', reordered: true
  });
  assert.deepEqual(items.map(entry => entry.str), original);
  assert.throws(() => canonicalPage.createCanonicalPdfPageRecord({
    ...recordInput(items), textContentOrder: 'reading-order'
  }), /PDF_CANONICAL_READING_ORDER_CONTRACT/u);
  const alreadyOrdered = canonicalPage.createCanonicalPdfPageRecord({
    ...recordInput(items), textContentOrder: 'reading-order',
    readingOrderContract: 'pdf-reading-order-v1'
  });
  assert.deepEqual(alreadyOrdered.spans.map(span => span.text), original,
    'an already ordered worker payload must not be reordered a second time');
});

test('source order remains a unique original item index when the same object occurs twice', () => {
  const shared = item('Shared.', 50, 700, { width: 180, height: 12 });
  const rightOne = item('Right one.', 350, 700, { width: 180, height: 12 });
  const rightTwo = item('Right two.', 350, 675, { width: 180, height: 12 });
  const record = canonicalPage.createCanonicalPdfPageRecord(recordInput([
    shared, rightOne, shared, rightTwo
  ]));
  assert.deepEqual([...record.spans.map(span => span.sourceOrder)].sort((a, b) => a - b),
    [0, 1, 2, 3]);
  assert.equal(new Set(record.spans.map(span => span.sourceOrder)).size, 4);
});

test('semantic hashes include typography even when canonical text and geometry are unchanged', () => {
  const plain = canonicalPage.createCanonicalPdfPageRecord(recordInput([
    item('Same text.', 50, 700, { width: 90, fontName: 'Body' })
  ]));
  const bold = canonicalPage.createCanonicalPdfPageRecord(recordInput([
    item('Same text.', 50, 700, { width: 90, fontName: 'BodyBold' })
  ]));
  assert.equal(plain.text, bold.text);
  assert.deepEqual(plain.spans[0].rect, bold.spans[0].rect);
  assert.notEqual(plain.contentHash, bold.contentHash);
  assert.notEqual(plain.pageHash, bold.pageHash);
  assert.notEqual(plain.canonicalPageId, bold.canonicalPageId);
});

test('synchronous batch factory accepts structured-cloneable page payloads independently', () => {
  assert.equal(typeof canonicalPage.createCanonicalPdfPageRecordBatch, 'function');
  const result = canonicalPage.createCanonicalPdfPageRecordBatch([
    recordInput([item('One.', 50, 700)], { pageNumber: 1 }),
    recordInput([item('Two.', 50, 700)], { pageNumber: 2 })
  ]);
  assert.equal(result instanceof Promise, false);
  assert.deepEqual(result.map(record => record.pageNumber), [1, 2]);
  assert.equal(Object.isFrozen(result), true);
  assert.doesNotThrow(() => structuredClone(result));
});

test('blank pages remain explicit terminal empty records with zero coverage', () => {
  const record = canonicalPage.createCanonicalPdfPageRecord(recordInput([], { pageNumber: 6 }));
  assert.equal(record.text, '');
  assert.deepEqual(record.spans, []);
  assert.equal(record.coverage.textStatus, 'empty');
  assert.equal(record.coverage.positionedSpanCount, 0);
  assert.equal(record.coverage.fallbackSpanCount, 0);
  assert.equal(record.legacyParagraphId, 'pdf-page-6');
});

test('canonical records are directly consumable by P2-A without losing raw or geometry contracts', () => {
  const record = canonicalPage.createCanonicalPdfPageRecord(recordInput([
    item('A measured result.', 50, 700, { width: 120 })
  ], { pageNumber: 4 }));
  const index = buildPdfSemanticIndex({ documentHash, revision: 7, pages: [record] });
  assert.deepEqual(index.sentences[0].ranges,
    [{ pageNumber: 4, start: 0, end: 'A measured result.'.length }]);
  assert.equal(index.spans[0].geometry.kind, 'rect');
  assert.equal(index.spans[0].geometry.precision, 'exact-source-span');
});

test('native adapter preserves legacy page identity while retaining the canonical sidecar record', () => {
  const record = canonicalPage.createCanonicalPdfPageRecord(recordInput([
    item('Legacy page text.', 50, 700, { width: 110 })
  ], { pageNumber: 4 }));
  assert.equal(typeof nativeDocument.canonicalPdfPageToNativePage, 'function');
  const nativePage = nativeDocument.canonicalPdfPageToNativePage(record);
  assert.equal(nativePage.pageNumber, 4);
  assert.equal(nativePage.text, record.text);
  assert.equal(nativePage.paragraphId, 'pdf-page-4');
  assert.equal(nativePage.sourceIdentity, 'pdf:4');
  assert.equal(nativePage.canonicalPage, record);
  const spoofed = nativeDocument.canonicalPdfPageToNativePage({
    ...record, sourceIdentity: 'pdf:999'
  });
  assert.equal(spoofed.sourceIdentity, 'pdf:4');
  assert.throws(() => nativeDocument.canonicalPdfPageToNativePage({
    ...record,
    binding: { ...record.binding, documentHash: 'b'.repeat(64) }
  }), /INVALID_PDF_CANONICAL_PAGE/u);
  const structure = nativeDocument.createNativePdfArticleStructure({
    title: 'Paper', documentHash, documentIdentity: documentHash, pages: [nativePage]
  });
  assert.equal(structure.documentId, `sha256:${documentHash}`);
  assert.equal(structure.paragraphs[0].paragraphId, 'pdf-page-4');
});

test('canonical records reject unbound identity and unsupported page rotation', () => {
  assert.throws(() => canonicalPage.createCanonicalPdfPageRecord({
    ...recordInput([]), documentHash: ''
  }), /PDF_CANONICAL_DOCUMENT_HASH/u);
  assert.throws(() => canonicalPage.createCanonicalPdfPageRecord({
    ...recordInput([]), page: { view: [0, 0, 600, 800], rotate: 45 },
    viewport: { width: 600, height: 800, rotation: 45, transform: [1, 0, 0, -1, 0, 800] }
  }), /PDF_CANONICAL_ROTATION/u);
  assert.throws(() => canonicalPage.createCanonicalPdfPageRecord({
    ...recordInput([]), viewport: { ...viewportFor(0), scale: 2 }
  }), /PDF_CANONICAL_SCALE/u);
  assert.throws(() => canonicalPage.createCanonicalPdfPageRecord({
    ...recordInput([]),
    viewport: { ...viewportFor(90), rotation: 90, scale: 1 }
  }), /PDF_CANONICAL_ROTATION_MISMATCH/u);
  assert.throws(() => canonicalPage.createCanonicalPdfPageRecord({
    ...recordInput([]),
    viewport: { ...viewportFor(0), width: 601, rotation: 0, scale: 1 }
  }), /PDF_CANONICAL_VIEWPORT_CONTRACT/u);
  assert.throws(() => canonicalPage.createCanonicalPdfPageRecord({
    ...recordInput([]),
    viewport: { ...viewportFor(0), transform: [1, 0, 0, -1, 1, 800],
      rotation: 0, scale: 1 }
  }), /PDF_CANONICAL_VIEWPORT_CONTRACT/u);
});

test('real verifier acceptance can require independent text, geometry and clone oracles', async () => {
  const { assessCanonicalPageAcceptance } = await import(
    '../scripts/verify-pdf-canonical-pages.mjs');
  const observation = {
    sampleCount: 3, pageAudits: 30, offsetErrors: 0, overlapErrors: 0,
    boundsErrors: 0, bindingErrors: 0, adapterErrors: 0,
    positionedSpans: 100, fallbackSpans: 0,
    rotationsCovered: 4, syntheticMixedGeometryPassed: true,
    syntheticBlankPagePassed: true, stableRecords: true,
    apiCalls: 0, ocrCalls: 0, externalRequests: 0,
    absolutePathLeaks: 0, rawTextLeaks: 0, persistentCacheUsed: false
  };
  assert.equal(assessCanonicalPageAcceptance(observation,
    { requireIndependentOracle: true }).pass, false);
  Object.assign(observation, {
    independentTextAudits: 30, independentTextErrors: 0,
    independentGeometryAudits: 30, independentGeometryErrors: 0,
    structuredCloneAudits: 30, structuredCloneErrors: 0,
    exactRotationCoordinatesPassed: true
  });
  assert.equal(assessCanonicalPageAcceptance(observation,
    { requireIndependentOracle: true }).pass, true);
});

test('verifier metadata never uses a raw-text field name for oracle method descriptions', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts',
    'verify-pdf-canonical-pages.mjs'), 'utf8');
  assert.doesNotMatch(source, /independentOracle:\s*\{\s*text:/u);
});
