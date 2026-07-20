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
    quote = ''
  } = {}) {
    const uniqueCandidate = status === 'verified' && candidates.length === 1
      ? candidates[0] : null;
    return {
      status,
      candidateCount: candidates.length,
      reason,
      matchMethod,
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
    if (evidenceRevision && currentRevision && evidenceRevision !== currentRevision) {
      return verificationResult('stale', snapshot, {
        reason: 'DOCUMENT_REVISION_CHANGED'
      });
    }

    const paragraphId = normalizeEvidenceIdentity(evidence?.paragraphId);
    if (paragraphId) {
      const candidates = paragraphs.filter(paragraph =>
        normalizeEvidenceIdentity(paragraph?.paragraphId) === paragraphId
      );
      const result = verifyUniqueCandidates(candidates, snapshot, {
        matchMethod: 'paragraph-id',
        reason: candidates.length > 1 ? 'PARAGRAPH_ID_MATCHED_MULTIPLE_LOCATIONS' : '',
        quote: evidence?.quote
      });
      if (result) return result;
    }

    const sourceKey = normalizeEvidenceIdentity(evidence?.sourceKey);
    const textHash = normalizeEvidenceIdentity(evidence?.textHash).toLowerCase();
    if (sourceKey && textHash) {
      const candidates = paragraphs.filter(paragraph =>
        normalizeEvidenceIdentity(paragraph?.sourceKey) === sourceKey &&
        normalizeEvidenceIdentity(paragraph?.textHash).toLowerCase() === textHash
      );
      const result = verifyUniqueCandidates(candidates, snapshot, {
        matchMethod: 'source-key-text-hash',
        reason: candidates.length > 1
          ? 'SOURCE_KEY_TEXT_HASH_MATCHED_MULTIPLE_LOCATIONS' : '',
        quote: evidence?.quote
      });
      if (result) return result;
    }

    const quote = normalizeEvidenceIdentity(evidence?.quote || evidence?.support);
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
          quote
        });
      }
      if (exactMatches.length > 1) {
        return verificationResult('ambiguous', snapshot, {
          candidates: exactMatches,
          reason: 'QUOTE_MATCHED_MULTIPLE_LOCATIONS',
          matchMethod: 'unique-quote',
          quote
        });
      }

      const scopedMatches = paragraphs.filter(paragraph =>
        sectionsOverlap(evidence, paragraph) &&
        tolerantQuoteSimilarity(paragraph?.text, quote) >= 0.82
      );
      if (scopedMatches.length === 1) {
        return verificationResult('verified', snapshot, {
          candidates: scopedMatches,
          matchMethod: 'section-tolerant-quote',
          quote
        });
      }
      if (scopedMatches.length > 1) {
        return verificationResult('ambiguous', snapshot, {
          candidates: scopedMatches,
          reason: 'TOLERANT_QUOTE_MATCHED_MULTIPLE_LOCATIONS',
          matchMethod: 'section-tolerant-quote',
          quote
        });
      }
    }

    return verificationResult('missing', snapshot, {
      reason: 'EVIDENCE_NOT_FOUND'
    });
  }

  return {
    buildQuoteTextIndex,
    normalizeQuoteTextCanonical,
    extractQuoteTextTokens,
    findCanonicalTextMatchStart,
    countCanonicalTextMatches,
    findCanonicalQuoteSourceSpan,
    verifyArticleChatEvidence
  };
});
