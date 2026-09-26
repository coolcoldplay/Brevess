(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const MECHANISM_OPERATION_COORDINATOR_VERSION = '1';
  const MECHANISM_CHECKPOINT_SCHEMA_VERSION = '1';
  const evidenceFirstContracts = shared.EVIDENCE_FIRST_POLICY &&
    shared.EVIDENCE_FIRST_VERSIONS
    ? shared
    : typeof require === 'function'
      ? require('./evidence-first-mechanism.js')
      : null;
  if (!evidenceFirstContracts?.EVIDENCE_FIRST_POLICY ||
      !evidenceFirstContracts?.EVIDENCE_FIRST_VERSIONS) {
    throw new Error('EVIDENCE_FIRST_CONTRACT_UNAVAILABLE');
  }
  const EVIDENCE_FIRST_POLICY = evidenceFirstContracts.EVIDENCE_FIRST_POLICY;
  const MAX_PROVIDER_REQUESTS_PER_RUN = EVIDENCE_FIRST_POLICY.maxProviderRequestsPerRun;
  const OPERATION_DEADLINE_MS = EVIDENCE_FIRST_POLICY.operationDeadlineMs;
  const MAX_ACTIVE_MECHANISM_CONTEXTS = 128;
  const MECHANISM_RUN_STATE_SCHEMA_VERSION = '6';
  const MECHANISM_PROTECTED_BYTES_RESERVATION = 24 * 1024 * 1024;
  const MAX_COMPLETED_PANEL_KEYS = 512;
  const MECHANISM_OWNER_AUTHORITY_SCHEMA_VERSION = '2';
  const MECHANISM_BINDING_VERSIONS = evidenceFirstContracts.EVIDENCE_FIRST_VERSIONS;
  const VERSION_KEYS = Object.freeze(Object.keys(MECHANISM_BINDING_VERSIONS));
  const BINDING_KEYS = Object.freeze([
    'baseWorkspaceRevision', 'browserSessionId', 'cacheVersion',
    'canonicalSchemaVersion', 'documentHash',
    'documentId', 'evidenceSchemaVersion', 'idAlgorithmVersion', 'normalizationVersion',
    'mechanismChainFingerprint', 'operationEpoch', 'operationId', 'profileSignature',
    'promptVersion', 'senderDocumentId', 'senderExtensionId', 'senderFrameId',
    'senderTabId', 'workspaceGeneration', 'workspaceId', 'workspaceLifecycle'
  ]);
  const CHECKPOINT_KEYS = Object.freeze([
    'binding', 'completedPanelKeys', 'nextBatchIndex', 'payload', 'phase',
    'providerReceiptIds', 'schemaVersion'
  ]);
  const CHECKPOINT_PHASES = new Set([
    'panel_census', 'canonicalization', 'edge_batch', 'coverage_repair', 'ready'
  ]);
  const CHECKPOINT_PHASE_ORDER = Object.freeze({
    panel_census: 0,
    canonicalization: 1,
    edge_batch: 2,
    coverage_repair: 3,
    ready: 4
  });
  const MAX_CHECKPOINT_SEQUENCE =
    (Object.keys(CHECKPOINT_PHASE_ORDER).length - 1) * 100_001 + 100_000;
  const READY_CHECKPOINT_SEQUENCE = CHECKPOINT_PHASE_ORDER.ready * 100_001;
  const MAX_CHECKPOINT_COMMITS = MAX_CHECKPOINT_SEQUENCE + 1;
  const RUN_IDENTITY_KEYS = Object.freeze(BINDING_KEYS.filter(key => key !== 'operationEpoch'));
  const OWNER_IDENTITY_KEYS = Object.freeze([
    'browserSessionId', 'documentId', 'mechanismChainFingerprint', 'senderDocumentId',
    'senderExtensionId', 'senderFrameId', 'senderTabId', 'workspaceGeneration',
    'workspaceId', 'workspaceLifecycle'
  ]);
  const RUN_INDEX_KEYS = Object.freeze([
    'cancelGeneration', 'identity', 'latestEpoch', 'latestRunRevision', 'latestRunStateKey',
    'protectedBytesReserved', 'revision', 'schemaVersion', 'terminal'
  ]);
  const RUN_INDEX_TERMINALS = new Set([
    'active', 'cancelled', 'complete', 'failed', 'needs_review', 'released'
  ]);
  const CAS_RECEIPT_KEYS = Object.freeze([
    'applied', 'currentValue', 'revision', 'terminalCode'
  ]);
  const RUN_STATE_KEYS = Object.freeze([
    'binding', 'checkpointCommits', 'checkpointSequence', 'completedPanelKeys', 'deadlineAt',
    'providerRequestReceipts', 'providerRequestsClaimed', 'providerReceiptsCheckpointed',
    'revision', 'schemaVersion', 'startedAt'
  ]);
  const PROVIDER_REQUEST_RECEIPT_KEYS = Object.freeze([
    'bindingDigest', 'receipt', 'requestNumber'
  ]);
  const TAB_AUTHORITY_KEYS = Object.freeze([
    'navigationGeneration', 'retired', 'schemaVersion', 'senderExtensionId', 'senderTabId'
  ]);
  const FRAME_AUTHORITY_KEYS = Object.freeze([
    'navigationGeneration', 'schemaVersion', 'senderDocumentId', 'senderExtensionId',
    'senderFrameId', 'senderTabId', 'workspaceLifecycle'
  ]);
  const MAX_DATA_NODES = 50_000;
  const MAX_DATA_DEPTH = 32;
  const MAX_STRING_LENGTH = 1_000_000;
  const MAX_DATA_CHARS = 8_000_000;

  const ERROR_MESSAGES = Object.freeze({
    MECHANISM_OPERATION_CANCELLED: 'Mechanism operation was cancelled',
    MECHANISM_OPERATION_STALE: 'Mechanism operation is stale',
    MECHANISM_OPERATION_DEADLINE_EXCEEDED: 'Mechanism operation deadline was exceeded',
    MECHANISM_OPERATION_FINALIZED: 'Mechanism operation is already finalized',
    MECHANISM_OPERATION_CAPACITY_EXCEEDED: 'Mechanism operation capacity was exceeded',
    MECHANISM_PROVIDER_REQUEST_BUDGET_EXCEEDED: 'Mechanism provider request budget was exceeded',
    MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS: 'Mechanism provider request receipt is ambiguous',
    MECHANISM_PROVIDER_RECEIPT_MISMATCH: 'Mechanism provider request receipt does not match',
    MECHANISM_CHECKPOINT_INVALID: 'Mechanism checkpoint is invalid',
    MECHANISM_CHECKPOINT_READ_FAILED: 'Mechanism checkpoint read failed',
    MECHANISM_CHECKPOINT_WRITE_FAILED: 'Mechanism checkpoint write failed',
    MECHANISM_RUN_STATE_READ_FAILED: 'Mechanism run state read failed',
    MECHANISM_RUN_STATE_WRITE_FAILED: 'Mechanism run state write failed',
    MECHANISM_OPERATION_INVALID: 'Mechanism operation input is invalid'
  });

  function mechanismError(code, details = null) {
    const error = new Error(ERROR_MESSAGES[code] || ERROR_MESSAGES.MECHANISM_OPERATION_INVALID);
    error.name = code === 'MECHANISM_OPERATION_CANCELLED' ? 'AbortError' : 'Error';
    error.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'MECHANISM_OPERATION_INVALID';
    error.retryable = false;
    if (details?.committed === true) error.committed = true;
    if (Number.isSafeInteger(details?.requestNumber) && details.requestNumber > 0) {
      error.requestNumber = details.requestNumber;
    }
    return Object.freeze(error);
  }

  function ownData(object, key) {
    if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined;
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(object, key); } catch { return undefined; }
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  }

  function readOwnShape(value) {
    try {
      const prototype = Object.getPrototypeOf(value);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);
      return { prototype, descriptors, keys };
    } catch {
      return null;
    }
  }

  function isArrayOwnData(value) {
    try { return Array.isArray(value); } catch {
      throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
    }
  }

  function exactOwnKeys(object, expected) {
    if (!object || typeof object !== 'object') return false;
    const shape = readOwnShape(object);
    if (!shape || (shape.prototype !== Object.prototype && shape.prototype !== null)) return false;
    return shape.keys.length === expected.length && shape.keys.every(key =>
      typeof key === 'string' && expected.includes(key) &&
      shape.descriptors[key].enumerable && Object.hasOwn(shape.descriptors[key], 'value'));
  }

  function exactOwnValues(object, expected) {
    if (!object || typeof object !== 'object') return null;
    const shape = readOwnShape(object);
    if (!shape || (shape.prototype !== Object.prototype && shape.prototype !== null) ||
        shape.keys.length !== expected.length) return null;
    const values = {};
    for (const key of shape.keys) {
      const descriptor = shape.descriptors[key];
      if (typeof key !== 'string' || !expected.includes(key) || !descriptor.enumerable ||
          !Object.hasOwn(descriptor, 'value')) return null;
      values[key] = descriptor.value;
    }
    return values;
  }

  function exactRecordEnvelope(object, required, optional = ['lastAccessedAt']) {
    if (!object || typeof object !== 'object') return false;
    const shape = readOwnShape(object);
    if (!shape || (shape.prototype !== Object.prototype && shape.prototype !== null)) return false;
    const allowed = new Set([...required, ...optional]);
    const lastAccessedAt = shape.keys.includes('lastAccessedAt')
      ? shape.descriptors.lastAccessedAt?.value
      : null;
    return (lastAccessedAt === null ||
      (Number.isSafeInteger(lastAccessedAt) && lastAccessedAt >= 0)) &&
      required.every(key => shape.keys.includes(key)) &&
      shape.keys.every(key => typeof key === 'string' && allowed.has(key) &&
        shape.descriptors[key].enumerable &&
        Object.hasOwn(shape.descriptors[key], 'value'));
  }

  function boundedString(value, { allowEmpty = false, maxLength = 256 } = {}) {
    if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && !value)) {
      throw mechanismError('MECHANISM_OPERATION_INVALID');
    }
    return value;
  }

  function cloneOwnData(value, state = { nodes: 0, chars: 0 }, depth = 0) {
    state.nodes += 1;
    if (state.nodes > MAX_DATA_NODES || depth > MAX_DATA_DEPTH) {
      throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      state.chars += value.length;
      if (value.length > MAX_STRING_LENGTH || state.chars > MAX_DATA_CHARS) {
        throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
      }
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object') throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
    const isArray = isArrayOwnData(value);
    const shape = readOwnShape(value);
    if (!shape) throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
    const { descriptors, keys } = shape;
    if (isArray) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_DATA_NODES) {
        throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
      }
      const result = new Array(length);
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
          throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
        }
        result[index] = cloneOwnData(descriptor.value, state, depth + 1);
      }
      if (keys.some(key => key !== 'length' &&
          !(typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < length))) {
        throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
      }
      return result;
    }
    if (shape.prototype !== Object.prototype && shape.prototype !== null) {
      throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
    }
    const result = {};
    keys.forEach(key => {
      const descriptor = descriptors[key];
      if (typeof key !== 'string' || !descriptor.enumerable ||
          !Object.hasOwn(descriptor, 'value')) {
        throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
      }
      state.chars += key.length;
      if (state.chars > MAX_DATA_CHARS) throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
      Object.defineProperty(result, key, {
        value: cloneOwnData(descriptor.value, state, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true
      });
    });
    return result;
  }

  function deepFreeze(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach(item => deepFreeze(item, seen));
    return Object.freeze(value);
  }

  function sameBinding(candidate, authoritative) {
    if (!exactOwnKeys(candidate, BINDING_KEYS)) return false;
    return BINDING_KEYS.every(key => ownData(candidate, key) === authoritative[key]);
  }

  function sameIdentity(candidate, authoritative) {
    if (!exactOwnKeys(candidate, RUN_IDENTITY_KEYS)) return false;
    return RUN_IDENTITY_KEYS.every(key => ownData(candidate, key) === authoritative[key]);
  }

  function sameOwnerIdentity(candidate, authoritative) {
    return OWNER_IDENTITY_KEYS.every(key =>
      ownData(candidate, key) === authoritative[key]);
  }

  function shortStableHash(value) {
    const text = JSON.stringify(value);
    const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
    return seeds.map(seed => {
      let hash = seed >>> 0;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return hash.toString(16).padStart(8, '0');
    }).join('');
  }

  function createMechanismOperationCoordinator(options = {}) {
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const durableRestoreAuthority = Object.freeze({});
    const registry = options.operationRegistry || shared.createOperationRegistry?.({
      now, durableRestoreAuthority
    });
    const registryRestoreAuthority = options.operationRegistry
      ? ownData(options, 'operationRegistryDurableRestoreAuthority')
      : durableRestoreAuthority;
    const cacheStore = options.cacheStore || shared.createMemoryAnalysisCache?.();
    const enforceOwnerAuthority = ownData(options, 'enforceOwnerAuthority') === true;
    const suppliedSessionIdentityProvider = ownData(options, 'sessionIdentityProvider');
    if (suppliedSessionIdentityProvider !== undefined &&
        typeof suppliedSessionIdentityProvider !== 'function') {
      throw mechanismError('MECHANISM_OPERATION_INVALID');
    }
    if (!registry || !cacheStore) throw mechanismError('MECHANISM_OPERATION_INVALID');
    const contexts = new Map();
    const terminalHandles = new WeakMap();
    const replacementReservationCounts = new Map();
    const beginTails = new Map();
    let contextCapacityTail = Promise.resolve();
    let pendingContextSlots = 0;
    let browserSessionId = suppliedSessionIdentityProvider === undefined
      ? '0'.repeat(64) : '';
    let browserSessionIdentityPromise = null;

    function protectedPrefix(kind) {
      if (!/^[a-f0-9]{64}$/u.test(browserSessionId)) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      return `mechanism-${kind}:${browserSessionId}:`;
    }

    async function ensureBrowserSessionIdentity() {
      if (/^[a-f0-9]{64}$/u.test(browserSessionId)) return browserSessionId;
      if (!browserSessionIdentityPromise) {
        browserSessionIdentityPromise = Promise.resolve()
          .then(() => suppliedSessionIdentityProvider())
          .then(async value => {
            if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
              throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
            }
            if (typeof cacheStore.listProtectedByPrefix === 'function' &&
                typeof cacheStore.deleteMany === 'function') {
              const prefixes = [
                'mechanism-run-index:', 'mechanism-run-state:',
                'mechanism-checkpoint:', 'mechanism-owner-tab:',
                'mechanism-owner-current:'
              ];
              const staleKeys = [];
              for (const prefix of prefixes) {
                let records;
                try { records = await cacheStore.listProtectedByPrefix(prefix); } catch {
                  throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
                }
                if (!(records instanceof Map)) {
                  throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
                }
                const currentPrefix = `${prefix}${value}:`;
                for (const key of records.keys()) {
                  if (!String(key).startsWith(currentPrefix)) staleKeys.push(key);
                }
              }
              if (staleKeys.length) {
                try { await cacheStore.deleteMany([...new Set(staleKeys)]); } catch {
                  throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
                }
              }
            }
            // Do not publish the new namespace until every stale authority key has
            // been removed.  A failed purge must be retried (and must continue to
            // fail closed) instead of letting a later admission skip initialization.
            browserSessionId = value;
            return value;
          });
      }
      try {
        return await browserSessionIdentityPromise;
      } catch (error) {
        browserSessionIdentityPromise = null;
        browserSessionId = '';
        if (error?.code === 'MECHANISM_RUN_STATE_READ_FAILED' ||
            error?.code === 'MECHANISM_RUN_STATE_WRITE_FAILED') {
          throw error;
        }
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
    }

    function contextKey(operationId, epoch) {
      return `${operationId}:${epoch}`;
    }

    function resolveContext(handle) {
      const operationId = ownData(handle, 'operationId');
      const epoch = ownData(handle, 'epoch');
      const context = contexts.get(contextKey(operationId, epoch)) ||
        (handle && typeof handle === 'object' ? terminalHandles.get(handle) : null);
      if (!context || context.handle !== handle) {
        throw mechanismError('MECHANISM_OPERATION_STALE');
      }
      return context;
    }

    function assertContextActive(context) {
      try {
        registry.assertActive(context.capture);
      } catch (error) {
        if (ownData(error, 'code') === 'CANCELLED') {
          throw mechanismError('MECHANISM_OPERATION_CANCELLED');
        }
        throw mechanismError('MECHANISM_OPERATION_STALE');
      }
      if (now() >= context.deadlineAt) {
        throw mechanismError('MECHANISM_OPERATION_DEADLINE_EXCEEDED');
      }
      return context;
    }

    function assertActive(handle) {
      const context = resolveContext(handle);
      if (context.finalizedStatus) {
        throw mechanismError(context.finalizedStatus === 'cancelled'
          ? 'MECHANISM_OPERATION_CANCELLED'
          : 'MECHANISM_OPERATION_FINALIZED');
      }
      return assertContextActive(context).handle;
    }

    function runStateKeyForBinding(binding) {
      return `${protectedPrefix('run-state')}${shortStableHash(binding)}`;
    }

    function runIndexKeyForOperationId(operationId) {
      return `${protectedPrefix('run-index')}${shortStableHash(operationId)}`;
    }

    function checkpointKeyForBinding(binding) {
      return `${protectedPrefix('checkpoint')}${shortStableHash(binding)}`;
    }

    function tabAuthorityKeyFor(value) {
      return `${protectedPrefix('owner-tab')}${shortStableHash({
        senderExtensionId: value.senderExtensionId,
        senderTabId: value.senderTabId
      })}`;
    }

    function frameAuthorityKeyFor(value) {
      return `${protectedPrefix('owner-current')}${shortStableHash({
        senderExtensionId: value.senderExtensionId,
        senderTabId: value.senderTabId,
        senderFrameId: value.senderFrameId
      })}`;
    }

    function authorityRecord(key, revision, createdAt, field, value) {
      return { key, revision, createdAt, [field]: deepFreeze(value) };
    }

    function validateTabAuthorityRecord(key, record) {
      if (!exactRecordEnvelope(record, [
        'key', 'createdAt', 'revision', 'tabAuthority'
      ]) || ownData(record, 'key') !== key) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      const revision = ownData(record, 'revision');
      const values = exactOwnValues(ownData(record, 'tabAuthority'), TAB_AUTHORITY_KEYS);
      if (!values || values.schemaVersion !== MECHANISM_OWNER_AUTHORITY_SCHEMA_VERSION ||
          !Number.isSafeInteger(revision) || revision < 0 ||
          !Number.isSafeInteger(values.navigationGeneration) ||
          values.navigationGeneration < 1 || typeof values.retired !== 'boolean' ||
          typeof values.senderExtensionId !== 'string' || !values.senderExtensionId ||
          !Number.isSafeInteger(values.senderTabId) || values.senderTabId < 0) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      return deepFreeze({ ...values, revision });
    }

    function validateFrameAuthorityRecord(key, record) {
      if (!exactRecordEnvelope(record, [
        'key', 'createdAt', 'revision', 'frameAuthority'
      ]) || ownData(record, 'key') !== key) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      const revision = ownData(record, 'revision');
      const values = exactOwnValues(ownData(record, 'frameAuthority'), FRAME_AUTHORITY_KEYS);
      if (!values || values.schemaVersion !== MECHANISM_OWNER_AUTHORITY_SCHEMA_VERSION ||
          !Number.isSafeInteger(revision) || revision < 0 ||
          !Number.isSafeInteger(values.navigationGeneration) ||
          values.navigationGeneration < 1 ||
          typeof values.senderExtensionId !== 'string' || !values.senderExtensionId ||
          !Number.isSafeInteger(values.senderTabId) || values.senderTabId < 0 ||
          !Number.isSafeInteger(values.senderFrameId) || values.senderFrameId < 0 ||
          typeof values.senderDocumentId !== 'string' || !values.senderDocumentId ||
          (values.workspaceLifecycle !== null &&
            (!Number.isSafeInteger(values.workspaceLifecycle) ||
              values.workspaceLifecycle < 0))) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      return deepFreeze({ ...values, revision });
    }

    function buildRunState(context, values) {
      const completedPanelKeys = cloneOwnData(values.completedPanelKeys);
      const providerRequestReceipts = cloneOwnData(values.providerRequestReceipts || []);
      return deepFreeze({
        schemaVersion: MECHANISM_RUN_STATE_SCHEMA_VERSION,
        binding: context.binding,
        revision: values.revision,
        startedAt: values.startedAt,
        deadlineAt: values.deadlineAt,
        providerRequestsClaimed: values.providerRequestsClaimed,
        providerReceiptsCheckpointed: cloneOwnData(
          values.providerReceiptsCheckpointed || []
        ),
        providerRequestReceipts,
        checkpointSequence: values.checkpointSequence,
        checkpointCommits: values.checkpointCommits,
        completedPanelKeys
      });
    }

    function runStateRecord(context, state) {
      return {
        key: context.runStateKey,
        createdAt: state.startedAt,
        revision: state.revision,
        runState: state
      };
    }

    function buildRunIndex(context, values) {
      return deepFreeze({
        schemaVersion: MECHANISM_RUN_STATE_SCHEMA_VERSION,
        identity: context.identity,
        revision: values.revision,
        latestEpoch: context.capture.epoch,
        latestRunStateKey: context.runStateKey,
        latestRunRevision: values.latestRunRevision,
        terminal: values.terminal || context.runIndex?.terminal || 'active',
        protectedBytesReserved: values.protectedBytesReserved ??
          context.runIndex?.protectedBytesReserved ?? 0,
        cancelGeneration: values.cancelGeneration ??
          context.runIndex?.cancelGeneration ?? context.capture.cancelGeneration
      });
    }

    function runIndexRecord(context, index) {
      return {
        key: context.runIndexKey,
        createdAt: now(),
        revision: index.revision,
        runIndex: index
      };
    }

    function validateRunStateRecord(context, record) {
      if (!exactRecordEnvelope(record, ['key', 'createdAt', 'revision', 'runState']) ||
          ownData(record, 'key') !== context.runStateKey) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      const state = ownData(record, 'runState');
      if (!state || !exactOwnKeys(state, RUN_STATE_KEYS) ||
          ownData(state, 'schemaVersion') !== MECHANISM_RUN_STATE_SCHEMA_VERSION ||
          !sameBinding(ownData(state, 'binding'), context.binding)) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      const revision = ownData(state, 'revision');
      const startedAt = ownData(state, 'startedAt');
      const deadlineAt = ownData(state, 'deadlineAt');
      const providerRequestsClaimed = ownData(state, 'providerRequestsClaimed');
      const providerReceiptsCheckpointed = ownData(state, 'providerReceiptsCheckpointed');
      const providerRequestReceipts = ownData(state, 'providerRequestReceipts');
      const checkpointSequence = ownData(state, 'checkpointSequence');
      const checkpointCommits = ownData(state, 'checkpointCommits');
      const completedPanelKeys = ownData(state, 'completedPanelKeys');
      let clonedCompletedPanelKeys;
      let clonedProviderRequestReceipts;
      let clonedProviderReceiptsCheckpointed;
      try { clonedCompletedPanelKeys = cloneOwnData(completedPanelKeys); } catch {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      try { clonedProviderRequestReceipts = cloneOwnData(providerRequestReceipts); } catch {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      try {
        clonedProviderReceiptsCheckpointed = cloneOwnData(providerReceiptsCheckpointed);
      } catch {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      if (!Number.isSafeInteger(revision) || revision < 0 ||
          ownData(record, 'revision') !== revision ||
          !Number.isSafeInteger(startedAt) || startedAt < 0 ||
          ownData(record, 'createdAt') !== startedAt ||
          deadlineAt !== startedAt + OPERATION_DEADLINE_MS ||
          !Number.isSafeInteger(providerRequestsClaimed) || providerRequestsClaimed < 0 ||
          providerRequestsClaimed > MAX_PROVIDER_REQUESTS_PER_RUN ||
          !Number.isSafeInteger(checkpointSequence) || checkpointSequence < -1 ||
          checkpointSequence > MAX_CHECKPOINT_SEQUENCE ||
          !Number.isSafeInteger(checkpointCommits) || checkpointCommits < 0 ||
          checkpointCommits > MAX_CHECKPOINT_COMMITS ||
          (checkpointSequence === -1 && checkpointCommits !== 0) ||
          (checkpointSequence >= 0 &&
           (checkpointCommits < 1 || checkpointCommits > checkpointSequence + 1))) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      if (!Array.isArray(clonedCompletedPanelKeys) ||
          clonedCompletedPanelKeys.length > MAX_COMPLETED_PANEL_KEYS ||
          clonedCompletedPanelKeys.some(key => typeof key !== 'string' || !key || key.length > 512) ||
          new Set(clonedCompletedPanelKeys).size !== clonedCompletedPanelKeys.length) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      if (!Array.isArray(clonedProviderRequestReceipts) ||
          clonedProviderRequestReceipts.length > MAX_PROVIDER_REQUESTS_PER_RUN ||
          !Array.isArray(clonedProviderReceiptsCheckpointed) ||
          clonedProviderReceiptsCheckpointed.length > clonedProviderRequestReceipts.length ||
          clonedProviderReceiptsCheckpointed.some(receipt =>
            typeof receipt !== 'string' || !/^[a-f0-9]{64}$/u.test(receipt)) ||
          new Set(clonedProviderReceiptsCheckpointed).size !==
            clonedProviderReceiptsCheckpointed.length) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      const receiptIds = new Set();
      const requestNumbers = new Set();
      for (const receipt of clonedProviderRequestReceipts) {
        const values = exactOwnValues(receipt, PROVIDER_REQUEST_RECEIPT_KEYS);
        if (!values || !/^[a-f0-9]{64}$/u.test(values.receipt) ||
            !/^[a-f0-9]{64}$/u.test(values.bindingDigest) ||
            !Number.isSafeInteger(values.requestNumber) || values.requestNumber < 1 ||
            values.requestNumber > providerRequestsClaimed ||
            receiptIds.has(values.receipt) || requestNumbers.has(values.requestNumber)) {
          throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
        }
        receiptIds.add(values.receipt);
        requestNumbers.add(values.requestNumber);
      }
      if (clonedProviderReceiptsCheckpointed.some(receipt => !receiptIds.has(receipt))) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      return buildRunState(context, {
        revision, startedAt, deadlineAt, providerRequestsClaimed,
        providerReceiptsCheckpointed: clonedProviderReceiptsCheckpointed,
        checkpointSequence, checkpointCommits,
        providerRequestReceipts: clonedProviderRequestReceipts,
        completedPanelKeys: clonedCompletedPanelKeys
      });
    }

    function validateRunIdentity(candidate, operationId, failureCode) {
      const values = exactOwnValues(candidate, RUN_IDENTITY_KEYS);
      if (!values || values.operationId !== operationId ||
          !Number.isSafeInteger(values.baseWorkspaceRevision) ||
          values.baseWorkspaceRevision < 0 ||
          typeof values.documentId !== 'string' || !values.documentId ||
          values.documentId.length > 256 ||
          typeof values.documentHash !== 'string' || !values.documentHash ||
          values.documentHash.length > 256 ||
          typeof values.workspaceId !== 'string' || !values.workspaceId ||
          values.workspaceId.length > 256 ||
          !Number.isSafeInteger(values.workspaceGeneration) ||
          values.workspaceGeneration < 1 ||
          !Number.isSafeInteger(values.workspaceLifecycle) ||
          values.workspaceLifecycle < 0 ||
          typeof values.mechanismChainFingerprint !== 'string' ||
          !values.mechanismChainFingerprint ||
          values.mechanismChainFingerprint.length > 256 ||
          typeof values.senderExtensionId !== 'string' || !values.senderExtensionId ||
          values.senderExtensionId.length > 256 ||
          !Number.isSafeInteger(values.senderTabId) || values.senderTabId < -1 ||
          !Number.isSafeInteger(values.senderFrameId) || values.senderFrameId < -1 ||
          typeof values.senderDocumentId !== 'string' || !values.senderDocumentId ||
          values.senderDocumentId.length > 256 ||
          typeof values.profileSignature !== 'string' || values.profileSignature.length > 512 ||
          VERSION_KEYS.some(key => typeof values[key] !== 'string' ||
            !values[key] || values[key].length > 128)) {
        throw mechanismError(failureCode);
      }
      return deepFreeze({ ...values });
    }

    function validateRunIndexRecord(operationId, runIndexKey, record, failureCode) {
      if (!exactRecordEnvelope(record, ['key', 'createdAt', 'revision', 'runIndex']) ||
          ownData(record, 'key') !== runIndexKey) {
        throw mechanismError(failureCode);
      }
      const index = ownData(record, 'runIndex');
      const values = exactOwnValues(index, RUN_INDEX_KEYS);
      if (!values || values.schemaVersion !== MECHANISM_RUN_STATE_SCHEMA_VERSION) {
        throw mechanismError(failureCode);
      }
      const identity = validateRunIdentity(values.identity, operationId, failureCode);
      const revision = values.revision;
      const latestEpoch = values.latestEpoch;
      const latestRunRevision = values.latestRunRevision;
      const latestRunStateKey = values.latestRunStateKey;
      const terminal = values.terminal;
      const cancelGeneration = values.cancelGeneration;
      const protectedBytesReserved = values.protectedBytesReserved;
      const binding = deepFreeze({ ...identity, operationEpoch: latestEpoch });
      if (!Number.isSafeInteger(revision) || revision < 0 ||
          ownData(record, 'revision') !== revision ||
          !Number.isSafeInteger(latestEpoch) || latestEpoch < 1 ||
          !Number.isSafeInteger(latestRunRevision) || latestRunRevision < 0 ||
          !RUN_INDEX_TERMINALS.has(terminal) ||
          !Number.isSafeInteger(cancelGeneration) || cancelGeneration < 0 ||
          !Number.isSafeInteger(protectedBytesReserved) || protectedBytesReserved < 0 ||
          protectedBytesReserved > MECHANISM_PROTECTED_BYTES_RESERVATION ||
          (terminal !== 'active' && terminal !== 'complete' && terminal !== 'needs_review' &&
            protectedBytesReserved !== 0) ||
          typeof latestRunStateKey !== 'string' ||
          latestRunStateKey !== runStateKeyForBinding(binding)) {
        throw mechanismError(failureCode);
      }
      return deepFreeze({
        schemaVersion: MECHANISM_RUN_STATE_SCHEMA_VERSION,
        identity,
        revision,
        latestEpoch,
        latestRunStateKey,
        latestRunRevision,
        terminal,
        cancelGeneration,
        protectedBytesReserved
      });
    }

    function parseCasReceipt(result, expectedRevision, failureCode) {
      const values = exactOwnValues(result, CAS_RECEIPT_KEYS);
      if (!values || typeof values.applied !== 'boolean' ||
          (values.revision !== null &&
           (!Number.isSafeInteger(values.revision) || values.revision < 0)) ||
          (values.terminalCode !== null &&
           ![
             'CACHE_GUARD_ABORTED', 'CACHE_GUARD_STALE', 'CACHE_GUARD_INVALID_INPUT',
             'CACHE_GUARD_WRITE_FAILED', 'CACHE_PROTECTED_CAPACITY_EXCEEDED'
           ]
             .includes(values.terminalCode)) ||
          (values.applied && (values.revision !== expectedRevision || values.currentValue !== null)) ||
          (!values.applied && values.currentValue !== null &&
           typeof values.currentValue !== 'object')) {
        throw mechanismError(failureCode);
      }
      return Object.freeze(values);
    }

    async function readRunIndex(identity, runIndexKey) {
      if (typeof cacheStore.getMany !== 'function') {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      let found;
      try { found = await cacheStore.getMany([runIndexKey]); } catch {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      if (!(found instanceof Map)) throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      const record = found.get(runIndexKey);
      return record
        ? validateRunIndexRecord(
          identity.operationId, runIndexKey, record, 'MECHANISM_RUN_STATE_READ_FAILED'
        )
        : null;
    }

    function assertDurableIndexActive(context, index) {
      if (!sameIdentity(index.identity, context.identity) ||
          index.latestEpoch !== context.capture.epoch ||
          index.latestRunStateKey !== context.runStateKey) {
        throw mechanismError('MECHANISM_OPERATION_STALE');
      }
      if (index.terminal === 'cancelled') {
        throw mechanismError('MECHANISM_OPERATION_CANCELLED');
      }
      if (index.terminal !== 'active' ||
          index.cancelGeneration !== context.capture.cancelGeneration) {
        throw mechanismError('MECHANISM_OPERATION_STALE');
      }
      return index;
    }

    async function readLatestRun(context, failureCode = 'MECHANISM_RUN_STATE_READ_FAILED') {
      let found;
      try { found = await cacheStore.getMany([context.runIndexKey, context.runStateKey]); } catch {
        throw mechanismError(failureCode);
      }
      if (!(found instanceof Map)) throw mechanismError(failureCode);
      const indexRecord = found.get(context.runIndexKey);
      const runRecord = found.get(context.runStateKey);
      if (!indexRecord) throw mechanismError(failureCode);
      const index = validateRunIndexRecord(
        context.identity.operationId, context.runIndexKey, indexRecord, failureCode
      );
      assertDurableIndexActive(context, index);
      if (!runRecord) throw mechanismError(failureCode);
      const state = validateRunStateRecord(context, runRecord);
      if (state.revision !== index.latestRunRevision) throw mechanismError(failureCode);
      context.runIndex = index;
      context.runState = state;
      context.startedAt = state.startedAt;
      context.deadlineAt = state.deadlineAt;
      return state;
    }

    async function readLatestTerminalRun(context, expectedIndex) {
      let found;
      try { found = await cacheStore.getMany([context.runIndexKey, context.runStateKey]); } catch {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      if (!(found instanceof Map)) throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      const index = validateRunIndexRecord(
        context.identity.operationId, context.runIndexKey,
        found.get(context.runIndexKey), 'MECHANISM_RUN_STATE_READ_FAILED'
      );
      if (!sameIdentity(index.identity, context.identity) ||
          index.latestEpoch !== context.capture.epoch ||
          index.latestRunStateKey !== context.runStateKey ||
          index.terminal !== expectedIndex.terminal ||
          !['complete', 'needs_review'].includes(index.terminal)) {
        throw mechanismError('MECHANISM_OPERATION_STALE');
      }
      const state = validateRunStateRecord(context, found.get(context.runStateKey));
      if (state.revision !== index.latestRunRevision ||
          state.checkpointSequence !== READY_CHECKPOINT_SEQUENCE) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      context.runIndex = index;
      context.runState = state;
      context.startedAt = state.startedAt;
      context.deadlineAt = state.deadlineAt;
      context.finalizedStatus = index.terminal;
      return state;
    }

    async function casRecords(context, state, additionalValues, failureCode) {
      if (typeof cacheStore.compareAndSetManyGuarded !== 'function') {
        throw mechanismError(failureCode);
      }
      const expectedIndexRevision = context.runIndex.revision;
      const nextIndex = buildRunIndex(context, {
        revision: expectedIndexRevision + 1,
        latestRunRevision: state.revision,
        protectedBytesReserved: state.providerRequestsClaimed > 0
          ? MECHANISM_PROTECTED_BYTES_RESERVATION
          : context.runIndex.protectedBytesReserved
      });
      const values = [
        runIndexRecord(context, nextIndex), runStateRecord(context, state), ...additionalValues
      ];
      let result;
      try {
        result = await cacheStore.compareAndSetManyGuarded(values, {
          signal: context.registryOperation.controller.signal,
          assertActive: () => assertContextActive(context),
          casKey: context.runIndexKey,
          expectedRevision: expectedIndexRevision
        });
      } catch (error) {
        assertContextActive(context);
        if (ownData(error, 'code') === 'CACHE_PROTECTED_CAPACITY_EXCEEDED') {
          throw mechanismError('MECHANISM_OPERATION_CAPACITY_EXCEEDED');
        }
        throw mechanismError(failureCode);
      }
      const receipt = parseCasReceipt(result, nextIndex.revision, failureCode);
      if (receipt.applied) {
        context.runIndex = nextIndex;
        context.runState = state;
        context.startedAt = state.startedAt;
        context.deadlineAt = state.deadlineAt;
        return Object.freeze({ applied: true, terminalCode: receipt.terminalCode });
      }
      try {
        const currentIndex = validateRunIndexRecord(
          context.identity.operationId, context.runIndexKey, receipt.currentValue, failureCode
        );
        assertDurableIndexActive(context, currentIndex);
        context.runIndex = currentIndex;
        await readLatestRun(context, failureCode);
      } catch (error) {
        if (['MECHANISM_OPERATION_STALE', 'MECHANISM_OPERATION_CANCELLED']
          .includes(ownData(error, 'code'))) throw error;
        const currentIndex = receipt.currentValue && ownData(receipt.currentValue, 'runIndex');
        if (currentIndex &&
            (ownData(currentIndex, 'terminal') === 'cancelled')) {
          throw mechanismError('MECHANISM_OPERATION_CANCELLED');
        }
        if (currentIndex &&
            (ownData(currentIndex, 'latestEpoch') !== context.capture.epoch ||
             !sameIdentity(ownData(currentIndex, 'identity'), context.identity))) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        throw mechanismError(failureCode);
      }
      return Object.freeze({ applied: false, terminalCode: receipt.terminalCode });
    }

    function evictContextsForReplacement(operationId) {
      for (const [key, context] of contexts) {
        if (context.capture.operationId === operationId) contexts.delete(key);
      }
    }

    async function retireOldestContextForCapacity() {
      while (contexts.size + pendingContextSlots >= MAX_ACTIVE_MECHANISM_CONTEXTS) {
        let reaped = false;
        for (const [candidateKey, candidate] of contexts) {
          if (replacementReservationCounts.has(candidate.capture.operationId)) continue;
          let latest;
          try {
            latest = await readRunIndex(candidate.identity, candidate.runIndexKey);
          } catch {
            // Missing or unreadable authority is unknown, not permission to
            // retire a possibly claimed provider receipt.
            continue;
          }
          const stillAuthoritative = latest?.terminal === 'active' &&
            sameIdentity(latest.identity, candidate.identity) &&
            latest.latestEpoch === candidate.capture.epoch &&
            latest.latestRunStateKey === candidate.runStateKey;
          if (stillAuthoritative) continue;
          try {
            if (typeof registry.retire === 'function') registry.retire(candidate.registryOperation);
            else candidate.registryOperation.controller.abort();
          } catch { candidate.registryOperation.controller.abort(); }
          contexts.delete(candidateKey);
          reaped = true;
          break;
        }
        if (!reaped) throw mechanismError('MECHANISM_OPERATION_CAPACITY_EXCEEDED');
      }
    }

    function enqueueContextCapacity(task) {
      const operation = contextCapacityTail.then(task);
      contextCapacityTail = operation.catch(() => {});
      return operation;
    }

    function lockReplacementReservation(reservation) {
      if (!reservation.replacementKey || reservation.replacementLocked) return;
      replacementReservationCounts.set(
        reservation.operationId,
        (replacementReservationCounts.get(reservation.operationId) || 0) + 1
      );
      reservation.replacementLocked = true;
    }

    function unlockReplacementReservation(reservation) {
      if (!reservation?.replacementLocked || !reservation.replacementKey) return;
      const count = replacementReservationCounts.get(reservation.operationId) || 0;
      if (count <= 1) replacementReservationCounts.delete(reservation.operationId);
      else replacementReservationCounts.set(reservation.operationId, count - 1);
      reservation.replacementLocked = false;
    }

    function reserveContextCapacity(operationId) {
      return enqueueContextCapacity(async () => {
        let replacementKey = null;
        for (const [key, context] of contexts) {
          if (context.capture.operationId === operationId) {
            replacementKey = key;
            break;
          }
        }
        const replacesLocalContext = replacementKey !== null;
        if (!replacesLocalContext) {
          await retireOldestContextForCapacity();
          pendingContextSlots += 1;
        }
        const reservation = {
          operationId,
          consumesSlot: !replacesLocalContext,
          replacementKey,
          replacementLocked: false,
          active: true
        };
        if (replacesLocalContext) lockReplacementReservation(reservation);
        return reservation;
      });
    }

    function abandonContextCapacity(reservation) {
      if (!reservation?.active) return Promise.resolve();
      return enqueueContextCapacity(() => {
        if (!reservation.active) return;
        reservation.active = false;
        if (reservation.consumesSlot) pendingContextSlots -= 1;
        unlockReplacementReservation(reservation);
        if (reservation.replacementKey &&
            !replacementReservationCounts.has(reservation.operationId)) {
          const replaced = contexts.get(reservation.replacementKey);
          if (replaced?.runIndex?.terminal === 'released') {
            contexts.delete(reservation.replacementKey);
          }
        }
      });
    }

    function createRuntimeContext(identity, epoch, cancelGeneration) {
      let operation = registry.begin({
        operationId: identity.operationId, epoch, cancelGeneration
      }, registryRestoreAuthority);
      if (!operation) operation = registry.begin(identity.operationId);
      if (!operation) throw mechanismError('MECHANISM_OPERATION_INVALID');
      const capture = registry.capture(operation);
      const binding = deepFreeze({ ...identity, operationEpoch: capture.epoch });
      return {
        registryOperation: operation,
        capture,
        identity,
        binding,
        startedAt: now(),
        deadlineAt: now() + OPERATION_DEADLINE_MS,
        runIndexKey: runIndexKeyForOperationId(identity.operationId),
        runStateKey: runStateKeyForBinding(binding),
        checkpointKey: checkpointKeyForBinding(binding),
        runIndex: null,
        runState: null,
        localCancelGeneration: capture.cancelGeneration,
        mutationTail: Promise.resolve(),
        pendingTerminal: null,
        finalizedStatus: '',
        recoverableBegin: false,
        handle: null
      };
    }

    function finalizeContext(context, reservation) {
      return enqueueContextCapacity(() => {
        context.handle = Object.freeze({
          operationId: context.capture.operationId,
          epoch: context.capture.epoch,
          cancelGeneration: context.capture.cancelGeneration,
          startedAt: context.startedAt,
          deadlineAt: context.deadlineAt,
          maxProviderRequests: MAX_PROVIDER_REQUESTS_PER_RUN,
          binding: context.binding,
          signal: context.registryOperation.controller.signal
        });
        evictContextsForReplacement(context.capture.operationId);
        contexts.set(contextKey(context.capture.operationId, context.capture.epoch), context);
        if (reservation?.active) {
          reservation.active = false;
          if (reservation.consumesSlot) pendingContextSlots -= 1;
          unlockReplacementReservation(reservation);
        }
        return context.handle;
      });
    }

    function removeContextAfterTerminal(context) {
      return enqueueContextCapacity(() => {
        const key = contextKey(context.capture.operationId, context.capture.epoch);
        if (!replacementReservationCounts.has(context.capture.operationId)) {
          contexts.delete(key);
          if (context.handle && typeof context.handle === 'object') {
            terminalHandles.set(context.handle, context);
          }
        }
      });
    }

    async function installLatestRun(context, currentIndex, state) {
      const nextIndex = buildRunIndex(context, {
        revision: currentIndex ? currentIndex.revision + 1 : 0,
        latestRunRevision: state.revision
      });
      let raw;
      try {
        raw = await cacheStore.compareAndSetManyGuarded([
          runIndexRecord(context, nextIndex), runStateRecord(context, state)
        ], {
          signal: context.registryOperation.controller.signal,
          assertActive: () => assertContextActive(context),
          casKey: context.runIndexKey,
          expectedRevision: currentIndex ? currentIndex.revision : null
        });
      } catch (error) {
        assertContextActive(context);
        if (ownData(error, 'code') === 'CACHE_PROTECTED_CAPACITY_EXCEEDED') {
          throw mechanismError('MECHANISM_OPERATION_CAPACITY_EXCEEDED');
        }
        throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
      }
      const receipt = parseCasReceipt(
        raw, nextIndex.revision, 'MECHANISM_RUN_STATE_WRITE_FAILED'
      );
      if (receipt.applied) {
        context.runIndex = nextIndex;
        context.runState = state;
        context.startedAt = state.startedAt;
        context.deadlineAt = state.deadlineAt;
        try { assertContextActive(context); } catch (error) {
          throw mechanismError(ownData(error, 'code'), { committed: true });
        }
        if (receipt.terminalCode) {
          throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED', { committed: true });
        }
        return null;
      }
      return validateRunIndexRecord(
        context.identity.operationId, context.runIndexKey, receipt.currentValue,
        'MECHANISM_RUN_STATE_WRITE_FAILED'
      );
    }

    function normalizeEvidenceIdentityInput(input) {
      const requestedId = boundedString(ownData(input, 'operationId'), { maxLength: 256 });
      const documentId = boundedString(ownData(input, 'documentId'));
      const documentHash = boundedString(ownData(input, 'documentHash'), { maxLength: 256 });
      const workspaceId = boundedString(ownData(input, 'workspaceId'));
      const profileSignature = boundedString(ownData(input, 'profileSignature'), {
        allowEmpty: true, maxLength: 512
      });
      const baseWorkspaceRevision = ownData(input, 'baseWorkspaceRevision');
      const workspaceGeneration = ownData(input, 'workspaceGeneration');
      const workspaceLifecycle = ownData(input, 'workspaceLifecycle');
      const mechanismChainFingerprint = boundedString(
        ownData(input, 'mechanismChainFingerprint'), { maxLength: 256 }
      );
      const senderExtensionId = boundedString(
        ownData(input, 'senderExtensionId'), { maxLength: 256 }
      );
      const senderDocumentId = boundedString(
        ownData(input, 'senderDocumentId'), { maxLength: 256 }
      );
      const senderTabId = ownData(input, 'senderTabId');
      const senderFrameId = ownData(input, 'senderFrameId');
      if (!Number.isSafeInteger(baseWorkspaceRevision) || baseWorkspaceRevision < 0 ||
          !Number.isSafeInteger(workspaceGeneration) || workspaceGeneration < 1 ||
          !Number.isSafeInteger(workspaceLifecycle) || workspaceLifecycle < 0 ||
          !Number.isSafeInteger(senderTabId) || senderTabId < -1 ||
          !Number.isSafeInteger(senderFrameId) || senderFrameId < -1) {
        throw mechanismError('MECHANISM_OPERATION_INVALID');
      }
      const normalizedOperationId = shared.normalizeOperationId?.(requestedId);
      if (typeof normalizedOperationId !== 'string' || !normalizedOperationId) {
        throw mechanismError('MECHANISM_OPERATION_INVALID');
      }
      const suppliedVersions = ownData(input, 'versions');
      const versions = suppliedVersions === undefined
        ? MECHANISM_BINDING_VERSIONS
        : exactOwnValues(suppliedVersions, VERSION_KEYS);
      if (!versions || VERSION_KEYS.some(key =>
        typeof versions[key] !== 'string' || !versions[key] || versions[key].length > 128)) {
        throw mechanismError('MECHANISM_OPERATION_INVALID');
      }
      return deepFreeze({
        ...versions,
        browserSessionId,
        documentId,
        documentHash,
        workspaceId,
        workspaceGeneration,
        workspaceLifecycle,
        mechanismChainFingerprint,
        profileSignature,
        senderExtensionId,
        senderTabId,
        senderFrameId,
        senderDocumentId,
        operationId: normalizedOperationId,
        baseWorkspaceRevision
      });
    }

    function normalizeOwnerIdentityInput(input) {
      const operationId = shared.normalizeOperationId?.(
        boundedString(ownData(input, 'operationId'), { maxLength: 256 })
      );
      const documentId = boundedString(ownData(input, 'documentId'));
      const workspaceId = boundedString(ownData(input, 'workspaceId'));
      const mechanismChainFingerprint = boundedString(
        ownData(input, 'mechanismChainFingerprint'), { maxLength: 256 }
      );
      const senderExtensionId = boundedString(
        ownData(input, 'senderExtensionId'), { maxLength: 256 }
      );
      const senderDocumentId = boundedString(
        ownData(input, 'senderDocumentId'), { maxLength: 256 }
      );
      const workspaceGeneration = ownData(input, 'workspaceGeneration');
      const workspaceLifecycle = ownData(input, 'workspaceLifecycle');
      const senderTabId = ownData(input, 'senderTabId');
      const senderFrameId = ownData(input, 'senderFrameId');
      if (!operationId || !Number.isSafeInteger(workspaceGeneration) ||
          workspaceGeneration < 1 || !Number.isSafeInteger(workspaceLifecycle) ||
          workspaceLifecycle < 0 || !Number.isSafeInteger(senderTabId) ||
          senderTabId < -1 || !Number.isSafeInteger(senderFrameId) || senderFrameId < -1) {
        throw mechanismError('MECHANISM_OPERATION_INVALID');
      }
      return Object.freeze({
        operationId, browserSessionId, documentId, workspaceId, workspaceGeneration,
        workspaceLifecycle, mechanismChainFingerprint, senderExtensionId,
        senderTabId, senderFrameId, senderDocumentId
      });
    }

    function normalizeTrustedDocumentInput(input, requireDocument = true) {
      const senderExtensionId = boundedString(
        ownData(input, 'senderExtensionId'), { maxLength: 256 }
      );
      const senderTabId = ownData(input, 'senderTabId');
      const senderFrameId = ownData(input, 'senderFrameId');
      const senderDocumentId = requireDocument
        ? boundedString(ownData(input, 'senderDocumentId'), { maxLength: 256 })
        : '';
      if (!Number.isSafeInteger(senderTabId) || senderTabId < 0 ||
          (senderFrameId !== undefined &&
           (!Number.isSafeInteger(senderFrameId) || senderFrameId < 0))) {
        throw mechanismError('MECHANISM_OPERATION_INVALID');
      }
      return Object.freeze({
        senderExtensionId, senderTabId,
        senderFrameId: senderFrameId === undefined ? -1 : senderFrameId,
        senderDocumentId
      });
    }

    async function readOwnerAuthority(identity) {
      const tabKey = tabAuthorityKeyFor(identity);
      const frameKey = frameAuthorityKeyFor(identity);
      let found;
      try { found = await cacheStore.getMany([tabKey, frameKey]); } catch {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      if (!(found instanceof Map)) throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      const tabRecord = found.get(tabKey);
      const frameRecord = found.get(frameKey);
      return {
        tabKey,
        frameKey,
        tab: tabRecord ? validateTabAuthorityRecord(tabKey, tabRecord) : null,
        frame: frameRecord ? validateFrameAuthorityRecord(frameKey, frameRecord) : null
      };
    }

    function validateProtectedBinding(candidate) {
      const values = exactOwnValues(candidate, BINDING_KEYS);
      if (!values || !Number.isSafeInteger(values.operationEpoch) ||
          values.operationEpoch < 1) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      const identity = Object.fromEntries(RUN_IDENTITY_KEYS.map(
        key => [key, values[key]]
      ));
      validateRunIdentity(
        identity, values.operationId, 'MECHANISM_RUN_STATE_READ_FAILED'
      );
      return candidate;
    }

    function protectedRunStateBinding(key, record) {
      if (!exactRecordEnvelope(record, ['key', 'createdAt', 'revision', 'runState']) ||
          ownData(record, 'key') !== key) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      const state = ownData(record, 'runState');
      if (!exactOwnKeys(state, RUN_STATE_KEYS) ||
          ownData(state, 'schemaVersion') !== MECHANISM_RUN_STATE_SCHEMA_VERSION) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      const binding = validateProtectedBinding(ownData(state, 'binding'));
      if (key !== runStateKeyForBinding(binding)) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      return binding;
    }

    function protectedCheckpointBinding(key, record) {
      if (!exactRecordEnvelope(record, [
        'key', 'createdAt', 'sequence', 'binding', 'checkpoint'
      ]) || ownData(record, 'key') !== key) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      const binding = validateProtectedBinding(ownData(record, 'binding'));
      const checkpoint = ownData(record, 'checkpoint');
      if (!exactOwnKeys(checkpoint, CHECKPOINT_KEYS) ||
          ownData(checkpoint, 'schemaVersion') !== MECHANISM_CHECKPOINT_SCHEMA_VERSION ||
          !sameBinding(ownData(checkpoint, 'binding'), binding) ||
          key !== checkpointKeyForBinding(binding)) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      return binding;
    }

    function sameTabAuthorityScope(candidate, scope) {
      return ownData(candidate, 'senderExtensionId') === scope.senderExtensionId &&
        ownData(candidate, 'senderTabId') === scope.senderTabId;
    }

    async function assertUnknownTabHasNoProtectedAuthority(scope) {
      if ([...contexts.values()].some(context =>
        sameTabAuthorityScope(context.identity, scope))) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      if (typeof cacheStore.listProtectedByPrefix !== 'function') {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      let protectedRecords;
      try {
        protectedRecords = await Promise.all([
          protectedPrefix('owner-current'),
          protectedPrefix('run-index'),
          protectedPrefix('run-state'),
          protectedPrefix('checkpoint')
        ].map(prefix => cacheStore.listProtectedByPrefix(prefix)));
      } catch {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      if (protectedRecords.some(records => !(records instanceof Map))) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      const [frames, indexes, states, checkpoints] = protectedRecords;
      for (const [key, record] of frames) {
        const authority = validateFrameAuthorityRecord(key, record);
        if (sameTabAuthorityScope(authority, scope)) {
          throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
        }
      }
      for (const [key, record] of indexes) {
        const rawIndex = ownData(record, 'runIndex');
        const rawIdentity = ownData(rawIndex, 'identity');
        const operationId = ownData(rawIdentity, 'operationId');
        if (typeof operationId !== 'string' || !operationId) {
          throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
        }
        const index = validateRunIndexRecord(
          operationId, key, record, 'MECHANISM_RUN_STATE_READ_FAILED'
        );
        if (sameTabAuthorityScope(index.identity, scope)) {
          throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
        }
      }
      for (const [key, record] of states) {
        const binding = protectedRunStateBinding(key, record);
        if (sameTabAuthorityScope(binding, scope)) {
          throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
        }
      }
      for (const [key, record] of checkpoints) {
        const binding = protectedCheckpointBinding(key, record);
        if (sameTabAuthorityScope(binding, scope)) {
          throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
        }
      }
    }

    async function compareAndSetAuthority(key, expectedRevision, record) {
      let raw;
      try {
        raw = await cacheStore.compareAndSetManyGuarded([record], {
          assertActive() {}, casKey: key, expectedRevision
        });
      } catch {
        throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
      }
      return parseCasReceipt(raw, record.revision, 'MECHANISM_RUN_STATE_WRITE_FAILED');
    }

    async function ensureOwnerAuthority(identity, { allowCreate = false } = {}) {
      if (!enforceOwnerAuthority) return null;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const current = await readOwnerAuthority(identity);
        let tab = current.tab;
        if (!tab) {
          if (!allowCreate) throw mechanismError('MECHANISM_OPERATION_STALE');
          const value = {
            schemaVersion: MECHANISM_OWNER_AUTHORITY_SCHEMA_VERSION,
            senderExtensionId: identity.senderExtensionId,
            senderTabId: identity.senderTabId,
            navigationGeneration: 1,
            retired: false
          };
          const receipt = await compareAndSetAuthority(
            current.tabKey, null,
            authorityRecord(current.tabKey, 0, now(), 'tabAuthority', value)
          );
          if (!receipt.applied) continue;
          tab = { ...value, revision: 0 };
        }
        if (tab.senderExtensionId !== identity.senderExtensionId ||
            tab.senderTabId !== identity.senderTabId || tab.retired) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        let frame = current.frame;
        if (!frame) {
          if (!allowCreate) throw mechanismError('MECHANISM_OPERATION_STALE');
          const value = {
            schemaVersion: MECHANISM_OWNER_AUTHORITY_SCHEMA_VERSION,
            senderExtensionId: identity.senderExtensionId,
            senderTabId: identity.senderTabId,
            senderFrameId: identity.senderFrameId,
            senderDocumentId: identity.senderDocumentId,
            navigationGeneration: tab.navigationGeneration,
            workspaceLifecycle: identity.workspaceLifecycle
          };
          const receipt = await compareAndSetAuthority(
            current.frameKey, null,
            authorityRecord(current.frameKey, 0, now(), 'frameAuthority', value)
          );
          if (!receipt.applied) continue;
          frame = { ...value, revision: 0 };
        }
        if (frame.senderExtensionId !== identity.senderExtensionId ||
            frame.senderTabId !== identity.senderTabId ||
            frame.senderFrameId !== identity.senderFrameId ||
            frame.senderDocumentId !== identity.senderDocumentId ||
            frame.navigationGeneration !== tab.navigationGeneration) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        if (frame.workspaceLifecycle !== identity.workspaceLifecycle) {
          const canAdvance = allowCreate &&
            (frame.workspaceLifecycle === null ||
              identity.workspaceLifecycle === frame.workspaceLifecycle + 1);
          if (!canAdvance) throw mechanismError('MECHANISM_OPERATION_STALE');
          const value = {
            schemaVersion: MECHANISM_OWNER_AUTHORITY_SCHEMA_VERSION,
            senderExtensionId: frame.senderExtensionId,
            senderTabId: frame.senderTabId,
            senderFrameId: frame.senderFrameId,
            senderDocumentId: frame.senderDocumentId,
            navigationGeneration: frame.navigationGeneration,
            workspaceLifecycle: identity.workspaceLifecycle
          };
          const receipt = await compareAndSetAuthority(
            current.frameKey, frame.revision,
            authorityRecord(
              current.frameKey, frame.revision + 1, now(), 'frameAuthority', value
            )
          );
          if (!receipt.applied) continue;
          frame = { ...value, revision: receipt.revision };
        }
        return Object.freeze({ tab, frame });
      }
      throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
    }

    async function writeTabAuthority(
      scope, { retired, advance, allowCreate = false }
    ) {
      const key = tabAuthorityKeyFor(scope);
      for (let attempt = 0; attempt < 16; attempt += 1) {
        let found;
        try { found = await cacheStore.getMany([key]); } catch {
          throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
        }
        if (!(found instanceof Map)) throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
        const record = found.get(key);
        const current = record ? validateTabAuthorityRecord(key, record) : null;
        if (!current && !allowCreate) return null;
        if (current?.retired === true && retired === true) return current;
        const navigationGeneration = current
          ? current.navigationGeneration + (advance ? 1 : 0) : 1;
        if (current && current.retired === retired && !advance) return current;
        const value = {
          schemaVersion: MECHANISM_OWNER_AUTHORITY_SCHEMA_VERSION,
          senderExtensionId: scope.senderExtensionId,
          senderTabId: scope.senderTabId,
          navigationGeneration,
          retired
        };
        if (current && (current.senderExtensionId !== scope.senderExtensionId ||
            current.senderTabId !== scope.senderTabId)) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        const receipt = await compareAndSetAuthority(
          key, current?.revision ?? null,
          authorityRecord(key, (current?.revision ?? -1) + 1, now(), 'tabAuthority', value)
        );
        if (receipt.applied) return deepFreeze({ ...value, revision: receipt.revision });
      }
      throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
    }

    async function writeFrameAuthority(scope, navigationGeneration) {
      const key = frameAuthorityKeyFor(scope);
      for (let attempt = 0; attempt < 16; attempt += 1) {
        let found;
        try { found = await cacheStore.getMany([key]); } catch {
          throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
        }
        if (!(found instanceof Map)) throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
        const record = found.get(key);
        const current = record ? validateFrameAuthorityRecord(key, record) : null;
        if (current && current.senderExtensionId === scope.senderExtensionId &&
            current.senderTabId === scope.senderTabId &&
            current.senderFrameId === scope.senderFrameId &&
            current.senderDocumentId === scope.senderDocumentId &&
            current.navigationGeneration === navigationGeneration) return current;
        if (current && (current.senderExtensionId !== scope.senderExtensionId ||
            current.senderTabId !== scope.senderTabId ||
            current.senderFrameId !== scope.senderFrameId)) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        const value = {
          schemaVersion: MECHANISM_OWNER_AUTHORITY_SCHEMA_VERSION,
          senderExtensionId: scope.senderExtensionId,
          senderTabId: scope.senderTabId,
          senderFrameId: scope.senderFrameId,
          senderDocumentId: scope.senderDocumentId,
          navigationGeneration,
          workspaceLifecycle: null
        };
        const receipt = await compareAndSetAuthority(
          key, current?.revision ?? null,
          authorityRecord(key, (current?.revision ?? -1) + 1, now(), 'frameAuthority', value)
        );
        if (receipt.applied) return deepFreeze({ ...value, revision: receipt.revision });
      }
      throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
    }

    async function ownerIdentityIsCurrent(identity) {
      try {
        await ensureOwnerAuthority(identity);
        return true;
      } catch (error) {
        if (ownData(error, 'code') === 'MECHANISM_OPERATION_STALE') return false;
        throw error;
      }
    }

    async function retireDurableRunIndex(key, initialIndex) {
      let index = initialIndex;
      for (let attempt = 0; attempt < 16 && index.terminal !== 'released'; attempt += 1) {
        const next = deepFreeze({
          ...index,
          revision: index.revision + 1,
          terminal: 'released',
          cancelGeneration: index.cancelGeneration + 1,
          protectedBytesReserved: 0
        });
        let raw;
        try {
          if (typeof cacheStore.compareAndSetManyAndDeleteGuarded !== 'function') {
            throw new Error('atomic compact unavailable');
          }
          const binding = deepFreeze({ ...index.identity, operationEpoch: index.latestEpoch });
          raw = await cacheStore.compareAndSetManyAndDeleteGuarded([{
            key,
            createdAt: now(),
            revision: next.revision,
            runIndex: next
          }], [
            index.latestRunStateKey, checkpointKeyForBinding(binding)
          ], {
            assertActive() {}, casKey: key, expectedRevision: index.revision
          });
        } catch {
          throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
        }
        const receipt = parseCasReceipt(
          raw, next.revision, 'MECHANISM_RUN_STATE_WRITE_FAILED'
        );
        if (receipt.applied) {
          index = next;
          break;
        }
        index = validateRunIndexRecord(
          index.identity.operationId, key, receipt.currentValue,
          'MECHANISM_RUN_STATE_WRITE_FAILED'
        );
        if (!sameIdentity(index.identity, initialIndex.identity)) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
      }
      if (index.terminal !== 'released') {
        throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
      }
      for (const [contextKeyValue, context] of contexts) {
        if (context.capture.operationId !== index.identity.operationId) continue;
        try {
          if (typeof registry.retire === 'function') registry.retire(context.registryOperation);
          else context.registryOperation.controller.abort();
        } catch { context.registryOperation.controller.abort(); }
        contexts.delete(contextKeyValue);
      }
      if (typeof cacheStore.deleteMany !== 'function') {
        throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
      }
      try {
        // The released run index is a compact crash-repair marker. It is
        // deleted only after the exact owner authority has already advanced;
        // a lost acknowledgement leaves a valid zero-reservation marker that
        // the next trusted cleanup can safely finish.
        await cacheStore.deleteMany([key]);
      } catch {
        throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
      }
    }

    async function cleanupStaleOwnerOperations(scope, { frameOnly = false } = {}) {
      if (!enforceOwnerAuthority) return Object.freeze({ cleaned: 0 });
      if (typeof cacheStore.listProtectedByPrefix !== 'function') {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      let records;
      try {
        records = await cacheStore.listProtectedByPrefix(protectedPrefix('run-index'));
      } catch {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      if (!(records instanceof Map)) throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      let cleaned = 0;
      for (const [key, record] of records) {
        const rawIndex = ownData(record, 'runIndex');
        const rawIdentity = ownData(rawIndex, 'identity');
        const operationId = ownData(rawIdentity, 'operationId');
        if (typeof operationId !== 'string' || !operationId) {
          throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
        }
        const index = validateRunIndexRecord(
          operationId, key, record, 'MECHANISM_RUN_STATE_READ_FAILED'
        );
        if (index.identity.senderExtensionId !== scope.senderExtensionId ||
            index.identity.senderTabId !== scope.senderTabId ||
            (frameOnly && index.identity.senderFrameId !== scope.senderFrameId)) continue;
        if (await ownerIdentityIsCurrent(index.identity)) continue;
        await retireDurableRunIndex(key, index);
        cleaned += 1;
      }
      return Object.freeze({ cleaned });
    }

    async function cleanupRetiredOwnerOperations() {
      if (!enforceOwnerAuthority) return;
      if (typeof cacheStore.listProtectedByPrefix !== 'function') {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      let records;
      try {
        records = await cacheStore.listProtectedByPrefix(protectedPrefix('owner-tab'));
      } catch {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      if (!(records instanceof Map)) throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      for (const [key, record] of records) {
        const authority = validateTabAuthorityRecord(key, record);
        if (!authority.retired) continue;
        await cleanupStaleOwnerOperations({
          senderExtensionId: authority.senderExtensionId,
          senderTabId: authority.senderTabId,
          senderFrameId: -1,
          senderDocumentId: ''
        });
      }
    }

    async function commitTrustedDocument(input) {
      if (!enforceOwnerAuthority) return Object.freeze({ cleaned: 0 });
      await ensureBrowserSessionIdentity();
      const scope = normalizeTrustedDocumentInput(input, true);
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const before = await readOwnerAuthority(scope);
        if (!before.tab) {
          if (before.frame) throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
          await assertUnknownTabHasNoProtectedAuthority(scope);
          return Object.freeze({ cleaned: 0 });
        }
        const sameDocument = before.tab && !before.tab.retired && before.frame &&
          before.frame.senderDocumentId === scope.senderDocumentId &&
          before.frame.navigationGeneration === before.tab.navigationGeneration;
        if (sameDocument) break;
        if (before.tab?.retired) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        const navigationGeneration = before.tab
          ? before.tab.navigationGeneration + (scope.senderFrameId === 0 ? 1 : 0)
          : 1;
        if (!Number.isSafeInteger(navigationGeneration)) {
          throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
        }
        const tabRevision = (before.tab?.revision ?? -1) + 1;
        const frameRevision = (before.frame?.revision ?? -1) + 1;
        const tabValue = {
          schemaVersion: MECHANISM_OWNER_AUTHORITY_SCHEMA_VERSION,
          senderExtensionId: scope.senderExtensionId,
          senderTabId: scope.senderTabId,
          navigationGeneration,
          retired: false
        };
        const frameValue = {
          schemaVersion: MECHANISM_OWNER_AUTHORITY_SCHEMA_VERSION,
          senderExtensionId: scope.senderExtensionId,
          senderTabId: scope.senderTabId,
          senderFrameId: scope.senderFrameId,
          senderDocumentId: scope.senderDocumentId,
          navigationGeneration,
          workspaceLifecycle: null
        };
        let raw;
        try {
          raw = await cacheStore.compareAndSetManyGuarded([
            authorityRecord(
              before.tabKey, tabRevision, now(), 'tabAuthority', tabValue
            ),
            authorityRecord(
              before.frameKey, frameRevision, now(), 'frameAuthority', frameValue
            )
          ], {
            assertActive() {}, casKey: before.tabKey,
            expectedRevision: before.tab?.revision ?? null
          });
        } catch {
          throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
        }
        const receipt = parseCasReceipt(
          raw, tabRevision, 'MECHANISM_RUN_STATE_WRITE_FAILED'
        );
        if (receipt.applied) break;
        if (attempt === 15) throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
      }
      return cleanupStaleOwnerOperations(scope, {
        frameOnly: scope.senderFrameId !== 0
      });
    }

    async function retireTrustedTab(input) {
      if (!enforceOwnerAuthority) return Object.freeze({ cleaned: 0 });
      await ensureBrowserSessionIdentity();
      const scope = normalizeTrustedDocumentInput(input, false);
      const retiredAuthority = await writeTabAuthority(scope, {
        retired: true, advance: true, allowCreate: false
      });
      if (!retiredAuthority) {
        await assertUnknownTabHasNoProtectedAuthority(scope);
        return Object.freeze({ cleaned: 0 });
      }
      const result = await cleanupStaleOwnerOperations(scope);
      if (typeof cacheStore.listProtectedByPrefix !== 'function' ||
          typeof cacheStore.deleteMany !== 'function') {
        throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
      }
      let frames;
      try {
        frames = await cacheStore.listProtectedByPrefix(protectedPrefix('owner-current'));
      } catch {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      const deleteKeys = [];
      for (const [key, record] of frames) {
        const authority = validateFrameAuthorityRecord(key, record);
        if (authority.senderExtensionId === scope.senderExtensionId &&
            authority.senderTabId === scope.senderTabId) deleteKeys.push(key);
      }
      if (deleteKeys.length) {
        try { await cacheStore.deleteMany(deleteKeys); } catch {
          throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
        }
      }
      return result;
    }

    async function beginNormalizedEvidenceFirstOperation(
      identity, strictOperationIdentity = false
    ) {
      const normalizedOperationId = identity.operationId;
      const runIndexKey = runIndexKeyForOperationId(identity.operationId);
      let reservation = null;
      let context = null;
      try {
        await ensureOwnerAuthority(identity, { allowCreate: true });
        await cleanupStaleOwnerOperations(identity, { frameOnly: true });
        await cleanupRetiredOwnerOperations();
        let currentIndex = await readRunIndex(identity, runIndexKey);
        if (currentIndex && !sameIdentity(currentIndex.identity, identity)) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        if (currentIndex?.terminal === 'cancelled') {
          throw mechanismError('MECHANISM_OPERATION_CANCELLED');
        }
        if (currentIndex && !['active', 'complete', 'needs_review'].includes(
          currentIndex.terminal
        )) {
          throw mechanismError('MECHANISM_OPERATION_FINALIZED');
        }
        reservation = await reserveContextCapacity(normalizedOperationId);
        currentIndex = await readRunIndex(identity, runIndexKey);
        if (currentIndex && !sameIdentity(currentIndex.identity, identity)) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        const localContext = [...contexts.values()].find(item =>
          item.capture.operationId === normalizedOperationId);
        if (currentIndex && sameIdentity(currentIndex.identity, identity) &&
            ['complete', 'needs_review'].includes(currentIndex.terminal)) {
          if (localContext?.finalizedStatus === currentIndex.terminal &&
              localContext.capture.epoch === currentIndex.latestEpoch) {
            await abandonContextCapacity(reservation);
            return localContext.handle;
          }
          context = createRuntimeContext(
            identity, currentIndex.latestEpoch, currentIndex.cancelGeneration
          );
          context.runIndex = currentIndex;
          await readLatestTerminalRun(context, currentIndex);
          return await finalizeContext(context, reservation);
        }
        if (currentIndex?.terminal === 'cancelled') {
          throw mechanismError('MECHANISM_OPERATION_CANCELLED');
        }
        if (currentIndex && currentIndex.terminal !== 'active') {
          throw mechanismError('MECHANISM_OPERATION_FINALIZED');
        }
        if (currentIndex?.terminal === 'active' && localContext &&
            sameIdentity(localContext.identity, identity) &&
            localContext.capture.epoch === currentIndex.latestEpoch &&
            localContext.capture.cancelGeneration === currentIndex.cancelGeneration) {
          localContext.runIndex = currentIndex;
          await readLatestRun(localContext);
          await abandonContextCapacity(reservation);
          return localContext.handle;
        }
        if (currentIndex?.terminal === 'active') {
          context = createRuntimeContext(
            identity, currentIndex.latestEpoch, currentIndex.cancelGeneration
          );
          context.runIndex = currentIndex;
          await readLatestRun(context);
          return await finalizeContext(context, reservation);
        }
        if (localContext) {
          // A live in-memory token without its durable index is never authority
          // to mint a replacement epoch for the same public operation id.
          throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
        }
        if (localContext?.recoverableBegin && currentIndex?.terminal === 'active' &&
            sameIdentity(currentIndex.identity, identity) &&
            currentIndex.latestEpoch === localContext.capture.epoch &&
            currentIndex.cancelGeneration === localContext.capture.cancelGeneration) {
          localContext.runIndex = currentIndex;
          await readLatestRun(localContext);
          assertContextActive(localContext);
          localContext.recoverableBegin = false;
          await abandonContextCapacity(reservation);
          return localContext.handle;
        }
        let targetEpoch = 1;
        let targetCancelGeneration = 0;
        for (let attempt = 0; attempt < 16; attempt += 1) {
          if (currentIndex && !sameIdentity(currentIndex.identity, identity)) {
            throw mechanismError('MECHANISM_OPERATION_STALE');
          }
          if (currentIndex?.terminal === 'cancelled') {
            throw mechanismError('MECHANISM_OPERATION_CANCELLED');
          }
          if (currentIndex && currentIndex.terminal !== 'active') {
            throw mechanismError('MECHANISM_OPERATION_FINALIZED');
          }
          if (currentIndex && currentIndex.terminal === 'active' &&
              sameIdentity(currentIndex.identity, identity)) {
            if (!context || context.capture.epoch !== currentIndex.latestEpoch ||
                context.capture.cancelGeneration !== currentIndex.cancelGeneration) {
              context = createRuntimeContext(
                identity, currentIndex.latestEpoch, currentIndex.cancelGeneration
              );
            }
            if (context.capture.epoch === currentIndex.latestEpoch &&
                context.capture.cancelGeneration === currentIndex.cancelGeneration) {
              context.runIndex = currentIndex;
              await readLatestRun(context);
              assertContextActive(context);
              return await finalizeContext(context, reservation);
            }
            throw mechanismError('MECHANISM_OPERATION_STALE');
          }
          if (!context || context.capture.epoch !== targetEpoch ||
              context.capture.cancelGeneration !== targetCancelGeneration) {
            context = createRuntimeContext(identity, targetEpoch, targetCancelGeneration);
            targetEpoch = context.capture.epoch;
            targetCancelGeneration = context.capture.cancelGeneration;
          }
          const startedAt = now();
          const initial = buildRunState(context, {
            revision: 0,
            startedAt,
            deadlineAt: startedAt + OPERATION_DEADLINE_MS,
            providerRequestsClaimed: 0,
            providerReceiptsCheckpointed: [],
            providerRequestReceipts: [],
            checkpointSequence: -1,
            checkpointCommits: 0,
            completedPanelKeys: []
          });
          const conflict = await installLatestRun(context, currentIndex, initial);
          if (!conflict) return await finalizeContext(context, reservation);
          currentIndex = conflict;
        }
      } catch (error) {
        if (ownData(error, 'committed') === true && context?.runIndex?.terminal === 'active' &&
            reservation?.active) {
          context.recoverableBegin = true;
          try {
            await finalizeContext(context, reservation);
          } catch { await abandonContextCapacity(reservation); }
          throw error;
        }
        await abandonContextCapacity(reservation);
        if (context) {
          try { registry.release(context.capture); } catch { /* already invalidated */ }
        }
        throw error;
      }
      await abandonContextCapacity(reservation);
      if (context) {
        try { registry.release(context.capture); } catch { /* retry limit invalidated */ }
      }
      throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
    }

    function beginEvidenceFirstOperation(input) {
      let operationId;
      try {
        const requestedId = boundedString(ownData(input, 'operationId'), { maxLength: 256 });
        operationId = shared.normalizeOperationId?.(requestedId);
        if (typeof operationId !== 'string' || !operationId) {
          throw mechanismError('MECHANISM_OPERATION_INVALID');
        }
      } catch (error) {
        return Promise.reject(error);
      }
      const strictOperationIdentity = ownData(input, 'strictOperationIdentity') === true;
      const predecessor = beginTails.get(operationId) || Promise.resolve();
      const job = predecessor.then(async () => {
        await ensureBrowserSessionIdentity();
        const identity = normalizeEvidenceIdentityInput(input);
        return beginNormalizedEvidenceFirstOperation(identity, strictOperationIdentity);
      });
      const tail = job.catch(() => {}).finally(() => {
        if (beginTails.get(operationId) === tail) beginTails.delete(operationId);
      });
      beginTails.set(operationId, tail);
      return job;
    }

    function enqueueMutation(context, task) {
      const operation = context.mutationTail.then(task);
      context.mutationTail = operation.catch(() => {});
      return operation;
    }

    async function claimProviderRequest(handle, receiptContract = null) {
      const context = assertContextActive(resolveContext(handle));
      await ensureOwnerAuthority(context.identity);
      let normalizedReceipt = null;
      if (receiptContract !== null && receiptContract !== undefined) {
        const values = exactOwnValues(receiptContract, ['bindingDigest', 'receipt']);
        if (!values || !/^[a-f0-9]{64}$/u.test(values.receipt) ||
            !/^[a-f0-9]{64}$/u.test(values.bindingDigest)) {
          throw mechanismError('MECHANISM_OPERATION_INVALID');
        }
        normalizedReceipt = Object.freeze({
          receipt: values.receipt,
          bindingDigest: values.bindingDigest
        });
      }
      return enqueueMutation(context, async () => {
        await ensureOwnerAuthority(context.identity);
        await readLatestRun(context, 'MECHANISM_RUN_STATE_READ_FAILED');
        for (let attempt = 0; attempt < 16; attempt += 1) {
          assertContextActive(context);
          const current = context.runState;
          if (normalizedReceipt) {
            const prior = current.providerRequestReceipts.find(candidate =>
              candidate.receipt === normalizedReceipt.receipt
            );
            if (prior) {
              throw mechanismError(prior.bindingDigest === normalizedReceipt.bindingDigest
                ? 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS'
                : 'MECHANISM_PROVIDER_RECEIPT_MISMATCH');
            }
          }
          if (current.checkpointSequence >= READY_CHECKPOINT_SEQUENCE) {
            throw mechanismError('MECHANISM_OPERATION_FINALIZED');
          }
          if (current.providerRequestsClaimed >= MAX_PROVIDER_REQUESTS_PER_RUN) {
            throw mechanismError('MECHANISM_PROVIDER_REQUEST_BUDGET_EXCEEDED');
          }
          const next = buildRunState(context, {
            ...current,
            revision: current.revision + 1,
            providerRequestsClaimed: current.providerRequestsClaimed + 1,
            providerRequestReceipts: normalizedReceipt
              ? [...current.providerRequestReceipts, {
                  ...normalizedReceipt,
                  requestNumber: current.providerRequestsClaimed + 1
                }]
              : current.providerRequestReceipts
          });
          const outcome = await casRecords(
            context, next, [], 'MECHANISM_RUN_STATE_WRITE_FAILED'
          );
          if (outcome.applied) {
            try { assertContextActive(context); } catch (error) {
              throw mechanismError(ownData(error, 'code'), {
                committed: true,
                requestNumber: next.providerRequestsClaimed
              });
            }
            if (outcome.terminalCode) {
              throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED', {
                committed: true,
                requestNumber: next.providerRequestsClaimed
              });
            }
            return Object.freeze({
              operationId: context.handle.operationId,
              epoch: context.handle.epoch,
              requestNumber: next.providerRequestsClaimed,
              remainingProviderRequests: MAX_PROVIDER_REQUESTS_PER_RUN -
                next.providerRequestsClaimed,
              deadlineAt: next.deadlineAt
            });
          }
        }
        throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
      });
    }

    function validateCheckpointForContext(context, candidate, allowFinal = false) {
      const terminalReady = allowFinal &&
        ['complete', 'needs_review'].includes(context.finalizedStatus);
      if (allowFinal && !terminalReady) {
        throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
      }
      if (!allowFinal) {
        if (context.finalizedStatus) {
          throw mechanismError(context.finalizedStatus === 'cancelled'
            ? 'MECHANISM_OPERATION_CANCELLED'
            : 'MECHANISM_OPERATION_FINALIZED');
        }
        assertContextActive(context);
      }
      if (!exactOwnKeys(candidate, CHECKPOINT_KEYS) ||
          ownData(candidate, 'schemaVersion') !== MECHANISM_CHECKPOINT_SCHEMA_VERSION ||
          !sameBinding(ownData(candidate, 'binding'), context.binding)) {
        throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
      }
      const phase = ownData(candidate, 'phase');
      const nextBatchIndex = ownData(candidate, 'nextBatchIndex');
      const completedPanelKeys = ownData(candidate, 'completedPanelKeys');
      const providerReceiptIds = ownData(candidate, 'providerReceiptIds');
      if (!CHECKPOINT_PHASES.has(phase) || !Number.isSafeInteger(nextBatchIndex) ||
          nextBatchIndex < 0 || nextBatchIndex > 100_000 ||
          (phase === 'ready' && nextBatchIndex !== 0) ||
          !isArrayOwnData(completedPanelKeys) || !isArrayOwnData(providerReceiptIds)) {
        throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
      }
      const clonedPanelKeys = cloneOwnData(completedPanelKeys);
      const clonedProviderReceiptIds = cloneOwnData(providerReceiptIds);
      if (clonedPanelKeys.length > MAX_COMPLETED_PANEL_KEYS ||
          clonedPanelKeys.some(key => typeof key !== 'string' || !key || key.length > 512) ||
          new Set(clonedPanelKeys).size !== clonedPanelKeys.length) {
        throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
      }
      if (clonedProviderReceiptIds.length > MAX_PROVIDER_REQUESTS_PER_RUN ||
          clonedProviderReceiptIds.some(receipt =>
            typeof receipt !== 'string' || !/^[a-f0-9]{64}$/u.test(receipt)) ||
          new Set(clonedProviderReceiptIds).size !== clonedProviderReceiptIds.length) {
        throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
      }
      const validated = {
        schemaVersion: MECHANISM_CHECKPOINT_SCHEMA_VERSION,
        binding: context.binding,
        phase,
        nextBatchIndex,
        completedPanelKeys: clonedPanelKeys,
        providerReceiptIds: clonedProviderReceiptIds,
        payload: cloneOwnData(ownData(candidate, 'payload'))
      };
      if (terminalReady && phase !== 'ready') {
        throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
      }
      if (!allowFinal) assertContextActive(context);
      return deepFreeze(validated);
    }

    function validateCheckpoint(handle, candidate) {
      return validateCheckpointForContext(resolveContext(handle), candidate);
    }

    function checkpointKey(handle) {
      const context = resolveContext(handle);
      return context.checkpointKey;
    }

    function commitSnapshot(context) {
      return Object.freeze({
        operationId: context.handle.operationId,
        epoch: context.handle.epoch,
        providerRequestsClaimed: context.runState.providerRequestsClaimed,
        remainingProviderRequests: MAX_PROVIDER_REQUESTS_PER_RUN -
          context.runState.providerRequestsClaimed,
        checkpointCommits: context.runState.checkpointCommits
      });
    }

    function checkpointSequence(value) {
      return CHECKPOINT_PHASE_ORDER[value.phase] * 100_001 + value.nextBatchIndex;
    }

    function sameClonedData(left, right) {
      if (Object.is(left, right)) return true;
      if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
        return false;
      }
      const leftIsArray = Array.isArray(left);
      if (leftIsArray !== Array.isArray(right)) return false;
      if (leftIsArray) {
        return left.length === right.length &&
          left.every((value, index) => sameClonedData(value, right[index]));
      }
      const leftKeys = Object.keys(left);
      const rightKeys = Object.keys(right);
      return leftKeys.length === rightKeys.length && leftKeys.every(key =>
        Object.hasOwn(right, key) && sameClonedData(left[key], right[key]));
    }

    async function assertIdempotentCheckpoint(context, candidate, sequence) {
      let found;
      try {
        found = await cacheStore.getMany([
          context.runIndexKey, context.runStateKey, context.checkpointKey
        ]);
      } catch {
        assertContextActive(context);
        throw mechanismError('MECHANISM_CHECKPOINT_READ_FAILED');
      }
      assertContextActive(context);
      if (!(found instanceof Map)) throw mechanismError('MECHANISM_CHECKPOINT_READ_FAILED');
      const indexRecord = found.get(context.runIndexKey);
      const runRecord = found.get(context.runStateKey);
      const checkpointRecord = found.get(context.checkpointKey);
      if (!indexRecord || !runRecord || !checkpointRecord) {
        throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
      }
      try {
        const index = validateRunIndexRecord(
          context.identity.operationId, context.runIndexKey, indexRecord,
          'MECHANISM_CHECKPOINT_INVALID'
        );
        assertDurableIndexActive(context, index);
        const state = validateRunStateRecord(context, runRecord);
        if (state.revision !== index.latestRunRevision) {
          throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
        }
        if (!exactRecordEnvelope(checkpointRecord, [
          'key', 'createdAt', 'sequence', 'binding', 'checkpoint'
        ]) || ownData(checkpointRecord, 'key') !== context.checkpointKey ||
            !sameBinding(ownData(checkpointRecord, 'binding'), context.binding)) {
          throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
        }
        const stored = validateCheckpoint(context.handle, ownData(checkpointRecord, 'checkpoint'));
        if (state.checkpointSequence !== sequence ||
            ownData(checkpointRecord, 'sequence') !== sequence ||
            checkpointSequence(stored) !== sequence ||
            !sameClonedData(stored, candidate)) {
          throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
        }
        context.runState = state;
        context.runIndex = index;
        context.startedAt = state.startedAt;
        context.deadlineAt = state.deadlineAt;
        return commitSnapshot(context);
      } catch (error) {
        const code = ownData(error, 'code');
        if (code === 'MECHANISM_OPERATION_CANCELLED' ||
            code === 'MECHANISM_OPERATION_STALE' ||
            code === 'MECHANISM_OPERATION_DEADLINE_EXCEEDED' ||
            code === 'MECHANISM_CHECKPOINT_INVALID') throw error;
        throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
      }
    }

    async function commitCheckpoint(handle, candidate) {
      const context = resolveContext(handle);
      await ensureOwnerAuthority(context.identity);
      const validated = validateCheckpoint(handle, candidate);
      const sequence = checkpointSequence(validated);
      return enqueueMutation(context, async () => {
        await ensureOwnerAuthority(context.identity);
        await readLatestRun(context, 'MECHANISM_CHECKPOINT_WRITE_FAILED');
        for (let attempt = 0; attempt < 16; attempt += 1) {
          assertContextActive(context);
          const current = context.runState;
          if (sequence < current.checkpointSequence) {
            throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
          }
          if (sequence === current.checkpointSequence) {
            return assertIdempotentCheckpoint(context, validated, sequence);
          }
          const completed = new Set(validated.completedPanelKeys);
          if (current.completedPanelKeys.some(key => !completed.has(key))) {
            throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
          }
          const claimedReceipts = new Set(current.providerRequestReceipts.map(
            receipt => receipt.receipt
          ));
          const checkpointedReceipts = new Set(validated.providerReceiptIds);
          if (validated.providerReceiptIds.some(receipt => !claimedReceipts.has(receipt)) ||
              current.providerReceiptsCheckpointed.some(receipt =>
                !checkpointedReceipts.has(receipt))) {
            throw mechanismError('MECHANISM_CHECKPOINT_INVALID');
          }
          const next = buildRunState(context, {
            ...current,
            revision: current.revision + 1,
            checkpointSequence: sequence,
            checkpointCommits: current.checkpointCommits + 1,
            providerReceiptsCheckpointed: validated.providerReceiptIds,
            completedPanelKeys: validated.completedPanelKeys
          });
          const record = {
            key: context.checkpointKey,
            createdAt: now(),
            sequence,
            binding: context.binding,
            checkpoint: validated
          };
          const outcome = await casRecords(
            context, next, [record], 'MECHANISM_CHECKPOINT_WRITE_FAILED'
          );
          if (outcome.applied) {
            try { assertContextActive(context); } catch (error) {
              throw mechanismError(ownData(error, 'code'), { committed: true });
            }
            if (outcome.terminalCode) {
              throw mechanismError('MECHANISM_CHECKPOINT_WRITE_FAILED', { committed: true });
            }
            return commitSnapshot(context);
          }
        }
        throw mechanismError('MECHANISM_CHECKPOINT_WRITE_FAILED');
      });
    }

    async function resume(handle) {
      const context = resolveContext(handle);
      await ensureOwnerAuthority(context.identity);
      const terminalReady = ['complete', 'needs_review'].includes(context.finalizedStatus);
      if (!terminalReady) assertContextActive(context);
      await context.mutationTail;
      if (typeof cacheStore.getMany !== 'function') {
        throw mechanismError('MECHANISM_CHECKPOINT_READ_FAILED');
      }
      let found;
      try {
        found = await cacheStore.getMany([
          context.runIndexKey, context.runStateKey, context.checkpointKey
        ]);
      } catch {
        if (!terminalReady) assertContextActive(context);
        throw mechanismError('MECHANISM_CHECKPOINT_READ_FAILED');
      }
      if (!terminalReady) assertContextActive(context);
      if (!(found instanceof Map)) throw mechanismError('MECHANISM_CHECKPOINT_READ_FAILED');
      const indexRecord = found.get(context.runIndexKey);
      const runRecord = found.get(context.runStateKey);
      const checkpointRecord = found.get(context.checkpointKey);
      if (!indexRecord) {
        throw mechanismError('MECHANISM_CHECKPOINT_READ_FAILED');
      }
      let state;
      try {
        const index = validateRunIndexRecord(
          context.identity.operationId, context.runIndexKey, indexRecord,
          'MECHANISM_CHECKPOINT_READ_FAILED'
        );
        if (terminalReady) {
          if (!sameIdentity(index.identity, context.identity) ||
              index.latestEpoch !== context.capture.epoch ||
              index.latestRunStateKey !== context.runStateKey ||
              index.terminal !== context.finalizedStatus) {
            throw mechanismError('MECHANISM_OPERATION_STALE');
          }
        } else {
          assertDurableIndexActive(context, index);
        }
        if (!runRecord) throw mechanismError('MECHANISM_CHECKPOINT_READ_FAILED');
        state = validateRunStateRecord(context, runRecord);
        if (state.revision !== index.latestRunRevision) {
          throw mechanismError('MECHANISM_CHECKPOINT_READ_FAILED');
        }
        context.runIndex = index;
        context.runState = state;
        context.startedAt = state.startedAt;
        context.deadlineAt = state.deadlineAt;
        if (state.providerRequestReceipts.length !==
            state.providerReceiptsCheckpointed.length ||
            state.providerRequestReceipts.some(receipt =>
              !state.providerReceiptsCheckpointed.includes(receipt.receipt))) {
          throw mechanismError('MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS');
        }
        if (!checkpointRecord) return null;
        if (!sameBinding(ownData(checkpointRecord, 'binding'), context.binding)) return null;
        if (!exactRecordEnvelope(checkpointRecord, [
          'key', 'createdAt', 'sequence', 'binding', 'checkpoint'
        ]) || ownData(checkpointRecord, 'key') !== context.checkpointKey) {
          throw mechanismError('MECHANISM_CHECKPOINT_READ_FAILED');
        }
        const checkpointCreatedAt = ownData(checkpointRecord, 'createdAt');
        if (!Number.isSafeInteger(checkpointCreatedAt) || checkpointCreatedAt < 0) {
          throw mechanismError('MECHANISM_CHECKPOINT_READ_FAILED');
        }
        const sequence = ownData(checkpointRecord, 'sequence');
        if (!Number.isSafeInteger(sequence) || sequence !== state.checkpointSequence) {
          throw mechanismError('MECHANISM_CHECKPOINT_READ_FAILED');
        }
        const validated = validateCheckpointForContext(
          context, ownData(checkpointRecord, 'checkpoint'), terminalReady
        );
        if (checkpointSequence(validated) !== sequence) {
          throw mechanismError('MECHANISM_CHECKPOINT_READ_FAILED');
        }
        if (validated.completedPanelKeys.length !== state.completedPanelKeys.length ||
            validated.completedPanelKeys.some((key, index) =>
              key !== state.completedPanelKeys[index])) {
          throw mechanismError('MECHANISM_CHECKPOINT_READ_FAILED');
        }
        return validated;
      } catch (error) {
        const code = ownData(error, 'code');
        if (code === 'MECHANISM_OPERATION_CANCELLED' ||
            code === 'MECHANISM_OPERATION_STALE' ||
            code === 'MECHANISM_OPERATION_DEADLINE_EXCEEDED' ||
            code === 'MECHANISM_CHECKPOINT_INVALID' ||
            code === 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS' ||
            code === 'MECHANISM_PROVIDER_RECEIPT_MISMATCH') throw error;
        throw mechanismError('MECHANISM_CHECKPOINT_READ_FAILED');
      }
    }

    async function compactTerminalChildren(context, current, targetTerminal = current?.terminal) {
      if (typeof cacheStore.compareAndSetManyAndDeleteGuarded !== 'function') {
        // Compatibility for explicitly injected legacy test stores. Production
        // analysis caches provide the atomic CAS+delete primitive; retaining
        // children here is fail-safe because the terminal index still forbids
        // redispatch.
        return current;
      }
      for (let attempt = 0; attempt < 16; attempt += 1) {
        if (!current || current.terminal === 'active' ||
            !RUN_INDEX_TERMINALS.has(targetTerminal) || targetTerminal === 'active' ||
            !sameIdentity(current.identity, context.identity) ||
            (context.capture && current.latestEpoch !== context.capture.epoch) ||
            current.latestRunStateKey !== context.runStateKey) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        let children;
        try {
          children = await cacheStore.getMany([context.runStateKey, context.checkpointKey]);
        } catch {
          throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
        }
        if (!(children instanceof Map)) throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
        if (!children.has(context.runStateKey) && !children.has(context.checkpointKey) &&
            current.terminal === targetTerminal) {
          context.runIndex = current;
          return current;
        }
        const next = deepFreeze({
          ...current,
          revision: current.revision + 1,
          terminal: targetTerminal,
          protectedBytesReserved: 0,
          cancelGeneration: current.terminal === targetTerminal
            ? current.cancelGeneration
            : current.cancelGeneration + 1
        });
        const record = {
          key: context.runIndexKey, createdAt: now(), revision: next.revision,
          runIndex: next
        };
        let raw;
        try {
          raw = await cacheStore.compareAndSetManyAndDeleteGuarded(
            [record], [context.runStateKey, context.checkpointKey], {
              assertActive() {}, casKey: context.runIndexKey,
              expectedRevision: current.revision
            }
          );
        } catch {
          throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
        }
        const receipt = parseCasReceipt(
          raw, next.revision, 'MECHANISM_RUN_STATE_WRITE_FAILED'
        );
        if (receipt.applied) {
          context.runIndex = next;
          context.runState = null;
          return next;
        }
        const conflict = validateRunIndexRecord(
          context.identity.operationId, context.runIndexKey, receipt.currentValue,
          'MECHANISM_RUN_STATE_WRITE_FAILED'
        );
        if (!sameIdentity(conflict.identity, context.identity) ||
            conflict.latestEpoch !== current.latestEpoch ||
            conflict.latestRunStateKey !== context.runStateKey ||
            ![current.terminal, targetTerminal].includes(conflict.terminal)) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        current = conflict;
      }
      throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
    }

    async function persistTerminal(context, terminal, localCancelGeneration) {
      const requireActive = ['complete', 'needs_review'].includes(terminal);
      const compactChildren = ['cancelled', 'failed', 'released'].includes(terminal);
      for (let attempt = 0; attempt < 16; attempt += 1) {
        if (requireActive) assertContextActive(context);
        const current = context.runIndex;
        if (!current || !sameIdentity(current.identity, context.identity) ||
            current.latestEpoch !== context.capture.epoch ||
            current.latestRunStateKey !== context.runStateKey) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        if (current.terminal === terminal &&
            current.cancelGeneration >= localCancelGeneration) {
          return compactChildren
            ? compactTerminalChildren(context, current)
            : current;
        }
        if (current.terminal !== 'active') {
          throw mechanismError(current.terminal === 'cancelled'
            ? 'MECHANISM_OPERATION_CANCELLED'
            : 'MECHANISM_OPERATION_STALE');
        }
        const next = buildRunIndex(context, {
          revision: current.revision + 1,
          latestRunRevision: current.latestRunRevision,
          terminal,
          protectedBytesReserved: compactChildren ? 0 : current.protectedBytesReserved,
          cancelGeneration: Math.max(current.cancelGeneration + 1, localCancelGeneration)
        });
        let raw;
        try {
          const guard = {
            signal: requireActive ? context.registryOperation.controller.signal : undefined,
            assertActive: requireActive ? () => assertContextActive(context) : () => {},
            casKey: context.runIndexKey,
            expectedRevision: current.revision
          };
          raw = compactChildren &&
            typeof cacheStore.compareAndSetManyAndDeleteGuarded === 'function'
            ? await cacheStore.compareAndSetManyAndDeleteGuarded(
              [runIndexRecord(context, next)],
              [context.runStateKey, context.checkpointKey], guard
            )
            : await cacheStore.compareAndSetManyGuarded(
              [runIndexRecord(context, next)], guard
            );
        } catch {
          if (requireActive) assertContextActive(context);
          throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
        }
        const receipt = parseCasReceipt(
          raw, next.revision, 'MECHANISM_RUN_STATE_WRITE_FAILED'
        );
        if (receipt.applied) {
          context.runIndex = next;
          if (compactChildren &&
              typeof cacheStore.compareAndSetManyAndDeleteGuarded === 'function') {
            context.runState = null;
          }
          return next;
        }
        const conflict = validateRunIndexRecord(
          context.identity.operationId, context.runIndexKey, receipt.currentValue,
          'MECHANISM_RUN_STATE_WRITE_FAILED'
        );
        if (!sameIdentity(conflict.identity, context.identity) ||
            conflict.latestEpoch !== context.capture.epoch ||
            conflict.latestRunStateKey !== context.runStateKey) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        context.runIndex = conflict;
      }
      throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
    }

    function finalSnapshot(operationId, epoch, status) {
      const snapshot = {
        operationId, epoch, status, active: false, paused: false,
        cancelled: status === 'cancelled'
      };
      if (status === 'released') snapshot.released = true;
      return Object.freeze(snapshot);
    }

    function publicTerminalStatus(terminal) {
      return ['complete', 'needs_review', 'failed', 'cancelled', 'released']
        .includes(terminal) ? terminal : 'cancelled';
    }

    function abandonedSnapshot(index) {
      return Object.freeze({
        ...finalSnapshot(index.identity.operationId, index.latestEpoch, 'failed'),
        cancelGeneration: index.cancelGeneration,
        abandoned: true,
        compacted: true,
        cleanupComplete: true,
        released: false
      });
    }

    async function readAbandonChildren(runStateKey, checkpointKey) {
      let children;
      try { children = await cacheStore.getMany([runStateKey, checkpointKey]); } catch {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      if (!(children instanceof Map)) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      return children;
    }

    async function finishLocalAbandon(local, index) {
      if (!local) return;
      local.runIndex = index;
      local.runState = null;
      local.localCancelGeneration = index.cancelGeneration;
      local.pendingTerminal = null;
      local.finalizedStatus = 'failed';
      try { registry.control(local.capture, 'release'); } catch { /* durable terminal wins */ }
      await removeContextAfterTerminal(local);
    }

    async function abandonOwnedRun(owner, runIndexKey, initialIndex, local) {
      const authorityIdentity = initialIndex.identity;
      const authorityEpoch = initialIndex.latestEpoch;
      const authorityRunStateKey = initialIndex.latestRunStateKey;
      const binding = deepFreeze({
        ...authorityIdentity, operationEpoch: authorityEpoch
      });
      const checkpointKey = checkpointKeyForBinding(binding);
      let current = initialIndex;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        if (!sameOwnerIdentity(current.identity, owner) ||
            !sameIdentity(current.identity, authorityIdentity) ||
            current.latestEpoch !== authorityEpoch ||
            current.latestRunStateKey !== authorityRunStateKey) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        if (current.terminal === 'cancelled') {
          throw mechanismError('MECHANISM_OPERATION_CANCELLED');
        }
        if (current.terminal === 'released') {
          throw mechanismError('MECHANISM_OPERATION_FINALIZED');
        }
        if (!['active', 'complete', 'needs_review', 'failed'].includes(current.terminal)) {
          throw mechanismError('MECHANISM_OPERATION_FINALIZED');
        }
        const children = await readAbandonChildren(authorityRunStateKey, checkpointKey);
        if (current.terminal === 'failed' && current.protectedBytesReserved === 0 &&
            !children.has(authorityRunStateKey) && !children.has(checkpointKey)) {
          await finishLocalAbandon(local, current);
          return abandonedSnapshot(current);
        }
        const next = deepFreeze({
          ...current,
          revision: current.revision + 1,
          terminal: 'failed',
          protectedBytesReserved: 0,
          cancelGeneration: current.terminal === 'failed'
            ? current.cancelGeneration
            : current.cancelGeneration + 1
        });
        let raw;
        try {
          raw = await cacheStore.compareAndSetManyAndDeleteGuarded([{
            key: runIndexKey,
            createdAt: now(),
            revision: next.revision,
            runIndex: next
          }], [authorityRunStateKey, checkpointKey], {
            assertActive() {}, casKey: runIndexKey,
            expectedRevision: current.revision
          });
        } catch {
          throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
        }
        const receipt = parseCasReceipt(
          raw, next.revision, 'MECHANISM_RUN_STATE_WRITE_FAILED'
        );
        if (receipt.applied) {
          const remaining = await readAbandonChildren(authorityRunStateKey, checkpointKey);
          if (remaining.has(authorityRunStateKey) || remaining.has(checkpointKey)) {
            throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
          }
          await finishLocalAbandon(local, next);
          return abandonedSnapshot(next);
        }
        if (!receipt.currentValue) {
          throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
        }
        current = validateRunIndexRecord(
          owner.operationId, runIndexKey, receipt.currentValue,
          'MECHANISM_RUN_STATE_WRITE_FAILED'
        );
      }
      throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
    }

    async function releaseFinalizedContext(context) {
      return enqueueMutation(context, async () => {
        const current = await readRunIndex(context.identity, context.runIndexKey);
        if (!current || !sameIdentity(current.identity, context.identity) ||
            current.latestEpoch !== context.capture.epoch ||
            current.latestRunStateKey !== context.runStateKey) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        const target = ['complete', 'needs_review', 'released'].includes(current.terminal)
          ? 'released' : current.terminal;
        const compacted = await compactTerminalChildren(context, current, target);
        context.finalizedStatus = publicTerminalStatus(compacted.terminal);
        try { registry.control(context.capture, 'release'); } catch { /* durable terminal wins */ }
        await removeContextAfterTerminal(context);
        return Object.freeze({
          ...finalSnapshot(
            context.capture.operationId,
            context.capture.epoch,
            publicTerminalStatus(compacted.terminal)
          ),
          cancelGeneration: compacted.cancelGeneration,
          compacted: true
        });
      });
    }

    async function status(value) {
      await ensureBrowserSessionIdentity();
      const requestedId = typeof value === 'string' ? value : ownData(value, 'operationId');
      const operationId = shared.normalizeOperationId?.(requestedId);
      if (typeof operationId !== 'string' || !operationId) {
        throw mechanismError('MECHANISM_OPERATION_INVALID');
      }
      const runIndexKey = runIndexKeyForOperationId(operationId);
      let initial;
      try { initial = await cacheStore.getMany([runIndexKey]); } catch {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      if (!(initial instanceof Map)) throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      const indexRecord = initial.get(runIndexKey);
      if (!indexRecord) return null;
      const index = validateRunIndexRecord(
        operationId, runIndexKey, indexRecord, 'MECHANISM_RUN_STATE_READ_FAILED'
      );
      if (typeof value !== 'string' && !ownData(value, 'binding')) {
        const fullIdentityProbe = ownData(value, 'documentHash') !== undefined;
        const expectedIdentity = fullIdentityProbe
          ? normalizeEvidenceIdentityInput(value)
          : normalizeOwnerIdentityInput(value);
        if (!(fullIdentityProbe
          ? sameIdentity(index.identity, expectedIdentity)
          : sameOwnerIdentity(index.identity, expectedIdentity))) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        await ensureOwnerAuthority(index.identity);
      }
      if (index.terminal !== 'active') {
        return finalSnapshot(
          operationId, index.latestEpoch, publicTerminalStatus(index.terminal)
        );
      }
      const binding = deepFreeze({ ...index.identity, operationEpoch: index.latestEpoch });
      const runStateKey = runStateKeyForBinding(binding);
      const checkpointKey = checkpointKeyForBinding(binding);
      let found;
      try { found = await cacheStore.getMany([runStateKey, checkpointKey]); } catch {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      if (!(found instanceof Map)) throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      const statusContext = { binding, runStateKey };
      const state = validateRunStateRecord(statusContext, found.get(runStateKey));
      if (state.revision !== index.latestRunRevision) {
        throw mechanismError('MECHANISM_RUN_STATE_READ_FAILED');
      }
      if (state.checkpointSequence >= READY_CHECKPOINT_SEQUENCE) {
        const record = found.get(checkpointKey);
        if (!exactRecordEnvelope(record, [
          'key', 'createdAt', 'sequence', 'binding', 'checkpoint'
        ]) || ownData(record, 'key') !== checkpointKey ||
            ownData(record, 'sequence') !== READY_CHECKPOINT_SEQUENCE ||
            !sameBinding(ownData(record, 'binding'), binding)) {
          throw mechanismError('MECHANISM_CHECKPOINT_READ_FAILED');
        }
        const checkpointValue = ownData(record, 'checkpoint');
        if (!exactOwnKeys(checkpointValue, CHECKPOINT_KEYS) ||
            ownData(checkpointValue, 'schemaVersion') !==
              MECHANISM_CHECKPOINT_SCHEMA_VERSION ||
            ownData(checkpointValue, 'phase') !== 'ready' ||
            ownData(checkpointValue, 'nextBatchIndex') !== 0 ||
            !sameBinding(ownData(checkpointValue, 'binding'), binding)) {
          throw mechanismError('MECHANISM_CHECKPOINT_READ_FAILED');
        }
        // A ready checkpoint that has not yet crossed the durable terminal CAS is
        // inactive to callers, but it must never be trusted to upgrade itself to
        // complete. The router revalidates its sealed evidence payload and then
        // finalizes the exact derived status on resume.
        return finalSnapshot(operationId, index.latestEpoch, 'needs_review');
      }
      return Object.freeze({
        operationId, epoch: index.latestEpoch, status: 'active',
        active: true, paused: false, cancelled: false
      });
    }

    async function controlOwned(value, command) {
      if (![
        'pause', 'resume', 'cancel', 'release', 'status', 'compact', 'abandon'
      ].includes(command)) {
        throw mechanismError('MECHANISM_OPERATION_INVALID');
      }
      await ensureBrowserSessionIdentity();
      const owner = normalizeOwnerIdentityInput(value);
      await ensureOwnerAuthority(owner);
      if (command === 'status') return status(owner);
      if (command === 'compact' || command === 'release' || command === 'abandon') {
        if (typeof cacheStore.compareAndSetManyAndDeleteGuarded !== 'function') {
          throw mechanismError('MECHANISM_RUN_STATE_WRITE_FAILED');
        }
        const runIndexKey = runIndexKeyForOperationId(owner.operationId);
        const index = await readRunIndex(owner, runIndexKey);
        if (!index || !sameOwnerIdentity(index.identity, owner)) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        if (command === 'abandon') {
          const local = [...contexts.values()].find(candidate =>
            candidate.capture.operationId === owner.operationId &&
            candidate.capture.epoch === index.latestEpoch &&
            candidate.runStateKey === index.latestRunStateKey);
          const abandon = async () => {
            const latest = await readRunIndex(owner, runIndexKey);
            if (!latest || !sameOwnerIdentity(latest.identity, owner) ||
                !sameIdentity(latest.identity, index.identity) ||
                latest.latestEpoch !== index.latestEpoch ||
                latest.latestRunStateKey !== index.latestRunStateKey) {
              throw mechanismError('MECHANISM_OPERATION_STALE');
            }
            return abandonOwnedRun(owner, runIndexKey, latest, local);
          };
          return local ? enqueueMutation(local, abandon) : abandon();
        }
        if (index.terminal === 'active' && command === 'compact') {
          throw mechanismError('MECHANISM_OPERATION_INVALID');
        }
        if (index.terminal !== 'active') {
          const binding = deepFreeze({
            ...index.identity, operationEpoch: index.latestEpoch
          });
          const local = [...contexts.values()].find(candidate =>
            candidate.capture.operationId === owner.operationId &&
            candidate.capture.epoch === index.latestEpoch &&
            sameOwnerIdentity(candidate.identity, owner));
          const compactContext = local || {
            identity: index.identity,
            capture: { epoch: index.latestEpoch },
            runIndexKey,
            runStateKey: index.latestRunStateKey,
            checkpointKey: checkpointKeyForBinding(binding),
            runIndex: index,
            runState: null
          };
          const targetTerminal = command === 'release' &&
            ['complete', 'needs_review', 'released'].includes(index.terminal)
            ? 'released' : index.terminal;
          const compacted = await compactTerminalChildren(
            compactContext, index, targetTerminal
          );
          if (local) {
            local.finalizedStatus = publicTerminalStatus(compacted.terminal);
            try { registry.control(local.capture, 'release'); } catch { /* durable terminal wins */ }
            await removeContextAfterTerminal(local);
          }
          return Object.freeze({
            ...finalSnapshot(
              owner.operationId, compacted.latestEpoch,
              publicTerminalStatus(compacted.terminal)
            ),
            cancelGeneration: compacted.cancelGeneration,
            compacted: true
          });
        }
      }
      const local = [...contexts.values()].find(candidate =>
        candidate.capture.operationId === owner.operationId);
      if (local) {
        if (!sameOwnerIdentity(local.identity, owner)) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        return control(local.handle, command);
      }
      let reservation = null;
      let context = null;
      try {
        reservation = await reserveContextCapacity(owner.operationId);
        const runIndexKey = runIndexKeyForOperationId(owner.operationId);
        const index = await readRunIndex(owner, runIndexKey);
        if (!index || !sameOwnerIdentity(index.identity, owner)) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        if (index.terminal !== 'active') {
          await abandonContextCapacity(reservation);
          return finalSnapshot(
            owner.operationId, index.latestEpoch, publicTerminalStatus(index.terminal)
          );
        }
        context = createRuntimeContext(
          index.identity, index.latestEpoch, index.cancelGeneration
        );
        context.runIndex = index;
        await readLatestRun(context);
        const handle = await finalizeContext(context, reservation);
        reservation = null;
        return await control(handle, command);
      } catch (error) {
        if (reservation) await abandonContextCapacity(reservation);
        if (context && !context.handle) {
          try { registry.release(context.capture); } catch { /* provisional */ }
        }
        throw error;
      }
    }

    async function finalize(handle, finalStatus) {
      if (!['complete', 'needs_review', 'failed'].includes(finalStatus)) {
        throw mechanismError('MECHANISM_OPERATION_INVALID');
      }
      const context = resolveContext(handle);
      if (context.finalizedStatus) {
        if (context.finalizedStatus !== finalStatus) {
          throw mechanismError('MECHANISM_OPERATION_FINALIZED');
        }
        return finalSnapshot(context.capture.operationId, context.capture.epoch, finalStatus);
      }
      if (finalStatus === 'failed') {
        await context.mutationTail;
        await persistTerminal(context, 'failed', context.localCancelGeneration);
        await removeContextAfterTerminal(context);
      } else {
        assertContextActive(context);
        const ready = await resume(handle);
        if (!ready || ownData(ready, 'phase') !== 'ready' ||
            ownData(ownData(ready, 'payload'), 'finalStatus') !== finalStatus) {
          throw mechanismError('MECHANISM_OPERATION_FINALIZED');
        }
        assertContextActive(context);
        await persistTerminal(context, finalStatus, context.localCancelGeneration);
      }
      context.finalizedStatus = finalStatus;
      return finalSnapshot(context.capture.operationId, context.capture.epoch, finalStatus);
    }

    function claimPendingTerminalPersistence(context, pending) {
      if (pending.persisted) return Promise.resolve(pending.persistenceReceipt);
      if (pending.inflight) return pending.inflight;
      const inflight = persistTerminal(
        context, pending.terminal, pending.cancelGeneration
      ).then(receipt => {
        pending.persisted = true;
        pending.persistenceReceipt = receipt;
        pending.inflight = null;
        return receipt;
      }, error => {
        pending.inflight = null;
        throw error;
      });
      pending.inflight = inflight;
      return inflight;
    }

    function continuePendingTerminal(context, pending) {
      if (pending.completion) return pending.completion;
      const completion = claimPendingTerminalPersistence(context, pending).then(async () => {
        context.finalizedStatus = pending.terminal;
        await removeContextAfterTerminal(context);
        if (context.pendingTerminal === pending) context.pendingTerminal = null;
        return pending.snapshot;
      }, error => {
        pending.completion = null;
        throw error;
      });
      pending.completion = completion;
      return completion;
    }

    function control(value, command) {
      if (typeof value === 'string' || !['pause', 'resume', 'cancel', 'release'].includes(command)) {
        throw mechanismError('MECHANISM_OPERATION_INVALID');
      }
      const context = resolveContext(value);
      if (context.finalizedStatus) {
        if (command === 'release') return releaseFinalizedContext(context);
        throw mechanismError('MECHANISM_OPERATION_FINALIZED');
      }
      if (context.pendingTerminal) {
        if (context.pendingTerminal.command !== command) {
          throw mechanismError('MECHANISM_OPERATION_STALE');
        }
        return continuePendingTerminal(context, context.pendingTerminal);
      }
      let result;
      try { result = registry.control(context.capture, command); } catch {
        throw mechanismError('MECHANISM_OPERATION_STALE');
      }
      const snapshot = Object.freeze({
        operationId: result.operationId,
        epoch: Number(result.epoch) || 0,
        cancelGeneration: Number(result.cancelGeneration) || 0,
        active: Boolean(result.active),
        paused: Boolean(result.paused),
        cancelled: Boolean(result.cancelled),
        released: command === 'release',
        compacted: command === 'cancel' || command === 'release'
      });
      if (command !== 'cancel' && command !== 'release') return snapshot;
      context.localCancelGeneration = Number(result.cancelGeneration) || 0;
      context.pendingTerminal = {
        command,
        terminal: command === 'cancel' ? 'cancelled' : 'released',
        cancelGeneration: context.localCancelGeneration,
        snapshot,
        inflight: null,
        completion: null,
        persisted: false,
        persistenceReceipt: null
      };
      return continuePendingTerminal(context, context.pendingTerminal);
    }

    return {
      beginEvidenceFirstOperation,
      claimProviderRequest,
      validateCheckpoint,
      commitCheckpoint,
      resume,
      finalize,
      status,
      controlOwned,
      commitTrustedDocument,
      retireTrustedTab,
      control,
      assertActive,
      checkpointKey
    };
  }

  return {
    createMechanismOperationCoordinator,
    MECHANISM_OPERATION_COORDINATOR_VERSION,
    MECHANISM_CHECKPOINT_SCHEMA_VERSION,
    MECHANISM_BINDING_VERSIONS,
    EVIDENCE_FIRST_POLICY,
    MAX_PROVIDER_REQUESTS_PER_RUN,
    OPERATION_DEADLINE_MS,
    MAX_ACTIVE_MECHANISM_CONTEXTS,
    MECHANISM_RUN_STATE_SCHEMA_VERSION,
    MECHANISM_PROTECTED_BYTES_RESERVATION,
    MAX_COMPLETED_PANEL_KEYS
  };
});
