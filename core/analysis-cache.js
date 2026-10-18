(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const ANALYSIS_CACHE_VERSIONS = {
    prompt: '12-scenario-configurable-evidence',
    chunker: '5-paragraph-checkpoint',
    classifier: shared.PROFILE_CLASSIFIER_VERSION || '2',
    ledger: shared.EVIDENCE_LEDGER_VERSION || '2'
  };
  const DEFAULT_ANALYSIS_CACHE_MAX_ENTRIES = 1200;
  const DEFAULT_ANALYSIS_CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
  const MAX_GUARDED_CACHE_VALUES = 128;
  const MAX_GUARDED_CACHE_KEY_LENGTH = 512;
  const MAX_GUARDED_DATA_DEPTH = 32;
  const MAX_GUARDED_DATA_NODES = 50_000;
  const MAX_GUARDED_DATA_CHARS = 10_000_000;
  const MAX_PROTECTED_MECHANISM_ACTIVE_RUNS = 128;
  const MAX_PROTECTED_MECHANISM_RECORDS = 1024;
  const MAX_PROTECTED_MECHANISM_TOTAL_BYTES = 256 * 1024 * 1024;
  const PROTECTED_ANALYSIS_CACHE_PREFIXES = Object.freeze([
    'mechanism-run-index:', 'mechanism-run-state:', 'mechanism-checkpoint:',
    'mechanism-owner-tab:', 'mechanism-owner-current:'
  ]);
  const MECHANISM_RUN_INDEX_PREFIX = 'mechanism-run-index:';

  const GUARDED_CACHE_ERRORS = Object.freeze({
    CACHE_GUARD_INVALID_INPUT: 'Guarded cache input is invalid',
    CACHE_GUARD_ABORTED: 'Guarded cache write was aborted',
    CACHE_GUARD_STALE: 'Guarded cache write is stale',
    CACHE_GUARD_WRITE_FAILED: 'Guarded cache write failed',
    CACHE_PROTECTED_CAPACITY_EXCEEDED: 'Protected cache capacity was exceeded'
  });

  function guardedCacheError(code) {
    const error = new Error(GUARDED_CACHE_ERRORS[code] || GUARDED_CACHE_ERRORS.CACHE_GUARD_WRITE_FAILED);
    error.name = code === 'CACHE_GUARD_ABORTED' ? 'AbortError' : 'Error';
    error.code = Object.hasOwn(GUARDED_CACHE_ERRORS, code) ? code : 'CACHE_GUARD_WRITE_FAILED';
    error.retryable = false;
    return error;
  }

  function normalizeGuardFailure(error, signalControl) {
    let code;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
      code = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    } catch { code = undefined; }
    let aborted = false;
    try { aborted = signalControl?.isAborted() === true; } catch {
      return guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
    if (aborted || code === 'CANCELLED') {
      return guardedCacheError('CACHE_GUARD_ABORTED');
    }
    if (code === 'STALE_OPERATION') return guardedCacheError('CACHE_GUARD_STALE');
    if (code && Object.hasOwn(GUARDED_CACHE_ERRORS, code)) return error;
    return guardedCacheError('CACHE_GUARD_WRITE_FAILED');
  }

  function assertGuardActive(control) {
    if (control.signal.isAborted()) throw guardedCacheError('CACHE_GUARD_ABORTED');
    try {
      control.assertActive();
    } catch (error) {
      throw normalizeGuardFailure(error, control.signal);
    }
    if (control.signal.isAborted()) throw guardedCacheError('CACHE_GUARD_ABORTED');
  }

  function readOwnShape(value) {
    try {
      const prototype = Object.getPrototypeOf(value);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);
      return { prototype, descriptors, keys };
    } catch {
      throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
  }

  function isArrayOwnData(value) {
    try { return Array.isArray(value); } catch {
      throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
  }

  function cloneBoundedOwnData(value, state = { nodes: 0, chars: 0 }, depth = 0) {
    state.nodes += 1;
    if (state.nodes > MAX_GUARDED_DATA_NODES || depth > MAX_GUARDED_DATA_DEPTH) {
      throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      state.chars += value.length;
      if (state.chars > MAX_GUARDED_DATA_CHARS) {
        throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
      }
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object') throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    const isArray = isArrayOwnData(value);
    const shape = readOwnShape(value);
    if (shape.prototype !== Object.prototype && shape.prototype !== null && !isArray) {
      throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
    const { descriptors, keys } = shape;
    if (isArray) {
      const lengthDescriptor = descriptors.length;
      const length = lengthDescriptor?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_GUARDED_DATA_NODES) {
        throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
      }
      const result = new Array(length);
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
          throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
        }
        result[index] = cloneBoundedOwnData(descriptor.value, state, depth + 1);
      }
      if (keys.some(key => key !== 'length' &&
          !(typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < length))) {
        throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
      }
      return result;
    }
    if (keys.length > MAX_GUARDED_DATA_NODES || keys.some(key => typeof key !== 'string')) {
      throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
    const result = {};
    keys.forEach(key => {
      state.chars += key.length;
      if (state.chars > MAX_GUARDED_DATA_CHARS) {
        throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
      }
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
      }
      Object.defineProperty(result, key, {
        value: cloneBoundedOwnData(descriptor.value, state, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true
      });
    });
    return result;
  }

  function validateGuardedValues(values) {
    if (!isArrayOwnData(values)) throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    const { descriptors, keys } = readOwnShape(values);
    const length = descriptors?.length?.value;
    if (!Number.isSafeInteger(length) || length < 1 ||
        length > MAX_GUARDED_CACHE_VALUES) {
      throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
    const seen = new Set();
    const cloned = [];
    if (keys.some(key => key !== 'length' &&
        !(typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < length))) {
      throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
      }
      const record = cloneBoundedOwnData(descriptor.value);
      if (typeof record.key !== 'string' || !record.key ||
          record.key.length > MAX_GUARDED_CACHE_KEY_LENGTH || seen.has(record.key)) {
        throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
      }
      seen.add(record.key);
      cloned.push(record);
    }
    return Object.freeze(cloned);
  }

  function deepFreezeCacheValue(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach(item => deepFreezeCacheValue(item, seen));
    return Object.freeze(value);
  }

  function cacheOwnData(object, key) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    } catch {
      throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
  }

  function isProtectedAnalysisCacheKey(value) {
    return typeof value === 'string' && PROTECTED_ANALYSIS_CACHE_PREFIXES.some(
      prefix => value.startsWith(prefix)
    );
  }

  function protectedRunIndexTerminal(record) {
    const key = cacheOwnData(record, 'key');
    if (typeof key !== 'string' || !key.startsWith(MECHANISM_RUN_INDEX_PREFIX)) return null;
    const runIndex = cacheOwnData(record, 'runIndex');
    if (!runIndex || typeof runIndex !== 'object' || Array.isArray(runIndex)) {
      throw guardedCacheError('CACHE_GUARD_WRITE_FAILED');
    }
    const terminal = cacheOwnData(runIndex, 'terminal');
    if (!['active', 'cancelled', 'complete', 'failed', 'needs_review', 'released']
      .includes(terminal)) {
      throw guardedCacheError('CACHE_GUARD_WRITE_FAILED');
    }
    return terminal;
  }

  function protectedRecordSize(value) {
    let serialized;
    try { serialized = JSON.stringify(cloneBoundedOwnData(value)); } catch (_) {
      throw guardedCacheError('CACHE_PROTECTED_CAPACITY_EXCEEDED');
    }
    if (typeof serialized !== 'string' || typeof TextEncoder !== 'function') {
      throw guardedCacheError('CACHE_PROTECTED_CAPACITY_EXCEEDED');
    }
    try { return new TextEncoder().encode(serialized).byteLength; } catch (_) {
      throw guardedCacheError('CACHE_PROTECTED_CAPACITY_EXCEEDED');
    }
  }

  function protectedRunReservation(value) {
    const runIndex = cacheOwnData(value, 'runIndex');
    const reservation = cacheOwnData(runIndex, 'protectedBytesReserved');
    if (reservation === undefined) return 0;
    if (!Number.isSafeInteger(reservation) || reservation < 0 ||
        reservation > 32 * 1024 * 1024) {
      throw guardedCacheError('CACHE_PROTECTED_CAPACITY_EXCEEDED');
    }
    return reservation;
  }

  function assertProtectedMechanismCapacity(
    currentValues, proposedValues, deletedKeys = []
  ) {
    const deleted = new Set(deletedKeys);
    const hasProtectedMutation = proposedValues.some(value =>
      isProtectedAnalysisCacheKey(cacheOwnData(value, 'key'))) ||
      deletedKeys.some(isProtectedAnalysisCacheKey);
    if (!hasProtectedMutation) return;
    const protectedRecords = new Map();
    currentValues.forEach(value => {
      const key = cacheOwnData(value, 'key');
      if (!isProtectedAnalysisCacheKey(key) || deleted.has(key)) return;
      if (key.startsWith(MECHANISM_RUN_INDEX_PREFIX)) protectedRunIndexTerminal(value);
      protectedRecords.set(key, value);
    });
    proposedValues.forEach(value => {
      const key = cacheOwnData(value, 'key');
      if (!isProtectedAnalysisCacheKey(key)) return;
      if (key.startsWith(MECHANISM_RUN_INDEX_PREFIX)) protectedRunIndexTerminal(value);
      protectedRecords.set(key, value);
    });
    let active = 0;
    let totalBytes = 0;
    const recordBytes = new Map();
    protectedRecords.forEach((value, key) => {
      if (key.startsWith(MECHANISM_RUN_INDEX_PREFIX) &&
          protectedRunIndexTerminal(value) === 'active') active += 1;
      const bytes = protectedRecordSize(value);
      recordBytes.set(key, bytes);
      totalBytes += bytes;
    });
    const groupedChildren = new Set();
    protectedRecords.forEach((value, key) => {
      if (!key.startsWith(MECHANISM_RUN_INDEX_PREFIX)) return;
      const reservation = protectedRunReservation(value);
      if (reservation === 0) return;
      const sessionMatch = key.match(/^mechanism-run-index:([a-f0-9]{64}):/u);
      const latestRunStateKey = cacheOwnData(
        cacheOwnData(value, 'runIndex'), 'latestRunStateKey'
      );
      const statePrefix = sessionMatch
        ? `mechanism-run-state:${sessionMatch[1]}:` : '';
      if (!statePrefix || typeof latestRunStateKey !== 'string' ||
          !latestRunStateKey.startsWith(statePrefix) ||
          groupedChildren.has(latestRunStateKey)) {
        throw guardedCacheError('CACHE_PROTECTED_CAPACITY_EXCEEDED');
      }
      const checkpointKey = `mechanism-checkpoint:${sessionMatch[1]}:${
        latestRunStateKey.slice(statePrefix.length)
      }`;
      groupedChildren.add(latestRunStateKey);
      groupedChildren.add(checkpointKey);
      const actualGroupBytes = (recordBytes.get(key) || 0) +
        (recordBytes.get(latestRunStateKey) || 0) +
        (recordBytes.get(checkpointKey) || 0);
      totalBytes += Math.max(0, reservation - actualGroupBytes);
    });
    if (totalBytes > MAX_PROTECTED_MECHANISM_TOTAL_BYTES) {
      throw guardedCacheError('CACHE_PROTECTED_CAPACITY_EXCEEDED');
    }
    if (active > MAX_PROTECTED_MECHANISM_ACTIVE_RUNS ||
        protectedRecords.size > MAX_PROTECTED_MECHANISM_RECORDS) {
      throw guardedCacheError('CACHE_PROTECTED_CAPACITY_EXCEEDED');
    }
  }

  function proposesProtectedRecord(values) {
    return values.some(value => isProtectedAnalysisCacheKey(cacheOwnData(value, 'key')));
  }

  function recordWithAccessTime(value, accessedAt) {
    return isProtectedAnalysisCacheKey(cacheOwnData(value, 'key'))
      ? value
      : { ...value, lastAccessedAt: accessedAt };
  }

  function validateProtectedDeleteKeys(
    deleteKeys, casKey, proposedValues = [], currentValue = null
  ) {
    if (!Array.isArray(deleteKeys) || deleteKeys.length > MAX_GUARDED_CACHE_VALUES ||
        typeof casKey !== 'string' || !isProtectedAnalysisCacheKey(casKey)) {
      throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
    const match = casKey.match(/^mechanism-run-index:([a-f0-9]{64}):/u);
    if (!match) throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    const allowedPrefixes = [
      `mechanism-run-state:${match[1]}:`,
      `mechanism-checkpoint:${match[1]}:`
    ];
    const proposed = new Set(proposedValues.map(value => cacheOwnData(value, 'key')));
    const seen = new Set();
    for (const key of deleteKeys) {
      if (typeof key !== 'string' || !key || key.length > MAX_GUARDED_CACHE_KEY_LENGTH ||
          key === casKey || proposed.has(key) || seen.has(key) ||
          !allowedPrefixes.some(prefix => key.startsWith(prefix))) {
        throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
      }
      seen.add(key);
    }
    if (currentValue !== null) {
      const currentRunIndex = cacheOwnData(currentValue, 'runIndex');
      const latestRunStateKey = cacheOwnData(currentRunIndex, 'latestRunStateKey');
      const statePrefix = allowedPrefixes[0];
      if (typeof latestRunStateKey !== 'string' ||
          !latestRunStateKey.startsWith(statePrefix) ||
          latestRunStateKey.length <= statePrefix.length) {
        throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
      }
      const suffix = latestRunStateKey.slice(statePrefix.length);
      const exactChildren = new Set([
        latestRunStateKey,
        `${allowedPrefixes[1]}${suffix}`
      ]);
      const proposedIndex = proposedValues.find(value => cacheOwnData(value, 'key') === casKey);
      if (seen.size !== exactChildren.size ||
          [...seen].some(key => !exactChildren.has(key)) ||
          cacheOwnData(cacheOwnData(proposedIndex, 'runIndex'), 'latestRunStateKey') !==
            latestRunStateKey) {
        throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
      }
    }
    return Object.freeze([...seen]);
  }

  function createSignalControl(signal) {
    if (signal === undefined || signal === null) {
      return Object.freeze({
        isAborted: () => false,
        addAbortListener() {},
        removeAbortListener() {}
      });
    }
    let prototype;
    let descriptors;
    try {
      prototype = Object.getPrototypeOf(signal);
      descriptors = Object.getOwnPropertyDescriptors(signal);
      Reflect.ownKeys(descriptors);
    } catch {
      throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
    const nativePrototype = typeof AbortSignal === 'function' ? AbortSignal.prototype : null;
    if (nativePrototype && prototype === nativePrototype) {
      let abortedGetter;
      let addEventListener;
      let removeEventListener;
      try {
        abortedGetter = Object.getOwnPropertyDescriptor(nativePrototype, 'aborted')?.get;
        addEventListener = EventTarget.prototype.addEventListener;
        removeEventListener = EventTarget.prototype.removeEventListener;
      } catch {
        throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
      }
      if (typeof abortedGetter !== 'function' || typeof addEventListener !== 'function' ||
          typeof removeEventListener !== 'function') {
        throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
      }
      return Object.freeze({
        isAborted() {
          try { return abortedGetter.call(signal) === true; } catch {
            throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
          }
        },
        addAbortListener(listener) {
          try { addEventListener.call(signal, 'abort', listener, { once: true }); } catch {
            throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
          }
        },
        removeAbortListener(listener) {
          try { removeEventListener.call(signal, 'abort', listener); } catch {
            throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
          }
        }
      });
    }
    if (prototype !== Object.prototype && prototype !== null) {
      throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
    const abortedDescriptor = descriptors.aborted;
    const addDescriptor = descriptors.addEventListener;
    const removeDescriptor = descriptors.removeEventListener;
    if ((abortedDescriptor && !Object.hasOwn(abortedDescriptor, 'value')) ||
        (addDescriptor && !Object.hasOwn(addDescriptor, 'value')) ||
        (removeDescriptor && !Object.hasOwn(removeDescriptor, 'value'))) {
      throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
    const initialAborted = abortedDescriptor?.value;
    const addEventListener = addDescriptor?.value;
    const removeEventListener = removeDescriptor?.value;
    if ((initialAborted !== undefined && typeof initialAborted !== 'boolean') ||
        (addEventListener !== undefined && typeof addEventListener !== 'function') ||
        (removeEventListener !== undefined && typeof removeEventListener !== 'function') ||
        (typeof addEventListener === 'function') !== (typeof removeEventListener === 'function')) {
      throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
    let aborted = initialAborted === true;
    const listeners = new Map();
    return Object.freeze({
      isAborted: () => aborted,
      addAbortListener(listener) {
        if (!addEventListener) return;
        const wrapped = () => {
          aborted = true;
          listener();
        };
        listeners.set(listener, wrapped);
        try { addEventListener.call(signal, 'abort', wrapped, { once: true }); } catch {
          listeners.delete(listener);
          throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
        }
      },
      removeAbortListener(listener) {
        if (!removeEventListener) return;
        const wrapped = listeners.get(listener);
        listeners.delete(listener);
        try { removeEventListener.call(signal, 'abort', wrapped || listener); } catch {
          throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
        }
      }
    });
  }

  function createGuardControl(guard) {
    const assertActive = cacheOwnData(guard, 'assertActive');
    if (typeof assertActive !== 'function') {
      throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
    return Object.freeze({
      assertActive,
      signal: createSignalControl(cacheOwnData(guard, 'signal'))
    });
  }

  function validateCas(cloned, guard) {
    const casKey = cacheOwnData(guard, 'casKey');
    const expectedRevision = cacheOwnData(guard, 'expectedRevision');
    if (typeof casKey !== 'string' || !casKey || casKey.length > MAX_GUARDED_CACHE_KEY_LENGTH ||
        (expectedRevision !== null &&
         (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0))) {
      throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
    const proposal = cloned.find(value => value.key === casKey);
    const nextRevision = expectedRevision === null ? 0 : expectedRevision + 1;
    if (!proposal || proposal.revision !== nextRevision) {
      throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
    }
    return { casKey, expectedRevision, nextRevision };
  }

  function storedRevision(value) {
    if (value === undefined) return { value: null, revision: null };
    const cloned = cloneBoundedOwnData(value);
    if (!Number.isSafeInteger(cloned.revision) || cloned.revision < 0) {
      throw guardedCacheError('CACHE_GUARD_WRITE_FAILED');
    }
    return { value: deepFreezeCacheValue(cloned), revision: cloned.revision };
  }

  function casResult(applied, revision, currentValue = null, terminalCode = null) {
    return deepFreezeCacheValue({ applied, revision, currentValue, terminalCode });
  }

  async function hashDocument(paragraphs, cryptoImpl = globalThis.crypto) {
    const canonical = JSON.stringify(paragraphs.map(item => ({
      paragraphId: item.paragraphId,
      sectionTitle: item.sectionTitle || '',
      sectionKind: item.sectionKind || '',
      headingLevel: Number(item.headingLevel) || 0,
      headingPath: (Array.isArray(item.headingPath) ? item.headingPath : []).map(heading => ({
        level: Number(heading?.level) || 0,
        sectionId: heading?.sectionId || '',
        title: heading?.title || ''
      })),
      text: item.text
    })));
    const bytes = new TextEncoder().encode(canonical);
    const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function createMemoryAnalysisCache() {
    const entries = new Map();
    let casTail = Promise.resolve();
    return {
      async getMany(keys) {
        return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)]));
      },
      async listProtectedByPrefix(prefix) {
        if (typeof prefix !== 'string' || prefix.length > MAX_GUARDED_CACHE_KEY_LENGTH ||
            !PROTECTED_ANALYSIS_CACHE_PREFIXES.some(root => prefix.startsWith(root))) {
          throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
        }
        return new Map([...entries].filter(([key]) => key.startsWith(prefix)));
      },
      async setMany(values) {
        assertProtectedMechanismCapacity([...entries.values()], values);
        values.forEach(value => entries.set(value.key, value));
      },
      async setManyGuarded(values, guard) {
        const control = createGuardControl(guard);
        assertGuardActive(control);
        const cloned = validateGuardedValues(values);
        assertGuardActive(control);
        assertProtectedMechanismCapacity([...entries.values()], cloned);
        const previous = Object.freeze(cloned.map(value => Object.freeze({
          key: value.key,
          existed: entries.has(value.key),
          value: entries.get(value.key)
        })));
        cloned.forEach(value => entries.set(value.key, value));
        try {
          assertGuardActive(control);
        } catch (error) {
          previous.forEach((item, index) => {
            if (entries.get(item.key) !== cloned[index]) return;
            if (item.existed) entries.set(item.key, item.value);
            else entries.delete(item.key);
          });
          throw error;
        }
      },
      compareAndSetManyGuarded(values, guard) {
        const operation = casTail.then(async () => {
          const control = createGuardControl(guard);
          assertGuardActive(control);
          const cloned = validateGuardedValues(values);
          const cas = validateCas(cloned, guard);
          assertGuardActive(control);
          const current = storedRevision(entries.get(cas.casKey));
          if (current.revision !== cas.expectedRevision) {
            return casResult(false, current.revision, current.value);
          }
          assertProtectedMechanismCapacity([...entries.values()], cloned);
          const previous = Object.freeze(cloned.map(value => Object.freeze({
            key: value.key,
            existed: entries.has(value.key),
            value: entries.get(value.key)
          })));
          cloned.forEach(value => entries.set(value.key, value));
          try {
            assertGuardActive(control);
          } catch (error) {
            previous.forEach((item, index) => {
              if (entries.get(item.key) !== cloned[index]) return;
              if (item.existed) entries.set(item.key, item.value);
              else entries.delete(item.key);
            });
            throw error;
          }
          return casResult(true, cas.nextRevision);
        });
        casTail = operation.catch(() => {});
        return operation;
      },
      compareAndSetManyAndDeleteGuarded(values, deleteKeys, guard) {
        const operation = casTail.then(async () => {
          const control = createGuardControl(guard);
          assertGuardActive(control);
          const cloned = validateGuardedValues(values);
          const cas = validateCas(cloned, guard);
          const deletes = validateProtectedDeleteKeys(
            deleteKeys, cas.casKey, cloned
          );
          assertGuardActive(control);
          const current = storedRevision(entries.get(cas.casKey));
          if (current.revision !== cas.expectedRevision) {
            return casResult(false, current.revision, current.value);
          }
          validateProtectedDeleteKeys(
            deletes, cas.casKey, cloned, current.value
          );
          assertProtectedMechanismCapacity([...entries.values()], cloned, deletes);
          const touchedKeys = new Set([...cloned.map(value => value.key), ...deletes]);
          const previous = [...touchedKeys].map(key => Object.freeze({
            key, existed: entries.has(key), value: entries.get(key)
          }));
          cloned.forEach(value => entries.set(value.key, value));
          deletes.forEach(key => entries.delete(key));
          try {
            assertGuardActive(control);
          } catch (error) {
            previous.forEach(item => {
              if (item.existed) entries.set(item.key, item.value);
              else entries.delete(item.key);
            });
            throw error;
          }
          return casResult(true, cas.nextRevision);
        });
        casTail = operation.catch(() => {});
        return operation;
      },
      async deleteMany(keys) {
        keys.forEach(key => entries.delete(key));
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

  function createIndexedDbAnalysisCache(indexedDbRef, options = {}) {
    const databaseName = options.databaseName || 'sci-logic-highlighter';
    // A paper can create dozens of category, Figure, panel and repair entries.
    // Keep enough LRU history for a realistic multi-paper reading library so a
    // return visit is much more likely to be a zero-token local cache hit.
    const maxEntries = Number(options.maxEntries) || DEFAULT_ANALYSIS_CACHE_MAX_ENTRIES;
    const maxAgeMs = Number(options.maxAgeMs) || DEFAULT_ANALYSIS_CACHE_MAX_AGE_MS;
    let databasePromise;
    let pruneFailureReported = false;

    function openDatabase() {
      if (!databasePromise) {
        databasePromise = new Promise((resolve, reject) => {
          const request = indexedDbRef.open(databaseName, 1);
          request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains('analysisCache')) {
              const store = database.createObjectStore('analysisCache', { keyPath: 'key' });
              store.createIndex('createdAt', 'createdAt');
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      return databasePromise;
    }

    async function getMany(keys) {
      const database = await openDatabase();
      const transaction = database.transaction('analysisCache', 'readwrite');
      const store = transaction.objectStore('analysisCache');
      const done = transactionDone(transaction);
      done.catch(() => {});
      const results = await Promise.all(keys.map(key => requestToPromise(store.get(key))));
      const hits = results.filter(Boolean);
      if (hits.length) {
        const accessedAt = Date.now();
        hits.filter(entry => !isProtectedAnalysisCacheKey(entry?.key))
          .forEach(entry => store.put(recordWithAccessTime(entry, accessedAt)));
      }
      await done;
      return new Map(hits.map(entry => [entry.key, entry]));
    }

    async function listProtectedByPrefix(prefix) {
      if (typeof prefix !== 'string' || prefix.length > MAX_GUARDED_CACHE_KEY_LENGTH ||
          !PROTECTED_ANALYSIS_CACHE_PREFIXES.some(root => prefix.startsWith(root))) {
        throw guardedCacheError('CACHE_GUARD_INVALID_INPUT');
      }
      const database = await openDatabase();
      const transaction = database.transaction('analysisCache', 'readonly');
      const all = await requestToPromise(transaction.objectStore('analysisCache').getAll());
      await transactionDone(transaction);
      return new Map(all.filter(entry => typeof entry?.key === 'string' &&
        entry.key.startsWith(prefix)).map(entry => [entry.key, entry]));
    }

    async function prune(database) {
      const readTransaction = database.transaction('analysisCache', 'readonly');
      const all = await requestToPromise(readTransaction.objectStore('analysisCache').getAll());
      await transactionDone(readTransaction);
      const cutoff = Date.now() - maxAgeMs;
      const sorted = all.filter(entry => !isProtectedAnalysisCacheKey(entry?.key)).sort((a, b) =>
        Number(b.lastAccessedAt || b.createdAt) - Number(a.lastAccessedAt || a.createdAt));
      const removeKeys = sorted
        .filter((entry, index) => entry.createdAt < cutoff || index >= maxEntries)
        .map(entry => entry.key);
      if (!removeKeys.length) return;
      const writeTransaction = database.transaction('analysisCache', 'readwrite');
      const store = writeTransaction.objectStore('analysisCache');
      removeKeys.forEach(key => store.delete(key));
      await transactionDone(writeTransaction);
    }

    function schedulePrune(database) {
      Promise.resolve().then(() => prune(database)).catch(() => {
        if (pruneFailureReported) return;
        pruneFailureReported = true;
        // Maintenance is best-effort after commit. Never log stored data or
        // propagate a diagnostic failure back into a successful business write.
        try {
          console.warn('BREVESS analysis cache maintenance failed after commit.');
        } catch { /* diagnostics must not affect committed writes */ }
      });
    }

    function committedGuardFailure(error, control) {
      const normalized = normalizeGuardFailure(error, control.signal);
      try {
        Object.defineProperty(normalized, 'committed', {
          value: true, enumerable: true, configurable: false, writable: false
        });
      } catch { /* normalized guarded errors are extensible */ }
      return Object.freeze(normalized);
    }

    async function setMany(values) {
      const database = await openDatabase();
      const transaction = database.transaction('analysisCache', 'readwrite');
      const store = transaction.objectStore('analysisCache');
      if (proposesProtectedRecord(values)) {
        const current = await requestToPromise(store.getAll());
        assertProtectedMechanismCapacity(current, values);
      }
      const accessedAt = Date.now();
      values.forEach(value => store.put(recordWithAccessTime(value, accessedAt)));
      await transactionDone(transaction);
      schedulePrune(database);
    }

    async function setManyGuarded(values, guard) {
      const control = createGuardControl(guard);
      assertGuardActive(control);
      const cloned = validateGuardedValues(values);
      assertGuardActive(control);
      let database;
      try {
        database = await openDatabase();
      } catch {
        throw guardedCacheError('CACHE_GUARD_WRITE_FAILED');
      }
      assertGuardActive(control);
      let transaction;
      try {
        transaction = database.transaction('analysisCache', 'readwrite');
      } catch {
        throw guardedCacheError('CACHE_GUARD_WRITE_FAILED');
      }
      let transactionCompleted = false;
      let abortRequested = false;
      let listenerAdded = false;
      let cleanupError = null;
      const abortTransaction = () => {
        if (abortRequested || transactionCompleted) return;
        abortRequested = true;
        try { transaction.abort(); } catch { /* already completed or aborted */ }
      };
      try {
        control.signal.addAbortListener(abortTransaction);
        listenerAdded = true;
        assertGuardActive(control);
        const store = transaction.objectStore('analysisCache');
        if (proposesProtectedRecord(cloned)) {
          const current = await requestToPromise(store.getAll());
          assertGuardActive(control);
          assertProtectedMechanismCapacity(current, cloned);
        }
        const accessedAt = Date.now();
        cloned.forEach(value => store.put(recordWithAccessTime(value, accessedAt)));
        if (control.signal.isAborted()) abortTransaction();
        await transactionDone(transaction);
        transactionCompleted = true;
      } catch (error) {
        abortTransaction();
        throw normalizeGuardFailure(error, control.signal);
      } finally {
        if (listenerAdded) {
          try { control.signal.removeAbortListener(abortTransaction); } catch (error) {
            cleanupError = error;
          }
        }
      }
      schedulePrune(database);
      try {
        if (cleanupError) throw cleanupError;
        assertGuardActive(control);
      } catch (error) {
        throw committedGuardFailure(error, control);
      }
    }

    async function compareAndSetManyGuarded(values, guard) {
      const control = createGuardControl(guard);
      assertGuardActive(control);
      const cloned = validateGuardedValues(values);
      const cas = validateCas(cloned, guard);
      assertGuardActive(control);
      let database;
      try { database = await openDatabase(); } catch {
        throw guardedCacheError('CACHE_GUARD_WRITE_FAILED');
      }
      assertGuardActive(control);
      let transaction;
      try { transaction = database.transaction('analysisCache', 'readwrite'); } catch {
        throw guardedCacheError('CACHE_GUARD_WRITE_FAILED');
      }
      let transactionCompleted = false;
      let abortRequested = false;
      let listenerAdded = false;
      let cleanupError = null;
      let done = null;
      let applied = false;
      let current = null;
      const abortTransaction = () => {
        if (abortRequested || transactionCompleted) return;
        abortRequested = true;
        try { transaction.abort(); } catch { /* already completed or aborted */ }
      };
      try {
        control.signal.addAbortListener(abortTransaction);
        listenerAdded = true;
        assertGuardActive(control);
        const store = transaction.objectStore('analysisCache');
        done = transactionDone(transaction);
        done.catch(() => {});
        current = storedRevision(await requestToPromise(store.get(cas.casKey)));
        assertGuardActive(control);
        if (current.revision !== cas.expectedRevision) {
          await done;
          transactionCompleted = true;
        } else {
          if (proposesProtectedRecord(cloned)) {
            const all = await requestToPromise(store.getAll());
            assertGuardActive(control);
            assertProtectedMechanismCapacity(all, cloned);
          }
          const accessedAt = Date.now();
          cloned.forEach(value => store.put(recordWithAccessTime(value, accessedAt)));
          if (control.signal.isAborted()) abortTransaction();
          await done;
          transactionCompleted = true;
          applied = true;
        }
      } catch (error) {
        abortTransaction();
        if (done) await done.catch(() => {});
        throw normalizeGuardFailure(error, control.signal);
      } finally {
        if (listenerAdded) {
          try { control.signal.removeAbortListener(abortTransaction); } catch (error) {
            cleanupError = error;
          }
        }
      }
      let terminalCode = null;
      try {
        if (cleanupError) throw cleanupError;
        assertGuardActive(control);
      } catch (error) {
        terminalCode = normalizeGuardFailure(error, control.signal).code;
      }
      if (applied) schedulePrune(database);
      return applied
        ? casResult(true, cas.nextRevision, null, terminalCode)
        : casResult(false, current.revision, current.value, terminalCode);
    }

    async function compareAndSetManyAndDeleteGuarded(values, deleteKeys, guard) {
      const control = createGuardControl(guard);
      assertGuardActive(control);
      const cloned = validateGuardedValues(values);
      const cas = validateCas(cloned, guard);
      const deletes = validateProtectedDeleteKeys(
        deleteKeys, cas.casKey, cloned
      );
      assertGuardActive(control);
      let database;
      try { database = await openDatabase(); } catch {
        throw guardedCacheError('CACHE_GUARD_WRITE_FAILED');
      }
      assertGuardActive(control);
      let transaction;
      try { transaction = database.transaction('analysisCache', 'readwrite'); } catch {
        throw guardedCacheError('CACHE_GUARD_WRITE_FAILED');
      }
      let transactionCompleted = false;
      let abortRequested = false;
      let listenerAdded = false;
      let cleanupError = null;
      let done = null;
      let applied = false;
      let current = null;
      const abortTransaction = () => {
        if (abortRequested || transactionCompleted) return;
        abortRequested = true;
        try { transaction.abort(); } catch { /* already completed or aborted */ }
      };
      try {
        control.signal.addAbortListener(abortTransaction);
        listenerAdded = true;
        assertGuardActive(control);
        const store = transaction.objectStore('analysisCache');
        done = transactionDone(transaction);
        done.catch(() => {});
        current = storedRevision(await requestToPromise(store.get(cas.casKey)));
        assertGuardActive(control);
        if (current.revision !== cas.expectedRevision) {
          await done;
          transactionCompleted = true;
        } else {
          validateProtectedDeleteKeys(
            deletes, cas.casKey, cloned, current.value
          );
          const all = await requestToPromise(store.getAll());
          assertGuardActive(control);
          assertProtectedMechanismCapacity(all, cloned, deletes);
          const accessedAt = Date.now();
          cloned.forEach(value => store.put(recordWithAccessTime(value, accessedAt)));
          deletes.forEach(key => store.delete(key));
          if (control.signal.isAborted()) abortTransaction();
          await done;
          transactionCompleted = true;
          applied = true;
        }
      } catch (error) {
        abortTransaction();
        if (done) await done.catch(() => {});
        throw normalizeGuardFailure(error, control.signal);
      } finally {
        if (listenerAdded) {
          try { control.signal.removeAbortListener(abortTransaction); } catch (error) {
            cleanupError = error;
          }
        }
      }
      let terminalCode = null;
      try {
        if (cleanupError) throw cleanupError;
        assertGuardActive(control);
      } catch (error) {
        terminalCode = normalizeGuardFailure(error, control.signal).code;
      }
      if (applied) schedulePrune(database);
      return applied
        ? casResult(true, cas.nextRevision, null, terminalCode)
        : casResult(false, current.revision, current.value, terminalCode);
    }

    async function deleteMany(keys) {
      if (!Array.isArray(keys) || !keys.length) return;
      const database = await openDatabase();
      const transaction = database.transaction('analysisCache', 'readwrite');
      const store = transaction.objectStore('analysisCache');
      keys.forEach(key => store.delete(key));
      await transactionDone(transaction);
    }

    return {
      getMany, listProtectedByPrefix, setMany, setManyGuarded,
      compareAndSetManyGuarded, compareAndSetManyAndDeleteGuarded, deleteMany
    };
  }

  function expandAnnotations(groups) {
    return groups.flatMap(group => (group.categories || []).map(category => ({
      paragraphId: group.paragraphId,
      start: group.start,
      end: group.end,
      quote: group.quote,
      categoryId: category.categoryId,
      confidence: category.confidence,
      reasonZh: category.reasonZh || '',
      annotationId: category.annotationId || '',
      relationId: category.relationId || '',
      claimMode: category.claimMode || 'explicit',
      quoteRole: category.quoteRole || 'statement',
      slots: Array.isArray(category.slots) ? category.slots : [],
      supportSpans: Array.isArray(category.supportSpans) ? category.supportSpans : [],
      minimumConfidence: Number(category.minimumConfidence) || 0.8
    })));
  }

  function filterAnnotations(groups, categoryId) {
    return groups.flatMap(group => {
      const categories = (group.categories || []).filter(item => item.categoryId === categoryId);
      return categories.length ? [Object.assign({}, group, { categories })] : [];
    });
  }

  async function analyzeWithCategoryCache({
    paragraphs,
    selectedCategories,
    providerId,
    model,
    profileSignature = '',
    adapter,
    cacheStore,
    maxChars = 12000,
    concurrency = 3,
    contextHash = '',
    viewId = 'quick_story',
    paperBlueprint = {},
    studyProfile = null,
    signal,
    waitIfPaused,
    onProgress,
    onChunkComplete = async () => {},
    onParagraphComplete = async () => {}
  }) {
    const documentHash = await hashDocument(paragraphs);
    const signatureByCategory = new Map(selectedCategories.map(category => [
      category.categoryId,
      shared.buildEffectiveCategorySignature(category)
    ]));
    const keyByCategory = new Map(selectedCategories.map(category => [
      category.categoryId,
      shared.buildCategoryCacheKey({
        documentHash,
        providerId,
        model,
        profileSignature,
        categoryId: category.categoryId,
        categoryVersion: category.version,
        effectiveCategorySignature: signatureByCategory.get(category.categoryId),
        promptVersion: ANALYSIS_CACHE_VERSIONS.prompt,
        chunkerVersion: ANALYSIS_CACHE_VERSIONS.chunker,
        contextHash
      })
    ]));
    const cached = await cacheStore.getMany([...keyByCategory.values()]);
    const cachedCategoryIds = selectedCategories
      .filter(category => cached.has(keyByCategory.get(category.categoryId)))
      .map(category => category.categoryId);
    const missingCategories = selectedCategories.filter(category =>
      !cached.has(keyByCategory.get(category.categoryId))
    );
    const cachedAnnotations = cachedCategoryIds.flatMap(categoryId =>
      cached.get(keyByCategory.get(categoryId)).annotations || []
    );

    let fresh = { annotations: [], analyzedCategoryIds: [], rejected: [] };
    if (missingCategories.length) {
      const progressKey = `progress:${shared.stableHash({
        documentHash,
        providerId,
        model,
        profileSignature,
        categories: missingCategories.map(category => [
          category.categoryId,
          signatureByCategory.get(category.categoryId)
        ]),
        promptVersion: ANALYSIS_CACHE_VERSIONS.prompt,
        chunkerVersion: ANALYSIS_CACHE_VERSIONS.chunker,
        contextHash,
        viewId,
        maxChars,
        concurrency
      })}`;
      const storedProgress = await cacheStore.getMany([progressKey]);
      const progressChunks = { ...(storedProgress.get(progressKey)?.chunks || {}) };
      const progressParagraphs = { ...(storedProgress.get(progressKey)?.paragraphs || {}) };
      const progressDecisions = { ...(storedProgress.get(progressKey)?.decisionRounds || {}) };
      let progressWriteTail = Promise.resolve();
      function saveProgress() {
        const operation = progressWriteTail.then(() => cacheStore.setMany([{
          key: progressKey,
          createdAt: Date.now(),
          chunks: progressChunks,
          paragraphs: progressParagraphs,
          decisionRounds: progressDecisions
        }]));
        progressWriteTail = operation.catch(() => {});
        return operation;
      }
      fresh = await shared.analyzeDocument({
        paragraphs,
        selectedCategories: missingCategories,
        adapter,
        maxChars,
        concurrency,
        viewId,
        paperBlueprint,
        studyProfile,
        signal,
        waitIfPaused,
        resumeChunks: progressChunks,
        resumeParagraphs: progressParagraphs,
        resumeDecisionRounds: progressDecisions,
        onDecisionRoundComplete: async completed => {
          progressDecisions[completed.key] = completed;
          const keys = Object.keys(progressDecisions);
          if (keys.length > 4096) delete progressDecisions[keys[0]];
          await saveProgress();
        },
        onParagraphComplete: async completed => {
          progressParagraphs[`${completed.chunkId}:${completed.paragraphIndex}`] = completed;
          await saveProgress();
          await onParagraphComplete(completed);
        },
        onChunkComplete: async completed => {
          progressChunks[completed.chunkId] = completed;
          await saveProgress();
          await onChunkComplete(completed);
        },
        onProgress
      });
      await progressWriteTail;
      const now = Date.now();
      await cacheStore.setMany(missingCategories.map(category => ({
        key: keyByCategory.get(category.categoryId),
        categoryId: category.categoryId,
        effectiveCategorySignature: signatureByCategory.get(category.categoryId),
        createdAt: now,
        annotations: filterAnnotations(fresh.annotations, category.categoryId)
      })));
    }

    return {
      annotations: shared.mergeAnnotations(expandAnnotations([...cachedAnnotations, ...fresh.annotations])),
      analyzedCategoryIds: missingCategories.map(category => category.categoryId),
      cachedCategoryIds,
      rejected: fresh.rejected || [],
      documentHash
    };
  }

  return {
    hashDocument,
    createMemoryAnalysisCache,
    createIndexedDbAnalysisCache,
    analyzeWithCategoryCache,
    ANALYSIS_CACHE_VERSIONS,
    DEFAULT_ANALYSIS_CACHE_MAX_ENTRIES,
    DEFAULT_ANALYSIS_CACHE_MAX_AGE_MS,
    MAX_PROTECTED_MECHANISM_ACTIVE_RUNS,
    MAX_PROTECTED_MECHANISM_RECORDS,
    MAX_PROTECTED_MECHANISM_TOTAL_BYTES,
    PROTECTED_ANALYSIS_CACHE_PREFIXES,
    MAX_GUARDED_CACHE_VALUES,
    MAX_GUARDED_CACHE_KEY_LENGTH,
    MAX_GUARDED_DATA_CHARS
  };
});
