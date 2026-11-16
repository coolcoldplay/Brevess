(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const LITERATURE_NOTE_FORMAT_LIMITS = Object.freeze({ maxLength: 12000, maxDepth: 16, maxNodes: 2048, maxWork: 200000 });
  const LITERATURE_NOTE_COLORS = Object.freeze(['black', 'red', 'orange', 'green', 'blue', 'purple']);
  const COLOR_OPEN = /^<span data-brevess-color="(black|red|orange|green|blue|purple)">/;
  const ESCAPABLE = /[\\`*_{}[\]()#+.!<>-]/;

  function linesOf(source) {
    const lines = [];
    const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
    let match;
    while ((match = pattern.exec(source)) && match[0]) {
      lines.push({ text: match[1], start: match.index, end: match.index + match[1].length,
        next: pattern.lastIndex, eol: match[2] });
    }
    if (/[\r\n]$/.test(source)) lines.push({ text: '', start: source.length,
      end: source.length, next: source.length, eol: '' });
    return lines;
  }

  function listMarker(line) {
    const match = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(line.text);
    if (!match) return null;
    return { indent: match[1].replace(/\t/g, '    ').length, whitespace: match[1],
      prefixLength: match[1].length + match[2].length + match[3].length,
      marker: match[2], ordered: /^\d/.test(match[2]), value: parseInt(match[2], 10) };
  }

  function safeLink(value) {
    if (value.length > 2048 || !/^https?:\/\//i.test(value) || /[\s\u0000-\u001f\u007f<>"\\]/u.test(value)) return null;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password
        ? url.href : null;
    } catch (_) { return null; }
  }

  function parseNote(source) {
    const fallback = error => ({ ast: { type: 'document', source, error,
      children: [{ type: 'paragraph', children: [{ type: 'text', text: source }] }] }, edits: [], ranges: [] });
    if (typeof source !== 'string') return fallback('NOTE_TEXT_INVALID');
    if (source.length > LITERATURE_NOTE_FORMAT_LIMITS.maxLength) return fallback('NOTE_TEXT_TOO_LONG');
    let nodes = 0;
    let work = 0;
    const spend = () => {
      if (++work > LITERATURE_NOTE_FORMAT_LIMITS.maxWork) throw new Error('NOTE_FORMAT_LIMIT');
    };
    const edits = [];
    const ranges = [];
    const make = (type, properties, depth) => {
      if (depth > LITERATURE_NOTE_FORMAT_LIMITS.maxDepth || ++nodes > LITERATURE_NOTE_FORMAT_LIMITS.maxNodes) {
        throw new Error('NOTE_FORMAT_LIMIT');
      }
      return { type, ...properties };
    };
    const literal = (children, text, depth) => {
      if (!text) return;
      const last = children[children.length - 1];
      if (last?.type === 'text') last.text += text;
      else children.push(make('text', { text }, depth));
    };
    const remove = (start, end) => { if (end > start) edits.push({ start, end }); };
    const record = (type, start, contentStart, contentEnd, end, extra = {}) => {
      ranges.push({ type, start, contentStart, contentEnd, end, ...extra });
      remove(start, contentStart); remove(contentEnd, end);
    };
    function codeEnd(text, start, marker) {
      let cursor = start + marker.length;
      while ((cursor = text.indexOf(marker, cursor)) >= 0) {
        spend();
        if (text[cursor - 1] !== '`' && text[cursor + marker.length] !== '`') return cursor;
        cursor += marker.length;
      }
      return -1;
    }
    function delimiterEnd(text, start, marker) {
      for (let cursor = start + marker.length; cursor < text.length; cursor += 1) {
        spend();
        if (text[cursor] === '\\') { cursor += 1; continue; }
        if (text[cursor] === '`') {
          const codeMarker = /^`+/.exec(text.slice(cursor))[0];
          const end = codeEnd(text, cursor, codeMarker);
          if (end >= 0) { cursor = end + codeMarker.length - 1; continue; }
        }
        if (text[cursor] !== marker[0]) continue;
        let end = cursor;
        while (text[end] === marker[0]) end += 1;
        const close = end - marker.length;
        if (close >= cursor && !/\s/.test(text[cursor - 1] || '') &&
            !(marker[0] === '_' && /[\p{L}\p{N}]/u.test(text[end] || ''))) return close;
        cursor = end - 1;
      }
      return -1;
    }
    function colorEnd(text, start, opening) {
      const tags = /<span\b[^>\r\n]*>|<\/span>/g;
      tags.lastIndex = start + opening.length;
      let nesting = 1;
      let tag;
      while ((tag = tags.exec(text))) {
        spend();
        if (tag[0] === '</span>') {
          if (--nesting === 0) return tag.index;
        } else if (!tag[0].endsWith('/>')) nesting += 1;
      }
      return -1;
    }
    function linkAt(text, start) {
      let level = 1;
      let labelEnd = start + 1;
      for (; labelEnd < text.length; labelEnd += 1) {
        spend();
        if (text[labelEnd] === '\\') { labelEnd += 1; continue; }
        if (text[labelEnd] === '[') level += 1;
        if (text[labelEnd] === ']' && --level === 0) break;
      }
      if (text[labelEnd + 1] !== '(') return null;
      level = 1;
      let end = labelEnd + 2;
      for (; end < text.length; end += 1) {
        spend();
        if (/[\r\n]/.test(text[end])) return null;
        if (text[end] === '\\') { end += 1; continue; }
        if (text[end] === '(') level += 1;
        if (text[end] === ')' && --level === 0) break;
      }
      if (level) return null;
      return { labelEnd, end: end + 1, url: safeLink(text.slice(labelEnd + 2, end)) };
    }
    function inline(text, offset, depth, allowLinks = true) {
      if (depth > LITERATURE_NOTE_FORMAT_LIMITS.maxDepth) throw new Error('NOTE_FORMAT_LIMIT');
      const children = [];
      let cursor = 0;
      while (cursor < text.length) {
        spend();
        const char = text[cursor];
        if (char === '\\' && ESCAPABLE.test(text[cursor + 1] || '')) {
          remove(offset + cursor, offset + cursor + 1);
          literal(children, text[cursor + 1], depth); cursor += 2; continue;
        }
        if (char === '`') {
          const marker = /^`+/.exec(text.slice(cursor))[0];
          const end = codeEnd(text, cursor, marker);
          if (end >= 0) {
            children.push(make('code', { text: text.slice(cursor + marker.length, end) }, depth));
            record('code', offset + cursor, offset + cursor + marker.length, offset + end, offset + end + marker.length);
            cursor = end + marker.length; continue;
          }
          literal(children, marker, depth); cursor += marker.length; continue;
        }
        if (char === '<') {
          const opening = COLOR_OPEN.exec(text.slice(cursor));
          const end = opening ? colorEnd(text, cursor, opening[0]) : -1;
          if (end >= 0) {
            children.push(make('color', { color: opening[1],
              children: inline(text.slice(cursor + opening[0].length, end), offset + cursor + opening[0].length, depth + 1, allowLinks) }, depth));
            record('color', offset + cursor, offset + cursor + opening[0].length, offset + end, offset + end + 7, { color: opening[1] });
            cursor = end + 7; continue;
          }
          const tag = /^<[^>\r\n]*>/.exec(text.slice(cursor));
          if (tag) { literal(children, tag[0], depth); cursor += tag[0].length; continue; }
        }
        if (char === '[') {
          const link = linkAt(text, cursor);
          if (link) {
            if (link.url && allowLinks) {
              children.push(make('link', { url: link.url,
                children: inline(text.slice(cursor + 1, link.labelEnd), offset + cursor + 1, depth + 1, false) }, depth));
              record('link', offset + cursor, offset + cursor + 1, offset + link.labelEnd, offset + link.end);
            } else literal(children, text.slice(cursor, link.end), depth);
            cursor = link.end; continue;
          }
        }
        if (char === '*' || char === '_') {
          const run = /^(\*+|_+)/.exec(text.slice(cursor))[0];
          const marker = run.length <= 3 ? run : '';
          const next = text[cursor + marker.length] || '';
          const previous = text[cursor - 1] || '';
          const intraword = marker.length === 1 && /[A-Za-z0-9]/.test(previous) && /[A-Za-z0-9]/.test(next);
          const end = marker && next && !/\s/.test(next) && !intraword ? delimiterEnd(text, cursor, marker) : -1;
          if (end > cursor + marker.length) {
            let content = inline(text.slice(cursor + marker.length, end), offset + cursor + marker.length,
              depth + (marker.length === 3 ? 2 : 1), allowLinks);
            if (marker.length === 3) content = [make('emphasis', { children: content }, depth + 1)];
            const type = marker.length >= 2 ? 'strong' : 'emphasis';
            children.push(make(type, { children: content }, depth));
            record(type, offset + cursor, offset + cursor + marker.length, offset + end, offset + end + marker.length, { marker });
            cursor = end + marker.length; continue;
          }
          literal(children, run, depth); cursor += run.length; continue;
        }
        literal(children, char, depth); cursor += 1;
      }
      return children;
    }
    const lines = linesOf(source);
    function paragraph(start, end, depth) {
      return make('paragraph', { children: inline(source.slice(start, end), start, depth + 1) }, depth);
    }
    function list(index, depth) {
      const first = listMarker(lines[index]);
      const items = [];
      while (index < lines.length) {
        const marker = listMarker(lines[index]);
        if (!marker || marker.indent !== first.indent || marker.ordered !== first.ordered) break;
        const line = lines[index];
        remove(line.start, line.start + marker.prefixLength);
        const children = [];
        let contentStart = line.start + marker.prefixLength;
        let contentEnd = line.end;
        index += 1;
        while (index < lines.length && lines[index].text.trim() && !listMarker(lines[index])) {
          contentEnd = lines[index].end; index += 1;
        }
        children.push(paragraph(contentStart, contentEnd, depth + 2));
        while (index < lines.length) {
          let next = index;
          while (next < lines.length && !lines[next].text.trim()) next += 1;
          const nested = next < lines.length ? listMarker(lines[next]) : null;
          if (!nested || nested.indent <= first.indent) {
            if (nested && nested.indent === first.indent && nested.ordered === first.ordered) index = next;
            break;
          }
          const result = list(next, depth + 2);
          children.push(result.node); index = result.index;
        }
        items.push(make('listItem', { children, ...(marker.ordered ? { value: marker.value } : {}), marker: marker.marker }, depth + 1));
      }
      return { node: make('list', { ordered: first.ordered, start: first.ordered ? first.value : 1, items }, depth), index };
    }
    try {
      const children = [];
      let index = 0;
      while (index < lines.length) {
        if (!lines[index].text.trim()) { index += 1; continue; }
        if (listMarker(lines[index])) {
          const result = list(index, 1); children.push(result.node); index = result.index;
        } else {
          const start = lines[index].start;
          let end = lines[index++].end;
          while (index < lines.length && lines[index].text.trim() && !listMarker(lines[index])) end = lines[index++].end;
          children.push(paragraph(start, end, 1));
        }
      }
      return { ast: make('document', { source, children }, 0), edits, ranges };
    } catch (error) {
      if (error.message !== 'NOTE_FORMAT_LIMIT') throw error;
      return fallback('NOTE_FORMAT_LIMIT');
    }
  }

  function parseLiteratureNoteMarkdown(text) {
    if (typeof text !== 'string') return { ...parseNote('').ast, error: 'NOTE_TEXT_INVALID' };
    return parseNote(text).ast;
  }

  function plainLiteratureNoteText(text) {
    if (typeof text !== 'string') return '';
    const parsed = parseNote(text);
    const edits = parsed.edits.sort((a, b) => a.start - b.start || a.end - b.end);
    let output = '';
    let cursor = 0;
    for (const edit of edits) {
      if (edit.start >= cursor) output += text.slice(cursor, edit.start);
      cursor = Math.max(cursor, edit.end);
    }
    return output + text.slice(cursor);
  }

  function plainLiteratureNoteCopyText(text) {
    if (typeof text !== 'string') return null;
    const parsed = parseNote(text);
    if (parsed.ast.error) return null;
    let protect = globalThis.SciLLM?.literatureNoteProtectedBlockRanges;
    if (typeof protect !== 'function' && typeof require === 'function') {
      try { protect = require('./literature-note-sources').literatureNoteProtectedBlockRanges; } catch (_) {}
    }
    if (typeof protect !== 'function') return text;
    const blocks = protect(text);
    if (!blocks.ok) return null;
    const protectedMask = new Uint8Array(text.length);
    for (const range of blocks.ranges) protectedMask.fill(1, range.start, range.end);
    const protectedCount = new Uint32Array(text.length + 1);
    for (let index = 0; index < text.length; index += 1) {
      protectedCount[index + 1] = protectedCount[index] + protectedMask[index];
    }
    // Copy keeps step numbers, nesting, code and complete link destinations.
    // Only remove presentation spans; plainLiteratureNoteText is a semantic
    // comparison helper whose broader stripping is unsuitable for user export.
    const edits = parsed.ranges.filter(range =>
      ['strong', 'emphasis', 'color'].includes(range.type) &&
      protectedCount[range.end] === protectedCount[range.start]).flatMap(range => [
      { start: range.start, end: range.contentStart },
      { start: range.contentEnd, end: range.end }
    ]).sort((a, b) => a.start - b.start || a.end - b.end);
    let result = '';
    let cursor = 0;
    for (const edit of edits) {
      if (edit.start >= cursor) result += text.slice(cursor, edit.start);
      cursor = Math.max(cursor, edit.end);
    }
    return result + text.slice(cursor);
  }

  function literatureNoteSemanticSignature(text) {
    const failure = error => ({ ok: false, error });
    if (typeof text !== 'string') return failure('NOTE_TEXT_INVALID');
    try {
      const parsed = parseNote(text);
      if (parsed.ast.error) return failure(parsed.ast.error);
      const edits = parsed.edits.slice().sort((a, b) => a.start - b.start || a.end - b.end);
      // Map original UTF-16 boundaries into the visible projection. Formatting
      // may split an AST text node, so AST node indexes cannot locate a link.
      const positions = new Array(text.length + 1);
      const visible = [];
      let editIndex = 0;
      for (let index = 0; index < text.length; index += 1) {
        while (editIndex < edits.length && edits[editIndex].end <= index) editIndex += 1;
        positions[index] = visible.length;
        if (editIndex === edits.length || index < edits[editIndex].start) visible.push(text[index]);
      }
      positions[text.length] = visible.length;
      const plain = visible.join('');
      const semanticNodes = { link: [], code: [] };
      const visit = node => {
        if (node.type === 'link' || node.type === 'code') semanticNodes[node.type].push(node);
        for (const child of node.children || node.items || []) visit(child);
      };
      visit(parsed.ast);
      const indexes = { link: 0, code: 0 };
      const semantics = [];
      for (const range of parsed.ranges.filter(item => item.type === 'link' || item.type === 'code')
        .sort((a, b) => a.start - b.start)) {
        const node = semanticNodes[range.type][indexes[range.type]++];
        if (!node) return failure('NOTE_FORMAT_INVALID');
        const start = positions[range.contentStart];
        const end = positions[range.contentEnd];
        // Keep the label/code bytes and their location in the complete text:
        // merely collecting URLs would miss moving a link between equal labels.
        semantics.push(range.type === 'link'
          ? { type: 'link', start, end, text: plain.slice(start, end), url: node.url }
          : { type: 'code', start, end, text: node.text });
      }
      if (indexes.link !== semanticNodes.link.length || indexes.code !== semanticNodes.code.length) {
        return failure('NOTE_FORMAT_INVALID');
      }
      return { ok: true, signature: JSON.stringify({ version: 1, text: plain, semantics }) };
    } catch (_) {
      return failure('NOTE_FORMAT_INVALID');
    }
  }

  function isSelectionBoundary(text, offset) {
    if (!offset || offset === text.length) return true;
    if (text[offset - 1] === '\r' && text[offset] === '\n') return false;
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const segment = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text).containing(offset);
      return segment?.index === offset;
    }
    return !(/[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]));
  }

  function formatLiteratureNoteSelection({ text, start, end, action, color } = {}) {
    const failure = error => ({ text, selectionStart: start, selectionEnd: end, changed: false, error });
    if (typeof text !== 'string') return failure('NOTE_TEXT_INVALID');
    if (text.length > LITERATURE_NOTE_FORMAT_LIMITS.maxLength) return failure('NOTE_TEXT_TOO_LONG');
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length ||
        !isSelectionBoundary(text, start) || !isSelectionBoundary(text, end)) return failure('NOTE_SELECTION_INVALID');
    if (!['bold', 'bullet', 'ordered', 'indent', 'outdent', 'color'].includes(action)) return failure('NOTE_ACTION_INVALID');
    if (action === 'color' && !LITERATURE_NOTE_COLORS.includes(color)) return failure('NOTE_COLOR_INVALID');
    const parsed = parseNote(text);
    if (parsed.ast.error) return failure(parsed.ast.error);
    const edits = [];
    let selectionStart = start;
    let selectionEnd = end;
    const inlineAction = action === 'bold' || action === 'color';
    if (inlineAction) {
      if (start === end) return failure('NOTE_SELECTION_EMPTY');
      for (const range of parsed.ranges) {
        if (end <= range.start || start >= range.end || (start <= range.start && end >= range.end)) continue;
        if (start >= range.contentStart && end <= range.contentEnd) {
          if (range.type === 'code') return failure('NOTE_SELECTION_IN_CODE');
          continue;
        }
        return failure('NOTE_SELECTION_CROSSES_FORMAT');
      }
      const existing = parsed.ranges.find(range => range.type === (action === 'bold' ? 'strong' : 'color') &&
        ((range.contentStart === start && range.contentEnd === end) || (range.start === start && range.end === end)) &&
        (action !== 'bold' || range.marker.length === 2));
      if (existing) {
        if (action === 'color') {
          selectionStart = existing.contentStart;
          selectionEnd = existing.contentEnd;
        }
        edits.push({ start: existing.start, end: existing.contentStart,
          replacement: action === 'color' ? `<span data-brevess-color="${color}">` : '' });
        if (action === 'bold') edits.push({ start: existing.contentEnd, end: existing.end, replacement: '' });
      } else {
        // Wrap individual nonempty lines, so a cross-paragraph selection never
        // creates an unterminated inline construct in a neighbouring block.
        for (const line of linesOf(text)) {
          const marker = listMarker(line);
          let first = Math.max(start, line.start + (marker?.prefixLength || 0));
          let last = Math.min(end, line.end);
          while (first < last && /\s/.test(text[first])) first += 1;
          while (last > first && /\s/.test(text[last - 1])) last -= 1;
          if (first >= last) continue;
          const open = action === 'bold' ? '**' : `<span data-brevess-color="${color}">`;
          const close = action === 'bold' ? '**' : '</span>';
          edits.push({ start: first, end: first, replacement: open });
          edits.push({ start: last, end: last, replacement: close });
        }
      }
    } else {
      const lines = linesOf(text);
      if (!lines.length) lines.push({ text: '', start: 0, end: 0 });
      let number = null;
      for (const line of lines) {
        if (line.end < start || (line.start >= end && start !== end) || (start === end && !(line.start <= start && start <= line.end))) continue;
        if (!line.text.trim() && start !== end) continue;
        const marker = listMarker(line);
        const whitespace = /^[ \t]*/.exec(line.text)[0];
        if (action === 'indent') edits.push({ start: line.start, end: line.start, replacement: '  ' });
        else if (action === 'outdent') {
          const prefix = /^(?: {1,2}|\t)/.exec(line.text)?.[0] || '';
          if (prefix) edits.push({ start: line.start, end: line.start + prefix.length, replacement: '' });
        } else {
          if (number === null) number = marker?.ordered ? marker.value : 1;
          const prefix = action === 'bullet' ? '- ' : marker?.ordered ? `${marker.marker} ` : `${number}. `;
          number = marker?.ordered ? marker.value + 1 : number + 1;
          edits.push({ start: line.start + whitespace.length,
            end: line.start + (marker ? marker.prefixLength : whitespace.length), replacement: prefix });
        }
      }
    }
    edits.sort((a, b) => a.start - b.start || a.end - b.end);
    let output = '';
    let cursor = 0;
    for (const edit of edits) {
      output += text.slice(cursor, edit.start) + edit.replacement; cursor = edit.end;
    }
    output += text.slice(cursor);
    if (output.length > LITERATURE_NOTE_FORMAT_LIMITS.maxLength) return failure('NOTE_TEXT_TOO_LONG');
    const updated = parseNote(output);
    if (updated.ast.error) return failure(updated.ast.error);
    if (inlineAction && plainLiteratureNoteText(output) !== plainLiteratureNoteText(text)) return failure('NOTE_FORMAT_AMBIGUOUS');
    if (output === text) return { text, selectionStart: start, selectionEnd: end, changed: false };
    const map = (offset, affinity) => {
      let delta = 0;
      for (const edit of edits) {
        if (offset < edit.start || (offset === edit.start && edit.start === edit.end && affinity === 'left')) break;
        if (offset < edit.end) return edit.start + delta + edit.replacement.length;
        delta += edit.replacement.length - (edit.end - edit.start);
      }
      return offset + delta;
    };
    return { text: output, selectionStart: map(selectionStart, 'right'),
      selectionEnd: map(selectionEnd, selectionStart === selectionEnd ? 'right' : 'left'), changed: true };
  }

  return { LITERATURE_NOTE_FORMAT_LIMITS, LITERATURE_NOTE_COLORS,
    parseLiteratureNoteMarkdown, formatLiteratureNoteSelection, plainLiteratureNoteText,
    literatureNoteSemanticSignature, plainLiteratureNoteCopyText };
});
