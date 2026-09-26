import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const script = path.resolve(import.meta.dirname, '../scripts/verify-search024-adapter-save.mjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture(legacy = false) {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-source-contract-'));
  for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) fs.mkdirSync(path.join(source, dir));
  const files = { 'manifest.json': '{}', 'content.js': '// actual content', 'core/sample.js': '// actual core' };
  for (const [file, value] of Object.entries(files)) fs.writeFileSync(path.join(source, file), value);
  const hashes = Object.fromEntries(Object.entries(files).map(([file, value]) => [file, sha(value)]));
  if (legacy) fs.writeFileSync(source + '.provenance.json', JSON.stringify({ differences: ['semantic-find-content.js'], frozenHashes: hashes }));
  else fs.writeFileSync(path.join(source, 'PACKAGE_INFO.json'), JSON.stringify({ build: 'source-contract-fixture', files: Object.entries(hashes).map(([file, sha256]) => ({ file, sha256 })) }));
  return { source, hashes };
}
function run(source, extra = {}) {
  const env = { ...process.env, SCI_EXTENSION_ROOT: source };
  for (const key of ['SCI_COMPARE_R18_ADAPTER', 'SCI_SELECTION_CONTENT_SOURCE', 'SCI_SAVE_RETIREMENT_ONLY']) delete env[key];
  const result = spawnSync(process.execPath, [script, '--verify-source-only'], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error);
  return result;
}
test('actual package is verified without sidecar, overlay or browser launch', () => {
  const { source, hashes } = fixture(); const result = run(source);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'VERIFIED_SOURCE_ONLY');
  assert.equal(output.package.build, 'source-contract-fixture');
  assert.deepEqual(output.hashes, hashes);
  assert.equal(fs.existsSync(source + '.provenance.json'), false);
});
test('changed runtime bytes fail package verification', () => {
  const { source } = fixture(); fs.appendFileSync(path.join(source, 'content.js'), '// changed');
  const result = run(source); assert.notEqual(result.status, 0); assert.match(result.stderr, /Package runtime mismatch: content.js/);
});
test('unlisted runtime file fails package verification', () => {
  const { source } = fixture(); fs.writeFileSync(path.join(source, 'unexpected.js'), '// unlisted');
  const result = run(source); assert.notEqual(result.status, 0); assert.match(result.stderr, /Package runtime mismatch: unexpected.js/);
});
for (const flag of ['SCI_COMPARE_R18_ADAPTER', 'SCI_SELECTION_CONTENT_SOURCE', 'SCI_SAVE_RETIREMENT_ONLY']) {
  test('package mode rejects ' + flag, () => {
    const { source } = fixture(); const result = run(source, { [flag]: '1' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Package acceptance forbids overlays and partial runs/);
  });
}
test('legacy frozen snapshot source verification remains available', () => {
  const { source, hashes } = fixture(true); const result = run(source);
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout).hashes, hashes);
});
