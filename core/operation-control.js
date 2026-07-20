(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const DEFAULT_TTL_MS = 30 * 60 * 1000;

  function operationError(message = 'Analysis was cancelled') {
    const error = new Error(message);
    error.name = 'AbortError';
    error.code = 'CANCELLED';
    error.retryable = false;
    return error;
  }

  function normalizeOperationId(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9:._-]/g, '').slice(0, 100);
  }

  function createOperationRegistry(options = {}) {
    const ttlMs = Math.max(60_000, Number(options.ttlMs) || DEFAULT_TTL_MS);
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const operations = new Map();

    function prune() {
      const cutoff = now() - ttlMs;
      operations.forEach((operation, operationId) => {
        if (operation.updatedAt >= cutoff) return;
        if (!operation.cancelled) operation.controller.abort();
        operation.waiters.splice(0).forEach(waiter => waiter.reject(operationError()));
        operations.delete(operationId);
      });
    }

    function create(operationId) {
      return {
        operationId,
        paused: false,
        cancelled: false,
        controller: new AbortController(),
        waiters: [],
        updatedAt: now()
      };
    }

    function getOrCreate(value) {
      prune();
      const operationId = normalizeOperationId(value);
      if (!operationId) return null;
      if (!operations.has(operationId)) operations.set(operationId, create(operationId));
      const operation = operations.get(operationId);
      operation.updatedAt = now();
      return operation;
    }

    function snapshot(operation) {
      if (!operation) return {
        operationId: '', paused: false, cancelled: false, active: false
      };
      return {
        operationId: operation.operationId,
        paused: operation.paused,
        cancelled: operation.cancelled,
        active: operations.get(operation.operationId) === operation
      };
    }

    function pause(value) {
      const operation = getOrCreate(value);
      if (!operation || operation.cancelled) return snapshot(operation);
      operation.paused = true;
      operation.updatedAt = now();
      return snapshot(operation);
    }

    function resume(value) {
      const operation = getOrCreate(value);
      if (!operation || operation.cancelled) return snapshot(operation);
      operation.paused = false;
      operation.updatedAt = now();
      operation.waiters.splice(0).forEach(waiter => waiter.resolve());
      return snapshot(operation);
    }

    function cancel(value) {
      const operation = getOrCreate(value);
      if (!operation) return snapshot(operation);
      operation.cancelled = true;
      operation.paused = false;
      operation.updatedAt = now();
      operation.controller.abort();
      operation.waiters.splice(0).forEach(waiter => waiter.reject(operationError()));
      return snapshot(operation);
    }

    function waitIfPaused(operation) {
      if (!operation) return Promise.resolve();
      operation.updatedAt = now();
      if (operation.cancelled || operation.controller.signal.aborted) {
        return Promise.reject(operationError());
      }
      if (!operation.paused) return Promise.resolve();
      return new Promise((resolve, reject) => operation.waiters.push({ resolve, reject }));
    }

    function throwIfCancelled(operation) {
      if (operation?.cancelled || operation?.controller?.signal?.aborted) {
        throw operationError();
      }
    }

    function release(value) {
      const operationId = normalizeOperationId(value?.operationId || value);
      const operation = operations.get(operationId);
      if (!operation) return false;
      operation.waiters.splice(0).forEach(waiter => waiter.reject(operationError()));
      operations.delete(operationId);
      return true;
    }

    function control(value, command) {
      if (command === 'pause') return pause(value);
      if (command === 'resume') return resume(value);
      if (command === 'cancel') return cancel(value);
      if (command === 'release') {
        release(value);
        return { operationId: normalizeOperationId(value), active: false,
          paused: false, cancelled: false };
      }
      return snapshot(getOrCreate(value));
    }

    return {
      getOrCreate,
      pause,
      resume,
      cancel,
      control,
      waitIfPaused,
      throwIfCancelled,
      release,
      snapshot
    };
  }

  return { createOperationRegistry, normalizeOperationId, operationError };
});
