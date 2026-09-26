(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,79}$/u;

  function fixedError(value, fallback) {
    const code = ERROR_CODE.test(String(value || '')) ? String(value) : fallback;
    const result = new Error(code);
    result.code = code;
    return result;
  }

  function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const entry of Object.values(value)) deepFreeze(entry, seen);
    return Object.freeze(value);
  }

  function createPdfSemanticWorkerClient(options = {}) {
    const WorkerCtor = options.WorkerCtor || globalThis.Worker;
    const workerUrl = String(options.workerUrl || '');
    if (typeof WorkerCtor !== 'function' || !workerUrl) {
      throw fixedError('PDF_SEMANTIC_WORKER_UNAVAILABLE',
        'PDF_SEMANTIC_WORKER_UNAVAILABLE');
    }
    const pending = new Map();
    let worker = null;
    let disposed = false;
    let sequence = 0;

    const settle = (requestId, callback) => {
      const request = pending.get(requestId);
      if (!request) return false;
      pending.delete(requestId);
      request.signal?.removeEventListener?.('abort', request.abort);
      callback(request);
      return true;
    };

    const rejectPending = (code, exceptRequestId = '') => {
      for (const [requestId] of pending) {
        if (requestId === exceptRequestId) continue;
        settle(requestId, request => request.reject(fixedError(code, code)));
      }
    };

    const terminateWorker = () => {
      const current = worker;
      worker = null;
      try { current?.terminate?.(); } catch (_) {}
    };

    const reset = (code = 'PDF_SEMANTIC_WORKER_RESET', exceptRequestId = '') => {
      terminateWorker();
      rejectPending(code, exceptRequestId);
    };

    const ensureWorker = () => {
      if (worker) return worker;
      const next = new WorkerCtor(workerUrl, {
        type: 'module', name: 'brevess-pdf-semantic'
      });
      next.addEventListener('message', event => {
        const message = event?.data;
        const requestId = String(message?.requestId || '');
        if (message?.type === 'result') {
          settle(requestId, request => request.resolve(deepFreeze(message.result)));
          return;
        }
        if (message?.type === 'error') {
          settle(requestId, request => request.reject(fixedError(message.code,
            'PDF_SEMANTIC_WORKER_BUILD_FAILED')));
        }
      });
      next.addEventListener('error', () => {
        if (next !== worker) return;
        reset('PDF_SEMANTIC_WORKER_FAILED');
      });
      next.addEventListener('messageerror', () => {
        if (next !== worker) return;
        reset('PDF_SEMANTIC_WORKER_MESSAGE_FAILED');
      });
      worker = next;
      return worker;
    };

    function build(input, buildOptions = {}) {
      if (disposed) return Promise.reject(fixedError('PDF_SEMANTIC_WORKER_DISPOSED',
        'PDF_SEMANTIC_WORKER_DISPOSED'));
      const signal = buildOptions?.signal;
      if (signal?.aborted) return Promise.reject(fixedError('PDF_SEMANTIC_BUILD_ABORTED',
        'PDF_SEMANTIC_BUILD_ABORTED'));
      const requestId = `pdf-semantic-${Date.now().toString(36)}-${++sequence}`;
      return new Promise((resolve, reject) => {
        const abort = () => {
          settle(requestId, request => request.reject(fixedError(
            'PDF_SEMANTIC_BUILD_ABORTED', 'PDF_SEMANTIC_BUILD_ABORTED')));
          reset('PDF_SEMANTIC_WORKER_RESET');
        };
        pending.set(requestId, { resolve, reject, signal, abort });
        signal?.addEventListener?.('abort', abort, { once: true });
        try {
          ensureWorker().postMessage({ type: 'build', requestId, input });
        } catch (_) {
          settle(requestId, request => request.reject(fixedError(
            'PDF_SEMANTIC_WORKER_MESSAGE_FAILED', 'PDF_SEMANTIC_WORKER_MESSAGE_FAILED')));
          reset('PDF_SEMANTIC_WORKER_RESET');
        }
      });
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      reset('PDF_SEMANTIC_WORKER_DISPOSED');
    }

    return Object.freeze({ build, reset, dispose,
      pendingCount: () => pending.size });
  }

  return { createPdfSemanticWorkerClient };
});
