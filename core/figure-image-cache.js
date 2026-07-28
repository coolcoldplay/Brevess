(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const FIGURE_IMAGE_STORE_NAME = 'figureImages';
  const DEFAULT_MAX_BYTES = 192 * 1024 * 1024;
  const DEFAULT_MAX_ENTRIES = 320;

  function normalizeFigureImageCacheKey(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      url.username = '';
      url.password = '';
      url.hash = '';
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function figureImageCacheByteLength(record) {
    const declared = Math.max(0, Number(record?.byteLength) || 0);
    if (declared) return declared;
    return Math.max(0, Number(record?.bytes?.byteLength || record?.bytes?.length) || 0);
  }

  function selectFigureImageCacheEvictions(
    records,
    maxBytes = DEFAULT_MAX_BYTES,
    maxEntries = DEFAULT_MAX_ENTRIES
  ) {
    const ordered = (Array.isArray(records) ? records : [])
      .filter(record => record?.cacheKey)
      .sort((left, right) =>
        (Number(left?.lastAccessedAt) || 0) - (Number(right?.lastAccessedAt) || 0));
    let totalBytes = ordered.reduce(
      (sum, record) => sum + figureImageCacheByteLength(record),
      0
    );
    let totalEntries = ordered.length;
    const evictions = [];
    for (const record of ordered) {
      if (totalBytes <= maxBytes && totalEntries <= maxEntries) break;
      evictions.push(record.cacheKey);
      totalBytes -= figureImageCacheByteLength(record);
      totalEntries -= 1;
    }
    return evictions;
  }

  function createIndexedDbFigureImageCache(indexedDbRef, options = {}) {
    const maxBytes = Math.max(
      16 * 1024 * 1024,
      Number(options.maxBytes) || DEFAULT_MAX_BYTES
    );
    const maxEntries = Math.max(20, Number(options.maxEntries) || DEFAULT_MAX_ENTRIES);

    async function get(sourceUrl) {
      const cacheKey = normalizeFigureImageCacheKey(sourceUrl);
      if (!cacheKey) return null;
      return shared.runUserDataTransaction(
        indexedDbRef,
        FIGURE_IMAGE_STORE_NAME,
        'readwrite',
        async transaction => {
          const store = transaction.objectStore(FIGURE_IMAGE_STORE_NAME);
          const record = await shared.requestToPromise(store.get(cacheKey));
          if (!record) return null;
          record.lastAccessedAt = Date.now();
          store.put(record);
          return record;
        }
      );
    }

    async function prune() {
      return shared.runUserDataTransaction(
        indexedDbRef,
        FIGURE_IMAGE_STORE_NAME,
        'readwrite',
        async transaction => {
          const store = transaction.objectStore(FIGURE_IMAGE_STORE_NAME);
          const records = await shared.requestToPromise(store.getAll());
          const evictions = selectFigureImageCacheEvictions(
            records,
            maxBytes,
            maxEntries
          );
          evictions.forEach(cacheKey => store.delete(cacheKey));
          return {
            evicted: evictions.length,
            remaining: Math.max(0, records.length - evictions.length)
          };
        }
      );
    }

    async function put(input = {}) {
      const cacheKey = normalizeFigureImageCacheKey(
        input.cacheKey || input.requestedSourceUrl || input.sourceUrl
      );
      const bytes = input.bytes instanceof Uint8Array
        ? input.bytes : new Uint8Array(input.bytes || []);
      if (!cacheKey || !bytes.length) return null;
      const now = Date.now();
      const record = {
        cacheKey,
        sourceUrl: normalizeFigureImageCacheKey(input.sourceUrl) || cacheKey,
        contentType: String(input.contentType || 'application/octet-stream'),
        byteLength: bytes.byteLength,
        bytes,
        createdAt: Math.max(0, Number(input.createdAt) || now),
        lastAccessedAt: now
      };
      await shared.runUserDataTransaction(
        indexedDbRef,
        FIGURE_IMAGE_STORE_NAME,
        'readwrite',
        transaction => {
          transaction.objectStore(FIGURE_IMAGE_STORE_NAME).put(record);
          return record;
        }
      );
      await prune();
      return record;
    }

    async function clear() {
      return shared.runUserDataTransaction(
        indexedDbRef,
        FIGURE_IMAGE_STORE_NAME,
        'readwrite',
        transaction => {
          transaction.objectStore(FIGURE_IMAGE_STORE_NAME).clear();
          return true;
        }
      );
    }

    return Object.freeze({ get, put, prune, clear });
  }

  return {
    FIGURE_IMAGE_STORE_NAME,
    DEFAULT_FIGURE_IMAGE_CACHE_MAX_BYTES: DEFAULT_MAX_BYTES,
    DEFAULT_FIGURE_IMAGE_CACHE_MAX_ENTRIES: DEFAULT_MAX_ENTRIES,
    normalizeFigureImageCacheKey,
    figureImageCacheByteLength,
    selectFigureImageCacheEvictions,
    createIndexedDbFigureImageCache
  };
});
