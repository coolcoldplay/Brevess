(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  'use strict';
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const compact = value => String(value || '').replace(/\s+/gu, ' ').trim();

  function parseDocxSupplementalCaption(text) {
    const value = compact(text);
    const match = value.match(/^(?:(?:supplementary|supplemental)\s+fig(?:ure)?\.?\s*S?\s*(\d{1,4})|fig(?:ure)?\.?\s*S\s*(\d{1,4}))\s*(?:[.:：]\s*|$)([\s\S]*)$/iu);
    if (!match || Number(match[1] || match[2]) < 1) return null;
    return { figureLabel: `Figure S${Number(match[1] || match[2])}`,
      description: compact(match[3]), text: value };
  }

  function readDocxBodyBlocks(xml, options = {}) {
    if (typeof xml !== 'string' || xml.length > 16 * 1024 * 1024) fail('DOCX_DOCUMENT_XML_SIZE');
    if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) fail('DOCX_XML_DECLARATION_UNSUPPORTED');
    const Parser = options.DOMParser || globalThis.DOMParser;
    if (typeof Parser !== 'function') fail('DOCX_DOM_PARSER_UNAVAILABLE');
    const doc = new Parser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length ||
        doc.documentElement?.localName !== 'document' || doc.documentElement.namespaceURI !== W) fail('DOCX_DOCUMENT_XML_INVALID');
    const bodies = Array.from(doc.documentElement.children).filter(n => n.namespaceURI === W && n.localName === 'body');
    if (bodies.length !== 1) fail('DOCX_DOCUMENT_BODY_INVALID');
    return Array.from(bodies[0].children).map((node, index) => {
      const all = Array.from(node.getElementsByTagName('*'));
      const images = Array.from(node.getElementsByTagNameNS(A, 'blip')).map(image => ({
        relationshipId: image.getAttributeNS(R, 'embed') || '',
        externalRelationshipId: image.getAttributeNS(R, 'link') || ''
      }));
      const complexity = all.filter(n => ['txbxContent', 'AlternateContent', 'pict', 'object', 'anchor', 'del', 'ins'].includes(n.localName)).map(n => n.localName);
      if (all.some(n => n.localName === 'drawing') && !images.length) complexity.push('unresolved-drawing');
      if (all.some(n => n.localName === 'graphicData' && n.getAttribute('uri') !==
          'http://schemas.openxmlformats.org/drawingml/2006/picture')) complexity.push('unresolved-graphic');
      if (node.namespaceURI !== W || node.localName !== 'p') {
        if (images.length) complexity.push('non-paragraph-drawing');
      }
      return { index, kind: node.localName,
        text: compact(Array.from(node.getElementsByTagNameNS(W, 't')).map(n => n.textContent).join('')),
        images, complexity: [...new Set(complexity)] };
    });
  }

  function associateDocxFigureBlocks(blocks) {
    if (!Array.isArray(blocks)) fail('DOCX_BLOCKS_REQUIRED');
    const rows = blocks.map((block, index) => ({ ...block, order: index,
      images: Array.isArray(block.images) ? block.images : [],
      complexity: Array.isArray(block.complexity) ? block.complexity : [],
      caption: block.kind === 'p' ? parseDocxSupplementalCaption(block.text) : null }));
    const definitions = new Map(), unresolved = [], edges = new Map(), assigned = new Map();
    for (const row of rows) if (row.caption) {
      const definitionsForLabel = definitions.get(row.caption.figureLabel) || [];
      definitionsForLabel.push(row); definitions.set(row.caption.figureLabel, definitionsForLabel);
    }
    const neighbor = (start, direction) => {
      for (let i = start + direction; i >= 0 && i < rows.length; i += direction) {
        const row = rows[i];
        if (row.kind === 'p' && !compact(row.text) && !row.images.length && !row.complexity.length) continue;
        return row;
      }
      return null;
    };
    for (const row of rows.filter(row => row.images.length || row.complexity.length)) {
      if (row.complexity.length) {
        unresolved.push({ code: 'DOCX_COMPLEX_DRAWING', blockIndex: row.index, details: row.complexity }); continue;
      }
      const candidates = row.caption ? [row] : [neighbor(row.order, -1), neighbor(row.order, 1)]
        .filter(candidate => candidate?.caption && !candidate.images.length && !candidate.complexity.length);
      edges.set(row.order, new Set(candidates.map(candidate => candidate.order)));
    }
    // Resolve only forced one-to-one adjacency. Alternating image/label runs work
    // in either orientation; competing captions or shared anchors stay unresolved.
    while (true) {
      const singletons = [...edges].filter(([, values]) => values.size === 1);
      if (!singletons.length) break;
      const claims = new Map();
      for (const [image, values] of singletons) {
        const caption = [...values][0]; claims.set(caption, [...(claims.get(caption) || []), image]);
      }
      for (const [caption, images] of claims) {
        if (images.length > 1) {
          for (const image of images) {
            unresolved.push({ code: 'DOCX_CAPTION_SHARED_AMBIGUOUS', blockIndex: rows[image].index }); edges.delete(image);
          }
        } else {
          assigned.set(images[0], caption); edges.delete(images[0]);
        }
        for (const values of edges.values()) values.delete(caption);
      }
    }
    for (const [image, candidates] of edges) unresolved.push({
      code: candidates.size ? 'DOCX_CAPTION_ADJACENCY_AMBIGUOUS' : 'DOCX_IMAGE_WITHOUT_CAPTION',
      blockIndex: rows[image].index, candidateCaptionBlocks: [...candidates].map(index => rows[index].index)
    });
    const figures = [];
    for (const [figureLabel, captions] of definitions) {
      const full = captions.filter(row => !row.complexity.length && row.caption.description);
      const descriptions = [...new Set(full.map(row => row.caption.description))];
      const imageRows = [...assigned].filter(([, caption]) => rows[caption].caption.figureLabel === figureLabel).map(([image]) => rows[image]);
      const missing = [];
      // Partial package imports require a Figure-local veto: an unresolved
      // revision/textbox caption must not qualify through a clean short label.
      if (captions.some(row => row.complexity.length)) missing.push('DOCX_COMPLEX_CAPTION');
      if (!descriptions.length) missing.push('DOCX_FULL_CAPTION_MISSING');
      if (descriptions.length > 1) missing.push('DOCX_CAPTION_CONFLICT');
      const captionsWithContinuation = full.map(row => {
        const continuation = [], indices = [];
        let fenced = false, invalid = false;
        for (let i = row.order + 1; i < rows.length; i++) {
          const next = rows[i];
          if (next.caption || next.images.length || next.kind === 'p' && !compact(next.text) && !next.complexity.length ||
              next.kind === 'sectPr' && !next.text && !next.images.length && !next.complexity.length) {
            fenced = true; break;
          }
          if (next.kind !== 'p' || next.complexity.length ||
              /^(?:(?:supplementary|supplemental)\s+)?(?:table\b|references\b|acknowledgments\b)/iu.test(compact(next.text))) {
            invalid = true; break;
          }
          continuation.push(compact(next.text)); indices.push(next.index);
          if (i === rows.length - 1) fenced = true;
        }
        if (invalid || continuation.length && (!fenced || imageRows.length !== 1 || imageRows[0].order > row.order))
          missing.push('DOCX_CAPTION_CONTINUATION_UNRESOLVED');
        return {...row, caption:{...row.caption,description:[row.caption.description,...continuation].filter(Boolean).join(' ')},
          continuationBlocks:indices};
      });
      const completeDescriptions = [...new Set(captionsWithContinuation.map(row => row.caption.description))];
      if (completeDescriptions.length > 1 && !missing.includes('DOCX_CAPTION_CONFLICT')) missing.push('DOCX_CAPTION_CONFLICT');
      const images = imageRows.flatMap(row => row.images.map(image => ({ ...image, blockIndex: row.index })));
      if (!images.length) missing.push('DOCX_FIGURE_IMAGE_MISSING');
      if (images.length > 1) missing.push('DOCX_MULTIPLE_IMAGES_REQUIRE_COMPOSITION');
      figures.push({ figureLabel, caption: completeDescriptions.length === 1 ? `${figureLabel}. ${completeDescriptions[0]}` : '',
        captionBlocks: [...new Set([...captions.map(row => row.index),...captionsWithContinuation.flatMap(row => row.continuationBlocks)])], imageReferences: images, missing,
        associationConfirmed: missing.length === 0 });
    }
    return { figures, unresolved, associationComplete: figures.length > 0 && !unresolved.length && figures.every(f => f.associationConfirmed) };
  }

  async function prepareSupplementalDocxImports(bytes, options = {}) {
    const pkg = await shared.unpackSupplementalDocxParts(bytes, options);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const rels = shared.readDocxRelationshipRecords(decoder.decode(pkg.parts.get('word/_rels/document.xml.rels')), options);
    const links = shared.resolveDocxImageRelationships(rels, pkg.parts.keys());
    const blocks = readDocxBodyBlocks(decoder.decode(pkg.parts.get('word/document.xml')), options);
    const association = associateDocxFigureBlocks(blocks);
    const missing = [...association.unresolved, ...links.unresolved], importRecords = [];
    const related = new Map(links.images.map(image => [image.relationshipId, image.partName]));
    const referenced = new Set(blocks.flatMap(block => block.images.map(image => image.relationshipId)));
    for (const image of links.images) if (!referenced.has(image.relationshipId)) missing.push({ code: 'DOCX_IMAGE_RELATIONSHIP_UNPLACED', relationshipId: image.relationshipId });
    for (const name of pkg.parts.keys()) {
      if (/^word\/(?:header|footer|footnotes|endnotes)\d*\.xml$/u.test(name)) missing.push({ code: 'DOCX_ADDITIONAL_DOCUMENT_PART_UNSCANNED', partName: name });
    }
    for (const figure of association.figures) {
      if (!figure.associationConfirmed) { missing.push(...figure.missing.map(code => ({ figureLabel: figure.figureLabel, code }))); continue; }
      const image = figure.imageReferences[0];
      const partName = related.get(image.relationshipId);
      if (image.externalRelationshipId || !partName) { missing.push({ figureLabel: figure.figureLabel, code: 'DOCX_IMAGE_RELATIONSHIP_UNRESOLVED' }); continue; }
      const mimeType = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[partName.split('.').at(-1).toLowerCase()];
      if (!mimeType) { missing.push({ figureLabel: figure.figureLabel, partName, code: 'DOCX_IMAGE_FORMAT_UNSUPPORTED' }); continue; }
      if (!options.imageTools?.prepareTransientImage || !options.imageTools?.createImageImport) {
        missing.push({ figureLabel: figure.figureLabel, code: 'DOCX_EXISTING_IMAGE_TOOLS_REQUIRED' }); continue;
      }
      try {
        const imageBytes = pkg.parts.get(partName);
        const file = new File([imageBytes], partName.split('/').at(-1), { type: mimeType });
        const transient = await options.imageTools.prepareTransientImage(file);
        const imported = options.imageTools.createImageImport(file, transient, figure.caption, {
          figureKind: 'supplemental', figureLabel: figure.figureLabel, sourcePage: 0
        });
        importRecords.push({ ...imported, sourceProof: {
          kind: 'docx-embedded-image', containerSha256: pkg.containerSha256,
          sourceMaterialId: String(options.materialId || ''), sourceUrl: String(options.sourceUrl || ''),
          partName, relationshipId: image.relationshipId, imageBlockIndex: image.blockIndex,
          captionBlockIndices: figure.captionBlocks, sourceFingerprint: transient.sourceFingerprint
        } });
      } catch (error) { missing.push({ figureLabel: figure.figureLabel, partName, code: error?.code || 'DOCX_IMAGE_PREPARATION_FAILED' }); }
    }
    return { containerSha256: pkg.containerSha256, figures: association.figures, importRecords, missing,
      complete: association.figures.length > 0 && !missing.length && importRecords.length === association.figures.length,
      persisted: false };
  }

  return { parseDocxSupplementalCaption, readDocxBodyBlocks, associateDocxFigureBlocks, prepareSupplementalDocxImports };
});
