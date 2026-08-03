(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const SUPPLEMENTAL_FIGURE_ASSET_PREFIX = 'figures/supplemental/';
  const SUPPLEMENTAL_BINDING_KEYS = Object.freeze({
    parentWorkspaceId: 'suppParentWorkspace',
    parentWorkspaceGeneration: 'suppParentGeneration',
    parentCanonicalUrl: 'suppParentUrl',
    parentTitle: 'suppParentTitle',
    parentTabId: 'suppParentTab',
    materialId: 'suppMaterial',
    materialTitle: 'suppMaterialTitle'
  });
  const SUPPLEMENTAL_FIGURE_SOURCE_MODES = Object.freeze(['pdf', 'image', 'caption']);
  const SUPPLEMENTAL_IMAGE_MIME_TYPES = Object.freeze([
    'image/png',
    'image/jpeg',
    'image/webp'
  ]);
  const SUPPLEMENTAL_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
  const SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_BYTES = 1572864;
  const SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_EDGE = 1600;
  const SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_BASE64_CHARS =
    4 * Math.ceil(SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_BYTES / 3);
  const SUPPLEMENTAL_PDF_MAX_BYTES = 200 * 1024 * 1024;
  const SUPPLEMENTAL_MATERIAL_SEGMENT_MAX = 48;
  const SUPPLEMENTAL_FIGURE_SEGMENT_MAX = 24;
  const SUPPLEMENT_LINK_SIGNAL =
    /(?:supplement(?:al|ary)?|supporting\s+information|additional\s+file|extended\s+data|source\s+data|multimedia|video\s+s?\d+|movie\s+s?\d+|\bmmc\d*\b|\bmoesm\b|\besm\b)/i;
  const SUPPLEMENT_FIGURE_SERIES =
    /\b(?:supplement(?:al|ary)\s+)?fig(?:ure)?s?\s*((?:s\s*)?\d+[a-z]?(?:\s*(?:,|and|&|to|through|[-–—])\s*(?:s\s*)?\d+[a-z]?)*)/gi;
  const EXTENDED_DATA_FIGURE_REFERENCE =
    /\bextended\s+data\s+fig(?:ure)?s?\s*(\d+)(?:\s*([a-z]))?/gi;
  const SUPPLEMENT_VIDEO_SERIES =
    /\b(?:video|movie)s?\s*((?:s\s*)?\d+[a-z]?(?:\s*(?:,|and|&|to|through|[-–—])\s*(?:s\s*)?\d+[a-z]?)*)/gi;

  function compactText(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  }

  function text(value, limit = 1200) {
    return compactText(value).slice(0, limit);
  }

  function supplementalError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function hash(value) {
    const source = String(value || '');
    let result = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      result ^= source.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16).padStart(8, '0');
  }

  function safeId(value, fallback = 'supplement') {
    const normalized = text(value, 240).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    return normalized || `${fallback}-${hash(value || fallback)}`;
  }

  function boundedIdSegment(value, limit, fallback) {
    const normalized = safeId(value, fallback);
    if (normalized.length <= limit) return normalized;
    const suffix = hash(normalized);
    return `${normalized.slice(0, Math.max(1, limit - suffix.length - 1))
      .replace(/-+$/g, '')}-${suffix}`.slice(0, limit).replace(/-+$/g, '');
  }

  function sourceFileExtension(value) {
    return (text(value, 240).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  }

  function imageMimeMatchesExtension(fileName, mimeType) {
    const extension = sourceFileExtension(fileName);
    if (extension === 'png') return mimeType === 'image/png';
    if (extension === 'jpg' || extension === 'jpeg') return mimeType === 'image/jpeg';
    if (extension === 'webp') return mimeType === 'image/webp';
    return false;
  }

  function normalizeSupplementalFigureSource(input = {}) {
    const sourceMode = String(input.sourceMode || '').trim().toLowerCase();
    if (!SUPPLEMENTAL_FIGURE_SOURCE_MODES.includes(sourceMode)) {
      throw supplementalError('SUPPLEMENTAL_SOURCE_MODE');
    }
    const rawCaption = compactText(input.caption);
    if (rawCaption.length > 8000) throw supplementalError('SUPPLEMENTAL_CAPTION_TOO_LONG');
    const caption = rawCaption;
    if (sourceMode === 'caption' && !caption) {
      throw supplementalError('SUPPLEMENTAL_CAPTION_EMPTY');
    }

    const sourceMaterialRaw = compactText(input.sourceMaterialId);
    if (!sourceMaterialRaw) throw supplementalError('SUPPLEMENTAL_MATERIAL_ID');
    const sourceMaterialId = safeId(sourceMaterialRaw);
    if ((sourceMode === 'image' || sourceMode === 'caption') &&
        sourceMaterialId.length > SUPPLEMENTAL_MATERIAL_SEGMENT_MAX) {
      throw supplementalError('SUPPLEMENTAL_MATERIAL_ID_BOUNDS');
    }
    const sourceFileName = text(input.sourceFileName, 240);
    const sourceMimeType = text(input.sourceMimeType, 80).toLowerCase();
    const sourceFileSize = Math.max(0, Math.floor(Number(input.sourceFileSize) || 0));
    if (sourceMode === 'image') {
      if (!SUPPLEMENTAL_IMAGE_MIME_TYPES.includes(sourceMimeType) ||
          !imageMimeMatchesExtension(sourceFileName, sourceMimeType) ||
          !sourceFileSize || sourceFileSize > SUPPLEMENTAL_IMAGE_MAX_BYTES) {
        throw supplementalError('SUPPLEMENTAL_IMAGE_INVALID');
      }
    }
    if (sourceMode === 'pdf' &&
        (sourceFileExtension(sourceFileName) !== 'pdf' ||
         sourceMimeType !== 'application/pdf' ||
         !sourceFileSize || sourceFileSize > SUPPLEMENTAL_PDF_MAX_BYTES)) {
      throw supplementalError('SUPPLEMENTAL_PDF_INVALID');
    }
    const sourceFingerprint = text(input.sourceFingerprint, 80).toLowerCase();
    if (!/^sha256:[a-f0-9]{64}$/.test(sourceFingerprint)) {
      throw supplementalError('SUPPLEMENTAL_SOURCE_FINGERPRINT');
    }
    const sourceImportedAt = text(input.sourceImportedAt, 80);
    if (!sourceImportedAt || !Number.isFinite(Date.parse(sourceImportedAt))) {
      throw supplementalError('SUPPLEMENTAL_SOURCE_TIME');
    }
    return {
      sourceMode,
      sourceMaterialId,
      sourceFileName,
      sourceMimeType,
      sourceFileSize,
      sourceImportedAt,
      sourceFingerprint,
      caption
    };
  }

  function strictBase64ByteLength(value) {
    const payload = String(value || '');
    if (!payload || !/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i
      .test(payload)) return -1;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    if (payload.endsWith('==') &&
        (alphabet.indexOf(payload[payload.length - 3]) & 15) !== 0) return -1;
    if (payload.endsWith('=') && !payload.endsWith('==') &&
        (alphabet.indexOf(payload[payload.length - 2]) & 3) !== 0) return -1;
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    return (payload.length / 4) * 3 - padding;
  }

  function normalizeSupplementalTransientImage(input = {}, expected = '') {
    const mediaType = text(input.mediaType, 80).toLowerCase();
    const dataUrl = String(input.dataUrl || '');
    const width = Number(input.width);
    const height = Number(input.height);
    const sourceFingerprint = text(input.sourceFingerprint, 80).toLowerCase();
    const separatorIndex = dataUrl.indexOf(',');
    const dataHeader = separatorIndex >= 0 ? dataUrl.slice(0, separatorIndex) : '';
    const payload = separatorIndex >= 0 ? dataUrl.slice(separatorIndex + 1) : '';
    const dataMediaType = dataHeader.match(/^data:([^;,]+);base64$/i)?.[1]
      ?.toLowerCase();
    const validDimensions = Number.isSafeInteger(width) && Number.isSafeInteger(height) &&
      width > 0 && height > 0 &&
      Math.max(width, height) <= SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_EDGE;
    if (!SUPPLEMENTAL_IMAGE_MIME_TYPES.includes(mediaType) ||
        dataMediaType !== mediaType || !validDimensions ||
        !/^sha256:[a-f0-9]{64}$/.test(sourceFingerprint)) {
      throw supplementalError('SUPPLEMENTAL_TRANSIENT_IMAGE');
    }
    if (payload.length > SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_BASE64_CHARS) {
      throw supplementalError('SUPPLEMENTAL_TRANSIENT_IMAGE_TOO_LARGE');
    }
    const decodedByteLength = strictBase64ByteLength(payload);
    if (decodedByteLength < 0) throw supplementalError('SUPPLEMENTAL_TRANSIENT_IMAGE');
    if (decodedByteLength > SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_BYTES) {
      throw supplementalError('SUPPLEMENTAL_TRANSIENT_IMAGE_TOO_LARGE');
    }
    const expectedSourceFingerprint = text(
      typeof expected === 'string'
        ? expected
        : expected?.sourceFingerprint || input.expectedSourceFingerprint,
      80
    ).toLowerCase();
    if (expectedSourceFingerprint && expectedSourceFingerprint !== sourceFingerprint) {
      throw supplementalError('SUPPLEMENTAL_TRANSIENT_FINGERPRINT');
    }
    return { mediaType, dataUrl, width, height, sourceFingerprint };
  }

  function defaultRandomHex(length = 8) {
    const size = Math.max(1, Math.ceil(Number(length) / 2));
    const bytes = new Uint8Array(size);
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.getRandomValues) {
      throw supplementalError('SUPPLEMENTAL_RANDOM_UNAVAILABLE');
    }
    cryptoApi.getRandomValues(bytes);
    return [...bytes]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('').slice(0, length);
  }

  async function allocateSupplementalMaterialId(input = {}, deps = {}) {
    // This only screens a candidate against a point-in-time existence check.
    // Persistence must still use create-only CAS so concurrent importers cannot overwrite.
    const sourceFingerprint = text(input.sourceFingerprint, 80).toLowerCase();
    const fingerprintBody = sourceFingerprint.replace(/^sha256:/, '');
    if (!/^[a-f0-9]{64}$/.test(fingerprintBody)) {
      throw supplementalError('SUPPLEMENTAL_SOURCE_FINGERPRINT');
    }
    if (typeof deps.exists !== 'function') {
      throw supplementalError('SUPPLEMENTAL_EXISTS_REQUIRED');
    }
    const exists = deps.exists;
    const randomHex = typeof deps.randomHex === 'function' ? deps.randomHex : defaultRandomHex;
    const prefix = boundedIdSegment(
      input.readablePrefix || 'manual-figure',
      28,
      'manual-figure'
    );
    const base = `${prefix}-${fingerprintBody.slice(0, 10)}`.slice(
      0,
      SUPPLEMENTAL_MATERIAL_SEGMENT_MAX
    ).replace(/-+$/g, '');
    if (!await exists(base)) return base;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const suffix = String(randomHex(8) || '').toLowerCase();
      if (!/^[a-f0-9]{8}$/.test(suffix)) {
        throw supplementalError('SUPPLEMENTAL_RANDOM_INVALID');
      }
      const candidate = `${base.slice(0, SUPPLEMENTAL_MATERIAL_SEGMENT_MAX - 9)
        .replace(/-+$/g, '')}-${suffix}`;
      if (!await exists(candidate)) return candidate;
    }
    throw supplementalError('SUPPLEMENTAL_MATERIAL_ID_COLLISION');
  }

  function normalizeSupplementalUrl(value, baseUrl = '') {
    const raw = String(value || '').trim();
    if (!raw || /^(?:javascript:|mailto:|tel:)/i.test(raw)) return '';
    try {
      const url = new URL(raw, baseUrl || undefined);
      if (!['http:', 'https:', 'file:'].includes(url.protocol)) return '';
      url.hash = '';
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function supplementalMaterialKind(url, label = '') {
    const source = `${url}\n${label}`;
    if (/\.(?:pdf)(?:$|[?#])/i.test(source)) return 'pdf';
    if (/\.(?:mp4|mov|webm|avi)(?:$|[?#])/i.test(source) ||
        /\b(?:video|movie)\s*s?\d+\b/i.test(label)) return 'video';
    if (/\.(?:zip|tar|gz)(?:$|[?#])/i.test(source)) return 'archive';
    if (/\.(?:xlsx?|csv|tsv|docx?)(?:$|[?#])/i.test(source)) return 'data';
    return 'attachment';
  }

  function materialRecord(input = {}) {
    const url = normalizeSupplementalUrl(input.url, input.baseUrl);
    const title = text(input.title || input.label || url || '补充材料', 500);
    const kind = input.kind || supplementalMaterialKind(url, title);
    const materialId = safeId(input.materialId ||
      `${kind}-${title}-${url || input.sourceIndex || ''}`);
    return {
      materialId,
      title,
      url,
      kind,
      sourceKind: text(input.sourceKind || (url ? 'link' : 'inline'), 80),
      status: text(input.status || 'discovered', 40),
      sourceIndex: Math.max(0, Number(input.sourceIndex) || 0)
    };
  }

  function discoverSupplementalMaterials(documentLike, baseUrl = '') {
    if (!documentLike?.querySelectorAll) return [];
    const resolvedBase = baseUrl || documentLike.baseURI || documentLike.location?.href || '';
    const materials = [];
    const seen = new Set();
    const append = record => {
      const key = record.url || `${record.kind}:${record.title.toLowerCase()}`;
      if (!key || seen.has(key)) return;
      seen.add(key);
      materials.push(record);
    };
    let anchors = [];
    try {
      anchors = [...documentLike.querySelectorAll('a[href],area[href],[data-href]')];
    } catch (_) {}
    anchors.forEach((anchor, sourceIndex) => {
      const href = anchor.href || anchor.getAttribute?.('href') ||
        anchor.getAttribute?.('data-href') || '';
      const url = normalizeSupplementalUrl(href, resolvedBase);
      const label = text([
        anchor.textContent,
        anchor.getAttribute?.('title'),
        anchor.getAttribute?.('aria-label'),
        anchor.getAttribute?.('download'),
        href
      ].filter(Boolean).join(' '), 1000);
      if (!url || !SUPPLEMENT_LINK_SIGNAL.test(label)) return;
      append(materialRecord({
        url,
        title: label.replace(/\s+(?:https?|file):\/\/\S+$/i, ''),
        sourceKind: 'link',
        sourceIndex
      }));
    });
    let textBlocks = [];
    try {
      textBlocks = [...documentLike.querySelectorAll(
        'p,li,figcaption,[role="paragraph"]'
      )];
    } catch (_) {}
    textBlocks.forEach((block, sourceIndex) => {
      const label = text(block.textContent, 1000);
      const inline = /^(?:video|movie)\s+s?\d+[a-z]?(?:\s*[.:\-–—]|\b)/i.test(label);
      if (!inline) return;
      append(materialRecord({
        title: label,
        kind: 'video',
        sourceKind: 'inline',
        sourceIndex
      }));
    });
    return materials.slice(0, 120);
  }

  function collectReferencesFromText(value, source = {}) {
    const raw = text(value, 20000);
    const references = [];
    let match;
    SUPPLEMENT_FIGURE_SERIES.lastIndex = 0;
    while ((match = SUPPLEMENT_FIGURE_SERIES.exec(raw))) {
      const tokens = String(match[1] || '').match(/s\s*\d+[a-z]?/gi) || [];
      tokens.forEach(token => {
        const parsed = token.match(/s\s*(\d+)([a-z])?/i);
        const number = Number(parsed?.[1]);
        if (!number) return;
        references.push({
          kind: 'supplemental-figure',
          label: `Figure S${number}`,
          shortLabel: `S${number}`,
          panel: String(parsed?.[2] || '').toUpperCase(),
          paragraphId: text(source.paragraphId, 240),
          sectionTitle: text(source.sectionTitle, 500)
        });
      });
    }
    EXTENDED_DATA_FIGURE_REFERENCE.lastIndex = 0;
    while ((match = EXTENDED_DATA_FIGURE_REFERENCE.exec(raw))) {
      const number = Number(match[1]);
      if (!number) continue;
      references.push({
        kind: 'extended-data-figure',
        label: `Extended Data Figure ${number}`,
        shortLabel: `ED${number}`,
        panel: String(match[2] || '').toUpperCase(),
        paragraphId: text(source.paragraphId, 240),
        sectionTitle: text(source.sectionTitle, 500)
      });
    }
    SUPPLEMENT_VIDEO_SERIES.lastIndex = 0;
    while ((match = SUPPLEMENT_VIDEO_SERIES.exec(raw))) {
      const tokens = String(match[1] || '').match(/(?:s\s*)?\d+[a-z]?/gi) || [];
      tokens.forEach(token => {
        const parsed = token.match(/(?:s\s*)?(\d+)([a-z])?/i);
        const number = Number(parsed?.[1]);
        if (!number) return;
        references.push({
          kind: 'supplemental-video',
          label: `Video S${number}`,
          shortLabel: `Video S${number}`,
          panel: String(parsed?.[2] || '').toUpperCase(),
          paragraphId: text(source.paragraphId, 240),
          sectionTitle: text(source.sectionTitle, 500)
        });
      });
    }
    return references;
  }

  function extractSupplementalReferences(paragraphs = []) {
    const grouped = new Map();
    (Array.isArray(paragraphs) ? paragraphs : []).forEach(paragraph => {
      collectReferencesFromText(paragraph?.text || paragraph, paragraph).forEach(item => {
        const key = `${item.kind}:${item.shortLabel.toLowerCase()}`;
        const existing = grouped.get(key) || { ...item, panels: [], mentions: [] };
        if (item.panel && !existing.panels.includes(item.panel)) {
          existing.panels.push(item.panel);
        }
        existing.mentions.push({
          paragraphId: item.paragraphId,
          sectionTitle: item.sectionTitle
        });
        grouped.set(key, existing);
      });
    });
    return [...grouped.values()].map(item => ({
      ...item,
      panels: item.panels.slice(0, 26),
      mentions: item.mentions.slice(0, 40)
    }));
  }

  function supplementalFigureKey(value) {
    const label = text(value, 200);
    const extended = label.match(/extended\s+data\s+(?:fig(?:ure)?\s*)?(\d+)/i);
    if (extended) return `ed${Number(extended[1])}`;
    const supplement = label.match(/(?:fig(?:ure)?\s*)?s\s*(\d+)/i);
    return supplement ? `s${Number(supplement[1])}` : '';
  }

  function migratedSupplementalFigureSourceMode(figure = {}, asset = {}) {
    for (const candidate of [figure.sourceMode, asset.sourceMode]) {
      const raw = String(candidate || '').trim().toLowerCase();
      if (!raw) continue;
      return SUPPLEMENTAL_FIGURE_SOURCE_MODES.includes(raw) ? raw : '';
    }
    const legacyPdfSignals = [
      figure.sourceMimeType,
      asset.sourceMimeType
    ].some(value => text(value, 80).toLowerCase() === 'application/pdf') || [
      figure.sourceFileName,
      asset.sourceFileName,
      figure.sourceUrl,
      asset.sourceUrl
    ].some(value => /\.pdf(?:$|[?#])/i.test(String(value || ''))) ||
      text(asset.kind, 40).toLowerCase() === 'pdf' ||
      Boolean(asset.parsedDocument && typeof asset.parsedDocument === 'object') ||
      /(?:^|\/)pdf-reader\.html(?:$|[?#])/i.test(String(
        figure.sourceReaderUrl || asset.sourceReaderUrl || ''
      ));
    return legacyPdfSignals ? 'pdf' : '';
  }

  function normalizeSupplementalFigure(figure = {}, asset = {}) {
    const originalFigureId = text(figure.originalFigureId || figure.figureId, 160);
    const figureLabel = text(figure.figureLabel || figure.label ||
      originalFigureId || 'Supplemental Figure', 240);
    const sourceMaterialId = safeId(
      figure.sourceMaterialId || asset.materialId || asset.sourceUrl || asset.title
    );
    const materialSegment = boundedIdSegment(
      sourceMaterialId,
      SUPPLEMENTAL_MATERIAL_SEGMENT_MAX,
      'supplement'
    );
    const figureSegment = boundedIdSegment(
      supplementalFigureKey(figureLabel) || originalFigureId || figureLabel,
      SUPPLEMENTAL_FIGURE_SEGMENT_MAX,
      'figure'
    );
    const existingFigureId = text(figure.figureId, 200).toLowerCase();
    const expectedPrefix = `supp-${materialSegment}-`;
    const existingFigureSegment = existingFigureId.startsWith(expectedPrefix)
      ? existingFigureId.slice(expectedPrefix.length) : '';
    const figureId = existingFigureSegment &&
      existingFigureSegment.length <= SUPPLEMENTAL_FIGURE_SEGMENT_MAX &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(existingFigureSegment)
      ? existingFigureId
      : `${expectedPrefix}${figureSegment}`;
    const normalized = {
      ...figure,
      figureId,
      originalFigureId,
      figureLabel,
      isSupplemental: true,
      sourceMaterialId,
      sourceTitle: text(figure.sourceTitle || asset.title, 500),
      sourceUrl: normalizeSupplementalUrl(figure.sourceUrl || asset.sourceUrl),
      sourcePage: Math.max(0, Number(figure.sourcePage) || 0)
    };
    const sourceMode = migratedSupplementalFigureSourceMode(figure, asset);
    if (sourceMode) normalized.sourceMode = sourceMode;
    else delete normalized.sourceMode;
    return normalized;
  }

  function createSupplementalFigureImportDraft(input = {}) {
    const source = normalizeSupplementalFigureSource(input);
    const panelHints = source.caption && typeof shared.extractPanelHints === 'function'
      ? shared.extractPanelHints(source.caption).slice(0, 30) : [];
    const captionBlocks = source.caption &&
      typeof shared.splitFigureCaptionByPanelGroups === 'function'
      ? shared.splitFigureCaptionByPanelGroups(source.caption).slice(0, 60) : [];
    const provenance = {
      sourceMode: source.sourceMode,
      sourceMaterialId: source.sourceMaterialId,
      sourceFileName: source.sourceFileName,
      sourceMimeType: source.sourceMimeType,
      sourceFileSize: source.sourceFileSize,
      sourceImportedAt: source.sourceImportedAt,
      sourceFingerprint: source.sourceFingerprint
    };
    const figure = normalizeSupplementalFigure({
      figureId: input.figureId,
      figureLabel: text(input.figureLabel || 'Supplemental Figure', 240),
      caption: source.caption,
      panelHints,
      captionBlocks,
      ...provenance,
      analysisStatus: 'draft',
      humanReviewed: false
    }, {
      materialId: source.sourceMaterialId,
      title: text(input.title, 500)
    });
    return {
      schemaVersion: 1,
      materialId: source.sourceMaterialId,
      title: text(input.title || figure.figureLabel, 500),
      ...provenance,
      figures: [figure]
    };
  }

  function mergeSupplementalFigureAssets(mainFigures = [], assets = []) {
    const merged = [];
    const seen = new Set();
    const append = figure => {
      const id = text(figure?.figureId, 200);
      if (!id || seen.has(id)) return;
      seen.add(id);
      merged.push(figure);
    };
    (Array.isArray(mainFigures) ? mainFigures : []).forEach(append);
    (Array.isArray(assets) ? assets : []).forEach(asset => {
      (Array.isArray(asset?.figures) ? asset.figures : []).forEach(figure =>
        append(normalizeSupplementalFigure(figure, asset)));
    });
    return merged;
  }

  function activeFigureResult(figure = {}) {
    if (figure.activeDepth === 'standard') {
      return figure.standard || figure.modelStandard || figure.deep || figure.modelDeep || null;
    }
    return figure.deep || figure.modelDeep || figure.standard || figure.modelStandard || null;
  }

  function buildSupplementalCoverage(input = {}) {
    const references = Array.isArray(input.references) ? input.references : [];
    const materials = Array.isArray(input.materials) ? input.materials : [];
    const figures = Array.isArray(input.figures)
      ? input.figures.filter(figure => figure?.isSupplemental === true) : [];
    const expectedFigureKeys = [...new Set(references
      .filter(item => ['supplemental-figure', 'extended-data-figure'].includes(item?.kind))
      .map(item => supplementalFigureKey(item.shortLabel || item.label)).filter(Boolean))];
    const foundFigureKeys = [...new Set(figures
      .map(figure => supplementalFigureKey(figure.figureLabel || figure.figureId))
      .filter(Boolean))];
    const analyzedFigureKeys = [...new Set(figures
      .filter(figure => activeFigureResult(figure))
      .map(figure => supplementalFigureKey(figure.figureLabel || figure.figureId))
      .filter(Boolean))];
    const missingFigureKeys = expectedFigureKeys.filter(key => !foundFigureKeys.includes(key));
    let status = 'none';
    if (expectedFigureKeys.length || materials.length) status = 'unparsed';
    if (foundFigureKeys.length) status = missingFigureKeys.length ? 'partial' : 'found';
    if (foundFigureKeys.length && analyzedFigureKeys.length === foundFigureKeys.length &&
        !missingFigureKeys.length) status = 'complete';
    return {
      status,
      expectedFigureCount: expectedFigureKeys.length,
      foundFigureCount: foundFigureKeys.length,
      analyzedFigureCount: analyzedFigureKeys.length,
      materialCount: materials.length,
      expectedFigureKeys,
      foundFigureKeys,
      analyzedFigureKeys,
      missingFigureKeys,
      missingFigureLabels: missingFigureKeys.map(key =>
        key.startsWith('ed') ? `Extended Data Figure ${Number(key.slice(2))}`
          : `Figure S${Number(key.slice(1))}`)
    };
  }

  function supplementalFigureAssetPath(materialId) {
    return `${SUPPLEMENTAL_FIGURE_ASSET_PREFIX}${safeId(materialId)}.json`;
  }

  function createSupplementalPdfReaderUrl(runtimeGetUrl, input = {}) {
    const sourceUrl = normalizeSupplementalUrl(input.sourceUrl || input.url);
    if (typeof runtimeGetUrl !== 'function') return '';
    const base = sourceUrl && typeof shared.createPdfReaderUrl === 'function'
      ? shared.createPdfReaderUrl(runtimeGetUrl, sourceUrl, input.title)
      : runtimeGetUrl('pdf-reader.html');
    if (!base) return '';
    const url = new URL(base);
    const fallbackTitle = text(input.title, 500);
    if (!sourceUrl && fallbackTitle) url.searchParams.set('title', fallbackTitle);
    const workspaceId = text(input.parentWorkspaceId, 100);
    if (/^workspace:[a-f0-9]{64}$/i.test(workspaceId)) {
      url.searchParams.set(SUPPLEMENTAL_BINDING_KEYS.parentWorkspaceId, workspaceId);
      url.searchParams.set(
        SUPPLEMENTAL_BINDING_KEYS.parentWorkspaceGeneration,
        String(Math.max(1, Number(input.parentWorkspaceGeneration) || 1))
      );
    }
    const parentUrl = normalizeSupplementalUrl(input.parentCanonicalUrl);
    if (parentUrl) {
      url.searchParams.set(SUPPLEMENTAL_BINDING_KEYS.parentCanonicalUrl, parentUrl);
    }
    const parentTitle = text(input.parentTitle, 500);
    if (parentTitle) url.searchParams.set(SUPPLEMENTAL_BINDING_KEYS.parentTitle, parentTitle);
    const parentTabId = Number(input.parentTabId);
    if (Number.isInteger(parentTabId) && parentTabId >= 0) {
      url.searchParams.set(SUPPLEMENTAL_BINDING_KEYS.parentTabId, String(parentTabId));
    }
    const materialId = safeId(input.materialId || sourceUrl || fallbackTitle);
    url.searchParams.set(SUPPLEMENTAL_BINDING_KEYS.materialId, materialId);
    const materialTitle = text(input.title, 500);
    if (materialTitle) url.searchParams.set(SUPPLEMENTAL_BINDING_KEYS.materialTitle, materialTitle);
    return url.href;
  }

  function readSupplementalPdfBinding(value) {
    let url;
    try {
      url = new URL(String(value || ''));
    } catch (_) {
      return null;
    }
    const workspaceId = text(
      url.searchParams.get(SUPPLEMENTAL_BINDING_KEYS.parentWorkspaceId), 100
    );
    const materialId = safeId(
      url.searchParams.get(SUPPLEMENTAL_BINDING_KEYS.materialId) ||
      url.searchParams.get('source') || ''
    );
    if (!/^workspace:[a-f0-9]{64}$/i.test(workspaceId) || !materialId) return null;
    return {
      parentWorkspaceId: workspaceId.toLowerCase(),
      parentWorkspaceGeneration: Math.max(1, Number(
        url.searchParams.get(SUPPLEMENTAL_BINDING_KEYS.parentWorkspaceGeneration)
      ) || 1),
      parentCanonicalUrl: normalizeSupplementalUrl(
        url.searchParams.get(SUPPLEMENTAL_BINDING_KEYS.parentCanonicalUrl)
      ),
      parentTitle: text(
        url.searchParams.get(SUPPLEMENTAL_BINDING_KEYS.parentTitle), 500
      ),
      parentTabId: Math.max(-1, Math.floor(Number(
        url.searchParams.get(SUPPLEMENTAL_BINDING_KEYS.parentTabId)
      ) || -1)),
      materialId,
      materialTitle: text(
        url.searchParams.get(SUPPLEMENTAL_BINDING_KEYS.materialTitle), 500
      ),
      sourceUrl: normalizeSupplementalUrl(url.searchParams.get('source'))
    };
  }

  return {
    SUPPLEMENTAL_FIGURE_ASSET_PREFIX,
    SUPPLEMENTAL_BINDING_KEYS,
    SUPPLEMENTAL_FIGURE_SOURCE_MODES,
    SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_BYTES,
    SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_EDGE,
    normalizeSupplementalUrl,
    normalizeSupplementalFigureSource,
    normalizeSupplementalTransientImage,
    allocateSupplementalMaterialId,
    createSupplementalFigureImportDraft,
    supplementalMaterialKind,
    discoverSupplementalMaterials,
    collectReferencesFromText,
    extractSupplementalReferences,
    supplementalFigureKey,
    normalizeSupplementalFigure,
    mergeSupplementalFigureAssets,
    buildSupplementalCoverage,
    supplementalFigureAssetPath,
    createSupplementalPdfReaderUrl,
    readSupplementalPdfBinding
  };
});
