const test = require('node:test');
const assert = require('node:assert/strict');

const {
  USER_DATA_DATABASE_NAME,
  USER_DATA_DATABASE_VERSION,
  USER_DATA_STORE_NAMES,
  openUserDataDatabase,
  resetUserDataDatabaseConnection
} = require('../core/user-data-database.js');
require('../core/article-workspace.js');
const { createIndexedDbDocumentStore } = require('../core/document-store.js');
const { createIndexedDbDirectoryHandleStore } = require('../core/directory-sync.js');
const {
  createIndexedDbArticleWorkspaceStore
} = require('../core/article-workspace-store.js');

function createFakeIndexedDb({ version = 0, initialStores = {}, blockedOnce = false } = {}) {
  let currentVersion = version;
  let shouldBlock = blockedOnce;
  const stores = new Map(Object.entries(initialStores).map(([name, records]) => [
    name, new Map(records.map(([key, value]) => [key, structuredClone(value)]))
  ]));
  const keyPaths = new Map();
  const openCalls = [];
  let failPutStore = '';

  function request(transaction, operation) {
    const output = {};
    transaction.pending += 1;
    queueMicrotask(() => {
      if (transaction.aborted) return;
      try {
        output.result = operation();
        output.onsuccess?.();
      } catch (error) {
        output.error = error;
        transaction.error = error;
        output.onerror?.();
        transaction.onerror?.();
        transaction.abort();
      } finally {
        transaction.pending -= 1;
        transaction.schedule();
      }
    }, 0);
    return output;
  }

  function transactionFor(storeNames, mode) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const snapshots = new Map(names.map(name => [name, new Map(stores.get(name) || [])]));
    const transaction = {
      mode,
      pending: 0,
      aborted: false,
      error: null,
      completionScheduled: false,
      abort() {
        if (this.aborted) return;
        this.aborted = true;
        for (const [name, snapshot] of snapshots) stores.set(name, snapshot);
        queueMicrotask(() => this.onabort?.());
      },
      schedule() {
        if (this.completionScheduled || this.aborted) return;
        this.completionScheduled = true;
        queueMicrotask(() => {
          this.completionScheduled = false;
          if (!this.aborted && this.pending === 0) this.oncomplete?.();
        }, 0);
      },
      objectStore(name) {
        if (!names.includes(name) || !stores.has(name)) throw new Error(`Missing store ${name}`);
        const records = stores.get(name);
        return {
          get(key) {
            return request(transaction, () => records.has(key)
              ? structuredClone(records.get(key)) : undefined);
          },
          getAll() {
            return request(transaction, () => [...records.values()].map(value => structuredClone(value)));
          },
          put(value) {
            return request(transaction, () => {
              if (failPutStore === name) {
                failPutStore = '';
                throw new Error(`simulated ${name} write failure`);
              }
              const keyPath = keyPaths.get(name) || ({
                documents: 'documentId', meta: 'key', directoryHandles: 'key', syncQueue: 'key',
                workspaces: 'workspaceId', workspaceAssets: 'assetKey', workspaceTurns: 'turnKey',
                workspaceTombstones: 'tombstoneKey'
              })[name];
              const key = value[keyPath];
              if (key === undefined) throw new Error(`Missing key ${keyPath}`);
              records.set(key, structuredClone(value));
              return key;
            });
          },
          delete(key) { return request(transaction, () => records.delete(key)); }
        };
      }
    };
    transaction.schedule();
    return transaction;
  }

  const database = {
    get version() { return currentVersion; },
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore(name, options = {}) {
      if (!stores.has(name)) stores.set(name, new Map());
      keyPaths.set(name, options.keyPath);
      return { createIndex() {} };
    },
    transaction: transactionFor,
    close() { this.closed = true; }
  };
  const indexedDb = {
    open(name, requestedVersion) {
      openCalls.push({ name, version: requestedVersion });
      const output = {};
      queueMicrotask(() => {
        if (shouldBlock) {
          shouldBlock = false;
          output.error = new Error('blocked');
          output.onblocked?.();
          return;
        }
        output.result = database;
        if (requestedVersion > currentVersion) {
          output.oldVersion = currentVersion;
          currentVersion = requestedVersion;
          output.onupgradeneeded?.({ oldVersion: output.oldVersion, newVersion: requestedVersion });
        }
        output.onsuccess?.();
      }, 0);
      return output;
    }
  };
  return {
    indexedDb, stores, openCalls, database,
    failNextPutFor(name) { failPutStore = name; }
  };
}

function workspace(overrides = {}) {
  return {
    schemaVersion: 1,
    workspaceId: `workspace:${'a'.repeat(64)}`,
    canonicalUrl: 'https://example.org/paper',
    aliases: [{ type: 'doi', value: '10.1000/example' }],
    title: 'Example paper',
    directoryName: `Example paper--${'a'.repeat(12)}`,
    revision: '1'.repeat(64),
    contentHash: '1'.repeat(64),
    ...overrides
  };
}

test('v1 and v2 data upgrade to one v3 database in either adapter opening order', async () => {
  for (const first of ['workspace', 'document']) {
    const legacy = { documentId: 'sha256:legacy', title: 'Legacy', annotations: [], revision: 1 };
    const fake = createFakeIndexedDb({
      version: first === 'workspace' ? 1 : 2,
      initialStores: {
        documents: [['sha256:legacy', legacy]],
        meta: [['legacy', { key: 'legacy', value: 'keep' }]],
        ...(first === 'document' ? { directoryHandles: [], syncQueue: [] } : {})
      }
    });
    resetUserDataDatabaseConnection(fake.indexedDb);
    const documents = createIndexedDbDocumentStore(fake.indexedDb);
    const handles = createIndexedDbDirectoryHandleStore(fake.indexedDb);
    const workspaces = createIndexedDbArticleWorkspaceStore(fake.indexedDb);

    if (first === 'workspace') await workspaces.ensureWorkspace(workspace());
    else assert.equal((await documents.getDocument('sha256:legacy')).title, 'Legacy');
    await handles.save({ name: 'folder' });
    if (first === 'document') await workspaces.ensureWorkspace(workspace());

    assert.equal(fake.stores.get('documents').get('sha256:legacy').title, 'Legacy');
    assert.equal(fake.stores.get('meta').get('legacy').value, 'keep');
    assert.deepEqual([...fake.stores.keys()].sort(), [...USER_DATA_STORE_NAMES].sort());
    assert.ok(fake.openCalls.every(call => call.name === USER_DATA_DATABASE_NAME));
    assert.ok(fake.openCalls.every(call => call.version === USER_DATA_DATABASE_VERSION));
    assert.equal(USER_DATA_DATABASE_VERSION, 3);
  }
});

test('blocked database upgrade is recoverable on the next open', async () => {
  const fake = createFakeIndexedDb({ version: 2, blockedOnce: true, initialStores: {
    documents: [], meta: [], directoryHandles: [], syncQueue: []
  } });
  resetUserDataDatabaseConnection(fake.indexedDb);
  await assert.rejects(() => openUserDataDatabase(fake.indexedDb), /INDEXEDDB_UPGRADE_BLOCKED/);
  const database = await openUserDataDatabase(fake.indexedDb);
  assert.equal(database.version, 3);
  assert.equal(fake.openCalls.length, 2);
});

test('workspace assets are atomic and enforce revision and content-hash conflicts', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
  await store.ensureWorkspace(workspace());
  const saved = await store.putAsset(workspace().workspaceId, 'chat/state.json', { ok: true }, {
    contentHash: 'asset-v1'
  });
  assert.equal(saved.revision, 1);
  assert.deepEqual((await store.getAsset(workspace().workspaceId, 'chat/state.json')).content, { ok: true });

  await assert.rejects(() => store.putAsset(workspace().workspaceId, 'chat/state.json', { ok: false }, {
    expectedRevision: 0
  }), /ASSET_REVISION_CONFLICT/);
  await assert.rejects(() => store.putAsset(workspace().workspaceId, 'chat/state.json', { ok: false }, {
    expectedContentHash: 'wrong'
  }), /ASSET_HASH_CONFLICT/);
  assert.deepEqual((await store.getAsset(workspace().workspaceId, 'chat/state.json')).content, { ok: true });

  const ownerBeforeFailure = await store.getWorkspace(workspace().workspaceId);
  fake.failNextPutFor('workspaces');
  await assert.rejects(() => store.putAsset(workspace().workspaceId, 'chat/atomic.json',
    { shouldNotPersist: true }), /simulated workspaces write failure/);
  assert.equal(await store.getAsset(workspace().workspaceId, 'chat/atomic.json'), null);
  assert.equal((await store.getWorkspace(workspace().workspaceId)).storageRevision,
    ownerBeforeFailure.storageRevision);
});

test('turns page per workspace, tombstone deletions, and never delete by count', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
  const first = workspace();
  const second = workspace({ workspaceId: `workspace:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.org/other', directoryName: `Other--${'b'.repeat(12)}` });
  await store.ensureWorkspace(first);
  await store.ensureWorkspace(second);

  for (let index = 0; index < 5000; index += 1) {
    await store.appendTurn(first.workspaceId, {
      turnId: `turn-${index}`, role: index % 2 ? 'assistant' : 'user', content: `Message ${index}`
    });
  }
  await store.appendTurn(second.workspaceId, { turnId: 'other-1', role: 'user', content: 'Other' });

  const page = await store.pageTurns(first.workspaceId, { limit: 3, afterSequence: 4997 });
  assert.deepEqual(page.items.map(item => item.turnId), ['turn-4997', 'turn-4998', 'turn-4999']);
  assert.equal(page.hasMore, false);
  assert.equal((await store.pageTurns(first.workspaceId, { limit: 6000 })).items.length, 5000);
  assert.equal((await store.pageTurns(second.workspaceId, { limit: 10 })).items.length, 1);

  await store.deleteTurn(first.workspaceId, 'turn-2500');
  assert.equal((await store.pageTurns(first.workspaceId, { limit: 6000 })).items.length, 4999);
  const tombstones = [...fake.stores.get('workspaceTombstones').values()];
  assert.ok(tombstones.some(item => item.entityType === 'turn' && item.entityId === 'turn-2500'));
});

test('workspace updates enforce content revisions and deletion uses a durable tombstone', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
  const first = await store.ensureWorkspace(workspace());
  await assert.rejects(() => store.ensureWorkspace(workspace({
    title: 'Conflicting write', revision: '2'.repeat(64), contentHash: '2'.repeat(64)
  }), { expectedRevision: 'wrong' }), /WORKSPACE_REVISION_CONFLICT/);
  const updated = await store.ensureWorkspace(workspace({
    revision: '2'.repeat(64), contentHash: '2'.repeat(64)
  }), { expectedRevision: first.revision });
  assert.equal(updated.revision, '2'.repeat(64));

  await store.markMemoryRebuild(first.workspaceId, true);
  assert.equal((await store.getWorkspace(first.workspaceId)).memoryNeedsRebuild, true);
  const tombstone = await store.beginWorkspaceDeletion(first.workspaceId);
  assert.equal(tombstone.entityType, 'workspace');
  assert.deepEqual(await store.beginWorkspaceDeletion(first.workspaceId), tombstone);
  await store.finalizeWorkspaceDeletion(first.workspaceId, tombstone.tombstoneId);
  assert.equal(await store.getWorkspace(first.workspaceId), null);
  await assert.rejects(() => store.ensureWorkspace(workspace()), /WORKSPACE_GENERATION_CONFLICT/);
  const statistics = await store.getStorageStatistics();
  assert.equal(statistics.workspaceCount, 0);
});
