(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const ABBREVIATION_LOOKUP_KEY = 'brevessAbbreviationLookupSitesV1';
  const defaults = [
    { id: 'wikipedia', name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Special:Search?search={query}&go=Go' },
    { id: 'google', name: 'Google', url: 'https://www.google.com/search?q={query}' },
    { id: 'bing', name: '必应', url: 'https://www.bing.com/search?q={query}' }
  ];
  function normalizeAbbreviationLookupUrl(value) {
    let text = String(value || '').trim().replace(/%7Bquery%7D/gi, '{query}').replace(/%s/g, '{query}');
    if (!/^\w+:/.test(text)) text = 'https://' + text;
    let url;
    try { url = new URL(text.replaceAll('{query}', 'BREVESS_QUERY_TOKEN')); }
    catch { throw new Error('请输入有效的查词网址。'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
        url.hostname.includes('brevess_query_token') || text.length > 2048) {
      throw new Error('查词网址仅支持不含账户信息的 http 或 https 页面。');
    }
    if (!text.includes('{query}')) {
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (/^(?:[a-z-]+\.)?wikipedia\.org$/.test(host)) {
        const wiki = host === 'wikipedia.org' ? 'en.wikipedia.org' : url.hostname;
        text = `https://${wiki}/wiki/Special:Search?search={query}&go=Go`;
      } else if (/^google\.(?:com|cn|co\.uk|com\.hk)$/.test(host)) {
        text = `${url.origin}/search?q={query}`;
      } else if (host === 'bing.com' || host === 'cn.bing.com') {
        text = `${url.origin}/search?q={query}`;
      } else throw new Error('自定义网站请在搜索网址中用 {query} 代替查词内容。');
    }
    return text;
  }
  function normalizeAbbreviationLookupSettings(value) {
    if (value == null) return { schemaVersion: 1, defaultSiteId: 'wikipedia', sites: defaults.map(site => ({ ...site })) };
    if (!Array.isArray(value.sites) || !value.sites.length || value.sites.length > 20) {
      throw new Error('请保留 1–20 个查词网站。');
    }
    const ids = new Set();
    const sites = value.sites.map((site, index) => {
      const id = String(site?.id || `site-${index}`).slice(0, 80);
      if (ids.has(id)) throw new Error('网站标识重复，请删除后重新添加。');
      ids.add(id);
      const name = String(site?.name || '').trim().slice(0, 60);
      if (!name) throw new Error(`请填写第 ${index + 1} 个网站的名称。`);
      return { id, name, url: normalizeAbbreviationLookupUrl(site.url) };
    });
    if (!ids.has(value.defaultSiteId)) throw new Error('请选择一个默认查词网站。');
    return { schemaVersion: 1, defaultSiteId: value.defaultSiteId, sites };
  }
  function abbreviationLookupTarget(settings, entry) {
    const config = normalizeAbbreviationLookupSettings(settings);
    const site = config.sites.find(item => item.id === config.defaultSiteId);
    const query = String(entry?.fullName || entry?.abbreviation || '').trim();
    if (!query) throw new Error('该行没有可查询的词语。');
    return { name: site.name, query, url: site.url.replaceAll('{query}', encodeURIComponent(query)) };
  }
  function bindAbbreviationLookupGesture(element, options = {}) {
    const doc = element.ownerDocument, view = doc.defaultView;
    let holdTimer, clickTimer, pointer = null, suppressClick = false;
    const listeners = [];
    const on = (target, type, fn) => { target.addEventListener(type, fn); listeners.push(() => target.removeEventListener(type, fn)); };
    const cancelHold = (suppress = false) => {
      if (suppress && pointer) suppressClick = true;
      clearTimeout(holdTimer); pointer = null; element.classList.remove('is-lookup-pressing');
    };
    const cancel = () => { cancelHold(true); clearTimeout(clickTimer); };
    const usable = () => element.isConnected && (options.canRun?.() ?? true);
    on(element, 'pointerdown', event => {
      if (event.button !== 0 || event.isPrimary === false) return;
      cancel(); suppressClick = false;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      if (!options.onHold) return;
      element.classList.add('is-lookup-pressing');
      holdTimer = setTimeout(() => {
        if (!pointer || !usable()) return cancelHold();
        suppressClick = true; cancelHold(); options.onHold();
      }, 1000);
    });
    on(doc, 'pointermove', event => {
      if (pointer && event.pointerId === pointer.id && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8) {
        suppressClick = true; cancelHold();
      }
    });
    on(doc, 'pointerup', event => { if (pointer?.id === event.pointerId) cancelHold(); });
    on(doc, 'pointercancel', event => { if (pointer?.id === event.pointerId) cancel(); });
    on(element, 'pointerleave', () => cancelHold(true));
    on(element, 'lostpointercapture', () => cancelHold(true));
    on(view, 'blur', cancel);
    on(doc, 'visibilitychange', () => { if (doc.hidden) cancel(); });
    on(element, 'click', event => {
      // A fresh keyboard activation has no pointerdown to retire the old hold flag.
      // Keep suppressing pointer compatibility clicks, but not explicit keyboard clicks.
      if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); return; }
      clearTimeout(clickTimer);
      if (event.detail > 1) return;
      if (event.detail === 0) { cancelHold(); if (usable()) options.onClick?.(); return; }
      clickTimer = setTimeout(() => { if (usable()) options.onClick?.(); }, 500);
    });
    on(element, 'dblclick', event => {
      if (suppressClick) { event.preventDefault(); event.stopPropagation(); }
      cancel();
    });
    on(element, 'keydown', event => {
      if (event.key === 'Escape') { cancel(); return; }
      if (event.altKey && event.key === 'Enter' && options.onHold) { event.preventDefault(); event.stopPropagation(); cancel(); if (usable() && !event.repeat) options.onHold(); }
    });
    return () => { cancel(); listeners.forEach(remove => remove()); };
  }
  function bindAbbreviationRowEditors(row, { height = 60, onHeightChange } = {}) {
    const inputs = [...row.querySelectorAll('textarea.abbreviation-meaning-input')];
    const view = row.ownerDocument.defaultView;
    let observer, disposed = false;
    const sizes = new Map();
    const sync = value => {
      const next = Math.max(60, Math.round(Number(value) || 60));
      for (const input of inputs) { sizes.set(input, next); input.style.height = next + 'px'; }
      onHeightChange?.(next);
    };
    sync(height);
    if (view.ResizeObserver) {
      observer = new view.ResizeObserver(entries => {
        if (disposed) return;
        for (const entry of entries) {
          const next = entry.target.getBoundingClientRect().height;
          if (next >= 60 && Math.abs(next - sizes.get(entry.target)) > 1) { sync(next); break; }
        }
      });
      inputs.forEach(input => observer.observe(input));
    }
    return () => { disposed = true; observer?.disconnect(); };
  }
  return { ABBREVIATION_LOOKUP_KEY, normalizeAbbreviationLookupUrl, normalizeAbbreviationLookupSettings,
    abbreviationLookupTarget, bindAbbreviationLookupGesture, bindAbbreviationRowEditors };
});
