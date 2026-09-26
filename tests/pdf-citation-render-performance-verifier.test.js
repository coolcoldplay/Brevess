const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const verifierUrl = pathToFileURL(path.join(
  root, 'scripts', 'verify-pdf-citation-render-performance.mjs')).href;

test('performance verifier instruments only the isolated reader copy at stable phase boundaries', async () => {
  const verifier = await import(verifierUrl);
  const original = fs.readFileSync(path.join(root, 'pdf-native-reader.mjs'), 'utf8');
  const instrumented = verifier.instrumentNativeReaderSource(original);
  assert.notEqual(instrumented, original);
  for (const marker of [
    "__pdfPerf('render-queued'",
    "__pdfPerf('render-start'",
    "__pdfPerf('text-layer-ready'",
    "__pdfPerf('pdfjs-render-start'",
    "__pdfPerf('pdfjs-task-created'",
    "__pdfPerf('pdfjs-continuation'",
    "__pdfPerf('pdfjs-raf-probe'",
    "__pdfPerf('pdfjs-sync-start'",
    "__pdfPerf('pdfjs-sync-end'",
    "__pdfPerf('pdfjs-render-complete'",
    "__pdfPerf('page-rendered'",
    "__pdfPerf('overlay-applied'"
  ]) assert.match(instrumented, new RegExp(marker.replace(/[()'.-]/g, '\\$&')));
  assert.equal(instrumented.match(/__pdfPerf\('page-rendered'/g)?.length, 1);
  assert.match(instrumented,
    /dispatchPageLifecycleEvent\('brevess:pdf-page-rendered', record\);\n\s+__pdfPerf\('page-rendered'/);
  assert.equal(fs.readFileSync(path.join(root, 'pdf-native-reader.mjs'), 'utf8'), original);
});

test('cross-page attribution maps a Long Task to the overlapping PDF.js page segment', async () => {
  const { summarizeCrossPageRenderAttribution } = await import(verifierUrl);
  const summary = summarizeCrossPageRenderAttribution([
    { event: 'pdfjs-sync-end', pageNumber: 3, taskId: 1, syncSequence: 1,
      startedAtMs: 1010, atMs: 1030, durationMs: 20,
      operatorIndexBefore: 0, operatorIndexAfter: 30 },
    { event: 'pdfjs-sync-end', pageNumber: 4, taskId: 2, syncSequence: 1,
      startedAtMs: 1040, atMs: 1340, durationMs: 300,
      operatorIndexBefore: 0, operatorIndexAfter: 5 }
  ], [{ atMs: 1041, durationMs: 298 }], 1000, 1400);
  assert.deepEqual(summary.pages, [
    { pageNumber: 3, taskCount: 1, segmentCount: 1, totalSyncMs: 20,
      maxSyncMs: 20, operatorAdvance: 30 },
    { pageNumber: 4, taskCount: 1, segmentCount: 1, totalSyncMs: 300,
      maxSyncMs: 300, operatorAdvance: 5 }
  ]);
  assert.equal(summary.longestLongTaskAttributedPage, 4);
  assert.equal(summary.longTasks[0].attributedPage, 4);
  assert.equal(summary.longTasks[0].attributedOverlapMs, 298);
});

test('PDF.js scheduler summary separates first readiness, rAF wait, and post-frame work', async () => {
  const { summarizePdfJsSchedulerTrace } = await import(verifierUrl);
  const summary = summarizePdfJsSchedulerTrace([
    { event: 'pdfjs-task-created', pageNumber: 3, atMs: 1000, operatorCount: 0 },
    { event: 'pdfjs-continuation', pageNumber: 3, atMs: 1100, sequence: 1,
      operatorIndex: 0, operatorCount: 40, lastChunk: false },
    { event: 'pdfjs-raf-probe', pageNumber: 3, atMs: 1116, sequence: 1, waitMs: 16 },
    { event: 'pdfjs-continuation', pageNumber: 3, atMs: 1124, sequence: 2,
      operatorIndex: 25, operatorCount: 55, lastChunk: true },
    { event: 'pdfjs-raf-probe', pageNumber: 3, atMs: 1140, sequence: 2, waitMs: 16 },
    { event: 'pdfjs-render-complete', pageNumber: 3, atMs: 1150 }
  ], 3, 990, 1160);
  assert.deepEqual(summary, {
    taskCreatedAt: 1000,
    taskCreateToFirstContinuationMs: 100,
    continuationCount: 2,
    rafProbeCount: 2,
    totalRafWaitMs: 32,
    maxRafWaitMs: 16,
    totalPostRafWorkMs: 18,
    maxPostRafWorkMs: 10,
    maxContinuationGapMs: 24,
    initialOperatorCount: 0,
    finalOperatorCount: 55,
    finalOperatorIndex: 25,
    lastChunkAtFinalContinuation: true
  });
});

test('trace summary separates queue, PDF.js paint, overlay, and verifier observation', async () => {
  const { summarizeRenderTrace } = await import(verifierUrl);
  const summary = summarizeRenderTrace([
    { event: 'overlay-applied', pageNumber: 18, atMs: 1010 },
    { event: 'render-queued', pageNumber: 18, atMs: 1012 },
    { event: 'render-start', pageNumber: 18, atMs: 1017 },
    { event: 'text-layer-ready', pageNumber: 18, atMs: 1020 },
    { event: 'pdfjs-render-start', pageNumber: 18, atMs: 1022 },
    { event: 'pdfjs-render-complete', pageNumber: 18, atMs: 1062 },
    { event: 'page-rendered', pageNumber: 18, atMs: 1065 },
    { event: 'page-rendered', pageNumber: 3, atMs: 2000 }
  ], 18, 1000, 1071);
  assert.deepEqual(summary, {
    eventCount: 7,
    focusToOverlayMs: 10,
    queueWaitMs: 5,
    textLayerMs: 3,
    pdfJsDecodePaintMs: 40,
    postPdfJsCommitMs: 3,
    focusToPageRenderedMs: 65,
    verifierObservationLagMs: 6,
    milestones: { queued: 1012, renderStart: 1017, pdfStart: 1022,
      pdfComplete: 1062, pageRendered: 1065, overlayApplied: 1010 }
  });
});

test('report redaction rejects source text, locations, and remote addresses', async () => {
  const { assertRedactedReport, parseArguments } = await import(verifierUrl);
  assert.deepEqual(parseArguments(['--headed', '--citation-only', '--output', 'out']), {
    headed: true, citationOnly: true, output: 'out', pdf: ''
  });
  assert.equal(assertRedactedReport({ status: 'PASS', metrics: { elapsedMs: 12 } }), true);
  assert.throws(() => assertRedactedReport({ quote: 'source text' }),
    /PDF_PERF_REPORT_FORBIDDEN_KEY_quote/);
  assert.throws(() => assertRedactedReport({ location: 'https://example.test/paper.pdf' }),
    /PDF_PERF_REPORT_LOCATION_OR_SECRET_LEAK/);
});

test('verifier pins the 23-page public PDF and blocks every network request', () => {
  const source = fs.readFileSync(path.join(
    root, 'scripts', 'verify-pdf-citation-render-performance.mjs'), 'utf8');
  assert.match(source, /EXPECTED_PAGE_COUNT = 23/);
  assert.match(source, /6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1/);
  assert.match(source, /context\.route\(\/\^https\?:\\\/\\\//);
  assert.match(source, /PDF_PERF_API_REQUEST_DETECTED/);
  assert.doesNotMatch(source, /chat\/completions.*fetch|saved.*response.*replay/iu);
});

test('representative citation selects a bounded Results body sentence instead of a short header', () => {
  const source = fs.readFileSync(path.join(
    root, 'scripts', 'verify-pdf-citation-render-performance.mjs'), 'utf8');
  assert.match(source, /request\.pageNumber === 3/);
  assert.match(source, /expectedNormalizedQuote\.length >= 400/);
  assert.match(source, /Intl\.Segmenter\('en', \{ granularity: 'sentence' \}\)/);
  assert.match(source, /segment\.text\.length >= 80 && segment\.text\.length <= 400/);
  assert.match(source, /left\.request\.ranges\[0\]\?\.start/);
  assert.match(source, /citationGranularity: 'sentence', citationBodyLike: true/);
  assert.match(source, /citationQuoteHash/);
  assert.match(source, /if \(!parsed\.citationOnly\)/);
});
