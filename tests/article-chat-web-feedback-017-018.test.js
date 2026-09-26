const test = require('node:test');
const assert = require('node:assert/strict');
require('../providers/provider-utils.js');
const { normalizeArticleChatWebResponse } = require('../core/article-chat-web-sources.js');
const { createDeepSeekAdapter } = require('../providers/deepseek.js');
const { createOpenAIAdapter } = require('../providers/openai.js');

const identity = { providerId: 'deepseek', model: 'deepseek-flash' };
const markdown = '已检索的资料支持这一结论。';
function response({ phase = 'final_answer', searched = true, citations = true, native = true } = {}) {
  const text = native ? markdown : [
    JSON.stringify({ type: 'answer_block', block_id: 'block-1', markdown, evidence: [] }),
    JSON.stringify({ type: 'final', status: 'completed' })
  ].join('\n');
  const start = text.indexOf(markdown);
  return {
    id: 'response-qa017', status: 'completed', output_text: text,
    output: [
      ...(searched ? [{ type: 'web_search_call', status: 'completed', id: 'search-qa017' }] : []),
      { type: 'message', role: 'assistant', status: 'completed',
        ...(phase === null ? {} : { phase }),
        content: [{ type: 'output_text', text, annotations: citations ? [{
          type: 'url_citation', start_index: start, end_index: start + markdown.length,
          url: 'https://www.nih.gov/news-events', title: 'NIH News'
        }] : [] }] }
    ], usage: { input_tokens: 10, output_tokens: 10 }
  };
}
const strict = { answerFormat: 'markdown', requireGrounding: true };

test('QA017: new web answers require both actual search activity and valid URL annotations', () => {
  for (const options of [
    { searched: false, citations: false }, { searched: false }, { citations: false }
  ]) assert.throws(() => normalizeArticleChatWebResponse(response(options), identity, strict),
    error => error.code === 'WEB_SEARCH_GROUNDING_MISSING');
});

test('QA017: a model-written bibliography or retrieval claim cannot become grounded sources', () => {
  const raw = response({ searched: false, citations: false });
  raw.output[0].content[0].text = '[^1]: A paper. (检索确认) https://www.nih.gov/news-events';
  raw.output_text = raw.output[0].content[0].text;
  assert.throws(() => normalizeArticleChatWebResponse(raw, identity, strict),
    error => error.code === 'WEB_SEARCH_GROUNDING_MISSING');
});

test('QA018: completed searched answers do not require the optional final_answer phase', () => {
  const normalized = normalizeArticleChatWebResponse(response({ phase: null }), identity, strict);
  assert.equal(normalized.grounding.sources[0].url, 'https://www.nih.gov/news-events');
  assert.deepEqual(normalized.grounding.sources[0].blockIds, ['block-1']);
  assert.equal(normalized.answerProvenance, undefined);
});

test('QA018: commentary before a final NDJSON answer does not discard genuine source annotations', () => {
  const raw = response({ native: false });
  raw.output.unshift({ type: 'message', role: 'assistant', status: 'completed', phase: 'commentary',
    content: [{ type: 'output_text', text: 'Searching now.', annotations: [] }] });
  raw.output_text = `Searching now.\n${raw.output_text}`;
  const normalized = normalizeArticleChatWebResponse(raw, identity, { requireGrounding: true });
  assert.equal(normalized.grounding.sources[0].url, 'https://www.nih.gov/news-events');
  assert.equal(normalized.text.includes('Searching now.'), false);
});

test('QA017: unsafe URLs, impossible citation offsets, and mismatched response text remain rejected', () => {
  for (const mutate of [
    raw => { raw.output.at(-1).content[0].annotations[0].url = 'https://127.0.0.1/private'; },
    raw => { raw.output.at(-1).content[0].annotations[0].end_index = 100000; },
    raw => { raw.output_text = 'different answer'; }
  ]) {
    const raw = response(); mutate(raw);
    assert.throws(() => normalizeArticleChatWebResponse(raw, identity, strict),
      error => ['INVALID_RESPONSE', 'WEB_SEARCH_GROUNDING_MISSING'].includes(error.code));
  }
});

test('QA018: incomplete responses and late search activity never count as completed sourced answers', () => {
  for (const mutate of [
    raw => { raw.status = 'incomplete'; },
    raw => { raw.error = { code: 'server_error' }; },
    raw => { raw.incomplete_details = { reason: 'content_filter' }; },
    raw => { raw.output.push({ type: 'web_search_call', status: 'in_progress' }); },
    raw => { raw.output.at(-1).phase = 'commentary'; }
  ]) {
    const raw = response(); mutate(raw);
    assert.throws(() => normalizeArticleChatWebResponse(raw, identity, strict));
  }
});

test('QA017: supported official web adapters never expose a text-only response as a successful web result', async () => {
  for (const [createAdapter, native] of [[createOpenAIAdapter, false]]) {
    let calls = 0;
    const adapter = createAdapter({ model: native ? 'deepseek-v4-pro' : 'gpt-5-mini', apiKey: 'fixture' },
      async () => { calls++; return new Response(JSON.stringify(response({ native, citations: false }))); });
    const events = [];
    for await (const event of adapter.generateWebSearchTextStream({ systemPrompt: 'NDJSON',
      webSystemPrompt: 'Markdown', userPrompt: 'question' })) events.push(event);
    assert.equal(calls, 1);
    assert.deepEqual(events.map(event => event.type), ['started', 'error']);
    assert.equal(events.at(-1).error.code, 'WEB_SEARCH_GROUNDING_MISSING');
  }
});

test('QA017: legacy explicit unverified normalization stays readable without gaining a source receipt', () => {
  const normalized = normalizeArticleChatWebResponse(response({ citations: false }), identity,
    { answerFormat: 'markdown' });
  assert.equal(normalized.grounding, null);
  assert.equal(normalized.answerProvenance.verification, 'unverified');
});

test('QA017: strict normalization never reads unrelated response accessors', () => {
  const raw = response({ native: false });
  Object.defineProperty(raw, 'unrelated', { enumerable: true,
    get() { throw new Error('unexpected accessor read'); } });
  assert.equal(normalizeArticleChatWebResponse(raw, identity, { requireGrounding: true })
    .grounding.sources.length, 1);
});

test('QA018: a custom DeepSeek gateway stops before any unsupported search dispatch', () => {
  let calls = 0;
  const adapter = createDeepSeekAdapter({ model: 'deepseek-flash', apiKey: 'fixture',
    baseUrl: 'https://gateway.example.org/chat/completions' },
    async () => { calls++; throw new Error('must not fetch'); });
  assert.equal(adapter.generateWebSearchTextStream, undefined);
  assert.equal(calls, 0);
});
