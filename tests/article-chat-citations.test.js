const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeQuoteTextCanonical,
  extractQuoteTextTokens,
  findCanonicalTextMatchStart,
  countCanonicalTextMatches,
  findCanonicalQuoteSourceSpan
} = require('../core/article-chat-citations.js');

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
