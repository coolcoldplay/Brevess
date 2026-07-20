const test = require('node:test');
const assert = require('node:assert/strict');
const { createBuiltInCategories } = require('../core/category-store.js');
const { createAdaptiveCategoryCatalog } = require('../core/adaptive-catalog.js');
require('../providers/provider-utils.js');
require('../core/prompt-compiler.js');
require('../core/chunker.js');
require('../core/result-validator.js');
require('../core/operation-control.js');
const { analyzeDocument } = require('../core/analysis-pipeline.js');

test('full-text pipeline waits at a pause checkpoint before sending the next request', async () => {
  const categories = createBuiltInCategories();
  let resume;
  let calls = 0;
  const gate = new Promise(resolve => { resume = resolve; });
  const pending = analyzeDocument({
    paragraphs: [{ paragraphId: 'p1', sectionTitle: 'Results', text: 'Treatment improved survival.' }],
    selectedCategories: [categories.result],
    waitIfPaused: () => gate,
    adapter: {
      async analyzeChunk(request) {
        calls += 1;
        return { paragraphs_reviewed: request.paragraphs.map(item => item.paragraphId), annotations: [] };
      }
    }
  });
  await Promise.resolve();
  assert.equal(calls, 0);
  resume();
  await pending;
  assert.equal(calls, 1);
});

test('full-text pipeline rejects cancellation before spending another provider request', async () => {
  const categories = createBuiltInCategories();
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(analyzeDocument({
    paragraphs: [{ paragraphId: 'p1', sectionTitle: 'Results', text: 'Treatment improved survival.' }],
    selectedCategories: [categories.result],
    signal: controller.signal,
    adapter: { async analyzeChunk() { calls += 1; return {}; } }
  }), error => error.code === 'CANCELLED');
  assert.equal(calls, 0);
});

test('sends only missing selected categories and returns merged annotations', async () => {
  const categories = createBuiltInCategories();
  const calls = [];
  const adapter = {
    async analyzeChunk(request) {
      calls.push(request.requestedCategoryIds);
      return {
        paragraphs_reviewed: request.paragraphs.map(item => item.paragraphId),
        annotations: [{
          paragraph_id: 'p1',
          quote: 'This study is limited by its small sample size.',
          occurrence: 0,
          category_id: 'limitation',
          confidence: 0.95,
          reason_zh: '明确说明样本量局限'
        }]
      };
    }
  };

  const result = await analyzeDocument({
    paragraphs: [{ paragraphId: 'p1', sectionTitle: 'Discussion', text: 'This study is limited by its small sample size.' }],
    selectedCategories: [categories.limitation, categories.future],
    cachedCategoryIds: new Set(['future']),
    adapter,
    maxChars: 500
  });

  assert.deepEqual(calls, [['limitation']]);
  assert.equal(result.annotations.length, 1);
  assert.deepEqual(result.analyzedCategoryIds, ['limitation']);
  assert.deepEqual(result.cachedCategoryIds, ['future']);
});

test('analyzes independent full-text chunks concurrently with a bounded worker pool', async () => {
  const categories = createBuiltInCategories();
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const paragraphs = Array.from({ length: 5 }, (_, index) => ({
    paragraphId: `p${index + 1}`,
    sectionTitle: 'Results',
    text: `${String(index + 1).repeat(90)}.`
  }));
  const result = await analyzeDocument({
    paragraphs,
    selectedCategories: [categories.result],
    maxChars: 100,
    concurrency: 3,
    adapter: {
      async analyzeChunk(request) {
        const chunkId = JSON.parse(request.userPrompt).chunk_id;
        calls.push(chunkId);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active -= 1;
        return {
          paragraphs_reviewed: request.paragraphs.map(item => item.paragraphId),
          annotations: []
        };
      }
    }
  });
  assert.equal(calls.length, 5);
  assert.equal(maxActive, 3);
  assert.equal(result.annotations.length, 0);
});

test('retries transient provider failures and reports chunk progress', async () => {
  const categories = createBuiltInCategories();
  let calls = 0;
  const progress = [];
  const adapter = {
    async analyzeChunk(request) {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('temporary'), { retryable: true });
      return {
        paragraphs_reviewed: request.paragraphs.map(item => item.paragraphId),
        annotations: []
      };
    }
  };
  await analyzeDocument({
    paragraphs: [{ paragraphId: 'p1', sectionTitle: 'Results', text: 'Treatment improved survival.' }],
    selectedCategories: [categories.result],
    adapter,
    maxRetries: 2,
    sleepImpl: async () => {},
    onProgress: event => progress.push(event)
  });
  assert.equal(calls, 2);
  assert.ok(progress.some(event => event.phase === 'retry' && event.attempt === 2));
  assert.ok(progress.some(event => event.phase === 'complete' && event.completedChunks === 1));
});

test('rechecks paragraphs the provider did not explicitly mark as reviewed', async () => {
  const categories = createBuiltInCategories();
  const calls = [];
  const paragraphs = [
    { paragraphId: 'p1', sectionTitle: 'Results', text: 'Treatment improved survival.' },
    { paragraphId: 'p2', sectionTitle: 'Results', text: 'Treatment reduced tumor burden.' }
  ];
  const result = await analyzeDocument({
    paragraphs,
    selectedCategories: [categories.result],
    maxChars: 500,
    adapter: {
      async analyzeChunk(request) {
        calls.push(request.paragraphs.map(item => item.paragraphId));
        const item = request.paragraphs[0];
        return {
          paragraphs_reviewed: [item.paragraphId],
          annotations: [{
            paragraph_id: item.paragraphId,
            quote: item.text,
            occurrence: 0,
            category_id: 'result',
            confidence: 0.95,
            reason_zh: 'Explicit finding.'
          }]
        };
      }
    }
  });

  assert.deepEqual(calls, [['p1', 'p2'], ['p2']]);
  assert.equal(result.annotations.length, 2);
});

test('runs one targeted repair pass when a model slot is not grounded in its quote', async () => {
  const categories = createAdaptiveCategoryCatalog();
  const paragraph = {
    paragraphId: 'p1', sectionTitle: 'Results',
    text: 'Higher C1q abundance was associated with fewer VGLUT2 terminals.'
  };
  const calls = [];
  const progress = [];
  const result = await analyzeDocument({
    paragraphs: [paragraph],
    selectedCategories: [categories.association_evidence],
    onProgress: event => progress.push(event),
    adapter: {
      async analyzeChunk(request) {
        const chunkId = JSON.parse(request.userPrompt).chunk_id;
        calls.push({ chunkId, categoryIds: request.requestedCategoryIds });
        const repaired = chunkId.endsWith(':grounding');
        return {
          chunk_id: chunkId,
          paragraphs_reviewed: [paragraph.paragraphId],
          annotations: [{
            annotation_id: repaired ? 'ann-repaired' : 'ann-invalid',
            relation_id: 'rel-1',
            category_id: 'association_evidence',
            claim_mode: 'explicit',
            highlight_quotes: [{
              paragraph_id: paragraph.paragraphId,
              quote: paragraph.text,
              occurrence: 0,
              role: 'association_statement'
            }],
            slots: [
              { name: 'variable_a', value: 'C1q abundance' },
              { name: 'variable_b', value: repaired ? 'VGLUT2 terminals' : 'microglial activation' },
              { name: 'association', value: 'associated with' }
            ],
            confidence: 0.95,
            reason_zh: '关系证据'
          }]
        };
      }
    }
  });

  assert.deepEqual(calls, [
    { chunkId: 'chunk-001', categoryIds: ['association_evidence'] },
    { chunkId: 'chunk-001:grounding', categoryIds: ['association_evidence'] }
  ]);
  assert.equal(result.annotations.length, 1);
  assert.ok(result.rejected.some(item => item.reason === 'SLOT_VALUE_NOT_GROUNDED'));
  assert.ok(progress.some(event => event.phase === 'grounding_retry' &&
    event.categoryIds.includes('association_evidence')));
});

test('uses provider retry guidance and a production-scale backoff schedule', async () => {
  const categories = createBuiltInCategories();
  const waits = [];
  const progress = [];
  let calls = 0;
  await analyzeDocument({
    paragraphs: [{ paragraphId: 'p1', sectionTitle: 'Results', text: 'Treatment improved survival.' }],
    selectedCategories: [categories.result],
    adapter: {
      async analyzeChunk(request) {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error('overloaded'), {
            code: 'PROVIDER_UNAVAILABLE', retryable: true, retryAfterMs: 7000
          });
        }
        if (calls === 2) {
          throw Object.assign(new Error('overloaded'), {
            code: 'PROVIDER_UNAVAILABLE', retryable: true
          });
        }
        return { paragraphs_reviewed: request.paragraphs.map(item => item.paragraphId), annotations: [] };
      }
    },
    sleepImpl: async delay => waits.push(delay),
    onProgress: event => progress.push(event)
  });
  assert.deepEqual(waits, [7000, 5000]);
  assert.ok(progress.some(event => event.phase === 'retry' &&
    event.waitMs === 7000 && event.errorCode === 'PROVIDER_UNAVAILABLE'));
});

test('splits only an output-truncated chunk and analyzes both smaller parts', async () => {
  const categories = createBuiltInCategories();
  const calls = [];
  const paragraphs = [
    { paragraphId: 'p1', sectionTitle: 'Results', text: 'A'.repeat(60) },
    { paragraphId: 'p2', sectionTitle: 'Results', text: 'B'.repeat(60) }
  ];
  const result = await analyzeDocument({
    paragraphs,
    selectedCategories: [categories.result],
    maxChars: 200,
    adapter: {
      async analyzeChunk(request) {
        const chunkId = JSON.parse(request.userPrompt).chunk_id;
        calls.push([chunkId, request.paragraphs.map(item => item.paragraphId)]);
        if (request.paragraphs.length > 1) {
          throw Object.assign(new Error('too much output'), { code: 'OUTPUT_TRUNCATED' });
        }
        return { paragraphs_reviewed: request.paragraphs.map(item => item.paragraphId), annotations: [] };
      }
    }
  });
  assert.deepEqual(calls, [
    ['chunk-001', ['p1', 'p2']],
    ['chunk-001a', ['p1']],
    ['chunk-001b', ['p2']]
  ]);
  assert.equal(result.annotations.length, 0);
});

test('splits a timed-out multi-paragraph chunk instead of retrying the same payload', async () => {
  const categories = createBuiltInCategories();
  const calls = [];
  const progress = [];
  const paragraphs = Array.from({ length: 4 }, (_, index) => ({
    paragraphId: `p${index + 1}`, sectionTitle: 'Results',
    text: `${String.fromCharCode(65 + index).repeat(45)}.`
  }));
  await analyzeDocument({
    paragraphs,
    selectedCategories: [categories.result],
    maxChars: 500,
    sleepImpl: async () => {},
    onProgress: event => progress.push(event),
    adapter: {
      async analyzeChunk(request) {
        const chunkId = JSON.parse(request.userPrompt).chunk_id;
        calls.push([chunkId, request.paragraphs.map(item => item.paragraphId)]);
        if (chunkId === 'chunk-001') {
          throw Object.assign(new Error('slow model'), {
            code: 'REQUEST_TIMEOUT', retryable: true
          });
        }
        return {
          paragraphs_reviewed: request.paragraphs.map(item => item.paragraphId),
          annotations: []
        };
      }
    }
  });
  assert.deepEqual(calls, [
    ['chunk-001', ['p1', 'p2', 'p3', 'p4']],
    ['chunk-001a', ['p1', 'p2']],
    ['chunk-001b', ['p2', 'p3', 'p4']]
  ]);
  assert.ok(progress.some(event =>
    event.phase === 'split' && event.errorCode === 'REQUEST_TIMEOUT'
  ));
});

test('retries a busy chunk once and then splits it when resources remain unavailable', async () => {
  const categories = createBuiltInCategories();
  const calls = [];
  const paragraphs = Array.from({ length: 3 }, (_, index) => ({
    paragraphId: `p${index + 1}`, sectionTitle: 'Results',
    text: `${String(index + 1).repeat(55)}.`
  }));
  await analyzeDocument({
    paragraphs,
    selectedCategories: [categories.result],
    maxChars: 500,
    sleepImpl: async () => {},
    adapter: {
      async analyzeChunk(request) {
        const chunkId = JSON.parse(request.userPrompt).chunk_id;
        calls.push(chunkId);
        if (chunkId === 'chunk-001') {
          throw Object.assign(new Error('busy'), {
            code: 'PROVIDER_UNAVAILABLE', retryable: true
          });
        }
        return {
          paragraphs_reviewed: request.paragraphs.map(item => item.paragraphId),
          annotations: []
        };
      }
    }
  });
  assert.deepEqual(calls, ['chunk-001', 'chunk-001', 'chunk-001a', 'chunk-001b']);
});

test('keeps semantic rejection details out of accepted pipeline annotations', async () => {
  const categories = createBuiltInCategories();
  const paragraph = {
    paragraphId: 'p1', sectionTitle: 'Results',
    text: 'As shown in Fig. 1, survival increased.'
  };
  const result = await analyzeDocument({
    paragraphs: [paragraph],
    selectedCategories: [categories.causality],
    adapter: {
      async analyzeChunk() {
        return {
          paragraphs_reviewed: ['p1'],
          annotations: [{
            paragraph_id: 'p1', quote: paragraph.text, occurrence: 0,
            category_id: 'causality', confidence: 0.96,
            reason_zh: 'Incorrect as causality'
          }]
        };
      }
    }
  });
  assert.equal(result.annotations.length, 0);
  assert.equal(result.rejected[0].reason, 'NON_CAUSAL_AMBIGUOUS_CUE');
});

test('keeps two paragraphs of context across mechanism chunk boundaries', async () => {
  const categories = createBuiltInCategories();
  const calls = [];
  const paragraphs = Array.from({ length: 7 }, (_, index) => ({
    paragraphId: `p${index + 1}`,
    sectionTitle: 'Results',
    text: `${String(index + 1).repeat(38)}.`
  }));
  await analyzeDocument({
    paragraphs,
    selectedCategories: [categories.result],
    adapter: {
      async analyzeChunk(request) {
        calls.push(request.paragraphs.map(item => item.paragraphId));
        return {
          paragraphs_reviewed: request.paragraphs.map(item => item.paragraphId),
          annotations: []
        };
      }
    },
    maxChars: 170,
    viewId: 'mechanism_chain'
  });
  assert.ok(calls.length > 1);
  assert.deepEqual(calls[1].slice(0, 2), calls[0].slice(-2));
});
