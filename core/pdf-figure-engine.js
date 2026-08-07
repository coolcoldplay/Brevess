(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const PDF_FIGURE_SCHEMA_VERSION = 3;
  const PDF_FIGURE_PIPELINE_VERSION = '0.2.0-cross-page';
  const PDF_FIGURE_SOURCE = 'pdffigures2';
  const PDF_FIGURE_INVENTORY_SOURCE = 'pdf-pdffigures2';

  function normalizedText(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function repairOcrFigurePrefix(value) {
    return normalizedText(value)
      .replace(/^\s*f\s*i\s*g\s*(?:u\s*r\s*e\s*)?\.?\s*/i, 'Figure ')
      .replace(/^\s*figure\s*\.\s*/i, 'Figure ');
  }

  function figureLabelParts(value) {
    const text = repairOcrFigurePrefix(value);
    const match = text.match(
      /^(?:(?:supplement(?:ary|al)?|extended\s+data)\s+)?(?:fig(?:ure)?\s*)?([sS]?\s*\d+)([a-z]?)(?=\b|\s|[.:;,)])/i
    );
    if (!match) return null;
    const compact = match[1].replace(/\s+/g, '');
    const supplemental = /^s/i.test(compact);
    const digits = compact.replace(/^s/i, '');
    if (!/^\d+$/.test(digits)) return null;
    return {
      supplemental,
      number: String(Number(digits)),
      suffix: String(match[2] || '').toUpperCase()
    };
  }

  function labelFromFigure(raw = {}, kind = 'main', fallbackNumber = 0) {
    const captionParts = figureLabelParts(raw.caption || raw.figCaption || '');
    const nameParts = figureLabelParts(raw.name || raw.figureName || raw.label || '');
    const directName = normalizedText(raw.name || raw.figureName || raw.label || '')
      .match(/^([sS]?\s*\d+)([a-z]?)$/i);
    const parsed = captionParts || nameParts || (directName ? {
      supplemental: /^s/i.test(directName[1]),
      number: String(Number(directName[1].replace(/^s\s*/i, ''))),
      suffix: String(directName[2] || '').toUpperCase()
    } : null);
    const supplemental = kind === 'supplemental' || parsed?.supplemental === true;
    const number = parsed?.number || (fallbackNumber > 0 ? String(fallbackNumber) : '');
    if (!number) return {
      label: '', number: '', supplemental, explicit: false
    };
    const suffix = parsed?.suffix || '';
    return {
      label: `Figure ${supplemental ? 'S' : ''}${number}${suffix}`,
      number: `${supplemental ? 'S' : ''}${number}${suffix}`,
      supplemental,
      explicit: Boolean(parsed)
    };
  }

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeBox(value) {
    if (!value) return null;
    let x;
    let y;
    let width;
    let height;
    if (Array.isArray(value) && value.length >= 4) {
      const [x1, y1, x2, y2] = value.map(item => finiteNumber(item, NaN));
      x = x1;
      y = y1;
      width = x2 - x1;
      height = y2 - y1;
    } else if (typeof value === 'object') {
      x = finiteNumber(value.x ?? value.left ?? value.x1, NaN);
      y = finiteNumber(value.y ?? value.top ?? value.y1, NaN);
      if (Number.isFinite(Number(value.width))) width = Number(value.width);
      else width = finiteNumber(value.x2 ?? value.right, NaN) - x;
      if (Number.isFinite(Number(value.height))) height = Number(value.height);
      else height = finiteNumber(value.y2 ?? value.bottom, NaN) - y;
    }
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      return null;
    }
    return {
      x: Math.max(0, x),
      y: Math.max(0, y),
      width,
      height
    };
  }

  function normalizedSha256(value) {
    const hash = String(value || '').trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(hash) ? hash : '';
  }

  function stableHash(value) {
    const text = String(value || '');
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first ^= code;
      first = Math.imul(first, 0x01000193);
      second ^= code + index;
      second = Math.imul(second, 0x85ebca6b);
    }
    return `${(first >>> 0).toString(16).padStart(8, '0')}${
      (second >>> 0).toString(16).padStart(8, '0')}`;
  }

  function figureIdFor(figure, documentFingerprint = '') {
    const labelSlug = normalizedText(figure.figureLabel || 'figure')
      .toLowerCase()
      .replace(/^figure\s+/, 'figure-')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'figure';
    const signature = [
      normalizedSha256(documentFingerprint),
      figure.kind,
      figure.figureLabel,
      figure.pageIndex,
      figure.figureBox?.x,
      figure.figureBox?.y,
      figure.figureBox?.width,
      figure.figureBox?.height,
      figure.caption
    ].join('|');
    return `pdf-${figure.kind}-${labelSlug}-${stableHash(signature).slice(0, 10)}`;
  }

  function normalizeImage(value = {}) {
    if (!value || typeof value !== 'object') return null;
    const workspacePath = String(value.workspacePath || '').replace(/\\/g, '/').trim();
    const mimeType = String(value.mimeType || 'image/png').toLowerCase();
    const sha256 = normalizedSha256(value.sha256);
    const width = Math.max(0, Math.round(finiteNumber(value.width)));
    const height = Math.max(0, Math.round(finiteNumber(value.height)));
    if (!workspacePath && !sha256 && !width && !height && !value.imageFile) return null;
    return {
      mimeType: /^image\/(?:png|jpeg|webp)$/i.test(mimeType)
        ? mimeType : 'image/png',
      width,
      height,
      sha256,
      workspacePath,
      imageFile: normalizedText(value.imageFile || '')
    };
  }

  function normalizePdffigures2Figure(raw = {}, options = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const figureType = normalizedText(
      raw.figType || raw.figureType || raw.type || raw.kind || 'Figure'
    );
    if (/^table$/i.test(figureType) && options.includeTables !== true) return null;
    if (figureType && !/^(?:figure|fig)$/i.test(figureType) &&
        options.acceptUnknownType !== true) return null;
    const kind = options.kind === 'supplemental' ? 'supplemental' : 'main';
    const label = labelFromFigure(raw, kind, Number(options.fallbackNumber) || 0);
    const figureBox = normalizeBox(
      raw.figureBox || raw.regionBoundary || raw.region || raw.boundary || raw.bbox
    );
    if (!figureBox) return null;
    const captionBox = normalizeBox(
      raw.captionBox || raw.captionBoundary || raw.captionRegion || raw.captionBbox
    );
    const pageIndex = Math.max(0, Math.round(finiteNumber(
      raw.pageIndex ?? raw.page ?? raw.pageNumber,
      0
    )));
    const caption = repairOcrFigurePrefix(raw.caption || raw.figCaption || '');
    const image = normalizeImage(options.image || raw.image || {
      imageFile: raw.imageFile || raw.imagePath || '',
      mimeType: raw.mimeType,
      sha256: raw.sha256,
      width: raw.width,
      height: raw.height
    });
    const result = {
      schemaVersion: PDF_FIGURE_SCHEMA_VERSION,
      figureId: '',
      figureLabel: label.label,
      figureNumber: label.number,
      labelWasExplicit: label.explicit,
      kind,
      pageIndex,
      figureBox,
      caption,
      captionBox,
      image,
      originalName: normalizedText(raw.name || raw.figureName || ''),
      originalImageFile: normalizedText(raw.imageFile || raw.imagePath || ''),
      recoveredBy: normalizedText(raw.recoveredBy || ''),
      captionRecovered: raw.captionRecovered === true,
      source: PDF_FIGURE_SOURCE,
      extractorVersion: normalizedText(options.extractorVersion || raw.extractorVersion || '')
    };
    result.figureId = figureIdFor(result, options.documentFingerprint);
    return result;
  }

  function figureSort(left, right) {
    const pageOrder = left.pageIndex - right.pageIndex;
    if (pageOrder) return pageOrder;
    const leftSequence = String(left.figureNumber || '').match(/^(S?)(\d+)$/i);
    const rightSequence = String(right.figureNumber || '').match(/^(S?)(\d+)$/i);
    if (leftSequence && rightSequence &&
        leftSequence[1].toUpperCase() === rightSequence[1].toUpperCase()) {
      const sequenceOrder = Number(leftSequence[2]) - Number(rightSequence[2]);
      if (sequenceOrder) return sequenceOrder;
    }
    return finiteNumber(left.figureBox?.y) - finiteNumber(right.figureBox?.y) ||
      finiteNumber(left.figureBox?.x) - finiteNumber(right.figureBox?.x) ||
      left.figureLabel.localeCompare(right.figureLabel, undefined, { numeric: true });
  }

  function explicitSequence(figure) {
    const match = String(figure.figureNumber || '').match(/^S?(\d+)/i);
    return match ? Number(match[1]) : 0;
  }

  function normalizePdffigures2Figures(rawFigures, options = {}) {
    const imageByIndex = Array.isArray(options.imageByIndex)
      ? options.imageByIndex : [];
    const normalized = (Array.isArray(rawFigures) ? rawFigures : [])
      .map((raw, sourceIndex) => {
        const figure = normalizePdffigures2Figure(raw, {
          ...options,
          fallbackNumber: 0,
          image: imageByIndex[sourceIndex] || raw?.image
        });
        return figure ? { ...figure, sourceIndex } : null;
      })
      .filter(Boolean)
      .sort(figureSort);
    let sequence = normalized.reduce((highest, figure) =>
      figure.labelWasExplicit ? Math.max(highest, explicitSequence(figure)) : highest, 0);
    normalized.forEach(figure => {
      if (figure.figureLabel) return;
      sequence += 1;
      const supplemental = figure.kind === 'supplemental';
      figure.figureNumber = `${supplemental ? 'S' : ''}${sequence}`;
      figure.figureLabel = `Figure ${figure.figureNumber}`;
      figure.figureId = figureIdFor(figure, options.documentFingerprint);
    });
    const seen = new Set();
    const seenImageHashes = new Set();
    return normalized.filter(figure => {
      if (options.includePanelFigures !== true &&
          /^S?\d+[A-Z]$/i.test(String(figure.figureNumber || ''))) {
        return false;
      }
      const box = figure.figureBox;
      const key = [
        figure.kind,
        figure.figureLabel.toLowerCase(),
        figure.pageIndex,
        Math.round(box.x), Math.round(box.y),
        Math.round(box.width), Math.round(box.height)
      ].join('|');
      if (seen.has(key)) return false;
      const imageHash = normalizedSha256(figure.image?.sha256);
      if (imageHash && seenImageHashes.has(imageHash)) return false;
      seen.add(key);
      if (imageHash) seenImageHashes.add(imageHash);
      return true;
    });
  }

  function removeMineruFigureImages(blocks) {
    let removedImageCount = 0;
    const cleaned = [];
    (Array.isArray(blocks) ? blocks : []).forEach((block, sourceIndex) => {
      if (block?.type === 'image') {
        removedImageCount += 1;
        return;
      }
      if (!block || typeof block !== 'object') return;
      cleaned.push({ ...block, sourceIndex });
    });
    return { blocks: cleaned, removedImageCount };
  }

  function normalizedCaptionKey(value) {
    return repairOcrFigurePrefix(value)
      .toLowerCase()
      .replace(/^figure\s+([s]?\d+[a-z]?)\s*[.:;-]?\s*/i, 'figure $1 ')
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
      .trim();
  }

  function captionLabel(value) {
    const text = repairOcrFigurePrefix(value).replace(
      /^(?:[A-Z]\s+){1,4}(?=(?:figure|fig\.?)\s+s?\s*\d+)/i,
      ''
    );
    // Caption anchors come from the document body, where bare numbers are very
    // common (author affiliations, references, page numbers).  Native
    // PDFFigures2 metadata may legitimately use a bare name such as "3", but a
    // body caption must explicitly say Figure/Fig.  Keeping those two parsers
    // separate prevents superscript affiliations (NFKC: ¹ -> 1) from moving
    // Figures into the author list.
    const match = text.match(
      /^(?:(?:supplement(?:ary|al)?|extended\s+data)\s+)?(?:figure|fig\.?)\s+([sS]?\s*\d+)([a-z]?)(?=\b|\s|[.:;,)])/i
    );
    if (!match) return '';
    const compact = String(match[1] || '').replace(/\s+/g, '');
    const supplemental = /^s/i.test(compact);
    const digits = compact.replace(/^s/i, '');
    if (!/^\d+$/.test(digits)) return '';
    const parts = {
      supplemental,
      number: String(Number(digits)),
      suffix: String(match[2] || '').toUpperCase()
    };
    return parts
      ? `Figure ${parts.supplemental ? 'S' : ''}${parts.number}${parts.suffix}`
      : '';
  }

  function commonPrefixScore(left, right) {
    const first = normalizedCaptionKey(left).split(' ').filter(Boolean);
    const second = normalizedCaptionKey(right).split(' ').filter(Boolean);
    if (!first.length || !second.length) return 0;
    let matches = 0;
    const limit = Math.min(first.length, second.length, 20);
    for (let index = 0; index < limit; index += 1) {
      if (first[index] !== second[index]) break;
      matches += 1;
    }
    return matches / Math.max(3, Math.min(first.length, second.length));
  }

  function explicitPanelLegendText(value) {
    const text = normalizedText(value);
    return /^\((?:[A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?(?:(?:\s*[,;&]\s*|\s+(?:and|or|to)\s+)[A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?)*)\)\s*/i
      .test(text);
  }

  function cleanMineruCaptionAnchor(value) {
    return repairOcrFigurePrefix(value).replace(
      /^(?:[A-Z]\s+){1,4}(?=(?:figure|fig\.?)\s+s?\s*\d+)/i,
      ''
    ).trim();
  }

  function sequentialBarePanelLabels(value) {
    const labels = [];
    const text = normalizedText(value);
    const pattern = /(?:^|[.!?]\s+)([A-Z])\s+(?=[A-Z0-9])/g;
    let match;
    while ((match = pattern.exec(text))) labels.push(match[1]);
    if (labels.length < 2) return [];
    const hasConsecutivePair = labels.some((label, index) => index > 0 &&
      label.charCodeAt(0) === labels[index - 1].charCodeAt(0) + 1
    );
    return hasConsecutivePair ? labels : [];
  }

  function panelLegendContinuationIndices(blocks, captionIndex, captionText = '') {
    const indices = [];
    let cursor = Number(captionIndex) + 1;
    while (cursor < blocks.length && indices.length < 80) {
      const block = blocks[cursor];
      if (!block || block.type === 'image' || block.type === 'heading' ||
          captionLabel(block.text)) break;
      const isPanelParagraph = block.type === 'paragraph' &&
        explicitPanelLegendText(block.text);
      const isPanelList = block.type === 'list' &&
        Array.isArray(block.items) && block.items.length > 0 &&
        block.items.every(item => explicitPanelLegendText(item?.text));
      if (!isPanelParagraph && !isPanelList) break;
      indices.push(cursor);
      cursor += 1;
    }
    // Multi-column MinerU output can interleave one body paragraph between two
    // halves of the same legend.  Recover only a clearly sequential bare-letter
    // continuation (for example A-D followed by E-H); this avoids swallowing
    // ordinary prose that merely cites a Panel.
    const existingLabels = sequentialBarePanelLabels(captionText);
    const lastExisting = existingLabels.at(-1) || '';
    if (lastExisting) {
      const lookaheadEnd = Math.min(blocks.length, Number(captionIndex) + 9);
      for (let lookahead = Number(captionIndex) + 1;
        lookahead < lookaheadEnd; lookahead += 1) {
        if (indices.includes(lookahead)) continue;
        const block = blocks[lookahead];
        if (!block || block.type === 'heading' || captionLabel(block.text)) break;
        if (block.type === 'image') continue;
        const labels = sequentialBarePanelLabels(blockText(block));
        if (!labels.length) continue;
        const expectedNext = lastExisting.charCodeAt(0) + 1;
        if (labels[0].charCodeAt(0) < expectedNext ||
            labels[0].charCodeAt(0) > expectedNext + 1) continue;
        indices.push(lookahead);
        break;
      }
    }
    return indices;
  }

  function blockText(block) {
    if (block?.type === 'list') {
      return (Array.isArray(block.items) ? block.items : [])
        .map(item => normalizedText(item?.text))
        .filter(Boolean).join(' ');
    }
    return normalizedText(block?.text);
  }

  function captionCoverageScore(value) {
    const text = normalizedText(value);
    const panelMarkers = text.match(/\([A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?\)/g) || [];
    return panelMarkers.length * 10000 + Math.min(text.length, 9000);
  }

  function richerCaption(...values) {
    return values.map(value => normalizedText(value)).filter(Boolean)
      .sort((left, right) =>
        captionCoverageScore(right) - captionCoverageScore(left) ||
        right.length - left.length
      )[0] || '';
  }

  function buildPdfFigureArticlePlan(inputBlocks, inputFigures) {
    const cleaned = removeMineruFigureImages(inputBlocks);
    const blocks = cleaned.blocks;
    const captions = blocks.flatMap((block, index) => {
      if (!['paragraph', 'heading'].includes(block?.type)) return [];
      const label = captionLabel(block.text);
      return label ? [{
        index,
        label,
        text: cleanMineruCaptionAnchor(String(block.text || ''))
      }] : [];
    });
    const consumedCaptionIndices = new Set();
    const figures = (Array.isArray(inputFigures) ? inputFigures : [])
      .slice().sort(figureSort).map(figure => {
        const exact = captions.find(caption =>
          !consumedCaptionIndices.has(caption.index) &&
          caption.label.toLowerCase() === String(figure.figureLabel || '').toLowerCase()
        );
        const semantic = exact || captions
          .filter(caption => !consumedCaptionIndices.has(caption.index))
          .map(caption => ({
            ...caption,
            score: commonPrefixScore(caption.text, figure.caption)
          }))
          .filter(caption => caption.score >= 0.55)
          .sort((left, right) => right.score - left.score || left.index - right.index)[0];
        if (semantic) {
          consumedCaptionIndices.add(semantic.index);
          const continuationIndices = panelLegendContinuationIndices(
            blocks, semantic.index, semantic.text
          );
          continuationIndices.forEach(index => consumedCaptionIndices.add(index));
          const semanticCaption = [
            semantic.text,
            ...continuationIndices.map(index => blockText(blocks[index]))
          ].filter(Boolean).join(' ');
          const preferSemanticCaption = Boolean(
            figure.recoveredBy || figure.captionRecovered
          );
          return {
            ...figure,
            caption: preferSemanticCaption
              ? normalizedText(semanticCaption) || figure.caption
              : richerCaption(figure.caption, semanticCaption),
            anchorIndex: semantic.index,
            captionBlockIndex: semantic.index,
            placement: 'caption',
            estimatedPosition: false
          };
        }
        let lastPageBlockIndex = -1;
        blocks.forEach((block, index) => {
          if (Number(block?.pageIndex) === Number(figure.pageIndex)) {
            lastPageBlockIndex = index;
          }
        });
        if (lastPageBlockIndex >= 0) {
          return {
            ...figure,
            anchorIndex: lastPageBlockIndex + 1,
            captionBlockIndex: -1,
            placement: 'page-end',
            estimatedPosition: true
          };
        }
        return {
          ...figure,
          anchorIndex: blocks.length,
          captionBlockIndex: -1,
          placement: 'document-end',
          estimatedPosition: true
        };
      });
    // MinerU often drops a complete caption when the Figure plate and legend
    // are on different PDF pages.  Native recovery can still supply the whole
    // Figure.  Place such a Figure at the next matched Figure's anchor (or just
    // after the previous one) according to its explicit Figure sequence,
    // instead of dumping every unmatched Figure at the document tail.
    const sequenceOrdered = figures.slice().sort((left, right) =>
      explicitSequence(left) - explicitSequence(right) || figureSort(left, right)
    );
    sequenceOrdered.forEach((figure, index) => {
      if (figure.placement !== 'document-end' || !explicitSequence(figure)) return;
      const previous = sequenceOrdered.slice(0, index).reverse().find(item =>
        item.placement !== 'document-end'
      );
      const next = sequenceOrdered.slice(index + 1).find(item =>
        item.placement !== 'document-end'
      );
      if (next) {
        figure.anchorIndex = next.anchorIndex;
        figure.placement = 'sequence-before-next';
      } else if (previous) {
        figure.anchorIndex = Math.min(blocks.length, previous.anchorIndex + 1);
        figure.placement = 'sequence-after-previous';
      }
    });
    figures.sort((left, right) =>
      left.anchorIndex - right.anchorIndex || figureSort(left, right)
    );
    return {
      blocks,
      figures,
      consumedCaptionIndices,
      removedMineruImageCount: cleaned.removedImageCount
    };
  }

  function durableFigureImage(image) {
    return Boolean(
      image &&
      /^pdf\/figures\//.test(String(image.workspacePath || '')) &&
      normalizedSha256(image.sha256)
    );
  }

  function createPdfFigureManifest(figures, options = {}) {
    const values = (Array.isArray(figures) ? figures : [])
      .filter(figure => figure && typeof figure === 'object')
      .map(figure => ({ ...figure, image: figure.image ? { ...figure.image } : null }));
    const completeImages = values.filter(figure => durableFigureImage(figure.image)).length;
    const explicitStatus = ['pending', 'running', 'ready', 'partial', 'error', 'cancelled']
      .includes(options.status) ? options.status : '';
    const status = explicitStatus || (
      values.length && completeImages === values.length ? 'ready' :
        completeImages ? 'partial' : 'pending'
    );
    return {
      schemaVersion: PDF_FIGURE_SCHEMA_VERSION,
      source: PDF_FIGURE_SOURCE,
      status,
      documentFingerprint: normalizedSha256(options.documentFingerprint),
      extractorVersion: normalizedText(options.extractorVersion || ''),
      figureCount: values.length,
      persistedImageCount: completeImages,
      figures: values,
      error: options.error ? {
        code: normalizedText(options.error.code || ''),
        message: normalizedText(options.error.message || options.error)
      } : null,
      updatedAt: String(options.updatedAt || new Date().toISOString())
    };
  }

  function createPdfFigureInventory(manifestOrFigures, options = {}) {
    const manifest = Array.isArray(manifestOrFigures)
      ? { figures: manifestOrFigures, status: options.status || 'ready' }
      : (manifestOrFigures && typeof manifestOrFigures === 'object'
          ? manifestOrFigures : { figures: [], status: 'pending' });
    return (Array.isArray(manifest.figures) ? manifest.figures : [])
      .slice().sort(figureSort).map(figure => ({
        schemaVersion: PDF_FIGURE_SCHEMA_VERSION,
        figureId: String(figure.figureId || ''),
        figureLabel: String(figure.figureLabel || ''),
        figureNumber: String(figure.figureNumber || ''),
        caption: String(figure.caption || ''),
        pageIndex: Math.max(0, Number(figure.pageIndex) || 0),
        kind: figure.kind === 'supplemental' ? 'supplemental' : 'main',
        isSupplemental: figure.kind === 'supplemental',
        imageAssetPath: String(figure.image?.workspacePath || ''),
        imageSha256: normalizedSha256(figure.image?.sha256),
        imageMimeType: String(figure.image?.mimeType || 'image/png'),
        sourceMode: PDF_FIGURE_INVENTORY_SOURCE,
        analysisStatus: 'pending',
        extractionStatus: durableFigureImage(figure.image)
          ? 'ready' : (manifest.status || 'pending'),
        sourceMaterialId: String(options.sourceMaterialId || ''),
        sourceDocumentFingerprint: String(manifest.documentFingerprint || '')
      }));
  }

  function pdfFigureManifestNeedsRefresh(manifest) {
    if (!manifest || typeof manifest !== 'object') return true;
    if (Number(manifest.schemaVersion) < PDF_FIGURE_SCHEMA_VERSION) return true;
    return normalizedText(manifest.extractorVersion) !== PDF_FIGURE_PIPELINE_VERSION;
  }

  return {
    PDF_FIGURE_SCHEMA_VERSION,
    PDF_FIGURE_PIPELINE_VERSION,
    PDF_FIGURE_SOURCE,
    PDF_FIGURE_INVENTORY_SOURCE,
    repairOcrFigurePrefix,
    figureLabelParts,
    normalizePdfFigureBox: normalizeBox,
    normalizePdffigures2Figure,
    normalizePdffigures2Figures,
    removeMineruFigureImages,
    buildPdfFigureArticlePlan,
    createPdfFigureManifest,
    createPdfFigureInventory,
    pdfFigureManifestNeedsRefresh
  };
});
