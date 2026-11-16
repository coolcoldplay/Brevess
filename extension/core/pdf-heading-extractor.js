(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const canonical = value => String(value || '').normalize('NFKC')
    .replace(/\s+/gu, ' ').trim();
  const headingMatchKey = value => canonical(value).toUpperCase();
  const clamp = (value, minimum, maximum) => Math.max(minimum,
    Math.min(maximum, Number(value) || 0));

  function segmentPdfGraphemes(value) {
    const rawText = String(value || '');
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(rawText)]
        .map(item => ({ segment: item.segment, index: item.index }));
    }
    const output = [];
    let index = 0;
    const isMark = character => /^\p{M}$/u.test(character) ||
      /^[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]$/u.test(character);
    const isJamo = character => /^[\u1100-\u11FF\uA960-\uA97F\uD7B0-\uD7FF]$/u
      .test(character);
    for (const character of rawText) {
      const previous = output.at(-1);
      const join = previous && (isMark(character) || character === '\u200D' ||
        previous.segment.endsWith('\u200D') ||
        (isJamo(character) && [...previous.segment].every(isJamo)));
      if (join) previous.segment += character;
      else output.push({ segment: character, index });
      index += character.length;
    }
    return output;
  }

  function normalizedProjection(value) {
    const rawText = String(value || '');
    const normalized = [];
    const starts = [];
    const ends = [];
    const segments = segmentPdfGraphemes(rawText);
    let pendingWhitespace = null;
    for (const entry of segments) {
      const start = entry.index;
      const end = start + entry.segment.length;
      if (/^\s+$/u.test(entry.segment)) {
        pendingWhitespace ||= { start, end };
        pendingWhitespace.end = end;
        continue;
      }
      if (pendingWhitespace && normalized.length) {
        normalized.push(' ');
        starts.push(pendingWhitespace.start);
        ends.push(pendingWhitespace.end);
      }
      pendingWhitespace = null;
      // Fold before indexing so expansions (for example ß -> SS) retain raw offsets.
      const text = entry.segment.normalize('NFKC').toUpperCase();
      for (let offset = 0; offset < text.length; offset += 1) {
        normalized.push(text[offset]);
        starts.push(start);
        ends.push(end);
      }
    }
    return { text: normalized.join(''), starts, ends };
  }

  function headingLevel(text, fallback = 2) {
    const match = canonical(text).match(/^(\d+(?:\.\d+)*)[.)]?\s+/u);
    if (match) return clamp(match[1].split('.').length + 1, 2, 6);
    return clamp(fallback, 1, 6) || 2;
  }

  function withinPage(x, y, page = {}) {
    const width = Number(page.pageWidth) || Math.abs(Number(page.view?.[2]) - Number(page.view?.[0]));
    const height = Number(page.pageHeight) || Math.abs(Number(page.view?.[3]) - Number(page.view?.[1]));
    return x >= 0 && y >= 0 && (!width || x <= width) && (!height || y <= height);
  }

  function validatePdfQuadPoints(value, page = {}) {
    const points = Array.isArray(value) ? value.map(Number) : [];
    if (points.length < 8 || points.length % 8 !== 0 || !points.every(Number.isFinite)) return [];
    const epsilon = 1e-7;
    const cross = (a, b, c) => (b.x - a.x) * (c.y - b.y) -
      (b.y - a.y) * (c.x - b.x);
    for (let offset = 0; offset < points.length; offset += 8) {
      const pdfOrder = [0, 1, 2, 3].map(index => ({
        x: points[offset + index * 2], y: points[offset + index * 2 + 1]
      }));
      if (!pdfOrder.every(point => withinPage(point.x, point.y, page))) return [];
      const unique = new Set(pdfOrder.map(point => `${point.x}:${point.y}`));
      if (unique.size !== 4) return [];
      const xs = pdfOrder.map(point => point.x);
      const ys = pdfOrder.map(point => point.y);
      if (Math.max(...xs) - Math.min(...xs) <= epsilon ||
          Math.max(...ys) - Math.min(...ys) <= epsilon) return [];
      const polygon = [pdfOrder[0], pdfOrder[1], pdfOrder[3], pdfOrder[2]];
      const turns = polygon.map((point, index) => cross(point,
        polygon[(index + 1) % 4], polygon[(index + 2) % 4]));
      if (turns.some(turn => Math.abs(turn) <= epsilon) ||
          !(turns.every(turn => turn > 0) || turns.every(turn => turn < 0))) return [];
      const twiceArea = Math.abs(polygon.reduce((sum, point, index) => {
        const next = polygon[(index + 1) % 4];
        return sum + point.x * next.y - next.x * point.y;
      }, 0));
      if (twiceArea <= epsilon) return [];
    }
    return points;
  }

  function candidateGeometry(span, pageNumber, start, end, page = {}) {
    const quadPoints = validatePdfQuadPoints(span?.quadPoints, page);
    if (quadPoints.length) {
      return { kind: 'quad', pageNumber, quadPoints };
    }
    const rect = span?.rect;
    const values = rect && [rect.left, rect.top, rect.right, rect.bottom].map(Number);
    if (values?.every(Number.isFinite) && values[2] > values[0] && values[3] > values[1] &&
        withinPage(values[0], values[1], page) && withinPage(values[2], values[3], page)) {
      return { kind: 'rect', pageNumber, rect: {
        left: values[0], top: values[1], right: values[2], bottom: values[3]
      } };
    }
    return { kind: 'page-range-fallback', pageNumber, start, end };
  }

  function pageLines(page = {}) {
    const raw = String(page.text || '');
    const supplied = (Array.isArray(page.spans) ? page.spans : []).map((item, order) => {
      const text = String(item?.text ?? '');
      const start = Number.isInteger(item?.start) ? item.start : raw.indexOf(text);
      const end = Number.isInteger(item?.end) ? item.end : start + text.length;
      return start >= 0 && end > start && end <= raw.length
        ? { ...item, text, start, end, order } : null;
    }).filter(Boolean);
    if (supplied.length) return supplied.sort((left, right) =>
      left.start - right.start || left.order - right.order);
    const lines = [];
    const pattern = /[^\r\n]+/gu;
    let match;
    while ((match = pattern.exec(raw))) {
      lines.push({ text: match[0], start: match.index,
        end: match.index + match[0].length, order: lines.length });
    }
    return lines;
  }

  function isFurniture(line, page, repeatedFurniture) {
    const normalized = canonical(line.text).toLowerCase();
    if (!normalized) return true;
    const rect = line.rect;
    const height = Number(page.pageHeight) || 0;
    const topRatio = rect && height > 0 ? Number(rect.top) / height : NaN;
    const bottomRatio = rect && height > 0 ? Number(rect.bottom) / height : NaN;
    if (repeatedFurniture.has(normalized) &&
        (!Number.isFinite(topRatio) || topRatio <= 0.1 || bottomRatio >= 0.9)) return true;
    return /^(?:research article|article|neuroscience|doi\b|https?:\/\/|\d+\s+of\s+\d+)$/iu
      .test(normalized);
  }

  function isKnownSectionHeading(text) {
    const value = canonical(text);
    const firstLetter = value.match(/\p{L}/u)?.[0] || '';
    return /^(?:abstract|introduction|background|results?|discussion|conclusions?|methods?|materials(?: and methods)?|references|acknowledg(?:e)?ments?|摘要|引言|结果|讨论|结论|方法|材料与方法)$/iu.test(value) &&
      (!firstLetter || firstLetter === firstLetter.toUpperCase());
  }

  function inferSectionFonts(pages) {
    const fonts = new Map();
    let totalCharacters = 0;
    for (const page of pages) {
      for (const line of pageLines(page)) {
        const size = canonical(line.text).length;
        totalCharacters += size;
        const name = String(line.fontName || '');
        if (!name) continue;
        const entry = fonts.get(name) || { characters: 0, anchors: new Set() };
        entry.characters += size;
        if (isKnownSectionHeading(line.text)) entry.anchors.add(headingMatchKey(line.text));
        fonts.set(name, entry);
      }
    }
    // PDF.js font IDs often hide weight. Learn only a distinct, uncommon section
    // font supported by multiple section names; never learn the main body font.
    return new Set([...fonts].filter(([, entry]) => entry.anchors.size >= 2 &&
      entry.characters <= totalCharacters * 0.35).map(([name]) => name));
  }

  function adjacentTitleRow(left, right) {
    const valid = rect => rect && [rect.left, rect.top, rect.right, rect.bottom]
      .every(Number.isFinite) && rect.right > rect.left && rect.bottom > rect.top;
    if (!valid(left) || !valid(right)) return false;
    const height = Math.min(left.bottom - left.top, right.bottom - right.top);
    return Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) >= height * 0.65 &&
      right.left >= left.right - 0.5 && right.left - left.right <= Math.max(3, height * 0.8);
  }

  function fallbackTitleLines(page, sectionFonts) {
    const output = [];
    const lines = pageLines(page);
    const validRect = rect => rect && [rect.left, rect.top, rect.right, rect.bottom]
      .every(Number.isFinite) && rect.right > rect.left && rect.bottom > rect.top;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index], next = lines[index + 1];
      const previous = output.at(-1), before = previous?.lastRect, rect = line.rect;
      const fontSize = Number(line.fontSize) || 0;
      const styled = sectionFonts.has(String(line.fontName || '')) || line.bold === true ||
        /(?:bold|black|semibold|demi)/iu.test(String(line.fontName || ''));
      const symbolBridge = previous && /^[\p{S}\p{P}]$/u.test(line.text) &&
        sectionFonts.has(String(previous.fontName || '')) && next?.fontName === previous.fontName &&
        adjacentTitleRow(before, rect) && adjacentTitleRow(rect, next.rect);
      const sameStyle = previous && ((styled && line.fontName === previous.fontName) || symbolBridge) &&
        Math.abs(fontSize - (Number(previous.fontSize) || 0)) <= Math.max(0.2, fontSize * 0.05);
      let adjacent = false;
      if (sameStyle && validRect(before) && validRect(rect)) {
        const height = Math.min(before.bottom - before.top, rect.bottom - rect.top);
        const overlap = Math.min(before.bottom, rect.bottom) - Math.max(before.top, rect.top);
        adjacent = (overlap >= height * 0.65 && rect.left >= before.right - 0.5 &&
          rect.left - before.right <= Math.max(3, height * 0.8)) ||
          (rect.top >= before.top && rect.top - before.bottom >= -0.2 &&
          rect.top - before.bottom <= Math.max(3, height * 0.65) &&
          Math.abs(rect.left - previous.rect.left) <= Math.max(3, height * 0.3));
      }
      const combined = previous ? page.text.slice(previous.start, line.end) : '';
      if (adjacent && previous.memberCount < 4 && canonical(combined).length <= 180 &&
          !isKnownSectionHeading(previous.text) && !/[.!?。！？]$/u.test(canonical(previous.text)) &&
          /^\s*$/u.test(page.text.slice(previous.end, line.start))) {
        previous.text = combined;
        previous.end = line.end;
        previous.rect = { left: Math.min(previous.rect.left, rect.left),
          top: Math.min(previous.rect.top, rect.top), right: Math.max(previous.rect.right, rect.right),
          bottom: Math.max(previous.rect.bottom, rect.bottom) };
        previous.quadPoints = null;
        previous.lastRect = rect;
        previous.memberCount += 1;
      } else output.push({ ...line, memberCount: 1, lastRect: rect });
    }
    return output;
  }

  function isNegativeHeading(text, maximumLength = 76) {
    const value = canonical(text);
    if (!value) return true;
    if (/^(?:fig(?:ure)?|table|supplementary\s+(?:fig(?:ure)?|table)|图|表)\s*[\dA-Z一二三四五六七八九十]*[.:：]?/iu
      .test(value)) return true;
    if (/^\[\d+\]\s+/u.test(value)) return true;
    if (/^(?:[A-Za-z]\s*=|[+−–—=<>≤≥±∑∫∆Δ]|p\s*[<=>])|[=±∑∫∆Δ]\s*\S/u.test(value)) return true;
    if (/\s{2,}[-+−]?\d+(?:\.\d+)?(?:\s*±\s*\d+(?:\.\d+)?)?/u.test(String(text))) return true;
    if (value.length > maximumLength || (value.length > 38 && /[.!?。！？]$/u.test(value))) return true;
    return false;
  }

  function captionRowMembers(lines) {
    const excluded = new Set();
    const rows = [];
    for (const line of lines) {
      const rect = line.rect;
      const valid = rect && [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) &&
        rect.right > rect.left && rect.bottom > rect.top;
      const previous = rows.at(-1), before = previous?.rect;
      const height = valid ? rect.bottom - rect.top : 0;
      const overlap = before && valid ? Math.min(before.bottom, rect.bottom) -
        Math.max(before.top, rect.top) : 0;
      // Bound context to neighbouring fragments on one physical row. A caption
      // in another column or a real section below it is independent evidence.
      const sameRow = before && valid &&
        overlap >= Math.min(height, before.bottom - before.top) * 0.4 &&
        rect.left >= before.left - 2 && rect.left - before.right <=
          Math.max(3, Math.min(height, before.bottom - before.top) * 0.8);
      if (sameRow) {
        previous.lines.push(line);
        previous.rect = { left: Math.min(before.left, rect.left), top: Math.min(before.top, rect.top),
          right: Math.max(before.right, rect.right), bottom: Math.max(before.bottom, rect.bottom) };
      } else rows.push({ lines: [line], rect: valid ? { ...rect } : null });
    }
    for (const row of rows) {
      const value = canonical(row.lines.map(line => line.text).join(' '));
      if (/^(?:(?:fig(?:ure)?|table|supplementary\s+(?:fig(?:ure)?|table))\b|图|表)/iu.test(value)) {
        for (const line of row.lines) excluded.add(line);
      }
    }
    return excluded;
  }

  function isBareNumberBodyContinuation(line, previous) {
    // A bare quantity in a continuous prose run is weak section-number evidence.
    // Keep explicit numbering and independently styled or spaced titles intact.
    if (!/^\d+\s+\p{Ll}/u.test(canonical(line?.text)) || !previous ||
        canonical(previous.text).length < 22 ||
        (line.bold === true) !== (previous.bold === true)) return false;
    const rect = line.rect, before = previous.rect;
    const fontSize = Number(line.fontSize), previousSize = Number(previous.fontSize);
    if (!rect || !before || ![rect.left, rect.top, rect.right, rect.bottom,
      before.left, before.top, before.right, before.bottom, fontSize, previousSize]
      .every(Number.isFinite) || rect.right <= rect.left || rect.bottom <= rect.top ||
      before.right <= before.left || before.bottom <= before.top ||
      fontSize <= 0 || previousSize <= 0) return false;
    const gap = rect.top - before.bottom;
    return String(line.fontName || '') === String(previous.fontName || '') &&
      Math.abs(fontSize - previousSize) <= Math.max(0.2, fontSize * 0.05) &&
      Math.abs(rect.left - before.left) <= 2 &&
      gap >= -0.2 && gap <= Math.max(3, fontSize * 0.65);
  }

  function joinFragmentedPdfHeadings(headings, pages, sectionFonts) {
    const validRect = rect => rect && [rect.left, rect.top, rect.right, rect.bottom]
      .every(Number.isFinite) && rect.right > rect.left && rect.bottom > rect.top;
    const removed = new Set();
    const replacements = new Map();
    for (const page of pages) {
      const spans = pageLines(page);
      const candidates = headings.filter(heading => heading.pageNumber === page.pageNumber &&
        heading.source === 'inferred' && heading.signals?.sectionFont &&
        heading.geometry?.kind === 'rect');
      const members = heading => spans.filter(span => span.start >= heading.start && span.end <= heading.end);
      for (const first of candidates) {
        if (removed.has(first) || !/\p{L}-$/u.test(first.normalizedText)) continue;
        const firstMembers = members(first);
        const font = firstMembers[0]?.fontName;
        const size = Number(firstMembers[0]?.fontSize);
        const before = first.geometry.rect;
        if (!sectionFonts.has(font) || !validRect(before) || !(size > 0) ||
            !firstMembers.length || firstMembers.some(span => span.fontName !== font ||
              Math.abs(Number(span.fontSize) - size) > Math.max(0.2, size * 0.05))) continue;
        const continuations = candidates.filter(next => {
          if (next === first || removed.has(next) || next.start <= first.end ||
              !/^\p{Ll}/u.test(next.normalizedText)) return false;
          const rect = next.geometry.rect;
          if (!validRect(rect) || Math.abs(rect.left - before.left) > Math.max(3, size * 0.3) ||
              rect.top - before.bottom < -0.2 ||
              rect.top - before.bottom > Math.max(3, size * 0.65) ||
              rect.bottom - rect.top > size * 1.1) return false;
          const pieces = members(next);
          return pieces.length > 0 && pieces.every(span => span.fontName === font &&
            Math.abs(Number(span.fontSize) - size) <= Math.max(0.2, size * 0.05) &&
            validRect(span.rect));
        });
        // Do not choose between ambiguous neighbouring rows or columns.
        if (continuations.length !== 1) continue;
        const next = continuations[0];
        const row = members(next).sort((left, right) => left.rect.left - right.rect.left);
        const titleParts = [];
        let ambiguous = false;
        for (let index = 0; index < row.length; index += 1) {
          const part = row[index], after = row[index + 1];
          titleParts.push(part);
          if (!after) continue;
          // A smaller, raised sign must be geometrically between two same-font
          // title pieces. Its raw position may precede both due to PDF ordering.
          const signs = spans.filter(span => /^[+−]$/u.test(span.text) &&
            span.fontName === font && validRect(span.rect) &&
            Number(span.fontSize) >= size * 0.5 && Number(span.fontSize) <= size * 0.85 &&
            span.rect.left >= part.rect.right - 0.5 &&
            span.rect.left - part.rect.right <= Math.max(2, size * 0.3) &&
            after.rect.left >= span.rect.right - 0.5 &&
            after.rect.left - span.rect.right <= Math.max(3, size * 0.5) &&
            span.rect.top >= part.rect.top - size * 0.65 &&
            span.rect.top <= part.rect.top + size * 0.2 &&
            span.rect.bottom > part.rect.top + size * 0.25 &&
            span.rect.bottom <= part.rect.bottom + 0.5);
          if (signs.length > 1) { ambiguous = true; break; }
          if (signs.length) titleParts.push(signs[0]);
        }
        if (ambiguous) continue;
        const titleMembers = new Set([...firstMembers, ...titleParts]);
        const right = Math.max(before.right, next.geometry.rect.right);
        // Other-column text may occur between raw offsets. Any intervening
        // same-column item means this is not a safe continuous physical title.
        if (spans.some(span => !titleMembers.has(span) && validRect(span.rect) &&
            span.rect.left < right && span.rect.right > before.left &&
            span.rect.top < next.geometry.rect.bottom && span.rect.bottom > before.top)) continue;
        const titleRanges = [{ start: first.start, end: first.end },
          ...titleParts.map(part => ({ start: part.start, end: part.end }))];
        const sorted = [...titleRanges].sort((left, right) => left.start - right.start);
        if (sorted.some((range, index) => !Number.isInteger(range.start) ||
            !Number.isInteger(range.end) || range.start < 0 || range.end > page.text.length ||
            range.end <= range.start || (index && range.start < sorted[index - 1].end))) continue;
        const normalizedText = canonical(titleRanges.map(range => page.text.slice(range.start, range.end)).join(' '))
          .replace(/-\s+(?=\p{Ll})/gu, '-').replace(/\s+([+−])(?=\s|$)/gu, '$1');
        if (normalizedText.length > 180) continue;
        // Keep identity, rawText and focus geometry anchored to the original
        // first continuous slice. Only these disjoint ranges are title text.
        replacements.set(first, { ...first, normalizedText, titleRanges });
        removed.add(next);
      }
    }
    return headings.filter(heading => !removed.has(heading))
      .map(heading => replacements.get(heading) || heading);
  }

  function analyzePdfHeadings(input = {}) {
    const documentHash = canonical(input.documentHash).replace(/^sha256:/u, '').toLowerCase();
    const revision = Number.isFinite(Number(input.revision)) ? Number(input.revision) : 0;
    const pages = (Array.isArray(input.pages) ? input.pages : [])
      .map(page => ({ ...page, pageNumber: Math.max(1, Math.floor(Number(page.pageNumber) || 1)),
        text: String(page.text || '') }))
      .sort((left, right) => left.pageNumber - right.pageNumber);
    const appearances = new Map();
    for (const page of pages) {
      for (const line of pageLines(page)) {
        const key = canonical(line.text).toLowerCase();
        if (!key) continue;
        const set = appearances.get(key) || new Set();
        set.add(page.pageNumber);
        appearances.set(key, set);
      }
    }
    const repeatedFurniture = new Set([...appearances]
      .filter(([, pageNumbers]) => pageNumbers.size >= 2).map(([key]) => key));
    const pageMap = new Map(pages.map(page => [page.pageNumber, page]));
    const accepted = new Map();
    const outlineEntries = [];
    const outlineParents = [];

    for (const outline of Array.isArray(input.outline) ? input.outline : []) {
      const pageNumber = Number.isSafeInteger(outline?.pageNumber) && outline.pageNumber > 0
        ? outline.pageNumber : null;
      const page = pageMap.get(pageNumber);
      const title = canonical(outline?.title);
      const rawOutlineLevel = Number(outline?.level);
      const outlineLevel = Number.isSafeInteger(rawOutlineLevel) && rawOutlineLevel > 0
        ? rawOutlineLevel : 1;
      while (outlineParents.length && outlineParents.at(-1).level >= outlineLevel) outlineParents.pop();
      const structure = { outlineId: `pdf-outline:${documentHash}:${outlineEntries.length}`,
        parentOutlineId: outlineParents.at(-1)?.outlineId || null, title,
        outlinePath: Array.isArray(outline?.outlinePath) ? [...outline.outlinePath] : null,
        targetLeft: typeof outline?.targetLeft === 'number' && Number.isFinite(outline.targetLeft)
          ? outline.targetLeft : null,
        destinationKind: String(outline?.destinationKind || ''), order: outlineEntries.length };
      outlineParents.push({ outlineId: structure.outlineId, level: outlineLevel });
      if (!page || !title) {
        outlineEntries.push({ ...structure, status: 'unresolved', reason: !page ? 'page-unavailable' : 'empty-title',
          pageNumber, level: outlineLevel });
        continue;
      }
      const lines = pageLines(page);
      const titleKey = headingMatchKey(title);
      let candidates = lines.filter(item => headingMatchKey(item.text) === titleKey);
      if (!candidates.length) {
        const projection = normalizedProjection(page.text);
        let from = 0;
        while (from <= projection.text.length - titleKey.length) {
          const normalizedStart = projection.text.indexOf(titleKey, from);
          if (normalizedStart < 0) break;
          const normalizedEnd = normalizedStart + titleKey.length;
          const start = projection.starts[normalizedStart];
          const end = projection.ends[normalizedEnd - 1];
          const matched = lines.filter(item => item.end > start && item.start < end);
          const completeTitleLines = matched.length &&
            headingMatchKey(page.text.slice(matched[0].start, matched.at(-1).end)) === titleKey &&
            matched.every((item, index) => {
              const r = item.rect;
              if (!r || ![r.left, r.top, r.right, r.bottom].every(Number.isFinite) ||
                  r.right <= r.left || r.bottom <= r.top) return false;
              if (!index) return true;
              const previous = matched[index - 1].rect, h = r.bottom - r.top;
              const overlap = Math.min(previous.bottom, r.bottom) - Math.max(previous.top, r.top);
              return (overlap >= Math.min(h, previous.bottom - previous.top) * 0.4 &&
                r.left >= previous.left && r.left - previous.right <= Math.max(24, h * 2.8)) ||
                (r.top >= previous.top && r.top - previous.bottom <= Math.max(8, h * 1.5) &&
                Math.abs(r.left - matched[0].rect.left) <= Math.max(24, h * 2));
            });
          from = normalizedStart + Math.max(1, titleKey.length);
          // Preserve the existing exact-case substring fallback. New case-insensitive
          // matches must cover complete, geometrically continuous title lines.
          if (!completeTitleLines && canonical(page.text.slice(start, end)) !== title) continue;
          const rect = completeTitleLines ? {
            left: Math.min(...matched.map(item => item.rect.left)),
            top: Math.min(...matched.map(item => item.rect.top)),
            right: Math.max(...matched.map(item => item.rect.right)),
            bottom: Math.max(...matched.map(item => item.rect.bottom))
          } : null;
          candidates.push({ text: page.text.slice(start, end), start, end,
            ...(rect ? { rect, fontSize: Math.max(...matched.map(item => Number(item.fontSize) || 0)) } : {}) });
        }
      }
      const rawTargetTop = outline?.targetTop;
      const hasTarget = typeof rawTargetTop === 'number' && Number.isFinite(rawTargetTop);
      const targetTop = hasTarget ? rawTargetTop : null;
      if (hasTarget) {
        candidates = candidates.map(line => ({ line,
          verticalDistance: line.rect ? Math.abs(Number(line.rect.top) - targetTop) : Infinity,
          distance: line.rect ? Math.hypot(Math.abs(Number(line.rect.top) - targetTop),
            typeof outline.targetLeft === 'number' && Number.isFinite(outline.targetLeft)
              ? Math.max(line.rect.left - outline.targetLeft, 0, outline.targetLeft - line.rect.right) : 0) : Infinity }))
          .sort((left, right) => left.distance - right.distance);
      }
      let line = hasTarget ? candidates[0]?.line : candidates[0];
      let reason = '';
      if (!line) reason = 'title-not-found';
      else if (!hasTarget && candidates.length > 1) reason = 'ambiguous-title-without-target';
      else if (hasTarget) {
        const distance = candidates[0].distance;
        const tolerance = Math.max(24, (Number(line.fontSize) || 10) * 2.5);
        // PDF destinations can use the page margin for X. It disambiguates
        // columns, while the existing Y tolerance remains the acceptance gate.
        if (!Number.isFinite(distance) || candidates[0].verticalDistance > tolerance) reason = 'target-coordinate-mismatch';
        else if (candidates.length > 1 && Math.abs(candidates[1].distance - distance) < 0.001) {
          reason = 'ambiguous-title-at-target';
        }
      }
      if (reason) {
        outlineEntries.push({ ...structure, status: 'unresolved', reason, pageNumber,
          level: outlineLevel, targetTop: hasTarget ? targetTop : null });
        continue;
      }
      const start = line.start;
      const end = line.end;
      const key = `${pageNumber}:${start}:${end}`;
      const headingId = `pdf-heading:${documentHash}:${revision}:${pageNumber}:${start}:${end}`;
      const resolved = {
        ...structure, status: 'resolved', pageNumber, start, end, level: outlineLevel,
        targetTop: hasTarget ? targetTop : null,
        targetDistance: hasTarget ? Number(candidates[0].distance.toFixed(3)) : null,
        headingId
      };
      outlineEntries.push(resolved);
      accepted.set(key, {
        headingId,
        pageNumber, rawText: page.text.slice(start, end), normalizedText: title,
        start, end, level: clamp(outlineLevel, 1, 6),
        confidence: hasTarget ? 0.99 : 0.96, source: 'outline', range: { pageNumber, start, end },
        outlineTarget: { status: 'resolved', targetTop: resolved.targetTop,
          distance: resolved.targetDistance },
        geometry: candidateGeometry(line, pageNumber, start, end, page),
        correction: { allowed: true, mode: 'replace-or-remove' }
      });
    }

    const sectionFonts = inferSectionFonts(pages);
    for (const page of pages) {
      const lines = fallbackTitleLines(page, sectionFonts);
      const captionMembers = captionRowMembers(lines);
      const fontSizes = lines.map(line => Number(line.fontSize)).filter(value => value > 0)
        .sort((left, right) => left - right);
      const bodySize = fontSizes.length ? fontSizes[Math.floor((fontSizes.length - 1) / 2)] : 10;
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const value = canonical(line.text);
        const sectionFont = sectionFonts.has(String(line.fontName || ''));
        if (captionMembers.has(line) || isFurniture(line, page, repeatedFurniture) ||
            isNegativeHeading(line.text, sectionFont && line.memberCount > 1 ? 180 : 76)) continue;
        const numbered = /^(?:\d+(?:\.\d+)*|[IVXLC]+)[.)]?\s+\p{L}/iu.test(value) &&
          !isBareNumberBodyContinuation(line, lines[index - 1]);
        const known = isKnownSectionHeading(value);
        const fontSize = Number(line.fontSize) || bodySize;
        const enlarged = fontSize >= bodySize * 1.18;
        const bold = line.bold === true || /(?:bold|black|semibold|demi)/iu.test(String(line.fontName || ''));
        const short = value.length <= 58;
        const next = lines[index + 1];
        // A section word inside a plain same-row run (for example "Nat. Methods 9")
        // is not an independent heading. Distinct heading typography remains valid.
        if (known && !sectionFont && !bold && !enlarged && adjacentTitleRow(line.rect, next?.rect)) continue;
        const gap = line.rect && next?.rect
          ? Number(next.rect.top) - Number(line.rect.bottom) : 0;
        const spaced = Number.isFinite(gap) && gap >= Math.max(8, fontSize * 0.65);
        const adjacentBody = next && canonical(next.text).length >= 22 &&
          !sectionFonts.has(String(next.fontName || '')) &&
          !isNegativeHeading(canonical(next.text).replace(/[.!?。！？]$/u, ''), Infinity);
        let confidence = 0;
        if (numbered) confidence += 0.36;
        if (known) confidence += 0.5;
        else if (sectionFont) confidence += 0.5;
        if (sectionFont && line.memberCount > 1) confidence += 0.08;
        if (enlarged) confidence += 0.18;
        if (bold) confidence += 0.14;
        if (enlarged && bold && adjacentBody) confidence += 0.18;
        if (short) confidence += 0.08;
        if (spaced) confidence += 0.08;
        if (adjacentBody) confidence += 0.08;
        confidence = Math.min(0.97, confidence);
        if (confidence < 0.57) continue;
        const key = `${page.pageNumber}:${line.start}:${line.end}`;
        if (accepted.has(key)) continue;
        accepted.set(key, {
          headingId: `pdf-heading:${documentHash}:${revision}:${page.pageNumber}:${line.start}:${line.end}`,
          pageNumber: page.pageNumber, rawText: page.text.slice(line.start, line.end),
          normalizedText: value, start: line.start, end: line.end,
          level: headingLevel(value, sectionFont && !known && value !== value.toUpperCase() ? 3 : 2), confidence: Number(confidence.toFixed(3)),
          source: 'inferred', range: { pageNumber: page.pageNumber,
            start: line.start, end: line.end },
          signals: { numbered, known, enlarged, bold, short, spaced, adjacentBody, sectionFont },
          geometry: candidateGeometry(line, page.pageNumber, line.start, line.end, page),
          correction: { allowed: true, mode: 'replace-or-remove' }
        });
      }
    }
    return { headings: joinFragmentedPdfHeadings([...accepted.values()], pages, sectionFonts).sort((left, right) =>
      left.pageNumber - right.pageNumber || left.start - right.start || left.end - right.end),
    outlineEntries };
  }

  function extractPdfHeadings(input = {}) {
    return analyzePdfHeadings(input).headings;
  }

  return { analyzePdfHeadings, extractPdfHeadings, headingLevel,
    segmentPdfGraphemes, validatePdfQuadPoints };
});
