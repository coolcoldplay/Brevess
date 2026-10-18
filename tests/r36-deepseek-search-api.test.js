const test = require('node:test');
const assert = require('node:assert/strict');
require('../providers/provider-utils.js');
const web = require('../core/article-chat-web-sources.js');
const { createDeepSeekAdapter } = require('../providers/deepseek.js');

const searchEndpoint = 'https://api.deepseek.com/v1/tools/search';
const chatEndpoint = 'https://api.deepseek.com/chat/completions';
const natureUrl = 'https://www.nature.com/articles/s41586-025-09984-y#Fig3';
const pubmedUrl = 'https://pubmed.ncbi.nlm.nih.gov/12345678/';

const searchFixture = () => ({
  results: [
    {
      rerank_score: 2.7,
      title: 'Nature figure source',
      url: natureUrl,
      snippet: 'A short snippet.',
      summary: 'A model-readable summary of the figure source.',
      content: 'Full page content for the figure source.',
      site_name: 'Nature',
      date: '2026-01-02T00:00:00Z',
      authority: 4
    },
    {
      rerank_score: 1.9,
      title: 'PubMed record',
      url: pubmedUrl,
      snippet: 'Another snippet.',
      summary: 'A model-readable summary of the PubMed record.',
      content: 'Full page content for the PubMed record.',
      site_name: 'PubMed',
      date: null,
      authority: 3
    }
  ]
});

const answerFixture = content => ({
  id: 'chatcmpl-r36-search-1',
  object: 'chat.completion',
  model: 'deepseek-flash',
  choices: [{ index: 0, finish_reason: 'stop',
    message: { role: 'assistant', content } }],
  usage: { prompt_tokens: 812, completion_tokens: 96, total_tokens: 908 }
});

function adapterFor(fetchImpl, extra = {}) {
  return createDeepSeekAdapter({
    model: 'deepseek-flash', apiKey: 'fixture-key', ...extra
  }, fetchImpl);
}

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

test('official web search uses Search API then Chat Completions with exact source handles', async () => {
  const calls = [];
  const telemetry = [];
  const adapter = adapterFor(async (url, options) => {
    calls.push({ url, options });
    if (url === searchEndpoint) return new Response(JSON.stringify(searchFixture()));
    if (url === chatEndpoint) return new Response(JSON.stringify(
      answerFixture('The figure is discussed in the source [S1]. The record is [S2].')
    ));
    assert.fail(`unexpected URL ${url}`);
  });
  const events = await collect(adapter.generateWebSearchTextStream({
    systemPrompt: 'ORDINARY NDJSON',
    webSystemPrompt: 'WEB PROMPT',
    userPrompt: 'PUBLIC QUESTION',
    webSearchQuestion: 'What does the figure show?',
    maxOutputTokens: 4096,
    onProviderTelemetry: event => telemetry.push(event)
  }));

  assert.deepEqual(events.map(event => event.type),
    ['started', 'search_progress', 'text_delta', 'web_grounding', 'usage', 'completed']);
  assert.deepEqual(events[1],
    { type: 'search_progress', verification: 'provider_verified', stage: 'completed' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, searchEndpoint);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-key');
  assert.equal(calls[0].options.headers['x-api-key'], undefined);
  const searchBody = JSON.parse(calls[0].options.body);
  assert.equal(searchBody.query, 'What does the figure show?');
  assert.equal(searchBody.ori_question, 'What does the figure show?');
  assert.equal(searchBody.count, 6);
  assert.equal(searchBody.need_content, true);

  assert.equal(calls[1].url, chatEndpoint);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer fixture-key');
  const chatBody = JSON.parse(calls[1].options.body);
  assert.equal(chatBody.model, 'deepseek-flash');
  assert.equal(chatBody.stream, false);
  assert.deepEqual(chatBody.thinking, { type: 'disabled' });
  assert.equal(chatBody.tools, undefined);
  assert.match(chatBody.messages[0].content, /\[S1\]/u);
  assert.match(chatBody.messages[1].content, /SEARCH_RESULTS/u);
  assert.match(chatBody.messages[1].content, /s41586-025-09984-y#Fig3/u);

  const blocks = events[2].text.split('\n').map(JSON.parse);
  assert.equal(blocks[0].type, 'answer_block');
  assert.equal(blocks[0].markdown,
    `The figure is discussed in the source [S1](${natureUrl}). The record is [S2](${pubmedUrl}).`);
  assert.deepEqual(blocks[1], { type: 'final', status: 'completed' });
  assert.deepEqual(events[3].grounding.sources.map(source => source.url), [natureUrl, pubmedUrl]);
  assert.equal(events[3].grounding.providerResponseId, 'chatcmpl-r36-search-1');
  assert.equal(events[4].usage.inputTokens, 812);
  assert.equal(events[4].usage.outputTokens, 96);
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].providerId, 'deepseek');
  assert.equal(telemetry[0].outputTokens, 96);
});

test('multiple auto-search queries merge in order and de-duplicate exact URLs', async () => {
  let searchCalls = 0;
  const seenQueries = [];
  const adapter = adapterFor(async (url, options) => {
    if (url === searchEndpoint) {
      searchCalls += 1;
      const body = JSON.parse(options.body);
      seenQueries.push(body.query);
      return new Response(JSON.stringify({
        results: searchCalls === 1 ? searchFixture().results
          : [searchFixture().results[1]]
      }));
    }
    return new Response(JSON.stringify(answerFixture('Summary [S1] [S2].')));
  });
  const events = await collect(adapter.generateWebSearchTextStream({
    userPrompt: 'PUBLIC QUESTION',
    webSearchQuestion: 'What does the figure show?',
    webSearchQueries: ['figure query', 'record query']
  }));
  assert.equal(searchCalls, 2);
  assert.deepEqual(seenQueries, ['figure query', 'record query']);
  assert.equal(events.at(-1).type, 'completed');
  const blocks = events.find(event => event.type === 'text_delta').text.split('\n').map(JSON.parse);
  assert.equal(blocks[0].markdown, `Summary [S1](${natureUrl}) [S2](${pubmedUrl}).`);
});

test('search and answer payloads reject invented, unsafe, or unbound sources', async () => {
  const cases = [
    ['empty results', { results: [] }, 'WEB_SEARCH_GROUNDING_MISSING'],
    ['missing results array', {}, 'INVALID_RESPONSE'],
    ['unsafe result URL', { results: [{ title: 'Private', url: 'https://127.0.0.1/a' }] },
      'INVALID_RESPONSE'],
    ['plain HTTP result URL', { results: [{ title: 'Old', url: 'http://www.nature.com/a' }] },
      'INVALID_RESPONSE']
  ];
  for (const [name, payload, code] of cases) {
    const adapter = adapterFor(async () => new Response(JSON.stringify(payload)));
    const events = await collect(adapter.generateWebSearchTextStream({
      userPrompt: 'question', webSearchQuestion: 'question'
    }));
    assert.deepEqual(events.map(event => event.type), ['started', 'error'], name);
    assert.equal(events.at(-1).error.code, code, name);
  }
});

test('answer citations must bind to one returned source and never rely on copied URLs', async () => {
  const cases = [
    ['unknown source handle', 'Claim [S3].', 'WEB_SEARCH_GROUNDING_MISSING'],
    ['no citations', 'Claim without a source.', 'WEB_SEARCH_GROUNDING_MISSING'],
    ['shortened URL without a handle', `Claim [source](https://www.nature.com/articles/s41586-025-09984-y).`,
      'WEB_SEARCH_GROUNDING_MISSING'],
    ['unbound Markdown link', 'Claim [source](https://www.nih.gov/not-returned).',
      'WEB_SEARCH_GROUNDING_MISSING'],
    ['citation only in code', 'Example:\n```md\n[S1]\n```', 'WEB_SEARCH_GROUNDING_MISSING'],
    ['truncated answer', 'Claim [S1].', 'OUTPUT_TRUNCATED']
  ];
  for (const [name, content, code] of cases) {
    let calls = 0;
    const adapter = adapterFor(async url => {
      calls += 1;
      if (url === searchEndpoint) return new Response(JSON.stringify(searchFixture()));
      const raw = answerFixture(content);
      if (code === 'OUTPUT_TRUNCATED') raw.choices[0].finish_reason = 'length';
      return new Response(JSON.stringify(raw));
    });
    const events = await collect(adapter.generateWebSearchTextStream({
      userPrompt: 'question', webSearchQuestion: 'question'
    }));
    assert.equal(calls, 2, name);
    assert.deepEqual(events.map(event => event.type), ['started', 'error'], name);
    assert.equal(events.at(-1).error.code, code, name);
  }
});

test('a source handle canonicalizes a redundant or shortened destination', async () => {
  const adapter = adapterFor(async url => {
    if (url === searchEndpoint) return new Response(JSON.stringify(searchFixture()));
    return new Response(JSON.stringify(answerFixture(
      'Claim [S1](https://www.nature.com/articles/s41586-025-09984-y).'
    )));
  });
  const events = await collect(adapter.generateWebSearchTextStream({
    userPrompt: 'question', webSearchQuestion: 'question'
  }));
  const blocks = events.find(event => event.type === 'text_delta').text.split('\n').map(JSON.parse);
  assert.equal(blocks[0].markdown, `Claim [S1](${natureUrl}).`);
  assert.deepEqual(events.find(event => event.type === 'web_grounding')
    .grounding.sources.map(source => source.url), [natureUrl]);
});

test('cancellation before search dispatches no provider request', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const adapter = adapterFor(async () => { calls += 1; return new Response('{}'); });
  const events = await collect(adapter.generateWebSearchTextStream({
    userPrompt: 'question', webSearchQuestion: 'question', signal: controller.signal
  }));
  assert.equal(calls, 0);
  assert.deepEqual(events.map(event => event.type), ['started', 'error']);
  assert.equal(events.at(-1).error.code, 'CANCELLED');
});
