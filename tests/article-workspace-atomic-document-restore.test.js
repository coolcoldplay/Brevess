const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
require('../core/category-store.js');
require('../core/adaptive-catalog.js');
require('../core/manual-annotations.js');
require('../core/user-data-database.js');
const { createIndexedDbDocumentStore, normalizeDocumentRecord, finalizeDocumentRecordForWrite } =
  require('../core/document-store.js');
const source = readFileSync(join(__dirname, 'article-workspace-atomic-restore.test.js'), 'utf8');
const boundary = source.indexOf("\ntest('capture returns");
assert.ok(boundary > 0);
const setup = Function('require', '__dirname', source.slice(0, boundary) +
  '\nreturn { fixture, identity, id, A, B, request, snapshot, recordTransactions, expectedStores };')(
  require, __dirname);
const { identity, id, A, request, expectedStores, recordTransactions } = setup;
const DOCUMENT_ID = `sha256:${'d'.repeat(64)}`;
const OTHER_DOCUMENT = `sha256:${'e'.repeat(64)}`;
const FIVE_STORES = [...expectedStores, 'documents'].sort();

function annotation(number = 1, note = '恢复后保留：并未增加') {
  const quote = `Scientific quote ${number}`;
  return { annotationId: `annotation-${number}`, categoryId: 'result',
    categorySnapshot: { name: '结果陈述', color: '#FFE66D' }, quote,
    prefix: '', suffix: '', sectionTitle: 'Results', blockFingerprint: `block-${number}`,
    startOffset: 0, endOffset: quote.length, note };
}
async function fixture({ missing = false } = {}) {
  const base = await setup.fixture();
  const documents = createIndexedDbDocumentStore(base.fake.indexedDb);
  let original = null;
  if (!missing) original = await documents.putDocument({ documentId: DOCUMENT_ID,
    title: 'Original document', canonicalUrl: identity().canonicalUrl, annotations: [],
    revision: 5, updatedAt: '2090-01-01T00:00:00.000Z',
    extensionState: { reviewed: false, empty: '', nullable: null, customToken: 'scientific-id' } });
  const other = await documents.putDocument({ documentId: OTHER_DOCUMENT,
    title: 'Unrelated document', annotations: [annotation(99)] });
  base.fake.stores.get('meta').set('unrelated-meta', { key: 'unrelated-meta', value: 7 });
  return { ...base, documents, original, other };
}
function allRows(fake) {
  return Object.fromEntries([...expectedStores, 'documents', 'meta'].map(name => [name,
    [...fake.stores.get(name)].map(([key, value]) => [key, structuredClone(value)])]));
}
function input(baseline, overrides = {}) {
  return request(baseline, { document: {
    ...(baseline.document || {}), documentId: DOCUMENT_ID,
    title: ' Restored   document ', annotations: [annotation()], revision: 10,
    extensionState: { reviewed: false, empty: '', nullable: null, customToken: 'scientific-id' }
  }, ...overrides });
}

test('document capture is optional and reads a complete detached record in the same transaction', async () => {
  const f = await fixture();
  const calls = recordTransactions(f.fake);
  const legacy = await f.store.captureRestoreBaseline(id);
  assert.equal(Object.hasOwn(legacy, 'documentId'), false);
  assert.equal(Object.hasOwn(legacy, 'document'), false);
  const baseline = await f.store.captureRestoreBaseline(id, { documentId: DOCUMENT_ID });
  assert.deepEqual(calls, [{ names: expectedStores, mode: 'readonly' },
    { names: FIVE_STORES, mode: 'readonly' }]);
  assert.equal(baseline.documentId, DOCUMENT_ID);
  assert.deepEqual(baseline.document, f.original);
  baseline.document.extensionState.empty = 'outside mutation';
  assert.deepEqual(await f.documents.getDocument(DOCUMENT_ID), f.original);
});

test('restored document, annotations, workspace assets and turns commit in one transaction', async () => {
  const f = await fixture();
  const baseline = await f.store.captureRestoreBaseline(id, { documentId: DOCUMENT_ID });
  const candidate = input(baseline);
  const beforeInput = structuredClone(candidate);
  const expectedDocument = finalizeDocumentRecordForWrite(
    normalizeDocumentRecord(candidate.document), f.original);
  const calls = recordTransactions(f.fake);
  const saved = await f.store.commitRestoreIfUnchanged(candidate);
  assert.deepEqual(calls, [{ names: FIVE_STORES, mode: 'readwrite' }]);
  assert.deepEqual(saved.document, expectedDocument);
  assert.deepEqual(candidate, beforeInput);
  assert.deepEqual(await f.documents.getDocument(DOCUMENT_ID), expectedDocument);
  assert.deepEqual(await f.documents.getDocument(OTHER_DOCUMENT), f.other);
  assert.deepEqual(f.fake.stores.get('meta').get('unrelated-meta'), { key: 'unrelated-meta', value: 7 });
  assert.equal((await f.documents.listDocumentIndex()).find(row => row.documentId === DOCUMENT_ID)
    .annotationCount, 1);
  // The ordinary later save reads the restored documents row instead of []:
  // this is the persistence leg of the page's observed highlights-loss defect.
  const current = await f.documents.getDocument(DOCUMENT_ID);
  await f.store.putAsset(id, 'annotations/highlights.json', { annotations: current.annotations });
  assert.deepEqual((await f.store.getAsset(id, 'annotations/highlights.json')).content.annotations,
    expectedDocument.annotations);
});

test('a captured absent document can be created without changing other document records', async () => {
  const f = await fixture({ missing: true });
  const baseline = await f.store.captureRestoreBaseline(id, { documentId: DOCUMENT_ID });
  assert.equal(baseline.document, null);
  const saved = await f.store.commitRestoreIfUnchanged(input(baseline));
  assert.equal(saved.document.documentId, DOCUMENT_ID);
  assert.equal(saved.document.revision, 11);
  assert.deepEqual(await f.documents.getDocument(OTHER_DOCUMENT), f.other);
});

test('explicit empty fields and unknown JSON metadata follow the existing document normalizer', async () => {
  const f = await fixture();
  await f.documents.upsertAnnotation(DOCUMENT_ID, annotation());
  const baseline = await f.store.captureRestoreBaseline(id, { documentId: DOCUMENT_ID });
  const candidate = { documentId: DOCUMENT_ID, annotations: [], title: '', studyType: null,
    opaque: { token: 'a scientific token, not a credential', empty: '', nil: null,
      zero: 0, disabled: false, absent: undefined } };
  const result = await f.store.commitRestoreIfUnchanged(input(baseline, { document: candidate }));
  const expected = finalizeDocumentRecordForWrite(candidate, baseline.document);
  assert.deepEqual(result.document, expected);
  assert.deepEqual(await f.documents.getDocument(DOCUMENT_ID), expected);
});

test('omitting the document candidate preserves its row while retaining the captured document guard', async () => {
  const f = await fixture();
  const baseline = await f.store.captureRestoreBaseline(id, { documentId: DOCUMENT_ID });
  const saved = await f.store.commitRestoreIfUnchanged(request(baseline));
  assert.equal(Object.hasOwn(saved, 'document'), false);
  assert.deepEqual(await f.documents.getDocument(DOCUMENT_ID), f.original);
  const next = await f.store.captureRestoreBaseline(id, { documentId: DOCUMENT_ID });
  await f.documents.upsertAnnotation(DOCUMENT_ID, annotation());
  const before = allRows(f.fake);
  await assert.rejects(() => f.store.commitRestoreIfUnchanged(request(next)),
    { code: 'WORKSPACE_RESTORE_CONFLICT' });
  assert.deepEqual(allRows(f.fake), before);
});

for (const [name, mutate] of [
  ['annotation added', f => f.documents.upsertAnnotation(DOCUMENT_ID, annotation(2))],
  ['annotations explicitly cleared', f => f.documents.clearAnnotations(DOCUMENT_ID)],
  ['study type changed', f => f.documents.setStudyType(DOCUMENT_ID, 'clinical_trial')],
  ['metadata changed', f => f.documents.prepareDocument({ documentId: DOCUMENT_ID, title: 'New human title' })]
]) {
  test(`document change after capture aborts the entire restore: ${name}`, async () => {
    const f = await fixture();
    await f.documents.upsertAnnotation(DOCUMENT_ID, annotation(1));
    const baseline = await f.store.captureRestoreBaseline(id, { documentId: DOCUMENT_ID });
    await mutate(f);
    const before = allRows(f.fake);
    await assert.rejects(() => f.store.commitRestoreIfUnchanged(input(baseline)),
      { code: 'WORKSPACE_RESTORE_CONFLICT' });
    assert.deepEqual(allRows(f.fake), before);
  });
}

test('full document comparison detects same-revision content and undefined-property changes', async () => {
  for (const edit of [record => { record.annotations = [annotation(2)]; },
    record => { record.extensionState.added = undefined; }]) {
    const f = await fixture();
    const baseline = await f.store.captureRestoreBaseline(id, { documentId: DOCUMENT_ID });
    const changed = structuredClone(f.original);
    edit(changed);
    f.fake.stores.get('documents').set(DOCUMENT_ID, changed);
    const before = allRows(f.fake);
    await assert.rejects(() => f.store.commitRestoreIfUnchanged(input(baseline)),
      { code: 'WORKSPACE_RESTORE_CONFLICT' });
    assert.deepEqual(allRows(f.fake), before);
  }
});

test('creating a formerly absent document after capture aborts all other writes', async () => {
  const f = await fixture({ missing: true });
  const baseline = await f.store.captureRestoreBaseline(id, { documentId: DOCUMENT_ID });
  await f.documents.upsertAnnotation(DOCUMENT_ID, annotation(2));
  const before = allRows(f.fake);
  await assert.rejects(() => f.store.commitRestoreIfUnchanged(input(baseline)),
    { code: 'WORKSPACE_RESTORE_CONFLICT' });
  assert.deepEqual(allRows(f.fake), before);
});

test('a document candidate needs the matching explicit document baseline and valid existing schema', async () => {
  const f = await fixture();
  const baseline = await f.store.captureRestoreBaseline(id, { documentId: DOCUMENT_ID });
  const oldBaseline = await f.store.captureRestoreBaseline(id);
  const cases = [input(oldBaseline), input(baseline, { document: null }),
    input(baseline, { document: { documentId: OTHER_DOCUMENT, annotations: [] } }),
    input(baseline, { document: { documentId: DOCUMENT_ID, annotations: {} } }),
    input(baseline, { document: { documentId: DOCUMENT_ID, annotations: [annotation(), annotation()] } }),
    input({ ...baseline, documentId: OTHER_DOCUMENT }), input({ ...baseline, document: undefined })];
  const before = allRows(f.fake);
  for (const candidate of cases) {
    await assert.rejects(() => f.store.commitRestoreIfUnchanged(candidate));
    assert.deepEqual(allRows(f.fake), before);
  }
});

for (const name of ['documents', 'workspaceAssets', 'workspaceTurns', 'workspaces']) {
  test(`a ${name} write failure rolls back document and all workspace records`, async () => {
    const f = await fixture();
    const baseline = await f.store.captureRestoreBaseline(id, { documentId: DOCUMENT_ID });
    const before = allRows(f.fake);
    f.fake.failNextPutFor(name);
    await assert.rejects(() => f.store.commitRestoreIfUnchanged(input(baseline)),
      new RegExp(`simulated ${name} write failure`));
    assert.deepEqual(allRows(f.fake), before);
  });
}

test('an annotation write queued first wins and makes restoration reject', async () => {
  const f = await fixture();
  const baseline = await f.store.captureRestoreBaseline(id, { documentId: DOCUMENT_ID });
  const results = await Promise.allSettled([
    f.documents.upsertAnnotation(DOCUMENT_ID, annotation(2, 'New human note')),
    f.store.commitRestoreIfUnchanged(input(baseline))
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, 'WORKSPACE_RESTORE_CONFLICT');
  assert.equal((await f.store.getAsset(id, A)).revision, baseline.assets.find(row => row.relativePath === A).revision);
  assert.equal((await f.documents.getDocument(DOCUMENT_ID)).annotations[0].note, 'New human note');
});

test('an annotation write queued after restore sees and preserves the restored document', async () => {
  const f = await fixture();
  const baseline = await f.store.captureRestoreBaseline(id, { documentId: DOCUMENT_ID });
  const [restored, edited] = await Promise.all([
    f.store.commitRestoreIfUnchanged(input(baseline)),
    f.documents.upsertAnnotation(DOCUMENT_ID, annotation(2, 'Later human note'))
  ]);
  assert.equal(restored.document.annotations.length, 1);
  assert.equal(edited.annotations.length, 2);
  assert.equal(edited.revision, restored.document.revision + 1);
  assert.deepEqual(await f.documents.getDocument(DOCUMENT_ID), edited);
});

test('caller mutation after invocation and returned-row mutation cannot change the committed document', async () => {
  const f = await fixture();
  const baseline = await f.store.captureRestoreBaseline(id, { documentId: DOCUMENT_ID });
  const candidate = input(baseline);
  const expectedNote = normalizeDocumentRecord(candidate.document).annotations[0].note;
  const pending = f.store.commitRestoreIfUnchanged(candidate);
  candidate.document.annotations[0].note = 'changed after invocation';
  candidate.expectedLocal.document.title = 'changed after invocation';
  const saved = await pending;
  assert.equal(saved.document.annotations[0].note, expectedNote);
  saved.document.annotations.length = 0;
  assert.equal((await f.documents.getDocument(DOCUMENT_ID)).annotations.length, 1);
});

test('transaction abort after all successful requests rolls back all five stores', async () => {
  const f = await fixture();
  const baseline = await f.store.captureRestoreBaseline(id, { documentId: DOCUMENT_ID });
  const before = allRows(f.fake);
  const original = f.fake.database.transaction.bind(f.fake.database);
  let sawDocumentAndWorkspaceWrites = false;
  f.fake.database.transaction = (names, mode) => {
    const tx = original(names, mode);
    if (mode === 'readwrite') tx.schedule = function abortAtCommit() {
      if (!this.active || this.completionScheduled || this.aborted) return;
      this.completionScheduled = true;
      setImmediate(() => {
        this.completionScheduled = false;
        if (this.aborted || this.pending !== 0) return;
        sawDocumentAndWorkspaceWrites = f.fake.stores.get('documents').get(DOCUMENT_ID).annotations.length === 1 &&
          f.fake.stores.get('workspaceAssets').get(id + '\u0000' + A).revision === 2 &&
          f.fake.stores.get('workspaceTurns').has(id + '\u0000t-new') &&
          f.fake.stores.get('workspaces').get(id).nextTurnSequence === 3;
        this.error = new Error('simulated document batch commit-time abort');
        this.abort();
      });
    };
    return tx;
  };
  await assert.rejects(() => f.store.commitRestoreIfUnchanged(input(baseline)), /commit-time abort/);
  assert.equal(sawDocumentAndWorkspaceWrites, true);
  assert.deepEqual(allRows(f.fake), before);
});

test('oversized or cyclic document payloads reject before changing any store', async () => {
  const f = await fixture();
  const baseline = await f.store.captureRestoreBaseline(id, { documentId: DOCUMENT_ID });
  const oversized = input(baseline);
  oversized.document.extra = Array(100001).fill(null);
  const cyclic = input(baseline);
  cyclic.document.loop = cyclic.document;
  const before = allRows(f.fake);
  for (const candidate of [oversized, cyclic]) {
    await assert.rejects(() => f.store.commitRestoreIfUnchanged(candidate));
    assert.deepEqual(allRows(f.fake), before);
  }
});
