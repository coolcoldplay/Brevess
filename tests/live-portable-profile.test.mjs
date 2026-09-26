import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { loadLivePortableProfile, liveProfileMetadata } from '../scripts/lib/live-portable-profile.mjs';
const require = createRequire(import.meta.url);
const codec = require('../core/portable-config.js');
const password = 'synthetic-test-password';
const secret = 'synthetic-key-never-print';
async function fixture(t, profiles) {
  const dir = await mkdtemp(join(tmpdir(), 'brevess-portable-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const salt = new Uint8Array(16).fill(7);
  const keyBytes = await codec.derivePortableConfigKey(password, { salt, cryptoRef: webcrypto });
  const envelope = await codec.encryptPortableConfig({ kind: 'brevess-portable-user-config',
    schemaVersion: 1, settings: { profiles }, globalAbbreviations: {} }, {
    keyBytes, salt, backupId: 'test-portable-credential', revision: 1,
    now: '2026-09-24T00:00:00.000Z', cryptoRef: webcrypto });
  keyBytes.fill(0);
  const file = join(dir, 'portable.enc.json');
  await writeFile(file, JSON.stringify(envelope));
  return file;
}
const ds = { name: 'DS', providerId: 'openai-compatible', config: {
  apiKey: secret, model: 'deepseek-flash', baseUrl: 'https://example.test/v1' } };
const opts = { readPassphrase: async () => password, expectedModel: 'deepseek-flash' };
test('selects only named profile, does not rewrite export or serialize key', async t => {
  const file = await fixture(t, { selected: ds, other: { ...ds, name: 'OTHER' } });
  const before = await readFile(file);
  const p = await loadLivePortableProfile(file, 'DS', opts);
  assert.equal(p.apiKey, secret);
  assert.equal(p.model, 'deepseek-flash');
  assert.equal(liveProfileMetadata(p).hasApiKey, true);
  assert.ok(!JSON.stringify(p).includes(secret));
  assert.ok(!JSON.stringify(liveProfileMetadata(p)).includes(secret));
  const list = await loadLivePortableProfile(file, '--list', { ...opts, listOnly: true });
  assert.deepEqual(list.profiles.map(p => p.name), ['DS', 'OTHER']);
  assert.ok(!JSON.stringify(list).includes(secret));
  assert.deepEqual(await readFile(file), before);
});
test('wrong password returns fixed code without decrypted fields', async t => {
  const file = await fixture(t, { p: ds });
  await assert.rejects(loadLivePortableProfile(file, 'DS', { readPassphrase: async () => 'wrong' }),
    { code: 'LIVE_CONFIG_UNLOCK_FAILED', message: 'LIVE_CONFIG_UNLOCK_FAILED' });
});
test('duplicate names and model mismatch are rejected without fallback', async t => {
  const duplicate = await fixture(t, { p: ds, q: ds });
  await assert.rejects(loadLivePortableProfile(duplicate, 'DS', opts), { code: 'LIVE_PROFILE_NOT_UNIQUE' });
  const file = await fixture(t, { p: ds });
  await assert.rejects(loadLivePortableProfile(file, 'DS', { ...opts, expectedModel: 'different' }),
    { code: 'LIVE_PROFILE_MODEL_MISMATCH' });
});
test('credential-bearing URL and invalid envelope are never exposed', async t => {
  const file = await fixture(t, { p: { ...ds, config: { ...ds.config, baseUrl: 'https://example.test?key=secret' } } });
  await assert.rejects(loadLivePortableProfile(file, 'DS', opts), { code: 'LIVE_PROFILE_ENDPOINT_INVALID' });
  await writeFile(file, '{}');
  await assert.rejects(loadLivePortableProfile(file, 'DS', { readPassphrase: () => assert.fail('must not prompt') }),
    { code: 'LIVE_CONFIG_ENVELOPE_INVALID' });
});
