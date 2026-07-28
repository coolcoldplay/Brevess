/*
 * Adapted from llm-for-zotero 3.8.27 at commit
 * f8dbbd863b021368c07efe0f61c67f3503d79bc9 (AGPL-3.0-or-later).
 * See THIRD_PARTY_NOTICES.md for provenance and modifications.
 */
(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const DEFAULT_MIN_BOUNDARY_CHARS = 180;
  const DEFAULT_TARGET_CHARS = 360;
  const DEFAULT_HARD_CAP_CHARS = 800;
  const DEFAULT_MAX_WAIT_MS = 450;

  function scanMarkdown(text) {
    let lineStart = 0;
    let fenceMarker = '';
    let lastBoundary = 0;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] !== '\n') continue;
      const line = text.slice(lineStart, index).replace(/\r$/, '');
      const fence = line.match(/^\s{0,3}(```+|~~~+)/);
      if (fence) {
        const marker = fence[1][0];
        if (!fenceMarker) fenceMarker = marker;
        else if (fenceMarker === marker) fenceMarker = '';
      } else if (!fenceMarker && /^\s*$/.test(line)) {
        lastBoundary = index + 1;
      }
      lineStart = index + 1;
    }
    return { lastBoundary, fenceOpen: Boolean(fenceMarker) };
  }

  function hasIncompleteTable(text) {
    const lines = text.trimEnd().split(/\r?\n/);
    if (lines.length < 2) return false;
    const last = lines.at(-1).trim();
    const previous = lines.at(-2).trim();
    const tableLike = line => line.startsWith('|') || line.endsWith('|');
    const delimiterLike = line => /^\|?\s*:?-{2,}/.test(line);
    return tableLike(previous) && (delimiterLike(last) ? !/\|\s*$/.test(last) : false);
  }

  function canFinalizeMarkdown(text) {
    if (!text) return false;
    const scanned = scanMarkdown(text.endsWith('\n') ? text : `${text}\n`);
    return !scanned.fenceOpen && !hasIncompleteTable(text);
  }

  function createMarkdownBlockStreamCoalescer(options) {
    if (!options || typeof options.onBlock !== 'function') {
      throw new TypeError('onBlock callback is required');
    }
    const minBoundaryChars = options.minBoundaryChars ?? DEFAULT_MIN_BOUNDARY_CHARS;
    const targetChars = options.targetChars ?? DEFAULT_TARGET_CHARS;
    const hardCapChars = options.hardCapChars ?? DEFAULT_HARD_CAP_CHARS;
    const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    const setTimerFn = options.setTimer || ((callback, delayMs) => setTimeout(callback, delayMs));
    const clearTimerFn = options.clearTimer || (timer => clearTimeout(timer));
    let pendingText = '';
    let fullText = '';
    let timer = null;
    let cancelled = false;

    function clearPendingTimer() {
      if (timer === null) return;
      clearTimerFn(timer);
      timer = null;
    }

    function emitPrefix(end, reason) {
      if (end <= 0) return false;
      const block = pendingText.slice(0, end);
      pendingText = pendingText.slice(end);
      clearPendingTimer();
      options.onBlock(block, reason);
      return true;
    }

    function flushComplete(reason) {
      if (!pendingText || cancelled) {
        clearPendingTimer();
        return false;
      }
      const { lastBoundary } = scanMarkdown(pendingText);
      const thresholdReached = lastBoundary >= minBoundaryChars ||
        pendingText.length >= targetChars || pendingText.length >= hardCapChars;
      return lastBoundary > 0 && thresholdReached
        ? emitPrefix(lastBoundary, reason)
        : false;
    }

    function scheduleTimer() {
      if (timer !== null || !pendingText || maxWaitMs <= 0) return;
      timer = setTimerFn(() => {
        timer = null;
        flushComplete('timer');
      }, maxWaitMs);
    }

    return {
      pushText(delta) {
        if (cancelled || !delta) return;
        pendingText += String(delta);
        fullText += String(delta);
        if (!flushComplete('boundary')) scheduleTimer();
      },

      flushNow(reason = 'event') {
        return flushComplete(reason);
      },

      finish() {
        if (cancelled || !pendingText) {
          clearPendingTimer();
          return false;
        }
        flushComplete('boundary');
        if (!pendingText || !canFinalizeMarkdown(pendingText)) {
          clearPendingTimer();
          return false;
        }
        return emitPrefix(pendingText.length, 'final');
      },

      cancel() {
        cancelled = true;
        pendingText = '';
        clearPendingTimer();
      },

      getFullText() {
        return fullText;
      },

      hasPending() {
        return Boolean(pendingText);
      }
    };
  }

  function invalidStreamResponse(message) {
    const error = new Error(message || 'Article chat stream record is invalid');
    error.code = 'INVALID_RESPONSE';
    return error;
  }

  function normalizeValue(value, maximum = 4000) {
    return String(value || '').normalize('NFKC').replace(/\0/g, '').trim().slice(0, maximum);
  }

  function normalizeNarrativeValue(value, maximum = 4000) {
    return String(value || '').normalize('NFC').replace(/\0/g, '').trim().slice(0, maximum);
  }

  function stableFingerprint(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    let result = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      result = Math.imul(result ^ text.charCodeAt(index), 16777619);
    }
    return (result >>> 0).toString(16).padStart(8, '0');
  }

  function markerFollowsAnswerText(markdown, marker) {
    const escaped = String(marker).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\[\\[${escaped}\\]\\]`, 'gu');
    let match;
    while ((match = pattern.exec(markdown)) !== null) {
      const lineStart = markdown.lastIndexOf('\n', Math.max(0, match.index - 1)) + 1;
      const prefix = markdown.slice(lineStart, match.index)
        .replace(/[`*_>#|\[\]()~\\-]/g, '').trim();
      if (/[\p{L}\p{N}]/u.test(prefix)) return true;
    }
    return false;
  }

  function normalizeAnswerEvidence(value, snapshot) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw invalidStreamResponse('Article chat evidence must be an object');
    }
    const marker = normalizeValue(value.marker, 12).replace(/^\[\[|\]\]$/g, '');
    if (!/^\d{1,3}$/.test(marker)) {
      throw invalidStreamResponse('Article chat evidence marker is invalid');
    }
    const evidence = {
      marker,
      paragraphId: normalizeValue(value.paragraph_id || value.paragraphId, 160),
      sourceKey: normalizeValue(value.source_key || value.sourceKey, 160),
      textHash: normalizeValue(value.text_hash || value.textHash, 160),
      quote: normalizeNarrativeValue(value.quote, 2400),
      sectionPath: (Array.isArray(value.section_path || value.sectionPath)
        ? value.section_path || value.sectionPath : [])
        .slice(-12).map(item => normalizeValue(
          typeof item === 'string' ? item : item?.title, 300
        )).filter(Boolean),
      sectionTitle: normalizeValue(value.section_title || value.sectionTitle, 300),
      documentRevision: Number(snapshot?.revision) || 0
    };
    const verification = typeof shared.verifyArticleChatEvidence === 'function'
      ? shared.verifyArticleChatEvidence(evidence, snapshot)
      : { status: 'missing', candidateCount: 0, reason: 'VERIFIER_UNAVAILABLE', target: null };
    return { ...evidence, verification };
  }

  function validateArticleChatAnswerBlock(value, snapshot) {
    const blockId = normalizeValue(value?.block_id || value?.blockId, 160);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/.test(blockId)) {
      throw invalidStreamResponse('Article chat block id is invalid');
    }
    const markdown = normalizeNarrativeValue(value?.markdown, 64 * 1024);
    if (!markdown || !canFinalizeMarkdown(markdown)) {
      throw invalidStreamResponse('Article chat block contains incomplete Markdown');
    }
    const evidence = (Array.isArray(value?.evidence) ? value.evidence : [])
      .slice(0, 24).map(item => normalizeAnswerEvidence(item, snapshot));
    const evidenceMarkers = new Set(evidence.map(item => item.marker));
    if (evidenceMarkers.size !== evidence.length) {
      throw invalidStreamResponse('Article chat evidence markers must be unique inside a block');
    }
    const markdownMarkers = new Set(
      [...markdown.matchAll(/\[\[(\d{1,3})\]\]/g)].map(match => match[1])
    );
    if ([...markdownMarkers].some(marker => !evidenceMarkers.has(marker)) ||
        evidence.some(item => !markdownMarkers.has(item.marker))) {
      throw invalidStreamResponse('Article chat evidence markers do not match the block');
    }
    if (evidence.some(item => !markerFollowsAnswerText(markdown, item.marker))) {
      throw invalidStreamResponse('Article chat evidence marker is not placed after answer text');
    }
    return { type: 'answer_block', blockId, markdown, evidence };
  }

  function createArticleChatNdjsonParser(options = {}) {
    const snapshot = options.snapshot || { revision: 0, paragraphs: [] };
    const maximumBufferChars = Math.max(
      4096, Math.min(1024 * 1024, Number(options.maximumBufferChars) || 256 * 1024)
    );
    const blocks = [];
    const blockIds = new Set();
    const blockFingerprints = new Set();
    let buffer = '';
    let summary = '';
    let final = null;
    let usage = null;

    function emit(record) {
      try { options.onRecord?.(record); } catch { /* UI progress must not break parsing. */ }
    }

    function processRecord(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw invalidStreamResponse();
      }
      if (value.type === 'answer_block') {
        const block = validateArticleChatAnswerBlock(value, snapshot);
        const fingerprint = stableFingerprint([
          block.markdown,
          block.evidence.map(item => [
            item.marker, item.paragraphId, item.sourceKey, item.textHash, item.quote
          ])
        ]);
        if (blockIds.has(block.blockId) || blockFingerprints.has(fingerprint)) return null;
        blockIds.add(block.blockId);
        blockFingerprints.add(fingerprint);
        blocks.push(block);
        try { options.onBlock?.(block); } catch { /* UI progress must not break parsing. */ }
        emit(block);
        return block;
      }
      if (value.type === 'turn_summary') {
        const normalized = normalizeNarrativeValue(value.summary, 2000);
        if (!normalized) throw invalidStreamResponse('Article chat turn summary is empty');
        summary = normalized;
        const record = { type: 'turn_summary', summary };
        emit(record);
        return record;
      }
      if (value.type === 'usage') {
        usage = {
          inputTokens: Math.max(0, Number(value.input_tokens || value.inputTokens) || 0),
          outputTokens: Math.max(0, Number(value.output_tokens || value.outputTokens) || 0),
          cacheHitTokens: Math.max(0, Number(value.cache_hit_tokens || value.cacheHitTokens) || 0)
        };
        const record = { type: 'usage', usage };
        emit(record);
        return record;
      }
      if (value.type === 'final') {
        const status = value.status === 'truncated' ? 'truncated' : 'completed';
        final = { type: 'final', status };
        emit(final);
        return final;
      }
      throw invalidStreamResponse('Article chat stream record type is unsupported');
    }

    function processLine(line) {
      const text = String(line || '').trim();
      if (!text) return null;
      if (/^```(?:jsonl?|ndjson)?\s*$/i.test(text) || text === '```') return null;
      let value;
      try { value = JSON.parse(text); } catch {
        throw invalidStreamResponse('Article chat stream line is malformed JSON');
      }
      return processRecord(value);
    }

    return {
      push(value) {
        buffer += String(value || '');
        if (buffer.length > maximumBufferChars) {
          throw invalidStreamResponse('Article chat NDJSON buffer exceeded its limit');
        }
        let boundary;
        while ((boundary = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, boundary).replace(/\r$/, '');
          buffer = buffer.slice(boundary + 1);
          processLine(line);
        }
      },
      finish() {
        const pending = buffer.trim();
        buffer = '';
        if (!pending) return true;
        try {
          const value = JSON.parse(pending);
          processRecord(value);
          return true;
        } catch (error) {
          if (error?.code === 'INVALID_RESPONSE') throw error;
          return false;
        }
      },
      discardPending() {
        const discarded = buffer.length;
        buffer = '';
        return discarded;
      },
      clearFinalRecord() {
        final = null;
      },
      hasPending() { return Boolean(buffer); },
      snapshot() {
        return {
          blocks: blocks.map(block => ({
            ...block,
            evidence: block.evidence.map(item => ({
              ...item,
              sectionPath: [...item.sectionPath],
              verification: { ...item.verification }
            }))
          })),
          summary,
          usage: usage ? { ...usage } : null,
          final: final ? { ...final } : null,
          pendingCharacters: buffer.length
        };
      }
    };
  }

  return {
    createMarkdownBlockStreamCoalescer,
    createBlockStreamCoalescer: createMarkdownBlockStreamCoalescer,
    validateArticleChatAnswerBlock,
    createArticleChatNdjsonParser
  };
});
