const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const semanticIndexApi = require('../core/pdf-semantic-index.js');
const { buildPdfSemanticIndex, pdfSemanticProvenanceKey } = semanticIndexApi;
const compatibilityApi = require('../core/pdf-semantic-compat.js');
const citationApi = require('../core/article-chat-citations.js');
const {
  createPdfSemanticCompatibilityAdapter,
  adaptPdfSemanticIndexToArticleStructure
} = compatibilityApi;

const HASH = 'd'.repeat(64);

function fixture(pages, options = {}) {
  const revision = options.revision || 7;
  const index = buildPdfSemanticIndex({ documentHash: HASH, revision, pages });
  const structure = {
    version: '1.0.0-pdf-native', adapterId: 'pdf-native',
    documentId: `sha256:${HASH}`, documentHash: HASH, revision: 1,
    paragraphs: pages.map((page, order) => ({
      paragraphId: `pdf-page-${page.pageNumber}`, sourceKey: `pdf-page-${page.pageNumber}`,
      pageNumber: page.pageNumber, order, text: page.text, displayText: page.text
    })),
    nodes: [], pages: pages.map(page => ({ pageNumber: page.pageNumber }))
  };
  const nativeDocument = { structure, documentGeneration: options.generation || 13 };
  const semanticDocument = {
    schemaVersion: 1, documentId: `sha256:${HASH}`, adapterId: 'pdf-native',
    documentHash: HASH, documentGeneration: nativeDocument.documentGeneration,
    revision, index
  };
  let currentSemanticDocument = semanticDocument;
  let currentNativeDocument = nativeDocument;
  const adapter = createPdfSemanticCompatibilityAdapter({
    semanticDocument, nativeDocument,
    getCurrentSemanticDocument: () => currentSemanticDocument,
    getCurrentNativeDocument: () => currentNativeDocument
  });
  return { index, structure, nativeDocument, semanticDocument, adapter,
    setSemantic(value) { currentSemanticDocument = value; },
    setNative(value) { currentNativeDocument = value; } };
}

function onlyParagraph(context) {
  assert.equal(context.index.paragraphs.length, 1);
  return context.index.paragraphs[0];
}

function replaceParagraphsWithProvenance(index, paragraphs) {
  const draft = { ...index, paragraphs: Object.freeze(paragraphs) };
  return Object.freeze({ ...draft, provenanceKey: pdfSemanticProvenanceKey(draft) });
}

function sectionFixture() {
  const text = ['Preamble.', '', '1 Results', 'Main.', '',
    '1.1 Validation', 'Valid.'].join('\n');
  return fixture([{ pageNumber: 1, text, spans: [
    { text: '1 Results', rect: { top: 100 }, fontSize: 18, bold: true },
    { text: '1.1 Validation', rect: { top: 200 }, fontSize: 16, bold: true }
  ] }]);
}

function replaceSemanticContentWithProvenance(index, input = {}) {
  const draft = {
    ...index,
    paragraphs: Object.freeze(input.paragraphs || index.paragraphs),
    sections: Object.freeze(input.sections || index.sections)
  };
  return Object.freeze({ ...draft, provenanceKey: pdfSemanticProvenanceKey(draft) });
}

function assertConstructionStale(base, index) {
  const semanticDocument = Object.freeze({ ...base.semanticDocument, index });
  for (const construct of [
    () => adaptPdfSemanticIndexToArticleStructure({
      semanticDocument, nativeDocument: base.nativeDocument
    }),
    () => createPdfSemanticCompatibilityAdapter({
      semanticDocument, nativeDocument: base.nativeDocument
    })
  ]) {
    assert.throws(construct, error => error?.code === 'PDF_SEMANTIC_SOURCE_STALE' &&
      error?.message === 'PDF_SEMANTIC_SOURCE_STALE');
  }
}

function replaceSinglePageRawTextWithProvenance(base, rawText) {
  const mappings = base.index.mappings.map(mapping => Object.freeze({
    ...mapping,
    rawText
  }));
  const paragraphs = base.index.paragraphs.map(paragraph => Object.freeze({
    ...paragraph,
    rawQuoteByPage: Object.freeze(paragraph.rawQuoteByPage.map(range => Object.freeze({
      ...range,
      quote: rawText.slice(range.start, range.end)
    })))
  }));
  const draft = {
    ...base.index,
    mappings: Object.freeze(mappings),
    paragraphs: Object.freeze(paragraphs)
  };
  return Object.freeze({ ...draft, provenanceKey: pdfSemanticProvenanceKey(draft) });
}

function replaceOnlyParagraphProjection(base, normalizedText, positionRuns) {
  const paragraph = Object.freeze({
    ...onlyParagraph(base),
    normalizedText,
    positionRuns: Object.freeze(positionRuns.map(run => Object.freeze(run)))
  });
  return replaceParagraphsWithProvenance(base.index, [paragraph]);
}

function publicFocusFingerprint(result) {
  const value = {
    paragraphId: result.paragraphId,
    normalizedStart: result.normalizedRange.start,
    normalizedEnd: result.normalizedRange.end,
    normalizedQuote: result.normalizedQuote,
    precision: result.precision,
    ranges: result.ranges.map(range => ({
      pageNumber: range.pageNumber,
      start: range.start,
      end: range.end,
      quote: range.quote,
      precision: range.precision
    }))
  };
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(JSON.stringify(value))) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `pdf-focus-result-v1:${hash.toString(16).padStart(16, '0')}`;
}

function invokeLegacyFocusHelper(result, target) {
  const helper = compatibilityApi.pdfSemanticResultToNativeFocusRequest;
  return typeof helper === 'function' ? helper(result, target) : null;
}

test('resolves an ordinary single-page normalized range to exact canonical raw text', () => {
  const context = fixture([{ pageNumber: 1, text: 'Alpha result.' }]);
  const paragraph = onlyParagraph(context);
  const result = context.adapter.resolvePdfSemanticRange(
    paragraph.paragraphId, 6, 12, 'result');
  assert.equal(result.status, 'resolved');
  assert.equal(result.precision, 'exact-raw');
  assert.equal(result.verified, true);
  assert.equal(result.documentId, `sha256:${HASH}`);
  assert.equal(result.adapterId, 'pdf-native');
  assert.deepEqual(result.ranges, [{ pageNumber: 1, legacyParagraphId: 'pdf-page-1',
    start: 6, end: 12, quote: 'result', precision: 'exact-raw' }]);
  assert.deepEqual(result.fallbackPageAnchors, []);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.ranges[0]), true);
  assert.doesNotThrow(() => structuredClone(result));
});

test('semantic raw text remains authoritative when the legacy native projection differs', () => {
  const base = fixture([{ pageNumber: 1, text: 'Alpha result.' }]);
  const nativeDocument = Object.freeze({
    ...base.nativeDocument,
    structure: Object.freeze({
      ...base.structure,
      paragraphs: Object.freeze([Object.freeze({
        ...base.structure.paragraphs[0],
        text: 'Legacy projection omitted or reordered source text.',
        displayText: 'Legacy projection omitted or reordered source text.'
      })])
    })
  });
  const adapter = createPdfSemanticCompatibilityAdapter({
    semanticDocument: base.semanticDocument,
    nativeDocument
  });
  const paragraph = onlyParagraph(base);
  const result = adapter.resolvePdfSemanticRange(
    paragraph.paragraphId, 6, 12, 'result');
  assert.equal(result.status, 'resolved');
  assert.equal(result.precision, 'exact-raw');
  assert.deepEqual(result.ranges, [{
    pageNumber: 1,
    legacyParagraphId: 'pdf-page-1',
    start: 6,
    end: 12,
    quote: 'result',
    precision: 'exact-raw'
  }]);
});

test('recalculated provenance cannot make tampered semantic raw text match unchanged runs', () => {
  const base = fixture([{ pageNumber: 1, text: 'Alpha result.' }]);
  const mappings = base.index.mappings.map(mapping => Object.freeze({
    ...mapping,
    rawText: `Z${mapping.rawText.slice(1)}`
  }));
  const draft = { ...base.index, mappings: Object.freeze(mappings) };
  const index = Object.freeze({
    ...draft,
    provenanceKey: pdfSemanticProvenanceKey(draft)
  });
  const semanticDocument = Object.freeze({ ...base.semanticDocument, index });
  const adapter = createPdfSemanticCompatibilityAdapter({
    semanticDocument,
    nativeDocument: base.nativeDocument
  });
  const paragraph = onlyParagraph(base);
  const result = adapter.resolvePdfSemanticRange(
    paragraph.paragraphId, 0, 5, 'Alpha');
  assert.equal(result.status, 'unresolved');
  assert.equal(result.reasonCode, 'PDF_SEMANTIC_MAPPING_UNAVAILABLE');
  assert.deepEqual(result.ranges, []);
});

test('construction rejects both reviewer raw-gap attacks after provenance is recalculated', () => {
  for (const [source, tampered] of [
    ['ab-\ncd.', 'abX\ncd.'],
    ['ab\ncd.', 'abXcd.']
  ]) {
    const base = fixture([{ pageNumber: 1, text: source }]);
    const index = replaceSinglePageRawTextWithProvenance(base, tampered);
    assertConstructionStale(base, index);
  }
});

test('non-virtual source gaps reject punctuation, controls, and noncanonical whitespace', () => {
  for (const tampered of ['abX\ncd.', 'ab.\ncd.', 'ab\u0000\ncd.', 'ab- cd.']) {
    const base = fixture([{ pageNumber: 1, text: 'ab-\ncd.' }]);
    assertConstructionStale(base,
      replaceSinglePageRawTextWithProvenance(base, tampered));
  }
  const nonLetter = fixture([{ pageNumber: 1, text: 'aa-\ncd.' }]);
  const nonLetterRaw = replaceSinglePageRawTextWithProvenance(nonLetter, 'a1-\ncd.');
  const nonLetterParagraph = Object.freeze({
    ...onlyParagraph(nonLetter),
    normalizedText: 'a1cd.',
    rawQuoteByPage: nonLetterRaw.paragraphs[0].rawQuoteByPage
  });
  assertConstructionStale(nonLetter,
    replaceParagraphsWithProvenance(nonLetterRaw, [nonLetterParagraph]));

  for (const [source, normalizedText, positionRuns] of [
    ['ab-\nCd.', 'abCd.', [
      { normalizedStart: 0, normalizedEnd: 2, pageNumber: 1,
        rawStart: 0, rawEnd: 2, kind: 'source' },
      { normalizedStart: 2, normalizedEnd: 5, pageNumber: 1,
        rawStart: 4, rawEnd: 7, kind: 'source' }
    ]]
  ]) {
    const base = fixture([{ pageNumber: 1, text: source }]);
    assertConstructionStale(base,
      replaceOnlyParagraphProjection(base, normalizedText, positionRuns));
  }
});

test('virtual spaces cannot swallow content or move onto a contiguous raw boundary', () => {
  for (const tampered of ['abXcd.', 'ab.cd.', 'ab\u0000cd.', 'ab cd.', 'ab\tcd.']) {
    const base = fixture([{ pageNumber: 1, text: 'ab\ncd.' }]);
    assertConstructionStale(base,
      replaceSinglePageRawTextWithProvenance(base, tampered));
  }

  const inserted = fixture([{ pageNumber: 1, text: 'abcd.' }]);
  assertConstructionStale(inserted, replaceOnlyParagraphProjection(inserted, 'ab cd.', [
    { normalizedStart: 0, normalizedEnd: 2, pageNumber: 1,
      rawStart: 0, rawEnd: 2, kind: 'source' },
    { normalizedStart: 2, normalizedEnd: 3, pageNumber: null,
      rawStart: null, rawEnd: null, kind: 'virtual-space' },
    { normalizedStart: 3, normalizedEnd: 6, pageNumber: 1,
      rawStart: 2, rawEnd: 5, kind: 'source' }
  ]));

  const moved = fixture([{ pageNumber: 1, text: 'ab\ncd.' }]);
  assertConstructionStale(moved, replaceOnlyParagraphProjection(moved, 'a bcd.', [
    { normalizedStart: 0, normalizedEnd: 1, pageNumber: 1,
      rawStart: 0, rawEnd: 1, kind: 'source' },
    { normalizedStart: 1, normalizedEnd: 2, pageNumber: null,
      rawStart: null, rawEnd: null, kind: 'virtual-space' },
    { normalizedStart: 2, normalizedEnd: 3, pageNumber: 1,
      rawStart: 1, rawEnd: 2, kind: 'source' },
    { normalizedStart: 3, normalizedEnd: 6, pageNumber: 1,
      rawStart: 3, rawEnd: 6, kind: 'source' }
  ]));
});

test('cross-page source runs require exactly one virtual-space explanation', () => {
  const base = fixture([
    { pageNumber: 1, text: 'Cross page' },
    { pageNumber: 2, text: 'result ends.' }
  ]);
  assertConstructionStale(base, replaceOnlyParagraphProjection(base,
    'Cross pageresult ends.', [
      { normalizedStart: 0, normalizedEnd: 10, pageNumber: 1,
        rawStart: 0, rawEnd: 10, kind: 'source' },
      { normalizedStart: 10, normalizedEnd: 22, pageNumber: 2,
        rawStart: 0, rawEnd: 12, kind: 'source' }
    ]));
});

test('LF, CR, and CRLF dehyphenation remain valid discontinuous mappings', () => {
  for (const separator of ['\n', '\r', '\r\n']) {
    const base = fixture([{ pageNumber: 1, text: `ab-${separator}cd.` }]);
    const paragraph = onlyParagraph(base);
    const result = base.adapter.resolvePdfSemanticRange(
      paragraph.paragraphId, 0, 4, 'abcd');
    assert.equal(result.status, 'resolved');
    assert.equal(result.precision, 'normalized-equivalent');
    assert.deepEqual(result.ranges.map(range => range.quote), ['ab', 'cd']);
  }
});

test('decomposed Unicode letter graphemes remain valid before dehyphenation gaps', () => {
  for (const [letter, normalizedLetter] of [
    ['e\u0301', 'é'],
    ['A\u030A', 'Å']
  ]) {
    for (const separator of ['\n', '\r', '\r\n']) {
      const base = fixture([{ pageNumber: 1, text: `${letter}-${separator}alpha.` }]);
      const paragraph = onlyParagraph(base);
      assert.equal(paragraph.normalizedText, `${normalizedLetter}alpha.`);
      const result = base.adapter.resolvePdfSemanticRange(
        paragraph.paragraphId, 0, `${normalizedLetter}alpha`.length,
        `${normalizedLetter}alpha`);
      assert.equal(result.status, 'resolved');
      assert.equal(result.verified, true);
      assert.equal(result.precision, 'normalized-equivalent');
    }
  }
});

test('digit and doubled-hyphen predecessors cannot authorize dehyphenation', () => {
  for (const [source, tampered, normalizedText] of [
    ['a-\nalpha.', '1-\nalpha.', '1alpha.'],
    ['aa-\nalpha.', 'a--\nalpha.', 'a-alpha.']
  ]) {
    const base = fixture([{ pageNumber: 1, text: source }]);
    const rawIndex = replaceSinglePageRawTextWithProvenance(base, tampered);
    const paragraph = Object.freeze({
      ...onlyParagraph(base),
      normalizedText,
      rawQuoteByPage: rawIndex.paragraphs[0].rawQuoteByPage
    });
    assertConstructionStale(base,
      replaceParagraphsWithProvenance(rawIndex, [paragraph]));
  }
});

test('producer preserves spaced, numeric and doubled hyphens at wrapped lines', () => {
  for (const prefix of ['surface -', '1-', 'alpha--']) {
    assert.equal(semanticIndexApi.normalizePdfTextWithOffsets(`${prefix}\ncarbon remains.`)
      .normalizedText, `${prefix} carbon remains.`);
    const base = fixture([{ pageNumber: 1, text: `${prefix}\ncarbon remains.` }]);
    const paragraph = onlyParagraph(base);
    assert.equal(paragraph.normalizedText, `${prefix} carbon remains.`);
    const result = base.adapter.resolvePdfSemanticRange(paragraph.paragraphId,
      0, paragraph.normalizedText.length, paragraph.normalizedText);
    assert.equal(result.status, 'resolved');
    assert.equal(result.verified, true);
  }
});

test('virtual line spaces retain every whitespace gap emitted by the index constructor', () => {
  for (const separator of ['\n', '\r', '\r\n', ' \r\n\t', '\r\r']) {
    const base = fixture([{ pageNumber: 1, text: `ab${separator}cd.` }]);
    const paragraph = onlyParagraph(base);
    assert.equal(paragraph.normalizedText, 'ab cd.');
    const result = base.adapter.resolvePdfSemanticRange(
      paragraph.paragraphId, 0, 5, 'ab cd');
    assert.equal(result.status, 'resolved');
    assert.equal(result.precision, 'normalized-equivalent');
  }
});

test('malformed or duplicate semantic mapping records fail closed at construction', () => {
  const mutations = [
    mappings => { mappings.push({ ...mappings[0] }); },
    mappings => { mappings[0] = { ...mappings[0], pageNumber: 0 }; },
    mappings => { mappings[0] = { ...mappings[0], pageNumber: '1' }; },
    mappings => { mappings[0] = { ...mappings[0], rawText: null }; }
  ];
  for (const mutate of mutations) {
    const base = fixture([{ pageNumber: 1, text: 'Strict mapping.' }]);
    const mappings = base.index.mappings.map(mapping => ({ ...mapping }));
    mutate(mappings);
    const draft = { ...base.index, mappings: Object.freeze(mappings.map(Object.freeze)) };
    const index = Object.freeze({
      ...draft,
      provenanceKey: pdfSemanticProvenanceKey(draft)
    });
    const semanticDocument = Object.freeze({ ...base.semanticDocument, index });
    assert.throws(() => createPdfSemanticCompatibilityAdapter({
      semanticDocument,
      nativeDocument: base.nativeDocument
    }), error => error?.code === 'PDF_SEMANTIC_SOURCE_STALE' &&
      error?.message === 'PDF_SEMANTIC_SOURCE_STALE');
  }
});

test('resolves complete NFKC graphemes but degrades a boundary inside an expansion', () => {
  const context = fixture([{ pageNumber: 2, text: '\uFF21 \uFB03 A\u030A.' }]);
  const paragraph = onlyParagraph(context);
  assert.equal(paragraph.normalizedText, 'A ffi Å.');
  for (const [quote, raw] of [['A', '\uFF21'], ['ffi', '\uFB03'], ['Å', 'A\u030A']]) {
    const start = paragraph.normalizedText.indexOf(quote);
    const result = context.adapter.resolvePdfSemanticRange(
      paragraph.paragraphId, start, start + quote.length, quote);
    assert.equal(result.status, 'resolved');
    assert.equal(result.precision, 'normalized-equivalent');
    assert.equal(result.ranges[0].quote, raw);
  }
  const inside = context.adapter.resolvePdfSemanticRange(
    paragraph.paragraphId, 3, 4, 'f');
  assert.equal(inside.status, 'degraded');
  assert.equal(inside.precision, 'page-only');
  assert.equal(inside.reasonCode, 'PDF_SEMANTIC_BOUNDARY_AMBIGUOUS');
  assert.deepEqual(inside.ranges, []);
  assert.deepEqual(inside.fallbackPageAnchors,
    [{ pageNumber: 2, legacyParagraphId: 'pdf-page-2' }]);
});

test('rejects ZWJ, combining-cluster, and unpaired-surrogate selections at runtime', () => {
  for (const sample of [
    { text: 'Family 👨‍👩‍👧‍👦 result.', select: text => {
      const start = text.indexOf('\u200D'); return [start, start + 1]; } },
    { text: 'Mark x\u0301\u0327 result.', select: text => {
      const start = text.indexOf('\u0301'); return [start, start + 1]; } },
    { text: 'Broken \uD800 result.', select: text => {
      const start = text.indexOf('\uD800'); return [start, start + 1]; } }
  ]) {
    const context = fixture([{ pageNumber: 1, text: sample.text }]);
    const paragraph = onlyParagraph(context);
    const [start, end] = sample.select(paragraph.normalizedText);
    const result = context.adapter.resolvePdfSemanticRange(
      paragraph.paragraphId, start, end, paragraph.normalizedText.slice(start, end));
    assert.equal(result.status, 'unresolved');
    assert.equal(result.precision, 'none');
    assert.equal(result.reasonCode, 'PDF_SEMANTIC_RANGE_INVALID');
    assert.equal(result.verified, false);
    assert.deepEqual(result.ranges, []);
  }
});

test('maps collapsed source whitespace and fails closed for a virtual-space-only selection', () => {
  const collapsed = fixture([{ pageNumber: 1, text: 'Alpha   beta.' }]);
  const collapsedParagraph = onlyParagraph(collapsed);
  const sourceSpace = collapsed.adapter.resolvePdfSemanticRange(
    collapsedParagraph.paragraphId, 5, 6, ' ');
  assert.equal(sourceSpace.status, 'resolved');
  assert.equal(sourceSpace.precision, 'normalized-equivalent');
  assert.equal(sourceSpace.ranges[0].quote, '   ');

  const virtual = fixture([{ pageNumber: 1, text: 'Alpha\nbeta.' }]);
  const virtualParagraph = onlyParagraph(virtual);
  const onlySpace = virtual.adapter.resolvePdfSemanticRange(
    virtualParagraph.paragraphId, 5, 6, ' ');
  assert.equal(onlySpace.status, 'degraded');
  assert.equal(onlySpace.precision, 'page-only');
  assert.equal(onlySpace.reasonCode, 'PDF_SEMANTIC_MAPPING_UNAVAILABLE');
  assert.deepEqual(onlySpace.ranges, []);
});

test('returns discontinuous raw ranges for removed hyphen and newline text', () => {
  const context = fixture([{ pageNumber: 4, text: 'inter-\nnal result.' }]);
  const paragraph = onlyParagraph(context);
  const result = context.adapter.resolvePdfSemanticRange(
    paragraph.paragraphId, 0, 8, 'internal');
  assert.equal(result.status, 'resolved');
  assert.equal(result.precision, 'normalized-equivalent');
  assert.deepEqual(result.ranges, [
    { pageNumber: 4, legacyParagraphId: 'pdf-page-4', start: 0, end: 5,
      quote: 'inter', precision: 'exact-raw' },
    { pageNumber: 4, legacyParagraphId: 'pdf-page-4', start: 7, end: 10,
      quote: 'nal', precision: 'exact-raw' }
  ]);
});

test('resolves a cross-page selection to ordered page-local ranges', () => {
  const context = fixture([
    { pageNumber: 1, text: 'Cross page' },
    { pageNumber: 2, text: 'result ends.' }
  ]);
  const paragraph = onlyParagraph(context);
  assert.equal(paragraph.normalizedText, 'Cross page result ends.');
  const result = context.adapter.resolvePdfSemanticRange(
    paragraph.paragraphId, 6, 17, 'page result');
  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.ranges.map(range => range.pageNumber), [1, 2]);
  assert.deepEqual(result.ranges.map(range => range.quote), ['page', 'result']);
});

test('paragraph identity and normalized offsets disambiguate repeated quotes', () => {
  const context = fixture([{ pageNumber: 1, text: 'same same.' }]);
  const paragraph = onlyParagraph(context);
  const result = context.adapter.resolvePdfSemanticRange(
    paragraph.paragraphId, 5, 9, 'same');
  assert.equal(result.ranges[0].start, 5);
});

test('repeated paragraph text cannot borrow another paragraph raw position identity', () => {
  const base = fixture([{ pageNumber: 1, text: 'same.\n\nsame.' }]);
  assert.equal(base.index.paragraphs.length, 2);
  const [first, second] = base.index.paragraphs;
  const forgedParagraph = Object.freeze({ ...first, positionRuns: second.positionRuns });
  const forgedDraft = { ...base.index,
    paragraphs: Object.freeze([forgedParagraph, second]) };
  const forgedIndex = Object.freeze({ ...forgedDraft,
    provenanceKey: pdfSemanticProvenanceKey(forgedDraft) });
  const semanticDocument = Object.freeze({ ...base.semanticDocument, index: forgedIndex });
  const adapter = createPdfSemanticCompatibilityAdapter({
    semanticDocument, nativeDocument: base.nativeDocument,
    getCurrentSemanticDocument: () => semanticDocument,
    getCurrentNativeDocument: () => base.nativeDocument
  });
  const result = adapter.resolvePdfSemanticRange(first.paragraphId, 0, 5, 'same.');
  assert.notEqual(result.status, 'resolved');
  assert.equal(result.verified, false);
  assert.deepEqual(result.ranges, []);
});

test('missing, mismatched, empty, out-of-range, and invalid UTF-16 selections fail closed', () => {
  const context = fixture([{ pageNumber: 1, text: 'A \u{1F9EA} result.' }]);
  const paragraph = onlyParagraph(context);
  const cases = [
    [paragraph.paragraphId, 0, 1, undefined, 'PDF_SEMANTIC_QUOTE_REQUIRED'],
    [paragraph.paragraphId, 0, 1, 'Z', 'PDF_SEMANTIC_QUOTE_MISMATCH'],
    [paragraph.paragraphId, 1, 1, '', 'PDF_SEMANTIC_RANGE_INVALID'],
    [paragraph.paragraphId, -1, 2, 'A ', 'PDF_SEMANTIC_RANGE_INVALID'],
    [paragraph.paragraphId, 3, 4, '', 'PDF_SEMANTIC_RANGE_INVALID'],
    ['missing', 0, 1, 'A', 'PDF_SEMANTIC_PARAGRAPH_NOT_FOUND']
  ];
  for (const [paragraphId, start, end, quote, reasonCode] of cases) {
    const result = context.adapter.resolvePdfSemanticRange(paragraphId, start, end, quote);
    assert.equal(result.status, 'unresolved');
    assert.equal(result.precision, 'none');
    assert.equal(result.reasonCode, reasonCode);
    assert.equal(result.verified, false);
    assert.deepEqual(result.ranges, []);
  }
});

test('malformed, overlapping, or out-of-page runs never produce resolved ranges', () => {
  const base = fixture([{ pageNumber: 1, text: 'Alpha result.' }]);
  const paragraph = onlyParagraph(base);
  for (const positionRuns of [
    [{ normalizedStart: 0, normalizedEnd: paragraph.normalizedText.length,
      pageNumber: 1, rawStart: 0, rawEnd: 999, kind: 'source' }],
    [{ normalizedStart: 0, normalizedEnd: 8, pageNumber: 1,
      rawStart: 0, rawEnd: 8, kind: 'source' },
    { normalizedStart: 7, normalizedEnd: paragraph.normalizedText.length,
      pageNumber: 1, rawStart: 7, rawEnd: 13, kind: 'source' }],
    [{ normalizedStart: 0, normalizedEnd: 5, pageNumber: 2,
      rawStart: 0, rawEnd: 5, kind: 'source' },
    { normalizedStart: 5, normalizedEnd: paragraph.normalizedText.length,
      pageNumber: 1, rawStart: 5, rawEnd: 13, kind: 'source' }]
  ]) {
    const badParagraph = Object.freeze({ ...paragraph, positionRuns: Object.freeze(positionRuns) });
    const badIndex = replaceParagraphsWithProvenance(base.index, [badParagraph]);
    const semanticDocument = Object.freeze({ ...base.semanticDocument, index: badIndex });
    let adapter;
    try {
      adapter = createPdfSemanticCompatibilityAdapter({
        semanticDocument, nativeDocument: base.nativeDocument,
        getCurrentSemanticDocument: () => semanticDocument,
        getCurrentNativeDocument: () => base.nativeDocument
      });
    } catch (error) {
      assert.equal(error?.code, 'PDF_SEMANTIC_SOURCE_STALE');
      assert.equal(error?.message, 'PDF_SEMANTIC_SOURCE_STALE');
      continue;
    }
    const result = adapter.resolvePdfSemanticRange(
      paragraph.paragraphId, 0, paragraph.normalizedText.length, paragraph.normalizedText);
    assert.notEqual(result.status, 'resolved');
    assert.deepEqual(result.ranges, []);
  }
});

test('forged many-to-one dehyphenation run cannot impersonate an atomic NFKC mapping', () => {
  const base = fixture([{ pageNumber: 1, text: 'inter-\nnal result.' }]);
  const paragraph = onlyParagraph(base);
  const forgedParagraph = Object.freeze({ ...paragraph,
    positionRuns: Object.freeze([
      Object.freeze({ normalizedStart: 0, normalizedEnd: 8, pageNumber: 1,
        rawStart: 0, rawEnd: 10, kind: 'source' }),
      Object.freeze({ normalizedStart: 8, normalizedEnd: paragraph.normalizedText.length,
        pageNumber: 1, rawStart: 10, rawEnd: 'inter-\nnal result.'.length, kind: 'source' })
    ])
  });
  const forgedIndex = replaceParagraphsWithProvenance(base.index, [forgedParagraph]);
  const semanticDocument = Object.freeze({ ...base.semanticDocument, index: forgedIndex });
  const adapter = createPdfSemanticCompatibilityAdapter({
    semanticDocument, nativeDocument: base.nativeDocument,
    getCurrentSemanticDocument: () => semanticDocument,
    getCurrentNativeDocument: () => base.nativeDocument
  });
  const result = adapter.resolvePdfSemanticRange(
    paragraph.paragraphId, 0, 8, 'internal');
  assert.notEqual(result.status, 'resolved');
  assert.equal(result.verified, false);
  assert.deepEqual(result.ranges, []);
});

test('equal UTF-16 lengths cannot hide merged NFKC expansion and contraction graphemes', () => {
  const raw = '\uFB03\u1100\u1161\u11A8.';
  const base = fixture([{ pageNumber: 1, text: raw }]);
  const paragraph = onlyParagraph(base);
  assert.equal(paragraph.normalizedText, 'ffi각.');
  const forgedParagraph = Object.freeze({ ...paragraph,
    positionRuns: Object.freeze([
      Object.freeze({ normalizedStart: 0, normalizedEnd: 4, pageNumber: 1,
        rawStart: 0, rawEnd: 4, kind: 'source' }),
      Object.freeze({ normalizedStart: 4, normalizedEnd: 5, pageNumber: 1,
        rawStart: 4, rawEnd: 5, kind: 'source' })
    ])
  });
  const forgedIndex = replaceParagraphsWithProvenance(base.index, [forgedParagraph]);
  const semanticDocument = Object.freeze({ ...base.semanticDocument, index: forgedIndex });
  const adapter = createPdfSemanticCompatibilityAdapter({
    semanticDocument, nativeDocument: base.nativeDocument,
    getCurrentSemanticDocument: () => semanticDocument,
    getCurrentNativeDocument: () => base.nativeDocument
  });
  const result = adapter.resolvePdfSemanticRange(paragraph.paragraphId, 0, 4, 'ffi각');
  assert.notEqual(result.status, 'resolved');
  assert.equal(result.verified, false);
  assert.deepEqual(result.ranges, []);
});

test('hash, generation, revision, schema, cache key, or bound object changes make the resolver stale', () => {
  const mutations = [
    context => { context.semanticDocument.schemaVersion = 99; },
    context => { context.semanticDocument.documentHash = 'e'.repeat(64); },
    context => { context.semanticDocument.documentGeneration = 14; },
    context => { context.semanticDocument.revision = 8; },
    context => { context.semanticDocument.index = {
      ...context.index, schemaVersion: context.index.schemaVersion + 1 }; },
    context => { context.semanticDocument.index = {
      ...context.index, cacheKey: `${context.index.cacheKey}:changed` }; },
    context => { context.semanticDocument.index = { ...context.index }; },
    context => { context.setSemantic({ ...context.semanticDocument }); }
  ];
  for (const mutate of mutations) {
    const context = fixture([{ pageNumber: 1, text: 'Stable text.' }]);
    const paragraph = onlyParagraph(context);
    mutate(context);
    const result = context.adapter.resolvePdfSemanticRange(
      paragraph.paragraphId, 0, 6, 'Stable');
    assert.equal(result.reasonCode, 'PDF_SEMANTIC_SOURCE_STALE');
    assert.deepEqual(result.ranges, []);
  }
  const native = fixture([{ pageNumber: 1, text: 'Stable text.' }]);
  native.setNative({ ...native.nativeDocument });
  assert.equal(native.adapter.resolvePdfSemanticRange(
    onlyParagraph(native).paragraphId, 0, 6, 'Stable').reasonCode,
  'PDF_SEMANTIC_SOURCE_STALE');
});

test('generation and revision identities require strict positive safe integers', () => {
  for (const value of [0, -1, 1.5, '1', NaN, Infinity]) {
    const base = fixture([{ pageNumber: 1, text: 'Strict identity.' }]);
    const invalidGenerationSemantic = { ...base.semanticDocument,
      documentGeneration: value };
    const invalidGenerationNative = { ...base.nativeDocument, documentGeneration: value };
    assert.throws(() => createPdfSemanticCompatibilityAdapter({
      semanticDocument: invalidGenerationSemantic,
      nativeDocument: invalidGenerationNative
    }), error => error?.code === 'PDF_SEMANTIC_SOURCE_STALE');

    const invalidRevisionIndex = { ...base.index,
      document: { ...base.index.document, revision: value } };
    const invalidRevisionSemantic = { ...base.semanticDocument,
      revision: value, index: invalidRevisionIndex };
    assert.throws(() => createPdfSemanticCompatibilityAdapter({
      semanticDocument: invalidRevisionSemantic,
      nativeDocument: base.nativeDocument
    }), error => error?.code === 'PDF_SEMANTIC_SOURCE_STALE');
  }
});

test('adapter compiles provenance, graphemes, and mappings once before repeated range hits', () => {
  const originalProvenance = semanticIndexApi.pdfSemanticProvenanceKey;
  const originalSegment = semanticIndexApi.segmentPdfGraphemes;
  const calls = { provenance: 0, segment: 0 };
  semanticIndexApi.pdfSemanticProvenanceKey = input => {
    calls.provenance += 1;
    return originalProvenance(input);
  };
  semanticIndexApi.segmentPdfGraphemes = text => {
    calls.segment += 1;
    return originalSegment(text);
  };
  try {
    const text = `${'x'.repeat(120000)}.`;
    const context = fixture([{ pageNumber: 1, text }]);
    const paragraph = onlyParagraph(context);
    const afterConstruction = { ...calls };
    assert.equal(afterConstruction.provenance, 1,
      'adapter construction validates full provenance exactly once');
    assert.ok(afterConstruction.segment >= 1);
    const started = performance.now();
    for (let index = 0; index < 20; index += 1) {
      const start = 119900 + index;
      const result = context.adapter.resolvePdfSemanticRange(
        paragraph.paragraphId, start, start + 8, text.slice(start, start + 8));
      assert.equal(result.status, 'resolved');
    }
    const elapsed = performance.now() - started;
    assert.deepEqual(calls, afterConstruction,
      'resolve must not repeat full provenance or grapheme compilation');
    assert.ok(elapsed < 1000, `20 compiled range hits took ${elapsed.toFixed(1)}ms`);
  } finally {
    semanticIndexApi.pdfSemanticProvenanceKey = originalProvenance;
    semanticIndexApi.segmentPdfGraphemes = originalSegment;
  }
});

test('borrowed cache identity cannot authorize rebuilt semantic content', () => {
  const trusted = fixture([{ pageNumber: 1, text: 'Trusted content.' }]);
  const rebuiltIndex = buildPdfSemanticIndex({ documentHash: HASH, revision: 7,
    pages: [{ pageNumber: 1, text: 'Rebuilt content.' }] });
  const forgedIndex = Object.freeze({ ...rebuiltIndex,
    cacheKey: trusted.index.cacheKey });
  const forgedNative = {
    structure: { ...trusted.structure,
      paragraphs: [{ paragraphId: 'pdf-page-1', sourceKey: 'pdf-page-1',
        pageNumber: 1, order: 0, text: 'Rebuilt content.', displayText: 'Rebuilt content.' }] },
    documentGeneration: 13
  };
  const forgedSemantic = { ...trusted.semanticDocument, index: forgedIndex };
  assert.throws(() => createPdfSemanticCompatibilityAdapter({
    semanticDocument: forgedSemantic, nativeDocument: forgedNative
  }), error => error?.code === 'PDF_SEMANTIC_SOURCE_STALE' &&
    error?.message === 'PDF_SEMANTIC_SOURCE_STALE');
});

test('borrowed provenance binds every field exposed on public section nodes', () => {
  const base = sectionFixture();
  const [preamble, parent, child] = base.index.sections;
  const mutations = [
    sections => { sections[0].sectionId = 'pdf-section:changed'; },
    sections => { sections[0].level += 1; },
    sections => { sections[0].source = 'changed-source'; },
    sections => { sections[1].headingId = 'pdf-heading:changed'; },
    sections => { sections[2].parentSectionId = preamble.sectionId; },
    sections => { sections[1].childSectionIds = []; },
    sections => { sections[0].paragraphIds = []; },
    sections => { sections.reverse(); }
  ];
  assert.ok(parent.childSectionIds.includes(child.sectionId));
  for (const mutate of mutations) {
    const sections = base.index.sections.map(section => ({
      ...section,
      childSectionIds: [...section.childSectionIds],
      paragraphIds: [...section.paragraphIds]
    }));
    mutate(sections);
    const forgedIndex = Object.freeze({
      ...base.index,
      sections: Object.freeze(sections.map(Object.freeze)),
      provenanceKey: base.index.provenanceKey
    });
    assertConstructionStale(base, forgedIndex);
  }
});

test('reviewer counterexample cannot inject internal parent identity or dangling children', () => {
  const base = sectionFixture();
  const sections = base.index.sections.map(section => ({
    ...section,
    childSectionIds: [...section.childSectionIds],
    paragraphIds: [...section.paragraphIds]
  }));
  sections[2].parentSectionId = `pdf-document:${HASH}`;
  sections[1].childSectionIds.push('pdf-section:does-not-exist');
  const forgedIndex = Object.freeze({
    ...base.index,
    sections: Object.freeze(sections.map(Object.freeze)),
    provenanceKey: base.index.provenanceKey
  });
  assertConstructionStale(base, forgedIndex);
});

test('construction rejects invalid section graphs even with recalculated provenance', () => {
  const cases = [
    { name: 'empty section id', mutate(sections) { sections[0].sectionId = ''; } },
    { name: 'duplicate section id', mutate(sections) {
      sections[2].sectionId = sections[1].sectionId;
    } },
    { name: 'internal section id', mutate(sections) {
      sections[0].sectionId = `pdf-document:${HASH}`;
    } },
    { name: 'unknown parent', mutate(sections) {
      sections[2].parentSectionId = 'pdf-section:missing';
    } },
    { name: 'unknown child', mutate(sections) {
      sections[1].childSectionIds.push('pdf-section:missing');
    } },
    { name: 'duplicate child', mutate(sections) {
      sections[1].childSectionIds.push(sections[2].sectionId);
    } },
    { name: 'self edge', mutate(sections) {
      sections[1].childSectionIds = [sections[1].sectionId];
    } },
    { name: 'one-way parent edge', mutate(sections) {
      sections[2].parentSectionId = null;
    } },
    { name: 'cycle', mutate(sections) {
      sections[1].parentSectionId = sections[2].sectionId;
      sections[2].childSectionIds = [sections[1].sectionId];
    } },
    { name: 'internal source identity', mutate(sections) {
      sections[0].source = `pdf-document:${HASH}`;
    } },
    { name: 'internal heading identity', mutate(sections) {
      sections[1].headingId = `pdf-document:${HASH}`;
    } }
  ];
  for (const graphCase of cases) {
    const base = sectionFixture();
    const sections = base.index.sections.map(section => ({
      ...section,
      childSectionIds: [...section.childSectionIds],
      paragraphIds: [...section.paragraphIds]
    }));
    graphCase.mutate(sections);
    const index = replaceSemanticContentWithProvenance(base.index, {
      sections: sections.map(Object.freeze)
    });
    assert.doesNotThrow(() => pdfSemanticProvenanceKey(index), graphCase.name);
    assertConstructionStale(base, index);
  }
});

test('construction rejects unknown, duplicate, missing, or contradictory paragraph-section links', () => {
  const cases = [
    { name: 'unknown section paragraph', mutate({ sections }) {
      sections[1].paragraphIds.push('pdf-paragraph:missing');
    } },
    { name: 'duplicate section paragraph', mutate({ sections }) {
      sections[1].paragraphIds.push(sections[1].paragraphIds[0]);
    } },
    { name: 'paragraph referenced twice', mutate({ sections }) {
      sections[2].paragraphIds.push(sections[1].paragraphIds[0]);
    } },
    { name: 'paragraph section mismatch', mutate({ paragraphs, sections }) {
      paragraphs[1].sectionId = sections[2].sectionId;
    } },
    { name: 'unknown paragraph section', mutate({ paragraphs }) {
      paragraphs[1].sectionId = 'pdf-section:missing';
    } },
    { name: 'unreferenced paragraph', mutate({ sections }) {
      sections[1].paragraphIds = [];
    } }
  ];
  for (const relationCase of cases) {
    const base = sectionFixture();
    const sections = base.index.sections.map(section => ({
      ...section,
      childSectionIds: [...section.childSectionIds],
      paragraphIds: [...section.paragraphIds]
    }));
    const paragraphs = base.index.paragraphs.map(paragraph => ({ ...paragraph }));
    relationCase.mutate({ paragraphs, sections });
    const index = replaceSemanticContentWithProvenance(base.index, {
      paragraphs: paragraphs.map(Object.freeze),
      sections: sections.map(Object.freeze)
    });
    assertConstructionStale(base, index);
  }
});

test('duplicate and empty paragraph ids fail both construction paths with recalculated provenance', () => {
  for (const kind of ['duplicate', 'empty']) {
    const base = sectionFixture();
    const sections = base.index.sections.map(section => ({
      ...section,
      childSectionIds: [...section.childSectionIds],
      paragraphIds: [...section.paragraphIds]
    }));
    const paragraphs = base.index.paragraphs.map(paragraph => ({ ...paragraph }));
    if (kind === 'duplicate') {
      paragraphs.push({ ...paragraphs[0] });
    } else {
      const oldId = paragraphs[0].paragraphId;
      paragraphs[0].paragraphId = '';
      sections[0].paragraphIds = sections[0].paragraphIds.map(
        paragraphId => paragraphId === oldId ? '' : paragraphId);
    }
    const index = replaceSemanticContentWithProvenance(base.index, {
      paragraphs: paragraphs.map(Object.freeze),
      sections: sections.map(Object.freeze)
    });
    assertConstructionStale(base, index);
  }
});

test('valid preamble and nested hierarchy remain unchanged through compatibility adaptation', () => {
  const context = sectionFixture();
  const adapted = adaptPdfSemanticIndexToArticleStructure({
    semanticDocument: context.semanticDocument,
    nativeDocument: context.nativeDocument
  });
  assert.deepEqual(adapted.nodes.map(node => ({
    sectionId: node.sectionId,
    level: node.level,
    source: node.source,
    headingId: node.headingId,
    parentSectionId: node.parentSectionId,
    childSectionIds: node.childSectionIds,
    paragraphIds: node.paragraphIds
  })), context.index.sections.map(section => ({
    sectionId: section.sectionId,
    level: section.level,
    source: section.source,
    headingId: section.headingId,
    parentSectionId: section.parentSectionId,
    childSectionIds: section.childSectionIds,
    paragraphIds: section.paragraphIds
  })));
  assert.equal(adapted.nodes[0].source, 'implicit-preamble');
  assert.equal(adapted.nodes[1].childSectionIds[0], adapted.nodes[2].sectionId);
  assert.equal(adapted.nodes[2].parentSectionId, adapted.nodes[1].sectionId);
});

test('adapter exposes an independent frozen nested semantic navigation projection', () => {
  const context = sectionFixture();
  const navigation = context.adapter.semanticNavigation;
  assert.equal(navigation.documentId, `sha256:${HASH}`);
  assert.equal(navigation.documentHash, HASH);
  assert.equal(navigation.documentGeneration, 13);
  assert.equal(navigation.revision, 7);
  assert.equal(navigation.semanticCacheKey, context.index.cacheKey);
  assert.equal(navigation.semanticProvenanceKey, context.index.provenanceKey);
  assert.equal(navigation.sections.length, 2);
  const preamble = navigation.sections.find(section => section.source === 'implicit-preamble');
  const results = navigation.sections.find(section => section.title === '1 Results');
  assert.equal(preamble.pageNumber, 1);
  assert.equal(preamble.target.kind, 'paragraph');
  assert.equal(results.pageNumber, 1);
  assert.equal(results.target.kind, 'heading');
  assert.equal(results.target.headingId, context.index.sections[1].headingId);
  assert.equal(results.children.length, 1);
  assert.equal(results.children[0].title, '1.1 Validation');
  assert.equal(results.children[0].parentSectionId, results.sectionId);
  const paragraphTarget = results.paragraphTargets[0];
  assert.equal('expectedResultFingerprint' in paragraphTarget, false);
  assert.deepEqual({
    paragraphId: paragraphTarget.paragraphId,
    normalizedStart: paragraphTarget.normalizedStart,
    normalizedEnd: paragraphTarget.normalizedEnd,
    expectedNormalizedQuote: paragraphTarget.expectedNormalizedQuote
  }, {
    paragraphId: context.index.paragraphs[1].paragraphId,
    normalizedStart: context.index.paragraphs[0].normalizedText.length,
    normalizedEnd: context.index.paragraphs[0].normalizedText.length +
      context.index.paragraphs[1].normalizedText.length,
    expectedNormalizedQuote: context.index.paragraphs[1].normalizedText
  });
  assert.notEqual(navigation.sections[0], context.adapter.articleStructure.nodes[0]);
  assert.equal(Object.isFrozen(navigation), true);
  assert.equal(Object.isFrozen(results.children), true);
  assert.doesNotThrow(() => structuredClone(navigation));
  const serialized = JSON.stringify(navigation);
  assert.equal(serialized.includes('positionRuns'), false);
  assert.equal(serialized.includes('rawQuoteByPage'), false);
  assert.equal(serialized.includes('rawText'), false);
  assert.equal(serialized.includes('pdf-document:'), false);
});

test('navigation paragraph targets disambiguate repeated text by semantic id and offsets', () => {
  const context = fixture([{ pageNumber: 1, text: 'same.\n\nsame.' }]);
  const targets = context.adapter.semanticNavigation.sections[0].paragraphTargets;
  assert.equal(targets.length, 2);
  assert.deepEqual(targets.map(target => target.expectedNormalizedQuote), ['same.', 'same.']);
  assert.notEqual(targets[0].paragraphId, targets[1].paragraphId);
  assert.deepEqual(targets.map(target => [target.normalizedStart, target.normalizedEnd]),
    [[0, 5], [5, 10]]);
  assert.deepEqual(targets.map(target => target.pageNumbers), [[1], [1]]);
});

test('navigation targets expose non-overlapping document offsets and all pages for a cross-page paragraph', () => {
  const context = fixture([
    { pageNumber: 1, text: 'First complete.\n\nCross page' },
    { pageNumber: 2, text: 'continues here.\n\nLast complete.' }
  ]);
  const targets = context.adapter.semanticNavigation.sections
    .flatMap(section => section.paragraphTargets);
  assert.ok(targets.length >= 3);
  for (let index = 1; index < targets.length; index += 1) {
    assert.ok(targets[index].normalizedStart >= targets[index - 1].normalizedEnd);
  }
  const crossPage = targets.find(target => target.pageNumbers.length === 2);
  assert.ok(crossPage);
  assert.deepEqual(crossPage.pageNumbers, [1, 2]);
  const localStart = crossPage.expectedNormalizedQuote.indexOf('continues');
  const quote = 'continues here.';
  const request = context.adapter.createNativeFocusRequest(
    crossPage.paragraphId,
    crossPage.normalizedStart + localStart,
    crossPage.normalizedStart + localStart + quote.length,
    quote
  );
  assert.equal(request.mode, 'ranges');
  assert.equal(request.pageNumber, 2);
  assert.equal(request.ranges[0].quote, quote);
});

test('production semantic navigation is accepted unchanged by citation migration', () => {
  const context = fixture([{ pageNumber: 1, text: 'Alpha.\n\nBeta.\n\nGamma.' }]);
  const targets = context.adapter.semanticNavigation.sections[0].paragraphTargets;
  const selected = targets[1];
  const migrationContext = {
    documentId: context.adapter.semanticNavigation.documentId,
    documentHash: context.adapter.semanticNavigation.documentHash,
    documentGeneration: context.adapter.semanticNavigation.documentGeneration,
    revision: context.adapter.semanticNavigation.revision,
    semanticCacheKey: context.adapter.semanticNavigation.semanticCacheKey,
    semanticProvenanceKey: context.adapter.semanticNavigation.semanticProvenanceKey,
    paragraphs: targets.map(target => ({
      paragraphId: target.paragraphId,
      normalizedText: target.expectedNormalizedQuote,
      normalizedStart: target.normalizedStart,
      normalizedEnd: target.normalizedEnd,
      pageNumber: target.pageNumber,
      legacyParagraphIds: target.pageNumbers.map(pageNumber => `pdf-page-${pageNumber}`)
    }))
  };
  const migration = citationApi.migratePdfArticleChatEvidence({
    locator: {
      locatorKind: 'pdf-semantic',
      documentId: migrationContext.documentId,
      documentHash: migrationContext.documentHash,
      documentGeneration: migrationContext.documentGeneration,
      revision: migrationContext.revision,
      semanticCacheKey: migrationContext.semanticCacheKey,
      semanticProvenanceKey: migrationContext.semanticProvenanceKey,
      paragraphId: selected.paragraphId,
      normalizedStart: selected.normalizedStart,
      normalizedEnd: selected.normalizedEnd,
      expectedNormalizedQuote: selected.expectedNormalizedQuote
    },
    pageAnchor: { paragraphId: 'pdf-page-1', pageNumber: 1 }
  }, migrationContext);
  assert.equal(migration.status, 'verified');
  assert.equal(migration.locator.paragraphId, selected.paragraphId);
  assert.equal(migration.degradedReasonCode, '');
});

test('compatibility never emits a focus request larger than the native consumer accepts', () => {
  const pages = [1, 2, 3, 4, 5].map(pageNumber => ({
    pageNumber,
    text: pageNumber === 5 ? 'continues and finally ends.' : `page${pageNumber} continues`
  }));
  const context = fixture(pages);
  const target = context.adapter.semanticNavigation.sections
    .flatMap(section => section.paragraphTargets)
    .find(candidate => candidate.pageNumbers.length === 5);
  assert.ok(target);
  assert.equal(context.adapter.createNativeFocusRequest(
    target.paragraphId, target.normalizedStart, target.normalizedEnd,
    target.expectedNormalizedQuote
  ), null);
});

test('adapter atomically resolves a navigation paragraph into a bounded immutable native focus request', () => {
  const context = fixture([{ pageNumber: 1, text: 'Alpha result.' }]);
  const target = context.adapter.semanticNavigation.sections[0].paragraphTargets[0];
  const request = context.adapter.createNativeFocusRequest(
    target.paragraphId, target.normalizedStart, target.normalizedEnd,
    target.expectedNormalizedQuote);
  assert.deepEqual(request, {
    schemaVersion: 1,
    type: 'pdf-native-focus-request',
    mode: 'ranges',
    documentId: `sha256:${HASH}`,
    documentHash: HASH,
    documentGeneration: 13,
    revision: 7,
    semanticCacheKey: context.index.cacheKey,
    semanticProvenanceKey: context.index.provenanceKey,
    paragraphId: target.paragraphId,
    granularity: 'paragraph',
    pageNumber: 1,
    precision: 'exact-raw',
    ranges: [{ pageNumber: 1, start: 0, end: 13,
      quote: 'Alpha result.', precision: 'exact-raw' }]
  });
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.ranges[0]), true);
  assert.doesNotThrow(() => structuredClone(request));
});

test('legacy stateless focus conversion cannot accept jointly forged target, raw range, and public fingerprint', () => {
  const context = fixture([{ pageNumber: 1, text: 'Alpha result.' }]);
  const target = context.adapter.semanticNavigation.sections[0].paragraphTargets[0];
  const forgedResult = {
    schemaVersion: 1,
    status: 'resolved',
    precision: 'exact-raw',
    verified: true,
    documentId: target.documentId,
    documentHash: target.documentHash,
    documentGeneration: target.documentGeneration,
    revision: target.revision,
    semanticCacheKey: target.semanticCacheKey,
    semanticProvenanceKey: target.semanticProvenanceKey,
    paragraphId: target.paragraphId,
    normalizedRange: { start: target.normalizedStart, end: target.normalizedEnd },
    normalizedQuote: target.expectedNormalizedQuote,
    ranges: [{ pageNumber: 9, start: 500, end: 513,
      quote: 'Alpha result.', precision: 'exact-raw' }],
    fallbackPageAnchors: []
  };
  const forgedTarget = {
    ...structuredClone(target),
    expectedResultFingerprint: publicFocusFingerprint(forgedResult)
  };
  assert.equal(invokeLegacyFocusHelper(forgedResult, forgedTarget), null);
});

test('legacy stateless focus conversion cannot redirect a real degraded target to page 999', () => {
  const context = fixture([{ pageNumber: 1, text: 'Alpha\nbeta.' }]);
  const paragraph = onlyParagraph(context);
  const start = paragraph.normalizedText.indexOf(' ');
  const target = {
    ...context.adapter.semanticNavigation.sections[0].paragraphTargets[0],
    normalizedStart: start,
    normalizedEnd: start + 1,
    expectedNormalizedQuote: ' '
  };
  const result = context.adapter.resolvePdfSemanticRange(
    target.paragraphId, target.normalizedStart, target.normalizedEnd,
    target.expectedNormalizedQuote);
  assert.equal(result.status, 'degraded');
  assert.equal(invokeLegacyFocusHelper({
    ...result,
    fallbackPageAnchors: [{ pageNumber: 999, legacyParagraphId: 'pdf-page-999' }]
  }, target), null);
});

test('adapter derives degraded page-only focus solely from compiled paragraph anchors', () => {
  const context = fixture([{ pageNumber: 1, text: 'Alpha\nbeta.' }]);
  const paragraph = onlyParagraph(context);
  const start = paragraph.normalizedText.indexOf(' ');
  const request = context.adapter.createNativeFocusRequest(
    paragraph.paragraphId, start, start + 1, ' ');
  assert.deepEqual(request, {
    schemaVersion: 1,
    type: 'pdf-native-focus-request',
    mode: 'page-only',
    documentId: `sha256:${HASH}`,
    documentHash: HASH,
    documentGeneration: 13,
    revision: 7,
    semanticCacheKey: context.index.cacheKey,
    semanticProvenanceKey: context.index.provenanceKey,
    paragraphId: paragraph.paragraphId,
    granularity: 'sentence',
    pageNumber: 1,
    precision: 'page-only',
    pageNumbers: [1],
    ranges: []
  });
});

test('adapter creates precise focus for a sentence fragment spanning canonical pages', () => {
  const context = fixture([
    { pageNumber: 1, text: 'Cross page' },
    { pageNumber: 2, text: 'result ends.' }
  ]);
  const paragraph = onlyParagraph(context);
  const quote = 'page result';
  const start = paragraph.normalizedText.indexOf(quote);
  const request = context.adapter.createNativeFocusRequest(
    paragraph.paragraphId, start, start + quote.length, quote);
  assert.deepEqual(request.ranges, [
    { pageNumber: 1, start: 6, end: 10, quote: 'page', precision: 'exact-raw' },
    { pageNumber: 2, start: 0, end: 6, quote: 'result', precision: 'exact-raw' }
  ]);
  assert.equal(request.mode, 'ranges');
  assert.equal(request.granularity, 'sentence');
  assert.equal(request.precision, 'normalized-equivalent');
});

test('adapter disambiguates repeated sentence focus by normalized offset', () => {
  const context = fixture([{ pageNumber: 1,
    text: 'Repeat sentence. Repeat sentence. End.' }]);
  const paragraph = onlyParagraph(context);
  const quote = 'Repeat sentence.';
  const start = paragraph.normalizedText.lastIndexOf(quote);
  const request = context.adapter.createNativeFocusRequest(
    paragraph.paragraphId, start, start + quote.length, quote);
  assert.deepEqual(request.ranges, [{ pageNumber: 1, start, end: start + quote.length,
    quote, precision: 'exact-raw' }]);
  assert.equal(request.granularity, 'sentence');
});

test('stale adapter cannot create native focus requests', () => {
  const context = fixture([{ pageNumber: 1, text: 'Stale focus.' }]);
  const paragraph = onlyParagraph(context);
  context.setSemantic(structuredClone(context.semanticDocument));
  assert.equal(context.adapter.createNativeFocusRequest(
    paragraph.paragraphId, 0, 5, 'Stale'), null);
});

test('focus API accepts normalized coordinates only and exposes no stateless converter', () => {
  const context = fixture([{ pageNumber: 1, text: 'Bound focus.' }]);
  const target = context.adapter.semanticNavigation.sections[0].paragraphTargets[0];
  const forgedResult = { status: 'degraded', fallbackPageAnchors: [
    { pageNumber: 999, legacyParagraphId: 'pdf-page-999' }
  ] };
  assert.equal(compatibilityApi.pdfSemanticResultToNativeFocusRequest, undefined);
  assert.equal(context.adapter.createNativeFocusRequest(forgedResult, target), null);
});

test('compatibility article structure preserves workspace identity and stable semantic order', () => {
  const context = fixture([{ pageNumber: 1, text: 'First. Second.' }]);
  const adapted = adaptPdfSemanticIndexToArticleStructure({
    semanticDocument: context.semanticDocument,
    nativeDocument: context.nativeDocument
  });
  assert.equal(adapted.documentId, `sha256:${HASH}`);
  assert.equal(adapted.adapterId, 'pdf-native');
  assert.equal(adapted.documentHash, HASH);
  assert.deepEqual(adapted.paragraphs.map(item => item.paragraphId),
    context.index.paragraphs.map(item => item.paragraphId));
  assert.deepEqual(adapted.paragraphs[0].legacyParagraphIds, ['pdf-page-1']);
  assert.equal(JSON.stringify(adapted).includes('positionRuns'), false);
  assert.equal(JSON.stringify(adapted).includes('pdf-document:'), false);
  assert.equal(Object.isFrozen(adapted), true);
  assert.doesNotThrow(() => structuredClone(adapted));
});

test('article adaptation and adapter construction reject conflicting source identities', () => {
  const context = fixture([{ pageNumber: 1, text: 'Identity bound.' }]);
  const conflictingNative = {
    ...context.nativeDocument,
    structure: { ...context.structure,
      documentId: `sha256:${'e'.repeat(64)}`, documentHash: 'e'.repeat(64) }
  };
  for (const construct of [
    () => adaptPdfSemanticIndexToArticleStructure({
      semanticDocument: context.semanticDocument, nativeDocument: conflictingNative }),
    () => createPdfSemanticCompatibilityAdapter({
      semanticDocument: context.semanticDocument, nativeDocument: conflictingNative })
  ]) {
    assert.throws(construct, error => error?.code === 'PDF_SEMANTIC_SOURCE_STALE' &&
      error?.message === 'PDF_SEMANTIC_SOURCE_STALE');
  }
});

test('adapter leaves inputs unchanged and exposes only bound pure compatibility operations', () => {
  const context = fixture([{ pageNumber: 1, text: 'Immutable source.' }]);
  const beforeSemantic = structuredClone(context.semanticDocument);
  const beforeNative = structuredClone(context.nativeDocument);
  const paragraph = onlyParagraph(context);
  context.adapter.resolvePdfSemanticRange(paragraph.paragraphId, 0, 9, 'Immutable');
  assert.deepEqual(context.semanticDocument, beforeSemantic);
  assert.deepEqual(context.nativeDocument, beforeNative);
  assert.equal(typeof context.adapter.resolvePdfSemanticRange, 'function');
  assert.equal(typeof context.adapter.createNativeFocusRequest, 'function');
  assert.equal(Object.isFrozen(context.adapter), true);
  assert.equal('positionRuns' in context.adapter.articleStructure.paragraphs[0], false);
});

test('position runs stay inside the pure index-to-compatibility boundary', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../core/pdf-semantic-compat.js'), 'utf8');
  assert.doesNotMatch(source, /dispatchEvent|CustomEvent|localStorage|sessionStorage|console\./u);
  const context = fixture([{ pageNumber: 1, text: 'Private mapping.' }]);
  assert.equal(JSON.stringify(context.adapter.articleStructure).includes('positionRuns'), false);
  const result = context.adapter.resolvePdfSemanticRange(
    onlyParagraph(context).paragraphId, 0, 7, 'Private');
  assert.equal(JSON.stringify(result).includes('positionRuns'), false);
});
