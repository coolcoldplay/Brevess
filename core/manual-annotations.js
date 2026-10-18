(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const MAX_NOTE_LENGTH = 4000;
  const WARNING_ANNOTATIONS_PER_DOCUMENT = 1000;
  const MAX_ANNOTATIONS_PER_DOCUMENT = 2000;
  const DOCUMENT_TEXT_FINGERPRINT_LENGTH = 8000;
  const STUDY_TYPE_IDS = new Set([
    'basic_mechanistic', 'preclinical_translational', 'observational',
    'clinical_trial', 'diagnostic_prognostic', 'omics_high_throughput',
    'narrative_review', 'systematic_review_meta', 'methods_resource'
  ]);

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
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
      Object.entries(value).map(([key, item]) => [key, cloneJsonLike(item)])
    );
  }

  function unicodeText(value) {
    return String(value ?? '').normalize('NFKC');
  }

  function rawText(value) {
    return String(value ?? '');
  }

  function normalizeWhitespace(value) {
    return unicodeText(value).replace(/\s+/gu, ' ').trim();
  }

  function normalizeCanonicalUrl(value) {
    const raw = unicodeText(value).trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (!/^https?:$/.test(parsed.protocol)) return '';
      parsed.username = '';
      parsed.password = '';
      parsed.hash = '';
      parsed.search = '';
      const pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
      return `${parsed.origin}${pathname === '/' ? '' : pathname}`;
    } catch (_) {
      return raw.split(/[?#]/u, 1)[0].replace(/\/+$/, '');
    }
  }

  function normalizeDoi(value, canonicalUrl) {
    let doi = unicodeText(value).trim();
    if (!doi) {
      try {
        const parsed = new URL(unicodeText(canonicalUrl).trim());
        if (/^(?:dx\.)?doi\.org$/i.test(parsed.hostname)) {
          doi = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
        }
      } catch (_) {}
    }
    return doi
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '')
      .replace(/^doi\s*:\s*/iu, '')
      .split(/[?#]/u, 1)[0]
      .trim()
      .toLocaleLowerCase('en-US');
  }

  function bytesToHex(bytes) {
    return [...new Uint8Array(bytes)]
      .map(value => value.toString(16).padStart(2, '0'))
      .join('');
  }

  async function digestHex(value) {
    if (typeof shared.sha256Hex === 'function') {
      const digest = await shared.sha256Hex(value);
      const normalized = String(digest || '').replace(/^sha256:/i, '').toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(normalized)) fail('INVALID_SHA256_DIGEST');
      return normalized;
    }
    let subtle = globalThis.crypto?.subtle;
    if (!subtle && typeof require === 'function') {
      subtle = require('node:crypto').webcrypto.subtle;
    }
    if (!subtle) fail('SHA256_UNAVAILABLE');
    const encoded = new TextEncoder().encode(value);
    return bytesToHex(await subtle.digest('SHA-256', encoded));
  }

  async function createDocumentId(input = {}) {
    const paragraphs = Array.isArray(input.paragraphs) ? input.paragraphs : [];
    const normalizedBody = normalizeWhitespace(
      paragraphs.map(paragraph => paragraph?.text || '').join(' ')
    ).slice(0, DOCUMENT_TEXT_FINGERPRINT_LENGTH);
    const identity = JSON.stringify({
      title: normalizeWhitespace(input.title).toLocaleLowerCase('en-US'),
      canonicalUrl: normalizeCanonicalUrl(input.canonicalUrl || input.url),
      doi: normalizeDoi(input.doi, input.canonicalUrl || input.url),
      paragraphText: normalizedBody
    });
    return `sha256:${await digestHex(identity)}`;
  }

  function makeCategorySnapshot(category) {
    if (!isPlainObject(category)) fail('INVALID_CATEGORY_SNAPSHOT');
    const name = normalizeWhitespace(category.name);
    const color = unicodeText(category.color).trim().toUpperCase();
    if (!name || name.length > 200 || !/^#[A-F0-9]{6}$/.test(color)) {
      fail('INVALID_CATEGORY_SNAPSHOT');
    }
    return { name, color };
  }

  function normalizeIdentifier(value, pattern, maxLength, code) {
    const normalized = unicodeText(value).trim();
    if (!normalized || normalized.length > maxLength || !pattern.test(normalized)) fail(code);
    return normalized;
  }

  function normalizeTimestamp(value, code) {
    if (value === undefined || value === null || value === '') return '';
    const timestamp = unicodeText(value).trim();
    if (!Number.isFinite(Date.parse(timestamp))) fail(code);
    return timestamp;
  }

  function normalizeManualAnnotation(input) {
    if (!isPlainObject(input)) fail('INVALID_ANNOTATION');
    const annotationId = normalizeIdentifier(
      input.annotationId,
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
      200,
      'INVALID_ANNOTATION_ID'
    );
    const categoryId = normalizeIdentifier(
      input.categoryId,
      /^[a-z][a-z0-9_]*$/,
      100,
      'INVALID_CATEGORY_ID'
    );
    const quote = rawText(input.quote);
    if (!quote.trim() || quote.length > 20000) fail('INVALID_QUOTE');
    const startOffset = Number(input.startOffset);
    const endOffset = Number(input.endOffset);
    if (!Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset) ||
        startOffset < 0 || endOffset <= startOffset || endOffset - startOffset !== quote.length) {
      fail('INVALID_OFFSETS');
    }
    const blockFingerprint = unicodeText(input.blockFingerprint).trim();
    if (!blockFingerprint || blockFingerprint.length > 300) fail('INVALID_BLOCK_FINGERPRINT');
    const note = unicodeText(input.note);
    if (note.length > MAX_NOTE_LENGTH) fail('NOTE_TOO_LONG');
    const status = input.status === undefined ? 'located' : unicodeText(input.status).trim();
    if (!['located', 'unresolved'].includes(status)) fail('INVALID_ANNOTATION_STATUS');
    const snapshot = {
      ...cloneJsonLike(input.categorySnapshot),
      ...makeCategorySnapshot(input.categorySnapshot)
    };

    const pdfAnchor = input.pdfAnchor === undefined || input.pdfAnchor === null
      ? undefined
      : (typeof shared.normalizePdfAnchor === 'function'
        ? shared.normalizePdfAnchor(input.pdfAnchor)
        : fail('PDF_ANNOTATION_SUPPORT_UNAVAILABLE'));

    return {
      ...cloneJsonLike(input),
      annotationId,
      categoryId,
      categorySnapshot: snapshot,
      quote,
      prefix: rawText(input.prefix),
      suffix: rawText(input.suffix),
      sectionTitle: normalizeWhitespace(input.sectionTitle),
      blockFingerprint,
      startOffset,
      endOffset,
      note,
      status,
      createdAt: normalizeTimestamp(input.createdAt, 'INVALID_CREATED_AT'),
      updatedAt: normalizeTimestamp(input.updatedAt, 'INVALID_UPDATED_AT'),
      ...(pdfAnchor ? { pdfAnchor } : {})
    };
  }

  function normalizeDocumentRecord(input) {
    if (!isPlainObject(input)) fail('INVALID_DOCUMENT_RECORD');
    const documentId = unicodeText(input.documentId).trim().toLowerCase();
    if (!/^sha256:[a-f0-9]{64}$/.test(documentId)) fail('INVALID_DOCUMENT_ID');
    if (input.studyType !== undefined && input.studyType !== null && input.studyType !== '' &&
        !(typeof shared.isStudyType === 'function'
          ? shared.isStudyType(input.studyType) : STUDY_TYPE_IDS.has(input.studyType))) {
      fail('INVALID_STUDY_TYPE');
    }
    if (input.annotations !== undefined && !Array.isArray(input.annotations)) {
      fail('INVALID_ANNOTATIONS');
    }
    const annotations = (input.annotations || []).map(normalizeManualAnnotation);
    if (annotations.length > MAX_ANNOTATIONS_PER_DOCUMENT) fail('ANNOTATION_LIMIT_EXCEEDED');
    const annotationIds = new Set();
    annotations.forEach(item => {
      if (annotationIds.has(item.annotationId)) fail('DUPLICATE_ANNOTATION_ID');
      annotationIds.add(item.annotationId);
    });
    const revision = input.revision === undefined ? 0 : Number(input.revision);
    if (!Number.isSafeInteger(revision) || revision < 0) fail('INVALID_REVISION');

    return {
      ...cloneJsonLike(input),
      schemaVersion: 1,
      documentId,
      title: normalizeWhitespace(input.title),
      canonicalUrl: normalizeCanonicalUrl(input.canonicalUrl || input.url),
      studyType: input.studyType || null,
      annotations,
      revision,
      updatedAt: normalizeTimestamp(input.updatedAt, 'INVALID_UPDATED_AT')
    };
  }

  function commonPrefixLength(expected, actual) {
    const limit = Math.min(expected.length, actual.length);
    let length = 0;
    while (length < limit && expected[length] === actual[length]) length += 1;
    return length;
  }

  function commonSuffixLength(expected, actual) {
    const limit = Math.min(expected.length, actual.length);
    let length = 0;
    while (length < limit &&
           expected[expected.length - length - 1] === actual[actual.length - length - 1]) {
      length += 1;
    }
    return length;
  }

  function blockFingerprint(block) {
    return unicodeText(
      block?.blockFingerprint || block?.fingerprint || block?.blockId || block?.paragraphId
    ).trim();
  }

  function blockId(block) {
    return unicodeText(block?.blockId || block?.paragraphId || blockFingerprint(block)).trim();
  }

  function candidateFor(block, quote, startOffset, prefix, suffix) {
    const text = rawText(block.text);
    const endOffset = startOffset + quote.length;
    return {
      block,
      blockId: blockId(block),
      blockFingerprint: blockFingerprint(block),
      sectionTitle: normalizeWhitespace(block.sectionTitle),
      startOffset,
      endOffset,
      contextScore: commonSuffixLength(prefix, text.slice(0, startOffset)) +
        commonPrefixLength(suffix, text.slice(endOffset))
    };
  }

  function findQuoteCandidates(blocks, quote, prefix, suffix) {
    const candidates = [];
    blocks.forEach(block => {
      const text = rawText(block.text);
      let startOffset = text.indexOf(quote);
      while (startOffset >= 0) {
        candidates.push(candidateFor(block, quote, startOffset, prefix, suffix));
        startOffset = text.indexOf(quote, startOffset + 1);
      }
    });
    return candidates;
  }

  function locatedResult(candidate, matchStage) {
    return {
      status: 'located',
      matchStage,
      blockId: candidate.blockId,
      blockFingerprint: candidate.blockFingerprint,
      sectionTitle: candidate.sectionTitle,
      startOffset: candidate.startOffset,
      endOffset: candidate.endOffset,
      contextScore: candidate.contextScore
    };
  }

  function chooseByContext(candidates, matchStage) {
    if (!candidates.length) return null;
    if (candidates.length === 1) return locatedResult(candidates[0], matchStage);
    const ranked = [...candidates].sort((first, second) =>
      second.contextScore - first.contextScore ||
      first.blockId.localeCompare(second.blockId) ||
      first.startOffset - second.startOffset
    );
    if (ranked[0].contextScore === ranked[1].contextScore) {
      return { status: 'unresolved', reason: 'AMBIGUOUS_CONTEXT' };
    }
    return locatedResult(ranked[0], matchStage);
  }

  function locateAnnotationInBlocks(annotation, blocks) {
    const quote = rawText(annotation?.quote);
    const prefix = rawText(annotation?.prefix);
    const suffix = rawText(annotation?.suffix);
    const anchorFingerprint = unicodeText(annotation?.blockFingerprint).trim();
    const startOffset = Number(annotation?.startOffset);
    const endOffset = Number(annotation?.endOffset);
    const validBlocks = (Array.isArray(blocks) ? blocks : [])
      .filter(block => block && typeof block === 'object' && typeof block.text === 'string');
    if (!quote) return { status: 'unresolved', reason: 'INVALID_QUOTE' };

    if (anchorFingerprint && Number.isSafeInteger(startOffset) && Number.isSafeInteger(endOffset)) {
      const exact = validBlocks.filter(block =>
        blockFingerprint(block) === anchorFingerprint &&
        rawText(block.text).slice(startOffset, endOffset) === quote
      ).map(block => candidateFor(block, quote, startOffset, prefix, suffix));
      if (exact.length === 1) return locatedResult(exact[0], 'fingerprint_offset');
    }

    const sectionTitle = normalizeWhitespace(annotation?.sectionTitle).toLocaleLowerCase('en-US');
    if (sectionTitle) {
      const sameSectionBlocks = validBlocks.filter(block =>
        normalizeWhitespace(block.sectionTitle).toLocaleLowerCase('en-US') === sectionTitle
      );
      const sectionCandidates = findQuoteCandidates(sameSectionBlocks, quote, prefix, suffix);
      if (sectionCandidates.length) {
        return chooseByContext(sectionCandidates, 'section_context');
      }
    }

    const documentCandidates = findQuoteCandidates(validBlocks, quote, prefix, suffix);
    if (documentCandidates.length) {
      return chooseByContext(documentCandidates, 'document_context');
    }
    return { status: 'unresolved', reason: 'NOT_FOUND' };
  }

  function sameManualAnnotationRefreshIdentity(committedState, response, expectedTabId) {
    const tabId = Number(expectedTabId);
    const documentId = unicodeText(response?.documentId).trim();
    const documentHash = unicodeText(response?.documentHash).trim();
    const canonicalUrl = unicodeText(response?.canonicalUrl).trim();
    const contentWorldNonce = unicodeText(response?.contentWorldNonce).trim();
    const documentEpoch = Number(response?.documentEpoch);
    if (!Number.isSafeInteger(tabId) || !documentId || !documentHash || !canonicalUrl ||
      !/^[a-f0-9]{32,64}$/iu.test(contentWorldNonce) ||
      !Number.isSafeInteger(documentEpoch) || documentEpoch < 1) return false;
    return Number(committedState?.tabId) === tabId &&
      unicodeText(committedState?.documentId).trim() === documentId &&
      unicodeText(committedState?.documentHash).trim() === documentHash &&
      unicodeText(committedState?.canonicalUrl).trim() === canonicalUrl &&
      unicodeText(committedState?.contentWorldNonce).trim() === contentWorldNonce &&
      Number(committedState?.documentEpoch) === documentEpoch;
  }

  function normalizeRefreshTabUrl(value) {
    if (typeof shared.normalizeTabDocumentUrl === 'function') {
      return shared.normalizeTabDocumentUrl(value);
    }
    return unicodeText(value).trim().replace(/#.*$/u, '');
  }

  function manualAnnotationRefreshCommitMode(input = {}) {
    const expectedTabId = Number(input.expectedTabId);
    const capturedTabId = Number(input.capturedTab?.id);
    const currentTabId = Number(input.currentTab?.id);
    const capturedUrl = normalizeRefreshTabUrl(
      input.capturedTab?.url || input.capturedTab?.pendingUrl
    );
    const currentUrl = normalizeRefreshTabUrl(
      input.currentTab?.url || input.currentTab?.pendingUrl
    );
    const response = input.response;
    const liveProof = input.liveProof;
    const responseIdentity = {
      tabId: expectedTabId,
      documentId: unicodeText(response?.documentId).trim(),
      documentHash: unicodeText(response?.documentHash).trim(),
      canonicalUrl: unicodeText(response?.canonicalUrl).trim(),
      contentWorldNonce: unicodeText(response?.contentWorldNonce).trim(),
      documentEpoch: Number(response?.documentEpoch)
    };
    if (!Number.isSafeInteger(expectedTabId) ||
      capturedTabId !== expectedTabId || currentTabId !== expectedTabId ||
      !capturedUrl || capturedUrl !== currentUrl ||
      !sameManualAnnotationRefreshIdentity(responseIdentity, response, expectedTabId) ||
      !sameManualAnnotationRefreshIdentity(responseIdentity, liveProof, expectedTabId)) return null;
    if (input.superseded === true) {
      return sameManualAnnotationRefreshIdentity(
        input.committedState,
        response,
        expectedTabId
      ) ? 'committed' : null;
    }
    return 'response';
  }

  function manualAnnotationEventCommitMode(
    verifiedState,
    event,
    eventTabId,
    activeTabId
  ) {
    const tabId = Number(eventTabId);
    if (!Number.isSafeInteger(tabId) || tabId !== Number(activeTabId)) return 'ignore';
    return sameManualAnnotationRefreshIdentity(
      verifiedState,
      event,
      tabId
    ) ? 'verified' : 'refresh';
  }

  return {
    MAX_NOTE_LENGTH,
    WARNING_ANNOTATIONS_PER_DOCUMENT,
    MAX_ANNOTATIONS_PER_DOCUMENT,
    createDocumentId,
    normalizeManualAnnotation,
    normalizeDocumentRecord,
    locateAnnotationInBlocks,
    makeCategorySnapshot,
    sameManualAnnotationRefreshIdentity,
    manualAnnotationRefreshCommitMode,
    manualAnnotationEventCommitMode
  };
});
