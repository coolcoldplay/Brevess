(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const LITERATURE_NOTE_SOURCE_LIMITS = Object.freeze({
    maxLength: 12000, maxReferences: 256, maxKnownIds: 256,
    maxIdsPerGroup: 12, maxEdits: 256, maxWork: 200000
  });
  const LIMITS = LITERATURE_NOTE_SOURCE_LIMITS;
  // Recognition is display-only: canonical HTML/PDF IDs remain unverified.
  const CURRENT_ID = /^(?:p-|pdf-paragraph:)[0-9a-f]{16}$/;
  const fail = code => { throw new Error(code); };
  const budget = () => {
    let work = 0;
    return amount => { if ((work += amount) > LIMITS.maxWork) fail('NOTE_SOURCE_LIMIT'); };
  };
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
  }
  function failed(canonicalText, error, displayText = canonicalText) {
    return freeze({ ok: false, error, canonicalText, displayText,
      references: [], tokenRanges: [] });
  }
  function checkText(text) {
    if (typeof text !== 'string') fail('NOTE_TEXT_INVALID');
    if (text.length > LIMITS.maxLength) fail('NOTE_TEXT_TOO_LONG');
  }
  function knownIds(options) {
    const ids = options?.knownSourceIds ?? [];
    if (!Array.isArray(ids) || ids.length > LIMITS.maxKnownIds) fail('NOTE_SOURCE_LIMIT');
    if (ids.some(id => typeof id !== 'string' || !id || id.length > 360 ||
      /[\s\u0000-\u001f\u007f()（）,，、;；`\\<>\[\]]/u.test(id))) fail('NOTE_SOURCE_ID_INVALID');
    return [...new Set(ids)];
  }
  function balancedEnd(text, start, opening, closing, spend) {
    let depth = 1;
    for (let i = start + 1; i < text.length; i += 1) {
      spend(1);
      if (text[i] === '\\') { i += 1; continue; }
      if (text[i] === opening) depth += 1;
      else if (text[i] === closing && --depth === 0) return i + 1;
    }
    return -1;
  }
  function codeLines(text, spend) {
    const mask = new Uint8Array(text.length);
    const referenceLabels = new Set();
    const lines = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
    let fence = null;
    let pendingReferenceDefinition = null;
    let previousQuoteDepth = 0;
    const lists = [];
    let match;
    while ((match = lines.exec(text)) && match[0]) {
      spend(match[0].length);
      let body = match[0].replace(/[\r\n]+$/, '');
      let quoteDepth = 0;
      let quote;
      while ((quote = /^ {0,3}>[ \t]?/.exec(body))) {
        spend(quote[0].length);
        quoteDepth += 1; body = body.slice(quote[0].length);
      }
      if (quoteDepth !== previousQuoteDepth) lists.length = 0;
      previousQuoteDepth = quoteDepth;
      if (fence && fence.quoteDepth !== quoteDepth) fence = null;
      const marker = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(body);
      if (fence) {
        mask.fill(1, match.index, lines.lastIndex);
        if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length &&
            !marker[2].trim()) fence = null;
        continue;
      }
      if (pendingReferenceDefinition !== null) {
        const continued = pendingReferenceDefinition === quoteDepth && body.trim() &&
          !/^[ \t]*(`{3,}|~{3,})/.test(body);
        pendingReferenceDefinition = null;
        if (continued) { mask.fill(1, match.index, lines.lastIndex); continue; }
      }
      if (!body.trim()) continue;
      const leading = /^[ \t]*/.exec(body)[0];
      const indent = leading.replace(/\t/g, '    ').length;
      const item = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(body);
      while (lists.length && (indent < lists[lists.length - 1].indent ||
          (item && indent === lists[lists.length - 1].indent))) lists.pop();
      const parent = lists[lists.length - 1];
      const isList = item && (parent
        ? indent > parent.indent && indent < parent.contentIndent + 4
        : indent < 4);
      let content = body.slice(leading.length);
      let isCode = false;
      if (isList) {
        const contentIndent = indent + item[2].length + item[3].replace(/\t/g, '    ').length;
        lists.push({ indent, contentIndent });
        content = item[4];
      } else {
        spend(lists.length);
        const continuation = [...lists].reverse().find(entry => indent >= entry.contentIndent);
        isCode = indent >= 4 && (!continuation || indent >= continuation.contentIndent + 4);
        if (!isCode && !continuation && !item) lists.length = 0;
      }
      // A list item may itself contain a quoted fence ("- > ```").
      while (!isCode && (quote = /^ {0,3}>[ \t]?/.exec(content))) {
        spend(quote[0].length);
        quoteDepth += 1; content = content.slice(quote[0].length);
      }
      const opening = /^(`{3,}|~{3,})(.*)$/.exec(content);
      const definition = /^\[((?:\\.|[^\]\\])+)\]:/.exec(content);
      if (!isCode && opening) {
        fence = { char: opening[1][0], length: opening[1].length, quoteDepth };
        mask.fill(1, match.index, lines.lastIndex);
      } else if (isCode || definition) {
        mask.fill(1, match.index, lines.lastIndex);
        if (!isCode && definition) {
          referenceLabels.add(referenceLabel(definition[1]));
          if (!content.slice(definition[0].length).trim()) pendingReferenceDefinition = quoteDepth;
        }
      }
    }
    return { mask, referenceLabels };
  }
  function referenceLabel(text) {
    return text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1')
      .trim().replace(/\s+/gu, ' ').toLowerCase();
  }
  // Share the already bounded block lexer with plain-copy formatting. A blank
  // line may split the lightweight formatting AST inside a fenced code block.
  function literatureNoteProtectedBlockRanges(text) {
    try {
      checkText(text);
      const { mask } = codeLines(text, budget());
      const ranges = [];
      for (let index = 0; index < mask.length;) {
        if (!mask[index]) { index += 1; continue; }
        const start = index;
        while (index < mask.length && mask[index]) index += 1;
        ranges.push({ start, end: index });
      }
      return freeze({ ok: true, ranges });
    } catch (error) {
      return freeze({ ok: false, error: error.message });
    }
  }
  function parseReferences(text, ids, spend) {
    const known = new Set(ids);
    const { mask, referenceLabels } = codeLines(text, spend);
    const references = [];
    for (let i = 0; i < text.length;) {
      spend(1);
      if (mask[i]) { i += 1; continue; }
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i] === '`') {
        let n = 1;
        while (text[i + n] === '`') { n += 1; spend(1); }
        let end = i + n;
        const lineEnd = text.slice(end).search(/[\r\n]/);
        const unmatchedEnd = lineEnd < 0 ? text.length : end + lineEnd;
        let found = false;
        while (end < text.length) {
          spend(1);
          // A code span may cross a soft line break, but not a new block.
          if (mask[end] || /^(?:\r\n|\n|\r(?!\n))[ \t]*(?:\r\n|\n|\r(?!\n))/.test(text.slice(end))) break;
          if (text[end] !== '`') { end += 1; continue; }
          let run = 1;
          while (text[end + run] === '`') { run += 1; spend(1); }
          if (run === n) { end += run; found = true; break; }
          end += run;
        }
        i = found ? end : unmatchedEnd; // An unmatched opener protects only its own line.
        if (!found && i === text.length) break;
        continue;
      }
      if (text[i] === '[') {
        const labelEnd = balancedEnd(text, i, '[', ']', spend);
        if (labelEnd > 0 && text[labelEnd] === '(') {
          const end = balancedEnd(text, labelEnd, '(', ')', spend);
          if (end > 0) { i = end; continue; }
        }
        if (labelEnd > 0 && text[labelEnd] === '[') {
          const end = balancedEnd(text, labelEnd, '[', ']', spend);
          if (end > 0) { i = end; continue; }
        }
        if (labelEnd > 0 && referenceLabels.has(referenceLabel(text.slice(i + 1, labelEnd - 1)))) {
          i = labelEnd; continue;
        }
      }
      if (text[i] === '<') {
        const end = text.indexOf('>', i + 1);
        spend((end >= 0 ? end : text.length) - i);
        if (end >= 0) { i = end + 1; continue; }
      }
      if (/[A-Za-z]/.test(text[i]) && !/[A-Za-z0-9+.-]/.test(text[i - 1] || '')) {
        const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(text.slice(i));
        // Scientific construct/fusion names (Thy1::ChR2, BCR::ABL1) are prose,
        // not URI schemes; keep the following claim-local source group visible.
        if (scheme && text[i + scheme[0].length] && text[i + scheme[0].length] !== ':' &&
            !/\s/u.test(text[i + scheme[0].length])) {
          spend(scheme[0].length); i += scheme[0].length;
          while (i < text.length && !/[\s<>"'`]/u.test(text[i])) { spend(1); i += 1; }
          continue;
        }
      }
      if (text[i] !== '(' && text[i] !== '（') { i += 1; continue; }
      const closing = text[i] === '(' ? ')' : '）';
      const end = balancedEnd(text, i, text[i], closing, spend);
      if (end < 0) { i += 1; continue; }
      const body = text.slice(i + 1, end - 1);
      spend(body.length);
      const sourceIds = body.trim().split(/[ \t\r\n]*[、,，][ \t\r\n]*/);
      if (sourceIds.length && sourceIds.every(id => CURRENT_ID.test(id) || known.has(id))) {
        if (sourceIds.length > LIMITS.maxIdsPerGroup || references.length >= LIMITS.maxReferences) {
          fail('NOTE_SOURCE_LIMIT');
        }
        references.push({ canonicalStart: i, canonicalEnd: end,
          raw: text.slice(i, end), sourceIds });
      }
      i = end;
    }
    return references;
  }
  function delimiterPair(text, spend) {
    for (let n = 1; n <= 16; n += 1) {
      spend(text.length * 2);
      const open = `${'⟦'.repeat(n)}引文 `; const close = '⟧'.repeat(n);
      if (!text.includes(open) && !text.includes(close)) return { open, close };
    }
    fail('NOTE_SOURCE_MARKER_COLLISION');
  }
  // Display registry is outside fieldEvidence/locators and never used for focus.
  function createLiteratureNoteSourceNumberRegistry({ template, values = {}, fieldEvidence = {} } = {}) {
    try {
      if (!Array.isArray(template?.fields) || template.fields.length > LIMITS.maxKnownIds) fail('NOTE_SOURCE_LIMIT');
      const ids = new Set();
      const add = id => {
        if (typeof id !== 'string' || !id) return;
        ids.add(id);
        if (ids.size > LIMITS.maxKnownIds) fail('NOTE_SOURCE_LIMIT');
      };
      for (const field of template.fields) {
        const p = projectLiteratureNoteSources(String(values[field.id] || ''));
        if (!p.ok) fail(p.error);
        p.references.forEach(ref => ref.sourceIds.forEach(add));
      }
      for (const field of template.fields) {
        const normalize = globalThis.SciLLM?.normalizeLiteratureNoteEvidenceRecord;
        const evidence = typeof normalize === 'function' ? normalize(fieldEvidence[field.id]) : null;
        if (evidence?.status === 'verified') evidence.locators.forEach(locator => add(locator.paragraphId));
      }
      return freeze({ ok: true, sourceIds: knownIds({ knownSourceIds: [...ids] }) });
    } catch (error) { return freeze({ ok: false, error: error.message || 'NOTE_SOURCE_INVALID' }); }
  }
  function makeProjection(originCanonicalText, canonicalText, displayText, ids, delimiters, registry, references, sourceNumberRegistry) {
    return freeze({ ok: true, version: 1, originCanonicalText, canonicalText, displayText,
      ...(sourceNumberRegistry ? { sourceNumberRegistry } : {}),
      knownSourceIds: ids, delimiters, registry, references,
      tokenRanges: references.map(r => ({ start: r.start, end: r.end })) });
  }
  function projectLiteratureNoteSources(text, options = {}) {
    try {
      checkText(text);
      const ids = knownIds(options); const spend = budget();
      const groups = parseReferences(text, ids, spend);
      const delimiters = groups.length ? delimiterPair(text, spend) : { open: '', close: '' };
      const sourceNumberRegistry = options.sourceNumberRegistry;
      if (sourceNumberRegistry && sourceNumberRegistry.ok !== true) fail('NOTE_SOURCE_REGISTRY_INVALID');
      const numberIds = sourceNumberRegistry ? knownIds({ knownSourceIds: sourceNumberRegistry.sourceIds }) : [];
      const numbers = new Map(numberIds.map((id, index) => [id, index + 1]));
      const registry = []; const references = []; const parts = [];
      let cursor = 0; let length = 0;
      groups.forEach((group, index) => {
        const sourceNumbers = group.sourceIds.map(id => {
          if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
          return numbers.get(id);
        });
        const marker = `${delimiters.open}${index + 1}：${sourceNumbers
          .map(n => `来源 ${n}`).join('、')}（待核验）${delimiters.close}`;
        const entry = { index, marker, raw: group.raw, sourceIds: group.sourceIds,
          sourceNumbers, status: 'unverified' };
        registry.push(entry);
        const before = text.slice(cursor, group.canonicalStart);
        parts.push(before, marker); length += before.length;
        references.push({ ...entry, canonicalStart: group.canonicalStart,
          canonicalEnd: group.canonicalEnd, start: length, end: length + marker.length });
        length += marker.length; cursor = group.canonicalEnd;
      });
      parts.push(text.slice(cursor));
      const displayText = parts.join(''); checkText(displayText);
      return makeProjection(text, text, displayText, ids, delimiters, registry, references,
        sourceNumberRegistry ? { ok: true, sourceIds: numberIds } : undefined);
    } catch (error) {
      return failed(typeof text === 'string' ? text : '', error.message || 'NOTE_SOURCE_INVALID');
    }
  }
  function decode(displayText, registry, delimiters, spend) {
    const references = []; const parts = [];
    if (!registry.length) return { canonicalText: displayText, references };
    const byMarker = new Map(registry.map(entry => [entry.marker, entry]));
    const seen = new Set(); let lastIndex = -1; let cursor = 0; let length = 0;
    while (cursor < displayText.length) {
      const start = displayText.indexOf(delimiters.open, cursor);
      const strayClose = displayText.indexOf(delimiters.close, cursor);
      const beforeEnd = start < 0 ? displayText.length : start;
      spend(beforeEnd - cursor + 1);
      if (strayClose >= 0 && (start < 0 || strayClose < start)) fail('NOTE_SOURCE_TOKEN_DAMAGED');
      const before = displayText.slice(cursor, beforeEnd);
      parts.push(before); length += before.length;
      if (start < 0) break;
      const close = displayText.indexOf(delimiters.close, start + delimiters.open.length);
      if (close < 0) fail('NOTE_SOURCE_TOKEN_DAMAGED');
      const end = close + delimiters.close.length;
      spend(end - start);
      const entry = byMarker.get(displayText.slice(start, end));
      if (!entry) fail('NOTE_SOURCE_TOKEN_DAMAGED');
      if (seen.has(entry.index) || entry.index <= lastIndex) fail('NOTE_SOURCE_TOKEN_AMBIGUOUS');
      seen.add(entry.index); lastIndex = entry.index;
      references.push({ ...entry, canonicalStart: length, canonicalEnd: length + entry.raw.length,
        start, end });
      parts.push(entry.raw); length += entry.raw.length; cursor = end;
    }
    const canonicalText = parts.join(''); checkText(canonicalText);
    return { canonicalText, references };
  }
  function validateProjection(p, spend) {
    if (!p || p.ok !== true || p.version !== 1) fail('NOTE_SOURCE_PROJECTION_INVALID');
    checkText(p.canonicalText); checkText(p.displayText); checkText(p.originCanonicalText);
    const origin = projectLiteratureNoteSources(p.originCanonicalText, {
      knownSourceIds: p.knownSourceIds, sourceNumberRegistry: p.sourceNumberRegistry });
    if (!origin.ok || !Array.isArray(p.registry) || !Array.isArray(p.references) ||
        p.registry.length > LIMITS.maxReferences || p.references.length > LIMITS.maxReferences) {
      fail('NOTE_SOURCE_PROJECTION_INVALID');
    }
    const sameEntries = (actual, expected, located) => actual.length === expected.length &&
      actual.every((entry, index) => {
        spend(1);
        const wanted = expected[index];
        const keys = ['index', 'marker', 'raw', 'status',
          ...(located ? ['canonicalStart', 'canonicalEnd', 'start', 'end'] : [])];
        return entry && keys.every(key => entry[key] === wanted[key]) &&
          ['sourceIds', 'sourceNumbers'].every(key => Array.isArray(entry[key]) &&
            entry[key].length === wanted[key].length &&
            entry[key].every((value, i) => value === wanted[key][i]));
      });
    if (!sameEntries(p.registry, origin.registry, false) ||
        p.delimiters?.open !== origin.delimiters.open ||
        p.delimiters?.close !== origin.delimiters.close) fail('NOTE_SOURCE_PROJECTION_INVALID');
    const decoded = decode(p.displayText, origin.registry, origin.delimiters, spend);
    if (decoded.canonicalText !== p.canonicalText ||
        !sameEntries(p.references, decoded.references, true) ||
        !Array.isArray(p.tokenRanges) || p.tokenRanges.length !== decoded.references.length ||
        !p.tokenRanges.every((range, i) => range?.start === decoded.references[i].start &&
          range?.end === decoded.references[i].end)) {
      fail('NOTE_SOURCE_PROJECTION_INVALID');
    }
    return p;
  }
  function validateEdit(edit, text, references) {
    if (!edit || !Number.isInteger(edit.start) || !Number.isInteger(edit.end) ||
        edit.start < 0 || edit.start > edit.end || edit.end > text.length ||
        typeof edit.text !== 'string' || edit.text.length > LIMITS.maxLength) fail('NOTE_SOURCE_EDIT_INVALID');
    for (const ref of references) {
      const intersects = edit.start === edit.end
        ? edit.start > ref.start && edit.start < ref.end
        : edit.start < ref.end && edit.end > ref.start;
      if (intersects && !(edit.start <= ref.start && edit.end >= ref.end)) fail('NOTE_SOURCE_TOKEN_DAMAGED');
    }
  }
  function deletionEdit(before, after, references, spend) {
    const removed = before.length - after.length;
    if (removed <= 0) fail('NOTE_SOURCE_EDIT_HISTORY_REQUIRED');
    let prefix = 0; let suffix = 0;
    while (prefix < after.length && before[prefix] === after[prefix]) { spend(1); prefix += 1; }
    while (suffix < after.length && before[before.length - suffix - 1] === after[after.length - suffix - 1]) {
      spend(1); suffix += 1;
    }
    const minimum = after.length - suffix;
    if (minimum > prefix) fail('NOTE_SOURCE_EDIT_HISTORY_REQUIRED');
    // Repeated token labels can move a longest-common-prefix boundary inside a token.
    // Every candidate in this interval produces exactly the same string by deletion;
    // accept only a boundary that proves whole-token removal.
    for (let start = minimum; start <= prefix; start += 1) {
      spend(references.length + 1);
      const edit = { start, end: start + removed, text: '' };
      try { validateEdit(edit, before, references); return edit; }
      catch (error) { if (error.message !== 'NOTE_SOURCE_TOKEN_DAMAGED') throw error; }
    }
    fail('NOTE_SOURCE_TOKEN_DAMAGED');
  }
  function restoreLiteratureNoteSources(projection, editedText, options = {}) {
    const original = typeof projection?.canonicalText === 'string' ? projection.canonicalText : '';
    try {
      const spend = budget(); const p = validateProjection(projection, spend); checkText(editedText);
      const result = decode(editedText, p.registry, p.delimiters, spend);
      const present = new Set(result.references.map(r => r.index));
      const deletedReferenceIndexes = p.references.filter(r => !present.has(r.index)).map(r => r.index);
      if (options.edits !== undefined) {
        if (!Array.isArray(options.edits) || options.edits.length > LIMITS.maxEdits) fail('NOTE_SOURCE_LIMIT');
        let text = p.displayText; let refs = p.references;
        for (const edit of options.edits) {
          spend(text.length + refs.length);
          validateEdit(edit, text, refs);
          text = text.slice(0, edit.start) + edit.text + text.slice(edit.end); checkText(text);
          refs = decode(text, p.registry, p.delimiters, spend).references;
        }
        if (text !== editedText) fail('NOTE_SOURCE_EDIT_HISTORY_INVALID');
      } else if (deletedReferenceIndexes.length) {
        const edit = deletionEdit(p.displayText, editedText, p.references, spend);
        validateEdit(edit, p.displayText, p.references);
      }
      const nextProjection = makeProjection(p.originCanonicalText, result.canonicalText,
        editedText, p.knownSourceIds, p.delimiters, p.registry, result.references, p.sourceNumberRegistry);
      return freeze({ ok: true, canonicalText: result.canonicalText, displayText: editedText,
        deletedReferenceIndexes, tokenRanges: nextProjection.tokenRanges, nextProjection });
    } catch (error) {
      return failed(original, error.message || 'NOTE_SOURCE_INVALID',
        typeof projection?.displayText === 'string' ? projection.displayText : original);
    }
  }
  function serializeLiteratureNoteSourceProjection(projection) {
    try { validateProjection(projection, budget()); return projection.displayText; }
    catch (_) { return null; }
  }
  return { LITERATURE_NOTE_SOURCE_LIMITS, literatureNoteProtectedBlockRanges, createLiteratureNoteSourceNumberRegistry, projectLiteratureNoteSources,
    restoreLiteratureNoteSources, serializeLiteratureNoteSourceProjection };
});
