const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
function fn(name, next, async = false) {
  const start = source.indexOf(`${async ? 'async ' : ''}function ${name}(`);
  const end = source.indexOf(`function ${next}(`, start + 1);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end).replace(/async\s*$/, '');
}
function harness() {
  const documentHash = 'a'.repeat(64);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1UAAAAASUVORK5CYII=';
  const calls = [];
  const context = vm.createContext({
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    FIGURE_IMAGE_LIMIT: 4, FIGURE_IMAGE_MAX_BYTES: 8 * 1024 * 1024,
    __brevessNativePdfDocument: { structure: { documentHash }, documentGeneration: 2 },
    __brevessPdfReaderBridge: { command: async (command, page) => {
      calls.push(page); return { dataUrl: png, width: 1, height: 1,
        documentHash, documentGeneration: 2 };
    } }
  });
  vm.runInContext(fn('figureImageError', 'figureImageBytesMatchMediaType') +
    fn('figureImageBytesMatchMediaType', 'admitFigureImageDimensions') +
    fn('validateFigureProviderImage', 'collectValidFigureProviderImages') +
    fn('ensureNativePdfFigureImages', 'getFigureWorkspaceInventory', true), context);
  return { context, calls, png, figure: { sourceKind: 'pdf-page-caption',
    sourceFingerprint: documentHash, pageNumber: 4, pageNumbers: [4, 5, 6],
    captionPageNumbers: [4, 5, 6], artworkPageNumbers: [4, 5], analysisImages: [] } };
}
test('original PDF page images satisfy the real provider media contract', async () => {
  const h = harness();
  await h.context.ensureNativePdfFigureImages(h.figure);
  assert.deepEqual(h.calls, [4, 5]);
  assert.equal(h.figure.analysisImages.length, 2);
  for (const image of h.figure.analysisImages) {
    const admitted = h.context.validateFigureProviderImage(image);
    assert.equal(admitted.mediaType, 'image/png');
    assert.equal(admitted.dataUrl, h.png);
    assert.equal(image.sourceKind, 'pdf-original-page');
  }
  await h.context.ensureNativePdfFigureImages(h.figure);
  assert.equal(h.calls.length, 2);
});
test('legacy mimeType-only images are rendered again rather than silently rejected', async () => {
  const h = harness();
  h.figure.analysisImages = [{ mimeType: 'image/png', dataUrl: h.png }];
  await h.context.ensureNativePdfFigureImages(h.figure);
  assert.equal(h.calls.length, 2);
  assert.equal(h.context.validateFigureProviderImage(h.figure.analysisImages[0]).mediaType,
    'image/png');
});
test('cached or in-flight original images cannot cross document generations', async () => {
  const h = harness();
  h.figure.analysisImages = [{ mediaType: 'image/png', dataUrl: h.png }];
  h.figure.sourceFingerprint = 'b'.repeat(64);
  await assert.rejects(h.context.ensureNativePdfFigureImages(h.figure), /PDF_FIGURE_DOCUMENT_CHANGED/);
  assert.equal(h.calls.length, 0);
  h.figure.sourceFingerprint = 'a'.repeat(64); h.figure.analysisImages = [];
  const command = h.context.__brevessPdfReaderBridge.command;
  h.context.__brevessPdfReaderBridge.command = async (...args) => {
    const image = await command(...args);
    h.context.__brevessNativePdfDocument = {
      structure: { documentHash: 'a'.repeat(64) }, documentGeneration: 3
    };
    return image;
  };
  await assert.rejects(h.context.ensureNativePdfFigureImages(h.figure), /PDF_FIGURE_DOCUMENT_CHANGED/);
  assert.equal(h.figure.analysisImages.length, 0);
});

test('caption continuation never becomes artwork and a five-page set is not truncated', async () => {
  const h = harness();
  h.figure.artworkPageNumbers = [4];
  await h.context.ensureNativePdfFigureImages(h.figure);
  assert.deepEqual(h.calls, [4]);
  h.figure.artworkPageNumbers = [1, 2, 3, 4, 5];
  await assert.rejects(h.context.ensureNativePdfFigureImages(h.figure), /PDF_FIGURE_MULTI_ASSET_LIMIT/);
  assert.deepEqual(h.calls, [4]);
});

test('partial cached sets and old generations cannot bypass full ordered rendering', async () => {
  const h = harness();
  await h.context.ensureNativePdfFigureImages(h.figure);
  h.figure.analysisImages.pop();
  await h.context.ensureNativePdfFigureImages(h.figure);
  assert.deepEqual(h.calls, [4, 5, 4, 5]);
  h.figure.analysisImages.reverse();
  await h.context.ensureNativePdfFigureImages(h.figure);
  assert.deepEqual(h.calls, [4, 5, 4, 5, 4, 5]);
  h.figure.analysisImages[1].documentGeneration = 1;
  await h.context.ensureNativePdfFigureImages(h.figure);
  assert.deepEqual(h.calls, [4, 5, 4, 5, 4, 5, 4, 5]);
});
