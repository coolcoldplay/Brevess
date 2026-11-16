(function attach(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(runtime) {
  function text(value, maximum = 200000) {
    return String(value || '').normalize('NFKC')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, maximum);
  }

  function hash(value) {
    let state = 2166136261;
    const input = String(value || '');
    for (let index = 0; index < input.length; index += 1) {
      state ^= input.charCodeAt(index);
      state = Math.imul(state, 16777619);
    }
    return (state >>> 0).toString(16).padStart(8, '0');
  }

  function strictSha256(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/^sha256:/, '');
    return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
  }

  function selectorForPage(pageNumber, paragraph = false) {
    const attribute = paragraph
      ? 'data-sci-llm-paragraph-id' : 'data-pdf-page-number';
    const value = paragraph ? `pdf-page-${pageNumber}` : String(pageNumber);
    return `[${attribute}="${value}"]`;
  }

  function canonicalPdfPageToNativePage(record = {}) {
    const pageNumber = Math.floor(Number(record.pageNumber));
    const rawText = typeof record.text === 'string' ? record.text : '';
    const binding = record.binding || {};
    const documentHash = strictSha256(binding.documentHash);
    const documentGeneration = Math.floor(Number(binding.documentGeneration));
    const revision = Math.floor(Number(binding.revision));
    const expectedCanonicalPrefix = `pdf-canonical:${documentHash}:${documentGeneration}:` +
      `${revision}:${pageNumber}:`;
    if (record.recordType !== 'pdf-canonical-page' || pageNumber < 1 ||
        !/^pdf-page-\d+$/u.test(String(record.legacyParagraphId || '')) ||
        record.legacyParagraphId !== `pdf-page-${pageNumber}` ||
        !documentHash || documentGeneration < 1 || revision < 1 ||
        !String(record.canonicalPageId || '').startsWith(expectedCanonicalPrefix) ||
        String(record.canonicalPageId || '') !== `${expectedCanonicalPrefix}${record.pageHash}` ||
        !Array.isArray(record.spans)) {
      throw pdfSelectionError('INVALID_PDF_CANONICAL_PAGE');
    }
    return Object.freeze({
      pageNumber,
      text: rawText,
      charCount: rawText.length,
      textHash: text(record.contentHash, 100) || hash(rawText),
      textStatus: record.coverage?.textStatus === 'empty' ? 'empty' : 'full',
      paragraphId: record.legacyParagraphId,
      sourceIdentity: `pdf:${pageNumber}`,
      documentHash,
      documentGeneration,
      revision,
      canonicalPageId: text(record.canonicalPageId, 300),
      canonicalCoverage: record.coverage,
      canonicalPage: record
    });
  }

  function normalizeOutline(items, parentSectionId = '', depth = 0, state = { order: 0 }, parentPath = []) {
    return (Array.isArray(items) ? items : []).slice(0, 800).map((item, index) => {
      const pageNumber = Number.isSafeInteger(item?.pageNumber) && item.pageNumber > 0 ? item.pageNumber : null;
      const title = text(item?.title, 500) || (pageNumber ? `Page ${pageNumber}` : 'Unresolved bookmark');
      const sectionId = `pdf-section-${hash([
        parentSectionId, title, pageNumber, index
      ].join('\u0000'))}`;
      const node = {
        outlinePath: [...parentPath, index],
        sectionId,
        sourceKey: sectionId,
        parentSectionId,
        title,
        displayTitle: title,
        level: depth + 1,
        order: state.order++,
        pageNumber,
        // Native page text is the PDF's main body until finer section evidence
        // exists. Use the same selectable kind as the HTML analysis pipeline.
        sectionKind: 'main',
        paragraphIds: [],
        anchor: {
          dataSelector: pageNumber ? selectorForPage(pageNumber) : '',
          pageNumber,
          ...(typeof item?.targetTop === 'number' && Number.isFinite(item.targetTop)
            ? { targetTop: item.targetTop, destinationKind: String(item.destinationKind || '') } : {})
        },
        children: []
      };
      node.children = normalizeOutline(item?.items, sectionId, depth + 1, state, node.outlinePath);
      return node;
    });
  }

  function flatten(nodes, output = []) {
    (Array.isArray(nodes) ? nodes : []).forEach(node => {
      output.push(node);
      flatten(node.children, output);
    });
    return output;
  }

  function createNativePdfArticleStructure(input = {}) {
    const title = text(input.title, 1000) || 'PDF document';
    const url = text(input.url, 4000);
    const nodes = normalizeOutline(input.outline);
    const outlineHash = strictSha256(input.documentHash);
    if (outlineHash) {
      const bind = values => { for (const node of values) {
        node.anchor.documentHash = outlineHash;
        bind(node.children);
      } };
      bind(nodes);
    }
    const flatNodes = flatten(nodes).sort((left, right) =>
      left.pageNumber - right.pageNumber || left.level - right.level || left.order - right.order
    );
    const indexedPages = (Array.isArray(input.pages) ? input.pages : []).slice(0, 100000)
      .map((page, index) => {
        const pageText = text(page?.text);
        const explicitStatus = ['full', 'empty', 'failed', 'evicted', 'deferred', 'on-demand']
          .includes(page?.textStatus) ? page.textStatus : '';
        return {
        pageNumber: Math.max(1, Math.floor(Number(page?.pageNumber) || index + 1)),
        text: pageText,
        charCount: Math.max(0, Math.floor(Number(page?.charCount) || String(page?.text || '').length)),
        textHash: text(page?.textHash, 100) || hash(page?.text),
        textStatus: explicitStatus || (pageText ? 'full' : 'deferred'),
        hasVisualContent: typeof page?.hasVisualContent === 'boolean'
          ? page.hasVisualContent : undefined,
        ocrCandidate: typeof page?.ocrCandidate === 'boolean' ? page.ocrCandidate : undefined,
        errorCode: page?.textStatus === 'failed'
          ? text(page?.errorCode, 100) || 'PDF_TEXT_EXTRACTION_FAILED' : undefined
        };
      });
    const pages = indexedPages.map(page => Object.freeze({
      pageNumber: page.pageNumber,
      charCount: page.charCount,
      textHash: page.textHash,
      textStatus: page.textStatus,
      ...(typeof page.hasVisualContent === 'boolean'
        ? { hasVisualContent: page.hasVisualContent } : {}),
      ...(typeof page.ocrCandidate === 'boolean' ? { ocrCandidate: page.ocrCandidate } : {}),
      ...(page.errorCode ? { errorCode: page.errorCode } : {})
    }));
    const paragraphs = indexedPages.filter(page => page.textStatus === 'full' && page.text)
      .map((page, order) => {
      const candidates = flatNodes.filter(node => node.pageNumber !== null && node.pageNumber <= page.pageNumber);
      const section = candidates.sort((left, right) =>
        right.pageNumber - left.pageNumber || right.level - left.level || right.order - left.order
      )[0] || null;
      const paragraphId = `pdf-page-${page.pageNumber}`;
      section?.paragraphIds?.push(paragraphId);
      const headingPath = [];
      if (section) {
        let current = section;
        while (current) {
          headingPath.unshift({
            level: current.level,
            sectionId: current.sectionId,
            title: current.title,
            displayTitle: current.displayTitle
          });
          current = current.parentSectionId
            ? flatNodes.find(node => node.sectionId === current.parentSectionId) : null;
        }
      }
      return {
        paragraphId,
        sourceKey: paragraphId,
        sourceIdentity: `pdf:${page.pageNumber}`,
        textHash: hash(page.text),
        recordType: 'body',
        sectionId: section?.sectionId || 'pdf-document',
        sectionTitle: section?.title || title,
        displaySectionTitle: section?.displayTitle || title,
        sectionKind: 'main',
        headingLevel: section?.level || 1,
        headingPath,
        kind: 'pdf-page-text',
        text: page.text,
        displayText: page.text,
        order,
        pageNumber: page.pageNumber,
        anchor: {
          paragraphId,
          sourceKey: paragraphId,
          dataSelector: selectorForPage(page.pageNumber, true),
          pageNumber: page.pageNumber
        }
      };
      });
    const expectedPageCount = Math.max(pages.length, Math.min(100000,
      Math.floor(Number(input.pageCount) || 0)));
    const retainedPages = pages.filter(page => page.textStatus === 'full').length;
    const evictedPages = pages.filter(page => page.textStatus === 'evicted').length;
    const deferredPages = pages.filter(page => page.textStatus === 'deferred').length;
    const onDemandPages = pages.filter(page => page.textStatus === 'on-demand').length;
    const textPages = pages.filter(page => page.charCount > 0 &&
      ['full', 'evicted', 'on-demand'].includes(page.textStatus)).length;
    const emptyPages = pages.filter(page => page.textStatus === 'empty').length;
    const failedPages = pages.filter(page => page.textStatus === 'failed').length;
    const checkedPages = new Set(pages.filter(page => page.textStatus !== 'deferred')
      .map(page => page.pageNumber)).size;
    const pendingPages = Math.max(0, expectedPageCount - checkedPages);
    const textCoverage = Object.freeze({
      totalPages: expectedPageCount,
      checkedPages,
      textPages,
      emptyPages,
      failedPages,
      retainedPages,
      evictedPages,
      deferredPages,
      onDemandPages,
      pendingPages,
      complete: expectedPageCount > 0 && pendingPages === 0 && deferredPages === 0 &&
        failedPages === 0 && emptyPages === 0 && textPages === expectedPageCount,
      checkedComplete: expectedPageCount > 0 && pendingPages === 0,
      terminal: expectedPageCount > 0 && pendingPages === 0
    });
    const signature = hash(JSON.stringify({
      title, url,
      nodes: flatNodes.map(node => [node.sectionId, node.title, node.pageNumber]),
      pages: pages.map(page => [page.pageNumber, page.textHash, page.textStatus])
    }));
    const stableIdentity = strictSha256(input.documentIdentity);
    const stableDocumentHash = strictSha256(input.documentHash);
    const documentIdentity = stableIdentity || text(input.documentIdentity, 200) || signature;
    return {
      version: '1.0.0-pdf-native',
      adapterId: 'pdf-native',
      publisherFamily: 'pdf-workspace',
      strategy: 'pdf-outline-text-layer',
      revision: 1,
      title,
      documentId: stableIdentity ? `sha256:${stableIdentity}` : `pdf-${documentIdentity}`,
      documentHash: stableDocumentHash || signature,
      url,
      nodes,
      pages,
      paragraphs,
      typedRecords: paragraphs,
      diagnostics: {
        outlineEntryCount: flatNodes.length,
        matchedOutlineEntryCount: flatNodes.length,
        headingCount: flatNodes.length,
        paragraphCount: paragraphs.length,
        bodyParagraphCount: paragraphs.length,
        recordCount: paragraphs.length,
        characterCount: paragraphs.reduce((sum, item) => sum + item.text.length, 0),
        textCoverage,
        nativePdf: true,
        mineruUsed: false,
        warnings: []
      }
    };
  }

  function createNativePdfIncrementalDocument(input = {}) {
    const base = input && typeof input === 'object' ? input : {};
    const pages = new Map();
    const maxTextCharacters = Math.max(1, Math.min(20_000_000,
      Math.floor(Number(base.maxTextCharacters) || 4_000_000)));
    let characters = 0;
    let snapshotPageVisits = 0;
    let clock = 0;
    const stableIdentity = strictSha256(base.documentIdentity);
    const stableDocumentHash = strictSha256(base.documentHash);
    const identitySeed = stableIdentity || hash(JSON.stringify({
      title: text(base.title, 1000),
      url: text(base.url, 4000),
      outline: normalizeOutline(base.outline).map(node => [node.sectionId, node.pageNumber])
    }));
    const expectedPageCount = Math.max(0, Math.min(100000,
      Math.floor(Number(base.pageCount) || 0)));

    function snapshot(phase = 'indexing') {
      snapshotPageVisits += pages.size;
      const structure = createNativePdfArticleStructure({
        ...base,
        documentIdentity: identitySeed,
        ...(stableDocumentHash ? { documentHash: stableDocumentHash } : {}),
        pages: Array.from(pages.values()).sort((left, right) =>
          left.pageNumber - right.pageNumber
        )
      });
      const requestedPhase = text(phase, 40) || 'indexing';
      const actualPhase = ['text-ready', 'partial-index'].includes(requestedPhase)
        ? (structure.diagnostics.textCoverage.terminal &&
            structure.diagnostics.textCoverage.failedPages === 0 &&
            structure.diagnostics.textCoverage.deferredPages === 0 &&
            structure.diagnostics.textCoverage.textPages > 0
          ? 'text-ready' : 'partial-index')
        : requestedPhase;
      return Object.freeze({ phase: actualPhase, structure });
    }

    function normalizedPage(page) {
      const pageNumber = Math.max(1, Math.floor(Number(page?.pageNumber) || 1));
      const normalized = text(page?.text, 50000);
      return {
        pageNumber,
        normalized,
        charCount: normalized.length,
        textHash: hash(normalized),
        textStatus: ['full', 'empty', 'failed', 'evicted', 'deferred', 'on-demand']
          .includes(page?.textStatus) ? page.textStatus : (normalized ? 'full' : 'empty'),
        hasVisualContent: typeof page?.hasVisualContent === 'boolean'
          ? page.hasVisualContent : undefined,
        ocrCandidate: typeof page?.ocrCandidate === 'boolean' ? page.ocrCandidate : undefined,
        errorCode: page?.textStatus === 'failed'
          ? text(page?.errorCode, 100) || 'PDF_TEXT_EXTRACTION_FAILED' : undefined
      };
    }

    function defer(entry, status = 'evicted') {
      if (entry.textStatus === 'full') characters -= entry.text.length;
      entry.text = '';
      entry.textStatus = status;
      entry.pinned = false;
    }

    function add(page) {
      const next = normalizedPage(page);
      const previous = pages.get(next.pageNumber);
      if (previous?.textStatus === 'full') characters -= previous.text.length;
      const retainText = next.textStatus === 'full' && next.normalized.length > 0;
      const fits = !retainText || characters + next.normalized.length <= maxTextCharacters;
      const textStatus = next.textStatus === 'full' && !fits ? 'evicted' : next.textStatus;
      pages.set(next.pageNumber, {
        pageNumber: next.pageNumber,
        text: retainText && fits ? next.normalized : '',
        charCount: next.charCount,
        textHash: next.textHash,
        textStatus,
        hasVisualContent: next.hasVisualContent,
        ocrCandidate: next.ocrCandidate,
        errorCode: next.errorCode,
        pinned: false,
        touched: ++clock
      });
      if (textStatus === 'full') characters += next.normalized.length;
      return pages.size;
    }

    function hydrate(page) {
      const next = normalizedPage(page);
      if (!next.normalized) {
        add({
          ...page,
          pageNumber: next.pageNumber,
          text: '',
          textStatus: next.textStatus === 'failed' ? 'failed' : 'empty'
        });
        return { hydrated: false, evictedPages: [] };
      }
      let entry = pages.get(next.pageNumber);
      if (!entry) {
        add({ pageNumber: next.pageNumber, text: '' });
        entry = pages.get(next.pageNumber);
      }
      pages.forEach(item => { item.pinned = false; });
      if (entry.textStatus === 'full') characters -= entry.text.length;
      entry.text = '';
      entry.charCount = next.charCount;
      entry.textHash = next.textHash;
      entry.textStatus = 'on-demand';
      entry.touched = ++clock;
      const evictedPages = [];
      while (characters + next.normalized.length > maxTextCharacters) {
        const candidate = Array.from(pages.values())
          .filter(item => item.pageNumber !== next.pageNumber &&
            item.textStatus === 'full' && !item.pinned)
          .sort((left, right) => left.touched - right.touched)[0];
        if (!candidate) break;
        defer(candidate);
        evictedPages.push(candidate.pageNumber);
      }
      if (characters + next.normalized.length > maxTextCharacters) {
        return { hydrated: false, evictedPages };
      }
      entry.text = next.normalized;
      entry.textStatus = 'full';
      entry.pinned = true;
      characters += next.normalized.length;
      return { hydrated: true, evictedPages };
    }

    return Object.freeze({
      add,
      hydrate,
      replace: hydrate,
      merge(page, phase = 'indexing') {
        add(page);
        return snapshot(phase);
      },
      snapshot,
      size() { return pages.size; },
      pageStatus(pageNumber) {
        return pages.get(Math.max(1, Math.floor(Number(pageNumber) || 1)))?.textStatus || 'missing';
      },
      stats() {
        const values = Array.from(pages.values());
        const retainedPages = values.filter(page => page.textStatus === 'full' && page.text).length;
        const evictedPages = values.filter(page => page.textStatus === 'evicted').length;
        const deferredPages = values.filter(page => page.textStatus === 'deferred').length;
        const onDemandPages = values.filter(page => page.textStatus === 'on-demand').length;
        const textPages = values.filter(page => page.charCount > 0 &&
          ['full', 'evicted', 'on-demand'].includes(page.textStatus)).length;
        const emptyPages = values.filter(page => page.textStatus === 'empty').length;
        const failedPages = values.filter(page => page.textStatus === 'failed').length;
        const totalPages = Math.max(expectedPageCount, pages.size);
        const checkedPages = values.filter(page => page.textStatus !== 'deferred').length;
        const pendingPages = totalPages - checkedPages;
        return {
          characters,
          totalPages,
          checkedPages,
          textPages,
          emptyPages,
          failedPages,
          retainedPages,
          evictedPages,
          deferredPages,
          onDemandPages,
          pendingPages,
          droppedPages: evictedPages + deferredPages + onDemandPages,
          complete: totalPages > 0 && pendingPages === 0 && deferredPages === 0 &&
            failedPages === 0 && emptyPages === 0 && textPages === totalPages,
          checkedComplete: totalPages > 0 && pendingPages === 0,
          terminal: totalPages > 0 && pendingPages === 0,
          maxTextCharacters,
          snapshotPageVisits
        };
      },
      clear() {
        pages.clear();
        characters = 0;
        snapshotPageVisits = 0;
      }
    });
  }

  function shouldPublishNativePdfCheckpoint(completed) {
    const count = Math.max(0, Math.floor(Number(completed) || 0));
    return count > 0 && (count & (count - 1)) === 0;
  }

  function pdfSelectionError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function normalizePdfSelectionPageAnchor(value, pageNumber) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const normalizedPage = Math.max(0, Math.floor(Number(value.pageNumber) || 0));
    const paragraphId = text(value.paragraphId, 120);
    if (!normalizedPage || normalizedPage !== pageNumber ||
        paragraphId !== `pdf-page-${normalizedPage}`) return null;
    return Object.freeze({ paragraphId, pageNumber: normalizedPage });
  }

  function normalizePdfSelectionSegment(selection = {}, inherited = {}) {
    const pageNumber = Math.max(0, Math.floor(Number(selection.pageNumber) || 0));
    const selectedText = text(selection.text || selection.quote, 12000);
    const documentHash = text(selection.documentHash || inherited.documentHash, 160);
    const documentGeneration = Math.max(0, Math.floor(Number(
      selection.documentGeneration || inherited.documentGeneration
    ) || 0));
    const selectionGeneration = Math.max(0, Math.floor(Number(
      selection.selectionGeneration || inherited.selectionGeneration
    ) || 0));
    const contextHash = text(selection.contextHash, 160);
    if (!pageNumber || !selectedText || !documentHash || !documentGeneration ||
        !selectionGeneration || !contextHash) {
      throw pdfSelectionError('INVALID_PDF_SELECTION');
    }
    const semanticLocator = selection.semanticLocator == null ? null :
      runtime.SciLLM?.normalizePdfSemanticEvidenceLocator?.(selection.semanticLocator);
    const requestedParagraphId = text(selection.paragraphId, 512);
    const pageAnchor = semanticLocator
      ? normalizePdfSelectionPageAnchor(selection.pageAnchor, pageNumber) : null;
    if (selection.semanticLocator != null && (!semanticLocator || !pageAnchor ||
        requestedParagraphId !== semanticLocator.paragraphId ||
        selectedText !== semanticLocator.expectedNormalizedQuote ||
        semanticLocator.documentHash.replace(/^sha256:/i, '') !==
          documentHash.replace(/^sha256:/i, '') ||
        semanticLocator.documentGeneration !== documentGeneration)) {
      throw pdfSelectionError('INVALID_PDF_SELECTION');
    }
    return Object.freeze({
      text: selectedText,
      pageNumber,
      paragraphId: semanticLocator ? semanticLocator.paragraphId : `pdf-page-${pageNumber}`,
      contextHash,
      documentHash,
      documentGeneration,
      selectionGeneration,
      ...(semanticLocator ? { semanticLocator, pageAnchor } : {}),
      ...(text(selection.paragraphTextHash, 160)
        ? { paragraphTextHash: text(selection.paragraphTextHash, 160) } : {})
    });
  }

  function normalizePdfSelectionEvidence(selection = {}) {
    const rawSegments = Array.isArray(selection?.segments) ? selection.segments : null;
    if (!rawSegments) return normalizePdfSelectionSegment(selection);
    if (!rawSegments.length || rawSegments.length > 64) {
      throw pdfSelectionError('INVALID_PDF_SELECTION');
    }
    const inherited = {
      documentHash: text(selection.documentHash, 160),
      documentGeneration: Math.max(0,
        Math.floor(Number(selection.documentGeneration) || 0)),
      selectionGeneration: Math.max(0,
        Math.floor(Number(selection.selectionGeneration) || 0))
    };
    const segments = rawSegments.map(item =>
      normalizePdfSelectionSegment(item, inherited));
    const first = segments[0];
    if (!segments.every(item => item.documentHash === first.documentHash &&
        item.documentGeneration === first.documentGeneration &&
        item.selectionGeneration === first.selectionGeneration)) {
      throw pdfSelectionError('INVALID_PDF_SELECTION');
    }
    if ((inherited.documentHash && inherited.documentHash !== first.documentHash) ||
        (inherited.documentGeneration &&
          inherited.documentGeneration !== first.documentGeneration) ||
        (inherited.selectionGeneration &&
          inherited.selectionGeneration !== first.selectionGeneration)) {
      throw pdfSelectionError('INVALID_PDF_SELECTION');
    }
    const selectedText = segments.map(item => item.text).join('\n');
    if (!selectedText || selectedText.length > 12000) {
      throw pdfSelectionError('INVALID_PDF_SELECTION');
    }
    return Object.freeze({
      text: selectedText,
      pageNumber: first.pageNumber,
      paragraphId: first.paragraphId,
      contextHash: first.contextHash,
      documentHash: first.documentHash,
      documentGeneration: first.documentGeneration,
      selectionGeneration: first.selectionGeneration,
      segments: Object.freeze(segments)
    });
  }

  function serializePdfSelectionEvidence(selection = {}, expectedDocumentHash = '') {
    const evidence = normalizePdfSelectionEvidence(selection);
    const expectedHash = text(expectedDocumentHash, 160).replace(/^sha256:/i, '');
    const evidenceHash = evidence.documentHash.replace(/^sha256:/i, '');
    if (!expectedHash || expectedHash !== evidenceHash) {
      throw pdfSelectionError('STALE_PDF_SELECTION');
    }
    // The normalizer is the persistence allow-list. Copy its result so no
    // caller-owned or unknown fields can leak into a workspace record.
    if (!Array.isArray(evidence.segments)) return {
      ...evidence,
      ...(evidence.semanticLocator ? { semanticLocator: { ...evidence.semanticLocator } } : {}),
      ...(evidence.pageAnchor ? { pageAnchor: { ...evidence.pageAnchor } } : {})
    };
    return {
      text: evidence.text,
      pageNumber: evidence.pageNumber,
      paragraphId: evidence.paragraphId,
      contextHash: evidence.contextHash,
      documentHash: evidence.documentHash,
      documentGeneration: evidence.documentGeneration,
      selectionGeneration: evidence.selectionGeneration,
      segments: evidence.segments.map(segment => ({
        ...segment,
        ...(segment.semanticLocator ? { semanticLocator: { ...segment.semanticLocator } } : {}),
        ...(segment.pageAnchor ? { pageAnchor: { ...segment.pageAnchor } } : {})
      }))
    };
  }

  function isNativePdfSelectionReplyCurrent(input = {}) {
    const expected = input.expected || {};
    const current = input.current || {};
    return Boolean(expected.documentHash &&
      String(expected.documentHash).replace(/^sha256:/i, '') ===
        String(current.documentHash || '').replace(/^sha256:/i, '') &&
      Math.max(0, Number(expected.selectionGeneration) || 0) ===
        Math.max(0, Number(current.selectionGeneration) || 0));
  }

  function createNativePdfSelectionTurnGuard(input = {}) {
    const expectedSelection = input.expectedSelection || {};
    const getCurrentSelection = typeof input.getCurrentSelection === 'function'
      ? input.getCurrentSelection : () => ({});
    const isOperationCurrent = typeof input.isOperationCurrent === 'function'
      ? input.isOperationCurrent : () => true;
    const assertCurrent = () => {
      if (!isOperationCurrent() || !isNativePdfSelectionReplyCurrent({
        expected: expectedSelection,
        current: getCurrentSelection()
      })) {
        const error = pdfSelectionError('STALE_PDF_SELECTION');
        error.code = 'CANCELLED';
        throw error;
      }
    };
    return Object.freeze({
      assertCurrent,
      async run(request) {
        if (typeof request !== 'function') throw new TypeError('request is required');
        assertCurrent();
        const response = await request();
        assertCurrent();
        return response;
      }
    });
  }

  function sanitizeArticleChatDocumentUrl(value, documentHash) {
    const candidate = text(value, 2000);
    if (!candidate) return '';
    if (/^(?:file|blob|filesystem|data|chrome|chrome-extension|moz-extension):/iu
      .test(candidate)) {
      const safeHash = text(documentHash, 160).replace(/[^a-z0-9._~-]/giu, '-');
      return safeHash ? `local-pdf://${safeHash}` : '';
    }
    if (/^https?:/iu.test(candidate)) {
      try {
        const parsed = new URL(candidate);
        return `${parsed.origin}${parsed.pathname}`.slice(0, 2000);
      } catch {
        return '';
      }
    }
    return candidate;
  }

  async function prepareNativePdfSelectionEvidence(input = {}) {
    const evidence = normalizePdfSelectionEvidence(input.selection);
    if (typeof input.ensurePageIndexed !== 'function' ||
        typeof input.getNativeDocument !== 'function') {
      throw pdfSelectionError('PDF_SELECTION_INDEX_UNAVAILABLE');
    }
    const segments = Array.isArray(evidence.segments)
      ? evidence.segments : [evidence];
    const pages = [...new Set(segments.map(item => item.pageNumber))];
    for (const pageNumber of pages) {
      await input.ensurePageIndexed(pageNumber, {
        documentHash: evidence.documentHash,
        documentGeneration: evidence.documentGeneration
      });
    }
    const snapshot = input.getNativeDocument();
    const currentDocumentHash = String(
      snapshot?.structure?.documentHash || ''
    ).replace(/^sha256:/i, '');
    if (currentDocumentHash !== evidence.documentHash.replace(/^sha256:/i, '') ||
        Math.max(0, Number(snapshot?.documentGeneration) || 0) !==
          evidence.documentGeneration) {
      throw pdfSelectionError('STALE_PDF_SELECTION');
    }
    const paragraphs = Array.isArray(snapshot?.structure?.paragraphs)
      ? snapshot.structure.paragraphs : [];
    const verifiedSegments = segments.map(segment => {
      const paragraph = paragraphs.find(item =>
        String(item?.paragraphId || '') === segment.paragraphId && item?.text);
      const pageText = text(paragraph?.text);
      if (!paragraph || !pageText.includes(segment.text)) {
        throw pdfSelectionError('PDF_SELECTION_EVIDENCE_UNAVAILABLE');
      }
      return Object.freeze({
        ...segment,
        paragraphTextHash: text(paragraph.textHash, 160) || hash(pageText)
      });
    });
    if (!Array.isArray(evidence.segments)) return evidence;
    const first = verifiedSegments[0];
    return Object.freeze({
      ...evidence,
      pageNumber: first.pageNumber,
      paragraphId: first.paragraphId,
      contextHash: first.contextHash,
      segments: Object.freeze(verifiedSegments)
    });
  }

  async function rebindNativePdfSelectionEvidence(input = {}) {
    const previous = normalizePdfSelectionEvidence(input.selection);
    if (typeof input.ensurePageIndexed !== 'function' ||
        typeof input.getNativeDocument !== 'function') {
      throw pdfSelectionError('PDF_SELECTION_INDEX_UNAVAILABLE');
    }
    const initialSnapshot = input.getNativeDocument();
    const documentHash = String(
      initialSnapshot?.structure?.documentHash || ''
    ).replace(/^sha256:/i, '');
    const documentGeneration = Math.max(0, Math.floor(Number(
      initialSnapshot?.documentGeneration
    ) || 0));
    const selectionGeneration = Math.max(0, Math.floor(Number(
      input.selectionGeneration
    ) || 0));
    if (!documentHash || !documentGeneration || !selectionGeneration ||
        documentHash !== previous.documentHash.replace(/^sha256:/i, '')) {
      throw pdfSelectionError('STALE_PDF_SELECTION');
    }
    const previousSegments = Array.isArray(previous.segments)
      ? previous.segments : [previous];
    const pages = [...new Set(previousSegments.map(item => item.pageNumber))];
    for (const pageNumber of pages) {
      await input.ensurePageIndexed(pageNumber, {
        documentHash: previous.documentHash,
        documentGeneration
      });
    }
    const snapshot = input.getNativeDocument();
    if (String(snapshot?.structure?.documentHash || '').replace(/^sha256:/i, '') !==
          documentHash ||
        Math.max(0, Math.floor(Number(snapshot?.documentGeneration) || 0)) !==
          documentGeneration) {
      throw pdfSelectionError('STALE_PDF_SELECTION');
    }
    const paragraphs = Array.isArray(snapshot?.structure?.paragraphs)
      ? snapshot.structure.paragraphs : [];
    let semanticContextValue = input.semanticContext;
    if (typeof input.getSemanticContext === 'function') {
      try {
        semanticContextValue = input.getSemanticContext();
      } catch (_) {
        throw pdfSelectionError('PDF_SELECTION_SEMANTIC_UNAVAILABLE');
      }
    }
    const semanticContext = semanticContextValue &&
      typeof runtime.SciLLM?.migratePdfArticleChatEvidence === 'function'
      ? semanticContextValue : null;
    const reboundSegments = previousSegments.map(segment => {
      if (segment.semanticLocator) {
        if (!semanticContext) {
          throw pdfSelectionError('PDF_SELECTION_SEMANTIC_UNAVAILABLE');
        }
        const migrated = runtime.SciLLM.migratePdfArticleChatEvidence({
          locator: segment.semanticLocator,
          pageAnchor: segment.pageAnchor
        }, semanticContext);
        if (migrated?.status !== 'verified' || !migrated.locator ||
            migrated.precision !== 'normalized-exact') {
          throw pdfSelectionError(migrated?.status === 'stale'
            ? 'STALE_PDF_SELECTION' : 'PDF_SELECTION_EVIDENCE_UNAVAILABLE');
        }
        const semanticParagraph = (Array.isArray(semanticContext.paragraphs)
          ? semanticContext.paragraphs : []).find(item =>
          String(item?.paragraphId || '') === migrated.locator.paragraphId);
        const semanticPages = semanticParagraph && [
          Number(semanticParagraph.pageNumber),
          ...(Array.isArray(semanticParagraph.legacyParagraphIds)
            ? semanticParagraph.legacyParagraphIds.map(value =>
              Number(/^pdf-page-(\d+)$/u.exec(String(value || ''))?.[1]) || 0)
            : [])
        ];
        if (!semanticParagraph || !semanticPages.includes(segment.pageNumber)) {
          throw pdfSelectionError('PDF_SELECTION_EVIDENCE_UNAVAILABLE');
        }
        return {
          text: migrated.locator.expectedNormalizedQuote,
          pageNumber: segment.pageNumber,
          paragraphId: migrated.locator.paragraphId,
          contextHash: segment.contextHash,
          documentHash: previous.documentHash,
          documentGeneration,
          selectionGeneration,
          paragraphTextHash: text(semanticParagraph.textHash, 160) ||
            hash(String(semanticParagraph.normalizedText || semanticParagraph.text || '')),
          semanticLocator: migrated.locator,
          pageAnchor: segment.pageAnchor
        };
      }
      const paragraph = paragraphs.find(item =>
        String(item?.paragraphId || '') === segment.paragraphId && item?.text);
      const pageText = text(paragraph?.text);
      const paragraphTextHash = text(paragraph?.textHash, 160) || hash(pageText);
      if (!paragraph || !pageText.includes(segment.text) ||
          (segment.paragraphTextHash &&
            segment.paragraphTextHash !== paragraphTextHash)) {
        throw pdfSelectionError('PDF_SELECTION_EVIDENCE_UNAVAILABLE');
      }
      return {
        text: segment.text,
        pageNumber: segment.pageNumber,
        contextHash: segment.contextHash,
        documentHash: previous.documentHash,
        documentGeneration,
        selectionGeneration,
        paragraphTextHash
      };
    });
    const rebound = Array.isArray(previous.segments) ? {
      documentHash: previous.documentHash,
      documentGeneration,
      selectionGeneration,
      segments: reboundSegments
    } : reboundSegments[0];
    return normalizePdfSelectionEvidence(rebound);
  }

  return {
    createNativePdfArticleStructure,
    createNativePdfIncrementalDocument,
    canonicalPdfPageToNativePage,
    shouldPublishNativePdfCheckpoint,
    normalizePdfSelectionEvidence,
    serializePdfSelectionEvidence,
    prepareNativePdfSelectionEvidence,
    rebindNativePdfSelectionEvidence,
    isNativePdfSelectionReplyCurrent,
    createNativePdfSelectionTurnGuard,
    sanitizeArticleChatDocumentUrl
  };
});
