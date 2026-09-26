const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// Reuse only fixture declarations, not their tests. The five-store fake keeps
// the production router, document normalizer and both IndexedDB stores intact.
const fixtureSource = readFileSync(join(__dirname,
  'article-workspace-atomic-document-restore.test.js'), 'utf8');
const boundary = fixtureSource.indexOf("\ntest('document capture is optional");
assert.ok(boundary > 0);
const { fixture: storeFixture, identity, annotation, DOCUMENT_ID, OTHER_DOCUMENT,
  allRows, recordTransactions, FIVE_STORES } = Function('require', '__dirname',
  fixtureSource.slice(0, boundary) + '\nreturn { fixture, identity, annotation, DOCUMENT_ID, ' +
  'OTHER_DOCUMENT, allRows, recordTransactions, FIVE_STORES };')(require, __dirname);
require('../core/analysis-cache.js');
require('../core/corpus-store.js');
const { normalizeDocumentRecord } = require('../core/document-store.js');
const { createWorkspaceManifest, createArticleWorkspaceIdentity } = require('../core/article-workspace.js');
const { createArticleArchive, articleArchiveRelativePath } = require('../core/article-archive.js');
const { createBackgroundRouter } = require('../core/background-router.js');

const HIGHLIGHTS = 'annotations/highlights.json';
const EXTRA = 'annotations/restore-review.json';
const NONCE = 'arch009-prepared-document-operation';
const clone = value => structuredClone(value);
function storage() {
  const values = {};
  return { get(key, callback) { callback({ [key]: values[key] }); },
    set(input, callback) { Object.assign(values, input); callback?.(); } };
}
async function fixture({ missing = true, localAnnotations, localMetadata = {}, assets,
  liveIdentity, legacyArchive } = {}) {
  const f = await storeFixture({ missing });
  if (localAnnotations !== undefined) {
    await f.documents.putDocument({ ...(f.original || {}), documentId: DOCUMENT_ID,
      canonicalUrl: identity().canonicalUrl, annotations: localAnnotations, ...localMetadata });
  }
  const live = liveIdentity || identity({ documentId: DOCUMENT_ID, documentHash: '2'.repeat(64) });
  if (liveIdentity) await f.store.ensureWorkspace(live);
  const contents = assets || [
    { path: HIGHLIGHTS, content: { annotations: [annotation()] } },
    { path: EXTRA, content: { reviewed: true, untouchedScientificText: '未增加，p = 0.03' } }
  ];
  const manifest = createWorkspaceManifest(await f.store.getWorkspace(live.workspaceId),
    contents.map((asset, index) => ({ path: asset.path, type: 'json', revision: 40 + index,
      contentHash: String(index + 3).repeat(64), updatedAt: '2088-01-01T00:00:00.000Z' })));
  const queued = [];
  const queuedArchives = [];
  const router = createBackgroundRouter({ storageArea: storage(), documentStore: f.documents,
    articleWorkspaceStore: f.store, nowImpl: () => Date.parse('2026-09-23T03:00:00.000Z'),
    directorySync: {
      async listWorkspaceManifests() {
        if (legacyArchive) return { permission: 'granted', manifests: [], matches: [] };
        return { permission: 'granted', manifests: [clone(manifest)],
          matches: [{ match: 'exact', manifest: clone(manifest) }] };
      },
      async readJson(path) {
        assert.ok(legacyArchive, 'legacy JSON only read for an explicit legacy fixture');
        assert.equal(path, articleArchiveRelativePath(live));
        return { permission: 'granted', found: true, value: clone(legacyArchive) };
      },
      async readWorkspaceAsset(_manifest, path) {
        const index = contents.findIndex(asset => asset.path === path);
        assert.ok(index >= 0, path);
        return { permission: 'granted', found: true, value: {
          schemaVersion: 1, kind: 'sci-logic-highlighter-workspace-asset',
          workspaceId: live.workspaceId, workspaceGeneration: live.workspaceGeneration,
          relativePath: path, revision: 40 + index, contentHash: String(index + 3).repeat(64),
          updatedAt: '2088-01-01T00:00:00.000Z', data: clone(contents[index].content) } };
      },
      async enqueueWorkspaceAsset(workspace, path, content, metadata) {
        queued.push(clone({ workspace, path, content, metadata }));
      },
      async enqueueJson(path, archive) {
        queuedArchives.push(clone({ path, archive }));
      }
    }, fetchImpl: async () => { throw new Error('This regression must remain offline'); } });
  const context = { trustedContentScript: true, senderTabId: 9, senderFrameId: 0,
    senderDocumentId: 'browser-document-five-store-fixture', senderUrl: live.canonicalUrl,
    assertTrustedOwnerCurrent: async () => {} };
  return { ...f, identity: live, router, context, queued, queuedArchives,
    scan() { return router.handle({ type: 'ARTICLE_WORKSPACE_SCAN_RESTORE', identity: live,
      operationNonce: NONCE }); },
    commit(scan) {
      assert.equal(scan.success, true, JSON.stringify(scan));
      const restore = scan.data.restore;
      return router.handle({ type: 'ARTICLE_WORKSPACE_COMMIT_PREPARED_RESTORE',
        planId: restore.restorePlanId, binding: { kind: 'workspace', current: live,
          documentId: DOCUMENT_ID, manifest: restore.manifest, match: restore.match,
          operationNonce: NONCE } }, context);
    } };
}
function assertSuccess(result) { assert.equal(result.success, true, JSON.stringify(result)); }
function normalizedAnnotations(value) {
  return normalizeDocumentRecord({ documentId: DOCUMENT_ID, annotations: value }).annotations;
}

test('absent local document receives annotations with the workspace in one transaction and returns actual row', async () => {
  const f = await fixture();
  const before = allRows(f.fake);
  const transactions = recordTransactions(f.fake);
  const scanned = await f.scan();
  assertSuccess(scanned);
  assert.deepEqual(allRows(f.fake), before, 'scan must not mutate any local store');
  assert.deepEqual(transactions[0], { names: FIVE_STORES, mode: 'readonly' });
  transactions.length = 0;
  const committed = await f.commit(scanned);
  assertSuccess(committed);
  assert.equal(committed.data.persistenceCommitted, true);
  assert.deepEqual(transactions.filter(call => call.mode === 'readwrite'),
    [{ names: FIVE_STORES, mode: 'readwrite' }]);
  const actual = await f.documents.getDocument(DOCUMENT_ID);
  assert.deepEqual(committed.data.document, actual);
  assert.deepEqual(actual.annotations, normalizedAnnotations([annotation()]));
  assert.equal(actual.workspaceId, f.identity.workspaceId);
  assert.equal(actual.documentHash, f.identity.documentHash);
  assert.deepEqual((await f.store.getAsset(f.identity.workspaceId, HIGHLIGHTS)).content,
    { annotations: [annotation()] });
  assert.ok(await f.store.getAsset(f.identity.workspaceId, EXTRA));
  assert.deepEqual(await f.documents.getDocument(OTHER_DOCUMENT), f.other);
  assert.deepEqual(allRows(f.fake).meta, before.meta);
  assert.equal((await f.documents.listDocumentIndex()).find(row => row.documentId === DOCUMENT_ID)
    .annotationCount, 1);
  // A later normal save reads these restored annotations, rather than []:
  await f.store.putAsset(f.identity.workspaceId, HIGHLIGHTS, { annotations: actual.annotations });
  assert.deepEqual((await f.store.getAsset(f.identity.workspaceId, HIGHLIGHTS)).content.annotations,
    actual.annotations);
});

test('semantically identical existing annotations are accepted after ordinary document normalization', async () => {
  const f = await fixture({ localAnnotations: [annotation()] });
  const original = await f.documents.getDocument(DOCUMENT_ID);
  const committed = await f.commit(await f.scan());
  assertSuccess(committed);
  assert.deepEqual(committed.data.document.annotations, original.annotations);
  assert.deepEqual(committed.data.document, await f.documents.getDocument(DOCUMENT_ID));
  assert.equal(committed.data.document.revision, original.revision + 1);
});

for (const [label, annotations] of [['different annotations', [annotation(2)]], ['explicit []', []]]) {
  test(`pre-scan ${label} conservatively rejects and preserves every local store`, async () => {
    const f = await fixture({ localAnnotations: annotations });
    const before = allRows(f.fake);
    const scanned = await f.scan();
    assert.equal(scanned.success, false);
    assert.equal(scanned.error.code, 'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
    assert.equal(scanned.data, undefined);
    assert.deepEqual(allRows(f.fake), before);
    assert.equal(f.queued.length, 0);
  });
}

for (const kind of ['annotations', 'metadata only']) {
  test(`document ${kind} written after scan blocks the entire prepared batch`, async () => {
    const f = await fixture({ localAnnotations: [annotation()] });
    const scanned = await f.scan();
    assertSuccess(scanned);
    const current = await f.documents.getDocument(DOCUMENT_ID);
    await f.documents.putDocument({ ...current,
      ...(kind === 'annotations' ? { annotations: [annotation(2, '人工晚写')] } :
        { unknownAfterScan: { nullable: null, text: 'preserve metadata' } }) });
    const before = allRows(f.fake);
    const committed = await f.commit(scanned);
    assert.equal(committed.success, false);
    assert.equal(committed.error.code, 'WORKSPACE_RESTORE_CONFLICT');
    assert.deepEqual(allRows(f.fake), before);
    assert.equal(f.queued.length, 0);
  });
}

test('legacy/archive.json documentRecord restores annotations and full future/unknown metadata', async () => {
  const legacyDocument = { documentId: DOCUMENT_ID, title: 'Legacy document',
    canonicalUrl: identity().canonicalUrl, annotations: [annotation()], revision: 900,
    updatedAt: '2099-01-01T00:00:00.000Z', studyType: 'observational',
    manualLabels: ['α-synuclein', 'p = 0.03'],
    futureSchemaState: { explicitlyEmpty: [], nested: { nullable: null, reviewed: false, text: '' } } };
  const f = await fixture({ assets: [{ path: 'legacy/archive.json',
    content: { schemaVersion: 1, documentRecord: legacyDocument } }] });
  const committed = await f.commit(await f.scan());
  assertSuccess(committed);
  const actual = await f.documents.getDocument(DOCUMENT_ID);
  assert.deepEqual(committed.data.document, actual);
  assert.deepEqual(actual.annotations, normalizedAnnotations(legacyDocument.annotations));
  assert.equal(actual.revision, 901);
  assert.ok(Date.parse(actual.updatedAt) > Date.parse(legacyDocument.updatedAt));
  assert.equal(actual.studyType, legacyDocument.studyType);
  assert.deepEqual(actual.manualLabels, legacyDocument.manualLabels);
  assert.deepEqual(actual.futureSchemaState, legacyDocument.futureSchemaState);
});

test('without an annotations-bearing asset, every local document byte stays unchanged', async () => {
  const f = await fixture({ localAnnotations: [annotation(2)], assets: [
    { path: EXTRA, content: { reviewed: true } }, { path: HIGHLIGHTS, content: { schemaVersion: 1 } }
  ] });
  const beforeDocuments = allRows(f.fake).documents;
  const committed = await f.commit(await f.scan());
  assertSuccess(committed);
  assert.equal(Object.hasOwn(committed.data, 'document'), false);
  assert.deepEqual(allRows(f.fake).documents, beforeDocuments);
  assert.ok(await f.store.getAsset(f.identity.workspaceId, EXTRA));
});

test('actual missing-manifest legacy readJson conversion commits its documentRecord to documents', async () => {
  const live = { ...await createArticleWorkspaceIdentity({
    canonicalUrl: 'https://example.org/legacy-atomic-document', title: 'Legacy atomic restore',
    contentHash: '4'.repeat(64) }), documentId: DOCUMENT_ID, documentHash: '5'.repeat(64),
    workspaceGeneration: 1 };
  const document = { documentId: DOCUMENT_ID, canonicalUrl: live.canonicalUrl,
    annotations: [annotation()], revision: 1200, updatedAt: '2097-01-01T00:00:00.000Z',
    unknownLegacyMetadata: { nullable: null, values: [], reviewed: false } };
  const legacyArchive = createArticleArchive({ identity: live, documentRecord: document,
    workspace: {}, savedAt: '2026-09-23T00:00:00.000Z' });
  const f = await fixture({ liveIdentity: live, legacyArchive });
  const before = allRows(f.fake);
  const scanned = await f.scan();
  assertSuccess(scanned);
  assert.equal(scanned.data.restore.match, 'legacy-imported');
  assert.equal(scanned.data.legacyPreserved, true);
  assert.deepEqual(allRows(f.fake), before);
  const committed = await f.commit(scanned);
  assertSuccess(committed);
  const actual = await f.documents.getDocument(DOCUMENT_ID);
  assert.deepEqual(committed.data.document, actual);
  assert.deepEqual(actual.annotations, normalizedAnnotations(document.annotations));
  assert.deepEqual(actual.unknownLegacyMetadata, document.unknownLegacyMetadata);
  assert.equal(actual.revision, 1201);
  assert.ok(Date.parse(actual.updatedAt) > Date.parse(document.updatedAt));
  assert.ok(await f.store.getAsset(live.workspaceId, 'legacy/archive.json'));
});

test('invalid incoming annotation rejects before any document or workspace partial write', async () => {
  const f = await fixture({ assets: [{ path: EXTRA, content: { reviewed: true } },
    { path: HIGHLIGHTS, content: { annotations: [{ ...annotation(), quote: '' }] } }] });
  const before = allRows(f.fake);
  const scanned = await f.scan();
  assert.equal(scanned.success, false);
  assert.deepEqual(allRows(f.fake), before);
  assert.equal(f.queued.length, 0);
});

test('matching annotations preserve existing future revision, timestamp and unknown document metadata', async () => {
  const unknown = { unknownField: { nullable: null, emptyText: '', emptyArray: [], reviewed: false },
    revision: 5000, updatedAt: '2098-01-01T00:00:00.000Z', studyType: 'observational' };
  const f = await fixture({ localAnnotations: [annotation()], localMetadata: unknown });
  const original = await f.documents.getDocument(DOCUMENT_ID);
  const committed = await f.commit(await f.scan());
  assertSuccess(committed);
  const actual = await f.documents.getDocument(DOCUMENT_ID);
  assert.deepEqual(committed.data.document, actual);
  assert.deepEqual(actual.unknownField, unknown.unknownField);
  assert.equal(actual.studyType, unknown.studyType);
  assert.equal(actual.revision, original.revision + 1);
  assert.ok(Date.parse(actual.updatedAt) > Date.parse(original.updatedAt));
});

for (const [label, legacyAnnotations] of [['different annotation', [annotation(2)]], ['explicit []', []]]) {
  test(`competing legacy and highlights assets with ${label} reject without choosing a source`, async () => {
    const f = await fixture({ assets: [
      { path: 'legacy/archive.json', content: { documentRecord: {
        documentId: DOCUMENT_ID, annotations: legacyAnnotations } } },
      { path: HIGHLIGHTS, content: { annotations: [annotation()] } },
      { path: EXTRA, content: { reviewed: true } }
    ] });
    const before = allRows(f.fake);
    const scanned = await f.scan();
    assert.equal(scanned.success, false);
    assert.equal(scanned.error.code, 'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
    assert.deepEqual(allRows(f.fake), before);
    assert.equal(f.queued.length, 0);
    assert.equal(f.queuedArchives.length, 0);
  });
}

test('legacy and highlights annotations equivalent after normalization are accepted together', async () => {
  const raw = [annotation()];
  const f = await fixture({ assets: [
    { path: 'legacy/archive.json', content: { documentRecord: {
      documentId: DOCUMENT_ID, annotations: raw, unknownMetadata: { empty: '', nullable: null } } } },
    { path: HIGHLIGHTS, content: { annotations: normalizedAnnotations(raw) } }
  ] });
  const committed = await f.commit(await f.scan());
  assertSuccess(committed);
  assert.deepEqual(committed.data.document.annotations, normalizedAnnotations(raw));
  assert.deepEqual(committed.data.document.unknownMetadata, { empty: '', nullable: null });
  assert.ok(await f.store.getAsset(f.identity.workspaceId, 'legacy/archive.json'));
  assert.ok(await f.store.getAsset(f.identity.workspaceId, HIGHLIGHTS));
});

function archiveFor(f, record) {
  return createArticleArchive({ identity: f.identity, documentRecord: {
    documentId: DOCUMENT_ID, canonicalUrl: f.identity.canonicalUrl, ...record
  }, workspace: {}, savedAt: '2026-09-23T00:00:00.000Z' });
}

test('new archive with no local document still saves and only enqueues the validated archive', async () => {
  const f = await fixture();
  const archive = archiveFor(f, { annotations: [annotation()] });
  const before = allRows(f.fake);
  const result = await f.router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive });
  assertSuccess(result);
  assert.equal(result.data.saved, true);
  assert.equal(result.data.queued, true);
  assert.deepEqual(f.queuedArchives, [{ path: articleArchiveRelativePath(archive), archive }]);
  assert.deepEqual(allRows(f.fake), before);
});

test('current archive annotations equivalent after normalization still save', async () => {
  const f = await fixture({ localAnnotations: [annotation()] });
  const original = await f.documents.getDocument(DOCUMENT_ID);
  const archive = archiveFor(f, { ...original, annotations: [annotation()] });
  assert.notDeepEqual(archive.documentRecord.annotations, original.annotations,
    'fixture must exercise normalization rather than identical raw objects');
  const before = allRows(f.fake);
  const result = await f.router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive });
  assertSuccess(result);
  assert.equal(f.queuedArchives.length, 1);
  assert.deepEqual(f.queuedArchives[0].archive, archive);
  assert.deepEqual(allRows(f.fake), before);
});

test('archive snapshot obtained before prepared commit cannot enqueue its old empty annotations afterward', async () => {
  const f = await fixture();
  const staleArchive = archiveFor(f, { annotations: [] });
  const committed = await f.commit(await f.scan());
  assertSuccess(committed);
  const before = allRows(f.fake);
  const queueBefore = clone(f.queued);
  const result = await f.router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive: staleArchive });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'ARTICLE_ARCHIVE_DOCUMENT_CONFLICT');
  assert.match(result.error.message, /旧快照/u, 'typed mapping must explain why the snapshot was rejected');
  assert.equal(f.queuedArchives.length, 0);
  assert.deepEqual(f.queued, queueBefore);
  assert.deepEqual(allRows(f.fake), before);
  // Reading the current record and constructing a fresh snapshot remains usable.
  const freshArchive = archiveFor(f, await f.documents.getDocument(DOCUMENT_ID));
  const fresh = await f.router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive: freshArchive });
  assertSuccess(fresh);
  assert.equal(f.queuedArchives.length, 1);
  assert.deepEqual(f.queuedArchives[0].archive.documentRecord.annotations,
    committed.data.document.annotations);
});
