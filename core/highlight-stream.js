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

  function normalizeQuote(value, defaultIndex) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw streamError('INVALID_RESPONSE', 'Highlight quote must be an object');
    }
    const paragraphIndex = Number(value.i ?? defaultIndex);
    const quote = normalizedText(value.x, 6000);
    const role = normalizedText(value.r || 'statement', 80);
    if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0 || !quote || !role) {
      throw streamError('INVALID_RESPONSE', 'Highlight quote is incomplete');
    }
    return { paragraphIndex, quote, role };
  }

  function normalizeAnnotation(value, paragraphIndex, categoryCodeMap) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw streamError('INVALID_RESPONSE', 'Highlight annotation must be an object');
    }
    const categoryCode = normalizedText(value.c, 24);
    const categoryId = normalizedText(categoryCodeMap?.[categoryCode], 120);
    if (!categoryCode || !categoryId) {
      throw streamError('INVALID_RESPONSE', 'Highlight category code is not requested');
    }
    const displayQuotes = (Array.isArray(value.d) ? value.d : [])
      .slice(0, 16).map(item => normalizeQuote(item, paragraphIndex));
    const supportQuotes = (Array.isArray(value.s) ? value.s : [])
      .slice(0, 24).map(item => normalizeQuote(item, paragraphIndex));
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
            item, paragraphIndex, categoryCodeMap
          ));
        const record = { type: 'paragraph', paragraphIndex, annotations };
        if (!records.has(paragraphIndex)) {
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

    function processLine(line) {
      const text = String(line || '').trim();
      if (!text || /^```(?:jsonl?|ndjson)?\s*$/i.test(text) || text === '```') return null;
      let value;
      try { value = JSON.parse(text); } catch {
        throw streamError('INVALID_RESPONSE', 'Highlight stream line is malformed JSON');
      }
      return processRecord(value);
    }

    return {
      push(value) {
        buffer += String(value || '');
        if (buffer.length > maximumBufferChars) {
          throw streamError('INVALID_RESPONSE', 'Highlight NDJSON buffer exceeded its limit');
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
          processLine(pending);
          return true;
        } catch (error) {
          if (error?.code === 'INVALID_RESPONSE') return false;
          throw error;
        }
      },
      discardPending() {
        const discarded = buffer.length;
        buffer = '';
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
