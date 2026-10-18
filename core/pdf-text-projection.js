(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  // Selection boundary handling adapted from Mozilla PDF.js 5.4.624,
  // web/text_layer_builder.js, Copyright 2012 Mozilla Foundation, Apache-2.0.
  // The empty endOfContent boundary follows the changing selection endpoint so
  // Chromium's blank-area caret does not sweep unrelated source spans. Source
  // spans, BRs, marked-content wrappers and Selection endpoints stay intact.
  function createPdfTextSelectionController(options = {}) {
    const doc = options.document || globalThis.document;
    const win = options.window || doc?.defaultView || globalThis;
    const layers = new Map();
    let globalCleanup = null;
    let pointerDown = false;
    let previousRange = null;
    let destroyed = false;

    function resetLayer(layer, end) {
      if (end.parentElement !== layer || end.nextSibling) layer.append(end);
      end.style.width = '';
      end.style.height = '';
      end.style.userSelect = '';
      layer.classList.remove('selecting');
    }

    function reset() {
      previousRange = null;
      for (const [layer, { end }] of layers) resetLayer(layer, end);
    }

    function onSelectionChange() {
      const selection = doc.getSelection();
      if (!selection?.rangeCount) { reset(); return; }
      const ranges = [];
      for (let index = 0; index < selection.rangeCount; index += 1) {
        ranges.push(selection.getRangeAt(index));
      }
      const activeLayers = new Set();
      for (const [layer, { end }] of layers) {
        const selected = ranges.some(range => {
          try { return range.intersectsNode(layer); } catch (_) { return false; }
        });
        if (selected) { activeLayers.add(layer); layer.classList.add('selecting'); }
        else resetLayer(layer, end);
      }
      if (!activeLayers.size) { previousRange = null; return; }
      // Firefox already limits its blank-space selection without relocating the
      // boundary. Match the generic PDF.js viewer's capability check.
      if (win.getComputedStyle?.(layers.get(activeLayers.values().next().value).end)
        ?.getPropertyValue?.('-moz-user-select') === 'none') return;
      const range = ranges[0];
      const rangeType = win.Range || globalThis.Range;
      let modifyStart = false;
      try {
        modifyStart = !!previousRange &&
          (range.compareBoundaryPoints(rangeType.END_TO_END, previousRange) === 0 ||
           range.compareBoundaryPoints(rangeType.START_TO_END, previousRange) === 0);
      } catch (_) {
        // A virtualized page can retire a prior Range between pointer events.
        previousRange = null;
      }
      let anchor = modifyStart ? range.startContainer : range.endContainer;
      if (anchor?.nodeType === 3) anchor = anchor.parentElement;
      const sourceLayer = anchor?.closest?.('.textLayer');
      if (!modifyStart && range.endOffset === 0 && sourceLayer && layers.has(sourceLayer)) {
        // An endpoint at offset zero belongs to the previous nonempty source
        // node. Walk across BRs/wrappers without escaping this text layer.
        do {
          while (anchor !== sourceLayer && !anchor.previousSibling) anchor = anchor.parentElement;
          if (!anchor || anchor === sourceLayer) { anchor = null; break; }
          anchor = anchor.previousSibling;
        } while (anchor && !anchor.childNodes.length);
      }
      const parentLayer = anchor?.parentElement?.closest?.('.textLayer');
      const end = layers.get(parentLayer)?.end;
      if (end && activeLayers.has(parentLayer) && anchor !== end) {
        end.style.width = parentLayer.style.width;
        end.style.height = parentLayer.style.height;
        end.style.userSelect = 'text';
        const before = modifyStart ? anchor : anchor.nextSibling;
        if (before !== end) anchor.parentElement.insertBefore(end, before);
      }
      previousRange = range.cloneRange();
    }

    function enableGlobalListeners() {
      if (globalCleanup) return;
      const removals = [];
      const listen = (target, type, handler) => {
        target.addEventListener(type, handler);
        removals.push(() => target.removeEventListener(type, handler));
      };
      const pinReleasedSelection = () => pinPdfSelectionTextEndpoints(doc.getSelection(), node => {
        const element = node?.nodeType === 1 ? node : node?.parentElement;
        const layer = element?.closest?.('.textLayer');
        return layers.has(layer) ? layer : null;
      });
      const finishPointer = event => {
        pointerDown = false;
        if (event?.type === 'pointerup') pinReleasedSelection();
        reset();
      };
      listen(doc, 'pointerdown', () => { pointerDown = true; });
      listen(doc, 'pointerup', finishPointer);
      listen(doc, 'pointercancel', finishPointer);
      listen(win, 'blur', finishPointer);
      listen(doc, 'keyup', () => { if (!pointerDown) { pinReleasedSelection(); reset(); } });
      listen(doc, 'selectionchange', onSelectionChange);
      globalCleanup = () => {
        removals.forEach(remove => remove());
        globalCleanup = null;
        pointerDown = false;
        previousRange = null;
      };
    }

    function register(layer) {
      if (destroyed || !layer || !doc) return null;
      if (layers.has(layer)) return layers.get(layer).end;
      const end = layer.querySelector?.('.endOfContent') || doc.createElement('div');
      end.className = 'endOfContent';
      layer.append(end);
      const mouseDown = event => {
        if (event.button === undefined || event.button === 0) layer.classList.add('selecting');
      };
      layer.addEventListener('mousedown', mouseDown);
      layers.set(layer, { end, mouseDown });
      enableGlobalListeners();
      return end;
    }

    function unregister(layer) {
      const record = layers.get(layer);
      if (!record) return;
      resetLayer(layer, record.end);
      layer.removeEventListener('mousedown', record.mouseDown);
      layers.delete(layer);
      previousRange = null;
      if (!layers.size) globalCleanup?.();
    }

    function clear() {
      for (const layer of [...layers.keys()]) unregister(layer);
    }

    function destroy() { clear(); destroyed = true; }
    return { register, unregister, reset, clear, destroy };
  }

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
  function orderPdfTextSegmentsByGeometry(segments = [], pageRect = {}, options = {}) {
    if (!options.furnitureSeparated) {
      const classified = classifyPdfPageFurnitureSegments(segments, pageRect, options);
      if (classified.some(item => item.furniture)) {
        // Keep every original item available to legacy raw-offset anchors, but
        // keep unrelated running margins and publication sidebars out of a
        // continuous body drag. Visual positions are unchanged by DOM order.
        const headers = classified.filter(item => item.kind === 'running-header').sort(verticalOrder);
        const body = classified.filter(item => !item.furniture);
        const margins = classified.filter(item => item.furniture && item.kind !== 'running-header').sort(verticalOrder);
        return [...headers, ...orderPdfTextSegmentsByGeometry(body, pageRect,
          { ...options, furnitureSeparated: true }), ...margins];
      }
    }
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
    // Small author/citation fragments in a full-width region can fill a real
    // gutter's edge list. Also derive candidates from substantive text boxes.
    for (const geometryItems of [measurable,
      measurable.filter(item => item.rect.right - item.rect.left >= width * 0.2)]) {
      const edges = [...new Set(geometryItems.flatMap(item => [item.rect.left, item.rect.right]))]
        .filter(edge => edge >= bounds.left + width * 0.4 && edge <= bounds.left + width * 0.6)
        .sort((a,b) => a-b);
      for (let index = 1; index < edges.length; index += 1) {
        if (edges[index] - edges[index-1] >= gutter) candidates.push((edges[index]+edges[index-1])/2);
      }
    }
    // A mixed-layout first page can put broad abstract/author fragments above
    // narrow body columns. Their unrelated x edges fill the true gutter in the
    // whole-page edge list, while the fixed scan steps over it. Also use gaps
    // between substantive boxes sharing a visual row. They only nominate a
    // split: the existing overlap, spanning and row-continuation checks still
    // decide whether it is a column gutter rather than a formula/table gap.
    const substantive = measurable.filter(item =>
      item.rect.right - item.rect.left >= width * 0.2).sort((a, b) => a.rect.top - b.rect.top);
    const localSplits = new Set();
    for (let first = 0; first < substantive.length; first += 1) {
      const a = substantive[first].rect;
      for (let next = first + 1; next < substantive.length; next += 1) {
        const b = substantive[next].rect;
        if (b.top >= a.bottom) break;
        const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlap < Math.min(a.bottom - a.top, b.bottom - b.top) * 0.4) continue;
        const leftBox = a.left < b.left ? a : b, rightBox = leftBox === a ? b : a;
        const gap = rightBox.left - leftBox.right;
        const split = (leftBox.right + rightBox.left) / 2;
        if (gap < gutter || gap > width * 0.2 ||
            split < bounds.left + width * 0.4 || split > bounds.left + width * 0.6) continue;
        localSplits.add(Math.round(split * 100) / 100);
      }
    }
    candidates.push(...localSplits);
    let best = null;
    for (const split of candidates) {
      const left = measurable.filter(item => item.rect.right <= split - gutter / 2);
      const right = measurable.filter(item => item.rect.left >= split + gutter / 2);
      const sided = new Set([...left, ...right]);
      const spanning = measurable.filter(item => !sided.has(item));
      if (left.length < 2 || right.length < 2) continue;
      const leftTop = Math.min(...left.map(item => item.rect.top));
      const leftBottom = Math.max(...left.map(item => item.rect.bottom));
      const rightTop = Math.min(...right.map(item => item.rect.top));
      const rightBottom = Math.max(...right.map(item => item.rect.bottom));
      const overlap = Math.max(0, Math.min(leftBottom, rightBottom) - Math.max(leftTop, rightTop));
      const shorterHeight = Math.max(1,
        Math.min(leftBottom - leftTop, rightBottom - rightTop));
      if (overlap / shorterHeight < 0.35) continue;
      // Apply the spanning veto locally when a long full-width top/bottom
      // otherwise masks columns in their overlapping vertical region.
      if (spanning.length / measurable.length > 0.45) {
        const overlapsColumns = item => item.rect.bottom > Math.max(leftTop, rightTop) &&
          item.rect.top < Math.min(leftBottom, rightBottom);
        const local = measurable.filter(overlapsColumns);
        if (left.filter(overlapsColumns).length < 2 || right.filter(overlapsColumns).length < 2 ||
            spanning.filter(overlapsColumns).length / local.length > 0.45) continue;
      }
      // Counting glyph fragments gives a false gutter inside a broad body
      // column more votes than its complete lines. Use their horizontal mass.
      const weight = values => values.reduce((sum, item) => sum +
        Math.min(item.rect.right - item.rect.left, width * 0.4) / width, 0);
      const score = Math.min(weight(left), weight(right)) * 5 - weight(spanning) * 2;
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
      const lineHeight = Math.max(a.bottom - a.top, b.bottom - b.top);
      if (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) < height * 0.4) return false;
      const gap = Math.max(a.left, b.left) - Math.min(a.right, b.right);
      return gap >= -1 && gap <= Math.max(3, Math.min(lineHeight * 0.8, 12));
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

  function pdfTextLeafEntries(textLayer) {
    if (!textLayer?.querySelectorAll) return [];
    const children = Array.from(textLayer.querySelectorAll('span, br'));
    const explicitLines = children.some(node => node.tagName === 'BR');
    const entries = [];
    let lineId = 0;
    for (const node of children) {
      if (node.tagName === 'BR') { lineId += 1; continue; }
      if (node.childElementCount || node.dataset?.pdfPageFurniture ||
          !String(node.textContent || '').trim()) continue;
      entries.push({ node, lineId: explicitLines ? lineId : undefined });
    }
    return entries;
  }

  function repairPdfSelectionLineEnd(selection, textLayer, point, anchorPoint = null) {
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1 ||
        typeof selection.setBaseAndExtent !== 'function' ||
        !textLayer?.contains?.(selection.anchorNode) || !textLayer.contains(selection.focusNode)) return false;
    const rotation = Number(textLayer.dataset?.mainRotation || 0);
    if (!Number.isFinite(rotation) || rotation % 360 !== 0) return false;
    const hasForwardHorizontalText = node => {
      const style = textLayer.ownerDocument?.defaultView?.getComputedStyle?.(node);
      if (!style || style.direction === 'rtl') return false;
      if (!style.transform || style.transform === 'none') return true;
      const matrix = String(style.transform).match(/^matrix\(([^)]+)\)$/);
      const values = matrix?.[1].split(',').map(Number);
      return values?.length === 6 && values.every(Number.isFinite) &&
        values[0] > 0 && values[3] > 0 && Math.abs(values[1]) <= 0.0001 && Math.abs(values[2]) <= 0.0001;
    };
    if (!hasForwardHorizontalText(textLayer)) return false;
    const isGhost = node => node === textLayer || node?.tagName === 'BR' ||
      (node?.nodeType === 1 && node.className === 'endOfContent' && !node.childNodes?.length &&
        node.closest?.('.textLayer') === textLayer);
    if (!isGhost(selection.focusNode) && !isGhost(selection.anchorNode)) return false;
    const entries = pdfTextLeafEntries(textLayer).map(entry => ({ ...entry,
      rect: normalizedRect(entry.node.getBoundingClientRect()) })).filter(entry => entry.rect);
    const ends = new Map();
    for (const entry of entries) if (entry.lineId !== undefined) ends.set(entry.lineId, entry);
    const rows = new Map();
    for (const { lineId, rect } of entries) {
      if (lineId === undefined) continue;
      const row = rows.get(lineId);
      rows.set(lineId, row ? { lineId, left: Math.min(row.left, rect.left), right: Math.max(row.right, rect.right),
        top: Math.min(row.top, rect.top), bottom: Math.max(row.bottom, rect.bottom) } : { lineId, ...rect });
    }
    const insideProvenColumn = (entry, location, oppositeNode, oppositePoint, limit) => {
      const target = rows.get(entry.lineId), height = target.bottom - target.top;
      // A short final row can end well before its column's justified edge. Only
      // borrow that edge from two adjacent aligned rows that agree with each
      // other; a heading, another column or a lone wider row is not evidence.
      const aligned = [...rows.values()].filter(row => Math.abs(row.left - target.left) <= limit);
      const nearby = aligned.filter(row => row.lineId !== target.lineId &&
        Math.abs(row.top - target.top) <= height * 4 && row.right > target.right + limit);
      const cluster = nearby.filter(row => nearby.some(other => other !== row &&
        Math.abs(other.right - row.right) <= limit));
      if (cluster.length < 2) return false;
      const columnRight = Math.min(...cluster.map(row => row.right)) + limit;
      if (location.x > columnRight) return false;
      const source = entries.find(({ node }) => node === oppositeNode || node.contains?.(oppositeNode) || node === oppositeNode?.parentElement);
      const anchor = source ? rows.get(source.lineId) : aligned.find(row =>
        Number.isFinite(oppositePoint?.x) && Number.isFinite(oppositePoint?.y) &&
        oppositePoint.x >= row.left && oppositePoint.x <= columnRight &&
        oppositePoint.y >= row.top && oppositePoint.y <= row.bottom);
      if (!anchor || Math.abs(anchor.left - target.left) > limit ||
          Math.abs(anchor.right - (columnRight - limit)) > limit) return false;
      const chain = aligned.filter(row => row.top >= Math.min(anchor.top, target.top) &&
        row.top <= Math.max(anchor.top, target.top)).sort((a, b) => a.top - b.top);
      for (let index = 1; index < chain.length; index++) {
        const previous = chain[index - 1], current = chain[index];
        const lineHeight = Math.min(previous.bottom - previous.top, current.bottom - current.top);
        if (current.top - previous.bottom > Math.max(5, lineHeight * 0.85) || current.right > columnRight) return false;
      }
      return true;
    };
    const atLineEnd = (location, oppositeNode, oppositePoint) => {
      if (!Number.isFinite(location?.x) || !Number.isFinite(location?.y)) return null;
      const { x, y } = location;
      // Do not replace a hit on actual text, including text in another column.
      if (entries.some(({ rect: r }) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) return null;
      const candidates = [];
      for (const entry of ends.values()) {
        const { node, rect: r } = entry;
        if (y < r.top || y > r.bottom || node.lastChild?.nodeType !== 3) continue;
        if (!hasForwardHorizontalText(node)) continue;
        const limit = Math.min(8, (r.bottom - r.top) / 2);
        const gap = x - r.right;
        if (gap <= 0 || (gap > limit && !insideProvenColumn(entry, location, oppositeNode, oppositePoint, limit))) continue;
        // A narrow column gutter is ambiguous; keep the browser's own endpoint.
        if (entries.some(other => other.lineId !== entry.lineId &&
            other.rect.left > r.right && other.rect.left - r.right <= limit * 2 &&
            y >= other.rect.top && y <= other.rect.bottom)) continue;
        candidates.push(node.lastChild);
      }
      return candidates.length === 1 ? candidates[0] : null;
    };
    const anchor = isGhost(selection.anchorNode) ? atLineEnd(anchorPoint, selection.focusNode, point) : null;
    const focus = isGhost(selection.focusNode) ? atLineEnd(point, selection.anchorNode, anchorPoint) : null;
    if (!anchor && !focus) return false;
    selection.setBaseAndExtent(anchor || selection.anchorNode,
      anchor ? anchor.textContent.length : selection.anchorOffset,
      focus || selection.focusNode, focus ? focus.textContent.length : selection.focusOffset);
    return true;
  }

  // Read the selected portion of each original leaf, not a marked-content
  // ancestor's bounding box. Ancestors can span columns or contain unselected
  // leaves. The source Range and its UTF-16 endpoints are never changed.
  function readPdfRangeRects(range, textLayer) {
    const ownerDocument = textLayer?.ownerDocument;
    if (!ownerDocument?.createRange || typeof range?.intersectsNode !== 'function') return null;
    const entries = pdfTextLeafEntries(textLayer);
    if (!entries.length) return null;
    const rects = [];
    try {
      for (const { node, lineId } of entries) {
        if (!range.intersectsNode(node)) continue;
        const leaf = ownerDocument.createRange();
        leaf.selectNodeContents(node);
        if (leaf.compareBoundaryPoints(0, range) < 0) {
          leaf.setStart(range.startContainer, range.startOffset);
        }
        if (leaf.compareBoundaryPoints(2, range) > 0) {
          leaf.setEnd(range.endContainer, range.endOffset);
        }
        for (const rect of leaf.getClientRects()) {
          const normalized = normalizedRect(rect);
          if (normalized) rects.push({ ...normalized, lineId });
        }
      }
    } catch (_) { return []; } // A virtualized layer lost its original owner.
    return mergePdfSelectionRects(rects);
  }

  // Legacy anchors retain every stored quad. Match their display rectangles to
  // current PDF.js rows before bridging justified spaces; never infer a shared
  // row across the gutter merely because two quads have the same baseline.
  function mergePdfRectsWithTextLayer(rects, textLayer, origin = {}) {
    const entries = pdfTextLeafEntries(textLayer).flatMap(({ node, lineId }) => {
      const bounds = normalizedRect(node.getBoundingClientRect?.());
      return bounds && lineId !== undefined ? [{ lineId, rect: {
        left: bounds.left - (Number(origin.left) || 0), right: bounds.right - (Number(origin.left) || 0),
        top: bounds.top - (Number(origin.top) || 0), bottom: bounds.bottom - (Number(origin.top) || 0)
      } }] : [];
    });
    return mergePdfSelectionRects(rects.map((rect, index) => {
      const matches = entries.filter(item => {
        const a = item.rect;
        const height = Math.min(a.bottom - a.top, rect.bottom - rect.top);
        return Math.min(a.right, rect.right) - Math.max(a.left, rect.left) > 0.01 &&
          Math.min(a.bottom, rect.bottom) - Math.max(a.top, rect.top) >= height * 0.4;
      });
      const ids = new Set(matches.map(item => item.lineId));
      return { ...rect, lineId: ids.size === 1 ? matches[0].lineId : `unresolved-quad-${index}` };
    }));
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
    const headerPattern = /(?:\bresearch\s+article\b|\boriginal\s+article\b|\bbrief\s+communication\b|\bneuroscience\b|\beLife\b|^articles?$)/iu;
    const footerPattern = /(?:\bdoi\s*:|\b\d+\s+(?:of|\/)\s+\d+\b|\bet\s+al\.\s+\S*\d{4}|www\.[\w.-]+\s+Vol\.?\s*\d+)/iu;
    const pageNumber = Math.max(1, Math.floor(Number(options.pageNumber) || 1));

    // A rotated page can put its original footer along a vertical edge. Keep
    // this exception tied to a complete publication footer and its geometry;
    // ordinary tall scientific labels at the edge remain selectable.
    for (const item of measurable) {
      const width = item.rect.right - item.rect.left;
      const height = item.rect.bottom - item.rect.top;
      const pageLabel=String(item.text || '').trim().match(/^Page\s+(\d+)$/u);
      if(pageLabel && Number(pageLabel[1])===pageNumber && height<=12 &&
          item.rect.bottom<=bounds.top+pageHeight*.08 && item.rect.left>=bounds.left+pageWidth*.75){
        item.furniture=true;item.kind='page-number';
      }
      if (width < height * 0.2 &&
          (item.rect.right <= bounds.left + pageWidth * 0.08 ||
            item.rect.left >= bounds.left + pageWidth * 0.92) &&
          (/^www\.[\w.-]+\s+Vol\.?\s*\d+/iu.test(String(item.text || '').trim()) ||
            /\bdownloaded\s+from\s+https?:\/\//iu.test(String(item.text || '')) &&
            /\b(?:terms\s+and\s+conditions|creative\s+commons|licen[cs]e)\b/iu.test(String(item.text || '')))) {
        item.furniture = true;
        item.kind = 'running-footer';
      }
    }

    rows.forEach((row, rowIndex) => {
      const text = row.items.slice().sort((left, right) => left.rect.left - right.rect.left)
        .map(item => String(item.text || '').normalize('NFKC').trim())
        .filter(Boolean).join(' ');
      const previous = rows[rowIndex - 1];
      const next = rows[rowIndex + 1];
      const topRatio = (row.bottom - bounds.top) / pageHeight;
      const bottomRatio = (row.top - bounds.top) / pageHeight;
      const separatedAbove = !previous || row.top - previous.bottom >= minimumGap;
      const separatedBelow = !next || next.top - row.bottom >= minimumGap;
      const scientificRow = /^(?:fig(?:ure)?|table)\s*\S*\d|\bcontinued\b|\b[pP]\s*[<>=]|\([a-z]\)/u.test(text);
      const header = topRatio <= 0.14 && separatedBelow && text.length <= 180 &&
        !scientificRow && (headerPattern.test(text) ||
          /(?:https?:\/\/(?:dx\.)?doi\.org\/|\bwww\.[\w.-]+\.(?:com|org|net)\b)/iu.test(text));
      const edgePageNumber = /^\d{1,5}$/u.test(text) && separatedAbove &&
        (row.right < bounds.left + pageWidth * 0.25 || row.left > bounds.left + pageWidth * 0.75);
      const footer = bottomRatio >= 0.86 && separatedAbove && text.length <= 220 &&
        (footerPattern.test(text) || edgePageNumber ||
          bottomRatio >= 0.94 && separatedAbove && !scientificRow &&
          (/\b(?:volume|vol\.?|issue)\s+\d+/iu.test(text) ||
            /\b\d{1,4}\s*[,;]\s*\d+\s*[-–]\s*\d+.*\b(?:19|20)\d{2}\b/u.test(text)));
      if (!header && !footer) return;
      for (const item of row.items) {
        item.furniture = true;
        item.kind = header ? 'running-header' : 'running-footer';
      }
    });
    // First-page publication details can form a narrow side island beside a
    // full-width abstract. A strong metadata seed, an outer-margin position
    // and a wider adjacent body flow are all required; narrow scientific
    // columns or numbers alone are never enough to hide selectable text.
    const metadataSeed = /(?:^published\s+online\b|^https?:\/\/doi\.org\/|\b\d{4}\s*;\s*\d+\s*:)/iu;
    const sideCandidates = measurable.filter(item => !item.furniture &&
      item.rect.right - item.rect.left <= pageWidth * 0.22 &&
      (item.rect.left >= bounds.left + pageWidth * 0.74 || item.rect.right <= bounds.left + pageWidth * 0.26));
    for (const seed of sideCandidates.filter(item => metadataSeed.test(String(item.text || '').trim()))) {
      const tolerance = Math.max(3, medianHeight * 0.6);
      const island = sideCandidates.filter(item => Math.abs(item.rect.left - seed.rect.left) <= tolerance &&
        Math.abs((item.rect.top + item.rect.bottom - seed.rect.top - seed.rect.bottom) / 2) <= medianHeight * 14);
      if (island.length < 2) continue;
      const top = Math.min(...island.map(item => item.rect.top));
      const bottom = Math.max(...island.map(item => item.rect.bottom));
      const hasBody = measurable.some(item => !island.includes(item) && !item.furniture &&
        item.rect.right - item.rect.left >= pageWidth * 0.45 &&
        item.rect.bottom >= top && item.rect.top <= bottom &&
        (item.rect.right + tolerance < seed.rect.left || item.rect.left > seed.rect.right + tolerance));
      if (!hasBody) continue;
      for (const item of island) { item.furniture = true; item.kind = 'publication-metadata'; }
    }
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
    const result = { marked, total: classified.length };
    // Furniture and selection rows are computed in one synchronous commit.
    // Reuse these absolute client rectangles before any resize/unmount; do
    // not retain a geometry cache across layers or render generations.
    if (options.captureGeometry === true) result.geometry = { segments: classified };
    return result;
  }

  function orderPdfTextContentForReading(textContent, page = {}) {
    const items = Array.isArray(textContent?.items) ? textContent.items : [];
    const view = Array.isArray(page?.view) ? page.view.map(Number) : [];
    const rotation = ((Number(page?.rotate) || 0) % 360 + 360) % 360;
    if (items.length < 4 || view.length !== 4 || !view.every(Number.isFinite) ||
        view[2] <= view[0] || view[3] <= view[1] || rotation !== 0) return textContent;

    const rootScope = { children: [] };
    const stack = [rootScope];
    const originalScopeItems = group => group.children
      ? [group.begin, ...group.children.flatMap(originalScopeItems), group.end, ...group.trailingItems]
      : group.items;
    for (const item of items) {
      const scope = stack.at(-1), previous = scope.children.at(-1);
      if (/^beginMarkedContent/u.test(String(item?.type || ''))) {
        const child = { begin: item, end: null, children: [], hasText: false, trailingItems: [] };
        scope.children.push(child);
        stack.push(child);
        // Malformed/extreme nesting must not exhaust the recursive sorter.
        if (stack.length > 129) return textContent;
      } else if (item?.type === 'endMarkedContent') {
        if (stack.length === 1) return textContent;
        const child = stack.pop();
        child.end = item;
        const parent = stack.at(-1), preceding = parent.children.at(-2);
        parent.hasText ||= child.hasText;
        if (!child.hasText && preceding?.hasText) {
          // Some native streams put an empty balanced mark between a glyph
          // and its inline space. Keep all three beside the preceding text.
          parent.children.pop();
          const emptyItems = originalScopeItems(child);
          if (preceding.children) preceding.trailingItems.push(...emptyItems);
          else preceding.items.push(...emptyItems);
        }
      } else if (typeof item?.str === 'string' && !item.str.trim() && previous?.hasText) {
        // PDF.js encodes many inline spaces with zero height. They have no
        // sortable rectangle, but still belong beside their preceding item;
        // moving them to the page end makes a drag select the footer too.
        if (previous.children) previous.trailingItems.push(item);
        else previous.items.push(item);
      } else {
        const hasText = typeof item?.str === 'string' && Boolean(item.str.trim());
        scope.children.push({ items: [item], textItems: typeof item?.str === 'string' ? [item] : [], hasText });
        scope.hasText ||= hasText;
      }
    }
    if (stack.length !== 1) return textContent;

    const segmentFor = group => {
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
    };
    const orderScope = scope => {
      for (const child of scope.children) {
        if (!child.children) continue;
        const orderedChildren = orderScope(child);
        child.items = [child.begin, ...orderedChildren.flatMap(segment => segment.group.items),
          child.end, ...child.trailingItems];
        child.textItems = orderedChildren.flatMap(segment => segment.group.textItems);
      }
      // Sort siblings inside each balanced scope; never split/reopen a marker
      // or duplicate its DOM ID/Artifact attributes to interleave scopes.
      return orderPdfTextSegmentsByGeometry(scope.children.map(segmentFor), {
        left: 0, top: 0, right: view[2] - view[0], bottom: view[3] - view[1]
      });
    };
    const orderedItems = orderScope(rootScope).flatMap(segment => segment.group.items);
    if (orderedItems.length !== items.length || orderedItems.every((item, index) => item === items[index])) {
      return textContent;
    }
    return { ...textContent, items: orderedItems };
  }

  // An absent binding keeps standalone/legacy projections compatible. An
  // explicitly invalid binding must fail closed instead of guessing separators.
  const pdfTextLayerSourceItems = new WeakMap();

  function pdfSourceTextNodes(span) {
    const nodes = [];
    const walker = span.ownerDocument.createTreeWalker(span, 4);
    let node;
    while ((node = walker.nextNode())) nodes.push({ node, text: node.textContent });
    return nodes;
  }

  function pdfSourceBindingIsCurrent(textLayer, items) {
    const leaves = [...textLayer.querySelectorAll('span')]
      .filter(span => !span.querySelector('span') && span.textContent);
    const visible = items.filter(item => item.text.length);
    if (leaves.length !== visible.length) return false;
    for (let index = 0; index < visible.length; index += 1) {
      const item = visible[index];
      if (leaves[index] !== item.span || !textLayer.contains(item.span) ||
          item.span.ownerDocument !== textLayer.ownerDocument ||
          item.span.textContent !== item.text) return false;
      const nodes = pdfSourceTextNodes(item.span);
      if (nodes.length !== item.nodes.length || nodes.some((entry, at) =>
        entry.node !== item.nodes[at].node || entry.text !== item.nodes[at].text)) return false;
    }
    return true;
  }

  function bindPdfTextLayerSourceItems(textLayer, source = {}) {
    if (!textLayer || typeof textLayer !== 'object') return false;
    pdfTextLayerSourceItems.set(textLayer, null);
    try {
      const { textContent, textDivs, textContentItemsStr } = source;
      if (!Array.isArray(textContent?.items) || !Array.isArray(textDivs) ||
          !Array.isArray(textContentItemsStr)) return false;
      // PDF.js includes an unmounted span for an empty str item, and no slot
      // for marked-content instructions. Its public arrays preserve both facts.
      const sourceItems = textContent.items.filter(item => item?.str !== undefined);
      if (sourceItems.length !== textDivs.length || sourceItems.length !== textContentItemsStr.length ||
          new Set(textDivs).size !== textDivs.length) return false;
      const items = [];
      for (let index = 0; index < sourceItems.length; index += 1) {
        const item = sourceItems[index], span = textDivs[index];
        if (typeof item.str !== 'string' || textContentItemsStr[index] !== item.str ||
            span?.nodeType !== 1 || span.ownerDocument !== textLayer.ownerDocument ||
            span.textContent !== item.str || span.querySelector('span')) return false;
        const nodes = pdfSourceTextNodes(span);
        if (nodes.map(entry => entry.text).join('') !== item.str) return false;
        items.push({ span, text: item.str, hasEOL: Boolean(item.hasEOL), nodes });
      }
      if (!pdfSourceBindingIsCurrent(textLayer, items)) return false;
      pdfTextLayerSourceItems.set(textLayer, items);
      return true;
    } catch (_) { return false; }
  }

  function createBoundRawOffsetProjection(textLayer) {
    const empty = () => ({ text: '', starts: [], ends: [], mode: 'raw-offset' });
    const items = pdfTextLayerSourceItems.get(textLayer);
    try {
      if (!items || !pdfSourceBindingIsCurrent(textLayer, items)) {
        pdfTextLayerSourceItems.set(textLayer, null);
        return empty();
      }
      const text = [], starts = [], ends = [];
      let previousHasEOL = false;
      for (const item of items) {
        // Reuse whole-item NFKC/control/whitespace handling and its atomic raw
        // offsets, including a grapheme split across multiple real Text nodes.
        const part = createRawOffsetProjection([{ node: item.span, text: item.text }]);
        if (!part.text) continue;
        const point = (offset, isStart) => {
          let position = 0;
          for (const entry of item.nodes) {
            const next = position + entry.text.length;
            if (entry.text.length && (isStart ? offset < next : offset <= next)) {
              return { node: entry.node, offset: offset - position };
            }
            position = next;
          }
          throw Error('PDF_SOURCE_POINT_UNMAPPED');
        };
        if (text.length) {
          const boundary = point(part.starts[0].offset, true);
          text.push(previousHasEOL ? '\n' : ' ');
          starts.push(boundary); ends.push(boundary);
        }
        for (let index = 0; index < part.text.length; index += 1) {
          text.push(part.text[index]);
          starts.push(point(part.starts[index].offset, true));
          ends.push(point(part.ends[index].offset, false));
        }
        previousHasEOL = item.hasEOL;
      }
      return { text: text.join(''), starts, ends, mode: 'raw-offset' };
    } catch (_) {
      pdfTextLayerSourceItems.set(textLayer, null);
      return empty();
    }
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

  function pdfProjectionSelectionOffsets(projection, range) {
    const validBoundary = (node, offset) => Number.isSafeInteger(offset) && offset >= 0 &&
      (node?.nodeType === 3 ? offset <= String(node.textContent || '').length :
        node?.nodeType === 1 && offset <= Number(node.childNodes?.length));
    if (!projection || typeof projection.text !== 'string' || !projection.text ||
        !Array.isArray(projection.starts) || !Array.isArray(projection.ends) ||
        projection.starts.length !== projection.text.length || projection.ends.length !== projection.text.length ||
        !range?.startContainer || !range?.endContainer || typeof range.comparePoint !== 'function' ||
        !validBoundary(range.startContainer, range.startOffset) ||
        !validBoundary(range.endContainer, range.endOffset) || range.collapsed === true) return null;
    // Chromium can leave a native endpoint at (TextLayer, childIndex), including
    // beside BRs and marked-content wrappers. That is a real DOM boundary, not
    // a request for the beginning/end of the whole page. Compare each original
    // projected source point with the existing Range; never modify Selection.
    const compare = point => {
      if (!validBoundary(point?.node, point?.offset)) throw Error('UNMAPPED_PDF_SOURCE');
      const result = range.comparePoint(point.node, point.offset);
      if (![-1, 0, 1].includes(result)) throw Error('UNMAPPED_PDF_BOUNDARY');
      return result;
    };
    try {
      let startOffset = -1, endOffset = -1;
      for (let index = 0; index < projection.ends.length; index++) {
        const point = projection.ends[index];
        const afterStart = point?.node === range.startContainer
          ? point.offset > range.startOffset : compare(point) >= 0;
        if (afterStart) { startOffset = index; break; }
      }
      for (let index = projection.starts.length - 1; index >= 0; index--) {
        const point = projection.starts[index];
        const beforeEnd = point?.node === range.endContainer
          ? point.offset < range.endOffset : compare(point) <= 0;
        if (beforeEnd) { endOffset = index + 1; break; }
      }
      // A virtual item separator has no selected source glyph. Do not attach
      // leading/trailing separator spaces to an otherwise exact text interval.
      while (startOffset >= 0 && startOffset < endOffset && /\s/u.test(projection.text[startOffset])) startOffset++;
      while (endOffset > startOffset && /\s/u.test(projection.text[endOffset - 1])) endOffset--;
      if (startOffset < 0 || endOffset <= startOffset) return null;
      return { startOffset, endOffset, quote: projection.text.slice(startOffset, endOffset) };
    } catch (_) {
      // A detached/unmapped endpoint must not expand into an entire page quote.
      return null;
    }
  }

  function pinPdfSelectionTextEndpoints(selection, resolveLayer) {
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1 ||
        typeof selection.getRangeAt !== 'function' || typeof selection.setBaseAndExtent !== 'function' ||
        typeof resolveLayer !== 'function') return false;
    try {
      const range = selection.getRangeAt(0);
      if (range.startContainer?.nodeType === 3 && range.endContainer?.nodeType === 3) return false;
      const startLayer = resolveLayer(range.startContainer), endLayer = resolveLayer(range.endContainer);
      if (!startLayer || !endLayer) return false;
      const projections = new Map();
      const mappedEndpoint = (layer, start) => {
        let projection = projections.get(layer);
        if (!projection) { projection = readPdfTextProjection(layer, { mode: 'raw-offset' }); projections.set(layer, projection); }
        const offsets = pdfProjectionSelectionOffsets(projection, range);
        return offsets && (start ? projection.starts[offsets.startOffset] : projection.ends[offsets.endOffset - 1]);
      };
      const from = range.startContainer.nodeType === 3 ? { node: range.startContainer, offset: range.startOffset } : mappedEndpoint(startLayer, true);
      const to = range.endContainer.nodeType === 3 ? { node: range.endContainer, offset: range.endOffset } : mappedEndpoint(endLayer, false);
      if (from?.node?.nodeType !== 3 || to?.node?.nodeType !== 3) return false;
      // Moving the empty endOfContent node makes Chromium change a caret on
      // that node into a layer childOffset. Pin it to the same selected source
      // Text first, so reset cannot change the visible quote or its direction.
      const backward = selection.direction === 'backward' ||
        (selection.direction !== 'forward' && selection.anchorNode === range.endContainer &&
          selection.anchorOffset === range.endOffset &&
          (range.startContainer !== range.endContainer || range.startOffset !== range.endOffset));
      selection.setBaseAndExtent(backward ? to.node : from.node, backward ? to.offset : from.offset,
        backward ? from.node : to.node, backward ? from.offset : to.offset);
      return true;
    } catch (_) {
      // Virtualized/detached pages or unmapped source points stay unchanged.
      return false;
    }
  }

  function readPdfTextProjection(textLayer, options = {}) {
    const mode = options?.mode === 'raw-offset' ? 'raw-offset' : 'selection';
    if (mode === 'raw-offset' && pdfTextLayerSourceItems.has(textLayer)) {
      return createBoundRawOffsetProjection(textLayer);
    }
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

  // This geometry is cached once after mounting a text layer. Live visual
  // feedback uses the browser's one Range.getClientRects() result, never a
  // per-character range walk, and never changes the selected source nodes.
  function buildPdfSelectionVisualRows(rectangles = []) {
    const rows = [];
    const source = rectangles.map(value => {
      const rect = normalizedRect(value);
      return rect ? { ...rect, sourceLineId: value.sourceLineId } : null;
    }).filter(rect => rect &&
      rect.bottom - rect.top <= (rect.right - rect.left) * 2 &&
      rect.right - rect.left >= 0.5).sort(verticalOrder);
    for (const rect of source) {
      const height = rect.bottom - rect.top;
      const row = rows.find(candidate => {
        if (candidate.sourceLineId !== undefined && rect.sourceLineId !== undefined &&
            candidate.sourceLineId !== rect.sourceLineId) return false;
        const overlap = Math.min(candidate.bottom, rect.bottom) - Math.max(candidate.top, rect.top);
        const gap = Math.max(rect.left - candidate.right, candidate.left - rect.right, 0);
        return overlap >= Math.min(candidate.bottom - candidate.top, height) * 0.4 &&
          gap <= Math.max(24, height * 2.8);
      });
      if (row) {
        row.left = Math.min(row.left, rect.left); row.right = Math.max(row.right, rect.right);
        row.top = Math.min(row.top, rect.top); row.bottom = Math.max(row.bottom, rect.bottom);
      } else rows.push({ ...rect });
    }
    rows.sort(verticalOrder);
    return rows.map((row, lineId) => {
      const height = row.bottom - row.top, center = (row.top + row.bottom) / 2;
      let clipTop = row.top - height * 0.25, clipBottom = row.bottom + height * 0.25;
      for (const other of rows) {
        if (other === row) continue;
        const horizontalOverlap = Math.min(row.right, other.right) - Math.max(row.left, other.left);
        if (horizontalOverlap < Math.min(row.right - row.left, other.right - other.left) * 0.3) continue;
        const otherCenter = (other.top + other.bottom) / 2;
        if (Math.abs(otherCenter - center) > height * 3 || Math.abs(otherCenter - center) < height * 0.5) continue;
        const middle = (center + otherCenter) / 2;
        if (otherCenter < center) clipTop = Math.max(clipTop, middle);
        else clipBottom = Math.min(clipBottom, middle);
      }
      return { ...row, lineId, clipTop, clipBottom };
    });
  }

  function pdfSelectionVisualRects(rectangles = [], rows = []) {
    const matched = [];
    for (const value of rectangles) {
      const rect = normalizedRect(value);
      if (!rect) continue;
      const center = (rect.top + rect.bottom) / 2;
      const candidates = rows.filter(row => {
        const height = row.bottom - row.top;
        return Math.abs(center - (row.top + row.bottom) / 2) <= height * 0.7 &&
          rect.bottom - rect.top <= height * 2.5 &&
          rect.right - rect.left <= row.right - row.left + Math.max(24, height * 2.8) &&
          Math.min(rect.right, row.right) - Math.max(rect.left, row.left) > 0;
      }).sort((left, right) => Math.abs(center - (left.top + left.bottom) / 2) -
        Math.abs(center - (right.top + right.bottom) / 2));
      const row = candidates[0];
      if (!row) continue;
      const clipped = normalizedRect({ left: Math.max(rect.left, row.left), right: Math.min(rect.right, row.right),
        top: Math.max(rect.top, row.clipTop), bottom: Math.min(rect.bottom, row.clipBottom) });
      if (clipped) matched.push({ ...clipped, lineId: row.lineId });
    }
    matched.sort((left, right) => left.lineId - right.lineId || left.left - right.left);
    const result = [];
    for (const rect of matched) {
      const previous = result.at(-1), row = rows[rect.lineId];
      if (previous && previous.lineId === rect.lineId &&
          rect.left - previous.right <= Math.max(24, (row.bottom - row.top) * 2.8)) {
        previous.right = Math.max(previous.right, rect.right);
        previous.top = Math.min(previous.top, rect.top); previous.bottom = Math.max(previous.bottom, rect.bottom);
      } else result.push({ ...rect });
    }
    return result;
  }

  function pdfProjectionRects(range, pageRect) {
    const seen = new Set();
    const startElement = range.startContainer?.nodeType === 1
      ? range.startContainer : range.startContainer?.parentElement;
    const textLayer = startElement?.closest?.('.pdf-native-text-layer');
    const rects = readPdfRangeRects(range, textLayer) || [...range.getClientRects()];
    return rects.flatMap(rect => {
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
    createPdfTextSelectionController,
    classifyPdfPageFurnitureSegments,
    createPdfTextProjection,
    bindPdfTextLayerSourceItems,
    pdfProjectionSelectionOffsets,
    pinPdfSelectionTextEndpoints,
    markPdfTextLayerFurniture,
    orderPdfTextContentForReading,
    mergePdfSelectionRects,
    readPdfRangeRects,
    mergePdfRectsWithTextLayer,
    repairPdfSelectionLineEnd,
    orderPdfTextSegmentsByGeometry,
    reorderPdfTextLayerForReadingOrder,
    pdfProjectionRange,
    readPdfTextProjection,
    pdfProjectionRects,
    buildPdfSelectionVisualRows, pdfSelectionVisualRects
  };
});
