const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

require('../core/user-data-database.js');
const { createWorkspaceManifest } = require('../core/article-workspace.js');
require('../core/analysis-cache.js');
require('../core/corpus-store.js');
require('../core/document-store.js');
const {
  createIndexedDbArticleWorkspaceStore
} = require('../core/article-workspace-store.js');
const { createBackgroundRouter } = require('../core/background-router.js');

// Reuse the existing in-memory IndexedDB fixture without registering its test
// suite. The router and workspace store below are the unmodified production code.
const fixtureSource = readFileSync(join(__dirname, 'article-workspace-store.test.js'), 'utf8');
const fixtureStart = fixtureSource.indexOf('function createFakeIndexedDb(');
const fixtureEnd = fixtureSource.indexOf('\nfunction workspace(', fixtureStart);
assert.ok(fixtureStart >= 0 && fixtureEnd > fixtureStart, 'existing IndexedDB fixture is available');
const createFakeIndexedDb = Function(
  fixtureSource.slice(fixtureStart, fixtureEnd) + '\nreturn createFakeIndexedDb;'
)();

const ASSET_PATH = 'annotations/paragraph-notes.json';
const OLD_TIME = '2026-09-23T01:00:00.000Z';
const NEW_TIME = '2026-09-23T01:01:00.000Z';
const OLD_NOTE = '目录保存的初稿：效应方向尚待核对。';
const NEW_NOTE = '人工修订：效应没有增加，n = 12，p = 0.03。';
const OPERATION_NONCE = 'arch009-newer-copy-operation-1';

function noteContent(note, updatedAt) {
  return { notes: [{ paragraphId: 'p-1', paragraphIndex: 0, note, updatedAt }] };
}

function createMemoryStorage() {
  const values = {};
  return {
    get(key, callback) { callback({ [key]: values[key] }); },
    set(input, callback) { Object.assign(values, input); callback?.(); }
  };
}

async function createCapturedCopyFixture({ match = 'exact' } = {}) {
  let now = OLD_TIME;
  const { indexedDb } = createFakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(indexedDb, { now: () => now });
  const identity = {
    schemaVersion: 1,
    workspaceId: 'workspace:' + 'a'.repeat(64),
    workspaceGeneration: 1,
    canonicalUrl: 'https://example.org/arch009-newer-copy',
    documentId: 'document-arch009-newer-copy',
    aliases: [],
    title: 'ARCH009 captured old copy',
    directoryName: 'ARCH009-captured-old-copy--' + 'a'.repeat(12),
    revision: '1'.repeat(64),
    contentHash: '1'.repeat(64)
  };
  await store.ensureWorkspace(identity);
  const savedOld = await store.putAsset(identity.workspaceId, ASSET_PATH,
    noteContent(OLD_NOTE, OLD_TIME));
  const oldWorkspace = await store.getWorkspace(identity.workspaceId);
  const manifest = createWorkspaceManifest(oldWorkspace, [{
    path: ASSET_PATH, type: 'json', revision: savedOld.revision,
    contentHash: savedOld.contentHash, updatedAt: savedOld.updatedAt
  }]);
  // The directory data is a captured earlier save from this exact same store,
  // workspace, generation and path, not an unrelated copy with invented ranks.
  const envelope = structuredClone({
    schemaVersion: 1, kind: 'sci-logic-highlighter-workspace-asset',
    workspaceId: identity.workspaceId, workspaceGeneration: 1,
    relativePath: ASSET_PATH, revision: savedOld.revision,
    contentHash: savedOld.contentHash, updatedAt: savedOld.updatedAt,
    data: savedOld.content
  });
  const queued = [];
  const router = createBackgroundRouter({
    storageArea: createMemoryStorage(),
    articleWorkspaceStore: store,
    nowImpl: () => Date.parse(now),
    directorySync: {
      async listWorkspaceManifests() {
        return {
          permission: 'granted', manifests: [structuredClone(manifest)],
          matches: [{ match, manifest: structuredClone(manifest) }]
        };
      },
      async readWorkspaceAsset(_manifest, path) {
        assert.equal(path, ASSET_PATH);
        return { permission: 'granted', found: true, value: structuredClone(envelope) };
      },
      async enqueueWorkspaceAsset(workspace, path, content, metadata) {
        queued.push(structuredClone({ workspace, path, content, metadata }));
      }
    },
    fetchImpl: async () => { throw new Error('This regression must remain offline'); }
  });
  return {
    identity, manifest, envelope, savedOld, oldWorkspace, queued, store, router,
    async saveManualEdit() {
      now = NEW_TIME;
      return store.putAsset(identity.workspaceId, ASSET_PATH, noteContent(NEW_NOTE, NEW_TIME));
    },
    async scan() {
      return router.handle({ type: 'ARTICLE_WORKSPACE_SCAN_RESTORE', identity });
    },
    async authorizeAndCommit(scanned) {
      // A safe future implementation may reject the stale plan at scan time.
      if (!scanned.success || !scanned.data?.restore) return scanned;
      const restore = scanned.data.restore;
      // Simulate the existing trusted content-script apply acknowledgement.
      // This test exercises router/store persistence, not content DOM application.
      const registered = await router.handle({
        type: 'ARTICLE_RESTORE_REGISTER_COMMIT',
        binding: {
          kind: 'workspace', current: identity, documentId: identity.documentId,
          manifest: restore.manifest, match: restore.match,
          operationNonce: OPERATION_NONCE
        }
      }, {
        trustedContentScript: true, senderTabId: 9, senderUrl: identity.canonicalUrl
      });
      assert.equal(registered.success, true, JSON.stringify(registered));
      return router.handle({
        type: 'ARTICLE_WORKSPACE_COMMIT_RESTORE', identity, restore,
        operationNonce: OPERATION_NONCE, receipt: registered.data.receipt
      });
    }
  };
}

test('control: scan is read-only and a valid same-copy receipt reaches the real store', async () => {
  const fixture = await createCapturedCopyFixture();
  const before = await fixture.store.getAsset(fixture.identity.workspaceId, ASSET_PATH);
  const scanned = await fixture.scan();
  assert.equal(scanned.success, true, JSON.stringify(scanned));
  assert.equal(scanned.data.restore.assets.find(asset => asset.relativePath === ASSET_PATH)
    .content.notes[0].note, OLD_NOTE);
  assert.deepEqual(await fixture.store.getAsset(fixture.identity.workspaceId, ASSET_PATH), before);
  assert.equal(fixture.queued.length, 0);
  const committed = await fixture.authorizeAndCommit(scanned);
  assert.equal(committed.success, true, JSON.stringify(committed));
  assert.equal(committed.data.committed, true);
  assert.deepEqual((await fixture.store.getAsset(fixture.identity.workspaceId, ASSET_PATH)).content,
    before.content);
});

for (const editTiming of ['before scan', 'after scan']) {
  test('ARCH-009 preserves a newer human paragraph note saved ' + editTiming, async t => {
    const fixture = await createCapturedCopyFixture();
    let newer;
    if (editTiming === 'before scan') newer = await fixture.saveManualEdit();
    const scanned = await fixture.scan();
    if (editTiming === 'before scan') {
      assert.equal(scanned.success, false, 'conflict must reject before content apply');
      assert.equal(scanned.error.code, 'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
      assert.equal(scanned.data, undefined, 'conflict must not look like an empty legacy-fallback result');
    }
    if (editTiming === 'after scan') {
      assert.equal(scanned.success, true, JSON.stringify(scanned));
      newer = await fixture.saveManualEdit();
    }
    assert.equal(newer.revision, fixture.savedOld.revision + 1);
    assert.notEqual(newer.contentHash, fixture.savedOld.contentHash);
    assert.ok(Date.parse(newer.updatedAt) > Date.parse(fixture.savedOld.updatedAt));
    assert.deepEqual((await fixture.store.getAsset(fixture.identity.workspaceId, ASSET_PATH)).content,
      newer.content, 'scan must not itself write browser data');

    const committed = await fixture.authorizeAndCommit(scanned);
    const actual = await fixture.store.getAsset(fixture.identity.workspaceId, ASSET_PATH);
    t.diagnostic(JSON.stringify({
      editTiming,
      directory: { revision: fixture.envelope.revision, updatedAt: fixture.envelope.updatedAt,
        contentHash: fixture.envelope.contentHash },
      localBeforeCommit: { revision: newer.revision, updatedAt: newer.updatedAt,
        contentHash: newer.contentHash },
      committed,
      localAfterCommit: { revision: actual.revision, updatedAt: actual.updatedAt,
        contentHash: actual.contentHash, note: actual.content.notes[0].note }
    }));
    // Rejection or keeping the current local asset are both valid protections.
    // A valid article-identity receipt alone must not erase a later human save.
    assert.deepEqual(actual.content, newer.content,
      'known older directory copy must not replace the newer browser-local human note');
  });
}

test('identical content with a different local revision and object-key order stays restorable', async () => {
  const fixture = await createCapturedCopyFixture();
  const content = { notes: [{ updatedAt: OLD_TIME, note: OLD_NOTE,
    paragraphIndex: 0, paragraphId: 'p-1' }] };
  const local = await fixture.store.putAsset(fixture.identity.workspaceId, ASSET_PATH, content);
  assert.ok(local.revision > fixture.envelope.revision);
  assert.equal((await fixture.scan()).success, true);
  assert.equal(fixture.queued.length, 0);
});

test('larger directory revision and later directory clock cannot silently rank differing copies', async () => {
  const fixture = await createCapturedCopyFixture();
  const local = await fixture.saveManualEdit();
  fixture.envelope.revision = 9000;
  fixture.envelope.updatedAt = '2030-01-01T00:00:00.000Z';
  const before = structuredClone(fixture.envelope);
  const result = await fixture.scan();
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
  assert.deepEqual(await fixture.store.getAsset(fixture.identity.workspaceId, ASSET_PATH), local);
  assert.deepEqual(fixture.envelope, before);
  assert.equal(fixture.queued.length, 0);
});

test('equal metadata hashes do not conceal differing actual note content', async () => {
  const fixture = await createCapturedCopyFixture();
  const local = await fixture.saveManualEdit();
  fixture.envelope.contentHash = local.contentHash;
  const result = await fixture.scan();
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
  assert.equal(fixture.queued.length, 0);
});

test('an explicitly emptied local note remains a conflicting human edit', async () => {
  const fixture = await createCapturedCopyFixture();
  const local = await fixture.store.putAsset(fixture.identity.workspaceId, ASSET_PATH,
    { notes: [] });
  const result = await fixture.scan();
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
  assert.deepEqual(await fixture.store.getAsset(fixture.identity.workspaceId, ASSET_PATH), local);
});

test('same-generation content-changed restores also protect differing local assets', async () => {
  const fixture = await createCapturedCopyFixture({ match: 'content-changed' });
  fixture.identity.contentHash = '2'.repeat(64);
  fixture.identity.revision = fixture.identity.contentHash;
  await fixture.store.ensureWorkspace(fixture.identity);
  await fixture.saveManualEdit();
  const result = await fixture.scan();
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
});

test('unreadable local state cannot silently bypass the pre-apply comparison', async () => {
  const fixture = await createCapturedCopyFixture();
  fixture.store.getWorkspace = async () => { throw new Error('fixture local read failure'); };
  const result = await fixture.scan();
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'WORKSPACE_STORE_UNAVAILABLE');
  assert.equal(fixture.queued.length, 0);
});
