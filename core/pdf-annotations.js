(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const geometry = typeof module === 'object' && module.exports
    ? require('./pdf-text-projection.js') : null;
  const pdfGeometry = () => geometry || globalThis.SciLLM;
  const MAX_PDF_ANCHOR_QUADS = 64;
  const MAX_PDF_COORDINATE = 20000;
  const MAX_PDF_QUOTE_LENGTH = 12000;
  const MAX_PDF_CONTEXT_LENGTH = 240;
  const MAX_PDF_NOTE_LENGTH = 4000;

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function finiteCoordinate(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || Math.abs(number) > MAX_PDF_COORDINATE) {
      fail('INVALID_PDF_QUAD');
    }
    return Object.is(number, -0) ? 0 : number;
  }

  function normalizePdfQuad(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_PDF_QUAD');
    const quad = {};
    for (const key of ['x1', 'y1', 'x2', 'y2', 'x3', 'y3', 'x4', 'y4']) {
      quad[key] = finiteCoordinate(input[key]);
    }
    const width = Math.max(quad.x1, quad.x2, quad.x3, quad.x4) -
      Math.min(quad.x1, quad.x2, quad.x3, quad.x4);
    const height = Math.max(quad.y1, quad.y2, quad.y3, quad.y4) -
      Math.min(quad.y1, quad.y2, quad.y3, quad.y4);
    if (width <= 0 || height <= 0) fail('INVALID_PDF_QUAD');
    return quad;
  }

  function normalizeDocumentHash(value) {
    const hash = String(value || '').trim().toLowerCase();
    if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(hash)) fail('INVALID_PDF_DOCUMENT_HASH');
    return hash;
  }

  function comparableDocumentHash(value) {
    return normalizeDocumentHash(value).replace(/^sha256:/, '');
  }

  function normalizePdfAnchor(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_PDF_ANCHOR');
    if (input.schemaVersion !== undefined && Number(input.schemaVersion) !== 1) {
      fail('UNSUPPORTED_PDF_ANCHOR_SCHEMA');
    }
    if (input.anchorKind !== undefined && input.anchorKind !== 'pdf_quad') {
      fail('INVALID_PDF_ANCHOR_KIND');
    }
    const pageNumber = Number(input.pageNumber);
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 100000) {
      fail('INVALID_PDF_PAGE');
    }
    const legacyQuads = Array.isArray(input.quads) ? input.quads : null;
    let quadPoints = Array.isArray(input.quadPoints) ? input.quadPoints : null;
    if (quadPoints && input.anchorKind !== 'pdf_quad') fail('INVALID_PDF_ANCHOR_KIND');
    if (!quadPoints && legacyQuads) {
      quadPoints = legacyQuads.flatMap(item => {
        const normalized = normalizePdfQuad(item);
        return ['x1', 'y1', 'x2', 'y2', 'x3', 'y3', 'x4', 'y4']
          .map(key => normalized[key]);
      });
    }
    if (!Array.isArray(quadPoints) || quadPoints.length < 8 || quadPoints.length % 8 !== 0) {
      fail('INVALID_PDF_QUADS');
    }
    if (quadPoints.length > MAX_PDF_ANCHOR_QUADS * 8) fail('PDF_ANCHOR_QUAD_LIMIT');
    const normalizedPoints = [];
    for (let index = 0; index < quadPoints.length; index += 8) {
      const normalized = normalizePdfQuad({
        x1: quadPoints[index], y1: quadPoints[index + 1],
        x2: quadPoints[index + 2], y2: quadPoints[index + 3],
        x3: quadPoints[index + 4], y3: quadPoints[index + 5],
        x4: quadPoints[index + 6], y4: quadPoints[index + 7]
      });
      normalizedPoints.push(normalized.x1, normalized.y1, normalized.x2, normalized.y2,
        normalized.x3, normalized.y3, normalized.x4, normalized.y4);
    }
    const text = (key, limit) => {
      const value = String(input[key] || '');
      if (value.length > limit) fail('INVALID_PDF_ANCHOR_TEXT');
      return value;
    };
    const quote = text('quote', MAX_PDF_QUOTE_LENGTH);
    if (!quote.trim()) fail('INVALID_PDF_ANCHOR_QUOTE');
    const contextHash = String(input.contextHash || '').trim();
    if (!contextHash || contextHash.length > 300) fail('INVALID_PDF_CONTEXT_HASH');
    return {
      schemaVersion: 1,
      anchorKind: 'pdf_quad',
      pageNumber,
      documentHash: normalizeDocumentHash(input.documentHash),
      contextHash,
      quote,
      prefix: text('prefix', MAX_PDF_CONTEXT_LENGTH),
      suffix: text('suffix', MAX_PDF_CONTEXT_LENGTH),
      quadPoints: normalizedPoints
    };
  }

  function validViewport(viewport, method) {
    if (!viewport || typeof viewport[method] !== 'function' ||
        !Number.isFinite(Number(viewport.width)) || !Number.isFinite(Number(viewport.height)) ||
        Number(viewport.width) <= 0 || Number(viewport.height) <= 0) {
      fail('INVALID_PDF_VIEWPORT');
    }
    return viewport;
  }

  function clientRectToPdfQuad(rect, { pageRect, viewport } = {}) {
    validViewport(viewport, 'convertToPdfPoint');
    if (!rect || !pageRect) fail('INVALID_CLIENT_RECT');
    const left = Number(rect.left) - Number(pageRect.left);
    const top = Number(rect.top) - Number(pageRect.top);
    const right = Number(rect.right) - Number(pageRect.left);
    const bottom = Number(rect.bottom) - Number(pageRect.top);
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
      fail('INVALID_CLIENT_RECT');
    }
    const tolerance = 0.5;
    if (left < -tolerance || top < -tolerance || right > Number(viewport.width) + tolerance ||
        bottom > Number(viewport.height) + tolerance) fail('PDF_QUAD_OUT_OF_BOUNDS');
    const [x1, y1] = viewport.convertToPdfPoint(Math.max(0, left), Math.max(0, top));
    const [x2, y2] = viewport.convertToPdfPoint(
      Math.min(Number(viewport.width), right), Math.max(0, top));
    const [x3, y3] = viewport.convertToPdfPoint(
      Math.max(0, left), Math.min(Number(viewport.height), bottom));
    const [x4, y4] = viewport.convertToPdfPoint(
      Math.min(Number(viewport.width), right), Math.min(Number(viewport.height), bottom));
    return normalizePdfQuad({ x1, y1, x2, y2, x3, y3, x4, y4 });
  }

  function projectPdfQuad(input, viewport) {
    validViewport(viewport, 'convertToViewportPoint');
    const quad = normalizePdfQuad(input);
    const points = [
      viewport.convertToViewportPoint(quad.x1, quad.y1),
      viewport.convertToViewportPoint(quad.x2, quad.y2),
      viewport.convertToViewportPoint(quad.x3, quad.y3),
      viewport.convertToViewportPoint(quad.x4, quad.y4)
    ];
    const xs = points.map(point => finiteCoordinate(point[0]));
    const ys = points.map(point => finiteCoordinate(point[1]));
    return {
      left: Math.min(...xs), top: Math.min(...ys),
      right: Math.max(...xs), bottom: Math.max(...ys)
    };
  }

  function createPdfSelectionAnchor(input = {}) {
    const clientRects = Array.isArray(input.clientRects) ? input.clientRects : [];
    if (!clientRects.length) fail('INVALID_CLIENT_RECTS');
    if (clientRects.length > MAX_PDF_ANCHOR_QUADS) fail('PDF_ANCHOR_QUAD_LIMIT');
    const quads = clientRects.map(rect =>
      clientRectToPdfQuad(rect, { pageRect: input.pageRect, viewport: input.viewport }));
    return normalizePdfAnchor({
      schemaVersion: 1,
      anchorKind: 'pdf_quad',
      pageNumber: input.pageNumber,
      documentHash: input.documentHash,
      contextHash: input.contextHash,
      quote: input.quote,
      prefix: input.prefix,
      suffix: input.suffix,
      quadPoints: quads.flatMap(item => [
        item.x1, item.y1, item.x2, item.y2, item.x3, item.y3, item.x4, item.y4
      ])
    });
  }

  function pdfAnchorMatchesDocument(input, documentHash) {
    try {
      const anchor = normalizePdfAnchor(input);
      return comparableDocumentHash(anchor.documentHash) === comparableDocumentHash(documentHash);
    } catch (_) {
      return false;
    }
  }

  function pdfRequestMatchesDocument({
    currentDocumentHash, currentGeneration, requestDocumentHash, requestGeneration
  } = {}) {
    try {
      const generation = Number(currentGeneration);
      return Number.isSafeInteger(generation) && generation > 0 &&
        Number(requestGeneration) === generation &&
        comparableDocumentHash(currentDocumentHash) === comparableDocumentHash(requestDocumentHash);
    } catch (_) {
      return false;
    }
  }

  function pdfSelectionMutationReady({
    pdfDocumentGeneration, pdfAnchor, documentHash
  } = {}) {
    const generation = Number(pdfDocumentGeneration);
    if (!Number.isSafeInteger(generation) || generation <= 0) return !pdfAnchor;
    return Boolean(pdfAnchor) && pdfAnchorMatchesDocument(pdfAnchor, documentHash);
  }

  function requestPdfSelectionAnchor({ detail, dispatch } = {}) {
    if (!detail || typeof dispatch !== 'function') return null;
    try {
      if (dispatch(detail) === false || !detail.pdfAnchor) return null;
      return normalizePdfAnchor(detail.pdfAnchor);
    } catch (_) {
      return null;
    }
  }

  function normalizePdfAnnotationPublication(annotation) {
    if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation)) {
      fail('INVALID_PDF_ANNOTATION_PUBLICATION');
    }
    const annotationId = String(annotation.annotationId || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(annotationId)) {
      fail('INVALID_PDF_ANNOTATION_ID');
    }
    const deletedAt = String(annotation.deletedAt || '').trim();
    const deleted = annotation.deleted === true || Boolean(deletedAt);
    if (deletedAt && (deletedAt.length > 100 || !Number.isFinite(Date.parse(deletedAt)))) {
      fail('INVALID_PDF_ANNOTATION_DELETED_AT');
    }
    const name = String(annotation.categorySnapshot?.name || 'PDF').trim().slice(0, 200);
    const color = String(annotation.categorySnapshot?.color || '#F2D978').trim().toUpperCase();
    if (!name || !/^#[A-F0-9]{6}$/.test(color)) fail('INVALID_PDF_ANNOTATION_CATEGORY');
    const note = String(annotation.note ?? annotation.comment ?? '').slice(0, MAX_PDF_NOTE_LENGTH);
    const suppliedOpacity = annotation.opacity === undefined ? 0.35 : Number(annotation.opacity);
    if (!Number.isFinite(suppliedOpacity)) fail('INVALID_PDF_ANNOTATION_OPACITY');
    const opacity = Math.min(1, Math.max(0, suppliedOpacity));
    let pdfAnchor;
    if (annotation.pdfAnchor !== undefined && annotation.pdfAnchor !== null) {
      pdfAnchor = normalizePdfAnchor(annotation.pdfAnchor);
    } else if (!deleted) {
      fail('INVALID_PDF_ANNOTATION_ANCHOR');
    }
    return {
      annotationId,
      categorySnapshot: { name, color },
      ...(pdfAnchor ? { pdfAnchor } : {}),
      note,
      opacity,
      ...(annotation.deleted === true ? { deleted: true } : {}),
      ...(deletedAt ? { deletedAt } : {})
    };
  }

  function preparePdfAnnotationPublication(records) {
    const prepared = [];
    for (const annotation of Array.isArray(records) ? records : []) {
      try { prepared.push(normalizePdfAnnotationPublication(annotation)); } catch (_) {}
    }
    return prepared;
  }

  function reconcilePdfAnnotationUpdate({
    currentDocumentHash, currentGeneration, eventDocumentHash, eventGeneration, annotations
  } = {}) {
    const source = Array.isArray(annotations) ? annotations : [];
    if (!pdfRequestMatchesDocument({
      currentDocumentHash, currentGeneration,
      requestDocumentHash: eventDocumentHash, requestGeneration: eventGeneration
    })) return { accepted: false, annotations: [], skipped: source.length };
    const accepted = [];
    let skipped = 0;
    for (const annotation of source) {
      try {
        const normalized = normalizePdfAnnotationPublication(annotation);
        if (normalized.pdfAnchor &&
            !pdfAnchorMatchesDocument(normalized.pdfAnchor, currentDocumentHash)) {
          skipped += 1;
          continue;
        }
        accepted.push(normalized);
      } catch (_) {
        skipped += 1;
      }
    }
    return { accepted: true, annotations: accepted, skipped };
  }

  function readPdfTextLayerRange(range, resolveLayer) {
    const ranges = readPdfTextLayerRanges(range, resolveLayer);
    if (!ranges.length || !ranges.every(item =>
      item.layer === ranges[0].layer && item.pageNumber === ranges[0].pageNumber)) return null;
    return ranges.length === 1 ? ranges[0] : null;
  }

  function readPdfTextLayerRanges(range, resolveLayer) {
    if (!range || typeof resolveLayer !== 'function' || typeof range.getClientRects !== 'function') {
      return [];
    }
    const startLayer = resolveLayer(range.startContainer);
    const endLayer = resolveLayer(range.endContainer);
    if (!startLayer || !endLayer) return [];
    const startPage = Number(startLayer.dataset?.pdfPageNumber);
    const endPage = Number(endLayer.dataset?.pdfPageNumber);
    if (![startPage, endPage].every(pageNumber =>
      Number.isSafeInteger(pageNumber) && pageNumber > 0)) return [];

    let layers;
    if (startLayer === endLayer) {
      layers = [startLayer];
    } else {
      const ownerDocument = startLayer.ownerDocument || endLayer.ownerDocument;
      if (!ownerDocument?.querySelectorAll || typeof range.cloneRange !== 'function') return [];
      const minimumPage = Math.min(startPage, endPage);
      const maximumPage = Math.max(startPage, endPage);
      layers = Array.from(ownerDocument.querySelectorAll('.pdf-native-text-layer'))
        .filter(layer => {
          const pageNumber = Number(layer?.dataset?.pdfPageNumber);
          if (!Number.isSafeInteger(pageNumber) || pageNumber < minimumPage ||
              pageNumber > maximumPage) return false;
          try { return range.intersectsNode(layer); } catch (_) { return false; }
        })
        .sort((left, right) =>
          Number(left.dataset?.pdfPageNumber) - Number(right.dataset?.pdfPageNumber));
      if (layers[0] !== startLayer || layers.at(-1) !== endLayer) return [];
    }

    const pageLocalRects = (selectedRange, layer, layerRect) => {
      if (!layerRect ||
          ![layerRect.left, layerRect.top, layerRect.right, layerRect.bottom].every(Number.isFinite) ||
          layerRect.right <= layerRect.left || layerRect.bottom <= layerRect.top) return [];
      const furnitureRects = typeof layer?.querySelectorAll === 'function'
        ? Array.from(layer.querySelectorAll('[data-pdf-page-furniture]'), node =>
          node.getBoundingClientRect?.()).filter(rect => rect &&
          [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) &&
          rect.right > rect.left && rect.bottom > rect.top)
        : [];
      const seen = new Set();
      const leafRects = pdfGeometry()?.readPdfRangeRects?.(selectedRange, layer);
      return Array.from(leafRects || selectedRange.getClientRects()).flatMap(rect => {
        const item = { left: Number(rect.left), top: Number(rect.top),
          right: Number(rect.right), bottom: Number(rect.bottom) };
        if (!Object.values(item).every(Number.isFinite) ||
            item.right <= item.left || item.bottom <= item.top ||
            furnitureRects.some(furniture => item.right > furniture.left &&
              item.left < furniture.right && item.bottom > furniture.top &&
              item.top < furniture.bottom)) return [];
        // PDF.js glyph boxes can extend outside the clipped text layer. Keep
        // only their visible page-local portion; the PDF quad validator stays strict.
        const clipped = {
          left: Math.max(item.left, layerRect.left), top: Math.max(item.top, layerRect.top),
          right: Math.min(item.right, layerRect.right), bottom: Math.min(item.bottom, layerRect.bottom)
        };
        if (clipped.right <= clipped.left || clipped.bottom <= clipped.top) return [];
        const key = [clipped.left, clipped.top, clipped.right, clipped.bottom].join(':');
        if (seen.has(key)) return [];
        seen.add(key);
        return [clipped];
      });
    };

    const selectedTextNodes = (selectedRange, layer) => {
      const ownerDocument = layer.ownerDocument;
      if (!ownerDocument?.createTreeWalker || typeof selectedRange.intersectsNode !== 'function') {
        return [];
      }
      const walker = ownerDocument.createTreeWalker(
        layer, ownerDocument.defaultView?.NodeFilter?.SHOW_TEXT || 4
      );
      const nodes = [];
      let node;
      while ((node = walker.nextNode())) {
        try {
          if (String(node.textContent || '').length &&
              !node.parentElement?.dataset?.pdfPageFurniture &&
              selectedRange.intersectsNode(node)) {
            nodes.push(node);
          }
        } catch (_) { /* Detached PDF.js nodes are ignored. */ }
      }
      return nodes;
    };

    const trimImplicitPageFurniture = (
      selectedRange, layer, layerRect, { trimStart = false, trimEnd = false } = {}
    ) => {
      const layerHeight = Number(layerRect?.height) ||
        Number(layerRect?.bottom) - Number(layerRect?.top);
      if ((!trimStart && !trimEnd) || !(layerHeight > 0) ||
          typeof selectedRange.cloneRange !== 'function') return selectedRange;
      const nodes = selectedTextNodes(selectedRange, layer);
      const entries = nodes.map(node => {
        const rect = node.parentElement?.getBoundingClientRect?.();
        return rect && [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) &&
          rect.right > rect.left && rect.bottom > rect.top ? { node, rect } : null;
      }).filter(Boolean);
      if (entries.length < 2 || entries.length !== nodes.length) return selectedRange;
      const heights = entries.map(item => item.rect.bottom - item.rect.top)
        .sort((left, right) => left - right);
      const medianHeight = heights[Math.floor(heights.length / 2)] || 0;
      const minimumGap = Math.max(12, medianHeight * 2);
      let first = 0;
      let last = entries.length - 1;
      const markedStartBoundary = trimStart &&
        selectedRange.startContainer !== entries[0].node;
      const markedEndBoundary = trimEnd &&
        selectedRange.endContainer !== entries.at(-1).node;
      if (trimStart) {
        let best = null;
        for (let index = 0; index < last; index += 1) {
          const current = entries[index].rect;
          const next = entries[index + 1].rect;
          const gap = next.top - current.bottom;
          const edgeRatio = (current.bottom - layerRect.top) / layerHeight;
          if (edgeRatio <= 0.2 && gap >= minimumGap && (!best || gap > best.gap)) {
            best = { index, gap };
          }
        }
        if (best) first = best.index + 1;
      }
      if (trimEnd) {
        let best = null;
        for (let index = first; index < last; index += 1) {
          const current = entries[index].rect;
          const next = entries[index + 1].rect;
          const gap = next.top - current.bottom;
          const edgeRatio = (next.top - layerRect.top) / layerHeight;
          if (edgeRatio >= 0.82 && gap >= minimumGap && (!best || gap > best.gap)) {
            best = { index, gap };
          }
        }
        if (best) last = best.index;
      }
      if (first === 0 && last === entries.length - 1 &&
          !markedStartBoundary && !markedEndBoundary) return selectedRange;
      if (first > last) return selectedRange;
      try {
        const trimmed = selectedRange.cloneRange();
        const firstNode = entries[first].node;
        const lastNode = entries[last].node;
        if (firstNode !== selectedRange.startContainer) trimmed.setStart(firstNode, 0);
        if (lastNode !== selectedRange.endContainer) {
          trimmed.setEnd(lastNode, String(lastNode.textContent || '').length);
        }
        return trimmed;
      } catch (_) {
        return selectedRange;
      }
    };

    const splitOversizedRange = (selectedRange, layer, layerRect) => {
      const rects = pageLocalRects(selectedRange, layer, layerRect);
      if (rects.length <= MAX_PDF_ANCHOR_QUADS) {
        return [{ range: selectedRange, clientRects: rects, truncated: false }];
      }
      const ownerDocument = layer.ownerDocument;
      if (!ownerDocument?.createTreeWalker || typeof selectedRange.intersectsNode !== 'function') {
        return [];
      }
      const nodes = selectedTextNodes(selectedRange, layer);
      if (!nodes.length) return [];
      const boundary = (candidate, edge) => {
        if (edge === 'start' && candidate === selectedRange.startContainer) {
          return selectedRange.startOffset;
        }
        if (edge === 'end' && candidate === selectedRange.endContainer) {
          return selectedRange.endOffset;
        }
        return edge === 'start' ? 0 : String(candidate.textContent || '').length;
      };
      const makeRange = (first, last) => {
        const candidate = selectedRange.cloneRange();
        candidate.setStart(first, boundary(first, 'start'));
        candidate.setEnd(last, boundary(last, 'end'));
        return candidate;
      };
      const chunks = [];
      let firstIndex = 0;
      for (let index = 0; index < nodes.length; index += 1) {
        const candidate = makeRange(nodes[firstIndex], nodes[index]);
        const candidateRects = pageLocalRects(candidate, layer, layerRect);
        if (candidateRects.length <= MAX_PDF_ANCHOR_QUADS) continue;
        if (index === firstIndex) return [];
        const completeRange = makeRange(nodes[firstIndex], nodes[index - 1]);
        const completeRects = pageLocalRects(completeRange, layer, layerRect);
        chunks.push({ range: completeRange, clientRects: completeRects, truncated: false });
        firstIndex = index;
      }
      const finalRange = makeRange(nodes[firstIndex], nodes.at(-1));
      chunks.push({
        range: finalRange,
        clientRects: pageLocalRects(finalRange, layer, layerRect),
        truncated: false
      });
      return chunks;
    };

    const results = [];
    for (const layer of layers) {
      const pageNumber = Number(layer.dataset?.pdfPageNumber);
      let segmentRange = range;
      if (layers.length > 1) {
        try {
          segmentRange = range.cloneRange();
          if (layer !== startLayer) segmentRange.setStart(layer, 0);
          if (layer !== endLayer) {
            segmentRange.setEnd(layer, Number(layer.childNodes?.length) || 0);
          }
        } catch (_) {
          return [];
        }
      }
      const layerRect = typeof layer.getBoundingClientRect === 'function'
        ? layer.getBoundingClientRect() : null;
      segmentRange = trimImplicitPageFurniture(segmentRange, layer, layerRect, {
        trimStart: layer !== startLayer,
        trimEnd: layer !== endLayer
      });
      const chunks = splitOversizedRange(segmentRange, layer, layerRect);
      if (!chunks.length) return [];
      for (const chunk of chunks) {
        if (!chunk.clientRects.length) continue;
        results.push({ pageNumber, layer, ...chunk });
      }
    }
    return results.length && results[0].pageNumber === startPage &&
      results.at(-1).pageNumber === endPage ? results : [];
  }

  function pickPdfAnnotationHit(elements, pageNumber) {
    return (Array.isArray(elements) ? elements : []).find(element =>
      element?.matches?.('.pdf-native-annotation-hit') &&
      Number(element.closest?.('.pdf-native-page')?.dataset?.pdfPageNumber) ===
        Number(pageNumber)
    ) || null;
  }

  function syncPdfAnnotationOverlay({
    layer, annotations = [], pageNumber, viewport, documentHash, onActivate, textLayer
  } = {}) {
    if (!layer?.ownerDocument?.createElement || typeof layer.replaceChildren !== 'function') {
      fail('INVALID_PDF_ANNOTATION_LAYER');
    }
    layer.replaceChildren();
    let rendered = 0;
    let skipped = 0;
    for (const annotation of Array.isArray(annotations) ? annotations : []) {
      if (annotation?.deleted === true || annotation?.deletedAt) {
        skipped += 1;
        continue;
      }
      const pdfAnchor = annotation?.pdfAnchor;
      if (!pdfAnchorMatchesDocument(pdfAnchor, documentHash) ||
          Number(pdfAnchor?.pageNumber) !== Number(pageNumber)) {
        skipped += 1;
        continue;
      }
      const normalized = normalizePdfAnchor(pdfAnchor);
      const projected = [];
      for (let offset = 0; offset < normalized.quadPoints.length; offset += 8) {
        const item = {
          x1: normalized.quadPoints[offset], y1: normalized.quadPoints[offset + 1],
          x2: normalized.quadPoints[offset + 2], y2: normalized.quadPoints[offset + 3],
          x3: normalized.quadPoints[offset + 4], y3: normalized.quadPoints[offset + 5],
          x4: normalized.quadPoints[offset + 6], y4: normalized.quadPoints[offset + 7]
        };
        projected.push(projectPdfQuad(item, viewport));
      }
      const rects = pdfGeometry()?.mergePdfRectsWithTextLayer?.(
        projected, textLayer, textLayer?.getBoundingClientRect?.()
      ) || projected;
      for (const [quadIndex, rect] of rects.entries()) {
        const hit = layer.ownerDocument.createElement('button');
        hit.type = 'button';
        hit.className = 'pdf-native-annotation-hit';
        hit.dataset.annotationId = String(annotation.annotationId || '');
        hit.dataset.pdfQuadIndex = String(quadIndex);
        hit.dataset.categoryColor = String(annotation.categorySnapshot?.color || '#F2D978');
        hit.style.left = `${rect.left}px`;
        hit.style.top = `${rect.top}px`;
        hit.style.width = `${rect.right - rect.left}px`;
        hit.style.height = `${rect.bottom - rect.top}px`;
        hit.style.setProperty?.('--pdf-annotation-color',
          String(annotation.categorySnapshot?.color || '#F2D978'));
        const t = value => globalThis.SciLLM?.translateInterfaceText?.(value) || value;
        hit.setAttribute('data-i18n-ignore', '');
        hit.title = String(annotation.note || annotation.categorySnapshot?.name || t('PDF 高亮'));
        hit.setAttribute('aria-label',
          t(`${annotation.categorySnapshot?.name || 'PDF'}高亮：${normalized.quote.slice(0, 100)}`));
        hit.addEventListener('click', event => {
          event.preventDefault?.();
          event.stopPropagation?.();
          onActivate?.({
            annotationId: String(annotation.annotationId || ''),
            documentHash: normalized.documentHash
          }, hit);
        });
        layer.appendChild(hit);
        rendered += 1;
      }
    }
    return { rendered, skipped };
  }

  return {
    MAX_PDF_ANCHOR_QUADS,
    MAX_PDF_QUOTE_LENGTH,
    MAX_PDF_CONTEXT_LENGTH,
    MAX_PDF_NOTE_LENGTH,
    normalizePdfQuad,
    normalizePdfAnchor,
    clientRectToPdfQuad,
    projectPdfQuad,
    createPdfSelectionAnchor,
    pdfAnchorMatchesDocument,
    pdfRequestMatchesDocument,
    pdfSelectionMutationReady,
    requestPdfSelectionAnchor,
    normalizePdfAnnotationPublication,
    preparePdfAnnotationPublication,
    reconcilePdfAnnotationUpdate,
    readPdfTextLayerRange,
    readPdfTextLayerRanges,
    pickPdfAnnotationHit,
    syncPdfAnnotationOverlay
  };
});
