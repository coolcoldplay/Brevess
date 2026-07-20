(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const ANALYSIS_CACHE_VERSIONS = {
    prompt: '9',
    chunker: '4',
    classifier: shared.PROFILE_CLASSIFIER_VERSION || '2',
    ledger: shared.EVIDENCE_LEDGER_VERSION || '2'
  };

  async function hashDocument(paragraphs, cryptoImpl = globalThis.crypto) {
    const canonical = JSON.stringify(paragraphs.map(item => ({
      paragraphId: item.paragraphId,
      sectionTitle: item.sectionTitle || '',
      sectionKind: item.sectionKind || '',
      headingLevel: Number(item.headingLevel) || 0,
      headingPath: (Array.isArray(item.headingPath) ? item.headingPath : []).map(heading => ({
        level: Number(heading?.level) || 0,
        sectionId: heading?.sectionId || '',
        title: heading?.title || ''
      })),
      text: item.text
    })));
    const bytes = new TextEncoder().encode(canonical);
    const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function createMemoryAnalysisCache() {
    const entries = new Map();
    return {
      async getMany(keys) {
        return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
      },
      async setMany(values) {
        values.forEach(value => entries.set(value.key, value));
      },
      async deleteMany(keys) {
        keys.forEach(key => entries.delete(key));
      }
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

  function createIndexedDbAnalysisCache(indexedDbRef, options = {}) {
    const databaseName = options.databaseName || 'sci-logic-highlighter';
    const maxEntries = Number(options.maxEntries) || 360;
    const maxAgeMs = Number(options.maxAgeMs) || 30 * 24 * 60 * 60 * 1000;
    let databasePromise;

    function openDatabase() {
      if (!databasePromise) {
        databasePromise = new Promise((resolve, reject) => {
          const request = indexedDbRef.open(databaseName, 1);
          request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains('analysisCache')) {
              const store = database.createObjectStore('analysisCache', { keyPath: 'key' });
              store.createIndex('createdAt', 'createdAt');
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      return databasePromise;
    }

    async function getMany(keys) {
      const database = await openDatabase();
      const transaction = database.transaction('analysisCache', 'readonly');
      const store = transaction.objectStore('analysisCache');
      const results = await Promise.all(keys.map(key => requestToPromise(store.get(key))));
      await transactionDone(transaction);
      return new Map(results.filter(Boolean).map(entry => [entry.key, entry]));
    }

    async function prune(database) {
      const readTransaction = database.transaction('analysisCache', 'readonly');
      const all = await requestToPromise(readTransaction.objectStore('analysisCache').getAll());
      await transactionDone(readTransaction);
      const cutoff = Date.now() - maxAgeMs;
      const sorted = all.sort((a, b) => b.createdAt - a.createdAt);
      const removeKeys = sorted
        .filter((entry, index) => entry.createdAt < cutoff || index >= maxEntries)
        .map(entry => entry.key);
      if (!removeKeys.length) return;
      const writeTransaction = database.transaction('analysisCache', 'readwrite');
      const store = writeTransaction.objectStore('analysisCache');
      removeKeys.forEach(key => store.delete(key));
      await transactionDone(writeTransaction);
    }

    async function setMany(values) {
      const database = await openDatabase();
      const transaction = database.transaction('analysisCache', 'readwrite');
      const store = transaction.objectStore('analysisCache');
      values.forEach(value => store.put(value));
      await transactionDone(transaction);
      await prune(database);
    }

    async function deleteMany(keys) {
      if (!Array.isArray(keys) || !keys.length) return;
      const database = await openDatabase();
      const transaction = database.transaction('analysisCache', 'readwrite');
      const store = transaction.objectStore('analysisCache');
      keys.forEach(key => store.delete(key));
      await transactionDone(transaction);
    }

    return { getMany, setMany, deleteMany };
  }

  function expandAnnotations(groups) {
    return groups.flatMap(group => (group.categories || []).map(category => ({
      paragraphId: group.paragraphId,
      start: group.start,
      end: group.end,
      quote: group.quote,
      categoryId: category.categoryId,
      confidence: category.confidence,
      reasonZh: category.reasonZh || '',
      annotationId: category.annotationId || '',
      relationId: category.relationId || '',
      claimMode: category.claimMode || 'explicit',
      quoteRole: category.quoteRole || 'statement',
      slots: Array.isArray(category.slots) ? category.slots : [],
      minimumConfidence: Number(category.minimumConfidence) || 0.8
    })));
  }

  function filterAnnotations(groups, categoryId) {
    return groups.flatMap(group => {
      const categories = (group.categories || []).filter(item => item.categoryId === categoryId);
      return categories.length ? [Object.assign({}, group, { categories })] : [];
    });
  }

  async function analyzeWithCategoryCache({
    paragraphs,
    selectedCategories,
    providerId,
    model,
    profileSignature = '',
    adapter,
    cacheStore,
    maxChars = 12000,
    concurrency = 3,
    contextHash = '',
    viewId = 'quick_story',
    paperBlueprint = {},
    studyProfile = null,
    signal,
    waitIfPaused,
    onProgress,
    onChunkComplete = async () => {}
  }) {
    const documentHash = await hashDocument(paragraphs);
    const signatureByCategory = new Map(selectedCategories.map(category => [
      category.categoryId,
      shared.buildEffectiveCategorySignature(category)
    ]));
    const keyByCategory = new Map(selectedCategories.map(category => [
      category.categoryId,
      shared.buildCategoryCacheKey({
        documentHash,
        providerId,
        model,
        profileSignature,
        categoryId: category.categoryId,
        categoryVersion: category.version,
        effectiveCategorySignature: signatureByCategory.get(category.categoryId),
        promptVersion: ANALYSIS_CACHE_VERSIONS.prompt,
        chunkerVersion: ANALYSIS_CACHE_VERSIONS.chunker,
        contextHash
      })
    ]));
    const cached = await cacheStore.getMany([...keyByCategory.values()]);
    const cachedCategoryIds = selectedCategories
      .filter(category => cached.has(keyByCategory.get(category.categoryId)))
      .map(category => category.categoryId);
    const missingCategories = selectedCategories.filter(category =>
      !cached.has(keyByCategory.get(category.categoryId))
    );
    const cachedAnnotations = cachedCategoryIds.flatMap(categoryId =>
      cached.get(keyByCategory.get(categoryId)).annotations || []
    );

    let fresh = { annotations: [], analyzedCategoryIds: [], rejected: [] };
    if (missingCategories.length) {
      const progressKey = `progress:${shared.stableHash({
        documentHash,
        providerId,
        model,
        profileSignature,
        categories: missingCategories.map(category => [
          category.categoryId,
          signatureByCategory.get(category.categoryId)
        ]),
        promptVersion: ANALYSIS_CACHE_VERSIONS.prompt,
        chunkerVersion: ANALYSIS_CACHE_VERSIONS.chunker,
        contextHash,
        viewId,
        maxChars,
        concurrency
      })}`;
      const storedProgress = await cacheStore.getMany([progressKey]);
      const progressChunks = { ...(storedProgress.get(progressKey)?.chunks || {}) };
      fresh = await shared.analyzeDocument({
        paragraphs,
        selectedCategories: missingCategories,
        adapter,
        maxChars,
        concurrency,
        viewId,
        paperBlueprint,
        studyProfile,
        signal,
        waitIfPaused,
        resumeChunks: progressChunks,
        onChunkComplete: async completed => {
          progressChunks[completed.chunkId] = completed;
          await cacheStore.setMany([{
            key: progressKey,
            createdAt: Date.now(),
            chunks: progressChunks
          }]);
          await onChunkComplete(completed);
        },
        onProgress
      });
      const now = Date.now();
      await cacheStore.setMany(missingCategories.map(category => ({
        key: keyByCategory.get(category.categoryId),
        categoryId: category.categoryId,
        effectiveCategorySignature: signatureByCategory.get(category.categoryId),
        createdAt: now,
        annotations: filterAnnotations(fresh.annotations, category.categoryId)
      })));
    }

    return {
      annotations: shared.mergeAnnotations(expandAnnotations([...cachedAnnotations, ...fresh.annotations])),
      analyzedCategoryIds: missingCategories.map(category => category.categoryId),
      cachedCategoryIds,
      rejected: fresh.rejected || [],
      documentHash
    };
  }

  return {
    hashDocument,
    createMemoryAnalysisCache,
    createIndexedDbAnalysisCache,
    analyzeWithCategoryCache,
    ANALYSIS_CACHE_VERSIONS
  };
});
