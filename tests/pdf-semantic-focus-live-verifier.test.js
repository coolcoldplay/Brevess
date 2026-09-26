const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const verifierPath = path.join(__dirname, '..', 'scripts',
  'verify-pdf-semantic-focus-live.mjs');
const verifierModule = import('../scripts/verify-pdf-semantic-focus-live.mjs');

test('B3 live focus verifier fixes the public PDF identity and recursively flattens navigation',
  async () => {
    const verifier = await verifierModule;
    assert.equal(verifier.EXPECTED_PDF_SHA256,
      '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1');
    assert.equal(verifier.EXPECTED_PAGE_COUNT, 23);
    const first = { paragraphId: 'a' };
    const second = { paragraphId: 'b' };
    const third = { paragraphId: 'c' };
    assert.deepEqual(verifier.flattenSemanticParagraphTargets({ sections: [{
      paragraphTargets: [first], children: [{ paragraphTargets: [second],
        children: [{ paragraphTargets: [third], children: [] }] }]
    }] }), [first, second, third]);
  });

test('B3 live focus verifier exposes only stable observable focus fields', async () => {
  const { safeFocusResult, stableFailureCode } = await verifierModule;
  assert.deepEqual(safeFocusResult({
    focused: true, focusedGranularity: 'sentence', precision: 'exact-raw',
    reasonCode: 'PDF_FOCUS_PAGE_ONLY', pageNumber: 17,
    normalizedStart: 12, expectedNormalizedQuote: 'private body'
  }), {
    focused: true, focusedGranularity: 'sentence', precision: 'exact-raw',
    reasonCode: 'PDF_FOCUS_PAGE_ONLY', pageNumber: 17
  });
  assert.deepEqual(safeFocusResult({
    focused: false, focusedGranularity: 'invented', precision: 'invented',
    reasonCode: 'private detail', pageNumber: -1
  }), {
    focused: false, focusedGranularity: 'none', precision: 'none',
    reasonCode: '', pageNumber: null
  });
  assert.equal(stableFailureCode(new Error(
    'B3_CONTENT_WORKSPACE_READ_FAILED\nfalse !== true')),
  'B3_CONTENT_WORKSPACE_READ_FAILED');
  assert.equal(stableFailureCode(new Error('ordinary failure')),
    'B3_LIVE_UNCLASSIFIED_FAILURE');
});

test('B3 live focus verifier requires distinct request pages and overlay on each page', async () => {
  const { assertMultiPageOverlayCoverage } = await verifierModule;
  assert.equal(assertMultiPageOverlayCoverage([15, 16], [16, 15]), true);
  assert.throws(() => assertMultiPageOverlayCoverage([15, 15], [15]),
    /B3_MULTI_PAGE_TARGET_UNAVAILABLE/u);
  assert.throws(() => assertMultiPageOverlayCoverage([15, 16], [15]),
    /B3_MULTI_PAGE_OVERLAY_INCOMPLETE/u);
});

test('B3 live focus verifier report guard rejects body-bearing focus internals and locations',
  async () => {
    const { assertRedactedReport } = await verifierModule;
    assert.equal(assertRedactedReport({
      source: { pdfSha256: 'a'.repeat(64), pageCount: 23 },
      network: { httpRequests: 0, apiRequests: 0 },
      result: { precision: 'page-only', reasonCode: 'PDF_FOCUS_PAGE_ONLY',
        pageNumber: 9, overlayRectCount: 2 }
    }), true);
    assert.throws(() => assertRedactedReport({ normalizedStart: 12 }),
      /B3_REPORT_FORBIDDEN_KEY_normalizedStart/);
    assert.throws(() => assertRedactedReport({ quote: 'private body' }),
      /B3_REPORT_FORBIDDEN_KEY_quote/);
    assert.throws(() => assertRedactedReport({ source: 'https:\/\/signed.invalid?a=1' }),
      /B3_REPORT_LOCATION_OR_SIGNATURE_LEAK/);
  });

test('B3 live focus verifier uses only public targets and covers exact, replacement, and legacy races',
  () => {
    const source = fs.readFileSync(verifierPath, 'utf8');
    assert.match(source,
      /__brevessNativePdfDocument(?:\?\.)?\.focusSemanticTarget(?:\?\.)?\(\s*structuredClone\(target\)\)/);
    assert.match(source, /getSemanticNavigation\?\.\(\)/);
    assert.match(source, /createNativeFocusRequest/);
    assert.match(source, /request\?\.mode === 'page-only'/);
    assert.match(source, /PDF_FOCUS_PAGE_ONLY_SAMPLE_UNAVAILABLE/);
    assert.match(source,
      /const pending = globalThis\.__brevessNativePdfDocument\.focusSemanticTarget\(/);
    assert.doesNotMatch(source,
      /__brevessPdfReaderBridge(?:\?\.)?\.command\(\s*'focusSemanticTarget'/);
    assert.match(source,
      /const replacing = globalThis\.__brevessPdfReaderBridge\.command\('replaceDocument'\)/);
    assert.match(source, /reasonCode, 'PDF_FOCUS_STALE'/);
    assert.match(source, /raceScrollCount, 0/);
    assert.match(source, /legacyInitialFocused, false/);
    assert.match(source, /B3_DEFERRED_LEGACY_OVERRODE_SEMANTIC/);
    assert.match(source, /context\.route\(\/\^https\?:\\\/\\\//);
    assert.doesNotMatch(source, /pdfSemanticResultToNativeFocusRequest/);
  });

test('B3 live focus verifier exercises the real side-panel semantic tree and transient contract',
  () => {
    const source = fs.readFileSync(verifierPath, 'utf8');
    assert.match(source, /stage = 'SIDEBAR_NAVIGATION'/);
    assert.match(source, /chrome-extension:\/\/\$\{extensionId\}\/popup\.html/);
    assert.match(source, /synchronizeActiveTabContext\(\{ force: true \}\)/);
    assert.match(source, /refreshArticleWorkspace\(\{[\s\S]*?announce: true/);
    assert.match(source, /data-pdf-semantic-focus="paragraph"/);
    assert.match(source, /__b3SidebarPendingObserved/);
    assert.match(source, /B3_SIDEBAR_FOCUS_STATUS_NOT_PRECISE/);
    assert.match(source, /B3_SEMANTIC_DATA_ENTERED_SNAPSHOT/);
    assert.match(source, /B3_SIDEBAR_TARGET_OVERLAY_EMPTY/);
    assert.match(source,
      /new Set\(item\.request\.ranges\.map\(range => range\.pageNumber\)\)\.size >= 2/u);
    const immediateCapture = source.indexOf(
      'const immediateFocus = captureFocusLayers(focusReturnedAt - focusStartedAt)');
    const firstWindowUpdate = source.indexOf('for (const pageNumber of requestPages)',
      immediateCapture);
    const afterWindowCapture = source.indexOf(
      'const afterWindowFocus = captureFocusLayers(performance.now() - focusStartedAt)',
      firstWindowUpdate);
    assert.ok(immediateCapture > 0 && firstWindowUpdate > immediateCapture &&
      afterWindowCapture > firstWindowUpdate,
    'focus overlays must be captured once before and once after page-window updates');
    assert.match(source, /immediateFocus\.placeholderCount/u);
    assert.match(source, /immediateFocus\.layerPageNumbers/u);
    assert.match(source, /immediateFocus\.hitPageNumbers/u);
    assert.match(source, /immediateFocus\.overlayPageNumbers/u);
    assert.match(source, /afterWindowFocus\.placeholderCount/u);
    assert.match(source, /afterWindowFocus\.layerPageNumbers/u);
    assert.match(source, /afterWindowFocus\.hitPageNumbers/u);
    assert.match(source, /afterWindowFocus\.overlayPageNumbers/u);
    assert.match(source, /elapsedMs: Math\.max\(0, Math\.round\(elapsedMs\)\)/u);
    assert.match(source, /immediateFocus: exact\.immediateFocus/u);
    assert.match(source, /afterWindowFocus: exact\.afterWindowFocus/u);
    assert.match(source, /B3_IMMEDIATE_FOCUS_OVERLAY_INCOMPLETE/u);
    assert.match(source, /B3_AFTER_WINDOW_FOCUS_OVERLAY_INCOMPLETE/u);
    assert.match(source, /assertMultiPageOverlayCoverage\(exact\.requestPageNumbers/u);
    assert.match(source, /B3_MULTI_PAGE_PROJECTED_RECTS_MISSING/u);
    assert.match(source, /item\.target\.paragraphId !== far\.target\.paragraphId/u);
    assert.match(source, /globalThis\.__b3SidebarTarget/u);
    assert.match(source, /B3_SIDEBAR_TARGET_REUSED_EXACT_TARGET/u);
    assert.match(source, /sidebarFocusReset/u);
    assert.match(source, /\{ layerCount: 0, hitCount: 0 \}/u);
    assert.match(source, /B3_SIDEBAR_PRECLICK_FOCUS_NOT_CLEARED/u);
    assert.match(source,
      /pdf-native-semantic-focus-layer \.pdf-native-semantic-focus-hit/u);
    assert.match(source, /assertMultiPageOverlayCoverage\(selected\.sidebarPageNumbers/u);
    assert.match(source, /B3_SIDEBAR_MULTI_PAGE_OVERLAY_INCOMPLETE/u);
  });
