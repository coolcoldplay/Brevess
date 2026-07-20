(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const REFERENCE_SECTION = /^(references|bibliography|literature cited)\b/i;
  const EXCLUDED_SECTION = /^(?:references|bibliography|literature cited|keywords?|abbreviations?|acknowledg(?:e)?ments?|author information|information\s*&\s*authors|authors?(?:['’]s?)?\s+contributions?|credit authorship contribution statement|generative ai statement|declaration of ai use|funding|conflicts? of interest|competing interests?|declaration of competing interest|declaration of interests?|data availability|data and code availability|supplementary materials?|supplementary data|appendix\b.*supplementary data|footnotes?|ethics approval|institutional review board statement|informed consent statement|publisher['’]s note|disclosure statement)\b/i;
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
  const EXTRACTOR_VERSION = '2.1.0-extractor-r12';
  const UNRECOGNIZED_BLOCK_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'DD']);
  const EXCLUDED_ANCESTOR_SELECTOR =
    'nav,aside,footer,form,figure,[hidden],[aria-hidden="true"],.references,.bibliography,' +
    '.citation,.citation-content,.contributors,.advertisement,.related-articles,' +
    '.recommended,.comments,.social-share,.article-outline,.outline-panel,.table-of-contents,' +
    '.article-tools,.article-header-actions,.supplementary-materials';

  const REVIEW_UTILITY_SECTION = /^(?:article|outline|table of contents|tables?(?:\s+(?:\(\d+\)|\d+)(?:\..*)?)?|figures?(?:\s+(?:\(\d+\)|\d+)(?:\..*)?)?|extras?(?:\s*\(\d+\))?|keywords?|graphical abstract|highlights?|recommended articles?|related info links?|cited by(?:\s*\(\d+\))?|article metrics?|author information|information\s*&\s*authors|information|metrics\s*&\s*citations|view options|publication history|license summary\*?|subjects|article views|altmetric|citations|media|share|download(?:s| files?)?|show full outline|skip to\b.*)$/i;
  const REVIEW_UTILITY_TEXT = /^(?:show more|view pdf|download full issue|add to mendeley|share|cite|get rights and content|open access|no articles found\.?)$/i;
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
    return EXCLUDED_SECTION.test(String(text || '').trim());
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
    if (/^(?:abstract|summary)\b/.test(text)) return 'abstract';
    if (/^(?:introduction|background)\b/.test(text)) return 'introduction';
    if (/^(?:materials? and methods?|methods?|methodology|experimental procedures?)\b/.test(text)) {
      return 'methods';
    }
    if (/^(?:results?|findings?)\b/.test(text)) return 'results';
    if (/^(?:discussion)\b/.test(text)) return 'discussion';
    if (/^(?:conclusions?|concluding remarks?)\b/.test(text)) return 'conclusion';
    if (/^(?:limitations?|strengths? and limitations?)\b/.test(text)) return 'discussion';
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
    if (/^cite$/i.test(text)) return true;
    if (REFERENCE_SECTION.test(text) || EXCLUDED_SECTION.test(text)) return true;
    if (REVIEW_UTILITY_SECTION.test(text)) return true;
    return /^(?:review|research|original|clinical)\s*article$/i.test(text) ||
      (/^(?:review|research|original|clinical)\s*article/i.test(text) &&
        text.length > 20);
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

  function recordTypeForBlock(kind, referenceListReached) {
    if (referenceListReached || kind === 'reference') return 'reference';
    if (kind === 'figure-caption') return 'figure-caption';
    if (kind === 'table-caption') return 'table-caption';
    return 'body';
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
    let referenceListReached = false;
    const sectionOccurrences = new Map();
    const headingStack = [];
    const recordIndexes = new Map();

    blocks.forEach(block => {
      const text = normalizeTextWithOffsets(block.text).text;
      if (!text) return;
      if (block.kind === 'heading') {
        if (REFERENCE_SECTION.test(text)) {
          referenceListReached = true;
          excluded = false;
          sectionKind = 'reference';
          sectionTitle = text;
          const sectionSlug = slugifyHeading(text);
          const occurrence = (sectionOccurrences.get(sectionSlug) || 0) + 1;
          sectionOccurrences.set(sectionSlug, occurrence);
          sectionId = `sec-${sectionSlug}${occurrence > 1 ? `-${occurrence}` : ''}`;
          headingStack.length = 0;
          headingStack.push({
            level: Number.isInteger(block.level) ? block.level : 2,
            sectionId,
            title: sectionTitle,
            domId: String(block.domId || ''),
            dataSelector: String(block.dataSelector || ''),
            blockFingerprint: String(block.blockFingerprint || '')
          });
          index = 0;
          return;
        }
        if (referenceListReached) return;
        if (isReviewUtilitySectionTitle(text) && !isExcludedSectionHeading(text)) {
          return;
        }
        excluded = isExcludedSectionHeading(text);
        if (!excluded) {
          sectionKind = classifyMajorSectionHeading(text) || sectionKind;
          sectionTitle = text;
          const sectionSlug = slugifyHeading(text);
          const occurrence = (sectionOccurrences.get(sectionSlug) || 0) + 1;
          sectionOccurrences.set(sectionSlug, occurrence);
          sectionId = `sec-${sectionSlug}${occurrence > 1 ? `-${occurrence}` : ''}`;
          const level = Number.isInteger(block.level) && block.level >= 1 && block.level <= 6
            ? block.level : 2;
          while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
            headingStack.pop();
          }
          headingStack.push({
            level,
            sectionId,
            title: sectionTitle,
            domId: String(block.domId || ''),
            dataSelector: String(block.dataSelector || ''),
            blockFingerprint: String(block.blockFingerprint || '')
          });
          index = 0;
        }
        return;
      }
      if (excluded) return;
      const textHash = hashNormalizedText(text);
      const recordType = recordTypeForBlock(block.kind, referenceListReached);
      const explicitSourceIdentity = String(
        block.sourceKey || block.blockFingerprint || block.dataSelector || block.domId || ''
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
        sectionKind,
        headingLevel: headingStack.length
          ? headingStack[headingStack.length - 1].level : 1,
        headingPath: headingStack.length
          ? headingStack.map(item => ({ ...item }))
          : [{ level: 1, sectionId: 'sec-article', title: 'Article' }],
        kind: block.kind || 'paragraph',
        text,
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
    const adapterHeadings = new Set(
      (adapter?.headingSelectors || []).flatMap(selector =>
        queryAllSafely(root, selector))
    );
    const adapterParagraphs = new Set(
      (adapter?.paragraphSelectors || []).flatMap(selector =>
        queryAllSafely(root, selector))
    );
    const primaryElements = allElements.filter(element => {
      if (isExcludedContentElement(element, adapter)) return false;
      if (element.tagName === 'FIGCAPTION') return true;
      const adapterHeading = adapterHeadings.has(element) &&
        !PRIMARY_CONTENT_TAGS.has(element.tagName) &&
        element.tagName !== 'FIGCAPTION' &&
        !element.querySelector?.(SEMANTIC_HEADING_SELECTOR);
      const heading = isHeadingElement(element) || adapterHeading;
      if (heading) return !isEphemeralHeadingTitle(element.textContent);
      if (element.tagName === 'LI' &&
          element.querySelector?.('p,li,[role="paragraph"]')) return false;
      if (PRIMARY_CONTENT_TAGS.has(element.tagName)) return true;
      return adapterParagraphs.has(element) &&
        !element.querySelector?.(STRUCTURAL_TEXT_SELECTOR);
    });
    const supplementalCandidates = allElements.filter(element => {
      const role = element.getAttribute?.('role');
      const isTextContainer = UNRECOGNIZED_BLOCK_TAGS.has(element.tagName);
      if (!isTextContainer && role !== 'paragraph') return false;
      if (isExcludedContentElement(element, adapter)) return false;
      if (element.querySelector?.(STRUCTURAL_TEXT_SELECTOR)) return false;
      const text = normalizeTextWithOffsets(element.textContent).text;
      if (text.length < 40) return false;
      const wordCount = (text.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
      const hasSentencePunctuation = /[.!?。！？]/.test(text);
      return (wordCount >= 6 || /[\u3400-\u9fff]/.test(text)) &&
        (text.length >= 120 || hasSentencePunctuation);
    });
    const supplementalSet = new Set(supplementalCandidates);
    const supplementalLeaves = supplementalCandidates.filter(element =>
      ![...(element.querySelectorAll?.('*') || [])]
        .some(descendant => supplementalSet.has(descendant))
    );
    const selected = new Set([...primaryElements, ...supplementalLeaves]);
    return allElements.filter(element => selected.has(element));
  }

  function getBlockKind(element) {
    if (isHeadingElement(element)) return 'heading';
    if (element.tagName === 'FIGCAPTION') return 'figure-caption';
    if (element.tagName === 'CAPTION') return 'table-caption';
    return 'paragraph';
  }

  function scoreContentRoot(root, adapter = null) {
    const elements = collectContentElements(root, adapter);
    let score = 0;
    elements.forEach(element => {
      const text = normalizeTextWithOffsets(element.textContent).text;
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
    try {
      return element.closest(selector);
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

  function selectContentRoot(documentRef, adapter = null) {
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
      !best || scoreContentRoot(candidate, adapter) > scoreContentRoot(best, adapter)
        ? candidate : best
    ), null);
    if (bestSpecific && specificCandidates.length > 1) {
      const consolidated = candidates.reduce((best, candidate) => {
        const containedSpecificCount = specificCandidates.filter(fragment =>
          fragment === candidate || candidate?.contains?.(fragment)
        ).length;
        if (containedSpecificCount < 2) return best;
        const score = scoreContentRoot(candidate, adapter);
        if (!best || containedSpecificCount > best.containedSpecificCount ||
            (containedSpecificCount === best.containedSpecificCount && score > best.score)) {
          return { candidate, containedSpecificCount, score };
        }
        return best;
      }, null);
      if (consolidated && consolidated.score > scoreContentRoot(bestSpecific, adapter)) {
        return consolidated.candidate;
      }
    }
    if (bestSpecific) return bestSpecific;
    return candidates.reduce((best, candidate) => (
      !best || scoreContentRoot(candidate, adapter) > scoreContentRoot(best, adapter)
        ? candidate : best
    ), null) || documentRef.body;
  }

  function buildRecordsFromElements(elements) {
    const blocks = elements.map((element, sourceIndex) => ({
      kind: getBlockKind(element),
      level: isHeadingElement(element) ? getHeadingLevel(element) : 0,
      text: element.textContent,
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
      blockFingerprint: String(element.dataset?.sciLlmParagraphId || element.id || '')
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
    return /^(?:au|author|aff|affiliation|fn|footnote|xref|bib|ref|reference|fig|figure|tbl|table|note|correspondence)[-_]?\d*/i.test(id);
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

  function extractArticleFromOutline(documentRef, options = {}) {
    if (!documentRef?.querySelectorAll || !documentRef?.getElementById) return [];
    const adapter = options.adapter || (
      typeof shared.selectPublisherAdapter === 'function'
        ? shared.selectPublisherAdapter(documentRef?.location || {})
        : null
    );
    const links = [];
    const seenLinks = new Set();
    function appendLinks(items) {
      items.forEach(link => {
        if (!link || seenLinks.has(link)) return;
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
    (adapter?.outlineLinkSelectors || []).forEach(selector => {
      appendLinks(queryAllSafely(documentRef, selector));
    });
    appendLinks(queryAllSafely(documentRef, OUTLINE_LINK_SELECTOR));
    if (links.length < 3) {
      appendLinks(queryAllSafely(documentRef, 'a[href^="#"]'));
    }
    const seenTargets = new Set();
    const entries = [];
    links.forEach(link => {
      const targetId = outlineTargetId(link);
      const target = targetId ? documentRef.getElementById(targetId) : null;
      if (!target || seenTargets.has(target)) return;
      const title = normalizeTextWithOffsets(link.textContent).text;
      if (!title || title.length > 500) return;
      if (isNonSectionOutlineEntry(targetId, title)) return;
      const root = outlineContentRoot(target);
      if (!root) return;
      seenTargets.add(target);
      entries.push({ targetId, target, root, link, title });
    });
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
        const headingKey = normalizedHeadingKey(element.textContent);
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
        domId: String(matchingHeading?.id || entry.target?.id || entry.targetId || ''),
        dataSelector: headingDataSelector,
        blockFingerprint: String(entry.targetId || matchingHeading?.id || '')
      });
      content.forEach(element => {
        if (isHeadingElement(element)) {
          blocks.push({
            kind: 'heading',
            level: getHeadingLevel(element),
            text: element.textContent,
            domId: String(element.id || ''),
            blockFingerprint: String(element.id || '')
          });
          return;
        }
        const kind = getBlockKind(element);
        if (!['paragraph', 'figure-caption', 'table-caption'].includes(kind)) return;
        const sourceIndex = sourceElements.length;
        sourceElements.push(element);
        blocks.push({
          kind,
          level: 0,
          text: element.textContent,
          sourceIndex,
          domId: String(element.id || ''),
          sourceKey: String(
            element.dataset?.sciLlmSourceKey ||
            element.getAttribute?.('data-section-id') ||
            element.getAttribute?.('data-id') ||
            element.id || ''
          ),
          blockFingerprint: String(element.id || '')
        });
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
      const sectionId = String(record?.sectionId || '');
      if (sectionId && !firstRecordBySection.has(sectionId)) {
        firstRecordBySection.set(sectionId, record);
      }
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
      textHash: record.textHash,
      recordType: record.recordType,
      sectionTitle: record.sectionTitle,
      sectionPath: (record.headingPath || []).map(item => ({
        level: item.level,
        sectionId: item.sectionId,
        title: item.title
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
    if (rootTitles.length >= 6) {
      const coveredRootTitles = rootTitles.filter(rootTitle =>
        titles.some(outlineTitle =>
          outlineTitle === rootTitle ||
          outlineTitle.includes(rootTitle) ||
          rootTitle.includes(outlineTitle)
        )
      );
      const missingRootTitles = rootTitles.length - coveredRootTitles.length;
      const rootCoverage = coveredRootTitles.length / rootTitles.length;
      if (missingRootTitles >= 3 && rootCoverage < 0.8) return false;
    }
    return true;
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
    const root = selectContentRoot(documentRef, adapter);
    const elements = collectContentElements(root, adapter);
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
    if (typeof shared.buildArticleStructure !== 'function') {
      throw new Error('Article structure module must be loaded before extraction');
    }
    const locationLike = options.locationLike || documentRef?.location || {};
    const adapter = options.adapter || (typeof shared.selectPublisherAdapter === 'function'
      ? shared.selectPublisherAdapter(locationLike, documentRef)
      : { id: 'generic', family: 'generic' });
    return shared.buildArticleStructure(recordsToStructureInput(
      Array.isArray(records) ? records : [],
      documentRef,
      adapter,
      options.strategy || 'cached-records',
      options.diagnostics || {}
    ));
  }

  function extractArticleStructure(documentRef, options = {}) {
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
    const outlinedRecords = extractArticleFromOutline(documentRef, { adapter });
    const rootExtraction = extractArticleFromRoot(documentRef, adapter, {
      markElements: false
    });
    const useOutline = outlineRecordsAreReliable(
      outlinedRecords,
      rootExtraction.records
    );
    if (!useOutline) markRootExtraction(rootExtraction);
    const records = useOutline ? outlinedRecords : rootExtraction.records;
    const outlineEntryCount = documentRef?.querySelectorAll
      ? [...documentRef.querySelectorAll(OUTLINE_LINK_SELECTOR)].length : 0;
    const structure = buildArticleStructureFromRecords(documentRef, records, {
      locationLike,
      adapter,
      strategy: useOutline ? 'outline-anchors' : 'root-scoring',
      diagnostics: {
        outlineEntryCount,
        matchedOutlineEntryCount: useOutline
          ? new Set(outlinedRecords.map(item => item.sectionId)).size : 0
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

  function extractArticle(documentRef, options = {}) {
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

  return {
    isExcludedSectionHeading,
    classifyMajorSectionHeading,
    isHeadingElement,
    getHeadingLevel,
    isReviewUtilitySectionTitle,
    buildParagraphRecords,
    hashNormalizedText,
    summarizeArticleRecords,
    normalizeTextWithOffsets,
    collectContentElements,
    scoreContentRoot,
    selectContentRoot,
    summarizeUnrecognizedTextBlocks,
    diagnoseArticleExtraction,
    extractArticleFromOutline,
    extractArticle,
    buildArticleStructureFromRecords,
    extractArticleStructure,
    prepareReviewOutlineParagraphs
  };
});
