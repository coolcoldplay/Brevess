const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const {
  MAX_NON_STREAM_RESPONSE_BYTES,
  ProviderRequestError,
  getProviderTransportLease,
  requestText,
  requestJson,
  requestSseJson,
  createProviderTextStream,
  parseJsonText,
  normalizeImageInputs,
  splitDataUrl,
  normalizeOutputTokenLimit
} = require('../providers/provider-utils.js');

test('recovers bounded JSON from reasoning wrappers, trailing commas, and raw line breaks', () => {
  assert.deepEqual(parseJsonText('<think>reason {not json}</think>\n```json\n{"ok":true,}\n```'), {
    ok: true
  });
  assert.deepEqual(parseJsonText('preface {"answer":"line one\nline two"} epilogue'), {
    answer: 'line one\nline two'
  });
  assert.deepEqual(parseJsonText(JSON.stringify('{"nested":true}')), { nested: true });
});
require('../core/article-chat-web-sources.js');
require('../providers/openai.js');
require('../providers/anthropic.js');
require('../providers/gemini.js');
const { createDeepSeekAdapter } = require('../providers/deepseek.js');
test('DeepSeek marks invalid completed JSON as a known response outcome', async () => {
  for (const body of ['not JSON', JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"groups": broken}' } }] }),
    JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '' } }] })]) {
    const adapter = createDeepSeekAdapter({ model: 'deepseek-v4-flash', apiKey: 'test-key' },
      async () => new Response(body, { status: 200 }));
    await assert.rejects(adapter.generateJson({ systemPrompt: 'Return JSON', userPrompt: '{}' }),
      error => error.code === 'INVALID_RESPONSE' && error.diagnosticStage === 'provider-completion');
  }
});
require('../providers/codex-local.js');
require('../providers/openai-compatible.js');
const {
  createProviderAdapter,
  getProviderDefinitions,
  getCompatibleProviderPresets,
  getProviderCapabilities,
  getProviderReasoningCapabilities,
  normalizeReasoningForProvider,
  getProviderMaxOutputTokens,
  validateProviderConfig
} = require('../providers/provider-registry.js');
require('../core/settings-store.js');
require('../core/cache-planner.js');
const {
  resolveTaskProfile,
  requestBehaviorSignature
} = require('../core/task-profile-router.js');
const {
  compileProviderCapabilityProbes,
  executeProviderProbe
} = require('../core/provider-probes.js');

test('keeps large model-specific output limits instead of silently replacing them with 4096', () => {
  assert.equal(normalizeOutputTokenLimit(384000), 384000);
  assert.equal(getProviderMaxOutputTokens('openai', { model: 'deepseek-v4-pro' }), 384000);
  assert.equal(normalizeOutputTokenLimit(2000001), 4096);
});

const analysisRequest = {
  systemPrompt: 'SYSTEM',
  userPrompt: '{"chunk_id":"chunk-001"}',
  requestedCategoryIds: ['result'],
  paragraphs: [{ paragraphId: 'p1', text: 'Treatment improved survival.' }]
};

const annotationJson = JSON.stringify({
  chunk_id: 'chunk-001',
  paragraphs_reviewed: ['p1'],
  annotations: []
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}

function sseResponse(content, status = 200) {
  const midpoint = Math.max(1, Math.floor(content.length / 2));
  const chunks = content ? [content.slice(0, midpoint), content.slice(midpoint)] : [''];
  const events = chunks.map((chunk, index) => `data: ${JSON.stringify({
    choices: [{
      delta: { content: chunk },
      finish_reason: index === chunks.length - 1 ? 'stop' : null
    }]
  })}`);
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return [': keep-alive', '', ...events.flatMap(event => [event, '']), 'data: [DONE]', ''].join('\n');
    }
  };
}

function streamingTextResponse(chunks, status = 200) {
  const values = chunks.map(chunk => new TextEncoder().encode(chunk));
  let index = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return null; } },
    body: {
      getReader() {
        return {
          async read() {
            return index < values.length
              ? { done: false, value: values[index++] }
              : { done: true };
          },
          async cancel() {},
          releaseLock() {}
        };
      }
    },
    async text() { return chunks.join(''); }
  };
}

function observeSettlementWithin(promise, maximumMs = 100) {
  return new Promise(resolve => {
    const watchdog = setTimeout(() => resolve({ kind: 'pending' }), maximumMs);
    Promise.resolve(promise).then(
      value => {
        clearTimeout(watchdog);
        resolve({ kind: 'fulfilled', value });
      },
      error => {
        clearTimeout(watchdog);
        resolve({ kind: 'rejected', error });
      }
    );
  });
}

function createDeferredPromise() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function collectStream(iterable) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}

function sseEvents(events) {
  return events.map(event => {
    const eventName = event.event ? `event: ${event.event}\n` : '';
    const data = event.data === '[DONE]' ? '[DONE]' : JSON.stringify(event.data);
    return `${eventName}data: ${data}\n\n`;
  });
}

function captureFetch(responseBody, inspect) {
  return async (url, options) => {
    inspect(url, options, JSON.parse(options.body));
    return jsonResponse(responseBody);
  };
}

function groundedWebResponse(providerResponseId = 'resp_web_001') {
  const answer = JSON.stringify({
    type: 'answer_block', block_id: 'answer-1',
    markdown: 'A current source supports this answer.'
  });
  const final = JSON.stringify({ type: 'final', status: 'completed' });
  const text = `${answer}\n${final}`;
  const start = text.indexOf('current source');
  return {
    id: providerResponseId,
    status: 'completed',
    output_text: text,
    output: [
      { type: 'web_search_call', status: 'completed' },
      {
        type: 'message', role: 'assistant', status: 'completed', content: [{
          type: 'output_text', text,
          annotations: [{
            type: 'url_citation', start_index: start,
            end_index: start + 'current source'.length,
            url: 'https://www.nih.gov/news/example', title: 'NIH source'
          }]
        }]
      }
    ],
    usage: { input_tokens: 17, output_tokens: 11 }
  };
}

function providerConfigFor(providerId) {
  const common = { apiKey: 'test-key', model: 'test-model' };
  return providerId === 'openai-compatible'
    ? { ...common, baseUrl: 'https://gateway.example/v1' }
    : common;
}

function successfulStructuredFetchFor(providerId) {
  const value = JSON.stringify({ primary_type: 'clinical_trial', confidence: 0.93 });
  if (providerId === 'deepseek') return async () => sseResponse(value);
  return async () => jsonResponse(
    providerId === 'openai' ? { output_text: value } :
      providerId === 'anthropic' ? { content: [{ type: 'text', text: value }] } :
        providerId === 'gemini' ? { candidates: [{ content: { parts: [{ text: value }] } }] } :
          { choices: [{ message: { content: value } }] }
  );
}

test('registers all supported providers and validates required fields', () => {
  assert.deepEqual(Object.keys(getProviderDefinitions()), [
    'openai', 'anthropic', 'gemini', 'deepseek', 'typesafe', 'codex-local', 'deepseek-harness',
    'openai-compatible'
  ]);
  assert.deepEqual(validateProviderConfig('openai', { apiKey: '', model: '' }), ['apiKey', 'model']);
  assert.deepEqual(validateProviderConfig('openai-compatible', {
    apiKey: 'key', model: 'model', baseUrl: 'file:///tmp/api'
  }), ['baseUrl']);
  assert.deepEqual(validateProviderConfig('openai-compatible', {
    apiKey: 'key', model: 'model', baseUrl: 'http://gateway.example/v1'
  }), ['baseUrl']);
  assert.deepEqual(validateProviderConfig('openai', {
    apiKey: 'key', model: 'model', baseUrl: 'file:///tmp/api'
  }), ['baseUrl']);
  assert.deepEqual(validateProviderConfig('openai', {
    apiKey: 'key', model: 'model', baseUrl: 'https://gateway.example/v1/chat/completions'
  }), []);
  assert.deepEqual(validateProviderConfig('codex-local', {
    model: 'auto', reasoningEffort: 'medium'
  }), []);
  assert.deepEqual(validateProviderConfig('codex-local', {
    model: 'auto', reasoningEffort: 'extreme'
  }), ['reasoningEffort']);
});

test('publishes official Chinese-model compatible presets without coupling them to credentials', () => {
  const presets = getCompatibleProviderPresets();
  const expected = {
    kimi: ['https://api.moonshot.cn/v1', 'kimi-k3'],
    zhipu: ['https://open.bigmodel.cn/api/paas/v4', 'glm-5.2'],
    doubao: ['https://ark.cn-beijing.volces.com/api/v3', 'doubao-seed-2-0-lite-260215'],
    qwen: ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-flash'],
    'hunyuan-tokenhub': ['https://tokenhub.tencentmaas.com/v1', 'hy3-preview'],
    'hunyuan-classic': ['https://api.hunyuan.cloud.tencent.com/v1', 'hunyuan-turbos-latest'],
    qianfan: ['https://qianfan.baidubce.com/v2', 'ernie-4.5-turbo-32k'],
    minimax: ['https://api.minimaxi.com/v1', 'MiniMax-M2.7']
  };

  assert.equal(presets[0].id, 'custom');
  Object.entries(expected).forEach(([id, [baseUrl, defaultModel]]) => {
    const preset = presets.find(item => item.id === id);
    assert.ok(preset, `missing ${id} preset`);
    assert.equal(preset.baseUrl, baseUrl);
    assert.equal(preset.defaultModel, defaultModel);
    assert.equal(preset.authHeader, 'Authorization');
    assert.equal(preset.authPrefix, 'Bearer');
    assert.equal('apiKey' in preset, false);
  });

  presets[1].label = 'mutated';
  assert.notEqual(getCompatibleProviderPresets()[1].label, 'mutated');
});

test('all providers expose a generic structured JSON request', async () => {
  const structuredRequest = {
    systemPrompt: 'Classify the study and return JSON only.',
    userPrompt: JSON.stringify({ title: 'Trial', abstract: 'Randomized participants.' }),
    schemaName: 'study_profile',
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        primary_type: { type: 'string' },
        confidence: { type: 'number' }
      },
      required: ['primary_type', 'confidence']
    }
  };
  for (const providerId of ['openai', 'anthropic', 'gemini', 'deepseek', 'openai-compatible']) {
    const adapter = createProviderAdapter({
      providerId,
      config: providerConfigFor(providerId),
      fetchImpl: successfulStructuredFetchFor(providerId)
    });
    assert.equal(typeof adapter.generateJson, 'function');
    assert.equal((await adapter.generateJson(structuredRequest)).primary_type, 'clinical_trial');
  }
});

test('local Codex emits one normalized usage record from native token telemetry', async () => {
  const telemetry = [];
  const adapter = createProviderAdapter({
    providerId: 'codex-local',
    config: { model: 'auto', reasoningEffort: 'medium' },
    nativeClient: {
      streamTurn() {
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'json_final', text: '{"ok":true}' };
            yield {
              type: 'usage',
              usage: {
                last: {
                  inputTokens: 120,
                  cachedInputTokens: 50,
                  outputTokens: 30,
                  reasoningOutputTokens: 12
                }
              }
            };
            yield { type: 'completed', finishReason: 'stop' };
          }
        };
      },
      async health() { return { connected: true }; }
    }
  });
  assert.deepEqual(await adapter.generateJson({
    systemPrompt: 'SYSTEM',
    userPrompt: 'QUESTION',
    onProviderTelemetry: event => telemetry.push(event)
  }), { ok: true });
  assert.equal(telemetry.length, 1);
  assert.deepEqual({
    providerId: telemetry[0].providerId,
    model: telemetry[0].model,
    inputTokens: telemetry[0].inputTokens,
    outputTokens: telemetry[0].outputTokens,
    reasoningTokens: telemetry[0].reasoningTokens,
    cacheHitTokens: telemetry[0].cacheHitTokens,
    estimated: telemetry[0].estimated
  }, {
    providerId: 'codex-local',
    model: 'auto',
    inputTokens: 120,
    outputTokens: 30,
    reasoningTokens: 12,
    cacheHitTokens: 50,
    estimated: false
  });
});

test('all providers stream normalized text, usage, and completion events', async () => {
  const fixtures = {
    openai: sseEvents([
      { data: { type: 'response.output_text.delta', delta: '第一段' } },
      { data: { type: 'response.output_text.delta', delta: '第二段' } },
      { data: { type: 'response.completed', response: {
        status: 'completed', usage: { input_tokens: 10, output_tokens: 6 }
      } } },
      { data: '[DONE]' }
    ]),
    anthropic: sseEvents([
      { event: 'message_start', data: { type: 'message_start', message: {
        usage: { input_tokens: 10 }
      } } },
      { event: 'content_block_delta', data: {
        type: 'content_block_delta', delta: { type: 'text_delta', text: '第一段' }
      } },
      { event: 'content_block_delta', data: {
        type: 'content_block_delta', delta: { type: 'text_delta', text: '第二段' }
      } },
      { event: 'message_delta', data: {
        type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 6 }
      } },
      { event: 'message_stop', data: { type: 'message_stop' } }
    ]),
    gemini: sseEvents([
      { data: { candidates: [{ content: { parts: [{ text: '第一段' }] } }] } },
      { data: { candidates: [{
        content: { parts: [{ text: '第二段' }] }, finishReason: 'STOP'
      }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 6 } } }
    ]),
    deepseek: sseEvents([
      { data: { choices: [{ delta: { content: '第一段' }, finish_reason: null }] } },
      { data: { choices: [{ delta: { content: '第二段' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 6, prompt_cache_hit_tokens: 4 } } },
      { data: '[DONE]' }
    ]),
    'openai-compatible': sseEvents([
      { data: { choices: [{ delta: { content: '第一段' }, finish_reason: null }] } },
      { data: { choices: [{ delta: { content: '第二段' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 6 } } },
      { data: '[DONE]' }
    ])
  };

  for (const [providerId, chunks] of Object.entries(fixtures)) {
    let requestBody;
    let requestUrl;
    const adapter = createProviderAdapter({
      providerId,
      config: providerConfigFor(providerId),
      fetchImpl: async (url, options) => {
        requestUrl = url;
        requestBody = JSON.parse(options.body);
        return streamingTextResponse(chunks);
      }
    });
    assert.equal(typeof adapter.generateTextStream, 'function', providerId);
    const events = await collectStream(adapter.generateTextStream({
      systemPrompt: 'SYSTEM', userPrompt: 'QUESTION', maxOutputTokens: 4096
    }));
    assert.deepEqual(events.map(event => event.type), [
      'started', 'text_delta', 'text_delta', 'usage', 'completed'
    ], providerId);
    assert.equal(events.filter(event => event.type === 'text_delta')
      .map(event => event.text).join(''), '第一段第二段', providerId);
    assert.equal(events.find(event => event.type === 'usage').usage.inputTokens, 10);
    if (providerId === 'gemini') assert.match(requestUrl, /:streamGenerateContent\?alt=sse$/);
    else assert.equal(requestBody.stream, true, providerId);
    assert.equal(requestBody.tools, undefined, `${providerId} ordinary stream tools`);
    assert.equal(requestBody.tool_choice, undefined, `${providerId} ordinary stream tool choice`);
  }
});

test('official OpenAI Responses endpoint exposes one grounded web-search stream', async () => {
  for (const providerId of ['openai']) {
    let requestUrl = '';
    let requestBody = null;
    const adapter = createProviderAdapter({
      providerId,
      config: providerConfigFor(providerId),
      fetchImpl: async (url, options) => {
        requestUrl = url;
        requestBody = JSON.parse(options.body);
        return jsonResponse(groundedWebResponse(`resp_${providerId}_web`));
      }
    });
    assert.equal(typeof adapter.generateWebSearchTextStream, 'function', providerId);

    const events = await collectStream(adapter.generateWebSearchTextStream({
      systemPrompt: 'SYSTEM', userPrompt: 'QUESTION', maxOutputTokens: 4096
    }));
    assert.deepEqual(events.map(event => event.type), [
      'started', 'search_progress', 'text_delta', 'web_grounding', 'usage', 'completed'
    ], providerId);
    assert.deepEqual(events[1], { type: 'search_progress', verification: 'provider_verified', stage: 'completed' });
    assert.equal(events[2].text, groundedWebResponse().output_text, providerId);
    assert.equal(events[3].grounding.providerId, providerId);
    assert.equal(events[3].grounding.sources[0].hostname, 'www.nih.gov');
    assert.equal(events[4].usage.inputTokens, 17);
    assert.equal(events[5].finishReason, 'completed');

    assert.equal(requestUrl, 'https://api.openai.com/v1/responses');
    assert.deepEqual(requestBody.tools, [{ type: 'web_search' }], providerId);
    assert.deepEqual(requestBody.tool_choice, { type: 'web_search' }, providerId);
    assert.equal(requestBody.instructions, 'SYSTEM');
    assert.equal(requestBody.store, false, providerId);
    assert.equal(requestBody.stream, false, providerId);
  }
});

test('custom and Chat Completions endpoints never expose native web search', () => {
  for (const [providerId, baseUrl] of [
    ['openai', 'https://gateway.example/v1/responses'],
    ['openai', 'https://api.openai.com/v1/chat/completions'],
    ['openai', 'https://api.openai.com:8443/v1/responses'],
    ['deepseek', 'https://gateway.example/v1/responses'],
    ['deepseek', 'https://api.deepseek.com/chat/completions'],
    ['deepseek', 'https://api.deepseek.com:8443/responses']
  ]) {
    const adapter = createProviderAdapter({
      providerId,
      config: { ...providerConfigFor(providerId), baseUrl },
      fetchImpl: async () => { throw new Error('must not fetch'); }
    });
    assert.equal(adapter.generateWebSearchTextStream, undefined, `${providerId}:${baseUrl}`);
  }
  for (const providerId of ['anthropic', 'gemini', 'codex-local', 'openai-compatible']) {
    const options = providerId === 'codex-local'
      ? {
          providerId, config: { model: 'auto', reasoningEffort: 'medium' },
          nativeClient: {
            streamTurn() { throw new Error('must not call'); },
            async health() { return { connected: true }; }
          }
        }
      : {
          providerId, config: providerConfigFor(providerId),
          fetchImpl: async () => { throw new Error('must not fetch'); }
        };
    const adapter = createProviderAdapter(options);
    assert.equal(adapter.generateWebSearchTextStream, undefined, providerId);
  }
});

test('invalid web grounding never exposes an answer from a new web request', async () => {
  const unsafe = groundedWebResponse();
  unsafe.output[1].content[0].annotations[0].url = 'https://127.0.0.1/private';
  const adapter = createProviderAdapter({
    providerId: 'openai', config: providerConfigFor('openai'),
    fetchImpl: async () => jsonResponse(unsafe)
  });
  const events = await collectStream(adapter.generateWebSearchTextStream({
    systemPrompt: 'SYSTEM', userPrompt: 'QUESTION'
  }));
  assert.deepEqual(events.map(event => event.type), ['started', 'error']);
  assert.equal(events.at(-1).error.code, 'INVALID_RESPONSE');
  assert.equal(events.some(event => event.type === 'web_grounding'), false);
});

test('streaming adapters normalize cache telemetry and length termination', async () => {
  const cacheAdapter = createProviderAdapter({
    providerId: 'deepseek', config: providerConfigFor('deepseek'),
    fetchImpl: async () => streamingTextResponse(sseEvents([
      { data: { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }], usage: {
        prompt_tokens: 9, completion_tokens: 2, prompt_cache_hit_tokens: 7,
        prompt_cache_miss_tokens: 2
      } } },
      { data: '[DONE]' }
    ]))
  });
  const cached = await collectStream(cacheAdapter.generateTextStream({
    systemPrompt: 'SYSTEM', userPrompt: 'QUESTION'
  }));
  assert.equal(cached.find(event => event.type === 'usage').usage.cacheHitTokens, 7);
  assert.equal(cached.find(event => event.type === 'usage').usage.cacheMissTokens, 2);

  const truncatedAdapter = createProviderAdapter({
    providerId: 'openai-compatible', config: providerConfigFor('openai-compatible'),
    fetchImpl: async () => streamingTextResponse(sseEvents([
      { data: { choices: [{ delta: { content: 'partial' }, finish_reason: 'length' }] } },
      { data: '[DONE]' }
    ]))
  });
  const truncated = await collectStream(truncatedAdapter.generateTextStream({
    systemPrompt: 'SYSTEM', userPrompt: 'QUESTION'
  }));
  assert.deepEqual(truncated.map(event => event.type), ['started', 'text_delta', 'error']);
  assert.equal(truncated.at(-1).error.code, 'OUTPUT_TRUNCATED');
});

test('streaming adapters report malformed events and support non-stream JSON fallback', async () => {
  const malformedAdapter = createProviderAdapter({
    providerId: 'anthropic', config: providerConfigFor('anthropic'),
    fetchImpl: async () => streamingTextResponse(['event: content_block_delta\ndata: {bad json}\n\n'])
  });
  const malformed = await collectStream(malformedAdapter.generateTextStream({
    systemPrompt: 'SYSTEM', userPrompt: 'QUESTION'
  }));
  assert.equal(malformed.at(-1).type, 'error');
  assert.equal(malformed.at(-1).error.code, 'INVALID_RESPONSE');

  const fallbackAdapter = createProviderAdapter({
    providerId: 'openai-compatible', config: providerConfigFor('openai-compatible'),
    fetchImpl: async () => jsonResponse({
      choices: [{ finish_reason: 'stop', message: { content: 'fallback text' } }],
      usage: { prompt_tokens: 3, completion_tokens: 2 }
    })
  });
  const fallback = await collectStream(fallbackAdapter.generateTextStream({
    systemPrompt: 'SYSTEM', userPrompt: 'QUESTION'
  }));
  assert.equal(fallback.find(event => event.type === 'text_delta').text, 'fallback text');
  assert.equal(fallback.at(-1).type, 'completed');
});

test('OpenAI Responses streaming tolerates a chat-completions shaped gateway response', async () => {
  const adapter = createProviderAdapter({
    providerId: 'openai', config: providerConfigFor('openai'),
    fetchImpl: async () => streamingTextResponse(sseEvents([
      { data: { choices: [{ delta: { content: '兼容' }, finish_reason: null }] } },
      { data: { choices: [{ delta: { content: '成功' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 8, completion_tokens: 2 } } },
      { data: '[DONE]' }
    ]))
  });

  const events = await collectStream(adapter.generateTextStream({
    systemPrompt: 'SYSTEM', userPrompt: 'QUESTION', maxOutputTokens: 2048
  }));

  assert.equal(events.filter(event => event.type === 'text_delta')
    .map(event => event.text).join(''), '兼容成功');
  assert.equal(events.at(-1).type, 'completed');
});

test('OpenAI structured requests tolerate a chat-completions shaped gateway response', async () => {
  const adapter = createProviderAdapter({
    providerId: 'openai', config: providerConfigFor('openai'),
    fetchImpl: async () => jsonResponse({
      choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }]
    })
  });

  assert.deepEqual(await adapter.generateJson({
    systemPrompt: 'SYSTEM', userPrompt: '{}', responseSchema: { type: 'object' }
  }), { ok: true });
});

test('OpenAI profiles use Chat Completions request bodies for saved chat endpoints', async () => {
  const config = {
    apiKey: 'gateway-key',
    model: 'deepseek-v4-pro',
    baseUrl: 'https://gateway.example/v1/chat/completions'
  };
  let streamUrl = '';
  let streamBody;
  const streamAdapter = createProviderAdapter({
    providerId: 'openai', config,
    fetchImpl: async (url, options) => {
      streamUrl = url;
      streamBody = JSON.parse(options.body);
      return streamingTextResponse(sseEvents([
        { data: { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] } },
        { data: '[DONE]' }
      ]));
    }
  });
  const events = await collectStream(streamAdapter.generateTextStream({
    systemPrompt: 'SYSTEM', userPrompt: 'QUESTION', maxOutputTokens: 2048
  }));
  assert.equal(events.at(-1).type, 'completed');
  assert.equal(streamUrl, config.baseUrl);
  assert.deepEqual(streamBody.messages.map(message => message.role), ['system', 'user']);
  assert.equal(streamBody.messages[1].content, 'QUESTION');
  assert.equal(streamBody.max_tokens, 2048);
  assert.equal(streamBody.input, undefined);
  assert.equal(streamBody.instructions, undefined);

  let jsonBody;
  const jsonAdapter = createProviderAdapter({
    providerId: 'openai', config,
    fetchImpl: async (url, options) => {
      assert.equal(url, config.baseUrl);
      jsonBody = JSON.parse(options.body);
      return jsonResponse({
        choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }]
      });
    }
  });
  assert.deepEqual(await jsonAdapter.generateJson({
    systemPrompt: 'SYSTEM', userPrompt: '{}', schemaName: 'qa_schema',
    responseSchema: {
      type: 'object', additionalProperties: false,
      properties: { ok: { type: 'boolean' } }, required: ['ok']
    }
  }), { ok: true });
  assert.deepEqual(jsonBody.messages.map(message => message.role), ['system', 'user']);
  assert.match(jsonBody.messages[0].content, /RESPONSE_JSON_SCHEMA=/);
  assert.deepEqual(jsonBody.response_format, { type: 'json_object' });
  assert.equal(jsonBody.text, undefined);
  assert.equal(jsonBody.input, undefined);
});

test('streaming adapters emit a terminal cancelled event when the request is aborted', async () => {
  const adapter = createProviderAdapter({
    providerId: 'openai-compatible', config: providerConfigFor('openai-compatible'),
    fetchImpl: (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(
        new Error('aborted'), { name: 'AbortError' }
      )), { once: true });
    })
  });
  const controller = new AbortController();
  const iterator = adapter.generateTextStream({
    systemPrompt: 'SYSTEM', userPrompt: 'QUESTION', signal: controller.signal
  })[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value.type, 'started');
  const terminal = iterator.next();
  controller.abort();
  assert.equal((await terminal).value.type, 'cancelled');
  assert.equal((await iterator.next()).done, true);
});

test('stream cancellation stays first-wins when the provider reports abort after the timeout', async () => {
  const external = new AbortController();
  const iterator = createProviderTextStream({
    providerId: 'openai-compatible',
    model: 'delayed-abort',
    protocol: 'openai-chat',
    options: { signal: external.signal, timeoutMs: 5 },
    fetchImpl(url, options) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          setTimeout(() => reject(Object.assign(
            new Error('private delayed provider abort'), { name: 'AbortError' }
          )), 20);
        }, { once: true });
      });
    }
  })[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value.type, 'started');
  const terminal = iterator.next();
  external.abort();

  assert.deepEqual(await terminal, { done: false, value: { type: 'cancelled' } });
  assert.equal((await iterator.next()).done, true);
});

test('stream timeout stays first-wins when a later external abort arrives', async () => {
  const external = new AbortController();
  const iterator = createProviderTextStream({
    providerId: 'openai-compatible',
    model: 'timeout-first',
    protocol: 'openai-chat',
    options: { signal: external.signal, timeoutMs: 5 },
    fetchImpl(url, options) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          setTimeout(() => reject(Object.assign(
            new Error('private delayed timeout abort'), { name: 'AbortError' }
          )), 15);
        }, { once: true });
      });
    }
  })[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value.type, 'started');
  const terminal = iterator.next();
  await new Promise(resolve => setTimeout(resolve, 10));
  external.abort();
  const outcome = await terminal;

  assert.equal(outcome.value.type, 'error');
  assert.equal(outcome.value.error.code, 'REQUEST_TIMEOUT');
  assert.equal(outcome.value.error.retryable, true);
  assert.equal((await iterator.next()).done, true);
});

test('non-stream cancellation overrides a delayed non-abort transport failure', async () => {
  const external = new AbortController();
  const pending = requestText((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      setTimeout(() => reject(new TypeError('private delayed transport failure')), 20);
    }, { once: true });
  }), 'https://provider.example/test', {
    signal: external.signal,
    timeoutMs: 5
  });

  external.abort();
  await assert.rejects(pending, error =>
    error.code === 'CANCELLED' &&
    error.retryable === false &&
    !JSON.stringify(error).includes('private delayed transport failure')
  );
});

test('non-stream timeout overrides a delayed non-abort transport failure', async () => {
  const pending = requestText((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      setTimeout(() => reject(new TypeError('private delayed transport failure')), 15);
    }, { once: true });
  }), 'https://provider.example/test', { timeoutMs: 5 });

  await assert.rejects(pending, error =>
    error.code === 'REQUEST_TIMEOUT' &&
    error.retryable === true &&
    !JSON.stringify(error).includes('private delayed transport failure')
  );
});

test('non-stream cancellation overrides a later successful transport that ignores abort', async () => {
  const external = new AbortController();
  let cancelled = 0;
  let released = 0;
  let textCalls = 0;
  const pending = requestText(async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    return {
      ok: true,
      status: 200,
      headers: { get() { return null; } },
      body: {
        getReader() {
          return {
            cancel() {
              cancelled += 1;
              return new Promise(() => {});
            },
            releaseLock() { released += 1; }
          };
        }
      },
      async text() {
        textCalls += 1;
        return 'private late success';
      }
    };
  }, 'https://provider.example/test', {
    signal: external.signal,
    timeoutMs: 5
  });

  external.abort();
  await assert.rejects(pending, error =>
    error.code === 'CANCELLED' &&
    error.retryable === false &&
    !JSON.stringify(error).includes('private late success')
  );
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
  assert.equal(textCalls, 0);
});

test('non-stream timeout overrides a later successful transport that ignores abort', async () => {
  const pending = requestText(async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    return {
      ok: true,
      status: 200,
      headers: { get() { return null; } },
      async text() { return 'private late success'; }
    };
  }, 'https://provider.example/test', { timeoutMs: 5 });

  await assert.rejects(pending, error =>
    error.code === 'REQUEST_TIMEOUT' &&
    error.retryable === true &&
    !JSON.stringify(error).includes('private late success')
  );
});

test('requestText rechecks external cancellation after registering its listener', async () => {
  let abortedReads = 0;
  let listenerAdds = 0;
  let listenerRemoves = 0;
  const signal = {
    get aborted() {
      abortedReads += 1;
      return abortedReads >= 2;
    },
    addEventListener(type) {
      assert.equal(type, 'abort');
      listenerAdds += 1;
    },
    removeEventListener(type) {
      assert.equal(type, 'abort');
      listenerRemoves += 1;
    }
  };

  await assert.rejects(
    () => requestText(async (url, options) => {
      assert.equal(options.signal.aborted, true);
      throw new TypeError('private post-registration failure');
    }, 'https://provider.example/test', { signal, timeoutMs: 1000 }),
    error => error.code === 'CANCELLED' &&
      error.retryable === false &&
      !JSON.stringify(error).includes('private post-registration failure')
  );
  assert.equal(abortedReads, 2);
  assert.equal(listenerAdds, 1);
  assert.equal(listenerRemoves, 1);
});

test('provider text streams recheck external cancellation after registering their listener', async () => {
  let abortedReads = 0;
  let listenerAdds = 0;
  let listenerRemoves = 0;
  const signal = {
    get aborted() {
      abortedReads += 1;
      return abortedReads >= 2;
    },
    addEventListener(type) {
      assert.equal(type, 'abort');
      listenerAdds += 1;
    },
    removeEventListener(type) {
      assert.equal(type, 'abort');
      listenerRemoves += 1;
    }
  };
  const iterator = createProviderTextStream({
    providerId: 'openai-compatible',
    model: 'listener-race',
    protocol: 'openai-chat',
    options: { signal, timeoutMs: 1000 },
    async fetchImpl(url, options) {
      assert.equal(options.signal.aborted, true);
      throw new TypeError('private post-registration stream failure');
    }
  })[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value.type, 'started');
  assert.deepEqual(await iterator.next(), { done: false, value: { type: 'cancelled' } });
  assert.equal((await iterator.next()).done, true);
  assert.equal(abortedReads, 2);
  assert.equal(listenerAdds, 1);
  assert.equal(listenerRemoves, 1);
});

test('provider stream cancellation overrides a later successful transport that ignores abort', async () => {
  const external = new AbortController();
  let closed = 0;
  const fetchImpl = async () => { throw new Error('direct fetch should not be used'); };
  fetchImpl.stream = async function* ignoredAbortStream() {
    try {
      await new Promise(resolve => setTimeout(resolve, 20));
      yield { type: 'started', status: 200, ok: true };
      yield {
        type: 'chunk',
        text: 'data: {"choices":[{"delta":{"content":"private late success"},"finish_reason":"stop"}]}\n\n'
      };
      yield { type: 'completed' };
    } finally {
      closed += 1;
    }
  };
  const iterator = createProviderTextStream({
    fetchImpl,
    url: 'https://provider.example/stream',
    protocol: 'openai-chat',
    options: { signal: external.signal, timeoutMs: 5 }
  })[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value.type, 'started');
  const terminal = iterator.next();
  external.abort();
  assert.deepEqual(await terminal, { done: false, value: { type: 'cancelled' } });
  assert.equal((await iterator.next()).done, true);
  assert.equal(closed, 1);
});

test('provider stream timeout overrides a later successful transport that ignores abort', async () => {
  let closed = 0;
  const fetchImpl = async () => { throw new Error('direct fetch should not be used'); };
  fetchImpl.stream = async function* ignoredAbortStream() {
    try {
      await new Promise(resolve => setTimeout(resolve, 20));
      yield { type: 'started', status: 200, ok: true };
      yield {
        type: 'chunk',
        text: 'data: {"choices":[{"delta":{"content":"private late success"},"finish_reason":"stop"}]}\n\n'
      };
      yield { type: 'completed' };
    } finally {
      closed += 1;
    }
  };
  const iterator = createProviderTextStream({
    fetchImpl,
    url: 'https://provider.example/stream',
    protocol: 'openai-chat',
    options: { timeoutMs: 5 }
  })[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value.type, 'started');
  const terminal = await iterator.next();
  assert.equal(terminal.value.type, 'error');
  assert.equal(terminal.value.error.code, 'REQUEST_TIMEOUT');
  assert.equal(terminal.value.error.retryable, true);
  assert.doesNotMatch(JSON.stringify(terminal.value), /private late success/);
  assert.equal((await iterator.next()).done, true);
  assert.equal(closed, 1);
});

test('provider stream cancellation cannot be overwritten after a text delta is yielded', async () => {
  const external = new AbortController();
  const fetchImpl = async () => { throw new Error('direct fetch should not be used'); };
  fetchImpl.stream = async function* ignoredAbortStream() {
    yield { type: 'started', status: 200, ok: true };
    yield {
      type: 'chunk',
      text: 'data: {"choices":[{"delta":{"content":"accepted"},"finish_reason":"stop"}]}\n\n'
    };
    yield { type: 'completed' };
  };
  const iterator = createProviderTextStream({
    fetchImpl,
    url: 'https://provider.example/stream',
    protocol: 'openai-chat',
    options: { signal: external.signal, timeoutMs: 1000 }
  })[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value.type, 'started');
  assert.deepEqual((await iterator.next()).value, { type: 'text_delta', text: 'accepted' });
  external.abort();
  assert.deepEqual(await iterator.next(), { done: false, value: { type: 'cancelled' } });
  assert.equal((await iterator.next()).done, true);
});

test('latched stream cancellation overrides a delayed non-abort transport failure', async () => {
  const external = new AbortController();
  const iterator = createProviderTextStream({
    providerId: 'openai-compatible',
    model: 'cancel-before-type-error',
    protocol: 'openai-chat',
    options: { signal: external.signal, timeoutMs: 5 },
    fetchImpl(url, options) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          setTimeout(() => reject(new TypeError('private delayed transport failure')), 20);
        }, { once: true });
      });
    }
  })[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value.type, 'started');
  const terminal = iterator.next();
  external.abort();

  assert.deepEqual(await terminal, { done: false, value: { type: 'cancelled' } });
  assert.equal((await iterator.next()).done, true);
});

test('latched stream timeout overrides a delayed non-abort transport failure', async () => {
  const external = new AbortController();
  const iterator = createProviderTextStream({
    providerId: 'openai-compatible',
    model: 'timeout-before-type-error',
    protocol: 'openai-chat',
    options: { signal: external.signal, timeoutMs: 5 },
    fetchImpl(url, options) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          setTimeout(() => reject(new TypeError('private delayed transport failure')), 15);
        }, { once: true });
      });
    }
  })[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value.type, 'started');
  const terminal = iterator.next();
  await new Promise(resolve => setTimeout(resolve, 10));
  external.abort();
  const outcome = await terminal;

  assert.equal(outcome.value.type, 'error');
  assert.equal(outcome.value.error.code, 'REQUEST_TIMEOUT');
  assert.equal(outcome.value.error.retryable, true);
  assert.doesNotMatch(JSON.stringify(outcome.value), /private delayed transport failure/);
  assert.equal((await iterator.next()).done, true);
});

test('offscreen first-event failures close upstream iterators without waiting for return', async () => {
  const fixtures = [
    {
      first: { type: 'cancelled' },
      assertTerminal(event) { assert.equal(event.type, 'cancelled'); }
    },
    {
      first: { type: 'error', error: { name: 'TypeError', message: 'worker failed' } },
      assertTerminal(event) {
        assert.equal(event.type, 'error');
        assert.equal(event.error.code, 'NETWORK_ERROR');
      }
    },
    {
      first: { type: 'chunk', text: 'invalid before started' },
      assertTerminal(event) {
        assert.equal(event.type, 'error');
        assert.equal(event.error.code, 'INVALID_RESPONSE');
      }
    },
    {
      done: true,
      assertTerminal(event) {
        assert.equal(event.type, 'error');
        assert.equal(event.error.code, 'NETWORK_ERROR');
      }
    },
    {
      nextError: new TypeError('first read failed'),
      assertTerminal(event) {
        assert.equal(event.type, 'error');
        assert.equal(event.error.code, 'NETWORK_ERROR');
      }
    }
  ];

  for (const fixture of fixtures) {
    let returnCalls = 0;
    const upstream = {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        if (fixture.nextError) throw fixture.nextError;
        return { done: Boolean(fixture.done), value: fixture.first };
      },
      return() {
        returnCalls += 1;
        return new Promise(() => {});
      }
    };
    const fetchImpl = async () => { throw new Error('direct fetch should not be used'); };
    fetchImpl.stream = () => upstream;

    const outcome = await Promise.race([
      collectStream(createProviderTextStream({
        fetchImpl, url: 'https://provider.example/stream', protocol: 'openai-chat'
      })),
      new Promise(resolve => setTimeout(() => resolve([{ type: 'cleanup_hung' }]), 40))
    ]);

    assert.notEqual(outcome.at(-1).type, 'cleanup_hung');
    fixture.assertTerminal(outcome.at(-1));
    assert.equal(returnCalls, 1);
  }
});

test('direct provider streams enforce an exact cumulative UTF-8 byte boundary and clean overflow readers', async () => {
  const maximumBytes = 4 * 1024 * 1024;
  const encoder = new TextEncoder();
  const terminal = `data: ${JSON.stringify({
    choices: [{ delta: { content: '汉' }, finish_reason: 'stop' }]
  })}\n\ndata: [DONE]\n\n`;
  let remaining = maximumBytes - encoder.encode(terminal).length;
  const filler = [];
  while (remaining > 60 * 1024) {
    filler.push(`:${'x'.repeat(60 * 1024 - 3)}\n\n`);
    remaining -= 60 * 1024;
  }
  if (remaining > 0 && remaining < 3) {
    remaining += encoder.encode(filler.pop()).length;
  }
  if (remaining >= 3) filler.push(`:${'x'.repeat(remaining - 3)}\n\n`);
  const exactBytes = encoder.encode(`${filler.join('')}${terminal}`);
  assert.equal(exactBytes.length, maximumBytes);
  const characterStart = exactBytes.findIndex((value, index) =>
    value === 0xe6 && exactBytes[index + 1] === 0xb1 && exactBytes[index + 2] === 0x89
  );
  assert.ok(characterStart > 0);
  const exactParts = [
    exactBytes.subarray(0, characterStart + 1),
    exactBytes.subarray(characterStart + 1, characterStart + 2),
    exactBytes.subarray(characterStart + 2)
  ];
  const states = [];
  const responseFor = (parts, { cancelNeverSettles = false } = {}) => {
    const state = { reads: 0, cancelled: 0, released: 0 };
    states.push(state);
    return {
      ok: true,
      status: 200,
      headers: { get() { return null; } },
      body: {
        getReader() {
          return {
            async read() {
              const value = parts[state.reads++];
              return value ? { done: false, value } : { done: true };
            },
            cancel() {
              state.cancelled += 1;
              return cancelNeverSettles ? new Promise(() => {}) : Promise.resolve();
            },
            releaseLock() { state.released += 1; }
          };
        }
      }
    };
  };
  const responses = [
    responseFor(exactParts),
    responseFor([...exactParts, encoder.encode('private overflow body')], {
      cancelNeverSettles: true
    })
  ];
  const fetchImpl = async () => responses.shift();

  const exact = await collectStream(createProviderTextStream({
    fetchImpl, url: 'https://provider.example/stream', protocol: 'openai-chat'
  }));
  assert.deepEqual(exact.map(event => event.type), ['started', 'text_delta', 'completed']);
  assert.equal(exact[1].text, '汉');
  assert.deepEqual(states[0], {
    reads: exactParts.length + 1, cancelled: 0, released: 1
  });

  const overflow = await Promise.race([
    collectStream(createProviderTextStream({
      fetchImpl, url: 'https://provider.example/stream', protocol: 'openai-chat'
    })),
    new Promise(resolve => setTimeout(() => resolve([{ type: 'cleanup_hung' }]), 40))
  ]);
  assert.notEqual(overflow.at(-1).type, 'cleanup_hung');
  assert.equal(overflow.at(-1).type, 'error');
  assert.equal(overflow.at(-1).error.code, 'INVALID_RESPONSE');
  assert.equal(overflow.at(-1).error.retryable, false);
  assert.equal(overflow.at(-1).error.diagnosticStage, 'response-body');
  assert.equal(overflow.at(-1).error.diagnosticType, 'ResponseLimitError');
  assert.equal(overflow.at(-1).error.message, 'Provider response body exceeded the 4 MiB limit');
  assert.doesNotMatch(JSON.stringify(overflow.at(-1)), /private overflow body/);
  assert.equal(states[1].cancelled, 1);
  assert.equal(states[1].released, 1);
});

test('direct text-only stream fallbacks reject UTF-8 overflow with fixed diagnostics', async () => {
  const maximumBytes = 4 * 1024 * 1024;
  const encoder = new TextEncoder();
  const prefix = '{"choices":[{"finish_reason":"stop","message":{"content":"';
  const suffix = '"}}]}';
  const fixedBytes = encoder.encode(`${prefix}汉${suffix}`).length;
  const overflowBody = `${prefix}${'a'.repeat(maximumBytes - fixedBytes + 1)}汉${suffix}`;
  assert.equal(encoder.encode(overflowBody).length, maximumBytes + 1);
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    async text() { return overflowBody; }
  });

  const rejected = await collectStream(createProviderTextStream({
    fetchImpl, url: 'https://provider.example/stream', protocol: 'openai-chat'
  }));
  assert.equal(rejected.at(-1).type, 'error');
  assert.equal(rejected.at(-1).error.code, 'INVALID_RESPONSE');
  assert.equal(rejected.at(-1).error.retryable, false);
  assert.equal(rejected.at(-1).error.diagnosticType, 'ResponseLimitError');
  assert.equal(rejected.at(-1).error.message, 'Provider response body exceeded the 4 MiB limit');
});

test('offscreen provider transport chunks have a cumulative byte cap and close their upstream iterator', async () => {
  const maximumBytes = 4 * 1024 * 1024;
  const encoder = new TextEncoder();
  const terminal = `data: ${JSON.stringify({
    choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }]
  })}\n\ndata: [DONE]\n\n`;
  let remaining = maximumBytes - encoder.encode(terminal).length;
  const filler = [];
  while (remaining > 60 * 1024) {
    filler.push(`:${'x'.repeat(60 * 1024 - 3)}\n\n`);
    remaining -= 60 * 1024;
  }
  if (remaining > 0 && remaining < 3) {
    remaining += encoder.encode(filler.pop()).length;
  }
  if (remaining >= 3) filler.push(`:${'x'.repeat(remaining - 3)}\n\n`);
  const exactBody = `${filler.join('')}${terminal}`;
  assert.equal(encoder.encode(exactBody).length, maximumBytes);
  const exactChunks = [];
  for (let offset = 0; offset < exactBody.length; offset += 60 * 1024) {
    exactChunks.push(exactBody.slice(offset, offset + 60 * 1024));
  }
  const scenarios = [exactChunks, [...exactChunks, 'private bridge overflow']];
  let closed = 0;
  const fetchImpl = async () => { throw new Error('direct fetch should not be used'); };
  fetchImpl.stream = () => {
    const chunks = scenarios.shift();
    return (async function* providerEvents() {
      try {
        yield { type: 'started', status: 200, ok: true };
        for (const text of chunks) yield { type: 'chunk', text };
        yield { type: 'completed' };
      } finally {
        closed += 1;
      }
    })();
  };

  const exact = await collectStream(createProviderTextStream({
    fetchImpl, url: 'https://provider.example/stream', protocol: 'openai-chat'
  }));
  assert.deepEqual(exact.map(event => event.type), ['started', 'text_delta', 'completed']);
  assert.equal(closed, 1);

  const overflow = await collectStream(createProviderTextStream({
    fetchImpl, url: 'https://provider.example/stream', protocol: 'openai-chat'
  }));
  assert.equal(overflow.at(-1).type, 'error');
  assert.equal(overflow.at(-1).error.code, 'INVALID_RESPONSE');
  assert.equal(overflow.at(-1).error.retryable, false);
  assert.equal(overflow.at(-1).error.diagnosticType, 'ResponseLimitError');
  assert.equal(overflow.at(-1).error.message, 'Provider response body exceeded the 4 MiB limit');
  assert.doesNotMatch(JSON.stringify(overflow.at(-1)), /private bridge overflow/);
  assert.equal(closed, 2);
});

test('normalizes bounded raster image data URLs for multimodal requests', () => {
  assert.deepEqual(splitDataUrl('data:image/jpeg;base64,AA=='), {
    mediaType: 'image/jpeg',
    data: 'AA==',
    dataUrl: 'data:image/jpeg;base64,AA=='
  });
  assert.deepEqual(normalizeImageInputs([
    { mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AA==' },
    { mediaType: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,AA==' }
  ]).map(item => item.mediaType), ['image/jpeg']);
});

test('publishes provider vision capability with compatible endpoints opt-in only', () => {
  const definitions = getProviderDefinitions();
  assert.equal(definitions.openai.supportsVision, true);
  assert.equal(definitions.anthropic.supportsVision, true);
  assert.equal(definitions.gemini.supportsVision, true);
  assert.equal(definitions.deepseek.supportsVision, false);
  assert.ok(definitions.deepseek.models.includes('deepseek-v4-flash-vision-exp'));
  assert.equal(definitions['openai-compatible'].supportsVision, false);
  assert.equal(getProviderCapabilities('deepseek', {}).supportsVision, false);
  assert.equal(getProviderCapabilities('deepseek', {
    model: 'deepseek-v4-pro'
  }).supportsVision, false);
  assert.deepEqual(getProviderCapabilities('deepseek', {
    model: 'deepseek-v4-flash-vision-exp'
  }), {
    supportsVision: true,
    visionInputFormat: 'openai',
    reasoning: getProviderReasoningCapabilities('deepseek', {
      model: 'deepseek-v4-flash-vision-exp'
    })
  });
  assert.equal(getProviderCapabilities('openai-compatible', {}).supportsVision, false);
  assert.equal(getProviderCapabilities('openai-compatible', {
    supportsVision: true
  }).supportsVision, true);
});

test('publishes reasoning controls only for provider and model combinations that support them', () => {
  assert.deepEqual(getProviderReasoningCapabilities('openai', {
    model: 'gpt-5-mini'
  }), {
    supported: true, mode: 'effort',
    levels: ['auto', 'minimal', 'low', 'medium', 'high'],
    defaultLevel: 'auto'
  });
  assert.deepEqual(getProviderReasoningCapabilities('openai', {
    model: 'gpt-5.1'
  }).levels, ['auto', 'none', 'low', 'medium', 'high']);
  assert.deepEqual(getProviderReasoningCapabilities('openai', {
    model: 'gpt-5.2'
  }).levels, ['auto', 'none', 'low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(getProviderReasoningCapabilities('openai', {
    model: 'gpt-5-pro'
  }).levels, ['auto', 'high']);
  assert.deepEqual(getProviderReasoningCapabilities('openai', {
    model: 'gpt-5.2-pro'
  }).levels, ['auto', 'medium', 'high', 'xhigh']);
  assert.deepEqual(getProviderReasoningCapabilities('openai', {
    model: 'gpt-5.6'
  }).levels, ['auto', 'none', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(getProviderReasoningCapabilities('openai', {
    model: 'gpt-5.3-unknown'
  }).supported, false);
  assert.equal(getProviderReasoningCapabilities('openai', {
    model: 'gpt-4.1'
  }).supported, false);
  assert.equal(getProviderReasoningCapabilities('anthropic', {
    model: 'claude-sonnet-4-6'
  }).supported, true);
  assert.equal(getProviderReasoningCapabilities('anthropic', {
    model: 'claude-haiku-4-5'
  }).supported, false);
  assert.deepEqual(getProviderReasoningCapabilities('anthropic', {
    model: 'claude-opus-4-5'
  }).levels, ['auto', 'low', 'medium', 'high']);
  assert.deepEqual(getProviderReasoningCapabilities('gemini', {
    model: 'gemini-3.5-flash'
  }).levels, ['auto', 'minimal', 'low', 'medium', 'high']);
  assert.deepEqual(getProviderReasoningCapabilities('gemini', {
    model: 'gemini-3.1-flash-lite-image'
  }).levels, ['auto', 'minimal', 'high']);
  assert.deepEqual(getProviderReasoningCapabilities('gemini', {
    model: 'gemini-3-pro-preview'
  }).levels, ['auto', 'low', 'high']);
  assert.equal(getProviderReasoningCapabilities('gemini', {
    model: 'gemini-3-unknown-preview'
  }).supported, false);
  assert.deepEqual(getProviderReasoningCapabilities('deepseek', {
    model: 'deepseek-v4-flash'
  }), {
    supported: true, mode: 'effort',
    levels: ['low', 'high', 'max'], defaultLevel: 'high'
  });
  assert.equal(getProviderReasoningCapabilities('openai-compatible', {
    model: 'reasoning-model'
  }).supported, false);
  assert.equal(getProviderReasoningCapabilities('openai-compatible', {
    model: 'reasoning-model', reasoningMode: 'effort'
  }).supported, true);
  assert.equal(getProviderCapabilities('openai', {
    model: 'gpt-5-mini'
  }).reasoning.supported, true);
});

test('normalizes per-task reasoning against provider capabilities', () => {
  const deepseek = { model: 'deepseek-v4-flash' };
  assert.deepEqual(
    normalizeReasoningForProvider('deepseek', deepseek, {
      enabled: true, effort: 'low'
    }),
    { enabled: true, effort: 'low' }
  );
  for (const legacyEffort of ['medium', 'xhigh']) {
    assert.deepEqual(
      normalizeReasoningForProvider('deepseek', deepseek, {
        enabled: true, effort: legacyEffort
      }),
      { enabled: true, effort: 'high' }
    );
  }
  assert.deepEqual(
    normalizeReasoningForProvider('deepseek', deepseek, {
      enabled: true, effort: 'max'
    }),
    { enabled: true, effort: 'max' }
  );
  assert.deepEqual(
    normalizeReasoningForProvider('deepseek', deepseek, {
      enabled: false, effort: 'max'
    }),
    { enabled: false, effort: 'auto' }
  );
  assert.deepEqual(
    normalizeReasoningForProvider('openai', { model: 'gpt-4.1' }, {
      enabled: true, effort: 'high'
    }),
    { enabled: false, effort: 'auto' }
  );
});

test('routes per-task DeepSeek reasoning into the actual request body and signature', async () => {
  const profileConfig = {
    apiKey: 'policy-secret', model: 'deepseek-v4-pro',
    thinking: true, reasoningEnabled: true, reasoningEffort: 'low'
  };
  const settings = {
    language: 'zh-CN',
    profiles: {
      profile_policy_deepseek: {
        name: 'Policy DeepSeek', providerId: 'deepseek', config: profileConfig,
        tokenPolicy: { mode: 'auto', autoCap: null }
      }
    },
    globalProfileId: 'profile_policy_deepseek',
    taskPolicies: {
      document_highlight: {
        mode: 'global', profileId: null, reasoningEnabled: true,
        reasoningEffort: 'max', tokenRule: 'auto', allowTextFallback: false
      }
    }
  };

  async function execute(reasoningEnabled, reasoningEffort) {
    const routedSettings = structuredClone(settings);
    routedSettings.taskPolicies.document_highlight.reasoningEnabled = reasoningEnabled;
    routedSettings.taskPolicies.document_highlight.reasoningEffort = reasoningEffort;
    const route = resolveTaskProfile(routedSettings, 'document_highlight');
    let body;
    const adapter = createProviderAdapter({
      providerId: route.providerId,
      config: route.config,
      fetchImpl: async (url, options) => {
        body = JSON.parse(options.body);
        return successfulStructuredFetchFor('deepseek')(url, options);
      }
    });
    await adapter.generateJson({
      systemPrompt: 'SYSTEM', userPrompt: '{}', responseSchema: { type: 'object' }
    });
    return { route, body };
  }

  const enabled = await execute(true, 'max');
  assert.deepEqual(enabled.route.effectiveReasoning, { enabled: true, effort: 'max' });
  assert.equal(enabled.route.config.reasoningEnabled, true);
  assert.equal(enabled.route.config.reasoningEffort, 'max');
  assert.equal(enabled.route.config.thinking, undefined);
  assert.deepEqual(enabled.body.thinking, { type: 'enabled' });
  assert.equal(enabled.body.reasoning_effort, 'max');
  assert.deepEqual(
    requestBehaviorSignature(enabled.route.providerId, enabled.route.config),
    { reasoning: enabled.route.effectiveReasoning }
  );

  const disabled = await execute(false, 'max');
  assert.deepEqual(disabled.route.effectiveReasoning, { enabled: false, effort: 'auto' });
  assert.equal(disabled.route.config.reasoningEnabled, false);
  assert.equal(disabled.route.config.reasoningEffort, 'auto');
  assert.equal(disabled.route.config.thinking, undefined);
  assert.deepEqual(disabled.body.thinking, { type: 'disabled' });
  assert.equal(disabled.body.reasoning_effort, undefined);
  assert.notEqual(enabled.route.profileSignature, disabled.route.profileSignature);
  assert.equal(settings.profiles.profile_policy_deepseek.config.thinking, true);
  assert.equal(settings.profiles.profile_policy_deepseek.config.reasoningEffort, 'low');
});

test('normalizes toggle reasoning into adapter-effective enabled and disabled states', async () => {
  const baseConfig = {
    apiKey: 'toggle-secret', model: 'toggle-model',
    baseUrl: 'https://gateway.example/v1', reasoningMode: 'toggle'
  };
  const enabled = normalizeReasoningForProvider(
    'openai-compatible', baseConfig, { enabled: true, effort: 'high' }
  );
  const disabled = normalizeReasoningForProvider(
    'openai-compatible', baseConfig, { enabled: false, effort: 'high' }
  );
  assert.deepEqual(enabled, { enabled: true, effort: 'enabled' });
  assert.deepEqual(disabled, { enabled: false, effort: 'auto' });

  async function requestBody(effective) {
    let body;
    const adapter = createProviderAdapter({
      providerId: 'openai-compatible',
      config: {
        ...baseConfig,
        reasoningEnabled: effective.enabled,
        reasoningEffort: effective.effort
      },
      fetchImpl: async (url, options) => {
        body = JSON.parse(options.body);
        return jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] });
      }
    });
    await adapter.generateJson({ systemPrompt: 'SYSTEM', userPrompt: '{}' });
    return body;
  }

  assert.deepEqual((await requestBody(enabled)).thinking, { type: 'enabled' });
  const disabledBody = await requestBody(disabled);
  assert.equal(disabledBody.thinking, undefined);
  assert.equal(disabledBody.reasoning_effort, undefined);
});

test('maps configured reasoning effort and disables DeepSeek auto thinking for structured JSON', async () => {
  const fixtures = [
    ['openai', { model: 'gpt-5-mini', reasoningEffort: 'high' },
      body => assert.deepEqual(body.reasoning, { effort: 'high' })],
    ['anthropic', { model: 'claude-sonnet-4-6', reasoningEffort: 'medium' },
      body => assert.deepEqual(body.output_config, { effort: 'medium' })],
    ['gemini', { model: 'gemini-3.5-flash', reasoningEffort: 'low' },
      body => assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'low' })],
    ['deepseek', {
      model: 'deepseek-v4-flash', reasoningEnabled: true, reasoningEffort: 'max'
    }, body => {
      assert.deepEqual(body.thinking, { type: 'enabled' });
      assert.equal(body.reasoning_effort, 'max');
    }]
  ];
  for (const [providerId, extraConfig, inspect] of fixtures) {
    let body;
    const adapter = createProviderAdapter({
      providerId,
      config: { ...providerConfigFor(providerId), ...extraConfig },
      fetchImpl: async (url, options) => {
        body = JSON.parse(options.body);
        return successfulStructuredFetchFor(providerId)(url, options);
      }
    });
    await adapter.generateJson({
      systemPrompt: 'SYSTEM', userPrompt: '{}', responseSchema: { type: 'object' }
    });
    inspect(body);
  }

  for (const providerId of ['openai', 'anthropic', 'gemini', 'deepseek']) {
    let body;
    const model = providerId === 'openai' ? 'gpt-5-mini' :
      providerId === 'anthropic' ? 'claude-sonnet-4-6' :
        providerId === 'gemini' ? 'gemini-3.5-flash' : 'deepseek-v4-flash';
    const adapter = createProviderAdapter({
      providerId,
      config: { ...providerConfigFor(providerId), model, reasoningEffort: 'auto' },
      fetchImpl: async (url, options) => {
        body = JSON.parse(options.body);
        return successfulStructuredFetchFor(providerId)(url, options);
      }
    });
    await adapter.generateJson({
      systemPrompt: 'SYSTEM', userPrompt: '{}', responseSchema: { type: 'object' }
    });
    assert.equal(body.reasoning, undefined, providerId);
    assert.equal(body.output_config, undefined, providerId);
    if (providerId === 'deepseek') {
      assert.deepEqual(body.thinking, { type: 'disabled' }, providerId);
    } else {
      assert.equal(body.thinking, undefined, providerId);
    }
    assert.equal(body.reasoning_effort, undefined, providerId);
    assert.equal(body.generationConfig?.thinkingConfig, undefined, providerId);
  }
});

test('structured reasoning probe activates reasoning in every supported provider adapter', async () => {
  const fixtures = [
    ['openai', { apiKey: 'key', model: 'gpt-5-mini', reasoningEffort: 'high' },
      body => assert.deepEqual(body.reasoning, { effort: 'high' })],
    ['anthropic', { apiKey: 'key', model: 'claude-sonnet-4-6' },
      body => assert.deepEqual(body.output_config, { effort: 'medium' })],
    ['gemini', { apiKey: 'key', model: 'gemini-3.5-flash' },
      body => assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'medium' })],
    ['deepseek', { apiKey: 'key', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      body => {
        assert.deepEqual(body.thinking, { type: 'enabled' });
        assert.equal(body.reasoning_effort, 'high');
      }]
  ];
  const probeValue = JSON.stringify({ ok: true, echo: 'schema' });
  for (const [providerId, config, inspect] of fixtures) {
    let body;
    const adapter = createProviderAdapter({
      providerId, config,
      fetchImpl: async (url, options) => {
        body = JSON.parse(options.body);
        if (providerId === 'deepseek') return sseResponse(probeValue);
        return jsonResponse(providerId === 'openai'
          ? { output_text: probeValue }
          : providerId === 'anthropic'
            ? { content: [{ type: 'text', text: probeValue }] }
            : { candidates: [{ content: { parts: [{ text: probeValue }] } }] });
      }
    });
    const probe = compileProviderCapabilityProbes({
      reasoningCapability: getProviderReasoningCapabilities(providerId, config),
      configuredReasoningEffort: config.reasoningEffort
    }).find(item => item.id === 'reasoning_structured');
    const result = await executeProviderProbe(adapter, probe);
    assert.equal(result.status, 'passed', `${providerId}: ${JSON.stringify(result)}`);
    inspect(body);
  }

  let turn;
  const config = { model: 'auto', reasoningEffort: 'auto' };
  const adapter = createProviderAdapter({
    providerId: 'codex-local', config,
    nativeClient: {
      streamTurn(input) {
        turn = input;
        return (async function * stream() {
          yield { type: 'json_final', text: probeValue };
          yield { type: 'completed', finishReason: 'stop' };
        })();
      },
      async health() { return { connected: true }; }
    }
  });
  const probe = compileProviderCapabilityProbes({
    reasoningCapability: getProviderReasoningCapabilities('codex-local', config),
    configuredReasoningEffort: config.reasoningEffort
  }).find(item => item.id === 'reasoning_structured');
  const result = await executeProviderProbe(adapter, probe);
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(turn.reasoningEffort, 'medium');

  await adapter.generateJson({
    systemPrompt: 'SYSTEM', userPrompt: '{}', reasoningEffort: 'extreme'
  });
  assert.equal(turn.reasoningEffort, 'auto');
});

test('does not send reasoning fields to unsupported official models or compatible gateways by default', async () => {
  const fixtures = [
    ['openai', { model: 'gpt-4.1', reasoningEffort: 'high' }],
    ['anthropic', { model: 'claude-haiku-4-5', reasoningEffort: 'high' }],
    ['gemini', { model: 'gemini-2.0-flash', reasoningEffort: 'high' }],
    ['openai-compatible', { model: 'custom', reasoningEffort: 'high' }]
  ];
  for (const [providerId, extraConfig] of fixtures) {
    let body;
    const adapter = createProviderAdapter({
      providerId,
      config: { ...providerConfigFor(providerId), ...extraConfig },
      fetchImpl: async (url, options) => {
        body = JSON.parse(options.body);
        return successfulStructuredFetchFor(providerId)(url, options);
      }
    });
    await adapter.generateJson({
      systemPrompt: 'SYSTEM', userPrompt: '{}', responseSchema: { type: 'object' }
    });
    assert.doesNotMatch(JSON.stringify(body), /reasoning|thinkingConfig|output_config/,
      providerId);
  }
});

test('sends explicit DeepSeek thinking state for supported models', async () => {
  let body;
  const create = config => createProviderAdapter({
    providerId: 'deepseek', config,
    fetchImpl: async (url, options) => {
      body = JSON.parse(options.body);
      return successfulStructuredFetchFor('deepseek')(url, options);
    }
  });
  await create({ apiKey: 'key', model: 'deepseek-v4-flash' }).generateJson({
    systemPrompt: 'SYSTEM', userPrompt: '{}', responseSchema: { type: 'object' }
  });
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.reasoning_effort, undefined);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  await create({ apiKey: 'key', model: 'deepseek-v4-flash', thinking: false })
    .generateJson({
      systemPrompt: 'SYSTEM', userPrompt: '{}', responseSchema: { type: 'object' }
    });
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.reasoning_effort, undefined);
  assert.deepEqual(body.response_format, { type: 'json_object' });
});

test('DeepSeek explicit thinking keeps schema prompting and native JSON mode', async () => {
  let body;
  const adapter = createProviderAdapter({
    providerId: 'deepseek',
    config: {
      apiKey: 'key', model: 'deepseek-v4-pro', reasoningEnabled: true,
      reasoningEffort: 'xhigh'
    },
    fetchImpl: async (url, options) => {
      body = JSON.parse(options.body);
      return successfulStructuredFetchFor('deepseek')(url, options);
    }
  });

  await adapter.generateJson({
    systemPrompt: 'Return the requested object.', userPrompt: '{}',
    schemaName: 'thinking_schema',
    responseSchema: {
      type: 'object', additionalProperties: false,
      properties: { ok: { type: 'boolean' } }, required: ['ok']
    }
  });

  assert.deepEqual(body.thinking, { type: 'enabled' });
  assert.equal(body.reasoning_effort, 'high');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.match(body.messages[0].content, /RESPONSE_JSON_SCHEMA=/);
});

test('DeepSeek native JSON mode remains enabled when per-task reasoning is disabled or unsupported', async () => {
  const cases = [
    {
      name: 'explicit disabled',
      capability: { supported: true, mode: 'effort', levels: ['low', 'high', 'max'] },
      reasoningEnabled: false,
      reasoningEffort: 'high'
    },
    {
      name: 'missing capability', capability: undefined,
      reasoningEnabled: true, reasoningEffort: 'high'
    },
    {
      name: 'malformed levels',
      capability: { supported: true, mode: 'effort', levels: null },
      reasoningEnabled: true, reasoningEffort: 'high'
    },
    {
      name: 'effort unavailable',
      capability: { supported: true, mode: 'effort', levels: [] },
      reasoningEnabled: true, reasoningEffort: 'high'
    }
  ];

  for (const item of cases) {
    let body;
    const adapter = createDeepSeekAdapter({
      apiKey: 'key', model: 'deepseek-v4-pro',
      reasoningEnabled: item.reasoningEnabled,
      reasoningEffort: item.reasoningEffort,
      __reasoningCapabilities: item.capability
    }, async (url, options) => {
      body = JSON.parse(options.body);
      return successfulStructuredFetchFor('deepseek')(url, options);
    });
    await adapter.generateJson({
      systemPrompt: 'SYSTEM', userPrompt: '{}', responseSchema: { type: 'object' }
    });
    assert.deepEqual(body.response_format, { type: 'json_object' }, item.name);
    if (item.name === 'explicit disabled') {
      assert.deepEqual(body.thinking, { type: 'disabled' }, item.name);
    } else {
      assert.equal(body.thinking, undefined, item.name);
    }
    assert.equal(body.reasoning_effort, undefined, item.name);
  }
});

test('DeepSeek applies supported thinking states to JSON and streaming requests', async () => {
  const supportedCapability = {
    supported: true,
    mode: 'effort',
    levels: ['low', 'high', 'max']
  };
  const cases = [
    {
      name: 'explicit off',
      capability: supportedCapability,
      reasoningEnabled: false,
      reasoningEffort: 'high',
      expectedThinking: { type: 'disabled' }
    },
    {
      name: 'normalized off',
      capability: supportedCapability,
      reasoningEnabled: true,
      reasoningEffort: 'none',
      expectedThinking: { type: 'disabled' }
    },
    {
      name: 'enabled',
      capability: supportedCapability,
      reasoningEnabled: true,
      reasoningEffort: 'high',
      expectedThinking: { type: 'enabled' },
      expectedEffort: 'high'
    },
    {
      name: 'empty capability',
      capability: { supported: true, mode: 'effort', levels: [] },
      reasoningEnabled: false,
      reasoningEffort: 'high',
      expectedThinking: undefined
    },
    {
      name: 'malformed capability',
      capability: { supported: true, mode: 'effort', levels: null },
      reasoningEnabled: false,
      reasoningEffort: 'high',
      expectedThinking: undefined
    }
  ];

  for (const method of ['generateJson', 'generateTextStream']) {
    for (const item of cases) {
      let body;
      const adapter = createDeepSeekAdapter({
        apiKey: 'key',
        model: 'deepseek-v4-pro',
        reasoningEnabled: item.reasoningEnabled,
        reasoningEffort: item.reasoningEffort,
        __reasoningCapabilities: item.capability
      }, async (url, options) => {
        body = JSON.parse(options.body);
        if (method === 'generateJson') {
          return sseResponse('{"ok":true}');
        }
        return streamingTextResponse(sseEvents([
          { data: { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] } },
          { data: '[DONE]' }
        ]));
      });
      const request = { systemPrompt: 'SYSTEM', userPrompt: '{}' };
      if (method === 'generateJson') {
        await adapter.generateJson(request);
        assert.deepEqual(body.response_format, { type: 'json_object' }, item.name);
      } else {
        await collectStream(adapter.generateTextStream(request));
        assert.equal(body.response_format, undefined, item.name);
      }
      assert.deepEqual(body.thinking, item.expectedThinking, `${method}: ${item.name}`);
      assert.equal(body.reasoning_effort, item.expectedEffort,
        `${method}: ${item.name}`);
    }
  }
});

test('uses stable official prompt cache controls only on supported non-ephemeral requests', async () => {
  let openAIBody;
  const openAI = createProviderAdapter({
    providerId: 'openai',
    config: { apiKey: 'key', model: 'gpt-5-mini' },
    fetchImpl: async (url, options) => {
      openAIBody = JSON.parse(options.body);
      return jsonResponse({ output_text: '{"ok":true}' });
    }
  });
  await openAI.generateJson({
    systemPrompt: 'SYSTEM', userPrompt: '{}', responseSchema: { type: 'object' },
    conversationKey: 'paper-hash-1'
  });
  assert.equal(openAIBody.prompt_cache_key, 'brevess:paper-hash-1');

  let anthropicBody;
  const anthropic = createProviderAdapter({
    providerId: 'anthropic',
    config: { apiKey: 'key', model: 'claude-sonnet-4-6' },
    fetchImpl: async (url, options) => {
      anthropicBody = JSON.parse(options.body);
      return jsonResponse({ content: [{ type: 'text', text: '{"ok":true}' }] });
    }
  });
  await anthropic.generateJson({
    systemPrompt: 'SYSTEM', userPrompt: '{}', responseSchema: { type: 'object' }
  });
  assert.deepEqual(anthropicBody.cache_control, { type: 'ephemeral' });
  await anthropic.generateJson({
    systemPrompt: 'SYSTEM', userPrompt: '{}', responseSchema: { type: 'object' },
    ephemeral: true
  });
  assert.equal(anthropicBody.cache_control, undefined);
});

test('does not send official prompt-cache controls through custom provider endpoints', async () => {
  for (const [providerId, config, response] of [
    ['openai', {
      apiKey: 'key', model: 'gpt-5-mini', baseUrl: 'https://gateway.example/v1/responses'
    }, { output_text: '{"ok":true}' }],
    ['anthropic', {
      apiKey: 'key', model: 'claude-sonnet-4-6', baseUrl: 'https://gateway.example/messages'
    }, { content: [{ type: 'text', text: '{"ok":true}' }] }]
  ]) {
    let body;
    const adapter = createProviderAdapter({
      providerId, config,
      fetchImpl: async (url, options) => {
        body = JSON.parse(options.body);
        return jsonResponse(response);
      }
    });
    await adapter.generateJson({
      systemPrompt: 'SYSTEM', userPrompt: '{}', responseSchema: { type: 'object' },
      conversationKey: 'paper-hash-1'
    });
    assert.equal(body.prompt_cache_key, undefined, providerId);
    assert.equal(body.cache_control, undefined, providerId);
  }
});

test('serializes Figure pixels for verified visual providers', async () => {
  const figureResponse = {
    figure_id: 'figure-1',
    basis: 'vision_text',
    panels: [],
    logic_chain_zh: ['先观察'],
    core_conclusion_zh: '核心结论',
    caveat_zh: ''
  };
  const figureRequest = {
    systemPrompt: 'FIGURE SYSTEM',
    userPrompt: '{"figure_id":"figure-1"}',
    schemaName: 'figure_walkthrough',
    responseSchema: {
      type: 'object',
      properties: { figure_id: { type: 'string' } },
      required: ['figure_id']
    },
    images: [{ mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AA==' }]
  };

  for (const providerId of ['openai', 'anthropic', 'gemini']) {
    let requestBody;
    const fetchImpl = async (url, options) => {
      requestBody = JSON.parse(options.body);
      return jsonResponse(
        providerId === 'openai' ? { output_text: JSON.stringify(figureResponse) } :
          providerId === 'anthropic' ? {
            content: [{ type: 'text', text: JSON.stringify(figureResponse) }]
          } :
            providerId === 'gemini' ? {
              candidates: [{ content: { parts: [{ text: JSON.stringify(figureResponse) }] } }]
            } : {}
      );
    };
    const adapter = createProviderAdapter({
      providerId,
      config: providerConfigFor(providerId),
      fetchImpl
    });
    assert.equal((await adapter.generateJson(figureRequest)).figure_id, 'figure-1');

    if (providerId === 'openai') {
      assert.equal(requestBody.input[0].content[0].type, 'input_text');
      assert.equal(requestBody.input[0].content[1].type, 'input_image');
      assert.equal(requestBody.input[0].content[1].image_url, 'data:image/jpeg;base64,AA==');
    } else if (providerId === 'anthropic') {
      assert.equal(requestBody.messages[0].content[1].type, 'image');
      assert.equal(requestBody.messages[0].content[1].source.media_type, 'image/jpeg');
      assert.equal(requestBody.messages[0].content[1].source.data, 'AA==');
    } else if (providerId === 'gemini') {
      assert.equal(requestBody.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
      assert.equal(requestBody.contents[0].parts[1].inlineData.data, 'AA==');
    }
    assert.match(JSON.stringify(requestBody), /data:image|AA==/);
  }
});

test('never serializes images into a text-only official DeepSeek request', async () => {
  let body;
  const adapter = createProviderAdapter({
    providerId: 'deepseek',
    config: { apiKey: 'key', model: 'deepseek-v4-pro' },
    fetchImpl: async (url, options) => {
      body = JSON.parse(options.body);
      return sseResponse(JSON.stringify({ figure_id: 'figure-1' }));
    }
  });
  await adapter.generateJson({
    systemPrompt: 'SYSTEM',
    userPrompt: 'PROMPT',
    schemaName: 'figure_walkthrough',
    responseSchema: { type: 'object' },
    images: [{ dataUrl: 'data:image/jpeg;base64,AA==' }]
  });
  assert.equal(body.messages[1].content, 'PROMPT');
  assert.doesNotMatch(JSON.stringify(body), /image_url|data:image/);
});

test('serializes raster images for the official DeepSeek vision model', async () => {
  let body;
  const adapter = createProviderAdapter({
    providerId: 'deepseek',
    config: {
      apiKey: 'key', model: 'deepseek-v4-flash-vision-exp',
      reasoningEnabled: false, reasoningEffort: 'max'
    },
    fetchImpl: async (url, options) => {
      body = JSON.parse(options.body);
      return sseResponse(JSON.stringify({ figure_id: 'figure-1' }));
    }
  });
  await adapter.generateJson({
    systemPrompt: 'SYSTEM',
    userPrompt: 'PROMPT',
    schemaName: 'figure_walkthrough',
    responseSchema: { type: 'object' },
    images: [{ dataUrl: 'data:image/jpeg;base64,AA==' }]
  });
  assert.equal(body.messages[1].content[0].type, 'text');
  assert.equal(body.messages[1].content[1].type, 'image_url');
  assert.equal(body.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,AA==');
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.reasoning_effort, undefined);
});

test('serializes compatible images only after explicit vision opt-in', async () => {
  async function capture(supportsVision) {
    let body;
    const adapter = createProviderAdapter({
      providerId: 'openai-compatible',
      config: {
        apiKey: 'key', model: 'vision-model', baseUrl: 'https://gateway.example/v1',
        supportsVision
      },
      fetchImpl: async (url, options) => {
        body = JSON.parse(options.body);
        return jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] });
      }
    });
    await adapter.generateJson({
      systemPrompt: 'SYSTEM', userPrompt: 'PROMPT', responseSchema: { type: 'object' },
      images: [{ dataUrl: 'data:image/jpeg;base64,AA==' }]
    });
    return body;
  }
  assert.doesNotMatch(JSON.stringify(await capture(false)), /image_url|data:image/);
  assert.match(JSON.stringify(await capture(true)), /image_url/);
});

test('builds an OpenAI Responses API request with strict annotation schema', async () => {
  const adapter = createProviderAdapter({
    providerId: 'openai',
    config: { apiKey: 'openai-secret', model: 'gpt-5-mini' },
    fetchImpl: captureFetch({ output_text: annotationJson }, (url, options, body) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.headers.Authorization, 'Bearer openai-secret');
      assert.equal(body.instructions, 'SYSTEM');
      assert.equal(body.input, analysisRequest.userPrompt);
      assert.equal(body.store, false);
      assert.equal(body.text.format.type, 'json_schema');
      assert.deepEqual(body.text.format.schema.properties.annotations.items.properties.category_id.enum, ['result']);
    })
  });
  assert.deepEqual(await adapter.analyzeChunk(analysisRequest), JSON.parse(annotationJson));
});

test('builds an Anthropic Messages request with top-level system prompt', async () => {
  const adapter = createProviderAdapter({
    providerId: 'anthropic',
    config: { apiKey: 'anthropic-secret', model: 'claude-sonnet-4-6' },
    fetchImpl: captureFetch({ content: [{ type: 'text', text: annotationJson }] }, (url, options, body) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(options.headers['x-api-key'], 'anthropic-secret');
      assert.equal(options.headers['anthropic-version'], '2023-06-01');
      assert.equal(body.system, 'SYSTEM');
      assert.equal(body.messages[0].role, 'user');
    })
  });
  assert.deepEqual(await adapter.analyzeChunk(analysisRequest), JSON.parse(annotationJson));
});

test('builds a Gemini generateContent request with JSON output', async () => {
  const adapter = createProviderAdapter({
    providerId: 'gemini',
    config: { apiKey: 'gemini-secret', model: 'gemini-3.5-flash' },
    fetchImpl: captureFetch({ candidates: [{ content: { parts: [{ text: annotationJson }] } }] }, (url, options, body) => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
      assert.equal(options.headers['x-goog-api-key'], 'gemini-secret');
      assert.equal(body.systemInstruction.parts[0].text, 'SYSTEM');
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
    })
  });
  assert.deepEqual(await adapter.analyzeChunk(analysisRequest), JSON.parse(annotationJson));
});

test('builds a non-streaming DeepSeek Chat Completions request in non-thinking JSON mode', async () => {
  const adapter = createProviderAdapter({
    providerId: 'deepseek',
    config: {
      apiKey: 'deepseek-secret', model: 'deepseek-v4-flash',
      reasoningEnabled: false, reasoningEffort: 'high'
    },
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(url, 'https://api.deepseek.com/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer deepseek-secret');
      assert.equal(body.response_format.type, 'json_object');
      assert.deepEqual(body.thinking, { type: 'disabled' });
      assert.equal(body.reasoning_effort, undefined);
      assert.equal(body.stream, false);
      assert.equal(body.stream_options, undefined);
      assert.deepEqual(body.messages.map(item => item.role), ['system', 'user']);
      return sseResponse(annotationJson);
    }
  });
  assert.deepEqual(await adapter.analyzeChunk(analysisRequest), JSON.parse(annotationJson));
});

test('parses DeepSeek SSE comments and concatenates JSON content deltas', async () => {
  const parsed = await requestSseJson(
    async () => sseResponse(annotationJson),
    'https://api.deepseek.com/chat/completions',
    { method: 'POST', body: '{"stream":true}' }
  );
  assert.deepEqual(parsed, JSON.parse(annotationJson));
});

test('marks an empty DeepSeek JSON-mode content response as retryable', async () => {
  const adapter = createProviderAdapter({
    providerId: 'deepseek',
    config: { apiKey: 'deepseek-secret', model: 'deepseek-v4-flash' },
    fetchImpl: async () => sseResponse('')
  });
  await assert.rejects(
    () => adapter.analyzeChunk(analysisRequest),
    error => error.code === 'INVALID_RESPONSE' && error.retryable === true
  );
});

test('supports an editable OpenAI-compatible endpoint and custom auth header', async () => {
  const adapter = createProviderAdapter({
    providerId: 'openai-compatible',
    config: {
      apiKey: 'custom-secret',
      model: 'local-model',
      baseUrl: 'https://gateway.example/v1',
      authHeader: 'X-API-Key',
      authPrefix: ''
    },
    fetchImpl: captureFetch({ choices: [{ message: { content: `\n\`\`\`json\n${annotationJson}\n\`\`\`` } }] }, (url, options, body) => {
      assert.equal(url, 'https://gateway.example/v1/chat/completions');
      assert.equal(options.headers['X-API-Key'], 'custom-secret');
      assert.equal(body.model, 'local-model');
    })
  });
  assert.deepEqual(await adapter.analyzeChunk(analysisRequest), JSON.parse(annotationJson));
});

test('maps authentication failures without exposing provider response bodies', async () => {
  const adapter = createProviderAdapter({
    providerId: 'openai',
    config: { apiKey: 'secret', model: 'gpt-5-mini' },
    fetchImpl: async () => jsonResponse({ error: { message: 'secret provider detail' } }, 401)
  });
  await assert.rejects(
    () => adapter.analyzeChunk(analysisRequest),
    error => error.code === 'AUTH_INVALID' && !error.message.includes('secret provider detail')
  );
});

test('preserves Retry-After guidance from an overloaded provider', async () => {
  const overloadedFetch = async () => ({
    ok: false,
    status: 503,
    headers: { get: name => name.toLowerCase() === 'retry-after' ? '7' : null },
    async text() { return ''; }
  });
  await assert.rejects(
    () => requestJson(overloadedFetch, 'https://provider.example/test', {}),
    error => error.code === 'PROVIDER_UNAVAILABLE' &&
      error.status === 503 && error.retryAfterMs === 7000
  );
});

test('marks a length-terminated DeepSeek stream as output truncation', async () => {
  const truncatedFetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return `data: ${JSON.stringify({
        choices: [{ delta: { content: '{"partial":true' }, finish_reason: 'length' }]
      })}\n\ndata: [DONE]\n`;
    }
  });
  await assert.rejects(
    () => requestSseJson(truncatedFetch, 'https://api.deepseek.com/chat/completions', {}),
    error => error.code === 'OUTPUT_TRUNCATED'
  );
});

test('maps response body stream failures to a retryable network error', async () => {
  const fetchWithBrokenBody = async () => ({
    ok: true,
    status: 200,
    async text() {
      throw new TypeError('Failed to fetch');
    }
  });

  await assert.rejects(
    () => requestJson(fetchWithBrokenBody, 'https://provider.example/test', {}),
    error => error.code === 'NETWORK_ERROR' &&
      error.retryable === true &&
      error.diagnosticStage === 'response-body' &&
      error.diagnosticType === 'TypeError' &&
      error.status === 200 &&
      error.requestBytes === 0 &&
      Number.isFinite(error.elapsedMs)
  );
});

test('distinguishes request establishment failures from response body failures', async () => {
  const fetchThatCannotConnect = async () => {
    throw new TypeError('Failed to fetch');
  };

  await assert.rejects(
    () => requestJson(fetchThatCannotConnect, 'https://provider.example/test', {
      method: 'POST', body: '{"probe":true}'
    }),
    error => error.code === 'NETWORK_ERROR' &&
      error.diagnosticStage === 'request' &&
      error.diagnosticType === 'TypeError' &&
      error.status === 0 &&
      error.requestBytes === 14 &&
      Number.isFinite(error.elapsedMs)
  );
});

test('aborts stalled provider requests with a retryable timeout error', async () => {
  const stalledFetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  });
  await assert.rejects(
    () => requestJson(stalledFetch, 'https://provider.example/test', { timeoutMs: 5 }),
    error => error.code === 'REQUEST_TIMEOUT' && error.retryable === true
  );
});

test('requestText locally settles when fetch ignores its abort signal forever', async () => {
  let requestSignal;
  const outcome = await observeSettlementWithin(requestText((url, options) => {
    requestSignal = options.signal;
    return new Promise(() => {});
  }, 'https://provider.example/test', { timeoutMs: 5 }));

  assert.equal(outcome.kind, 'rejected');
  assert.equal(outcome.error.code, 'REQUEST_TIMEOUT');
  assert.equal(outcome.error.retryable, true);
  assert.equal(outcome.error.status, 0);
  assert.equal(outcome.error.diagnosticStage, 'request');
  assert.equal(requestSignal.aborted, true);
});

test('requestText locally settles when a success reader ignores its abort signal forever', async () => {
  let cancelCalls = 0;
  let releaseCalls = 0;
  const outcome = await observeSettlementWithin(requestText(async () => ({
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    body: {
      getReader() {
        return {
          read() { return new Promise(() => {}); },
          cancel() { cancelCalls += 1; return new Promise(() => {}); },
          releaseLock() { releaseCalls += 1; }
        };
      }
    }
  }), 'https://provider.example/test', { timeoutMs: 5 }));

  assert.equal(outcome.kind, 'rejected');
  assert.equal(outcome.error.code, 'REQUEST_TIMEOUT');
  assert.equal(outcome.error.retryable, true);
  assert.equal(outcome.error.status, 200);
  assert.equal(outcome.error.diagnosticStage, 'response-body');
  assert.equal(cancelCalls, 1);
  assert.equal(releaseCalls, 1);
});

test('requestText locally settles when a response text facade ignores its abort signal forever', async () => {
  for (const mode of ['timeout', 'cancel']) {
    const raw = createDeferredPromise();
    const external = new AbortController();
    let textCalls = 0;
    let cancelCalls = 0;
    let markTextStarted;
    const textStarted = new Promise(resolve => { markTextStarted = resolve; });
    const pending = requestText(async () => ({
      ok: true,
      status: 200,
      headers: { get() { return null; } },
      body: {
        cancel() {
          cancelCalls += 1;
          return new Promise(() => {});
        }
      },
      text() {
        textCalls += 1;
        markTextStarted();
        return raw.promise;
      }
    }), 'https://provider.example/test', {
      signal: external.signal,
      timeoutMs: mode === 'timeout' ? 5 : 1_000
    });
    if (mode === 'cancel') {
      await textStarted;
      external.abort();
    }
    const outcome = await observeSettlementWithin(pending);

    assert.equal(outcome.kind, 'rejected', mode);
    assert.equal(outcome.error.code, mode === 'timeout' ? 'REQUEST_TIMEOUT' : 'CANCELLED', mode);
    assert.equal(outcome.error.retryable, mode === 'timeout', mode);
    assert.equal(outcome.error.status, 200, mode);
    assert.equal(outcome.error.diagnosticStage, 'response-body', mode);
    assert.equal(textCalls, 1, mode);
    assert.equal(cancelCalls, 1, mode);
    const lease = getProviderTransportLease(outcome.error);
    assert.ok(lease, mode);
    assert.equal(lease.isSettled(), false, mode);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(cancelCalls, 1, mode);
    assert.equal(lease.isSettled(), false, mode);
    raw.resolve('private late successful text');
    await lease.settlement;
    assert.equal(lease.isSettled(), true, mode);
    assert.equal(cancelCalls, 1, mode);
  }
});

test('requestJson locally settles when an HTTP 400 reader ignores its abort signal forever', async () => {
  let cancelCalls = 0;
  let releaseCalls = 0;
  let textCalls = 0;
  const outcome = await observeSettlementWithin(requestJson(async () => ({
    ok: false,
    status: 400,
    headers: { get() { return null; } },
    body: {
      getReader() {
        return {
          read() { return new Promise(() => {}); },
          cancel() { cancelCalls += 1; return new Promise(() => {}); },
          releaseLock() { releaseCalls += 1; }
        };
      }
    },
    text() { textCalls += 1; return Promise.resolve('must not use the fallback'); }
  }), 'https://provider.example/test', { timeoutMs: 5 }));

  assert.equal(outcome.kind, 'rejected');
  assert.equal(outcome.error.code, 'REQUEST_TIMEOUT');
  assert.equal(outcome.error.retryable, true);
  assert.equal(outcome.error.status, 400);
  assert.equal(outcome.error.diagnosticStage, 'response-body');
  assert.equal(cancelCalls, 1);
  assert.equal(releaseCalls, 1);
  assert.equal(textCalls, 0);
});

test('provider transport leases cannot be forged or discovered through hostile error facades', () => {
  assert.equal(typeof getProviderTransportLease, 'function');
  let getterCalls = 0;
  const externalError = new ProviderRequestError('REQUEST_TIMEOUT', 'external timeout', {
    retryable: true
  });
  Object.defineProperty(externalError, 'transportLease', {
    get() { getterCalls += 1; throw new Error('must not inspect external errors'); }
  });
  const hostileFacade = new Proxy(externalError, {
    get() { getterCalls += 1; throw new Error('must not inspect hostile error facades'); },
    getOwnPropertyDescriptor() {
      getterCalls += 1;
      throw new Error('must not reflect hostile error facades');
    }
  });

  assert.equal(getProviderTransportLease(externalError), null);
  assert.equal(getProviderTransportLease(hostileFacade), null);
  assert.equal(getProviderTransportLease(null), null);
  assert.equal(getterCalls, 0);
});

test('timed-out fetch, reader, and text waits expose one-shot physical settlement leases', async () => {
  const cases = [
    {
      name: 'fetch',
      request(raw) {
        return requestText(() => raw.promise, 'https://provider.example/test', { timeoutMs: 5 });
      },
      settle(raw) {
        raw.resolve({
          ok: true, status: 200, headers: { get() { return null; } },
          text() { throw new Error('late fetch bodies must not be consumed'); }
        });
      }
    },
    {
      name: 'reader.read',
      request(raw) {
        return requestText(async () => ({
          ok: true,
          status: 200,
          headers: { get() { return null; } },
          body: {
            getReader() {
              return {
                read() { return raw.promise; },
                cancel() {},
                releaseLock() {}
              };
            }
          }
        }), 'https://provider.example/test', { timeoutMs: 5 });
      },
      settle(raw) { raw.resolve({ done: true }); }
    },
    {
      name: 'response.text',
      request(raw) {
        return requestText(async () => ({
          ok: true, status: 200, headers: { get() { return null; } },
          text() { return raw.promise; }
        }), 'https://provider.example/test', { timeoutMs: 5 });
      },
      settle(raw) { raw.resolve('private late text'); }
    },
    {
      name: 'HTTP 400 response.text',
      request(raw) {
        return requestText(async () => ({
          ok: false, status: 400, headers: { get() { return null; } },
          text() { return raw.promise; }
        }), 'https://provider.example/test', { timeoutMs: 5 });
      },
      settle(raw) { raw.resolve('private late HTTP 400 text'); }
    }
  ];

  for (const item of cases) {
    const raw = createDeferredPromise();
    const outcome = await observeSettlementWithin(item.request(raw));
    assert.equal(outcome.kind, 'rejected', item.name);
    assert.equal(outcome.error.code, 'REQUEST_TIMEOUT', item.name);
    const lease = typeof getProviderTransportLease === 'function'
      ? getProviderTransportLease(outcome.error) : null;
    assert.ok(lease, item.name);
    assert.equal(Object.isFrozen(lease), true, item.name);
    assert.deepEqual(Object.keys(lease).sort(), ['isSettled', 'settlement'], item.name);
    assert.equal(lease.isSettled(), false, item.name);
    let settlementCalls = 0;
    lease.settlement.then(() => { settlementCalls += 1; });
    item.settle(raw);
    await lease.settlement;
    await Promise.resolve();
    assert.equal(lease.isSettled(), true, item.name);
    assert.equal(settlementCalls, 1, item.name);
    item.settle(raw);
    await Promise.resolve();
    assert.equal(settlementCalls, 1, item.name);
  }
});

test('external cancellation returns before a raw rejection and its lease settles exactly once', async () => {
  const raw = createDeferredPromise();
  const external = new AbortController();
  const pending = requestText(() => raw.promise, 'https://provider.example/test', {
    signal: external.signal,
    timeoutMs: 1_000
  });
  external.abort();
  const outcome = await observeSettlementWithin(pending);
  assert.equal(outcome.kind, 'rejected');
  assert.equal(outcome.error.code, 'CANCELLED');
  assert.equal(outcome.error.retryable, false);
  const lease = typeof getProviderTransportLease === 'function'
    ? getProviderTransportLease(outcome.error) : null;
  assert.ok(lease);
  assert.equal(lease.isSettled(), false);
  let settlementCalls = 0;
  lease.settlement.then(() => { settlementCalls += 1; });
  raw.reject(new Error('private late transport rejection'));
  await lease.settlement;
  await Promise.resolve();
  assert.equal(lease.isSettled(), true);
  assert.equal(settlementCalls, 1);
});

test('serializes the request-level output limit for every provider', async () => {
  const expectedField = {
    openai: 'max_output_tokens', anthropic: 'max_tokens', gemini: 'maxOutputTokens',
    deepseek: 'max_tokens', 'openai-compatible': 'max_tokens'
  };
  for (const providerId of Object.keys(expectedField)) {
    let captured;
    const adapter = createProviderAdapter({
      providerId,
      config: { ...providerConfigFor(providerId), maxOutputTokens: 1024 },
      fetchImpl: async (url, options) => {
        captured = JSON.parse(options.body);
        return successfulStructuredFetchFor(providerId)(url, options);
      }
    });
    await adapter.generateJson({
      systemPrompt: 'SYSTEM', userPrompt: '{"ok":true}', responseSchema: { type: 'object' },
      maxOutputTokens: 6656
    });
    const value = providerId === 'gemini'
      ? captured.generationConfig[expectedField[providerId]]
      : captured[expectedField[providerId]];
    assert.equal(value, 6656, providerId);
  }
});

test('normalizes non-stream provider length terminations as output truncation', async () => {
  const fixtures = {
    openai: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    anthropic: { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"ok":true}' }] },
    gemini: { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"ok":true}' }] } }] },
    'openai-compatible': { choices: [{ finish_reason: 'length', message: { content: '{"ok":true}' } }] }
  };
  for (const [providerId, fixture] of Object.entries(fixtures)) {
    const adapter = createProviderAdapter({
      providerId, config: providerConfigFor(providerId), fetchImpl: async () => jsonResponse(fixture)
    });
    await assert.rejects(
      () => adapter.generateJson({ systemPrompt: 'SYSTEM', userPrompt: '{}', responseSchema: { type: 'object' } }),
      error => error.code === 'OUTPUT_TRUNCATED', providerId
    );
  }
});

test('classifies only explicit token-limit HTTP 400 errors without exposing a provider body', async () => {
  const secret = 'do-not-expose-this-provider-detail';
  await assert.rejects(
    () => requestJson(async () => ({
      ok: false, status: 400, headers: { get: () => null },
      async text() { return JSON.stringify({ error: { message: `max_output_tokens must be <= 2048; ${secret}` } }); }
    }), 'https://provider.example/test', {}),
    error => error.code === 'TOKEN_LIMIT_REJECTED' && error.suggestedMaxOutputTokens === 2048 &&
      !error.message.includes(secret)
  );
  await assert.rejects(
    () => requestJson(async () => ({
      ok: false, status: 400, headers: { get: () => null },
      async text() { return JSON.stringify({ error: { message: `invalid JSON field; ${secret}` } }); }
    }), 'https://provider.example/test', {}),
    error => error.code === 'PROVIDER_REJECTED' && !error.message.includes(secret)
  );
  await assert.rejects(
    () => requestJson(async () => ({
      ok: false, status: 400, headers: { get: () => null },
      async text() { return JSON.stringify({ error: { message: `max_tokens is unsupported; ${secret}` } }); }
    }), 'https://provider.example/test', {}),
    error => error.code === 'PROVIDER_REJECTED' && error.suggestedMaxOutputTokens === undefined &&
      !error.message.includes(secret)
  );
});

test('rejects token-field HTTP 400 false positives without a limit comparison', async () => {
  for (const message of [
    'Bad type for max_tokens; trace 9999',
    'max_tokens must be an integer; request_id 9999',
    'max_tokens maximum is invalid; trace 12345'
  ]) {
    await assert.rejects(
      () => requestJson(async () => ({
        ok: false, status: 400, headers: { get: () => null },
        async text() { return JSON.stringify({ error: { message } }); }
      }), 'https://provider.example/test', {}),
      error => error.code === 'PROVIDER_REJECTED' && error.suggestedMaxOutputTokens === undefined,
      message
    );
  }
});

test('classifies only token-limit comparisons that bind a numeric cap', async () => {
  for (const message of [
    'max_tokens must be <= 4096',
    'maximum max_tokens is 4096',
    'max_tokens cannot exceed 4096',
    'allowed max_output_tokens: 4096'
  ]) {
    await assert.rejects(
      () => requestJson(async () => ({
        ok: false, status: 400, headers: { get: () => null },
        async text() { return JSON.stringify({ error: { message } }); }
      }), 'https://provider.example/test', {}),
      error => error.code === 'TOKEN_LIMIT_REJECTED' && error.suggestedMaxOutputTokens === 4096,
      message
    );
  }
});

test('falls back to a safe integer output limit for every provider', async () => {
  const expectedField = {
    openai: 'max_output_tokens', anthropic: 'max_tokens', gemini: 'maxOutputTokens',
    deepseek: 'max_tokens', 'openai-compatible': 'max_tokens'
  };
  for (const providerId of Object.keys(expectedField)) {
    for (const maxOutputTokens of [-1, 1.5, Infinity, NaN]) {
      let captured;
      const adapter = createProviderAdapter({
        providerId, config: providerConfigFor(providerId),
        fetchImpl: async (url, options) => {
          captured = JSON.parse(options.body);
          return successfulStructuredFetchFor(providerId)(url, options);
        }
      });
      await adapter.generateJson({ systemPrompt: 'SYSTEM', userPrompt: '{}', responseSchema: { type: 'object' }, maxOutputTokens });
      const value = providerId === 'gemini'
        ? captured.generationConfig[expectedField[providerId]]
        : captured[expectedField[providerId]];
      assert.equal(value, 4096, `${providerId}:${String(maxOutputTokens)}`);
    }
  }
});

test('attaches safe diagnostics to HTTP rejection and invalid JSON errors', async () => {
  await assert.rejects(
    () => requestJson(async () => ({
      ok: false, status: 400, headers: { get: () => null },
      async text() { return '{"error":"invalid"}'; }
    }), 'https://provider.example/test', { body: '汉' }),
    error => error.code === 'PROVIDER_REJECTED' && error.diagnosticStage === 'response-body' &&
      error.requestBytes === 3 && error.elapsedMs >= 0 && !('responseBody' in error)
  );
  await assert.rejects(
    () => requestJson(async () => ({ ok: true, status: 200, async text() { return '{'; } }),
    'https://provider.example/test', { body: '汉' }),
    error => error.code === 'INVALID_RESPONSE' && error.diagnosticStage === 'response-body' &&
      error.requestBytes === 3 && error.elapsedMs >= 0 && error.status === 200
  );
});

test('classifies a successful HTML login or interception page separately from malformed JSON', async () => {
  await assert.rejects(
    () => requestJson(async () => ({
      ok: true,
      status: 200,
      headers: { get: name => String(name).toLowerCase() === 'content-type'
        ? 'text/html; charset=utf-8' : null },
      async text() { return '<!doctype html><title>Campus login</title>'; }
    }), 'https://provider.example/test', { body: '{}' }),
    error => error.code === 'INVALID_RESPONSE' &&
      error.diagnosticType === 'HtmlResponse' && error.status === 200
  );
});

test('preserves HTTP 400 classification through bounded-reader failures and cleanup', async () => {
  const encode = value => new TextEncoder().encode(value);
  const cases = [
    {
      name: 'read throws',
      reader: { async read() { throw new Error('read failed'); }, async cancel() { throw new Error('cancel failed'); }, releaseLock() {} }
    },
    {
      name: 'decode throws',
      reader: { async read() { return { done: false, value: encode('max_tokens must be <= 2048') }; }, async cancel() {}, releaseLock() {} },
      decoder: true
    },
    {
      name: 'cancel rejects',
      reader: { async read() { return { done: false, value: encode(`max_tokens must be <= 2048${'x'.repeat(17000)}`) }; }, async cancel() { throw new Error('cancel failed'); }, releaseLock() {} }
    },
    {
      name: 'early done releases',
      released: false,
      reader: { async read() { return { done: true }; }, async cancel() {}, releaseLock() { this.released = true; } }
    }
  ];
  for (const item of cases) {
    const originalDecoder = globalThis.TextDecoder;
    if (item.decoder) globalThis.TextDecoder = class { decode() { throw new Error('decode failed'); } };
    try {
      await assert.rejects(
        () => requestJson(async () => ({
          ok: false, status: 400, headers: { get: () => null }, body: { getReader: () => item.reader },
          async text() { throw new Error('unbounded fallback'); }
        }), 'https://provider.example/test', {}),
        error => error.code === (item.name === 'cancel rejects' ? 'TOKEN_LIMIT_REJECTED' : 'PROVIDER_REJECTED'),
        item.name
      );
    } finally {
      globalThis.TextDecoder = originalDecoder;
    }
  }
  assert.equal(cases[3].reader.released, true);
});

test('reads no more than the first 16KB of an HTTP 400 response body', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode(`{"error":{"message":"max_tokens must be <= 2048;${'a'.repeat(8200)}`),
    encoder.encode(`${'b'.repeat(8200)}}}`),
    encoder.encode('this third chunk must not be consumed')
  ];
  let reads = 0;
  let cancelled = false;
  await assert.rejects(
    () => requestJson(async () => ({
      ok: false, status: 400, headers: { get: () => null },
      body: {
        getReader() {
          return {
            async read() {
              const value = chunks[reads++];
              return value ? { done: false, value } : { done: true };
            },
            async cancel() { cancelled = true; }
          };
        }
      },
      async text() { throw new Error('full body should not be read'); }
    }), 'https://provider.example/test', {}),
    error => error.code === 'TOKEN_LIMIT_REJECTED' && error.suggestedMaxOutputTokens === 2048
  );
  assert.equal(reads, 2);
  assert.equal(cancelled, true);
});

test('does not invoke an unbounded text fallback for a declared oversized HTTP 400 body', async () => {
  let textCalled = false;
  await assert.rejects(
    () => requestJson(async () => ({
      ok: false, status: 400,
      headers: { get: name => name.toLowerCase() === 'content-length' ? '20000' : null },
      async text() { textCalled = true; throw new Error('must not read an oversized body'); }
    }), 'https://provider.example/test', {}),
    error => error.code === 'PROVIDER_REJECTED'
  );
  assert.equal(textCalled, false);
});

test('rejects a declared oversized successful provider body before reading it', async () => {
  assert.equal(MAX_NON_STREAM_RESPONSE_BYTES, 4 * 1024 * 1024);
  const secret = 'oversized-provider-body-secret';
  let reads = 0;
  let textCalls = 0;
  let cancelled = 0;
  let released = 0;
  await assert.rejects(
    () => requestText(async () => ({
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-length'
            ? String(MAX_NON_STREAM_RESPONSE_BYTES + 1) : null;
        }
      },
      body: {
        cancel() {},
        getReader() {
          return {
            async read() { reads += 1; return { done: false, value: new TextEncoder().encode(secret) }; },
            async cancel() { cancelled += 1; },
            releaseLock() { released += 1; }
          };
        }
      },
      async text() { textCalls += 1; return secret; }
    }), 'https://provider.example/test', {}),
    error => {
      assert.equal(error.code, 'INVALID_RESPONSE');
      assert.equal(error.message, 'Provider response body exceeded the 4 MiB limit');
      assert.equal(error.retryable, false);
      assert.equal(error.diagnosticStage, 'response-body');
      assert.equal(error.diagnosticType, 'ResponseLimitError');
      assert.equal(error.status, 200);
      assert.doesNotMatch(JSON.stringify(error), new RegExp(secret));
      return true;
    }
  );
  assert.equal(reads, 0);
  assert.equal(textCalls, 0);
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test('accepts an exact-limit streamed body after confirming done across a split UTF-8 character', async () => {
  const encoder = new TextEncoder();
  const multibyte = encoder.encode('汉');
  const chunks = [
    encoder.encode('a'.repeat(MAX_NON_STREAM_RESPONSE_BYTES - multibyte.length)),
    multibyte.subarray(0, 1),
    multibyte.subarray(1)
  ];
  let reads = 0;
  let cancelled = 0;
  let released = 0;
  const text = await requestText(async () => ({
    ok: true,
    status: 200,
    headers: { get: name => String(name).toLowerCase() === 'content-length'
      ? String(MAX_NON_STREAM_RESPONSE_BYTES) : null },
    body: {
      cancel() {},
      getReader() {
        return {
          async read() {
            const value = chunks[reads++];
            return value ? { done: false, value } : { done: true };
          },
          async cancel() { cancelled += 1; },
          releaseLock() { released += 1; throw new Error('completed release failure'); }
        };
      }
    }
  }), 'https://provider.example/test', {});

  assert.equal(encoder.encode(text).length, MAX_NON_STREAM_RESPONSE_BYTES);
  assert.equal(text.endsWith('汉'), true);
  assert.equal(reads, chunks.length + 1);
  assert.equal(cancelled, 0);
  assert.equal(released, 1);
});

test('rejects streamed success bytes beyond the limit and best-effort cleans the reader', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    new Uint8Array(MAX_NON_STREAM_RESPONSE_BYTES - 1).fill(97),
    new Uint8Array(0),
    encoder.encode('汉').buffer
  ];
  let reads = 0;
  let cancelled = 0;
  let released = 0;
  await assert.rejects(
    () => requestText(async () => ({
      ok: true,
      status: 200,
      headers: { get: name => String(name).toLowerCase() === 'content-length' ? '1' : null },
      body: {
        cancel() {},
        getReader() {
          return {
            async read() {
              const value = chunks[reads++];
              return value ? { done: false, value } : { done: true };
            },
            async cancel() { cancelled += 1; },
            releaseLock() { released += 1; }
          };
        }
      }
    }), 'https://provider.example/test', {}),
    error => error.code === 'INVALID_RESPONSE' &&
      error.retryable === false &&
      error.diagnosticType === 'ResponseLimitError'
  );
  assert.equal(reads, 3, 'an empty chunk after the limit is not proof of completion');
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test('uses the bounded reader for exact and overflowing unmodified same-realm Responses', async () => {
  const encoder = new TextEncoder();
  const makeResponse = chunks => {
    const state = { pulls: 0, cancelled: 0 };
    const response = new Response(new ReadableStream({
      pull(controller) {
        const value = chunks[state.pulls++];
        if (value) controller.enqueue(value);
        else controller.close();
      },
      cancel() { state.cancelled += 1; }
    }, { highWaterMark: 0 }));
    return { response, state };
  };
  const multibyte = encoder.encode('汉');
  const exact = makeResponse([
    encoder.encode('a'.repeat(MAX_NON_STREAM_RESPONSE_BYTES - multibyte.length)),
    multibyte
  ]);
  const overflow = makeResponse([
    new Uint8Array(MAX_NON_STREAM_RESPONSE_BYTES).fill(97),
    Uint8Array.of(98)
  ]);

  const accepted = await requestText(async () => exact.response,
    'https://provider.example/test', {});
  assert.equal(encoder.encode(accepted).length, MAX_NON_STREAM_RESPONSE_BYTES);
  assert.equal(accepted.endsWith('汉'), true);
  assert.deepEqual(exact.state, { pulls: 3, cancelled: 0 });
  assert.equal(exact.response.body.locked, false);

  await assert.rejects(
    () => requestText(async () => overflow.response, 'https://provider.example/test', {}),
    error => error.code === 'INVALID_RESPONSE' &&
      error.retryable === false &&
      error.diagnosticType === 'ResponseLimitError'
  );
  assert.deepEqual(overflow.state, { pulls: 2, cancelled: 1 });
  assert.equal(overflow.response.body.locked, false);
});

test('measures text-only compatibility responses by UTF-8 bytes after reading', async () => {
  const multibyteCount = (MAX_NON_STREAM_RESPONSE_BYTES - 1) / 3;
  const exact = `a${'汉'.repeat(multibyteCount)}`;
  const overflow = `aa${'汉'.repeat(multibyteCount)}`;
  assert.equal(new TextEncoder().encode(exact).length, MAX_NON_STREAM_RESPONSE_BYTES);
  assert.equal(new TextEncoder().encode(overflow).length, MAX_NON_STREAM_RESPONSE_BYTES + 1);

  const accepted = await requestText(async () => ({
    ok: true, status: 200, headers: { get() { return null; } }, async text() { return exact; }
  }), 'https://provider.example/test', {});
  assert.equal(accepted, exact);
  await assert.rejects(
    () => requestText(async () => ({
      ok: true, status: 200, headers: { get() { return null; } }, async text() { return overflow; }
    }), 'https://provider.example/test', {}),
    error => error.code === 'INVALID_RESPONSE' &&
      error.diagnosticStage === 'response-body' &&
      error.diagnosticType === 'ResponseLimitError' &&
      error.retryable === false
  );
});

test('keeps timeout and cancellation canonical while a success body reader is pending', async () => {
  const createPendingFetch = started => async (url, options) => ({
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    body: {
      cancel() {},
      getReader() {
        return {
          read() {
            started?.();
            return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
              reject(Object.assign(new Error('private abort detail'), { name: 'AbortError' }));
            }, { once: true }));
          },
          async cancel() {},
          releaseLock() {}
        };
      }
    }
  });

  await assert.rejects(
    () => requestText(createPendingFetch(), 'https://provider.example/test', { timeoutMs: 5 }),
    error => error.code === 'REQUEST_TIMEOUT' && error.retryable === true
  );

  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const controller = new AbortController();
  const pending = requestText(
    createPendingFetch(markStarted), 'https://provider.example/test',
    { signal: controller.signal, timeoutMs: 1000 }
  );
  await started;
  controller.abort();
  await assert.rejects(
    () => pending,
    error => error.code === 'CANCELLED' && error.retryable === false
  );
});

test('counts ArrayBuffer chunks despite an underreported length and preserves limit errors through cleanup failure', async () => {
  const chunks = [
    new Uint8Array(MAX_NON_STREAM_RESPONSE_BYTES).fill(97).buffer,
    Uint8Array.of(98).buffer
  ];
  let reads = 0;
  let cancelAttempts = 0;
  let releaseAttempts = 0;
  await assert.rejects(
    () => requestText(async () => ({
      ok: true,
      status: 200,
      headers: { get: name => String(name).toLowerCase() === 'content-length' ? '1' : null },
      body: {
        cancel() {},
        getReader() {
          return {
            async read() {
              const value = chunks[reads++];
              return value ? { done: false, value } : { done: true };
            },
            async cancel() {
              cancelAttempts += 1;
              throw new Error('private cancel failure');
            },
            releaseLock() {
              releaseAttempts += 1;
              throw new Error('private release failure');
            }
          };
        }
      }
    }), 'https://provider.example/test', {}),
    error => {
      assert.equal(error.code, 'INVALID_RESPONSE');
      assert.equal(error.message, 'Provider response body exceeded the 4 MiB limit');
      assert.equal(error.diagnosticType, 'ResponseLimitError');
      assert.doesNotMatch(JSON.stringify(error), /private (?:cancel|release) failure/);
      return true;
    }
  );
  assert.equal(reads, 2);
  assert.equal(cancelAttempts, 1);
  assert.equal(releaseAttempts, 1);
});

test('rejects a streamed multibyte body whose character count fits but UTF-8 bytes overflow', async () => {
  const text = '汉'.repeat(Math.floor(MAX_NON_STREAM_RESPONSE_BYTES / 3) + 1);
  assert.equal(text.length < MAX_NON_STREAM_RESPONSE_BYTES, true);
  const bytes = new TextEncoder().encode(text);
  assert.equal(bytes.length > MAX_NON_STREAM_RESPONSE_BYTES, true);
  let cancelled = 0;
  let released = 0;
  await assert.rejects(
    () => requestText(async () => ({
      ok: true,
      status: 200,
      headers: { get() { return 'malformed-size'; } },
      body: {
        cancel() {},
        getReader() {
          let delivered = false;
          return {
            async read() {
              if (delivered) return { done: true };
              delivered = true;
              return { done: false, value: bytes };
            },
            async cancel() { cancelled += 1; },
            releaseLock() { released += 1; }
          };
        }
      }
    }), 'https://provider.example/test', {}),
    error => error.code === 'INVALID_RESPONSE' && error.diagnosticType === 'ResponseLimitError'
  );
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test('does not trust underreported or malformed lengths on text-only compatibility responses', async () => {
  const oversized = `aa${'汉'.repeat((MAX_NON_STREAM_RESPONSE_BYTES - 1) / 3)}`;
  await assert.rejects(
    () => requestText(async () => ({
      ok: true,
      status: 200,
      headers: { get: name => String(name).toLowerCase() === 'content-length' ? '1' : null },
      async text() { return oversized; }
    }), 'https://provider.example/test', {}),
    error => error.code === 'INVALID_RESPONSE' && error.diagnosticType === 'ResponseLimitError'
  );

  let textCalls = 0;
  const accepted = await requestText(async () => ({
    ok: true,
    status: 200,
    headers: { get() { return 'not-a-content-length'; } },
    async text() { textCalls += 1; return '{"ok":true}'; }
  }), 'https://provider.example/test', {});
  assert.equal(accepted, '{"ok":true}');
  assert.equal(textCalls, 1);
});

test('does not misclassify a request-stage error that spoofs the response limit identity', async () => {
  const transportError = Object.assign(new Error('private transport detail'), {
    name: 'ResponseLimitError',
    code: 'RESPONSE_BODY_TOO_LARGE'
  });
  await assert.rejects(
    () => requestText(async () => { throw transportError; }, 'https://provider.example/test', {}),
    error => error.code === 'NETWORK_ERROR' &&
      error.retryable === true &&
      error.diagnosticStage === 'request' &&
      error.diagnosticType === 'ResponseLimitError' &&
      error.message === 'Unable to reach the provider' &&
      !JSON.stringify(error).includes('private transport detail')
  );
});

test('accepts only decimal Content-Length syntax before checking the actual success body', async () => {
  const invalidValues = [
    `+${MAX_NON_STREAM_RESPONSE_BYTES + 1}`,
    '0x400001',
    '4.194305e6',
    '4194305.0',
    '4194305, 1'
  ];
  for (const value of invalidValues) {
    let textCalls = 0;
    const text = await requestText(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'cOnTeNt-LeNgTh': value }),
      async text() { textCalls += 1; return '{"ok":true}'; }
    }), 'https://provider.example/test', {});
    assert.equal(text, '{"ok":true}', value);
    assert.equal(textCalls, 1, value);
  }

  let oversizedTextCalls = 0;
  await assert.rejects(
    () => requestText(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({
        'cOnTeNt-LeNgTh': ` 000${MAX_NON_STREAM_RESPONSE_BYTES + 1} `
      }),
      async text() { oversizedTextCalls += 1; return '{"unreachable":true}'; }
    }), 'https://provider.example/test', {}),
    error => error.code === 'INVALID_RESPONSE' && error.diagnosticType === 'ResponseLimitError'
  );
  assert.equal(oversizedTextCalls, 0);
});

test('preserves a stricter response facade policy over an exposed native ReadableStream', async () => {
  let readerCalls = 0;
  let textCalls = 0;
  const facadeError = new ProviderRequestError(
    'STRICTER_RESPONSE_LIMIT', 'STRICTER_RESPONSE_LIMIT', { retryable: false }
  );
  const nativeResponse = new Response(new Uint8Array(256 * 1024 + 1));
  const nativeGetReader = nativeResponse.body.getReader.bind(nativeResponse.body);
  nativeResponse.body.getReader = () => {
    readerCalls += 1;
    return nativeGetReader();
  };
  await assert.rejects(
    () => requestText(async () => ({
      ok: true,
      status: 200,
      headers: nativeResponse.headers,
      body: nativeResponse.body,
      async text() {
        textCalls += 1;
        throw facadeError;
      }
    }), 'https://provider.example/test', {}),
    error => error === facadeError
  );
  assert.equal(readerCalls, 0);
  assert.equal(textCalls, 1);
});

test('preserves an inherited response facade policy over an exposed native ReadableStream', async () => {
  const nativeResponse = new Response(new Uint8Array(256 * 1024 + 1));
  let textCalls = 0;
  const facadeError = new ProviderRequestError(
    'STRICTER_RESPONSE_LIMIT', 'STRICTER_RESPONSE_LIMIT', { retryable: false }
  );
  class ResponseFacade {
    constructor(response) {
      this.ok = response.ok;
      this.status = response.status;
      this.headers = response.headers;
      this.body = response.body;
    }

    async text() {
      textCalls += 1;
      throw facadeError;
    }
  }

  await assert.rejects(
    () => requestText(async () => new ResponseFacade(nativeResponse),
      'https://provider.example/test', {}),
    error => error === facadeError
  );
  assert.equal(textCalls, 1);
  assert.equal(nativeResponse.bodyUsed, false);
});

test('resolves own and inherited text accessors once and never falls back to their body reader', async () => {
  for (const placement of ['own-callable', 'inherited-throwing']) {
    const nativeResponse = new Response('{"ok":true}');
    let getterCalls = 0;
    let textCalls = 0;
    const prototype = {};
    const inherited = placement.startsWith('inherited');
    const facade = Object.create(inherited ? prototype : Object.prototype);
    Object.assign(facade, {
      ok: true,
      status: 200,
      headers: nativeResponse.headers,
      body: nativeResponse.body
    });
    Object.defineProperty(inherited ? prototype : facade, 'text', {
      configurable: true,
      get() {
        getterCalls += 1;
        if (inherited) throw new Error('private hostile text getter');
        return async function facadeText() {
          textCalls += 1;
          throw new ProviderRequestError(
            'STRICTER_RESPONSE_LIMIT', 'STRICTER_RESPONSE_LIMIT', { retryable: false }
          );
        };
      }
    });

    await assert.rejects(
      () => requestText(async () => facade, 'https://provider.example/test', {}),
      error => inherited
        ? error.code === 'NETWORK_ERROR' &&
          error.diagnosticStage === 'response-body' &&
          error.message === 'Unable to reach the provider' &&
          !JSON.stringify(error).includes('private hostile text getter')
        : error.code === 'STRICTER_RESPONSE_LIMIT',
      placement
    );
    assert.equal(getterCalls, 1, placement);
    assert.equal(textCalls, inherited ? 0 : 1, placement);
    assert.equal(nativeResponse.bodyUsed, false, placement);
  }
});

test('does not grant the native reader path to an object spoofing Response.prototype', async () => {
  let readerCalls = 0;
  const spoof = Object.create(Response.prototype);
  Object.defineProperties(spoof, {
    ok: { value: true },
    status: { value: 200 },
    headers: { value: { get() { return null; } } },
    body: {
      value: {
        getReader() {
          readerCalls += 1;
          return {
            async read() { return { done: true }; },
            async cancel() {},
            releaseLock() {}
          };
        }
      }
    }
  });

  await assert.rejects(
    () => requestText(async () => spoof, 'https://provider.example/test', {}),
    error => error.code === 'NETWORK_ERROR' && error.diagnosticStage === 'response-body'
  );
  assert.equal(readerCalls, 0);
});

test('honors callable text policies inherited from a foreign realm before reading the body', async () => {
  const nativeResponse = new Response('{"bypassed":true}');
  const state = { textCalls: 0 };
  const facadeError = new ProviderRequestError(
    'STRICTER_RESPONSE_LIMIT', 'STRICTER_RESPONSE_LIMIT', { retryable: false }
  );
  const facade = vm.runInNewContext(`new (class ForeignResponseFacade {
    async text() {
      state.textCalls += 1;
      throw facadeError;
    }
  })()`, { state, facadeError });
  Object.assign(facade, {
    ok: true,
    status: 200,
    headers: nativeResponse.headers,
    body: nativeResponse.body
  });

  await assert.rejects(
    () => requestText(async () => facade, 'https://provider.example/test', {}),
    error => error === facadeError
  );
  assert.equal(state.textCalls, 1);
  assert.equal(nativeResponse.bodyUsed, false);
});

test('fails closed on response reflection traps without consulting an exposed body reader', async () => {
  const nativeResponse = new Response('{"bypassed":true}');
  let bodyGets = 0;
  const facade = new Proxy({
    ok: true,
    status: 200,
    headers: nativeResponse.headers,
    body: nativeResponse.body
  }, {
    get(target, key, receiver) {
      if (key === 'body') bodyGets += 1;
      return Reflect.get(target, key, receiver);
    },
    getOwnPropertyDescriptor(target, key) {
      if (key === 'text') throw new Error('private reflection trap');
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });

  await assert.rejects(
    () => requestText(async () => facade, 'https://provider.example/test', {}),
    error => error.code === 'NETWORK_ERROR' &&
      error.diagnosticStage === 'response-body' &&
      error.message === 'Unable to reach the provider' &&
      !JSON.stringify(error).includes('private reflection trap')
  );
  assert.equal(bodyGets, 0);
  assert.equal(nativeResponse.bodyUsed, false);
});

test('honors own and subclass text overrides instead of granting the native reader path', async () => {
  for (const kind of ['own', 'subclass']) {
    let textCalls = 0;
    const facadeError = new ProviderRequestError(
      'STRICTER_RESPONSE_LIMIT', 'STRICTER_RESPONSE_LIMIT', { retryable: false }
    );
    let response;
    if (kind === 'own') {
      response = new Response('{"bypassed":true}');
      Object.defineProperty(response, 'text', {
        configurable: true,
        value: async () => {
          textCalls += 1;
          throw facadeError;
        }
      });
    } else {
      response = new (class StrictResponse extends Response {
        async text() {
          textCalls += 1;
          throw facadeError;
        }
      })('{"bypassed":true}');
    }

    await assert.rejects(
      () => requestText(async () => response, 'https://provider.example/test', {}),
      error => error === facadeError,
      kind
    );
    assert.equal(textCalls, 1, kind);
    assert.equal(response.bodyUsed, false, kind);
  }
});

test('keeps external cancellation canonical and cleans a late inherited facade response', async () => {
  let textCalls = 0;
  let nativeResponse;
  const externalController = new AbortController();
  const pending = requestText(async (url, options) => {
    nativeResponse = new Response(new ReadableStream({
      start(controller) {
        options.signal.addEventListener('abort', () => controller.error(Object.assign(
          new Error('private delayed body abort'), { name: 'AbortError' }
        )), { once: true });
      }
    }));
    class ResponseFacade {
      constructor() {
        this.ok = true;
        this.status = 200;
        this.headers = nativeResponse.headers;
        this.body = nativeResponse.body;
      }

      text() {
        textCalls += 1;
        return new Promise((resolve, reject) => {
          const rejectLater = () => setTimeout(() => reject(Object.assign(
            new Error('private delayed facade abort'), { name: 'AbortError' }
          )), 20);
          if (options.signal.aborted) rejectLater();
          else options.signal.addEventListener('abort', rejectLater, { once: true });
        });
      }
    }
    queueMicrotask(() => externalController.abort());
    return new ResponseFacade();
  }, 'https://provider.example/test', { signal: externalController.signal, timeoutMs: 5 });

  await assert.rejects(
    () => pending,
    error => error.code === 'CANCELLED' && error.retryable === false
  );
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(textCalls, 0);
  assert.equal(nativeResponse.bodyUsed, true);
});

test('selects a callable facade before touching an unrelated hostile body getter', async () => {
  let bodyGetterCalls = 0;
  let textCalls = 0;
  const facadeError = new ProviderRequestError(
    'STRICTER_RESPONSE_LIMIT', 'STRICTER_RESPONSE_LIMIT', { retryable: false }
  );
  class ResponseFacade {
    async text() {
      textCalls += 1;
      throw facadeError;
    }
  }
  const facade = Object.assign(new ResponseFacade(), {
    ok: true,
    status: 200,
    headers: { get() { return null; } }
  });
  Object.defineProperty(facade, 'body', {
    get() {
      bodyGetterCalls += 1;
      throw new Error('private hostile body getter');
    }
  });

  await assert.rejects(
    () => requestText(async () => facade, 'https://provider.example/test', {}),
    error => error === facadeError
  );
  assert.equal(textCalls, 1);
  assert.equal(bodyGetterCalls, 0);
});

test('keeps declared overflow authoritative after one hostile body cleanup lookup', async () => {
  let bodyGetterCalls = 0;
  let textCalls = 0;
  const facade = {
    ok: true,
    status: 200,
    headers: { get: name => String(name).toLowerCase() === 'content-length'
      ? String(MAX_NON_STREAM_RESPONSE_BYTES + 1) : null },
    async text() {
      textCalls += 1;
      return 'unreachable';
    }
  };
  Object.defineProperty(facade, 'body', {
    get() {
      bodyGetterCalls += 1;
      throw new Error('private hostile body getter');
    }
  });

  await assert.rejects(
    () => requestText(async () => facade, 'https://provider.example/test', {}),
    error => error.code === 'INVALID_RESPONSE' &&
      error.retryable === false &&
      error.diagnosticType === 'ResponseLimitError' &&
      error.message === 'Provider response body exceeded the 4 MiB limit' &&
      !JSON.stringify(error).includes('private hostile body getter')
  );
  assert.equal(bodyGetterCalls, 1);
  assert.equal(textCalls, 0);
});

test('external cancellation does not wait for a non-settling reader cleanup', async () => {
  let markReadStarted;
  const readStarted = new Promise(resolve => { markReadStarted = resolve; });
  let releaseCalls = 0;
  const controller = new AbortController();
  const pending = requestText(async (url, options) => ({
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    body: {
      cancel() {},
      getReader() {
        return {
          read() {
            markReadStarted();
            return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
              reject(Object.assign(new Error('private abort'), { name: 'AbortError' }));
            }, { once: true }));
          },
          cancel() { return new Promise(() => {}); },
          releaseLock() { releaseCalls += 1; }
        };
      }
    }
  }), 'https://provider.example/test', { signal: controller.signal, timeoutMs: 10 })
    .then(() => ({ code: 'UNEXPECTED_SUCCESS' }), error => error);
  await readStarted;
  controller.abort();
  const outcome = await Promise.race([
    pending,
    new Promise(resolve => setTimeout(() => resolve({ code: 'CLEANUP_BLOCKED' }), 40))
  ]);
  assert.equal(outcome.code, 'CANCELLED');
  assert.equal(outcome.retryable, false);
  assert.equal(releaseCalls, 1);
});

test('external cancellation remains canonical when the reader reports abort after the timeout deadline', async () => {
  let markReadStarted;
  const readStarted = new Promise(resolve => { markReadStarted = resolve; });
  const externalController = new AbortController();
  const pending = requestText(async (url, options) => new Response(new ReadableStream({
    start(streamController) {
      options.signal.addEventListener('abort', () => setTimeout(() => streamController.error(
        Object.assign(new Error('private delayed abort'), { name: 'AbortError' })
      ), 20), { once: true });
    },
    pull() {
      markReadStarted();
      return new Promise(() => {});
    }
  }, {
    highWaterMark: 0
  })), 'https://provider.example/test', {
    signal: externalController.signal,
    timeoutMs: 5
  });
  await readStarted;
  externalController.abort();

  await assert.rejects(
    () => pending,
    error => error.code === 'CANCELLED' && error.retryable === false
  );
});

test('declared overflow does not wait for a non-settling reader cleanup', async () => {
  let releaseCalls = 0;
  const pending = requestText(async () => ({
    ok: true,
    status: 200,
    headers: { get: name => String(name).toLowerCase() === 'content-length'
      ? String(MAX_NON_STREAM_RESPONSE_BYTES + 1) : null },
    body: {
      cancel() {},
      getReader() {
        return {
          async read() { throw new Error('must not read'); },
          cancel() { return new Promise(() => {}); },
          releaseLock() { releaseCalls += 1; }
        };
      }
    }
  }), 'https://provider.example/test', { timeoutMs: 5 })
    .then(() => ({ code: 'UNEXPECTED_SUCCESS' }), error => error);
  const outcome = await Promise.race([
    pending,
    new Promise(resolve => setTimeout(() => resolve({ code: 'CLEANUP_BLOCKED' }), 40))
  ]);
  assert.equal(outcome.code, 'INVALID_RESPONSE');
  assert.equal(outcome.diagnosticType, 'ResponseLimitError');
  assert.equal(releaseCalls, 1);
});
