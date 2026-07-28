(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const OFFICIAL_MODEL_ENDPOINTS = Object.freeze({
    openai: 'https://api.openai.com/v1/models',
    anthropic: 'https://api.anthropic.com/v1/models?limit=1000',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    deepseek: 'https://api.deepseek.com/models'
  });

  const NON_GENERATIVE_MODEL_PATTERN =
    /(embedding|moderation|whisper|transcri|speech|tts|dall-e|image|realtime|audio|search|rerank)/i;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
    return {
      providerId,
      url,
      headers: {
        Accept: 'application/json',
        Authorization: `${String(config.authPrefix ?? 'Bearer').trim()} ${apiKey}`.trim()
      }
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
      ownedBy: String(item.owned_by || item.ownedBy || '').trim()
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
    timeoutMs = 20000
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

    const controller = typeof AbortController === 'function'
      ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 20000))
      : null;
    let response;
    try {
      response = await fetchImpl(request.url, {
        method: 'GET',
        headers: request.headers,
        ...(controller ? { signal: controller.signal } : {})
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw modelDiscoveryError('REQUEST_TIMEOUT');
      }
      throw modelDiscoveryError('NETWORK_ERROR');
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    if (!response?.ok) {
      const code = response?.status === 401 || response?.status === 403
        ? 'AUTH_INVALID'
        : response?.status === 429
          ? 'RATE_LIMITED'
          : 'PROVIDER_REJECTED';
      throw modelDiscoveryError(code);
    }
    let payload;
    try {
      payload = typeof response.json === 'function'
        ? await response.json()
        : JSON.parse(await response.text());
    } catch {
      throw modelDiscoveryError('INVALID_RESPONSE');
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
