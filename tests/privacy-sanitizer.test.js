const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  isCredentialKey,
  isExportSensitiveKey
} = require('../core/privacy-sanitizer.js');

test('recognizes credential-bearing keys without treating scientific words as credentials', () => {
  for (const key of [
    'apiKey', 'api_key', 'customHeaders', 'Authorization', 'token',
    'providerToken', 'password', 'bearer', 'authToken', 'accessToken',
    'refreshToken', 'credential', 'clientSecret'
  ]) {
    assert.equal(isCredentialKey(key), true, key);
  }
  for (const key of [
    'experimentalProtocol', 'secretoryPathway', 'tokenizationMethod',
    'tokenUsage', 'headerTitle', 'proteinAccess', 'providerId'
  ]) {
    assert.equal(isCredentialKey(key), false, key);
  }
});

test('export policy additionally removes provider metadata but preserves scientific fields', () => {
  for (const key of ['provider', 'providerId', 'providerToken', 'selectedProvider']) {
    assert.equal(isExportSensitiveKey(key), true, key);
  }
  for (const key of [
    'experimentalProtocol', 'secretoryPathway', 'tokenizationMethod',
    'tokenUsage', 'headerTitle', 'proteinAccess'
  ]) {
    assert.equal(isExportSensitiveKey(key), false, key);
  }
});

test('browser entry points load the shared privacy policy before every consumer', () => {
  const root = join(__dirname, '..');
  const cases = [
    ['background.js', 'core/article-archive.js'],
    ['background.js', 'core/article-workspace.js'],
    ['background.js', 'core/directory-sync.js'],
    ['popup.html', 'core/article-archive.js'],
    ['popup.html', 'core/directory-sync.js'],
    ['options.html', 'core/directory-sync.js'],
    [join('core', 'tab-messenger.js'), 'core/article-workspace.js'],
    [join('core', 'tab-messenger.js'), 'core/article-archive.js']
  ];

  for (const [entryPoint, consumer] of cases) {
    const source = readFileSync(join(root, entryPoint), 'utf8');
    assert.ok(source.indexOf('core/privacy-sanitizer.js') >= 0, entryPoint);
    assert.ok(source.indexOf('core/privacy-sanitizer.js') < source.indexOf(consumer),
      `${entryPoint} should load privacy-sanitizer before ${consumer}`);
  }
});
