const test = require('node:test');
const assert = require('node:assert/strict');
require('../providers/provider-utils.js');
require('../providers/provider-registry.js');
require('../core/article-chat-web-sources.js');
const { createDeepSeekAdapter } = require('../providers/deepseek.js');
const api = globalThis.SciLLM;
const PNG = 'data:image/png;base64,AA==';
const JPEG = 'data:image/jpeg;base64,AQ==';
const SOURCE = 'https://www.nobelprize.org/prizes/physics/2025/press-release/';
const config = { model: 'deepseek-flash', apiKey: 'fixture-key' };
const searchEndpoint = 'https://api.deepseek.com/v1/tools/search';
const chatEndpoint = 'https://api.deepseek.com/chat/completions';

function searchResponse() {
  return { results: [{ title: 'Official announcement', url: SOURCE,
    summary: 'The official announcement.', content: 'Official announcement content.' }] };
}

function answerResponse(content = `The supplied picture is a red bar. External announcement: [S1].`) {
  return { id: 'chatcmpl-r21-visual-search', object: 'chat.completion',
    model: config.model, choices: [{ index: 0, finish_reason: 'stop',
      message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 } };
}

const collect = async stream => {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
};

test('R21 DeepSeek web vision validates images before search and preserves grounding/usage lifecycle', async () => {
  let searchCalls = 0;
  let chatCalls = 0;
  let chatBody;
  const telemetry = [];
  const adapter = api.createProviderAdapter({ providerId: 'deepseek', config,
    fetchImpl: async (url, options) => {
      if (url === searchEndpoint) {
        searchCalls += 1;
        const body = JSON.parse(options.body);
        assert.equal(body.query, 'Figure caption and CSV data');
        assert.equal(options.headers.Authorization, 'Bearer fixture-key');
        return new Response(JSON.stringify(searchResponse()));
      }
      assert.equal(url, chatEndpoint);
      chatCalls += 1;
      chatBody = JSON.parse(options.body);
      return new Response(JSON.stringify(answerResponse()));
    } });
  const events = await collect(adapter.generateWebSearchTextStream({
    userPrompt: 'Figure caption and CSV data',
    images: [{ dataUrl: PNG }, { dataUrl: JPEG }],
    onProviderTelemetry: value => telemetry.push(value)
  }));
  assert.equal(searchCalls, 1);
  assert.equal(chatCalls, 1);
  assert.deepEqual(chatBody.messages[1].content, [
    { type: 'text', text: chatBody.messages[1].content[0].text },
    { type: 'image_url', image_url: { url: PNG } },
    { type: 'image_url', image_url: { url: JPEG } }
  ]);
  assert.match(chatBody.messages[1].content[0].text, /SEARCH_RESULTS/u);
  assert.deepEqual(events.map(event => event.type),
    ['started', 'search_progress', 'text_delta', 'web_grounding', 'usage', 'completed']);
  assert.equal(events[3].grounding.sources[0].url, SOURCE);
  assert.equal(events[3].grounding.providerResponseId, 'chatcmpl-r21-visual-search');
  assert.equal(events[4].usage.outputTokens, 45);
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].outputTokens, 45);
});

test('R21 image-free web search keeps a plain string user message', async () => {
  let chatBody;
  const adapter = createDeepSeekAdapter(config, async (url, options) => {
    if (url === searchEndpoint) return new Response(JSON.stringify(searchResponse()));
    chatBody = JSON.parse(options.body);
    return new Response(JSON.stringify(answerResponse('Public answer [S1].')));
  });
  const events = await collect(adapter.generateWebSearchTextStream({
    userPrompt: 'Public question', images: []
  }));
  assert.equal(typeof chatBody.messages[1].content, 'string');
  assert.match(chatBody.messages[1].content, /USER_REQUEST\nPublic question/u);
  assert.equal(events.at(-1).type, 'completed');
});

test('R21 invalid, oversize or excess web images fail before any paid request', async () => {
  for (const images of [{ dataUrl: PNG }, [{ dataUrl: 'https://example.org/a.png' }],
    [{ dataUrl: 'data:image/svg+xml;base64,AA==' }],
    [{ dataUrl: PNG }, { dataUrl: 'invalid' }],
    Array.from({ length: 5 }, () => ({ dataUrl: PNG })),
    [{ dataUrl: `data:image/png;base64,${'A'.repeat(2800000)}` }]]) {
    let calls = 0;
    const adapter = api.createProviderAdapter({ providerId: 'deepseek', config,
      fetchImpl: async () => { calls += 1; assert.fail('no fetch'); } });
    const events = await collect(adapter.generateWebSearchTextStream({
      userPrompt: 'Visual question', images
    }));
    assert.equal(calls, 0);
    assert.deepEqual(events.map(event => event.type), ['started', 'error']);
    assert.equal(events.at(-1).error.code, 'INVALID_SETTINGS');
  }
});

test('R21 missing vision capability refuses visual web input before any request', async () => {
  let calls = 0;
  const adapter = createDeepSeekAdapter({
    ...config, __providerCapabilities: { supportsVision: false }
  }, async () => { calls += 1; assert.fail('no fetch'); });
  const events = await collect(adapter.generateWebSearchTextStream({
    userPrompt: 'Visual question', images: [{ dataUrl: PNG }]
  }));
  assert.equal(calls, 0);
  assert.equal(events.at(-1).error.code, 'VISION_UNSUPPORTED');
});

test('R21 visual search rejects invented sources after preserving actual usage once', async () => {
  let calls = 0;
  const telemetry = [];
  const adapter = api.createProviderAdapter({ providerId: 'deepseek', config,
    fetchImpl: async url => {
      calls += 1;
      if (url === searchEndpoint) return new Response(JSON.stringify(searchResponse()));
      return new Response(JSON.stringify(answerResponse(
        'The picture is a red bar [S1]. [Fake](https://example.org/fake)'
      )));
    } });
  const events = await collect(adapter.generateWebSearchTextStream({
    images: [{ dataUrl: PNG }], userPrompt: 'q',
    onProviderTelemetry: value => telemetry.push(value)
  }));
  assert.equal(calls, 2);
  assert.deepEqual(events.map(event => event.type), ['started', 'error']);
  assert.equal(events.at(-1).error.code, 'WEB_SEARCH_GROUNDING_MISSING');
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].outputTokens, 45);
});
