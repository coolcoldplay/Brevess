const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
function declarations(file, boundary, names) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const end = source.indexOf(boundary);
  assert.ok(end > 0);
  return Function('require', '__dirname', source.slice(0, end) + `\nreturn { ${names} };`)(require, __dirname);
}
const setup = declarations('article-workspace-atomic-document-restore.test.js',
  "\ntest('document capture", 'fixture, input, DOCUMENT_ID, id, annotation');
const { createFakeHandleStore } = declarations('directory-sync.test.js',
  "\ntest('requests a stored", 'createFakeHandleStore');
const { createArticleArchive, articleArchiveRelativePath } = require('../core/article-archive.js');
const { createDirectorySync, createIndexedDbSyncQueue } = require('../core/directory-sync.js');
const { createIndexedDbDocumentStore } = require('../core/document-store.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture() {
  const f = await setup.fixture();
  const handles = createFakeHandleStore();
  const queue = createIndexedDbSyncQueue(f.fake.indexedDb);
  const sync = createDirectorySync({ handleStore: handles, queueStore: queue });
  const archive = record => createArticleArchive({ documentId: setup.DOCUMENT_ID,
    canonicalUrl: 'https://example.org/atomic', title: 'Queue ordering', documentRecord: record,
    revision: 20, savedAt: '2091-01-01T00:00:00.000Z' });
  const old = archive(f.original);
  const relativePath = articleArchiveRelativePath(old);
  const baseline = await f.store.captureRestoreBaseline(setup.id, { documentId: setup.DOCUMENT_ID });
  return { ...f, handles, queue, sync, archive, old, relativePath,
    restore: () => f.store.commitRestoreIfUnchanged(setup.input(baseline)) };
}

test('archive enqueue validates documents in one IndexedDB transaction scope as queue put', async () => {
  const f = await fixture();
  const calls = [];
  const original = f.fake.database.transaction.bind(f.fake.database);
  f.fake.database.transaction = (names, mode) => {
    calls.push({ names: Array.isArray(names) ? [...names].sort() : [names], mode });
    return original(names, mode);
  };
  await f.sync.enqueueJson(f.relativePath, f.old);
  assert.ok(calls.some(call => call.mode === 'readwrite' &&
    JSON.stringify(call.names) === JSON.stringify(['documents', 'syncQueue'])));
  await f.restore();
  await assert.rejects(f.sync.enqueueJson(f.relativePath, f.old), /ARTICLE_ARCHIVE_DOCUMENT_CONFLICT/);
});

test('new sync/queue instances preserve stale payload as an observable conflict after restore', async () => {
  const f = await fixture();
  await f.sync.enqueueJson(f.relativePath, f.old);
  await f.restore();
  const queue = createIndexedDbSyncQueue(f.fake.indexedDb);
  const sync = createDirectorySync({ handleStore: f.handles, queueStore: queue });
  const result = await sync.flush();
  assert.equal(result.conflicts, 1);
  assert.equal(result.failed, 0);
  assert.equal(f.handles.has('Brevess/' + f.relativePath), false);
  const meta = await queue.getMeta();
  assert.equal(meta.conflictCount, 1);
  assert.equal(JSON.parse(f.handles.readText('Brevess/' + meta.lastConflict.conflictPath))
    .documentRecord.annotations.length, 0);
  assert.equal((await queue.getAll()).length, 0);
  assert.equal((await f.documents.getDocument(setup.DOCUMENT_ID)).annotations.length, 1);
});

test('conflict write failure keeps the complete pending archive for retry', async () => {
  const f = await fixture();
  await f.sync.enqueueJson(f.relativePath, f.old);
  await f.restore();
  f.handles.failNextWrites(10);
  const result = await f.sync.flush();
  assert.equal(result.failed, 1);
  assert.match(result.failedPath, /articles/);
  assert.equal((await f.queue.getAll()).length, 1);
  assert.deepEqual(JSON.parse((await f.queue.getAll())[0].content).documentRecord.annotations, []);
});

test('prepared durable commit waits for an already active archive close across separate instances', async () => {
  const f = await fixture();
  await f.sync.enqueueJson(f.relativePath, f.old);
  f.handles.pauseNextWrite('Brevess/' + f.relativePath);
  const flushing = f.sync.flush();
  await f.handles.waitForPausedWrite();
  let committed = false;
  const restoring = f.restore().then(value => { committed = true; return value; });
  try {
    for (let i = 0; i < 8; i++) await tick();
    assert.equal(committed, false, 'restore must not acknowledge durable commit before old close');
  } finally { f.handles.releasePausedWrite(); }
  assert.equal((await flushing).written, 1);
  await restoring;
  assert.equal(committed, true);
  await assert.rejects(f.sync.enqueueJson(f.relativePath, f.old), /ARTICLE_ARCHIVE_DOCUMENT_CONFLICT/);
});

test('normal edit and explicit clear save successfully; unchanged old revision semantics survive', async () => {
  const f = await fixture();
  await f.restore();
  const edited = await f.documents.upsertAnnotation(setup.DOCUMENT_ID, setup.annotation(2, 'New note'));
  await f.sync.enqueueJson(f.relativePath, f.archive(edited));
  assert.equal((await f.sync.flush()).failed, 0);
  assert.equal(JSON.parse(f.handles.readText('Brevess/' + f.relativePath)).documentRecord.annotations.length, 2);
  const cleared = await f.documents.clearAnnotations(setup.DOCUMENT_ID);
  await f.sync.enqueueJson(f.relativePath, { ...f.archive(cleared), revision: 21 });
  assert.equal((await f.sync.flush()).failed, 0);
  assert.deepEqual(JSON.parse(f.handles.readText('Brevess/' + f.relativePath)).documentRecord.annotations, []);
});

test('ordinary document writes share close ordering, while another document remains independent', async () => {
  const f = await fixture();
  await f.sync.enqueueJson(f.relativePath, f.old);
  f.handles.pauseNextWrite('Brevess/' + f.relativePath);
  const flushing = f.sync.flush();
  await f.handles.waitForPausedWrite();
  const documents = createIndexedDbDocumentStore(f.fake.indexedDb);
  let edited = false;
  const editing = documents.upsertAnnotation(setup.DOCUMENT_ID, setup.annotation()).then(() => { edited = true; });
  try {
    await documents.putDocument({ documentId: 'other', annotations: [] });
    for (let i = 0; i < 4; i++) await tick();
    assert.equal(edited, false);
  } finally { f.handles.releasePausedWrite(); }
  await flushing;
  await editing;
});

test('newer disk importer can write a document outside the lock; relock preserves stale queued payload',
  { timeout: 3000 }, async () => {
    const f = await fixture();
    await f.sync.enqueueJson(f.relativePath, f.old);
    const newer = { ...f.archive({ ...f.original, annotations: [setup.annotation()] }), revision: 21 };
    f.handles.writeText('Brevess/' + f.relativePath, JSON.stringify(newer));
    let calls = 0;
    const result = await f.sync.flush(async (relativePath, archive) => {
      calls++;
      assert.equal(relativePath, f.relativePath);
      await f.documents.putDocument(archive.documentRecord);
      return { imported: true };
    });
    assert.equal(calls, 1);
    assert.equal(result.imported, 1);
    assert.equal(result.conflicts, 1);
    assert.equal(result.failed, 0);
    assert.equal((await f.documents.getDocument(setup.DOCUMENT_ID)).annotations.length, 1);
    assert.equal(JSON.parse(f.handles.readText('Brevess/' + f.relativePath)).revision, 21);
    assert.deepEqual(JSON.parse(f.handles.readText('Brevess/' + (await f.queue.getMeta())
      .lastConflict.conflictPath)).documentRecord.annotations, []);
  });

test('importer replacement of a pending revision is not acknowledged by the older captured item',
  { timeout: 3000 }, async () => {
    const f = await fixture();
    await f.sync.enqueueJson(f.relativePath, f.old);
    const newer = { ...f.old, revision: 21 };
    f.handles.writeText('Brevess/' + f.relativePath, JSON.stringify(newer));
    const result = await f.sync.flush(async () => {
      await f.sync.enqueueJson(f.relativePath, { ...f.old, revision: 22 });
      return { imported: true };
    });
    assert.equal(result.failed, 0);
    assert.equal((await f.queue.get(f.relativePath)).revision, 22);
    assert.equal(JSON.parse(f.handles.readText('Brevess/' + f.relativePath)).revision, 21);
    assert.equal((await f.sync.flush()).written, 1);
    assert.equal(JSON.parse(f.handles.readText('Brevess/' + f.relativePath)).revision, 22);
  });

test('failure releases archive coordination and leaves a retryable complete pending item', async () => {
  const f = await fixture();
  await f.sync.enqueueJson(f.relativePath, f.old);
  f.handles.failNextWrites(3);
  assert.equal((await f.sync.flush()).failed, 1);
  assert.equal((await f.queue.getAll()).length, 1);
  assert.equal((await f.restore()).committed, true);
  f.handles.failNextWrites(0);
  assert.equal((await f.sync.flush()).conflicts, 1);
});

test('missing document remains distinct from an existing explicitly empty record', async () => {
  const f = await fixture();
  f.fake.stores.get('documents').delete(setup.DOCUMENT_ID);
  const saved = { ...f.old, documentRecord: { ...f.old.documentRecord, annotations: [setup.annotation()] } };
  await f.sync.enqueueJson(f.relativePath, saved);
  assert.equal((await f.sync.flush()).written, 1);
  await f.documents.putDocument({ ...f.original, annotations: [] });
  await assert.rejects(f.sync.enqueueJson(f.relativePath, saved), /ARTICLE_ARCHIVE_DOCUMENT_CONFLICT/);
});

test('a different existing conflict is never overwritten by another database queue sequence', async () => {
  const f = await fixture();
  await f.sync.enqueueJson(f.relativePath, f.old);
  const item = await f.queue.get(f.relativePath);
  const conflictPath = 'Brevess/conflicts/' + f.relativePath.replace(/\.json$/, `.r${item.revision}.archive-q${item.queueRevision}.json`);
  const preserved = '{"separateArchive":"must survive unchanged"}';
  f.handles.writeText(conflictPath, preserved);
  await f.restore();
  const result = await f.sync.flush();
  assert.equal(result.failed, 1);
  assert.equal(result.errorCode, 'ARTICLE_ARCHIVE_CONFLICT_EXISTS');
  assert.equal(f.handles.readText(conflictPath), preserved);
  assert.equal((await f.queue.get(f.relativePath)).content, item.content);
  assert.equal((await f.queue.getMeta()).conflictCount, 0);
});

test('a queue transaction abort rejects once, rolls back the pending row, and permits retry', async () => {
  const f = await fixture();
  f.fake.failNextPutFor('syncQueue');
  await assert.rejects(f.sync.enqueueJson(f.relativePath, f.old), /simulated syncQueue write failure/);
  assert.equal((await f.queue.getAll()).length, 0);
  await f.sync.enqueueJson(f.relativePath, f.old);
  assert.equal((await f.sync.flush()).written, 1);
});

for (const phase of ['enqueue', 'flush guard']) {
  test(`an early document request failure consumes transaction rejection during ${phase}`, async () => {
    const f = await fixture();
    if (phase === 'flush guard') await f.sync.enqueueJson(f.relativePath, f.old);
    const item = phase === 'flush guard' ? await f.queue.get(f.relativePath) : null;
    const original = f.fake.stores.get('documents').get(setup.DOCUMENT_ID);
    // The reused IDB simulator structured-clones this row inside its real request
    // callback. Inject a request error before transaction completion, not a false
    // successful document value or a replacement for any business comparison.
    f.fake.stores.get('documents').set(setup.DOCUMENT_ID, {
      get documentId() { throw new Error('simulated document request failure'); }
    });
    await assert.rejects(phase === 'enqueue'
      ? f.sync.enqueueJson(f.relativePath, f.old)
      : f.queue.withCurrentArchive(item, () => assert.fail('must not perform file writes')),
    /simulated document request failure/);
    f.fake.stores.get('documents').set(setup.DOCUMENT_ID, original);
    if (phase === 'enqueue') await f.sync.enqueueJson(f.relativePath, f.old);
    assert.equal((await f.sync.flush()).written, 1);
  });
}
