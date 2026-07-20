const test = require('node:test');
const assert = require('node:assert/strict');

const { createBuiltInCategories } = require('../core/category-store.js');
require('../providers/provider-utils.js');
require('../core/prompt-compiler.js');
require('../core/chunker.js');
require('../core/result-validator.js');
require('../core/cache-planner.js');
require('../core/analysis-pipeline.js');
const {
  createMemoryAnalysisCache,
  analyzeWithCategoryCache,
  hashDocument,
  ANALYSIS_CACHE_VERSIONS
} = require('../core/analysis-cache.js');

const paragraphs = [{
  paragraphId: 'p1',
  sectionTitle: 'Discussion',
  text: 'This study is limited by its small sample size.'
}];

test('uses adaptive prompt, classifier, and ledger cache versions', () => {
  assert.deepEqual(ANALYSIS_CACHE_VERSIONS, {
    prompt: '9', chunker: '4', classifier: '2', ledger: '2'
  });
});

test('document hash changes when a paragraph moves between major section kinds', async () => {
  const base = [{ paragraphId: 'p1', sectionTitle: 'Model performance', text: 'Result.' }];
  const resultHash = await hashDocument([{ ...base[0], sectionKind: 'results' }]);
  const discussionHash = await hashDocument([{ ...base[0], sectionKind: 'discussion' }]);
  assert.notEqual(resultHash, discussionHash);
});

test('document hash changes when heading ancestry changes', async () => {
  const base = {
    paragraphId: 'p1', sectionTitle: 'Immune axis', sectionKind: 'article', text: 'Evidence.'
  };
  const first = await hashDocument([{ ...base, headingLevel: 3, headingPath: [
    { level: 1, sectionId: 'sec-review', title: 'Review' },
    { level: 2, sectionId: 'sec-mechanisms', title: 'Mechanisms' },
    { level: 3, sectionId: 'sec-immune-axis', title: 'Immune axis' }
  ] }]);
  const second = await hashDocument([{ ...base, headingLevel: 2, headingPath: [
    { level: 1, sectionId: 'sec-review', title: 'Review' },
    { level: 2, sectionId: 'sec-immune-axis', title: 'Immune axis' }
  ] }]);
  assert.notEqual(first, second);
});

test('reuses cached category results without another provider call', async () => {
  const categories = createBuiltInCategories();
  const cacheStore = createMemoryAnalysisCache();
  let calls = 0;
  const adapter = {
    async analyzeChunk(request) {
      calls += 1;
      return {
        paragraphs_reviewed: ['p1'],
        annotations: [{
          paragraph_id: 'p1',
          quote: paragraphs[0].text,
          occurrence: 0,
          category_id: 'limitation',
          confidence: 0.95,
          reason_zh: '明确局限'
        }]
      };
    }
  };
  const input = {
    paragraphs,
    selectedCategories: [categories.limitation, categories.future],
    providerId: 'openai',
    model: 'gpt-5-mini',
    adapter,
    cacheStore
  };
  const first = await analyzeWithCategoryCache(input);
  const second = await analyzeWithCategoryCache(input);
  assert.equal(calls, 1);
  assert.deepEqual(first.analyzedCategoryIds, ['limitation', 'future']);
  assert.deepEqual(second.cachedCategoryIds, ['limitation', 'future']);
  assert.equal(second.annotations.length, 1);
});

test('does not reuse category cache entries across task profile signatures', async () => {
  const categories = createBuiltInCategories();
  const cacheStore = createMemoryAnalysisCache();
  let calls = 0;
  const input = {
    paragraphs, selectedCategories: [categories.limitation], providerId: 'openai',
    model: 'gpt-5-mini', cacheStore,
    adapter: { async analyzeChunk(request) {
      calls += 1;
      return { paragraphs_reviewed: request.paragraphs.map(item => item.paragraphId), annotations: [] };
    } }
  };
  await analyzeWithCategoryCache({ ...input, profileSignature: 'route-a' });
  await analyzeWithCategoryCache({ ...input, profileSignature: 'route-b' });
  assert.equal(calls, 2);
});

test('analyzes only a newly enabled category and merges prior cache', async () => {
  const categories = createBuiltInCategories();
  const cacheStore = createMemoryAnalysisCache();
  const requested = [];
  const adapter = {
    async analyzeChunk(request) {
      requested.push(request.requestedCategoryIds);
      return { paragraphs_reviewed: ['p1'], annotations: [] };
    }
  };
  const base = {
    paragraphs,
    providerId: 'openai',
    model: 'gpt-5-mini',
    adapter,
    cacheStore
  };
  await analyzeWithCategoryCache({ ...base, selectedCategories: [categories.limitation] });
  const expanded = await analyzeWithCategoryCache({
    ...base,
    selectedCategories: [categories.limitation, categories.result]
  });
  assert.deepEqual(requested, [['limitation'], ['result']]);
  assert.deepEqual(expanded.cachedCategoryIds, ['limitation']);
  assert.deepEqual(expanded.analyzedCategoryIds, ['result']);
});

test('checkpoints completed chunks and resumes at the failed chunk', async () => {
  const categories = createBuiltInCategories();
  const cacheStore = createMemoryAnalysisCache();
  const calls = [];
  let failedOnce = false;
  const input = {
    paragraphs: [
      { paragraphId: 'p1', sectionTitle: 'Results', text: 'A'.repeat(90) },
      { paragraphId: 'p2', sectionTitle: 'Results', text: 'B'.repeat(90) },
      { paragraphId: 'p3', sectionTitle: 'Results', text: 'C'.repeat(90) }
    ],
    selectedCategories: [categories.result],
    providerId: 'deepseek',
    model: 'deepseek-v4-flash',
    cacheStore,
    maxChars: 100,
    adapter: {
      async analyzeChunk(request) {
        const chunkId = JSON.parse(request.userPrompt).chunk_id;
        calls.push(chunkId);
        if (chunkId === 'chunk-002' && !failedOnce) {
          failedOnce = true;
          throw Object.assign(new Error('overloaded'), {
            code: 'PROVIDER_UNAVAILABLE', retryable: false
          });
        }
        return { paragraphs_reviewed: request.paragraphs.map(item => item.paragraphId), annotations: [] };
      }
    }
  };

  await assert.rejects(() => analyzeWithCategoryCache(input), /overloaded/);
  await analyzeWithCategoryCache(input);
  assert.deepEqual(calls, ['chunk-001', 'chunk-002', 'chunk-003', 'chunk-002']);
});

test('does not resume progress created for a different effective category definition', async () => {
  const categories = createBuiltInCategories();
  const cacheStore = createMemoryAnalysisCache();
  const calls = [];
  let failedOnce = false;
  const base = {
    paragraphs: [
      { paragraphId: 'p1', sectionTitle: 'Results', text: 'A'.repeat(90) },
      { paragraphId: 'p2', sectionTitle: 'Results', text: 'B'.repeat(90) },
      { paragraphId: 'p3', sectionTitle: 'Results', text: 'C'.repeat(90) }
    ],
    providerId: 'deepseek',
    model: 'deepseek-v4-flash',
    cacheStore,
    maxChars: 100,
    adapter: {
      async analyzeChunk(request) {
        const chunkId = JSON.parse(request.userPrompt).chunk_id;
        calls.push(chunkId);
        if (chunkId === 'chunk-002' && !failedOnce) {
          failedOnce = true;
          throw Object.assign(new Error('overloaded'), {
            code: 'PROVIDER_UNAVAILABLE', retryable: false
          });
        }
        return {
          paragraphs_reviewed: request.paragraphs.map(item => item.paragraphId),
          annotations: []
        };
      }
    }
  };
  const original = categories.result;
  const changed = structuredClone(original);
  changed.prompt.definition = 'A changed effective result definition.';
  changed.definition = changed.prompt.definition;

  await assert.rejects(() => analyzeWithCategoryCache({
    ...base,
    selectedCategories: [original]
  }), /overloaded/);
  await analyzeWithCategoryCache({ ...base, selectedCategories: [changed] });

  assert.deepEqual(calls, [
    'chunk-001', 'chunk-002', 'chunk-003',
    'chunk-001', 'chunk-002', 'chunk-003'
  ]);
});
