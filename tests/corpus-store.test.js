const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeFeedbackSample,
  createMemoryCorpusStore,
  exportCorpus,
  distillOfflineRules
} = require('../core/corpus-store.js');

test('keeps only a bounded, credential-free feedback record', () => {
  const sample = normalizeFeedbackSample({
    documentHash: 'doc-1',
    paragraphId: 'p1',
    sectionTitle: 'Discussion',
    contextBefore: 'A'.repeat(500),
    quote: 'This study is limited by its sample size.',
    contextAfter: 'B'.repeat(500),
    categoryId: 'limitation',
    confidence: 0.9,
    reasonZh: '明确局限',
    userAction: 'accepted',
    apiKey: 'must-not-survive',
    url: 'https://private.example',
    fullDocument: 'must-not-survive'
  });
  assert.equal(sample.contextBefore.length, 240);
  assert.equal(sample.contextAfter.length, 240);
  assert.equal(JSON.stringify(sample).includes('must-not-survive'), false);
  assert.equal('url' in sample, false);
  assert.equal('apiKey' in sample, false);
});

test('exports JSONL and CSV without hidden document metadata', () => {
  const sample = normalizeFeedbackSample({
    documentHash: 'doc-1', paragraphId: 'p1', quote: 'We found an effect.',
    categoryId: 'result', userAction: 'accepted'
  });
  const jsonl = exportCorpus([sample], 'jsonl');
  const csv = exportCorpus([sample], 'csv');
  assert.equal(JSON.parse(jsonl).quote, 'We found an effect.');
  assert.match(csv, /documentHash,paragraphId/);
  assert.doesNotMatch(`${jsonl}${csv}`, /apiKey|fullDocument|https:\/\//);
});

test('stores feedback and reports action counts', async () => {
  const store = createMemoryCorpusStore();
  await store.add(normalizeFeedbackSample({
    documentHash: 'd1', paragraphId: 'p1', quote: 'We found an effect.',
    categoryId: 'result', userAction: 'accepted'
  }));
  await store.add(normalizeFeedbackSample({
    documentHash: 'd2', paragraphId: 'p2', quote: 'No relation.',
    categoryId: 'result', userAction: 'rejected'
  }));
  assert.deepEqual(await store.stats(), { total: 2, accepted: 1, rejected: 1, corrected: 0, documents: 2 });
});

test('distills phrases only after support from three documents and respects rejection evidence', () => {
  const accepted = ['d1', 'd2', 'd3'].map((documentHash, index) => normalizeFeedbackSample({
    documentHash,
    paragraphId: `p${index}`,
    quote: `We found that treatment ${index} improved survival.`,
    categoryId: 'result',
    userAction: 'accepted'
  }));
  const pack = distillOfflineRules(accepted, {
    result: { name: '结果陈述', color: '#FFE66D' }
  });
  assert.ok(pack.result.patterns.includes('we found'));

  const rejected = normalizeFeedbackSample({
    documentHash: 'd4', paragraphId: 'p4', quote: 'We found no study result here.',
    categoryId: 'result', userAction: 'rejected'
  });
  const constrained = distillOfflineRules([...accepted, rejected], {
    result: { name: '结果陈述', color: '#FFE66D' }
  });
  assert.equal(constrained.result.patterns.includes('we found'), false);
});
