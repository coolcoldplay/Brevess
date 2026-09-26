(function attach(root, factory) {
  const tagsApi = typeof module === 'object' && module.exports
    ? require('./local-library-tags') : root.SciLLM || {};
  const bibliographyApi = typeof module === 'object' && module.exports
    ? require('./article-bibliography') : root.SciLLM || {};
  const saveEventsApi = typeof module === 'object' && module.exports
    ? require('./article-workspace-save') : root.SciLLM || {};
  const api = factory(root.SciLLM || {}, tagsApi, bibliographyApi, saveEventsApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared, tagsApi, bibliographyApi, saveEventsApi) {
  const MAX_TEXT = 2_000_000;
  const MAX_SOURCES = 20_000;
  const SEARCH_SCOPES = Object.freeze([
    'all', 'title', 'notes', 'fulltext', 'abstract', 'method', 'caption'
  ]);
  const TAGS_PATH = 'annotations/library-tags.json';
  const COVERAGE_SCOPES = ['notes', 'fulltext', 'abstract', 'method', 'caption'];

  function saveTimeFromAsset(workspace, asset) {
    const generation = workspace?.workspaceGeneration === undefined ? 1 : workspace.workspaceGeneration;
    if (!asset || asset.relativePath !== 'annotations/library-save-events.json' ||
        !Number.isSafeInteger(generation) || generation < 1 ||
        (asset.workspaceId !== undefined && asset.workspaceId !== workspace?.workspaceId) ||
        (asset.workspaceGeneration === undefined ? 1 : asset.workspaceGeneration) !== generation ||
        typeof saveEventsApi.normalizeLocalLibrarySaveEventsAsset !== 'function') return { savedAt: '' };
    const value = saveEventsApi.normalizeLocalLibrarySaveEventsAsset(asset.content, {
      workspaceId: workspace?.workspaceId, canonicalUrl: workspace?.canonicalUrl, workspaceGeneration: generation
    });
    return { savedAt: value?.lastSavedAt || '' };
  }

  function bibliographyFromAsset(workspace, asset) {
    const empty = { journal: '', publicationDate: '', publicationDatePrecision: '' };
    const generation = workspace?.workspaceGeneration === undefined ? 1 : workspace.workspaceGeneration;
    if (!asset || asset.relativePath !== 'article/bibliography.json' ||
        !Number.isSafeInteger(generation) || generation < 1 ||
        (asset.workspaceId !== undefined && asset.workspaceId !== workspace?.workspaceId) ||
        (asset.workspaceGeneration === undefined ? 1 : asset.workspaceGeneration) !== generation ||
        typeof bibliographyApi.normalizeArticleBibliographyAsset !== 'function') return empty;
    const value = bibliographyApi.normalizeArticleBibliographyAsset(asset.content, {
      workspaceId: workspace?.workspaceId, canonicalUrl: workspace?.canonicalUrl
    });
    if (!value) return empty;
    return { journal: value.journal.value, publicationDate: value.publicationDate.value,
      publicationDatePrecision: value.publicationDate.precision };
  }

  function tagsFromAsset(workspace, asset) {
    const generation = workspace?.workspaceGeneration === undefined ? 1
      : Number.isSafeInteger(workspace.workspaceGeneration) && workspace.workspaceGeneration > 0
        ? workspace.workspaceGeneration : null;
    const empty = { tags: [], tagRevision: 0, tagContentHash: '',
      workspaceGeneration: generation, tagState: 'missing', tagError: '' };
    if (!asset) return empty;
    const invalid = code => ({ ...empty, tagRevision: null,
      tagState: 'invalid', tagError: code });
    if (typeof tagsApi.normalizeLocalLibraryTagsAsset !== 'function') {
      return invalid('LOCAL_LIBRARY_TAGS_UNAVAILABLE');
    }
    if (!generation || asset.relativePath !== TAGS_PATH ||
        (asset.workspaceId !== undefined && asset.workspaceId !== workspace?.workspaceId) ||
        (asset.workspaceGeneration !== undefined && asset.workspaceGeneration !== generation) ||
        !Number.isSafeInteger(asset.revision) || asset.revision < 1 ||
        typeof asset.contentHash !== 'string' || !asset.contentHash || asset.contentHash.length > 200) {
      return invalid('LOCAL_LIBRARY_TAGS_ASSET_INVALID');
    }
    try {
      const value = tagsApi.normalizeLocalLibraryTagsAsset(asset.content,
        { workspaceId: workspace?.workspaceId });
      return { ...empty, tags: value.tags, tagRevision: asset.revision,
        tagContentHash: asset.contentHash, tagState: 'ready' };
    } catch (error) {
      return invalid(error?.code || 'LOCAL_LIBRARY_TAGS_ASSET_INVALID');
    }
  }

  function coverageTotals(articles) {
    return Object.fromEntries(COVERAGE_SCOPES.map(scope => [scope,
      articles.filter(article => article.coverage?.[scope]).length]));
  }

  function text(value, limit = MAX_TEXT) {
    return String(value || '').normalize('NFKC')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
      .replace(/\s+/gu, ' ').trim().slice(0, limit);
  }

  function values(value) {
    if (value instanceof Map) return [...value.entries()];
    return value && typeof value === 'object' ? Object.entries(value) : [];
  }

  function contentByPath(rawAssets) {
    const map = new Map();
    const source = Array.isArray(rawAssets) ? rawAssets : values(rawAssets).map(([, item]) => item);
    source.forEach(item => {
      const path = text(item?.relativePath || item?.path, 300);
      if (!path) return;
      const current = map.get(path);
      if (!current || Number(item?.revision || 0) >= Number(current?.revision || 0)) {
        map.set(path, item && Object.prototype.hasOwnProperty.call(item, 'content')
          ? item : { relativePath: path, content: item, revision: 0 });
      }
    });
    return map;
  }

  function sectionScope(paragraph) {
    const heading = text([
      paragraph?.sectionKind,
      paragraph?.sectionTitle,
      paragraph?.displaySectionTitle,
      ...(Array.isArray(paragraph?.headingPath)
        ? paragraph.headingPath.map(item => item?.title) : [])
    ].join(' '), 1000).toLocaleLowerCase('en-US');
    if (/(?:^|\b)(?:abstract|summary)(?:\b|$)|摘要|概要/u.test(heading)) return 'abstract';
    if (/(?:^|\b)(?:materials?\s+and\s+methods?|methods?|methodology|experimental\s+procedures?|star\s*methods?)(?:\b|$)|方法|实验步骤|材料与方法/u.test(heading)) return 'method';
    return '';
  }

  function pushSource(target, scope, value, label) {
    const normalized = text(value);
    if (!normalized || target.length >= MAX_SOURCES) return;
    target.push({ scope, text: normalized, label: text(label, 300) });
  }

  function collectObjectStrings(value, target, depth = 0, seen = new Set()) {
    if (target.length >= 2000 || depth > 6 || value == null) return;
    if (typeof value === 'string' || typeof value === 'number') {
      const normalized = text(value, 12000);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        target.push(normalized);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 2000).forEach(item => collectObjectStrings(item, target, depth + 1, seen));
      return;
    }
    if (typeof value !== 'object') return;
    Object.entries(value).slice(0, 2000).forEach(([key, item]) => {
      if (/^(?:dataUrl|image|images|raw|html|markdown|url|sourceUrl|contentHash|fingerprint)$/iu.test(key)) return;
      collectObjectStrings(item, target, depth + 1, seen);
    });
  }

  function collectNotes(byPath, sources) {
    const noteValues = [];
    const literature = byPath.get('annotations/literature-note.json')?.content;
    collectObjectStrings(literature?.valuesByTemplate, noteValues);
    const paragraphNotes = byPath.get('annotations/paragraph-notes.json')?.content?.notes;
    (Array.isArray(paragraphNotes) ? paragraphNotes : []).forEach(item => {
      pushSource(sources, 'notes', item?.note || item?.text || item?.value, '段落笔记');
    });
    const annotations = byPath.get('annotations/highlights.json')?.content?.annotations;
    (Array.isArray(annotations) ? annotations : []).forEach(item => {
      pushSource(sources, 'notes', item?.note, '高亮备注');
    });
    noteValues.forEach(value => pushSource(sources, 'notes', value, '文献笔记'));
  }

  function captionText(figure) {
    const parts = [figure?.caption, figure?.captionText, figure?.legend];
    (Array.isArray(figure?.captionBlocks) ? figure.captionBlocks : []).forEach(block =>
      parts.push(block?.text || block?.caption || block));
    return text(parts.filter(Boolean).join(' '));
  }

  function collectFigures(value, sources, seen = new Set(), depth = 0) {
    if (!value || depth > 7 || sources.length >= MAX_SOURCES) return;
    if (Array.isArray(value)) {
      value.slice(0, 2000).forEach(item => collectFigures(item, sources, seen, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;
    const caption = captionText(value);
    if (caption && !seen.has(caption)) {
      seen.add(caption);
      pushSource(sources, 'caption', caption,
        value.figureLabel || value.label || value.figureId || '图注');
    }
    ['figures', 'items', 'supplemental', 'materials'].forEach(key =>
      collectFigures(value[key], sources, seen, depth + 1));
  }

  function articleFromWorkspace(workspace, rawAssets) {
    const byPath = contentByPath(rawAssets);
    const sources = [];
    const structure = byPath.get('article/structure.json')?.content || {};
    const pdf = byPath.get('pdf/document.json')?.content || {};
    const title = text(workspace?.title || structure?.title || pdf?.title || '未命名文献', 1000);
    pushSource(sources, 'title', title, '标题');

    const paragraphsAsset = byPath.get('article/paragraphs.json');
    const paragraphs = paragraphsAsset?.content?.paragraphs;
    (Array.isArray(paragraphs) ? paragraphs : []).slice(0, MAX_SOURCES).forEach(paragraph => {
      const paragraphText = text(paragraph?.text || paragraph?.displayText);
      if (!paragraphText) return;
      pushSource(sources, 'fulltext', paragraphText,
        paragraph?.displaySectionTitle || paragraph?.sectionTitle || '正文');
      const specialized = sectionScope(paragraph);
      if (specialized) pushSource(sources, specialized, paragraphText,
        paragraph?.displaySectionTitle || paragraph?.sectionTitle || specialized);
    });
    if (!sources.some(source => source.scope === 'fulltext') && text(pdf?.markdown)) {
      pushSource(sources, 'fulltext', pdf.markdown, 'PDF 全文');
    }
    collectNotes(byPath, sources);
    collectFigures(byPath.get('figures/inventory.json')?.content, sources);
    for (const [path, asset] of byPath) {
      if (/^figures\/supplemental\/[^/]+\.json$/u.test(path)) {
        collectFigures(asset?.content, sources);
      }
    }

    const scopes = new Set(sources.map(item => item.scope));
    const url = text(workspace?.canonicalUrl || structure?.url || pdf?.sourceUrl, 4000);
    return {
      workspaceId: text(workspace?.workspaceId, 100),
      title,
      url,
      createdAt: text(workspace?.createdAt, 100),
      updatedAt: text(workspace?.updatedAt, 100),
      ...bibliographyFromAsset(workspace, byPath.get('article/bibliography.json')),
      ...saveTimeFromAsset(workspace, byPath.get('annotations/library-save-events.json')),
      ...tagsFromAsset(workspace, byPath.get(TAGS_PATH)),
      sources,
      coverage: {
        title: Boolean(title),
        notes: scopes.has('notes'),
        fulltext: scopes.has('fulltext'),
        abstract: scopes.has('abstract'),
        method: scopes.has('method'),
        caption: scopes.has('caption')
      }
    };
  }

  function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  }

  function countTerm(value, abbreviation) {
    const term = text(abbreviation, 40);
    if (!term) return 0;
    const token = '[\\p{L}\\p{N}]';
    const pattern = new RegExp(`(^|[^${token.slice(1, -1)}])${escapeRegex(term)}(?=$|[^${token.slice(1, -1)}])`, 'giu');
    let count = 0;
    for (const _ of text(value).matchAll(pattern)) count += 1;
    return count;
  }

  function countKnownTerms(sources, abbreviations) {
    const totals = new Map();
    const unique = [...new Map((Array.isArray(abbreviations) ? abbreviations : [])
      .map(item => text(item, 40)).filter(Boolean)
      .map(item => [item.toLocaleLowerCase(), item])).values()]
      .sort((left, right) => right.length - left.length);
    for (let start = 0; start < unique.length; start += 200) {
      const chunk = unique.slice(start, start + 200);
      const pattern = new RegExp(
        `(^|[^\\p{L}\\p{N}])(${chunk.map(escapeRegex).join('|')})(?=$|[^\\p{L}\\p{N}])`,
        'giu'
      );
      (Array.isArray(sources) ? sources : []).forEach(source => {
        pattern.lastIndex = 0;
        for (const match of text(source).matchAll(pattern)) {
          const key = match[2].toLocaleLowerCase();
          totals.set(key, (totals.get(key) || 0) + 1);
        }
      });
    }
    return totals;
  }

  function buildLocalReadingLibrary(input = {}) {
    const assetsByWorkspace = input.assetsByWorkspace instanceof Map
      ? input.assetsByWorkspace : new Map(values(input.assetsByWorkspace));
    const articles = (Array.isArray(input.workspaces) ? input.workspaces : [])
      .filter(item => item && !item.deletionPending)
      .map(workspace => articleFromWorkspace(
        workspace, assetsByWorkspace.get(workspace.workspaceId) || []
      ))
      .filter(article => article.workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));

    const memory = typeof shared.normalizeGlobalAbbreviationMemory === 'function'
      ? shared.normalizeGlobalAbbreviationMemory(input.globalMemory)
      : { entries: Array.isArray(input.globalMemory?.entries) ? input.globalMemory.entries : [] };
    const countsByArticle = new Map(articles.map(article => [
      article.workspaceId,
      countKnownTerms(
        article.sources
          .filter(source => source.scope === 'fulltext' || source.scope === 'caption')
          .map(source => source.text),
        memory.entries.map(entry => entry.abbreviation)
      )
    ]));
    const abbreviations = memory.entries.map((entry, index) => {
      const occurrences = articles.flatMap(article => {
        const count = countsByArticle.get(article.workspaceId)
          ?.get(text(entry.abbreviation, 40).toLocaleLowerCase()) || 0;
        return count ? [{ workspaceId: article.workspaceId, title: article.title,
          url: article.url, count }] : [];
      });
      return {
        id: text(entry.entryId, 100) ||
          `${index}:${text(entry.abbreviation, 40)}:${text(entry.fullName, 240)}`,
        abbreviation: text(entry.abbreviation, 40),
        fullName: text(entry.fullName, 240),
        meaningZh: text(entry.meaningZh, 240),
        firstImportedAt: text(entry.firstImportedAt, 100),
        hiddenFromReading: entry.hiddenFromReading === true,
        documentCount: occurrences.length,
        totalCount: occurrences.reduce((sum, item) => sum + item.count, 0),
        occurrences
      };
    });
    return { schemaVersion: 1, articles, abbreviations };
  }

  function includesQuery(value, query) {
    return text(value).toLocaleLowerCase().includes(query);
  }

  function snippet(value, query) {
    const source = text(value);
    const lower = source.toLocaleLowerCase();
    const index = lower.indexOf(query);
    if (index < 0) return source.slice(0, 220);
    const start = Math.max(0, index - 80);
    const end = Math.min(source.length, index + query.length + 140);
    return `${start ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
  }

  function page(items, pageNumber, pageSize) {
    const size = Math.max(5, Math.min(100, Math.floor(Number(pageSize) || 20)));
    const pages = Math.max(1, Math.ceil(items.length / size));
    const current = Math.max(1, Math.min(pages, Math.floor(Number(pageNumber) || 1)));
    return { items: items.slice((current - 1) * size, current * size),
      page: current, pageSize: size, pageCount: pages, total: items.length };
  }

  function queryLocalReadingLibrary(library, options = {}) {
    const libraryTotals = () => ({
      articles: library?.articles?.length || 0,
      abbreviations: library?.abbreviations?.length || 0,
      coverage: coverageTotals(library?.articles || [])
    });
    const kind = ['abbreviations', 'occurrences'].includes(options.kind)
      ? options.kind : 'articles';
    const query = text(options.query, 500).toLocaleLowerCase();
    if (kind === 'occurrences') {
      const abbreviation = (library?.abbreviations || []).find(item =>
        item.id === text(options.abbreviationId, 400));
      const filtered = (abbreviation?.occurrences || []).filter(item => !query ||
        includesQuery(item.title, query));
      return {
        kind,
        abbreviation: abbreviation ? {
          id: abbreviation.id,
          abbreviation: abbreviation.abbreviation,
          fullName: abbreviation.fullName
        } : null,
        ...page(filtered, options.page, options.pageSize),
        totals: libraryTotals()
      };
    }
    if (kind === 'abbreviations') {
      const filtered = (library?.abbreviations || []).filter(item => !query || [
        item.abbreviation, item.fullName, item.meaningZh,
        ...item.occurrences.map(hit => hit.title)
      ].some(value => includesQuery(value, query)));
      const paged = page(filtered, options.page, options.pageSize);
      return {
        kind,
        ...paged,
        items: paged.items.map(({ occurrences, ...item }) => item),
        totals: libraryTotals()
      };
    }
    const scope = SEARCH_SCOPES.includes(options.scope) ? options.scope : 'all';
    const tagMode = options.tagMode === undefined ? 'any' : options.tagMode;
    if (!['any', 'all'].includes(tagMode)) {
      const error = new Error('LOCAL_LIBRARY_TAG_MODE_INVALID');
      error.code = error.message;
      throw error;
    }
    const rawTags = options.tags === undefined ? [] : options.tags;
    const tags = typeof tagsApi.normalizeLocalLibraryTags === 'function'
      ? tagsApi.normalizeLocalLibraryTags(rawTags) : (() => {
        if (Array.isArray(rawTags) && !rawTags.length) return [];
        const error = new Error('LOCAL_LIBRARY_TAGS_UNAVAILABLE');
        error.code = error.message;
        throw error;
      })();
    const availableTags = [...new Set((library?.articles || [])
      .flatMap(article => Array.isArray(article.tags) ? article.tags : []))].sort();
    const matches = (library?.articles || []).flatMap(article => {
      const articleTags = Array.isArray(article.tags) ? article.tags : [];
      if (tags.length && !(tagMode === 'all'
        ? tags.every(tag => articleTags.includes(tag))
        : tags.some(tag => articleTags.includes(tag)))) return [];
      const candidates = article.sources.filter(source => scope === 'all' || source.scope === scope);
      const hits = query ? candidates.filter(source => includesQuery(source.text, query)) : [];
      if (query && !hits.length) return [];
      return [{
        workspaceId: article.workspaceId,
        title: article.title,
        url: article.url,
        createdAt: article.createdAt,
        updatedAt: article.updatedAt,
        journal: article.journal,
        publicationDate: article.publicationDate,
        publicationDatePrecision: article.publicationDatePrecision,
        savedAt: article.savedAt,
        tags: articleTags,
        tagRevision: article.tagRevision,
        tagContentHash: article.tagContentHash,
        workspaceGeneration: article.workspaceGeneration,
        tagState: article.tagState,
        tagError: article.tagError,
        coverage: article.coverage,
        hitScopes: [...new Set(hits.map(hit => hit.scope))],
        snippets: hits.slice(0, 3).map(hit => ({
          scope: hit.scope, label: hit.label, text: snippet(hit.text, query)
        }))
      }];
    });
    return { kind, scope, tagMode, availableTags, matchedCount: matches.length,
      matchedCoverage: coverageTotals(matches), ...page(matches, options.page, options.pageSize),
      totals: libraryTotals() };
  }

  return {
    LOCAL_READING_LIBRARY_SEARCH_SCOPES: SEARCH_SCOPES,
    buildLocalReadingLibrary,
    queryLocalReadingLibrary,
    countLocalLibraryAbbreviationOccurrences: countTerm
  };
});
