(function attach(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(root) {
  const HASH = /^[a-f0-9]{64}$/u;
  const positive = value => Number.isSafeInteger(value) && value > 0;
  const fail = code => { const error = new Error(code); error.code = code; throw error; };
  const ordered = value => Array.isArray(value) ? value.map(ordered) :
    value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]))
      : value;
  const json = value => JSON.stringify(ordered(value));

  async function digest(bytes) {
    if (root.crypto?.subtle) {
      const value = await root.crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(value)].map(item => item.toString(16).padStart(2, '0')).join('');
    }
    if (typeof require === 'function') return require('node:crypto')
      .createHash('sha256').update(bytes).digest('hex');
    fail('PDF_FIGURE_DIGEST_UNAVAILABLE');
  }

  async function imageDigest(image) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u
      .exec(String(image?.dataUrl || ''));
    if (!match || match[2].length > 32 * 1024 * 1024 || match[2].length % 4 !== 0) {
      fail('PDF_FIGURE_ASSET_BYTES_INVALID');
    }
    let binary;
    try { binary = root.atob(match[2]); }
    catch (_) { fail('PDF_FIGURE_ASSET_BYTES_INVALID'); }
    return { hash: await digest(Uint8Array.from(binary, char => char.charCodeAt(0))),
      mimeType: match[1] };
  }

  function validBinding(binding) {
    return HASH.test(binding?.documentHash || '') &&
      positive(binding?.documentGeneration) && positive(binding?.semanticRevision);
  }

  function orderedArtworkPages(value) {
    if (!Array.isArray(value) || value.length < 2) {
      fail('PDF_FIGURE_ARTWORK_PAGES_INVALID');
    }
    if (value.length > 4) fail('PDF_FIGURE_MULTI_ASSET_LIMIT');
    const pages = value.map(page => positive(page) ? page : 0);
    if (pages.includes(0) || new Set(pages).size !== pages.length) {
      fail('PDF_FIGURE_ARTWORK_PAGES_INVALID');
    }
    return pages;
  }

  function validBoundAssetProof(proof, binding, figureId) {
    return /^pdfa-[a-f0-9]{48}$/u.test(proof?.assetId || '') &&
      HASH.test(proof?.imageContentHash || '') && proof.figureId === figureId &&
      ['documentHash', 'documentGeneration', 'semanticRevision']
        .every(key => proof[key] === binding[key]) &&
      positive(proof.assetRevision) && positive(proof.width) && positive(proof.height) &&
      /^image\/(?:png|jpeg|webp)$/u.test(proof.mimeType || '') &&
      ['full-figure', 'page-region', 'panel'].includes(proof.sourceType);
  }

  async function createPdfFigureVisualEvidenceSet(value = {}) {
    const figureId = String(value.figureId || '');
    const binding = value.binding;
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/iu.test(figureId) || !validBinding(binding)) {
      fail('PDF_FIGURE_ASSET_BINDING_CONFLICT');
    }
    const requiredArtworkPageNumbers = orderedArtworkPages(value.requiredArtworkPageNumbers);
    if (value.coverageComplete !== true) fail('PDF_FIGURE_ARTWORK_COVERAGE_INCOMPLETE');
    if (!Array.isArray(value.assets) || value.assets.length !== requiredArtworkPageNumbers.length) {
      fail('PDF_FIGURE_IMAGE_COUNT_INVALID');
    }
    const assets = value.assets.map((asset, index) => {
      let proof;
      try { proof = JSON.parse(JSON.stringify(asset)); }
      catch (_) { fail('PDF_FIGURE_ASSET_BINDING_CONFLICT'); }
      if (!validBoundAssetProof(proof, binding, figureId) ||
          proof.sourceType !== 'page-region' ||
          proof.pageNumber !== requiredArtworkPageNumbers[index]) {
        fail('PDF_FIGURE_ASSET_BINDING_CONFLICT');
      }
      return proof;
    });
    if (new Set(assets.map(asset => asset.assetId)).size !== assets.length) {
      fail('PDF_FIGURE_ASSET_BINDING_CONFLICT');
    }
    const payload = {
      version: 'pdf-figure-visual-evidence-set-v1',
      figureId,
      binding: JSON.parse(JSON.stringify(binding)),
      requiredArtworkPageNumbers,
      coverageComplete: true,
      assets
    };
    return {
      ...payload,
      setDigest: await digest(new TextEncoder().encode(json(payload)))
    };
  }

  async function verifiedVisualEvidenceSet(value, binding, figureId) {
    if (!value || value.version !== 'pdf-figure-visual-evidence-set-v1' ||
        value.figureId !== figureId || json(value.binding) !== json(binding)) {
      fail('PDF_FIGURE_ASSET_BINDING_CONFLICT');
    }
    const recreated = await createPdfFigureVisualEvidenceSet(value);
    if (!HASH.test(value.setDigest || '') || value.setDigest !== recreated.setDigest ||
        json(value) !== json(recreated)) {
      fail('PDF_FIGURE_VISUAL_SET_DIGEST_MISMATCH');
    }
    return recreated;
  }

  async function pdfFigureSemanticEvidenceDigest(envelope) {
    if (!validBinding(envelope?.binding) || !envelope.figure ||
        envelope.textualEvidence?.version !== 2) fail('PDF_FIGURE_CONTEXT_INVALID');
    // Stable across a fresh reader generation, but never across different
    // documents, target Figures, selected text or exact source fragments.
    return digest(new TextEncoder().encode(json({
      documentHash: envelope.binding.documentHash,
      target: envelope.figure,
      textualEvidence: envelope.textualEvidence
    })));
  }

  async function pdfFigurePanelDirectoryDigest(inventory) {
    return digest(new TextEncoder().encode(json({
      domain: 'pdf-figure-panel-directory-v1', inventory
    })));
  }

  function verifiedEvidence(items, kind) {
    if (!Array.isArray(items) || !items.length || items.length > 256) {
      fail('PDF_FIGURE_CONTEXT_INCOMPLETE');
    }
    return items.map(item => {
      const location = item?.location;
      if (item?.kind !== kind || typeof item.text !== 'string' || !item.text.trim() ||
          item.text.length > 50000 || location?.expectedNormalizedQuote !== item.text ||
          typeof location.paragraphId !== 'string' || !location.paragraphId ||
          location.locatorStatus !== 'resolved' ||
          !['exact-raw', 'normalized-equivalent', 'discontinuous'].includes(location.locatorPrecision) ||
          !Array.isArray(location.sourceFragments) || !location.sourceFragments.length ||
          location.sourceFragments.some(fragment => !positive(fragment.pageNumber) ||
            !Number.isSafeInteger(fragment.start) || fragment.start < 0 ||
            !Number.isSafeInteger(fragment.end) || fragment.end <= fragment.start)) {
        fail('PDF_FIGURE_EVIDENCE_UNVERIFIED');
      }
      return {
        paragraphId: location.paragraphId,
        sentenceId: typeof location.sentenceId === 'string'
          ? location.sentenceId.slice(0, 160) : '',
        sectionTitle: '',
        text: item.text,
        location: {
          paragraphId: location.paragraphId,
          ...(typeof location.sentenceId === 'string' && location.sentenceId
            ? { sentenceId: location.sentenceId.slice(0, 160) } : {}),
          expectedNormalizedQuote: item.text,
          locatorStatus: location.locatorStatus,
          locatorPrecision: location.locatorPrecision,
          sourceFragments: location.sourceFragments.map(fragment => ({
            pageNumber: fragment.pageNumber,
            start: fragment.start,
            end: fragment.end
          }))
        }
      };
    });
  }

  async function validatePdfFigureRequest(value, options = {}) {
    // Clone before awaiting: neither a later caller mutation nor a retained
    // public object may change the bytes/evidence admitted by this validation.
    let input;
    try { input = JSON.parse(JSON.stringify(value)); }
    catch (_) { fail('PDF_FIGURE_CONTEXT_INVALID'); }
    const envelope = input?.pdfFigureContext;
    const binding = envelope?.binding;
    const multiAssetEnvelope = envelope?.version === 'pdf-figure-production-envelope-v2';
    if (!envelope || !['pdf-figure-production-envelope-v1',
      'pdf-figure-production-envelope-v2'].includes(envelope.version) ||
        envelope.verified !== true || !validBinding(binding) ||
        envelope.figure?.figureId !== input.figureId ||
        !HASH.test(envelope.semanticContextDigest || '') ||
        !['text-only', 'vision'].includes(envelope.route)) fail('PDF_FIGURE_CONTEXT_INVALID');
    const expectedRoute = options.capabilityMode === 'vision' ? 'vision' : 'text-only';
    if (envelope.route !== expectedRoute) fail('PDF_FIGURE_ROUTE_CHANGED');
    if (envelope.textualEvidence?.version !== 2) fail('PDF_FIGURE_CONTEXT_INVALID');
    const captions = verifiedEvidence(envelope.textualEvidence.captions, 'caption');
    const body = verifiedEvidence(envelope.textualEvidence.body, 'body');
    if ([...captions, ...body].reduce((sum, item) => sum + item.text.length, 0) > 128000) {
      fail('PDF_FIGURE_CONTEXT_BUDGET_EXCEEDED');
    }
    // The selector can retain several verified sentences from one paragraph.
    // Keep them together so the downstream paragraph registry cannot overwrite
    // all but its first sentence under an identical paragraph ID.
    const bodyByParagraph = new Map();
    for (const item of body) {
      const previous = bodyByParagraph.get(item.paragraphId);
      if (previous) {
        previous.text += ` ${item.text}`;
        previous.evidence.push(item);
      } else {
        bodyByParagraph.set(item.paragraphId, {
          paragraphId: item.paragraphId,
          sectionTitle: item.sectionTitle,
          text: item.text,
          evidence: [item]
        });
      }
    }
    if ([...bodyByParagraph.values()].some(item => item.text.length > 50000) ||
        captions.map(item => item.text).join('\n').length > 100000) {
      fail('PDF_FIGURE_CONTEXT_BUDGET_EXCEEDED');
    }
    const calculated = await digest(new TextEncoder().encode(json({
      binding, target: envelope.figure, textualEvidence: envelope.textualEvidence
    })));
    if (calculated !== envelope.semanticContextDigest) fail('PDF_FIGURE_CONTEXT_DIGEST_MISMATCH');
    const proof = envelope.assetProof;
    const images = Array.isArray(input.images) ? input.images : [];
    if (envelope.route === 'text-only') {
      if (multiAssetEnvelope || images.length || proof || envelope.visualEvidenceSet ||
          envelope.images?.length) fail('PDF_FIGURE_IMAGE_COUNT_INVALID');
    } else if (multiAssetEnvelope) {
      if (proof != null || input.assetProof != null ||
          !Array.isArray(envelope.images) ||
          (input.visualEvidenceSet &&
            json(input.visualEvidenceSet) !== json(envelope.visualEvidenceSet))) {
        fail('PDF_FIGURE_IMAGE_COUNT_INVALID');
      }
      const visualEvidenceSet = await verifiedVisualEvidenceSet(
        envelope.visualEvidenceSet, binding, input.figureId
      );
      if (images.length !== visualEvidenceSet.assets.length ||
          json(envelope.images) !== json(visualEvidenceSet.assets)) {
        fail('PDF_FIGURE_IMAGE_COUNT_INVALID');
      }
      for (let index = 0; index < images.length; index += 1) {
        const actual = await imageDigest(images[index]);
        const expected = visualEvidenceSet.assets[index];
        if (actual.hash !== expected.imageContentHash || actual.mimeType !== expected.mimeType) {
          fail('PDF_FIGURE_ASSET_HASH_MISMATCH');
        }
      }
    } else {
      if (images.length !== 1 || envelope.images?.length !== 1 || !proof ||
          json(envelope.images[0]) !== json(proof) ||
          (input.assetProof && json(input.assetProof) !== json(proof))) {
        fail('PDF_FIGURE_IMAGE_COUNT_INVALID');
      }
      if (!validBoundAssetProof(proof, binding, input.figureId)) {
        fail('PDF_FIGURE_ASSET_BINDING_CONFLICT');
      }
      const actual = await imageDigest(images[0]);
      if (actual.hash !== proof.imageContentHash || actual.mimeType !== proof.mimeType) {
        fail('PDF_FIGURE_ASSET_HASH_MISMATCH');
      }
    }
    const visualEvidenceSet = multiAssetEnvelope ? envelope.visualEvidenceSet : null;
    const query = { figureId: input.figureId, binding,
      semanticContextDigest: calculated, assetProof: proof || null,
      ...(multiAssetEnvelope ? { visualEvidenceSet } : {}) };
    const assertCurrent = async () => {
      if (typeof options.verifyCurrent !== 'function') fail('PDF_FIGURE_OWNER_UNAVAILABLE');
      let response;
      try { response = await options.verifyCurrent(JSON.parse(JSON.stringify(query))); }
      catch (_) { fail('PDF_FIGURE_CONTEXT_STALE'); }
      if (response?.success !== true || json(response.binding) !== json(binding) ||
          response.semanticContextDigest !== calculated ||
          json(response.assetProof ?? null) !== json(proof ?? null) ||
          (multiAssetEnvelope &&
            json(response.visualEvidenceSet ?? null) !== json(visualEvidenceSet))) {
        fail('PDF_FIGURE_CONTEXT_STALE');
      }
    };
    await assertCurrent();
    return { figure: { ...input, figureLabel: envelope.figure.figureLabel,
      caption: captions.map(item => item.text).join('\n'), contextParagraphs: [...bodyByParagraph.values()],
      images, imageVariants: [], pdfEvidenceBinding: query }, assertCurrent,
      async validateDispatchImages(requestImages) {
        const actualImages = Array.isArray(requestImages) ? requestImages : [];
        // A verified vision request may explicitly fall back to caption/body;
        // any image it does send must still be the exact registered bytes.
        if (!actualImages.length) {
          await assertCurrent();
          return;
        }
        const expectedProofs = multiAssetEnvelope ? visualEvidenceSet.assets : proof ? [proof] : [];
        if (actualImages.length !== expectedProofs.length) {
          fail('PDF_FIGURE_IMAGE_COUNT_INVALID');
        }
        for (let index = 0; index < actualImages.length; index += 1) {
          const actual = await imageDigest(actualImages[index]);
          if (actual.hash !== expectedProofs[index].imageContentHash ||
              actual.mimeType !== expectedProofs[index].mimeType) {
            fail('PDF_FIGURE_ASSET_HASH_MISMATCH');
          }
        }
        await assertCurrent();
      }
    };
  }

  function normalizedPanelId(value) {
    const panelId = String(value || '').normalize('NFKC').trim().toUpperCase();
    return /^[A-Z0-9][A-Z0-9.+-]{0,7}$/u.test(panelId) ? panelId : '';
  }

  function panelIdFromSourceSlot(value) {
    const match = /^panel-(.+)-([1-9][0-9]{0,5})$/u.exec(String(value || ''));
    return match ? normalizedPanelId(match[1]) : '';
  }

  function validPanelProof(proof, panelId) {
    return proof?.sourceType === 'panel' &&
      typeof proof.sourceSlot === 'string' && proof.sourceSlot.length > 0 &&
      panelIdFromSourceSlot(proof.sourceSlot) === panelId &&
      /^pdfa-[a-f0-9]{48}$/u.test(proof.parentAssetId || '') &&
      HASH.test(proof.parentImageContentHash || '') &&
      positive(proof.encoderRevision) && positive(proof.cropRevision) &&
      proof.rect && ['x', 'y', 'width', 'height'].every(key =>
        Number.isFinite(proof.rect[key])) && proof.rect.x >= 0 && proof.rect.y >= 0 &&
      proof.rect.width > 0 && proof.rect.height > 0 &&
      proof.rect.x + proof.rect.width <= 1 && proof.rect.y + proof.rect.height <= 1;
  }

  async function validatePdfFigurePanelRequest(value, options = {}) {
    let input;
    try { input = JSON.parse(JSON.stringify(value)); }
    catch (_) { fail('PDF_FIGURE_CONTEXT_INVALID'); }
    const expectedVision = options.capabilityMode === 'vision';
    if (!expectedVision) {
      const admitted = await validatePdfFigureRequest({
        ...input,
        images: [],
        imageVariants: []
      }, {
        capabilityMode: 'text-only',
        verifyCurrent: options.verifyCurrent
      });
      return {
        figure: { ...admitted.figure, imageVariants: [] },
        assertCurrent: admitted.assertCurrent,
        async validateDispatchPlan(plan = {}) {
          if ((Array.isArray(plan.images) ? plan.images : []).length ||
              plan.assetProof != null ||
              json(plan.pdfEvidenceBinding ?? null) !==
                json(admitted.figure.pdfEvidenceBinding ?? null)) {
            fail('PDF_FIGURE_IMAGE_COUNT_INVALID');
          }
          await admitted.assertCurrent();
        }
      };
    }
    const variants = Array.isArray(input?.imageVariants)
      ? input.imageVariants : [];
    const panelId = normalizedPanelId(options.panelId);
    if (!panelId) fail('PDF_FIGURE_ASSET_BINDING_CONFLICT');
    if (!variants.length || variants.length > 6) {
      fail('PDF_FIGURE_IMAGE_COUNT_INVALID');
    }
    const admittedVariants = [];
    for (const variant of variants) {
      if (!variant?.pdfFigureContext) fail('PDF_FIGURE_CONTEXT_INVALID');
      const proof = variant?.assetProof;
      const declaredMediaType = String(variant?.mediaType || variant?.mimeType || '');
      if (!validPanelProof(proof, panelId) ||
          Number(variant?.width) !== proof.width ||
          Number(variant?.height) !== proof.height ||
          (declaredMediaType && declaredMediaType !== proof.mimeType) ||
          json(variant.assetProof) !== json(variant?.pdfFigureContext?.assetProof)) {
        fail('PDF_FIGURE_ASSET_BINDING_CONFLICT');
      }
      const admitted = await validatePdfFigureRequest({
        figureId: input.figureId,
        figureLabel: input.figureLabel,
        panelHints: input.panelHints,
        images: [{ mediaType: variant.mediaType, dataUrl: variant.dataUrl }],
        assetProof: variant.assetProof,
        pdfFigureContext: variant.pdfFigureContext
      }, {
        capabilityMode: 'vision',
        verifyCurrent: options.verifyCurrent
      });
      admittedVariants.push({
        admitted,
        variant: {
          mediaType: proof.mimeType,
          dataUrl: String(variant.dataUrl || ''),
          width: proof.width,
          height: proof.height,
          maxEdge: Math.max(proof.width, proof.height),
          inputMode: variant.inputMode === 'panel_crop'
            ? 'panel_crop' : 'figure_image',
          pixelsSupplied: true,
          assetProof: admitted.figure.pdfEvidenceBinding.assetProof,
          pdfEvidenceBinding: admitted.figure.pdfEvidenceBinding
        }
      });
    }
    const first = admittedVariants[0].admitted.figure;
    for (const entry of admittedVariants.slice(1)) {
      if (entry.admitted.figure.caption !== first.caption ||
          json(entry.admitted.figure.contextParagraphs) !== json(first.contextParagraphs) ||
          json(entry.admitted.figure.pdfEvidenceBinding.binding) !==
            json(first.pdfEvidenceBinding.binding) ||
          entry.admitted.figure.pdfEvidenceBinding.semanticContextDigest !==
            first.pdfEvidenceBinding.semanticContextDigest) {
        fail('PDF_FIGURE_CONTEXT_DIGEST_MISMATCH');
      }
    }
    const assertCurrent = async () => {
      for (const entry of admittedVariants) await entry.admitted.assertCurrent();
    };
    return {
      figure: {
        ...input,
        figureLabel: first.figureLabel,
        caption: first.caption,
        contextParagraphs: first.contextParagraphs,
        images: [],
        imageVariants: admittedVariants.map(entry => entry.variant),
        // The caption-only capacity fallback remains bound to the first current
        // registered variant instead of becoming an unowned text request.
        pdfEvidenceBinding: first.pdfEvidenceBinding
      },
      assertCurrent,
      async validateDispatchPlan(plan = {}) {
        const images = Array.isArray(plan.images) ? plan.images : [];
        if (!images.length) {
          if (plan.assetProof != null ||
              json(plan.pdfEvidenceBinding ?? null) !== json(first.pdfEvidenceBinding)) {
            fail('PDF_FIGURE_ASSET_BINDING_CONFLICT');
          }
          await assertCurrent();
          return;
        }
        if (images.length !== 1 || !plan.assetProof) {
          fail('PDF_FIGURE_IMAGE_COUNT_INVALID');
        }
        const selected = admittedVariants.find(entry =>
          json(entry.variant.assetProof) === json(plan.assetProof) &&
          json(entry.variant.pdfEvidenceBinding) === json(plan.pdfEvidenceBinding));
        if (!selected) fail('PDF_FIGURE_ASSET_BINDING_CONFLICT');
        await selected.admitted.validateDispatchImages(images);
        await selected.admitted.assertCurrent();
      }
    };
  }
  return {
    createPdfFigureVisualEvidenceSet,
    pdfFigureSemanticEvidenceDigest,
    pdfFigurePanelDirectoryDigest,
    validatePdfFigureRequest,
    validatePdfFigurePanelRequest
  };
});
