(function attach(root, factory) {
  const projection = typeof module === 'object' && module.exports
    ? { ...require('./pdf-text-projection.js'), ...require('./pdf-figure-panel-inventory.js') }
    : root.SciLLM || {};
  const api = factory(Object.assign({}, root.SciLLM || {}, projection));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const MAX_PAGES = 10000;
  const MAX_LINES_PER_CAPTION = 80;
  const MAX_CAPTION_CHARS = 12000;
  const HEADER_PATTERN = /^\s*(extended\s+data\s+fig(?:ure)?|supplement(?:ary|al)\s+fig(?:ure)?|fig(?:ure)?)\.?\s*(S\s*)?(\d{1,3})(?!\d)(\s*(?:[.:|\u2010-\u2015\u2212-])\s*|\s*$)(.*)$/iu;
  const CAPTION_BOUNDARY_PATTERN = /^(?:abstract|introduction|results?|discussion|methods?|materials\s+and\s+methods|references?|acknowledg(?:e)?ments?|author\s+contributions?|supplementary\s+information|table\s+\d+)\s*$/iu;
  const BODY_REFERENCE_START = /^(?:shows?|showing|illustrates?|depicts?|demonstrates?|presents?|summari[sz]es?|compares?|indicates?|reveals?|provides?|is|was|were|has|contains?)\b/iu;
  const TERMINAL_CAPTION = /[.!?](?:[)\]}\u201d\u2019'"]+)?\s*$/u;

  function normalizedInlineText(value) {
    return String(value || '').normalize('NFKC').replace(/[\t\f\v ]+/g, ' ').trim();
  }

  function normalizedCaption(value) {
    // Match canonical item control filtering and semantic line-end
    // dehyphenation. Preserve raw lines separately; never fold inline hyphens.
    return String(value || '').normalize('NFKC')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
      .replace(/(\p{L}\p{M}*)-(?:\r\n|\r|\n)(?=\p{Ll})/gu, '$1')
      .replace(/\s+/g, ' ').trim()
      .slice(0, MAX_CAPTION_CHARS);
  }

  function positivePageNumber(value) {
    const pageNumber = Number(value);
    return Number.isSafeInteger(pageNumber) && pageNumber > 0 && pageNumber <= MAX_PAGES
      ? pageNumber : 0;
  }

  function textItemCoordinate(item, index) {
    const transform = Array.isArray(item?.transform) ? item.transform : [];
    const x = Number(transform[4]);
    const y = Number(transform[5]);
    const width = Number(item?.width);
    const angle = Math.atan2(Number(transform[1]) || 0, Number(transform[0]) || 0);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const height = Math.abs(Number(item?.height) || Number(transform[3]) || 0);
    const corners = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width)
      ? [[x, y], [x + width * cos, y + width * sin],
        [x - height * sin, y + height * cos],
        [x + width * cos - height * sin, y + width * sin + height * cos]] : [];
    return {
      index,
      text: String(item?.str || '').normalize('NFKC'),
      hasEOL: item?.hasEOL === true,
      // Use the text's own baseline, rather than unrotated page axes. Page
      // furniture can have a different orientation on landscape figure pages.
      x: Number.isFinite(x) && Number.isFinite(y) ? x * cos + y * sin : null,
      y: Number.isFinite(x) && Number.isFinite(y) ? -x * sin + y * cos : null,
      orientation: Math.round(angle * 180 / Math.PI),
      width: Number.isFinite(width) && width >= 0 ? width : 0,
      height,
      pdfRect: corners.length ? { left: Math.min(...corners.map(point => point[0])),
        right: Math.max(...corners.map(point => point[0])),
        bottom: Math.min(...corners.map(point => point[1])),
        top: Math.max(...corners.map(point => point[1])) } : null
    };
  }

  function shouldBreakPdfLine(current, item) {
    if (!current.parts.length) return false;
    const previous = current.parts.at(-1);
    const large = Math.max(previous.height, item.height);
    const small = Math.min(previous.height, item.height);
    const gap = item.x - (previous.x + previous.width);
    // A font-size change alone is not a new physical line. Both a raised
    // inline glyph and a line-leading isotope must be horizontally adjacent,
    // share orientation and overlap the normal text's vertical band.
    if (current.y != null && item.y != null && previous.x != null && item.x != null &&
        current.orientation === item.orientation && small >= large * 0.35 && small <= large * 0.85 &&
        Math.abs(current.y - item.y) <= large * 0.75 &&
        gap >= -1.5 && gap <= Math.max(3, large * 0.8)) return false;
    if (current.forcedBreak) return true;
    if (current.orientation !== item.orientation) return true;
    if (current.y === null || item.y === null) return false;
    const tolerance = Math.max(1.5, Math.min(6, Math.max(current.height, item.height) * 0.35));
    return Math.abs(current.y - item.y) > tolerance;
  }

  function appendPdfItem(current, item) {
    const previous = current.parts.at(-1);
    let separator = '';
    if (previous) {
      const estimatedEnd = previous.x === null ? null : previous.x + previous.width;
      const gap = estimatedEnd === null || item.x === null ? null : item.x - estimatedEnd;
      const joinsPunctuation = /^[,.;:!?%\])}]/u.test(item.text);
      const previousEndsSpace = /\s$/u.test(previous.text);
      if (!previousEndsSpace && !joinsPunctuation && (gap === null || gap > -0.5)) separator = ' ';
    }
    current.text += separator + item.text;
    current.parts.push(item);
    if (current.y === null && item.y !== null) current.y = item.y;
    current.orientation = item.orientation;
    if (item.height > current.height) current.y = item.y;
    current.height = Math.max(current.height, item.height);
    current.forcedBreak = item.hasEOL;
  }

  function linesFromPdfTextContent(textContent) {
    const items = Array.isArray(textContent?.items) ? textContent.items : [];
    const lines = [];
    let current = { text: '', parts: [], y: null, height: 0, forcedBreak: false };
    const flush = () => {
      const text = normalizedInlineText(current.text);
      const positioned = current.parts.filter(part => part.x !== null);
      const rects = current.parts.map(part => part.pdfRect).filter(Boolean);
      lines.push({ text, y: current.y, itemCount: current.parts.length,
        orientation: current.orientation,
        xMin: positioned.length ? Math.min(...positioned.map(part => part.x)) : null,
        xMax: positioned.length ? Math.max(...positioned.map(part => part.x + part.width)) : null,
        height: current.height,
        pdfRect: rects.length ? { left: Math.min(...rects.map(rect => rect.left)),
          right: Math.max(...rects.map(rect => rect.right)),
          bottom: Math.min(...rects.map(rect => rect.bottom)),
          top: Math.max(...rects.map(rect => rect.top)) } : null });
      current = { text: '', parts: [], y: null, height: 0, forcedBreak: false };
    };
    items.filter(item => typeof item?.str === 'string').map(textItemCoordinate).forEach(item => {
      if (shouldBreakPdfLine(current, item)) flush();
      appendPdfItem(current, item);
      // Defer EOL until the next item so an adjacent scientific script can
      // stay with its visual baseline; ordinary EOL still forces a break.
    });
    if (current.parts.length) flush();
    return lines;
  }

  function nativePdfPageLines(page) {
    if (typeof page?.text === 'string') {
      return page.text.replace(/\r\n?/g, '\n').split('\n')
        .map(text => ({ text: normalizedInlineText(text), y: null, itemCount: 0 }));
    }
    const lines = linesFromPdfTextContent(page?.textContent);
    const view = Array.isArray(page?.view) && page.view.length === 4 ? page.view
      : Number(page?.width) > 0 && Number(page?.height) > 0
        ? [0, 0, Number(page.width), Number(page.height)] : null;
    if (!view || !view.every(Number.isFinite) || typeof shared.classifyPdfPageFurnitureSegments !== 'function') {
      return lines;
    }
    // The classifier consumes screen coordinates. Raw item transforms belong
    // to the unrotated PDF view; preserve their baseline/orientation separately
    // for caption flow and convert only the furniture classification rectangle.
    return shared.classifyPdfPageFurnitureSegments(lines.map(line => ({ ...line,
      rect: line.pdfRect ? { left: line.pdfRect.left - view[0], right: line.pdfRect.right - view[0],
        top: view[3] - line.pdfRect.top, bottom: view[3] - line.pdfRect.bottom } : null
    })), { left: 0, top: 0, right: view[2] - view[0], bottom: view[3] - view[1] },
    { pageNumber: page.pageNumber });
  }

  function parseCaptionHeader(value) {
    const text = normalizedInlineText(value);
    const match = text.match(HEADER_PATTERN);
    if (!match) return null;
    const number = Number(match[3]);
    if (!Number.isInteger(number) || number < 1 || number > 999) return null;
    const prefix = match[1].toLowerCase();
    const explicitSupplemental = Boolean(match[2]) || prefix.startsWith('supplement');
    const extended = prefix.startsWith('extended');
    const figureSeries = extended ? 'extended-data'
      : explicitSupplemental ? 'supplemental' : 'main';
    const figureCode = extended ? `ED${number}` : `${explicitSupplemental ? 'S' : ''}${number}`;
    const body = normalizedInlineText(match[5]);
    // Supplement/video references are not a second caption for the main Figure.
    if (/^(?:figure\s+supplements?|source\s+data|videos?|animations?)\b/iu.test(body)) return null;
    const hasDelimiter = normalizedInlineText(match[4]) !== '';
    if (body && BODY_REFERENCE_START.test(body)) return null;
    if (body && !hasDelimiter && /^(?:and|or|see|also|above|below|in|from|of|for)\b/iu.test(body)) {
      return null;
    }
    if (/\.{3,}\s*\d{1,4}\s*$/u.test(body) || /^\.{2,}/u.test(body)) return null;
    return {
      figureNumber: number,
      figureCode,
      figureSeries,
      isSupplemental: figureSeries !== 'main',
      figureId: extended ? `figure-ed${number}` : `figure-${figureCode.toLowerCase()}`,
      figureLabel: extended ? `Extended Data Figure ${number}` : `Figure ${figureCode}`,
      header: text,
      body,
      hasDelimiter
    };
  }

  function conservativePanelHints(caption) {
    const panels = new Set();
    const addRange = (first, last = first) => {
      const start = first.charCodeAt(0);
      const end = last.charCodeAt(0);
      if (start < 65 || end > 90 || end < start || end - start > 25) return;
      for (let code = start; code <= end; code += 1) panels.add(String.fromCharCode(code));
    };
    // Panel notation is not a prose word: (a-\nd) still denotes a range.
    // Parse the retained caption lines without word dehyphenation.
    const text = String(caption || '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
      .slice(0, MAX_CAPTION_CHARS);
    for (const match of text.matchAll(/\bpanels?\s+([A-Z])(?:\s*[-\u2010-\u2015\u2212]\s*([A-Z]))?(?![\p{L}\p{N}]|\s*[-\u2010-\u2015\u2212]\s*\p{L})/giu)) {
      addRange(match[1].toUpperCase(), (match[2] || match[1]).toUpperCase());
    }
    // Bare A) and a, markers need a caption clause boundary and a following
    // description. Do not reinterpret unit suffixes (200 μ M), variables or
    // word fragments as labels. Lists/ranges enumerate only explicit syntax.
    const raw = String(caption || '').normalize('NFKC').slice(0, MAX_CAPTION_CHARS);
    for (const match of raw.matchAll(/(?:^|[.!?]\s+|\n\s*)([a-z](?:\s*[-\u2010-\u2015\u2212]\s*[a-z])?)\)\s+(?=\p{Lu}|\p{Ll}\p{Lu})/gu)) {
      const parts = match[1].toUpperCase().split(/\s*[-\u2010-\u2015\u2212]\s*/u);
      addRange(parts[0], parts[1] || parts[0]);
    }
    for (const match of raw.matchAll(/(?:^|[.!?]\s+|\n\s*)([A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?)\)\s+(?=\p{Lu}|\p{Ll}\p{Lu})/gu)) {
      const parts = match[1].split(/\s*[-\u2010-\u2015\u2212]\s*/u);
      addRange(parts[0], parts[1] || parts[0]);
    }
    for (const match of raw.matchAll(/(?:^|[.!?]\s+|\n\s*)((?:[a-z],\s*)+)(?=\p{Lu})/gu)) {
      for (const label of match[1].match(/[a-z]/gu)) addRange(label.toUpperCase(), label.toUpperCase());
    }
    // PDF legends commonly use lower-case (i), which is a panel, not a Roman
    // numeral. Accept letter lists/ranges but not units or word suffixes: (s).
    for (const match of text.matchAll(/\(\s*([a-z](?:\s*(?:,|and|&|[-\u2010-\u2015\u2212])\s*[a-z])*)\s*\)/giu)) {
      const before = text.slice(0, match.index);
      if (/[\p{L}\p{N}]$/u.test(before)) continue;
      if (/\b(?:fig(?:ure)?s?\.?|图)\s*(?:s\s*)?\d+[a-z]?\s*$/iu.test(before)) continue;
      const value = match[1].toUpperCase();
      if (/^[A-Z]$/u.test(value) && /(?:voltage|current|distance|length|height|width|diameter|power|temperature|time|duration|latency|mass|weight|volume|frequency|pressure|energy|charge|resistance|concentration|seconds?)\s*$/iu.test(before)) continue;
      // A bare time unit is not a panel label. A true S in an A-S series is
      // still admitted by an explicit range or "Panel S" above.
      if (value === 'S' && /(?:time|duration|latency|seconds?|\d)\s*$/iu.test(before)) continue;
      for (const part of value.split(/\s*(?:,|AND|&)\s*/u)) {
        const range = part.match(/^([A-Z])(?:\s*[-\u2010-\u2015\u2212]\s*([A-Z]))?$/u);
        if (range) addRange(range[1], range[2] || range[1]);
      }
    }
    return [...panels].sort();
  }

  function captionPanelHints(rawCaption) {
    const repairs = [];
    // Some PDF font maps expose a printed range dash as U+0001. Only admit
    // a bracketed ascending letter range when an explicit following label
    // supports the sequence. Keep this inference out of canonical source text.
    const repaired = rawCaption.replace(/\(([a-z])\s*\u0001\s*([a-z])\)/giu,
      (rawText, first, last, offset) => {
        const before = rawCaption.slice(0, offset).trimEnd();
        const after = rawCaption.slice(offset + rawText.length).trimStart();
        // Recover only a clause-opening caption label followed by a normal
        // capitalized description. A newline alone can be a wrapped formula;
        // inline variables and references to another figure are not labels.
        if (!/[.!?]$/u.test(before) || !/^\p{Lu}/u.test(after) ||
            /\b(?:fig(?:ure)?|eq(?:uation)?|formula|variable)s?\.?\s*(?:\d+[a-z]?\s*)?$/iu.test(before)) return rawText;
        const from = first.toUpperCase().charCodeAt(0);
        const to = last.toUpperCase().charCodeAt(0);
        const next = String.fromCharCode(to + 1);
        if (from >= to || to >= 90 ||
            !conservativePanelHints(rawCaption.slice(offset + rawText.length)).includes(next)) return rawText;
        const replacement = `(${first}–${last})`;
        repairs.push({ rawText, replacement, rawStart: offset, rawEnd: offset + rawText.length,
          reason: 'pdf-control-glyph-in-supported-panel-range' });
        return replacement;
      });
    return { panelHints: conservativePanelHints(repaired), panelHintRepairs: repairs,
      unresolvedControlGlyphs: /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(repaired) };
  }

  function parseCaptionContinuation(value) {
    const match = normalizedInlineText(value).match(
      /^(.+?)\s*[.:]?\s*\(?continued(\s+on\s+(?:the\s+)?next\s+page)?\)?\s*\.?$/iu
    );
    const identity = match ? parseCaptionHeader(`${match[1].replace(/[.:]\s*$/u, '')}.`) : null;
    return identity ? { ...identity, direction: match[2] ? 'outgoing' : 'incoming' } : null;
  }

  function isCaptionBoundary(line) {
    const text = normalizedInlineText(line);
    return Boolean(
      CAPTION_BOUNDARY_PATTERN.test(text) ||
      /^(?:the online version\b|figure\s+supplement\b|source\s+data\b|https?:\/\/|research article\b)/iu.test(text) ||
      /\bDOI:\s*https?:\/\//iu.test(text) ||
      /^fig(?:ure)?\.?\s*\d+\s*[\u2010-\u2015-]\s*(?:figure supplements?|videos?|source data)\b/iu.test(text) ||
      /^table\s+(?:S\s*)?\d{1,3}\b/iu.test(text) ||
      /^\d{1,4}\s*$/u.test(text)
    );
  }

  function isAnonymousOutgoingLegend(value) {
    return /^\(?(?:legend|caption)\s+continued\s+on\s+(?:the\s+)?next\s+page\)?\.?$/iu
      .test(normalizedInlineText(value));
  }

  function compatibleCaptionLine(line, previous, anchor) {
    return line?.y != null && previous?.height > 0 &&
      line.orientation === previous.orientation &&
      line.height <= previous.height * 1.08 && line.height >= previous.height * 0.85 &&
      Math.abs((line.xMin || 0) - (anchor.xMin || 0)) <= 28;
  }

  function isScientificSuperscript(line, previous) {
    return /^\d{1,4}$/u.test(line?.text || '') && previous?.y != null &&
      line.y > previous.y && line.y - previous.y <= previous.height * 0.8 &&
      line.height < previous.height * 0.85 && line.orientation === previous.orientation &&
      Math.abs(line.xMin - previous.xMax) <= previous.height * 2;
  }

  function captionQuality(identity, caption, reasons) {
    const body = normalizedCaption(caption).replace(
      new RegExp('^' + identity.figureLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[.:|\\-]?\\s*', 'iu'),
      ''
    );
    const words = body.match(/[\p{L}\p{N}]+/gu) || [];
    if (body.length < 18 || words.length < 3) reasons.add('short-caption');
    if (!TERMINAL_CAPTION.test(body)) reasons.add('open-caption-boundary');
    return body;
  }

  function captionColumnFlow(page, lineIndex, identity) {
    const anchor = page.lines[lineIndex];
    const width = page.view ? page.view[2] - page.view[0] : 0;
    if (!(width > 0) || anchor.orientation !== 0 || !(anchor.height > 0) ||
        anchor.xMin > width * 0.4 || anchor.xMax > width * 0.55) return null;
    const topCandidates = page.lines.map((line, index) => ({ line, index })).filter(({line,index}) =>
      index > lineIndex && line.text && !line.furniture &&
      line.orientation === anchor.orientation && line.xMin >= width * 0.48 &&
      line.xMin > anchor.xMax + anchor.height &&
      Math.abs(line.y - anchor.y) <= anchor.height * 0.6 &&
      line.height >= anchor.height * 0.85 && line.height <= anchor.height * 1.08);
    if (topCandidates.length !== 1) return null;
    const right = topCandidates[0];
    // Preserve explicit Figure ownership even if source order is unusual.
    if (page.lines.slice(lineIndex + 1, right.index + 1).some(line => {
      const header = parseCaptionHeader(line.text);
      return header && header.figureId !== identity.figureId;
    })) return null;
    const collect = (start, xMin, xMax) => {
      const members = [];
      let previous = null;
      for (let index = start; index < page.lines.length; index += 1) {
        const line = page.lines[index];
        if (!line.text || line.furniture) continue;
        // A new Figure owns everything below its title, even when the title
        // spans both columns and would otherwise be skipped by the lane filter.
        if (index !== lineIndex && parseCaptionHeader(line.text)) break;
        if (line.orientation !== anchor.orientation || line.xMin < xMin - 12 ||
            line.xMax > xMax || line.y > anchor.y + anchor.height * 0.6) continue;
        if (isCaptionBoundary(line.text) || line.height < anchor.height * 0.85 ||
            line.height > anchor.height * 1.08 || previous &&
            (previous.y - line.y > anchor.height * 2.2 || line.y - previous.y > anchor.height * 0.8)) break;
        members.push(index);
        previous = line;
        if (members.length >= MAX_LINES_PER_CAPTION || isAnonymousOutgoingLegend(line.text) ||
            parseCaptionContinuation(line.text)) break;
      }
      return members;
    };
    const left = collect(lineIndex, anchor.xMin, right.line.xMin - anchor.height);
    const rightLines = collect(right.index, right.line.xMin, width);
    if (left.length < 2 || rightLines.length < 2) return null;
    const leftText = left.map(index => page.lines[index].text).join('\n');
    const rightText = rightLines.map(index => page.lines[index].text).join('\n');
    const leftLabels = captionPanelHints(leftText).panelHints;
    const rightLabels = captionPanelHints(rightText).panelHints;
    const openContinuation = !TERMINAL_CAPTION.test(leftText) &&
      /^[\p{Ll}(]/u.test(right.line.text);
    if (!leftLabels.length || !(rightLabels.some(label => !leftLabels.includes(label)) || openContinuation)) return null;
    const leftBottom = page.lines[left.at(-1)].y, rightBottom = page.lines[rightLines.at(-1)].y;
    const overlap = anchor.y - Math.max(leftBottom, rightBottom);
    if (overlap < anchor.height || Math.min(leftBottom,rightBottom) < 0) return null;
    const selected = [...left.slice(1), ...rightLines];
    const chosen = new Set(selected);
    const indexed = page.lines.map((line,index) => ({ ...line, captionSourceIndex: index }));
    return { ...page, lines: [...indexed.slice(0,lineIndex + 1),
      ...selected.map(index => indexed[index]),
      ...indexed.slice(lineIndex + 1).filter(line => !chosen.has(line.captionSourceIndex))],
      captionRegionEnd: lineIndex + 1 + selected.length };
  }

  function unmarkedCaptionRegion(next, previousPage, previousLine, anchor, rawCaption, identity) {
    const width = next.view ? next.view[2] - next.view[0] : 0;
    const height = next.view ? next.view[3] - next.view[1] : 0;
    const previousHeight = previousPage.view ? previousPage.view[3] - previousPage.view[1] : 0;
    const labels = captionPanelHints(rawCaption).panelHints;
    const lastLabel = labels.at(-1);
    if (!(width > 0 && height > 0 && previousHeight > 0) ||
        previousLine.orientation !== 0 || previousLine.y > previousHeight * 0.25 ||
        anchor.xMax - anchor.xMin < width * 0.65 || !/^[A-Y]$/u.test(lastLabel || '')) return -1;
    const expected = String.fromCharCode(lastLabel.charCodeAt(0) + 1);
    const candidates = [];
    let band = [], previous = null, owner = '';
    const finish = () => {
      if (band.length < 2) return;
      const first = next.lines[band[0]];
      const hints = captionPanelHints(band.slice(0, MAX_LINES_PER_CAPTION)
        .map(index => next.lines[index].text).join('\n')).panelHints;
      if (/^\p{Ll}/u.test(first.text) && first.xMax - first.xMin >= width * 0.65 &&
          hints.includes(expected) && hints.filter(label => label > lastLabel).length >= 2) {
        candidates.push(band[0]);
      }
    };
    for (let index = 0; index < next.lines.length; index += 1) {
      const line = next.lines[index];
      if (line.furniture || !line.text) continue;
      const header = parseCaptionHeader(line.text);
      if (header) owner = header.figureId;
      const compatible = (!owner || owner === identity.figureId) && !header &&
        !isCaptionBoundary(line.text) && line.y <= height * 0.25 &&
        compatibleCaptionLine(line, previousLine, anchor);
      const connected = previous && previous.y - line.y <= previousLine.height * 2.2 &&
        line.y - previous.y <= previousLine.height * 0.8;
      if (!compatible || !connected) { finish(); band = []; }
      if (compatible) band.push(index);
      previous = compatible ? line : null;
    }
    finish();
    // A label alone cannot choose a region, and competing regions stay partial.
    return candidates.length === 1 ? candidates[0] : -1;
  }

  function collectCaptionCandidate(pages, pageIndex, lineIndex, identity, options = {}) {
    const page = captionColumnFlow(pages[pageIndex], lineIndex, identity) || pages[pageIndex];
    const captionLineEvidence = [];
    const remember = (owner, index) => {
      const line = owner.lines[index];
      captionLineEvidence.push({ pageNumber: owner.pageNumber, lineIndex: line.captionSourceIndex ?? index,
        text: line.text, geometry: { y: line.y, xMin: line.xMin, xMax: line.xMax,
          height: line.height, orientation: line.orientation } });
    };
    remember(page, lineIndex);
    const diagnostics = [];
    const trace = (reason, owner = page, index = lineIndex, phase = 'caption') => {
      if (!options.collectCaptionDiagnostics) return;
      const line = owner.lines[index];
      diagnostics.push({ reason, phase, pageNumber: owner.pageNumber, lineIndex: line?.captionSourceIndex ?? index,
        text: String(line?.text || '').slice(0, 240),
        geometry: line ? { y: line.y, xMin: line.xMin, xMax: line.xMax,
          height: line.height, orientation: line.orientation } : null });
    };
    const reasons = new Set();
    const pieces = [identity.header];
    let consumedLines = 1;
    let endedByBoundary = false;
    let endedAtPage = false;
    let explicitContinuation = false;
    let anonymousContinuation = false;
    let lastCaptionLine = page.lines[lineIndex];
    const isContinuation = (line, direction) => {
      const marker = parseCaptionContinuation(line);
      return marker?.figureId === identity.figureId && marker.direction === direction;
    };
    if (identity.header.length > MAX_CAPTION_CHARS) reasons.add('caption-truncated');
    let scanIndex = lineIndex + 1;
    for (;
      scanIndex < page.lines.length && consumedLines < MAX_LINES_PER_CAPTION &&
        !reasons.has('caption-truncated');
      scanIndex += 1) {
      if (scanIndex === page.captionRegionEnd) {
        trace('caption-column-region-end', page, scanIndex);
        endedByBoundary = true;
        break;
      }
      if (page.lines[scanIndex].furniture) continue;
      const line = page.lines[scanIndex].text;
      if (isAnonymousOutgoingLegend(line)) {
        explicitContinuation = true;
        anonymousContinuation = true;
        endedByBoundary = true;
        trace('anonymous-outgoing-continuation', page, scanIndex);
        break;
      }
      if (parseCaptionContinuation(line)) {
        explicitContinuation = isContinuation(line, 'outgoing');
        trace(explicitContinuation ? 'outgoing-continuation' : 'other-continuation', page, scanIndex);
        endedByBoundary = true;
        break;
      }
      if (!line) {
        // PDF.js emits empty EOL items immediately before a line at the same
        // baseline. These are not actual blank paragraphs.
        if (page.lines[scanIndex].y != null) continue;
        if (pieces.length > 1) {
          trace('blank-line', page, scanIndex);
          endedByBoundary = true;
          break;
        }
        continue;
      }
      if (parseCaptionHeader(line) || isCaptionBoundary(line) &&
          !isScientificSuperscript(page.lines[scanIndex], lastCaptionLine)) {
        trace(parseCaptionHeader(line) ? 'next-caption' : 'section-boundary', page, scanIndex);
        endedByBoundary = true;
        break;
      }
      const positioned = page.lines[scanIndex];
      const previousLine = lastCaptionLine;
      // Object order can interleave a remote page header between caption
      // clauses. Skip it only when a later line demonstrably resumes the
      // same caption baseline/column/font flow. Never reorder body islands.
      const anchor = page.lines[lineIndex];
      if (positioned.y != null && anchor.y != null &&
          positioned.y > anchor.y + Math.max(anchor.height, positioned.height, 2) &&
          page.lines.slice(scanIndex + 1).some(next => next.text && !next.furniture &&
            compatibleCaptionLine(next, previousLine, anchor) && next.y <= previousLine.y &&
            previousLine.y - next.y <= Math.max(previousLine.height, next.height) * 2.2)) {
        trace('skip-interleaved-above-caption', page, scanIndex);
        continue;
      }
      const captionEnded = TERMINAL_CAPTION.test(pieces.at(-1) || '');
      // PDF object order can jump from the bottom caption back to an earlier
      // body island. This remains a boundary even if the caption is unfinished.
      const returnsAboveCaption = previousLine?.y != null && positioned.y != null &&
        positioned.orientation === previousLine.orientation &&
        positioned.y - previousLine.y > Math.max(previousLine.height || 0, positioned.height || 0, 2) * 0.8 &&
        !(page.captionRegionEnd && positioned.xMin > previousLine.xMax &&
          scanIndex < page.captionRegionEnd);
      const orientationBoundary = captionEnded &&
        positioned.orientation !== undefined && previousLine?.orientation !== undefined &&
        positioned.orientation !== previousLine.orientation;
      const followingBody = captionEnded && previousLine?.y !== null && positioned.y !== null &&
        previousLine?.height > 0 && positioned.height >= previousLine.height * 1.08 &&
        previousLine.y - positioned.y >= Math.max(previousLine.height, positioned.height) * 1.7;
      const detachedSmallText = captionEnded && previousLine?.y != null && positioned.y != null &&
        previousLine.height > 0 && positioned.height < previousLine.height * 0.85 &&
        previousLine.y - positioned.y > previousLine.height * 2.8;
      const pageHeaderAfterCaption = captionEnded && positioned.y !== null &&
        page.lines[lineIndex].y !== null && positioned.y > page.lines[lineIndex].y &&
        new RegExp(`^${page.pageNumber}\\s+\\p{L}`, 'u').test(line);
      const runningHeader = /^(?:articles?|research article)$/iu.test(line);
      if (returnsAboveCaption || followingBody || detachedSmallText || pageHeaderAfterCaption || orientationBoundary || runningHeader) {
        for (const [reason, stopped] of Object.entries({ 'returns-above-caption': returnsAboveCaption,
          'following-body': followingBody, 'page-header': pageHeaderAfterCaption,
          'detached-small-text': detachedSmallText,
          'orientation-change': orientationBoundary, 'running-header': runningHeader })) {
          if (stopped) trace(reason, page, scanIndex);
        }
        endedByBoundary = true;
        break;
      }
      pieces.push(line);
      remember(page, scanIndex);
      lastCaptionLine = positioned;
      consumedLines += 1;
      if (pieces.join(' ').length >= MAX_CAPTION_CHARS) {
        trace('character-budget', page, scanIndex);
        reasons.add('caption-truncated');
        break;
      }
    }
    if (!endedByBoundary && scanIndex >= page.lines.length) {
      endedAtPage = true;
      trace('page-end', page, scanIndex);
    }
    if (!endedByBoundary && scanIndex < page.lines.length &&
        consumedLines >= MAX_LINES_PER_CAPTION) {
      reasons.add('caption-truncated');
      trace('line-budget', page, scanIndex);
    }
    let rawCaption = pieces.join('\n');
    let caption = normalizedCaption(rawCaption);
    const pageNumbers = [page.pageNumber];
    const captionSegments = [{ pageNumber: page.pageNumber, text: caption }];
    const rawCaptionSegments = [{ pageNumber: page.pageNumber, text: rawCaption }];
    let continuationPageIndex = pageIndex;
    while (!reasons.has('caption-truncated') &&
        (explicitContinuation || endedAtPage && !TERMINAL_CAPTION.test(caption))) {
      const next = pages[continuationPageIndex + 1];
      if (!next || next.pageNumber !== pages[continuationPageIndex].pageNumber + 1) {
        trace('missing-adjacent-page', pages[continuationPageIndex], -1, 'continuation');
        reasons.add('missing-caption-continuation');
        break;
      }
      let marker = -1;
      next.lines.forEach((line, index) => {
        if (isContinuation(line.text, 'incoming') && (marker < 0 || line.y !== null &&
            (next.lines[marker].y === null || line.y > next.lines[marker].y))) marker = index;
      });
      let anonymousAnchor = -1;
      let unmarkedRegion = false;
      if (marker < 0 && anonymousContinuation) {
        // Explicit outgoing legend + one observed next clause + matching
        // typography/column is required. This does not invent any panel.
        const labels = captionPanelHints(rawCaption).panelHints;
        const lastLabel = labels.at(-1);
        const expected = /^[A-Y]$/u.test(lastLabel || '')
          ? String.fromCharCode(lastLabel.charCodeAt(0) + 1) : '';
        const candidates = [];
        let observedCaptionOwner = '';
        for (let index = 0; expected && index < next.lines.length; index += 1) {
          const line = next.lines[index];
          if (line.furniture) continue;
          const header = parseCaptionHeader(line.text);
          if (header) observedCaptionOwner = header.figureId;
          if (observedCaptionOwner && observedCaptionOwner !== identity.figureId) continue;
          if (new RegExp(`^\\(${expected}\\)\\s+`, 'iu').test(line.text) &&
              compatibleCaptionLine(line, lastCaptionLine, page.lines[lineIndex])) {
            candidates.push({line, index});
          }
        }
        if (candidates.length === 1) {
          anonymousAnchor = candidates[0].index;
          trace('anonymous-incoming-clause', next, anonymousAnchor, 'continuation');
        }
      }
      if (marker < 0 && anonymousAnchor < 0 && !explicitContinuation && endedAtPage) {
        anonymousAnchor = unmarkedCaptionRegion(next, pages[continuationPageIndex],
          lastCaptionLine, page.lines[lineIndex], rawCaption, identity);
        unmarkedRegion = anonymousAnchor >= 0;
        if (anonymousAnchor >= 0) trace('unmarked-caption-region', next, anonymousAnchor, 'continuation');
      }
      const opening = next.lines.find(line => line.text && !line.furniture);
      const openingLine = opening?.text || '';
      if (marker < 0 && anonymousAnchor < 0 && (explicitContinuation || parseCaptionHeader(openingLine) ||
          parseCaptionContinuation(openingLine))) {
        trace('missing-incoming-marker', next, next.lines.indexOf(opening), 'continuation');
        reasons.add('missing-caption-continuation');
        break;
      }
      const previousCaptionLine = lastCaptionLine;
      if (marker < 0 && anonymousAnchor < 0 && opening?.y != null && previousCaptionLine?.y != null &&
          (opening.orientation !== previousCaptionLine.orientation ||
            opening.height > previousCaptionLine.height * 1.08 ||
            opening.height < previousCaptionLine.height * 0.85 ||
            Math.abs((opening.xMin || 0) - (page.lines[lineIndex].xMin || 0)) > 28)) {
        trace('opening-geometry-mismatch', next, next.lines.indexOf(opening), 'continuation');
        reasons.add('missing-caption-continuation');
        break;
      }
      const continuation = [];
      const markerY = marker >= 0 ? next.lines[marker].y : null;
      const captionX = page.lines[lineIndex].xMin ?? next.lines[marker]?.xMin;
      // Continuation captions can be extracted after the body even though
      // they appear at the top of the original page. Use their PDF baseline.
      const continuationLines = anonymousAnchor >= 0
        ? next.lines.slice(anonymousAnchor).filter(line => !line.furniture)
        : marker >= 0 && markerY !== null
        ? next.lines.filter(line => !line.furniture && line.text && line.y !== null && line.y < markerY &&
            (captionX == null || line.xMin == null ||
              line.xMin >= captionX - 12 && line.xMin <= captionX + 28))
          .sort((a, b) => b.y - a.y)
        : next.lines.slice(marker >= 0 ? marker + 1 : 0).filter(line => !line.furniture);
      const continuationLimit = marker >= 0 || anonymousAnchor >= 0 ? continuationLines.length
        : Math.min(6, continuationLines.length);
      explicitContinuation = false;
      anonymousContinuation = false;
      endedByBoundary = false;
      let continuationIndex = 0;
      for (; continuationIndex < continuationLimit; continuationIndex += 1) {
        const line = continuationLines[continuationIndex];
        if (!line.text && line.y != null) continue;
        if (isAnonymousOutgoingLegend(line.text)) {
          explicitContinuation = true;
          anonymousContinuation = true;
          endedByBoundary = true;
          trace('anonymous-outgoing-continuation', next, next.lines.indexOf(line), 'continuation');
          break;
        }
        if (parseCaptionContinuation(line.text)) {
          explicitContinuation = isContinuation(line.text, 'outgoing');
          trace(explicitContinuation ? 'outgoing-continuation' : 'other-continuation',
            next, next.lines.indexOf(line), 'continuation');
          endedByBoundary = true;
          break;
        }
        if (anonymousAnchor >= 0 && continuation.length &&
            (unmarkedRegion && !compatibleCaptionLine(line, previousCaptionLine, page.lines[lineIndex]) ||
              line.orientation !== lastCaptionLine.orientation ||
              line.y - lastCaptionLine.y > Math.max(line.height, lastCaptionLine.height, 2) * 0.8 ||
              lastCaptionLine.y - line.y > Math.max(line.height, lastCaptionLine.height, 2) * 2.2 ||
              line.height > previousCaptionLine.height * 1.08)) {
          trace('continuation-geometry-boundary', next, next.lines.indexOf(line), 'continuation');
          endedByBoundary = true;
          break;
        }
        if (!line.text || isCaptionBoundary(line.text) &&
            !isScientificSuperscript(line, lastCaptionLine) || parseCaptionHeader(line.text)) {
          trace(!line.text ? 'blank-line' : parseCaptionHeader(line.text) ? 'next-caption' : 'section-boundary',
            next, next.lines.indexOf(line), 'continuation');
          endedByBoundary = true;
          break;
        }
        if (consumedLines >= MAX_LINES_PER_CAPTION) {
          trace('line-budget', next, next.lines.indexOf(line), 'continuation');
          reasons.add('caption-truncated');
          break;
        }
        continuation.push(line.text);
        remember(next, next.lines.indexOf(line));
        lastCaptionLine = line;
        consumedLines += 1;
        if (caption.length + 1 + continuation.join(' ').length > MAX_CAPTION_CHARS) {
          trace('character-budget', next, next.lines.indexOf(line), 'continuation');
          reasons.add('caption-truncated');
          break;
        }
        if (marker < 0 && anonymousAnchor < 0 && TERMINAL_CAPTION.test(line.text)) {
          trace('unmarked-terminal-line', next, next.lines.indexOf(line), 'continuation');
          endedByBoundary = true;
          break;
        }
      }
      if (!continuation.length) {
        trace('empty-continuation', next, -1, 'continuation');
        reasons.add('missing-caption-continuation');
        break;
      }
      const previousLength = caption.length;
      const rawContinuation = continuation.join('\n');
      rawCaption += '\n' + rawContinuation;
      caption = normalizedCaption([caption, rawContinuation].join(' '));
      const continuationText = caption.slice(previousLength + 1);
      if (continuationText) {
        captionSegments.push({ pageNumber: next.pageNumber, text: continuationText });
        rawCaptionSegments.push({ pageNumber: next.pageNumber, text: rawContinuation });
        pageNumbers.push(next.pageNumber);
        reasons.add('cross-page-caption');
      }
      endedAtPage = !endedByBoundary && continuationIndex >= continuationLines.length;
      if (!endedByBoundary && !endedAtPage) {
        reasons.add('caption-truncated');
        trace('continuation-line-limit', next, -1, 'continuation');
      }
      if (endedAtPage) trace('page-end', next, -1, 'continuation');
      continuationPageIndex += 1;
    }
    const body = captionQuality(identity, caption, reasons);
    if (!body) return null;
    const panelInfo = captionPanelHints(rawCaption);
    // Unknown missing glyphs can be scientific signs or numeric separators.
    // Do not turn their canonical removal into an apparently complete caption.
    if (panelInfo.unresolvedControlGlyphs) reasons.add('unresolved-caption-control-glyph');
    if (!identity.hasDelimiter) reasons.add('header-without-delimiter');
    if (!endedByBoundary && !endedAtPage) reasons.add('caption-boundary-uncertain');
    return {
      ...identity,
      ...(options.collectCaptionDiagnostics ? { captionDiagnostics: diagnostics } : {}),
      caption,
      captionSegments,
      captionLineEvidence,
      rawCaptionSegments,
      captionComplete: !['missing-caption-continuation', 'caption-truncated',
        'open-caption-boundary', 'caption-boundary-uncertain',
        'unresolved-caption-control-glyph'].some(reason => reasons.has(reason)),
      panelHints: panelInfo.panelHints,
      panelHintRepairs: panelInfo.panelHintRepairs,
      contextParagraphs: [],
      captionElement: null,
      element: null,
      imageElements: [],
      analysisImages: [],
      documentOrder: pageIndex * 1000 + lineIndex,
      sourceKind: 'pdf-page-caption',
      imageEvidence: 'full-page',
      pageNumber: page.pageNumber,
      pageNumbers,
      captionPageNumbers: [...pageNumbers],
      artworkPageNumbers: [page.pageNumber],
      artworkPageEvidence: 'caption-anchor-page',
      // A caption anchor cannot prove that artwork does not precede/follow it.
      artworkCoverage: 'partial',
      needsReview: reasons.size > 0,
      reviewReasons: [...reasons],
      boundaryConfidence: reasons.size ? 'review' : 'high'
    };
  }

  function candidateScore(candidate) {
    return Math.min(candidate.caption.length, MAX_CAPTION_CHARS) / 100 +
      candidate.panelHints.length * 20 - candidate.reviewReasons.length * 40 +
      (candidate.hasDelimiter ? 200 : 0);
  }

  function mergeDuplicateCandidate(previous, candidate) {
    const left = normalizedCaption(previous.caption).toLowerCase();
    const right = normalizedCaption(candidate.caption).toLowerCase();
    const compatible = left === right || left.includes(right) || right.includes(left);
    const winner = candidateScore(candidate) > candidateScore(previous) ? candidate : previous;
    // Divergent body references must never move a genuine caption/image to an
    // earlier page or add unrelated full pages to the model's image inputs.
    const pageNumbers = [...winner.pageNumbers];
    const reviewReasons = new Set(winner.reviewReasons);
    if (!compatible) reviewReasons.add('divergent-duplicate-caption');
    return {
      ...winner,
      pageNumber: winner.pageNumber,
      pageNumbers,
      captionPageNumbers: Array.isArray(winner.captionPageNumbers)
        ? [...winner.captionPageNumbers] : [...pageNumbers],
      artworkPageNumbers: Array.isArray(winner.artworkPageNumbers)
        ? [...winner.artworkPageNumbers] : [winner.pageNumber],
      artworkPageEvidence: winner.artworkPageEvidence || 'caption-anchor-page',
      artworkCoverage: winner.artworkCoverage === 'partial' ? 'partial' : 'complete',
      needsReview: winner.needsReview || !compatible,
      reviewReasons: [...reviewReasons],
      boundaryConfidence: winner.needsReview || !compatible ? 'review' : 'high',
      duplicateCaptionCount: (Number(previous.duplicateCaptionCount) || 1) + 1
    };
  }

  function extractNativePdfFigures(input, options = {}) {
    const sourceFingerprint = String(options.sourceFingerprint || (
      !Array.isArray(input) && (input?.documentHash || input?.documentFingerprint)
    ) || '').trim();
    const pages = (Array.isArray(input) ? input : Array.isArray(input?.pages) ? input.pages : [])
      .slice(0, MAX_PAGES)
      .map(page => ({
        pageNumber: positivePageNumber(page?.pageNumber),
        view: Array.isArray(page?.view) ? page.view : null,
        lines: nativePdfPageLines(page)
      }))
      .filter(page => page.pageNumber && page.lines.length)
      .sort((left, right) => left.pageNumber - right.pageNumber);
    const byId = new Map();
    pages.forEach((page, pageIndex) => {
      page.lines.forEach((line, lineIndex) => {
        if (line.furniture) return;
        if (parseCaptionContinuation(line.text)) return;
        const identity = parseCaptionHeader(line.text);
        if (!identity) return;
        const extracted = collectCaptionCandidate(pages, pageIndex, lineIndex, identity, options);
        const candidate = extracted ? { ...extracted, sourceFingerprint } : null;
        if (!candidate) return;
        const previous = byId.get(candidate.figureId);
        byId.set(candidate.figureId,
          previous ? mergeDuplicateCandidate(previous, candidate) : candidate);
      });
    });
    const limit = Math.max(0, Math.min(300, Number(options.limit) || 300));
    return [...byId.values()]
      .sort((left, right) => left.documentOrder - right.documentOrder)
      .slice(0, limit);
  }

  function manifestImage(images, figure, index) {
    if (typeof images === 'function') return images(figure, index);
    if (images instanceof Map) return images.get(figure.figureId) ?? images.get(index);
    if (images && typeof images === 'object') {
      return images[figure.figureId] ?? images[index] ?? null;
    }
    return null;
  }

  function manifestIdentity(figure, index) {
    const parsed = parseCaptionHeader(
      `${String(figure?.figureLabel || '').trim()}. ${String(figure?.caption || '').trim()}`
    );
    if (parsed) return parsed;
    const figureId = String(figure?.figureId || '').trim();
    const extended = /^figure-ed(\d{1,3})$/iu.exec(figureId);
    const ordinary = /^figure-(s?)(\d{1,3})$/iu.exec(figureId);
    const number = Number(figure?.figureNumber) || Number(extended?.[1] || ordinary?.[2]);
    if (!Number.isInteger(number) || number < 1 || number > 999) return null;
    const isSupplemental = figure?.kind === 'supplemental' || figure?.isSupplemental === true ||
      Boolean(ordinary?.[1]);
    const figureSeries = extended ? 'extended-data' : isSupplemental ? 'supplemental' : 'main';
    const figureCode = extended ? `ED${number}` : `${isSupplemental ? 'S' : ''}${number}`;
    return {
      figureNumber: number,
      figureCode,
      figureSeries,
      isSupplemental: figureSeries !== 'main',
      figureId: extended ? `figure-ed${number}` : `figure-${figureCode.toLowerCase()}`,
      figureLabel: extended ? `Extended Data Figure ${number}` : `Figure ${figureCode}`,
      header: '', body: '', hasDelimiter: true, fallbackIndex: index
    };
  }

  function normalizePdfManifestInventory(manifest, images = null) {
    const values = Array.isArray(manifest?.figures) ? manifest.figures.slice(0, 300) : [];
    return values.flatMap((figure, index) => {
      if (!figure || typeof figure !== 'object') return [];
      const identity = manifestIdentity(figure, index);
      if (!identity) return [];
      const pageNumber = positivePageNumber(figure.pageNumber) ||
        positivePageNumber(Number(figure.pageIndex) + 1);
      const pageNumbers = [...new Set((Array.isArray(figure.captionPageNumbers)
        ? figure.captionPageNumbers
        : Array.isArray(figure.pageNumbers) ? figure.pageNumbers : [pageNumber])
        .map(positivePageNumber).filter(Boolean))]
        .sort((a, b) => a - b);
      const explicitArtworkPages = Array.isArray(figure.artworkPageNumbers);
      const artworkPageNumbers = [...new Set((explicitArtworkPages
        ? figure.artworkPageNumbers : [pageNumber])
        .map(positivePageNumber).filter(Boolean))];
      const suppliedImage = manifestImage(images, figure, index);
      const imageElements = Array.isArray(suppliedImage)
        ? suppliedImage.filter(Boolean)
        : suppliedImage?.element ? [suppliedImage.element]
          : suppliedImage && typeof suppliedImage === 'object' && suppliedImage.nodeType === 1
            ? [suppliedImage] : [];
      const caption = normalizedCaption(figure.caption);
      const needsReview = !caption || !pageNumbers.length || !artworkPageNumbers.length;
      return [{
        ...identity,
        caption,
        panelHints: Array.isArray(figure.panelHints)
          ? [...new Set(figure.panelHints.map(value => String(value).toUpperCase())
            .filter(value => /^[A-Z]$/u.test(value)))].slice(0, 26)
          : conservativePanelHints(caption),
        contextParagraphs: [],
        captionElement: null,
        element: null,
        imageElements,
        analysisImages: [],
        imageSource: typeof suppliedImage === 'string' ? suppliedImage
          : String(suppliedImage?.dataUrl || suppliedImage?.url || ''),
        imageAssetPath: String(figure.image?.workspacePath || figure.imageAssetPath || ''),
        imageSha256: String(figure.image?.sha256 || figure.imageSha256 || ''),
        documentOrder: index,
        sourceKind: 'pdf-figure-manifest',
        imageEvidence: 'whole-figure',
        pageNumber: pageNumbers[0] || 0,
        pageNumbers,
        captionPageNumbers: [...pageNumbers],
        artworkPageNumbers,
        artworkPageEvidence: explicitArtworkPages ? 'manifest' : 'caption-anchor-page',
        artworkCoverage: explicitArtworkPages && artworkPageNumbers.length > 0 &&
          figure.artworkCoverage === 'complete' ? 'complete' : 'partial',
        needsReview,
        reviewReasons: [!caption ? 'missing-caption' : '',
          !pageNumbers.length ? 'missing-page-number' : '',
          !artworkPageNumbers.length ? 'missing-artwork-pages' : ''].filter(Boolean),
        boundaryConfidence: needsReview ? 'review' : 'high',
        sourceFingerprint: String(manifest?.documentFingerprint || ''),
        sourceDocumentFingerprint: String(manifest?.documentFingerprint || '')
      }];
    });
  }

  async function createEffectivePdfFigureInventory(input = {}) {
    const figure = input.figure;
    const documentHash = String(input.documentHash || '');
    const sourceRevision = input.sourceRevision;
    if (!/^[a-f0-9]{64}$/u.test(documentHash) || figure?.sourceFingerprint !== documentHash ||
        !/^(?:figure-(?:s|ed)?\d{1,3})$/u.test(figure?.figureId || '') ||
        !(typeof sourceRevision === 'string' && sourceRevision.length > 0 && sourceRevision.length <= 128 ||
          Number.isSafeInteger(sourceRevision) && sourceRevision >= 0)) {
      throw new Error('PDF_EFFECTIVE_INVENTORY_BINDING_INVALID');
    }
    const expectedScope = figure.figureId.startsWith('figure-ed') ? 'extended-data'
      : figure.figureId.startsWith('figure-s') ? 'supplemental' : 'main';
    if (figure.figureSeries !== expectedScope) throw new Error('PDF_EFFECTIVE_INVENTORY_SCOPE_INVALID');
    const digest = async value => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(JSON.stringify(value))))).map(x => x.toString(16).padStart(2, '0')).join('');
    const evidence = Array.isArray(figure.captionLineEvidence) ? figure.captionLineEvidence : [];
    const labels = [...new Set(figure.panelHints || [])];
    if (labels.length > 30 || labels.some(label => !/^[A-Z](?:\d{0,2})?$/u.test(label))) {
      throw new Error('PDF_EFFECTIVE_INVENTORY_PANELS_INVALID');
    }
    const panels = labels.map(label => ({ panelId: `${figure.figureId}:panel:${label}`, label,
      discoveries: evidence.filter(line => captionPanelHints(line.text).panelHints.includes(label))
        .map(line => ({ method: 'caption', pageNumber: line.pageNumber,
          lineStart: line.lineIndex, lineEnd: line.lineIndex, geometry: { ...line.geometry },
          confidence: 'explicit', reviewRequired: false })) }));
    for (const panel of panels) {
      if (!panel.discoveries.length) panel.discoveries.push({ method: 'caption',
        pageNumber: figure.pageNumber, lineStart: null, lineEnd: null,
        confidence: 'unresolved-line', reviewRequired: true });
    }
    let coverage = null;
    let imageDigestKind = 'none';
    let visualAssets = [];
    if (input.visualInventory != null) {
      const context = input.visualContext;
      if (context?.documentHash !== documentHash || context.sourceRevision !== sourceRevision ||
          context.figureId !== figure.figureId ||
          JSON.stringify(context.captionKnownPanels) !== JSON.stringify(labels) ||
          typeof shared.validatePdfFigurePanelInventory !== 'function') {
        throw new Error('PDF_EFFECTIVE_INVENTORY_VISUAL_BINDING_INVALID');
      }
      // The caller must obtain context from current independently verified
      // owner/image/semantic evidence, never from the model's returned binding.
      coverage = shared.validatePdfFigurePanelInventory(input.visualInventory, context);
      imageDigestKind = coverage.version === shared.PDF_FIGURE_PANEL_INVENTORY_SET_VERSION
        ? 'visual-evidence-set' : 'full-figure-image';
      const normalizedContext = shared.normalizePdfFigurePanelInventoryContext(context);
      visualAssets = imageDigestKind === 'visual-evidence-set'
        ? coverage.provenance.imageManifest.map(({pageNumber, imageContentHash}) => ({pageNumber, imageContentHash}))
        : normalizedContext.artworkPageNumbers.length === 1
          ? [{ pageNumber: normalizedContext.artworkPageNumbers[0], imageContentHash: coverage.provenance.imageContentHash }]
          : [];
      if (!visualAssets.length) throw new Error('PDF_EFFECTIVE_INVENTORY_VISUAL_ASSETS_INCOMPLETE');
      for (const marker of coverage.markers.filter(row => row.clarity === 'clear')) {
        let panel = panels.find(row => row.label === marker.label);
        if (!panel) {
          panel = { panelId: `${figure.figureId}:panel:${marker.label}`, label: marker.label, discoveries: [] };
          panels.push(panel);
        }
        panel.discoveries.push({ method: 'visual', pageNumber: marker.pageNumber || context.artworkPageNumbers?.[0] || context.pageNumbers[0],
          lineStart: null, lineEnd: null, confidence: 'clear', reviewRequired: false });
      }
    }
    const result = { version: 'pdf-effective-figure-inventory-v1', documentHash, sourceRevision,
      scope: expectedScope, figureId: figure.figureId,
      provenance: { extractorVersion: 'native-caption-v3',
        captionDigest: await digest({ caption: figure.caption, evidence }),
        semanticContextDigest: coverage?.provenance.semanticContextDigest || '',
        imageContentHash: coverage?.provenance.imageContentHash || '',
        visualEvidenceSetDigest: coverage?.provenance.visualEvidenceSetDigest || '', imageDigestKind,
        visualAssets, visualAssetCoverage: coverage ? 'complete' : 'none' },
      panels, completeness: { captionBoundary: figure.captionComplete === true ? 'complete' : 'partial',
        inventoryCoverage: coverage?.coverageComplete === true ? 'complete' : 'partial',
        artworkCoverage: figure.artworkCoverage === 'complete' ? 'complete' : 'partial',
        analysisResult: 'not-evaluated' },
      reviewReasons: [...new Set([...(figure.reviewReasons || []),
        ...(coverage?.uncertainPanels.length ? ['uncertain-visual-markers'] : [])])] };
    result.inventoryRevision = await digest(result);
    const freeze = value => { if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze); Object.freeze(value);
    } return value; };
    return freeze(result);
  }

  return {
    createEffectivePdfFigureInventory,
    linesFromPdfTextContent,
    nativePdfPageLines,
    parseNativePdfFigureCaptionHeader: parseCaptionHeader,
    extractNativePdfFigures,
    normalizePdfManifestInventory
  };
});
