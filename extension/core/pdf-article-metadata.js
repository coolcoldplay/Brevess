(function attach(root, factory) {
  const doiApi = typeof module === 'object' && module.exports ? require('./pdf-bibliography') : root.SciLLM || {};
  const api = factory(doiApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(doiApi) {
  'use strict';
  const PDF_BIBLIOGRAPHY_ASSET_PATH = 'pdf/bibliography.json';
  const FIELDS = ['title', 'authors', 'journal', 'doi', 'doiUrl', 'publisherUrl'];
  const DATES = ['published', 'online', 'print', 'cover'];
  const SOURCES = {
    title: ['pdf:info:Title', 'pdf:xmp:dc:title', 'crossref:title', 'datacite:titles'],
    authors: ['pdf:xmp:dc:creator', 'pdf:info:Author', 'crossref:author', 'datacite:creators'],
    journal: ['pdf:xmp:prism:publicationname', 'crossref:container-title', 'datacite:container'],
    doi: ['pdf:doi-evidence'], doiUrl: ['pdf:doi-evidence'],
    publisherUrl: ['crossref:resource.primary.URL', 'doi-handle:URL', 'datacite:url'],
    published: ['pdf:xmp:prism:publicationdate', 'crossref:published', 'datacite:publicationYear'],
    online: ['pdf:xmp:prism:onlinepublicationdate', 'crossref:published-online'],
    print: ['crossref:published-print'], cover: ['pdf:xmp:prism:coverdate']
  };
  const BAD = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u;
  const clone = value => JSON.parse(JSON.stringify(value));
  const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  function text(value, max = 1200) {
    if (typeof value !== 'string' || value.length > max || BAD.test(value)) return '';
    return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  }
  function publicUrl(value) {
    const raw = text(value, 4096);
    try {
      const url = new URL(raw);
      if (!/^https?:$/u.test(url.protocol) || url.username || url.password ||
          /^(?:localhost|.*\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])$/iu.test(url.hostname)) return '';
      return url.href;
    } catch (_) { return ''; }
  }
  function date(value) {
    const raw = text(value, 30), m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u.exec(raw);
    if (!m || Number(m[1]) < 1) return null;
    const year = Number(m[1]), month = m[2] ? Number(m[2]) : null, day = m[3] ? Number(m[3]) : null;
    if (month !== null && (month < 1 || month > 12)) return null;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    if (day !== null && (day < 1 || day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])) return null;
    return {value: raw, precision: day ? 'day' : month ? 'month' : 'year'};
  }
  function fieldValue(name, value) {
    if (name === 'authors') {
      if (!Array.isArray(value) || !value.length || value.length > 500) return null;
      const authors = value.map(author => {
        const literal = text(typeof author === 'string' ? author : author?.literal, 500);
        if (!literal) return null;
        const result = {literal};
        for (const key of ['given', 'family']) {
          if (typeof author === 'object' && author[key] !== undefined) {
            const checked = text(author[key], 250);
            if (!checked && author[key] !== '') return null;
            if (checked) result[key] = checked;
          }
        }
        return result;
      });
      return authors.every(Boolean) ? authors : null;
    }
    if (DATES.includes(name)) return date(value)?.value || null;
    if (name.endsWith('Url')) return publicUrl(value) || null;
    const checked = text(value, name === 'doi' ? 500 : 1200);
    return checked || null;
  }
  function unknown(name, reason = 'missing', evidence = []) {
    return {status: 'unknown', value: name === 'authors' ? [] : '', source: '', manual: false,
      reason, evidence, ...(DATES.includes(name) ? {precision: 'unknown'} : {})};
  }
  function field(name, value, source) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return unknown(name);
    const checked = fieldValue(name, value);
    if (checked === null || !SOURCES[name]?.includes(source)) return unknown(name, 'invalid');
    return {status: 'known', value: checked, source, manual: false, reason: '',
      evidence: [{source, value: clone(checked)}], ...(DATES.includes(name) ? {precision: date(checked).precision} : {})};
  }
  function equivalent(name, a, b) {
    const comparable = value => name === 'authors' ? value.map(author => author.literal.toLocaleLowerCase('en-US'))
      : typeof value === 'string' ? value.toLocaleLowerCase('en-US') : value;
    return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
  }
  function combine(name, a, b) {
    if (a.manual || a.source === 'legacy') return a;
    if (b.reason === 'missing') return a;
    if (a.reason === 'missing') return b;
    if (a.status !== 'known' || b.status !== 'known') {
      return unknown(name, a.reason === 'conflict' || b.reason === 'conflict' ? 'conflict' : b.reason || a.reason,
        [...a.evidence, ...b.evidence].slice(0, 8));
    }
    if (equivalent(name, a.value, b.value)) return a;
    // Refinement is legal only inside the same date kind (print/online/cover).
    if (DATES.includes(name) && (a.value.startsWith(b.value + '-') || b.value.startsWith(a.value + '-'))) {
      return a.value.length >= b.value.length ? a : b;
    }
    return unknown(name, 'conflict', [...a.evidence, ...b.evidence].slice(0, 8));
  }
  function normalizeField(value, name) {
    if (!plain(value) || !['known', 'unknown', 'cleared'].includes(value.status) ||
        !Array.isArray(value.evidence) || value.evidence.length > 8) return null;
    if (value.manual === true || value.source === 'legacy') {
      if (!['manual', 'legacy'].includes(value.source)) return null;
      if (value.status === 'cleared' && value.source === 'manual') return {
        status: 'cleared', value: name === 'authors' ? [] : '', source: 'manual', manual: true,
        reason: 'cleared', evidence: [], ...(DATES.includes(name) ? {precision: 'unknown'} : {})};
      const checked = fieldValue(name, value.value);
      if (value.status !== 'known' || checked === null) return null;
      return {status: 'known', value: checked, source: value.source, manual: value.source === 'manual',
        reason: '', evidence: [], ...(DATES.includes(name) ? {precision: date(checked).precision} : {})};
    }
    const evidence = [];
    for (const candidate of value.evidence) {
      const checked = fieldValue(name, candidate?.value);
      if (!SOURCES[name]?.includes(candidate?.source) || checked === null) return null;
      evidence.push({source: candidate.source, value: checked});
    }
    if (value.status === 'unknown') {
      if (!['missing', 'invalid', 'bounds', 'conflict'].includes(value.reason)) return null;
      return unknown(name, value.reason, evidence);
    }
    if (value.status !== 'known' || !SOURCES[name]?.includes(value.source)) return null;
    const checked = fieldValue(name, value.value);
    if (checked === null || !evidence.some(e => e.source === value.source && equivalent(name, e.value, checked))) return null;
    return {...field(name, checked, value.source), evidence};
  }
  function validBinding(value) {
    return /^[a-f0-9]{64}$/u.test(value?.documentHash || '') && Number.isSafeInteger(value?.documentGeneration) && value.documentGeneration >= 1;
  }
  function normalizeSnapshot(input, binding, persisted = false) {
    if (!plain(input) || input.schemaVersion !== 1 || input.kind !== 'pdf-article-metadata' || !validBinding(binding) ||
        input.documentHash !== binding.documentHash || input.documentGeneration !== binding.documentGeneration) return null;
    const result = {schemaVersion: 1, kind: input.kind, documentHash: binding.documentHash,
      documentGeneration: binding.documentGeneration, dates: {}};
    for (const name of FIELDS) {
      result[name] = normalizeField(input[name], name);
      if (!result[name]) return null;
    }
    for (const name of DATES) {
      result.dates[name] = normalizeField(input.dates?.[name], name);
      if (!result.dates[name]) return null;
    }
    // A durable asset retains the actual extraction generation as provenance.
    // A live snapshot must still match the currently open native generation.
    result.doiEvidence = doiApi.normalizePdfArticleDoiEvidence?.(input.doiEvidence, persisted ? {
      documentHash: binding.documentHash, documentGeneration: input.doiEvidence?.documentGeneration
    } : binding) || null;
    if (result.doi.status === 'known' && !result.doi.manual && result.doi.source !== 'legacy' &&
        (result.doiEvidence?.status !== 'known' || result.doi.value !== result.doiEvidence.value)) return null;
    if (result.doiUrl.status === 'known' && !result.doiUrl.manual && result.doiUrl.source !== 'legacy' &&
        result.doiUrl.value !== `https://doi.org/${result.doiEvidence?.value || ''}`) return null;
    return result;
  }
  function extractPdfArticleMetadata(input = {}) {
    const binding = {documentHash: input.documentHash, documentGeneration: input.documentGeneration};
    if (!validBinding(binding)) return null;
    const info = input.info || {}, xmp = input.xmp || {};
    const evidence = doiApi.normalizePdfArticleDoiEvidence?.(input.doiEvidence, binding) || null;
    const doi = evidence?.status === 'known' ? evidence.value : '';
    const result = {schemaVersion: 1, kind: 'pdf-article-metadata', ...binding, doiEvidence: evidence,
      title: combine('title', field('title', xmp['dc:title'], 'pdf:xmp:dc:title'), field('title', info.Title, 'pdf:info:Title')),
      authors: xmp['dc:creator'] !== undefined ? field('authors', xmp['dc:creator'], 'pdf:xmp:dc:creator')
        : field('authors', info.Author ? [info.Author] : [], 'pdf:info:Author'),
      journal: field('journal', xmp['prism:publicationname'], 'pdf:xmp:prism:publicationname'),
      doi: field('doi', doi, 'pdf:doi-evidence'), doiUrl: field('doiUrl', doi ? `https://doi.org/${doi}` : '', 'pdf:doi-evidence'),
      publisherUrl: unknown('publisherUrl'), dates: {}}
    for (const name of DATES) result.dates[name] = field(name, xmp[{
      published: 'prism:publicationdate', online: 'prism:onlinepublicationdate', cover: 'prism:coverdate'}[name]], SOURCES[name][0]);
    return result;
  }
  function workspaceBinding(input) {
    if (!/^workspace:[a-f0-9]{64}$/u.test(input?.workspaceId || '') ||
        !Number.isSafeInteger(input.workspaceGeneration) || input.workspaceGeneration < 1 ||
        !/^[a-f0-9]{64}$/u.test(input.documentHash || '') || typeof input.canonicalUrl !== 'string' || input.canonicalUrl.length > 4096) return null;
    try { if (!['file:', 'http:', 'https:'].includes(new URL(input.canonicalUrl).protocol)) return null; }
    catch (_) { return null; }
    return {workspaceId: input.workspaceId, workspaceGeneration: input.workspaceGeneration,
      canonicalUrl: input.canonicalUrl, documentHash: input.documentHash};
  }
  function normalizePdfBibliographyAsset(input, expected) {
    const binding = workspaceBinding(expected);
    if (!binding || !plain(input) || input.kind !== 'pdf-bibliography' || input.schemaVersion !== 1 ||
        Object.keys(binding).some(key => input[key] !== binding[key])) return null;
    const snapshot = normalizeSnapshot({...input, kind: 'pdf-article-metadata', documentGeneration: input.sourceGeneration},
      {documentHash: binding.documentHash, documentGeneration: input.sourceGeneration}, true);
    if (!snapshot) return null;
    const result = {...snapshot, kind: 'pdf-bibliography', ...binding, sourceGeneration: input.sourceGeneration};
    delete result.documentGeneration;
    const enrichment = input.enrichment || {};
    if (!['not-requested', 'complete', 'partial', 'failed', 'no-doi', 'conflict'].includes(enrichment.status)) return null;
    result.enrichment = {status: enrichment.status, provider: text(enrichment.provider || '', 50),
      checkedAt: text(enrichment.checkedAt || '', 50), reason: text(enrichment.reason || '', 120)};
    return result;
  }
  function createPdfBibliographyAsset(snapshot, workspace) {
    const normalized = normalizeSnapshot(snapshot, snapshot);
    if (!normalized) return null;
    const candidate = {...normalized, ...workspaceBinding({...workspace, documentHash: normalized.documentHash}),
      kind: 'pdf-bibliography', sourceGeneration: normalized.documentGeneration,
      enrichment: {status: normalized.doi.status === 'known' ? 'not-requested' : 'no-doi', provider: '', checkedAt: '', reason: ''}};
    delete candidate.documentGeneration;
    return normalizePdfBibliographyAsset(candidate, candidate);
  }
  function mergePdfBibliographyAssets(previous, candidate) {
    const next = normalizePdfBibliographyAsset(candidate, candidate);
    const old = previous ? normalizePdfBibliographyAsset(previous, next) : null;
    if (!next || (previous && !old)) return null;
    if (!old) return next;
    for (const name of FIELDS) next[name] = combine(name, old[name], next[name]);
    for (const name of DATES) next.dates[name] = combine(name, old.dates[name], next.dates[name]);
    // DOI evidence remains tied to the extraction that supplied the saved value.
    if (next.doi.value === old.doi.value && old.doiEvidence?.status === 'known' && next.doiEvidence?.status !== 'known') next.doiEvidence = old.doiEvidence;
    if (next.enrichment.status === 'not-requested' && ['complete', 'partial'].includes(old.enrichment.status)) next.enrichment = old.enrichment;
    return next;
  }
  function applyPdfMetadataEnrichment(asset, response) {
    const next = normalizePdfBibliographyAsset(asset, asset);
    if (!next || !plain(response) || response.doi !== next.doiEvidence?.value || next.doiEvidence?.status !== 'known') return next;
    const status = ['complete', 'partial', 'failed', 'conflict'].includes(response.status) ? response.status : 'failed';
    next.enrichment = {status, provider: text(response.provider || '', 50), checkedAt: text(response.checkedAt || '', 50), reason: text(response.reason || '', 120)};
    if (!['complete', 'partial'].includes(status)) return next;
    for (const name of ['title', 'authors', 'journal', 'publisherUrl']) {
      const value = response.fields?.[name] && normalizeField(response.fields[name], name);
      if (value) next[name] = combine(name, next[name], value);
    }
    for (const name of DATES) {
      const value = response.dates?.[name] && normalizeField(response.dates[name], name);
      if (value) next.dates[name] = combine(name, next.dates[name], value);
    }
    return next;
  }
  function projectPdfBibliography(asset) {
    const value = normalizePdfBibliographyAsset(asset, asset);
    if (!value) return {};
    const kind = ['published', 'print', 'online', 'cover'].find(name => value.dates[name].status === 'known');
    return {authors: value.authors.value, journal: value.journal.value, bibliographyTitle: value.title.value,
      publicationDate: kind ? value.dates[kind].value : '', publicationDatePrecision: kind ? value.dates[kind].precision : '',
      publicationDateKind: kind || '', publisherUrl: value.publisherUrl.value, doiUrl: value.doiUrl.value,
      bibliographyStatus: [...FIELDS.map(name => value[name]), ...Object.values(value.dates)].some(field => field.reason === 'conflict')
        ? 'conflict' : value.enrichment.status};
  }
  return {PDF_BIBLIOGRAPHY_ASSET_PATH, extractPdfArticleMetadata,
    normalizePdfArticleMetadata: normalizeSnapshot, createPdfBibliographyAsset, normalizePdfBibliographyAsset,
    mergePdfBibliographyAssets, applyPdfMetadataEnrichment, projectPdfBibliography,
    pdfMetadataField: field, normalizePdfPublisherUrl: publicUrl};
});
