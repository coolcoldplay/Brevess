const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackgroundRouter } = require('./helpers/note016-runtime.js');
async function run(providerId, model, supportsVision) {
  const values = {}, requests = [];
  const router = createBackgroundRouter({
    storageArea: { get(k, cb) { cb({ [k]: values[k] }); }, set(input, cb) { Object.assign(values, input); cb(); } },
    sleepImpl: async () => {}, fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      const content = body.messages.some(m => Array.isArray(m.content)) ? 'WHITE' : 'OK';
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }), { status: 200 });
    }
  });
  const saved = await router.handle({ type: 'LLM_SAVE_PROFILE', profile: { id: 'profile_fig023_probe', name: 'Offline probe', providerId,
    config: { apiKey: 'offline-only', model, baseUrl: 'https://example.test/v1', supportsVision }, capabilities: { vision: false } } });
  assert.equal(saved.success, true);
  const before = JSON.stringify(values);
  const result = await router.handle({ type: 'LLM_TEST_PROFILE', profileId: 'profile_fig023_probe', probeIds: ['connectivity', 'vision_input'] });
  assert.equal(result.success, true, JSON.stringify(result.error));
  assert.equal(JSON.stringify(values), before, 'diagnostics do not rewrite saved user settings');
  return { result, requests };
}
test('current Flash vision capability runs image probe despite an old false diagnostic snapshot', async () => {
  const { result, requests } = await run('deepseek', 'deepseek-flash');
  assert.equal(result.data.probes.find(p => p.id === 'vision_input').status, 'passed');
  assert.equal(requests.length, 2);
  assert.ok(requests[1].messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')));
});
test('Pro and compatible profiles without explicit vision opt-in still skip image probes', async () => {
  for (const [provider, model, supports] of [['deepseek', 'deepseek-pro'], ['openai-compatible', 'custom-model', false]]) {
    const { result, requests } = await run(provider, model, supports);
    assert.equal(result.data.probes.find(p => p.id === 'vision_input').status, 'unsupported'); assert.equal(requests.length, 1);
  }
});
test('compatible explicit config opt-in can be probed despite an old false diagnostic snapshot', async () => {
  const { result, requests } = await run('openai-compatible', 'custom-model', true);
  assert.equal(result.data.probes.find(p => p.id === 'vision_input').status, 'passed'); assert.equal(requests.length, 2);
});
