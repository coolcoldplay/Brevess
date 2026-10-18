(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const ORIGINAL_IMAGE_ATTRIBUTES = Object.freeze([
    'data-original',
    'data-original-src',
    'data-viewer-src',
    'data-full',
    'data-full-src',
    'data-full-image',
    'data-full-image-src',
    'data-hires',
    'data-high-res-src',
    'data-large',
    'data-large-src',
    'data-zoom',
    'data-zoom-src',
    'data-enlarge',
    'data-image',
    'data-image-src',
    'data-supp-info-image',
    'data-src'
  ]);
  const LAZY_IMAGE_ATTRIBUTES = Object.freeze([
    'data-lazy-src',
    'data-lazy',
    'data-url'
  ]);
  const IMAGE_EXTENSIONS = /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp)(?:$|[?#])/i;
  const RESIZE_QUERY_KEYS = new Set([
    'w', 'width', 'h', 'height', 'dpr', 'fit', 'crop', 'rect', 'q', 'quality',
    'fm', 'format', 'auto', 'maxwidth', 'maxheight', 'wid', 'hei', 'resizemode'
  ]);

  function safeFigureSource(value, baseUrl = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^data:image\//i.test(raw)) return raw;
    try {
      const resolved = new URL(raw, baseUrl || 'https://invalid.local/');
      if (!['http:', 'https:', 'blob:'].includes(resolved.protocol)) return '';
      resolved.username = '';
      resolved.password = '';
      resolved.hash = '';
      return resolved.href;
    } catch (_) {
      return '';
    }
  }

  function parseFigureSrcset(value) {
    return String(value || '').split(',').map(item => {
      const parts = item.trim().split(/\s+/);
      const source = parts.shift() || '';
      const descriptor = parts[0] || '';
      const width = descriptor.endsWith('w') ? Number.parseFloat(descriptor) :
        descriptor.endsWith('x') ? Number.parseFloat(descriptor) * 1000 : 0;
      return { source, width: Number.isFinite(width) ? width : 0 };
    }).filter(item => item.source).sort((left, right) => right.width - left.width);
  }

  const NCBI_TILE_ORIGIN = 'https://www.ncbi.nlm.nih.gov';
  const NCBI_TILE_VIEWER_PATH = '/core/lw/2.0/html/tileshop_pmc/tileshop_pmc_inline.html';
  const NCBI_TILE_PATH = '/corecgi/tileshop/tileshop.fcgi';
  const NCBI_TILE_LIMIT = 128;
  function ncbiTileError(code = 'NCBI_FIGURE_TILE_MANIFEST_INVALID') {
    const error = new Error('NCBI Figure tile source is invalid or incomplete');
    error.code = code;
    return error;
  }
  function freezeNcbiTileValue(value) {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freezeNcbiTileValue);
      Object.freeze(value);
    }
    return value;
  }
  function ncbiTileRecord(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    const actual = Object.keys(value);
    return actual.length === keys.length && keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.hasOwn(descriptor, 'value');
    });
  }
  function parseNcbiFigureTileshopSource(value, baseUrl, expectedImageSource = '') {
    if ([value, baseUrl, expectedImageSource].some(item => typeof item !== 'string' ||
        item.length > 4096 || /[\u0000-\u001f\u007f]/u.test(item))) return null;
    try {
      const document = new URL(baseUrl);
      const article = document.pathname.match(/^\/articles\/PMC([1-9]\d{0,8})(?:\/|$)/u);
      if (document.origin !== 'https://pmc.ncbi.nlm.nih.gov' || document.username ||
          document.password || !article) return null;
      document.hash = '';
      const viewer = new URL(value, document.href);
      if (viewer.origin !== NCBI_TILE_ORIGIN || viewer.username || viewer.password ||
          viewer.hash || viewer.pathname !== NCBI_TILE_VIEWER_PATH) return null;
      const keys = [...viewer.searchParams.keys()];
      if (new Set(keys).size !== keys.length || keys.some(key => !['p', 'id', 'title'].includes(key))) return null;
      const project = viewer.searchParams.get('p');
      const imageName = viewer.searchParams.get('id') || '';
      const picture = imageName.match(/^([1-9]\d{0,8})_([A-Za-z0-9][A-Za-z0-9._-]{0,159}\.(?:jpe?g|png|gif|webp))$/u);
      if (project !== 'PMC3' || !picture || picture[1] !== article[1] ||
          picture[2].includes('..')) return null;
      let expected = '';
      if (expectedImageSource) {
        const image = new URL(expectedImageSource, document.href);
        const imagePath = image.pathname.match(/^\/pmc\/blobs\/([a-f0-9]{4,64})\/([1-9]\d{0,8})\/([a-f0-9]{4,64})\/([^/]+)$/u);
        if (image.origin !== 'https://cdn.ncbi.nlm.nih.gov' || image.username || image.password ||
            image.search || image.hash || !imagePath || imagePath[2] !== article[1] ||
            imagePath[4] !== picture[2]) return null;
        expected = image.href;
      }
      const canonicalViewer = new URL(NCBI_TILE_VIEWER_PATH, NCBI_TILE_ORIGIN);
      canonicalViewer.searchParams.set('p', project);
      canonicalViewer.searchParams.set('id', imageName);
      const manifest = new URL(NCBI_TILE_PATH, NCBI_TILE_ORIGIN);
      for (const [key, item] of Object.entries({ manifest: '1', p: project, id: imageName, w: '800', h: '800' }))
        manifest.searchParams.set(key, item);
      return freezeNcbiTileValue({ version: 'ncbi-figure-tileshop-source-v1',
        viewerUrl: canonicalViewer.href, documentUrl: document.href,
        imageSource: expected, pmcid: `PMC${article[1]}`, project,
        imageName, imageFileName: picture[2], manifestUrl: manifest.href });
    } catch (_) { return null; }
  }
  function canonicalNcbiTileSource(value) {
    const keys = ['version', 'viewerUrl', 'documentUrl', 'imageSource', 'pmcid',
      'project', 'imageName', 'imageFileName', 'manifestUrl'];
    if (!ncbiTileRecord(value, keys)) throw ncbiTileError();
    const source = parseNcbiFigureTileshopSource(value.viewerUrl, value.documentUrl, value.imageSource);
    if (!source || keys.some(key => source[key] !== value[key])) throw ncbiTileError();
    return source;
  }
  function parseNcbiTileData(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 16384) throw ncbiTileError();
    // Official manifests use unquoted object keys. Tokenize this small data
    // grammar, quote keys and use JSON.parse; never execute the returned text.
    const pattern = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:]|[A-Za-z_][A-Za-z0-9_]*/gu;
    const tokens = [];
    let end = 0;
    for (const match of text.matchAll(pattern)) {
      if (text.slice(end, match.index).trim() || tokens.length >= 1024) throw ncbiTileError();
      tokens.push(match[0]);
      end = match.index + match[0].length;
    }
    if (text.slice(end).trim()) throw ncbiTileError();
    const scopes = [];
    const encoded = tokens.map((token, index) => {
      if (token === '{' || token === '[') {
        if (scopes.length >= 4) throw ncbiTileError();
        scopes.push(token === '{' ? new Set() : null);
      } else if (token === '}' || token === ']') scopes.pop();
      const key = tokens[index + 1] === ':';
      if (key) {
        const scope = scopes.at(-1);
        const name = token.startsWith('"') ? JSON.parse(token) : token;
        if (!scope || typeof name !== 'string' || scope.has(name)) throw ncbiTileError();
        scope.add(name);
        return JSON.stringify(name);
      }
      if (/^[A-Za-z_]/u.test(token)) throw ncbiTileError();
      return token;
    });
    try { return JSON.parse(encoded.join('')); } catch (_) { throw ncbiTileError(); }
  }
  function buildNcbiTilePlan(source, view, satelliteId) {
    const { W: width, H: height, w: tileWidth, h: tileHeight, sId: layerId } = view;
    if (![width, height, tileWidth, tileHeight].every(number => Number.isSafeInteger(number) && number > 0) ||
        Math.max(width, height) > 8192 || width * height > 40000000 ||
        Math.max(tileWidth, tileHeight) > 1024 || typeof layerId !== 'string' ||
        !/^[1-9]\d{0,11}$/u.test(layerId) || typeof satelliteId !== 'string' ||
        !/^[1-9]\d{0,7}$/u.test(satelliteId)) throw ncbiTileError();
    const rows = Math.ceil(height / tileHeight), columns = Math.ceil(width / tileWidth);
    if (rows * columns > NCBI_TILE_LIMIT) throw ncbiTileError();
    const tiles = [];
    for (let row = 1; row <= rows; row += 1) for (let column = 1; column <= columns; column += 1) {
      const x = (column - 1) * tileWidth, y = (row - 1) * tileHeight;
      const rect = { x, y, width: Math.min(tileWidth, width - x), height: Math.min(tileHeight, height - y) };
      const url = new URL(NCBI_TILE_PATH, NCBI_TILE_ORIGIN);
      for (const [key, value] of Object.entries({ p: source.project, id: layerId,
        s: satelliteId, r: String(row), c: String(column) })) url.searchParams.set(key, value);
      tiles.push({ index: tiles.length, row, column, url: url.href, ...rect, sourceRect: { ...rect } });
    }
    return freezeNcbiTileValue({ version: 'ncbi-figure-tileshop-plan-v1', source,
      width, height, tileWidth, tileHeight, rows, columns, layerId, satelliteId, tiles });
  }
  function parseNcbiFigureTileshopManifest(text, value) {
    const source = canonicalNcbiTileSource(value);
    const data = parseNcbiTileData(text);
    if (!ncbiTileRecord(data, ['ProjectName', 'ImageName', 'Header', 'Footer', 'Sat', 'aView']) ||
        data.ProjectName !== source.project || data.ImageName !== source.imageName ||
        typeof data.Sat !== 'string' || !/^[1-9]\d{0,7}$/u.test(data.Sat) ||
        [data.Header, data.Footer].some(item => typeof item !== 'string' || item.length > 1024 || /[\u0000-\u001f]/u.test(item)) ||
        !Array.isArray(data.aView) || !data.aView.length || data.aView.length > 12) throw ncbiTileError();
    const ids = new Set();
    for (const view of data.aView) {
      if (!ncbiTileRecord(view, ['sId', 'sName', 'fScale', 'W', 'H', 'w', 'h']) ||
          typeof view.sId !== 'string' || ids.has(view.sId) || typeof view.sName !== 'string' ||
          view.sName.length > 24 || !Number.isFinite(view.fScale) || view.fScale <= 0 || view.fScale > 4 ||
          ![view.W, view.H, view.w, view.h].every(n => Number.isSafeInteger(n) && n > 0) ||
          Math.max(view.W, view.H) > 8192 || view.W * view.H > 40000000 ||
          Math.max(view.w, view.h) > 1024 || !/^[1-9]\d{0,11}$/u.test(view.sId)) throw ncbiTileError();
      const percent = view.sName.match(/^(\d+(?:\.\d+)?)%$/u);
      if ((percent && Math.abs(Number(percent[1]) / 100 - view.fScale) > 0.00001) ||
          (!percent && view.sName !== 'fit')) throw ncbiTileError();
      ids.add(view.sId);
    }
    const candidates = data.aView.filter(view => view.fScale <= 1)
      .sort((a, b) => b.fScale - a.fScale);
    const selected = candidates[0];
    if (!selected || candidates.some((view, index) => index && view.fScale === candidates[index - 1].fScale))
      throw ncbiTileError();
    for (const view of data.aView) {
      const ratio = view.fScale / selected.fScale;
      if (Math.abs(view.W - selected.W * ratio) > 1 || Math.abs(view.H - selected.H * ratio) > 1)
        throw ncbiTileError();
    }
    return buildNcbiTilePlan(source, selected, data.Sat);
  }
  function validateNcbiFigureTileshopTiles(value, decoded) {
    const keys = ['version', 'source', 'width', 'height', 'tileWidth', 'tileHeight',
      'rows', 'columns', 'layerId', 'satelliteId', 'tiles'];
    if (!ncbiTileRecord(value, keys)) throw ncbiTileError();
    const expected = buildNcbiTilePlan(canonicalNcbiTileSource(value.source), {
      W: value.width, H: value.height, w: value.tileWidth, h: value.tileHeight, sId: value.layerId
    }, value.satelliteId);
    if (keys.filter(key => !['source', 'tiles'].includes(key)).some(key => value[key] !== expected[key]) ||
        !Array.isArray(value.tiles) || value.tiles.length !== expected.tiles.length ||
        value.tiles.some((tile, index) => !ncbiTileRecord(tile, Object.keys(expected.tiles[index])) ||
          Object.keys(expected.tiles[index]).some(key => key === 'sourceRect'
            ? !ncbiTileRecord(tile.sourceRect, ['x', 'y', 'width', 'height']) ||
              Object.keys(expected.tiles[index].sourceRect).some(part => tile.sourceRect[part] !== expected.tiles[index].sourceRect[part])
            : tile[key] !== expected.tiles[index][key]))) throw ncbiTileError();
    const fail = () => { throw ncbiTileError('NCBI_FIGURE_TILES_INCOMPLETE'); };
    if (!Array.isArray(decoded) || decoded.length !== expected.tiles.length) fail();
    const seen = new Set();
    for (const record of decoded) {
      const tile = expected.tiles[record?.index];
      if (!tile || !Number.isSafeInteger(record?.index) || seen.has(record.index) ||
          record.width !== tile.width || record.height !== tile.height ||
          ['url', 'x', 'y'].some(key => Object.hasOwn(record, key) && record[key] !== tile[key])) fail();
      seen.add(record.index);
    }
    return true;
  }

  function springerNatureFullImageSource(value, baseUrl = '') {
    const safe = safeFigureSource(value, baseUrl);
    if (!safe) return '';
    try {
      const url = new URL(safe);
      if (url.hostname.toLowerCase() !== 'media.springernature.com') return '';
      if (!/^\/[^/]+\/springer-static\/(?:image|esm)\//i.test(url.pathname)) return '';
      url.pathname = url.pathname.replace(
        /^\/[^/]+\/springer-static\/(image|esm)\//i,
        '/full/springer-static/$1/'
      );
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function wikimediaOriginalImageSource(value, baseUrl = '') {
    const safe = safeFigureSource(value, baseUrl);
    if (!safe) return '';
    try {
      const url = new URL(safe);
      if (url.hostname.toLowerCase() !== 'upload.wikimedia.org') return '';
      const match = url.pathname.match(
        /^(\/wikipedia\/[^/]+)\/thumb(\/.+)\/(?:\d+px-|page\d+-)[^/]+$/i
      );
      if (!match) return '';
      url.pathname = `${match[1]}${match[2]}`;
      url.search = '';
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function iiifOriginalImageSource(value, baseUrl = '') {
    const safe = safeFigureSource(value, baseUrl);
    if (!safe) return '';
    try {
      const url = new URL(safe);
      const parts = url.pathname.split('/');
      if (parts.length < 5) return '';
      const quality = parts.at(-1);
      const rotation = parts.at(-2);
      const size = parts.at(-3);
      const region = parts.at(-4);
      if (!/\.(?:avif|gif|jpe?g|png|tiff?|webp)$/i.test(quality) ||
          !/^-?\d+(?:\.\d+)?!?$/.test(rotation) ||
          !/^(?:full|square|pct:\d+|[\d,]+)$/.test(region) ||
          !/^(?:full|max|pct:\d+|!?\d*,\d*)$/.test(size)) return '';
      parts.splice(-4, 4, 'full', 'full', '0', quality);
      url.pathname = parts.join('/');
      url.search = '';
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function wordpressOriginalImageSource(value, baseUrl = '') {
    const safe = safeFigureSource(value, baseUrl);
    if (!safe) return '';
    try {
      const url = new URL(safe);
      const nextPath = url.pathname.replace(
        /-\d{2,5}x\d{2,5}(?=\.(?:avif|gif|jpe?g|png|webp)$)/i,
        ''
      );
      if (nextPath === url.pathname) return '';
      url.pathname = nextPath;
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function cellPressLargeImageSource(value, baseUrl = '') {
    const safe = safeFigureSource(value, baseUrl);
    if (!safe) return '';
    try {
      const sourceUrl = new URL(safe);
      const sourceHost = sourceUrl.hostname.toLowerCase();
      const directCdnMatch = sourceUrl.pathname.match(
        /^(\/content\/image\/1-s2\.0-S\d{16}-gr\d+)(?=\.(?:jpe?g|png|webp)$)/i
      );
      if (sourceHost === 'ars.els-cdn.com' && directCdnMatch) {
        sourceUrl.pathname = sourceUrl.pathname.replace(
          /(-gr\d+)(?=\.(?:jpe?g|png|webp)$)/i,
          '$1_lrg'
        );
        return sourceUrl.href;
      }

      if (!['cell.com', 'www.cell.com'].includes(sourceHost)) return '';
      const figureMatch = sourceUrl.pathname.match(
        /^\/cms\/10\.1016\/j\.([a-z0-9]+)\.\d{4}\.\d{2}\.\d{3}\/asset\/[a-f0-9-]+\/main\.assets\/gr(\d+)\.jpg$/i
      );
      if (!figureMatch) return '';

      const articleUrl = new URL(String(baseUrl || ''));
      if (!['cell.com', 'www.cell.com'].includes(articleUrl.hostname.toLowerCase())) return '';
      let articlePath = articleUrl.pathname;
      try { articlePath = decodeURIComponent(articlePath); } catch (_) { return ''; }
      const articleMatch = articlePath.match(
        /^\/([a-z0-9-]+)\/fulltext\/(S\d{4}-\d{4}\(\d{2}\)\d{5}-\d)\/?$/i
      );
      if (!articleMatch) return '';
      const articleJournal = articleMatch[1].replace(/-/g, '').toLowerCase();
      if (articleJournal !== figureMatch[1].toLowerCase()) return '';
      const pii = articleMatch[2].replace(/[^a-z0-9]/gi, '').toUpperCase();
      if (!/^S\d{16}$/.test(pii)) return '';
      return `https://ars.els-cdn.com/content/image/1-s2.0-${pii}-gr${figureMatch[2]}_lrg.jpg`;
    } catch (_) {
      return '';
    }
  }

  function publisherLargeSuffixSource(value, baseUrl = '') {
    const safe = safeFigureSource(value, baseUrl);
    if (!safe) return '';
    const cellPressLarge = cellPressLargeImageSource(safe, baseUrl);
    if (cellPressLarge) return cellPressLarge;
    try {
      const url = new URL(safe);
      let nextPath = url.pathname;
      if (/-[ms](?=\.(?:gif|jpe?g|png|webp)$)/i.test(nextPath)) {
        nextPath = nextPath.replace(/-[ms](?=\.(?:gif|jpe?g|png|webp)$)/i, '-l');
      } else if (/_small(?=\.(?:gif|jpe?g|png|webp)$)/i.test(nextPath)) {
        nextPath = nextPath.replace(/_small(?=\.(?:gif|jpe?g|png|webp)$)/i, '_large');
      } else if (/(?:_|-)gr\d+(?=\.(?:gif|jpe?g|png|webp)$)/i.test(nextPath) &&
          /(?:els-cdn|sciencedirect)/i.test(url.hostname)) {
        nextPath = nextPath.replace(
          /((?:_|-)gr\d+)(?=\.(?:gif|jpe?g|png|webp)$)/i,
          '$1_lrg'
        );
      }
      if (nextPath === url.pathname) return '';
      url.pathname = nextPath;
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function cloudinaryOriginalImageSource(value, baseUrl = '') {
    const safe = safeFigureSource(value, baseUrl);
    if (!safe) return '';
    try {
      const url = new URL(safe);
      if (!/(?:cloudinary\.com|res\.cloudinary\.com)$/i.test(url.hostname)) return '';
      const nextPath = url.pathname.replace(
        /(\/(?:image|video)\/upload\/)(?:[^/]*[_,](?:w|h|c|q|f|dpr)_[^/]+\/)/i,
        '$1'
      );
      if (nextPath === url.pathname) return '';
      url.pathname = nextPath;
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function unscaledQueryImageSource(value, baseUrl = '') {
    const safe = safeFigureSource(value, baseUrl);
    if (!safe || /^data:|^blob:/i.test(safe)) return '';
    try {
      const url = new URL(safe);
      let changed = false;
      for (const key of [...url.searchParams.keys()]) {
        if (!RESIZE_QUERY_KEYS.has(key.toLowerCase())) continue;
        url.searchParams.delete(key);
        changed = true;
      }
      return changed ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function collectOriginalUrlVariants(value, baseUrl = '') {
    const variants = [];
    const seen = new Set();
    const push = candidate => {
      const safe = safeFigureSource(candidate, baseUrl);
      if (!safe || seen.has(safe)) return;
      seen.add(safe);
      variants.push(safe);
    };
    [
      springerNatureFullImageSource(value, baseUrl),
      wikimediaOriginalImageSource(value, baseUrl),
      iiifOriginalImageSource(value, baseUrl),
      wordpressOriginalImageSource(value, baseUrl),
      cloudinaryOriginalImageSource(value, baseUrl),
      publisherLargeSuffixSource(value, baseUrl),
      unscaledQueryImageSource(value, baseUrl)
    ].forEach(push);
    return variants;
  }

  function elementAttribute(element, name) {
    return element?.getAttribute?.(name) || '';
  }

  function collectPictureSources(imageElement) {
    const picture = imageElement?.closest?.('picture');
    if (!picture?.querySelectorAll) return [];
    const values = [];
    Array.from(picture.querySelectorAll('source')).forEach(source => {
      parseFigureSrcset(elementAttribute(source, 'srcset')).forEach(item =>
        values.push(item.source));
      parseFigureSrcset(elementAttribute(source, 'data-srcset')).forEach(item =>
        values.push(item.source));
      values.push(elementAttribute(source, 'src'));
    });
    return values.filter(Boolean);
  }

  function looksLikeFigureViewerAnchor(anchor) {
    if (!anchor) return false;
    const signal = [
      elementAttribute(anchor, 'class'),
      elementAttribute(anchor, 'rel'),
      elementAttribute(anchor, 'aria-label'),
      elementAttribute(anchor, 'title'),
      anchor.textContent,
      elementAttribute(anchor, 'href')
    ].join(' ');
    return /full[\s_-]*size|full[\s_-]*image|original|high[\s_-]*(?:res|resolution)|zoom|enlarge|download|figure|fig(?:ure)?[\s_-]*viewer/i
      .test(signal);
  }

  function collectFigureViewerLinks(imageElement, baseUrl = '') {
    const links = [];
    const seen = new Set();
    const push = value => {
      const safe = safeFigureSource(value, baseUrl);
      if (!safe || seen.has(safe) || /^data:|^blob:/i.test(safe)) return;
      seen.add(safe);
      links.push(safe);
    };
    const directAnchor = imageElement?.closest?.('a[href]');
    push(elementAttribute(directAnchor, 'href') || directAnchor?.href);
    const container = imageElement?.closest?.(
      'figure, [role="figure"], .figure, .fig, .image, .figure-container'
    );
    if (container?.querySelectorAll) {
      Array.from(container.querySelectorAll('a[href]'))
        .filter(looksLikeFigureViewerAnchor)
        .slice(0, 12)
        .forEach(anchor => push(elementAttribute(anchor, 'href') || anchor.href));
    }
    return links;
  }

  function collectFigureImageCandidates(imageElement, baseUrl = '') {
    const candidates = [];
    const seen = new Set();
    const push = value => {
      const safe = safeFigureSource(value, baseUrl);
      if (!safe || seen.has(safe)) return;
      seen.add(safe);
      candidates.push(safe);
    };
    const explicitOriginals = ORIGINAL_IMAGE_ATTRIBUTES
      .map(name => elementAttribute(imageElement, name))
      .filter(Boolean);
    const srcset = [
      ...parseFigureSrcset(elementAttribute(imageElement, 'srcset')),
      ...parseFigureSrcset(elementAttribute(imageElement, 'data-srcset'))
    ].sort((left, right) => right.width - left.width).map(item => item.source);
    const displayed = [
      imageElement?.currentSrc,
      imageElement?.src || elementAttribute(imageElement, 'src'),
      ...LAZY_IMAGE_ATTRIBUTES.map(name => elementAttribute(imageElement, name))
    ].filter(Boolean);
    const pictureSources = collectPictureSources(imageElement);

    // Publisher-declared originals are authoritative; inferred URL variants
    // are optional upgrades and must not preempt these observed sources.
    push(elementAttribute(imageElement, 'data-viewer-src'));
    collectFigureViewerLinks(imageElement, baseUrl).filter(value => IMAGE_EXTENSIONS.test(value)).forEach(push);
    [...explicitOriginals, ...srcset, ...pictureSources, ...displayed]
      .forEach(value => collectOriginalUrlVariants(value, baseUrl).forEach(push));
    explicitOriginals.forEach(push);
    srcset.forEach(push);
    pictureSources.forEach(push);
    collectFigureViewerLinks(imageElement, baseUrl).forEach(push);
    displayed.forEach(push);
    return candidates;
  }

  function decodeHtmlUrl(value) {
    return String(value || '')
      .replace(/\\u002f/gi, '/')
      .replace(/\\u0026/gi, '&')
      .replace(/\\\//g, '/')
      .replace(/&amp;/gi, '&')
      .replace(/&#x2f;/gi, '/')
      .replace(/&#47;/gi, '/')
      .replace(/&quot;/gi, '"')
      .trim();
  }

  function extractFigureImageCandidatesFromHtml(html, baseUrl = '') {
    const source = String(html || '').slice(0, 4 * 1024 * 1024);
    const candidates = [];
    const seen = new Set();
    const scores = new Map();
    const push = (value, score = 0) => {
      const decoded = decodeHtmlUrl(value);
      collectOriginalUrlVariants(decoded, baseUrl).forEach(variant => {
        if (!seen.has(variant)) {
          seen.add(variant);
          candidates.push(variant);
        }
        scores.set(variant, Math.max(scores.get(variant) || 0, score + 10));
      });
      const safe = safeFigureSource(decoded, baseUrl);
      if (!safe) return;
      if (!seen.has(safe)) {
        seen.add(safe);
        candidates.push(safe);
      }
      scores.set(safe, Math.max(scores.get(safe) || 0, score));
    };
    let match;
    const mediaTagPattern = /<(?:img|source)\b[^>]*>/gi;
    while ((match = mediaTagPattern.exec(source))) {
      const tag = match[0];
      const figureSignal = /\b(?:figure|fig(?:ure)?[-_\s]?\d+|full[-_\s]?size|original|high[-_\s]?res|zoom|enlarge)\b/i
        .test(tag);
      const attributePattern = /\b(data-original(?:-src)?|data-full(?:-image|-image-src|-src)?|data-hires|data-high-res-src|data-large(?:-src)?|data-zoom(?:-src)?|data-image-src|src)\s*=\s*(["'])(.*?)\2/gi;
      let attributeMatch;
      while ((attributeMatch = attributePattern.exec(tag))) {
        const explicitOriginal = !/^src$/i.test(attributeMatch[1]);
        push(attributeMatch[3], explicitOriginal ? 100 : (figureSignal ? 82 : 12));
      }
    }

    const metadataTagPattern = /(?:<meta\b[^>]*(?:og:image|twitter:image|citation_image)[^>]*>|<link\b[^>]*(?:image_src|as\s*=\s*["']image["'])[^>]*>)/gi;
    while ((match = metadataTagPattern.exec(source))) {
      const value = match[0].match(/\b(?:content|href)\s*=\s*(["'])(.*?)\1/i);
      if (value) push(value[2], /citation_image|image_src/i.test(match[0]) ? 88 : 70);
    }

    const srcsetPattern = /\b(?:srcset|data-srcset)\s*=\s*(["'])(.*?)\1/gi;
    while ((match = srcsetPattern.exec(source))) {
      parseFigureSrcset(decodeHtmlUrl(match[2])).forEach(item =>
        push(item.source, 64 + Math.min(20, item.width / 100)));
    }

    const escapedUrlPattern = /https?:\\?\/\\?\/[^\s"'<>\\]+(?:\\\/[^\s"'<>\\]*)?/gi;
    while ((match = escapedUrlPattern.exec(source))) {
      const decoded = decodeHtmlUrl(match[0]);
      if (IMAGE_EXTENSIONS.test(decoded) ||
          /(?:mediaobjects|\/iiif\/|\/figure[s]?\/|\/image[s]?\/)/i.test(decoded)) {
        push(decoded, 36);
      }
    }
    return candidates
      .map((candidate, index) => ({
        candidate,
        index,
        score: scores.get(candidate) || 0
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map(item => item.candidate)
      .slice(0, 80);
  }

  function selectFigureImageSource(figure, baseUrl = '') {
    return collectFigureImageSources(figure, baseUrl)[0] || '';
  }

  function collectFigureImageSources(figure, baseUrl = '') {
    const seen = new Set();
    const candidates = [];
    if(figure?.sourceKind==='publisher-tiff-supplement') {
      const source=safeFigureSource(figure.nativeTiffSource?.sourceUrl,baseUrl);
      if(/^https:\/\/journals\.plos\.org\/[a-z]+\/article\/file\?/.test(source)) {
        seen.add(source);candidates.push(source);
      }
    }
    Array.from(figure?.imageElements || []).forEach(imageElement => {
      collectFigureImageCandidates(imageElement, baseUrl).forEach(source => {
        if (seen.has(source)) return;
        seen.add(source);
        candidates.push(source);
      });
    });
    return candidates;
  }

  function bindFigureViewerViewport(viewer) {
    const doc = viewer.ownerDocument, view = doc.defaultView, vv = view.visualViewport;
    const scroll = { left: view.scrollX, top: view.scrollY }, focus = doc.activeElement;
    const roots = [doc.documentElement, doc.body].filter(Boolean);
    const overflow = roots.map(node => ({ node, value: node.style.getPropertyValue('overflow'),
      priority: node.style.getPropertyPriority('overflow') }));
    const fit = () => {
      for (const [property, value] of Object.entries({ left: (vv?.offsetLeft || 0) + 'px',
        top: (vv?.offsetTop || 0) + 'px', right: 'auto', bottom: 'auto',
        width: (vv?.width || view.innerWidth) + 'px', height: (vv?.height || view.innerHeight) + 'px' })) {
        viewer.style.setProperty(property, value, 'important');
      }
    };
    roots.forEach(node => node.style.setProperty('overflow', 'hidden', 'important'));
    view.addEventListener('resize', fit); vv?.addEventListener('resize', fit); vv?.addEventListener('scroll', fit); fit();
    return () => {
      view.removeEventListener('resize', fit); vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit);
      for (const { node, value, priority } of overflow) {
        if (node.style.getPropertyValue('overflow') !== 'hidden' || node.style.getPropertyPriority('overflow') !== 'important') continue;
        if (value) node.style.setProperty('overflow', value, priority); else node.style.removeProperty('overflow');
      }
      view.scrollTo({ ...scroll, behavior: 'instant' });
      if (focus?.isConnected) focus.focus({ preventScroll: true });
    };
  }

  function figureOriginalDisplaySourceIdentity(image) {
    const names = ['src', 'srcset', 'sizes', ...ORIGINAL_IMAGE_ATTRIBUTES, ...LAZY_IMAGE_ATTRIBUTES, 'data-srcset'];
    return JSON.stringify([String(image?.currentSrc || image?.src || image?.getAttribute?.('src') || ''),
      names.map(name => [name, image?.getAttribute?.(name) ?? null]),
      Array.from(image?.closest?.('picture')?.querySelectorAll?.('source') || []).map(source =>
        ['src', 'srcset', 'sizes', 'media', 'type'].map(name => [name, source.getAttribute(name)]))]);
  }

  function createFigureOriginalDisplayManager({ windowRef = globalThis, documentRef = globalThis.document, getPageIdentity } = {}) {
    const entries = new Map(), pending = new WeakMap();
    const properties = ['background-image', 'background-size', 'background-position', 'background-repeat',
      'background-origin', 'background-clip', 'object-position'];
    let closed = false;
    const remove = (image, expectedEntry) => {
      const entry = entries.get(image);
      if (!entry || expectedEntry && entry !== expectedEntry) return;
      entries.delete(image);
      image.removeEventListener?.('load', read);
      for (const original of entry.originalStyles) {
        if (image.style.getPropertyValue(original.property) !== entry.appliedStyles[original.property] ||
            image.style.getPropertyPriority(original.property) !== 'important') continue;
        if (original.value) image.style.setProperty(original.property, original.value, original.priority);
        else image.style.removeProperty(original.property);
      }
      windowRef.URL.revokeObjectURL(entry.objectUrl);
    };
    const current = (image, entry) => !closed && image.isConnected && getPageIdentity() === entry.pageIdentity &&
      figureOriginalDisplaySourceIdentity(image) === entry.sourceIdentity && properties.every(property =>
        image.style.getPropertyValue(property) === entry.appliedStyles[property] && image.style.getPropertyPriority(property) === 'important');
    const read = () => {
      for (const [image, entry] of entries) if (!current(image, entry)) remove(image);
      return new Map(Array.from(entries, ([image, entry]) => [image, { ...entry,
        cacheReceipt: { ...entry.cacheReceipt }, originalStyles: entry.originalStyles.map(style => ({ ...style })) }]));
    };
    const observer = new windowRef.MutationObserver(read);
    observer.observe(documentRef.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['src', 'srcset', 'sizes', 'media', 'type', 'style', ...ORIGINAL_IMAGE_ATTRIBUTES, ...LAZY_IMAGE_ATTRIBUTES, 'data-srcset'] });
    const resized = () => { read(); windowRef.requestAnimationFrame(read); };
    const dispose = () => {
      closed = true;
      observer.disconnect();
      windowRef.removeEventListener('load', read, true);
      windowRef.removeEventListener('resize', resized);
      windowRef.removeEventListener('pagehide', dispose);
      for (const image of [...entries.keys()]) remove(image);
    };
    // Picture/media selection can change currentSrc without a DOM mutation.
    windowRef.addEventListener('load', read, true);
    windowRef.addEventListener('resize', resized);
    windowRef.addEventListener('pagehide', dispose, { once: true });
    return {
      entries: read, dispose,
      async apply(image, resource, metadata = {}) {
        const receipt = resource?.cacheReceipt, bytes = resource?.bytes;
        const originalArea = Number(image?.naturalWidth) * Number(image?.naturalHeight);
        if (closed || !image?.isConnected || !originalArea || resource?.cacheStored !== true ||
            !receipt || !/^[a-f0-9]{64}$/.test(receipt.sha256 || '') || !bytes?.length || receipt.byteLength !== bytes.length ||
            !/^https?:\/\//.test(receipt.cacheKey || '') || !/^data:image\//.test(resource.dataUrl || '') ||
            !(resource.pixelWidth * resource.pixelHeight > originalArea)) return false;
        const identity = metadata.sourceIdentity || figureOriginalDisplaySourceIdentity(image);
        const pageIdentity = getPageIdentity(), ticket = {};
        pending.set(image, ticket);
        const valid = () => !closed && pending.get(image) === ticket && image.isConnected &&
          pageIdentity === getPageIdentity() && figureOriginalDisplaySourceIdentity(image) === identity;
        const digest = new Uint8Array(await windowRef.crypto.subtle.digest('SHA-256', bytes));
        if (!valid() || Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== receipt.sha256) return false;
        const objectUrl = windowRef.URL.createObjectURL(new windowRef.Blob([bytes], { type: resource.contentType }));
        let installedEntry = null;
        try {
          const decoded = new windowRef.Image(); decoded.src = objectUrl; await decoded.decode();
          if (!valid()) { windowRef.URL.revokeObjectURL(objectUrl); return false; }
          remove(image);
          const before = image.getBoundingClientRect(), style = windowRef.getComputedStyle(image);
          const fit = style.objectFit, position = style.objectPosition;
          const size = fit === 'contain' || fit === 'cover' ? fit : fit === 'none' ||
              fit === 'scale-down' && image.naturalWidth <= before.width && image.naturalHeight <= before.height
            ? `${image.naturalWidth}px ${image.naturalHeight}px` : fit === 'scale-down' ? 'contain' : '100% 100%';
          const originalStyles = properties.map(property => ({ property, value: image.style.getPropertyValue(property),
            priority: image.style.getPropertyPriority(property) }));
          const appliedStyles = { 'background-image': `url("${objectUrl}")`, 'background-size': size,
            'background-position': position, 'background-repeat': 'no-repeat', 'background-origin': 'content-box',
            'background-clip': 'content-box', 'object-position': '-1000000px -1000000px' };
          for (const property of properties) image.style.setProperty(property, appliedStyles[property], 'important');
          // Read CSSOM's canonical spelling for exact cleanup comparisons.
          for (const property of properties) appliedStyles[property] = image.style.getPropertyValue(property);
          const entry = { ...metadata, pageIdentity, sourceIdentity: identity, objectUrl, dataUrl: resource.dataUrl,
            cacheReceipt: { ...receipt }, originalStyles, appliedStyles, originalContentValue: image.style.getPropertyValue('content'),
            originalContentPriority: image.style.getPropertyPriority('content') };
          entries.set(image, entry);
          image.addEventListener?.('load', read);
          installedEntry = entry;
          await new Promise(resolve => windowRef.requestAnimationFrame(resolve));
          const after = image.getBoundingClientRect();
          if (!valid() || !current(image, entry) || Math.abs(after.width - before.width) > .5 || Math.abs(after.height - before.height) > .5) {
            remove(image, entry); return false;
          }
          return true;
        } catch (_) {
          if (installedEntry) remove(image, installedEntry);
          else windowRef.URL.revokeObjectURL(objectUrl);
          return false;
        }
      }
    };
  }

  return {
    figureOriginalDisplaySourceIdentity,
    createFigureOriginalDisplayManager,
    bindFigureViewerViewport,
    safeFigureSource,
    parseFigureSrcset,
    parseNcbiFigureTileshopSource,
    parseNcbiFigureTileshopManifest,
    validateNcbiFigureTileshopTiles,
    springerNatureFullImageSource,
    wikimediaOriginalImageSource,
    iiifOriginalImageSource,
    wordpressOriginalImageSource,
    cellPressLargeImageSource,
    unscaledQueryImageSource,
    collectOriginalUrlVariants,
    collectFigureViewerLinks,
    collectFigureImageCandidates,
    extractFigureImageCandidatesFromHtml,
    collectFigureImageSources,
    selectFigureImageSource
  };
});
