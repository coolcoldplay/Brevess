(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const canonical = value => String(value || '').normalize('NFKC')
    .replace(/\s+/gu, ' ').trim();
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
      const text = entry.segment.normalize('NFKC');
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
        (!Number.isFinite(topRatio) || topRatio <= 0.14 || bottomRatio >= 0.86)) return true;
    return /^(?:research article|article|neuroscience|doi\b|https?:\/\/|\d+\s+of\s+\d+)$/iu
      .test(normalized);
  }

  function isNegativeHeading(text) {
    const value = canonical(text);
    if (!value) return true;
    if (/^(?:fig(?:ure)?|table|supplementary\s+(?:fig(?:ure)?|table)|图|表)\s*[\dA-Z一二三四五六七八九十]*[.:：]?/iu
      .test(value)) return true;
    if (/^\[\d+\]\s+/u.test(value)) return true;
    if (/^(?:[A-Za-z]\s*=|[+−–—=<>≤≥±∑∫∆Δ]|p\s*[<=>])|[=±∑∫∆Δ]\s*\S/u.test(value)) return true;
    if (/\s{2,}[-+−]?\d+(?:\.\d+)?(?:\s*±\s*\d+(?:\.\d+)?)?/u.test(String(text))) return true;
    if (value.length > 76 || (value.length > 38 && /[.!?。！？]$/u.test(value))) return true;
    return false;
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

    for (const outline of Array.isArray(input.outline) ? input.outline : []) {
      const pageNumber = Math.max(1, Math.floor(Number(outline?.pageNumber) || 1));
      const page = pageMap.get(pageNumber);
      const title = canonical(outline?.title);
      const outlineLevel = clamp(Number(outline?.level) || 1, 1, 6);
      if (!page || !title) {
        outlineEntries.push({ status: 'unresolved', reason: !page ? 'page-unavailable' : 'empty-title',
          pageNumber, level: outlineLevel });
        continue;
      }
      const lines = pageLines(page);
      let candidates = lines.filter(item => canonical(item.text) === title);
      if (!candidates.length) {
        const projection = normalizedProjection(page.text);
        let from = 0;
        while (from <= projection.text.length - title.length) {
          const normalizedStart = projection.text.indexOf(title, from);
          if (normalizedStart < 0) break;
          const normalizedEnd = normalizedStart + title.length;
          candidates.push({ text: page.text.slice(projection.starts[normalizedStart],
            projection.ends[normalizedEnd - 1]), start: projection.starts[normalizedStart],
          end: projection.ends[normalizedEnd - 1] });
          from = normalizedStart + Math.max(1, title.length);
        }
      }
      const rawTargetTop = outline?.targetTop;
      const hasTarget = typeof rawTargetTop === 'number' && Number.isFinite(rawTargetTop);
      const targetTop = hasTarget ? rawTargetTop : null;
      if (hasTarget) {
        candidates = candidates.map(line => ({ line,
          distance: line.rect ? Math.abs(Number(line.rect.top) - targetTop) : Infinity }))
          .sort((left, right) => left.distance - right.distance);
      }
      let line = hasTarget ? candidates[0]?.line : candidates[0];
      let reason = '';
      if (!line) reason = 'title-not-found';
      else if (!hasTarget && candidates.length > 1) reason = 'ambiguous-title-without-target';
      else if (hasTarget) {
        const distance = candidates[0].distance;
        const tolerance = Math.max(24, (Number(line.fontSize) || 10) * 2.5);
        if (!Number.isFinite(distance) || distance > tolerance) reason = 'target-coordinate-mismatch';
      }
      if (reason) {
        outlineEntries.push({ status: 'unresolved', reason, pageNumber,
          level: outlineLevel, targetTop: hasTarget ? targetTop : null });
        continue;
      }
      const start = line.start;
      const end = line.end;
      const key = `${pageNumber}:${start}:${end}`;
      const headingId = `pdf-heading:${documentHash}:${revision}:${pageNumber}:${start}:${end}`;
      const resolved = {
        status: 'resolved', pageNumber, start, end, level: outlineLevel,
        targetTop: hasTarget ? targetTop : null,
        targetDistance: hasTarget ? Number(candidates[0].distance.toFixed(3)) : null,
        headingId
      };
      outlineEntries.push(resolved);
      accepted.set(key, {
        headingId,
        pageNumber, rawText: page.text.slice(start, end), normalizedText: title,
        start, end, level: outlineLevel,
        confidence: hasTarget ? 0.99 : 0.96, source: 'outline', range: { pageNumber, start, end },
        outlineTarget: { status: 'resolved', targetTop: resolved.targetTop,
          distance: resolved.targetDistance },
        geometry: candidateGeometry(line, pageNumber, start, end, page),
        correction: { allowed: true, mode: 'replace-or-remove' }
      });
    }

    for (const page of pages) {
      const lines = pageLines(page);
      const fontSizes = lines.map(line => Number(line.fontSize)).filter(value => value > 0)
        .sort((left, right) => left - right);
      const bodySize = fontSizes.length ? fontSizes[Math.floor((fontSizes.length - 1) / 2)] : 10;
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const value = canonical(line.text);
        if (isFurniture(line, page, repeatedFurniture) || isNegativeHeading(line.text)) continue;
        const numbered = /^(?:\d+(?:\.\d+)*|[IVXLC]+)[.)]?\s+\p{L}/iu.test(value);
        const knownLexeme = /^(?:abstract|introduction|background|results?|discussion|conclusions?|methods?|materials(?: and methods)?|references|acknowledg(?:e)?ments?|摘要|引言|结果|讨论|结论|方法|材料与方法)$/iu.test(value);
        const firstLetter = value.match(/\p{L}/u)?.[0] || '';
        const known = knownLexeme &&
          (!firstLetter || firstLetter === firstLetter.toUpperCase());
        const fontSize = Number(line.fontSize) || bodySize;
        const enlarged = fontSize >= bodySize * 1.18;
        const bold = line.bold === true || /(?:bold|black|semibold|demi)/iu.test(String(line.fontName || ''));
        const short = value.length <= 58;
        const next = lines[index + 1];
        const gap = line.rect && next?.rect
          ? Number(next.rect.top) - Number(line.rect.bottom) : 0;
        const spaced = Number.isFinite(gap) && gap >= Math.max(8, fontSize * 0.65);
        const adjacentBody = next && canonical(next.text).length >= 22 &&
          !isNegativeHeading(next.text);
        let confidence = 0;
        if (numbered) confidence += 0.36;
        if (known) confidence += 0.5;
        if (enlarged) confidence += 0.18;
        if (bold) confidence += 0.14;
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
          level: headingLevel(value, 2), confidence: Number(confidence.toFixed(3)),
          source: 'inferred', range: { pageNumber: page.pageNumber,
            start: line.start, end: line.end },
          signals: { numbered, known, enlarged, bold, short, spaced, adjacentBody },
          geometry: candidateGeometry(line, page.pageNumber, line.start, line.end, page),
          correction: { allowed: true, mode: 'replace-or-remove' }
        });
      }
    }
    return { headings: [...accepted.values()].sort((left, right) =>
      left.pageNumber - right.pageNumber || left.start - right.start || left.end - right.end),
    outlineEntries };
  }

  function extractPdfHeadings(input = {}) {
    return analyzePdfHeadings(input).headings;
  }

  return { analyzePdfHeadings, extractPdfHeadings, headingLevel,
    segmentPdfGraphemes, validatePdfQuadPoints };
});
