(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const PORTABLE_CONFIG_KEY_CACHE = 'brevessPortableConfigKeyCacheV1';

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

  function createPortableConfigManager(options = {}) {
    const {
      directorySync,
      storageArea,
      settingsKey,
      abbreviationKey,
      derivePortableConfigKey = shared.derivePortableConfigKey,
      encryptPortableConfig = shared.encryptPortableConfig,
      decryptPortableConfig = shared.decryptPortableConfig,
      validatePortablePayload = shared.validatePortablePayload,
      validatePortableEnvelope = shared.validatePortableEnvelope,
      toBase64 = shared.toBase64,
      fromBase64 = shared.fromBase64,
      normalizeSettings,
      normalizeAbbreviations,
      loadSettings,
      loadGlobalAbbreviations,
      extensionVersion = '',
      now = () => new Date().toISOString(),
      randomId = () => globalThis.crypto.randomUUID(),
      cryptoRef = globalThis.crypto,
      iterations = shared.PORTABLE_CONFIG_KDF_ITERATIONS,
      importer,
      path = shared.PORTABLE_CONFIG_PATH,
      payloadKind = shared.PORTABLE_CONFIG_PAYLOAD_KIND,
      setTimeoutRef = globalThis.setTimeout,
      clearTimeoutRef = globalThis.clearTimeout,
      debounceMs = 500
    } = options;

    if (!directorySync?.readJson || !directorySync?.enqueueJson ||
        !directorySync?.flush || !storageArea?.get || !storageArea?.set ||
        typeof settingsKey !== 'string' || typeof abbreviationKey !== 'string' ||
        !derivePortableConfigKey || !encryptPortableConfig || !decryptPortableConfig ||
        !validatePortablePayload || !validatePortableEnvelope || !toBase64 || !fromBase64 ||
        !normalizeSettings || !normalizeAbbreviations || !loadSettings ||
        !loadGlobalAbbreviations || !path || !payloadKind) {
      fail('PORTABLE_CONFIG_MANAGER_INVALID_DEPENDENCIES');
    }

    const privateState = {
      state: 'unknown',
      backupId: '',
      revision: 0,
      updatedAt: '',
      salt: '',
      iterations,
      pending: false,
      lastError: ''
    };
    let backupTimer = null;
    let suppressedRestoreSnapshot = null;
    let disposed = false;

    function publicStatus() {
      return {
        state: privateState.state,
        revision: privateState.revision,
        updatedAt: privateState.updatedAt,
        pending: privateState.pending,
        lastError: privateState.lastError
      };
    }

    function safeCode(error, fallback) {
      const code = String(error?.code || '');
      return /^PORTABLE_CONFIG_[A-Z0-9_]+$/u.test(code) ? code : fallback;
    }

    function setEnvelopeState(envelope) {
      privateState.backupId = envelope.backupId;
      privateState.revision = envelope.revision;
      privateState.updatedAt = envelope.updatedAt;
      privateState.salt = envelope.encryption.salt;
      privateState.iterations = envelope.encryption.iterations;
    }

    function callStorage(method, value) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const done = result => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        try {
          const maybePromise = storageArea[method](value, done);
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then(done, reject);
          }
        } catch (error) {
          reject(error);
        }
      });
    }

    async function readCache() {
      const result = await callStorage('get', PORTABLE_CONFIG_KEY_CACHE);
      const value = result?.[PORTABLE_CONFIG_KEY_CACHE];
      return isPlainObject(value) ? { ...value } : {};
    }

    function decodeCachedKey(value) {
      if (typeof value !== 'string') return null;
      try {
        const bytes = fromBase64(value);
        return bytes.length === 32 ? bytes : null;
      } catch (_) {
        return null;
      }
    }

    async function cachedKey(backupId) {
      const cache = await readCache();
      return decodeCachedKey(cache[backupId]);
    }

    async function updateCache(backupId, keyBytes) {
      const cache = await readCache();
      delete cache[backupId];
      if (keyBytes) cache[backupId] = toBase64(keyBytes);
      await callStorage('set', { [PORTABLE_CONFIG_KEY_CACHE]: cache });
    }

    async function readEnvelope() {
      const result = await directorySync.readJson(path);
      if (!result?.found) return null;
      const envelope = validatePortableEnvelope(result.value);
      setEnvelopeState(envelope);
      return envelope;
    }

    function normalizedPayload(payload) {
      validatePortablePayload(payload);
      const settings = normalizeSettings(payload.settings);
      const globalAbbreviations = normalizeAbbreviations(payload.globalAbbreviations);
      return { settings, globalAbbreviations };
    }

    async function restorePayload(payload) {
      const normalized = normalizedPayload(payload);
      await callStorage('set', {
        [settingsKey]: normalized.settings,
        [abbreviationKey]: normalized.globalAbbreviations
      });
      suppressedRestoreSnapshot = normalized;
      return normalized;
    }

    function sameJsonValue(left, right) {
      try {
        return JSON.stringify(left) === JSON.stringify(right);
      } catch (_) {
        return false;
      }
    }

    function isRestoreChange(changes) {
      if (!suppressedRestoreSnapshot) return false;
      if (!isPlainObject(changes)) return true;
      const relevant = [
        [settingsKey, suppressedRestoreSnapshot.settings],
        [abbreviationKey, suppressedRestoreSnapshot.globalAbbreviations]
      ].filter(([key]) => Object.prototype.hasOwnProperty.call(changes, key));
      if (!relevant.length) return false;
      return relevant.every(([key, restored]) =>
        sameJsonValue(changes[key]?.newValue, restored));
    }

    async function probe() {
      privateState.lastError = '';
      let envelope;
      try {
        envelope = await readEnvelope();
      } catch (error) {
        privateState.state = 'error';
        privateState.lastError = safeCode(error, 'PORTABLE_CONFIG_PROBE_FAILED');
        return publicStatus();
      }
      if (!envelope) {
        privateState.state = 'missing';
        privateState.backupId = '';
        privateState.revision = 0;
        privateState.updatedAt = '';
        privateState.salt = '';
        privateState.pending = false;
        return publicStatus();
      }
      const keyBytes = await cachedKey(envelope.backupId);
      if (!keyBytes) {
        const cache = await readCache();
        if (Object.prototype.hasOwnProperty.call(cache, envelope.backupId)) {
          await updateCache(envelope.backupId, null);
          privateState.lastError = 'PORTABLE_CONFIG_CACHED_KEY_INVALID';
        }
        privateState.state = 'locked';
        privateState.pending = false;
        return publicStatus();
      }
      try {
        const { payload } = await decryptPortableConfig(envelope, { keyBytes, cryptoRef });
        await restorePayload(payload);
        privateState.state = 'ready';
        privateState.pending = false;
        privateState.lastError = '';
      } catch (_) {
        await updateCache(envelope.backupId, null);
        privateState.state = 'locked';
        privateState.pending = false;
        privateState.lastError = 'PORTABLE_CONFIG_CACHED_KEY_REJECTED';
      }
      return publicStatus();
    }

    async function unlock(passphrase) {
      let envelope;
      try {
        envelope = await readEnvelope();
        if (!envelope) fail('PORTABLE_CONFIG_MISSING');
        const keyBytes = await derivePortableConfigKey(passphrase, {
          salt: fromBase64(envelope.encryption.salt),
          iterations: envelope.encryption.iterations,
          cryptoRef
        });
        const { payload } = await decryptPortableConfig(envelope, { keyBytes, cryptoRef });
        await restorePayload(payload);
        await updateCache(envelope.backupId, keyBytes);
        privateState.state = 'ready';
        privateState.pending = false;
        privateState.lastError = '';
        return publicStatus();
      } catch (_) {
        privateState.state = envelope ? 'locked' : 'missing';
        privateState.lastError = 'PORTABLE_CONFIG_UNLOCK_FAILED';
        fail('PORTABLE_CONFIG_UNLOCK_FAILED');
      }
    }

    function timestamp() {
      const value = now();
      return value instanceof Date ? value.toISOString() : String(value);
    }

    function buildPayload(settings, globalAbbreviations, exportedAt = timestamp()) {
      const payload = {
        kind: payloadKind,
        schemaVersion: 1,
        sourceVersion: String(extensionVersion || ''),
        exportedAt,
        settings: normalizeSettings(settings),
        globalAbbreviations: normalizeAbbreviations(globalAbbreviations)
      };
      return validatePortablePayload(payload);
    }

    async function loadPayload(exportedAt = timestamp()) {
      const [settings, globalAbbreviations] = await Promise.all([
        loadSettings(storageArea),
        loadGlobalAbbreviations(storageArea)
      ]);
      return buildPayload(settings, globalAbbreviations, exportedAt);
    }

    async function writeEnvelope(envelope) {
      await directorySync.enqueueJson(path, envelope);
      const result = await directorySync.flush(importer);
      if (Number(result?.conflicts) > 0) fail('PORTABLE_CONFIG_DIRECTORY_CONFLICT');
      if (Number(result?.failed) > 0 || Number(result?.pendingCount) > 0 ||
          (result?.permission && result.permission !== 'granted')) {
        fail('PORTABLE_CONFIG_DIRECTORY_WRITE_FAILED');
      }
      return result;
    }

    function randomSalt() {
      if (!cryptoRef?.getRandomValues) fail('PORTABLE_CONFIG_CRYPTO_UNAVAILABLE');
      return cryptoRef.getRandomValues(new Uint8Array(16));
    }

    async function create(passphrase) {
      let existing;
      try {
        existing = await directorySync.readJson(path);
      } catch (_) {
        privateState.state = 'missing';
        privateState.lastError = 'PORTABLE_CONFIG_CREATE_FAILED';
        fail('PORTABLE_CONFIG_CREATE_FAILED');
      }
      if (existing?.found) fail('PORTABLE_CONFIG_ALREADY_EXISTS');
      const salt = randomSalt();
      const backupId = String(randomId());
      const exportedAt = timestamp();
      privateState.pending = true;
      privateState.lastError = '';
      try {
        const keyBytes = await derivePortableConfigKey(passphrase, {
          salt, iterations, cryptoRef
        });
        const payload = await loadPayload(exportedAt);
        const envelope = await encryptPortableConfig(payload, {
          keyBytes,
          salt,
          backupId,
          revision: 1,
          now: exportedAt,
          iterations,
          cryptoRef
        });
        await writeEnvelope(envelope);
        await updateCache(backupId, keyBytes);
        setEnvelopeState(envelope);
        privateState.state = 'ready';
        privateState.pending = false;
        privateState.lastError = '';
        return publicStatus();
      } catch (error) {
        privateState.state = 'missing';
        privateState.pending = true;
        privateState.lastError = safeCode(error, 'PORTABLE_CONFIG_CREATE_FAILED');
        const code = privateState.lastError === 'PORTABLE_CONFIG_ALREADY_EXISTS'
          ? privateState.lastError : 'PORTABLE_CONFIG_CREATE_FAILED';
        fail(code);
      }
    }

    async function backupNow() {
      if (privateState.state !== 'ready' || !privateState.backupId) {
        privateState.state = 'locked';
        privateState.pending = true;
        privateState.lastError = 'PORTABLE_CONFIG_LOCKED';
        fail('PORTABLE_CONFIG_LOCKED');
      }
      const keyBytes = await cachedKey(privateState.backupId);
      if (!keyBytes) {
        const cache = await readCache();
        if (Object.prototype.hasOwnProperty.call(cache, privateState.backupId)) {
          await updateCache(privateState.backupId, null);
        }
        privateState.state = 'locked';
        privateState.pending = true;
        privateState.lastError = 'PORTABLE_CONFIG_LOCKED';
        fail('PORTABLE_CONFIG_LOCKED');
      }
      const exportedAt = timestamp();
      privateState.pending = true;
      privateState.lastError = '';
      try {
        const payload = await loadPayload(exportedAt);
        const envelope = await encryptPortableConfig(payload, {
          keyBytes,
          salt: privateState.salt,
          backupId: privateState.backupId,
          revision: privateState.revision + 1,
          now: exportedAt,
          iterations: privateState.iterations,
          cryptoRef
        });
        await writeEnvelope(envelope);
        setEnvelopeState(envelope);
        privateState.state = 'ready';
        privateState.pending = false;
        privateState.lastError = '';
        return publicStatus();
      } catch (error) {
        privateState.pending = true;
        privateState.lastError = safeCode(error, 'PORTABLE_CONFIG_BACKUP_FAILED');
        fail('PORTABLE_CONFIG_BACKUP_FAILED');
      }
    }

    function scheduleBackup(changes) {
      if (isRestoreChange(changes)) {
        suppressedRestoreSnapshot = null;
        return false;
      }
      if (suppressedRestoreSnapshot && isPlainObject(changes)) {
        const hasRelevantChange = Object.prototype.hasOwnProperty.call(changes, settingsKey) ||
          Object.prototype.hasOwnProperty.call(changes, abbreviationKey);
        if (!hasRelevantChange) return false;
        suppressedRestoreSnapshot = null;
      }
      if (disposed) return false;
      if (backupTimer !== null) clearTimeoutRef(backupTimer);
      privateState.pending = true;
      backupTimer = setTimeoutRef(() => {
        backupTimer = null;
        void backupNow().catch(() => undefined);
      }, debounceMs);
      return true;
    }

    async function rotatePassphrase(currentPassphrase, newPassphrase) {
      let envelope;
      try {
        envelope = await readEnvelope();
        if (!envelope) fail('PORTABLE_CONFIG_MISSING');
        const oldKeyBytes = await derivePortableConfigKey(currentPassphrase, {
          salt: fromBase64(envelope.encryption.salt),
          iterations: envelope.encryption.iterations,
          cryptoRef
        });
        const decrypted = await decryptPortableConfig(envelope, {
          keyBytes: oldKeyBytes,
          cryptoRef
        });
        const normalized = normalizedPayload(decrypted.payload);
        const exportedAt = timestamp();
        const payload = buildPayload(
          normalized.settings,
          normalized.globalAbbreviations,
          exportedAt
        );
        const salt = randomSalt();
        const newKeyBytes = await derivePortableConfigKey(newPassphrase, {
          salt,
          iterations: envelope.encryption.iterations,
          cryptoRef
        });
        const rotated = await encryptPortableConfig(payload, {
          keyBytes: newKeyBytes,
          salt,
          backupId: envelope.backupId,
          revision: envelope.revision + 1,
          now: exportedAt,
          iterations: envelope.encryption.iterations,
          cryptoRef
        });
        privateState.pending = true;
        await writeEnvelope(rotated);
        await updateCache(envelope.backupId, newKeyBytes);
        setEnvelopeState(rotated);
        privateState.state = 'ready';
        privateState.pending = false;
        privateState.lastError = '';
        return publicStatus();
      } catch (error) {
        if (privateState.pending || privateState.state !== 'ready') {
          privateState.state = envelope ? 'locked' : 'missing';
        }
        privateState.lastError = safeCode(error, 'PORTABLE_CONFIG_ROTATE_FAILED');
        fail('PORTABLE_CONFIG_ROTATE_FAILED');
      }
    }

    async function forgetKey() {
      if (privateState.backupId) await updateCache(privateState.backupId, null);
      privateState.state = 'locked';
      privateState.pending = true;
      privateState.lastError = '';
      return publicStatus();
    }

    function dispose() {
      disposed = true;
      if (backupTimer !== null) clearTimeoutRef(backupTimer);
      backupTimer = null;
    }

    return {
      publicStatus,
      probe,
      unlock,
      create,
      backupNow,
      scheduleBackup,
      rotatePassphrase,
      forgetKey,
      dispose
    };
  }

  return { createPortableConfigManager, PORTABLE_CONFIG_KEY_CACHE };
});
