const test = require('node:test');
const assert = require('node:assert/strict');

const {
  requestJson,
  requestSseJson,
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
require('../providers/openai.js');
require('../providers/anthropic.js');
require('../providers/gemini.js');
require('../providers/deepseek.js');
require('../providers/openai-compatible.js');
const {
  createProviderAdapter,
  getProviderDefinitions,
  getCompatibleProviderPresets,
  getProviderCapabilities,
  getProviderMaxOutputTokens,
  validateProviderConfig
} = require('../providers/provider-registry.js');

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
    'openai', 'anthropic', 'gemini', 'deepseek', 'openai-compatible'
  ]);
  assert.deepEqual(validateProviderConfig('openai', { apiKey: '', model: '' }), ['apiKey', 'model']);
  assert.deepEqual(validateProviderConfig('openai-compatible', {
    apiKey: 'key', model: 'model', baseUrl: 'file:///tmp/api'
  }), ['baseUrl']);
  assert.deepEqual(validateProviderConfig('openai-compatible', {
    apiKey: 'key', model: 'model', baseUrl: 'http://gateway.example/v1'
  }), ['baseUrl']);
});

test('publishes official Chinese-model compatible presets without coupling them to credentials', () => {
  const presets = getCompatibleProviderPresets();
  const expected = {
    kimi: ['https://api.moonshot.cn/v1', 'kimi-k2.6'],
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
  }
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
  assert.equal(definitions['openai-compatible'].supportsVision, false);
  assert.equal(getProviderCapabilities('deepseek', {}).supportsVision, false);
  assert.equal(getProviderCapabilities('openai-compatible', {}).supportsVision, false);
  assert.equal(getProviderCapabilities('openai-compatible', {
    supportsVision: true
  }).supportsVision, true);
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

test('never serializes images into an official DeepSeek request', async () => {
  let body;
  const adapter = createProviderAdapter({
    providerId: 'deepseek',
    config: { apiKey: 'key', model: 'deepseek-v4-flash' },
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
    config: { apiKey: 'deepseek-secret', model: 'deepseek-v4-flash' },
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(url, 'https://api.deepseek.com/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer deepseek-secret');
      assert.equal(body.response_format.type, 'json_object');
      assert.equal(body.thinking.type, 'disabled');
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
