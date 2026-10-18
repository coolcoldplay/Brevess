const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

globalThis.crypto = webcrypto;

const codec = require('../core/portable-config.js');
const abbreviationApi = require('../core/abbreviation-extractor.js');
require('../core/confidence-policy.js');
require('../core/category-store.js');
require('../core/adaptive-catalog.js');
const settingsApi = require('../core/settings-store.js');
const {
  createPortableConfigManager,
  PORTABLE_CONFIG_KEY_CACHE
} = require('../core/portable-config-manager.js');

const PASSPHRASE = 'correct horse battery staple';
const OTHER_PASSPHRASE = 'another suitably long passphrase';
const SETTINGS_KEY = 'settings-key';
const REAL_SETTINGS_KEY = 'sciLlmSettingsV2';
const ABBREVIATION_KEY = 'abbreviation-key';
const MINERU_KEY = 'mineru-settings-key';
const FIXED_SALT = new Uint8Array(16).fill(7);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

async function waitForCondition(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return true;
}

function createStorage(initial = {}) {
  const data = clone(initial);
  const sets = [];
  let setFailure = null;
  let getFailure = null;
  let promiseOnly = false;
  return {
    data,
    sets,
    requirePromiseOnly() { promiseOnly = true; },
    failSetWhen(predicate, error = new Error('storage write failed')) {
      setFailure = { predicate, error };
    },
    failGetWhen(predicate, error = new Error('storage read failed')) {
      getFailure = { predicate, error };
    },
    clearSetFailure() { setFailure = null; },
    async get(keys, ...extra) {
      if (promiseOnly && extra.length) throw new Error('callback API forbidden');
      if (getFailure?.predicate(keys)) throw getFailure.error;
      if (keys === null || keys === undefined) return clone(data);
      const selected = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(selected
        .filter(key => Object.prototype.hasOwnProperty.call(data, key))
        .map(key => [key, clone(data[key])]));
    },
    async set(values, ...extra) {
      if (promiseOnly && extra.length) throw new Error('callback API forbidden');
      if (setFailure?.predicate(values)) throw setFailure.error;
      sets.push(clone(values));
      Object.assign(data, clone(values));
    }
  };
}

function createDirectory(initialValue = null, options = {}) {
  let disk = clone(initialValue);
  let queued = null;
  let permission = options.permission || 'granted';
  const reads = [];
  const enqueues = [];
  const casWrites = [];
  let flushCalls = 0;
  return {
    reads,
    enqueues,
    casWrites,
    get flushCalls() { return flushCalls; },
    get disk() { return clone(disk); },
    replaceDisk(value) { disk = clone(value); },
    setPermission(value) { permission = value; },
    async readJson(path) {
      reads.push(path);
      return {
        permission,
        found: permission === 'granted' && disk !== null,
        value: permission === 'granted' ? clone(disk) : null
      };
    },
    async compareAndSwapJson(path, value, casOptions = {}) {
      if (permission !== 'granted') {
        const error = new Error('DIRECTORY_PERMISSION_REQUIRED');
        error.code = 'DIRECTORY_PERMISSION_REQUIRED';
        error.permission = permission;
        throw error;
      }
      const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
      const conflict = () => {
        const error = new Error('DIRECTORY_CAS_CONFLICT');
        error.code = 'DIRECTORY_CAS_CONFLICT';
        throw error;
      };
      if (options.flushError) throw options.flushError;
      if (options.conflict) conflict();
      if (casOptions.mode === 'create') {
        if (disk !== null) conflict();
      } else if (casOptions.mode === 'update') {
        if (disk === null || !same(disk, casOptions.expected)) conflict();
      } else {
        throw new Error('invalid CAS mode');
      }
      if (typeof options.beforeCasCommit === 'function') {
        await options.beforeCasCommit({ path, value: clone(value), options: clone(casOptions) });
      }
      disk = clone(value);
      casWrites.push({ path, value: clone(value), options: clone(casOptions) });
      return {
        committed: true,
        permission: 'granted',
        mode: casOptions.mode,
        revision: value.revision,
        previousRevision: casOptions.expected?.revision ?? null
      };
    },
    async enqueueJson(path, value) {
      queued = { path, value: clone(value) };
      enqueues.push(clone(queued));
      return { queued: true };
    },
    async flush() {
      flushCalls += 1;
      if (options.flushError) throw options.flushError;
      if (options.conflict) {
        queued = null;
        return { permission: 'granted', conflicts: 1, failed: 0, pendingCount: 0, written: 0 };
      }
      if (options.flushResult) return clone(options.flushResult);
      if (queued) disk = clone(queued.value);
      queued = null;
      return { permission: 'granted', conflicts: 0, failed: 0, pendingCount: 0, written: 1 };
    }
  };
}

function normalizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error('INVALID_SETTINGS');
    error.code = 'INVALID_SETTINGS';
    throw error;
  }
  return clone(value);
}

function normalizeAbbreviations(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.entries)) {
    const error = new Error('INVALID_ABBREVIATIONS');
    error.code = 'INVALID_ABBREVIATIONS';
    throw error;
  }
  return { schemaVersion: 1, entries: clone(value.entries) };
}

function loadSettingsLikeBackground(storageArea) {
  const portableSettingsStorage = {
    get(keys) {
      return storageArea.get(keys);
    }
  };
  return settingsApi.loadSettings(portableSettingsStorage);
}

function managerFixture({ disk = null, storage = {}, directoryOptions = {}, overrides = {} } = {}) {
  const storageArea = createStorage(storage);
  const directorySync = createDirectory(disk, directoryOptions);
  let nowIndex = 0;
  const manager = createPortableConfigManager({
    directorySync,
    storageArea,
    settingsKey: SETTINGS_KEY,
    abbreviationKey: ABBREVIATION_KEY,
    ...codec,
    normalizeSettings,
    normalizeAbbreviations,
    loadSettings: async area => normalizeSettings((await area.get(SETTINGS_KEY))[SETTINGS_KEY]),
    loadGlobalAbbreviations: async area => normalizeAbbreviations((await area.get(ABBREVIATION_KEY))[ABBREVIATION_KEY]),
    extensionVersion: '9.8.7',
    now: () => `2026-08-03T00:00:0${nowIndex++}.000Z`,
    randomId: () => 'backup-test-0001',
    cryptoRef: webcrypto,
    ...overrides
  });
  return { manager, storageArea, directorySync };
}

async function encryptedFixture({
  passphrase = PASSPHRASE,
  backupId = 'backup-existing-1',
  revision = 4,
  salt = FIXED_SALT,
  settings = { profiles: { p1: { config: { apiKey: 'sk-portable' } } } },
  abbreviations = { schemaVersion: 1, entries: [{ abbreviation: 'TNF', fullName: 'tumor necrosis factor' }] }
} = {}) {
  const keyBytes = await codec.derivePortableConfigKey(passphrase, {
    salt,
    cryptoRef: webcrypto
  });
  const payload = {
    kind: codec.PORTABLE_CONFIG_PAYLOAD_KIND,
    schemaVersion: 1,
    sourceVersion: '9.8.7',
    exportedAt: '2026-08-03T00:00:00.000Z',
    settings: clone(settings),
    globalAbbreviations: clone(abbreviations)
  };
  const envelope = await codec.encryptPortableConfig(payload, {
    keyBytes,
    salt,
    backupId,
    revision,
    now: '2026-08-03T00:00:00.000Z',
    cryptoRef: webcrypto
  });
  return { envelope, payload, keyBytes };
}

test('probe is read-before-write and reports locked when an existing backup has no cached key', async () => {
  const { envelope } = await encryptedFixture();
  const { manager, directorySync } = managerFixture({ disk: envelope });

  assert.deepEqual(await manager.probe(), {
    state: 'locked', revision: 4, updatedAt: envelope.updatedAt,
    pending: false, lastError: ''
  });
  assert.deepEqual(directorySync.reads, [codec.PORTABLE_CONFIG_PATH]);
  assert.equal(directorySync.enqueues.length, 0);
});

test('probe restores both values atomically with a matching cached key and becomes ready', async () => {
  const { envelope, payload, keyBytes } = await encryptedFixture();
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { old: true },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] },
      [PORTABLE_CONFIG_KEY_CACHE]: { [envelope.backupId]: codec.toBase64(keyBytes) }
    }
  });

  const status = await manager.probe();
  assert.equal(status.state, 'ready');
  assert.deepEqual(storageArea.sets[0], {
    [SETTINGS_KEY]: payload.settings,
    [ABBREVIATION_KEY]: payload.globalAbbreviations
  });
  assert.equal(directorySync.enqueues.length, 0);
});

test('unlock restores secrets and abbreviations, and never caches the passphrase', async () => {
  const { envelope, payload } = await encryptedFixture();
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { old: true },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] },
      [PORTABLE_CONFIG_KEY_CACHE]: { 'other-backup': codec.toBase64(new Uint8Array(32).fill(3)) }
    }
  });

  await manager.probe();
  const status = await manager.unlock(PASSPHRASE);
  assert.equal(status.state, 'ready');
  assert.equal(storageArea.data[SETTINGS_KEY].profiles.p1.config.apiKey, 'sk-portable');
  assert.equal(storageArea.data[ABBREVIATION_KEY].entries[0].abbreviation, 'TNF');
  assert.equal(JSON.stringify(storageArea.data[PORTABLE_CONFIG_KEY_CACHE]).includes(PASSPHRASE), false);
  assert.ok(storageArea.data[PORTABLE_CONFIG_KEY_CACHE]['other-backup']);
  assert.equal(directorySync.enqueues.length, 0);
});

test('a wrong passphrase changes neither local values nor directory/cache state', async () => {
  const { envelope } = await encryptedFixture();
  const initial = {
    [SETTINGS_KEY]: { local: 'keep' },
    [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] },
    [PORTABLE_CONFIG_KEY_CACHE]: { other: codec.toBase64(new Uint8Array(32).fill(2)) }
  };
  const { manager, storageArea, directorySync } = managerFixture({ disk: envelope, storage: initial });

  await assert.rejects(() => manager.unlock(OTHER_PASSPHRASE), error =>
    error.code === 'PORTABLE_CONFIG_UNLOCK_FAILED' && error.message === error.code);
  assert.deepEqual(storageArea.data, initial);
  assert.equal(directorySync.enqueues.length, 0);
  assert.equal(directorySync.flushCalls, 0);
});

test('unlock rejects envelopes with unauthenticated extra fields before restoring local data', async () => {
  const { envelope } = await encryptedFixture();
  const cases = [
    { ...envelope, sourceId: 'apiKey=sk-manager-smuggle' },
    {
      ...envelope,
      encryption: { ...envelope.encryption, extra: 'sk-manager-encryption-smuggle' }
    }
  ];

  for (const hostile of cases) {
    const initial = {
      [SETTINGS_KEY]: { local: 'keep' },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] },
      [PORTABLE_CONFIG_KEY_CACHE]: { other: codec.toBase64(new Uint8Array(32).fill(2)) }
    };
    const { manager, storageArea, directorySync } = managerFixture({
      disk: hostile,
      storage: initial
    });

    await assert.rejects(
      () => manager.unlock(PASSPHRASE),
      error => error.code === 'PORTABLE_CONFIG_UNLOCK_FAILED'
    );
    assert.deepEqual(storageArea.data, initial);
    assert.equal(storageArea.sets.length, 0);
    assert.deepEqual(directorySync.disk, hostile);
    assert.equal(directorySync.casWrites.length, 0);
  }
});

test('invalid cached key falls back to locked without changing local values', async () => {
  const { envelope } = await encryptedFixture();
  const initialSettings = { local: 'keep' };
  const { manager, storageArea } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: initialSettings,
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] },
      [PORTABLE_CONFIG_KEY_CACHE]: { [envelope.backupId]: codec.toBase64(new Uint8Array(12)) }
    }
  });

  assert.equal((await manager.probe()).state, 'locked');
  assert.deepEqual(storageArea.data[SETTINGS_KEY], initialSettings);
});

test('publicStatus exposes no backup identity, salt, iterations, key, or payload', async () => {
  const { manager } = managerFixture();
  const status = manager.publicStatus();
  assert.deepEqual(Object.keys(status).sort(), ['lastError', 'pending', 'revision', 'state', 'updatedAt']);
  assert.equal(JSON.stringify(status).includes('backup'), false);
});

test('create refuses to overwrite an existing portable file', async () => {
  const { envelope } = await encryptedFixture();
  const { manager, directorySync } = managerFixture({ disk: envelope });

  await assert.rejects(() => manager.create(PASSPHRASE), error =>
    error.code === 'PORTABLE_CONFIG_ALREADY_EXISTS');
  assert.equal(directorySync.enqueues.length, 0);
  assert.equal(directorySync.flushCalls, 0);
  assert.deepEqual(directorySync.disk, envelope);
});

test('create writes revision 1 ciphertext that decrypts to complete normalized local config', async () => {
  const settings = { profiles: { p1: { config: { apiKey: 'sk-create-secret' } } }, theme: 'dark' };
  const abbreviations = {
    schemaVersion: 1,
    entries: [{ abbreviation: 'TNF', fullName: 'tumor necrosis factor' }]
  };
  const { manager, storageArea, directorySync } = managerFixture({
    storage: { [SETTINGS_KEY]: settings, [ABBREVIATION_KEY]: abbreviations }
  });

  const status = await manager.create(PASSPHRASE);
  assert.equal(status.state, 'ready');
  assert.equal(status.revision, 1);
  assert.equal(directorySync.casWrites.length, 1);
  assert.equal(directorySync.casWrites[0].path, codec.PORTABLE_CONFIG_PATH);
  const envelope = directorySync.disk;
  const keyBytes = await codec.derivePortableConfigKey(PASSPHRASE, {
    salt: codec.fromBase64(envelope.encryption.salt),
    iterations: envelope.encryption.iterations,
    cryptoRef: webcrypto
  });
  const { payload } = await codec.decryptPortableConfig(envelope, { keyBytes, cryptoRef: webcrypto });
  assert.equal(payload.kind, codec.PORTABLE_CONFIG_PAYLOAD_KIND);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.sourceVersion, '9.8.7');
  assert.deepEqual(payload.settings, settings);
  assert.deepEqual(payload.globalAbbreviations, abbreviations);
  assert.equal(JSON.stringify(envelope).includes('sk-create-secret'), false);
  assert.ok(storageArea.data[PORTABLE_CONFIG_KEY_CACHE][envelope.backupId]);
});

test('portable encryption backs up and restores the complete MinerU PDF configuration', async () => {
  const settings = { profiles: { p1: { config: { apiKey: 'sk-model' } } } };
  const abbreviations = { schemaVersion: 1, entries: [] };
  const mineru = {
    mode: 'precise', token: 'mineru-secret-token', quotaUserId: 'quota-user',
    language: 'en', isOcr: true, enableTable: true, enableFormula: false
  };
  const dependencies = {
    mineruSettingsKey: MINERU_KEY,
    normalizeMineruSettings: value => ({ ...value }),
    loadMineruSettings: async area => (await area.get(MINERU_KEY))[MINERU_KEY]
  };
  const source = managerFixture({
    storage: {
      [SETTINGS_KEY]: settings,
      [ABBREVIATION_KEY]: abbreviations,
      [MINERU_KEY]: mineru
    },
    overrides: dependencies
  });
  await source.manager.create(PASSPHRASE);
  assert.equal(JSON.stringify(source.directorySync.disk).includes(mineru.token), false);

  const target = managerFixture({
    disk: source.directorySync.disk,
    storage: {
      [SETTINGS_KEY]: { old: true },
      [ABBREVIATION_KEY]: abbreviations,
      [MINERU_KEY]: { mode: 'agent', token: '' }
    },
    overrides: dependencies
  });
  await target.manager.unlock(PASSPHRASE);
  assert.deepEqual(target.storageArea.data[MINERU_KEY], mineru);
});

test('restoring a legacy portable payload does not erase an existing MinerU token', async () => {
  const { envelope } = await encryptedFixture();
  const existingMineru = { mode: 'precise', token: 'keep-existing-mineru-token' };
  const { manager, storageArea } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { old: true },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] },
      [MINERU_KEY]: existingMineru
    },
    overrides: {
      mineruSettingsKey: MINERU_KEY,
      normalizeMineruSettings: value => ({ ...value }),
      loadMineruSettings: async area => (await area.get(MINERU_KEY))[MINERU_KEY]
    }
  });
  await manager.unlock(PASSPHRASE);
  assert.deepEqual(storageArea.data[MINERU_KEY], existingMineru);
});

test('backupNow increments revision, changes IV, and encrypts the latest local values', async () => {
  const { envelope } = await encryptedFixture({ revision: 8 });
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { local: 'old' },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
    }
  });
  await manager.unlock(PASSPHRASE);
  await storageArea.set({
    [SETTINGS_KEY]: { profiles: { p2: { config: { apiKey: 'sk-latest' } } } },
    [ABBREVIATION_KEY]: {
      schemaVersion: 1,
      entries: [{ abbreviation: 'IL-6', fullName: 'interleukin 6' }]
    }
  });

  const status = await manager.backupNow();
  assert.equal(status.revision, 9);
  assert.notEqual(directorySync.disk.encryption.iv, envelope.encryption.iv);
  const keyBytes = codec.fromBase64(
    storageArea.data[PORTABLE_CONFIG_KEY_CACHE][envelope.backupId]
  );
  const { payload } = await codec.decryptPortableConfig(directorySync.disk, {
    keyBytes, cryptoRef: webcrypto
  });
  assert.equal(payload.settings.profiles.p2.config.apiKey, 'sk-latest');
  assert.equal(payload.globalAbbreviations.entries[0].abbreviation, 'IL-6');
});

test('rotatePassphrase rejects a wrong current passphrase without writing or changing cache', async () => {
  const { envelope, keyBytes } = await encryptedFixture();
  const initialCache = {
    other: codec.toBase64(new Uint8Array(32).fill(5)),
    [envelope.backupId]: codec.toBase64(keyBytes)
  };
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { local: true },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] },
      [PORTABLE_CONFIG_KEY_CACHE]: initialCache
    }
  });
  await manager.probe();
  directorySync.enqueues.length = 0;

  await assert.rejects(
    () => manager.rotatePassphrase(OTHER_PASSPHRASE, 'brand new secure passphrase'),
    error => error.code === 'PORTABLE_CONFIG_ROTATE_FAILED'
  );
  assert.equal(directorySync.enqueues.length, 0);
  assert.deepEqual(storageArea.data[PORTABLE_CONFIG_KEY_CACHE], initialCache);
  assert.deepEqual(directorySync.disk, envelope);
});

test('rotatePassphrase preserves backup identity while changing salt/key and revision', async () => {
  const { envelope, keyBytes: oldKey } = await encryptedFixture({ revision: 11 });
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { local: true },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
    }
  });
  const newPassphrase = 'brand new secure passphrase';
  const status = await manager.rotatePassphrase(PASSPHRASE, newPassphrase);
  const rotated = directorySync.disk;

  assert.equal(status.state, 'ready');
  assert.equal(rotated.backupId, envelope.backupId);
  assert.equal(rotated.revision, 12);
  assert.notEqual(rotated.encryption.salt, envelope.encryption.salt);
  await assert.rejects(() => codec.decryptPortableConfig(rotated, {
    keyBytes: oldKey, cryptoRef: webcrypto
  }));
  const newKey = await codec.derivePortableConfigKey(newPassphrase, {
    salt: codec.fromBase64(rotated.encryption.salt),
    iterations: rotated.encryption.iterations,
    cryptoRef: webcrypto
  });
  assert.deepEqual((await codec.decryptPortableConfig(rotated, {
    keyBytes: newKey, cryptoRef: webcrypto
  })).payload.settings, (await encryptedFixture({ revision: 11 })).payload.settings);
  assert.equal(
    storageArea.data[PORTABLE_CONFIG_KEY_CACHE][rotated.backupId],
    codec.toBase64(newKey)
  );
});

test('forgetKey removes only the current backup key and leaves directory/settings untouched', async () => {
  const { envelope, keyBytes } = await encryptedFixture();
  const otherKey = codec.toBase64(new Uint8Array(32).fill(9));
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { local: true },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] },
      [PORTABLE_CONFIG_KEY_CACHE]: {
        other: otherKey,
        [envelope.backupId]: codec.toBase64(keyBytes)
      }
    }
  });
  await manager.probe();
  const settingsBefore = clone(storageArea.data[SETTINGS_KEY]);
  const status = await manager.forgetKey();

  assert.equal(status.state, 'locked');
  assert.equal(status.pending, true);
  assert.deepEqual(storageArea.data[PORTABLE_CONFIG_KEY_CACHE], { other: otherKey });
  assert.deepEqual(storageArea.data[SETTINGS_KEY], settingsBefore);
  assert.deepEqual(directorySync.disk, envelope);
  assert.equal(directorySync.enqueues.length, 0);
});

test('unlock rejects normalization-invalid decrypted data before any local restore or cache write', async () => {
  const { envelope } = await encryptedFixture({ abbreviations: { malformed: true } });
  const initial = {
    [SETTINGS_KEY]: { local: 'keep' },
    [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] },
    [PORTABLE_CONFIG_KEY_CACHE]: { other: codec.toBase64(new Uint8Array(32).fill(4)) }
  };
  const { manager, storageArea, directorySync } = managerFixture({ disk: envelope, storage: initial });

  await assert.rejects(() => manager.unlock(PASSPHRASE), error =>
    error.code === 'PORTABLE_CONFIG_UNLOCK_FAILED');
  assert.deepEqual(storageArea.data, initial);
  assert.equal(directorySync.enqueues.length, 0);
});

test('probe deletes an authentication-failing cached key and safely remains locked', async () => {
  const { envelope } = await encryptedFixture();
  const other = codec.toBase64(new Uint8Array(32).fill(2));
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { local: 'keep' },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] },
      [PORTABLE_CONFIG_KEY_CACHE]: {
        other,
        [envelope.backupId]: codec.toBase64(new Uint8Array(32).fill(1))
      }
    }
  });

  const status = await manager.probe();
  assert.equal(status.state, 'locked');
  assert.equal(status.lastError, 'PORTABLE_CONFIG_CACHED_KEY_REJECTED');
  assert.deepEqual(storageArea.data[PORTABLE_CONFIG_KEY_CACHE], { other });
  assert.equal(directorySync.enqueues.length, 0);
});

test('debounce merges user changes, exact restore callbacks are suppressed, and dispose clears a timer', async () => {
  const { envelope } = await encryptedFixture();
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { local: true },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
    },
    overrides: { debounceMs: 20 }
  });
  await manager.unlock(PASSPHRASE);
  const restoredSettings = clone(storageArea.data[SETTINGS_KEY]);
  const restoredAbbreviations = clone(storageArea.data[ABBREVIATION_KEY]);

  assert.equal(manager.scheduleBackup({
    [SETTINGS_KEY]: { newValue: restoredSettings },
    [ABBREVIATION_KEY]: { newValue: restoredAbbreviations }
  }), false);
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(directorySync.enqueues.length, 0);

  await storageArea.set({ [SETTINGS_KEY]: { user: 'changed' } });
  assert.equal(manager.scheduleBackup({
    [SETTINGS_KEY]: { oldValue: restoredSettings, newValue: { user: 'changed' } }
  }), true);
  assert.equal(manager.publicStatus().pending, true);
  assert.equal(manager.scheduleBackup({ [SETTINGS_KEY]: { newValue: { user: 'changed-again' } } }), true);
  assert.equal(manager.scheduleBackup({ [ABBREVIATION_KEY]: { newValue: restoredAbbreviations } }), true);
  assert.equal(await waitForCondition(() => directorySync.casWrites.length === 1), true);
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(directorySync.casWrites.length, 1);

  manager.scheduleBackup({ [SETTINGS_KEY]: { newValue: { after: 'dispose' } } });
  manager.dispose();
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(directorySync.casWrites.length, 1);
});

test('a real user change is not swallowed when no restore callback was observed', async () => {
  const { envelope } = await encryptedFixture();
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { local: true },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
    },
    overrides: { debounceMs: 20 }
  });
  await manager.unlock(PASSPHRASE);
  await storageArea.set({ [SETTINGS_KEY]: { actualUserEdit: true } });

  assert.equal(manager.scheduleBackup({
    [SETTINGS_KEY]: { newValue: { actualUserEdit: true } }
  }), true);
  assert.equal(await waitForCondition(() => directorySync.casWrites.length === 1), true);
  assert.equal(directorySync.casWrites.length, 1);
});

for (const [label, directoryOptions, expectedLastError] of [
  ['conflict', { conflict: true }, 'PORTABLE_CONFIG_DIRECTORY_CONFLICT'],
  ['CAS write failure', { flushError: new Error('disk contained private content') }, 'PORTABLE_CONFIG_DIRECTORY_WRITE_FAILED']
]) {
  test(`${label} leaves the original directory value intact and reports safe pending state`, async () => {
    const { envelope } = await encryptedFixture();
    const { manager, storageArea, directorySync } = managerFixture({
      disk: envelope,
      directoryOptions,
      storage: {
        [SETTINGS_KEY]: { local: true },
        [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
      }
    });
    await manager.unlock(PASSPHRASE);
    await storageArea.set({ [SETTINGS_KEY]: { changed: true } });

    await assert.rejects(() => manager.backupNow(), error =>
      error.code === 'PORTABLE_CONFIG_BACKUP_FAILED' &&
      !error.message.includes('private content'));
    const status = manager.publicStatus();
    assert.equal(status.state, 'ready');
    assert.equal(status.pending, true);
    assert.equal(status.lastError, expectedLastError);
    assert.deepEqual(directorySync.disk, envelope);
  });
}

test('backupNow with a lost cache key writes nothing and transitions to locked pending', async () => {
  const { envelope } = await encryptedFixture();
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { local: true },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
    }
  });
  await manager.unlock(PASSPHRASE);
  storageArea.data[PORTABLE_CONFIG_KEY_CACHE] = {};

  await assert.rejects(() => manager.backupNow(), error => error.code === 'PORTABLE_CONFIG_LOCKED');
  assert.equal(manager.publicStatus().state, 'locked');
  assert.equal(manager.publicStatus().pending, true);
  assert.equal(directorySync.enqueues.length, 0);
});

test('unlock atomically leaves settings, abbreviations, and cache unchanged when cache persistence fails', async () => {
  const { envelope } = await encryptedFixture();
  const initial = {
    [SETTINGS_KEY]: { local: 'keep' },
    [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] },
    [PORTABLE_CONFIG_KEY_CACHE]: {
      other: codec.toBase64(new Uint8Array(32).fill(6))
    }
  };
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    storage: initial
  });
  storageArea.failSetWhen(values =>
    Object.prototype.hasOwnProperty.call(values, PORTABLE_CONFIG_KEY_CACHE));

  await assert.rejects(() => manager.unlock(PASSPHRASE), error =>
    error.code === 'PORTABLE_CONFIG_UNLOCK_FAILED');
  assert.deepEqual(storageArea.data, initial);
  assert.equal(storageArea.sets.length, 0);
  assert.equal(directorySync.enqueues.length, 0);
});

test('probe keeps a valid cached key when payload normalization fails', async () => {
  const { envelope, keyBytes } = await encryptedFixture();
  const cached = codec.toBase64(keyBytes);
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { local: 'keep' },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] },
      [PORTABLE_CONFIG_KEY_CACHE]: { [envelope.backupId]: cached }
    },
    overrides: {
      normalizeSettings() {
        const error = new Error('normalizer exposed private data');
        error.code = 'INVALID_SETTINGS';
        throw error;
      }
    }
  });

  const status = await manager.probe();
  assert.equal(status.state, 'error');
  assert.equal(status.lastError, 'PORTABLE_CONFIG_RESTORE_FAILED');
  assert.equal(storageArea.data[PORTABLE_CONFIG_KEY_CACHE][envelope.backupId], cached);
  assert.deepEqual(storageArea.data[SETTINGS_KEY], { local: 'keep' });
  assert.equal(directorySync.enqueues.length, 0);
});

test('probe keeps a valid cached key and local data when atomic restore storage fails', async () => {
  const { envelope, keyBytes } = await encryptedFixture();
  const initial = {
    [SETTINGS_KEY]: { local: 'keep' },
    [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] },
    [PORTABLE_CONFIG_KEY_CACHE]: {
      [envelope.backupId]: codec.toBase64(keyBytes)
    }
  };
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    storage: initial
  });
  storageArea.failSetWhen(values =>
    Object.prototype.hasOwnProperty.call(values, SETTINGS_KEY));

  const status = await manager.probe();
  assert.equal(status.state, 'error');
  assert.equal(status.lastError, 'PORTABLE_CONFIG_RESTORE_FAILED');
  assert.deepEqual(storageArea.data, initial);
  assert.equal(directorySync.enqueues.length, 0);
});

test('backupNow removes an authentication-failing 32-byte cached key before any enqueue', async () => {
  const { envelope } = await encryptedFixture();
  const other = codec.toBase64(new Uint8Array(32).fill(4));
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { local: true },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] },
      [PORTABLE_CONFIG_KEY_CACHE]: { other }
    }
  });
  await manager.unlock(PASSPHRASE);
  storageArea.data[PORTABLE_CONFIG_KEY_CACHE][envelope.backupId] =
    codec.toBase64(new Uint8Array(32).fill(1));
  directorySync.reads.length = 0;

  await assert.rejects(() => manager.backupNow(), error =>
    error.code === 'PORTABLE_CONFIG_BACKUP_FAILED');
  assert.deepEqual(directorySync.reads, [codec.PORTABLE_CONFIG_PATH]);
  assert.equal(directorySync.enqueues.length, 0);
  assert.equal(directorySync.flushCalls, 0);
  assert.deepEqual(storageArea.data[PORTABLE_CONFIG_KEY_CACHE], { other });
  assert.equal(manager.publicStatus().state, 'locked');
  assert.equal(manager.publicStatus().pending, true);
});

for (const [label, mutate] of [
  ['revision', envelope => { envelope.revision += 1; }],
  ['salt', envelope => {
    envelope.encryption.salt = codec.toBase64(new Uint8Array(16).fill(9));
  }]
]) {
  test(`backupNow refuses a directory ${label} change before enqueue and preserves cache`, async () => {
    const { envelope } = await encryptedFixture({ revision: 20 });
    const { manager, storageArea, directorySync } = managerFixture({
      disk: envelope,
      storage: {
        [SETTINGS_KEY]: { local: true },
        [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
      }
    });
    await manager.unlock(PASSPHRASE);
    const cacheBefore = clone(storageArea.data[PORTABLE_CONFIG_KEY_CACHE]);
    const changed = clone(envelope);
    mutate(changed);
    directorySync.replaceDisk(changed);
    directorySync.reads.length = 0;

    await assert.rejects(() => manager.backupNow(), error =>
      error.code === 'PORTABLE_CONFIG_BACKUP_FAILED');
    assert.deepEqual(directorySync.reads, [codec.PORTABLE_CONFIG_PATH]);
    assert.equal(directorySync.enqueues.length, 0);
    assert.equal(directorySync.flushCalls, 0);
    assert.deepEqual(storageArea.data[PORTABLE_CONFIG_KEY_CACHE], cacheBefore);
    assert.equal(manager.publicStatus().pending, true);
  });
}

test('manager uses the MV3 Promise-only storage API and restores successfully', async () => {
  const { envelope } = await encryptedFixture();
  const { manager, storageArea } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { local: 'old' },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
    }
  });
  storageArea.requirePromiseOnly();

  assert.equal((await manager.unlock(PASSPHRASE)).state, 'ready');
  assert.equal(storageArea.data[SETTINGS_KEY].profiles.p1.config.apiKey, 'sk-portable');
});

test('storage Promise rejection never reports ready or partially restores unlock', async () => {
  const { envelope } = await encryptedFixture();
  const initial = {
    [SETTINGS_KEY]: { local: 'keep' },
    [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
  };
  const { manager, storageArea } = managerFixture({ disk: envelope, storage: initial });
  storageArea.failGetWhen(keys => keys === PORTABLE_CONFIG_KEY_CACHE);

  await assert.rejects(() => manager.unlock(PASSPHRASE), error =>
    error.code === 'PORTABLE_CONFIG_UNLOCK_FAILED');
  assert.notEqual(manager.publicStatus().state, 'ready');
  assert.deepEqual(storageArea.data, initial);
});

test('permission states never masquerade as a missing portable file', async () => {
  for (const permission of ['unconfigured', 'prompt', 'denied']) {
    const { manager, directorySync } = managerFixture({
      directoryOptions: { permission },
      storage: {
        [SETTINGS_KEY]: { local: true },
        [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
      }
    });
    const status = await manager.probe();
    assert.equal(status.state, 'unavailable');
    assert.equal(status.lastError, 'PORTABLE_CONFIG_DIRECTORY_UNAVAILABLE');
    await assert.rejects(() => manager.create(PASSPHRASE), error =>
      error.code === 'PORTABLE_CONFIG_DIRECTORY_UNAVAILABLE');
    await assert.rejects(() => manager.unlock(PASSPHRASE), error =>
      error.code === 'PORTABLE_CONFIG_DIRECTORY_UNAVAILABLE');
    await assert.rejects(() => manager.rotatePassphrase(PASSPHRASE, OTHER_PASSPHRASE), error =>
      error.code === 'PORTABLE_CONFIG_DIRECTORY_UNAVAILABLE');
    assert.equal(directorySync.casWrites.length, 0);
    assert.equal(directorySync.enqueues.length, 0);
  }
});

test('backup permission loss fails before CAS with a directory-unavailable error', async () => {
  const { envelope } = await encryptedFixture();
  const { manager, directorySync } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { local: true },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
    }
  });
  await manager.unlock(PASSPHRASE);
  directorySync.setPermission('denied');

  await assert.rejects(() => manager.backupNow(), error =>
    error.code === 'PORTABLE_CONFIG_DIRECTORY_UNAVAILABLE');
  assert.equal(directorySync.casWrites.length, 0);
  assert.equal(manager.publicStatus().pending, true);
});

test('create committed but cache failure remains unlockable and never reports missing', async () => {
  const { manager, storageArea, directorySync } = managerFixture({
    storage: {
      [SETTINGS_KEY]: { profiles: { p1: { config: { apiKey: 'sk-created' } } } },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
    }
  });
  storageArea.failSetWhen(values =>
    Object.prototype.hasOwnProperty.call(values, PORTABLE_CONFIG_KEY_CACHE));

  await assert.rejects(() => manager.create(PASSPHRASE), error =>
    error.code === 'PORTABLE_CONFIG_CREATED_KEY_CACHE_FAILED');
  assert.equal(directorySync.disk.revision, 1);
  assert.equal(manager.publicStatus().state, 'locked');
  assert.equal(manager.publicStatus().revision, 1);
  assert.equal(manager.publicStatus().pending, true);
  await assert.rejects(() => manager.create(PASSPHRASE), error =>
    error.code === 'PORTABLE_CONFIG_ALREADY_EXISTS');
  storageArea.clearSetFailure();
  assert.equal((await manager.unlock(PASSPHRASE)).state, 'ready');
});

test('probe removes only an invalid cached key and reports storage cleanup failure safely', async () => {
  const { envelope } = await encryptedFixture();
  const other = codec.toBase64(new Uint8Array(32).fill(3));
  const { manager, storageArea } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { local: true },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] },
      [PORTABLE_CONFIG_KEY_CACHE]: {
        other,
        [envelope.backupId]: 'not-valid-base64'
      }
    }
  });
  assert.equal((await manager.probe()).state, 'locked');
  assert.deepEqual(storageArea.data[PORTABLE_CONFIG_KEY_CACHE], { other });

  storageArea.data[PORTABLE_CONFIG_KEY_CACHE][envelope.backupId] = 'still-invalid';
  storageArea.failSetWhen(values =>
    Object.prototype.hasOwnProperty.call(values, PORTABLE_CONFIG_KEY_CACHE));
  const failed = await manager.probe();
  assert.equal(failed.state, 'error');
  assert.equal(failed.lastError, 'PORTABLE_CONFIG_STORAGE_FAILED');
});

test('concurrent manual backups serialize into consecutive revisions', async () => {
  const { envelope } = await encryptedFixture({ revision: 30 });
  let releaseFirstCas;
  let markFirstCasEntered;
  let casCalls = 0;
  const firstCasEntered = new Promise(resolve => { markFirstCasEntered = resolve; });
  const firstCasGate = new Promise(resolve => { releaseFirstCas = resolve; });
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    directoryOptions: {
      async beforeCasCommit() {
        casCalls += 1;
        if (casCalls !== 1) return;
        markFirstCasEntered();
        await firstCasGate;
      }
    },
    storage: {
      [SETTINGS_KEY]: { local: true },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
    }
  });
  await manager.unlock(PASSPHRASE);
  await storageArea.set({ [SETTINGS_KEY]: { changed: true } });

  const firstBackup = manager.backupNow();
  await firstCasEntered;
  const secondBackup = manager.backupNow();
  releaseFirstCas();
  const [first, second] = await Promise.all([firstBackup, secondBackup]);
  assert.deepEqual([first.revision, second.revision], [31, 32]);
  assert.deepEqual(directorySync.casWrites.map(write => write.value.revision), [31, 32]);
  assert.equal(directorySync.disk.revision, 32);
});

test('rotate followed immediately by backup serializes disk, cache, and state', async () => {
  const { envelope, payload } = await encryptedFixture({ revision: 40 });
  let releaseRotateCas;
  let markRotateCasEntered;
  let casCalls = 0;
  const rotateCasEntered = new Promise(resolve => { markRotateCasEntered = resolve; });
  const rotateCasGate = new Promise(resolve => { releaseRotateCas = resolve; });
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    directoryOptions: {
      async beforeCasCommit() {
        casCalls += 1;
        if (casCalls !== 1) return;
        markRotateCasEntered();
        await rotateCasGate;
      }
    },
    storage: {
      [SETTINGS_KEY]: payload.settings,
      [ABBREVIATION_KEY]: payload.globalAbbreviations
    }
  });
  await manager.unlock(PASSPHRASE);
  const newPassphrase = 'new serialized portable passphrase';

  const rotate = manager.rotatePassphrase(PASSPHRASE, newPassphrase);
  await rotateCasEntered;
  const backup = manager.backupNow();
  releaseRotateCas();
  const [rotated, backedUp] = await Promise.all([rotate, backup]);
  assert.deepEqual([rotated.revision, backedUp.revision], [41, 42]);
  assert.equal(directorySync.disk.revision, 42);
  const keyBytes = codec.fromBase64(
    storageArea.data[PORTABLE_CONFIG_KEY_CACHE][envelope.backupId]
  );
  await codec.decryptPortableConfig(directorySync.disk, { keyBytes, cryptoRef: webcrypto });
  assert.equal(manager.publicStatus().revision, 42);
});

test('create followed immediately by backup executes in one state queue', async () => {
  let releaseCreateCas;
  let markCreateCasEntered;
  const createCasEntered = new Promise(resolve => { markCreateCasEntered = resolve; });
  const createCasGate = new Promise(resolve => { releaseCreateCas = resolve; });
  const { manager, directorySync } = managerFixture({
    directoryOptions: {
      async beforeCasCommit() {
        markCreateCasEntered();
        await createCasGate;
      }
    },
    storage: {
      [SETTINGS_KEY]: { local: true },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
    }
  });
  const create = manager.create(PASSPHRASE);
  await createCasEntered;
  const backup = manager.backupNow();
  releaseCreateCas();
  const [created, backedUp] = await Promise.all([create, backup]);
  assert.deepEqual([created.revision, backedUp.revision], [1, 2]);
  assert.equal(directorySync.disk.revision, 2);
});

test('runWhenReady checks private portable state inside the serialized operation queue', async () => {
  const { envelope } = await encryptedFixture();
  let scheduled = null;
  const { manager } = managerFixture({
    disk: envelope,
    overrides: {
      setTimeoutRef(callback) { scheduled = callback; return 1; },
      clearTimeoutRef() {}
    }
  });
  let operationCalls = 0;
  const operation = async () => {
    operationCalls += 1;
    return 'ran';
  };

  await assert.rejects(
    manager.runWhenReady(operation),
    error => error?.code === 'PORTABLE_CONFIG_NOT_READY'
  );
  assert.equal(operationCalls, 0);

  await manager.unlock(PASSPHRASE);
  assert.equal(await manager.runWhenReady(operation), 'ran');
  assert.equal(operationCalls, 1);

  manager.scheduleBackup({ [SETTINGS_KEY]: { newValue: { changed: true } } });
  assert.equal(typeof scheduled, 'function');
  await assert.rejects(
    manager.runWhenReady(operation),
    error => error?.code === 'PORTABLE_CONFIG_NOT_READY'
  );
  assert.equal(operationCalls, 1);
});

test('dispose waits for the queue and cancels an automatic backup not yet started', async () => {
  let scheduled = null;
  const { envelope } = await encryptedFixture();
  const { manager, storageArea, directorySync } = managerFixture({
    disk: envelope,
    storage: {
      [SETTINGS_KEY]: { local: true },
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
    },
    overrides: {
      setTimeoutRef(callback) { scheduled = callback; return 1; },
      clearTimeoutRef() {}
    }
  });
  await manager.unlock(PASSPHRASE);
  await storageArea.set({ [SETTINGS_KEY]: { userEdit: true } });
  manager.scheduleBackup({ [SETTINGS_KEY]: { newValue: { userEdit: true } } });
  scheduled();
  const closing = manager.dispose();

  assert.equal(typeof closing?.then, 'function');
  await closing;
  assert.equal(directorySync.casWrites.length, 0);
});

test('Promise-only real settings failures abort create and backup before portable CAS', async () => {
  const savedSettings = settingsApi.createDefaultSettings();
  savedSettings.language = 'en';
  savedSettings.profiles.profile_default_openai.config.apiKey = 'sk-local-preserved';
  const realSettingsOverrides = {
    settingsKey: REAL_SETTINGS_KEY,
    normalizeSettings: settingsApi.mergeSettings,
    loadSettings: area => loadSettingsLikeBackground(area)
  };
  const settingsRead = keys => (Array.isArray(keys) ? keys : [keys])
    .includes(REAL_SETTINGS_KEY);
  const { envelope } = await encryptedFixture({ settings: savedSettings });
  const backupFixture = managerFixture({
    disk: envelope,
    storage: {
      [REAL_SETTINGS_KEY]: savedSettings,
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
    },
    overrides: realSettingsOverrides
  });
  await backupFixture.manager.unlock(PASSPHRASE);
  const backupDiskBefore = backupFixture.directorySync.disk;
  backupFixture.storageArea.failGetWhen(settingsRead, new Error('real settings read failed'));

  await assert.rejects(
    () => backupFixture.manager.backupNow(),
    error => error.code === 'PORTABLE_CONFIG_BACKUP_FAILED'
  );
  assert.equal(backupFixture.directorySync.casWrites.length, 0);
  assert.deepEqual(backupFixture.directorySync.disk, backupDiskBefore);

  const createFixture = managerFixture({
    storage: {
      [REAL_SETTINGS_KEY]: savedSettings,
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
    },
    overrides: realSettingsOverrides
  });
  createFixture.storageArea.failGetWhen(settingsRead, new Error('real settings read failed'));

  await assert.rejects(
    () => createFixture.manager.create(PASSPHRASE),
    error => error.code === 'PORTABLE_CONFIG_CREATE_FAILED'
  );
  assert.equal(createFixture.directorySync.casWrites.length, 0);
  assert.equal(createFixture.directorySync.disk, null);
});

test('Promise-only real settings reader preserves language and the complete secret profile', async () => {
  const savedSettings = settingsApi.createDefaultSettings();
  savedSettings.language = 'en';
  savedSettings.profiles.profile_default_openai.config.apiKey = 'sk-local-preserved';
  savedSettings.profiles.profile_default_openai.futureMetadata = {
    nested: [{ preserve: true }]
  };
  const expectedSettings = settingsApi.mergeSettings(savedSettings);
  const { manager, directorySync } = managerFixture({
    storage: {
      [REAL_SETTINGS_KEY]: savedSettings,
      [ABBREVIATION_KEY]: { schemaVersion: 1, entries: [] }
    },
    overrides: {
      settingsKey: REAL_SETTINGS_KEY,
      normalizeSettings: settingsApi.mergeSettings,
      loadSettings: area => loadSettingsLikeBackground(area)
    }
  });

  await manager.create(PASSPHRASE);
  const salt = codec.fromBase64(directorySync.disk.encryption.salt);
  const keyBytes = await codec.derivePortableConfigKey(PASSPHRASE, {
    salt,
    iterations: directorySync.disk.encryption.iterations,
    cryptoRef: webcrypto
  });
  const { payload } = await codec.decryptPortableConfig(directorySync.disk, {
    keyBytes,
    cryptoRef: webcrypto
  });

  assert.equal(payload.settings.language, 'en');
  assert.equal(
    payload.settings.profiles.profile_default_openai.config.apiKey,
    'sk-local-preserved'
  );
  assert.deepEqual(
    payload.settings.profiles.profile_default_openai,
    expectedSettings.profiles.profile_default_openai
  );
});

test('background dependency graph can instantiate the manager with the real exported names', () => {
  const directorySync = createDirectory();
  const storageArea = createStorage({
    sciLlmSettingsV2: settingsApi.createDefaultSettings(),
    [abbreviationApi.GLOBAL_ABBREVIATION_MEMORY_KEY]: { schemaVersion: 1, entries: [] }
  });
  const integrated = globalThis.SciLLM;

  assert.doesNotThrow(() => integrated.createPortableConfigManager({
    directorySync,
    storageArea,
    settingsKey: 'sciLlmSettingsV2',
    abbreviationKey: integrated.GLOBAL_ABBREVIATION_MEMORY_KEY,
    derivePortableConfigKey: integrated.derivePortableConfigKey,
    encryptPortableConfig: integrated.encryptPortableConfig,
    decryptPortableConfig: integrated.decryptPortableConfig,
    validatePortablePayload: integrated.validatePortablePayload,
    validatePortableEnvelope: integrated.validatePortableEnvelope,
    toBase64: integrated.toBase64,
    fromBase64: integrated.fromBase64,
    normalizeSettings: integrated.mergeSettings,
    normalizeAbbreviations: integrated.normalizeGlobalAbbreviationMemory,
    loadSettings: integrated.loadSettings,
    loadGlobalAbbreviations: async area => {
      const key = integrated.GLOBAL_ABBREVIATION_MEMORY_KEY;
      const stored = await area.get(key);
      return integrated.normalizeGlobalAbbreviationMemory(stored?.[key]);
    },
    extensionVersion: '1.0.0',
    cryptoRef: webcrypto,
    iterations: integrated.PORTABLE_CONFIG_KDF_ITERATIONS,
    path: integrated.PORTABLE_CONFIG_PATH,
    payloadKind: integrated.PORTABLE_CONFIG_PAYLOAD_KIND
  }));
});

test('manager portable writes use only direct directory CAS, never queue or global flush', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'core', 'portable-config-manager.js'),
    'utf8'
  );
  assert.match(source, /directorySync\.compareAndSwapJson/u);
  assert.doesNotMatch(source, /directorySync\.(?:enqueueJson|flush)\s*\(/u);
});

test('background loads and creates the manager between codec and directory/router wiring', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  const importBlock = source.slice(source.indexOf('importScripts('), source.indexOf(');') + 2);
  const imports = [...importBlock.matchAll(/'([^']+)'/gu)].map(match => match[1]);
  const abbreviationIndex = imports.indexOf('core/abbreviation-extractor.js');
  const codecIndex = imports.indexOf('core/portable-config.js');
  const managerIndex = imports.indexOf('core/portable-config-manager.js');
  const directoryIndex = imports.indexOf('core/directory-sync.js');
  const routerImportIndex = imports.indexOf('core/background-router.js');
  const createIndex = source.indexOf('SciLLM.createPortableConfigManager({');
  const routerIndex = source.indexOf('SciLLM.createBackgroundRouter({');

  assert.ok(abbreviationIndex >= 0 && abbreviationIndex < managerIndex);
  assert.ok(codecIndex >= 0 && codecIndex < managerIndex);
  assert.ok(managerIndex < directoryIndex && directoryIndex < routerImportIndex);
  assert.ok(createIndex >= 0 && createIndex < routerIndex);
  assert.match(source, /portableConfigManager\.probe\(\)/u);
  const managerWiring = source.slice(createIndex, routerIndex);
  assert.match(source, /const portableSettingsStorage = \{[\s\S]*?return chrome\.storage\.local\.get\(keys\);[\s\S]*?\};/u);
  assert.match(
    managerWiring,
    /loadSettings:\s*\(\)\s*=>\s*SciLLM\.loadSettings\(portableSettingsStorage\)/u
  );
  assert.doesNotMatch(managerWiring, /loadSettings:\s*SciLLM\.loadSettings/u);
});
