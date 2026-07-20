const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/user-data-database.js');
const {
  USER_DATA_DATABASE_NAME,
  USER_DATA_DATABASE_VERSION,
  DIRECTORY_HANDLE_STORE_NAME,
  SYNC_QUEUE_STORE_NAME,
  createMemoryDirectoryHandleStore,
  createMemorySyncQueue,
  createIndexedDbDirectoryHandleStore,
  createIndexedDbSyncQueue,
  createDirectorySync
} = require('../core/directory-sync.js');
const { createIndexedDbDocumentStore } = require('../core/document-store.js');

function createFakeHandleStore(initialPermission = 'granted') {
  let permission = initialPermission;
  let failWrites = 0;
  let pausePath = '';
  let releasePausedWrite;
  let pausedWriteEntered;
  const pausedEntered = new Promise(resolve => { pausedWriteEntered = resolve; });
  const files = new Map();
  const writes = [];
  const reads = [];

  function fileHandle(path) {
    return {
      name: path.split('/').at(-1),
      async getFile() {
        reads.push(path);
        if (!files.has(path)) {
          const error = new Error(`Missing file ${path}`);
          error.name = 'NotFoundError';
          throw error;
        }
        return { async text() { return files.get(path); } };
      },
      async createWritable() {
        let next = '';
        return {
          async write(value) { next = String(value); },
          async close() {
            if (failWrites > 0) {
              failWrites -= 1;
              throw new Error(`simulated write failure ${'x'.repeat(400)}`);
            }
            if (path === pausePath) {
              pausedWriteEntered();
              await new Promise(resolve => { releasePausedWrite = resolve; });
              pausePath = '';
            }
            files.set(path, next);
            writes.push(path);
          }
        };
      }
    };
  }

  function directoryHandle(prefix, name) {
    return {
      name,
      async queryPermission(options) {
        assert.deepEqual(options, { mode: 'readwrite' });
        return permission;
      },
      async getDirectoryHandle(child) {
        return directoryHandle(`${prefix}${child}/`, child);
      },
      async getFileHandle(child) {
        return fileHandle(`${prefix}${child}`);
      }
    };
  }

  const root = directoryHandle('', 'chosen-folder');
  return {
    root,
    async load() { return root; },
    async save() {},
    setPermission(value) { permission = value; },
    failNextWrites(count = 1) { failWrites = count; },
    pauseNextWrite(path) { pausePath = path; },
    async waitForPausedWrite() { await pausedEntered; },
    releasePausedWrite() { releasePausedWrite?.(); },
    readText(path) { return files.get(path) || ''; },
    has(path) { return files.has(path); },
    writeText(path, value) { files.set(path, String(value)); },
    writes,
    reads
  };
}

function json(revision, extra = {}) {
  return { schemaVersion: 1, revision, ...extra };
}

test('reads exactly one requested JSON asset without enumerating or loading the index', async () => {
  const handles = createFakeHandleStore();
  handles.writeText(
    'SCI-Highlighter/articles/a1b2c3d4.json',
    JSON.stringify(json(3, { kind: 'sci-logic-highlighter-article', documentId: 'doc-1' }))
  );
  const sync = createDirectorySync({
    handleStore: handles,
    queueStore: createMemorySyncQueue()
  });

  const found = await sync.readJson('articles/a1b2c3d4.json');
  assert.equal(found.permission, 'granted');
  assert.equal(found.found, true);
  assert.equal(found.value.documentId, 'doc-1');
  assert.deepEqual(handles.reads, ['SCI-Highlighter/articles/a1b2c3d4.json']);

  handles.reads.length = 0;
  const missing = await sync.readJson('articles/ffffffff.json');
  assert.equal(missing.found, false);
  assert.deepEqual(handles.reads, ['SCI-Highlighter/articles/ffffffff.json']);
});

test('rejects absolute and traversal paths before queueing', async () => {
  const queue = createMemorySyncQueue();
  const sync = createDirectorySync({
    handleStore: createFakeHandleStore(), queueStore: queue
  });

  for (const path of ['../escape.json', 'annotations/../../escape.json',
    '/absolute.json', 'C:\\absolute.json', 'https://example.test/data.json',
    'backups/forbidden.json', 'conflicts/forbidden.json', 'index.json']) {
    await assert.rejects(() => sync.enqueueJson(path, json(1)), /INVALID_RELATIVE_PATH/);
  }
  await assert.rejects(
    () => sync.enqueueJson('categories.json', { schemaVersion: 1, revision: -1 }),
    /INVALID_REVISION/
  );
  assert.equal((await queue.getAll()).length, 0);
});

test('coalesces the latest path while permission is prompt or denied, then flushes', async () => {
  const handles = createFakeHandleStore('prompt');
  const queue = createMemorySyncQueue();
  const sync = createDirectorySync({ handleStore: handles, queueStore: queue });
  await sync.enqueueJson('categories.json', json(1, { value: 'old' }));
  await sync.enqueueJson('categories.json', json(2, { value: 'latest' }));

  assert.equal((await sync.status()).pendingCount, 1);
  assert.equal((await sync.flush()).permission, 'prompt');
  handles.setPermission('denied');
  assert.equal((await sync.flush()).permission, 'denied');
  assert.equal((await sync.status()).pendingCount, 1);

  handles.setPermission('granted');
  const result = await sync.flush();
  assert.equal(result.written, 1);
  assert.equal((await sync.status()).pendingCount, 0);
  assert.equal(JSON.parse(handles.readText('SCI-Highlighter/categories.json')).value, 'latest');
});

test('backs up valid JSON deterministically before replacement', async () => {
  const handles = createFakeHandleStore();
  const sync = createDirectorySync({
    handleStore: handles, queueStore: createMemorySyncQueue()
  });
  await sync.enqueueJson('annotations/doc-1.json', json(1, { documentId: 'doc-1' }));
  await sync.flush();
  await sync.enqueueJson('annotations/doc-1.json', json(2, { documentId: 'doc-1' }));
  await sync.flush();

  assert.equal(
    JSON.parse(handles.readText(
      'SCI-Highlighter/backups/annotations/doc-1.previous.json'
    )).revision,
    1
  );
});

test('preserves divergent equal revisions as a conflict without replacing primary', async () => {
  const handles = createFakeHandleStore();
  handles.writeText('SCI-Highlighter/categories.json', JSON.stringify(
    json(3, { sourceId: 'folder', value: 'folder' })
  ));
  const sync = createDirectorySync({
    handleStore: handles,
    queueStore: createMemorySyncQueue(),
    sourceId: 'extension'
  });
  await sync.enqueueJson('categories.json', json(3, {
    sourceId: 'extension', value: 'extension'
  }));

  const result = await sync.flush();
  const status = await sync.status();
  assert.equal(result.conflicts, 1);
  assert.equal(status.pendingCount, 0);
  assert.equal(status.conflictCount, 1);
  assert.ok(status.lastConflict.path.length <= 240);
  assert.equal(JSON.parse(handles.readText('SCI-Highlighter/categories.json')).value, 'folder');
  assert.equal(handles.has('SCI-Highlighter/conflicts/categories.r3.extension.json'), true);
  const indexed = JSON.parse(handles.readText('SCI-Highlighter/index.json'));
  assert.equal(indexed.assets[0].sourceId, 'folder');
});

test('uses the per-flush importer when the directory revision is newer', async () => {
  const handles = createFakeHandleStore();
  handles.writeText('SCI-Highlighter/categories.json', JSON.stringify(
    json(4, { sourceId: 'folder', value: 'folder-newer' })
  ));
  const queue = createMemorySyncQueue();
  const sync = createDirectorySync({
    handleStore: handles,
    queueStore: queue,
    assetImporter: async () => { throw new Error('constructor importer must be replaceable'); }
  });
  await sync.enqueueJson('categories.json', json(2, { value: 'local-older' }));
  const imported = [];

  const result = await sync.flush(async (path, value) => {
    imported.push([path, value.value]);
    return { imported: true };
  });

  assert.equal(result.imported, 1);
  assert.deepEqual(imported, [['categories.json', 'folder-newer']]);
  assert.equal((await sync.status()).pendingCount, 0);
});

test('keeps a newer enqueue made during flush pending for the next flush', async () => {
  const handles = createFakeHandleStore();
  const queue = createMemorySyncQueue();
  const sync = createDirectorySync({ handleStore: handles, queueStore: queue });
  await sync.enqueueJson('categories.json', json(1, { value: 'first' }));
  handles.pauseNextWrite('SCI-Highlighter/categories.json');
  const flushing = sync.flush();
  await handles.waitForPausedWrite();
  await sync.enqueueJson('categories.json', json(2, { value: 'second' }));
  const requestedWhileActive = sync.flush();
  handles.releasePausedWrite();
  await Promise.all([flushing, requestedWhileActive]);

  for (let attempt = 0; attempt < 20 && (await sync.status()).pendingCount; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.equal(JSON.parse(handles.readText('SCI-Highlighter/categories.json')).value, 'second');
  assert.equal((await sync.status()).pendingCount, 0);
});

test('serializes concurrent flushes and recovers after a failed write', async () => {
  const handles = createFakeHandleStore();
  const queue = createMemorySyncQueue();
  const sync = createDirectorySync({ handleStore: handles, queueStore: queue });
  await sync.enqueueJson('categories.json', json(1));
  handles.failNextWrites(1);
  const [first, joined] = await Promise.all([sync.flush(), sync.flush()]);

  assert.equal(first.failed, 1);
  assert.deepEqual(joined, first, 'concurrent callers should join the active flush');
  assert.equal((await sync.status()).pendingCount, 1);
  assert.ok((await sync.status()).lastError.length <= 240);
  const recovered = await sync.flush();
  assert.equal(recovered.written, 1);
  assert.equal((await sync.status()).pendingCount, 0);
});

test('does not overwrite a malformed existing index during flush', async () => {
  const handles = createFakeHandleStore();
  const queue = createMemorySyncQueue();
  handles.writeText('SCI-Highlighter/index.json', '{malformed');
  const sync = createDirectorySync({ handleStore: handles, queueStore: queue });
  await sync.enqueueJson('categories.json', json(1, { categoryOverrides: {} }));

  const result = await sync.flush();

  assert.equal(result.failed, 1);
  assert.equal((await sync.status()).pendingCount, 1);
  assert.match((await sync.status()).lastError, /INVALID_INDEX/);
  assert.equal(handles.readText('SCI-Highlighter/index.json'), '{malformed');
  assert.equal(handles.has('SCI-Highlighter/categories.json'), false);
});

test('rebuild imports only valid indexed assets and skips traversal and malformed entries', async () => {
  const handles = createFakeHandleStore();
  handles.writeText('SCI-Highlighter/index.json', JSON.stringify({
    schemaVersion: 1,
    assets: [
      { path: 'annotations/doc-1.json', revision: 4, type: 'json' },
      { path: '../outside.json', revision: 8, type: 'json' },
      { path: 'annotations/broken.json', revision: 2, type: 'json' },
      { path: 'unlisted.json', revision: 1, type: 'json' }
    ]
  }));
  handles.writeText('SCI-Highlighter/annotations/doc-1.json', JSON.stringify(
    json(4, { documentId: 'doc-1', annotations: [] })
  ));
  handles.writeText('SCI-Highlighter/annotations/broken.json', '{broken');
  handles.writeText('SCI-Highlighter/unlisted.json', JSON.stringify(json(1)));
  handles.writeText('SCI-Highlighter/not-in-index.json', JSON.stringify(json(99)));
  const imported = [];
  const sync = createDirectorySync({
    handleStore: handles,
    queueStore: createMemorySyncQueue(),
    assetImporter: async (path, value) => {
      imported.push([path, value]);
      return { imported: true };
    }
  });

  const result = await sync.rebuildIndex();
  assert.deepEqual(imported.map(item => item[0]), ['annotations/doc-1.json']);
  assert.equal(result.imported, 1);
  assert.ok(result.invalidAssets >= 2);
});

test('rebuild restores a validated backup without replacing a corrupt primary', async () => {
  const handles = createFakeHandleStore();
  handles.writeText('SCI-Highlighter/index.json', JSON.stringify({
    schemaVersion: 1,
    assets: [{ path: 'categories.json', revision: 2, type: 'json' }]
  }));
  handles.writeText('SCI-Highlighter/categories.json', '{broken');
  handles.writeText('SCI-Highlighter/backups/categories.previous.json', JSON.stringify(
    json(1, { categoryOverrides: {} })
  ));
  const imported = [];
  const sync = createDirectorySync({
    handleStore: handles,
    queueStore: createMemorySyncQueue(),
    assetImporter: async (path, value) => {
      imported.push([path, value]);
      return { imported: true };
    }
  });

  const result = await sync.rebuildIndex();
  assert.equal(result.restoredBackups, 1);
  assert.equal(imported[0][1].revision, 1);
  assert.equal(handles.readText('SCI-Highlighter/categories.json'), '{broken');
});

test('rebuild rejects malformed index and stale assets reported by the importer', async () => {
  const handles = createFakeHandleStore();
  const sync = createDirectorySync({
    handleStore: handles,
    queueStore: createMemorySyncQueue()
  });
  handles.writeText('SCI-Highlighter/index.json', '{broken');
  await assert.rejects(() => sync.rebuildIndex(), /INVALID_INDEX/);

  handles.writeText('SCI-Highlighter/index.json', JSON.stringify({
    schemaVersion: 1, revision: -1, assets: []
  }));
  await assert.rejects(() => sync.rebuildIndex(), /INVALID_INDEX/);

  handles.writeText('SCI-Highlighter/index.json', JSON.stringify({
    schemaVersion: 1,
    assets: [{ path: 'categories.json', revision: 2, type: 'json' }]
  }));
  handles.writeText('SCI-Highlighter/categories.json', JSON.stringify(
    json(2, { categoryOverrides: {} })
  ));
  const staleSync = createDirectorySync({
    handleStore: handles,
    queueStore: createMemorySyncQueue(),
    assetImporter: async () => ({ imported: false, reason: 'stale' })
  });
  const result = await staleSync.rebuildIndex();
  assert.equal(result.imported, 0);
  assert.equal(result.stale, 1);
});

test('export bundle strips credentials, provider headers, cache, handles, and queues', async () => {
  const sync = createDirectorySync({
    handleStore: createFakeHandleStore(),
    queueStore: createMemorySyncQueue(),
    bundleExporter: async () => ({
      schemaVersion: 1,
      categories: { revision: 2, categoryOverrides: {} },
      documents: { schemaVersion: 1, documents: [] },
      feedbackCorpus: '{"quote":"safe"}',
      providers: { openai: { apiKey: 'secret', headers: { Authorization: 'Bearer secret' } } },
      analysisCache: [{ secret: true }],
      directoryHandle: { name: 'private' },
      syncQueue: [{ path: 'private' }]
    })
  });

  const bundle = await sync.exportBundle();
  const serialized = JSON.stringify(bundle);
  assert.equal(bundle.schemaVersion, 1);
  assert.match(serialized, /safe/);
  assert.doesNotMatch(serialized, /secret|providers|analysisCache|directoryHandle|syncQueue/i);
});

test('accepts per-call importer and bundle snapshots for serialized router operations', async () => {
  const handles = createFakeHandleStore();
  handles.writeText('SCI-Highlighter/index.json', JSON.stringify({
    schemaVersion: 1,
    assets: [{ path: 'categories.json', revision: 3, type: 'json' }]
  }));
  handles.writeText('SCI-Highlighter/categories.json', JSON.stringify(
    json(3, { categoryOverrides: {} })
  ));
  const imported = [];
  const sync = createDirectorySync({
    handleStore: handles,
    queueStore: createMemorySyncQueue(),
    assetImporter: async () => { throw new Error('constructor importer must be replaceable'); },
    bundleExporter: async () => ({ marker: 'stale-constructor-snapshot' })
  });

  const rebuilt = await sync.rebuildIndex(async (path, value) => {
    imported.push([path, value.revision]);
    return { imported: true };
  });
  const bundle = await sync.exportBundle({
    marker: 'fresh-router-snapshot',
    providers: { openai: { apiKey: 'secret' } }
  });

  assert.equal(rebuilt.imported, 1);
  assert.deepEqual(imported, [['categories.json', 3]]);
  assert.equal(bundle.marker, 'fresh-router-snapshot');
  assert.doesNotMatch(JSON.stringify(bundle), /secret|providers/i);
});

test('export sanitization rejects credential, provider-header, cache, and handle key variants', async () => {
  const sync = createDirectorySync({
    handleStore: createFakeHandleStore(),
    queueStore: createMemorySyncQueue()
  });
  const bundle = await sync.exportBundle({
    schemaVersion: 1,
    safe: { quote: 'keep me' },
    api_key: 'secret-1',
    credentials: { token: 'secret-2' },
    providerConfigs: { customHeaders: { Authorization: 'secret-3' } },
    resultCache: [{ hidden: true }],
    selectedHandle: { name: 'private-folder' }
  });
  const serialized = JSON.stringify(bundle);

  assert.match(serialized, /keep me/);
  assert.doesNotMatch(
    serialized,
    /secret|credentials|providerConfigs|customHeaders|resultCache|selectedHandle|private-folder/i
  );
});

function createFakeIndexedDb(initialStores = {}) {
  const stores = new Map(
    Object.entries(initialStores).map(([name, records]) => [name, new Map(records)])
  );
  const openCalls = [];
  const database = {
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore(name) {
      stores.set(name, new Map());
      return { createIndex() {} };
    },
    transaction(storeName) {
      const records = stores.get(storeName);
      if (!records) throw new Error(`Missing store ${storeName}`);
      const transaction = {
        pending: 0,
        objectStore() {
          const request = operation => {
            const output = {};
            transaction.pending += 1;
            setTimeout(() => {
              try {
                output.result = operation();
                output.onsuccess?.();
              } catch (error) {
                output.error = error;
                transaction.error = error;
                output.onerror?.();
                transaction.onerror?.();
                transaction.onabort?.();
              } finally {
                transaction.pending -= 1;
                if (!transaction.pending) setTimeout(() => transaction.oncomplete?.(), 0);
              }
            }, 0);
            return output;
          };
          return {
            get(key) { return request(() => records.get(key)); },
            getAll() { return request(() => [...records.values()]); },
            put(value) {
              return request(() => {
                const key = value.key || value.relativePath || value.documentId;
                records.set(key, value);
                return key;
              });
            },
            delete(key) { return request(() => records.delete(key)); }
          };
        }
      };
      return transaction;
    }
  };
  const indexedDb = {
    open(name, version) {
      openCalls.push({ name, version });
      const request = {};
      setTimeout(() => {
        request.result = database;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    }
  };
  return { indexedDb, stores, openCalls };
}

test('IndexedDB handle and coalescing queue adapters survive service-worker recreation', async () => {
  const fake = createFakeIndexedDb();
  const firstHandles = createIndexedDbDirectoryHandleStore(fake.indexedDb);
  const firstQueue = createIndexedDbSyncQueue(fake.indexedDb);
  const handle = { name: 'persisted-folder' };
  await firstHandles.save(handle);
  await firstQueue.put({ relativePath: 'categories.json', type: 'json', content: '{}', revision: 1 });
  await firstQueue.put({ relativePath: 'categories.json', type: 'json', content: '{"latest":true}', revision: 2 });

  const restartedHandles = createIndexedDbDirectoryHandleStore(fake.indexedDb);
  const restartedQueue = createIndexedDbSyncQueue(fake.indexedDb);
  assert.equal((await restartedHandles.load()).name, 'persisted-folder');
  const pending = await restartedQueue.getAll();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].revision, 2);
  assert.equal(USER_DATA_DATABASE_NAME, 'sci-logic-highlighter-user-data');
  assert.equal(USER_DATA_DATABASE_VERSION, 3);
  assert.equal(DIRECTORY_HANDLE_STORE_NAME, 'directoryHandles');
  assert.equal(SYNC_QUEUE_STORE_NAME, 'syncQueue');
  assert.ok(fake.openCalls.every(call => call.version === 3));
  ['documents', 'meta', 'directoryHandles', 'syncQueue', 'workspaces',
    'workspaceAssets', 'workspaceTurns', 'workspaceTombstones']
    .forEach(name => assert.equal(fake.stores.has(name), true));
});

test('v1 document data survives the v3 upgrade in both adapter opening orders', async () => {
  const legacyRecord = {
    schemaVersion: 1,
    documentId: 'sha256:legacy',
    title: 'Legacy document',
    canonicalUrl: '',
    studyType: null,
    annotations: [],
    revision: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    documentHash: 'legacy',
    documentHashes: ['legacy']
  };
  for (const first of ['documents', 'directory']) {
    const fake = createFakeIndexedDb({
      documents: [['sha256:legacy', legacyRecord]],
      meta: [['legacy-meta', { key: 'legacy-meta', value: 'preserve-me' }]]
    });
    const documents = createIndexedDbDocumentStore(fake.indexedDb);
    const handles = createIndexedDbDirectoryHandleStore(fake.indexedDb);
    const queue = createIndexedDbSyncQueue(fake.indexedDb);

    if (first === 'documents') {
      assert.equal((await documents.getDocument('sha256:legacy')).title, 'Legacy document');
      await handles.save({ name: 'chosen-folder' });
    } else {
      await handles.save({ name: 'chosen-folder' });
      assert.equal((await documents.getDocument('sha256:legacy')).title, 'Legacy document');
    }
    await queue.put({
      relativePath: 'categories.json', type: 'json', content: '{}', revision: 1
    });

    assert.equal(fake.stores.get('documents').get('sha256:legacy').title, 'Legacy document');
    assert.equal(fake.stores.get('meta').get('legacy-meta').value, 'preserve-me');
    assert.ok(fake.openCalls.every(call => call.version === 3));
    ['documents', 'meta', 'directoryHandles', 'syncQueue', 'workspaces',
      'workspaceAssets', 'workspaceTurns', 'workspaceTombstones']
      .forEach(name => assert.equal(fake.stores.has(name), true));
  }
});
