const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

globalThis.crypto = webcrypto;

const {
  derivePortableConfigKey,
  encryptPortableConfig,
  decryptPortableConfig
} = require('../core/portable-config.js');

const passphrase = 'correct horse battery staple';
const payload = {
  kind: 'brevess-portable-user-config',
  schemaVersion: 1,
  settings: {
    profiles: { p1: { config: { apiKey: 'sk-folder-secret', model: 'm1' } } }
  },
  globalAbbreviations: { TNF: 'tumor necrosis factor' }
};

function metadata(revision = 7) {
  return { backupId: 'backup-20260803-a1', revision, updatedAt: '2026-08-03T00:00:00.000Z' };
}

test('encrypts a full portable payload into an opaque envelope and round-trips it', async () => {
  const key = await derivePortableConfigKey(passphrase, new Uint8Array(16));
  assert.equal(key.type, 'secret');

  const envelope = await encryptPortableConfig(payload, passphrase, metadata());
  assert.deepEqual(await decryptPortableConfig(envelope, passphrase), payload);

  const serialized = JSON.stringify(envelope);
  assert.equal(serialized.includes('apiKey'), false);
  assert.equal(serialized.includes('sk-folder-secret'), false);
  assert.equal(serialized.includes('tumor necrosis factor'), false);
});

test('rejects a wrong passphrase without exposing plaintext', async () => {
  const envelope = await encryptPortableConfig(payload, passphrase, metadata());
  await assert.rejects(
    () => decryptPortableConfig(envelope, 'a different long passphrase'),
    error => error.code === 'PORTABLE_CONFIG_DECRYPT_FAILED' && error.message === 'PORTABLE_CONFIG_DECRYPT_FAILED'
  );
});

test('rejects an envelope whose authenticated revision was altered', async () => {
  const envelope = await encryptPortableConfig(payload, passphrase, metadata());
  envelope.revision += 1;
  await assert.rejects(
    () => decryptPortableConfig(envelope, passphrase),
    error => error.code === 'PORTABLE_CONFIG_DECRYPT_FAILED' && error.message === 'PORTABLE_CONFIG_DECRYPT_FAILED'
  );
});
