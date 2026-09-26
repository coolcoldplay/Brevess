const test = require('node:test');
const assert = require('node:assert/strict');

test('canonical page verifier exposes the P2-B0 acceptance function', async () => {
  let verifier = {};
  try {
    verifier = await import('../scripts/verify-pdf-canonical-pages.mjs');
  } catch { /* RED begins before the verifier exists. */ }
  assert.equal(typeof verifier.assessCanonicalPageAcceptance, 'function');
});

test('P2-B0 acceptance requires three real PDFs, exact offsets, geometry truth and zero external work', async () => {
  const { assessCanonicalPageAcceptance } = await import(
    '../scripts/verify-pdf-canonical-pages.mjs');
  const result = assessCanonicalPageAcceptance({
    sampleCount: 3, pageAudits: 30, offsetErrors: 0, overlapErrors: 0,
    boundsErrors: 0, bindingErrors: 0, adapterErrors: 0,
    positionedSpans: 1200, fallbackSpans: 40,
    rotationsCovered: 4, syntheticMixedGeometryPassed: true,
    syntheticBlankPagePassed: true, stableRecords: true,
    apiCalls: 0, ocrCalls: 0, externalRequests: 0,
    absolutePathLeaks: 0, rawTextLeaks: 0, persistentCacheUsed: false
  });
  assert.equal(result.pass, true);
  assert.equal(Object.values(result.checks).every(Boolean), true);
});

test('P2-B0 acceptance rejects fake geometry, stale binding, privacy leaks and cache claims', async () => {
  const { assessCanonicalPageAcceptance } = await import(
    '../scripts/verify-pdf-canonical-pages.mjs');
  const result = assessCanonicalPageAcceptance({
    sampleCount: 2, pageAudits: 2, offsetErrors: 1, overlapErrors: 1,
    boundsErrors: 1, bindingErrors: 1, adapterErrors: 1,
    positionedSpans: 0, fallbackSpans: 0,
    rotationsCovered: 1, syntheticMixedGeometryPassed: false,
    syntheticBlankPagePassed: false, stableRecords: false,
    apiCalls: 1, ocrCalls: 1, externalRequests: 1,
    absolutePathLeaks: 1, rawTextLeaks: 1, persistentCacheUsed: true
  });
  assert.equal(result.pass, false);
  assert.equal(result.checks.realCorpus, false);
  assert.equal(result.checks.exactOffsets, false);
  assert.equal(result.checks.truthfulGeometry, false);
  assert.equal(result.checks.privateAndOffline, false);
  assert.equal(result.checks.noCacheClaim, false);
});

test('page summaries contain counts and digests but never source text or path fields', async () => {
  const { summarizeCanonicalPageRecord } = await import(
    '../scripts/verify-pdf-canonical-pages.mjs');
  const summary = summarizeCanonicalPageRecord({
    pageNumber: 2, text: 'Private sentence.', contentHash: 'deadbeef',
    spans: [{ start: 0, end: 17, rawStart: 0, rawEnd: 17,
      text: 'Private sentence.', geometryStatus: 'fallback' }],
    coverage: { spanCount: 1, positionedSpanCount: 0, fallbackSpanCount: 1,
      droppedItemCount: 0, positionedPercent: 0, textStatus: 'full' }
  });
  assert.deepEqual(Object.keys(summary).sort(), [
    'contentSummarySha256', 'coverage', 'pageNumber', 'textBytes'
  ]);
  assert.equal(JSON.stringify(summary).includes('Private sentence'), false);
  assert.equal(summary.coverage.fallbackSpanCount, 1);
});

test('semantic adapter audit permits P2-A to exclude heading spans while validating emitted ranges', async () => {
  const { canonicalRecordsAcceptedBySemanticIndex } = await import(
    '../scripts/verify-pdf-canonical-pages.mjs');
  const hash = 'a'.repeat(64);
  const record = {
    pageNumber: 1, text: '1 Results\nObserved effect.', pageWidth: 500, pageHeight: 700,
    spans: [
      { text: '1 Results', start: 0, end: 9, rawStart: 0, rawEnd: 9,
        fontSize: 16, bold: true, rect: { left: 50, top: 50, right: 150, bottom: 68 } },
      { text: 'Observed effect.', start: 10, end: 26, rawStart: 10, rawEnd: 26,
        fontSize: 10, rect: { left: 50, top: 90, right: 180, bottom: 102 } }
    ]
  };
  assert.equal(canonicalRecordsAcceptedBySemanticIndex([record], hash, 1), true);
});
