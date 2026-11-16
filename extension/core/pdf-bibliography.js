(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';
  const TYPE = 'pdf-article-doi-evidence';
  const LIMITS = Object.freeze({ maxItems: 4096, maxPageText: 64000,
    maxRaw: 1024, maxEvidence: 16, maxMetadataKeys: 64 });
  const XMP_KEYS = new Set(['dc:identifier', 'prism:doi', 'pdfx:doi']);
  const REASONS = new Set(['', 'missing', 'conflict', 'invalid', 'bounds', 'inconsistent']);
  const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u;
  const fail = reason => { throw new Error(reason); };
  function descriptors(value, maximum = LIMITS.maxMetadataKeys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid');
    const data = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(data).length > maximum) fail('bounds');
    return data;
  }
  function own(data, key) {
    if (!Object.hasOwn(data, key)) return undefined;
    if (!Object.hasOwn(data[key], 'value')) fail('invalid');
    return data[key].value;
  }
  function array(value, maximum) {
    if (!Array.isArray(value) || value.length > maximum) fail('bounds');
    const data = Object.getOwnPropertyDescriptors(value);
    return Array.from({ length: value.length }, (_, index) => {
      if (!Object.hasOwn(data, index) || !Object.hasOwn(data[index], 'value')) fail('invalid');
      return data[index].value;
    });
  }
  function rawString(value, maximum = LIMITS.maxRaw) {
    if (typeof value !== 'string') fail('invalid');
    if (value.length > maximum) fail('bounds');
    if (UNSAFE.test(value)) fail('invalid');
    return value;
  }
  function bindingFrom(data) {
    const documentHash = own(data, 'documentHash');
    const documentGeneration = own(data, 'documentGeneration');
    if (typeof documentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(documentHash) ||
        !Number.isSafeInteger(documentGeneration) || documentGeneration < 1) fail('inconsistent');
    return { documentHash, documentGeneration };
  }
  // Accept complete explicit identifiers. Never truncate, remove URL query data,
  // strip scientific punctuation, or search arbitrary metadata for a DOI.
  function doiValue(raw, identifier = false) {
    const input = rawString(raw).trim();
    if (!input) return '';
    if (identifier && !/^(?:10\.|doi\s*:|https?:\/\/(?:dx\.)?doi\.org\/)/iu.test(input)) return '';
    let doi = input.replace(/^doi\s*:\s*/iu, '');
    if (/^https?:\/\//iu.test(doi)) {
      let url;
      try { url = new URL(doi); } catch (_) { fail('invalid'); }
      if (!/^(?:dx\.)?doi\.org$/iu.test(url.hostname) || url.username || url.password ||
          url.port || url.search || url.hash) fail('invalid');
      try { doi = decodeURIComponent(url.pathname.slice(1)); } catch (_) { fail('invalid'); }
    }
    if (doi.length > 512) fail('bounds');
    if (!/^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/iu.test(doi)) fail('invalid');
    return doi.toLowerCase();
  }
  function firstPageDoi(raw) {
    const value = rawString(raw).trim();
    if (/^doi(?:\s*:\s*|\s+)/iu.test(value)) {
      return doiValue(value.replace(/^doi(?:\s*:\s*|\s+)/iu, ''));
    }
    return /^https?:\/\/(?:dx\.)?doi\.org\//iu.test(value) ? doiValue(value) : '';
  }
  function pageView(value) {
    const view = array(value, 4);
    if (view.length !== 4 || !view.every(Number.isFinite) ||
        view[2] <= view[0] || view[3] <= view[1] ||
        view[2] - view[0] > 20000 || view[3] - view[1] > 20000) fail('invalid');
    return view;
  }
  function band(bounds, view) {
    const [x0, y0, x1, y1] = bounds;
    const height = view[3] - view[1];
    if (x0 < view[0] || x1 > view[2] || y0 < view[1] || y1 > view[3] ||
        x1 <= x0 || y1 <= y0) return '';
    if (y0 >= view[3] - height * 0.25) return 'first-page-header';
    if (y1 <= view[1] + height * 0.18) return 'first-page-footer';
    return '';
  }
  function result(binding, evidence, forcedReason = '') {
    const values = new Set(evidence.map(item => item.value));
    const reason = forcedReason || (values.size > 1 ? 'conflict' : values.size ? '' : 'missing');
    return { schemaVersion: 1, type: TYPE, status: reason ? 'unknown' : 'known',
      value: reason ? '' : evidence[0].value, reason, evidence,
      documentHash: binding.documentHash, documentGeneration: binding.documentGeneration };
  }
  function collectMetadata(metadata, append) {
    if (metadata === undefined || metadata === null) return;
    const data = descriptors(metadata);
    const info = own(data, 'info');
    const readInfo = (value, prefix) => {
      if (value === undefined || value === null) return;
      const fields = descriptors(value);
      for (const key of Object.keys(fields)) {
        if (key.toLowerCase() !== 'doi') continue;
        append(own(fields, key), prefix + key, false);
      }
      if (prefix === 'info:') readInfo(own(fields, 'Custom'), 'info:Custom.');
    };
    readInfo(info, 'info:');
    const xmp = own(data, 'xmp');
    if (xmp === undefined || xmp === null) return;
    const fields = descriptors(xmp);
    for (const key of Object.keys(fields)) {
      const name = key.toLowerCase();
      if (!XMP_KEYS.has(name)) continue;
      const raw = own(fields, key);
      const candidates = Array.isArray(raw) ? array(raw, 8) : [raw];
      candidates.forEach(value => append(value, 'xmp:' + name, name === 'dc:identifier'));
    }
  }
  function collectFirstPage(value, append) {
    if (value === undefined || value === null) return;
    const data = descriptors(value);
    if (own(data, 'pageNumber') !== 1) fail('inconsistent');
    const view = pageView(own(data, 'view'));
    const items = array(own(data, 'items'), LIMITS.maxItems);
    const textItems = [];
    let textLength = 0;
    items.forEach((item, index) => {
      const fields = descriptors(item);
      const raw = own(fields, 'str');
      if (raw === undefined) return; // Marked-content delimiters are not text.
      const str = rawString(raw, 4096);
      textLength += str.length;
      if (textLength > LIMITS.maxPageText) fail('bounds');
      if (!str.trim()) return;
      const transform = array(own(fields, 'transform'), 6);
      const width = own(fields, 'width');
      if (transform.length !== 6 || !transform.every(Number.isFinite) ||
          !Number.isFinite(width) || width < 0 || width > view[2] - view[0]) fail('invalid');
      // Rotated text cannot establish a header/footer through this simple path.
      if (Math.abs(transform[1]) > 0.001 || Math.abs(transform[2]) > 0.001) return;
      const height = Math.abs(transform[3]);
      if (!height || height > (view[3] - view[1]) * 0.1) return;
      textItems.push({ str, index, x: transform[4], y: transform[5], width, height });
    });
    textItems.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const item of textItems) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last.y - item.y) <= Math.max(2, item.height * 0.3)) last.items.push(item);
      else rows.push({ y: item.y, items: [item] });
    }
    let referenceY = null;
    const lines = [];
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      // A reference number owns the whole baseline, including a DOI separated
      // from its citation text by a large horizontal gap.
      if (/^(?:\[\d{1,4}\]|\d{1,4}[.)])(?:\s|$)/u.test(row.items[0].str.trim())) continue;
      let line = null;
      for (const item of row.items) {
        const gap = line ? item.x - line.right : Infinity;
        let completedDoi = false;
        let identifierContinuation = false;
        let ambiguousContinuation = false;
        // A complete DOI sidebar may share a baseline with article authors.
        // Continue contiguous identifier fragments, but do not join a complete
        // labelled identifier across visible whitespace into another column.
        if (line && gap > item.height * 0.2) {
          try { completedDoi = Boolean(firstPageDoi(line.raw)); } catch (_) {}
        }
        if (completedDoi && gap <= item.height &&
            /^[a-z0-9._;()/:+-]+$/iu.test(item.str.trim())) {
          // DOI syntax also accepts prefixes ending in punctuation. A nearby
          // punctuation-bound fragment must continue the identifier. A word
          // without a proven boundary could instead be an author: keep it in
          // the line as explicit ambiguity, never finalize the shorter DOI.
          identifierContinuation = /[-._;(/:]$/u.test(line.raw.trim()) ||
            /^[-._;(/:]/u.test(item.str.trim());
          ambiguousContinuation = !identifierContinuation;
          completedDoi = false;
        }
        if (!line || completedDoi || gap > Math.max(24, item.height * 2.5)) {
          line = { raw: '', items: [], right: item.x, y: row.y };
          lines.push(line);
        }
        const separator = ambiguousContinuation ? ' ' :
          line.raw && !identifierContinuation && gap > item.height * 0.2 ? ' ' : '';
        line.raw += separator + item.str;
        line.items.push(item);
        line.right = Math.max(line.right, item.x + item.width);
      }
    }
    for (const line of lines) {
      if (/^(?:references?|bibliography|literature\s+cited)\b/iu.test(line.raw.trim())) {
        referenceY = referenceY === null ? line.y : Math.max(referenceY, line.y);
      }
    }
    for (const line of lines) {
      if (referenceY !== null && line.y <= referenceY) continue;
      const bounds = [Math.min(...line.items.map(item => item.x)),
        Math.min(...line.items.map(item => item.y)), line.right,
        Math.max(...line.items.map(item => item.y + item.height))];
      const source = band(bounds, view);
      if (!source || !/^(?:doi(?:\s*:|\s)|https?:\/\/(?:dx\.)?doi\.org\/)/iu.test(line.raw.trim())) continue;
      const doi = firstPageDoi(line.raw);
      if (!doi) continue;
      append({ source, raw: rawString(line.raw), value: doi, pageNumber: 1,
        itemIndices: line.items.map(item => item.index).sort((a, b) => a - b), bounds, pageView: view.slice() });
    }
  }
  function extractPdfArticleDoiEvidence(input = {}) {
    let binding = { documentHash: '', documentGeneration: 0 };
    const evidence = [];
    let reason = '';
    const appendEvidence = item => {
      if (evidence.length >= LIMITS.maxEvidence) fail('bounds');
      evidence.push(item);
    };
    try {
      const data = descriptors(input);
      binding = bindingFrom(data);
      try {
        collectMetadata(own(data, 'metadata'), (raw, source, identifier) => {
          const value = doiValue(raw, identifier);
          if (value) appendEvidence({ source, raw, value });
        });
      } catch (error) { reason = REASONS.has(error.message) ? error.message : 'invalid'; }
      try { collectFirstPage(own(data, 'firstPage'), appendEvidence); }
      catch (error) {
        const pageReason = REASONS.has(error.message) ? error.message : 'invalid';
        if (!reason || pageReason === 'bounds' || pageReason === 'inconsistent') reason = pageReason;
      }
      return result(binding, evidence, reason);
    } catch (error) {
      return result(binding, evidence, REASONS.has(error.message) ? error.message : 'invalid');
    }
  }
  function normalizePdfArticleDoiEvidence(value, expectedBinding) {
    try {
      const data = descriptors(value, 8);
      const binding = bindingFrom(data);
      const expected = bindingFrom(descriptors(expectedBinding));
      if (binding.documentHash !== expected.documentHash ||
          binding.documentGeneration !== expected.documentGeneration ||
          Reflect.ownKeys(data).length !== 8 || own(data, 'schemaVersion') !== 1 ||
          own(data, 'type') !== TYPE) return null;
      const reason = own(data, 'reason');
      if (!REASONS.has(reason) || reason === 'inconsistent') return null;
      const evidence = array(own(data, 'evidence'), LIMITS.maxEvidence).map(entry => {
        const fields = descriptors(entry, 7);
        const source = own(fields, 'source');
        const raw = rawString(own(fields, 'raw'));
        let doi;
        const out = { source, raw, value: '' };
        if (typeof source !== 'string') fail('invalid');
        if (/^info:(?:Custom\.)?doi$/iu.test(source) ||
            (source.startsWith('xmp:') && XMP_KEYS.has(source.slice(4)))) {
          if (Reflect.ownKeys(fields).length !== 3) fail('invalid');
          doi = doiValue(raw, source === 'xmp:dc:identifier');
        } else if (['first-page-header', 'first-page-footer'].includes(source)) {
          if (Reflect.ownKeys(fields).length !== 7 || own(fields, 'pageNumber') !== 1) fail('invalid');
          const view = pageView(own(fields, 'pageView'));
          const bounds = array(own(fields, 'bounds'), 4);
          const indices = array(own(fields, 'itemIndices'), LIMITS.maxItems);
          if (bounds.length !== 4 || !bounds.every(Number.isFinite) || band(bounds, view) !== source ||
              !indices.length || !indices.every((index, offset) => Number.isSafeInteger(index) &&
                index >= 0 && index < LIMITS.maxItems && (!offset || index > indices[offset - 1]))) fail('invalid');
          doi = firstPageDoi(raw);
          Object.assign(out, { pageNumber: 1, itemIndices: indices, bounds, pageView: view });
        } else fail('invalid');
        if (!doi || own(fields, 'value') !== doi) fail('invalid');
        out.value = doi;
        return out;
      });
      // Preserve failed extraction states; remaining valid proofs do not erase
      // malformed/oversized candidates that were excluded from saved raw text.
      const derived = result(binding, evidence, ['invalid', 'bounds'].includes(reason) ? reason : '');
      return own(data, 'status') === derived.status && own(data, 'value') === derived.value &&
        reason === derived.reason ? derived : null;
    } catch (_) { return null; }
  }
  return { PDF_ARTICLE_DOI_EVIDENCE_LIMITS: LIMITS,
    extractPdfArticleDoiEvidence, normalizePdfArticleDoiEvidence };
});
