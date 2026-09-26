const crypto = require('node:crypto');
require('../../core/sentence-boundary.js');
require('../../core/pdf-figure-context.js');
const { buildPdfSemanticIndex } = require('../../core/pdf-semantic-index.js');
const { createPdfSemanticCompatibilityAdapter } = require('../../core/pdf-semantic-compat.js');
const { createPdfFigureContextProductionAdapter } = require('../../core/pdf-figure-context-production.js');
const { createPdfFigureAssetRegistry } = require('../../core/figure-asset-registry.js');

async function pdfFigureRequestFixture(route = 'text-only') {
  const documentHash = crypto.createHash('sha256').update('pdf-figure-request-unit-source').digest('hex');
  const binding = { documentHash, documentGeneration: 3, semanticRevision: 5 };
  const pages = [{ pageNumber: 1,
    text: 'Figure 2. (A) Perfusion was quantified.\n\nAs shown in Figure 2, perfusion increased by 20% (P = 0.01). This Figure 2 effect was not seen in controls.' }];
  const index = buildPdfSemanticIndex({ documentHash, revision: 5, pages });
  const structure = { version: '1.0.0-pdf-native', adapterId: 'pdf-native',
    documentId: `sha256:${documentHash}`, documentHash, revision: 1,
    paragraphs: pages.map(page => ({ paragraphId: `pdf-page-${page.pageNumber}`,
      sourceKey: `pdf-page-${page.pageNumber}`, pageNumber: page.pageNumber,
      order: 0, text: page.text, displayText: page.text })), nodes: [],
    pages: pages.map(page => ({ pageNumber: page.pageNumber })) };
  const nativeDocument = { structure, documentGeneration: 3, pageCount: 1 };
  const semanticDocument = { schemaVersion: 1, documentId: structure.documentId,
    adapterId: 'pdf-native', documentHash, documentGeneration: 3, revision: 5,
    pageCount: 1, index };
  let current = true;
  const compatibility = createPdfSemanticCompatibilityAdapter({ semanticDocument, nativeDocument,
    getCurrentSemanticDocument: () => current ? semanticDocument : null,
    getCurrentNativeDocument: () => current ? nativeDocument : null });
  const figure = { figureId: 'figure-2', figureLabel: 'Figure 2',
    caption: 'Figure 2. (A) Perfusion was quantified.', pageNumber: 1,
    pageNumbers: [1], sourceFingerprint: documentHash };
  const inventory = [figure];
  const adapter = createPdfFigureContextProductionAdapter({ semanticDocument, nativeDocument,
    compatibility, figureInventory: inventory,
    getCurrentSemanticDocument: () => current ? semanticDocument : null,
    getCurrentNativeDocument: () => current ? nativeDocument : null,
    getCurrentCompatibility: () => current ? compatibility : null,
    getCurrentFigureInventory: () => current ? inventory : [] });
  const selected = await adapter.selectFigureContext({ figureId: figure.figureId, route: 'text-only' });
  const registry = createPdfFigureAssetRegistry({ getCurrentBinding: () => current ? binding : null });
  let assetProof = null;
  const images = [];
  if (route === 'vision') {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64');
    assetProof = await registry.register({ ...binding, figureId: figure.figureId,
      sourceType: 'full-figure', sourceSlot: 'main', pageNumbers: [1], pageCount: 1,
      mimeType: 'image/png', width: 1, height: 1, bytes });
    images.push({ dataUrl: `data:image/png;base64,${bytes.toString('base64')}` });
  }
  const envelope = { version: 'pdf-figure-production-envelope-v1', verified: true, route,
    binding, figure: selected.target, textualEvidence: selected.context.textualEvidence,
    semanticContextDigest: selected.semanticContextDigest, assetProof,
    images: assetProof ? [assetProof] : [] };
  return { binding, envelope,
    figure: { ...figure, panelHints: ['A'], images, pdfFigureContext: envelope },
    setCurrent(value) { current = value; },
    async verifyCurrent(query) {
      if (!current) return { success: false };
      if (assetProof) await registry.resolveForRequest({ assetIds: [assetProof.assetId], expected: query.assetProof });
      return { success: true, binding, semanticContextDigest: selected.semanticContextDigest, assetProof };
    } };
}

async function pdfFigurePanelRequestFixture(route = 'text-only') {
  if (route !== 'vision') {
    const fixture = await pdfFigureRequestFixture('text-only');
    const figure = structuredClone(fixture.figure);
    delete figure.images;
    figure.imageVariants = [];
    return { ...fixture, figure };
  }
  const base = await pdfFigureRequestFixture('vision');
  const parent = base.envelope.assetProof;
  const bytes = Buffer.from(base.figure.images[0].dataUrl.split(',')[1], 'base64');
  let current = true;
  const registry = createPdfFigureAssetRegistry({
    getCurrentBinding: () => current ? base.binding : null
  });
  const registeredParent = await registry.register({
    ...base.binding, figureId: base.figure.figureId,
    sourceType: 'full-figure', sourceSlot: 'main', pageNumbers: [1], pageCount: 1,
    mimeType: 'image/png', width: 1, height: 1, bytes
  });
  assertSameAsset(parent, registeredParent);
  const proof = await registry.register({
    ...base.binding, figureId: base.figure.figureId,
    sourceType: 'panel', sourceSlot: 'panel-a-1200', pageNumbers: [1], pageCount: 1,
    mimeType: 'image/png', width: 1, height: 1, bytes,
    rect: { x: 0, y: 0, width: 1, height: 1 }, encoderRevision: 1,
    parentAssetId: registeredParent.assetId,
    parentImageContentHash: registeredParent.imageContentHash
  });
  const envelope = { ...base.envelope, assetProof: proof, images: [proof] };
  const image = base.figure.images[0];
  const figure = {
    ...base.figure,
    images: undefined,
    pdfFigureContext: undefined,
    imageVariants: [{ ...image, mediaType: 'image/png', width: 1, height: 1,
      maxEdge: 1, inputMode: 'panel_crop', pixelsSupplied: true,
      assetProof: proof, pdfFigureContext: envelope }]
  };
  return {
    ...base, envelope, figure,
    setCurrent(value) { current = value; },
    async verifyCurrent(query) {
      if (!current) return { success: false };
      await registry.resolveForRequest({ assetIds: [proof.assetId], expected: query.assetProof });
      return { success: true, binding: base.binding,
        semanticContextDigest: envelope.semanticContextDigest, assetProof: proof };
    }
  };
}

function assertSameAsset(expected, actual) {
  if (expected.imageContentHash !== actual.imageContentHash ||
      expected.assetId !== actual.assetId) {
    throw new Error('PDF fixture parent asset mismatch');
  }
}

module.exports = { pdfFigureRequestFixture, pdfFigurePanelRequestFixture };
