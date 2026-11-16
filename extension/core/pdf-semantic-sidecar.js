(function attach(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(root) {
  const NATIVE_DOCUMENT_KEY = '__brevessNativePdfDocument';
  const HASH_PATTERN = /^[a-f0-9]{64}$/u;

  function error(code) {
    const failure = new Error(code);
    failure.code = code;
    return failure;
  }

  function positiveInteger(value, code) {
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number) || number < 1) throw error(code);
    return number;
  }

  function canonicalHash(value) {
    const hash = String(value || '').trim().toLowerCase().replace(/^sha256:/u, '');
    if (!HASH_PATTERN.test(hash)) throw error('PDF_SIDECAR_DOCUMENT_HASH');
    return hash;
  }

  function clone(value, code = 'PDF_SIDECAR_NOT_CLONEABLE') {
    try {
      return structuredClone(value);
    } catch (_failure) {
      throw error(code);
    }
  }

  function deepFreeze(value, seen = new Set()) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function') ||
        seen.has(value)) return value;
    seen.add(value);
    for (const child of Object.values(value)) deepFreeze(child, seen);
    return Object.freeze(value);
  }

  function frozenClone(value, code) {
    return deepFreeze(clone(value, code));
  }

  const immutablePlainValues = new WeakSet();
  const cloneCompatiblePlainValues = new WeakSet();

  function certifyImmutablePlain(value, cloneCompatible = false) {
    const certified = cloneCompatible ? cloneCompatiblePlainValues : immutablePlainValues;
    const pending = [value];
    const checked = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (!current || typeof current !== 'object') {
        if (typeof current === 'function' ||
            (cloneCompatible && typeof current === 'symbol')) return false;
        continue;
      }
      if (certified.has(current) || checked.has(current)) continue;
      const prototype = Object.getPrototypeOf(current);
      if (!Object.isFrozen(current) || (Array.isArray(current)
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && (cloneCompatible || prototype !== null))) return false;
      checked.add(current);
      for (const key of Reflect.ownKeys(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!Object.hasOwn(descriptor, 'value')) return false;
        // Reusing a received graph must preserve structuredClone normalization.
        if (cloneCompatible && (typeof key === 'symbol' ||
            (!descriptor.enumerable && !(Array.isArray(current) && key === 'length')))) return false;
        pending.push(descriptor.value);
      }
    }
    // Certify the complete graph together: a cycle must not hide a mutable
    // exotic value behind a partially certified ancestor.
    for (const current of checked) {
      immutablePlainValues.add(current);
      if (cloneCompatible) cloneCompatiblePlainValues.add(current);
    }
    return true;
  }

  function safeErrorCode(value, fallback = 'PDF_SIDECAR_BUILD_FAILED') {
    const code = String(value || '');
    return /^PDF_[A-Z0-9_]{1,80}$/u.test(code) ? code : fallback;
  }

  function createPdfSemanticSidecarCoordinator(options = {}) {
    if (typeof options.buildIndex !== 'function') throw error('PDF_SIDECAR_BUILD_INDEX');
    const isReusableWorkerResult = root.SciLLM?.isPdfSemanticWorkerResultReusable;
    const batchDelayMs = Number.isFinite(Number(options.batchDelayMs))
      ? Math.max(0, Math.min(1000, Number(options.batchDelayMs))) : 32;
    const enqueue = typeof options.enqueue === 'function' ? options.enqueue
      : callback => setTimeout(callback, batchDelayMs);
    const listeners = new Set();
    const pages = new Map();
    const mountedPages = new Set();
    const flushWaiters = [];
    let firstPageWaiters = [];
    let indexWaiters = [];
    let source = null;
    let nextSourceId = 1;
    let semanticRevision = 0;
    let visiblePageNumber = null;
    let viewActive = false;
    let phase = 'idle';
    let index = null;
    let indexCanShare = false;
    let sortedPageSnapshot = null;
    let sortedPagesCanShare = false;
    let indexedPages = 0;
    let indexedRevision = 0;
    let degraded = false;
    let errorCode = null;
    let dirty = false;
    let scheduled = false;
    let scheduleEpoch = 0;
    let inFlight = null;
    let disposed = false;
    let terminal = false;
    let buildsStarted = 0;
    let buildsCommitted = 0;
    let buildsFailed = 0;
    let staleBuilds = 0;
    let collectionSealed = false;
    let previewCommittedRevision = 0;
    let previewEpoch = 0;
    let previewCommittedEpoch = -1;

    const currentToken = () => source ? deepFreeze({ sourceId: source.sourceId,
      documentHash: source.documentHash,
      documentGeneration: source.documentGeneration,
      revision: source.sourceRevision }) : null;

    function completeCoverage() {
      if (!source?.expectedPageCount || pages.size !== source.expectedPageCount) return false;
      for (let pageNumber = 1; pageNumber <= source.expectedPageCount; pageNumber += 1) {
        if (!pages.has(pageNumber)) return false;
      }
      return true;
    }

    const counts = () => {
      const hasPendingBuild = dirty || scheduled || Boolean(inFlight);
      const pendingPages = hasPendingBuild && pages.size
        ? Math.max(pages.size - indexedPages, indexedRevision === semanticRevision ? 0 : 1)
        : 0;
      return { canonicalPages: pages.size, indexedPages,
        pendingPages, buildsStarted, buildsCommitted,
        buildsFailed, staleBuilds };
    };

    const coverage = () => ({ expectedPages: source?.expectedPageCount || 0,
      availablePages: pages.size, indexedPages, complete: completeCoverage() });

    function snapshotPages() {
      if (!sortedPageSnapshot) {
        sortedPageSnapshot = Object.freeze([...pages.values()]
          .sort((left, right) => left.pageNumber - right.pageNumber));
        sortedPagesCanShare = certifyImmutablePlain(sortedPageSnapshot);
      }
      return sortedPagesCanShare ? sortedPageSnapshot
        : frozenClone(sortedPageSnapshot, 'PDF_SIDECAR_SNAPSHOT_CLONE');
    }

    function snapshotValue() {
      const currentIndex = indexedRevision === semanticRevision ? index : null;
      return {
        phase,
        documentGeneration: source?.documentGeneration || 0,
        revision: semanticRevision,
        source: source ? Object.freeze({
          nativeDocumentKey: source.nativeDocumentKey,
          documentHash: source.documentHash,
          documentGeneration: source.documentGeneration,
          revision: source.sourceRevision,
          workspaceDocumentId: source.workspaceDocumentId,
          expectedPageCount: source.expectedPageCount
        }) : null,
        counts: Object.freeze(counts()),
        coverage: Object.freeze(coverage()),
        degraded,
        errorCode,
        collectionSealed,
        indexedRevision,
        viewActive,
        visiblePageNumber,
        pages: snapshotPages(),
        index: currentIndex === null || indexCanShare ? currentIndex
          : frozenClone(currentIndex, 'PDF_SIDECAR_SNAPSHOT_CLONE')
      };
    }

    const getSnapshot = () => Object.freeze(snapshotValue());

    function progressEvent() {
      return deepFreeze({ phase,
        documentGeneration: source?.documentGeneration || 0,
        revision: semanticRevision,
        counts: deepFreeze(counts())
      });
    }

    function emit() {
      const event = progressEvent();
      for (const listener of listeners) {
        try { listener(event); } catch (_failure) { /* Listener isolation is intentional. */ }
      }
    }

    function settle(waiters, value, rejection = null) {
      const pending = waiters.splice(0);
      for (const waiter of pending) {
        if (rejection) waiter.reject(rejection);
        else waiter.resolve(value);
      }
    }

    function isIdle() {
      return !scheduled && !inFlight && !dirty;
    }

    function settleFlushWaiters() {
      if (!flushWaiters.length || !isIdle()) return;
      const value = getSnapshot();
      settle(flushWaiters, value);
    }

    function abortBuild() {
      scheduleEpoch += 1;
      if (inFlight) inFlight.controller.abort();
      inFlight = null;
      scheduled = false;
      dirty = false;
    }

    function resetContent() {
      pages.clear();
      sortedPageSnapshot = null;
      sortedPagesCanShare = false;
      mountedPages.clear();
      index = null;
      indexCanShare = false;
      indexedPages = 0;
      indexedRevision = 0;
      visiblePageNumber = null;
      collectionSealed = false;
      previewCommittedRevision = 0;
      previewEpoch = 0;
      previewCommittedEpoch = -1;
      dirty = false;
    }

    function sameSourceWork(sourceToken, nativeDocument) {
      return Boolean(source && !disposed && !terminal && sourceToken &&
        nativeDocument === source.nativeDocument &&
        Number(sourceToken.sourceId) === source.sourceId &&
        String(sourceToken.documentHash || '').toLowerCase() === source.documentHash &&
        Number(sourceToken.documentGeneration) === source.documentGeneration &&
        Number(sourceToken.revision) === source.sourceRevision);
    }

    function validateSource(input = {}) {
      if ((typeof input.nativeDocument !== 'object' || input.nativeDocument === null) &&
          typeof input.nativeDocument !== 'function') {
        throw error('PDF_SIDECAR_NATIVE_DOCUMENT');
      }
      if (input.nativeDocumentKey !== NATIVE_DOCUMENT_KEY) {
        throw error('PDF_SIDECAR_NATIVE_DOCUMENT_KEY');
      }
      const documentHash = canonicalHash(input.documentHash);
      if (input.workspaceDocumentId !== `sha256:${documentHash}`) {
        throw error('PDF_SIDECAR_WORKSPACE_ID');
      }
      return {
        nativeDocument: input.nativeDocument,
        nativeDocumentKey: NATIVE_DOCUMENT_KEY,
        documentHash,
        documentGeneration: positiveInteger(input.documentGeneration,
          'PDF_SIDECAR_DOCUMENT_GENERATION'),
        sourceRevision: positiveInteger(input.revision, 'PDF_SIDECAR_SOURCE_REVISION'),
        expectedPageCount: Math.max(0, Math.floor(Number(input.expectedPageCount) || 0)),
        workspaceDocumentId: `sha256:${documentHash}`
      };
    }

    function activateSource(input) {
      if (disposed) throw error('PDF_SIDECAR_DISPOSED');
      const next = validateSource(input);
      abortBuild();
      if (source) {
        settle(firstPageWaiters, null, error('PDF_SIDECAR_SOURCE_REPLACED'));
        settle(indexWaiters, null, error('PDF_SIDECAR_SOURCE_REPLACED'));
      }
      resetContent();
      firstPageWaiters = [];
      indexWaiters = [];
      source = { ...next, sourceId: nextSourceId++ };
      semanticRevision = source.sourceRevision;
      viewActive = true;
      phase = 'loading';
      degraded = false;
      errorCode = null;
      terminal = false;
      buildsStarted = 0;
      buildsCommitted = 0;
      buildsFailed = 0;
      staleBuilds = 0;
      emit();
      settleFlushWaiters();
      return currentToken();
    }

    function validatePage(record) {
      const page = clone(record, 'PDF_SIDECAR_PAGE_NOT_CLONEABLE');
      const pageNumber = positiveInteger(page?.pageNumber, 'PDF_SIDECAR_PAGE_NUMBER');
      if (page?.recordType !== 'pdf-canonical-page' ||
          String(page.contentHash || '').length < 1 ||
          page.legacyParagraphId !== `pdf-page-${pageNumber}` ||
          page.sourceIdentity !== `pdf:${pageNumber}` ||
          String(page.binding?.documentHash || '').toLowerCase() !== source.documentHash ||
          Number(page.binding?.documentGeneration) !== source.documentGeneration ||
          Number(page.binding?.revision) !== source.sourceRevision) {
        throw error('PDF_SIDECAR_PAGE_BINDING');
      }
      return deepFreeze(page);
    }

    function pagePriority(left, right) {
      if (!visiblePageNumber) return left.pageNumber - right.pageNumber;
      const rank = page => page.pageNumber === visiblePageNumber ? 0
        : Math.abs(page.pageNumber - visiblePageNumber) === 1 ? 1 : 2;
      return rank(left) - rank(right) || left.pageNumber - right.pageNumber;
    }

    function buildIsCurrent(job) {
      return Boolean(source && !disposed && !terminal && !job.controller.signal.aborted &&
        source === job.source && source.nativeDocument === job.nativeDocument &&
        source.sourceId === job.sourceToken.sourceId &&
        source.documentHash === job.sourceToken.documentHash &&
        source.documentGeneration === job.sourceToken.documentGeneration &&
        source.sourceRevision === job.sourceToken.revision &&
        semanticRevision === job.semanticRevision &&
        collectionSealed === job.collectionSealed &&
        (job.collectionSealed || previewEpoch === job.previewEpoch));
    }

    function previewPages() {
      if (!visiblePageNumber) return [];
      return [visiblePageNumber, visiblePageNumber - 1, visiblePageNumber + 1]
        .map(pageNumber => pages.get(pageNumber))
        .filter(Boolean)
        .sort(pagePriority);
    }

    function canBuild() {
      if (!dirty || !source || !pages.size || terminal || disposed) return false;
      if (collectionSealed) return true;
      return (previewCommittedRevision !== semanticRevision ||
        previewCommittedEpoch !== previewEpoch) && previewPages().length > 0;
    }

    function scheduleBuild() {
      if (scheduled || inFlight || !canBuild()) return;
      scheduled = true;
      const epoch = ++scheduleEpoch;
      enqueue(() => {
        if (epoch !== scheduleEpoch) return;
        scheduled = false;
        startBuild();
      });
    }

    function startBuild() {
      if (inFlight || !canBuild()) {
        settleFlushWaiters();
        return;
      }
      dirty = false;
      const selectedPages = collectionSealed
        ? [...pages.values()].sort((left, right) => left.pageNumber - right.pageNumber)
        : previewPages();
      const orderedPages = selectedPages.map(page => clone(page));
      const sourceToken = currentToken();
      const controller = new AbortController();
      const job = { source, nativeDocument: source.nativeDocument, sourceToken,
        semanticRevision, collectionSealed, previewEpoch, controller, promise: null };
      const input = {
        nativeDocumentKey: source.nativeDocumentKey,
        workspaceDocumentId: source.workspaceDocumentId,
        documentHash: source.documentHash,
        documentGeneration: source.documentGeneration,
        sourceRevision: source.sourceRevision,
        revision: semanticRevision,
        expectedPageCount: source.expectedPageCount,
        buildScope: collectionSealed ? 'full' : 'visible-adjacent-preview',
        pagePriority: orderedPages.map(page => page.pageNumber),
        pages: orderedPages
      };
      buildsStarted += 1;
      emit();
      job.promise = Promise.resolve().then(() => options.buildIndex(input,
        { signal: controller.signal, sourceToken }))
        .then(result => {
          if (!buildIsCurrent(job)) {
            if (source === job.source && !terminal && !disposed) {
              staleBuilds += 1;
              emit();
            }
            return;
          }
          try {
            const reuse = typeof isReusableWorkerResult === 'function' &&
              isReusableWorkerResult(result) === true && certifyImmutablePlain(result, true);
            index = reuse ? result : frozenClone(result, 'PDF_SIDECAR_INDEX_NOT_CLONEABLE');
            indexCanShare = reuse || certifyImmutablePlain(index);
          } catch (failure) {
            buildsFailed += 1;
            degraded = true;
            errorCode = safeErrorCode(failure?.code);
            phase = pages.size ? 'partial' : 'loading';
            index = null;
            indexedPages = 0;
            indexedRevision = 0;
            if (indexWaiters.length) settle(indexWaiters, getSnapshot());
            emit();
            return;
          }
          indexedPages = input.pages.length;
          indexedRevision = job.semanticRevision;
          if (!job.collectionSealed) {
            previewCommittedRevision = job.semanticRevision;
            previewCommittedEpoch = job.previewEpoch;
          }
          buildsCommitted += 1;
          degraded = false;
          errorCode = null;
          phase = job.collectionSealed && completeCoverage() && indexedPages === pages.size
            ? 'ready' : 'partial';
          if (indexWaiters.length) settle(indexWaiters, getSnapshot());
          emit();
        }, failure => {
          if (!buildIsCurrent(job)) return;
          buildsFailed += 1;
          degraded = true;
          errorCode = safeErrorCode(failure?.code);
          phase = pages.size ? 'partial' : 'loading';
          index = null;
          indexedPages = 0;
          indexedRevision = 0;
          if (indexWaiters.length) settle(indexWaiters, getSnapshot());
          emit();
        })
        .finally(() => {
          if (inFlight === job) inFlight = null;
          if (dirty) scheduleBuild();
          settleFlushWaiters();
        });
      inFlight = job;
    }

    function upsertCanonicalPage(input = {}) {
      if (!sameSourceWork(input.sourceToken, input.nativeDocument)) {
        return { accepted: false, changed: false, reason: 'stale-source' };
      }
      const page = validatePage(input.record);
      if (source.expectedPageCount > 0 && page.pageNumber > source.expectedPageCount) {
        return { accepted: false, changed: false, reason: 'out-of-range' };
      }
      const existing = pages.get(page.pageNumber);
      if (existing?.contentHash === page.contentHash) {
        mountedPages.add(page.pageNumber);
        return { accepted: true, changed: false, revision: semanticRevision };
      }
      pages.set(page.pageNumber, page);
      sortedPageSnapshot = null;
      sortedPagesCanShare = false;
      mountedPages.add(page.pageNumber);
      semanticRevision += 1;
      collectionSealed = false;
      index = null;
      indexedPages = 0;
      indexedRevision = 0;
      dirty = true;
      phase = 'partial';
      degraded = false;
      errorCode = null;
      if (pages.size === 1 && firstPageWaiters.length) {
        settle(firstPageWaiters, getSnapshot());
      }
      emit();
      scheduleBuild();
      return { accepted: true, changed: true, revision: semanticRevision };
    }

    function setVisiblePage(input = {}) {
      if (!sameSourceWork(input.sourceToken, input.nativeDocument)) return false;
      const nextPageNumber = positiveInteger(input.pageNumber, 'PDF_SIDECAR_VISIBLE_PAGE');
      if (visiblePageNumber !== nextPageNumber && !collectionSealed) {
        previewEpoch += 1;
        previewCommittedEpoch = -1;
        if (pages.size) {
          index = null;
          indexedPages = 0;
          indexedRevision = 0;
          dirty = true;
        }
      }
      visiblePageNumber = nextPageNumber;
      scheduleBuild();
      return true;
    }

    function markCollectionComplete(input = {}) {
      if (!sameSourceWork(input.sourceToken, input.nativeDocument)) {
        return { accepted: false, changed: false, reason: 'stale-source' };
      }
      if (!completeCoverage()) {
        return { accepted: false, changed: false, reason: 'incomplete-collection' };
      }
      if (collectionSealed) {
        return { accepted: true, changed: false, sealed: true, revision: semanticRevision };
      }
      collectionSealed = true;
      dirty = true;
      phase = 'partial';
      emit();
      scheduleBuild();
      return { accepted: true, changed: true, sealed: true, revision: semanticRevision };
    }

    function markPageUnmounted(input = {}) {
      if (!sameSourceWork(input.sourceToken, input.nativeDocument)) return false;
      mountedPages.delete(positiveInteger(input.pageNumber, 'PDF_SIDECAR_PAGE_NUMBER'));
      return true;
    }

    function deactivateView(input = {}) {
      if (!sameSourceWork(input.sourceToken, input.nativeDocument)) return false;
      if (!viewActive) return true;
      viewActive = false;
      emit();
      return true;
    }

    function activateView(input = {}) {
      if (!sameSourceWork(input.sourceToken, input.nativeDocument)) return false;
      if (viewActive) return true;
      viewActive = true;
      emit();
      return true;
    }

    function whenFirstPageAvailable() {
      if (pages.size) return Promise.resolve(getSnapshot());
      if (!source || terminal || disposed) {
        return Promise.reject(error('PDF_SIDECAR_SOURCE_UNAVAILABLE'));
      }
      return new Promise((resolve, reject) => firstPageWaiters.push({ resolve, reject }));
    }

    function whenIndexAvailable() {
      if (index && indexedRevision === semanticRevision) return Promise.resolve(getSnapshot());
      if (!source || terminal || disposed) {
        return Promise.reject(error('PDF_SIDECAR_SOURCE_UNAVAILABLE'));
      }
      return new Promise((resolve, reject) => indexWaiters.push({ resolve, reject }));
    }

    function flush() {
      if (source && pages.size && !collectionSealed && !terminal && !disposed) {
        collectionSealed = true;
        dirty = true;
        phase = 'partial';
        emit();
        scheduleBuild();
      }
      if (isIdle()) return Promise.resolve(getSnapshot());
      return new Promise((resolve, reject) => flushWaiters.push({ resolve, reject }));
    }

    function enterTerminalFallback(input = {}) {
      if (!sameSourceWork(input.sourceToken, input.nativeDocument)) return false;
      abortBuild();
      resetContent();
      terminal = true;
      viewActive = false;
      phase = 'fallback';
      degraded = true;
      errorCode = safeErrorCode(input.errorCode, 'PDF_SIDECAR_TERMINAL_FALLBACK');
      settle(firstPageWaiters, null, error('PDF_SIDECAR_TERMINAL_FALLBACK'));
      settle(indexWaiters, null, error('PDF_SIDECAR_TERMINAL_FALLBACK'));
      emit();
      settleFlushWaiters();
      return true;
    }

    function dispose() {
      if (disposed) return;
      abortBuild();
      resetContent();
      source = null;
      semanticRevision = 0;
      terminal = false;
      disposed = true;
      viewActive = false;
      phase = 'disposed';
      degraded = false;
      errorCode = null;
      settle(firstPageWaiters, null, error('PDF_SIDECAR_DISPOSED'));
      settle(indexWaiters, null, error('PDF_SIDECAR_DISPOSED'));
      emit();
      settleFlushWaiters();
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw error('PDF_SIDECAR_LISTENER');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    return Object.freeze({ activateSource, upsertCanonicalPage, setVisiblePage,
      markCollectionComplete, markPageUnmounted, deactivateView, activateView, whenFirstPageAvailable,
      whenIndexAvailable, enterTerminalFallback, getSnapshot, flush, subscribe, dispose });
  }

  return { NATIVE_DOCUMENT_KEY, createPdfSemanticSidecarCoordinator };
});
