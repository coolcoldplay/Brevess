const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.join(__dirname, '..');
const readerHtml = fs.readFileSync(path.join(root, 'pdf-reader.html'), 'utf8');
const requestPath = 'core/pdf-figure-request.js';
const registryPath = 'core/figure-asset-registry.js';

function scriptPosition(relativePath) {
  return readerHtml.indexOf(`src="${relativePath}"`);
}

function binding() {
  return {
    documentHash: '1'.repeat(64),
    documentGeneration: 4,
    semanticRevision: 7
  };
}

function pageAssetInput(pageNumber) {
  return {
    bytes: new TextEncoder().encode(`page-${pageNumber}`),
    ...binding(),
    figureId: 'figure-2',
    pageNumbers: [8, 9],
    pageCount: 10,
    sourceType: 'page-region',
    sourceSlot: `page-${pageNumber}`,
    pageNumber,
    rect: { x: 0, y: 0, width: 1, height: 1 },
    mimeType: 'image/png',
    width: 900,
    height: 1200
  };
}

function loadReaderFigureScripts() {
  const context = vm.createContext({
    ArrayBuffer,
    Uint8Array,
    TextEncoder,
    crypto: webcrypto,
    SciLLM: {}
  });
  const orderedScripts = [requestPath, registryPath]
    .sort((left, right) => scriptPosition(left) - scriptPosition(right));
  for (const relativePath of orderedScripts) {
    vm.runInContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), context, {
      filename: relativePath
    });
  }
  return context;
}

test('PDF reader preserves context order and loads request before registry and content', () => {
  const context = scriptPosition('core/pdf-figure-context.js');
  const production = scriptPosition('core/pdf-figure-context-production.js');
  const request = scriptPosition(requestPath);
  const registry = scriptPosition(registryPath);
  const content = scriptPosition('content.js');

  assert.ok(context >= 0 && production > context,
    'existing context then production order must remain intact');
  assert.ok(request > production && registry > request && content > registry,
    'request builder must exist in the reader realm before registry and content');
});

test('browser reader script order resolves a valid two-page set and rejects tampering', async () => {
  const context = loadReaderFigureScripts();
  assert.equal(typeof context.require, 'undefined', 'browser contract must not use CommonJS require');
  assert.equal(typeof context.SciLLM.createPdfFigureVisualEvidenceSet, 'function');
  assert.equal(typeof context.SciLLM.createPdfFigureAssetRegistry, 'function');

  const registry = context.SciLLM.createPdfFigureAssetRegistry({
    getCurrentBinding: () => binding()
  });
  const assets = [];
  for (const pageNumber of [8, 9]) {
    assets.push(await registry.register(pageAssetInput(pageNumber)));
  }
  const visualEvidenceSet = await context.SciLLM.createPdfFigureVisualEvidenceSet({
    figureId: 'figure-2',
    binding: binding(),
    requiredArtworkPageNumbers: [8, 9],
    coverageComplete: true,
    assets
  });

  const resolved = await registry.resolveSetForRequest({ visualEvidenceSet });
  assert.deepEqual(Array.from(resolved.images, image => image.descriptor.pageNumber), [8, 9]);
  assert.deepEqual(Array.from(resolved.images, image =>
    new TextDecoder().decode(image.bytes)), ['page-8', 'page-9']);
  assert.notEqual(resolved.images[0].bytes, resolved.images[1].bytes);

  await assert.rejects(
    registry.resolveSetForRequest({
      visualEvidenceSet: { ...visualEvidenceSet, setDigest: 'f'.repeat(64) }
    }),
    error => error?.code === 'PDF_FIGURE_VISUAL_SET_DIGEST_MISMATCH'
  );
});
