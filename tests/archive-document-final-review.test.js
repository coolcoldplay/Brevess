const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Reuse declarations only; no old test is registered or changed.
function declarations(file, boundaryText, names) {
  const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const boundary = text.indexOf(boundaryText);
  assert.ok(boundary > 0, file);
  return Function('require', '__dirname', text.slice(0, boundary) +
    `\nreturn { ${names.join(', ')} };`)(require, __dirname);
}
const page = declarations('archive-page-restore-review.test.js',
  "\ntest('prepared partial candidate", ['harness', 'functionSource', 'error']);
const backend = declarations('archive-prepared-document.test.js',
  "\ntest('absent local document", ['fixture', 'DOCUMENT_ID', 'annotation']);
const { createMemoryDocumentStore } = require('../core/document-store.js');
const { createDocumentId } = require('../core/manual-annotations.js');
const { createArticleArchive } = require('../core/article-archive.js');
const { createArticleWorkspaceIdentity } = require('../core/article-workspace.js');
const clone = value => structuredClone(value);
const DOC = backend.DOCUMENT_ID;
const HASH = '2'.repeat(64);
const URL = 'https://example.org/paper';
const highlights = record => ({ annotations: clone(record.annotations) });
const target = record => ({ documentId: record.documentId,
  documentHash: record.documentHash, canonicalUrl: record.canonicalUrl });

async function storedDocument() {
  const store = createMemoryDocumentStore();
  const record = await store.prepareDocument({ documentId: DOC,
    documentHash: HASH, canonicalUrl: URL, title: 'Paper', revision: 6,
    annotations: [backend.annotation()] });
  return { store, record };
}

function scopedPage(record) {
  const h = page.harness();
  h.state.currentManualDocument = { documentId: record.documentId, record: clone(record) };
  h.state.currentArticleWorkspace = { workspaceId: 'paper', workspaceGeneration: 1,
    canonicalUrl: record.canonicalUrl, contentHash: record.documentHash };
  h.state.articleWorkspaceMutationTail = Promise.resolve();
  h.state.articleWorkspaceRestorePersistenceGate = { allows: () => false };
  h.state.chrome = { runtime: { sendMessage: async message => {
    h.saved.push(clone(message)); return { success: true, data: { saved: true } };
  } } };
  h.state.ensureCurrentArticleWorkspace = async () => h.state.currentArticleWorkspace;
  vm.runInContext(page.functionSource('persistWorkspaceAssetCheckpoint'), h.state);
  vm.runInContext(page.functionSource('buildCurrentArticleArchive'), h.state);
  h.state.retainCommittedArticleWorkspaceDocument(record, { current: h.state.currentArticleWorkspace });
  h.save = content => h.state.persistWorkspaceAssetCheckpoint(
    'annotations/highlights.json', content, { force: true });
  return h;
}

test('missing or foreign current document fails closed; valid record and unrelated assets remain usable', async () => {
  const { record } = await storedDocument();
  const h = scopedPage(record);
  for (const wrong of [null, { ...record, documentId: `sha256:${'e'.repeat(64)}` },
    { ...record, documentHash: '3'.repeat(64) }, { ...record, canonicalUrl: 'https://example.org/other' },
    { ...record, revision: record.revision - 1 }]) {
    h.state.currentManualDocument = wrong ? { documentId: wrong.documentId, record: wrong } : null;
    await assert.rejects(h.save(highlights(record)), /DOCUMENT_PENDING/);
  }
  await h.state.persistWorkspaceAssetCheckpoint('ui/state.json', {}, { force: true });
  h.state.currentManualDocument = { documentId: record.documentId, record };
  await h.save(highlights(record));
  assert.deepEqual(h.saved.map(value => value.relativePath), ['ui/state.json', 'annotations/highlights.json']);
});

test('missing committed document and each mismatched identity reject before projection', async () => {
  const { record } = await storedDocument();
  for (const wrong of [null, ...['documentId', 'documentHash', 'canonicalUrl']
    .map(key => ({ ...record, [key]: 'wrong' }))]) {
    const h = scopedPage(record);
    const before = clone(h.state.currentManualDocument);
    assert.throws(() => h.state.prepareCommittedArticleWorkspaceDocument({
      committedDocumentRequired: true, committedDocument: wrong,
      committedDocumentTarget: target(record)
    }, new Map([['annotations/highlights.json', highlights(record)]])), /DOCUMENT_UNCONFIRMED/);
    assert.deepEqual(h.state.currentManualDocument, before);
    assert.equal(h.state.rendered, undefined);
  }
});

test('actual postcommit guard rejection recovers through committed projection and real later edit/clear', async () => {
  const { store, record } = await storedDocument();
  const h = scopedPage(record);
  h.state.currentManualDocument.record = { ...record, revision: record.revision - 1, annotations: [] };
  let guarded = 0;
  const result = await h.state.commitArticleWorkspaceRestoreTransaction({
    restore: { restorePlanId: 'review-plan' }, manualBaseline: {}
  }, { current: h.state.currentArticleWorkspace, ...target(record) }, 1, {
    assertTarget: async () => {},
    assertCurrentSync: () => { if (++guarded > 1) throw page.error('DRAFT_PENDING'); },
    retainCommittedDocument: h.state.retainCommittedArticleWorkspaceDocument,
    commitPrepared: async () => ({ committed: true, persistenceCommitted: true,
      document: record, restore: { assets: [] } }),
    apply: () => assert.fail('a rejected page must not be projected')
  });
  assert.equal(result.workspaceApplied, false);
  assert.equal(result.persistenceCommitted, true);
  await assert.rejects(h.save({ annotations: [] }), /DOCUMENT_PENDING/);
  assert.throws(() => h.state.buildCurrentArticleArchive(), /DOCUMENT_PENDING/);
  const projection = h.state.prepareCommittedArticleWorkspaceDocument({
    committedDocumentRequired: true, committedDocument: await store.getDocument(DOC),
    committedDocumentTarget: target(record)
  }, new Map([['annotations/highlights.json', highlights(record)]]));
  h.state.projectCommittedArticleWorkspaceDocument(projection);
  assert.equal(h.saved.length, 0, 'synchronous projection must not write documents or workspace');
  await h.save(highlights(h.state.currentManualDocument.record));
  const edited = await store.upsertAnnotation(DOC, backend.annotation(1, '真实后续修改'));
  h.state.currentManualDocument.record = edited;
  await assert.rejects(h.save(highlights(record)), /DOCUMENT_PENDING/);
  await h.save(highlights(edited));
  const cleared = await store.clearAnnotations(DOC);
  h.state.currentManualDocument.record = cleared;
  await h.save(highlights(cleared));
  assert.equal(h.saved.length, 3);
  assert.deepEqual(h.saved[2].content.annotations, []);
});

test('writer checks a previously unavailable owner after await before sending', async () => {
  const { record } = await storedDocument();
  const h = scopedPage(record);
  const owner = h.state.currentArticleWorkspace;
  h.state.currentArticleWorkspace = null;
  h.state.currentManualDocument.record = { ...record, revision: record.revision - 1, annotations: [] };
  h.state.ensureCurrentArticleWorkspace = async () => owner;
  await assert.rejects(h.save({ annotations: [] }), /DOCUMENT_PENDING/);
  assert.equal(h.saved.length, 0);
});

test('normal reprepare with a newer body hash and preserved annotations does not permanently block saving', async () => {
  // createDocumentId fingerprints only the first 8000 normalized body characters.
  // A late article paragraph can therefore change hashes without changing this ID.
  const prefix = 'Scientific paragraph unchanged. '.repeat(300);
  const beforeInput = { canonicalUrl: URL, title: 'Paper', paragraphs: [{ text: prefix }] };
  const afterInput = { ...beforeInput, paragraphs: [{ text: prefix + ' New final paragraph.' }] };
  const documentId = await createDocumentId(beforeInput);
  assert.equal(await createDocumentId(afterInput), documentId);
  const before = await createArticleWorkspaceIdentity({ canonicalUrl: URL, content: prefix });
  const after = await createArticleWorkspaceIdentity({ canonicalUrl: URL, content: afterInput.paragraphs[0].text });
  const store = createMemoryDocumentStore();
  const record = await store.prepareDocument({ documentId, canonicalUrl: URL, title: 'Paper',
    documentHash: before.contentHash, annotations: [backend.annotation()], revision: 6 });
  const h = scopedPage(record);
  assert.equal(before.workspaceId, after.workspaceId);
  assert.notEqual(before.contentHash, after.contentHash);
  const prepared = await store.prepareDocument({ ...record, annotations: [], documentHash: after.contentHash });
  assert.ok(prepared.revision > record.revision);
  assert.deepEqual(prepared.annotations, record.annotations);
  assert.ok(prepared.documentHashes.includes(record.documentHash));
  h.state.currentManualDocument.record = prepared;
  h.state.currentArticleWorkspace.contentHash = after.contentHash;
  await h.save(highlights(prepared));
  assert.equal(h.saved.length, 1);
});

test('hash evolution requires both a newer authoritative revision and retained old hash provenance', async () => {
  const { record } = await storedDocument();
  const h = scopedPage(record);
  for (const wrong of [
    { ...record, documentHash: '3'.repeat(64), revision: record.revision + 1, documentHashes: [] },
    { ...record, documentHash: '3'.repeat(64), documentHashes: [record.documentHash] },
    { ...record, annotations: [], documentHash: record.documentHash }
  ]) {
    h.state.currentManualDocument.record = wrong;
    await assert.rejects(h.save(highlights(wrong)), /DOCUMENT_PENDING/);
  }
  assert.equal(h.saved.length, 0);
});

function archiveFor(f, record) {
  return createArticleArchive({ identity: f.identity,
    documentRecord: { documentId: DOC, canonicalUrl: f.identity.canonicalUrl,
      documentHash: f.identity.documentHash, ...record }, workspace: {}, revision: 1 });
}

test('backend re-read rejects an old archive after commit and accepts real subsequent edit/clear', async () => {
  const f = await backend.fixture();
  const old = archiveFor(f, { annotations: [] });
  const committed = await f.commit(await f.scan());
  assert.equal(committed.success, true, JSON.stringify(committed));
  const stale = await f.router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive: old });
  assert.equal(stale.error?.code, 'ARTICLE_ARCHIVE_DOCUMENT_CONFLICT');
  const edited = await f.documents.upsertAnnotation(DOC, backend.annotation(1, '新修改'));
  assert.equal((await f.router.handle({ type: 'ARTICLE_ARCHIVE_SAVE',
    archive: archiveFor(f, edited) })).success, true);
  const cleared = await f.documents.clearAnnotations(DOC);
  assert.equal((await f.router.handle({ type: 'ARTICLE_ARCHIVE_SAVE',
    archive: archiveFor(f, cleared) })).success, true);
  assert.deepEqual(f.queuedArchives[1].archive.documentRecord.annotations, []);
});

test('archive read begun before prepared commit cannot enqueue old annotations after that commit', {
  todo: 'Artificial getter-delivery delay demonstrates an unclosed dependency, not native IDB reachability; retain the assertion pending a real sync_queue/flush scheduling fixture.'
}, async () => {
  const f = await backend.fixture();
  const scanned = await f.scan();
  assert.equal(scanned.success, true, JSON.stringify(scanned));
  const old = archiveFor(f, { annotations: [] });
  const actualGet = f.documents.getDocument.bind(f.documents);
  let releaseRead;
  let notifyRead;
  const readObserved = new Promise(resolve => { notifyRead = resolve; });
  const readRelease = new Promise(resolve => { releaseRead = resolve; });
  // Delay delivery of one genuine store snapshot, not the comparison or payload.
  f.documents.getDocument = async id => {
    const snapshot = await actualGet(id);
    f.documents.getDocument = actualGet;
    notifyRead();
    await readRelease;
    return snapshot;
  };
  const saving = f.router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive: old });
  await readObserved;
  const committed = await f.commit(scanned);
  assert.equal(committed.success, true, JSON.stringify(committed));
  assert.equal((await actualGet(DOC)).annotations.length, 1);
  releaseRead();
  const result = await saving;
  assert.equal(result.success, false,
    `old archive was queued after durable commit: ${JSON.stringify(result)}`);
  assert.equal(f.queuedArchives.length, 0);
});
