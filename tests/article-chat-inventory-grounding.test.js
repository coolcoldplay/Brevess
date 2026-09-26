const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/article-chat-tokenizer.js');
require('../core/article-chat-index.js');
require('../core/article-chat-retrieval.js');
require('../core/article-chat-memory.js');
require('../core/article-chat-citations.js');
require('../core/token-budget.js');
require('../core/article-chat-context-planner.js');
require('../core/article-chat-stream.js');
const { normalizeArticleChatInput, prepareArticleChatRequest,
  compileArticleChatPrompt, compileArticleChatJsonFallbackPrompt } = require('../core/article-chat.js');

// Synthetic source: repeated mentions are not new identities; distinct source
// variants and a methods-only item must remain distinguishable. No model calls.
const paragraphs = [
  { paragraphId: 'p-resource', sourceKey: 'resource:1', textHash: 'resource-hash',
    sectionTitle: 'Resources', sectionKind: 'methods', sectionPath: ['Resources'],
    text: 'Construct Alpha, source North, catalog N1. Construct Beta, source West, catalog W2.' },
  { paragraphId: 'p-method', sourceKey: 'method:1', textHash: 'method-hash',
    sectionTitle: 'Methods', sectionKind: 'methods', sectionPath: ['Methods'],
    text: 'Construct Alpha from North was used to label cells. Construct Gamma was used to record activity; no catalog number is stated.' },
  { paragraphId: 'p-tail', sourceKey: 'method:2', textHash: 'tail-hash',
    sectionTitle: 'Methods', sectionKind: 'methods', sectionPath: ['Methods'],
    text: 'Construct Alpha from North was also used for imaging. Construct Alpha from South has a distinct design; equivalence is not established.' }
];
const profile = { providerId: 'deepseek', config: { model: 'offline-fixture' }, contextWindowTokens: 65536 };
async function prepared(extra = {}) {
  const input = normalizeArticleChatInput({
    question: 'List all tools in this article and their purposes, one row per tool.', history: [],
    document: { title: 'Synthetic inventory', url: 'https://example.org/inventory',
      documentHash: 'synthetic-inventory', revision: 1, paragraphs }, ...extra
  });
  return { input, ...(await prepareArticleChatRequest(input, profile)) };
}
const compilers = [compileArticleChatPrompt, compileArticleChatJsonFallbackPrompt];
const requestPayload = prompt => JSON.parse(prompt.userPrompt.split('CHAT_REQUEST\n')[1]);

test('ordinary NDJSON and JSON fallback reconcile inventory identities across the whole answer', async () => {
  const { input, plan } = await prepared();
  for (const compile of compilers) {
    const { systemPrompt } = compile(input, plan);
    assert.match(systemPrompt, /reconcile identities across all answer blocks and tables/iu);
    assert.match(systemPrompt, /same explicitly identified item once/iu);
    assert.match(systemPrompt, /unless the question requests separate rows by condition or purpose/iu);
    assert.match(systemPrompt, /Preserve original names and meaningful construct\/source variants/iu);
    assert.match(systemPrompt, /never infer that two items are equivalent/iu);
  }
});

test('each inventory row requires support for its own entity and purposes, not another entity quote', async () => {
  const { input, plan } = await prepared();
  for (const compile of compilers) {
    const { systemPrompt } = compile(input, plan);
    assert.match(systemPrompt, /each factual inventory row.*that row's entity and each stated purpose/iu);
    assert.match(systemPrompt, /separate quotes when identity and purpose come from different passages/iu);
    assert.match(systemPrompt, /quote about another entity does not support the row/iu);
    assert.match(systemPrompt, /resource entry supports only the details it states/iu);
  }
});

test('the original full-source, no-catalog and no-guessed-alias rules remain without injected answers', async () => {
  const { input, plan } = await prepared();
  for (const compile of compilers) {
    const prompt = compile(input, plan);
    assert.match(prompt.systemPrompt, /check all supplied relevant prose, methods, resource tables, figure legends and supplementary material within the requested scope/u);
    assert.match(prompt.systemPrompt, /List an explicitly described tool even if no catalog number is supplied/u);
    assert.match(prompt.systemPrompt, /distinguish supplier rows from distinct tools/u);
    assert.doesNotMatch(prompt.systemPrompt, /Construct Alpha|Construct Beta|Construct Gamma|Nrsn2|GCaMP6s|retroAAV-Flp/u);
    for (const paragraph of paragraphs) assert.ok(prompt.userPrompt.includes(paragraph.text));
  }
});

test('selected-source guidance and native web system do not acquire ordinary inventory rules', async () => {
  const { input, plan } = await prepared();
  const selected = { ...input, selectionEvidence: { text: 'Selected source.', paragraphId: 'p-method', pageNumber: 1 } };
  for (const compile of compilers) {
    const { systemPrompt } = compile(selected, plan);
    assert.doesNotMatch(systemPrompt, /reconcile identities across all answer blocks|each factual inventory row/iu);
    assert.match(systemPrompt, /fixed.*\[\[S1\]\]/iu);
  }
  const web = compileArticleChatPrompt({ ...input, webSearch: { enabled: true } }, plan);
  assert.match(web.webSystemPrompt, /provider-native inline citations/iu);
  assert.doesNotMatch(web.webSystemPrompt, /reconcile identities across all answer blocks|each factual inventory row/iu);
});

test('guidance does not rewrite source context, completed blocks or index-cache identity', async () => {
  const { input, plan, index } = await prepared();
  const blocks = [{ blockId: 'done', markdown: '| Tool | Purpose |\n|---|---|\n| Construct Alpha | Label cells.[[1]] |',
    evidence: [{ marker: '1', paragraphId: 'p-method', sourceKey: 'method:1', textHash: 'method-hash' }] }];
  const saved = JSON.stringify(blocks);
  const options = { continuation: { blockIds: ['done'], blocks, formatRepair: true, summary: '' } };
  const ordinary = compileArticleChatPrompt(input, plan);
  for (const compile of compilers) {
    const prompt = compile(input, plan, options);
    assert.equal(prompt.stablePrefix, ordinary.stablePrefix);
    const completed = requestPayload(prompt).continuation.completed_blocks;
    assert.equal(completed[0].markdown, blocks[0].markdown);
    assert.deepEqual(completed[0].citation_sources, [{ marker: '1', paragraph_id: 'p-method', source_key: 'method:1', text_hash: 'method-hash' }]);
  }
  assert.equal(JSON.stringify(blocks), saved);
  const cached = await prepared({ cacheState: { indexId: index.indexId, stablePrefixChunkIds: plan.chunks.map(chunk => chunk.chunkId) } });
  assert.equal(cached.index.indexId, index.indexId);
  assert.equal(cached.plan.cacheDecision.status, 'reuse-stable-prefix');
  assert.equal(compileArticleChatPrompt(cached.input, cached.plan).stablePrefix, ordinary.stablePrefix);
});
