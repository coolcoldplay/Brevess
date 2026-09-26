(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const RUNTIME_REVISION = '1.0.1-build1-store-release';
  const pdfFigureRequests = typeof shared.validatePdfFigureRequest === 'function'
    ? shared : (typeof require === 'function' ? require('./pdf-figure-request.js') : null);
  const pdfPanelInventory = typeof shared.compilePdfFigurePanelInventoryPrompt === 'function'
    ? shared : (typeof require === 'function' ? require('./pdf-figure-panel-inventory.js') : null);
  const PDF_FIGURE_WORKFLOW_VERSION = 'pdf-figure-discovery-analysis-v2-multipage';
  const EVIDENCE_FIRST_ROUTER_VERSION = '2';
  const EVIDENCE_FIRST_REQUEST_CONTRACT = Object.freeze({
    markerField: 'evidenceFirstVersion',
    version: EVIDENCE_FIRST_ROUTER_VERSION,
    requiredFields: Object.freeze([
      'evidenceFirstVersion', 'operationId', 'documentId', 'workspaceId',
      'baseWorkspaceRevision', 'evidenceFirstRouterVersion',
      'evidenceFirstVersions'
    ])
  });
  const evidenceFirstContracts = shared.EVIDENCE_FIRST_POLICY &&
    shared.EVIDENCE_FIRST_VERSIONS &&
    typeof shared.normalizeEvidenceFirstVersions === 'function'
    ? shared
    : (typeof require === 'function' ? require('./evidence-first-mechanism.js') : null);
  const EVIDENCE_FIRST_POLICY = evidenceFirstContracts?.EVIDENCE_FIRST_POLICY;
  const EVIDENCE_FIRST_VERSIONS = evidenceFirstContracts?.EVIDENCE_FIRST_VERSIONS;
  const normalizeEvidenceFirstVersions =
    evidenceFirstContracts?.normalizeEvidenceFirstVersions;
  if (!EVIDENCE_FIRST_POLICY || !EVIDENCE_FIRST_VERSIONS ||
      typeof normalizeEvidenceFirstVersions !== 'function') {
    throw new Error('EVIDENCE_FIRST_CONTRACT_UNAVAILABLE');
  }
  const workspaceStoreContracts = typeof shared.workspaceContentFingerprint === 'function'
    ? shared
    : (typeof require === 'function' ? require('./article-workspace-store.js') : null);
  const workspaceContentFingerprint = workspaceStoreContracts?.workspaceContentFingerprint;
  if (typeof workspaceContentFingerprint !== 'function') {
    throw new Error('WORKSPACE_CONTENT_FINGERPRINT_UNAVAILABLE');
  }
  const EVIDENCE_CHECKPOINT_PAYLOAD_VERSION =
    'evidence-first-checkpoint-payload-v2-sha256';
  const TASK_TIMEOUTS_MS = Object.freeze({
    highlight: 180000,
    summary: 180000,
    chat: 240000,
    figure: 300000,
    crossFigure: 300000
  });
  const TASK_CONCURRENCY = Object.freeze({
    highlight: 3,
    summary: 2,
    chat: 1,
    // Figure requests are large multimodal calls. A single ordered worker avoids
    // provider throttling and prevents late responses from interleaving state
    // checkpoints while still preserving per-Figure retry/resume behavior.
    figure: 1,
    crossFigure: 1
  });
  const TASK_RUNTIME_CLASSES = Object.freeze({
    document_highlight: 'highlight',
    semantic_find: 'highlight',
    evidence_ledger_review: 'highlight',
    paragraph_summary: 'summary',
    article_outline_summary: 'summary',
    abbreviation_translation: 'summary',
    figure_walkthrough: 'figure',
    figure_panel_interpretation: 'figure',
    figure_panel_followup: 'figure',
    cross_figure_mechanism: 'crossFigure',
    paper_research_logic: 'summary',
    paper_innovations: 'summary',
    paper_limitations: 'summary',
    literature_note_autofill: 'summary',
    article_chat: 'chat',
    selection_chat: 'chat'
  });
  const FIGURE_PROVIDER_ATTEMPT_HARD_LIMIT = Math.max(1, Math.min(
    96,
    Math.floor(Number(EVIDENCE_FIRST_POLICY.maxProviderRequestsPerRun) || 96)
  ));
  const FIGURE_REQUEST_OUTER_ATTEMPTS = 3;
  const FIGURE_SCHEMA_PASSES = 2;
  const FIGURE_PANEL_RECOVERY_BATCH_SIZE = 3;
  const FIGURE_STANDARD_WHOLE_PANEL_LIMIT = 8;
  const FIGURE_STANDARD_PANEL_BATCH_SIZE = 6;
  const FIGURE_DEFAULT_TRUNCATION_RETRIES = 2;
  const FIGURE_MAX_TRUNCATION_RETRIES = 10;
  const FIGURE_RECEIPT_TTL_MS = 10 * 60 * 1000;
  const FIGURE_BUDGET_TTL_MS = 30 * 60 * 1000;
  const FIGURE_RECEIPT_CAPACITY = 128;
  const FIGURE_PROVIDER_ATTEMPT_LEDGER_KEY = 'sciFigureProviderAttemptLedgerV1';
  // Version 2 adds the durable public-operation owner index.  A version-1
  // envelope cannot prove that a differently scoped internal digest was not
  // derived from the same public operation id, so it must fail closed instead
  // of being migrated into a fresh control namespace.
  const FIGURE_PROVIDER_ATTEMPT_LEDGER_VERSION = 2;
  const FIGURE_PROVIDER_ATTEMPT_RECEIPTS_PER_OPERATION = 128;
  const FIGURE_PROVIDER_ATTEMPT_STORAGE_TIMEOUT_MS = 5000;
  const FIGURE_OWNER_AUTHORITY_CAPACITY = 256;
  const MECHANISM_BROWSER_SESSION_KEY = 'sciMechanismBrowserSessionV1';
  const MECHANISM_BROWSER_SESSION_VERSION = 1;
  const FIGURE_CHECKPOINT_ENVELOPE_VERSION = 'figure-checkpoint-envelope-v1';
  const figureProviderAttemptLedgerTails = new WeakMap();
  const mechanismBrowserSessionTails = new WeakMap();
  const STRONG_CANONICAL_MAX_UTF8_BYTES = 16 * 1024 * 1024;
  const STRONG_CANONICAL_MAX_NODES = 100000;
  const STRONG_CANONICAL_MAX_DEPTH = 64;
  const FIGURE_PROVIDER_DISPATCH_COLLECTOR = Symbol(
    'figure-provider-dispatch-collector'
  );

  function strongBindingError() {
    return figureProviderAttemptLedgerError('FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE');
  }

  function canonicalStrongJson(value, state = null, depth = 0) {
    const context = state || {
      ancestors: new Set(),
      encoder: new TextEncoder(),
      nodes: 0,
      utf8Bytes: 0
    };
    context.nodes += 1;
    if (context.nodes > STRONG_CANONICAL_MAX_NODES ||
        depth > STRONG_CANONICAL_MAX_DEPTH) throw strongBindingError();
    const emit = fragment => {
      if (typeof fragment !== 'string' ||
          fragment.length > STRONG_CANONICAL_MAX_UTF8_BYTES - context.utf8Bytes) {
        throw strongBindingError();
      }
      const byteLength = context.encoder.encode(fragment).byteLength;
      if (byteLength > STRONG_CANONICAL_MAX_UTF8_BYTES - context.utf8Bytes) {
        throw strongBindingError();
      }
      context.utf8Bytes += byteLength;
      return fragment;
    };
    if (value === null) return emit('null');
    if (typeof value === 'string' || typeof value === 'boolean') {
      if (typeof value === 'string' &&
          value.length > STRONG_CANONICAL_MAX_UTF8_BYTES) {
        throw strongBindingError();
      }
      return emit(JSON.stringify(value));
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw strongBindingError();
      return emit(JSON.stringify(value));
    }
    if (Array.isArray(value)) {
      if (context.ancestors.has(value)) throw strongBindingError();
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') ||
          !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
          lengthDescriptor.value > STRONG_CANONICAL_MAX_NODES) {
        throw strongBindingError();
      }
      const length = lengthDescriptor.value;
      context.ancestors.add(value);
      const items = [];
      try {
        emit('[');
        for (let index = 0; index < length; index += 1) {
          if (index > 0) emit(',');
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor) {
            items.push(emit('null'));
            continue;
          }
          if (!Object.hasOwn(descriptor, 'value')) throw strongBindingError();
          const item = descriptor.value;
          if (item === undefined) {
            items.push(emit('null'));
            continue;
          }
          items.push(canonicalStrongJson(item, context, depth + 1));
        }
        emit(']');
        return `[${items.join(',')}]`;
      } finally {
        context.ancestors.delete(value);
      }
    }
    if (!value || typeof value !== 'object' || context.ancestors.has(value)) {
      throw strongBindingError();
    }
    context.ancestors.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).filter(key =>
      descriptors[key]?.enumerable === true
    ).sort();
    if (keys.length > STRONG_CANONICAL_MAX_NODES - context.nodes) {
      context.ancestors.delete(value);
      throw strongBindingError();
    }
    const fields = [];
    try {
      emit('{');
      for (const key of keys) {
        const descriptor = descriptors[key];
        if (!Object.hasOwn(descriptor, 'value')) throw strongBindingError();
        if (descriptor.value === undefined) continue;
        const prefix = `${fields.length ? ',' : ''}${JSON.stringify(key)}:`;
        emit(prefix);
        fields.push(`${JSON.stringify(key)}:${canonicalStrongJson(
          descriptor.value, context, depth + 1
        )}`);
      }
      emit('}');
      return `{${fields.join(',')}}`;
    } finally {
      context.ancestors.delete(value);
    }
  }

  async function strongSha256(value, cryptoImpl = globalThis.crypto) {
    if (!cryptoImpl?.subtle || typeof cryptoImpl.subtle.digest !== 'function' ||
        typeof TextEncoder !== 'function') {
      throw strongBindingError();
    }
    let digest;
    try {
      const canonical = canonicalStrongJson(value);
      const encoded = new TextEncoder().encode(canonical);
      if (encoded.byteLength > STRONG_CANONICAL_MAX_UTF8_BYTES) {
        throw strongBindingError();
      }
      digest = await cryptoImpl.subtle.digest(
        'SHA-256', encoded
      );
    } catch (_) {
      throw strongBindingError();
    }
    return [...new Uint8Array(digest)]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function figureProviderAttemptLedgerError(code = 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE') {
    const error = new Error(code);
    error.code = code;
    error.retryable = false;
    return error;
  }

  function createMechanismBrowserSessionIdentityProvider({
    storageArea,
    cryptoImpl = globalThis.crypto,
    getRuntimeLastError = () => null,
    storageTimeoutMs = FIGURE_PROVIDER_ATTEMPT_STORAGE_TIMEOUT_MS
  } = {}) {
    let resolvedSessionId = '';
    let activeRead = null;
    const timeoutMs = Math.max(1, Math.min(
      30000, Math.floor(Number(storageTimeoutMs) ||
        FIGURE_PROVIDER_ATTEMPT_STORAGE_TIMEOUT_MS)
    ));

    function sessionFailure() {
      const error = new Error('MECHANISM_RUN_STATE_READ_FAILED');
      error.code = 'MECHANISM_RUN_STATE_READ_FAILED';
      error.retryable = false;
      return error;
    }

    function storageCall(method, argument) {
      if (!storageArea || typeof storageArea[method] !== 'function') {
        return Promise.reject(sessionFailure());
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(sessionFailure());
        }, timeoutMs);
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) reject(sessionFailure());
          else resolve(value);
        };
        const callback = value => {
          let runtimeError = null;
          try { runtimeError = getRuntimeLastError?.() || null; } catch (_) {
            runtimeError = sessionFailure();
          }
          finish(runtimeError, value);
        };
        try {
          const pending = storageArea[method](argument, callback);
          if (pending?.then) pending.then(
            value => finish(null, value),
            error => finish(error)
          );
        } catch (error) {
          finish(error);
        }
      });
    }

    function parseRecord(container, { allowMissing = false } = {}) {
      const record = container?.[MECHANISM_BROWSER_SESSION_KEY];
      if (record === undefined && allowMissing) return '';
      if (!record || typeof record !== 'object' || Array.isArray(record) ||
          record.version !== MECHANISM_BROWSER_SESSION_VERSION ||
          typeof record.sessionId !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(record.sessionId) ||
          Object.keys(record).length !== 2) {
        throw sessionFailure();
      }
      return record.sessionId;
    }

    function generateSessionId() {
      if (!cryptoImpl || typeof cryptoImpl.getRandomValues !== 'function') {
        throw sessionFailure();
      }
      const bytes = new Uint8Array(32);
      try { cryptoImpl.getRandomValues(bytes); } catch (_) { throw sessionFailure(); }
      return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    }

    async function loadOrCreate() {
      const initial = await storageCall('get', MECHANISM_BROWSER_SESSION_KEY);
      const existing = parseRecord(initial, { allowMissing: true });
      if (existing) return existing;
      const sessionId = generateSessionId();
      await storageCall('set', {
        [MECHANISM_BROWSER_SESSION_KEY]: {
          version: MECHANISM_BROWSER_SESSION_VERSION,
          sessionId
        }
      });
      const confirmed = await storageCall('get', MECHANISM_BROWSER_SESSION_KEY);
      return parseRecord(confirmed);
    }

    return async function mechanismBrowserSessionIdentity() {
      if (resolvedSessionId) return resolvedSessionId;
      if (activeRead) return activeRead;
      const predecessor = storageArea && typeof storageArea === 'object'
        ? (mechanismBrowserSessionTails.get(storageArea) || Promise.resolve())
        : Promise.resolve();
      const job = predecessor.then(loadOrCreate);
      if (storageArea && typeof storageArea === 'object') {
        mechanismBrowserSessionTails.set(storageArea, job.catch(() => {}));
      }
      activeRead = job.then(value => {
        resolvedSessionId = value;
        activeRead = null;
        return value;
      }, error => {
        activeRead = null;
        throw error;
      });
      return activeRead;
    };
  }

  function createFigureProviderAttemptLedger({
    storageArea,
    getRuntimeLastError = () => null,
    nowImpl = () => Date.now(),
    storageTimeoutMs = FIGURE_PROVIDER_ATTEMPT_STORAGE_TIMEOUT_MS
  } = {}) {
    if (!storageArea || typeof storageArea !== 'object' ||
        typeof storageArea.get !== 'function' || typeof storageArea.set !== 'function') {
      return {
        bindRequest: async () => {
          throw figureProviderAttemptLedgerError();
        },
        reserveAttempt: async () => {
          throw figureProviderAttemptLedgerError();
        },
        settleAttempt: async () => {
          throw figureProviderAttemptLedgerError();
        },
        prepareAttemptProof: async () => {
          throw figureProviderAttemptLedgerError();
        },
        sealRespondedAttempts: async () => {
          throw figureProviderAttemptLedgerError();
        },
        terminate: async () => {
          throw figureProviderAttemptLedgerError();
        },
        controlOperation: async () => {
          throw figureProviderAttemptLedgerError();
        },
        commitTrustedDocument: async () => {
          throw figureProviderAttemptLedgerError();
        },
        retireTrustedTab: async () => {
          throw figureProviderAttemptLedgerError();
        },
        listPendingTabRetirements: async () => {
          throw figureProviderAttemptLedgerError();
        },
        confirmTrustedTabRetirement: async () => {
          throw figureProviderAttemptLedgerError();
        }
      };
    }
    const timeoutMs = Math.max(1, Math.min(
      30000, Math.floor(Number(storageTimeoutMs) ||
        FIGURE_PROVIDER_ATTEMPT_STORAGE_TIMEOUT_MS)
    ));

    function storageCall(method, argument) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(figureProviderAttemptLedgerError());
        }, timeoutMs);
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(value);
        };
        const callback = value => {
          let runtimeError = null;
          try { runtimeError = getRuntimeLastError?.() || null; } catch (_) {}
          finish(runtimeError, value);
        };
        try {
          const pending = storageArea[method](argument, callback);
          if (pending?.then) pending.then(
            value => finish(null, value),
            error => finish(error)
          );
        } catch (error) {
          finish(error);
        }
      });
    }

    function normalizeOwnerScope(value, { optional = false } = {}) {
      if ((value === undefined || value === null) && optional) return null;
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          value.version !== 1 || typeof value.senderExtensionId !== 'string' ||
          !value.senderExtensionId || value.senderExtensionId.length > 256 ||
          !Number.isSafeInteger(value.senderTabId) || value.senderTabId < 0 ||
          !Number.isSafeInteger(value.senderFrameId) || value.senderFrameId < 0 ||
          typeof value.senderDocumentId !== 'string' || !value.senderDocumentId ||
          value.senderDocumentId.length > 256 ||
          !Number.isSafeInteger(value.workspaceLifecycle) || value.workspaceLifecycle < 0) {
        throw figureProviderAttemptLedgerError();
      }
      return {
        version: 1,
        senderExtensionId: value.senderExtensionId,
        senderTabId: value.senderTabId,
        senderFrameId: value.senderFrameId,
        senderDocumentId: value.senderDocumentId,
        workspaceLifecycle: value.workspaceLifecycle
      };
    }

    function ownerTabMatches(left, right) {
      return left?.senderExtensionId === right?.senderExtensionId &&
        left?.senderTabId === right?.senderTabId;
    }

    function ownerDocumentMatches(left, right) {
      return ownerTabMatches(left, right) &&
        left?.senderFrameId === right?.senderFrameId;
    }

    function ownerScopeMatches(left, right) {
      if (!left || !right) return left === right;
      return ownerDocumentMatches(left, right) &&
        left.senderDocumentId === right.senderDocumentId &&
        left.workspaceLifecycle === right.workspaceLifecycle;
    }

    function normalizeEnvelope(value, now) {
      if (value === undefined) {
        return {
          version: FIGURE_PROVIDER_ATTEMPT_LEDGER_VERSION,
          operations: [],
          pendingControls: [],
          pendingTabRetirements: [],
          ownerTabs: [],
          ownerDocuments: []
        };
      }
      const pendingControlSources = value?.pendingControls === undefined
        ? [] : value.pendingControls;
      const pendingTabRetirementSources = value?.pendingTabRetirements === undefined
        ? [] : value.pendingTabRetirements;
      const ownerTabSources = value?.ownerTabs === undefined ? [] : value.ownerTabs;
      const ownerDocumentSources = value?.ownerDocuments === undefined
        ? [] : value.ownerDocuments;
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          value.version !== FIGURE_PROVIDER_ATTEMPT_LEDGER_VERSION ||
          !Array.isArray(value.operations) ||
          !Array.isArray(pendingControlSources) ||
          !Array.isArray(pendingTabRetirementSources) ||
          !Array.isArray(ownerTabSources) || !Array.isArray(ownerDocumentSources) ||
          pendingTabRetirementSources.length > FIGURE_OWNER_AUTHORITY_CAPACITY ||
          ownerTabSources.length > FIGURE_OWNER_AUTHORITY_CAPACITY ||
          ownerDocumentSources.length > FIGURE_OWNER_AUTHORITY_CAPACITY ||
          value.operations.length + pendingControlSources.length >
            FIGURE_RECEIPT_CAPACITY) {
        throw figureProviderAttemptLedgerError();
      }
      const operations = [];
      const seen = new Set();
      for (const source of value.operations) {
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
          throw figureProviderAttemptLedgerError();
        }
        const operationId = typeof source.operationId === 'string'
          ? source.operationId : '';
        const publicOperationId = typeof source.publicOperationId === 'string'
          ? shared.normalizeOperationId?.(source.publicOperationId) || ''
          : operationId;
        const bindingSignature = typeof source.bindingSignature === 'string'
          ? source.bindingSignature : '';
        const immutableLimit = Number(source.immutableLimit);
        const reservedAttempts = Number(source.reservedAttempts);
        const lastTouchedAt = Number(source.lastTouchedAt);
        const receipts = Array.isArray(source.receipts) ? source.receipts : null;
        if (!/^figure:[a-f0-9]{64}$/u.test(operationId) || !publicOperationId ||
            seen.has(operationId) ||
            !/^[a-f0-9]{64}$/u.test(bindingSignature) ||
            !Number.isSafeInteger(immutableLimit) || immutableLimit < 1 ||
            immutableLimit > FIGURE_PROVIDER_ATTEMPT_HARD_LIMIT ||
            !Number.isSafeInteger(reservedAttempts) || reservedAttempts < 0 ||
            reservedAttempts > immutableLimit || !Number.isFinite(lastTouchedAt) ||
            !receipts || receipts.length > FIGURE_PROVIDER_ATTEMPT_RECEIPTS_PER_OPERATION) {
          throw figureProviderAttemptLedgerError();
        }
        const terminalCode = [
          'CANCELLED', 'REQUEST_TIMEOUT', 'FIGURE_PROVIDER_ATTEMPT_LIMIT',
          'FIGURE_REQUEST_REPLAY_AMBIGUOUS'
        ].includes(source.terminalCode) ? source.terminalCode : '';
        if (source.terminalCode !== undefined && source.terminalCode !== '' &&
            !terminalCode) {
          throw figureProviderAttemptLedgerError();
        }
        const releasedAt = Number(source.releasedAt || 0);
        if (!Number.isFinite(releasedAt) || releasedAt < 0) {
          throw figureProviderAttemptLedgerError();
        }
        // Every receipt remains authoritative for the owner document's entire
        // storage.session lifetime. Only a trusted committed navigation or tab
        // removal may retire it; wall time never creates a fresh budget.
        const ownerScope = normalizeOwnerScope(source.ownerScope, { optional: true });
        const normalizedReceipts = [];
        const seenReceipts = new Set();
        for (const receiptSource of receipts) {
          const receipt = typeof receiptSource?.receipt === 'string'
            ? receiptSource.receipt : '';
          const requestSignature = typeof receiptSource?.requestSignature === 'string'
            ? receiptSource.requestSignature : '';
          const status = receiptSource?.status === undefined
            ? 'claimed' : receiptSource.status;
          const targetKeyDigest = typeof receiptSource?.targetKeyDigest === 'string'
            ? receiptSource.targetKeyDigest : requestSignature;
          const semanticSignature = typeof receiptSource?.semanticSignature === 'string'
            ? receiptSource.semanticSignature : requestSignature;
          const resumeCheckpointDigest = typeof receiptSource?.resumeCheckpointDigest === 'string'
            ? receiptSource.resumeCheckpointDigest : '';
          const continuationDigest = typeof receiptSource?.continuationDigest === 'string'
            ? receiptSource.continuationDigest : '';
          const continuationConsumed = receiptSource?.continuationConsumed === true;
          if (!/^figure-request-[A-Za-z0-9._:-]{8,140}$/u.test(receipt) ||
              !/^[a-f0-9]{64}$/u.test(requestSignature) ||
              !/^[a-f0-9]{64}$/u.test(targetKeyDigest) ||
              !/^[a-f0-9]{64}$/u.test(semanticSignature) ||
              (resumeCheckpointDigest &&
                !/^[a-f0-9]{64}$/u.test(resumeCheckpointDigest)) ||
              (continuationDigest &&
                !/^[a-f0-9]{64}$/u.test(continuationDigest)) ||
              !['claimed', 'superseded'].includes(status) ||
              seenReceipts.has(receipt)) {
            throw figureProviderAttemptLedgerError();
          }
          seenReceipts.add(receipt);
          normalizedReceipts.push({
            receipt, requestSignature, targetKeyDigest, semanticSignature,
            resumeCheckpointDigest, continuationDigest, continuationConsumed, status
          });
        }
        const dispatchSources = source.providerDispatches === undefined
          ? null : source.providerDispatches;
        if (dispatchSources !== null && (!Array.isArray(dispatchSources) ||
            dispatchSources.length !== reservedAttempts ||
            dispatchSources.length > FIGURE_PROVIDER_ATTEMPT_HARD_LIMIT)) {
          throw figureProviderAttemptLedgerError();
        }
        const normalizedDispatches = [];
        const seenAttemptNumbers = new Set();
        const sourceDispatches = dispatchSources || Array.from(
          { length: reservedAttempts },
          (_, index) => {
            const outer = normalizedReceipts.at(-1);
            return {
              attemptNumber: index + 1,
              receipt: outer?.receipt || '',
              requestSignature: outer?.requestSignature || '',
              dispatchDigest: outer?.requestSignature || '',
              // A pre-v2 active ledger cannot prove that its last reserved call
              // reached a durable checkpoint. Migrate it conservatively as an
              // unsealed dispatch; earlier calls are treated as settled only so
              // the immutable total remains representable.
              status: !terminalCode && releasedAt === 0 &&
                index === reservedAttempts - 1 ? 'claimed' : 'sealed'
            };
          }
        );
        for (const dispatchSource of sourceDispatches) {
          const attemptNumber = Number(dispatchSource?.attemptNumber);
          const receipt = typeof dispatchSource?.receipt === 'string'
            ? dispatchSource.receipt : '';
          const requestSignature = typeof dispatchSource?.requestSignature === 'string'
            ? dispatchSource.requestSignature : '';
          const dispatchDigest = typeof dispatchSource?.dispatchDigest === 'string'
            ? dispatchSource.dispatchDigest : requestSignature;
          const status = dispatchSource?.status;
          const proofKind = dispatchSource?.proofKind === undefined
            ? '' : dispatchSource.proofKind;
          const proofDigest = dispatchSource?.proofDigest === undefined
            ? '' : dispatchSource.proofDigest;
          const outer = normalizedReceipts.find(entry => entry.receipt === receipt);
          if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1 ||
              attemptNumber > reservedAttempts || seenAttemptNumbers.has(attemptNumber) ||
              !outer || outer.requestSignature !== requestSignature ||
              !/^[a-f0-9]{64}$/u.test(dispatchDigest) ||
              !['claimed', 'responded', 'sealed'].includes(status) ||
              !['', 'checkpoint', 'cache'].includes(proofKind) ||
              (proofKind ? !/^[a-f0-9]{64}$/u.test(proofDigest) : proofDigest !== '') ||
              (proofKind && status !== 'responded')) {
            throw figureProviderAttemptLedgerError();
          }
          seenAttemptNumbers.add(attemptNumber);
          normalizedDispatches.push({
            attemptNumber, receipt, requestSignature, dispatchDigest, status,
            proofKind, proofDigest
          });
        }
        normalizedDispatches.sort((left, right) =>
          left.attemptNumber - right.attemptNumber
        );
        if (normalizedDispatches.some((entry, index) => entry.attemptNumber !== index + 1)) {
          throw figureProviderAttemptLedgerError();
        }
        seen.add(operationId);
        operations.push({
          operationId, publicOperationId,
          bindingSignature,
          immutableLimit,
          reservedAttempts,
          receipts: normalizedReceipts,
          providerDispatches: normalizedDispatches,
          terminalCode,
          releasedAt,
          ownerScope,
          lastTouchedAt
        });
      }
      const pendingControls = [];
      for (const source of pendingControlSources) {
        const operationId = typeof source?.operationId === 'string'
          ? source.operationId : '';
        const publicOperationId = typeof source?.publicOperationId === 'string'
          ? shared.normalizeOperationId?.(source.publicOperationId) || ''
          : operationId;
        const command = source?.command;
        const lastTouchedAt = Number(source?.lastTouchedAt);
        if (!/^figure:[a-f0-9]{64}$/u.test(operationId) || !publicOperationId ||
            seen.has(operationId) ||
            !['cancel', 'release'].includes(command) ||
            !Number.isFinite(lastTouchedAt)) {
          throw figureProviderAttemptLedgerError();
        }
        seen.add(operationId);
        const ownerScope = normalizeOwnerScope(source?.ownerScope, { optional: true });
        pendingControls.push({
          operationId, publicOperationId, command, ownerScope, lastTouchedAt
        });
      }
      const ownerTabs = [];
      const seenTabs = new Set();
      for (const source of ownerTabSources) {
        const senderExtensionId = typeof source?.senderExtensionId === 'string'
          ? source.senderExtensionId : '';
        const senderTabId = Number(source?.senderTabId);
        const navigationGeneration = Number(source?.navigationGeneration);
        const retired = source?.retired === true;
        const lastTouchedAt = Number(source?.lastTouchedAt);
        const key = `${senderExtensionId}:${senderTabId}`;
        if (!senderExtensionId || senderExtensionId.length > 256 ||
            !Number.isSafeInteger(senderTabId) || senderTabId < 0 ||
            !Number.isSafeInteger(navigationGeneration) || navigationGeneration < 1 ||
            !Number.isFinite(lastTouchedAt) || seenTabs.has(key)) {
          throw figureProviderAttemptLedgerError();
        }
        seenTabs.add(key);
        ownerTabs.push({
          senderExtensionId, senderTabId, navigationGeneration, retired, lastTouchedAt
        });
      }
      const pendingTabRetirements = [];
      const seenRetirements = new Set();
      for (const source of pendingTabRetirementSources) {
        const senderExtensionId = typeof source?.senderExtensionId === 'string'
          ? source.senderExtensionId : '';
        const senderTabId = Number(source?.senderTabId);
        const lastTouchedAt = Number(source?.lastTouchedAt);
        const key = `${senderExtensionId}:${senderTabId}`;
        if (!senderExtensionId || senderExtensionId.length > 256 ||
            !Number.isSafeInteger(senderTabId) || senderTabId < 0 ||
            !Number.isFinite(lastTouchedAt) || seenRetirements.has(key)) {
          throw figureProviderAttemptLedgerError();
        }
        seenRetirements.add(key);
        pendingTabRetirements.push({ senderExtensionId, senderTabId, lastTouchedAt });
      }
      const ownerDocuments = [];
      const seenDocuments = new Set();
      for (const source of ownerDocumentSources) {
        const senderExtensionId = typeof source?.senderExtensionId === 'string'
          ? source.senderExtensionId : '';
        const senderDocumentId = typeof source?.senderDocumentId === 'string'
          ? source.senderDocumentId : '';
        const senderTabId = Number(source?.senderTabId);
        const senderFrameId = Number(source?.senderFrameId);
        const navigationGeneration = Number(source?.navigationGeneration);
        const workspaceLifecycle = source?.workspaceLifecycle === undefined ||
          source?.workspaceLifecycle === null
          ? null : Number(source.workspaceLifecycle);
        const lastTouchedAt = Number(source?.lastTouchedAt);
        const key = `${senderExtensionId}:${senderTabId}:${senderFrameId}`;
        if (!senderExtensionId || senderExtensionId.length > 256 ||
            !senderDocumentId || senderDocumentId.length > 256 ||
            !Number.isSafeInteger(senderTabId) || senderTabId < 0 ||
            !Number.isSafeInteger(senderFrameId) || senderFrameId < 0 ||
            !Number.isSafeInteger(navigationGeneration) || navigationGeneration < 1 ||
            (workspaceLifecycle !== null &&
              (!Number.isSafeInteger(workspaceLifecycle) || workspaceLifecycle < 0)) ||
            !Number.isFinite(lastTouchedAt) || seenDocuments.has(key)) {
          throw figureProviderAttemptLedgerError();
        }
        seenDocuments.add(key);
        ownerDocuments.push({
          senderExtensionId, senderTabId, senderFrameId, senderDocumentId,
          navigationGeneration, workspaceLifecycle, lastTouchedAt
        });
      }
      return {
        version: FIGURE_PROVIDER_ATTEMPT_LEDGER_VERSION,
        operations,
        pendingControls,
        pendingTabRetirements,
        ownerTabs,
        ownerDocuments
      };
    }

    function normalizeBinding(input, requireReceipt) {
      const operationId = typeof input?.operationId === 'string'
        ? input.operationId : '';
      const publicOperationId = typeof input?.publicOperationId === 'string'
        ? shared.normalizeOperationId?.(input.publicOperationId) || ''
        : operationId;
      const bindingSignature = typeof input?.bindingSignature === 'string'
        ? input.bindingSignature : '';
      const immutableLimit = Number(input?.immutableLimit);
      const receipt = typeof input?.receipt === 'string' ? input.receipt : '';
      const requestSignature = typeof input?.requestSignature === 'string'
        ? input.requestSignature : '';
      const semanticSignature = typeof input?.semanticSignature === 'string'
        ? input.semanticSignature : requestSignature;
      const targetKeyDigest = typeof input?.targetKeyDigest === 'string'
        ? input.targetKeyDigest : semanticSignature;
      const resumeCheckpointDigest = typeof input?.resumeCheckpointDigest === 'string'
        ? input.resumeCheckpointDigest : '';
      const resumeCacheDigest = typeof input?.resumeCacheDigest === 'string'
        ? input.resumeCacheDigest : '';
      if (!/^figure:[a-f0-9]{64}$/u.test(operationId) || !publicOperationId ||
          !/^[a-f0-9]{64}$/u.test(bindingSignature) ||
          !Number.isSafeInteger(immutableLimit) || immutableLimit < 1 ||
          immutableLimit > FIGURE_PROVIDER_ATTEMPT_HARD_LIMIT ||
          (requireReceipt && (!/^figure-request-[A-Za-z0-9._:-]{8,140}$/u.test(receipt) ||
            !/^[a-f0-9]{64}$/u.test(requestSignature) ||
            !/^[a-f0-9]{64}$/u.test(semanticSignature) ||
            !/^[a-f0-9]{64}$/u.test(targetKeyDigest) ||
            (resumeCheckpointDigest &&
              !/^[a-f0-9]{64}$/u.test(resumeCheckpointDigest)) ||
            (resumeCacheDigest &&
              !/^[a-f0-9]{64}$/u.test(resumeCacheDigest))))) {
        throw figureProviderAttemptLedgerError();
      }
      const ownerScope = normalizeOwnerScope(input?.ownerScope, { optional: true });
      return {
        operationId, publicOperationId, bindingSignature,
        immutableLimit, receipt, requestSignature,
        semanticSignature, targetKeyDigest, resumeCheckpointDigest,
        resumeCacheDigest, ownerScope
      };
    }

    function logicalError(code, operation) {
      const error = figureProviderAttemptLedgerError(code);
      if (operation) {
        error.providerAttempt = operation.reservedAttempts;
        error.providerAttemptLimit = operation.immutableLimit;
      }
      return error;
    }

    function serialize(operation) {
      const previous = figureProviderAttemptLedgerTails.get(storageArea) ||
        Promise.resolve();
      const pending = previous.then(operation, operation);
      figureProviderAttemptLedgerTails.set(
        storageArea, pending.catch(() => undefined)
      );
      return pending;
    }

    async function mutate(mutator, { readOnly = false } = {}) {
      try {
        return await serialize(async () => {
          const now = Number(nowImpl());
          const stored = await storageCall('get', FIGURE_PROVIDER_ATTEMPT_LEDGER_KEY);
          const envelope = normalizeEnvelope(
            stored?.[FIGURE_PROVIDER_ATTEMPT_LEDGER_KEY], now
          );
          const outcome = mutator(envelope, now) || {};
          if (outcome.write === true && !readOnly) {
            await storageCall('set', {
              [FIGURE_PROVIDER_ATTEMPT_LEDGER_KEY]: envelope
            });
          }
          if (outcome.error) throw outcome.error;
          return outcome.value;
        });
      } catch (error) {
        if ([
          'FIGURE_PROVIDER_ATTEMPT_LIMIT', 'FIGURE_REQUEST_RECEIPT_MISMATCH',
          'FIGURE_REQUEST_REPLAY_AMBIGUOUS',
          'FIGURE_REQUEST_RECEIPT_CAPACITY', 'CANCELLED', 'REQUEST_TIMEOUT',
          'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE'
        ].includes(error?.code)) throw error;
        throw figureProviderAttemptLedgerError();
      }
    }

    function findOperation(envelope, operationId) {
      return envelope.operations.find(entry => entry.operationId === operationId) || null;
    }

    function validateOperationBaseBinding(operation, binding) {
      return operation.publicOperationId === binding.publicOperationId &&
        operation.bindingSignature === binding.bindingSignature &&
        operation.immutableLimit === binding.immutableLimit &&
        ownerScopeMatches(operation.ownerScope, binding.ownerScope);
    }

    function validateOperationBinding(operation, binding) {
      return validateOperationBaseBinding(operation, binding);
    }

    function ownerAuthorityError(operation = null) {
      return logicalError('CANCELLED', operation);
    }

    function ensureOwnerAuthority(envelope, ownerScope, now, {
      allowCreate = true, allowLifecycleAdvance = false
    } = {}) {
      if (!ownerScope) return { tab: null, document: null, write: false };
      let write = false;
      let tab = envelope.ownerTabs.find(entry => ownerTabMatches(entry, ownerScope)) || null;
      if (!tab) {
        if (!allowCreate) throw ownerAuthorityError();
        if (envelope.ownerTabs.length >= FIGURE_OWNER_AUTHORITY_CAPACITY) {
          throw logicalError('FIGURE_REQUEST_RECEIPT_CAPACITY');
        }
        tab = {
          senderExtensionId: ownerScope.senderExtensionId,
          senderTabId: ownerScope.senderTabId,
          navigationGeneration: 1,
          retired: false,
          lastTouchedAt: now
        };
        envelope.ownerTabs.push(tab);
        write = true;
      }
      if (tab.retired) throw ownerAuthorityError();
      let document = envelope.ownerDocuments.find(entry =>
        ownerDocumentMatches(entry, ownerScope)
      ) || null;
      if (!document) {
        if (!allowCreate) throw ownerAuthorityError();
        if (envelope.ownerDocuments.length >= FIGURE_OWNER_AUTHORITY_CAPACITY) {
          throw logicalError('FIGURE_REQUEST_RECEIPT_CAPACITY');
        }
        document = {
          senderExtensionId: ownerScope.senderExtensionId,
          senderTabId: ownerScope.senderTabId,
          senderFrameId: ownerScope.senderFrameId,
          senderDocumentId: ownerScope.senderDocumentId,
          navigationGeneration: tab.navigationGeneration,
          workspaceLifecycle: ownerScope.workspaceLifecycle,
          lastTouchedAt: now
        };
        envelope.ownerDocuments.push(document);
        write = true;
      }
      if (document.senderDocumentId !== ownerScope.senderDocumentId ||
          document.navigationGeneration !== tab.navigationGeneration) {
        throw ownerAuthorityError();
      }
      let removedOperationIds = [];
      if (document.workspaceLifecycle === null) {
        if (!allowCreate) throw ownerAuthorityError();
        document.workspaceLifecycle = ownerScope.workspaceLifecycle;
        write = true;
      } else if (document.workspaceLifecycle !== ownerScope.workspaceLifecycle) {
        if (!allowLifecycleAdvance ||
            ownerScope.workspaceLifecycle !== document.workspaceLifecycle + 1) {
          throw ownerAuthorityError();
        }
        document.workspaceLifecycle = ownerScope.workspaceLifecycle;
        removedOperationIds = removeOwnerOperations(envelope, scope =>
          ownerDocumentMatches(scope, ownerScope) &&
          scope.senderDocumentId === ownerScope.senderDocumentId &&
          scope.workspaceLifecycle !== ownerScope.workspaceLifecycle
        );
        write = true;
      }
      if (tab.lastTouchedAt !== now || document.lastTouchedAt !== now) {
        tab.lastTouchedAt = now;
        document.lastTouchedAt = now;
        write = true;
      }
      return { tab, document, write, removedOperationIds };
    }

    function normalizeTrustedDocumentInput(input, { tabOnly = false } = {}) {
      const senderExtensionId = typeof input?.senderExtensionId === 'string'
        ? input.senderExtensionId : '';
      const senderTabId = Number(input?.senderTabId);
      const senderFrameId = Number(input?.senderFrameId);
      const senderDocumentId = typeof input?.senderDocumentId === 'string'
        ? input.senderDocumentId : '';
      if (!senderExtensionId || senderExtensionId.length > 256 ||
          !Number.isSafeInteger(senderTabId) || senderTabId < 0 ||
          (!tabOnly && (!Number.isSafeInteger(senderFrameId) || senderFrameId < 0 ||
            !senderDocumentId || senderDocumentId.length > 256))) {
        throw figureProviderAttemptLedgerError();
      }
      return { senderExtensionId, senderTabId, senderFrameId, senderDocumentId };
    }

    function removeOwnerOperations(envelope, predicate) {
      const removedOperationIds = [];
      envelope.operations = envelope.operations.filter(operation => {
        if (!operation.ownerScope || !predicate(operation.ownerScope)) return true;
        removedOperationIds.push(operation.operationId);
        return false;
      });
      envelope.pendingControls = envelope.pendingControls.filter(control => {
        if (!control.ownerScope || !predicate(control.ownerScope)) return true;
        removedOperationIds.push(control.operationId);
        return false;
      });
      return [...new Set(removedOperationIds)];
    }

    return {
      async bindRequest(input) {
        const binding = normalizeBinding(input, true);
        const proofValidated = input?.proofValidated === true;
        const inspectOnly = input?.inspectOnly === true;
        const advisoryConsumed = Number(input?.advisoryConsumed || 0);
        if (!Number.isSafeInteger(advisoryConsumed) || advisoryConsumed < 0 ||
            advisoryConsumed > binding.immutableLimit) {
          throw figureProviderAttemptLedgerError();
        }
        return mutate((envelope, now) => {
          const conflictingOwner = [...envelope.operations, ...envelope.pendingControls]
            .find(entry => entry.publicOperationId === binding.publicOperationId &&
              (entry.operationId !== binding.operationId ||
                !ownerScopeMatches(entry.ownerScope, binding.ownerScope)));
          if (conflictingOwner) {
            return { error: ownerAuthorityError(
              envelope.operations.includes(conflictingOwner) ? conflictingOwner : null
            ) };
          }
          const authority = ensureOwnerAuthority(envelope, binding.ownerScope, now, {
            allowLifecycleAdvance: true
          });
          let operation = findOperation(envelope, binding.operationId);
          const pendingControlIndex = envelope.pendingControls.findIndex(entry =>
            entry.operationId === binding.operationId
          );
          const pendingControl = pendingControlIndex >= 0
            ? envelope.pendingControls[pendingControlIndex] : null;
          if (pendingControl) {
            if (!ownerScopeMatches(pendingControl.ownerScope, binding.ownerScope)) {
              return { error: ownerAuthorityError() };
            }
            envelope.pendingControls.splice(pendingControlIndex, 1);
            if (!operation) {
              operation = {
                operationId: binding.operationId,
                publicOperationId: binding.publicOperationId,
                bindingSignature: binding.bindingSignature,
                immutableLimit: binding.immutableLimit,
                reservedAttempts: 0,
                receipts: [{
                  receipt: binding.receipt,
                  requestSignature: binding.requestSignature,
                  targetKeyDigest: binding.targetKeyDigest,
                  semanticSignature: binding.semanticSignature,
                  resumeCheckpointDigest: binding.resumeCheckpointDigest,
                  continuationDigest: '',
                  continuationConsumed: false,
                  status: 'claimed'
                }],
                providerDispatches: [],
                terminalCode: pendingControl.command === 'cancel' ? 'CANCELLED' : '',
                releasedAt: pendingControl.command === 'release' ? now : 0,
                ownerScope: binding.ownerScope,
                lastTouchedAt: now
              };
              envelope.operations.push(operation);
            } else if (validateOperationBinding(operation, binding)) {
              if (pendingControl.command === 'cancel' && !operation.terminalCode) {
                operation.terminalCode = 'CANCELLED';
              }
              if (pendingControl.command === 'release' && operation.releasedAt === 0) {
                operation.releasedAt = now;
              }
              operation.lastTouchedAt = now;
            } else {
              operation.terminalCode = 'FIGURE_PROVIDER_ATTEMPT_LIMIT';
              operation.lastTouchedAt = now;
            }
            return {
              write: true,
              error: logicalError(
                operation.terminalCode || 'FIGURE_PROVIDER_ATTEMPT_LIMIT', operation
              )
            };
          }
          if (!operation) {
            if (advisoryConsumed > 0 ||
                envelope.operations.length + envelope.pendingControls.length >=
                  FIGURE_RECEIPT_CAPACITY) {
              return {
                error: advisoryConsumed > 0
                  ? figureProviderAttemptLedgerError()
                  : logicalError('FIGURE_REQUEST_RECEIPT_CAPACITY')
              };
            }
            operation = {
              operationId: binding.operationId,
              publicOperationId: binding.publicOperationId,
              bindingSignature: binding.bindingSignature,
              immutableLimit: binding.immutableLimit,
              reservedAttempts: 0,
              receipts: [],
              providerDispatches: [],
              terminalCode: '',
              releasedAt: 0,
              ownerScope: binding.ownerScope,
              lastTouchedAt: now
            };
            envelope.operations.push(operation);
          } else if (!validateOperationBaseBinding(operation, binding)) {
            operation.terminalCode = 'FIGURE_PROVIDER_ATTEMPT_LIMIT';
            operation.lastTouchedAt = now;
            return {
              write: true,
              error: logicalError('FIGURE_PROVIDER_ATTEMPT_LIMIT', operation)
            };
          }
          if (operation.terminalCode) {
            return { error: logicalError(operation.terminalCode, operation) };
          }
          const receipt = operation.receipts.find(entry =>
            entry.receipt === binding.receipt
          );
          const existingReceipt = Boolean(receipt);
          if (receipt && receipt.requestSignature !== binding.requestSignature) {
            return {
              error: logicalError('FIGURE_REQUEST_RECEIPT_MISMATCH', operation)
            };
          }
          let write = operation.lastTouchedAt !== now;
          if (!receipt) {
            // A new outer receipt may continue only from an observably newer
            // request (normally one carrying the checkpoint ACK produced by the
            // prior receipt), and only after every prior provider dispatch was
            // durably consumed. This keeps force-refresh from minting a receipt
            // that repeats an already completed semantic request.
            const priorTargetReceipts = operation.receipts.filter(entry =>
              entry.targetKeyDigest === binding.targetKeyDigest
            );
            const semanticMismatch = priorTargetReceipts.some(entry =>
              entry.semanticSignature !== binding.semanticSignature
            );
            const priorTarget = priorTargetReceipts.at(-1) || null;
            if (semanticMismatch) {
              return {
                error: logicalError('FIGURE_REQUEST_RECEIPT_MISMATCH', operation)
              };
            }
            const unsealedDispatches = operation.providerDispatches.filter(entry =>
              entry.status !== 'sealed'
            );
            let recoveredProofKind = '';
            let recoveredProofDigest = '';
            if (unsealedDispatches.length) {
              const firstProof = unsealedDispatches[0];
              const proofKind = firstProof.proofKind;
              const proofDigest = proofKind === 'checkpoint'
                ? binding.resumeCheckpointDigest
                : proofKind === 'cache'
                  ? binding.resumeCacheDigest : '';
              const proofStructureMatches = Boolean(proofKind) &&
                unsealedDispatches.every(entry => {
                  const sourceReceipt = operation.receipts.find(candidate =>
                    candidate.receipt === entry.receipt
                  );
                  return entry.status === 'responded' &&
                    entry.proofKind === proofKind &&
                    entry.proofDigest === firstProof.proofDigest &&
                    sourceReceipt?.targetKeyDigest === binding.targetKeyDigest;
                });
              const proofMatches = proofStructureMatches &&
                Boolean(proofDigest) && firstProof.proofDigest === proofDigest;
              if (!proofMatches) {
                if (proofKind === 'cache' && !binding.resumeCacheDigest &&
                    proofStructureMatches) {
                  return {
                    value: {
                      immutableLimit: operation.immutableLimit,
                      reservedAttempts: operation.reservedAttempts,
                      existingReceipt: false,
                      cacheProofPending: true,
                      expectedCacheProofDigest: firstProof.proofDigest,
                      removedOperationIds: []
                    }
                  };
                }
                return {
                  error: logicalError('FIGURE_REQUEST_REPLAY_AMBIGUOUS', operation)
                };
              }
              recoveredProofKind = proofKind;
              recoveredProofDigest = proofDigest;
            }
            const effectiveContinuationDigest = recoveredProofKind === 'checkpoint'
              ? recoveredProofDigest : priorTarget?.continuationDigest;
            const effectiveContinuationConsumed = recoveredProofKind === 'checkpoint'
              ? false : priorTarget?.continuationConsumed;
            const continuationMatches = Boolean(effectiveContinuationDigest) &&
              effectiveContinuationConsumed !== true &&
              binding.resumeCheckpointDigest === effectiveContinuationDigest;
            if (priorTarget && recoveredProofKind !== 'cache' &&
                !continuationMatches) {
              return {
                error: logicalError('FIGURE_REQUEST_REPLAY_AMBIGUOUS', operation)
              };
            }
            if (operation.releasedAt > 0) {
              return {
                error: logicalError('FIGURE_PROVIDER_ATTEMPT_LIMIT', operation)
              };
            }
            if (operation.receipts.length >=
                FIGURE_PROVIDER_ATTEMPT_RECEIPTS_PER_OPERATION) {
              return {
                error: logicalError('FIGURE_REQUEST_RECEIPT_CAPACITY', operation)
              };
            }
            // A checkpoint is untrusted until the caller has completed the
            // full envelope/result/route/plan validation.  Report a read-only
            // pending bind first; the exact same CAS is retried with
            // proofValidated only after that validation succeeds.  This keeps
            // a correctly re-signed but semantically invalid checkpoint from
            // sealing dispatches, consuming a continuation, or superseding the
            // prior receipt.
            if (binding.resumeCheckpointDigest && !proofValidated) {
              return {
                value: {
                  immutableLimit: operation.immutableLimit,
                  reservedAttempts: operation.reservedAttempts,
                  existingReceipt: false,
                  proofPending: true,
                  removedOperationIds: []
                }
              };
            }
            if (recoveredProofKind) {
              for (const dispatch of unsealedDispatches) {
                dispatch.status = 'sealed';
                dispatch.proofKind = '';
                dispatch.proofDigest = '';
              }
              if (recoveredProofKind === 'checkpoint' && priorTarget) {
                priorTarget.continuationDigest = recoveredProofDigest;
                priorTarget.continuationConsumed = false;
              }
              write = true;
            }
            if (priorTarget) {
              priorTarget.continuationConsumed = true;
            }
            for (const priorReceipt of operation.receipts) {
              if (priorReceipt.status === 'claimed') priorReceipt.status = 'superseded';
            }
            operation.receipts.push({
              receipt: binding.receipt,
              requestSignature: binding.requestSignature,
              targetKeyDigest: binding.targetKeyDigest,
              semanticSignature: binding.semanticSignature,
              resumeCheckpointDigest: binding.resumeCheckpointDigest,
              continuationDigest: '',
              continuationConsumed: false,
              status: 'claimed'
            });
            write = true;
          }
          operation.lastTouchedAt = now;
          return {
            write: write || authority.write,
            value: {
              immutableLimit: operation.immutableLimit,
              reservedAttempts: operation.reservedAttempts,
              existingReceipt,
              removedOperationIds: authority.removedOperationIds
            }
          };
        }, { readOnly: inspectOnly });
      },

      async reserveAttempt(input, dispatchDigestInput) {
        const binding = normalizeBinding(input, true);
        const dispatchDigest = typeof dispatchDigestInput === 'string'
          ? dispatchDigestInput : '';
        if (!/^[a-f0-9]{64}$/u.test(dispatchDigest)) {
          throw figureProviderAttemptLedgerError();
        }
        return mutate((envelope, now) => {
          const operation = findOperation(envelope, binding.operationId);
          if (!operation) return { error: figureProviderAttemptLedgerError() };
          const authority = ensureOwnerAuthority(
            envelope, binding.ownerScope, now, { allowCreate: false }
          );
          if (!validateOperationBinding(operation, binding)) {
            operation.terminalCode = 'FIGURE_PROVIDER_ATTEMPT_LIMIT';
            operation.lastTouchedAt = now;
            return {
              write: true,
              error: logicalError('FIGURE_PROVIDER_ATTEMPT_LIMIT', operation)
            };
          }
          const receipt = operation.receipts.find(entry =>
            entry.receipt === binding.receipt
          );
          if (!receipt || receipt.requestSignature !== binding.requestSignature) {
            return {
              error: logicalError('FIGURE_REQUEST_RECEIPT_MISMATCH', operation)
            };
          }
          if (receipt.status !== 'claimed') {
            return {
              error: logicalError('FIGURE_REQUEST_REPLAY_AMBIGUOUS', operation)
            };
          }
          if (operation.terminalCode) {
            return { error: logicalError(operation.terminalCode, operation) };
          }
          if (operation.releasedAt > 0) {
            return {
              error: logicalError('FIGURE_PROVIDER_ATTEMPT_LIMIT', operation)
            };
          }
          if (operation.reservedAttempts >= operation.immutableLimit) {
            operation.terminalCode = 'FIGURE_PROVIDER_ATTEMPT_LIMIT';
            operation.lastTouchedAt = now;
            return {
              write: true,
              error: logicalError('FIGURE_PROVIDER_ATTEMPT_LIMIT', operation)
            };
          }
          const attemptNumber = operation.reservedAttempts + 1;
          operation.reservedAttempts = attemptNumber;
          operation.providerDispatches.push({
            attemptNumber,
            receipt: binding.receipt,
            requestSignature: binding.requestSignature,
            dispatchDigest,
            status: 'claimed',
            proofKind: '',
            proofDigest: ''
          });
          operation.lastTouchedAt = now;
          return {
            write: true,
            value: {
              immutableLimit: operation.immutableLimit,
              reservedAttempts: operation.reservedAttempts,
              attemptNumber
            }
          };
        });
      },

      async settleAttempt(
        input, attemptNumberInput, dispatchDigestInput, nextStatusInput
      ) {
        const binding = normalizeBinding(input, true);
        const attemptNumber = Number(attemptNumberInput);
        const dispatchDigest = typeof dispatchDigestInput === 'string'
          ? dispatchDigestInput : '';
        const nextStatus = nextStatusInput === 'sealed' ? 'sealed' :
          nextStatusInput === 'responded' ? 'responded' : '';
        if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1 ||
            !/^[a-f0-9]{64}$/u.test(dispatchDigest) || !nextStatus) {
          throw figureProviderAttemptLedgerError();
        }
        return mutate((envelope, now) => {
          const operation = findOperation(envelope, binding.operationId);
          if (!operation) return { error: figureProviderAttemptLedgerError() };
          ensureOwnerAuthority(envelope, binding.ownerScope, now, { allowCreate: false });
          if (!validateOperationBinding(operation, binding)) {
            return { error: logicalError('FIGURE_PROVIDER_ATTEMPT_LIMIT', operation) };
          }
          const dispatch = operation.providerDispatches.find(entry =>
            entry.attemptNumber === attemptNumber
          );
          if (!dispatch || dispatch.receipt !== binding.receipt ||
              dispatch.requestSignature !== binding.requestSignature ||
              dispatch.dispatchDigest !== dispatchDigest) {
            return { error: logicalError('FIGURE_REQUEST_RECEIPT_MISMATCH', operation) };
          }
          const receipt = operation.receipts.find(entry =>
            entry.receipt === binding.receipt
          );
          if (!receipt || receipt.status !== 'claimed') {
            return { error: logicalError('FIGURE_REQUEST_REPLAY_AMBIGUOUS', operation) };
          }
          if (dispatch.status === 'sealed' || dispatch.status === nextStatus) {
            return { value: {
              immutableLimit: operation.immutableLimit,
              reservedAttempts: operation.reservedAttempts,
              attemptNumber,
              status: dispatch.status
            } };
          }
          const validTransition = dispatch.status === 'claimed' &&
              (nextStatus === 'responded' || nextStatus === 'sealed') ||
            dispatch.status === 'responded' && nextStatus === 'sealed';
          if (!validTransition) {
            return { error: figureProviderAttemptLedgerError() };
          }
          dispatch.status = nextStatus;
          if (nextStatus === 'sealed') {
            dispatch.proofKind = '';
            dispatch.proofDigest = '';
          }
          operation.lastTouchedAt = now;
          return { write: true, value: {
            immutableLimit: operation.immutableLimit,
            reservedAttempts: operation.reservedAttempts,
            attemptNumber,
            status: dispatch.status
          } };
        });
      },

      async prepareAttemptProof(
        input, consumedAttemptsInput = [], proofInput = null
      ) {
        const binding = normalizeBinding(input, true);
        if (!Array.isArray(consumedAttemptsInput) || !consumedAttemptsInput.length ||
            consumedAttemptsInput.length > FIGURE_PROVIDER_ATTEMPT_HARD_LIMIT) {
          throw figureProviderAttemptLedgerError();
        }
        const consumedAttempts = consumedAttemptsInput.map(source => {
          const attemptNumber = Number(source?.attemptNumber);
          const dispatchDigest = typeof source?.dispatchDigest === 'string'
            ? source.dispatchDigest : '';
          if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1 ||
              !/^[a-f0-9]{64}$/u.test(dispatchDigest)) {
            throw figureProviderAttemptLedgerError();
          }
          return { attemptNumber, dispatchDigest };
        });
        if (new Set(consumedAttempts.map(entry => entry.attemptNumber)).size !==
            consumedAttempts.length) {
          throw figureProviderAttemptLedgerError();
        }
        const proofKind = ['checkpoint', 'cache'].includes(proofInput?.kind)
          ? proofInput.kind : '';
        const proofDigest = typeof proofInput?.digest === 'string'
          ? proofInput.digest : '';
        if (!proofKind || !/^[a-f0-9]{64}$/u.test(proofDigest)) {
          throw figureProviderAttemptLedgerError();
        }
        return mutate((envelope, now) => {
          const operation = findOperation(envelope, binding.operationId);
          if (!operation) return { error: figureProviderAttemptLedgerError() };
          ensureOwnerAuthority(envelope, binding.ownerScope, now, { allowCreate: false });
          if (!validateOperationBinding(operation, binding)) {
            return { error: logicalError('FIGURE_PROVIDER_ATTEMPT_LIMIT', operation) };
          }
          const outerReceipt = operation.receipts.find(entry =>
            entry.receipt === binding.receipt &&
            entry.requestSignature === binding.requestSignature
          );
          if (!outerReceipt || outerReceipt.status !== 'claimed') {
            return { error: logicalError('FIGURE_REQUEST_RECEIPT_MISMATCH', operation) };
          }
          const candidates = consumedAttempts.map(consumed => {
            const dispatch = operation.providerDispatches.find(entry =>
              entry.attemptNumber === consumed.attemptNumber
            );
            if (!dispatch || dispatch.receipt !== binding.receipt ||
                dispatch.requestSignature !== binding.requestSignature ||
                dispatch.dispatchDigest !== consumed.dispatchDigest ||
                dispatch.status !== 'responded' ||
                (dispatch.proofKind && (dispatch.proofKind !== proofKind ||
                  dispatch.proofDigest !== proofDigest))) {
              throw figureProviderAttemptLedgerError();
            }
            return dispatch;
          });
          let write = false;
          for (const dispatch of candidates) {
            if (!dispatch.proofKind) {
              dispatch.proofKind = proofKind;
              dispatch.proofDigest = proofDigest;
              write = true;
            }
          }
          if (write) operation.lastTouchedAt = now;
          return { write, value: {
            immutableLimit: operation.immutableLimit,
            reservedAttempts: operation.reservedAttempts,
            preparedAttempts: candidates.length,
            proofKind,
            proofDigest
          } };
        });
      },

      async sealRespondedAttempts(
        input, consumedAttemptsInput = [], continuationDigestInput = '', proofInput = null
      ) {
        const binding = normalizeBinding(input, true);
        if (!Array.isArray(consumedAttemptsInput) ||
            consumedAttemptsInput.length > FIGURE_PROVIDER_ATTEMPT_HARD_LIMIT) {
          throw figureProviderAttemptLedgerError();
        }
        const consumedAttempts = consumedAttemptsInput.map(source => {
          const attemptNumber = Number(source?.attemptNumber);
          const dispatchDigest = typeof source?.dispatchDigest === 'string'
            ? source.dispatchDigest : '';
          if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1 ||
              !/^[a-f0-9]{64}$/u.test(dispatchDigest)) {
            throw figureProviderAttemptLedgerError();
          }
          return { attemptNumber, dispatchDigest };
        });
        if (new Set(consumedAttempts.map(entry => entry.attemptNumber)).size !==
            consumedAttempts.length) {
          throw figureProviderAttemptLedgerError();
        }
        const continuationDigest = typeof continuationDigestInput === 'string'
          ? continuationDigestInput : '';
        if (continuationDigest && !/^[a-f0-9]{64}$/u.test(continuationDigest)) {
          throw figureProviderAttemptLedgerError();
        }
        const proofKind = ['checkpoint', 'cache'].includes(proofInput?.kind)
          ? proofInput.kind : '';
        const proofDigest = typeof proofInput?.digest === 'string'
          ? proofInput.digest : '';
        if (!proofKind || !/^[a-f0-9]{64}$/u.test(proofDigest)) {
          throw figureProviderAttemptLedgerError();
        }
        return mutate((envelope, now) => {
          const operation = findOperation(envelope, binding.operationId);
          if (!operation) return { error: figureProviderAttemptLedgerError() };
          ensureOwnerAuthority(envelope, binding.ownerScope, now, { allowCreate: false });
          if (!validateOperationBinding(operation, binding)) {
            return { error: logicalError('FIGURE_PROVIDER_ATTEMPT_LIMIT', operation) };
          }
          const candidates = consumedAttempts.map(consumed => {
            const dispatch = operation.providerDispatches.find(entry =>
              entry.attemptNumber === consumed.attemptNumber
            );
            if (!dispatch || dispatch.receipt !== binding.receipt ||
                dispatch.requestSignature !== binding.requestSignature ||
                dispatch.dispatchDigest !== consumed.dispatchDigest ||
                dispatch.status !== 'responded' ||
                dispatch.proofKind !== proofKind ||
                dispatch.proofDigest !== proofDigest) {
              throw figureProviderAttemptLedgerError();
            }
            return dispatch;
          });
          const outerReceipt = operation.receipts.find(entry =>
            entry.receipt === binding.receipt &&
            entry.requestSignature === binding.requestSignature
          );
          if (!outerReceipt || outerReceipt.status !== 'claimed') {
            return { error: logicalError('FIGURE_REQUEST_RECEIPT_MISMATCH', operation) };
          }
          if (!candidates.length) {
            const advancesContinuation = continuationDigest &&
              outerReceipt.continuationDigest !== continuationDigest;
            if (advancesContinuation) {
              outerReceipt.continuationDigest = continuationDigest;
              outerReceipt.continuationConsumed = false;
              operation.lastTouchedAt = now;
            }
            return { write: Boolean(advancesContinuation), value: {
              immutableLimit: operation.immutableLimit,
              reservedAttempts: operation.reservedAttempts,
              sealedAttempts: 0
            } };
          }
          for (const dispatch of candidates) {
            dispatch.status = 'sealed';
            dispatch.proofKind = '';
            dispatch.proofDigest = '';
          }
          if (continuationDigest) {
            outerReceipt.continuationDigest = continuationDigest;
            outerReceipt.continuationConsumed = false;
          }
          operation.lastTouchedAt = now;
          return { write: true, value: {
            immutableLimit: operation.immutableLimit,
            reservedAttempts: operation.reservedAttempts,
            sealedAttempts: candidates.length
          } };
        });
      },

      async terminate(input, code) {
        const binding = normalizeBinding(input, false);
        const terminalCode = [
          'CANCELLED', 'REQUEST_TIMEOUT', 'FIGURE_PROVIDER_ATTEMPT_LIMIT',
          'FIGURE_REQUEST_REPLAY_AMBIGUOUS'
        ].includes(code) ? code : 'FIGURE_PROVIDER_ATTEMPT_LIMIT';
        return mutate((envelope, now) => {
          const operation = findOperation(envelope, binding.operationId);
          if (!operation) return { error: figureProviderAttemptLedgerError() };
          ensureOwnerAuthority(envelope, binding.ownerScope, now, { allowCreate: false });
          if (!validateOperationBinding(operation, binding)) {
            operation.terminalCode = 'FIGURE_PROVIDER_ATTEMPT_LIMIT';
          } else if (!operation.terminalCode && operation.releasedAt === 0) {
            operation.terminalCode = terminalCode;
          }
          operation.lastTouchedAt = now;
          return {
            write: true,
            value: {
              immutableLimit: operation.immutableLimit,
              reservedAttempts: operation.reservedAttempts,
              terminalCode: operation.terminalCode
            }
          };
        });
      },

      async controlOperation(input, command) {
        const operationId = typeof input?.operationId === 'string'
          ? input.operationId : '';
        const publicOperationId = typeof input?.publicOperationId === 'string'
          ? shared.normalizeOperationId?.(input.publicOperationId) || ''
          : operationId;
        if (!/^figure:[a-f0-9]{64}$/u.test(operationId) ||
            !publicOperationId ||
            !['cancel', 'release', 'status'].includes(command)) {
          throw figureProviderAttemptLedgerError();
        }
        const ownerScope = normalizeOwnerScope(input?.ownerScope, { optional: true });
        return mutate((envelope, now) => {
          const conflictingOwner = [...envelope.operations, ...envelope.pendingControls]
            .find(entry => entry.publicOperationId === publicOperationId &&
              (entry.operationId !== operationId ||
                !ownerScopeMatches(entry.ownerScope, ownerScope)));
          if (conflictingOwner) {
            return { error: ownerAuthorityError(
              envelope.operations.includes(conflictingOwner) ? conflictingOwner : null
            ) };
          }
          const authority = ensureOwnerAuthority(envelope, ownerScope, now, {
            allowCreate: command !== 'status'
          });
          const operation = findOperation(envelope, operationId);
          if (!operation) {
            const pending = envelope.pendingControls.find(entry =>
              entry.operationId === operationId
            );
            if (command === 'status') {
              return { value: {
                active: false,
                cancelled: pending?.command === 'cancel',
                released: pending?.command === 'release'
              } };
            }
            if (!pending && envelope.operations.length + envelope.pendingControls.length >=
                FIGURE_RECEIPT_CAPACITY) {
              return { error: logicalError('FIGURE_REQUEST_RECEIPT_CAPACITY') };
            }
            if (pending) {
              if (command === 'cancel') pending.command = 'cancel';
              pending.lastTouchedAt = now;
            } else {
              envelope.pendingControls.push({
                operationId, publicOperationId, command, ownerScope, lastTouchedAt: now
              });
            }
            const terminalCommand = command === 'cancel' || pending?.command === 'cancel'
              ? 'cancel' : 'release';
            return {
              write: true,
              value: {
                active: false,
                cancelled: terminalCommand === 'cancel',
                released: terminalCommand === 'release',
                cleanupComplete: true,
                requestedCommand: terminalCommand,
                terminalCode: terminalCommand === 'cancel' ? 'CANCELLED' : ''
              }
            };
          }
          if (!ownerScopeMatches(operation.ownerScope, ownerScope)) {
            return { error: ownerAuthorityError(operation) };
          }
          if (command === 'status') {
            return { value: {
              active: !operation.terminalCode && operation.releasedAt === 0,
              cancelled: operation.terminalCode === 'CANCELLED',
              released: operation.releasedAt > 0,
              immutableLimit: operation.immutableLimit,
              reservedAttempts: operation.reservedAttempts
            } };
          }
          if (command === 'cancel' && !operation.terminalCode && operation.releasedAt === 0) {
            operation.terminalCode = 'CANCELLED';
          }
          // Cleanup acknowledgement is independent of the provider terminal.
          // A response-lost/timeout quarantine must remain authoritative, but
          // exact-owner teardown still needs an idempotent ACK so the caller
          // can clear its durable cleanup intent.  Release records its own
          // durable commit point without rewriting that terminal; cancel can
          // be acknowledged deterministically on every replay while likewise
          // preserving the original terminal code and dispatch receipts.
          if (command === 'release' && operation.releasedAt === 0) {
            operation.releasedAt = now;
          }
          operation.lastTouchedAt = now;
          return {
            write: true,
            value: {
              active: false,
              cancelled: command === 'cancel' || operation.terminalCode === 'CANCELLED',
              released: operation.releasedAt > 0,
              cleanupComplete: true,
              requestedCommand: command,
              terminalCode: operation.terminalCode,
              immutableLimit: operation.immutableLimit,
              reservedAttempts: operation.reservedAttempts
            }
          };
        });
      },

      async advanceWorkspaceLifecycle(input) {
        const ownerScope = normalizeOwnerScope(input?.ownerScope, { optional: false });
        const previous = input?.previousWorkspaceLifecycle;
        if (!ownerScope || !Number.isSafeInteger(previous) || previous < 0 ||
            ownerScope.workspaceLifecycle !== previous + 1) {
          throw figureProviderAttemptLedgerError();
        }
        return mutate((envelope, now) => {
          const tab = envelope.ownerTabs.find(entry => ownerTabMatches(entry, ownerScope));
          const document = envelope.ownerDocuments.find(entry =>
            ownerDocumentMatches(entry, ownerScope));
          const value = { workspaceLifecycle: ownerScope.workspaceLifecycle,
            removedOperationIds: [] };
          // Bootstrap transitions carry no authority. First authenticated bind
          // still creates the owner at the document's then-current lifecycle.
          if (!tab) return { value: { ...value, ignored: true } };
          if (tab.retired || !document ||
              document.senderDocumentId !== ownerScope.senderDocumentId ||
              document.navigationGeneration !== tab.navigationGeneration) {
            throw ownerAuthorityError();
          }
          if (document.workspaceLifecycle === null) return { value };
          if (document.workspaceLifecycle === ownerScope.workspaceLifecycle) {
            return { value }; // retry after a lost acknowledgement
          }
          if (document.workspaceLifecycle !== previous) throw ownerAuthorityError();
          document.workspaceLifecycle = ownerScope.workspaceLifecycle;
          tab.lastTouchedAt = document.lastTouchedAt = now;
          value.removedOperationIds = removeOwnerOperations(envelope, scope =>
            ownerDocumentMatches(scope, ownerScope) &&
            scope.senderDocumentId === ownerScope.senderDocumentId &&
            scope.workspaceLifecycle !== ownerScope.workspaceLifecycle);
          return { write: true, value };
        });
      },

      async commitTrustedDocument(input) {
        const trusted = normalizeTrustedDocumentInput(input);
        return mutate((envelope, now) => {
          let tab = envelope.ownerTabs.find(entry => ownerTabMatches(entry, trusted)) || null;
          let document = envelope.ownerDocuments.find(entry =>
            ownerDocumentMatches(entry, trusted)
          ) || null;
          const sameDocument = Boolean(
            tab && !tab.retired && document &&
            document.senderDocumentId === trusted.senderDocumentId &&
            document.navigationGeneration === tab.navigationGeneration
          );
          if (sameDocument) {
            tab.lastTouchedAt = now;
            document.lastTouchedAt = now;
            return { write: true, value: { removedOperationIds: [], sameDocument: true } };
          }
          if (!tab) {
            // Browser navigation events are extension-wide and include tabs
            // that have never started Figure work. They must not manufacture
            // permanent owner tombstones. The first authenticated Figure bind
            // is the sole authority-creation point; a later navigation merely
            // advances an owner that already exists.
            return { value: {
              removedOperationIds: [], sameDocument: false, ignored: true
            } };
          } else if (tab.retired) {
            return { error: ownerAuthorityError() };
          } else if (trusted.senderFrameId === 0) {
            if (!Number.isSafeInteger(tab.navigationGeneration + 1)) {
              return { error: figureProviderAttemptLedgerError() };
            }
            tab.navigationGeneration += 1;
            tab.retired = false;
            tab.lastTouchedAt = now;
          }
          if (!document) {
            if (envelope.ownerDocuments.length >= FIGURE_OWNER_AUTHORITY_CAPACITY) {
              return { error: logicalError('FIGURE_REQUEST_RECEIPT_CAPACITY') };
            }
            document = {
              senderExtensionId: trusted.senderExtensionId,
              senderTabId: trusted.senderTabId,
              senderFrameId: trusted.senderFrameId,
              senderDocumentId: trusted.senderDocumentId,
              navigationGeneration: tab.navigationGeneration,
              workspaceLifecycle: null,
              lastTouchedAt: now
            };
            envelope.ownerDocuments.push(document);
          } else {
            document.senderDocumentId = trusted.senderDocumentId;
            document.navigationGeneration = tab.navigationGeneration;
            document.workspaceLifecycle = null;
            document.lastTouchedAt = now;
          }
          if (trusted.senderFrameId === 0) {
            envelope.ownerDocuments = envelope.ownerDocuments.filter(entry =>
              !ownerTabMatches(entry, trusted) || entry.senderFrameId === 0
            );
          }
          const removedOperationIds = removeOwnerOperations(envelope, scope =>
            ownerTabMatches(scope, trusted) &&
            (trusted.senderFrameId === 0 || scope.senderFrameId === trusted.senderFrameId)
          );
          return {
            write: true,
            value: { removedOperationIds, sameDocument: false }
          };
        });
      },

      async retireTrustedTab(input) {
        const trusted = normalizeTrustedDocumentInput(input, { tabOnly: true });
        return mutate((envelope, now) => {
          const existingTab = envelope.ownerTabs.find(entry =>
            ownerTabMatches(entry, trusted)
          ) || null;
          const ownsDurableWork = envelope.operations.some(entry =>
            ownerTabMatches(entry.ownerScope, trusted)
          ) || envelope.pendingControls.some(entry =>
            ownerTabMatches(entry.ownerScope, trusted)
          ) || envelope.ownerDocuments.some(entry =>
            ownerTabMatches(entry, trusted)
          );
          if (!existingTab && !ownsDurableWork) {
            return { value: { removedOperationIds: [], ignored: true } };
          }
          let retirement = envelope.pendingTabRetirements.find(entry =>
            ownerTabMatches(entry, trusted)
          ) || null;
          if (!retirement) {
            if (envelope.pendingTabRetirements.length >=
                FIGURE_OWNER_AUTHORITY_CAPACITY) {
              return { error: logicalError('FIGURE_REQUEST_RECEIPT_CAPACITY') };
            }
            retirement = {
              senderExtensionId: trusted.senderExtensionId,
              senderTabId: trusted.senderTabId,
              lastTouchedAt: now
            };
            envelope.pendingTabRetirements.push(retirement);
          } else {
            retirement.lastTouchedAt = now;
          }
          let tab = existingTab;
          if (!tab) {
            if (envelope.ownerTabs.length >= FIGURE_OWNER_AUTHORITY_CAPACITY) {
              return { error: logicalError('FIGURE_REQUEST_RECEIPT_CAPACITY') };
            }
            tab = {
              senderExtensionId: trusted.senderExtensionId,
              senderTabId: trusted.senderTabId,
              navigationGeneration: 1,
              retired: true,
              lastTouchedAt: now
            };
            envelope.ownerTabs.push(tab);
          } else if (!tab.retired) {
            if (!Number.isSafeInteger(tab.navigationGeneration + 1)) {
              return { error: figureProviderAttemptLedgerError() };
            }
            tab.navigationGeneration += 1;
            tab.retired = true;
            tab.lastTouchedAt = now;
          } else {
            tab.lastTouchedAt = now;
          }
          envelope.ownerDocuments = envelope.ownerDocuments.filter(entry =>
            !ownerTabMatches(entry, trusted)
          );
          const removedOperationIds = removeOwnerOperations(envelope, scope =>
            ownerTabMatches(scope, trusted)
          );
          return { write: true, value: { removedOperationIds } };
        });
      },

      async listPendingTabRetirements() {
        return mutate(envelope => ({
          value: envelope.pendingTabRetirements.map(entry => ({
            senderExtensionId: entry.senderExtensionId,
            senderTabId: entry.senderTabId
          }))
        }));
      },

      async confirmTrustedTabRetirement(input) {
        const trusted = normalizeTrustedDocumentInput(input, { tabOnly: true });
        return mutate(envelope => {
          const before = envelope.pendingTabRetirements.length;
          envelope.pendingTabRetirements = envelope.pendingTabRetirements.filter(entry =>
            !ownerTabMatches(entry, trusted)
          );
          return {
            write: envelope.pendingTabRetirements.length !== before,
            value: { confirmed: true }
          };
        });
      }
    };
  }

  function deriveFigureProviderAttemptBudget(options = {}) {
    const sourceFigures = Array.isArray(options.figures)
      ? options.figures.slice(0, 50) : [];
    if (!['standard', 'deep'].includes(options.analysisDepth)) {
      throw invalidSettings(['analysisDepth']);
    }
    const analysisDepth = options.analysisDepth;
    const allowTextFallback = options.allowTextFallback === true;
    const manualTokenPolicy = options.tokenPolicyMode === 'manual';
    const requestedTruncationRetries = Number(options.truncationRetries);
    const truncationRetries = manualTokenPolicy ? 0 : Math.max(0, Math.min(
      FIGURE_MAX_TRUNCATION_RETRIES,
      Number.isFinite(requestedTruncationRetries)
        ? Math.floor(requestedTruncationRetries)
        : FIGURE_DEFAULT_TRUNCATION_RETRIES
    ));
    // One managed request may first lower a rejected token limit once and then
    // expand a truncated automatic budget. requestFigureJson adds at most three
    // transport attempts, and requestValidated adds one schema-repair pass.
    const managedRequestAttempts = 1 + 1 + truncationRetries;
    const requestAttempts = managedRequestAttempts * FIGURE_REQUEST_OUTER_ATTEMPTS;
    const validatedRequestAttempts = requestAttempts * FIGURE_SCHEMA_PASSES;
    const recoveryRequestAttempts = requestAttempts;
    let panelBatchCount = 0;
    let topologyLimit = 0;
    for (const entry of sourceFigures) {
      const panelCount = Math.max(0, Math.min(
        30, Math.floor(Number(entry?.panelCount) || 0)
      ));
      if (!panelCount) {
        panelBatchCount += 1;
        topologyLimit += validatedRequestAttempts * (allowTextFallback ? 2 : 1);
        continue;
      }
      if ((analysisDepth !== 'deep' && panelCount <= FIGURE_STANDARD_WHOLE_PANEL_LIMIT) ||
          (analysisDepth === 'deep' && panelCount <= 2)) {
        panelBatchCount += 1;
        const recoveryBatches = Math.ceil(panelCount / FIGURE_PANEL_RECOVERY_BATCH_SIZE);
        const wholeRecoveryAndSynthesis = (2 * validatedRequestAttempts) +
          recoveryBatches * recoveryRequestAttempts * (allowTextFallback ? 2 : 1);
        // Caption-only Figures can fall back from a whole response to compact
        // Panel extraction plus synthesis. With visual fallback enabled, the
        // failed visual whole pass is also part of the same topology.
        const compactFallback = validatedRequestAttempts *
          (allowTextFallback ? 4 : 3);
        topologyLimit += Math.max(wholeRecoveryAndSynthesis, compactFallback);
        continue;
      }
      const batchSize = analysisDepth === 'deep' ? 2 : FIGURE_STANDARD_PANEL_BATCH_SIZE;
      const batches = Math.ceil(panelCount / batchSize);
      panelBatchCount += batches;
      const perBatch = Math.max(
        validatedRequestAttempts * (allowTextFallback ? 2 : 1),
        validatedRequestAttempts +
          Math.ceil(batchSize / FIGURE_PANEL_RECOVERY_BATCH_SIZE) *
            recoveryRequestAttempts * (allowTextFallback ? 2 : 1)
      );
      topologyLimit += batches * perBatch + validatedRequestAttempts;
    }
    topologyLimit = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, topologyLimit));
    return Object.freeze({
      managedRequestAttempts,
      requestAttempts,
      validatedRequestAttempts,
      recoveryRequestAttempts,
      panelBatchCount,
      topologyLimit,
      limit: Math.min(FIGURE_PROVIDER_ATTEMPT_HARD_LIMIT, topologyLimit)
    });
  }

  const LLM_TASK_DISPATCH = Object.freeze([
    ['LLM_ANALYZE_DOCUMENT', 'primary', 'document_highlight'],
    ['LLM_SEMANTIC_FIND', 'default', 'semantic_find'],
    ['LLM_ANALYZE_DOCUMENT', 'evidence_ledger', 'evidence_ledger_review'],
    ['LLM_ANALYZE_REVIEW_OUTLINE', 'paragraph', 'paragraph_summary'],
    ['LLM_ANALYZE_REVIEW_OUTLINE', 'outline', 'article_outline_summary'],
    ['LLM_TRANSLATE_ABBREVIATIONS', 'default', 'abbreviation_translation'],
    ['LLM_ANALYZE_FIGURES', 'default', 'figure_walkthrough'],
    ['LLM_ANALYZE_FIGURE_PANEL', 'default', 'figure_panel_interpretation'],
    ['LLM_ASK_FIGURE_PANEL', 'default', 'figure_panel_followup'],
    ['LLM_ANALYZE_CROSS_FIGURE_LOGIC', 'default', 'cross_figure_mechanism'],
    ['LLM_ANALYZE_RESEARCH_LOGIC', 'default', 'paper_research_logic'],
    ['LLM_ANALYZE_PAPER_INNOVATION', 'default', 'paper_innovations'],
    ['LLM_ANALYZE_PAPER_LIMITATIONS', 'default', 'paper_limitations'],
    ['LLM_AUTOFILL_LITERATURE_NOTE', 'default', 'literature_note_autofill'],
    ['LLM_ASK_ARTICLE', 'article', 'article_chat'],
    ['LLM_ASK_ARTICLE', 'selection', 'selection_chat']
  ].map(([messageType, branch, taskId]) => Object.freeze({
    messageType, branch, taskId
  })));
  const LLM_TASK_DISPATCH_BY_KEY = new Map(LLM_TASK_DISPATCH.map(entry => [
    `${entry.messageType}:${entry.branch}`, entry.taskId
  ]));
  const FIGURE_ROUTE_PREFLIGHT_TASK_IDS = new Set([
    'figure_walkthrough', 'figure_panel_interpretation', 'figure_panel_followup'
  ]);
  const VISUAL_TEXT_FALLBACK_REASONS = Object.freeze({
    PROVIDER_REJECTED: 'provider_rejected_pixels',
    INVALID_RESPONSE: 'invalid_visual_response',
    CONTEXT_BUDGET_EXCEEDED: 'visual_context_capacity',
    TOKEN_LIMIT_REJECTED: 'visual_output_budget_rejected',
    OUTPUT_TRUNCATED: 'visual_output_truncated'
  });
  const SAFE_VISUAL_FALLBACK_REASONS = new Set(
    Object.values(VISUAL_TEXT_FALLBACK_REASONS)
  );
  const SAFE_PANEL_DEGRADATION_REASONS = new Set([
    '',
    'vision_unavailable_or_no_image',
    'smaller_image_for_capacity',
    'text_only_for_capacity',
    ...SAFE_VISUAL_FALLBACK_REASONS
  ]);

  function visualTextFallbackReason(error) {
    return VISUAL_TEXT_FALLBACK_REASONS[String(error?.code || '')] || '';
  }

  function unknownLlmTask() {
    const error = new Error('UNKNOWN_LLM_TASK');
    error.code = 'UNKNOWN_LLM_TASK';
    return error;
  }

  function resolveLlmTaskId(messageType, branch) {
    const key = `${String(messageType || '')}:${String(branch || '')}`;
    const taskId = LLM_TASK_DISPATCH_BY_KEY.get(key);
    if (!taskId) throw unknownLlmTask();
    return shared.getLlmTaskDefinition(taskId).id;
  }

  function buildTaskPolicySignature(settings, taskId) {
    const definition = shared.getLlmTaskDefinition(taskId);
    const policy = settings?.taskPolicies?.[taskId];
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      throw invalidSettings([`taskPolicies.${taskId}`]);
    }
    const tokenRule = shared.normalizeTaskTokenRule(taskId, policy.tokenRule);
    return shared.stableHash({
      catalog: shared.taskPolicySignature(definition),
      policy: {
        mode: policy.mode,
        profileId: policy.profileId,
        reasoningEnabled: policy.reasoningEnabled === true,
        reasoningEffort: policy.reasoningEffort,
        tokenRule,
        allowTextFallback: policy.allowTextFallback === true
      }
    });
  }

  function taskRuntimeClass(taskId) {
    shared.getLlmTaskDefinition(taskId);
    return TASK_RUNTIME_CLASSES[taskId];
  }
  // Mechanism edge batches are evidence-independent once the shared vocabulary
  // has been validated. Two workers cut complex-paper latency without turning
  // one user action into an unbounded provider burst.
  const MECHANISM_EDGE_BATCH_CONCURRENCY =
    EVIDENCE_FIRST_POLICY?.maxInFlightProviderRequests || 2;
  const PREFERENCE_KEYS = new Set([
    'mode', 'language', 'providerId', 'consentGranted', 'autoAnalyze',
    'autoCacheFigureImages', 'saveArticleWebSnapshot',
    'selectedCategoryIds',
    'confidenceThreshold', 'readingViewId', 'viewCategoryOverrides',
    'analysisModes', 'figurePanelHeaderFields',
    'figurePanelFollowupPrompts', 'figurePanelFollowupPresets',
    'articleChatQuickPrompts', 'literatureNoteTemplates',
    'lastLiteratureNoteTemplateId', 'selectionLlmActions',
    'keyboardShortcuts'
  ]);
  const PORTABLE_CONFIG_ERROR_CODES = new Set([
    'PORTABLE_CONFIG_FAILED',
    'PORTABLE_CONFIG_ALREADY_EXISTS', 'PORTABLE_CONFIG_BACKUP_AUTH_FAILED',
    'PORTABLE_CONFIG_BACKUP_DIVERGED', 'PORTABLE_CONFIG_BACKUP_FAILED',
    'PORTABLE_CONFIG_BACKUP_SOURCE_MISSING', 'PORTABLE_CONFIG_CACHED_KEY_INVALID',
    'PORTABLE_CONFIG_CACHED_KEY_REJECTED', 'PORTABLE_CONFIG_CREATE_FAILED',
    'PORTABLE_CONFIG_CREATED_KEY_CACHE_FAILED', 'PORTABLE_CONFIG_CRYPTO_UNAVAILABLE',
    'PORTABLE_CONFIG_DECRYPT_FAILED', 'PORTABLE_CONFIG_DIRECTORY_CONFLICT',
    'PORTABLE_CONFIG_DIRECTORY_UNAVAILABLE', 'PORTABLE_CONFIG_DIRECTORY_WRITE_FAILED',
    'PORTABLE_CONFIG_ENVELOPE_BACKUP_ID_INVALID',
    'PORTABLE_CONFIG_ENVELOPE_CIPHERTEXT_INVALID',
    'PORTABLE_CONFIG_ENVELOPE_ENCRYPTION_INVALID', 'PORTABLE_CONFIG_ENVELOPE_INVALID',
    'PORTABLE_CONFIG_ENVELOPE_KIND_INVALID', 'PORTABLE_CONFIG_ENVELOPE_REVISION_INVALID',
    'PORTABLE_CONFIG_ENVELOPE_SCHEMA_VERSION_INVALID', 'PORTABLE_CONFIG_ENVELOPE_UNSAFE',
    'PORTABLE_CONFIG_ENVELOPE_UPDATED_AT_INVALID', 'PORTABLE_CONFIG_INVALID_BASE64',
    'PORTABLE_CONFIG_INVALID_BINARY', 'PORTABLE_CONFIG_KDF_ITERATIONS',
    'PORTABLE_CONFIG_KDF_SALT_INVALID', 'PORTABLE_CONFIG_KEY_INVALID',
    'PORTABLE_CONFIG_LOCKED', 'PORTABLE_CONFIG_MANAGER_DISPOSED',
    'PORTABLE_CONFIG_MANAGER_INVALID_DEPENDENCIES', 'PORTABLE_CONFIG_MISSING',
    'PORTABLE_CONFIG_NOT_READY', 'PORTABLE_CONFIG_PASSPHRASE_TOO_SHORT',
    'PORTABLE_CONFIG_PAYLOAD_GLOBAL_ABBREVIATIONS_INVALID',
    'PORTABLE_CONFIG_PAYLOAD_INVALID', 'PORTABLE_CONFIG_PAYLOAD_KIND_INVALID',
    'PORTABLE_CONFIG_PAYLOAD_SCHEMA_VERSION_INVALID',
    'PORTABLE_CONFIG_PAYLOAD_SETTINGS_INVALID', 'PORTABLE_CONFIG_PROBE_FAILED',
    'PORTABLE_CONFIG_REQUIRES_CAS', 'PORTABLE_CONFIG_RESTORE_FAILED',
    'PORTABLE_CONFIG_ROTATE_FAILED', 'PORTABLE_CONFIG_SCHEMA_UNAVAILABLE',
    'PORTABLE_CONFIG_STORAGE_FAILED', 'PORTABLE_CONFIG_UNLOCK_FAILED'
  ]);

  const PROVIDER_SETTINGS_MESSAGE = 'Provider settings are incomplete or invalid';
  const LOCAL_INPUT_MESSAGE = 'The request contains invalid or unsupported input';
  const TRUSTED_INVALID_SETTINGS_MESSAGE = Symbol('trustedInvalidSettingsMessage');

  function boundedInvalidSettingsFields(fields) {
    const seen = new Set();
    return (Array.isArray(fields) ? fields : []).map(field => String(field || '')
      .normalize('NFKC').replace(/[^A-Za-z0-9_.\[\]-]/g, '').slice(0, 120))
      .filter(field => field && !seen.has(field) && Boolean(seen.add(field)))
      .slice(0, 24);
  }

  function boundedUserMessage(message, fallback) {
    return String(message || fallback).normalize('NFKC').replace(/\s+/g, ' ').trim()
      .slice(0, 240) || fallback;
  }

  function invalidSettings(fields, message = LOCAL_INPUT_MESSAGE) {
    const error = new Error(message);
    error.code = 'INVALID_SETTINGS';
    error.fields = boundedInvalidSettingsFields(fields);
    error.userMessage = boundedUserMessage(message, LOCAL_INPUT_MESSAGE);
    error[TRUSTED_INVALID_SETTINGS_MESSAGE] = true;
    return error;
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function cloneJsonLike(value) {
    if (Array.isArray(value)) return value.map(cloneJsonLike);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, cloneJsonLike(nested)])
    );
  }

  function deepMergeJsonLike(base, override) {
    if (override === undefined) return cloneJsonLike(base);
    if (!isPlainObject(base) || !isPlainObject(override)) {
      return cloneJsonLike(override);
    }
    const merged = cloneJsonLike(base);
    Object.entries(override).forEach(([key, value]) => {
      merged[key] = Object.prototype.hasOwnProperty.call(base, key)
        ? deepMergeJsonLike(base[key], value)
        : cloneJsonLike(value);
    });
    return merged;
  }

  const FIGURE_RETRY_STAGING_PREFIX = 'internal/figure-retry-staging/';

  function isFigureRetryStagingPath(value) {
    return String(value || '').startsWith(FIGURE_RETRY_STAGING_PREFIX);
  }

  function figureRetryStagingPath(commitGuardId) {
    const guardId = String(commitGuardId || '');
    if (!/^figure-retry-guard-[a-z0-9-]{8,100}$/iu.test(guardId)) {
      const error = new Error('FIGURE_COMMIT_GUARD_UNAVAILABLE');
      error.code = 'FIGURE_COMMIT_GUARD_UNAVAILABLE';
      throw error;
    }
    return `${FIGURE_RETRY_STAGING_PREFIX}${guardId}.json`;
  }

  function jsonLikeEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) && Array.isArray(right)) {
      return left.length === right.length && left.every((item, index) =>
        jsonLikeEqual(item, right[index]));
    }
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] &&
        jsonLikeEqual(left[key], right[key]));
  }

  function jsonLikeByteSize(value) {
    try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
    catch (_) { return 0; }
  }

  function boundedOpaqueDigest(value, seed) {
    const text = String(value || '');
    let hash = seed >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function pendingFigureRetryStages(records, targetPath) {
    return records.filter(asset =>
      isFigureRetryStagingPath(asset?.relativePath) &&
      asset?.content?.kind === 'figure_retry_candidate' &&
      asset?.content?.status === 'pending_confirmation' &&
      String(asset?.content?.target?.relativePath || '') === targetPath &&
      isPlainObject(asset?.content?.base) &&
      isPlainObject(asset?.content?.candidate)
    ).sort((left, right) =>
      String(left.relativePath || '').localeCompare(String(right.relativePath || '')));
  }

  function workspaceWriteToken(targetPath, rawAsset, pendingStages) {
    if (!rawAsset || !pendingStages.length) return '';
    const boundedReceipts = pendingStages.map(asset => [
      String(asset.relativePath || '').slice(0, 500),
      Number(asset.revision || 0),
      String(asset.contentHash || '').slice(0, 300)
    ]);
    const material = JSON.stringify([
      String(targetPath || '').slice(0, 500),
      Number(rawAsset.revision || 0),
      String(rawAsset.contentHash || '').slice(0, 300),
      boundedReceipts
    ]);
    return `workspace-write-v1-${boundedOpaqueDigest(material, 2166136261)}` +
      boundedOpaqueDigest(material, 3339675911);
  }

  function figureRetryWriteSnapshot(records, targetPath) {
    const rawRecords = Array.isArray(records) ? records : [];
    const rawAsset = rawRecords.find(asset =>
      !isFigureRetryStagingPath(asset?.relativePath) &&
      String(asset?.relativePath || '') === targetPath) || null;
    const pendingStages = pendingFigureRetryStages(rawRecords, targetPath);
    const projectedAsset = publicWorkspaceAssets(rawRecords).find(asset =>
      String(asset?.relativePath || '') === targetPath) || null;
    return {
      rawAsset,
      pendingStages,
      projectedAsset,
      writeToken: workspaceWriteToken(targetPath, rawAsset, pendingStages)
    };
  }

  const SEQUENCE_ID_KEYS = Object.freeze([
    'id', 'figureId', 'panelId', 'displayId', 'blockId', 'edgeId', 'nodeId',
    'turnId', 'materialId', 'key', 'name'
  ]);

  function sequenceIdentity(value) {
    if (!isPlainObject(value)) {
      return `${typeof value}:${JSON.stringify(value)}`;
    }
    for (const key of SEQUENCE_ID_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const identity = value[key];
      if (typeof identity === 'string' || typeof identity === 'number') {
        return `object:${key}:${String(identity)}`;
      }
    }
    return null;
  }

  function sequenceItemsMatch(left, right) {
    if (jsonLikeEqual(left, right)) return true;
    const leftIdentity = sequenceIdentity(left);
    const rightIdentity = sequenceIdentity(right);
    return Boolean(leftIdentity && rightIdentity && leftIdentity === rightIdentity);
  }

  function sequenceLcsPairs(left, right) {
    if (left.length > 4096 || right.length > 4096 ||
        left.length * right.length > 1_000_000) {
      const pairs = [];
      let rightIndex = 0;
      for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
        let matchedIndex = -1;
        for (let cursor = rightIndex; cursor < right.length; cursor += 1) {
          if (sequenceItemsMatch(left[leftIndex], right[cursor])) {
            matchedIndex = cursor;
            break;
          }
        }
        if (matchedIndex < 0) continue;
        pairs.push([leftIndex, matchedIndex]);
        rightIndex = matchedIndex + 1;
      }
      return pairs;
    }
    const rows = left.length + 1;
    const columns = right.length + 1;
    const table = Array.from({ length: rows }, () => new Uint16Array(columns));
    for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
      for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
        table[leftIndex][rightIndex] = sequenceItemsMatch(
          left[leftIndex], right[rightIndex]
        ) ? table[leftIndex + 1][rightIndex + 1] + 1
          : Math.max(table[leftIndex + 1][rightIndex], table[leftIndex][rightIndex + 1]);
      }
    }
    const pairs = [];
    let leftIndex = 0;
    let rightIndex = 0;
    while (leftIndex < left.length && rightIndex < right.length) {
      if (sequenceItemsMatch(left[leftIndex], right[rightIndex])) {
        pairs.push([leftIndex, rightIndex]);
        leftIndex += 1;
        rightIndex += 1;
      } else if (table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1]) {
        leftIndex += 1;
      } else {
        rightIndex += 1;
      }
    }
    return pairs;
  }

  function sequenceInsertionsBefore(sequence, baseLength, pairs) {
    const before = Array.from({ length: baseLength + 1 }, () => []);
    let sequenceIndex = 0;
    for (const [baseIndex, matchedIndex] of pairs) {
      while (sequenceIndex < matchedIndex) {
        before[baseIndex].push(sequence[sequenceIndex]);
        sequenceIndex += 1;
      }
      sequenceIndex = matchedIndex + 1;
    }
    while (sequenceIndex < sequence.length) {
      before[baseLength].push(sequence[sequenceIndex]);
      sequenceIndex += 1;
    }
    return before;
  }

  function mergeSequenceInsertions(candidateItems, currentItems) {
    const pairs = sequenceLcsPairs(candidateItems, currentItems);
    const merged = [];
    let candidateIndex = 0;
    let currentIndex = 0;
    for (const [matchedCandidate, matchedCurrent] of pairs) {
      while (currentIndex < matchedCurrent) {
        merged.push(cloneJsonLike(currentItems[currentIndex++]));
      }
      while (candidateIndex < matchedCandidate) {
        merged.push(cloneJsonLike(candidateItems[candidateIndex++]));
      }
      merged.push(rebaseFigureRetryCandidate(
        undefined, candidateItems[matchedCandidate], currentItems[matchedCurrent]
      ));
      candidateIndex = matchedCandidate + 1;
      currentIndex = matchedCurrent + 1;
    }
    while (currentIndex < currentItems.length) {
      merged.push(cloneJsonLike(currentItems[currentIndex++]));
    }
    while (candidateIndex < candidateItems.length) {
      merged.push(cloneJsonLike(candidateItems[candidateIndex++]));
    }
    return merged;
  }

  function mergeSequenceByBase(base, candidate, current) {
    const candidatePairs = sequenceLcsPairs(base, candidate);
    const currentPairs = sequenceLcsPairs(base, current);
    const candidateByBase = new Map(candidatePairs);
    const currentByBase = new Map(currentPairs);
    const candidateBefore = sequenceInsertionsBefore(
      candidate, base.length, candidatePairs
    );
    const currentBefore = sequenceInsertionsBefore(
      current, base.length, currentPairs
    );
    const merged = [];
    for (let baseIndex = 0; baseIndex <= base.length; baseIndex += 1) {
      merged.push(...mergeSequenceInsertions(
        candidateBefore[baseIndex], currentBefore[baseIndex]
      ));
      if (baseIndex === base.length) break;
      const candidateIndex = candidateByBase.get(baseIndex);
      const currentIndex = currentByBase.get(baseIndex);
      if (candidateIndex === undefined) {
        if (currentIndex !== undefined &&
            !jsonLikeEqual(current[currentIndex], base[baseIndex])) {
          merged.push(cloneJsonLike(current[currentIndex]));
        }
        continue;
      }
      if (currentIndex === undefined) continue;
      merged.push(rebaseFigureRetryCandidate(
        base[baseIndex], candidate[candidateIndex], current[currentIndex]
      ));
    }
    return merged;
  }

  function mergeChangedSequenceSegment(base, candidate, current) {
    if (base.length === candidate.length && candidate.length === current.length) {
      return base.map((item, index) => rebaseFigureRetryCandidate(
        item, candidate[index], current[index]
      ));
    }
    return mergeSequenceByBase(base, candidate, current);
  }

  // Apply only the retry-owned delta (base -> candidate) to the latest asset.
  // Any concurrent value that no longer equals the base wins. This includes
  // explicit human/humanReviewed edits without needing to know Figure internals.
  function rebaseFigureRetryCandidate(base, candidate, current) {
    if (jsonLikeEqual(candidate, base)) return cloneJsonLike(current);
    if (jsonLikeEqual(current, base)) return cloneJsonLike(candidate);
    if (isPlainObject(current) && current.humanReviewed === true) {
      return cloneJsonLike(current);
    }
    if (Array.isArray(base) && Array.isArray(candidate) && Array.isArray(current)) {
      const candidatePairs = sequenceLcsPairs(base, candidate);
      const currentPairs = sequenceLcsPairs(base, current);
      const candidateByBase = new Map(candidatePairs);
      const currentByBase = new Map(currentPairs);
      const commonAnchors = [...candidateByBase.keys()]
        .filter(baseIndex => currentByBase.has(baseIndex));
      if (!commonAnchors.length) {
        return mergeChangedSequenceSegment(base, candidate, current);
      }
      const merged = [];
      let previousBase = -1;
      let previousCandidate = -1;
      let previousCurrent = -1;
      for (const baseIndex of commonAnchors) {
        const candidateIndex = candidateByBase.get(baseIndex);
        const currentIndex = currentByBase.get(baseIndex);
        merged.push(...mergeChangedSequenceSegment(
          base.slice(previousBase + 1, baseIndex),
          candidate.slice(previousCandidate + 1, candidateIndex),
          current.slice(previousCurrent + 1, currentIndex)
        ));
        merged.push(rebaseFigureRetryCandidate(
          base[baseIndex], candidate[candidateIndex], current[currentIndex]
        ));
        previousBase = baseIndex;
        previousCandidate = candidateIndex;
        previousCurrent = currentIndex;
      }
      merged.push(...mergeChangedSequenceSegment(
        base.slice(previousBase + 1),
        candidate.slice(previousCandidate + 1),
        current.slice(previousCurrent + 1)
      ));
      return merged;
    }
    if (isPlainObject(base) && isPlainObject(candidate) && isPlainObject(current)) {
      const entries = [];
      const keys = new Set([
        ...Object.keys(base), ...Object.keys(candidate), ...Object.keys(current)
      ]);
      for (const key of keys) {
        const hasBase = Object.prototype.hasOwnProperty.call(base, key);
        const hasCandidate = Object.prototype.hasOwnProperty.call(candidate, key);
        const hasCurrent = Object.prototype.hasOwnProperty.call(current, key);
        if (!hasCandidate) {
          if (hasCurrent && (!hasBase || !jsonLikeEqual(current[key], base[key]))) {
            entries.push([key, cloneJsonLike(current[key])]);
          }
          continue;
        }
        if (!hasCurrent) {
          if (!hasBase) entries.push([key, cloneJsonLike(candidate[key])]);
          continue;
        }
        entries.push([key, rebaseFigureRetryCandidate(
          hasBase ? base[key] : undefined,
          candidate[key], current[key]
        )]);
      }
      return Object.fromEntries(entries);
    }
    return cloneJsonLike(current);
  }

  function publicWorkspaceAssets(rawAssets) {
    const records = Array.isArray(rawAssets) ? rawAssets.map(cloneJsonLike) : [];
    const rawVisible = new Map(records
      .filter(asset => !isFigureRetryStagingPath(asset?.relativePath))
      .map(asset => [String(asset.relativePath || ''), asset]));
    const visible = new Map(records
      .filter(asset => !isFigureRetryStagingPath(asset?.relativePath))
      .map(asset => [String(asset.relativePath || ''), asset]));
    const pending = records.filter(asset =>
      isFigureRetryStagingPath(asset?.relativePath) &&
      asset?.content?.kind === 'figure_retry_candidate' &&
      asset?.content?.status === 'pending_confirmation' &&
      isPlainObject(asset?.content?.base) &&
      isPlainObject(asset?.content?.candidate)
    ).sort((left, right) =>
      String(left.relativePath || '').localeCompare(String(right.relativePath || '')));
    for (const staged of pending) {
      const targetPath = String(staged.content?.target?.relativePath || '');
      const current = visible.get(targetPath);
      if (!targetPath || !current) continue;
      const base = staged.content.base;
      const candidate = staged.content.candidate;
      const projectedContent = rebaseFigureRetryCandidate(
        candidate.content, base.content, current.content
      );
      const exactBase = jsonLikeEqual(projectedContent, base.content);
      visible.set(targetPath, {
        ...current,
        content: projectedContent,
        revision: exactBase ? Number(base.revision || 0) : Number(current.revision || 0),
        contentHash: exactBase
          ? String(base.contentHash || '') : workspaceContentFingerprint(projectedContent),
        byteSize: exactBase && Number.isFinite(Number(base.byteSize))
          ? Math.max(0, Number(base.byteSize)) : jsonLikeByteSize(projectedContent),
        updatedAt: exactBase && base.updatedAt
          ? String(base.updatedAt) : String(current.updatedAt || '')
      });
    }
    const pendingTargets = new Set(pending.map(asset =>
      String(asset.content?.target?.relativePath || '')).filter(Boolean));
    for (const targetPath of pendingTargets) {
      const projected = visible.get(targetPath);
      const rawAsset = rawVisible.get(targetPath);
      if (!projected || !rawAsset) continue;
      const writeToken = workspaceWriteToken(
        targetPath, rawAsset, pendingFigureRetryStages(records, targetPath)
      );
      if (writeToken) visible.set(targetPath, { ...projected, writeToken });
    }
    return [...visible.values()].sort((left, right) =>
      String(left.relativePath || '').localeCompare(String(right.relativePath || '')));
  }

  function safeError(error) {
    const allowedCodes = new Set([
      ...(Array.isArray(shared.PROVIDER_PUBLIC_ERROR_CODES)
        ? shared.PROVIDER_PUBLIC_ERROR_CODES
        : [
            'AUTH_INVALID', 'CANCELLED', 'INVALID_RESPONSE', 'NETWORK_ERROR',
            'OUTPUT_TRUNCATED', 'PROVIDER_REJECTED', 'PROVIDER_UNAVAILABLE',
            'QUOTA_EXHAUSTED', 'RATE_LIMITED', 'REQUEST_TIMEOUT',
            'TOKEN_LIMIT_REJECTED', 'CODEX_NOT_INSTALLED',
            'CODEX_NOT_AUTHENTICATED', 'CODEX_BRIDGE_UNAVAILABLE',
            'CODEX_PROVIDER_REJECTED'
          ]),
      'INVALID_SETTINGS', 'LLM_NOT_READY',
      'PDF_FIGURE_OWNER_UNAVAILABLE', 'PDF_FIGURE_CONTEXT_STALE',
      'PDF_FIGURE_CONTEXT_INVALID', 'PDF_FIGURE_CONTEXT_INCOMPLETE', 'PDF_FIGURE_CAPTION_INCOMPLETE',
      'PDF_FIGURE_CONTEXT_DIGEST_MISMATCH', 'PDF_FIGURE_EVIDENCE_UNVERIFIED',
      'PDF_FIGURE_CONTEXT_BUDGET_EXCEEDED', 'PDF_FIGURE_ROUTE_CHANGED',
      'PDF_FIGURE_IMAGE_COUNT_INVALID', 'PDF_FIGURE_ASSET_BYTES_INVALID',
      'PDF_FIGURE_ASSET_BINDING_CONFLICT', 'PDF_FIGURE_ASSET_HASH_MISMATCH',
      'PDF_FIGURE_PANEL_INVENTORY_INVALID', 'PDF_FIGURE_PANEL_INVENTORY_BINDING_CONFLICT',
      'PDF_FIGURE_PANEL_INVENTORY_LABEL_INVALID', 'PDF_FIGURE_PANEL_INVENTORY_DUPLICATED',
      'PDF_FIGURE_PANEL_INVENTORY_EFFECTIVE_LIMIT',
      'PDF_FIGURE_DIGEST_UNAVAILABLE',
      'FIGURE_CHECKPOINT_TRANSPORT_UNAVAILABLE',
      'FIGURE_CHECKPOINT_PERSIST_FAILED',
      'FIGURE_CHECKPOINT_INVALID',
      'FIGURE_CHECKPOINT_STALE',
      'FIGURE_CACHE_READ_FAILED',
      'FIGURE_CACHE_PERSIST_FAILED',
      'FIGURE_PROVIDER_ATTEMPT_LIMIT',
      'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE',
      'FIGURE_REQUEST_RECEIPT_INVALID',
      'FIGURE_REQUEST_RECEIPT_MISMATCH',
      'FIGURE_REQUEST_REPLAY_AMBIGUOUS',
      'FIGURE_REQUEST_RECEIPT_CAPACITY',
      'FIGURE_COMMIT_GUARD_UNAVAILABLE', 'FIGURE_PANEL_RETRY_SCOPE_STALE',
      'FIGURE_RETRY_CLEANUP_FAILED',
      'UNKNOWN_LLM_TASK',
      'PANEL_LEDGER_INCOMPLETE', 'MECHANISM_GRAPH_EMPTY',
      'MECHANISM_OPERATION_CANCELLED', 'MECHANISM_OPERATION_STALE',
      'MECHANISM_OPERATION_FINALIZED',
      'MECHANISM_OPERATION_CAPACITY_EXCEEDED',
      'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS',
      'MECHANISM_PROVIDER_RECEIPT_MISMATCH',
      'MECHANISM_DISPATCH_BINDING_UNAVAILABLE',
      'MECHANISM_OPERATION_DEADLINE_EXCEEDED',
      'MECHANISM_PROVIDER_REQUEST_BUDGET_EXCEEDED',
      'MECHANISM_CHECKPOINT_INVALID', 'MECHANISM_CHECKPOINT_READ_FAILED',
      'MECHANISM_CHECKPOINT_WRITE_FAILED', 'MECHANISM_RUN_STATE_READ_FAILED',
      'MECHANISM_RUN_STATE_WRITE_FAILED', 'MECHANISM_UNRESOLVED_EVIDENCE',
      'MECHANISM_REVISION_CONFLICT',
      'PROVIDER_CAPABILITY_UNAVAILABLE',
      'WEB_SEARCH_UNSUPPORTED', 'WEB_SEARCH_GROUNDING_MISSING',
      'WEB_SEARCH_RESPONSE_INCOMPLETE',
      'NO_USABLE_PROFILE', 'CAPABILITY_MISMATCH', 'JEV_LIMIT_EXCEEDED',
      'TOKEN_LIMIT_REJECTED', 'PARAGRAPH_STALE',
      'CONTEXT_BUDGET_EXCEEDED', 'CITATION_AMBIGUOUS', 'CITATION_STALE',
      'STUDY_TYPE_REQUIRED', 'ANNOTATION_LIMIT_REACHED', 'NOTE_TOO_LONG',
      'INVALID_ARCHIVE_SCHEMA', 'ARCHIVE_IDENTITY_MISMATCH',
      'ARTICLE_ARCHIVE_TOO_LARGE', 'ARTICLE_ARCHIVE_NOT_FOUND',
      'INVALID_JSON_ASSET', 'DIRECTORY_SYNC_UNAVAILABLE',
      'WORKSPACE_STORE_UNAVAILABLE', 'WORKSPACE_NOT_FOUND',
      'ASSET_REVISION_CONFLICT', 'ASSET_HASH_CONFLICT', 'STAGING_STALE',
      'INVALID_BINARY_ASSET', 'INVALID_BINARY_HASH',
      'WORKSPACE_BINARY_UNAVAILABLE', 'WORKSPACE_BINARY_HASH_MISMATCH',
      'WORKSPACE_REVISION_CONFLICT', 'WORKSPACE_HASH_CONFLICT',
      'WORKSPACE_GENERATION_CONFLICT', 'WORKSPACE_DELETION_CONFLICT',
      'WORKSPACE_DELETION_PENDING', 'INVALID_WORKSPACE_GENERATION',
      'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH',
      'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT',
      'ARTICLE_WORKSPACE_RESTORE_PLAN_INVALID', 'ARTICLE_WORKSPACE_RESTORE_PLAN_LIMIT',
      'WORKSPACE_RESTORE_CONFLICT', 'WORKSPACE_RESTORE_TOMBSTONE_CONFLICT',
      'WORKSPACE_RESTORE_TOO_LARGE', 'INVALID_WORKSPACE_RESTORE_BASELINE',
      'INVALID_WORKSPACE_RESTORE_ASSET', 'INVALID_WORKSPACE_RESTORE_STATE',
      'DOCUMENT_SCHEMA_UNAVAILABLE', 'INVALID_DOCUMENT_RESTORE_BASELINE',
      'INVALID_DOCUMENT_RESTORE_RECORD', 'ARTICLE_ARCHIVE_DOCUMENT_CONFLICT',
      'ARTICLE_RESTORE_RECEIPT_INVALID',
      'LITERATURE_NOTE_SENDER_INVALID', 'LITERATURE_NOTE_DELTA_INVALID',
      'LITERATURE_NOTE_TEMPLATE_CONFLICT',
      'LITERATURE_NOTE_DOCUMENT_TOO_LARGE', 'LITERATURE_NOTE_STORAGE_TOO_LARGE',
      'LITERATURE_NOTE_STORAGE_FAILED',
      'SUPPLEMENTAL_TARGET_INVALID', 'SUPPLEMENTAL_TARGET_CANONICAL_MISMATCH',
      'SUPPLEMENTAL_TARGET_DOCUMENT_MISMATCH', 'SUPPLEMENTAL_DRAFT_INVALID',
      'SUPPLEMENTAL_SOURCE_MODE', 'SUPPLEMENTAL_CAPTION_TOO_LONG',
      'SUPPLEMENTAL_CAPTION_EMPTY', 'SUPPLEMENTAL_MATERIAL_ID',
      'SUPPLEMENTAL_MATERIAL_ID_BOUNDS', 'SUPPLEMENTAL_IMAGE_INVALID',
      'SUPPLEMENTAL_PDF_INVALID', 'SUPPLEMENTAL_SOURCE_FINGERPRINT',
      'SUPPLEMENTAL_SOURCE_TIME', 'SUPPLEMENTAL_TRANSIENT_IMAGE',
      'SUPPLEMENTAL_TRANSIENT_IMAGE_TOO_LARGE',
      'SUPPLEMENTAL_TRANSIENT_FINGERPRINT', 'SUPPLEMENTAL_EXISTS_REQUIRED',
      'SUPPLEMENTAL_RANDOM_UNAVAILABLE', 'SUPPLEMENTAL_RANDOM_INVALID',
      'SUPPLEMENTAL_MATERIAL_ID_COLLISION',
      'TURN_NOT_FOUND', 'TURN_ALREADY_EXISTS',
      'INVALID_WORKSPACE', 'INVALID_WORKSPACE_PATH', 'INVALID_WORKSPACE_MANIFEST',
      'INVALID_WORKSPACE_INDEX', 'WORKSPACE_CONTAINS_CREDENTIALS',
      'INVALID_MIGRATION_SCHEMA', 'INVALID_MIGRATION_SETTINGS',
      'INVALID_MIGRATION_DOCUMENTS', 'INVALID_MIGRATION_FEEDBACK',
      'MIGRATION_BUNDLE_TOO_LARGE'
    ]);
    const rawCode = typeof error?.code === 'string' ? error.code : '';
    const portableConfigCode = PORTABLE_CONFIG_ERROR_CODES.has(rawCode)
      ? rawCode
      : rawCode.startsWith('PORTABLE_CONFIG_') ? 'PORTABLE_CONFIG_FAILED' : '';
    const code = allowedCodes.has(error?.code)
      ? error.code
      : portableConfigCode || 'INTERNAL_ERROR';
    const messages = {
      INVALID_SETTINGS: LOCAL_INPUT_MESSAGE,
      PDF_FIGURE_OWNER_UNAVAILABLE: '无法连接当前 PDF 阅读页，请回到原页重试解图。',
      PDF_FIGURE_CONTEXT_STALE: 'PDF 或图像已更新，请等待索引完成后重新解图。',
      PDF_FIGURE_PANEL_INVENTORY_INVALID: '模型未返回有效的 Panel 目录，请重新解图。',
      PDF_FIGURE_PANEL_INVENTORY_BINDING_CONFLICT: 'Panel 目录与当前 PDF 原图不匹配，请重新解图。',
      PDF_FIGURE_PANEL_INVENTORY_LABEL_INVALID: '模型返回了无法核验的 Panel 标签，请重新解图。',
      PDF_FIGURE_PANEL_INVENTORY_DUPLICATED: '模型返回的 Panel 标签重复，请重新解图。',
      PDF_FIGURE_PANEL_INVENTORY_EFFECTIVE_LIMIT: '当前 Figure 的 Panel 数量超过单图支持范围。',
      PDF_FIGURE_CONTEXT_INVALID: 'PDF 解图上下文不完整，请刷新图目录后重试。',
      PDF_FIGURE_CONTEXT_INCOMPLETE: '尚未找到可核验的图注和相关正文，请等待索引完成。',
      PDF_FIGURE_CAPTION_INCOMPLETE: '这张图的跨页图注尚不完整，请等待后续页面读取完成后重试。',
      PDF_FIGURE_CONTEXT_DIGEST_MISMATCH: 'PDF 解图证据已变化，请重新解图。',
      PDF_FIGURE_EVIDENCE_UNVERIFIED: '图注或正文尚未定位到 PDF 原文，请等待索引完成。',
      PDF_FIGURE_CONTEXT_BUDGET_EXCEEDED: '当前图的正文证据超过处理上限，请缩小分析范围。',
      PDF_FIGURE_ROUTE_CHANGED: '解图模型配置已更改，请重新发起解图。',
      PDF_FIGURE_IMAGE_COUNT_INVALID: '当前图像输入不完整，请刷新图目录后重试。',
      PDF_FIGURE_ASSET_BYTES_INVALID: 'PDF 图像无法读取，请重新准备原图。',
      PDF_FIGURE_ASSET_BINDING_CONFLICT: 'PDF 图像与当前文献不匹配，请重新准备原图。',
      PDF_FIGURE_ASSET_HASH_MISMATCH: 'PDF 图像已变化，请重新准备原图。',
      PDF_FIGURE_DIGEST_UNAVAILABLE: '当前浏览器无法校验 PDF 图像，请重新打开阅读页。',
      AUTH_INVALID: 'API authentication failed',
      QUOTA_EXHAUSTED: 'API quota is exhausted',
      REQUEST_TIMEOUT: 'Provider request timed out',
      RATE_LIMITED: 'Provider rate limit reached',
      PROVIDER_UNAVAILABLE: 'Provider is temporarily unavailable',
      PROVIDER_REJECTED: 'Provider rejected the request',
      NETWORK_ERROR: 'Unable to reach the provider',
      INVALID_RESPONSE: 'Provider returned an invalid response',
      CAPABILITY_MISMATCH: 'The selected model does not support this feature input.',
      JEV_LIMIT_EXCEEDED: 'Jev 的单次识别容量不足，请缩短过长的类别定义或原文范围后重试。',
      PANEL_LEDGER_INCOMPLETE: 'Mechanism generation could not account for every Panel.',
      MECHANISM_GRAPH_EMPTY: 'Mechanism generation did not produce a validated relationship.',
      MECHANISM_OPERATION_CANCELLED: 'Mechanism generation was cancelled.',
      MECHANISM_OPERATION_STALE: 'Mechanism generation was replaced by a newer run.',
      MECHANISM_OPERATION_FINALIZED: 'Mechanism generation is already finalized.',
      MECHANISM_OPERATION_CAPACITY_EXCEEDED:
        'Mechanism operation capacity is unavailable for this document.',
      MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS:
        'A mechanism provider request was already dispatched and cannot be safely repeated.',
      MECHANISM_PROVIDER_RECEIPT_MISMATCH:
        'The mechanism provider receipt does not match the original request.',
      MECHANISM_DISPATCH_BINDING_UNAVAILABLE:
        'The mechanism provider request could not be bound safely.',
      MECHANISM_OPERATION_DEADLINE_EXCEEDED: 'Mechanism generation exceeded its deadline.',
      MECHANISM_PROVIDER_REQUEST_BUDGET_EXCEEDED:
        'Mechanism generation exhausted its provider request budget.',
      MECHANISM_CHECKPOINT_INVALID: 'The saved mechanism checkpoint is invalid.',
      MECHANISM_CHECKPOINT_READ_FAILED: 'The saved mechanism checkpoint could not be read.',
      MECHANISM_CHECKPOINT_WRITE_FAILED: 'Mechanism progress could not be saved.',
      MECHANISM_RUN_STATE_READ_FAILED: 'Mechanism run state could not be read.',
      MECHANISM_RUN_STATE_WRITE_FAILED: 'Mechanism run state could not be saved.',
      MECHANISM_UNRESOLVED_EVIDENCE: 'Some experimental evidence remains unresolved.',
      MECHANISM_REVISION_CONFLICT: 'The mechanism workspace changed during generation.',
      OUTPUT_TRUNCATED: 'Model output reached its token limit',
      CANCELLED: 'Provider request was cancelled',
      FIGURE_CHECKPOINT_TRANSPORT_UNAVAILABLE:
        'Private Figure checkpoint transport is unavailable',
      FIGURE_CHECKPOINT_PERSIST_FAILED:
        'Validated Figure progress could not be saved',
      FIGURE_CHECKPOINT_INVALID:
        'Saved Figure progress does not match this request',
      FIGURE_CHECKPOINT_STALE:
        'Saved Figure progress is valid but belongs to an older request binding',
      FIGURE_CACHE_READ_FAILED:
        'Validated Figure cache data could not be read',
      FIGURE_CACHE_PERSIST_FAILED:
        'Validated Figure cache data could not be saved',
      FIGURE_PROVIDER_ATTEMPT_LIMIT:
        'Figure analysis exhausted its bounded provider-attempt budget',
      FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE:
        'The durable Figure provider-attempt ledger is unavailable',
      FIGURE_REQUEST_RECEIPT_INVALID:
        'Figure request receipt is invalid',
      FIGURE_REQUEST_RECEIPT_MISMATCH:
        'Figure request receipt does not match the original request',
      FIGURE_REQUEST_REPLAY_AMBIGUOUS:
        'A prior Figure request could not be confirmed complete; saved results are retained. Resume in a new operation.',
      FIGURE_REQUEST_RECEIPT_CAPACITY:
        'Figure request receipt capacity is temporarily unavailable',
      FIGURE_COMMIT_GUARD_UNAVAILABLE:
        'The Figure commit guard is unavailable',
      FIGURE_PANEL_RETRY_SCOPE_STALE:
        'The Figure changed before the retry result could be saved',
      FIGURE_RETRY_CLEANUP_FAILED:
        'Figure retry cleanup could not be confirmed; the result remains quarantined.',
      LLM_NOT_READY: 'LLM mode requires a configured provider and consent',
      UNKNOWN_LLM_TASK: 'UNKNOWN_LLM_TASK',
      PROVIDER_CAPABILITY_UNAVAILABLE:
        '当前摘要模型不支持结构化 JSON，请选择支持该功能的模型后重试。',
      WEB_SEARCH_UNSUPPORTED:
        '当前问答模型不支持带来源的联网搜索，请关闭联网搜索或切换模型。',
      WEB_SEARCH_GROUNDING_MISSING:
        '联网回答缺少可验证的信息源，未发布本次回答。',
      WEB_SEARCH_RESPONSE_INCOMPLETE:
        '联网回答未完整返回，未发布不完整内容。',
      NO_USABLE_PROFILE: 'No usable API profile is configured',
      CODEX_NOT_INSTALLED: 'Codex is not installed on this computer',
      CODEX_NOT_AUTHENTICATED: 'Codex is installed but not signed in',
      CODEX_BRIDGE_UNAVAILABLE: 'The local Codex bridge is unavailable',
      CODEX_PROVIDER_REJECTED: 'Local Codex rejected the request',
      TOKEN_LIMIT_REJECTED: 'Provider rejected the requested output token limit',
      PARAGRAPH_STALE: 'The requested paragraph is no longer in the document',
      CONTEXT_BUDGET_EXCEEDED: 'The selected model context window cannot fit this request',
      CITATION_AMBIGUOUS: 'The cited text matches more than one article location',
      CITATION_STALE: 'The article changed and the citation must be verified again',
      STUDY_TYPE_REQUIRED: 'Study type must be selected before analysis.',
      ANNOTATION_LIMIT_REACHED: 'This document has reached the annotation limit.',
      NOTE_TOO_LONG: 'The annotation note is too long.',
      INVALID_ARCHIVE_SCHEMA: 'The article archive format is invalid.',
      ARCHIVE_IDENTITY_MISMATCH: 'The article archive belongs to another document.',
      ARTICLE_ARCHIVE_TOO_LARGE: 'The article archive is too large.',
      ARTICLE_ARCHIVE_NOT_FOUND: 'No saved article archive was found.',
      INVALID_JSON_ASSET: 'The saved article archive is damaged.',
      DIRECTORY_SYNC_UNAVAILABLE: 'A local archive directory has not been configured.',
      WORKSPACE_STORE_UNAVAILABLE: 'Local article workspaces are unavailable.',
      WORKSPACE_NOT_FOUND: 'The local article workspace was not found.',
      ASSET_REVISION_CONFLICT: 'This saved item changed before the save completed.',
      ASSET_HASH_CONFLICT: 'This saved item no longer matches the version being edited.',
      STAGING_STALE: 'The staged Figure result was replaced before confirmation.',
      WORKSPACE_REVISION_CONFLICT: 'The article workspace changed before this save completed.',
      WORKSPACE_HASH_CONFLICT: 'The article workspace content hash no longer matches.',
      WORKSPACE_GENERATION_CONFLICT: 'This save belongs to an older cleared workspace.',
      WORKSPACE_DELETION_CONFLICT: 'The article workspace deletion state changed.',
      WORKSPACE_DELETION_PENDING: 'The article workspace is being deleted.',
      INVALID_WORKSPACE_GENERATION: 'The article workspace generation is invalid.',
      ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH:
        'The restore target no longer matches the current article.',
      ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT:
        'Browser and directory copies differ. Both copies were retained; resolve the conflict before restoring.',
      ARTICLE_WORKSPACE_RESTORE_PLAN_INVALID: '恢复计划已失效或不匹配，请重新扫描；未覆盖本机数据。',
      ARTICLE_WORKSPACE_RESTORE_PLAN_LIMIT: '待处理恢复计划过多，请稍后重新扫描。',
      WORKSPACE_RESTORE_CONFLICT: '扫描后本机数据已改变，本次恢复已停止；新修改已保留。',
      ARTICLE_ARCHIVE_DOCUMENT_CONFLICT: '保存快照中的标注与当前文档不同，旧快照未写入目录；请读取当前标注后重新保存。',
      INVALID_DOCUMENT_RESTORE_BASELINE: '无法确认恢复文档的本机基线，本次恢复已停止。',
      INVALID_DOCUMENT_RESTORE_RECORD: '恢复文档记录未通过校验，本次恢复已停止。',
      DOCUMENT_SCHEMA_UNAVAILABLE: '暂时无法校验恢复文档，本次恢复已停止。',
      WORKSPACE_RESTORE_TOMBSTONE_CONFLICT: '本机已有删除记录，不能用旧档案恢复已删除内容。',
      WORKSPACE_RESTORE_TOO_LARGE: '恢复数据超出当前安全处理上限，未执行部分恢复。',
      INVALID_WORKSPACE_RESTORE_BASELINE: '恢复基线无效，请重新扫描。',
      INVALID_WORKSPACE_RESTORE_ASSET: '恢复资产无效，未执行部分恢复。',
      INVALID_WORKSPACE_RESTORE_STATE: '本机恢复状态无效，未执行部分恢复。',
      ARTICLE_RESTORE_RECEIPT_INVALID:
        'The restore authorization has expired or was already used.',
      LITERATURE_NOTE_SENDER_INVALID: 'The literature-note save sender is invalid.',
      LITERATURE_NOTE_DELTA_INVALID: 'The literature-note changes are invalid or too large.',
      LITERATURE_NOTE_TEMPLATE_CONFLICT: 'The saved note changed. Reopen the note and select the template again; your draft has been retained.',
      LITERATURE_NOTE_DOCUMENT_TOO_LARGE: 'The literature-note document is too large.',
      LITERATURE_NOTE_STORAGE_TOO_LARGE: 'The literature-note storage budget is full.',
      LITERATURE_NOTE_STORAGE_FAILED: 'The literature-note changes could not be saved.',
      SUPPLEMENTAL_TARGET_INVALID: 'The target article workspace is invalid.',
      SUPPLEMENTAL_TARGET_CANONICAL_MISMATCH:
        'The target article URL no longer matches the saved workspace.',
      SUPPLEMENTAL_TARGET_DOCUMENT_MISMATCH:
        'The target article content no longer matches the saved workspace.',
      SUPPLEMENTAL_DRAFT_INVALID: 'The supplemental Figure draft is invalid.',
      SUPPLEMENTAL_SOURCE_MODE: 'The supplemental Figure source type is invalid.',
      SUPPLEMENTAL_CAPTION_TOO_LONG: 'The supplemental Figure caption is too long.',
      SUPPLEMENTAL_CAPTION_EMPTY: 'The supplemental Figure caption is empty.',
      SUPPLEMENTAL_MATERIAL_ID: 'The supplemental Figure identifier is invalid.',
      SUPPLEMENTAL_MATERIAL_ID_BOUNDS: 'The supplemental Figure identifier is too long.',
      SUPPLEMENTAL_IMAGE_INVALID: 'The supplemental Figure image is invalid.',
      SUPPLEMENTAL_PDF_INVALID: 'The supplemental Figure PDF is invalid.',
      SUPPLEMENTAL_SOURCE_FINGERPRINT: 'The supplemental Figure fingerprint is invalid.',
      SUPPLEMENTAL_SOURCE_TIME: 'The supplemental Figure import time is invalid.',
      SUPPLEMENTAL_TRANSIENT_IMAGE: 'The supplemental Figure image payload is invalid.',
      SUPPLEMENTAL_TRANSIENT_IMAGE_TOO_LARGE:
        'The supplemental Figure image payload is too large.',
      SUPPLEMENTAL_TRANSIENT_FINGERPRINT:
        'The supplemental Figure image no longer matches its source.',
      SUPPLEMENTAL_EXISTS_REQUIRED: 'Supplemental Figure collision checking is unavailable.',
      SUPPLEMENTAL_RANDOM_UNAVAILABLE: 'Secure supplemental Figure identifiers are unavailable.',
      SUPPLEMENTAL_RANDOM_INVALID: 'The supplemental Figure identifier is invalid.',
      SUPPLEMENTAL_MATERIAL_ID_COLLISION:
        'A unique supplemental Figure identifier could not be allocated.',
      TURN_NOT_FOUND: 'The saved chat turn is missing and must be recreated.',
      TURN_ALREADY_EXISTS: 'The saved chat turn already exists.',
      INVALID_WORKSPACE: 'The article workspace is invalid.',
      INVALID_WORKSPACE_PATH: 'The article workspace path is invalid.',
      INVALID_WORKSPACE_MANIFEST: 'The article workspace manifest is invalid.',
      INVALID_WORKSPACE_INDEX: 'The article workspace index is invalid.',
      WORKSPACE_CONTAINS_CREDENTIALS: 'Credentials cannot be stored in an article workspace.',
      INVALID_MIGRATION_SCHEMA: 'The migration file format is invalid.',
      INVALID_MIGRATION_SETTINGS: 'The migration settings are invalid.',
      INVALID_MIGRATION_DOCUMENTS: 'The migration document records are invalid.',
      INVALID_MIGRATION_FEEDBACK: 'The migration feedback records are invalid.',
      MIGRATION_BUNDLE_TOO_LARGE: 'The migration file is too large.',
      PORTABLE_CONFIG_FAILED: 'Portable configuration request failed.',
      INTERNAL_ERROR: 'Unable to complete the request'
    };
    if (portableConfigCode) messages[portableConfigCode] = messages.PORTABLE_CONFIG_FAILED;
    const result = {
      code,
      message: code === 'INVALID_SETTINGS' && error?.[TRUSTED_INVALID_SETTINGS_MESSAGE] === true
        ? boundedUserMessage(error?.userMessage, messages[code]) : messages[code],
      runtimeRevision: RUNTIME_REVISION,
      retryable: error?.retryable === true,
      fields: code === 'INVALID_SETTINGS' || code === 'PROVIDER_CAPABILITY_UNAVAILABLE'
        ? boundedInvalidSettingsFields(error?.fields) : undefined
    };
    if (code === 'FIGURE_REQUEST_REPLAY_AMBIGUOUS') {
      const causes = new Set([
        'NETWORK_ERROR', 'REQUEST_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED'
      ]);
      if (causes.has(error?.causeCode)) {
        result.causeCode = error.causeCode;
        result.message = `${messages[error.causeCode]}; completion could not be confirmed. ` +
          'Saved Figure results are retained. Resume in a new operation.';
      }
    }
    if (error?.cleanupPending === true && code !== 'INTERNAL_ERROR') {
      result.cleanupPending = true;
      const cleanupCode = String(error?.cleanupCode || '').toUpperCase();
      const cleanupCodes = new Set([
        'MECHANISM_RUN_STATE_WRITE_FAILED', 'MECHANISM_CHECKPOINT_WRITE_FAILED',
        'MECHANISM_OPERATION_CAPACITY_EXCEEDED',
        'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE'
      ]);
      if (cleanupCodes.has(cleanupCode)) result.cleanupCode = cleanupCode;
    }
    const figureAttemptDiagnosticCodes = new Set([
      'FIGURE_PROVIDER_ATTEMPT_LIMIT',
      'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE',
      'FIGURE_REQUEST_REPLAY_AMBIGUOUS',
      'FIGURE_REQUEST_RECEIPT_MISMATCH',
      'FIGURE_REQUEST_RECEIPT_CAPACITY'
    ]);
    const rawProviderAttempt = Number(error?.providerAttempt);
    const rawProviderAttemptLimit = Number(error?.providerAttemptLimit);
    if (figureAttemptDiagnosticCodes.has(code) &&
        Number.isSafeInteger(rawProviderAttempt) && rawProviderAttempt >= 0 &&
        Number.isSafeInteger(rawProviderAttemptLimit) && rawProviderAttemptLimit >= 1) {
      result.providerAttemptLimit = Math.min(
        FIGURE_PROVIDER_ATTEMPT_HARD_LIMIT, rawProviderAttemptLimit
      );
      result.providerAttempt = Math.min(
        result.providerAttemptLimit,
        FIGURE_PROVIDER_ATTEMPT_HARD_LIMIT,
        rawProviderAttempt
      );
    }
    const allowedDiagnosticStages = new Set(['request', 'response-body', 'provider-completion']);
    if (allowedDiagnosticStages.has(error?.diagnosticStage)) {
      result.diagnosticStage = error.diagnosticStage;
    }
    if (code !== 'INTERNAL_ERROR' && error?.diagnosticType) {
      result.diagnosticType = String(error.diagnosticType)
        .replace(/[^A-Za-z0-9_$-]/g, '').slice(0, 80) || 'Error';
    }
    if (Number.isFinite(error?.requestBytes)) {
      result.requestBytes = Math.max(0, Math.min(1000000, Math.round(error.requestBytes)));
    }
    if (Number.isFinite(error?.elapsedMs)) {
      result.elapsedMs = Math.max(0, Math.min(600000, Math.round(error.elapsedMs)));
    }
    if (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs > 0) {
      result.retryAfterMs = Math.max(0, Math.min(300000, Math.round(error.retryAfterMs)));
    }
    if (Number.isFinite(error?.status) && error.status > 0) {
      result.status = Math.max(0, Math.min(599, Math.round(error.status)));
    }
    if (code !== 'INTERNAL_ERROR' && error?.probeId) {
      result.probeId = String(error.probeId)
        .replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    }
    if (code === 'INTERNAL_ERROR') {
      const type = String(error?.name || 'Error').replace(/[^A-Za-z0-9_$-]/g, '').slice(0, 80);
      const diagnosticMessage = String(error?.message || 'Unknown internal error')
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/sk-[A-Za-z0-9_-]{8,}/gi, '[redacted]')
        .slice(0, 240);
      result.diagnosticType = type || 'Error';
      result.diagnosticMessage = diagnosticMessage;
    }
    return result;
  }

  function safePortableConfigError(error) {
    const code = typeof error?.code === 'string' && PORTABLE_CONFIG_ERROR_CODES.has(error.code)
      ? error.code : 'PORTABLE_CONFIG_FAILED';
    return Object.assign(new Error(code), {
      code,
      retryable: error?.retryable === true
    });
  }

  function createPortableConfigStorageChangeListener(manager, {
    warn = console.warn
  } = {}) {
    const warnSchedulingFailure = () => {
      try {
        warn('Brevess: portable configuration backup scheduling failed');
      } catch (_) {}
    };
    return (changes, areaName) => {
      if (areaName !== 'local' || !changes || (
        !Object.prototype.hasOwnProperty.call(changes, 'sciLlmSettingsV2') &&
        !Object.prototype.hasOwnProperty.call(changes, 'sciGlobalAbbreviationMemoryV1') &&
        !Object.prototype.hasOwnProperty.call(changes, 'sciPdfMineruSettingsV1')
      )) return;
      try {
        Promise.resolve(manager.scheduleBackup(changes)).catch(warnSchedulingFailure);
      } catch (_) {
        warnSchedulingFailure();
      }
    };
  }

  function publicCategory(category) {
    const presentation = shared.presentationForCategory
      ? shared.presentationForCategory(category.categoryId, category)
      : null;
    return {
      categoryId: category.categoryId,
      name: category.name,
      color: category.color,
      persistence: category.persistence,
      builtIn: category.builtIn,
      retired: category.retired === true,
      enabledEngines: Array.isArray(category.enabledEngines)
        ? [...category.enabledEngines] : ['llm', 'regex'],
      claimMode: category.claimMode || 'explicit',
      minimumConfidence: Number(category.minimumConfidence) || 0.8,
      ...(presentation ? { presentation } : {})
    };
  }

  function publicStudyProfile(profile) {
    if (!profile) return null;
    return {
      ...profile,
      primaryTypeName: profile?.useTypeSpecificWarnings === false
        ? '通用分析'
        : shared.STUDY_TYPES?.[profile?.primaryType]?.name || profile?.primaryType || ''
    };
  }

  function normalizeUnifiedCustomCategory(category) {
    const normalized = shared.flattenUnifiedCategory(shared.toUnifiedCategory({
      ...category,
      builtIn: false
    }));
    normalized.categoryId = String(category?.categoryId || normalized.categoryId || '');
    normalized.persistence = category?.persistence === 'one-off' ? 'one-off' : 'saved';
    normalized.builtIn = false;
    return normalized;
  }

  function portableConfigStatus(value) {
    const status = isPlainObject(value) ? value : {};
    const state = status.state;
    const revision = status.revision;
    const updatedAtValue = status.updatedAt;
    const pending = status.pending;
    const lastError = status.lastError;
    const allowedStates = new Set([
      'unknown', 'missing', 'locked', 'ready', 'error', 'unavailable', 'disabled'
    ]);
    const updatedAt = typeof updatedAtValue === 'string' && updatedAtValue.length <= 80 &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(updatedAtValue) &&
      Number.isFinite(Date.parse(updatedAtValue))
      ? new Date(updatedAtValue).toISOString()
      : '';
    return {
      state: typeof state === 'string' && allowedStates.has(state) ? state : 'unknown',
      revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
      updatedAt,
      pending: pending === true,
      lastError: typeof lastError === 'string' && PORTABLE_CONFIG_ERROR_CODES.has(lastError)
        ? lastError : lastError ? 'PORTABLE_CONFIG_FAILED' : ''
    };
  }

  function createDisabledPortableConfigManager() {
    const status = () => portableConfigStatus({ state: 'disabled' });
    const rejectNotReady = async () => {
      throw Object.assign(new Error('PORTABLE_CONFIG_NOT_READY'), {
        code: 'PORTABLE_CONFIG_NOT_READY'
      });
    };
    return Object.freeze({
      probe: status,
      create: status,
      unlock: status,
      rotatePassphrase: status,
      forgetKey: status,
      backupNow: status,
      runWhenReady: rejectNotReady,
      status,
      publicStatus: status
    });
  }

  function createBackgroundRouter({
    storageArea,
    sessionStorageArea,
    figureAttemptLedgerStorage = null,
    figureProviderAttemptLedger = null,
    fetchImpl,
    nativeClient = null,
    cacheStore = shared.createMemoryAnalysisCache(),
    corpusStore = shared.createMemoryCorpusStore(),
    documentStore = shared.createMemoryDocumentStore(),
    articleWorkspaceStore = null,
    tokenUsageStore = null,
    directorySync = null,
    portableConfigManager = createDisabledPortableConfigManager(),
    runtimeExtensionId = '',
    getRuntimeLastError = () => null,
    sleepImpl = delay => new Promise(resolve => setTimeout(resolve, delay)),
    nowImpl = () => Date.now(),
    cryptoImpl = globalThis.crypto,
    mechanismSessionIdentityProvider = null,
    evidenceProviderRequestTimeoutMs = EVIDENCE_FIRST_POLICY.providerRequestTimeoutMs
  }) {
    let memorySessionCategories = [];
    const documentIdsByHash = new Map();
    let documentMutationTail = Promise.resolve();
    const operationRegistry = shared.createOperationRegistry?.();
    if (mechanismSessionIdentityProvider !== null &&
        typeof mechanismSessionIdentityProvider !== 'function') {
      throw invalidSettings(['mechanismSessionIdentityProvider']);
    }
    const resolvedMechanismSessionIdentityProvider =
      typeof mechanismSessionIdentityProvider === 'function'
        ? mechanismSessionIdentityProvider
        : runtimeExtensionId
          ? createMechanismBrowserSessionIdentityProvider({
              storageArea: sessionStorageArea,
              cryptoImpl,
              getRuntimeLastError
            })
          : undefined;
    const mechanismCoordinator = shared.createMechanismOperationCoordinator?.({
      cacheStore,
      now: nowImpl,
      enforceOwnerAuthority: Boolean(runtimeExtensionId),
      sessionIdentityProvider: resolvedMechanismSessionIdentityProvider
    });
    const mechanismOperations = new Map();
    const evidenceProviderQueue = [];
    let activeEvidenceProviderRequests = 0;
    let detachedEvidenceProviderRequests = 0;
    const boundedEvidenceProviderRequestTimeoutMs = Math.min(
      EVIDENCE_FIRST_POLICY.providerRequestTimeoutMs,
      Math.max(1, Math.floor(Number(evidenceProviderRequestTimeoutMs) ||
        EVIDENCE_FIRST_POLICY.providerRequestTimeoutMs))
    );
    const articleRestoreReceipts = new Map();
    // Short-lived restore candidates, never a lock or durable completion journal.
    const articleWorkspaceRestorePlans = new Map();
    // Ephemeral provenance only: never reconstruct a creation fact from a
    // revision, timestamp, client flag, or a record read outside its transaction.
    const documentCreationReceipts = new Map();
    let documentCreationRevocationEpoch = 0;
    let articleRestoreReceiptSequence = 0;
    const figureRequestReceipts = new Map();
    const figureProviderAttemptBudgets = new Map();
    const durableFigureProviderAttemptLedger = figureProviderAttemptLedger ||
      createFigureProviderAttemptLedger({
        storageArea: figureAttemptLedgerStorage || sessionStorageArea || storageArea,
        getRuntimeLastError,
        nowImpl
      });
    let trustedTabRetirementTail = Promise.resolve();
    let trustedTabRetirementsRecovered = false;
    let trustedTabRetirementRecovery = null;

    function queueTrustedTabRetirement(operation) {
      const pending = trustedTabRetirementTail.then(operation, operation);
      trustedTabRetirementTail = pending.catch(() => undefined);
      return pending;
    }

    async function finishTrustedTabRetirement(trusted) {
      const figureResult = await durableFigureProviderAttemptLedger.retireTrustedTab(trusted);
      detachRetiredFigureOperations(figureResult?.removedOperationIds);
      const mechanismResult = mechanismCoordinator?.retireTrustedTab
        ? await mechanismCoordinator.retireTrustedTab(trusted)
        : { cleaned: 0 };
      if (typeof durableFigureProviderAttemptLedger.confirmTrustedTabRetirement ===
          'function') {
        await durableFigureProviderAttemptLedger.confirmTrustedTabRetirement(trusted);
      }
      return { figure: figureResult || {}, mechanism: mechanismResult || {} };
    }

    function ensureTrustedTabRetirementsRecovered() {
      if (trustedTabRetirementsRecovered) return Promise.resolve();
      if (trustedTabRetirementRecovery) return trustedTabRetirementRecovery;
      trustedTabRetirementRecovery = queueTrustedTabRetirement(async () => {
        if (typeof durableFigureProviderAttemptLedger.listPendingTabRetirements !==
            'function') {
          trustedTabRetirementsRecovered = true;
          return;
        }
        const pending = await durableFigureProviderAttemptLedger
          .listPendingTabRetirements();
        if (!Array.isArray(pending) || pending.length > FIGURE_OWNER_AUTHORITY_CAPACITY) {
          throw figureProviderAttemptLedgerError();
        }
        for (const trusted of pending) await finishTrustedTabRetirement(trusted);
        trustedTabRetirementsRecovered = true;
      }).then(value => {
        trustedTabRetirementRecovery = null;
        return value;
      }, error => {
        trustedTabRetirementRecovery = null;
        throw error;
      });
      return trustedTabRetirementRecovery;
    }

    function figureContractError(code) {
      const error = new Error(code);
      error.code = code;
      error.retryable = false;
      return error;
    }

    function normalizeFigureRequestReceipt(value) {
      if (typeof value !== 'string') return '';
      const receipt = value.normalize('NFKC').trim();
      return /^figure-request-[A-Za-z0-9._:-]{8,140}$/u.test(receipt)
        ? receipt : '';
    }

    function requiresModernFigureContract(message) {
      if (message?.operationScope === 'figure') return true;
      if (!String(runtimeExtensionId || '')) return false;
      if ([
        'LLM_ANALYZE_FIGURES', 'LLM_ANALYZE_FIGURE_PANEL',
        'LLM_ASK_FIGURE_PANEL'
      ].includes(message?.type)) return true;
      return message?.operationId !== undefined ||
        message?.figureRequestReceipt !== undefined ||
        message?.figureOperationPlan !== undefined ||
        message?.figureResumeCheckpoint !== undefined ||
        message?.providerAttemptsConsumed !== undefined ||
        message?.operationScope !== undefined;
    }

    function assertModernFigureRequestContract(message) {
      if (!requiresModernFigureContract(message)) return;
      const isPanelRequest = [
        'LLM_ANALYZE_FIGURE_PANEL', 'LLM_ASK_FIGURE_PANEL'
      ].includes(message?.type);
      const rawFigures = message?.type === 'LLM_ANALYZE_FIGURES'
        ? (Array.isArray(message?.figures) ? message.figures : [])
        : isPanelRequest && isPlainObject(message?.figure)
          ? [message.figure] : [];
      if (message?.operationScope !== 'figure' || rawFigures.length !== 1 ||
          !shared.normalizeOperationId?.(message?.operationId) ||
          !normalizeFigureRequestReceipt(message?.figureRequestReceipt) ||
          !Array.isArray(message?.figureOperationPlan) ||
          (message?.forceRefresh === true &&
            message?.figureResumeCheckpoint != null) ||
          (isPanelRequest
            ? message?.analysisDepth !== 'standard'
            : !['standard', 'deep'].includes(message?.analysisDepth))) {
        throw invalidSettings([
          'operationScope', 'operationId', 'figureRequestReceipt',
          'figureOperationPlan', 'analysisDepth'
        ]);
      }
    }

    function trustedFigureScope(message, context, { requireModern = false } = {}) {
      const modern = requiresModernFigureContract(message);
      const senderExtensionId = typeof context?.senderExtensionId === 'string'
        ? context.senderExtensionId : '';
      const senderTabId = Number(context?.senderTabId);
      const senderFrameId = Number(context?.senderFrameId);
      const senderDocumentId = typeof context?.senderDocumentId === 'string'
        ? context.senderDocumentId.normalize('NFKC').trim().slice(0, 160) : '';
      const workspaceLifecycle = Number(message?.workspaceLifecycle);
      if (!modern && !requireModern && context?.trustedExtensionSender !== true) {
        return null;
      }
      if ((modern || requireModern) && (
        context?.trustedExtensionSender !== true || !senderExtensionId ||
        senderExtensionId !== String(runtimeExtensionId || '') ||
        !Number.isSafeInteger(senderTabId) || senderTabId < 0 ||
        !Number.isSafeInteger(senderFrameId) || senderFrameId < 0 ||
        !senderDocumentId || !Number.isSafeInteger(workspaceLifecycle) ||
        workspaceLifecycle < 0
      )) {
        throw invalidSettings(['operationScope', 'workspaceLifecycle']);
      }
      return {
        version: 1,
        senderExtensionId,
        senderTabId,
        senderFrameId,
        senderDocumentId,
        workspaceLifecycle
      };
    }

    async function figureOperationIdentity(message, context, options = {}) {
      const publicOperationId = shared.normalizeOperationId?.(message?.operationId) || '';
      if (!publicOperationId) return { publicOperationId: '', internalOperationId: '', scope: null };
      const durableContractRequested = options.requireModern === true ||
        message?.operationScope === 'figure' ||
        message?.figureRequestReceipt !== undefined ||
        message?.figureOperationPlan !== undefined ||
        message?.figureResumeCheckpoint !== undefined ||
        message?.providerAttemptsConsumed !== undefined;
      if (!durableContractRequested && !requiresModernFigureContract(message)) {
        return {
          publicOperationId,
          internalOperationId: publicOperationId,
          scope: null
        };
      }
      const scope = trustedFigureScope(message, context, options);
      const digest = await strongSha256({ publicOperationId, scope }, cryptoImpl);
      return {
        publicOperationId,
        internalOperationId: `figure:${digest}`,
        scope
      };
    }

    async function figureMessageSignature(message, excludedKeys) {
      if (!message || typeof message !== 'object') throw strongBindingError();
      const descriptors = Object.getOwnPropertyDescriptors(message);
      const source = Object.create(null);
      for (const key of Object.keys(descriptors)) {
        if (excludedKeys.has(key)) continue;
        const descriptor = descriptors[key];
        if (descriptor?.enumerable !== true) continue;
        if (!Object.hasOwn(descriptor, 'value')) throw strongBindingError();
        if (descriptor.value === undefined) continue;
        // Preserve nested references here. strongSha256 performs the guarded,
        // bounded traversal, so large Figure pixels are neither cloned nor
        // hashed a second time for the durable ledger.
        source[key] = descriptor.value;
      }
      return strongSha256(source, cryptoImpl);
    }

    async function figureRequestSignature(message) {
      return figureMessageSignature(message, new Set(['figureRequestReceipt']));
    }

    async function figureSemanticRequestSignature(message) {
      return figureMessageSignature(message, new Set([
        'figureRequestReceipt', 'forceRefresh', 'providerAttemptsConsumed',
        'figureResumeCheckpoint', 'figureProgressOffset', 'figureProgressTotal'
      ]));
    }

    async function figureTargetKeyDigest(message) {
      const figureIds = message?.type === 'LLM_ANALYZE_FIGURES'
        ? (Array.isArray(message?.figures) ? message.figures : []).map(value =>
            String(value?.figureId || '').normalize('NFKC').trim()
          )
        : [String(message?.figure?.figureId || '').normalize('NFKC').trim()];
      const panelId = String(
        message?.panel?.panel || message?.panelId || message?.panel || ''
      ).normalize('NFKC').trim().toUpperCase();
      return strongSha256({
        domain: 'figure-operation-target-v1',
        type: String(message?.type || ''),
        figureIds,
        panelId
      }, cryptoImpl);
    }

    async function figureResumeCheckpointDigest(message) {
      const descriptor = Object.getOwnPropertyDescriptor(message, 'figureResumeCheckpoint');
      if (!descriptor || descriptor.enumerable !== true || descriptor.value == null) return '';
      if (!Object.hasOwn(descriptor, 'value')) throw strongBindingError();
      return strongSha256(descriptor.value, cryptoImpl);
    }

    function pruneFigureRequestReceipts(now = Number(nowImpl())) {
      for (const [receipt, record] of figureRequestReceipts) {
        if (record.settled && record.expiresAt <= now) {
          figureRequestReceipts.delete(receipt);
        }
      }
    }

    async function runIdempotentFigureRequest(message, context, task) {
      assertModernFigureRequestContract(message);
      const supplied = message?.figureRequestReceipt;
      if (supplied === undefined || supplied === null || supplied === '') return task('');
      const receipt = normalizeFigureRequestReceipt(supplied);
      if (!receipt) throw figureContractError('FIGURE_REQUEST_RECEIPT_INVALID');
      const identity = await figureOperationIdentity(message, context, {
        requireModern: requiresModernFigureContract(message)
      });
      const signature = await figureRequestSignature(message);
      const receiptKey = `${identity.internalOperationId || 'figure:legacy'}:${receipt}`;
      pruneFigureRequestReceipts();
      const prior = figureRequestReceipts.get(receiptKey);
      if (prior) {
        if (prior.signature !== signature) {
          throw figureContractError('FIGURE_REQUEST_RECEIPT_MISMATCH');
        }
        return prior.promise;
      }
      if (figureRequestReceipts.size >= FIGURE_RECEIPT_CAPACITY) {
        throw figureContractError('FIGURE_REQUEST_RECEIPT_CAPACITY');
      }
      const now = Number(nowImpl());
      const record = {
        signature,
        operationId: shared.normalizeOperationId?.(message?.operationId) || '',
        settled: false,
        expiresAt: Number.POSITIVE_INFINITY,
        promise: null
      };
      record.promise = Promise.resolve().then(() => task(signature));
      figureRequestReceipts.set(receiptKey, record);
      void record.promise.then(
        () => {
          record.settled = true;
          record.expiresAt = Math.max(now, Number(nowImpl())) + FIGURE_RECEIPT_TTL_MS;
        },
        () => {
          record.settled = true;
          record.expiresAt = Math.max(now, Number(nowImpl())) + FIGURE_RECEIPT_TTL_MS;
        }
      );
      return record.promise;
    }

    function detachFigureProviderAttemptBudget(budget) {
      if (!budget) return;
      const signal = budget.abortSignal;
      const listener = budget.abortListener;
      budget.abortSignal = null;
      budget.abortListener = null;
      if (!signal || typeof listener !== 'function') return;
      try { signal.removeEventListener('abort', listener); } catch (_) {}
    }

    function releaseFigureOperationContracts(operationId) {
      const normalized = shared.normalizeOperationId?.(operationId) || '';
      if (!normalized) return;
      detachFigureProviderAttemptBudget(figureProviderAttemptBudgets.get(normalized));
      figureProviderAttemptBudgets.delete(normalized);
      // A release confirms that the caller no longer needs the active budget,
      // but a second caller may have lost the same terminal response. Its
      // immutable receipt remains replayable until the bounded receipt TTL.
    }

    function pruneFigureProviderAttemptBudgets(now = Number(nowImpl())) {
      const cutoff = now - FIGURE_BUDGET_TTL_MS;
      for (const [operationId, budget] of figureProviderAttemptBudgets) {
        if (budget.inFlight > 0 || budget.lastTouchedAt > cutoff) continue;
        detachFigureProviderAttemptBudget(budget);
        figureProviderAttemptBudgets.delete(operationId);
      }
    }

    function stopFigureProviderAttemptBudget(budget, code) {
      if (!budget || budget.terminalCode) return;
      budget.terminalCode = String(code || 'FIGURE_PROVIDER_ATTEMPT_LIMIT');
      detachFigureProviderAttemptBudget(budget);
    }

    async function persistFigureProviderAttemptTerminal(budget, code) {
      if (!budget) return;
      stopFigureProviderAttemptBudget(budget, code);
      if (!budget.durableIdentity) return;
      const state = await durableFigureProviderAttemptLedger.terminate(
        budget.durableIdentity,
        budget.terminalCode || code
      );
      budget.used = Math.max(
        budget.used, Math.floor(Number(state?.reservedAttempts) || 0)
      );
    }

    function conclusiveFigureRateLimit(error) {
      return error?.code === 'RATE_LIMITED' && Number(error?.status) === 429 &&
        error?.diagnosticStage === 'response-body';
    }

    function conclusiveFigureHttpRejection(error) {
      const status = Number(error?.status);
      return Number.isSafeInteger(status) && status >= 400 && status < 500 &&
        status !== 408 && error?.diagnosticStage === 'response-body';
    }

    function conclusiveFigureProviderRejection(error) {
      // A fully parsed model response explicitly ended with a resource rejection.
      // A lost transport or an HTTP 5xx alone does not establish this outcome.
      return error?.code === 'PROVIDER_UNAVAILABLE' && Number(error.status) === 200 &&
        error.diagnosticStage === 'provider-completion';
    }

    function ambiguousFigureTransportFailure(error) {
      if (conclusiveFigureHttpRejection(error) || conclusiveFigureProviderRejection(error)) return false;
      return [
        'NETWORK_ERROR', 'REQUEST_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED'
      ].includes(error?.code);
    }

    function figureDispatchPersistenceError(budget, cause) {
      stopFigureProviderAttemptBudget(budget, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS');
      const error = figureAttemptLimitError(budget);
      error.cleanupPending = true;
      error.cleanupCode = cause?.code === 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE'
        ? cause.code : 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE';
      return error;
    }

    async function settleFigureProviderDispatch(
      budget, durableBinding, dispatch, status
    ) {
      if (!budget || !durableBinding || !Number.isSafeInteger(dispatch?.attemptNumber)) return;
      try {
        const state = await durableFigureProviderAttemptLedger.settleAttempt(
          durableBinding, dispatch.attemptNumber, dispatch.dispatchDigest, status
        );
        budget.used = Math.max(
          budget.used, Math.floor(Number(state?.reservedAttempts) || 0)
        );
        if (status === 'responded') {
          budget.respondedDispatches.set(dispatch.attemptNumber, {
            attemptNumber: dispatch.attemptNumber,
            dispatchDigest: dispatch.dispatchDigest,
            receipt: durableBinding.receipt,
            requestSignature: durableBinding.requestSignature
          });
        }
      } catch (error) {
        throw figureDispatchPersistenceError(budget, error);
      }
    }

    function figureDispatchesForProof(adapter, dispatchCollector) {
      const budget = adapter?.figureProviderAttemptBudget || null;
      const durableBinding = adapter?.figureProviderAttemptBinding || null;
      if (!budget || !durableBinding || !(dispatchCollector instanceof Map)) return [];
      return [...dispatchCollector.values()]
        .map(entry => ({
          attemptNumber: entry.attemptNumber,
          dispatchDigest: entry.dispatchDigest
        }));
    }

    async function prepareDurableFigureDispatchProof(
      adapter, dispatchCollector, proof
    ) {
      const budget = adapter?.figureProviderAttemptBudget || null;
      const durableBinding = adapter?.figureProviderAttemptBinding || null;
      const consumedAttempts = figureDispatchesForProof(adapter, dispatchCollector);
      if (!budget || !durableBinding || !consumedAttempts.length) return [];
      try {
        const state = await durableFigureProviderAttemptLedger.prepareAttemptProof(
          durableBinding, consumedAttempts, proof
        );
        budget.used = Math.max(
          budget.used, Math.floor(Number(state?.reservedAttempts) || 0)
        );
        return consumedAttempts;
      } catch (error) {
        throw figureDispatchPersistenceError(budget, error);
      }
    }

    async function sealDurablyConsumedFigureDispatches(
      adapter, dispatchCollector, consumedAttempts, proof, continuationDigest = ''
    ) {
      const budget = adapter?.figureProviderAttemptBudget || null;
      const durableBinding = adapter?.figureProviderAttemptBinding || null;
      if (!budget || !durableBinding ||
          (!consumedAttempts?.length && !continuationDigest)) return;
      try {
        const state = await durableFigureProviderAttemptLedger
          .sealRespondedAttempts(
            durableBinding, consumedAttempts, continuationDigest, proof
          );
        budget.used = Math.max(
          budget.used, Math.floor(Number(state?.reservedAttempts) || 0)
        );
        for (const entry of consumedAttempts) {
          budget.respondedDispatches.delete(entry.attemptNumber);
          dispatchCollector?.delete(entry.attemptNumber);
        }
      } catch (error) {
        throw figureDispatchPersistenceError(budget, error);
      }
    }

    function figureAttemptLimitError(budget) {
      const error = figureContractError(
        budget?.terminalCode || 'FIGURE_PROVIDER_ATTEMPT_LIMIT'
      );
      error.providerAttempt = Math.max(0, Number(budget?.used) || 0);
      error.providerAttemptLimit = Math.max(0, Number(budget?.limit) || 0);
      return error;
    }

    function normalizeFigureOperationPlan(message, figures) {
      const supplied = message?.figureOperationPlan;
      if (supplied === undefined) {
        return {
          explicit: false,
          entries: (Array.isArray(figures) ? figures : []).map(figure => ({
            figureId: String(figure?.figureId || ''),
            panelCount: Math.min(30, Array.isArray(figure?.panelHints)
              ? figure.panelHints.length : 0)
          }))
        };
      }
      if (!Array.isArray(supplied) || !supplied.length || supplied.length > 50) {
        throw invalidSettings(['figureOperationPlan']);
      }
      const entries = [];
      const seen = new Set();
      for (const item of supplied) {
        if (!isPlainObject(item)) throw invalidSettings(['figureOperationPlan']);
        const figureId = typeof item.figureId === 'string'
          ? item.figureId.normalize('NFKC').trim().slice(0, 80) : '';
        const panelCount = Number(item.panelCount);
        if (!figureId || seen.has(figureId) || !Number.isSafeInteger(panelCount) ||
            panelCount < 0 || panelCount > 30) {
          throw invalidSettings(['figureOperationPlan']);
        }
        seen.add(figureId);
        entries.push({ figureId, panelCount });
      }
      const planByFigureId = new Map(entries.map(entry => [entry.figureId, entry]));
      if ((Array.isArray(figures) ? figures : []).some(figure => {
        const figureId = String(figure?.figureId || '');
        const expectedPanelCount = Math.min(30, Array.isArray(figure?.panelHints)
          ? figure.panelHints.length : 0);
        return !planByFigureId.has(figureId) ||
          planByFigureId.get(figureId).panelCount !== expectedPanelCount;
      })) {
        throw invalidSettings(['figureOperationPlan']);
      }
      return { explicit: true, entries };
    }

    function normalizeFigureRouteEndpoint(value) {
      const raw = String(value || '').trim();
      if (!raw) return 'official';
      try {
        const url = new URL(raw);
        if (!['https:', 'http:'].includes(url.protocol)) return 'invalid';
        url.hash = '';
        url.pathname = url.pathname.replace(/\/+$/u, '');
        return url.toString();
      } catch (_) {
        return 'invalid';
      }
    }

    function figureRouteRequestBehavior(settings, route, taskId) {
      const config = isPlainObject(route?.config) ? route.config : {};
      const customHeaders = isPlainObject(config.customHeaders)
        ? Object.keys(config.customHeaders).map(key => [
          String(key),
          String(config.customHeaders[key])
        ]) : [];
      const legacyBehavior = typeof shared.requestBehaviorSignature === 'function'
        ? shared.requestBehaviorSignature(
          route?.providerId, config, route?.effectiveReasoning
        ) : {};
      const profile = settings?.profiles?.[route?.effectiveProfileId] || {};
      const contextWindowTokens = typeof shared.getProviderContextWindowTokens === 'function'
        ? shared.getProviderContextWindowTokens(
          route?.providerId, config, profile.contextWindowTokens
        ) : 0;
      return {
        legacyBehavior,
        ...(String(route?.providerId || '') === 'openai-compatible' ? {
          authHeader: String(config.authHeader || 'Authorization'),
          authPrefix: config.authPrefix === undefined
            ? 'Bearer' : String(config.authPrefix || '').trim(),
          customHeaders
        } : {}),
        ...(String(route?.providerId || '') === 'codex-local' ? {
          selectedNativeProfile: String(config.profileId || '')
        } : {}),
        contextWindowTokens: Number.isFinite(Number(contextWindowTokens))
          ? Math.floor(Number(contextWindowTokens)) : 0,
        implementationVersion: String(shared.FIGURE_ANALYSIS_VERSION || ''),
        promptContractVersion: String(shared.FIGURE_ANALYSIS_PROMPT_VERSION || ''),
        panelPromptVersion: [
          'figure_panel_interpretation', 'figure_panel_followup'
        ].includes(String(taskId || ''))
          ? String(shared.FIGURE_PANEL_PROMPT_VERSION || '') : ''
      };
    }

    async function strongFigureRouteDigest(settings, route, taskId) {
      const outputLanguage = typeof shared.normalizeInterfaceLanguage === 'function'
        ? shared.normalizeInterfaceLanguage(settings?.language) :
          (String(settings?.language || '').toLowerCase().startsWith('en')
            ? 'en' : 'zh-CN');
      return strongSha256({
        providerId: String(route?.providerId || ''),
        model: String(route?.model || ''),
        effectiveProfileId: String(route?.effectiveProfileId || ''),
        endpoint: normalizeFigureRouteEndpoint(route?.config?.baseUrl),
        capabilityMode: String(route?.capabilityMode || ''),
        requestBehavior: figureRouteRequestBehavior(settings, route, taskId),
        effectiveReasoning: route?.effectiveReasoning || null,
        effectiveTokenPolicyCap: Number(route?.effectiveTokenPolicyCap) || 0,
        tokenPolicy: route?.tokenPolicy || null,
        outputLanguage,
        credentialMaterial: String(route?.config?.apiKey || '')
      }, cryptoImpl);
    }

    async function bindFigureProviderAttemptBudget({
      settings, message, figures, taskId, route, operation, operationIdentity,
      documentHash, requestSignature, prepareOnly = false,
      pdfDiscoveryWorkflow = false, inventoryContinuationDigest = ''
    }) {
      const operationId = String(operationIdentity?.internalOperationId || '');
      pruneFigureProviderAttemptBudgets();
      const plan = normalizeFigureOperationPlan(message, figures);
      const analysisDepth = [
        'figure_panel_interpretation', 'figure_panel_followup'
      ].includes(taskId) && message?.analysisDepth === undefined
        ? 'standard' : message?.analysisDepth;
      const taskPolicy = settings?.taskPolicies?.[taskId] || {};
      const taskRule = shared.normalizeTaskTokenRule(taskId, taskPolicy.tokenRule);
      const rawTruncationRetries = taskRule === 'auto'
        ? FIGURE_DEFAULT_TRUNCATION_RETRIES
        : taskRule?.output?.truncationRetries;
      const derived = deriveFigureProviderAttemptBudget({
        figures: pdfDiscoveryWorkflow
          ? plan.entries.map(entry => ({ ...entry, panelCount: 30 })) : plan.entries,
        analysisDepth,
        truncationRetries: Number.isFinite(Number(rawTruncationRetries))
          ? Number(rawTruncationRetries) : FIGURE_DEFAULT_TRUNCATION_RETRIES,
        tokenPolicyMode: route?.tokenPolicy?.mode,
        allowTextFallback: taskPolicy.allowTextFallback === true
      });
      // Legacy callers did not supply an operation-wide inventory. Keep them
      // compatible but still bounded by the same independently audited cap.
      const limit = pdfDiscoveryWorkflow || !plan.explicit
        ? FIGURE_PROVIDER_ATTEMPT_HARD_LIMIT : derived.limit;
      // Declare the discovery stage and its maximum scope before the first
      // physical call. Inventory and analysis share this immutable 96-call cap.
      const discoveryPlan = pdfDiscoveryWorkflow ? {
        workflowVersion: PDF_FIGURE_WORKFLOW_VERSION,
        inventoryVersion: pdfPanelInventory.PDF_FIGURE_PANEL_INVENTORY_VERSION,
        maximumPanelsPerFigure: 30, maximumInventoryCallsPerFigure: 1
      } : null;
      const planDigest = await strongSha256({
        entries: plan.explicit ? plan.entries : 'legacy',
        immutableLimit: limit,
        topologyLimit: plan.explicit ? derived.topologyLimit : 'legacy',
        ...(discoveryPlan ? { discoveryPlan } : {})
      }, cryptoImpl);
      const taskPolicyDigest = await strongSha256({
        taskId,
        taskPolicy,
        resolvedTokenRule: taskRule
      }, cryptoImpl);
      // Every value in this projection is consumed only by strongSha256. The
      // resulting digest is the sole value stored or exposed, so credentials
      // and custom header values remain secret while credential/tenant changes
      // still invalidate both the durable operation binding and provider cache.
      const routeDigest = await strongFigureRouteDigest(settings, route, taskId);
      const bindingSignature = await strongSha256({
        operationId,
        publicOperationId: String(operationIdentity?.publicOperationId || ''),
        trustedScope: operationIdentity?.scope || null,
        documentHash: String(documentHash || ''),
        analysisDepth,
        planDigest,
        taskPolicyDigest,
        routeDigest,
        limit,
        topologyLimit: plan.explicit ? derived.topologyLimit : 'legacy'
      }, cryptoImpl);
      const consumed = Number(message?.providerAttemptsConsumed || 0);
      const receipt = normalizeFigureRequestReceipt(message?.figureRequestReceipt);
      if (!Number.isSafeInteger(consumed) || consumed < 0 || consumed > limit ||
          (consumed > 0 && !receipt)) {
        throw invalidSettings(['providerAttemptsConsumed']);
      }
      const durableIdentity = operationId && receipt ? {
        operationId,
        publicOperationId: String(operationIdentity?.publicOperationId || ''),
        bindingSignature,
        immutableLimit: limit,
        ownerScope: operationIdentity?.scope || null
      } : null;
      const normalizedRequestSignature = /^[a-f0-9]{64}$/u.test(
        String(requestSignature || '')
      ) ? requestSignature : '';
      if (durableIdentity && !normalizedRequestSignature) throw strongBindingError();
      const semanticSignature = durableIdentity
        ? await figureSemanticRequestSignature(message) : '';
      const targetKeyDigest = durableIdentity
        ? await figureTargetKeyDigest(message) : '';
      const resumeCheckpointDigest = durableIdentity
        ? (await figureResumeCheckpointDigest(message)) || inventoryContinuationDigest : '';
      const durableBinding = durableIdentity ? {
        ...durableIdentity,
        receipt,
        requestSignature: normalizedRequestSignature,
        semanticSignature,
        targetKeyDigest,
        resumeCheckpointDigest
      } : null;
      let durableState = durableBinding
        ? await durableFigureProviderAttemptLedger.bindRequest({
          ...durableBinding,
          advisoryConsumed: consumed,
          ...(prepareOnly ? { inspectOnly: true } : {})
        })
        : null;
      detachRetiredFigureOperations(durableState?.removedOperationIds);
      if (durableState?.existingReceipt === true) {
        const error = figureContractError('FIGURE_REQUEST_REPLAY_AMBIGUOUS');
        error.providerAttempt = Math.max(
          0, Math.floor(Number(durableState.reservedAttempts) || 0)
        );
        error.providerAttemptLimit = durableState.immutableLimit;
        throw error;
      }
      let resolvedBudget = null;
      let publishResolvedBudget = () => {};
      let durableActivated = !prepareOnly && durableState?.proofPending !== true &&
        durableState?.cacheProofPending !== true;
      const activateDurableBinding = async ({
        resumeCacheDigest = '', proofValidated = false
      } = {}) => {
        if (durableActivated) return durableState;
        if (!durableBinding) {
          durableActivated = true;
          publishResolvedBudget();
          return durableState;
        }
        durableState = await durableFigureProviderAttemptLedger.bindRequest({
          ...durableBinding,
          ...(resumeCacheDigest ? { resumeCacheDigest } : {}),
          advisoryConsumed: consumed,
          ...(proofValidated ? { proofValidated: true } : {})
        });
        detachRetiredFigureOperations(durableState?.removedOperationIds);
        if (durableState?.existingReceipt === true ||
            durableState?.proofPending === true ||
            durableState?.cacheProofPending === true) {
          throw figureContractError('FIGURE_REQUEST_REPLAY_AMBIGUOUS');
        }
        durableActivated = true;
        if (resolvedBudget) {
          resolvedBudget.used = Math.max(
            resolvedBudget.used,
            Math.floor(Number(durableState?.reservedAttempts) || 0)
          );
          publishResolvedBudget();
        }
        return durableState;
      };
      const confirmResumeProof = async () => activateDurableBinding({
        proofValidated: true
      });
      const confirmCacheProof = async proofDigest => {
        const normalized = String(proofDigest || '');
        if (!/^[a-f0-9]{64}$/u.test(normalized) ||
            (durableState?.expectedCacheProofDigest &&
              durableState.expectedCacheProofDigest !== normalized)) {
          throw figureContractError('FIGURE_REQUEST_REPLAY_AMBIGUOUS');
        }
        return activateDurableBinding({
          resumeCacheDigest: normalized, proofValidated: true
        });
      };
      if (operationId && figureProviderAttemptBudgets.has(operationId)) {
        const existing = figureProviderAttemptBudgets.get(operationId);
        if (existing.bindingSignature !== bindingSignature) {
          stopFigureProviderAttemptBudget(existing, 'FIGURE_PROVIDER_ATTEMPT_LIMIT');
          throw figureAttemptLimitError(existing);
        }
        existing.used = Math.max(
          existing.used,
          Math.floor(Number(durableState?.reservedAttempts) || 0)
        );
        resolvedBudget = existing;
        return {
          budget: existing, durableBinding,
          activateDurableBinding, confirmResumeProof, confirmCacheProof,
          cacheProofPending: durableState?.cacheProofPending === true,
          expectedCacheProofDigest: durableState?.expectedCacheProofDigest || '',
          planDigest, taskPolicyDigest, routeDigest,
          operationPlan: plan.entries.map(entry => ({ ...entry })),
          immutableLimit: limit
        };
      }
      if (!prepareOnly && operationId &&
          figureProviderAttemptBudgets.size >= FIGURE_RECEIPT_CAPACITY) {
        throw figureContractError('FIGURE_REQUEST_RECEIPT_CAPACITY');
      }
      const budget = {
        bindingSignature,
        operationId,
        topologyLimit: derived.topologyLimit,
        limit,
        taskId,
        routeDigest,
        taskPolicyDigest,
        used: durableState
          ? Math.floor(Number(durableState.reservedAttempts) || 0)
          : consumed,
        inFlight: 0,
        lastTouchedAt: Number(nowImpl()),
        terminalCode: '',
        respondedDispatches: new Map(),
        abortSignal: null,
        abortListener: null,
        durableIdentity
      };
      resolvedBudget = budget;
      Object.defineProperty(budget, 'limit', {
        value: limit, enumerable: true, writable: false, configurable: false
      });
      publishResolvedBudget = () => {
        if (operationId && !figureProviderAttemptBudgets.has(operationId) &&
            figureProviderAttemptBudgets.size >= FIGURE_RECEIPT_CAPACITY) {
          throw figureContractError('FIGURE_REQUEST_RECEIPT_CAPACITY');
        }
        if (operation?.controller?.signal && !budget.abortSignal) {
          budget.abortSignal = operation.controller.signal;
          budget.abortListener = () => {
            stopFigureProviderAttemptBudget(budget, 'CANCELLED');
            void persistFigureProviderAttemptTerminal(budget, 'CANCELLED')
              .catch(() => undefined);
          };
          budget.abortSignal.addEventListener('abort', budget.abortListener, { once: true });
        }
        if (operationId) figureProviderAttemptBudgets.set(operationId, budget);
      };
      if (durableActivated) publishResolvedBudget();
      if (durableActivated && operation?.controller?.signal?.aborted) {
        await persistFigureProviderAttemptTerminal(budget, 'CANCELLED');
        throw shared.operationError();
      }
      return {
        budget, durableBinding,
        activateDurableBinding, confirmResumeProof, confirmCacheProof,
        cacheProofPending: durableState?.cacheProofPending === true,
        expectedCacheProofDigest: durableState?.expectedCacheProofDigest || '',
        planDigest, taskPolicyDigest, routeDigest,
        operationPlan: plan.entries.map(entry => ({ ...entry })),
        immutableLimit: limit
      };
    }

    async function assertFigureOwnerCurrent(context) {
      if (typeof context?.assertTrustedOwnerCurrent !== 'function') return;
      try {
        await context.assertTrustedOwnerCurrent();
      } catch (error) {
        const ownerError = error && typeof error === 'object'
          ? error : figureContractError('CANCELLED');
        try {
          Object.defineProperty(ownerError, 'figureOwnerGuardFailure', {
            value: true, enumerable: false, configurable: false
          });
        } catch (_) {}
        throw ownerError;
      }
    }

    async function figureProviderDispatchDigest(request, budget) {
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw strongBindingError();
      }
      const descriptors = Object.getOwnPropertyDescriptors(request);
      const projection = Object.create(null);
      for (const key of Object.keys(descriptors)) {
        if (key === 'signal' || key === 'onProviderTelemetry') continue;
        const descriptor = descriptors[key];
        if (descriptor?.enumerable !== true) continue;
        if (!Object.hasOwn(descriptor, 'value')) throw strongBindingError();
        if (descriptor.value === undefined) continue;
        projection[key] = descriptor.value;
      }
      return strongSha256({
        domain: 'figure-provider-dispatch-v1',
        operationBinding: String(budget?.bindingSignature || ''),
        taskId: String(budget?.taskId || ''),
        routeDigest: String(budget?.routeDigest || ''),
        taskPolicyDigest: String(budget?.taskPolicyDigest || ''),
        request: projection
      }, cryptoImpl);
    }

    async function claimFigureProviderAttempt(
      budget, durableBinding, context, dispatchDigest
    ) {
      if (!budget) return null;
      if (budget.terminalCode) throw figureAttemptLimitError(budget);
      await assertFigureOwnerCurrent(context);
      let attemptNumber = null;
      if (durableBinding) {
        const committed = await durableFigureProviderAttemptLedger.reserveAttempt(
          durableBinding, dispatchDigest
        );
        attemptNumber = Number(committed?.attemptNumber);
        budget.used = Math.max(
          budget.used,
          Math.floor(Number(committed?.reservedAttempts) || 0)
        );
      } else {
        if (budget.used >= budget.limit) {
          stopFigureProviderAttemptBudget(budget, 'FIGURE_PROVIDER_ATTEMPT_LIMIT');
          throw figureAttemptLimitError(budget);
        }
        budget.used += 1;
        attemptNumber = budget.used;
      }
      await assertFigureOwnerCurrent(context);
      budget.lastTouchedAt = Number(nowImpl());
      context?.onProgress?.({
        phase: 'figure_provider_attempt',
        providerAttempt: attemptNumber,
        providerAttemptLimit: budget.limit,
        providerAttemptTopologyLimit: budget.topologyLimit
      });
      return { providerAttempt: attemptNumber, attemptNumber, dispatchDigest };
    }

    function articleRestoreReceiptError() {
      const error = new Error('ARTICLE_RESTORE_RECEIPT_INVALID');
      error.code = 'ARTICLE_RESTORE_RECEIPT_INVALID';
      return error;
    }

    function safeRestoreReceiptText(value, maximum = 500) {
      return typeof value === 'string'
        ? value.normalize('NFKC').trim().slice(0, maximum) : '';
    }

    function normalizeRestoreDocumentId(value) {
      const documentId = typeof value === 'string' ? value.trim() : '';
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(documentId)) {
        throw articleRestoreReceiptError();
      }
      return documentId;
    }

    function normalizeRestoreReceiptBinding(input) {
      if (!isPlainObject(input)) throw articleRestoreReceiptError();
      const kind = input.kind === 'archive' ? 'archive'
        : input.kind === 'workspace' ? 'workspace' : '';
      const currentInput = isPlainObject(input.current) ? input.current : {};
      let canonicalUrl = '';
      try {
        canonicalUrl = shared.normalizeWorkspaceCanonicalUrl(currentInput.canonicalUrl);
      } catch (_) {
        throw articleRestoreReceiptError();
      }
      const workspaceId = safeRestoreReceiptText(currentInput.workspaceId, 80).toLowerCase();
      const workspaceGeneration = Number(currentInput.workspaceGeneration);
      const contentHash = safeRestoreReceiptText(currentInput.contentHash, 200)
        .toLowerCase().replace(/^sha256:/u, '');
      if (!kind || !/^workspace:[a-f0-9]{64}$/u.test(workspaceId) ||
          !Number.isSafeInteger(workspaceGeneration) || workspaceGeneration < 1 ||
          !/^[a-f0-9]{64}$/u.test(contentHash) || !canonicalUrl) {
        throw articleRestoreReceiptError();
      }
      const result = {
        kind,
        current: { workspaceId, workspaceGeneration, canonicalUrl, contentHash },
        operationNonce: safeRestoreReceiptText(input.operationNonce, 160)
      };
      if (!/^[A-Za-z0-9._:-]{12,160}$/u.test(result.operationNonce)) {
        throw articleRestoreReceiptError();
      }
      if (kind === 'archive') {
        const archive = isPlainObject(input.archive) ? input.archive : {};
        result.archive = {
          documentId: normalizeRestoreDocumentId(archive.documentId),
          documentHash: safeRestoreReceiptText(archive.documentHash, 200),
          canonicalUrl: shared.normalizeWorkspaceCanonicalUrl(archive.canonicalUrl)
        };
        if (!result.archive.documentHash ||
            result.archive.canonicalUrl !== canonicalUrl) {
          throw articleRestoreReceiptError();
        }
        // New content-changed restores bind the current live document and the
        // validated archive payload independently. Legacy exact restores did
        // not carry currentArchive; falling back to the identical payload is
        // safe because it cannot authorize a distinct live document.
        const currentArchiveInput = isPlainObject(input.currentArchive)
          ? input.currentArchive : archive;
        result.currentArchive = {
          documentId: normalizeRestoreDocumentId(currentArchiveInput.documentId),
          documentHash: safeRestoreReceiptText(currentArchiveInput.documentHash, 200),
          canonicalUrl: shared.normalizeWorkspaceCanonicalUrl(
            currentArchiveInput.canonicalUrl
          )
        };
        if (!result.currentArchive.documentHash ||
            result.currentArchive.canonicalUrl !== canonicalUrl) {
          throw articleRestoreReceiptError();
        }
        result.allowContentChanged = input.allowContentChanged === true;
        const archiveIdentityChanged = result.currentArchive.documentId !==
          result.archive.documentId || result.currentArchive.documentHash !==
          result.archive.documentHash;
        if (archiveIdentityChanged && !result.allowContentChanged) {
          throw articleRestoreReceiptError();
        }
      } else {
        result.documentId = normalizeRestoreDocumentId(input.documentId);
        const manifest = normalizedRestoreCommitIdentity(input.manifest);
        if (!manifest || manifest.workspaceId !== workspaceId ||
            manifest.workspaceGeneration !== workspaceGeneration ||
            manifest.canonicalUrl !== canonicalUrl) throw articleRestoreReceiptError();
        result.manifest = manifest;
        result.match = input.match === 'content-changed' ? 'content-changed' : 'exact';
        result.allowContentChanged = input.allowContentChanged === true;
        if (manifest.contentHash !== contentHash &&
            !(result.allowContentChanged && result.match === 'content-changed')) {
          throw articleRestoreReceiptError();
        }
      }
      return result;
    }

    function sameJsonLike(left, right) {
      return JSON.stringify(left) === JSON.stringify(right);
    }

    function restoreReceiptSenderCanonicalUrl(context = {}) {
      const senderUrl = safeRestoreReceiptText(context.senderUrl, 8000);
      try {
        return shared.normalizeWorkspaceCanonicalUrl(senderUrl);
      } catch (_) {}
      // The built-in PDF reader runs in an extension page while the workspace
      // identity is the PDF source. Trust only this exact extension resource
      // and one explicitly encoded source; never a caller-selected extension
      // page or an ambiguous duplicate query parameter.
      try {
        const runtimeBase = new URL(safeRestoreReceiptText(
          context.runtimeBaseUrl, 1000
        ));
        const expectedReader = new URL('pdf-reader.html', runtimeBase);
        const reader = new URL(senderUrl);
        if (reader.protocol !== expectedReader.protocol ||
            reader.host !== expectedReader.host ||
            reader.pathname !== expectedReader.pathname ||
            reader.username || reader.password || reader.hash) {
          throw articleRestoreReceiptError();
        }
        const sources = reader.searchParams.getAll('source');
        if (sources.length !== 1 || !sources[0] || sources[0].length > 4000) {
          throw articleRestoreReceiptError();
        }
        const source = new URL(sources[0]);
        if (!/^(?:https?|file):$/u.test(source.protocol) ||
            source.username || source.password) throw articleRestoreReceiptError();
        return shared.normalizeWorkspaceCanonicalUrl(source.href);
      } catch (_) {
        throw articleRestoreReceiptError();
      }
    }

    function issueArticleRestoreReceipt(binding, context = {}) {
      if (context.trustedContentScript !== true ||
          !Number.isSafeInteger(context.senderTabId) || context.senderTabId < 0) {
        throw articleRestoreReceiptError();
      }
      const normalized = normalizeRestoreReceiptBinding(binding);
      const senderUrl = restoreReceiptSenderCanonicalUrl(context);
      if (senderUrl !== normalized.current.canonicalUrl) throw articleRestoreReceiptError();
      const now = Number(nowImpl());
      const randomUuid = globalThis.crypto?.randomUUID;
      if (typeof randomUuid !== 'function') throw articleRestoreReceiptError();
      articleRestoreReceiptSequence += 1;
      const receipt = [
        'restore', now.toString(36), articleRestoreReceiptSequence.toString(36),
        randomUuid.call(globalThis.crypto)
      ].join('-').slice(0, 160);
      articleRestoreReceipts.set(receipt, {
        binding: normalized,
        senderTabId: context.senderTabId,
        expiresAt: now + 30000
      });
      return { receipt, expiresAt: now + 30000 };
    }

    function consumeArticleRestoreReceipt(receipt, binding, now = Number(nowImpl())) {
      const key = safeRestoreReceiptText(receipt, 160);
      const stored = articleRestoreReceipts.get(key);
      articleRestoreReceipts.delete(key);
      const normalized = normalizeRestoreReceiptBinding(binding);
      if (!stored || stored.expiresAt <= now ||
          !sameJsonLike(stored.binding, normalized)) throw articleRestoreReceiptError();
      return stored;
    }

    function workspaceRestorePlanError(code = 'ARTICLE_WORKSPACE_RESTORE_PLAN_INVALID') {
      return Object.assign(new Error(code), { code });
    }

    function documentCreationOwner(context = {}) {
      if (context.trustedExtensionSender !== true || !runtimeExtensionId ||
          context.senderExtensionId !== runtimeExtensionId ||
          !Number.isSafeInteger(context.senderTabId) || context.senderTabId < 0 ||
          !Number.isSafeInteger(context.senderFrameId) || context.senderFrameId < 0 ||
          !safeRestoreReceiptText(context.senderDocumentId, 200) ||
          typeof context.assertDocumentCreationOwnerCurrent !== 'function') {
        throw articleRestoreReceiptError();
      }
      return { senderExtensionId: context.senderExtensionId,
        senderTabId: context.senderTabId, senderFrameId: context.senderFrameId,
        senderDocumentId: context.senderDocumentId,
        canonicalUrl: restoreReceiptSenderCanonicalUrl(context) };
    }

    async function checkedDocumentCreationOwner(context) {
      const owner = documentCreationOwner(context);
      if (await context.assertDocumentCreationOwnerCurrent() === false ||
          !jsonLikeEqual(owner, documentCreationOwner(context))) throw articleRestoreReceiptError();
      return owner;
    }

    function invalidateDocumentCreationReceipts(documentId) {
      // Revoke prepares still awaiting browser ownership proof as well as
      // receipts that have already been issued.
      documentCreationRevocationEpoch += 1;
      for (const [token, receipt] of documentCreationReceipts) {
        if (documentId && receipt.record.documentId !== documentId) continue;
        documentCreationReceipts.delete(token);
        const plan = articleWorkspaceRestorePlans.get(receipt.planId);
        if (plan) plan.documentCreationInvalidated = true;
      }
    }

    function retainDocumentCreationReceipt(prepared, owner) {
      const now = Number(nowImpl());
      const record = prepared.record;
      if (!record || record.documentId !== prepared.documentId ||
          record.documentHash !== prepared.documentHash ||
          shared.normalizeWorkspaceCanonicalUrl(record.canonicalUrl) !== owner.canonicalUrl ||
          !Array.isArray(record.annotations) || record.annotations.length) return '';
      for (const [token, receipt] of documentCreationReceipts) {
        if (receipt.expiresAt <= now) {
          documentCreationReceipts.delete(token);
          continue;
        }
        if (jsonLikeEqual(receipt.owner, owner) && jsonLikeEqual(receipt.record, record)) {
          return receipt.planId ? '' : token;
        }
      }
      if (prepared.documentCreationInfo?.createdFromAbsence !== true ||
          !jsonLikeEqual(prepared.documentCreationInfo.record, record) ||
          documentCreationReceipts.size >= 32) return '';
      const uuid = globalThis.crypto?.randomUUID?.();
      if (!uuid) return '';
      const token = `document-creation-${uuid}`;
      documentCreationReceipts.set(token, { owner: cloneJsonLike(owner),
        record: cloneJsonLike(record), expiresAt: now + 300000, planId: null });
      return token;
    }

    function matchingDocumentCreationReceipt(token, identity, expectedLocal, operationNonce) {
      const receipt = documentCreationReceipts.get(safeRestoreReceiptText(token, 160));
      if (!receipt || receipt.expiresAt <= Number(nowImpl()) ||
          !/^[A-Za-z0-9._:-]{12,160}$/u.test(String(operationNonce || '')) ||
          !expectedLocal?.workspace || expectedLocal.workspace.deletionPending ||
          !jsonLikeEqual(normalizedRestoreCommitIdentity(expectedLocal.workspace),
            normalizedRestoreCommitIdentity(identity)) ||
          expectedLocal.workspaceId !== identity.workspaceId ||
          expectedLocal.documentId !== identity.documentId ||
          receipt.record.documentId !== identity.documentId ||
          receipt.record.documentHash !== identity.documentHash ||
          receipt.owner.canonicalUrl !== shared.normalizeWorkspaceCanonicalUrl(identity.canonicalUrl) ||
          !jsonLikeEqual(receipt.record, expectedLocal.document)) return null;
      return receipt;
    }

    function retainWorkspaceRestorePlan(identity, restore, expectedLocal, operationNonce,
      documentCreationToken, directorySources = []) {
      const now = Number(nowImpl());
      for (const [key, plan] of articleWorkspaceRestorePlans) {
        if (plan.expiresAt <= now && !plan.pending) articleWorkspaceRestorePlans.delete(key);
      }
      const creationReceipt = matchingDocumentCreationReceipt(documentCreationToken,
        identity, expectedLocal, operationNonce);
      if (documentCreationToken !== undefined && documentCreationToken !== null &&
          documentCreationToken !== '' && !creationReceipt) {
        throw workspaceRestorePlanError('ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
      }
      const document = workspaceRestoreDocumentCandidate(identity, restore, expectedLocal,
        creationReceipt);
      const usesCreation = Boolean(creationReceipt && document && expectedLocal.document &&
        !jsonLikeEqual(expectedLocal.document.annotations, document.annotations));
      if (usesCreation && creationReceipt.planId) {
        const previous = articleWorkspaceRestorePlans.get(creationReceipt.planId);
        if (previous && previous.expiresAt > now && !previous.documentCreationInvalidated &&
            previous.operationNonce === operationNonce && jsonLikeEqual(previous.identity, identity) &&
            jsonLikeEqual(previous.expectedLocal, expectedLocal) && jsonLikeEqual(previous.restore, restore)) {
          return creationReceipt.planId;
        }
        throw workspaceRestorePlanError();
      }
      if (articleWorkspaceRestorePlans.size >= 16) {
        throw workspaceRestorePlanError('ARTICLE_WORKSPACE_RESTORE_PLAN_LIMIT');
      }
      const uuid = globalThis.crypto?.randomUUID?.();
      if (!uuid) throw workspaceRestorePlanError();
      const planId = `restore-plan-${uuid}`;
      articleWorkspaceRestorePlans.set(planId, {
        identity: cloneJsonLike(identity), restore: cloneJsonLike(restore),
        expectedLocal: cloneJsonLike(expectedLocal),
        directorySources: cloneJsonLike(directorySources),
        document,
        operationNonce: safeRestoreReceiptText(operationNonce, 160),
        expiresAt: Math.min(now + 120000, usesCreation ? creationReceipt.expiresAt : Infinity),
        binding: null, senderTabId: usesCreation ? creationReceipt.owner.senderTabId : null,
        senderOwner: usesCreation ? [creationReceipt.owner.senderTabId,
          creationReceipt.owner.senderFrameId, creationReceipt.owner.senderDocumentId] : null,
        ...(usesCreation ? { documentCreationOwner: cloneJsonLike(creationReceipt.owner),
          documentCreationToken: safeRestoreReceiptText(documentCreationToken, 160) } : {}),
        pending: null, result: null
      });
      if (usesCreation) creationReceipt.planId = planId;
      return planId;
    }

    function workspaceRestoreDocumentCandidate(identity, restore, expectedLocal, creationReceipt = null) {
      const assets = new Map((restore.assets || []).map(asset => [
        String(asset.relativePath || asset.path || ''),
        asset.content === undefined ? asset.data : asset.content
      ]));
      const legacy = assets.get('legacy/archive.json');
      const highlights = assets.get('annotations/highlights.json');
      const source = legacy?.documentRecord || highlights;
      if (!source || !Object.hasOwn(source, 'annotations')) return null;
      if (!expectedLocal || expectedLocal.documentId !== identity.documentId ||
          !Object.hasOwn(expectedLocal, 'document') ||
          typeof shared.normalizeDocumentRecord !== 'function') {
        throw workspaceRestorePlanError('INVALID_WORKSPACE_RESTORE_BASELINE');
      }
      const current = expectedLocal.document;
      const record = shared.normalizeDocumentRecord({
        ...(current || (legacy?.documentRecord ? source : {})),
        documentId: identity.documentId, canonicalUrl: identity.canonicalUrl,
        documentHash: identity.documentHash || current?.documentHash || '',
        workspaceId: identity.workspaceId, workspaceGeneration: identity.workspaceGeneration,
        workspaceContentHash: identity.contentHash,
        title: current?.title || identity.title || source.title || '',
        annotations: source.annotations
      });
      if (legacy?.documentRecord && highlights && Object.hasOwn(highlights, 'annotations') &&
          !jsonLikeEqual(record.annotations, shared.normalizeDocumentRecord({
            ...record, annotations: highlights.annotations
          }).annotations)) {
        throw workspaceRestorePlanError('ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
      }
      // Only the exact empty record created by this live owner's prepare
      // transaction can differ. Old empty records may be deliberate deletions.
      if (current && !jsonLikeEqual(shared.normalizeDocumentRecord(current).annotations,
          record.annotations) && (!creationReceipt || current.annotations.length !== 0)) {
        throw workspaceRestorePlanError('ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
      }
      return record;
    }

    function checkedWorkspaceRestorePlan(planId, binding) {
      const plan = articleWorkspaceRestorePlans.get(safeRestoreReceiptText(planId, 160));
      const normalized = normalizeRestoreReceiptBinding(binding);
      if (!plan || plan.expiresAt <= Number(nowImpl()) || normalized.kind !== 'workspace' ||
          !sameJsonLike(normalized.current, normalizedRestoreCommitIdentity(plan.identity)) ||
          normalized.documentId !== normalizeRestoreDocumentId(plan.identity.documentId) ||
          !sameJsonLike(normalized.manifest, normalizedRestoreCommitIdentity(plan.restore.manifest)) ||
          normalized.match !== (plan.restore.match === 'content-changed' ? 'content-changed' : 'exact') ||
          (plan.operationNonce && normalized.operationNonce !== plan.operationNonce) ||
          (plan.binding && !sameJsonLike(plan.binding, normalized))) {
        throw workspaceRestorePlanError();
      }
      return { plan, normalized };
    }

    async function commitWorkspaceRestorePlan(plan, normalized, context = {}) {
      if (plan.documentCreationOwner) {
        const owner = await checkedDocumentCreationOwner(context);
        if (!jsonLikeEqual(owner, plan.documentCreationOwner)) throw articleRestoreReceiptError();
        if (!plan.result && !plan.pending) {
          const receipt = documentCreationReceipts.get(plan.documentCreationToken);
          if (plan.documentCreationInvalidated || !receipt || receipt.expiresAt <= Number(nowImpl()) ||
              articleWorkspaceRestorePlans.get(receipt.planId) !== plan) throw workspaceRestorePlanError();
        }
      }
      if (plan.pending) return cloneJsonLike(await plan.pending);
      if (plan.result) return cloneJsonLike(plan.result);
      requireArticleWorkspaceStore('commitRestoreIfUnchanged');
      if (!plan.expectedLocal) throw workspaceRestorePlanError();
      plan.binding = normalized;
      plan.pending = (async () => {
        const restore = plan.restore;
        const turns = (Array.isArray(restore.turns) ? restore.turns : [])
          .map(publicStoredArticleChatTurn);
        const assets = (Array.isArray(restore.assets) ? restore.assets : []).map(asset => ({
          relativePath: shared.normalizeWorkspaceRelativePath(String(asset?.relativePath || asset?.path || '')),
          content: String(asset?.relativePath || asset?.path || '') === 'chat/index.json'
            ? chatIndexWithTurns(asset?.content === undefined ? asset?.data : asset.content,
              turns, { authoritative: true })
            : cloneJsonLike(asset?.content === undefined ? asset?.data : asset.content)
          // Recompute local content hashes; imported revisions/hashes are not local CAS versions.
        }));
        const saved = await articleWorkspaceStore.commitRestoreIfUnchanged({
          identity: plan.identity, expectedLocal: plan.expectedLocal, assets, turns,
          ...(plan.document ? { document: plan.document } : {})
        });
        // Remember durable success before asynchronous directory work. A sync error
        // does not roll back IndexedDB or authorize a second persistence attempt.
        const result = {
          committed: true, persistenceCommitted: true, assetCount: saved.assets.length,
          restore: { ...cloneJsonLike(restore), assets: saved.assets.map(cloneJsonLike),
            turns: saved.turns.map(cloneJsonLike) },
          ...(saved.document ? { document: cloneJsonLike(saved.document) } : {}),
          syncStatus: 'not-requested'
        };
        plan.result = result;
        if (plan.documentCreationToken) documentCreationReceipts.delete(plan.documentCreationToken);
        if (typeof directorySync?.enqueueWorkspaceAsset === 'function' && saved.assets.length) {
          try {
            for (const asset of saved.assets) {
              const latest = await articleWorkspaceStore.getAsset(saved.workspace.workspaceId, asset.relativePath);
              const workspace = await articleWorkspaceStore.getWorkspace(saved.workspace.workspaceId);
              if (!jsonLikeEqual(latest, asset) ||
                  workspace?.workspaceGeneration !== saved.workspace.workspaceGeneration) {
                throw workspaceRestorePlanError('WORKSPACE_RESTORE_CONFLICT');
              }
              await directorySync.enqueueWorkspaceAsset(saved.workspace, asset.relativePath,
                asset.content, { revision: asset.revision, contentHash: asset.contentHash,
                  updatedAt: asset.updatedAt, workspaceGeneration: saved.workspace.workspaceGeneration,
                  advanceFromDirectory: true,
                  expectedDirectoryAsset: new Map(plan.directorySources).get(asset.relativePath) ?? null });
            }
            scheduleDirectoryFlush();
            result.syncStatus = 'queued';
          } catch (_) { result.syncStatus = 'pending'; }
        }
        return result;
      })();
      try { return cloneJsonLike(await plan.pending); }
      finally { plan.pending = null; }
    }

    async function currentPortableConfigStatus() {
      try {
        const status = typeof portableConfigManager?.publicStatus === 'function'
          ? await portableConfigManager.publicStatus()
          : await portableConfigManager?.status?.();
        return portableConfigStatus(status);
      } catch (error) {
        throw safePortableConfigError(error);
      }
    }

    async function runWithPortableConfigReady(operation) {
      try {
        return await portableConfigManager.runWhenReady(operation);
      } catch (error) {
        if (error?.code === 'PORTABLE_CONFIG_NOT_READY') {
          throw safePortableConfigError(error);
        }
        throw error;
      }
    }

    function operationFor(message) {
      return operationRegistry?.getOrCreate(message?.operationId) || null;
    }

    async function waitForOperation(operation) {
      if (!operation) return;
      await operationRegistry.waitIfPaused(operation);
      operationRegistry.throwIfCancelled(operation);
    }

    async function sleepForOperation(delay, operation) {
      await waitForOperation(operation);
      const signal = operation?.controller?.signal;
      if (!signal) return sleepImpl(delay);
      let onAbort;
      const cancelled = new Promise((resolve, reject) => {
        onAbort = () => reject(shared.operationError());
        signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        await Promise.race([sleepImpl(delay), cancelled]);
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
      await waitForOperation(operation);
    }

    function serializeDocumentMutation(operation) {
      const pending = documentMutationTail.then(operation, operation);
      documentMutationTail = pending.catch(() => undefined);
      return pending;
    }

    async function loadRouterSessionCategories() {
      if (sessionStorageArea) {
        return shared.loadSessionCategories(sessionStorageArea);
      }
      return memorySessionCategories.map(cloneJsonLike);
    }

    async function saveRouterSessionCategories(categories) {
      if (sessionStorageArea) {
        return shared.saveSessionCategories(sessionStorageArea, categories);
      }
      memorySessionCategories = Array.isArray(categories)
        ? categories.filter(item => item && typeof item === 'object').map(cloneJsonLike)
        : [];
      return memorySessionCategories.map(cloneJsonLike);
    }

    async function loadAllCategories(settings) {
      const sessionCustomCategories = await loadRouterSessionCategories();
      const savedCustomCategories = (settings.customCategories || [])
        .map(normalizeUnifiedCustomCategory);
      const normalizedSessionCategories = sessionCustomCategories
        .map(normalizeUnifiedCustomCategory);
      const customCategories = [...savedCustomCategories, ...normalizedSessionCategories];
      const categoryMap = shared.createUnifiedCategoryCatalog(settings.categoryOverrides);
      const deletedBuiltInCategoryIds = new Set(
        Array.isArray(settings.deletedBuiltInCategoryIds)
          ? settings.deletedBuiltInCategoryIds
          : []
      );
      deletedBuiltInCategoryIds.forEach(categoryId => {
        delete categoryMap[categoryId];
      });
      customCategories.forEach(category => { categoryMap[category.categoryId] = category; });
      return {
        savedCustomCategories,
        sessionCustomCategories: normalizedSessionCategories,
        customCategories,
        categoryMap
      };
    }

    async function publicState(settings) {
      const { customCategories, categoryMap } = await loadAllCategories(settings);
      const baseCatalog = shared.createUnifiedCategoryCatalog();
      const deletedBuiltInCategories = (settings.deletedBuiltInCategoryIds || [])
        .map(categoryId => baseCatalog[categoryId])
        .filter(Boolean)
        .map(publicCategory);
      return {
        settings: shared.toPublicSettings(settings),
        effectiveMode: shared.getEffectiveMode(settings),
        llmReady: shared.isLlmReady(settings),
        providers: shared.getProviderDefinitions(),
        compatibleProviderPresets: shared.getCompatibleProviderPresets(),
        panelFollowupDefaults: cloneJsonLike(shared.DEFAULT_PANEL_FOLLOWUP_PROMPTS || {}),
        panelFollowupPresetDefaults: cloneJsonLike(
          shared.DEFAULT_PANEL_FOLLOWUP_PRESETS || []
        ),
        articleChatQuickPromptDefaults: cloneJsonLike(
          shared.DEFAULT_ARTICLE_CHAT_QUICK_PROMPTS || []
        ),
        literatureNoteTemplateDefaults: cloneJsonLike(
          shared.DEFAULT_LITERATURE_NOTE_TEMPLATES || []
        ),
        selectionLlmActionDefaults: cloneJsonLike(
          shared.DEFAULT_SELECTION_ACTIONS || []
        ),
        customCategories,
        deletedBuiltInCategories,
        studyTypes: shared.STUDY_TYPES,
        readingViews: Object.fromEntries((settings.analysisModes || []).map(mode => [
          mode.id,
          {
            name: mode.name,
            description: mode.description,
            categoryIds: [...mode.categoryIds]
          }
        ])),
        highlightPresentation: {
          schemaVersion: shared.PRESENTATION_SCHEMA_VERSION || 1,
          displayFamilies: cloneJsonLike(shared.DISPLAY_FAMILIES || {}),
          viewVisibilityOverrides: cloneJsonLike(shared.VIEW_VISIBILITY_OVERRIDES || {}),
          studyViewRecommendations: cloneJsonLike(shared.STUDY_VIEW_RECOMMENDATIONS || {})
        },
        analysisModeDefaults: shared.createDefaultAnalysisModes(),
        availableCategories: Object.values(categoryMap).map(publicCategory)
      };
    }

    async function categoryDetail(settings, categoryId) {
      if (!/^[a-z][a-z0-9_]*$/.test(categoryId)) {
        throw invalidSettings(['categoryId']);
      }
      const baseCatalog = shared.createUnifiedCategoryCatalog();
      const baseCategory = baseCatalog[categoryId];
      if (baseCategory && (settings.deletedBuiltInCategoryIds || []).includes(categoryId)) {
        throw invalidSettings(['categoryId']);
      }
      const hasOverride = Boolean(baseCategory) && Object.prototype.hasOwnProperty.call(
        settings.categoryOverrides || {}, categoryId
      );
      let category;
      if (baseCategory) {
        category = shared.mergeCategoryOverrides(
          baseCategory,
          hasOverride ? settings.categoryOverrides[categoryId] : {}
        );
      } else {
        const { customCategories } = await loadAllCategories(settings);
        category = customCategories.find(item => item.categoryId === categoryId);
        if (!category) throw invalidSettings(['categoryId']);
      }
      const errors = shared.validateUnifiedCategory(category);
      if (errors.length) throw invalidSettings(errors);
      return {
        category,
        promptPreview: shared.compileCategoryPromptPreview(category),
        metadata: {
          builtIn: category.builtIn !== false,
          overridden: hasOverride
        }
      };
    }

    function requireLlmReady(settings) {
      if (!shared.isLlmReady(settings)) {
        const error = new Error('LLM mode is not ready');
        error.code = 'LLM_NOT_READY';
        throw error;
      }
    }

    function publicRoute(route) {
      const runtimeClass = taskRuntimeClass(route.taskType);
      return {
        taskType: route.taskType,
        requestedProfileId: route.requestedProfileId,
        effectiveProfileId: route.effectiveProfileId,
        effectiveProfileName: route.publicProfile.name,
        name: route.publicProfile.name,
        providerId: route.providerId,
        model: route.model,
        outputLanguage: route.outputLanguage || 'zh-CN',
        capabilityMode: route.capabilityMode,
        concurrency: TASK_CONCURRENCY[runtimeClass] || 1,
        fallbackReason: route.fallbackReason
      };
    }

    function createTaskAdapter(settings, taskId, context = {}, adapterOptions = {}) {
      const taskDefinition = shared.getLlmTaskDefinition(taskId);
      const taskPolicy = settings?.taskPolicies?.[taskId];
      const resolvedRoute = shared.resolveTaskProfile(settings, taskId);
      const effectiveTaskRule = shared.normalizeTaskTokenRule(taskId, taskPolicy.tokenRule);
      const capabilities = shared.getProviderCapabilities(
        resolvedRoute.providerId, resolvedRoute.config
      );
      const taskPolicySignature = buildTaskPolicySignature(settings, taskId);
      const cacheIdentitySignature = shared.stableHash({
        profileSignature: resolvedRoute.profileSignature,
        taskPolicySignature
      });
      const outputLanguage = typeof shared.normalizeInterfaceLanguage === 'function'
        ? shared.normalizeInterfaceLanguage(settings?.language) :
        (String(settings?.language || '').toLowerCase().startsWith('en') ? 'en' : 'zh-CN');
      const route = {
        ...resolvedRoute,
        capabilities,
        taskPolicySignature,
        profileSignature: cacheIdentitySignature,
        outputLanguage
      };
      const routePublic = publicRoute(route);
      const reportTaskProgress = event => context.onProgress?.({
        ...event,
        featureId: taskId,
        taskType: taskId,
        effectiveProfileId: route.effectiveProfileId,
        effectiveProfileName: route.publicProfile.name,
        route: routePublic
      });
      const providerRawAdapter = shared.createProviderAdapter({
        providerId: route.providerId,
        config: route.config,
        fetchImpl,
        nativeClient
      });
      const figureProviderAttemptBudget = context.figureProviderAttemptBudget || null;
      const figureProviderAttemptBinding = context.figureProviderAttemptBinding || null;
      const rawAdapter = figureProviderAttemptBudget &&
        typeof providerRawAdapter?.generateJson === 'function'
        ? Object.assign({}, providerRawAdapter, {
          async generateJson(request) {
            await context.validatePdfFigureDispatch?.(request);
            const dispatchCollector = request?.[FIGURE_PROVIDER_DISPATCH_COLLECTOR];
            const dispatchDigest = await figureProviderDispatchDigest(
              request, figureProviderAttemptBudget
            );
            const dispatch = await claimFigureProviderAttempt(
              figureProviderAttemptBudget,
              figureProviderAttemptBinding,
              {
                onProgress: reportTaskProgress,
                assertTrustedOwnerCurrent: context.assertTrustedOwnerCurrent
              },
              dispatchDigest
            );
            if (figureProviderAttemptBudget.abortSignal?.aborted) {
              await persistFigureProviderAttemptTerminal(
                figureProviderAttemptBudget, 'CANCELLED'
              );
              throw shared.operationError();
            }
            figureProviderAttemptBudget.inFlight += 1;
            try {
              let response;
              try {
                response = await providerRawAdapter.generateJson(request);
              } catch (error) {
                if (!ambiguousFigureTransportFailure(error)) {
                  const settledStatus = conclusiveFigureHttpRejection(error) ||
                    conclusiveFigureProviderRejection(error)
                    ? 'sealed' : 'responded';
                  await settleFigureProviderDispatch(
                    figureProviderAttemptBudget,
                    figureProviderAttemptBinding,
                    dispatch,
                    settledStatus
                  );
                  if (settledStatus === 'responded' && dispatchCollector instanceof Map) {
                    dispatchCollector.set(dispatch.attemptNumber, {
                      attemptNumber: dispatch.attemptNumber,
                      dispatchDigest: dispatch.dispatchDigest
                    });
                  }
                  throw error;
                }
                try {
                  await persistFigureProviderAttemptTerminal(
                    figureProviderAttemptBudget, 'FIGURE_REQUEST_REPLAY_AMBIGUOUS'
                  );
                } catch (cleanupError) {
                  const ambiguous = figureAttemptLimitError(
                    figureProviderAttemptBudget
                  );
                  ambiguous.causeCode = error?.code;
                  ambiguous.cleanupPending = true;
                  ambiguous.cleanupCode = cleanupError?.code ===
                    'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE'
                    ? cleanupError.code : 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE';
                  throw ambiguous;
                }
                const ambiguous = figureAttemptLimitError(figureProviderAttemptBudget);
                ambiguous.causeCode = error?.code;
                throw ambiguous;
              }
              await settleFigureProviderDispatch(
                figureProviderAttemptBudget,
                figureProviderAttemptBinding,
                dispatch,
                'responded'
              );
              if (dispatchCollector instanceof Map) {
                dispatchCollector.set(dispatch.attemptNumber, {
                  attemptNumber: dispatch.attemptNumber,
                  dispatchDigest: dispatch.dispatchDigest
                });
              }
              await assertFigureOwnerCurrent(context);
              return response;
            } finally {
              figureProviderAttemptBudget.inFlight -= 1;
              figureProviderAttemptBudget.lastTouchedAt = Number(nowImpl());
            }
          }
        })
        : providerRawAdapter;
      const tokenPolicyCap = Math.max(0, Number(adapterOptions.tokenPolicyCap) || 0);
      const effectiveTokenPolicy = tokenPolicyCap
        ? {
          ...route.tokenPolicy,
          ...(route.tokenPolicy?.mode === 'manual'
            ? { manualMax: Math.min(tokenPolicyCap, Number(route.tokenPolicy.manualMax) || tokenPolicyCap) }
            : { autoCap: Math.min(tokenPolicyCap, Number(route.tokenPolicy?.autoCap) || tokenPolicyCap) })
        }
        : route.tokenPolicy;
      const tokenManagedAdapter = shared.createTokenManagedAdapter({
        rawAdapter,
        kind: taskId,
        tokenPolicy: effectiveTokenPolicy,
        taskRule: effectiveTaskRule === 'auto' ? null : effectiveTaskRule,
        adapterCap: rawAdapter.maxOutputTokens,
        contextWindowTokens: rawAdapter.contextWindowTokens,
        reasoningProviderId: route.providerId,
        reasoningEnabled: route.effectiveReasoning?.enabled === true,
        reasoningEffort: route.effectiveReasoning?.effort || 'auto',
        requestTimeoutMs: Number.isFinite(adapterOptions.requestTimeoutMs) &&
          adapterOptions.requestTimeoutMs > 0
          ? adapterOptions.requestTimeoutMs
          : (TASK_TIMEOUTS_MS[taskRuntimeClass(taskId)] || 180000),
        progressHeartbeatMs: 15000,
        maxTokenLimitRetries: adapterOptions.maxTokenLimitRetries,
        maxTruncationRetries: adapterOptions.maxTruncationRetries,
        onProgress: event => context.onProgress?.({
          ...event,
          featureId: taskId,
          taskType: taskId,
          effectiveProfileId: route.effectiveProfileId,
          effectiveProfileName: route.publicProfile.name,
          route: routePublic
        })
      });
      const withLanguage = request => typeof shared.applyOutputLanguageContract === 'function'
        ? shared.applyOutputLanguageContract(request, outputLanguage) : request;
      const generateJsonAtLimit = request => {
        const localized = withLanguage(request);
        const upstreamTelemetry = localized.onProviderTelemetry;
        const maxOutputTokens = localized.maxOutputTokens;
        return rawAdapter.generateJson({
          ...localized,
          maxOutputTokens,
          onProviderTelemetry: event => {
            try { upstreamTelemetry?.(event); } catch {
              // Telemetry observers must not alter provider request handling.
            }
            reportTaskProgress({
              phase: 'provider_telemetry', maxOutputTokens, ...event
            });
          }
        });
      };
      const adapter = {
        ...tokenManagedAdapter,
        generateJson(request) {
          return tokenManagedAdapter.generateJson(withLanguage(request));
        },
        generateJsonAtLimit,
        analyzeChunk(request) {
          return tokenManagedAdapter.analyzeChunk(withLanguage(request));
        }
      };
      if (figureProviderAttemptBudget) {
        Object.defineProperty(adapter, 'figureProviderAttemptBudget', {
          value: figureProviderAttemptBudget,
          enumerable: false,
          writable: false,
          configurable: false
        });
        Object.defineProperty(adapter, 'figureProviderAttemptBinding', {
          value: figureProviderAttemptBinding,
          enumerable: false,
          writable: false,
          configurable: false
        });
      }
      if (typeof tokenManagedAdapter.generateTextStream === 'function') {
        adapter.generateTextStream = request =>
          tokenManagedAdapter.generateTextStream(withLanguage(request));
      }
      if (typeof tokenManagedAdapter.generateWebSearchTextStream === 'function') {
        adapter.generateWebSearchTextStream = request =>
          tokenManagedAdapter.generateWebSearchTextStream(withLanguage(request));
      }
      return {
        adapter,
        rawAdapter,
        route,
        routePublic,
        taskDefinition,
        taskPolicy,
        taskRule: effectiveTaskRule,
        tokenPolicy: effectiveTokenPolicy
      };
    }

    function requireSummaryJsonCapability(summaryTask) {
      if (typeof summaryTask?.rawAdapter?.generateJson === 'function' &&
          typeof summaryTask?.adapter?.generateJson === 'function') {
        return summaryTask;
      }
      const error = new Error('Summary structured JSON capability is unavailable');
      error.code = 'PROVIDER_CAPABILITY_UNAVAILABLE';
      error.fields = ['summary.generateJson'];
      throw error;
    }

    function routeProgress(context, routePublic) {
      return event => context.onProgress?.({
        ...event,
        taskType: routePublic.taskType,
        effectiveProfileId: routePublic.effectiveProfileId,
        effectiveProfileName: routePublic.effectiveProfileName,
        route: routePublic
      });
    }

    async function composeCategories(settings, profile) {
      const { customCategories } = await loadAllCategories(settings);
      const viewDefinition = (settings.analysisModes || [])
        .find(mode => mode.id === settings.readingViewId);
      return shared.composeReadingView({
        viewId: settings.readingViewId,
        viewDefinition,
        studyProfile: profile,
        override: settings.viewCategoryOverrides?.[settings.readingViewId],
        customCategories,
        categoryOverrides: settings.categoryOverrides,
        deletedBuiltInCategoryIds: settings.deletedBuiltInCategoryIds,
        engine: 'llm'
      });
    }

    async function composeManualCategories(settings, profile) {
      const { customCategories } = await loadAllCategories(settings);
      const viewDefinition = (settings.analysisModes || [])
        .find(mode => mode.id === settings.readingViewId);
      return shared.composeReadingView({
        viewId: settings.readingViewId,
        viewDefinition,
        studyProfile: profile,
        override: settings.viewCategoryOverrides?.[settings.readingViewId],
        customCategories,
        categoryOverrides: settings.categoryOverrides,
        deletedBuiltInCategoryIds: settings.deletedBuiltInCategoryIds
      });
    }

    function trustedNativePdfIdentity(document, context = {}) {
      const hint = document?.nativePdfIdentity;
      if (hint === undefined || hint === null) return null;
      let trusted = false;
      try {
        const sender = new URL(String(context.senderUrl || ''));
        const base = new URL(String(context.runtimeBaseUrl || ''));
        const expectedPath = `${base.pathname.replace(/\/$/, '')}/pdf-reader.html`
          .replace(/\/{2,}/g, '/');
        const expectedExtensionId = String(runtimeExtensionId || '');
        trusted = Boolean(expectedExtensionId) && context.trustedExtensionSender === true &&
          String(context.senderExtensionId || '') === expectedExtensionId &&
          /^(?:chrome|moz)-extension:$/.test(base.protocol) &&
          sender.protocol === base.protocol && sender.hostname === base.hostname &&
          sender.port === base.port && sender.host === base.host &&
          sender.pathname === expectedPath && !sender.username && !sender.password;
      } catch (_) {}
      if (!trusted) return null;
      const keys = isPlainObject(hint) ? Object.keys(hint).sort() : [];
      const documentHash = String(hint?.documentHash || '').trim().toLowerCase();
      const documentId = String(hint?.documentId || '').trim().toLowerCase();
      const revision = Number(hint?.revision);
      if (!isPlainObject(hint) ||
          keys.join(',') !== 'adapterId,documentHash,documentId,revision' ||
          hint.adapterId !== 'pdf-native' || !/^[a-f0-9]{64}$/.test(documentHash) ||
          documentId !== `sha256:${documentHash}` ||
          !Number.isSafeInteger(revision) || revision < 1 || revision > 1000000) {
        throw invalidSettings(['nativePdfIdentity']);
      }
      return { documentId, documentHash, revision };
    }

    async function prepareStoredDocumentUnsafe(settings, document, context = {}, captureCreation = false) {
      const paragraphs = Array.isArray(document?.paragraphs) ? document.paragraphs : [];
      if (!paragraphs.length) throw invalidSettings(['paragraphs']);
      const paragraphDocumentHash = await shared.hashDocument(paragraphs);
      const nativeIdentity = trustedNativePdfIdentity(document, context);
      const documentHash = nativeIdentity?.documentHash || paragraphDocumentHash;
      const computedDocumentId = await shared.createDocumentId({
        title: document?.title,
        canonicalUrl: document?.canonicalUrl || document?.url,
        doi: document?.doi,
        paragraphs
      });
      const requestedDocumentId = String(document?.documentId || '').trim();
      const previousDocumentHash = String(document?.previousDocumentHash || '').toLowerCase();
      let documentId = nativeIdentity?.documentId || computedDocumentId;
      if (!nativeIdentity && requestedDocumentId && /^[a-f0-9]{64}$/.test(previousDocumentHash)) {
        try {
          const existing = await documentStore.getDocument(requestedDocumentId);
          const knownHashes = new Set([
            existing?.documentHash,
            ...(Array.isArray(existing?.documentHashes) ? existing.documentHashes : [])
          ].filter(Boolean));
          if (existing && knownHashes.has(previousDocumentHash)) {
            documentId = requestedDocumentId;
          }
        } catch (_) {
          // Ignore stale or malformed identities and fall back to the current extraction.
        }
      }
      documentIdsByHash.set(documentHash, documentId);
      const legacyStudyType = settings.studyTypeOverrides?.[documentHash]?.studyType;
      const input = {
        schemaVersion: 1,
        documentId,
        title: document?.title || '',
        canonicalUrl: document?.canonicalUrl || document?.url || '',
        studyType: shared.isStudyType(legacyStudyType) ? legacyStudyType : null,
        annotations: [],
        revision: 0,
        updatedAt: '',
        documentHash,
        documentHashes: [...new Set([documentHash, paragraphDocumentHash])],
        ...(nativeIdentity ? { nativePdfRevision: nativeIdentity.revision } : {}),
        legacyStudyTypeMigrated: true
      };
      const documentCreationInfo = captureCreation &&
        typeof documentStore.prepareDocumentWithCreationInfo === 'function'
        ? await documentStore.prepareDocumentWithCreationInfo(input) : null;
      const record = documentCreationInfo?.record || await documentStore.prepareDocument(input);
      const profile = shared.createManualStudyProfile(record.studyType, document) || {
          ...shared.createFallbackStudyProfile('使用当前分析模式，不需要选择论文类型。'),
          primaryType: '',
          paperBlueprint: shared.deriveManualPaperBlueprint(document),
          requiresConfirmation: false,
          useTypeSpecificWarnings: false,
          manuallyOverridden: false
        };
      const composition = await composeManualCategories(settings, profile);
      return { documentId, documentHash, record, profile, composition, paragraphs,
        ...(documentCreationInfo ? { documentCreationInfo } : {}) };
    }

    function prepareStoredDocument(settings, document, context = {}, captureCreation = false) {
      return serializeDocumentMutation(() =>
        prepareStoredDocumentUnsafe(settings, document, context, captureCreation)
      );
    }

    async function prepareDocument(settings, document) {
      requireLlmReady(settings);
      const stored = await prepareStoredDocument(settings, document);
      const { documentId, documentHash, record, profile, paragraphs } = stored;
      const composition = await composeCategories(settings, profile);
      return {
        documentId,
        documentHash,
        record,
        requiresStudyType: !profile,
        studyProfile: profile,
        paperBlueprint: profile?.paperBlueprint || null,
        readingViewId: composition.viewId,
        activeCategories: composition.categories,
        categorySources: composition.sources,
        paragraphs
      };
    }

    async function prepareParagraphOnlyReviewDocument(settings, message, requestedParagraphIds) {
      requireLlmReady(settings);
      const paragraphs = Array.isArray(message?.document?.paragraphs)
        ? message.document.paragraphs : [];
      const proof = message?.documentProof || {};
      const documentId = String(proof.documentId || '').trim();
      const documentHash = String(proof.documentHash || '').toLowerCase();
      const suppliedParagraphIds = paragraphs.map(paragraph =>
        String(paragraph?.paragraphId || '').trim()
      ).filter(Boolean);
      const suppliedIdSet = new Set(suppliedParagraphIds);
      if (!requestedParagraphIds.size || !paragraphs.length ||
          paragraphs.length !== requestedParagraphIds.size ||
          suppliedIdSet.size !== paragraphs.length ||
          !suppliedParagraphIds.every(id => requestedParagraphIds.has(id))) {
        throw invalidSettings(['scopeParagraphIds', 'paragraphs']);
      }
      if (!documentId || !/^[a-f0-9]{64}$/.test(documentHash)) {
        throw invalidSettings(['documentProof']);
      }
      const record = await documentStore.getDocument(documentId);
      const knownHashes = new Set([
        record?.documentHash,
        ...(Array.isArray(record?.documentHashes) ? record.documentHashes : [])
      ].map(value => String(value || '').toLowerCase()).filter(Boolean));
      if (!record || !knownHashes.has(documentHash)) {
        throw invalidSettings(['documentProof']);
      }
      const profile = shared.createManualStudyProfile(record.studyType, message.document) || {
          ...shared.createFallbackStudyProfile('使用当前分析模式，不需要选择论文类型。'),
          primaryType: '',
          paperBlueprint: shared.deriveManualPaperBlueprint(message.document),
          requiresConfirmation: false,
          useTypeSpecificWarnings: false,
          manuallyOverridden: false
        };
      const composition = await composeCategories(settings, profile);
      documentIdsByHash.set(documentHash, documentId);
      return {
        documentId,
        documentHash,
        record,
        requiresStudyType: !profile,
        studyProfile: profile,
        paperBlueprint: profile?.paperBlueprint || null,
        readingViewId: composition.viewId,
        activeCategories: composition.categories,
        categorySources: composition.sources,
        paragraphs
      };
    }

    let settingsMutationTail = Promise.resolve();
    let literatureNoteMutationTail = Promise.resolve();
    const LITERATURE_NOTE_STORAGE_KEY = 'sciLiteratureNotesV1';
    const LITERATURE_NOTE_STORAGE_MAX_UTF8_BYTES = 16 * 1024 * 1024;

    function serializeSettingsMutation(operation) {
      const pending = settingsMutationTail.then(operation, operation);
      settingsMutationTail = pending.catch(() => undefined);
      return pending;
    }

    function serializeAllMutations(operation) {
      const pending = Promise.all([
        settingsMutationTail.catch(() => undefined),
        documentMutationTail.catch(() => undefined)
      ]).then(operation);
      const settled = pending.catch(() => undefined);
      settingsMutationTail = settled;
      documentMutationTail = settled;
      return pending;
    }

    function requireCurrentSettings(settings) {
      if (Number(settings?.version) !== 6) throw invalidSettings(['version']);
    }

    function orderedProfileIds(settings) {
      const profiles = isPlainObject(settings?.profiles) ? settings.profiles : {};
      const seen = new Set();
      const result = [];
      (Array.isArray(settings?.profileOrder) ? settings.profileOrder : [])
        .forEach(profileId => {
          if (typeof profileId !== 'string' || seen.has(profileId) ||
              !Object.prototype.hasOwnProperty.call(profiles, profileId)) return;
          seen.add(profileId);
          result.push(profileId);
        });
      Object.keys(profiles).sort().forEach(profileId => {
        if (seen.has(profileId)) return;
        seen.add(profileId);
        result.push(profileId);
      });
      return result;
    }

    function publicProfileResult(profileId, profile) {
      const config = isPlainObject(profile?.config) ? profile.config : {};
      return {
        id: profileId,
        name: String(profile?.name || ''),
        providerId: profile?.providerId,
        model: String(config.model || ''),
        supportsVision: shared.getProviderCapabilities(
          profile?.providerId,
          config
        ).supportsVision === true
      };
    }

    function upsertProfile(settings, message) {
      requireCurrentSettings(settings);
      const incoming = isPlainObject(message?.profile) ? message.profile : message;
      const profileId = String(
        incoming?.id || incoming?.profileId || message?.profileId || ''
      );
      if (!shared.PROFILE_ID_PATTERN?.test(profileId)) {
        throw invalidSettings(['profileId']);
      }
      const current = isPlainObject(settings.profiles?.[profileId])
        ? settings.profiles[profileId] : null;
      const providerId = String(incoming?.providerId || current?.providerId || '');
      if (!Object.prototype.hasOwnProperty.call(
        shared.getProviderDefinitions(), providerId
      )) throw invalidSettings(['providerId']);
      if (incoming?.config !== undefined && !isPlainObject(incoming.config)) {
        throw invalidSettings(['config']);
      }

      const currentConfig = isPlainObject(current?.config) ? current.config : {};
      const incomingConfig = isPlainObject(incoming?.config) ? incoming.config : {};
      const config = { ...cloneJsonLike(currentConfig), ...cloneJsonLike(incomingConfig) };
      if (message?.clearApiKey === true) {
        config.apiKey = '';
      } else if (!String(incomingConfig.apiKey || '').trim() && currentConfig.apiKey) {
        config.apiKey = currentConfig.apiKey;
      }
      const candidate = {
        ...cloneJsonLike(current || {}),
        ...cloneJsonLike(incoming || {}),
        name: incoming?.name !== undefined ? incoming.name : current?.name,
        providerId,
        config,
        capabilities: incoming?.capabilities !== undefined
          ? cloneJsonLike(incoming.capabilities)
          : cloneJsonLike(current?.capabilities || {}),
        tokenPolicy: incoming?.tokenPolicy !== undefined
          ? cloneJsonLike(incoming.tokenPolicy)
          : cloneJsonLike(current?.tokenPolicy || {})
      };
      const normalized = shared.normalizeProfile(profileId, candidate);
      if (!normalized) throw invalidSettings(['profileId', 'providerId']);

      settings.profiles = isPlainObject(settings.profiles) ? settings.profiles : {};
      settings.profiles[profileId] = normalized;
      settings.profileOrder = orderedProfileIds(settings);
      if (!Object.prototype.hasOwnProperty.call(
        settings.profiles,
        settings.globalProfileId
      )) settings.globalProfileId = settings.profileOrder[0] || profileId;
      settings.taskPolicies = shared.normalizeTaskPolicies(
        settings.taskPolicies,
        settings.profiles
      );
      return { profileId, profile: normalized };
    }

    function duplicateProfileId(settings, sourceId) {
      const sourceStem = String(sourceId || '').replace(/^profile_/, '')
        .replace(/[^a-z0-9_]/g, '_').slice(0, 64) || 'copy';
      let suffix = 'copy';
      let sequence = 1;
      while (true) {
        const room = Math.max(3, 80 - 'profile_'.length - suffix.length - 1);
        const candidate = `profile_${sourceStem.slice(0, room)}_${suffix}`;
        if (!Object.prototype.hasOwnProperty.call(settings.profiles, candidate)) {
          return candidate;
        }
        sequence += 1;
        suffix = `copy_${sequence}`;
      }
    }

    async function runConnectionTest(profileId, profile, configOverride, probeIds = null) {
      const currentConfig = isPlainObject(profile?.config) ? profile.config : {};
      const incomingConfig = isPlainObject(configOverride) ? configOverride : {};
      const config = { ...cloneJsonLike(currentConfig), ...cloneJsonLike(incomingConfig) };
      if (!String(incomingConfig.apiKey || '').trim() && currentConfig.apiKey) {
        config.apiKey = currentConfig.apiKey;
      }
      const errors = shared.validateProviderConfig(profile?.providerId, config);
      if (errors.length) throw invalidSettings(errors, PROVIDER_SETTINGS_MESSAGE);
      const adapter = shared.createProviderAdapter({
        providerId: profile.providerId,
        config,
        fetchImpl,
        nativeClient
      });
      const localStatus = profile.providerId === 'codex-local' &&
          typeof adapter.testConnection === 'function'
        ? await adapter.testConnection({ timeoutMs: 120000 }) : {};
      const registryCapability = shared.getProviderCapabilities(
        profile.providerId, config
      )?.supportsVision === true;
      const supportsVision = registryCapability;
      const reasoningCapability = typeof shared.getProviderReasoningCapabilities === 'function'
        ? shared.getProviderReasoningCapabilities(profile.providerId, config)
        : { supported: false, mode: 'none', levels: [], defaultLevel: 'auto' };
      const probeResult = await shared.runProviderCapabilityProbes(adapter, {
        typedDecisions: adapter.typedDecisions === true,
        supportsVision,
        reasoningCapability,
        configuredReasoningEffort: config.reasoningEffort,
        probeIds: Array.isArray(probeIds) ? probeIds : undefined,
        timeoutMs: profile.providerId === 'codex-local' ? 120000 : 30000
      });
      if (!probeResult.connected) {
        const failed = probeResult.probes.find(item => item.status === 'failed');
        const error = new Error(`Provider ${failed?.id || 'capability'} probe failed`);
        error.code = failed?.code || 'INVALID_RESPONSE';
        error.probeId = failed?.id || '';
        error.diagnosticStage = failed?.diagnosticStage || '';
        error.diagnosticType = failed?.diagnosticType || '';
        if (Number.isFinite(failed?.requestBytes)) error.requestBytes = failed.requestBytes;
        if (Number.isFinite(failed?.elapsedMs)) error.elapsedMs = failed.elapsedMs;
        throw error;
      }
      return {
        connected: true,
        connectivity: probeResult.connectivity,
        capabilitiesReady: probeResult.capabilitiesReady,
        profileId,
        providerId: profile.providerId,
        model: config.model || 'auto',
        accountType: localStatus?.accountType || '',
        planType: localStatus?.planType || '',
        userAgent: localStatus?.userAgent || '',
        probes: probeResult.probes,
        warnings: probeResult.warnings,
        diagnostics: probeResult.diagnostics,
        estimatedInputTokens: probeResult.estimatedInputTokens,
        measuredInputTokens: probeResult.measuredInputTokens
      };
    }

    function literatureNoteError(code) {
      const error = new Error(code);
      error.code = code;
      return error;
    }

    function storageGetOne(key) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const done = value => {
          if (settled) return;
          settled = true;
          let runtimeError = null;
          try { runtimeError = getRuntimeLastError?.() || null; } catch (_) {}
          if (runtimeError) {
            reject(runtimeError);
            return;
          }
          resolve(value || {});
        };
        try {
          const pending = storageArea.get(key, done);
          if (pending?.then) pending.then(done, reject);
        } catch (error) { reject(error); }
      });
    }

    function storageSetOne(value) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          let runtimeError = null;
          try { runtimeError = getRuntimeLastError?.() || null; } catch (_) {}
          if (runtimeError) {
            reject(runtimeError);
            return;
          }
          resolve();
        };
        try {
          const pending = storageArea.set(value, done);
          if (pending?.then) pending.then(done, reject);
        } catch (error) { reject(error); }
      });
    }

    function serializeLiteratureNoteMutation(operation) {
      const pending = literatureNoteMutationTail.then(operation, operation);
      literatureNoteMutationTail = pending.catch(() => undefined);
      return pending;
    }

    function normalizeLiteratureNoteDeltaMessage(message, context) {
      let trustedExtensionPage = false;
      try {
        const sender = new URL(String(context.senderUrl || ''));
        const base = new URL(String(context.runtimeBaseUrl || ''));
        trustedExtensionPage = Boolean(runtimeExtensionId) &&
          String(context.senderExtensionId || '') === String(runtimeExtensionId) &&
          /^(?:chrome|moz)-extension:$/.test(base.protocol) &&
          sender.protocol === base.protocol && sender.hostname === base.hostname &&
          sender.port === base.port && sender.host === base.host &&
          sender.pathname.startsWith(base.pathname) &&
          !sender.username && !sender.password;
      } catch (_) {}
      if (!trustedExtensionPage) {
        throw literatureNoteError('LITERATURE_NOTE_SENDER_INVALID');
      }
      const documentKey = typeof message.documentKey === 'string'
        ? message.documentKey.normalize('NFKC').trim() : '';
      const legacyKey = typeof message.legacyKey === 'string'
        ? message.legacyKey.normalize('NFKC').trim() : '';
      const delta = isPlainObject(message.delta) ? message.delta : null;
      const fields = Array.isArray(delta?.fields) ? delta.fields : null;
      const safeObjectKey = value => {
        const normalized = typeof value === 'string'
          ? value.normalize('NFKC').trim() : '';
        return normalized && !['__proto__', 'prototype', 'constructor']
          .includes(normalized.toLowerCase()) ? normalized : '';
      };
      const safeId = value => typeof value === 'string' &&
        /^[a-z][a-z0-9_]{0,79}$/u.test(value) &&
        !['__proto__', 'prototype', 'constructor'].includes(value)
        ? value : '';
      if (!safeObjectKey(documentKey) || documentKey.length > 800 ||
          /[\u0000-\u001F\u007F]/u.test(documentKey) ||
          (legacyKey && !safeObjectKey(legacyKey)) || legacyKey.length > 128 ||
          /[\u0000-\u001F\u007F]/u.test(legacyKey) ||
          !delta || !fields || fields.length > 800 || !safeId(delta.templateId || '')) {
        throw literatureNoteError('LITERATURE_NOTE_DELTA_INVALID');
      }
      // Absence retains the legacy field-delta behavior. Explicit controls are
      // strict so an invalid selection can never silently become a body write.
      let templateSelection;
      if (Object.hasOwn(delta, 'templateSelection')) {
        const control = delta.templateSelection;
        if (!isPlainObject(control) ||
            !['preserve', 'set'].includes(control.mode) ||
            (control.mode === 'preserve' && Object.keys(control).length !== 1) ||
            (control.mode === 'set' && (
              Object.keys(control).length !== 3 ||
              (control.expectedTemplateId !== '' && !safeId(control.expectedTemplateId)) ||
              !Number.isSafeInteger(control.expectedUpdatedAt) ||
              control.expectedUpdatedAt < 0))) {
          throw literatureNoteError('LITERATURE_NOTE_DELTA_INVALID');
        }
        templateSelection = control.mode === 'preserve' ? { mode: 'preserve' } : {
          mode: 'set', expectedTemplateId: control.expectedTemplateId,
          expectedUpdatedAt: control.expectedUpdatedAt
        };
      }
      const fieldCountsByTemplate = new Map();
      const normalizedFields = fields.map(field => {
        if (!isPlainObject(field)) throw literatureNoteError('LITERATURE_NOTE_DELTA_INVALID');
        const templateId = safeId(field.templateId);
        const fieldId = safeId(field.fieldId);
        const key = `${templateId}\u0000${fieldId}`;
        const value = typeof field.value === 'string'
          ? field.value.normalize('NFC') : '';
        const status = field.status === null || field.status === undefined
          ? null : String(field.status);
        const hasEvidence = Object.hasOwn(field, 'evidence');
        const evidence = !hasEvidence || field.evidence === null
          ? null : shared.normalizeLiteratureNoteEvidenceRecord?.(field.evidence);
        const hasFieldUpdatedAt = Object.hasOwn(field, 'fieldUpdatedAt');
        const fieldUpdatedAt = field.fieldUpdatedAt === null ||
          field.fieldUpdatedAt === undefined ? null : Number(field.fieldUpdatedAt);
        const revision = Number(field.revision);
        if (!templateId || !fieldId || field.key !== key || value.length > 12000 ||
            /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value) ||
            ![null, 'supported', 'missing'].includes(status) ||
            (hasEvidence && field.evidence !== null && !evidence) ||
            (hasFieldUpdatedAt && fieldUpdatedAt !== null &&
              (!Number.isSafeInteger(fieldUpdatedAt) || fieldUpdatedAt < 1)) ||
            !Number.isSafeInteger(revision) || revision < 1 ||
            (status === 'missing' && value) || (status === 'supported' && !value)) {
          throw literatureNoteError('LITERATURE_NOTE_DELTA_INVALID');
        }
        fieldCountsByTemplate.set(
          templateId, Number(fieldCountsByTemplate.get(templateId) || 0) + 1
        );
        if (fieldCountsByTemplate.size > 20 ||
            fieldCountsByTemplate.get(templateId) > 40) {
          throw literatureNoteError('LITERATURE_NOTE_DELTA_INVALID');
        }
        return { key, templateId, fieldId, value, status, revision,
          hasEvidence, evidence, hasFieldUpdatedAt, fieldUpdatedAt };
      });
      const serialized = JSON.stringify({ documentKey, legacyKey, delta: {
        templateId: delta.templateId, fields: normalizedFields, templateSelection
      } });
      let serializedBytes = 0;
      for (let index = 0; index < serialized.length; index += 1) {
        const code = serialized.charCodeAt(index);
        if (code < 0x80) serializedBytes += 1;
        else if (code < 0x800) serializedBytes += 2;
        else if (code >= 0xD800 && code <= 0xDBFF &&
            index + 1 < serialized.length &&
            serialized.charCodeAt(index + 1) >= 0xDC00 &&
            serialized.charCodeAt(index + 1) <= 0xDFFF) {
          serializedBytes += 4;
          index += 1;
        } else serializedBytes += 3;
      }
      if (serializedBytes > 2 * 1024 * 1024) {
        throw literatureNoteError('LITERATURE_NOTE_DELTA_INVALID');
      }
      return {
        documentKey,
        legacyKey,
        delta: { templateId: delta.templateId, fields: normalizedFields,
          ...(templateSelection ? { templateSelection } : {}) }
      };
    }

    async function commitLiteratureNoteDelta(message, context) {
      const request = normalizeLiteratureNoteDeltaMessage(message, context);
      return serializeLiteratureNoteMutation(async () => {
        let stored;
        try {
          stored = await storageGetOne(LITERATURE_NOTE_STORAGE_KEY);
        } catch (_) {
          throw literatureNoteError('LITERATURE_NOTE_STORAGE_FAILED');
        }
        const previous = isPlainObject(stored?.[LITERATURE_NOTE_STORAGE_KEY])
          ? stored[LITERATURE_NOTE_STORAGE_KEY] : {};
        const entries = Object.assign(Object.create(null),
          isPlainObject(previous.entries) ? cloneJsonLike(previous.entries) : {});
        const base = shared.normalizeLiteratureNoteDocumentState(
          entries[request.documentKey] || (request.legacyKey && entries[request.legacyKey])
        );
        const control = request.delta.templateSelection;
        const templateSelectionBase = {
          templateId: base.templateId, updatedAt: Number(base.updatedAt) || 0
        };
        const ack = state => ({ saved: true, state,
          ...(control ? { templateSelectionBase } : {}) });
        if (control?.mode === 'set' && (
          control.expectedTemplateId !== templateSelectionBase.templateId ||
          control.expectedUpdatedAt !== templateSelectionBase.updatedAt)) {
          throw literatureNoteError('LITERATURE_NOTE_TEMPLATE_CONFLICT');
        }
        const changedTemplate = control?.mode === 'set' &&
          request.delta.templateId !== base.templateId;
        if (!request.delta.fields.length && !changedTemplate) {
          return ack(base);
        }
        const hasAnyExplicitFieldRevision = Object.values(
          base.fieldUpdatedAtByTemplate || {}
        ).some(fields => Object.keys(fields || {}).length > 0);
        const previousDocumentUpdatedAt = Number(base.updatedAt) || 0;
        if (!hasAnyExplicitFieldRevision && previousDocumentUpdatedAt > 0) {
          const templateIds = new Set([
            ...Object.keys(base.valuesByTemplate || {}),
            ...Object.keys(base.fieldStatusByTemplate || {}),
            ...Object.keys(base.fieldEvidenceByTemplate || {})
          ]);
          templateIds.forEach(templateId => {
            const fieldIds = new Set([
              ...Object.keys(base.valuesByTemplate?.[templateId] || {}),
              ...Object.keys(base.fieldStatusByTemplate?.[templateId] || {}),
              ...Object.keys(base.fieldEvidenceByTemplate?.[templateId] || {})
            ]);
            if (!fieldIds.size) return;
            base.fieldUpdatedAtByTemplate[templateId] ||= Object.create(null);
            fieldIds.forEach(fieldId => {
              base.fieldUpdatedAtByTemplate[templateId][fieldId] =
                previousDocumentUpdatedAt;
            });
          });
        }
        let appliedField = false;
        request.delta.fields.forEach(field => {
          base.fieldUpdatedAtByTemplate ||= Object.create(null);
          base.fieldUpdatedAtByTemplate[field.templateId] ||= Object.create(null);
          const previousFieldUpdatedAt = Number(
            base.fieldUpdatedAtByTemplate[field.templateId][field.fieldId]
          ) || 0;
          let nextFieldUpdatedAt;
          if (field.hasFieldUpdatedAt && field.fieldUpdatedAt) {
            if (field.fieldUpdatedAt < previousFieldUpdatedAt) return;
            if (field.fieldUpdatedAt === previousFieldUpdatedAt) {
              const current = {
                value: String(base.valuesByTemplate?.[field.templateId]?.[field.fieldId] || ''),
                status: base.fieldStatusByTemplate?.[field.templateId]?.[field.fieldId] || null,
                evidence: base.fieldEvidenceByTemplate?.[field.templateId]?.[field.fieldId] || null
              };
              const incoming = {
                value: field.value,
                status: field.status,
                evidence: field.hasEvidence && field.evidence ? field.evidence : null
              };
              if (jsonLikeEqual(current, incoming)) return;
              return;
            }
            nextFieldUpdatedAt = field.fieldUpdatedAt;
          } else {
            nextFieldUpdatedAt = Math.max(
              previousFieldUpdatedAt + 1,
              Math.max(1, Number(nowImpl()) || Date.now())
            );
          }
          base.valuesByTemplate[field.templateId] ||= Object.create(null);
          base.fieldStatusByTemplate[field.templateId] ||= Object.create(null);
          base.fieldEvidenceByTemplate[field.templateId] ||= Object.create(null);
          if (field.value) base.valuesByTemplate[field.templateId][field.fieldId] = field.value;
          else delete base.valuesByTemplate[field.templateId][field.fieldId];
          if (field.status) {
            base.fieldStatusByTemplate[field.templateId][field.fieldId] = field.status;
          } else {
            delete base.fieldStatusByTemplate[field.templateId][field.fieldId];
          }
          if (field.hasEvidence && field.evidence) {
            base.fieldEvidenceByTemplate[field.templateId][field.fieldId] = field.evidence;
          } else {
            delete base.fieldEvidenceByTemplate[field.templateId][field.fieldId];
          }
          base.fieldUpdatedAtByTemplate[field.templateId][field.fieldId] =
            nextFieldUpdatedAt;
          appliedField = true;
        });
        if (!appliedField && !changedTemplate) return ack(base);
        if (!control || control.mode === 'set') {
          base.templateId = request.delta.templateId || base.templateId;
        }
        const latestFieldUpdatedAt = request.delta.fields.reduce((latest, field) =>
          Math.max(latest, Number(
            base.fieldUpdatedAtByTemplate?.[field.templateId]?.[field.fieldId]
          ) || 0), 0);
        base.updatedAt = Math.max(
          control ? previousDocumentUpdatedAt + 1 : 0,
          latestFieldUpdatedAt, Math.max(0, Number(nowImpl()) || Date.now())
        );
        if (control && (!Number.isSafeInteger(base.updatedAt) ||
            base.updatedAt <= previousDocumentUpdatedAt)) {
          throw literatureNoteError('LITERATURE_NOTE_DELTA_INVALID');
        }
        const documentBudget = shared.measureLiteratureNoteDocumentState?.(base);
        if (!documentBudget?.withinBudget) {
          throw literatureNoteError('LITERATURE_NOTE_DOCUMENT_TOO_LARGE');
        }
        const state = shared.normalizeLiteratureNoteDocumentState(base);
        entries[request.documentKey] = state;
        if (request.legacyKey && request.legacyKey !== request.documentKey) {
          delete entries[request.legacyKey];
        }
        if (Object.keys(entries).length > 200) {
          throw literatureNoteError('LITERATURE_NOTE_STORAGE_TOO_LARGE');
        }
        const orderedEntries = Object.assign(Object.create(null),
          Object.fromEntries(Object.entries(entries)
            .sort((left, right) => Number(right[1]?.updatedAt) - Number(left[1]?.updatedAt))));
        const nextStorage = {
          schemaVersion: 3,
          entries: orderedEntries
        };
        if (jsonLikeByteSize(nextStorage) > LITERATURE_NOTE_STORAGE_MAX_UTF8_BYTES) {
          throw literatureNoteError('LITERATURE_NOTE_STORAGE_TOO_LARGE');
        }
        try {
          await storageSetOne({
            [LITERATURE_NOTE_STORAGE_KEY]: nextStorage
          });
        } catch (_) {
          throw literatureNoteError('LITERATURE_NOTE_STORAGE_FAILED');
        }
        return ack(state);
      });
    }

    function categoryAsset(settings) {
      return {
        schemaVersion: 1,
        revision: Number(settings.userDataCategoryRevision) || 0,
        sourceId: 'extension',
        categoryOverrides: cloneJsonLike(settings.categoryOverrides || {}),
        deletedBuiltInCategoryIds: [...(settings.deletedBuiltInCategoryIds || [])],
        customCategories: cloneJsonLike(settings.customCategories || []),
        selectedCategoryIds: [...(settings.selectedCategoryIds || [])],
        viewCategoryOverrides: cloneJsonLike(settings.viewCategoryOverrides || {})
      };
    }

    function scheduleDirectoryFlush() {
      if (!directorySync?.flush) return;
      try {
        Promise.resolve(directorySync.flush(importUserDataAsset)).catch(() => undefined);
      } catch (_) {
        // Directory availability must never roll back a successful local mutation.
      }
    }

    async function mirrorJson(relativePath, value) {
      if (!directorySync?.enqueueJson) return;
      try {
        await directorySync.enqueueJson(relativePath, value);
        scheduleDirectoryFlush();
      } catch (_) {
        // The primary local stores remain authoritative while sync is unavailable.
      }
    }

    async function mirrorText(relativePath, value) {
      if (!directorySync?.enqueueText) return;
      try {
        await directorySync.enqueueText(relativePath, value);
        scheduleDirectoryFlush();
      } catch (_) {
        // The primary local stores remain authoritative while sync is unavailable.
      }
    }

    async function mirrorCategorySettings(settings) {
      await mirrorJson('categories.json', categoryAsset(settings));
    }

    async function mirrorDocumentRecord(record) {
      if (!record?.documentId) return;
      await mirrorJson(
        `annotations/${encodeURIComponent(record.documentId)}.json`,
        cloneJsonLike(record)
      );
    }

    function isWordCharacter(value) {
      return Boolean(value) && /[\p{L}\p{N}_]/u.test(value);
    }

    function regexMatches(regex, text, expressionRow, wholeWord) {
      const matches = [];
      let match;
      while ((match = regex.exec(text)) && matches.length <= 100) {
        const value = match[0];
        if (!value) {
          regex.lastIndex = Math.max(regex.lastIndex + 1, match.index + 1);
          continue;
        }
        const start = match.index;
        const end = start + value.length;
        if (!wholeWord || (
          !isWordCharacter(text[start - 1]) && !isWordCharacter(text[end])
        )) {
          matches.push({ expressionRow, start, end, text: value });
        }
      }
      return matches;
    }

    function escapeRegex(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function testCategoryRegex(category, text) {
      const flags = category.regex.caseSensitive ? 'g' : 'gi';
      const matches = [];
      const exclusions = [];
      (category.regex.excludePhrases || []).forEach((phrase, index) => {
        if (!phrase) return;
        exclusions.push(...regexMatches(
          new RegExp(escapeRegex(phrase), flags),
          text,
          `excludePhrase:${index}`,
          category.regex.wholeWord
        ));
      });
      category.regex.phrases.forEach((phrase, index) => {
        if (!phrase) return;
        matches.push(...regexMatches(
          new RegExp(escapeRegex(phrase), flags),
          text,
          `phrase:${index}`,
          category.regex.wholeWord
        ));
      });
      category.regex.expressions.forEach((expression, index) => {
        matches.push(...regexMatches(
          new RegExp(expression, flags),
          text,
          `expression:${index}`,
          category.regex.wholeWord
        ));
      });
      matches.sort((left, right) =>
        left.start - right.start || left.end - right.end ||
        left.expressionRow.localeCompare(right.expressionRow)
      );
      const included = matches.filter(match => !exclusions.some(excluded =>
        excluded.start < match.end && excluded.end > match.start
      ));
      return {
        matches: included.slice(0, 100),
        excludedCount: matches.length - included.length,
        truncated: included.length > 100
      };
    }

    function validFigureAnalysisId(value) {
      const figureId = String(value || '');
      return /^figure-(?:s|ed)?\d{1,3}$/.test(figureId) ||
        /^supp-[a-z0-9](?:[a-z0-9-]{0,47})-[a-z0-9](?:[a-z0-9-]{0,23})$/
          .test(figureId);
    }

    function normalizeFigureInput(value, articleTitle, verifiedPdf = false) {
      const figureId = String(value?.figureId || '').trim();
      const evidenceText = (text, maximum) =>
        typeof shared.cleanPanelSourceText === 'function'
        ? shared.cleanPanelSourceText(text, maximum)
        : String(text || '').normalize('NFKC')
          .replace(/\s+/g, ' ').trim().slice(0, maximum);
      const caption = evidenceText(value?.caption, verifiedPdf ? 100000 : 8000);
      const images = shared.normalizeImageInputs(value?.images);
      if (verifiedPdf && images.length !== value.images.length) {
        throw figureContractError('PDF_FIGURE_ASSET_BYTES_INVALID');
      }
      if (!validFigureAnalysisId(figureId) || (!caption && !images.length)) {
        throw invalidSettings(['figures']);
      }
      const imageVariants = (Array.isArray(value?.imageVariants) ? value.imageVariants : [])
        .slice(0, 6).map(candidate => {
          const image = shared.normalizeImageInputs([candidate], { maxImages: 1 })[0];
          const width = Math.max(0, Math.round(Number(candidate?.width) || 0));
          const height = Math.max(0, Math.round(Number(candidate?.height) || 0));
          if (!image || !width || !height) return null;
          return {
            ...image,
            width,
            height,
            maxEdge: Math.max(0, Math.round(
              Number(candidate?.maxEdge) || Math.max(width, height)
            )),
            inputMode: candidate?.inputMode === 'panel_crop'
              ? 'panel_crop' : 'figure_image',
            pixelsSupplied: true,
            ...(verifiedPdf ? {
              assetProof: candidate.assetProof,
              pdfEvidenceBinding: candidate.pdfEvidenceBinding
            } : {})
          };
        }).filter(Boolean);
      return {
        figureId,
        figureLabel: String(value?.figureLabel || figureId).trim().slice(0, 80),
        caption,
        articleTitle: String(articleTitle || '').trim().slice(0, 500),
        panelHints: [...new Set((Array.isArray(value?.panelHints) ? value.panelHints : [])
          .slice(0, 30)
          .map(item => String(item || '').trim().toUpperCase())
          .filter(item => /^[A-Z0-9][A-Z0-9.+-]{0,7}$/.test(item)))],
        contextParagraphs: (Array.isArray(value?.contextParagraphs)
          ? value.contextParagraphs : []).slice(0, verifiedPdf ? 256 : 12).map(item => ({
          paragraphId: String(item?.paragraphId || '').slice(0, 120),
          sectionTitle: evidenceText(item?.sectionTitle, 240),
          text: evidenceText(item?.text, verifiedPdf ? 50000 : 1200),
          ...(verifiedPdf ? {
            evidence: JSON.parse(JSON.stringify(
              Array.isArray(item?.evidence) ? item.evidence : []
            ))
          } : {})
        })),
        images,
        imageVariants,
        ...(verifiedPdf ? { pdfEvidenceBinding: value.pdfEvidenceBinding } : {})
      };
    }

    async function requestFigureJson(adapter, request, context, progressBase, options = {}) {
      const emitLifecycle = options.emitLifecycle === true;
      const operation = options.operation || null;
      const attemptBudget = options.attemptBudget || adapter?.figureProviderAttemptBudget || null;
      const dispatchCollector = options.dispatchCollector instanceof Map
        ? options.dispatchCollector : null;
      const maxAttempts = Math.max(1, Math.min(3, Number(options.maxAttempts) || 3));
      const requestOnce = async payload => {
        await waitForOperation(operation);
        if (emitLifecycle) {
          context.onProgress?.({ phase: 'figure_model_processing', ...progressBase });
        }
        const providerRequest = {
          ...payload,
          signal: operation?.controller?.signal
        };
        if (dispatchCollector) {
          providerRequest[FIGURE_PROVIDER_DISPATCH_COLLECTOR] = dispatchCollector;
        }
        const raw = await adapter.generateJson(providerRequest);
        await waitForOperation(operation);
        if (emitLifecycle) {
          context.onProgress?.({ phase: 'figure_response_received', ...progressBase });
        }
        return raw;
      };
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          return await requestOnce(request);
        } catch (error) {
          if (error?.figureOwnerGuardFailure === true) throw error;
          if (operation?.controller?.signal?.aborted) {
            if (error?.code === 'CANCELLED') throw error;
            await persistFigureProviderAttemptTerminal(attemptBudget, 'CANCELLED');
            throw shared.operationError();
          }
          if (error?.code === 'REQUEST_TIMEOUT' || error?.code === 'CANCELLED' ||
              error?.code === 'FIGURE_PROVIDER_ATTEMPT_LIMIT') {
            await persistFigureProviderAttemptTerminal(attemptBudget, error.code);
            throw error;
          }
          if (!error?.retryable || attempt >= maxAttempts) throw error;
          const waitMs = Math.max(
            Number(error?.retryAfterMs) || 0,
            attempt === 1 ? 1500 : 5000
          );
          context.onProgress?.({
            phase: 'figure_retry',
            ...progressBase,
            attempt: attempt + 1,
            waitMs,
            errorCode: error.code || 'NETWORK_ERROR'
          });
          await sleepForOperation(waitMs, operation);
        }
      }
      throw new Error('Figure analysis did not complete');
    }

    function splitFigurePanelBatches(figure, analysisDepth) {
      const panels = Array.isArray(figure?.panelHints) ? figure.panelHints : [];
      if (!panels.length) return [[]];
      if (analysisDepth !== 'deep' && panels.length <= FIGURE_STANDARD_WHOLE_PANEL_LIMIT) {
        return [panels.slice()];
      }
      // Deep analysis contains many required fields per panel.  Small batches keep
      // its structured response below the output limit of economical models.
      // Keep paired readouts together, but never ask a model to distribute a
      // whole behavioral battery across four labels in one response.
      // Large standard Figures also checkpoint small batches, so a late failure
      // does not discard a response containing dozens of detailed Panels.
      const batchSize = analysisDepth === 'deep' ? 2 : FIGURE_STANDARD_PANEL_BATCH_SIZE;
      const batches = [];
      for (let index = 0; index < panels.length; index += batchSize) {
        batches.push(panels.slice(index, index + batchSize));
      }
      return batches;
    }

    function mergeFigurePanelBatchResults(results, figure, analysisDepth) {
      const values = Array.isArray(results) ? results.filter(Boolean) : [];
      const first = values[0] || {};
      const uniqueBy = (items, key) => {
        const seen = new Set();
        return (Array.isArray(items) ? items : []).filter(item => {
          const value = key(item);
          if (!value || seen.has(value)) return false;
          seen.add(value);
          return true;
        });
      };
      const panels = uniqueBy(values.flatMap(item => item.panels || []), item => item.panel);
      const expectedPanels = Array.isArray(figure?.panelHints) ? figure.panelHints : [];
      const unexpectedPanels = uniqueBy(
        values.flatMap(item => item?.panelCoverage?.unexpectedPanels || []),
        item => String(item || '')
      );
      const firstText = field => values.map(item => String(item?.[field] || '').trim())
        .find(Boolean) || '';
      const merged = {
        ...first,
        figureId: figure.figureId,
        analysisDepth,
        panels,
        panelGroups: uniqueBy(values.flatMap(item => item.panelGroups || []), item =>
          shared.stableHash([item?.panels, item?.groupGoal, item?.groupConclusion])),
        logicBridges: uniqueBy(values.flatMap(item => item.logicBridges || []), item =>
          shared.stableHash([item?.fromGroup, item?.toGroup, item?.relationType, item?.bridge])),
        argumentChain: uniqueBy(values.flatMap(item => item.argumentChain || []), item =>
          shared.stableHash([item?.panels, item?.established, item?.handoff, item?.evidenceLevel])),
        panelCoverage: {
          expectedPanels: [...expectedPanels],
          returnedPanels: panels.map(item => item.panel),
          missingPanels: expectedPanels.filter(panel => !panels.some(item => item.panel === panel)),
          unexpectedPanels,
          ignoredUnexpectedPanelCount: unexpectedPanels.length
        },
        figureTitleZh: firstText('figureTitleZh'),
        figureQuestion: firstText('figureQuestion'),
        authorAssembly: firstText('authorAssembly'),
        coreConclusion: firstText('coreConclusion'),
        claimBoundary: firstText('claimBoundary')
      };
      if (analysisDepth === 'deep') Object.assign(merged, {
        controlAnalysis: uniqueBy(values.flatMap(item => item.controlAnalysis || []), item =>
          shared.stableHash([item?.panels, item?.controlType, item?.excludedExplanation])),
        evidenceRelations: uniqueBy(values.flatMap(item => item.evidenceRelations || []), item =>
          shared.stableHash([item?.panels, item?.relationLevel, item?.rationale])),
        negativeResultValue: firstText('negativeResultValue'),
        qualitativeQuantitativeLink: firstText('qualitativeQuantitativeLink'),
        alternativeExplanations: uniqueBy(values.flatMap(item => item.alternativeExplanations || []),
          item => String(item || '')),
        missingLinksIfPanelRemoved: uniqueBy(
          values.flatMap(item => item.missingLinksIfPanelRemoved || []),
          item => String(item || '')
        ),
        paperArgumentRole: firstText('paperArgumentRole'),
        deepAuthorStrategy: firstText('deepAuthorStrategy')
      });
      return merged;
    }

    async function mapWithConcurrency(items, limit, mapper) {
      const values = new Array(items.length);
      let cursor = 0;
      const workers = Array.from({
        length: Math.max(1, Math.min(items.length || 1, Number(limit) || 1))
      }, async () => {
        while (cursor < items.length) {
          const index = cursor;
          cursor += 1;
          values[index] = await mapper(items[index], index);
        }
      });
      await Promise.all(workers);
      return values;
    }

    async function requestFigurePanelBatches({
      adapter,
      route,
      figure,
      analysisDepth,
      progress,
      checkpoint,
      progressBase,
      operation,
      checkpointBinding,
      resumeCheckpoint = null,
      prevalidatedResume = null,
      validateResumeOnly = false,
      onResumeValidated = null,
      allowTextFallback = false,
      panelConcurrency = TASK_CONCURRENCY.figure
    }) {
      const panelBatches = splitFigurePanelBatches(figure, analysisDepth);
      let visionFallback = false;
      let fallbackReason = '';
      let reusableCacheResult = true;
      let useVisualInput = route.capabilityMode === 'vision' && figure.images.length > 0;
      const checkpointDispatches = new Map();
      if (route.capabilityMode === 'caption_text_only') {
        progress({
          phase: 'caption_text_only',
          ...progressBase,
          basis: 'caption_context',
          visionFallback: false,
          completedPanelBatches: 0,
          totalPanelBatches: panelBatches.length
        });
      }

      async function requestValidated({
        prompt,
        request,
        validate,
        progressDetails,
        dispatchCollector = checkpointDispatches
      }) {
        const visualSet = figure.pdfEvidenceBinding?.visualEvidenceSet;
        if (visualSet && request.images?.length) {
          if (request.images.length !== visualSet.assets.length) {
            throw figureContractError('PDF_FIGURE_IMAGE_COUNT_INVALID');
          }
          const payload = JSON.parse(request.userPrompt);
          request = { ...request, userPrompt: JSON.stringify({ ...payload,
            pdf_visual_input_manifest: {
              figure_id: figure.figureId,
              visual_evidence_set_digest: visualSet.setDigest,
              images: visualSet.assets.map((asset, index) => ({
                image_ordinal: index + 1, page_number: asset.pageNumber,
                image_content_hash: asset.imageContentHash
              }))
            }
          }) };
        }
        try {
          const raw = await requestFigureJson(
            adapter, request, { onProgress: progress }, progressDetails,
            { emitLifecycle: true, operation, dispatchCollector }
          );
          progress({ phase: 'figure_validating', ...progressDetails });
          return validate(raw);
        } catch (error) {
          if (error?.code !== 'INVALID_RESPONSE') throw error;
          progress({ phase: 'figure_schema_retry', ...progressDetails });
          const groupingRepair = ['group_count', 'empty_group', 'unknown_panel', 'overlap', 'missing_panels']
            .includes(error.figureGroupIssue)
            ? `\nGROUPING_REPAIR: The previous evidence partition failed (${error.figureGroupIssue}). Rebuild panel_groups so every supplied Panel occurs exactly once, no group is empty, no unknown labels or whole-Figure umbrella overlap, and each group has one concise upstream_context_zh sentence.`
            : '';
          const repairedRaw = await requestFigureJson(adapter, {
            ...request,
            systemPrompt: `${prompt.systemPrompt}\nSCHEMA_REPAIR_PASS: Return only the exact JSON object, escape every embedded double quote and control character inside JSON strings, include every required key, and do not add unsupported keys. Use the allowed unresolved-record schema when evidence cannot identify a Panel; otherwise use empty strings or empty arrays where permitted when evidence is absent. Never invent evidence or change the requested Panel scope.${groupingRepair}`
          }, { onProgress: progress }, progressDetails,
          { emitLifecycle: true, operation, dispatchCollector });
          progress({ phase: 'figure_validating', ...progressDetails });
          return validate(repairedRaw);
        }
      }

      const incompleteFigureResults = new WeakMap();
      let panelRecoveryAttempted = false;
      let durableSavedPanelCount = 0;
      let durableCheckpointSaved = false;

      function beginTextFallback(error) {
        const reason = visualTextFallbackReason(error);
        if (!reason || allowTextFallback !== true) return false;
        visionFallback = true;
        fallbackReason = fallbackReason || reason;
        useVisualInput = false;
        return true;
      }

      function validateRecoverableWholeFigure(raw, batchFigure, visualInput) {
        try {
          return shared.validateFigureAnalysis(
            raw, batchFigure, {
              visualInput,
              analysisDepth,
              requireEvidenceGroups: true,
              requireCompletePanels: true
            }
          );
        } catch (error) {
          if (error?.code !== 'FIGURE_PANEL_COVERAGE_INCOMPLETE') throw error;
          const partialFigureResult = shared.validateFigureAnalysis(
            raw, batchFigure, {
              visualInput,
              analysisDepth,
              requireCompletePanels: false
            }
          );
          incompleteFigureResults.set(error, partialFigureResult);
          throw error;
        }
      }

      function validateRecoverablePanelBatch(raw, batchFigure, visualInput) {
        try {
          return shared.validateFigurePanelBatch(
            raw, batchFigure, { visualInput, analysisDepth }
          );
        } catch (error) {
          if (error?.code !== 'FIGURE_PANEL_COVERAGE_INCOMPLETE') throw error;
          const requestedPanels = Array.isArray(batchFigure?.panelHints)
            ? batchFigure.panelHints : [];
          const receivedPanels = (Array.isArray(error.receivedPanels)
            ? error.receivedPanels : []).filter(panel => requestedPanels.includes(panel));
          const partialFigureResult = shared.validateFigurePanelBatch(
            raw,
            { ...batchFigure, panelHints: receivedPanels },
            { visualInput, analysisDepth }
          );
          incompleteFigureResults.set(error, partialFigureResult);
          throw error;
        }
      }

      function recoveryInputMode(visualInput) {
        return visualInput ? 'figure_image' : 'caption_context';
      }

      function figureCheckpointFields(result, inputMode, expectedPanels = []) {
        const panels = Array.isArray(result?.panels) ? result.panels : [];
        const returned = new Set(panels.map(panel => String(panel?.panel || '')));
        const missingPanels = (Array.isArray(expectedPanels) ? expectedPanels : [])
          .filter(panel => !returned.has(panel));
        const unresolvedPanels = panels
          .filter(panel => panel?.status === 'not_identifiable')
          .map(panel => String(panel.panel || ''))
          .filter(Boolean);
        const normalizedInputMode = ['caption_context', 'figure_image', 'panel_crop']
          .includes(inputMode) ? inputMode : 'caption_context';
        return {
          inputMode: normalizedInputMode,
          savedPanelCount: 0,
          validatedPanelCount: panels.length,
          missingPanels,
          unresolvedPanels
        };
      }

      async function persistValidatedFigureCheckpoint({
        result,
        inputMode,
        expectedPanels,
        progressDetails,
        pendingPhase,
        completePhase,
        details = {}
      }) {
        if (figure.panelInventory) result = {
          ...result,
          pdfPanelInventory: figure.panelInventory,
          pdfPanelInventoryDigest: figure.panelDirectoryDigest,
          pdfEvidenceBinding: figure.pdfEvidenceBinding
        };
        const fields = figureCheckpointFields(result, inputMode, expectedPanels);
        await progress({
          phase: pendingPhase,
          ...progressDetails,
          ...fields,
          ...details,
          checkpointStatus: 'pending_save'
        });
        if (typeof checkpoint !== 'function') {
          if (String(progressDetails?.operationId || '')) {
            const error = new Error('Private Figure checkpoint transport is unavailable');
            error.code = 'FIGURE_CHECKPOINT_TRANSPORT_UNAVAILABLE';
            throw error;
          }
          await progress({
            phase: completePhase,
            ...progressDetails,
            ...fields,
            ...details,
            checkpointStatus: 'not_requested'
          });
          return { ...fields, checkpointStatus: 'not_requested' };
        }
        let receipt;
        let checkpointDigest = '';
        let checkpointProof = null;
        let consumedAttempts = [];
        try {
          if (!isPlainObject(checkpointBinding) ||
              checkpointBinding.version !== FIGURE_CHECKPOINT_ENVELOPE_VERSION) {
            throw figureContractError('FIGURE_CHECKPOINT_INVALID');
          }
          const resultDigest = await strongSha256(result, cryptoImpl);
          const envelopeFields = {
            ...checkpointBinding,
            inputMode: fields.inputMode,
            visionFallback: visionFallback === true,
            fallbackReason: visionFallback === true ? String(fallbackReason || '') : '',
            resultDigest
          };
          const checkpointEnvelope = {
            ...envelopeFields,
            bindingDigest: await strongSha256(envelopeFields, cryptoImpl),
            figureResult: result
          };
          checkpointDigest = await strongSha256(checkpointEnvelope, cryptoImpl);
          checkpointProof = { kind: 'checkpoint', digest: checkpointDigest };
          consumedAttempts = await prepareDurableFigureDispatchProof(
            adapter, checkpointDispatches, checkpointProof
          );
          receipt = await checkpoint({
            figureId: figure.figureId,
            analysisDepth,
            operationId: String(progressDetails?.operationId || ''),
            inputMode: fields.inputMode,
            missingPanels: [...fields.missingPanels],
            unresolvedPanels: [...fields.unresolvedPanels],
            validatedPanelCount: fields.validatedPanelCount,
            checkpointEnvelope,
            figureResult: result
          });
        } catch (cause) {
          if (cause?.code === 'FIGURE_REQUEST_REPLAY_AMBIGUOUS') {
            throw cause;
          }
          const error = new Error('Validated Figure checkpoint could not be persisted');
          error.code = 'FIGURE_CHECKPOINT_PERSIST_FAILED';
          error.causeCode = String(cause?.code || 'CHECKPOINT_TRANSPORT_FAILED');
          throw error;
        }
        if (receipt?.success !== true) {
          const error = new Error('Validated Figure checkpoint could not be persisted');
          error.code = 'FIGURE_CHECKPOINT_PERSIST_FAILED';
          error.causeCode = String(receipt?.code || 'CHECKPOINT_REJECTED');
          throw error;
        }
        await waitForOperation(operation);
        const savedPanelCount = Math.max(0, Math.min(
          fields.validatedPanelCount,
          Math.floor(Number(receipt.savedPanelCount) || 0)
        ));
        if (savedPanelCount < fields.validatedPanelCount) {
          const error = new Error('Validated Figure checkpoint was only partially persisted');
          error.code = 'FIGURE_CHECKPOINT_PERSIST_FAILED';
          error.causeCode = 'CHECKPOINT_COUNT_MISMATCH';
          throw error;
        }
        // The provider responses represented by this outer receipt become
        // replay-safe only after the caller has durably acknowledged the
        // checkpoint that contains them. Raw response arrival alone is not a
        // cross-worker recovery boundary.
        await sealDurablyConsumedFigureDispatches(
          adapter, checkpointDispatches, consumedAttempts,
          checkpointProof, checkpointDigest
        );
        const savedFields = {
          ...fields,
          savedPanelCount,
          checkpointStatus: 'saved'
        };
        durableSavedPanelCount = Math.max(durableSavedPanelCount, savedPanelCount);
        durableCheckpointSaved = true;
        await progress({
          phase: completePhase,
          ...progressDetails,
          ...savedFields,
          ...details
        });
        return savedFields;
      }

      function unresolvedRecoveryRecord(panel, prompt) {
        return shared.createUnidentifiedPanelRecord(panel, {
          inputMode: prompt.validationContext.inputMode,
          evidenceRefs: prompt.validationContext.allowedEvidenceRefsByPanel[panel]
        });
      }

      async function recoverMissingPanels({
        initialError,
        initialResult = null,
        batchFigure,
        visualInput,
        progressDetails,
        synthesize = true,
        completedBatchResults = null
      }) {
        panelRecoveryAttempted = true;
        let recovered = initialResult || incompleteFigureResults.get(initialError);
        if (!recovered || !Array.isArray(recovered.panels)) throw initialError;
        const expectedPanels = [...batchFigure.panelHints];
        const checkpointPanels = completedBatchResults ? figure.panelHints : expectedPanels;
        const recoveryCheckpointResult = result => {
          const panelOnly = { ...result, figureQuestion: '', coreConclusion: '' };
          // A batch recovery writes the same whole-Figure checkpoint slot as
          // extraction. Preserve earlier batches and use the whole-Figure
          // coverage contract so finishing recovery is an exact checkpoint
          // replay, rather than a conflicting same-size batch result.
          return completedBatchResults
            ? mergeFigurePanelBatchResults([...completedBatchResults, panelOnly], figure, analysisDepth)
            : panelOnly;
        };
        recovered = {
          ...recovered,
          panels: recovered.panels.filter(panel => panel?.status !== 'not_identifiable')
        };
        const initialMissing = expectedPanels.filter(panel =>
          !recovered.panels.some(item => item.panel === panel)
        );
        const batches = shared.createPanelRecoveryBatches(initialMissing, 3);
        let activeVisualInput = visualInput;
        let recoveryVisionFallback = false;
        progress({
          phase: 'figure_panel_recovery_started',
          ...progressDetails,
          inputMode: recoveryInputMode(activeVisualInput),
          missingPanels: initialMissing,
          missingPanelCount: initialMissing.length,
          recoveryBatchCount: batches.length,
          recognizedPanelCount: recovered.panels.length
        });
        if (recovered.panels.length) {
          await persistValidatedFigureCheckpoint({
            // Recovered Panels still need a fresh Figure-level synthesis. An
            // overview inherited from the incomplete whole response must not
            // promote this intermediate checkpoint to the complete rank.
            result: recoveryCheckpointResult(recovered),
            inputMode: recoveryInputMode(activeVisualInput),
            expectedPanels: checkpointPanels,
            progressDetails,
            pendingPhase: 'figure_panel_recovery_checkpoint_pending',
            completePhase: 'figure_panel_recovery_checkpoint',
            details: { recognizedPanelCount: recovered.panels.length }
          });
        } else {
          await progress({
            phase: 'figure_panel_recovery_checkpoint',
            ...progressDetails,
            ...figureCheckpointFields(
              recovered, recoveryInputMode(activeVisualInput), expectedPanels
            ),
            recognizedPanelCount: 0,
            checkpointStatus: 'not_requested'
          });
        }

        const requestBatch = async (requestedPanels, batchIndex, useVisualInput) => {
          await waitForOperation(operation);
          const completedPanelLabels = recovered.panels.map(panel => panel.panel);
          const prompt = shared.compileFigurePanelRecoveryPrompt(
            { ...batchFigure, completedPanelLabels }, requestedPanels, {
              visualInput: useVisualInput,
              inputMode: recoveryInputMode(useVisualInput),
              analysisDepth,
              completedPanelLabels
            }
          );
          const recoveryDetails = {
            ...progressDetails,
            expectedPanels: [...requestedPanels],
            expectedPanelCount: requestedPanels.length,
            recoveryBatchIndex: batchIndex + 1,
            recoveryBatchCount: batches.length
          };
          progress({
            phase: 'figure_requesting',
            ...recoveryDetails,
            basis: useVisualInput ? 'vision_text' : 'caption_context',
            visionFallback: recoveryVisionFallback
          });
          return requestValidated({
            prompt,
            request: {
              ...prompt,
              images: useVisualInput ? batchFigure.images : [],
              outputUnits: Math.max(1, requestedPanels.length)
            },
            progressDetails: recoveryDetails,
            validate: raw => {
              try {
                return shared.validateFigurePanelRecoveryResult(
                  raw, requestedPanels, prompt.validationContext
                );
              } catch (error) {
                if (error?.code !== 'FIGURE_PANEL_COVERAGE_INCOMPLETE') throw error;
                const receivedPanels = (Array.isArray(error.receivedPanels)
                  ? error.receivedPanels : []).filter(panel => requestedPanels.includes(panel));
                let acceptedPanels = [];
                if (receivedPanels.length) {
                  const receivedPrompt = shared.compileFigurePanelRecoveryPrompt(
                    { ...batchFigure, completedPanelLabels }, receivedPanels, {
                      visualInput: useVisualInput,
                      inputMode: recoveryInputMode(useVisualInput),
                      analysisDepth,
                      completedPanelLabels
                    }
                  );
                  acceptedPanels = shared.validateFigurePanelRecoveryResult(
                    raw, receivedPanels, receivedPrompt.validationContext
                  ).panels;
                }
                const acceptedLabels = new Set(acceptedPanels.map(panel => panel.panel));
                const unidentified = requestedPanels
                  .filter(panel => !acceptedLabels.has(panel))
                  .map(panel => unresolvedRecoveryRecord(panel, prompt));
                return {
                  figureId: batchFigure.figureId,
                  figureVersion: recovered.figureVersion,
                  analysisDepth,
                  basis: useVisualInput ? 'vision_text' : 'caption_context',
                  panels: [...acceptedPanels, ...unidentified]
                };
              }
            }
          });
        };

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          const requestedPanels = batches[batchIndex];
          let batchResult;
          try {
            batchResult = await requestBatch(
              requestedPanels, batchIndex, activeVisualInput
            );
          } catch (error) {
            const canFallback = activeVisualInput && beginTextFallback(error);
            if (!canFallback) {
              error.figurePanelRecoveryAttempted = true;
              throw error;
            }
            reusableCacheResult = false;
            recoveryVisionFallback = true;
            activeVisualInput = false;
            progress({
              phase: 'figure_fallback',
              ...progressDetails,
              errorCode: error.code
            });
            batchResult = await requestBatch(requestedPanels, batchIndex, false);
          }
          recovered = shared.mergeRecoveredPanels(
            recovered, batchResult, expectedPanels
          );
          if (!activeVisualInput && (recoveryVisionFallback || visionFallback)) {
            recovered = { ...recovered, basis: 'caption_context' };
          }
          const unresolvedPanels = recovered.panels
            .filter(panel => panel.status === 'not_identifiable')
            .map(panel => panel.panel);
          // Persist the same coverage semantics that consumeBatch receives.
          // Otherwise an all-returned recovery first saves unresolvedPanels: []
          // and then rewrites the same Panel set with unresolved labels, which
          // correctly fails the immutable same-scope checkpoint contract.
          recovered = {
            ...recovered,
            unresolvedPanels: [...unresolvedPanels],
            panelCoverage: {
              expectedPanels,
              returnedPanels: recovered.panels.map(panel => panel.panel),
              resolvedPanels: recovered.panels
                .filter(panel => panel.status !== 'not_identifiable')
                .map(panel => panel.panel),
              unresolvedPanels: [...unresolvedPanels],
              missingPanels: expectedPanels.filter(panel =>
                !recovered.panels.some(item => item.panel === panel))
            }
          };
          await persistValidatedFigureCheckpoint({
            // Recovered Panels still need a fresh Figure-level synthesis. An
            // overview inherited from the incomplete whole response must not
            // promote this intermediate checkpoint to the complete rank.
            result: recoveryCheckpointResult(recovered),
            inputMode: recoveryInputMode(activeVisualInput),
            expectedPanels: checkpointPanels,
            progressDetails,
            pendingPhase: 'figure_panel_recovery_batch_pending',
            completePhase: 'figure_panel_recovery_batch_complete',
            details: {
            recoveredPanels: batchResult.panels.map(panel => panel.panel),
            recoveredPanelCount: batchResult.panels.length,
            unresolvedPanels,
            unresolvedPanelCount: unresolvedPanels.length,
            recoveryBatchIndex: batchIndex + 1,
            recoveryBatchCount: batches.length,
              recognizedPanelCount: recovered.panels.length
            }
          });
        }

        const unresolvedPanels = recovered.panels
          .filter(panel => panel.status === 'not_identifiable')
          .map(panel => panel.panel);
        const resolvedPanels = recovered.panels.filter(panel =>
          panel.status !== 'not_identifiable'
        );
        const panelOnlyResult = {
          ...recovered,
          panels: recovered.panels,
          panelCoverage: {
            expectedPanels,
            returnedPanels: recovered.panels.map(panel => panel.panel),
            resolvedPanels: resolvedPanels.map(panel => panel.panel),
            unresolvedPanels: [...unresolvedPanels],
            missingPanels: []
          },
          unresolvedPanels: [...unresolvedPanels]
        };
        const emitRecoveryComplete = result => progress({
          phase: 'figure_panel_recovery_complete',
          ...progressDetails,
          ...figureCheckpointFields(
            result, recoveryInputMode(activeVisualInput), expectedPanels
          ),
          savedPanelCount: durableSavedPanelCount,
          checkpointStatus: durableSavedPanelCount > 0 ? 'saved' : 'not_requested',
          recoveredPanels: initialMissing.filter(panel =>
            !unresolvedPanels.includes(panel)
          ),
          recoveredPanelCount: initialMissing.length - unresolvedPanels.length,
          unresolvedPanels,
          unresolvedPanelCount: unresolvedPanels.length,
          recognizedPanelCount: result.panels.length
        });
        if (!synthesize) {
          await waitForOperation(operation);
          emitRecoveryComplete(panelOnlyResult);
          return {
            result: panelOnlyResult,
            visionFallback: recoveryVisionFallback,
            visualInput: activeVisualInput
          };
        }

        await waitForOperation(operation);
        const synthesisFigure = {
          ...batchFigure,
          panelHints: resolvedPanels.map(panel => panel.panel)
        };
        const synthesisPrompt = shared.compileFigureSynthesisPrompt(
          synthesisFigure, resolvedPanels, {
            visualInput: activeVisualInput,
            analysisDepth
          }
        );
        progress({
          phase: 'figure_synthesizing',
          ...progressDetails,
          completedPanelBatches: batches.length,
          recognizedPanelCount: recovered.panels.length
        });
        let synthesized;
        try {
          synthesized = await requestValidated({
            prompt: synthesisPrompt,
            request: {
              ...synthesisPrompt,
              images: [],
              outputUnits: Math.max(1, resolvedPanels.length)
            },
            progressDetails,
            validate: raw => shared.validateFigureSynthesis(
              raw,
              synthesisFigure,
              resolvedPanels,
              { visualInput: activeVisualInput, analysisDepth }
            )
          });
        } catch (error) {
          error.figurePanelRecoveryAttempted = true;
          throw error;
        }
        const result = {
          ...synthesized,
          panels: panelOnlyResult.panels,
          panelCoverage: panelOnlyResult.panelCoverage,
          unresolvedPanels: panelOnlyResult.unresolvedPanels
        };
        progress({
          phase: 'figure_synthesis_complete',
          ...progressDetails,
          recognizedPanelCount: result.panels.length,
          basis: result.basis,
          visionFallback: recoveryVisionFallback
        });
        emitRecoveryComplete(result);
        return {
          result,
          visionFallback: recoveryVisionFallback,
          visualInput: activeVisualInput
        };
      }

      async function validateResumeCheckpoint(value) {
        const expectedBinding = checkpointBinding;
        if (!isPlainObject(value) ||
            value.version !== FIGURE_CHECKPOINT_ENVELOPE_VERSION ||
            !isPlainObject(expectedBinding) ||
            !isPlainObject(value.figureResult)) {
          throw figureContractError('FIGURE_CHECKPOINT_INVALID');
        }
        let incomingOperationPlan;
        try {
          incomingOperationPlan = normalizeFigureOperationPlan({
            figureOperationPlan: value.operationPlan
          }, []).entries;
        } catch (_) {
          throw figureContractError('FIGURE_CHECKPOINT_INVALID');
        }
        const normalizedInputMode = ['caption_context', 'figure_image', 'panel_crop']
          .includes(value.inputMode) ? value.inputMode : '';
        const normalizedFallbackReason = typeof value.fallbackReason === 'string' &&
          value.fallbackReason.length <= 64 &&
          (!value.fallbackReason || SAFE_VISUAL_FALLBACK_REASONS.has(value.fallbackReason))
          ? value.fallbackReason : null;
        if (!normalizedInputMode || typeof value.visionFallback !== 'boolean' ||
            normalizedFallbackReason === null ||
            value.visionFallback !== Boolean(normalizedFallbackReason) ||
            !/^[a-f0-9]{64}$/u.test(String(value.resultDigest || '')) ||
            !/^[a-f0-9]{64}$/u.test(String(value.bindingDigest || ''))) {
          throw figureContractError('FIGURE_CHECKPOINT_INVALID');
        }
        const actualResultDigest = await strongSha256(value.figureResult, cryptoImpl);
        const incomingBindingFields = {
          version: value.version,
          implementationVersion: value.implementationVersion,
          figureId: value.figureId,
          analysisDepth: value.analysisDepth,
          inputDigest: value.inputDigest,
          routeDigest: value.routeDigest,
          taskPolicyDigest: value.taskPolicyDigest,
          planDigest: value.planDigest,
          operationPlan: incomingOperationPlan,
          ...(Object.hasOwn(value, 'panelInventoryBinding')
            ? { panelInventoryBinding: value.panelInventoryBinding } : {}),
          immutableLimit: value.immutableLimit
        };
        const incomingBinding = {
          ...incomingBindingFields,
          bindingDigest: await strongSha256(incomingBindingFields, cryptoImpl)
        };
        const envelopeFields = {
          ...incomingBinding,
          inputMode: normalizedInputMode,
          visionFallback: value.visionFallback,
          fallbackReason: normalizedFallbackReason,
          resultDigest: actualResultDigest
        };
        const actualBindingDigest = await strongSha256(envelopeFields, cryptoImpl);
        if (actualResultDigest !== value.resultDigest ||
            actualBindingDigest !== value.bindingDigest) {
          throw figureContractError('FIGURE_CHECKPOINT_INVALID');
        }
        const staleFields = [
          'version', 'implementationVersion', 'figureId', 'analysisDepth',
          'inputDigest', 'routeDigest',
          'taskPolicyDigest', 'planDigest', 'immutableLimit'
        ];
        if (staleFields.some(field => value[field] !== expectedBinding[field]) ||
            await strongSha256(value.panelInventoryBinding || null, cryptoImpl) !==
              await strongSha256(expectedBinding.panelInventoryBinding || null, cryptoImpl) ||
            await strongSha256(incomingOperationPlan, cryptoImpl) !==
              await strongSha256(expectedBinding.operationPlan, cryptoImpl)) {
          throw figureContractError('FIGURE_CHECKPOINT_STALE');
        }
        const resultValue = value.figureResult;
        const resultBasis = resultValue.basis === 'vision_text'
          ? 'vision_text'
          : (resultValue.basis === 'caption_context' ? 'caption_context' : '');
        const hasFigurePixels = Array.isArray(figure.images) && figure.images.length > 0;
        const requestedWholeInputMode = route.capabilityMode === 'vision' && hasFigurePixels
          ? 'figure_image' : 'caption_context';
        const isUnlabeledCompleteCandidate = Array.isArray(resultValue.panels) &&
          resultValue.panels.length === 0 && figure.panelHints.length === 0 &&
          resultValue.unlabeledOverview === true;
        const validModeState = normalizedInputMode === 'figure_image'
          ? requestedWholeInputMode === 'figure_image' && resultBasis === 'vision_text' &&
            value.visionFallback === false && normalizedFallbackReason === ''
          : normalizedInputMode === 'caption_context' &&
            resultBasis === 'caption_context' &&
            (requestedWholeInputMode === 'figure_image'
              ? value.visionFallback === true && Boolean(normalizedFallbackReason)
              : value.visionFallback === false && normalizedFallbackReason === '');
        if (!validModeState ||
            !Array.isArray(resultValue.panels) ||
            (resultValue.panels.length < 1 && !isUnlabeledCompleteCandidate) ||
            resultValue.panels.length > 30 ||
            String(resultValue.figureId || '') !== figure.figureId ||
            resultValue.analysisDepth !== analysisDepth) {
          throw figureContractError('FIGURE_CHECKPOINT_INVALID');
        }
        try {
          const complete = shared.validateCachedFigureAnalysis(
            resultValue, figure, { analysisDepth }
          );
          return {
            complete, partial: null, inputMode: normalizedInputMode,
            visionFallback: value.visionFallback,
            fallbackReason: normalizedFallbackReason
          };
        } catch (_) {
          // A durable extraction checkpoint intentionally lacks Figure-level
          // synthesis, so validate its completed Panels through the stricter
          // Panel-only contract instead of trusting cached object fields.
        }
        const expected = new Set(figure.panelHints);
        const labels = [];
        const rawPanels = [];
        for (const panel of resultValue.panels) {
          if (!isPlainObject(panel) || panel.status === 'not_identifiable') continue;
          const label = String(panel.panel || '').normalize('NFKC').trim().toUpperCase();
          if (!expected.has(label) || labels.includes(label)) {
            throw figureContractError('FIGURE_CHECKPOINT_INVALID');
          }
          labels.push(label);
          rawPanels.push({
            panel: label,
            role: panel.role,
            phenotype_name_zh: panel.phenotypeName,
            method_category: panel.methodCategory,
            methods: panel.methods,
            evidence_type_zh: panel.evidenceType,
            experimental_methods: panel.experimentalMethods,
            statistical_methods: panel.statisticalMethods,
            method_source: panel.methodSource,
            purpose_zh: panel.purpose,
            design_zh: panel.design,
            comparison_zh: panel.comparison,
            direct_observation_zh: panel.directObservation,
            observation_source: panel.observationSource,
            local_inference_zh: panel.localInference,
            contribution_zh: panel.contribution
          });
        }
        if (!labels.length) throw figureContractError('FIGURE_CHECKPOINT_INVALID');
        const visualInput = normalizedInputMode === 'figure_image' &&
          resultValue.basis === 'vision_text' && figure.images.length > 0;
        const partial = shared.validateFigurePanelBatch({
          figure_id: figure.figureId,
          analysis_depth: analysisDepth,
          basis: visualInput ? 'vision_text' : 'caption_context',
          panels: rawPanels
        }, { ...figure, panelHints: labels }, { visualInput, analysisDepth });
        return {
          complete: null, partial, inputMode: normalizedInputMode,
          visionFallback: value.visionFallback,
          fallbackReason: normalizedFallbackReason
        };
      }

      if (resumeCheckpoint !== null && resumeCheckpoint !== undefined) {
        const resumed = prevalidatedResume ||
          await validateResumeCheckpoint(resumeCheckpoint);
        if (validateResumeOnly) return { resumeValidation: resumed };
        if (typeof onResumeValidated === 'function') {
          await onResumeValidated();
        }
        durableCheckpointSaved = true;
        if (resumed.complete) {
          const resumedVisualInput = resumed.inputMode === 'figure_image';
          return {
            result: resumed.complete,
            visionFallback: resumed.visionFallback,
            fallbackReason: resumed.fallbackReason,
            inputMode: resumed.inputMode,
            totalPanelBatches: panelBatches.length,
            savedPanelCount: resumed.complete.panels.length,
            checkpointSaved: true,
            reusableCacheResult: resumed.visionFallback !== true,
            dispatchCollector: checkpointDispatches
          };
        }
        const resumedVisualInput = resumed.inputMode === 'figure_image';
        visionFallback = resumed.visionFallback;
        fallbackReason = resumed.fallbackReason;
        useVisualInput = resumedVisualInput;
        const resumeBase = {
          ...progressBase,
          expectedPanels: [...figure.panelHints],
          expectedPanelCount: figure.panelHints.length,
          completedPanelBatches: Math.min(panelBatches.length,
            analysisDepth === 'deep'
              ? Math.ceil(resumed.partial.panels.length / 2)
              : 1),
          totalPanelBatches: panelBatches.length,
          checkpointResume: true
        };
        progress({
          phase: 'figure_checkpoint_resumed',
          ...resumeBase,
          recognizedPanelCount: resumed.partial.panels.length
        });
        const recovery = await recoverMissingPanels({
          initialResult: resumed.partial,
          batchFigure: figure,
          visualInput: resumedVisualInput,
          progressDetails: resumeBase
        });
        await persistValidatedFigureCheckpoint({
          result: recovery.result,
          inputMode: recoveryInputMode(recovery.visualInput),
          expectedPanels: figure.panelHints,
          progressDetails: resumeBase,
          pendingPhase: 'figure_synthesis_checkpoint_pending',
          completePhase: 'figure_synthesis_checkpoint_complete',
          details: {
            completedPanelBatches: panelBatches.length,
            recognizedPanelCount: recovery.result.panels.length,
            basis: recovery.result.basis,
            visionFallback: visionFallback || recovery.visionFallback
          }
        });
        return {
          result: recovery.result,
          visionFallback: visionFallback || recovery.visionFallback,
          fallbackReason,
          inputMode: recoveryInputMode(recovery.visualInput),
          totalPanelBatches: panelBatches.length,
          savedPanelCount: durableSavedPanelCount,
          checkpointSaved: durableCheckpointSaved,
          reusableCacheResult,
          dispatchCollector: checkpointDispatches
        };
      }

      // When the publisher DOM exposes no stable Panel labels, asking an
      // economical text model for the full per-Panel schema is both wasteful
      // and fragile. Use a smaller evidence-overview contract that preserves
      // the Figure question, ordered reasoning chain, conclusion, and limits
      // without inventing Panel letters.
      if (panelBatches.length === 1 && panelBatches[0].length === 0) {
        const overviewBase = {
          ...progressBase,
          expectedPanels: [],
          expectedPanelCount: 0,
          panelBatchIndex: 1,
          totalPanelBatches: 1,
          completedPanelBatches: 0,
          unlabeledFigure: true
        };
        const runOverview = async visualInput => {
          const prompt = shared.compileUnlabeledFigureOverviewPrompt(
            figure, { visualInput, analysisDepth }
          );
          progress({
            phase: 'figure_requesting', ...overviewBase,
            basis: visualInput ? 'vision_text' : 'caption_context',
            visionFallback
          });
          return requestValidated({
            prompt,
            request: {
              ...prompt,
              images: visualInput ? figure.images : [],
              outputUnits: analysisDepth === 'deep' ? 2 : 1
            },
            progressDetails: overviewBase,
            validate: raw => shared.validateUnlabeledFigureOverview(
              raw, figure, { visualInput, analysisDepth }
            )
          });
        };
        let result;
        let lastError = null;
        try {
          result = await runOverview(useVisualInput);
        } catch (error) {
          lastError = error;
          if (useVisualInput && beginTextFallback(error)) {
            progress({ phase: 'figure_fallback', ...overviewBase, errorCode: error.code });
            result = await runOverview(false);
            lastError = null;
          }
        }
        if (!result) throw lastError || new Error('Figure overview did not return a result');
        progress({
          phase: 'figure_assembling', ...overviewBase,
          recognizedPanelCount: 0
        });
        await persistValidatedFigureCheckpoint({
          result,
          inputMode: recoveryInputMode(useVisualInput),
          expectedPanels: [],
          progressDetails: overviewBase,
          pendingPhase: 'figure_panel_batch_pending',
          completePhase: 'figure_panel_batch_complete',
          details: {
            completedPanelBatches: 1,
            recognizedPanelCount: 0,
            basis: result.basis,
            visionFallback
          }
        });
        return {
          result, visionFallback, fallbackReason,
          inputMode: recoveryInputMode(useVisualInput), totalPanelBatches: 1,
          savedPanelCount: durableSavedPanelCount,
          checkpointSaved: durableCheckpointSaved,
          reusableCacheResult,
          dispatchCollector: checkpointDispatches
        };
      }

      // A small Figure is fastest and most coherent as one structured request.
      if (panelBatches.length === 1) {
        const panelHints = panelBatches[0];
        const batchFigure = { ...figure, panelHints };
        const batchBase = {
          ...progressBase,
          expectedPanels: [...panelHints],
          expectedPanelCount: panelHints.length,
          panelBatchIndex: 1,
          totalPanelBatches: 1,
          completedPanelBatches: 0
        };
        const run = async visualInput => {
          const prompt = shared.compileFigureAnalysisPrompt(
            batchFigure, { visualInput, analysisDepth }
          );
          const request = {
            ...prompt,
            images: visualInput ? figure.images : [],
            outputUnits: Math.max(1, panelHints.length)
          };
          progress({
            phase: 'figure_requesting', ...batchBase,
            basis: visualInput ? 'vision_text' : 'caption_context',
            visionFallback
          });
          return requestValidated({
            prompt, request, progressDetails: batchBase,
            validate: raw => validateRecoverableWholeFigure(
              raw, batchFigure, visualInput
            )
          });
        };
        const runCompactTwoPass = async visualInput => {
          const panelPrompt = shared.compileFigurePanelBatchPrompt(
            batchFigure, { visualInput, analysisDepth }
          );
          progress({
            phase: 'figure_compact_fallback', ...batchBase,
            basis: visualInput ? 'vision_text' : 'caption_context',
            visionFallback: !visualInput
          });
          const panelResult = await requestValidated({
            prompt: panelPrompt,
            request: {
              ...panelPrompt,
              images: visualInput ? figure.images : [],
              outputUnits: Math.max(1, panelHints.length)
            },
            progressDetails: batchBase,
            validate: raw => shared.validateFigurePanelBatch(
              raw, batchFigure, { visualInput, analysisDepth }
            )
          });
          await persistValidatedFigureCheckpoint({
            result: panelResult,
            inputMode: recoveryInputMode(visualInput),
            expectedPanels: panelHints,
            progressDetails: batchBase,
            pendingPhase: 'figure_panel_batch_pending',
            completePhase: 'figure_panel_batch_complete',
            details: {
              completedPanelBatches: 1,
              recognizedPanelCount: panelResult.panels.length,
              basis: panelResult.basis,
              visionFallback: !visualInput
            }
          });
          const synthesisPrompt = shared.compileFigureSynthesisPrompt(
            batchFigure, panelResult.panels, { visualInput, analysisDepth }
          );
          progress({
            phase: 'figure_synthesizing', ...batchBase,
            completedPanelBatches: 1,
            recognizedPanelCount: panelResult.panels.length
          });
          return requestValidated({
            prompt: synthesisPrompt,
            request: {
              ...synthesisPrompt,
              images: [],
              outputUnits: Math.max(1, panelResult.panels.length)
            },
            progressDetails: batchBase,
            validate: raw => shared.validateFigureSynthesis(
              raw, batchFigure, panelResult.panels,
              { visualInput, analysisDepth }
            )
          });
        };
        let result;
        let lastError = null;
        try {
          result = await run(useVisualInput);
        } catch (error) {
          lastError = error;
          if (error?.code === 'FIGURE_PANEL_COVERAGE_INCOMPLETE') {
            const recovery = await recoverMissingPanels({
              initialError: error,
              batchFigure,
              visualInput: useVisualInput,
              progressDetails: batchBase
            });
            result = recovery.result;
            visionFallback = recovery.visionFallback;
            useVisualInput = recovery.visualInput;
            lastError = null;
          } else if (!error?.figurePanelRecoveryAttempted && useVisualInput &&
              beginTextFallback(error)) {
            progress({ phase: 'figure_fallback', ...batchBase, errorCode: error.code });
            try {
              result = await run(false);
              lastError = null;
            } catch (fallbackError) {
              lastError = fallbackError;
            }
          }
        }
        if (!result && panelHints.length && visualTextFallbackReason(lastError)) {
          const canUseCaption = !useVisualInput || beginTextFallback(lastError);
          if (canUseCaption) result = await runCompactTwoPass(false);
        }
        if (!result) throw lastError || new Error('Figure analysis did not return a result');
        progress({
          phase: 'figure_assembling', ...batchBase,
          recognizedPanelCount: result.panels.length
        });
        await persistValidatedFigureCheckpoint({
          result,
          inputMode: recoveryInputMode(useVisualInput),
          expectedPanels: panelHints,
          progressDetails: batchBase,
          pendingPhase: 'figure_panel_batch_pending',
          completePhase: 'figure_panel_batch_complete',
          details: {
            completedPanelBatches: 1,
            recognizedPanelCount: result.panels.length,
            basis: result.basis,
            visionFallback
          }
        });
        return {
          result, visionFallback, fallbackReason,
          inputMode: recoveryInputMode(useVisualInput), totalPanelBatches: 1,
          savedPanelCount: durableSavedPanelCount,
          checkpointSaved: durableCheckpointSaved,
          reusableCacheResult
        };
      }

      const completed = new Array(panelBatches.length);
      let completedCount = 0;
      const deferredBatchDispatches = new Map();
      const runExtraction = async visualInput => {
        let activeVisualInput = visualInput;
        const prepareBatch = async batchIndex => {
            const panelHints = panelBatches[batchIndex];
            const batchVisualInput = activeVisualInput;
            const batchFigure = { ...figure, panelHints };
            const batchBase = {
              ...progressBase,
              expectedPanels: [...panelHints],
              expectedPanelCount: panelHints.length,
              panelBatchIndex: batchIndex + 1,
              totalPanelBatches: panelBatches.length,
              completedPanelBatches: completedCount
            };
            const prompt = shared.compileFigurePanelBatchPrompt(
              batchFigure, { visualInput: batchVisualInput, analysisDepth }
            );
            const request = {
              ...prompt,
              images: batchVisualInput ? figure.images : [],
              outputUnits: Math.max(1, panelHints.length)
            };
            // Responses may arrive out of order. Only the response consumed by
            // the current checkpoint may be included in that checkpoint proof.
            const dispatches = deferredBatchDispatches.get(batchIndex) || new Map();
            deferredBatchDispatches.delete(batchIndex);
            progress({
              phase: 'figure_requesting', ...batchBase,
              basis: batchVisualInput ? 'vision_text' : 'caption_context',
              visionFallback
            });
            let outcome;
            try {
              outcome = { value: await requestValidated({
                prompt, request, progressDetails: batchBase,
                dispatchCollector: dispatches,
                validate: raw => validateRecoverablePanelBatch(
                  raw, batchFigure, batchVisualInput
                )
              }) };
            } catch (error) {
              outcome = { error };
            }
            return { batchIndex, batchVisualInput, batchFigure, batchBase, dispatches, outcome };
        };
        const consumeBatch = async ({
          batchIndex, batchVisualInput, batchFigure, batchBase, dispatches, outcome
        }) => {
            if (outcome.error?.code === 'INVALID_RESPONSE' &&
                outcome.error.figureOwnerGuardFailure !== true) {
              // Every entry here is a fully received response rejected by the
              // local validator (including its schema repair). Record that
              // known failure as settled, without calling it saved evidence.
              // Unknown transport outcomes never enter this branch/collector.
              for (const dispatch of dispatches.values()) {
                await settleFigureProviderDispatch(
                  adapter.figureProviderAttemptBudget,
                  adapter.figureProviderAttemptBinding,
                  dispatch, 'sealed'
                );
                adapter.figureProviderAttemptBudget?.respondedDispatches.delete(dispatch.attemptNumber);
              }
              dispatches.clear();
            }
            for (const [key, value] of dispatches) checkpointDispatches.set(key, value);
            let result;
            try {
              if (outcome.error) throw outcome.error;
              result = outcome.value;
            } catch (error) {
              if (error?.code !== 'FIGURE_PANEL_COVERAGE_INCOMPLETE') throw error;
              const recovery = await recoverMissingPanels({
                initialError: error,
                batchFigure,
                visualInput: batchVisualInput,
                progressDetails: batchBase,
                synthesize: false,
                completedBatchResults: completed.filter(Boolean)
              });
              result = recovery.result;
              activeVisualInput = recovery.visualInput;
              useVisualInput = recovery.visualInput;
              visionFallback = visionFallback || recovery.visionFallback;
            }
            completed[batchIndex] = result;
            completedCount += 1;
            const mergedPartial = mergeFigurePanelBatchResults(
              completed.filter(Boolean), figure, analysisDepth
            );
            const partial = visionFallback && !activeVisualInput
              ? { ...mergedPartial, basis: 'caption_context' }
              : mergedPartial;
            progress({
              phase: 'figure_assembling', ...batchBase,
              completedPanelBatches: completedCount,
              recognizedPanelCount: partial.panels.length,
              batchRecognizedPanelCount: result.panels.length,
              unexpectedPanels: result.panelCoverage?.unexpectedPanels || [],
              ignoredUnexpectedPanelCount:
                result.panelCoverage?.ignoredUnexpectedPanelCount || 0
            });
            await persistValidatedFigureCheckpoint({
              result: partial,
              inputMode: recoveryInputMode(activeVisualInput),
              expectedPanels: figure.panelHints,
              progressDetails: batchBase,
              pendingPhase: 'figure_panel_batch_pending',
              completePhase: 'figure_panel_batch_complete',
              details: {
                completedPanelBatches: completedCount,
                recognizedPanelCount: partial.panels.length,
                batchRecognizedPanelCount: result.panels.length,
                unexpectedPanels: result.panelCoverage?.unexpectedPanels || [],
                ignoredUnexpectedPanelCount:
                  result.panelCoverage?.ignoredUnexpectedPanelCount || 0,
                basis: partial.basis,
                visionFallback
              }
            });
            return result;
        };
        const pending = panelBatches.map((_, index) => index)
          .filter(index => !completed[index]);
        const width = Math.max(1, Math.min(2, Number(panelConcurrency) || 1));
        for (let start = 0; start < pending.length; start += width) {
          // Join the bounded wave before changing modality or committing state.
          // This keeps repairs/fallbacks and all checkpoint writes ordered while
          // retaining the exact same independent Panel prompts and validators.
          const wave = await Promise.all(pending.slice(start, start + width).map(prepareBatch));
          let waveError = null;
          for (const prepared of wave) {
            try {
              await consumeBatch(prepared);
            } catch (error) {
              waveError ||= error;
              // A failed batch must not be sealed by its neighbour's checkpoint.
              // Retain its receipts for its own fallback, or quarantine on exit.
              deferredBatchDispatches.set(prepared.batchIndex, new Map(checkpointDispatches));
              checkpointDispatches.clear();
              if (error?.figureOwnerGuardFailure === true ||
                  /^FIGURE_CHECKPOINT_|^FIGURE_REQUEST_REPLAY_AMBIGUOUS$/u.test(error?.code || '') ||
                  operation?.controller?.signal?.aborted) break;
            }
          }
          if (waveError) throw waveError;
        }
        return completed;
      };

      let batchResults;
      try {
        batchResults = await runExtraction(useVisualInput);
      } catch (error) {
        if (panelRecoveryAttempted || error?.figurePanelRecoveryAttempted === true) throw error;
        if (!useVisualInput || !beginTextFallback(error)) throw error;
        if (completed.some(Boolean)) reusableCacheResult = false;
        progress({ phase: 'figure_fallback', ...progressBase, errorCode: error.code });
        batchResults = await runExtraction(false);
      }

      const mergedPanelResult = mergeFigurePanelBatchResults(
        batchResults, figure, analysisDepth
      );
      const panelResult = visionFallback && !useVisualInput
        ? { ...mergedPanelResult, basis: 'caption_context' }
        : mergedPanelResult;
      const unresolvedPanels = panelResult.panels
        .filter(panel => panel.status === 'not_identifiable')
        .map(panel => panel.panel);
      const resolvedPanels = panelResult.panels.filter(panel =>
        panel.status !== 'not_identifiable'
      );
      const synthesisFigure = unresolvedPanels.length ? {
        ...figure,
        panelHints: resolvedPanels.map(panel => panel.panel)
      } : figure;
      const synthesisBase = {
        ...progressBase,
        expectedPanels: [...figure.panelHints],
        expectedPanelCount: figure.panelHints.length,
        completedPanelBatches: panelBatches.length,
        totalPanelBatches: panelBatches.length
      };
      progress({
        phase: 'figure_synthesizing', ...synthesisBase,
        recognizedPanelCount: panelResult.panels.length
      });
      const synthesisPrompt = shared.compileFigureSynthesisPrompt(
        synthesisFigure, resolvedPanels, { visualInput: useVisualInput, analysisDepth }
      );
      const synthesisRequest = {
        ...synthesisPrompt,
        images: [],
        outputUnits: Math.max(1, resolvedPanels.length)
      };
      const synthesized = await requestValidated({
        prompt: synthesisPrompt,
        request: synthesisRequest,
        progressDetails: synthesisBase,
        validate: raw => shared.validateFigureSynthesis(
          raw, synthesisFigure, resolvedPanels,
          { visualInput: useVisualInput, analysisDepth }
        )
      });
      const result = unresolvedPanels.length ? {
        ...synthesized,
        panels: panelResult.panels,
        panelCoverage: {
          expectedPanels: [...figure.panelHints],
          returnedPanels: panelResult.panels.map(panel => panel.panel),
          resolvedPanels: resolvedPanels.map(panel => panel.panel),
          unresolvedPanels: [...unresolvedPanels],
          missingPanels: []
        },
        unresolvedPanels: [...unresolvedPanels]
      } : synthesized;
      await persistValidatedFigureCheckpoint({
        result,
        inputMode: recoveryInputMode(useVisualInput),
        expectedPanels: figure.panelHints,
        progressDetails: synthesisBase,
        pendingPhase: 'figure_synthesis_checkpoint_pending',
        completePhase: 'figure_synthesis_checkpoint_complete',
        details: {
          completedPanelBatches: panelBatches.length,
          recognizedPanelCount: result.panels.length,
          basis: result.basis,
          visionFallback
        }
      });
      progress({
        phase: 'figure_synthesis_complete', ...synthesisBase,
        recognizedPanelCount: result.panels.length,
        basis: result.basis,
        visionFallback
      });
      return {
        result, visionFallback, fallbackReason,
        inputMode: recoveryInputMode(useVisualInput),
        totalPanelBatches: panelBatches.length,
        savedPanelCount: durableSavedPanelCount,
        checkpointSaved: durableCheckpointSaved,
        reusableCacheResult,
        dispatchCollector: checkpointDispatches
      };
    }

    function buildLegacyFigureCacheKey(input) {
      const context = {
        documentHash: input.documentHash,
        providerId: input.providerId,
        model: input.model,
        figureId: input.figureId,
        figureHash: input.figureHash,
        analysisDepth: input.analysisDepth === 'deep' ? 'deep' : 'standard',
        figureVersion: input.figureVersion
      };
      if (input.profileSignature) context.profileSignature = input.profileSignature;
      return `figure:${shared.stableHash(context)}`;
    }

    function normalizeCachedFigureModality(value, expectedInputMode, strictMetadata) {
      const basisField = panelCacheOwnField(value, 'basis');
      const inputModeField = panelCacheOwnField(value, 'inputMode');
      const fallbackField = panelCacheOwnField(value, 'visionFallback');
      const reasonField = panelCacheOwnField(value, 'fallbackReason');
      const fields = [basisField, inputModeField, fallbackField, reasonField];
      if (fields.some(field => !field.valid) || !basisField.present) return null;
      if (strictMetadata && fields.slice(1).some(field => !field.present)) return null;
      const expectedBasis = expectedInputMode === 'figure_image'
        ? 'vision_text' : 'caption_context';
      if (basisField.value !== expectedBasis) return null;
      const inputMode = inputModeField.present ? inputModeField.value : expectedInputMode;
      if (inputMode !== expectedInputMode) return null;
      const visionFallback = fallbackField.present ? fallbackField.value : false;
      if (typeof visionFallback !== 'boolean') return null;
      const fallbackReason = reasonField.present ? reasonField.value : '';
      if (typeof fallbackReason !== 'string' || fallbackReason.length > 64 ||
          (fallbackReason && !SAFE_VISUAL_FALLBACK_REASONS.has(fallbackReason))) return null;
      if (expectedInputMode === 'figure_image') {
        if (visionFallback || fallbackReason) return null;
      } else if (visionFallback !== Boolean(fallbackReason)) {
        return null;
      }
      return { inputMode, visionFallback, fallbackReason };
    }

    function uniqueCacheCandidates(candidates) {
      const seen = new Set();
      return candidates.filter(candidate => {
        if (!candidate.key || seen.has(candidate.key)) return false;
        seen.add(candidate.key);
        return true;
      });
    }

    async function promoteCacheEntryIfAbsent(entry, operation) {
      if (typeof cacheStore.compareAndSetManyGuarded !== 'function') return false;
      const proposal = { ...entry, revision: 0 };
      try {
        const result = await cacheStore.compareAndSetManyGuarded([proposal], {
          casKey: proposal.key,
          expectedRevision: null,
          assertActive() {
            if (operation) operationRegistry.throwIfCancelled(operation);
          },
          signal: operation?.controller?.signal
        });
        return result?.applied === true;
      } catch (_) {
        // Promotion is opportunistic. A missing CAS backend, a concurrent
        // writer, or a cancelled request must never overwrite the current key.
        return false;
      }
    }

    function isTrustedPdfFigureSender(context) {
      let isPdfSender = false;
      try {
        const sender = new URL(String(context.senderUrl || ''));
        const base = new URL(String(context.runtimeBaseUrl || ''));
        isPdfSender = context.trustedExtensionSender === true && Boolean(runtimeExtensionId) &&
          context.senderExtensionId === runtimeExtensionId &&
          /^(chrome|moz)-extension:$/.test(base.protocol) &&
          sender.protocol === base.protocol && sender.host === base.host &&
          !sender.username && !sender.password && sender.pathname === '/pdf-reader.html';
      } catch (_) { /* A non-PDF sender follows the existing HTML route. */ }
      return isPdfSender;
    }

    async function validatePdfFigureBoundary(settings, message, context) {
      const rawFigures = Array.isArray(message?.figures) ? message.figures : [];
      const isPdfSender = isTrustedPdfFigureSender(context);
      if (rawFigures.some(value => value?.pdfFigureContext != null) && !isPdfSender) {
        throw figureContractError('PDF_FIGURE_OWNER_UNAVAILABLE');
      }
      if (!isPdfSender) return [];
      if (!pdfFigureRequests?.validatePdfFigureRequest || rawFigures.length !== 1) {
        throw figureContractError('PDF_FIGURE_CONTEXT_INVALID');
      }
      const route = shared.resolveTaskProfile(settings,
        resolveLlmTaskId('LLM_ANALYZE_FIGURES', 'default'));
      return [await pdfFigureRequests.validatePdfFigureRequest(rawFigures[0], {
        capabilityMode: route.capabilityMode, verifyCurrent: context.verifyPdfFigureContext
      })];
    }

    async function validatePdfFigurePanelBoundary(
      settings, message, context, requestMode
    ) {
      const rawFigure = message?.figure;
      const hasPdfContext = rawFigure?.pdfFigureContext != null ||
        (Array.isArray(rawFigure?.imageVariants) && rawFigure.imageVariants.some(
          variant => variant?.pdfFigureContext != null || variant?.assetProof != null
        ));
      const isPdfSender = isTrustedPdfFigureSender(context);
      if (hasPdfContext && !isPdfSender) {
        throw figureContractError('PDF_FIGURE_OWNER_UNAVAILABLE');
      }
      if (!isPdfSender) return null;
      if (typeof pdfFigureRequests?.validatePdfFigurePanelRequest !== 'function' ||
          !rawFigure) {
        throw figureContractError('PDF_FIGURE_CONTEXT_INVALID');
      }
      const taskId = requestMode === 'followup'
        ? resolveLlmTaskId('LLM_ASK_FIGURE_PANEL', 'default')
        : resolveLlmTaskId('LLM_ANALYZE_FIGURE_PANEL', 'default');
      const route = shared.resolveTaskProfile(settings, taskId);
      const panelSource = isPlainObject(message?.panel)
        ? message.panel?.panel : message?.panelId || message?.panel;
      const panelId = String(panelSource || '').normalize('NFKC').trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9.+-]{0,7}$/u.test(panelId)) {
        throw invalidSettings(['panel']);
      }
      return pdfFigureRequests.validatePdfFigurePanelRequest(rawFigure, {
        capabilityMode: route.capabilityMode,
        requestMode,
        panelId,
        verifyCurrent: context.verifyPdfFigureContext
      });
    }

    async function analyzeFigures(settings, message, context, requestSignature = '', pdfValidated = []) {
      requireLlmReady(settings);
      const rawFigures = Array.isArray(message?.figures) ? message.figures.slice(0, 50) : [];
      if (!rawFigures.length) throw invalidSettings(['figures']);
      assertModernFigureRequestContract(message);
      const operationIdentity = await figureOperationIdentity(message, context, {
        requireModern: requiresModernFigureContract(message)
      });
      const operation = operationIdentity.internalOperationId
        ? operationRegistry?.getOrCreate(operationIdentity.internalOperationId) || null
        : null;
      await waitForOperation(operation);
      const document = message?.document || {};
      const paragraphs = Array.isArray(document.paragraphs) ? document.paragraphs : [];
      const documentHash = paragraphs.length
        ? await shared.hashDocument(paragraphs)
        : shared.stableHash({
          title: String(document.title || ''),
          figures: rawFigures.map(item => [item?.figureId, item?.caption])
        });
      if (!['standard', 'deep'].includes(message?.analysisDepth)) {
        throw invalidSettings(['analysisDepth']);
      }
      const analysisDepth = message.analysisDepth;
      const operationId = operationIdentity.publicOperationId;
      const figureProgressState = { active: null };
      const figureProgressContext = {
        ...context,
        onProgress: event => context.onProgress?.({
          ...(figureProgressState.active || {}),
          ...event
        }),
        onFigureCheckpoint: typeof context.onFigureCheckpoint === 'function'
          ? event => context.onFigureCheckpoint({
            ...(figureProgressState.active || {}),
            ...event
          })
          : null
      };
      const taskId = resolveLlmTaskId('LLM_ANALYZE_FIGURES', 'default');
      const previewRoute = shared.resolveTaskProfile(settings, taskId);
      let figureResumeCheckpoint = null;
      let hasFigureResumeCheckpoint = false;
      try {
        const descriptor = Object.getOwnPropertyDescriptor(message, 'figureResumeCheckpoint');
        if (descriptor && !Object.hasOwn(descriptor, 'value')) {
          throw figureContractError('FIGURE_CHECKPOINT_INVALID');
        }
        figureResumeCheckpoint = descriptor?.value;
        hasFigureResumeCheckpoint = Boolean(descriptor) &&
          figureResumeCheckpoint !== null && figureResumeCheckpoint !== undefined;
      } catch (_) {
        throw figureContractError('FIGURE_CHECKPOINT_INVALID');
      }
      const isPdfSender = pdfValidated.length > 0;
      if (isPdfSender) {
        figureProgressContext.validatePdfFigureDispatch = async request => {
          await pdfValidated[0].validateDispatchImages(request.images);
          await pdfValidated[0].assertCurrent();
        };
        figureProgressContext.assertTrustedOwnerCurrent = async () => {
          await context.assertTrustedOwnerCurrent?.();
          await pdfValidated[0].assertCurrent();
        };
        const checkpoint = figureProgressContext.onFigureCheckpoint;
        if (checkpoint) figureProgressContext.onFigureCheckpoint = async event => {
          await pdfValidated[0].assertCurrent();
          return checkpoint(event);
        };
      }
      const figures = (isPdfSender ? pdfValidated.map(value => value.figure) : rawFigures)
        .map(value => normalizeFigureInput(value, document.title, isPdfSender));
      const pdfDiscoveryWorkflow = isPdfSender && previewRoute.capabilityMode === 'vision';
      let inventoryStage = null;
      if (pdfDiscoveryWorkflow) {
        const source = pdfValidated[0].figure;
        const figure = figures[0];
        const input = {
          sourceKind: 'pdf', capabilityMode: 'vision', imageInputCount: figure.images.length,
          figureId: figure.figureId, figureLabel: figure.figureLabel,
          pageNumbers: source.pdfFigureContext.figure.pageNumbers,
          captionPageNumbers: source.pdfFigureContext.figure.pageNumbers,
          artworkPageNumbers: source.pdfEvidenceBinding.visualEvidenceSet?.requiredArtworkPageNumbers ||
            source.pdfEvidenceBinding.assetProof?.pageNumbers,
          captionAnchor: figure.caption, captionKnownPanels: figure.panelHints,
          pdfEvidenceBinding: figure.pdfEvidenceBinding
        };
        if (pdfPanelInventory.normalizePdfFigurePanelInventoryContext(input).discoveryAllowed) {
          // Operation-scoped storage is intentional: a new analysis operation
          // can discover afresh, but restarting one operation cannot rebill its
          // already acknowledged inventory stage or silently change its scope.
          const bindingDigest = await strongSha256({
            domain: PDF_FIGURE_WORKFLOW_VERSION,
            inventoryVersion: pdfPanelInventory.normalizePdfFigurePanelInventoryContext(input).version,
            operationIdentity, documentHash, analysisDepth, input,
            figureOperationPlan: message.figureOperationPlan || null,
            routeDigest: await strongFigureRouteDigest(settings, previewRoute, taskId),
            taskPolicy: settings.taskPolicies[taskId]
          }, cryptoImpl);
          const key = `pdf-panel-inventory:sha256:${bindingDigest}`;
          const entries = await readFigureCacheRecords([key]);
          const entry = entries.get(key);
          inventoryStage = { key, bindingDigest, input, entry: null, coverage: null, proofDigest: '' };
          if (entry) {
            if (entry.bindingDigest !== bindingDigest) {
              throw figureContractError('PDF_FIGURE_PANEL_INVENTORY_BINDING_CONFLICT');
            }
            inventoryStage.coverage = pdfPanelInventory.validatePdfFigurePanelInventory(entry.inventory, input);
            const digest = await strongSha256({
              domain: 'pdf-panel-inventory-cache-proof-v1', key, bindingDigest,
              inventory: entry.inventory
            }, cryptoImpl);
            if (entry.providerProofDigest !== digest) {
              throw figureContractError('PDF_FIGURE_PANEL_INVENTORY_BINDING_CONFLICT');
            }
            inventoryStage.entry = entry;
            inventoryStage.proofDigest = digest;
          }
          await pdfValidated[0].assertCurrent();
          if (hasFigureResumeCheckpoint && !inventoryStage.entry) {
            throw figureContractError('FIGURE_CHECKPOINT_INVALID');
          }
        }
      }
      const boundFigureProviderAttemptBudget = await bindFigureProviderAttemptBudget({
        settings,
        message,
        figures,
        taskId,
        route: previewRoute,
        operation,
        operationIdentity,
        documentHash,
        requestSignature,
        prepareOnly: true,
        pdfDiscoveryWorkflow,
        inventoryContinuationDigest: inventoryStage?.proofDigest || ''
      });
      const figureProviderAttemptBudget = boundFigureProviderAttemptBudget.budget;
      figureProgressContext.figureProviderAttemptBudget = figureProviderAttemptBudget;
      figureProgressContext.figureProviderAttemptBinding =
        boundFigureProviderAttemptBudget.durableBinding;
      const task = createTaskAdapter(
        settings, taskId, figureProgressContext
      );
      const { adapter, route, routePublic } = task;
      const progress = routeProgress(figureProgressContext, routePublic);
      let recoveredInventoryProof = false;
      if (inventoryStage) {
        const stage = inventoryStage;
        const collector = new Map();
        if (!stage.entry) {
          await boundFigureProviderAttemptBudget.activateDurableBinding();
          progress({ phase: 'figure_inventory', operationId,
            figureId: figures[0].figureId, figureLabel: figures[0].figureLabel,
            expectedPanels: [...figures[0].panelHints], expectedPanelCount: figures[0].panelHints.length });
          const prompt = pdfPanelInventory.compilePdfFigurePanelInventoryPrompt(stage.input);
          const configuredCap = Number(route.tokenPolicy?.mode === 'manual'
            ? route.tokenPolicy.manualMax : route.tokenPolicy?.autoCap);
          const raw = await requestFigureJson({ ...adapter, generateJson: adapter.generateJsonAtLimit }, {
            ...prompt, images: figures[0].images,
            maxOutputTokens: Math.min(12288, configuredCap > 0 ? configuredCap : 12288),
            timeoutMs: TASK_TIMEOUTS_MS.figure || 180000,
            reasoningEnabled: route.effectiveReasoning?.enabled === true,
            reasoningEffort: route.effectiveReasoning?.effort || 'auto'
          }, figureProgressContext, {}, { operation, maxAttempts: 1, dispatchCollector: collector });
          stage.coverage = pdfPanelInventory.validatePdfFigurePanelInventory(raw?.panel_marker_inventory, stage.input);
          stage.proofDigest = await strongSha256({
            domain: 'pdf-panel-inventory-cache-proof-v1', key: stage.key,
            bindingDigest: stage.bindingDigest, inventory: raw.panel_marker_inventory
          }, cryptoImpl);
          stage.entry = { key: stage.key, bindingDigest: stage.bindingDigest,
            inventory: raw.panel_marker_inventory, providerProofDigest: stage.proofDigest, createdAt: Date.now() };
          await pdfValidated[0].assertCurrent();
          const proof = { kind: 'cache', digest: stage.proofDigest };
          const consumed = await prepareDurableFigureDispatchProof(adapter, collector, proof);
          await persistFigureCacheRecords([stage.entry]);
          await pdfValidated[0].assertCurrent();
          await sealDurablyConsumedFigureDispatches(adapter, collector, consumed, proof, stage.proofDigest);
        } else if (boundFigureProviderAttemptBudget.cacheProofPending &&
            boundFigureProviderAttemptBudget.expectedCacheProofDigest === stage.proofDigest) {
          // An unsealed inventory cannot have produced an analysis checkpoint.
          // Reject this inconsistent resume read-only; confirming the cache
          // first would consume the valid continuation on a malformed request.
          if (hasFigureResumeCheckpoint) {
            throw figureContractError('FIGURE_CHECKPOINT_INVALID');
          }
          await boundFigureProviderAttemptBudget.confirmCacheProof(stage.proofDigest);
          recoveredInventoryProof = true;
        } else if (!hasFigureResumeCheckpoint && !boundFigureProviderAttemptBudget.cacheProofPending) {
          await boundFigureProviderAttemptBudget.confirmResumeProof();
        }
        // A restarted receipt inherits a once-consumable stage continuation.
        // Do not supersede an explicit analysis checkpoint or final-cache proof.
        if (!hasFigureResumeCheckpoint &&
            (!boundFigureProviderAttemptBudget.cacheProofPending || recoveredInventoryProof)) {
          await sealDurablyConsumedFigureDispatches(adapter, collector, [],
            { kind: 'cache', digest: stage.proofDigest }, stage.proofDigest);
        }
        await pdfValidated[0].assertCurrent();
        const panelInventory = { ...stage.coverage, provenance: {
          ...stage.coverage.provenance,
          semanticEvidenceDigest: await pdfFigureRequests.pdfFigureSemanticEvidenceDigest(
            pdfValidated[0].figure.pdfFigureContext)
        } };
        figures[0] = { ...figures[0], panelHints: [...stage.coverage.effectivePanels],
          panelInventory, panelInventoryDigest: stage.proofDigest,
          panelDirectoryDigest: await pdfFigureRequests.pdfFigurePanelDirectoryDigest(panelInventory) };
        progress({ phase: 'figure_inventory_ready', operationId,
          figureId: figures[0].figureId, figureLabel: figures[0].figureLabel,
          expectedPanels: [...figures[0].panelHints], expectedPanelCount: figures[0].panelHints.length,
          discoveredPanelCount: stage.coverage.discoveredPanels.length,
          inventoryCoverageComplete: stage.coverage.coverageComplete });
      }
      const records = await Promise.all(figures.map(async figure => {
        const requestedInputMode = route.capabilityMode === 'vision' && figure.images.length
          ? 'figure_image' : 'caption_context';
        const modes = Object.create(null);
        for (const inputMode of ['figure_image', 'caption_context']) {
          const cacheBindingDigest = await strongSha256({
            domain: 'figure-analysis-cache-binding-v2',
            implementationVersion: String(shared.FIGURE_ANALYSIS_VERSION || ''),
            taskId,
            documentHash,
            routeDigest: boundFigureProviderAttemptBudget.routeDigest,
            taskPolicyDigest: boundFigureProviderAttemptBudget.taskPolicyDigest,
            inputMode,
            analysisDepth,
            allowTextFallback: task.taskPolicy?.allowTextFallback === true,
            figure: {
              figureId: figure.figureId,
              figureLabel: figure.figureLabel,
              articleTitle: figure.articleTitle,
              caption: figure.caption,
              panelHints: figure.panelHints,
              ...(figure.panelInventoryDigest ? { panelInventoryDigest: figure.panelInventoryDigest } : {}),
              contextParagraphs: figure.contextParagraphs,
              ...(figure.pdfEvidenceBinding ? { pdfEvidenceBinding: figure.pdfEvidenceBinding } : {}),
              images: inputMode === 'figure_image' ? figure.images : []
            }
          }, cryptoImpl);
          const key = `figure:sha256:${cacheBindingDigest}`;
          modes[inputMode] = {
            key, inputMode, cacheBindingDigest,
            candidates: [{ key, strictMetadata: true }]
          };
        }
        const inputDigest = await strongSha256({
          documentHash,
          articleTitle: String(document.title || ''),
          analysisDepth,
          figure: {
            figureId: figure.figureId,
            figureLabel: figure.figureLabel,
            caption: figure.caption,
            panelHints: figure.panelHints,
            ...(figure.panelInventoryDigest ? { panelInventoryDigest: figure.panelInventoryDigest } : {}),
            contextParagraphs: figure.contextParagraphs,
            ...(figure.pdfEvidenceBinding ? { pdfEvidenceBinding: figure.pdfEvidenceBinding } : {}),
            images: figure.images
          }
        }, cryptoImpl);
        const checkpointBindingFields = {
          version: FIGURE_CHECKPOINT_ENVELOPE_VERSION,
          implementationVersion: String(shared.FIGURE_ANALYSIS_VERSION || ''),
          figureId: figure.figureId,
          analysisDepth,
          inputDigest,
          routeDigest: boundFigureProviderAttemptBudget.routeDigest,
          taskPolicyDigest: boundFigureProviderAttemptBudget.taskPolicyDigest,
          planDigest: boundFigureProviderAttemptBudget.planDigest,
          operationPlan: boundFigureProviderAttemptBudget.operationPlan,
          ...(figure.panelInventoryDigest ? { panelInventoryBinding: {
            version: 'pdf-figure-panel-scope-v1',
            inventoryDigest: figure.panelInventoryDigest,
            captionKnownPanels: [...figure.panelInventory.captionKnownPanels],
            effectivePanels: [...figure.panelHints]
          } } : {}),
          immutableLimit: boundFigureProviderAttemptBudget.immutableLimit
        };
        const checkpointBinding = {
          ...checkpointBindingFields,
          bindingDigest: await strongSha256(checkpointBindingFields, cryptoImpl)
        };
        return {
          figure,
          requestedInputMode,
          modes,
          checkpointBinding
        };
      }));
      const recoverCacheProof =
        boundFigureProviderAttemptBudget.cacheProofPending === true && !recoveredInventoryProof;
      let resumeRecordIndex = -1;
      let prevalidatedResume = null;
      if (hasFigureResumeCheckpoint) {
        const figureIdDescriptor = Object.getOwnPropertyDescriptor(
          figureResumeCheckpoint, 'figureId'
        );
        const checkpointFigureId = figureIdDescriptor?.enumerable === true &&
          Object.hasOwn(figureIdDescriptor, 'value') &&
          typeof figureIdDescriptor.value === 'string'
          ? figureIdDescriptor.value : '';
        resumeRecordIndex = records.findIndex(record =>
          record.figure.figureId === checkpointFigureId
        );
        if (resumeRecordIndex < 0) {
          throw figureContractError('FIGURE_CHECKPOINT_INVALID');
        }
        const resumeRecord = records[resumeRecordIndex];
        const validatedResume = await requestFigurePanelBatches({
          adapter,
          route,
          figure: resumeRecord.figure,
          analysisDepth,
          progress: () => {},
          checkpoint: null,
          progressBase: {},
          operation,
          checkpointBinding: resumeRecord.checkpointBinding,
          resumeCheckpoint: figureResumeCheckpoint,
          validateResumeOnly: true,
          allowTextFallback: task.taskPolicy?.allowTextFallback === true && !resumeRecord.figure.panelInventory,
          panelConcurrency: message?.parallelBatch === true
            ? 1 : TASK_CONCURRENCY.figure
        });
        prevalidatedResume = validatedResume.resumeValidation;
        if (!prevalidatedResume) {
          throw figureContractError('FIGURE_CHECKPOINT_INVALID');
        }
        // No durable receipt mutation occurs until the entire checkpoint has
        // been bound to one current record and its result/basis/route/plan have
        // passed validation. Cache-proof recovery below is deliberately later.
        if (!recoverCacheProof) {
          await boundFigureProviderAttemptBudget.confirmResumeProof();
        }
      }
      const cached = (message?.forceRefresh === true || hasFigureResumeCheckpoint) &&
        !recoverCacheProof
        ? new Map() : await readFigureCacheRecords(records.flatMap(record =>
          (recoverCacheProof
            ? Object.values(record.modes)
            : [record.modes[record.requestedInputMode]])
            .flatMap(mode => mode.candidates.map(candidate => candidate.key))
        ));
      const validateCachedRecord = async (
        record, readableMode, candidate, requiredProofDigest = ''
      ) => {
        if (!cached.has(candidate.key)) return null;
        const cachedEntry = cached.get(candidate.key);
        if (!strongDigestMatches(
          cacheEntryStrongDigest(cachedEntry, 'cacheBindingDigest'),
          readableMode.cacheBindingDigest
        ) || !strongDigestMatches(
          cacheEntryStrongDigest(cachedEntry, 'routeDigest'),
          boundFigureProviderAttemptBudget.routeDigest
        ) || !strongDigestMatches(
          cacheEntryStrongDigest(cachedEntry, 'taskPolicyDigest'),
          boundFigureProviderAttemptBudget.taskPolicyDigest
        )) return null;
        const resultField = panelCacheOwnField(cachedEntry, 'figureResult');
        if (!resultField.valid || !resultField.present) return null;
        const providerProofDigest = await strongSha256({
          domain: 'figure-provider-cache-proof-v2',
          key: readableMode.key,
          cacheBindingDigest: readableMode.cacheBindingDigest,
          figureResult: resultField.value
        }, cryptoImpl);
        if (!strongDigestMatches(
          cacheEntryStrongDigest(cachedEntry, 'providerProofDigest'),
          providerProofDigest
        ) || (requiredProofDigest && !strongDigestMatches(
          providerProofDigest, requiredProofDigest
        ))) return null;
        const modality = normalizeCachedFigureModality(
          resultField.value, readableMode.inputMode, candidate.strictMetadata
        );
        if (!modality) return null;
        let validated;
        try {
          validated = shared.validateCachedFigureAnalysis(
            resultField.value, record.figure, { analysisDepth }
          );
        } catch (_) {
          return null;
        }
        return {
          providerProofDigest,
          result: { ...validated, ...modality, cacheHit: true }
        };
      };
      let recoveredCacheProof = null;
      if (recoverCacheProof) {
        const expected = boundFigureProviderAttemptBudget.expectedCacheProofDigest;
        if (!/^[a-f0-9]{64}$/u.test(String(expected || ''))) {
          throw figureContractError('FIGURE_REQUEST_REPLAY_AMBIGUOUS');
        }
        for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
          const record = records[recordIndex];
          for (const readableMode of Object.values(record.modes)) {
            for (const candidate of readableMode.candidates) {
              const match = await validateCachedRecord(
                record, readableMode, candidate, expected
              );
              if (!match) continue;
              // A cache proof is an exact durable continuation, not a bucket
              // lookup. More than one semantic result matching the same proof
              // is inconsistent even if a compromised cache duplicated it.
              if (recoveredCacheProof) {
                throw figureContractError('FIGURE_REQUEST_REPLAY_AMBIGUOUS');
              }
              recoveredCacheProof = { recordIndex, ...match };
            }
          }
        }
        if (!recoveredCacheProof) {
          throw figureContractError('FIGURE_REQUEST_REPLAY_AMBIGUOUS');
        }
        await boundFigureProviderAttemptBudget.confirmCacheProof(
          recoveredCacheProof.providerProofDigest
        );
      }
      await waitForOperation(operation);
      const figureResults = [];
      let cacheHits = 0;
      let visionFallbacks = 0;
      const progressOffset = Math.max(
        0,
        Math.floor(Number(message.figureProgressOffset) || 0)
      );
      const progressTotal = Math.max(
        progressOffset + records.length,
        Math.floor(Number(message.figureProgressTotal) || 0)
      );

      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        const startedAt = Date.now();
        const progressBase = {
          figureId: record.figure.figureId,
          figureLabel: record.figure.figureLabel,
          expectedPanels: [...record.figure.panelHints],
          expectedPanelCount: record.figure.panelHints.length,
          completedFigures: progressOffset + index,
          totalFigures: progressTotal,
          providerId: route.providerId,
          model: route.model,
          capabilityMode: route.capabilityMode,
          operationId,
          startedAt
        };
        figureProgressState.active = progressBase;
        let durablySavedPanelCount = 0;
        let durableCheckpointSaved = false;
        let result;
        const requestedMode = record.modes[record.requestedInputMode];
        const recordHasResume = index === resumeRecordIndex;
        if (recoveredCacheProof?.recordIndex === index) {
          result = recoveredCacheProof.result;
          cacheHits += 1;
          await waitForOperation(operation);
        } else if (message?.forceRefresh !== true && !recordHasResume) {
          for (const candidate of requestedMode.candidates) {
            const match = await validateCachedRecord(
              record, requestedMode, candidate
            );
            if (!match) continue;
            result = match.result;
            cacheHits += 1;
            await waitForOperation(operation);
            break;
          }
        }
        if (!result) {
          if (!recordHasResume) {
            await boundFigureProviderAttemptBudget.activateDurableBinding();
          }
          const analyzed = await requestFigurePanelBatches({
            adapter,
            route,
            figure: record.figure,
            analysisDepth,
            progress,
            checkpoint: figureProgressContext.onFigureCheckpoint,
            progressBase,
            operation,
            checkpointBinding: record.checkpointBinding,
            resumeCheckpoint: recordHasResume ? figureResumeCheckpoint : null,
            prevalidatedResume: recordHasResume ? prevalidatedResume : null,
            onResumeValidated: null,
            allowTextFallback: task.taskPolicy?.allowTextFallback === true && !record.figure.panelInventory,
            // Keep automatic vision-to-text fallback on its existing ordered
            // path. Prefetch must not introduce mixed-modality provenance.
            panelConcurrency: message?.parallelBatch === true ||
              (route.capabilityMode === 'vision' && record.figure.images.length > 0 &&
                task.taskPolicy?.allowTextFallback === true) ? 1
              : ['deepseek', 'codex-local'].includes(route.providerId) ? 2 : TASK_CONCURRENCY.figure
          });
          result = {
            ...analyzed.result,
            visionFallback: analyzed.visionFallback,
            inputMode: analyzed.inputMode,
            fallbackReason: analyzed.fallbackReason,
            cacheHit: false
          };
          durablySavedPanelCount = Math.max(
            0, Math.floor(Number(analyzed.savedPanelCount) || 0)
          );
          durableCheckpointSaved = analyzed.checkpointSaved === true;
          const writeRecord = record.modes[analyzed.inputMode];
          await pdfValidated[0]?.assertCurrent();
          if (analyzed.reusableCacheResult !== false) {
            const cacheProof = {
              kind: 'cache',
              digest: await strongSha256({
                domain: 'figure-provider-cache-proof-v2',
                key: writeRecord.key,
                cacheBindingDigest: writeRecord.cacheBindingDigest,
                figureResult: result
              }, cryptoImpl)
            };
            const consumedAttempts = await prepareDurableFigureDispatchProof(
              adapter, analyzed.dispatchCollector, cacheProof
            );
            await persistFigureCacheRecords([{
              key: writeRecord.key,
              createdAt: Date.now(),
              figureResult: result,
              cacheBindingDigest: writeRecord.cacheBindingDigest,
              routeDigest: boundFigureProviderAttemptBudget.routeDigest,
              taskPolicyDigest: boundFigureProviderAttemptBudget.taskPolicyDigest,
              providerProofDigest: cacheProof.digest
            }]);
            await sealDurablyConsumedFigureDispatches(
              adapter, analyzed.dispatchCollector, consumedAttempts, cacheProof
            );
          }
        }
        await pdfValidated[0]?.assertCurrent();
        if (result.visionFallback) visionFallbacks += 1;
        // The directory is locally validated against the exact image set. Keep
        // it with the result so a later standalone Panel can resolve its page;
        // provider prose and caption labels are never used as page evidence.
        if (record.figure.panelInventory) result = {
          ...result,
          pdfPanelInventory: record.figure.panelInventory,
          pdfPanelInventoryDigest: record.figure.panelDirectoryDigest,
          pdfEvidenceBinding: record.figure.pdfEvidenceBinding
        };
        figureResults.push(result);
        progress({
          phase: 'figure',
          ...progressBase,
          completedFigures: progressOffset + index + 1,
          basis: result.basis,
          inputMode: result.inputMode,
          cacheHit: result.cacheHit,
          recognizedPanelCount: Array.isArray(result.panels) ? result.panels.length : 0,
          savedPanelCount: durablySavedPanelCount,
          validatedPanelCount: Array.isArray(result.panels) ? result.panels.length : 0,
          missingPanels: Array.isArray(result.panelCoverage?.missingPanels)
            ? [...result.panelCoverage.missingPanels] : [],
          unresolvedPanels: Array.isArray(result.unresolvedPanels)
            ? [...result.unresolvedPanels] : [],
          checkpointStatus: durableCheckpointSaved ? 'saved' : 'not_requested'
        });
        figureProgressState.active = null;
      }

      return {
        documentHash,
        figureResults,
        totalFigures: figureResults.length,
        cacheHits,
        visionFallbacks,
        analysisDepth,
        operationId,
        providerId: route.providerId,
        model: route.model,
        route: routePublic,
        figureVersion: shared.FIGURE_ANALYSIS_VERSION
      };
    }

    function matchesAdmittedPdfPanelBinding(value, verifiedFigure) {
      if (!value || !verifiedFigure) return false;
      const admitted = [
        verifiedFigure.pdfEvidenceBinding,
        ...(Array.isArray(verifiedFigure.imageVariants)
          ? verifiedFigure.imageVariants.map(item => item?.pdfEvidenceBinding) : [])
      ].filter(Boolean);
      if (!admitted.length) return false;
      try {
        const candidate = canonicalStrongJson(value);
        return admitted.some(binding => canonicalStrongJson(binding) === candidate);
      } catch (_) {
        return false;
      }
    }

    function normalizeSinglePanelInput(message, requestMode, verifiedFigure = null) {
      const document = message?.document || {};
      const figure = normalizeFigureInput(
        verifiedFigure || message?.figure, document.title, Boolean(verifiedFigure)
      );
      const rawPanelSource = isPlainObject(message?.panel)
        ? message.panel : { panel: message?.panelId || message?.panel };
      const panelSource = !verifiedFigure || matchesAdmittedPdfPanelBinding(
        rawPanelSource.pdfEvidenceBinding, verifiedFigure
      ) ? rawPanelSource : { panel: rawPanelSource.panel };
      const panel = String(panelSource.panel || '').trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9.+-]{0,7}$/.test(panel)) {
        throw invalidSettings(['panel']);
      }
      if (figure.panelHints.length && !figure.panelHints.includes(panel)) {
        throw invalidSettings(['panel']);
      }
      const topics = shared.normalizePanelFollowupTopics(message?.topics);
      const customQuestion = shared.normalizePanelCustomQuestion(message?.customQuestion);
      const hasFollowupIntent = topics.length > 0 || Boolean(customQuestion);
      if (requestMode === 'followup' && !hasFollowupIntent) {
        throw invalidSettings(['topics', 'customQuestion'],
          'Panel follow-up requires a built-in topic or a custom question');
      }
      const documentHash = String(
        message?.documentHash || document.documentHash || ''
      ).replace(/^sha256:/i, '').trim().toLowerCase();
      return {
        ...figure,
        requestMode,
        documentHash: /^[a-f0-9]{64}$/.test(documentHash)
          ? documentHash : shared.stableHash({
            title: document.title || '', figureId: figure.figureId, caption: figure.caption
          }),
        panelId: panel,
        panel: {
          panel,
          role: String(panelSource.role || '').trim().slice(0, 80),
          phenotypeName: String(panelSource.phenotypeName || '').trim().slice(0, 240),
          methods: (Array.isArray(panelSource.methods) ? panelSource.methods : [])
            .slice(0, 12).map(item => String(item || '').trim().slice(0, 120)),
          purpose: String(panelSource.purpose || '').trim().slice(0, 1000),
          design: String(panelSource.design || '').trim().slice(0, 1000),
          comparison: String(panelSource.comparison || '').trim().slice(0, 1000),
          directObservation: String(panelSource.directObservation || '').trim().slice(0, 1000)
        },
        topics,
        customQuestion,
        history: (Array.isArray(message?.history) ? message.history : []).slice(-100)
          .filter(item => !verifiedFigure || matchesAdmittedPdfPanelBinding(
            item?.pdfEvidenceBinding, verifiedFigure
          ))
          .map((item, index) => ({
            historyId: String(item?.historyId || item?.turnId || `panel-history-${index + 1}`)
              .slice(0, 120),
            role: item?.role === 'assistant' ? 'assistant' : 'user',
            content: String(item?.content || item?.answer || item?.question || '')
              .normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 3200)
          })).filter(item => item.content)
      };
    }

    function isSafePanelCacheRecord(value) {
      if (!value || typeof value !== 'object') return false;
      try {
        if (Array.isArray(value)) return false;
        const prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null;
      } catch (_) {
        return false;
      }
    }

    function panelCacheOwnField(value, key) {
      if (!isSafePanelCacheRecord(value)) {
        return { valid: false, present: false, value: undefined };
      }
      try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) return { valid: true, present: false, value: undefined };
        if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          return { valid: false, present: true, value: undefined };
        }
        return { valid: true, present: true, value: descriptor.value };
      } catch (_) {
        return { valid: false, present: false, value: undefined };
      }
    }

    function panelCacheOwnData(value, key) {
      const field = panelCacheOwnField(value, key);
      return field.valid && field.present ? field.value : undefined;
    }

    function panelCacheHasExactKeys(value, allowed, required = allowed) {
      if (!isSafePanelCacheRecord(value)) return false;
      try {
        const keys = Reflect.ownKeys(value);
        if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) return false;
        if (required.some(key => !keys.includes(key))) return false;
        return keys.every(key => {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value');
        });
      } catch (_) {
        return false;
      }
    }

    function panelCacheArray(value, limit) {
      try {
        if (!Array.isArray(value)) return null;
        if (Object.getPrototypeOf(value) !== Array.prototype || value.length > limit) return null;
        const result = [];
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
          result.push(descriptor.value);
        }
        return result;
      } catch (_) {
        return null;
      }
    }

    function panelCacheStringArray(value, limit, maxLength) {
      const items = panelCacheArray(value, limit);
      if (!items || items.some(item => typeof item !== 'string' || item.length > maxLength)) {
        return null;
      }
      return items.slice();
    }

    function normalizeCachedPanelInputBasis(value, expectedPlan) {
      const allowed = [
        'topic', 'inputMode', 'imageWidth', 'imageHeight', 'imageMaxEdge',
        'pixelsSupplied', 'selectedSources', 'degradationReason', 'estimatedInputTokens',
        'inputBudgetTokens', 'includedHistoryIds', 'attempts', 'outputBudgetTokens'
      ];
      const required = [
        'topic', 'inputMode', 'imageWidth', 'imageHeight', 'imageMaxEdge',
        'pixelsSupplied', 'selectedSources', 'degradationReason',
        'includedHistoryIds', 'attempts', 'outputBudgetTokens'
      ];
      if (!panelCacheHasExactKeys(value, allowed, required)) return null;
      const result = Object.create(null);
      for (const key of ['topic', 'inputMode', 'degradationReason']) {
        const item = panelCacheOwnData(value, key);
        if (item !== undefined) {
          if (typeof item !== 'string' || item.length > 240) return null;
          result[key] = item;
        }
      }
      if (!['figure_image', 'panel_crop', 'caption_context'].includes(result.inputMode)) {
        return null;
      }
      if (Object.prototype.hasOwnProperty.call(result, 'degradationReason') &&
          !SAFE_PANEL_DEGRADATION_REASONS.has(result.degradationReason)) return null;
      for (const key of [
        'imageWidth', 'imageHeight', 'imageMaxEdge', 'estimatedInputTokens',
        'inputBudgetTokens', 'attempts', 'outputBudgetTokens'
      ]) {
        const item = panelCacheOwnData(value, key);
        if (item !== undefined) {
          if (!Number.isSafeInteger(item) || item < 0 || item > 10000000) return null;
          result[key] = item;
        }
      }
      const pixelsSupplied = panelCacheOwnData(value, 'pixelsSupplied');
      if (typeof pixelsSupplied !== 'boolean') return null;
      result.pixelsSupplied = pixelsSupplied;
      const compatibleReasons = pixelsSupplied
        ? new Set(['', 'smaller_image_for_capacity'])
        : new Set([
            'vision_unavailable_or_no_image',
            'text_only_for_capacity',
            ...SAFE_VISUAL_FALLBACK_REASONS
          ]);
      if (!compatibleReasons.has(result.degradationReason)) return null;
      if (expectedPlan && (result.inputMode !== expectedPlan.inputMode ||
          result.pixelsSupplied !== (expectedPlan.pixelsSupplied === true) ||
          Number(result.imageWidth || 0) !== Number(expectedPlan.imageWidth || 0) ||
          Number(result.imageHeight || 0) !== Number(expectedPlan.imageHeight || 0) ||
          Number(result.imageMaxEdge || 0) !== Number(expectedPlan.imageMaxEdge || 0))) {
        return null;
      }
      for (const key of ['selectedSources', 'includedHistoryIds']) {
        const item = panelCacheOwnData(value, key);
        if (item !== undefined) {
          const projected = panelCacheStringArray(item, 100, 120);
          if (!projected) return null;
          result[key] = projected;
        }
      }
      if (expectedPlan) {
        const expectedSources = Array.isArray(expectedPlan.selectedSources)
          ? expectedPlan.selectedSources : [];
        const expectedHistoryIds = Array.isArray(expectedPlan.history)
          ? expectedPlan.history.map(item => String(item?.historyId || '')) : [];
        if (result.topic !== String(expectedPlan.topic || '') ||
            result.selectedSources?.length !== expectedSources.length ||
            result.selectedSources?.some((item, index) => item !== expectedSources[index]) ||
            result.includedHistoryIds?.length !== expectedHistoryIds.length ||
            result.includedHistoryIds?.some((item, index) =>
              item !== expectedHistoryIds[index])) {
          return null;
        }
      }
      return result;
    }

    function cachedPanelFollowupRawSources(value, input) {
      const sources = panelCacheArray(value, 24);
      if (!sources || !sources.length) return null;
      const raw = [];
      for (const item of sources) {
        const kind = panelCacheOwnData(item, 'kind');
        const panelKeys = [
          'kind', 'ref', 'figureId', 'panelId', 'paragraphId', 'quote'
        ];
        const paragraphKeys = ['kind', 'ref', 'paragraphId', 'quote'];
        if (kind === 'panel') {
          if (!panelCacheHasExactKeys(item, panelKeys) ||
              panelCacheOwnData(item, 'figureId') !== input.figureId ||
              panelCacheOwnData(item, 'panelId') !== input.panelId) return null;
        } else if (kind === 'paragraph') {
          if (!panelCacheHasExactKeys(item, paragraphKeys)) return null;
        } else {
          return null;
        }
        const ref = panelCacheOwnData(item, 'ref');
        const paragraphId = panelCacheOwnData(item, 'paragraphId');
        const quote = panelCacheOwnData(item, 'quote');
        if (typeof ref !== 'string' || ref.length > 120 ||
            typeof paragraphId !== 'string' || paragraphId.length > 120 ||
            typeof quote !== 'string' || quote.length > 600) return null;
        raw.push({ kind, ref, paragraph_id: paragraphId, quote });
      }
      return raw;
    }

    function validateCachedPanelFollowup(value, input, expectedPlan) {
      const allowed = [
        'figureId', 'panel', 'topics', 'customQuestion', 'basis', 'answer',
        'claimBoundary', 'sourceRefs', 'inputBasis', 'cacheHit', 'promptVersion'
      ];
      if (!panelCacheHasExactKeys(value, allowed) ||
          panelCacheOwnData(value, 'promptVersion') !== shared.FIGURE_PANEL_PROMPT_VERSION) {
        return null;
      }
      const topics = panelCacheStringArray(panelCacheOwnData(value, 'topics'), 8, 40);
      const sourceRefs = cachedPanelFollowupRawSources(
        panelCacheOwnData(value, 'sourceRefs'), input
      );
      const inputBasis = normalizeCachedPanelInputBasis(
        panelCacheOwnData(value, 'inputBasis'), expectedPlan
      );
      const fields = ['figureId', 'panel', 'customQuestion', 'basis', 'answer', 'claimBoundary'];
      if (!topics || !sourceRefs || !inputBasis || fields.some(key => {
        const item = panelCacheOwnData(value, key);
        return typeof item !== 'string' || item.length > 6000;
      }) || typeof panelCacheOwnData(value, 'cacheHit') !== 'boolean') return null;
      try {
        const selectedInput = { ...input, ...expectedPlan };
        const validated = shared.validatePanelFollowup({
          figure_id: panelCacheOwnData(value, 'figureId'),
          panel: panelCacheOwnData(value, 'panel'),
          topics,
          basis: panelCacheOwnData(value, 'basis'),
          answer_zh: panelCacheOwnData(value, 'answer'),
          claim_boundary_zh: panelCacheOwnData(value, 'claimBoundary'),
          source_refs: sourceRefs
        }, selectedInput, { visualInput: inputBasis.pixelsSupplied === true });
        return { ...validated, inputBasis, cacheHit: true };
      } catch (_) {
        return null;
      }
    }

    function validateCachedPanelInterpretation(value, input, expectedPlan) {
      const allowed = [
        'panel', 'role', 'phenotypeName', 'methodCategory', 'methods', 'methodDetails',
        'evidenceType', 'experimentalMethods', 'statisticalMethods', 'methodSource',
        'purpose', 'design', 'comparison', 'directObservation', 'observationSource',
        'localInference', 'contribution', 'figureId', 'basis', 'claimBoundary',
        'inputBasis', 'cacheHit', 'promptVersion'
      ];
      if (!panelCacheHasExactKeys(value, allowed) ||
          panelCacheOwnData(value, 'promptVersion') !== shared.FIGURE_PANEL_PROMPT_VERSION) {
        return null;
      }
      const inputBasis = normalizeCachedPanelInputBasis(
        panelCacheOwnData(value, 'inputBasis'), expectedPlan
      );
      const methods = panelCacheStringArray(panelCacheOwnData(value, 'methods'), 24, 240);
      const experimentalMethods = panelCacheStringArray(
        panelCacheOwnData(value, 'experimentalMethods'), 16, 1200
      );
      const statisticalMethods = panelCacheStringArray(
        panelCacheOwnData(value, 'statisticalMethods'), 16, 1200
      );
      const methodDetails = panelCacheArray(panelCacheOwnData(value, 'methodDetails'), 24);
      const stringFields = [
        'panel', 'role', 'phenotypeName', 'methodCategory', 'evidenceType', 'methodSource',
        'purpose', 'design', 'comparison', 'directObservation', 'observationSource',
        'localInference', 'contribution', 'figureId', 'basis', 'claimBoundary'
      ];
      if (!inputBasis || !methods || !experimentalMethods || !statisticalMethods ||
          !methodDetails || methodDetails.some(item => !panelCacheHasExactKeys(item,
            ['methodText', 'methodFamily', 'normalizedMethod']) ||
            ['methodText', 'methodFamily', 'normalizedMethod'].some(key =>
              typeof panelCacheOwnData(item, key) !== 'string')) ||
          stringFields.some(key => typeof panelCacheOwnData(value, key) !== 'string') ||
          typeof panelCacheOwnData(value, 'cacheHit') !== 'boolean') return null;
      try {
        const validated = shared.validateFigurePanelInterpretation({
          figure_id: panelCacheOwnData(value, 'figureId'),
          panel: panelCacheOwnData(value, 'panel'),
          basis: panelCacheOwnData(value, 'basis'),
          panel_interpretation: {
            panel: panelCacheOwnData(value, 'panel'),
            role: panelCacheOwnData(value, 'role'),
            phenotype_name_zh: panelCacheOwnData(value, 'phenotypeName'),
            method_category: panelCacheOwnData(value, 'methodCategory'),
            methods,
            evidence_type_zh: panelCacheOwnData(value, 'evidenceType'),
            experimental_methods: experimentalMethods,
            statistical_methods: statisticalMethods,
            method_source: panelCacheOwnData(value, 'methodSource'),
            purpose_zh: panelCacheOwnData(value, 'purpose'),
            design_zh: panelCacheOwnData(value, 'design'),
            comparison_zh: panelCacheOwnData(value, 'comparison'),
            direct_observation_zh: panelCacheOwnData(value, 'directObservation'),
            observation_source: panelCacheOwnData(value, 'observationSource'),
            local_inference_zh: panelCacheOwnData(value, 'localInference'),
            contribution_zh: panelCacheOwnData(value, 'contribution')
          },
          claim_boundary_zh: panelCacheOwnData(value, 'claimBoundary')
        }, input, { visualInput: inputBasis.pixelsSupplied === true });
        return { ...validated, inputBasis, cacheHit: true };
      } catch (_) {
        return null;
      }
    }

    function validateCachedPanelResult(value, input, requestMode, expectedPlan) {
      const result = requestMode === 'followup'
        ? validateCachedPanelFollowup(value, input, expectedPlan)
        : validateCachedPanelInterpretation(value, input, expectedPlan);
      const expectedBasis = expectedPlan?.pixelsSupplied === true
        ? 'vision_text' : 'caption_context';
      return result?.basis === expectedBasis ? result : null;
    }

    function publicFigurePanelPlan(plan, attempts) {
      return {
        topic: plan.topic,
        inputMode: plan.inputMode,
        imageWidth: plan.imageWidth,
        imageHeight: plan.imageHeight,
        imageMaxEdge: plan.imageMaxEdge,
        pixelsSupplied: plan.pixelsSupplied,
        selectedSources: [...plan.selectedSources],
        degradationReason: plan.degradationReason,
        estimatedInputTokens: plan.estimatedInputTokens,
        inputBudgetTokens: plan.inputBudgetTokens,
        includedHistoryIds: plan.history.map(item => item.historyId),
        attempts
      };
    }

    function buildVerifiedPdfPanelSourceRefs(input, plan, providerRefs = []) {
      const binding = plan?.pdfEvidenceBinding;
      if (!binding) return Array.isArray(providerRefs) ? providerRefs : [];
      const panelRef = `${input.figureLabel || input.figureId}${input.panelId}`;
      const result = [{
        kind: 'panel', ref: panelRef, figureId: input.figureId,
        panelId: input.panelId, paragraphId: '', quote: '',
        locatorKind: 'pdf-semantic',
        scope: { kind: 'pdf-figure-panel', figureId: input.figureId,
          panelId: input.panelId },
        binding
      }];
      const paragraphs = Array.isArray(plan?.contextParagraphs)
        ? plan.contextParagraphs : [];
      const requested = (Array.isArray(providerRefs) ? providerRefs : [])
        .filter(item => item?.kind === 'paragraph').slice(0, 24);
      const emitted = new Set();
      for (const reference of requested) {
        const paragraphId = String(reference?.paragraphId || '');
        const quote = String(reference?.quote || '').trim();
        if (!paragraphId || !quote || emitted.has(paragraphId)) continue;
        const paragraphMatches = paragraphs.filter(paragraph =>
          String(paragraph?.paragraphId || '') === paragraphId);
        if (paragraphMatches.length !== 1) continue;
        const evidenceMatches = (Array.isArray(paragraphMatches[0]?.evidence)
          ? paragraphMatches[0].evidence : []).filter(item => {
          const text = String(item?.text || '');
          if (!text) return false;
          return typeof shared.resolvePanelSourceQuote === 'function'
            ? Boolean(shared.resolvePanelSourceQuote(quote, text))
            : text.includes(quote);
        });
        if (evidenceMatches.length !== 1) continue;
        const evidence = evidenceMatches[0];
        const location = evidence?.location;
        if (!evidence?.text || location?.paragraphId !== paragraphId ||
            location.expectedNormalizedQuote !== evidence.text ||
            location.locatorStatus !== 'resolved' ||
            !['exact-raw', 'normalized-equivalent', 'discontinuous']
              .includes(location.locatorPrecision) ||
            !Array.isArray(location.sourceFragments) ||
            !location.sourceFragments.length) continue;
        emitted.add(paragraphId);
        result.push({
          kind: 'paragraph', ref: location.paragraphId,
          figureId: input.figureId, panelId: input.panelId,
          paragraphId: location.paragraphId,
          sentenceId: String(location.sentenceId || evidence.sentenceId || ''),
          quote: String(evidence.text).slice(0, 600),
          locatorKind: 'pdf-semantic',
          scope: { kind: 'pdf-figure-panel', figureId: input.figureId,
            panelId: input.panelId },
          binding,
          location: {
            paragraphId: location.paragraphId,
            ...(location.sentenceId ? { sentenceId: location.sentenceId } : {}),
            expectedNormalizedQuote: String(location.expectedNormalizedQuote || evidence.text),
            locatorStatus: 'resolved',
            locatorPrecision: String(location.locatorPrecision || ''),
            sourceFragments: location.sourceFragments.map(fragment => ({
              pageNumber: fragment.pageNumber,
              start: fragment.start,
              end: fragment.end
            }))
          }
        });
      }
      return result;
    }

    async function runSinglePanelRequest(
      settings, message, context, requestMode, requestSignature = '', pdfValidated = null
    ) {
      requireLlmReady(settings);
      const input = normalizeSinglePanelInput(
        message, requestMode, pdfValidated?.figure || null
      );
      const operationIdentity = await figureOperationIdentity(message, context, {
        requireModern: requiresModernFigureContract(message)
      });
      const operation = operationIdentity.internalOperationId
        ? operationRegistry?.getOrCreate(operationIdentity.internalOperationId) || null
        : operationFor(message);
      await waitForOperation(operation);
      const upstreamOwnerGuard = context.assertTrustedOwnerCurrent;
      const assertRequestCurrent = async () => {
        await waitForOperation(operation);
        await upstreamOwnerGuard?.();
        await pdfValidated?.assertCurrent();
      };
      await assertRequestCurrent();
      if (pdfValidated) {
        context = { ...context, assertTrustedOwnerCurrent: assertRequestCurrent };
      }
      const outputUnits = requestMode === 'followup'
        ? shared.figurePanelFollowupOutputUnits(input) : 1;
      const taskId = requestMode === 'followup'
        ? resolveLlmTaskId('LLM_ASK_FIGURE_PANEL', 'default')
        : resolveLlmTaskId('LLM_ANALYZE_FIGURE_PANEL', 'default');
      const previewRoute = shared.resolveTaskProfile(settings, taskId);
      const boundFigureProviderAttemptBudget = await bindFigureProviderAttemptBudget({
        settings,
        message,
        figures: [input],
        taskId,
        route: previewRoute,
        operation,
        operationIdentity,
        documentHash: input.documentHash,
        requestSignature,
        prepareOnly: true
      });
      context = {
        ...context,
        figureProviderAttemptBudget: boundFigureProviderAttemptBudget.budget,
        figureProviderAttemptBinding:
          boundFigureProviderAttemptBudget.durableBinding
      };
      const task = createTaskAdapter(
        settings, taskId, context,
        { maxTokenLimitRetries: 0, maxTruncationRetries: 3 }
      );
      const { adapter, route, routePublic } = task;
      const allowTextFallback = task.taskPolicy?.allowTextFallback === true;
      const profile = settings?.profiles?.[route.effectiveProfileId] || {};
      const contextWindowTokens = shared.getProviderContextWindowTokens(
        route.providerId, route.config, profile.contextWindowTokens
      );
      const requestedOutputBudget = shared.computeOutputTokenBudget(taskId, {
        tokenPolicy: task.tokenPolicy,
        taskRule: task.taskRule === 'auto' ? null : task.taskRule,
        adapterCap: adapter.maxOutputTokens,
        units: outputUnits
      });
      const maximumOutputByContext = Math.max(512, Math.floor(
        (Math.floor(contextWindowTokens * 0.9) - 768 - 2048) / 256
      ) * 256);
      const automaticRuleCeiling = requestedOutputBudget.mode === 'auto'
        ? Number(shared.RULES?.[task.taskDefinition.budgetKind]?.ceiling) ||
          requestedOutputBudget.ceiling
        : requestedOutputBudget.ceiling;
      const outputBudget = {
        ...requestedOutputBudget,
        initial: Math.min(requestedOutputBudget.initial, maximumOutputByContext),
        ceiling: Math.min(
          requestedOutputBudget.ceiling,
          automaticRuleCeiling,
          maximumOutputByContext
        ),
        contextClamped: requestedOutputBudget.initial > maximumOutputByContext ||
          requestedOutputBudget.ceiling > maximumOutputByContext ||
          requestedOutputBudget.ceiling > automaticRuleCeiling
      };
      const planInput = {
        ...input,
        existingPanelInterpretation: requestMode === 'followup' ? input.panel : null,
        imageVariants: route.capabilityMode === 'vision' ? input.imageVariants : [],
        contextWindowTokens,
        outputTokens: outputBudget.initial
      };
      const plans = shared.buildFigurePanelPlans(planInput);
      if (!plans.length || plans[0].estimatedInputTokens > plans[0].inputBudgetTokens) {
        const error = new Error('The selected model context window cannot fit this Panel request');
        error.code = 'CONTEXT_BUDGET_EXCEEDED';
        throw error;
      }
      const captionOnlyDueToCapacity = route.capabilityMode === 'vision' &&
        input.imageVariants.length > 0 &&
        !plans.some(plan => plan.pixelsSupplied === true);
      if (captionOnlyDueToCapacity && !allowTextFallback) {
        const error = new Error('The selected model context window cannot fit Panel pixels');
        error.code = 'CONTEXT_BUDGET_EXCEEDED';
        throw error;
      }
      const records = await Promise.all(plans.map(async plan => {
        const visualInput = plan.pixelsSupplied === true;
        const promptInput = {
          ...input,
          // The planner has already selected the exact provider pixels. Do not
          // let unused source variants leak into either the prompt projection
          // or its cache authority.
          imageVariants: [],
          ...plan
        };
        const prompt = requestMode === 'followup'
          ? shared.compilePanelFollowupPrompt(promptInput, {
            visualInput,
            topicPrompts: settings.figurePanelFollowupPrompts
          })
          : shared.compileFigurePanelInterpretationPrompt(promptInput, { visualInput });
        const cacheBindingDigest = await strongSha256({
          domain: 'figure-panel-cache-binding-v2',
          promptVersion: String(shared.FIGURE_PANEL_PROMPT_VERSION || ''),
          taskId,
          routeDigest: boundFigureProviderAttemptBudget.routeDigest,
          taskPolicyDigest: boundFigureProviderAttemptBudget.taskPolicyDigest,
          documentHash: input.documentHash,
          requestMode,
          figureId: input.figureId,
          panelId: input.panelId,
          prompt,
          selectedImages: plan.images,
          pdfEvidenceBinding: plan.pdfEvidenceBinding || null,
          assetProof: plan.assetProof || null,
          selectedSources: plan.selectedSources,
          selectedHistory: plan.history.map(item => ({
            historyId: item.historyId,
            role: item.role,
            content: item.content,
            memoryClass: item.memoryClass
          })),
          plan: {
            inputMode: plan.inputMode,
            imageWidth: plan.imageWidth,
            imageHeight: plan.imageHeight,
            imageMaxEdge: plan.imageMaxEdge,
            pixelsSupplied: plan.pixelsSupplied
          },
          outputBudget: {
            initial: outputBudget.initial,
            ceiling: outputBudget.ceiling,
            mode: outputBudget.mode
          }
        }, cryptoImpl);
        const key = `figure-panel:sha256:${cacheBindingDigest}`;
        return {
          plan, prompt, key, cacheBindingDigest,
          candidates: [{ key }]
        };
      }));
      const recoverCacheProof =
        boundFigureProviderAttemptBudget.cacheProofPending === true;
      if (message?.forceRefresh !== true || recoverCacheProof) {
        await assertRequestCurrent();
        const readableRecords = recoverCacheProof
          ? records
          : records.some(record => record.plan.pixelsSupplied === true)
            ? records.filter(record => record.plan.pixelsSupplied === true)
            : records.filter(record => record.plan.pixelsSupplied === false);
        const cached = await readFigureCacheRecords(readableRecords.flatMap(record =>
          record.candidates.map(candidate => candidate.key)
        ));
        await waitForOperation(operation);
        for (const record of readableRecords) {
          for (const candidate of record.candidates) {
            if (!cached.has(candidate.key)) continue;
            const cachedEntry = cached.get(candidate.key);
            if (!strongDigestMatches(
              cacheEntryStrongDigest(cachedEntry, 'cacheBindingDigest'),
              record.cacheBindingDigest
            ) || !strongDigestMatches(
              cacheEntryStrongDigest(cachedEntry, 'routeDigest'),
              boundFigureProviderAttemptBudget.routeDigest
            ) || !strongDigestMatches(
              cacheEntryStrongDigest(cachedEntry, 'taskPolicyDigest'),
              boundFigureProviderAttemptBudget.taskPolicyDigest
            )) continue;
            const valueField = panelCacheOwnField(cachedEntry, 'panelResult');
            const expectedProviderProofDigest = valueField.valid && valueField.present
              ? await strongSha256({
                domain: 'figure-panel-provider-cache-proof-v2',
                key: record.key,
                cacheBindingDigest: record.cacheBindingDigest,
                panelResult: valueField.value
              }, cryptoImpl) : '';
            if (!strongDigestMatches(
              cacheEntryStrongDigest(cachedEntry, 'providerProofDigest'),
              expectedProviderProofDigest
            ) || (recoverCacheProof && !strongDigestMatches(
              expectedProviderProofDigest,
              boundFigureProviderAttemptBudget.expectedCacheProofDigest
            ))) continue;
            const cachedResult = valueField.valid && valueField.present
              ? validateCachedPanelResult(
                valueField.value, input, requestMode, record.plan
              ) : null;
            if (!cachedResult) {
              continue;
            }
            if (recoverCacheProof) {
              await boundFigureProviderAttemptBudget.confirmCacheProof(
                expectedProviderProofDigest
              );
            }
            await assertRequestCurrent();
            const resultKey = requestMode === 'followup'
              ? 'panelFollowup' : 'panelAnalysis';
            const deliveredCachedResult = pdfValidated ? {
              ...cachedResult,
              pdfEvidenceBinding: record.plan.pdfEvidenceBinding || null,
              sourceRefs: buildVerifiedPdfPanelSourceRefs(
                input, record.plan, cachedResult.sourceRefs
              )
            } : cachedResult;
            return {
              [resultKey]: deliveredCachedResult,
              cacheHit: true,
              documentHash: input.documentHash,
              route: routePublic
            };
          }
        }
      }
      if (recoverCacheProof) {
        throw figureContractError('FIGURE_REQUEST_REPLAY_AMBIGUOUS');
      }

      await boundFigureProviderAttemptBudget.activateDurableBinding();
      await assertRequestCurrent();

      const progressBase = {
        figureId: input.figureId,
        figureLabel: input.figureLabel,
        expectedPanels: [input.panelId],
        expectedPanelCount: 1,
        taskType: routePublic.taskType,
        route: routePublic,
        completedFigures: 0,
        totalFigures: 1,
        providerId: route.providerId,
        model: route.model,
        capabilityMode: route.capabilityMode,
        operationId: String(message?.operationId || '').slice(0, 100)
      };
      context.onProgress?.({ phase: 'figure_panel_planning', ...progressBase });
      let lastError = null;
      let recordIndex = 0;
      let currentOutputTokens = outputBudget.initial;
      let degradationOverride = captionOnlyDueToCapacity
        ? 'visual_context_capacity' : '';
      let providerRequestCount = 0;
      const panelDispatches = new Map();
      const transientRetries = new Set();
      const availableInputTokens = outputTokens => Math.max(
        0,
        Math.floor(contextWindowTokens * 0.9) - Math.max(512, outputTokens) - 768
      );
      for (let providerAttempt = 0;
        providerAttempt < 6 && recordIndex < records.length;
        providerAttempt += 1) {
        const { plan, key, prompt, cacheBindingDigest } = records[recordIndex];
        await waitForOperation(operation);
        const visualInput = plan.pixelsSupplied === true;
        try {
          const selectedInput = { ...input, ...plan };
          const validate = raw => requestMode === 'followup'
            ? shared.validatePanelFollowup(raw, selectedInput, { visualInput })
            : shared.validateFigurePanelInterpretation(raw, selectedInput, { visualInput });
          const requestPanelJson = async requestPrompt => {
            await pdfValidated?.validateDispatchPlan(plan);
            await assertRequestCurrent();
            providerRequestCount += 1;
            const providerRequest = {
              ...requestPrompt,
              images: plan.images,
              outputUnits: 1,
              maxOutputTokens: currentOutputTokens,
              timeoutMs: TASK_TIMEOUTS_MS.figure,
              signal: operation?.controller?.signal
            };
            providerRequest[FIGURE_PROVIDER_DISPATCH_COLLECTOR] = panelDispatches;
            const raw = await adapter.generateJsonAtLimit(providerRequest);
            await assertRequestCurrent();
            return raw;
          };
          let validated;
          try {
            validated = validate(await requestPanelJson(prompt));
          } catch (error) {
            if (error?.code !== 'INVALID_RESPONSE') throw error;
            context.onProgress?.({
              phase: 'figure_panel_schema_retry', ...progressBase,
              attempt: providerRequestCount + 1,
              inputMode: plan.inputMode,
              maxOutputTokens: currentOutputTokens,
              errorCode: error.code
            });
            const repairedRaw = await requestPanelJson({
              ...prompt,
              systemPrompt: `${prompt.systemPrompt}\nSCHEMA_REPAIR_PASS: Return only one JSON object that exactly matches the supplied schema. Include every required key, preserve the requested Figure and Panel ids, use empty strings or arrays for unsupported details, and do not add keys.`
            });
            validated = validate(repairedRaw);
          }
          const cacheablePanelResult = {
            ...validated,
            inputBasis: {
              ...publicFigurePanelPlan(plan, providerRequestCount),
              ...(degradationOverride ? { degradationReason: degradationOverride } : {}),
              outputBudgetTokens: currentOutputTokens
            },
            cacheHit: false
          };
          const panelResult = pdfValidated ? {
            ...cacheablePanelResult,
            pdfEvidenceBinding: plan.pdfEvidenceBinding || null,
            sourceRefs: buildVerifiedPdfPanelSourceRefs(
              input, plan, validated.sourceRefs
            )
          } : cacheablePanelResult;
          const cacheRecord = {
            key,
            createdAt: Date.now(),
            cacheBindingDigest,
            routeDigest: boundFigureProviderAttemptBudget.routeDigest,
            taskPolicyDigest: boundFigureProviderAttemptBudget.taskPolicyDigest,
            panelResult: {
              ...cacheablePanelResult,
              promptVersion: shared.FIGURE_PANEL_PROMPT_VERSION
            }
          };
          const cacheProof = {
            kind: 'cache',
            digest: await strongSha256({
              domain: 'figure-panel-provider-cache-proof-v2',
              key,
              cacheBindingDigest,
              panelResult: cacheRecord.panelResult
            }, cryptoImpl)
          };
          const consumedAttempts = await prepareDurableFigureDispatchProof(
            adapter, panelDispatches, cacheProof
          );
          cacheRecord.providerProofDigest = cacheProof.digest;
          await assertRequestCurrent();
          await persistFigureCacheRecords([cacheRecord]);
          if (pdfValidated) {
            try {
              await assertRequestCurrent();
            } catch (error) {
              try { await cacheStore.deleteMany?.([key]); } catch (_) {}
              throw error;
            }
          }
          await sealDurablyConsumedFigureDispatches(
            adapter, panelDispatches, consumedAttempts, cacheProof
          );
          context.onProgress?.({
            phase: 'figure_panel_complete', ...progressBase,
            inputMode: plan.inputMode, attempts: providerRequestCount
          });
          const resultKey = requestMode === 'followup' ? 'panelFollowup' : 'panelAnalysis';
          if (pdfValidated) await assertRequestCurrent();
          return {
            [resultKey]: panelResult,
            cacheHit: false,
            documentHash: input.documentHash,
            route: routePublic
          };
        } catch (error) {
          lastError = error;
          const transientKey = `${recordIndex}:${error?.code || 'NETWORK_ERROR'}`;
          if (error?.retryable && error?.code !== 'INVALID_RESPONSE' &&
              !transientRetries.has(transientKey)) {
            transientRetries.add(transientKey);
            const waitMs = Math.max(Number(error?.retryAfterMs) || 0, 1500);
            context.onProgress?.({
              phase: 'figure_panel_transient_retry', ...progressBase,
              attempt: providerRequestCount + 1,
              waitMs,
              inputMode: plan.inputMode,
              errorCode: error.code || 'NETWORK_ERROR'
            });
            await sleepForOperation(waitMs, operation);
            continue;
          }
          const rejectedVisualInput = plan.pixelsSupplied === true &&
            error?.code === 'PROVIDER_REJECTED';
          const invalidVisualOutput = plan.pixelsSupplied === true &&
            error?.code === 'INVALID_RESPONSE';
          const safeFallbackReason = plan.pixelsSupplied === true
            ? visualTextFallbackReason(error) : '';
          if (error?.code === 'TOKEN_LIMIT_REJECTED') {
            const suggested = Number(error?.suggestedMaxOutputTokens);
            const reduced = Number.isFinite(suggested) && suggested >= 512
              ? suggested : currentOutputTokens * 0.75;
            const nextOutputTokens = Math.max(
              512,
              Math.min(currentOutputTokens - 256, Math.floor(reduced / 256) * 256)
            );
            if (nextOutputTokens < currentOutputTokens) {
              currentOutputTokens = nextOutputTokens;
              context.onProgress?.({
                phase: 'figure_panel_token_retry', ...progressBase,
                attempt: providerAttempt + 2,
                inputMode: plan.inputMode,
                maxOutputTokens: currentOutputTokens,
                errorCode: error.code
              });
              continue;
            }
          }
          if (error?.code === 'OUTPUT_TRUNCATED' &&
              outputBudget.mode === 'auto' && currentOutputTokens < outputBudget.ceiling) {
            const expandedOutputTokens = Math.min(
              outputBudget.ceiling,
              Math.ceil((currentOutputTokens * 1.75) / 256) * 256
            );
            const fittingRecordIndex = records.findIndex((record, index) =>
              index >= recordIndex &&
              record.plan.estimatedInputTokens <= availableInputTokens(expandedOutputTokens)
            );
            if (fittingRecordIndex >= 0 && expandedOutputTokens > currentOutputTokens) {
              const next = records[fittingRecordIndex].plan;
              if (plan.pixelsSupplied === true && next.pixelsSupplied === false) {
                if (!safeFallbackReason || !allowTextFallback) throw error;
                degradationOverride = safeFallbackReason;
              }
              currentOutputTokens = expandedOutputTokens;
              recordIndex = fittingRecordIndex;
              context.onProgress?.({
                phase: 'figure_panel_output_retry', ...progressBase,
                attempt: providerAttempt + 2,
                previousEstimatedInputTokens: plan.estimatedInputTokens,
                estimatedInputTokens: next.estimatedInputTokens,
                inputMode: next.inputMode,
                maxOutputTokens: currentOutputTokens,
                errorCode: error.code
              });
              continue;
            }
          }
          const nextIndex = rejectedVisualInput || invalidVisualOutput
            ? records.findIndex((record, index) =>
              index > recordIndex && record.plan.pixelsSupplied === false)
            : recordIndex + 1;
          const next = nextIndex >= 0 ? records[nextIndex]?.plan : null;
          if ((!shared.isFigurePanelCapacityError(error) && !rejectedVisualInput &&
              !invalidVisualOutput) || !next ||
              next.estimatedInputTokens >= plan.estimatedInputTokens) throw error;
          if (plan.pixelsSupplied === true && next.pixelsSupplied === false) {
            if (!safeFallbackReason || !allowTextFallback) throw error;
            degradationOverride = safeFallbackReason;
          }
          context.onProgress?.({
            phase: 'figure_panel_retry', ...progressBase,
            attempt: providerAttempt + 2,
            previousEstimatedInputTokens: plan.estimatedInputTokens,
            estimatedInputTokens: next.estimatedInputTokens,
            inputMode: next.inputMode,
            errorCode: error.code || 'CONTEXT_BUDGET_EXCEEDED'
          });
          recordIndex = nextIndex;
        }
      }
      throw lastError || new Error('Panel request did not complete');
    }

    function analyzeFigurePanel(
      settings, message, context, requestSignature = '', pdfValidated = null
    ) {
      return runSinglePanelRequest(
        settings, message, context, 'interpretation', requestSignature, pdfValidated
      );
    }

    function strongDigestMatches(value, expected) {
      if (typeof value !== 'string' || typeof expected !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(value) || !/^[a-f0-9]{64}$/u.test(expected) ||
          value.length !== expected.length) return false;
      let difference = 0;
      for (let index = 0; index < expected.length; index += 1) {
        difference |= value.charCodeAt(index) ^ expected.charCodeAt(index);
      }
      return difference === 0;
    }

    function cacheEntryStrongDigest(entry, field) {
      const descriptor = panelCacheOwnField(entry, field);
      return descriptor.valid && descriptor.present &&
        typeof descriptor.value === 'string' ? descriptor.value : '';
    }

    async function persistFigureCacheRecords(records) {
      try {
        await cacheStore.setMany(records);
      } catch (_) {
        const error = new Error('Validated Figure cache data could not be saved');
        error.code = 'FIGURE_CACHE_PERSIST_FAILED';
        throw error;
      }
    }

    async function readFigureCacheRecords(keys) {
      try {
        const records = await cacheStore.getMany(keys);
        if (!(records instanceof Map)) throw new TypeError('invalid cache result');
        const expectedKeys = new Set(keys);
        for (const [key, record] of records) {
          if (typeof key !== 'string' || !expectedKeys.has(key) ||
              !record || typeof record !== 'object' || Array.isArray(record) ||
              ![Object.prototype, null].includes(Object.getPrototypeOf(record))) {
            throw new TypeError('invalid cache record');
          }
          // Cached provider results are still untrusted durable input. Reuse
          // the bounded descriptor-only canonical walker so accessors, cycles,
          // exotic prototypes and oversized records fail closed without ever
          // evaluating user-controlled properties.
          canonicalStrongJson(record);
        }
        return records;
      } catch (_) {
        const error = new Error('Validated Figure cache data could not be read');
        error.code = 'FIGURE_CACHE_READ_FAILED';
        throw error;
      }
    }

    function askFigurePanel(
      settings, message, context, requestSignature = '', pdfValidated = null
    ) {
      return runSinglePanelRequest(
        settings, message, context, 'followup', requestSignature, pdfValidated
      );
    }

    function settingsForExplicitProfile(settings, profileId, taskId) {
      const requestedProfileId = String(profileId || '').trim();
      if (!requestedProfileId) return settings;
      const profile = settings?.profiles?.[requestedProfileId];
      if (!profile || !shared.profileUsable({ ...profile, id: requestedProfileId })) {
        throw invalidSettings(['profileId']);
      }
      return {
        ...settings,
        taskPolicies: {
          ...(settings.taskPolicies || {}),
          [taskId]: {
            ...(settings.taskPolicies?.[taskId] || {}),
            mode: 'profile',
            profileId: requestedProfileId
          }
        }
      };
    }

    async function askArticle(settings, message, context) {
      const input = shared.normalizeArticleChatInput(message);
      if (settings?.consentGranted !== true) {
        const error = new Error('Article content sharing consent is required');
        error.code = 'LLM_NOT_READY';
        throw error;
      }
      const operation = operationFor(message);
      await waitForOperation(operation);
      const taskId = input.selectionEvidence
        ? resolveLlmTaskId('LLM_ASK_ARTICLE', 'selection')
        : resolveLlmTaskId('LLM_ASK_ARTICLE', 'article');
      const routedSettings = settingsForExplicitProfile(
        settings, input.profileId, taskId
      );
      const task = createTaskAdapter(
        routedSettings,
        taskId,
        context
      );
      const route = { ...task.routePublic };
      if (input.webSearch?.enabled === true &&
          typeof task.adapter.generateWebSearchTextStream !== 'function') {
        const error = new Error('Grounded web search is unavailable for this route');
        error.code = 'WEB_SEARCH_UNSUPPORTED';
        error.retryable = false;
        throw error;
      }
      const effectiveProfile = routedSettings?.profiles?.[task.route.effectiveProfileId] || {};
      const result = await shared.runArticleChat({
        input,
        adapter: task.adapter,
        selectedProfileId: task.route.effectiveProfileId,
        profile: {
          providerId: task.route.providerId,
          config: task.route.config,
          tokenPolicy: task.route.tokenPolicy,
          contextWindowTokens: effectiveProfile.contextWindowTokens
        },
        signal: operation?.controller?.signal,
        timeoutMs: TASK_TIMEOUTS_MS.chat,
        waitIfPaused: () => waitForOperation(operation),
        onProgress: routeProgress(context, route),
        routeIdentity: {
          providerId: task.route.providerId,
          model: task.route.model,
          turnId: input.turnId,
          operationId: operation?.operationId || input.operationId
        }
      });
      await waitForOperation(operation);
      return {
        ...result,
        operationId: operation?.operationId || '',
        route
      };
    }

    function evidenceFirstRequestIdentity(message) {
      const candidate = message || {};
      const value = key => panelCacheOwnData(candidate, key);
      const operationIdText = String(value('operationId') || '').trim();
      const explicitKeys = [
        EVIDENCE_FIRST_REQUEST_CONTRACT.markerField,
        'documentId', 'workspaceId', 'workspaceGeneration', 'workspaceLifecycle',
        'baseWorkspaceRevision', 'mechanismChainFingerprint', 'profileSignature',
        'evidenceFirstRouterVersion', 'evidenceFirstVersions'
      ];
      const hasV2Intent = operationIdText.startsWith('mechanism:') || explicitKeys.some(key =>
        Object.prototype.hasOwnProperty.call(candidate, key));
      if (!hasV2Intent) {
        return null;
      }
      const operationId = shared.normalizeOperationId?.(value('operationId')) || '';
      const documentId = String(value('documentId') || '').trim();
      const workspaceId = String(value('workspaceId') || '').trim();
      const workspaceGeneration = value('workspaceGeneration');
      const workspaceLifecycle = value('workspaceLifecycle');
      const baseWorkspaceRevision = value('baseWorkspaceRevision');
      const mechanismChainFingerprint = String(
        value('mechanismChainFingerprint') || ''
      ).trim();
      const invalid = [];
      if (value(EVIDENCE_FIRST_REQUEST_CONTRACT.markerField) !==
          EVIDENCE_FIRST_REQUEST_CONTRACT.version) {
        invalid.push(EVIDENCE_FIRST_REQUEST_CONTRACT.markerField);
      }
      if (!operationId) invalid.push('operationId');
      if (!documentId || documentId.length > 1000) invalid.push('documentId');
      if (!workspaceId || workspaceId.length > 1000) invalid.push('workspaceId');
      if (!Number.isSafeInteger(workspaceGeneration) || workspaceGeneration < 1) {
        invalid.push('workspaceGeneration');
      }
      if (!Number.isSafeInteger(workspaceLifecycle) || workspaceLifecycle < 0) {
        invalid.push('workspaceLifecycle');
      }
      if (!Number.isSafeInteger(baseWorkspaceRevision) || baseWorkspaceRevision < 0) {
        invalid.push('baseWorkspaceRevision');
      }
      if (!/^mechanism-chain-v1-[a-f0-9]{8,64}$/u.test(mechanismChainFingerprint)) {
        invalid.push('mechanismChainFingerprint');
      }
      if (value('evidenceFirstRouterVersion') !== EVIDENCE_FIRST_ROUTER_VERSION) {
        invalid.push('evidenceFirstRouterVersion');
      }
      const evidenceFirstVersions = normalizeEvidenceFirstVersions(
        value('evidenceFirstVersions')
      );
      if (!evidenceFirstVersions) invalid.push('evidenceFirstVersions');
      const hasProfileSignature = Object.prototype.hasOwnProperty.call(
        candidate, 'profileSignature'
      );
      const profileSignature = value('profileSignature');
      if (hasProfileSignature &&
          (typeof profileSignature !== 'string' || profileSignature.length > 512)) {
        invalid.push('profileSignature');
      }
      if (invalid.length) throw invalidSettings(invalid);
      return Object.freeze({
        evidenceFirstVersion: EVIDENCE_FIRST_REQUEST_CONTRACT.version,
        operationId, documentId, workspaceId, workspaceGeneration,
        workspaceLifecycle, baseWorkspaceRevision, mechanismChainFingerprint,
        profileSignature: hasProfileSignature ? profileSignature : null,
        evidenceFirstVersions
      });
    }

    function trustedEvidenceSenderScope(identity, context) {
      const expectedExtensionId = String(runtimeExtensionId || '');
      if (!expectedExtensionId) {
        return Object.freeze({
          senderExtensionId: 'legacy-extension', senderTabId: -1,
          senderFrameId: -1, senderDocumentId: 'legacy-document',
          workspaceLifecycle: identity.workspaceLifecycle
        });
      }
      const senderExtensionId = String(context?.senderExtensionId || '');
      const senderTabId = Number(context?.senderTabId);
      const senderFrameId = Number(context?.senderFrameId);
      const senderDocumentId = String(context?.senderDocumentId || '').trim();
      if (context?.trustedExtensionSender !== true ||
          senderExtensionId !== expectedExtensionId ||
          !Number.isSafeInteger(senderTabId) || senderTabId < 0 ||
          !Number.isSafeInteger(senderFrameId) || senderFrameId < 0 ||
          !senderDocumentId || senderDocumentId.length > 160) {
        throw invalidSettings(['sender']);
      }
      return Object.freeze({
        senderExtensionId, senderTabId, senderFrameId, senderDocumentId,
        workspaceLifecycle: identity.workspaceLifecycle
      });
    }

    function freezeJsonLike(value, seen = new Set()) {
      if (!value || typeof value !== 'object' || seen.has(value)) return value;
      seen.add(value);
      Object.values(value).forEach(item => freezeJsonLike(item, seen));
      return Object.freeze(value);
    }

    async function buildEvidenceFirstStage0(
      message, input, route, documentHash, identity, routeDigest, senderScope
    ) {
      const figuresById = new Map((Array.isArray(message?.figures) ? message.figures : [])
        .map(figure => [String(figure?.figureId || '').trim().toLowerCase(), figure]));
      const projections = [];
      const projectionErrors = [];
      input.panelLedger.entries.forEach((entry, panelOrder) => {
        const projected = shared.projectPanelAnalysisEvidence(
          figuresById.get(entry.figureId), { ...entry, panelOrder }
        );
        if (projected?.ok === true) projections.push(projected.projection);
        else projectionErrors.push({
          panelKey: entry.panelKey,
          status: 'unresolved',
          reason: 'missing_source_binding'
        });
      });
      const versions = {
        requestVersion: EVIDENCE_FIRST_REQUEST_CONTRACT.version,
        routerVersion: EVIDENCE_FIRST_ROUTER_VERSION,
        evidenceVersion: shared.EVIDENCE_FIRST_MECHANISM_VERSION,
        ...EVIDENCE_FIRST_VERSIONS,
        crossFigureVersion: `${shared.CROSS_FIGURE_LOGIC_VERSION}-evidence-first-v2`
      };
      const boundDocumentHash = await mechanismDispatchDigest({
        documentHash,
        identity,
        senderScope,
        normalizedInput: input,
        panelLedger: input.panelLedger,
        // The legacy sourceAnalysisDigest/handle fields are useful indexes but
        // are not cryptographic authority. Seal the full normalized projections
        // so a weak-hash collision cannot resume a checkpoint for different
        // caption, Figure/Panel identity, or source analysis evidence.
        projections,
        projectionErrors,
        versions
      });
      return freezeJsonLike({
        identity,
        documentHash: boundDocumentHash,
        panelLedger: input.panelLedger,
        panelLedgerDigest: shared.stableHash(input.panelLedger),
        projections,
        projectionErrors,
        profileSignature: routeDigest,
        evidenceFirstVersions: EVIDENCE_FIRST_VERSIONS,
        versions,
        policy: cloneJsonLike(EVIDENCE_FIRST_POLICY)
      });
    }

    function releaseEvidenceProviderPermit() {
      activeEvidenceProviderRequests = Math.max(0, activeEvidenceProviderRequests - 1);
      while (evidenceProviderQueue.length) {
        const entry = evidenceProviderQueue.shift();
        if (entry.settled) continue;
        entry.settled = true;
        entry.signal.removeEventListener('abort', entry.onAbort);
        activeEvidenceProviderRequests += 1;
        entry.resolve();
        return;
      }
    }

    function releaseEvidenceProviderPermitAfter(providerLease) {
      if (!providerLease || typeof providerLease.isSettled !== 'function' ||
          !providerLease.settlement || typeof providerLease.settlement.then !== 'function' ||
          providerLease.isSettled()) {
        releaseEvidenceProviderPermit();
        return;
      }
      detachedEvidenceProviderRequests += 1;
      const releaseDetached = () => {
        detachedEvidenceProviderRequests = Math.max(
          0, detachedEvidenceProviderRequests - 1
        );
        releaseEvidenceProviderPermit();
      };
      Promise.resolve(providerLease.settlement).then(
        releaseDetached, releaseDetached
      );
    }

    function acquireEvidenceProviderPermit(coordinator, operation, signal = operation.signal) {
      coordinator.assertActive(operation);
      if (signal?.aborted) {
        const error = new Error('MECHANISM_OPERATION_CANCELLED');
        error.code = 'MECHANISM_OPERATION_CANCELLED';
        return Promise.reject(error);
      }
      if (activeEvidenceProviderRequests <
          EVIDENCE_FIRST_POLICY.maxInFlightProviderRequests) {
        activeEvidenceProviderRequests += 1;
        return Promise.resolve();
      }
      if (detachedEvidenceProviderRequests > 0) {
        const error = new Error('PROVIDER_UNAVAILABLE');
        error.code = 'PROVIDER_UNAVAILABLE';
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => {
        const entry = { operation, signal, resolve, reject, settled: false, onAbort: null };
        entry.onAbort = () => {
          if (entry.settled) return;
          entry.settled = true;
          const index = evidenceProviderQueue.indexOf(entry);
          if (index >= 0) evidenceProviderQueue.splice(index, 1);
          const error = new Error('MECHANISM_OPERATION_CANCELLED');
          error.code = 'MECHANISM_OPERATION_CANCELLED';
          reject(error);
        };
        signal.addEventListener('abort', entry.onAbort, { once: true });
        evidenceProviderQueue.push(entry);
      });
    }

    async function withEvidenceProviderPermit(coordinator, operation, invoke) {
      await acquireEvidenceProviderPermit(coordinator, operation);
      let providerLease = null;
      try {
        coordinator.assertActive(operation);
        return await invoke(lease => { providerLease = lease; });
      } finally {
        releaseEvidenceProviderPermitAfter(providerLease);
      }
    }

    function evidenceProviderPermit(coordinator, operation) {
      return Object.freeze({
        acquire(context) {
          return acquireEvidenceProviderPermit(
            coordinator, operation, context?.signal || operation.signal
          );
        },
        release(_token, providerLease) {
          releaseEvidenceProviderPermitAfter(providerLease);
        }
      });
    }

    function checkpointInvalid() {
      const error = new Error('MECHANISM_CHECKPOINT_INVALID');
      error.code = 'MECHANISM_CHECKPOINT_INVALID';
      error.retryable = false;
      return error;
    }

    async function mechanismBindingResult(factory) {
      try {
        return await factory();
      } catch (_) {
        const error = new Error('MECHANISM_DISPATCH_BINDING_UNAVAILABLE');
        error.code = 'MECHANISM_DISPATCH_BINDING_UNAVAILABLE';
        error.retryable = false;
        throw error;
      }
    }

    function mechanismDispatchDigest(value) {
      return mechanismBindingResult(() => strongSha256(value, cryptoImpl));
    }

    function canonicalCheckpointData(value) {
      try {
        // Reuse the guarded serializer's global depth/node/UTF-8 budgets before
        // allocating the immutable snapshot. This also rejects accessors and
        // cycles without invoking user-controlled getters.
        return JSON.parse(canonicalStrongJson(value));
      } catch (_) {
        throw checkpointInvalid();
      }
    }

    async function checkpointPayloadDigest(payload) {
      try {
        return `${EVIDENCE_CHECKPOINT_PAYLOAD_VERSION}-${await strongSha256({
          domain: 'evidence-checkpoint-seal-v2',
          payload
        }, cryptoImpl)}`;
      } catch (_) {
        throw checkpointInvalid();
      }
    }

    async function stage0CheckpointDigest(stage0) {
      return checkpointPayloadDigest({
        documentHash: stage0.documentHash,
        panelLedger: stage0.panelLedger,
        profileSignature: stage0.profileSignature,
        projections: stage0.projections,
        projectionErrors: stage0.projectionErrors,
        evidenceFirstVersions: stage0.evidenceFirstVersions,
        versions: stage0.versions,
        policy: stage0.policy
      });
    }

    function exactSortedPanelKeys(value, allowedPanelKeys) {
      const keys = panelCacheStringArray(value, 10_000, 512);
      if (!keys || new Set(keys).size !== keys.length ||
          keys.some(key => !allowedPanelKeys.has(key)) ||
          keys.some((key, index) => index > 0 && keys[index - 1].localeCompare(key) >= 0)) {
        throw checkpointInvalid();
      }
      return keys;
    }

    function validateCheckpointErrorRecords(value, allowedPanelKeys, kind) {
      const records = panelCacheArray(value, 10_000);
      if (!records) throw checkpointInvalid();
      const keys = kind === 'mapping' ? ['code', 'panelKey'] : [
        'panelKey', 'reason', 'status'
      ];
      const panelKeys = [];
      for (const record of records) {
        if (!panelCacheHasExactKeys(record, keys)) throw checkpointInvalid();
        const panelKey = panelCacheOwnData(record, 'panelKey');
        if (typeof panelKey !== 'string' || !allowedPanelKeys.has(panelKey)) {
          throw checkpointInvalid();
        }
        const fixedValue = panelCacheOwnData(record, kind === 'mapping' ? 'code' : 'reason');
        if (typeof fixedValue !== 'string' || fixedValue.length > 80 ||
            !/^[A-Za-z0-9_]+$/u.test(fixedValue)) throw checkpointInvalid();
        if (kind !== 'mapping') {
          const status = panelCacheOwnData(record, 'status');
          if (!['unresolved', 'output_truncated_at_single_panel'].includes(status)) {
            throw checkpointInvalid();
          }
        } else if (!['INVALID_RESPONSE', 'OUTPUT_TRUNCATED'].includes(fixedValue)) {
          throw checkpointInvalid();
        }
        panelKeys.push(panelKey);
      }
      if (new Set(panelKeys).size !== panelKeys.length) throw checkpointInvalid();
      return { records, panelKeys };
    }

    async function exactEvidenceState(checkpoint, stage0, operation) {
      const empty = {
        extractionRecords: [],
        extractionErrors: [...stage0.projectionErrors],
        extractionFinishedPanelKeys: stage0.projectionErrors.map(item => item.panelKey),
        canonicalNodes: null,
        canonicalError: '',
        mappingRecords: [],
        mappingErrors: [],
        mappingFinishedPanelKeys: [],
        extractionRepairFinishedPanelKeys: [],
        mappingRepairFinishedPanelKeys: [],
        finalStatus: '',
        finalDigest: ''
      };
      if (!checkpoint) return empty;
      const payload = panelCacheOwnData(checkpoint, 'payload');
      const payloadKeys = [
        'bindingDigest', 'canonicalError', 'canonicalNodes', 'extractionErrors',
        'extractionFinishedPanelKeys', 'extractionRecords',
        'extractionRepairFinishedPanelKeys', 'finalDigest', 'finalStatus',
        'ledgerDigest', 'mappingErrors', 'mappingFinishedPanelKeys', 'mappingRecords',
        'mappingRepairFinishedPanelKeys', 'payloadDigest', 'payloadVersion',
        'routerVersion', 'stage', 'stage0Digest'
      ];
      if (!panelCacheHasExactKeys(payload, payloadKeys) ||
          panelCacheOwnData(payload, 'payloadVersion') !==
            EVIDENCE_CHECKPOINT_PAYLOAD_VERSION ||
          panelCacheOwnData(payload, 'routerVersion') !== EVIDENCE_FIRST_ROUTER_VERSION ||
          panelCacheOwnData(payload, 'stage') !== panelCacheOwnData(checkpoint, 'phase') ||
          panelCacheOwnData(payload, 'ledgerDigest') !== stage0.panelLedgerDigest) {
        throw checkpointInvalid();
      }
      const [expectedStage0Digest, expectedBindingDigest] = await Promise.all([
        stage0CheckpointDigest(stage0),
        checkpointPayloadDigest(operation.binding)
      ]);
      if (panelCacheOwnData(payload, 'stage0Digest') !== expectedStage0Digest ||
          panelCacheOwnData(payload, 'bindingDigest') !== expectedBindingDigest) {
        throw checkpointInvalid();
      }
      const unsignedPayload = {};
      for (const key of payloadKeys.filter(key => key !== 'payloadDigest')) {
        unsignedPayload[key] = panelCacheOwnData(payload, key);
      }
      if (panelCacheOwnData(payload, 'payloadDigest') !==
          await checkpointPayloadDigest(unsignedPayload)) throw checkpointInvalid();
      const allowedPanelKeys = new Set(stage0.panelLedger.entries.map(entry => entry.panelKey));
      const extractionRecords = panelCacheArray(
        panelCacheOwnData(payload, 'extractionRecords'), 512
      );
      const mappingRecords = panelCacheArray(panelCacheOwnData(payload, 'mappingRecords'), 512);
      if (!extractionRecords || !mappingRecords) throw checkpointInvalid();
      const extractionErrors = validateCheckpointErrorRecords(
        panelCacheOwnData(payload, 'extractionErrors'), allowedPanelKeys, 'extraction'
      );
      const mappingErrors = validateCheckpointErrorRecords(
        panelCacheOwnData(payload, 'mappingErrors'), allowedPanelKeys, 'mapping'
      );
      const extractionFinishedPanelKeys = exactSortedPanelKeys(
        panelCacheOwnData(payload, 'extractionFinishedPanelKeys'), allowedPanelKeys
      );
      const mappingFinishedPanelKeys = exactSortedPanelKeys(
        panelCacheOwnData(payload, 'mappingFinishedPanelKeys'), allowedPanelKeys
      );
      const extractionRepairFinishedPanelKeys = exactSortedPanelKeys(
        panelCacheOwnData(payload, 'extractionRepairFinishedPanelKeys'), allowedPanelKeys
      );
      const mappingRepairFinishedPanelKeys = exactSortedPanelKeys(
        panelCacheOwnData(payload, 'mappingRepairFinishedPanelKeys'), allowedPanelKeys
      );
      const recordPanelKeys = extractionRecords.map(record => panelCacheOwnData(record, 'panelKey'));
      if (recordPanelKeys.some(key => typeof key !== 'string' ||
          !allowedPanelKeys.has(key)) || new Set(recordPanelKeys).size !== recordPanelKeys.length) {
        throw checkpointInvalid();
      }
      const finishedExtraction = [...new Set([
        ...recordPanelKeys, ...extractionErrors.panelKeys
      ])].sort();
      if (recordPanelKeys.some(key => extractionErrors.panelKeys.includes(key)) ||
          JSON.stringify(finishedExtraction) !== JSON.stringify(extractionFinishedPanelKeys) ||
          JSON.stringify(extractionFinishedPanelKeys) !== JSON.stringify(
            panelCacheOwnData(checkpoint, 'completedPanelKeys')
          ) || extractionRepairFinishedPanelKeys.some(key =>
          !extractionFinishedPanelKeys.includes(key))) throw checkpointInvalid();
      const projectionByPanel = new Map(stage0.projections.map(item => [item.panelKey, item]));
      for (const record of extractionRecords) {
        const projection = projectionByPanel.get(panelCacheOwnData(record, 'panelKey'));
        if (!projection || panelCacheOwnData(record, 'figureId') !== projection.figureId ||
            panelCacheOwnData(record, 'panelOrder') !== projection.panelOrder ||
            panelCacheOwnData(record, 'sourceAnalysisDigest') !==
              projection.sourceAnalysisDigest) throw checkpointInvalid();
        const availableSourceRefs = new Set(Object.entries(projection.sourceAnalysis)
          .filter(([, value]) => Array.isArray(value)
            ? value.some(item => typeof item === 'string' && item.trim())
            : typeof value === 'string' && value.trim())
          .map(([field]) => `${projection.panelKey}:${field}`));
        const recordSourceRefs = panelCacheStringArray(
          panelCacheOwnData(record, 'sourceRefs'), 11, 512
        );
        if (!recordSourceRefs || recordSourceRefs.some(reference =>
          !availableSourceRefs.has(reference))) throw checkpointInvalid();
        const claims = panelCacheArray(panelCacheOwnData(record, 'claims'), 12);
        if (!claims || claims.some(claim => {
          const refs = panelCacheStringArray(panelCacheOwnData(claim, 'sourceRefs'), 11, 512);
          return !refs || !refs.length || refs.some(reference =>
            !availableSourceRefs.has(reference));
        })) throw checkpointInvalid();
      }
      if (extractionRecords.length) {
        const evidenceAudit = shared.assembleEvidenceFirstMechanism(
          extractionRecords, stage0.panelLedger
        );
        if (!evidenceAudit?.ok) throw checkpointInvalid();
      }
      const canonicalNodes = panelCacheOwnData(payload, 'canonicalNodes');
      const canonicalError = panelCacheOwnData(payload, 'canonicalError');
      if (canonicalNodes !== null && !isSafePanelCacheRecord(canonicalNodes)) {
        throw checkpointInvalid();
      }
      if (typeof canonicalError !== 'string' || canonicalError.length > 80 ||
          (canonicalError && !/^[A-Z0-9_]+$/u.test(canonicalError)) ||
          (canonicalNodes && canonicalError)) throw checkpointInvalid();
      const mappingPanelKeys = mappingRecords.map(record => panelCacheOwnData(record, 'panelKey'));
      if (mappingPanelKeys.some(key => typeof key !== 'string' ||
          !recordPanelKeys.includes(key)) || new Set(mappingPanelKeys).size !==
          mappingPanelKeys.length || mappingPanelKeys.some(key =>
          mappingErrors.panelKeys.includes(key))) throw checkpointInvalid();
      const finishedMappings = [...new Set([
        ...mappingPanelKeys, ...mappingErrors.panelKeys
      ])].sort();
      if (JSON.stringify(finishedMappings) !== JSON.stringify(mappingFinishedPanelKeys) ||
          mappingRepairFinishedPanelKeys.some(key => !mappingFinishedPanelKeys.includes(key))) {
        throw checkpointInvalid();
      }
      if (canonicalNodes) {
        const mappedAudit = shared.assembleMappedEvidenceFirstMechanism({
          records: extractionRecords,
          panelLedger: stage0.panelLedger,
          canonicalNodes,
          mappingRecords
        });
        if (!mappedAudit?.ok) throw checkpointInvalid();
      } else if (mappingRecords.length || mappingErrors.records.length ||
          mappingFinishedPanelKeys.length) throw checkpointInvalid();
      const finalStatus = panelCacheOwnData(payload, 'finalStatus');
      const finalDigest = panelCacheOwnData(payload, 'finalDigest');
      if (typeof finalStatus !== 'string' || typeof finalDigest !== 'string') {
        throw checkpointInvalid();
      }
      const phase = panelCacheOwnData(checkpoint, 'phase');
      const ready = phase === 'ready';
      if ((ready && (!['complete', 'needs_review'].includes(finalStatus) || !finalDigest)) ||
          (!ready && (finalStatus || finalDigest))) throw checkpointInvalid();
      if ((phase === 'panel_census' && (canonicalNodes || canonicalError ||
           mappingFinishedPanelKeys.length)) ||
          (['canonicalization', 'edge_batch', 'coverage_repair', 'ready'].includes(phase) &&
           extractionFinishedPanelKeys.length !== allowedPanelKeys.size) ||
          (['edge_batch', 'coverage_repair'].includes(phase) && !canonicalNodes) ||
          (ready && !canonicalNodes && finalStatus !== 'needs_review')) {
        throw checkpointInvalid();
      }
      return {
        extractionRecords: [...extractionRecords],
        extractionErrors: [...extractionErrors.records],
        extractionFinishedPanelKeys,
        canonicalNodes,
        canonicalError,
        mappingRecords: [...mappingRecords],
        mappingErrors: [...mappingErrors.records],
        mappingFinishedPanelKeys,
        extractionRepairFinishedPanelKeys,
        mappingRepairFinishedPanelKeys,
        finalStatus,
        finalDigest
      };
    }

    async function evidenceCheckpointPayload(state, stage0, phase, operation) {
      // Snapshot every state field before the first await so another worker cannot
      // advance mutable state while this checkpoint's digests are being computed.
      const snapshot = canonicalCheckpointData({
        extractionRecords: [...state.extractionRecords],
        extractionErrors: [...state.extractionErrors],
        extractionFinishedPanelKeys: [...state.extractionFinishedPanelKeys],
        canonicalNodes: state.canonicalNodes,
        canonicalError: state.canonicalError,
        mappingRecords: [...state.mappingRecords],
        mappingErrors: [...state.mappingErrors],
        mappingFinishedPanelKeys: [...state.mappingFinishedPanelKeys],
        extractionRepairFinishedPanelKeys: [
          ...state.extractionRepairFinishedPanelKeys
        ],
        mappingRepairFinishedPanelKeys: [...state.mappingRepairFinishedPanelKeys],
        finalStatus: state.finalStatus,
        finalDigest: state.finalDigest
      });
      const [bindingDigest, stage0Digest] = await Promise.all([
        checkpointPayloadDigest(operation.binding),
        stage0CheckpointDigest(stage0)
      ]);
      const payload = {
        payloadVersion: EVIDENCE_CHECKPOINT_PAYLOAD_VERSION,
        routerVersion: EVIDENCE_FIRST_ROUTER_VERSION,
        stage: phase,
        bindingDigest,
        stage0Digest,
        ledgerDigest: stage0.panelLedgerDigest,
        ...snapshot
      };
      return { ...payload, payloadDigest: await checkpointPayloadDigest(payload) };
    }

    function buildPanelFreeMechanismGraph(mechanism, panelLedger) {
      if (!mechanism?.ok || !Array.isArray(mechanism.nodes) ||
          !Array.isArray(mechanism.relations) ||
          !Array.isArray(panelLedger?.entries)) return null;
      const relations = mechanism.relations.filter(relation => relation.renderable === true);
      if (!relations.length ||
          new Set(relations.map(relation => relation.relationId)).size !== relations.length) {
        return null;
      }
      const includedNodeIds = new Set(relations.flatMap(relation => [
        relation.sourceNodeId, relation.targetNodeId
      ]));
      const includedNodes = mechanism.nodes.filter(node => includedNodeIds.has(node.nodeId));
      if (includedNodes.length !== includedNodeIds.size ||
          new Set(includedNodes.map(node => node.nodeId)).size !== includedNodes.length ||
          relations.some(relation => relation.sourceNodeId === relation.targetNodeId ||
            !includedNodeIds.has(relation.sourceNodeId) ||
            !includedNodeIds.has(relation.targetNodeId))) return null;
      const normalizeDisplayToken = value => typeof value === 'string'
        ? value.normalize('NFKC').toLocaleLowerCase('en-US')
          .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ')
        : '';
      const panelIdentityTokens = new Set();
      const exactPanelIdentityTokens = new Set();
      const addIdentityToken = value => {
        const normalized = normalizeDisplayToken(value);
        if (normalized && (normalized.length > 1 || normalized.includes(' '))) {
          if (normalized.includes(' ')) panelIdentityTokens.add(normalized);
          else exactPanelIdentityTokens.add(normalized);
        }
      };
      for (const entry of panelLedger.entries) {
        const panelKey = panelCacheOwnData(entry, 'panelKey');
        const figureId = panelCacheOwnData(entry, 'figureId');
        const panelId = panelCacheOwnData(entry, 'panelId');
        const originalDisplayId = panelCacheOwnData(entry, 'originalDisplayId');
        const displayAlias = panelCacheOwnData(entry, 'displayAlias');
        const figureDisplayId = panelCacheOwnData(entry, 'figureDisplayId');
        [panelKey, figureId, panelId, originalDisplayId, displayAlias, figureDisplayId]
          .forEach(addIdentityToken);
        [panelId, originalDisplayId, displayAlias].forEach(value => {
          const normalized = normalizeDisplayToken(value);
          if (normalized) addIdentityToken(`Panel ${normalized}`);
        });
        [figureId, figureDisplayId].forEach(value => {
          const normalized = normalizeDisplayToken(value)
            .replace(/^figure\s+/u, '').trim();
          if (normalized) addIdentityToken(`Figure ${normalized}`);
        });
      }
      const publicNodeText = includedNodes.flatMap(node => [
        node.label, ...node.states,
        ...node.contexts.flatMap(context => Object.values(context))
      ]).filter(value => typeof value === 'string').map(normalizeDisplayToken);
      if (publicNodeText.some(value => exactPanelIdentityTokens.has(value) ||
        [...panelIdentityTokens].some(token =>
          ` ${value} `.includes(` ${token} `)))) return null;
      const graph = {
        schemaVersion: 2,
        canonicalDigest: mechanism.canonicalDigest,
        nodes: includedNodes.map(node => ({
          id: node.nodeId,
          label: node.label,
          nodeType: node.nodeType,
          states: [...node.states],
          contexts: node.contexts.map(context => ({ ...context }))
        })),
        edges: relations.map(relation => ({
          id: relation.relationId,
          source: relation.sourceNodeId,
          target: relation.targetNodeId,
          polarity: relation.polarity,
          relationKind: relation.relationKind,
          lineStyle: relation.lineStyle,
          color: relation.color
        }))
      };
      return freezeJsonLike(graph);
    }

    function publicEvidenceStage0(stage0, operation) {
      return freezeJsonLike({
        operationId: operation.operationId,
        operationEpoch: operation.epoch,
        evidenceFirstVersion: stage0.identity.evidenceFirstVersion,
        documentId: stage0.identity.documentId,
        documentHash: stage0.documentHash,
        workspaceId: stage0.identity.workspaceId,
        baseWorkspaceRevision: stage0.identity.baseWorkspaceRevision,
        panelLedgerDigest: stage0.panelLedgerDigest,
        profileSignature: stage0.profileSignature,
        evidenceFirstVersions: { ...stage0.evidenceFirstVersions },
        versions: { ...stage0.versions },
        policy: { ...stage0.policy },
        deadlineAt: operation.deadlineAt
      });
    }

    const MECHANISM_TERMINAL_CODES = new Set([
      'MECHANISM_OPERATION_CANCELLED', 'MECHANISM_OPERATION_STALE',
      'MECHANISM_OPERATION_FINALIZED', 'MECHANISM_OPERATION_CAPACITY_EXCEEDED',
      'MECHANISM_OPERATION_DEADLINE_EXCEEDED',
      'MECHANISM_PROVIDER_REQUEST_BUDGET_EXCEEDED',
      'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS',
      'MECHANISM_PROVIDER_RECEIPT_MISMATCH',
      'MECHANISM_DISPATCH_BINDING_UNAVAILABLE'
    ]);

    function fixedMechanismCode(error) {
      const code = String(error?.code || '').toUpperCase();
      const allowed = new Set([
        ...MECHANISM_TERMINAL_CODES,
        'MECHANISM_CHECKPOINT_INVALID', 'MECHANISM_CHECKPOINT_READ_FAILED',
        'MECHANISM_CHECKPOINT_WRITE_FAILED', 'MECHANISM_RUN_STATE_READ_FAILED',
        'MECHANISM_RUN_STATE_WRITE_FAILED', 'INVALID_RESPONSE', 'OUTPUT_TRUNCATED',
        'NETWORK_ERROR', 'RATE_LIMITED', 'REQUEST_TIMEOUT', 'PROVIDER_UNAVAILABLE',
        'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS',
        'MECHANISM_PROVIDER_RECEIPT_MISMATCH'
      ]);
      return allowed.has(code) ? code : 'PROVIDER_UNAVAILABLE';
    }

    function terminalMechanismStatus(error) {
      const code = fixedMechanismCode(error);
      if (code === 'MECHANISM_OPERATION_CANCELLED' ||
          code === 'MECHANISM_OPERATION_STALE') return 'cancelled';
      if (code === 'MECHANISM_OPERATION_DEADLINE_EXCEEDED' ||
          code === 'MECHANISM_OPERATION_FINALIZED' ||
          code === 'MECHANISM_OPERATION_CAPACITY_EXCEEDED' ||
          code === 'MECHANISM_PROVIDER_REQUEST_BUDGET_EXCEEDED' ||
          code === 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS' ||
          code === 'MECHANISM_PROVIDER_RECEIPT_MISMATCH' ||
          code === 'MECHANISM_DISPATCH_BINDING_UNAVAILABLE') return 'failed';
      return '';
    }

    function mechanismCleanupPendingError(primaryError, cleanupError) {
      const primaryCode = fixedMechanismCode(primaryError);
      const error = new Error(primaryCode);
      error.code = primaryCode;
      error.retryable = false;
      error.cleanupPending = true;
      error.cleanupCode = fixedMechanismCode(cleanupError);
      return error;
    }

    function conclusiveMechanismRateLimit(error, code = fixedMechanismCode(error)) {
      return code === 'RATE_LIMITED' && Number(error?.status) === 429 &&
        error?.diagnosticStage === 'response-body';
    }

    function conclusiveMechanismResponseFailure(
      error, code = fixedMechanismCode(error)
    ) {
      if (error?.diagnosticStage === 'provider-completion' &&
          ['INVALID_RESPONSE', 'PROVIDER_UNAVAILABLE'].includes(code)) return true;
      // Provider adapters emit OUTPUT_TRUNCATED only after decoding an actual
      // response; older adapters do not attach transport diagnostics to that
      // fixed error. Numeric non-408 4xx response-body failures are also
      // conclusive rejections. They may be checkpointed locally, while an
      // unknown network/timeout/5xx outcome remains quarantined.
      if (code === 'OUTPUT_TRUNCATED') return true;
      const status = Number(error?.status);
      return Number.isSafeInteger(status) && status >= 400 && status < 500 &&
        status !== 408 && error?.diagnosticStage === 'response-body';
    }

    function ambiguousMechanismTransportFailure(error, code = fixedMechanismCode(error)) {
      if (conclusiveMechanismRateLimit(error, code)) return false;
      return [
        'NETWORK_ERROR', 'REQUEST_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED'
      ].includes(code);
    }

    function ambiguousMechanismReceiptError() {
      const error = new Error('MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS');
      error.code = 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS';
      error.retryable = false;
      return error;
    }

    async function runEvidenceWorkers(batches, mapper) {
      let cursor = 0;
      let fatal = null;
      const workers = Array.from({ length: Math.min(
        EVIDENCE_FIRST_POLICY.maxInFlightProviderRequests, batches.length
      ) }, async () => {
        while (!fatal) {
          const index = cursor;
          cursor += 1;
          if (index >= batches.length) return;
          try {
            await mapper(batches[index], index, () => fatal);
          } catch (error) {
            if (!fatal) fatal = error;
          }
        }
      });
      await Promise.allSettled(workers);
      if (fatal) throw fatal;
    }

    async function runEvidenceProviderAttempt({
      adapter, coordinator, operation, prompt, validate, repair = false,
      providerReceiptContract, providerReceiptSettled, assertTrustedOwnerCurrent
    }) {
      coordinator.assertActive(operation);
      let claimedReceiptContract = null;
      let providerClaimed = false;
      let settleClaimedReceipt = false;
      const request = repair ? {
        ...prompt,
        systemPrompt: `${prompt.systemPrompt}\n` +
          'SCHEMA_REPAIR_PASS: error_category=invalid_schema; return exactly the required keys and handles without commentary.'
      } : prompt;
      try {
        const raw = await withEvidenceProviderPermit(
          coordinator, operation, async registerProviderLease => {
        coordinator.assertActive(operation);
        const receiptContract = providerReceiptContract
          ? await providerReceiptContract({
            batch: [], prompt: request, repair,
            splitPath: 'root',
            schemaRepairAttempt: repair ? 1 : 0,
            networkAttempt: 0
          })
          : null;
        if (typeof assertTrustedOwnerCurrent === 'function') {
          await assertTrustedOwnerCurrent();
        }
        await coordinator.claimProviderRequest(operation, receiptContract);
        claimedReceiptContract = receiptContract;
        providerClaimed = true;
        coordinator.assertActive(operation);
        if (typeof assertTrustedOwnerCurrent === 'function') {
          await assertTrustedOwnerCurrent();
        }
        const boundedRequest = shared.invokeBoundedEvidenceProviderRequest(
          callSignal => adapter.generateJson({
          ...request,
          outputUnits: Math.max(1, Number(prompt?.outputUnits) || 1),
          signal: callSignal
        }), {
          signal: operation.signal,
          timeoutMs: boundedEvidenceProviderRequestTimeoutMs,
          deadlineAt: operation.deadlineAt,
          now: nowImpl
        });
        registerProviderLease(boundedRequest.providerLease);
        return boundedRequest;
          });
        settleClaimedReceipt = true;
        if (typeof assertTrustedOwnerCurrent === 'function') {
          await assertTrustedOwnerCurrent();
        }
        coordinator.assertActive(operation);
        return validate(raw);
      } catch (error) {
        const code = fixedMechanismCode(error);
        if (providerClaimed && conclusiveMechanismResponseFailure(error, code)) {
          settleClaimedReceipt = true;
        } else if (providerClaimed && ambiguousMechanismTransportFailure(error, code)) {
          settleClaimedReceipt = false;
          throw ambiguousMechanismReceiptError();
        }
        throw error;
      } finally {
        if (providerClaimed && settleClaimedReceipt && claimedReceiptContract &&
            providerReceiptSettled) {
          await providerReceiptSettled(claimedReceiptContract);
        }
      }
    }

    async function runEvidenceProviderWithPolicy({
      adapter, coordinator, operation, prompt, validate, providerReceiptContract
      , providerReceiptSettled, assertTrustedOwnerCurrent
    }) {
      let schemaRepairAttempts = 0;
      let transientRetryAttempts = 0;
      for (;;) {
        try {
          return await runEvidenceProviderAttempt({
            adapter, coordinator, operation, prompt, validate,
            repair: schemaRepairAttempts > 0,
            providerReceiptContract: providerReceiptContract
              ? descriptor => providerReceiptContract({
                ...descriptor,
                schemaRepairAttempt: schemaRepairAttempts,
                networkAttempt: transientRetryAttempts
              }) : null,
            providerReceiptSettled,
            assertTrustedOwnerCurrent
          });
        } catch (error) {
          coordinator.assertActive(operation);
          const code = fixedMechanismCode(error);
          if (MECHANISM_TERMINAL_CODES.has(code)) throw error;
          if (code === 'INVALID_RESPONSE' &&
              schemaRepairAttempts < EVIDENCE_FIRST_POLICY.maxSchemaRepairsPerBatch) {
            schemaRepairAttempts += 1;
            continue;
          }
          const transient = conclusiveMechanismRateLimit(error, code) ||
            (!conclusiveMechanismResponseFailure(error, code) &&
              (error?.retryable === true || [
                'NETWORK_ERROR', 'RATE_LIMITED', 'REQUEST_TIMEOUT',
                'PROVIDER_UNAVAILABLE'
              ].includes(code)));
          if (transient &&
              transientRetryAttempts < EVIDENCE_FIRST_POLICY.maxNetworkRetriesPerBatch) {
            transientRetryAttempts += 1;
            const waitMs = Math.min(EVIDENCE_FIRST_POLICY.providerRequestTimeoutMs, Math.max(0,
              Number(error?.retryAfterMs) || 100));
            if (nowImpl() + waitMs >= operation.deadlineAt) {
              const deadline = new Error('MECHANISM_OPERATION_DEADLINE_EXCEEDED');
              deadline.code = 'MECHANISM_OPERATION_DEADLINE_EXCEEDED';
              throw deadline;
            }
            if (waitMs) {
              let onAbort;
              const cancelled = new Promise((_, reject) => {
                onAbort = () => {
                  const abortError = new Error('MECHANISM_OPERATION_CANCELLED');
                  abortError.code = 'MECHANISM_OPERATION_CANCELLED';
                  reject(abortError);
                };
                operation.signal.addEventListener('abort', onAbort, { once: true });
              });
              try {
                await Promise.race([sleepImpl(waitMs), cancelled]);
              } finally {
                operation.signal.removeEventListener('abort', onAbort);
              }
            }
            coordinator.assertActive(operation);
            continue;
          }
          throw error;
        }
      }
    }

    function evidenceMechanismCompatibility(mechanism) {
      if (!mechanism?.ok) return null;
      const labels = new Map(mechanism.nodes.map(node => [node.nodeId, node.label]));
      const mechanismEdges = mechanism.relations.filter(relation =>
        relation.renderable === true).map(relation => ({
        edgeId: relation.relationId,
        from: labels.get(relation.sourceNodeId) || relation.sourceNodeId,
        to: labels.get(relation.targetNodeId) || relation.targetNodeId,
        polarity: relation.polarity,
        supportPanels: [...relation.panelKeys],
        panelAssignments: relation.assignments.map(assignment => ({
          panelKey: assignment.panelKey,
          evidenceClass: assignment.evidenceClass,
          color: assignment.color,
          role: assignment.role
        }))
      }));
      return {
        mechanismVocabulary: mechanism.nodes.map(node => ({
          nodeId: node.nodeId, label: node.label, nodeType: node.nodeType
        })),
        mechanismEdges,
        mechanismChain: mechanismEdges.length === 1
          ? `${mechanismEdges[0].from} → ${mechanismEdges[0].to}`
          : `${mechanism.nodes.length} nodes · ${mechanismEdges.length} directed relationships`,
        panelDispositions: mechanism.panelDispositions,
        panelCoverageAudit: {
          ok: mechanism.audit.complete,
          total: mechanism.audit.ledgerPanelCount,
          covered: mechanism.audit.resolvedPanelCount + mechanism.audit.excludedPanelCount,
          missingPanelKeys: [...mechanism.audit.unresolvedPanelKeys],
          invalidPanelKeys: [], duplicatePanelKeys: []
        }
      };
    }

    async function runEvidenceFirstMechanismStages({
      adapter, coordinator, operation, stage0, resumedCheckpoint, progress,
      providerDispatchBaseDigest, receiptPreflightError = null,
      assertTrustedOwnerCurrent = null
    }) {
      const state = await exactEvidenceState(resumedCheckpoint, stage0, operation);
      const totalPanels = stage0.panelLedger.entries.length;
      const settledProviderReceipts = new Set(
        Array.isArray(resumedCheckpoint?.providerReceiptIds)
          ? resumedCheckpoint.providerReceiptIds : []
      );
      const absorbProviderReceiptIds = receiptIds => {
        for (const receipt of Array.isArray(receiptIds) ? receiptIds : []) {
          if (typeof receipt !== 'string' || !/^[a-f0-9]{64}$/u.test(receipt)) {
            const error = new Error('MECHANISM_RUN_STATE_WRITE_FAILED');
            error.code = 'MECHANISM_RUN_STATE_WRITE_FAILED';
            throw error;
          }
          settledProviderReceipts.add(receipt);
        }
      };
      const receiptContractFor = stage =>
        async ({
          batch, prompt, repair, splitPath = 'root',
          schemaRepairAttempt = 0, networkAttempt = 0
        }) => {
          if (typeof assertTrustedOwnerCurrent === 'function') {
            await assertTrustedOwnerCurrent();
          }
          const panelKeys = (Array.isArray(batch) ? batch : []).map(item =>
            String(item?.panelKey || '')).sort();
          const requestDigest = await mechanismDispatchDigest({
            prompt,
            panelKeys,
            repair: repair === true
          }, cryptoImpl);
          const bindingDigest = await mechanismDispatchDigest({
            providerDispatchBaseDigest,
            stage,
            panelKeys,
            repair: repair === true,
            splitPath,
            schemaRepairAttempt,
            networkAttempt,
            requestDigest
          }, cryptoImpl);
          const receipt = await mechanismDispatchDigest({
            domain: 'evidence-provider-dispatch-receipt-v1',
            bindingDigest
          }, cryptoImpl);
          return { receipt, bindingDigest };
        };
      let checkpointTail = Promise.resolve();
      const commit = (phase, nextBatchIndex, progressPhase, completedPanels) => {
        const payloadPromise = evidenceCheckpointPayload(state, stage0, phase, operation);
        const completedPanelKeys = [...new Set(
          state.extractionFinishedPanelKeys
        )].sort();
        // Freeze the receipt frontier together with the payload snapshot. Reading the
        // live Set inside the queued job can otherwise attach a later worker's receipt
        // to an earlier payload that does not contain that worker's state.
        const providerReceiptIds = [...settledProviderReceipts].sort();
        const job = checkpointTail.then(async () => {
          const payload = await payloadPromise;
          if (typeof assertTrustedOwnerCurrent === 'function') {
            await assertTrustedOwnerCurrent();
          }
          coordinator.assertActive(operation);
          const receipt = await coordinator.commitCheckpoint(operation, {
            schemaVersion: shared.MECHANISM_CHECKPOINT_SCHEMA_VERSION,
            binding: operation.binding,
            phase,
            nextBatchIndex,
            completedPanelKeys,
            providerReceiptIds,
            payload
          });
          coordinator.assertActive(operation);
          progress({
            phase: progressPhase,
            completedPanels,
            totalPanels,
            checkpointCommitted: true,
            checkpointCommits: receipt.checkpointCommits,
            operationId: operation.operationId,
            operationEpoch: operation.epoch,
            elapsedMs: Math.max(0, nowImpl() - operation.startedAt)
          });
          return receipt;
        });
        checkpointTail = job.catch(() => {});
        return job;
      };
      const upsertRecords = records => {
        const byPanel = new Map(state.extractionRecords.map(record => [record.panelKey, record]));
        records.forEach(record => byPanel.set(record.panelKey, record));
        state.extractionRecords = [...byPanel.values()].sort((left, right) =>
          left.panelOrder - right.panelOrder || left.panelKey.localeCompare(right.panelKey));
      };
      const replaceErrors = (panelKeys, errors) => {
        const targets = new Set(panelKeys);
        state.extractionErrors = state.extractionErrors
          .filter(error => !targets.has(error.panelKey)).concat(errors)
          .sort((left, right) => left.panelKey.localeCompare(right.panelKey));
      };
      const markExtractionFinished = panelKeys => {
        state.extractionFinishedPanelKeys = [...new Set([
          ...state.extractionFinishedPanelKeys, ...panelKeys
        ])].sort();
      };
      const publicFailure = (status, errorCode) => ({
        status,
        errorCode,
        evidenceFirstMechanism: null,
        mechanismGraph: null,
        stage0: publicEvidenceStage0(stage0, operation)
      });
      if (receiptPreflightError) {
        return publicFailure('failed', fixedMechanismCode(receiptPreflightError));
      }
      const assembleCurrentEvidence = () => state.canonicalNodes
        ? shared.assembleMappedEvidenceFirstMechanism({
          records: state.extractionRecords,
          panelLedger: stage0.panelLedger,
          canonicalNodes: state.canonicalNodes,
          mappingRecords: state.mappingRecords
        })
        : null;
      const completionStatus = (mechanism, graph) => {
        if (!mechanism?.ok) return 'failed';
        const claimCount = state.extractionRecords.reduce((sum, record) =>
          sum + (Array.isArray(record.claims) ? record.claims.length : 0), 0);
        const mappedClaimCount = state.mappingRecords.reduce((sum, record) =>
          sum + (Array.isArray(record.mappings) ? record.mappings.length : 0), 0);
        const unmappedClaimCount = state.mappingRecords.reduce((sum, record) =>
          sum + record.mappings.filter(mapping => Boolean(mapping.unmappedTerm)).length, 0);
        return mechanism.status === 'complete' && Boolean(graph) &&
          state.extractionErrors.length === 0 && !state.canonicalError &&
          state.mappingErrors.length === 0 && mappedClaimCount === claimCount &&
          unmappedClaimCount === 0 ? 'complete' : 'needs_review';
      };
      const unresolvedEvidenceDigest = () => `unresolved-evidence-v1-${shared.stableHash({
        ledgerDigest: stage0.panelLedgerDigest,
        extractionErrors: state.extractionErrors,
        extractionFinishedPanelKeys: state.extractionFinishedPanelKeys,
        canonicalError: state.canonicalError,
        mappingErrors: state.mappingErrors,
        mappingFinishedPanelKeys: state.mappingFinishedPanelKeys
      })}`;

      try {
        if (resumedCheckpoint?.phase === 'ready' && state.finalDigest) {
          if (!state.canonicalNodes) {
            if (state.finalStatus !== 'needs_review' ||
                state.finalDigest !== unresolvedEvidenceDigest()) {
              throw checkpointInvalid();
            }
            await coordinator.finalize(operation, 'needs_review');
            return {
              ...publicFailure('needs_review', 'MECHANISM_UNRESOLVED_EVIDENCE'),
              resumed: true
            };
          }
          const mechanism = assembleCurrentEvidence();
          const graph = state.canonicalNodes
            ? buildPanelFreeMechanismGraph(mechanism, stage0.panelLedger) : null;
          const derivedStatus = completionStatus(mechanism, graph);
          if (!mechanism?.ok || mechanism.canonicalDigest !== state.finalDigest ||
              derivedStatus !== state.finalStatus ||
              (derivedStatus === 'complete' && !graph)) {
            const error = new Error('MECHANISM_CHECKPOINT_INVALID');
            error.code = 'MECHANISM_CHECKPOINT_INVALID';
            throw error;
          }
          await coordinator.finalize(operation, derivedStatus);
          return {
            status: derivedStatus,
            evidenceFirstMechanism: mechanism,
            mechanismGraph: graph,
            compatibility: evidenceMechanismCompatibility(mechanism),
            stage0: publicEvidenceStage0(stage0, operation),
            resumed: true
          };
        }

        const finishedExtraction = new Set(state.extractionFinishedPanelKeys);
        const pendingProjectionBatches = [];
        const pendingProjections = stage0.projections.filter(projection =>
          !finishedExtraction.has(projection.panelKey));
        for (let index = 0; index < pendingProjections.length;
          index += EVIDENCE_FIRST_POLICY.maxPanelsPerBatch) {
          pendingProjectionBatches.push(pendingProjections.slice(
            index, index + EVIDENCE_FIRST_POLICY.maxPanelsPerBatch
          ));
        }
        let extractionCheckpoint = Math.max(0,
          resumedCheckpoint?.phase === 'panel_census'
            ? Number(resumedCheckpoint.nextBatchIndex) || 0 : 0);
        if (pendingProjectionBatches.length) {
          await runEvidenceWorkers(pendingProjectionBatches, async (batch, _index, fatal) => {
            coordinator.assertActive(operation);
            const providerReceiptContract = receiptContractFor('panel_evidence_extraction');
            const result = await shared.runPanelEvidenceExtractionBatches({
              projections: batch,
              initialBatchSize: EVIDENCE_FIRST_POLICY.maxPanelsPerBatch,
              maxSchemaRepairs: 0,
              requestTimeoutMs: boundedEvidenceProviderRequestTimeoutMs,
              coordinator,
              operation,
              now: nowImpl,
              sleep: sleepImpl,
              providerPermit: evidenceProviderPermit(coordinator, operation),
              providerReceiptContract,
              assertTrustedOwnerCurrent,
              invokeProvider: (prompt, requestContext) => adapter.generateJson({
                ...prompt,
                outputUnits: Math.max(1, batch.length),
                signal: requestContext.signal
              })
            });
            if (typeof assertTrustedOwnerCurrent === 'function') {
              await assertTrustedOwnerCurrent();
            }
            if (fatal()) return;
            coordinator.assertActive(operation);
            const panelKeys = batch.map(item => item.panelKey);
            upsertRecords(result.records);
            replaceErrors(panelKeys, result.errors);
            markExtractionFinished(panelKeys);
            absorbProviderReceiptIds(result.providerReceiptIds);
            extractionCheckpoint += 1;
            await commit(
              'panel_census', extractionCheckpoint,
              'collecting_panel_evidence', state.extractionFinishedPanelKeys.length
            );
          });
        } else if (!resumedCheckpoint) {
          await commit(
            'panel_census', 0, 'collecting_panel_evidence',
            state.extractionFinishedPanelKeys.length
          );
        }

        const repairableKeys = new Set(state.extractionErrors
          .filter(error => error.reason === 'invalid_provider_batch')
          .map(error => error.panelKey));
        const repairedExtractionKeys = new Set(state.extractionRepairFinishedPanelKeys);
        const repairProjections = stage0.projections.filter(projection =>
          repairableKeys.has(projection.panelKey) &&
          !repairedExtractionKeys.has(projection.panelKey));
        if (repairProjections.length) {
          progress({
            phase: 'repairing_unresolved', completedPanels: 0,
            totalPanels: repairProjections.length,
            operationId: operation.operationId,
            operationEpoch: operation.epoch
          });
          const repairBatches = [];
          for (let index = 0; index < repairProjections.length;
            index += EVIDENCE_FIRST_POLICY.maxPanelsPerBatch) {
            repairBatches.push(repairProjections.slice(
              index, index + EVIDENCE_FIRST_POLICY.maxPanelsPerBatch
            ));
          }
          let repairedPanelCount = 0;
          await runEvidenceWorkers(repairBatches, async (batch, _index, fatal) => {
            const providerReceiptContract = receiptContractFor('panel_evidence_repair');
            const result = await shared.runPanelEvidenceExtractionBatches({
              projections: batch,
              initialBatchSize: EVIDENCE_FIRST_POLICY.maxPanelsPerBatch,
              maxSchemaRepairs: 0,
              maxNetworkRetries: 0,
              repairMode: true,
              requestTimeoutMs: boundedEvidenceProviderRequestTimeoutMs,
              coordinator, operation,
              now: nowImpl, sleep: sleepImpl,
              providerPermit: evidenceProviderPermit(coordinator, operation),
              providerReceiptContract,
              assertTrustedOwnerCurrent,
              invokeProvider: (prompt, requestContext) => adapter.generateJson({
                ...prompt, outputUnits: Math.max(1, batch.length),
                signal: requestContext.signal
              })
            });
            if (typeof assertTrustedOwnerCurrent === 'function') {
              await assertTrustedOwnerCurrent();
            }
            if (fatal()) return;
            coordinator.assertActive(operation);
            const panelKeys = batch.map(item => item.panelKey);
            upsertRecords(result.records);
            replaceErrors(panelKeys, result.errors);
            absorbProviderReceiptIds(result.providerReceiptIds);
            state.extractionRepairFinishedPanelKeys = [...new Set([
              ...state.extractionRepairFinishedPanelKeys, ...panelKeys
            ])].sort();
            repairedPanelCount += batch.length;
            extractionCheckpoint += 1;
            await commit(
              'panel_census', extractionCheckpoint,
              'repairing_unresolved', repairedPanelCount
            );
          });
        }

        const claimCount = state.extractionRecords.reduce((sum, record) =>
          sum + (Array.isArray(record.claims) ? record.claims.length : 0), 0);
        if (!state.canonicalNodes && !state.canonicalError && claimCount > 0) {
          progress({
            phase: 'canonicalizing_nodes', completedPanels: 0, totalPanels,
            operationId: operation.operationId, operationEpoch: operation.epoch
          });
          const canonicalReceiptIds = new Set();
          try {
            const prompt = shared.compileCanonicalNodeProposalPrompt(state.extractionRecords);
            const providerReceiptContract = receiptContractFor('canonical_node_proposal');
            state.canonicalNodes = await runEvidenceProviderWithPolicy({
              adapter, coordinator, operation,
              prompt: { ...prompt, outputUnits: Math.max(1, state.extractionRecords.length) },
              validate: raw => shared.validateCanonicalNodeProposal(
                raw, state.extractionRecords
              ),
              providerReceiptContract,
              providerReceiptSettled: contract => canonicalReceiptIds.add(contract.receipt),
              assertTrustedOwnerCurrent
            });
            absorbProviderReceiptIds([...canonicalReceiptIds]);
          } catch (error) {
            const status = terminalMechanismStatus(error);
            if (status) throw error;
            state.canonicalError = fixedMechanismCode(error);
            absorbProviderReceiptIds([...canonicalReceiptIds]);
            if (state.canonicalError === 'INVALID_RESPONSE' &&
                typeof shared.createConservativeCanonicalNodes === 'function') {
              state.canonicalNodes = shared.createConservativeCanonicalNodes(state.extractionRecords);
              state.canonicalError = '';
            }
          }
          await commit(
            'canonicalization', 0, 'canonicalizing_nodes',
            state.canonicalNodes ? state.extractionRecords.length : 0
          );
        }

        if (state.canonicalNodes) {
          const finishedMappings = new Set(state.mappingFinishedPanelKeys);
          const mappingBatches = [];
          const pendingRecords = state.extractionRecords.filter(record =>
            !finishedMappings.has(record.panelKey));
          for (let index = 0; index < pendingRecords.length;
            index += EVIDENCE_FIRST_POLICY.maxPanelsPerBatch) {
            mappingBatches.push(pendingRecords.slice(
              index, index + EVIDENCE_FIRST_POLICY.maxPanelsPerBatch
            ));
          }
          let mappingCheckpoint = Math.max(0,
            ['edge_batch', 'coverage_repair'].includes(resumedCheckpoint?.phase)
              ? Number(resumedCheckpoint.nextBatchIndex) || 0 : 0);
          const upsertMappings = records => {
            const byPanel = new Map(state.mappingRecords.map(record => [record.panelKey, record]));
            records.forEach(record => byPanel.set(record.panelKey, record));
            state.mappingRecords = [...byPanel.values()].sort((left, right) =>
              left.panelKey.localeCompare(right.panelKey));
          };
          const replaceMappingErrors = (panelKeys, errors) => {
            const targets = new Set(panelKeys);
            state.mappingErrors = state.mappingErrors
              .filter(error => !targets.has(error.panelKey)).concat(errors)
              .sort((left, right) => left.panelKey.localeCompare(right.panelKey));
          };
          const processMappingBatch = async (
            batch, targetedRepair = false, inheritedReceiptIds = []
          ) => {
            const mappingReceiptIds = new Set();
            try {
              const prompt = shared.compilePanelRelationMappingPrompt(
                batch, state.canonicalNodes, state.extractionRecords
              );
              const effectivePrompt = targetedRepair ? {
                ...prompt,
                systemPrompt: `${prompt.systemPrompt}\n` +
                  'TARGETED_REPAIR_PASS: repair only the supplied unresolved Panel claims; preserve supplied handles and return the exact schema.'
              } : prompt;
              const mapped = await runEvidenceProviderWithPolicy({
                adapter, coordinator, operation,
                prompt: {
                  ...effectivePrompt, outputUnits: Math.max(1, batch.length)
                },
                validate: raw => shared.validatePanelRelationMapping(
                  raw, batch, state.canonicalNodes, state.extractionRecords
                ),
                providerReceiptContract: receiptContractFor(
                  targetedRepair
                    ? 'panel_relation_mapping_repair'
                    : 'panel_relation_mapping'
                ),
                providerReceiptSettled: contract => mappingReceiptIds.add(contract.receipt),
                assertTrustedOwnerCurrent
              });
              coordinator.assertActive(operation);
              upsertMappings(mapped.records);
              const panelKeys = batch.map(record => record.panelKey);
              replaceMappingErrors(panelKeys, []);
              state.mappingFinishedPanelKeys = [...new Set([
                ...state.mappingFinishedPanelKeys,
                ...panelKeys
              ])].sort();
              if (targetedRepair) {
                state.mappingRepairFinishedPanelKeys = [...new Set([
                  ...state.mappingRepairFinishedPanelKeys, ...panelKeys
                ])].sort();
              }
              absorbProviderReceiptIds([
                ...inheritedReceiptIds, ...mappingReceiptIds
              ]);
              mappingCheckpoint += 1;
              await commit(
                targetedRepair ? 'coverage_repair' : 'edge_batch', mappingCheckpoint,
                targetedRepair ? 'repairing_unresolved' : 'mapping_claim_relations',
                state.mappingFinishedPanelKeys.length
              );
            } catch (error) {
              const code = fixedMechanismCode(error);
              if (MECHANISM_TERMINAL_CODES.has(code) ||
                  code.startsWith('MECHANISM_CHECKPOINT_') ||
                  code.startsWith('MECHANISM_RUN_STATE_')) throw error;
              if (code === 'OUTPUT_TRUNCATED' && batch.length > 1) {
                const midpoint = Math.ceil(batch.length / 2);
                // The parent dispatch is only absorbed by a checkpoint that contains
                // an applied child result. A crash before that checkpoint therefore
                // remains conservatively ambiguous instead of silently losing work.
                await processMappingBatch(
                  batch.slice(0, midpoint), targetedRepair,
                  [...inheritedReceiptIds, ...mappingReceiptIds]
                );
                await processMappingBatch(batch.slice(midpoint), targetedRepair);
                return;
              }
              const panelKeys = batch.map(record => record.panelKey);
              const conservativeMapping = code === 'INVALID_RESPONSE' &&
                typeof shared.createConservativePanelMappings === 'function'
                ? shared.createConservativePanelMappings(batch, state.canonicalNodes,
                  state.extractionRecords) : null;
              if (conservativeMapping) upsertMappings(conservativeMapping.records);
              replaceMappingErrors(panelKeys, conservativeMapping ? [] : batch.map(record => ({
                panelKey: record.panelKey,
                code: code === 'OUTPUT_TRUNCATED'
                  ? 'OUTPUT_TRUNCATED' : 'INVALID_RESPONSE'
              })));
              state.mappingFinishedPanelKeys = [...new Set([
                ...state.mappingFinishedPanelKeys,
                ...panelKeys
              ])].sort();
              if (targetedRepair) {
                state.mappingRepairFinishedPanelKeys = [...new Set([
                  ...state.mappingRepairFinishedPanelKeys, ...panelKeys
                ])].sort();
              }
              absorbProviderReceiptIds([
                ...inheritedReceiptIds, ...mappingReceiptIds
              ]);
              mappingCheckpoint += 1;
              await commit(
                targetedRepair ? 'coverage_repair' : 'edge_batch', mappingCheckpoint,
                targetedRepair ? 'repairing_unresolved' : 'mapping_claim_relations',
                state.mappingFinishedPanelKeys.length
              );
            }
          };
          await runEvidenceWorkers(mappingBatches, async (batch, _index, fatal) => {
            if (fatal()) return;
            await processMappingBatch(batch);
          });
          const mappingRepairKeys = new Set(state.mappingRecords
            .filter(record => {
              const unresolved = record.mappings.filter(mapping => Boolean(mapping.unmappedTerm));
              if (!unresolved.length) return false;
              if (typeof shared.createConservativePanelMappings !== 'function') return true;
              const source = state.extractionRecords.find(item => item.panelKey === record.panelKey);
              if (!source) return false;
              const local = shared.createConservativePanelMappings([source], state.canonicalNodes,
                state.extractionRecords).records[0];
              // A repeated model call cannot remove uncertainty already recorded
              // in the evidence or turn multiple endpoints into a unique pair.
              return unresolved.some(mapping => local.mappings.some(candidate =>
                candidate.claimId === mapping.claimId && !candidate.unmappedTerm));
            })
            .map(record => record.panelKey));
          const repairedMappingKeys = new Set(state.mappingRepairFinishedPanelKeys);
          for (const panelKey of repairedMappingKeys) mappingRepairKeys.delete(panelKey);
          if (mappingRepairKeys.size) {
            const repairRecords = state.extractionRecords.filter(record =>
              mappingRepairKeys.has(record.panelKey));
            progress({
              phase: 'repairing_unresolved', completedPanels: 0,
              totalPanels: repairRecords.length,
              operationId: operation.operationId, operationEpoch: operation.epoch
            });
            for (let index = 0; index < repairRecords.length;
              index += EVIDENCE_FIRST_POLICY.maxPanelsPerBatch) {
              const batch = repairRecords.slice(
                index, index + EVIDENCE_FIRST_POLICY.maxPanelsPerBatch
              );
              const batchKeys = new Set(batch.map(record => record.panelKey));
              state.mappingErrors = state.mappingErrors.filter(error =>
                !batchKeys.has(error.panelKey));
              state.mappingRecords = state.mappingRecords.filter(record =>
                !batchKeys.has(record.panelKey));
              state.mappingFinishedPanelKeys = state.mappingFinishedPanelKeys.filter(panelKey =>
                !batchKeys.has(panelKey));
              await processMappingBatch(batch, true);
            }
          }
        }

        progress({
          phase: 'assembling_graph', completedPanels: 0, totalPanels,
          operationId: operation.operationId, operationEpoch: operation.epoch
        });
        coordinator.assertActive(operation);
        const mechanism = assembleCurrentEvidence();
        const graph = state.canonicalNodes
          ? buildPanelFreeMechanismGraph(mechanism, stage0.panelLedger) : null;
        progress({
          phase: 'validating_final_result', completedPanels:
            mechanism?.audit?.resolvedPanelCount || 0,
          totalPanels, operationId: operation.operationId,
          operationEpoch: operation.epoch
        });
        coordinator.assertActive(operation);
        if (!mechanism?.ok && !state.canonicalNodes) {
          state.finalStatus = 'needs_review';
          state.finalDigest = unresolvedEvidenceDigest();
          await commit('ready', 0, 'needs_review', 0);
          coordinator.assertActive(operation);
          await coordinator.finalize(operation, 'needs_review');
          return publicFailure('needs_review', 'MECHANISM_UNRESOLVED_EVIDENCE');
        }
        if (!mechanism?.ok) {
          await coordinator.finalize(operation, 'failed');
          return publicFailure('failed', 'MECHANISM_UNRESOLVED_EVIDENCE');
        }
        state.finalStatus = completionStatus(mechanism, graph);
        state.finalDigest = mechanism.canonicalDigest;
        await commit(
          'ready', 0, state.finalStatus,
          mechanism.audit.resolvedPanelCount + mechanism.audit.excludedPanelCount
        );
        coordinator.assertActive(operation);
        await coordinator.finalize(operation, state.finalStatus);
        return {
          status: state.finalStatus,
          evidenceFirstMechanism: mechanism,
          mechanismGraph: graph,
          compatibility: evidenceMechanismCompatibility(mechanism),
          stage0: publicEvidenceStage0(stage0, operation),
          resumed: Boolean(resumedCheckpoint)
        };
      } catch (error) {
        const status = terminalMechanismStatus(error);
        if (!status) throw error;
        const code = fixedMechanismCode(error);
        const receiptTerminal = code === 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS' ||
          code === 'MECHANISM_PROVIDER_RECEIPT_MISMATCH';
        // A claimed-but-unsealed provider receipt is a durable quarantine, not
        // a retryable failed epoch. Leaving the run active makes every future
        // reconstruction encounter the same receipt and prevents a new epoch
        // from redispatching work whose response may merely have been lost.
        if (status === 'failed' && !receiptTerminal) {
          try { await coordinator.finalize(operation, 'failed'); } catch (_) {}
        }
        return publicFailure(status, code);
      }
    }

    async function analyzeCrossFigureLogic(settings, message, context) {
      requireLlmReady(settings);
      const evidenceIdentity = evidenceFirstRequestIdentity(message);
      if (!evidenceIdentity && String(runtimeExtensionId || '')) {
        throw invalidSettings([
          EVIDENCE_FIRST_REQUEST_CONTRACT.markerField,
          'operationId', 'documentId', 'workspaceId', 'baseWorkspaceRevision'
        ]);
      }
      const operation = evidenceIdentity ? null : operationFor(message);
      const evidenceOwnerGuard = evidenceIdentity &&
        typeof context?.assertTrustedOwnerCurrent === 'function'
        ? async () => {
          try {
            await context.assertTrustedOwnerCurrent();
          } catch (_) {
            const error = new Error('MECHANISM_OPERATION_STALE');
            error.code = 'MECHANISM_OPERATION_STALE';
            error.retryable = false;
            throw error;
          }
        }
        : null;
      await waitForOperation(operation);
      const input = shared.normalizeCrossFigureLogicInput({
        document: message?.document,
        articleTitle: message?.document?.title || '',
        backgroundItems: message?.document?.backgroundItems,
        figures: message?.figures
      });
      if (input.mainFigureIds.length < 2) throw invalidSettings(['figures']);
      let evidenceProviderProgressOperation = null;
      const adapterContext = evidenceIdentity ? {
        ...context,
        onProgress(event) {
          if (!evidenceProviderProgressOperation) return;
          try {
            mechanismCoordinator.assertActive(evidenceProviderProgressOperation);
          } catch (_) {
            return;
          }
          context.onProgress?.(event);
        }
      } : context;
      const crossFigureTaskId = resolveLlmTaskId(
        'LLM_ANALYZE_CROSS_FIGURE_LOGIC', 'default'
      );
      const task = createTaskAdapter(
        settings,
        crossFigureTaskId,
        adapterContext,
        evidenceIdentity ? {
          maxTokenLimitRetries: 0,
          maxTruncationRetries: 0,
          requestTimeoutMs: EVIDENCE_FIRST_POLICY.providerRequestTimeoutMs
        } : {}
      );
      const { adapter, route, routePublic } = task;
      const evidenceRouteDigest = evidenceIdentity
        ? await mechanismBindingResult(() =>
            strongFigureRouteDigest(settings, route, crossFigureTaskId))
        : '';
      const evidenceSenderScope = evidenceIdentity
        ? trustedEvidenceSenderScope(evidenceIdentity, context)
        : null;
      if (evidenceIdentity &&
          evidenceIdentity.profileSignature !== null &&
          evidenceIdentity.profileSignature !== route.profileSignature) {
        throw invalidSettings(['profileSignature']);
      }
      const progress = routeProgress(context, routePublic);
      const documentHash = shared.stableHash({
        title: input.articleTitle,
        paperBlueprint: input.paperBlueprint,
        representativeContext: input.representativeContext,
        figures: input.figures
      });
      const effectiveCrossFigureVersion = evidenceIdentity
        ? `${shared.CROSS_FIGURE_LOGIC_VERSION}-evidence-first-v2`
        : shared.CROSS_FIGURE_LOGIC_VERSION;
      const figureHash = shared.stableHash({
        figures: input.figures,
        panelLedger: input.panelLedger,
        paperBlueprint: input.paperBlueprint,
        representativeContext: input.representativeContext,
        crossFigureVersion: effectiveCrossFigureVersion
      });
      const panelLedgerDigest = shared.stableHash(input.panelLedger);
      let evidenceRuntime = null;
      if (evidenceIdentity) {
        if (!mechanismCoordinator) {
          const error = new Error('MECHANISM_RUN_STATE_WRITE_FAILED');
          error.code = 'MECHANISM_RUN_STATE_WRITE_FAILED';
          throw error;
        }
        const stage0 = await buildEvidenceFirstStage0(
          message, input, route, documentHash, evidenceIdentity, evidenceRouteDigest,
          evidenceSenderScope
        );
        const beginInput = {
          operationId: evidenceIdentity.operationId,
          documentId: evidenceIdentity.documentId,
          documentHash: stage0.documentHash,
          workspaceId: evidenceIdentity.workspaceId,
          workspaceGeneration: evidenceIdentity.workspaceGeneration,
          workspaceLifecycle: evidenceIdentity.workspaceLifecycle,
          mechanismChainFingerprint: evidenceIdentity.mechanismChainFingerprint,
          senderExtensionId: evidenceSenderScope.senderExtensionId,
          senderTabId: evidenceSenderScope.senderTabId,
          senderFrameId: evidenceSenderScope.senderFrameId,
          senderDocumentId: evidenceSenderScope.senderDocumentId,
          profileSignature: evidenceRouteDigest,
          baseWorkspaceRevision: evidenceIdentity.baseWorkspaceRevision,
          strictOperationIdentity: true,
          versions: EVIDENCE_FIRST_VERSIONS
        };
        // A public mechanism operation id is permanently owned by its first
        // trusted page/document identity. Probe the durable index before any
        // local registry lookup or epoch creation so a copied id cannot take
        // over the run from another tab or navigation.
        await mechanismCoordinator.status(beginInput);
        let mechanismOperation = mechanismOperations.get(evidenceIdentity.operationId) || null;
        const existingBinding = mechanismOperation?.binding;
        const sameExistingBinding = existingBinding &&
          existingBinding.documentId === beginInput.documentId &&
          existingBinding.documentHash === beginInput.documentHash &&
          existingBinding.workspaceId === beginInput.workspaceId &&
          existingBinding.workspaceGeneration === beginInput.workspaceGeneration &&
          existingBinding.workspaceLifecycle === beginInput.workspaceLifecycle &&
          existingBinding.mechanismChainFingerprint ===
            beginInput.mechanismChainFingerprint &&
          existingBinding.senderExtensionId === beginInput.senderExtensionId &&
          existingBinding.senderTabId === beginInput.senderTabId &&
          existingBinding.senderFrameId === beginInput.senderFrameId &&
          existingBinding.senderDocumentId === beginInput.senderDocumentId &&
          existingBinding.profileSignature === beginInput.profileSignature &&
          existingBinding.baseWorkspaceRevision === beginInput.baseWorkspaceRevision &&
          Object.keys(EVIDENCE_FIRST_VERSIONS).every(key =>
            existingBinding[key] === EVIDENCE_FIRST_VERSIONS[key]);
        if (sameExistingBinding) {
          try {
            const durableStatus = await mechanismCoordinator.status(mechanismOperation);
            if (['failed', 'cancelled'].includes(durableStatus?.status)) {
              mechanismOperation = null;
            } else if (!['complete', 'needs_review'].includes(durableStatus?.status)) {
              mechanismCoordinator.assertActive(mechanismOperation);
            }
          } catch (_) { mechanismOperation = null; }
        } else {
          mechanismOperation = null;
        }
        if (!mechanismOperation) {
          mechanismOperation = await mechanismCoordinator.beginEvidenceFirstOperation(beginInput);
        }
        evidenceProviderProgressOperation = mechanismOperation;
        mechanismOperations.set(mechanismOperation.operationId, mechanismOperation);
        try {
          const providerDispatchBaseDigest = await mechanismDispatchDigest({
            domain: 'evidence-provider-dispatch-binding-v1',
            operationId: mechanismOperation.operationId,
            operationEpoch: mechanismOperation.epoch,
            operationBinding: mechanismOperation.binding,
            routeDigest: evidenceRouteDigest,
            identity: stage0.identity,
            senderScope: evidenceSenderScope,
            normalizedInput: input,
            projections: stage0.projections,
            projectionErrors: stage0.projectionErrors,
            versions: stage0.versions,
            policy: stage0.policy
          }, cryptoImpl);
          let resumedCheckpoint = null;
          let receiptPreflightError = null;
          try {
            resumedCheckpoint = await mechanismCoordinator.resume(mechanismOperation);
          } catch (error) {
            const code = fixedMechanismCode(error);
            if (code !== 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS' &&
                code !== 'MECHANISM_PROVIDER_RECEIPT_MISMATCH') throw error;
            receiptPreflightError = error;
          }
          evidenceRuntime = {
            stage0,
            operation: mechanismOperation,
            checkpoint: resumedCheckpoint,
            providerDispatchBaseDigest,
            receiptPreflightError
          };
        } catch (error) {
          const code = fixedMechanismCode(error);
          const quarantinedReceipt = code === 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS' ||
            code === 'MECHANISM_PROVIDER_RECEIPT_MISMATCH';
          if (!quarantinedReceipt) {
            try {
              await mechanismCoordinator.finalize(mechanismOperation, 'failed');
            } catch (cleanupError) {
              throw mechanismCleanupPendingError(error, cleanupError);
            }
          }
          throw error;
        }
      }
      const key = shared.buildFigureCacheKey({
        documentHash,
        providerId: route.providerId,
        model: route.model,
        profileSignature: route.profileSignature,
        figureId: 'cross-figure-domino',
        figureHash,
        analysisDepth: 'deep',
        figureVersion: effectiveCrossFigureVersion
      });
      const cached = evidenceRuntime ? new Map() : await cacheStore.getMany([key]);
      const cachedEntry = cached.get(key);
      const cachedValue = cachedEntry?.crossFigureLogic;
      const cacheEnvelopeMatches = cachedEntry?.crossFigureVersion ===
          shared.CROSS_FIGURE_LOGIC_VERSION && cachedEntry?.figureHash === figureHash &&
        cachedEntry?.panelLedgerDigest === panelLedgerDigest;
      let validatedCachedValue = null;
      if (!evidenceRuntime && cachedValue && cachedEntry?.fallbackUsed !== true && cacheEnvelopeMatches &&
          message?.forceRefresh !== true) {
        try {
          validatedCachedValue = shared.validateCachedCrossFigureOverview(cachedValue, input);
          const cachedMechanism = shared.validateCachedStagedMechanism(
            cachedValue, input.panelLedger
          );
          validatedCachedValue = {
            ...validatedCachedValue,
            mechanismVocabulary: cachedMechanism.vocabulary.nodes,
            mechanismEdges: cachedValue.mechanismEdges,
            panelDispositions: cachedMechanism.dispositions,
            panelCoverageAudit: cachedMechanism.audit
          };
        } catch (_) {
          validatedCachedValue = null;
        }
      }
      if (validatedCachedValue) {
        const allowedDiagnosticStages = new Set([
          'compact_cross_retry', 'deterministic_evidence_fallback'
        ]);
        const allowedDiagnosticCodes = new Set([
          'REQUEST_TIMEOUT', 'NETWORK_ERROR', 'RATE_LIMITED',
          'PROVIDER_UNAVAILABLE', 'OUTPUT_TRUNCATED', 'INVALID_RESPONSE'
        ]);
        const cachedDiagnostics = (Array.isArray(cachedEntry?.diagnostics)
          ? cachedEntry.diagnostics : []).slice(0, 4).map(item => {
          const stage = typeof item?.stage === 'string' ? item.stage : '';
          const code = typeof item?.code === 'string' ? item.code : '';
          return allowedDiagnosticStages.has(stage) && allowedDiagnosticCodes.has(code)
            ? { stage, code } : null;
        }).filter(Boolean);
        const compatibleCachedValue = {
          ...validatedCachedValue,
          innovationPoints: Array.isArray(validatedCachedValue.innovationPoints)
            ? validatedCachedValue.innovationPoints : [],
          limitationPoints: Array.isArray(validatedCachedValue.limitationPoints)
            ? validatedCachedValue.limitationPoints : []
        };
        await waitForOperation(operation);
        return {
          documentHash,
          crossFigureLogic: { ...compatibleCachedValue, cacheHit: true },
          cacheHit: true,
          fallbackUsed: cachedEntry?.fallbackUsed === true,
          diagnostics: cachedDiagnostics,
          providerId: route.providerId,
          model: route.model,
          profileSignature: route.profileSignature,
          route: routePublic,
          crossFigureVersion: effectiveCrossFigureVersion
        };
      }
      if (!evidenceRuntime && cachedValue && message?.forceRefresh !== true) {
        try { await cacheStore.deleteMany([key]); } catch (_) { /* recompute safely */ }
      }
      progress({
        phase: 'cross_figure_logic',
        completedFigures: 0,
        totalFigures: input.mainFigureIds.length,
        figureLabel: 'Cross-figure domino chain'
      });
      const mainInput = shared.normalizeCrossFigureLogicInput({
        articleTitle: input.articleTitle,
        backgroundItems: input.backgroundItems,
        paperBlueprint: input.paperBlueprint,
        representativeContext: input.representativeContext,
        figures: input.figures.filter(figure => !figure.isSupplemental),
        panelLedger: input.panelLedger
      });
      const prompt = shared.compileCrossFigureOverviewPrompt(mainInput);
      const mainRequest = {
        ...prompt,
        outputUnits: mainInput.mainFigureIds.length
      };
      const mainProgress = {
        completedFigures: 0,
        totalFigures: mainInput.mainFigureIds.length,
        figureLabel: 'Cross-figure domino chain'
      };
      const requestAndValidateStage = async (
        request, progressBase, validator, responsePhase
      ) => {
        const raw = await requestFigureJson(
          adapter, request, { onProgress: progress }, progressBase,
          { maxAttempts: 1, operation }
        );
        await progress({ phase: responsePhase, ...progressBase });
        await waitForOperation(operation);
        const validated = validator(raw);
        await waitForOperation(operation);
        return validated;
      };
      const diagnostics = [];
      let fallbackUsed = false;
      const safeDiagnosticCode = error => {
        const code = String(error?.code || '').toUpperCase();
        return [
          'REQUEST_TIMEOUT', 'NETWORK_ERROR', 'RATE_LIMITED',
          'PROVIDER_UNAVAILABLE', 'OUTPUT_TRUNCATED', 'INVALID_RESPONSE'
        ].includes(code) ? code : 'PROVIDER_UNAVAILABLE';
      };
      const transientCrossError = error => error?.retryable === true || [
        'REQUEST_TIMEOUT', 'NETWORK_ERROR', 'RATE_LIMITED', 'PROVIDER_UNAVAILABLE'
      ].includes(String(error?.code || '').toUpperCase());
      const schemaCrossError = error => [
        'INVALID_RESPONSE', 'OUTPUT_TRUNCATED', 'SCHEMA_VALIDATION_FAILED',
        'JSON_PARSE_ERROR'
      ].includes(String(error?.code || '').toUpperCase()) ||
        /invalid response|invalid json|truncat|schema/i.test(String(error?.message || ''));
      const requestValidated = request => requestAndValidateStage(
        request, mainProgress,
        raw => shared.validateCrossFigureOverview(raw, mainInput),
        'cross_figure_overview_response'
      );
      const repairOnce = async request => {
        progress({
          phase: 'cross_figure_repair', ...mainProgress,
          errorCode: 'INVALID_RESPONSE'
        });
        return requestValidated({
          ...request,
          systemPrompt: `${request.systemPrompt}\n` +
            'REPAIR RETRY: keep every explanatory field concise, preserve all required main Figure ids, and return one complete valid JSON object.'
        });
      };
      const useEvidenceFallback = error => {
        fallbackUsed = true;
        diagnostics.push({
          stage: 'deterministic_evidence_fallback',
          code: safeDiagnosticCode(error)
        });
        return shared.buildDeterministicCrossFigureLogic(mainInput);
      };
      const requestCompactOrFallback = async triggeringError => {
        diagnostics.push({
          stage: 'compact_cross_retry', code: safeDiagnosticCode(triggeringError)
        });
        progress({
          phase: 'cross_figure_compact_retry', ...mainProgress,
          errorCode: safeDiagnosticCode(triggeringError)
        });
        const compactPrompt = shared.compileCompactCrossFigureOverviewPrompt(mainInput);
        const compactRequest = {
          ...compactPrompt, outputUnits: mainInput.mainFigureIds.length
        };
        try {
          return await requestValidated(compactRequest);
        } catch (compactError) {
          if (schemaCrossError(compactError)) {
            try {
              return await repairOnce(compactRequest);
            } catch (repairError) {
              if (schemaCrossError(repairError) || transientCrossError(repairError)) {
                return useEvidenceFallback(repairError);
              }
              throw repairError;
            }
          }
          if (transientCrossError(compactError)) {
            return useEvidenceFallback(compactError);
          }
          throw compactError;
        }
      };
      let mainLogic;
      if (evidenceRuntime) {
        const localOverview = shared.buildDeterministicCrossFigureLogic(mainInput);
        const {
          evidenceOnlyFallback: _evidenceOnlyFallback,
          fallbackUsed: _localFallbackUsed,
          ...boundedOverview
        } = localOverview;
        mainLogic = boundedOverview;
      } else {
        try {
          mainLogic = await requestValidated(mainRequest);
        } catch (error) {
          if (transientCrossError(error)) {
            mainLogic = await requestCompactOrFallback(error);
          } else if (schemaCrossError(error)) {
            try {
              mainLogic = await repairOnce(mainRequest);
            } catch (repairError) {
              if (schemaCrossError(repairError) || transientCrossError(repairError)) {
                mainLogic = await requestCompactOrFallback(repairError);
              } else {
                throw repairError;
              }
            }
          } else {
            throw error;
          }
        }
      }
      let evidenceOutcome = null;
      let stagedMechanism = null;
      if (!fallbackUsed && evidenceRuntime) {
        evidenceOutcome = await runEvidenceFirstMechanismStages({
          adapter,
          coordinator: mechanismCoordinator,
          operation: evidenceRuntime.operation,
          stage0: evidenceRuntime.stage0,
          resumedCheckpoint: evidenceRuntime.checkpoint,
          progress,
          providerDispatchBaseDigest: evidenceRuntime.providerDispatchBaseDigest,
          receiptPreflightError: evidenceRuntime.receiptPreflightError,
          assertTrustedOwnerCurrent: evidenceOwnerGuard
        });
        if (evidenceOutcome.compatibility) {
          stagedMechanism = {
            ...evidenceOutcome.compatibility,
            status: evidenceOutcome.status,
            evidenceFirstMechanism: evidenceOutcome.evidenceFirstMechanism,
            mechanismGraph: evidenceOutcome.mechanismGraph,
            evidenceFirstStage0: evidenceOutcome.stage0
          };
        } else {
          stagedMechanism = {
            status: evidenceOutcome.status,
            evidenceFirstMechanism: null,
            mechanismGraph: null,
            evidenceFirstStage0: evidenceOutcome.stage0,
            errorCode: evidenceOutcome.errorCode
          };
        }
        if (evidenceOutcome.status === 'failed' ||
            evidenceOutcome.status === 'cancelled') {
          const crossFigureLogic = {
            ...mainLogic,
            ...stagedMechanism,
            supplementalSupport: []
          };
          return {
            status: evidenceOutcome.status,
            evidenceFirstMechanism: evidenceOutcome.evidenceFirstMechanism,
            mechanismGraph: evidenceOutcome.mechanismGraph,
            evidenceFirstStage0: evidenceOutcome.stage0,
            errorCode: evidenceOutcome.errorCode,
            resumed: evidenceOutcome.resumed === true,
            documentHash,
            crossFigureLogic: { ...crossFigureLogic, cacheHit: false },
            cacheHit: false,
            fallbackUsed: false,
            diagnostics: [],
            providerId: route.providerId,
            model: route.model,
            profileSignature: route.profileSignature,
            route: routePublic,
            crossFigureVersion: effectiveCrossFigureVersion
          };
        }
      } else if (!fallbackUsed) {
        await waitForOperation(operation);
        progress({
          phase: 'mechanism_vocabulary', ...mainProgress,
          figureLabel: 'Mechanism vocabulary'
        });
        const vocabularyPrompt = shared.compileMechanismVocabularyPrompt(input);
        const vocabularyRequest = {
          ...vocabularyPrompt,
          outputUnits: Math.max(4, Math.min(16, input.panelLedger.entries.length))
        };
        const vocabularyProgress = {
          ...mainProgress, figureLabel: 'Mechanism vocabulary'
        };
        let vocabulary;
        try {
          vocabulary = await requestAndValidateStage(
            vocabularyRequest, vocabularyProgress,
            raw => shared.validateMechanismVocabulary(raw),
            'mechanism_vocabulary_response'
          );
        } catch (error) {
          if (String(error?.code || '').toUpperCase() !== 'INVALID_RESPONSE') throw error;
          progress({
            phase: 'mechanism_vocabulary_repair', ...vocabularyProgress,
            errorCode: 'INVALID_RESPONSE'
          });
          vocabulary = await requestAndValidateStage({
            ...vocabularyRequest,
            systemPrompt: `${vocabularyRequest.systemPrompt}\n` +
              'REPAIR RETRY: return 2-48 unique concise biological nodes, use only the allowed node_type tokens, and return one complete valid JSON object.'
          }, vocabularyProgress, raw => shared.validateMechanismVocabulary(raw),
          'mechanism_vocabulary_repair_response');
        }
        const mechanismPanelBatchSize = 4;
        const mechanismBatchInputs = [];
        for (let index = 0; index < input.panelLedger.entries.length;
          index += mechanismPanelBatchSize) {
          mechanismBatchInputs.push({
            index,
            ledgerBatch: input.panelLedger.entries.slice(
              index, index + mechanismPanelBatchSize
            )
          });
        }
        const batches = (await mapWithConcurrency(
          mechanismBatchInputs, MECHANISM_EDGE_BATCH_CONCURRENCY,
          async ({ index, ledgerBatch }) => {
          await waitForOperation(operation);
          progress({
            phase: 'mechanism_edges',
            completedFigures: index,
            totalFigures: input.panelLedger.entries.length,
            figureLabel: `Panel ${index + 1}-${index + ledgerBatch.length}`
          });
          try {
            const edgePrompt = shared.compileMechanismEdgeBatchPrompt(
              input, vocabulary, ledgerBatch
            );
            const request = {
              ...edgePrompt, outputUnits: Math.max(1, ledgerBatch.length)
            };
            const progressBase = {
              completedFigures: index,
              totalFigures: input.panelLedger.entries.length,
              figureLabel: `Panel ${index + 1}-${index + ledgerBatch.length}`
            };
            const validate = raw => shared.validateMechanismEdgeBatch(
              raw, vocabulary, ledgerBatch
            );
            let validatedBatch;
            try {
              validatedBatch = await requestAndValidateStage(
                request, progressBase, validate, 'mechanism_edge_batch_response'
              );
            } catch (error) {
              if (String(error?.code || '').toUpperCase() !== 'INVALID_RESPONSE') throw error;
              progress({
                phase: 'mechanism_edge_batch_repair', ...progressBase,
                errorCode: 'INVALID_RESPONSE'
              });
              validatedBatch = await requestAndValidateStage({
                ...request,
                systemPrompt: `${request.systemPrompt}\n` +
                  'REPAIR RETRY: return every requested Panel exactly once, keep edge_indexes aligned to this response edges array, and return one complete valid JSON object.'
              }, progressBase, validate, 'mechanism_edge_batch_repair_response');
            }
            return validatedBatch;
          } catch (error) {
            if (String(error?.code || '').toUpperCase() !== 'INVALID_RESPONSE') throw error;
            return null;
          }
          }
        )).filter(Boolean);
        let merged = shared.mergeMechanismEdgeBatches(batches);
        let coverageAudit = shared.auditPanelCoverage(input.panelLedger, merged);
        if (!coverageAudit.ok) {
          const pendingRepairKeys = [...new Set([
            ...(coverageAudit.missingPanelKeys || []),
            ...(coverageAudit.invalidPanelKeys || []),
            ...(coverageAudit.duplicatePanelKeys || [])
          ])];
          for (let index = 0; index < pendingRepairKeys.length;
            index += mechanismPanelBatchSize) {
            await waitForOperation(operation);
            coverageAudit = shared.auditPanelCoverage(input.panelLedger, merged);
            const repairKeySet = new Set(pendingRepairKeys.slice(
              index, index + mechanismPanelBatchSize
            ));
            const subset = values => (Array.isArray(values) ? values : [])
              .filter(key => repairKeySet.has(key));
            const repairAudit = {
              ...coverageAudit,
              missingPanelKeys: subset(coverageAudit.missingPanelKeys),
              invalidPanelKeys: subset(coverageAudit.invalidPanelKeys),
              duplicatePanelKeys: subset(coverageAudit.duplicatePanelKeys)
            };
            const repairCount = new Set([
              ...repairAudit.missingPanelKeys,
              ...repairAudit.invalidPanelKeys,
              ...repairAudit.duplicatePanelKeys
            ]).size;
            if (!repairCount) continue;
            const progressBase = {
              completedFigures: coverageAudit.covered,
              totalFigures: coverageAudit.total,
              figureLabel: `Panel coverage repair ${index + 1}-${index + repairCount}`
            };
            progress({ phase: 'mechanism_coverage_repair', ...progressBase });
            const repairPrompt = shared.compilePanelCoverageRepairPrompt(
              input, vocabulary, merged, repairAudit
            );
            try {
              merged = await requestAndValidateStage({
                ...repairPrompt, outputUnits: Math.max(1, repairCount)
              }, progressBase, raw => shared.applyPanelCoverageRepair(
                merged, raw, repairAudit, vocabulary, input.panelLedger
              ), 'mechanism_coverage_repair_response');
            } catch (error) {
              if (String(error?.code || '').toUpperCase() !== 'INVALID_RESPONSE') throw error;
            }
          }
          coverageAudit = shared.auditPanelCoverage(input.panelLedger, merged);
        }
        if (!coverageAudit.ok) {
          progress({
            phase: 'mechanism_coverage_fail_closed',
            completedFigures: coverageAudit.covered,
            totalFigures: coverageAudit.total,
            figureLabel: 'Panel coverage fail-closed completion'
          });
          merged = shared.finalizePanelCoverageFailClosed(merged, input.panelLedger);
          coverageAudit = shared.auditPanelCoverage(input.panelLedger, merged);
          if (!coverageAudit.ok) {
            const error = new Error('PANEL_LEDGER_INCOMPLETE');
            error.code = 'PANEL_LEDGER_INCOMPLETE';
            throw error;
          }
        }
        if (!Array.isArray(merged.edges) || merged.edges.length === 0) {
          const error = new Error('MECHANISM_GRAPH_EMPTY');
          error.code = 'MECHANISM_GRAPH_EMPTY';
          throw error;
        }
        const labels = new Map(vocabulary.nodes.map(node => [node.nodeId, node.label]));
        const mechanismEdges = merged.edges.map(edge => ({
          edgeId: edge.edgeId,
          from: labels.get(edge.fromNodeId),
          to: labels.get(edge.toNodeId),
          polarity: edge.polarity,
          supportPanels: edge.assignments.map(item => item.panelKey),
          panelAssignments: edge.assignments.map(item => ({ ...item }))
        }));
        stagedMechanism = {
          mechanismVocabulary: vocabulary.nodes,
          mechanismEdges,
          mechanismChain: mechanismEdges.length === 1
            ? `${mechanismEdges[0].from} → ${mechanismEdges[0].to}`
            : `${vocabulary.nodes.length} nodes · ${mechanismEdges.length} directed relationships`,
          panelDispositions: merged.dispositions,
          panelCoverageAudit: coverageAudit
        };
      }
      if (stagedMechanism) mainLogic = { ...mainLogic, ...stagedMechanism };
      const analyzedSupplemental = input.figures.filter(figure =>
        figure.isSupplemental && figure.analysis?.coreConclusion
      );
      const supplementalSupport = [];
      const recoverableSupplementalError = error => [
        'INVALID_RESPONSE', 'OUTPUT_TRUNCATED', 'SCHEMA_VALIDATION_FAILED',
        'JSON_PARSE_ERROR', 'REQUEST_TIMEOUT', 'NETWORK_ERROR', 'RATE_LIMITED',
        'PROVIDER_UNAVAILABLE'
      ].includes(String(error?.code || '').toUpperCase()) ||
        /invalid response|invalid json|truncat|schema/i.test(String(error?.message || ''));
      const attachSupplementalBatch = async batch => {
        if (!batch.length) return;
        const batchInput = shared.normalizeCrossFigureLogicInput({
          articleTitle: input.articleTitle,
          backgroundItems: input.backgroundItems,
          paperBlueprint: input.paperBlueprint,
          representativeContext: input.representativeContext,
          figures: [...mainInput.figures, ...batch]
        });
        if (fallbackUsed || evidenceRuntime) {
          supplementalSupport.push(...shared.fallbackSupplementalSupport(batchInput)
            .filter(item => item.attachmentBasis === 'explicit_caption'));
          return;
        }
        try {
          const supportPrompt = shared.compileSupplementalSupportPrompt(
            batchInput,
            mainLogic
          );
          const validatedSupport = await requestAndValidateStage({
            ...supportPrompt,
            outputUnits: Math.max(1, batch.length)
          }, {
            completedFigures: mainInput.mainFigureIds.length + supplementalSupport.length,
            totalFigures: mainInput.mainFigureIds.length + analyzedSupplemental.length,
            figureLabel: batch.map(figure => figure.figureLabel).join('、')
          }, raw => shared.validateSupplementalSupport(raw, batchInput),
          'cross_figure_supplemental_response');
          supplementalSupport.push(...validatedSupport);
        } catch (error) {
          if (!recoverableSupplementalError(error)) throw error;
          if (!transientCrossError(error) && batch.length > 1) {
            const midpoint = Math.ceil(batch.length / 2);
            await attachSupplementalBatch(batch.slice(0, midpoint));
            await attachSupplementalBatch(batch.slice(midpoint));
            return;
          }
          supplementalSupport.push(...shared.fallbackSupplementalSupport(batchInput)
            .filter(item => item.attachmentBasis === 'explicit_caption'));
        }
        progress({
          phase: 'cross_figure_supplemental',
          completedFigures: mainInput.mainFigureIds.length + supplementalSupport.length,
          totalFigures: mainInput.mainFigureIds.length + analyzedSupplemental.length,
          figureLabel: batch.map(figure => figure.figureLabel).join('、')
        });
      };
      for (let index = 0; index < analyzedSupplemental.length; index += 4) {
        await attachSupplementalBatch(analyzedSupplemental.slice(index, index + 4));
      }
      const crossFigureLogic = {
        ...mainLogic,
        supplementalSupport
      };
      await progress({
        phase: 'cross_figure_logic',
        completedFigures: input.mainFigureIds.length + analyzedSupplemental.length,
        totalFigures: input.mainFigureIds.length + analyzedSupplemental.length,
        figureLabel: 'Cross-figure domino chain'
      });
      await waitForOperation(operation);
      if (!fallbackUsed && !evidenceOutcome) {
        await waitForOperation(operation);
        await cacheStore.setMany([{
          key,
          createdAt: Date.now(),
          crossFigureLogic,
          fallbackUsed: false,
          diagnostics,
          crossFigureVersion: effectiveCrossFigureVersion,
          figureHash,
          panelLedgerDigest
        }]);
      }
      return {
        ...(evidenceOutcome ? {
          status: evidenceOutcome.status,
          evidenceFirstMechanism: evidenceOutcome.evidenceFirstMechanism,
          mechanismGraph: evidenceOutcome.mechanismGraph,
          evidenceFirstStage0: evidenceOutcome.stage0,
          errorCode: evidenceOutcome.errorCode,
          resumed: evidenceOutcome.resumed === true
        } : {}),
        documentHash,
        crossFigureLogic: { ...crossFigureLogic, cacheHit: false },
        cacheHit: false,
        fallbackUsed,
        diagnostics,
        providerId: route.providerId,
        model: route.model,
        profileSignature: route.profileSignature,
        route: routePublic,
        crossFigureVersion: effectiveCrossFigureVersion
      };
    }

    function validAssetRevision(value) {
      return Number.isSafeInteger(value) && value >= 0;
    }

    function validImportedCategoryAsset(value) {
      if (!isPlainObject(value) || value.schemaVersion !== 1 ||
          !validAssetRevision(value.revision) ||
          !isPlainObject(value.categoryOverrides) ||
          !Array.isArray(value.customCategories) ||
          !Array.isArray(value.selectedCategoryIds) ||
          !isPlainObject(value.viewCategoryOverrides)) return false;
      const deletedBuiltInCategoryIds = value.deletedBuiltInCategoryIds === undefined
        ? []
        : value.deletedBuiltInCategoryIds;
      if (!Array.isArray(deletedBuiltInCategoryIds)) return false;
      if (!value.selectedCategoryIds.every(categoryId =>
        /^[a-z][a-z0-9_]*$/.test(String(categoryId || ''))
      )) return false;
      const customCategories = value.customCategories.map(normalizeUnifiedCustomCategory);
      if (customCategories.some(category =>
        !/^[a-z][a-z0-9_]*$/.test(category.categoryId) ||
        shared.validateUnifiedCategory(category).length
      )) return false;
      const catalog = shared.createUnifiedCategoryCatalog();
      if (!deletedBuiltInCategoryIds.every(categoryId =>
        Object.prototype.hasOwnProperty.call(catalog, String(categoryId || ''))
      )) return false;
      customCategories.forEach(category => { catalog[category.categoryId] = category; });
      for (const [categoryId, override] of Object.entries(value.categoryOverrides)) {
        if (!/^[a-z][a-z0-9_]*$/.test(categoryId) || !isPlainObject(override) ||
            !catalog[categoryId]) return false;
        const merged = shared.mergeCategoryOverrides(catalog[categoryId], override);
        if (shared.validateUnifiedCategory(merged).length) return false;
      }
      return Object.values(value.viewCategoryOverrides).every(override =>
        isPlainObject(override) && Array.isArray(override.add) &&
        Array.isArray(override.remove) &&
        [...override.add, ...override.remove].every(categoryId =>
          /^[a-z][a-z0-9_]*$/.test(String(categoryId || ''))
        )
      );
    }

    async function importUserDataAsset(relativePath, value) {
      if (relativePath === 'categories.json') {
        if (!validImportedCategoryAsset(value)) return { imported: false, reason: 'invalid' };
        const settings = await shared.loadSettings(storageArea);
        const localRevision = Number(settings.userDataCategoryRevision) || 0;
        if (value.revision <= localRevision) return { imported: false, reason: 'stale' };
        settings.categoryOverrides = cloneJsonLike(value.categoryOverrides);
        settings.deletedBuiltInCategoryIds = [
          ...(value.deletedBuiltInCategoryIds || [])
        ];
        settings.customCategories = value.customCategories.map(normalizeUnifiedCustomCategory);
        settings.selectedCategoryIds = [...value.selectedCategoryIds];
        settings.viewCategoryOverrides = cloneJsonLike(value.viewCategoryOverrides);
        settings.userDataCategoryRevision = value.revision;
        await shared.saveSettings(storageArea, settings);
        return { imported: true, revision: value.revision };
      }

      const match = /^annotations\/([^/]+)\.json$/u.exec(String(relativePath || ''));
      if (!match || !isPlainObject(value) || value.schemaVersion !== 1 ||
          !validAssetRevision(value.revision)) return { imported: false, reason: 'invalid' };
      let pathDocumentId;
      try {
        pathDocumentId = decodeURIComponent(match[1]);
      } catch (_) {
        return { imported: false, reason: 'invalid' };
      }
      if (pathDocumentId !== value.documentId) return { imported: false, reason: 'invalid' };
      const local = await documentStore.getDocument(value.documentId);
      if (local && Number(local.revision) >= value.revision) {
        return { imported: false, reason: 'stale' };
      }
      try {
        invalidateDocumentCreationReceipts(value.documentId);
        const record = await documentStore.putDocument(value);
        return { imported: true, revision: record.revision };
      } catch (_) {
        return { imported: false, reason: 'invalid' };
      }
    }

    function requireDirectorySync(method) {
      if (typeof directorySync?.[method] === 'function') return;
      const error = new Error('Directory sync is unavailable');
      error.code = 'DIRECTORY_SYNC_UNAVAILABLE';
      throw error;
    }

    function requireArticleWorkspaceStore(method) {
      if (typeof articleWorkspaceStore?.[method] === 'function') return;
      const error = new Error('Article workspace store is unavailable');
      error.code = 'WORKSPACE_STORE_UNAVAILABLE';
      throw error;
    }

    function publicWorkspace(workspace) {
      if (!workspace) return null;
      return {
        schemaVersion: Number(workspace.schemaVersion) || 1,
        workspaceId: String(workspace.workspaceId || ''),
        canonicalUrl: String(workspace.canonicalUrl || ''),
        aliases: cloneJsonLike(workspace.aliases || []),
        title: String(workspace.title || ''),
        directoryName: String(workspace.directoryName || ''),
        revision: String(workspace.revision || ''),
        contentHash: String(workspace.contentHash || ''),
        workspaceGeneration: Number(workspace.workspaceGeneration) || 1,
        storageRevision: Number(workspace.storageRevision) || 0,
        nextTurnSequence: Number(workspace.nextTurnSequence) || 0,
        memoryNeedsRebuild: Boolean(workspace.memoryNeedsRebuild),
        deletionPending: Boolean(workspace.deletionPending),
        createdAt: String(workspace.createdAt || ''),
        updatedAt: String(workspace.updatedAt || '')
      };
    }

    function assertWorkspaceMutationGeneration(workspace, message = {}) {
      const expected = Number(message.workspaceGeneration);
      if (!Number.isInteger(expected) || expected < 1) return;
      const current = Math.max(1, Number(workspace?.workspaceGeneration) || 1);
      if (expected === current) return;
      const error = new Error('WORKSPACE_GENERATION_CONFLICT');
      error.code = 'WORKSPACE_GENERATION_CONFLICT';
      error.expectedGeneration = expected;
      error.currentGeneration = current;
      throw error;
    }

    async function analyzePaperMeta(settings, message, context, taskKind) {
      requireLlmReady(settings);
      const operation = operationFor(message);
      await waitForOperation(operation);
      const paragraphs = Array.isArray(message?.document?.paragraphs)
        ? message.document.paragraphs : [];
      const evidenceDocument = shared.buildResearchEvidenceDocument({
        title: message?.document?.title || '',
        documentHash: message?.document?.documentHash || message?.documentHash || '',
        paragraphs
      }, { maxCharacters: 36000 });
      if (!evidenceDocument.records.length) {
        throw invalidSettings(['document.paragraphs']);
      }
      const taskId = taskKind === 'innovation'
        ? resolveLlmTaskId('LLM_ANALYZE_PAPER_INNOVATION', 'default')
        : taskKind === 'limitations'
          ? resolveLlmTaskId('LLM_ANALYZE_PAPER_LIMITATIONS', 'default')
          : resolveLlmTaskId('LLM_ANALYZE_RESEARCH_LOGIC', 'default');
      const task = requireSummaryJsonCapability(createTaskAdapter(
        settings, taskId, context, {
          tokenPolicyCap: taskKind === 'research_logic' ? 16384 : 8192,
          maxTruncationRetries: 1
        }
      ));
      const progress = event => context.onProgress?.({
        phase: `paper_meta_${event.stage || taskKind}`,
        metaTask: taskKind,
        status: event.status || 'running',
        cacheHit: event.cacheHit === true,
        evidenceCount: Math.max(0, Number(event.evidenceCount) || 0),
        operationId: operation?.operationId || '',
        route: task.routePublic
      });
      const runnerOptions = {
        document: evidenceDocument,
        documentHash: evidenceDocument.documentHash || evidenceDocument.signature,
        behaviorSignature: task.route.profileSignature ||
          shared.requestBehaviorSignature?.(task.route.providerId, task.route.config) || '',
        adapter: task.adapter,
        cacheStore,
        forceRefresh: message?.forceRefresh === true,
        signal: operation?.controller?.signal,
        onProgress: progress
      };
      let result;
      if (taskKind === 'innovation') {
        result = await shared.runInnovationAnalysis(runnerOptions);
      } else if (taskKind === 'limitations') {
        result = await shared.runLimitationAnalysis(runnerOptions);
      } else {
        result = await shared.runResearchLogicPipeline(runnerOptions);
      }
      await waitForOperation(operation);
      return {
        ...result,
        operationId: operation?.operationId || '',
        documentHash: evidenceDocument.documentHash,
        evidenceDocumentSignature: evidenceDocument.signature,
        route: task.routePublic
      };
    }

    async function autofillLiteratureNote(settings, message, context) {
      requireLlmReady(settings);
      if (!isPlainObject(message?.template) ||
          !Array.isArray(message.template.fields) || !message.template.fields.length) {
        throw invalidSettings(['template']);
      }
      const template = shared.normalizeLiteratureNoteTemplates([message.template])[0];
      if (!template?.fields?.length) throw invalidSettings(['template.fields']);
      const paragraphs = Array.isArray(message?.document?.paragraphs)
        ? message.document.paragraphs : [];
      const noteEvidencePolicy = shared.resolveLiteratureNoteEvidencePolicy(template, {
        sourceKind: message?.document?.sourceKind
      });
      const originalEvidenceDocument = shared.buildResearchEvidenceDocument({
        sourceKind: message?.document?.sourceKind,
        title: message?.document?.title || '',
        documentHash: message?.document?.documentHash || message?.documentHash || '',
        paragraphs
      }, { maxCharacters: noteEvidencePolicy.captionFirst ? 128000 : 36000,
        noteEvidencePolicy, evidencePurpose: 'literature-note' });
      if (!originalEvidenceDocument.records.length) throw invalidSettings(['document.paragraphs']);
      let requestEvidenceDocument = originalEvidenceDocument;

      const operation = operationFor(message);
      await waitForOperation(operation);
      const task = requireSummaryJsonCapability(createTaskAdapter(
        settings,
        resolveLlmTaskId('LLM_AUTOFILL_LITERATURE_NOTE', 'default'),
        context,
        {
          tokenPolicyCap: 12288,
          maxTruncationRetries: 1
        }
      ));
      const templateSignature = shared.stableHash({
        id: template.id,
        name: template.name,
        studyFamily: template.studyFamily,
        fields: template.fields.map(field => ({
          id: field.id,
          label: field.label,
          prompt: field.prompt,
          placeholder: field.placeholder,
          multiline: field.multiline !== false,
          required: field.required === true
        }))
      });
      const outputLanguage = task.route.outputLanguage || 'zh-CN';
      const backgroundGuidance = shared.getLiteratureNoteBackgroundGuidanceVersion(template);
      const outputContractVersion = shared.getLiteratureNoteOutputContractVersion(
        template, originalEvidenceDocument, { noteEvidencePolicy }
      );
      const cacheKey = `literature-note:${shared.stableHash({
        version: 5,
        ...(noteEvidencePolicy.id ? {
          guidance: shared.LITERATURE_NOTE_HTML_FINDINGS_GUIDANCE_VERSION,
          captionLabels: 'extended-data-v1'
        } : {}),
        ...(backgroundGuidance ? { backgroundGuidance } : {}),
        ...(outputContractVersion ? { outputContract: outputContractVersion } : {}),
        documentHash: originalEvidenceDocument.documentHash,
        evidence: originalEvidenceDocument.signature,
        template: templateSignature,
        profile: task.route.profileSignature,
        outputLanguage
      })}`;
      const operationId = String(operation?.operationId || message?.operationId || '')
        .trim().slice(0, 100);
      const cacheIdentity = Object.freeze({
        cacheKey,
        documentHash: originalEvidenceDocument.documentHash,
        evidenceSignature: originalEvidenceDocument.signature,
        templateSignature,
        profileSignature: task.route.profileSignature,
        outputLanguage
      });
      const operationReceipt = (cacheHit, providerAttempts) => Object.freeze({
        schemaVersion: 1,
        operationId,
        cacheHit,
        providerAttempts,
        cacheIdentity
      });
      const evidenceReceipt = Object.freeze({
        ...(noteEvidencePolicy.id ? { noteEvidencePolicyId: noteEvidencePolicy.id } : {}),
        documentHash: originalEvidenceDocument.documentHash,
        evidenceSignature: originalEvidenceDocument.signature,
        templateSignature,
        records: Object.freeze(originalEvidenceDocument.records.map(record => Object.freeze({
          paragraphId: String(record.paragraphId || ''),
          sourceIdentity: String(record.sourceIdentity || ''),
          textHash: String(record.textHash || '')
        })))
      });
      if (message?.forceRefresh !== true) {
        const cached = (await cacheStore.getMany([cacheKey])).get(cacheKey);
        if (cached?.schemaVersion === 3 && cached?.normalized &&
            cached?.templateId === template.id &&
            cached?.documentHash === originalEvidenceDocument.documentHash &&
            cached?.evidenceSignature === originalEvidenceDocument.signature &&
            cached?.templateSignature === templateSignature &&
            cached?.profileSignature === task.route.profileSignature &&
            cached?.outputLanguage === outputLanguage) {
          const cachedValues = isPlainObject(cached.normalized.values)
            ? { ...cached.normalized.values } : cached.normalized.values;
          if (isPlainObject(cachedValues)) {
            template.fields.forEach(field => {
              if (!Object.hasOwn(cachedValues, field.id) &&
                  cached.normalized.statuses?.[field.id] === 'missing') {
                cachedValues[field.id] = '';
              }
            });
          }
          const normalized = shared.validateLiteratureNoteAutofillResponse({
            values: cachedValues,
            statuses: cached.normalized.statuses,
            sources: cached.normalized.sources
          }, template, originalEvidenceDocument, { outputLanguage, noteEvidencePolicy });
          return {
            ...normalized,
            templateId: template.id,
            documentHash: originalEvidenceDocument.documentHash,
            cacheHit: true,
            operationId,
            operationReceipt: operationReceipt(true, 0),
            evidenceReceipt: Object.freeze({ ...evidenceReceipt, ...(noteEvidencePolicy.id
              ? { captionCoverage: cached.captionCoverage || null } : {}) }),
            route: task.routePublic
          };
        }
      }

      const progress = (phase, extra = {}) => context.onProgress?.({
        phase,
        status: 'running',
        operationId: operation?.operationId || '',
        templateId: template.id,
        evidenceCount: requestEvidenceDocument.records.length,
        route: task.routePublic,
        ...extra
      });
      let prompt = shared.compileLiteratureNoteAutofillPrompt(
        template, requestEvidenceDocument, { outputLanguage, noteEvidencePolicy }
      );
      let providerAttempts = 0;
      const request = requestPrompt => {
        const outputUnits = Math.max(2, Math.ceil(template.fields.length / 4),
          noteEvidencePolicy.captionFirst === true
            ? Math.min(noteEvidencePolicy.maxSources,
              requestEvidenceDocument.captionCoverage?.completeParagraphIds?.length || 0)
            : 0);
        if (noteEvidencePolicy.captionFirst === true) {
          const profile = settings?.profiles?.[task.route.effectiveProfileId] || {};
          const contextWindowTokens = shared.getProviderContextWindowTokens(
            task.route.providerId, task.route.config, profile.contextWindowTokens
          );
          const taskRule = task.taskRule === 'auto' ? null : task.taskRule;
          const outputBudget = shared.computeOutputTokenBudget('literature_note_autofill', {
            units: outputUnits, taskRule, tokenPolicy: task.tokenPolicy,
            adapterCap: task.rawAdapter.maxOutputTokens
          });
          const localized = typeof shared.applyOutputLanguageContract === 'function'
            ? shared.applyOutputLanguageContract(requestPrompt, outputLanguage) : requestPrompt;
          const wrappedSystem = shared.withStructuredSchemaPrompt(localized);
          const inputTokens = Math.max(shared.estimateArticleChatTokens(JSON.stringify({
            system: localized.systemPrompt, user: localized.userPrompt,
            schema: localized.responseSchema
          })), shared.estimateArticleChatTokens(wrappedSystem) +
            shared.estimateArticleChatTokens(localized.userPrompt));
          // Normalized output-only overrides contain input defaults (1/0).
          // They must not silently remove this larger evidence request's margin.
          const inputTaskRule = taskRule ? { ...taskRule, input: {
            ...taskRule.input,
            reservedTokens: Math.max(1024, Number(taskRule.input?.reservedTokens) || 0),
            safetyRatio: Math.min(0.9, Number(taskRule.input?.safetyRatio) || 0.9)
          } } : null;
          const inputBudget = shared.computeInputTokenBudget({
            contextWindowTokens, outputTokens: outputBudget.ceiling, taskRule: inputTaskRule,
            reservedTokens: 1024, safetyRatio: 0.9
          });
          if (inputTokens > inputBudget.available) {
            const error = new Error('The selected model context window cannot fit the Figure findings evidence');
            error.code = 'CONTEXT_BUDGET_EXCEEDED'; error.retryable = false;
            throw error;
          }
        }
        providerAttempts += 1;
        return task.adapter.generateJson({
          ...requestPrompt,
          outputUnits,
          signal: operation?.controller?.signal
        });
      };
      // Model JSON failures share the existing single schema repair; transport/body
      // guards still throw, and syntax alone must not shrink the supplied evidence.
      let completionFormatError = null;
      const requestForValidation = async requestPrompt => {
        try {
          return await request(requestPrompt);
        } catch (error) {
          if (error?.code !== 'INVALID_RESPONSE' ||
              (error?.diagnosticStage && error.diagnosticStage !== 'provider-completion')) {
            throw error;
          }
          completionFormatError = error;
          return null;
        }
      };
      progress('literature_note_requesting');
      let raw;
      try {
        raw = await requestForValidation(prompt);
      } catch (error) {
        if (!error?.retryable ||
            typeof shared.compactResearchEvidenceDocument !== 'function') throw error;
        requestEvidenceDocument = shared.compactResearchEvidenceDocument(
          originalEvidenceDocument, {
            maxCharacters: 18000
          }
        );
        prompt = shared.compileLiteratureNoteAutofillPrompt(
          template, requestEvidenceDocument, { outputLanguage, noteEvidencePolicy }
        );
        const waitMs = Math.max(800, Number(error?.retryAfterMs) || 0);
        progress('literature_note_compact_retry', {
          errorCode: String(error?.code || 'NETWORK_ERROR'), waitMs
        });
        await sleepForOperation(waitMs, operation);
        raw = await requestForValidation(prompt);
      }
      await waitForOperation(operation);
      let normalized;
      try {
        if (completionFormatError) throw completionFormatError;
        normalized = shared.validateLiteratureNoteAutofillResponse(
          raw, template, requestEvidenceDocument, { outputLanguage, noteEvidencePolicy }
        );
      } catch (error) {
        if (error?.code !== 'INVALID_RESPONSE') throw error;
        progress('literature_note_schema_retry');
        const outputContractRepair = outputContractVersion
          ? shared.compileLiteratureNoteSchemaRepairGuidance(
            template, requestEvidenceDocument, raw, { noteEvidencePolicy }
          ) : '';
        const repaired = await request({
          ...prompt,
          systemPrompt: `${prompt.systemPrompt}\nSCHEMA_REPAIR_PASS: Return exactly values, statuses, and sources for every requested field id. supported requires non-empty value plus supplied paragraphIds; missing requires value="" and sources=[].${outputContractRepair ? `\n${outputContractRepair}` : ''}`
        });
        try {
          normalized = shared.validateLiteratureNoteAutofillResponse(
            repaired, template, requestEvidenceDocument, { outputLanguage, noteEvidencePolicy }
          );
        } catch (repairError) {
          if (repairError?.code !== 'INVALID_RESPONSE' ||
              typeof shared.finalizeLiteratureNoteAutofillFailClosed !== 'function') {
            throw repairError;
          }
          progress('literature_note_fail_closed');
          normalized = shared.finalizeLiteratureNoteAutofillFailClosed(
            repaired, template, requestEvidenceDocument, { outputLanguage, noteEvidencePolicy }
          );
        }
      }
      await waitForOperation(operation);
      await cacheStore.setMany([{
        key: cacheKey,
        createdAt: Date.now(),
        schemaVersion: 3,
        templateId: template.id,
        documentHash: originalEvidenceDocument.documentHash,
        evidenceSignature: originalEvidenceDocument.signature,
        templateSignature,
        profileSignature: task.route.profileSignature,
        outputLanguage,
        normalized,
        ...(noteEvidencePolicy.id ? { captionCoverage: requestEvidenceDocument.captionCoverage || null } : {})
      }]);
      progress('literature_note_complete', {
        status: 'complete', fieldCount: Object.keys(normalized.values).length
      });
      await waitForOperation(operation);
      return {
        ...normalized,
        templateId: template.id,
        documentHash: originalEvidenceDocument.documentHash,
        cacheHit: false,
        operationId,
        operationReceipt: operationReceipt(false, providerAttempts),
        evidenceReceipt: Object.freeze({ ...evidenceReceipt, ...(noteEvidencePolicy.id
          ? { captionCoverage: requestEvidenceDocument.captionCoverage || null } : {}) }),
        route: task.routePublic
      };
    }

    function articleWorkspaceRestoreTargetError() {
      const error = new Error('ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH');
      error.code = 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH';
      return error;
    }

    function normalizedRestoreCommitIdentity(input) {
      if (!isPlainObject(input)) return null;
      let canonicalUrl = '';
      try {
        canonicalUrl = shared.normalizeWorkspaceCanonicalUrl(input.canonicalUrl);
      } catch (_) {
        return null;
      }
      const workspaceId = String(input.workspaceId || '').trim().toLowerCase();
      const workspaceGeneration = Number(input.workspaceGeneration);
      const contentHash = String(input.contentHash || '')
        .trim().toLowerCase().replace(/^sha256:/u, '');
      if (!/^workspace:[a-f0-9]{64}$/u.test(workspaceId) ||
          !Number.isSafeInteger(workspaceGeneration) || workspaceGeneration < 1 ||
          !/^[a-f0-9]{64}$/u.test(contentHash) || !canonicalUrl) return null;
      return { workspaceId, workspaceGeneration, canonicalUrl, contentHash };
    }

    function sameRestoreCommitIdentity(left, right) {
      return Boolean(left && right && left.workspaceId === right.workspaceId &&
        left.workspaceGeneration === right.workspaceGeneration &&
        left.canonicalUrl === right.canonicalUrl &&
        left.contentHash === right.contentHash);
    }

    function assertAuthorizedWorkspaceRestoreCommit(message, manifestInput, match) {
      if (message.authorizedCommit !== true) return false;
      let manifest;
      try {
        manifest = shared.validateWorkspaceManifest(manifestInput);
      } catch (_) {
        throw articleWorkspaceRestoreTargetError();
      }
      const target = isPlainObject(message.restoreTarget) ? message.restoreTarget : {};
      const current = normalizedRestoreCommitIdentity(target.current);
      const identity = normalizedRestoreCommitIdentity(message.identity);
      const expectedManifest = normalizedRestoreCommitIdentity(target.manifest);
      const actualManifest = normalizedRestoreCommitIdentity(manifest);
      const allowContentChanged = target.allowContentChanged === true &&
        match === 'content-changed';
      if (!sameRestoreCommitIdentity(current, identity) ||
          !sameRestoreCommitIdentity(expectedManifest, actualManifest) ||
          actualManifest.workspaceId !== current?.workspaceId ||
          actualManifest.workspaceGeneration !== current?.workspaceGeneration ||
          actualManifest.canonicalUrl !== current?.canonicalUrl ||
          (actualManifest.contentHash !== current?.contentHash && !allowContentChanged)) {
        throw articleWorkspaceRestoreTargetError();
      }
      return true;
    }

    function supplementalRouteError(code) {
      const error = new Error(code);
      error.code = code;
      return error;
    }

    function normalizeSupplementalDraftTarget(input) {
      if (!isPlainObject(input)) throw supplementalRouteError('SUPPLEMENTAL_TARGET_INVALID');
      const workspaceId = String(input.workspaceId || '').trim().toLowerCase();
      const workspaceGeneration = input.workspaceGeneration;
      const targetArticleTabId = input.targetArticleTabId;
      if (!/^workspace:[a-f0-9]{64}$/.test(workspaceId) ||
          !Number.isSafeInteger(workspaceGeneration) || workspaceGeneration < 1 ||
          !Number.isSafeInteger(targetArticleTabId) || targetArticleTabId < 0 ||
          typeof input.canonicalUrl !== 'string') {
        throw supplementalRouteError('SUPPLEMENTAL_TARGET_INVALID');
      }
      let canonicalUrl = '';
      try {
        canonicalUrl = shared.normalizeWorkspaceCanonicalUrl(input.canonicalUrl);
      } catch (_) {
        throw supplementalRouteError('SUPPLEMENTAL_TARGET_INVALID');
      }
      if (!canonicalUrl) throw supplementalRouteError('SUPPLEMENTAL_TARGET_INVALID');
      const hasDocumentHash = Object.prototype.hasOwnProperty.call(input, 'documentHash');
      const rawDocumentHash = hasDocumentHash
        ? String(input.documentHash || '').trim().toLowerCase() : '';
      const documentHash = rawDocumentHash.replace(/^sha256:/, '');
      if (hasDocumentHash && !/^[a-f0-9]{64}$/.test(documentHash)) {
        throw supplementalRouteError('SUPPLEMENTAL_TARGET_INVALID');
      }
      return {
        workspaceId,
        workspaceGeneration,
        targetArticleTabId,
        canonicalUrl,
        documentHash
      };
    }

    function supplementalAssetWorkspaceTarget(message = {}) {
      if (message.target === undefined) return null;
      const target = normalizeSupplementalDraftTarget(message.target);
      const workspaceId = String(message.workspaceId || '').trim().toLowerCase();
      if (workspaceId !== target.workspaceId) {
        throw supplementalRouteError('SUPPLEMENTAL_TARGET_INVALID');
      }
      return target;
    }

    function supplementalDraftSourceInput(message = {}) {
      const draft = message.draft;
      if (!isPlainObject(draft)) throw supplementalRouteError('SUPPLEMENTAL_DRAFT_INVALID');
      const source = isPlainObject(message.source) ? message.source : {};
      const figure = Array.isArray(draft.figures) && isPlainObject(draft.figures[0])
        ? draft.figures[0] : {};
      const candidate = {
        sourceMode: source.sourceMode || draft.sourceMode || figure.sourceMode,
        sourceMaterialId: source.sourceMaterialId || draft.sourceMaterialId ||
          draft.materialId || figure.sourceMaterialId,
        sourceFileName: source.sourceFileName ?? draft.sourceFileName ??
          figure.sourceFileName,
        sourceMimeType: source.sourceMimeType ?? draft.sourceMimeType ??
          figure.sourceMimeType,
        sourceFileSize: source.sourceFileSize ?? draft.sourceFileSize ??
          figure.sourceFileSize,
        sourceImportedAt: source.sourceImportedAt || draft.sourceImportedAt ||
          figure.sourceImportedAt,
        sourceFingerprint: source.sourceFingerprint || draft.sourceFingerprint ||
          figure.sourceFingerprint,
        caption: source.caption ?? draft.caption ?? figure.caption,
        figureKind: source.figureKind || draft.figureKind || figure.figureKind,
        figureLabel: source.figureLabel || draft.figureLabel || figure.figureLabel,
        sourcePage: source.sourcePage ?? draft.sourcePage ?? figure.sourcePage
      };
      const normalizedSource = shared.normalizeSupplementalFigureSource(candidate);
      let transientImage = null;
      if (normalizedSource.sourceMode === 'image') {
        if (message.transientImage === undefined) {
          throw supplementalRouteError('SUPPLEMENTAL_TRANSIENT_IMAGE');
        }
        transientImage = shared.normalizeSupplementalTransientImage(
          message.transientImage,
          normalizedSource.sourceFingerprint
        );
      } else if (message.transientImage !== undefined) {
        throw supplementalRouteError('SUPPLEMENTAL_TRANSIENT_IMAGE');
      }
      return {
        source: normalizedSource,
        transientImage,
        title: String(draft.title || source.title || figure.sourceTitle || '').slice(0, 500),
        figureId: String(figure.figureId || '').slice(0, 200),
        figureLabel: String(
          normalizedSource.figureLabel || figure.figureLabel || source.figureLabel || ''
        ).slice(0, 240),
        figureKind: normalizedSource.figureKind,
        sourcePage: normalizedSource.sourcePage
      };
    }

    function assertSupplementalDraftWorkspaceTarget(workspace, target) {
      assertWorkspaceMutationGeneration(workspace, target);
      let canonicalUrl = '';
      try {
        canonicalUrl = shared.normalizeWorkspaceCanonicalUrl(workspace.canonicalUrl);
      } catch (_) {}
      if (!canonicalUrl || canonicalUrl !== target.canonicalUrl) {
        throw supplementalRouteError('SUPPLEMENTAL_TARGET_CANONICAL_MISMATCH');
      }
      const workspaceDocumentHash = String(
        workspace.contentHash || workspace.revision || ''
      ).replace(/^sha256:/i, '').toLowerCase();
      const workspaceHasDocumentHash = /^[a-f0-9]{64}$/.test(workspaceDocumentHash);
      if ((workspaceHasDocumentHash && !target.documentHash) ||
          (target.documentHash && (!workspaceHasDocumentHash ||
            workspaceDocumentHash !== target.documentHash))) {
        throw supplementalRouteError('SUPPLEMENTAL_TARGET_DOCUMENT_MISMATCH');
      }
    }

    async function mirrorWorkspaceAssetToDirectory(workspace, asset, {
      verify = false
    } = {}) {
      const stableJson = value => {
        if (Array.isArray(value)) return value.map(stableJson);
        if (!isPlainObject(value)) return value;
        return Object.fromEntries(
          Object.keys(value).sort().map(key => [key, stableJson(value[key])])
        );
      };
      const result = {
        queued: false,
        directoryPersisted: false,
        directoryPermission: 'unavailable',
        directoryErrorCode: ''
      };
      if (typeof directorySync?.enqueueWorkspaceAsset !== 'function') return result;
      try {
        await directorySync.enqueueWorkspaceAsset(
          workspace, asset.relativePath, asset.content, {
            revision: asset.revision,
            contentHash: asset.contentHash,
            updatedAt: asset.updatedAt,
            advanceFromDirectory: true,
            workspaceGeneration: workspace.workspaceGeneration
          }
        );
        result.queued = true;
        if (!verify) {
          scheduleDirectoryFlush();
          return result;
        }
        if (typeof directorySync.flush !== 'function') return result;
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const flushed = await directorySync.flush(importUserDataAsset);
          result.directoryPermission = String(flushed?.permission || 'unavailable');
          result.directoryErrorCode = String(
            flushed?.errorCode || flushed?.code || ''
          );
          if (result.directoryPermission !== 'granted' || Number(flushed?.failed) > 0) {
            return result;
          }
          if (typeof directorySync.readWorkspaceAsset === 'function') {
            const disk = await directorySync.readWorkspaceAsset(
              workspace, asset.relativePath
            ).catch(() => null);
            const envelope = disk?.value;
            const contentHashMatches = asset.contentHash
              ? String(envelope?.contentHash || '') === String(asset.contentHash)
              : JSON.stringify(stableJson(envelope?.data)) ===
                JSON.stringify(stableJson(asset.content));
            if (disk?.found && contentHashMatches) {
              result.directoryPersisted = true;
              result.directoryErrorCode = '';
              return result;
            }
          } else if (Number(flushed?.pendingCount) === 0) {
            result.directoryPersisted = true;
            result.directoryErrorCode = '';
            return result;
          }
          if (attempt < 5) {
            await new Promise(resolve => setTimeout(resolve, 30 * (attempt + 1)));
          }
        }
        result.directoryErrorCode ||= 'WORKSPACE_DIRECTORY_VERIFY_FAILED';
        return result;
      } catch (error) {
        result.directoryErrorCode = String(
          error?.code || error?.name || 'WORKSPACE_DIRECTORY_PERSIST_FAILED'
        );
        return result;
      }
    }

    function decodeWorkspaceBinary(dataUrl) {
      const match = String(dataUrl || '').match(
        /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i
      );
      if (!match) {
        const error = new Error('INVALID_BINARY_ASSET');
        error.code = 'INVALID_BINARY_ASSET';
        throw error;
      }
      let bytes;
      if (typeof Buffer !== 'undefined') {
        bytes = new Uint8Array(Buffer.from(match[2], 'base64'));
      } else {
        const binary = atob(match[2]);
        bytes = Uint8Array.from(binary, value => value.charCodeAt(0));
      }
      if (!bytes.length || bytes.byteLength > 96 * 1024 * 1024) {
        const error = new Error('INVALID_BINARY_ASSET');
        error.code = 'INVALID_BINARY_ASSET';
        throw error;
      }
      return { bytes, mimeType: match[1].toLowerCase() };
    }

    function encodeWorkspaceBinary(bytes, mimeType) {
      const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
      let base64 = '';
      if (typeof Buffer !== 'undefined') base64 = Buffer.from(view).toString('base64');
      else {
        const chunkSize = 0x8000;
        let binary = '';
        for (let index = 0; index < view.length; index += chunkSize) {
          binary += String.fromCharCode(...view.subarray(index, index + chunkSize));
        }
        base64 = btoa(binary);
      }
      return `data:${mimeType};base64,${base64}`;
    }

    async function workspaceBinarySha256(bytes) {
      let subtle = globalThis.crypto?.subtle;
      if (!subtle && typeof require === 'function') {
        try { subtle = require('node:crypto').webcrypto.subtle; } catch (_) {}
      }
      if (!subtle) throw Object.assign(new Error('WORKSPACE_BINARY_UNAVAILABLE'), {
        code: 'WORKSPACE_BINARY_UNAVAILABLE'
      });
      const digest = await subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), value =>
        value.toString(16).padStart(2, '0')).join('');
    }

    async function saveClosedTabSupplementalDraft(message) {
      requireArticleWorkspaceStore('getWorkspace');
      requireArticleWorkspaceStore('getAsset');
      requireArticleWorkspaceStore('putAsset');
      if (typeof shared.normalizeWorkspaceCanonicalUrl !== 'function' ||
          typeof shared.normalizeSupplementalFigureSource !== 'function' ||
          typeof shared.normalizeSupplementalTransientImage !== 'function' ||
          typeof shared.createManualSupplementalDraft !== 'function' ||
          typeof shared.createSupplementalFigureImportDraft !== 'function' ||
          typeof shared.supplementalFigureAssetPath !== 'function') {
        throw supplementalRouteError('SUPPLEMENTAL_DRAFT_INVALID');
      }
      const target = normalizeSupplementalDraftTarget(message.target);
      const workspace = await articleWorkspaceStore.getWorkspace(target.workspaceId);
      if (!workspace || workspace.deletionPending) {
        throw supplementalRouteError('WORKSPACE_NOT_FOUND');
      }
      assertSupplementalDraftWorkspaceTarget(workspace, target);
      const normalized = supplementalDraftSourceInput(message);
      const manualSource = ['image', 'caption'].includes(normalized.source.sourceMode);
      let asset;
      let createdFigure = null;
      if (manualSource) {
        const supplementalAssets = typeof articleWorkspaceStore.listAssets === 'function'
          ? (await articleWorkspaceStore.listAssets(target.workspaceId))
            .filter(item => String(item?.relativePath || '').startsWith(
              shared.SUPPLEMENTAL_FIGURE_ASSET_PREFIX || 'figures/supplemental/'
            ))
          : [];
        const assignedFigureLabel = normalized.figureKind === 'main'
          ? normalized.figureLabel
          : /^Figure S\d+$/i.test(normalized.figureLabel)
            ? normalized.figureLabel
            : typeof shared.nextSupplementalFigureLabel === 'function'
              ? shared.nextSupplementalFigureLabel(supplementalAssets)
              : `Figure S${supplementalAssets.length + 1}`;
        const created = await shared.createManualSupplementalDraft({
          ...normalized.source,
          title: normalized.title,
          figureId: normalized.figureId,
          figureLabel: assignedFigureLabel,
          figureKind: normalized.figureKind,
          sourcePage: normalized.sourcePage,
          analysisStatus: 'awaiting_article_context',
          ...(normalized.transientImage
            ? { analysisImages: [cloneJsonLike(normalized.transientImage)] }
            : {})
        }, {
          exists: async candidate => Boolean(await articleWorkspaceStore.getAsset(
            target.workspaceId,
            shared.supplementalFigureAssetPath(candidate)
          )),
          save: (relativePath, draftContent, conflict) =>
            articleWorkspaceStore.putAsset(
              target.workspaceId, relativePath, draftContent, conflict
            )
        });
        asset = created.persisted;
        createdFigure = created.asset?.figures?.[0] || null;
      } else {
        const materialId = normalized.source.sourceMaterialId;
        const sourceDraft = shared.createSupplementalFigureImportDraft({
          ...normalized.source,
          title: normalized.title,
          figureId: normalized.figureId,
          figureLabel: normalized.figureLabel,
          figureKind: normalized.figureKind,
          sourcePage: normalized.sourcePage
        });
        const draftContent = {
          ...sourceDraft,
          analysisStatus: 'awaiting_article_context',
          figures: sourceDraft.figures.map(figure => ({
            ...figure,
            analysisStatus: 'awaiting_article_context'
          }))
        };
        asset = await articleWorkspaceStore.putAsset(
          target.workspaceId,
          shared.supplementalFigureAssetPath(materialId),
          draftContent,
          { expectedRevision: 0, createOnly: true }
        );
      }
      const directory = await mirrorWorkspaceAssetToDirectory(workspace, asset, {
        verify: true
      });
      return {
        saved: true,
        queued: directory.queued,
        directoryPersisted: directory.directoryPersisted,
        directoryPermission: directory.directoryPermission,
        directoryErrorCode: directory.directoryErrorCode,
        asset: {
          relativePath: String(asset.relativePath || ''),
          revision: Number(asset.revision) || 0,
          contentHash: String(asset.contentHash || '')
        },
        analysisStatus: 'awaiting_article_context',
        figureLabel: String(createdFigure?.figureLabel || ''),
        panelHints: Array.isArray(createdFigure?.panelHints)
          ? createdFigure.panelHints : []
      };
    }

    function publicStoredArticleChatTurn(turn = {}) {
      const value = cloneJsonLike(turn);
      for (const key of [
        'turnKey', 'workspaceId', 'workspaceGeneration', 'sequence', 'revision'
      ]) delete value[key];
      const answerUnverified = isPlainObject(value.answerProvenance) &&
        ['external_import', 'provider_unverified'].includes(value.answerProvenance.origin) &&
        value.answerProvenance.verification === 'unverified';
      if (answerUnverified) {
        value.answerProvenance = {
          origin: value.answerProvenance.origin, verification: 'unverified'
        };
      } else {
        delete value.answerProvenance;
      }
      const webSearch = isPlainObject(value.webSearch) ? value.webSearch : {};
      const webSearchEnabled = value.intent !== 'highlight' && webSearch.enabled === true;
      let receipt = null;
      if (!answerUnverified && webSearchEnabled && webSearch.searched === true &&
          typeof shared.normalizeArticleChatWebGroundingReceipt === 'function') {
        const route = isPlainObject(value.route) ? value.route : {};
        const answerBlocks = (Array.isArray(value.answerBlocks) ? value.answerBlocks : [])
          .map(block => ({
            blockId: String(block?.blockId || block?.id || '').slice(0, 160),
            markdown: String(block?.markdown || block?.content || '').slice(0, 65536)
          })).filter(block => block.blockId && block.markdown);
        try {
          receipt = shared.normalizeArticleChatWebGroundingReceipt(value.webGrounding, {
            providerId: String(route.providerId || '').slice(0, 80),
            model: String(route.model || value.model || '').slice(0, 200),
            turnId: String(value.turnId || '').slice(0, 160),
            operationId: String(webSearch.completedOperationId || '').slice(0, 100),
            question: String(value.question || '').slice(0, 4000),
            answer: answerBlocks.map(block => block.markdown).join('\n\n'),
            answerBlocks
          });
        } catch (_) {
          receipt = null;
        }
      }
      for (const key of [
        'providerResponse', 'providerResponseId', 'rawResponse', 'searchQueries',
        'webQueries', 'webSources', 'webCitations'
      ]) delete value[key];
      if (receipt) {
        value.route = {
          ...(isPlainObject(value.route) ? value.route : {}),
          providerId: receipt.grounding.providerId,
          model: receipt.grounding.model
        };
        value.webSearch = {
          enabled: true,
          searched: true,
          completedOperationId: receipt.binding.operationId
        };
        value.webGrounding = receipt;
      } else if (webSearchEnabled) {
        const claimedAnswer = (Array.isArray(value.answerBlocks) &&
          value.answerBlocks.length > 0) || Boolean(String(value.summary || '').trim()) ||
          webSearch.searched === true ||
          ['completed', 'truncated', 'incomplete'].includes(String(value.status || ''));
        value.webSearch = {
          enabled: true,
          searched: false,
          completedOperationId: ''
        };
        value.webGrounding = null;
        if (isPlainObject(value.route)) delete value.route.providerId;
        if (claimedAnswer && !answerUnverified) {
          value.answerBlocks = [];
          value.summary = '';
          value.status = 'error';
          value.errorCode = 'WEB_SEARCH_GROUNDING_MISSING';
          value.error = '联网回答缺少可验证的来源凭据，已隐藏该回答，请重新生成。';
        }
      } else {
        delete value.webGrounding;
        if (isPlainObject(value.webSearch)) {
          value.webSearch = {
            enabled: false,
            searched: false,
            completedOperationId: ''
          };
        }
      }
      return value;
    }

    async function pageAllWorkspaceTurns(workspaceId) {
      if (typeof articleWorkspaceStore?.pageTurns !== 'function') return [];
      const turns = [];
      let afterSequence = 0;
      while (true) {
        const page = await articleWorkspaceStore.pageTurns(workspaceId, {
          limit: 1000, afterSequence
        });
        turns.push(...(page.items || []));
        if (!page.hasMore || Number(page.nextSequence) <= afterSequence) break;
        afterSequence = Number(page.nextSequence);
      }
      return turns;
    }

    function chatIndexWithTurns(indexInput, turnsInput, { authoritative = false } = {}) {
      const index = isPlainObject(indexInput) ? cloneJsonLike(indexInput) : {};
      const turnsById = new Map();
      if (!authoritative) {
        (Array.isArray(index.turns) ? index.turns : []).forEach(turn => {
          const turnId = String(turn?.turnId || '');
          if (turnId) turnsById.set(turnId, cloneJsonLike(turn));
        });
      }
      (Array.isArray(turnsInput) ? turnsInput : []).forEach(turn => {
        const turnId = String(turn?.turnId || '');
        if (turnId) turnsById.set(turnId, publicStoredArticleChatTurn(turn));
      });
      const turns = [...turnsById.values()].sort((left, right) =>
        Number(left.sequence || 0) - Number(right.sequence || 0) ||
        Number(left.createdAt || 0) - Number(right.createdAt || 0) ||
        String(left.turnId || '').localeCompare(String(right.turnId || ''))
      );
      return {
        ...index,
        turns,
        totalTurns: turns.length,
        returnedTurns: turns.length,
        windowStart: 0,
        hasEarlier: false
      };
    }

    function safeWorkspaceCounts(summary = {}) {
      const count = value => Math.max(0, Number(value) || 0);
      return {
        assetCount: count(summary.assetCount),
        chatTurnCount: count(summary.chatTurnCount || summary.turnCount),
        figureCount: count(summary.figureCount),
        panelCount: count(summary.panelCount),
        highlightCount: count(summary.highlightCount),
        annotationCount: count(summary.annotationCount),
        estimatedBytes: count(summary.assetBytes) + count(summary.turnBytes)
      };
    }

    function workspaceDoi(workspace = {}) {
      return String((Array.isArray(workspace.aliases) ? workspace.aliases : [])
        .find(alias => alias?.type === 'doi')?.value || '');
    }

    function publicWorkspaceOverview(workspace, manifest = null, syncStatus = {}) {
      const counts = safeWorkspaceCounts(workspace?.summary);
      let site = '';
      try { site = new URL(workspace.canonicalUrl).hostname; } catch (_) {}
      const conflictMatches = Boolean(syncStatus.lastConflict && workspace.directoryName &&
        JSON.stringify(syncStatus.lastConflict).includes(workspace.directoryName));
      let syncState = 'local-only';
      if (workspace.deletionPending) syncState = 'deleting';
      else if (conflictMatches) syncState = 'conflict';
      else if (manifest && manifest.contentHash !== workspace.contentHash) {
        syncState = 'content-changed';
      } else if (manifest && manifest.contentHash === workspace.contentHash) {
        syncState = Number(manifest.revision || 0) >= Number(workspace.storageRevision || 0)
          ? 'synced' : 'pending';
      } else if (syncStatus.permission === 'granted') syncState = 'pending';
      return {
        schemaVersion: 1,
        workspaceId: String(workspace.workspaceId || ''),
        canonicalUrl: String(workspace.canonicalUrl || ''),
        doi: workspaceDoi(workspace),
        site,
        title: String(workspace.title || ''),
        contentHash: String(workspace.contentHash || ''),
        workspaceGeneration: Number(workspace.workspaceGeneration) || 1,
        createdAt: String(workspace.createdAt || ''),
        lastAccessedAt: String(workspace.lastAccessedAt || workspace.updatedAt || ''),
        updatedAt: String(workspace.updatedAt || ''),
        syncState,
        deletionPending: Boolean(workspace.deletionPending),
        ...counts
      };
    }

    function jsonByteSize(value) {
      try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch (_) { return 0; }
    }

    function detailFromWorkspaceAssets(workspace, assets, turns) {
      const byPath = new Map((Array.isArray(assets) ? assets : [])
        .map(asset => [String(asset.relativePath || ''), asset.content]));
      const chat = byPath.get('chat/index.json');
      const figuresAsset = byPath.get('figures/inventory.json');
      const highlightAsset = byPath.get('annotations/highlights.json');
      const hasOfflineSnapshot = typeof byPath.get('article/offline-snapshot.html') === 'string';
      const figures = Array.isArray(figuresAsset?.figures) ? figuresAsset.figures : [];
      const panelCount = figures.reduce((total, figure) => {
        const panels = new Set();
        (Array.isArray(figure?.panelHints) ? figure.panelHints : []).forEach(panel =>
          panels.add(String(panel?.panelId || panel?.panel || panel || '')));
        Object.keys(figure?.panelAnalyses || {}).forEach(panel => panels.add(String(panel)));
        Object.keys(figure?.panelFollowups || {}).forEach(panel => panels.add(String(panel)));
        return total + [...panels].filter(Boolean).length;
      }, 0);
      const storedTurns = Array.isArray(turns) ? turns : [];
      return {
        workspaceId: String(workspace.workspaceId || ''),
        chatTurnCount: Array.isArray(chat?.turns) ? chat.turns.length : storedTurns.length,
        figureCount: figures.length,
        panelCount,
        highlightCount: Math.max(0,
          Number(highlightAsset?.highlightDistribution?.totalHighlights) || 0),
        annotationCount: Array.isArray(highlightAsset?.annotations)
          ? highlightAsset.annotations.length : 0,
        hasOfflineSnapshot,
        assetCount: Array.isArray(assets) ? assets.length : 0,
        estimatedBytes: (Array.isArray(assets) ? assets : []).reduce((sum, asset) =>
          sum + (Number(asset.byteSize) || jsonByteSize(asset.content)), 0) +
          storedTurns.reduce((sum, turn) => sum + jsonByteSize(turn), 0)
      };
    }

    async function handleUnsafe(message, context = {}) {
      if (message.type === 'LLM_ADVANCE_FIGURE_WORKSPACE_LIFECYCLE') {
        const ownerScope = trustedFigureScope(message, context, { requireModern: true });
        const result = await durableFigureProviderAttemptLedger.advanceWorkspaceLifecycle({
          ownerScope, previousWorkspaceLifecycle: message.previousWorkspaceLifecycle
        });
        detachRetiredFigureOperations(result?.removedOperationIds);
        return { workspaceLifecycle: result.workspaceLifecycle };
      }
      if (message.type === 'LITERATURE_NOTE_COMMIT_DELTA') {
        return commitLiteratureNoteDelta(message, context);
      }
      if (message.type === 'LLM_CONTROL_OPERATION') {
        const operationId = shared.normalizeOperationId?.(message.operationId) || '';
        const command = String(message.command || 'status');
        const explicitMechanismScope = message?.operationScope === 'mechanism';
        const baseControlCommand = [
          'pause', 'resume', 'cancel', 'release', 'status'
        ].includes(command);
        if (!operationId || (!baseControlCommand &&
            !(explicitMechanismScope && command === 'abandon'))) {
          throw invalidSettings(['operationId', 'command']);
        }
        const explicitFigureScope = message?.operationScope === 'figure';
        if (explicitFigureScope) {
          const figureIdentity = await figureOperationIdentity(message, context, {
            requireModern: true
          });
          const figureOperationId = String(figureIdentity.internalOperationId || '');
          const figureBudget = figureProviderAttemptBudgets.get(figureOperationId);
          const registryWasActive = operationRegistry?.isActive?.(figureOperationId) === true;
          const durableCommand = ['cancel', 'release', 'status'].includes(command)
            ? command : 'status';
          // Durable owner authorization is the first stateful step.  In
          // particular, an untrusted/wrong-owner control or a failed ledger
          // write must never abort the registry operation, stop its budget, or
          // install a pending control before the durable owner check succeeds.
          const durableResult = await durableFigureProviderAttemptLedger.controlOperation(
            {
              operationId: figureOperationId,
              publicOperationId: figureIdentity.publicOperationId,
              ownerScope: figureIdentity.scope
            }, durableCommand
          );
          const registryResult = registryWasActive
            ? (operationRegistry?.control(figureOperationId, command) || {
                active: false, paused: false, cancelled: false
              })
            : { active: false, paused: false, cancelled: false };
          if (command === 'cancel' && figureBudget) {
            stopFigureProviderAttemptBudget(figureBudget, 'CANCELLED');
          }
          if (['cancel', 'release'].includes(command) &&
              durableResult?.cleanupComplete === true) {
            releaseFigureOperationContracts(figureOperationId);
          }
          return {
            ...registryResult,
            ...(durableResult || {}),
            cancelled: Boolean(
              registryResult?.cancelled || durableResult?.cancelled ||
              (command === 'cancel' && registryWasActive)
            ),
            released: Boolean(
              durableResult?.released
            ),
            operationId
          };
        }
        const mechanismIntent = explicitMechanismScope || operationId.startsWith('mechanism:');
        if (explicitMechanismScope) {
          if (!operationId.startsWith('mechanism:') || !mechanismCoordinator?.controlOwned) {
            throw invalidSettings(['operationScope', 'operationId']);
          }
          const identity = evidenceFirstRequestIdentity(message);
          if (!identity || identity.operationId !== operationId) {
            throw invalidSettings(['operationId']);
          }
          const senderScope = trustedEvidenceSenderScope(identity, context);
          return mechanismCoordinator.controlOwned({
            operationId,
            documentId: identity.documentId,
            workspaceId: identity.workspaceId,
            workspaceGeneration: identity.workspaceGeneration,
            workspaceLifecycle: identity.workspaceLifecycle,
            mechanismChainFingerprint: identity.mechanismChainFingerprint,
            senderExtensionId: senderScope.senderExtensionId,
            senderTabId: senderScope.senderTabId,
            senderFrameId: senderScope.senderFrameId,
            senderDocumentId: senderScope.senderDocumentId
          }, command);
        }
        if (mechanismIntent && String(runtimeExtensionId || '')) {
          // Production mechanism controls are capabilities bound to the
          // originating content document. Public operation ids alone disclose
          // no status and control no registry entry.
          throw invalidSettings(['operationScope']);
        }
        // Internal Figure keys are never public control capabilities. In
        // particular, an extension page without the originating tab/frame/
        // document tuple must not fall through to the generic registry path.
        // This check is synchronous so non-Figure cancellation ordering is
        // unchanged by WebCrypto work.
        if (/^figure:[a-f0-9]{64}$/u.test(operationId)) {
          throw invalidSettings(['operationScope']);
        }
        const mechanismOperation = mechanismOperations.get(operationId);
        if (command === 'status' && mechanismCoordinator?.status) {
          const durableStatus = await mechanismCoordinator.status(operationId);
          if (durableStatus) return durableStatus;
        }
        if (mechanismOperation && mechanismCoordinator) {
          if (command === 'status') {
            try {
              mechanismCoordinator.assertActive(mechanismOperation);
              return {
                operationId, epoch: mechanismOperation.epoch,
                active: true, paused: false, cancelled: false
              };
            } catch (error) {
              return {
                operationId, epoch: mechanismOperation.epoch,
                active: false, paused: false,
                cancelled: error?.code === 'MECHANISM_OPERATION_CANCELLED'
              };
            }
          }
          return await mechanismCoordinator.control(mechanismOperation, command);
        }
        const controlResult = operationRegistry?.control(operationId, command) || {
          operationId, active: false, paused: false, cancelled: false
        };
        return controlResult;
      }

      if (message.type === 'MIGRATION_EXPORT') {
        const [settings, documents, feedbackSamples] = await Promise.all([
          shared.loadSettings(storageArea),
          documentStore.exportAll(),
          corpusStore.list()
        ]);
        return shared.createMigrationBundle({
          exportedAt: new Date().toISOString(),
          extensionVersion: String(message.extensionVersion || ''),
          settings,
          documents,
          feedbackSamples
        });
      }

      if (message.type === 'MIGRATION_IMPORT') {
        const bundle = shared.validateMigrationBundle(message.bundle);
        return serializeAllMutations(async () => {
          invalidateDocumentCreationReceipts();
          const settings = await shared.saveSettings(storageArea, bundle.settings);
          let importedDocuments = 0;
          for (const record of bundle.documents.documents) {
            await documentStore.putDocument(record);
            importedDocuments += 1;
          }
          let importedFeedback = 0;
          for (const sample of bundle.feedbackSamples) {
            await corpusStore.add(sample);
            importedFeedback += 1;
          }
          await mirrorCategorySettings(settings);
          for (const record of bundle.documents.documents) {
            await mirrorDocumentRecord(record);
          }
          return {
            imported: true,
            importedDocuments,
            importedFeedback,
            settings: shared.toPublicSettings(settings),
            directoryHandleRestored: false
          };
        });
      }

      if (message.type === 'ARTICLE_WORKSPACE_ENSURE') {
        requireArticleWorkspaceStore('ensureWorkspace');
        const workspace = await articleWorkspaceStore.ensureWorkspace(message.workspace, {
          expectedRevision: message.expectedRevision,
          expectedContentHash: message.expectedContentHash
        });
        return { workspace: publicWorkspace(workspace) };
      }

      if (message.type === 'ARTICLE_WORKSPACE_SAVE_SUPPLEMENTAL_DRAFT') {
        return saveClosedTabSupplementalDraft(message);
      }

      if (message.type === 'ARTICLE_WORKSPACE_MIRROR_ALL') {
        requireArticleWorkspaceStore('getWorkspace');
        requireArticleWorkspaceStore('listAssets');
        requireArticleWorkspaceStore('pageTurns');
        requireDirectorySync('listWorkspaceManifests');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace || workspace.deletionPending) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        assertWorkspaceMutationGeneration(workspace, message);
        const overview = await directorySync.listWorkspaceManifests(workspace);
        if (overview.permission !== 'granted') {
          return {
            mirrored: false,
            permission: overview.permission,
            queued: 0,
            unchanged: 0
          };
        }
        const existingManifest = (overview.matches || [])
          .map(match => match?.manifest)
          .find(manifest => manifest?.workspaceId === workspace.workspaceId &&
            Number(manifest?.workspaceGeneration || 1) ===
              Number(workspace.workspaceGeneration || 1)) || null;
        const existingByPath = new Map((existingManifest?.assets || []).map(asset => [
          String(asset.path || ''), asset
        ]));
        let queued = 0;
        let unchanged = 0;
        const enqueue = async (path, content, metadata) => {
          const existing = existingByPath.get(path);
          const hashMatches = metadata.contentHash && existing?.contentHash &&
            String(metadata.contentHash) === String(existing.contentHash);
          const revisionMatches = !metadata.contentHash && existing &&
            Number(existing.revision || 0) === Number(metadata.revision || 0) &&
            String(existing.updatedAt || '') === String(metadata.updatedAt || '');
          if (hashMatches || revisionMatches) {
            unchanged += 1;
            return;
          }
          await directorySync.enqueueWorkspaceAsset(workspace, path, content, {
            ...metadata,
            advanceFromDirectory: true,
            workspaceGeneration: workspace.workspaceGeneration
          });
          queued += 1;
        };
        for (const asset of publicWorkspaceAssets(
          await articleWorkspaceStore.listAssets(workspace.workspaceId)
        )) {
          await enqueue(String(asset.relativePath), asset.content, {
            revision: asset.revision,
            contentHash: asset.contentHash,
            updatedAt: asset.updatedAt
          });
        }
        let afterSequence = 0;
        while (true) {
          const page = await articleWorkspaceStore.pageTurns(workspace.workspaceId, {
            limit: 1000,
            afterSequence
          });
          for (const turn of page.items || []) {
            const filename = encodeURIComponent(turn.turnId).slice(0, 240);
            await enqueue(`chat/turns/${filename}.json`, turn, {
              revision: turn.revision,
              updatedAt: turn.updatedAt
            });
          }
          if (!page.hasMore || Number(page.nextSequence) <= afterSequence) break;
          afterSequence = Number(page.nextSequence);
        }
        return {
          mirrored: true,
          permission: overview.permission,
          queued,
          unchanged
        };
      }
      if (message.type === 'ARTICLE_WORKSPACE_SAVE_ASSET') {
        requireArticleWorkspaceStore('putAsset');
        requireArticleWorkspaceStore('getWorkspace');
        const target = supplementalAssetWorkspaceTarget(message);
        const workspace = await articleWorkspaceStore.getWorkspace(
          target?.workspaceId || message.workspaceId
        );
        if (!workspace || workspace.deletionPending) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        assertWorkspaceMutationGeneration(workspace, message);
        if (target) assertSupplementalDraftWorkspaceTarget(workspace, target);
        let content = message.content;
        if (String(message.relativePath || '') === 'chat/index.json' &&
            typeof articleWorkspaceStore?.pageTurns === 'function') {
          content = chatIndexWithTurns(
            message.content,
            await pageAllWorkspaceTurns(workspace.workspaceId)
          );
        }
        const commitGuardId = String(message.commitGuardId || '');
        if (commitGuardId) {
          if (!/^figure-retry-guard-[a-z0-9-]{8,100}$/iu.test(commitGuardId) ||
              message.commitGuardKind !== 'figure_retry' ||
              typeof context.onWorkspaceCommitGuard !== 'function') {
            const error = new Error('FIGURE_COMMIT_GUARD_UNAVAILABLE');
            error.code = 'FIGURE_COMMIT_GUARD_UNAVAILABLE';
            throw error;
          }
          const guard = await context.onWorkspaceCommitGuard({
            commitGuardId,
            commitGuardKind: 'figure_retry',
            workspaceId: workspace.workspaceId,
            workspaceGeneration: Number(workspace.workspaceGeneration) || 1,
            relativePath: String(message.relativePath || '')
          });
          if (guard?.success !== true) {
            const code = guard?.code === 'FIGURE_PANEL_RETRY_SCOPE_STALE'
              ? guard.code : 'FIGURE_COMMIT_GUARD_UNAVAILABLE';
            const error = new Error(code);
            error.code = code;
            throw error;
          }
          requireArticleWorkspaceStore('getAsset');
          const relativePath = shared.normalizeWorkspaceRelativePath(message.relativePath);
          if (isFigureRetryStagingPath(relativePath)) {
            const error = new Error('FIGURE_COMMIT_GUARD_UNAVAILABLE');
            error.code = 'FIGURE_COMMIT_GUARD_UNAVAILABLE';
            throw error;
          }
          const projectedWriteToken = String(message.writeToken || '').slice(0, 160);
          if (projectedWriteToken) {
            requireArticleWorkspaceStore('listAssets');
            requireArticleWorkspaceStore('reconcileFigureRetryWrite');
            const snapshot = figureRetryWriteSnapshot(
              await articleWorkspaceStore.listAssets(workspace.workspaceId),
              relativePath
            );
            if (!snapshot.rawAsset || !snapshot.projectedAsset ||
                !snapshot.writeToken || snapshot.writeToken !== projectedWriteToken) {
              const error = new Error('ASSET_REVISION_CONFLICT');
              error.code = 'ASSET_REVISION_CONFLICT';
              throw error;
            }
            if (message.expectedRevision !== undefined &&
                Number(snapshot.projectedAsset.revision || 0) !==
                  Number(message.expectedRevision)) {
              const error = new Error('ASSET_REVISION_CONFLICT');
              error.code = 'ASSET_REVISION_CONFLICT';
              throw error;
            }
            if (message.expectedContentHash !== undefined &&
                String(snapshot.projectedAsset.contentHash || '') !==
                  String(message.expectedContentHash || '')) {
              const error = new Error('ASSET_HASH_CONFLICT');
              error.code = 'ASSET_HASH_CONFLICT';
              throw error;
            }
            const stagingPath = figureRetryStagingPath(commitGuardId);
            const reconciled = await articleWorkspaceStore.reconcileFigureRetryWrite(
              workspace.workspaceId, relativePath, snapshot.projectedAsset.content, {
                expectedRawRevision: Number(snapshot.rawAsset.revision || 0),
                expectedRawContentHash: String(snapshot.rawAsset.contentHash || ''),
                pendingStages: snapshot.pendingStages.map(asset => ({
                  relativePath: String(asset.relativePath || ''),
                  revision: Number(asset.revision || 0),
                  contentHash: String(asset.contentHash || '')
                })),
                stage: {
                  relativePath: stagingPath,
                  candidateContent: cloneJsonLike(content),
                  candidateContentHash: String(message.contentHash || '')
                }
              }
            );
            const staged = reconciled?.staged;
            if (!staged) {
              const error = new Error('FIGURE_CHECKPOINT_PERSIST_FAILED');
              error.code = 'FIGURE_CHECKPOINT_PERSIST_FAILED';
              throw error;
            }
            return {
              staged: true,
              stagingPath,
              stagingRevision: staged.revision,
              stagingContentHash: staged.contentHash
            };
          }
          const baseAsset = await articleWorkspaceStore.getAsset(
            workspace.workspaceId, relativePath
          );
          const baseRevision = Number(baseAsset?.revision || 0);
          const baseContentHash = String(baseAsset?.contentHash || '');
          if (message.expectedRevision !== undefined &&
              baseRevision !== Number(message.expectedRevision)) {
            const error = new Error('ASSET_REVISION_CONFLICT');
            error.code = 'ASSET_REVISION_CONFLICT';
            throw error;
          }
          if (message.expectedContentHash !== undefined &&
              baseContentHash !== String(message.expectedContentHash || '')) {
            const error = new Error('ASSET_HASH_CONFLICT');
            error.code = 'ASSET_HASH_CONFLICT';
            throw error;
          }
          const stagingPath = figureRetryStagingPath(commitGuardId);
          const staged = await articleWorkspaceStore.putAsset(
            workspace.workspaceId, stagingPath, {
              schemaVersion: 1,
              kind: 'figure_retry_candidate',
              status: 'pending_confirmation',
              target: { relativePath },
              base: {
                revision: baseRevision,
                contentHash: baseContentHash,
                byteSize: Math.max(0, Number(baseAsset?.byteSize) ||
                  jsonLikeByteSize(baseAsset?.content ?? null)),
                updatedAt: String(baseAsset?.updatedAt || ''),
                content: cloneJsonLike(baseAsset?.content ?? null)
              },
              candidate: {
                content: cloneJsonLike(content),
                contentHash: String(message.contentHash || '')
              }
            }, { createOnly: true }
          );
          return {
            staged: true,
            stagingPath,
            stagingRevision: staged.revision,
            stagingContentHash: staged.contentHash
          };
        }
        const projectedWriteToken = String(message.writeToken || '').slice(0, 160);
        let asset;
        if (projectedWriteToken) {
          requireArticleWorkspaceStore('listAssets');
          requireArticleWorkspaceStore('reconcileFigureRetryWrite');
          const relativePath = shared.normalizeWorkspaceRelativePath(message.relativePath);
          const snapshot = figureRetryWriteSnapshot(
            await articleWorkspaceStore.listAssets(workspace.workspaceId), relativePath
          );
          if (!snapshot.rawAsset || !snapshot.projectedAsset ||
              !snapshot.writeToken || snapshot.writeToken !== projectedWriteToken) {
            const error = new Error('ASSET_REVISION_CONFLICT');
            error.code = 'ASSET_REVISION_CONFLICT';
            throw error;
          }
          if (message.expectedRevision !== undefined &&
              Number(snapshot.projectedAsset.revision || 0) !==
                Number(message.expectedRevision)) {
            const error = new Error('ASSET_REVISION_CONFLICT');
            error.code = 'ASSET_REVISION_CONFLICT';
            throw error;
          }
          if (message.expectedContentHash !== undefined &&
              String(snapshot.projectedAsset.contentHash || '') !==
                String(message.expectedContentHash || '')) {
            const error = new Error('ASSET_HASH_CONFLICT');
            error.code = 'ASSET_HASH_CONFLICT';
            throw error;
          }
          const reconciled = await articleWorkspaceStore.reconcileFigureRetryWrite(
            workspace.workspaceId, relativePath, content, {
              expectedRawRevision: Number(snapshot.rawAsset.revision || 0),
              expectedRawContentHash: String(snapshot.rawAsset.contentHash || ''),
              pendingStages: snapshot.pendingStages.map(candidate => ({
                relativePath: String(candidate.relativePath || ''),
                revision: Number(candidate.revision || 0),
                contentHash: String(candidate.contentHash || '')
              })),
              contentHash: String(message.contentHash || '')
            }
          );
          asset = reconciled?.asset;
        } else {
          asset = await articleWorkspaceStore.putAsset(
            workspace.workspaceId, message.relativePath, content, {
              expectedWorkspaceGeneration: Number(workspace.workspaceGeneration || 1),
              expectedRevision: message.expectedRevision,
              expectedContentHash: message.expectedContentHash,
              contentHash: message.contentHash,
              createOnly: message.createOnly === true
            }
          );
        }
        const directory = await mirrorWorkspaceAssetToDirectory(workspace, asset, {
          verify: message.requireDirectoryPersistence === true
        });
        return {
          saved: true,
          queued: directory.queued,
          directoryPersisted: directory.directoryPersisted,
          directoryPermission: directory.directoryPermission,
          directoryErrorCode: directory.directoryErrorCode,
          asset: {
            relativePath: asset.relativePath,
            revision: asset.revision,
            contentHash: asset.contentHash,
            byteSize: asset.byteSize,
            updatedAt: asset.updatedAt
          }
        };
      }

      if (message.type === 'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET') {
        requireArticleWorkspaceStore('getWorkspace');
        requireArticleWorkspaceStore('getAsset');
        requireArticleWorkspaceStore('putAsset');
        requireArticleWorkspaceStore('deleteAsset');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace || workspace.deletionPending) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        assertWorkspaceMutationGeneration(workspace, message);
        const relativePath = shared.normalizeWorkspaceRelativePath(message.relativePath);
        const stagingPath = shared.normalizeWorkspaceRelativePath(message.stagingPath);
        const commitGuardId = String(message.commitGuardId || '');
        if (stagingPath !== figureRetryStagingPath(
          String(stagingPath.slice(FIGURE_RETRY_STAGING_PREFIX.length, -5))
        ) || !commitGuardId || message.commitGuardKind !== 'figure_retry' ||
            typeof context.onWorkspaceCommitGuard !== 'function') {
          const error = new Error('FIGURE_COMMIT_GUARD_UNAVAILABLE');
          error.code = 'FIGURE_COMMIT_GUARD_UNAVAILABLE';
          throw error;
        }
        const guard = await context.onWorkspaceCommitGuard({
          commitGuardId,
          commitGuardKind: 'figure_retry',
          workspaceId: workspace.workspaceId,
          workspaceGeneration: Number(workspace.workspaceGeneration) || 1,
          relativePath,
          stagingPath
        });
        if (guard?.success !== true) {
          const code = guard?.code === 'FIGURE_PANEL_RETRY_SCOPE_STALE'
            ? guard.code : 'FIGURE_COMMIT_GUARD_UNAVAILABLE';
          const error = new Error(code);
          error.code = code;
          throw error;
        }
        const staged = await articleWorkspaceStore.getAsset(
          workspace.workspaceId, stagingPath
        );
        const record = staged?.content;
        if (!staged || Number(staged.revision) !== Number(message.stagingRevision) ||
            String(staged.contentHash || '') !== String(message.stagingContentHash || '') ||
            record?.kind !== 'figure_retry_candidate' ||
            record?.status !== 'pending_confirmation' ||
            String(record?.target?.relativePath || '') !== relativePath ||
            !isPlainObject(record?.candidate) || !isPlainObject(record?.base)) {
          const error = new Error('FIGURE_PANEL_RETRY_SCOPE_STALE');
          error.code = 'FIGURE_PANEL_RETRY_SCOPE_STALE';
          throw error;
        }
        let asset;
        try {
          asset = await articleWorkspaceStore.putAsset(
            workspace.workspaceId, relativePath, record.candidate.content, {
              expectedRevision: Number(record.base.revision || 0),
              expectedContentHash: String(record.base.contentHash || ''),
              requiredStaging: {
                relativePath: stagingPath,
                revision: staged.revision,
                contentHash: staged.contentHash
              },
              summaryContent: cloneJsonLike(record.base.content),
              ...(record.candidate.contentHash
                ? { contentHash: String(record.candidate.contentHash) } : {})
            }
          );
        } catch (error) {
          if (error?.code !== 'ASSET_REVISION_CONFLICT' &&
              error?.code !== 'ASSET_HASH_CONFLICT') throw error;
          const current = await articleWorkspaceStore.getAsset(
            workspace.workspaceId, relativePath
          );
          if (!current) throw error;
          const rebased = rebaseFigureRetryCandidate(
            record.base.content, record.candidate.content, current.content
          );
          const authoritativeProjection = rebaseFigureRetryCandidate(
            record.candidate.content, record.base.content, rebased
          );
          asset = await articleWorkspaceStore.putAsset(
            workspace.workspaceId, relativePath, rebased, {
              expectedRevision: Number(current.revision || 0),
              expectedContentHash: String(current.contentHash || ''),
              requiredStaging: {
                relativePath: stagingPath,
                revision: staged.revision,
                contentHash: staged.contentHash
              },
              summaryContent: authoritativeProjection
            }
          );
        }
        return {
          promoted: true,
          asset: {
            relativePath: asset.relativePath,
            revision: asset.revision,
            contentHash: asset.contentHash,
            byteSize: asset.byteSize,
            updatedAt: asset.updatedAt
          }
        };
      }

      if (message.type === 'ARTICLE_WORKSPACE_FINALIZE_STAGED_ASSET') {
        requireArticleWorkspaceStore('getWorkspace');
        requireArticleWorkspaceStore('getAsset');
        requireArticleWorkspaceStore('deleteAsset');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace || workspace.deletionPending) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        assertWorkspaceMutationGeneration(workspace, message);
        const relativePath = shared.normalizeWorkspaceRelativePath(message.relativePath);
        const stagingPath = shared.normalizeWorkspaceRelativePath(message.stagingPath);
        if (!isFigureRetryStagingPath(stagingPath) ||
            message.commitGuardKind !== 'figure_retry' ||
            typeof context.onWorkspaceCommitGuard !== 'function') {
          const error = new Error('FIGURE_COMMIT_GUARD_UNAVAILABLE');
          error.code = 'FIGURE_COMMIT_GUARD_UNAVAILABLE';
          throw error;
        }
        const guard = await context.onWorkspaceCommitGuard({
          commitGuardId: String(message.commitGuardId || ''),
          commitGuardKind: 'figure_retry',
          workspaceId: workspace.workspaceId,
          workspaceGeneration: Number(workspace.workspaceGeneration) || 1,
          relativePath,
          stagingPath
        });
        if (guard?.success !== true) {
          const code = guard?.code === 'FIGURE_PANEL_RETRY_SCOPE_STALE'
            ? guard.code : 'FIGURE_COMMIT_GUARD_UNAVAILABLE';
          const error = new Error(code);
          error.code = code;
          throw error;
        }
        const [staged, asset] = await Promise.all([
          articleWorkspaceStore.getAsset(workspace.workspaceId, stagingPath),
          articleWorkspaceStore.getAsset(workspace.workspaceId, relativePath)
        ]);
        if (!staged || !asset ||
            Number(staged.revision) !== Number(message.stagingRevision) ||
            String(staged.contentHash || '') !== String(message.stagingContentHash || '') ||
            Number(asset.revision) !== Number(message.promotedRevision) ||
            String(asset.contentHash || '') !== String(message.promotedContentHash || '')) {
          const error = new Error('FIGURE_PANEL_RETRY_SCOPE_STALE');
          error.code = 'FIGURE_PANEL_RETRY_SCOPE_STALE';
          throw error;
        }
        const deleted = await articleWorkspaceStore.deleteAsset(
          workspace.workspaceId, stagingPath, {
            expectedRevision: staged.revision,
            expectedContentHash: staged.contentHash,
            refreshSummaryPath: relativePath,
            deleteRelatedStagingForPath: relativePath,
            relatedAssetExpectedRevision: asset.revision,
            relatedAssetExpectedContentHash: asset.contentHash
          }
        );
        if (deleted?.deleted !== true ||
            Number(deleted.revision) !== Number(staged.revision) ||
            String(deleted.contentHash || '') !== String(staged.contentHash || '')) {
          const error = new Error('FIGURE_PANEL_RETRY_SCOPE_STALE');
          error.code = 'FIGURE_PANEL_RETRY_SCOPE_STALE';
          throw error;
        }
        const directory = await mirrorWorkspaceAssetToDirectory(workspace, asset, {
          verify: message.requireDirectoryPersistence === true
        });
        return {
          confirmed: true,
          saved: true,
          queued: directory.queued,
          directoryPersisted: directory.directoryPersisted,
          directoryPermission: directory.directoryPermission,
          directoryErrorCode: directory.directoryErrorCode,
          asset: {
            relativePath: asset.relativePath,
            revision: asset.revision,
            contentHash: asset.contentHash,
            byteSize: asset.byteSize,
            updatedAt: asset.updatedAt
          }
        };
      }

      if (message.type === 'ARTICLE_WORKSPACE_COMPENSATE_STAGED_ASSET') {
        requireArticleWorkspaceStore('getWorkspace');
        requireArticleWorkspaceStore('getAsset');
        requireArticleWorkspaceStore('putAsset');
        requireArticleWorkspaceStore('deleteAsset');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace || workspace.deletionPending) {
          return { compensated: true, alreadyMissing: true };
        }
        assertWorkspaceMutationGeneration(workspace, message);
        const relativePath = shared.normalizeWorkspaceRelativePath(message.relativePath);
        const stagingPath = shared.normalizeWorkspaceRelativePath(message.stagingPath);
        if (!isFigureRetryStagingPath(stagingPath) ||
            message.commitGuardKind !== 'figure_retry' ||
            typeof context.onWorkspaceCommitGuard !== 'function') {
          const error = new Error('FIGURE_COMMIT_GUARD_UNAVAILABLE');
          error.code = 'FIGURE_COMMIT_GUARD_UNAVAILABLE';
          throw error;
        }
        const guard = await context.onWorkspaceCommitGuard({
          commitGuardId: String(message.commitGuardId || ''),
          commitGuardKind: 'figure_retry',
          workspaceId: workspace.workspaceId,
          workspaceGeneration: Number(workspace.workspaceGeneration) || 1,
          relativePath,
          stagingPath
        });
        if (guard?.success !== true) {
          const code = guard?.code === 'FIGURE_PANEL_RETRY_SCOPE_STALE'
            ? guard.code : 'FIGURE_COMMIT_GUARD_UNAVAILABLE';
          const error = new Error(code);
          error.code = code;
          throw error;
        }
        const staged = isFigureRetryStagingPath(stagingPath)
          ? await articleWorkspaceStore.getAsset(workspace.workspaceId, stagingPath) : null;
        const record = staged?.content;
        if (!staged || record?.kind !== 'figure_retry_candidate' ||
            String(record?.target?.relativePath || '') !== relativePath ||
            Number(staged.revision) !== Number(message.stagingRevision) ||
            String(staged.contentHash || '') !== String(message.stagingContentHash || '')) {
          const error = new Error('FIGURE_PANEL_RETRY_SCOPE_STALE');
          error.code = 'FIGURE_PANEL_RETRY_SCOPE_STALE';
          throw error;
        }
        const compensate = current => rebaseFigureRetryCandidate(
          record.candidate.content, record.base.content, current.content
        );
        let current = await articleWorkspaceStore.getAsset(
          workspace.workspaceId, relativePath
        );
        let rollbackAsset = null;
        if (current) {
          try {
            rollbackAsset = await articleWorkspaceStore.putAsset(
              workspace.workspaceId, relativePath, compensate(current), {
                expectedRevision: Number(message.promotedRevision || current.revision),
                expectedContentHash: String(
                  message.promotedContentHash || current.contentHash || ''
                )
              }
            );
          } catch (error) {
            if (error?.code !== 'ASSET_REVISION_CONFLICT' &&
                error?.code !== 'ASSET_HASH_CONFLICT') throw error;
            current = await articleWorkspaceStore.getAsset(
              workspace.workspaceId, relativePath
            );
            if (!current) throw error;
            rollbackAsset = await articleWorkspaceStore.putAsset(
              workspace.workspaceId, relativePath, compensate(current), {
                expectedRevision: Number(current.revision || 0),
                expectedContentHash: String(current.contentHash || '')
              }
            );
          }
        }
        const deleted = await articleWorkspaceStore.deleteAsset(
          workspace.workspaceId, stagingPath, {
            expectedRevision: staged.revision,
            expectedContentHash: staged.contentHash
          }
        );
        if (deleted?.deleted !== true ||
            Number(deleted.revision) !== Number(staged.revision) ||
            String(deleted.contentHash || '') !== String(staged.contentHash || '')) {
          const error = new Error('FIGURE_PANEL_RETRY_SCOPE_STALE');
          error.code = 'FIGURE_PANEL_RETRY_SCOPE_STALE';
          throw error;
        }
        let privateRollback = { requiresReload: true };
        if (rollbackAsset) {
          const content = cloneJsonLike(rollbackAsset.content);
          let serializedLength = Number.POSITIVE_INFINITY;
          try { serializedLength = JSON.stringify(content).length; } catch (_) {}
          const contentIsBounded = serializedLength > 0 && serializedLength <=
            Math.max(1, Number(shared.FIGURE_WORKSPACE_MAX_SERIALIZED_CHARS) || 1_000_000);
          const fingerprint = contentIsBounded
            ? workspaceContentFingerprint(content) : '';
          if (fingerprint && fingerprint === String(rollbackAsset.contentHash || '')) {
            privateRollback = { content };
          }
        }
        return {
          compensated: true,
          ...(rollbackAsset ? { asset: {
            relativePath: rollbackAsset.relativePath,
            revision: rollbackAsset.revision,
            contentHash: rollbackAsset.contentHash,
            byteSize: rollbackAsset.byteSize,
            updatedAt: rollbackAsset.updatedAt,
            ...privateRollback
          } } : {})
        };
      }

      if (message.type === 'ARTICLE_WORKSPACE_ABORT_STAGED_ASSET') {
        requireArticleWorkspaceStore('getWorkspace');
        requireArticleWorkspaceStore('deleteAsset');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace || workspace.deletionPending) {
          return { aborted: true, alreadyMissing: true };
        }
        assertWorkspaceMutationGeneration(workspace, message);
        const relativePath = shared.normalizeWorkspaceRelativePath(message.relativePath);
        const stagingPath = shared.normalizeWorkspaceRelativePath(message.stagingPath);
        if (!isFigureRetryStagingPath(stagingPath) ||
            message.commitGuardKind !== 'figure_retry' ||
            typeof context.onWorkspaceCommitGuard !== 'function') {
          const error = new Error('FIGURE_COMMIT_GUARD_UNAVAILABLE');
          error.code = 'FIGURE_COMMIT_GUARD_UNAVAILABLE';
          throw error;
        }
        const guard = await context.onWorkspaceCommitGuard({
          commitGuardId: String(message.commitGuardId || ''),
          commitGuardKind: 'figure_retry',
          workspaceId: workspace.workspaceId,
          workspaceGeneration: Number(workspace.workspaceGeneration) || 1,
          relativePath,
          stagingPath
        });
        if (guard?.success !== true) {
          const code = guard?.code === 'FIGURE_PANEL_RETRY_SCOPE_STALE'
            ? guard.code : 'FIGURE_COMMIT_GUARD_UNAVAILABLE';
          const error = new Error(code);
          error.code = code;
          throw error;
        }
        const deleted = await articleWorkspaceStore.deleteAsset(
          workspace.workspaceId, stagingPath, {
            expectedRevision: message.stagingRevision,
            expectedContentHash: message.stagingContentHash
          }
        );
        return { aborted: true, alreadyMissing: deleted?.alreadyMissing === true };
      }

      if (message.type === 'ARTICLE_WORKSPACE_SAVE_TURN') {
        requireArticleWorkspaceStore('appendTurn');
        requireArticleWorkspaceStore('getWorkspace');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace || workspace.deletionPending) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        assertWorkspaceMutationGeneration(workspace, message);
        const turn = await articleWorkspaceStore.appendTurn(
          workspace.workspaceId, publicStoredArticleChatTurn(message.turn)
        );
        let queued = false;
        if (typeof directorySync?.enqueueWorkspaceAsset === 'function') {
          const filename = encodeURIComponent(turn.turnId).slice(0, 240);
          try {
            await directorySync.enqueueWorkspaceAsset(
              workspace, `chat/turns/${filename}.json`, turn, {
                revision: turn.revision,
                updatedAt: turn.updatedAt,
                advanceFromDirectory: true,
                workspaceGeneration: workspace.workspaceGeneration
              }
            );
            queued = true;
            scheduleDirectoryFlush();
          } catch (_) {}
        }
        return {
          saved: true,
          queued,
          turn: cloneJsonLike(turn)
        };
      }

      if (message.type === 'ARTICLE_WORKSPACE_UPDATE_TURN') {
        requireArticleWorkspaceStore('updateTurn');
        requireArticleWorkspaceStore('getWorkspace');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace || workspace.deletionPending) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        assertWorkspaceMutationGeneration(workspace, message);
        let turn;
        let recreated = false;
        try {
          turn = await articleWorkspaceStore.updateTurn(
            workspace.workspaceId, message.turnId,
            publicStoredArticleChatTurn(message.turn || {})
          );
        } catch (error) {
          if (error?.code !== 'TURN_NOT_FOUND' ||
              typeof articleWorkspaceStore?.appendTurn !== 'function') {
            throw error;
          }
          // A directory restore can populate the page before an older browser
          // database contains the independent turn record. Treat update as an
          // idempotent upsert so an explicit “保存全部” never fails merely
          // because its aggregate chat index and turn store drifted apart.
          turn = await articleWorkspaceStore.appendTurn(
            workspace.workspaceId, publicStoredArticleChatTurn(message.turn || {})
          );
          recreated = true;
        }
        let queued = false;
        if (typeof directorySync?.enqueueWorkspaceAsset === 'function') {
          const filename = encodeURIComponent(turn.turnId).slice(0, 240);
          try {
            await directorySync.enqueueWorkspaceAsset(
              workspace, `chat/turns/${filename}.json`, turn, {
                revision: turn.revision,
                updatedAt: turn.updatedAt,
                advanceFromDirectory: true,
                workspaceGeneration: workspace.workspaceGeneration
              }
            );
            queued = true;
            scheduleDirectoryFlush();
          } catch (_) {}
        }
        return { saved: true, queued, recreated, turn: cloneJsonLike(turn) };
      }

      if (message.type === 'ARTICLE_WORKSPACE_DELETE_TURN') {
        requireArticleWorkspaceStore('deleteTurn');
        requireArticleWorkspaceStore('getWorkspace');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace || workspace.deletionPending) {
          return { deleted: true, alreadyMissing: true };
        }
        assertWorkspaceMutationGeneration(workspace, message);
        const tombstone = await articleWorkspaceStore.deleteTurn(
          workspace.workspaceId, message.turnId
        );
        if (typeof directorySync?.enqueueWorkspaceAsset === 'function') {
          const filename = encodeURIComponent(String(message.turnId || '')).slice(0, 240);
          try {
            await directorySync.enqueueWorkspaceAsset(
              workspace, `chat/tombstones/${filename}.json`, tombstone, {
                revision: Date.now(),
                advanceFromDirectory: true,
                workspaceGeneration: workspace.workspaceGeneration
              }
            );
            scheduleDirectoryFlush();
          } catch (_) {}
        }
        return { deleted: true, tombstone: cloneJsonLike(tombstone) };
      }

      if (message.type === 'ARTICLE_WORKSPACE_COMMIT_PREPARED_RESTORE') {
        if (context.trustedContentScript !== true ||
            !Number.isSafeInteger(context.senderTabId) || context.senderTabId < 0 ||
            !Number.isSafeInteger(context.senderFrameId) || context.senderFrameId < 0 ||
            !safeRestoreReceiptText(context.senderDocumentId, 200) ||
            typeof context.assertTrustedOwnerCurrent !== 'function') {
          throw articleRestoreReceiptError();
        }
        await context.assertTrustedOwnerCurrent();
        const { plan, normalized } = checkedWorkspaceRestorePlan(message.planId, message.binding);
        const senderOwner = [context.senderTabId, context.senderFrameId, context.senderDocumentId];
        if (!plan.operationNonce || restoreReceiptSenderCanonicalUrl(context) !==
            normalized.current.canonicalUrl ||
            (plan.senderTabId !== null && plan.senderTabId !== context.senderTabId) ||
            (plan.senderOwner && !sameJsonLike(plan.senderOwner, senderOwner))) {
          throw articleRestoreReceiptError();
        }
        plan.senderTabId = context.senderTabId;
        plan.senderOwner = senderOwner;
        return await commitWorkspaceRestorePlan(plan, normalized, context);
      }

      if (message.type === 'ARTICLE_WORKSPACE_COMMIT_RESTORE') {
        if (!isPlainObject(message.restore)) throw articleRestoreReceiptError();
        const restore = message.restore;
        const receiptBinding = {
          kind: 'workspace', current: message.identity,
          documentId: message.identity?.documentId, manifest: restore.manifest,
          operationNonce: message.operationNonce, match: String(restore.match || 'exact'),
          allowContentChanged: message.restoreTarget?.allowContentChanged === true
        };
        consumeArticleRestoreReceipt(message.receipt, receiptBinding);
        const { plan, normalized } = checkedWorkspaceRestorePlan(restore.restorePlanId, receiptBinding);
        const { restorePlanId: _ignored, ...candidate } = restore;
        if (!sameJsonLike(candidate, plan.restore)) throw workspaceRestorePlanError();
        return await commitWorkspaceRestorePlan(plan, normalized);
      }

      if (message.type === 'ARTICLE_WORKSPACE_PROBE' ||
          message.type === 'ARTICLE_WORKSPACE_SCAN_RESTORE') {
        const authorizedRestoreCommit = false;
        const restoreDirectorySources = new Map();
        if (message.type === 'ARTICLE_WORKSPACE_SCAN_RESTORE' &&
            message.permissionOnly === true && message.requestPermission !== true) {
          requireDirectorySync('status');
          const status = await directorySync.status();
          return { permission: status.permission, manifests: [], matches: [] };
        }
        if (message.type === 'ARTICLE_WORKSPACE_SCAN_RESTORE' &&
            message.requestPermission === true &&
            typeof directorySync?.requestDirectoryPermission === 'function') {
          const permissionResult = await directorySync.requestDirectoryPermission();
          if (!permissionResult.granted) {
            return { permission: permissionResult.permission, manifests: [], matches: [] };
          }
          if (message.permissionOnly === true) {
            return { permission: 'granted', manifests: [], matches: [] };
          }
        }
        requireDirectorySync('listWorkspaceManifests');
        // Capture before the first directory read; a post-scan snapshot would
        // accept an edit that arrived while the directory was being inspected.
        const restoreBaseline = message.type === 'ARTICLE_WORKSPACE_SCAN_RESTORE' &&
          typeof articleWorkspaceStore?.captureRestoreBaseline === 'function'
          ? await articleWorkspaceStore.captureRestoreBaseline(message.identity?.workspaceId,
            message.identity?.documentId ? { documentId: message.identity.documentId } : {})
          : null;
        const result = await directorySync.listWorkspaceManifests(message.identity || {});
        if (typeof articleWorkspaceStore?.getWorkspaceGenerationState === 'function' &&
            Array.isArray(result.matches)) {
          const retained = [];
          let tombstonedMatches = 0;
          for (const match of result.matches) {
            const manifest = match?.manifest;
            if (!manifest?.workspaceId) continue;
            const state = await articleWorkspaceStore.getWorkspaceGenerationState(
              manifest.workspaceId
            );
            if (state.deletionGeneration >= Number(manifest.workspaceGeneration || 1)) {
              tombstonedMatches += 1;
            } else {
              retained.push(match);
            }
          }
          result.matches = retained;
          result.tombstonedMatches = tombstonedMatches;
        }
        if (message.type === 'ARTICLE_WORKSPACE_SCAN_RESTORE' && !result.matches.length &&
            !result.tombstonedMatches &&
            message.identity?.documentId && typeof directorySync.readJson === 'function' &&
            typeof shared.convertLegacyArticleArchiveToWorkspace === 'function') {
          const legacyPath = shared.articleArchiveRelativePath({
            documentId: message.identity.documentId,
            canonicalUrl: message.identity.canonicalUrl
          });
          const legacy = await directorySync.readJson(legacyPath);
          if (legacy.found) {
            const converted = await shared.convertLegacyArticleArchiveToWorkspace(legacy.value);
            const liveContentHash = String(message.identity?.contentHash || '')
              .replace(/^sha256:/iu, '').toLocaleLowerCase('en-US');
            if (/^[a-f0-9]{64}$/u.test(liveContentHash)) {
              converted.workspace.contentHash = liveContentHash;
              converted.workspace.revision = liveContentHash;
              converted.manifest = shared.createWorkspaceManifest(
                converted.workspace, converted.assets
              );
            }
            if (authorizedRestoreCommit && articleWorkspaceStore?.ensureWorkspace &&
                articleWorkspaceStore?.putAsset) {
              const savedWorkspace = await articleWorkspaceStore.ensureWorkspace(converted.workspace);
              await articleWorkspaceStore.putAsset(
                savedWorkspace.workspaceId, converted.assets[0].path, converted.assets[0].value,
                { contentHash: converted.assets[0].contentHash }
              );
              if (typeof directorySync.enqueueWorkspaceAsset === 'function') {
                await directorySync.enqueueWorkspaceAsset(
                  savedWorkspace, converted.assets[0].path, converted.assets[0].value,
                  { revision: converted.assets[0].revision,
                    contentHash: converted.assets[0].contentHash }
                );
                scheduleDirectoryFlush();
              }
            }
            result.matches = [{ match: 'legacy-imported', manifest: converted.manifest }];
            result.restore = {
              match: 'legacy-imported',
              manifest: converted.manifest,
              assets: converted.assets.map(asset => ({
                relativePath: asset.path,
                content: cloneJsonLike(asset.value),
                revision: Number(asset.revision) || 1,
                contentHash: String(asset.contentHash || '')
              }))
            };
            result.legacyPreserved = true;
          }
        }
        if (message.type === 'ARTICLE_WORKSPACE_SCAN_RESTORE' && result.matches.length &&
            !result.restore) {
          const selected = result.matches[0];
          const loadedAssets = [];
          let localAssetsForRestoreComparison = [];
          if (typeof directorySync?.readWorkspaceAsset === 'function') {
            for (const asset of selected.manifest?.assets || []) {
              try {
                const loaded = await directorySync.readWorkspaceAsset(
                  selected.manifest, asset.path
                );
                const envelope = loaded?.value;
                if (loaded?.found && envelope?.data !== undefined) {
                  restoreDirectorySources.set(asset.path, {
                    revision: Number(envelope.revision) || Number(asset.revision) || 0,
                    contentHash: String(envelope.contentHash || asset.contentHash || ''),
                    data: cloneJsonLike(envelope.data)
                  });
                  loadedAssets.push({
                    relativePath: asset.path,
                    content: cloneJsonLike(envelope.data),
                    revision: Number(envelope.revision) || Number(asset.revision) || 0,
                    contentHash: String(envelope.contentHash || asset.contentHash || ''),
                    updatedAt: String(envelope.updatedAt || asset.updatedAt || '')
                  });
                }
              } catch (_) {}
            }
          }
          if (typeof directorySync?.listWorkspaceChatAssets === 'function') {
            try {
              const discovered = await directorySync.listWorkspaceChatAssets(
                selected.manifest
              );
              const loadedByPath = new Map(loadedAssets.map(asset => [
                String(asset.relativePath || ''), asset
              ]));
              const manifestPaths = new Set((selected.manifest?.assets || [])
                .map(asset => String(asset.path || '')));
              let recoveredUnindexedChatAssets = 0;
              let recoveredGenerationMismatchChatAssets = 0;
              for (const asset of discovered.assets || []) {
                const path = String(asset.relativePath || '');
                if (!path) continue;
                const current = loadedByPath.get(path);
                if (!current || Number(asset.revision || 0) >=
                    Number(current.revision || 0)) {
                  loadedByPath.set(path, asset);
                  restoreDirectorySources.set(path, { revision: Number(asset.revision) || 0,
                    contentHash: String(asset.contentHash || ''), data: cloneJsonLike(asset.content) });
                }
                if (!manifestPaths.has(path)) recoveredUnindexedChatAssets += 1;
                if (asset.recoveredGenerationMismatch === true) {
                  recoveredGenerationMismatchChatAssets += 1;
                }
                if (authorizedRestoreCommit && (!manifestPaths.has(path) ||
                    asset.recoveredGenerationMismatch === true) &&
                    typeof directorySync.enqueueWorkspaceAsset === 'function') {
                  await directorySync.enqueueWorkspaceAsset(
                    selected.manifest, path, asset.content, {
                      revision: Number(asset.revision) || 0,
                      contentHash: String(asset.contentHash || ''),
                      updatedAt: String(asset.updatedAt || ''),
                      workspaceGeneration:
                        Number(selected.manifest.workspaceGeneration) || 1
                    }
                  );
                }
              }
              loadedAssets.splice(0, loadedAssets.length, ...loadedByPath.values());
              if (authorizedRestoreCommit && recoveredUnindexedChatAssets) {
                scheduleDirectoryFlush();
              }
              result.recoveredUnindexedChatAssets = recoveredUnindexedChatAssets;
              result.recoveredGenerationMismatchChatAssets =
                recoveredGenerationMismatchChatAssets;
              result.invalidChatAssets = Number(discovered.invalidAssets) || 0;
            } catch (_) {}
          }
          if (typeof directorySync?.listWorkspaceSupplementalAssets === 'function') {
            try {
              const discovered = await directorySync.listWorkspaceSupplementalAssets(
                selected.manifest
              );
              const loadedByPath = new Map(loadedAssets.map(asset => [
                String(asset.relativePath || ''), asset
              ]));
              const manifestPaths = new Set((selected.manifest?.assets || [])
                .map(asset => String(asset.path || '')));
              let recoveredUnindexedSupplementalAssets = 0;
              let recoveredGenerationMismatchSupplementalAssets = 0;
              for (const asset of discovered.assets || []) {
                const path = String(asset.relativePath || '');
                if (!/^figures\/supplemental\/[^/]+\.json$/u.test(path)) continue;
                const current = loadedByPath.get(path);
                if (!current || Number(asset.revision || 0) >=
                    Number(current.revision || 0)) {
                  loadedByPath.set(path, asset);
                  restoreDirectorySources.set(path, { revision: Number(asset.revision) || 0,
                    contentHash: String(asset.contentHash || ''), data: cloneJsonLike(asset.content) });
                }
                if (!manifestPaths.has(path)) {
                  recoveredUnindexedSupplementalAssets += 1;
                }
                if (asset.recoveredGenerationMismatch === true) {
                  recoveredGenerationMismatchSupplementalAssets += 1;
                }
                if (authorizedRestoreCommit && (!manifestPaths.has(path) ||
                    asset.recoveredGenerationMismatch === true) &&
                    typeof directorySync.enqueueWorkspaceAsset === 'function') {
                  await directorySync.enqueueWorkspaceAsset(
                    selected.manifest, path, asset.content, {
                      revision: Number(asset.revision) || 0,
                      contentHash: String(asset.contentHash || ''),
                      updatedAt: String(asset.updatedAt || ''),
                      workspaceGeneration:
                        Number(selected.manifest.workspaceGeneration) || 1
                    }
                  );
                }
              }
              loadedAssets.splice(0, loadedAssets.length, ...loadedByPath.values());
              if (authorizedRestoreCommit && (recoveredUnindexedSupplementalAssets ||
                  recoveredGenerationMismatchSupplementalAssets)) {
                scheduleDirectoryFlush();
              }
              result.recoveredUnindexedSupplementalAssets =
                recoveredUnindexedSupplementalAssets;
              result.recoveredGenerationMismatchSupplementalAssets =
                recoveredGenerationMismatchSupplementalAssets;
              result.invalidSupplementalAssets = Number(discovered.invalidAssets) || 0;
            } catch (_) {}
          }
          if (typeof articleWorkspaceStore?.getWorkspace === 'function' &&
              typeof articleWorkspaceStore?.listAssets === 'function') {
            try {
              const localWorkspace = await articleWorkspaceStore.getWorkspace(
                selected.manifest.workspaceId
              );
              const selectedGeneration = Number(
                selected.manifest.workspaceGeneration
              ) || 1;
              const localGeneration = Number(localWorkspace?.workspaceGeneration) || 1;
              if (localWorkspace && localGeneration === selectedGeneration) {
                const loadedByPath = new Map(loadedAssets.map(asset => [
                  String(asset.relativePath || ''), asset
                ]));
                const manifestUpdatedAt = Date.parse(
                  String(selected.manifest.updatedAt || '')
                ) || 0;
                let recoveredBrowserLocalSupplementalAssets = 0;
                const localAssets = await articleWorkspaceStore.listAssets(
                  selected.manifest.workspaceId
                );
                localAssetsForRestoreComparison = (localAssets || []).filter(asset =>
                  Number(asset?.workspaceGeneration || localGeneration) === selectedGeneration
                );
                for (const asset of localAssets || []) {
                  const path = String(asset?.relativePath || '');
                  const figures = asset?.content?.figures;
                  const assetUpdatedAt = Date.parse(String(asset?.updatedAt || '')) || 0;
                  if (selected.match !== 'exact' ||
                      !/^figures\/supplemental\/[^/]+\.json$/u.test(path) ||
                      !Array.isArray(figures) || !figures.length ||
                      loadedByPath.has(path) || assetUpdatedAt <= manifestUpdatedAt) {
                    continue;
                  }
                  const recovered = {
                    relativePath: path,
                    content: cloneJsonLike(asset.content),
                    revision: Number(asset.revision) || 0,
                    contentHash: String(asset.contentHash || ''),
                    updatedAt: String(asset.updatedAt || '')
                  };
                  loadedByPath.set(path, recovered);
                  if (authorizedRestoreCommit &&
                      typeof directorySync?.enqueueWorkspaceAsset === 'function') {
                    await directorySync.enqueueWorkspaceAsset(
                      selected.manifest, path, recovered.content, {
                        revision: recovered.revision,
                        contentHash: recovered.contentHash,
                        updatedAt: recovered.updatedAt,
                        advanceFromDirectory: true,
                        workspaceGeneration: selectedGeneration
                      }
                    );
                  }
                  recoveredBrowserLocalSupplementalAssets += 1;
                }
                if (recoveredBrowserLocalSupplementalAssets) {
                  loadedAssets.splice(0, loadedAssets.length, ...loadedByPath.values());
                  result.recoveredBrowserLocalSupplementalAssets =
                    recoveredBrowserLocalSupplementalAssets;
                  if (authorizedRestoreCommit) scheduleDirectoryFlush();
                }
              }
            } catch (_) {
              throw Object.assign(new Error('WORKSPACE_STORE_UNAVAILABLE'), {
                code: 'WORKSPACE_STORE_UNAVAILABLE'
              });
            }
          }
          const isTurnPath = value => /^chat\/turns\/[^/]+\.json$/u.test(
            String(value || '')
          );
          const isTurnTombstonePath = value => /^chat\/tombstones\/[^/]+\.json$/u.test(
            String(value || '')
          );
          const turnAssets = loadedAssets.filter(asset =>
            isTurnPath(asset.relativePath) && asset.content?.turnId
          );
          const turnTombstones = loadedAssets.filter(asset =>
            isTurnTombstonePath(asset.relativePath) &&
            asset.content?.entityType === 'turn' && asset.content?.entityId
          );
          const deletedTurnIds = new Set(turnTombstones.map(asset =>
            String(asset.content.entityId)
          ));
          const assets = loadedAssets.filter(asset =>
            !isTurnPath(asset.relativePath) && !isTurnTombstonePath(asset.relativePath)
          );
          const chatIndexAsset = assets.find(asset =>
            asset.relativePath === 'chat/index.json'
          );
          const indexedTurnIds = (Array.isArray(chatIndexAsset?.content?.turns)
            ? chatIndexAsset.content.turns : []).map(turn =>
            String(turn?.turnId || '')
          ).filter(Boolean);
          const restoredTurnsById = new Map();
          (Array.isArray(chatIndexAsset?.content?.turns)
            ? chatIndexAsset.content.turns : []).forEach(turn => {
            const turnId = String(turn?.turnId || '');
            if (turnId && !deletedTurnIds.has(turnId)) {
              restoredTurnsById.set(turnId, publicStoredArticleChatTurn(turn));
            }
          });
          turnAssets.forEach(asset => {
            const turnId = String(asset.content?.turnId || '');
            if (turnId && !deletedTurnIds.has(turnId)) {
              restoredTurnsById.set(
                turnId, publicStoredArticleChatTurn(asset.content)
              );
            }
          });
          const restoredTurns = [...restoredTurnsById.values()].sort((left, right) =>
            Number(left.sequence || 0) - Number(right.sequence || 0) ||
            Number(left.createdAt || 0) - Number(right.createdAt || 0) ||
            String(left.turnId || '').localeCompare(String(right.turnId || ''))
          );
          const restoredChatIndex = chatIndexWithTurns(
            chatIndexAsset?.content || {}, restoredTurns, { authoritative: true }
          );
          const restoredTurnIds = restoredTurns.map(turn => String(turn?.turnId || ''));
          const chatIndexNeedsRepair = !chatIndexAsset
            ? restoredTurns.length > 0
            : Number(chatIndexAsset.content?.totalTurns) !== restoredTurns.length ||
              JSON.stringify(indexedTurnIds) !== JSON.stringify(restoredTurnIds);
          if (chatIndexAsset) {
            chatIndexAsset.content = restoredChatIndex;
          } else if (restoredTurns.length) {
            assets.push({
              relativePath: 'chat/index.json',
              content: restoredChatIndex,
              revision: Math.max(0, ...turnAssets.map(asset =>
                Number(asset.revision) || 0
              )),
              contentHash: '',
              updatedAt: String(restoredTurns.at(-1)?.updatedAt || '')
            });
          }
          if (chatIndexNeedsRepair) result.repairedChatIndex = true;
          if (authorizedRestoreCommit && chatIndexNeedsRepair &&
              typeof directorySync?.enqueueWorkspaceAsset === 'function') {
            try {
              await directorySync.enqueueWorkspaceAsset(
                selected.manifest, 'chat/index.json', restoredChatIndex, {
                  revision: Math.max(
                    Date.now(),
                    Number(chatIndexAsset?.revision || 0) + 1
                  ),
                  workspaceGeneration:
                    Number(selected.manifest.workspaceGeneration) || 1
                }
              );
              scheduleDirectoryFlush();
            } catch (_) {
              result.repairedChatIndex = false;
            }
          }
          if (authorizedRestoreCommit && articleWorkspaceStore?.ensureWorkspace &&
              articleWorkspaceStore?.putAsset) {
            // Always reconcile the browser-local workspace with the directory
            // manifest. Reusing an older generation here made the content
            // script restore generation N+1 while IndexedDB remained on N,
            // causing every later chat save to fail.
            const importedWorkspace = await articleWorkspaceStore.ensureWorkspace({
              ...selected.manifest,
              storageRevision: selected.manifest.revision
            });
            for (const asset of assets) {
              await articleWorkspaceStore.putAsset(
                importedWorkspace.workspaceId, asset.relativePath, asset.content,
                { contentHash: asset.contentHash }
              );
            }
            if (typeof articleWorkspaceStore.deleteTurn === 'function') {
              for (const turnId of deletedTurnIds) {
                await articleWorkspaceStore.deleteTurn(importedWorkspace.workspaceId, turnId);
              }
            }
            const existingTurnIds = new Set();
            if (typeof articleWorkspaceStore.pageTurns === 'function') {
              let afterSequence = 0;
              while (true) {
                const page = await articleWorkspaceStore.pageTurns(
                  importedWorkspace.workspaceId, { limit: 1000, afterSequence }
                );
                (page.items || []).forEach(turn => existingTurnIds.add(String(turn.turnId || '')));
                if (!page.hasMore || Number(page.nextSequence) <= afterSequence) break;
                afterSequence = Number(page.nextSequence);
              }
            }
            turnAssets.sort((left, right) =>
              Number(left.content?.sequence || 0) - Number(right.content?.sequence || 0) ||
              String(left.content?.createdAt || '').localeCompare(
                String(right.content?.createdAt || '')
              ) || String(left.content?.turnId || '').localeCompare(
                String(right.content?.turnId || '')
              )
            );
            for (const asset of turnAssets) {
              const turnId = String(asset.content.turnId || '');
              if (!turnId || deletedTurnIds.has(turnId)) continue;
              const portableTurn = publicStoredArticleChatTurn(asset.content);
              if (existingTurnIds.has(turnId)) {
                if (typeof articleWorkspaceStore.updateTurn === 'function') {
                  await articleWorkspaceStore.updateTurn(
                    importedWorkspace.workspaceId, turnId, portableTurn
                  );
                }
                continue;
              }
              if (typeof articleWorkspaceStore.appendTurn === 'function') {
                await articleWorkspaceStore.appendTurn(
                  importedWorkspace.workspaceId, portableTurn
                );
                existingTurnIds.add(turnId);
              }
            }
          }
          // Imported directory revisions and local asset revisions do not share
          // one sequence. Compare actual final payloads before allowing page
          // apply; neither a timestamp nor an equal hash can rank differing data.
          const serializeRestoreAssetContent = content => JSON.stringify(content,
            (_key, value) => isPlainObject(value)
              ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
              : value);
          const restoreAssetsByPath = new Map(assets.map(asset => [
            String(asset.relativePath || ''), asset
          ]));
          for (const localAsset of localAssetsForRestoreComparison) {
            const restoredAsset = restoreAssetsByPath.get(String(localAsset?.relativePath || ''));
            // Rebuilding the directory index from independent terminal turns
            // can only reconcile operation cleanup and its checkpoint time.
            // First require the two saved aggregates to match exactly; keep
            // every answer, evidence, status and other field in the comparison.
            const savedIndexSource = String(localAsset?.relativePath || '') === 'chat/index.json'
              ? restoreDirectorySources.get('chat/index.json') : null;
            let comparisonContent = restoredAsset?.content;
            if (savedIndexSource && Array.isArray(localAsset.content?.turns) &&
                Array.isArray(comparisonContent?.turns) &&
                serializeRestoreAssetContent(localAsset.content) ===
                  serializeRestoreAssetContent(savedIndexSource.data)) {
              comparisonContent = cloneJsonLike(comparisonContent);
              const savedTurns = new Map(localAsset.content.turns.map(turn => [
                String(turn?.turnId || ''), turn
              ]));
              for (const turn of comparisonContent.turns) {
                const saved = savedTurns.get(String(turn?.turnId || ''));
                if (saved?.status !== 'completed' || turn?.status !== 'completed' ||
                    turn.operationId !== '' || typeof saved.operationId !== 'string') continue;
                turn.operationId = saved.operationId;
                if (Object.prototype.hasOwnProperty.call(saved, 'updatedAt')) {
                  turn.updatedAt = cloneJsonLike(saved.updatedAt);
                } else {
                  delete turn.updatedAt;
                }
              }
            }
            if (restoredAsset && serializeRestoreAssetContent(localAsset.content) !==
                serializeRestoreAssetContent(comparisonContent)) {
              throw Object.assign(new Error('ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT'), {
                code: 'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT'
              });
            }
          }
          // Standalone chat/turns assets were removed from the ordinary asset
          // set above. Compare actual existing turn content too: a scan baseline
          // taken after a human edit is not permission to replace that edit.
          if (restoredTurns.length && typeof articleWorkspaceStore?.pageTurns === 'function') {
            const incomingTurns = new Map(restoredTurns.map(turn => [String(turn.turnId), turn]));
            const comparableTurn = turn => {
              const portable = publicStoredArticleChatTurn(turn);
              delete portable.createdAt;
              delete portable.updatedAt;
              return serializeRestoreAssetContent(portable);
            };
            let afterSequence = 0;
            let examined = 0;
            while (true) {
              const page = await articleWorkspaceStore.pageTurns(message.identity.workspaceId,
                { limit: 1000, afterSequence });
              for (const turn of page.items || []) {
                examined += 1;
                if (examined > 10000) throw workspaceRestorePlanError('WORKSPACE_RESTORE_TOO_LARGE');
                const incoming = incomingTurns.get(String(turn.turnId));
                if (incoming && comparableTurn(turn) !== comparableTurn(incoming)) {
                  throw workspaceRestorePlanError('ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
                }
              }
              if (!page.hasMore) break;
              if (!(Number(page.nextSequence) > afterSequence)) {
                throw workspaceRestorePlanError('INVALID_WORKSPACE_RESTORE_BASELINE');
              }
              afterSequence = Number(page.nextSequence);
            }
          }
          result.restore = {
            match: selected.match,
            manifest: selected.manifest,
            assets,
            // Keep the recovered turn records in the restore payload as a
            // second source of truth. The content script can rebuild history
            // even when an older chat/index.json was overwritten empty.
            turns: restoredTurns.map(cloneJsonLike)
          };
        }
        if (message.type === 'ARTICLE_WORKSPACE_SCAN_RESTORE' && result.restore && restoreBaseline) {
          result.restore.restorePlanId = retainWorkspaceRestorePlan(message.identity,
            result.restore, restoreBaseline, message.operationNonce, message.documentCreationToken,
            [...restoreDirectorySources]);
        }
        return result;
      }

      if (message.type === 'ARTICLE_WORKSPACE_LIST') {
        requireArticleWorkspaceStore('listWorkspaces');
        const [workspaces, tokenUsageDocuments] = await Promise.all([
          articleWorkspaceStore.listWorkspaces(),
          typeof tokenUsageStore?.list === 'function' ? tokenUsageStore.list() : []
        ]);
        let directoryOverview = {
          permission: 'unconfigured', manifests: [], invalidManifests: 0,
          pendingCount: 0, conflictCount: 0, lastConflict: null
        };
        if (typeof directorySync?.listWorkspaceManifests === 'function') {
          try {
            directoryOverview = {
              ...directoryOverview,
              ...(await directorySync.listWorkspaceManifests({}))
            };
          } catch (_) {}
        }
        if (typeof directorySync?.status === 'function') {
          try {
            directoryOverview = {
              ...directoryOverview,
              ...(await directorySync.status())
            };
          } catch (_) {}
        }
        const manifestById = new Map((directoryOverview.manifests || [])
          .map(manifest => [manifest.workspaceId, manifest]));
        const usageByUrl = new Map((tokenUsageDocuments || [])
          .map(usage => [
            typeof shared.normalizeTokenUsageCanonicalUrl === 'function'
              ? shared.normalizeTokenUsageCanonicalUrl(usage.canonicalUrl)
              : String(usage.canonicalUrl || ''),
            usage
          ]).filter(([url]) => url));
        const summaries = workspaces.map(workspace => {
          const overview = publicWorkspaceOverview(
            workspace, manifestById.get(workspace.workspaceId) || null, directoryOverview
          );
          const url = typeof shared.normalizeTokenUsageCanonicalUrl === 'function'
            ? shared.normalizeTokenUsageCanonicalUrl(workspace.canonicalUrl)
            : String(workspace.canonicalUrl || '');
          return {
            ...overview,
            tokenUsage: usageByUrl.get(url) || null
          };
        });
        return {
          workspaces: summaries,
          totals: {
            workspaceCount: summaries.length,
            estimatedBytes: summaries.reduce((sum, item) => sum + item.estimatedBytes, 0),
            chatTurnCount: summaries.reduce((sum, item) => sum + item.chatTurnCount, 0),
            figureCount: summaries.reduce((sum, item) => sum + item.figureCount, 0),
            panelCount: summaries.reduce((sum, item) => sum + item.panelCount, 0),
            highlightCount: summaries.reduce((sum, item) => sum + item.highlightCount, 0),
            tokenRequests: summaries.reduce((sum, item) =>
              sum + (Number(item.tokenUsage?.totals?.requests) || 0), 0),
            inputTokens: summaries.reduce((sum, item) =>
              sum + (Number(item.tokenUsage?.totals?.inputTokens) || 0), 0),
            outputTokens: summaries.reduce((sum, item) =>
              sum + (Number(item.tokenUsage?.totals?.outputTokens) || 0), 0)
          },
          sync: {
            permission: String(directoryOverview.permission || 'unconfigured'),
            pendingCount: Math.max(0, Number(directoryOverview.pendingCount) || 0),
            conflictCount: Math.max(0, Number(directoryOverview.conflictCount) || 0),
            corruptCount: Math.max(0, Number(directoryOverview.invalidManifests) || 0)
          }
        };
      }

      if (message.type === 'ARTICLE_WORKSPACE_DETAIL') {
        requireArticleWorkspaceStore('getWorkspace');
        requireArticleWorkspaceStore('listAssets');
        requireArticleWorkspaceStore('pageTurns');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        const assets = publicWorkspaceAssets(
          await articleWorkspaceStore.listAssets(workspace.workspaceId)
        );
        const turns = [];
        let afterSequence = 0;
        while (true) {
          const page = await articleWorkspaceStore.pageTurns(workspace.workspaceId, {
            limit: 1000, afterSequence
          });
          turns.push(...page.items);
          if (!page.hasMore || Number(page.nextSequence) <= afterSequence) break;
          afterSequence = Number(page.nextSequence);
        }
        const detail = detailFromWorkspaceAssets(workspace, assets, turns);
        const tokenUsage = typeof tokenUsageStore?.getForDocument === 'function'
          ? await tokenUsageStore.getForDocument({
            canonicalUrl: workspace.canonicalUrl,
            documentKey: workspace.workspaceId
          }) : null;
        return { ...detail, tokenUsage };
      }

      if (message.type === 'ARTICLE_WORKSPACE_SAVE_BINARY_ASSET') {
        requireArticleWorkspaceStore('getWorkspace');
        if (typeof directorySync?.enqueueWorkspaceBinary !== 'function') {
          throw Object.assign(new Error('WORKSPACE_BINARY_UNAVAILABLE'), {
            code: 'WORKSPACE_BINARY_UNAVAILABLE'
          });
        }
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace || workspace.deletionPending) {
          throw Object.assign(new Error('WORKSPACE_NOT_FOUND'), { code: 'WORKSPACE_NOT_FOUND' });
        }
        assertWorkspaceMutationGeneration(workspace, message);
        const relativePath = shared.normalizeWorkspaceRelativePath(message.relativePath);
        if (!/^pdf\/figures\/(?:main|supplemental)\/[^/]+\.(?:png|jpe?g|webp)$/iu
          .test(relativePath)) {
          throw Object.assign(new Error('INVALID_BINARY_ASSET'), {
            code: 'INVALID_BINARY_ASSET'
          });
        }
        const decoded = decodeWorkspaceBinary(message.dataUrl);
        const expectedHash = String(message.sha256 || '').toLowerCase();
        const actualHash = await workspaceBinarySha256(decoded.bytes);
        if (!/^[a-f0-9]{64}$/u.test(expectedHash) || expectedHash !== actualHash) {
          throw Object.assign(new Error('WORKSPACE_BINARY_HASH_MISMATCH'), {
            code: 'WORKSPACE_BINARY_HASH_MISMATCH'
          });
        }
        await directorySync.enqueueWorkspaceBinary(
          workspace,
          relativePath,
          decoded.bytes,
          {
            revision: Math.max(0, Number(message.revision) || Date.now()),
            contentHash: actualHash,
            workspaceGeneration: workspace.workspaceGeneration
          }
        );
        const flushed = typeof directorySync.flush === 'function'
          ? await directorySync.flush(importUserDataAsset)
          : { permission: 'unavailable', written: 0, pendingCount: 1 };
        return {
          saved: true,
          relativePath,
          mimeType: decoded.mimeType,
          sha256: actualHash,
          byteLength: decoded.bytes.byteLength,
          directoryPersisted: flushed.permission === 'granted' &&
            Number(flushed.failed) === 0 && Number(flushed.pendingCount) === 0,
          directoryPermission: String(flushed.permission || 'unavailable'),
          directoryErrorCode: String(flushed.errorCode || '')
        };
      }

      if (message.type === 'ARTICLE_WORKSPACE_GET_BINARY_ASSET') {
        requireArticleWorkspaceStore('getWorkspace');
        if (typeof directorySync?.readWorkspaceBinary !== 'function') {
          throw Object.assign(new Error('WORKSPACE_BINARY_UNAVAILABLE'), {
            code: 'WORKSPACE_BINARY_UNAVAILABLE'
          });
        }
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace || workspace.deletionPending) {
          throw Object.assign(new Error('WORKSPACE_NOT_FOUND'), { code: 'WORKSPACE_NOT_FOUND' });
        }
        const relativePath = shared.normalizeWorkspaceRelativePath(message.relativePath);
        const result = await directorySync.readWorkspaceBinary(workspace, relativePath);
        if (!result.found) return {
          found: false,
          relativePath,
          directoryPermission: result.permission
        };
        const mimeType = /^image\/(?:png|jpeg|webp)$/i.test(String(message.mimeType || ''))
          ? String(message.mimeType).toLowerCase() : 'image/png';
        const sha256 = await workspaceBinarySha256(result.bytes);
        return {
          found: true,
          relativePath,
          directoryPermission: result.permission,
          byteLength: result.bytes.byteLength,
          sha256,
          dataUrl: encodeWorkspaceBinary(result.bytes, mimeType)
        };
      }

      if (message.type === 'LLM_TOKEN_USAGE_LIST') {
        return {
          documents: typeof tokenUsageStore?.list === 'function'
            ? await tokenUsageStore.list() : []
        };
      }

      if (message.type === 'ARTICLE_WORKSPACE_GET_ASSET') {
        requireArticleWorkspaceStore('getWorkspace');
        const target = supplementalAssetWorkspaceTarget(message);
        const workspace = await articleWorkspaceStore.getWorkspace(
          target?.workspaceId || message.workspaceId
        );
        if (!workspace || workspace.deletionPending) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        if (target) assertSupplementalDraftWorkspaceTarget(workspace, target);
        const requestedPath = shared.normalizeWorkspaceRelativePath(message.relativePath);
        let asset = null;
        if (!isFigureRetryStagingPath(requestedPath)) {
          if (typeof articleWorkspaceStore.listAssets === 'function') {
            asset = publicWorkspaceAssets(
              await articleWorkspaceStore.listAssets(workspace.workspaceId)
            ).find(candidate => candidate.relativePath === requestedPath) || null;
          } else {
            requireArticleWorkspaceStore('getAsset');
            asset = await articleWorkspaceStore.getAsset(
              workspace.workspaceId, requestedPath
            );
          }
        }
        // Tag editing must use the same envelope generation as the list. A live
        // owner upgrade must not turn an old-generation row into a valid CAS base.
        if (asset && ['annotations/library-tags.json', 'article/bibliography.json',
          'annotations/library-save-events.json'].includes(requestedPath) &&
            Number(asset.workspaceGeneration ?? 1) !== Number(workspace.workspaceGeneration || 1)) {
          throw Object.assign(new Error('WORKSPACE_GENERATION_CONFLICT'), {
            code: 'WORKSPACE_GENERATION_CONFLICT'
          });
        }
        return {
          found: Boolean(asset),
          workspaceGeneration: Number(workspace.workspaceGeneration || 1),
          asset: asset ? {
            relativePath: asset.relativePath,
            revision: asset.revision,
            contentHash: asset.contentHash,
            byteSize: asset.byteSize,
            updatedAt: asset.updatedAt,
            ...(asset.writeToken ? { writeToken: asset.writeToken } : {}),
            content: asset.content
          } : null
        };
      }

      if (message.type === 'ARTICLE_WORKSPACE_LIST_ASSETS') {
        requireArticleWorkspaceStore('listAssets');
        requireArticleWorkspaceStore('getWorkspace');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace || workspace.deletionPending) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        const prefix = String(message.prefix || '').replace(/^\/+/, '').slice(0, 240);
        const assets = publicWorkspaceAssets(
          await articleWorkspaceStore.listAssets(workspace.workspaceId)
        )
          .filter(asset => !prefix || String(asset.relativePath || '').startsWith(prefix))
          .map(asset => ({
            relativePath: asset.relativePath,
            revision: asset.revision,
            contentHash: asset.contentHash,
            byteSize: asset.byteSize,
            updatedAt: asset.updatedAt,
            ...(asset.writeToken ? { writeToken: asset.writeToken } : {}),
            content: cloneJsonLike(asset.content)
          }));
        return {
          workspaceGeneration: Number(workspace.workspaceGeneration || 1),
          assets
        };
      }

      if (message.type === 'LLM_TOKEN_USAGE_CLEAR') {
        if (typeof tokenUsageStore?.clearDocument !== 'function') {
          return { deleted: false };
        }
        return tokenUsageStore.clearDocument({
          canonicalUrl: message.canonicalUrl,
          documentKey: message.documentKey
        });
      }

      if (message.type === 'ARTICLE_WORKSPACE_STATS') {
        requireArticleWorkspaceStore('getStorageStatistics');
        return articleWorkspaceStore.getStorageStatistics();
      }

      if (message.type === 'ARTICLE_WORKSPACE_EXPORT') {
        requireArticleWorkspaceStore('getWorkspace');
        requireArticleWorkspaceStore('listAssets');
        requireArticleWorkspaceStore('pageTurns');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        const turns = [];
        let afterSequence = 0;
        while (true) {
          const page = await articleWorkspaceStore.pageTurns(workspace.workspaceId, {
            limit: 10_000, afterSequence
          });
          turns.push(...page.items);
          if (!page.hasMore || page.nextSequence <= afterSequence) break;
          afterSequence = page.nextSequence;
        }
        const portableTurns = turns.map(publicStoredArticleChatTurn);
        return {
          schemaVersion: 1,
          workspace: publicWorkspace(workspace),
          assets: publicWorkspaceAssets(
            await articleWorkspaceStore.listAssets(workspace.workspaceId)
          ).map(asset => ({
            relativePath: asset.relativePath,
            content: asset.relativePath === 'chat/index.json'
              ? chatIndexWithTurns(
                asset.content, portableTurns, { authoritative: true }
              ) : cloneJsonLike(asset.content),
            contentHash: asset.contentHash,
            revision: asset.revision,
            updatedAt: asset.updatedAt
          })),
          turns: portableTurns
        };
      }

      if (message.type === 'ARTICLE_WORKSPACE_BEGIN_DELETE') {
        requireArticleWorkspaceStore('getWorkspace');
        requireArticleWorkspaceStore('beginWorkspaceDeletion');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        const tombstone = await articleWorkspaceStore.beginWorkspaceDeletion(workspace.workspaceId);
        const cancellation = typeof directorySync?.cancelWorkspaceQueue === 'function'
          ? await directorySync.cancelWorkspaceQueue(workspace) : { cancelled: 0 };
        return { ...cloneJsonLike(tombstone), cancelled: Number(cancellation.cancelled) || 0 };
      }

      if (message.type === 'ARTICLE_WORKSPACE_FINALIZE_DELETE') {
        requireArticleWorkspaceStore('getWorkspace');
        requireArticleWorkspaceStore('finalizeWorkspaceDeletion');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace) return { deleted: true, alreadyMissing: true };
        let disk = { removed: true, permission: 'unconfigured' };
        if (typeof directorySync?.removeWorkspaceTree === 'function') {
          try {
            disk = await directorySync.removeWorkspaceTree(workspace);
          } catch (error) {
            disk = {
              removed: false,
              permission: 'error',
              pending: true,
              errorCode: String(error?.code || error?.name || 'DIRECTORY_DELETE_FAILED')
            };
          }
        }
        await articleWorkspaceStore.finalizeWorkspaceDeletion(
          workspace.workspaceId, message.tombstoneId
        );
        if (typeof tokenUsageStore?.clearDocument === 'function') {
          await tokenUsageStore.clearDocument({
            canonicalUrl: workspace.canonicalUrl,
            documentKey: workspace.workspaceId
          }).catch(() => null);
        }
        const pendingDiskCleanup = !disk.removed && disk.permission !== 'unconfigured';
        return {
          deleted: true,
          permission: disk.permission,
          removedFromDisk: disk.removed,
          pendingDiskCleanup,
          diskCleanupError: disk.errorCode || null,
          workspaceGeneration: Math.max(
            1, Number(workspace.workspaceGeneration) || 1
          ) + 1
        };
      }

      if (message.type === 'ARTICLE_WORKSPACE_REBUILD_INDEX') {
        requireDirectorySync('rebuildWorkspaceIndex');
        return directorySync.rebuildWorkspaceIndex();
      }

      if (message.type === 'ARTICLE_ARCHIVE_PROBE') {
        requireDirectorySync('readJson');
        const documentId = String(message.documentId || '').trim();
        const relativePath = shared.articleArchiveRelativePath({
          documentId,
          canonicalUrl: message.canonicalUrl
        });
        const result = await directorySync.readJson(relativePath);
        if (!result.found) {
          return {
            found: false,
            permission: result.permission,
            relativePath
          };
        }
        const archive = shared.validateArticleArchive(result.value);
        if (shared.articleArchiveRelativePath(archive) !== relativePath) {
          const error = new Error('ARCHIVE_IDENTITY_MISMATCH');
          error.code = 'ARCHIVE_IDENTITY_MISMATCH';
          throw error;
        }
        return {
          found: true,
          permission: result.permission,
          relativePath,
          savedAt: archive.savedAt,
          revision: archive.revision,
          title: archive.title,
          documentHash: archive.documentHash,
          annotationCount: archive.documentRecord.annotations?.length || 0,
          hasLlmAnalysis: Boolean(archive.workspace?.llm?.rawAnalysis),
          hasReviewOutline: Boolean(archive.workspace?.reviewOutline),
          figureCount: Array.isArray(archive.workspace?.figures)
            ? archive.workspace.figures.length : 0
        };
      }

      if (message.type === 'ARTICLE_ARCHIVE_SAVE') {
        requireDirectorySync('enqueueJson');
        const archive = shared.validateArticleArchive(message.archive);
        const currentDocument = await documentStore.getDocument(archive.documentId);
        if (currentDocument && !jsonLikeEqual(
          shared.normalizeDocumentRecord(currentDocument).annotations,
          shared.normalizeDocumentRecord(archive.documentRecord).annotations
        )) {
          throw workspaceRestorePlanError('ARTICLE_ARCHIVE_DOCUMENT_CONFLICT');
        }
        const relativePath = shared.articleArchiveRelativePath(archive);
        await directorySync.enqueueJson(relativePath, archive);
        scheduleDirectoryFlush();
        return {
          saved: true,
          queued: true,
          relativePath,
          revision: archive.revision,
          savedAt: archive.savedAt
        };
      }

      if (message.type === 'ARTICLE_ARCHIVE_LOAD' ||
          message.type === 'ARTICLE_ARCHIVE_COMMIT_RESTORE') {
        requireDirectorySync('readJson');
        const requestedArchive = message.archive
          ? shared.validateArticleArchive(message.archive) : null;
        const documentId = String(
          requestedArchive?.documentId || message.documentId || ''
        ).trim();
        const relativePath = shared.articleArchiveRelativePath({
          documentId,
          canonicalUrl: message.canonicalUrl
        });
        const directArchive = requestedArchive;
        const result = directArchive
          ? { permission: 'imported', found: true, value: directArchive }
          : await directorySync.readJson(relativePath);
        if (!result.found) {
          const error = new Error('ARTICLE_ARCHIVE_NOT_FOUND');
          error.code = 'ARTICLE_ARCHIVE_NOT_FOUND';
          throw error;
        }
        const archive = shared.validateArticleArchive(result.value);
        if (!directArchive && shared.articleArchiveRelativePath(archive) !== relativePath) {
          const error = new Error('ARCHIVE_IDENTITY_MISMATCH');
          error.code = 'ARCHIVE_IDENTITY_MISMATCH';
          throw error;
        }
        let applied = false;
        if (message.type === 'ARTICLE_ARCHIVE_COMMIT_RESTORE') {
          const receiptBinding = {
            kind: 'archive',
            current: message.current,
            operationNonce: message.operationNonce,
            currentArchive: message.currentArchive,
            allowContentChanged: message.allowContentChanged === true,
            archive: {
              documentId: archive.documentId,
              documentHash: archive.documentHash,
              canonicalUrl: archive.canonicalUrl
            }
          };
          const consumed = consumeArticleRestoreReceipt(message.receipt, receiptBinding);
          const binding = consumed.binding;
          const live = binding.currentArchive;
          const contentChanged = binding.allowContentChanged === true && (
            live.documentId !== binding.archive.documentId ||
            live.documentHash !== binding.archive.documentHash
          );
          invalidateDocumentCreationReceipts(contentChanged ? live.documentId : archive.documentId);
          await documentStore.putDocument(contentChanged ? {
            ...archive.documentRecord,
            documentId: live.documentId,
            documentHash: live.documentHash,
            documentHashes: [...new Set([
              ...(archive.documentRecord.documentHashes || []),
              archive.documentHash,
              live.documentHash
            ].filter(Boolean))],
            canonicalUrl: live.canonicalUrl,
            workspaceId: binding.current.workspaceId,
            workspaceGeneration: binding.current.workspaceGeneration,
            workspaceContentHash: binding.current.contentHash
          } : {
            ...archive.documentRecord,
            documentId: archive.documentId,
            documentHash: archive.documentHash,
            documentHashes: [...new Set([
              ...(archive.documentRecord.documentHashes || []),
              archive.documentHash
            ].filter(Boolean))],
            canonicalUrl: archive.canonicalUrl
          });
          applied = true;
        }
        return { archive, applied, permission: result.permission, relativePath };
      }

      if (message.type === 'ARTICLE_RESTORE_REGISTER_COMMIT') {
        return issueArticleRestoreReceipt(message.binding, context);
      }

      if (message.type === 'PORTABLE_CONFIG_PROBE') {
        return portableConfigStatus(await portableConfigManager.probe());
      }

      if (message.type === 'PORTABLE_CONFIG_CREATE') {
        return portableConfigStatus(await portableConfigManager.create(
          String(message.passphrase ?? '')
        ));
      }

      if (message.type === 'PORTABLE_CONFIG_UNLOCK') {
        return portableConfigStatus(await portableConfigManager.unlock(
          String(message.passphrase ?? '')
        ));
      }

      if (message.type === 'PORTABLE_CONFIG_ROTATE_PASSPHRASE') {
        return portableConfigStatus(await portableConfigManager.rotatePassphrase(
          String(message.currentPassphrase ?? ''),
          String(message.newPassphrase ?? '')
        ));
      }

      if (message.type === 'PORTABLE_CONFIG_FORGET_KEY') {
        return portableConfigStatus(await portableConfigManager.forgetKey());
      }

      if (message.type === 'PORTABLE_CONFIG_BACKUP_NOW') {
        return portableConfigStatus(await portableConfigManager.backupNow());
      }

      if (message.type === 'PORTABLE_CONFIG_STATUS') {
        return currentPortableConfigStatus();
      }

      if (message.type === 'USER_DATA_SYNC_STATUS') {
        requireDirectorySync('status');
        const [directoryStatus, portableConfig] = await Promise.all([
          directorySync.status(), currentPortableConfigStatus()
        ]);
        return { ...directoryStatus, portableConfig };
      }

      if (message.type === 'USER_DATA_SYNC_NOW') {
        requireDirectorySync('flush');
        return runWithPortableConfigReady(async () => {
          let result = await directorySync.flush(importUserDataAsset);
          if (message.drain === true) {
            for (let attempt = 0; attempt < 5 &&
                result?.permission === 'granted' &&
                !Number(result?.failed) &&
                Number(result?.pendingCount) > 0; attempt += 1) {
              await new Promise(resolve => setTimeout(resolve, 30 * (attempt + 1)));
              result = await directorySync.flush(importUserDataAsset);
            }
          }
          return result;
        });
      }

      if (message.type === 'USER_DATA_REBUILD_INDEX') {
        requireDirectorySync('rebuildIndex');
        return runWithPortableConfigReady(() =>
          serializeAllMutations(() => directorySync.rebuildIndex(importUserDataAsset))
        );
      }

      if (message.type === 'USER_DATA_EXPORT_BUNDLE') {
        requireDirectorySync('exportBundle');
        const [settings, documents, samples] = await Promise.all([
          shared.loadSettings(storageArea),
          documentStore.exportAll(),
          corpusStore.list()
        ]);
        return directorySync.exportBundle({
          schemaVersion: 1,
          categories: categoryAsset(settings),
          documents,
          feedbackCorpus: shared.exportCorpus(samples, 'jsonl')
        });
      }

      if (message.type === 'LLM_GET_SETTINGS') {
        return publicState(await shared.loadSettings(storageArea));
      }

      if (message.type === 'LLM_PREFLIGHT_TASK_ROUTE') {
        const taskId = typeof message.taskId === 'string' ? message.taskId : '';
        if (!FIGURE_ROUTE_PREFLIGHT_TASK_IDS.has(taskId)) throw unknownLlmTask();
        const settings = await shared.loadSettings(storageArea);
        requireLlmReady(settings);
        const resolvedRoute = shared.resolveTaskProfile(settings, taskId);
        const outputLanguage = typeof shared.normalizeInterfaceLanguage === 'function'
          ? shared.normalizeInterfaceLanguage(settings?.language)
          : (String(settings?.language || '').toLowerCase().startsWith('en')
            ? 'en' : 'zh-CN');
        return {
          taskId,
          route: publicRoute({ ...resolvedRoute, outputLanguage }),
          allowTextFallback: settings.taskPolicies?.[taskId]?.allowTextFallback === true,
          taskPolicySignature: buildTaskPolicySignature(settings, taskId)
        };
      }

      if (message.type === 'CATEGORY_GET') {
        const settings = await shared.loadSettings(storageArea);
        return await categoryDetail(settings, String(message.categoryId || ''));
      }

      if (message.type === 'CATEGORY_SAVE_OVERRIDE') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          const categoryId = String(message.categoryId || '');
          const detail = await categoryDetail(settings, categoryId);
          if (!isPlainObject(message.override)) throw invalidSettings(['override']);
          const incoming = shared.normalizeCategoryOverride(message.override);
          if (incoming.categoryId && incoming.categoryId !== categoryId) {
            throw invalidSettings(['categoryId']);
          }
          delete incoming.categoryId;
          if (!detail.metadata.builtIn) {
            const mergedCategory = shared.mergeCategoryOverrides(detail.category, incoming);
            mergedCategory.categoryId = categoryId;
            mergedCategory.persistence = detail.category.persistence === 'one-off'
              ? 'one-off' : 'saved';
            mergedCategory.builtIn = false;
            const customErrors = shared.validateUnifiedCategory(mergedCategory);
            if (customErrors.length) throw invalidSettings(customErrors);
            if (mergedCategory.persistence === 'one-off') {
              const sessionCategories = await loadRouterSessionCategories();
              const nextSession = sessionCategories
                .filter(item => item.categoryId !== categoryId);
              nextSession.push(mergedCategory);
              await saveRouterSessionCategories(nextSession);
              return await categoryDetail(settings, categoryId);
            }
            settings.customCategories = (settings.customCategories || [])
              .filter(item => item.categoryId !== categoryId);
            settings.customCategories.push(mergedCategory);
            settings.userDataCategoryRevision =
              (Number(settings.userDataCategoryRevision) || 0) + 1;
            const saved = await shared.saveSettings(storageArea, settings);
            await mirrorCategorySettings(saved);
            return await categoryDetail(saved, categoryId);
          }
          const current = isPlainObject(settings.categoryOverrides?.[categoryId])
            ? settings.categoryOverrides[categoryId] : {};
          const nextOverride = deepMergeJsonLike(current, incoming);
          const baseCategory = shared.createUnifiedCategoryCatalog()[categoryId];
          const mergedCategory = shared.mergeCategoryOverrides(baseCategory, nextOverride);
          const errors = shared.validateUnifiedCategory(mergedCategory);
          if (errors.length) throw invalidSettings(errors);
          settings.categoryOverrides[categoryId] = nextOverride;
          settings.userDataCategoryRevision =
            (Number(settings.userDataCategoryRevision) || 0) + 1;
          const saved = await shared.saveSettings(storageArea, settings);
          await mirrorCategorySettings(saved);
          return await categoryDetail(saved, categoryId);
        });
      }

      if (message.type === 'CATEGORY_APPEND_FIXED_PHRASE') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          const categoryId = String(message.categoryId || '');
          const listType = message.listType === 'exclude' ? 'exclude' : 'include';
          const field = listType === 'exclude' ? 'excludePhrases' : 'phrases';
          const phrase = String(message.phrase || '').normalize('NFKC')
            .replace(/\s+/gu, ' ').trim();
          if (!phrase || phrase.length > shared.MAX_REGEX_LENGTH) {
            throw invalidSettings(['phrase']);
          }
          const detail = await categoryDetail(settings, categoryId);
          const values = Array.isArray(detail.category.regex?.[field])
            ? [...detail.category.regex[field]] : [];
          const comparison = detail.category.regex?.caseSensitive
            ? phrase : phrase.toLocaleLowerCase('en-US');
          const duplicate = values.some(value =>
            (detail.category.regex?.caseSensitive
              ? String(value) : String(value).toLocaleLowerCase('en-US')) === comparison
          );
          if (!duplicate) values.push(phrase);
          const incoming = { regex: { [field]: values } };
          if (!detail.metadata.builtIn) {
            const mergedCategory = shared.mergeCategoryOverrides(detail.category, incoming);
            mergedCategory.categoryId = categoryId;
            mergedCategory.persistence = detail.category.persistence === 'one-off'
              ? 'one-off' : 'saved';
            mergedCategory.builtIn = false;
            const errors = shared.validateUnifiedCategory(mergedCategory);
            if (errors.length) throw invalidSettings(errors);
            if (mergedCategory.persistence === 'one-off') {
              const sessionCategories = await loadRouterSessionCategories();
              await saveRouterSessionCategories([
                ...sessionCategories.filter(item => item.categoryId !== categoryId),
                mergedCategory
              ]);
              return {
                ...(await categoryDetail(settings, categoryId)),
                appended: !duplicate,
                listType,
                phrase
              };
            }
            settings.customCategories = (settings.customCategories || [])
              .filter(item => item.categoryId !== categoryId);
            settings.customCategories.push(mergedCategory);
          } else {
            const current = isPlainObject(settings.categoryOverrides?.[categoryId])
              ? settings.categoryOverrides[categoryId] : {};
            const nextOverride = deepMergeJsonLike(current, incoming);
            const baseCategory = shared.createUnifiedCategoryCatalog()[categoryId];
            const mergedCategory = shared.mergeCategoryOverrides(baseCategory, nextOverride);
            const errors = shared.validateUnifiedCategory(mergedCategory);
            if (errors.length) throw invalidSettings(errors);
            settings.categoryOverrides[categoryId] = nextOverride;
          }
          settings.userDataCategoryRevision =
            (Number(settings.userDataCategoryRevision) || 0) + (duplicate ? 0 : 1);
          const saved = await shared.saveSettings(storageArea, settings);
          if (!duplicate) await mirrorCategorySettings(saved);
          return {
            ...(await categoryDetail(saved, categoryId)),
            appended: !duplicate,
            listType,
            phrase
          };
        });
      }

      if (message.type === 'CATEGORY_RESET_OVERRIDE') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          const categoryId = String(message.categoryId || '');
          const detail = await categoryDetail(settings, categoryId);
          if (!detail.metadata.builtIn) throw invalidSettings(['categoryId']);
          delete settings.categoryOverrides[categoryId];
          settings.userDataCategoryRevision =
            (Number(settings.userDataCategoryRevision) || 0) + 1;
          const saved = await shared.saveSettings(storageArea, settings);
          await mirrorCategorySettings(saved);
          return await categoryDetail(saved, categoryId);
        });
      }

      if (message.type === 'CATEGORY_DELETE') {
        return serializeAllMutations(async () => {
          const settings = await shared.loadSettings(storageArea);
          const categoryId = String(message.categoryId || '');
          const baseCategory = shared.createUnifiedCategoryCatalog()[categoryId];
          if (!baseCategory ||
              (settings.deletedBuiltInCategoryIds || []).includes(categoryId)) {
            throw invalidSettings(['categoryId']);
          }
          const referenceCount = await documentStore.countCategoryReferences(categoryId);
          settings.deletedBuiltInCategoryIds = [
            ...(settings.deletedBuiltInCategoryIds || []),
            categoryId
          ];
          settings.analysisModes.forEach(mode => {
            mode.categoryIds = mode.categoryIds.filter(id => id !== categoryId);
          });
          delete settings.categoryOverrides[categoryId];
          settings.selectedCategoryIds = settings.selectedCategoryIds
            .filter(item => item !== categoryId);
          Object.values(settings.viewCategoryOverrides).forEach(override => {
            override.add = override.add.filter(item => item !== categoryId);
            override.remove = override.remove.filter(item => item !== categoryId);
          });
          settings.userDataCategoryRevision =
            (Number(settings.userDataCategoryRevision) || 0) + 1;
          const saved = await shared.saveSettings(storageArea, settings);
          await mirrorCategorySettings(saved);
          return {
            ...(await publicState(saved)),
            deleted: true,
            builtIn: true,
            referenceCount
          };
        });
      }

      if (message.type === 'CATEGORY_RESTORE_BUILT_IN') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          const categoryId = String(message.categoryId || '');
          const baseCategory = shared.createUnifiedCategoryCatalog()[categoryId];
          if (!baseCategory ||
              !(settings.deletedBuiltInCategoryIds || []).includes(categoryId)) {
            throw invalidSettings(['categoryId']);
          }
          settings.deletedBuiltInCategoryIds = settings.deletedBuiltInCategoryIds
            .filter(item => item !== categoryId);
          settings.userDataCategoryRevision =
            (Number(settings.userDataCategoryRevision) || 0) + 1;
          const saved = await shared.saveSettings(storageArea, settings);
          await mirrorCategorySettings(saved);
          return publicState(saved);
        });
      }

      if (message.type === 'CATEGORY_TEST_REGEX') {
        const settings = await shared.loadSettings(storageArea);
        const categoryId = String(message.categoryId || '');
        const detail = await categoryDetail(settings, categoryId);
        if (typeof message.testText !== 'string' || message.testText.length > 20000) {
          throw invalidSettings(['testText']);
        }
        let category = detail.category;
        if (message.candidateRegex !== undefined) {
          if (!isPlainObject(message.candidateRegex)) {
            throw invalidSettings(['candidateRegex']);
          }
          category = shared.mergeCategoryOverrides(category, {
            regex: message.candidateRegex
          });
        }
        const errors = shared.validateUnifiedCategory(category);
        if (errors.length) throw invalidSettings(errors);
        return testCategoryRegex(category, message.testText);
      }

      if (message.type === 'LLM_SAVE_PROFILE') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          const result = upsertProfile(settings, message);
          const saved = await shared.saveSettings(storageArea, settings);
          return {
            ...(await publicState(saved)),
            profile: publicProfileResult(result.profileId, saved.profiles[result.profileId])
          };
        });
      }

      if (message.type === 'LLM_DUPLICATE_PROFILE') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          requireCurrentSettings(settings);
          const sourceId = String(message.profileId || '');
          const source = settings.profiles?.[sourceId];
          if (!isPlainObject(source)) throw invalidSettings(['profileId']);
          const profileId = duplicateProfileId(settings, sourceId);
          const duplicate = cloneJsonLike(source);
          duplicate.name = `${String(source.name || '')} 副本`.trim();
          const result = upsertProfile(settings, { profile: { ...duplicate, id: profileId } });
          const saved = await shared.saveSettings(storageArea, settings);
          return {
            ...(await publicState(saved)),
            profile: publicProfileResult(result.profileId, saved.profiles[result.profileId])
          };
        });
      }

      if (message.type === 'LLM_DELETE_PROFILE') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          requireCurrentSettings(settings);
          const profileId = String(message.profileId || '');
          if (!shared.PROFILE_ID_PATTERN?.test(profileId) ||
              !Object.prototype.hasOwnProperty.call(settings.profiles || {}, profileId)) {
            throw invalidSettings(['profileId']);
          }
          delete settings.profiles[profileId];
          settings.profileOrder = orderedProfileIds(settings);
          if (settings.globalProfileId === profileId ||
              !Object.prototype.hasOwnProperty.call(
                settings.profiles,
                settings.globalProfileId
              )) settings.globalProfileId = settings.profileOrder[0] || '';
          settings.taskPolicies = shared.normalizeTaskPolicies(
            settings.taskPolicies,
            settings.profiles
          );
          const saved = await shared.saveSettings(storageArea, settings);
          return {
            ...(await publicState(saved)),
            deletedProfileId: profileId
          };
        });
      }

      if (message.type === 'LLM_UPDATE_PROFILE_ROUTING') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          requireCurrentSettings(settings);
          if (message.globalProfileId !== undefined) {
            const profileId = String(message.globalProfileId || '');
            if (!Object.prototype.hasOwnProperty.call(settings.profiles || {}, profileId)) {
              throw invalidSettings(['globalProfileId']);
            }
            settings.globalProfileId = profileId;
          }
          if (message.taskPolicies !== undefined) {
            settings.taskPolicies = shared.normalizeTaskPolicies(
              message.taskPolicies,
              settings.profiles
            );
          } else if (message.taskRoutes !== undefined) {
            settings.taskPolicies = shared.migrateLegacyTaskRoutes(
              message.taskRoutes,
              settings.profiles,
              settings.globalProfileId
            );
          } else {
            settings.taskPolicies = shared.normalizeTaskPolicies(
              settings.taskPolicies,
              settings.profiles
            );
          }
          delete settings.taskRoutes;
          return publicState(await shared.saveSettings(storageArea, settings));
        });
      }

      if (message.type === 'LLM_SAVE_PROVIDER') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          requireCurrentSettings(settings);
          const providerId = String(message.providerId || '');
          const profileId = shared.legacyProfileId(providerId);
          const current = settings.profiles?.[profileId];
          const currentConfig = isPlainObject(current?.config) ? current.config : {};
          const incomingConfig = isPlainObject(message.config) ? message.config : {};
          const config = { ...cloneJsonLike(currentConfig), ...cloneJsonLike(incomingConfig) };
          if (!String(incomingConfig.apiKey || '').trim() && currentConfig.apiKey) {
            config.apiKey = currentConfig.apiKey;
          }
          const errors = shared.validateProviderConfig(providerId, config);
          if (errors.length) throw invalidSettings(errors, PROVIDER_SETTINGS_MESSAGE);
          const definition = shared.getProviderDefinitions()[providerId];
          const result = upsertProfile(settings, {
            profile: {
              ...(current || {}),
              id: profileId,
              name: current?.name || definition?.label || providerId,
              providerId,
              config
            }
          });
          const saved = await shared.saveSettings(storageArea, settings);
          return {
            ...(await publicState(saved)),
            profile: publicProfileResult(result.profileId, saved.profiles[result.profileId])
          };
        });
      }

      if (message.type === 'LLM_UPDATE_PREFERENCES') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          requireCurrentSettings(settings);
          const preferences = message.preferences && typeof message.preferences === 'object'
            ? message.preferences : {};
          Object.entries(preferences).forEach(([key, value]) => {
            if (PREFERENCE_KEYS.has(key)) settings[key] = value;
          });
          if (preferences.figurePanelHeaderFields !== undefined) {
            settings.figurePanelHeaderFields = shared.normalizeFigurePanelHeaderFields(
              preferences.figurePanelHeaderFields
            );
          }
          if (!['regex', 'llm'].includes(settings.mode)) throw invalidSettings(['mode']);
          if (preferences.providerId !== undefined) {
            const legacyProfileId = shared.legacyProfileId(preferences.providerId);
            if (!settings.profiles?.[legacyProfileId]) throw invalidSettings(['providerId']);
            settings.globalProfileId = legacyProfileId;
          }
          delete settings.providerId;
          delete settings.providers;
          if (!settings.profiles?.[settings.globalProfileId]) {
            throw invalidSettings(['globalProfileId']);
          }
          if (!Array.isArray(settings.selectedCategoryIds)) throw invalidSettings(['selectedCategoryIds']);
          const normalizedModes = shared.normalizeAnalysisModes(settings.analysisModes);
          if (preferences.analysisModes === undefined && preferences.readingViewId === 'mechanism_chain' &&
              !normalizedModes.some(mode => mode.id === 'mechanism_chain')) {
            normalizedModes.push({ id: 'mechanism_chain', ...cloneJsonLike(shared.READING_VIEWS.mechanism_chain) });
          }
          // Translate explicit legacy writes once. Stored legacy mirrors never override canonical scenarios on read.
          if (preferences.analysisModes === undefined && isPlainObject(preferences.viewCategoryOverrides)) {
            normalizedModes.forEach(mode => {
              const edit = preferences.viewCategoryOverrides[mode.id];
              if (!isPlainObject(edit)) return;
              const removed = new Set(Array.isArray(edit.remove) ? edit.remove : []);
              const baseIds = shared.READING_VIEWS?.[mode.id]?.categoryIds || mode.categoryIds;
              mode.categoryIds = [...new Set([...baseIds, ...(Array.isArray(edit.add) ? edit.add : [])])]
                .filter(id => !removed.has(id));
            });
          }
          settings.analysisModes = normalizedModes;
          if (!normalizedModes.some(mode => mode.id === settings.readingViewId)) {
            throw invalidSettings(['readingViewId']);
          }
          if (Array.isArray(preferences.selectedCategoryIds)) {
            if (preferences.analysisModes === undefined) {
              normalizedModes.find(mode => mode.id === settings.readingViewId).categoryIds = [...new Set(preferences.selectedCategoryIds)];
            }
            settings.viewCategoryOverrides[settings.readingViewId] = shared.deriveViewOverride(
              settings.readingViewId,
              preferences.selectedCategoryIds
            );
          }
          const saved = await shared.saveSettings(storageArea, settings);
          return publicState(saved);
        });
      }

      if (message.type === 'LLM_SAVE_CUSTOM_CATEGORY') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          const sessionCategories = await loadRouterSessionCategories();
          const category = shared.normalizeCustomCategory(message.category || {});
          const errors = shared.validateUnifiedCategory(category);
          const builtInIds = new Set(Object.keys(shared.createAdaptiveCategoryCatalog()));
          if (builtInIds.has(category.categoryId)) errors.push('categoryId');
          if (errors.length) throw invalidSettings([...new Set(errors)]);

          settings.customCategories = settings.customCategories
            .filter(item => item.categoryId !== category.categoryId);
          const nextSession = sessionCategories
            .filter(item => item.categoryId !== category.categoryId);
          if (category.persistence === 'one-off') nextSession.push(category);
          else settings.customCategories.push(category);
          if (!settings.selectedCategoryIds.includes(category.categoryId)) {
            settings.selectedCategoryIds.push(category.categoryId);
          }
          const currentOverride = settings.viewCategoryOverrides[settings.readingViewId] ||= { add: [], remove: [] };
          const currentMode = settings.analysisModes.find(mode => mode.id === settings.readingViewId);
          if (currentMode && !currentMode.categoryIds.includes(category.categoryId)) {
            currentMode.categoryIds.push(category.categoryId);
          }
          if (!currentOverride.add.includes(category.categoryId)) {
            currentOverride.add.push(category.categoryId);
          }
          currentOverride.remove = currentOverride.remove
            .filter(categoryId => categoryId !== category.categoryId);
          if (category.persistence === 'one-off' ||
              sessionCategories.some(item => item.categoryId === category.categoryId)) {
            await saveRouterSessionCategories(nextSession);
          }
          return publicState(await shared.saveSettings(storageArea, settings));
        });
      }

      if (message.type === 'LLM_DELETE_CUSTOM_CATEGORY') {
        return serializeAllMutations(async () => {
          const settings = await shared.loadSettings(storageArea);
          const categoryId = String(message.categoryId || '');
          const builtInIds = new Set(Object.keys(shared.createAdaptiveCategoryCatalog()));
          if (!categoryId || builtInIds.has(categoryId)) throw invalidSettings(['categoryId']);
          const sessionCategories = await loadRouterSessionCategories();
          const savedDefinition = settings.customCategories
            .find(item => item.categoryId === categoryId);
          const sessionDefinition = sessionCategories
            .find(item => item.categoryId === categoryId);
          if (!savedDefinition && !sessionDefinition) throw invalidSettings(['categoryId']);
          settings.analysisModes.forEach(mode => {
            mode.categoryIds = mode.categoryIds.filter(id => id !== categoryId);
          });
          const referenceCount = await documentStore.countCategoryReferences(categoryId);
          settings.selectedCategoryIds = settings.selectedCategoryIds
            .filter(item => item !== categoryId);
          Object.values(settings.viewCategoryOverrides).forEach(override => {
            override.add = override.add.filter(item => item !== categoryId);
            override.remove = override.remove.filter(item => item !== categoryId);
          });
          let nextSession;
          if (referenceCount > 0) {
            settings.customCategories = settings.customCategories.map(item =>
              item.categoryId === categoryId
                ? { ...item, retired: true, enabledEngines: [] }
                : item
            );
            nextSession = sessionCategories.map(item =>
              item.categoryId === categoryId
                ? { ...item, retired: true, enabledEngines: [] }
                : item
            );
          } else {
            settings.customCategories = settings.customCategories
              .filter(item => item.categoryId !== categoryId);
            nextSession = sessionCategories
              .filter(item => item.categoryId !== categoryId);
          }
          await saveRouterSessionCategories(nextSession);
          return {
            ...(await publicState(await shared.saveSettings(storageArea, settings))),
            retired: referenceCount > 0,
            referenceCount
          };
        });
      }

      if (message.type === 'LLM_LIST_MODELS') {
        const settings = await shared.loadSettings(storageArea);
        requireCurrentSettings(settings);
        const profileId = String(message.profileId || '');
        const profile = settings.profiles?.[profileId];
        if (!isPlainObject(profile)) throw invalidSettings(['profileId']);
        const providerId = String(message.providerId || profile.providerId || '');
        if (!Object.prototype.hasOwnProperty.call(
          shared.getProviderDefinitions(), providerId
        )) throw invalidSettings(['providerId']);
        const currentConfig = isPlainObject(profile.config) ? profile.config : {};
        const incomingConfig = isPlainObject(message.config) ? message.config : {};
        const config = {
          ...cloneJsonLike(currentConfig),
          ...cloneJsonLike(incomingConfig)
        };
        if (!String(incomingConfig.apiKey || '').trim() && currentConfig.apiKey) {
          config.apiKey = currentConfig.apiKey;
        }
        return shared.discoverProviderModels({
          providerId,
          config,
          fetchImpl,
          timeoutMs: 20000
        });
      }

      if (message.type === 'LLM_TEST_PROFILE') {
        const settings = await shared.loadSettings(storageArea);
        requireCurrentSettings(settings);
        const profileId = String(message.profileId || '');
        const profile = settings.profiles?.[profileId];
        if (!isPlainObject(profile)) throw invalidSettings(['profileId']);
        return runConnectionTest(profileId, profile, message.config, message.probeIds);
      }

      if (message.type === 'CODEX_LOCAL_STATUS') {
        if (!nativeClient || typeof nativeClient.health !== 'function') {
          const error = new Error('The local Codex bridge is unavailable');
          error.code = 'CODEX_BRIDGE_UNAVAILABLE';
          throw error;
        }
        const status = await nativeClient.health({ timeoutMs: 20000 });
        return {
          connected: status?.connected === true,
          accountType: String(status?.accountType || ''),
          planType: String(status?.planType || ''),
          hostVersion: String(status?.hostVersion || ''),
          eventLogPath: String(status?.eventLogPath || ''),
          latestEventPath: String(status?.latestEventPath || '')
        };
      }

      if (message.type === 'CODEX_LOCAL_LOGIN_START') {
        if (!nativeClient || typeof nativeClient.startLogin !== 'function') {
          const error = new Error('The local Codex bridge is unavailable');
          error.code = 'CODEX_BRIDGE_UNAVAILABLE';
          throw error;
        }
        const login = await nativeClient.startLogin({
          force: message.force === true,
          timeoutMs: 30000
        });
        return {
          loginId: String(login?.loginId || ''),
          authUrl: String(login?.authUrl || '')
        };
      }

      if (message.type === 'CODEX_LOCAL_LOGOUT') {
        if (!nativeClient || typeof nativeClient.logout !== 'function') {
          const error = new Error('The local Codex bridge is unavailable');
          error.code = 'CODEX_BRIDGE_UNAVAILABLE';
          throw error;
        }
        return nativeClient.logout({ timeoutMs: 30000 });
      }

      if (message.type === 'LLM_TEST_PROVIDER') {
        const settings = await shared.loadSettings(storageArea);
        requireCurrentSettings(settings);
        const providerId = String(message.providerId || '');
        const profileId = shared.legacyProfileId(providerId);
        const profile = settings.profiles?.[profileId];
        if (!isPlainObject(profile)) throw invalidSettings(['providerId']);
        return runConnectionTest(profileId, profile, message.config, message.probeIds);
      }

      if (message.type === 'DOCUMENT_PREPARE') {
        const settings = await shared.loadSettings(storageArea);
        const creationRevocationEpoch = documentCreationRevocationEpoch;
        let creator = null;
        try { creator = await checkedDocumentCreationOwner(context); } catch (_) {}
        const prepared = await prepareStoredDocument(settings, message.document, context, Boolean(creator));
        let documentCreationToken = '';
        if (creator) {
          try {
            const current = await checkedDocumentCreationOwner(context);
            if (creationRevocationEpoch === documentCreationRevocationEpoch &&
                jsonLikeEqual(creator, current)) {
              documentCreationToken = retainDocumentCreationReceipt(prepared, current);
            }
          } catch (_) { /* Ordinary prepare remains available without provenance authority. */ }
        }
        return {
          documentId: prepared.documentId,
          documentHash: prepared.documentHash,
          record: prepared.record,
          ...(documentCreationToken ? { documentCreationToken } : {}),
          studyProfile: publicStudyProfile(prepared.profile),
          paperBlueprint: prepared.profile?.paperBlueprint || null,
          readingViewId: prepared.composition.viewId,
          activeCategories: prepared.composition.categories.map(publicCategory),
          categorySources: prepared.composition.sources,
          requiresStudyType: !prepared.profile
        };
      }

      if (message.type === 'DOCUMENT_GET') {
        const documentId = String(message.documentId || '').trim();
        if (!documentId) throw invalidSettings(['documentId']);
        return { record: await documentStore.getDocument(documentId) };
      }

      if (message.type === 'ANNOTATION_UPSERT') {
        return serializeDocumentMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          const documentId = String(message.documentId || '').trim();
          if (!documentId) throw invalidSettings(['documentId']);
          if (!isPlainObject(message.annotation)) throw invalidSettings(['annotation']);
          const categoryId = String(message.annotation.categoryId || '');
          const { categoryMap } = await loadAllCategories(settings);
          const category = categoryMap[categoryId];
          if (!category) throw invalidSettings(['categoryId']);
          const trustedAnnotation = {
            ...message.annotation,
            categoryId,
            categorySnapshot: shared.makeCategorySnapshot(category)
          };
          const record = await documentStore.upsertAnnotation(documentId, trustedAnnotation);
          await mirrorDocumentRecord(record);
          return {
            record,
            annotation: record.annotations.find(item =>
              item.annotationId === trustedAnnotation.annotationId
            ),
            warningThresholdReached: record.annotations.length >=
              (shared.WARNING_ANNOTATIONS_PER_DOCUMENT || 1000)
          };
        });
      }

      if (message.type === 'ANNOTATION_DELETE') {
        return serializeDocumentMutation(async () => {
          const documentId = String(message.documentId || '').trim();
          const annotationId = String(message.annotationId || '').trim();
          if (!documentId) throw invalidSettings(['documentId']);
          if (!annotationId) throw invalidSettings(['annotationId']);
          const record = await documentStore.deleteAnnotation(documentId, annotationId);
          await mirrorDocumentRecord(record);
          return { record };
        });
      }

      if (message.type === 'ANNOTATION_CLEAR_DOCUMENT') {
        return serializeDocumentMutation(async () => {
          const documentId = String(message.documentId || '').trim();
          if (!documentId) throw invalidSettings(['documentId']);
          const record = await documentStore.clearAnnotations(documentId);
          await mirrorDocumentRecord(record);
          return { record };
        });
      }

      if (message.type === 'LLM_PREPARE_DOCUMENT') {
        const settings = await shared.loadSettings(storageArea);
        const prepared = await prepareDocument(settings, message.document);
        return {
          documentId: prepared.documentId,
          documentHash: prepared.documentHash,
          studyProfile: publicStudyProfile(prepared.studyProfile),
          paperBlueprint: prepared.paperBlueprint,
          readingViewId: prepared.readingViewId,
          activeCategories: prepared.activeCategories.map(publicCategory),
          categorySources: prepared.categorySources,
          requiresStudyType: prepared.requiresStudyType,
          profileCacheHit: false,
          fullTextAnalyzed: false
        };
      }

      if (message.type === 'LLM_SET_STUDY_TYPE') {
        return serializeDocumentMutation(async () => {
        const settings = await shared.loadSettings(storageArea);
        const rawDocumentId = String(message.documentId || '').trim();
        const documentHash = String(message.documentHash || '').toLowerCase();
        if (!rawDocumentId && !/^[a-f0-9]{64}$/.test(documentHash)) {
          throw invalidSettings(['documentId']);
        }
        if (!shared.isStudyType(message.studyType)) throw invalidSettings(['studyType']);
        let documentId = rawDocumentId || documentIdsByHash.get(documentHash);
        if (!documentId && documentHash) {
          const exported = await documentStore.exportAll();
          const matchingRecord = exported.documents.find(item =>
            item.documentHash === documentHash ||
            item.documentHashes?.includes(documentHash)
          );
          documentId = matchingRecord?.documentId;
        }
        documentId ||= `sha256:${documentHash}`;
        const record = await documentStore.setStudyType(
          documentId,
          message.studyType
        );
        await mirrorDocumentRecord(record);
        const profile = shared.createManualStudyProfile(record.studyType);
        const composition = await composeCategories(settings, profile);
        return {
          documentId,
          documentHash: documentHash || documentId.replace(/^sha256:/, ''),
          updatedAt: record.updatedAt,
          record,
          studyProfile: publicStudyProfile(profile),
          paperBlueprint: profile.paperBlueprint,
          readingViewId: composition.viewId,
          activeCategories: composition.categories.map(publicCategory),
          categorySources: composition.sources,
          requiresStudyType: false,
          profileCacheHit: false,
          fullTextAnalyzed: false
        };
        });
      }

      if (message.type === 'LLM_SEMANTIC_FIND') {
        if (typeof shared.createSemanticFindSentences !== 'function' ||
            typeof shared.runSemanticFind !== 'function') {
          const error = new Error('Semantic find engine is unavailable');
          error.code = 'SEMANTIC_FIND_UNAVAILABLE';
          throw error;
        }
        const settings = await shared.loadSettings(storageArea);
        // Semantic find owns a dedicated typed-decision route. It remains
        // available when the global generative LLM preference is disabled.
        const task = createTaskAdapter(
          settings,
          resolveLlmTaskId('LLM_SEMANTIC_FIND', 'default'),
          {}
        );
        if (typeof task.rawAdapter?.evaluateDecisions !== 'function') {
          const error = new Error('Semantic find requires typed decisions');
          error.code = 'PROVIDER_CAPABILITY_UNAVAILABLE';
          throw error;
        }
        const sentences = shared.createSemanticFindSentences(message.paragraphs);
        const result = await shared.runSemanticFind({
          query: message.query,
          sentences,
          signal: context.semanticFindSignal,
          evaluate: request => task.rawAdapter.evaluateDecisions(request),
          onProgress: context.onSemanticFindProgress
        });
        return {
          ...result,
          operationId: String(message.operationId || ''),
          sourceKey: String(message.sourceKey || ''),
          route: task.routePublic
        };
      }

      if (message.type === 'LLM_ANALYZE_DOCUMENT') {
        const operation = operationFor(message);
        await waitForOperation(operation);
        const settings = await shared.loadSettings(storageArea);
        const prepared = await prepareDocument(settings, message.document);
        if (!prepared.activeCategories.length) throw invalidSettings(['activeCategories']);
        const highlightTask = createTaskAdapter(
          settings,
          resolveLlmTaskId('LLM_ANALYZE_DOCUMENT', 'primary'),
          context
        );
        const { adapter: highlightAdapter, route: highlightRoute, routePublic } = highlightTask;
        const progress = routeProgress(context, routePublic);
        const contextHash = shared.stableHash({
          studyType: prepared.studyProfile.primaryType,
          paperBlueprint: prepared.paperBlueprint
        });
        const analysis = await shared.analyzeWithCategoryCache({
          paragraphs: prepared.paragraphs,
          selectedCategories: prepared.activeCategories,
          providerId: highlightRoute.providerId,
          model: highlightRoute.model,
          profileSignature: highlightRoute.profileSignature,
          adapter: highlightAdapter,
          cacheStore,
          // Keep one response compact enough for providers with modest output caps;
          // analysis-pipeline will split again if a single paragraph is still too dense.
          maxChars: 6400,
          concurrency: routePublic.concurrency,
          contextHash,
          viewId: prepared.readingViewId,
          paperBlueprint: prepared.paperBlueprint,
          studyProfile: prepared.studyProfile,
          signal: operation?.controller?.signal,
          waitIfPaused: () => waitForOperation(operation),
          onProgress: progress,
          onParagraphComplete: async completed => {
            await progress({
              phase: 'paragraph_checkpoint',
              chunkId: completed.chunkId,
              paragraphId: completed.paragraphId,
              checkpointedAnnotations: Array.isArray(completed.annotations)
                ? completed.annotations.length : 0,
              checkpointAnnotations: Array.isArray(completed.annotations)
                ? completed.annotations : [],
              checkpointRejected: Array.isArray(completed.rejected)
                ? completed.rejected : []
            });
          },
          onChunkComplete: async completed => {
            await progress({
              phase: 'chunk_checkpoint',
              chunkId: completed.chunkId,
              checkpointedAnnotations: Array.isArray(completed.annotations)
                ? completed.annotations.length : 0,
              // These are already validated, bounded annotations for one
              // chunk. Sending them with progress lets the page render useful
              // highlights while later chunks are still being requested.
              checkpointAnnotations: Array.isArray(completed.annotations)
                ? completed.annotations : [],
              checkpointRejected: Array.isArray(completed.rejected)
                ? completed.rejected : []
            });
          }
        });

        const annotationDigest = shared.stableHash(analysis.annotations);
        let ledgerTask = null;
        let ledgerRouteError = null;
        if (analysis.annotations.length) {
          try {
            ledgerTask = createTaskAdapter(settings,
              resolveLlmTaskId('LLM_ANALYZE_DOCUMENT', 'evidence_ledger'), context);
          } catch (error) {
            // A classification-only global profile must not discard successful
            // highlights merely because the optional prose ledger cannot run.
            if (error?.code !== 'CAPABILITY_MISMATCH' && error?.code !== 'NO_USABLE_PROFILE') throw error;
            ledgerRouteError = error;
          }
        }
        const ledgerKey = shared.buildLedgerCacheKey({
          documentHash: prepared.documentHash,
          viewId: prepared.readingViewId,
          studyTypeSignature: shared.studyTypeSignature(prepared.studyProfile),
          categorySignature: shared.stableHash(
            prepared.activeCategories.map(item => [item.categoryId, item.version])
          ),
          annotationDigest,
          ledgerVersion: shared.EVIDENCE_LEDGER_VERSION,
          profileSignature: ledgerTask?.route.profileSignature || highlightRoute.profileSignature
        });
        let ledger;
        let ledgerCacheHit = false;
        const ledgerCached = await cacheStore.getMany([ledgerKey]);
        if (ledgerCached.has(ledgerKey)) {
          ledger = ledgerCached.get(ledgerKey).ledger;
          ledgerCacheHit = true;
        } else if (!analysis.annotations.length) {
          ledger = {
            available: true,
            keyAnnotationIds: [],
            relationSummaries: [],
            reviewWarnings: [],
            auditItems: [],
            rejected: []
          };
        } else {
          try {
            if (ledgerRouteError) throw ledgerRouteError;
            ledger = await shared.reviewEvidenceLedger({
              viewId: prepared.readingViewId,
              studyProfile: prepared.studyProfile,
              annotations: analysis.annotations,
              paragraphs: prepared.paragraphs,
              adapter: ledgerTask.adapter,
              signal: operation?.controller?.signal,
              waitIfPaused: () => waitForOperation(operation)
            });
            await cacheStore.setMany([{
              key: ledgerKey,
              createdAt: Date.now(),
              ledger
            }]);
          } catch (error) {
            if (operation?.controller?.signal?.aborted || error?.code === 'CANCELLED') {
              throw shared.operationError();
            }
            ledger = {
              available: false,
              errorCode: safeError(error).code,
              keyAnnotationIds: [],
              relationSummaries: [],
              reviewWarnings: [],
              auditItems: [],
              rejected: []
            };
          }
        }

        return {
          ...analysis,
          documentId: prepared.documentId,
          documentHash: prepared.documentHash,
          studyProfile: publicStudyProfile(prepared.studyProfile),
          paperBlueprint: prepared.paperBlueprint,
          readingViewId: prepared.readingViewId,
          requiresStudyType: false,
          profileCacheHit: false,
          ledgerCacheHit,
          ledger,
          confidenceThreshold: settings.confidenceThreshold,
          semanticRejectedCount: Array.isArray(analysis.rejected)
            ? analysis.rejected.length : 0,
          categories: prepared.activeCategories.map(publicCategory),
          categorySources: prepared.categorySources,
          route: routePublic
        };
      }

      if (message.type === 'LLM_ANALYZE_FIGURES') {
        const figureSettings = await shared.loadSettings(storageArea);
        const pdfValidated = await validatePdfFigureBoundary(figureSettings, message, context);
        const result = await runIdempotentFigureRequest(message, context, async requestSignature => analyzeFigures(
          figureSettings,
          message,
          context,
          requestSignature,
          pdfValidated
        ));
        // Receipt hits (including an in-flight shared promise) bypass analysis.
        // They still must belong to the current PDF when delivered to the UI.
        await pdfValidated[0]?.assertCurrent();
        return result;
      }

      if (message.type === 'LLM_ANALYZE_FIGURE_PANEL') {
        const panelSettings = await shared.loadSettings(storageArea);
        const pdfValidated = await validatePdfFigurePanelBoundary(
          panelSettings, message, context, 'interpretation'
        );
        const result = await runIdempotentFigureRequest(
          message, context, async requestSignature => analyzeFigurePanel(
            panelSettings,
            message,
            context,
            requestSignature,
            pdfValidated
          )
        );
        await pdfValidated?.assertCurrent();
        return result;
      }

      if (message.type === 'LLM_ASK_FIGURE_PANEL') {
        const panelSettings = await shared.loadSettings(storageArea);
        const pdfValidated = await validatePdfFigurePanelBoundary(
          panelSettings, message, context, 'followup'
        );
        const result = await runIdempotentFigureRequest(
          message, context, async requestSignature => askFigurePanel(
            panelSettings,
            message,
            context,
            requestSignature,
            pdfValidated
          )
        );
        await pdfValidated?.assertCurrent();
        return result;
      }

      if (message.type === 'LLM_ASK_ARTICLE') {
        return askArticle(
          await shared.loadSettings(storageArea),
          message,
          context
        );
      }

      if (message.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC') {
        return analyzeCrossFigureLogic(
          await shared.loadSettings(storageArea),
          message,
          context
        );
      }

      if (message.type === 'LLM_ANALYZE_RESEARCH_LOGIC') {
        return analyzePaperMeta(
          await shared.loadSettings(storageArea), message, context, 'research_logic'
        );
      }

      if (message.type === 'LLM_ANALYZE_PAPER_INNOVATION') {
        return analyzePaperMeta(
          await shared.loadSettings(storageArea), message, context, 'innovation'
        );
      }

      if (message.type === 'LLM_ANALYZE_PAPER_LIMITATIONS') {
        return analyzePaperMeta(
          await shared.loadSettings(storageArea), message, context, 'limitations'
        );
      }

      if (message.type === 'LLM_AUTOFILL_LITERATURE_NOTE') {
        return autofillLiteratureNote(
          await shared.loadSettings(storageArea), message, context
        );
      }

      if (message.type === 'LLM_TRANSLATE_ABBREVIATIONS') {
        const settings = await shared.loadSettings(storageArea);
        requireLlmReady(settings);
        const byKey = new Map();
        (Array.isArray(message.entries) ? message.entries : [])
          .slice(0, 500)
          .forEach(item => {
            const entry = shared.normalizeUserAbbreviationEntry(item);
            const key = entry ? shared.abbreviationKey(entry.abbreviation) : '';
            if (entry && key) byKey.set(key, entry);
          });
        const entries = [...byKey.values()];
        if (!entries.length) throw invalidSettings(['entries']);
        const summaryTask = requireSummaryJsonCapability(createTaskAdapter(
          settings,
          resolveLlmTaskId('LLM_TRANSLATE_ABBREVIATIONS', 'default'),
          context
        ));
        const translationsByKey = new Map();
        const batchSize = 8;
        const recoverableCodes = new Set(['INVALID_RESPONSE', 'OUTPUT_TRUNCATED']);
        const rememberTranslations = values => {
          values.forEach(item => {
            translationsByKey.set(
              shared.abbreviationKey(item.abbreviation),
              item
            );
          });
          context.onProgress?.({
            phase: 'abbreviation_translation',
            completedTerms: translationsByKey.size,
            totalTerms: entries.length,
            route: summaryTask.routePublic
          });
        };
        const translateBatch = async (batch, repair = false) => {
          if (!batch.length) return;
          const prompt = shared.compileAbbreviationTranslationPrompt(batch, {
            allowPartial: true,
            repair
          });
          try {
            const response = await summaryTask.adapter.generateJson({
              ...prompt,
              outputUnits: batch.length
            });
            const translated = shared.validateAbbreviationTranslationResult(
              response,
              batch,
              { allowPartial: true }
            );
            rememberTranslations(translated);
            const missing = batch.filter(item =>
              !translationsByKey.has(shared.abbreviationKey(item.abbreviation))
            );
            if (missing.length) {
              context.onProgress?.({
                phase: 'abbreviation_translation_repair',
                completedTerms: translationsByKey.size,
                totalTerms: entries.length,
                retryTerms: missing.length,
                route: summaryTask.routePublic
              });
              await translateBatch(missing, true);
            }
          } catch (error) {
            if (!recoverableCodes.has(error?.code)) throw error;
            if (batch.length > 1) {
              const midpoint = Math.ceil(batch.length / 2);
              context.onProgress?.({
                phase: 'abbreviation_translation_split_retry',
                completedTerms: translationsByKey.size,
                totalTerms: entries.length,
                retryTerms: batch.length,
                route: summaryTask.routePublic
              });
              await translateBatch(batch.slice(0, midpoint), true);
              await translateBatch(batch.slice(midpoint), true);
              return;
            }
            if (!repair) {
              await translateBatch(batch, true);
              return;
            }
            throw error;
          }
        };
        for (let index = 0; index < entries.length; index += batchSize) {
          const batch = entries.slice(index, index + batchSize);
          context.onProgress?.({
            phase: 'abbreviation_translation',
            completedTerms: translationsByKey.size,
            totalTerms: entries.length,
            route: summaryTask.routePublic
          });
          await translateBatch(batch);
        }
        const translations = entries.map(item =>
          translationsByKey.get(shared.abbreviationKey(item.abbreviation))
        ).filter(Boolean);
        context.onProgress?.({
          phase: 'abbreviation_translation',
          completedTerms: entries.length,
          totalTerms: entries.length,
          route: summaryTask.routePublic
        });
        return {
          translations,
          providerId: summaryTask.route.providerId,
          model: summaryTask.route.model,
          route: summaryTask.routePublic
        };
      }

      if (message.type === 'LLM_ANALYZE_REVIEW_OUTLINE') {
        const settings = await shared.loadSettings(storageArea);
        const requestedParagraphIds = new Set(
          (Array.isArray(message.scopeParagraphIds) ? message.scopeParagraphIds : [])
            .map(value => String(value || '').trim())
            .filter(Boolean)
        );
        const scopeSectionIds = new Set(
          (Array.isArray(message.scopeSectionIds) ? message.scopeSectionIds : [])
            .map(value => String(value || '').trim())
            .filter(Boolean)
        );
        const scopeSelectionProvided = message.scopeSelectionProvided === true;
        const prepared = message.paragraphOnly === true
          ? await prepareParagraphOnlyReviewDocument(
            settings, message, requestedParagraphIds
          )
          : await prepareDocument(settings, message.document);
        const analysisStrategy = shared.selectArticleOutlineStrategy(prepared.studyProfile);
        const analysisParagraphs = message.paragraphOnly === true
          ? prepared.paragraphs
          : requestedParagraphIds.size
          ? prepared.paragraphs.filter(paragraph =>
              requestedParagraphIds.has(String(paragraph.paragraphId || '')))
          : scopeSelectionProvided
            ? prepared.paragraphs.filter(paragraph =>
                scopeSectionIds.has(String(paragraph.sectionId || '')) ||
                (Array.isArray(paragraph.headingPath) ? paragraph.headingPath : [])
                  .some(heading => scopeSectionIds.has(String(heading?.sectionId || ''))))
          : prepared.paragraphs;
        if (!analysisParagraphs.length) {
          throw invalidSettings(scopeSelectionProvided
            ? ['scopeSectionIds'] : ['scopeParagraphIds']);
        }
        const scopeSignature = requestedParagraphIds.size
          ? shared.stableHash({
              scopeId: String(message.scopeId || ''),
              paragraphIds: analysisParagraphs.map(paragraph => paragraph.paragraphId)
            })
          : scopeSelectionProvided
            ? shared.stableHash({
                scopeSectionIds: [...scopeSectionIds].sort(),
                paragraphIds: analysisParagraphs.map(paragraph => paragraph.paragraphId)
              })
          : '';
        const outlineTaskId = message.paragraphOnly === true
          ? resolveLlmTaskId('LLM_ANALYZE_REVIEW_OUTLINE', 'paragraph')
          : resolveLlmTaskId('LLM_ANALYZE_REVIEW_OUTLINE', 'outline');
        const summaryTask = requireSummaryJsonCapability(createTaskAdapter(
          settings, outlineTaskId, context
        ));
        const {
          adapter: summaryAdapter,
          route: summaryRoute, routePublic
        } = summaryTask;
        const progress = routeProgress(context, routePublic);
        const cacheContext = {
          documentHash: prepared.documentHash,
          providerId: summaryRoute.providerId,
          model: summaryRoute.model,
          profileSignature: summaryRoute.profileSignature,
          outlineVersion: shared.REVIEW_OUTLINE_VERSION,
          promptVersion: shared.REVIEW_PROMPT_VERSION,
          studyTypeSignature: shared.studyTypeSignature(prepared.studyProfile),
          analysisStrategy,
          scopeSignature
        };
        const outlineKey = shared.buildReviewOutlineCacheKey(cacheContext);
        const progressKey = shared.buildReviewOutlineProgressKey(cacheContext);
        const cached = await cacheStore.getMany([outlineKey, progressKey]);
        const cachedOutline = cached.get(outlineKey)?.outline;
        const responseBase = {
          documentId: prepared.documentId,
          documentHash: prepared.documentHash,
          studyProfile: publicStudyProfile(prepared.studyProfile),
          providerId: summaryRoute.providerId,
          model: summaryRoute.model,
          route: routePublic,
          analysisStrategy,
          scopeId: String(message.scopeId || '')
        };
        if (cachedOutline && message.forceRefresh !== true) {
          return { ...responseBase, outline: cachedOutline, cacheHit: true };
        }
        const progressChunks = {
          ...(cached.get(progressKey)?.chunks || {})
        };
        const maxChars = Math.min(10000, Math.max(100, Number(message.maxChars) || 10000));
        const outline = await shared.analyzeReviewOutline({
          paragraphs: analysisParagraphs,
          articleTitle: message.document?.title || '',
          reviewSubtype: prepared.studyProfile.reviewSubtype,
          analysisStrategy,
          documentHash: prepared.documentHash,
          adapter: summaryAdapter,
          paragraphOnly: message.paragraphOnly === true,
          resumeChunks: new Map(Object.entries(progressChunks)),
          maxChars,
          sleepImpl,
          onProgress: progress,
          onChunkComplete: async completed => {
            progressChunks[completed.chunkId] = completed;
            await cacheStore.setMany([{
              key: progressKey,
              createdAt: Date.now(),
              chunks: progressChunks
            }]);
            await progress({
              phase: 'review_chunk_checkpoint',
              chunkId: completed.chunkId,
              checkpointSummaries: completed.summaries,
              scopeId: String(message.scopeId || ''),
              paragraphOnly: message.paragraphOnly === true,
              completedChunks: Object.keys(progressChunks).length,
              completedParagraphs: new Set(Object.values(progressChunks)
                .flatMap(item => item?.paragraphIds || [])).size,
              totalParagraphs: analysisParagraphs.length
            });
          }
        });
        await cacheStore.setMany([{
          key: outlineKey,
          createdAt: Date.now(),
          outline
        }]);
        return { ...responseBase, outline, cacheHit: false };
      }

      if (message.type === 'LLM_RECORD_FEEDBACK') {
        const sample = shared.normalizeFeedbackSample(message.sample || {});
        const missing = ['documentHash', 'paragraphId', 'quote', 'categoryId']
          .filter(field => !sample[field]);
        if (missing.length) throw invalidSettings(missing);
        await corpusStore.add(sample);
        const stats = await corpusStore.stats();
        const samples = await corpusStore.list();
        await mirrorText('corpus/feedback.jsonl', shared.exportCorpus(samples, 'jsonl'));
        return {
          saved: true,
          stats,
          suggestExport: stats.documents >= 3 && stats.accepted + stats.corrected >= 3
        };
      }

      if (message.type === 'LLM_CORPUS_STATUS') {
        const stats = await corpusStore.stats();
        return {
          stats,
          suggestExport: stats.documents >= 3 && stats.accepted + stats.corrected >= 3
        };
      }

      if (message.type === 'LLM_EXPORT_CORPUS') {
        const format = message.format === 'csv' ? 'csv' : 'jsonl';
        const samples = await corpusStore.list();
        return {
          format,
          content: shared.exportCorpus(samples, format),
          mimeType: format === 'csv'
            ? 'text/csv;charset=utf-8' : 'application/x-ndjson;charset=utf-8',
          filename: `sci-llm-corpus-${new Date().toISOString().slice(0, 10)}.${format}`
        };
      }

      if (message.type === 'LLM_DISTILL_RULES') {
        const samples = await corpusStore.list();
        const settings = await shared.loadSettings(storageArea);
        const categoryMap = shared.createAdaptiveCategoryCatalog();
        (settings.deletedBuiltInCategoryIds || []).forEach(categoryId => {
          delete categoryMap[categoryId];
        });
        [...settings.customCategories, ...await loadRouterSessionCategories()]
          .forEach(category => { categoryMap[category.categoryId] = category; });
        return {
          rules: shared.distillOfflineRules(samples, categoryMap),
          stats: await corpusStore.stats()
        };
      }

      throw Object.assign(new Error('Unknown message'), { code: 'UNKNOWN_MESSAGE' });
    }

    async function handle(message, context = {}) {
      try {
        const ownerGuardRequired = requiresModernFigureContract(message) ||
          message?.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC' ||
          ['figure', 'mechanism'].includes(message?.operationScope);
        if (ownerGuardRequired) await ensureTrustedTabRetirementsRecovered();
        if (ownerGuardRequired && typeof context?.assertTrustedOwnerCurrent === 'function') {
          await context.assertTrustedOwnerCurrent();
        }
        const data = await handleUnsafe(message || {}, context);
        if (ownerGuardRequired && typeof context?.assertTrustedOwnerCurrent === 'function') {
          await context.assertTrustedOwnerCurrent();
        }
        return { success: true, data };
      } catch (error) {
        const safe = String(message?.type || '').startsWith('PORTABLE_CONFIG_')
          ? safePortableConfigError(error)
          : error;
        return { success: false, error: safeError(safe) };
      }
    }

    function detachRetiredFigureOperations(operationIds) {
      for (const operationId of Array.isArray(operationIds) ? operationIds : []) {
        try {
          if (operationRegistry?.isActive?.(operationId)) {
            operationRegistry.control(operationId, 'cancel');
          }
        } catch (_) {}
        releaseFigureOperationContracts(operationId);
      }
    }

    async function commitTrustedDocument(input) {
      await ensureTrustedTabRetirementsRecovered();
      const trusted = {
        senderExtensionId: String(input?.senderExtensionId || runtimeExtensionId || ''),
        senderTabId: Number(input?.senderTabId),
        senderFrameId: Number(input?.senderFrameId),
        senderDocumentId: String(input?.senderDocumentId || '')
      };
      const figureResult = await durableFigureProviderAttemptLedger
        .commitTrustedDocument(trusted);
      detachRetiredFigureOperations(figureResult?.removedOperationIds);
      const mechanismResult = mechanismCoordinator?.commitTrustedDocument
        ? await mechanismCoordinator.commitTrustedDocument(trusted)
        : { cleaned: 0 };
      return { figure: figureResult || {}, mechanism: mechanismResult || {} };
    }

    async function retireTrustedTab(input) {
      await ensureTrustedTabRetirementsRecovered();
      const trusted = {
        senderExtensionId: String(input?.senderExtensionId || runtimeExtensionId || ''),
        senderTabId: Number(input?.senderTabId)
      };
      return queueTrustedTabRetirement(() => finishTrustedTabRetirement(trusted));
    }

    return { handle, commitTrustedDocument, retireTrustedTab };
  }

  return {
    EVIDENCE_FIRST_REQUEST_CONTRACT,
    FIGURE_PROVIDER_ATTEMPT_HARD_LIMIT,
    LLM_TASK_DISPATCH,
    resolveLlmTaskId,
    buildTaskPolicySignature,
    deriveFigureProviderAttemptBudget,
    createFigureProviderAttemptLedger,
    createMechanismBrowserSessionIdentityProvider,
    createBackgroundRouter,
    createPortableConfigStorageChangeListener
  };
});
