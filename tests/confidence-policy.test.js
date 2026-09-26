const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeConfidenceThreshold,
  filterAnnotationGroupsByConfidence
} = require('../core/confidence-policy.js');

test('normalizes confidence threshold to 0.50-0.95 with default 0.80', () => {
  assert.equal(normalizeConfidenceThreshold(undefined), 0.8);
  assert.equal(normalizeConfidenceThreshold('0.85'), 0.85);
  assert.equal(normalizeConfidenceThreshold(0.1), 0.5);
  assert.equal(normalizeConfidenceThreshold(1), 0.95);
  assert.equal(normalizeConfidenceThreshold('invalid'), 0.8);
});

test('filters category relations without discarding a surviving annotation group', () => {
  const result = filterAnnotationGroupsByConfidence([{
    paragraphId: 'p1', start: 0, end: 20, quote: 'Treatment caused loss.',
    categories: [
      { categoryId: 'causality', confidence: 0.82 },
      { categoryId: 'result', confidence: 0.76 }
    ]
  }], 0.8);
  assert.equal(result.annotations.length, 1);
  assert.deepEqual(result.annotations[0].categories.map(item => item.categoryId), ['causality']);
  assert.equal(result.hiddenCount, 1);
  assert.equal(result.keptCount, 1);
});

test('uses max of user threshold and 0.90 for inferred warnings', () => {
  const groups = [{
    paragraphId: 'p1', start: 0, end: 10, quote: 'Conclusion',
    categories: [
      {
        categoryId: 'key_result', confidence: 0.82,
        claimMode: 'explicit', minimumConfidence: 0.8
      },
      {
        categoryId: 'causal_overreach', confidence: 0.89,
        claimMode: 'inferred', minimumConfidence: 0.9
      }
    ]
  }];
  const filtered = filterAnnotationGroupsByConfidence(groups, 0.8);
  assert.deepEqual(
    filtered.annotations[0].categories.map(item => item.categoryId),
    ['key_result']
  );
  assert.equal(filtered.hiddenCount, 1);
});
