const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('PDF reader runs MinerU text and native whole-Figure extraction as independent inputs', () => {
  const reader = read('pdf-reader.js');
  assert.match(reader, /createPdfFigureNativeClient\(chrome\.runtime\)/);
  assert.match(reader, /const nativeFiguresPromise = extractWholePdfFigures\(runId\)/);
  assert.match(reader, /Promise\.all\(\[\s*mineruPromise, nativeFiguresPromise/);
  assert.match(reader, /buildPdfFigureArticlePlan\(mineruBlocks, nativeFigures\)/);
  assert.match(reader, /dataset\.pdfWholeFigure = 'true'/);
  assert.match(reader, /MinerU 碎片图不会进入正文/);
});

test('PDF reader renders scientific superscript and subscript tokens semantically', () => {
  const reader = read('pdf-reader.js');
  assert.match(reader, /token\.type === 'superscript'\) node = document\.createElement\('sup'\)/);
  assert.match(reader, /token\.type === 'subscript'\) node = document\.createElement\('sub'\)/);
});

test('manual Figure page markers jump to the original PDF page', () => {
  const reader = read('pdf-reader.js');
  const content = read('content.js');
  assert.match(content, /brevess:pdf-focus-page/);
  assert.match(content, /page:\s*Math\.floor\(Number\(figure\.sourcePage\)\)/s);
  assert.match(reader, /function focusOriginalPdfPage/);
  assert.match(reader, /#page=\$\{page\}/);
  assert.match(reader, /addEventListener\('brevess:pdf-focus-page'/);
});

test('supplemental PDF whole Figures persist into and restore from the parent workspace', () => {
  const reader = read('pdf-reader.js');
  const content = read('content.js');
  assert.match(reader, /pdfFigureManifest: nativeManifest/);
  assert.match(reader, /restoreSupplementalPdfFigureBinaryAssets/);
  assert.match(reader, /parentWorkspaceId/);
  assert.match(content, /parsedPdfFigureBinaryAssets/);
  assert.match(content, /workspaceId: target\.workspaceId/);
  assert.match(content, /pdfFigureManifest: parsedPdfFigureManifest/);
});

test('whole PDF Figures persist as browser cache, manifest, and real workspace image files', () => {
  const reader = read('pdf-reader.js');
  const content = read('content.js');
  const background = read('background.js');
  assert.match(reader, /brevess-pdffigures2:\$\{figureId\}/);
  assert.match(reader, /pdfFigureBinaryAssets/);
  assert.match(content, /'pdf\/figures\/manifest\.json'/);
  assert.match(content, /ARTICLE_WORKSPACE_SAVE_BINARY_ASSET/);
  assert.match(content, /restorePdfFigureBinaryAssets/);
  assert.match(background, /'ARTICLE_WORKSPACE_SAVE_BINARY_ASSET'/);
  assert.match(background, /'ARTICLE_WORKSPACE_GET_BINARY_ASSET'/);
});

test('PDF Figure fallback never blocks MinerU text rendering when companion is unavailable', () => {
  const reader = read('pdf-reader.js');
  assert.match(reader, /extractWholePdfFigures\(runId\)\.catch\(error =>/);
  assert.match(reader, /return null;/);
  assert.match(reader, /await cacheRemoteParsedImages\(parsed, runId\)/);
  assert.match(read('pdf-reader.html'), /id="pdfFigureEngineStatus"/);
});

test('PDF reader leaves outline navigation to the right-side navigation module', () => {
  const reader = read('pdf-reader.js');
  const html = read('pdf-reader.html');
  assert.doesNotMatch(html, /pdfReaderOutline/);
  assert.doesNotMatch(reader, /renderPdfOutline|uniqueOutlineTargets|outlineSectionScore/);
  assert.match(html, /id="pdfReaderArticle"/);
});

test('stale cached Figures upgrade locally without rerunning MinerU text parsing', () => {
  const reader = read('pdf-reader.js');
  const start = reader.indexOf('async function refreshCachedNativeFigures');
  const end = reader.indexOf('async function getCachedSupplementalAsset', start);
  const refresh = reader.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(reader, /pdfFigureManifestNeedsRefresh\?\.\(pdfFigureManifest\)/);
  assert.match(refresh, /extractWholePdfFigures\(runId\)/);
  assert.match(refresh, /正文不会重新发送到 MinerU/);
  assert.doesNotMatch(refresh, /parseWithAgent|parseWithPrecise|mineruPromise/);
});
