const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getProviderBrand } = require('../core/provider-brand-icons.js');
const { getProviderDefinitions, getCompatibleProviderPresets } = require('../providers/provider-registry.js');

test('every built-in provider and named compatible preset has a bundled official icon', () => {
  const profiles = Object.keys(getProviderDefinitions()).filter(id => id !== 'openai-compatible').map(providerId => ({ providerId }));
  profiles.push(...getCompatibleProviderPresets().filter(p => p.id !== 'custom').map(p => ({ providerId: 'openai-compatible', config: { presetId: p.id } })));
  for (const profile of profiles) {
    const brand = getProviderBrand(profile);
    assert.ok(brand, JSON.stringify(profile));
    assert.match(brand.src, /^icons\/providers\/[a-z]+\.(png|ico)$/);
    assert.ok(fs.statSync(path.join(__dirname, '..', brand.src)).size > 0);
  }
});

test('custom connections recognize exact official HTTPS API hosts, with no spoofed suffix or userinfo matching', () => {
  const resolve = baseUrl => getProviderBrand({ providerId: 'openai-compatible', config: { presetId: 'custom', baseUrl } });
  assert.equal(resolve('https://api.deepseek.com/v1').id, 'deepseek');
  assert.equal(resolve('https://api.moonshot.ai/v1').id, 'kimi');
  assert.equal(resolve('https://api.deepseek.com.attacker.example/v1'), null);
  assert.equal(resolve('https://api.deepseek.com@attacker.example/v1'), null);
  assert.equal(resolve('https://user:password@api.deepseek.com/v1'), null);
  assert.equal(resolve('http://api.deepseek.com/v1'), null);
  assert.equal(resolve('http://127.0.0.1:8880/v1'), null);
});

test('icon selection never accesses credentials or uses the user supplied connection name as markup', () => {
  const config = { get apiKey() { throw new Error('Do not read credentials'); } };
  const icon = getProviderBrand({ providerId: 'deepseek', name: '<img src=untrusted>', config });
  assert.equal(icon.label, 'DeepSeek');
  assert.equal(getProviderBrand({ providerId: '<script>' }), null);
});
