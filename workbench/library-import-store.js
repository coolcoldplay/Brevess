(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessWorkbenchLibraryImport = Object.assign(root.BrevessWorkbenchLibraryImport || {}, api);
})(globalThis, function() {
  'use strict';

  const DATABASE_NAME = 'brevess-workbench-library-transfer-v1';
  const DATABASE_VERSION = 1;
  const STORE_NAME = 'entries';

  const requestResult = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('LIBRARY_IMPORT_STORE_REQUEST_FAILED'));
  });

  function createLibraryImportStore({ indexedDB = globalThis.indexedDB, databaseName = DATABASE_NAME, version = DATABASE_VERSION } = {}) {
    if (!indexedDB?.open) throw Object.assign(new Error('LIBRARY_IMPORT_STORE_UNAVAILABLE'), { code: 'LIBRARY_IMPORT_STORE_UNAVAILABLE' });
    let databasePromise = null;
    function open() {
      if (databasePromise) return databasePromise;
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, version);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('LIBRARY_IMPORT_STORE_OPEN_FAILED'));
      });
      return databasePromise;
    }
    async function readAll() {
      const db = await open();
      return requestResult(db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME).getAll());
    }
    async function replace(entries) {
      if (!Array.isArray(entries)) throw Object.assign(new Error('LIBRARY_IMPORT_STORE_ENTRIES_INVALID'), { code: 'LIBRARY_IMPORT_STORE_ENTRIES_INVALID' });
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME], 'readwrite'), store = tx.objectStore(STORE_NAME);
        const keys = store.getAllKeys();
        keys.onsuccess = () => {
          try {
            for (const key of keys.result) store.delete(key);
            for (const entry of entries) {
              const key = entry?.stableId;
              if (typeof key !== 'string' || !key) throw Object.assign(new Error('LIBRARY_IMPORT_STORE_ENTRY_INVALID'), { code: 'LIBRARY_IMPORT_STORE_ENTRY_INVALID' });
              const request = store.put(entry, key);
              request.onerror = () => { tx.abort?.(); reject(request.error || new Error('LIBRARY_IMPORT_STORE_WRITE_FAILED')); };
            }
          } catch (error) { tx.abort?.(); reject(error); }
        };
        keys.onerror = () => reject(keys.error || new Error('LIBRARY_IMPORT_STORE_READ_FAILED'));
        tx.oncomplete = () => resolve({ count: entries.length });
        tx.onerror = () => reject(tx.error || new Error('LIBRARY_IMPORT_STORE_TRANSACTION_FAILED'));
        tx.onabort = () => reject(tx.error || new Error('LIBRARY_IMPORT_STORE_ABORTED'));
      });
    }
    async function remove(stableId) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        tx.objectStore(STORE_NAME).delete(stableId);
        tx.oncomplete = () => resolve({ removed: stableId });
        tx.onerror = () => reject(tx.error || new Error('LIBRARY_IMPORT_STORE_REMOVE_FAILED'));
      });
    }
    async function clear() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME], 'readwrite'), store = tx.objectStore(STORE_NAME), keys = store.getAllKeys();
        keys.onsuccess = () => { for (const key of keys.result) store.delete(key); };
        keys.onerror = () => reject(keys.error || new Error('LIBRARY_IMPORT_STORE_READ_FAILED'));
        tx.oncomplete = () => resolve({ cleared: true });
        tx.onerror = () => reject(tx.error || new Error('LIBRARY_IMPORT_STORE_CLEAR_FAILED'));
        tx.onabort = () => reject(tx.error || new Error('LIBRARY_IMPORT_STORE_ABORTED'));
      });
    }
    return { open, readAll, replace, remove, clear, databaseName, version, storeName: STORE_NAME };
  }

  return { DATABASE_NAME, DATABASE_VERSION, STORE_NAME, createLibraryImportStore };
});
