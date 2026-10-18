/*
 * Adapted from llm-for-zotero 3.8.27 at commit
 * f8dbbd863b021368c07efe0f61c67f3503d79bc9 (AGPL-3.0-or-later).
 * See THIRD_PARTY_NOTICES.md for provenance and modifications.
 */
(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const INVALID_TEXT_CONTROL_CODE_RANGES = [[0x00, 0x08], [0x0e, 0x1f]];
  const INVALID_TEXT_CONTROL_CODES = new Set([0x0b, 0x0c, 0x7f]);
  const STYLE_COMMAND_PATTERN =
    /\\(?:textstyle|displaystyle|scriptstyle|scriptscriptstyle|mathbf|mathrm|mathit|mathsf|mathbb|mathcal|pmb|boldsymbol)\b/g;
  const QUOTE_WORD_PATTERN = /[\p{L}\p{N}]+/gu;
  const LETTER_TOKEN_PATTERN = /^\p{L}+$/u;
  const SINGLE_LETTER_TOKEN_PATTERN = /^\p{L}$/u;
  const NUMERIC_TOKEN_PATTERN = /^\p{N}+$/u;
  const LINE_BREAK_HYPHEN_GAP_PATTERN = /^[\u00ad\s]*[-‐‑‒–—][\u00ad\s]*$/u;
  const SOFT_HYPHEN_GAP_PATTERN = /^[\u00ad\s]+$/u;
  const SOURCE_SPAN_LEADING_BOUNDARY_CHARS = '"\'“‘([';
  const SOURCE_SPAN_TRAILING_BOUNDARY_PATTERN = /[.,;:!?"'”’)\]}。！？、，；：]/;
  const PDF_SEMANTIC_LOCATOR_KEYS = new Set([
    'locatorKind', 'documentId', 'documentHash', 'documentGeneration', 'revision',
    'semanticCacheKey', 'semanticProvenanceKey', 'paragraphId', 'normalizedStart',
    'normalizedEnd', 'expectedNormalizedQuote'
  ]);
  const PDF_EVIDENCE_INPUT_KEYS = new Set([
    'locator', 'semanticLocator', 'paragraphId', 'legacyParagraphId', 'pageNumber',
    'quote', 'pageAnchor'
  ]);
  const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const MAX_PDF_EVIDENCE_TEXT = 4000;
  const MAX_PDF_SEMANTIC_PARAGRAPHS = 10000;
  const MAX_PDF_SEMANTIC_PARAGRAPH_TEXT = 200000;
  const MAX_PDF_SEMANTIC_DOCUMENT_OFFSET = 10000000;
  const MAX_PDF_SEMANTIC_TOTAL_TEXT = 4000000;

  function safeDataRecord(value, allowedKeys = null) {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return null;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (FORBIDDEN_OBJECT_KEYS.has(key) || !Object.hasOwn(descriptor, 'value') ||
            (allowedKeys && !allowedKeys.has(key))) return null;
      }
      return descriptors;
    } catch (_) {
      return null;
    }
  }

  function descriptorValue(descriptors, key) {
    return descriptors && Object.hasOwn(descriptors, key) ? descriptors[key].value : undefined;
  }

  function safeDataArray(value, maximum) {
    try {
      if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const length = descriptorValue(descriptors, 'length');
      if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
      const items = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[index];
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
        items.push(descriptor.value);
      }
      const extraKeys = Object.keys(descriptors).filter(key => key !== 'length' &&
        !/^(?:0|[1-9]\d*)$/u.test(key));
      return extraKeys.length ? null : items;
    } catch (_) {
      return null;
    }
  }

  function boundedIdentity(value, maximum = 512) {
    if (typeof value !== 'string' || !value || value.length > maximum ||
        /[\u0000-\u001F\u007F]/u.test(value)) return '';
    return value.normalize('NFC');
  }

  function positiveSafeInteger(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  }

  function deepFreeze(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach(item => deepFreeze(item, seen));
    return Object.freeze(value);
  }

  function normalizePdfSemanticEvidenceLocator(value) {
    const descriptors = safeDataRecord(value, PDF_SEMANTIC_LOCATOR_KEYS);
    if (!descriptors || Object.keys(descriptors).length !== PDF_SEMANTIC_LOCATOR_KEYS.size ||
        descriptorValue(descriptors, 'locatorKind') !== 'pdf-semantic') return null;
    const documentId = boundedIdentity(descriptorValue(descriptors, 'documentId'));
    const documentHash = boundedIdentity(descriptorValue(descriptors, 'documentHash'));
    const documentGeneration = positiveSafeInteger(
      descriptorValue(descriptors, 'documentGeneration'));
    const revision = positiveSafeInteger(descriptorValue(descriptors, 'revision'));
    const semanticCacheKey = boundedIdentity(
      descriptorValue(descriptors, 'semanticCacheKey'));
    const semanticProvenanceKey = boundedIdentity(
      descriptorValue(descriptors, 'semanticProvenanceKey'));
    const paragraphId = boundedIdentity(descriptorValue(descriptors, 'paragraphId'));
    const normalizedStart = descriptorValue(descriptors, 'normalizedStart');
    const normalizedEnd = descriptorValue(descriptors, 'normalizedEnd');
    const expectedNormalizedQuote = descriptorValue(descriptors, 'expectedNormalizedQuote');
    if (!documentId || !documentHash || !documentGeneration || !revision ||
        !semanticCacheKey || !semanticProvenanceKey || !paragraphId ||
        paragraphId.startsWith('pdf-page-') || !Number.isSafeInteger(normalizedStart) ||
        !Number.isSafeInteger(normalizedEnd) || normalizedStart < 0 ||
        normalizedEnd <= normalizedStart ||
        normalizedEnd > MAX_PDF_SEMANTIC_DOCUMENT_OFFSET ||
        typeof expectedNormalizedQuote !== 'string' || !expectedNormalizedQuote.length ||
        expectedNormalizedQuote.length > MAX_PDF_EVIDENCE_TEXT ||
        expectedNormalizedQuote.length !== normalizedEnd - normalizedStart ||
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(expectedNormalizedQuote)) {
      return null;
    }
    return deepFreeze({
      locatorKind: 'pdf-semantic', documentId, documentHash, documentGeneration, revision,
      semanticCacheKey, semanticProvenanceKey, paragraphId, normalizedStart, normalizedEnd,
      expectedNormalizedQuote
    });
  }

  function normalizePdfPageAnchor(value, fallbackParagraphId = '', fallbackPageNumber = 0) {
    let paragraphId = fallbackParagraphId;
    let pageNumber = fallbackPageNumber;
    if (value !== undefined) {
      const descriptors = safeDataRecord(value,
        new Set(['paragraphId', 'pageNumber']));
      if (!descriptors || Object.keys(descriptors).length !== 2) return null;
      paragraphId = descriptorValue(descriptors, 'paragraphId');
      pageNumber = descriptorValue(descriptors, 'pageNumber');
    }
    const normalizedParagraphId = boundedIdentity(paragraphId, 120);
    const matched = /^pdf-page-(\d+)$/u.exec(normalizedParagraphId);
    const normalizedPageNumber = positiveSafeInteger(pageNumber || Number(matched?.[1]));
    if (!matched || !normalizedPageNumber || Number(matched[1]) !== normalizedPageNumber) {
      return null;
    }
    return Object.freeze({ paragraphId: normalizedParagraphId,
      pageNumber: normalizedPageNumber });
  }

  function normalizePdfSemanticMigrationContext(value) {
    const descriptors = safeDataRecord(value);
    if (!descriptors) return null;
    const documentId = boundedIdentity(descriptorValue(descriptors, 'documentId'));
    const documentHash = boundedIdentity(descriptorValue(descriptors, 'documentHash'));
    const documentGeneration = positiveSafeInteger(
      descriptorValue(descriptors, 'documentGeneration'));
    const revision = positiveSafeInteger(descriptorValue(descriptors, 'revision'));
    const semanticCacheKey = boundedIdentity(
      descriptorValue(descriptors, 'semanticCacheKey'));
    const semanticProvenanceKey = boundedIdentity(
      descriptorValue(descriptors, 'semanticProvenanceKey'));
    const rawParagraphs = safeDataArray(
      descriptorValue(descriptors, 'paragraphs'), MAX_PDF_SEMANTIC_PARAGRAPHS);
    if (!documentId || !documentHash || !documentGeneration || !revision ||
        !semanticCacheKey || !semanticProvenanceKey || !rawParagraphs) return null;
    const paragraphs = [];
    const paragraphIds = new Set();
    const intervals = [];
    let totalText = 0;
    for (const raw of rawParagraphs) {
      const paragraphDescriptors = safeDataRecord(raw);
      if (!paragraphDescriptors) return null;
      const paragraphId = boundedIdentity(
        descriptorValue(paragraphDescriptors, 'paragraphId'));
      const rawText = descriptorValue(paragraphDescriptors, 'normalizedText') ??
        descriptorValue(paragraphDescriptors, 'text');
      const normalizedStart = descriptorValue(paragraphDescriptors, 'normalizedStart');
      const normalizedEnd = descriptorValue(paragraphDescriptors, 'normalizedEnd');
      if (!paragraphId || paragraphId.startsWith('pdf-page-') ||
          paragraphIds.has(paragraphId) ||
          typeof rawText !== 'string' || rawText.length > MAX_PDF_SEMANTIC_PARAGRAPH_TEXT ||
          !Number.isSafeInteger(normalizedStart) || !Number.isSafeInteger(normalizedEnd) ||
          normalizedStart < 0 || normalizedEnd <= normalizedStart ||
          normalizedEnd > MAX_PDF_SEMANTIC_DOCUMENT_OFFSET ||
          normalizedEnd - normalizedStart !== rawText.length) {
        return null;
      }
      paragraphIds.add(paragraphId);
      totalText += rawText.length;
      if (totalText > MAX_PDF_SEMANTIC_TOTAL_TEXT) return null;
      intervals.push({ start: normalizedStart, end: normalizedEnd });
      const pageNumber = positiveSafeInteger(
        descriptorValue(paragraphDescriptors, 'pageNumber'));
      const rawLegacyValue = descriptorValue(paragraphDescriptors, 'legacyParagraphIds');
      const rawLegacyIds = rawLegacyValue === undefined ? [] :
        safeDataArray(rawLegacyValue, 32);
      const singleLegacyId = descriptorValue(paragraphDescriptors, 'legacyParagraphId');
      if (!rawLegacyIds) return null;
      const legacyParagraphIds = [...new Set([
        ...rawLegacyIds, singleLegacyId,
        pageNumber ? `pdf-page-${pageNumber}` : ''
      ].map(item => boundedIdentity(item, 120)).filter(item => /^pdf-page-\d+$/u.test(item)))];
      paragraphs.push({ paragraphId, text: rawText, normalizedStart, normalizedEnd,
        pageNumber: pageNumber || Number(legacyParagraphIds[0]?.slice(9)) || 0,
        legacyParagraphIds });
    }
    intervals.sort((left, right) => left.start - right.start || left.end - right.end);
    for (let index = 1; index < intervals.length; index += 1) {
      if (intervals[index].start < intervals[index - 1].end) return null;
    }
    return { documentId, documentHash, documentGeneration, revision,
      semanticCacheKey, semanticProvenanceKey, paragraphs };
  }

  function pdfMigrationResult({ status, precision = 'none', degradedReasonCode = '',
    rebound = false, locator = null, suggestedLocator = null, preservedLocator = null,
    pageAnchor = null }) {
    return deepFreeze({ status, precision, degradedReasonCode,
      rebound: rebound === true, locator, suggestedLocator, preservedLocator, pageAnchor });
  }

  function locatorForCurrentQuote(context, paragraph, span) {
    return normalizePdfSemanticEvidenceLocator({
      locatorKind: 'pdf-semantic',
      documentId: context.documentId,
      documentHash: context.documentHash,
      documentGeneration: context.documentGeneration,
      revision: context.revision,
      semanticCacheKey: context.semanticCacheKey,
      semanticProvenanceKey: context.semanticProvenanceKey,
      paragraphId: paragraph.paragraphId,
      normalizedStart: paragraph.normalizedStart + span.start,
      normalizedEnd: paragraph.normalizedStart + span.end,
      expectedNormalizedQuote: span.text
    });
  }

  function currentQuoteCandidates(context, quote, pageNumber = 0) {
    const candidates = [];
    for (const paragraph of context.paragraphs) {
      if (pageNumber && paragraph.pageNumber !== pageNumber &&
          !paragraph.legacyParagraphIds.includes(`pdf-page-${pageNumber}`)) continue;
      const count = countCanonicalTextMatches(paragraph.text, quote);
      if (!count) continue;
      if (count > 1) {
        for (let index = 0; index < count; index += 1) candidates.push(null);
        continue;
      }
      // Uniqueness still uses canonical matches across the whole document.
      // If the saved quote survives verbatim, preserve its selected endpoints:
      // token-based matching may otherwise expand brackets/punctuation or drop
      // a trailing footnote marker, changing the user's original highlight.
      const quoteIndex = buildQuoteTextIndex(paragraph.text);
      const canonicalQuote = normalizeQuoteTextCanonical(quote);
      const canonicalStart = findCanonicalTextMatchStart(quoteIndex.canonicalText, canonicalQuote);
      const canonicalEnd = canonicalStart + canonicalQuote.length;
      const firstToken = quoteIndex.tokens.find(token => token.canonicalEnd > canonicalStart);
      const lastToken = [...quoteIndex.tokens].reverse()
        .find(token => token.canonicalStart < canonicalEnd);
      // Restrict the literal candidate to that same canonical occurrence. A
      // global indexOf("flow") could otherwise select the earlier "workflow".
      const exactStart = firstToken && lastToken && canonicalStart >= 0
        ? paragraph.text.indexOf(quote, Math.max(0, lastToken.sourceEnd - quote.length)) : -1;
      const preservesOccurrence = exactStart >= 0 && exactStart <= firstToken.sourceStart &&
        exactStart + quote.length >= lastToken.sourceEnd;
      const span = preservesOccurrence
        ? { start: exactStart, end: exactStart + quote.length, text: quote }
        : findCanonicalQuoteSourceSpan(quoteIndex, quote);
      const locator = span && span.text.length <= MAX_PDF_EVIDENCE_TEXT
        ? locatorForCurrentQuote(context, paragraph, span) : null;
      candidates.push(locator);
    }
    return candidates;
  }

  function pageAnchorMatchesParagraph(pageAnchor, paragraph) {
    return !pageAnchor || Boolean(paragraph && (
      paragraph.pageNumber === pageAnchor.pageNumber ||
      paragraph.legacyParagraphIds.includes(pageAnchor.paragraphId)
    ));
  }

  function migratePdfArticleChatEvidence(value, semanticContext) {
    const context = normalizePdfSemanticMigrationContext(semanticContext);
    const descriptors = safeDataRecord(value, PDF_EVIDENCE_INPUT_KEYS);
    if (!context || !descriptors) {
      return pdfMigrationResult({ status: 'invalid',
        degradedReasonCode: 'PDF_EVIDENCE_INVALID' });
    }
    const rawLocator = descriptorValue(descriptors, 'locator') ??
      descriptorValue(descriptors, 'semanticLocator');
    const rawParagraphId = descriptorValue(descriptors, 'paragraphId') ??
      descriptorValue(descriptors, 'legacyParagraphId');
    const rawPageNumber = descriptorValue(descriptors, 'pageNumber');
    const rawQuote = descriptorValue(descriptors, 'quote');
    const pageAnchorValue = descriptorValue(descriptors, 'pageAnchor');

    if (rawLocator !== undefined) {
      const preservedLocator = normalizePdfSemanticEvidenceLocator(rawLocator);
      if (!preservedLocator) {
        return pdfMigrationResult({ status: 'invalid',
          degradedReasonCode: 'PDF_EVIDENCE_INVALID' });
      }
      const pageAnchor = pageAnchorValue === undefined ? null :
        normalizePdfPageAnchor(pageAnchorValue);
      if (pageAnchorValue !== undefined && !pageAnchor) {
        return pdfMigrationResult({ status: 'invalid', preservedLocator,
          degradedReasonCode: 'PDF_EVIDENCE_INVALID' });
      }
      if (preservedLocator.documentId !== context.documentId ||
          preservedLocator.documentHash !== context.documentHash ||
          preservedLocator.documentGeneration !== context.documentGeneration) {
        return pdfMigrationResult({ status: 'stale', preservedLocator, pageAnchor,
          degradedReasonCode: 'PDF_DOCUMENT_CHANGED' });
      }
      if (preservedLocator.revision === context.revision) {
        if (preservedLocator.semanticCacheKey !== context.semanticCacheKey ||
            preservedLocator.semanticProvenanceKey !== context.semanticProvenanceKey) {
          return pdfMigrationResult({ status: 'stale', preservedLocator, pageAnchor,
            degradedReasonCode: 'PDF_SEMANTIC_IDENTITY_MISMATCH' });
        }
        const paragraph = context.paragraphs.find(item =>
          item.paragraphId === preservedLocator.paragraphId);
        if (pageAnchor && paragraph && !pageAnchorMatchesParagraph(pageAnchor, paragraph)) {
          return pdfMigrationResult({ status: 'invalid', preservedLocator, pageAnchor,
            degradedReasonCode: 'PDF_EVIDENCE_PAGE_ANCHOR_MISMATCH' });
        }
        const relativeStart = paragraph
          ? preservedLocator.normalizedStart - paragraph.normalizedStart : -1;
        const relativeEnd = paragraph
          ? preservedLocator.normalizedEnd - paragraph.normalizedStart : -1;
        const quoteMatches = paragraph && relativeStart >= 0 &&
          relativeEnd > relativeStart && relativeEnd <= paragraph.text.length &&
          paragraph.text.slice(relativeStart, relativeEnd) ===
            preservedLocator.expectedNormalizedQuote;
        const verifiedPageAnchor = paragraph?.legacyParagraphIds?.length === 1
          ? normalizePdfPageAnchor(undefined, paragraph.legacyParagraphIds[0]) : null;
        return quoteMatches
          ? pdfMigrationResult({ status: 'verified', precision: 'normalized-exact',
            locator: preservedLocator, pageAnchor: verifiedPageAnchor })
          : pdfMigrationResult({ status: 'missing', preservedLocator, pageAnchor,
            degradedReasonCode: 'PDF_SEMANTIC_TARGET_NOT_FOUND' });
      }
      const candidates = currentQuoteCandidates(
        context, preservedLocator.expectedNormalizedQuote);
      if (candidates.length === 1 && candidates[0]) {
        const paragraph = context.paragraphs.find(item =>
          item.paragraphId === candidates[0].paragraphId);
        const reboundPageAnchor = paragraph?.legacyParagraphIds?.length === 1
          ? normalizePdfPageAnchor(undefined, paragraph.legacyParagraphIds[0]) : null;
        return pdfMigrationResult({ status: 'verified', precision: 'normalized-exact',
          rebound: true, locator: candidates[0], preservedLocator,
          pageAnchor: reboundPageAnchor });
      }
      if (candidates.length > 1) {
        return pdfMigrationResult({ status: 'ambiguous', preservedLocator, pageAnchor,
          precision: pageAnchor ? 'page-only' : 'none',
          degradedReasonCode: 'PDF_SEMANTIC_QUOTE_AMBIGUOUS' });
      }
      return pdfMigrationResult({ status: 'degraded', preservedLocator, pageAnchor,
        precision: pageAnchor ? 'page-only' : 'none',
        degradedReasonCode: 'PDF_SEMANTIC_REBIND_NOT_FOUND' });
    }

    const paragraphId = boundedIdentity(rawParagraphId, 120);
    const match = /^pdf-page-(\d+)$/u.exec(paragraphId);
    const pageAnchor = normalizePdfPageAnchor(pageAnchorValue,
      paragraphId, positiveSafeInteger(rawPageNumber));
    if (!match || !pageAnchor || (rawQuote !== undefined &&
        (typeof rawQuote !== 'string' || !rawQuote.length ||
          rawQuote.length > MAX_PDF_EVIDENCE_TEXT))) {
      return pdfMigrationResult({ status: 'invalid',
        degradedReasonCode: 'PDF_EVIDENCE_INVALID' });
    }
    if (typeof rawQuote !== 'string') {
      return pdfMigrationResult({ status: 'degraded', precision: 'page-only', pageAnchor,
        degradedReasonCode: 'PDF_LEGACY_PAGE_ANCHOR' });
    }
    const candidates = currentQuoteCandidates(context, rawQuote, pageAnchor.pageNumber);
    if (candidates.length === 1 && candidates[0]) {
      return pdfMigrationResult({ status: 'degraded', precision: 'page-only', pageAnchor,
        suggestedLocator: candidates[0], degradedReasonCode: 'PDF_LEGACY_PAGE_ANCHOR' });
    }
    if (candidates.length > 1) {
      return pdfMigrationResult({ status: 'ambiguous', precision: 'page-only', pageAnchor,
        degradedReasonCode: 'PDF_LEGACY_QUOTE_AMBIGUOUS' });
    }
    return pdfMigrationResult({ status: 'degraded', precision: 'page-only', pageAnchor,
      degradedReasonCode: 'PDF_LEGACY_QUOTE_NOT_FOUND' });
  }

  function isInvalidTextControlCode(code) {
    if (INVALID_TEXT_CONTROL_CODES.has(code)) return true;
    return INVALID_TEXT_CONTROL_CODE_RANGES.some(([start, end]) => code >= start && code <= end);
  }

  function sanitizeForQuoteScan(value) {
    let out = '';
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (isInvalidTextControlCode(code)) {
        out += ' ';
        continue;
      }
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          out += value[index] + value[index + 1];
          index += 1;
        } else {
          out += ' ';
        }
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) {
        out += ' ';
        continue;
      }
      out += value[index];
    }
    return out;
  }

  function maskIgnoredSourceSyntax(value) {
    return value.replace(STYLE_COMMAND_PATTERN, match => ' '.repeat(match.length));
  }

  function rawTokensFromSource(value) {
    const sourceText = typeof value === 'string' ? value : '';
    const scanText = maskIgnoredSourceSyntax(sanitizeForQuoteScan(sourceText));
    return Array.from(scanText.matchAll(QUOTE_WORD_PATTERN)).map(match => {
      const start = match.index || 0;
      const rawText = match[0] || '';
      return {
        text: rawText.normalize('NFKC').toLowerCase(),
        canonicalStart: 0,
        canonicalEnd: 0,
        sourceStart: start,
        sourceEnd: start + rawText.length
      };
    });
  }

  function shouldMergeLineBreakHyphenation(left, right, sourceText) {
    if (!LETTER_TOKEN_PATTERN.test(left.text) || !LETTER_TOKEN_PATTERN.test(right.text)) {
      return false;
    }
    const gap = sourceText.slice(left.sourceEnd, right.sourceStart);
    if (gap.includes('\u00ad') && SOFT_HYPHEN_GAP_PATTERN.test(gap)) return true;
    return (gap.includes('\n') || gap.includes('\u00ad')) &&
      LINE_BREAK_HYPHEN_GAP_PATTERN.test(gap);
  }

  function shouldMergeLatexExponent(left, right, sourceText) {
    if (!SINGLE_LETTER_TOKEN_PATTERN.test(left.text) || !NUMERIC_TOKEN_PATTERN.test(right.text)) {
      return false;
    }
    const gap = sourceText.slice(left.sourceEnd, right.sourceStart);
    return gap.includes('^') && /^[\s{}^]*$/.test(gap);
  }

  function mergeSourceTokens(tokens, sourceText) {
    const merged = [];
    for (const token of tokens) {
      const previous = merged[merged.length - 1];
      if (previous && (
        shouldMergeLineBreakHyphenation(previous, token, sourceText) ||
        shouldMergeLatexExponent(previous, token, sourceText)
      )) {
        merged[merged.length - 1] = {
          text: previous.text + token.text,
          canonicalStart: 0,
          canonicalEnd: 0,
          sourceStart: previous.sourceStart,
          sourceEnd: token.sourceEnd
        };
      } else {
        merged.push(token);
      }
    }
    return merged;
  }

  function assignCanonicalOffsets(tokens) {
    let cursor = 0;
    return tokens.map((token, index) => {
      const start = cursor + (index === 0 ? 0 : 1);
      const end = start + token.text.length;
      cursor = end;
      return { ...token, canonicalStart: start, canonicalEnd: end };
    });
  }

  function buildQuoteTextIndex(value) {
    const sourceText = typeof value === 'string' ? value : '';
    const tokens = assignCanonicalOffsets(
      mergeSourceTokens(rawTokensFromSource(sourceText), sourceText)
    );
    return {
      sourceText,
      canonicalText: tokens.map(token => token.text).join(' '),
      tokens
    };
  }

  function normalizeQuoteTextCanonical(value) {
    return buildQuoteTextIndex(value).canonicalText;
  }

  function extractQuoteTextTokens(value) {
    return buildQuoteTextIndex(value).tokens.map(token => token.text);
  }

  function isCanonicalMatchBoundary(canonicalText, canonicalStart, canonicalEnd) {
    return (canonicalStart <= 0 || canonicalText[canonicalStart - 1] === ' ') &&
      (canonicalEnd >= canonicalText.length || canonicalText[canonicalEnd] === ' ');
  }

  function findCanonicalTextMatchStart(text, query) {
    const canonicalText = normalizeQuoteTextCanonical(text);
    const canonicalQuery = normalizeQuoteTextCanonical(query);
    if (!canonicalText || !canonicalQuery) return -1;
    let cursor = 0;
    while (cursor <= canonicalText.length - canonicalQuery.length) {
      const canonicalStart = canonicalText.indexOf(canonicalQuery, cursor);
      if (canonicalStart < 0) return -1;
      const canonicalEnd = canonicalStart + canonicalQuery.length;
      if (isCanonicalMatchBoundary(canonicalText, canonicalStart, canonicalEnd)) {
        return canonicalStart;
      }
      cursor = canonicalStart + 1;
    }
    return -1;
  }

  function countCanonicalTextMatches(text, query) {
    const canonicalText = normalizeQuoteTextCanonical(text);
    const canonicalQuery = normalizeQuoteTextCanonical(query);
    if (!canonicalText || !canonicalQuery) return 0;
    let count = 0;
    let cursor = 0;
    while (cursor <= canonicalText.length - canonicalQuery.length) {
      const canonicalStart = canonicalText.indexOf(canonicalQuery, cursor);
      if (canonicalStart < 0) break;
      const canonicalEnd = canonicalStart + canonicalQuery.length;
      if (isCanonicalMatchBoundary(canonicalText, canonicalStart, canonicalEnd)) count += 1;
      cursor = canonicalStart + 1;
    }
    return count;
  }

  function expandSourceSpanStart(sourceText, sourceStart) {
    let cursor = sourceStart;
    while (cursor > 0 && SOURCE_SPAN_LEADING_BOUNDARY_CHARS.includes(sourceText[cursor - 1])) {
      cursor -= 1;
    }
    return cursor;
  }

  function expandSourceSpanEnd(sourceText, sourceEnd) {
    let cursor = sourceEnd;
    while (cursor < sourceText.length && SOURCE_SPAN_TRAILING_BOUNDARY_PATTERN.test(sourceText[cursor])) {
      cursor += 1;
    }
    return cursor;
  }

  function findCanonicalQuoteSourceSpan(indexOrText, queryText) {
    const index = typeof indexOrText === 'string' ? buildQuoteTextIndex(indexOrText) : indexOrText;
    if (!index || !Array.isArray(index.tokens)) return null;
    const canonicalQuery = normalizeQuoteTextCanonical(queryText);
    if (!index.canonicalText || !canonicalQuery) return null;
    const canonicalStart = findCanonicalTextMatchStart(index.canonicalText, canonicalQuery);
    if (canonicalStart < 0) return null;
    const canonicalEnd = canonicalStart + canonicalQuery.length;
    const firstToken = index.tokens.find(token => token.canonicalEnd > canonicalStart);
    const lastToken = [...index.tokens].reverse()
      .find(token => token.canonicalStart < canonicalEnd);
    if (!firstToken || !lastToken) return null;
    const sourceStart = expandSourceSpanStart(index.sourceText, firstToken.sourceStart);
    const sourceEnd = expandSourceSpanEnd(index.sourceText, lastToken.sourceEnd);
    return {
      sourceStart,
      sourceEnd,
      start: sourceStart,
      end: sourceEnd,
      text: index.sourceText.slice(sourceStart, sourceEnd)
    };
  }

  function normalizeEvidenceIdentity(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  }

  function normalizeSectionKeys(value) {
    const items = Array.isArray(value) ? value : [value];
    return new Set(items.map(item => normalizeEvidenceIdentity(
      typeof item === 'string' ? item : (item?.title || item?.sectionTitle)
    ).toLowerCase()).filter(Boolean));
  }

  function paragraphSectionKeys(paragraph) {
    return normalizeSectionKeys([
      paragraph?.sectionTitle,
      ...(Array.isArray(paragraph?.sectionPath) ? paragraph.sectionPath : [])
    ]);
  }

  function evidenceSectionKeys(evidence) {
    return normalizeSectionKeys([
      evidence?.sectionTitle,
      ...(Array.isArray(evidence?.sectionPath) ? evidence.sectionPath : [])
    ]);
  }

  function sectionsOverlap(evidence, paragraph) {
    const requested = evidenceSectionKeys(evidence);
    if (!requested.size) return false;
    const available = paragraphSectionKeys(paragraph);
    return [...requested].some(key => available.has(key));
  }

  function bestAlignedSimilarity(sourceUnits, queryUnits) {
    if (!sourceUnits.length || !queryUnits.length || sourceUnits.length < queryUnits.length) {
      return 0;
    }
    let best = 0;
    const queryLength = queryUnits.length;
    for (let start = 0; start <= sourceUnits.length - queryLength; start += 1) {
      let matches = 0;
      for (let offset = 0; offset < queryLength; offset += 1) {
        if (sourceUnits[start + offset] === queryUnits[offset]) matches += 1;
      }
      best = Math.max(best, matches / queryLength);
      if (best === 1) return best;
    }
    return best;
  }

  function tolerantQuoteSimilarity(text, quote) {
    const sourceTokens = extractQuoteTextTokens(text);
    const quoteTokens = extractQuoteTextTokens(quote);
    let tokenSimilarity = 0;
    if (quoteTokens.length >= 6 && quoteTokens.length <= 240) {
      tokenSimilarity = bestAlignedSimilarity(sourceTokens, quoteTokens);
    }
    const sourceCharacters = normalizeQuoteTextCanonical(text).replace(/\s+/g, '');
    const quoteCharacters = normalizeQuoteTextCanonical(quote).replace(/\s+/g, '');
    let characterSimilarity = 0;
    if (quoteCharacters.length >= 12 && quoteCharacters.length <= 240) {
      characterSimilarity = bestAlignedSimilarity(
        Array.from(sourceCharacters), Array.from(quoteCharacters)
      );
    }
    return Math.max(tokenSimilarity, characterSimilarity);
  }

  function citationTarget(paragraph, snapshot, quote = '') {
    const quoteSpan = quote ? findCanonicalQuoteSourceSpan(paragraph?.text, quote) : null;
    return {
      paragraphId: normalizeEvidenceIdentity(paragraph?.paragraphId),
      sourceKey: normalizeEvidenceIdentity(paragraph?.sourceKey),
      textHash: normalizeEvidenceIdentity(paragraph?.textHash),
      sectionTitle: normalizeEvidenceIdentity(paragraph?.sectionTitle),
      sectionPath: (Array.isArray(paragraph?.sectionPath) ? paragraph.sectionPath : [])
        .map(item => typeof item === 'string' ? item : { ...item }),
      documentRevision: Math.max(0, Number(snapshot?.revision) || 0),
      quoteSpan
    };
  }

  function verificationResult(status, snapshot, {
    candidates = [],
    reason = '',
    matchMethod = '',
    quote = '',
    revisionChanged = false
  } = {}) {
    const uniqueCandidate = status === 'verified' && candidates.length === 1
      ? candidates[0] : null;
    return {
      status,
      candidateCount: candidates.length,
      reason,
      matchMethod,
      rebound: status === 'verified' && revisionChanged,
      documentRevision: Math.max(0, Number(snapshot?.revision) || 0),
      target: uniqueCandidate ? citationTarget(uniqueCandidate, snapshot, quote) : null
    };
  }

  function verifyUniqueCandidates(candidates, snapshot, options) {
    if (candidates.length === 1) {
      return verificationResult('verified', snapshot, { ...options, candidates });
    }
    if (candidates.length > 1) {
      return verificationResult('ambiguous', snapshot, { ...options, candidates });
    }
    return null;
  }

  function verifyArticleChatEvidence(evidence = {}, snapshot = {}) {
    const paragraphs = (Array.isArray(snapshot?.paragraphs) ? snapshot.paragraphs : [])
      .filter(paragraph => paragraph && typeof paragraph === 'object');
    const currentRevision = Math.max(0, Number(snapshot?.revision) || 0);
    const evidenceRevision = Math.max(
      0,
      Number(evidence?.documentRevision || evidence?.navigationRevision) || 0
    );
    const revisionChanged = Boolean(
      evidenceRevision && currentRevision && evidenceRevision !== currentRevision
    );
    const evidenceDocumentHash = normalizeEvidenceIdentity(evidence?.documentHash)
      .replace(/^sha256:/i, '').toLowerCase();
    const currentDocumentHash = normalizeEvidenceIdentity(snapshot?.documentHash)
      .replace(/^sha256:/i, '').toLowerCase();
    if (evidenceDocumentHash && currentDocumentHash &&
      evidenceDocumentHash !== currentDocumentHash) {
      return verificationResult('stale', snapshot, {
        reason: 'DOCUMENT_CHANGED'
      });
    }

    const paragraphId = normalizeEvidenceIdentity(evidence?.paragraphId);
    const sourceKey = normalizeEvidenceIdentity(evidence?.sourceKey);
    const textHash = normalizeEvidenceIdentity(evidence?.textHash).toLowerCase();
    const quote = normalizeEvidenceIdentity(evidence?.quote || evidence?.support);
    // A model-supplied locator cannot verify a quote that belongs to another
    // page. Keep identity-only navigation compatible, but verify every supplied
    // field before taking the fast path; otherwise try the unique exact quote.
    const quoteMatches = paragraph => !quote ||
      countCanonicalTextMatches(paragraph?.text, quote) === 1;
    if (paragraphId) {
      const candidates = paragraphs.filter(paragraph =>
        normalizeEvidenceIdentity(paragraph?.paragraphId) === paragraphId &&
        (!sourceKey || normalizeEvidenceIdentity(paragraph?.sourceKey) === sourceKey) &&
        (!textHash || normalizeEvidenceIdentity(paragraph?.textHash).toLowerCase() === textHash) &&
        quoteMatches(paragraph)
      );
      const result = verifyUniqueCandidates(candidates, snapshot, {
        matchMethod: 'paragraph-id',
        reason: candidates.length > 1 ? 'PARAGRAPH_ID_MATCHED_MULTIPLE_LOCATIONS' : '',
        quote,
        revisionChanged
      });
      if (result) return result;
    }

    if (sourceKey && textHash) {
      const candidates = paragraphs.filter(paragraph =>
        normalizeEvidenceIdentity(paragraph?.sourceKey) === sourceKey &&
        normalizeEvidenceIdentity(paragraph?.textHash).toLowerCase() === textHash &&
        quoteMatches(paragraph)
      );
      const result = verifyUniqueCandidates(candidates, snapshot, {
        matchMethod: 'source-key-text-hash',
        reason: candidates.length > 1
          ? 'SOURCE_KEY_TEXT_HASH_MATCHED_MULTIPLE_LOCATIONS' : '',
        quote,
        revisionChanged
      });
      if (result) return result;
    }

    if (quote) {
      const exactMatches = [];
      paragraphs.forEach(paragraph => {
        const count = countCanonicalTextMatches(paragraph?.text, quote);
        for (let index = 0; index < count; index += 1) exactMatches.push(paragraph);
      });
      if (exactMatches.length === 1) {
        return verificationResult('verified', snapshot, {
          candidates: exactMatches,
          matchMethod: 'unique-quote',
          quote,
          revisionChanged
        });
      }
      if (exactMatches.length > 1) {
        return verificationResult('ambiguous', snapshot, {
          candidates: exactMatches,
          reason: 'QUOTE_MATCHED_MULTIPLE_LOCATIONS',
          matchMethod: 'unique-quote',
          quote,
          revisionChanged
        });
      }

      // Identity-bearing model evidence must be grounded by an exact quote;
      // approximate navigation is reserved for legacy quote-only lookups.
      const scopedMatches = (paragraphId || sourceKey || textHash) ? [] : paragraphs.filter(paragraph =>
        sectionsOverlap(evidence, paragraph) &&
        tolerantQuoteSimilarity(paragraph?.text, quote) >= 0.82
      );
      if (scopedMatches.length === 1) {
        return verificationResult('verified', snapshot, {
          candidates: scopedMatches,
          matchMethod: 'section-tolerant-quote',
          quote,
          revisionChanged
        });
      }
      if (scopedMatches.length > 1) {
        return verificationResult('ambiguous', snapshot, {
          candidates: scopedMatches,
          reason: 'TOLERANT_QUOTE_MATCHED_MULTIPLE_LOCATIONS',
          matchMethod: 'section-tolerant-quote',
          quote,
          revisionChanged
        });
      }
    }

    return verificationResult(revisionChanged ? 'stale' : 'missing', snapshot, {
      reason: revisionChanged ? 'DOCUMENT_REVISION_CHANGED' : 'EVIDENCE_NOT_FOUND',
      revisionChanged
    });
  }

  // Explicit revalidation is separate from migration: never rewrite a stored
  // generation to make it pass the original strict migration gate.
  function revalidatePdfNoteSourceEvidence(value, semanticContext) {
    const record = safeDataRecord(value);
    const preservedLocator = normalizePdfSemanticEvidenceLocator(descriptorValue(record, 'locator'));
    const context = normalizePdfSemanticMigrationContext(semanticContext);
    if (!preservedLocator || !context) return pdfMigrationResult({ status: 'invalid', preservedLocator,
      degradedReasonCode: 'PDF_EVIDENCE_INVALID' });
    if (preservedLocator.documentId !== context.documentId || preservedLocator.documentHash !== context.documentHash) {
      return pdfMigrationResult({ status: 'stale', preservedLocator, degradedReasonCode: 'PDF_DOCUMENT_CHANGED' });
    }
    const candidates = currentQuoteCandidates(context, preservedLocator.expectedNormalizedQuote);
    if (candidates.length !== 1 || !candidates[0]) return pdfMigrationResult({
      status: candidates.length > 1 ? 'ambiguous' : 'missing', preservedLocator,
      degradedReasonCode: candidates.length > 1 ? 'PDF_SEMANTIC_QUOTE_AMBIGUOUS' : 'PDF_SEMANTIC_REBIND_NOT_FOUND' });
    const paragraph = context.paragraphs.find(item => item.paragraphId === candidates[0].paragraphId);
    const pageAnchor = paragraph?.legacyParagraphIds?.length === 1
      ? normalizePdfPageAnchor(undefined, paragraph.legacyParagraphIds[0]) : null;
    return pdfMigrationResult({ status: 'verified', precision: 'normalized-exact', rebound: true,
      locator: candidates[0], preservedLocator, pageAnchor });
  }

  async function focusPdfNoteSourceWhenReady(input, {
    getDocumentBinding, getSemanticContext, focus,
    now = () => Date.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
    maxWaitMs = 1500
  } = {}) {
    const failure = reasonCode => Object.freeze({ focused: false, focusedGranularity: 'none',
      precision: 'none', reasonCode, revalidationAttempted: false });
    const liveInitial = getDocumentBinding?.();
    const initial = liveInitial ? { documentId: liveInitial.documentId,
      documentHash: liveInitial.documentHash, documentGeneration: liveInitial.documentGeneration } : null;
    if (!initial?.documentId || !initial.documentHash || !positiveSafeInteger(initial.documentGeneration)) {
      return failure('PDF_SEMANTIC_UNAVAILABLE');
    }
    const original = normalizePdfSemanticEvidenceLocator(descriptorValue(safeDataRecord(input), 'locator'));
    if (original && (original.documentId !== initial.documentId || original.documentHash !== initial.documentHash)) {
      return failure('PDF_DOCUMENT_CHANGED');
    }
    const current = () => {
      const binding = getDocumentBinding?.();
      return binding?.documentId === initial.documentId && binding?.documentHash === initial.documentHash &&
        binding?.documentGeneration === initial.documentGeneration;
    };
    const duration = Math.min(2000, Math.max(0, Number(maxWaitMs) || 0));
    const deadline = now() + duration;
    let context = null;
    // A second hard bound prevents a bad clock/wait implementation from looping.
    for (let attempt = 0; attempt <= Math.ceil(duration / 100); attempt++) {
      if (!current()) return failure('PDF_FOCUS_CONTEXT_CHANGED');
      context = normalizePdfSemanticMigrationContext(getSemanticContext?.());
      if (context) break;
      if (!original || now() >= deadline || attempt === Math.ceil(duration / 100)) break;
      await wait(Math.min(100, Math.max(0, deadline - now())));
    }
    if (!context) return failure('PDF_SEMANTIC_INDEX_NOT_READY');
    if (!current() || context.documentId !== initial.documentId || context.documentHash !== initial.documentHash ||
        context.documentGeneration !== initial.documentGeneration) return failure('PDF_FOCUS_CONTEXT_CHANGED');
    const semanticIsCurrent = () => {
      const next = getSemanticContext?.();
      return current() && next?.documentId === context.documentId && next?.documentHash === context.documentHash &&
        next?.documentGeneration === context.documentGeneration && next?.revision === context.revision &&
        next?.semanticCacheKey === context.semanticCacheKey && next?.semanticProvenanceKey === context.semanticProvenanceKey;
    };
    let target = input;
    let revalidationAttempted = false;
    if (original && original.documentGeneration !== context.documentGeneration) {
      revalidationAttempted = true;
      const revalidated = revalidatePdfNoteSourceEvidence({ locator: original }, context);
      if (revalidated.status !== 'verified') return Object.freeze({ ...failure(revalidated.degradedReasonCode),
        revalidationAttempted, migrationStatus: revalidated.status });
      target = { locator: revalidated.locator, ...(revalidated.pageAnchor ? { pageAnchor: revalidated.pageAnchor } : {}) };
    }
    if (!semanticIsCurrent()) return failure('PDF_FOCUS_CONTEXT_CHANGED');
    const result = await focus(target);
    if (!semanticIsCurrent()) return failure('PDF_FOCUS_CONTEXT_CHANGED');
    return Object.freeze({ ...result, revalidationAttempted, rebound: revalidationAttempted || result?.rebound === true });
  }

  return {
    buildQuoteTextIndex,
    normalizeQuoteTextCanonical,
    extractQuoteTextTokens,
    findCanonicalTextMatchStart,
    countCanonicalTextMatches,
    findCanonicalQuoteSourceSpan,
    verifyArticleChatEvidence,
    normalizePdfSemanticEvidenceLocator,
    migratePdfArticleChatEvidence,
    revalidatePdfNoteSourceEvidence,
    focusPdfNoteSourceWhenReady
  };
});
