
;/* native/core/abbreviation-lookup.js */
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


;/* native/core/translation-checkpoint.js */
(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessTranslationCheckpoint = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';
  const VERSION = 1;
  const LOCAL_SIGNATURE = 'browser-translator:en:zh:validated-prefix-v2';
  function navigationIdentity(value) {
    try { const url = new URL(value); url.hash = ''; return url.href; }
    catch { return String(value || '').replace(/#.*/, ''); }
  }
  function stableBinding(value) {
    const url = navigationIdentity(value?.pageUrl || value?.navigationIdentity || value?.url);
    if (!/^https?:\/\//u.test(url)) return null;
    return { url, ...(typeof value?.documentHash === 'string' && value.documentHash
      ? { documentHash: value.documentHash } : {}) };
  }
  function sourceKey(element) {
    const path = [];
    for (let node = element; node?.nodeType === 1; node = node.parentElement) {
      const tag = String(node.tagName || '').toLowerCase();
      if (!tag) return null;
      // Plugin output never changes paragraph positions in this anchor.
      const siblings = [...(node.parentElement?.children || node.parentElement?.childNodes || [])]
        .filter(item => item.nodeType === 1 && item.tagName === node.tagName &&
          !item.matches?.('[data-sci-plugin-ui],[data-sci-translation]'));
      path.unshift(`${tag}:${Math.max(0, siblings.indexOf(node))}`);
      if (path.length > 64) return null;
    }
    return path.length ? `dom:${path.join('/')}` : null;
  }
  function normalizeScientificContext(sourceText, value) {
    if (value == null || value === '') return [];
    if (!Array.isArray(value) || value.length > 2000 || JSON.stringify(value).length > 200000) throw error('TRANSLATION_INVALID_REQUEST');
    let end = 0;
    return value.flatMap(item => {
      if (!item || Object.keys(item).some(key => !['sourceStart','sourceEnd','text','displayText'].includes(key)) ||
          !Number.isSafeInteger(item.sourceStart) || item.sourceStart < end || !Number.isSafeInteger(item.sourceEnd) ||
          item.sourceEnd <= item.sourceStart || item.sourceEnd > sourceText.length ||
          typeof item.text !== 'string' || item.text !== sourceText.slice(item.sourceStart, item.sourceEnd) ||
          typeof item.displayText !== 'string') throw error('TRANSLATION_INVALID_REQUEST');
      end = item.sourceEnd;
      const displayText = item.displayText.trim();
      return !displayText || displayText === item.text ? [] : [{sourceStart:item.sourceStart, sourceEnd:item.sourceEnd, text:item.text, displayText}];
    });
  }
  function sliceScientificContext(sourceText, value, start, end) {
    return normalizeScientificContext(sourceText, value).flatMap(item => {
      if (item.sourceEnd <= start || item.sourceStart >= end) return [];
      if (item.sourceStart < start || item.sourceEnd > end) throw error('TRANSLATION_INVALID_REQUEST');
      return [{...item, sourceStart:item.sourceStart-start, sourceEnd:item.sourceEnd-start}];
    });
  }
  function normalizeEntry(value) {
    if (!value || typeof value.sourceKey !== 'string' || !value.sourceKey ||
        typeof value.sourceText !== 'string' || !value.sourceText || value.sourceText.length > 200000 ||
        typeof value.translatedText !== 'string' || !value.translatedText.trim() || value.translatedText.length > 200000 ||
        value.sourceStart !== 0 || !Number.isInteger(value.sourceEnd) || value.sourceEnd <= 0 || value.sourceEnd > value.sourceText.length ||
        typeof value.engineSignature !== 'string' || !value.engineSignature ||
        value.sourceLanguage !== 'en' || value.targetLanguage !== 'zh' || value.confirmed !== true) return null;
    let scientificContext;
    try { scientificContext = normalizeScientificContext(value.sourceText, value.scientificContext);
      sliceScientificContext(value.sourceText, scientificContext, 0, value.sourceEnd); }
    catch { return null; }
    const partial = value.sourceEnd < value.sourceText.length;
    // Manual edits remain valid confirmed output but never become native-model prefixes.
    return { sourceKey: value.sourceKey, sourceText: value.sourceText, translatedText: value.translatedText,
      sourceStart: 0, sourceEnd: value.sourceEnd, partial, sourceLanguage: 'en', targetLanguage: 'zh',
      engineSignature: value.engineSignature, confirmed: true, manuallyEdited: value.manuallyEdited === true,
      ...(scientificContext.length ? { scientificContext } : {}) };
  }
  function error(code) { return Object.assign(new Error(code), { code }); }
  async function sha256(value, cryptoApi = globalThis.crypto) {
    if (!cryptoApi?.subtle?.digest) throw error('TRANSLATION_CHECKPOINT_DIGEST_UNAVAILABLE');
    const bytes = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  // Instantiate once in the background. Serialization must span every tab, not
  // just one content script. No schema migration or deletion of older data.
  function createStore({ storage, crypto: cryptoApi = globalThis.crypto } = {}) {
    let tail = Promise.resolve();
    function serialize(run) {
      const next = tail.then(run, run); tail = next.catch(() => {}); return next;
    }
    async function keyFor(binding, engineSignature) {
      const documentBinding = stableBinding(binding);
      if (!documentBinding || typeof engineSignature !== 'string' || !engineSignature) throw error('TRANSLATION_CHECKPOINT_IDENTITY_REQUIRED');
      return { documentBinding, key: 'brevess.translation.checkpoint.v1.' + await sha256(JSON.stringify([documentBinding, engineSignature]), cryptoApi) };
    }
    function read(binding, engineSignature) { return serialize(async () => {
      const { key, documentBinding } = await keyFor(binding, engineSignature);
      const saved = (await storage.get(key))?.[key];
      if (!saved) return { version: VERSION, documentBinding, engineSignature, revision: 0, translations: [] };
      if (saved.version !== VERSION || JSON.stringify(saved.documentBinding) !== JSON.stringify(documentBinding) || saved.engineSignature !== engineSignature) {
        throw error('TRANSLATION_CHECKPOINT_IDENTITY_MISMATCH');
      }
      return { version: VERSION, documentBinding, engineSignature, revision: Number(saved.revision) || 0,
        translations: (Array.isArray(saved.translations) ? saved.translations : []).map(normalizeEntry).filter(Boolean) };
    }); }
    function write(binding, engineSignature, incoming, { expectedRevision } = {}) { return serialize(async () => {
      const { key, documentBinding } = await keyFor(binding, engineSignature);
      const saved = (await storage.get(key))?.[key];
      if (saved && (saved.version !== VERSION || JSON.stringify(saved.documentBinding) !== JSON.stringify(documentBinding) || saved.engineSignature !== engineSignature)) {
        throw error('TRANSLATION_CHECKPOINT_IDENTITY_MISMATCH');
      }
      if (expectedRevision !== undefined && expectedRevision !== (Number(saved?.revision) || 0)) throw error('TRANSLATION_CHECKPOINT_REVISION_STALE');
      const identity = entry => JSON.stringify([entry.sourceKey, entry.sourceText,
        ...(entry.scientificContext ? [entry.scientificContext] : [])]);
      const entries = new Map((saved?.translations || []).map(normalizeEntry).filter(Boolean).map(entry => [identity(entry), entry]));
      for (const value of incoming || []) {
        const entry = normalizeEntry(value);
        if (!entry || entry.engineSignature !== engineSignature) continue;
        const old = entries.get(identity(entry));
        // Automatic writes cannot replace manual output or regress a prefix.
        if (old?.sourceText === entry.sourceText && ((old.manuallyEdited && !(entry.manuallyEdited && expectedRevision !== undefined)) ||
            (!entry.manuallyEdited && old.sourceEnd > entry.sourceEnd))) continue;
        entries.set(identity(entry), entry);
      }
      const translations = [...entries.values()];
      if (translations.length > 2000 || JSON.stringify(translations).length > 2000000) throw error('TRANSLATION_CHECKPOINT_LIMIT');
      const result = { version: VERSION, documentBinding, engineSignature,
        revision: (Number(saved?.revision) || 0) + 1, translations };
      await storage.set({ [key]: result }); return result;
    }); }
    return { read, write };
  }
  return { VERSION, LOCAL_SIGNATURE, stableBinding, sourceKey, normalizeEntry, createStore, normalizeScientificContext, sliceScientificContext };
});

