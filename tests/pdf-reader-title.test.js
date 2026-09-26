const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const reader = fs.readFileSync(path.join(__dirname, '../pdf-reader.js'), 'utf8');
const nativeReader = fs.readFileSync(path.join(__dirname, '../pdf-native-reader.mjs'), 'utf8');

function titleHelpers() {
  const start = reader.indexOf('  function normalizePdfReaderDocumentTitle(');
  const end = reader.indexOf('\n  function applyPdfReaderDocumentTitle(', start);
  assert.ok(start >= 0 && end > start, 'production title helpers must be extractable');
  const context = vm.createContext({});
  vm.runInContext(`${reader.slice(start, end)}\n` +
    'globalThis.helpers = { normalizePdfReaderDocumentTitle, resolvePdfReaderDocumentTitle };',
  context);
  return context.helpers;
}

test('PDF metadata title has priority over filename and requested title', () => {
  const { resolvePdfReaderDocumentTitle } = titleHelpers();
  assert.equal(resolvePdfReaderDocumentTitle({
    metadataTitle: '  Neuronal signaling in glioma  ',
    fileName: 'download-123.pdf',
    requestedTitle: 'Publisher landing page'
  }), 'Neuronal signaling in glioma');
});

test('generic PDF metadata titles fall back to the original filename', () => {
  const { resolvePdfReaderDocumentTitle } = titleHelpers();
  for (const metadataTitle of [
    '', 'Untitled', 'Title', 'Document1', 'Microsoft Word',
    'C:\\private\\draft.docx', 'Brevess PDF 阅读工作区',
    'PDF 阅读工作区', 'Parsed PDF'
  ]) {
    assert.equal(resolvePdfReaderDocumentTitle({
      metadataTitle,
      fileName: 'Glioma-associated microglia.pdf',
      requestedTitle: 'Generic source'
    }), 'Glioma-associated microglia');
  }
});

test('filename fallback is normalized, bounded, and never exposes a path', () => {
  const { resolvePdfReaderDocumentTitle } = titleHelpers();
  assert.equal(resolvePdfReaderDocumentTitle({
    fileName: 'C:\\private\\folder\\Real study title.pdf'
  }), 'Real study title');
  assert.equal(resolvePdfReaderDocumentTitle({
    fileName: 'ＰＤＦ　reading　study.PDF'
  }), 'PDF reading study');
  assert.ok(resolvePdfReaderDocumentTitle({
    metadataTitle: 'x'.repeat(900), fileName: 'fallback.pdf'
  }).length <= 500);
  assert.equal(resolvePdfReaderDocumentTitle({
    metadataTitle: 'Untitled', fileName: 'paper.pdf'
  }), 'paper');
});

test('reader publishes the resolved title before native structure and workspace snapshots', () => {
  assert.match(reader, /function applyPdfReaderDocumentTitle\(/);
  assert.match(reader, /document\.title\s*=\s*resolved/);
  assert.match(reader, /get title\(\)\s*\{\s*return state\.documentTitle/);
  assert.match(reader, /onMetadata\(metadata\)[\s\S]{0,180}applyPdfReaderDocumentTitle/);
  assert.match(nativeReader, /sourceDocument\.getMetadata\(\)/);
  assert.match(nativeReader, /bridge\.onMetadata\?\.\(/);
  const metadataAt = nativeReader.indexOf('sourceDocument.getMetadata()');
  const titleAt = nativeReader.indexOf('bridge.onMetadata?.(', metadataAt);
  const outlineAt = nativeReader.indexOf("publishNativePdfStructure(sourceOutline, [], 'outline')", titleAt);
  assert.ok(metadataAt >= 0 && titleAt > metadataAt && outlineAt > titleAt);
});
