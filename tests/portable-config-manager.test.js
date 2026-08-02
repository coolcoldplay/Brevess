const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

globalThis.crypto = webcrypto;

const codec = require('../core/portable-config.js');
const {
  createPortableConfigManager,
  PORTABLE_CONFIG_KEY_CACHE
} = require('../core/portable-config-manager.js');

const PASSPHRASE = 'correct horse battery staple';
const OTHER_PASSPHRASE = 'another suitably long passphrase';
const SETTINGS_KEY = 'settings-key';
const ABBREVIATION_KEY = 'abbreviation-key';
const FIXED_SALT = new Uint8Array(16).fill(7);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createStorage(initial = {}) {
  const data = clone(initial);
  const sets = [];
  return {
    data,
    sets,
    async get(keys) {
      if (keys === null || keys === undefined) return clone(data);
      const selected = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(selected
        .filter(key => Object.prototype.hasOwnProperty.call(data, key))
        .map(key => [key, clone(data[key])]));
    },
    async set(values) {
      sets.push(clone(values));
      Object.assign(data, clone(values));
    }
  };
}

function createDirectory(initialValue = null, options = {}) {
  let disk = clone(initialValue);
  let queued = null;
  const reads = [];
  const enqueues = [];
  let flushCalls = 0;
  return {
    reads,
    enqueues,
    get flushCalls() { return flushCalls; },
    get disk() { return clone(disk); },
    async readJson(path) {
      reads.push(path);
      return { permission: 'granted', found: disk !== null, value: clone(disk) };
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
  assert.equal(directorySync.enqueues.length, 1);
  assert.equal(directorySync.enqueues[0].path, codec.PORTABLE_CONFIG_PATH);
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
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(directorySync.enqueues.length, 1);

  manager.scheduleBackup({ [SETTINGS_KEY]: { newValue: { after: 'dispose' } } });
  manager.dispose();
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(directorySync.enqueues.length, 1);
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
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(directorySync.enqueues.length, 1);
});

for (const [label, directoryOptions, expectedLastError] of [
  ['conflict', { conflict: true }, 'PORTABLE_CONFIG_DIRECTORY_CONFLICT'],
  ['flush failure', { flushError: new Error('disk contained private content') }, 'PORTABLE_CONFIG_BACKUP_FAILED']
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

test('background loads and creates the manager between codec and directory/router wiring', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  const codecIndex = source.indexOf("'core/portable-config.js'");
  const managerIndex = source.indexOf("'core/portable-config-manager.js'");
  const directoryIndex = source.indexOf("'core/directory-sync.js'");
  const createIndex = source.indexOf('SciLLM.createPortableConfigManager({');
  const routerIndex = source.indexOf('SciLLM.createBackgroundRouter({');

  assert.ok(codecIndex >= 0 && codecIndex < managerIndex && managerIndex < directoryIndex);
  assert.ok(createIndex >= 0 && createIndex < routerIndex);
  assert.match(source, /portableConfigManager\.probe\(\)/u);
});
