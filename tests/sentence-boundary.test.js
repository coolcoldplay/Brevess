const test = require('node:test');
const assert = require('node:assert/strict');
const { findScientificSentenceBounds } = require('../core/sentence-boundary.js');

test('keeps a scientific sentence intact across CD8+T and figure abbreviations', () => {
  const text = 'Neoadjuvant therapy increased infiltration of CD8+T cells (Fig. 2a,b). ' +
    'When comparing samples, exposure increased infiltrating CD8+T cells as well as ' +
    'upregulation of LAG-3 and PD-1 expression (Fig. 2b).';
  const matchStart = text.indexOf('as well as');
  const bounds = findScientificSentenceBounds(text, matchStart, matchStart + 'as well as'.length);
  assert.equal(text.slice(bounds.start, bounds.end),
    'When comparing samples, exposure increased infiltrating CD8+T cells as well as ' +
    'upregulation of LAG-3 and PD-1 expression (Fig. 2b).');
});

test('does not split at common abbreviations or decimal points', () => {
  const text = 'At 3.5 mg, responses increased, e.g. in cohort A, because treatment was effective. Next sentence.';
  const matchStart = text.indexOf('because');
  const bounds = findScientificSentenceBounds(text, matchStart, matchStart + 'because'.length);
  assert.equal(text.slice(bounds.start, bounds.end),
    'At 3.5 mg, responses increased, e.g. in cohort A, because treatment was effective.');
});

test('supports Chinese sentence terminators', () => {
  const text = '前一句。治疗导致细胞数量下降，因此支持该机制。下一句。';
  const matchStart = text.indexOf('因此');
  const bounds = findScientificSentenceBounds(text, matchStart, matchStart + 2);
  assert.equal(text.slice(bounds.start, bounds.end), '治疗导致细胞数量下降，因此支持该机制。');
});
