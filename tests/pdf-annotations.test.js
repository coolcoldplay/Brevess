const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pdfAnnotations = require('../core/pdf-annotations.js');
const manualAnnotations = require('../core/manual-annotations.js');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function viewport(scale = 1) {
  return {
    width: 600 * scale,
    height: 800 * scale,
    convertToPdfPoint(x, y) { return [x / scale, 800 - (y / scale)]; },
    convertToViewportPoint(x, y) { return [x * scale, (800 - y) * scale]; }
  };
}

function rotatedViewport(rotation, scale = 1) {
  const normalized = ((rotation % 360) + 360) % 360;
  const swapped = normalized === 90 || normalized === 270;
  const toViewport = {
    0: (x, y) => [x * scale, (800 - y) * scale],
    90: (x, y) => [y * scale, x * scale],
    180: (x, y) => [(600 - x) * scale, y * scale],
    270: (x, y) => [(800 - y) * scale, (600 - x) * scale]
  }[normalized];
  const toPdf = {
    0: (x, y) => [x / scale, 800 - (y / scale)],
    90: (x, y) => [y / scale, x / scale],
    180: (x, y) => [600 - (x / scale), y / scale],
    270: (x, y) => [600 - (y / scale), 800 - (x / scale)]
  }[normalized];
  return {
    width: (swapped ? 800 : 600) * scale,
    height: (swapped ? 600 : 800) * scale,
    convertToPdfPoint: toPdf,
    convertToViewportPoint: toViewport
  };
}

function quad(overrides = {}) {
  return {
    x1: 10, y1: 780, x2: 110, y2: 780,
    x3: 10, y3: 760, x4: 110, y4: 760,
    ...overrides
  };
}

function anchor(overrides = {}) {
  return {
    schemaVersion: 1,
    anchorKind: 'pdf_quad',
    pageNumber: 2,
    documentHash: 'sha256:' + 'a'.repeat(64),
    contextHash: 'pdf-page-2:context',
    quote: 'selected evidence',
    prefix: 'before ',
    suffix: ' after',
    quadPoints: [10, 780, 110, 780, 10, 760, 110, 760],
    ...overrides
  };
}

test('PDF-space quad survives viewport projection roundtrip', () => {
  const source = { left: 20, top: 40, right: 220, bottom: 80 };
  const created = pdfAnnotations.clientRectToPdfQuad(source, {
    pageRect: { left: 0, top: 0 }, viewport: viewport(2)
  });
  assert.deepEqual(created, quad());
  assert.deepEqual(pdfAnnotations.projectPdfQuad(created, viewport(2)), source);
});

test('normalizes the complete PDF anchor schema without losing context', () => {
  assert.deepEqual(pdfAnnotations.normalizePdfAnchor(anchor()), anchor());
});

test('accepts exactly 64 quads and rejects a 65th quad', () => {
  const sixtyFour = anchor({ quadPoints: Array.from({ length: 64 }, () =>
    [10, 780, 110, 780, 10, 760, 110, 760]).flat() });
  assert.equal(pdfAnnotations.normalizePdfAnchor(sixtyFour).quadPoints.length, 512);
  assert.throws(
    () => pdfAnnotations.normalizePdfAnchor({ ...sixtyFour,
      quadPoints: [...sixtyFour.quadPoints, 10, 780, 110, 780, 10, 760, 110, 760] }),
    error => error.code === 'PDF_ANCHOR_QUAD_LIMIT'
  );
});

test('rejects invalid pages, non-finite coordinates, and out-of-bounds quads', () => {
  assert.throws(() => pdfAnnotations.normalizePdfAnchor(anchor({ schemaVersion: 2 })),
    error => error.code === 'UNSUPPORTED_PDF_ANCHOR_SCHEMA');
  assert.throws(() => pdfAnnotations.normalizePdfAnchor(anchor({ pageNumber: 0 })),
    error => error.code === 'INVALID_PDF_PAGE');
  assert.throws(() => pdfAnnotations.normalizePdfAnchor(anchor({
    quadPoints: [NaN, 780, 110, 780, 10, 760, 110, 760]
  })),
    error => error.code === 'INVALID_PDF_QUAD');
  assert.throws(() => pdfAnnotations.clientRectToPdfQuad(
    { left: -1, top: 0, right: 10, bottom: 10 },
    { pageRect: { left: 0, top: 0 }, viewport: viewport(1) }
  ), error => error.code === 'PDF_QUAD_OUT_OF_BOUNDS');
});

test('selection builder retains quote context and page-numbered PDF quads', () => {
  const built = pdfAnnotations.createPdfSelectionAnchor({
    pageNumber: 3,
    documentHash: 'sha256:' + 'b'.repeat(64),
    contextHash: 'paragraph-hash',
    quote: 'result', prefix: 'the ', suffix: ' was significant',
    clientRects: [{ left: 20, top: 40, right: 220, bottom: 80 }],
    pageRect: { left: 0, top: 0 }, viewport: viewport(2)
  });
  assert.equal(built.pageNumber, 3);
  assert.equal(built.quote, 'result');
  assert.equal(built.contextHash, 'paragraph-hash');
  assert.equal(built.anchorKind, 'pdf_quad');
  assert.deepEqual(built.quadPoints, anchor().quadPoints);
  assert.equal(Object.hasOwn(built, 'quads'), false);
});

test('rotation 90/180/270 roundtrips PDF quad geometry', () => {
  for (const rotation of [90, 180, 270]) {
    const rotated = rotatedViewport(rotation, 1.5);
    const projected = pdfAnnotations.projectPdfQuad(quad(), rotated);
    const restored = pdfAnnotations.clientRectToPdfQuad(projected, {
      pageRect: { left: 0, top: 0 }, viewport: rotated
    });
    const reprojection = pdfAnnotations.projectPdfQuad(restored, rotated);
    for (const key of ['left', 'top', 'right', 'bottom']) {
      assert.ok(Math.abs(reprojection[key] - projected[key]) <= 0.000001, `${rotation}:${key}`);
    }
  }
});

test('clips a 0.5px edge tolerance and rejects a larger excursion', () => {
  const clipped = pdfAnnotations.clientRectToPdfQuad(
    { left: -0.5, top: -0.5, right: 10, bottom: 10 },
    { pageRect: { left: 0, top: 0 }, viewport: viewport(1) }
  );
  assert.equal(clipped.x1, 0);
  assert.throws(() => pdfAnnotations.clientRectToPdfQuad(
    { left: -0.5001, top: 0, right: 10, bottom: 10 },
    { pageRect: { left: 0, top: 0 }, viewport: viewport(1) }
  ), error => error.code === 'PDF_QUAD_OUT_OF_BOUNDS');
});

test('anchor text limits and serialized budget are bounded', () => {
  const bounded = pdfAnnotations.normalizePdfAnchor(anchor({
    quote: 'q'.repeat(12000), prefix: 'p'.repeat(240), suffix: 's'.repeat(240),
    quadPoints: Array.from({ length: 64 }, () =>
      [10, 780, 110, 780, 10, 760, 110, 760]).flat()
  }));
  assert.ok(JSON.stringify(bounded).length <= 24000);
  assert.throws(() => pdfAnnotations.normalizePdfAnchor(anchor({ quote: 'q'.repeat(12001) })),
    error => error.code === 'INVALID_PDF_ANCHOR_TEXT');
  assert.throws(() => pdfAnnotations.normalizePdfAnchor(anchor({ prefix: 'p'.repeat(241) })),
    error => error.code === 'INVALID_PDF_ANCHOR_TEXT');
});

test('legacy object quads normalize to canonical flat quadPoints without duplication', () => {
  const legacy = anchor();
  delete legacy.quadPoints;
  legacy.quads = [quad()];
  const normalized = pdfAnnotations.normalizePdfAnchor(legacy);
  assert.deepEqual(normalized.quadPoints, anchor().quadPoints);
  assert.equal(Object.hasOwn(normalized, 'quads'), false);
});

test('document hash guard rejects stale annotations', () => {
  assert.equal(pdfAnnotations.pdfAnchorMatchesDocument(
    anchor(), 'sha256:' + 'a'.repeat(64)
  ), true);
  assert.equal(pdfAnnotations.pdfAnchorMatchesDocument(
    anchor(), 'sha256:' + 'c'.repeat(64)
  ), false);
});

test('document hash guard accepts the stored raw digest and sha256-prefixed equivalent', () => {
  const rawHash = 'e'.repeat(64);
  const rawAnchor = anchor({ documentHash: rawHash });
  assert.equal(pdfAnnotations.normalizePdfAnchor(rawAnchor).documentHash, rawHash);
  assert.equal(pdfAnnotations.pdfAnchorMatchesDocument(rawAnchor, `sha256:${rawHash}`), true);
});

function fakeLayer() {
  const children = [];
  const ownerDocument = {
    createElement() {
      const listeners = new Map();
      return {
        className: '', dataset: {}, style: {}, type: '', title: '',
        setAttribute(name, value) { this[name] = value; },
        addEventListener(type, handler) { listeners.set(type, handler); },
        click() { listeners.get('click')?.({ preventDefault() {}, stopPropagation() {} }); }
      };
    }
  };
  return {
    ownerDocument, children,
    replaceChildren(...items) { children.splice(0, children.length, ...items); },
    appendChild(item) { children.push(item); }
  };
}

test('overlay projection scales from stable PDF coordinates and preserves annotation identity', () => {
  const annotation = {
    annotationId: 'manual-1', categorySnapshot: { name: 'Methods', color: '#2F80ED' },
    pdfAnchor: anchor()
  };
  const layer = fakeLayer();
  const activated = [];
  const first = pdfAnnotations.syncPdfAnnotationOverlay({
    layer, annotations: [annotation], pageNumber: 2, viewport: viewport(1),
    documentHash: anchor().documentHash, onActivate: payload => activated.push(payload)
  });
  assert.equal(first.rendered, 1);
  assert.equal(layer.children[0].dataset.annotationId, 'manual-1');
  assert.equal(layer.children[0].type, 'button');
  assert.match(layer.children[0]['aria-label'], /Methods高亮/);
  assert.equal(layer.children[0].style.width, '100px');

  pdfAnnotations.syncPdfAnnotationOverlay({
    layer, annotations: [annotation], pageNumber: 2, viewport: viewport(2),
    documentHash: anchor().documentHash, onActivate: payload => activated.push(payload)
  });
  assert.equal(layer.children[0].dataset.annotationId, 'manual-1');
  assert.equal(layer.children[0].style.width, '200px');
  layer.children[0].click();
  assert.deepEqual(activated, [{ annotationId: 'manual-1', documentHash: anchor().documentHash }]);
});

test('overlay omits other pages and stale document anchors', () => {
  const layer = fakeLayer();
  const valid = { annotationId: 'valid', categorySnapshot: { color: '#2F80ED' }, pdfAnchor: anchor() };
  const stale = { annotationId: 'stale', categorySnapshot: { color: '#FF0000' },
    pdfAnchor: anchor({ documentHash: 'sha256:' + 'd'.repeat(64) }) };
  const result = pdfAnnotations.syncPdfAnnotationOverlay({
    layer, annotations: [valid, stale], pageNumber: 1, viewport: viewport(1),
    documentHash: anchor().documentHash
  });
  assert.deepEqual(result, { rendered: 0, skipped: 2 });
  assert.equal(layer.children.length, 0);
});

test('hit testing can forward a text-layer click to the annotation beneath it', () => {
  const otherPage = { matches: selector => selector === '.pdf-native-annotation-hit',
    closest: () => ({ dataset: { pdfPageNumber: '3' } }) };
  const expected = { matches: selector => selector === '.pdf-native-annotation-hit',
    closest: () => ({ dataset: { pdfPageNumber: '2' } }) };
  assert.equal(pdfAnnotations.pickPdfAnnotationHit([{}, otherPage, expected], 2), expected);
});

test('annotation updates enforce loaded hash and generation while filtering mixed anchors', () => {
  const currentHash = 'a'.repeat(64);
  const valid = { annotationId: 'valid', pdfAnchor: anchor({ documentHash: currentHash }) };
  const stale = { annotationId: 'stale', pdfAnchor: anchor({ documentHash: 'd'.repeat(64) }) };
  const mixed = pdfAnnotations.reconcilePdfAnnotationUpdate({
    currentDocumentHash: currentHash, currentGeneration: 7,
    eventDocumentHash: currentHash, eventGeneration: 7,
    annotations: [valid, stale, { annotationId: 'broken', pdfAnchor: {} }]
  });
  assert.equal(mixed.accepted, true);
  assert.deepEqual(mixed.annotations.map(item => item.annotationId), ['valid']);
  assert.equal(mixed.skipped, 2);

  const staleOnly = pdfAnnotations.reconcilePdfAnnotationUpdate({
    currentDocumentHash: currentHash, currentGeneration: 7,
    eventDocumentHash: currentHash, eventGeneration: 7, annotations: [stale]
  });
  assert.deepEqual(staleOnly, { accepted: true, annotations: [], skipped: 1 });

  const late = pdfAnnotations.reconcilePdfAnnotationUpdate({
    currentDocumentHash: currentHash, currentGeneration: 7,
    eventDocumentHash: currentHash, eventGeneration: 6, annotations: [valid]
  });
  assert.deepEqual(late, { accepted: false, annotations: [], skipped: 1 });
});

test('selection request identity rejects stale hash or generation', () => {
  assert.equal(pdfAnnotations.pdfRequestMatchesDocument({
    currentDocumentHash: 'a'.repeat(64), currentGeneration: 4,
    requestDocumentHash: `sha256:${'a'.repeat(64)}`, requestGeneration: 4
  }), true);
  assert.equal(pdfAnnotations.pdfRequestMatchesDocument({
    currentDocumentHash: 'a'.repeat(64), currentGeneration: 4,
    requestDocumentHash: 'b'.repeat(64), requestGeneration: 4
  }), false);
  assert.equal(pdfAnnotations.pdfRequestMatchesDocument({
    currentDocumentHash: 'a'.repeat(64), currentGeneration: 4,
    requestDocumentHash: 'a'.repeat(64), requestGeneration: 3
  }), false);
});

test('native mutation gate rejects missing or stale PDF anchors after bridge failure', () => {
  const hash = 'a'.repeat(64);
  assert.equal(pdfAnnotations.pdfSelectionMutationReady({
    pdfDocumentGeneration: 5, pdfAnchor: null, documentHash: hash
  }), false, 'a rejected request must not fall back to a DOM annotation');
  assert.equal(pdfAnnotations.pdfSelectionMutationReady({
    pdfDocumentGeneration: 5, pdfAnchor: anchor({ documentHash: 'b'.repeat(64) }),
    documentHash: hash
  }), false, 'a stale conversion result must not be saved');
  assert.equal(pdfAnnotations.pdfSelectionMutationReady({
    pdfDocumentGeneration: 5, pdfAnchor: anchor({ documentHash: hash }), documentHash: hash
  }), true);
  assert.equal(pdfAnnotations.pdfSelectionMutationReady({
    pdfDocumentGeneration: 0, pdfAnchor: null, documentHash: ''
  }), true, 'ordinary HTML annotations remain compatible');
});

test('selection anchor bridge treats rejection, exception, and no result as hard failures', () => {
  const detail = { pdfAnchor: null };
  assert.equal(pdfAnnotations.requestPdfSelectionAnchor({ detail, dispatch() {} }), null);
  assert.equal(pdfAnnotations.requestPdfSelectionAnchor({
    detail: { pdfAnchor: null }, dispatch() { throw new Error('conversion failed'); }
  }), null);
  assert.equal(pdfAnnotations.requestPdfSelectionAnchor({
    detail: { pdfAnchor: null }, dispatch(payload) { payload.pdfAnchor = null; return false; }
  }), null);
  const expected = anchor({ documentHash: 'a'.repeat(64) });
  assert.deepEqual(pdfAnnotations.requestPdfSelectionAnchor({
    detail: { pdfAnchor: null }, dispatch(payload) { payload.pdfAnchor = expected; }
  }), expected);
});

test('real Range client rect collection retains multiline geometry and rejects cross-page ranges', () => {
  const page1 = { dataset: { pdfPageNumber: '1' }, getBoundingClientRect: () =>
    ({ left: 0, top: 0, right: 600, bottom: 800 }) };
  const page2 = { dataset: { pdfPageNumber: '2' } };
  const firstNode = { layer: page1 };
  const secondNode = { layer: page1 };
  const range = {
    startContainer: firstNode, endContainer: secondNode,
    getClientRects() {
      return [
        { left: 10, top: 20, right: 90, bottom: 30 },
        { left: 10, top: 32, right: 55, bottom: 42 }
      ];
    }
  };
  const samePage = pdfAnnotations.readPdfTextLayerRange(range, node => node.layer);
  assert.equal(samePage.pageNumber, 1);
  assert.equal(samePage.clientRects.length, 2);
  assert.deepEqual(samePage.clientRects[1], { left: 10, top: 32, right: 55, bottom: 42 });
  assert.equal(pdfAnnotations.readPdfTextLayerRange(
    { ...range, endContainer: { layer: page2 } }, node => node.layer
  ), null);
});

test('an unsplittable oversized Range is rejected instead of saving a partial PDF anchor', () => {
  const layer = { dataset: { pdfPageNumber: '4' }, getBoundingClientRect: () =>
    ({ left: 0, top: 0, right: 600, bottom: 800 }) };
  const node = { layer };
  const range = {
    startContainer: node, endContainer: node,
    getClientRects() {
      return Array.from({ length: 67 }, (_, index) => index === 65
        ? { left: 1, top: 1, right: 1, bottom: 2 }
        : { left: 10, top: 10 + index * 2, right: 50, bottom: 11 + index * 2 });
    }
  };
  const selected = pdfAnnotations.readPdfTextLayerRange(range, item => item.layer);
  assert.equal(selected, null);

  assert.throws(() => pdfAnnotations.createPdfSelectionAnchor({
    pageNumber: 4, documentHash: 'a'.repeat(64), contextHash: '1234abcd',
    quote: 'multiline', prefix: '', suffix: '',
    clientRects: Array.from({ length: 65 }, (_, index) => ({
      left: 10, top: 10 + index * 2, right: 50, bottom: 11 + index * 2
    })),
    pageRect: { left: 0, top: 0 }, viewport: viewport(1)
  }), /PDF_ANCHOR_QUAD_LIMIT/);
  assert.equal(pdfAnnotations.readPdfTextLayerRange({
    startContainer: node, endContainer: node,
    getClientRects: () => [{ left: 1, top: 1, right: 1, bottom: 2 }]
  }, item => item.layer), null);
});

test('manual annotation normalization validates and retains a PDF anchor', () => {
  const normalized = manualAnnotations.normalizeManualAnnotation({
    annotationId: 'manual-pdf', categoryId: 'methods',
    categorySnapshot: { name: 'Methods', color: '#2F80ED' },
    quote: 'selected evidence', prefix: 'before ', suffix: ' after',
    sectionTitle: '', blockFingerprint: 'pdf-page-2:context',
    startOffset: 0, endOffset: 17, note: '', status: 'located',
    pdfAnchor: anchor()
  });
  assert.deepEqual(normalized.pdfAnchor, anchor());
  assert.throws(() => manualAnnotations.normalizeManualAnnotation({
    ...normalized, pdfAnchor: { ...anchor(), pageNumber: 0 }
  }), error => error.code === 'INVALID_PDF_PAGE');
});

test('PDF reader loads the anchor module before content and native reader', () => {
  const html = read('pdf-reader.html');
  const anchorModule = html.indexOf('<script src="core/pdf-annotations.js"></script>');
  assert.ok(anchorModule >= 0);
  assert.ok(anchorModule < html.indexOf('<script src="content.js"></script>'));
  assert.ok(anchorModule < html.indexOf('<script type="module" src="pdf-native-reader.mjs"></script>'));
});

test('background validates PDF anchors before manual annotation persistence', () => {
  const background = read('background.js');
  const anchorModule = background.indexOf("'core/pdf-annotations.js'");
  const manualModule = background.indexOf("'core/manual-annotations.js'");
  assert.ok(anchorModule >= 0 && anchorModule < manualModule);
});

test('content bridges native PDF selections and annotation lifecycle without private payloads', () => {
  const content = read('content.js');
  assert.match(content,
    /describeCurrentManualSelection[\s\S]*closest\?\.\('\.pdf-native-text-layer'\)/);
  assert.match(content, /brevess:pdf-selection-anchor-request/);
  assert.match(content, /brevess:pdf-annotations-updated/);
  assert.match(content, /brevess:pdf-annotation-activate/);
  assert.match(content, /pdfAnchor[\s\S]*contextHash/);
  assert.match(content,
    /nativePdfIdentity:\s*\{[\s\S]{0,400}adapterId:\s*'pdf-native'[\s\S]{0,400}documentHash/);
  assert.match(content,
    /contextHash:\s*String\(SciLLM\.stableHash\?\.\(\{[\s\S]{0,160}quote,[\s\S]{0,160}prefix:[\s\S]{0,160}suffix:/);
  assert.match(content, /documentGeneration/);
  assert.match(content,
    /nativeStartLayer[\s\S]{0,500}!nativeRange[\s\S]{0,500}INVALID_PDF_RANGE/);
  assert.match(content,
    /requestPdfSelectionAnchor\?\.\(\{[\s\S]{0,500}brevess:pdf-selection-anchor-request[\s\S]{0,500}!requestedPdfAnchor[\s\S]{0,500}INVALID_PDF_ANCHOR/);
  assert.match(content,
    /isCurrentManualMutationCandidate[\s\S]{0,900}pdfSelectionMutationReady/);
  assert.doesNotMatch(content, /brevess:pdf-annotations-updated[\s\S]{0,500}(?:pdfBytes|sourceUrl|originalUrl)/);
  assert.match(content,
    /rangeIntersectsManualForbiddenRegion[\s\S]{0,500}pdf-native-text-layer[\s\S]{0,200}return false/);
});

test('native reader converts selections and redraws overlays on mount and viewport change', () => {
  const nativeReader = read('pdf-native-reader.mjs');
  assert.match(nativeReader, /brevess:pdf-selection-anchor-request/);
  assert.match(nativeReader, /createPdfSelectionAnchor/);
  assert.match(nativeReader, /brevess:pdf-annotations-updated/);
  assert.match(nativeReader, /syncPdfAnnotationOverlay/);
  assert.match(nativeReader,
    /mountPageLayers[\s\S]*renderPdfAnnotationOverlay/);
  assert.match(nativeReader,
    /updateRecordViewport[\s\S]*renderPdfAnnotationOverlay/);
  assert.match(nativeReader, /brevess:pdf-annotation-activate/);
  assert.match(nativeReader, /crypto\.subtle\.digest\('SHA-256', bytes\)/);
  assert.match(nativeReader, /reconcilePdfAnnotationUpdate\(\{/);
  assert.match(nativeReader, /pdfRequestMatchesDocument\(\{/);
  assert.match(nativeReader,
    /replaceDocument[\s\S]{0,500}nativeDocumentGeneration \+= 1[\s\S]{0,500}delete globalThis\.__brevessNativePdfDocument/);
  assert.match(nativeReader,
    /textLayer\.addEventListener\('click'[\s\S]*getSelection\(\)[\s\S]*elementsFromPoint[\s\S]*pickPdfAnnotationHit/);
});

test('native annotation overlay is clickable above canvas and below selectable text', () => {
  const css = read('pdf-reader.css');
  assert.match(css, /\.pdf-native-page-canvas\s*\{[^}]*z-index:\s*0/s);
  assert.match(css, /\.pdf-native-annotation-layer\s*\{[^}]*z-index:\s*1[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.pdf-native-annotation-hit\s*\{[^}]*pointer-events:\s*auto/s);
  assert.match(css, /\.pdf-native-text-layer\s*\{[^}]*z-index:\s*2/s);
});
