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
    '.captions',
    '.figure__caption',
    '.figure-caption',
    '.fig-caption',
    '.c-article-section__figure-description',
    '[data-test="figure-caption"]',
    '[data-test="figure-description"]',
    '[class*="figure"][class*="caption"]'
  ].join(',');
  const LABEL_SELECTOR = '.fig-label,.figure-label,[class*="fig-label"]';
  const STRUCTURAL_CAPTION_SELECTOR = [
    'figcaption',
    '.caption',
    '.captions',
    '.figure__caption',
    '.figure-caption',
    '.fig-caption',
    '[data-test="figure-caption"]',
    '[class*="figure"][class*="caption"]'
  ].join(',');
  const PANEL_LABEL_SELECTOR = [
    '[data-panel]',
    '[data-panel-label]',
    '.panel-label',
    '.subfigure-label',
    '[class*="panel"][class*="label"]'
  ].join(',');
  const STRUCTURED_PANEL_CAPTION_SELECTOR = [
    '[data-test="bottom-caption"]',
    '.c-article-section__figure-description'
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
    // Publisher controls and the real caption can be adjacent DOM nodes whose
    // textContent is concatenated, for example `full-size imageFigure 1`.
    // Restore that lost boundary before applying the conservative label parser.
    // Cell also inserts the product name `Figure360 author presentation` into
    // some captions. It is branding, not Figure 360, and must be removed before
    // scanning the same caption for the real Figure 1/2/3 label.
    const text = normalizeText(value)
      .replace(
        /\bFigure360(?=\s+(?:author\s+)?presentation\b)/gi,
        'Figure viewer'
      )
      .replace(
        /([a-z0-9)])(?=fig(?:ure)?s?\.?\s*(?:S\s*)?\d{1,3}(?!\d))/gi,
        '$1 '
      );
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
      const rawContent = match[1].trim();
      if (/^[ivx]+$/.test(rawContent)) continue;
      const content = rawContent.toUpperCase();
      if (!/^[A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?(?:(?:\s*(?:,|;|&)\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+)[A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?)*$/i.test(content)) continue;
      for (const range of content.matchAll(/\b([A-Z])\s*[-\u2010-\u2015\u2212]\s*([A-Z])\b/g)) {
        addRange(range[1], range[2]);
      }
      for (const label of content.matchAll(/\b([A-Z])\b/g)) {
        addRange(label[1]);
      }
    }
    const text = normalizeText(caption);
    for (const match of text.matchAll(/\b(?:panels?|subpanels?)\s+([A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?(?:(?:\s*[,;&]\s*|\s+(?:and|or|to)\s+)[A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?)*)\b/gi)) {
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
    // sentence boundary cannot be required here. Exclude glossary entries such
    // as `n.c., necrotic core` and `T, T cells`, which otherwise look like
    // single-letter Panel markers after a period or semicolon.
    for (const match of text.matchAll(
      /(?:^|[.|]\s*)\(?([A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?(?:(?:\s*(?:,|;|&)\s*(?:(?:and|or)\s+)?|\s+(?:and|or|to)\s+)[A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?)*)\)?\s*(?!\.\s*[A-Z]\.)(?!,\s*\1\b)(?=[:,.])/gi
    )) {
      const group = match[1].toUpperCase();
      if (/^\.[A-Z]$/i.test(match[0]) && text[match.index + match[0].length] === '.') {
        continue;
      }
      for (const range of group.matchAll(/\b([A-Z])\s*[-\u2010-\u2015\u2212]\s*([A-Z])\b/g)) {
        addRange(range[1], range[2]);
      }
      for (const label of group.matchAll(/\b([A-Z])\b/g)) addRange(label[1]);
    }
    const plainLegendGroups = [];
    for (const match of text.matchAll(
      /(?:^|[.!?;|]\s*)\(?([A-P](?:\s*[-\u2010-\u2015\u2212]\s*[A-P])?)\)?\s+(?=[A-Z0-9(])/g
    )) {
      plainLegendGroups.push(match[1].toUpperCase());
    }
    const plainLabels = new Set();
    plainLegendGroups.forEach(group => {
      const range = group.match(/^([A-P])\s*[-\u2010-\u2015\u2212]\s*([A-P])$/);
      if (range) {
        for (let code = range[1].charCodeAt(0); code <= range[2].charCodeAt(0); code += 1) {
          plainLabels.add(String.fromCharCode(code));
        }
      } else {
        plainLabels.add(group);
      }
    });
    const orderedPlainLabels = [...plainLabels].sort();
    const hasConsecutivePlainLabels = orderedPlainLabels.some((label, index) =>
      index > 0 && label.charCodeAt(0) - orderedPlainLabels[index - 1].charCodeAt(0) === 1
    );
    if (orderedPlainLabels.length >= 2 && hasConsecutivePlainLabels) {
      orderedPlainLabels.forEach(label => addRange(label));
    }
    return [...panels].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }));
  }

  function parseLeadingFigureLabel(value) {
    return parseFigureLabel(normalizeText(value).slice(0, 240));
  }

  function escapePattern(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function cleanFigureTitle(value) {
    return normalizeText(value)
      .replace(/^(?:[:：.\-–—]\s*)+/, '')
      .replace(/\s*(?:[:：.\-–—])+$/, '')
      .trim()
      .slice(0, 320);
  }

  function figureTitleBoundary(value) {
    const source = String(value || '');
    const matches = [
      source.search(/\s+(?:show|hide)\s+full\s+caption\b/i),
      source.search(/\s+(?:显示|隐藏)完整图注\b/),
      source.search(/\s*[\(（][A-Z](?:\s*[-–—,、]\s*[A-Z])?[\)）]\s*/),
      source.search(/\s+(?:figure\s+viewer|figure360)\b/i)
    ].filter(index => index >= 0);
    return matches.length ? Math.min(...matches) : source.length;
  }

  function extractFigureTitle(value, figureLabel = '') {
    const caption = normalizeText(value);
    const parsed = parseFigureLabel(figureLabel) || parseLeadingFigureLabel(caption);
    if (!caption || !parsed) return { title: '', translatedTitle: '' };
    const figureCode = `${parsed.isSupplemental ? 'S\\s*' : ''}${parsed.figureNumber}`;
    const chineseMarker = new RegExp(
      `(?:^|\\s)图\\s*${figureCode}(?!\\s*[A-Z])\\s*`,
      'i'
    );
    const chineseMatch = chineseMarker.exec(caption);
    let translatedTitle = '';
    if (chineseMatch) {
      const remainder = caption.slice(chineseMatch.index + chineseMatch[0].length);
      translatedTitle = cleanFigureTitle(
        remainder.slice(0, figureTitleBoundary(remainder))
      );
      if (!/[\u3400-\u9fff]/u.test(translatedTitle)) translatedTitle = '';
    }

    const labelPattern = new RegExp(
      `(?:^|\\s)(?:fig(?:ure)?\\.?\\s*)${escapePattern(
        parsed.isSupplemental ? `S${parsed.figureNumber}` : String(parsed.figureNumber)
      ).replace(/^S/, 'S\\s*')}(?![A-Z0-9])\\s*`,
      'i'
    );
    const labelMatch = labelPattern.exec(caption);
    let title = '';
    if (labelMatch) {
      const remainder = caption.slice(labelMatch.index + labelMatch[0].length);
      const chineseIndex = chineseMarker.exec(remainder)?.index ?? -1;
      const boundary = figureTitleBoundary(remainder);
      title = cleanFigureTitle(remainder.slice(
        0,
        chineseIndex >= 0 ? Math.min(boundary, chineseIndex) : boundary
      ));
    }
    return { title, translatedTitle };
  }

  function collectFigureIdentities(element) {
    const identities = new Map();
    const add = value => {
      const parsed = parseLeadingFigureLabel(value);
      if (parsed) identities.set(parsed.figureId, parsed);
    };
    for (const label of Array.from(
      element?.querySelectorAll?.(LABEL_SELECTOR) || []
    )) add(label?.textContent);
    for (const caption of Array.from(
      element?.querySelectorAll?.(STRUCTURAL_CAPTION_SELECTOR) || []
    )) add(caption?.textContent);
    add(element?.getAttribute?.('aria-label'));
    if (!identities.size) add(element?.textContent);
    return identities;
  }

  function extractStructuredPanelHints(element) {
    const panels = new Set();
    const addGroup = value => {
      const group = normalizeText(value).toUpperCase();
      if (!/^[A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?(?:(?:\s*(?:,|;|&)\s*|\s+(?:AND|OR|TO)\s+)[A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?)*$/.test(group)) return;
      for (const range of group.matchAll(/\b([A-Z])\s*[-\u2010-\u2015\u2212]\s*([A-Z])\b/g)) {
        const start = range[1].charCodeAt(0);
        const end = range[2].charCodeAt(0);
        if (end < start || end - start > 25) continue;
        for (let code = start; code <= end; code += 1) {
          panels.add(String.fromCharCode(code));
        }
      }
      for (const label of group.matchAll(/\b([A-Z])\b/g)) panels.add(label[1]);
    };
    for (const container of Array.from(
      element?.querySelectorAll?.(STRUCTURED_PANEL_CAPTION_SELECTOR) || []
    )) {
      for (const marker of Array.from(container?.querySelectorAll?.('b,strong') || [])) {
        addGroup(marker?.textContent);
      }
    }
    return [...panels].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }));
  }

  function extractElementPanelHints(element, caption) {
    const structuredPanels = extractStructuredPanelHints(element);
    const panels = new Set(structuredPanels.length
      ? structuredPanels : extractPanelHints(caption));
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

  function expandCaptionPanelGroup(value) {
    const normalized = normalizeText(value)
      .toUpperCase()
      .replace(/\b(?:PANELS?|SUBPANELS?)\b/g, ' ')
      .replace(/\b(?:AND|OR|TO)\b/g, ',')
      .replace(/[&;/]/g, ',');
    const panels = new Set();
    normalized.split(/\s*,\s*/).filter(Boolean).forEach(part => {
      const range = part.match(/^([A-Z])\s*[-\u2010-\u2015\u2212]\s*([A-Z])$/);
      if (range) {
        const start = range[1].charCodeAt(0);
        const end = range[2].charCodeAt(0);
        if (end >= start && end - start <= 25) {
          for (let code = start; code <= end; code += 1) {
            panels.add(String.fromCharCode(code));
          }
        }
        return;
      }
      const single = part.match(/^([A-Z])$/);
      if (single) panels.add(single[1]);
    });
    return [...panels].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }));
  }

  function splitFigureCaptionByPanelGroups(value) {
    const caption = normalizeText(value);
    if (!caption) return [];
    const markers = [];
    const addMarker = (index, length, group) => {
      const panels = expandCaptionPanelGroup(group);
      if (!panels.length) return;
      markers.push({
        index: Math.max(0, Number(index) || 0),
        length: Math.max(0, Number(length) || 0),
        panels
      });
    };
    const groupPattern =
      '[A-Z](?:\\s*[-\\u2010-\\u2015\\u2212]\\s*[A-Z])?' +
      '(?:(?:\\s*(?:,|&|;)\\s*|\\s+(?:and|or|to)\\s+)' +
      '[A-Z](?:\\s*[-\\u2010-\\u2015\\u2212]\\s*[A-Z])?)*';
    const parenthesized = new RegExp(`\\((${groupPattern})\\)\\s*`, 'gi');
    for (const match of caption.matchAll(parenthesized)) {
      addMarker(match.index, match[0].length, match[1]);
    }
    const inline = new RegExp(
      `(^|[.;]\\s*)(${groupPattern})(\\s*[,;:]\\s*)`,
      'gi'
    );
    for (const match of caption.matchAll(inline)) {
      const prefixLength = match[1]?.length || 0;
      addMarker(
        (match.index || 0) + prefixLength,
        match[2].length + match[3].length,
        match[2]
      );
    }
    markers.sort((left, right) =>
      left.index - right.index || right.length - left.length);
    const filtered = [];
    markers.forEach(marker => {
      const previous = filtered.at(-1);
      if (previous && marker.index < previous.index + previous.length) return;
      filtered.push(marker);
    });
    if (!filtered.length) {
      return [{ kind: 'overview', panels: [], text: caption }];
    }
    const blocks = [];
    const overview = caption.slice(0, filtered[0].index).trim();
    if (overview) blocks.push({
      kind: 'overview',
      panels: [],
      text: overview
    });
    filtered.forEach((marker, index) => {
      const end = filtered[index + 1]?.index ?? caption.length;
      const text = caption.slice(marker.index, end).trim();
      if (!text) return;
      blocks.push({
        kind: 'panels',
        panels: marker.panels,
        text
      });
    });
    return blocks.length
      ? blocks
      : [{ kind: 'overview', panels: [], text: caption }];
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

  function resolveCaptionSource(element, expectedFigureId = '') {
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
      const leadingIdentity = parseLeadingFigureLabel(caption);
      if (expectedFigureId && leadingIdentity &&
          leadingIdentity.figureId !== expectedFigureId) continue;
      const panelCount = extractPanelHints(caption).length;
      const hasFigureLabel = Boolean(leadingIdentity);
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
    // MinerU and some publisher readers expose one high-resolution image per
    // Panel. Keep the entire Figure group instead of silently dropping Panel I+
    // from large composite Figures.
    return images.slice(0, 40);
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
      const identities = collectFigureIdentities(element);
      if (identities.size > 1) continue;
      const expectedIdentity = identities.values().next().value || null;
      const captionSource = resolveCaptionSource(element, expectedIdentity?.figureId || '');
      const captionElement = captionSource.element || element;
      const caption = captionSource.caption;
      const labelText = normalizeText(
        captionElement?.querySelector?.(LABEL_SELECTOR)?.textContent || ''
      );
      const parsed = expectedIdentity || parseFigureLabel(labelText) || parseFigureLabel(caption) ||
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
    extractFigureTitle,
    extractPanelHints,
    expandCaptionPanelGroup,
    splitFigureCaptionByPanelGroups,
    extractStructuredPanelHints,
    extractElementPanelHints,
    figureInventoryNeedsRefresh,
    isUsefulFigureImage,
    extractArticleFigures
  };
});
