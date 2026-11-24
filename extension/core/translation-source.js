// Translation-only DOM projection. Never rewrite the source or annotation anchors.
(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessTranslationSource = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';
  const OMIT = 'script,style,template,noscript,input,textarea,select,button,iframe,object,embed,' +
    'annotation,annotation-xml,[data-sci-plugin-ui],[data-sci-translation],[data-pdf-page-furniture],' +
    '.immersive-translate-target-wrapper,[data-immersive-translate-translation-element-mark="1"]';

  function extractSource(target, { allowHiddenRoot = false } = {}) {
    const range = target?.startContainer && target?.endContainer ? target : null;
    const root = range ? range.commonAncestorContainer : target;
    if (!root || range?.collapsed) return { text: '', segments: [] };
    const view = (root.ownerDocument || (root.nodeType === 9 ? root : null))?.defaultView;
    const styles = new Map();
    function styleFor(node) {
      if (!styles.has(node)) {
        let style;
        try { style = view?.getComputedStyle?.(node) || node.style || {}; }
        catch { style = node.style || {}; }
        styles.set(node, style);
      }
      return styles.get(node);
    }
    function omitted(node, skipVisibility = false) {
      if (node.nodeType !== 1) return false;
      if (node.matches?.(OMIT)) return true;
      const role = String(node.getAttribute?.('role') || '').toLowerCase();
      // An open citation preview is still auxiliary content, not paragraph text.
      if (role === 'tooltip' || role === 'dialog' || node.hasAttribute?.('popover')) return true;
      if (skipVisibility) return false;
      if (node.hidden || node.hasAttribute?.('hidden') || node.getAttribute?.('aria-hidden') === 'true') return true;
      const style = styleFor(node);
      return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
        style.contentVisibility === 'hidden' || String(style.opacity) === '0';
    }
    // A Range can start inside an auxiliary/hidden node. Its ancestor must not
    // become an escape from the same paragraph-source rules.
    let inlineAncestor = false;
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
      if (omitted(parent)) return { text: '', segments: [] };
      if (/^(SUP|SUB|MATH)$/i.test(parent.tagName || '')) inlineAncestor = true;
    }
    const pieces = [], stack = [{ node: root, inlineContext: inlineAncestor }];
    const blockDisplays = new Set(['block', 'flow-root', 'list-item', 'flex', 'grid',
      'table', 'table-row', 'table-cell', 'table-caption']);
    function blockBoundary(node, boundary) {
      // This space is a layout boundary, never a range inside a Text node.
      pieces.push({ node, startOffset: null, endOffset: null, value: ' ',
        kind: 'block-boundary', boundary });
    }
    while (stack.length) {
      const frame = stack.pop(), node = frame.node;
      if (frame.boundary) {
        blockBoundary(node, 'after');
        continue;
      }
      if (node.nodeType === 3) {
        if (range && !range.intersectsNode(node)) continue;
        const value = node.nodeValue || '';
        const startOffset = range?.startContainer === node ? range.startOffset : 0;
        const endOffset = range?.endContainer === node ? range.endOffset : value.length;
        if (endOffset > startOffset) pieces.push({ node, startOffset, endOffset, value: value.slice(startOffset, endOffset), kind: 'text' });
        continue;
      }
      if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) continue;
      // A selection may have the entire article (or PDF viewer) as its common
      // ancestor. Prune unrelated branches before any computed-style lookup.
      if (range && node !== root && node.nodeType === 1 && !range.intersectsNode(node)) continue;
      if (omitted(node, !range && node === root && allowHiddenRoot)) continue;
      if (node.tagName === 'BR') {
        if (!range || range.intersectsNode(node)) pieces.push({ node, startOffset: 0, endOffset: 0, value: ' ', kind: 'break' });
        continue;
      }
      // Keep scientific inline expressions together even if their renderer uses
      // block descendants. Absolutely positioned PDF spans are not block breaks.
      const inlineContext = frame.inlineContext || /^(SUP|SUB|MATH)$/i.test(node.tagName || '');
      const style = node.nodeType === 1 && node !== root && !inlineContext ? styleFor(node) : {};
      const isBlock = node !== root && !inlineContext &&
        style.position !== 'absolute' && style.position !== 'fixed' &&
        (blockDisplays.has(style.display) || /^block\s/u.test(style.display || ''));
      if (isBlock) {
        blockBoundary(node, 'before');
        stack.push({ node, boundary: true });
      }
      const children = node.childNodes || [];
      for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], inlineContext });
    }
    let text = '', pendingSpace = null;
    const segments = [];
    function append(value, origin) {
      const textStart = text.length;
      text += value;
      segments.push({ node: origin.node, startOffset: origin.startOffset, endOffset: origin.endOffset,
        textStart, textEnd: text.length, kind: origin.kind,
        ...(origin.kind === 'block-boundary' ? { boundary: origin.boundary } : {}) });
    }
    for (const piece of pieces) {
      for (const match of piece.value.matchAll(/\s+|\S+/gu)) {
        const value = match[0];
        const origin = piece.kind === 'block-boundary'
          ? { node: piece.node, startOffset: null, endOffset: null, kind: piece.kind, boundary: piece.boundary }
          : { node: piece.node, startOffset: piece.startOffset + match.index,
            endOffset: piece.kind === 'break' ? 0 : piece.startOffset + match.index + value.length, kind: piece.kind };
        if (/^\s/u.test(value)) {
          if (!pendingSpace) pendingSpace = { ...origin,
            kind: ['break', 'block-boundary'].includes(piece.kind) ? piece.kind : 'space' };
        } else {
          if (pendingSpace && text) append(' ', pendingSpace);
          pendingSpace = null;
          append(value, origin);
        }
      }
    }
    // Keep the original projection and Text-node offsets. The companion is
    // descriptive MathML notation, never a replacement source or anchor.
    const scientificContext = [];
    if (!range && root.nodeType !== 3) {
      const groups = new Map();
      for (const segment of segments) {
        let scientific = null;
        for (let node = segment.node?.parentElement; node; node = node.parentElement) {
          if (/^(math|sup|sub)$/iu.test(node.localName || node.tagName || '')) scientific = node;
          if (node === root) break;
        }
        if (!scientific) continue;
        const group = groups.get(scientific) || { sourceStart: segment.textStart, sourceEnd: segment.textEnd };
        group.sourceEnd = segment.textEnd; groups.set(scientific, group);
      }
      let remaining = 50000;
      function describe(node, depth = 0) {
        if (--remaining < 0 || depth > 200) throw Error('MATH_REPRESENTATION_LIMIT');
        if (node.nodeType === 3) return node.nodeValue || '';
        if (omitted(node)) return '';
        const tag = String(node.localName || node.tagName || '').toLowerCase();
        const children = [...(node.childNodes || [])];
        const parts = children.map(child => describe(child, depth + 1));
        const content = parts.join('');
        const attrs = ['mathvariant','linethickness','notation','accent','accentunder','stretchy','fence','separator',
          'columnspan','rowspan','open','close','separators'].flatMap(name => {
            const value = node.getAttribute?.(name); return value == null ? [] : [`${name}=${value}`];
          });
        if (!attrs.length && ['math','mrow','semantics','mi','mn','mo','mtext','ms'].includes(tag)) return content;
        if (tag === 'mspace' || tag === 'br') return ' ';
        const operands = children.flatMap((child, index) => child.nodeType === 1 && !omitted(child) ? [parts[index]] : []);
        return `${tag}${attrs.length ? '[' + attrs.join(', ') + ']' : ''}(${operands.length ? operands.join('; ') : content})`;
      }
      for (const [node, span] of groups) {
        const raw = text.slice(span.sourceStart, span.sourceEnd);
        // A collapsed leading space can originate inside MathML but belong to
        // surrounding prose. Bind only the mathematical source itself.
        const leading = raw.length - raw.trimStart().length, trailing = raw.length - raw.trimEnd().length;
        span.sourceStart += leading; span.sourceEnd -= trailing;
        const value = text.slice(span.sourceStart, span.sourceEnd);
        let displayText;
        try { displayText = describe(node).replace(/\s+/gu, ' ').trim(); }
        catch { displayText = '[MathML representation unavailable]'; }
        if (value && displayText && displayText !== value) scientificContext.push({ ...span, text: value, displayText });
      }
    }
    return { text, segments, ...(scientificContext.length ? { scientificContext } : {}) };
  }
  function readSourceText(element, options) { return extractSource(element, options).text; }
  function readRangeText(range) { return extractSource(range).text; }

  // Offsets always index the original UTF-16 string, including scientific notation.
  function citationPeriods({text, segments}) {
    const periods = new Set();
    for (const {node, textStart} of segments || []) {
      if (text[textStart - 1] !== '.' || !/\d/u.test(text[textStart])) continue;
      if (node.parentElement?.closest?.('sup, [role="doc-biblioref"], a[href*="#ref" i]')) periods.add(textStart - 1);
    }
    return periods;
  }
  function sentenceRanges(text, sourceCitations, base = 0) {
    const spans = [];
    // The question mark in a URL and the periods in a DOI belong to the
    // identifier. Its trailing punctuation still belongs to the sentence.
    const links = text.matchAll(/(?:\bhttps?:\/\/|\bwww\.|\b10\.\d{4,9}\/)[a-z\d.!~*'()_%:/?#[\]@+&=,$;-]+/giu);
    let link = links.next().value;
    let start = 0;
    const add = end => {
      while (start < end && /\s/u.test(text[start])) start++;
      let trimmed = end;
      while (trimmed > start && /\s/u.test(text[trimmed - 1])) trimmed--;
      if (start < trimmed) spans.push({start, end: trimmed});
      start = end;
    };
    for (let i = 0; i < text.length; i++) {
      if (link && i === link.index) {
        const identifier = link[0].replace(/[.!?,;:'")\]]+$/u, '');
        i += identifier.length - 1;
        link = links.next().value;
        continue;
      }
      if (text[i] === '\n' && /^\s*(?:\n|[-•]\s|\(?\d{1,3}[.)、]\s)/u.test(text.slice(i + 1, i + 24))) {
        add(i); start = i + 1; continue;
      }
      if (!'.!?。！？'.includes(text[i])) continue;
      if (text[i] === '.' && !sourceCitations?.has(base + i)) {
        const before = text.slice(Math.max(start, i - 24), i);
        const after = text.slice(i + 1, i + 32);
        // PU.1, NFATc1.2, v1.2.3 and p.Gly12Asp are single tokens in either language.
        // A plain-text citation such as "reported.12,13 Next" can look similar.
        const token = /[a-z\d_-]+$/iu.exec(before)?.[0] || '';
        const numberedReference = /^\d+(?:[,–-]\d+)*(?:\s+[A-Z]|$)/u.test(after) &&
          /^[a-z]{2,}$/u.test(token);
        const numberedItem = i - start < 10 && /^\s*\(?\d{1,3}$/u.test(text.slice(start, i)) && /^\s+\S/u.test(after);
        // A dotted initialism may finish a sentence or modify a proper name.
        const initialism = /(?:\b[A-Z]\.)+[A-Z]$/u.test(before);
        const newSentence = /^\s+(?:The|This|That|These|Those|We|They|It|Our|However|In|Next|Results)\b/u.test(after);
        const initial = /\b[A-Z]$/u.test(before) && /^\s+[A-Za-z]/u.test(after) &&
          !(initialism && newSentence) &&
          !/\b(?:group|cohort|panel|trial|type|class|vitamin|method|case)\s+[A-Z]$/iu.test(before);
        const leadingDecimal = /^\d/u.test(after) && (!before || /[\s(\[=<>≤≥±+−–:-]$/u.test(before));
        if (numberedItem || leadingDecimal || (token && /^[a-z\d]/iu.test(after) && !numberedReference) ||
            /\b(?:figs?|eqs?|refs?|nos?|vol|pp|dr|prof|mr|mrs|ms|vs|cf|e\.g|i\.e|approx|suppl)\s*$/iu.test(before) ||
            (/\b(?:s\.d|s\.e\.m|a\.m|p\.m|u\.s|u\.k)$/iu.test(before) && /^\s*[,;(a-z0-9]/u.test(after)) ||
            (/\bet\s+al$/iu.test(before) && /^\s*[,;(a-z0-9]/u.test(after)) ||
            initial) continue;
      }
      let end = i + 1;
      while (end < text.length && /[.!?。！？)）\]”’」』"']/u.test(text[end])) end++;
      // Publishers sometimes put a linked reference immediately after the period.
      const citation = /^(?:(?:\s*\[\s*\d+[\d\s,;–—-]*\])+|[\d⁰¹²³⁴⁵⁶⁷⁸⁹]+(?:[,–-][\d⁰¹²³⁴⁵⁶⁷⁸⁹]+)*(?=\s|$))/u.exec(text.slice(end, end + 96));
      if (citation) end += citation[0].length;
      add(end);
      i = end - 1;
    }
    add(text.length);
    return spans;
  }

  function sentenceAnchors(text) {
    const greek = {alpha:'α', beta:'β', gamma:'γ', delta:'δ', kappa:'κ'};
    const canonical = text.normalize('NFKC').replace(/[‐‑‒–−]/gu, '-')
      .replace(/\b(alpha|beta|gamma|delta|kappa)(?=\b|[-\d])/giu, name => greek[name.toLowerCase()])
      .replace(/(?:\bextended data fig(?:ure)?s?\.?\s*|扩展数据图\s*)(\d+[a-z]?)/giu, ' edfig$1 ')
      .replace(/(?:\bfig(?:ure)?s?\.?\s*|图\s*)(S?\d+[a-z]?)/giu, ' fig$1 ')
      .replace(/(?:\btable\s*|表\s*)(S?\d+[a-z]?)/giu, ' table$1 ')
      .replace(/\b(?:group|cohort)\s+([a-z\d])\b|(?<![a-z\d])([a-z\d])\s*组|组\s*([a-z\d])(?![a-z\d])/giu, (_,a,b,c) => ' group-' + (a||b||c) + ' ')
      .replace(/\bpanel\s+([a-z])\b|(?<![a-z\d])([a-z])\s*面板|面板\s*([a-z])(?![a-z])/giu, (_,a,b,c) => ' panel-' + (a||b||c) + ' ')
      .replace(/(^|[\s(\[=<>≤≥±+−:-])\.(?=\d)/gu, (_, prefix) => prefix + '0.')
      .replace(/(\d)\s+%/gu, '$1%');
    const words = canonical.match(/[\p{Script=Latin}\p{Script=Greek}][\p{Script=Latin}\p{Script=Greek}\d]*(?:[-.][\p{Script=Latin}\p{Script=Greek}\d]+)*|\d+(?:\.\d+)*%?/gu) || [];
    return new Set(words.map(word => word.toLowerCase()).filter(word => word.length > 1 || /\d|\p{Script=Greek}/u.test(word)));
  }

  function alignmentRows(text, spans) {
    return spans.map(({start, end}, index) => {
      const part = text.slice(start, end);
      return {start, end, index, size: Math.max(1, part.replace(/\s/gu, '').length), anchors: sentenceAnchors(part)};
    });
  }

  function anchorOwners(rows) {
    const owners = new Map();
    for (const row of rows) for (const key of row.anchors) {
      if (!owners.has(key)) owners.set(key, []);
      owners.get(key).push(row);
    }
    return owners;
  }

  function anchorWeight(key) {
    if (/^(?:group|panel)-|^(?:fig|table|edfig)s?\d|%$|\d\.\d|[a-z].*\d|\p{Script=Greek}/u.test(key)) return 2.5;
    return /^\d$/u.test(key) ? 0.45 : 1;
  }

  // Only mutually unique evidence may reverse the expected reading order. Repeated
  // terms such as GBM that occur throughout an abstract are not evidence for a swap.
  function uniquePartners(en, enKeys, zhKeys) {
    const votes = new Map();
    for (const [key, left] of enKeys) {
      const right = zhKeys.get(key);
      if (left.length !== 1 || right?.length !== 1) continue;
      const i = left[0].index, j = right[0].index;
      if (!votes.has(i)) votes.set(i, new Map());
      const row = votes.get(i);
      row.set(j, (row.get(j) || 0) + anchorWeight(key));
    }
    const sources = new Map(), targets = new Map();
    for (const [i, row] of votes) for (const [j, weight] of row) {
      if (weight < 1) continue;
      if (!targets.has(j)) targets.set(j, []);
      targets.get(j).push(i);
      if (!sources.has(i)) sources.set(i, []);
      sources.get(i).push(j);
    }
    const pairs = new Map();
    for (const {index:i} of en) {
      const ids = sources.get(i), j = ids?.[0];
      if (ids?.length === 1 && targets.get(j)?.length === 1 && votes.get(i).get(j) >= 2) pairs.set(i, j);
    }
    return pairs;
  }

  function alignSentenceRows(sourceRows, targetRows, enKeys, zhKeys, pairs) {
    const a = sourceRows.slice(), b = targetRows;
    const result = b.map(() => new Set());
    const locked = a.filter(row => pairs.has(row.index));
    // A missing sentence with an unmatched quantitative identifier between two consecutive
    // confirmed translations should not be borrowed by either one.
    const omitted = new Set();
    for (let n = 1; n < locked.length; n++) {
      const left = locked[n - 1], right = locked[n];
      if (pairs.get(right.index) !== pairs.get(left.index) + 1) continue;
      for (let i = left.index + 1; i < right.index; i++) {
        const keys = [...sourceRows[i].anchors].filter(key => anchorWeight(key) >= 2);
        if (keys.length && keys.every(key => !zhKeys.has(key))) omitted.add(i);
      }
    }
    const ordered = locked.slice().sort((x,y) => pairs.get(x.index) - pairs.get(y.index));
    locked.forEach((row,i) => { a[row.index] = ordered[i]; });
    const active = a.filter(row => !omitted.has(row.index));
    const n = active.length, m = b.length;
    if (n === 1 || m === 1) return b.map(() => new Set(active));
    // Bound latency on bibliographies or exports flattened into a single paragraph.
    if (Math.max(n,m) > 600) {
      const byTarget = new Map(locked.map(row => [pairs.get(row.index), row]));
      return b.map((row,j) => new Set([byTarget.get(row.index) || (n === m ? active[j] : null)].filter(Boolean)));
    }
    const maxSourceSpan = Math.min(8, Math.max(4, Math.ceil(n / m) + 1));
    const maxTargetSpan = Math.min(8, Math.max(4, Math.ceil(m / n) + 1));
    const alignmentSteps = [[1,1]];
    for (let u = 2; u <= maxSourceSpan; u++) alignmentSteps.push([u,1]);
    for (let v = 2; v <= maxTargetSpan; v++) alignmentSteps.push([1,v]);
    const sharedWeight = key => {
      const af = enKeys.get(key)?.length, bf = zhKeys.get(key)?.length;
      return af && bf ? anchorWeight(key) / Math.max(af,bf) : 0;
    };
    function groups(rows, maximum) {
      return rows.map((_, start) => {
        const list = [], keys = new Set();
        let size = 0;
        for (const row of rows.slice(start, start + maximum)) {
          size += row.size;
          for (const key of row.anchors) if (sharedWeight(key)) keys.add(key);
          list.push({size, keys: new Set(keys)});
        }
        return list;
      });
    }
    const ratio = b.reduce((sum,row) => sum+row.size,0) / active.reduce((sum,row) => sum+row.size,0);
    const ag = groups(active,maxSourceSpan), bg = groups(b,maxTargetSpan);
    const band = n * m <= 12000 ? m : 18;
    const bounds = Array.from({length:n+1}, (_,i) => ({
      lo: Math.max(0, Math.floor(i*m/n) - band), hi: Math.min(m, Math.ceil(i*m/n) + band)
    }));
    let cells = 0;
    for (const row of bounds) { row.start = cells; cells += row.hi - row.lo + 1; }
    const cell = (i,j) => {
      const row = bounds[i];
      return row && j >= row.lo && j <= row.hi ? row.start + j - row.lo : -1;
    };
    const forward = new Float64Array(cells).fill(Infinity), backward = new Float64Array(cells).fill(Infinity);
    const costs = new Float64Array(cells * alignmentSteps.length).fill(Infinity);
    forward[0] = 0; backward[cell(n,m)] = 0;
    for (let i = 0; i < n; i++) for (let j = bounds[i].lo; j <= Math.min(m-1,bounds[i].hi); j++) {
      const at = cell(i,j);
      if (!Number.isFinite(forward[at])) continue;
      alignmentSteps.forEach(([u,v],k) => {
        const dest = cell(i+u,j+v);
        if (dest < 0) return;
        const l = ag[i][u-1], r = bg[j][v-1];
        let missed = 0;
        for (const key of l.keys) if (!r.keys.has(key)) missed += sharedWeight(key);
        for (const key of r.keys) if (!l.keys.has(key)) missed += sharedWeight(key);
        const cost = Math.abs(Math.log(r.size / (l.size*ratio))) + 0.95*(u+v-2) + Math.min(8,missed);
        costs[at*alignmentSteps.length+k] = cost;
        forward[dest] = Math.min(forward[dest], forward[at]+cost);
      });
    }
    const best = forward[cell(n,m)];
    if (!Number.isFinite(best)) {
      // Extremely different counts: return only matches supported by independent anchors.
      const byTarget = new Map(locked.map(row => [pairs.get(row.index),row]));
      return b.map(row => new Set([byTarget.get(row.index)].filter(Boolean)));
    }
    for (let i = n-1; i >= 0; i--) for (let j = Math.min(m-1,bounds[i].hi); j >= bounds[i].lo; j--) {
      const at = cell(i,j);
      alignmentSteps.forEach(([u,v],k) => {
        const cost = costs[at*alignmentSteps.length+k];
        if (!Number.isFinite(cost)) return;
        const tail = cost + backward[cell(i+u,j+v)];
        backward[at] = Math.min(backward[at], tail);
        // When two placements are nearly tied, include the adjacent candidates.
        if (forward[at] + tail > best + 0.30) return;
        for (let y=j; y<j+v; y++) for (let x=i; x<i+u; x++) result[y].add(active[x]);
      });
    }
    return result;
  }

  // A translator may use a semicolon where the author used a full stop. Only
  // introduce clause boundaries when they bring the two sentence counts closer.
  function comparableClauses(text, spans, otherCount) {
    if (spans.length >= otherCount) return spans;
    const clauses = [];
    for (const span of spans) {
      let start = span.start, depth = 0;
      for (let i = start; i < span.end; i++) {
        const ch = text[i];
        if ('([（【［“「'.includes(ch)) depth++;
        else if (')]）】］”」'.includes(ch)) depth = Math.max(0, depth - 1);
        else if (!depth && (ch === ';' || ch === '；') && i-start >= 4 && span.end-i > 4) {
          clauses.push({start,end:i+1});
          start = i+1;
          while (start < span.end && /\s/u.test(text[start])) start++;
        }
      }
      clauses.push({start,end:span.end});
    }
    return Math.abs(clauses.length-otherCount) < otherCount-spans.length ? clauses : spans;
  }

  function alignSentences(source, target, sourceCitations, sourceOffset = 0) {
    let enSpans = sentenceRanges(source,sourceCitations,sourceOffset);
    const notesInSource = /translator['’]s note|editor['’]s note|译者注|译注|编者注/iu.test(source);
    let zhSpans = sentenceRanges(target).filter(span => notesInSource ||
      !/^\s*[【\[(（]?\s*(?:译者注(?:释)?|译注|编者注|translator['’]s note)\s*[:：】\])）]/iu.test(target.slice(span.start,span.end)));
    enSpans = comparableClauses(source,enSpans,zhSpans.length);
    zhSpans = comparableClauses(target,zhSpans,enSpans.length);
    const en = alignmentRows(source,enSpans), zh = alignmentRows(target,zhSpans);
    if (!en.length || !zh.length) return [];
    const enKeys = anchorOwners(en), zhKeys = anchorOwners(zh);
    const pairs = uniquePartners(en,enKeys,zhKeys);
    const matches = alignSentenceRows(en,zh,enKeys,zhKeys,pairs);
    return zh.flatMap((row,i) => {
      const candidates = [...matches[i]].sort((x,y) => x.index-y.index);
      if (!candidates.length) return [];
      const runs = [];
      let lastIndex = -2;
      for (const match of candidates) {
        if (match.index === lastIndex+1) runs[runs.length-1].end = match.end;
        else runs.push({start:match.start,end:match.end});
        lastIndex = match.index;
      }
      return [{start:row.start,end:row.end,sourceStart:runs[0].start,sourceEnd:runs[runs.length-1].end,
        ...(runs.length > 1 ? {sourceSpans:runs} : {})}];
    });
  }

  // A single Range across inline elements could paint a hidden tooltip or a note.
  // Coalesce only adjacent offsets within the same original text node.
  function sourceRanges(document, segments, start, end) {
    const ranges = [];
    let previous;
    for (const part of segments) {
      if (part.textStart >= end) break;
      if (part.textEnd <= start || part.node.nodeType !== 3) continue;
      const left = part.startOffset + Math.max(0, start - part.textStart);
      const right = part.endOffset - Math.max(0, part.textEnd - end);
      if (previous?.endContainer === part.node && previous.endOffset === left) previous.setEnd(part.node, right);
      else {
        previous = document.createRange();
        previous.setStart(part.node, left); previous.setEnd(part.node, right);
        ranges.push(previous);
      }
    }
    return ranges;
  }
  return { extractSource, readSourceText, readRangeText, citationPeriods, sentenceRanges, alignSentences, sourceRanges };
});
