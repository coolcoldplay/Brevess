(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function streamError(code, message, details = {}) {
    return Object.assign(new Error(message || code || 'Highlight stream failed'), {
      code: code || 'INVALID_RESPONSE',
      retryable: details.retryable === true,
      ...details
    });
  }

  function normalizedText(value, maximum = 12000) {
    return String(value || '').normalize('NFC').replace(/\0/g, '').trim().slice(0, maximum);
  }

  function normalizeQuote(value, defaultIndex, sentenceQuoteMap = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw streamError('INVALID_RESPONSE', 'Highlight quote must be an object');
    }
    const paragraphIndex = Number(value.i ?? defaultIndex);
    const sentenceKey = `${paragraphIndex}:${Number(value.j)}`;
    const hasSentence = value.j !== undefined;
    const sentence = hasSentence && Number.isInteger(Number(value.j)) &&
      Object.prototype.hasOwnProperty.call(sentenceQuoteMap, sentenceKey) ? sentenceQuoteMap[sentenceKey] : '';
    if (hasSentence && (!sentence || (value.x && !sentence.includes(String(value.x))))) {
      throw streamError('INVALID_RESPONSE', 'Highlight sentence reference is invalid');
    }
    const quote = normalizedText(value.x || sentence, 6000);
    const role = normalizedText(value.r || 'statement', 80);
    if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0 || !quote || !role) {
      throw streamError('INVALID_RESPONSE', 'Highlight quote is incomplete');
    }
    return { paragraphIndex, quote, role };
  }

  function normalizeAnnotation(value, paragraphIndex, categoryCodeMap, sentenceQuoteMap) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw streamError('INVALID_RESPONSE', 'Highlight annotation must be an object');
    }
    const categoryCode = normalizedText(value.c, 24);
    const categoryId = normalizedText(categoryCodeMap?.[categoryCode], 120);
    if (!categoryCode || !categoryId) {
      throw streamError('INVALID_RESPONSE', 'Highlight category code is not requested');
    }
    const displayQuotes = (Array.isArray(value.d) ? value.d : [])
      .slice(0, 16).map(item => normalizeQuote(item, paragraphIndex, sentenceQuoteMap));
    const supportQuotes = (Array.isArray(value.s) ? value.s : [])
      .slice(0, 24).map(item => normalizeQuote(item, paragraphIndex, sentenceQuoteMap));
    if (!displayQuotes.length) {
      throw streamError('INVALID_RESPONSE', 'Highlight annotation has no display span');
    }
    const slots = value.sl && typeof value.sl === 'object' && !Array.isArray(value.sl)
      ? Object.entries(value.sl).slice(0, 24).map(([name, slotValue]) => ({
        name: normalizedText(name, 80), value: normalizedText(slotValue, 1200)
      })).filter(item => item.name && item.value)
      : [];
    return {
      categoryCode,
      categoryId,
      provenance: ['current', 'prior', 'interpretation'].includes(value.prov)
        ? value.prov : 'current',
      displayQuotes,
      supportQuotes,
      slots,
      needsContext: value.need === true
    };
  }

  function createHighlightNdjsonParser(options = {}) {
    const categoryCodeMap = options.categoryCodeMap || {};
    const allowedIndices = new Set((Array.isArray(options.pendingIndices)
      ? options.pendingIndices : []).map(Number).filter(Number.isInteger));
    const records = new Map();
    const needs = [];
    const maximumBufferChars = Math.max(
      4096, Math.min(1024 * 1024, Number(options.maximumBufferChars) || 256 * 1024)
    );
    let buffer = '';
    let final = null;
    let cursor = 0;
    let objectStart = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    function processRecord(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw streamError('INVALID_RESPONSE', 'Highlight stream record must be an object');
      }
      if (value.t === 'p') {
        const paragraphIndex = Number(value.i);
        if (!Number.isInteger(paragraphIndex) || !allowedIndices.has(paragraphIndex)) {
          throw streamError('INVALID_RESPONSE', 'Highlight paragraph index is unexpected');
        }
        const annotations = (Array.isArray(value.a) ? value.a : [])
          .slice(0, 96).map(item => normalizeAnnotation(
            item, paragraphIndex, categoryCodeMap, options.sentenceQuoteMap
          ));
        const prior = records.get(paragraphIndex);
        const seen = new Set((prior?.annotations || []).map(item => JSON.stringify(item)));
        const merged = [...(prior?.annotations || [])];
        annotations.forEach(item => {
          const key = JSON.stringify(item);
          if (!seen.has(key)) { seen.add(key); merged.push(item); }
        });
        const record = { type: 'paragraph', paragraphIndex, annotations: merged };
        // Some models emit one paragraph record per claim. Retain all distinct
        // grounded claims and checkpoint the cumulative record instead of silently dropping later lines.
        if (!prior || merged.length > prior.annotations.length) {
          records.set(paragraphIndex, record);
          try { options.onParagraph?.(record); } catch { /* Progress callbacks are isolated. */ }
        }
        return record;
      }
      if (value.t === 'need') {
        const paragraphIndex = Number(value.i);
        const categoryCode = normalizedText(value.c, 24);
        if (!Number.isInteger(paragraphIndex) || !allowedIndices.has(paragraphIndex) ||
            !categoryCodeMap[categoryCode]) {
          throw streamError('INVALID_RESPONSE', 'Highlight context request is invalid');
        }
        const record = {
          type: 'need', paragraphIndex,
          categoryId: categoryCodeMap[categoryCode],
          terms: (Array.isArray(value.terms) ? value.terms : [])
            .slice(0, 12).map(item => normalizedText(item, 120)).filter(Boolean)
        };
        needs.push(record);
        try { options.onNeed?.(record); } catch { /* Progress callbacks are isolated. */ }
        return record;
      }
      if (value.t === 'final') {
        final = {
          type: 'final', count: Math.max(0, Math.floor(Number(value.n) || 0))
        };
        return final;
      }
      throw streamError('INVALID_RESPONSE', 'Highlight stream record type is unsupported');
    }

    function resetFrame() {
      cursor = 0; objectStart = -1; depth = 0; inString = false; escaped = false;
    }

    function drain() {
      // Frame complete objects independently of transport chunks and physical
      // lines. Only tolerate outer separators; never repair evidence or JSON
      // inside a record. Earlier validated paragraph checkpoints survive errors.
      while (cursor < buffer.length) {
        const char = buffer[cursor];
        if (objectStart < 0) {
          if (/[\s,\[\]]/.test(char)) { cursor++; continue; }
          if (char === '`') {
            const end = buffer.indexOf('\n', cursor);
            if (end < 0) return;
            if (!/^```(?:jsonl?|ndjson)?\s*$/i.test(buffer.slice(cursor, end).trim())) {
              throw streamError('INVALID_RESPONSE', 'Highlight stream contains unexpected text');
            }
            cursor = end + 1; continue;
          }
          if (char !== '{') throw streamError('INVALID_RESPONSE', 'Highlight stream contains unexpected text');
          objectStart = cursor; depth = 1; cursor++; continue;
        }
        if (inString) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') inString = false;
        } else if (char === '"') inString = true;
        else if (char === '{') depth++;
        else if (char === '}') depth--;
        cursor++;
        if (!depth) {
          const text = buffer.slice(objectStart, cursor);
          buffer = buffer.slice(cursor);
          resetFrame();
          let value;
          try { value = JSON.parse(text); } catch {
            throw streamError('INVALID_RESPONSE', 'Highlight stream line is malformed JSON');
          }
          processRecord(value);
        }
      }
      if (objectStart < 0) { buffer = ''; resetFrame(); }
    }

    return {
      push(value) {
        buffer += String(value || '');
        if (buffer.length > maximumBufferChars) {
          throw streamError('INVALID_RESPONSE', 'Highlight NDJSON buffer exceeded its limit');
        }
        drain();
      },
      finish() {
        try {
          drain();
          const remaining = objectStart < 0 ? buffer.slice(cursor).trim() : buffer.trim();
          return !remaining || (objectStart < 0 && /^```\s*$/.test(remaining));
        } catch (error) {
          if (error?.code === 'INVALID_RESPONSE') return false;
          throw error;
        } finally {
          buffer = ''; resetFrame();
        }
      },
      discardPending() {
        const discarded = buffer.length;
        buffer = ''; resetFrame();
        return discarded;
      },
      snapshot() {
        return {
          records: [...records.values()].sort((left, right) =>
            left.paragraphIndex - right.paragraphIndex),
          needs: [...needs],
          final: final ? { ...final } : null,
          pendingCharacters: buffer.length
        };
      }
    };
  }

  function providerStreamEventError(event) {
    const value = event?.error || event || {};
    return streamError(
      normalizedText(value.code, 80) || 'INVALID_RESPONSE',
      normalizedText(value.message, 1000) || 'Provider stream failed',
      {
        retryable: value.retryable === true,
        retryAfterMs: Math.max(0, Number(value.retryAfterMs) || 0),
        suggestedMaxOutputTokens: Number(value.suggestedMaxOutputTokens) || undefined
      }
    );
  }

  return {
    createHighlightNdjsonParser,
    providerStreamEventError
  };
});
