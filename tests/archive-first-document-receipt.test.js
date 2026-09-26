const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
require('../core/category-store.js');
require('../core/adaptive-catalog.js');
require('../core/study-profile.js');
require('../core/settings-store.js');
require('../core/manual-annotations.js');
require('../core/analysis-cache.js');
require('../core/corpus-store.js');
require('../core/migration-bundle.js');
const { createIndexedDbDocumentStore } = require('../core/document-store.js');
const { createWorkspaceManifest } = require('../core/article-workspace.js');
const { createBackgroundRouter } = require('../core/background-router.js');

// Only reuse the native-like transaction fixture declarations, not other tests.
const source = readFileSync(join(__dirname, 'article-workspace-atomic-restore.test.js'), 'utf8');
const boundary = source.indexOf("\ntest('capture returns");
assert.ok(boundary > 0);
const { fixture: storeFixture, identity, recordTransactions } = Function('require', '__dirname',
  source.slice(0, boundary) + '\nreturn { fixture, identity, recordTransactions };')(require, __dirname);
const shared = globalThis.SciLLM;
const EXTENSION = 'first-document-receipt-extension';
const NONCE = 'arch009-first-document-operation';
const PATH = 'annotations/highlights.json';
const clone = value => structuredClone(value);
const documentInput = { title: 'Atomic restore', canonicalUrl: 'https://example.org/atomic',
  paragraphs: [{ paragraphId: 'p-1', sectionTitle: 'Results', text: 'Scientific quote is unchanged.' }] };
const annotation = { annotationId: 'restore-manual-1', categoryId: 'result',
  categorySnapshot: { name: '结果陈述', color: '#FFE66D' }, quote: 'Scientific quote',
  prefix: '', suffix: ' is unchanged.', sectionTitle: 'Results', blockFingerprint: 'p-1',
  startOffset: 0, endOffset: 16, note: 'A human annotation restored from the directory' };
function storage() {
  const values = {};
  return { values, get(key, callback) { callback({ [key]: values[key] }); },
    set(input, callback) { Object.assign(values, input); callback?.(); } };
}
function owner(overrides = {}) {
  return { trustedExtensionSender: true, trustedContentScript: true,
    senderExtensionId: EXTENSION, senderTabId: 9, senderFrameId: 0,
    senderDocumentId: 'browser-document-creator', senderUrl: documentInput.canonicalUrl,
    runtimeBaseUrl: `chrome-extension://${EXTENSION}/`,
    assertTrustedOwnerCurrent: async () => true,
    assertDocumentCreationOwnerCurrent: async () => true, ...overrides };
}
function ok(response) { assert.equal(response.success, true, JSON.stringify(response)); return response.data; }
async function fixture({ contents, beforePrepare, context = owner() } = {}) {
  const f = await storeFixture({ empty: true });
  const documents = createIndexedDbDocumentStore(f.fake.indexedDb);
  const documentId = await shared.createDocumentId(documentInput);
  const documentHash = await shared.hashDocument(documentInput.paragraphs);
  const live = identity({ documentId, documentHash });
  await f.store.ensureWorkspace(live);
  if (beforePrepare) await beforePrepare(documents, live);
  const assets = contents || [{ path: PATH, content: { annotations: [annotation] } }];
  const manifest = createWorkspaceManifest(await f.store.getWorkspace(live.workspaceId),
    assets.map((asset, index) => ({ path: asset.path, type: 'json', revision: 20 + index,
      contentHash: String(index + 3).repeat(64), updatedAt: '2026-09-01T00:00:00.000Z' })));
  let now = Date.parse('2026-09-23T03:00:00.000Z');
  const queued = [];
  const storageArea = storage();
  const configuration = { storageArea, runtimeExtensionId: EXTENSION,
    documentStore: documents, articleWorkspaceStore: f.store, nowImpl: () => now,
    fetchImpl: async () => { throw new Error('Provider requests are forbidden in this test'); },
    directorySync: {
      async listWorkspaceManifests() { return { permission: 'granted', manifests: [clone(manifest)],
        matches: [{ match: 'exact', manifest: clone(manifest) }] }; },
      async readWorkspaceAsset(_manifest, path) {
        const index = assets.findIndex(asset => asset.path === path);
        assert.ok(index >= 0, path);
        return { permission: 'granted', found: true, value: {
          schemaVersion: 1, kind: 'sci-logic-highlighter-workspace-asset',
          workspaceId: live.workspaceId, workspaceGeneration: live.workspaceGeneration,
          relativePath: path, revision: 20 + index, contentHash: String(index + 3).repeat(64),
          updatedAt: '2026-09-01T00:00:00.000Z', data: clone(assets[index].content) } };
      },
      async enqueueWorkspaceAsset(...args) { queued.push(clone(args)); }
    } };
  let router = createBackgroundRouter(configuration);
  return { ...f, documents, live, context, configuration, queued, storageArea,
    get router() { return router; },
    restart() { router = createBackgroundRouter(configuration); },
    advance(ms) { now += ms; },
    prepare(sender = context, document = documentInput) {
      return router.handle({ type: 'DOCUMENT_PREPARE', document }, sender);
    },
    scan(token, overrides = {}) {
      return router.handle({ type: 'ARTICLE_WORKSPACE_SCAN_RESTORE', identity: live,
        documentCreationToken: token, operationNonce: NONCE, ...overrides });
    },
    binding(scan, overrides = {}) {
      const restore = ok(scan).restore;
      return { kind: 'workspace', current: live, documentId, manifest: restore.manifest,
        match: restore.match, operationNonce: NONCE, ...overrides };
    },
    commit(scan, sender = context) {
      return router.handle({ type: 'ARTICLE_WORKSPACE_COMMIT_PREPARED_RESTORE',
        planId: ok(scan).restore.restorePlanId, binding: this.binding(scan) }, sender);
    },
    rows() { return Object.fromEntries([...f.fake.stores].map(([name, rows]) =>
      [name, [...rows].map(([key, value]) => [key, clone(value)])])); }
  };
}

test('a trusted first DOCUMENT_PREPARE restores through its actual empty record and returns the committed annotations', async () => {
  const f = await fixture();
  const prepared = ok(await f.prepare());
  assert.equal(prepared.record.annotations.length, 0);
  assert.match(prepared.documentCreationToken || '', /^document-creation-/);
  const scanned = await f.scan(prepared.documentCreationToken);
  ok(scanned);
  const transactions = recordTransactions(f.fake);
  const committed = ok(await f.commit(scanned));
  assert.equal(committed.persistenceCommitted, true);
  assert.deepEqual(committed.document, await f.documents.getDocument(f.live.documentId));
  assert.equal(committed.document.annotations.length, 1);
  assert.deepEqual(transactions.filter(row => row.mode === 'readwrite').map(row => row.names),
    [['documents', 'workspaceAssets', 'workspaceTombstones', 'workspaceTurns', 'workspaces']]);
  const revision = committed.document.revision;
  assert.equal(ok(await f.commit(scanned)).document.revision, revision, 'same plan retry is idempotent');
  const cleared = await f.documents.clearAnnotations(f.live.documentId);
  assert.equal(cleared.annotations.length, 0, 'subsequent genuine clear remains legal');
  assert.ok(cleared.revision > revision);
});

test('a same-owner no-op prepare preserves the original bounded token, but another tab receives none', async () => {
  const f = await fixture();
  const first = ok(await f.prepare());
  assert.ok(first.documentCreationToken);
  const second = ok(await f.prepare());
  assert.equal(second.documentCreationToken, first.documentCreationToken);
  const other = ok(await f.prepare(owner({ senderTabId: 10, senderDocumentId: 'other-document' })));
  assert.equal(other.documentCreationToken, undefined);
});

test('missing or rejected strict sender proof keeps ordinary prepare working without a token', async () => {
  for (const context of [owner({ assertDocumentCreationOwnerCurrent: undefined }),
    owner({ assertDocumentCreationOwnerCurrent: async () => { throw new Error('NO_OWNER'); } }),
    owner({ senderDocumentId: '' }), owner({ senderExtensionId: 'foreign-extension' }),
    owner({ senderUrl: 'https://example.org/another-article' })]) {
    const f = await fixture({ context });
    const prepared = ok(await f.prepare());
    assert.equal(prepared.documentCreationToken, undefined);
    assert.equal(prepared.record.annotations.length, 0);
    assert.equal((await f.scan()).error.code, 'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
  }
});

test('preexisting empty revision one is not a newly created record', async () => {
  const f = await fixture({ beforePrepare: (documents, live) => documents.prepareDocument({
    documentId: live.documentId, canonicalUrl: live.canonicalUrl, annotations: [] }) });
  const prepared = ok(await f.prepare());
  assert.equal(prepared.documentCreationToken, undefined);
  const before = f.rows();
  assert.equal((await f.scan()).error.code, 'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
  assert.deepEqual(f.rows(), before);
});

test('a later explicit empty clear invalidates first-creation authority before SCAN', async () => {
  const f = await fixture();
  const prepared = ok(await f.prepare());
  assert.ok(prepared.documentCreationToken);
  await f.documents.clearAnnotations(f.live.documentId);
  const before = f.rows();
  assert.equal((await f.scan(prepared.documentCreationToken)).success, false);
  assert.deepEqual(f.rows(), before);
});

test('a clear after SCAN aborts all five-store restore writes', async () => {
  const f = await fixture();
  const prepared = ok(await f.prepare());
  const scan = await f.scan(prepared.documentCreationToken);
  ok(scan);
  await f.documents.clearAnnotations(f.live.documentId);
  const before = f.rows();
  const committed = await f.commit(scan);
  assert.equal(committed.success, false);
  assert.equal(committed.error.code, 'WORKSPACE_RESTORE_CONFLICT');
  assert.deepEqual(f.rows(), before);
});

test('a token is not renewed by a no-op prepare and cannot be recreated after expiry or restart', async () => {
  for (const action of ['expiry', 'restart']) {
    const f = await fixture();
    const first = ok(await f.prepare());
    assert.ok(first.documentCreationToken);
    if (action === 'expiry') {
      f.advance(299999);
      assert.equal(ok(await f.prepare()).documentCreationToken, first.documentCreationToken);
      f.advance(2);
    } else f.restart();
    assert.equal(ok(await f.prepare()).documentCreationToken, undefined);
    assert.equal((await f.scan(first.documentCreationToken)).success, false);
  }
});

test('one creation token has one plan/nonce and retrying the same scan returns that plan', async () => {
  const f = await fixture();
  const token = ok(await f.prepare()).documentCreationToken;
  const first = await f.scan(token);
  const retry = await f.scan(token);
  assert.equal(ok(retry).restore.restorePlanId, ok(first).restore.restorePlanId);
  assert.equal((await f.scan(token, { operationNonce: 'another-first-creation-operation' })).success, false);
  ok(await f.commit(first));
  assert.equal((await f.scan(token)).success, false, 'an explicitly invalid token cannot silently downgrade');
  assert.equal((await f.scan()).success, true, 'same annotations still support ordinary restore without provenance');
  await f.documents.clearAnnotations(f.live.documentId);
  assert.equal((await f.scan(token)).success, false, 'consumed provenance must never authorize a later clear');
});

test('a plan cannot be claimed by a different tab, frame, browser document, or extension', async () => {
  const f = await fixture();
  const token = ok(await f.prepare()).documentCreationToken;
  const scanned = await f.scan(token);
  ok(scanned);
  const before = f.rows();
  for (const context of [owner({ senderTabId: 10 }), owner({ senderFrameId: 1 }),
    owner({ senderDocumentId: 'new-navigation-same-url' }), owner({ senderExtensionId: 'foreign-extension' }),
    owner({ assertDocumentCreationOwnerCurrent: async () => { throw new Error('NAVIGATED'); } })]) {
    assert.equal((await f.commit(scanned, context)).success, false);
    assert.deepEqual(f.rows(), before);
  }
  ok(await f.commit(scanned));
});

test('legacy commit relay cannot bypass creator binding with a valid old restore receipt', async () => {
  const f = await fixture();
  const token = ok(await f.prepare()).documentCreationToken;
  const scanned = await f.scan(token);
  const binding = f.binding(scanned);
  const registered = ok(await f.router.handle({ type: 'ARTICLE_RESTORE_REGISTER_COMMIT', binding }, f.context));
  const before = f.rows();
  const result = await f.router.handle({ type: 'ARTICLE_WORKSPACE_COMMIT_RESTORE', identity: f.live,
    restore: ok(scanned).restore, operationNonce: NONCE, receipt: registered.receipt });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'ARTICLE_RESTORE_RECEIPT_INVALID');
  assert.deepEqual(f.rows(), before);
  ok(await f.commit(scanned));
});

test('creation authority matches the whole record, not only annotations, revision or a client claim', async () => {
  for (const mutate of [
    (f, record) => f.documents.prepareDocument({ ...record, title: 'New metadata' }),
    async (f, record) => { await f.documents.upsertAnnotation(record.documentId, annotation);
      await f.documents.clearAnnotations(record.documentId); },
    async (f, record) => { f.fake.stores.get('documents').set(record.documentId,
      { ...record, unknownLateHumanValue: 'must survive despite the same revision' }); }
  ]) {
    const f = await fixture();
    const prepared = ok(await f.prepare());
    await mutate(f, prepared.record);
    const before = f.rows();
    const scanned = await f.scan(prepared.documentCreationToken, { createdFromAbsence: true,
      createdRecord: prepared.record });
    assert.equal(scanned.success, false);
    assert.deepEqual(f.rows(), before);
  }
});

test('creation authority requires the actual workspace generation and content identity', async () => {
  for (const change of [{ workspaceGeneration: 2 }, { contentHash: '9'.repeat(64) },
    { canonicalUrl: 'https://example.org/other' }, { documentHash: '8'.repeat(64) },
    { documentId: `sha256:${'f'.repeat(64)}` }]) {
    const f = await fixture();
    const token = ok(await f.prepare()).documentCreationToken;
    const before = f.rows();
    const scanned = await f.scan(token, { identity: { ...f.live, ...change } });
    assert.equal(scanned.success, false, JSON.stringify(change));
    assert.deepEqual(f.rows(), before);
  }
});

test('a creation receipt does not erase a conflict between legacy and highlights sources', async () => {
  const f = await fixture({ contents: [
    { path: PATH, content: { annotations: [annotation] } },
    { path: 'legacy/archive.json', content: { documentRecord: { annotations: [] } } }
  ] });
  const token = ok(await f.prepare()).documentCreationToken;
  const before = f.rows();
  const scanned = await f.scan(token);
  assert.equal(scanned.success, false);
  assert.equal(scanned.error.code, 'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
  assert.deepEqual(f.rows(), before);
});

test('successful prepare without the new store capability must remain ordinary and cannot mint provenance', async () => {
  const f = await fixture();
  f.documents.prepareDocumentWithCreationInfo = undefined;
  const prepared = ok(await f.prepare());
  assert.equal(prepared.documentCreationToken, undefined);
  assert.equal(prepared.record.annotations.length, 0);
});

test('an import invalidates creation plans even when the importer has no documents to replace', async () => {
  const f = await fixture();
  const token = ok(await f.prepare()).documentCreationToken;
  const scanned = await f.scan(token);
  ok(scanned);
  const bundle = ok(await f.router.handle({ type: 'MIGRATION_EXPORT' }));
  bundle.documents.documents = [];
  bundle.documents.index = [];
  ok(await f.router.handle({ type: 'MIGRATION_IMPORT', bundle }));
  const before = f.rows();
  assert.equal((await f.commit(scanned)).success, false);
  assert.deepEqual(f.rows(), before);
});

test('the provenance registry is bounded at 32 without breaking the 33rd ordinary prepare', async () => {
  const f = await fixture();
  const tokens = [];
  for (let i = 0; i < 33; i++) {
    const canonicalUrl = `https://example.org/receipt-${i}`;
    const input = { ...documentInput, canonicalUrl };
    const prepared = ok(await f.prepare(owner({ senderUrl: canonicalUrl,
      senderTabId: i, senderDocumentId: `browser-${i}` }), input));
    if (prepared.documentCreationToken) tokens.push(prepared.documentCreationToken);
    assert.ok(prepared.record.documentId);
  }
  assert.equal(tokens.length, 32);
  assert.equal(new Set(tokens).size, 32);
});

test('concurrent scans cannot reserve one creation fact for two different operations', async () => {
  const f = await fixture();
  const token = ok(await f.prepare()).documentCreationToken;
  const results = await Promise.all([f.scan(token), f.scan(token, {
    operationNonce: 'other-concurrent-first-document-operation' })]);
  assert.equal(results.filter(result => result.success).length, 1);
  assert.equal(results.filter(result => !result.success).length, 1);
});

test('losing strict ownership after store creation returns the real record but no authority', async () => {
  let checks = 0;
  const f = await fixture({ context: owner({ assertDocumentCreationOwnerCurrent: async () => {
    checks++;
    if (checks > 1) throw new Error('NAVIGATED_AFTER_PREPARE');
    return true;
  } }) });
  const prepared = ok(await f.prepare());
  assert.equal(prepared.documentCreationToken, undefined);
  assert.deepEqual(prepared.record, await f.documents.getDocument(f.live.documentId));
  assert.equal(ok(await f.prepare(owner())).documentCreationToken, undefined,
    'a later ordinary prepare cannot reconstruct a discarded creation fact');
});

test('LLM_PREPARE_DOCUMENT never issues creation authority, even with a trusted content sender', async () => {
  const f = await fixture();
  const settings = shared.createDefaultSettings();
  settings.consentGranted = true;
  settings.profiles = { profile_local_fixture: { id: 'profile_local_fixture', name: 'Local fixture',
    providerId: 'codex-local', config: { model: 'fixture-no-request' } } };
  f.storageArea.values.sciLlmSettingsV2 = settings;
  const prepared = ok(await f.router.handle({ type: 'LLM_PREPARE_DOCUMENT',
    document: documentInput }, f.context));
  assert.equal(prepared.documentCreationToken, undefined);
  assert.equal(ok(await f.prepare()).documentCreationToken, undefined);
  assert.equal((await f.scan()).error.code, 'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
});

test('directory annotation import invalidates a previously reserved creation plan', async () => {
  const f = await fixture();
  f.configuration.portableConfigManager = { runWhenReady: operation => operation() };
  f.restart();
  const prepared = ok(await f.prepare());
  const scanned = await f.scan(prepared.documentCreationToken);
  ok(scanned);
  f.configuration.directorySync.flush = async importer => {
    const value = { ...prepared.record, revision: prepared.record.revision + 10 };
    const imported = await importer(`annotations/${encodeURIComponent(value.documentId)}.json`, value);
    assert.equal(imported.imported, true);
    return { permission: 'granted', failed: 0, pendingCount: 0 };
  };
  ok(await f.router.handle({ type: 'USER_DATA_SYNC_NOW' }));
  const before = f.rows();
  assert.equal((await f.commit(scanned)).success, false);
  assert.deepEqual(f.rows(), before);
});
