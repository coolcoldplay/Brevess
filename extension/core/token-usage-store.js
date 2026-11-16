(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const TOKEN_USAGE_STORAGE_KEY = 'sciLlmTokenUsageV1';
  const TOKEN_USAGE_SCHEMA_VERSION = 1;
  const MAX_DOCUMENTS = 500;
  const TOKEN_FIELDS = Object.freeze([
    'inputTokens', 'outputTokens', 'reasoningTokens',
    'cacheHitTokens', 'cacheMissTokens'
  ]);

  function boundedInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0
      ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(number)) : 0;
  }

  function normalizeCanonicalUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (!/^https?:$/u.test(parsed.protocol)) return '';
      parsed.username = '';
      parsed.password = '';
      parsed.hash = '';
      parsed.search = '';
      parsed.hostname = parsed.hostname.toLocaleLowerCase('en-US');
      parsed.pathname = parsed.pathname.replace(/\/{2,}/gu, '/').replace(/\/+$/u, '') || '/';
      return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname}`;
    } catch (_) {
      return '';
    }
  }

  function createUsageCounter() {
    return {
      requests: 0,
      exactRequests: 0,
      estimatedRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0
    };
  }

  function normalizeCounter(value = {}) {
    const result = createUsageCounter();
    Object.keys(result).forEach(field => {
      result[field] = boundedInteger(value?.[field]);
    });
    return result;
  }

  function addUsage(counter, usage) {
    const result = normalizeCounter(counter);
    result.requests += 1;
    result[usage.estimated ? 'estimatedRequests' : 'exactRequests'] += 1;
    TOKEN_FIELDS.forEach(field => {
      result[field] = Math.min(
        Number.MAX_SAFE_INTEGER,
        result[field] + boundedInteger(usage[field])
      );
    });
    return result;
  }

  function publicDocument(record = {}) {
    const features = Object.fromEntries(
      Object.entries(record.features || {}).map(([featureId, feature]) => [
        featureId,
        {
          featureId,
          label: String(feature.label || featureId).slice(0, 80),
          ...normalizeCounter(feature),
          models: Object.fromEntries(
            Object.entries(feature.models || {}).map(([key, model]) => [
              key,
              {
                providerId: String(model.providerId || '').slice(0, 80),
                model: String(model.model || '').slice(0, 160),
                ...normalizeCounter(model)
              }
            ])
          )
        }
      ])
    );
    return {
      schemaVersion: TOKEN_USAGE_SCHEMA_VERSION,
      documentKey: String(record.documentKey || ''),
      canonicalUrl: String(record.canonicalUrl || ''),
      title: String(record.title || ''),
      createdAt: String(record.createdAt || ''),
      updatedAt: String(record.updatedAt || ''),
      totals: normalizeCounter(record.totals),
      features
    };
  }

  function emptyState() {
    return {
      schemaVersion: TOKEN_USAGE_SCHEMA_VERSION,
      documents: {}
    };
  }

  function normalizeState(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        input.schemaVersion !== TOKEN_USAGE_SCHEMA_VERSION ||
        !input.documents || typeof input.documents !== 'object') {
      return emptyState();
    }
    const documents = {};
    Object.entries(input.documents).slice(0, MAX_DOCUMENTS * 2)
      .forEach(([key, value]) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;
        const normalized = publicDocument({ ...value, documentKey: key });
        if (normalized.documentKey) documents[key] = normalized;
      });
    return { schemaVersion: TOKEN_USAGE_SCHEMA_VERSION, documents };
  }

  function createMemoryStorageArea(seed = {}) {
    let values = { ...seed };
    return {
      async get(key) {
        return { [key]: values[key] };
      },
      async set(next) {
        values = { ...values, ...next };
      }
    };
  }

  function createTokenUsageStore(storageArea = createMemoryStorageArea()) {
    let mutationTail = Promise.resolve();

    async function readState() {
      const stored = await storageArea.get(TOKEN_USAGE_STORAGE_KEY);
      return normalizeState(stored?.[TOKEN_USAGE_STORAGE_KEY]);
    }

    async function writeState(state) {
      await storageArea.set({ [TOKEN_USAGE_STORAGE_KEY]: state });
    }

    function serialize(operation) {
      const pending = mutationTail.then(operation, operation);
      mutationTail = pending.catch(() => undefined);
      return pending;
    }

    async function record(input = {}) {
      return serialize(async () => {
        const canonicalUrl = normalizeCanonicalUrl(
          input.canonicalUrl || input.url
        );
        const suppliedKey = String(input.documentKey || '').trim().slice(0, 500);
        const documentKey = canonicalUrl || suppliedKey;
        if (!documentKey) return { recorded: false, reason: 'document-missing' };
        const featureId = String(input.featureId || 'other')
          .replace(/[^a-z0-9_-]/giu, '_').slice(0, 80) || 'other';
        const featureLabel = String(input.featureLabel || featureId).trim().slice(0, 80);
        const providerId = String(input.providerId || 'unknown').trim().slice(0, 80);
        const model = String(input.model || 'unknown').trim().slice(0, 160);
        const modelKey = `${providerId}\u0000${model}`;
        const now = new Date().toISOString();
        const usage = {
          estimated: input.estimated === true,
          ...Object.fromEntries(TOKEN_FIELDS.map(field => [field, boundedInteger(input[field])]))
        };
        const state = await readState();
        const current = state.documents[documentKey] || {
          schemaVersion: TOKEN_USAGE_SCHEMA_VERSION,
          documentKey,
          canonicalUrl,
          title: '',
          createdAt: now,
          updatedAt: now,
          totals: createUsageCounter(),
          features: {}
        };
        const feature = current.features?.[featureId] || {
          featureId,
          label: featureLabel,
          ...createUsageCounter(),
          models: {}
        };
        const modelUsage = feature.models?.[modelKey] || {
          providerId,
          model,
          ...createUsageCounter()
        };
        feature.models = {
          ...(feature.models || {}),
          [modelKey]: {
            providerId,
            model,
            ...addUsage(modelUsage, usage)
          }
        };
        const nextFeature = {
          featureId,
          label: featureLabel || feature.label,
          ...addUsage(feature, usage),
          models: feature.models
        };
        const next = {
          ...current,
          schemaVersion: TOKEN_USAGE_SCHEMA_VERSION,
          documentKey,
          canonicalUrl: canonicalUrl || current.canonicalUrl,
          title: String(input.title || current.title || '').trim().slice(0, 1000),
          createdAt: current.createdAt || now,
          updatedAt: now,
          totals: addUsage(current.totals, usage),
          features: {
            ...(current.features || {}),
            [featureId]: nextFeature
          }
        };
        state.documents[documentKey] = next;
        const ordered = Object.values(state.documents)
          .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
          .slice(0, MAX_DOCUMENTS);
        state.documents = Object.fromEntries(ordered.map(item => [item.documentKey, item]));
        await writeState(state);
        return { recorded: true, document: publicDocument(next) };
      });
    }

    async function list() {
      const state = await readState();
      return Object.values(state.documents)
        .map(publicDocument)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    async function getForDocument(input = {}) {
      const state = await readState();
      const canonicalUrl = normalizeCanonicalUrl(input.canonicalUrl || input.url);
      const key = canonicalUrl || String(input.documentKey || '').trim();
      return state.documents[key] ? publicDocument(state.documents[key]) : null;
    }

    async function clearDocument(input = {}) {
      return serialize(async () => {
        const state = await readState();
        const canonicalUrl = normalizeCanonicalUrl(input.canonicalUrl || input.url);
        const key = canonicalUrl || String(input.documentKey || '').trim();
        const deleted = Boolean(key && state.documents[key]);
        if (deleted) {
          delete state.documents[key];
          await writeState(state);
        }
        return { deleted };
      });
    }

    return { record, list, getForDocument, clearDocument };
  }

  return {
    TOKEN_USAGE_STORAGE_KEY,
    TOKEN_USAGE_SCHEMA_VERSION,
    normalizeTokenUsageCanonicalUrl: normalizeCanonicalUrl,
    createMemoryTokenUsageStorageArea: createMemoryStorageArea,
    createTokenUsageStore
  };
});
