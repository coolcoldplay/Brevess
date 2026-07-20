(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const OFFSCREEN_PATH = 'offscreen.html';
  const OFFSCREEN_TARGET = 'sci-offscreen-network';

  function namedError(input, fallbackMessage = 'Offscreen network request failed') {
    const error = new Error(String(input?.message || fallbackMessage).slice(0, 240));
    error.name = String(input?.name || 'TypeError').replace(/[^A-Za-z0-9_$-]/g, '') || 'TypeError';
    return error;
  }

  function responseFromResult(result) {
    const status = Number(result?.status) || 0;
    const headers = {
      get(name) {
        return String(name || '').toLowerCase() === 'retry-after'
          ? String(result?.retryAfter || '') || null : null;
      }
    };
    if (result?.success) {
      return {
        ok: status >= 200 && status < 300,
        status,
        headers,
        async text() { return String(result.body || ''); }
      };
    }
    if (result?.stage === 'response-body') {
      return {
        ok: status >= 200 && status < 300,
        status,
        headers,
        async text() { throw namedError(result.error); }
      };
    }
    throw namedError(result?.error);
  }

  function createAbortError() {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    return error;
  }

  function createOffscreenFetch(chromeApi, options = {}) {
    let creating = null;
    let requestSequence = 0;
    const requestIdFactory = options.requestIdFactory || (() =>
      `provider-${Date.now().toString(36)}-${(requestSequence += 1).toString(36)}`
    );

    async function ensureOffscreenDocument() {
      const documentUrl = chromeApi.runtime.getURL(OFFSCREEN_PATH);
      const contexts = await chromeApi.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [documentUrl]
      });
      if (contexts.length) return;
      if (!creating) {
        creating = chromeApi.offscreen.createDocument({
          url: OFFSCREEN_PATH,
          reasons: ['WORKERS'],
          justification: 'Run long provider network requests in a dedicated worker.'
        }).finally(() => { creating = null; });
      }
      await creating;
    }

    async function sendWithAbort(message, signal) {
      const pending = chromeApi.runtime.sendMessage(message);
      if (!signal) return pending;
      if (signal.aborted) {
        chromeApi.runtime.sendMessage({
          type: 'SCI_OFFSCREEN_FETCH_CANCEL',
          target: OFFSCREEN_TARGET,
          requestId: message.requestId
        }).catch(() => {});
        throw createAbortError();
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = callback => value => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          callback(value);
        };
        const onAbort = () => {
          chromeApi.runtime.sendMessage({
            type: 'SCI_OFFSCREEN_FETCH_CANCEL',
            target: OFFSCREEN_TARGET,
            requestId: message.requestId
          }).catch(() => {});
          finish(reject)(createAbortError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
        pending.then(finish(resolve), finish(reject));
      });
    }

    return async function offscreenFetch(url, fetchOptions = {}) {
      await ensureOffscreenDocument();
      const { signal, ...serializableOptions } = fetchOptions || {};
      const result = await sendWithAbort({
        type: 'SCI_OFFSCREEN_FETCH',
        target: OFFSCREEN_TARGET,
        requestId: requestIdFactory(),
        url,
        options: serializableOptions
      }, signal);
      return responseFromResult(result);
    };
  }

  return { createOffscreenFetch };
});
