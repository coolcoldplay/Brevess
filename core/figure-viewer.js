(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const ORIGINAL_IMAGE_ATTRIBUTES = Object.freeze([
    'data-original',
    'data-original-src',
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
    Array.from(figure?.imageElements || []).forEach(imageElement => {
      collectFigureImageCandidates(imageElement, baseUrl).forEach(source => {
        if (seen.has(source)) return;
        seen.add(source);
        candidates.push(source);
      });
    });
    return candidates;
  }

  return {
    safeFigureSource,
    parseFigureSrcset,
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
