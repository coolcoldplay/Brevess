(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';

  const ARTICLE_BIBLIOGRAPHY_ASSET_PATH = 'article/bibliography.json';
  const MAX_HEAD_META = 256;
  const MAX_EVIDENCE = 32;
  const JOURNAL_KEYS = new Set(['citation_journal_title', 'prism.publicationname']);
  const DATE_KEYS = new Set(['citation_publication_date', 'citation_date', 'prism.publicationdate']);
  const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u;
  const UNKNOWN_REASONS = new Set(['missing', 'conflict', 'invalid', 'bounds']);

  function plainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  }

  // The caller supplies its established workspace canonical URL. Validate it
  // without resolving aliases, sorting queries or inventing another identity.
  function verifiedUrl(value) {
    if (typeof value !== 'string' || !value || value.length > 4096 ||
        value.trim() !== value || UNSAFE_TEXT.test(value) || !/^https?:\/\//iu.test(value)) return '';
    try {
      const url = new URL(value);
      return /^https?:$/u.test(url.protocol) && !url.username && !url.password ? value : '';
    } catch (_) { return ''; }
  }

  function rawText(value, field) {
    const max = field === 'journal' ? 512 : 128;
    if (typeof value !== 'string') return { error: 'invalid' };
    if (value.length > max) return { error: 'bounds' };
    if (UNSAFE_TEXT.test(value)) return { error: 'invalid' };
    const raw = value.normalize('NFC');
    if (raw.length > max) return { error: 'bounds' };
    return { raw };
  }

  function unknown(field, reason, evidence = []) {
    const result = { status: 'unknown', value: '', raw: '', source: '', reason, evidence };
    if (field === 'publicationDate') Object.assign(result, {
      precision: 'unknown', year: null, month: null, day: null
    });
    return result;
  }

  function parseDate(raw) {
    const match = /^(\d{4})(?:([-\/])(\d{2})(?:\2(\d{2}))?)?$/u.exec(raw.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = match[3] === undefined ? null : Number(match[3]);
    const day = match[4] === undefined ? null : Number(match[4]);
    if (year < 1 || year > 9999 || (month !== null && (month < 1 || month > 12))) return null;
    if (day !== null) {
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (day < 1 || day > days[month - 1]) return null;
    }
    const precision = day !== null ? 'day' : month !== null ? 'month' : 'year';
    const value = match[1] + (month === null ? '' : `-${match[3]}`) + (day === null ? '' : `-${match[4]}`);
    return { value, precision, year, month, day };
  }

  function deriveField(field, evidence, forcedReason = '') {
    if (forcedReason) return unknown(field, forcedReason, evidence);
    if (!evidence.length) return unknown(field, 'missing');
    const parsed = evidence.map(item => field === 'journal'
      ? { value: item.raw.trim() } : parseDate(item.raw));
    if (parsed.some(item => !item || !item.value)) return unknown(field, 'invalid', evidence);
    if (parsed.some(item => item.value !== parsed[0].value)) return unknown(field, 'conflict', evidence);
    return {
      status: 'known', ...parsed[0], raw: evidence[0].raw, source: evidence[0].source,
      reason: '', evidence
    };
  }

  /**
   * Read explicit article-level head meta only. JSON-LD, body microdata,
   * modified dates, copyright, title/domain guesses and locale date parsing
   * are deliberately unsupported. `title` is reserved for future verified
   * ownership support; its presence never authorizes a related-paper guess.
   */
  function extractArticleBibliography(documentRef, options = {}) {
    const canonicalUrl = verifiedUrl(options?.canonicalUrl);
    const fields = { journal: [], publicationDate: [] };
    const reasons = { journal: '', publicationDate: '' };
    const finish = () => ({
      schemaVersion: 1, canonicalUrl,
      journal: deriveField('journal', fields.journal, reasons.journal),
      publicationDate: deriveField('publicationDate', fields.publicationDate, reasons.publicationDate)
    });
    if (!canonicalUrl) {
      reasons.journal = reasons.publicationDate = 'invalid';
      return finish();
    }
    try {
      const nodes = documentRef?.head?.querySelectorAll?.('meta[name],meta[property]') || [];
      if (!Number.isSafeInteger(nodes.length) || nodes.length < 0 || nodes.length > MAX_HEAD_META) {
        reasons.journal = reasons.publicationDate = 'bounds';
        return finish();
      }
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        const keys = new Set();
        for (const attr of ['name', 'property']) {
          const key = node?.getAttribute?.(attr);
          if (typeof key === 'string' && key.length <= 64) keys.add(key.trim().toLowerCase());
        }
        for (const key of keys) {
          const field = JOURNAL_KEYS.has(key) ? 'journal' : DATE_KEYS.has(key) ? 'publicationDate' : '';
          if (!field) continue;
          if (fields[field].length >= MAX_EVIDENCE) { reasons[field] = 'bounds'; continue; }
          const checked = rawText(node?.getAttribute?.('content'), field);
          if (checked.error) {
            if (reasons[field] !== 'bounds') reasons[field] = checked.error;
            continue;
          }
          if (!checked.raw.trim()) continue;
          fields[field].push({ raw: checked.raw, source: `meta:${key}` });
        }
      }
    } catch (_) {
      // A partial DOM read cannot prove that a later conflicting value is absent.
      reasons.journal = reasons.publicationDate = 'invalid';
    }
    return finish();
  }

  function normalizeField(value, field) {
    if (!plainObject(value) || !['known', 'unknown'].includes(value.status) ||
        !Array.isArray(value.evidence) || value.evidence.length > MAX_EVIDENCE ||
        (value.status === 'unknown' && !UNKNOWN_REASONS.has(value.reason))) return null;
    const allowed = field === 'journal' ? JOURNAL_KEYS : DATE_KEYS;
    const evidence = [];
    for (const item of value.evidence) {
      if (!plainObject(item) || typeof item.source !== 'string' || item.source.length > 64 ||
          !item.source.startsWith('meta:') || !allowed.has(item.source.slice(5))) return null;
      const checked = rawText(item.raw, field);
      if (checked.error || !checked.raw.trim()) return null;
      evidence.push({ raw: checked.raw, source: item.source });
    }
    // Invalid/oversized candidates were intentionally not persisted as unsafe
    // raw text. Preserve that fail-closed state rather than promoting the
    // remaining evidence to known on a JSON round trip.
    const forced = value.status === 'unknown' && ['invalid', 'bounds'].includes(value.reason) ? value.reason : '';
    const result = deriveField(field, evidence, forced);
    if (value.status === 'unknown' && result.reason !== value.reason) return null;
    return result;
  }

  function normalizeArticleBibliographyAsset(input, options = {}) {
    try {
      const workspaceId = options?.workspaceId;
      const canonicalUrl = verifiedUrl(options?.canonicalUrl);
      if (!plainObject(input) || input.schemaVersion !== 1 || !canonicalUrl ||
          typeof workspaceId !== 'string' || !/^workspace:[a-f0-9]{64}$/u.test(workspaceId) ||
          input.workspaceId !== workspaceId || input.canonicalUrl !== canonicalUrl) return null;
      const journal = normalizeField(input.journal, 'journal');
      const publicationDate = normalizeField(input.publicationDate, 'publicationDate');
      if (!journal || !publicationDate) return null;
      return { schemaVersion: 1, workspaceId, canonicalUrl, journal, publicationDate };
    } catch (_) { return null; }
  }

  return { ARTICLE_BIBLIOGRAPHY_ASSET_PATH, extractArticleBibliography, normalizeArticleBibliographyAsset };
});
