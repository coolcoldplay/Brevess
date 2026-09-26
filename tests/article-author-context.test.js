const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../core/article-chat-tokenizer.js');
require('../core/article-chat-index.js');
require('../core/article-chat-retrieval.js');
require('../core/article-chat-memory.js');
require('../core/article-chat-citations.js');
require('../core/token-budget.js');
require('../providers/provider-registry.js');
require('../providers/provider-utils.js');
require('../core/article-chat-context-planner.js');
require('../core/article-chat-stream.js');
require('../core/article-chat-web-sources.js');
const { createDeepSeekAdapter } = require('../providers/deepseek.js');
const { createOpenAIAdapter } = require('../providers/openai.js');
const { normalizeArticleChatInput, prepareArticleChatRequest, compileArticleChatPrompt, runArticleChat } = require('../core/article-chat.js');
const metadata = {
  sourceUrl: 'https://example.org/paper',
  authors: [
    { name: 'Ada Example', affiliations: ['Institute A'], corresponding: true, source: 'json-ld' },
    { name: 'Bo Example', affiliations: ['Institute B', 'Institute C'], corresponding: true, source: 'microdata' },
    { name: 'Cy Example', affiliations: [], corresponding: null, source: 'citation_author' }
  ],
  notes: [{ text: 'Correspondence: Ada Example and Bo Example', source: '#cor1', kind: 'correspondence' }],
  truncated: false
};
const profile = { providerId: 'deepseek', config: { model: 'deepseek-v4-pro' }, tokenPolicy: {}, contextWindowTokens: 8192 };
function input(extra = {}) { return normalizeArticleChatInput({ question: '请核实通讯作者的机构与前期研究', webSearch: { enabled: false }, document: {
  title: 'Fixture paper', url: metadata.sourceUrl, documentHash: 'fixture-hash', revision: 1,
  paragraphs: Array.from({ length: 70 }, (_, i) => ({ paragraphId: `p-${i}`, sourceKey: `source-${i}`, textHash: `hash-${i}`, sectionTitle: 'Results', text: `Experiment ${i}: ${'Treatment increased the signal after two hours. '.repeat(30)}` })),
  authorMetadata: metadata, authorMetadataStatus: 'available', ...extra
} }); }
function payload(prompt) { return JSON.parse(prompt.stablePrefix.slice('ARTICLE_CONTEXT\n'.length)); }

test('QA-002 author mappings and multiple correspondents survive normalization into the prompt', async () => {
  const request = input(); const prepared = await prepareArticleChatRequest(request, profile);
  const article = payload(compileArticleChatPrompt(request, prepared.plan)).article;
  assert.deepEqual(article.publication_metadata.authors.map(a => [a.name, a.affiliations, a.corresponding]), metadata.authors.map(a => [a.name, a.affiliations, a.corresponding]));
  assert.equal(article.publication_metadata.sourceUrl, metadata.sourceUrl);
  assert.ok(prepared.plan.chunks.length < 70, 'long article really uses bounded context');
  assert.ok(prepared.plan.metadataTokens > 0, 'metadata is charged to the prompt budget');
});
test('QA-002 explicit section scope excludes document-wide author metadata even if input carries it', async () => {
  const request = input({ authorMetadataStatus: 'excluded-by-section-scope' });
  const prepared = await prepareArticleChatRequest(request, profile);
  const article = payload(compileArticleChatPrompt(request, prepared.plan)).article;
  assert.equal(article.publication_metadata, undefined);
  assert.equal(article.publication_metadata_status, 'excluded-by-section-scope');
  assert.equal(prepared.plan.metadataTokens, 0);
});
test('QA-002 metadata is bounded, only explicit true marks correspondence, input is unchanged', () => {
  const original = JSON.stringify(metadata);
  const request = input({ authorMetadata: { ...metadata, authors: Array.from({ length: 1000 }, (_, i) => ({ name: `Author ${i}`, corresponding: 'true', affiliations: ['A'.repeat(9000)] })) } });
  assert.ok(JSON.stringify(request.document.authorMetadata).length <= 12500);
  assert.equal(request.document.authorMetadata.truncated, true);
  assert.equal(request.document.authorMetadata.authors[0].corresponding, null);
  assert.equal(JSON.stringify(metadata), original);
});
test('QA-002 publication metadata stays untrusted and cannot prove prior-work relationships or current affiliations', async () => {
  const request = input(); const { plan } = await prepareArticleChatRequest(request, profile);
  const prompt = compileArticleChatPrompt(request, plan);
  assert.match(prompt.systemPrompt, /untrusted data/);
  assert.match(prompt.systemPrompt, /same.name|name alone/i);
  assert.match(prompt.systemPrompt, /prior.work|preliminary work/i);
  assert.match(prompt.systemPrompt, /current affiliation/i);
  assert.match(prompt.systemPrompt, /explicit.*correspond|correspond.*explicit/i);
});
test('QA-002 unavailable author metadata has an accurate state without fabricated fields', async () => {
  const request = input({ authorMetadata: null, authorMetadataStatus: 'unavailable' });
  const { plan } = await prepareArticleChatRequest(request, profile);
  const article = payload(compileArticleChatPrompt(request, plan)).article;
  assert.equal(article.publication_metadata, undefined);
  assert.equal(article.publication_metadata_status, 'unavailable');
});
test('QA-002 production content context helper respects section scope before extracting metadata', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const start = source.indexOf('function currentArticleChatAuthorContext(');
  assert.ok(start >= 0);
  const end = source.indexOf('\nasync function runArticleChatTurn', start);
  let calls = 0;
  const helper = Function('SciLLM', 'document', `return (${source.slice(start, end).trim()});`)({ extractArticleAuthorMetadata: () => { calls++; return metadata; } }, {});
  assert.equal(helper({ resolution: { requested: true } }).authorMetadataStatus, 'excluded-by-section-scope');
  assert.equal(calls, 0);
  assert.deepEqual(helper({ resolution: { requested: false } }).authorMetadata, metadata);
  assert.equal(calls, 1);
  assert.match(source.slice(end, source.indexOf('\nfunction ', end + 1)), /\.\.\.currentArticleChatAuthorContext\(scopedContext\)/u);
});
test('QA-002 author evidence reaches a supported web provider and returns only grounded sources', async () => {
  let wire, wireUrl;
  const markdown = '机构见本文作者元信息；未能核实前期工作。';
  const text = [
    JSON.stringify({ type: 'answer_block', block_id: 'authors', markdown, evidence: [] }),
    JSON.stringify({ type: 'turn_summary', summary: '作者机构来源为本文元信息。' }),
    JSON.stringify({ type: 'final', status: 'completed' })
  ].join('\n');
  const webProfile = { ...profile, providerId: 'openai', config: { model: 'gpt-5-mini' } };
  const adapter = createOpenAIAdapter({ apiKey: 'fixture', model: 'gpt-5-mini' }, async (url, options) => {
    wireUrl = url;
    wire = JSON.parse(options.body);
    return new Response(JSON.stringify({ id: 'fixture-author-response', status: 'completed', output_text: text,
      output: [{ type: 'web_search_call', status: 'completed', id: 'fixture-author-search' },
        { type: 'message', role: 'assistant', status: 'completed', phase: 'final_answer',
          content: [{ type: 'output_text', text, annotations: [{ type: 'url_citation',
            start_index: text.indexOf(markdown), end_index: text.indexOf(markdown) + markdown.length,
            url: metadata.sourceUrl, title: 'Fixture paper author metadata' }] }] }],
      usage: { input_tokens: 30, output_tokens: 20 } }));
  });
  const request = { ...input(), webSearch: { enabled: true }, turnId: 'fixture-author-turn', operationId: 'fixture-author-op' };
  const result = await runArticleChat({ input: request, profile: webProfile, adapter,
    routeIdentity: { providerId: 'openai', model: 'gpt-5-mini', turnId: 'fixture-author-turn', operationId: 'fixture-author-op' } });
  const body = JSON.stringify(wire);
  assert.equal(wireUrl, 'https://api.openai.com/v1/responses');
  assert.match(body, /Ada Example/); assert.match(body, /Institute B/); assert.match(body, /Correspondence/);
  assert.match(wire.instructions, /prior.work|preliminary work/i);
  assert.deepEqual(wire.tools, [{ type: 'web_search' }]);
  assert.deepEqual(wire.tool_choice, { type: 'web_search' });
  assert.equal(result.message.answer, markdown);
  assert.equal(result.message.webSearch.searched, true);
  assert.equal(result.message.webGrounding.grounding.sources[0].url, metadata.sourceUrl);
  assert.deepEqual(result.message.webGrounding.grounding.sources[0].blockIds, ['authors']);
});

test('QA-002 author metadata cannot bypass DeepSeek web-search turn and operation identity', async () => {
  let calls = 0;
  const adapter = createDeepSeekAdapter({ apiKey: 'fixture', model: 'deepseek-flash' }, async () => {
    calls++; throw new Error('unbound web search must not dispatch');
  });
  const identity = { providerId: 'deepseek', model: 'deepseek-flash',
    turnId: 'fixture-author-turn', operationId: 'fixture-author-op' };
  const request = { ...input(), webSearch: { enabled: true },
    turnId: identity.turnId, operationId: identity.operationId };
  for (const routeIdentity of [undefined, { ...identity, turnId: 'another-turn' },
    { ...identity, operationId: 'another-operation' }]) {
    await assert.rejects(() => runArticleChat({ input: request,
      profile: { ...profile, config: { model: 'deepseek-flash' } }, adapter, routeIdentity }),
    { code: 'WEB_SEARCH_GROUNDING_MISSING' });
  }
  assert.equal(calls, 0);
});

test('QA-002 large author metadata cannot block ordinary chat on an 8K model', async () => {
  const request = input({ authorMetadata: { ...metadata, authors: Array.from({ length: 120 }, (_, i) => ({ name: `Author ${i}`, affiliations: ['Long institute title '.repeat(40)], corresponding: i === 119 })) } });
  const before = JSON.stringify(request.document.authorMetadata);
  const { plan } = await prepareArticleChatRequest(request, profile);
  const article = payload(compileArticleChatPrompt(request, plan)).article;
  assert.ok(plan.chunks.length > 0);
  assert.ok(plan.metadataTokens <= Math.floor(plan.inputBudgetTokens.available * 0.25));
  assert.equal(article.publication_metadata.truncated, true);
  assert.equal(article.publication_metadata.authors.find(author => author.name === 'Author 119')?.corresponding, true);
  assert.equal(JSON.stringify(request.document.authorMetadata), before);
});
test('QA-002 author source preserves article IDs without leaking URL credentials or tokens', async () => {
  const request = input({ authorMetadata: { ...metadata, sourceUrl: 'https://user:secret@example.org/article?id=123&token=private-token&utm_source=tracker' } });
  const { plan } = await prepareArticleChatRequest(request, profile);
  const article = payload(compileArticleChatPrompt(request, plan)).article;
  assert.equal(article.publication_metadata.sourceUrl, 'https://example.org/article?id=123');
});
test('QA-002 offline metadata answers need no fabricated paragraph citations', async () => {
  let calls = 0;
  const markdown = '通讯作者机构来自[本文作者信息](https://example.org/paper)，尚未核实前期工作。';
  const adapter = { generateTextStream(request) {
    calls++; assert.match(request.systemPrompt, /paragraph-marker requirement does not apply/);
    assert.match(request.userPrompt, /Ada Example/);
    return (async function* () { yield { type: 'text_delta', text: [JSON.stringify({ type: 'answer_block', block_id: 'authors', markdown, evidence: [] }), JSON.stringify({ type: 'turn_summary', summary: '作者机构来源为本文元信息。' }), JSON.stringify({ type: 'final', status: 'completed' }), ''].join('\n') }; yield { type: 'completed', finishReason: 'stop' }; })();
  } };
  const result = await runArticleChat({ input: input(), profile, adapter });
  assert.equal(calls, 1); assert.equal(result.message.answer, markdown);
  assert.deepEqual(result.message.evidence, []);
});
