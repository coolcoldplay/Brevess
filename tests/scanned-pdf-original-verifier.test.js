const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const verifierPath = path.join(root, 'scripts', 'verify-scanned-pdf-original.mjs');
const verifier = fs.readFileSync(verifierPath, 'utf8');

test('scanned-PDF acceptance decision fails closed for each required observation', async () => {
  const { assessScannedPdfOriginal } = await import(pathToFileURL(verifierPath).href);
  const passing = {
    sourceHash: 'abc', expectedHash: 'abc', pageCount: 4, phase: 'partial-index',
    retainedPages: 0, paragraphCount: 0, firstPageTextCharacters: 0,
    statusTitle: '需要文字识别',
    firstPageNonWhitePixels: 120, firstPageLuminanceSpread: 200,
    enhancementPromptVisible: true, enhancementButtonVisible: true,
    enhancementClickCount: 0, pageTwoVisible: true, currentPage: 2,
    zoomBefore: 100, zoomAfter: 125, pageWidthBeforeZoom: 600,
    pageWidthAfterZoom: 750, reloadHash: 'abc', reloadPhase: 'partial-index',
    reloadPageCount: 4, reloadPageNonWhitePixels: 110, sourceHashAfter: 'abc',
    externalRequests: 0, apiRequests: 0, runtimeErrorCount: 0
  };
  const accepted = assessScannedPdfOriginal(passing);
  assert.equal(accepted.pass, true);
  for (const [field, value] of Object.entries({
    pageCount: 3,
    phase: 'text-ready',
    retainedPages: 1,
    statusTitle: '正在建立文字索引',
    firstPageNonWhitePixels: 0,
    enhancementButtonVisible: false,
    enhancementClickCount: 1,
    pageTwoVisible: false,
    zoomAfter: 90,
    reloadHash: 'different',
    sourceHashAfter: 'different',
    externalRequests: 1,
    runtimeErrorCount: 1
  })) {
    const failing = { ...passing, [field]: value };
    assert.equal(assessScannedPdfOriginal(failing).pass, false, field);
  }
});

test('verifier uses the fixed local scan identity and an isolated headless extension', () => {
  assert.match(verifier, /Zotero\\\\storage\\\\ILW29NMC/);
  assert.match(verifier, /f50a922e0112ba61d4fa18cdef03b404d10452b247fe83aff08d458e9ee869b5/);
  assert.match(verifier, /launchPersistentContext\(profileDirectory/);
  assert.match(verifier, /headless:\s*!headed/);
  assert.match(verifier, /brevess-scanned-pdf-/);
  assert.match(verifier, /dailyBrowserUsed:\s*false/);
  assert.match(verifier, /#pdfLocalFile'\)\.setInputFiles\(pdfPath\)/);
});

test('verifier proves original pixels, partial index, navigation, zoom, and reload identity', () => {
  assert.match(verifier, /native\?\.phase === 'partial-index'/);
  assert.match(verifier, /retainedPages:\s*Number\(coverage\.retainedPages\)/);
  assert.match(verifier, /firstPageTextCharacters:\s*initial\.textCharacterCount/);
  assert.match(verifier, /nonWhitePixels/);
  assert.match(verifier, /luminanceSpread/);
  assert.match(verifier, /#pdfReaderNextPage/);
  assert.match(verifier, /#pdfReaderZoomIn/);
  assert.match(verifier, /page\.reload\(\{ waitUntil: 'domcontentloaded' \}\)/);
  assert.match(verifier, /sha256After/);
  assert.match(verifier, /sourceBytesUnchanged/);
  for (const screenshot of [
    '05-scanned-original-first-page-viewport.png',
    '06-scanned-original-page-2-viewport.png',
    '07-scanned-original-zoomed-viewport.png',
    '08-scanned-original-reloaded-viewport.png',
    '09-scanned-original-first-page-canvas-raw.png',
    '10-scanned-original-page-2-canvas-raw.png'
  ]) assert.match(verifier, new RegExp(screenshot.replaceAll('.', '\\.')));
  assert.match(verifier, /page\.screenshot\(\{/);
  assert.match(verifier, /toDataURL\('image\/png'\)/);
  assert.match(verifier, /browser-compositor-viewport/);
  assert.match(verifier, /canvas-buffer-png/);
  assert.match(verifier, /archivePriorEvidence/);
});

test('verifier documents and enforces the no-OCR local-only boundary', () => {
  assert.match(verifier, /ocrPerformed:\s*false/);
  assert.match(verifier, /recognitionAccuracyValidated:\s*false/);
  assert.match(verifier, /enhancedRecognitionTriggered:\s*false/);
  assert.match(verifier, /__scannedPdfEnhancementClicks/);
  assert.match(verifier, /observation\.enhancementClickCount === 0/);
  assert.match(verifier, /context\.route\(\/\^https\?:\\\/\\\//u);
  assert.match(verifier, /allHttpRequestsBlocked:\s*true/);
  assert.doesNotMatch(verifier, /pdfReaderStartParse'\)\.click\(/);
  assert.doesNotMatch(verifier, /fetch\s*\(/);
});
