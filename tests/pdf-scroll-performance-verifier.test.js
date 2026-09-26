const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const verifierPath = path.join(root, 'scripts', 'verify-pdf-scroll-performance.mjs');
const verifierUrl = pathToFileURL(verifierPath).href;

test('scroll verifier parses bounded local-PDF arguments', async () => {
  const { parseArguments } = await import(verifierUrl);
  assert.deepEqual(parseArguments([
    '--headed', '--pdf', 'paper.pdf', '--expected-pages', '40',
    '--output', 'output/run', '--target-page', '18'
  ]), {
    headed: true,
    pdf: 'paper.pdf',
    expectedPages: 40,
    output: 'output/run',
    targetPage: 18,
    deviceScaleFactor: 1,
    dprTwoPage: false
  });
  assert.throws(() => parseArguments(['--expected-pages', '0']),
    /PDF_SCROLL_INVALID_EXPECTED_PAGES/);
  assert.throws(() => parseArguments(['--wat']), /PDF_SCROLL_UNKNOWN_ARGUMENT/);
  assert.deepEqual(parseArguments([
    '--device-scale-factor', '2', '--dpr-two-page'
  ]), {
    headed: false,
    pdf: '',
    expectedPages: 23,
    output: '',
    targetPage: 12,
    deviceScaleFactor: 2,
    dprTwoPage: true
  });
  assert.throws(() => parseArguments(['--device-scale-factor', '0.5']),
    /PDF_SCROLL_INVALID_DEVICE_SCALE_FACTOR/);
});

test('scroll trace summary separates frames, long tasks, render stages, and reloads', async () => {
  const { summarizeScrollTrace } = await import(verifierUrl);
  const summary = summarizeScrollTrace({
    startedAt: 1000,
    endedAt: 1500,
    events: [
      { event: 'wheel', atMs: 1001, deltaY: 600 },
      { event: 'scroll', atMs: 1003, scrollTop: 600, firstVisible: 1 },
      { event: 'page-unmount', atMs: 1010, pageNumber: 1 },
      { event: 'render-queued', atMs: 1020, pageNumber: 3, queueActive: 2, queuePending: 1 },
      { event: 'render-start', atMs: 1040, pageNumber: 3 },
      { event: 'text-layer-complete', atMs: 1060, pageNumber: 3, durationMs: 20 },
      { event: 'pdfjs-render-complete', atMs: 1100, pageNumber: 3, durationMs: 40,
        canvasWidth: 1800, canvasHeight: 2400 },
      { event: 'page-rendered', atMs: 1110, pageNumber: 3 },
      { event: 'page-unmount', atMs: 1200, pageNumber: 3 },
      { event: 'render-queued', atMs: 1250, pageNumber: 3, queueActive: 0, queuePending: 0 },
      { event: 'render-start', atMs: 1260, pageNumber: 3 },
      { event: 'pdfjs-render-complete', atMs: 1320, pageNumber: 3, durationMs: 60,
        canvasWidth: 1800, canvasHeight: 2400 },
      { event: 'page-rendered', atMs: 1330, pageNumber: 3 },
      { event: 'window-complete', atMs: 1340, durationMs: 80 }
    ],
    frameGaps: [16, 17, 75, 140, 20],
    longTasks: [{ atMs: 1050, durationMs: 70 }, { atMs: 1260, durationMs: 55 }]
  });
  assert.equal(summary.elapsedMs, 500);
  assert.deepEqual(summary.frames, {
    samples: 5, p95GapMs: 140, maxGapMs: 140, gapsOver50Ms: 2, gapsOver100Ms: 1
  });
  assert.deepEqual(summary.longTasks, { count: 2, totalMs: 125, maxMs: 70 });
  assert.equal(summary.input.wheelEvents, 1);
  assert.equal(summary.input.scrollEvents, 1);
  assert.equal(summary.render.renderCount, 2);
  assert.equal(summary.render.repeatedRenderPages, 1);
  assert.equal(summary.render.maxQueueWaitMs, 20);
  assert.equal(summary.render.maxPdfJsPaintMs, 60);
  assert.equal(summary.render.maxCanvasPixels, 4_320_000);
  assert.equal(summary.lifecycle.unmountCount, 2);
  assert.equal(summary.lifecycle.reloadCount, 1);
  assert.equal(summary.lifecycle.maxUnmountToRenderedMs, 130);
  assert.equal(summary.window.maxUpdateMs, 80);
});

test('temporary reader instrumentation covers each expensive scroll stage without editing source', async () => {
  const { instrumentNativeReaderSource } = await import(verifierUrl);
  const original = fs.readFileSync(path.join(root, 'pdf-native-reader.mjs'), 'utf8');
  const instrumented = instrumentNativeReaderSource(original);
  for (const marker of [
    "__pdfScrollPerf('page-unmount'",
    "__pdfScrollPerf('canvas-release'",
    "__pdfScrollPerf('text-content-start'",
    "__pdfScrollPerf('semantic-inspect-complete'",
    "__pdfScrollPerf('text-layer-complete'",
    "__pdfScrollPerf('render-queued'",
    "__pdfScrollPerf('pdfjs-render-complete'",
    "__pdfScrollPerf('window-complete'",
    "__pdfScrollPerf('scale-apply'",
    "__pdfScrollPerf('reader-scroll'"
  ]) assert.match(instrumented, new RegExp(marker.replace(/[()'.-]/g, '\\$&')));
  assert.equal(fs.readFileSync(path.join(root, 'pdf-native-reader.mjs'), 'utf8'), original);
});

test('verifier is zero-API, uses real wheel input, compares fit-width and 197 percent', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  assert.match(source, /context\.route\(\/\^https\?:\\\/\\\//);
  assert.match(source, /PDF_SCROLL_API_REQUEST_DETECTED/);
  assert.match(source, /mouse\.wheel/);
  assert.match(source, /fitWidth/);
  assert.match(source, /setScale', 1\.97/);
  assert.match(source, /downwardFirstPass/);
  assert.match(source, /upwardReturnPass/);
  assert.doesNotMatch(source, /chat\/completions.*fetch|saved.*response.*replay/iu);
});

test('clarity assertion requires a resident, ink-bearing full-resolution canvas', async () => {
  const { assertClearCanvas, assertTwoVisibleClearCanvases } = await import(verifierUrl);
  assert.equal(assertClearCanvas({ canvasWidth: 1600, canvasHeight: 2200,
    cssWidth: 800, cssHeight: 1100, inkPixels: 1200 }), true);
  assert.throws(() => assertClearCanvas({ canvasWidth: 0, canvasHeight: 0,
    cssWidth: 800, cssHeight: 1100, inkPixels: 0 }), /PDF_SCROLL_CANVAS_MISSING/);
  assert.throws(() => assertClearCanvas({ canvasWidth: 500, canvasHeight: 700,
    cssWidth: 800, cssHeight: 1100, inkPixels: 1200 }), /PDF_SCROLL_CANVAS_LOW_RESOLUTION/);
  const pages = [2, 3].map(pageNumber => ({
    pageNumber, overlapPixels: 420, canvasWidth: 1224, canvasHeight: 1584,
    cssWidth: 612, cssHeight: 792, inkPixels: 900, backingScaleX: 2,
    backingScaleY: 2, budgetReducedBelowRequestedDpr: false, canvasResident: true
  }));
  assert.equal(assertTwoVisibleClearCanvases(pages, 2), true);
  assert.throws(() => assertTwoVisibleClearCanvases([
    pages[0], { ...pages[1], backingScaleX: 1, budgetReducedBelowRequestedDpr: true }
  ], 2), /PDF_SCROLL_VISIBLE_PAGE_DPR_REDUCED/);
  assert.throws(() => assertTwoVisibleClearCanvases([pages[0]], 2),
    /PDF_SCROLL_TWO_VISIBLE_PAGES_REQUIRED/);
});

test('DPR2 mode checks two exact-visible resident canvases and cancelled upgrades', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  assert.match(source, /deviceScaleFactor: parsed\.deviceScaleFactor/);
  assert.match(source, /visibleCanvasSamples/);
  assert.match(source, /__brevessPdfScrollPerfCancelUpgrade/);
  assert.match(source, /preservedAfterCancellation/);
  assert.match(source, /record\.outputScale = previousOutputScale/);
  assert.match(source, /restoredOutputScale: record\.outputScale/);
  assert.match(source, /01-dpr2-two-visible-pages\.png/);
});
