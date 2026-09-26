import { getDocument, GlobalWorkerOptions, OPS, TextLayer } from './vendor/pdfjs/build/pdf.min.mjs';

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/build/pdf.worker.min.mjs');

const viewer = document.getElementById('pdfNativeViewer');
const fallbackFrame = document.getElementById('pdfOriginalFrame');
const bridge = globalThis.__brevessPdfReaderBridge;
const MAX_NATIVE_PDF_TEXT_CHARACTERS = 4_000_000;
const MAX_NATIVE_PDF_IMAGE_PIXELS = 16_000_000;
const stateController = globalThis.SciLLM.createPdfNativeReaderState({
  initialScale: 1.35, minScale: 0.5, maxScale: 3, overscan: 1, maxLivePages: 7
});
let renderQueue = globalThis.SciLLM.createPdfNativeTaskQueue({
  concurrency: 2, maxPending: 12
});
let indexQueue = globalThis.SciLLM.createPdfNativeTaskQueue({
  concurrency: 2, maxPending: 2
});
let imageRenderQueue = globalThis.SciLLM.createPdfNativeTaskQueue({
  concurrency: 1, maxPending: 2
});

function renewNativeTaskQueues() {
  renderQueue = globalThis.SciLLM.createPdfNativeTaskQueue({
    concurrency: 2, maxPending: 12
  });
  indexQueue = globalThis.SciLLM.createPdfNativeTaskQueue({
    concurrency: 2, maxPending: 2
  });
  imageRenderQueue = globalThis.SciLLM.createPdfNativeTaskQueue({
    concurrency: 1, maxPending: 2
  });
}
const canvasBudget = globalThis.SciLLM.createPdfNativeCanvasBudget({
  // Two exact-visible pages at maximum reader zoom and DPR 2.5 require about
  // 53 M pixels. Keep that clarity case inside one explicit hard bound.
  maxPixels: 64_000_000, maxBytes: 256_000_000, maxLivePages: 7, maxOutputScale: 2.5
});
const textBudget = globalThis.SciLLM.createPdfNativeTextBudget({
  maxChars: MAX_NATIVE_PDF_TEXT_CHARACTERS
});
const pageRecords = new Map();
const ocrTextPages = new Map();
const nativePageTextContentLoads = new Map();
const visiblePages = new Set();
const renderFailureDocumentGenerations = new WeakMap();
const lifecycle = globalThis.SciLLM.createPdfNativeLifecycle();
const renderGeneration = globalThis.SciLLM.createPdfNativeRenderGeneration();
let pdfDocument = null;
let loadingTask = null;
let incrementalDocument = null;
let outlineCache = [];
let renderObserver = null;
let resizeObserver = null;
let pendingFocusPage = 0;
let pendingFocusNavigationSequence = 0;
let nativeNavigationSequence = 0;
let viewportWantedPages = new Set([1]);
let nativeNavigationPages = new Set();
let wantedPages = new Set([1]);
let active = true;
let disposed = false;
let loadedDocumentHash = '';
let loadedSourceHash = '';
let nativeDocumentGeneration = 0;
let pdfAnnotationSnapshot = Object.freeze({ documentHash: '', annotations: [] });
let pdfSemanticSidecar = null;
let pdfSemanticWorkerClient = null;
let pdfSemanticSourceToken = null;
let pdfSemanticSourceDocument = null;
let pdfSemanticOutline = [];
let pdfSemanticPublishedBuilds = 0;
let nativeViewerPublishedGeneration = 0;
let pdfSemanticCompatibilityOwner = null;
const nativeSemanticFocusRequestBindings = new WeakMap();
let nativeSemanticFocusOwnerToken = '';

function refreshNativeWantedPages() {
  wantedPages = new Set([...viewportWantedPages, ...nativeNavigationPages]);
}

function beginNativePdfNavigation(request) {
  nativeNavigationSequence += 1;
  pendingFocusPage = 0;
  pendingFocusNavigationSequence = 0;
  clearNativePdfSemanticFocus();
  const requestedPages = request?.mode === 'page-only'
    ? request.pageNumbers : request?.ranges?.map(range => range?.pageNumber);
  nativeNavigationPages = new Set((Array.isArray(requestedPages) ? requestedPages : [])
    .filter(pageNumber => Number.isSafeInteger(pageNumber) && pageNumber > 0));
  refreshNativeWantedPages();
  return nativeNavigationSequence;
}

function createPdfNativeInitializationLeaseController(getCurrentGeneration) {
  let activeLease = null;
  let completedLease = null;
  let completedGeneration = 0;
  let completedResult;
  return Object.freeze({
    run(input = {}) {
      const documentGeneration = Number(input.documentGeneration) || 0;
      if (activeLease?.documentGeneration === documentGeneration) {
        return activeLease.promise;
      }
      if (completedGeneration === documentGeneration &&
          completedLease?.canCommit()) {
        return Promise.resolve(completedResult);
      }
      const lifecycleToken = typeof input.createLifecycleToken === 'function'
        ? input.createLifecycleToken() : input.lifecycleToken;
      const lease = {
        documentGeneration,
        lifecycleToken,
        promise: null,
        canCommit() {
          return (activeLease === lease || completedLease === lease) &&
            getCurrentGeneration() === documentGeneration &&
            input.canLifecycleCommit(lifecycleToken);
        }
      };
      activeLease = lease;
      lease.promise = Promise.resolve().then(() => input.task(lease)).then(result => {
        if (lease.canCommit() && result?.complete) {
          completedLease = lease;
          completedGeneration = documentGeneration;
          completedResult = result;
        }
        return result;
      }).finally(() => {
        if (activeLease === lease) activeLease = null;
      });
      return lease.promise;
    }
  });
}

function createPdfNativeSemanticFocusController(input = {}) {
  const MAX_PAGES = 4;
  const MAX_RANGES = 16;
  let requestSequence = 0;
  const outcome = (focused, focusedGranularity, precision, reasonCode, pageNumber) =>
    Object.freeze({ focused, focusedGranularity, precision, reasonCode,
      pageNumber: Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : null });
  const stale = () => outcome(false, 'none', 'none', 'PDF_FOCUS_STALE', null);
  const validIdentity = request => Boolean(request && request.schemaVersion === 1 &&
    request.type === 'pdf-native-focus-request' &&
    typeof request.documentHash === 'string' && /^[a-f0-9]{64}$/u.test(request.documentHash) &&
    request.documentId === `sha256:${request.documentHash}` &&
    Number.isSafeInteger(request.documentGeneration) && request.documentGeneration > 0 &&
    Number.isSafeInteger(request.revision) && request.revision > 0 &&
    typeof request.semanticCacheKey === 'string' && request.semanticCacheKey &&
    typeof request.semanticProvenanceKey === 'string' && request.semanticProvenanceKey &&
    typeof request.paragraphId === 'string' && request.paragraphId &&
    ['paragraph', 'sentence'].includes(request.granularity) &&
    Number.isSafeInteger(request.pageNumber) && request.pageNumber > 0);
  const normalize = request => {
    if (!validIdentity(request) || !['ranges', 'page-only'].includes(request.mode)) return null;
    if (request.mode === 'page-only') {
      if (request.precision !== 'page-only' || !Array.isArray(request.ranges) ||
          request.ranges.length || !Array.isArray(request.pageNumbers) ||
          !request.pageNumbers.length || request.pageNumbers.length > MAX_PAGES) return null;
      const pageNumbers = [];
      for (const pageNumber of request.pageNumbers) {
        if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 ||
            pageNumbers.includes(pageNumber) ||
            (pageNumbers.length && pageNumber < pageNumbers.at(-1))) return null;
        pageNumbers.push(pageNumber);
      }
      if (request.pageNumber !== pageNumbers[0]) return null;
      return { request, pageNumbers, ranges: [] };
    }
    if (!['exact-raw', 'normalized-equivalent'].includes(request.precision) ||
        !Array.isArray(request.ranges) || !request.ranges.length ||
        request.ranges.length > MAX_RANGES || request.pageNumbers !== undefined) return null;
    const pageNumbers = [];
    let previous = null;
    for (const range of request.ranges) {
      if (!Number.isSafeInteger(range?.pageNumber) || range.pageNumber < 1 ||
          !Number.isSafeInteger(range?.start) || !Number.isSafeInteger(range?.end) ||
          range.start < 0 || range.end <= range.start ||
          typeof range?.quote !== 'string' || range.quote.length !== range.end - range.start ||
          !['exact-raw', 'normalized-equivalent'].includes(range.precision) ||
          (previous && (range.pageNumber < previous.pageNumber ||
            (range.pageNumber === previous.pageNumber && range.start < previous.end)))) return null;
      if (!pageNumbers.includes(range.pageNumber)) pageNumbers.push(range.pageNumber);
      if (pageNumbers.length > MAX_PAGES) return null;
      previous = range;
    }
    if (request.pageNumber !== pageNumbers[0]) return null;
    return { request, pageNumbers, ranges: request.ranges };
  };
  const current = (request, sequence) => sequence === requestSequence &&
    input.identityMatches?.(request) === true;

  async function focus(request) {
    const sequence = ++requestSequence;
    const normalized = normalize(request);
    if (!normalized) {
      return outcome(false, 'none', 'none', 'PDF_FOCUS_INVALID_REQUEST', null);
    }
    if (!current(request, sequence)) return stale();
    const navigationSequence = input.onFocusStart?.(request);
    try {
      for (const pageNumber of normalized.pageNumbers) {
        await input.ensurePageIndexed(pageNumber, request, navigationSequence);
        if (!current(request, sequence)) return stale();
      }
    } catch (error) {
      if (!current(request, sequence) || error?.code === 'STALE_PDF_SELECTION' ||
          error?.message === 'STALE_PDF_SELECTION') return stale();
      return outcome(false, 'none', 'none', 'PDF_FOCUS_PAGE_UNAVAILABLE', null);
    }
    if (request.mode === 'page-only') {
      if (!current(request, sequence)) return stale();
      const focused = input.applyPageFocus?.(
        request.pageNumber, request, navigationSequence) === true;
      return focused
        ? outcome(true, 'page', 'page-only', 'PDF_FOCUS_PAGE_ONLY', request.pageNumber)
        : outcome(false, 'none', 'none', 'PDF_FOCUS_PAGE_UNAVAILABLE', null);
    }

    const projections = new Map();
    for (const pageNumber of normalized.pageNumbers) {
      const pageProjection = input.getPageProjection?.(pageNumber);
      if (!pageProjection || pageProjection.pageNumber !== pageNumber ||
          pageProjection.documentHash !== request.documentHash ||
          pageProjection.documentGeneration !== request.documentGeneration ||
          !pageProjection.textLayer) {
        projections.clear();
        break;
      }
      const projection = input.readProjection?.(pageProjection.textLayer, { mode: 'raw-offset' });
      if (!projection || typeof projection.text !== 'string') {
        projections.clear();
        break;
      }
      projections.set(pageNumber, { pageProjection, projection });
    }
    const entries = [];
    if (projections.size === normalized.pageNumbers.length) {
      for (const range of normalized.ranges) {
        const projected = projections.get(range.pageNumber);
        const domRange = projected && input.createProjectionRange?.(
          projected.projection, range, projected.pageProjection);
        if (!domRange) { entries.length = 0; break; }
        entries.push({ pageNumber: range.pageNumber, range, domRange,
          pageProjection: projected.pageProjection });
      }
    }
    if (!current(request, sequence)) return stale();
    if (entries.length === normalized.ranges.length &&
        input.applyRangeFocus?.(entries, request, navigationSequence) === true) {
      return outcome(true, request.granularity, request.precision, '', request.pageNumber);
    }
    if (!current(request, sequence)) return stale();
    const focused = input.applyPageFocus?.(
      request.pageNumber, request, navigationSequence) === true;
    return focused
      ? outcome(true, 'page', 'page-only', 'PDF_FOCUS_DOM_MAPPING_UNAVAILABLE', request.pageNumber)
      : outcome(false, 'none', 'none', 'PDF_FOCUS_PAGE_UNAVAILABLE', null);
  }
  function invalidate() {
    requestSequence += 1;
  }
  return Object.freeze({ focus, invalidate });
}

function createPdfNativeSemanticFocusActivityController() {
  let currentToken = null;
  let deferredAutomaticFitWidth = false;
  return Object.freeze({
    start() {
      const token = Object.freeze({});
      currentToken = token;
      return token;
    },
    end(token) {
      if (currentToken !== token) return;
      currentToken = null;
      deferredAutomaticFitWidth = false;
    },
    cancel() {
      currentToken = null;
      deferredAutomaticFitWidth = false;
    },
    active() { return currentToken !== null; },
    deferAutomaticFitWidth() {
      if (currentToken === null) return false;
      deferredAutomaticFitWidth = true;
      return true;
    },
    consumeDeferredAutomaticFitWidth(token) {
      if (currentToken !== token || !deferredAutomaticFitWidth) return false;
      deferredAutomaticFitWidth = false;
      return true;
    }
  });
}

const nativeInitializationLeases = createPdfNativeInitializationLeaseController(
  () => nativeDocumentGeneration
);
const nativeSemanticFocusActivity = createPdfNativeSemanticFocusActivityController();
const nativeSemanticFocusController = createPdfNativeSemanticFocusController({
  onFocusStart: beginNativePdfNavigation,
  identityMatches: currentPdfSemanticFocusRequestMatches,
  ensurePageIndexed: ensureNativePdfPageIndexed,
  getPageProjection: pageNumber => {
    const projection = getPageProjection(pageNumber);
    return projection?.pageElement?.isConnected && projection?.textLayer?.isConnected
      ? projection : null;
  },
  readProjection: (textLayer, options) =>
    globalThis.SciLLM.readPdfTextProjection?.(textLayer, options),
  createProjectionRange: (projection, range, pageProjection) =>
    globalThis.SciLLM.pdfProjectionRange?.(
      projection, range, pageProjection?.textLayer?.ownerDocument || document),
  applyRangeFocus: applyNativePdfSemanticRangeFocus,
  applyPageFocus: (pageNumber, _request, navigationSequence) => focusPage(pageNumber, {
    navigationSequence,
    semantic: true
  })
});
function applyAutomaticFitWidthIfIdle() {
  if (!stateController.isFitWidth() || lifecycle.isTerminal()) return false;
  if (nativeSemanticFocusActivity.deferAutomaticFitWidth()) return false;
  fitWidth();
  return true;
}

const resizeScheduler = globalThis.SciLLM.createPdfNativeResizeScheduler(
  applyAutomaticFitWidthIfIdle, { delay: 100 }
);

async function outlineDestinationPage(item, sourceDocument = pdfDocument) {
  let destination = item?.dest;
  try {
    if (typeof destination === 'string') {
      destination = await sourceDocument.getDestination(destination);
    }
  } catch (_) {
    return { pageNumber: 1, targetTop: null, destinationKind: '' };
  }
  if (!Array.isArray(destination) || destination.length === 0) {
    return { pageNumber: 1, targetTop: null, destinationKind: '' };
  }
  const reference = destination[0];
  let pageNumber = 1;
  try {
    pageNumber = Number.isInteger(reference)
      ? reference + 1 : (await sourceDocument.getPageIndex(reference)) + 1;
  } catch (_) {
    return { pageNumber: 1, targetTop: null, destinationKind: '' };
  }
  const maximumPage = Number(sourceDocument?.numPages);
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 ||
      (Number.isSafeInteger(maximumPage) && maximumPage > 0 && pageNumber > maximumPage)) {
    return { pageNumber: 1, targetTop: null, destinationKind: '' };
  }
  const destinationKind = String(destination?.[1]?.name || '');
  const rawTop = destinationKind === 'XYZ' ? destination[3]
    : ['FitH', 'FitBH'].includes(destinationKind) ? destination[2]
      : destinationKind === 'FitR' ? destination[5] : null;
  const rawLeft = destinationKind === 'FitR' ? destination[2]
    : destinationKind === 'XYZ' ? destination[2] : null;
  if (typeof rawTop !== 'number' || !Number.isFinite(rawTop) ||
      (destinationKind === 'FitR' &&
        (typeof rawLeft !== 'number' || !Number.isFinite(rawLeft))) ||
      (destinationKind === 'XYZ' && rawLeft !== null && rawLeft !== undefined &&
        (typeof rawLeft !== 'number' || !Number.isFinite(rawLeft)))) {
    return { pageNumber, targetTop: null, destinationKind };
  }
  try {
    const page = await sourceDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const pageLeft = Number(page?.view?.[0]);
    const sourceX = typeof rawLeft === 'number' ? rawLeft
      : Number.isFinite(pageLeft) ? pageLeft : 0;
    const converted = viewport.convertToViewportPoint(sourceX, rawTop);
    const targetTop = Number(converted?.[1]);
    return { pageNumber, targetTop: Number.isFinite(targetTop) ? targetTop : null,
      destinationKind };
  } catch (_) {
    return { pageNumber, targetTop: null, destinationKind };
  }
}

async function normalizeOutline(items, depth = 0, sourceDocument = pdfDocument) {
  const result = [];
  for (const item of (Array.isArray(items) ? items : []).slice(0, 800)) {
    const target = await outlineDestinationPage(item, sourceDocument);
    result.push({
      title: String(item?.title || '').normalize('NFKC').trim().slice(0, 500),
      pageNumber: target.pageNumber, targetTop: target.targetTop,
      destinationKind: target.destinationKind, depth,
      items: await normalizeOutline(item?.items, depth + 1, sourceDocument)
    });
  }
  return result;
}

function flattenPdfSemanticOutline(items, output = []) {
  for (const item of Array.isArray(items) ? items : []) {
    output.push(Object.freeze({
      title: String(item?.title || ''),
      pageNumber: Math.max(1, Math.floor(Number(item?.pageNumber) || 1)),
      level: Math.max(1, Math.floor(Number(item?.depth) || 0) + 1),
      targetTop: Number.isFinite(item?.targetTop) ? item.targetTop : null,
      destinationKind: String(item?.destinationKind || '')
    }));
    flattenPdfSemanticOutline(item?.items, output);
  }
  return output;
}

function semanticErrorCode(value, fallback = 'PDF_SIDECAR_BUILD_FAILED') {
  const code = String(value || '');
  return /^[A-Z][A-Z0-9_]{2,79}$/u.test(code) ? code : fallback;
}

function clearPdfSemanticCompatibility() {
  pdfSemanticCompatibilityOwner = null;
  delete globalThis.__brevessPdfSemanticCompatibility;
}

function currentOwnedPdfSemanticCompatibility() {
  const compatibility = pdfSemanticCompatibilityOwner;
  return compatibility && globalThis.__brevessPdfSemanticCompatibility === compatibility
    ? compatibility : null;
}

function clearPdfSemanticPublication() {
  delete globalThis.__brevessPdfSemanticDocument;
  clearPdfSemanticCompatibility();
}

function createPdfSemanticCompatibility(semanticDocument, nativeDocument) {
  const createAdapter = globalThis.SciLLM?.createPdfSemanticCompatibilityAdapter;
  if (!semanticDocument || !nativeDocument || typeof createAdapter !== 'function') return null;
  try {
    return createAdapter({
      semanticDocument,
      nativeDocument,
      getCurrentSemanticDocument: () => globalThis.__brevessPdfSemanticDocument,
      getCurrentNativeDocument: () => globalThis.__brevessNativePdfDocument
    }) || null;
  } catch (_) {
    return null;
  }
}

function publishPdfSemanticCompatibility() {
  const semanticDocument = globalThis.__brevessPdfSemanticDocument;
  const nativeDocument = globalThis.__brevessNativePdfDocument;
  if (!semanticDocument || !nativeDocument) {
    clearPdfSemanticPublication();
    pdfSemanticPublishedBuilds = 0;
    return null;
  }
  const adapter = createPdfSemanticCompatibility(semanticDocument, nativeDocument);
  if (!adapter || semanticDocument !== globalThis.__brevessPdfSemanticDocument ||
      nativeDocument !== globalThis.__brevessNativePdfDocument) {
    clearPdfSemanticPublication();
    pdfSemanticPublishedBuilds = 0;
    return null;
  }
  pdfSemanticCompatibilityOwner = adapter;
  globalThis.__brevessPdfSemanticCompatibility = adapter;
  return adapter;
}

function publishPdfSemanticProgress(detail) {
  const safeDetail = Object.freeze({
    phase: String(detail?.phase || 'idle'),
    documentGeneration: Number(detail?.documentGeneration) || 0,
    revision: Number(detail?.revision) || 0,
    counts: Object.freeze({ ...(detail?.counts || {}) })
  });
  const committed = Number(safeDetail.counts.buildsCommitted) || 0;
  if (pdfSemanticSidecar && committed > pdfSemanticPublishedBuilds) {
    const snapshot = pdfSemanticSidecar.getSnapshot();
    if (snapshot?.index && pdfSemanticSourceDocument === pdfDocument &&
        snapshot.source?.documentHash === loadedDocumentHash &&
        snapshot.source?.documentGeneration === nativeDocumentGeneration) {
      const nativeDocument = globalThis.__brevessNativePdfDocument;
      const previousSemanticDocument = globalThis.__brevessPdfSemanticDocument;
      const previousCompatibility = globalThis.__brevessPdfSemanticCompatibility;
      const previousCompatibilityOwner = pdfSemanticCompatibilityOwner;
      const semanticDocument = Object.freeze({
        schemaVersion: 1,
        documentId: snapshot.source.workspaceDocumentId,
        adapterId: 'pdf-native',
        documentHash: snapshot.source.documentHash,
        documentGeneration: snapshot.source.documentGeneration,
        revision: snapshot.revision,
        phase: snapshot.phase === 'ready' ? 'text-ready' : 'partial-index',
        pageCount: snapshot.coverage.expectedPages,
        indexedPageCount: snapshot.coverage.indexedPages,
        coverage: snapshot.coverage,
        index: snapshot.index
      });
      const compatibility = createPdfSemanticCompatibility(semanticDocument, nativeDocument);
      if (compatibility && nativeDocument === globalThis.__brevessNativePdfDocument &&
          previousSemanticDocument === globalThis.__brevessPdfSemanticDocument &&
          previousCompatibility === globalThis.__brevessPdfSemanticCompatibility &&
          previousCompatibilityOwner === pdfSemanticCompatibilityOwner &&
          pdfSemanticSourceDocument === pdfDocument &&
          snapshot.source?.documentHash === loadedDocumentHash &&
          snapshot.source?.documentGeneration === nativeDocumentGeneration) {
        globalThis.__brevessPdfSemanticDocument = semanticDocument;
        pdfSemanticCompatibilityOwner = compatibility;
        globalThis.__brevessPdfSemanticCompatibility = compatibility;
        pdfSemanticPublishedBuilds = committed;
      } else {
        clearPdfSemanticPublication();
      }
    }
  }
  document.dispatchEvent(new CustomEvent('brevess:pdf-semantic-ready', {
    detail: safeDetail
  }));
}

function resetPdfSemanticSidecar({ terminal = false, errorCode = '' } = {}) {
  if (terminal && pdfSemanticSidecar && pdfSemanticSourceToken &&
      pdfSemanticSourceDocument) {
    pdfSemanticSidecar.enterTerminalFallback({
      sourceToken: pdfSemanticSourceToken,
      nativeDocument: pdfSemanticSourceDocument,
      errorCode: semanticErrorCode(errorCode, 'PDF_SIDECAR_TERMINAL_FALLBACK')
    });
  } else {
    pdfSemanticSidecar?.dispose?.();
  }
  pdfSemanticWorkerClient?.dispose?.();
  pdfSemanticSidecar = null;
  pdfSemanticWorkerClient = null;
  pdfSemanticSourceToken = null;
  pdfSemanticSourceDocument = null;
  pdfSemanticOutline = [];
  pdfSemanticPublishedBuilds = 0;
  clearPdfSemanticPublication();
}

function activatePdfSemanticSidecar(firstRecord) {
  resetPdfSemanticSidecar();
  if (!pdfDocument || !loadedDocumentHash ||
      typeof globalThis.SciLLM.createPdfSemanticSidecarCoordinator !== 'function' ||
      typeof globalThis.SciLLM.createPdfSemanticWorkerClient !== 'function') return false;
  try {
    const sourceDocument = pdfDocument;
    const generation = nativeDocumentGeneration;
    pdfSemanticWorkerClient = globalThis.SciLLM.createPdfSemanticWorkerClient({
      WorkerCtor: globalThis.Worker,
      workerUrl: chrome.runtime.getURL('core/pdf-semantic-worker.mjs')
    });
    pdfSemanticOutline = flattenPdfSemanticOutline(outlineCache);
    pdfSemanticSidecar = globalThis.SciLLM.createPdfSemanticSidecarCoordinator({
      buildIndex: (input, context) => pdfSemanticWorkerClient.build({
        ...input,
        outline: pdfSemanticOutline
      }, { signal: context?.signal })
    });
    pdfSemanticSidecar.subscribe(publishPdfSemanticProgress);
    pdfSemanticSourceDocument = sourceDocument;
    pdfSemanticSourceToken = pdfSemanticSidecar.activateSource({
      nativeDocument: sourceDocument,
      nativeDocumentKey: '__brevessNativePdfDocument',
      documentHash: loadedDocumentHash,
      documentGeneration: generation,
      revision: 1,
      expectedPageCount: sourceDocument.numPages,
      workspaceDocumentId: `sha256:${loadedDocumentHash}`
    });
    pdfSemanticSidecar.setVisiblePage({
      sourceToken: pdfSemanticSourceToken,
      nativeDocument: sourceDocument,
      pageNumber: firstRecord?.pageNumber || 1
    });
    if (firstRecord?.canonicalPage) upsertPdfSemanticPage(firstRecord);
    return true;
  } catch (failure) {
    resetPdfSemanticSidecar();
    publishPdfSemanticProgress({
      phase: 'partial', documentGeneration: nativeDocumentGeneration, revision: 1,
      counts: {}, coverage: {}, degraded: true,
      errorCode: semanticErrorCode(failure?.code, 'PDF_SIDECAR_START_FAILED')
    });
    return false;
  }
}

function upsertPdfSemanticPage(record, options = {}) {
  if (!record?.canonicalPage || !pdfSemanticSidecar || !pdfSemanticSourceToken ||
      pdfSemanticSourceDocument !== pdfDocument) return false;
  const result = pdfSemanticSidecar.upsertCanonicalPage({
    sourceToken: pdfSemanticSourceToken,
    nativeDocument: pdfSemanticSourceDocument,
    record: record.canonicalPage
  });
  return options.returnResult === true ? result : result.accepted === true;
}

function completePdfSemanticCollection() {
  if (!pdfSemanticSidecar || !pdfSemanticSourceToken || !pdfSemanticSourceDocument ||
      pdfSemanticSourceDocument !== pdfDocument) return false;
  return pdfSemanticSidecar.markCollectionComplete({
    sourceToken: pdfSemanticSourceToken,
    nativeDocument: pdfSemanticSourceDocument
  }).accepted === true;
}

function markPdfSemanticPageUnmounted(record) {
  if (!record || !pdfSemanticSidecar || !pdfSemanticSourceToken ||
      pdfSemanticSourceDocument !== pdfDocument) return false;
  return pdfSemanticSidecar.markPageUnmounted({
    sourceToken: pdfSemanticSourceToken,
    nativeDocument: pdfSemanticSourceDocument,
    pageNumber: record.pageNumber
  });
}

function deactivatePdfSemanticSidecar() {
  if (!pdfSemanticSidecar || !pdfSemanticSourceToken || !pdfSemanticSourceDocument) return false;
  return pdfSemanticSidecar.deactivateView({
    sourceToken: pdfSemanticSourceToken,
    nativeDocument: pdfSemanticSourceDocument
  });
}

function activatePdfSemanticView(pageNumber) {
  if (!pdfSemanticSidecar || !pdfSemanticSourceToken || !pdfSemanticSourceDocument) return false;
  pdfSemanticSidecar.activateView({
    sourceToken: pdfSemanticSourceToken,
    nativeDocument: pdfSemanticSourceDocument
  });
  return pdfSemanticSidecar.setVisiblePage({
    sourceToken: pdfSemanticSourceToken,
    nativeDocument: pdfSemanticSourceDocument,
    pageNumber: Math.max(1, Math.floor(Number(pageNumber) || 1))
  });
}

function createPdfSemanticCanonicalPage(record, textContent) {
  if (!record?.page || !loadedDocumentHash ||
      typeof globalThis.SciLLM.createCanonicalPdfPageRecord !== 'function') return null;
  try {
    return globalThis.SciLLM.createCanonicalPdfPageRecord({
      documentHash: loadedDocumentHash,
      documentGeneration: nativeDocumentGeneration,
      revision: 1,
      pageNumber: record.pageNumber,
      page: record.page,
      viewport: record.page.getViewport({ scale: 1 }),
      textContent,
      textContentOrder: 'reading-order',
      readingOrderContract: 'pdf-reading-order-v1'
    });
  } catch (failure) {
    publishPdfSemanticProgress({
      phase: 'partial',
      documentGeneration: nativeDocumentGeneration,
      revision: 1,
      counts: {}, coverage: {}, degraded: true,
      errorCode: semanticErrorCode(failure?.code, 'PDF_CANONICAL_PAGE_FAILED')
    });
    return null;
  }
}

function pageLifecycleDetail(record) {
  if (!record || !record.documentHash || !Number.isSafeInteger(record.documentGeneration)) {
    return null;
  }
  return Object.freeze({
    pageNumber: record.pageNumber,
    documentHash: record.documentHash,
    documentGeneration: record.documentGeneration
  });
}

function dispatchPageLifecycleEvent(type, record) {
  const detail = pageLifecycleDetail(record);
  if (detail) document.dispatchEvent(new CustomEvent(type, { detail }));
}

function rememberRenderFailure(error, documentGeneration) {
  if (error && (typeof error === 'object' || typeof error === 'function')) {
    renderFailureDocumentGenerations.set(error, documentGeneration);
  }
  return error;
}

async function resolvePdfDestinationPage(sourceDocument, destination) {
  try {
    let resolved = destination;
    if (typeof resolved === 'string') resolved = await sourceDocument.getDestination(resolved);
    if (!Array.isArray(resolved) || resolved.length === 0) return 0;
    const reference = resolved[0];
    if (Number.isInteger(reference)) return reference + 1;
    return (await sourceDocument.getPageIndex(reference)) + 1;
  } catch (_) {
    return 0;
  }
}

async function renderPdfLinkLayer(record, token, signal) {
  if (!record?.mounted || !record.linkLayer || !renderGeneration.isCurrent(token) ||
      signal?.aborted || record.documentHash !== loadedDocumentHash ||
      record.documentGeneration !== nativeDocumentGeneration) return;
  let annotations;
  try {
    annotations = await record.page.getAnnotations({ intent: 'display' });
  } catch (_) {
    return;
  }
  if (!record.mounted || !record.linkLayer || !renderGeneration.isCurrent(token) ||
      signal?.aborted || record.documentHash !== loadedDocumentHash ||
      record.documentGeneration !== nativeDocumentGeneration) return;
  record.linkLayer.replaceChildren();
  const sourceDocument = pdfDocument;
  for (const annotation of Array.isArray(annotations) ? annotations : []) {
    if (annotation?.subtype !== 'Link' || !Array.isArray(annotation.rect)) continue;
    const externalUrl = globalThis.SciLLM.sanitizePdfNativeLinkUrl(annotation.url);
    const destinationPage = externalUrl ? 0 : await resolvePdfDestinationPage(
      sourceDocument,
      annotation.dest
    );
    if (!externalUrl && destinationPage < 1) continue;
    if (!record.mounted || !renderGeneration.isCurrent(token) || signal?.aborted) return;
    const rectangle = record.viewport.convertToViewportRectangle(annotation.rect);
    const left = Math.min(rectangle[0], rectangle[2]);
    const top = Math.min(rectangle[1], rectangle[3]);
    const width = Math.abs(rectangle[2] - rectangle[0]);
    const height = Math.abs(rectangle[3] - rectangle[1]);
    if (![left, top, width, height].every(Number.isFinite) || width < 1 || height < 1) continue;
    const link = document.createElement('a');
    link.className = 'pdf-native-link-hit';
    link.style.position = 'absolute';
    link.style.left = `${left}px`;
    link.style.top = `${top}px`;
    link.style.width = `${width}px`;
    link.style.height = `${height}px`;
    link.style.pointerEvents = 'auto';
    link.style.cursor = 'pointer';
    link.setAttribute('aria-label', String(
      annotation.titleObj?.str || annotation.contentsObj?.str || externalUrl ||
      `PDF page ${destinationPage}`
    ).slice(0, 500));
    if (externalUrl) {
      link.href = externalUrl;
      if (!externalUrl.startsWith('mailto:')) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    } else {
      link.href = `#page=${destinationPage}`;
      link.addEventListener('click', event => {
        event.preventDefault();
        focusPage(destinationPage);
      });
    }
    record.linkLayer.appendChild(link);
  }
}

function updateRecordViewport(record, scale) {
  const viewport = record.page.getViewport({ scale });
  record.viewport = viewport;
  record.rendered = false;
  record.textLayerReady = false;
  record.textLayerRenderGeneration = 0;
  record.textLayerPromise = null;
  record.canvasResident = false;
  record.section.classList.remove('is-rendered');
  record.section.classList.remove('is-text-ready');
  record.section.style.width = `${viewport.width}px`;
  record.section.style.height = `${viewport.height}px`;
  record.section.style.setProperty('--scale-factor', String(viewport.scale));
  record.section.style.setProperty('--user-unit', String(record.page.userUnit || 1));
  for (const layer of [record.canvas, record.textLayer, record.linkLayer, record.annotationLayer]) {
    if (!layer) continue;
    layer.style.width = `${viewport.width}px`;
    layer.style.height = `${viewport.height}px`;
  }
  renderPdfAnnotationOverlay(record);
}

function renderPdfAnnotationOverlay(record) {
  if (!record?.annotationLayer || !record.viewport) return { rendered: 0, skipped: 0 };
  return globalThis.SciLLM.syncPdfAnnotationOverlay({
    layer: record.annotationLayer,
    annotations: pdfAnnotationSnapshot.annotations,
    pageNumber: record.pageNumber,
    viewport: record.viewport,
    documentHash: pdfAnnotationSnapshot.documentHash,
    onActivate(payload, target) {
      target.dispatchEvent(new CustomEvent('brevess:pdf-annotation-activate', {
        bubbles: true,
        detail: payload
      }));
    }
  });
}

function handlePdfSelectionAnchorRequest(event) {
  const textLayer = event?.target?.closest?.('.pdf-native-text-layer');
  const pageNumber = Number(textLayer?.dataset?.pdfPageNumber);
  const record = pageRecords.get(pageNumber);
  if (!record?.mounted || textLayer !== record.textLayer || !record.viewport ||
      !globalThis.SciLLM.pdfRequestMatchesDocument({
        currentDocumentHash: loadedDocumentHash,
        currentGeneration: nativeDocumentGeneration,
        requestDocumentHash: event?.detail?.documentHash,
        requestGeneration: event?.detail?.documentGeneration
      })) return;
  try {
    event.detail.pdfAnchor = globalThis.SciLLM.createPdfSelectionAnchor({
      pageNumber,
      documentHash: event.detail.documentHash,
      contextHash: event.detail.contextHash,
      quote: event.detail.quote,
      prefix: event.detail.prefix,
      suffix: event.detail.suffix,
      clientRects: event.detail.clientRects,
      pageRect: record.section.getBoundingClientRect(),
      viewport: record.viewport
    });
  } catch (_) {
    event.detail.pdfAnchor = null;
  }
}

function handlePdfAnnotationsUpdated(event) {
  const update = globalThis.SciLLM.reconcilePdfAnnotationUpdate({
    currentDocumentHash: loadedDocumentHash,
    currentGeneration: nativeDocumentGeneration,
    eventDocumentHash: event?.detail?.documentHash,
    eventGeneration: event?.detail?.documentGeneration,
    annotations: event?.detail?.annotations
  });
  if (!update.accepted) return;
  pdfAnnotationSnapshot = Object.freeze({
    documentHash: loadedDocumentHash, annotations: Object.freeze([...update.annotations])
  });
  pageRecords.forEach(renderPdfAnnotationOverlay);
}

async function exportAnnotatedPdf() {
  if (!pdfDocument || lifecycle.isTerminal()) throw new Error('PDF_DOCUMENT_NOT_READY');
  const sourceDocument = pdfDocument;
  const captured = globalThis.SciLLM.createPdfSaveExportContext({
    bytes: new Uint8Array(),
    documentHash: loadedDocumentHash,
    generation: nativeDocumentGeneration,
    annotations: pdfAnnotationSnapshot.annotations
  });
  const bytes = await globalThis.SciLLM.savePdfHighlightAnnotations({
    pdfDocument: sourceDocument,
    annotations: captured.annotationsSnapshot
  });
  if (sourceDocument !== pdfDocument || !isSaveContextCurrent(captured)) {
    throw new Error('PDF_SAVE_CONTEXT_CHANGED');
  }
  return globalThis.SciLLM.createPdfSaveExportContext({
    bytes,
    documentHash: captured.documentHash,
    generation: captured.generation,
    annotations: captured.annotationsSnapshot
  });
}

function isSaveContextCurrent(context) {
  return !lifecycle.isTerminal() && globalThis.SciLLM.pdfSaveContextMatches(context, {
    documentHash: loadedDocumentHash,
    generation: nativeDocumentGeneration,
    annotations: pdfAnnotationSnapshot.annotations
  });
}

function adoptSavedSourceHash(context, sourceHash) {
  const normalized = String(sourceHash || '').toLowerCase();
  const sameDocument = !lifecycle.isTerminal() &&
    String(context?.documentHash || '') === loadedDocumentHash &&
    Number(context?.generation) === nativeDocumentGeneration;
  if (!/^[a-f0-9]{64}$/.test(normalized) || !sameDocument) {
    throw new Error('PDF_SAVE_CONTEXT_CHANGED');
  }
  loadedSourceHash = normalized;
  notifyState({ phase: 'saved-source-adopted' });
  return loadedSourceHash;
}

async function verifyAnnotatedPdf(bytes, context) {
  const validSnapshot = globalThis.SciLLM.pdfSaveContextMatches(context, {
    documentHash: context?.documentHash,
    generation: context?.generation,
    annotations: context?.annotationsSnapshot
  });
  if (!validSnapshot) throw new Error('PDF_SAVE_CONTEXT_INVALID');
  return globalThis.SciLLM.verifySavedPdfAnnotations({
    bytes,
    annotations: context.annotationsSnapshot,
    getDocument: options => getDocument({
      ...options,
      cMapUrl: chrome.runtime.getURL('vendor/pdfjs/cmaps/'), cMapPacked: true,
      standardFontDataUrl: chrome.runtime.getURL('vendor/pdfjs/standard_fonts/'),
      iccUrl: chrome.runtime.getURL('vendor/pdfjs/iccs/'),
      wasmUrl: chrome.runtime.getURL('vendor/pdfjs/wasm/'),
      useSystemFonts: true
    })
  });
}

function currentPageRecord() {
  const selected = globalThis.SciLLM.selectPdfNativePage(
    Array.from(pageRecords.values(), record => {
      const rect = record.section.getBoundingClientRect();
      return { pageNumber: record.pageNumber, top: rect.top, bottom: rect.bottom };
    }), viewer.getBoundingClientRect()
  );
  return pageRecords.get(selected?.pageNumber) || pageRecords.get(1) ||
    pageRecords.values().next().value || null;
}

function ensureRenderObserver() {
  if (renderObserver || typeof IntersectionObserver !== 'function') return;
  renderObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const pageNumber = Number(entry.target.dataset.pdfPageNumber);
      if (entry.isIntersecting) visiblePages.add(pageNumber);
      else visiblePages.delete(pageNumber);
    });
    const sorted = Array.from(visiblePages).sort((left, right) => left - right);
    const current = currentPageRecord()?.pageNumber || sorted[0] || 1;
    void updatePageWindow(sorted[0] || current, sorted.at(-1) || current);
  }, { root: viewer, rootMargin: '900px 0px', threshold: 0.01 });
}

function createPagePlaceholder(pageNumber, page, binding = {}) {
  const section = document.createElement('section');
  section.className = 'pdf-native-page pdf-native-page-placeholder';
  section.dataset.pdfPageNumber = String(pageNumber);
  section.setAttribute('data-pdf-page-number', String(pageNumber));
  section.setAttribute('aria-label', `PDF page ${pageNumber}`);
  const record = {
    pageNumber, page, viewport: null, section, text: '', textContent: null,
    canvas: null, textLayer: null, linkLayer: null, annotationLayer: null, renderTask: null,
    rendered: false, textLayerReady: false, textLayerRenderGeneration: 0,
    textLayerPromise: null, canvasResident: false, rendering: false, renderingGeneration: 0,
    mounted: false,
    textStatus: 'deferred', textAttempts: 0, textErrorCode: '',
    hasVisualContent: undefined, ocrCandidate: undefined,
    documentHash: binding.documentHash ?? loadedDocumentHash,
    documentGeneration: binding.documentGeneration ?? nativeDocumentGeneration
  };
  updateRecordViewport(record, stateController.getScale());
  pageRecords.set(pageNumber, record);
  const next = Array.from(pageRecords.values())
    .filter(item => item.pageNumber > pageNumber && item.section.isConnected)
    .sort((left, right) => left.pageNumber - right.pageNumber)[0];
  viewer.insertBefore(section, next?.section || null);
  ensureRenderObserver();
  renderObserver?.observe?.(section);
  return record;
}

async function effectivePageTextContent(page, pageNumber) {
  const extracted = await page.getTextContent({ includeMarkedContent: true, disableNormalization: true });
  const native = globalThis.SciLLM.orderPdfTextContentForReading(extracted, page);
  const ocr = ocrTextPages.get(pageNumber);
  return ocr ? globalThis.SciLLM.mineruPageToPdfTextContent(ocr,
    { view: page.view, rotation: page.rotate }) : native;
}

async function loadCurrentPageTextContent(page, pageNumber, binding = {}) {
  const sourceDocument = binding.sourceDocument || pdfDocument;
  const documentHash = binding.documentHash ?? loadedDocumentHash;
  const documentGeneration = binding.documentGeneration ?? nativeDocumentGeneration;
  const normalizedPage = Math.max(1, Math.floor(Number(pageNumber) || 1));
  const record = pageRecords.get(normalizedPage);
  if (record?.page === page && record.documentHash === documentHash &&
      record.documentGeneration === documentGeneration && record.textContent) {
    return record.textContent;
  }
  const key = `${documentGeneration}:${documentHash}:${normalizedPage}`;
  const existing = nativePageTextContentLoads.get(key);
  if (existing) return existing;
  const pending = effectivePageTextContent(page, normalizedPage).then(textContent => {
    const currentRecord = pageRecords.get(normalizedPage);
    if (nativeDocumentMatches(sourceDocument, documentHash, documentGeneration) &&
        currentRecord?.page === page && currentRecord.documentHash === documentHash &&
        currentRecord.documentGeneration === documentGeneration &&
        (currentRecord.mounted || wantedPages.has(normalizedPage))) {
      currentRecord.textContent = textContent;
    }
    return textContent;
  }).finally(() => {
    if (nativePageTextContentLoads.get(key) === pending) {
      nativePageTextContentLoads.delete(key);
    }
  });
  nativePageTextContentLoads.set(key, pending);
  return pending;
}

function markNativePdfPageTextFailure(record, error) {
  record.text = '';
  record.textContent = null;
  record.textStatus = 'failed';
  record.textErrorCode = 'PDF_TEXT_EXTRACTION_FAILED';
  record.errorCode = record.textErrorCode;
  record.textFailureName = String(error?.name || 'Error').slice(0, 80);
  record.hasVisualContent = undefined;
  record.ocrCandidate = undefined;
  textBudget.release(record.pageNumber);
  return record;
}

async function inspectNativePdfPageContent(record, textContent) {
  const normalizedText = globalThis.SciLLM.normalizePdfNativePageText(textContent, {
    maxLength: 50000
  });
  let classification;
  if (normalizedText.length >= 30) {
    classification = {
      textStatus: 'full', hasVisualContent: true, ocrCandidate: false
    };
  } else {
    let operatorList = null;
    try { operatorList = await record.page.getOperatorList(); } catch (_) {}
    classification = operatorList
      ? globalThis.SciLLM.classifyPdfNativePageContent(textContent, operatorList, OPS)
      : {
          textStatus: normalizedText ? 'full' : 'empty',
          hasVisualContent: normalizedText ? true : undefined,
          ocrCandidate: normalizedText ? false : undefined
        };
  }
  return { normalizedText, classification };
}

function withOcrProvenance(structure) {
  if (!ocrTextPages.size) return structure;
  const paragraphs = structure.paragraphs.map(paragraph =>
    ocrTextPages.has(paragraph.pageNumber) ? { ...paragraph, textSource: 'mineru-layout',
      geometryAccuracy: 'bbox-only-baseline-approximate' } : paragraph);
  return { ...structure, paragraphs, typedRecords: paragraphs,
    diagnostics: { ...structure.diagnostics, mineruUsed: true,
      ocrPageNumbers: [...ocrTextPages.keys()] } };
}

async function installOcrTextLayer(binding) {
  if (binding?.documentHash !== loadedDocumentHash || !Array.isArray(binding?.pages)) {
    throw new Error('PDF_OCR_SOURCE_MISMATCH');
  }
  const sourceDocument = pdfDocument, hash = loadedDocumentHash, generation = nativeDocumentGeneration;
  const installed = [];
  const prepared = [];
  for (const ocr of binding.pages.slice(0, sourceDocument.numPages)) {
    if (!Number.isSafeInteger(ocr.pageNumber) || ocr.pageNumber < 1 ||
        ocr.pageNumber > sourceDocument.numPages || !ocr.items?.length) continue;
    const page = await sourceDocument.getPage(ocr.pageNumber);
    const original = await page.getTextContent({ includeMarkedContent: true, disableNormalization: true });
    if (!nativeDocumentMatches(sourceDocument, hash, generation)) throw new Error('PDF_OCR_SOURCE_MISMATCH');
    // Existing extractable text stays authoritative. OCR supplements pages with
    // absent text (or only a page number/header), never changes visible pixels.
    if (globalThis.SciLLM.normalizePdfNativePageText(original).length >= 30) continue;
    if (ocrTextPages.get(ocr.pageNumber) === ocr) {
      installed.push(ocr.pageNumber);
      continue;
    }
    const textContent = globalThis.SciLLM.mineruPageToPdfTextContent(ocr,
      { view: page.view, rotation: page.rotate });
    prepared.push({ ocr, page, textContent });
  }
  // Validate every page before mutating any OCR map or canonical text record.
  if (!nativeDocumentMatches(sourceDocument, hash, generation)) throw new Error('PDF_OCR_SOURCE_MISMATCH');
  for (const { ocr, page, textContent } of prepared) {
    ocrTextPages.set(ocr.pageNumber, ocr);
    const record = pageRecords.get(ocr.pageNumber) || createPagePlaceholder(ocr.pageNumber, page);
    unmountHeavyLayers(record);
    record.textContent = textContent;
    record.text = globalThis.SciLLM.normalizePdfNativePageText(textContent, { maxLength: 50000 });
    record.canonicalPage = createPdfSemanticCanonicalPage(record, textContent);
    incrementalDocument.add({ pageNumber: ocr.pageNumber, text: record.text });
    upsertPdfSemanticPage(record);
    installed.push(ocr.pageNumber);
  }
  if (installed.length) {
    const current = currentPageRecord()?.pageNumber || installed[0];
    await updatePageWindow(current, current);
    if (!nativeDocumentMatches(sourceDocument, hash, generation)) throw new Error('PDF_OCR_SOURCE_MISMATCH');
    publishNativePdfStructure(outlineCache, [], 'text-ready');
    completePdfSemanticCollection();
  }
  return { installedPages: installed, source: 'mineru-layout',
    geometryAccuracy: 'bbox-only-baseline-approximate' };
}

async function preparePage(pageNumber, options = {}) {
  const sourceDocument = options.sourceDocument || pdfDocument;
  const documentHash = options.documentHash ?? loadedDocumentHash;
  const documentGeneration = options.documentGeneration ?? nativeDocumentGeneration;
  const initialization = options.initialization;
  const signal = options.signal;
  const isCurrent = () => !signal?.aborted &&
    (!initialization || initialization.canCommit()) &&
    nativeDocumentOwnerMatches(sourceDocument, documentHash, documentGeneration);
  if (!sourceDocument || !isCurrent()) return null;
  const existing = pageRecords.get(pageNumber);
  const retryFailed = options?.retry === true;
  if (existing && existing.documentHash === documentHash &&
      existing.documentGeneration === documentGeneration &&
      ['full', 'empty'].includes(existing.textStatus)) return existing;
  if (existing?.textStatus === 'failed' &&
      existing.documentHash === documentHash &&
      existing.documentGeneration === documentGeneration &&
      (!retryFailed || Number(existing.textAttempts) >= 2)) return existing;
  const ownedExisting = existing?.documentHash === documentHash &&
    existing?.documentGeneration === documentGeneration ? existing : null;
  const page = ownedExisting?.page || await sourceDocument.getPage(pageNumber);
  if (!isCurrent()) return null;
  const record = ownedExisting || createPagePlaceholder(pageNumber, page, {
    documentHash, documentGeneration
  });
  record.textAttempts += 1;
  let textContent;
  try {
    textContent = await loadCurrentPageTextContent(page, pageNumber, {
      sourceDocument, documentHash, documentGeneration
    });
  } catch (error) {
    if (!isCurrent()) return null;
    return markNativePdfPageTextFailure(record, error);
  }
  if (!isCurrent()) return null;
  const retainRaw = active && wantedPages.has(pageNumber);
  record.textContent = retainRaw ? textContent : null;
  const { normalizedText, classification } = await inspectNativePdfPageContent(record, textContent);
  if (!isCurrent()) return null;
  record.textStatus = classification.textStatus;
  record.textErrorCode = '';
  record.errorCode = '';
  record.hasVisualContent = classification.hasVisualContent;
  record.ocrCandidate = classification.ocrCandidate;
  record.canonicalPage = createPdfSemanticCanonicalPage(record, textContent);
  const retained = textBudget.retain(pageNumber, normalizedText);
  record.text = retained.text;
  if (active && wantedPages.has(pageNumber) && options.skipAutoMount !== true) {
    void mountPage(pageNumber, pageNumber === currentPageRecord()?.pageNumber)
      .catch(() => undefined);
  }
  if (pendingFocusPage === pageNumber) {
    const navigationSequence = pendingFocusNavigationSequence;
    pendingFocusPage = 0;
    pendingFocusNavigationSequence = 0;
    requestAnimationFrame(() => focusPage(pageNumber, { navigationSequence }));
  }
  return record;
}

function unmountHeavyLayers(record, options = {}) {
  if (!record?.mounted) return;
  markPdfSemanticPageUnmounted(record);
  dispatchPageLifecycleEvent('brevess:pdf-page-unmounted', record);
  record.section?.querySelectorAll?.('.pdf-native-semantic-focus-layer')
    .forEach(layer => layer.remove());
  try { record.renderTask?.cancel?.(); } catch (_) {}
  if (record.canvas) { record.canvas.width = 0; record.canvas.height = 0; }
  record.canvas?.remove?.();
  record.textLayer?.remove?.();
  record.linkLayer?.remove?.();
  record.annotationLayer?.remove?.();
  canvasBudget.release(record.pageNumber);
  Object.assign(record, {
    canvas: null, textLayer: null, linkLayer: null, annotationLayer: null, renderTask: null,
    rendered: false, textLayerReady: false, textLayerRenderGeneration: 0,
    textLayerPromise: null, canvasResident: false, rendering: false, renderingGeneration: 0,
    mounted: false,
    textContent: options.preserveTextContent === true ? record.textContent : null
  });
  record.section.classList.remove('is-rendered');
  record.section.classList.remove('is-text-ready');
  record.section.classList.add('pdf-native-page-placeholder');
}

function releaseNativePdfCanvas(record) {
  if (!record?.mounted) return false;
  try { record.renderTask?.cancel?.(); } catch (_) {}
  if (record.canvas) {
    record.canvas.width = 0;
    record.canvas.height = 0;
  }
  canvasBudget.release(record.pageNumber);
  record.canvasResident = false;
  record.outputScale = 0;
  return true;
}

let nativeSelectionPaintFrame = 0;

function clearNativeSelectionPaint(pageNumber = 0) {
  const selector = pageNumber
    ? `.pdf-native-page[data-pdf-page-number="${Number(pageNumber)}"]` : '.pdf-native-page';
  for (const section of viewer.querySelectorAll(selector)) {
    section.querySelector('.pdf-native-selection-layer')?.remove();
    section.classList.remove('has-native-selection-paint');
  }
}

function cancelNativeSelectionPaint() {
  if (nativeSelectionPaintFrame) cancelAnimationFrame(nativeSelectionPaintFrame);
  nativeSelectionPaintFrame = 0;
  clearNativeSelectionPaint();
}

function paintNativeSelection() {
  nativeSelectionPaintFrame = 0;
  if (!active || disposed || lifecycle.isTerminal()) { clearNativeSelectionPaint(); return; }
  const paintings=[];
  try {
  const selection = document.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) { clearNativeSelectionPaint(); return; }
  const selected = selection.getRangeAt(0);
  // Read geometry before writing. Only mounted, selected PDF leaves participate;
  // native Selection/Range and every source text node remain untouched.
  for (const layer of viewer.querySelectorAll('.pdf-native-text-layer')) {
    if (!selected.intersectsNode(layer)) continue;
    const section=layer.closest('.pdf-native-page');
    const bounds=section.getBoundingClientRect();
    const rects=[];
    let lineId=0;
    const hasExplicitLines=Boolean(layer.querySelector('br'));
    for (const span of layer.querySelectorAll('span, br')) {
      if (span.tagName === 'BR') { lineId+=1; continue; }
      if (span.childElementCount || span.dataset.pdfPageFurniture || !span.textContent.trim() ||
          !selected.intersectsNode(span)) continue;
      const range=document.createRange(); range.selectNodeContents(span);
      if (range.compareBoundaryPoints(Range.START_TO_START,selected)<0) {
        range.setStart(selected.startContainer,selected.startOffset);
      }
      if (range.compareBoundaryPoints(Range.END_TO_END,selected)>0) {
        range.setEnd(selected.endContainer,selected.endOffset);
      }
      for (const rect of range.getClientRects()) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        rects.push({lineId:hasExplicitLines ? lineId : undefined,
          left:Math.max(0,rect.left-bounds.left),top:Math.max(0,rect.top-bounds.top),
          right:Math.min(bounds.width,rect.right-bounds.left),bottom:Math.min(bounds.height,rect.bottom-bounds.top)});
      }
    }
    const lines=globalThis.SciLLM.mergePdfSelectionRects(rects);
    if (lines.length) paintings.push({section,lines});
  }
  } catch {
    // A virtualized text layer may have been detached since the selection event.
    clearNativeSelectionPaint();
    return;
  }
  clearNativeSelectionPaint();
  for (const {section,lines} of paintings) {
    const overlay=document.createElement('div');
    overlay.className='pdf-native-selection-layer'; overlay.dataset.sciPluginUi='true';
    overlay.setAttribute('aria-hidden','true');
    for (const rect of lines) {
      const mark=document.createElement('div'); mark.className='pdf-native-selection-hit';
      Object.assign(mark.style,{left:`${rect.left}px`,top:`${rect.top}px`,
        width:`${rect.right-rect.left}px`,height:`${rect.bottom-rect.top}px`});
      overlay.appendChild(mark);
    }
    section.appendChild(overlay); section.classList.add('has-native-selection-paint');
  }
}

async function ensureMountedPageTextLayer(record, token, signal) {
  function markPdfWhitespaceSelectionLeaves(textLayer) {
    for (const span of textLayer?.querySelectorAll?.('span') || []) {
      const text = String(span.textContent ?? '');
      span.toggleAttribute('data-pdf-whitespace-selection',
        span.childElementCount === 0 && text.length > 0 && text.trim().length === 0);
    }
  }

  const current = () => Boolean(record?.mounted && record.textLayer &&
    renderGeneration.isCurrent(token) && !signal?.aborted &&
    wantedPages.has(record.pageNumber) && active);
  if (!current()) return false;
  if (record.textLayerReady && record.textLayerRenderGeneration === token.generation &&
      record.textLayer.isConnected !== false) return true;
  const ownedLayer = record.textLayer;
  const existing = record.textLayerPromise;
  if (existing?.generation === token.generation && existing.layer === ownedLayer) {
    return existing.promise;
  }
  const viewport = record.viewport;
  const pending = (async () => {
    // Semantic focus needs the selectable TextLayer, not the slower Canvas and
    // link layer. Rehydrate and render this projection under its own owner token.
    let textContent = record.textContent;
    if (!textContent && record.textStatus !== 'failed') {
      try {
        textContent = await loadCurrentPageTextContent(record.page, record.pageNumber, {
          sourceDocument: pdfDocument,
          documentHash: record.documentHash,
          documentGeneration: record.documentGeneration
        });
      } catch (error) {
        markNativePdfPageTextFailure(record, error);
      }
    }
    if (!current() || record.textLayer !== ownedLayer) return false;
    if (textContent) {
      record.textContent = textContent;
      // PDF.js measures every text item while appending spans. Building those
      // spans in the connected page turns each measurement into progressively
      // larger style/layout work on text-heavy papers. Render off-DOM, then
      // commit the completed layer once its owner token is still current.
      const detachedLayer = ownedLayer.ownerDocument?.createElement?.('div') ||
        (typeof document === 'undefined' ? null : document.createElement?.('div'));
      const stagedLayer = detachedLayer?.style && detachedLayer?.replaceChildren
        ? detachedLayer : ownedLayer;
      if (stagedLayer !== ownedLayer) {
        stagedLayer.className = ownedLayer.className;
        for (const attribute of ownedLayer.attributes || []) {
          stagedLayer.setAttribute(attribute.name, attribute.value);
        }
        stagedLayer.style.cssText = ownedLayer.style.cssText;
      }
      stagedLayer.replaceChildren();
      const layer = new TextLayer({
        textContentSource: textContent, container: stagedLayer, viewport
      });
      await layer.render().catch(error => {
        throw rememberRenderFailure(error, record.documentGeneration);
      });
      if (!current() || record.textLayer !== ownedLayer) return false;
      if (stagedLayer !== ownedLayer) {
        ownedLayer.style.cssText = stagedLayer.style.cssText;
        ownedLayer.replaceChildren(...stagedLayer.childNodes);
      }
      markPdfWhitespaceSelectionLeaves(ownedLayer);
      globalThis.SciLLM.markPdfTextLayerFurniture?.(ownedLayer, {
        pageNumber: record.pageNumber,
        pageCount: pdfDocument?.numPages || 0
      });
      const renderedProjection = globalThis.SciLLM.readPdfTextProjection?.(ownedLayer);
      const renderedText = String(renderedProjection?.text || '').trim().slice(0, 50000);
      if (renderedText && record.textStatus === 'full' && renderedText !== record.text) {
        const retained = textBudget.retain(record.pageNumber, renderedText);
        record.text = retained.text;
        incrementalDocument?.replace?.({
          pageNumber: record.pageNumber,
          text: renderedText,
          textStatus: 'full',
          hasVisualContent: record.hasVisualContent,
          ocrCandidate: record.ocrCandidate
        });
      }
    }
    if (!current() || record.textLayer !== ownedLayer) return false;
    ownedLayer.appendChild(Object.assign(document.createElement('div'), {
      className: 'endOfContent'
    }));
    record.textLayerReady = true;
    record.textLayerRenderGeneration = token.generation;
    record.section.classList.add('is-text-ready');
    return true;
  })();
  record.textLayerPromise = { generation: token.generation, layer: ownedLayer, promise: pending };
  try {
    return await pending;
  } finally {
    if (record.textLayerPromise?.promise === pending) record.textLayerPromise = null;
  }
}

async function renderMountedPage(record, token, signal) {
  if (!record?.mounted || !renderGeneration.isCurrent(token) || signal?.aborted ||
      !wantedPages.has(record.pageNumber) || !active) return;
  record.rendering = true;
  record.renderingGeneration = token.generation;
  let localTask = null;
  let stagedCanvas = null;
  let canvasCommitted = false;
  let canvasReservation = null;
  let admissionRejected = false;
  let detachAbort = null;
  try {
    const initialBounds = record.section?.getBoundingClientRect?.();
    const initialViewportBounds = typeof viewer === 'undefined'
      ? null : viewer?.getBoundingClientRect?.();
    const initiallyVisible = !initialBounds || !initialViewportBounds ||
      (initialBounds.bottom > initialViewportBounds.top &&
       initialBounds.top < initialViewportBounds.bottom);
    if (!initiallyVisible && !nativeNavigationPages.has(record.pageNumber)) return;
    const viewport = record.viewport;
    await ensureMountedPageTextLayer(record, token, signal);
    if (!record.mounted || !renderGeneration.isCurrent(token) || signal?.aborted ||
        !wantedPages.has(record.pageNumber) || !active) return;
    const requestedScale = Math.min(2.5, Math.max(1, globalThis.devicePixelRatio || 1));
    const currentPageNumber = currentPageRecord()?.pageNumber || record.pageNumber;
    const viewportBounds = typeof viewer === 'undefined'
      ? null : viewer?.getBoundingClientRect?.();
    const exactVisiblePages = viewportBounds ? [...pageRecords.values()].filter(candidate => {
      const bounds = candidate.section?.getBoundingClientRect?.();
      return bounds && bounds.bottom > viewportBounds.top && bounds.top < viewportBounds.bottom;
    }).map(candidate => candidate.pageNumber) : [currentPageNumber];
    // A focused sentence can sit near a page bottom while the next page wins
    // the viewport's current-page heuristic. Keep the visible cited page crisp.
    const current = exactVisiblePages.includes(record.pageNumber) ||
      record.pageNumber === currentPageNumber;
    const outputScale = canvasBudget.outputScale({
      width: viewport.width, height: viewport.height, requestedScale,
      current, offscreen: !current
    });
    let canvasAccepted = false;
    const shouldRenderCanvas = outputScale > 0 && exactVisiblePages.includes(record.pageNumber);
    if (shouldRenderCanvas) {
      const pixels = Math.max(1,
        Math.ceil(viewport.width * outputScale) * Math.ceil(viewport.height * outputScale));
      const admission = canvasBudget.reserve(record.pageNumber, {
        pixels, bytes: pixels * 4,
        protectedPages: [currentPageNumber, ...exactVisiblePages]
      });
      admission.evicted.forEach(number => releaseNativePdfCanvas(pageRecords.get(number)));
      canvasAccepted = admission.accepted;
      canvasReservation = admission.reservation;
      admissionRejected = !admission.accepted;
    }
    if (canvasAccepted) {
      if (!record.mounted || !renderGeneration.isCurrent(token) || signal?.aborted ||
          !wantedPages.has(record.pageNumber) || !active) return;
      const previousCanvas = record.canvas;
      const candidateCanvas = document.createElement('canvas');
      const canvas = candidateCanvas?.style && candidateCanvas?.getContext
        ? (stagedCanvas = candidateCanvas) : previousCanvas;
      canvas.className = 'pdf-native-page-canvas';
      canvas.width = Math.ceil(viewport.width * outputScale);
      canvas.height = Math.ceil(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      localTask = record.page.render({
        canvas, canvasContext: canvas.getContext('2d', { alpha: false }), viewport,
        transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
      });
      record.renderTask = localTask;
      const abort = () => { try { localTask?.cancel?.(); } catch (_) {} };
      signal?.addEventListener?.('abort', abort, { once: true });
      detachAbort = () => signal?.removeEventListener?.('abort', abort);
      await localTask.promise.catch(error => {
        throw rememberRenderFailure(error, record.documentGeneration);
      });
      if (!record.mounted || !renderGeneration.isCurrent(token) || signal?.aborted ||
          !wantedPages.has(record.pageNumber) || !active) return;
      if (canvas !== previousCanvas) {
        if (previousCanvas?.isConnected) previousCanvas.replaceWith(canvas);
        else record.section.insertBefore(canvas, record.textLayer || record.section.firstChild);
        record.canvas = canvas;
        if (previousCanvas) previousCanvas.width = previousCanvas.height = 0;
        canvasCommitted = true;
      }
      if (!canvasBudget.commit(canvasReservation)) {
        throw new Error('PDF_CANVAS_RESERVATION_COMMIT_FAILED');
      }
      canvasReservation = null;
      record.canvasResident = true;
      record.outputScale = outputScale;
    } else if (!record.canvasResident &&
        (admissionRejected || exactVisiblePages.includes(record.pageNumber))) {
      admissionRejected = true;
      record.rendered = false;
      record.section.classList.remove('is-rendered');
      return;
    }
    record.rendered = true;
    record.section.classList.add('is-rendered');
    dispatchPageLifecycleEvent('brevess:pdf-page-rendered', record);
    await renderPdfLinkLayer(record, token, signal);
  } catch (error) {
    if (error?.name === 'RenderingCancelledException' || error?.name === 'AbortError') {
      if (record.canvasResident) {
        record.rendered = true;
        record.section.classList.add('is-rendered');
      }
      return;
    }
    enterFallback(error);
    throw error;
  } finally {
    detachAbort?.();
    if (canvasReservation) canvasBudget.rollback(canvasReservation);
    if (stagedCanvas && !canvasCommitted) {
      stagedCanvas.width = 0;
      stagedCanvas.height = 0;
    }
    globalThis.SciLLM.completePdfNativeRender(record, {
      task: localTask,
      generation: token.generation,
      currentGeneration: renderGeneration.current(),
      wanted: !admissionRejected && active && wantedPages.has(record.pageNumber),
      reschedule: () => queueMicrotask(() => {
        void mountPage(record.pageNumber,
          record.pageNumber === currentPageRecord()?.pageNumber).catch(() => undefined);
      })
    });
  }
}

function mountPageLayers(record) {
  if (!record.mounted) {
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-native-page-canvas';
    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer pdf-native-text-layer';
    textLayer.tabIndex = 0;
    textLayer.setAttribute('data-sci-llm-paragraph-id', `pdf-page-${record.pageNumber}`);
    textLayer.dataset.pdfPageNumber = String(record.pageNumber);
    textLayer.addEventListener('click', event => {
      if (!document.getSelection().isCollapsed) return;
      const elements = document.elementsFromPoint(event.clientX, event.clientY);
      const hit = globalThis.SciLLM.pickPdfAnnotationHit(elements, record.pageNumber) ||
        elements.find(element => element?.matches?.('.pdf-native-automatic-hit') &&
          Number(element.closest?.('.pdf-native-page')?.dataset?.pdfPageNumber) ===
            record.pageNumber);
      hit?.click();
    });
    const linkLayer = document.createElement('div');
    linkLayer.className = 'pdf-native-link-layer';
    linkLayer.dataset.pdfPageNumber = String(record.pageNumber);
    linkLayer.style.position = 'absolute';
    linkLayer.style.inset = '0';
    linkLayer.style.pointerEvents = 'none';
    linkLayer.style.zIndex = '3';
    const annotationLayer = document.createElement('div');
    annotationLayer.className = 'pdf-native-annotation-layer';
    annotationLayer.dataset.pdfPageNumber = String(record.pageNumber);
    record.section.append(canvas, textLayer, linkLayer, annotationLayer);
    Object.assign(record, { canvas, textLayer, linkLayer, annotationLayer, mounted: true });
    record.section.classList.remove('pdf-native-page-placeholder');
    updateRecordViewport(record, stateController.getScale());
    renderPdfAnnotationOverlay(record);
  }
}

async function scheduleMountedPageRender(record, current = false, options = {}) {
  if (incrementalDocument && record.textStatus === 'full' && record.textContent &&
      incrementalDocument.pageStatus(record.pageNumber) !== 'full') {
    const normalizedText = globalThis.SciLLM.normalizePdfNativePageText(record.textContent, {
      maxLength: 50000
    });
    const hydration = incrementalDocument.hydrate({
      pageNumber: record.pageNumber,
      text: normalizedText
    });
    if (hydration.hydrated) {
      publishNativePdfStructure(outlineCache, [], 'partial-index');
    }
  }
  canvasBudget.touch(record.pageNumber);
  const token = renderGeneration.capture();
  if (options.waitForTextLayer === true) {
    const ready = await ensureMountedPageTextLayer(record, token, token.signal);
    if (!ready) return;
    return;
  }
  const pageBounds = record.section?.getBoundingClientRect?.();
  const viewportBounds = typeof viewer === 'undefined'
    ? null : viewer?.getBoundingClientRect?.();
  const exactVisible = pageBounds && viewportBounds
    ? pageBounds.bottom > viewportBounds.top && pageBounds.top < viewportBounds.bottom
    : current;
  let needsScaleUpgrade = false;
  if (exactVisible && record.rendered && record.canvasResident && !record.rendering) {
    const desiredScale = canvasBudget.outputScale({
      width: record.viewport.width, height: record.viewport.height,
      requestedScale: Math.min(2.5, Math.max(1, globalThis.devicePixelRatio || 1)),
      current: true
    });
    if ((record.outputScale || 0) + 0.01 < desiredScale) {
      needsScaleUpgrade = true;
      record.rendered = false;
      record.section.classList.remove('is-rendered');
    }
  }
  // Overscan pages keep their lightweight placeholder and cached text. Rendering
  // their connected TextLayers during wheel input caused multi-second layout
  // tasks before the page entered the viewport.
  if (!exactVisible && !nativeNavigationPages.has(record.pageNumber)) return;
  if (!record.rendered || !record.canvasResident || needsScaleUpgrade) {
    const pending = renderQueue.schedule(({ signal }) => renderMountedPage(record, token, signal), {
      priority: exactVisible ? 100 : 50,
      key: `page-${record.pageNumber}`,
      generation: token.generation,
      signal: token.signal,
      wanted: () => active && record.mounted && wantedPages.has(record.pageNumber)
    });
    await pending;
  }
}

const pageMountController = globalThis.SciLLM.createPdfNativePageMountController({
  getRecord: pageNumber => pageRecords.get(pageNumber),
  isActive: () => active,
  isDisposed: () => disposed,
  mountLayers: mountPageLayers,
  scheduleRender: scheduleMountedPageRender,
  getTextContent: record => loadCurrentPageTextContent(record.page, record.pageNumber, {
    sourceDocument: pdfDocument,
    documentHash: record.documentHash,
    documentGeneration: record.documentGeneration
  }),
  shouldLoadText: record => record.textStatus !== 'failed',
  onTextError: (error, record) => {
    markNativePdfPageTextFailure(record, error);
    return true;
  },
  onError: error => {
    if (error?.name !== 'RenderingCancelledException' && error?.name !== 'AbortError') {
      enterFallback(error);
    }
  }
});

async function mountPage(pageNumber, current = false, options = {}) {
  return pageMountController.mount(pageNumber, current, options);
}

async function ensureNativePdfPageIndexed(pageNumber, expected = {}, navigationSequence = 0) {
  const normalizedPage = Math.max(1, Math.floor(Number(pageNumber) || 1));
  const sourceDocument = pdfDocument;
  const sourceIncrementalDocument = incrementalDocument;
  const documentHash = loadedDocumentHash;
  const documentGeneration = nativeDocumentGeneration;
  const ownerMatches = () => nativeDocumentMatches(
    sourceDocument, documentHash, documentGeneration) &&
    sourceIncrementalDocument === incrementalDocument &&
    (!navigationSequence || (navigationSequence === nativeNavigationSequence &&
      currentPdfSemanticFocusRequestMatches(expected)));
  if (!sourceDocument || !sourceIncrementalDocument || !ownerMatches() ||
      normalizedPage > sourceDocument.numPages ||
      !globalThis.SciLLM.pdfRequestMatchesDocument({
        currentDocumentHash: documentHash,
        currentGeneration: documentGeneration,
        requestDocumentHash: expected.documentHash,
        requestGeneration: expected.documentGeneration
      })) throw new Error('STALE_PDF_SELECTION');
  wantedPages.add(normalizedPage);
  const record = await preparePage(normalizedPage, {
    retry: true, sourceDocument, documentHash, documentGeneration,
    skipAutoMount: Boolean(navigationSequence)
  });
  if (!ownerMatches()) throw new Error('STALE_PDF_SELECTION');
  if (!record || pageRecords.get(normalizedPage) !== record ||
      record.documentHash !== documentHash ||
      record.documentGeneration !== documentGeneration) {
    throw new Error('PDF_SELECTION_EVIDENCE_UNAVAILABLE');
  }
  const semanticPageUpdate = upsertPdfSemanticPage(record, { returnResult: true });
  if (navigationSequence && semanticPageUpdate?.changed) {
    throw Object.assign(new Error('STALE_PDF_SELECTION'), { code: 'STALE_PDF_SELECTION' });
  }
  let currentTextLayer = false;
  for (let attempt = 0; attempt < 3 && !currentTextLayer; attempt += 1) {
    let mountError = null;
    try {
      await mountPage(normalizedPage, true, navigationSequence
        ? { waitForTextLayer: true } : {});
    } catch (error) {
      mountError = error;
    }
    if (!ownerMatches() || pageRecords.get(normalizedPage) !== record) {
      throw new Error('STALE_PDF_SELECTION');
    }
    currentTextLayer = Boolean(record.mounted &&
      (navigationSequence ? record.textLayerReady : record.rendered) && record.textLayer &&
      record.textLayer.isConnected !== false);
    if (!currentTextLayer && mountError &&
        !['RenderingCancelledException', 'AbortError'].includes(mountError?.name)) {
      throw mountError;
    }
  }
  if (!currentTextLayer) {
    throw new Error('PDF_SELECTION_EVIDENCE_UNAVAILABLE');
  }
  if (record.textStatus === 'failed' || record.textStatus === 'empty') {
    sourceIncrementalDocument.add(record);
    if (!navigationSequence) publishNativePdfStructure(outlineCache, [], 'partial-index');
    throw new Error('PDF_SELECTION_EVIDENCE_UNAVAILABLE');
  }
  if (navigationSequence) return record;
  if (sourceIncrementalDocument.pageStatus(normalizedPage) !== 'full') {
    const normalizedText = record.text || globalThis.SciLLM.normalizePdfNativePageText(
      record.textContent, { maxLength: 50000 }
    );
    const hydration = sourceIncrementalDocument.hydrate({
      pageNumber: normalizedPage, text: normalizedText
    });
    if (!hydration?.hydrated) throw new Error('PDF_SELECTION_EVIDENCE_UNAVAILABLE');
  }
  if (!ownerMatches() || pageRecords.get(normalizedPage) !== record) {
    throw new Error('STALE_PDF_SELECTION');
  }
  const structure = publishNativePdfStructure(outlineCache, [], 'partial-index');
  if (!structure.paragraphs.some(item =>
    item.paragraphId === `pdf-page-${normalizedPage}` && item.text)) {
    throw new Error('PDF_SELECTION_EVIDENCE_UNAVAILABLE');
  }
  return pageRecords.get(normalizedPage);
}

function getPageProjection(pageNumber) {
  let normalizedPage = null;
  try { normalizedPage = Number(pageNumber); } catch (_) {}
  if (!Number.isSafeInteger(normalizedPage) || normalizedPage < 1) return null;
  return globalThis.SciLLM.createPdfNativePageProjection(pageRecords.get(normalizedPage), {
    documentHash: loadedDocumentHash,
    documentGeneration: nativeDocumentGeneration,
    renderGeneration: renderGeneration.current()
  });
}

function nativeDocumentOwnerMatches(sourceDocument, documentHash, documentGeneration) {
  return !disposed && !lifecycle.isTerminal() && sourceDocument === pdfDocument &&
    documentHash === loadedDocumentHash && documentGeneration === nativeDocumentGeneration;
}

function nativeDocumentMatches(sourceDocument, documentHash, documentGeneration) {
  return active && nativeDocumentOwnerMatches(sourceDocument, documentHash, documentGeneration);
}

function currentPdfSemanticFocusIdentityMatches(request) {
  const compatibility = currentOwnedPdfSemanticCompatibility();
  const navigation = compatibility?.semanticNavigation;
  return nativeDocumentMatches(pdfDocument, request?.documentHash,
    request?.documentGeneration) && Boolean(navigation &&
    navigation.documentId === request.documentId &&
    navigation.documentHash === request.documentHash &&
    navigation.documentGeneration === request.documentGeneration &&
    navigation.revision === request.revision &&
    navigation.semanticCacheKey === request.semanticCacheKey &&
    navigation.semanticProvenanceKey === request.semanticProvenanceKey);
}

function currentPdfSemanticNavigation() {
  return currentOwnedPdfSemanticCompatibility()?.semanticNavigation || null;
}

function samePdfSemanticFocusRequest(left, right) {
  const scalarKeys = ['schemaVersion', 'type', 'mode', 'documentId', 'documentHash',
    'documentGeneration', 'revision', 'semanticCacheKey', 'semanticProvenanceKey',
    'paragraphId', 'granularity', 'pageNumber', 'precision'];
  if (!left || !right || scalarKeys.some(key => left[key] !== right[key])) return false;
  const sameEntries = (first, second, keys) => Array.isArray(first) && Array.isArray(second) &&
    first.length === second.length && first.every((item, index) =>
      keys.every(key => item?.[key] === second[index]?.[key]));
  if (!sameEntries(left.ranges, right.ranges,
    ['pageNumber', 'start', 'end', 'quote', 'precision'])) return false;
  if (left.mode === 'page-only') {
    return sameEntries(left.pageNumbers, right.pageNumbers, []) &&
      left.pageNumbers.every((pageNumber, index) => pageNumber === right.pageNumbers[index]);
  }
  return left.pageNumbers === undefined && right.pageNumbers === undefined;
}

function currentPdfSemanticFocusRequestMatches(request) {
  if (!currentPdfSemanticFocusIdentityMatches(request)) return false;
  const compatibility = currentOwnedPdfSemanticCompatibility();
  const binding = nativeSemanticFocusRequestBindings.get(request);
  if (!binding || binding.compatibility !== compatibility ||
      binding.paragraphId !== request?.paragraphId) return false;
  const refreshed = compatibility.createNativeFocusRequest?.(
    binding.paragraphId, binding.start, binding.end, binding.expectedQuote);
  return currentOwnedPdfSemanticCompatibility() === compatibility &&
    samePdfSemanticFocusRequest(request, refreshed);
}

async function readPageTextContent(pageNumber) {
  const sourceDocument = pdfDocument;
  let normalizedPage = null;
  try { normalizedPage = Number(pageNumber); } catch (_) {}
  if (!sourceDocument || !active || disposed || lifecycle.isTerminal()) {
    throw new Error('PDF_DOCUMENT_NOT_READY');
  }
  if (!Number.isSafeInteger(normalizedPage) || normalizedPage < 1 ||
      normalizedPage > sourceDocument.numPages) {
    throw new Error('PDF_TEXT_PAGE_OUT_OF_RANGE');
  }
  const documentHash = loadedDocumentHash;
  const documentGeneration = nativeDocumentGeneration;
  const ownedRecord = pageRecords.get(normalizedPage);
  const page = ownedRecord?.documentHash === documentHash &&
    ownedRecord?.documentGeneration === documentGeneration
    ? ownedRecord.page : await sourceDocument.getPage(normalizedPage);
  if (!nativeDocumentMatches(sourceDocument, documentHash, documentGeneration)) {
    throw new Error('PDF_TEXT_DOCUMENT_CHANGED');
  }
  const textContent = await loadCurrentPageTextContent(page, normalizedPage, {
    sourceDocument, documentHash, documentGeneration
  });
  if (!nativeDocumentMatches(sourceDocument, documentHash, documentGeneration)) {
    throw new Error('PDF_TEXT_DOCUMENT_CHANGED');
  }
  return Object.freeze({
    pageNumber: normalizedPage,
    documentHash,
    documentGeneration,
    textContent
  });
}

async function renderPageImage(pageNumber, options = {}) {
  const sourceDocument = pdfDocument;
  if (!sourceDocument || !active || disposed || lifecycle.isTerminal()) {
    throw new Error('PDF_DOCUMENT_NOT_READY');
  }
  const documentHash = loadedDocumentHash;
  const documentGeneration = nativeDocumentGeneration;
  const request = globalThis.SciLLM.normalizePdfNativePageImageRequest(pageNumber, options, {
    pageCount: sourceDocument.numPages
  });
  return imageRenderQueue.schedule(async ({ signal }) => {
    if (!nativeDocumentMatches(sourceDocument, documentHash, documentGeneration) ||
        signal.aborted) throw new Error('PDF_IMAGE_DOCUMENT_CHANGED');
    const page = await sourceDocument.getPage(request.pageNumber);
    if (!nativeDocumentMatches(sourceDocument, documentHash, documentGeneration) ||
        signal.aborted) throw new Error('PDF_IMAGE_DOCUMENT_CHANGED');
    const viewport = page.getViewport({ scale: request.scale });
    const dimensions = globalThis.SciLLM.validatePdfNativeImageDimensions(viewport, {
      maxPixels: MAX_NATIVE_PDF_IMAGE_PIXELS
    });
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('PDF_IMAGE_CANVAS_UNAVAILABLE');
    let task = null;
    const abort = () => { try { task?.cancel?.(); } catch (_) {} };
    signal.addEventListener('abort', abort, { once: true });
    try {
      task = page.render({ canvas, canvasContext: context, viewport });
      await task.promise;
      if (!nativeDocumentMatches(sourceDocument, documentHash, documentGeneration) ||
          signal.aborted) throw new Error('PDF_IMAGE_DOCUMENT_CHANGED');
      const dataUrl = canvas.toDataURL('image/png');
      if (!nativeDocumentMatches(sourceDocument, documentHash, documentGeneration)) {
        throw new Error('PDF_IMAGE_DOCUMENT_CHANGED');
      }
      return Object.freeze({
        dataUrl,
        width: dimensions.width,
        height: dimensions.height,
        pageNumber: request.pageNumber,
        documentHash,
        documentGeneration
      });
    } finally {
      signal.removeEventListener('abort', abort);
      canvas.width = 0;
      canvas.height = 0;
    }
  }, {
    priority: 100,
    generation: documentGeneration,
    wanted: () => nativeDocumentMatches(sourceDocument, documentHash, documentGeneration)
  });
}

async function updatePageWindow(firstVisible, lastVisible) {
  if (!pdfDocument || !active || disposed) return [];
  const pages = stateController.pageWindow({
    firstVisible, lastVisible, pageCount: pdfDocument.numPages
  });
  viewportWantedPages = new Set(pages);
  refreshNativeWantedPages();
  pageRecords.forEach((record, number) => {
    if (!wantedPages.has(number)) unmountHeavyLayers(record);
  });
  const current = currentPageRecord()?.pageNumber || Math.max(1, Number(firstVisible) || 1);
  activatePdfSemanticView(current);
  const viewportBounds = typeof viewer === 'undefined'
    ? null : viewer?.getBoundingClientRect?.();
  const orderedPages = pages.slice().sort((left, right) => {
    const priority = number => {
      const bounds = pageRecords.get(number)?.section?.getBoundingClientRect?.();
      const exactVisible = bounds && viewportBounds && bounds.bottom > viewportBounds.top &&
        bounds.top < viewportBounds.bottom;
      return number === current ? 2 : exactVisible ? 1 : 0;
    };
    return priority(right) - priority(left) || Math.abs(left - current) - Math.abs(right - current);
  });
  await Promise.all(orderedPages.map(number =>
    mountPage(number, number === current).catch(() => undefined)
  ));
  return pages;
}

function notifyState(extra = {}) {
  const snapshot = Object.freeze({
    scale: stateController.getScale(), ready: Boolean(pdfDocument),
    documentHash: loadedDocumentHash,
    sourceHash: loadedSourceHash,
    documentGeneration: nativeDocumentGeneration,
    annotationsDigest: globalThis.SciLLM.pdfAnnotationSnapshotDigest(
      pdfAnnotationSnapshot.annotations
    ),
    ...extra
  });
  bridge.onState(snapshot);
  return snapshot;
}

function retireNativePdfSemanticNavigation() {
  nativeSemanticFocusActivity.cancel();
  beginNativePdfNavigation();
  nativeSemanticFocusController.invalidate();
}

function applyScale(scale, options = {}) {
  const preservePage = Number(options.preservePage) || 0;
  const anchor = pageRecords.get(preservePage) || currentPageRecord();
  const preserveSemanticTextPages = options.preserveSemanticText === true
    ? new Set(nativeNavigationPages) : new Set();
  // Direct controls are user navigation and always retire the prior semantic
  // target. Resize-driven fit-width is gated before it reaches this function.
  retireNativePdfSemanticNavigation();
  const viewerTop = viewer.getBoundingClientRect().top;
  const anchorScrollTop = viewer.scrollTop;
  const anchorTop = anchor ? anchor.section.getBoundingClientRect().top - viewerTop : null;
  const generation = renderGeneration.next();
  renderQueue.pruneGeneration(generation);
  globalThis.SciLLM.cancelPdfNativeRenders(pageRecords.values());
  canvasBudget.clear();
  pageRecords.forEach((record, pageNumber) => {
    unmountHeavyLayers(record, {
      preserveTextContent: preserveSemanticTextPages.has(pageNumber)
    });
    updateRecordViewport(record, scale);
  });
  if (anchor && Number.isFinite(anchorTop)) {
    requestAnimationFrame(() => {
      const nextTop = anchor.section.getBoundingClientRect().top - viewer.getBoundingClientRect().top;
      const target = globalThis.SciLLM.pdfNativeAnchoredScrollTop({
        scrollTop: anchorScrollTop, anchorTop, nextAnchorTop: nextTop
      });
      const delta = target - viewer.scrollTop;
      if (Math.abs(delta) > 1) viewer.scrollBy({ top: delta, behavior: 'auto' });
    });
  }
  const current = anchor?.pageNumber || 1;
  void updatePageWindow(current, current);
  notifyState();
  return scale;
}

function setScale(value, options = {}) { return applyScale(stateController.setScale(value), options); }
function zoomBy(delta) {
  let requested = 0;
  try { requested = Number(delta); } catch (_) {}
  return setScale(stateController.getScale() + (Number.isFinite(requested) ? requested : 0));
}
function fitWidth(options = {}) {
  const record = currentPageRecord();
  if (!record) return stateController.getScale();
  const previousScale = stateController.getScale();
  const style = globalThis.getComputedStyle(viewer);
  const scale = stateController.fitWidth({
    pageWidth: globalThis.SciLLM.pdfNativeUnscaledPageWidth(record.page),
    containerWidth: globalThis.SciLLM.pdfNativeContentWidth({
      clientWidth: viewer.clientWidth,
      paddingLeft: style.paddingLeft, paddingRight: style.paddingRight
    }), padding: 0
  });
  if (Math.abs(scale - previousScale) < 0.005) return previousScale;
  return applyScale(scale, {
    preservePage: record.pageNumber,
    preserveSemanticText: options.preserveSemanticText === true
  });
}

function activate() {
  if (lifecycle.isTerminal() || disposed) {
    globalThis.SciLLM.setPdfNativeSurface({ viewer, frame: fallbackFrame }, 'fallback');
    return false;
  }
  active = true;
  globalThis.SciLLM.setPdfNativeSurface({ viewer, frame: fallbackFrame }, 'native');
  ensureRenderObserver();
  pageRecords.forEach(record => renderObserver?.observe?.(record.section));
  const record = currentPageRecord();
  activatePdfSemanticView(record?.pageNumber || 1);
  void updatePageWindow(record?.pageNumber || 1, record?.pageNumber || 1);
  notifyState({ active: true });
  return true;
}

function deactivate() {
  cancelNativeSelectionPaint();
  retireNativePdfSemanticNavigation();
  active = false;
  deactivatePdfSemanticSidecar();
  renderGeneration.next();
  resizeScheduler.cancel();
  renderQueue.cancelAll();
  imageRenderQueue.cancelAll();
  renderObserver?.disconnect?.();
  renderObserver = null;
  globalThis.SciLLM.cancelPdfNativeRenders(pageRecords.values());
  pageRecords.forEach(unmountHeavyLayers);
  canvasBudget.clear();
  notifyState({ active: false });
}

async function releaseNativeResources({ destroyDocument = true } = {}) {
  cancelNativeSelectionPaint();
  resizeScheduler.cancel();
  renderObserver?.disconnect?.();
  resizeObserver?.disconnect?.();
  renderObserver = null;
  resizeObserver = null;
  renderQueue.cancelPending();
  indexQueue.cancelPending();
  imageRenderQueue.cancelAll();
  globalThis.SciLLM.cancelPdfNativeRenders(pageRecords.values());
  pageRecords.forEach(unmountHeavyLayers);
  pageRecords.clear();
  visiblePages.clear();
  nativePageTextContentLoads.clear();
  canvasBudget.clear();
  textBudget.clear();
  incrementalDocument?.clear?.();
  incrementalDocument = null;
  outlineCache = [];
  viewer?.replaceChildren?.();
  if (!destroyDocument) return;
  const documentToDestroy = pdfDocument;
  const taskToDestroy = loadingTask;
  pdfDocument = null;
  loadingTask = null;
  await globalThis.SciLLM.destroyPdfNativeDocumentResources({
    pdfDocument: documentToDestroy,
    loadingTask: taskToDestroy
  });
}

function suspendNativePdfForSourceSelection() {
  if (disposed) return false;
  retireNativePdfSemanticNavigation();
  clearNativePdfSemanticFocus();
  lifecycle.restart();
  pdfAnnotationSnapshot = Object.freeze({ documentHash: '', annotations: [] });
  loadedDocumentHash = '';
  loadedSourceHash = '';
  nativeDocumentGeneration += 1;
  resetPdfSemanticSidecar();
  delete globalThis.__brevessNativePdfDocument;
  delete document.documentElement.dataset.brevessNativePdfReady;
  active = false;
  renderGeneration.next();
  renderQueue.cancelAll();
  indexQueue.cancelAll();
  imageRenderQueue.cancelAll();
  void releaseNativeResources({ destroyDocument: true });
  return true;
}

async function replaceDocument() {
  ocrTextPages.clear();
  if (disposed) return false;
  retireNativePdfSemanticNavigation();
  clearNativePdfSemanticFocus();
  lifecycle.restart();
  pdfAnnotationSnapshot = Object.freeze({ documentHash: '', annotations: [] });
  loadedDocumentHash = '';
  loadedSourceHash = '';
  nativeDocumentGeneration += 1;
  resetPdfSemanticSidecar();
  const replacementGeneration = nativeDocumentGeneration;
  delete globalThis.__brevessNativePdfDocument;
  delete document.documentElement.dataset.brevessNativePdfReady;
  active = true;
  renderGeneration.next();
  renderQueue.cancelAll();
  indexQueue.cancelAll();
  imageRenderQueue.cancelAll();
  await releaseNativeResources({ destroyDocument: true });
  if (disposed || lifecycle.isTerminal() ||
      replacementGeneration !== nativeDocumentGeneration) return false;
  renewNativeTaskQueues();
  void startNativePdfInitialization();
  return true;
}

function dispose() {
  if (disposed) return;
  retireNativePdfSemanticNavigation();
  clearNativePdfSemanticFocus();
  disposed = true;
  active = false;
  lifecycle.fail();
  renderGeneration.next();
  loadedDocumentHash = '';
  loadedSourceHash = '';
  resetPdfSemanticSidecar();
  delete globalThis.__brevessNativePdfDocument;
  delete document.documentElement.dataset.brevessNativePdfReady;
  void releaseNativeResources({ destroyDocument: true });
}

function enterFallback(error) {
  if (lifecycle.isTerminal()) return;
  const failureDocumentGeneration = error &&
    (typeof error === 'object' || typeof error === 'function')
    ? renderFailureDocumentGenerations.get(error) : null;
  if (failureDocumentGeneration && failureDocumentGeneration !== nativeDocumentGeneration) return;
  lifecycle.fail();
  resetPdfSemanticSidecar({ terminal: true,
    errorCode: semanticErrorCode(error?.code, 'PDF_SIDECAR_TERMINAL_FALLBACK') });
  active = false;
  renderGeneration.next();
  void releaseNativeResources({ destroyDocument: true });
  viewer.dataset.state = 'error';
  globalThis.SciLLM.setPdfNativeSurface({ viewer, frame: fallbackFrame }, 'fallback');
  const fallbackUrl = bridge.originalUrl?.();
  const fallbackTarget = pendingFocusPage > 1
    ? `${String(fallbackUrl || '').replace(/#.*$/, '')}#page=${pendingFocusPage}` : fallbackUrl;
  if (fallbackTarget && fallbackFrame.src !== fallbackTarget) fallbackFrame.src = fallbackTarget;
  bridge.onState({ scale: stateController.getScale(), ready: false, error: true });
  document.dispatchEvent(new CustomEvent('brevess:native-pdf-error', {
    detail: {
      message: String(error?.message || error || 'PDF_NATIVE_READER_FAILED'),
      documentGeneration: nativeDocumentGeneration,
      documentHash: loadedDocumentHash,
      sourceIdentity: loadedDocumentHash
        ? `sha256:${loadedDocumentHash}` : `generation:${nativeDocumentGeneration}`
    }
  }));
}

function focusPage(pageNumber, options = {}) {
  const requestedSequence = Number(options.navigationSequence) || 0;
  if (requestedSequence && requestedSequence !== nativeNavigationSequence) return false;
  const navigationSequence = requestedSequence || beginNativePdfNavigation();
  if (options.semantic !== true) {
    nativeSemanticFocusOwnerToken = '';
    nativeSemanticFocusActivity.cancel();
    nativeSemanticFocusController.invalidate();
  }
  clearNativePdfSemanticFocus();
  const normalizedPage = Math.max(1, Number(pageNumber) || 1);
  const target = pageRecords.get(normalizedPage)?.section;
  if (!target) {
    pendingFocusPage = normalizedPage;
    pendingFocusNavigationSequence = navigationSequence;
    return false;
  }
  void updatePageWindow(normalizedPage, normalizedPage);
  // Scroll only the PDF viewport; scrolling every ancestor can move the reader
  // toolbar offscreen and makes a virtual page screenshot capture empty space.
  viewer.scrollTo({ top: viewer.scrollTop + target.getBoundingClientRect().top -
    viewer.getBoundingClientRect().top - 12, behavior: 'instant' });
  void updatePageWindow(normalizedPage, normalizedPage);
  target.classList.remove('pdf-native-page-focus');
  void target.offsetWidth;
  target.classList.add('pdf-native-page-focus');
  setTimeout(() => target.classList.remove('pdf-native-page-focus'), 1500);
  return true;
}

function clearNativePdfSemanticFocus() {
  viewer.querySelectorAll('.pdf-native-semantic-focus-layer').forEach(layer => layer.remove());
}

function applyNativePdfSemanticRangeFocus(entries) {
  if (!Array.isArray(entries) || !entries.length) return false;
  const layers = [];
  let firstRect = null;
  for (const entry of entries) {
    const pageElement = entry?.pageProjection?.pageElement;
    const textLayer = entry?.pageProjection?.textLayer;
    if (!pageElement?.isConnected || !textLayer?.isConnected ||
        !entry?.domRange?.getClientRects) return false;
    const pageRect = pageElement.getBoundingClientRect();
    const rects = globalThis.SciLLM.pdfProjectionRects?.(entry.domRange, pageRect) || [];
    if (!rects.length) return false;
    let layer = layers.find(candidate => candidate.pageElement === pageElement);
    if (!layer) {
      layer = { pageElement, element: document.createElement('div') };
      layer.element.className = 'pdf-native-semantic-focus-layer';
      layer.element.setAttribute('aria-hidden', 'true');
      layers.push(layer);
    }
    for (const rect of rects) {
      const mark = document.createElement('div');
      mark.className = 'pdf-native-semantic-focus-hit';
      for (const [key, value] of Object.entries(rect)) mark.style[key] = `${value}px`;
      layer.element.appendChild(mark);
      firstRect ||= { pageElement, rect };
    }
  }
  if (!firstRect || layers.some(layer => !layer.element.childElementCount)) return false;
  clearNativePdfSemanticFocus();
  layers.forEach(layer => layer.pageElement.appendChild(layer.element));
  const pageBounds = firstRect.pageElement.getBoundingClientRect();
  viewer.scrollTo({
    top: viewer.scrollTop + pageBounds.top - viewer.getBoundingClientRect().top +
      firstRect.rect.top - 28,
    behavior: 'instant'
  });
  return true;
}

function trustedCurrentPdfSemanticTarget(candidate, compatibility =
  currentOwnedPdfSemanticCompatibility(), allowSelection = false) {
  if (!candidate || typeof candidate !== 'object') return null;
  const navigation = compatibility?.semanticNavigation;
  const pending = [...(Array.isArray(navigation?.sections) ? navigation.sections : [])];
  while (pending.length) {
    const section = pending.shift();
    pending.push(...(Array.isArray(section?.children) ? section.children : []));
    const target = (Array.isArray(section?.paragraphTargets) ? section.paragraphTargets : [])
      .find(item => {
        const itemPages = Array.isArray(item?.pageNumbers) ? item.pageNumbers : [];
        const candidatePages = Array.isArray(candidate?.pageNumbers)
          ? candidate.pageNumbers : itemPages;
        return item?.paragraphId === candidate.paragraphId &&
        item.documentId === candidate.documentId &&
        item.documentHash === candidate.documentHash &&
        item.documentGeneration === candidate.documentGeneration &&
        item.revision === candidate.revision &&
        item.semanticCacheKey === candidate.semanticCacheKey &&
        item.semanticProvenanceKey === candidate.semanticProvenanceKey &&
        ((item.normalizedStart === candidate.normalizedStart &&
        item.normalizedEnd === candidate.normalizedEnd &&
        item.expectedNormalizedQuote === candidate.expectedNormalizedQuote) ||
          (allowSelection && normalizePdfSemanticFocusSelection(item, candidate))) &&
        itemPages.length === candidatePages.length &&
        itemPages.every((pageNumber, index) => pageNumber === candidatePages[index]);
      });
    if (target) return target;
  }
  return null;
}

function normalizePdfSemanticFocusSelection(target, selection) {
  const normalizedStart = selection === undefined
    ? target?.normalizedStart : selection?.normalizedStart;
  const normalizedEnd = selection === undefined
    ? target?.normalizedEnd : selection?.normalizedEnd;
  const expectedNormalizedQuote = selection === undefined
    ? target?.expectedNormalizedQuote : selection?.expectedNormalizedQuote;
  if (!Number.isSafeInteger(normalizedStart) || !Number.isSafeInteger(normalizedEnd) ||
      normalizedStart < target?.normalizedStart || normalizedEnd > target?.normalizedEnd ||
      normalizedEnd <= normalizedStart || typeof expectedNormalizedQuote !== 'string' ||
      !expectedNormalizedQuote.length ||
      target.expectedNormalizedQuote.slice(
        normalizedStart - target.normalizedStart,
        normalizedEnd - target.normalizedStart) !== expectedNormalizedQuote) return null;
  return Object.freeze({ normalizedStart, normalizedEnd, expectedNormalizedQuote });
}

function pdfSemanticHighlightOutcome({
  status = 'unresolved', precision = 'none', ranges = [], fallbackPageAnchors = [],
  reasonCode = 'PDF_HIGHLIGHT_RANGE_UNAVAILABLE', identity = null
} = {}) {
  const safeRanges = Object.freeze(ranges.map(range => Object.freeze({
    pageNumber: range.pageNumber,
    legacyParagraphId: `pdf-page-${range.pageNumber}`,
    start: range.start,
    end: range.end,
    quote: range.quote,
    precision: range.precision
  })));
  const safeAnchors = Object.freeze(fallbackPageAnchors.map(anchor => Object.freeze({
    pageNumber: anchor.pageNumber,
    legacyParagraphId: `pdf-page-${anchor.pageNumber}`
  })));
  return Object.freeze({
    status,
    precision,
    ranges: safeRanges,
    fallbackPageAnchors: safeAnchors,
    reasonCode: status === 'resolved' || status === 'degraded' ? '' : reasonCode,
    ...(identity || {})
  });
}

function resolvePdfSemanticHighlight(locator, expectedNativeBinding) {
  const stale = () => pdfSemanticHighlightOutcome({
    status: 'stale', reasonCode: 'PDF_HIGHLIGHT_STALE'
  });
  const unresolved = reasonCode => pdfSemanticHighlightOutcome({ reasonCode });
  const nativeDocument = globalThis.__brevessNativePdfDocument;
  if (!expectedNativeBinding || !nativeDocument ||
      expectedNativeBinding.documentHash !== nativeDocument.structure?.documentHash ||
      expectedNativeBinding.documentGeneration !== nativeDocument.documentGeneration) {
    return stale();
  }
  const own = (value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.hasOwn(descriptor, 'value')
        ? descriptor.value : undefined;
    } catch (_) {
      return undefined;
    }
  };
  const candidate = {
    documentId: own(locator, 'documentId'),
    documentHash: own(locator, 'documentHash'),
    documentGeneration: own(locator, 'documentGeneration'),
    revision: own(locator, 'revision'),
    semanticCacheKey: own(locator, 'semanticCacheKey'),
    semanticProvenanceKey: own(locator, 'semanticProvenanceKey'),
    paragraphId: own(locator, 'paragraphId'),
    normalizedStart: own(locator, 'normalizedStart'),
    normalizedEnd: own(locator, 'normalizedEnd'),
    expectedNormalizedQuote: own(locator, 'expectedNormalizedQuote')
  };
  const validText = (value, limit) => typeof value === 'string' &&
    value.length > 0 && value.length <= limit;
  if (!validText(candidate.documentHash, 64) ||
      !/^[a-f0-9]{64}$/u.test(candidate.documentHash) ||
      candidate.documentId !== `sha256:${candidate.documentHash}` ||
      !Number.isSafeInteger(candidate.documentGeneration) ||
      candidate.documentGeneration < 1 ||
      !Number.isSafeInteger(candidate.revision) || candidate.revision < 1 ||
      !validText(candidate.semanticCacheKey, 1000) ||
      !validText(candidate.semanticProvenanceKey, 1000) ||
      !validText(candidate.paragraphId, 1000) ||
      !Number.isSafeInteger(candidate.normalizedStart) ||
      !Number.isSafeInteger(candidate.normalizedEnd) ||
      candidate.normalizedStart < 0 ||
      candidate.normalizedEnd <= candidate.normalizedStart ||
      !validText(candidate.expectedNormalizedQuote, 50000) ||
      candidate.expectedNormalizedQuote.length !==
        candidate.normalizedEnd - candidate.normalizedStart) {
    return unresolved('PDF_HIGHLIGHT_INVALID_LOCATOR');
  }
  if (candidate.documentHash !== nativeDocument.structure?.documentHash ||
      candidate.documentGeneration !== nativeDocument.documentGeneration) {
    return stale();
  }
  const compatibility = currentOwnedPdfSemanticCompatibility();
  const navigation = compatibility?.semanticNavigation;
  if (!compatibility || !navigation ||
      navigation.documentId !== candidate.documentId ||
      navigation.documentHash !== candidate.documentHash ||
      navigation.documentGeneration !== candidate.documentGeneration ||
      navigation.revision !== candidate.revision ||
      navigation.semanticCacheKey !== candidate.semanticCacheKey ||
      navigation.semanticProvenanceKey !== candidate.semanticProvenanceKey) return stale();
  // A highlight/citation locator can select a sentence inside the trusted
  // paragraph. Keep ordinary navigation handles strict and validate the slice
  // against its owned paragraph before the adapter resolves raw page ranges.
  const target = trustedCurrentPdfSemanticTarget(candidate, compatibility, true);
  if (!target) return unresolved('PDF_HIGHLIGHT_LOCATOR_UNRESOLVED');
  const request = compatibility.createNativeFocusRequest?.(
    target.paragraphId,
    candidate.normalizedStart,
    candidate.normalizedEnd,
    candidate.expectedNormalizedQuote
  );
  if (!request) return unresolved('PDF_HIGHLIGHT_RANGE_UNAVAILABLE');
  if (nativeDocument !== globalThis.__brevessNativePdfDocument ||
      currentOwnedPdfSemanticCompatibility() !== compatibility ||
      trustedCurrentPdfSemanticTarget(candidate, compatibility, true) !== target ||
      !currentPdfSemanticFocusIdentityMatches(request)) return stale();
  if (request.documentId !== candidate.documentId ||
      request.documentHash !== candidate.documentHash ||
      request.documentGeneration !== candidate.documentGeneration ||
      request.revision !== candidate.revision ||
      request.semanticCacheKey !== candidate.semanticCacheKey ||
      request.semanticProvenanceKey !== candidate.semanticProvenanceKey ||
      request.paragraphId !== candidate.paragraphId) {
    return unresolved('PDF_HIGHLIGHT_RANGE_INVALID');
  }
  const identity = Object.freeze({ ...candidate });
  if (request.mode === 'page-only') {
    if (request.precision !== 'page-only' || !Array.isArray(request.ranges) ||
        request.ranges.length || !Array.isArray(request.pageNumbers) ||
        request.pageNumbers.length < 1 || request.pageNumbers.length > 4 ||
        request.pageNumber !== request.pageNumbers[0]) {
      return unresolved('PDF_HIGHLIGHT_RANGE_INVALID');
    }
    const anchors = [];
    for (const pageNumber of request.pageNumbers) {
      if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 ||
          anchors.some(anchor => anchor.pageNumber === pageNumber) ||
          (anchors.length && pageNumber < anchors.at(-1).pageNumber)) {
        return unresolved('PDF_HIGHLIGHT_RANGE_INVALID');
      }
      anchors.push({ pageNumber });
    }
    if (nativeDocument !== globalThis.__brevessNativePdfDocument ||
        currentOwnedPdfSemanticCompatibility() !== compatibility) return stale();
    return pdfSemanticHighlightOutcome({
      status: 'degraded', precision: 'page-only', fallbackPageAnchors: anchors, identity
    });
  }
  if (request.mode !== 'ranges' || !Array.isArray(request.ranges) ||
      request.ranges.length < 1 || request.ranges.length > 16 ||
      request.pageNumbers !== undefined) {
    return unresolved('PDF_HIGHLIGHT_RANGE_INVALID');
  }
  const ranges = [];
  const pages = new Set();
  let previous = null;
  for (const range of request.ranges) {
    if (!Number.isSafeInteger(range?.pageNumber) || range.pageNumber < 1 ||
        !Number.isSafeInteger(range?.start) || !Number.isSafeInteger(range?.end) ||
        range.start < 0 || range.end <= range.start ||
        typeof range?.quote !== 'string' || !range.quote.length ||
        range.quote.length !== range.end - range.start ||
        !['exact-raw', 'normalized-equivalent'].includes(range.precision) ||
        (previous && (range.pageNumber < previous.pageNumber ||
          (range.pageNumber === previous.pageNumber && range.start < previous.end)))) {
      return unresolved('PDF_HIGHLIGHT_RANGE_INVALID');
    }
    pages.add(range.pageNumber);
    if (pages.size > 4) return unresolved('PDF_HIGHLIGHT_RANGE_INVALID');
    ranges.push({
      pageNumber: range.pageNumber,
      start: range.start,
      end: range.end,
      quote: range.quote,
      precision: range.precision
    });
    previous = range;
  }
  const rangePrecision = ranges.some(range => range.precision === 'normalized-equivalent')
    ? 'normalized-equivalent' : 'exact-raw';
  // The owned compatibility adapter can mark the whole normalized selection as
  // equivalent even when every retained raw fragment is exact. Virtual spaces,
  // removed line-break hyphens, or other verified gaps live between fragments
  // and therefore cannot be inferred from the sanitized ranges alone.
  const precision = request.precision;
  if (request.pageNumber !== ranges[0].pageNumber ||
      !['exact-raw', 'normalized-equivalent'].includes(precision) ||
      (rangePrecision === 'normalized-equivalent' && precision !== rangePrecision)) {
    return unresolved('PDF_HIGHLIGHT_RANGE_INVALID');
  }
  if (nativeDocument !== globalThis.__brevessNativePdfDocument ||
      currentOwnedPdfSemanticCompatibility() !== compatibility) return stale();
  return pdfSemanticHighlightOutcome({
    status: 'resolved', precision, ranges, identity
  });
}

function createPdfSemanticHighlightResolver(nativeDocument) {
  const binding = Object.freeze({
    documentHash: String(nativeDocument?.structure?.documentHash || ''),
    documentGeneration: Number(nativeDocument?.documentGeneration) || 0
  });
  return Object.freeze(locator => resolvePdfSemanticHighlight(locator, binding));
}

function createNativePdfDocumentPublication(fields = {}) {
  const nativeDocument = { ...fields };
  nativeDocument.resolveSemanticHighlight =
    createPdfSemanticHighlightResolver(nativeDocument);
  return Object.freeze(nativeDocument);
}

function scheduleNativeSemanticCanvasPages(request) {
  const pages = [...nativeNavigationPages];
  const navigationSequence = nativeNavigationSequence;
  queueMicrotask(() => {
    if (navigationSequence !== nativeNavigationSequence ||
        !currentPdfSemanticFocusRequestMatches(request)) return;
    const currentPage = currentPageRecord()?.pageNumber || pages[0] || 1;
    for (const pageNumber of pages) {
      void mountPage(pageNumber, pageNumber === currentPage).catch(() => undefined);
    }
  });
}

function cancelOwnedSemanticFocus(ownerToken) {
  if (!ownerToken || ownerToken !== nativeSemanticFocusOwnerToken) return false;
  nativeSemanticFocusOwnerToken = '';
  nativeSemanticFocusActivity.cancel();
  nativeSemanticFocusController.invalidate();
  beginNativePdfNavigation();
  return true;
}

async function focusPdfSemanticTarget(candidate, selection, options = {}) {
  const compatibility = currentOwnedPdfSemanticCompatibility();
  const target = trustedCurrentPdfSemanticTarget(candidate, compatibility);
  const normalizedSelection = target && normalizePdfSemanticFocusSelection(target, selection);
  if (!compatibility || !target || !normalizedSelection ||
      !currentPdfSemanticFocusIdentityMatches(target)) {
    return Object.freeze({ focused: false, focusedGranularity: 'none', precision: 'none',
      reasonCode: 'PDF_FOCUS_STALE', pageNumber: null });
  }
  const request = compatibility.createNativeFocusRequest?.(
    target.paragraphId, normalizedSelection.normalizedStart,
    normalizedSelection.normalizedEnd, normalizedSelection.expectedNormalizedQuote);
  if (!request) {
    return Object.freeze({ focused: false, focusedGranularity: 'none', precision: 'none',
      reasonCode: 'PDF_FOCUS_RANGE_UNAVAILABLE',
      pageNumber: null });
  }
  if (currentOwnedPdfSemanticCompatibility() !== compatibility ||
      trustedCurrentPdfSemanticTarget(target, compatibility) !== target ||
      !currentPdfSemanticFocusIdentityMatches(request)) {
    return Object.freeze({ focused: false, focusedGranularity: 'none', precision: 'none',
      reasonCode: 'PDF_FOCUS_STALE', pageNumber: null });
  }
  nativeSemanticFocusRequestBindings.set(request, {
    compatibility,
    paragraphId: target.paragraphId,
    start: normalizedSelection.normalizedStart,
    end: normalizedSelection.normalizedEnd,
    expectedQuote: normalizedSelection.expectedNormalizedQuote
  });
  nativeSemanticFocusOwnerToken = typeof options.ownerToken === 'string'
    ? options.ownerToken.slice(0, 128) : '';
  const finish = result => {
    if (result?.focused === true) scheduleNativeSemanticCanvasPages(request);
    return result;
  };
  // A ResizeObserver fit during page mounting is deferred so it cannot tear
  // down an earlier target page. Apply it once, then replay the same bound
  // request to rebuild exact DOM ranges at the final scale.
  for (let automaticRefitCount = 0; automaticRefitCount <= 1; automaticRefitCount += 1) {
    const activityToken = nativeSemanticFocusActivity.start();
    let result;
    let deferredAutomaticFitWidth = false;
    try {
      result = await nativeSemanticFocusController.focus(request);
      deferredAutomaticFitWidth =
        nativeSemanticFocusActivity.consumeDeferredAutomaticFitWidth(activityToken);
    } finally {
      nativeSemanticFocusActivity.end(activityToken);
    }
    if (!deferredAutomaticFitWidth || automaticRefitCount >= 1) return finish(result);
    if (!currentPdfSemanticFocusRequestMatches(request)) {
      return Object.freeze({ focused: false, focusedGranularity: 'none', precision: 'none',
        reasonCode: 'PDF_FOCUS_STALE', pageNumber: null });
    }
    const previousScale = stateController.getScale();
    const nextScale = fitWidth({ preserveSemanticText: true });
    if (Math.abs(nextScale - previousScale) < 0.005) return finish(result);
    if (result?.focused !== true) return result;
  }
  return Object.freeze({ focused: false, focusedGranularity: 'none', precision: 'none',
    reasonCode: 'PDF_FOCUS_STALE', pageNumber: null });
}

function publishNativePdfStructure(outline, pages, phase) {
  incrementalDocument ||= globalThis.SciLLM.createNativePdfIncrementalDocument({
    title: bridge.title || document.title, url: bridge.sourceUrl || location.href, outline,
    documentIdentity: loadedDocumentHash, documentHash: loadedDocumentHash,
    maxTextCharacters: MAX_NATIVE_PDF_TEXT_CHARACTERS,
    pageCount: pdfDocument?.numPages || 0
  });
  let snapshot = incrementalDocument.snapshot(phase);
  for (const page of pages) {
    snapshot = incrementalDocument.merge(page, phase);
    textBudget.release(page.pageNumber);
    page.text = '';
  }
  const structure = withOcrProvenance(snapshot.structure);
  const publishedPhase = snapshot.phase;
  globalThis.__brevessNativePdfDocument = createNativePdfDocumentPublication({
    structure, outline, pageCount: pdfDocument?.numPages || 0,
    focusPage, focusSemanticTarget: focusPdfSemanticTarget,
    getSemanticNavigation: currentPdfSemanticNavigation, phase: publishedPhase,
    documentGeneration: nativeDocumentGeneration
  });
  publishPdfSemanticCompatibility();
  nativeViewerPublishedGeneration = nativeDocumentGeneration;
  document.documentElement.dataset.brevessNativePdfReady = 'true';
  document.dispatchEvent(new CustomEvent('brevess:native-pdf-ready', {
    detail: {
      phase: publishedPhase, pageCount: pdfDocument?.numPages || 0,
      outlineCount: structure.diagnostics.headingCount,
      paragraphCount: structure.diagnostics.paragraphCount,
      textCoverage: structure.diagnostics.textCoverage
    }
  }));
  return structure;
}

async function indexRemainingPages(initialization, owner) {
  const sourceDocument = owner.sourceDocument;
  const sourceIncrementalDocument = owner.incrementalDocument;
  const sourceIndexQueue = owner.indexQueue;
  const documentHash = owner.documentHash;
  const documentGeneration = owner.documentGeneration;
  const sourceOutline = owner.outline;
  const isCurrent = () => initialization.canCommit() &&
    nativeDocumentOwnerMatches(sourceDocument, documentHash, documentGeneration) &&
    incrementalDocument === sourceIncrementalDocument && indexQueue === sourceIndexQueue;
  let nextPage = 2;
  let completed = 0;
  async function worker() {
    while (nextPage <= sourceDocument.numPages && isCurrent()) {
      const pageNumber = nextPage++;
      const record = await sourceIndexQueue.schedule(({ signal }) => preparePage(pageNumber, {
        sourceDocument, documentHash, documentGeneration, initialization, signal
      }), {
        key: `index-${pageNumber}`,
        generation: documentGeneration,
        wanted: isCurrent
      });
      if (!record || !isCurrent()) return;
      sourceIncrementalDocument.add(record);
      upsertPdfSemanticPage(record);
      textBudget.release(record.pageNumber);
      if (!wantedPages.has(record.pageNumber)) record.text = '';
      completed += 1;
      if (globalThis.SciLLM.shouldPublishNativePdfCheckpoint(completed)) {
        publishNativePdfStructure(sourceOutline, [], 'indexing');
      }
    }
  }
  await Promise.all([worker(), worker()]);
  if (!isCurrent()) return;
  const stats = sourceIncrementalDocument.stats();
  const completionPhase = stats.terminal && stats.complete ? 'text-ready' : 'partial-index';
  const snapshot = sourceIncrementalDocument.snapshot(completionPhase);
  globalThis.__brevessNativePdfDocument = createNativePdfDocumentPublication({
    structure: withOcrProvenance(snapshot.structure), outline: sourceOutline,
    pageCount: sourceDocument.numPages,
    focusPage, focusSemanticTarget: focusPdfSemanticTarget,
    getSemanticNavigation: currentPdfSemanticNavigation, phase: snapshot.phase,
    documentGeneration
  });
  publishPdfSemanticCompatibility();
  nativeViewerPublishedGeneration = documentGeneration;
  document.dispatchEvent(new CustomEvent('brevess:native-pdf-ready', {
    detail: {
      phase: snapshot.phase, pageCount: sourceDocument.numPages,
      outlineCount: snapshot.structure.diagnostics.headingCount,
      paragraphCount: snapshot.structure.diagnostics.paragraphCount,
      textCoverage: snapshot.structure.diagnostics.textCoverage,
      terminal: stats.terminal,
      failedPages: stats.failedPages
    }
  }));
  if (stats.terminal) completePdfSemanticCollection();
}

async function initializeNativePdf() {
  const initialization = arguments[0];
  const documentGeneration = initialization.documentGeneration;
  try {
    if (!initialization.canCommit()) return { complete: false };
    if (nativeViewerPublishedGeneration !== documentGeneration) viewer.dataset.state = 'loading';
    const bytes = await bridge.getBytes();
    if (!initialization.canCommit()) return { complete: false };
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    if (!initialization.canCommit()) return { complete: false };
    const documentHash = Array.from(new Uint8Array(digest), byte =>
      byte.toString(16).padStart(2, '0')).join('');
    const sourceLoadingTask = getDocument({
      data: bytes.slice(),
      cMapUrl: chrome.runtime.getURL('vendor/pdfjs/cmaps/'), cMapPacked: true,
      standardFontDataUrl: chrome.runtime.getURL('vendor/pdfjs/standard_fonts/'),
      iccUrl: chrome.runtime.getURL('vendor/pdfjs/iccs/'),
      wasmUrl: chrome.runtime.getURL('vendor/pdfjs/wasm/'),
      enableXfa: true, useSystemFonts: true
    });
    if (!initialization.canCommit()) {
      await globalThis.SciLLM.destroyPdfNativeDocumentResources({ loadingTask: sourceLoadingTask });
      return { complete: false };
    }
    loadedDocumentHash = documentHash;
    loadedSourceHash = documentHash;
    loadingTask = sourceLoadingTask;
    const sourceDocument = await sourceLoadingTask.promise;
    if (!initialization.canCommit()) {
      await globalThis.SciLLM.destroyPdfNativeDocumentResources({
        pdfDocument: sourceDocument, loadingTask: sourceLoadingTask
      });
      return { complete: false };
    }
    if (loadingTask !== sourceLoadingTask) return { complete: false };
    pdfDocument = sourceDocument;
    const metadata = await sourceDocument.getMetadata().catch(() => null);
    if (!initialization.canCommit()) return { complete: false };
    bridge.onMetadata?.({ title: metadata?.info?.Title ||
      metadata?.metadata?.get?.('dc:title') || '' });
    if (!initialization.canCommit()) return { complete: false };
    const sourceOutline = await sourceDocument.getOutline()
      .then(items => normalizeOutline(items, 0, sourceDocument));
    if (!initialization.canCommit()) return { complete: false };
    outlineCache = sourceOutline;
    publishNativePdfStructure(sourceOutline, [], 'outline');
    const firstPage = await preparePage(1, {
      sourceDocument, documentHash, documentGeneration, initialization
    });
    if (!firstPage || !initialization.canCommit()) return { complete: false };
    await updatePageWindow(1, 1);
    if (!initialization.canCommit()) return { complete: false };
    publishNativePdfStructure(sourceOutline, [firstPage], 'interactive');
    bridge.onReady(Object.freeze({
      activate, deactivate, dispose, replaceDocument,
      setScale, zoomBy, fitWidth, updatePageWindow,
      ensurePageIndexed: ensureNativePdfPageIndexed,
      getPageProjection, readPageTextContent, renderPageImage, installOcrTextLayer,
      getState: () => notifyState(), focusPage, focusSemanticTarget: focusPdfSemanticTarget,
      cancelOwnedSemanticFocus,
      resolveSemanticHighlight: createPdfSemanticHighlightResolver(
        globalThis.__brevessNativePdfDocument
      ),
      getSemanticNavigation: currentPdfSemanticNavigation,
      exportAnnotatedPdf, verifyAnnotatedPdf,
      isSaveContextCurrent, adoptSavedSourceHash
    }));
    activatePdfSemanticSidecar(firstPage);
    notifyState({ phase: 'first-page-ready' });
    resizeObserver = new ResizeObserver(() => resizeScheduler.schedule());
    resizeObserver.observe(viewer);
    viewer.dataset.state = 'ready';
    globalThis.SciLLM.setPdfNativeSurface({ viewer, frame: fallbackFrame }, 'native');
    const owner = Object.freeze({
      sourceDocument,
      documentHash,
      documentGeneration,
      incrementalDocument,
      indexQueue,
      outline: sourceOutline
    });
    void indexRemainingPages(initialization, owner).catch(error => {
      if (initialization.canCommit() && error?.name !== 'AbortError') {
        enterFallback(error);
      }
    });
    return { complete: true, documentGeneration };
  } catch (error) {
    if (initialization.canCommit()) enterFallback(error);
    return { complete: false, documentGeneration };
  }
}

function startNativePdfInitialization() {
  if (!viewer || !bridge?.getBytes) return Promise.resolve({ complete: false });
  if (nativeDocumentGeneration === 0) nativeDocumentGeneration = 1;
  const documentGeneration = nativeDocumentGeneration;
  return nativeInitializationLeases.run({
    documentGeneration,
    createLifecycleToken: () => lifecycle.begin(),
    canLifecycleCommit: token => lifecycle.canCommit(token),
    task: initializeNativePdf
  });
}

document.addEventListener('brevess:focus-native-pdf-page', event => {
  focusPage(event?.detail?.pageNumber);
});
document.addEventListener('selectionchange',()=>{
  if (!active || disposed || lifecycle.isTerminal()) return;
  if (!nativeSelectionPaintFrame) nativeSelectionPaintFrame=requestAnimationFrame(paintNativeSelection);
});
document.addEventListener('brevess:pdf-page-unmounted',event=>clearNativeSelectionPaint(event.detail?.pageNumber));
document.addEventListener('brevess:pdf-source-changing',cancelNativeSelectionPaint);
document.addEventListener('brevess:pdf-selection-anchor-request',
  handlePdfSelectionAnchorRequest);
document.addEventListener('brevess:pdf-annotations-updated', handlePdfAnnotationsUpdated);
document.addEventListener('brevess:pdf-source-changing', suspendNativePdfForSourceSelection);
document.addEventListener('brevess:pdf-document-change', () => void replaceDocument());
globalThis.addEventListener('pagehide', dispose, { once: true });

let scrollRenderTimer = null;
viewer?.addEventListener('scroll', () => {
  clearTimeout(scrollRenderTimer);
  scrollRenderTimer = setTimeout(() => {
    if (!active || disposed || lifecycle.isTerminal()) return;
    const current = currentPageRecord()?.pageNumber || 1;
    void updatePageWindow(current, current);
  }, 90);
}, { passive: true });

void startNativePdfInitialization();
