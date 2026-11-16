(function attach(root, factory) {
  const dependency = typeof module === 'object' && module.exports
    ? require('./pdf-text-projection.js') : root.SciLLM;
  const api = factory(dependency);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(dependency = {}) {
  const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
  const SUPPORTED_ROTATIONS = new Set([0, 90, 180, 270]);
  const READING_ORDER_CONTRACT = 'pdf-reading-order-v1';

  function error(code) {
    const result = new Error(code);
    result.code = code;
    return result;
  }

  function fnv64(value) {
    let hash = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(String(value || ''))) {
      hash ^= BigInt(byte);
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, '0');
  }

  function strictDocumentHash(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/^sha256:/u, '');
    if (!/^[a-f0-9]{64}$/u.test(normalized)) throw error('PDF_CANONICAL_DOCUMENT_HASH');
    return normalized;
  }

  function positiveInteger(value, code) {
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number) || number < 1) throw error(code);
    return number;
  }

  function normalizeRotation(value) {
    const rotation = ((Number(value) || 0) % 360 + 360) % 360;
    if (!SUPPORTED_ROTATIONS.has(rotation)) throw error('PDF_CANONICAL_ROTATION');
    return rotation;
  }

  function viewportTransform(rotation, view) {
    const [x0, y0, x1, y1] = view;
    const width = x1 - x0;
    const height = y1 - y0;
    if (rotation === 0) return [1, 0, 0, -1, -x0, y1];
    if (rotation === 90) return [0, 1, 1, 0, -y0, -x0];
    if (rotation === 180) return [-1, 0, 0, 1, x1, -y0];
    return [0, -1, -1, 0, y1, x1];
  }

  function pageMetrics(input = {}) {
    const page = input.page || {};
    const view = (Array.isArray(page.view) ? page.view : input.view || []).map(Number);
    if (view.length !== 4 || !view.every(Number.isFinite) ||
        view[2] <= view[0] || view[3] <= view[1]) throw error('PDF_CANONICAL_PAGE_VIEW');
    const viewport = input.viewport || {};
    const scale = viewport.scale === undefined ? 1 : Number(viewport.scale);
    if (!Number.isFinite(scale) || Math.abs(scale - 1) > 1e-7) {
      throw error('PDF_CANONICAL_SCALE');
    }
    const rotation = normalizeRotation(page.rotate ?? input.rotation);
    if (viewport.rotation !== undefined && normalizeRotation(viewport.rotation) !== rotation) {
      throw error('PDF_CANONICAL_ROTATION_MISMATCH');
    }
    const naturalWidth = view[2] - view[0];
    const naturalHeight = view[3] - view[1];
    const expectedWidth = rotation % 180 ? naturalHeight : naturalWidth;
    const expectedHeight = rotation % 180 ? naturalWidth : naturalHeight;
    const expectedTransform = viewportTransform(rotation, view);
    const pageWidth = viewport.width === undefined ? expectedWidth : Number(viewport.width);
    const pageHeight = viewport.height === undefined ? expectedHeight : Number(viewport.height);
    const transform = (Array.isArray(viewport.transform)
      ? viewport.transform : expectedTransform).map(Number);
    if (![pageWidth, pageHeight].every(value => Number.isFinite(value) && value > 0) ||
        transform.length !== 6 || !transform.every(Number.isFinite)) {
      throw error('PDF_CANONICAL_VIEWPORT');
    }
    const tolerance = 1e-7;
    if (Math.abs(pageWidth - expectedWidth) > tolerance ||
        Math.abs(pageHeight - expectedHeight) > tolerance ||
        transform.some((value, index) => Math.abs(value - expectedTransform[index]) > tolerance)) {
      throw error('PDF_CANONICAL_VIEWPORT_CONTRACT');
    }
    return { view, rotation, pageWidth, pageHeight, transform };
  }

  function transformPoint(matrix, point) {
    return {
      x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
      y: matrix[1] * point.x + matrix[3] * point.y + matrix[5]
    };
  }

  function pdfTextItemRect(item, metrics) {
    const width = Number(item?.width);
    if (!Number.isFinite(width) || width <= 0) return { reason: 'zero-width' };
    const transform = Array.isArray(item?.transform) ? item.transform.map(Number) : [];
    if (transform.length < 6 || !transform.slice(0, 6).every(Number.isFinite)) {
      return { reason: 'invalid-transform' };
    }
    const baselineLength = Math.hypot(transform[0], transform[1]);
    const verticalLength = Math.hypot(transform[2], transform[3]);
    const declaredHeight = Number(item?.height);
    const height = Number.isFinite(declaredHeight) && declaredHeight > 0
      ? declaredHeight : verticalLength;
    if (!Number.isFinite(height) || height <= 0) return { reason: 'non-positive-height' };
    const determinant = transform[0] * transform[3] - transform[1] * transform[2];
    if (baselineLength <= 1e-7 || Math.abs(determinant) <= 1e-7) {
      return { reason: 'degenerate-transform' };
    }
    const horizontal = { x: transform[0] / baselineLength, y: transform[1] / baselineLength };
    const vertical = verticalLength > 1e-7
      ? { x: transform[2] / verticalLength, y: transform[3] / verticalLength }
      : { x: -horizontal.y, y: horizontal.x };
    const origin = { x: transform[4], y: transform[5] };
    const corners = [
      origin,
      { x: origin.x + horizontal.x * width, y: origin.y + horizontal.y * width },
      { x: origin.x + vertical.x * height, y: origin.y + vertical.y * height },
      { x: origin.x + horizontal.x * width + vertical.x * height,
        y: origin.y + horizontal.y * width + vertical.y * height }
    ].map(point => transformPoint(metrics.transform, point));
    if (!corners.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) {
      return { reason: 'invalid-transform' };
    }
    const rect = {
      left: Math.min(...corners.map(point => point.x)),
      top: Math.min(...corners.map(point => point.y)),
      right: Math.max(...corners.map(point => point.x)),
      bottom: Math.max(...corners.map(point => point.y))
    };
    const epsilon = 1e-5;
    if (rect.right - rect.left <= epsilon || rect.bottom - rect.top <= epsilon ||
        rect.left < -epsilon || rect.top < -epsilon ||
        rect.right > metrics.pageWidth + epsilon || rect.bottom > metrics.pageHeight + epsilon) {
      return { reason: 'out-of-page' };
    }
    return { rect: Object.freeze({
      left: Math.max(0, rect.left), top: Math.max(0, rect.top),
      right: Math.min(metrics.pageWidth, rect.right),
      bottom: Math.min(metrics.pageHeight, rect.bottom)
    }) };
  }

  function canonicalItem(item) {
    if (typeof item?.str !== 'string') return null;
    const hadControl = CONTROL_PATTERN.test(item.str);
    CONTROL_PATTERN.lastIndex = 0;
    const value = item.str.normalize('NFKC').replace(CONTROL_PATTERN, '')
      .replace(/\s+/gu, ' ').trim();
    CONTROL_PATTERN.lastIndex = 0;
    return value ? { value, hadControl } : null;
  }

  function createCanonicalPdfPageRecord(input = {}) {
    const documentHash = strictDocumentHash(input.documentHash);
    const documentGeneration = positiveInteger(input.documentGeneration,
      'PDF_CANONICAL_DOCUMENT_GENERATION');
    const revision = positiveInteger(input.revision, 'PDF_CANONICAL_REVISION');
    const pageNumber = positiveInteger(input.pageNumber, 'PDF_CANONICAL_PAGE_NUMBER');
    const metrics = pageMetrics(input);
    const sourceItems = Array.isArray(input.textContent?.items) ? input.textContent.items : [];
    const inputOrder = input.textContentOrder === undefined ? 'source' : input.textContentOrder;
    if (!['source', 'reading-order'].includes(inputOrder)) {
      throw error('PDF_CANONICAL_TEXT_CONTENT_ORDER');
    }
    if (inputOrder === 'reading-order' && input.readingOrderContract !== READING_ORDER_CONTRACT) {
      throw error('PDF_CANONICAL_READING_ORDER_CONTRACT');
    }
    const orderedContent = inputOrder === 'source' &&
      typeof dependency.orderPdfTextContentForReading === 'function'
      ? dependency.orderPdfTextContentForReading(input.textContent,
        { view: metrics.view, rotate: metrics.rotation }) : input.textContent;
    const orderedItems = Array.isArray(orderedContent?.items) ? orderedContent.items : [];
    const sourceIndexes = new Map();
    sourceItems.forEach((item, index) => {
      const indexes = sourceIndexes.get(item) || [];
      indexes.push(index);
      sourceIndexes.set(item, indexes);
    });
    const sourceOccurrences = new Map();
    const originalIndex = item => {
      const indexes = sourceIndexes.get(item) || [];
      const occurrence = sourceOccurrences.get(item) || 0;
      sourceOccurrences.set(item, occurrence + 1);
      return indexes[occurrence] ?? -1;
    };
    const readingOrderStatus = Object.freeze({ inputOrder,
      contract: READING_ORDER_CONTRACT,
      reordered: inputOrder === 'source' && (orderedItems.length !== sourceItems.length ||
        orderedItems.some((item, index) => item !== sourceItems[index])) });
    const accepted = [];
    let droppedItemCount = 0;
    for (const item of orderedItems) {
      const sourceOrder = originalIndex(item);
      const canonical = canonicalItem(item);
      if (!canonical) {
        if (typeof item?.str === 'string') droppedItemCount += 1;
        continue;
      }
      accepted.push({ item, sourceOrder, ...canonical });
    }
    let pageText = '';
    const spans = accepted.map((entry, index) => {
      const start = pageText.length;
      pageText += entry.value;
      const end = pageText.length;
      if (index < accepted.length - 1) pageText += entry.item.hasEOL ? '\n' : ' ';
      const geometry = entry.hadControl
        ? { reason: 'control-character' } : pdfTextItemRect(entry.item, metrics);
      const positioned = Boolean(geometry.rect);
      return Object.freeze({
        text: entry.value, start, end, rawStart: start, rawEnd: end,
        sourceOrder: entry.sourceOrder, readingOrder: index,
        fontSize: Math.abs(Number(entry.item.height)) ||
          Math.hypot(Number(entry.item.transform?.[2]) || 0,
            Number(entry.item.transform?.[3]) || 0),
        fontName: String(entry.item.fontName || ''),
        bold: /(?:bold|black|semibold|demi)/iu.test(String(entry.item.fontName || '')),
        geometryStatus: positioned ? 'positioned' : 'fallback',
        geometryPrecision: positioned ? 'exact-native-item' : 'fallback',
        ...(positioned ? { rect: geometry.rect } : { fallbackReason: geometry.reason })
      });
    });
    const positioned = spans.filter(span => span.geometryStatus === 'positioned');
    const fallback = spans.filter(span => span.geometryStatus === 'fallback');
    const coverage = Object.freeze({
      sourceItemCount: sourceItems.length,
      textItemCount: spans.length,
      spanCount: spans.length,
      positionedSpanCount: positioned.length,
      fallbackSpanCount: fallback.length,
      droppedItemCount,
      positionedCharacterCount: positioned.reduce((sum, span) => sum + span.text.length, 0),
      fallbackCharacterCount: fallback.reduce((sum, span) => sum + span.text.length, 0),
      positionedPercent: spans.length
        ? Number((positioned.length * 100 / spans.length).toFixed(3)) : 0,
      textStatus: pageText ? 'full' : 'empty'
    });
    const binding = Object.freeze({ documentHash, documentGeneration, revision });
    const contentHash = fnv64(JSON.stringify({
      schemaVersion: 1, recordType: 'pdf-canonical-page', pageNumber, text: pageText,
      spans: spans.map(span => ({
        text: span.text, start: span.start, end: span.end,
        rawStart: span.rawStart, rawEnd: span.rawEnd,
        sourceOrder: span.sourceOrder, readingOrder: span.readingOrder,
        fontSize: span.fontSize, fontName: span.fontName, bold: span.bold,
        geometryStatus: span.geometryStatus, geometryPrecision: span.geometryPrecision,
        fallbackReason: span.fallbackReason || null, rect: span.rect || null
      })),
      pageWidth: metrics.pageWidth, pageHeight: metrics.pageHeight,
      view: metrics.view, rotation: metrics.rotation, rotate: metrics.rotation,
      geometryCoordinateSpace: 'page-viewport-css-px', geometryScale: 1,
      textSource: 'native-pdf-text', legacyParagraphId: `pdf-page-${pageNumber}`,
      sourceIdentity: `pdf:${pageNumber}`, readingOrderStatus, coverage
    }));
    const pageHash = fnv64(`${documentHash}:${documentGeneration}:${revision}:${pageNumber}:${contentHash}`);
    return Object.freeze({
      schemaVersion: 1,
      recordType: 'pdf-canonical-page',
      canonicalPageId: `pdf-canonical:${documentHash}:${documentGeneration}:${revision}:${pageNumber}:${pageHash}`,
      binding,
      pageNumber,
      text: pageText,
      spans: Object.freeze(spans),
      pageWidth: metrics.pageWidth,
      pageHeight: metrics.pageHeight,
      view: Object.freeze([...metrics.view]),
      rotation: metrics.rotation,
      rotate: metrics.rotation,
      contentHash,
      pageHash,
      geometryCoordinateSpace: 'page-viewport-css-px',
      geometryScale: 1,
      textSource: 'native-pdf-text',
      legacyParagraphId: `pdf-page-${pageNumber}`,
      sourceIdentity: `pdf:${pageNumber}`,
      readingOrderStatus,
      coverage
    });
  }

  function createCanonicalPdfPageRecordBatch(inputs = []) {
    if (!Array.isArray(inputs)) throw error('PDF_CANONICAL_BATCH_INPUT');
    return Object.freeze(inputs.map(createCanonicalPdfPageRecord));
  }

  return { createCanonicalPdfPageRecord, createCanonicalPdfPageRecordBatch,
    pdfTextItemRect };
});
