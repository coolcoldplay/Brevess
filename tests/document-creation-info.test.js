const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../core/category-store');
require('../core/adaptive-catalog');
require('../core/manual-annotations');
require('../core/user-data-database');
const api = require('../core/document-store');
const fixtureSource = fs.readFileSync(path.join(__dirname, 'article-workspace-store.test.js'), 'utf8');
const start = fixtureSource.indexOf('function createFakeIndexedDb(');
const end = fixtureSource.indexOf('\nfunction workspace(', start);
assert.ok(start >= 0 && end > start);
const createFakeIndexedDb = Function(fixtureSource.slice(start, end) + '\nreturn createFakeIndexedDb;')();
const documentId = `sha256:${'1'.repeat(64)}`;
const documentHash = '2'.repeat(64);
const input = () => ({ documentId, documentHash, documentHashes: [documentHash],
  title: 'Scientific no-increase paper', canonicalUrl: 'https://example.org/creation-info',
  studyType: null, annotations: [], revision: 0, updatedAt: '', legacyStudyTypeMigrated: true });

function fixture(kind) {
  if (kind === 'memory') return { store: api.createMemoryDocumentStore() };
  const fake = createFakeIndexedDb();
  return { store: api.createIndexedDbDocumentStore(fake.indexedDb), fake };
}
function prepare(store, record = input()) {
  assert.equal(typeof store.prepareDocumentWithCreationInfo, 'function', 'transactional creation-info API must exist');
  return store.prepareDocumentWithCreationInfo(record);
}

for (const kind of ['memory', 'indexeddb']) {
  test(`${kind}: first prepare is created, repeated prepare is existing and old API still returns record`, async () => {
    const { store } = fixture(kind);
    const first = await prepare(store);
    assert.equal(first.createdFromAbsence, true);
    assert.deepEqual(first.record, await store.getDocument(documentId));
    assert.equal(first.record.createdFromAbsence, undefined, 'fact is not a new persisted schema field');
    const second = await prepare(store);
    assert.equal(second.createdFromAbsence, false);
    assert.deepEqual(second.record, first.record);
    const legacy = await store.prepareDocument(input());
    assert.equal(legacy.documentId, documentId);
    assert.equal(legacy.record, undefined);
    assert.deepEqual(legacy, second.record);
  });

  test(`${kind}: two concurrent prepares have exactly one creation fact`, async () => {
    const { store, fake } = fixture(kind);
    const secondStore = fake ? api.createIndexedDbDocumentStore(fake.indexedDb) : store;
    const results = await Promise.all([prepare(store), prepare(secondStore)]);
    assert.deepEqual(results.map(value => value.createdFromAbsence).sort(), [false, true]);
    assert.deepEqual(results[0].record, results[1].record);
    assert.deepEqual(await store.getDocument(documentId), results[1].record);
  });

  test(`${kind}: an imported or pre-existing empty record never claims absence`, async () => {
    const { store } = fixture(kind);
    const imported = await store.putDocument({ ...input(), revision: 30, updatedAt: '2020-01-01T00:00:00.000Z' });
    assert.deepEqual(imported.annotations, []);
    const result = await prepare(store);
    assert.equal(result.createdFromAbsence, false);
    assert.equal(result.record.revision, imported.revision);
  });

  test(`${kind}: explicit clear on an absent or already empty document prevents a later creation fact`, async () => {
    const { store } = fixture(kind);
    const cleared = await store.clearAnnotations(documentId);
    const result = await prepare(store);
    assert.equal(result.createdFromAbsence, false);
    assert.ok(result.record.revision > cleared.revision, 'metadata may legitimately change revision');
    const againCleared = await store.clearAnnotations(documentId);
    const again = await prepare(store);
    assert.equal(again.createdFromAbsence, false);
    assert.equal(again.record.revision, againCleared.revision);
  });

  test(`${kind}: caller-created flag and metadata changes cannot spoof a creation fact`, async () => {
    const { store } = fixture(kind);
    await prepare(store);
    const result = await prepare(store, { ...input(), title: 'New title', createdFromAbsence: true });
    assert.equal(result.createdFromAbsence, false);
    assert.equal(result.record.title, 'New title');
  });

  test(`${kind}: invalid initial preparation does not leave a record or consume first creation`, async () => {
    const { store } = fixture(kind);
    await assert.rejects(prepare(store, { ...input(), annotations: {} }), /INVALID_ANNOTATIONS/);
    assert.equal(await store.getDocument(documentId), null);
    assert.equal((await prepare(store)).createdFromAbsence, true);
  });
}

test('indexeddb: existing null and falsy/corrupt raw rows are rejected and retained rather than treated as absent', async () => {
  for (const raw of [null, false, 0, '', {}, { documentId, annotations: 'invalid' }]) {
    const { store, fake } = fixture('indexeddb');
    await store.getDocument(documentId); // initialize the same existing database
    fake.stores.get('documents').set(documentId, structuredClone(raw));
    await assert.rejects(prepare(store), /INVALID_DOCUMENT_RECORD|INVALID_DOCUMENT_ID|INVALID_ANNOTATIONS/);
    assert.deepEqual(fake.stores.get('documents').get(documentId), raw);
  }
});

test('memory: Map.has distinguishes corrupt existing null/falsy rows from real absence', async () => {
  const capturedMaps = [];
  const context = { SciLLM: { ...globalThis.SciLLM }, URL,
    Map: class extends Map { constructor(...args) { super(...args); capturedMaps.push(this); } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../core/document-store.js'), 'utf8'), context);
  vm.runInContext('globalThis.store = SciLLM.createMemoryDocumentStore()', context);
  assert.equal(typeof context.store.prepareDocumentWithCreationInfo, 'function');
  const records = capturedMaps[0];
  for (const raw of [null, false, 0, '']) {
    records.set(documentId, raw);
    await assert.rejects(vm.runInContext(`store.prepareDocumentWithCreationInfo(${JSON.stringify(input())})`, context),
      /INVALID_DOCUMENT_RECORD/);
    assert.equal(records.get(documentId), raw);
  }
});

test('indexeddb: prepare and legacy prepare each use exactly one documents readwrite transaction', async () => {
  const { store, fake } = fixture('indexeddb');
  const transactions = [];
  const original = fake.database.transaction;
  fake.database.transaction = (names, mode) => { transactions.push({ names, mode }); return original(names, mode); };
  await prepare(store);
  assert.deepEqual(transactions, [{ names: 'documents', mode: 'readwrite' }]);
  transactions.length = 0;
  await store.prepareDocument(input());
  assert.deepEqual(transactions, [{ names: 'documents', mode: 'readwrite' }]);
});

test('indexeddb: put abort rejects instead of releasing a created receipt, and next successful prepare can create', async () => {
  const { store, fake } = fixture('indexeddb');
  fake.failNextPutFor('documents');
  await assert.rejects(prepare(store), /simulated documents write failure/);
  assert.equal(await store.getDocument(documentId), null);
  assert.equal((await prepare(store)).createdFromAbsence, true);
});

test('indexeddb: abort after successful put still returns no creation receipt and rolls the record back', async () => {
  const { store, fake } = fixture('indexeddb');
  const original = fake.database.transaction;
  let wroteBeforeAbort = false;
  let first = true;
  fake.database.transaction = (names, mode) => {
    const transaction = original(names, mode);
    if (mode !== 'readwrite' || !first) return transaction;
    first = false;
    let putRequested = false;
    const objectStore = transaction.objectStore;
    transaction.objectStore = name => {
      const result = objectStore(name);
      const put = result.put;
      result.put = value => { putRequested = true; return put(value); };
      return result;
    };
    const schedule = transaction.schedule;
    transaction.schedule = function () {
      if (putRequested && this.pending === 0 && !this.aborted) {
        wroteBeforeAbort = fake.stores.get('documents').has(documentId);
        this.error = new Error('COMMIT_ABORT_AFTER_PUT');
        this.abort();
        return;
      }
      return schedule.call(this);
    };
    return transaction;
  };
  await assert.rejects(prepare(store), /COMMIT_ABORT_AFTER_PUT/);
  assert.equal(wroteBeforeAbort, true, 'test really aborted after the put request succeeded');
  assert.equal(await store.getDocument(documentId), null);
});

test('indexeddb: successful put is insufficient; the promise waits for transaction completion', async () => {
  const { store, fake } = fixture('indexeddb');
  const original = fake.database.transaction;
  let finish;
  let reached;
  const committed = new Promise(resolve => { reached = resolve; });
  fake.database.transaction = (names, mode) => {
    const transaction = original(names, mode);
    if (mode === 'readwrite') Object.defineProperty(transaction, 'oncomplete', {
      set(callback) { finish = callback; }, get() { return reached; }
    });
    return transaction;
  };
  let settled = false;
  const pending = prepare(store).then(result => { settled = true; return result; });
  await committed;
  await Promise.resolve();
  assert.equal(fake.stores.get('documents').has(documentId), true);
  assert.equal(settled, false);
  finish();
  assert.equal((await pending).createdFromAbsence, true);
});
