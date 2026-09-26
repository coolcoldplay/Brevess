const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The frozen-source override makes the original QA012 failure independently reproducible.
const sourceRoot = process.env.ARCH009_SOURCE_ROOT
  ? path.resolve(process.env.ARCH009_SOURCE_ROOT) : path.resolve(__dirname, '..');
const production = name => require(path.join(sourceRoot, 'core', name));
production('user-data-database.js');
const { createArticleWorkspaceIdentity, createWorkspaceManifest } = production('article-workspace.js');
production('analysis-cache.js');
production('corpus-store.js');
production('document-store.js');
const { createIndexedDbArticleWorkspaceStore } = production('article-workspace-store.js');
const { createBackgroundRouter } = production('background-router.js');

// Reuse the existing fake IndexedDB only. Router, workspace schema and store are production code.
const fixtureSource = fs.readFileSync(path.join(__dirname, 'article-workspace-store.test.js'), 'utf8');
const start = fixtureSource.indexOf('function createFakeIndexedDb(');
const end = fixtureSource.indexOf('\nfunction workspace(', start);
assert.ok(start >= 0 && end > start);
const createFakeIndexedDb = Function(fixtureSource.slice(start, end) + '\nreturn createFakeIndexedDb;')();

async function fixture(permission = 'granted') {
  const { indexedDb } = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(indexedDb);
  const identity = await createArticleWorkspaceIdentity({
    canonicalUrl: 'https://example.org/archive-save-permission', title: 'Saved QA answer',
    content: 'Original scientific evidence remains unchanged.'
  });
  const workspace = await store.ensureWorkspace(identity);
  const assetPath = 'annotations/highlights.json';
  const annotationContent = { annotations: [] };
  const saved = await store.putAsset(workspace.workspaceId, assetPath, annotationContent);
  const current = await store.getWorkspace(workspace.workspaceId);
  const manifest = createWorkspaceManifest(current, [{ path: assetPath, type: 'json',
    revision: saved.revision, contentHash: saved.contentHash, updatedAt: saved.updatedAt }]);
  const calls = { status: 0, requestPermission: 0, capture: 0, list: 0, read: 0, writes: 0 };
  const originalCapture = store.captureRestoreBaseline.bind(store);
  store.captureRestoreBaseline = (...args) => { calls.capture++; return originalCapture(...args); };
  const router = createBackgroundRouter({
    storageArea: { get(key, callback) { callback({}); }, set(value, callback) { callback?.(); } },
    articleWorkspaceStore: store,
    directorySync: {
      async status() { calls.status++; return { permission, pendingCount: 0 }; },
      async requestDirectoryPermission() {
        calls.requestPermission++; return { permission, granted: permission === 'granted' };
      },
      async listWorkspaceManifests() {
        calls.list++;
        return { permission, manifests: permission === 'granted' ? [structuredClone(manifest)] : [],
          matches: permission === 'granted' ? [{ match: 'exact', manifest: structuredClone(manifest) }] : [] };
      },
      async readWorkspaceAsset(_manifest, requestedPath) {
        calls.read++; assert.equal(requestedPath, assetPath);
        return { permission, found: true, value: { schemaVersion: 1,
          kind: 'sci-logic-highlighter-workspace-asset', workspaceId: workspace.workspaceId,
          workspaceGeneration: workspace.workspaceGeneration, relativePath: assetPath,
          revision: saved.revision, contentHash: saved.contentHash, updatedAt: saved.updatedAt,
          data: structuredClone(annotationContent) } };
      },
      async enqueueWorkspaceAsset() { calls.writes++; }
    },
    fetchImpl: async () => { throw Error('PERMISSION_PROBE_MUST_NOT_CALL_NETWORK'); }
  });
  return { store, saved, calls, workspace: current, router,
    async probe(options = {}) { return router.handle({ type: 'ARTICLE_WORKSPACE_SCAN_RESTORE',
      identity: current, requestPermission: false, permissionOnly: true, ...options }); } };
}

test('save permission preflight with existing annotations only reads permission and never scans restoration', async () => {
  const f = await fixture();
  assert.equal(Object.hasOwn(f.workspace, 'documentId'), false, 'matches popup ensured.workspace request');
  const result = await f.probe();
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(result.data, { permission: 'granted', manifests: [], matches: [] });
  assert.deepEqual(f.calls, { status: 1, requestPermission: 0, capture: 0, list: 0, read: 0, writes: 0 });
  assert.deepEqual(await f.store.getAsset(f.workspace.workspaceId, 'annotations/highlights.json'), f.saved);
});

for (const permission of ['denied', 'unconfigured', 'prompt']) {
  test(`nonprompting permission-only reports ${permission} without scanning or prompting`, async () => {
    const f = await fixture(permission); const result = await f.probe();
    assert.equal(result.success, true, JSON.stringify(result));
    assert.deepEqual(result.data, { permission, manifests: [], matches: [] });
    assert.deepEqual(f.calls, { status: 1, requestPermission: 0, capture: 0, list: 0, read: 0, writes: 0 });
  });
}

for (const permission of ['granted', 'denied', 'unconfigured']) {
  test(`explicit permission request preserves the existing ${permission} request flow`, async () => {
    const f = await fixture(permission); const result = await f.probe({ requestPermission: true });
    assert.equal(result.success, true, JSON.stringify(result));
    assert.deepEqual(result.data, { permission, manifests: [], matches: [] });
    assert.deepEqual(f.calls, { status: 0, requestPermission: 1, capture: 0, list: 0, read: 0, writes: 0 });
  });
}

test('ordinary restore scan still rejects the same incomplete document baseline and writes nothing', async () => {
  const f = await fixture(); const result = await f.probe({ permissionOnly: false });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'INVALID_WORKSPACE_RESTORE_BASELINE');
  assert.deepEqual(f.calls, { status: 0, requestPermission: 0, capture: 1, list: 1, read: 1, writes: 0 });
  assert.deepEqual(await f.store.getAsset(f.workspace.workspaceId, 'annotations/highlights.json'), f.saved);
});

test('permission-only does not require a workspace or document identity', async () => {
  const f = await fixture(); const result = await f.probe({ identity: undefined });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(result.data, { permission: 'granted', manifests: [], matches: [] });
  assert.deepEqual(f.calls, { status: 1, requestPermission: 0, capture: 0, list: 0, read: 0, writes: 0 });
});
