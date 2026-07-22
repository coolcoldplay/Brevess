(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const FIGURE_SELECTOR = [
    'figure',
    '[role="figure"]',
    '.figure',
    '.fig',
    '.figure-wrap',
    '.figure-container',
    '.article-figure',
    '.fig-inline-img-set'
  ].join(',');
  const CAPTION_SELECTOR = [
    'figcaption',
    '.caption',
    '.figure__caption',
    '.figure-caption',
    '.fig-caption',
    '.c-article-section__figure-description',
    '[data-test="figure-caption"]',
    '[data-test="figure-description"]',
    '[class*="figure"][class*="caption"]'
  ].join(',');
  const LABEL_SELECTOR = '.fig-label,.figure-label,[class*="fig-label"]';
  const PANEL_LABEL_SELECTOR = [
    '[data-panel]',
    '[data-panel-label]',
    '.panel-label',
    '.subfigure-label',
    '[class*="panel"][class*="label"]'
  ].join(',');
  const EXCLUDED_ANCESTOR_SELECTOR = [
    'aside',
    'nav',
    'footer',
    '.references',
    '.bibliography',
    '.recommended',
    '.related',
    '[aria-hidden="true"]'
  ].join(',');
  const EXCLUDED_LABEL = /\b(?:supporting information|graphical abstract|scheme|table)\b|\u8865\u5145(?:\u56fe|\u6750\u6599)|\u56fe\u6587\u6458\u8981/i;

  function normalizeText(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  }

  function parseFigureLabel(value) {
    const text = normalizeText(value);
    if (!text) return null;
    const match = text.match(/(?:\bfig(?:ure)?s?\.?\s*|\u56fe\s*)(S\s*)?(\d{1,3})(?!\d)/i);
    if (!match) return null;
    const labelPrefix = text.slice(0, match.index).trim();
    if (EXCLUDED_LABEL.test(labelPrefix)) return null;
    const isSupplemental = Boolean(match[1]) || /\bsupplement(?:ary|al)?\b|\u8865\u5145/i.test(labelPrefix);
    const figureNumber = Number(match[2]);
    if (!Number.isInteger(figureNumber) || figureNumber < 1 || figureNumber > 999) return null;
    const figureCode = (isSupplemental ? 'S' : '') + figureNumber;
    return {
      figureNumber,
      figureCode,
      isSupplemental,
      figureId: 'figure-' + figureCode.toLowerCase(),
      figureLabel: 'Figure ' + figureCode
    };
  }

  function normalizeFigureReference(value) {
    if (value && typeof value === 'object') {
      const figureNumber = Number(value.figureNumber);
      if (!Number.isInteger(figureNumber)) return null;
      return { figureNumber, isSupplemental: Boolean(value.isSupplemental) };
    }
    const figureNumber = Number(value);
    return Number.isInteger(figureNumber) ? { figureNumber, isSupplemental: false } : null;
  }

  function extractPanelHints(caption) {
    const panels = new Set();
    const addRange = (firstLabel, lastLabel = firstLabel) => {
      const start = firstLabel.charCodeAt(0);
      const end = lastLabel.charCodeAt(0);
      if (end < start || end - start > 25) return;
      for (let code = start; code <= end; code += 1) panels.add(String.fromCharCode(code));
    };
    for (const match of normalizeText(caption).matchAll(/\(([^)]{1,80})\)/g)) {
      const content = match[1].toUpperCase();
      if (!/^[A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?(?:(?:\s*(?:,|;|&)\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+)[A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?)*$/i.test(content)) continue;
      for (const range of content.matchAll(/\b([A-Z])\s*[-\u2010-\u2015\u2212]\s*([A-Z])\b/g)) {
        addRange(range[1], range[2]);
      }
      for (const label of content.matchAll(/\b([A-Z])\b/g)) {
        addRange(label[1]);
      }
    }
    const text = normalizeText(caption);
    for (const match of text.matchAll(/\b(?:panels?|subpanels?)\s+([A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?(?:(?:\s*[,;&]\s*|\s+(?:and|or|to)\s+)[A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?)*)/gi)) {
      const group = match[1].toUpperCase();
      for (const range of group.matchAll(/\b([A-Z])\s*[-\u2010-\u2015\u2212]\s*([A-Z])\b/g)) {
        addRange(range[1], range[2]);
      }
      for (const label of group.matchAll(/\b([A-Z])\b/g)) addRange(label[1]);
    }
    for (const match of text.matchAll(/\b(?:fig(?:ure)?s?\.?\s*S?\s*\d{1,3})\s*([A-Z])\b/g)) {
      addRange(match[1]);
    }
    // Nature and several other publishers commonly write legend markers as
    // lowercase `a, ... b–d, ... e,f, ...`. Inline markup can make textContent
    // concatenate the marker and prose without a space, so whitespace after a
    // sentence boundary cannot be required here.
    for (const match of text.matchAll(
      /(?:^|[.;|]\s*)\(?([A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?(?:(?:\s*(?:,|;|&)\s*(?:(?:and|or)\s+)?|\s+(?:and|or|to)\s+)[A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?)*)\)?\s*(?=[:,.])/gi
    )) {
      const group = match[1].toUpperCase();
      for (const range of group.matchAll(/\b([A-Z])\s*[-\u2010-\u2015\u2212]\s*([A-Z])\b/g)) {
        addRange(range[1], range[2]);
      }
      for (const label of group.matchAll(/\b([A-Z])\b/g)) addRange(label[1]);
    }
    return [...panels].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }));
  }

  function extractElementPanelHints(element, caption) {
    const panels = new Set(extractPanelHints(caption));
    const add = value => {
      const text = normalizeText(value).toUpperCase();
      const direct = text.match(/^(?:PANEL\s*)?([A-Z])$/i);
      if (direct) panels.add(direct[1]);
    };
    for (const node of Array.from(element?.querySelectorAll?.(PANEL_LABEL_SELECTOR) || [])) {
      add(node?.getAttribute?.('data-panel'));
      add(node?.getAttribute?.('data-panel-label'));
      add(node?.getAttribute?.('aria-label'));
      add(node?.textContent);
    }
    for (const image of Array.from(element?.querySelectorAll?.('img,picture img') || [])) {
      const alt = normalizeText(image?.getAttribute?.('alt'));
      for (const match of alt.matchAll(/\b(?:fig(?:ure)?\.?\s*S?\s*\d{1,3})\s*([A-Z])\b/gi)) {
        panels.add(match[1].toUpperCase());
      }
    }
    return [...panels].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  }

  function figureInventoryNeedsRefresh(figures) {
    if (!Array.isArray(figures) || !figures.length) return true;
    return figures.some(figure => {
      if (figure?.element?.isConnected === false ||
          figure?.captionElement?.isConnected === false) return true;
      const liveCaption = normalizeText(
        figure?.captionElement?.textContent ||
        figure?.element?.getAttribute?.('aria-label') ||
        figure?.element?.textContent
      );
      return Boolean(liveCaption && liveCaption !== normalizeText(figure?.caption));
    });
  }

  function resolveCaptionSource(element) {
    const candidates = [];
    const add = candidate => {
      if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
    };
    add(element?.querySelector?.(CAPTION_SELECTOR));
    for (const candidate of Array.from(
      element?.querySelectorAll?.(CAPTION_SELECTOR) || []
    )) add(candidate);
    add(element);
    let best = null;
    for (const candidate of candidates) {
      const caption = normalizeText(
        candidate?.textContent || candidate?.getAttribute?.('aria-label')
      );
      if (!caption) continue;
      const panelCount = extractPanelHints(caption).length;
      const hasFigureLabel = Boolean(parseFigureLabel(caption));
      const score = panelCount * 100000 + (hasFigureLabel ? 10000 : 0) +
        Math.min(caption.length, 8000) - (candidate === element ? 250 : 0);
      if (!best || score > best.score) best = { element: candidate, caption, score };
    }
    return best || { element, caption: '', score: 0 };
  }

  function imageSource(image) {
    return normalizeText(
      image?.currentSrc ||
      image?.src ||
      image?.getAttribute?.('src') ||
      image?.getAttribute?.('data-src') ||
      image?.getAttribute?.('data-original') ||
      image?.getAttribute?.('data-lazy-src') ||
      ''
    );
  }

  function imageDimension(image, name) {
    const natural = Number(image?.['natural' + name[0].toUpperCase() + name.slice(1)]);
    const rendered = Number(image?.[name]);
    const attribute = Number(image?.getAttribute?.(name));
    return [natural, rendered, attribute].find(value => Number.isFinite(value) && value > 0) || 0;
  }

  function isUsefulFigureImage(image) {
    const source = imageSource(image);
    if (!source || /^data:image\/svg/i.test(source)) return false;
    if (/\b(?:icon|logo|avatar|spinner|placeholder|tracking)\b/i.test(source)) return false;
    const width = imageDimension(image, 'width');
    const height = imageDimension(image, 'height');
    if (width && height && (width < 96 || height < 72 || width * height < 10000)) return false;
    return true;
  }

  function collectImages(candidate) {
    const seen = new Set();
    const images = [];
    for (const image of Array.from(candidate?.querySelectorAll?.('img,picture img') || [])) {
      const source = imageSource(image);
      if (!isUsefulFigureImage(image) || seen.has(source)) continue;
      seen.add(source);
      images.push(image);
    }
    return images.slice(0, 8);
  }

  function paragraphReferencesFigure(value, figureReference) {
    const text = String(value || '');
    const target = normalizeFigureReference(figureReference);
    if (!target) return false;
    const prefixPattern = /(?:\bfig(?:ure)?s?\.?|\u56fe)\s*/gi;
    let prefixMatch;
    while ((prefixMatch = prefixPattern.exec(text))) {
      const remainder = text.slice(prefixPattern.lastIndex);
      const sequenceMatch = remainder.match(
        /^\s*S?\s*\d{1,3}[A-Za-z]?(?:(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|to)\s+|\s*&\s*|\s*[-\u2013\u2014]\s*|\s*[\u3001\u548c]\s*)(?:S?\s*\d{1,3}[A-Za-z]?|[A-Za-z]))*/i
      );
      if (!sequenceMatch) continue;
      const referencedFigures = Array.from(sequenceMatch[0].matchAll(/\b(S)?\s*(\d{1,3})[A-Za-z]?\b/gi), match => ({
        isSupplemental: Boolean(match[1]),
        figureNumber: Number(match[2])
      }));
      if (referencedFigures.some(reference =>
        reference.figureNumber === target.figureNumber &&
        reference.isSupplemental === target.isSupplemental
      )) return true;
    }
    return false;
  }

  function relatedParagraphs(paragraphs, figureReference) {
    return (Array.isArray(paragraphs) ? paragraphs : [])
      .filter(item => paragraphReferencesFigure(item?.text, figureReference))
      .slice(0, 6)
      .map(item => ({
        paragraphId: String(item?.paragraphId || '').slice(0, 120),
        sectionTitle: normalizeText(item?.sectionTitle).slice(0, 240),
        text: normalizeText(item?.text).slice(0, 1200)
      }));
  }

  function extractArticleFigures(documentLike, paragraphs = []) {
    const byId = new Map();
    const candidates = Array.from(documentLike?.querySelectorAll?.(FIGURE_SELECTOR) || []);
    for (const [documentOrder, element] of candidates.entries()) {
      if (element?.closest?.(EXCLUDED_ANCESTOR_SELECTOR)) continue;
      const captionSource = resolveCaptionSource(element);
      const captionElement = captionSource.element || element;
      const caption = captionSource.caption;
      const labelText = normalizeText(
        captionElement?.querySelector?.(LABEL_SELECTOR)?.textContent || ''
      );
      const parsed = parseFigureLabel(labelText) || parseFigureLabel(caption) ||
        parseFigureLabel(element?.textContent);
      if (!parsed) continue;
      const imageElements = collectImages(element);
      const item = {
        ...parsed,
        caption,
        captionElement: captionElement || element,
        imageElements,
        panelHints: extractElementPanelHints(element, caption),
        contextParagraphs: relatedParagraphs(paragraphs, parsed),
        documentOrder,
        element
      };
      const score = caption.length + imageElements.length * 500;
      const previous = byId.get(item.figureId);
      if (!previous || score > previous.score) byId.set(item.figureId, { score, item });
    }
    return [...byId.values()]
      .map(entry => entry.item)
      .sort((left, right) => left.documentOrder - right.documentOrder);
  }

  return {
    FIGURE_SELECTOR,
    CAPTION_SELECTOR,
    parseFigureLabel,
    extractPanelHints,
    extractElementPanelHints,
    figureInventoryNeedsRefresh,
    isUsefulFigureImage,
    extractArticleFigures
  };
});
