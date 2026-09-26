const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const native = require('../core/pdf-native-reader-state.js');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('page image requests have explicit page, scale, clip, and pixel bounds', () => {
  assert.deepEqual(native.normalizePdfNativePageImageRequest(2, undefined, {
    pageCount: 4
  }), { pageNumber: 2, scale: 1.5, clip: null });
  assert.deepEqual(native.normalizePdfNativePageImageRequest('4', { scale: 2 }, {
    pageCount: 4
  }), { pageNumber: 4, scale: 2, clip: null });
  assert.throws(() => native.normalizePdfNativePageImageRequest(0, {}, {
    pageCount: 4
  }), error => error?.code === 'PDF_IMAGE_PAGE_OUT_OF_RANGE');
  assert.throws(() => native.normalizePdfNativePageImageRequest(5, {}, {
    pageCount: 4
  }), error => error?.code === 'PDF_IMAGE_PAGE_OUT_OF_RANGE');
  assert.throws(() => native.normalizePdfNativePageImageRequest(1, { scale: 4.01 }, {
    pageCount: 4
  }), error => error?.code === 'PDF_IMAGE_SCALE_OUT_OF_RANGE');
  assert.throws(() => native.normalizePdfNativePageImageRequest(1, {
    clip: { x: 0, y: 0, width: 10, height: 10 }
  }, { pageCount: 4 }), error => error?.code === 'PDF_IMAGE_CLIP_UNSUPPORTED');

  assert.deepEqual(native.validatePdfNativeImageDimensions({
    width: 612.2, height: 791.1
  }, { maxPixels: 1_000_000 }), { width: 613, height: 792, pixels: 485496 });
  assert.throws(() => native.validatePdfNativeImageDimensions({
    width: 4001, height: 4000
  }), error => error?.code === 'PDF_IMAGE_PIXEL_LIMIT_EXCEEDED');
});

test('page projection accepts an owned TextLayer before Canvas and rejects stale generations', () => {
  const section = {};
  const textLayer = {};
  const textContent = { items: [{ str: 'result' }] };
  const viewport = { width: 612, height: 792 };
  const record = {
    pageNumber: 3,
    documentHash: 'doc-three',
    documentGeneration: 7,
    mounted: true,
    rendered: true,
    section,
    textLayer,
    textContent,
    viewport
  };
  assert.deepEqual(native.createPdfNativePageProjection(record, {
    documentHash: 'doc-three', documentGeneration: 7
  }), {
    pageNumber: 3,
    documentHash: 'doc-three',
    documentGeneration: 7,
    viewport,
    pageElement: section,
    textLayer,
    textContent
  });
  assert.equal(native.createPdfNativePageProjection({ ...record, rendered: false }, {
    documentHash: 'doc-three', documentGeneration: 7
  }), null);
  const textReady = {
    ...record,
    rendered: false,
    textLayerReady: true,
    textLayerRenderGeneration: 11
  };
  assert.ok(native.createPdfNativePageProjection(textReady, {
    documentHash: 'doc-three', documentGeneration: 7, renderGeneration: 11
  }));
  assert.equal(native.createPdfNativePageProjection(textReady, {
    documentHash: 'doc-three', documentGeneration: 7, renderGeneration: 12
  }), null);
  assert.equal(native.createPdfNativePageProjection(record, {
    documentHash: 'doc-three', documentGeneration: 8
  }), null);
});

test('a new document can restart a failed lifecycle without reviving disposed work', () => {
  const lifecycle = native.createPdfNativeLifecycle();
  const failedInitialization = lifecycle.begin();
  lifecycle.fail();
  assert.equal(lifecycle.isTerminal(), true);
  assert.equal(lifecycle.canCommit(failedInitialization), false);

  lifecycle.restart();
  const replacementInitialization = lifecycle.begin();
  assert.equal(lifecycle.isTerminal(), false);
  assert.equal(lifecycle.canCommit(replacementInitialization), true);
  assert.equal(lifecycle.canCommit(failedInitialization), false);

  lifecycle.fail();
  assert.equal(lifecycle.canCommit(replacementInitialization), false);

  const reader = read('pdf-native-reader.mjs');
  assert.match(reader, /async function replaceDocument\(\)[\s\S]*lifecycle\.restart\(\)/);
  assert.match(reader,
    /replacementGeneration !== nativeDocumentGeneration\) return false/);
  assert.match(reader,
    /failureDocumentGeneration !== nativeDocumentGeneration\) return/);
  assert.match(reader, /function dispose\(\)[\s\S]*lifecycle\.fail\(\)/);
});

test('exact viewport pages keep bounded high-DPI admission ahead of preview canvases', () => {
  const budget = native.createPdfNativeCanvasBudget({
    maxPixels: 3_000_000,
    maxBytes: 12_000_000,
    maxLivePages: 3,
    maxOutputScale: 2.5
  });
  assert.deepEqual(budget.admit(1, {
    pixels: 1_000_000, bytes: 4_000_000
  }), { accepted: true, evicted: [] });
  const currentScale = budget.outputScale({
    width: 1000, height: 1000, requestedScale: 2.5, current: true
  });
  assert.equal(currentScale, 1.73);
  assert.deepEqual(budget.admit(2, {
    pixels: 2_992_900,
    bytes: 11_971_600,
    protectedPages: [2]
  }), { accepted: true, evicted: [1] });
  assert.deepEqual(budget.usage(), {
    pixels: 2_992_900, bytes: 11_971_600, livePages: 1
  });

  const visibleBudget = native.createPdfNativeCanvasBudget({
    maxPixels: 32_000_000,
    maxBytes: 128_000_000,
    maxLivePages: 7,
    maxOutputScale: 2.5
  });
  const visiblePagePixels = 1200 * 1600 * 2.5 * 2.5;
  assert.deepEqual(visibleBudget.admit(4, {
    pixels: visiblePagePixels,
    bytes: visiblePagePixels * 4,
    protectedPages: [4, 5]
  }), { accepted: true, evicted: [] });
  assert.deepEqual(visibleBudget.admit(5, {
    pixels: visiblePagePixels,
    bytes: visiblePagePixels * 4,
    protectedPages: [4, 5]
  }), { accepted: true, evicted: [] });
  assert.deepEqual(visibleBudget.usage(), {
    pixels: 24_000_000, bytes: 96_000_000, livePages: 2
  });

  const reader = read('pdf-native-reader.mjs');
  assert.match(reader, /maxPixels: 64_000_000, maxBytes: 256_000_000/);
  assert.match(reader, /current, offscreen: !current/);
  assert.match(reader, /exactVisiblePages\.includes\(record\.pageNumber\)/);
  assert.match(reader, /protectedPages: \[currentPageNumber, \.\.\.exactVisiblePages\]/);
  assert.match(reader, /priority: exactVisible \? 100 : 50/);
  assert.match(reader, /const candidateCanvas = document\.createElement\('canvas'\)/);
  assert.match(reader, /previousCanvas\.replaceWith\(canvas\)/);
  assert.match(reader, /canvasBudget\.reserve\(record\.pageNumber/);
  assert.match(reader, /canvasBudget\.commit\(canvasReservation\)/);
  assert.match(reader, /canvasBudget\.rollback\(canvasReservation\)/);
});

test('native renderer publishes lifecycle identity and bridge projection/image APIs', () => {
  const reader = read('pdf-native-reader.mjs');
  assert.match(reader,
    /dispatchPageLifecycleEvent\('brevess:pdf-page-rendered', record\)/);
  assert.match(reader,
    /dispatchPageLifecycleEvent\('brevess:pdf-page-unmounted', record\)/);
  assert.match(reader,
    /pageNumber: record\.pageNumber,[\s\S]*documentHash: record\.documentHash,[\s\S]*documentGeneration: record\.documentGeneration/);
  assert.match(reader,
    /bridge\.onReady\(Object\.freeze\(\{[\s\S]*getPageProjection, readPageTextContent, renderPageImage/);
  assert.match(reader, /canvas\.toDataURL\('image\/png'\)/);
  assert.match(reader, /PDF_IMAGE_DOCUMENT_CHANGED/);
  assert.match(reader, /MAX_NATIVE_PDF_IMAGE_PIXELS\s*=\s*16_000_000/);
  assert.match(reader,
    /async function readPageTextContent\(pageNumber\)[\s\S]*await loadCurrentPageTextContent\(page, normalizedPage,[\s\S]*PDF_TEXT_DOCUMENT_CHANGED/);
  assert.match(reader,
    /async function effectivePageTextContent\(page, pageNumber\)[\s\S]*await page\.getTextContent\(\{[\s\S]*ocrTextPages\.get\(pageNumber\)/);
  assert.match(reader,
    /async function loadCurrentPageTextContent\(page, pageNumber, binding = \{\}\)[\s\S]*nativePageTextContentLoads\.get\(key\)[\s\S]*currentRecord\.textContent = textContent/);
});

test('bundled PDF.js wasm assets are configured and native links reject unsafe schemes', () => {
  const reader = read('pdf-native-reader.mjs');
  for (const filename of [
    'jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm',
    'LICENSE_JBIG2', 'LICENSE_OPENJPEG', 'LICENSE_QCMS',
    'LICENSE_PDFJS_JBIG2', 'LICENSE_PDFJS_OPENJPEG', 'LICENSE_PDFJS_QCMS',
    'openjpeg_nowasm_fallback.js'
  ]) {
    assert.equal(fs.existsSync(path.join(root, 'vendor', 'pdfjs', 'wasm', filename)), true,
      `${filename} must ship with the extension`);
  }
  assert.match(reader, /wasmUrl: chrome\.runtime\.getURL\('vendor\/pdfjs\/wasm\/'\)/);
  assert.equal(native.sanitizePdfNativeLinkUrl('https://example.org/paper'),
    'https://example.org/paper');
  assert.equal(native.sanitizePdfNativeLinkUrl('mailto:author@example.org'),
    'mailto:author@example.org');
  assert.equal(native.sanitizePdfNativeLinkUrl('javascript:alert(1)'), '');
  assert.equal(native.sanitizePdfNativeLinkUrl('file:///private/paper.pdf'), '');
  assert.match(reader, /getAnnotations\(\{ intent: 'display' \}\)/);
  assert.match(reader, /rel = 'noopener noreferrer'/);
  assert.match(reader, /\.pdf-native-automatic-hit/);
});
