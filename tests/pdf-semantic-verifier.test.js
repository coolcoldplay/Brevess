const test = require('node:test');
const assert = require('node:assert/strict');

test('semantic verifier acceptance requires real corpus counts, exact audits, and zero API/OCR', async () => {
  const { assessPdfSemanticAcceptance } = await import(
    '../scripts/verify-pdf-semantic-index.mjs');
  const observation = {
    sampleCount: 3, includesTwoColumn: true,
    sentenceAudits: 45, sentenceCorrect: 45, sentenceErrors: 0,
    headingAudits: 30, headingCorrect: 27, headingErrors: 0, headingDegraded: 3,
    stableCacheKeys: true, stableStructure: true,
    fixedRealOracleMatched: true, syntheticOraclePassed: true,
    outlineTargetsChecked: 2, outlineTargetErrors: 0,
    headingLevelsChecked: 10, headingLevelErrors: 0,
    parentHierarchyChecked: 10, parentHierarchyErrors: 0,
    sectionRangesChecked: 10, sectionRangeErrors: 0,
    apiCalls: 0, ocrCalls: 0, absolutePathLeaks: 0, rawTextLeaks: 0
  };
  const result = assessPdfSemanticAcceptance(observation);
  assert.equal(result.pass, true);
  assert.equal(Object.values(result.checks).every(Boolean), true);
});

test('semantic verifier acceptance rejects insufficient or privacy-leaking evidence', async () => {
  const { assessPdfSemanticAcceptance } = await import(
    '../scripts/verify-pdf-semantic-index.mjs');
  const result = assessPdfSemanticAcceptance({
    sampleCount: 2, includesTwoColumn: false,
    sentenceAudits: 39, sentenceCorrect: 39, sentenceErrors: 0,
    headingAudits: 24, headingCorrect: 24, headingErrors: 0, headingDegraded: 0,
    stableCacheKeys: true, stableStructure: true,
    fixedRealOracleMatched: false, syntheticOraclePassed: false,
    outlineTargetsChecked: 0, outlineTargetErrors: 0,
    headingLevelsChecked: 0, headingLevelErrors: 0,
    parentHierarchyChecked: 0, parentHierarchyErrors: 0,
    sectionRangesChecked: 0, sectionRangeErrors: 0,
    apiCalls: 0, ocrCalls: 0, absolutePathLeaks: 1, rawTextLeaks: 1
  });
  assert.equal(result.pass, false);
  assert.equal(result.checks.threeRealNativeTextPdfs, false);
  assert.equal(result.checks.privateReport, false);
  assert.equal(result.checks.independentOracles, false);
  assert.equal(result.checks.headingAuditDimensions, false);
});

test('PDF item geometry recovers zero declared height from the explicit transform', async () => {
  const { pdfTextItemGeometry } = await import('../scripts/verify-pdf-semantic-index.mjs');
  const geometry = pdfTextItemGeometry({ width: 24, height: 0,
    transform: [12, 0, 0, 12, 50, 700] }, [0, 0, 600, 800]);
  assert.deepEqual(geometry, {
    rect: { left: 50, top: 88, right: 74, bottom: 100 },
    source: 'matrix-derived-height'
  });
});

test('geometry provenance separates source absence from range mapping loss', async () => {
  const { summarizeGeometryProvenance } = await import(
    '../scripts/verify-pdf-semantic-index.mjs');
  const pages = [{ pageNumber: 1, spans: [
    { start: 0, end: 5, rect: { left: 0, top: 0, right: 5, bottom: 5 },
      geometrySource: 'native-item-height' },
    { start: 6, end: 10, rect: { left: 6, top: 0, right: 10, bottom: 5 },
      geometrySource: 'matrix-derived-height' },
    { start: 11, end: 15, geometrySource: 'source-unavailable' }
  ] }];
  const index = { spans: [
    { pageNumber: 1, start: 0, end: 5, geometry: { kind: 'rect' } },
    { pageNumber: 1, start: 6, end: 10, geometry: { kind: 'rect' } },
    { pageNumber: 1, start: 11, end: 15,
      geometry: { kind: 'page-paragraph-fallback' } },
    { pageNumber: 1, start: 20, end: 25,
      geometry: { kind: 'page-paragraph-fallback' } }
  ] };
  assert.deepEqual(summarizeGeometryProvenance(index, pages), {
    totalIndexSpans: 4,
    positionedNativeItemHeight: 1,
    positionedMatrixDerivedHeight: 1,
    fallbackSourceUnavailable: 1,
    fallbackRangeUnmatched: 1,
    fallbackAlgorithmDroppedGeometry: 0,
    fallbackTotal: 2,
    fallbackPercent: 50,
    sourceUnavailablePercent: 25,
    rangeUnmatchedPercent: 25
  });
});

test('native outline flattening preserves actual nesting depth', async () => {
  const { flattenNativeOutline } = await import('../scripts/verify-pdf-semantic-index.mjs');
  const flat = flattenNativeOutline([{ title: 'A', items: [
    { title: 'B', items: [{ title: 'C' }] }
  ] }]);
  assert.deepEqual(flat.map(item => [item.title, item.level]), [
    ['A', 1], ['B', 2], ['C', 3]
  ]);
});

test('native outline destination y is converted to viewport top', async () => {
  const { outlineTargetTop } = await import('../scripts/verify-pdf-semantic-index.mjs');
  const viewport = { convertToViewportPoint: (x, y) => [x + 2, 800 - y] };
  assert.equal(outlineTargetTop([{}, { name: 'XYZ' }, null, 650, null], viewport), 150);
  assert.equal(outlineTargetTop([{}, { name: 'Fit' }], viewport), null);
});

test('layered fixed synthetic oracle covers scientific boundaries, offsets, geometry, and heading negatives', async () => {
  const { runLayeredSyntheticOracle } = await import(
    '../scripts/verify-pdf-semantic-index.mjs');
  const result = runLayeredSyntheticOracle();
  assert.equal(result.pass, true);
  assert.deepEqual(result.sentenceLayers.sort(), [
    'abbreviations-decimals-identifiers', 'cross-page-uppercase', 'repeated-position'
  ]);
  assert.deepEqual(result.mappingLayers.sort(), [
    'combining-hangul-ligature-surrogate-whitespace-dehyphenation'
  ]);
  assert.deepEqual(result.geometryLayers.sort(), [
    'enclosing', 'exact', 'fallback', 'mixed'
  ]);
  assert.deepEqual(result.headingQuota, {
    positive: 1, caption: 1, reference: 1, formula: 1, table: 1, body: 1
  });
});

test('frozen corpus oracle is stratified and carries independent negative and hierarchy expectations', async () => {
  const { getFrozenCorpusOracleManifest } = await import(
    '../scripts/verify-pdf-semantic-index.mjs');
  const oracle = getFrozenCorpusOracleManifest();
  assert.equal(oracle.sentenceLocations.length >= 40, true);
  for (const sampleId of ['P2-T02', 'P2-T04', 'P2-T08']) {
    const entries = oracle.sentenceLocations.filter(item => item.sampleId === sampleId);
    const pages = new Set(entries.flatMap(item => item.ranges.map(range => range.pageNumber)));
    assert.equal(pages.size >= 3, true);
    assert.equal(Math.min(...pages) <= 2, true);
    assert.equal(Math.max(...pages) >= 8, true);
  }
  const quotas = Object.fromEntries(['caption', 'reference', 'formula', 'table', 'body']
    .map(kind => [kind, oracle.headingNegatives.filter(item => item.kind === kind).length]));
  assert.equal(Object.values(quotas).every(count => count >= 2), true);
  assert.equal(oracle.headingPositives.length >= 10, true);
  assert.equal(oracle.headingPositives.every(item => Number.isInteger(item.expectedLevel) &&
    item.expectedParentHeadingLocator !== undefined && item.expectedSectionEnd), true);
});
