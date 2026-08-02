(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const PORTABLE_CONFIG_PATH = 'settings/portable-config.enc.json';
  const PORTABLE_CONFIG_ENVELOPE_KIND = 'brevess-encrypted-portable-config';
  const PORTABLE_CONFIG_PAYLOAD_KIND = 'brevess-portable-user-config';
  const PORTABLE_CONFIG_KDF_ITERATIONS = 310000;
  const PORTABLE_CONFIG_MAX_KDF_ITERATIONS = 2000000;

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function cryptoApi() {
    if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
      fail('PORTABLE_CONFIG_CRYPTO_UNAVAILABLE');
    }
    return globalThis.crypto;
  }

  function configuredCrypto(cryptoRef) {
    if (cryptoRef?.subtle && cryptoRef?.getRandomValues) return cryptoRef;
    return cryptoApi();
  }

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    fail('PORTABLE_CONFIG_INVALID_BINARY');
  }

  function toBase64(value) {
    const bytes = toBytes(value);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function fromBase64(value) {
    if (typeof value !== 'string' || !value || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 !== 0) {
      fail('PORTABLE_CONFIG_INVALID_BASE64');
    }
    try {
      if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
      const binary = atob(value);
      return Uint8Array.from(binary, char => char.charCodeAt(0));
    } catch (_) {
      fail('PORTABLE_CONFIG_INVALID_BASE64');
    }
  }

  function aadFor(envelope) {
    return new TextEncoder().encode(JSON.stringify({
      kind: envelope.kind,
      schemaVersion: envelope.schemaVersion,
      backupId: envelope.backupId,
      revision: envelope.revision
    }));
  }

  function validIsoTime(value) {
    if (typeof value !== 'string' || !value || value.length > 80 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return false;
    const dateParts = /^(\d{4})-(\d{2})-(\d{2})T/u.exec(value);
    const year = Number(dateParts[1]);
    const month = Number(dateParts[2]);
    const day = Number(dateParts[3]);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    return !Number.isNaN(Date.parse(value)) && calendarDate.getUTCFullYear() === year &&
      calendarDate.getUTCMonth() === month - 1 && calendarDate.getUTCDate() === day;
  }

  function validatePortablePayload(payload) {
    if (!isPlainObject(payload)) fail('PORTABLE_CONFIG_PAYLOAD_INVALID');
    if (payload.kind !== PORTABLE_CONFIG_PAYLOAD_KIND) fail('PORTABLE_CONFIG_PAYLOAD_KIND_INVALID');
    if (payload.schemaVersion !== 1) fail('PORTABLE_CONFIG_PAYLOAD_SCHEMA_VERSION_INVALID');
    if (!isPlainObject(payload.settings)) fail('PORTABLE_CONFIG_PAYLOAD_SETTINGS_INVALID');
    if (!isPlainObject(payload.globalAbbreviations)) fail('PORTABLE_CONFIG_PAYLOAD_GLOBAL_ABBREVIATIONS_INVALID');
    return payload;
  }

  function validatePortableEnvelope(envelope) {
    if (!isPlainObject(envelope)) fail('PORTABLE_CONFIG_ENVELOPE_INVALID');
    if (envelope.kind !== PORTABLE_CONFIG_ENVELOPE_KIND) fail('PORTABLE_CONFIG_ENVELOPE_KIND_INVALID');
    if (envelope.schemaVersion !== 1) fail('PORTABLE_CONFIG_ENVELOPE_SCHEMA_VERSION_INVALID');
    if (!Number.isSafeInteger(envelope.revision) || envelope.revision < 0) fail('PORTABLE_CONFIG_ENVELOPE_REVISION_INVALID');
    if (typeof envelope.backupId !== 'string' || !/^[A-Za-z0-9-]{8,100}$/u.test(envelope.backupId)) fail('PORTABLE_CONFIG_ENVELOPE_BACKUP_ID_INVALID');
    if (!validIsoTime(envelope.updatedAt)) fail('PORTABLE_CONFIG_ENVELOPE_UPDATED_AT_INVALID');
    const encryption = envelope.encryption;
    if (!isPlainObject(encryption) || encryption.algorithm !== 'AES-GCM' || encryption.keyLength !== 256 ||
      encryption.kdf !== 'PBKDF2-SHA-256' || !Number.isSafeInteger(encryption.iterations) ||
      encryption.iterations < PORTABLE_CONFIG_KDF_ITERATIONS) fail('PORTABLE_CONFIG_ENVELOPE_ENCRYPTION_INVALID');
    if (encryption.iterations > PORTABLE_CONFIG_MAX_KDF_ITERATIONS) fail('INVALID_PORTABLE_CONFIG_KDF_ITERATIONS');
    const salt = fromBase64(encryption.salt);
    const iv = fromBase64(encryption.iv);
    if (salt.length !== 16 || iv.length !== 12) fail('PORTABLE_CONFIG_ENVELOPE_ENCRYPTION_INVALID');
    const ciphertext = fromBase64(envelope.ciphertext);
    if (!ciphertext.length) fail('PORTABLE_CONFIG_ENVELOPE_CIPHERTEXT_INVALID');
    return envelope;
  }

  async function derivePortableConfigKey(passphrase, options = {}) {
    if (typeof passphrase !== 'string' || passphrase.length < 10) fail('PORTABLE_CONFIG_PASSPHRASE_TOO_SHORT');
    const { salt, iterations = PORTABLE_CONFIG_KDF_ITERATIONS, cryptoRef } = options;
    if (!Number.isSafeInteger(iterations) || iterations < PORTABLE_CONFIG_KDF_ITERATIONS ||
      iterations > PORTABLE_CONFIG_MAX_KDF_ITERATIONS) fail('INVALID_PORTABLE_CONFIG_KDF_ITERATIONS');
    const saltBytes = typeof salt === 'string' ? fromBase64(salt) : toBytes(salt);
    if (saltBytes.length !== 16) fail('PORTABLE_CONFIG_KDF_SALT_INVALID');
    const crypto = configuredCrypto(cryptoRef);
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, material, 256));
  }

  async function importEncryptionKey(keyBytes, crypto) {
    const bytes = toBytes(keyBytes);
    if (bytes.length !== 32) fail('PORTABLE_CONFIG_KEY_INVALID');
    return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function encryptPortableConfig(payload, options = {}) {
    validatePortablePayload(payload);
    const { keyBytes, salt: suppliedSalt, backupId, revision = 0, now, iterations = PORTABLE_CONFIG_KDF_ITERATIONS, cryptoRef } = options;
    const crypto = configuredCrypto(cryptoRef);
    if (!Number.isSafeInteger(iterations) || iterations < PORTABLE_CONFIG_KDF_ITERATIONS ||
      iterations > PORTABLE_CONFIG_MAX_KDF_ITERATIONS) fail('INVALID_PORTABLE_CONFIG_KDF_ITERATIONS');
    const salt = typeof suppliedSalt === 'string' ? fromBase64(suppliedSalt) : toBytes(suppliedSalt);
    if (salt.length !== 16) fail('PORTABLE_CONFIG_KDF_SALT_INVALID');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const envelope = {
      schemaVersion: 1,
      revision,
      kind: PORTABLE_CONFIG_ENVELOPE_KIND,
      backupId,
      updatedAt: now || new Date().toISOString(),
      encryption: { algorithm: 'AES-GCM', keyLength: 256, kdf: 'PBKDF2-SHA-256', iterations, salt: toBase64(salt), iv: toBase64(iv) },
      ciphertext: ''
    };
    validatePortableEnvelope({ ...envelope, ciphertext: toBase64(new Uint8Array([1])) });
    const key = await importEncryptionKey(keyBytes, crypto);
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(envelope), tagLength: 128 }, key, plaintext);
    envelope.ciphertext = toBase64(ciphertext);
    return envelope;
  }

  async function decryptPortableConfig(envelope, options = {}) {
    try {
      validatePortableEnvelope(envelope);
      const crypto = configuredCrypto(options.cryptoRef);
      const key = await importEncryptionKey(options.keyBytes, crypto);
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.encryption.iv), additionalData: aadFor(envelope), tagLength: 128 }, key, fromBase64(envelope.ciphertext));
      const payload = JSON.parse(new TextDecoder().decode(plaintext));
      validatePortablePayload(payload);
      return payload;
    } catch (_) {
      fail('PORTABLE_CONFIG_DECRYPT_FAILED');
    }
  }

  return {
    PORTABLE_CONFIG_PATH,
    PORTABLE_CONFIG_ENVELOPE_KIND,
    PORTABLE_CONFIG_PAYLOAD_KIND,
    PORTABLE_CONFIG_KDF_ITERATIONS,
    PORTABLE_CONFIG_MAX_KDF_ITERATIONS,
    derivePortableConfigKey,
    encryptPortableConfig,
    decryptPortableConfig,
    validatePortablePayload,
    validatePortableEnvelope,
    toBase64,
    fromBase64
  };
});
