(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const PDFJS_EDITOR_PREFIX = 'pdfjs_internal_editor_';
  const BREVESS_EDITOR_PREFIX = `${PDFJS_EDITOR_PREFIX}brevess:`;
  const MAX_QUADS = 64;
  const MAX_COORDINATE = 20000;
  const MAX_NOTE_LENGTH = 12000;
  const MAX_ANNOTATION_ID_LENGTH = 512;
  const managedKeys = new WeakMap();

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function sourceAnchor(annotation) {
    return annotation?.pdfAnchor && typeof annotation.pdfAnchor === 'object'
      ? annotation.pdfAnchor : annotation;
  }

  function normalizePageNumber(value) {
    const pageNumber = Number(value);
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 100000) {
      fail('INVALID_PDF_HIGHLIGHT_PAGE');
    }
    return pageNumber;
  }

  function finiteCoordinate(value) {
    const coordinate = Number(value);
    if (!Number.isFinite(coordinate) || Math.abs(coordinate) > MAX_COORDINATE) {
      fail('INVALID_PDF_HIGHLIGHT_QUAD');
    }
    return Object.is(coordinate, -0) ? 0 : coordinate;
  }

  function normalizeQuadPoints(value) {
    const input = Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value) : [];
    if (input.length < 8 || input.length % 8 !== 0) fail('INVALID_PDF_HIGHLIGHT_QUADS');
    if (input.length > MAX_QUADS * 8) fail('PDF_HIGHLIGHT_QUAD_LIMIT');
    const points = new Float32Array(input.length);
    for (let offset = 0; offset < input.length; offset += 8) {
      const quad = input.slice(offset, offset + 8).map(finiteCoordinate);
      const xs = [quad[0], quad[2], quad[4], quad[6]];
      const ys = [quad[1], quad[3], quad[5], quad[7]];
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      if (maxX <= minX || maxY <= minY) {
        fail('INVALID_PDF_HIGHLIGHT_QUAD');
      }
      points.set([minX, maxY, maxX, maxY, minX, minY, maxX, minY], offset);
    }
    return points;
  }

  function normalizeColor(value) {
    let input = value;
    if (typeof input === 'string') {
      const match = /^#([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i.exec(input.trim());
      if (!match) fail('INVALID_PDF_HIGHLIGHT_COLOR');
      input = match.slice(1).map(item => Number.parseInt(item, 16));
    }
    if ((!Array.isArray(input) && !ArrayBuffer.isView(input)) || input.length !== 3) {
      fail('INVALID_PDF_HIGHLIGHT_COLOR');
    }
    return Array.from(input, item => {
      const channel = Number(item);
      if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
        fail('INVALID_PDF_HIGHLIGHT_COLOR');
      }
      return channel;
    });
  }

  function normalizeOpacity(value) {
    const opacity = value === undefined ? 0.35 : Number(value);
    if (!Number.isFinite(opacity)) fail('INVALID_PDF_HIGHLIGHT_OPACITY');
    return Math.min(1, Math.max(0, opacity));
  }

  function boundingRect(points) {
    const xs = [];
    const ys = [];
    for (let index = 0; index < points.length; index += 2) {
      xs.push(points[index]);
      ys.push(points[index + 1]);
    }
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  function quadOutlines(points) {
    const outlines = [];
    for (let offset = 0; offset < points.length; offset += 8) {
      outlines.push([
        points[offset], points[offset + 1],
        points[offset + 2], points[offset + 3],
        points[offset + 6], points[offset + 7],
        points[offset + 4], points[offset + 5]
      ]);
    }
    return outlines;
  }

  function serializePdfHighlight(annotation = {}) {
    const anchor = sourceAnchor(annotation);
    const pageNumber = normalizePageNumber(anchor?.pageNumber);
    const quadPoints = normalizeQuadPoints(anchor?.quadPoints);
    const rect = boundingRect(quadPoints);
    const color = normalizeColor(annotation.color ?? annotation.categorySnapshot?.color ?? '#F2D978');
    const opacity = normalizeOpacity(annotation.opacity);
    const comment = String(annotation.note ?? annotation.comment ?? '').slice(0, MAX_NOTE_LENGTH);
    const record = {
      annotationType: 9,
      pageIndex: pageNumber - 1,
      rect,
      rotation: 0,
      color,
      opacity,
      thickness: 12,
      quadPoints,
      outlines: quadOutlines(quadPoints),
      comment,
      user: 'Brevess'
    };
    if (comment) {
      record.popup = { contents: comment, deleted: false, rect: rect.slice() };
    }
    return record;
  }

  function pdfHighlightStorageKey(annotationId) {
    const id = String(annotationId ?? '').trim();
    if (!id || id.length > MAX_ANNOTATION_ID_LENGTH) fail('INVALID_PDF_HIGHLIGHT_ID');
    return `${BREVESS_EDITOR_PREFIX}${encodeURIComponent(id)}`;
  }

  function storedBrevessKeys(annotationStorage) {
    const keys = new Set(managedKeys.get(annotationStorage) || []);
    try {
      const serialized = annotationStorage.serializable;
      if (serialized?.map instanceof Map) {
        for (const key of serialized.map.keys()) {
          if (String(key).startsWith(BREVESS_EDITOR_PREFIX)) keys.add(String(key));
        }
      }
    } catch (_) {}
    return keys;
  }

  async function savePdfHighlightAnnotations({ pdfDocument, annotations = [] } = {}) {
    const annotationStorage = pdfDocument?.annotationStorage;
    if (!annotationStorage || typeof annotationStorage.setValue !== 'function' ||
        typeof annotationStorage.remove !== 'function' ||
        typeof pdfDocument.saveDocument !== 'function') {
      fail('INVALID_PDF_DOCUMENT');
    }
    const records = [];
    for (const annotation of Array.isArray(annotations) ? annotations : []) {
      if (annotation?.deleted === true || annotation?.deletedAt) continue;
      records.push([
        pdfHighlightStorageKey(annotation?.annotationId),
        serializePdfHighlight(annotation)
      ]);
    }
    for (const key of storedBrevessKeys(annotationStorage)) annotationStorage.remove(key);
    const nextKeys = new Set();
    for (const [key, record] of records) {
      annotationStorage.setValue(key, record);
      nextKeys.add(key);
    }
    managedKeys.set(annotationStorage, nextKeys);
    return pdfDocument.saveDocument();
  }

  function closeEnough(left, right) {
    const first = Array.from(left || []);
    const second = Array.from(right || []);
    return first.length === second.length && first.every((value, index) =>
      Math.abs(Number(value) - Number(second[index])) <= 0.01
    );
  }

  function annotationComment(annotation) {
    return String(annotation?.contentsObj?.str ?? annotation?.contents ?? annotation?.comment ?? '');
  }

  function annotationAuthor(annotation) {
    return String(annotation?.titleObj?.str ?? annotation?.title ?? annotation?.user ?? '');
  }

  function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map(key =>
        `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  }

  function pdfAnnotationSnapshotDigest(annotations = []) {
    const input = canonicalJson(Array.isArray(annotations) ? annotations : []);
    let first = 2166136261;
    let second = 2246822519;
    for (let index = 0; index < input.length; index += 1) {
      const code = input.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619) >>> 0;
      second = Math.imul(second ^ code, 3266489917) >>> 0;
    }
    return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
  }

  function freezeJson(value) {
    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      return Object.freeze(Array.from(value).map(freezeJson));
    }
    if (value && typeof value === 'object') {
      const next = {};
      for (const [key, item] of Object.entries(value)) next[key] = freezeJson(item);
      return Object.freeze(next);
    }
    return value;
  }

  function createPdfSaveExportContext(input = {}) {
    const documentHash = String(input.documentHash || '');
    const generation = Number(input.generation);
    if (!/^[a-f0-9]{64}$/i.test(documentHash) || !Number.isSafeInteger(generation) ||
        generation < 1) fail('INVALID_PDF_SAVE_CONTEXT');
    const annotationsSnapshot = freezeJson(Array.isArray(input.annotations) ? input.annotations : []);
    const capturedBytes = Uint8Array.from(input.bytes || []);
    const context = {
      documentHash: documentHash.toLowerCase(),
      generation,
      annotationsSnapshot,
      annotationsDigest: pdfAnnotationSnapshotDigest(annotationsSnapshot)
    };
    Object.defineProperty(context, 'bytes', {
      enumerable: true,
      get() { return Uint8Array.from(capturedBytes); }
    });
    return Object.freeze(context);
  }

  function pdfSaveContextMatches(context, current = {}) {
    return Boolean(context &&
      String(context.documentHash || '') === String(current.documentHash || '').toLowerCase() &&
      Number(context.generation) === Number(current.generation) &&
      String(context.annotationsDigest || '') ===
        pdfAnnotationSnapshotDigest(current.annotations));
  }

  async function verifySavedPdfAnnotations({ bytes, annotations = [], getDocument } = {}) {
    if (typeof getDocument !== 'function') fail('PDF_VERIFICATION_UNAVAILABLE');
    const live = (Array.isArray(annotations) ? annotations : [])
      .filter(item => item && item.deleted !== true && !item.deletedAt)
      .map(item => ({ source: item, record: serializePdfHighlight(item) }));
    const pageNumbers = [...new Set(live.map(item => item.record.pageIndex + 1))]
      .sort((left, right) => left - right);
    const loadingTask = getDocument({ data: Uint8Array.from(bytes || []) });
    let document;
    try {
      document = await loadingTask.promise;
      const byPage = new Map();
      for (const pageNumber of pageNumbers) {
        const page = await document.getPage(pageNumber);
        const pageAnnotations = Array.from(await page.getAnnotations({ intent: 'display' }));
        const brevessHighlights = pageAnnotations.filter(item =>
          Number(item?.annotationType) === 9 && annotationAuthor(item) === 'Brevess'
        );
        byPage.set(pageNumber, brevessHighlights);
      }
      const verifiedIds = [];
      const missingIds = [];
      for (const expected of live) {
        const candidates = byPage.get(expected.record.pageIndex + 1) || [];
        const index = candidates.findIndex(candidate =>
          Number(candidate?.annotationType) === 9 &&
          annotationAuthor(candidate) === 'Brevess' &&
          closeEnough(candidate.rect, expected.record.rect) &&
          closeEnough(candidate.quadPoints, expected.record.quadPoints) &&
          closeEnough(candidate.color, expected.record.color) &&
          Math.abs(Number(candidate.opacity) - Number(expected.record.opacity)) <= 0.001 &&
          annotationComment(candidate) === expected.record.comment
        );
        const id = String(expected.source.annotationId || '');
        if (index >= 0) {
          verifiedIds.push(id);
          candidates.splice(index, 1);
        } else {
          missingIds.push(id);
        }
      }
      return { ok: missingIds.length === 0, verifiedIds, missingIds };
    } finally {
      try {
        if (document?.destroy) await document.destroy();
        else await loadingTask?.destroy?.();
      } catch (_) {}
    }
  }

  return {
    PDFJS_EDITOR_PREFIX,
    BREVESS_EDITOR_PREFIX,
    serializePdfHighlight,
    pdfHighlightStorageKey,
    savePdfHighlightAnnotations,
    verifySavedPdfAnnotations,
    pdfAnnotationSnapshotDigest,
    createPdfSaveExportContext,
    pdfSaveContextMatches
  };
});
