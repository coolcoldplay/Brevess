(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessLibraryTransfer = Object.assign(root.BrevessLibraryTransfer || {}, api);
})(globalThis, function() {
  'use strict';
  const SCHEMA = 'brevess-library-transfer-v1';
  const VERSION = 1;
  const MAX_BYTES = 16 * 1024 * 1024;
  const MAX_DEPTH = 32;
  const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const SENSITIVE_KEY = /(?:^|_)(?:token|secret|password|cookie|authorization|api_?key|credential)(?:$|_)/iu;
  const BINARY_KEY = /^(?:bytes?|base64|data_?url|blob|array_?buffer|pdf_?bytes|pdf_?base64|localstorage|local_storage)$/iu;
  const KINDS = new Set(['radar', 'global-library', 'combined']);
  const transferError = (code, message = code, details = undefined) => {
    const error = Object.assign(new Error(message), { code });
    if (details !== undefined) error.details = details;
    return error;
  };
  const plain = value => value !== null && typeof value === 'object' &&
    !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const clone = value => JSON.parse(JSON.stringify(value));
  const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const byteLength = value => {
    const text = String(value);
    if (globalThis.TextEncoder) return new globalThis.TextEncoder().encode(text).length;
    return unescape(encodeURIComponent(text)).length;
  };
  function normalizePmid(value) {
    const text = normalize(value);
    const direct = /^\d{5,12}$/u.test(text) ? text : '';
    if (direct) return direct;
    const match = /(?:pubmed\.ncbi\.nlm\.nih\.gov\/|pmid[:\s]*)(\d{5,12})/iu.exec(text);
    return match ? match[1] : '';
  }
  function normalizeDoi(value) {
    const text = normalize(value).toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, '');
    return /^10\.\d{4,9}\/\S+$/u.test(text) ? text : '';
  }
  function titleKey(value) {
    const text = normalize(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    return text ? `title:${text}` : '';
  }
  function identityKey(value = {}) {
    const pmid = normalizePmid(value.pmid || value.id || value.url);
    if (pmid) return `pmid:${pmid}`;
    const doi = normalizeDoi(value.doi);
    if (doi) return `doi:${doi}`;
    return titleKey(value.title);
  }
  function allIdentityKeys(value = {}) {
    return [...new Set([
      normalizePmid(value.pmid || value.id || value.url) ? `pmid:${normalizePmid(value.pmid || value.id || value.url)}` : '',
      normalizeDoi(value.doi) ? `doi:${normalizeDoi(value.doi)}` : '',
      titleKey(value.title)
    ].filter(Boolean))];
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!plain(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  function digest(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(canonical(value));
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  function inspect(value, depth = 0, seen = new Set()) {
    if (depth > MAX_DEPTH) throw transferError('LIBRARY_TRANSFER_TOO_DEEP');
    if (value === null || ['string', 'boolean'].includes(typeof value)) return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object') throw transferError('LIBRARY_TRANSFER_INVALID');
    if (seen.has(value)) throw transferError('LIBRARY_TRANSFER_CYCLE');
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) inspect(item, depth + 1, seen);
    } else {
      if (!plain(value)) throw transferError('LIBRARY_TRANSFER_INVALID');
      for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key)) throw transferError('LIBRARY_TRANSFER_PROTOTYPE_KEY', key);
        if (SENSITIVE_KEY.test(key)) throw transferError('LIBRARY_TRANSFER_SENSITIVE_FIELD', key);
        if (BINARY_KEY.test(key)) throw transferError('LIBRARY_TRANSFER_BINARY_FIELD', key);
        inspect(child, depth + 1, seen);
      }
    }
    seen.delete(value);
  }
  function validateEnvelope(bundle, { expectedKind = null } = {}) {
    inspect(bundle);
    if (!plain(bundle) || bundle.schema !== SCHEMA || bundle.version !== VERSION) {
      throw transferError('LIBRARY_TRANSFER_VERSION', '不支持或缺少 brevess-library-transfer-v1 envelope。');
    }
    if (!KINDS.has(bundle.kind) || expectedKind && bundle.kind !== expectedKind) {
      throw transferError('LIBRARY_TRANSFER_KIND', 'transfer kind 不匹配。');
    }
    if (!plain(bundle.payload) || typeof bundle.generatedAt !== 'string' ||
        !Number.isFinite(Date.parse(bundle.generatedAt))) {
      throw transferError('LIBRARY_TRANSFER_INVALID', 'transfer payload 或时间戳无效。');
    }
    const bytes = byteLength(JSON.stringify(bundle));
    if (bytes > MAX_BYTES) {
      throw transferError('LIBRARY_TRANSFER_TOO_LARGE', `transfer 超过 ${MAX_BYTES} bytes。`);
    }
    if (bundle.integrity !== undefined) {
      if (!plain(bundle.integrity) || bundle.integrity.algorithm !== 'fnv1a32' ||
          typeof bundle.integrity.digest !== 'string' ||
          digest(withoutIntegrity(bundle)) !== bundle.integrity.digest) {
        throw transferError('LIBRARY_TRANSFER_INTEGRITY', 'transfer 完整性校验失败。');
      }
    }
    return clone(bundle);
  }
  function withoutIntegrity(bundle) {
    const copy = clone(bundle);
    delete copy.integrity;
    return copy;
  }
  function makeEnvelope({ kind, payload, generatedAt = new Date().toISOString(), source = {} }) {
    const value = {
      schema: SCHEMA,
      version: VERSION,
      kind,
      generatedAt,
      source,
      payload
    };
    value.integrity = { algorithm: 'fnv1a32', digest: digest(value) };
    return validateEnvelope(value);
  }
  function combineTransfers(radarBundle, globalBundle, { now = Date.now } = {}) {
    const radar = validateEnvelope(radarBundle, { expectedKind: 'radar' });
    const global = validateEnvelope(globalBundle, { expectedKind: 'global-library' });
    const at = typeof now === 'function' ? now() : now;
    return makeEnvelope({
      kind: 'combined',
      generatedAt: new Date(at).toISOString(),
      source: { app: 'brevess', combined: true, copiesBinary: false },
      payload: {
        radars: radar.payload.radars,
        entries: global.payload.entries
      }
    });
  }
  function splitCombinedTransfer(bundle) {
    const combined = validateEnvelope(bundle, { expectedKind: 'combined' });
    if (!Array.isArray(combined.payload.radars) || !Array.isArray(combined.payload.entries)) {
      throw transferError('LIBRARY_TRANSFER_INVALID', 'combined transfer 缺少 radars 或 entries。');
    }
    return {
      radar: makeEnvelope({
        kind: 'radar', generatedAt: combined.generatedAt,
        source: combined.source, payload: { radars: combined.payload.radars }
      }),
      global: makeEnvelope({
        kind: 'global-library', generatedAt: combined.generatedAt,
        source: combined.source, payload: { entries: combined.payload.entries }
      })
    };
  }
  function sanitizeString(value, max = 12000) {
    if (value === undefined || value === null) return '';
    return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').slice(0, max);
  }
  function sanitizeStringArray(value, maximumItems = 64, maximumLength = 2000) {
    return [...new Set((Array.isArray(value) ? value : []).map(item => sanitizeString(item, maximumLength))
      .filter(Boolean))].slice(0, maximumItems);
  }
  return {
    LIBRARY_TRANSFER_SCHEMA: SCHEMA,
    LIBRARY_TRANSFER_VERSION: VERSION,
    LIBRARY_TRANSFER_MAX_BYTES: MAX_BYTES,
    transferError,
    plain,
    clone,
    normalize,
    normalizePmid,
    normalizeDoi,
    titleKey,
    identityKey,
    allIdentityKeys,
    canonical,
    digest,
    inspect,
    validateEnvelope,
    makeEnvelope,
    combineTransfers,
    splitCombinedTransfer,
    sanitizeString,
    sanitizeStringArray
  };
});
