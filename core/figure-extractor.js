(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const FIGURE_PANEL_DIRECTORY_VERSION = '10-unicode-panel-boundaries';
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
  const STANDALONE_CAPTION_SELECTOR = [
    CAPTION_SELECTOR,
    'summary',
    '[data-figure-caption]',
    '[aria-label*="Extended Data Figure" i]',
    '[aria-label*="Supplementary Figure" i]'
  ].join(',');
  const ACCORDION_FIGURE_SELECTOR = [
    'details',
    '[class*="accordion-item"]',
    '[class*="accordion__item"]',
    '[data-accordion-item]',
    '[role="group"]'
  ].join(',');
  const NATURE_ARTICLE_SECTION_SELECTOR = '.c-article-section';
  const NATURE_SECTION_TITLE_SELECTOR = [
    '.c-article-section__title',
    '[data-test="section-title"]',
    'h2',
    'h3',
    'h4'
  ].join(',');
  const NATURE_SECTION_CONTENT_SELECTOR = [
    '.c-article-section__content',
    '[data-test="section-content"]'
  ].join(',');
  const NATURE_SUPPLEMENTARY_ITEM_SELECTOR =
    '.c-article-supplementary__item,[data-test="supplementary-item"]';
  const NATURE_SUPPLEMENTARY_TITLE_SELECTOR = [
    '.c-article-supplementary__title [data-test="supp-info-link"]',
    '.c-article-supplementary__title',
    '[data-test="supp-info-link"]'
  ].join(',');
  const NATURE_SUPPLEMENTARY_DESCRIPTION_SELECTOR =
    '.c-article-supplementary__description,[data-test="supp-info-description"]';
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
    '.c-article-section__figure-description',
    '.c-article-supplementary__description'
  ].join(',');
  const EXCLUDED_ANCESTOR_SELECTOR = [
    '[data-sci-plugin-ui]',
    '[data-sci-translation]',
    'aside',
    'nav',
    'footer',
    '.references',
    '.bibliography',
    '.recommended',
    '.related',
    '.app-nls-widget',
    '[data-test="nls-component"]',
    '[aria-hidden="true"]'
  ].join(',');
  const EXCLUDED_LABEL = /\b(?:supporting information|graphical abstract|scheme|table)\b|\u8865\u5145(?:\u56fe|\u6750\u6599)|\u56fe\u6587\u6458\u8981/i;
  const SOURCE_UI_SELECTOR = '[data-sci-plugin-ui],[data-sci-translation]';

  function isSourceUi(element) {
    return Boolean(element?.matches?.(SOURCE_UI_SELECTOR) || element?.closest?.(SOURCE_UI_SELECTOR));
  }

  // Keep textContent's source notation and spacing, but never include display UI.
  // This module can load without article-extractor, so filtering is self-contained.
  function sourceText(element) {
    if (!element || isSourceUi(element)) return '';
    const visit = node => {
      if (node.nodeType === 3) return String(node.nodeValue || '');
      if (node.nodeType && node.nodeType !== 1) return '';
      if (node.matches?.(SOURCE_UI_SELECTOR)) return '';
      const children = Array.from(node.childNodes || []);
      if (!children.length) return String(node.textContent || '');
      return children.map(visit).reduce((text, part) => {
        // A Figure label and a separate compact reference can be adjacent DOM
        // nodes (Figure 2 | 2N). Preserve that boundary without changing normal
        // scientific inline notation, numbers, or source quotation spacing.
        const separated = /\bfig(?:ure)?\.?\s*(?:S\s*)?\d{1,3}$/i.test(text) &&
          /^\d{1,3}[A-Z]\b/.test(part);
        return text + (separated ? ' ' : '') + part;
      }, '');
    };
    return visit(element);
  }

  function normalizeText(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  }

  function normalizePanelCaption(value) {
    // A paragraph boundary separates a title's "related to Figure 1" from
    // the next legend marker. Flattening it turns that marker into a citation.
    return String(value || '').normalize('NFKC').replace(/\r\n?/g, '\n')
      .replace(/[^\S\n]+/g, ' ').replace(/ *\n(?: *\n)* */g, '\n').trim();
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
    const extendedMatch = text.match(
      /\bextended\s+data\s+fig(?:ure)?s?\.?\s*(\d{1,3})(?!\d)/i
    );
    if (extendedMatch) {
      const labelPrefix = text.slice(0, extendedMatch.index).trim();
      if (EXCLUDED_LABEL.test(labelPrefix)) return null;
      const figureNumber = Number(extendedMatch[1]);
      if (!Number.isInteger(figureNumber) || figureNumber < 1 || figureNumber > 999) {
        return null;
      }
      return {
        figureNumber,
        figureCode: `ED${figureNumber}`,
        figureSeries: 'extended-data',
        isSupplemental: true,
        figureId: `figure-ed${figureNumber}`,
        figureLabel: `Extended Data Figure ${figureNumber}`
      };
    }
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
      figureSeries: isSupplemental ? 'supplemental' : 'main',
      isSupplemental,
      figureId: 'figure-' + figureCode.toLowerCase(),
      figureLabel: 'Figure ' + figureCode
    };
  }

  function normalizeFigureReference(value) {
    if (value && typeof value === 'object') {
      const figureNumber = Number(value.figureNumber);
      if (!Number.isInteger(figureNumber)) return null;
      const figureSeries = value.figureSeries === 'extended-data'
        ? 'extended-data'
        : Boolean(value.isSupplemental) ? 'supplemental' : 'main';
      return {
        figureNumber,
        figureSeries,
        isSupplemental: figureSeries !== 'main'
      };
    }
    const figureNumber = Number(value);
    return Number.isInteger(figureNumber)
      ? { figureNumber, figureSeries: 'main', isSupplemental: false }
      : null;
  }

  function isCaptionVariableParenthesis(text, index) {
    const marker = /^\([^)]{1,80}\)/.exec(text.slice(index));
    if (!marker) return false;
    const before = text.slice(0, index);
    // A new legend heading may use either case. Inline quantity definitions,
    // such as "mean distance (d) per disease", do not introduce a Panel.
    if (/(?:^|[.!?;:|\n])\s*$/.test(before)) return false;
    const after = text.slice(index + marker[0].length);
    return /\b(?:distance|sample\s+size|number\s+of\s+(?:mice|animals|cells|samples|replicates)|degrees\s+of\s+freedom|[pr][ -]?value|(?:correlation\s+)?coefficient|statistic)\s*$/i.test(before) ||
      /^\s*(?:is|denotes|represents)\s+(?:the\s+)?(?:number|sample\s+size|probability|coefficient|statistic|distance)\b/i.test(after);
  }

  function isLocalPanelParenthesis(text, index, hasCaptionIdentity = false) {
    // Parenthesized grammatical suffixes in protein(s)/mitogen(s) are not
    // headings. Nor is the parenthesis following an explicit Figure citation.
    if (/[\p{L}\p{N}]/u.test(text[index - 1] || '')) return false;
    if (isCaptionVariableParenthesis(text, index)) return false;
    // Only a source paragraph's explicit uppercase marker in an identified
    // caption can supersede the Figure-citation guard. Inline references and
    // lower-case suffixes still use the conservative path below.
    if (hasCaptionIdentity && /\n *$/.test(text.slice(0, index)) &&
        /^\([A-Z](?=[\s,;&)\-\u2010-\u2015\u2212])/.test(text.slice(index))) return true;
    return !/\b(?:extended\s+data\s+)?fig(?:ure)?s?\.?\s*(?:S\s*)?\d{1,3}[A-Za-z]?\s*$/i
      .test(text.slice(Math.max(0, index - 100), index));
  }

  function sameFigureIdentity(left, right) {
    return Boolean(left && right && left.figureNumber === right.figureNumber &&
      left.figureSeries === right.figureSeries);
  }

  function namedPanelReferenceIsLocal(text, match, target) {
    if (!target) return true;
    const figurePattern = '\\b(?:(?:extended\\s+data|supplement(?:ary|al)?)\\s+)?fig(?:ure)?s?\\.?\\s*(?:S\\s*)?\\d{1,3}(?![\\dA-Za-z])';
    const prefix = text.slice(0, match.index);
    const references = [...prefix.matchAll(new RegExp(figurePattern, 'gi'))];
    const preceding = references.at(-1);
    // An explicit owner in this clause also owns “Figure 2, panels Q and R”.
    // Periods inside “Fig.” are part of the reference, not clause boundaries.
    if (preceding && !/[.!?;|\n]/.test(prefix.slice(preceding.index + preceding[0].length)) &&
        !sameFigureIdentity(parseFigureLabel(preceding[0]), target)) return false;
    const following = new RegExp('^\\s*(?:(?:of|in|from)\\s+|\\(\\s*)(' + figurePattern + ')', 'i')
      .exec(text.slice(match.index + match[0].length));
    return !following || sameFigureIdentity(parseFigureLabel(following[1]), target);
  }

  function extractPanelHints(caption, figureReference = null, knownLocalPanels = []) {
    const panels = new Set();
    const text = normalizePanelCaption(caption);
    const target = (figureReference == null ? null : normalizeFigureReference(figureReference)) || parseLeadingFigureLabel(text);
    const addRange = (firstLabel, lastLabel = firstLabel) => {
      const start = firstLabel.charCodeAt(0);
      const end = lastLabel.charCodeAt(0);
      if (end < start || end - start > 25) return;
      for (let code = start; code <= end; code += 1) panels.add(String.fromCharCode(code));
    };
    for (const match of text.matchAll(/\(([^)]{1,80})\)/g)) {
      if (!isLocalPanelParenthesis(text, match.index, Boolean(target && target.figureNumber >= 1 && target.figureNumber <= 999))) continue;
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
    for (const match of text.matchAll(/(?<![\p{L}\p{N}\p{M}_])(?:panels?|subpanels?)\s+([A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?(?:(?:\s*[,;&]\s*|\s+(?:and|or|to)\s+)[A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?)*)(?![\p{L}\p{N}\p{M}_])/giu)) {
      if (!namedPanelReferenceIsLocal(text, match, target)) continue;
      const group = match[1].toUpperCase();
      for (const range of group.matchAll(/\b([A-Z])\s*[-\u2010-\u2015\u2212]\s*([A-Z])\b/g)) {
        addRange(range[1], range[2]);
      }
      for (const label of group.matchAll(/\b([A-Z])\b/g)) addRange(label[1]);
    }
    for (const match of text.matchAll(/(?<![\p{L}\p{N}\p{M}_])((?:extended\s+data\s+)?fig(?:ure)?s?\.?\s*(?:S\s*)?\d{1,3})\s*([A-Z])(?![\p{L}\p{N}\p{M}_])/giu)) {
      if (sameFigureIdentity(parseFigureLabel(match[1]), target)) addRange(match[2].toUpperCase());
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
      // Author initials such as "Gerdt, J. P." are not legend headings.
      if (/^[A-Z]$/.test(group) && /\b[A-Z]\.\s*$/.test(text.slice(0, match.index + match[0].indexOf(match[1]))) &&
          text[match.index + match[0].length] === '.') continue;
      if (/^\.[A-Z]$/i.test(match[0]) && text[match.index + match[0].length] === '.') {
        continue;
      }
      for (const range of group.matchAll(/\b([A-Z])\s*[-\u2010-\u2015\u2212]\s*([A-Z])\b/g)) {
        addRange(range[1], range[2]);
      }
      for (const label of group.matchAll(/\b([A-Z])\b/g)) addRange(label[1]);
    }
    const plainLegendGroups = [];
    // Native Nature legends also use `a) Results` and bare `a Schematic`.
    // Require a clause boundary and multiple consecutive lowercase labels;
    // inline references and statistical variables cannot create a directory.
    for (const match of text.matchAll(
      /(?:^|[.!?;|]\s*)([a-z](?:\s*[-\u2010-\u2015\u2212]\s*[a-z])?)\)?\s+(?=[A-Z0-9(])/g
    )) plainLegendGroups.push(match[1].toUpperCase());
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
    const orderedPlainLabels = [...new Set([...plainLabels, ...knownLocalPanels
      .filter(label => typeof label === 'string' && /^[A-Z]$/.test(label))])].sort();
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
    const text = normalizeText(value).slice(0, 240).replace(
      /^(?:(?:open\s+in\s+(?:a\s+)?(?:separate\s+window|new\s+tab)|download\s*:\s*|download\s+(?:high[- ]res|full[- ]size)\s+image)\s*)+/i,
      ''
    );
    // A definition starts with a whole-Figure label. Prose references, branding,
    // plural references, and compact Panel citations cannot create directory
    // entries. References keep their separate permissive public parser.
    if (/^(?:(?:supplement(?:ary|al)?|extended\s+data)\s+)?fig(?:ure)?s(?:[.\s]|$)/i.test(text) ||
        !/^(?:(?:supplement(?:ary|al)?|extended\s+data)\s+)?(?:fig(?:ure)?\.?\s*|图\s*)(?:S\s*)?\d{1,3}(?!\d|[A-Za-z])/i.test(text)) {
      return null;
    }
    return parseFigureLabel(text);
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
    // Adjacent publisher DOM nodes can lose both separators: `3Show full
    // captionFigure viewer`. Only derived titles use these control boundaries;
    // the full caption remains available as the original Panel evidence.
    const matches = [
      source.search(/(?:show|hide)\s+full\s+caption(?=\b|figure\s+viewer\b|figure360\b)/i),
      source.search(/(?:显示|隐藏)完整图注/),
      source.search(/\s*[\(（][A-Z](?:\s*[-–—,、]\s*[A-Z])?[\)）]\s*/),
      source.search(/(?:figure\s+viewer|figure360)\b/i)
    ].filter(index => index >= 0);
    return matches.length ? Math.min(...matches) : source.length;
  }

  function extractFigureTitle(value, figureLabel = '') {
    const caption = normalizeText(value);
    const parsed = parseFigureLabel(figureLabel) || parseLeadingFigureLabel(caption);
    if (!caption || !parsed) return { title: '', translatedTitle: '' };
    const figureCode = `${parsed.isSupplemental ? 'S\\s*' : ''}${parsed.figureNumber}`;
    const chineseMarker = parsed.figureSeries === 'extended-data' ? null : new RegExp(
      `(?:^|\\s)图\\s*${figureCode}(?!\\s*[A-Z])\\s*`,
      'i'
    );
    const chineseMatch = chineseMarker?.exec(caption);
    let translatedTitle = '';
    if (chineseMatch) {
      const remainder = caption.slice(chineseMatch.index + chineseMatch[0].length);
      translatedTitle = cleanFigureTitle(
        remainder.slice(0, figureTitleBoundary(remainder))
      );
      if (!/[\u3400-\u9fff]/u.test(translatedTitle)) translatedTitle = '';
    }

    const labelPattern = parsed.figureSeries === 'extended-data'
      ? new RegExp(
        `(?:^|\\s)extended\\s+data\\s+fig(?:ure)?\\.?\\s*${parsed.figureNumber}` +
        '(?![A-Z0-9])\\s*',
        'i'
      )
      : new RegExp(
        `(?:^|\\s)(?:fig(?:ure)?\\.?\\s*)${escapePattern(
          parsed.isSupplemental ? `S${parsed.figureNumber}` : String(parsed.figureNumber)
        ).replace(/^S/, 'S\\s*')}(?![A-Z0-9])\\s*`,
        'i'
      );
    const labelMatch = labelPattern.exec(caption);
    let title = '';
    if (labelMatch) {
      const remainder = caption.slice(labelMatch.index + labelMatch[0].length);
      const chineseIndex = chineseMarker?.exec(remainder)?.index ?? -1;
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
    if (isSourceUi(element)) return identities;
    const add = value => {
      const parsed = parseLeadingFigureLabel(value);
      if (parsed) identities.set(parsed.figureId, parsed);
    };
    for (const label of Array.from(
      element?.querySelectorAll?.(LABEL_SELECTOR) || []
    )) add(sourceText(label));
    for (const caption of Array.from(
      element?.querySelectorAll?.(STRUCTURAL_CAPTION_SELECTOR) || []
    )) add(sourceText(caption));
    for (const heading of Array.from(
      element?.querySelectorAll?.('h3,h4,h5,h6') || []
    )) add(sourceText(heading));
    add(element?.getAttribute?.('aria-label'));
    const hasElementChildren = Array.from(element?.childNodes || []).some(child => child.nodeType === 1);
    if (!identities.size && (!element?.tagName || element.tagName.toUpperCase() === 'FIGURE' || !hasElementChildren)) {
      add(sourceText(element));
    }
    return identities;
  }

  function ownedCaptionSource(element) {
    const resolve = shared.articleCaptionSource || globalThis.SciLLM?.articleCaptionSource;
    if (typeof resolve !== 'function') return null;
    for (const node of [element, ...Array.from(element?.querySelectorAll?.(
      'figcaption,.c-article-supplementary__title,:scope > p') || [])]) {
      const source = resolve(node);
      if (source?.element === element && source.panelScope) return source;
    }
    return null;
  }

  function structuredLegendMarkerGroup(marker, container, allowLocalParenthesis = false, allowFirstAttached = false) {
    if (isSourceUi(marker)) return '';
    // Legacy record adapters supply label records rather than DOM nodes. Their
    // explicit structured labels retain the existing contract.
    if (!marker?.parentNode || !container?.childNodes) return sourceText(marker);
    let scope = marker.parentElement;
    while (scope && scope !== container &&
        !/^(?:P|LI|DT|DD|FIGCAPTION)$/i.test(scope.tagName || '')) {
      scope = scope.parentElement;
    }
    scope ||= container;
    let before = '', after = '', found = false;
    const append = text => { if (found) after += text; else before += text; };
    const visit = node => {
      if (node === marker) { found = true; return; }
      if (node.nodeType === 3) { append(String(node.nodeValue || '')); return; }
      if (node.nodeType !== 1 || isSourceUi(node)) return;
      if (node.tagName === 'BR') { append('\n'); return; }
      for (const child of Array.from(node.childNodes || [])) visit(child);
    };
    visit(scope);
    if (!found) return '';
    let prefix = normalizeText(before.slice(before.lastIndexOf('\n') + 1));
    let markerText = sourceText(marker);
    // Some source captions include the preceding sentence stop in the bold
    // node itself ("<b>. j</b>, ..."). It remains a heading boundary.
    const leadingStop = /^\s*([.!?;:|])\s+/.exec(markerText);
    if (leadingStop) {
      prefix += leadingStop[1];
      markerText = markerText.slice(leadingStop[0].length);
    }
    // A bold inline back-reference ("recapitulating b-d were observed") is not
    // a legend heading. Otherwise that lone reference hides all plain A-F
    // headings because structured labels intentionally take precedence.
    const firstAttached = allowFirstAttached && /^figure-\d+-desc$/.test(container.id || '') &&
      container.querySelector?.('b,strong') === marker && /^\s*A\s*$/.test(markerText) &&
      /^\s+[A-Z0-9(]/.test(after);
    const atHeading = /(?:^|[.!?;:|])\s*\(?$/.test(prefix) || firstAttached;
    // Bare parenthesized, bold labels also identify local panels. They matter
    // when a publisher's heading omits a label that its own description names.
    // A cross-Figure citation, such as "Fig. 4 (<b>q</b>)", is not local.
    const sentence = prefix.replace(/\b(fig(?:ure)?s?)\./gi, '$1')
      .split(/[.!?]/).at(-1);
    const crossFigureContext = /\bfig(?:ure)?s?\s*S?\d/i.test(sentence);
    const variableContext = isCaptionVariableParenthesis(prefix + markerText + after, prefix.length - 1);
    const localParenthesis = allowLocalParenthesis && /\($/.test(prefix) &&
      !crossFigureContext && !variableContext;
    if (!atHeading && !localParenthesis) return '';
    // Publishers can split one heading over several bold nodes, e.g.
    // <b>f</b>–<b>j</b>, or <b>n</b>,<b>o</b>,. Read the complete leading
    // label group before its prose delimiter. Later nodes still fail the
    // heading-prefix check, so inline references cannot supply new labels.
    const heading = normalizeText(markerText + after);
    if (/^[PNR]\s+(?:values?|counts?|sample\s+size)\b/i.test(heading)) return '';
    const group = /^([a-z](?:\s*[-\u2010-\u2015\u2212]\s*[a-z])?(?:(?:\s*(?:,|;|&)\s*|\s+(?:and|or|to)\s+)[a-z](?:\s*[-\u2010-\u2015\u2212]\s*[a-z])?)*)(?=\s+(?!(?:and|or|to)\b)[A-Za-z0-9(])/.exec(heading) ||
      /^([A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?(?:(?:\s*(?:,|;|&)\s*|\s+(?:and|or|to)\s+)[A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?)*)(?=\s+(?!(?:and|or|to)\b)[A-Za-z0-9(])/.exec(heading) ||
      /^([A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?(?:(?:\s*(?:,|;|&)\s*|\s+(?:and|or|to)\s+)[A-Z](?:\s*[-\u2010-\u2015\u2212]\s*[A-Z])?)*)(?=\s*(?:[,:.]|\)(?:\s|[,:.]|$)))/i.exec(heading);
    if (!atHeading && !/^\s*\)/.test(heading.slice(group?.[0].length || 0))) return '';
    return group?.[1] || '';
  }

  function extractStructuredPanelHints(element) {
    const panels = new Set();
    const markers = [];
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
    const owned = ownedCaptionSource(element);
    const containers = owned ? [owned.panelScope] : Array.from(
      element?.querySelectorAll?.(STRUCTURED_PANEL_CAPTION_SELECTOR) || []);
    for (const container of containers) {
      for (const marker of Array.from(container?.querySelectorAll?.('b,strong') || [])) {
        markers.push({ marker, container });
        const group = structuredLegendMarkerGroup(marker, container, false, Boolean(owned));
        if (group) addGroup(group);
      }
    }
    // Inline local references can supplement real structured headings, but
    // cannot by themselves hide a complete set of plain-text headings.
    if (panels.size) for (const { marker, container } of markers) {
      const group = structuredLegendMarkerGroup(marker, container, true);
      if (group) addGroup(group);
    }
    return [...panels].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }));
  }

  function extractElementPanelHints(element, caption, figureReference = null) {
    const target = normalizeFigureReference(figureReference) || parseLeadingFigureLabel(caption);
    const structuredPanels = extractStructuredPanelHints(element);
    const panels = new Set(structuredPanels);
    if (!structuredPanels.length || ownedCaptionSource(element)) {
      extractPanelHints(caption, target, structuredPanels).forEach(panel => panels.add(panel));
    }
    const add = value => {
      const text = normalizeText(value).toUpperCase();
      const direct = text.match(/^(?:PANEL\s*)?([A-Z])$/i);
      if (direct) panels.add(direct[1]);
    };
    for (const node of Array.from(element?.querySelectorAll?.(PANEL_LABEL_SELECTOR) || [])) {
      if (isSourceUi(node)) continue;
      add(node?.getAttribute?.('data-panel'));
      add(node?.getAttribute?.('data-panel-label'));
      add(node?.getAttribute?.('aria-label'));
      add(sourceText(node));
    }
    for (const image of Array.from(element?.querySelectorAll?.('img,picture img') || [])) {
      if (isSourceUi(image)) continue;
      const alt = normalizeText(image?.getAttribute?.('alt'));
      for (const match of alt.matchAll(/(?<![\p{L}\p{N}\p{M}_])((?:extended\s+data\s+)?fig(?:ure)?\.?\s*(?:S\s*)?\d{1,3})\s*([A-Z])(?![\p{L}\p{N}\p{M}_])/giu)) {
        if (sameFigureIdentity(parseFigureLabel(match[1]), target)) panels.add(match[2].toUpperCase());
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
    const caption = normalizePanelCaption(value);
    if (!caption) return [];
    const hasCaptionIdentity = Boolean(parseLeadingFigureLabel(caption));
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
      if (!isLocalPanelParenthesis(caption, match.index, hasCaptionIdentity) || /^[ivx]+$/.test(match[1])) continue;
      addMarker(match.index, match[0].length, match[1]);
    }
    const inline = new RegExp(
      `(^|[.;]\\s*)(${groupPattern})(\\s*[,;:]\\s*)`,
      'gi'
    );
    for (const match of caption.matchAll(inline)) {
      const prefixLength = match[1]?.length || 0;
      if (/^[A-Z]$/.test(match[2]) && /\b[A-Z]\.\s*$/.test(caption.slice(0, (match.index || 0) + prefixLength))) continue;
      addMarker(
        (match.index || 0) + prefixLength,
        match[2].length + match[3].length,
        match[2]
      );
    }
    // Bare lowercase headings may group labels before the prose, as in
    // `a, b Coordinate locations` followed by `c schematic`. Keep the whole
    // group so the shorter comma-delimited candidate cannot absorb Panel C.
    const plainGroupPattern = groupPattern.replaceAll('[A-Z]', '[a-z]');
    const plain = new RegExp(
      `(^|[.!?;|]\\s*)(${plainGroupPattern})(\\)?\\s+)(?!(?:and|or|to)\\b)(?=[A-Za-z0-9(])`,
      'g'
    );
    const plainMarkers = [...caption.matchAll(plain)].filter(match => {
      const start = (match.index || 0) + match[1].length;
      if (!isLocalPanelParenthesis(caption, start, hasCaptionIdentity)) return false;
      // A lowercase statistical p-value clause is prose, not a Panel heading.
      return !(/^p$/.test(match[2]) && /^\s+values?\b/i.test(caption.slice(start + match[2].length)));
    });
    const plainLabels = [...new Set(plainMarkers.flatMap(match => expandCaptionPanelGroup(match[2])))].sort();
    if (plainLabels.length >= 2 && plainLabels.some((label, index) =>
      index > 0 && label.charCodeAt(0) - plainLabels[index - 1].charCodeAt(0) === 1)) {
      for (const match of plainMarkers) addMarker((match.index || 0) + match[1].length,
        match[2].length + match[3].length, match[2]);
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
    const documents = [...new Set(figures.map(f => f?.element?.ownerDocument).filter(Boolean))];
    const nativeTiffs = shared.discoverNativeTiffFigures || globalThis.SciLLM?.discoverNativeTiffFigures;
    if (typeof nativeTiffs === 'function' && documents.some(doc => nativeTiffs(doc).some(source => !figures.some(f => f.figureId === source.figureId)))) return true;
    const resolveSharedCaption = shared.articleCaptionSource ||
      (typeof globalThis === 'undefined' ? null : globalThis.SciLLM?.articleCaptionSource);
    return figures.some(figure => {
      if (figure?.element &&
          figure.panelDirectoryVersion !== FIGURE_PANEL_DIRECTORY_VERSION) return true;
      if (figure?.element?.isConnected === false ||
          figure?.captionElement?.isConnected === false ||
          isSourceUi(figure?.element) || isSourceUi(figure?.captionElement)) return true;
      if(figure?.nativeTiffSource) {
        const doc=figure.element?.ownerDocument;
        const live=(shared.discoverNativeTiffFigures || globalThis.SciLLM?.discoverNativeTiffFigures)?.(doc)?.find(f=>f.element===figure.element&&f.figureId===figure.figureId);
        return !live || live.caption!==figure.caption || live.sourceUrl!==figure.nativeTiffSource.sourceUrl;
      }
      const nativeCaption = typeof resolveSharedCaption === 'function'
        ? resolveSharedCaption(figure?.captionElement) : null;
      const liveCaption = normalizeText(
        nativeCaption?.text || sourceText(figure?.captionElement) ||
        figure?.element?.getAttribute?.('aria-label') ||
        sourceText(figure?.element)
      );
      if (liveCaption && liveCaption !== normalizeText(figure?.caption)) return true;
      return Boolean(nativeCaption?.panelScope && nativeCaption.element === figure?.element &&
        JSON.stringify(figure.panelHints || []) !==
          JSON.stringify(extractElementPanelHints(figure.element, liveCaption, figure)));
    });
  }

  function resolveCaptionSource(element, expectedIdentity = null) {
    const expectedFigureId = expectedIdentity?.figureId || '';
    const candidates = [];
    const add = candidate => {
      if (candidate && !isSourceUi(candidate) && !candidates.includes(candidate)) candidates.push(candidate);
    };
    add(element?.querySelector?.(CAPTION_SELECTOR));
    for (const candidate of Array.from(
      element?.querySelectorAll?.(CAPTION_SELECTOR) || []
    )) add(candidate);
    add(element);
    let best = null;
    for (const candidate of candidates) {
      const caption = normalizeText(
        sourceText(candidate) || candidate?.getAttribute?.('aria-label')
      );
      if (!caption) continue;
      const leadingIdentity = parseLeadingFigureLabel(caption);
      if (expectedFigureId && leadingIdentity &&
          leadingIdentity.figureId !== expectedFigureId) continue;
      const panelCount = extractPanelHints(caption, leadingIdentity || expectedIdentity).length;
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
      image?.getAttribute?.('data-supp-info-image') ||
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

  function hasOwnedFigureViewerLink(image, candidate, figureReference, caption) {
    // A small raster is a discovery clue only when its native caption owner
    // and same-article viewer agree. It remains below the useful-pixel floor.
    if (!figureReference || figureReference.figureSeries !== 'main' ||
        !candidate?.contains?.(image) || image?.closest?.(FIGURE_SELECTOR) !== candidate) return false;
    const width = imageDimension(image, 'width');
    const height = imageDimension(image, 'height');
    if (width < 96 || height < 72) return false;
    const signals = ['src', 'alt', 'title', 'class', 'aria-label']
      .map(name => image?.getAttribute?.(name) || '').join(' ');
    if (/\b(?:icon|logo|avatar|spinner|placeholder|tracking)\b/i.test(signals) ||
        /^data:image\/svg/i.test(imageSource(image))) return false;
    const captionIdentity = parseLeadingFigureLabel(caption);
    if (!sameFigureIdentity(captionIdentity, figureReference)) return false;
    const anchor = image?.closest?.('a[href]');
    if (!anchor || !candidate.contains(anchor)) return false;
    for (const label of [image?.getAttribute?.('alt'), image?.getAttribute?.('title'), image?.getAttribute?.('aria-label'),
      anchor.textContent, anchor?.getAttribute?.('title'), anchor?.getAttribute?.('aria-label')]) {
      const identity = parseFigureLabel(label);
      if (identity && !sameFigureIdentity(identity, figureReference)) return false;
    }
    try {
      const ownerDocument = image.ownerDocument;
      const page = new URL(ownerDocument?.location?.href || ownerDocument?.URL || ownerDocument?.baseURI || '');
      const viewer = new URL(anchor.getAttribute('href'), page.href);
      if (!/^https?:$/.test(page.protocol) || viewer.origin !== page.origin ||
          viewer.username || viewer.password || viewer.search) return false;
      const match = viewer.pathname.match(/^(.*)\/figures?\/(\d{1,3})\/?$/i);
      return Boolean(match && match[1] === page.pathname.replace(/\/$/, '') &&
        Number(match[2]) === figureReference.figureNumber);
    } catch (_) { return false; }
  }

  function collectImages(candidate, figureReference = null, caption = '') {
    const seen = new Set();
    const images = [];
    for (const image of Array.from(candidate?.querySelectorAll?.(
      'img,picture img,[data-supp-info-image]'
    ) || [])) {
      if (isSourceUi(image)) continue;
      const imageIdentity = parseFigureLabel(image?.getAttribute?.('alt'));
      if (imageIdentity && figureReference && !sameFigureIdentity(imageIdentity, figureReference)) continue;
      const source = imageSource(image);
      if ((!isUsefulFigureImage(image) && !hasOwnedFigureViewerLink(image, candidate, figureReference, caption)) ||
          !source || seen.has(source)) continue;
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
    if (target.figureSeries === 'extended-data') {
      const extendedPattern = /\bextended\s+data\s+fig(?:ure)?s?\.?\s*/gi;
      let extendedMatch;
      while ((extendedMatch = extendedPattern.exec(text))) {
        const remainder = text.slice(extendedPattern.lastIndex);
        const sequenceMatch = remainder.match(
          /^\s*\d{1,3}[A-Za-z]?(?:(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|to)\s+|\s*&\s*|\s*[-\u2013\u2014]\s*)(?:\d{1,3}[A-Za-z]?|[A-Za-z]))*/i
        );
        if (!sequenceMatch) continue;
        const numbers = Array.from(
          sequenceMatch[0].matchAll(/\b(\d{1,3})[A-Za-z]?\b/g),
          match => Number(match[1])
        );
        if (numbers.includes(target.figureNumber)) return true;
      }
      return false;
    }
    const prefixPattern = /(?:\bfig(?:ure)?s?\.?|\u56fe)\s*/gi;
    let prefixMatch;
    while ((prefixMatch = prefixPattern.exec(text))) {
      const prefixContext = text.slice(Math.max(0, prefixMatch.index - 24), prefixMatch.index);
      if (/extended\s+data\s*$/i.test(prefixContext)) continue;
      const spelledSupplemental = /supplement(?:ary|al)?\s*$/i.test(prefixContext);
      const remainder = text.slice(prefixPattern.lastIndex);
      const sequenceMatch = remainder.match(
        /^\s*S?\s*\d{1,3}[A-Za-z]?(?:(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|to)\s+|\s*&\s*|\s*[-\u2013\u2014]\s*|\s*[\u3001\u548c]\s*)(?:S?\s*\d{1,3}[A-Za-z]?|[A-Za-z]))*/i
      );
      if (!sequenceMatch) continue;
      const referencedFigures = Array.from(sequenceMatch[0].matchAll(/\b(S)?\s*(\d{1,3})[A-Za-z]?\b/gi), match => ({
        isSupplemental: Boolean(match[1]) || spelledSupplemental,
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
    // Preserve the selected source here. The Figure prompt budget owns the
    // 4000-character windows / 16000-character total and reports omissions;
    // clipping before that stage makes incomplete evidence appear complete.
    return (Array.isArray(paragraphs) ? paragraphs : [])
      .filter(item => !item || typeof item !== 'object' ||
        !Object.hasOwn(item, 'recordType') || item.recordType === 'body')
      .filter(item => paragraphReferencesFigure(item?.text, figureReference))
      .map(item => ({
        paragraphId: String(item?.paragraphId || '').slice(0, 120),
        sectionTitle: normalizeText(item?.sectionTitle).slice(0, 240),
        text: normalizeText(item?.text)
      }));
  }

  function rebindFigureContextLocators(boundParagraphs, liveParagraphs) {
    if (!Array.isArray(boundParagraphs) || !Array.isArray(liveParagraphs) ||
        boundParagraphs.length !== liveParagraphs.length || boundParagraphs.length > 256) return null;
    const valid = row => row && typeof row === 'object' &&
      Object.keys(row).every(key => ['paragraphId', 'sectionTitle', 'text'].includes(key)) &&
      typeof row.paragraphId === 'string' && row.paragraphId.length > 0 && row.paragraphId.length <= 120 &&
      typeof row.sectionTitle === 'string' && typeof row.text === 'string' && row.text.length > 0;
    if (![...boundParagraphs, ...liveParagraphs].every(valid)) return null;
    const identity = row => JSON.stringify([row.sectionTitle, row.text]);
    for (const rows of [boundParagraphs, liveParagraphs]) {
      if (new Set(rows.map(row => row.paragraphId)).size !== rows.length ||
          new Set(rows.map(identity)).size !== rows.length) return null;
    }
    if (boundParagraphs.some((row, index) => identity(row) !== identity(liveParagraphs[index]))) return null;
    // Keep request evidence IDs intact. The caller must revalidate the live
    // locator against the complete exact source text before navigating to it.
    return {
      paragraphs: boundParagraphs.map(row => ({ ...row })),
      locators: boundParagraphs.map((row, index) => ({
        paragraphId: row.paragraphId, liveParagraphId: liveParagraphs[index].paragraphId
      }))
    };
  }

  function extractArticleFiguresFromRecords(documentLike, records, options = {}) {
    const byId = new Map();
    const candidates = [];
    const candidateElements = new Set();
    const captionSources = shared.collectArticleCaptionSources ||
      (typeof globalThis === 'undefined' ? null : globalThis.SciLLM?.collectArticleCaptionSources);
    const nativeSources = typeof captionSources === 'function' ? captionSources(documentLike) : [];
    const nativeOwners = new Map(nativeSources.map(source => [source.element, source]));
    const appendCandidate = (
      element,
      captionElement = null,
      expectedIdentity = null,
      captionOverride = ''
    ) => {
      if (!element || isSourceUi(element) || isSourceUi(captionElement) || candidateElements.has(element)) return;
      if (nativeSources.some(source => source.element !== element && source.element.contains?.(element))) return;
      candidateElements.add(element);
      candidates.push({ element, captionElement, expectedIdentity, captionOverride });
    };
    nativeSources.forEach(source => appendCandidate(source.element, source.titleElement,
      parseLeadingFigureLabel(source.text), source.text));
    Array.from(documentLike?.querySelectorAll?.(FIGURE_SELECTOR) || [])
      .forEach(element => appendCandidate(element));
    for (const captionElement of Array.from(
      documentLike?.querySelectorAll?.(STANDALONE_CAPTION_SELECTOR) || []
    )) {
      if (isSourceUi(captionElement)) continue;
      const caption = normalizeText(
        sourceText(captionElement) || captionElement?.getAttribute?.('aria-label')
      );
      if (!parseLeadingFigureLabel(caption)) continue;
      const existingFigure = captionElement?.closest?.(FIGURE_SELECTOR);
      if (existingFigure && candidateElements.has(existingFigure)) continue;
      const parent = captionElement?.parentElement;
      const hasOtherDefinitions = Array.from(parent?.querySelectorAll?.(STANDALONE_CAPTION_SELECTOR) || [])
        .some(other => other !== captionElement && parseLeadingFigureLabel(sourceText(other)));
      const owner = existingFigure ||
        captionElement?.closest?.(ACCORDION_FIGURE_SELECTOR) ||
        (!hasOtherDefinitions && parent) || captionElement;
      appendCandidate(owner, captionElement);
    }
    for (const section of Array.from(
      documentLike?.querySelectorAll?.(NATURE_ARTICLE_SECTION_SELECTOR) || []
    )) {
      const nestedItems = Array.from(
        section?.querySelectorAll?.(NATURE_SUPPLEMENTARY_ITEM_SELECTOR) || []
      );
      const scopes = nestedItems.length ? nestedItems : [section];
      for (const scope of scopes) {
        const nested = scope !== section;
        const titleElement = scope?.querySelector?.(
          nested ? NATURE_SUPPLEMENTARY_TITLE_SELECTOR : NATURE_SECTION_TITLE_SELECTOR
        );
        const identity = parseLeadingFigureLabel(sourceText(titleElement));
        if (identity?.figureSeries !== 'extended-data') continue;
        const contentElement = scope?.querySelector?.(
          nested ? NATURE_SUPPLEMENTARY_DESCRIPTION_SELECTOR : NATURE_SECTION_CONTENT_SELECTOR
        );
        const caption = normalizeText([
          sourceText(titleElement),
          sourceText(contentElement)
        ].filter(Boolean).join(' '));
        if (!caption) continue;
        appendCandidate(
          scope,
          contentElement || titleElement || scope,
          identity,
          caption
        );
      }
    }
    for (const [documentOrder, candidate] of candidates.entries()) {
      const {
        element,
        captionElement: standaloneCaption,
        expectedIdentity: candidateIdentity,
        captionOverride
      } = candidate;
      if (element?.closest?.(EXCLUDED_ANCESTOR_SELECTOR)) continue;
      // Supported split native owners must pass the shared source resolver.
      // An invalid owner cannot re-enter through its nested generic figure.
      const hostname = String(documentLike?.location?.hostname || '');
      const springerOwner = /^link\.springer\.com$/i.test(hostname) ? element.closest?.('figure') : null;
      const splitSpringerOwner = springerOwner?.querySelector?.(
        '.c-article-section__figure-description,[aria-describedby^="figure-"][aria-describedby$="-desc"]')
        ? springerOwner : null;
      const splitOwner = /(^|\.)frontiersin\.org$/i.test(hostname)
        ? element.closest?.('.ArticleFigure')
        : /(^|\.)journals\.plos\.org$/i.test(hostname)
        ? element.closest?.('#artText .figure')
        : /(^|\.)jci\.org$/i.test(hostname) ? element.closest?.('.figure')
        : splitSpringerOwner;
      if (splitOwner && !nativeOwners.has(splitOwner)) continue;
      const standaloneIdentity = standaloneCaption && parseLeadingFigureLabel(
        sourceText(standaloneCaption) || standaloneCaption?.getAttribute?.('aria-label')
      );
      const identities = candidateIdentity
        ? new Map([[candidateIdentity.figureId, candidateIdentity]])
        : standaloneIdentity
        ? new Map([[standaloneIdentity.figureId, standaloneIdentity]])
        : collectFigureIdentities(element);
      if (identities.size > 1) continue;
      const expectedIdentity = identities.values().next().value || null;
      if (!expectedIdentity) continue;
      let captionSource = captionOverride
        ? { element: standaloneCaption || element, caption: captionOverride }
        : resolveCaptionSource(element, expectedIdentity);
      if (standaloneCaption && !captionSource.caption) {
        captionSource = {
          element: standaloneCaption,
          caption: normalizeText(
            sourceText(standaloneCaption) || standaloneCaption?.getAttribute?.('aria-label')
          )
        };
      }
      const captionElement = captionSource.element || element;
      const caption = captionSource.caption;
      const labelText = normalizeText(
        sourceText(captionElement?.querySelector?.(LABEL_SELECTOR))
      );
      const parsed = expectedIdentity || parseLeadingFigureLabel(labelText) || parseLeadingFigureLabel(caption) ||
        parseLeadingFigureLabel(sourceText(element));
      if (!parsed) continue;
      const imageElements = collectImages(element, parsed, caption);
      const item = {
        ...parsed,
        caption,
        captionElement: captionElement || element,
        imageElements,
        panelHints: extractElementPanelHints(element, caption, parsed),
        panelDirectoryVersion: FIGURE_PANEL_DIRECTORY_VERSION,
        contextParagraphs: relatedParagraphs(records, parsed),
        documentOrder,
        element
      };
      const score = caption.length + imageElements.length * 500;
      const previous = byId.get(item.figureId);
      if (!previous || score > previous.score) byId.set(item.figureId, { score, item });
    }
    const nativeTiffs=(shared.discoverNativeTiffFigures || globalThis.SciLLM?.discoverNativeTiffFigures)?.(documentLike) || [];
    for(const source of nativeTiffs) {
      const parsed=parseLeadingFigureLabel(source.figureLabel);
      if (!parsed || parsed.figureId !== source.figureId) continue;
      const nativeTiffSource={sourceUrl:source.sourceUrl,materialId:source.materialId,
        doi:source.doi,documentUrl:source.documentUrl};
      const previous=byId.get(source.figureId);
      if (previous) {
        // A typed caption may already own this same supplement. Bind its
        // native asset only to that exact owner and material, never by ID alone.
        const item=previous.item, captionOwner=nativeOwners.get(source.element);
        const materialMarker=String(source.materialId || '').replace('10.1371/journal.','');
        if (item.element !== source.element || item.figureId !== parsed.figureId ||
            item.caption !== source.caption || !captionOwner ||
            captionOwner.text !== source.caption || captionOwner.panelScope !== source.captionElement ||
            captionOwner.sourceIdentity !== materialMarker ||
            (source.publisher === 'frontiers' ? source.element?.id !== 'SF'+parsed.figureNumber
              : source.element?.querySelector?.('a.link-target[id]')?.id !== materialMarker)) continue;
        Object.assign(item,{captionElement:source.captionElement,
          sourceKind:'publisher-tiff-supplement',isSupplemental:true,nativeTiffSource});
        continue;
      }
      const item={...parsed,caption:source.caption,element:source.element,captionElement:source.captionElement,
        imageElements:[],sourceKind:'publisher-tiff-supplement',isSupplemental:true,
        nativeTiffSource,
        panelHints:extractPanelHints(source.caption,parsed),panelDirectoryVersion:FIGURE_PANEL_DIRECTORY_VERSION,
        contextParagraphs:relatedParagraphs(records,parsed),documentOrder:candidates.length+byId.size};
      byId.set(source.figureId,{score:source.caption.length,item});
    }
    return [...byId.values()]
      .map(entry => entry.item)
      .sort((left, right) => left.documentOrder - right.documentOrder);
  }

  function extractArticleFigures(documentLike, paragraphs) {
    if (arguments.length >= 2) {
      return extractArticleFiguresFromRecords(documentLike, paragraphs);
    }
    // Figure extraction is also loaded on its own by the popup. Resolve the
    // article extractor only when this legacy convenience call needs it.
    const dynamicShared = typeof globalThis === 'undefined' ? null : globalThis.SciLLM;
    const extractTypedRecords = shared.extractArticle || dynamicShared?.extractArticle;
    const records = typeof extractTypedRecords === 'function'
      ? extractTypedRecords(documentLike, { includeTyped: true })
      : [];
    return extractArticleFiguresFromRecords(documentLike, records);
  }

  return {
    FIGURE_PANEL_DIRECTORY_VERSION,
    FIGURE_SELECTOR,
    CAPTION_SELECTOR,
    STANDALONE_CAPTION_SELECTOR,
    parseFigureLabel,
    extractFigureTitle,
    extractPanelHints,
    expandCaptionPanelGroup,
    splitFigureCaptionByPanelGroups,
    extractStructuredPanelHints,
    extractElementPanelHints,
    figureInventoryNeedsRefresh,
    isUsefulFigureImage,
    rebindFigureContextLocators,
    extractArticleFiguresFromRecords,
    extractArticleFigures
  };
});
