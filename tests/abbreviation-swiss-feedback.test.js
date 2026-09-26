const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('UI-001: real isolated browser renders Swiss controls and preserves abbreviation interactions',
  { timeout: 180000 }, () => {
    const result = spawnSync(process.execPath,
      [path.join(__dirname, '../scripts/verify-abbreviation-feedback.mjs')],
      { encoding: 'utf8', timeout: 170000, env: process.env });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
