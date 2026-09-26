const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const {
  PDF_FIGURE_PANEL_INVENTORY_VERSION,
  PDF_FIGURE_PANEL_INVENTORY_SET_VERSION,
  createPdfFigurePanelInventorySchema,
  createPdfFigurePanelInventorySetSchema,
  createPdfFigurePanelInventoryResponseSchema,
  compilePdfFigurePanelInventoryPrompt,
  normalizePdfFigurePanelInventoryContext,
  derivePdfFigurePanelCoverage,
  validatePdfFigurePanelInventory
} = require('../core/pdf-figure-panel-inventory.js');

const IMAGE_HASH = '1'.repeat(64);
const SEMANTIC_DIGEST = '2'.repeat(64);
const SET_DIGEST = '3'.repeat(64);

test('attaches the pure contract through the shared browser IIFE', () => {
  const source = readFileSync(require.resolve('../core/pdf-figure-panel-inventory.js'), 'utf8');
  const sandbox = {};
  vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.SciLLM?.validatePdfFigurePanelInventory, 'function');
  assert.equal(sandbox.SciLLM.PDF_FIGURE_PANEL_INVENTORY_VERSION,
    'pdf-figure-panel-inventory-v2');
});

function context(overrides = {}) {
  return {
    sourceKind: 'pdf',
    capabilityMode: 'vision',
    imageInputCount: 1,
    figureId: 'figure-1',
    figureLabel: 'Figure 1',
    pageNumbers: [4],
    captionAnchor: 'Figure 1 Increased microglial motility in the hippocampus of awake mice.',
    captionKnownPanels: ['B', 'C', 'D'],
    pdfEvidenceBinding: {
      semanticContextDigest: SEMANTIC_DIGEST,
      assetProof: {
        figureId: 'figure-1',
        sourceType: 'full-figure',
        imageContentHash: IMAGE_HASH
      }
    },
    ...overrides
  };
}

function marker(label, clarity = 'clear', overrides = {}) {
  return {
    label,
    clarity,
    ...overrides
  };
}

function inventory(markers, overrides = {}) {
  return {
    figure_id: 'figure-1',
    image_content_hash: IMAGE_HASH,
    semantic_context_digest: SEMANTIC_DIGEST,
    inventory_complete: true,
    markers,
    ...overrides
  };
}

function multiPageContext(overrides = {}) {
  return context({
    imageInputCount: 2,
    pageNumbers: [8, 9],
    captionPageNumbers: [8, 9],
    artworkPageNumbers: [8, 9],
    captionKnownPanels: ['A', 'H'],
    pdfEvidenceBinding: {
      semanticContextDigest: SEMANTIC_DIGEST,
      assetProof: null,
      visualEvidenceSet: {
        version: 'pdf-figure-visual-evidence-set-v1',
        figureId: 'figure-1',
        requiredArtworkPageNumbers: [8, 9],
        coverageComplete: true,
        assets: [
          { pageNumber: 8, imageContentHash: IMAGE_HASH },
          { pageNumber: 9, imageContentHash: '4'.repeat(64) }
        ],
        setDigest: SET_DIGEST
      }
    },
    ...overrides
  });
}

function multiPageInventory(markers, overrides = {}) {
  return {
    figure_id: 'figure-1',
    visual_evidence_set_digest: SET_DIGEST,
    semantic_context_digest: SEMANTIC_DIGEST,
    inventory_complete: true,
    markers,
    ...overrides
  };
}

test('defines a strict embeddable inventory schema and standalone wrapper', () => {
  assert.equal(PDF_FIGURE_PANEL_INVENTORY_VERSION, 'pdf-figure-panel-inventory-v2');
  const schema = createPdfFigurePanelInventorySchema();
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    'figure_id', 'image_content_hash', 'semantic_context_digest',
    'inventory_complete', 'markers'
  ]);
  assert.equal(schema.properties.markers.maxItems, 30);
  assert.deepEqual(schema.properties.markers.items.properties.clarity.enum,
    ['clear', 'uncertain']);
  assert.equal(schema.properties.markers.items.additionalProperties, false);
  assert.deepEqual(schema.properties.markers.items.required, ['label', 'clarity']);
  assert.deepEqual(Object.keys(schema.properties.markers.items.properties).sort(),
    ['clarity', 'label']);
  assert.equal(schema.properties.markers.items.properties.bbox, undefined);

  const response = createPdfFigurePanelInventoryResponseSchema();
  assert.equal(response.additionalProperties, false);
  assert.deepEqual(response.required, ['panel_marker_inventory']);
  assert.deepEqual(response.properties.panel_marker_inventory, schema);
});

test('binds a complete ordered multi-page artwork set and maps each marker to its source page', () => {
  assert.equal(PDF_FIGURE_PANEL_INVENTORY_SET_VERSION,
    'pdf-figure-panel-inventory-v3');
  const schema = createPdfFigurePanelInventorySetSchema();
  assert.deepEqual(schema.required, [
    'figure_id', 'visual_evidence_set_digest', 'semantic_context_digest',
    'inventory_complete', 'markers'
  ]);
  assert.deepEqual(schema.properties.markers.items.required,
    ['label', 'clarity', 'page_number']);

  const compiled = compilePdfFigurePanelInventoryPrompt(multiPageContext(), {
    mode: 'first-whole'
  });
  assert.equal(compiled.validationContext.version,
    'pdf-figure-panel-inventory-v3');
  assert.equal(compiled.userPayload.contract_version,
    'pdf-figure-panel-inventory-v3');
  assert.match(compiled.systemPrompt, /each supplied image.*page|image.*page manifest/is);
  assert.deepEqual(compiled.userPayload.figure_identity.caption_page_numbers, [8, 9]);
  assert.deepEqual(compiled.userPayload.figure_identity.artwork_page_numbers, [8, 9]);
  assert.deepEqual(compiled.userPayload.provenance.image_manifest, [
    { image_index: 0, page_number: 8, image_content_hash: IMAGE_HASH },
    { image_index: 1, page_number: 9, image_content_hash: '4'.repeat(64) }
  ]);
  assert.equal(compiled.userPayload.provenance.visual_evidence_set_digest, SET_DIGEST);

  const result = validatePdfFigurePanelInventory(multiPageInventory([
    { label: 'A', clarity: 'clear', page_number: 8 },
    { label: 'H', clarity: 'clear', page_number: 9 }
  ]), multiPageContext());
  assert.equal(result.coverageComplete, true);
  assert.deepEqual(result.markers, [
    { label: 'A', clarity: 'clear', pageNumber: 8 },
    { label: 'H', clarity: 'clear', pageNumber: 9 }
  ]);
  assert.deepEqual(result.panelPageMap, { A: 8, H: 9 });
  assert.equal(result.provenance.visualEvidenceSetDigest, SET_DIGEST);

  assert.throws(() => validatePdfFigurePanelInventory(multiPageInventory([
    { label: 'A', clarity: 'clear', page_number: 10 }
  ]), multiPageContext()), { code: 'PDF_FIGURE_PANEL_INVENTORY_PAGE_INVALID' });
  assert.throws(() => compilePdfFigurePanelInventoryPrompt(multiPageContext({
    pdfEvidenceBinding: {
      ...multiPageContext().pdfEvidenceBinding,
      visualEvidenceSet: {
        ...multiPageContext().pdfEvidenceBinding.visualEvidenceSet,
        coverageComplete: false
      }
    }
  })), { code: 'PDF_FIGURE_PANEL_INVENTORY_INELIGIBLE' });
});

test('prompt builder anchors a whole-page image to the target Figure and forbids inferred labels', () => {
  for (const mode of ['first-whole', 'first-batch', 'standalone']) {
    const compiled = compilePdfFigurePanelInventoryPrompt(context(), { mode });
    assert.equal(compiled.mode, mode);
    assert.equal(compiled.responseField, 'panel_marker_inventory');
    assert.match(compiled.schemaName, /pdf_figure_panel_inventory/u);
    assert.match(compiled.systemPrompt, /whole PDF page/i);
    assert.match(compiled.systemPrompt, /figure identity|target Figure/i);
    assert.match(compiled.systemPrompt, /do not infer.*alphabet|alphabet.*do not infer/i);
    assert.match(compiled.systemPrompt, /axes|axis/i);
    assert.match(compiled.systemPrompt, /significance/i);
    assert.match(compiled.systemPrompt, /group/i);
    assert.match(compiled.systemPrompt, /top to bottom/i);
    assert.match(compiled.systemPrompt, /left to right/i);
    assert.match(compiled.systemPrompt, /real|actual/i);
    assert.doesNotMatch(compiled.systemPrompt, /bounding box|coordinates|geometry/i);
    assert.ok(compiled.systemPrompt.indexOf('locate the target Figure') <
      compiled.systemPrompt.indexOf('label glyph'));
    const payload = JSON.parse(compiled.userPrompt);
    assert.equal(payload.figure_identity.figure_id, 'figure-1');
    assert.equal(payload.figure_identity.figure_label, 'Figure 1');
    assert.deepEqual(payload.figure_identity.page_numbers, [4]);
    assert.deepEqual(payload.figure_identity.caption_page_numbers, [4]);
    assert.deepEqual(payload.figure_identity.artwork_page_numbers, [4]);
    assert.match(payload.figure_identity.caption_anchor, /microglial motility/u);
    assert.deepEqual(payload.caption_known_panel_labels, ['B', 'C', 'D']);
    assert.equal(payload.provenance.image_content_hash, IMAGE_HASH);
    assert.equal(payload.provenance.semantic_context_digest, SEMANTIC_DIGEST);
  }
});

test('derives A-D only from explicit clear markers when the caption knows B-D', () => {
  const result = validatePdfFigurePanelInventory(inventory([
    marker('A'), marker('B'), marker('C'), marker('D')
  ]), context());

  assert.deepEqual(result.captionKnownPanels, ['B', 'C', 'D']);
  assert.deepEqual(result.visualMarkerPanels, ['A', 'B', 'C', 'D']);
  assert.deepEqual(result.effectivePanels, ['A', 'B', 'C', 'D']);
  assert.deepEqual(result.discoveredPanels, ['A']);
  assert.deepEqual(result.uncertainPanels, []);
  assert.equal(result.coverageScope, 'full-figure-visual-markers');
  assert.equal(result.coverageComplete, true);
  assert.equal(result.scientificQualityEvaluated, false);
  assert.equal(result.inventoryReportedComplete, true);
  assert.equal(result.provenance.figureId, 'figure-1');
  assert.equal(result.provenance.imageContentHash, IMAGE_HASH);
  assert.equal(result.provenance.semanticContextDigest, SEMANTIC_DIGEST);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.markers), true);
  assert.equal(Object.isFrozen(result.markers[0]), true);
  assert.deepEqual(result.markers[0], { label: 'A', clarity: 'clear' });
});

test('preserves model visual order and never fills alphabetic gaps', () => {
  const onlyBd = context({ captionKnownPanels: ['B', 'D'] });
  const result = validatePdfFigurePanelInventory(inventory([
    marker('D'), marker('B')
  ]), onlyBd);
  assert.deepEqual(result.visualMarkerPanels, ['D', 'B']);
  assert.deepEqual(result.effectivePanels, ['D', 'B']);
  assert.deepEqual(result.markers.map(item => item.label), ['D', 'B']);
  assert.deepEqual(result.discoveredPanels, []);
  assert.doesNotMatch(result.effectivePanels.join(''), /A|C/u);
});

test('uncertain markers never extend scope or establish complete visual coverage', () => {
  const result = validatePdfFigurePanelInventory(inventory([
    marker('A', 'uncertain'), marker('B'), marker('C'), marker('D')
  ]), context());
  assert.deepEqual(result.visualMarkerPanels, ['B', 'C', 'D']);
  assert.deepEqual(result.effectivePanels, ['B', 'C', 'D']);
  assert.deepEqual(result.discoveredPanels, []);
  assert.deepEqual(result.uncertainPanels, ['A']);
  assert.equal(result.coverageScope, 'partial-full-figure-visual-markers');
  assert.equal(result.coverageComplete, false);
});

test('model complete=true alone cannot establish complete coverage', () => {
  const result = validatePdfFigurePanelInventory(inventory([
    marker('A')
  ]), context());
  assert.equal(result.inventoryReportedComplete, true);
  assert.deepEqual(result.visualMarkerPanels, ['A']);
  assert.deepEqual(result.effectivePanels, ['A', 'B', 'C', 'D']);
  assert.equal(result.coverageScope, 'partial-full-figure-visual-markers');
  assert.equal(result.coverageComplete, false,
    'every caption-known marker must also be visibly clear before coverage is complete');
});

test('rejects duplicate labels, excess markers, unknown labels, and legacy coordinates', () => {
  assert.throws(() => validatePdfFigurePanelInventory(inventory([
    marker('A'), marker('a')
  ]), context()), { code: 'PDF_FIGURE_PANEL_INVENTORY_DUPLICATED' });

  assert.throws(() => validatePdfFigurePanelInventory(inventory(
    Array.from({ length: 31 }, (_, index) => marker(`A${index}`))
  ), context()), { code: 'PDF_FIGURE_PANEL_INVENTORY_INVALID' });

  assert.throws(() => validatePdfFigurePanelInventory(inventory([
    marker('turnover')
  ]), context()), { code: 'PDF_FIGURE_PANEL_INVENTORY_LABEL_INVALID' });

  assert.throws(() => validatePdfFigurePanelInventory(inventory([
    marker('A', 'clear', { bbox: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 } })
  ]), context()), { code: 'PDF_FIGURE_PANEL_INVENTORY_INVALID' });
  assert.throws(() => validatePdfFigurePanelInventory(inventory([
    marker('A', 'clear', { x: 0.1, y: 0.1 })
  ]), context()), { code: 'PDF_FIGURE_PANEL_INVENTORY_INVALID' });
});

test('rejects non-string response labels and non-string caption-known labels', () => {
  for (const label of [1, ['A'], { toString: () => 'A' }]) {
    assert.throws(() => validatePdfFigurePanelInventory(inventory([
      marker(label)
    ]), context()), { code: 'PDF_FIGURE_PANEL_INVENTORY_LABEL_INVALID' });
  }
  for (const captionKnownPanels of [[1], [['A']], [{ toString: () => 'A' }]]) {
    assert.throws(() => normalizePdfFigurePanelInventoryContext(context({
      captionKnownPanels
    })), { code: 'PDF_FIGURE_PANEL_INVENTORY_CONTEXT_INVALID' });
  }
  for (const label of [' A ', 'Ａ', 'α', 'ſ', 'ı']) {
    assert.throws(() => validatePdfFigurePanelInventory(inventory([
      marker(label)
    ]), context()), { code: 'PDF_FIGURE_PANEL_INVENTORY_LABEL_INVALID' });
    assert.throws(() => normalizePdfFigurePanelInventoryContext(context({
      captionKnownPanels: [label]
    })), { code: 'PDF_FIGURE_PANEL_INVENTORY_CONTEXT_INVALID' });
  }
});

test('rejects an effective caption-plus-visual union above thirty Panels', () => {
  const captionKnownPanels = Array.from({ length: 30 }, (_, index) => `A${index}`);
  const visual = Array.from({ length: 30 }, (_, index) =>
    marker(`B${index}`)
  );
  assert.throws(() => validatePdfFigurePanelInventory(
    inventory(visual), context({ captionKnownPanels })
  ), { code: 'PDF_FIGURE_PANEL_INVENTORY_EFFECTIVE_LIMIT' });
});

test('rejects unknown object fields and mismatched Figure, asset, or semantic provenance', () => {
  assert.throws(() => validatePdfFigurePanelInventory(inventory([
    marker('A', 'clear', { extra: true })
  ]), context()), { code: 'PDF_FIGURE_PANEL_INVENTORY_INVALID' });
  assert.throws(() => validatePdfFigurePanelInventory(inventory([
    marker('A', 'clear', { bbox: {
      x: 0.1, y: 0.1, width: 0.1, height: 0.1, secret: 1
    } })
  ]), context()), { code: 'PDF_FIGURE_PANEL_INVENTORY_INVALID' });
  assert.throws(() => validatePdfFigurePanelInventory({
    ...inventory([marker('A')]), extra: true
  }, context()), { code: 'PDF_FIGURE_PANEL_INVENTORY_INVALID' });

  for (const changed of [
    { figure_id: 'figure-2' },
    { image_content_hash: '3'.repeat(64) },
    { semantic_context_digest: '4'.repeat(64) }
  ]) {
    assert.throws(() => validatePdfFigurePanelInventory(inventory([
      marker('A')
    ], changed), context()), { code: 'PDF_FIGURE_PANEL_INVENTORY_BINDING_CONFLICT' });
  }
});

test('text, HTML, page-region, and Panel-crop contexts can never upgrade caption scope', () => {
  const cases = [
    context({ capabilityMode: 'text-only', imageInputCount: 0 }),
    context({ sourceKind: 'html' }),
    context({ pdfEvidenceBinding: {
      semanticContextDigest: SEMANTIC_DIGEST,
      assetProof: { figureId: 'figure-1', sourceType: 'page-region', imageContentHash: IMAGE_HASH }
    } }),
    context({ pdfEvidenceBinding: {
      semanticContextDigest: SEMANTIC_DIGEST,
      assetProof: { figureId: 'figure-1', sourceType: 'panel', imageContentHash: IMAGE_HASH }
    } })
  ];
  for (const candidate of cases) {
    const normalized = normalizePdfFigurePanelInventoryContext(candidate);
    assert.equal(normalized.discoveryAllowed, false);
    assert.throws(() => compilePdfFigurePanelInventoryPrompt(candidate, {
      mode: 'first-whole'
    }), { code: 'PDF_FIGURE_PANEL_INVENTORY_INELIGIBLE' });
    const captionOnly = derivePdfFigurePanelCoverage(null, candidate);
    assert.deepEqual(captionOnly.effectivePanels, ['B', 'C', 'D']);
    assert.deepEqual(captionOnly.visualMarkerPanels, []);
    assert.deepEqual(captionOnly.discoveredPanels, []);
    assert.equal(captionOnly.coverageScope, 'caption-known-only');
    assert.equal(captionOnly.coverageComplete, false);
    assert.equal(captionOnly.scientificQualityEvaluated, false);
    assert.throws(() => validatePdfFigurePanelInventory(inventory([
      marker('A')
    ]), candidate), { code: 'PDF_FIGURE_PANEL_INVENTORY_INELIGIBLE' });
  }
});

test('rejects unknown embedding modes without weakening an eligible context', () => {
  assert.throws(() => compilePdfFigurePanelInventoryPrompt(context(), {
    mode: 'later-batch'
  }), { code: 'PDF_FIGURE_PANEL_INVENTORY_MODE_INVALID' });
});
