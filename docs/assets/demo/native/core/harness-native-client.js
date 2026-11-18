(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const HARNESS_NATIVE_HOST = 'com.sci_reader.codex_bridge';
  const failure = (code, message) => Object.assign(new Error(message || code), { code, retryable: false });

  function createHarnessNativeClient(runtime) {
    if (!runtime || typeof runtime.connectNative !== 'function') throw failure('HARNESS_START_FAILED', 'Native Messaging is unavailable');
    const streams = new Map(), controls = new Map();
    let port, sequence = 0, closed = false;
    const nextId = () => 'harness-' + Date.now().toString(36) + '-' + (++sequence).toString(36);

    function finish(id, event) {
      const pending = streams.get(id); if (!pending) return;
      streams.delete(id); clearTimeout(pending.timer);
      pending.signal?.removeEventListener('abort', pending.abort);
      if (event) pending.push(event); pending.end();
    }
    function cancel(id, reason = 'cancelled') {
      if (!streams.has(id)) return;
      try { port?.postMessage({ type: 'harness.turn.cancel', requestId: id }); } catch {}
      finish(id, reason === 'timeout' ? { type: 'error', error: { code: 'REQUEST_TIMEOUT', message: 'Harness request timed out', retryable: true } } : { type: 'cancelled' });
    }
    function cancelControl(id, reason = 'cancelled') {
      const pending = controls.get(id); if (!pending) return;
      controls.delete(id); clearTimeout(pending.timer);
      pending.signal?.removeEventListener('abort', pending.abort);
      try { port?.postMessage({ type: 'harness.control.cancel', requestId: id }); } catch {}
      pending.reject(failure(reason === 'timeout' ? 'REQUEST_TIMEOUT' : 'CANCELLED',
        reason === 'timeout' ? 'Harness control request timed out' : 'Harness control request cancelled'));
    }
    function disconnect() {
      port = null;
      for (const [id, pending] of controls) { clearTimeout(pending.timer); pending.signal?.removeEventListener('abort', pending.abort); pending.reject(failure('HARNESS_PROCESS_EXITED', 'Harness bridge disconnected')); controls.delete(id); }
      for (const id of [...streams.keys()]) finish(id, { type: 'error', error: { code: 'HARNESS_PROCESS_EXITED', message: 'Harness bridge disconnected', retryable: true } });
      // Chrome lastError must be observed, but its potentially identifying text is not exposed.
      void runtime.lastError;
    }
    function receive(message = {}) {
      const id = String(message.requestId || ''), type = String(message.type || '');
      // Pre-Harness companions reject these requests at their outer dispatch.
      // Preserve Harness payload validation errors from newer companions.
      const error = type === 'host.error' && message.error?.code === 'INVALID_SETTINGS'
        ? { code: 'HARNESS_BRIDGE_OUTDATED', retryable: false,
          message: 'The registered local bridge does not support Harness. Update the Windows companion and reload the extension.' }
        : message.error;
      const control = controls.get(id);
      if (control && (type === control.responseType || type === 'harness.error' || type === 'host.error')) {
        controls.delete(id); clearTimeout(control.timer);
        control.signal?.removeEventListener('abort', control.abort);
        if (error) {
          const details = { ...error };
          control.reject(Object.assign(failure(details.code, details.message), details));
        }
        else control.resolve(message); return;
      }
      const pending = streams.get(id); if (!pending) return;
      if (type === 'host.error' || type === 'harness.error') { finish(id, { type: 'error', error }); return; }
      if (!type.startsWith('harness.turn.')) return;
      const suffix = type.slice('harness.turn.'.length);
      if (suffix === 'delta') pending.push({ type: 'text_delta', text: String(message.text || '') });
      else if (suffix === 'started') pending.push({ type: 'metadata', model: message.model, sessionId: message.sessionId });
      else if (suffix === 'usage') pending.push({ type: 'usage', usage: message.usage });
      else if (['completed', 'error', 'cancelled'].includes(suffix)) finish(id, {
        type: suffix, model: message.model, usage: message.usage, elapsedMs: message.elapsedMs,
        finishReason: message.finishReason, ...(message.error ? { error: message.error } : {}),
        ...(suffix === 'completed' && message.webSearch ? { webSearch: message.webSearch } : {})
      });
    }
    function connect() {
      if (closed) throw failure('HARNESS_START_FAILED', 'Harness client is closed');
      if (!port) {
        port = runtime.connectNative(HARNESS_NATIVE_HOST);
        port.onMessage.addListener(receive); port.onDisconnect.addListener(disconnect);
      }
      return port;
    }
    function control(type, responseType, options = {}) {
      const id = nextId();
      return new Promise((resolve, reject) => {
        if (options.signal?.aborted) { reject(failure('CANCELLED', 'Harness control request cancelled')); return; }
        const timer = setTimeout(() => cancelControl(id, 'timeout'), Math.max(1000, Math.min(60000, Number(options.timeoutMs) || 20000)));
        const pending = { resolve, reject, timer, responseType, signal: options.signal, abort: () => cancelControl(id) };
        controls.set(id, pending);
        options.signal?.addEventListener('abort', pending.abort, { once: true });
        try { connect().postMessage({ type, requestId: id }); }
        catch (error) { controls.delete(id); clearTimeout(timer); options.signal?.removeEventListener('abort', pending.abort); reject(error); }
      });
    }
    function streamTurn(input = {}) {
      const id = nextId(), queue = [], waiters = [];
      let ended = false;
      const push = value => { const resolve = waiters.shift(); if (resolve) resolve({ value, done: false }); else queue.push(value); };
      const end = () => { ended = true; while (waiters.length) waiters.shift()({ done: true }); };
      const timeoutMs = Math.max(1000, Math.min(900000, Number(input.timeoutMs) || 300000));
      const pending = { push, end, signal: input.signal, abort: () => cancel(id) };
      streams.set(id, pending);
      pending.timer = setTimeout(() => cancel(id, 'timeout'), timeoutMs + 500);
      if (input.signal?.aborted) finish(id, { type: 'cancelled' });
      else {
        input.signal?.addEventListener('abort', pending.abort, { once: true });
        try { connect().postMessage({ type: 'harness.turn.start', requestId: id,
          model: input.model, reasoningEffort: input.reasoningEffort,
          systemPrompt: input.systemPrompt, userPrompt: input.userPrompt,
          images: input.images, maxOutputTokens: input.maxOutputTokens, timeoutMs,
          ...(input.webSearch === true ? { webSearch: true } : {}) }); }
        catch (error) { finish(id, { type: 'error', error: { code: error.code || 'HARNESS_START_FAILED', message: 'Harness bridge unavailable' } }); }
      }
      const iterator = {
        next() { if (queue.length) return Promise.resolve({ value: queue.shift(), done: false }); if (ended) return Promise.resolve({ done: true }); return new Promise(resolve => waiters.push(resolve)); },
        return() { cancel(id); queue.length = 0; end(); return Promise.resolve({ done: true }); },
        [Symbol.asyncIterator]() { return this; }
      };
      return iterator;
    }
    return { health: options => control('harness.health.check', 'harness.health.result', options),
      listModels: options => control('harness.models.list', 'harness.models.result', options), streamTurn,
      close() { if (closed) return; for (const id of [...streams.keys()]) cancel(id); for (const id of [...controls.keys()]) cancelControl(id); closed = true; port?.disconnect(); disconnect(); } };
  }
  return { HARNESS_NATIVE_HOST, createHarnessNativeClient };
});
