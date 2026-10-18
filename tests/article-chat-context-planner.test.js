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
const {
  getProviderContextWindowTokens,
  getProviderMaxOutputTokens
} = require('../providers/provider-registry.js');

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

test('derives DeepSeek V4 context and output capacity from the selected model', () => {
  const config = { model: 'deepseek-v4-pro' };
  assert.equal(getProviderContextWindowTokens('deepseek', config), 1_000_000);
  assert.equal(getProviderMaxOutputTokens('deepseek', config), 384_000);
});

test('plans DeepSeek V4 chat against its model capacity with a 90 percent safety window', async () => {
  const plan = await planArticleChatContext({
    index: makeIndex(40, 900),
    query: 'Explain the complete evidence chain and its limitations.',
    profile: profile({
      providerId: 'deepseek',
      config: { model: 'deepseek-v4-pro' },
      tokenPolicy: { mode: 'auto', autoCap: null }
    }),
    history: []
  });

  assert.equal(plan.contextWindowTokens, 1_000_000);
  assert.equal(plan.inputBudgetTokens.usableContextWindowTokens, 900_000);
  assert.equal(plan.outputBudgetTokens.ceiling, 384_000);
  assert.ok(plan.inputBudgetTokens.available < 900_000);
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

test('keeps a 64k article chat usable when the manual output maximum was set to 65536', async () => {
  const index = makeIndex(157, 600);
  const plan = await planArticleChatContext({
    index,
    query: '作者如何一步一步锁定介导攻击行为的神经元？',
    profile: profile({
      providerId: 'deepseek',
      config: { model: 'deepseek-v4-pro' },
      contextWindowTokens: 65536,
      tokenPolicy: { mode: 'manual', manualMax: 65536 }
    }),
    history: []
  });

  assert.equal(plan.mode, 'retrieval');
  assert.ok(plan.chunks.length > 0);
  assert.ok(plan.chunks.length <= 8);
  assert.ok(plan.outputBudgetTokens.initial <= 16384);
  assert.equal(plan.outputBudgetTokens.ceiling, 29440);
  assert.ok(plan.estimatedInputTokens < plan.inputBudgetTokens.available);
  assert.equal(plan.outputBudgetTokens.contextClamped, true);
});

test('fits at least one Chinese evidence chunk into an 8k automatic context budget', async () => {
  const records = [{
    paragraphId: 'p-long-cjk', sourceKey: 'source-long-cjk',
    sourceIdentity: 'stable-long-cjk', textHash: 'hash-long-cjk',
    recordType: 'body', sectionId: 'results', sectionTitle: 'Results',
    sectionKind: 'results', text: `攻击行为神经元${'实验结果'.repeat(700)}`
  }];
  const index = buildArticleChatIndex({
    key: 'paper-cjk:1', documentHash: 'paper-cjk', revision: 1,
    paragraphs: records, typedRecords: records
  });
  const plan = await planArticleChatContext({
    index,
    query: '攻击行为由哪些神经元介导？',
    profile: profile({ contextWindowTokens: 8192 }),
    history: []
  });

  assert.equal(plan.mode, 'retrieval');
  assert.ok(plan.chunks.length >= 1);
  assert.ok(plan.estimatedInputTokens <= plan.inputBudgetTokens.available);
  assert.ok(plan.outputBudgetTokens.initial <= 2048);
  assert.ok(plan.outputBudgetTokens.ceiling <= 4096);
});

test('does not raise a deliberately small manual article-chat output maximum', async () => {
  const plan = await planArticleChatContext({
    index: makeIndex(4, 300), query: 'kinase rescue result?',
    profile: profile({
      contextWindowTokens: 8192,
      tokenPolicy: { mode: 'manual', manualMax: 1024 }
    }),
    history: []
  });

  assert.equal(plan.outputBudgetTokens.initial, 1024);
  assert.equal(plan.outputBudgetTokens.ceiling, 1024);
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

test('reserves a deterministic context slot for required selected-page evidence', async () => {
  const index = makeIndex(40, 900);
  const required = index.chunks.at(-1);
  const plan = await planArticleChatContext({
    index,
    query: 'kinase rescue result',
    profile: profile({ contextWindowTokens: 8192 }),
    history: [],
    requiredChunkIds: [required.chunkId]
  });

  assert.ok(plan.chunks.some(chunk => chunk.chunkId === required.chunkId));
  assert.ok(plan.requiredChunkIds.includes(required.chunkId));
  assert.ok(plan.estimatedInputTokens <= plan.inputBudgetTokens.available);
});
