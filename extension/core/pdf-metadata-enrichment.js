(function attach(root, factory) {
  const metadata = typeof module === 'object' && module.exports ? require('./pdf-article-metadata') : root.SciLLM || {};
  const api = factory(metadata);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(metadata) {
  'use strict';
  const LIMIT = 1024 * 1024;
  const validDoi = value => typeof value === 'string' && value.length <= 500 &&
    /^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/u.test(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  function apiDate(value) {
    const parts = value?.['date-parts'];
    if (!Array.isArray(parts) || parts.length !== 1 || !Array.isArray(parts[0]) ||
        !parts[0].length || parts[0].length > 3 || !parts[0].every(Number.isInteger)) return '';
    return parts[0].map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('-');
  }
  async function boundedJson(response) {
    if (Number(response.headers?.get?.('content-length') || 0) > LIMIT) throw Error('PDF_METADATA_RESPONSE_TOO_LARGE');
    const reader = response.body?.getReader?.();
    if (!reader) throw Error('PDF_METADATA_RESPONSE_UNREADABLE');
    const chunks = []; let length = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > LIMIT) { await reader.cancel(); throw Error('PDF_METADATA_RESPONSE_TOO_LARGE'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  /** Exact public metadata only: no publisher fetch, credentials, body text or title search. */
  function createPdfMetadataEnrichment({fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 6000} = {}) {
    const cache = new Map();
    async function lookup(doi) {
      const empty = (status, reason = '') => ({doi, status, reason, checkedAt: new Date(now()).toISOString(), provider: '',
        fields: Object.fromEntries(['title', 'authors', 'journal', 'publisherUrl'].map(name => [name, metadata.pdfMetadataField(name, '', '')])),
        dates: Object.fromEntries(['published', 'print', 'online', 'cover'].map(name => [name, metadata.pdfMetadataField(name, '', '')]))});
      if (!validDoi(doi) || typeof fetchImpl !== 'function') return empty('failed', 'PDF_METADATA_INVALID_DOI');
      const cached = cache.get(doi);
      if (cached && now() - cached.time < 900000) return clone(cached.value);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(8000, Math.max(1, timeoutMs)));
      const get = async url => {
        const response = await fetchImpl(url, {method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
          headers: {Accept: 'application/json'}, signal: controller.signal});
        if (!response.ok) { await response.body?.cancel?.(); throw Error(`PDF_METADATA_HTTP_${response.status}`); }
        return boundedJson(response);
      };
      const result = empty('failed', 'PDF_METADATA_UNAVAILABLE');
      try {
        try {
          const data = await get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
          const record = data?.message;
          if (typeof record?.DOI !== 'string' || record.DOI.toLowerCase() !== doi) return empty('conflict', 'PDF_METADATA_DOI_MISMATCH');
          result.provider = 'crossref'; result.status = 'partial'; result.reason = '';
          const single = value => Array.isArray(value) && value.length === 1 ? value[0] : undefined;
          result.fields.title = metadata.pdfMetadataField('title', single(record.title), 'crossref:title');
          result.fields.authors = metadata.pdfMetadataField('authors', Array.isArray(record.author) ? record.author.map(author => ({
            literal: author.name || [author.given, author.family].filter(Boolean).join(' '),
            ...(author.given ? {given: author.given} : {}), ...(author.family ? {family: author.family} : {})
          })) : [], 'crossref:author');
          result.fields.journal = metadata.pdfMetadataField('journal', single(record['container-title']), 'crossref:container-title');
          result.fields.publisherUrl = metadata.pdfMetadataField('publisherUrl', record.resource?.primary?.URL, 'crossref:resource.primary.URL');
          for (const kind of ['published', 'print', 'online']) result.dates[kind] = metadata.pdfMetadataField(kind,
            apiDate(record[kind === 'published' ? kind : `published-${kind}`]), kind === 'published' ? 'crossref:published' : `crossref:published-${kind}`);
        } catch (error) { result.reason = controller.signal.aborted ? 'PDF_METADATA_TIMEOUT' : 'PDF_METADATA_UNAVAILABLE'; }
        if (result.fields.publisherUrl.status !== 'known' && !controller.signal.aborted) {
          try {
            const handle = await get(`https://doi.org/api/handles/${encodeURIComponent(doi)}?type=URL`);
            if (handle?.responseCode !== 1 || typeof handle.handle !== 'string' || handle.handle.toLowerCase() !== doi) {
              return empty('conflict', 'PDF_METADATA_HANDLE_MISMATCH');
            }
            const values = (Array.isArray(handle.values) ? handle.values : []).filter(value => value.type === 'URL');
            const urls = values.map(value => value.data?.format === 'string' ? metadata.normalizePdfPublisherUrl(value.data.value) : '');
            if (urls.length && urls.every(Boolean) && new Set(urls).size === 1) {
              result.fields.publisherUrl = metadata.pdfMetadataField('publisherUrl', urls[0], 'doi-handle:URL');
              result.provider = result.provider ? 'crossref+doi-handle' : 'doi-handle'; result.status = 'partial'; result.reason = '';
            } else if (urls.length) return empty('conflict', 'PDF_METADATA_URL_CONFLICT');
          } catch (_) { /* The PDF fields and any successful registry fields remain usable. */ }
        }
        if (Object.values(result.fields).every(value => value.status === 'known')) result.status = 'complete';
        if (['complete', 'partial'].includes(result.status)) {
          if (cache.size >= 64) cache.delete(cache.keys().next().value);
          cache.set(doi, {time: now(), value: clone(result)});
        }
        return result;
      } finally { clearTimeout(timer); }
    }
    return Object.freeze({lookup});
  }
  return {createPdfMetadataEnrichment};
});
