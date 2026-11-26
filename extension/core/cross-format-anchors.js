(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';
  // These links authorize a local anchoring attempt only. Callers must separately
  // verify current resource ACLs and read the latest association revision.
  function fail(code) { throw Object.assign(new Error(code), { code }); }
  function record(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_ASSOCIATION');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail('INVALID_ASSOCIATION');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' ||
        !keys.includes(key) || !Object.hasOwn(descriptors[key], 'value'))) fail('INVALID_ASSOCIATION');
    return value;
  }
  function string(value, max, code = 'INVALID_ASSOCIATION') {
    if (typeof value !== 'string' || !value.trim() || value.length > max) fail(code);
    return value.trim();
  }
  function hash(value) {
    if (typeof value !== 'string' || !/^(?:sha256:)?[a-f0-9]{64}$/iu.test(value)) fail('INVALID_SOURCE_HASH');
    return value.replace(/^sha256:/iu, '').toLowerCase();
  }
  function normalizeDoi(value) {
    let doi = string(value, 400, 'INVALID_PAPER_ID').normalize('NFKC');
    if (/^https?:/iu.test(doi)) {
      let url; try { url = new URL(doi); } catch (_) { fail('INVALID_PAPER_ID'); }
      if (!/^(?:dx\.)?doi\.org$/iu.test(url.hostname) || url.username || url.password || url.search || url.hash) fail('INVALID_PAPER_ID');
      try { doi = decodeURIComponent(url.pathname.slice(1)); } catch (_) { fail('INVALID_PAPER_ID'); }
    }
    doi = doi.replace(/^doi\s*:\s*/iu, '').trim().toLowerCase();
    if (doi.length > 300 || !/^10\.\d{4,9}\/[^\s?#]+$/u.test(doi)) fail('INVALID_PAPER_ID');
    return doi;
  }
  function normalizeSource(value) {
    record(value, ['documentHash', 'documentId', 'doi', 'format', 'role']);
    if (!['html', 'pdf'].includes(value.format) || value.role !== 'main') fail('INVALID_SOURCE_ROLE');
    const source = { documentHash: hash(value.documentHash) };
    if (value.documentId !== undefined) source.documentId = 'sha256:' + hash(value.documentId);
    return { ...source, doi: normalizeDoi(value.doi), format: value.format, role: value.role };
  }
  function normalizeScope(value) {
    record(value, ['kind', 'endpoint', 'userId']);
    if (value.kind === 'local' && Object.keys(value).length === 1) return { kind: 'local' };
    if (value.kind !== 'account') fail('INVALID_ASSOCIATION_SCOPE');
    const userId = string(value.userId, 200, 'INVALID_ASSOCIATION_SCOPE');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(userId)) fail('INVALID_ASSOCIATION_SCOPE');
    let url; try { url = new URL(value.endpoint); } catch (_) { fail('INVALID_ASSOCIATION_SCOPE'); }
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
        !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) fail('INVALID_ASSOCIATION_SCOPE');
    return { kind: 'account', endpoint: url.origin, userId };
  }
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  function createCrossFormatAssociation(input) {
    record(input, ['id', 'source', 'target', 'scope']);
    const id = string(input.id, 200);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(id)) fail('INVALID_ASSOCIATION');
    const source = normalizeSource(input.source), target = normalizeSource(input.target);
    if (source.doi !== target.doi) fail('PAPER_ID_MISMATCH');
    if (source.documentHash === target.documentHash) fail('SOURCE_IDENTITIES_EQUAL');
    return { schemaVersion: 1, id, revision: 1, state: 'active', paperKey: 'doi:' + source.doi,
      source, target, scope: normalizeScope(input.scope) };
  }
  function normalizeAssociation(value) {
    record(value, ['schemaVersion', 'id', 'revision', 'state', 'paperKey', 'source', 'target', 'scope']);
    const result = createCrossFormatAssociation({ id: value.id, source: value.source, target: value.target, scope: value.scope });
    if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
        !['active', 'revoked'].includes(value.state) || value.paperKey !== result.paperKey) fail('INVALID_ASSOCIATION');
    return { ...result, revision: value.revision, state: value.state };
  }
  function revokeCrossFormatAssociation(value, expectedRevision) {
    const association = normalizeAssociation(value);
    if (association.revision !== expectedRevision) fail('STALE_ASSOCIATION');
    if (association.state === 'revoked') return association;
    if (association.revision === Number.MAX_SAFE_INTEGER) fail('INVALID_ASSOCIATION');
    return { ...association, revision: association.revision + 1, state: 'revoked' };
  }

  const graphemes = typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter(undefined, {granularity:'grapheme'}) : null;
  function normalizedText(text, joinLineHyphens = false) {
    const omitted = new Set();
    if (joinLineHyphens) {
      // Only visible line-end hyphens between letters are candidates. Inline
      // compounds, paragraph breaks and unrelated intervening text stay intact.
      for (const match of text.matchAll(/(\p{L})[-\u2010][ \t]*(?:\r\n|\n|\r)[ \t]*(?=\p{L})/gu)) {
        for (let i = match.index + match[1].length; i < match.index + match[0].length; i++) omitted.add(i);
      }
    }
    const segments = graphemes
      ? graphemes.segment(text)
      : (function* () { let index = 0; for (const segment of text) { yield { segment, index }; index += segment.length; } })();
    const chars = [], starts = [], ends = [];
    for (const { segment, index } of segments) {
      if (omitted.has(index)) continue;
      const value = segment.normalize('NFKC').replace(/\u00ad/gu, '');
      for (let i = 0; i < value.length; i++) {
        const char = /\s/u.test(value[i]) ? ' ' : value[i];
        if (char === ' ' && chars.at(-1) === ' ') ends[ends.length - 1] = index + segment.length;
        else { chars.push(char); starts.push(index); ends.push(index + segment.length); }
      }
    }
    return { text: chars.join(''), starts, ends };
  }
  function prepareCrossFormatText(items) {
      if (!Array.isArray(items) || !items.length || items.length > 10000) fail('INVALID_TARGET_BLOCKS');
      const ids = new Set(), blocks = [];
      let text = '';
      for (const item of items) {
        const blockId = string(item?.blockId || item?.paragraphId, 300, 'INVALID_TARGET_BLOCKS');
        if (ids.has(blockId) || typeof item.text !== 'string' || item.text.length > 500000) fail('INVALID_TARGET_BLOCKS');
        const separator = item.separatorBefore === undefined ? '\n' : item.separatorBefore;
        if (!['', ' ', '\n', '\n\n'].includes(separator)) fail('INVALID_TARGET_BLOCKS');
        ids.add(blockId);
        // PDF source items can split one word. Only a caller-supplied real
        // line boundary may turn an item-ending hyphen into a line-end hyphen.
        if (blocks.length) text += separator;
        const start = text.length;
        text += item.text;
        if (text.length > 2000000) fail('TARGET_TEXT_TOO_LARGE');
        blocks.push({ blockId, blockFingerprint: String(item.blockFingerprint || item.fingerprint || blockId),
          text: item.text, start, end: text.length });
      }
      const plain=normalizedText(text,false);
      const joined=/\p{L}[-\u2010][ \t]*(?:\r\n|\r|\n)[ \t]*(?=\p{L})/u.test(text) ? normalizedText(text,true) : plain;
      return {text,blocks,normalized:[plain,joined]};
  }
  function locateCrossFormatAnnotation(input = {}, index = null) {
    try {
      const association = normalizeAssociation(input.association);
      if (association.state !== 'active') fail('ASSOCIATION_REVOKED');
      if (association.revision !== input.expectedRevision) fail('STALE_ASSOCIATION');
      const source = normalizeSource(input.source), target = normalizeSource(input.target);
      if (!equal(normalizeScope(input.scope), association.scope)) fail('ASSOCIATION_SCOPE_CHANGED');
      if (!(equal(source, association.source) && equal(target, association.target) ||
          equal(source, association.target) && equal(target, association.source))) fail('SOURCE_IDENTITY_CHANGED');
      const quote = string(input.annotation?.quote, 20000, 'INVALID_QUOTE');
      const prefixRaw = input.annotation?.prefix ?? '', suffixRaw = input.annotation?.suffix ?? '';
      if (typeof prefixRaw !== 'string' || typeof suffixRaw !== 'string' || prefixRaw.length > 2000 || suffixRaw.length > 2000) fail('INVALID_CONTEXT');
      const prefix = normalizedText(prefixRaw, true).text.trim(), suffix = normalizedText(suffixRaw, true).text.trim();
      const needles = [...new Set([false, true].map(join => normalizedText(quote, join).text.trim()))];
      if (!needles[0]) fail('INVALID_QUOTE');
      const shortQuote = needles.every(value => value.length < 16);
      if (shortQuote && prefix.length + suffix.length < 32) fail('INSUFFICIENT_CONTEXT');
      const prepared = index || prepareCrossFormatText(input.blocks);
      const {text,blocks} = prepared;
      const candidates = new Map();
      for (const join of [false, true]) {
        const normalized = prepared.normalized[Number(join)];
        for (const needle of needles) {
          let at = normalized.text.indexOf(needle);
          while (at >= 0) {
            const last = at + needle.length - 1;
            // A normalized character can expand to several code units. A match
            // must include the entire original grapheme at both boundaries.
            if ((at === 0 || normalized.starts[at] !== normalized.starts[at - 1]) &&
                (last + 1 === normalized.ends.length || normalized.ends[last] !== normalized.ends[last + 1])) {
              const start = normalized.starts[at], end = normalized.ends[last];
              candidates.set(`${start}:${end}`, { start, end });
              if (candidates.size > 64) fail('AMBIGUOUS_QUOTE');
            }
            at = normalized.text.indexOf(needle, at + 1);
          }
        }
      }
      let matches = [...candidates.values()];
      if (!matches.length) fail('NOT_FOUND');
      if (matches.length > 1 || shortQuote) {
        if (prefix.length + suffix.length < 16) fail('AMBIGUOUS_QUOTE');
        matches = matches.filter(candidate =>
          (!prefix || normalizedText(text.slice(Math.max(0, candidate.start - 4000), candidate.start), true).text.trimEnd().endsWith(prefix)) &&
          (!suffix || normalizedText(text.slice(candidate.end, candidate.end + 4000), true).text.trimStart().startsWith(suffix)));
      }
      if (matches.length !== 1) fail(matches.length ? 'AMBIGUOUS_QUOTE' : 'CONTEXT_NOT_FOUND');
      const candidate = matches[0];
      const fragments = blocks.filter(block => block.end > candidate.start && block.start < candidate.end).map(block => {
        const startOffset = Math.max(0, candidate.start - block.start), endOffset = Math.min(block.text.length, candidate.end - block.start);
        return { blockId: block.blockId, blockFingerprint: block.blockFingerprint, startOffset, endOffset,
          quote: block.text.slice(startOffset, endOffset) };
      }).filter(fragment => fragment.endOffset > fragment.startOffset);
      if (!fragments.length) fail('NOT_FOUND');
      return { status: 'located', matchStage: 'cross_format_quote', sourceQuote: input.annotation.quote,
        associationId: association.id, associationRevision: association.revision,
        sourceHash: source.documentHash, targetHash: target.documentHash, fragments,
        ...(fragments.length === 1 ? { blockId: fragments[0].blockId, startOffset: fragments[0].startOffset,
          endOffset: fragments[0].endOffset } : {}) };
    } catch (error) {
      return { status: 'unresolved', reason: error?.code || 'INVALID_INPUT' };
    }
  }
  function normalizeCrossFormatPaperDoi(value) {
    try { return normalizeDoi(value); } catch (_) { return ''; }
  }
  function automaticCrossFormatRole(value) {
    if(value?.sourceRoleEvidence==='user-confirmed-v1')return ['main','supplement'].includes(value.sourceRole)?value.sourceRole:'';
    const p=value?.automaticPaperIdentity;
    if(!p||p.version!==1||p.doi!==normalizeCrossFormatPaperDoi(value.doi)||!p.doi||
       p.documentHash!==value.documentHash||p.format!==value.sourceFormat||
       !/^[a-f0-9]{64}$/u.test(p.documentHash||'')||
       !((p.format==='html'&&p.evidence==='article-meta-doi')||(p.format==='pdf'&&p.evidence==='pdf-own-doi')))return '';
    return 'main';
  }
  return { prepareCrossFormatText, automaticCrossFormatRole, createCrossFormatAssociation, revokeCrossFormatAssociation, locateCrossFormatAnnotation,
    normalizeCrossFormatPaperDoi, normalizeCrossFormatSource: normalizeSource };
});
