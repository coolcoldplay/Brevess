(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  // Article routes, not a blanket allowlist of publisher home pages.
  const LITERATURE_URL_RULES = Object.freeze([
    ['cell.com', /^\/[^/]+\/(?:fulltext|abstract|pdf)\/S[\d()-]+/i],
    ['thelancet.com', /^\/journals\/[^/]+\/article\/(?:PIIS|S)[\d()-]+\/fulltext/i],
    ['sciencedirect.com', /^\/science\/article\/(?:abs\/)?pii\/[A-Z0-9]+/i],
    ['nature.com', /^\/articles\/s\d{5}-\d{2,4}-[a-z0-9-]+/i],
    ['link.springer.com', /^\/(?:article|chapter)\/10\./i],
    ['onlinelibrary.wiley.com', /^\/doi\/(?:abs\/|full\/|epdf\/|pdf\/)?10\./i],
    ['journals.sagepub.com', /^\/doi\/(?:abs\/|full\/|pdf\/)?10\./i],
    ['tandfonline.com', /^\/doi\/(?:abs\/|full\/|pdf\/|epdf\/)?10\./i],
    ['academic.oup.com', /^\/[^/]+\/article(?:-abstract)?\/[^/]+\/.+/i],
    ['cambridge.org', /^\/core\/journals\/[^/]+\/article\/.+/i],
    ['ieeexplore.ieee.org', /^\/(?:abstract\/)?document\/\d+(?:\/|$)/i],
    ['dl.acm.org', /^\/doi\/(?:abs\/|full\/|pdf\/)?10\./i],
    ['pubs.acs.org', /^\/doi\/(?:abs\/|full\/|pdf\/)?10\./i],
    ['pubs.rsc.org', /^\/en\/content\/(?:articlehtml|articlepdf|articlelanding)\/\d{4}\/[^/]+\/(?!cover(?:\/|$)|contents(?:\/|$))[a-z0-9]+/i],
    ['journals.aps.org', /^\/[^/]+\/(?:abstract|pdf)\/10\./i],
    ['iopscience.iop.org', /^\/article\/10\./i],
    ['pubs.aip.org', /^\/[^/]+\/[^/]+\/article\/\d+/i],
    ['science.org', /^\/doi\/(?:abs\/|full\/|pdf\/)?10\./i],
    ['nejm.org', /^\/doi\/(?:abs\/|full\/|pdf\/)?10\./i],
    ['evidence.nejm.org', /^\/doi\/(?:abs\/|full\/|pdf\/)?10\./i],
    ['bmj.com', /^\/content\/[^/]+\/(?:[^/]+\/)?[^/]+/i],
    ['jamanetwork.com', /^\/journals\/[^/]+\/fullarticle\/\d+/i],
    ['jci.org', /^\/articles\/view\/[1-9]\d*\/?$/i],
    ['frontiersin.org', /^\/(?:journals\/[^/]+\/)?articles\/10\./i],
    ['mdpi.com', /^\/\d{4}-\d{3}[\dX]\/\d+\/\d+\/\d+/i],
    ['journals.plos.org', /^\/[^/]+\/article(?:\/|$)/i, 'id'],
    ['elife.org', /^\/articles\/\d+(?:\/|$)/i],
    ['elifesciences.org', /^\/articles\/\d+(?:\/|$)/i],
    ['peerj.com', /^\/articles\/\d+/i],
    ['pnas.org', /^\/doi\/(?:abs\/|full\/|pdf\/)?10\./i],
    ['royalsocietypublishing.org', /^\/doi\/(?:abs\/|full\/|pdf\/)?10\./i],
    ['degruyter.com', /^\/document\/doi\/10\./i],
    ['brill.com', /^\/view\/journals\/.+\/(?:article|[a-z]*[0-9]).+/i],
    ['journals.openedition.org', /^\/[^/]+\/\d+(?:\/|$)/i],
    ['scielo.br', /^\/j\/[^/]+\/a\/[^/]+/i],
    ['scielo.org', /^\/scielo\.php$/i, 'pid'],
    ['jstage.jst.go.jp', /^\/article\/.+\/(?:_article|_pdf)(?:\/|$)/i],
    ['sciengine.com', /^\/(?:doi\/|doi\/pdf\/|doi\/pdfView\/|[^/]+\/(?:articleIndex|crossref))/i],
    ['kns.cnki.net', /^\/kcms2?\/(?:detail|article)\//i],
    ['pmc.ncbi.nlm.nih.gov', /^\/articles\/PMC\d+(?:\/|$)/i],
    ['ncbi.nlm.nih.gov', /^\/pmc\/articles\/PMC\d+(?:\/|$)/i],
    ['arxiv.org', /^\/(?:abs|pdf)\/(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(?:v\d+)?(?:\.pdf)?\/?$/i],
    ['biorxiv.org', /^\/content\/(?:\d+\/)?10\.(?:1101|64898)\/.+/i],
    ['medrxiv.org', /^\/content\/(?:doi\/)?10\.(?:1101|64898)\/.+/i],
    ['medrxiv.org', /^\/content\/medrxiv\/early\/\d{4}\/\d{2}\/\d{2}\//i],
    ['chemrxiv.org', /^\/engage\/chemrxiv\/article-details\/[^/]+/i],
    ['researchsquare.com', /^\/article\/rs-\d+\/v\d+/i],
    ['papers.ssrn.com', /^\/sol3\/papers\.cfm$/i, 'abstract_id'],
    ['ssrn.com', /^\/abstract=\d+$/i],
    ['osf.io', /^\/preprints\/(?:[^/]+\/)?[a-z0-9]+\/?$/i],
    ['engrxiv.org', /^\/preprint\/view\/\d+/i],
    ['eartharxiv.org', /^\/repository\/view\/\d+/i],
    ['preprints.org', /^\/manuscript\/\d+\.\d+(?:\/v\d+)?/i],
    ['hal.science', /^\/(?:[a-z-]+\/)?(?:hal|tel|medihal)-\d+(?:v\d+)?(?:\/|$)/i]
  ]);
  function parseHttpUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null;
    } catch (_) { return null; }
  }
  function validHost(host) {
    return host.length <= 253 && host.includes('.') && host.split('.').every(label =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
  }
  function normalizeRule(input) {
    const rule = String(input || '').trim();
    if (!rule || rule.length > 2048) return null;
    if (!rule.includes('://')) {
      const wildcard = rule.startsWith('*.');
      const host = (wildcard ? rule.slice(2) : rule).toLowerCase();
      return validHost(host) ? (wildcard ? '*.' : '') + host : null;
    }
    const url = parseHttpUrl(rule);
    if (!url || !validHost(url.hostname) || url.hash || url.port ||
        /\*/.test(url.hostname) || (url.pathname.match(/\*/g) || []).length > 1 ||
        (url.pathname.includes('*') && !url.pathname.endsWith('*'))) return null;
    return url.href;
  }
  function parseLiteratureUrlWhitelist(input) {
    const lines = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
    const rules = [], errors = [];
    lines.forEach((line, index) => {
      if (!String(line || '').trim()) return;
      const normalized = normalizeRule(line);
      if (!normalized || rules.length >= 200) errors.push(index + 1);
      else if (!rules.includes(normalized)) rules.push(normalized);
    });
    return { rules, errors };
  }
  function normalizeLiteratureUrlWhitelist(input) { return parseLiteratureUrlWhitelist(input).rules; }
  function matchesCustomRule(url, rule) {
    if (!rule.includes('://')) {
      if (rule.startsWith('*.')) {
        const host = rule.slice(2);
        return url.hostname === host || url.hostname.endsWith('.' + host);
      }
      return url.hostname === rule;
    }
    const target = parseHttpUrl(rule);
    if (!target || target.origin !== url.origin) return false;
    const wildcard = target.pathname.endsWith('*');
    const path = wildcard ? target.pathname.slice(0, -1) : target.pathname;
    if (wildcard ? !url.pathname.startsWith(path) : url.pathname !== path) return false;
    return [...target.searchParams].every(([key, value]) => url.searchParams.get(key) === value);
  }
  function classifyLiteratureUrl(input, whitelist = []) {
    const url = parseHttpUrl(input);
    if (!url) return { recognized: false, source: 'unknown' };
    for (const rule of normalizeLiteratureUrlWhitelist(whitelist)) {
      if (matchesCustomRule(url, rule)) return { recognized: true, source: 'whitelist' };
    }
    for (const [host, path, query] of LITERATURE_URL_RULES) {
      if ((url.hostname === host || url.hostname.endsWith('.' + host)) &&
          path.test(url.pathname) && (!query || url.searchParams.get(query))) {
        return { recognized: true, source: 'builtin', publisherHost: host };
      }
    }
    return { recognized: false, source: 'unknown' };
  }
  return { LITERATURE_URL_RULES, classifyLiteratureUrl,
    parseLiteratureUrlWhitelist, normalizeLiteratureUrlWhitelist };
});
