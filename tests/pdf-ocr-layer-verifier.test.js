const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const verifier = fs.readFileSync(path.join(
  __dirname, '..', 'scripts', 'verify-pdf-ocr-layer.mjs'
), 'utf8');

test('OCR layer verifier uses isolated extension/profile and blocks every HTTP request', () => {
  assert.match(verifier, /brevess-pdf-ocr-layer-/);
  assert.match(verifier, /temporaryExtension:\s*true/);
  assert.match(verifier, /temporaryProfile:\s*true/);
  assert.match(verifier, /--disable-extensions-except=/);
  assert.match(verifier, /--load-extension=/);
  assert.match(verifier, /context\.route\(\/\^https\?:\\\/\\\//u);
  assert.match(verifier, /externalRequests === 0/);
  assert.match(verifier, /apiRequests === 0/);
});

test('injected coordinates are explicitly synthetic and are never presented as OCR accuracy', () => {
  assert.match(verifier, /Artificial\/synthetic layout coordinates; not real OCR output\./);
  assert.match(verifier, /SYNTHETIC_LAYOUT_COORDINATES_NOT_REAL_OCR_OUTPUT/);
  assert.match(verifier, /ocrAccuracyValidated:\s*false/);
  assert.match(verifier, /mineruApiCalled:\s*false/);
  assert.doesNotMatch(verifier, /ocrAccuracyValidated:\s*true/);
});

test('bridge gate rejects the wrong source hash and installs only the matching binding', () => {
  assert.match(verifier, /installOcrTextLayer/);
  assert.match(verifier, /PDF_OCR_WRONG_HASH_ACCEPTED/);
  assert.match(verifier, /PDF_OCR_SOURCE_MISMATCH/);
  assert.match(verifier, /installResult\.installedPages, \[1\]/);
  assert.match(verifier, /binding = syntheticBinding\(scannedHash\)/);
});

test('bridge gate preserves canvas pixels and exercises real mouse selection after remount', () => {
  assert.match(verifier, /crypto\.subtle\.digest\('SHA-256', pixels\)/);
  assert.match(verifier, /PDF_OCR_LAYER_CHANGED_ORIGINAL_PIXELS/);
  assert.match(verifier, /page\.mouse\.down\(\)/);
  assert.match(verifier, /page\.mouse\.move\([^\n]+\{ steps: 20 \}\)/);
  assert.match(verifier, /page\.mouse\.up\(\)/);
  assert.match(verifier, /clickCount:\s*3/);
  assert.match(verifier, /selectionMethod = 'mouse-triple-click'/);
  assert.match(verifier, /PDF_OCR_REAL_MOUSE_SELECTION_EMPTY/);
  assert.match(verifier, /PDF_OCR_REMOUNT_CHANGED_ORIGINAL_PIXELS/);
  assert.match(verifier, /PDF_OCR_SYNTHETIC_TEXT_NOT_TRANSPARENT/);
  assert.match(verifier, /remounted:\s*true/);
});

test('synthetic layer persists through production workspace cache and full reload', () => {
  assert.match(verifier, /refreshParsedPdfWorkspace/);
  assert.match(verifier, /getWorkspaceAssetCheckpoint\('pdf\/document\.json'\)/);
  assert.match(verifier, /PDF_OCR_SYNTHETIC_CACHE_PROVENANCE_MISSING/);
  assert.match(verifier, /page\.reload\(/);
  assert.match(verifier, /PDF_OCR_RELOAD_CHANGED_ORIGINAL_PIXELS/);
  assert.match(verifier, /cacheReloadValidated = true/);
});

test('rich native text remains authoritative after the synthetic cache gate', () => {
  assert.match(verifier, /PDF_OCR_RICH_NATIVE_TEXT_MISSING/);
  assert.match(verifier, /richInstall\.installedPages, \[\]/);
  assert.match(verifier, /PDF_OCR_REPLACED_RICH_NATIVE_TEXT/);
  assert.match(verifier, /PDF_OCR_CHANGED_RICH_NATIVE_TEXT/);
  assert.match(verifier, /cacheReloadValidated:\s*false/);
  assert.match(verifier, /PDF_OCR_RICH_PATH/);
});
