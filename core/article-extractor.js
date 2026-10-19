(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const REFERENCE_SECTION = /^(references|bibliography|literature cited)\b/i;
  const EXCLUDED_SECTION = /^(?:references|bibliography|literature cited|keywords?|abbreviations?|acknowledg(?:e)?ments?|author information|information\s*&\s*authors|authors?(?:['’]s?)?\s+contributions?|credit authorship contribution statement|generative ai statement|declaration of ai use|funding|conflicts? of interest|competing interests?|declaration of competing interest|declaration of interests?|data availability|data and code availability|supplementary materials?|supplementary data|appendix\b.*supplementary data|footnotes?|ethics approval|institutional review board statement|informed consent statement|publisher['’]s note|disclosure statement)\b/i;
  const NAVIGABLE_ARTICLE_SECTION = /^(?:main|highlights?|summary|abstract|graphical abstract|keywords?|introduction|background|materials? and methods?|methods?|methodology|experimental procedures?|star\s*[★*]?\s*methods?|results?|findings?|discussion|conclusions?|concluding remarks?|limitations?|strengths? and limitations?|resource availability|data(?: and code)? availability(?: statement)?|code availability|references|bibliography|literature cited|appendix|extended data(?: figures?|tables?)?|supplement(?:al|ary)(?: information| materials?| data| figures?| tables?)?|acknowledg(?:e)?ments?|author information|information\s*&\s*authors|authors?(?:['’]s?)?\s+contributions?|credit authorship contribution statement|funding|conflicts? of interest(?: declaration)?|competing interests?|declaration of (?:competing )?interests?|ethics approval|institutional review board statement|informed consent statement|footnotes?)\b/i;
  const CONTENT_ROOT_SELECTOR = [
    'article', 'main', '[role="main"]', '#body', '#article-body', '.Body',
    '.article-body', '[data-testid="article-body"]', '[data-article-body]'
  ].join(',');
  const SEMANTIC_HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
  const SUPPLEMENTAL_HEADING_SELECTOR = '.section-title,.section__title,.article-section-title';
  const CONTENT_BLOCK_SELECTOR =
    `${SEMANTIC_HEADING_SELECTOR},${SUPPLEMENTAL_HEADING_SELECTOR},p,li,caption,[role="paragraph"]`;
  const STRUCTURAL_TEXT_SELECTOR = `${CONTENT_BLOCK_SELECTOR},figcaption`;
  const PRIMARY_CONTENT_TAGS = new Set(['P', 'LI', 'CAPTION']);
  const EXTRACTOR_VERSION = '2.1.0-extractor-r18';
  const UNRECOGNIZED_BLOCK_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'DD']);
  const SOURCE_UI_SELECTOR = '[data-sci-plugin-ui],[data-sci-translation]';
  const INJECTED_TRANSLATION_SELECTOR = [
    '.immersive-translate-target-wrapper',
    '[class*="immersive-translate-target-translation" i]',
    '[data-immersive-translate-translation-element-mark]'
  ].join(',');
  const EXCLUDED_ANCESTOR_SELECTOR =
    'nav,aside,footer,form,figure,[hidden],[aria-hidden="true"],' +
    '.citation,.citation-content,.advertisement,.related-articles,' +
    '.recommended,.comments,.social-share,.article-outline,.outline-panel,.table-of-contents,' +
    '.article-tools,.article-header-actions,.app-nls-widget,[data-test="nls-component"],' +
    `${SOURCE_UI_SELECTOR},${INJECTED_TRANSLATION_SELECTOR},` +
    '[role="tooltip"],[data-aa-name*="citation" i],' +
    '[class*="citation" i],[class*="cite-preview" i],[class*="ref-preview" i],' +
    '[class*="reference-preview" i],[class*="reference-popover" i],' +
    '[class*="reference-tooltip" i],[class*="tooltip" i],[class*="popover" i],' +
    '[class*="related-content" i],[class*="recommendation" i]';

  const REVIEW_UTILITY_SECTION = /^(?:article|outline|table of contents|tables?(?:\s+(?:\(\d+\)|\d+)(?:\..*)?)?|fig(?:ure)?s?(?:\s+(?:\(\d+\)|\d+)(?:\b.*)?)?|extras?(?:\s*\(\d+\))?|keywords?|graphical abstract|highlights?|recommended articles?|related info links?|related content|similar content(?:\s+being viewed by others)?|you may also like|recommended for you|cited by(?:\s*\(\d+\))?|article metrics?|author information|information\s*&\s*authors|information|info|accessibility(?:\s*&\s*keyboard shortcuts)?|metrics\s*&\s*citations|view options|publication history|license summary\*?|subjects|article views|altmetric|citations|media|share|download(?:s| files?|\s+options)?|transcript|show full outline|skip to\b.*)$/i;
  const SCOPED_UTILITY_SECTION = /^(?:recommended articles?|related content|similar content(?:\s+being viewed by others)?|you may also like|recommended for you)$/i;
  const REVIEW_UTILITY_TEXT = /^(?:show more|view pdf|view in article|download full issue|add to mendeley|share|cite|get rights and content|open access|no articles found\.?)$/i;
  const REVIEW_UTILITY_PARAGRAPH = /^(?:you (?:do not|don't) have access\b.*|this (?:article|content) is (?:only )?available\b.*|access (?:this|to this) (?:article|content)\b.*|sign in (?:to|through)\b.*(?:access|institution)|log in (?:to|through)\b.*(?:access|institution)|institutional (?:access|subscription)\b.*|(?:该|此)(?:文章|内容|全文).*(?:仅|只|需要).*(?:访问|订阅|登录)|.*(?:通过|经由).*(?:机构|大学).*(?:访问|阅读全文).*)$/i;
  const OUTLINE_LINK_SELECTOR = [
    'nav a[href^="#"]', 'aside a[href^="#"]',
    '[class*="outline" i] a[href*="#"]', '[id*="outline" i] a[href*="#"]',
    '[data-aa-name*="outline" i] a[href*="#"]',
    '[aria-label*="outline" i] a[href*="#"]'
  ].join(',');
  const CHALLENGE_PAGE_TEXT = /(?:are you a robot|confirm you are a human|captcha|checking your browser|security verification|正在进行安全验证|检查您的浏览器|请稍候|cloudflare)/i;
  const EPHEMERAL_HEADING_TEXT = /^(?:skip to\b|figure\s*\d+\b|table\s*\d+\b|sign up for\b)/i;

  function slugifyHeading(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'article';
  }

  function isExcludedSectionHeading(text) {
    const title = String(text || '').trim();
    return EXCLUDED_SECTION.test(title) && !NAVIGABLE_ARTICLE_SECTION.test(title);
  }

  function isNavigableArticleSectionHeading(text) {
    return NAVIGABLE_ARTICLE_SECTION.test(String(text || '').trim());
  }

  function isLikelyNonArticleChallenge(documentRef) {
    const title = String(documentRef?.title || '');
    const bodyText = String(
      documentRef?.body?.innerText || documentRef?.body?.textContent || ''
    ).replace(/\s+/g, ' ').trim();
    if (bodyText.length > 2500) return false;
    if (/(?:access denied|problem providing the content you requested|recaptcha)/i
      .test(`${title}\n${bodyText}`)) return true;
    return CHALLENGE_PAGE_TEXT.test(`${title}\n${bodyText}`);
  }

  function classifyMajorSectionHeading(value) {
    const text = String(value || '').trim()
      .replace(/^\s*(?:\d+(?:\.\d+)*|[IVXLC]+)[\s.):\-]+/i, '')
      .toLowerCase();
    if (/^(?:abstract|summary|highlights?|graphical abstract)\b/.test(text)) return 'abstract';
    if (/^main\b/.test(text)) return 'main';
    if (/^(?:introduction|background)\b/.test(text)) return 'introduction';
    if (/^(?:materials? and methods?|methods?|methodology|experimental procedures?|star\s*[★*]?\s*methods?)\b/.test(text)) {
      return 'methods';
    }
    if (/^(?:results?|findings?)\b/.test(text)) return 'results';
    if (/^(?:discussion)\b/.test(text)) return 'discussion';
    if (/^(?:conclusions?|concluding remarks?)\b/.test(text)) return 'conclusion';
    if (/^(?:limitations?|strengths? and limitations?)\b/.test(text)) return 'discussion';
    if (REFERENCE_SECTION.test(text)) return 'reference';
    if (/^appendix\b/.test(text)) return 'appendix';
    if (/^extended data\b/.test(text)) return 'extended-data';
    if (/^supplement(?:al|ary)\b/.test(text)) return 'supplementary';
    if (/^acknowledg(?:e)?ments?\b/.test(text)) return 'acknowledgements';
    if (/^(?:author information|information\s*&\s*authors|authors?(?:['’]s?)?\s+contributions?|credit authorship contribution statement)\b/.test(text)) {
      return 'author-information';
    }
    if (/^(?:resource availability|data(?: and code)? availability|code availability)\b/.test(text)) {
      return 'availability';
    }
    if (/^(?:funding|conflicts? of interest|competing interests?|declaration of (?:competing )?interests?|ethics approval|institutional review board statement|informed consent statement|footnotes?)\b/.test(text)) {
      return 'metadata';
    }
    if (/^keywords?\b/.test(text)) return 'front-matter';
    return '';
  }

  function classTokens(element) {
    return typeof element?.className === 'string'
      ? element.className.trim().split(/\s+/).filter(Boolean) : [];
  }

  function isHeadingElement(element) {
    if (!element) return false;
    if (/^H[1-6]$/.test(String(element.tagName || '').toUpperCase())) return true;
    if (String(element.getAttribute?.('role') || '').toLowerCase() === 'heading') return true;
    const supplemental = classTokens(element).some(token =>
      ['section-title', 'section__title', 'article-section-title'].includes(token));
    if (!supplemental) return false;
    return !element.querySelector?.(SEMANTIC_HEADING_SELECTOR);
  }

  function isEphemeralHeadingTitle(value) {
    return EPHEMERAL_HEADING_TEXT.test(
      String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
    );
  }

  function getHeadingLevel(element) {
    const tagName = String(element?.tagName || '').toUpperCase();
    if (/^H[1-6]$/.test(tagName)) return Number(tagName.slice(1));
    const ariaLevel = Number(element?.getAttribute?.('aria-level'));
    return Number.isInteger(ariaLevel) && ariaLevel >= 1 && ariaLevel <= 6
      ? ariaLevel : 2;
  }

  function isReviewUtilitySectionTitle(value) {
    const text = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    if (isNavigableArticleSectionHeading(text)) return false;
    if (/^cite$/i.test(text) || REVIEW_UTILITY_TEXT.test(text)) return true;
    if (REFERENCE_SECTION.test(text) || EXCLUDED_SECTION.test(text)) return true;
    if (REVIEW_UTILITY_SECTION.test(text)) return true;
    return /^(?:review|research|original|clinical)\s*article$/i.test(text) ||
      (/^(?:review|research|original|clinical)\s*article/i.test(text) &&
        text.length > 20);
  }

  function isReviewUtilityParagraphText(value) {
    const text = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    return Boolean(text) && (
      REVIEW_UTILITY_TEXT.test(text) ||
      REVIEW_UTILITY_PARAGRAPH.test(text)
    );
  }

  function isSupplementalMediaParagraphText(value) {
    const text = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    if (/^(?:video|movie)\s*\([^)]*\b(?:kb|mb|gb)\b[^)]*\)\s*$/i.test(text)) {
      return true;
    }
    if (/^(?:video|movie)\s+(?:s|supplement(?:al|ary)\s*)?\d+[a-z]?(?:\s*[.:\-–—]|\b)/i
      .test(text)) {
      return true;
    }
    return /^(?:this|the)\s+(?:supplement(?:al|ary)\s+)?(?:video|movie)\s+(?:shows?|demonstrates?|illustrates?|depicts?|presents?|documents?|provides?)\b/i
      .test(text);
  }

  function isLikelyInlineReferenceFlyoutText(value) {
    const text = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (text.length < 28 || text.length > 1600) return false;
    const numberedAuthor = text.match(
      /^(\d{1,4})\s*[.)]?\s*([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’\-]{1,48})\s*,\s*([A-Z](?:\.[A-Z]?)?)/u
    );
    if (!numberedAuthor) return false;
    const authorSignals = (text.match(
      /(?:\s[·•]\s|\bet\s+al\.|[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’\-]{1,48}\s*,\s*[A-Z]\.)/gu
    ) || []).length;
    const publicationSignals = (text.match(
      /\b(?:doi|vol(?:ume)?|journal|cell|nature|science|press|20\d{2}|19\d{2})\b/gi
    ) || []).length;
    return authorSignals >= 2 || publicationSignals >= 1 ||
      (/^\d{1,4}\./.test(text) && text.length >= 55);
  }

  function normalizeTextWithOffsets(value) {
    const raw = String(value || '');
    const output = [];
    const rawStarts = [];
    const rawEnds = [];
    let whitespaceStart = -1;
    let whitespaceEnd = -1;

    for (let index = 0; index < raw.length; index += 1) {
      const character = raw[index];
      if (/\s/.test(character)) {
        if (output.length && whitespaceStart < 0) whitespaceStart = index;
        if (whitespaceStart >= 0) whitespaceEnd = index + 1;
        continue;
      }
      if (whitespaceStart >= 0) {
        output.push(' ');
        rawStarts.push(whitespaceStart);
        rawEnds.push(whitespaceEnd);
        whitespaceStart = -1;
        whitespaceEnd = -1;
      }
      output.push(character);
      rawStarts.push(index);
      rawEnds.push(index + 1);
    }

    return { text: output.join(''), rawStarts, rawEnds };
  }

  let sourceReadCache = null;

  function withSourceReadCache(read) {
    const previous = sourceReadCache;
    // Extraction is synchronous. These weak maps live for this read only;
    // edits, translation changes and subsequent extractions always reread DOM.
    sourceReadCache = { text: new WeakMap(), canonical: new WeakMap(), excluded: new WeakMap(), ancestors: new WeakMap() };
    try { return read(); }
    finally { sourceReadCache = previous; }
  }

  function isScientificInlineTextExcluded(node) {
    if (node?.nodeType === 8) return true;
    const element = node?.nodeType === 3 ? node.parentElement : node;
    if (element && sourceReadCache?.excluded.has(element)) return sourceReadCache.excluded.get(element);
    // Cell embeds bibliography flyouts inside body paragraphs. Keep the
    // reference-citations wrapper and author/year control; only omit details.
    // Do not reuse EXCLUDED_ANCESTOR_SELECTOR here: its broad citation match
    // would also discard the visible inline reference and independent entries.
    const selector = `${SOURCE_UI_SELECTOR},${INJECTED_TRANSLATION_SELECTOR},` +
      '.reference-citations .dropBlock__holder,.reference-citations .citation,' +
      '.reference-citations .citation-content';
    const excluded = Boolean(element?.closest?.(selector) || element?.matches?.(selector));
    if (element) sourceReadCache?.excluded.set(element, excluded);
    return excluded;
  }

  function scientificInlineText(element) {
    if (!element) return '';
    if (sourceReadCache?.text.has(element)) return sourceReadCache.text.get(element);
    const visit = node => {
      if (!node) return '';
      if (isScientificInlineTextExcluded(node)) return '';
      if (node.nodeType === 3) return String(node.nodeValue || '');
      const tagName = String(node.tagName || '').toUpperCase();
      const childNodes = [...(node.childNodes || [])];
      const content = childNodes.length
        ? childNodes.map(visit).join('')
        : String(node.textContent || '');
      if (tagName === 'SUP' || tagName === 'SUB') {
        const normalized = content.replace(/\s+/g, ' ').trim();
        return normalized ? `<${tagName.toLowerCase()}>${normalized}</${tagName.toLowerCase()}>` : '';
      }
      if (tagName === 'BR') return ' ';
      return content;
    };
    const text = visit(element).replace(/\s+/g, ' ').trim();
    sourceReadCache?.text.set(element, text);
    return text;
  }

  function canonicalContentText(element) {
    if (element && sourceReadCache?.canonical.has(element)) return sourceReadCache.canonical.get(element);
    const text = scientificInlineText(element)
      .replace(/<\/?(?:sup|sub)>/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (element) sourceReadCache?.canonical.set(element, text);
    return text;
  }

  // Extraction and source navigation must derive a caption from the same DOM
  // nodes. Nature stores the title and panel/statistics text separately.
  function articleCaptionSource(element) {
    if (!element) return null;
    const documentRef = element.ownerDocument;
    const locationLike = documentRef?.location;
    const nature = /(^|\.)nature\.com$/i.test(String(locationLike?.hostname || '')) &&
      /^\/articles\/[^/]+\/?$/.test(String(locationLike?.pathname || ''));
    const springer = /^link\.springer\.com$/i.test(String(locationLike?.hostname || '')) &&
      /^\/article\/10\.\d+\/.+/.test(String(locationLike?.pathname || ''));
    const springerOwner = springer ? closestSafely(element, 'figure') : null;
    // Only the split description layout needs this strict reconstruction.
    // Other Springer pages can carry their complete caption in figcaption.
    const splitSpringer = springerOwner && queryAllSafely(springerOwner,
      '.c-article-section__figure-description,[aria-describedby^="figure-"][aria-describedby$="-desc"]').length > 0;
    const jci = /(^|\.)jci\.org$/i.test(String(locationLike?.hostname || '')) &&
      /^\/articles\/view\/[1-9]\d*\/?$/.test(String(locationLike?.pathname || ''));
    const figcaption = String(element.tagName || '').toUpperCase() === 'FIGCAPTION';
    const supplementaryTitle = element.matches?.('h3.c-article-supplementary__title');
    const plosTitle = /(^|\.)journals\.plos\.org$/i.test(String(locationLike?.hostname || '')) &&
      element.matches?.('#artText .figure > .figcaption');
    // Native PLOS TIFF supplements have a linked title and description, without
    // an HTML image. Share the exact source owner already admitted by Figures.
    if (element.matches?.('.Statement__Supplementarymaterial .SupplementaryMaterial > strong.label')) {
      if (closestSafely(element, EXCLUDED_ANCESTOR_SELECTOR)) return null;
      const discover = shared.discoverNativeTiffFigures || globalThis.SciLLM?.discoverNativeTiffFigures;
      const source = typeof discover === 'function' && discover(documentRef).find(item => item.publisher === 'frontiers' && item.titleElement === element);
      if (!source) return null;
      return { element: source.element, titleElement: element, parts: [element, ...source.captionParts],
        text: source.caption, displayText: [element, ...source.captionParts].map(scientificInlineText).join(' '),
        sourceIdentity: source.materialId, panelScope: source.captionElement };
    }
    if (element.matches?.('#artText .supplementary-material > h3.siTitle')) {
      if (closestSafely(element, EXCLUDED_ANCESTOR_SELECTOR)) return null;
      const discover = shared.discoverNativeTiffFigures ||
        (typeof globalThis !== 'undefined' ? globalThis.SciLLM?.discoverNativeTiffFigures : null);
      const owner = closestSafely(element, '.supplementary-material');
      const source = typeof discover === 'function' && discover(documentRef)
        .find(item => item.element === owner &&
          queryAllSafely(owner, 'h3.siTitle').length === 1 &&
          queryAllSafely(owner, 'h3.siTitle')[0] === element);
      if (!source) return null;
      const parts = source.captionElement === element ? [element] : [element, source.captionElement];
      return { element: owner, titleElement: element, parts,
        text: source.caption, displayText: parts.map(scientificInlineText).join(' '),
        sourceIdentity: owner.querySelector('a.link-target[id]').id,
        panelScope: source.captionElement };
    }
    const jciLegend = jci && element.matches?.('.figure > p') &&
      element.querySelector?.(':scope > span.figure_title');
    if (!figcaption && !plosTitle && !jciLegend && !(nature && supplementaryTitle)) return null;
    const excluded = EXCLUDED_ANCESTOR_SELECTOR.split(',')
      .filter(selector => selector.trim() !== 'figure').join(',') +
      ',#sci-reading-panel,[data-sci-plugin-ui],.c-article-related,.c-article-recommendations-card,' +
      '[data-test*="related" i],[data-test*="recommend" i]';
    if (closestSafely(element, excluded)) return null;
    let parts = [element], focusElement = element, sourceIdentity = '', panelScope = null;
    const frontiersOwner = figcaption &&
      /(^|\.)frontiersin\.org$/i.test(String(locationLike?.hostname || '')) &&
      closestSafely(element, '.ArticleFigure');
    if (jciLegend) {
      const container = element.parentElement;
      const labels = queryAllSafely(container, ':scope > a.figure_number');
      const legends = queryAllSafely(container, ':scope > p').filter(node =>
        node.querySelector?.(':scope > span.figure_title'));
      const label = /^Figure\s+([1-9]\d{0,2})$/i.exec(canonicalContentText(labels[0]));
      if (labels.length !== 1 || legends.length !== 1 || legends[0] !== element ||
          !label || queryAllSafely(container, '.table_thumbnail').length) return null;
      const expectedPath = `${locationLike.pathname.replace(/\/$/, '')}/figure/${Number(label[1])}`;
      const ownLink = link => {
        try { const url = new URL(link?.getAttribute?.('href'), locationLike.href);
          return url.origin === locationLike.origin && url.pathname.replace(/\/$/, '') === expectedPath;
        } catch (_) { return false; }
      };
      const images = queryAllSafely(container, 'img.figure_thumbnail').filter(image =>
        closestSafely(image, '.figure') === container && !closestSafely(image, excluded));
      const articleId = locationLike.pathname.replace(/\/$/, '').split('/').at(-1);
      if (!ownLink(labels[0]) || !images.length || images.some(image => {
        try { const url = new URL(image.getAttribute('src'), locationLike.href);
          return !/^https?:$/.test(url.protocol) || !ownLink(image.closest?.('a')) ||
            !new RegExp(`/(?:JCI|jci\\.insight\\.)${articleId}\\.f${Number(label[1])}\\.[a-z0-9]+$`, 'i').test(url.pathname);
        } catch (_) { return true; }
      })) return null;
      parts = [labels[0], element]; focusElement = container;
      sourceIdentity = expectedPath; panelScope = element;
    } else if (splitSpringer) {
      const container = springerOwner;
      const titles = queryAllSafely(container, 'figcaption');
      const label = /^(?:Fig\.?|Figure)\s*([1-9]\d{0,2})$/i.exec(canonicalContentText(element));
      if (!container || titles.length !== 1 || titles[0] !== element || !label) return null;
      const id = `figure-${Number(label[1])}-desc`;
      const descriptions = queryAllSafely(container, `[id="${id}"]`);
      const images = queryAllSafely(container, 'img').filter(image =>
        closestSafely(image, 'figure') === container && !closestSafely(image, excluded));
      const figurePath = `${locationLike.pathname.replace(/\/$/, '')}/figures/${Number(label[1])}`;
      const ownLink = queryAllSafely(container, 'a[href]').some(link => {
        try { const url = new URL(link.getAttribute('href'), locationLike.href);
          return url.origin === locationLike.origin && url.pathname.replace(/\/$/, '') === figurePath;
        } catch (_) { return false; }
      });
      const ownImage = image => {
        try {
          const url = new URL(image.getAttribute('src'), locationLike.href);
          const doi = decodeURIComponent(locationLike.pathname.replace(/^\/article\//, '').replace(/\/$/, ''));
          const path = decodeURIComponent(url.pathname);
          return /^https?:$/.test(url.protocol) && url.hostname === 'media.springernature.com' &&
            path.includes(`/art:${doi}/MediaObjects/`) &&
            new RegExp(`_Fig${Number(label[1])}_HTML\\.[a-z0-9]+$`, 'i').test(path);
        } catch (_) { return false; }
      };
      if (descriptions.length !== 1 || queryAllSafely(documentRef, `[id="${id}"]`).length !== 1 ||
          closestSafely(descriptions[0], 'figure') !== container || !ownLink || !images.length ||
          images.some(image => !ownImage(image) || image.getAttribute('aria-describedby') !== id ||
            !new RegExp(`^(?:Fig\\.?|Figure)\\s*${Number(label[1])}$`, 'i').test(image.getAttribute('alt') || ''))) return null;
      const prose = queryAllSafely(descriptions[0], 'p').filter(node =>
        !closestSafely(node, excluded) && canonicalContentText(node));
      if (!prose.length) return null;
      parts = [element, ...prose]; focusElement = container;
      sourceIdentity = id; panelScope = descriptions[0];
    } else if (frontiersOwner) {
      const titles = queryAllSafely(frontiersOwner, '.ArticleFigure__title');
      const legends = queryAllSafely(frontiersOwner, 'figcaption');
      const label = /^Figure\s+(\d+)\s*$/i.exec(canonicalContentText(titles[0]));
      const innerLabel = /^Fig(?:ure)?\.?\s*(\d+)\b/i.exec(canonicalContentText(element));
      if (titles.length !== 1 || legends.length !== 1 || legends[0] !== element ||
          !label || frontiersOwner.id !== `f${Number(label[1])}` ||
          (innerLabel && Number(innerLabel[1]) !== Number(label[1])) ||
          !canonicalContentText(element)) return null;
      const images = queryAllSafely(frontiersOwner, 'img');
      if (!images.length || images.some(image => {
        const imageLabel = /^Figure\s+(\d+)\s*$/i.exec(image.getAttribute('alt') || '');
        return !imageLabel || Number(imageLabel[1]) !== Number(label[1]);
      })) return null;
      parts = [titles[0], element];
      focusElement = frontiersOwner;
      sourceIdentity = frontiersOwner.id;
      panelScope = element;
    } else if (plosTitle) {
      const container = closestSafely(element, '.figure');
      const titles = queryAllSafely(container, '.figcaption');
      const label = /^(?:Fig\.?|Figure)\s*(\d+)\s*\./i.exec(canonicalContentText(element));
      const doi = String(container?.getAttribute?.('data-doi') || '');
      const articleDoi = new URL(locationLike.href).searchParams.get('id');
      const expectedDoi = label && `${articleDoi}.g${String(Number(label[1])).padStart(3, '0')}`;
      const images = queryAllSafely(container, 'img');
      const imageIds = images.map(image => {
        try { return new URL(image.getAttribute('src'), locationLike.href).searchParams.get('id'); }
        catch (_) { return ''; }
      });
      const prose = queryAllSafely(container, ':scope > p').filter(node =>
        !node.matches?.('.caption_object') &&
        !closestSafely(node, excluded) && canonicalContentText(node));
      // PLOS also publishes complete title-only legends with one empty native
      // caption slot. Missing slots and bare labels are not this native shape.
      const slots = queryAllSafely(container, ':scope > p.caption_target');
      const titleOnly = !prose.length && slots.length === 1 &&
        !canonicalContentText(slots[0]) && label &&
        /[\p{L}\p{N}]/u.test(canonicalContentText(element).slice(label[0].length));
      if (titles.length !== 1 || titles[0] !== element || !label || !articleDoi ||
          doi !== expectedDoi || !imageIds.length || imageIds.some(id => id !== doi) ||
          (!prose.length && !titleOnly)) return null;
      parts = [element, ...prose];
      focusElement = container;
      sourceIdentity = doi;
      panelScope = container;
    } else if (nature) {
      const article = closestSafely(element, 'article');
      const articleTitles = queryAllSafely(documentRef, 'article h1[data-test="article-title"]')
        .filter(title => !closestSafely(title, excluded));
      if (articleTitles.length !== 1 || closestSafely(articleTitles[0], 'article') !== article) return null;
      const container = figcaption
        ? closestSafely(element, 'figure')
        : closestSafely(element, '.c-article-supplementary__item');
      const selector = figcaption ? '.c-article-section__figure-description[data-test="bottom-caption"]'
        : '.c-article-supplementary__description';
      const descriptions = queryAllSafely(container, selector).filter(node =>
        closestSafely(node, figcaption ? 'figure' : '.c-article-supplementary__item') === container &&
        !closestSafely(node, excluded));
      const titles = queryAllSafely(container, figcaption ? 'figcaption' : 'h3.c-article-supplementary__title');
      const titleText = canonicalContentText(element);
      const label = figcaption ? /^(?:Fig\.\s*\d+\s*:|Figure\s+\d+(?:\s*:|\s*$))/i
        : /^Extended Data Fig(?:ure)?\.\s*\d+\b/i;
      const figurePath = `${String(locationLike.pathname).replace(/\/$/, '')}/figures/`;
      const ownFigureLink = queryAllSafely(container, 'a[href]').some(link => {
        try {
          const href = new URL(link.getAttribute('href'), locationLike.href);
          return href.origin === locationLike.origin && href.pathname.startsWith(figurePath) &&
            /^\d+\/?$/.test(href.pathname.slice(figurePath.length));
        } catch (_) { return false; }
      });
      if (!container || titles.length !== 1 || titles[0] !== element ||
          descriptions.length !== 1 || !canonicalContentText(descriptions[0]) ||
          !label.test(titleText) || !ownFigureLink) return null;
      // Only prose in the description belongs to the caption; Source data and
      // image/download controls are navigation rather than scientific evidence.
      const prose = queryAllSafely(descriptions[0], 'p').filter(node =>
        !closestSafely(node, excluded) && !/^(?:Source data|Full size image)$/i.test(canonicalContentText(node)));
      if (!prose.length) return null;
      parts = [element, ...prose];
      focusElement = container;
      sourceIdentity = String(element.id || (figcaption
        ? element.querySelector?.('[id]')?.id : container.id) || '');
      panelScope = descriptions[0];
    }
    const displayText = parts.map(scientificInlineText).filter(Boolean).join(' ');
    const text = displayText.replace(/<\/?(?:sup|sub)>/gi, '').replace(/\s+/g, ' ').trim();
    return text ? { element: focusElement, titleElement: element, parts, text, displayText, sourceIdentity, panelScope } : null;
  }

  function collectArticleCaptionSources(documentRef) {
    return queryAllSafely(documentRef, 'figcaption,h3.c-article-supplementary__title,#artText .figure > .figcaption,.figure > p,#artText .supplementary-material > h3.siTitle,.Statement__Supplementarymaterial .SupplementaryMaterial > strong.label')
      .map(articleCaptionSource).filter(Boolean);
  }

  function blocksWithCaptionSource(element, block) {
    const caption = articleCaptionSource(element);
    if (!caption) return block.kind === 'figure-caption' ? [] : [block];
    const captionBlock = { ...block, kind: 'figure-caption', level: 0,
      text: caption.text, displayText: caption.displayText,
      sourceKey: block.sourceKey || caption.sourceIdentity,
      domId: block.domId || caption.sourceIdentity,
      blockFingerprint: block.blockFingerprint || caption.sourceIdentity };
    return block.kind === 'heading' ? [block, captionBlock] : [captionBlock];
  }

  function immersiveTranslationTexts(element) {
    if (!element) return [];
    const candidates = [];
    if (element.matches?.(INJECTED_TRANSLATION_SELECTOR)) candidates.push(element);
    if (element.querySelectorAll) {
      candidates.push(...element.querySelectorAll(INJECTED_TRANSLATION_SELECTOR));
    }
    const seen = new Set();
    return candidates
      .filter(node => !closestSafely(node, SOURCE_UI_SELECTOR))
      .filter(node => !candidates.some(parent =>
        parent !== node && parent.contains?.(node)))
      .map(node => String(node.textContent || '')
        .normalize('NFKC').replace(/\s+/g, ' ').trim())
      .filter(text => {
        const key = text.toLocaleLowerCase();
        if (!text || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function bilingualHeadingDisplayText(element, fallback = '') {
    const primary = canonicalContentText(element) ||
      String(fallback || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const primaryKey = primary.toLocaleLowerCase();
    const translations = immersiveTranslationTexts(element)
      .filter(text => text.toLocaleLowerCase() !== primaryKey);
    return [primary, ...translations].filter(Boolean).join('\n');
  }

  function hashNormalizedText(value) {
    const text = normalizeTextWithOffsets(value).text.normalize('NFKC').toLowerCase();
    let first = 2166136261;
    let second = 2166136261 ^ 0x9e3779b9;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ code, 2246822519);
    }
    return `${(first >>> 0).toString(16).padStart(8, '0')}` +
      `${(second >>> 0).toString(16).padStart(8, '0')}`;
  }

  function recordTypeForBlock(kind) {
    if (kind === 'reference') return 'reference';
    if (kind === 'figure-caption') return 'figure-caption';
    if (kind === 'table-caption') return 'table-caption';
    return 'body';
  }

  function stableSourceSelector(value) {
    const selector = String(value || '').normalize('NFKC').trim();
    return /^\[data-sci-llm-paragraph-id=(?:"[^"]*"|'[^']*')\]$/i.test(selector)
      ? '' : selector;
  }

  function summarizeArticleRecords(records) {
    const source = Array.isArray(records) ? records : [];
    const count = type => source.filter(record => record.recordType === type).length;
    return {
      recordCount: source.length,
      bodyParagraphCount: count('body'),
      figureCaptionCount: count('figure-caption'),
      tableCaptionCount: count('table-caption'),
      referenceCount: count('reference'),
      bodyCharacterCount: source
        .filter(record => record.recordType === 'body')
        .reduce((sum, record) => sum + String(record.text || '').length, 0),
      characterCount: source.reduce((sum, record) =>
        sum + String(record.text || '').length, 0)
    };
  }

  function buildParagraphRecords(blocks) {
    const records = [];
    const seenCanonicalRecords = new Set();
    let sectionTitle = 'Article';
    let sectionId = 'sec-article';
    let sectionKind = 'article';
    let index = 0;
    let excluded = false;
    let utilityExcludedLevel = null;
    const sectionOccurrences = new Map();
    const headingStack = [];
    const recordIndexes = new Map();

    blocks.forEach(block => {
      const text = normalizeTextWithOffsets(block.text).text;
      const displayText = String(block.displayText || '').trim() || text;
      if (!text) return;
      if (block.kind === 'heading') {
        const level = Number.isInteger(block.level) && block.level >= 1 && block.level <= 6
          ? block.level : 2;
        if (utilityExcludedLevel !== null) {
          if (level > utilityExcludedLevel) return;
          utilityExcludedLevel = null;
        }
        if (isReviewUtilitySectionTitle(text) && !isExcludedSectionHeading(text)) {
          if (SCOPED_UTILITY_SECTION.test(text)) utilityExcludedLevel = level;
          return;
        }
        excluded = isExcludedSectionHeading(text);
        if (!excluded) {
          const classifiedSectionKind = classifyMajorSectionHeading(text);
          sectionKind = classifiedSectionKind || sectionKind;
          sectionTitle = text;
          const sectionSlug = slugifyHeading(text);
          const occurrence = (sectionOccurrences.get(sectionSlug) || 0) + 1;
          sectionOccurrences.set(sectionSlug, occurrence);
          sectionId = `sec-${sectionSlug}${occurrence > 1 ? `-${occurrence}` : ''}`;
          while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
            headingStack.pop();
          }
          headingStack.push({
            level,
            sectionId,
            title: sectionTitle,
            displayTitle: displayText,
            domId: String(block.domId || ''),
            dataSelector: String(block.dataSelector || ''),
            blockFingerprint: String(block.blockFingerprint || '')
          });
          index = 0;
        }
        return;
      }
      if (excluded || utilityExcludedLevel !== null) return;
      if (block.kind === 'paragraph' && isReviewUtilityParagraphText(text)) return;
      if (block.kind === 'paragraph' && isSupplementalMediaParagraphText(text)) return;
      if (block.kind === 'paragraph' && sectionKind !== 'reference' &&
          isLikelyInlineReferenceFlyoutText(text)) return;
      const textHash = hashNormalizedText(text);
      const recordType = recordTypeForBlock(block.kind);
      const explicitSourceIdentity = String(
        block.sourceKey || block.blockFingerprint ||
        stableSourceSelector(block.dataSelector) || block.domId || ''
      ).normalize('NFKC').trim();
      const sectionPathKey = headingStack.map(item => item.title.toLowerCase()).join(' > ') ||
        sectionTitle.toLowerCase();
      const dedupeKey = explicitSourceIdentity
        ? `${sectionPathKey}\n${explicitSourceIdentity}\n${textHash}`
        : `${sectionTitle.toLowerCase()}\n${recordType}\n${textHash}`;
      if (seenCanonicalRecords.has(dedupeKey)) return;
      seenCanonicalRecords.add(dedupeKey);
      const indexKey = `${sectionId}:${recordType}`;
      const recordIndex = (recordIndexes.get(indexKey) || 0) + 1;
      recordIndexes.set(indexKey, recordIndex);
      index = recordIndex;
      const sourceIdentity = explicitSourceIdentity ||
        `text-${hashNormalizedText(`${sectionPathKey}\n${recordType}\n${text}`)}`;
      const idPrefix = recordType === 'body' ? 'p'
        : recordType === 'figure-caption' ? 'figcap'
          : recordType === 'table-caption' ? 'tblcap' : 'ref';
      const record = {
        paragraphId: `${sectionId}-${idPrefix}-${String(recordIndex).padStart(3, '0')}`,
        sourceIdentity,
        textHash,
        recordType,
        sectionId,
        sectionTitle,
        displaySectionTitle: headingStack.length
          ? headingStack[headingStack.length - 1].displayTitle || sectionTitle
          : sectionTitle,
        sectionKind,
        headingLevel: headingStack.length
          ? headingStack[headingStack.length - 1].level : 1,
        headingPath: headingStack.length
          ? headingStack.map(item => ({ ...item }))
          : [{
              level: 1,
              sectionId: 'sec-article',
              title: 'Article',
              displayTitle: 'Article'
            }],
        kind: block.kind || 'paragraph',
        text,
        displayText,
        domId: String(block.domId || ''),
        dataSelector: String(block.dataSelector || ''),
        blockFingerprint: String(block.blockFingerprint || '')
      };
      if (Number.isInteger(block.sourceIndex)) record.sourceIndex = block.sourceIndex;
      records.push(record);
    });
    return records;
  }

  function collectContentElements(root, adapter = null) {
    if (!root?.querySelectorAll) return [];
    const allElements = [...root.querySelectorAll('*')];
    const nativeSources = collectArticleCaptionSources(root);
    const separatelyOwned = nativeSources.filter(source => source.element !== source.titleElement);
    const nativeTitles = new Set(nativeSources.map(source => source.titleElement));
    const jci = /(^|\.)jci\.org$/i.test(String(root.ownerDocument?.location?.hostname || root.location?.hostname || ''));
    const inOwnedLegend = element => separatelyOwned.some(source =>
      element !== source.titleElement && source.element.contains?.(element));
    const adapterHeadings = new Set(
      (adapter?.headingSelectors || []).flatMap(selector =>
        queryAllSafely(root, selector))
    );
    const adapterParagraphs = new Set(
      (adapter?.paragraphSelectors || []).flatMap(selector =>
        queryAllSafely(root, selector))
    );
    const primaryElements = allElements.filter(element => {
      if (inOwnedLegend(element)) return false;
      if (nativeTitles.has(element)) return true;
      if (jci && closestSafely(element, '.figure')) return false;
      if (isExcludedContentElement(element, adapter)) return false;
      if (element.tagName === 'FIGCAPTION') return true;
      if (articleCaptionSource(element)) return true;
      const adapterHeading = adapterHeadings.has(element) &&
        !PRIMARY_CONTENT_TAGS.has(element.tagName) &&
        element.tagName !== 'FIGCAPTION' &&
        !element.querySelector?.(SEMANTIC_HEADING_SELECTOR);
      const heading = isHeadingElement(element) || adapterHeading;
      if (heading) return !isEphemeralHeadingTitle(canonicalContentText(element));
      if (element.tagName === 'LI' &&
          element.querySelector?.('p,li,[role="paragraph"]')) return false;
      if (PRIMARY_CONTENT_TAGS.has(element.tagName)) {
        return !isSupplementalMediaParagraphText(canonicalContentText(element));
      }
      return adapterParagraphs.has(element) &&
        !element.querySelector?.(STRUCTURAL_TEXT_SELECTOR) &&
        !isSupplementalMediaParagraphText(canonicalContentText(element));
    });
    const supplementalCandidates = allElements.filter(element => {
      if (inOwnedLegend(element) || articleCaptionSource(element)) return false;
      if (jci && closestSafely(element, '.figure')) return false;
      const role = element.getAttribute?.('role');
      const isTextContainer = UNRECOGNIZED_BLOCK_TAGS.has(element.tagName);
      if (!isTextContainer && role !== 'paragraph') return false;
      if (isExcludedContentElement(element, adapter)) return false;
      if (element.querySelector?.(STRUCTURAL_TEXT_SELECTOR)) return false;
      const text = normalizeTextWithOffsets(canonicalContentText(element)).text;
      if (isSupplementalMediaParagraphText(text)) return false;
      if (text.length < 40 || text.length > 1800) return false;
      const wordCount = (text.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
      const hasSentencePunctuation = /[.!?。！？]/.test(text);
      return (wordCount >= (role === 'paragraph' ? 6 : 10) ||
        /[\u3400-\u9fff]/.test(text)) &&
        (text.length >= 120 || hasSentencePunctuation);
    });
    const supplementalSet = new Set(supplementalCandidates);
    const supplementalRoots = supplementalCandidates.filter(element => {
      let ancestor = element.parentElement || null;
      while (ancestor && ancestor !== root) {
        if (supplementalSet.has(ancestor)) return false;
        ancestor = ancestor.parentElement || null;
      }
      return true;
    });
    const selected = new Set([...primaryElements, ...supplementalRoots]);
    return allElements.filter(element => selected.has(element));
  }

  function getBlockKind(element) {
    if (isHeadingElement(element)) return 'heading';
    if (element.tagName === 'FIGCAPTION') return 'figure-caption';
    if (element.tagName === 'CAPTION') return 'table-caption';
    return 'paragraph';
  }

  function scoreContentRoot(root, adapter = null, elementsByRoot = null) {
    let elements = elementsByRoot?.get(root);
    if (!elements) {
      elements = collectContentElements(root, adapter);
      elementsByRoot?.set(root, elements);
    }
    let score = 0;
    elements.forEach(element => {
      const text = normalizeTextWithOffsets(canonicalContentText(element)).text;
      const length = text.length;
      const kind = getBlockKind(element);
      if (kind === 'heading') {
        score += isReviewUtilitySectionTitle(text) ? -1500000 : 350000;
        if (classifyMajorSectionHeading(text)) score += 500000;
      } else if (kind === 'paragraph') {
        const sentenceLike = /[.!?。！？]/.test(text);
        if (length >= 40 && (sentenceLike || length >= 80)) {
          score += 1000000 + (length * 100);
        } else if (length >= 20 && sentenceLike) {
          score += 250000 + (length * 100);
        } else {
          score -= 250000;
        }
      }
    });
    return score;
  }

  function queryAllSafely(root, selector) {
    if (!root?.querySelectorAll || !selector) return [];
    try {
      return [...root.querySelectorAll(selector)];
    } catch (_) {
      return [];
    }
  }

  function closestSafely(element, selector) {
    if (!element?.closest || !selector) return null;
    const cached = sourceReadCache?.ancestors.get(element);
    if (cached?.has(selector)) return cached.get(selector);
    try {
      const match = element.closest(selector);
      if (sourceReadCache) {
        const selectors = cached || new Map();
        selectors.set(selector, match);
        if (!cached) sourceReadCache.ancestors.set(element, selectors);
      }
      return match;
    } catch (_) {
      return null;
    }
  }

  function isExcludedContentElement(element, adapter = null) {
    const tagName = String(element?.tagName || '').toUpperCase();
    if (tagName === 'FIGCAPTION') {
      const captionExcludedSelector = EXCLUDED_ANCESTOR_SELECTOR
        .split(',').filter(selector => selector.trim() !== 'figure').join(',');
      if (closestSafely(element, captionExcludedSelector)) return true;
    } else if (closestSafely(element, EXCLUDED_ANCESTOR_SELECTOR)) {
      return true;
    }
    return (adapter?.excludedSelectors || []).some(selector =>
      (tagName !== 'FIGCAPTION' || selector !== 'figure') &&
      Boolean(closestSafely(element, selector))
    );
  }

  function getContentRootCandidates(documentRef, adapter = null) {
    const selector = [
      ...(adapter?.articleRootSelectors || []),
      CONTENT_ROOT_SELECTOR
    ].filter(Boolean).join(',');
    const candidates = documentRef.querySelectorAll
      ? queryAllSafely(documentRef, selector)
      : [];
    if (!candidates.length && documentRef.querySelector) {
      let fallbackCandidate = null;
      try {
        fallbackCandidate = documentRef.querySelector(selector);
      } catch (_) {}
      if (fallbackCandidate) candidates.push(fallbackCandidate);
    }
    if (!candidates.length && documentRef.body) candidates.push(documentRef.body);
    return candidates;
  }

  function selectContentRoot(documentRef, adapter = null, options = {}) {
    // One synchronous extraction pass can compare the same winning root many
    // times. Reuse its elements and score only within this call, never across
    // DOM changes or subsequent reads.
    const elementsByRoot = options.elementsByRoot || new Map();
    const scores = new Map();
    const score = candidate => {
      if (!scores.has(candidate)) {
        scores.set(candidate, scoreContentRoot(candidate, adapter, elementsByRoot));
      }
      return scores.get(candidate);
    };
    const candidates = getContentRootCandidates(documentRef, adapter);
    const specificCandidates = [];
    const seenSpecific = new Set();
    (adapter?.specificArticleRootSelectors || []).forEach(selector => {
      queryAllSafely(documentRef, selector).forEach(candidate => {
        if (!candidate || seenSpecific.has(candidate)) return;
        seenSpecific.add(candidate);
        specificCandidates.push(candidate);
      });
    });
    const bestSpecific = specificCandidates.reduce((best, candidate) => (
      !best || score(candidate) > score(best)
        ? candidate : best
    ), null);
    if (bestSpecific && specificCandidates.length > 1) {
      const consolidated = candidates.reduce((best, candidate) => {
        const containedSpecificCount = specificCandidates.filter(fragment =>
          fragment === candidate || candidate?.contains?.(fragment)
        ).length;
        if (containedSpecificCount < 2) return best;
        const candidateScore = score(candidate);
        if (!best || containedSpecificCount > best.containedSpecificCount ||
            (containedSpecificCount === best.containedSpecificCount && candidateScore > best.score)) {
          return { candidate, containedSpecificCount, score: candidateScore };
        }
        return best;
      }, null);
      if (consolidated && consolidated.score > score(bestSpecific)) {
        return consolidated.candidate;
      }
    }
    if (bestSpecific) return bestSpecific;
    return candidates.reduce((best, candidate) => (
      !best || score(candidate) > score(best)
        ? candidate : best
    ), null) || documentRef.body;
  }

  function buildRecordsFromElements(elements) {
    const blocks = elements.flatMap((element, sourceIndex) => blocksWithCaptionSource(element, {
      kind: getBlockKind(element),
      level: isHeadingElement(element) ? getHeadingLevel(element) : 0,
      text: canonicalContentText(element),
      displayText: isHeadingElement(element)
        ? bilingualHeadingDisplayText(element)
        : scientificInlineText(element),
      sourceIndex,
      domId: String(element.id || ''),
      dataSelector: element.dataset?.sciLlmParagraphId
        ? `[data-sci-llm-paragraph-id="${element.dataset.sciLlmParagraphId}"]` : '',
      sourceKey: String(
        element.dataset?.sciLlmSourceKey ||
        element.getAttribute?.('data-section-id') ||
        element.getAttribute?.('data-id') ||
        element.id || ''
      ),
      blockFingerprint: String(element.id || '')
    }));
    return buildParagraphRecords(blocks);
  }

  function outlineTargetId(link) {
    const explicitTarget = String(link?.getAttribute?.('data-target') || '')
      .replace(/^#/, '').trim();
    if (explicitTarget) return explicitTarget;
    const href = String(link?.getAttribute?.('href') || '');
    const hashIndex = href.lastIndexOf('#');
    if (hashIndex < 0 || hashIndex === href.length - 1) return '';
    try {
      return decodeURIComponent(href.slice(hashIndex + 1)).trim();
    } catch {
      return href.slice(hashIndex + 1).trim();
    }
  }

  function normalizedHeadingKey(value) {
    return String(value || '').normalize('NFKC')
      .replace(/^\s*(?:\d+(?:\.\d+)*|[IVXLC]+)[\s.):\-]+/i, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function ownedByOutlineTarget(element, target, boundaryTargets) {
    let current = element;
    while (current) {
      if (boundaryTargets.has(current)) return current === target;
      if (current === target) return true;
      current = current.parentElement || null;
    }
    // Lightweight document mocks may not expose parentElement; keep their direct elements.
    return !element?.parentElement;
  }

  function outlineContentRoot(target) {
    if (!target) return null;
    const tagName = String(target.tagName || '').toUpperCase();
    if (['SECTION', 'ARTICLE'].includes(tagName)) return target;
    if (isHeadingElement(target)) {
      return target.closest?.('section,article,[class*="section" i]') ||
        target.parentElement || target;
    }
    if (tagName === 'DIV') return target;
    return target.closest?.('section,article,div') || target.parentElement || target;
  }

  function isNonSectionOutlineEntry(targetId, title) {
    const id = String(targetId || '').trim();
    const label = normalizeTextWithOffsets(title).text;
    if (/^\d+(?:\s*[-,]\s*\d+)*$/.test(label)) return true;
    return /^(?:au|author|aff|affiliation|fn|footnote|xref|bib|ref|reference|fig|figure|tbl|table|note|correspondence)[-_]?\d*/i.test(id) ||
      /^(?:f|t)[-_]?\d+$/i.test(id);
  }

  function isSectionLikeOutlineTarget(entry, matchingHeading) {
    if (matchingHeading) return true;
    const targets = [entry?.target, entry?.root].filter(Boolean);
    return targets.some(target => {
      const tagName = String(target.tagName || '').toUpperCase();
      if (tagName === 'SECTION' || tagName === 'ARTICLE') return true;
      const descriptor = [target.id, target.className, target.getAttribute?.('role')]
        .filter(Boolean).join(' ');
      return /(?:^|[\s_-])(?:article[-_ ]?)?sec(?:tion)?(?:[\s_-]|$)|body[-_ ]?section/i.test(descriptor);
    });
  }

  function collectOutlineEntries(documentRef, adapter = null) {
    if (!documentRef?.querySelectorAll || !documentRef?.getElementById) return [];
    const links = [];
    const seenLinks = new Set();
    function appendLinks(items) {
      items.forEach(link => {
        if (!link || seenLinks.has(link) || !outlineTargetId(link)) return;
        seenLinks.add(link);
        links.push(link);
      });
    }
    (adapter?.outlineRootSelectors || []).forEach(rootSelector => {
      queryAllSafely(documentRef, rootSelector).forEach(root => {
        (adapter?.outlineLinkSelectors || ['a[href^="#"]']).forEach(linkSelector => {
          appendLinks(queryAllSafely(root, linkSelector));
        });
      });
    });
    if (links.length < 3) {
      appendLinks(queryAllSafely(documentRef, OUTLINE_LINK_SELECTOR));
    }
    if (links.length < 3) {
      (adapter?.outlineLinkSelectors || []).forEach(selector => {
        appendLinks(queryAllSafely(documentRef, selector));
      });
    }
    if (links.length < 3) {
      appendLinks(queryAllSafely(documentRef, 'a[href^="#"]'));
    }
    const seenTargets = new Set();
    const entries = [];
    links.forEach(link => {
      const targetId = outlineTargetId(link);
      const target = targetId ? documentRef.getElementById(targetId) : null;
      if (!target || seenTargets.has(target)) return;
      const title = normalizeTextWithOffsets(canonicalContentText(link)).text;
      if (!title || title.length > 500) return;
      if (isNonSectionOutlineEntry(targetId, title)) return;
      const root = outlineContentRoot(target);
      if (!root) return;
      seenTargets.add(target);
      entries.push({
        targetId,
        target,
        root,
        link,
        title,
        displayTitle: bilingualHeadingDisplayText(link, title) || title
      });
    });
    return entries;
  }

  function extractArticleFromOutline(documentRef, options = {}) {
    if (!documentRef?.querySelectorAll || !documentRef?.getElementById) return [];
    const adapter = options.adapter || (
      typeof shared.selectPublisherAdapter === 'function'
        ? shared.selectPublisherAdapter(documentRef?.location || {})
        : null
    );
    const entries = Array.isArray(options.entries)
      ? options.entries : collectOutlineEntries(documentRef, adapter);
    if (entries.length < 3) return [];

    const boundaryTargets = new Set(entries.flatMap(entry => [entry.target, entry.root]));
    const scientificEntries = entries.filter(entry =>
      !isReviewUtilitySectionTitle(entry.title));
    const blocks = [];
    const sourceElements = [];

    scientificEntries.forEach((entry, entryIndex) => {
      const elements = collectContentElements(entry.root, adapter);
      const owned = elements.filter(element =>
        ownedByOutlineTarget(element, entry.root, boundaryTargets));
      const ownHeadings = owned.filter(isHeadingElement);
      const linkKey = normalizedHeadingKey(entry.title);
      const matchingHeading = (isHeadingElement(entry.target) ? entry.target : null) ||
        ownHeadings.find(element => {
        const headingKey = normalizedHeadingKey(canonicalContentText(element));
        return headingKey === linkKey || headingKey.includes(linkKey) || linkKey.includes(headingKey);
      });
      if (!isSectionLikeOutlineTarget(entry, matchingHeading)) return;

      const nestingDepth = entries.reduce((depth, candidate) => {
        if (candidate.root === entry.root) return depth;
        return typeof candidate.root?.contains === 'function' &&
          candidate.root.contains(entry.root) ? depth + 1 : depth;
      }, 0);
      const level = matchingHeading
        ? getHeadingLevel(matchingHeading) : Math.min(6, 2 + nestingDepth);
      const content = owned.filter(element =>
        element !== matchingHeading &&
        !entries.some(candidate =>
          candidate !== entry &&
          (element === candidate.target || element === candidate.root)
        )
      );
      const hasChildSection = entries.some(candidate =>
        candidate.root !== entry.root &&
        typeof entry.root?.contains === 'function' && entry.root.contains(candidate.root));
      const paragraphContent = content.filter(element =>
        getBlockKind(element) === 'paragraph');
      if (!paragraphContent.length && !hasChildSection) return;
      let headingDataSelector = '';
      if (matchingHeading?.dataset && options.markElements !== false) {
        const headingMarker =
          `outline-${slugifyHeading(entry.title)}-${entryIndex + 1}`;
        matchingHeading.dataset.sciLlmHeadingId = headingMarker;
        headingDataSelector =
          `[data-sci-llm-heading-id="${headingMarker}"]`;
      }

      blocks.push({
        kind: 'heading',
        level,
        text: entry.title,
        displayText: bilingualHeadingDisplayText(matchingHeading, entry.displayTitle) ||
          entry.displayTitle || entry.title,
        domId: String(matchingHeading?.id || entry.target?.id || entry.targetId || ''),
        dataSelector: headingDataSelector,
        blockFingerprint: String(entry.targetId || matchingHeading?.id || '')
      });
      content.forEach(element => {
        if (isHeadingElement(element)) {
          blocks.push(...blocksWithCaptionSource(element, {
            kind: 'heading',
            level: getHeadingLevel(element),
            text: canonicalContentText(element),
            displayText: bilingualHeadingDisplayText(element),
            domId: String(element.id || ''),
            blockFingerprint: String(element.id || '')
          }));
          return;
        }
        const kind = getBlockKind(element);
        if (!['paragraph', 'figure-caption', 'table-caption'].includes(kind)) return;
        const sourceIndex = sourceElements.length;
        sourceElements.push(element);
        blocks.push(...blocksWithCaptionSource(element, {
          kind,
          level: 0,
          text: canonicalContentText(element),
          displayText: scientificInlineText(element),
          sourceIndex,
          domId: String(element.id || ''),
          sourceKey: String(
            element.dataset?.sciLlmSourceKey ||
            element.getAttribute?.('data-section-id') ||
            element.getAttribute?.('data-id') ||
            element.id || ''
          ),
          blockFingerprint: String(element.id || '')
        }));
      });
    });

    const records = buildParagraphRecords(blocks);
    const sectionCount = new Set(records.map(record => record.sectionId)).size;
    const characterCount = records.reduce((sum, record) => sum + record.text.length, 0);
    if (sectionCount < 3 || records.length < 3 || characterCount < 300) return [];
    if (options.markElements !== false) {
      records.forEach(record => {
        if (record.recordType !== 'body') return;
        const element = sourceElements[record.sourceIndex];
        if (element?.dataset) element.dataset.sciLlmParagraphId = record.paragraphId;
      });
    }
    return records;
  }

  function recordsToStructureInput(records, documentRef, adapter, strategy, diagnostics = {}) {
    const sourceRecords = Array.isArray(records) ? records : [];
    const firstRecordBySection = new Map();
    sourceRecords.forEach(record => {
      const path = Array.isArray(record?.headingPath) ? record.headingPath : [];
      path.forEach(heading => {
        const sectionId = String(heading?.sectionId || '');
        if (sectionId && !firstRecordBySection.has(sectionId)) {
          firstRecordBySection.set(sectionId, record);
        }
      });
    });
    const headings = [];
    const seen = new Set();
    sourceRecords.forEach(record => {
      const path = Array.isArray(record.headingPath) ? record.headingPath : [];
      path.forEach((heading, index) => {
        const sourceKey = String(heading.sectionId || '');
        if (!sourceKey || seen.has(sourceKey)) return;
        seen.add(sourceKey);
        const firstRecord = firstRecordBySection.get(sourceKey);
        const syntheticArticle = /^article$/i.test(
          String(heading.title || '').trim()
        ) && !heading.domId && !heading.dataSelector;
        headings.push({
          sourceKey,
          parentSourceKey: index ? String(path[index - 1].sectionId || '') : '',
          title: heading.title,
          displayTitle: heading.displayTitle || heading.title,
          sectionKind: firstRecord?.sectionKind || '',
          level: heading.level,
          order: headings.length,
          domId: heading.domId || (syntheticArticle ? firstRecord?.domId : '') || '',
          dataSelector: heading.dataSelector || (
            syntheticArticle && firstRecord
              ? firstRecord.dataSelector ||
                `[data-sci-llm-paragraph-id="${firstRecord.paragraphId}"]`
              : ''
          ),
          blockFingerprint: heading.blockFingerprint ||
            (syntheticArticle ? firstRecord?.blockFingerprint : '') ||
            sourceKey
        });
      });
    });
    const paragraphs = sourceRecords.map((record, index) => ({
      sourceKey: record.paragraphId,
      sourceIdentity: record.sourceIdentity,
      headingSourceKey: record.sectionId,
      text: record.text,
      displayText: record.displayText || record.text,
      textHash: record.textHash,
      recordType: record.recordType,
      sectionTitle: record.sectionTitle,
      displaySectionTitle: record.displaySectionTitle || record.sectionTitle,
      sectionPath: (record.headingPath || []).map(item => ({
        level: item.level,
        sectionId: item.sectionId,
        title: item.title,
        displayTitle: item.displayTitle || item.title
      })),
      sectionKind: record.sectionKind,
      kind: record.kind,
      order: index,
      domId: record.domId,
      dataSelector: record.dataSelector ||
        `[data-sci-llm-paragraph-id="${record.paragraphId}"]`,
      blockFingerprint: record.blockFingerprint || record.paragraphId
    }));
    return {
      adapterId: adapter?.id || 'generic',
      publisherFamily: adapter?.family || 'generic',
      strategy,
      title: documentRef?.title || '',
      headings,
      paragraphs,
      diagnostics
    };
  }

  function outlineRecordsAreReliable(outlineRecords, rootRecords) {
    if (!outlineRecords.length) return false;
    const outlineBodyRecords = outlineRecords.filter(record =>
      String(record?.recordType || 'body') === 'body');
    const rootBodyRecords = (Array.isArray(rootRecords) ? rootRecords : [])
      .filter(record => String(record?.recordType || 'body') === 'body');
    if (rootBodyRecords.length >= 20) {
      const outlineCharacterCount = outlineBodyRecords.reduce((sum, record) =>
        sum + normalizeTextWithOffsets(record?.text).text.length, 0);
      const rootCharacterCount = rootBodyRecords.reduce((sum, record) =>
        sum + normalizeTextWithOffsets(record?.text).text.length, 0);
      const paragraphCoverage = outlineBodyRecords.length / rootBodyRecords.length;
      const characterCoverage = rootCharacterCount > 0
        ? outlineCharacterCount / rootCharacterCount : 1;
      // A table of contents can name every section while its anchors resolve to
      // title wrappers or one teaser paragraph per section. Treating that as a
      // complete article silently drops Methods, Extended Data citations, and
      // most of the evidence used by chat and Figure analysis.
      if (paragraphCoverage < 0.5 && characterCoverage < 0.75) return false;
    }
    const sections = new Map();
    outlineRecords.forEach(record => {
      const sectionId = String(record.sectionId || '');
      if (!sectionId || sections.has(sectionId)) return;
      sections.set(sectionId, String(record.sectionTitle || ''));
    });
    const titles = [...sections.values()].map(normalizedHeadingKey).filter(Boolean);
    const uniqueTitleRatio = titles.length
      ? new Set(titles).size / titles.length : 0;
    if (titles.length < 3 || uniqueTitleRatio < 0.75) return false;

    const paragraphKeys = outlineRecords.map(record =>
      normalizeTextWithOffsets(record.text).text.toLowerCase()
    ).filter(Boolean);
    const uniqueParagraphRatio = paragraphKeys.length
      ? new Set(paragraphKeys).size / paragraphKeys.length : 0;
    if (paragraphKeys.length >= 6 && uniqueParagraphRatio < 0.8) return false;

    const rootTitles = [...new Set((Array.isArray(rootRecords) ? rootRecords : [])
      .map(record => normalizedHeadingKey(record?.sectionTitle))
      .filter(title => title && title !== 'article'))];
    const titleCoveredByOutline = rootTitle => titles.some(outlineTitle =>
      outlineTitle === rootTitle ||
      outlineTitle.includes(rootTitle) ||
      rootTitle.includes(outlineTitle)
    );
    const missingCoreFrontMatter = rootTitles.filter(rootTitle =>
      /^(?:highlights?|summary|abstract|graphical abstract)\b/i.test(rootTitle) &&
      !titleCoveredByOutline(rootTitle)
    );
    if (missingCoreFrontMatter.length) return false;
    if (rootTitles.length >= 6) {
      const coveredRootTitles = rootTitles.filter(titleCoveredByOutline);
      const missingRootTitles = rootTitles.length - coveredRootTitles.length;
      const rootCoverage = coveredRootTitles.length / rootTitles.length;
      if (missingRootTitles >= 2 && rootCoverage < 0.9) return false;
    }
    return true;
  }

  function outlineCoverageForRecords(entries, records) {
    const outlineEntries = (Array.isArray(entries) ? entries : [])
      .filter(entry => !isReviewUtilitySectionTitle(entry?.title));
    const recordHeadings = [];
    const seenHeadings = new Set();
    (Array.isArray(records) ? records : []).forEach(record => {
      const path = Array.isArray(record?.headingPath) ? record.headingPath : [];
      const candidates = path.length ? path : [{
        sectionId: record?.sectionId,
        title: record?.sectionTitle
      }];
      candidates.forEach(heading => {
        const key = normalizedHeadingKey(heading?.title);
        if (!key || key === 'article' || isReviewUtilitySectionTitle(heading?.title)) return;
        const identity = `${String(heading?.sectionId || '')}\n${key}`;
        if (seenHeadings.has(identity)) return;
        seenHeadings.add(identity);
        recordHeadings.push(key);
      });
    });

    const unmatchedHeadings = [...recordHeadings];
    let matchedOutlineEntryCount = 0;
    outlineEntries.forEach(entry => {
      const outlineKey = normalizedHeadingKey(entry?.title);
      if (!outlineKey) return;
      const matchIndex = unmatchedHeadings.findIndex(recordKey =>
        recordKey === outlineKey || (
          Math.min(recordKey.length, outlineKey.length) >= 6 &&
          (recordKey.includes(outlineKey) || outlineKey.includes(recordKey))
        )
      );
      if (matchIndex < 0) return;
      matchedOutlineEntryCount += 1;
      unmatchedHeadings.splice(matchIndex, 1);
    });
    return {
      outlineEntryCount: outlineEntries.length,
      matchedOutlineEntryCount
    };
  }

  function stripArticleTitleHeading(records, documentTitle) {
    const originalSource = Array.isArray(records) ? records : [];
    const hasExplicitBodySection = originalSource.some(record =>
      !/^article$/i.test(String(record?.sectionTitle || '').trim())
    );
    const source = hasExplicitBodySection
      ? originalSource.filter(record => {
          const sectionTitle = String(record?.sectionTitle || '').trim();
          const path = Array.isArray(record?.headingPath) ? record.headingPath : [];
          return !/^article$/i.test(sectionTitle) &&
            !(path.length === 1 &&
              /^article$/i.test(String(path[0]?.title || '').trim()));
        })
      : originalSource;
    const documentKey = normalizedHeadingKey(documentTitle);
    const matchingSectionIds = new Set(source.flatMap(record => {
      const path = Array.isArray(record.headingPath) ? record.headingPath : [];
      const heading = path[0];
      const headingKey = normalizedHeadingKey(heading?.title);
      return Number(heading?.level) === 1 && headingKey.length >= 20 &&
        (documentKey.includes(headingKey) || headingKey.includes(documentKey))
        ? [heading.sectionId] : [];
    }));
    if (!matchingSectionIds.size) return source;

    const childSections = new Set(source.flatMap(record => {
      const path = Array.isArray(record.headingPath) ? record.headingPath : [];
      return matchingSectionIds.has(path[0]?.sectionId) && path[1]?.sectionId
        ? [path[1].sectionId] : [];
    }));
    if (childSections.size < 2) return source;

    return source.flatMap(record => {
      const path = Array.isArray(record.headingPath) ? record.headingPath : [];
      if (matchingSectionIds.has(path[0]?.sectionId)) {
        if (path.length < 2) return [];
        const headingPath = path.slice(1);
        const leaf = headingPath[headingPath.length - 1];
        return [{
          ...record,
          sectionId: leaf.sectionId,
          sectionTitle: leaf.title,
          headingLevel: leaf.level,
          headingPath
        }];
      }
      if (/^article$/i.test(String(path[0]?.title || '').trim())) return [];
      return [record];
    });
  }

  function extractArticleFromRoot(documentRef, adapter, options = {}) {
    const elementsByRoot = new Map();
    const root = selectContentRoot(documentRef, adapter, { elementsByRoot });
    const elements = elementsByRoot.get(root) || collectContentElements(root, adapter);
    const records = stripArticleTitleHeading(
      buildRecordsFromElements(elements),
      documentRef?.title || ''
    );
    if (options.markElements !== false) {
      records.forEach(record => {
        if (record.recordType !== 'body') return;
        const element = elements[record.sourceIndex];
        if (element?.dataset) element.dataset.sciLlmParagraphId = record.paragraphId;
      });
    }
    return { root, elements, records };
  }

  function markRootExtraction(extraction) {
    extraction.records.forEach(record => {
      if (record.recordType !== 'body') return;
      const element = extraction.elements[record.sourceIndex];
      if (element?.dataset) element.dataset.sciLlmParagraphId = record.paragraphId;
    });
  }

  function buildArticleStructureFromRecords(documentRef, records, options = {}) {
    const dynamicShared = typeof globalThis === 'undefined' ? null : globalThis.SciLLM;
    const buildStructure = shared.buildArticleStructure || dynamicShared?.buildArticleStructure;
    if (typeof buildStructure !== 'function') {
      throw new Error('Article structure module must be loaded before extraction');
    }
    const locationLike = options.locationLike || documentRef?.location || {};
    const adapter = options.adapter || (typeof shared.selectPublisherAdapter === 'function'
      ? shared.selectPublisherAdapter(locationLike, documentRef)
      : { id: 'generic', family: 'generic' });
    return buildStructure(recordsToStructureInput(
      Array.isArray(records) ? records : [],
      documentRef,
      adapter,
      options.strategy || 'cached-records',
      options.diagnostics || {}
    ));
  }

  function buildArticleIndexFromRecords(documentRef, records, options = {}) {
    const typedRecords = Array.isArray(records) ? records : [];
    // Figure extraction is loaded independently and may arrive after this
    // module, so resolve its shared entry point only when the index is built.
    const dynamicShared = typeof globalThis === 'undefined' ? null : globalThis.SciLLM;
    const extractFiguresFromRecords = shared.extractArticleFiguresFromRecords ||
      dynamicShared?.extractArticleFiguresFromRecords;
    if (typeof extractFiguresFromRecords !== 'function') {
      throw new Error('Figure extractor module must be loaded before building an article index');
    }
    return {
      typedRecords,
      structure: buildArticleStructureFromRecords(documentRef, typedRecords, options),
      figures: extractFiguresFromRecords(documentRef, typedRecords, options)
    };
  }

  function extractArticleStructure(documentRef, options = {}) {
    return withSourceReadCache(() => readArticleStructure(documentRef, options));
  }

  function readArticleStructure(documentRef, options = {}) {
    const locationLike = options.locationLike || documentRef?.location || {};
    const adapter = typeof shared.selectPublisherAdapter === 'function'
      ? shared.selectPublisherAdapter(locationLike, documentRef)
      : { id: 'generic', family: 'generic' };
    if (isLikelyNonArticleChallenge(documentRef)) {
      return buildArticleStructureFromRecords(documentRef, [], {
        locationLike,
        adapter,
        strategy: 'non-article',
        diagnostics: { warnings: ['NON_ARTICLE_CHALLENGE'] }
      });
    }
    const outlineEntries = collectOutlineEntries(documentRef, adapter);
    const outlinedRecords = extractArticleFromOutline(documentRef, {
      adapter,
      entries: outlineEntries
    });
    const rootExtraction = extractArticleFromRoot(documentRef, adapter, {
      markElements: false
    });
    const useOutline = outlineRecordsAreReliable(
      outlinedRecords,
      rootExtraction.records
    );
    if (!useOutline) markRootExtraction(rootExtraction);
    const records = useOutline ? outlinedRecords : rootExtraction.records;
    const outlineCoverage = outlineCoverageForRecords(
      outlineEntries,
      records
    );
    const structure = buildArticleStructureFromRecords(documentRef, records, {
      locationLike,
      adapter,
      strategy: useOutline ? 'outline-anchors' : 'root-scoring',
      diagnostics: {
        ...outlineCoverage
      }
    });
    return structure;
  }

  function prepareReviewOutlineParagraphs(records, options = {}) {
    const source = Array.isArray(records) ? records : [];
    const hasExplicitBodySection = source.some(record => {
      const title = String(record?.sectionTitle || '').trim();
      return title && !/^article$/i.test(title) &&
        !isReviewUtilitySectionTitle(title) &&
        !['table-caption', 'figure-caption'].includes(record?.kind);
    });
    const seen = new Set();
    const prepared = [];

    source.forEach(record => {
      if (!record || record.recordType === 'reference' ||
          ['table-caption', 'figure-caption', 'reference'].includes(record.kind)) return;
      const text = normalizeTextWithOffsets(record.text).text;
      if (!text || REVIEW_UTILITY_TEXT.test(text)) return;
      const immediateTitle = String(record.sectionTitle || '').trim();
      const genericArticle = /^article$/i.test(immediateTitle);
      if (isReviewUtilitySectionTitle(immediateTitle) &&
          !(genericArticle && !hasExplicitBodySection)) return;

      let headingPath = (Array.isArray(record.headingPath) ? record.headingPath : [])
        .filter(heading => {
          const title = String(heading?.title || '').trim();
          if (/^article$/i.test(title)) return !hasExplicitBodySection;
          return !isReviewUtilitySectionTitle(title);
        })
        .map(heading => ({ ...heading }));
      if (!headingPath.length && immediateTitle &&
          !isReviewUtilitySectionTitle(immediateTitle)) {
        headingPath = [{
          level: Math.min(6, Math.max(1, Number(record.headingLevel) || 1)),
          sectionId: String(record.sectionId || 'sec-article'),
          title: immediateTitle
        }];
      }
      if (!headingPath.length) return;
      const leaf = headingPath[headingPath.length - 1];
      const dedupeKey = `${leaf.sectionId}\n${text.toLowerCase()}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      prepared.push({
        ...record,
        sectionId: leaf.sectionId,
        sectionTitle: leaf.title,
        headingLevel: leaf.level,
        headingPath,
        text
      });
    });
    return prepared;
  }

  function describeRoot(root) {
    const tagName = String(root?.tagName || 'UNKNOWN').toUpperCase();
    const id = String(root?.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    const classNames = typeof root?.className === 'string'
      ? root.className.trim().split(/\s+/).filter(Boolean).slice(0, 4)
        .map(value => value.replace(/[^a-zA-Z0-9_-]/g, '')).filter(Boolean)
      : [];
    return `${tagName}${id ? `#${id}` : ''}${classNames.length ? `.${classNames.join('.')}` : ''}`;
  }

  function summarizeUnrecognizedTextBlocks(root, adapter = null) {
    if (!root?.querySelectorAll) return [];
    const recognized = new Set(collectContentElements(root, adapter));
    const candidates = [...root.querySelectorAll('*')].filter(element => {
      const role = element.getAttribute?.('role');
      if (!UNRECOGNIZED_BLOCK_TAGS.has(element.tagName) && role !== 'paragraph') return false;
      if (recognized.has(element)) return false;
      if (isExcludedContentElement(element, adapter)) return false;
      if (element.querySelector?.(STRUCTURAL_TEXT_SELECTOR)) return false;
      return normalizeTextWithOffsets(element.textContent).text.length >= 120;
    });
    const candidateSet = new Set(candidates);
    const leaves = candidates.filter(element => ![...(element.querySelectorAll?.('*') || [])]
      .some(descendant => candidateSet.has(descendant)));
    const grouped = new Map();
    leaves.forEach(element => {
      const label = describeRoot(element);
      const existing = grouped.get(label) || { root: label, count: 0, characterCount: 0 };
      existing.count += 1;
      existing.characterCount += String(element.textContent || '').length;
      grouped.set(label, existing);
    });
    return [...grouped.values()]
      .sort((first, second) => second.characterCount - first.characterCount)
      .slice(0, 8);
  }

  function diagnoseArticleExtraction(documentRef) {
    const adapter = typeof shared.selectPublisherAdapter === 'function'
      ? shared.selectPublisherAdapter(documentRef?.location || {})
      : null;
    if (isLikelyNonArticleChallenge(documentRef)) {
      return {
        version: EXTRACTOR_VERSION,
        strategy: 'non-article',
        candidateCount: 0,
        selectedRoot: 'NON_ARTICLE_CHALLENGE',
        candidates: [],
        selected: {
          recordCount: 0,
          paragraphCount: 0,
          figureCaptionCount: 0,
          tableCaptionCount: 0,
          characterCount: 0
        },
        warnings: ['NON_ARTICLE_CHALLENGE'],
        unrecognizedTextBlockCount: 0,
        unrecognizedCharacterCount: 0,
        unrecognizedTextBlocks: []
      };
    }
    const candidates = getContentRootCandidates(documentRef, adapter);
    const rootExtraction = extractArticleFromRoot(documentRef, adapter, {
      markElements: false
    });
    const root = rootExtraction.root;
    const outlinedRecords = extractArticleFromOutline(documentRef, {
      markElements: false,
      adapter
    });
    const rootRecords = rootExtraction.records;
    const useOutline = outlineRecordsAreReliable(outlinedRecords, rootRecords);
    const strategy = useOutline ? 'outline-anchors' : 'root-scoring';
    const records = useOutline ? outlinedRecords : rootRecords;
    const unrecognizedTextBlocks = outlinedRecords.length
      ? []
      : summarizeUnrecognizedTextBlocks(root, adapter);
    return {
      version: EXTRACTOR_VERSION,
      strategy,
      candidateCount: candidates.length,
      selectedRoot: useOutline ? 'OUTLINE_ANCHORS' : describeRoot(root),
      candidates: candidates.map(candidate => ({
        root: describeRoot(candidate),
        score: scoreContentRoot(candidate, adapter),
        paragraphElementCount: collectContentElements(candidate, adapter)
          .filter(element => element.tagName === 'P').length,
        figureCaptionElementCount: collectContentElements(candidate, adapter)
          .filter(element => element.tagName === 'FIGCAPTION').length
      })),
      selected: {
        ...summarizeArticleRecords(records),
        paragraphCount: summarizeArticleRecords(records).bodyParagraphCount
      },
      unrecognizedTextBlockCount: unrecognizedTextBlocks
        .reduce((sum, item) => sum + item.count, 0),
      unrecognizedCharacterCount: unrecognizedTextBlocks
        .reduce((sum, item) => sum + item.characterCount, 0),
      unrecognizedTextBlocks
    };
  }

  function extractArticleAuthorMetadata(documentRef) {
    const clean = (value, max = 1800) => String(value || '').normalize('NFKC')
      .replace(/\s+/gu, ' ').trim().slice(0, max);
    const all = (scope, selector, limit = 200) =>
      Array.from(scope?.querySelectorAll?.(selector) || []).slice(0, limit);
    const text = node => clean(node?.getAttribute?.('content') || node?.textContent);
    const canonical = value => {
      if (typeof value !== 'string' || !value.trim()) return '';
      try {
        const url = new URL(value, documentRef?.location?.href);
        for (const key of [...url.searchParams.keys()]) {
          if (/^(?:utm_|fbclid$|gclid$)/iu.test(key)) url.searchParams.delete(key);
        }
        url.searchParams.sort();
        return /^https?:$/u.test(url.protocol) ? `${url.origin}${url.pathname}${url.search}` : '';
      }
      catch (_) { return ''; }
    };
    const sourceUrl = canonical(documentRef?.querySelector?.('link[rel="canonical"]')?.href ||
      documentRef?.location?.href);
    const title = clean(documentRef?.querySelector?.('meta[name="citation_title"]')?.content || documentRef?.title);
    const authors = [];
    const notes = [];
    const byName = new Map();
    let truncated = false;
    const add = (name, affiliations = [], corresponding = null, source = '') => {
      name = clean(name, 200);
      if (!name) return null;
      const key = name.toLocaleLowerCase();
      let author = byName.get(key);
      if (!author) {
        if (authors.length >= 200) { truncated = true; return null; }
        author = { name, affiliations: [], corresponding: null, source };
        authors.push(author); byName.set(key, author);
      }
      for (const affiliation of affiliations) {
        const value = clean(affiliation, 500);
        if (value && !author.affiliations.includes(value) && author.affiliations.length < 12) {
          author.affiliations.push(value);
        }
      }
      if (corresponding === true) author.corresponding = true;
      return author;
    };
    const note = (value, source, kind) => {
      const content = clean(value);
      if (!content || notes.some(item => item.text === content)) return;
      if (notes.length >= 30) { truncated = true; return; }
      notes.push({ text: content, source: clean(source, 160), kind });
    };
    const correspondence = value => /\bcorrespond(?:ence|ing author)s?\b|通讯作者|通信作者/iu.test(value);
    const articleOwnerSelector = 'article,[itemtype*="Article"],' +
      '[typeof~="Article"],[typeof~="ScholarlyArticle"],[typeof~="MedicalScholarlyArticle"]';
    const authorContext = node => {
      const article = node?.closest?.(articleOwnerSelector);
      const url = canonical(article?.getAttribute?.('itemid') ||
        article?.getAttribute?.('about') || article?.getAttribute?.('resource'));
      const headline = text(all(article, '[itemprop~="headline"],[property~="headline"]')
        .find(value => value.closest?.(articleOwnerSelector) === article));
      const related = node?.closest?.('.related-articles,.recommended,.citation,.citation-content,' +
        '[class*="related-content" i],[class*="recommendation" i]');
      return { url, headline, foreign: Boolean(related || (url && url !== sourceUrl) ||
        (!url && headline && title && headline !== title)) };
    };
    const rdfaRoleText = node => {
      const ignored = '[property~="affiliation"],[typeof~="Organization"],' +
        '[property~="email"],a[href^="mailto:"],[property~="givenName"],' +
        '[property~="familyName"],[property~="name"],[property~="identifier"],' +
        'script,style,noscript,template';
      if (node.matches?.(ignored)) return '';
      // Read folded cards without altering them. Email addresses, person
      // names and institution names are not correspondence-role evidence.
      const copy = node.cloneNode(true);
      for (const value of all(copy,
        `[property~="author"],[itemprop~="author"],${ignored}`, Infinity)) value.remove();
      const walker = documentRef.createTreeWalker(copy, 4);
      const fragments = [];
      let fragment;
      let length = 0;
      while (length < 1800 && (fragment = walker.nextNode())) {
        const value = clean(fragment.nodeValue);
        fragments.push(value);
        length += value.length + 1;
      }
      // Adjacent block labels in Cell have no textContent whitespace.
      return clean(fragments.join(' '));
    };
    // Citation institutions do not specify an author relation. Keep them as
    // unassigned notes instead of guessing from the order of separate tags.
    all(documentRef, 'meta[name="citation_author"]', 201).forEach(node =>
      add(node.content, [], null, 'citation_author'));
    all(documentRef, 'meta[name="citation_author_institution"]').forEach(node =>
      note(node.content, 'citation_author_institution (author mapping unspecified)', 'affiliation'));

    const objects = [];
    for (const script of all(documentRef, 'script[type="application/ld+json"]', 8)) {
      if (String(script.textContent || '').length > 500000) { truncated = true; continue; }
      try {
        const parsed = JSON.parse(script.textContent);
        const values = Array.isArray(parsed) ? parsed : [parsed];
        for (const value of values.slice(0, 200)) {
          if (value && typeof value === 'object') {
            objects.push(value, ...(Array.isArray(value['@graph']) ? value['@graph'].slice(0, 200) : []));
          }
        }
      } catch (_) { /* Malformed structured metadata is not executable content. */ }
    }
    const refs = new Map(objects.filter(item => item?.['@id']).map(item => [item['@id'], item]));
    const resolve = item => typeof item === 'string' ? (refs.get(item) || item)
      : item?.['@id'] && refs.has(item['@id']) ? { ...refs.get(item['@id']), ...item } : item;
    const array = value => Array.isArray(value) ? value : value == null ? [] : [value];
    const articles = objects.filter(item => array(item?.['@type']).some(type =>
      /^(?:ScholarlyArticle|MedicalScholarlyArticle|Article)$/u.test(type)));
    for (const article of articles) {
      const url = canonical(article.url || article['@id']);
      const headline = clean(article.headline || article.name);
      if (url && url !== sourceUrl) continue;
      if (!(url && url === sourceUrl) && !(headline && headline === title) &&
          !(articles.length === 1 && !url && !headline)) continue;
      for (const raw of array(article.author).slice(0, 200)) {
        const role = resolve(raw);
        const person = resolve(role?.author || role);
        const name = typeof person === 'string' ? person
          : person?.name || [person?.givenName, person?.familyName].filter(Boolean).join(' ');
        const affiliations = array(person?.affiliation).map(value => {
          const entry = resolve(value); return typeof entry === 'string' ? entry : entry?.name;
        });
        add(name, affiliations, correspondence(clean(role?.roleName)) ? true : null, 'json-ld');
      }
    }
    for (const node of all(documentRef,
      '[itemprop~="author"],[property~="author"][typeof~="Person"]', 201)) {
      const rdfa = node.matches?.('[property~="author"][typeof~="Person"]') === true;
      const ownRdfa = selector => all(node, selector).filter(value =>
        value.closest?.('[property~="author"],[itemprop~="author"]') === node);
      const rdfaName = property => text(ownRdfa(`[property~="${property}"]`).find(value =>
        !value.closest?.('[property~="affiliation"],[typeof~="Organization"]') &&
        value.closest?.('[typeof~="Person"]') === node));
      const nameNode = node.querySelector?.('[itemprop~="name"]');
      const givenName = rdfa ? rdfaName('givenName') : '';
      const familyName = rdfa ? rdfaName('familyName') : '';
      const name = rdfa
        ? (givenName && familyName ? `${givenName} ${familyName}`
          : rdfaName('name') || givenName || familyName)
        : text(nameNode) || text(node);
      if (!name) continue;
      const { url: articleUrl, headline, foreign } = authorContext(node);
      if (foreign) continue;
      if (!byName.has(clean(name, 200).toLocaleLowerCase()) &&
          !(articleUrl && articleUrl === sourceUrl) && !(headline && headline === title)) continue;
      const affiliationText = value => rdfa
        ? text(all(value, '[property~="name"]').find(name =>
          name.closest?.('[property~="affiliation"]') === value)) || text(value)
        : text(value);
      const affiliations = (rdfa ? ownRdfa('[property~="affiliation"]')
        : all(node, '[itemprop~="affiliation"]')).map(affiliationText);
      let isCorresponding = correspondence(rdfa ? rdfaRoleText(node) : text(node));
      for (const link of all(node, 'a[href^="#"]', 30)) {
        if (rdfa && link.closest?.('[property~="author"],[itemprop~="author"]') !== node) continue;
        const id = String(link.getAttribute('href') || '').slice(1);
        const target = documentRef?.getElementById?.(id);
        if (!target || authorContext(target).foreign) continue;
        const targetAuthor = rdfa
          ? target.closest?.('[property~="author"],[itemprop~="author"]') : null;
        if (targetAuthor && targetAuthor !== node) continue;
        const content = text(target);
        if (correspondence(rdfa ? rdfaRoleText(target) : content)) {
          isCorresponding = true;
          note(content, `#${id}`, 'correspondence');
        } else if (/^aff(?:iliation)?[-_\d]/iu.test(id) ||
          target.matches?.('[itemprop~="affiliation"],[property~="affiliation"]')) {
          affiliations.push(affiliationText(target));
        }
      }
      add(name, affiliations, isCorresponding ? true : null, rdfa ? 'rdfa' : 'microdata');
    }
    // Folded correspondence notes are page evidence too. Preserve their exact
    // labels; the model must not infer a corresponding author from an email alone.
    for (const node of all(documentRef, '[id^="cor"], [role="doc-footnote"]', 100)) {
      if (authorContext(node).foreign) continue;
      const content = text(node);
      if (correspondence(content)) note(content, node.id ? `#${node.id}` : 'doc-footnote', 'correspondence');
    }
    return { sourceUrl, authors, notes, truncated };
  }

  function extractArticle(documentRef, options = {}) {
    return withSourceReadCache(() => readArticleRecords(documentRef, options));
  }

  function readArticleRecords(documentRef, options = {}) {
    if (isLikelyNonArticleChallenge(documentRef)) return [];
    const adapter = options.adapter || (
      typeof shared.selectPublisherAdapter === 'function'
        ? shared.selectPublisherAdapter(documentRef?.location || {})
        : null
    );
    const outlinedRecords = extractArticleFromOutline(documentRef, { adapter });
    const rootExtraction = extractArticleFromRoot(documentRef, adapter, {
      markElements: false
    });
    if (outlineRecordsAreReliable(outlinedRecords, rootExtraction.records)) {
      return options.includeTyped === true
        ? outlinedRecords
        : outlinedRecords.filter(record => record.recordType === 'body');
    }
    markRootExtraction(rootExtraction);
    return options.includeTyped === true
      ? rootExtraction.records
      : rootExtraction.records.filter(record => record.recordType === 'body');
  }

  function isArticleExtractionCacheReusable(records) {
    return Array.isArray(records) && records.some(record => record?.recordType === 'body' &&
      typeof record.text === 'string' && record.text.trim().length > 0);
  }

  function isArticleSourceMutationExcluded(node, adapter = null, boundary = null) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    const selector = EXCLUDED_ANCESTOR_SELECTOR.split(',').filter(value => value.trim() !== 'figure').join(',');
    // A removed subtree may already be attached to a new, excluded owner.
    // Only matches inside the original removed root describe its source contents.
    const owned = match => Boolean(match && (!boundary || match === boundary || boundary.contains?.(match)));
    if (owned(closestSafely(element, selector))) return true;
    return (adapter?.excludedSelectors || []).some(value => value.trim() !== 'figure' &&
      owned(closestSafely(element, value)));
  }

  async function waitForArticleSourceStable({ getReadyState, getIdentity, getMutationTime,
    now = () => Date.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)), maxWaitMs = 1500 } = {}) {
    const identity = getIdentity();
    const duration = Math.min(2000, Math.max(0, Number(maxWaitMs) || 0));
    const started = now();
    const failure = (code, reasonCode) => Object.assign(new Error(reasonCode), { code, reasonCode });
    for (let attempt = 0; attempt <= Math.ceil(duration / 100); attempt++) {
      if (!identity || getIdentity() !== identity) throw failure('ARTICLE_WORKSPACE_CONTEXT_CHANGED', 'ARTICLE_SOURCE_CONTEXT_CHANGED');
      const browserReady = ['interactive', 'complete'].includes(getReadyState());
      const mutationTime = Number(getMutationTime());
      const quiet = Number.isFinite(mutationTime) && now() - mutationTime >= 300;
      if (browserReady && quiet) return Object.freeze({ ready: true, elapsedMs: Math.max(0, now() - started) });
      if (now() - started >= duration || attempt === Math.ceil(duration / 100)) {
        throw failure('ARTICLE_PAGE_LOADING', browserReady ? 'ARTICLE_BODY_UNSTABLE' : 'ARTICLE_BROWSER_LOADING');
      }
      await wait(Math.min(100, Math.max(0, duration - (now() - started))));
    }
  }

  function createArticleReadinessCompletionNotifier({ documentRef, windowRef,
    isWaiting, getIdentity, notify, schedule = (callback, delay) => setTimeout(callback, delay),
    cancelSchedule = token => clearTimeout(token) } = {}) {
    let timer = null, pendingIdentity = '', notifiedIdentity = '', destroyed = false;
    function onReady() {
      if (destroyed || !isWaiting() || !['interactive', 'complete'].includes(documentRef.readyState)) return;
      const identity = getIdentity();
      if (!identity || identity === notifiedIdentity) return;
      pendingIdentity = identity;
      if (timer !== null) return;
      timer = schedule(async () => {
        timer = null;
        const expected = pendingIdentity;
        if (destroyed || !isWaiting() || getIdentity() !== expected || documentRef.readyState === 'loading') return;
        notifiedIdentity = expected;
        try { await notify(expected); } catch (_) { /* One bounded signal; manual retry stays available. */ }
      }, 300);
    }
    documentRef?.addEventListener?.('readystatechange', onReady);
    windowRef?.addEventListener?.('load', onReady);
    return Object.freeze({ onReady, destroy() {
      destroyed = true;
      if (timer !== null) cancelSchedule(timer);
      documentRef?.removeEventListener?.('readystatechange', onReady);
      windowRef?.removeEventListener?.('load', onReady);
    } });
  }

  return {
    isArticleExtractionCacheReusable,
    isArticleSourceMutationExcluded,
    waitForArticleSourceStable,
    createArticleReadinessCompletionNotifier,
    isExcludedSectionHeading,
    isNavigableArticleSectionHeading,
    classifyMajorSectionHeading,
    isHeadingElement,
    getHeadingLevel,
    isReviewUtilitySectionTitle,
    isReviewUtilityParagraphText,
    isSupplementalMediaParagraphText,
    isLikelyInlineReferenceFlyoutText,
    buildParagraphRecords,
    hashNormalizedText,
    summarizeArticleRecords,
    normalizeTextWithOffsets,
    isScientificInlineTextExcluded,
    scientificInlineText,
    articleCaptionSource,
    collectArticleCaptionSources,
    immersiveTranslationTexts,
    bilingualHeadingDisplayText,
    collectContentElements,
    scoreContentRoot,
    selectContentRoot,
    summarizeUnrecognizedTextBlocks,
    diagnoseArticleExtraction,
    extractArticleFromOutline,
    outlineRecordsAreReliable,
    extractArticle,
    extractArticleAuthorMetadata,
    buildArticleStructureFromRecords,
    buildArticleIndexFromRecords,
    extractArticleStructure,
    prepareReviewOutlineParagraphs
  };
});
