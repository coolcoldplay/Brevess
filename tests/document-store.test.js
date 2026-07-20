const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/category-store.js');
require('../core/adaptive-catalog.js');
require('../core/manual-annotations.js');
require('../core/user-data-database.js');
const {
  DOCUMENT_DATABASE_NAME,
  DOCUMENT_DATABASE_VERSION,
  DOCUMENT_STORE_NAME,
  META_STORE_NAME,
  createMemoryDocumentStore,
  createIndexedDbDocumentStore
} = require('../core/document-store.js');

const DOCUMENT_ONE = `sha256:${'1'.repeat(64)}`;
const DOCUMENT_TWO = `sha256:${'2'.repeat(64)}`;

function manualAnnotation(index, overrides = {}) {
  const quote = `Result ${index}`;
  return {
    annotationId: `annotation-${index}`,
    categoryId: 'result',
    categorySnapshot: { name: '结果陈述', color: '#FFE66D' },
    quote,
    prefix: '',
    suffix: '',
    sectionTitle: 'Results',
    blockFingerprint: `block-${index}`,
    startOffset: 0,
    endOffset: quote.length,
    note: '',
    ...overrides
  };
}

test('memory store exposes the complete async document interface', () => {
  const store = createMemoryDocumentStore();
  [
    'getDocument', 'putDocument', 'prepareDocument', 'setStudyType', 'upsertAnnotation',
    'deleteAnnotation', 'clearAnnotations', 'listDocumentIndex',
    'exportAll', 'countCategoryReferences'
  ].forEach(method => assert.equal(typeof store[method], 'function'));
});

test('atomically prepares metadata without replacing newer user-owned fields', async () => {
  const store = createMemoryDocumentStore();
  await store.setStudyType(DOCUMENT_ONE, 'clinical_trial');
  await store.upsertAnnotation(DOCUMENT_ONE, manualAnnotation(1));

  const prepared = await store.prepareDocument({
    documentId: DOCUMENT_ONE,
    title: 'Prepared paper',
    canonicalUrl: 'https://example.org/paper',
    studyType: 'observational',
    annotations: [],
    revision: 0,
    updatedAt: '',
    documentHash: 'a'.repeat(64),
    documentHashes: ['a'.repeat(64)],
    legacyStudyTypeMigrated: true
  });
  const repeated = await store.prepareDocument({
    ...prepared,
    studyType: 'observational',
    annotations: []
  });

  assert.equal(prepared.studyType, 'clinical_trial');
  assert.equal(prepared.annotations.length, 1);
  assert.equal(prepared.annotations[0].annotationId, 'annotation-1');
  assert.equal(prepared.legacyStudyTypeMigrated, true);
  assert.deepEqual(prepared.documentHashes, ['a'.repeat(64)]);
  assert.equal(repeated.revision, prepared.revision);
});

test('upserts, edits, deletes, and clears category-bound annotations atomically', async () => {
  const store = createMemoryDocumentStore();
  const typed = await store.setStudyType(DOCUMENT_ONE, 'observational', { title: 'Paper' });
  const inserted = await store.upsertAnnotation(DOCUMENT_ONE, manualAnnotation(1, {
    note: 'Check power'
  }));
  const edited = await store.upsertAnnotation(DOCUMENT_ONE, manualAnnotation(1, {
    note: 'Primary result'
  }));

  assert.equal(typed.revision, 1);
  assert.equal(inserted.revision, 2);
  assert.equal(edited.revision, 3);
  assert.equal(edited.studyType, 'observational');
  assert.equal(edited.annotations[0].note, 'Primary result');
  assert.ok(Date.parse(edited.updatedAt) >= Date.parse(inserted.updatedAt));
  assert.ok(edited.annotations[0].createdAt);
  assert.ok(edited.annotations[0].updatedAt);

  const deleted = await store.deleteAnnotation(DOCUMENT_ONE, 'annotation-1');
  assert.equal(deleted.revision, 4);
  assert.deepEqual(deleted.annotations, []);
  await store.upsertAnnotation(DOCUMENT_ONE, manualAnnotation(2));
  const cleared = await store.clearAnnotations(DOCUMENT_ONE);
  assert.equal(cleared.studyType, 'observational');
  assert.deepEqual(cleared.annotations, []);
});

test('serializes concurrent mutations without losing annotations or revisions', async () => {
  const store = createMemoryDocumentStore();
  const [first, second, typed] = await Promise.all([
    store.upsertAnnotation(DOCUMENT_ONE, manualAnnotation(1)),
    store.upsertAnnotation(DOCUMENT_ONE, manualAnnotation(2)),
    store.setStudyType(DOCUMENT_ONE, 'clinical_trial')
  ]);
  const saved = await store.getDocument(DOCUMENT_ONE);

  assert.ok(first.revision < second.revision || second.revision < first.revision);
  assert.ok(typed.revision >= 1);
  assert.equal(saved.revision, 3);
  assert.equal(saved.studyType, 'clinical_trial');
  assert.deepEqual(
    saved.annotations.map(item => item.annotationId).sort(),
    ['annotation-1', 'annotation-2']
  );
});

test('enforces the hard limit only for new annotations and keeps existing records', async () => {
  const store = createMemoryDocumentStore();
  const annotations = Array.from({ length: 2000 }, (_, index) => manualAnnotation(index));
  await store.putDocument({
    documentId: DOCUMENT_ONE,
    title: 'Large paper',
    annotations,
    revision: 9,
    futureDocumentField: { retained: true }
  });

  const edited = await store.upsertAnnotation(DOCUMENT_ONE, manualAnnotation(0, {
    note: 'Editing at the limit remains valid'
  }));
  assert.equal(edited.annotations.length, 2000);
  await assert.rejects(
    () => store.upsertAnnotation(DOCUMENT_ONE, manualAnnotation('overflow')),
    /ANNOTATION_LIMIT_REACHED/
  );
  const saved = await store.getDocument(DOCUMENT_ONE);
  assert.equal(saved.annotations.length, 2000);
  assert.deepEqual(saved.futureDocumentField, { retained: true });
});

test('counts category references and returns detached index and export data', async () => {
  const store = createMemoryDocumentStore();
  await store.upsertAnnotation(DOCUMENT_ONE, manualAnnotation(1));
  await store.upsertAnnotation(DOCUMENT_ONE, manualAnnotation(2, {
    annotationId: 'limitation-1',
    categoryId: 'limitation',
    categorySnapshot: { name: '局限性', color: '#E67E22' }
  }));
  await store.upsertAnnotation(DOCUMENT_TWO, manualAnnotation(3));

  assert.equal(await store.countCategoryReferences('result'), 2);
  assert.equal(await store.countCategoryReferences('limitation'), 1);
  assert.equal(await store.countCategoryReferences('future'), 0);
  const index = await store.listDocumentIndex();
  const exported = await store.exportAll();
  assert.equal(index.length, 2);
  assert.deepEqual(index.map(item => Object.keys(item).sort()), index.map(() => [
    'annotationCount', 'canonicalUrl', 'documentId', 'revision', 'studyType', 'title', 'updatedAt'
  ]));
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.documents.length, 2);
  assert.deepEqual(exported.index, index);
  exported.documents[0].annotations.length = 0;
  assert.equal((await store.countCategoryReferences('result')), 2);
});

function createFakeIndexedDb() {
  const stores = new Map();
  const openCalls = [];
  let failNextPut = false;

  function makeTransaction(storeNames) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const transaction = {
      error: null,
      aborted: false,
      pending: 0,
      completionScheduled: false,
      objectStore(name) {
        if (!names.includes(name) || !stores.has(name)) throw new Error(`Missing store ${name}`);
        const records = stores.get(name);
        const request = operation => {
          const output = {};
          transaction.pending += 1;
          setTimeout(() => {
            if (transaction.aborted) return;
            try {
              output.result = operation(records);
              output.onsuccess?.();
            } catch (error) {
              output.error = error;
              transaction.error = error;
              transaction.aborted = true;
              output.onerror?.();
              transaction.onerror?.();
              transaction.onabort?.();
            } finally {
              transaction.pending -= 1;
              transaction.scheduleCompletion();
            }
          }, 0);
          return output;
        };
        return {
          get(key) {
            return request(data => data.has(key) ? structuredClone(data.get(key)) : undefined);
          },
          getAll() {
            return request(data => [...data.values()].map(structuredClone));
          },
          put(value) {
            return request(data => {
              if (failNextPut) {
                failNextPut = false;
                throw new Error('simulated IndexedDB write failure');
              }
              const key = name === DOCUMENT_STORE_NAME ? value.documentId : value.key;
              data.set(key, structuredClone(value));
              return key;
            });
          }
        };
      },
      scheduleCompletion() {
        if (transaction.completionScheduled || transaction.aborted) return;
        transaction.completionScheduled = true;
        setTimeout(() => {
          transaction.completionScheduled = false;
          if (!transaction.aborted && transaction.pending === 0) transaction.oncomplete?.();
        }, 0);
      }
    };
    transaction.scheduleCompletion();
    return transaction;
  }

  const database = {
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore(name) {
      stores.set(name, new Map());
      return { createIndex() {} };
    },
    transaction(storeNames) {
      return makeTransaction(storeNames);
    }
  };
  const indexedDb = {
    open(name, version) {
      openCalls.push({ name, version });
      const request = {};
      setTimeout(() => {
        request.result = database;
        if (!stores.size) request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    }
  };
  return {
    indexedDb,
    openCalls,
    stores,
    failNextWrite() { failNextPut = true; }
  };
}

test('IndexedDB adapter uses the required database and stores and recovers after failure', async () => {
  const fake = createFakeIndexedDb();
  const store = createIndexedDbDocumentStore(fake.indexedDb);
  fake.failNextWrite();
  await assert.rejects(
    () => store.setStudyType(DOCUMENT_ONE, 'observational'),
    /simulated IndexedDB write failure/
  );
  const saved = await store.setStudyType(DOCUMENT_ONE, 'clinical_trial');

  assert.deepEqual(fake.openCalls, [{
    name: 'sci-logic-highlighter-user-data', version: 3
  }]);
  assert.equal(DOCUMENT_DATABASE_NAME, 'sci-logic-highlighter-user-data');
  assert.equal(DOCUMENT_DATABASE_VERSION, 3);
  assert.equal(DOCUMENT_STORE_NAME, 'documents');
  assert.equal(META_STORE_NAME, 'meta');
  assert.equal(fake.stores.has('documents'), true);
  assert.equal(fake.stores.has('meta'), true);
  assert.equal(fake.stores.has('directoryHandles'), true);
  assert.equal(fake.stores.has('syncQueue'), true);
  assert.equal(fake.stores.has('workspaces'), true);
  assert.equal(fake.stores.has('workspaceAssets'), true);
  assert.equal(fake.stores.has('workspaceTurns'), true);
  assert.equal(fake.stores.has('workspaceTombstones'), true);
  assert.equal(saved.studyType, 'clinical_trial');
  assert.equal(saved.revision, 1);
});
