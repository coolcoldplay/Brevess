(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const DEFAULT_TTL_MS = 30 * 60 * 1000;
  const DEFAULT_MAX_HISTORY_ENTRIES = 256;

  function operationError(message = 'Analysis was cancelled', code = 'CANCELLED') {
    const error = new Error(message);
    error.name = 'AbortError';
    error.code = code;
    error.retryable = false;
    return error;
  }

  function normalizeOperationId(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9:._-]/g, '').slice(0, 100);
  }

  function operationOwnData(object, key) {
    if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    } catch { return undefined; }
  }

  function isDurableRestoreAuthority(value) {
    if (value !== null && (typeof value === 'object' || typeof value === 'function')) return true;
    if (typeof value !== 'symbol') return false;
    try { return Symbol.keyFor(value) === undefined; } catch { return false; }
  }

  function createOperationRegistry(options = {}) {
    const ttlMs = Math.max(60_000, Number(options.ttlMs) || DEFAULT_TTL_MS);
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const configuredHistoryLimit = operationOwnData(options, 'maxHistoryEntries');
    const configuredDurableRestoreAuthority = operationOwnData(
      options, 'durableRestoreAuthority'
    );
    const durableRestoreAuthority = isDurableRestoreAuthority(
      configuredDurableRestoreAuthority
    ) ? configuredDurableRestoreAuthority : undefined;
    const maxHistoryEntries = Number.isSafeInteger(configuredHistoryLimit)
      ? Math.min(512, Math.max(2, configuredHistoryLimit))
      : DEFAULT_MAX_HISTORY_ENTRIES;
    const operations = new Map();
    const epochs = new Map();
    const cancelGenerations = new Map();
    const historyOrder = new Map();
    let retiredEpochFloor = 0;
    let retiredCancelGenerationFloor = 0;

    function recordHistory(operationId, epoch, cancelGeneration) {
      epochs.set(operationId, epoch);
      cancelGenerations.set(operationId, cancelGeneration);
      historyOrder.delete(operationId);
      historyOrder.set(operationId, true);
    }

    function pruneHistory() {
      while (historyOrder.size > maxHistoryEntries) {
        let removed = false;
        for (const operationId of historyOrder.keys()) {
          if (operations.has(operationId)) continue;
          retiredEpochFloor = Math.max(retiredEpochFloor, epochs.get(operationId) || 0);
          retiredCancelGenerationFloor = Math.max(
            retiredCancelGenerationFloor, cancelGenerations.get(operationId) || 0
          );
          epochs.delete(operationId);
          cancelGenerations.delete(operationId);
          historyOrder.delete(operationId);
          removed = true;
          break;
        }
        if (!removed) break;
      }
    }

    function makeRoomForOperation(operationId) {
      if (operations.has(operationId)) return;
      while (operations.size >= maxHistoryEntries) {
        let oldest = null;
        for (const candidateId of historyOrder.keys()) {
          const candidate = operations.get(candidateId);
          if (candidate) {
            oldest = candidate;
            break;
          }
        }
        if (!oldest) break;
        oldest.cancelled = true;
        oldest.paused = false;
        oldest.controller.abort();
        settleWaiters(oldest, operationError('Analysis operation was evicted', 'STALE_OPERATION'));
        operations.delete(oldest.operationId);
      }
    }

    function prune() {
      const cutoff = now() - ttlMs;
      operations.forEach((operation, operationId) => {
        if (operation.updatedAt >= cutoff) return;
        if (!operation.cancelled) operation.controller.abort();
        operation.waiters.splice(0).forEach(waiter => waiter.reject(operationError()));
        operations.delete(operationId);
      });
      pruneHistory();
    }

    function create(operationId, epoch, cancelGeneration) {
      return {
        operationId,
        epoch,
        cancelGeneration,
        paused: false,
        cancelled: false,
        controller: new AbortController(),
        waiters: [],
        updatedAt: now()
      };
    }

    function settleWaiters(operation, error = operationError()) {
      operation.waiters.splice(0).forEach(waiter => waiter.reject(error));
    }

    function begin(value, authority) {
      prune();
      const isObject = value && typeof value === 'object';
      const operationId = normalizeOperationId(isObject
        ? operationOwnData(value, 'operationId')
        : value);
      if (!operationId) return null;
      const requestedEpoch = isObject ? operationOwnData(value, 'epoch') : undefined;
      const requestedCancelGeneration = isObject
        ? operationOwnData(value, 'cancelGeneration')
        : undefined;
      if (requestedEpoch !== undefined &&
          (!Number.isSafeInteger(requestedEpoch) || requestedEpoch < 1)) return null;
      if (requestedCancelGeneration !== undefined &&
          (!Number.isSafeInteger(requestedCancelGeneration) || requestedCancelGeneration < 0)) {
        return null;
      }
      const previous = operations.get(operationId);
      const hasHistory = epochs.has(operationId);
      const hasDurableAuthority = durableRestoreAuthority !== undefined &&
        authority === durableRestoreAuthority;
      const previousEpoch = hasHistory
        ? epochs.get(operationId)
        : retiredEpochFloor;
      if (requestedEpoch !== undefined && hasHistory && requestedEpoch <= previousEpoch) return null;
      if (requestedEpoch !== undefined && !hasHistory && retiredEpochFloor > 0 &&
          !hasDurableAuthority && requestedEpoch <= retiredEpochFloor) return null;
      const previousCancelGeneration = hasHistory
        ? (cancelGenerations.get(operationId) || 0)
        : retiredCancelGenerationFloor;
      if (requestedCancelGeneration !== undefined &&
          hasHistory && requestedCancelGeneration < previousCancelGeneration) return null;
      makeRoomForOperation(operationId);
      if (previous) {
        previous.cancelled = true;
        previous.paused = false;
        previous.controller.abort();
        settleWaiters(previous, operationError('Analysis operation was replaced', 'STALE_OPERATION'));
      }
      const epoch = requestedEpoch === undefined ? previousEpoch + 1 : requestedEpoch;
      const cancelGeneration = requestedCancelGeneration === undefined
        ? previousCancelGeneration
        : requestedCancelGeneration;
      if (!Number.isSafeInteger(epoch) || !Number.isSafeInteger(cancelGeneration)) return null;
      recordHistory(operationId, epoch, cancelGeneration);
      const operation = create(operationId, epoch, cancelGeneration);
      operations.set(operationId, operation);
      pruneHistory();
      return operation;
    }

    function getOrCreate(value) {
      prune();
      const operationId = normalizeOperationId(value);
      if (!operationId) return null;
      if (!operations.has(operationId)) return begin(operationId);
      const operation = operations.get(operationId);
      operation.updatedAt = now();
      return operation;
    }

    function snapshot(operation) {
      if (!operation) return Object.freeze({
        operationId: '', epoch: 0, cancelGeneration: 0,
        paused: false, cancelled: false, active: false
      });
      return Object.freeze({
        operationId: operation.operationId,
        epoch: Number(operation.epoch) || 0,
        cancelGeneration: Number(operation.cancelGeneration) || 0,
        paused: operation.paused,
        cancelled: operation.cancelled,
        active: operations.get(operation.operationId) === operation
      });
    }

    function capture(operation) {
      if (!operation) return Object.freeze({
        operationId: '', epoch: 0, cancelGeneration: 0
      });
      return Object.freeze({
        operationId: normalizeOperationId(operation.operationId),
        epoch: Number(operation.epoch) || 0,
        cancelGeneration: Number(operation.cancelGeneration) || 0
      });
    }

    function exactOperation(value, { createString = false } = {}) {
      if (typeof value === 'string') return createString
        ? getOrCreate(value)
        : operations.get(normalizeOperationId(value));
      const token = capture(value);
      const current = operations.get(token.operationId);
      if (!current || current.epoch !== token.epoch ||
          current.cancelGeneration !== token.cancelGeneration) {
        throw operationError('Analysis operation is stale', 'STALE_OPERATION');
      }
      return current;
    }

    function resolveCapture(value) {
      if (typeof value === 'string') {
        const operation = operations.get(normalizeOperationId(value));
        return operation ? capture(operation) : capture(null);
      }
      return capture(value);
    }

    function isActive(value) {
      const token = resolveCapture(value);
      const current = operations.get(token.operationId);
      return Boolean(current && !current.cancelled && !current.controller.signal.aborted &&
        current.epoch === token.epoch && current.cancelGeneration === token.cancelGeneration);
    }

    function assertActive(value) {
      const token = resolveCapture(value);
      const current = operations.get(token.operationId);
      if (current && current.epoch === token.epoch &&
          (current.cancelled || current.controller.signal.aborted ||
           current.cancelGeneration !== token.cancelGeneration)) {
        throw operationError();
      }
      if (!current || current.epoch !== token.epoch) {
        throw operationError('Analysis operation is stale', 'STALE_OPERATION');
      }
      return current;
    }

    function pause(value) {
      const operation = exactOperation(value, { createString: true });
      if (!operation || operation.cancelled) return snapshot(operation);
      operation.paused = true;
      operation.updatedAt = now();
      return snapshot(operation);
    }

    function resume(value) {
      const operation = exactOperation(value, { createString: true });
      if (!operation || operation.cancelled) return snapshot(operation);
      operation.paused = false;
      operation.updatedAt = now();
      operation.waiters.splice(0).forEach(waiter => waiter.resolve());
      return snapshot(operation);
    }

    function cancel(value) {
      const operation = exactOperation(value, { createString: true });
      if (!operation) return snapshot(operation);
      const nextCancelGeneration = (cancelGenerations.get(operation.operationId) || 0) + 1;
      recordHistory(operation.operationId, operation.epoch, nextCancelGeneration);
      operation.cancelGeneration = nextCancelGeneration;
      operation.cancelled = true;
      operation.paused = false;
      operation.updatedAt = now();
      operation.controller.abort();
      settleWaiters(operation);
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
      const operation = exactOperation(value);
      if (!operation) return false;
      const operationId = operation.operationId;
      operation.cancelled = true;
      operation.controller.abort();
      operation.cancelGeneration = (cancelGenerations.get(operationId) || 0) + 1;
      recordHistory(operationId, operation.epoch, operation.cancelGeneration);
      settleWaiters(operation);
      operations.delete(operationId);
      pruneHistory();
      return true;
    }

    function retire(value) {
      const operation = exactOperation(value);
      if (!operation) return false;
      operation.cancelled = true;
      operation.paused = false;
      operation.controller.abort();
      operation.updatedAt = now();
      settleWaiters(operation);
      recordHistory(operation.operationId, operation.epoch, operation.cancelGeneration);
      operations.delete(operation.operationId);
      pruneHistory();
      return true;
    }

    function control(value, command) {
      if (command === 'pause') return pause(value);
      if (command === 'resume') return resume(value);
      if (command === 'cancel') return cancel(value);
      if (command === 'release') {
        const operationId = typeof value === 'string'
          ? normalizeOperationId(value)
          : capture(value).operationId;
        release(value);
        return Object.freeze({ operationId, epoch: 0,
          cancelGeneration: cancelGenerations.get(operationId) || 0,
          active: false, paused: false, cancelled: false });
      }
      return snapshot(getOrCreate(value));
    }

    return {
      begin,
      getOrCreate,
      capture,
      isActive,
      assertActive,
      pause,
      resume,
      cancel,
      control,
      waitIfPaused,
      throwIfCancelled,
      release,
      retire,
      snapshot
    };
  }

  return { createOperationRegistry, normalizeOperationId, operationError };
});
