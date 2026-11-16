(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function localPdfSourceHash(url) {
    try {
      const value = new URL(url);
      return value.protocol === 'file:' && !value.host
        ? /^\/brevess-local-pdf\/([a-f0-9]{64})\//u.exec(value.pathname)?.[1] || '' : '';
    } catch (_) { return ''; }
  }
  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('PDF_SOURCE_STORE_FAILED'));
    });
  }
  async function openStore() {
    const request = indexedDB.open('brevess-original-pdf-sources-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sources', { keyPath: 'hash' });
    return requestResult(request);
  }
  async function saveOriginalPdfSource(hash, blob, name) {
    if (!/^[a-f0-9]{64}$/u.test(hash) || !(blob instanceof Blob) || blob.size > 300 * 1024 * 1024) {
      throw new Error('PDF_SOURCE_INVALID');
    }
    const db = await openStore();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('sources', 'readwrite');
        transaction.oncomplete = resolve;
        transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('PDF_SOURCE_SAVE_FAILED'));
        transaction.objectStore('sources').put({ hash, blob, name: String(name || 'article.pdf').slice(0, 240), savedAt: Date.now() });
      });
    } finally { db.close(); }
  }
  async function loadOriginalPdfSource(hash) {
    if (!/^[a-f0-9]{64}$/u.test(hash)) return null;
    const db = await openStore();
    try { return await requestResult(db.transaction('sources', 'readonly').objectStore('sources').get(hash)) || null; }
    finally { db.close(); }
  }
  async function deleteOriginalPdfSource(hash) {
    if (!/^[a-f0-9]{64}$/u.test(hash)) return;
    const db = await openStore();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('sources', 'readwrite');
        transaction.oncomplete = resolve;
        transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('PDF_SOURCE_DELETE_FAILED'));
        transaction.objectStore('sources').delete(hash);
      });
    } finally { db.close(); }
  }
  return { localPdfSourceHash, saveOriginalPdfSource, loadOriginalPdfSource, deleteOriginalPdfSource };
});
