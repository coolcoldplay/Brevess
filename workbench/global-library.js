/* Read model for the global 文献总库.
 *
 * Local reading-library entries and radar read:true entries stay in their
 * original stores. This module only merges a paginated view; it never writes
 * radar state, local workspaces, or project resources.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessWorkbenchLibrary = Object.assign(root.BrevessWorkbenchLibrary || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const WORKBENCH_GLOBAL_LIBRARY_VERSION = 1;
  const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  function authorText(value) {
    const rows = Array.isArray(value) ? value : value ? [value] : [];
    return rows.map(author => {
      if (typeof author === 'string') return normalize(author);
      if (!author || typeof author !== 'object') return '';
      return normalize(author.name || author.fullName || author.displayName || author.collectiveName || '');
    }).filter(Boolean).join(', ');
  }
  const doiKey = value => {
    const text = normalize(value).toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, '');
    return /^10\.\d{4,9}\/\S+$/u.test(text) ? `doi:${text}` : '';
  };
  const pmidFrom = value => {
    const text = normalize(value);
    const direct = /^\d{5,12}$/u.test(text) ? text : '';
    if (direct) return `pmid:${direct}`;
    const match = /(?:pubmed\.ncbi\.nlm\.nih\.gov\/|pmid[:\s]*)(\d{5,12})/iu.exec(text);
    return match ? `pmid:${match[1]}` : '';
  };
  const titleKey = value => `title:${normalize(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')}`;
  function identityKey(entry) {
    return doiKey(entry?.doi) || pmidFrom(entry?.pmid || entry?.id || entry?.url) || titleKey(entry?.title) ||
      `id:${normalize(entry?.id || entry?.paperId || entry?.workspaceId)}`;
  }
  function localStatus(paper) {
    const docs = Array.isArray(paper?.sourceDocuments) ? paper.sourceDocuments : [];
    if (!docs.length) return 'missing';
    if (docs.some(doc => doc.offlineSnapshotStatus === 'unknown')) return 'unknown';
    if (docs.some(doc => doc.offlineSnapshotStatus === 'partial' || doc.lastSaveAttemptStatus === 'failed')) return 'partial';
    if (docs.some(doc => doc.hasOfflineSnapshot === true && doc.offlineSnapshotStatus === 'complete')) return 'complete';
    return docs.some(doc => doc.workspaceId) ? 'partial' : 'missing';
  }
  function radarReadPapers(state) {
    const result = [];
    for (const radar of Array.isArray(state?.radars) ? state.radars : []) {
      const revision = radar?.revisions?.[radar.revisions.length - 1];
      for (const paper of Array.isArray(revision?.articles) ? revision.articles : []) {
        if (paper?.read !== true) continue;
        result.push({
          id: `radar-pmid:${paper.id}`,
          kind: 'radar',
          sourceKind: 'radar',
          stableId: doiKey(paper.doi) || pmidFrom(paper.id) || titleKey(paper.title),
          pmid: paper.id,
          title: paper.title || `PMID ${paper.id}`,
          authors: authorText(paper.authors),
          journal: paper.journal || '',
          publicationDate: paper.publicationDate || paper.createdDay || '',
          year: String(paper.publicationDate || paper.createdDay || '').slice(0, 4),
          doi: paper.doi || '',
          abstract: paper.abstract || '',
          url: `https://pubmed.ncbi.nlm.nih.gov/${paper.id}/`,
          radarId: radar.id,
          radarRevision: revision.number,
          radarRead: true,
          sourceDocuments: [],
          status: 'missing',
          availability: 'metadata-only',
          tags: [],
          sources: { local: false, radar: true }
        });
      }
    }
    return result;
  }
  function localEntry(paper) {
    const sourceDocuments = Array.isArray(paper.sourceDocuments) ? paper.sourceDocuments : [];
    return {
      ...paper,
      authors: authorText(paper.authors || paper.authorText),
      id: paper.id || paper.paperId || `local:${paper.workspaceId || titleKey(paper.title)}`,
      kind: 'local',
      sourceKind: 'local',
      stableId: doiKey(paper.doi) || pmidFrom(paper.paperId || paper.url) || titleKey(paper.title),
      sourceDocuments,
      status: localStatus(paper),
      availability: sourceDocuments.length ? 'local' : 'metadata-only',
      year: String(paper.publicationDate || '').slice(0, 4),
      radarRead: false,
      sources: { local: sourceDocuments.length > 0, radar: false }
    };
  }
  function mergeGlobalLibrary(localItems, radarItems, { includeRadarRead = true } = {}) {
    const map = new Map();
    for (const raw of Array.isArray(localItems) ? localItems : []) {
      const entry = localEntry(raw);
      const key = identityKey(entry);
      if (!map.has(key)) map.set(key, entry);
    }
    if (includeRadarRead) for (const raw of Array.isArray(radarItems) ? radarItems : []) {
      const key = identityKey(raw);
      const existing = map.get(key);
      if (existing) {
        existing.radarRead = true;
        existing.sources = { ...(existing.sources || {}), radar: true };
        existing.sourceKind = existing.sources.local ? 'mixed' : 'radar';
        existing.radarId = raw.radarId;
        existing.radarRevision = raw.radarRevision;
        existing.pmid = existing.pmid || raw.pmid;
        if (!existing.abstract) existing.abstract = raw.abstract;
      } else {
        map.set(key, { ...raw, sourceKind: 'radar', stableId: key, sources: { local: false, radar: true } });
      }
    }
    return [...map.values()];
  }
  function filterEntries(entries, { query = '', scope = 'all' } = {}) {
    const text = normalize(query).toLowerCase();
    return entries.filter(entry => {
      if (scope === 'radar' && !entry.radarRead) return false;
      if (scope === 'local' && !entry.sources?.local) return false;
      if (scope === 'metadata-only' && entry.availability !== 'metadata-only') return false;
      if (['complete', 'partial', 'missing', 'unknown'].includes(scope) && entry.status !== scope) return false;
      if (!text) return true;
      return [entry.title, entry.authors, entry.journal, entry.abstract, ...(entry.tags || [])].join(' ').toLowerCase().includes(text);
    });
  }
  function createGlobalLibraryReader({ adapter, radarStore } = {}) {
    if (!adapter || typeof adapter.queryLibrary !== 'function') throw Object.assign(new Error('全局文献总库需要 library adapter'), { code: 'WORKBENCH_GLOBAL_LIBRARY_ADAPTER_REQUIRED' });
    return {
      async query({ page = 1, pageSize = 40, query = '', scope = 'all', tags = [], tagMode = 'any', includeRadarRead = true } = {}) {
        const safePage = Math.max(1, Math.min(100000, Math.floor(Number(page) || 1)));
        const safeSize = Math.max(1, Math.min(100, Math.floor(Number(pageSize) || 40)));
        const localItems = [];
        const warnings = [];
        let localPage = 1;
        let localPageCount = 1;
        const maxLocalPages = 1000;
        do {
          const local = await adapter.queryLibrary({
            query,
            scope: 'all',
            tags,
            tagMode,
            page: localPage,
            pageSize: 100
          });
          localItems.push(...(local.items || []));
          localPageCount = Math.max(1, Math.floor(Number(local.pageCount || local.pages) || 1));
          localPage += 1;
        } while (localPage <= localPageCount && localPage <= maxLocalPages);
        if (localPageCount > maxLocalPages) {
          warnings.push(`LOCAL_LIBRARY_PAGINATION_TRUNCATED:${localPageCount}`);
        }
        let radarPapers = [];
        if (includeRadarRead && radarStore) {
          try { radarPapers = radarReadPapers(await radarStore.read()); }
          catch (error) { warnings.push(`RADAR_LIBRARY_UNAVAILABLE:${error?.code || error?.message || 'read failed'}`); }
        }
        const merged = mergeGlobalLibrary(localItems, radarPapers, { includeRadarRead });
        const filtered = filterEntries(merged, { query, scope });
        const pageCount = Math.max(1, Math.ceil(filtered.length / safeSize));
        const currentPage = Math.min(safePage, pageCount);
        const items = filtered.slice((currentPage - 1) * safeSize, currentPage * safeSize);
        return {
          items,
          page: currentPage,
          pageCount,
          matchedCount: filtered.length,
          sources: { local: localItems.length, radar: radarPapers.length },
          warnings
        };
      }
    };
  }
  return {
    WORKBENCH_GLOBAL_LIBRARY_VERSION,
    identityKey,
    authorText,
    localStatus,
    radarReadPapers,
    mergeGlobalLibrary,
    filterEntries,
    createGlobalLibraryReader
  };
});
