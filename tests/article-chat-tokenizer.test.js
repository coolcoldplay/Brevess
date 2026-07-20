const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeRetrievalText,
  tokenizeRetrievalText,
  tokenizeRetrievalQuery
} = require('../core/article-chat-tokenizer.js');

test('retrieval tokenizer emits adjacent CJK bigrams without losing complete scientific terms', () => {
  const tokens = tokenizeRetrievalQuery('慢性热应激中的 ATAC-seq、CD8+T 和 N6-mA 信号');

  assert.ok(tokens.includes('慢性'));
  assert.ok(tokens.includes('热应'));
  assert.ok(tokens.includes('应激'));
  assert.ok(tokens.includes('atac-seq'));
  assert.ok(tokens.includes('cd8+t'));
  assert.ok(tokens.includes('n6-ma'));
});

test('retrieval tokenizer preserves compounds, genes, doses, time points, and negation', () => {
  const tokens = tokenizeRetrievalText(
    'TP53-dependent cells received 10-mg treatment at the 24-h time point, but did not show no response.'
  );

  for (const token of ['tp53-dependent', 'tp53', '10-mg', '24-h', 'not', 'no']) {
    assert.ok(tokens.includes(token), `missing token: ${token}`);
  }
});

test('retrieval normalization applies NFKC and removes soft hyphens and spacing noise', () => {
  assert.equal(
    normalizeRetrievalText('  ＡＴＡＣ‐seq\u00ad  “Signal”\r\n response  '),
    'atac-seq "signal" response'
  );
});

test('retrieval tokenizer respects a deterministic token cap', () => {
  assert.deepEqual(tokenizeRetrievalQuery('alpha beta gamma delta', 2), ['alpha', 'beta']);
});
