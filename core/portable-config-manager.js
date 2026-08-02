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
      path = shared.PORTABLE_CONFIG_PATH,
      payloadKind = shared.PORTABLE_CONFIG_PAYLOAD_KIND,
      setTimeoutRef = globalThis.setTimeout,
      clearTimeoutRef = globalThis.clearTimeout,
      debounceMs = 500
    } = options;

    if (!directorySync?.readJson || !directorySync?.compareAndSwapJson ||
        !storageArea?.get || !storageArea?.set ||
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
    let operationTail = Promise.resolve();

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
      return Promise.resolve().then(() => storageArea[method](value));
    }

    function serializeOperation(operation, { automatic = false } = {}) {
      if (disposed && !automatic) {
        return Promise.reject(Object.assign(
          new Error('PORTABLE_CONFIG_MANAGER_DISPOSED'),
          { code: 'PORTABLE_CONFIG_MANAGER_DISPOSED' }
        ));
      }
      const execute = () => {
        if (automatic && disposed) return publicStatus();
        return operation();
      };
      const result = operationTail.then(execute, execute);
      operationTail = result.catch(() => undefined);
      return result;
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

    async function updateCache(backupId, keyBytes) {
      const cache = await readCache();
      const nextCache = cacheWithKey(cache, backupId, keyBytes);
      await callStorage('set', { [PORTABLE_CONFIG_KEY_CACHE]: nextCache });
    }

    function cacheWithKey(cache, backupId, keyBytes) {
      const nextCache = { ...cache };
      delete nextCache[backupId];
      if (keyBytes) nextCache[backupId] = toBase64(keyBytes);
      return nextCache;
    }

    async function removeCachedKey(backupId) {
      await updateCache(backupId, null);
    }

    function assertDirectoryAvailable(result) {
      if (result?.permission !== 'granted') {
        fail('PORTABLE_CONFIG_DIRECTORY_UNAVAILABLE');
      }
      return result;
    }

    async function readEnvelope() {
      const result = await directorySync.readJson(path);
      assertDirectoryAvailable(result);
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

    async function commitRestoredPayload(normalized, cache) {
      const values = {
        [settingsKey]: normalized.settings,
        [abbreviationKey]: normalized.globalAbbreviations
      };
      if (cache) values[PORTABLE_CONFIG_KEY_CACHE] = cache;
      await callStorage('set', values);
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

    async function probeNow() {
      privateState.lastError = '';
      let envelope;
      try {
        envelope = await readEnvelope();
      } catch (error) {
        if (error?.code === 'PORTABLE_CONFIG_DIRECTORY_UNAVAILABLE') {
          privateState.state = 'unavailable';
          privateState.pending = false;
          privateState.lastError = error.code;
          return publicStatus();
        }
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
      let cache;
      try {
        cache = await readCache();
      } catch (_) {
        privateState.state = 'error';
        privateState.lastError = 'PORTABLE_CONFIG_PROBE_FAILED';
        return publicStatus();
      }
      const keyBytes = decodeCachedKey(cache[envelope.backupId]);
      if (!keyBytes) {
        if (Object.prototype.hasOwnProperty.call(cache, envelope.backupId)) {
          try {
            await removeCachedKey(envelope.backupId);
          } catch (_) {
            privateState.state = 'error';
            privateState.pending = false;
            privateState.lastError = 'PORTABLE_CONFIG_STORAGE_FAILED';
            return publicStatus();
          }
          privateState.lastError = 'PORTABLE_CONFIG_CACHED_KEY_INVALID';
        }
        privateState.state = 'locked';
        privateState.pending = false;
        return publicStatus();
      }
      let payload;
      try {
        ({ payload } = await decryptPortableConfig(envelope, { keyBytes, cryptoRef }));
      } catch (error) {
        if (error?.code !== 'PORTABLE_CONFIG_DECRYPT_FAILED') {
          privateState.state = 'error';
          privateState.pending = false;
          privateState.lastError = 'PORTABLE_CONFIG_PROBE_FAILED';
          return publicStatus();
        }
        try {
          await removeCachedKey(envelope.backupId);
        } catch (_) {
          privateState.state = 'error';
          privateState.pending = false;
          privateState.lastError = 'PORTABLE_CONFIG_PROBE_FAILED';
          return publicStatus();
        }
        privateState.state = 'locked';
        privateState.pending = false;
        privateState.lastError = 'PORTABLE_CONFIG_CACHED_KEY_REJECTED';
        return publicStatus();
      }
      try {
        const normalized = normalizedPayload(payload);
        await commitRestoredPayload(normalized);
        privateState.state = 'ready';
        privateState.pending = false;
        privateState.lastError = '';
      } catch (_) {
        privateState.state = 'error';
        privateState.pending = false;
        privateState.lastError = 'PORTABLE_CONFIG_RESTORE_FAILED';
      }
      return publicStatus();
    }

    async function unlockNow(passphrase) {
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
        const normalized = normalizedPayload(payload);
        const cache = await readCache();
        const nextCache = cacheWithKey(cache, envelope.backupId, keyBytes);
        await commitRestoredPayload(normalized, nextCache);
        privateState.state = 'ready';
        privateState.pending = false;
        privateState.lastError = '';
        return publicStatus();
      } catch (error) {
        if (error?.code === 'PORTABLE_CONFIG_DIRECTORY_UNAVAILABLE') {
          privateState.state = 'unavailable';
          privateState.pending = false;
          privateState.lastError = error.code;
          fail(error.code);
        }
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

    async function writeEnvelope(envelope, { mode, expected } = {}) {
      try {
        const result = await directorySync.compareAndSwapJson(path, envelope, {
          mode,
          ...(expected ? { expected } : {})
        });
        if (!result?.committed) fail('PORTABLE_CONFIG_DIRECTORY_WRITE_FAILED');
        return result;
      } catch (error) {
        if (error?.code === 'DIRECTORY_PERMISSION_REQUIRED') {
          fail('PORTABLE_CONFIG_DIRECTORY_UNAVAILABLE');
        }
        if (error?.code === 'DIRECTORY_CAS_CONFLICT' ||
            error?.code === 'DIRECTORY_CAS_CURRENT_INVALID') {
          fail('PORTABLE_CONFIG_DIRECTORY_CONFLICT');
        }
        if (error?.code?.startsWith?.('PORTABLE_CONFIG_')) throw error;
        fail('PORTABLE_CONFIG_DIRECTORY_WRITE_FAILED');
      }
    }

    function randomSalt() {
      if (!cryptoRef?.getRandomValues) fail('PORTABLE_CONFIG_CRYPTO_UNAVAILABLE');
      return cryptoRef.getRandomValues(new Uint8Array(16));
    }

    async function createNow(passphrase) {
      let existing;
      try {
        existing = await directorySync.readJson(path);
        assertDirectoryAvailable(existing);
      } catch (error) {
        if (error?.code === 'PORTABLE_CONFIG_DIRECTORY_UNAVAILABLE') {
          privateState.state = 'unavailable';
          privateState.pending = false;
          privateState.lastError = error.code;
          fail(error.code);
        }
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
      let keyBytes;
      let envelope;
      try {
        keyBytes = await derivePortableConfigKey(passphrase, {
          salt, iterations, cryptoRef
        });
        const payload = await loadPayload(exportedAt);
        envelope = await encryptPortableConfig(payload, {
          keyBytes,
          salt,
          backupId,
          revision: 1,
          now: exportedAt,
          iterations,
          cryptoRef
        });
      } catch (error) {
        privateState.state = 'missing';
        privateState.pending = true;
        privateState.lastError = safeCode(error, 'PORTABLE_CONFIG_CREATE_FAILED');
        fail('PORTABLE_CONFIG_CREATE_FAILED');
      }
      try {
        await writeEnvelope(envelope, { mode: 'create' });
      } catch (error) {
        if (error?.code === 'PORTABLE_CONFIG_DIRECTORY_UNAVAILABLE') {
          privateState.state = 'unavailable';
          privateState.pending = true;
          privateState.lastError = error.code;
          fail(error.code);
        }
        privateState.state = 'missing';
        privateState.pending = true;
        privateState.lastError = safeCode(error, 'PORTABLE_CONFIG_CREATE_FAILED');
        if (error?.code === 'PORTABLE_CONFIG_DIRECTORY_CONFLICT') {
          fail('PORTABLE_CONFIG_ALREADY_EXISTS');
        }
        fail('PORTABLE_CONFIG_CREATE_FAILED');
      }
      setEnvelopeState(envelope);
      try {
        await updateCache(backupId, keyBytes);
      } catch (_) {
        privateState.state = 'locked';
        privateState.pending = true;
        privateState.lastError = 'PORTABLE_CONFIG_STORAGE_FAILED';
        fail('PORTABLE_CONFIG_CREATED_KEY_CACHE_FAILED');
      }
      privateState.state = 'ready';
      privateState.pending = false;
      privateState.lastError = '';
      return publicStatus();
    }

    async function backupNowInternal() {
      if (privateState.state !== 'ready' || !privateState.backupId) {
        privateState.state = 'locked';
        privateState.pending = true;
        privateState.lastError = 'PORTABLE_CONFIG_LOCKED';
        fail('PORTABLE_CONFIG_LOCKED');
      }
      let cache;
      try {
        cache = await readCache();
      } catch (_) {
        privateState.state = 'error';
        privateState.pending = true;
        privateState.lastError = 'PORTABLE_CONFIG_BACKUP_FAILED';
        fail('PORTABLE_CONFIG_BACKUP_FAILED');
      }
      const keyBytes = decodeCachedKey(cache[privateState.backupId]);
      if (!keyBytes) {
        if (Object.prototype.hasOwnProperty.call(cache, privateState.backupId)) {
          try {
            await removeCachedKey(privateState.backupId);
          } catch (_) {
            privateState.state = 'error';
            privateState.pending = true;
            privateState.lastError = 'PORTABLE_CONFIG_STORAGE_FAILED';
            fail('PORTABLE_CONFIG_BACKUP_FAILED');
          }
        }
        privateState.state = 'locked';
        privateState.pending = true;
        privateState.lastError = 'PORTABLE_CONFIG_LOCKED';
        fail('PORTABLE_CONFIG_LOCKED');
      }
      privateState.pending = true;
      privateState.lastError = '';
      let currentEnvelope;
      try {
        const current = await directorySync.readJson(path);
        assertDirectoryAvailable(current);
        if (!current?.found) fail('PORTABLE_CONFIG_BACKUP_SOURCE_MISSING');
        currentEnvelope = validatePortableEnvelope(current.value);
        if (currentEnvelope.backupId !== privateState.backupId ||
            currentEnvelope.revision !== privateState.revision ||
            currentEnvelope.encryption.salt !== privateState.salt ||
            currentEnvelope.encryption.iterations !== privateState.iterations) {
          fail('PORTABLE_CONFIG_BACKUP_DIVERGED');
        }
        try {
          await decryptPortableConfig(currentEnvelope, { keyBytes, cryptoRef });
        } catch (error) {
          if (error?.code !== 'PORTABLE_CONFIG_DECRYPT_FAILED') throw error;
          await removeCachedKey(privateState.backupId);
          privateState.state = 'locked';
          privateState.lastError = 'PORTABLE_CONFIG_CACHED_KEY_REJECTED';
          fail('PORTABLE_CONFIG_BACKUP_AUTH_FAILED');
        }
      } catch (error) {
        if (error?.code === 'PORTABLE_CONFIG_DIRECTORY_UNAVAILABLE') {
          privateState.state = 'unavailable';
          privateState.lastError = error.code;
          privateState.pending = true;
          fail(error.code);
        }
        if (error?.code !== 'PORTABLE_CONFIG_BACKUP_AUTH_FAILED') {
          privateState.state = 'error';
          privateState.lastError = safeCode(error, 'PORTABLE_CONFIG_BACKUP_FAILED');
        }
        privateState.pending = true;
        fail('PORTABLE_CONFIG_BACKUP_FAILED');
      }
      const exportedAt = timestamp();
      try {
        const payload = await loadPayload(exportedAt);
        const envelope = await encryptPortableConfig(payload, {
          keyBytes,
          salt: currentEnvelope.encryption.salt,
          backupId: currentEnvelope.backupId,
          revision: currentEnvelope.revision + 1,
          now: exportedAt,
          iterations: currentEnvelope.encryption.iterations,
          cryptoRef
        });
        await writeEnvelope(envelope, { mode: 'update', expected: currentEnvelope });
        setEnvelopeState(envelope);
        privateState.state = 'ready';
        privateState.pending = false;
        privateState.lastError = '';
        return publicStatus();
      } catch (error) {
        privateState.pending = true;
        privateState.lastError = safeCode(error, 'PORTABLE_CONFIG_BACKUP_FAILED');
        if (error?.code === 'PORTABLE_CONFIG_DIRECTORY_UNAVAILABLE') {
          privateState.state = 'unavailable';
          fail(error.code);
        }
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
        void serializeOperation(backupNowInternal, { automatic: true })
          .catch(() => undefined);
      }, debounceMs);
      return true;
    }

    function runWhenReady(operation) {
      return serializeOperation(() => {
        if (privateState.state !== 'ready' || privateState.pending) {
          fail('PORTABLE_CONFIG_NOT_READY');
        }
        return operation();
      });
    }

    async function rotatePassphraseNow(currentPassphrase, newPassphrase) {
      let envelope;
      let committed = false;
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
        await writeEnvelope(rotated, { mode: 'update', expected: envelope });
        committed = true;
        setEnvelopeState(rotated);
        await updateCache(envelope.backupId, newKeyBytes);
        privateState.state = 'ready';
        privateState.pending = false;
        privateState.lastError = '';
        return publicStatus();
      } catch (error) {
        if (error?.code === 'PORTABLE_CONFIG_DIRECTORY_UNAVAILABLE') {
          privateState.state = 'unavailable';
          privateState.pending = true;
          privateState.lastError = error.code;
          fail(error.code);
        }
        if (committed) {
          privateState.state = 'locked';
          privateState.pending = true;
          privateState.lastError = 'PORTABLE_CONFIG_STORAGE_FAILED';
          fail('PORTABLE_CONFIG_ROTATE_FAILED');
        }
        if (privateState.pending || privateState.state !== 'ready') {
          privateState.state = envelope ? 'locked' : 'missing';
        }
        privateState.lastError = safeCode(error, 'PORTABLE_CONFIG_ROTATE_FAILED');
        fail('PORTABLE_CONFIG_ROTATE_FAILED');
      }
    }

    async function forgetKeyNow() {
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
      return operationTail.then(() => undefined);
    }

    const probe = () => serializeOperation(probeNow);
    const unlock = passphrase => serializeOperation(() => unlockNow(passphrase));
    const create = passphrase => serializeOperation(() => createNow(passphrase));
    const backupNow = () => serializeOperation(backupNowInternal);
    const rotatePassphrase = (currentPassphrase, newPassphrase) =>
      serializeOperation(() => rotatePassphraseNow(currentPassphrase, newPassphrase));
    const forgetKey = () => serializeOperation(forgetKeyNow);

    return {
      publicStatus,
      probe,
      unlock,
      create,
      backupNow,
      scheduleBackup,
      runWhenReady,
      rotatePassphrase,
      forgetKey,
      dispose
    };
  }

  return { createPortableConfigManager, PORTABLE_CONFIG_KEY_CACHE };
});
