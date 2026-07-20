(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const DOCUMENT_DATABASE_NAME = 'sci-logic-highlighter-user-data';
  const DOCUMENT_DATABASE_VERSION = 2;
  const DOCUMENT_STORE_NAME = 'documents';
  const META_STORE_NAME = 'meta';
  const DIRECTORY_HANDLE_STORE_NAME = 'directoryHandles';
  const SYNC_QUEUE_STORE_NAME = 'syncQueue';
  const STUDY_TYPES = new Set([
    'basic_mechanistic', 'preclinical_translational', 'observational',
    'clinical_trial', 'diagnostic_prognostic', 'omics_high_throughput',
    'narrative_review', 'systematic_review_meta', 'methods_resource'
  ]);

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function cloneJsonLike(value) {
    if (Array.isArray(value)) return value.map(cloneJsonLike);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonLike(item)])
    );
  }

  function jsonLikeEqual(first, second) {
    if (first === second) return true;
    if (Array.isArray(first) || Array.isArray(second)) {
      return Array.isArray(first) && Array.isArray(second) &&
        first.length === second.length &&
        first.every((item, index) => jsonLikeEqual(item, second[index]));
    }
    if (!isPlainObject(first) || !isPlainObject(second)) return false;
    const firstKeys = Object.keys(first).sort();
    const secondKeys = Object.keys(second).sort();
    return firstKeys.length === secondKeys.length &&
      firstKeys.every((key, index) =>
        key === secondKeys[index] && jsonLikeEqual(first[key], second[key])
      );
  }

  function normalizeText(value) {
    return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  }

  function normalizeUrl(value) {
    const raw = String(value ?? '').normalize('NFKC').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (!/^https?:$/.test(parsed.protocol)) return '';
      parsed.username = '';
      parsed.password = '';
      parsed.hash = '';
      parsed.search = '';
      const path = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
      return `${parsed.origin}${path === '/' ? '' : path}`;
    } catch (_) {
      return raw.split(/[?#]/u, 1)[0].replace(/\/+$/, '');
    }
  }

  function normalizeDocumentId(value) {
    const documentId = String(value ?? '').trim();
    if (!documentId || documentId.length > 200 ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(documentId)) {
      fail('INVALID_DOCUMENT_ID');
    }
    return documentId;
  }

  function validStudyType(value) {
    return typeof shared.isStudyType === 'function'
      ? shared.isStudyType(value) : STUDY_TYPES.has(value);
  }

  function nextTimestamp(previous) {
    const previousTime = Date.parse(previous || '');
    const timestamp = Math.max(
      Date.now(),
      Number.isFinite(previousTime) ? previousTime + 1 : 0
    );
    return new Date(timestamp).toISOString();
  }

  function normalizeRecord(input) {
    if (!isPlainObject(input)) fail('INVALID_DOCUMENT_RECORD');
    const documentId = normalizeDocumentId(input.documentId);
    const studyType = input.studyType || null;
    if (studyType !== null && !validStudyType(studyType)) fail('INVALID_STUDY_TYPE');
    if (input.annotations !== undefined && !Array.isArray(input.annotations)) {
      fail('INVALID_ANNOTATIONS');
    }
    const annotations = (input.annotations || []).map(item =>
      shared.normalizeManualAnnotation(item)
    );
    if (annotations.length > (shared.MAX_ANNOTATIONS_PER_DOCUMENT || 2000)) {
      fail('ANNOTATION_LIMIT_REACHED');
    }
    const ids = new Set();
    annotations.forEach(annotation => {
      if (ids.has(annotation.annotationId)) fail('DUPLICATE_ANNOTATION_ID');
      ids.add(annotation.annotationId);
    });
    const revision = input.revision === undefined ? 0 : Number(input.revision);
    if (!Number.isSafeInteger(revision) || revision < 0) fail('INVALID_REVISION');
    const updatedAt = input.updatedAt ? String(input.updatedAt) : '';
    if (updatedAt && !Number.isFinite(Date.parse(updatedAt))) fail('INVALID_UPDATED_AT');
    return {
      ...cloneJsonLike(input),
      schemaVersion: 1,
      documentId,
      title: normalizeText(input.title),
      canonicalUrl: normalizeUrl(input.canonicalUrl || input.url),
      studyType,
      annotations,
      revision,
      updatedAt
    };
  }

  function baseRecord(documentId, metadata = {}) {
    const safeMetadata = isPlainObject(metadata) ? cloneJsonLike(metadata) : {};
    delete safeMetadata.documentId;
    delete safeMetadata.annotations;
    delete safeMetadata.revision;
    delete safeMetadata.updatedAt;
    delete safeMetadata.studyType;
    return normalizeRecord({
      ...safeMetadata,
      documentId,
      title: safeMetadata.title || '',
      canonicalUrl: safeMetadata.canonicalUrl || safeMetadata.url || '',
      studyType: null,
      annotations: [],
      revision: 0,
      updatedAt: ''
    });
  }

  function mergeMetadata(record, metadata) {
    if (!isPlainObject(metadata)) return record;
    const safe = cloneJsonLike(metadata);
    delete safe.documentId;
    delete safe.annotations;
    delete safe.revision;
    delete safe.updatedAt;
    delete safe.studyType;
    return { ...record, ...safe };
  }

  function finishMutation(record, previousRevision, previousUpdatedAt) {
    const normalized = normalizeRecord(record);
    normalized.revision = previousRevision + 1;
    normalized.updatedAt = nextTimestamp(previousUpdatedAt);
    return normalized;
  }

  function finishPut(record, previous) {
    const normalized = normalizeRecord(record);
    normalized.revision = Math.max(previous?.revision || 0, normalized.revision) + 1;
    normalized.updatedAt = nextTimestamp(previous?.updatedAt || normalized.updatedAt);
    return normalized;
  }

  function prepareRecord(input, current) {
    const incoming = normalizeRecord(input);
    if (!current) return finishPut(incoming, null);
    const legacyAlreadyMigrated = current.legacyStudyTypeMigrated === true;
    const documentHashes = [...new Set([
      ...(Array.isArray(current.documentHashes) ? current.documentHashes : []),
      ...(current.documentHash ? [current.documentHash] : []),
      ...(Array.isArray(incoming.documentHashes) ? incoming.documentHashes : []),
      ...(incoming.documentHash ? [incoming.documentHash] : [])
    ].filter(value => typeof value === 'string' && value))];
    const next = normalizeRecord({
      ...current,
      ...incoming,
      documentHash: incoming.documentHash || current.documentHash,
      documentHashes,
      legacyStudyTypeMigrated: legacyAlreadyMigrated ||
        incoming.legacyStudyTypeMigrated === true,
      studyType: current.studyType ||
        (!legacyAlreadyMigrated ? incoming.studyType : null),
      annotations: current.annotations,
      revision: current.revision,
      updatedAt: current.updatedAt
    });
    return jsonLikeEqual(next, current)
      ? cloneJsonLike(current)
      : finishMutation(next, current.revision, current.updatedAt);
  }

  function upsertIntoRecord(current, input, metadata) {
    const annotation = shared.normalizeManualAnnotation(input);
    const record = mergeMetadata(current, metadata);
    const existingIndex = record.annotations.findIndex(item =>
      item.annotationId === annotation.annotationId
    );
    if (existingIndex < 0 &&
        record.annotations.length >= (shared.MAX_ANNOTATIONS_PER_DOCUMENT || 2000)) {
      fail('ANNOTATION_LIMIT_REACHED');
    }
    const now = nextTimestamp(
      existingIndex >= 0 ? record.annotations[existingIndex].updatedAt : ''
    );
    const saved = {
      ...annotation,
      createdAt: existingIndex >= 0
        ? record.annotations[existingIndex].createdAt || annotation.createdAt || now
        : annotation.createdAt || now,
      updatedAt: now
    };
    if (existingIndex >= 0) record.annotations.splice(existingIndex, 1, saved);
    else record.annotations.push(saved);
    return record;
  }

  function documentIndex(records) {
    return records.map(record => ({
      documentId: record.documentId,
      title: record.title || '',
      canonicalUrl: record.canonicalUrl || '',
      studyType: record.studyType || null,
      annotationCount: Array.isArray(record.annotations) ? record.annotations.length : 0,
      revision: Number(record.revision) || 0,
      updatedAt: record.updatedAt || ''
    })).sort((first, second) =>
      String(second.updatedAt).localeCompare(String(first.updatedAt)) ||
      first.documentId.localeCompare(second.documentId)
    );
  }

  function exportRecords(records) {
    const documents = records.map(cloneJsonLike).sort((first, second) =>
      first.documentId.localeCompare(second.documentId)
    );
    return {
      schemaVersion: 1,
      index: documentIndex(documents),
      documents
    };
  }

  function createMemoryDocumentStore() {
    const records = new Map();
    let mutationTail = Promise.resolve();

    function serialize(operation) {
      const pending = mutationTail.then(operation, operation);
      mutationTail = pending.catch(() => undefined);
      return pending;
    }

    async function settled() {
      await mutationTail;
    }

    async function getDocument(documentId) {
      await settled();
      const record = records.get(normalizeDocumentId(documentId));
      return record ? cloneJsonLike(record) : null;
    }

    async function putDocument(input) {
      return serialize(async () => {
        const normalized = normalizeRecord(input);
        const previous = records.get(normalized.documentId);
        const saved = finishPut(normalized, previous);
        records.set(saved.documentId, saved);
        return cloneJsonLike(saved);
      });
    }

    async function prepareDocument(input) {
      return serialize(async () => {
        const normalized = normalizeRecord(input);
        const current = records.get(normalized.documentId) || null;
        const saved = prepareRecord(normalized, current);
        records.set(saved.documentId, saved);
        return cloneJsonLike(saved);
      });
    }

    async function setStudyType(documentId, studyType, metadata) {
      return serialize(async () => {
        const id = normalizeDocumentId(documentId);
        if (!validStudyType(studyType)) fail('INVALID_STUDY_TYPE');
        const current = records.get(id) || baseRecord(id, metadata);
        const next = mergeMetadata(cloneJsonLike(current), metadata);
        next.studyType = studyType;
        const saved = finishMutation(next, current.revision, current.updatedAt);
        records.set(id, saved);
        return cloneJsonLike(saved);
      });
    }

    async function upsertAnnotation(documentId, annotation, metadata) {
      return serialize(async () => {
        const id = normalizeDocumentId(documentId);
        const current = records.get(id) || baseRecord(id, metadata);
        const next = upsertIntoRecord(cloneJsonLike(current), annotation, metadata);
        const saved = finishMutation(next, current.revision, current.updatedAt);
        records.set(id, saved);
        return cloneJsonLike(saved);
      });
    }

    async function deleteAnnotation(documentId, annotationId) {
      return serialize(async () => {
        const id = normalizeDocumentId(documentId);
        const current = records.get(id) || baseRecord(id);
        const next = cloneJsonLike(current);
        next.annotations = next.annotations.filter(item => item.annotationId !== String(annotationId));
        const saved = finishMutation(next, current.revision, current.updatedAt);
        records.set(id, saved);
        return cloneJsonLike(saved);
      });
    }

    async function clearAnnotations(documentId) {
      return serialize(async () => {
        const id = normalizeDocumentId(documentId);
        const current = records.get(id) || baseRecord(id);
        const next = cloneJsonLike(current);
        next.annotations = [];
        const saved = finishMutation(next, current.revision, current.updatedAt);
        records.set(id, saved);
        return cloneJsonLike(saved);
      });
    }

    async function allRecords() {
      await settled();
      return [...records.values()].map(cloneJsonLike);
    }

    async function listDocumentIndex() {
      return documentIndex(await allRecords());
    }

    async function exportAll() {
      return exportRecords(await allRecords());
    }

    async function countCategoryReferences(categoryId) {
      const id = String(categoryId || '');
      return (await allRecords()).reduce((count, record) =>
        count + record.annotations.filter(item => item.categoryId === id).length, 0
      );
    }

    return {
      getDocument,
      putDocument,
      prepareDocument,
      setStudyType,
      upsertAnnotation,
      deleteAnnotation,
      clearAnnotations,
      listDocumentIndex,
      exportAll,
      countCategoryReferences
    };
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  function createIndexedDbDocumentStore(indexedDbRef) {
    let databasePromise;

    function openDatabase() {
      if (!databasePromise) {
        databasePromise = new Promise((resolve, reject) => {
          const request = indexedDbRef.open(DOCUMENT_DATABASE_NAME, DOCUMENT_DATABASE_VERSION);
          request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(DOCUMENT_STORE_NAME)) {
              const documents = database.createObjectStore(
                DOCUMENT_STORE_NAME,
                { keyPath: 'documentId' }
              );
              documents.createIndex('updatedAt', 'updatedAt');
            }
            if (!database.objectStoreNames.contains(META_STORE_NAME)) {
              database.createObjectStore(META_STORE_NAME, { keyPath: 'key' });
            }
            if (!database.objectStoreNames.contains(DIRECTORY_HANDLE_STORE_NAME)) {
              database.createObjectStore(DIRECTORY_HANDLE_STORE_NAME, { keyPath: 'key' });
            }
            if (!database.objectStoreNames.contains(SYNC_QUEUE_STORE_NAME)) {
              database.createObjectStore(SYNC_QUEUE_STORE_NAME, { keyPath: 'key' });
            }
          };
          request.onsuccess = () => {
            const database = request.result;
            database.onversionchange = () => {
              database.close?.();
              databasePromise = undefined;
            };
            resolve(database);
          };
          request.onerror = () => reject(request.error);
        });
      }
      return databasePromise;
    }

    async function runTransaction(mode, operation) {
      const database = await openDatabase();
      const transaction = database.transaction(DOCUMENT_STORE_NAME, mode);
      const done = transactionDone(transaction);
      try {
        const result = await operation(transaction.objectStore(DOCUMENT_STORE_NAME));
        await done;
        return result;
      } catch (error) {
        await done.catch(() => undefined);
        throw error;
      }
    }

    async function getDocument(documentId) {
      const id = normalizeDocumentId(documentId);
      const result = await runTransaction('readonly', store => requestToPromise(store.get(id)));
      return result ? cloneJsonLike(result) : null;
    }

    async function mutateDocument(documentId, operation) {
      const id = normalizeDocumentId(documentId);
      return runTransaction('readwrite', async store => {
        const current = await requestToPromise(store.get(id));
        const saved = await operation(current ? normalizeRecord(current) : null, id);
        await requestToPromise(store.put(saved));
        return cloneJsonLike(saved);
      });
    }

    async function putDocument(input) {
      const normalized = normalizeRecord(input);
      return mutateDocument(normalized.documentId, current => finishPut(normalized, current));
    }

    async function prepareDocument(input) {
      const normalized = normalizeRecord(input);
      return mutateDocument(normalized.documentId, current =>
        prepareRecord(normalized, current)
      );
    }

    async function setStudyType(documentId, studyType, metadata) {
      if (!validStudyType(studyType)) fail('INVALID_STUDY_TYPE');
      return mutateDocument(documentId, (current, id) => {
        const base = current || baseRecord(id, metadata);
        const next = mergeMetadata(cloneJsonLike(base), metadata);
        next.studyType = studyType;
        return finishMutation(next, base.revision, base.updatedAt);
      });
    }

    async function upsertAnnotation(documentId, annotation, metadata) {
      return mutateDocument(documentId, (current, id) => {
        const base = current || baseRecord(id, metadata);
        return finishMutation(
          upsertIntoRecord(cloneJsonLike(base), annotation, metadata),
          base.revision,
          base.updatedAt
        );
      });
    }

    async function deleteAnnotation(documentId, annotationId) {
      return mutateDocument(documentId, (current, id) => {
        const base = current || baseRecord(id);
        const next = cloneJsonLike(base);
        next.annotations = next.annotations.filter(item =>
          item.annotationId !== String(annotationId)
        );
        return finishMutation(next, base.revision, base.updatedAt);
      });
    }

    async function clearAnnotations(documentId) {
      return mutateDocument(documentId, (current, id) => {
        const base = current || baseRecord(id);
        const next = cloneJsonLike(base);
        next.annotations = [];
        return finishMutation(next, base.revision, base.updatedAt);
      });
    }

    async function allRecords() {
      const records = await runTransaction('readonly', store =>
        requestToPromise(store.getAll())
      );
      return records.map(record => normalizeRecord(record));
    }

    async function listDocumentIndex() {
      return documentIndex(await allRecords());
    }

    async function exportAll() {
      return exportRecords(await allRecords());
    }

    async function countCategoryReferences(categoryId) {
      const id = String(categoryId || '');
      return (await allRecords()).reduce((count, record) =>
        count + record.annotations.filter(item => item.categoryId === id).length, 0
      );
    }

    return {
      getDocument,
      putDocument,
      prepareDocument,
      setStudyType,
      upsertAnnotation,
      deleteAnnotation,
      clearAnnotations,
      listDocumentIndex,
      exportAll,
      countCategoryReferences
    };
  }

  return {
    DOCUMENT_DATABASE_NAME,
    DOCUMENT_DATABASE_VERSION,
    DOCUMENT_STORE_NAME,
    META_STORE_NAME,
    createMemoryDocumentStore,
    createIndexedDbDocumentStore
  };
});
