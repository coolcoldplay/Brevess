const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../options.js'), 'utf8');
const { validateProviderConfig } = require('../providers/provider-registry.js');
const { normalizeProfile } = require('../core/settings-store.js');

test('a model absent from presets retains its exact ID and passes provider configuration validation', () => {
  const model = 'deepseek-v4.1-flash-expires-on-0910';
  const profile = normalizeProfile('profile_custom', {
    providerId: 'deepseek', name: 'Custom', config: { apiKey: 'fixture', model }
  });
  assert.equal(profile.config.model, model);
  assert.deepEqual(validateProviderConfig('deepseek', profile.config), []);
  assert.deepEqual(validateProviderConfig('deepseek', { model }), ['apiKey']);
});

test('typing a new model clears the stale dropdown without changing the user input', () => {
  const input = { value: 'deepseek-v4.1-flash-expires-on-0910' };
  const placeholder = { value: '', textContent: '' };
  const select = { value: 'deepseek-v4-flash', options: [placeholder, { value: 'deepseek-v4-flash' }] };
  const start = script.indexOf('function syncModelSuggestionSelection(');
  const end = script.indexOf('\nfunction autoSelectFirstDiscoveredModel', start);
  const context = { document: { getElementById: id => id === 'model' ? input : select },
    interfaceText: value => value };
  vm.runInNewContext(script.slice(start, end) + '\nglobalThis.sync = syncModelSuggestionSelection;', context);
  context.sync();
  assert.equal(input.value, 'deepseek-v4.1-flash-expires-on-0910');
  assert.equal(input.title, input.value);
  assert.equal(select.value, '');
  assert.equal(placeholder.textContent, '使用手填模型 ID');
  input.value = 'deepseek-v4-flash';
  context.sync();
  assert.equal(select.value, input.value);
});

test('missing key is explained separately from invalid model or category rules', () => {
  const start = script.indexOf('function friendlyError(');
  const end = script.indexOf('\nfunction showStatus', start);
  const context = { interfaceText: value => value };
  vm.runInNewContext(script.slice(start, end) + '\nglobalThis.explain = friendlyError;', context);
  assert.match(context.explain({ code: 'INVALID_SETTINGS', fields: ['apiKey'] }), /本配置中填写并保存密钥/);
  assert.match(context.explain({ code: 'INVALID_SETTINGS', fields: ['model'] }), /model/);
  assert.doesNotMatch(context.explain({ code: 'INVALID_SETTINGS', fields: ['model'] }), /没有可用的 API Key/);
});
