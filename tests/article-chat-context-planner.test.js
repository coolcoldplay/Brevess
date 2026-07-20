const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/article-chat-tokenizer.js');
require('../core/article-chat-index.js');
require('../core/article-chat-retrieval.js');
require('../core/token-budget.js');
require('../providers/provider-registry.js');
require('../core/article-chat-memory.js');
const { buildArticleChatIndex } = require('../core/article-chat-index.js');
const { buildArticleChatMemory } = require('../core/article-chat-memory.js');
const { planArticleChatContext } = require('../core/article-chat-context-planner.js');
const { getProviderContextWindowTokens } = require('../providers/provider-registry.js');

function makeIndex(count, chars = 600) {
  const records = Array.from({ length: count }, (_, index) => ({
    paragraphId: `p-${index + 1}`,
    sourceKey: `source-${index + 1}`,
    sourceIdentity: `stable-${index + 1}`,
    textHash: `hash-${index + 1}`,
    recordType: 'body',
    sectionId: index % 2 ? 'sec-results' : 'sec-discussion',
    sectionTitle: index % 2 ? 'Results' : 'Discussion',
    sectionKind: index % 2 ? 'results' : 'discussion',
    text: `${index % 2 ? 'Kinase rescue result' : 'Study limitation'} ${'x'.repeat(chars)}`
  }));
  return buildArticleChatIndex({
    key: `paper:${count}`, documentHash: 'paper', revision: count,
    paragraphs: records, typedRecords: records
  });
}

function profile(overrides = {}) {
  return {
    providerId: 'openai-compatible',
    config: { model: 'unknown-research-model' },
    tokenPolicy: { mode: 'auto', autoCap: null },
    contextWindowTokens: null,
    ...overrides
  };
}

test('uses conservative adapter defaults and a validated advanced context override', () => {
  assert.equal(getProviderContextWindowTokens('openai-compatible', {
    model: 'unknown-research-model'
  }), 32768);
  assert.ok(getProviderContextWindowTokens('openai', { model: 'gpt-5-mini' }) >= 65536);
  assert.equal(getProviderContextWindowTokens('openai-compatible', {
    model: 'unknown-research-model'
  }, 131072), 131072);
  assert.equal(getProviderContextWindowTokens('openai-compatible', {}, 4096), 32768);
});

test('chooses full context for a fitting first turn and retrieval for a constrained paper', async () => {
  const full = await planArticleChatContext({
    index: makeIndex(3, 300), query: '概括全文', profile: profile(), history: []
  });
  assert.equal(full.mode, 'full');
  assert.equal(full.chunks.length, makeIndex(3, 300).chunks.length);

  const retrieval = await planArticleChatContext({
    index: makeIndex(40, 900), query: 'kinase rescue 的结果是什么？',
    profile: profile({ contextWindowTokens: 8192 }), history: []
  });
  assert.equal(retrieval.mode, 'retrieval');
  assert.ok(retrieval.chunks.length < makeIndex(40, 900).chunks.length);
  assert.ok(retrieval.inputBudgetTokens.available > retrieval.estimatedInputTokens);
});

test('records all history ids, retrieves old turns, and reports a cache-aware follow-up decision', async () => {
  const history = Array.from({ length: 75 }, (_, index) => ({
    turnId: `turn-${index + 1}`,
    question: index === 1 ? 'rare astrocyte memory' : `question ${index + 1}`,
    answer: index === 1 ? 'N6-mA was measured in astrocytes.' : `answer ${index + 1}`
  }));
  const memory = buildArticleChatMemory(history);
  const index = makeIndex(12, 500);
  const plan = await planArticleChatContext({
    index,
    query: '之前 rare astrocyte memory 中的 N6-mA 是什么？',
    profile: profile(),
    history,
    memory,
    cacheState: { indexId: index.indexId, stablePrefixChunkIds: [index.chunks[0].chunkId] }
  });

  assert.equal(plan.completeHistoryIds.length, 75);
  assert.ok(plan.retrievedOldTurnIds.includes('turn-2'));
  assert.equal(plan.cacheDecision.status, 'reuse-stable-prefix');
  assert.ok(plan.localMemory.some(item => item.turnId === 'turn-2'));
});

test('fails locally when fixed prompt and output reservations cannot fit the context window', async () => {
  await assert.rejects(() => planArticleChatContext({
    index: makeIndex(3, 300),
    query: 'Explain the paper',
    profile: profile({ contextWindowTokens: 8192 }),
    history: [],
    systemTokens: 5000
  }), error => error?.code === 'CONTEXT_BUDGET_EXCEEDED');
});
