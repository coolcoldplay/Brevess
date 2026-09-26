const test = require('node:test');
const assert = require('node:assert/strict');

const citations = require('../core/article-chat-citations.js');

const DOCUMENT_HASH = 'a'.repeat(64);

function semanticParagraph(paragraphId, normalizedText, normalizedStart, pageNumber) {
  return {
    paragraphId,
    normalizedText,
    normalizedStart,
    normalizedEnd: normalizedStart + normalizedText.length,
    pageNumber,
    legacyParagraphIds: [`pdf-page-${pageNumber}`]
  };
}

function currentSemanticContext(overrides = {}) {
  const results = semanticParagraph('semantic-results-1',
    'Alpha effect was observed in the treated cohort.', 100, 4);
  const discussion = semanticParagraph('semantic-discussion-1',
    'The discussion carefully limits the interpretation.', 900, 7);
  return {
    documentId: 'sha256:article-a',
    documentHash: DOCUMENT_HASH,
    documentGeneration: 4,
    revision: 8,
    semanticCacheKey: 'semantic-cache-8',
    semanticProvenanceKey: 'semantic-provenance-8',
    paragraphs: [
      {
        ...results,
        positionRuns: [{ rawStart: 0, rawEnd: 5, secret: 'must-not-persist' }]
      },
      discussion
    ],
    ...overrides
  };
}

function semanticLocator(overrides = {}) {
  const quote = 'Alpha effect was observed';
  return {
    locatorKind: 'pdf-semantic',
    documentId: 'sha256:article-a',
    documentHash: DOCUMENT_HASH,
    documentGeneration: 4,
    revision: 8,
    semanticCacheKey: 'semantic-cache-8',
    semanticProvenanceKey: 'semantic-provenance-8',
    paragraphId: 'semantic-results-1',
    normalizedStart: 100,
    normalizedEnd: 100 + quote.length,
    expectedNormalizedQuote: quote,
    ...overrides
  };
}

test('exports bounded pure PDF article-chat migration APIs', () => {
  assert.equal(typeof citations.normalizePdfSemanticEvidenceLocator, 'function');
  assert.equal(typeof citations.migratePdfArticleChatEvidence, 'function');
});

test('same-revision continuation sentence keeps precise offsets without inventing a page fallback', () => {
  const quote = 'The continuation reports the measured effect.';
  const text = `The experiment began on the preceding page. ${quote}`;
  const context = currentSemanticContext({ paragraphs: [{
    ...semanticParagraph('semantic-results-1', text, 100, 4),
    legacyParagraphIds: ['pdf-page-4', 'pdf-page-5']
  }] });
  const locator = semanticLocator({
    normalizedStart: 100 + text.indexOf(quote),
    normalizedEnd: 100 + text.length,
    expectedNormalizedQuote: quote
  });
  const pageAnchor = { paragraphId: 'pdf-page-5', pageNumber: 5 };
  const result = citations.migratePdfArticleChatEvidence({ locator, pageAnchor }, context);
  assert.equal(result.status, 'verified');
  assert.deepEqual(result.locator, locator);
  assert.equal(result.pageAnchor, null,
    'page membership alone cannot prove the raw page of a sentence; native focus must resolve it');
  const withoutAnchor = citations.migratePdfArticleChatEvidence({ locator }, context);
  assert.equal(withoutAnchor.status, 'verified');
  assert.equal(withoutAnchor.pageAnchor, null, 'never guess the first page of a cross-page paragraph');
  assert.equal(citations.migratePdfArticleChatEvidence({ locator,
    pageAnchor: { paragraphId: 'pdf-page-7', pageNumber: 7 } }, context).status, 'invalid');
});

test('verifies every semantic locator identity and exact normalized quote', () => {
  const input = { locator: semanticLocator() };
  const result = citations.migratePdfArticleChatEvidence(input, currentSemanticContext());

  assert.equal(result.status, 'verified');
  assert.equal(result.precision, 'normalized-exact');
  assert.equal(result.rebound, false);
  assert.deepEqual(result.locator, semanticLocator());
  assert.equal(result.degradedReasonCode, '');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.locator), true);
  assert.doesNotMatch(JSON.stringify(result), /positionRuns|rawStart|secret/);
});

test('rebinds a bounded document-global offset beyond one paragraph length ceiling', () => {
  const start = 250000;
  const text = 'Late-document semantic evidence.';
  const context = currentSemanticContext({
    paragraphs: [semanticParagraph('semantic-late', text, start, 44)]
  });
  const result = citations.migratePdfArticleChatEvidence({ locator: semanticLocator({
    paragraphId: 'semantic-old-late', normalizedStart: start,
    normalizedEnd: start + text.length, expectedNormalizedQuote: text,
    revision: 7, semanticCacheKey: 'semantic-cache-7',
    semanticProvenanceKey: 'semantic-provenance-7'
  }) }, context);
  assert.equal(result.status, 'verified');
  assert.equal(result.rebound, true);
  assert.equal(result.locator.normalizedStart, start);
});

test('never rebinds a semantic locator after document replacement', () => {
  for (const replacement of [
    { documentId: 'sha256:article-b' },
    { documentHash: 'b'.repeat(64) },
    { documentGeneration: 5 }
  ]) {
    const original = semanticLocator({ revision: 7,
      semanticCacheKey: 'semantic-cache-7',
      semanticProvenanceKey: 'semantic-provenance-7' });
    const result = citations.migratePdfArticleChatEvidence(
      { locator: original }, currentSemanticContext(replacement));

    assert.equal(result.status, 'stale');
    assert.equal(result.degradedReasonCode, 'PDF_DOCUMENT_CHANGED');
    assert.equal(result.rebound, false);
    assert.equal(result.locator, null);
    assert.equal(result.suggestedLocator, null);
    assert.deepEqual(result.preservedLocator, original);
  }
});

test('rebinds revision drift only to one unique current semantic quote', () => {
  const old = semanticLocator({
    paragraphId: 'semantic-old-results',
    revision: 7,
    semanticCacheKey: 'semantic-cache-7',
    semanticProvenanceKey: 'semantic-provenance-7'
  });
  const result = citations.migratePdfArticleChatEvidence(
    { locator: old, pageAnchor: { paragraphId: 'pdf-page-4', pageNumber: 4 } },
    currentSemanticContext()
  );

  assert.equal(result.status, 'verified');
  assert.equal(result.rebound, true);
  assert.equal(result.precision, 'normalized-exact');
  assert.equal(result.locator.paragraphId, 'semantic-results-1');
  assert.equal(result.locator.normalizedStart, 100);
  assert.equal(result.locator.normalizedEnd,
    100 + result.locator.expectedNormalizedQuote.length);
  assert.equal(result.locator.revision, 8);
  assert.equal(result.locator.semanticCacheKey, 'semantic-cache-8');
  assert.equal(result.locator.semanticProvenanceKey, 'semantic-provenance-8');
  assert.deepEqual(result.preservedLocator, old);
  assert.deepEqual(result.pageAnchor,
    { paragraphId: 'pdf-page-4', pageNumber: 4 });
});

test('fails closed when revision-drift quote has multiple current candidates', () => {
  const duplicate = 'Alpha effect was observed in the treated cohort.';
  const context = currentSemanticContext({ paragraphs: [
    semanticParagraph('semantic-a', duplicate, 300, 4),
    semanticParagraph('semantic-b', duplicate, 700, 5)
  ] });
  const old = semanticLocator({ revision: 7, semanticCacheKey: 'semantic-cache-7',
    semanticProvenanceKey: 'semantic-provenance-7' });
  const result = citations.migratePdfArticleChatEvidence({ locator: old }, context);

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.precision, 'none');
  assert.equal(result.degradedReasonCode, 'PDF_SEMANTIC_QUOTE_AMBIGUOUS');
  assert.equal(result.rebound, false);
  assert.equal(result.locator, null);
  assert.deepEqual(result.preservedLocator, old);
});

test('revision rebinding preserves a unique exact quote boundary beside punctuation and footnotes', () => {
  for (const [text, quote] of [
    ['The response was (rapid), but remained reversible.', 'rapid'],
    ['The response was (rapid), but remained reversible.', '(rapid)'],
    ['Felix Nebeling¹*, Stefanie Poll¹, Lena Justus¹', 'Felix Nebeling¹*'],
    ['1 Felix Christopher Nebeling *, Stefanie Poll , Lena Christine Justus , Julia Steffen ,',
      '1 Felix Christopher Nebeling *, Stefanie Poll , Lena Christine Justus , Julia Steffen ,'],
    ['Alpha effect was observed. The next sentence reports no benefit.', 'Alpha effect was observed']
  ]) {
    const start = text.indexOf(quote);
    const context = currentSemanticContext({ paragraphs: [
      semanticParagraph('semantic-new', text, 700, 2)
    ] });
    const old = semanticLocator({ revision: 7,
      semanticCacheKey: 'semantic-cache-7', semanticProvenanceKey: 'semantic-provenance-7',
      normalizedStart: 100, normalizedEnd: 100 + quote.length,
      expectedNormalizedQuote: quote });
    const result = citations.migratePdfArticleChatEvidence({ locator: old }, context);
    assert.equal(result.status, 'verified');
    assert.equal(result.locator.normalizedStart, 700 + start);
    assert.equal(result.locator.normalizedEnd, 700 + start + quote.length);
    assert.equal(result.locator.expectedNormalizedQuote, quote);
  }
});

test('an exact revision quote still rejects another canonical match with different punctuation', () => {
  const text = 'The response was rapid. The response was rapid!';
  const quote = 'The response was rapid.';
  const context = currentSemanticContext({ paragraphs: [
    semanticParagraph('semantic-new', text, 700, 2)
  ] });
  const old = semanticLocator({ revision: 7,
    semanticCacheKey: 'semantic-cache-7', semanticProvenanceKey: 'semantic-provenance-7',
    normalizedStart: 100, normalizedEnd: 100 + quote.length,
    expectedNormalizedQuote: quote });
  assert.equal(citations.migratePdfArticleChatEvidence({ locator: old }, context).status,
    'ambiguous');
});

test('exact revision boundaries belong to the unique canonical occurrence, not a larger earlier word', () => {
  for (const [text, quote] of [
    ['workflow changed; flow changed.', 'flow'],
    ['🧠 microcontrol improved; control improved.', 'control improved']
  ]) {
    const context = currentSemanticContext({ paragraphs: [
      semanticParagraph('semantic-new', text, 700, 2)
    ] });
    const old = semanticLocator({ revision: 7,
      semanticCacheKey: 'semantic-cache-7', semanticProvenanceKey: 'semantic-provenance-7',
      normalizedStart: 100, normalizedEnd: 100 + quote.length,
      expectedNormalizedQuote: quote });
    const result = citations.migratePdfArticleChatEvidence({ locator: old }, context);
    assert.equal(result.status, 'verified');
    assert.equal(result.locator.normalizedStart, 700 + text.lastIndexOf(quote));
    assert.equal(result.locator.normalizedEnd, 700 + text.lastIndexOf(quote) + quote.length);
    assert.equal(result.locator.expectedNormalizedQuote, quote);
  }
});

test('fails closed when a revision-drift quote occurs twice in one semantic paragraph', () => {
  const quote = 'Alpha effect was observed';
  const context = currentSemanticContext({ paragraphs: [
    semanticParagraph('semantic-results-1',
      `${quote} in the treated cohort. Later, ${quote} in the control cohort.`, 100, 4)
  ] });
  const old = semanticLocator({ revision: 7, semanticCacheKey: 'semantic-cache-7',
    semanticProvenanceKey: 'semantic-provenance-7' });
  const result = citations.migratePdfArticleChatEvidence({ locator: old }, context);

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.precision, 'none');
  assert.equal(result.degradedReasonCode, 'PDF_SEMANTIC_QUOTE_AMBIGUOUS');
  assert.equal(result.rebound, false);
  assert.equal(result.locator, null);
  assert.deepEqual(result.preservedLocator, old);
});

test('same-revision cache or provenance mismatch is stale instead of quote-rebound', () => {
  for (const change of [
    { semanticCacheKey: 'forged-cache' },
    { semanticProvenanceKey: 'forged-provenance' }
  ]) {
    const original = semanticLocator(change);
    const result = citations.migratePdfArticleChatEvidence(
      { locator: original }, currentSemanticContext());
    assert.equal(result.status, 'stale');
    assert.equal(result.degradedReasonCode, 'PDF_SEMANTIC_IDENTITY_MISMATCH');
    assert.equal(result.locator, null);
    assert.equal(result.rebound, false);
  }
});

test('rejects a semantic page anchor that does not own the locator paragraph', () => {
  const result = citations.migratePdfArticleChatEvidence({
    locator: semanticLocator(),
    pageAnchor: { paragraphId: 'pdf-page-7', pageNumber: 7 }
  }, currentSemanticContext());
  assert.equal(result.status, 'invalid');
  assert.equal(result.degradedReasonCode, 'PDF_EVIDENCE_PAGE_ANCHOR_MISMATCH');
  assert.equal(result.locator, null);
});

test('multi-page semantic locators keep exact focus but discard an unverifiable page fallback', () => {
  const context = currentSemanticContext({ paragraphs: [{
    ...semanticParagraph('semantic-results-1',
      'Alpha effect was observed in the treated cohort.', 100, 4),
    legacyParagraphIds: ['pdf-page-4', 'pdf-page-5']
  }] });
  const result = citations.migratePdfArticleChatEvidence({
    locator: semanticLocator(),
    pageAnchor: { paragraphId: 'pdf-page-4', pageNumber: 4 }
  }, context);
  assert.equal(result.status, 'verified');
  assert.equal(result.locator.paragraphId, 'semantic-results-1');
  assert.equal(result.pageAnchor, null);
});

test('revision split rebinds a unique quote to its new single-page anchor', () => {
  const old = semanticLocator({ revision: 7,
    semanticCacheKey: 'semantic-cache-7',
    semanticProvenanceKey: 'semantic-provenance-7' });
  const context = currentSemanticContext({ paragraphs: [
    semanticParagraph('semantic-page-five',
      'Alpha effect was observed in the treated cohort.', 500, 5)
  ] });
  const result = citations.migratePdfArticleChatEvidence({
    locator: old,
    pageAnchor: { paragraphId: 'pdf-page-4', pageNumber: 4 }
  }, context);
  assert.equal(result.status, 'verified');
  assert.equal(result.rebound, true);
  assert.equal(result.locator.paragraphId, 'semantic-page-five');
  assert.deepEqual(result.pageAnchor,
    { paragraphId: 'pdf-page-5', pageNumber: 5 });
});

test('rejects a current semantic context with duplicate paragraph identities', () => {
  const context = currentSemanticContext({ paragraphs: [
    semanticParagraph('semantic-results-1',
      'Alpha effect was observed in the treated cohort.', 100, 4),
    semanticParagraph('semantic-results-1',
      'A conflicting duplicate identity.', 800, 5)
  ] });
  const result = citations.migratePdfArticleChatEvidence(
    { locator: semanticLocator() }, context);
  assert.equal(result.status, 'invalid');
  assert.equal(result.degradedReasonCode, 'PDF_EVIDENCE_INVALID');
});

test('rejects overlapping global semantic paragraph intervals', () => {
  const result = citations.migratePdfArticleChatEvidence({ locator: semanticLocator() },
    currentSemanticContext({ paragraphs: [
      semanticParagraph('semantic-results-1',
        'Alpha effect was observed in the treated cohort.', 100, 4),
      semanticParagraph('semantic-overlap', 'Overlapping interval.', 120, 5)
    ] }));
  assert.equal(result.status, 'invalid');
  assert.equal(result.degradedReasonCode, 'PDF_EVIDENCE_INVALID');
});

test('rejects semantic contexts above the cumulative paragraph text budget', () => {
  const text = 'x'.repeat(200000);
  const paragraphs = Array.from({ length: 21 }, (_, index) =>
    semanticParagraph(`semantic-${index}`, text, index * 200001, index + 1));
  const result = citations.migratePdfArticleChatEvidence({ locator: semanticLocator() },
    currentSemanticContext({ paragraphs }));
  assert.equal(result.status, 'invalid');
  assert.equal(result.degradedReasonCode, 'PDF_EVIDENCE_INVALID');
});

test('legacy page evidence stays degraded and offers only a unique scoped quote suggestion', () => {
  const legacy = {
    paragraphId: 'pdf-page-4',
    pageNumber: 4,
    quote: 'Alpha effect was observed'
  };
  const original = structuredClone(legacy);
  const result = citations.migratePdfArticleChatEvidence(
    legacy, currentSemanticContext());

  assert.equal(result.status, 'degraded');
  assert.equal(result.precision, 'page-only');
  assert.equal(result.degradedReasonCode, 'PDF_LEGACY_PAGE_ANCHOR');
  assert.equal(result.rebound, false);
  assert.equal(result.locator, null);
  assert.equal(result.suggestedLocator.paragraphId, 'semantic-results-1');
  assert.equal(result.suggestedLocator.normalizedStart, 100);
  assert.deepEqual(result.pageAnchor,
    { paragraphId: 'pdf-page-4', pageNumber: 4 });
  assert.deepEqual(legacy, original);
});

test('legacy duplicate quote preserves page fallback and refuses a semantic suggestion', () => {
  const text = 'Repeated evidence sentence.';
  const result = citations.migratePdfArticleChatEvidence({
    paragraphId: 'pdf-page-4', quote: text
  }, currentSemanticContext({ paragraphs: [
    semanticParagraph('semantic-a', text, 300, 4),
    semanticParagraph('semantic-b', text, 600, 4)
  ] }));

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.precision, 'page-only');
  assert.equal(result.degradedReasonCode, 'PDF_LEGACY_QUOTE_AMBIGUOUS');
  assert.equal(result.suggestedLocator, null);
  assert.deepEqual(result.pageAnchor,
    { paragraphId: 'pdf-page-4', pageNumber: 4 });
});

test('rejects accessors, polluted prototypes, unknown locator keys and oversized quotes', () => {
  let getterCalls = 0;
  const getterLocator = Object.create(null, {
    locatorKind: { enumerable: true, get() { getterCalls += 1; return 'pdf-semantic'; } }
  });
  const polluted = Object.create({ inherited: true });
  Object.assign(polluted, semanticLocator());
  const candidates = [
    getterLocator,
    polluted,
    { ...semanticLocator(), unknown: true },
    semanticLocator({ expectedNormalizedQuote: 'x'.repeat(4001),
      normalizedStart: 0, normalizedEnd: 4001 })
  ];

  candidates.forEach(locator => {
    const result = citations.migratePdfArticleChatEvidence(
      { locator }, currentSemanticContext());
    assert.equal(result.status, 'invalid');
    assert.equal(result.degradedReasonCode, 'PDF_EVIDENCE_INVALID');
  });
  assert.equal(getterCalls, 0);
});

test('fails closed on a revoked locator proxy', () => {
  const { proxy, revoke } = Proxy.revocable(semanticLocator(), {});
  revoke();
  assert.doesNotThrow(() => {
    const result = citations.migratePdfArticleChatEvidence(
      { locator: proxy }, currentSemanticContext());
    assert.equal(result.status, 'invalid');
    assert.equal(result.degradedReasonCode, 'PDF_EVIDENCE_INVALID');
  });
});

test('fails closed on revoked nested paragraph and legacy-id arrays', () => {
  const paragraphs = Proxy.revocable([], {});
  paragraphs.revoke();
  assert.doesNotThrow(() => assert.equal(
    citations.migratePdfArticleChatEvidence({ locator: semanticLocator() },
      currentSemanticContext({ paragraphs: paragraphs.proxy })).status,
    'invalid'));

  const legacyIds = Proxy.revocable(['pdf-page-4'], {});
  legacyIds.revoke();
  const paragraph = semanticParagraph('semantic-results-1',
    'Alpha effect was observed in the treated cohort.', 100, 4);
  paragraph.legacyParagraphIds = legacyIds.proxy;
  assert.doesNotThrow(() => assert.equal(
    citations.migratePdfArticleChatEvidence({ locator: semanticLocator() },
      currentSemanticContext({ paragraphs: [paragraph] })).status,
    'invalid'));
});
