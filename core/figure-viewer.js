(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function safeFigureSource(value, baseUrl = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^data:image\//i.test(raw)) return raw;
    try {
      const resolved = new URL(raw, baseUrl || 'https://invalid.local/');
      if (!['http:', 'https:', 'blob:'].includes(resolved.protocol)) return '';
      return resolved.href;
    } catch (error) {
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

  function collectFigureImageCandidates(imageElement, baseUrl = '') {
    const candidates = [];
    const seen = new Set();
    const push = value => {
      const safe = safeFigureSource(value, baseUrl);
      if (!safe || seen.has(safe)) return;
      seen.add(safe);
      candidates.push(safe);
    };
    ['data-original', 'data-full', 'data-hires'].forEach(name =>
      push(imageElement?.getAttribute?.(name)));
    parseFigureSrcset(imageElement?.getAttribute?.('srcset'))
      .forEach(item => push(item.source));
    const anchor = imageElement?.closest?.('a[href]');
    push(anchor?.getAttribute?.('href') || anchor?.href);
    push(imageElement?.currentSrc);
    push(imageElement?.src || imageElement?.getAttribute?.('src'));
    push(imageElement?.getAttribute?.('data-src'));
    push(imageElement?.getAttribute?.('data-lazy-src'));
    return candidates;
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
    parseFigureSrcset,
    collectFigureImageCandidates,
    collectFigureImageSources,
    selectFigureImageSource
  };
});
