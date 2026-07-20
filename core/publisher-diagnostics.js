(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const DIAGNOSTIC_VERSION = '2.1.1-publisher-diagnostic-r2';
  const DIAGNOSTIC_KIND = 'sci-publisher-adapter-diagnostic';
  const DIAGNOSTIC_SCHEMA_VERSION = 2;
  const DEFAULT_MAX_DOM_BYTES = 32 * 1024 * 1024;
  const MAX_TRACE_RECORDS = 40;
  const ROOT_SELECTORS = Object.freeze([
    '#body', '.Body', '#article-body', '.article-body',
    '[data-aa-name="article-body"]', '.article__sections',
    '[data-testid="article-body"]', '[data-article-body]',
    'article', 'main', '[role="main"]'
  ]);
  const BODY_SELECTORS = Object.freeze([
    'p', '[role="paragraph"]', '.section-paragraph',
    '.article-section p', '.article-section__content > div',
    '[data-aa-name*="paragraph" i]', '.Body'
  ]);
  const HEADING_SELECTOR =
    'h1,h2,h3,h4,h5,h6,[role="heading"],.section-title,.section__title,.article-section-title';
  const PLUGIN_UI_SELECTOR = [
    '[data-sci-llm-ui]', '[data-sci-plugin-ui]', '#sci-llm-reading-view',
    '#sci-annotation-toolbar', '#sci-manual-highlight-toolbar', '#sci-evidence-ledger'
  ].join(',');

  function queryAll(root, selector) {
    if (!root?.querySelectorAll || !selector) return [];
    try {
      return [...root.querySelectorAll(selector)];
    } catch (_) {
      return [];
    }
  }

  function normalizeHeading(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  function classTokens(element) {
    return typeof element?.className === 'string'
      ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 8)
      : [];
  }

  function describeElement(element) {
    const tag = String(element?.tagName || 'UNKNOWN').toUpperCase();
    const id = String(element?.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
    const classes = classTokens(element)
      .map(item => item.replace(/[^a-zA-Z0-9_-]/g, ''))
      .filter(Boolean);
    return `${tag}${id ? `#${id}` : ''}${classes.length ? `.${classes.join('.')}` : ''}`;
  }

  function elementDepth(element) {
    let depth = 0;
    let current = element?.parentElement || null;
    while (current && depth < 100) {
      depth += 1;
      current = current.parentElement || null;
    }
    return depth;
  }

  function serializeDiagnosticError(error) {
    if (!error) return { message: 'Unknown diagnostic error' };
    return {
      name: String(error.name || 'Error').slice(0, 160),
      message: String(error.message || error).slice(0, 4000),
      code: error.code == null ? undefined : String(error.code).slice(0, 160),
      stack: typeof error.stack === 'string' ? error.stack.slice(0, 12000) : undefined
    };
  }

  function structuredCloneLike(value) {
    if (value == null) return value;
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
    } catch (_) {
      // Fall through to the data-only JSON clone.
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return { error: serializeDiagnosticError(error) };
    }
  }

  function createExtractionTraceRecorder({ limit = MAX_TRACE_RECORDS, now = () => Date.now() } = {}) {
    const records = [];
    const boundedLimit = Math.max(1, Math.min(200, Number(limit) || MAX_TRACE_RECORDS));
    let sequence = 0;

    function begin({ source, stage } = {}) {
      const startedAtMs = now();
      const record = {
        operationId: ++sequence,
        source: String(source || ''),
        stage: String(stage || ''),
        status: 'running',
        startedAt: new Date(startedAtMs).toISOString(),
        startedAtMs
      };
      records.push(record);
      if (records.length > boundedLimit) records.splice(0, records.length - boundedLimit);
      return record.operationId;
    }

    function settle(operationId, status, details = {}) {
      const record = records.find(item => item.operationId === operationId);
      if (!record) return;
      const endedAtMs = now();
      record.status = status;
      record.endedAt = new Date(endedAtMs).toISOString();
      record.durationMs = Math.max(0, endedAtMs - record.startedAtMs);
      delete record.startedAtMs;
      Object.assign(record, structuredCloneLike(details));
    }

    return Object.freeze({
      begin,
      complete: (operationId, details) => settle(operationId, 'complete', details),
      fail: (operationId, error, details = {}) => settle(operationId, 'failed', {
        ...structuredCloneLike(details),
        error: serializeDiagnosticError(error)
      }),
      snapshot: () => records.map(item => {
        const snapshot = structuredCloneLike(item);
        delete snapshot.startedAtMs;
        return snapshot;
      })
    });
  }

  function utf8ByteLength(value) {
    const text = String(value || '');
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).byteLength;
    return text.length;
  }

  function truncateUtf8(value, maxBytes) {
    const text = String(value || '');
    const limit = Math.max(0, Number(maxBytes) || 0);
    if (!limit || utf8ByteLength(text) <= limit) return { text, truncated: false };
    if (typeof TextEncoder === 'function' && typeof TextDecoder === 'function') {
      const bytes = new TextEncoder().encode(text);
      return {
        text: new TextDecoder().decode(bytes.slice(0, limit)),
        truncated: true
      };
    }
    return { text: text.slice(0, limit), truncated: true };
  }

  function sanitizeHtmlString(value) {
    return String(value || '')
      .replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, '<script$1></script>')
      .replace(/<style\b([^>]*)>[\s\S]*?<\/style\s*>/gi, '<style$1></style>')
      .replace(/\b(src|href|poster)=(['"])data:[\s\S]*?\2/gi,
        '$1=$2data:sci-diagnostic-media-omitted$2')
      .replace(/\bsrcset=(['"])[\s\S]*?\1/gi,
        'srcset=$1data:sci-diagnostic-media-omitted$1');
  }

  function sanitizeClonedTree(clone) {
    queryAll(clone, PLUGIN_UI_SELECTOR).forEach(element => element.remove?.());
    queryAll(clone, 'script,style').forEach(element => {
      try { element.textContent = ''; } catch (_) { /* Best effort. */ }
    });
    queryAll(clone, '[src],[href],[poster],[srcset]').forEach(element => {
      ['src', 'href', 'poster', 'srcset'].forEach(attribute => {
        const value = element.getAttribute?.(attribute);
        if (typeof value === 'string' && /(^|\s)data:/i.test(value)) {
          element.setAttribute?.(attribute, 'data:sci-diagnostic-media-omitted');
        }
      });
    });
    return clone;
  }

  function serializeSubtree(element, maxBytes = 2 * 1024 * 1024) {
    let html = '';
    try {
      if (typeof element?.cloneNode === 'function') {
        html = sanitizeClonedTree(element.cloneNode(true))?.outerHTML || '';
      } else {
        html = element?.outerHTML || '';
      }
    } catch (_) {
      html = element?.outerHTML || '';
    }
    const clean = sanitizeHtmlString(html);
    const result = truncateUtf8(clean, maxBytes);
    return { html: result.text, htmlTruncated: result.truncated };
  }

  function collectShadowRoots(documentRef, remainingBytes) {
    const roots = [];
    let budget = Math.max(0, Number(remainingBytes) || 0);
    queryAll(documentRef, '*').forEach(element => {
      if (!element?.shadowRoot || budget <= 0 || roots.length >= 100) return;
      const serialized = truncateUtf8(
        sanitizeHtmlString(element.shadowRoot.innerHTML || ''),
        Math.min(budget, 2 * 1024 * 1024)
      );
      roots.push({
        host: describeElement(element),
        mode: element.shadowRoot.mode || 'open',
        html: serialized.text,
        truncated: serialized.truncated
      });
      budget -= utf8ByteLength(serialized.text);
    });
    return roots;
  }

  function collectSameOriginFrames(documentRef, remainingBytes) {
    const frames = [];
    let budget = Math.max(0, Number(remainingBytes) || 0);
    queryAll(documentRef, 'iframe').forEach((frame, index) => {
      if (budget <= 0 || frames.length >= 40) return;
      try {
        const frameDocument = frame.contentDocument;
        if (!frameDocument?.documentElement) {
          frames.push({ index, src: String(frame.src || ''), available: false });
          return;
        }
        const serialized = truncateUtf8(
          sanitizeHtmlString(frameDocument.documentElement.outerHTML || ''),
          Math.min(budget, 4 * 1024 * 1024)
        );
        frames.push({
          index,
          src: String(frame.src || ''),
          available: true,
          html: serialized.text,
          truncated: serialized.truncated
        });
        budget -= utf8ByteLength(serialized.text);
      } catch (error) {
        frames.push({
          index,
          src: String(frame.src || ''),
          available: false,
          error: serializeDiagnosticError(error)
        });
      }
    });
    return frames;
  }

  function serializeRenderedDom(documentRef, { maxBytes = DEFAULT_MAX_DOM_BYTES } = {}) {
    const boundedMaxBytes = Math.max(64 * 1024, Number(maxBytes) || DEFAULT_MAX_DOM_BYTES);
    let rawHtml = '';
    let cloneError = null;
    try {
      if (typeof documentRef?.documentElement?.cloneNode === 'function') {
        const clone = sanitizeClonedTree(documentRef.documentElement.cloneNode(true));
        rawHtml = clone?.outerHTML || '';
      } else {
        rawHtml = documentRef?.documentElement?.outerHTML || '';
      }
    } catch (error) {
      cloneError = serializeDiagnosticError(error);
      rawHtml = documentRef?.documentElement?.outerHTML || '';
    }
    const cleanHtml = sanitizeHtmlString(rawHtml);
    const doctype = String(documentRef?.doctype?.name || '').toLowerCase() === 'html'
      ? '<!doctype html>\n'
      : '';
    const documentResult = truncateUtf8(`${doctype}${cleanHtml}`, boundedMaxBytes);
    const documentBytes = utf8ByteLength(documentResult.text);
    const remaining = Math.max(0, boundedMaxBytes - documentBytes);
    const shadowRoots = collectShadowRoots(documentRef, remaining);
    const shadowBytes = utf8ByteLength(JSON.stringify(shadowRoots));
    const iframes = collectSameOriginFrames(documentRef, Math.max(0, remaining - shadowBytes));
    return {
      documentHtml: documentResult.text,
      documentHtmlBytes: documentBytes,
      maxBytes: boundedMaxBytes,
      truncated: documentResult.truncated,
      shadowRoots,
      sameOriginIframes: iframes,
      cloneError
    };
  }

  function candidateSummary(element, selectors, htmlBudget) {
    const headings = queryAll(element, HEADING_SELECTOR);
    const paragraphElements = new Set(
      BODY_SELECTORS.flatMap(selector => queryAll(element, selector))
    );
    const allElements = queryAll(element, '*');
    const classedLeafTextBlocks = allElements.filter(item => {
      const tag = String(item?.tagName || '').toUpperCase();
      if (!['DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'DD'].includes(tag)) return false;
      if (queryAll(item, HEADING_SELECTOR).length) return false;
      if (queryAll(item, 'p,[role="paragraph"]').length) return false;
      const length = String(item?.textContent || '').replace(/\s+/g, ' ').trim().length;
      return length >= 40;
    });
    return {
      root: describeElement(element),
      selectors: [...selectors].sort(),
      depth: elementDepth(element),
      descendantElementCount: allElements.length,
      headingElementCount: headings.length,
      paragraphElementCount: paragraphElements.size,
      classedLeafTextBlockCount: classedLeafTextBlocks.length,
      textCharacterCount: String(element?.textContent || '').length,
      headingSamples: headings.slice(0, 32)
        .map(item => normalizeHeading(item.textContent)).filter(Boolean),
      directChildShapes: queryAll(element, ':scope > *').slice(0, 60)
        .map(describeElement),
      ...serializeSubtree(element, htmlBudget)
    };
  }

  function safeSelectAdapter(documentRef) {
    try {
      return typeof shared.selectPublisherAdapter === 'function'
        ? shared.selectPublisherAdapter(documentRef?.location || {})
        : { id: 'generic', family: 'generic', articleRootSelectors: [] };
    } catch (error) {
      return {
        id: 'generic',
        family: 'generic',
        articleRootSelectors: [],
        diagnosticError: serializeDiagnosticError(error)
      };
    }
  }

  function adapterSelectors(adapter) {
    return [...new Set([
      ...(adapter?.specificArticleRootSelectors || []),
      ...(adapter?.articleRootSelectors || []),
      ...ROOT_SELECTORS
    ])].filter(Boolean).slice(0, 100);
  }

  function collectSelectorState(documentRef, adapter) {
    const candidateSelectors = new Map();
    const selectorCoverage = adapterSelectors(adapter).map(selector => {
      const matches = queryAll(documentRef, selector);
      matches.forEach(element => {
        const owned = candidateSelectors.get(element) || new Set();
        owned.add(selector);
        candidateSelectors.set(element, owned);
      });
      return {
        selector,
        count: matches.length,
        samples: matches.slice(0, 8).map(describeElement)
      };
    });
    if (!candidateSelectors.size && documentRef?.body) {
      candidateSelectors.set(documentRef.body, new Set(['document.body']));
    }
    return { selectorCoverage, candidateSelectors };
  }

  function collectCandidateBundles(candidateSelectors, maxBytes) {
    const entries = [...candidateSelectors.entries()].sort((first, second) =>
      String(second[0]?.textContent || '').length - String(first[0]?.textContent || '').length ||
      elementDepth(first[0]) - elementDepth(second[0])
    ).slice(0, 40);
    let remaining = Math.max(64 * 1024, Number(maxBytes) || DEFAULT_MAX_DOM_BYTES);
    return entries.map(([element, matchedSelectors]) => {
      const perCandidate = Math.min(remaining, 4 * 1024 * 1024);
      const summary = candidateSummary(element, matchedSelectors, perCandidate);
      remaining = Math.max(0, remaining - utf8ByteLength(summary.html));
      return summary;
    });
  }

  function serializeAdapter(adapter) {
    const clone = structuredCloneLike(adapter || {});
    return clone && typeof clone === 'object' ? clone : {};
  }

  function buildPageSummary(documentRef) {
    return {
      href: String(documentRef?.location?.href || ''),
      hostname: String(documentRef?.location?.hostname || ''),
      pathname: String(documentRef?.location?.pathname || '').slice(0, 2000),
      search: String(documentRef?.location?.search || '').slice(0, 4000),
      title: normalizeHeading(documentRef?.title || ''),
      readyState: String(documentRef?.readyState || ''),
      contentType: String(documentRef?.contentType || ''),
      characterSet: String(documentRef?.characterSet || '')
    };
  }

  function buildRuntimeSummary(documentRef, options) {
    const view = documentRef?.defaultView || (typeof window !== 'undefined' ? window : null);
    return {
      extensionVersion: String(options?.extensionVersion || ''),
      contentRevision: String(options?.contentRevision || ''),
      userAgent: String(view?.navigator?.userAgent || ''),
      language: String(view?.navigator?.language || ''),
      viewport: {
        width: Number(view?.innerWidth || 0),
        height: Number(view?.innerHeight || 0),
        devicePixelRatio: Number(view?.devicePixelRatio || 0)
      }
    };
  }

  function safeBranch(collector, fallback) {
    try {
      return collector();
    } catch (error) {
      return { ...structuredCloneLike(fallback), error: serializeDiagnosticError(error) };
    }
  }

  function buildAdapterDiagnosticBundle(documentRef, options = {}) {
    const adapter = safeSelectAdapter(documentRef);
    const { selectorCoverage, candidateSelectors } = safeBranch(
      () => collectSelectorState(documentRef, adapter),
      { selectorCoverage: [], candidateSelectors: new Map() }
    );
    const maxDomBytes = Math.max(64 * 1024,
      Number(options.maxDomBytes) || DEFAULT_MAX_DOM_BYTES);
    const outlineSelectors = adapter?.outlineRootSelectors || [];
    const bundle = {
      kind: DIAGNOSTIC_KIND,
      schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      diagnosticVersion: DIAGNOSTIC_VERSION,
      createdAt: new Date().toISOString(),
      runtime: safeBranch(() => buildRuntimeSummary(documentRef, options), {}),
      page: safeBranch(() => buildPageSummary(documentRef), {}),
      adapter: safeBranch(() => serializeAdapter(adapter), {}),
      publisher: {
        adapterId: adapter?.id || 'generic',
        family: adapter?.family || 'generic'
      },
      trace: Array.isArray(options.trace)
        ? structuredCloneLike(options.trace).slice(-MAX_TRACE_RECORDS)
        : [],
      selectorCoverage: Array.isArray(selectorCoverage) ? selectorCoverage : [],
      outlineCoverage: outlineSelectors.slice(0, 60).map(selector => ({
        selector,
        rootCount: queryAll(documentRef, selector).length
      })),
      documentHeadingCount: queryAll(documentRef, HEADING_SELECTOR).length,
      documentParagraphElementCount: new Set(
        BODY_SELECTORS.flatMap(selector => queryAll(documentRef, selector))
      ).size,
      candidates: safeBranch(
        () => collectCandidateBundles(candidateSelectors || new Map(), maxDomBytes),
        []
      ),
      // Export must remain independent from the extractor. It only includes a
      // previously recorded extraction snapshot supplied by the content script.
      extraction: safeBranch(
        () => structuredCloneLike(options.extraction || { available: false }),
        { available: false }
      ),
      structure: safeBranch(() => structuredCloneLike(options.structure || null), null),
      dom: safeBranch(
        () => serializeRenderedDom(documentRef, { maxBytes: maxDomBytes }),
        { documentHtml: '', truncated: false, maxBytes: maxDomBytes }
      )
    };
    return bundle;
  }

  function validateAdapterDiagnosticBundle(value) {
    if (value?.kind !== DIAGNOSTIC_KIND ||
        value?.schemaVersion !== DIAGNOSTIC_SCHEMA_VERSION ||
        typeof value?.dom?.documentHtml !== 'string') {
      throw new Error('Adapter diagnostic bundle is incomplete');
    }
    return value;
  }

  function buildPublisherDiagnostic(documentRef, options = {}) {
    return buildAdapterDiagnosticBundle(documentRef, options);
  }

  function sanitizeFilenamePart(value) {
    return String(value || 'page').toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'page';
  }

  function downloadPublisherDiagnostic(report, documentRef = null) {
    validateAdapterDiagnosticBundle(report);
    if (typeof Blob !== 'function' || typeof URL?.createObjectURL !== 'function') {
      throw new Error('Diagnostic download is unavailable in this page context');
    }
    const hostname = report?.page?.hostname || documentRef?.location?.hostname || 'page';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `sci-adapter-diagnostic-${sanitizeFilenamePart(hostname)}-${stamp}.json`;
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    const href = URL.createObjectURL(blob);
    const anchor = (documentRef || document).createElement('a');
    anchor.href = href;
    anchor.download = filename;
    anchor.hidden = true;
    (documentRef?.body || document.body)?.appendChild(anchor);
    anchor.click();
    anchor.remove?.();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    return filename;
  }

  return {
    DIAGNOSTIC_VERSION,
    DIAGNOSTIC_KIND,
    DIAGNOSTIC_SCHEMA_VERSION,
    DEFAULT_MAX_DOM_BYTES,
    createExtractionTraceRecorder,
    serializeDiagnosticError,
    serializeRenderedDom,
    validateAdapterDiagnosticBundle,
    buildAdapterDiagnosticBundle,
    buildPublisherDiagnostic,
    downloadPublisherDiagnostic
  };
});
