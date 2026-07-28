const test = require('node:test');
const assert = require('node:assert/strict');

const {
  modelListRequest,
  parseModelList,
  discoverProviderModels
} = require('../core/provider-model-discovery.js');

test('builds provider-specific authenticated model-list requests without returning keys', () => {
  const openai = modelListRequest('openai', { apiKey: 'openai-secret' });
  assert.equal(openai.url, 'https://api.openai.com/v1/models');
  assert.equal(openai.headers.Authorization, 'Bearer openai-secret');

  const anthropic = modelListRequest('anthropic', { apiKey: 'claude-secret' });
  assert.equal(anthropic.url, 'https://api.anthropic.com/v1/models?limit=1000');
  assert.equal(anthropic.headers['x-api-key'], 'claude-secret');
  assert.equal(anthropic.headers['anthropic-version'], '2023-06-01');

  const gemini = modelListRequest('gemini', { apiKey: 'gemini-secret' });
  assert.match(gemini.url, /v1beta\/models\?pageSize=1000&key=gemini-secret/);

  const compatible = modelListRequest('openai-compatible', {
    apiKey: 'compatible-secret',
    baseUrl: 'https://api.moonshot.cn/v1/',
    authPrefix: 'Bearer'
  });
  assert.equal(compatible.url, 'https://api.moonshot.cn/v1/models');
  assert.equal(compatible.headers.Authorization, 'Bearer compatible-secret');
});

test('parses OpenAI-compatible and Gemini payloads into generative model choices', () => {
  assert.deepEqual(
    parseModelList('openai', {
      data: [
        { id: 'gpt-5-mini', created: 2 },
        { id: 'text-embedding-3-large', created: 3 },
        { id: 'gpt-5', created: 1 }
      ]
    }).map(item => item.id),
    ['gpt-5-mini', 'gpt-5']
  );

  const gemini = parseModelList('gemini', {
    models: [
      {
        name: 'models/gemini-3.6-flash',
        displayName: 'Gemini 3.6 Flash',
        supportedGenerationMethods: ['generateContent'],
        inputTokenLimit: 1000000
      },
      {
        name: 'models/gemini-embedding-2',
        supportedGenerationMethods: ['embedContent']
      }
    ]
  });
  assert.equal(gemini.length, 1);
  assert.equal(gemini[0].id, 'gemini-3.6-flash');
  assert.equal(gemini[0].inputTokenLimit, 1000000);
});

test('discovers models and maps provider HTTP failures to safe error codes', async () => {
  const calls = [];
  const result = await discoverProviderModels({
    providerId: 'deepseek',
    config: { apiKey: 'deepseek-secret' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        async json() {
          return { data: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-v4-flash' }] };
        }
      };
    }
  });
  assert.deepEqual(result.models.map(item => item.id), [
    'deepseek-v4-flash',
    'deepseek-v4-pro'
  ]);
  assert.equal(calls[0].url, 'https://api.deepseek.com/models');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer deepseek-secret');

  await assert.rejects(() => discoverProviderModels({
    providerId: 'openai',
    config: { apiKey: 'bad-key' },
    fetchImpl: async () => ({ ok: false, status: 401 })
  }), error => error.code === 'AUTH_INVALID');
});

test('local Codex exposes its automatic model choice without a network request', async () => {
  let called = false;
  const result = await discoverProviderModels({
    providerId: 'codex-local',
    fetchImpl: async () => {
      called = true;
      throw new Error('should not run');
    }
  });
  assert.equal(called, false);
  assert.deepEqual(result.models.map(item => item.id), ['auto']);
});
