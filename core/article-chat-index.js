(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const DEFAULT_MIN_CHARS = 1500;
  const DEFAULT_TARGET_CHARS = 2000;
  const DEFAULT_MAX_CHARS = 2500;

  function hash(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    let first = 2166136261;
    let second = 2166136261 ^ 0x9e3779b9;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ code, 2246822519);
    }
    return `${(first >>> 0).toString(16).padStart(8, '0')}` +
      `${(second >>> 0).toString(16).padStart(8, '0')}`;
  }

  function normalize(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function chooseTextBoundary(text, start, targetChars, minChars, maxChars) {
    const remaining = text.length - start;
    if (remaining <= maxChars) return text.length;
    const minimumEnd = Math.min(text.length, start + minChars);
    const targetEnd = Math.min(text.length, start + targetChars);
    const maximumEnd = Math.min(text.length, start + maxChars);
    const window = text.slice(minimumEnd, maximumEnd);
    const boundaries = [];
    for (const match of window.matchAll(/[.!?。！？](?:\s+|$)/gu)) {
      boundaries.push(minimumEnd + (match.index || 0) + match[0].length);
    }
    if (boundaries.length) {
      return boundaries.reduce((best, candidate) =>
        Math.abs(candidate - targetEnd) < Math.abs(best - targetEnd) ? candidate : best
      );
    }
    const whitespace = text.lastIndexOf(' ', maximumEnd);
    return whitespace >= minimumEnd ? whitespace + 1 : maximumEnd;
  }

  function recordUnits(record, options) {
    const text = String(record?.text || '');
    if (!text) return [];
    const units = [];
    let sourceStart = 0;
    while (sourceStart < text.length) {
      const sourceEnd = chooseTextBoundary(
        text, sourceStart, options.targetChars, options.minChars, options.maxChars
      );
      if (sourceEnd <= sourceStart) break;
      units.push({
        text: text.slice(sourceStart, sourceEnd).trim(),
        paragraphId: normalize(record.paragraphId),
        sourceKey: normalize(record.sourceKey || record.paragraphId),
        sourceIdentity: normalize(record.sourceIdentity || record.sourceKey || record.paragraphId),
        textHash: normalize(record.textHash || hash(text)),
        sourceStart,
        sourceEnd,
        recordType: normalize(record.recordType || 'body'),
        sectionId: normalize(record.sectionId),
        sectionTitle: normalize(record.sectionTitle),
        sectionKind: normalize(record.sectionKind || 'article'),
        headingPath: (Array.isArray(record.headingPath) ? record.headingPath : [])
          .map(item => ({
            level: Math.max(1, Number(item?.level) || 2),
            sectionId: normalize(item?.sectionId),
            title: normalize(item?.title)
          }))
      });
      sourceStart = sourceEnd;
    }
    return units.filter(unit => unit.text);
  }

  function sameChunkGroup(left, right) {
    return left && right && left.recordType === right.recordType &&
      left.sectionId === right.sectionId && left.sectionTitle === right.sectionTitle;
  }

  function makeChunk(units, position) {
    const text = units.map(unit => unit.text).join('\n\n');
    const first = units[0];
    const tokens = typeof shared.tokenizeRetrievalText === 'function'
      ? shared.tokenizeRetrievalText(`${first.sectionTitle} ${text}`, {
        fallbackToUnfilteredIfEmpty: true
      })
      : normalize(`${first.sectionTitle} ${text}`).toLowerCase().split(/\s+/);
    const termFrequencies = {};
    tokens.forEach(token => { termFrequencies[token] = (termFrequencies[token] || 0) + 1; });
    const sourceSpans = units.map(unit => ({
      paragraphId: unit.paragraphId,
      sourceKey: unit.sourceKey,
      sourceIdentity: unit.sourceIdentity,
      textHash: unit.textHash,
      sourceStart: unit.sourceStart,
      sourceEnd: unit.sourceEnd
    }));
    let chunkCursor = 0;
    const sourceSpanRanges = units.map((unit, index) => {
      if (index) chunkCursor += 2;
      const chunkStart = chunkCursor;
      chunkCursor += unit.text.length;
      return { chunkStart, chunkEnd: chunkCursor };
    });
    const paragraphIds = [...new Set(units.map(unit => unit.paragraphId).filter(Boolean))];
    const sourceKeys = [...new Set(units.map(unit => unit.sourceKey).filter(Boolean))];
    const chunkIdentity = hash([
      first.recordType, first.sectionId, first.sectionTitle,
      sourceSpans.map(span => [span.sourceIdentity, span.textHash, span.sourceStart, span.sourceEnd])
    ]);
    return {
      chunkId: `article-chat-chunk-${chunkIdentity}`,
      position,
      recordType: first.recordType,
      sectionId: first.sectionId,
      sectionTitle: first.sectionTitle,
      sectionKind: first.sectionKind,
      headingPath: first.headingPath,
      paragraphIds,
      sourceKeys,
      sourceSpans,
      sourceSpanRanges,
      text,
      textHash: hash(text),
      tokens,
      termFrequencies,
      tokenCount: tokens.length,
      characterCount: text.length
    };
  }

  function buildArticleChatIndex(snapshot = {}, inputOptions = {}) {
    if (typeof shared.tokenizeRetrievalText !== 'function') {
      throw new Error('article-chat-tokenizer must be loaded before article-chat-index');
    }
    const minChars = Math.max(40, Number(inputOptions.minChars) || DEFAULT_MIN_CHARS);
    const targetChars = Math.max(minChars, Number(inputOptions.targetChars) || DEFAULT_TARGET_CHARS);
    const maxChars = Math.max(targetChars, Number(inputOptions.maxChars) || DEFAULT_MAX_CHARS);
    const sourceRecords = Array.isArray(snapshot.typedRecords)
      ? snapshot.typedRecords
      : (Array.isArray(snapshot.paragraphs) ? snapshot.paragraphs : []);
    const units = sourceRecords.flatMap(record => recordUnits(record, {
      minChars, targetChars, maxChars
    }));
    const chunks = [];
    let current = [];
    let currentChars = 0;

    function flush() {
      if (!current.length) return;
      chunks.push(makeChunk(current, chunks.length));
      current = [];
      currentChars = 0;
    }

    for (const unit of units) {
      const separatorCost = current.length ? 2 : 0;
      if (current.length && (!sameChunkGroup(current[0], unit) ||
          currentChars + separatorCost + unit.text.length > maxChars ||
          currentChars >= targetChars)) {
        flush();
      }
      current.push(unit);
      currentChars += (current.length > 1 ? 2 : 0) + unit.text.length;
      if (currentChars >= targetChars) flush();
    }
    flush();

    const documentFrequencies = {};
    chunks.forEach(chunk => {
      new Set(chunk.tokens).forEach(token => {
        documentFrequencies[token] = (documentFrequencies[token] || 0) + 1;
      });
    });
    const documentHash = normalize(snapshot.documentHash || String(snapshot.key || '').split(':')[0]);
    const revision = Math.max(1, Number(snapshot.revision) || 1);
    const index = {
      version: 1,
      indexId: `article-chat-index-${hash([
        documentHash, revision, chunks.map(chunk => chunk.chunkId)
      ])}`,
      snapshotKey: normalize(snapshot.key || `${documentHash}:${revision}`),
      documentHash,
      revision,
      chunks,
      documentFrequencies,
      averageDocumentLength: chunks.length
        ? chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0) / chunks.length
        : 0,
      diagnostics: {
        sourceRecordCount: sourceRecords.length,
        chunkCount: chunks.length,
        bodyChunkCount: chunks.filter(chunk => chunk.recordType === 'body').length,
        figureCaptionChunkCount: chunks.filter(chunk => chunk.recordType === 'figure-caption').length,
        tableCaptionChunkCount: chunks.filter(chunk => chunk.recordType === 'table-caption').length,
        referenceChunkCount: chunks.filter(chunk => chunk.recordType === 'reference').length,
        characterCount: chunks.reduce((sum, chunk) => sum + chunk.characterCount, 0),
        minChars,
        targetChars,
        maxChars
      }
    };
    return deepFreeze(index);
  }

  return {
    ARTICLE_CHAT_INDEX_CHUNK_LIMITS: Object.freeze({
      minChars: DEFAULT_MIN_CHARS,
      targetChars: DEFAULT_TARGET_CHARS,
      maxChars: DEFAULT_MAX_CHARS
    }),
    buildArticleChatIndex
  };
});
