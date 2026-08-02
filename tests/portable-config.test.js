const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

globalThis.crypto = webcrypto;

const {
  PORTABLE_CONFIG_MAX_KDF_ITERATIONS,
  derivePortableConfigKey,
  encryptPortableConfig,
  decryptPortableConfig,
  validatePortableEnvelope,
  toBase64
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

function options(keyBytes, revision = 7) {
  return {
    keyBytes,
    salt: new Uint8Array(16).fill(8),
    backupId: 'backup-20260803-a1',
    revision,
    now: '2026-08-03T00:00:00.000Z'
  };
}

test('encrypts a full portable payload into an opaque envelope and round-trips it', async () => {
  const keyBytes = await derivePortableConfigKey(passphrase, { salt: new Uint8Array(16) });
  assert.equal(keyBytes.byteLength, 32);

  const envelope = await encryptPortableConfig(payload, options(keyBytes));
  assert.deepEqual(await decryptPortableConfig(envelope, { keyBytes }), payload);

  const serialized = JSON.stringify(envelope);
  assert.equal(serialized.includes('apiKey'), false);
  assert.equal(serialized.includes('sk-folder-secret'), false);
  assert.equal(serialized.includes('tumor necrosis factor'), false);
});

test('rejects a wrong passphrase without exposing plaintext', async () => {
  const keyBytes = await derivePortableConfigKey(passphrase, { salt: new Uint8Array(16) });
  const wrongKeyBytes = await derivePortableConfigKey('a different long passphrase', { salt: new Uint8Array(16) });
  const envelope = await encryptPortableConfig(payload, options(keyBytes));
  await assert.rejects(
    () => decryptPortableConfig(envelope, { keyBytes: wrongKeyBytes }),
    error => error.code === 'PORTABLE_CONFIG_DECRYPT_FAILED' && error.message === 'PORTABLE_CONFIG_DECRYPT_FAILED'
  );
});

test('rejects an envelope whose authenticated revision was altered', async () => {
  const keyBytes = await derivePortableConfigKey(passphrase, { salt: new Uint8Array(16) });
  const envelope = await encryptPortableConfig(payload, options(keyBytes));
  envelope.revision += 1;
  await assert.rejects(
    () => decryptPortableConfig(envelope, { keyBytes }),
    error => error.code === 'PORTABLE_CONFIG_DECRYPT_FAILED' && error.message === 'PORTABLE_CONFIG_DECRYPT_FAILED'
  );
});

test('uses cached key bytes to encrypt and decrypt without retaining a passphrase', async () => {
  const keyBytes = await derivePortableConfigKey(passphrase, { salt: new Uint8Array(16) });
  const envelope = await encryptPortableConfig(payload, options(keyBytes, 8));
  assert.deepEqual(await decryptPortableConfig(envelope, { keyBytes }), payload);
});

test('uses a fresh IV for each encryption of the same payload', async () => {
  const keyBytes = await derivePortableConfigKey(passphrase, { salt: new Uint8Array(16) });
  const first = await encryptPortableConfig(payload, options(keyBytes));
  const second = await encryptPortableConfig(payload, options(keyBytes));
  assert.notEqual(first.encryption.iv, second.encryption.iv);
});

test('rejects unbounded KDF iterations before PBKDF2', async () => {
  await assert.rejects(
    () => derivePortableConfigKey(passphrase, { salt: new Uint8Array(16), iterations: PORTABLE_CONFIG_MAX_KDF_ITERATIONS + 1 }),
    error => error.code === 'INVALID_PORTABLE_CONFIG_KDF_ITERATIONS'
  );
});

test('validates hostile envelope fields before decrypting', async () => {
  const keyBytes = await derivePortableConfigKey(passphrase, { salt: new Uint8Array(16) });
  const envelope = await encryptPortableConfig(payload, options(keyBytes));
  const cases = [
    draft => { draft.ciphertext = '!!!='; },
    draft => { draft.encryption.salt = toBase64(new Uint8Array(15)); },
    draft => { draft.encryption.iv = toBase64(new Uint8Array(11)); },
    draft => { draft.ciphertext = ''; },
    draft => { draft.encryption.algorithm = 'AES-CBC'; },
    draft => { draft.encryption.keyLength = 128; },
    draft => { draft.encryption.iterations = PORTABLE_CONFIG_MAX_KDF_ITERATIONS + 1; },
    draft => { draft.updatedAt = 'not-a-date'; },
    draft => { draft.updatedAt = '2026-02-30T00:00:00.000Z'; }
  ];
  for (const mutate of cases) {
    const hostile = structuredClone(envelope);
    mutate(hostile);
    assert.throws(() => validatePortableEnvelope(hostile));
    await assert.rejects(() => decryptPortableConfig(hostile, { keyBytes }),
      error => error.code === 'PORTABLE_CONFIG_DECRYPT_FAILED');
  }
});

test('rejects ciphertext tampering, invalid JSON, and invalid decrypted payload uniformly', async () => {
  const keyBytes = await derivePortableConfigKey(passphrase, { salt: new Uint8Array(16) });
  const envelope = await encryptPortableConfig(payload, options(keyBytes));
  const tampered = structuredClone(envelope);
  tampered.ciphertext = `${tampered.ciphertext.slice(0, -2)}AA`;
  await assert.rejects(() => decryptPortableConfig(tampered, { keyBytes }),
    error => error.code === 'PORTABLE_CONFIG_DECRYPT_FAILED');

  for (const plaintext of ['not json', JSON.stringify({ kind: 'wrong', schemaVersion: 1, settings: {}, globalAbbreviations: {} })]) {
    const forged = await encryptPortableConfig({ ...payload }, options(keyBytes));
    const cryptoKey = await webcrypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const aad = new TextEncoder().encode(JSON.stringify({ kind: forged.kind, schemaVersion: forged.schemaVersion, backupId: forged.backupId, revision: forged.revision }));
    forged.ciphertext = toBase64(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: Buffer.from(forged.encryption.iv, 'base64'), additionalData: aad }, cryptoKey, new TextEncoder().encode(plaintext)));
    await assert.rejects(() => decryptPortableConfig(forged, { keyBytes }),
      error => error.code === 'PORTABLE_CONFIG_DECRYPT_FAILED');
  }
});

test('base64 helpers use browser atob and btoa when Buffer is unavailable', () => {
  const originalBuffer = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined;
    const portable = require('../core/portable-config.js');
    assert.deepEqual([...portable.fromBase64(portable.toBase64(new Uint8Array([0, 1, 255])))], [0, 1, 255]);
  } finally {
    globalThis.Buffer = originalBuffer;
  }
});
