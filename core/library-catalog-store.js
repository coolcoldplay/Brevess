(function attach(root, factory) {
  const model = typeof module === 'object' && module.exports ? require('./library-catalog-model.js') : root.BrevessLibraryCatalog;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessLibraryCatalog = Object.assign(root.BrevessLibraryCatalog || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(model) {
  'use strict';
  const LIBRARY_CATALOG_DATABASE_NAME = 'brevess-library-catalog-v1';
  const LIBRARY_CATALOG_DATABASE_VERSION = 1;
  const LIBRARY_CATALOG_STORE_NAME = 'state';
  const LIBRARY_CATALOG_STATE_KEY = 'catalog';
  const error = code => Object.assign(new Error(code), { code });

  function createLibraryCatalogStore({ indexedDB = globalThis.indexedDB, databaseName = LIBRARY_CATALOG_DATABASE_NAME,
    now, createId } = {}) {
    if (!indexedDB?.open || !model?.applyLibraryCatalogCommand) throw error('LIBRARY_CATALOG_STORE_UNAVAILABLE');
    let dbPromise = null;
    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        let blocked = false;
        const request = indexedDB.open(databaseName, LIBRARY_CATALOG_DATABASE_VERSION);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(LIBRARY_CATALOG_STORE_NAME)) request.result.createObjectStore(LIBRARY_CATALOG_STORE_NAME);
        };
        request.onsuccess = () => {
          const db = request.result;
          if (blocked) { db.close(); return; }
          db.onversionchange = () => { db.close(); dbPromise = null; };
          resolve(db);
        };
        request.onerror = () => { dbPromise = null; reject(request.error || error('LIBRARY_CATALOG_STORE_OPEN_FAILED')); };
        request.onblocked = () => { blocked = true; dbPromise = null; reject(error('LIBRARY_CATALOG_STORE_BLOCKED')); };
      });
      return dbPromise;
    }
    async function transaction(mode, mutate, { signal, guard } = {}) {
      const check = () => {
        if (signal?.aborted) throw error('LIBRARY_CATALOG_CANCELLED');
        if (guard && guard() !== true) throw error('LIBRARY_CATALOG_CANCELLED');
      };
      check();
      const db = await open();
      check();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([LIBRARY_CATALOG_STORE_NAME], mode), store = tx.objectStore(LIBRARY_CATALOG_STORE_NAME);
        let result, failure;
        const cleanup = () => signal?.removeEventListener('abort', onCancel);
        const abort = reason => {
          failure = reason;
          try { tx.abort(); }
          catch (abortError) {
            // Once IDB has crossed its commit point, report its eventual completion
            // truthfully rather than reporting a cancelled write that already committed.
            if (abortError?.name === 'InvalidStateError') return;
            cleanup(); reject(reason);
          }
        };
        const onCancel = () => abort(error('LIBRARY_CATALOG_CANCELLED'));
        tx.onabort = () => { cleanup(); reject(failure || tx.error || error('LIBRARY_CATALOG_STORE_ABORTED')); };
        tx.onerror = () => { failure = failure || tx.error || error('LIBRARY_CATALOG_STORE_FAILED'); };
        tx.oncomplete = () => { cleanup(); resolve(result); };
        signal?.addEventListener('abort', onCancel, { once: true });
        const request = store.get(LIBRARY_CATALOG_STATE_KEY);
        request.onerror = () => abort(request.error || error('LIBRARY_CATALOG_STORE_READ_FAILED'));
        request.onsuccess = () => {
          try {
            check();
            const current = request.result === undefined ? model.createEmptyLibraryCatalog() : model.normalizeLibraryCatalog(request.result);
            if (!mutate) { result = current; return; }
            const update = mutate(current); result = update.result;
            check();
            if (update.result.replayed) return;
            const write = store.put(update.catalog, LIBRARY_CATALOG_STATE_KEY);
            write.onerror = () => abort(write.error || error('LIBRARY_CATALOG_STORE_WRITE_FAILED'));
            write.onsuccess = () => { try { check(); } catch (reason) { abort(reason); } };
          } catch (reason) { abort(reason); }
        };
      });
    }
    function read() { return transaction('readonly'); }
    // Trusted runtime controls only; never part of the persisted command/JSON contract.
    function execute(request, runtimeOptions) { return transaction('readwrite', catalog => model.applyLibraryCatalogCommand(catalog, request, { now, createId }), runtimeOptions); }
    // Same-device backup restore is explicit, CAS protected and metadata only.
    // A cross-device importer must first downgrade/rebind source locators; this is not a bytes restore.
    function restoreBackup(serialized, { expectedRevision } = {}) {
      const imported = model.importLibraryCatalog(serialized);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw error('LIBRARY_CATALOG_REQUEST_INVALID');
      return transaction('readwrite', current => {
        if (current.revision !== expectedRevision) throw error('LIBRARY_CATALOG_REVISION_CONFLICT');
        const catalog = { ...imported, revision: current.revision + 1, receipts: [] };
        return { catalog: model.normalizeLibraryCatalog(catalog), result: { revision: catalog.revision, restored: true } };
      });
    }
    async function close() { if (dbPromise) { const db = await dbPromise; db.close(); dbPromise = null; } }
    return { read, execute, restoreBackup, close, databaseName, version: LIBRARY_CATALOG_DATABASE_VERSION };
  }
  return { LIBRARY_CATALOG_DATABASE_NAME, LIBRARY_CATALOG_DATABASE_VERSION, LIBRARY_CATALOG_STORE_NAME,
    LIBRARY_CATALOG_STATE_KEY, createLibraryCatalogStore };
});
