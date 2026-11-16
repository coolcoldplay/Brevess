(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const VERSION = 'pdf-figure-panel-inventory-v2';
  const SET_VERSION = 'pdf-figure-panel-inventory-v3';
  const HASH_PATTERN = /^[a-f0-9]{64}$/u;
  const FIGURE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/iu;
  const PANEL_LABEL_PATTERN = /^(?:[A-Z](?:[0-9]{0,2})?|[0-9]{1,3})$/u;
  const MODES = new Set(['first-whole', 'first-batch', 'standalone']);
  const INVENTORY_KEYS = [
    'figure_id', 'image_content_hash', 'semantic_context_digest',
    'inventory_complete', 'markers'
  ];
  const SET_INVENTORY_KEYS = [
    'figure_id', 'visual_evidence_set_digest', 'semantic_context_digest',
    'inventory_complete', 'markers'
  ];
  const MARKER_KEYS = ['label', 'clarity'];
  const SET_MARKER_KEYS = ['label', 'clarity', 'page_number'];

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function plainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function exactKeys(value, keys) {
    if (!plainObject(value)) return false;
    const actual = Object.keys(value);
    return actual.length === keys.length && actual.every(key => keys.includes(key)) &&
      keys.every(key => Object.hasOwn(value, key));
  }

  function cleanText(value, maximum = 1200) {
    return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
      .slice(0, maximum);
  }

  function canonicalHash(value) {
    const hash = String(value || '').trim().toLowerCase().replace(/^sha256:/u, '');
    return HASH_PATTERN.test(hash) ? hash : '';
  }

  function canonicalPanelLabel(value) {
    if (typeof value !== 'string' || !/^(?:[A-Za-z](?:[0-9]{0,2})?|[0-9]{1,3})$/u.test(value)) return '';
    const label = value.toUpperCase();
    return PANEL_LABEL_PATTERN.test(label) ? label : '';
  }

  function normalizedPanelLabels(value) {
    if (!Array.isArray(value) || value.length > 30) {
      fail('PDF_FIGURE_PANEL_INVENTORY_CONTEXT_INVALID');
    }
    const result = [];
    for (const raw of value) {
      const label = canonicalPanelLabel(raw);
      if (!label) fail('PDF_FIGURE_PANEL_INVENTORY_CONTEXT_INVALID');
      if (!result.includes(label)) result.push(label);
    }
    return result;
  }

  function normalizedPages(value) {
    if (!Array.isArray(value) || !value.length || value.length > 64) return [];
    const result = [];
    for (const raw of value) {
      const page = Number(raw);
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return [];
      if (!result.includes(page)) result.push(page);
    }
    return result;
  }

  function normalizePdfFigurePanelInventoryContext(input = {}) {
    const binding = plainObject(input.pdfEvidenceBinding) ? input.pdfEvidenceBinding : {};
    const proof = plainObject(binding.assetProof) ? binding.assetProof : {};
    const visualSet = plainObject(binding.visualEvidenceSet)
      ? binding.visualEvidenceSet : null;
    const setAssets = Array.isArray(visualSet?.assets) ? visualSet.assets : [];
    const multiPage = visualSet?.version === 'pdf-figure-visual-evidence-set-v1';
    const figureId = cleanText(input.figureId, 128);
    const proofFigureId = cleanText(multiPage ? visualSet.figureId : proof.figureId, 128);
    const figureLabel = cleanText(input.figureLabel, 160);
    const pageNumbers = normalizedPages(input.pageNumbers);
    const captionPageNumbers = normalizedPages(input.captionPageNumbers || input.pageNumbers);
    const artworkPageNumbers = normalizedPages(input.artworkPageNumbers ||
      (multiPage ? visualSet.requiredArtworkPageNumbers : input.pageNumbers));
    const captionAnchor = cleanText(input.captionAnchor, 1200);
    const captionKnownPanels = normalizedPanelLabels(input.captionKnownPanels || []);
    const imageContentHash = canonicalHash(proof.imageContentHash);
    const visualEvidenceSetDigest = canonicalHash(visualSet?.setDigest);
    const semanticContextDigest = canonicalHash(binding.semanticContextDigest);
    const sourceKind = cleanText(input.sourceKind, 32).toLowerCase();
    const capabilityMode = cleanText(input.capabilityMode, 32).toLowerCase();
    const imageInputCount = Number(input.imageInputCount);
    const sourceType = cleanText(proof.sourceType, 32).toLowerCase();
    const validFigureId = FIGURE_ID_PATTERN.test(figureId);
    const assetManifest = multiPage ? setAssets.map((asset, imageIndex) => ({
      imageIndex,
      pageNumber: Number(asset?.pageNumber),
      imageContentHash: canonicalHash(asset?.imageContentHash)
    })) : [];
    const orderedSetValid = multiPage && visualSet.coverageComplete === true &&
      artworkPageNumbers.length >= 2 && artworkPageNumbers.length <= 4 &&
      setAssets.length === artworkPageNumbers.length &&
      assetManifest.every((asset, index) => asset.pageNumber === artworkPageNumbers[index] &&
        Boolean(asset.imageContentHash)) &&
      normalizedPages(visualSet.requiredArtworkPageNumbers).join(',') ===
        artworkPageNumbers.join(',');
    const bindingValid = validFigureId && proofFigureId === figureId &&
      Boolean(semanticContextDigest && (multiPage
        ? visualEvidenceSetDigest && orderedSetValid : imageContentHash));
    const identityAnchored = Boolean(figureLabel && captionPageNumbers.length &&
      artworkPageNumbers.length && captionAnchor);
    let reasonCode = '';
    if (sourceKind !== 'pdf') reasonCode = 'PDF_FIGURE_PANEL_INVENTORY_NOT_PDF';
    else if (capabilityMode !== 'vision') {
      reasonCode = 'PDF_FIGURE_PANEL_INVENTORY_VISION_REQUIRED';
    } else if (!Number.isSafeInteger(imageInputCount) || imageInputCount !==
        (multiPage ? setAssets.length : 1)) {
      reasonCode = 'PDF_FIGURE_PANEL_INVENTORY_IMAGE_COUNT_INVALID';
    } else if (multiPage && !orderedSetValid) {
      reasonCode = visualSet.coverageComplete === true
        ? 'PDF_FIGURE_PANEL_INVENTORY_BINDING_INVALID'
        : 'PDF_FIGURE_PANEL_INVENTORY_ARTWORK_COVERAGE_INCOMPLETE';
    } else if (!bindingValid) {
      reasonCode = 'PDF_FIGURE_PANEL_INVENTORY_BINDING_INVALID';
    } else if (!multiPage && sourceType !== 'full-figure') {
      reasonCode = 'PDF_FIGURE_PANEL_INVENTORY_FULL_FIGURE_REQUIRED';
    } else if (!identityAnchored) {
      reasonCode = 'PDF_FIGURE_PANEL_INVENTORY_IDENTITY_INCOMPLETE';
    }
    return deepFreeze({
      version: multiPage ? SET_VERSION : VERSION,
      discoveryAllowed: !reasonCode,
      reasonCode,
      sourceKind,
      capabilityMode,
      imageInputCount: Number.isSafeInteger(imageInputCount) ? imageInputCount : 0,
      sourceType: multiPage ? 'visual-evidence-set' : sourceType,
      figureId,
      figureLabel,
      pageNumbers,
      captionPageNumbers,
      artworkPageNumbers,
      captionAnchor,
      captionKnownPanels,
      provenance: {
        figureId,
        imageContentHash,
        visualEvidenceSetDigest,
        imageManifest: assetManifest,
        semanticContextDigest
      }
    });
  }

  function markerSchema(multiPage = false) {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: { type: 'string', pattern: '^(?:[A-Za-z](?:[0-9]{0,2})?|[0-9]{1,3})$' },
        clarity: { type: 'string', enum: ['clear', 'uncertain'] },
        ...(multiPage ? { page_number: { type: 'integer', minimum: 1 } } : {})
      },
      required: (multiPage ? SET_MARKER_KEYS : MARKER_KEYS).slice()
    };
  }

  function createPdfFigurePanelInventorySchema() {
    return deepFreeze({
      type: 'object',
      additionalProperties: false,
      properties: {
        figure_id: { type: 'string', maxLength: 128 },
        image_content_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        semantic_context_digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        inventory_complete: { type: 'boolean' },
        markers: { type: 'array', minItems: 0, maxItems: 30, items: markerSchema() }
      },
      required: INVENTORY_KEYS.slice()
    });
  }

  function createPdfFigurePanelInventoryResponseSchema() {
    return deepFreeze({
      type: 'object',
      additionalProperties: false,
      properties: {
        panel_marker_inventory: createPdfFigurePanelInventorySchema()
      },
      required: ['panel_marker_inventory']
    });
  }

  function createPdfFigurePanelInventorySetSchema() {
    return deepFreeze({
      type: 'object',
      additionalProperties: false,
      properties: {
        figure_id: { type: 'string', maxLength: 128 },
        visual_evidence_set_digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        semantic_context_digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        inventory_complete: { type: 'boolean' },
        markers: { type: 'array', minItems: 0, maxItems: 30,
          items: markerSchema(true) }
      },
      required: SET_INVENTORY_KEYS.slice()
    });
  }

  function compilePdfFigurePanelInventoryPrompt(input = {}, options = {}) {
    const context = normalizePdfFigurePanelInventoryContext(input);
    const mode = String(options.mode || 'standalone');
    if (!MODES.has(mode)) fail('PDF_FIGURE_PANEL_INVENTORY_MODE_INVALID');
    if (!context.discoveryAllowed) fail('PDF_FIGURE_PANEL_INVENTORY_INELIGIBLE');
    const multiPage = context.version === SET_VERSION;
    const systemPrompt = [
      multiPage
        ? 'Inspect Panel-marker glyphs only inside the target Figure across every supplied PDF page image. Each supplied image maps to exactly one artwork page in the ordered image-to-page manifest; inspect all images independently and never stitch, merge, or downscale them as one long image.'
        : 'Inspect Panel-marker glyphs only inside the target Figure in the supplied whole PDF page image.',
      multiPage
        ? 'Use the supplied Figure identity, printed Figure label, distinct caption pages, artwork pages, caption anchor, and image-to-page manifest to locate the target Figure. Return the source page_number for every marker.'
        : 'Use the supplied Figure identity, printed Figure label, distinct caption and artwork page numbers, and caption anchor to locate the target Figure first. Then read the actual label glyphs from that Figure in the supplied image. A caption continuation page is not an artwork image. The page may also contain body text, another Figure reference, supplements, video links, headers, footers, or other scientific graphics; ignore everything outside the matched target Figure.',
      'Record a marker only when its label glyph is directly visible next to a distinct Panel region. Preserve visual reading order in the markers array: top to bottom, and within the same row left to right. Do not sort alphabetically. Do not infer missing labels from alphabetic sequence or gaps.',
      'Axis labels, axis ticks, statistical or significance letters, treatment or genotype group labels, legend letters, scale-bar text, body citations, and caption references are not Panel markers.',
      'Use clarity clear only for a directly legible marker. Use uncertain when a possible marker cannot be read reliably. Never promote uncertain markers into the analyzed Panel scope.',
      'Return label and clarity only. Do not perform geometric measurement or return scientific interpretations, measurements, or conclusions in this inventory field.',
      mode === 'first-batch'
        ? 'This inventory accompanies the first extraction batch. Keep the batch Panel records restricted to their separately requested labels.'
        : mode === 'first-whole'
          ? 'This inventory accompanies the first whole-Figure walkthrough.'
          : 'Return only the standalone strict Panel-marker inventory response.'
    ].join('\n');
    const userPayload = {
      contract_version: context.version,
      mode,
      figure_identity: {
        figure_id: context.figureId,
        figure_label: context.figureLabel,
        page_numbers: context.pageNumbers,
        caption_page_numbers: context.captionPageNumbers,
        artwork_page_numbers: context.artworkPageNumbers,
        caption_anchor: context.captionAnchor
      },
      caption_known_panel_labels: context.captionKnownPanels,
      provenance: {
        ...(multiPage ? {
          visual_evidence_set_digest: context.provenance.visualEvidenceSetDigest,
          image_manifest: context.provenance.imageManifest.map(item => ({
            image_index: item.imageIndex,
            page_number: item.pageNumber,
            image_content_hash: item.imageContentHash
          }))
        } : { image_content_hash: context.provenance.imageContentHash }),
        semantic_context_digest: context.provenance.semanticContextDigest
      }
    };
    const fieldSchema = multiPage
      ? createPdfFigurePanelInventorySetSchema()
      : createPdfFigurePanelInventorySchema();
    return deepFreeze({
      mode,
      systemPrompt,
      userPayload,
      userPrompt: JSON.stringify(userPayload),
      responseField: 'panel_marker_inventory',
      responseFieldSchema: fieldSchema,
      responseSchema: mode === 'standalone'
        ? deepFreeze({ type: 'object', additionalProperties: false,
          properties: { panel_marker_inventory: fieldSchema },
          required: ['panel_marker_inventory'] }) : fieldSchema,
      schemaName: `pdf_figure_panel_inventory_${mode.replace(/-/gu, '_')}`,
      validationContext: context
    });
  }

  function captionOnlyCoverage(context) {
    return deepFreeze({
      version: VERSION,
      discoveryAllowed: context.discoveryAllowed,
      eligibilityReasonCode: context.reasonCode,
      provenance: { ...context.provenance },
      captionKnownPanels: [...context.captionKnownPanels],
      visualMarkerPanels: [],
      effectivePanels: [...context.captionKnownPanels],
      discoveredPanels: [],
      uncertainPanels: [],
      markers: [],
      panelPageMap: {},
      inventoryReportedComplete: false,
      coverageScope: 'caption-known-only',
      coverageComplete: false,
      scientificQualityEvaluated: false
    });
  }

  function validatePdfFigurePanelInventory(value, input = {}) {
    const context = normalizePdfFigurePanelInventoryContext(input);
    if (!context.discoveryAllowed) fail('PDF_FIGURE_PANEL_INVENTORY_INELIGIBLE');
    const multiPage = context.version === SET_VERSION;
    const inventoryKeys = multiPage ? SET_INVENTORY_KEYS : INVENTORY_KEYS;
    const markerKeys = multiPage ? SET_MARKER_KEYS : MARKER_KEYS;
    if (!exactKeys(value, inventoryKeys) || typeof value.inventory_complete !== 'boolean' ||
        !Array.isArray(value.markers) || value.markers.length > 30) {
      fail('PDF_FIGURE_PANEL_INVENTORY_INVALID');
    }
    if (value.figure_id !== context.provenance.figureId ||
        (multiPage
          ? value.visual_evidence_set_digest !== context.provenance.visualEvidenceSetDigest
          : value.image_content_hash !== context.provenance.imageContentHash) ||
        value.semantic_context_digest !== context.provenance.semanticContextDigest) {
      fail('PDF_FIGURE_PANEL_INVENTORY_BINDING_CONFLICT');
    }
    const markers = [];
    const seen = new Set();
    for (const raw of value.markers) {
      if (!exactKeys(raw, markerKeys) ||
          !['clear', 'uncertain'].includes(raw.clarity)) {
        fail('PDF_FIGURE_PANEL_INVENTORY_INVALID');
      }
      const label = canonicalPanelLabel(raw.label);
      if (!label) fail('PDF_FIGURE_PANEL_INVENTORY_LABEL_INVALID');
      if (seen.has(label)) fail('PDF_FIGURE_PANEL_INVENTORY_DUPLICATED');
      seen.add(label);
      if (multiPage && !context.artworkPageNumbers.includes(raw.page_number)) {
        fail('PDF_FIGURE_PANEL_INVENTORY_PAGE_INVALID');
      }
      markers.push({ label, clarity: raw.clarity,
        ...(multiPage ? { pageNumber: raw.page_number } : {}) });
    }
    const visualMarkerPanels = markers.filter(item => item.clarity === 'clear')
      .map(item => item.label);
    const uncertainPanels = markers.filter(item => item.clarity === 'uncertain')
      .map(item => item.label);
    const effectivePanels = [...visualMarkerPanels];
    for (const panel of context.captionKnownPanels) {
      if (!effectivePanels.includes(panel)) effectivePanels.push(panel);
    }
    if (effectivePanels.length > 30) {
      fail('PDF_FIGURE_PANEL_INVENTORY_EFFECTIVE_LIMIT');
    }
    const discoveredPanels = visualMarkerPanels.filter(panel =>
      !context.captionKnownPanels.includes(panel)
    );
    const allCaptionKnownMarkersClear = context.captionKnownPanels.every(panel =>
      visualMarkerPanels.includes(panel)
    );
    // `inventory_complete` is only a model statement. Local shape, binding,
    // clear-marker, uncertainty, and caption-known coverage checks must all
    // pass before the result is represented as complete coverage.
    const coverageComplete = value.inventory_complete === true && markers.length > 0 &&
      visualMarkerPanels.length > 0 && uncertainPanels.length === 0 &&
      allCaptionKnownMarkersClear;
    return deepFreeze({
      version: multiPage ? SET_VERSION : VERSION,
      discoveryAllowed: true,
      eligibilityReasonCode: '',
      provenance: { ...context.provenance },
      captionKnownPanels: [...context.captionKnownPanels],
      visualMarkerPanels,
      effectivePanels,
      discoveredPanels,
      uncertainPanels,
      markers,
      panelPageMap: Object.fromEntries(markers
        .filter(item => item.clarity === 'clear' && item.pageNumber)
        .map(item => [item.label, item.pageNumber])),
      inventoryReportedComplete: value.inventory_complete,
      coverageScope: coverageComplete
        ? 'full-figure-visual-markers'
        : visualMarkerPanels.length
          ? 'partial-full-figure-visual-markers' : 'caption-known-only',
      coverageComplete,
      scientificQualityEvaluated: false
    });
  }

  function derivePdfFigurePanelCoverage(value, input = {}) {
    const context = normalizePdfFigurePanelInventoryContext(input);
    return value == null ? captionOnlyCoverage(context)
      : validatePdfFigurePanelInventory(value, input);
  }

  return {
    PDF_FIGURE_PANEL_INVENTORY_VERSION: VERSION,
    PDF_FIGURE_PANEL_INVENTORY_SET_VERSION: SET_VERSION,
    createPdfFigurePanelInventorySchema,
    createPdfFigurePanelInventorySetSchema,
    createPdfFigurePanelInventoryResponseSchema,
    compilePdfFigurePanelInventoryPrompt,
    normalizePdfFigurePanelInventoryContext,
    derivePdfFigurePanelCoverage,
    validatePdfFigurePanelInventory
  };
});
