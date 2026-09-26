const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { pdfFigureRequestFixture } = require('./helpers/pdf-figure-request-fixture.js');
const {
  createPdfFigureVisualEvidenceSet,
  pdfFigureSemanticEvidenceDigest,
  validatePdfFigureRequest,
  validatePdfFigurePanelRequest
} = require('../core/pdf-figure-request.js');
const prompts = require('../core/figure-analysis.js');

test('restoring a visual directory requires identical document, target and source evidence across generations', async () => {
  const { envelope } = await pdfFigureRequestFixture('vision');
  const before = await pdfFigureSemanticEvidenceDigest(envelope);
  const reloaded = structuredClone(envelope);
  reloaded.binding.documentGeneration += 1;
  reloaded.binding.semanticRevision += 1;
  assert.equal(await pdfFigureSemanticEvidenceDigest(reloaded), before);
  for (const mutate of [
    value => { value.binding.documentHash = 'f'.repeat(64); },
    value => { value.figure.figureId = 'figure-3'; },
    value => { value.textualEvidence.body[0].text += ' different'; },
    value => { value.textualEvidence.body[0].location.sourceFragments[0].start += 1; }
  ]) {
    const changed = structuredClone(reloaded);
    mutate(changed);
    assert.notEqual(await pdfFigureSemanticEvidenceDigest(changed), before);
  }
});

test('production-selected PDF evidence survives text and vision admission identically', async () => {
  const text = await pdfFigureRequestFixture();
  const vision = await pdfFigureRequestFixture('vision');
  const one = await validatePdfFigureRequest(text.figure, { verifyCurrent: text.verifyCurrent });
  const two = await validatePdfFigureRequest(vision.figure, {
    capabilityMode: 'vision', verifyCurrent: vision.verifyCurrent });
  assert.deepEqual(one.figure.contextParagraphs, two.figure.contextParagraphs);
  assert.equal(one.figure.caption, two.figure.caption);
  assert.match(one.figure.caption, /Perfusion/);
  assert.match(one.figure.contextParagraphs.map(item => item.text).join(' '), /20%/);
  assert.equal(text.envelope.textualEvidence.body.length, 2);
  assert.equal(one.figure.contextParagraphs.length, 1);
  assert.match(one.figure.contextParagraphs[0].paragraphId, /^pdf-paragraph:[a-f0-9]{16}$/u);
  assert.match(one.figure.contextParagraphs[0].text, /not seen in controls/,
    'same-paragraph registry must retain the second verified sentence and its negative qualifier');
  assert.equal(one.figure.images.length, 0);
  assert.equal(two.figure.images.length, 1);
  await two.validateDispatchImages(two.figure.images);
  text.setCurrent(false);
  await assert.rejects(one.assertCurrent(), { code: 'PDF_FIGURE_CONTEXT_STALE' });
});

test('admits an ordered complete two-page artwork set and rejects partial, reordered, or tampered dispatch', async () => {
  const fixture = await pdfFigureRequestFixture('vision');
  const figure = structuredClone(fixture.figure);
  const binding = figure.pdfFigureContext.binding;
  const firstImage = figure.images[0];
  const secondImage = {
    mediaType: 'image/png', dataUrl: 'data:image/png;base64,c2Vjb25kLXBhZ2U='
  };
  const secondHash = createHash('sha256').update(Buffer.from('second-page')).digest('hex');
  const firstProof = {
    ...figure.pdfFigureContext.assetProof,
    sourceType: 'page-region', sourceSlot: 'page-8', pageNumber: 8
  };
  const secondProof = {
    ...firstProof,
    assetId: `pdfa-${'8'.repeat(48)}`,
    assetRevision: firstProof.assetRevision + 1,
    sourceSlot: 'page-9', pageNumber: 9,
    imageContentHash: secondHash
  };
  const visualEvidenceSet = await createPdfFigureVisualEvidenceSet({
    figureId: figure.figureId,
    binding,
    requiredArtworkPageNumbers: [8, 9],
    coverageComplete: true,
    assets: [firstProof, secondProof]
  });
  figure.images = [firstImage, secondImage];
  delete figure.assetProof;
  figure.pdfFigureContext = {
    ...figure.pdfFigureContext,
    version: 'pdf-figure-production-envelope-v2',
    assetProof: null,
    visualEvidenceSet,
    images: visualEvidenceSet.assets
  };
  let currentVisualEvidenceSet = visualEvidenceSet;
  const verifyCurrent = async query => ({ success: true, ...structuredClone(query),
    visualEvidenceSet: structuredClone(currentVisualEvidenceSet) });
  const admitted = await validatePdfFigureRequest(figure, {
    capabilityMode: 'vision', verifyCurrent
  });
  assert.equal(admitted.figure.images.length, 2);
  assert.deepEqual(admitted.figure.images, [firstImage, secondImage]);
  assert.equal(admitted.figure.pdfEvidenceBinding.assetProof, null);
  assert.equal(admitted.figure.pdfEvidenceBinding.visualEvidenceSet.setDigest,
    visualEvidenceSet.setDigest);
  await admitted.validateDispatchImages([firstImage, secondImage]);
  await assert.rejects(admitted.validateDispatchImages([secondImage, firstImage]),
    { code: 'PDF_FIGURE_ASSET_HASH_MISMATCH' });
  await assert.rejects(admitted.validateDispatchImages([firstImage]),
    { code: 'PDF_FIGURE_IMAGE_COUNT_INVALID' });
  await assert.rejects(admitted.validateDispatchImages([
    firstImage, { ...secondImage, dataUrl: 'data:image/png;base64,dGFtcGVyZWQ=' }
  ]), { code: 'PDF_FIGURE_ASSET_HASH_MISMATCH' });
  currentVisualEvidenceSet = { ...visualEvidenceSet,
    assets: [...visualEvidenceSet.assets].reverse() };
  await assert.rejects(admitted.validateDispatchImages([firstImage, secondImage]),
    { code: 'PDF_FIGURE_CONTEXT_STALE' });
  currentVisualEvidenceSet = visualEvidenceSet;

  const partial = structuredClone(figure);
  partial.pdfFigureContext.visualEvidenceSet.coverageComplete = false;
  await assert.rejects(validatePdfFigureRequest(partial, {
    capabilityMode: 'vision', verifyCurrent
  }), { code: 'PDF_FIGURE_ARTWORK_COVERAGE_INCOMPLETE' });

  await assert.rejects(createPdfFigureVisualEvidenceSet({
    figureId: figure.figureId, binding,
    requiredArtworkPageNumbers: [8, 8], coverageComplete: true,
    assets: [firstProof, { ...secondProof, pageNumber: 8 }]
  }), { code: 'PDF_FIGURE_ARTWORK_PAGES_INVALID' });
  await assert.rejects(createPdfFigureVisualEvidenceSet({
    figureId: figure.figureId, binding,
    requiredArtworkPageNumbers: [8, 9], coverageComplete: true,
    assets: [firstProof, { ...secondProof, assetId: firstProof.assetId }]
  }), { code: 'PDF_FIGURE_ASSET_BINDING_CONFLICT' });
  const reversedSet = await createPdfFigureVisualEvidenceSet({
    figureId: figure.figureId, binding,
    requiredArtworkPageNumbers: [9, 8], coverageComplete: true,
    assets: [secondProof, firstProof]
  });
  assert.notEqual(reversedSet.setDigest, visualEvidenceSet.setDigest,
    'the complete artwork-set identity is order-sensitive');
  await assert.rejects(createPdfFigureVisualEvidenceSet({
    figureId: figure.figureId, binding,
    requiredArtworkPageNumbers: [1, 2, 3, 4, 5], coverageComplete: true,
    assets: [1, 2, 3, 4, 5].map((pageNumber, index) => ({
      ...firstProof, pageNumber, sourceSlot: `page-${pageNumber}`,
      assetId: `pdfa-${String(index + 1).repeat(48)}`
    }))
  }), { code: 'PDF_FIGURE_MULTI_ASSET_LIMIT' });
});

test('PDF admission rejects tampered evidence, ownership, routes and image bytes', async () => {
  const fixture = await pdfFigureRequestFixture('vision');
  const options = { capabilityMode: 'vision', verifyCurrent: fixture.verifyCurrent };
  const evidence = structuredClone(fixture.figure);
  evidence.pdfFigureContext.textualEvidence.body[0].text += ' invented';
  await assert.rejects(validatePdfFigureRequest(evidence, options), { code: 'PDF_FIGURE_EVIDENCE_UNVERIFIED' });
  const digest = structuredClone(fixture.figure);
  digest.pdfFigureContext.semanticContextDigest = '0'.repeat(64);
  await assert.rejects(validatePdfFigureRequest(digest, options), { code: 'PDF_FIGURE_CONTEXT_DIGEST_MISMATCH' });
  await assert.rejects(validatePdfFigureRequest(fixture.figure, { ...options, capabilityMode: 'text-only' }),
    { code: 'PDF_FIGURE_ROUTE_CHANGED' });
  const image = structuredClone(fixture.figure);
  image.images[0].dataUrl = 'data:image/png;base64,dGFtcGVyZWQ=';
  await assert.rejects(validatePdfFigureRequest(image, options), { code: 'PDF_FIGURE_ASSET_HASH_MISMATCH' });
  await assert.rejects(validatePdfFigureRequest(fixture.figure, { ...options, verifyCurrent: async () => null }),
    { code: 'PDF_FIGURE_CONTEXT_STALE' });
  await assert.rejects(validatePdfFigureRequest(fixture.figure, { ...options, verifyCurrent: undefined }),
    { code: 'PDF_FIGURE_OWNER_UNAVAILABLE' });
});

test('admitted PDF input is isolated from later caller mutation and extra image variants', async () => {
  const fixture = await pdfFigureRequestFixture('vision');
  fixture.figure.imageVariants = [{ dataUrl: 'data:image/png;base64,dGFtcGVyZWQ=' }];
  const result = await validatePdfFigureRequest(fixture.figure, {
    capabilityMode: 'vision', verifyCurrent: fixture.verifyCurrent });
  fixture.figure.images[0].dataUrl = 'data:image/png;base64,dGFtcGVyZWQ=';
  assert.equal(result.figure.imageVariants.length, 0);
  await result.validateDispatchImages(result.figure.images);
  await assert.rejects(result.validateDispatchImages(fixture.figure.images),
    { code: 'PDF_FIGURE_ASSET_HASH_MISMATCH' });
  await assert.rejects(result.validateDispatchImages([...result.figure.images, ...result.figure.images]),
    { code: 'PDF_FIGURE_IMAGE_COUNT_INVALID' });
});

test('all Figure passes retain already-budgeted PDF evidence while HTML retains existing limits', () => {
  const input = { figureId: 'figure-2', figureLabel: 'Figure 2', panelHints: ['A'],
    caption: 'caption '.repeat(1200),
    contextParagraphs: Array.from({ length: 18 }, (_, i) => ({
      paragraphId: `semantic-p${i}`, text: `Figure 2 (${i}). ` + 'evidence '.repeat(260) + 'final qualifier.'
    })), pdfEvidenceBinding: { semanticContextDigest: 'a'.repeat(64) } };
  for (const compile of [prompts.compileFigureAnalysisPrompt, prompts.compileUnlabeledFigureOverviewPrompt,
    value => prompts.compileFigureSynthesisPrompt(value, [])]) {
    const pdf = JSON.parse(compile(input).userPrompt);
    assert.equal(pdf.caption, input.caption.trim());
    assert.equal(pdf.related_body_context.length, 18);
    assert.equal(pdf.related_body_context[17].text, input.contextParagraphs[17].text);
    const html = JSON.parse(compile({ ...input, pdfEvidenceBinding: undefined }).userPrompt);
    assert.ok(html.related_body_context.length <= 12);
    assert.ok(html.caption.length <= 8000);
  }
  for (const compile of [prompts.compileFigurePanelBatchPrompt,
    value => prompts.compileFigurePanelRecoveryPrompt(value, ['A'])]) {
    const pdf = JSON.parse(compile(input).userPrompt).figure_context;
    assert.equal(pdf.verified_figure_caption, input.caption.trim());
    assert.equal(Object.keys(pdf.body_registry).length, 18);
    assert.equal(pdf.body_registry['semantic-p17'].text, input.contextParagraphs[17].text);
  }
});

async function panelRequestFixture(mode = 'text-only') {
  const fixture = await pdfFigureRequestFixture(mode === 'vision' ? 'vision' : 'text-only');
  const figure = structuredClone(fixture.figure);
  if (mode === 'vision') {
    const proof = {
      ...figure.pdfFigureContext.assetProof,
      assetId: `pdfa-${'9'.repeat(48)}`,
      sourceType: 'panel',
      sourceSlot: 'panel-a-1200',
      parentAssetId: figure.pdfFigureContext.assetProof.assetId,
      parentImageContentHash: figure.pdfFigureContext.assetProof.imageContentHash,
      rect: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
      encoderRevision: 1,
      cropRevision: 1
    };
    const envelope = {
      ...figure.pdfFigureContext,
      assetProof: proof,
      images: [proof]
    };
    figure.imageVariants = [{
      ...figure.images[0],
      width: proof.width,
      height: proof.height,
      maxEdge: Math.max(proof.width, proof.height),
      inputMode: 'panel_crop',
      pixelsSupplied: true,
      assetProof: proof,
      pdfFigureContext: envelope
    }];
    delete figure.images;
    delete figure.pdfFigureContext;
  } else {
    figure.imageVariants = [];
    delete figure.images;
  }
  let current = true;
  const verifyCurrent = async query => current
    ? ({ success: true, ...structuredClone(query) })
    : ({ success: false, code: 'PDF_FIGURE_CONTEXT_STALE' });
  return { figure, verifyCurrent, setCurrent(value) { current = value; } };
}

test('single-Panel PDF admission preserves verified locators for text-only interpretation and follow-up', async () => {
  const fixture = await panelRequestFixture('text-only');
  for (const requestMode of ['interpretation', 'followup']) {
    const admitted = await validatePdfFigurePanelRequest(fixture.figure, {
      capabilityMode: 'caption_text_only', requestMode,
      verifyCurrent: fixture.verifyCurrent
    });
    assert.equal(admitted.figure.imageVariants.length, 0);
    assert.match(admitted.figure.caption, /Perfusion/);
    assert.equal(admitted.figure.contextParagraphs.length, 1);
    assert.ok(admitted.figure.contextParagraphs[0].evidence.length >= 2);
    assert.ok(admitted.figure.contextParagraphs[0].evidence.every(item =>
      item.location.locatorStatus === 'resolved' && item.location.sourceFragments.length));
    assert.equal(admitted.figure.pdfEvidenceBinding.assetProof, null);
    await admitted.assertCurrent();
    await admitted.validateDispatchPlan({ images: [], assetProof: null,
      pdfEvidenceBinding: admitted.figure.pdfEvidenceBinding });
  }
});

test('single-Panel PDF vision admits only independently bound panel variants and exact selected bytes', async () => {
  const fixture = await panelRequestFixture('vision');
  const admitted = await validatePdfFigurePanelRequest(fixture.figure, {
    capabilityMode: 'vision', panelId: 'A', verifyCurrent: fixture.verifyCurrent
  });
  assert.equal(admitted.figure.imageVariants.length, 1);
  assert.equal(admitted.figure.imageVariants[0].assetProof.sourceType, 'panel');
  assert.equal(admitted.figure.imageVariants[0].assetProof.encoderRevision, 1);
  assert.equal(admitted.figure.imageVariants[0].width,
    admitted.figure.imageVariants[0].assetProof.width);
  assert.equal(admitted.figure.imageVariants[0].height,
    admitted.figure.imageVariants[0].assetProof.height);
  assert.equal(admitted.figure.imageVariants[0].maxEdge, Math.max(
    admitted.figure.imageVariants[0].assetProof.width,
    admitted.figure.imageVariants[0].assetProof.height
  ));
  const plan = {
    images: [{ mediaType: admitted.figure.imageVariants[0].mediaType,
      dataUrl: admitted.figure.imageVariants[0].dataUrl }],
    assetProof: admitted.figure.imageVariants[0].assetProof,
    pdfEvidenceBinding: admitted.figure.imageVariants[0].pdfEvidenceBinding
  };
  await admitted.validateDispatchPlan(plan);
  await assert.rejects(admitted.validateDispatchPlan({ ...plan,
    images: [{ ...plan.images[0], dataUrl: 'data:image/png;base64,dGFtcGVyZWQ=' }] }),
  { code: 'PDF_FIGURE_ASSET_HASH_MISMATCH' });
  const fullFigureProof = structuredClone(fixture.figure);
  fullFigureProof.imageVariants[0].assetProof.sourceType = 'full-figure';
  fullFigureProof.imageVariants[0].pdfFigureContext.assetProof.sourceType = 'full-figure';
  fullFigureProof.imageVariants[0].pdfFigureContext.images[0].sourceType = 'full-figure';
  await assert.rejects(validatePdfFigurePanelRequest(fullFigureProof, {
    capabilityMode: 'vision', panelId: 'A', verifyCurrent: fixture.verifyCurrent
  }), { code: 'PDF_FIGURE_ASSET_BINDING_CONFLICT' });

  const forgedDimensions = structuredClone(fixture.figure);
  forgedDimensions.imageVariants[0].width = 999;
  forgedDimensions.imageVariants[0].height = 999;
  forgedDimensions.imageVariants[0].maxEdge = 1;
  await assert.rejects(validatePdfFigurePanelRequest(forgedDimensions, {
    capabilityMode: 'vision', panelId: 'A', verifyCurrent: fixture.verifyCurrent
  }), { code: 'PDF_FIGURE_ASSET_BINDING_CONFLICT' });

  await assert.rejects(validatePdfFigurePanelRequest(fixture.figure, {
    capabilityMode: 'vision', panelId: 'D', verifyCurrent: fixture.verifyCurrent
  }), { code: 'PDF_FIGURE_ASSET_BINDING_CONFLICT' });
});

test('single-Panel PDF admission rejects missing, forged, and mixed semantic envelopes before use', async () => {
  const fixture = await panelRequestFixture('vision');
  const missing = structuredClone(fixture.figure);
  delete missing.imageVariants[0].pdfFigureContext;
  await assert.rejects(validatePdfFigurePanelRequest(missing, {
    capabilityMode: 'vision', panelId: 'A', verifyCurrent: fixture.verifyCurrent
  }), { code: 'PDF_FIGURE_CONTEXT_INVALID' });
  const forged = structuredClone(fixture.figure);
  forged.imageVariants[0].pdfFigureContext.binding.documentGeneration += 1;
  await assert.rejects(validatePdfFigurePanelRequest(forged, {
    capabilityMode: 'vision', panelId: 'A', verifyCurrent: fixture.verifyCurrent
  }), { code: 'PDF_FIGURE_CONTEXT_DIGEST_MISMATCH' });
  const stale = await validatePdfFigurePanelRequest(fixture.figure, {
    capabilityMode: 'vision', panelId: 'A', verifyCurrent: fixture.verifyCurrent
  });
  fixture.setCurrent(false);
  await assert.rejects(stale.validateDispatchPlan({
    images: [{ mediaType: stale.figure.imageVariants[0].mediaType,
      dataUrl: stale.figure.imageVariants[0].dataUrl }],
    assetProof: stale.figure.imageVariants[0].assetProof,
    pdfEvidenceBinding: stale.figure.imageVariants[0].pdfEvidenceBinding
  }), { code: 'PDF_FIGURE_CONTEXT_STALE' });
});
