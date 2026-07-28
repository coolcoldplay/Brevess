const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/user-data-database.js');
const {
  createWorkspaceManifest,
  createWorkspaceIndex,
  validateWorkspaceIndex
} = require('../core/article-workspace.js');
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
  let requestedPermission = 'granted';
  let permissionRequests = 0;
  let failWrites = 0;
  let failWriteName = '';
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
              const error = new Error(`simulated write failure ${'x'.repeat(400)}`);
              if (failWriteName) error.name = failWriteName;
              throw error;
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
      kind: 'directory',
      async queryPermission(options) {
        assert.deepEqual(options, { mode: 'readwrite' });
        return permission;
      },
      async requestPermission(options) {
        assert.deepEqual(options, { mode: 'readwrite' });
        permissionRequests += 1;
        permission = requestedPermission;
        return permission;
      },
      async getDirectoryHandle(child) {
        return directoryHandle(`${prefix}${child}/`, child);
      },
      async getFileHandle(child) {
        return fileHandle(`${prefix}${child}`);
      },
      async *entries() {
        const children = new Map();
        for (const path of files.keys()) {
          if (!path.startsWith(prefix)) continue;
          const remainder = path.slice(prefix.length);
          if (!remainder) continue;
          const [child, ...rest] = remainder.split('/');
          children.set(child, rest.length
            ? directoryHandle(`${prefix}${child}/`, child)
            : { ...fileHandle(`${prefix}${child}`), kind: 'file' });
        }
        yield* children.entries();
      },
      async removeEntry(child, options = {}) {
        const target = `${prefix}${child}`;
        const nestedPrefix = `${target}/`;
        const nested = [...files.keys()].filter(path => path.startsWith(nestedPrefix));
        if (nested.length && options.recursive !== true) throw new Error('Directory is not empty');
        nested.forEach(path => files.delete(path));
        files.delete(target);
      }
    };
  }

  const root = directoryHandle('', 'chosen-folder');
  return {
    root,
    async load() { return root; },
    async save() {},
    setPermission(value) { permission = value; },
    setRequestedPermission(value) { requestedPermission = value; },
    get permissionRequests() { return permissionRequests; },
    failNextWrites(count = 1) { failWrites = count; },
    failNextWritesAs(name, count = 1) {
      failWriteName = String(name || '');
      failWrites = count;
    },
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

test('requests a stored directory permission only from an explicit caller', async () => {
  const handles = createFakeHandleStore('prompt');
  const sync = createDirectorySync({
    handleStore: handles,
    queueStore: createMemorySyncQueue()
  });

  assert.equal((await sync.status()).permission, 'prompt');
  assert.equal(handles.permissionRequests, 0);
  assert.deepEqual(await sync.requestDirectoryPermission(), {
    permission: 'granted', granted: true
  });
  assert.equal(handles.permissionRequests, 1);
});

test('workspace manifest overview reports health without exposing filesystem paths', async () => {
  const handles = createFakeHandleStore();
  const sync = createDirectorySync({
    handleStore: handles,
    queueStore: createMemorySyncQueue()
  });
  const workspace = workspaceFixture();
  await sync.enqueueWorkspaceAsset(workspace, 'ui/state.json', { view: 'chat' }, {
    revision: 2, workspaceGeneration: 1
  });
  await sync.flush();
  const overview = await sync.listWorkspaceManifests({});
  assert.equal(overview.permission, 'granted');
  assert.equal(overview.manifests.length, 1);
  assert.equal(overview.invalidManifests, 0);
  assert.doesNotMatch(JSON.stringify(overview), /chosen-folder|[A-Z]:\\|\/Users\//i);
});

function workspaceFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    workspaceId: `workspace:${'a'.repeat(64)}`,
    canonicalUrl: 'https://example.org/paper',
    aliases: [{ type: 'doi', value: '10.1000/example' }],
    title: 'Example paper',
    directoryName: `Example paper--${'a'.repeat(16)}`,
    revision: '1'.repeat(64),
    contentHash: '1'.repeat(64),
    storageRevision: 1,
    workspaceGeneration: 1,
    ...overrides
  };
}

function json(revision, extra = {}) {
  return { schemaVersion: 1, revision, ...extra };
}

test('serializes concurrent workspace assets so the manifest retains every chat file', async () => {
  const handles = createFakeHandleStore();
  const sync = createDirectorySync({
    handleStore: handles,
    queueStore: createMemorySyncQueue()
  });
  const workspace = workspaceFixture();
  await Promise.all([
    sync.enqueueWorkspaceAsset(workspace, 'chat/index.json', { turns: [] }, {
      revision: 1, workspaceGeneration: 1
    }),
    sync.enqueueWorkspaceAsset(workspace, 'chat/turns/turn-1.json', {
      turnId: 'turn-1', question: 'First'
    }, { revision: 1, workspaceGeneration: 1 }),
    sync.enqueueWorkspaceAsset(workspace, 'chat/turns/turn-2.json', {
      turnId: 'turn-2', question: 'Second'
    }, { revision: 1, workspaceGeneration: 1 })
  ]);
  await sync.flush();
  const manifest = JSON.parse(handles.readText(
    `SCI-Highlighter/workspaces/${workspace.directoryName}/manifest.json`
  ));
  assert.deepEqual(manifest.assets.map(asset => asset.path).sort(), [
    'chat/index.json',
    'chat/turns/turn-1.json',
    'chat/turns/turn-2.json'
  ]);
});

test('discovers valid chat turn files omitted by an older workspace manifest', async () => {
  const handles = createFakeHandleStore();
  const sync = createDirectorySync({
    handleStore: handles,
    queueStore: createMemorySyncQueue()
  });
  const workspace = workspaceFixture();
  await sync.enqueueWorkspaceAsset(workspace, 'chat/index.json', { turns: [] }, {
    revision: 1, workspaceGeneration: 1
  });
  await sync.flush();
  const manifest = JSON.parse(handles.readText(
    `SCI-Highlighter/workspaces/${workspace.directoryName}/manifest.json`
  ));
  const relativePath = 'chat/turns/turn-orphan.json';
  handles.writeText(
    `SCI-Highlighter/workspaces/${workspace.directoryName}/${relativePath}`,
    JSON.stringify({
      schemaVersion: 1,
      kind: 'sci-logic-highlighter-workspace-asset',
      revision: 3,
      updatedAt: '2026-07-23T00:00:00.000Z',
      contentHash: 'orphan-hash',
      sourceId: 'extension',
      workspaceId: workspace.workspaceId,
      workspaceGeneration: 1,
      relativePath,
      data: { turnId: 'turn-orphan', question: 'Recovered question', sequence: 1 }
    })
  );

  const discovered = await sync.listWorkspaceChatAssets(manifest);
  assert.equal(discovered.invalidAssets, 0);
  assert.deepEqual(discovered.assets.map(asset => asset.relativePath), [
    'chat/index.json', relativePath
  ]);
  assert.equal(discovered.assets[1].content.turnId, 'turn-orphan');
});

test('recovers only post-manifest chat writes from an older workspace generation', async () => {
  const handles = createFakeHandleStore();
  const sync = createDirectorySync({
    handleStore: handles,
    queueStore: createMemorySyncQueue()
  });
  const workspace = workspaceFixture({ workspaceGeneration: 2 });
  const manifest = createWorkspaceManifest({
    ...workspace,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T01:00:00.000Z'
  }, []);
  const root = `SCI-Highlighter/workspaces/${workspace.directoryName}`;
  const writeTurn = (turnId, updatedAt) => {
    const relativePath = `chat/turns/${turnId}.json`;
    handles.writeText(`${root}/${relativePath}`, JSON.stringify({
      schemaVersion: 1,
      kind: 'sci-logic-highlighter-workspace-asset',
      revision: 7,
      updatedAt,
      contentHash: `${turnId}-hash`,
      sourceId: 'extension',
      workspaceId: workspace.workspaceId,
      workspaceGeneration: 1,
      relativePath,
      data: {
        turnId,
        question: `${turnId} question`,
        sequence: turnId === 'turn-live' ? 2 : 1,
        updatedAt
      }
    }));
  };
  writeTurn('turn-stale', '2026-07-24T00:30:00.000Z');
  writeTurn('turn-live', '2026-07-24T02:00:00.000Z');

  const discovered = await sync.listWorkspaceChatAssets(manifest);

  assert.equal(discovered.invalidAssets, 1);
  assert.equal(discovered.recoveredGenerationMismatches, 1);
  assert.deepEqual(discovered.assets.map(asset => asset.content.turnId), ['turn-live']);
  assert.equal(discovered.assets[0].sourceWorkspaceGeneration, 1);
  assert.equal(discovered.assets[0].recoveredGenerationMismatch, true);
});

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

test('retries transient OneDrive-style write locks before reporting a failure', async () => {
  const handles = createFakeHandleStore();
  const sync = createDirectorySync({
    handleStore: handles,
    queueStore: createMemorySyncQueue()
  });
  await sync.enqueueJson('categories.json', json(1));
  handles.failNextWritesAs('OperationError', 2);

  const result = await sync.flush();

  assert.equal(result.failed, 0);
  assert.equal(result.written, 1);
  assert.equal((await sync.status()).pendingCount, 0);
});

test('reports permission failures as reauthorization without dropping queued writes', async () => {
  const handles = createFakeHandleStore();
  const sync = createDirectorySync({
    handleStore: handles,
    queueStore: createMemorySyncQueue()
  });
  await sync.enqueueJson('categories.json', json(1));
  handles.failNextWritesAs('NotAllowedError', 1);

  const result = await sync.flush();
  const status = await sync.status();

  assert.equal(result.failed, 1);
  assert.equal(result.requiresReauthorization, true);
  assert.equal(result.errorName, 'NotAllowedError');
  assert.equal(result.pendingCount, 1);
  assert.equal(status.requiresReauthorization, true);
  assert.equal(status.lastErrorName, 'NotAllowedError');
});

test('a post-restore workspace save advances beyond a newer disk envelope revision', async () => {
  const handles = createFakeHandleStore();
  const queue = createMemorySyncQueue();
  const sync = createDirectorySync({ handleStore: handles, queueStore: queue });
  const workspace = workspaceFixture({ workspaceGeneration: 2 });
  const relativePath = 'chat/index.json';
  const root = `SCI-Highlighter/workspaces/${workspace.directoryName}`;
  handles.writeText(`${root}/${relativePath}`, JSON.stringify({
    schemaVersion: 1,
    kind: 'sci-logic-highlighter-workspace-asset',
    revision: 5000,
    updatedAt: '2026-07-24T02:00:00.000Z',
    contentHash: 'old-hash',
    sourceId: 'extension',
    workspaceId: workspace.workspaceId,
    workspaceGeneration: 2,
    relativePath,
    data: { turns: [{ turnId: 'old-turn' }], totalTurns: 1 }
  }));

  const queued = await sync.enqueueWorkspaceAsset(
    workspace,
    relativePath,
    { turns: [{ turnId: 'old-turn' }, { turnId: 'new-turn' }], totalTurns: 2 },
    { revision: 2, workspaceGeneration: 2, advanceFromDirectory: true }
  );
  const result = await sync.flush();
  const saved = JSON.parse(handles.readText(`${root}/${relativePath}`));

  assert.equal(queued.revision, 5001);
  assert.equal(result.failed, 0);
  assert.equal(result.pendingCount, 0);
  assert.equal(saved.revision, 5001);
  assert.equal(saved.data.totalTurns, 2);
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
  assert.equal(USER_DATA_DATABASE_VERSION, 4);
  assert.equal(DIRECTORY_HANDLE_STORE_NAME, 'directoryHandles');
  assert.equal(SYNC_QUEUE_STORE_NAME, 'syncQueue');
  assert.ok(fake.openCalls.every(call => call.version === 4));
  ['documents', 'meta', 'directoryHandles', 'syncQueue', 'workspaces',
    'workspaceAssets', 'workspaceTurns', 'workspaceTombstones', 'figureImages']
    .forEach(name => assert.equal(fake.stores.has(name), true));
});

test('v1 document data survives the v4 upgrade in both adapter opening orders', async () => {
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
    assert.ok(fake.openCalls.every(call => call.version === 4));
    ['documents', 'meta', 'directoryHandles', 'syncQueue', 'workspaces',
      'workspaceAssets', 'workspaceTurns', 'workspaceTombstones', 'figureImages']
      .forEach(name => assert.equal(fake.stores.has(name), true));
  }
});

test('queues nested workspace assets before manifest and central index while permission is pending', async () => {
  const handles = createFakeHandleStore('prompt');
  const queue = createMemorySyncQueue();
  const sync = createDirectorySync({ handleStore: handles, queueStore: queue });
  const workspace = workspaceFixture();

  await sync.enqueueWorkspaceAsset(workspace, 'figures/figure-1/panel-questions/q-1.json', {
    question: 'What changed?', answer: 'Signal increased.'
  }, { revision: 1 });
  assert.deepEqual((await queue.getAll()).map(item => item.relativePath), [
    `workspaces/${workspace.directoryName}/figures/figure-1/panel-questions/q-1.json`,
    `workspaces/${workspace.directoryName}/manifest.json`,
    'workspace-index.json'
  ]);
  assert.equal((await sync.flush()).permission, 'prompt');
  assert.equal((await queue.getAll()).length, 3);

  handles.setPermission('granted');
  const flushed = await sync.flush();
  assert.equal(flushed.written, 3);
  const assetPath = `SCI-Highlighter/workspaces/${workspace.directoryName}/figures/figure-1/panel-questions/q-1.json`;
  const manifestPath = `SCI-Highlighter/workspaces/${workspace.directoryName}/manifest.json`;
  assert.ok(handles.writes.indexOf(assetPath) < handles.writes.indexOf(manifestPath));
  assert.ok(handles.writes.indexOf(manifestPath) < handles.writes.indexOf('SCI-Highlighter/workspace-index.json'));
  const loaded = await sync.readWorkspaceAsset(workspace, 'figures/figure-1/panel-questions/q-1.json');
  assert.equal(loaded.found, true);
  assert.equal(loaded.value.data.answer, 'Signal increased.');
});

test('merges a newer on-disk workspace index with a stale queued index without losing either workspace', async () => {
  const handles = createFakeHandleStore();
  const queue = createMemorySyncQueue();
  const sync = createDirectorySync({ handleStore: handles, queueStore: queue });
  const first = workspaceFixture();
  const second = workspaceFixture({
    workspaceId: `workspace:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.org/second',
    aliases: [{ type: 'doi', value: '10.1000/second' }],
    title: 'Second paper',
    directoryName: `Second paper--${'b'.repeat(16)}`,
    revision: '2'.repeat(64),
    contentHash: '2'.repeat(64)
  });

  await sync.enqueueWorkspaceAsset(first, 'chat/index.json', { turns: [] }, {
    revision: 1, workspaceGeneration: 1
  });
  await sync.flush();
  await sync.enqueueWorkspaceAsset(first, 'chat/turns/turn-2.json', {
    turnId: 'turn-2', question: 'Queued after the first flush'
  }, { revision: 2, workspaceGeneration: 1 });

  const secondManifest = createWorkspaceManifest(second);
  handles.writeText(
    `SCI-Highlighter/workspaces/${second.directoryName}/manifest.json`,
    `${JSON.stringify(secondManifest)}\n`
  );
  const diskIndex = createWorkspaceIndex([
    createWorkspaceManifest(first),
    secondManifest
  ], { revision: 50, updatedAt: '2026-07-28T12:00:00.000Z' });
  handles.writeText(
    'SCI-Highlighter/workspace-index.json',
    `${JSON.stringify(diskIndex)}\n`
  );

  const flushed = await sync.flush();
  assert.equal(flushed.failed, 0);
  assert.equal(flushed.pendingCount, 0);
  const merged = validateWorkspaceIndex(JSON.parse(
    handles.readText('SCI-Highlighter/workspace-index.json')
  ));
  assert.equal(merged.revision, 51);
  assert.deepEqual(merged.workspaces.map(item => item.workspaceId), [
    first.workspaceId,
    second.workspaceId
  ]);
});

test('rebuilds a workspace index from manifests, quarantines malformed data, and matches exact identity only', async () => {
  const handles = createFakeHandleStore();
  const first = workspaceFixture();
  const second = workspaceFixture({
    workspaceId: `workspace:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.org/other',
    aliases: [{ type: 'doi', value: '10.1000/other' }],
    title: 'Same visible title',
    directoryName: `Same visible title--${'b'.repeat(16)}`,
    contentHash: '2'.repeat(64), revision: '2'.repeat(64)
  });
  handles.writeText(`SCI-Highlighter/workspaces/${first.directoryName}/manifest.json`,
    `${JSON.stringify(createWorkspaceManifest(first))}\n`);
  handles.writeText(`SCI-Highlighter/workspaces/${second.directoryName}/manifest.json`,
    `${JSON.stringify(createWorkspaceManifest(second))}\n`);
  handles.writeText('SCI-Highlighter/workspaces/Broken--cccccccccccccccc/manifest.json', '{bad json');
  const sync = createDirectorySync({ handleStore: handles, queueStore: createMemorySyncQueue() });

  const rebuilt = await sync.rebuildWorkspaceIndex();
  assert.equal(rebuilt.workspaceCount, 2);
  assert.equal(rebuilt.quarantined, 1);
  assert.ok(handles.has('SCI-Highlighter/conflicts/quarantine/Broken--cccccccccccccccc.manifest.invalid.json'));
  const index = validateWorkspaceIndex(JSON.parse(handles.readText('SCI-Highlighter/workspace-index.json')));
  assert.equal(index.workspaces.length, 2);

  const exactUrl = await sync.listWorkspaceManifests({
    canonicalUrl: 'https://example.org/paper?tracking=1', contentHash: '1'.repeat(64)
  });
  assert.equal(exactUrl.matches[0].match, 'exact');
  const exactDoi = await sync.listWorkspaceManifests({
    doi: '10.1000/other', contentHash: '2'.repeat(64)
  });
  assert.equal(exactDoi.matches[0].manifest.workspaceId, second.workspaceId);
  const changed = await sync.listWorkspaceManifests({
    canonicalUrl: first.canonicalUrl, contentHash: '9'.repeat(64)
  });
  assert.equal(changed.matches[0].match, 'content-changed');
  const titleOnly = await sync.listWorkspaceManifests({ title: 'Same visible title' });
  assert.deepEqual(titleOnly.matches, []);
});

test('workspace deletion removes its active, backup, and conflict trees without touching another workspace', async () => {
  const handles = createFakeHandleStore();
  const queue = createMemorySyncQueue();
  const sync = createDirectorySync({ handleStore: handles, queueStore: queue });
  const first = workspaceFixture();
  const second = workspaceFixture({
    workspaceId: `workspace:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.org/other',
    directoryName: `Other--${'b'.repeat(16)}`,
    contentHash: '2'.repeat(64), revision: '2'.repeat(64)
  });
  await sync.enqueueWorkspaceAsset(first, 'chat/turns/turn-1.json', { answer: 'first' }, { revision: 1 });
  await sync.enqueueWorkspaceAsset(second, 'chat/turns/turn-1.json', { answer: 'other' }, { revision: 1 });
  await sync.flush();
  await sync.enqueueWorkspaceAsset(first, 'chat/turns/turn-1.json', { answer: 'divergent' }, { revision: 1 });
  const conflict = await sync.flush();
  assert.ok(conflict.conflicts >= 1);
  assert.equal(JSON.parse(handles.readText(
    `SCI-Highlighter/workspaces/${first.directoryName}/chat/turns/turn-1.json`
  )).data.answer, 'first');

  await sync.enqueueWorkspaceAsset(first, 'ui/state.json', { view: 'chat' }, { revision: 2 });
  await sync.enqueueWorkspaceAsset(second, 'ui/state.json', { view: 'figure' }, { revision: 2 });
  const firstBackup =
    `SCI-Highlighter/backups/workspaces/${first.directoryName}/chat/index.previous.json`;
  const secondBackup =
    `SCI-Highlighter/backups/workspaces/${second.directoryName}/chat/index.previous.json`;
  const firstConflict =
    `SCI-Highlighter/conflicts/workspaces/${first.directoryName}/chat/index.r2.extension.json`;
  const secondConflict =
    `SCI-Highlighter/conflicts/workspaces/${second.directoryName}/chat/index.r2.extension.json`;
  handles.writeText(firstBackup, JSON.stringify({ answer: 'first-backup' }));
  handles.writeText(secondBackup, JSON.stringify({ answer: 'second-backup' }));
  handles.writeText(firstConflict, JSON.stringify({ answer: 'first-conflict' }));
  handles.writeText(secondConflict, JSON.stringify({ answer: 'second-conflict' }));
  const cancelled = await sync.cancelWorkspaceQueue(first);
  assert.ok(cancelled.cancelled >= 1);
  assert.ok((await queue.getAll()).some(item => item.relativePath.includes(second.directoryName)));
  const removed = await sync.removeWorkspaceTree(first);
  assert.equal(removed.removed, true);
  assert.equal(handles.has(`SCI-Highlighter/workspaces/${first.directoryName}/chat/turns/turn-1.json`), false);
  assert.equal(handles.has(`SCI-Highlighter/workspaces/${second.directoryName}/chat/turns/turn-1.json`), true);
  assert.equal(handles.has(firstBackup), false);
  assert.equal(handles.has(firstConflict), false);
  assert.equal(handles.has(secondBackup), true);
  assert.equal(handles.has(secondConflict), true);
  assert.equal(removed.removedConflicts, 1);
  assert.equal((await sync.status()).conflictCount, 0);
});
