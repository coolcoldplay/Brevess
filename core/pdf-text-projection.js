(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function normalizedRect(value) {
    const rect = value && typeof value === 'object' ? value : {};
    const left = Number(rect.left), top = Number(rect.top);
    const right = Number(rect.right), bottom = Number(rect.bottom);
    return [left, top, right, bottom].every(Number.isFinite) && right > left && bottom > top
      ? { left, top, right, bottom } : null;
  }

  function verticalOrder(left, right) {
    const leftRect = normalizedRect(left?.rect), rightRect = normalizedRect(right?.rect);
    if (!leftRect || !rightRect) return Number(left?.sourceIndex) - Number(right?.sourceIndex);
    const minimumHeight = Math.min(leftRect.bottom - leftRect.top, rightRect.bottom - rightRect.top);
    const overlap = Math.min(leftRect.bottom, rightRect.bottom) - Math.max(leftRect.top, rightRect.top);
    // Citation superscripts overlap their source line even though their top
    // and baseline differ. Sort these inline items by x, preserving the words.
    if (overlap < minimumHeight * 0.4) {
      return leftRect.top - rightRect.top;
    }
    return leftRect.left - rightRect.left ||
      Number(left?.sourceIndex) - Number(right?.sourceIndex);
  }

  function hasRowContinuationEvidence(left, right, pageWidth) {
    const leftRect = normalizedRect(left?.rect), rightRect = normalizedRect(right?.rect);
    if (!leftRect || !rightRect || rightRect.left <= leftRect.right) return '';
    const leftHeight = leftRect.bottom - leftRect.top;
    const rightHeight = rightRect.bottom - rightRect.top;
    const baselineTolerance = Math.max(2, Math.min(leftHeight, rightHeight) * 0.45);
    if (Math.abs(leftRect.bottom - rightRect.bottom) > baselineTolerance) return '';
    if (rightRect.left - leftRect.right > pageWidth * 0.62) return '';
    const leftText = String(left?.text || '').normalize('NFKC').trim();
    const rightText = String(right?.text || '').normalize('NFKC').trim();
    if (!leftText || !rightText) return '';
    const leftIsShortLabel =
      /^(?:[\[(]?[A-Za-z0-9]{1,4}[\]).:]?|[+−–—=<>≤≥±∑∫∆Δ].*)$/u.test(leftText);
    const formulaPair = /(?:^|\s)[A-Za-z]\s*=\s*$/u.test(leftText) ||
      /^[\d.]+\s*(?:±|%|[+−–—=<>≤≥])/u.test(rightText);
    const tableValue = /^[-+−]?\d+(?:\.\d+)?(?:\s*±\s*\d+(?:\.\d+)?)?%?$/u.test(rightText);
    const rightContinues = /^[\p{Ll}\d[(+−–—=<>≤≥±%]/u.test(rightText);
    const leftIsOpen = !/[.!?。！？;；:]$/u.test(leftText);
    if (leftIsShortLabel || formulaPair || tableValue) return 'strong';
    return leftIsOpen && rightContinues ? 'weak' : '';
  }

  // PDF source order is not necessarily visual reading order. A confident
  // gutter lets the DOM place a complete left column before the right one,
  // which prevents a native drag in one column from selecting the other.
  function orderPdfTextSegmentsByGeometry(segments = [], pageRect = {}) {
    const source = (Array.isArray(segments) ? segments : []).map((segment, sourceIndex) => ({
      ...segment, sourceIndex, rect: normalizedRect(segment?.rect)
    }));
    const bounds = normalizedRect(pageRect);
    const measurable = source.filter(item => item.rect);
    if (!bounds || measurable.length < 4) return Array.isArray(segments) ? segments : [];
    const width = bounds.right - bounds.left;
    const heights = measurable.map(item => item.rect.bottom - item.rect.top).sort((a,b) => a-b);
    const gutter = Math.max(3, heights[Math.floor(heights.length / 2)] * 0.85);
    const candidates = [];
    for (let ratio = 0.4; ratio <= 0.6; ratio += 0.02) candidates.push(bounds.left + width * ratio);
    // Journals can have a narrow, off-centre gutter. A fixed 2% scan can miss
    // it entirely and choose a split through the middle of the left column.
    const edges = [...new Set(measurable.flatMap(item => [item.rect.left, item.rect.right]))]
      .filter(edge => edge >= bounds.left + width * 0.4 && edge <= bounds.left + width * 0.6)
      .sort((a,b) => a-b);
    for (let index = 1; index < edges.length; index += 1) {
      if (edges[index] - edges[index-1] >= gutter) candidates.push((edges[index]+edges[index-1])/2);
    }
    let best = null;
    for (const split of candidates) {
      const left = measurable.filter(item => item.rect.right <= split - gutter / 2);
      const right = measurable.filter(item => item.rect.left >= split + gutter / 2);
      const sided = new Set([...left, ...right]);
      const spanning = measurable.filter(item => !sided.has(item));
      if (left.length < 2 || right.length < 2) continue;
      // A true column gutter crosses few text boxes. A high spanning ratio is
      // the signature of one wide line split into several inline PDF items.
      if (spanning.length / measurable.length > 0.45) continue;
      const leftTop = Math.min(...left.map(item => item.rect.top));
      const leftBottom = Math.max(...left.map(item => item.rect.bottom));
      const rightTop = Math.min(...right.map(item => item.rect.top));
      const rightBottom = Math.max(...right.map(item => item.rect.bottom));
      const overlap = Math.max(0, Math.min(leftBottom, rightBottom) - Math.max(leftTop, rightTop));
      const shorterHeight = Math.max(1,
        Math.min(leftBottom - leftTop, rightBottom - rightTop));
      if (overlap / shorterHeight < 0.35) continue;
      const score = Math.min(left.length, right.length) * 5 - spanning.length * 2;
      if (!best || score > best.score) best = { split, left, right, spanning, score };
    }
    if (!best) return Array.isArray(segments) ? segments : [];

    const pairedRight = new Set();
    let rowContinuations = 0;
    let strongRowContinuations = 0;
    for (const leftItem of best.left) {
      const candidate = best.right.filter(rightItem => !pairedRight.has(rightItem))
        .sort((first, second) =>
          Math.abs(first.rect.bottom - leftItem.rect.bottom) -
          Math.abs(second.rect.bottom - leftItem.rect.bottom))[0];
      const continuationKind = candidate &&
        hasRowContinuationEvidence(leftItem, candidate, width);
      if (continuationKind) {
        pairedRight.add(candidate);
        rowContinuations += 1;
        strongRowContinuations += Number(continuationKind === 'strong');
      }
    }
    const pairedRows = Math.max(1, Math.min(best.left.length, best.right.length));
    const continuationRatio = rowContinuations / pairedRows;
    const strongContinuationRatio = strongRowContinuations / pairedRows;
    if ((strongRowContinuations >= 2 && strongContinuationRatio >= 0.6) ||
        (pairedRows <= 6 && rowContinuations >= 2 && continuationRatio >= 0.6)) {
      return Array.isArray(segments) ? segments : [];
    }

    const left = new Set(best.left), right = new Set(best.right);
    // Inline font changes split a full-width caption into several PDF items.
    // Keep neighbours touching a spanning item on that same visual row; they
    // are not independent column fragments (e.g. the bold "Figure 2." label).
    const spanningItems = measurable.filter(item => !left.has(item) && !right.has(item));
    const connectedInline = (first, second) => {
      const a = first.rect, b = second.rect;
      const height = Math.min(a.bottom - a.top, b.bottom - b.top);
      if (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) < height * 0.4) return false;
      const gap = Math.max(a.left, b.left) - Math.min(a.right, b.right);
      return gap >= -1 && gap <= Math.max(3, height * 0.8);
    };
    for (let index = 0; index < spanningItems.length; index += 1) {
      for (const candidate of [...left, ...right]) {
        if (!connectedInline(spanningItems[index], candidate)) continue;
        left.delete(candidate);
        right.delete(candidate);
        spanningItems.push(candidate);
      }
    }
    best.left = best.left.filter(item => left.has(item));
    best.right = best.right.filter(item => right.has(item));
    const spanning = source.filter(item => item.rect && !left.has(item) && !right.has(item))
      .sort(verticalOrder);
    const columns = source.filter(item => left.has(item) || right.has(item));
    const ordered = [];
    const emitted = new Set();
    const emitColumnsBefore = boundary => {
      for (const column of [best.left, best.right]) {
        column.filter(item => !emitted.has(item) &&
          (boundary === Infinity || (item.rect.top + item.rect.bottom) / 2 < boundary))
          .sort(verticalOrder).forEach(item => { emitted.add(item); ordered.push(item); });
      }
    };
    for (const item of spanning) {
      emitColumnsBefore((item.rect.top + item.rect.bottom) / 2);
      emitted.add(item);
      ordered.push(item);
    }
    emitColumnsBefore(Infinity);
    source.filter(item => !item.rect).forEach(item => ordered.push(item));
    if (ordered.length !== source.length || columns.some(item => !emitted.has(item))) {
      return Array.isArray(segments) ? segments : [];
    }
    return ordered.map(({ sourceIndex: _sourceIndex, ...item }) => item);
  }

  function reorderPdfTextLayerForReadingOrder(textLayer) {
    if (!textLayer?.children || typeof textLayer.appendChild !== 'function' ||
        typeof textLayer.getBoundingClientRect !== 'function') return false;
    const children = Array.from(textLayer.children).filter(child =>
      child?.classList?.contains?.('endOfContent') !== true &&
      typeof child?.getBoundingClientRect === 'function' && String(child.textContent || '').trim());
    const segments = children.map(node => ({
      node, text: node.textContent, rect: node.getBoundingClientRect()
    }));
    const ordered = orderPdfTextSegmentsByGeometry(segments, textLayer.getBoundingClientRect());
    if (ordered.length !== children.length || ordered.every((item, index) => item.node === children[index])) {
      return false;
    }
    ordered.forEach(item => textLayer.appendChild(item.node));
    return true;
  }

  function mergePdfSelectionRects(rects = []) {
    const source = rects.map(rect => ({rect:normalizedRect(rect),lineId:rect.lineId})).filter(item=>item.rect)
      .sort(verticalOrder);
    const result=[];
    let previousLineId;
    for (const {rect,lineId} of source) {
      const previous=result.at(-1);
      const height=previous && Math.min(previous.bottom-previous.top,rect.bottom-rect.top);
      const overlap=previous && Math.min(previous.bottom,rect.bottom)-Math.max(previous.top,rect.top);
      const knownLines=lineId !== undefined && previousLineId !== undefined;
      const sameLine=knownLines && lineId === previousLineId;
      // Explicit PDF.js line breaks let us bridge justified spaces without
      // guessing across a narrower gutter between independent column lines.
      const maxGap=Math.max(2,height*(sameLine ? 1.5 : 0.45));
      if (previous && (!knownLines || sameLine) && overlap >= height*0.4 && rect.left-previous.right <= maxGap &&
          rect.left >= previous.left-1) {
        previous.right=Math.max(previous.right,rect.right);
        previous.top=Math.min(previous.top,rect.top);
        previous.bottom=Math.max(previous.bottom,rect.bottom);
      } else result.push({...rect});
      previousLineId=lineId;
    }
    return result;
  }

  function classifyPdfPageFurnitureSegments(segments = [], pageRect = {}, options = {}) {
    const bounds = normalizedRect(pageRect);
    const source = (Array.isArray(segments) ? segments : []).map((segment, index) => ({
      ...segment, sourceIndex: index, rect: normalizedRect(segment?.rect),
      furniture: false, kind: ''
    }));
    if (!bounds) return source;
    const measurable = source.filter(item => item.rect && String(item.text || '').trim());
    if (measurable.length < 2) return source;
    const pageHeight = bounds.bottom - bounds.top;
    const pageWidth = bounds.right - bounds.left;
    const heights = measurable.map(item => item.rect.bottom - item.rect.top)
      .sort((left, right) => left - right);
    const medianHeight = heights[Math.floor(heights.length / 2)] || 0;
    if (!(pageHeight > 0) || !(pageWidth > 0) || !(medianHeight > 0)) return source;

    const rows = [];
    for (const item of [...measurable].sort(verticalOrder)) {
      const center = (item.rect.top + item.rect.bottom) / 2;
      const row = rows.find(candidate => Math.abs(candidate.center - center) <=
        Math.max(2, Math.min(candidate.height, item.rect.bottom - item.rect.top) * 0.55));
      if (row) {
        row.items.push(item);
        row.top = Math.min(row.top, item.rect.top);
        row.bottom = Math.max(row.bottom, item.rect.bottom);
        row.left = Math.min(row.left, item.rect.left);
        row.right = Math.max(row.right, item.rect.right);
        row.center = (row.top + row.bottom) / 2;
        row.height = row.bottom - row.top;
      } else {
        rows.push({ items: [item], top: item.rect.top, bottom: item.rect.bottom,
          left: item.rect.left, right: item.rect.right, center,
          height: item.rect.bottom - item.rect.top });
      }
    }
    rows.sort((left, right) => left.top - right.top || left.left - right.left);
    const minimumGap = Math.max(8, medianHeight * 1.2);
    const headerPattern = /(?:\bresearch\s+article\b|\boriginal\s+article\b|\bbrief\s+communication\b|\bneuroscience\b|\beLife\b)/iu;
    const footerPattern = /(?:\bdoi\s*:|doi\.org\/|\b\d+\s+(?:of|\/)\s+\d+\b|\bet\s+al\.\s+\S*\d{4})/iu;
    const pageNumber = Math.max(1, Math.floor(Number(options.pageNumber) || 1));

    rows.forEach((row, rowIndex) => {
      const text = row.items.slice().sort((left, right) => left.rect.left - right.rect.left)
        .map(item => String(item.text || '').normalize('NFKC').trim())
        .filter(Boolean).join(' ');
      const previous = rows[rowIndex - 1];
      const next = rows[rowIndex + 1];
      const topRatio = (row.bottom - bounds.top) / pageHeight;
      const bottomRatio = (row.top - bounds.top) / pageHeight;
      const wideMultiPart = row.items.length >= 2 &&
        (row.right - row.left) / pageWidth >= 0.62;
      const separatedBelow = !next || next.top - row.bottom >= minimumGap;
      const separatedAbove = !previous || row.top - previous.bottom >= minimumGap;
      const header = topRatio <= 0.14 && text.length <= 180 &&
        (headerPattern.test(text) || (pageNumber > 1 && wideMultiPart && separatedBelow));
      const footer = bottomRatio >= 0.86 && text.length <= 220 &&
        (footerPattern.test(text) || (pageNumber > 1 && wideMultiPart && separatedAbove));
      if (!header && !footer) return;
      for (const item of row.items) {
        item.furniture = true;
        item.kind = header ? 'running-header' : 'running-footer';
      }
    });
    return source.sort((left, right) => left.sourceIndex - right.sourceIndex);
  }

  function markPdfTextLayerFurniture(textLayer, options = {}) {
    if (!textLayer?.querySelectorAll || typeof textLayer.getBoundingClientRect !== 'function') {
      return { marked: 0, total: 0 };
    }
    const nodes = [...textLayer.querySelectorAll('span')]
      .filter(node => !node.querySelector?.('span') && String(node.textContent || '').trim() &&
        typeof node.getBoundingClientRect === 'function');
    const classified = classifyPdfPageFurnitureSegments(nodes.map(node => ({
      node, text: node.textContent, rect: node.getBoundingClientRect()
    })), textLayer.getBoundingClientRect(), options);
    let marked = 0;
    for (const item of classified) {
      const node = item.node;
      if (!node?.style || !node?.dataset) continue;
      if (item.furniture) {
        node.dataset.pdfPageFurniture = item.kind;
        node.style.userSelect = 'none';
        node.style.webkitUserSelect = 'none';
        marked += 1;
      } else {
        delete node.dataset.pdfPageFurniture;
        node.style.removeProperty?.('user-select');
        node.style.removeProperty?.('-webkit-user-select');
      }
    }
    textLayer.dataset.pdfPageFurnitureCount = String(marked);
    return { marked, total: classified.length };
  }

  function orderPdfTextContentForReading(textContent, page = {}) {
    const items = Array.isArray(textContent?.items) ? textContent.items : [];
    const view = Array.isArray(page?.view) ? page.view.map(Number) : [];
    const rotation = ((Number(page?.rotate) || 0) % 360 + 360) % 360;
    if (items.length < 4 || view.length !== 4 || !view.every(Number.isFinite) ||
        view[2] <= view[0] || view[3] <= view[1] || rotation !== 0) return textContent;

    const groups = [];
    const stack = [];
    let balanced = true;
    for (const item of items) {
      if (/^beginMarkedContent/u.test(String(item?.type || ''))) {
        if (!stack.length) groups.push({ items: [], textItems: [] });
        stack.push(groups.at(-1));
        groups.at(-1).items.push(item);
      } else if (item?.type === 'endMarkedContent') {
        if (!stack.length) { balanced = false; break; }
        groups.at(-1).items.push(item);
        stack.pop();
      } else if (stack.length) {
        groups.at(-1).items.push(item);
        if (typeof item?.str === 'string') groups.at(-1).textItems.push(item);
      } else if (typeof item?.str === 'string' && !item.str.trim() && groups.at(-1)?.textItems.length) {
        // PDF.js encodes many inline spaces with zero height. They have no
        // sortable rectangle, but still belong beside their preceding item;
        // moving them to the page end makes a drag select the footer too.
        groups.at(-1).items.push(item);
      } else {
        groups.push({ items: [item], textItems: typeof item?.str === 'string' ? [item] : [] });
      }
    }
    if (!balanced || stack.length) return textContent;

    const segments = groups.map(group => {
      const rects = group.textItems.flatMap(item => {
        const transform = Array.isArray(item?.transform) ? item.transform.map(Number) : [];
        const width = Math.abs(Number(item?.width));
        const height = Math.abs(Number(item?.height));
        if (transform.length < 6 || !transform.slice(0, 6).every(Number.isFinite) ||
            !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          return [];
        }
        const left = transform[4] - view[0];
        const bottom = view[3] - transform[5];
        return [{ left, top: bottom - height, right: left + width, bottom }];
      });
      const rect = rects.length ? {
        left: Math.min(...rects.map(item => item.left)),
        top: Math.min(...rects.map(item => item.top)),
        right: Math.max(...rects.map(item => item.right)),
        bottom: Math.max(...rects.map(item => item.bottom))
      } : null;
      return { group, text: group.textItems.map(item => item.str).join(' '), rect };
    });
    const ordered = orderPdfTextSegmentsByGeometry(segments, {
      left: 0, top: 0, right: view[2] - view[0], bottom: view[3] - view[1]
    });
    if (ordered.length !== groups.length ||
        ordered.every((segment, index) => segment.group === groups[index])) return textContent;
    return { ...textContent, items: ordered.flatMap(segment => segment.group.items) };
  }

  // Each PDF.js span is an original text item. Virtual whitespace matches the
  // native page index, but is never inserted into PDF.js's positioned DOM.
  function rawOffsetItemPieces(raw) {
    const entries = [];
    if (typeof Intl === 'object' && typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
      for (const entry of segmenter.segment(raw)) {
        entries.push({ text: entry.segment, start: entry.index,
          end: entry.index + entry.segment.length });
      }
    } else {
      let offset = 0;
      for (const character of raw) {
        const start = offset;
        offset += character.length;
        if (/^\p{M}+$/u.test(character) && entries.length) {
          entries.at(-1).text += character;
          entries.at(-1).end = offset;
        } else entries.push({ text: character, start, end: offset });
      }
    }
    const controls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
    const pieces = entries.map(entry => ({ ...entry,
      text: entry.text.normalize('NFKC').replace(controls, '') }))
      .filter(entry => entry.text);
    const normalizedItem = raw.normalize('NFKC').replace(controls, '');
    return pieces.map(entry => entry.text).join('') === normalizedItem
      ? pieces : [{ text: normalizedItem, start: 0, end: raw.length }];
  }

  function createRawOffsetProjection(segments) {
    const chars = [], starts = [], ends = [];
    let pendingWhitespace = null;
    const emit = (text, node, start, end) => {
      for (let offset = 0; offset < text.length; offset += 1) {
        chars.push(text[offset]);
        starts.push({ node, offset: start });
        ends.push({ node, offset: end });
      }
    };
    for (const segment of segments) {
      const node = segment?.node;
      const raw = String(segment?.text ?? '');
      if (chars.length && !pendingWhitespace) {
        pendingWhitespace = { node, start: 0, end: 0, virtual: true };
      } else if (pendingWhitespace?.virtual) {
        pendingWhitespace = { node, start: 0, end: 0, virtual: true };
      }
      for (const piece of rawOffsetItemPieces(raw)) {
        let normalizedOffset = 0;
        for (const character of piece.text) {
          normalizedOffset += character.length;
          if (/^\s+$/u.test(character)) {
            if (chars.length) {
              if (!pendingWhitespace || pendingWhitespace.virtual ||
                  pendingWhitespace.node !== node) {
                pendingWhitespace = { node, start: piece.start, end: piece.end,
                  virtual: false };
              } else pendingWhitespace.end = piece.end;
            }
            continue;
          }
          if (pendingWhitespace && chars.length) {
            emit(' ', pendingWhitespace.node, pendingWhitespace.start,
              pendingWhitespace.end);
          }
          pendingWhitespace = null;
          const from = normalizedOffset - character.length;
          emit(piece.text.slice(from, normalizedOffset), node, piece.start, piece.end);
        }
      }
    }
    return { text: chars.join(''), starts, ends, mode: 'raw-offset' };
  }

  function createPdfTextProjection(segments = [], options = {}) {
    const mode = options?.mode === 'raw-offset' ? 'raw-offset' : 'selection';
    if (mode === 'raw-offset') return createRawOffsetProjection(segments);
    const chars = [], starts = [], ends = [];
    let whitespace = false;
    for (const segment of segments) {
      const raw = String(segment?.text ?? '');
      let offset = 0;
      for (const character of raw) {
        const start = offset;
        offset += character.length;
        const expanded = character.normalize('NFKC');
        for (const unit of expanded) {
          if (/\s|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(unit)) {
            if (chars.length) whitespace = true;
            continue;
          }
          if (whitespace && chars.length) {
            chars.push(' ');
            starts.push({ node: segment.node, offset: start });
            ends.push({ node: segment.node, offset: start });
          }
          whitespace = false;
          // Index by UTF-16 units, as the analysis offsets do.
          for (let i = 0; i < unit.length; i += 1) {
            chars.push(unit[i]);
            starts.push({ node: segment.node, offset: start });
            ends.push({ node: segment.node, offset });
          }
        }
      }
      if (chars.length) whitespace = true;
    }
    return { text: chars.join(''), starts, ends };
  }

  function pdfProjectionRange(projection, annotation, documentObject) {
    const start = Number(annotation?.start), end = Number(annotation?.end);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 ||
        end <= start || end > projection.text.length ||
        projection.text.slice(start, end) !== annotation.quote) return null;
    if (projection.mode === 'raw-offset') {
      const sameAtomicSource = (left, right) => left >= 0 && right < projection.text.length &&
        projection.starts[left]?.node === projection.starts[right]?.node &&
        projection.starts[left]?.offset === projection.starts[right]?.offset &&
        projection.ends[left]?.node === projection.ends[right]?.node &&
        projection.ends[left]?.offset === projection.ends[right]?.offset;
      if (sameAtomicSource(start - 1, start) || sameAtomicSource(end - 1, end)) return null;
    }
    const from = projection.starts[start], to = projection.ends[end - 1];
    if (!from?.node || !to?.node) return null;
    if (from.node === to.node && to.offset <= from.offset) return null;
    const range = documentObject.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  }

  function readPdfTextProjection(textLayer, options = {}) {
    const mode = options?.mode === 'raw-offset' ? 'raw-offset' : 'selection';
    const documentObject = textLayer.ownerDocument;
    const spans = [...textLayer.querySelectorAll('span')]
      .filter(span => !span.querySelector('span') && span.textContent &&
        (mode === 'raw-offset' || !span.dataset?.pdfPageFurniture));
    const segments = [];
    for (const span of spans) {
      const walker = documentObject.createTreeWalker(span, 4);
      let node;
      while ((node = walker.nextNode())) segments.push({ node, text: node.textContent });
    }
    return createPdfTextProjection(segments, { mode });
  }

  function pdfProjectionRects(range, pageRect) {
    const seen = new Set();
    return [...range.getClientRects()].flatMap(rect => {
      const left = Math.max(pageRect.left, rect.left), top = Math.max(pageRect.top, rect.top);
      const right = Math.min(pageRect.right, rect.right), bottom = Math.min(pageRect.bottom, rect.bottom);
      if (right - left < 0.5 || bottom - top < 0.5) return [];
      const result = { left: left - pageRect.left, top: top - pageRect.top,
        width: right - left, height: bottom - top };
      const key = Object.values(result).map(value => Math.round(value * 10)).join(':');
      if (seen.has(key)) return [];
      seen.add(key);
      return [result];
    });
  }

  return {
    classifyPdfPageFurnitureSegments,
    createPdfTextProjection,
    markPdfTextLayerFurniture,
    orderPdfTextContentForReading,
    mergePdfSelectionRects,
    orderPdfTextSegmentsByGeometry,
    reorderPdfTextLayerForReadingOrder,
    pdfProjectionRange,
    readPdfTextProjection,
    pdfProjectionRects
  };
});
