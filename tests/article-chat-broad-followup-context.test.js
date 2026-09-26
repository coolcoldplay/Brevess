const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/article-chat-tokenizer.js');
const { buildArticleChatIndex } = require('../core/article-chat-index.js');
require('../core/article-chat-retrieval.js');
require('../core/article-chat-memory.js');
require('../core/token-budget.js');
require('../providers/provider-registry.js');
const { planArticleChatContext, estimateArticleChatTokens } = require('../core/article-chat-context-planner.js');

// Public-paper equivalent, deliberately small and self-contained. The separate
// offline diagnosis matches the real 663 paragraphs and three saved replies.
const question = '列表格总结这篇文献用到的所有病毒工具,并且简要概括一下该病毒工具的使用目的。';
const history = [
  ['这篇论文的核心研究问题是什么?请简要回答并引用原文。', 'The study examines the aZI to VTA circuit in compulsive eating.'],
  ['作者使用了什么暴食障碍动物模型?请简要回答并引用原文。', 'Mice receive intermittent high-fat-diet access.'],
  ['aZI 到 VTA 环路的主要发现是什么?请简要回答并引用原文。', 'The circuit changes dopamine signaling and binge eating.']
].map(([question, markdown], i) => ({ turnId: `prior-${i + 1}`, question,
  answerBlocks: [{ blockId: `b${i}`, markdown }], summary: markdown }));
const profile = { providerId: 'deepseek', config: { model: 'deepseek-flash' }, tokenPolicy: { mode: 'auto' } };
function makeIndex({ count = 34, characters = 900 } = {}) {
  const records = Array.from({ length: count }, (_, i) => ({
    paragraphId: `p${i}`, sourceKey: `source-${i}`, textHash: `hash-${i}`,
    recordType: 'body', sectionId: `section-${i}`, sectionTitle: `Results ${i}`, sectionKind: 'results',
    text: `Circuit result ${i}. ${'The neuronal response changes during food intake. '.repeat(Math.ceil(characters / 49))}`
  }));
  records.push(
    { paragraphId: 'resources', sourceKey: 'resources', textHash: 'resources-hash', recordType: 'body',
      sectionId: 'resources', sectionTitle: 'STAR Methods — Key resources table', sectionKind: 'methods',
      text: 'AAV2/9-hSyn-DIO-ChR2(H134R)-EYFP. AAV2/9-hSyn-DIO-hM4D(Gi)-mCherry. AAV2/9-EF1a-DIO-GRAB_DA4.4.' },
    { paragraphId: 'purposes', sourceKey: 'purposes', textHash: 'purposes-hash', recordType: 'body',
      sectionId: 'purposes', sectionTitle: 'STAR Methods — AAV injection', sectionKind: 'methods',
      text: 'ChR2 supports optical activation. hM4Di supports chemogenetic inhibition. GRAB_DA4.4 reports dopamine signals.' }
  );
  return buildArticleChatIndex({ documentHash: 'public-paper-fixture', revision: 1, paragraphs: records, typedRecords: records });
}
const plan = (index, extra = {}) => planArticleChatContext({ index, query: question, history, profile, outputUnits: 8, ...extra });

test('fourth-turn all-virus question includes fitting full source and tail Methods/resources', async () => {
  const index = makeIndex();
  const result = await plan(index);
  assert.equal(result.mode, 'full');
  assert.deepEqual(result.chunks.map(c => c.chunkId), index.chunks.map(c => c.chunkId));
  assert.ok(result.chunks.some(c => c.paragraphIds.includes('resources')));
  assert.ok(result.chunks.some(c => c.paragraphIds.includes('purposes')));
  assert.deepEqual(result.includedHistoryIds, history.map(t => t.turnId));
  assert.equal(result.completeHistoryIds.length, 3);
  assert.ok(result.localMemory.length > 0);
  assert.ok(result.estimatedInputTokens <= result.inputBudgetTokens.available);
});

test('same broad question remains full with no history', async () => {
  assert.equal((await plan(makeIndex(), { history: [] })).mode, 'full');
});

test('a narrow follow-up still retrieves a subset and keeps prior history', async () => {
  const index = makeIndex();
  const result = await plan(index, { query: 'What is the hM4Di intervention?' });
  assert.equal(result.mode, 'retrieval');
  assert.ok(result.chunks.length < index.chunks.length);
  assert.deepEqual(result.completeHistoryIds, history.map(t => t.turnId));
});

test('broad follow-up falls back to retrieval when full source exceeds remaining budget', async () => {
  const index = makeIndex();
  const result = await plan(index, { profile: { ...profile, contextWindowTokens: 8192 } });
  assert.equal(result.mode, 'retrieval');
  assert.ok(result.chunks.length < index.chunks.length);
  assert.ok(result.estimatedInputTokens <= result.inputBudgetTokens.available);
});

test('full follow-up respects an already scoped index and explicit required evidence', async () => {
  const all = makeIndex();
  const scoped = { ...all, indexId: 'scoped-methods', chunks: all.chunks.filter(c => c.sectionKind === 'methods') };
  const result = await plan(scoped, { requiredChunkIds: [scoped.chunks[1].chunkId] });
  assert.equal(result.mode, 'full');
  assert.deepEqual(new Set(result.chunks.map(c => c.chunkId)), new Set(scoped.chunks.map(c => c.chunkId)));
  assert.equal(result.chunks[0].chunkId, scoped.chunks[1].chunkId);
  assert.ok(result.chunks.every(c => c.sectionKind === 'methods'));
});

test('publication metadata and history reservations remain counted before full source selection', async () => {
  const index = makeIndex();
  const metadata = { authors: [{ name: 'Public author', corresponding: true, affiliations: ['Research institute'] }], notes: [] };
  const result = await plan(index, { metadata });
  assert.equal(result.mode, 'full');
  assert.deepEqual(result.publicationMetadata, metadata);
  assert.ok(result.metadataTokens > 0);
  const sourceTokens = result.chunks.reduce((n, c) => n + estimateArticleChatTokens(c.text) + 8, 0);
  assert.ok(result.estimatedInputTokens > sourceTokens + result.metadataTokens);
  assert.ok(result.estimatedInputTokens <= result.inputBudgetTokens.available);
});
