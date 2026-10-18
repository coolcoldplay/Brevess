const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// This fixture stores string primary keys. Match IDBKeyRange.bound semantics so
// bounded production reads are exercised instead of reverting to whole-store scans.
globalThis.IDBKeyRange ||= {
  bound(lower, upper, lowerOpen = false, upperOpen = false) {
    return { includes(key) {
      return (lowerOpen ? key > lower : key >= lower) &&
        (upperOpen ? key < upper : key <= upper);
    } };
  }
};

const {
  USER_DATA_DATABASE_NAME,
  USER_DATA_DATABASE_VERSION,
  USER_DATA_STORE_NAMES,
  openUserDataDatabase,
  resetUserDataDatabaseConnection
} = require('../core/user-data-database.js');
require('../core/article-workspace.js');
const { createIndexedDbDocumentStore } = require('../core/document-store.js');
require('../core/analysis-cache.js');
require('../core/corpus-store.js');
require('../core/operation-control.js');
const {
  createSupplementalFigureImportDraft
} = require('../core/supplemental-materials.js');
const {
  createFigureWorkspaceDraft,
  applyFigureWorkspaceMutation,
  normalizeFigureWorkspaceDraft,
  publicFigureWorkspaceDraft
} = require('../core/figure-workspace.js');
const { createBackgroundRouter } = require('../core/background-router.js');
const { createIndexedDbDirectoryHandleStore } = require('../core/directory-sync.js');
const {
  createIndexedDbArticleWorkspaceStore
} = require('../core/article-workspace-store.js');

function createMemoryStorage() {
  const values = {};
  return {
    get(key, callback) { callback({ [key]: values[key] }); },
    set(input, callback) { Object.assign(values, input); callback(); }
  };
}

function createFakeIndexedDb({ version = 0, initialStores = {}, blockedOnce = false } = {}) {
  let currentVersion = version;
  let shouldBlock = blockedOnce;
  const stores = new Map(Object.entries(initialStores).map(([name, records]) => [
    name, new Map(records.map(([key, value]) => [key, structuredClone(value)]))
  ]));
  const keyPaths = new Map();
  const openCalls = [];
  let failPutStore = '';
  let failDeleteStore = '';
  let readwriteTail = Promise.resolve();

  function request(transaction, operation) {
    const output = {};
    transaction.pending += 1;
    transaction.ready.then(() => queueMicrotask(() => {
      try {
        if (!transaction.aborted) {
          output.result = operation();
          output.onsuccess?.();
        }
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
    }));
    return output;
  }

  function transactionFor(storeNames, mode) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    let snapshots = new Map();
    let releaseWrite = () => {};
    let released = false;
    const transaction = {
      mode,
      ready: Promise.resolve(),
      active: mode !== 'readwrite',
      pending: 0,
      aborted: false,
      error: null,
      completionScheduled: false,
      release() {
        if (released) return;
        released = true;
        releaseWrite();
      },
      abort() {
        if (this.aborted) return;
        this.aborted = true;
        for (const [name, snapshot] of snapshots) stores.set(name, snapshot);
        queueMicrotask(() => {
          try { this.onabort?.(); } finally { this.release(); }
        });
      },
      schedule() {
        if (!this.active || this.completionScheduled || this.aborted) return;
        this.completionScheduled = true;
        queueMicrotask(() => {
          this.completionScheduled = false;
          if (!this.aborted && this.pending === 0) {
            try { this.oncomplete?.(); } finally { this.release(); }
          }
        });
      },
      objectStore(name) {
        if (!names.includes(name) || !stores.has(name)) throw new Error(`Missing store ${name}`);
        return {
          get(key) {
            return request(transaction, () => stores.get(name).has(key)
              ? structuredClone(stores.get(name).get(key)) : undefined);
          },
          getAll(range) {
            return request(transaction, () => [...stores.get(name).entries()]
              .filter(([key]) => !range || range.includes(key))
              .map(([, value]) => structuredClone(value)));
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
              stores.get(name).set(key, structuredClone(value));
              return key;
            });
          },
          delete(key) {
            return request(transaction, () => {
              if (failDeleteStore === name) {
                failDeleteStore = '';
                throw new Error(`simulated ${name} delete failure`);
              }
              return stores.get(name).delete(key);
            });
          }
        };
      }
    };
    if (mode === 'readwrite') {
      const predecessor = readwriteTail;
      let resolveWrite;
      const completed = new Promise(resolve => { resolveWrite = resolve; });
      readwriteTail = predecessor.then(() => completed);
      releaseWrite = resolveWrite;
      transaction.ready = predecessor.then(() => {
        snapshots = new Map(names.map(name => [name, new Map(stores.get(name) || [])]));
        transaction.active = true;
        transaction.schedule();
      });
    }
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
    failNextPutFor(name) { failPutStore = name; },
    failNextDeleteFor(name) { failDeleteStore = name; }
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

function reviewedMechanismMatrixDraft() {
  let draft = createFigureWorkspaceDraft([{
    figureId: 'figure-2', figureLabel: 'Figure 2', panelHints: ['A', 'B']
  }]);
  const apply = (mutation, now) => {
    draft = applyFigureWorkspaceMutation(draft, {
      ...mutation, expectedRevision: draft.revision
    }, now);
  };
  apply({
    type: 'replace_mechanism_chain', chain: {
      nodes: [
        { id: 'source', label: 'Source' },
        { id: 'result', label: 'Result' },
        { id: 'deleted', label: 'Delete me' }
      ],
      edges: [
        {
          id: 'source-result', from: 'source', to: 'result', label: 'supports',
          polarity: 'neutral', panelEvidence: [{
            figureId: 'figure-2', panelId: 'A', evidenceClass: 'other',
            evidenceClassSource: 'inferred'
          }]
        },
        {
          id: 'feedback', from: 'result', to: 'source', label: 'feedback',
          polarity: 'negative', panelEvidence: [{
            figureId: 'figure-2', panelId: 'B', evidenceClass: 'other',
            evidenceClassSource: 'inferred'
          }]
        },
        {
          id: 'deleted-edge', from: 'source', to: 'deleted', label: '',
          polarity: 'neutral', panelEvidence: []
        }
      ]
    }
  }, 100);
  apply({
    type: 'update_mechanism_node', nodeId: 'source', field: 'label', value: 'Reader source'
  }, 101);
  apply({
    type: 'update_mechanism_edge', edgeId: 'source-result', field: 'label', value: 'Reader relation'
  }, 102);
  apply({
    type: 'update_mechanism_edge_evidence', edgeId: 'source-result', index: 0,
    expectedFigureId: 'figure-2', expectedPanelId: 'A',
    evidence: {
      figureId: 'figure-2', panelId: 'A', evidenceClass: 'necessity',
      evidenceClassSource: 'manual'
    }
  }, 103);
  apply({
    type: 'set_mechanism_panel_alias', figureId: 'figure-2', panelId: 'A', value: 'rescue'
  }, 104);
  apply({
    type: 'remove_mechanism_edge_evidence', edgeId: 'feedback', index: 0,
    expectedFigureId: 'figure-2', expectedPanelId: 'B'
  }, 105);
  apply({ type: 'remove_mechanism_node', nodeId: 'deleted' }, 106);
  return publicFigureWorkspaceDraft(draft);
}

test('v1 and v2 data upgrade to one v4 database in either adapter opening order', async () => {
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
    assert.equal(USER_DATA_DATABASE_VERSION, 4);
  }
});

test('blocked database upgrade is recoverable on the next open', async () => {
  const fake = createFakeIndexedDb({ version: 2, blockedOnce: true, initialStores: {
    documents: [], meta: [], directoryHandles: [], syncQueue: []
  } });
  resetUserDataDatabaseConnection(fake.indexedDb);
  await assert.rejects(() => openUserDataDatabase(fake.indexedDb), /INDEXEDDB_UPGRADE_BLOCKED/);
  const database = await openUserDataDatabase(fake.indexedDb);
  assert.equal(database.version, 4);
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

test('workspace staging assets are deleted only through exact revision and hash CAS', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
  const owner = await store.ensureWorkspace(workspace());
  const staged = await store.putAsset(
    owner.workspaceId,
    'internal/figure-retry-staging/figure-retry-guard-delete1234.json',
    { kind: 'figure_retry_candidate', status: 'pending_confirmation' }
  );
  assert.equal((await store.getWorkspace(owner.workspaceId)).summary.assetCount, 0);
  await assert.rejects(() => store.deleteAsset(
    owner.workspaceId, staged.relativePath,
    { expectedRevision: staged.revision + 1, expectedContentHash: staged.contentHash }
  ), error => error.code === 'ASSET_REVISION_CONFLICT');
  await assert.rejects(() => store.deleteAsset(
    owner.workspaceId, staged.relativePath,
    { expectedRevision: staged.revision, expectedContentHash: 'wrong-hash' }
  ), error => error.code === 'ASSET_HASH_CONFLICT');
  const result = await store.deleteAsset(
    owner.workspaceId, staged.relativePath,
    { expectedRevision: staged.revision, expectedContentHash: staged.contentHash }
  );
  assert.equal(result.deleted, true);
  assert.equal(await store.getAsset(owner.workspaceId, staged.relativePath), null);
  assert.equal((await store.getWorkspace(owner.workspaceId)).summary.assetCount, 0);
});

test('Figure promotion requires exact staging CAS and target binding inside the main transaction', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
  const owner = await store.ensureWorkspace(workspace());
  const mainPath = 'figures/workspace-draft.json';
  const stagePath =
    'internal/figure-retry-staging/figure-retry-guard-promotecas1234.json';
  const base = await store.putAsset(owner.workspaceId, mainPath, { science: 'base' });
  let staged = await store.putAsset(owner.workspaceId, stagePath, {
    kind: 'figure_retry_candidate', status: 'pending_confirmation',
    target: { relativePath: mainPath }, candidate: { content: { science: 'retry' } }
  });
  for (const requiredStaging of [{
    relativePath: stagePath, revision: staged.revision + 1, contentHash: staged.contentHash
  }, {
    relativePath: stagePath, revision: staged.revision, contentHash: 'wrong-stage-hash'
  }]) {
    await assert.rejects(() => store.putAsset(
      owner.workspaceId, mainPath, { science: 'must not persist' }, {
        expectedRevision: base.revision,
        expectedContentHash: base.contentHash,
        requiredStaging
      }
    ), error => error.code === 'STAGING_STALE');
    assert.deepEqual((await store.getAsset(owner.workspaceId, mainPath)).content,
      { science: 'base' });
  }
  staged = await store.putAsset(owner.workspaceId, stagePath, {
    kind: 'figure_retry_candidate', status: 'pending_confirmation',
    target: { relativePath: 'figures/another-draft.json' },
    candidate: { content: { science: 'retry' } }
  }, {
    expectedRevision: staged.revision,
    expectedContentHash: staged.contentHash
  });
  await assert.rejects(() => store.putAsset(
    owner.workspaceId, mainPath, { science: 'must not persist' }, {
      expectedRevision: base.revision,
      expectedContentHash: base.contentHash,
      requiredStaging: {
        relativePath: stagePath,
        revision: staged.revision,
        contentHash: staged.contentHash
      }
    }
  ), error => error.code === 'STAGING_STALE');
  assert.deepEqual((await store.getAsset(owner.workspaceId, mainPath)).content,
    { science: 'base' });
});

test('pending Figure promotion keeps base summary until staging finalize atomically refreshes it', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
  const owner = await store.ensureWorkspace(workspace());
  const mainPath = 'figures/workspace-draft.json';
  const stagingPath =
    'internal/figure-retry-staging/figure-retry-guard-summary1234.json';
  const baseContent = { marker: 'base' };
  const promotedContent = { marker: 'promoted', added: 'retry science' };
  const base = await store.putAsset(owner.workspaceId, mainPath, baseContent);
  const baseSummary = (await store.getWorkspace(owner.workspaceId)).summary;
  const staged = await store.putAsset(owner.workspaceId, stagingPath, {
    kind: 'figure_retry_candidate', status: 'pending_confirmation'
  });
  const promoted = await store.putAsset(
    owner.workspaceId, mainPath, promotedContent, {
      expectedRevision: base.revision,
      expectedContentHash: base.contentHash,
      summaryContent: baseContent
    }
  );
  const pendingSummary = (await store.getWorkspace(owner.workspaceId)).summary;
  assert.equal(pendingSummary.assetCount, baseSummary.assetCount);
  assert.equal(pendingSummary.assetBytes, baseSummary.assetBytes);
  await store.deleteAsset(owner.workspaceId, stagingPath, {
    expectedRevision: staged.revision,
    expectedContentHash: staged.contentHash,
    refreshSummaryPath: mainPath
  });
  const finalizedSummary = (await store.getWorkspace(owner.workspaceId)).summary;
  assert.equal(finalizedSummary.assetCount, 1);
  assert.equal(finalizedSummary.assetBytes, promoted.byteSize);
});

test('projected Figure retry writes atomically reconcile pre- and post-promotion crash stages', async () => {
  for (const promotedBeforeCrash of [false, true]) {
    const fake = createFakeIndexedDb();
    const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
    const owner = await store.ensureWorkspace(workspace());
    const mainPath = 'figures/workspace-draft.json';
    const oldStagePath = promotedBeforeCrash
      ? 'internal/figure-retry-staging/figure-retry-guard-oldpost1234.json'
      : 'internal/figure-retry-staging/figure-retry-guard-oldpre12345.json';
    const baseContent = {
      revision: 4,
      figures: [{ figureId: 'f1', panelAnalyses: {
        A: { conclusion: { value: 'completed A', humanReviewed: true } }
      } }]
    };
    const retryContent = structuredClone(baseContent);
    retryContent.revision = 5;
    retryContent.figures[0].panelAnalyses.B = {
      conclusion: { value: 'unconfirmed retry B', humanReviewed: false }
    };
    const base = await store.putAsset(owner.workspaceId, mainPath, baseContent);
    const staged = await store.putAsset(owner.workspaceId, oldStagePath, {
      schemaVersion: 1,
      kind: 'figure_retry_candidate',
      status: 'pending_confirmation',
      target: { relativePath: mainPath },
      base: {
        revision: base.revision,
        contentHash: base.contentHash,
        byteSize: base.byteSize,
        updatedAt: base.updatedAt,
        content: baseContent
      },
      candidate: { content: retryContent }
    });
    if (promotedBeforeCrash) {
      await store.putAsset(owner.workspaceId, mainPath, retryContent, {
        expectedRevision: base.revision,
        expectedContentHash: base.contentHash,
        summaryContent: baseContent
      });
    }
    const raw = await store.getAsset(owner.workspaceId, mainPath);
    const humanContent = structuredClone(baseContent);
    humanContent.figures[0].note = {
      value: promotedBeforeCrash ? 'human after post crash' : 'human after pre crash',
      humanReviewed: true
    };
    const mirrored = [];
    const router = createBackgroundRouter({
      storageArea: createMemoryStorage(),
      articleWorkspaceStore: store,
      directorySync: {
        async listWorkspaceManifests() { return { permission: 'granted', matches: [] }; },
        async enqueueWorkspaceAsset(_workspace, path, nextContent) {
          mirrored.push({ path, content: structuredClone(nextContent) });
        }
      },
      fetchImpl: async () => { throw new Error('provider must not be called'); }
    });
    const loaded = await router.handle({
      type: 'ARTICLE_WORKSPACE_GET_ASSET',
      workspaceId: owner.workspaceId,
      relativePath: mainPath
    });
    assert.equal(loaded.success, true);
    assert.deepEqual(loaded.data.asset.content, baseContent);
    assert.match(loaded.data.asset.writeToken, /^workspace-write-v1-[a-f0-9]{16}$/u);
    const saved = await router.handle({
      type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
      workspaceId: owner.workspaceId,
      workspaceGeneration: owner.workspaceGeneration,
      relativePath: mainPath,
      content: humanContent,
      expectedRevision: loaded.data.asset.revision,
      expectedContentHash: loaded.data.asset.contentHash,
      writeToken: loaded.data.asset.writeToken
    });
    assert.equal(saved.success, true);
    assert.equal((await store.listAssets(owner.workspaceId))
      .some(asset => asset.relativePath === oldStagePath), false);
    assert.deepEqual((await store.getAsset(owner.workspaceId, mainPath)).content, humanContent);
    const exported = await router.handle({
      type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId: owner.workspaceId
    });
    assert.deepEqual(exported.data.assets.map(asset => asset.content), [humanContent]);
    mirrored.length = 0;
    await router.handle({
      type: 'ARTICLE_WORKSPACE_MIRROR_ALL',
      workspaceId: owner.workspaceId,
      workspaceGeneration: owner.workspaceGeneration
    });
    assert.deepEqual(mirrored, [{ path: mainPath, content: humanContent }]);
    assert.doesNotMatch(JSON.stringify(exported), /unconfirmed retry B/u);
    assert.equal(raw.revision >= base.revision, true);
    assert.equal(staged.revision, 1);
  }
});

test('Figure retry promotion transaction rejects a staging record deleted after confirm read', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
  const owner = await store.ensureWorkspace(workspace());
  const mainPath = 'figures/workspace-draft.json';
  const stagePath =
    'internal/figure-retry-staging/figure-retry-guard-confirmrace1234.json';
  const baseContent = { revision: 1, science: 'base science' };
  const candidateA = { revision: 2, science: 'unconfirmed A science' };
  const candidateB = { revision: 2, science: 'confirmed B science' };
  const base = await store.putAsset(owner.workspaceId, mainPath, baseContent);
  const stageA = await store.putAsset(owner.workspaceId, stagePath, {
    schemaVersion: 1,
    kind: 'figure_retry_candidate',
    status: 'pending_confirmation',
    target: { relativePath: mainPath },
    base: {
      revision: base.revision,
      contentHash: base.contentHash,
      byteSize: base.byteSize,
      updatedAt: base.updatedAt,
      content: baseContent
    },
    candidate: { content: candidateA }
  });
  let releaseStageRead;
  let announceStageRead;
  const stageRead = new Promise(resolve => { announceStageRead = resolve; });
  const stageRelease = new Promise(resolve => { releaseStageRead = resolve; });
  let gateStageRead = true;
  const guardedStore = {
    ...store,
    async getAsset(id, path) {
      const asset = await store.getAsset(id, path);
      if (gateStageRead && path === stagePath) {
        gateStageRead = false;
        announceStageRead();
        await stageRelease;
      }
      return asset;
    }
  };
  const mirrored = [];
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: guardedStore,
    directorySync: {
      async listWorkspaceManifests() { return { permission: 'granted', matches: [] }; },
      async enqueueWorkspaceAsset(_workspace, path, content) {
        mirrored.push({ path, content: structuredClone(content) });
      }
    },
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const confirmingA = router.handle({
    type: 'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET',
    workspaceId: owner.workspaceId,
    workspaceGeneration: owner.workspaceGeneration,
    relativePath: mainPath,
    stagingPath: stagePath,
    stagingRevision: stageA.revision,
    stagingContentHash: stageA.contentHash,
    commitGuardId: 'figure-retry-guard-confirmrace5678',
    commitGuardKind: 'figure_retry'
  }, { async onWorkspaceCommitGuard() { return { success: true }; } });
  await stageRead;
  const promotedB = await store.reconcileFigureRetryWrite(
    owner.workspaceId, mainPath, candidateB, {
      expectedRawRevision: base.revision,
      expectedRawContentHash: base.contentHash,
      pendingStages: [{
        relativePath: stageA.relativePath,
        revision: stageA.revision,
        contentHash: stageA.contentHash
      }]
    }
  );
  releaseStageRead();
  const responseA = await confirmingA;
  assert.equal(responseA.success, false);
  assert.equal(responseA.error.code, 'STAGING_STALE');
  const rawMain = await store.getAsset(owner.workspaceId, mainPath);
  assert.equal(rawMain.revision, promotedB.asset.revision);
  assert.equal(rawMain.contentHash, promotedB.asset.contentHash);
  assert.deepEqual(rawMain.content, candidateB);
  assert.equal(await store.getAsset(owner.workspaceId, stagePath), null);

  const [loaded, listed, exported] = await Promise.all([
    router.handle({
      type: 'ARTICLE_WORKSPACE_GET_ASSET',
      workspaceId: owner.workspaceId,
      relativePath: mainPath
    }),
    router.handle({
      type: 'ARTICLE_WORKSPACE_LIST_ASSETS',
      workspaceId: owner.workspaceId
    }),
    router.handle({ type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId: owner.workspaceId })
  ]);
  await router.handle({
    type: 'ARTICLE_WORKSPACE_MIRROR_ALL',
    workspaceId: owner.workspaceId,
    workspaceGeneration: owner.workspaceGeneration
  });
  assert.deepEqual(loaded.data.asset.content, candidateB);
  assert.deepEqual(listed.data.assets.map(asset => asset.content), [candidateB]);
  assert.deepEqual(exported.data.assets.map(asset => asset.content), [candidateB]);
  assert.deepEqual(mirrored, [{ path: mainPath, content: candidateB }]);
  assert.doesNotMatch(JSON.stringify({ loaded, listed, exported, mirrored }),
    /unconfirmed A science/u);
});

test('new Figure retry supersedes every older target stage in one transaction', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
  const owner = await store.ensureWorkspace(workspace());
  const mainPath = 'figures/workspace-draft.json';
  const baseContent = {
    revision: 7,
    figures: [{ figureId: 'f1', panelAnalyses: {
      A: { conclusion: { value: 'completed A', humanReviewed: true } }
    } }]
  };
  const base = await store.putAsset(owner.workspaceId, mainPath, baseContent);
  const oldStages = [];
  for (const suffix of ['older1111', 'older2222']) {
    oldStages.push(await store.putAsset(
      owner.workspaceId,
      `internal/figure-retry-staging/figure-retry-guard-${suffix}.json`,
      {
        kind: 'figure_retry_candidate', status: 'pending_confirmation',
        target: { relativePath: mainPath },
        base: { revision: base.revision, contentHash: base.contentHash, content: baseContent },
        candidate: { content: { stale: suffix } }
      }
    ));
  }
  const candidate = structuredClone(baseContent);
  candidate.revision = 8;
  candidate.figures[0].panelAnalyses.B = {
    conclusion: { value: 'recovered missing B', humanReviewed: false }
  };
  const newStagePath =
    'internal/figure-retry-staging/figure-retry-guard-current3333.json';
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: store,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const loaded = await router.handle({
    type: 'ARTICLE_WORKSPACE_GET_ASSET',
    workspaceId: owner.workspaceId,
    relativePath: mainPath
  });
  assert.deepEqual(loaded.data.asset.content, baseContent);
  const stagedResponse = await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
    workspaceId: owner.workspaceId,
    workspaceGeneration: owner.workspaceGeneration,
    relativePath: mainPath,
    content: candidate,
    expectedRevision: loaded.data.asset.revision,
    expectedContentHash: loaded.data.asset.contentHash,
    writeToken: loaded.data.asset.writeToken,
    commitGuardId: 'figure-retry-guard-current3333',
    commitGuardKind: 'figure_retry'
  }, { async onWorkspaceCommitGuard() { return { success: true }; } });
  assert.equal(stagedResponse.success, true);
  assert.equal(stagedResponse.data.stagingPath, newStagePath);
  const currentMain = await store.getAsset(owner.workspaceId, mainPath);
  const currentStage = await store.getAsset(owner.workspaceId, newStagePath);
  assert.deepEqual(currentMain.content, baseContent);
  assert.deepEqual(currentStage.content.base.content, baseContent);
  assert.deepEqual(currentStage.content.candidate.content, candidate);
  assert.equal(currentStage.content.candidate.content
    .figures[0].panelAnalyses.A.conclusion.value, 'completed A');
  assert.deepEqual((await store.listAssets(owner.workspaceId))
    .filter(asset => asset.relativePath.startsWith('internal/figure-retry-staging/'))
    .map(asset => asset.relativePath), [newStagePath]);
});

test('Figure retry finalize removes every older target stage behind the promoted-main CAS', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
  const owner = await store.ensureWorkspace(workspace());
  const mainPath = 'figures/workspace-draft.json';
  const main = await store.putAsset(owner.workspaceId, mainPath, { confirmed: true });
  const stages = [];
  for (const suffix of ['oldfinal1111', 'currentfinal2222']) {
    stages.push(await store.putAsset(
      owner.workspaceId,
      `internal/figure-retry-staging/figure-retry-guard-${suffix}.json`,
      {
        kind: 'figure_retry_candidate', status: 'pending_confirmation',
        target: { relativePath: mainPath },
        base: { revision: 0, contentHash: '', content: null },
        candidate: { content: { suffix } }
      }
    ));
  }
  await store.deleteAsset(owner.workspaceId, stages[1].relativePath, {
    expectedRevision: stages[1].revision,
    expectedContentHash: stages[1].contentHash,
    refreshSummaryPath: mainPath,
    deleteRelatedStagingForPath: mainPath,
    relatedAssetExpectedRevision: main.revision,
    relatedAssetExpectedContentHash: main.contentHash
  });
  assert.deepEqual((await store.listAssets(owner.workspaceId))
    .map(asset => asset.relativePath), [mainPath]);
});

test('Figure retry finalize treats an already-missing staged asset as a CAS conflict', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
  const owner = await store.ensureWorkspace(workspace());
  const mainPath = 'figures/workspace-draft.json';
  const stagePath =
    'internal/figure-retry-staging/figure-retry-guard-missingfinal1234.json';
  const main = await store.putAsset(owner.workspaceId, mainPath, { confirmed: true });
  await assert.rejects(() => store.deleteAsset(owner.workspaceId, stagePath, {
    expectedRevision: 1,
    expectedContentHash: 'missing-stage-hash',
    refreshSummaryPath: mainPath,
    deleteRelatedStagingForPath: mainPath,
    relatedAssetExpectedRevision: main.revision,
    relatedAssetExpectedContentHash: main.contentHash
  }), error => error.code === 'ASSET_REVISION_CONFLICT');
  assert.deepEqual((await store.getAsset(owner.workspaceId, mainPath)).content,
    { confirmed: true });
});

test('Figure retry staging maintenance removes only a bounded batch of expired hidden assets', async () => {
  let clock = '2026-08-01T00:00:00.000Z';
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb, { now: () => clock });
  const owner = await store.ensureWorkspace(workspace());
  const mainPath = 'figures/workspace-draft.json';
  const main = await store.putAsset(
    owner.workspaceId, mainPath, { science: 'main survives' }
  );
  const oldPaths = [];
  for (const suffix of ['expired1111', 'expired2222', 'expired3333']) {
    const path = `internal/figure-retry-staging/figure-retry-guard-${suffix}.json`;
    oldPaths.push(path);
    await store.putAsset(owner.workspaceId, path, {
      kind: 'figure_retry_candidate', status: 'pending_confirmation',
      target: { relativePath: mainPath },
      base: {
        revision: main.revision, contentHash: main.contentHash,
        content: main.content
      },
      candidate: { content: { suffix } }
    });
  }
  clock = '2026-08-31T00:00:00.000Z';
  const freshPath =
    'internal/figure-retry-staging/figure-retry-guard-fresh4444.json';
  await store.putAsset(owner.workspaceId, freshPath, {
    kind: 'figure_retry_candidate', status: 'pending_confirmation',
    target: { relativePath: mainPath },
    base: {
      revision: main.revision, contentHash: main.contentHash,
      content: main.content
    },
    candidate: { content: { fresh: true } }
  });
  const first = await store.sweepExpiredFigureRetryStaging({
    ttlMs: 7 * 24 * 60 * 60 * 1000, maxBatch: 2
  });
  assert.equal(first.deleted, 2);
  assert.equal(first.remainingExpired, true);
  assert.deepEqual((await store.getAsset(owner.workspaceId, mainPath)).content,
    { science: 'main survives' });
  assert.notEqual(await store.getAsset(owner.workspaceId, freshPath), null);
  const second = await store.sweepExpiredFigureRetryStaging({
    ttlMs: 7 * 24 * 60 * 60 * 1000, maxBatch: 2
  });
  assert.equal(second.deleted, 1);
  assert.equal(second.remainingExpired, false);
  assert.deepEqual((await store.listAssets(owner.workspaceId))
    .map(asset => asset.relativePath).sort(), [freshPath, mainPath].sort());
  assert.equal(oldPaths.some(path =>
    fake.stores.get('workspaceAssets').has(`${owner.workspaceId}\u0000${path}`)), false);
  const backgroundSource = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
  assert.match(backgroundSource, /sweepExpiredFigureRetryStagingBatches/u);
  assert.match(backgroundSource, /pass < 4[\s\S]*remainingExpired !== true/u);
});

test('Figure retry staging maintenance retains expired promoted quarantine across restart', async () => {
  let clock = '2026-07-01T00:00:00.000Z';
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb, { now: () => clock });
  const owner = await store.ensureWorkspace(workspace());
  const mainPath = 'figures/inventory.json';
  const stagePath =
    'internal/figure-retry-staging/figure-retry-guard-expiredpromoted1234.json';
  const baseContent = {
    figures: [{
      figureId: 'f1',
      panelHints: ['A'],
      panelAnalyses: { A: { conclusion: { value: 'confirmed A' } } }
    }]
  };
  const candidateContent = structuredClone(baseContent);
  candidateContent.figures[0].panelHints.push('B');
  candidateContent.figures[0].panelAnalyses.B = {
    conclusion: { value: 'unconfirmed retry B science' }
  };
  const base = await store.putAsset(owner.workspaceId, mainPath, baseContent);
  const staged = await store.putAsset(owner.workspaceId, stagePath, {
    schemaVersion: 1,
    kind: 'figure_retry_candidate',
    status: 'pending_confirmation',
    target: { relativePath: mainPath },
    base: {
      revision: base.revision,
      contentHash: base.contentHash,
      byteSize: base.byteSize,
      updatedAt: base.updatedAt,
      content: baseContent
    },
    candidate: { content: candidateContent }
  });
  const humanContent = structuredClone(baseContent);
  humanContent.figures[0].panelHints.push('C');
  humanContent.figures[0].panelAnalyses.C = {
    conclusion: { value: 'concurrent human C', humanReviewed: true }
  };
  humanContent.figures[0].note = { value: 'concurrent human note', humanReviewed: true };
  await store.putAsset(owner.workspaceId, mainPath, humanContent, {
    expectedRevision: base.revision,
    expectedContentHash: base.contentHash
  });
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: store,
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const confirmed = await router.handle({
    type: 'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET',
    workspaceId: owner.workspaceId,
    workspaceGeneration: owner.workspaceGeneration,
    relativePath: mainPath,
    stagingPath: stagePath,
    stagingRevision: staged.revision,
    stagingContentHash: staged.contentHash,
    commitGuardId: 'figure-retry-guard-expiredpromoted5678',
    commitGuardKind: 'figure_retry'
  }, { async onWorkspaceCommitGuard() { return { success: true }; } });
  assert.equal(confirmed.success, true);
  const durableStage = await store.getAsset(owner.workspaceId, stagePath);
  assert.deepEqual(durableStage.figureRetryPromotion, {
    status: 'promoted_pending_confirmation',
    targetRelativePath: mainPath,
    mainRevision: confirmed.data.asset.revision,
    mainContentHash: confirmed.data.asset.contentHash
  });
  assert.match(JSON.stringify((await store.getAsset(owner.workspaceId, mainPath)).content),
    /unconfirmed retry B science/u);

  clock = '2026-08-31T00:00:00.000Z';
  const swept = await store.sweepExpiredFigureRetryStaging({
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    maxBatch: 1
  });
  assert.deepEqual(swept, {
    deleted: 0,
    remainingExpired: false,
    maxBatch: 1,
    ttlMs: 7 * 24 * 60 * 60 * 1000
  });
  assert.notEqual(await store.getAsset(owner.workspaceId, stagePath), null);

  const mirrored = [];
  const restartedRouter = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: store,
    directorySync: {
      async listWorkspaceManifests() { return { permission: 'granted', matches: [] }; },
      async enqueueWorkspaceAsset(_workspace, path, content) {
        mirrored.push({ path, content: structuredClone(content) });
      }
    },
    fetchImpl: async () => { throw new Error('provider must not be called'); }
  });
  const [loaded, detail, listed, exported] = await Promise.all([
    restartedRouter.handle({
      type: 'ARTICLE_WORKSPACE_GET_ASSET',
      workspaceId: owner.workspaceId,
      relativePath: mainPath
    }),
    restartedRouter.handle({
      type: 'ARTICLE_WORKSPACE_DETAIL', workspaceId: owner.workspaceId
    }),
    restartedRouter.handle({
      type: 'ARTICLE_WORKSPACE_LIST_ASSETS', workspaceId: owner.workspaceId
    }),
    restartedRouter.handle({
      type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId: owner.workspaceId
    })
  ]);
  await restartedRouter.handle({
    type: 'ARTICLE_WORKSPACE_MIRROR_ALL',
    workspaceId: owner.workspaceId,
    workspaceGeneration: owner.workspaceGeneration
  });
  assert.deepEqual(loaded.data.asset.content, humanContent);
  assert.equal(detail.data.panelCount, 2);
  assert.deepEqual(listed.data.assets.map(asset => asset.content), [humanContent]);
  assert.deepEqual(exported.data.assets.map(asset => asset.content), [humanContent]);
  assert.deepEqual(mirrored, [{ path: mainPath, content: humanContent }]);
  assert.doesNotMatch(JSON.stringify({ loaded, detail, listed, exported, mirrored }),
    /unconfirmed retry B science/u);
});

test('Figure retry staging maintenance retains receipt-less legacy promoted candidates', async () => {
  for (const withConcurrentHumanEdit of [false, true]) {
    let clock = '2026-07-01T00:00:00.000Z';
    const fake = createFakeIndexedDb();
    const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb, { now: () => clock });
    const owner = await store.ensureWorkspace(workspace());
    const mainPath = 'figures/inventory.json';
    const stagePath = withConcurrentHumanEdit
      ? 'internal/figure-retry-staging/figure-retry-guard-legacyrebased1234.json'
      : 'internal/figure-retry-staging/figure-retry-guard-legacyexact12345.json';
    const baseContent = {
      figures: [{
        figureId: 'f1', panelHints: ['A'],
        panelAnalyses: { A: { conclusion: { value: 'confirmed A' } } }
      }]
    };
    const candidateContent = structuredClone(baseContent);
    candidateContent.figures[0].panelHints.push('B');
    candidateContent.figures[0].panelAnalyses.B = {
      conclusion: { value: 'legacy unconfirmed retry B science' }
    };
    const base = await store.putAsset(owner.workspaceId, mainPath, baseContent);
    await store.putAsset(owner.workspaceId, stagePath, {
      schemaVersion: 1,
      kind: 'figure_retry_candidate',
      status: 'pending_confirmation',
      target: { relativePath: mainPath },
      base: {
        revision: base.revision,
        contentHash: base.contentHash,
        byteSize: base.byteSize,
        updatedAt: base.updatedAt,
        content: baseContent
      },
      candidate: { content: candidateContent }
    });
    const rawContent = structuredClone(candidateContent);
    if (withConcurrentHumanEdit) {
      rawContent.figures[0].panelHints.push('C');
      rawContent.figures[0].panelAnalyses.C = {
        conclusion: { value: 'concurrent human C', humanReviewed: true }
      };
      rawContent.figures[0].note = {
        value: 'concurrent human note', humanReviewed: true
      };
    }
    await store.putAsset(owner.workspaceId, mainPath, rawContent, {
      expectedRevision: base.revision,
      expectedContentHash: base.contentHash,
      summaryContent: baseContent
    });
    const expectedProjection = structuredClone(baseContent);
    if (withConcurrentHumanEdit) {
      expectedProjection.figures[0].panelHints.push('C');
      expectedProjection.figures[0].panelAnalyses.C = structuredClone(
        rawContent.figures[0].panelAnalyses.C
      );
      expectedProjection.figures[0].note = structuredClone(rawContent.figures[0].note);
    }

    clock = '2026-08-31T00:00:00.000Z';
    const swept = await store.sweepExpiredFigureRetryStaging({
      ttlMs: 7 * 24 * 60 * 60 * 1000,
      maxBatch: 1
    });
    assert.equal(swept.deleted, 0);
    assert.equal(swept.remainingExpired, false);
    assert.notEqual(await store.getAsset(owner.workspaceId, stagePath), null);

    const mirrored = [];
    const restartedRouter = createBackgroundRouter({
      storageArea: createMemoryStorage(),
      articleWorkspaceStore: store,
      directorySync: {
        async listWorkspaceManifests() { return { permission: 'granted', matches: [] }; },
        async enqueueWorkspaceAsset(_workspace, path, content) {
          mirrored.push({ path, content: structuredClone(content) });
        }
      },
      fetchImpl: async () => { throw new Error('provider must not be called'); }
    });
    const [loaded, detail, listed, exported] = await Promise.all([
      restartedRouter.handle({
        type: 'ARTICLE_WORKSPACE_GET_ASSET',
        workspaceId: owner.workspaceId,
        relativePath: mainPath
      }),
      restartedRouter.handle({
        type: 'ARTICLE_WORKSPACE_DETAIL', workspaceId: owner.workspaceId
      }),
      restartedRouter.handle({
        type: 'ARTICLE_WORKSPACE_LIST_ASSETS', workspaceId: owner.workspaceId
      }),
      restartedRouter.handle({
        type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId: owner.workspaceId
      })
    ]);
    await restartedRouter.handle({
      type: 'ARTICLE_WORKSPACE_MIRROR_ALL',
      workspaceId: owner.workspaceId,
      workspaceGeneration: owner.workspaceGeneration
    });
    assert.deepEqual(loaded.data.asset.content, expectedProjection);
    assert.equal(detail.data.panelCount, withConcurrentHumanEdit ? 2 : 1);
    assert.deepEqual(listed.data.assets.map(asset => asset.content), [expectedProjection]);
    assert.deepEqual(exported.data.assets.map(asset => asset.content), [expectedProjection]);
    assert.deepEqual(mirrored, [{ path: mainPath, content: expectedProjection }]);
    assert.doesNotMatch(JSON.stringify({ loaded, detail, listed, exported, mirrored }),
      /legacy unconfirmed retry B science/u);
  }
});

test('Figure retry staging maintenance retains an expired stage when cleanup fails', async () => {
  let clock = '2026-08-01T00:00:00.000Z';
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb, { now: () => clock });
  const owner = await store.ensureWorkspace(workspace());
  const mainPath = 'figures/inventory.json';
  const main = await store.putAsset(owner.workspaceId, mainPath, { confirmed: true });
  const stagePath =
    'internal/figure-retry-staging/figure-retry-guard-cleanuperror1234.json';
  await store.putAsset(owner.workspaceId, stagePath, {
    kind: 'figure_retry_candidate',
    status: 'pending_confirmation',
    target: { relativePath: mainPath },
    base: {
      revision: main.revision, contentHash: main.contentHash,
      content: main.content
    },
    candidate: { content: { pending: true } }
  });
  clock = '2026-08-31T00:00:00.000Z';
  fake.failNextDeleteFor('workspaceAssets');
  await assert.rejects(() => store.sweepExpiredFigureRetryStaging({
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    maxBatch: 1
  }), /simulated workspaceAssets delete failure/u);
  assert.notEqual(await store.getAsset(owner.workspaceId, stagePath), null);
  const retried = await store.sweepExpiredFigureRetryStaging({
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    maxBatch: 1
  });
  assert.equal(retried.deleted, 1);
  assert.equal(await store.getAsset(owner.workspaceId, stagePath), null);
});

test('Figure draft workspace asset round trip preserves reviewed empty values and CAS authority', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
  const owner = await store.ensureWorkspace(workspace());
  let draft = createFigureWorkspaceDraft([{
    figureId: 'figure-2', figureLabel: 'Figure 2', panelHints: ['A']
  }]);
  draft = applyFigureWorkspaceMutation(draft, {
    type: 'set_figure_field', expectedRevision: draft.revision,
    figureId: 'figure-2', field: 'remainingQuestion', value: ''
  }, 222);
  draft = applyFigureWorkspaceMutation(draft, {
    type: 'set_panel_field', expectedRevision: draft.revision,
    figureId: 'figure-2', panelId: 'A', field: 'note', value: 'durable human note'
  }, 223);
  const publicDraft = publicFigureWorkspaceDraft(draft);
  const first = await store.putAsset(
    owner.workspaceId, 'figures/workspace-draft.json', publicDraft,
    { expectedRevision: 0, expectedContentHash: '' }
  );
  const portableDraft = JSON.parse(JSON.stringify(publicDraft));
  assert.deepEqual(first.content, portableDraft);
  assert.deepEqual((await store.getAsset(
    owner.workspaceId, 'figures/workspace-draft.json'
  )).content, portableDraft);

  await assert.rejects(() => store.putAsset(
    owner.workspaceId, 'figures/workspace-draft.json', { overwritten: true },
    { expectedRevision: 0, expectedContentHash: first.contentHash }
  ), error => error.code === 'ASSET_REVISION_CONFLICT');
  assert.deepEqual((await store.getAsset(
    owner.workspaceId, 'figures/workspace-draft.json'
  )).content, portableDraft);
});

test('Figure draft workspace asset round trip preserves the complete reviewed mechanism matrix state', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
  const owner = await store.ensureWorkspace(workspace());
  const edited = reviewedMechanismMatrixDraft();
  const saved = await store.putAsset(
    owner.workspaceId, 'figures/workspace-draft.json', edited,
    { expectedRevision: 0, expectedContentHash: '' }
  );
  const stored = await store.getAsset(owner.workspaceId, 'figures/workspace-draft.json');
  const reloaded = publicFigureWorkspaceDraft(normalizeFigureWorkspaceDraft(stored.content));

  assert.deepEqual(JSON.parse(JSON.stringify(reloaded)), JSON.parse(JSON.stringify(edited)));
  assert.equal(reloaded.mechanismChain.nodes.find(node => node.id === 'source').label.value,
    'Reader source');
  assert.equal(reloaded.mechanismChain.nodes.some(node => node.id === 'deleted'), false);
  assert.equal(reloaded.mechanismChain.edges.some(edge => edge.id === 'deleted-edge'), false);
  assert.equal(reloaded.mechanismChain.edges.find(edge => edge.id === 'feedback')
    .panelEvidence.length, 0);
  assert.equal(reloaded.mechanismChain.edges.find(edge => edge.id === 'source-result')
    .panelEvidence[0].evidenceClassSource, 'manual');
  assert.deepEqual(reloaded.mechanismChain.panelAliases['figure-2:A'], {
    value: 'rescue', humanReviewed: true, editedAt: 104
  });
  assert.equal(reloaded.mechanismChain.reviewTombstones.nodes
    .some(item => item.id === 'deleted' && item.editedAt === 106), true);
  assert.equal(reloaded.mechanismChain.reviewTombstones.edges
    .some(item => item.id === 'deleted-edge' && item.editedAt === 106), true);
  assert.equal(reloaded.mechanismChain.reviewTombstones.evidence
    .some(item => item.edgeId === 'feedback' && item.panelId === 'B' &&
      item.editedAt === 105), true);
  const regenerated = applyFigureWorkspaceMutation(reloaded, {
    type: 'replace_mechanism_chain', expectedRevision: reloaded.revision,
    chain: {
      nodes: [
        { id: 'source', label: 'Source' }, { id: 'result', label: 'Result' },
        { id: 'deleted', label: 'Must stay deleted' }
      ],
      edges: [
        {
          id: 'feedback', from: 'result', to: 'source', label: 'feedback',
          polarity: 'negative', panelEvidence: [{
            figureId: 'figure-2', panelId: 'B', evidenceClass: 'other',
            evidenceClassSource: 'inferred'
          }]
        },
        {
          id: 'deleted-edge', from: 'source', to: 'deleted', label: '',
          polarity: 'neutral', panelEvidence: []
        }
      ]
    }
  }, 107);
  assert.equal(regenerated.mechanismChain.nodes.some(node => node.id === 'deleted'), false);
  assert.equal(regenerated.mechanismChain.edges.find(edge => edge.id === 'feedback')
    .panelEvidence.length, 0);
  await assert.rejects(() => store.putAsset(
    owner.workspaceId, 'figures/workspace-draft.json', { overwritten: true },
    { expectedRevision: 0, expectedContentHash: saved.contentHash }
  ), error => error.code === 'ASSET_REVISION_CONFLICT');
});

test('workspace asset createOnly conflicts without replacing the existing asset', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
  const owner = await store.ensureWorkspace(workspace());
  const first = await store.putAsset(
    owner.workspaceId,
    'figures/supplemental/manual-caption.json',
    { analysisStatus: 'awaiting_article_context', marker: 'first' },
    { expectedRevision: 0, createOnly: true }
  );

  await assert.rejects(() => store.putAsset(
    owner.workspaceId,
    'figures/supplemental/manual-caption.json',
    { analysisStatus: 'awaiting_article_context', marker: 'second' },
    { expectedRevision: first.revision, createOnly: true }
  ), error => error?.code === 'ASSET_REVISION_CONFLICT');

  const persisted = await store.getAsset(
    owner.workspaceId,
    'figures/supplemental/manual-caption.json'
  );
  assert.equal(persisted.revision, 1);
  assert.equal(persisted.content.marker, 'first');
});

test('fake IndexedDB serializes concurrent readwrite create-only transactions', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
  const owner = await store.ensureWorkspace(workspace());
  const writes = await Promise.allSettled([
    store.putAsset(owner.workspaceId, 'figures/supplemental/concurrent.json',
      { marker: 'first' }, { expectedRevision: 0, createOnly: true }),
    store.putAsset(owner.workspaceId, 'figures/supplemental/concurrent.json',
      { marker: 'second' }, { expectedRevision: 0, createOnly: true })
  ]);

  assert.equal(writes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(writes.filter(item => item.status === 'rejected').length, 1);
  assert.equal(
    writes.find(item => item.status === 'rejected').reason?.code,
    'ASSET_REVISION_CONFLICT'
  );
  assert.equal((await store.getAsset(
    owner.workspaceId, 'figures/supplemental/concurrent.json'
  )).revision, 1);
});

test('router and real workspace store preserve create-only assets and concurrent closed drafts', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
  const owner = await store.ensureWorkspace(workspace());
  let providerCalls = 0;
  let barrierEnabled = false;
  let initialExistsReads = 0;
  let releaseInitialExistsReads;
  let conflictCount = 0;
  const bothInitialExistsReads = new Promise(resolve => {
    releaseInitialExistsReads = resolve;
  });
  const initialExistsPaths = [];
  const integrationStore = {
    ...store,
    async getAsset(workspaceId, path) {
      const asset = await store.getAsset(workspaceId, path);
      if (barrierEnabled && initialExistsReads < 2) {
        initialExistsPaths.push(path);
        assert.equal(asset, null);
        initialExistsReads += 1;
        if (initialExistsReads === 2) releaseInitialExistsReads();
        await bothInitialExistsReads;
      }
      return asset;
    },
    async putAsset(...args) {
      try {
        return await store.putAsset(...args);
      } catch (error) {
        if (error?.code === 'ASSET_REVISION_CONFLICT') {
          conflictCount += 1;
          throw error;
        }
        throw error;
      }
    }
  };
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: integrationStore,
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error('provider must not be called');
    }
  });

  const relativePath = 'figures/supplemental/generic-create-only.json';
  const first = await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
    workspaceId: owner.workspaceId,
    workspaceGeneration: owner.workspaceGeneration,
    relativePath,
    content: { marker: 'first' },
    expectedRevision: 0,
    createOnly: true
  });
  assert.equal(first.success, true);
  const conflict = await router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
    workspaceId: owner.workspaceId,
    workspaceGeneration: owner.workspaceGeneration,
    relativePath,
    content: { marker: 'must-not-overwrite' },
    expectedRevision: first.data.asset.revision,
    createOnly: true
  });
  assert.equal(conflict.success, false);
  assert.equal(conflict.error.code, 'ASSET_REVISION_CONFLICT');
  assert.equal((await store.getAsset(owner.workspaceId, relativePath)).content.marker, 'first');
  conflictCount = 0;

  const sourceFingerprint = `sha256:${'d'.repeat(64)}`;
  const draft = createSupplementalFigureImportDraft({
    sourceMode: 'caption',
    sourceMaterialId: 'manual-caption-s1',
    sourceImportedAt: '2026-08-03T03:04:05.000Z',
    sourceFingerprint,
    caption: 'A, treatment increases signal. B, matched control remains stable.',
    figureLabel: 'Supplemental Figure S1'
  });
  const message = {
    type: 'ARTICLE_WORKSPACE_SAVE_SUPPLEMENTAL_DRAFT',
    target: {
      workspaceId: owner.workspaceId,
      workspaceGeneration: owner.workspaceGeneration,
      targetArticleTabId: 91,
      canonicalUrl: owner.canonicalUrl,
      documentHash: `sha256:${owner.contentHash}`
    },
    draft
  };
  barrierEnabled = true;
  const concurrent = await Promise.all([
    router.handle(structuredClone(message)),
    router.handle(structuredClone(message))
  ]);
  assert.ok(concurrent.every(response => response.success));
  assert.equal(initialExistsReads, 2);
  assert.equal(new Set(initialExistsPaths).size, 1);
  assert.ok(conflictCount >= 1);
  assert.equal(new Set(concurrent.map(response => response.data.asset.relativePath)).size, 2);

  const supplementalAssets = (await store.listAssets(owner.workspaceId))
    .filter(asset => asset.relativePath.startsWith('figures/supplemental/') &&
      asset.relativePath !== relativePath);
  assert.equal(supplementalAssets.length, 2);
  for (const asset of supplementalAssets) {
    const persisted = await store.getAsset(owner.workspaceId, asset.relativePath);
    assert.equal(persisted.content.analysisStatus, 'awaiting_article_context');
    assert.equal(persisted.revision, 1);
    assert.equal(
      asset.relativePath,
      `figures/supplemental/${persisted.content.materialId}.json`
    );
  }

  const beforeWrongTarget = (await store.listAssets(owner.workspaceId)).length;
  const wrongTarget = await router.handle({
    ...structuredClone(message),
    target: {
      ...message.target,
      workspaceId: `workspace:${'b'.repeat(64)}`
    }
  });
  assert.equal(wrongTarget.success, false);
  assert.equal(wrongTarget.error.code, 'WORKSPACE_NOT_FOUND');
  assert.equal((await store.listAssets(owner.workspaceId)).length, beforeWrongTarget);
  assert.equal(providerCalls, 0);
});

test('workspace summaries stay exact across asset replacement and turn mutations', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb);
  const owner = await store.ensureWorkspace(workspace());
  await store.putAsset(owner.workspaceId, 'chat/index.json', {
    turns: [{ turnId: 'chat-1' }, { turnId: 'chat-2' }]
  });
  await store.putAsset(owner.workspaceId, 'figures/inventory.json', {
    figures: [{
      figureId: 'figure-1', panelHints: ['A', 'B'],
      panelAnalyses: { C: { text: 'third panel' } }
    }]
  });
  await store.putAsset(owner.workspaceId, 'annotations/highlights.json', {
    highlightDistribution: { totalHighlights: 4 },
    annotations: [{ id: 'a1' }, { id: 'a2' }]
  });
  const turn = await store.appendTurn(owner.workspaceId, {
    turnId: 'stored-turn', role: 'user', content: 'short'
  });

  let saved = await store.getWorkspace(owner.workspaceId);
  assert.deepEqual({
    assets: saved.summary.assetCount,
    turns: saved.summary.turnCount,
    chat: saved.summary.chatTurnCount,
    figures: saved.summary.figureCount,
    panels: saved.summary.panelCount,
    highlights: saved.summary.highlightCount,
    annotations: saved.summary.annotationCount
  }, {
    assets: 3, turns: 1, chat: 2, figures: 1, panels: 3,
    highlights: 4, annotations: 2
  });
  const initialTurnBytes = saved.summary.turnBytes;

  await store.updateTurn(owner.workspaceId, turn.turnId, {
    content: 'a substantially longer revised turn body'
  });
  saved = await store.getWorkspace(owner.workspaceId);
  assert.ok(saved.summary.turnBytes > initialTurnBytes);

  await store.putAsset(owner.workspaceId, 'figures/inventory.json', {
    figures: [{ figureId: 'figure-1', panelHints: ['A'] }]
  });
  saved = await store.getWorkspace(owner.workspaceId);
  assert.equal(saved.summary.assetCount, 3);
  assert.equal(saved.summary.panelCount, 1);

  const statistics = await store.getStorageStatistics();
  assert.equal(statistics.workspaceCount, 1);
  assert.equal(statistics.assetCount, 3);
  assert.equal(statistics.turnCount, 1);
  assert.ok(statistics.estimatedBytes > 0);

  await store.deleteTurn(owner.workspaceId, turn.turnId);
  saved = await store.getWorkspace(owner.workspaceId);
  assert.equal(saved.summary.turnCount, 0);
  assert.equal(saved.summary.turnBytes, 0);
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
