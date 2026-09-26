(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const ACTIONS = new Set(['accepted', 'rejected', 'corrected']);
  const EXPORT_FIELDS = [
    'documentHash', 'paragraphId', 'sectionTitle', 'contextBefore', 'quote', 'contextAfter',
    'categoryId', 'confidence', 'reasonZh', 'userAction', 'correctedCategoryId', 'createdAt'
  ];

  function createSampleId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `sample-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function clip(value, length) {
    return String(value || '').slice(0, length);
  }

  function normalizeFeedbackSample(input) {
    const action = ACTIONS.has(input?.userAction) ? input.userAction : 'accepted';
    const confidence = Number(input?.confidence);
    return {
      sampleId: String(input?.sampleId || createSampleId()),
      documentHash: clip(input?.documentHash, 128),
      paragraphId: clip(input?.paragraphId, 160),
      sectionTitle: clip(input?.sectionTitle, 160),
      contextBefore: clip(input?.contextBefore, 240),
      quote: clip(input?.quote, 1600),
      contextAfter: clip(input?.contextAfter, 240),
      categoryId: clip(input?.categoryId, 120),
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
      reasonZh: clip(input?.reasonZh, 240),
      userAction: action,
      correctedCategoryId: action === 'corrected' ? clip(input?.correctedCategoryId, 120) : '',
      createdAt: input?.createdAt || new Date().toISOString()
    };
  }

  function summarize(samples) {
    const stats = { total: samples.length, accepted: 0, rejected: 0, corrected: 0, documents: 0 };
    const documents = new Set();
    samples.forEach(sample => {
      if (stats[sample.userAction] !== undefined) stats[sample.userAction] += 1;
      if (sample.documentHash) documents.add(sample.documentHash);
    });
    stats.documents = documents.size;
    return stats;
  }

  function createMemoryCorpusStore() {
    const samples = [];
    return {
      async add(sample) {
        samples.push(normalizeFeedbackSample(sample));
        return samples.at(-1);
      },
      async list() {
        return samples.map(sample => ({ ...sample }));
      },
      async stats() {
        return summarize(samples);
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

  function createIndexedDbCorpusStore(indexedDbRef) {
    let databasePromise;
    function openDatabase() {
      if (!databasePromise) {
        databasePromise = new Promise((resolve, reject) => {
          const request = indexedDbRef.open('sci-logic-highlighter-corpus', 1);
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains('samples')) {
              const store = request.result.createObjectStore('samples', { keyPath: 'sampleId' });
              store.createIndex('createdAt', 'createdAt');
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      return databasePromise;
    }
    async function add(input) {
      const sample = normalizeFeedbackSample(input);
      const database = await openDatabase();
      const transaction = database.transaction('samples', 'readwrite');
      transaction.objectStore('samples').put(sample);
      await transactionDone(transaction);
      return sample;
    }
    async function list() {
      const database = await openDatabase();
      const transaction = database.transaction('samples', 'readonly');
      const samples = await requestToPromise(transaction.objectStore('samples').getAll());
      await transactionDone(transaction);
      return samples.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    }
    async function stats() {
      return summarize(await list());
    }
    return { add, list, stats };
  }

  function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCorpus(samples, format) {
    const safe = samples.map(normalizeFeedbackSample);
    if (format === 'csv') {
      return [
        EXPORT_FIELDS.join(','),
        ...safe.map(sample => EXPORT_FIELDS.map(field => csvCell(sample[field])).join(','))
      ].join('\n');
    }
    return safe.map(sample => JSON.stringify(
      Object.fromEntries(EXPORT_FIELDS.map(field => [field, sample[field]]), null, 0)
    )).join('\n');
  }

  function phrasesFor(text) {
    const tokens = String(text || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const phrases = [];
    for (let size = 2; size <= Math.min(5, tokens.length); size += 1) {
      for (let start = 0; start + size <= tokens.length; start += 1) {
        phrases.push(tokens.slice(start, start + size).join(' '));
      }
    }
    return phrases;
  }

  function distillOfflineRules(samples, categoryMap, options = {}) {
    const minDocuments = Number(options.minDocuments) || 3;
    const positive = new Map();
    const rejected = new Map();

    samples.map(normalizeFeedbackSample).forEach(sample => {
      const categoryId = sample.userAction === 'corrected' && sample.correctedCategoryId
        ? sample.correctedCategoryId : sample.categoryId;
      const target = sample.userAction === 'rejected' ? rejected : positive;
      if (!target.has(categoryId)) target.set(categoryId, new Map());
      phrasesFor(sample.quote).forEach(phrase => {
        const entry = target.get(categoryId).get(phrase) || { documents: new Set(), support: 0 };
        if (sample.documentHash) entry.documents.add(sample.documentHash);
        entry.support += 1;
        target.get(categoryId).set(phrase, entry);
      });
    });

    const pack = {};
    positive.forEach((phrases, categoryId) => {
      const patterns = [...phrases.entries()]
        .filter(([phrase, entry]) =>
          entry.documents.size >= minDocuments && !rejected.get(categoryId)?.has(phrase)
        )
        .sort((a, b) =>
          b[1].documents.size - a[1].documents.size ||
          b[1].support - a[1].support ||
          a[0].length - b[0].length
        )
        .slice(0, 30)
        .map(([phrase]) => phrase);
      if (!patterns.length) return;
      const category = categoryMap[categoryId] || {};
      pack[categoryId] = {
        name: category.name || categoryId,
        color: category.color || '#8EC5FF',
        patterns,
        isBuiltIn: false,
        isRegex: false,
        distilledFromCorpus: true
      };
    });
    return pack;
  }

  return {
    normalizeFeedbackSample,
    createMemoryCorpusStore,
    createIndexedDbCorpusStore,
    exportCorpus,
    distillOfflineRules
  };
});
