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
      lookup: value => operations.get(normalizeOperationId(value)) || null,
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

  // Ownership and UI state are attached to the existing registry entry. There
  // is no second operation map, cancellation controller or lifetime here.
  function createOwnedRuntimeOperationBridge({ registry, runtimeExtensionId = '' } = {}) {
    let runtimeEpochFloor = 0;
    const owner = (message, context) => {
      if (runtimeExtensionId && (context.senderExtensionId !== runtimeExtensionId ||
          !Number.isSafeInteger(context.senderTabId) || context.senderTabId < 0 ||
          !Number.isSafeInteger(context.senderFrameId) || context.senderFrameId < 0 ||
          !context.senderDocumentId || !Number.isSafeInteger(message.workspaceLifecycle))) {
        throw operationError('Operation owner unavailable', 'RUNTIME_OWNER_INVALID');
      }
      return JSON.stringify([context.senderExtensionId || '', context.senderTabId ?? null,
        context.senderFrameId ?? null, context.senderDocumentId || '', message.workspaceLifecycle ?? 0]);
    };
    async function bind(message, context, identity) {
      const ownerKey = owner(message, context);
      await context.assertTrustedOwnerCurrent?.();
      const operationId = normalizeOperationId(message.operationId);
      if (!operationId) {
        if (runtimeExtensionId) throw operationError('Operation id required', 'TASK_IDENTITY_INVALID');
        return null;
      }
      const previous = registry.lookup(operationId);
      if (previous?.runtimeOwner && previous.runtimeOwner !== ownerKey) {
        throw operationError('Operation owner changed', 'RUNTIME_OWNER_INVALID');
      }
      const floor = message.runtimeEpochFloor;
      if (floor !== undefined && (!floor ||
          floor.module !== identity.module || floor.documentId !== identity.documentId ||
          floor.documentGeneration !== identity.documentGeneration ||
          floor.workspaceLifecycle !== (message.workspaceLifecycle ?? 0) ||
          !Number.isSafeInteger(floor.epoch) || floor.epoch < 0 || floor.epoch >= Number.MAX_SAFE_INTEGER)) {
        throw operationError('Observed runtime epoch identity changed', 'TASK_IDENTITY_INVALID');
      }
      const observedEpochFloor = floor?.epoch ?? 0;
      // New runtime IDs need increasing epochs for the same sidebar task store.
      // Use the existing registry epoch so provider receipts and cancellation agree.
      const operation = previous || registry.begin({
        operationId, epoch: Math.max(runtimeEpochFloor, observedEpochFloor) + 1
      }) || registry.getOrCreate(operationId);
      registry.assertActive(operation);
      runtimeEpochFloor = Math.max(runtimeEpochFloor, observedEpochFloor, operation.epoch);
      const token = registry.capture(operation);
      const task = createRuntimeTaskContract({ ...identity, operationId, epoch: operation.epoch,
        workspaceLifecycle: message.workspaceLifecycle ?? 0 });
      if (operation.runtimeTask) {
        operation.runtimeTask.assertCurrent(task.capture());
        if (operation.runtimeTask.snapshot().terminal) throw operationError('Task already ended', 'TASK_ALREADY_TERMINAL');
      } else {
        operation.runtimeOwner = ownerKey;
        operation.runtimeTask = task;
      }
      operation.runtimeAssertCurrent = async () => {
        registry.assertActive(token);
        await context.assertTrustedOwnerCurrent?.();
        registry.assertActive(token);
      };
      await operation.runtimeAssertCurrent();
      return operation;
    }
    async function control(message, context) {
      const ownerKey = owner(message, context);
      const operation = registry.lookup(message.operationId);
      if (!operation?.runtimeTask || operation.runtimeOwner !== ownerKey) {
        throw operationError('Operation owner unavailable', 'RUNTIME_OWNER_INVALID');
      }
      await context.assertTrustedOwnerCurrent?.();
      const task = operation.runtimeTask, token = task.capture();
      if(message.documentId!==undefined && message.documentId!==token.documentId)throw operationError('Document changed','STALE_OPERATION');
      if (message.command !== 'status' && message.epoch !== token.epoch) {
        throw operationError('Operation epoch changed', 'STALE_OPERATION');
      }
      if (message.command === 'status') return { ...registry.snapshot(operation), task: task.snapshot() };
      if (['pause','resume'].includes(message.command)) {
        registry.assertActive(operation);
        return { ...registry.control(operation, message.command), task: task.snapshot() };
      }
      if (message.command !== 'cancel') throw operationError('Unsupported operation control', 'TASK_STATE_INVALID');
      if (task.snapshot().terminal) return { ...registry.snapshot(operation), task: task.snapshot() };
      const providerFinished=task.snapshot().status==='validating' ||
        task.snapshot().module === 'note' && Boolean(operation.noteSave);
      task.requestCancel(token);
      const receipt = registry.cancel(operation);
      // Abort acknowledgement confirms local scheduling only; the provider may
      // still be settling. The running request confirms stopped on unwind.
      if(providerFinished)task.confirmCancel(token,{success:true,cancelled:true});
      return { ...receipt, pending: !providerFinished, task: task.snapshot() };
    }
    function update(operation, status, extra = {}) {
      const task = operation?.runtimeTask;
      if (!task) return null;
      return task.apply(task.capture(), { ...extra, status, eventSequence: task.snapshot().eventSequence + 1 });
    }
    function fail(operation, error) {
      const task = operation?.runtimeTask;
      if (!task || task.snapshot().terminal) return;
      if (task.snapshot().cancelRequested) {
        task.confirmCancel(task.capture(), { success: true, cancelled: true });
      } else update(operation, error?.code === 'WRITE_OUTCOME_UNKNOWN' ? 'outcome_unknown' : 'failed');
    }
    return { bind, control, update, fail };
  }

  // Per-task UI/commit contract. This does not replace the durable registry or
  // authorize storage writes; callers still verify source identity and CAS.
  function createRuntimeTaskContract(input = {}) {
    const id = value => typeof value === 'string' && value.length > 0 &&
      value.length <= 200 && /^[a-zA-Z0-9:._-]+$/u.test(value) ? value : '';
    const integer = value => Number.isSafeInteger(value) && value >= 0;
    const fields = ['operationId', 'documentId', 'module', 'inputSignature', 'configSignature'];
    const identity = Object.fromEntries(fields.map(key => [key, id(input[key])]));
    for (const key of ['documentGeneration', 'workspaceLifecycle', 'epoch']) identity[key] = input[key];
    if (fields.some(key => !identity[key]) ||
        ['documentGeneration', 'workspaceLifecycle', 'epoch'].some(key => !integer(identity[key])) ||
        identity.epoch < 1 || !Array.isArray(input.scopeIds) || input.scopeIds.length > 10000 ||
        input.scopeIds.some(value => !id(value))) {
      throw operationError('Task identity is incomplete', 'TASK_IDENTITY_INVALID');
    }
    identity.scopeIds = Object.freeze([...new Set(input.scopeIds)]);
    Object.freeze(identity);
    const terminal = new Set(['completed', 'stopped', 'partial', 'failed']);
    const statuses = new Set(['preparing', 'running', 'retrying', 'validating', 'saving',
      ...terminal, 'stopping', 'outcome_unknown']);
    let status = 'preparing', eventSequence = 0, cancelRequested = false;
    const committed = new Set(), retained = new Set();
    function assertCurrent(token, live = identity) {
      const same = candidate => candidate && Object.keys(identity).every(key => key === 'scopeIds'
        ? Array.isArray(candidate.scopeIds) && candidate.scopeIds.length === identity.scopeIds.length &&
          identity.scopeIds.every((value, index) => candidate.scopeIds[index] === value)
        : candidate[key] === identity[key]);
      if (!same(token) || !same(live)) throw operationError('Task identity changed', 'STALE_OPERATION');
      return true;
    }
    function snapshot() {
      return Object.freeze({ ...identity, status, eventSequence, cancelRequested,
        completedUnits: committed.size + retained.size, totalUnits: identity.scopeIds.length,
        ...(['note', 'figures'].includes(identity.module) ? { retainedIds: Object.freeze([...retained]) } : {}),
        committedIds: Object.freeze([...committed]), terminal: terminal.has(status),
        percent: status === 'completed' ? 100 : identity.scopeIds.length
          ? Math.min(99, Math.floor((committed.size + retained.size) * 100 / identity.scopeIds.length)) : null });
    }
    function apply(token, event = {}) {
      assertCurrent(token);
      if (terminal.has(status)) throw operationError('Task already ended', 'TASK_ALREADY_TERMINAL');
      if (!integer(event.eventSequence) || event.eventSequence <= eventSequence) {
        throw operationError('Task event is stale', 'STALE_TASK_EVENT');
      }
      if (!statuses.has(event.status)) throw operationError('Invalid task state', 'TASK_STATE_INVALID');
      if (cancelRequested && !['stopping', 'stopped', 'outcome_unknown'].includes(event.status)) {
        throw operationError('Stop confirmation is pending', 'TASK_STOPPING');
      }
      const additions = event.committedIds === undefined ? [] : event.committedIds;
      if (!Array.isArray(additions) || additions.some(value => !identity.scopeIds.includes(value))) {
        throw operationError('Task scope changed', 'TASK_SCOPE_CHANGED');
      }
      const next = new Set([...committed, ...additions]);
      const retainedAdditions = event.retainedIds === undefined ? [] : event.retainedIds;
      if (!Array.isArray(retainedAdditions) || retainedAdditions.length &&
          (!['note', 'figures'].includes(identity.module) || event.retainedConfirmed !== true) ||
          retainedAdditions.some(value => !identity.scopeIds.includes(value) || next.has(value)) ||
          additions.some(value => retained.has(value))) throw operationError('Retained task scope changed', 'TASK_SCOPE_CHANGED');
      const nextRetained = new Set([...retained, ...retainedAdditions]);
      if (cancelRequested && (next.size !== committed.size || nextRetained.size !== retained.size)) {
        throw operationError('Stop confirmation is pending', 'TASK_STOPPING');
      }
      if (event.status === 'completed' && (event.saveConfirmed !== true ||
          next.size + nextRetained.size !== identity.scopeIds.length || status !== 'saving')) {
        throw operationError('Final save is unconfirmed', 'TASK_COMMIT_UNCONFIRMED');
      }
      if (event.status === 'stopped' && (!cancelRequested || event.cancelConfirmed !== true)) {
        throw operationError('Cancellation is unconfirmed', 'TASK_CANCEL_UNCONFIRMED');
      }
      next.forEach(value => committed.add(value));
      nextRetained.forEach(value => retained.add(value));
      if (event.status === 'stopping') cancelRequested = true;
      status = event.status; eventSequence = event.eventSequence;
      return snapshot();
    }
    function requestCancel(token) {
      return apply(token, { eventSequence: eventSequence + 1, status: 'stopping' });
    }
    function confirmCancel(token, receipt = {}) {
      assertCurrent(token);
      if (!cancelRequested) throw operationError('Task is not stopping', 'TASK_STATE_INVALID');
      if (receipt.success !== true || receipt.pending === true || receipt.cancelled !== true) return snapshot();
      return apply(token, { eventSequence: eventSequence + 1, status: 'stopped', cancelConfirmed: true });
    }
    return { capture: () => identity, snapshot, assertCurrent, apply, requestCancel, confirmCancel };
  }

  return { createOperationRegistry, normalizeOperationId, operationError, createRuntimeTaskContract,
    createOwnedRuntimeOperationBridge };
});
