const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(
  __dirname, '..', 'scripts', 'verify-scenario-selection-extension.mjs'
), 'utf8');

test('scenario-selection verifier uses an isolated extension and profile', () => {
  assert.match(script, /mkdtempSync\([\s\S]*brevess-scenario-selection-/);
  assert.match(script, /--disable-extensions-except=/);
  assert.match(script, /--load-extension=/);
  assert.match(script, /headless:\s*true/);
  assert.match(script, /dailyBrowserUsed:\s*false/);
  assert.match(script, /nativeComputerUseUsed:\s*false/);
});

test('scenario-selection verifier exercises live synchronization and history', () => {
  assert.match(script, /playwright-mouse-drag/);
  assert.match(script, /programmatic-range-fallback/);
  assert.match(script, /LLM_UPDATE_PREFERENCES/);
  assert.match(script, /CATEGORY_SAVE_OVERRIDE/);
  assert.match(script, /LLM_SAVE_CUSTOM_CATEGORY/);
  assert.match(script, /CATEGORY_DELETE/);
  assert.match(script, /现场结果证据（已停用）/);
  assert.match(script, /\.press\('ArrowDown'\)/);
  assert.match(script, /setViewportSize\(\{ width: 390/);
  assert.match(script, /setViewportSize\(\{ width: 320/);
});

test('scenario-selection verifier blocks and counts provider traffic', () => {
  assert.match(script, /context\.route\(\/\^https\?:/);
  assert.match(script, /report\.apiRequests \+= 1/);
  assert.match(script, /route\.abort\('blockedbyclient'\)/);
  assert.match(script, /assert\.equal\(report\.apiRequests, 0\)/);
  assert.match(script, /assert\.equal\(report\.externalRequests, 0\)/);
});
