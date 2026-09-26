(function attach(root, factory) {
  const dependency = typeof module === 'object' && module.exports
    ? require('./pdf-heading-extractor.js') : root.SciLLM;
  const api = factory(dependency);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(dependency = {}) {
  const SCHEMA_VERSION = 3;
  const canonicalHash = value => String(value || '').trim().toLowerCase()
    .replace(/^sha256:/u, '');

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === 'object') deepFreeze(nested);
    }
    return Object.freeze(value);
  }

  function fnv64(value) {
    let hash = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(String(value))) {
      hash ^= BigInt(byte);
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, '0');
  }

  function normalizePdfTextWithOffsets(value) {
    const rawText = String(value || '');
    const output = [];
    const rawToNormalized = new Array(rawText.length + 1).fill(null);
    const normalizedToRawStart = [];
    const normalizedToRawEnd = [];
    let pendingWhitespace = null;
    const emit = (text, rawStart, rawEnd) => {
      const normalizedStart = output.length;
      for (let offset = 0; offset < text.length; offset += 1) {
        output.push(text[offset]);
        normalizedToRawStart.push(rawStart);
        normalizedToRawEnd.push(rawEnd);
      }
      if (rawToNormalized[rawStart] === null) rawToNormalized[rawStart] = normalizedStart;
      for (let boundary = rawStart + 1; boundary < rawEnd; boundary += 1) {
        rawToNormalized[boundary] = normalizedStart;
      }
      rawToNormalized[rawEnd] = output.length;
    };
    const segments = typeof dependency.segmentPdfGraphemes === 'function'
      ? dependency.segmentPdfGraphemes(rawText)
      : (() => { const items = []; let index = 0; for (const segment of rawText) {
        items.push({ segment, index }); index += segment.length; } return items; })();
    rawToNormalized[0] = 0;
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const entry = segments[segmentIndex];
      const index = entry.index;
      const end = index + entry.segment.length;
      const dehyphenation = entry.segment === '-' && !pendingWhitespace &&
        /\p{L}\p{M}*$/u.test(output.join('')) &&
        rawText.slice(end).match(/^(?:\r\n|\r|\n)(?=\p{Ll})/u);
      if (dehyphenation) {
        const removedEnd = end + dehyphenation[0].length;
        for (let cursor = index; cursor <= removedEnd; cursor += 1) {
          rawToNormalized[cursor] = output.length;
        }
        while (segments[segmentIndex + 1] &&
          segments[segmentIndex + 1].index < removedEnd) segmentIndex += 1;
        pendingWhitespace = null;
        continue;
      }
      if (/^\s+$/u.test(entry.segment)) {
        pendingWhitespace ||= { start: index, end };
        pendingWhitespace.end = end;
        continue;
      }
      if (pendingWhitespace) {
        if (output.length) emit(' ', pendingWhitespace.start, pendingWhitespace.end);
        else for (let cursor = pendingWhitespace.start; cursor <= pendingWhitespace.end; cursor += 1) {
          rawToNormalized[cursor] = 0;
        }
      }
      pendingWhitespace = null;
      emit(entry.segment.normalize('NFKC'), index, end);
    }
    if (pendingWhitespace) {
      for (let cursor = pendingWhitespace.start;
        cursor <= pendingWhitespace.end; cursor += 1) {
        rawToNormalized[cursor] = output.length;
      }
    }
    for (let cursor = 0; cursor < rawToNormalized.length; cursor += 1) {
      if (rawToNormalized[cursor] === null) {
        rawToNormalized[cursor] = cursor ? rawToNormalized[cursor - 1] : 0;
      }
    }
    return { rawText, normalizedText: output.join(''), rawToNormalized,
      normalizedToRawStart, normalizedToRawEnd };
  }

  function rawRangeToNormalized(projection, start, end) {
    const length = projection?.rawText?.length || 0;
    const from = Math.max(0, Math.min(length, Math.floor(Number(start) || 0)));
    const to = Math.max(from, Math.min(length, Math.floor(Number(end) || 0)));
    return { start: projection.rawToNormalized[from], end: projection.rawToNormalized[to] };
  }

  function normalizedRangeToRaw(projection, start, end) {
    const length = projection?.normalizedText?.length || 0;
    const from = Math.max(0, Math.min(length, Math.floor(Number(start) || 0)));
    const to = Math.max(from, Math.min(length, Math.floor(Number(end) || 0)));
    if (from === to) {
      const boundary = from === length ? projection.rawText.length
        : projection.normalizedToRawStart[from] || 0;
      return { start: boundary, end: boundary };
    }
    return { start: projection.normalizedToRawStart[from],
      end: projection.normalizedToRawEnd[to - 1] };
  }

  function pdfSemanticCacheKey(input = {}) {
    const documentHash = canonicalHash(input.documentHash);
    const revision = String(input.revision ?? '0');
    const pages = (Array.isArray(input.pages) ? input.pages : []).map(page => ({
      pageNumber: Math.max(1, Math.floor(Number(page.pageNumber) || 1)),
      text: String(page.text || ''), pageWidth: Number(page.pageWidth) || null,
      pageHeight: Number(page.pageHeight) || null, view: page.view || null,
      rotate: Number(page.rotate) || 0,
      spans: (Array.isArray(page.spans) ? page.spans : []).map(span => ({
        text: String(span?.text || ''), start: Number(span?.start), end: Number(span?.end),
        fontSize: Number(span?.fontSize) || null, fontName: String(span?.fontName || ''),
        bold: span?.bold === true, rect: span?.rect ? {
          left: Number(span.rect.left), top: Number(span.rect.top),
          right: Number(span.rect.right), bottom: Number(span.rect.bottom)
        } : null,
        quadPoints: Array.isArray(span?.quadPoints) ? span.quadPoints.map(Number) : null
      }))
    })).sort((left, right) => left.pageNumber - right.pageNumber);
    const outline = (Array.isArray(input.outline) ? input.outline : []).map(item => ({
      title: String(item?.title || '').normalize('NFKC').replace(/\s+/gu, ' ').trim(),
      pageNumber: Number(item?.pageNumber) || null,
      level: Number(item?.level) || null, targetTop: Number.isFinite(Number(item?.targetTop))
        && item?.targetTop !== null && item?.targetTop !== undefined ? Number(item.targetTop) : null
    }));
    return `pdf-semantic-v${SCHEMA_VERSION}:${documentHash}:${revision}:${fnv64(JSON.stringify({
      textProjectionRevision: 2, pages, outline
    }))}`;
  }

  function pdfSemanticProvenanceKey(input = {}) {
    const documentHash = canonicalHash(input?.document?.documentHash || input.documentHash);
    const revision = Number(input?.document?.revision ?? input.revision) || 0;
    const mappings = (Array.isArray(input.mappings) ? input.mappings : []).map(mapping => ({
      pageNumber: Number(mapping?.pageNumber) || 0,
      rawText: String(mapping?.rawText || '')
    }));
    const paragraphs = (Array.isArray(input.paragraphs) ? input.paragraphs : []).map(paragraph => ({
      paragraphId: String(paragraph?.paragraphId || ''),
      order: Number(paragraph?.order) || 0,
      sectionId: paragraph?.sectionId === null ? null : String(paragraph?.sectionId || ''),
      normalizedText: String(paragraph?.normalizedText || ''),
      ranges: (Array.isArray(paragraph?.ranges) ? paragraph.ranges : []).map(range => ({
        pageNumber: Number(range?.pageNumber) || 0,
        start: Number(range?.start), end: Number(range?.end)
      })),
      rawQuoteByPage: (Array.isArray(paragraph?.rawQuoteByPage)
        ? paragraph.rawQuoteByPage : []).map(range => ({
        pageNumber: Number(range?.pageNumber) || 0,
        start: Number(range?.start), end: Number(range?.end), quote: String(range?.quote || '')
      })),
      positionRuns: (Array.isArray(paragraph?.positionRuns) ? paragraph.positionRuns : [])
        .map(run => ({
          normalizedStart: Number(run?.normalizedStart),
          normalizedEnd: Number(run?.normalizedEnd),
          pageNumber: run?.pageNumber === null ? null : Number(run?.pageNumber),
          rawStart: run?.rawStart === null ? null : Number(run?.rawStart),
          rawEnd: run?.rawEnd === null ? null : Number(run?.rawEnd),
          kind: String(run?.kind || '')
        }))
    }));
    const sections = (Array.isArray(input.sections) ? input.sections : []).map((section, order) => ({
      sectionId: section?.sectionId,
      level: section?.level,
      source: section?.source,
      headingId: section?.headingId,
      parentSectionId: section?.parentSectionId,
      childSectionIds: Array.isArray(section?.childSectionIds)
        ? [...section.childSectionIds] : section?.childSectionIds,
      paragraphIds: Array.isArray(section?.paragraphIds)
        ? [...section.paragraphIds] : section?.paragraphIds,
      order
    }));
    const payload = { cacheKey: String(input.cacheKey || ''), mappings, paragraphs, sections };
    return `pdf-semantic-provenance-v1:${documentHash}:${revision}:${fnv64(JSON.stringify(payload))}`;
  }

  function pdfSemanticParagraphId(documentHash, revision, ranges) {
    return `pdf-paragraph:${fnv64(`${canonicalHash(documentHash)}:${revision}:${JSON.stringify(ranges)}`)}`;
  }

  function periodIsProtected(text, index, sentenceStart) {
    const previous = text[index - 1] || '';
    const next = text[index + 1] || '';
    if (/[\p{L}\d]/u.test(previous) && /[\p{L}\d]/u.test(next)) return true;
    const context = text.slice(Math.max(sentenceStart, index - 24), index + 1);
    if (/(?:\b(?:Dr|Mr|Mrs|Ms|Prof|Fig|Figs|Eq|Eqs|Ref|Refs|vs)|\b(?:e\.g|i\.e|et\s+al))\.$/iu
      .test(context)) return true;
    if (/\b(?:U\.S|U\.K)\.$/u.test(context)) {
      const following = text.slice(index + 1).match(/^\s*([^\s])/u)?.[1] || '';
      return !following || /^[\p{Ll}\d,;:)]/u.test(following);
    }
    if (/\bNos?\.$/iu.test(context) && /^\s*\d/u.test(text.slice(index + 1))) return true;
    return false;
  }

  function splitSentenceRanges(text) {
    const ranges = [];
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (!/[.!?。！？]/u.test(character)) continue;
      if (character === '.' && periodIsProtected(text, index, start)) continue;
      let end = index + 1;
      while (/[)\]}'”’」』]/u.test(text[end] || '')) end += 1;
      const normalizedStart = text.slice(start, end).search(/\S/u);
      const actualStart = normalizedStart < 0 ? end : start + normalizedStart;
      if (end > actualStart) ranges.push({ start: actualStart, end });
      start = end;
      while (/\s/u.test(text[start] || '')) start += 1;
      index = start - 1;
    }
    if (start < text.length) {
      const offset = text.slice(start).search(/\S/u);
      if (offset >= 0) ranges.push({ start: start + offset, end: text.length });
    }
    return ranges;
  }

  function combinedLineRect(page, start, end) {
    const rects = (Array.isArray(page.spans) ? page.spans : []).filter(span =>
      Number(span?.end) > start && Number(span?.start) < end && span.rect)
      .map(span => span.rect).filter(rect => [rect.left, rect.top, rect.right, rect.bottom]
        .map(Number).every(Number.isFinite));
    if (!rects.length) return null;
    return { left: Math.min(...rects.map(rect => Number(rect.left))),
      top: Math.min(...rects.map(rect => Number(rect.top))),
      right: Math.max(...rects.map(rect => Number(rect.right))),
      bottom: Math.max(...rects.map(rect => Number(rect.bottom))) };
  }

  function pageParagraphs(page, excludedRanges) {
    const raw = String(page.text || '');
    const paragraphs = [];
    const appendBodySlice = (sliceStart, sliceEnd) => {
      if (sliceEnd <= sliceStart) return;
      const slice = raw.slice(sliceStart, sliceEnd);
      const blocks = slice.split(/(?:\r?\n[ \t]*){2,}/u);
      let searchFrom = 0;
      for (const block of blocks) {
        const relative = slice.indexOf(block, searchFrom);
        searchFrom = relative + block.length;
        const leading = block.search(/\S/u);
        if (leading < 0) continue;
        const trailing = block.length - block.trimEnd().length;
        const blockStart = sliceStart + relative + leading;
        const blockEnd = sliceStart + relative + block.length - trailing;
        const lines = [];
        const linePattern = /[^\r\n]+/gu;
        let line;
        while ((line = linePattern.exec(raw.slice(blockStart, blockEnd)))) {
          const text = line[0];
          const start = blockStart + line.index;
          lines.push({ pageNumber: page.pageNumber, start, end: start + text.length, text,
            rect: combinedLineRect(page, start, start + text.length) });
        }
        let pieces = [];
        for (const current of lines) {
          const previous = pieces.at(-1);
          const previousHeight = previous?.rect
            ? Number(previous.rect.bottom) - Number(previous.rect.top) : 0;
          const verticalGap = previous?.rect && current.rect
            ? Number(current.rect.top) - Number(previous.rect.bottom) : 0;
          const indentation = previous?.rect && current.rect
            ? Number(current.rect.left) - Number(previous.rect.left) : 0;
          const columnReset = previous?.rect && current.rect &&
            Number(current.rect.top) < Number(previous.rect.top) - Math.max(4, previousHeight) &&
            Math.abs(Number(current.rect.left) - Number(previous.rect.left)) > 80;
          const paragraphBreak = previous && (columnReset ||
            verticalGap > Math.max(8, previousHeight * 0.65) ||
            indentation > Math.max(18, previousHeight * 1.4));
          if (paragraphBreak) {
            paragraphs.push({ pieces });
            pieces = [];
          }
          pieces.push(current);
        }
        if (pieces.length) paragraphs.push({ pieces });
      }
    };
    let cursor = 0;
    for (const range of [...excludedRanges].sort((left, right) => left.start - right.start)) {
      const start = Math.max(cursor, Math.min(raw.length, Number(range.start) || 0));
      const end = Math.max(start, Math.min(raw.length, Number(range.end) || start));
      appendBodySlice(cursor, start);
      cursor = end;
    }
    appendBodySlice(cursor, raw.length);
    return paragraphs;
  }

  function paragraphProjection(pieces) {
    const characters = [];
    const positionRuns = [];
    let previousMergeable = false;
    const appendSource = (normalizedStart, normalizedEnd, pageNumber, rawStart, rawEnd,
      mergeable) => {
      const previous = positionRuns.at(-1);
      if (mergeable && previousMergeable && previous?.kind === 'source' &&
          previous.pageNumber === pageNumber && previous.normalizedEnd === normalizedStart &&
          previous.rawEnd === rawStart) {
        previous.normalizedEnd = normalizedEnd;
        previous.rawEnd = rawEnd;
      } else {
        positionRuns.push({ normalizedStart, normalizedEnd, pageNumber,
          rawStart, rawEnd, kind: 'source' });
      }
      previousMergeable = mergeable;
    };
    const appendVirtualSpace = () => {
      const normalizedStart = characters.length;
      characters.push(' ');
      positionRuns.push({ normalizedStart, normalizedEnd: normalizedStart + 1,
        pageNumber: null, rawStart: null, rawEnd: null, kind: 'virtual-space' });
      previousMergeable = false;
    };
    const removeTrailingSourceCharacter = () => {
      characters.pop();
      const run = positionRuns.at(-1);
      if (!run || run.kind !== 'source') return;
      run.normalizedEnd -= 1;
      run.rawEnd -= 1;
      if (run.normalizedEnd <= run.normalizedStart) positionRuns.pop();
      const current = positionRuns.at(-1);
      previousMergeable = current?.kind === 'source' &&
        current.normalizedEnd - current.normalizedStart === current.rawEnd - current.rawStart;
    };
    for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
      const piece = pieces[pieceIndex];
      const projection = normalizePdfTextWithOffsets(piece.text);
      if (!projection.normalizedText) continue;
      if (characters.length) {
        const previousPiece = pieces[pieceIndex - 1];
        const dehyphenate = previousPiece?.pageNumber === piece.pageNumber &&
          /\p{L}\p{M}*-$/u.test(characters.join('')) && /^\p{Ll}/u.test(projection.normalizedText);
        if (dehyphenate) {
          removeTrailingSourceCharacter();
        } else {
          appendVirtualSpace();
        }
      }
      const normalizedBase = characters.length;
      for (let offset = 0; offset < projection.normalizedText.length; offset += 1) {
        characters.push(projection.normalizedText[offset]);
      }
      let index = 0;
      while (index < projection.normalizedText.length) {
        const rawStart = projection.normalizedToRawStart[index];
        const rawEnd = projection.normalizedToRawEnd[index];
        let end = index + 1;
        while (end < projection.normalizedText.length &&
            projection.normalizedToRawStart[end] === rawStart &&
            projection.normalizedToRawEnd[end] === rawEnd) end += 1;
        appendSource(normalizedBase + index, normalizedBase + end, piece.pageNumber,
          piece.start + rawStart, piece.start + rawEnd,
          end - index === 1 && rawEnd - rawStart === 1);
        index = end;
      }
    }
    return { text: characters.join(''), positionRuns };
  }

  function sourceRanges(positionRuns, start, end) {
    const ranges = [];
    for (const run of positionRuns) {
      if (run.kind !== 'source' || run.normalizedEnd <= start || run.normalizedStart >= end) continue;
      const normalizedStart = Math.max(start, run.normalizedStart);
      const normalizedEnd = Math.min(end, run.normalizedEnd);
      const oneToOne = run.normalizedEnd - run.normalizedStart === run.rawEnd - run.rawStart;
      const rawStart = oneToOne
        ? run.rawStart + normalizedStart - run.normalizedStart : run.rawStart;
      const rawEnd = oneToOne
        ? run.rawStart + normalizedEnd - run.normalizedStart : run.rawEnd;
      const previous = ranges.at(-1);
      if (previous && previous.pageNumber === run.pageNumber && rawStart <= previous.end + 3) {
        previous.end = Math.max(previous.end, rawEnd);
      } else {
        ranges.push({ pageNumber: run.pageNumber, start: rawStart, end: rawEnd });
      }
    }
    return ranges;
  }

  function pageDimensions(page = {}) {
    return { width: Number(page.pageWidth) ||
        Math.abs(Number(page.view?.[2]) - Number(page.view?.[0])) || 0,
    height: Number(page.pageHeight) ||
        Math.abs(Number(page.view?.[3]) - Number(page.view?.[1])) || 0 };
  }

  function pointInsidePage(x, y, page) {
    const dimensions = pageDimensions(page);
    return x >= 0 && y >= 0 && (!dimensions.width || x <= dimensions.width) &&
      (!dimensions.height || y <= dimensions.height);
  }

  const validatePdfQuadPoints = typeof dependency.validatePdfQuadPoints === 'function'
    ? dependency.validatePdfQuadPoints
    : () => [];

  function validRect(value, page) {
    if (!value) return null;
    const rect = [value.left, value.top, value.right, value.bottom].map(Number);
    if (!rect.every(Number.isFinite) || rect[2] <= rect[0] || rect[3] <= rect[1] ||
        !pointInsidePage(rect[0], rect[1], page) ||
        !pointInsidePage(rect[2], rect[3], page)) return null;
    return { left: rect[0], top: rect[1], right: rect[2], bottom: rect[3] };
  }

  function documentRanges(pages, start, end) {
    const ranges = [];
    for (const page of pages) {
      if (page.pageNumber < start.pageNumber || page.pageNumber > end.pageNumber) continue;
      const rangeStart = page.pageNumber === start.pageNumber ? start.offset : 0;
      const rangeEnd = page.pageNumber === end.pageNumber ? end.offset : page.text.length;
      if (rangeEnd > rangeStart) ranges.push({ pageNumber: page.pageNumber,
        start: rangeStart, end: rangeEnd });
    }
    return ranges;
  }

  function repeatedFurnitureByPage(pages) {
    const appearances = new Map();
    for (const page of pages) {
      const pattern = /[^\r\n]+/gu;
      let match;
      while ((match = pattern.exec(page.text))) {
        const normalizedText = match[0].normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
        if (!normalizedText) continue;
        const start = match.index;
        const end = start + match[0].length;
        const rect = combinedLineRect(page, start, end);
        const entries = appearances.get(normalizedText) || [];
        entries.push({ pageNumber: page.pageNumber, start, end, rect,
          pageHeight: Number(page.pageHeight) || 0 });
        appearances.set(normalizedText, entries);
      }
    }
    const byPage = new Map();
    for (const entries of appearances.values()) {
      if (new Set(entries.map(item => item.pageNumber)).size < 2) continue;
      for (const entry of entries) {
        if (!entry.rect || !entry.pageHeight) continue;
        const atEdge = entry.rect.top / entry.pageHeight <= 0.14 ||
          entry.rect.bottom / entry.pageHeight >= 0.86;
        if (!atEdge) continue;
        const ranges = byPage.get(entry.pageNumber) || [];
        ranges.push({ start: entry.start, end: entry.end, kind: 'repeated-page-furniture' });
        byPage.set(entry.pageNumber, ranges);
      }
    }
    return byPage;
  }

  function buildPdfSemanticIndex(input = {}) {
    const documentHash = canonicalHash(input.documentHash);
    const revision = Number.isFinite(Number(input.revision)) ? Number(input.revision) : 0;
    const pages = (Array.isArray(input.pages) ? input.pages : []).map(page => ({ ...page,
      pageNumber: Math.max(1, Math.floor(Number(page.pageNumber) || 1)),
      text: String(page.text || '') })).sort((left, right) => left.pageNumber - right.pageNumber);
    const pageMap = new Map(pages.map(page => [page.pageNumber, page]));
    const pageMappings = pages.map(page => ({ pageNumber: page.pageNumber,
      ...normalizePdfTextWithOffsets(page.text) }));
    const headingAnalysis = typeof dependency.analyzePdfHeadings === 'function'
      ? dependency.analyzePdfHeadings({ ...input, documentHash, revision, pages })
      : { headings: dependency.extractPdfHeadings({ ...input, documentHash, revision, pages }),
        outlineEntries: [] };
    const headings = headingAnalysis.headings;
    const headingByPage = new Map();
    for (const heading of headings) {
      const ranges = headingByPage.get(heading.pageNumber) || [];
      ranges.push({ start: heading.start, end: heading.end });
      headingByPage.set(heading.pageNumber, ranges);
    }
    const furnitureByPage = repeatedFurnitureByPage(pages);
    const paragraphSeeds = [];
    for (const page of pages) {
      const current = pageParagraphs(page, [
        ...(headingByPage.get(page.pageNumber) || []),
        ...(furnitureByPage.get(page.pageNumber) || [])
      ]);
      const previous = paragraphSeeds.at(-1);
      const first = current[0];
      const previousProjection = previous ? paragraphProjection(previous.pieces).text : '';
      const firstProjection = first ? paragraphProjection(first.pieces).text : '';
      const headingBeforeFirst = first && (headingByPage.get(page.pageNumber) || [])
        .some(range => range.start < first.pieces[0].start);
      if (previous && first && previousProjection && !/[.!?。！？][)\]}'”’」』]*$/u.test(previousProjection) &&
          /^[\p{L}\d]/u.test(firstProjection) && !headingBeforeFirst) {
        previous.pieces.push(...first.pieces);
        current.shift();
      }
      paragraphSeeds.push(...current);
    }

    const spans = [];
    const sentences = [];
    const paragraphs = paragraphSeeds.map((seed, paragraphIndex) => {
      const projection = paragraphProjection(seed.pieces);
      const paragraphRanges = sourceRanges(projection.positionRuns, 0, projection.text.length);
      const paragraphId = pdfSemanticParagraphId(documentHash, revision, paragraphRanges);
      const sentenceIds = [];
      for (const boundary of splitSentenceRanges(projection.text)) {
        const ranges = sourceRanges(projection.positionRuns, boundary.start, boundary.end);
        if (!ranges.length) continue;
        const sentenceId = `pdf-sentence:${fnv64(`${documentHash}:${revision}:${JSON.stringify(ranges)}`)}`;
        const spanIds = [];
        for (const range of ranges) {
          const page = pageMap.get(range.pageNumber);
          const candidates = (Array.isArray(page?.spans) ? page.spans : []).filter(item =>
            Number(item?.end) > range.start && Number(item?.start) < range.end);
          const selected = candidates.length ? candidates : [{ start: range.start, end: range.end }];
          for (const candidate of selected) {
            const start = Math.max(range.start, Number(candidate.start) || range.start);
            const end = Math.min(range.end, Number(candidate.end) || range.end);
            if (end <= start) continue;
            const quadPoints = validatePdfQuadPoints(candidate.quadPoints, page);
            const rect = validRect(candidate.rect, page);
            const geometry = quadPoints.length
              ? { kind: 'quad', pageNumber: range.pageNumber, quadPoints,
                precision: Number(candidate.start) === start && Number(candidate.end) === end
                  ? 'exact-source-span' : 'enclosing-source-span' }
              : rect
                ? { kind: 'rect', pageNumber: range.pageNumber,
                  rect,
                  precision: Number(candidate.start) === start && Number(candidate.end) === end
                    ? 'exact-source-span' : 'enclosing-source-span' }
                : { kind: 'page-paragraph-fallback', pageNumber: range.pageNumber,
                  paragraphId, start, end, precision: 'no-geometry' };
            const spanId = `pdf-span:${fnv64(`${documentHash}:${revision}:${range.pageNumber}:${start}:${end}`)}`;
            spans.push({ spanId, sentenceId, paragraphId, pageNumber: range.pageNumber,
              start, end, rawText: page.text.slice(start, end), geometry });
            spanIds.push(spanId);
          }
        }
        const rawQuoteByPage = ranges.map(range => ({ pageNumber: range.pageNumber,
          start: range.start, end: range.end,
          quote: pageMap.get(range.pageNumber).text.slice(range.start, range.end) }));
        sentences.push({ sentenceId, paragraphId, normalizedText:
          projection.text.slice(boundary.start, boundary.end), ranges, rawQuoteByPage, spanIds });
        sentenceIds.push(sentenceId);
      }
      return { paragraphId, order: paragraphIndex, ranges: paragraphRanges,
        rawQuoteByPage: paragraphRanges.map(range => ({ ...range,
          quote: pageMap.get(range.pageNumber).text.slice(range.start, range.end) })),
        normalizedText: projection.text, positionRuns: projection.positionRuns, sentenceIds };
    });

    const sections = [];
    const documentStart = { pageNumber: pages[0]?.pageNumber || 1, offset: 0 };
    const lastPage = pages.at(-1);
    const documentEnd = { pageNumber: lastPage?.pageNumber || 1,
      offset: lastPage?.text.length || 0 };
    if (!headings.length) {
      sections.push({ sectionId: `pdf-section:${fnv64(`${documentHash}:${revision}:root`)}`,
        level: 1, source: 'implicit-document', headingId: null,
        parentSectionId: null, childSectionIds: [],
        paragraphIds: paragraphs.map(item => item.paragraphId),
        ranges: documentRanges(pages, documentStart, documentEnd) });
    } else {
      const firstHeading = headings[0];
      const preambleParagraphIds = paragraphs.filter(paragraph => {
        const first = paragraph.ranges[0];
        return first && (first.pageNumber < firstHeading.pageNumber ||
          (first.pageNumber === firstHeading.pageNumber && first.start < firstHeading.start));
      }).map(item => item.paragraphId);
      if (preambleParagraphIds.length) {
        sections.push({ sectionId: `pdf-section:${fnv64(`${documentHash}:${revision}:preamble`)}`,
          level: 1, source: 'implicit-preamble', headingId: null,
          parentSectionId: null, childSectionIds: [], paragraphIds: preambleParagraphIds,
          ranges: documentRanges(pages, documentStart,
            { pageNumber: firstHeading.pageNumber, offset: firstHeading.start }) });
      }
      for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index];
        const next = headings[index + 1];
        const nextPeer = headings.slice(index + 1).find(item => item.level <= heading.level);
        const paragraphIds = paragraphs.filter(paragraph => {
          const first = paragraph.ranges[0];
          if (!first) return false;
          const after = first.pageNumber > heading.pageNumber ||
            (first.pageNumber === heading.pageNumber && first.start > heading.end);
          const beforeNext = !next || first.pageNumber < next.pageNumber ||
            (first.pageNumber === next.pageNumber && first.start < next.start);
          return after && beforeNext;
        }).map(item => item.paragraphId);
        sections.push({ sectionId: `pdf-section:${fnv64(`${documentHash}:${revision}:${heading.headingId}`)}`,
          level: heading.level, source: heading.source, headingId: heading.headingId,
          parentSectionId: null, childSectionIds: [], paragraphIds,
          ranges: documentRanges(pages,
            { pageNumber: heading.pageNumber, offset: heading.start },
            nextPeer ? { pageNumber: nextPeer.pageNumber, offset: nextPeer.start } : documentEnd) });
      }
      const stack = [];
      for (const section of sections.filter(item => item.headingId)) {
        while (stack.length && stack.at(-1).level >= section.level) stack.pop();
        const parent = stack.at(-1);
        if (parent) {
          section.parentSectionId = parent.sectionId;
          parent.childSectionIds.push(section.sectionId);
        }
        stack.push(section);
      }
    }
    const sectionByParagraph = new Map(sections.flatMap(section =>
      section.paragraphIds.map(paragraphId => [paragraphId, section.sectionId])));
    paragraphs.forEach(paragraph => { paragraph.sectionId = sectionByParagraph.get(paragraph.paragraphId) || null; });
    const result = {
      schemaVersion: SCHEMA_VERSION,
      cacheKey: pdfSemanticCacheKey({ documentHash, revision, pages,
        outline: Array.isArray(input.outline) ? input.outline : [] }),
      document: { documentId: `pdf-document:${documentHash}`, documentHash, revision,
        pageCount: pages.length, sectionIds: sections.map(item => item.sectionId) },
      mappings: pageMappings, headingDiagnostics: { outlineEntries: headingAnalysis.outlineEntries },
      layoutDiagnostics: { repeatedFurnitureRanges: [...furnitureByPage].flatMap(
        ([pageNumber, ranges]) => ranges.map(range => ({ pageNumber, ...range }))) },
      sections, headings, paragraphs, sentences, spans,
      geometryPolicy: { missing: 'page-paragraph-fallback', fabricatedQuads: false }
    };
    result.provenanceKey = pdfSemanticProvenanceKey(result);
    return deepFreeze(result);
  }

  return { SCHEMA_VERSION, buildPdfSemanticIndex, normalizePdfTextWithOffsets,
    pdfSemanticCacheKey, rawRangeToNormalized, normalizedRangeToRaw, splitSentenceRanges,
    pdfSemanticProvenanceKey, pdfSemanticParagraphId,
    segmentPdfGraphemes: dependency.segmentPdfGraphemes,
    validatePdfQuadPoints };
});
