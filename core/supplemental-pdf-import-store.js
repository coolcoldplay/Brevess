(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const DATABASE_NAME = 'brevess-supplemental-pdf-imports-v1';
  const STORE_NAME = 'imports';
  const MAX_AGE_MS = 30 * 60 * 1000;
  const STATUS_PREFIX = 'brevessSupplementalPdfImportStatus:';

  function normalizeSupplementalPdfImportToken(value) {
    const token = String(value || '').trim();
    return /^[a-z0-9][a-z0-9_-]{15,95}$/i.test(token) ? token : '';
  }

  function supplementalPdfImportStatusKey(value) {
    const token = normalizeSupplementalPdfImportToken(value);
    return token ? `${STATUS_PREFIX}${token}` : '';
  }

  function importError(code) {
    return Object.assign(new Error(code), { code });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || importError('PDF_IMPORT_STORE_FAILED'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(
        transaction.error || importError('PDF_IMPORT_STORE_FAILED')
      );
      transaction.onabort = () => reject(
        transaction.error || importError('PDF_IMPORT_STORE_ABORTED')
      );
    });
  }

  async function openDatabase(indexedDb = globalThis.indexedDB) {
    if (!indexedDb?.open) throw importError('PDF_IMPORT_STORE_UNAVAILABLE');
    const request = indexedDb.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'token' });
      }
    };
    return requestResult(request);
  }

  function createToken(cryptoApi = globalThis.crypto) {
    const uuid = cryptoApi?.randomUUID?.();
    if (uuid) return `pdf_${uuid.replace(/-/g, '')}`;
    const bytes = new Uint8Array(18);
    cryptoApi?.getRandomValues?.(bytes);
    if (!bytes.some(Boolean)) throw importError('PDF_IMPORT_RANDOM_UNAVAILABLE');
    return `pdf_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  async function deleteExpiredRecords(database, now = Date.now()) {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const completed = transactionDone(transaction);
    const request = transaction.objectStore(STORE_NAME).openCursor();
    let removed = 0;
    await new Promise((resolve, reject) => {
      request.onerror = () => reject(
        request.error || importError('PDF_IMPORT_STORE_FAILED')
      );
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (Number(cursor.value?.expiresAt) <= now) {
          cursor.delete();
          removed += 1;
        }
        cursor.continue();
      };
    });
    await completed;
    return removed;
  }

  async function cleanupExpiredSupplementalPdfImports(options = {}) {
    const database = await openDatabase(options.indexedDb);
    try {
      return await deleteExpiredRecords(database, Number(options.now) || Date.now());
    } finally {
      database.close();
    }
  }

  async function saveSupplementalPdfImportSession(file, options = {}) {
    if (!(file instanceof Blob) || !file.size) throw importError('SUPPLEMENTAL_PDF_INVALID');
    const maximum = Math.max(1, Number(options.maximumBytes) || 300 * 1024 * 1024);
    if (file.size > maximum) throw importError('PDF_LOCAL_FILE_TOO_LARGE');
    const token = normalizeSupplementalPdfImportToken(options.token) || createToken(
      options.cryptoApi
    );
    const now = Date.now();
    const database = await openDatabase(options.indexedDb);
    try {
      await deleteExpiredRecords(database, now);
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.put({
        token,
        blob: file,
        name: String(file.name || 'supplement.pdf').slice(0, 500),
        type: String(file.type || 'application/pdf').slice(0, 100),
        size: file.size,
        createdAt: now,
        expiresAt: now + MAX_AGE_MS
      });
      await transactionDone(transaction);
      return token;
    } finally {
      database.close();
    }
  }

  async function consumeSupplementalPdfImportSession(value, options = {}) {
    const token = normalizeSupplementalPdfImportToken(value);
    if (!token) throw importError('SUPPLEMENTAL_PDF_IMPORT_TOKEN_INVALID');
    const database = await openDatabase(options.indexedDb);
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const record = await requestResult(store.get(token));
      store.delete(token);
      await transactionDone(transaction);
      if (!record || Number(record.expiresAt) <= Date.now() || !(record.blob instanceof Blob)) {
        throw importError('SUPPLEMENTAL_PDF_IMPORT_EXPIRED');
      }
      return {
        token,
        blob: record.blob,
        name: String(record.name || 'supplement.pdf').slice(0, 500),
        type: String(record.type || 'application/pdf').slice(0, 100),
        size: Number(record.size) || record.blob.size
      };
    } finally {
      database.close();
    }
  }

  async function discardSupplementalPdfImportSession(value, options = {}) {
    const token = normalizeSupplementalPdfImportToken(value);
    if (!token) return false;
    const database = await openDatabase(options.indexedDb);
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(token);
      await transactionDone(transaction);
      return true;
    } finally {
      database.close();
    }
  }

  if (globalThis.indexedDB?.open && typeof globalThis.queueMicrotask === 'function') {
    queueMicrotask(() => cleanupExpiredSupplementalPdfImports().catch(() => {}));
  }

  return {
    normalizeSupplementalPdfImportToken,
    supplementalPdfImportStatusKey,
    saveSupplementalPdfImportSession,
    consumeSupplementalPdfImportSession,
    discardSupplementalPdfImportSession,
    cleanupExpiredSupplementalPdfImports
  };
});
