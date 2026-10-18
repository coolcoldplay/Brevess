const test = require('node:test');
const assert = require('node:assert/strict');
require('../providers/provider-utils.js');
const web = require('../core/article-chat-web-sources.js');
const { createDeepSeekAdapter } = require('../providers/deepseek.js');
// Public one-call response captured 2026-09-26. No credentials or article data.
const captured = require('./fixtures/qa017-deepseek-anthropic-search-response.json');
const identity = { providerId: 'deepseek', model: 'deepseek-flash' };
const endpoint = 'https://api.deepseek.com/anthropic/v1/messages';
const officialUrl = 'https://www.nobelprize.org/prizes/physics/2025/press-release/';
const clone = value => JSON.parse(JSON.stringify(value));
const normalize = raw => {
  assert.equal(typeof web.normalizeDeepSeekAnthropicWebResponse, 'function');
  return web.normalizeDeepSeekAnthropicWebResponse(raw, identity);
};
function fixture() {
  const raw = clone(captured);
  // The original third link drops a result fragment. This positive DERIVATIVE
  // keeps only the two exact citations; the unchanged capture is a rejection test.
  raw.content.at(-1).text = raw.content.at(-1).text.split('\n')
    .filter(line => !line.startsWith('- [Slide show:')).join('\n');
  return raw;
}
const result = raw => raw.content.find(block => block.type === 'web_search_tool_result');
const collect = async stream => { const events = []; for await (const e of stream) events.push(e); return events; };
const adapterFor = fetchImpl => createDeepSeekAdapter({ model: identity.model, apiKey: 'fixture-key' }, fetchImpl);
function webMethod(adapter) {
  assert.equal(typeof adapter.generateWebSearchTextStream, 'function');
  return adapter.generateWebSearchTextStream.bind(adapter);
}

test('Messages search binds real results to exact final Markdown citations without including narration', () => {
  const raw = fixture(); const before = JSON.stringify(raw);
  const normalized = normalize(raw);
  const blocks = normalized.text.split('\n').map(JSON.parse);
  assert.equal(blocks[0].markdown, raw.content.at(-1).text);
  assert.equal(blocks[0].type, 'answer_block');
  assert.deepEqual(blocks[0].evidence, []);
  assert.deepEqual(blocks[1], { type: 'final', status: 'completed' });
  assert.equal(normalized.text.includes("I'll search"), false);
  assert.deepEqual(normalized.grounding.sources.map(s => s.url), [officialUrl,
    'https://www.nobelprize.org/page/5/?np-prize-category=physics']);
  assert.deepEqual(normalized.grounding.sources.map(s => s.blockIds), [['block-1'], ['block-1']]);
  assert.equal(normalized.grounding.providerResponseId, raw.id);
  assert.equal(normalized.grounding.providerId, 'deepseek');
  assert.equal(normalized.answerProvenance, undefined);
  assert.equal(normalized.usage.output_tokens, 303);
  assert.equal(JSON.stringify(raw), before);
  const binding = { ...identity, turnId: 'turn-qa017', operationId: 'operation-qa017',
    question: 'public query', answer: blocks[0].markdown, answerBlocks: [blocks[0]], grounding: normalized.grounding };
  const receipt = web.createArticleChatWebGroundingReceipt(binding);
  assert.deepEqual(web.normalizeArticleChatWebGroundingReceipt(receipt, binding), receipt);
  assert.equal(web.normalizeArticleChatWebGroundingReceipt(receipt, { ...binding, answer: 'changed' }), null);
});

test('unchanged real capture rejects its unmatched PDF fragment instead of certifying partial provenance', () => {
  assert.throws(() => normalize(clone(captured)), { code: 'WEB_SEARCH_GROUNDING_MISSING' });
});

for (const [name, mutate, code = 'WEB_SEARCH_GROUNDING_MISSING'] of [
  ['missing real search', raw => { raw.content = raw.content.filter(b => b.type !== 'server_tool_use'); }],
  ['missing results', raw => { raw.content = raw.content.filter(b => b.type !== 'web_search_tool_result'); }],
  ['unmatched result id', raw => { result(raw).tool_use_id = 'other-call'; }],
  ['empty results', raw => { result(raw).content = []; }],
  ['tool error inside HTTP 200', raw => { result(raw).content = { type: 'web_search_tool_result_error', error_code: 'unavailable' }; }],
  ['no citations', raw => { raw.content.at(-1).text = 'A complete answer without citations.'; }],
  ['plain prose URL only', raw => { raw.content.at(-1).text = `Answer from ${officialUrl}`; }],
  ['invented Markdown source', raw => { raw.content.at(-1).text += '\n[Invented](https://www.nih.gov/not-returned)'; }],
  ['fragment changed', raw => { raw.content.at(-1).text = `[Source](${officialUrl}#different)`; }],
  ['only fenced-code citation', raw => { raw.content.at(-1).text = `Example:\n\`\`\`md\n[Source](${officialUrl})\n\`\`\``; }],
  ['only inline-code citation', raw => { raw.content.at(-1).text = `Example: \`[Source](${officialUrl})\``; }],
  ['duplicate search id', raw => { raw.content.splice(2, 0, clone(raw.content[1])); }, 'INVALID_RESPONSE'],
  ['duplicate result', raw => { raw.content.splice(3, 0, clone(result(raw))); }, 'INVALID_RESPONSE'],
  ['late search after answer', raw => { raw.content.push({ type: 'server_tool_use', id: 'late', name: 'web_search', input: { query: 'late' } }); }, 'INVALID_RESPONSE'],
  ['unsafe result URL', raw => { result(raw).content[0].url = 'https://127.0.0.1/private'; }, 'INVALID_RESPONSE'],
  ['unsafe Markdown URL', raw => { raw.content.at(-1).text += '\n[Bad](javascript:alert)'; }, 'INVALID_RESPONSE'],
  ['image cannot certify source', raw => { raw.content.at(-1).text = `![Source](${officialUrl})`; }, 'INVALID_RESPONSE'],
  ['reference-style unsupported citation', raw => { raw.content.at(-1).text = `[source][a]\n\n[a]: ${officialUrl}`; }, 'INVALID_RESPONSE'],
  ['nested unbound link beside a valid citation', raw => { raw.content.at(-1).text += '\n[Outer [nested]](https://www.nih.gov/not-returned)'; }, 'INVALID_RESPONSE'],
  ['indented ambiguous link beside a valid citation', raw => { raw.content.at(-1).text += '\n    [Indented](https://www.nih.gov/not-returned)'; }, 'INVALID_RESPONSE'],
  ['non-assistant message', raw => { raw.role = 'user'; }, 'INVALID_RESPONSE'],
  ['different response model', raw => { raw.model = 'other-model'; }, 'INVALID_RESPONSE'],
  ['blank final', raw => { raw.content.at(-1).text = ' '; }, 'INVALID_RESPONSE'],
  ['oversized final', raw => { raw.content.at(-1).text = 'x'.repeat(65537); }, 'INVALID_RESPONSE'],
  ['truncated completion', raw => { raw.stop_reason = 'max_tokens'; }, 'OUTPUT_TRUNCATED'],
  ['pause_turn needs explicit further request', raw => { raw.stop_reason = 'pause_turn'; }, 'WEB_SEARCH_RESPONSE_INCOMPLETE'],
  ['response error', raw => { raw.error = { type: 'overloaded_error' }; }, 'WEB_SEARCH_RESPONSE_INCOMPLETE']
]) test(`Messages rejects ${name}`, () => {
  const raw = fixture(); mutate(raw);
  assert.throws(() => normalize(raw), { code });
});

test('exact fragments and balanced URL parentheses stay intact; source titles come from results', () => {
  const raw = fixture();
  const url = 'https://www.nobelprize.org/prizes/physics/(2025)/#1#1';
  result(raw).content = [{ type: 'web_search_result', title: 'Provider title', url, encrypted_content: 'opaque' }];
  raw.content.at(-1).text = `Claim [different model label](${url}).`;
  const normalized = normalize(raw);
  assert.equal(normalized.grounding.sources[0].url, url);
  assert.equal(normalized.grounding.sources[0].title, 'Provider title');
});

test('result accessors are not executed and unsupported response formats do not gain grounding', () => {
  const raw = fixture(); let reads = 0;
  Object.defineProperty(result(raw).content[0], 'url', { enumerable: true, get() { reads++; return officialUrl; } });
  assert.throws(() => normalize(raw), { code: 'INVALID_RESPONSE' });
  assert.equal(reads, 0);
  assert.throws(() => normalize({ status: 'completed', output: [{ type: 'web_search_call', status: 'completed' }] }), { code: 'INVALID_RESPONSE' });
});

test('only the explicitly supported official model and endpoints expose web transport', () => {
  for (const baseUrl of [undefined, '', 'https://api.deepseek.com/responses/',
    'https://api.deepseek.com/chat/completions', 'https://api.deepseek.com/v1/chat/completions']) {
    const adapter = createDeepSeekAdapter({ model: 'deepseek-flash', baseUrl, apiKey: 'fixture' }, () => assert.fail('no fetch'));
    assert.equal(typeof adapter.generateWebSearchTextStream, 'function', String(baseUrl));
  }
  for (const baseUrl of ['https://gateway.example.org/responses', 'http://api.deepseek.com/responses',
    'https://api.deepseek.com.evil.org/responses', 'https://api.deepseek.com:8443/responses',
    'https://user:secret@api.deepseek.com/responses', 'https://api.deepseek.com/responses?q=1',
    'https://api.deepseek.com/responses#hash', 'https://api.deepseek.com/unknown']) {
    assert.equal(createDeepSeekAdapter({ model: 'deepseek-flash', baseUrl }, () => assert.fail('no fetch'))
      .generateWebSearchTextStream, undefined, baseUrl);
  }
  for (const model of ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-flash[1m]', 'future', undefined]) {
    assert.equal(createDeepSeekAdapter({ model }, () => assert.fail('no fetch')).generateWebSearchTextStream, undefined);
  }
});

test('aborted search does not dispatch and pending requests settle on cancel/timeout without retry', async () => {
  const cancelled = new AbortController(); cancelled.abort(); let calls = 0;
  let adapter = adapterFor(async () => { calls++; return new Response('{}'); });
  let events = await collect(webMethod(adapter)({ signal: cancelled.signal, userPrompt: 'q' }));
  assert.equal(calls, 0); assert.equal(events.at(-1).error.code, 'CANCELLED');
  for (const mode of ['cancel', 'timeout']) {
    const controller = new AbortController(); calls = 0;
    adapter = adapterFor(() => { calls++; if (mode === 'cancel') controller.abort(); return new Promise(() => {}); });
    events = await collect(webMethod(adapter)({ signal: controller.signal, timeoutMs: 5, userPrompt: 'q' }));
    assert.equal(calls, 1); assert.deepEqual(events.map(e => e.type), ['started', 'error']);
    assert.equal(events.at(-1).error.code, mode === 'cancel' ? 'CANCELLED' : 'REQUEST_TIMEOUT');
  }
});

test('ordinary JSON and vision input still use Chat Completions and no search tools', async () => {
  const adapter = createDeepSeekAdapter({ model: 'deepseek-flash', apiKey: 'fixture-key',
    __providerCapabilities: { supportsVision: true } }, async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer fixture-key');
    const body = JSON.parse(options.body);
    assert.equal(body.tools, undefined); assert.equal(body.messages[1].content[1].type, 'image_url');
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }));
  });
  assert.deepEqual(await adapter.generateJson({ userPrompt: 'q', images: [{ dataUrl: 'data:image/png;base64,AAAA', mediaType: 'image/png' }] }), { ok: true });
});

test('production article-chat accepts a Search API receipt and rejects an unbound answer before publishing blocks', async () => {
  for (const moduleName of ['article-chat-tokenizer', 'article-chat-index',
    'article-chat-retrieval', 'article-chat-memory', 'article-chat-citations',
    'token-budget', 'article-chat-context-planner', 'article-chat-stream']) require(`../core/${moduleName}.js`);
  const { normalizeArticleChatInput, runArticleChat } = require('../core/article-chat.js');
  const searchResults = { results: [
    { title: 'Official press release', url: officialUrl,
      summary: 'The official announcement.', content: 'Official announcement content.' }
  ] };
  const answer = content => ({ id: 'chatcmpl-production-search', object: 'chat.completion',
    model: 'deepseek-flash', choices: [{ index: 0, finish_reason: 'stop',
      message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 300, completion_tokens: 30, total_tokens: 330 } });
  for (const successful of [true, false]) {
    let calls = 0; const progress = [];
    const input = normalizeArticleChatInput({ question: 'What does the official public source report?',
      turnId: 'turn-messages', operationId: 'operation-messages', webSearch: { enabled: true },
      document: { title: 'Public context', url: officialUrl,
        paragraphs: [{ paragraphId: 'p1', text: 'This context introduces the physics award.' }] } });
    const args = { input, profile: { providerId: 'deepseek', config: { model: 'deepseek-flash' },
      tokenPolicy: {}, contextWindowTokens: 65536 },
      routeIdentity: { ...identity, turnId: input.turnId, operationId: input.operationId },
      adapter: adapterFor(async url => {
        calls++;
        if (url === 'https://api.deepseek.com/v1/tools/search') {
          return new Response(JSON.stringify(searchResults));
        }
        return new Response(JSON.stringify(answer(successful
          ? 'The official source reports the award. [S1]'
          : 'The official source reports the award without a handle.')));
      }),
      onProgress: e => progress.push(e) };
    if (successful) {
      const outcome = await runArticleChat(args);
      assert.equal(outcome.message.status, 'completed');
      assert.deepEqual(outcome.message.webSearch, { enabled: true, searched: true });
      assert.equal(outcome.message.webGrounding.grounding.sources.length, 1);
      assert.match(outcome.message.webGrounding.receiptId, /^web-source-receipt-v1-sha256-/u);
    } else {
      await assert.rejects(runArticleChat(args), { code: 'WEB_SEARCH_GROUNDING_MISSING' });
      assert.equal(progress.some(e => e.phase === 'chat_answer_block'), false);
      assert.equal(progress.filter(e => e.phase === 'chat_search_retry').length, 1);
    }
    // With no auto-search decision, production issues the user question and
    // the article-title query, then one answer request per attempt.
    assert.equal(calls, successful ? 3 : 6);
  }
});
