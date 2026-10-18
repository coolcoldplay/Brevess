(function attach(root, factory) {
  const shared = root.SciLLM || {};
  const api = factory(shared);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(shared, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const OFFICIAL_MODEL_ENDPOINTS = Object.freeze({
    openai: 'https://api.openai.com/v1/models',
    anthropic: 'https://api.anthropic.com/v1/models?limit=1000',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    deepseek: 'https://api.deepseek.com/models',
    typesafe: 'https://api.typesafe.ai/v1/models'
  });

  const NON_GENERATIVE_MODEL_PATTERN =
    /(embedding|moderation|whisper|transcri|speech|tts|dall-e|image|realtime|audio|search|rerank)/i;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function ownData(value, key) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
      return undefined;
    }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ? descriptor.value : undefined;
    } catch (_) {
      return undefined;
    }
  }

  let getProviderTransportLease = ownData(shared, 'getProviderTransportLease');

  function captureProviderTransportLeaseExport() {
    if (typeof getProviderTransportLease === 'function') return;
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(
        shared, 'getProviderTransportLease'
      );
    } catch (_) {
      return;
    }
    if (descriptor) return;
    try {
      Object.defineProperty(shared, 'getProviderTransportLease', {
        configurable: true,
        enumerable: false,
        get() { return getProviderTransportLease; },
        set(candidate) {
          if (typeof getProviderTransportLease === 'function' ||
              typeof candidate !== 'function') return;
          getProviderTransportLease = candidate;
          try {
            Object.defineProperty(shared, 'getProviderTransportLease', {
              configurable: true,
              enumerable: true,
              value: candidate,
              writable: true
            });
          } catch (_) {
            // The captured function remains authoritative even if exposure fails.
          }
        }
      });
    } catch (_) {
      // A namespace that cannot host the capture slot fails closed without a lease.
    }
  }

  captureProviderTransportLeaseExport();

  function providerTransportLeaseFor(error) {
    if (typeof getProviderTransportLease !== 'function') return null;
    try { return getProviderTransportLease(error); } catch (_) { return null; }
  }

  function normalizedBaseUrl(value) {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname))) {
      throw modelDiscoveryError('INVALID_SETTINGS', ['baseUrl']);
    }
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url;
  }

  function modelDiscoveryError(code, fields = [], message = '') {
    const error = new Error(message || code);
    error.code = code;
    error.fields = fields;
    return error;
  }

  function modelListRequest(providerId, config = {}) {
    const apiKey = String(config.apiKey || '').trim();
    if (providerId === 'codex-local') {
      return { local: true, providerId, url: '', headers: {} };
    }
    if (!apiKey) throw modelDiscoveryError('AUTH_INVALID', ['apiKey']);

    if (providerId === 'gemini') {
      const url = new URL(OFFICIAL_MODEL_ENDPOINTS.gemini);
      url.searchParams.set('key', apiKey);
      return { providerId, url: url.href, headers: { Accept: 'application/json' } };
    }

    if (providerId === 'anthropic') {
      return {
        providerId,
        url: OFFICIAL_MODEL_ENDPOINTS.anthropic,
        headers: {
          Accept: 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': String(config.anthropicVersion || '2023-06-01')
        }
      };
    }

    let url = OFFICIAL_MODEL_ENDPOINTS[providerId] || '';
    if (providerId === 'openai-compatible') {
      const base = normalizedBaseUrl(config.baseUrl);
      base.pathname = `${base.pathname}/models`.replace(/\/+/g, '/');
      url = base.href;
    }
    if (!url) throw modelDiscoveryError('INVALID_SETTINGS', ['providerId']);
    const authHeader = providerId === 'openai-compatible'
      ? (config.authHeader || 'Authorization') : 'Authorization';
    const prefix = config.authPrefix === undefined ? 'Bearer ' :
      (config.authPrefix ? `${String(config.authPrefix).trim()} ` : '');
    return {
      providerId,
      url,
      headers: Object.assign({}, providerId === 'openai-compatible' ? config.customHeaders || {} : {}, {
        Accept: 'application/json',
        [authHeader]: `${prefix}${apiKey}`
      })
    };
  }

  function normalizeModelItem(item, providerId) {
    if (typeof item === 'string') return { id: item.trim() };
    if (!isPlainObject(item)) return null;
    const rawId = item.id || item.baseModelId || item.name;
    const id = String(rawId || '').replace(/^models\//, '').trim();
    if (!id) return null;
    if (providerId === 'gemini') {
      const methods = Array.isArray(item.supportedGenerationMethods)
        ? item.supportedGenerationMethods : [];
      if (methods.length && !methods.includes('generateContent')) return null;
    } else if (NON_GENERATIVE_MODEL_PATTERN.test(id)) {
      return null;
    }
    return {
      id,
      displayName: String(item.display_name || item.displayName || item.name || id)
        .replace(/^models\//, '').trim(),
      created: Number(item.created) || 0,
      inputTokenLimit: Number(item.inputTokenLimit) || null,
      outputTokenLimit: Number(item.outputTokenLimit) || null,
      ownedBy: String(item.owned_by || item.ownedBy || '').trim(),
      description: String(item.description || '').trim(),
      releaseDate: String(item.release_date || item.releaseDate || '').trim()
    };
  }

  function parseModelList(providerId, payload) {
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
          ? payload.models
          : [];
    const byId = new Map();
    items.forEach(item => {
      const model = normalizeModelItem(item, providerId);
      if (model?.id) byId.set(model.id, model);
    });
    return [...byId.values()].sort((left, right) =>
      (right.created || 0) - (left.created || 0) ||
      left.id.localeCompare(right.id, 'en', { numeric: true })
    );
  }

  async function discoverProviderModels({
    providerId,
    config = {},
    fetchImpl = typeof fetch === 'function' ? fetch : null,
    timeoutMs = 20000,
    signal = null
  } = {}) {
    const request = modelListRequest(providerId, config);
    if (request.local) {
      return {
        providerId,
        fetchedAt: new Date().toISOString(),
        models: [{ id: 'auto', displayName: 'auto' }]
      };
    }
    if (typeof fetchImpl !== 'function') {
      throw modelDiscoveryError('NETWORK_ERROR', [], 'Fetch is unavailable');
    }
    if (typeof shared.requestJson !== 'function') {
      throw modelDiscoveryError(
        'NETWORK_ERROR', [], 'Provider response reader is unavailable'
      );
    }

    const configuredTimeoutMs = Number(timeoutMs);
    const requestTimeoutMs = Number.isFinite(configuredTimeoutMs)
      ? Math.max(1000, configuredTimeoutMs || 20000) : 20000;
    let payload;
    try {
      payload = await shared.requestJson(fetchImpl, request.url, {
        method: 'GET',
        headers: request.headers,
        timeoutMs: requestTimeoutMs,
        signal
      });
    } catch (error) {
      const status = Math.max(0, Number(error?.status) || 0);
      const transportLease = providerTransportLeaseFor(error);
      if (error?.code === 'CANCELLED' ||
          (error?.code === 'REQUEST_TIMEOUT' &&
            (status !== 408 || transportLease))) {
        throw error;
      }
      const code = status === 401 || status === 403
        ? 'AUTH_INVALID'
        : status === 429
          ? 'RATE_LIMITED'
          : status >= 400
            ? 'PROVIDER_REJECTED'
            : error?.code === 'CANCELLED'
              ? 'REQUEST_TIMEOUT'
              : ['REQUEST_TIMEOUT', 'INVALID_RESPONSE', 'NETWORK_ERROR']
                  .includes(error?.code)
                ? error.code
                : 'NETWORK_ERROR';
      if (code === error?.code) throw error;
      throw modelDiscoveryError(code);
    }
    const models = parseModelList(providerId, payload);
    if (!models.length) throw modelDiscoveryError('INVALID_RESPONSE');
    return {
      providerId,
      fetchedAt: new Date().toISOString(),
      models
    };
  }

  return {
    OFFICIAL_MODEL_ENDPOINTS,
    modelListRequest,
    parseModelList,
    discoverProviderModels
  };
});
