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
  const STOPWORDS = new Set([
    'an', 'as', 'at', 'by', 'do', 'he', 'if', 'in', 'is', 'it', 'me', 'my',
    'of', 'on', 'or', 'so', 'to', 'up', 'we', 'al', 'and', 'are', 'the',
    'for', 'but', 'you', 'has', 'had', 'was', 'its', 'can', 'may', 'per',
    'via', 'use', 'who', 'how', 'why', 'all', 'did', 'get', 'got', 'let',
    'our', 'out', 'she', 'too', 'yet', 'about', 'also', 'been', 'being',
    'between', 'could', 'from', 'have', 'into', 'might', 'over', 'such',
    'than', 'that', 'them', 'then', 'their', 'they', 'this', 'under', 'used',
    'using', 'were', 'what', 'when', 'where', 'which', 'whom', 'will',
    'with', 'within', 'would', 'your', 'et'
  ]);
  const PROTECTED_TERM_PATTERN =
    /[\p{L}\p{N}]+(?:[-_./:+#][\p{L}\p{N}]+)+/gu;
  const WORD_PATTERN = /[\p{L}\p{N}]+/gu;
  const WORD_LIKE_PATTERN = /[\p{L}\p{N}]/u;
  const PROTECTED_SPLIT_PATTERN = /[\p{L}\p{N}]+/gu;
  const SCRIPT_RUN_PATTERNS = [
    /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]+/g,
    /[\u3040-\u309F\u30A0-\u30FF]+/g,
    /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]+/g
  ];
  const PLAIN_ASCII_WORD_PATTERN = /^[a-z]+$/;
  const GREEK_SINGLE_LETTER_PATTERN = /^[\u0370-\u03FF]$/u;
  let cachedWordSegmenter;

  function getWordSegmenter() {
    if (cachedWordSegmenter !== undefined) return cachedWordSegmenter;
    if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
      cachedWordSegmenter = null;
      return cachedWordSegmenter;
    }
    try {
      cachedWordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    } catch (_error) {
      cachedWordSegmenter = null;
    }
    return cachedWordSegmenter;
  }

  function normalizeRetrievalText(text) {
    return String(text || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\u00ad/g, '')
      .replace(/[‐‑‒–—−]/g, '-')
      .replace(/[“”„‟]/g, '"')
      .replace(/[‘’‚‛]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function shouldKeepToken(token, filterStopwords) {
    if (!token) return false;
    if (token.length < 2 && !GREEK_SINGLE_LETTER_PATTERN.test(token)) return false;
    return !(filterStopwords && PLAIN_ASCII_WORD_PATTERN.test(token) && STOPWORDS.has(token));
  }

  function collectProtectedTerms(text) {
    const tokens = [];
    let maskedText = '';
    let lastIndex = 0;
    for (const match of text.matchAll(PROTECTED_TERM_PATTERN)) {
      const protectedToken = match[0];
      const start = match.index || 0;
      const end = start + protectedToken.length;
      maskedText += text.slice(lastIndex, start);
      maskedText += ' '.repeat(end - start);
      lastIndex = end;
      tokens.push(protectedToken);
      tokens.push(...(protectedToken.match(PROTECTED_SPLIT_PATTERN) || []));
    }
    maskedText += text.slice(lastIndex);
    return { tokens, maskedText };
  }

  function segmentWordTokens(text) {
    if (!text) return [];
    const segmenter = getWordSegmenter();
    if (!segmenter) return text.match(WORD_PATTERN) || [];
    const tokens = [];
    for (const entry of segmenter.segment(text)) {
      if (entry.isWordLike === false) continue;
      const segment = entry.segment.trim();
      if (segment && WORD_LIKE_PATTERN.test(segment)) tokens.push(segment);
    }
    return tokens;
  }

  function collectScriptBigrams(text) {
    const tokens = [];
    for (const pattern of SCRIPT_RUN_PATTERNS) {
      for (const run of text.match(pattern) || []) {
        const chars = Array.from(run);
        for (let index = 0; index < chars.length - 1; index += 1) {
          tokens.push(chars[index] + chars[index + 1]);
        }
      }
    }
    return tokens;
  }

  function tokenizeRetrievalText(text, options = {}) {
    const normalized = normalizeRetrievalText(text);
    if (!normalized) return [];
    const filterStopwords = options.filterStopwords !== false;
    const { tokens: protectedTokens, maskedText } = collectProtectedTerms(normalized);
    const rawTokens = [
      ...protectedTokens,
      ...segmentWordTokens(maskedText),
      ...collectScriptBigrams(normalized)
    ];
    const filtered = rawTokens.filter(token => shouldKeepToken(token, filterStopwords));
    const tokens = filtered.length || !options.fallbackToUnfilteredIfEmpty
      ? filtered
      : rawTokens.filter(Boolean);
    const maxTokens = Number.isFinite(options.maxTokens)
      ? Math.max(1, Math.floor(options.maxTokens))
      : 0;
    return maxTokens > 0 ? tokens.slice(0, maxTokens) : tokens;
  }

  function tokenizeRetrievalQuery(query, maxTokens) {
    return Array.from(new Set(tokenizeRetrievalText(query, {
      fallbackToUnfilteredIfEmpty: true,
      maxTokens
    })));
  }

  function tokenizeRetrievalDiversity(text) {
    return new Set(tokenizeRetrievalText(text, { maxTokens: 256 }));
  }

  return {
    normalizeRetrievalText,
    tokenizeRetrievalText,
    tokenizeRetrievalQuery,
    tokenizeRetrievalDiversity
  };
});
