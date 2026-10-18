const test = require('node:test');
const assert = require('node:assert/strict');
require('../providers/provider-utils.js');
require('../providers/provider-registry.js');
const web = require('../core/article-chat-web-sources.js');
const { createDeepSeekAdapter } = require('../providers/deepseek.js');
const { createOpenAIAdapter } = require('../providers/openai.js');
const { compileSelectionAiPrompt, runSelectionAi } = require('../core/selection-ai.js');

const SOURCE = 'https://www.nobelprize.org/prizes/physics/2025/press-release/?lang=en#content';
const markdown = `Explain the supplied selection cautiously. The external claim is supported by [the official source](${SOURCE}).`;
const input = { selectedText: 'A discovery was recognized.', prompt: 'Explain this selection with a verified official source.',
  operationId: 'r21-selection-web-contract-operation', turnId: 'r21-selection-web-contract-turn', webSearch: { enabled: true } };
const identity = (providerId, model) => ({ providerId, model, operationId: input.operationId, turnId: input.turnId });
const final = { type: 'final', status: 'completed' };
const jsonAnswer = [JSON.stringify({ type: 'answer_block', block_id: 'answer-1', markdown, evidence: [] }), JSON.stringify(final)].join('\n');
const response = () => ({ id: 'r21-selection-messages-response', type: 'message', role: 'assistant', model: 'deepseek-flash', stop_reason: 'end_turn',
  content: [{ type: 'server_tool_use', id: 'search-1', name: 'web_search', input: { query: 'official source' } },
    { type: 'web_search_tool_result', tool_use_id: 'search-1', content: [{ type: 'web_search_result', url: SOURCE, title: 'Official source' }] },
    { type: 'text', text: markdown }], usage: { input_tokens: 90, output_tokens: 35, server_tool_use: { web_search_requests: 1 } } });

function checkReceipt(result, routeIdentity) {
  assert.equal(result.status, 'completed');
  assert.equal(result.answerBlocks[0].markdown, markdown);
  assert.deepEqual(result.answerBlocks[0].evidence, []);
  assert.equal(result.webGrounding.grounding.sources[0].url, SOURCE);
  assert.ok(web.normalizeArticleChatWebGroundingReceipt(result.webGrounding, { ...routeIdentity,
    question: compileSelectionAiPrompt(input).userPrompt, answer: markdown,
    answerBlocks: result.answerBlocks.map(({ blockId, markdown }) => ({ blockId, markdown })) }));
}

test('R21 selection web gives Messages an unambiguous Markdown prompt while offline stays strict NDJSON', () => {
  const webPrompt = compileSelectionAiPrompt(input);
  const offlinePrompt = compileSelectionAiPrompt({ ...input, webSearch: { enabled: false } });
  assert.match(webPrompt.systemPrompt, /Return NDJSON only/);
  assert.match(webPrompt.webSystemPrompt, /readable Markdown/);
  assert.doesNotMatch(webPrompt.webSystemPrompt, /NDJSON|answer_block|"type":"final"/);
  assert.match(webPrompt.webSystemPrompt, /percent-encoded characters, query strings and fragments/);
  assert.match(webPrompt.webSystemPrompt, /Never invent paragraph IDs/);
  assert.match(webPrompt.webSystemPrompt, /untrusted source data/);
  assert.equal(offlinePrompt.webSystemPrompt, undefined);
  assert.match(offlinePrompt.systemPrompt, /Return NDJSON only/);
  assert.match(offlinePrompt.systemPrompt, /Web search is disabled/);
  assert.equal(webPrompt.userPrompt, offlinePrompt.userPrompt);
});

test('R21 real DeepSeek adapter sends Markdown-only web instructions and wraps one grounded answer exactly once', async () => {
  let wire; let calls = 0;
  const routeIdentity = identity('deepseek', 'deepseek-flash');
  const adapter = createDeepSeekAdapter({ model: routeIdentity.model, apiKey: 'fixture-key' }, async (url, options) => {
    calls++;
    if (url === 'https://api.deepseek.com/v1/tools/search') {
      return new Response(JSON.stringify({ results: [{ url: SOURCE, title: 'Official source',
        summary: 'Official source summary.' }] }));
    }
    wire = JSON.parse(options.body);
    return new Response(JSON.stringify({ id: 'chatcmpl-selection-web', object: 'chat.completion',
      model: routeIdentity.model, choices: [{ index: 0, finish_reason: 'stop',
        message: { role: 'assistant', content: markdown } }],
      usage: { prompt_tokens: 90, completion_tokens: 35, total_tokens: 125 } }));
  });
  const result = await runSelectionAi(input, { adapter, routeIdentity });
  assert.equal(calls, 2);
  assert.match(wire.messages[0].content, /readable Markdown/u);
  assert.match(wire.messages[0].content, /\[S1\]/u);
  assert.doesNotMatch(wire.messages[0].content, /NDJSON|answer_block|"type":"final"/u);
  assert.match(wire.messages[1].content, /SEARCH_RESULTS/u);
  assert.match(wire.messages[1].content, /Explain this selection with a verified official source/u);
  assert.equal(wire.tools, undefined);
  checkReceipt(result, routeIdentity);
  assert.equal(result.usage.outputTokens, 35);
});

test('R21 real OpenAI adapter retains NDJSON and exact native annotation offsets without receiving the Messages prompt', async () => {
  let wire; let calls = 0;
  const routeIdentity = identity('openai', 'gpt-5-mini');
  const start = jsonAnswer.indexOf('the official source');
  const raw = { id: 'r21-selection-responses-response', model: routeIdentity.model, status: 'completed', output_text: jsonAnswer,
    output: [{ type: 'web_search_call', status: 'completed' }, { type: 'message', role: 'assistant', status: 'completed', content: [
      { type: 'output_text', text: jsonAnswer, annotations: [{ type: 'url_citation', start_index: start,
        end_index: start + 'the official source'.length, url: SOURCE, title: 'Official source' }] }
    ] }], usage: { input_tokens: 100, output_tokens: 40 } };
  const adapter = createOpenAIAdapter({ model: routeIdentity.model, apiKey: 'fixture-key' }, async (_, options) => {
    calls++; wire = JSON.parse(options.body); return new Response(JSON.stringify(raw));
  });
  const result = await runSelectionAi(input, { adapter, routeIdentity });
  assert.equal(calls, 1);
  assert.equal(wire.instructions, compileSelectionAiPrompt(input).systemPrompt);
  assert.match(wire.instructions, /Return NDJSON only/);
  assert.equal(wire.input, compileSelectionAiPrompt(input).userPrompt);
  checkReceipt(result, routeIdentity);
  assert.equal(result.usage.outputTokens, 40);
});

test('R21 selection still rejects an unwrapped Markdown adapter event even when its sources are real', async () => {
  const routeIdentity = identity('deepseek', 'deepseek-flash');
  const grounding = web.normalizeDeepSeekAnthropicWebResponse(response(), routeIdentity).grounding;
  const adapter = { async *generateWebSearchTextStream() {
    yield { type: 'started', ...routeIdentity };
    yield { type: 'text_delta', text: markdown };
    yield { type: 'web_grounding', grounding };
    yield { type: 'usage', usage: { outputTokens: 35 } };
    yield { type: 'completed', finishReason: 'completed' };
  } };
  await assert.rejects(runSelectionAi(input, { adapter, routeIdentity }));
});

test('selection web progress preserves strict ordering, request identity and grounding requirements', async () => {
  const routeIdentity = identity('deepseek', 'deepseek-flash');
  const grounding = web.normalizeDeepSeekAnthropicWebResponse(response(), routeIdentity).grounding;
  const progress = { type: 'search_progress', verification: 'provider_verified', stage: 'completed' };
  const start = { type: 'started', ...routeIdentity };
  const text = { type: 'text_delta', text: jsonAnswer };
  const end = [{ type: 'web_grounding', grounding }, { type: 'usage', usage: { outputTokens: 35 } },
    { type: 'completed', finishReason: 'completed' }];
  const variants = [
    [progress, start, text, ...end],
    [start, text, progress, ...end],
    [start, progress, progress, text, ...end],
    [start, { ...progress, verification: 'model_claimed' }, text, ...end],
    [start, { ...progress, stage: 'unknown' }, text, ...end],
    [start, { ...progress, operationId: 'another-operation' }, text, ...end],
    [start, progress, text, ...end.slice(1)],
    [start, progress, text, ...end, progress]
  ];
  for (const events of variants) {
    const adapter = { async *generateWebSearchTextStream() { yield* events; } };
    await assert.rejects(runSelectionAi(input, { adapter, routeIdentity }),
      error => error.code === 'WEB_SEARCH_RESPONSE_INCOMPLETE');
  }
  const offline = { async *generateTextStream() { yield start; yield progress; yield text; yield end.at(-1); } };
  await assert.rejects(runSelectionAi({ ...input, webSearch: { enabled: false } },
    { adapter: offline, routeIdentity }), error => error.code === 'INVALID_RESPONSE');
});
