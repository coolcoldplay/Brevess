const test = require('node:test');
const assert = require('node:assert/strict');
require('../providers/provider-utils.js');
const { createDeepSeekAdapter } = require('../providers/deepseek.js');

// Responses continuation stays retired. Only the separately verified exact
// deepseek-flash model uses the Messages search path (covered independently).
test('unverified DeepSeek aliases do not advertise Messages web search', () => {
  for (const model of ['deepseek-v4-flash', 'deepseek-v4-pro']) {
    const adapter = createDeepSeekAdapter({ model, apiKey: 'fixture' },
      async () => { throw new Error('must not fetch'); });
    assert.equal(adapter.generateWebSearchTextStream, undefined);
    assert.equal(typeof adapter.generateTextStream, 'function');
    assert.equal(typeof adapter.generateJson, 'function');
  }
});

test('old official Responses profiles retain ordinary Chat Completions generation', async () => {
  let calls = 0;
  const adapter = createDeepSeekAdapter({ model: 'deepseek-flash', apiKey: 'fixture',
    baseUrl: 'https://api.deepseek.com/responses' }, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.tools, undefined);
    assert.equal(body.tool_choice, undefined);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop',
      message: { content: '{"ok":true}' } }] }));
  });
  assert.deepEqual(await adapter.generateJson({ systemPrompt: 'JSON', userPrompt: 'question' }), { ok: true });
  assert.equal(calls, 1);
});

test('custom DeepSeek-compatible chat endpoints retain their configured transport', async () => {
  const baseUrl = 'https://gateway.example.org/chat/completions';
  const adapter = createDeepSeekAdapter({ model: 'custom', apiKey: 'fixture', baseUrl },
    async url => {
      assert.equal(url, baseUrl);
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop',
        message: { content: '{"ok":true}' } }] }));
    });
  assert.equal(adapter.generateWebSearchTextStream, undefined);
  assert.deepEqual(await adapter.generateJson({ userPrompt: 'question' }), { ok: true });
});
