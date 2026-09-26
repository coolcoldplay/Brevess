const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const helperModule = import('../scripts/pdf-selection-evidence-helper.mjs');

test('selection evidence diagnostics require semantic global spans and raw page anchors', async () => {
  const { assertPreparedNativePdfSelectionEvidenceDiagnostics } = await helperModule;
  const passing = {
    segmentCount: 2,
    semanticLocatorCount: 2,
    selectionShapeCount: 2,
    globalQuoteSpanCount: 2,
    resolvedRawRangeCount: 2,
    pageAnchorMatchesRawCount: 2
  };
  assert.equal(assertPreparedNativePdfSelectionEvidenceDiagnostics(passing), true);
  assert.throws(() => assertPreparedNativePdfSelectionEvidenceDiagnostics({
    ...passing, globalQuoteSpanCount: 1
  }), /PDF_SELECTION_GLOBAL_QUOTE_SPAN_INVALID/u);
  assert.throws(() => assertPreparedNativePdfSelectionEvidenceDiagnostics({
    ...passing, pageAnchorMatchesRawCount: 1
  }), /PDF_SELECTION_PAGE_ANCHOR_NOT_RAW_FIRST_PAGE/u);
  assert.throws(() => assertPreparedNativePdfSelectionEvidenceDiagnostics({
    ...passing, selectionShapeCount: 1
  }), /PDF_SELECTION_SEMANTIC_IDENTITY_MISMATCH/u);
});

test('selection helper upgrades through production wiring and resolves raw ranges[0]', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts',
    'pdf-selection-evidence-helper.mjs'), 'utf8');
  assert.match(source, /upgradePreparedPdfSelectionEvidence\(prepared\)/u);
  assert.match(source, /native\.resolveSemanticHighlight\(locator\)/u);
  assert.match(source, /ranges\[0\]\?\.pageNumber/u);
  assert.match(source, /targetText\.slice\(relativeStart, relativeEnd\) === quote/u);
  assert.match(source, /String\(segment\?\.text \|\| ''\) === quote/u);
  assert.match(source, /pageAnchorMatchesRawCount/u);
});
