
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


;/* native/core/translation-glossary.js */
/* Local terminology index for reading and translation. A model request may receive the terms matched by its own headings. */
(() => {
  'use strict';
  if (globalThis.BrevessTranslationGlossary) return;
  const key = 'sciGlobalAbbreviationMemoryV1';
  const storageCaches = new WeakMap();
  const word = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{M}\p{N}_]/u;
  const joinsWord = (text, i) =>
    i >= 0 &&
    i < text.length &&
    (word.test(text[i]) ||
      (i > 0 &&
        i + 1 < text.length &&
        /[-.‐‑]/u.test(text[i]) &&
        word.test(text[i - 1]) &&
        word.test(text[i + 1])));
  const clean = (value) => (typeof value === 'string' ? value.trim() : '');
  const empty = { find: () => [], signatures: new Map(), identity: '' };

  function compile(value, reverse = false) {
    const entries = Array.isArray(value) ? value : value?.entries;
    if (!Array.isArray(entries) || !entries.length) return empty;
    const aliases = new Map();
    function add(term, target, exact) {
      if (!term || !target || term === target || term.length > 512) return;
      const spelling = exact ? term : term.toLowerCase();
      const id = (exact ? 'a:' : 'w:') + spelling;
      if (!aliases.has(id)) aliases.set(id, [spelling, target, exact]);
      else if (aliases.get(id)[1] !== target) aliases.get(id)[1] = null;
    }
    for (const entry of entries) {
      if (!entry || entry.hiddenFromReading) continue;
      const zh = clean(entry.meaningZh),
        en = clean(entry.fullName),
        abbr = clean(entry.abbreviation);
      if (!zh) continue;
      if (reverse) add(zh, en || abbr, true);
      else {
        add(abbr, zh, true);
        add(en, zh, false);
      }
    }
    const rows = [...aliases.values()]
      .filter((row) => row[1])
      .sort(([a, , x], [b, , y]) => (a < b ? -1 : a > b ? 1 : Number(x) - Number(y)));
    if (!rows.length) return empty;
    const trie = new Map();
    for (const row of rows) {
      let node = trie;
      for (const c of row[0].toLowerCase()) {
        if (!node.has(c)) node.set(c, new Map());
        node = node.get(c);
      }
      node.set('', [...(node.get('') || []), row]);
    }
    function find(source, excluded = []) {
      const spans = [];
      let skip = 0;
      for (let i = 0; i < source.length; ) {
        while (skip < excluded.length && excluded[skip].sourceEnd <= i) skip++;
        if (excluded[skip]?.sourceStart <= i) {
          i = excluded[skip].sourceEnd;
          continue;
        }
        if (i && joinsWord(source, i - 1) && word.test(source[i])) {
          i++;
          continue;
        }
        let node = trie,
          best = null;
        for (let end = i; end < source.length && end < (excluded[skip]?.sourceStart ?? Infinity); ) {
          const c = String.fromCodePoint(source.codePointAt(end));
          end += c.length;
          node = node.get(c.toLowerCase());
          if (!node) break;
          if (!node.has('') || (end < source.length && word.test(c) && joinsWord(source, end))) continue;
          const text = source.slice(i, end);
          const row = node.get('').find(([term, , exact]) => !exact || term === text);
          if (row) best = { sourceStart: i, sourceEnd: end, text, displayText: text, target: row[1] };
        }
        if (!best) {
          i++;
          continue;
        }
        const previous = spans.at(-1);
        // Standard full-name (ABBR) definitions should keep their original acronym.
        if (
          previous?.target === best.target &&
          /^\s*[（(]\s*$/u.test(source.slice(previous.sourceEnd, i)) &&
          /^\s*[）)]/u.test(source.slice(best.sourceEnd))
        )
          best.target = best.text;
        spans.push(best);
        i = best.sourceEnd;
      }
      return spans;
    }
    return { find, identity: JSON.stringify(rows), signatures: new Map() };
  }
  // Match entire section headings only. A word such as "Abstract" in a scientific
  // finding remains available to the regular terminology-aware translator.
  const headings = new Map();
  for (const [zh, labels] of [
    ['正文', ['main','main text','main body','main article text']], ['摘要', ['abstract', 'summary', 'article summary']], ['图文摘要', ['graphical abstract']],
    ['要点', ['highlights', 'key points']], ['关键词', ['keywords', 'key words']],
    ['引言', ['introduction']], ['背景', ['background']], ['研究目的', ['objective', 'objectives', 'aims']],
    ['方法', ['methods', 'methodology']], ['实验方法', ['experimental procedures', 'experimental methods']],
    ['材料与方法', ['materials and methods', 'methods and materials']],
    ['STAR 方法', ['star methods']], ['方法详述', ['method details']], ['研究设计', ['study design']],
    ['结果', ['results', 'findings']], ['讨论', ['discussion']], ['结果与讨论', ['results and discussion']],
    ['结论', ['conclusion', 'conclusions']], ['研究局限性', ['limitations', 'limitations of the study', 'study limitations']],
    ['统计分析', ['statistical analysis', 'statistical analyses']], ['定量与统计分析', ['quantification and statistical analysis']],
    ['资源可用性', ['resource availability']], ['数据可用性', ['data availability', 'data availability statement']],
    ['数据与材料可用性', ['availability of data and materials', 'data and materials availability']],
    ['代码可用性', ['code availability', 'code availability statement']], ['数据与代码可用性', ['data and code availability', 'availability of data and code']],
    ['补充信息', ['supplementary information', 'supplemental information', 'supporting information']], ['补充材料', ['supplementary material', 'supplementary materials', 'supplemental material', 'supplemental materials']],
    ['扩展数据', ['extended data']], ['图注', ['figure legends', 'figure captions']], ['参考文献', ['references', 'bibliography']],
    ['致谢', ['acknowledgments', 'acknowledgements', 'acknowledgment', 'acknowledgement']],
    ['作者贡献', ['author contributions', 'authors’ contributions', 'author contribution statement']],
    ['作者信息', ['author information']], ['资助', ['funding', 'funding information', 'funding statement']],
    ['利益冲突声明', ['competing interests', 'conflict of interest', 'conflicts of interest', 'declaration of interests', 'declaration of competing interest']],
    ['伦理声明', ['ethics declarations', 'ethics statement']], ['伦理批准', ['ethics approval']],
    ['关键资源表', ['key resources table']], ['实验模型与研究对象详情', ['experimental model and subject details']],
    ['缩略词', ['abbreviations']], ['附录', ['appendix']], ['同行评审', ['peer review']], ['更多信息', ['additional information']]
  ]) for (const label of labels) headings.set(label, zh);
  function academicHeading(source) {
    const text = String(source || '').normalize('NFKC').trim();
    const match = /^(?:(\d+(?:\.\d+)*|[IVXLCDM]+)([.)]?)\s+)?(.+?)[:.。]?$/iu.exec(text);
    if (!match) return '';
    const key = match[3].toLowerCase().replace(/\s*[★⋆]\s*/gu, ' ').replace(/\s*&\s*/gu, ' and ')
      .replace(/['’]/gu,'’').replace(/\s+/gu,' ').trim();
    const zh = headings.get(key);
    return zh ? (match[1] ? match[1] + match[2] + ' ' : '') + zh : '';
  }

  function protectHeadingTerms(source, index) {
    const spans = index.find(source);
    if (!spans.length) return null;
    let prefix = 'BRVTERM';
    while (source.toUpperCase().includes(prefix)) prefix += 'X';
    let text = '', end = 0;
    const terms = spans.map((span, i) => {
      const key = prefix + i + 'Q';
      text += source.slice(end, span.sourceStart) + key;
      end = span.sourceEnd;
      return {key, source:span.text, translation:span.target};
    });
    return {text:text + source.slice(end), terms, restore(output) {
      if (typeof output !== 'string') throw Error('译文缺少大纲标题');
      const seen = new Set();
      const restored = output.replace(new RegExp(prefix + '(\\d+)Q','gi'), (marker, n) => {
        const term = terms[Number(n)];
        if (!term || seen.has(term.key) || marker.toUpperCase() !== term.key) throw Error('大纲译文中的术语标记无效');
        seen.add(term.key);
        return term.translation;
      });
      if (seen.size !== terms.length) throw Error('大纲译文遗漏了本地术语');
      return restored;
    }};
  }

  async function signature(index, source = 'en', target = 'zh', impl = globalThis.crypto) {
    const base = `browser-translator:${source}:${target}:validated-prefix-v2`;
    if (!index.identity) return base;
    if (!index.signatures.has(base)) {
      const hash = impl.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(base + '\nterms-v1\n' + index.identity)
      );
      index.signatures.set(
        base,
        hash.then(
          (bytes) =>
            'sha256:' + Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
        )
      );
    }
    return index.signatures.get(base);
  }
  function read(reverse = false, storage = globalThis.chrome?.storage?.local, refresh = false) {
    const runtime = globalThis.chrome?.runtime;
    const page = runtime?.sendMessage && /^(https?|file):$/.test(globalThis.location?.protocol || '');
    const owner = page ? runtime : storage;
    if (!owner || (!page && !storage?.get)) return empty;
    let cache = storageCaches.get(owner);
    if (!cache) {
      cache = new Map();
      storageCaches.set(owner, cache);
      const invalidate = (changes, area) => {
        if (area === 'local' && Object.hasOwn(changes, key)) cache.clear();
      };
      if (page) globalThis.SciLLM?.onPublicPreferencesChanged?.(invalidate);
      else globalThis.chrome?.storage?.onChanged?.addListener(invalidate);
    }
    if (refresh) cache.delete(reverse);
    if (!cache.has(reverse)) {
      const value = page
        ? runtime.sendMessage({ type: 'ABBREVIATION_MEMORY_GET' }).then((response) => {
            if (!response?.success) throw Error('Terminology library unavailable');
            return response.data.memory;
          })
        : Promise.resolve(storage.get(key)).then((data) => data?.[key]);
      const pending = value
        .then((data) => compile(data, reverse))
        .catch(() => {
          if (cache.get(reverse) === pending) cache.delete(reverse);
          return empty;
        });
      cache.set(reverse, pending);
    }
    return cache.get(reverse);
  }
  async function apply(source, spans, translate) {
    if (!spans.length) return translate(source);
    if (spans.length === 1 && source.trim() === spans[0].text) return spans[0].target;
    let prefix = 'BRVTERM';
    while (source.toUpperCase().includes(prefix)) prefix += 'X';
    const gaps = [],
      markers = [];
    let cursor = 0,
      masked = '';
    for (const [i, span] of spans.entries()) {
      const gap = source.slice(cursor, span.sourceStart),
        marker = prefix + i + 'Q';
      gaps.push(gap);
      markers.push(marker);
      masked += gap + marker;
      cursor = span.sourceEnd;
    }
    gaps.push(source.slice(cursor));
    masked += gaps.at(-1);
    const result = await translate(masked);
    const pattern = new RegExp(prefix + '(\\d+)Q', 'gi'),
      seen = new Set();
    let invalid = false;
    const parts = [];
    let end = 0;
    for (const match of result.matchAll(pattern)) {
      const n = Number(match[1]);
      if (!spans[n] || seen.has(n) || match[0].toUpperCase() !== markers[n]) {
        invalid = true;
        break;
      }
      seen.add(n);
      parts.push(result.slice(end, match.index), spans[n].target);
      end = match.index + match[0].length;
    }
    parts.push(result.slice(end));
    if (!invalid && seen.size === spans.length && !parts.some((part) => part.toUpperCase().includes(prefix)))
      return joinTerms(parts);
    // Some native language packs translate identifiers. Never display markers or invent a term.
    parts.length = 0;
    for (const [i, gap] of gaps.entries()) {
      if (/\p{L}/u.test(gap))
        parts.push(gap.match(/^\s*/u)[0] + (await translate(gap.trim())) + gap.match(/\s*$/u)[0]);
      else parts.push(gap);
      if (i < spans.length) parts.push(spans[i].target);
    }
    return joinTerms(parts);
  }
  // Native engines can insert ASCII spaces around a placeholder in Chinese prose.
  function joinTerms(parts) {
    for (let i = 1; i < parts.length; i++) {
      if (
        /[\p{Script=Han}，。；：、（）][ \t]*$/u.test(parts[i - 1]) &&
        /^[ \t]*[\p{Script=Han}，。；：、（）]/u.test(parts[i])
      ) {
        parts[i - 1] = parts[i - 1].replace(/[ \t]+$/u, '');
        parts[i] = parts[i].replace(/^[ \t]+/u, '');
      }
    }
    return parts.join('');
  }
  const api = { compile, read, signature, apply, academicHeading, protectHeadingTerms };
  if (typeof module === 'object' && module.exports) module.exports = api;
  globalThis.BrevessTranslationGlossary = api;
})();

