(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const PUBLISHER_ADAPTER_VERSION = '3';

  const COMMON = Object.freeze({
    articleRootSelectors: [
      'article', 'main', '[role="main"]', '#article-body', '#body',
      '.article-body', '.article__body', '.Body', '[data-testid="article-body"]'
    ],
    outlineRootSelectors: [
      'nav[aria-label*="article" i]', 'nav[aria-label*="content" i]',
      '[class*="outline" i]', '[class*="table-of-content" i]',
      '[class*="toc" i]', '[id*="outline" i]', '[id*="toc" i]'
    ],
    outlineLinkSelectors: [
      'a[href^="#"]', 'a[href*="#sec"]', 'a[href*="#section"]',
      'a[data-target]', 'button[data-target]'
    ],
    headingSelectors: [
      'h1,h2,h3,h4,h5,h6', '[role="heading"]',
      '.section-title', '.section__title', '.article-section-title'
    ],
    paragraphSelectors: [
      'p', 'li', '[role="paragraph"]'
    ],
    excludedSelectors: [
      'nav', 'aside', 'footer', 'form', 'figure', '[hidden]', '[aria-hidden="true"]',
      '.citation', '.citation-content', '.advertisement',
      '.related-articles', '.recommended', '.comments', '.social-share',
      '.article-tools', '.article-header-actions'
    ],
    stabilitySelectors: ['article', '#article-body', '#body', '.article-body']
  });

  function list(...groups) {
    return [...new Set(groups.flat().filter(Boolean))].slice(0, 40);
  }

  function createAdapter(input) {
    const result = {
      id: input.id,
      family: input.family,
      hostPatterns: Object.freeze([...(input.hostPatterns || [])]),
      specificArticleRootSelectors: Object.freeze(list(
        input.specificArticleRootSelectors || input.articleRootSelectors
      )),
      articleRootSelectors: Object.freeze(list(
        input.articleRootSelectors, COMMON.articleRootSelectors
      )),
      outlineRootSelectors: Object.freeze(list(
        input.outlineRootSelectors, COMMON.outlineRootSelectors
      )),
      outlineLinkSelectors: Object.freeze(list(
        input.outlineLinkSelectors, COMMON.outlineLinkSelectors
      )),
      headingSelectors: Object.freeze(list(
        input.headingSelectors, COMMON.headingSelectors
      )),
      paragraphSelectors: Object.freeze(list(
        input.paragraphSelectors, COMMON.paragraphSelectors
      )),
      excludedSelectors: Object.freeze(list(
        input.excludedSelectors, COMMON.excludedSelectors
      )),
      stabilitySelectors: Object.freeze(list(
        input.stabilitySelectors, COMMON.stabilitySelectors
      ))
    };
    return Object.freeze(result);
  }

  const PDF_WORKSPACE_ADAPTER = createAdapter({
    id: 'brevess-pdf-workspace', family: 'pdf-workspace',
    hostPatterns: [/$a/],
    specificArticleRootSelectors: ['#pdfReaderArticle', '.pdf-reader-article'],
    articleRootSelectors: ['#pdfReaderArticle', '.pdf-reader-article'],
    headingSelectors: ['.pdf-reader-article h1', '.pdf-reader-article h2',
      '.pdf-reader-article h3', '.pdf-reader-article h4'],
    paragraphSelectors: ['.pdf-reader-article p', '.pdf-reader-article li',
      '.pdf-reader-article blockquote'],
    excludedSelectors: ['.pdf-reader-toolbar', '.pdf-reader-control',
      '.pdf-original-viewer'],
    stabilitySelectors: ['#pdfReaderArticle[data-brevess-pdf-article="true"]']
  });

  const PUBLISHER_ADAPTERS = Object.freeze([
    createAdapter({
      id: 'elsevier-sciencedirect', family: 'elsevier',
      hostPatterns: [
        /(^|\.)sciencedirect\.com$/, /(^|\.)cell\.com$/,
        /(^|\.)thelancet\.com$/
      ],
      specificArticleRootSelectors: [
        '#body', '.Body', '[data-aa-name="article-body"]', '.article__sections'
      ],
      articleRootSelectors: [
        '#body', '.Body', '.article-body', '[data-aa-name="article-body"]',
        '.article__sections'
      ],
      outlineRootSelectors: [
        '[data-aa-name*="outline" i]', '.outline-panel', '.article-outline',
        '[class*="Outline" i]'
      ],
      headingSelectors: [
        '.section-title', '.section__title', '.article-section-title',
        '[data-aa-name*="section-title" i]'
      ],
      paragraphSelectors: [
        '.section-paragraph', '.article-section p', '.Body p'
      ],
      excludedSelectors: [
        '.video-player',
        '.video-playback',
        '.video-player-modal',
        '.video-content',
        '.video-caption',
        '.video-description',
        '.supplementary-video',
        '[class*="supplement"][class*="video"]',
        '[class*="video"][class*="caption"]',
        '[class*="video"][class*="description"]',
        '.keyboard-shortcuts-modal',
        '.download-options-modal',
        '.transcript-panel',
        '[data-aa-name*="accessibility" i]',
        '[data-aa-name*="download-options" i]',
        '[data-aa-name*="supplementary-video" i]',
        '[data-aa-name*="video-caption" i]',
        '[data-aa-name*="video-description" i]',
        '[data-aa-name*="transcript" i]'
      ],
      stabilitySelectors: ['#body', '.Body', '.article__sections']
    }),
    createAdapter({
      id: 'springer-nature', family: 'springer-nature',
      hostPatterns: [
        /(^|\.)nature\.com$/, /(^|\.)springer\.com$/,
        /(^|\.)biomedcentral\.com$/
      ],
      articleRootSelectors: [
        '#article-body', '.c-article-body', '.main-content',
        '[data-test="article-body"]'
      ],
      outlineRootSelectors: ['.c-article-table-of-contents', '.article-toc'],
      headingSelectors: ['.c-article-section__title', '.c-article__title'],
      paragraphSelectors: ['.c-article-section__content p'],
      excludedSelectors: [
        '.c-article-header', '.c-article-author-list', '.c-article-metrics',
        '.c-article-access', '.c-article-related', '[data-test*="access" i]',
        '[data-test*="related" i]', '[data-test*="recommend" i]',
        '[data-track-component*="related" i]',
        '[data-component*="related" i]'
      ],
      stabilitySelectors: ['#article-body', '.c-article-body']
    }),
    createAdapter({
      id: 'wiley-online-library', family: 'wiley',
      hostPatterns: [/(^|\.)onlinelibrary\.wiley\.com$/],
      articleRootSelectors: ['.article__body', '.article-section'],
      outlineRootSelectors: ['.article-table-of-contents', '.toc__section'],
      headingSelectors: ['.article-section__title', '.section__title'],
      paragraphSelectors: ['.article-section__content p'],
      stabilitySelectors: ['.article__body']
    }),
    createAdapter({
      id: 'oxford-academic', family: 'oup',
      hostPatterns: [/(^|\.)academic\.oup\.com$/],
      articleRootSelectors: ['.widget-ArticleFulltext', '.article-body'],
      outlineRootSelectors: ['.article-pager', '.table-of-contents'],
      headingSelectors: ['.widget-ArticleFulltext h2', '.widget-ArticleFulltext h3'],
      paragraphSelectors: ['.widget-ArticleFulltext p'],
      stabilitySelectors: ['.widget-ArticleFulltext']
    }),
    createAdapter({
      id: 'taylor-francis', family: 'taylor-francis',
      hostPatterns: [/(^|\.)tandfonline\.com$/],
      articleRootSelectors: ['.hlFld-Fulltext', '.article-body'],
      outlineRootSelectors: ['.tocList', '.article-nav'],
      headingSelectors: ['.NLM_sec_level_1', '.NLM_sec_level_2', '.section-heading'],
      paragraphSelectors: ['.hlFld-Fulltext p'],
      stabilitySelectors: ['.hlFld-Fulltext']
    }),
    createAdapter({
      id: 'plos', family: 'plos',
      hostPatterns: [/(^|\.)journals\.plos\.org$/],
      articleRootSelectors: ['#artText', '.article-text'],
      outlineRootSelectors: ['#artText .nav', '.article-toc'],
      headingSelectors: ['.title', '.heading'],
      paragraphSelectors: ['#artText p'],
      stabilitySelectors: ['#artText']
    }),
    createAdapter({
      id: 'frontiers', family: 'frontiers',
      hostPatterns: [/(^|\.)frontiersin\.org$/],
      articleRootSelectors: [
        'main.ArticleDetailsV4__main', '.JournalFullText', '.article-container'
      ],
      outlineRootSelectors: ['.JournalFullText__toc', '.article-toc'],
      headingSelectors: ['.JournalFullText h2', '.JournalFullText h3'],
      paragraphSelectors: ['.JournalFullText p'],
      stabilitySelectors: ['.JournalFullText']
    }),
    createAdapter({
      id: 'mdpi', family: 'mdpi',
      hostPatterns: [/(^|\.)mdpi\.com$/],
      articleRootSelectors: ['article.bright', '#html-body', '.article-content'],
      outlineRootSelectors: ['.art-toc', '.html-toc'],
      headingSelectors: ['.html-h2', '.html-h3', '.html-h4'],
      paragraphSelectors: ['.html-p', '.art-text p'],
      stabilitySelectors: ['article.bright', '#html-body', '.article-content']
    }),
    createAdapter({
      id: 'acs-publications', family: 'acs',
      hostPatterns: [/(^|\.)pubs\.acs\.org$/],
      specificArticleRootSelectors: ['.article_content'],
      articleRootSelectors: ['main.content.article', '.articleBody', '.article_content'],
      outlineRootSelectors: ['.articleTableOfContents', '.toc'],
      headingSelectors: ['.article_content-title', '.NLM_head'],
      paragraphSelectors: ['.articleBody p'],
      stabilitySelectors: ['.articleBody']
    }),
    createAdapter({
      id: 'rsc-publishing', family: 'rsc',
      hostPatterns: [/(^|\.)pubs\.rsc\.org$/],
      articleRootSelectors: ['#pnlArticleContent', '.article__body'],
      outlineRootSelectors: ['.article__toc', '#pnlArticleContentNav'],
      headingSelectors: ['.article_heading', '.a_heading'],
      paragraphSelectors: ['#pnlArticleContent p'],
      stabilitySelectors: ['#pnlArticleContent']
    }),
    createAdapter({
      id: 'science-aaas', family: 'aaas',
      hostPatterns: [/(^|\.)science\.org$/],
      articleRootSelectors: ['main.content', '.bodySection', '.article__body'],
      outlineRootSelectors: ['.article__toc', '.core-navigation'],
      headingSelectors: ['.section__title', '.bodySection h2'],
      paragraphSelectors: ['.bodySection p'],
      excludedSelectors: [
        '.core-authors', '.core-collateral', '#tab-contributors'
      ],
      stabilitySelectors: ['.bodySection', '.article__body']
    }),
    createAdapter({
      id: 'jama-network', family: 'jama',
      hostPatterns: [/(^|\.)jamanetwork\.com$/],
      articleRootSelectors: ['.article-full-text', '.article-content'],
      outlineRootSelectors: ['.article-navigation', '.article-toc'],
      headingSelectors: ['.article-section-title', '.section-title'],
      paragraphSelectors: ['.article-full-text p'],
      stabilitySelectors: ['.article-full-text']
    }),
    createAdapter({
      id: 'bmj', family: 'bmj',
      hostPatterns: [/(^|\.)bmj\.com$/],
      articleRootSelectors: ['.article-content', '#content'],
      outlineRootSelectors: ['.article-toc', '.highwire-markup'],
      headingSelectors: ['.highwire-cite-title', '.section-title'],
      paragraphSelectors: ['.article-content p'],
      stabilitySelectors: ['.article-content']
    }),
    createAdapter({
      id: 'nejm', family: 'nejm',
      hostPatterns: [/(^|\.)nejm\.org$/],
      articleRootSelectors: ['.o-article-body', '.article-body'],
      outlineRootSelectors: ['.m-article-nav', '.article-toc'],
      headingSelectors: ['.o-article-body h2', '.o-article-body h3'],
      paragraphSelectors: ['.o-article-body p'],
      stabilitySelectors: ['.o-article-body']
    }),
    createAdapter({
      id: 'pmc-jats', family: 'pmc-jats',
      hostPatterns: [/(^|\.)pmc\.ncbi\.nlm\.nih\.gov$/],
      articleRootSelectors: ['.jig-ncbiinpagenav', '.article', '#mc'],
      outlineRootSelectors: ['.fm-citation', '.jig-ncbiinpagenav'],
      headingSelectors: ['.sec-title', '.title'],
      paragraphSelectors: ['.sec p', '.article p'],
      stabilitySelectors: ['.article', '#mc']
    }),
    createAdapter({
      id: 'preprint', family: 'preprint',
      hostPatterns: [/(^|\.)biorxiv\.org$/, /(^|\.)medrxiv\.org$/],
      specificArticleRootSelectors: ['.highwire-markup'],
      articleRootSelectors: ['.article', '.article-content', '.highwire-markup'],
      outlineRootSelectors: ['.pane-highwire-article-navigation', '.article-toc'],
      headingSelectors: ['.highwire-markup h2', '.highwire-markup h3'],
      paragraphSelectors: ['.highwire-markup p'],
      stabilitySelectors: ['.highwire-markup', '.article-content']
    })
  ]);

  const GENERIC_ADAPTER = createAdapter({
    id: 'generic',
    family: 'generic',
    hostPatterns: [/$a/]
  });

  function selectPublisherAdapter(locationLike = {}) {
    const pathname = String(locationLike?.pathname || '').trim();
    if (/(?:^|\/)pdf-reader\.html$/i.test(pathname)) return PDF_WORKSPACE_ADAPTER;
    const hostname = String(locationLike?.hostname || '').trim().toLowerCase();
    return PUBLISHER_ADAPTERS.find(item =>
      item.hostPatterns.some(pattern => pattern.test(hostname))
    ) || GENERIC_ADAPTER;
  }

  return {
    PUBLISHER_ADAPTER_VERSION,
    PUBLISHER_ADAPTERS,
    PDF_WORKSPACE_ADAPTER,
    GENERIC_ADAPTER,
    selectPublisherAdapter
  };
});
