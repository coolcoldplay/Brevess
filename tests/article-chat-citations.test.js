const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeQuoteTextCanonical,
  extractQuoteTextTokens,
  findCanonicalTextMatchStart,
  countCanonicalTextMatches,
  findCanonicalQuoteSourceSpan,
  verifyArticleChatEvidence
} = require('../core/article-chat-citations.js');

function createSnapshot(overrides = {}) {
  return {
    revision: 7,
    paragraphs: [
      {
        paragraphId: 'p-results-1',
        sourceKey: 'results:block:1',
        textHash: 'hash-results-1',
        sectionTitle: 'Results',
        sectionPath: ['Results'],
        text: 'Heat stress significantly increased circulating IL-6 after 24 hours.'
      },
      {
        paragraphId: 'p-discussion-1',
        sourceKey: 'discussion:block:1',
        textHash: 'hash-discussion-1',
        sectionTitle: 'Discussion',
        sectionPath: ['Discussion'],
        text: 'The authors interpret circulating IL-6 as a candidate systemic signal.'
      }
    ],
    ...overrides
  };
}

test('citation text normalization joins layout hyphenation and soft hyphens', () => {
  assert.equal(
    normalizeQuoteTextCanonical('Neuro-\ninflammation and inter\u00adleukin signaling'),
    'neuroinflammation and interleukin signaling'
  );
});

test('citation text normalization handles NFKC, Unicode quotes, punctuation, and LaTeX styles', () => {
  const source = '“\uFF2E\uFF16-mA” regulates \\mathrm{TP53}; it does not increase.';

  assert.deepEqual(extractQuoteTextTokens(source), [
    'n6', 'ma', 'regulates', 'tp53', 'it', 'does', 'not', 'increase'
  ]);
  assert.equal(
    normalizeQuoteTextCanonical(source),
    'n6 ma regulates tp53 it does not increase'
  );
});

test('canonical citation matching counts occurrences and maps an exact quote back to source offsets', () => {
  const source = 'First result. “TP53-dependent rescue” was observed. TP53-dependent rescue was replicated.';
  const quote = 'TP53-dependent rescue was observed';

  assert.ok(findCanonicalTextMatchStart(source, quote) > 0);
  assert.equal(countCanonicalTextMatches(source, 'TP53-dependent rescue'), 2);

  const span = findCanonicalQuoteSourceSpan(source, quote);
  assert.ok(span);
  assert.equal(source.slice(span.start, span.end), '“TP53-dependent rescue” was observed.');
});

test('canonical citation matching removes invalid controls and rejects absent evidence', () => {
  assert.equal(normalizeQuoteTextCanonical('A\u0000B\u0007 C'), 'a b c');
  assert.equal(findCanonicalTextMatchStart('observed signal', 'invented result'), -1);
  assert.equal(findCanonicalQuoteSourceSpan('observed signal', 'invented result'), null);
});

test('keeps legacy HTML navigation compatible when only a stable paragraph id is supplied', () => {
  const result = verifyArticleChatEvidence({
    paragraphId: 'p-results-1',
    documentRevision: 7
  }, createSnapshot());

  assert.equal(result.status, 'verified');
  assert.equal(result.matchMethod, 'paragraph-id');
  assert.equal(result.candidateCount, 1);
  assert.equal(result.target.paragraphId, 'p-results-1');
  assert.equal(result.target.textHash, 'hash-results-1');
});

test('an identity-bearing citation cannot use tolerant matching for a forged quote', () => {
  const result = verifyArticleChatEvidence({
    paragraphId: 'p-removed',
    sourceKey: 'removed:block',
    textHash: 'removed-hash',
    sectionTitle: 'Results',
    quote: 'Heat stress markedly increased circulating IL-6 after 24 hours',
    documentRevision: 7
  }, createSnapshot());

  assert.equal(result.status, 'missing');
  assert.equal(result.candidateCount, 0);
  assert.equal(result.target, null);
});

test('verifies sourceKey plus textHash when a paragraph id has drifted', () => {
  const result = verifyArticleChatEvidence({
    paragraphId: 'p-old-results',
    sourceKey: 'results:block:1',
    textHash: 'hash-results-1',
    documentRevision: 7
  }, createSnapshot());

  assert.equal(result.status, 'verified');
  assert.equal(result.matchMethod, 'source-key-text-hash');
  assert.equal(result.target.paragraphId, 'p-results-1');
});

test('verifies only a unique normalized exact quote', () => {
  const result = verifyArticleChatEvidence({
    quote: 'HEAT stress significantly increased circulating IL-6 after 24 hours',
    documentRevision: 7
  }, createSnapshot());

  assert.equal(result.status, 'verified');
  assert.equal(result.matchMethod, 'unique-quote');
  assert.equal(result.candidateCount, 1);
  assert.equal(result.target.paragraphId, 'p-results-1');
  assert.ok(result.target.quoteSpan);
  assert.equal(
    createSnapshot().paragraphs[0].text.slice(
      result.target.quoteSpan.sourceStart,
      result.target.quoteSpan.sourceEnd
    ),
    'Heat stress significantly increased circulating IL-6 after 24 hours.'
  );
});

test('uses a unique section-scoped tolerant quote only after exact matching fails', () => {
  const result = verifyArticleChatEvidence({
    sectionTitle: 'Results',
    quote: 'Heat stress markedly increased circulating IL-6 after 24 hours',
    documentRevision: 7
  }, createSnapshot());

  assert.equal(result.status, 'verified');
  assert.equal(result.matchMethod, 'section-tolerant-quote');
  assert.equal(result.candidateCount, 1);
  assert.equal(result.target.paragraphId, 'p-results-1');
});

test('never chooses the first paragraph when a normalized quote is duplicated', () => {
  const duplicateText = 'The same supported sentence appears in two places.';
  const snapshot = createSnapshot({
    paragraphs: [
      {
        paragraphId: 'p-one', sourceKey: 'one', textHash: 'hash-one',
        sectionTitle: 'Results', sectionPath: ['Results'], text: duplicateText
      },
      {
        paragraphId: 'p-two', sourceKey: 'two', textHash: 'hash-two',
        sectionTitle: 'Discussion', sectionPath: ['Discussion'], text: duplicateText
      }
    ]
  });
  const result = verifyArticleChatEvidence({ quote: duplicateText }, snapshot);

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.reason, 'QUOTE_MATCHED_MULTIPLE_LOCATIONS');
  assert.equal(result.candidateCount, 2);
  assert.equal(result.target, null);
});

test('reports missing evidence without inventing a target', () => {
  const result = verifyArticleChatEvidence({
    quote: 'No paragraph in this article contains the invented statement.'
  }, createSnapshot());

  assert.equal(result.status, 'missing');
  assert.equal(result.candidateCount, 0);
  assert.equal(result.target, null);
});

test('rebinds stable evidence across a presentation-only document revision change', () => {
  const result = verifyArticleChatEvidence({
    paragraphId: 'p-results-1',
    documentRevision: 6
  }, createSnapshot());

  assert.equal(result.status, 'verified');
  assert.equal(result.matchMethod, 'paragraph-id');
  assert.equal(result.rebound, true);
  assert.equal(result.documentRevision, 7);
  assert.equal(result.target.paragraphId, 'p-results-1');
});

test('reports stale only when a changed revision cannot be uniquely rebound', () => {
  const result = verifyArticleChatEvidence({
    paragraphId: 'p-removed',
    quote: 'This sentence no longer exists in the refreshed article.',
    documentRevision: 6
  }, createSnapshot());

  assert.equal(result.status, 'stale');
  assert.equal(result.reason, 'DOCUMENT_REVISION_CHANGED');
  assert.equal(result.target, null);
});

test('document hash mismatch remains a hard cross-document boundary', () => {
  const result = verifyArticleChatEvidence({
    paragraphId: 'p-results-1',
    documentHash: 'sha256:old-document'
  }, createSnapshot({ documentHash: 'sha256:new-document' }));

  assert.equal(result.status, 'stale');
  assert.equal(result.reason, 'DOCUMENT_CHANGED');
  assert.equal(result.target, null);
});
