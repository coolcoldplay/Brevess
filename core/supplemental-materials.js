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
    parentDocumentHash: 'suppParentDocumentHash',
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
    /(?:supplement(?:al|ary)?(?=$|[^a-z])|supporting\s+information|additional\s+file|extended\s+data|source\s+data|multimedia|video\s+s?\d+|movie\s+s?\d+|\bmmc\d*\b|\bmoesm\b|\besm\b)/i;
  const SUPPLEMENT_FIGURE_SERIES =
    /\b(?:supplement(?:al|ary)\s+)?fig(?:ure)?s?\.?\s*((?:s\s*)?\d+[a-z]?(?:\s*(?:,|and|&|to|through|[-–—])\s*(?:s\s*)?\d+[a-z]?)*)/gi;
  const EXTENDED_DATA_FIGURE_SERIES =
    /\bextended\s+data\s+fig(?:ure)?s?\.?\s*((?:\d{1,3}[a-z]?(?:\s*[-\u2013\u2014]\s*(?:\d{1,3}[a-z]?|(?<![a-z])[a-z](?![a-z])))?|(?<![a-z])[a-z](?![a-z]))(?:\s*(?:,|and|&|to|through)\s*(?:\d{1,3}[a-z]?(?:\s*[-\u2013\u2014]\s*(?:\d{1,3}[a-z]?|(?<![a-z])[a-z](?![a-z])))?|(?<![a-z])[a-z](?![a-z])))*)/gi;
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

  function normalizeManualFigureKind(value, figure = {}) {
    const candidate = String(value || '').trim().toLowerCase();
    if (candidate === 'main' || candidate === 'supplemental') return candidate;
    return figure?.isSupplemental === false ? 'main' : 'supplemental';
  }

  function canonicalManualFigureLabel(value, kind = 'supplemental', fallback = '') {
    const figureKind = normalizeManualFigureKind(kind);
    const label = text(value, 240);
    const supplemental = label.match(
      /^(?:fig(?:ure)?\.?\s*s|supplement(?:al|ary)\s+figure\s+)(\d+)$/i
    );
    if (figureKind === 'supplemental') {
      return supplemental ? `Figure S${Number(supplemental[1])}` : (label || fallback || 'Figure S');
    }
    const main = label.match(/^(?:fig(?:ure)?\.?)\s*(\d+)$/i);
    return main ? `Figure ${Number(main[1])}` : fallback;
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
    const figureKind = normalizeManualFigureKind(input.figureKind, input);
    const figureLabel = canonicalManualFigureLabel(input.figureLabel, figureKind, '');
    if (figureKind === 'main' && !figureLabel) {
      throw supplementalError('MANUAL_FIGURE_LABEL');
    }
    const sourcePageRaw = input.sourcePage === '' || input.sourcePage === undefined
      ? 0 : Number(input.sourcePage);
    if (!Number.isSafeInteger(sourcePageRaw) || sourcePageRaw < 0 || sourcePageRaw > 100000) {
      throw supplementalError('MANUAL_FIGURE_PAGE');
    }
    const hasIdentityRevision = Object.prototype.hasOwnProperty.call(
      input, 'identityRevision'
    );
    const identityRevision = input.identityRevision;
    if (hasIdentityRevision && (!Number.isSafeInteger(identityRevision) ||
        identityRevision < 0)) {
      throw supplementalError('SUPPLEMENTAL_IDENTITY_REVISION');
    }
    return {
      sourceMode,
      sourceMaterialId,
      sourceFileName,
      sourceMimeType,
      sourceFileSize,
      sourceImportedAt,
      sourceFingerprint,
      caption,
      figureKind,
      figureLabel,
      sourcePage: sourcePageRaw,
      ...(hasIdentityRevision ? { identityRevision } : {})
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

  function supplementalMaterialKindFromSource(source, label = '') {
    if (/\.(?:pdf)(?:$|[?#])/i.test(source)) return 'pdf';
    if (/\.(?:mp4|mov|webm|avi)(?:$|[?#])/i.test(source) ||
        /\b(?:video|movie)\s*s?\d+\b/i.test(label)) return 'video';
    if (/\.(?:zip|tar|gz)(?:$|[?#])/i.test(source)) return 'archive';
    if (/\.(?:xlsx?|csv|tsv|docx?)(?:$|[?#])/i.test(source)) return 'data';
    return 'attachment';
  }

  function supplementalMaterialKind(url, label = '') {
    // Labels and query values cannot change the file-path suffix.
    return supplementalMaterialKindFromSource(String(url || '').split(/[?#]/u)[0], label);
  }

  function materialRecord(input = {}, detectedKind = '') {
    const url = normalizeSupplementalUrl(input.url, input.baseUrl);
    const title = text(input.title || input.label || url || '补充材料', 500);
    const kind = input.kind || detectedKind || supplementalMaterialKind(url, title);
    // Preserve IDs already generated by the former URL+label classifier.
    // Correcting a displayed kind must not rename parent assets or imports.
    const identityKind = input.kind || supplementalMaterialKindFromSource(`${url}\n${title}`, title);
    const materialId = safeId(input.materialId ||
      `${identityKind}-${title}-${url || input.sourceIndex || ''}`);
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

  function publisherSupplementalRepositoryNavigation(anchor, url, baseUrl, documentLike) {
    try {
    const doi = nativeTiffArticleDoi(baseUrl);
    const widget = anchor.closest?.('.figshare_widget[doi]');
    const viewer = anchor.closest?.('figshare-widget');
    const nav = anchor.closest?.('nav[aria-label="Figshare"]');
    if (!/^10\.1371\/journal\.[a-z]+\.\d+$/.test(doi) || !widget || !viewer || !nav ||
        widget.getAttribute('doi') !== doi || !widget.contains(viewer) || !viewer.contains(nav) ||
        anchor.getAttribute('aria-label') !== 'Open in figshare') return null;
    const target = new URL(url);
    if (target.origin !== 'https://figshare.com' || target.username || target.password || target.search ||
        !/^\/articles\/journal_contribution\/[^/]+\/[1-9]\d*\/?$/.test(target.pathname)) return null;
    const names = [...viewer.querySelectorAll('[class*="header-module__fileName"]')];
    const counters = [...nav.querySelectorAll('[class*="fileControls-module__info"]')];
    const filename = names.length === 1 ? compactText(names[0].textContent) : '';
    const displayed = counters.length === 1 ? compactText(counters[0].textContent).match(/^([1-9]\d*)\s*\/\s*([1-9]\d*)$/) : null;
    const visible = filename.match(/^([a-z]+\.\d+\.s\d+)\.(docx?|tiff?|xlsx?)$/i);
    if (!displayed || Number(displayed[1]) > Number(displayed[2]) || !visible) return null;
    const files = new Map();
    for (const owner of documentLike.querySelectorAll('#artText .supplementary-material')) {
      if (owner.closest?.('[data-sci-plugin-ui],[data-sci-translation]')) continue;
      const titles = [...owner.querySelectorAll('h3.siTitle')], types = [...owner.querySelectorAll('p.postSiDOI')];
      const links = titles.length === 1 ? [...titles[0].querySelectorAll('a[href]')] : [];
      if (links.length !== 1 || types.length !== 1) return null;
      const sourceUrl = normalizeSupplementalUrl(links[0].getAttribute('href'), baseUrl), source = new URL(sourceUrl);
      const materialId = source.searchParams.get('id') || '';
      const format = compactText(types[0].textContent).match(/^\((DOCX?|TIFF?|XLSX?)\)$/i)?.[1]?.toLowerCase();
      if (source.origin !== new URL(baseUrl).origin || source.pathname !== new URL(baseUrl).pathname + '/file' ||
          source.searchParams.getAll('id').length !== 1 || source.searchParams.getAll('type').length !== 1 ||
          source.searchParams.get('type') !== 'supplementary' || !materialId.startsWith(doi+'.s') ||
          !/^\d+$/.test(materialId.slice(doi.length+2)) || !format || files.has(materialId)) return null;
      files.set(materialId,{sourceUrl,format:format.replace(/^tif$/,'tiff')});
    }
    const current = files.get('10.1371/journal.' + visible[1]);
    if (files.size !== Number(displayed[2]) || !current || current.format !== visible[2].toLowerCase().replace(/^tif$/,'tiff')) return null;
    return {kind:'reference',sourceRole:'repository-navigation',sourceFormat:'not-applicable',requiresFormatInspection:false,
      repositoryNavigation:{kind:'publisher-figshare-widget',articleUrl:baseUrl,articleDoi:doi,
        collectionUrl:url,visibleFileName:filename,declaredFileCount:files.size,directSourceUrls:[...files.values()].map(file=>file.sourceUrl)}};
    } catch (_) { return null; }
  }
  function isSupplementalRepositoryNavigation(material) {
    const evidence = material?.repositoryNavigation;
    if (material?.kind !== 'reference' || material?.sourceRole !== 'repository-navigation' ||
        material?.sourceFormat !== 'not-applicable' || material?.requiresFormatInspection !== false ||
        evidence?.kind !== 'publisher-figshare-widget' || material.url !== evidence.collectionUrl ||
        !/^10\.1371\/journal\.[a-z]+\.\d+$/.test(evidence.articleDoi || '') ||
        nativeTiffArticleDoi(evidence.articleUrl) !== evidence.articleDoi ||
        !Array.isArray(evidence.directSourceUrls) || evidence.directSourceUrls.length !== evidence.declaredFileCount ||
        evidence.declaredFileCount < 1 || new Set(evidence.directSourceUrls).size !== evidence.declaredFileCount) return false;
    try {
      const collection = new URL(material.url), article = new URL(evidence.articleUrl);
      if (collection.origin !== 'https://figshare.com' || !/^\/articles\/journal_contribution\/[^/]+\/[1-9]\d*\/?$/.test(collection.pathname)) return false;
      return evidence.directSourceUrls.every(value => {
        const source = new URL(value), id = source.searchParams.get('id') || '';
        return source.origin === article.origin && source.pathname === article.pathname+'/file' &&
          !source.username && !source.password && source.searchParams.getAll('id').length === 1 && source.searchParams.getAll('type').length === 1 &&
          source.searchParams.get('type') === 'supplementary' && id.startsWith(evidence.articleDoi+'.s') && /^\d+$/.test(id.slice(evidence.articleDoi.length+2));
      });
    } catch (_) { return false; }
  }

  function supplementalAnchorFormat(anchor, url, baseUrl) {
    let fileName = new URL(url).pathname.split('/').at(-1) || '';
    let format = fileName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || '';
    const plosOwner = anchor.closest?.('.supplementary-material');
    if (plosOwner) {
      const titles = [...plosOwner.querySelectorAll('h3.siTitle')];
      const types = [...plosOwner.querySelectorAll('p.postSiDOI')];
      const titleLinks = titles.length === 1 ? [...titles[0].querySelectorAll('a[href]')] : [];
      if (types.length === 1 && titleLinks.length === 1 &&
          normalizeSupplementalUrl(titleLinks[0].getAttribute('href'), baseUrl) === url) {
        format = compactText(types[0].textContent).match(/^\((tiff?|pdf|docx?|xlsx?|csv|tsv|zip)\)$/i)?.[1]?.toLowerCase() || format;
      }
    }
    const fileOwner = anchor.closest?.('.SupplementalDataV4__file');
    if (fileOwner) {
      const names = [...fileOwner.querySelectorAll('.SupplementalDataV4__file__name')];
      const links = [...fileOwner.querySelectorAll('a[href]')];
      if (names.length === 1 && links.length === 1 && normalizeSupplementalUrl(links[0].getAttribute('href'), baseUrl) === url) {
        fileName = compactText(names[0].textContent);
        format = fileName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || format;
      }
    }
    if (format === 'tif') format = 'tiff';
    const known = ['pdf','tiff','png','jpg','jpeg','webp','gif','svg','doc','docx','xls','xlsx','csv','tsv','zip','tar','gz','mp4','mov','webm','avi'];
    const sourceFormat = known.includes(format) ? format : 'unknown';
    const image = ['tiff','png','jpg','jpeg','webp','gif','svg'].includes(sourceFormat);
    const data = ['xls','xlsx','csv','tsv','doc','docx'].includes(sourceFormat);
    const video = ['mp4','mov','webm','avi'].includes(sourceFormat);
    const kind = image ? 'image' : sourceFormat === 'pdf' ? 'pdf' : data ? 'data' : video ? 'video' : ['zip','tar','gz'].includes(sourceFormat) ? 'archive' : 'attachment';
    return { sourceFormat, kind, ...(format && /\.[a-z0-9]+$/i.test(fileName) ? { sourceFileName: fileName } : {}),
      ...(image ? { containsFigures: true } : {}),
      requiresFormatInspection: sourceFormat === 'unknown' || ['doc','docx','zip','tar','gz'].includes(sourceFormat) };
  }

  function discoverSupplementalMaterials(documentLike, baseUrl = '') {
    if (!documentLike?.querySelectorAll) return [];
    const resolvedBase = baseUrl || documentLike.baseURI || documentLike.location?.href || '';
    const materials = [];
    const nativeTiffUrls = new Set(discoverNativeTiffFigures(documentLike, resolvedBase).map(source => source.sourceUrl));
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
      if (!url || !SUPPLEMENT_LINK_SIGNAL.test(label) || url === normalizeSupplementalUrl(resolvedBase, resolvedBase)) return;
      if (/\bextended\s+data\s+figures\s+and\s+tables\b/i.test(label) &&
          url === normalizeSupplementalUrl(resolvedBase, resolvedBase)) return;
      const nativeExtendedData = /\bextended\s+data\s+fig(?:ure)?\.?\s*\d+/i.test(label) && (
        Boolean(anchor.getAttribute?.('data-supp-info-image')) ||
        /\/articles\/[^/]+\/figures\/\d+\/?$/i.test(new URL(url).pathname)
      );
      if (nativeExtendedData) return;
      append(materialRecord({
        url,
        title: label.replace(/\s+(?:https?|file):\/\/\S+$/i, ''),
        sourceKind: 'link',
        sourceIndex
      }, nativeTiffUrls.has(url) ? 'data' : ''));
      const record = materials.find(item => item.url === url);
      if (record) {
        Object.assign(record, supplementalAnchorFormat(anchor, url, resolvedBase));
        const navigation = publisherSupplementalRepositoryNavigation(anchor, url, resolvedBase, documentLike);
        if (navigation) Object.assign(record, navigation);
        const declared = collectReferencesFromText(anchor.textContent || '').filter(r => r.kind === 'supplemental-figure').map(r => r.label);
        record.declaredFigureLabels = [...new Set([...(record.declaredFigureLabels || []), ...declared])];
      }
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
    const appendSupplemental = (number, panel = '') => {
      if (!Number.isInteger(number) || number < 1 || number > 999) return;
      references.push({ kind: 'supplemental-figure', label: `Figure S${number}`,
        shortLabel: `S${number}`, panel: panel.toUpperCase(),
        paragraphId: text(source.paragraphId, 240), sectionTitle: text(source.sectionTitle, 500) });
    };
    const readSupplementalSeries = (value, explicitlySupplemental) => {
      let supplemental = explicitlySupplemental;
      for (const token of value.split(/\s*(?:,|\band\b|&)\s*/i)) {
        const parsed = token.trim().match(/^(s\s*)?(\d{1,3})([a-z])?(?:\s*(?:[-–—]|\bto\b|\bthrough\b)\s*(?:s\s*)?(\d{1,3})([a-z])?)?$/i);
        if (!parsed) continue;
        supplemental ||= Boolean(parsed[1]);
        if (!supplemental) continue;
        const first = Number(parsed[2]), last = Number(parsed[4] || 0);
        if (last >= first && !parsed[3] && !parsed[5]) {
          for (let number = first; number <= last; number++) appendSupplemental(number);
        } else {
          appendSupplemental(first, parsed[3] || '');
          if (last && last !== first) appendSupplemental(last, parsed[5] || '');
        }
      }
    };
    SUPPLEMENT_FIGURE_SERIES.lastIndex = 0;
    while ((match = SUPPLEMENT_FIGURE_SERIES.exec(raw))) {
      readSupplementalSeries(match[1], /^supplement(?:al|ary)\b/i.test(match[0]));
    }
    const reverseSeries = /\b(s\s*\d{1,3}[a-z]?(?:\s*(?:,|and|&|to|through|[-–—])\s*(?:s\s*)?\d{1,3}[a-z]?)*)(?!\d)\s+fig(?:ure)?s?\.?(?=\s|[,:;.]|$)/gi;
    while ((match = reverseSeries.exec(raw))) readSupplementalSeries(match[1], true);
    const appendExtended = (number, panels = []) => {
      if (!Number.isInteger(number) || number < 1 || number > 999) return;
      (panels.length ? panels : ['']).forEach(panel => references.push({
        kind: 'extended-data-figure',
        label: `Extended Data Figure ${number}`,
        shortLabel: `ED${number}`,
        panel: String(panel || '').toUpperCase(),
        paragraphId: text(source.paragraphId, 240),
        sectionTitle: text(source.sectionTitle, 500)
      }));
    };
    const panelRange = (start, end) => {
      const first = String(start || '').toUpperCase().charCodeAt(0);
      const last = String(end || '').toUpperCase().charCodeAt(0);
      if (first < 65 || last < first || last > 90) return [];
      return Array.from({ length: last - first + 1 }, (_, index) =>
        String.fromCharCode(first + index));
    };
    EXTENDED_DATA_FIGURE_SERIES.lastIndex = 0;
    while ((match = EXTENDED_DATA_FIGURE_SERIES.exec(raw))) {
      let currentNumber = 0;
      const tokens = String(match[1] || '').split(
        /\s*(?:,|\band\b|&|\bto\b|\bthrough\b)\s*/i
      ).map(token => token.trim()).filter(Boolean);
      tokens.forEach(token => {
        const numeric = token.match(
          /^(\d{1,3})([a-z])?(?:\s*[-\u2013\u2014]\s*(?:(\d{1,3})([a-z])?|([a-z])))?$/i
        );
        if (!numeric) {
          const continuedPanel = token.match(/^[a-z]$/i)?.[0];
          if (currentNumber && continuedPanel) appendExtended(currentNumber, [continuedPanel]);
          return;
        }
        const startNumber = Number(numeric[1]);
        const startPanel = String(numeric[2] || '').toUpperCase();
        const endNumber = Number(numeric[3] || 0);
        const endPanel = String(numeric[4] || numeric[5] || '').toUpperCase();
        currentNumber = startNumber;
        if (endNumber && !startPanel && !endPanel && endNumber >= startNumber &&
            endNumber - startNumber <= 100) {
          for (let number = startNumber; number <= endNumber; number += 1) {
            appendExtended(number);
          }
        } else if (startPanel && endPanel && (!endNumber || endNumber === startNumber)) {
          appendExtended(startNumber, panelRange(startPanel, endPanel));
        } else {
          appendExtended(startNumber, startPanel ? [startPanel] : []);
          if (endNumber && endNumber !== startNumber) {
            appendExtended(endNumber, endPanel ? [endPanel] : []);
            currentNumber = endNumber;
          }
        }
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
    const compactExtended = label.match(/^ed\s*(\d+)$/i);
    if (compactExtended) return `ed${Number(compactExtended[1])}`;
    const extended = label.match(/extended\s+data\s+(?:fig(?:ure)?\.?\s*)?(\d+)/i);
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

  function supplementalFigureSequence(value) {
    const label = text(value?.figureLabel || value?.label || value, 240);
    const match = label.match(
      /^(?:figure\s*s|supplement(?:al|ary)\s+figure\s+)(\d+)$/i
    );
    return match ? Math.max(0, Number(match[1]) || 0) : 0;
  }

  function canonicalSupplementalFigureLabel(value, fallback = 'Figure S') {
    const label = text(value, 240);
    const sequence = supplementalFigureSequence(label);
    return sequence ? `Figure S${sequence}` : (label || fallback);
  }

  function compareSupplementalFigures(left, right) {
    const leftSequence = supplementalFigureSequence(left);
    const rightSequence = supplementalFigureSequence(right);
    if (leftSequence && rightSequence && leftSequence !== rightSequence) {
      return leftSequence - rightSequence;
    }
    if (leftSequence !== rightSequence) return leftSequence ? -1 : 1;
    return text(left?.figureLabel || left?.figureId, 240).localeCompare(
      text(right?.figureLabel || right?.figureId, 240),
      undefined,
      { numeric: true, sensitivity: 'base' }
    );
  }

  function normalizeSupplementalFigure(figure = {}, asset = {}) {
    if (Object.prototype.hasOwnProperty.call(figure, 'identityRevision') &&
        (!Number.isSafeInteger(figure.identityRevision) ||
         figure.identityRevision < 0)) {
      throw supplementalError('SUPPLEMENTAL_IDENTITY_REVISION');
    }
    const originalFigureId = text(figure.originalFigureId || figure.figureId, 160);
    const figureKind = normalizeManualFigureKind(figure.figureKind, figure);
    const figureLabel = canonicalManualFigureLabel(
      figure.figureLabel || figure.label || originalFigureId,
      figureKind,
      figureKind === 'main' ? text(figure.figureLabel || figure.label, 240) : 'Figure S'
    );
    const figureKey = supplementalFigureKey(figureLabel || originalFigureId);
    const figureSeries = figure.figureSeries === 'extended-data' ||
      figureKey.startsWith('ed')
      ? 'extended-data'
      : figureKind === 'main' ? 'main' : 'supplemental';
    const sourceMaterialId = safeId(
      figure.sourceMaterialId || asset.materialId || asset.sourceUrl || asset.title
    );
    const materialSegment = boundedIdSegment(
      sourceMaterialId,
      SUPPLEMENTAL_MATERIAL_SEGMENT_MAX,
      'supplement'
    );
    const figureSegment = boundedIdSegment(
      figureKey || originalFigureId || figureLabel,
      SUPPLEMENTAL_FIGURE_SEGMENT_MAX,
      'figure'
    );
    const existingFigureId = text(figure.figureId, 200).toLowerCase();
    const expectedPrefix = figureKind === 'main'
      ? `manual-main-${materialSegment}-` : `supp-${materialSegment}-`;
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
      figureKind,
      figureSeries,
      isSupplemental: figureKind !== 'main',
      sourceMaterialId,
      sourceTitle: text(figure.sourceTitle || asset.title, 500),
      sourceUrl: normalizeSupplementalUrl(figure.sourceUrl || asset.sourceUrl),
      sourcePage: Math.max(0, Number(figure.sourcePage) || 0)
    };
    // Re-reading an already canonical persisted identity must be idempotent.
    // An absent mode may be the normalized form of an old extractor-only mode.
    const retainAbsentCanonicalMode = existingFigureId === figureId &&
      Boolean(figure.originalFigureId) &&
      !Object.prototype.hasOwnProperty.call(figure, 'sourceMode');
    const sourceMode = retainAbsentCanonicalMode
      ? '' : migratedSupplementalFigureSourceMode(figure, asset);
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
      sourceFingerprint: source.sourceFingerprint,
      figureKind: source.figureKind,
      figureLabel: source.figureLabel,
      sourcePage: source.sourcePage,
      identityRevision: Number.isSafeInteger(source.identityRevision) &&
        source.identityRevision >= 1 ? source.identityRevision : 1
    };
    const figure = normalizeSupplementalFigure({
      figureId: input.figureId,
      figureKind: source.figureKind,
      figureLabel: source.figureLabel || canonicalManualFigureLabel(
        input.figureLabel, source.figureKind, 'Figure S'
      ),
      sourcePage: source.sourcePage,
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

  function nextSupplementalFigureLabel(value = []) {
    const assets = Array.isArray(value) ? value : [value];
    const figures = assets.flatMap(item => {
      const asset = item?.content && typeof item.content === 'object'
        ? item.content : item;
      return Array.isArray(asset?.figures) ? asset.figures : [];
    });
    let highest = 0;
    figures.forEach(figure => {
      highest = Math.max(highest, supplementalFigureSequence(figure));
    });
    return `Figure S${Math.max(highest, figures.length) + 1}`;
  }

  async function createManualSupplementalDraft(input = {}, deps = {}) {
    const source = normalizeSupplementalFigureSource(input);
    if (!['image', 'caption'].includes(source.sourceMode)) {
      throw supplementalError('SUPPLEMENTAL_SOURCE_MODE');
    }
    if (typeof deps.exists !== 'function') {
      throw supplementalError('SUPPLEMENTAL_EXISTS_REQUIRED');
    }
    if (typeof deps.save !== 'function') {
      throw supplementalError('SUPPLEMENTAL_DRAFT_INVALID');
    }
    const rawAnalysisImages = input.analysisImages;
    if (rawAnalysisImages !== undefined &&
        (!Array.isArray(rawAnalysisImages) || rawAnalysisImages.length > 1)) {
      throw supplementalError('SUPPLEMENTAL_TRANSIENT_IMAGE');
    }
    const analysisImages = (rawAnalysisImages || []).map(image =>
      normalizeSupplementalTransientImage(image, source.sourceFingerprint));
    const analysisStatus = input.analysisStatus === 'awaiting_article_context'
      ? 'awaiting_article_context' : 'draft';
    const conflictedMaterialIds = new Set();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const materialId = await allocateSupplementalMaterialId({
        sourceFingerprint: source.sourceFingerprint,
        readablePrefix: input.readablePrefix || source.sourceMaterialId ||
          `manual-${source.sourceMode}`
      }, {
        exists: async candidate => conflictedMaterialIds.has(candidate) ||
          Boolean(await deps.exists(candidate)),
        randomHex: deps.randomHex
      });
      const sourceDraft = createSupplementalFigureImportDraft({
        ...source,
        sourceMaterialId: materialId,
        title: input.title,
        figureId: input.figureId,
        figureKind: input.figureKind || source.figureKind,
        figureLabel: input.figureLabel || source.figureLabel,
        sourcePage: input.sourcePage ?? source.sourcePage
      });
      const draftContent = {
        ...sourceDraft,
        analysisStatus,
        figures: sourceDraft.figures.map((figure, index) => ({
          ...figure,
          analysisStatus,
          ...(index === 0 && analysisImages.length
            ? { analysisImages }
            : {})
        }))
      };
      const relativePath = supplementalFigureAssetPath(materialId);
      try {
        const persisted = await deps.save(
          relativePath,
          draftContent,
          { expectedRevision: 0, createOnly: true }
        );
        return { materialId, relativePath, asset: draftContent, persisted };
      } catch (error) {
        if (error?.code !== 'ASSET_REVISION_CONFLICT') throw error;
        conflictedMaterialIds.add(materialId);
      }
    }
    throw supplementalError('SUPPLEMENTAL_MATERIAL_ID_COLLISION');
  }

  function mergeSupplementalFigureAssets(mainFigures = [], assets = []) {
    const mergedMain = [];
    const mergedSupplemental = [];
    const seen = new Set();
    const append = figure => {
      const id = text(figure?.figureId, 200);
      if (!id || seen.has(id)) return;
      seen.add(id);
      if (figure?.isSupplemental === true) mergedSupplemental.push(figure);
      else mergedMain.push(figure);
    };
    const imported = (Array.isArray(assets) ? assets : []).flatMap(asset => {
      const figures = Array.isArray(asset?.figures) ? asset.figures : [];
      const normalized = figures.map(figure =>
        normalizeSupplementalFigure(figure, asset));
      // A persisted canonical record owns its analysis/checkpoint fields.
      // A raw reader alias may normalize to the same ID, but must not hide it.
      const canonicalIds = new Set(normalized.filter((figure, index) =>
        text(figures[index]?.figureId, 200) === figure.figureId
      ).map(figure => figure.figureId));
      return normalized.filter((figure, index) =>
        text(figures[index]?.figureId, 200) === figure.figureId ||
        !canonicalIds.has(figure.figureId));
    });
    const manualMainByLabel = new Map(imported
      .filter(figure => figure.isSupplemental !== true)
      .map(figure => [compactText(figure.figureLabel).toLowerCase(), figure]));
    (Array.isArray(mainFigures) ? mainFigures : []).forEach(figure => {
      const key = compactText(figure?.figureLabel).toLowerCase();
      const replacement = manualMainByLabel.get(key);
      append(replacement || figure);
      if (replacement) manualMainByLabel.delete(key);
    });
    manualMainByLabel.forEach(append);
    imported.filter(figure => figure.isSupplemental === true).forEach(append);
    return [...mergedMain, ...mergedSupplemental.sort(compareSupplementalFigures)];
  }

  function activeFigureResult(figure = {}) {
    if (figure.activeDepth === 'standard') {
      return figure.standard || figure.modelStandard || figure.deep || figure.modelDeep || null;
    }
    return figure.deep || figure.modelDeep || figure.standard || figure.modelStandard || null;
  }

  function normalizeSupplementalMaterialInspection(value, expected = {}) {
    const record = value || {}, material = expected.material || {}, target = expected.target || {};
    const sourceUrl = normalizeSupplementalUrl(material.url), hash = String(expected.sourceSha256 || '').replace(/^sha256:/, '');
    const fail = () => { throw supplementalError('SUPPLEMENTAL_INSPECTION_BINDING'); };
    if (record.schemaVersion !== 1 || !material.materialId || record.materialId !== material.materialId ||
        !sourceUrl || record.sourceUrl !== sourceUrl || !/^[a-f0-9]{64}$/.test(hash) || record.sourceSha256 !== hash ||
        !['pdf','tiff','docx'].includes(record.sourceFormat) || !['format-verified','inspected'].includes(record.status) ||
        (record.byteLength === null ? record.sourceFormat !== 'pdf' || record.status !== 'inspected'
          : !Number.isSafeInteger(record.byteLength) || record.byteLength < 5) ||
        !/^workspace:[a-f0-9]{64}$/.test(String(target.workspaceId || '')) ||
        !Number.isSafeInteger(target.workspaceGeneration) || target.workspaceGeneration < 1 ||
        !normalizeSupplementalUrl(target.canonicalUrl) || !/^(?:sha256:)?[a-f0-9]{64}$/.test(String(target.documentHash || '')) ||
        record.parentWorkspaceId !== target.workspaceId || record.parentWorkspaceGeneration !== target.workspaceGeneration ||
        record.parentCanonicalUrl !== normalizeSupplementalUrl(target.canonicalUrl) || record.parentDocumentHash !== target.documentHash) fail();
    const declared = String(material.sourceFormat || '').toLowerCase();
    if (declared && declared !== 'unknown' && declared !== record.sourceFormat) fail();
    const keys = record.figureKeys;
    if (!Array.isArray(keys) || keys.length > 999 || new Set(keys).size !== keys.length ||
        keys.some(key => !/^(?:s|ed)[1-9]\d{0,2}$/.test(key))) fail();
    if (record.status === 'format-verified' && (record.classification !== 'uninspected' || keys.length)) fail();
    if (record.status === 'inspected' && (!['figure-material','table-data','review-document'].includes(record.classification) ||
        (record.classification === 'figure-material' ? !keys.length : keys.length > 0))) fail();
    return { schemaVersion:1, materialId:record.materialId, sourceUrl, sourceSha256:hash,
      sourceFormat:record.sourceFormat, byteLength:record.byteLength, status:record.status,
      classification:record.classification, figureKeys:[...keys], parentWorkspaceId:target.workspaceId,
      parentWorkspaceGeneration:target.workspaceGeneration, parentCanonicalUrl:normalizeSupplementalUrl(target.canonicalUrl),
      parentDocumentHash:target.documentHash };
  }
  function createSupplementalMaterialInspection({ material, target, sourceSha256, sourceFormat, byteLength } = {}) {
    if (!Number.isSafeInteger(byteLength) || byteLength < 5) throw supplementalError('SUPPLEMENTAL_INSPECTION_BINDING');
    const record = { schemaVersion:1, materialId:material?.materialId, sourceUrl:normalizeSupplementalUrl(material?.url),
      sourceSha256:String(sourceSha256 || '').replace(/^sha256:/, ''), sourceFormat, byteLength,
      status:'format-verified', classification:'uninspected', figureKeys:[], parentWorkspaceId:target?.workspaceId,
      parentWorkspaceGeneration:target?.workspaceGeneration, parentCanonicalUrl:normalizeSupplementalUrl(target?.canonicalUrl),
      parentDocumentHash:target?.documentHash };
    return normalizeSupplementalMaterialInspection(record, {material,target,sourceSha256});
  }
  function completeSupplementalMaterialInspection(record, expected = {}) {
    const checked = normalizeSupplementalMaterialInspection(record, expected);
    if (expected.inventoryComplete !== true) throw supplementalError('SUPPLEMENTAL_INSPECTION_INCOMPLETE');
    return normalizeSupplementalMaterialInspection({...checked, status:'inspected',
      classification:expected.classification, figureKeys:expected.figureKeys}, expected);
  }

  // An internal main-Figure reference can be mistaken for a standalone
  // supplemental Figure. Classify it only when its image AND caption regions
  // lie inside one unambiguous, explicitly captioned recovered whole plate.
  function isEmbeddedSupplementalPdfRegion(region, owner) {
    const boxContains = (outer, inner) => {
      if (!outer || !inner) return false;
      const values = [outer.x, outer.y, outer.width, outer.height,
        inner.x, inner.y, inner.width, inner.height];
      return values.every(Number.isFinite) && outer.width > 0 && outer.height > 0 &&
        inner.width > 0 && inner.height > 0 && inner.x >= outer.x && inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width &&
        inner.y + inner.height <= outer.y + outer.height;
    };
    const ownerCaption = String(owner?.caption || '').normalize('NFKC');
    const explicit = ownerCaption.match(/^Figure\s+(S[1-9]\d*)\s*[:.]\s+\S/i);
    if (!region || !owner || !explicit || region.sourceRegions?.length > 1 || owner.sourceRegions?.length > 1 ||
        region.kind !== 'supplemental' || owner.kind !== 'supplemental' ||
        owner.recoveredBy !== 'pdfbox-cross-page' || owner.captionBox ||
        String(owner.originalName || '').toUpperCase() !== explicit[1].toUpperCase() ||
        String(owner.figureLabel || '').toLowerCase() !== ('Figure ' + explicit[1]).toLowerCase() ||
        !/^[1-9]\d*$/.test(String(region.originalName || '')) ||
        !/^Figure\s+[1-9]\d*(?=\b|[.:])/i.test(String(region.caption || '')) ||
        region.pageIndex !== owner.pageIndex || region.figureId === owner.figureId) return false;
    return boxContains(owner.figureBox, region.figureBox) &&
      boxContains(owner.figureBox, region.captionBox) &&
      region.figureBox.width * region.figureBox.height < owner.figureBox.width * owner.figureBox.height;
  }

  function groupSupplementalPdfFigureRegions(figures) {
    const values = (Array.isArray(figures) ? figures : []).map(figure => ({ ...figure }));
    const embedded = new Set();
    for (const region of values) {
      const owners = values.filter(owner => isEmbeddedSupplementalPdfRegion(region, owner));
      if (owners.length !== 1) continue;
      const owner = owners[0];
      owner.embeddedRegions = [...(owner.embeddedRegions || []), {
        ...region, sourceRole: 'embedded-label-region', embeddedInFigureId: owner.figureId
      }];
      embedded.add(region);
    }
    return values.filter(figure => !embedded.has(figure));
  }

  function supplementalPdfLogicalEntries(manifest) {
    // Explicit main-Figure references in an attachment remain separate source
    // identities. They cannot satisfy S-number coverage in the parent paper.
    return (Array.isArray(manifest?.figures) ? manifest.figures : []).filter(entry =>
      !(entry?.kind === 'supplemental' && entry.labelWasExplicit === true &&
        /^Figure\s+[1-9]\d*[A-Z]?$/i.test(String(entry.figureLabel || '')))
    );
  }

  function supplementalPdfSourceImageEntries(manifest) {
    const figures = Array.isArray(manifest?.figures) ? manifest.figures : [];
    const entries = [], ids = new Set();
    for (const owner of figures) {
      entries.push(owner);
      if (owner?.embeddedRegions === undefined) continue;
      if (!Array.isArray(owner.embeddedRegions)) throw supplementalError('SUPPLEMENTAL_SOURCE_REGION_INVALID');
      for (const region of owner.embeddedRegions) {
        if (!region?.figureId || region.embeddedRegions !== undefined ||
            region.sourceRole !== 'embedded-label-region' || region.embeddedInFigureId !== owner.figureId ||
            !isEmbeddedSupplementalPdfRegion(region, owner)) throw supplementalError('SUPPLEMENTAL_SOURCE_REGION_INVALID');
        entries.push(region);
      }
    }
    if (entries.length > 300) throw supplementalError('SUPPLEMENTAL_SOURCE_REGION_INVALID');
    for (const entry of entries) {
      if (!entry?.figureId || ids.has(entry.figureId)) throw supplementalError('SUPPLEMENTAL_SOURCE_REGION_INVALID');
      ids.add(entry.figureId);
    }
    return entries;
  }

  function supplementalMaterialInspectionFromAsset(material, stored, target, proof) {
    const asset = stored?.content || stored;
    if (!asset || !proof || proof.materialId !== material?.materialId || proof.sourceUrl !== material?.url) return null;
    const sha = String(proof.sourceSha256 || '').replace(/^sha256:/, '');
    const persisted = proof.sourceImagePersistence;
    if (persisted?.complete !== true || persisted.workspaceId !== target?.workspaceId ||
        persisted.workspaceGeneration !== target?.workspaceGeneration || persisted.canonicalUrl !== target?.canonicalUrl ||
        persisted.documentHash !== target?.documentHash || !Array.isArray(persisted.verifiedAssets)) return null;
    try {
      const expected = {material,target,sourceSha256:sha};
      if (asset.materialId !== material.materialId || asset.sourceUrl !== material.url ||
          asset.parentWorkspaceId !== target.workspaceId || asset.parentWorkspaceGeneration !== target.workspaceGeneration ||
          asset.parentCanonicalUrl !== target.canonicalUrl || asset.parentDocumentHash !== target.documentHash) return null;
      if (asset.sourceFormat === 'docx') {
        if (typeof shared.validateSupplementalDocxFigureAsset !== 'function') return null;
        shared.validateSupplementalDocxFigureAsset(asset,material,target);
        if (asset.figures.some(f => !persisted.verifiedAssets.some(v => v.verified === true &&
            v.relativePath === f.sourceImage.relativePath && v.sha256 === f.sourceImage.sha256 && v.byteLength === f.sourceImage.byteLength))) return null;
      }
      const nativeManifest = asset.parsedDocument?.pdfFigureManifest;
      if (nativeManifest?.source === 'pdffigures2') {
        const paths = new Map();
        for (const entry of supplementalPdfSourceImageEntries(nativeManifest)) {
          const path = String(entry.image?.workspacePath || ''), hash = String(entry.image?.sha256 || '');
          if (!/^pdf\/figures\/supplemental\/[^/]+\.(?:png|jpe?g|webp)$/i.test(path) ||
              path.includes('..') || path.includes('\\') || !/^[a-f0-9]{64}$/.test(hash) ||
              paths.has(path) && paths.get(path) !== hash ||
              !persisted.verifiedAssets.some(item => item.relativePath === path && item.sha256 === hash &&
                item.verified === true && Number.isSafeInteger(item.byteLength) && item.byteLength > 0)) return null;
          paths.set(path, hash);
        }
      }
      if (asset.sourceInspection) return {record:normalizeSupplementalMaterialInspection(asset.sourceInspection,expected),sourceSha256:sha};
      const manifest = asset.parsedDocument?.pdfFigureManifest;
      if (asset.materialId !== material.materialId || asset.sourceUrl !== material.url ||
          manifest?.source !== 'pdffigures2' || manifest.status !== 'ready' || manifest.error != null ||
          manifest.documentFingerprint !== sha || !Array.isArray(manifest.figures) || !manifest.figures.length || manifest.figures.length > 300 ||
          manifest.figureCount !== manifest.figures.length || !Array.isArray(asset.figures) ||
          (asset.parsedDocument.originalDocumentHash && String(asset.parsedDocument.originalDocumentHash).replace(/^sha256:/,'') !== sha)) return null;
      const keys = [], ids = [], paths = new Map();
      for (const entry of supplementalPdfLogicalEntries(manifest)) {
        const key = supplementalFigureKey(entry.figureLabel || entry.label || entry.name || entry.figureId);
        const path = String(entry.image?.workspacePath || ''), hash = String(entry.image?.sha256 || '');
        const matches = asset.figures.filter(figure => supplementalFigureKey(figure.figureLabel || figure.originalFigureId || figure.figureId) === key);
        if (!key || keys.includes(key) || matches.length !== 1 || !String(matches[0].caption || '').trim() ||
            !/^pdf\/figures\/supplemental\/[^/]+\.(?:png|jpe?g|webp)$/i.test(path) || path.includes('..') || path.includes('\\') ||
            !/^[a-f0-9]{64}$/.test(hash) || paths.has(path) && paths.get(path) !== hash ||
            !persisted.verifiedAssets.some(item => item.relativePath === path && item.sha256 === hash && item.verified === true && Number.isSafeInteger(item.byteLength) && item.byteLength > 0)) return null;
        paths.set(path,hash);keys.push(key);ids.push(normalizeSupplementalFigure(matches[0],asset).figureId);
      }
      if (!Array.isArray(proof.figureIds) || proof.figureIds.length !== ids.length || new Set(proof.figureIds).size !== ids.length || ids.some(id => !proof.figureIds.includes(id))) return null;
      // The original byte SHA survives in older native manifests; byte length
      // does not. Keep null instead of inventing a value for those assets.
      const record = normalizeSupplementalMaterialInspection({schemaVersion:1,materialId:asset.materialId,sourceUrl:asset.sourceUrl,
        sourceSha256:sha,sourceFormat:'pdf',byteLength:null,status:'inspected',classification:'figure-material',figureKeys:keys,
        parentWorkspaceId:asset.parentWorkspaceId,parentWorkspaceGeneration:asset.parentWorkspaceGeneration,
        parentCanonicalUrl:asset.parentCanonicalUrl,parentDocumentHash:asset.parentDocumentHash},expected);
      return {record,sourceSha256:sha};
    } catch (_) { return null; }
  }

  // Durable absence records describe an inspected attachment, not a model result.
  // Tab IDs are transient; the four persisted paper fields must survive reopening.
  function projectSupplementalDocxNoFigureMaterial(material, stored, target = {}) {
    const asset = stored?.content || stored, record = asset?.sourceInspection;
    const declaredFormat = String(material?.sourceFormat || '').toLowerCase();
    if (declaredFormat && !['unknown', 'docx', 'word'].includes(declaredFormat) || material?.containsFigures === true) return null;
    if (!asset || !record || !/^(?:docx|word)$/i.test(declaredFormat) &&
        !/\.docx$/i.test(String(material?.url || '').split(/[?#]/)[0])) return null;
    if (asset.materialId !== material.materialId || asset.sourceUrl !== material.url ||
        asset.parentWorkspaceId !== target.workspaceId || asset.parentWorkspaceGeneration !== target.workspaceGeneration ||
        asset.parentCanonicalUrl !== target.canonicalUrl || asset.parentDocumentHash !== target.documentHash ||
        !record.target || ['workspaceId','workspaceGeneration','canonicalUrl','documentHash'].some(key => record.target[key] !== target[key]) ||
        record.sourceFormat !== 'docx' || record.sourceMaterialId !== material.materialId || record.sourceUrl !== material.url ||
        record.checkedNoFigures !== true || record.complete !== true || !/^[a-f0-9]{64}$/.test(record.containerSha256 || '') ||
        !Number.isSafeInteger(record.byteLength) || record.byteLength < 1 || record.byteLength > 64 * 1024 * 1024 ||
        !Number.isFinite(Date.parse(record.inspectedAt)) || !Array.isArray(record.findings) || record.findings.length ||
        !Array.isArray(record.scannedParts) || !record.scannedParts.includes('word/document.xml') ||
        !Number.isSafeInteger(record.tableCount) || record.tableCount < 0 ||
        !Number.isSafeInteger(record.bodyParagraphCount) || record.bodyParagraphCount < 0 ||
        !['text-no-embedded-figures','tables-and-text-no-embedded-figures'].includes(record.classification) ||
        !Array.isArray(asset.figures) || asset.figures.length || material.declaredFigureLabels?.length) return null;
    return { ...material, kind: 'data', sourceFormat: 'docx', containsFigures: false,
      requiresFormatInspection: false, sourceInspection: record };
  }

  function figureBulkSourceDependencyIds(figure, materials = []) {
    if (figure?.nativeTiffSource) return [String(figure.nativeTiffSource.materialId || figure.figureId)];
    const mode = String(figure?.sourceMode || '').toLowerCase();
    const sourceId = String(figure?.sourceMaterialId || '');
    if (figure?.sourceKind === 'pdf-page-caption' && sourceId) return [sourceId];
    const imported = figure?.sourceExternal === true || ['pdf', 'docx', 'word'].includes(mode);
    if (!imported) return [];
    const matches = materials.filter(material => sourceId
      ? material.materialId === sourceId : material.url === figure.sourceUrl);
    if (matches.length) return matches.map(material => material.materialId);
    return ['pdf', 'docx', 'word'].includes(mode)
      ? [sourceId || String(figure?.sourceUrl || figure?.figureId || '')] : [];
  }

  function buildFigureBulkSourcePlan({ inventory = [], materials = [], proofs = [], auxiliarySources = [],
    tiffSources = [], sourceIssues = [], coverage = {}, priorCoverage = {} } = {}) {
    const verified = new Set([
      ...proofs.flatMap(proof => proof.figureIds || []),
      ...auxiliarySources.flatMap(proof => proof.figureIds || []),
      ...tiffSources.map(proof => proof.figureId)
    ]);
    const issues = sourceIssues.map(issue => ({ ...issue }));
    const readyFigureIds = [], blockedFigureIds = [];
    for (const figure of inventory) {
      const dependencies = figureBulkSourceDependencyIds(figure, materials);
      if (!dependencies.length || verified.has(figure.figureId)) readyFigureIds.push(figure.figureId);
      else {
        blockedFigureIds.push(figure.figureId);
        for (const materialId of dependencies) {
          if (!issues.some(issue => issue.materialId === materialId)) issues.push({ materialId,
            title: figure.sourceTitle || figure.figureLabel || materialId, url: figure.sourceUrl || '',
            status: 'pending', code: 'FIGURE_SOURCE_PREPARATION_REQUIRED',
            message: '该 Figure 的来源尚未取得完整证明。', retryable: true });
        }
      }
    }
    for (const issue of issues) {
      const affected = inventory.filter(figure => blockedFigureIds.includes(figure.figureId) &&
        figureBulkSourceDependencyIds(figure, materials).includes(issue.materialId));
      issue.affectedFigureIds = affected.map(figure => figure.figureId);
      issue.affectedFigureLabels = affected.map(figure => figure.figureLabel || figure.figureId);
      const declared = materials.find(material => material.materialId === issue.materialId)?.declaredFigureLabels || [];
      issue.declaredFigureLabels = [...declared];
      issue.scope = affected.length ? 'dependent-figures' : 'unresolved-attachment';
    }
    const missingFigureLabels = [...new Set([
      ...(coverage.missingFigureLabels || []), ...(priorCoverage.missingFigureLabels || []).filter(label =>
        !inventory.some(figure => supplementalFigureKey(figure.figureLabel || figure.figureId) === supplementalFigureKey(label)))
    ])];
    const uninspectedMaterialIds = [...new Set(coverage.uninspectedMaterialIds || [])];
    return { readyFigureIds, blockedFigureIds, sourceIssues: issues, missingFigureLabels,
      // Unknown attachments remain in the catalog, but only an actual Figure
      // dependency or a known missing Figure can make this analysis incomplete.
      figureScopeComplete: !blockedFigureIds.length && !missingFigureLabels.length,
      uninspectedMaterialIds, complete: !issues.length && !blockedFigureIds.length &&
        !missingFigureLabels.length && !uninspectedMaterialIds.length };
  }

  function formatFigureBulkSourceSummary(plan = {}) {
    const missingKeys = new Set((plan.missingFigureLabels || []).map(supplementalFigureKey));
    const rows = (plan.sourceIssues || []).flatMap(issue => {
      const affected = issue.affectedFigureLabels?.length ? issue.affectedFigureLabels : (issue.affectedFigureIds || []);
      const missing = (issue.declaredFigureLabels || []).filter(label => missingKeys.has(supplementalFigureKey(label)));
      const scope = [...affected, ...missing];
      if (!scope.length) return [];
      return `${issue.title || issue.materialId || '附件'}${issue.url ? ` <${issue.url}>` : ''}` +
        `（${[...new Set(scope)].join('、')}）：${issue.message || '来源待补齐'}`;
    });
    if (plan.missingFigureLabels?.length) rows.push('缺失图：' + plan.missingFigureLabels.join('、'));
    return rows.join('；');
  }

  function buildSupplementalCoverage(input = {}) {
    const references = Array.isArray(input.references) ? input.references : [];
    const materials = Array.isArray(input.materials) ? input.materials : [];
    const figures = Array.isArray(input.figures)
      ? input.figures.filter(figure => figure?.isSupplemental === true) : [];
    const declaredReferences = materials.flatMap(material => (Array.isArray(material?.declaredFigureLabels) ? material.declaredFigureLabels : []).map(label => ({kind:'supplemental-figure',label})));
    const inspected = new Map(), formatVerified = new Map();
    const assets = typeof input.materialAssets?.values === 'function' ? [...input.materialAssets.values()] : Array.isArray(input.materialAssets) ? input.materialAssets : [];
    const projected = materials.flatMap(material => assets.flatMap(asset =>
      (Array.isArray(input.strictSourceProofs) ? input.strictSourceProofs : []).map(proof =>
        supplementalMaterialInspectionFromAsset(material, asset, input.parentTarget, proof)).filter(Boolean)));
    for (const material of materials) {
      const matches = [];
      for (const entry of [...(Array.isArray(input.materialInspections) ? input.materialInspections : []),...projected]) {
        if (entry?.record?.materialId !== material?.materialId) continue;
        try { matches.push(normalizeSupplementalMaterialInspection(entry.record, {
          material, target:input.parentTarget, sourceSha256:entry.sourceSha256 })); } catch (_) {}
      }
      // Conflicting source versions stay pending instead of selecting a winner.
      if (new Set(matches.map(record => JSON.stringify(record))).size === 1) {
        formatVerified.set(material.materialId, matches[0]);
        if (matches[0].status === 'inspected') inspected.set(material.materialId, matches[0]);
      }
    }
    const requiresInspection = material => !inspected.has(material?.materialId) &&
      (material?.requiresFormatInspection === true || material?.sourceFormat === 'unknown' ||
       material?.kind === 'attachment' && !material?.sourceFormat || material?.kind === 'pdf' ||
       material?.sourceMode === 'pdf' || material?.containsFigures === true || formatVerified.has(material?.materialId));
    const inspectedReferences = [...inspected.values()].flatMap(record => record.figureKeys.map(label =>
      ({kind:label.startsWith('ed')?'extended-data-figure':'supplemental-figure',label})));
    const uninspectedMaterialIds = materials.filter(requiresInspection).map(material => material.materialId).filter(Boolean);
    const expectedFigureKeys = [...new Set([...references, ...declaredReferences, ...inspectedReferences]
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
    const hasPendingFigureMaterial = materials.some(material =>
      !inspected.has(material?.materialId) && (material?.kind === 'pdf' || material?.sourceMode === 'pdf' ||
      material?.containsFigures === true || formatVerified.has(material?.materialId) || requiresInspection(material))
    );
    let status = 'none';
    if (expectedFigureKeys.length || hasPendingFigureMaterial) status = 'unparsed';
    if (foundFigureKeys.length) status = missingFigureKeys.length ? 'partial' : 'found';
    if (foundFigureKeys.length && analyzedFigureKeys.length === foundFigureKeys.length &&
        !missingFigureKeys.length && !materials.some(requiresInspection)) status = 'complete';
    return {
      status,
      expectedFigureCount: expectedFigureKeys.length,
      foundFigureCount: foundFigureKeys.length,
      analyzedFigureCount: analyzedFigureKeys.length,
      materialCount: materials.length,
      uninspectedMaterialIds,
      formatVerifiedMaterialIds:[...formatVerified.keys()],
      inspectedMaterialIds:[...inspected.keys()],
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

  function normalizeSupplementalDocumentHash(value) {
    const raw = text(value, 80).toLowerCase();
    if (!raw) return '';
    const hex = raw.replace(/^sha256:/, '');
    return /^[a-f0-9]{64}$/.test(hex) ? `sha256:${hex}` : '';
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
    const parentDocumentHash = normalizeSupplementalDocumentHash(
      input.parentDocumentHash
    );
    if (parentDocumentHash) {
      url.searchParams.set(
        SUPPLEMENTAL_BINDING_KEYS.parentDocumentHash,
        parentDocumentHash
      );
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
    const parentDocumentHash = normalizeSupplementalDocumentHash(
      url.searchParams.get(SUPPLEMENTAL_BINDING_KEYS.parentDocumentHash)
    );
    return {
      parentWorkspaceId: workspaceId.toLowerCase(),
      parentWorkspaceGeneration: Math.max(1, Number(
        url.searchParams.get(SUPPLEMENTAL_BINDING_KEYS.parentWorkspaceGeneration)
      ) || 1),
      parentCanonicalUrl: normalizeSupplementalUrl(
        url.searchParams.get(SUPPLEMENTAL_BINDING_KEYS.parentCanonicalUrl)
      ),
      parentDocumentHash,
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

  // Standalone publisher-owned TIFF supplements. No guessed CDN or preview URLs.
  function nativeFrontiersArticleIdentity(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !/^(?:www\.)?frontiersin\.org$/i.test(url.hostname) || url.username || url.password || url.port) return null;
      const match = decodeURIComponent(url.pathname).match(/^\/(?:journals\/[-a-z]+\/)?articles\/(10\.3389\/[a-z0-9]+\.\d{4}\.(\d+))\/full\/?$/i);
      return match ? { doi: match[1], articleId: match[2] } : null;
    } catch (_) { return null; }
  }
  function nativeFrontiersTiffAsset(value, doi) {
    try {
      const url = new URL(value), articleId = doi.split('.').at(-1);
      if (url.protocol !== 'https:' || !/^public-pages-files(?:-\d{4})?\.frontiersin\.org$/i.test(url.hostname) || url.username || url.password || url.port || url.search) return null;
      const pieces = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (pieces.length !== 6 || pieces[0] !== 'articles' || pieces[1] !== articleId || pieces[2] !== 'file' ||
          !/^[-a-z0-9_. ]+\.tiff?$/i.test(pieces[3]) || !/^[-a-z0-9_]+$/i.test(pieces[4]) || !/^[1-9]\d*$/.test(pieces[5])) return null;
      return { fileName: pieces[3], materialId: `frontiers:${doi}:${pieces.slice(3).join(':')}` };
    } catch (_) { return null; }
  }
  function discoverNativeFrontiersTiffFigures(documentLike, documentUrl) {
    const article = nativeFrontiersArticleIdentity(documentUrl);
    if (!article) return [];
    const captions = [...documentLike.querySelectorAll('.Statement__Supplementarymaterial .SupplementaryMaterial')]
      .filter(owner => !owner.closest?.('[data-sci-plugin-ui],[data-sci-translation]') &&
        [...owner.querySelectorAll('strong.label')].some(label => /^Supplementary\s+Figure\s+(?:S\s*)?[1-9]\d{0,2}\.?$/i.test(compactText(nativeTiffSourceText(label)))));
    const files = [...documentLike.querySelectorAll('.SupplementalDataV4__file')]
      .filter(owner => !owner.closest?.('[data-sci-plugin-ui],[data-sci-translation]'));
    const images = files.filter(owner => [...owner.querySelectorAll('.SupplementalDataV4__file__name')]
      .some(name => /\.(?:tiff?|png|jpe?g|webp|gif|svg)$/i.test(compactText(name.textContent))));
    // One explicit caption and one published image file make a forced binding.
    // Multiple assets/captions need an explicit association; filename numbers
    // never supply a Figure number.
    if (captions.length !== 1 || images.length !== 1) return [];
    const element = captions[0], assetElement = images[0];
    const titles = [...element.querySelectorAll('strong.label')];
    const parts = [...element.querySelectorAll('p')];
    const links = [...assetElement.querySelectorAll('a[href]')];
    const names = [...assetElement.querySelectorAll('.SupplementalDataV4__file__name')];
    if (titles.length !== 1 || !parts.length || links.length !== 1 || names.length !== 1 ||
        titles[0].parentElement !== element || parts.some(p => p.parentElement !== element)) return [];
    const label = compactText(nativeTiffSourceText(titles[0]));
    const match = label.match(/^Supplementary\s+Figure\s+(?:S\s*)?([1-9]\d{0,2})\.?$/i);
    if (!match || element.id !== 'SF' + match[1]) return [];
    const captionText = parts.map(nativeTiffSourceText).map(compactText).filter(Boolean).join(' ');
    const sourceUrl = normalizeSupplementalUrl(links[0].getAttribute('href'), documentUrl);
    const asset = nativeFrontiersTiffAsset(sourceUrl, article.doi);
    const fileKey = value => compactText(value).replaceAll(' ', '_').toLowerCase();
    if (!asset || fileKey(names[0].textContent) !== fileKey(asset.fileName) || !captionText || captionText.length > 12000) return [];
    return [{ publisher: 'frontiers', figureId: 'figure-s'+match[1], figureLabel: 'Figure S'+match[1],
      caption: 'Figure S'+match[1]+'. '+captionText, element, titleElement: titles[0], captionElement: element,
      captionParts: parts, assetElement, sourceUrl, materialId: asset.materialId, doi: article.doi, documentUrl }];
  }

  function nativeTiffArticleDoi(value) {
    const frontiers = nativeFrontiersArticleIdentity(value);if(frontiers)return frontiers.doi;
    try { const url=new URL(value); if(url.origin!=='https://journals.plos.org' ||
      !/^\/[a-z]+\/article(?:\/file)?$/.test(url.pathname))return '';
      if(url.username||url.password||url.searchParams.getAll('id').length!==1)return '';
      const id=url.searchParams.get('id')||'';return /^10\.1371\/journal\.[a-z]+\.\d+$/.test(id)?id:'';
    }catch(_){return '';}
  }
  function normalizeNativeTiffBinding(value={}) {
    const documentUrl=String(value.documentUrl||''),doi=nativeTiffArticleDoi(documentUrl);
    const sourceUrl=normalizeSupplementalUrl(value.sourceUrl),figureId=String(value.figureId||'');
    const materialId=String(value.materialId||'');
    let source;try{source=new URL(sourceUrl);}catch(_){throw supplementalError('TIFF_SOURCE_BINDING');}
    if (!doi) throw supplementalError('TIFF_SOURCE_BINDING');
    const frontiers = nativeFrontiersArticleIdentity(documentUrl);
    const sourceMatches = frontiers
      ? nativeFrontiersTiffAsset(sourceUrl,doi)?.materialId === materialId
      : !source.username && !source.password && source.searchParams.getAll('id').length===1 &&
        source.searchParams.getAll('type').length===1 && source.origin==='https://journals.plos.org' &&
        source.pathname===new URL(documentUrl).pathname+'/file' && source.searchParams.get('type')==='supplementary' &&
        source.searchParams.get('id')===materialId && materialId.startsWith(doi+'.s') &&
        /^\d+$/.test(materialId.slice(doi.length+2));
    if(!sourceMatches || source.username || source.password ||
      !/^figure-s[1-9]\d{0,2}$/.test(figureId) ||
      !/^workspace:[a-f0-9]{64}$/.test(String(value.workspaceId||'')) ||
      !Number.isSafeInteger(value.workspaceGeneration)||value.workspaceGeneration<1 ||
      !/^(?:sha256:)?[a-f0-9]{64}$/.test(String(value.documentHash||'')) ||
      !/^[a-f0-9]{64}$/.test(String(value.captionSha256||'')) || !String(value.canonicalUrl||''))
      throw supplementalError('TIFF_SOURCE_BINDING');
    let canonical;
    try{canonical=new URL(value.canonicalUrl);}catch(_){throw supplementalError('TIFF_SOURCE_BINDING');}
    const article=new URL(documentUrl);
    if(canonical.username||canonical.password||canonical.protocol!=='https:'||!(
      frontiers && nativeFrontiersArticleIdentity(canonical.href)?.doi===doi || canonical.origin===article.origin&&canonical.pathname===article.pathname&&
        (!canonical.searchParams.has('id')||canonical.searchParams.get('id')===doi) ||
      /^(?:dx\.)?doi\.org$/.test(canonical.hostname)&&decodeURIComponent(canonical.pathname.slice(1))===doi))
      throw supplementalError('TIFF_SOURCE_BINDING');
    return {documentUrl,doi,sourceUrl,figureId,materialId,workspaceId:value.workspaceId,
      workspaceGeneration:value.workspaceGeneration,documentHash:value.documentHash,
      canonicalUrl:String(value.canonicalUrl),captionSha256:value.captionSha256};
  }
  function nativeTiffSourceText(element) {
    if(!element || element.closest?.('[data-sci-plugin-ui],[data-sci-translation]'))return '';
    const visit=node=>{
      if(node.nodeType===3)return node.nodeValue||'';
      if(node.matches?.('[data-sci-plugin-ui],[data-sci-translation]'))return '';
      const children=Array.from(node.childNodes||[]);
      return children.length?children.map(visit).join(''):String(node.textContent||'');
    };return visit(element);
  }
  function discoverNativeTiffFigures(documentLike,baseUrl='') {
    const documentUrl=baseUrl||documentLike?.location?.href||documentLike?.baseURI||'';
    const doi=nativeTiffArticleDoi(documentUrl);if(!doi)return [];
    if(nativeFrontiersArticleIdentity(documentUrl))return discoverNativeFrontiersTiffFigures(documentLike,documentUrl);
    const found=[],ids=new Set();
    for(const owner of Array.from(documentLike.querySelectorAll('#artText .supplementary-material')||[])) {
      if(owner.closest?.('[data-sci-plugin-ui],[data-sci-translation],[data-sci-ui],.sci-logic-panel,#sci-logic-panel,.app-nls-widget,[data-test="nls-component"]'))continue;
      const titles=Array.from(owner.querySelectorAll('h3.siTitle')||[]);
      const captions=Array.from(owner.querySelectorAll('p.preSiDOI')||[]);
      const types=Array.from(owner.querySelectorAll('p.postSiDOI')||[]);
      if(titles.length!==1||captions.length>1||types.length!==1||!/^\(TIFF?\)$/i.test(text(types[0].textContent,20)))continue;
      if([...titles,...captions,...types].some(node=>node.closest?.('.supplementary-material')!==owner))continue;
      const links=Array.from(titles[0].querySelectorAll('a[href]')||[]);
      if(links.length!==1)continue;
      const titleText=text(nativeTiffSourceText(titles[0]),12001);
      const label=text(nativeTiffSourceText(links[0]),80);
      const match=label.match(/^(?:Figure\s+S([1-9]\d{0,2})|S([1-9]\d{0,2})\s+Fig(?:ure)?\.?)\s*\.?$/i);
      if(!match||(!captions.length&&!titleText.startsWith(label)))continue;
      const number=match[1]||match[2],captionElement=captions[0]||titles[0];
      const titleDescription=titleText.slice(label.length).trim();
      const captionText=[titleDescription, ...(captions.length ? [text(nativeTiffSourceText(captions[0]),12001)] : [])].filter(Boolean).join(' ');
      if(!captionText||captionText.length>12000||titleText.length>12000)continue;
      const sourceUrl=normalizeSupplementalUrl(links[0].getAttribute('href'),documentUrl);
      let url;try{url=new URL(sourceUrl);}catch(_){continue;}
      const materialId=url.searchParams.get('id')||'',figureId='figure-s'+number;
      if(url.username||url.password||url.searchParams.getAll('id').length!==1||url.searchParams.getAll('type').length!==1||url.origin!==new URL(documentUrl).origin||url.pathname!==new URL(documentUrl).pathname+'/file'||
        url.searchParams.get('type')!=='supplementary'||!materialId.startsWith(doi+'.s')||
        !/^\d+$/.test(materialId.slice(doi.length+2)))continue;
      const ownerMarker=owner.querySelector('a.link-target[id]');
      if(ownerMarker?.id!==materialId.replace('10.1371/journal.',''))continue;
      if(ids.has(figureId)){found.push({duplicate:figureId});continue;}ids.add(figureId);
      found.push({figureId,figureLabel:'Figure S'+number,caption:'Figure S'+number+'. '+captionText,
        element:owner,captionElement,sourceUrl,materialId,doi,documentUrl});
    }
    const duplicates=new Set(found.filter(f=>f.duplicate).map(f=>f.duplicate));
    return found.filter(f=>!f.duplicate&&!duplicates.has(f.figureId));
  }

  return {
    groupSupplementalPdfFigureRegions, supplementalPdfSourceImageEntries,
    supplementalPdfLogicalEntries,
    projectSupplementalDocxNoFigureMaterial,
    normalizeSupplementalMaterialInspection, createSupplementalMaterialInspection, completeSupplementalMaterialInspection, supplementalMaterialInspectionFromAsset,
    isSupplementalRepositoryNavigation,
    nativeTiffArticleDoi, normalizeNativeTiffBinding, discoverNativeTiffFigures,
    SUPPLEMENTAL_FIGURE_ASSET_PREFIX,
    SUPPLEMENTAL_BINDING_KEYS,
    SUPPLEMENTAL_FIGURE_SOURCE_MODES,
    SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_BYTES,
    SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_EDGE,
    normalizeSupplementalUrl,
    normalizeSupplementalFigureSource,
    normalizeManualFigureKind,
    canonicalManualFigureLabel,
    normalizeSupplementalTransientImage,
    allocateSupplementalMaterialId,
    createManualSupplementalDraft,
    createSupplementalFigureImportDraft,
    nextSupplementalFigureLabel,
    supplementalMaterialKind,
    discoverSupplementalMaterials,
    collectReferencesFromText,
    extractSupplementalReferences,
    supplementalFigureKey,
    normalizeSupplementalFigure,
    supplementalFigureSequence,
    canonicalSupplementalFigureLabel,
    compareSupplementalFigures,
    mergeSupplementalFigureAssets,
    figureBulkSourceDependencyIds, buildFigureBulkSourcePlan, formatFigureBulkSourceSummary,
    buildSupplementalCoverage,
    supplementalFigureAssetPath,
    createSupplementalPdfReaderUrl,
    readSupplementalPdfBinding
  };
});
