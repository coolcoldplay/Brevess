(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessReadingFocus = Object.assign(root.BrevessReadingFocus || {}, api);
})(globalThis, function () {
  'use strict';
  function r18SiteInfo(value) {
  let u; try { u = new URL(value); } catch { return { family: '', conversation: false, saved: false }; }
  const host = u.hostname.toLowerCase(), path = u.pathname;
  let family = '', saved = false;
  if (['chatgpt.com', 'chat.openai.com'].includes(host)) { family = 'chatgpt'; saved = /\/(?:c)\/[^/]+\/?$/.test(path); }
  else if (host === 'chat.deepseek.com') { family = 'deepseek'; saved = /^\/a\/chat\/s\/[^/]+\/?$/.test(path); }
  else if (host === 'yuanbao.tencent.com') { family = 'yuanbao'; saved = /^\/chat\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}\/?$/i.test(path); }
  else if (['www.doubao.com', 'doubao.com'].includes(host)) { family = 'doubao'; saved = /^\/chat\/[^/]+\/?$/.test(path); }
  else if (['www.kimi.com', 'kimi.com', 'kimi.moonshot.cn'].includes(host)) { family = 'kimi'; saved = /^\/chat\/[^/]+\/?$/.test(path); }
  else if (host === 'gemini.google.com') { family = 'gemini'; saved = /^\/app\/[^/]+\/?$/.test(path); }
  else if (host === 'grok.com') { family = 'grok'; saved = /^\/c\/[^/]+\/?$/.test(path); }
  else if (host === 'chatglm.cn') { family = 'zhipu'; }
  const feed = host === 't.bilibili.com' || (host === 'space.bilibili.com' && /^\/\d+\/dynamic\/?$/.test(path));
  return { family: family || (feed ? 'bilibili' : ''), conversation: Boolean(family), saved, feed };
}
  const categories = [
    ['abstract', /^(abstract|summary|摘要|概要)\b|^(摘要|概要)$/i],
    ['introduction', /^(introduction|background|引言|绪论|背景)(?:\b|$)/i],
    ['methods', /^(?:materials?(?:\s*(?:and|&)\s*methods?)?|methods?|methodology|experimental (?:procedures|design)|star\s*[★*]?\s*methods|材料与方法|研究方法|方法)(?:\b|$)/i],
    ['results', /^(results?|findings?|结果|研究结果)(?:\b|$)/i],
    ['discussion', /^(discussion|discussions|讨论)(?:\b|$)/i],
    ['conclusion', /^(conclusions?|concluding remarks|结论|总结)(?:\b|$)/i],
    ['references', /^(references|bibliography|literature cited|参考文献)(?:\b|$)/i]
  ];
  function classify(snapshot = {}) {
    const outline = (snapshot.outline || []).slice(0, 80).map(h => ({ title: String(h.title || '').slice(0, 220), level: Math.min(6, Math.max(1, Number(h.level) || 2)) }));
    const kinds = new Set();
    for (const h of outline) {
      const label = h.title.normalize('NFKC').trim().replace(/^(?:\d+(?:\.\d+)*[.)]?|[IVX]+[.)])\s+/i, '');
      for (const [kind, expression] of categories) if (expression.test(label)) kinds.add(kind);
    }
    const meta = snapshot.meta || {};
    const evidence = Boolean(meta.scholarly || (meta.title && meta.author && (meta.doi || meta.journal)));
    const bodyCount = ['introduction','methods','results','discussion'].filter(k => kinds.has(k)).length;
    const chars = Math.max(0, Number(snapshot.textChars) || 0);
    let type = 'unknown', reason = '可用结构不足，请手动确认';
    if (r18SiteInfo(snapshot.sourceUrl || snapshot.url).conversation || snapshot.pageKind === 'conversation') { type = 'nonpaper'; reason = '当前是 AI 对话页面'; }
    else if(r18SiteInfo(snapshot.sourceUrl || snapshot.url).feed) { type='nonpaper'; reason='当前是动态信息流'; }
    else if (snapshot.blocked || !snapshot.readable) reason = '当前页面无法读取论文结构';
    else if (snapshot.searchPage) { type = 'nonpaper'; reason = '当前是搜索或文献列表页'; }
    else if ((bodyCount >= 3 && chars >= 600) || (bodyCount >= 2 && (kinds.has('abstract') || kinds.has('references') || evidence) && chars >= 600) ||
        (evidence && chars >= 120 && (kinds.has('abstract') || bodyCount >= 1 || meta.scholarly)) ||
        (kinds.has('abstract') && kinds.has('references') && chars >= 800)) {
      type = 'paper'; reason = evidence ? '论文结构与文献信息相符' : '识别到相互对应的论文章节';
    } else if (chars >= 300 && !evidence && kinds.size === 0) { type = 'nonpaper'; reason = '未发现论文结构或文献信息'; }
    return { type, reason, outline, signals: Array.from(kinds), version: 1 };
  }
  // Serialized into the active tab by chrome.scripting; keep this function self-contained.
  function extractPageSnapshot() {
    const excluded = 'nav,aside,footer,body > header,[role="banner"],form,figure,figcaption,[role="dialog"],[hidden],[aria-hidden="true"],.comments,.related-articles,.recommended,.c-article-recommendations,[data-test="article-recommendations"],.app-explore-related-subjects,[id^="sci"],[id^="brevess"]';
    // A publisher's first <article> may be a journal/recommendation card in an aside.
    const usable = selector => Array.from(document.querySelectorAll(selector)).find(e => !e.closest(excluded));
    const main = usable('main,[role="main"],#article-body,.article-body,#body') || usable('article') || document.body;
    if (!main) return { readable: true, textChars: 0, outline: [], meta: {} };
    const publisherTools = '.modal,[data-behaviour~="Modal"],.asset-viewer-inline,.additional-assets,.article-download-links-list__group,.article-section__sharers';
    const eligible = e => !e.closest(excluded) && e.getClientRects().length > 0;
    // Tool headings are not body sections; keep the existing readable-text
    // count so figure-only paper views retain their original classification.
    const headingEligible = e => eligible(e) && !e.closest(publisherTools) &&
      !e.closest('.article-section')?.querySelector('[data-behaviour~="ArticleDownloadLinksList"]');
    const headings = Array.from(main.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],.section-title,.article-section-title')).filter(headingEligible).slice(0, 80);
    const outline = headings.map(h => ({ title: (h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 220), level: Number(h.getAttribute('aria-level') || h.tagName.slice(1)) || 2 })).filter(h => h.title);
    let textChars = 0;
    for (const p of Array.from(main.querySelectorAll('p,[role="paragraph"]')).slice(0, 160)) { if (eligible(p)) textChars += Math.min(3000, (p.textContent || '').trim().length); if (textChars > 24000) break; }
    const metaValue = name => document.querySelector('meta[name="' + name + '"]')?.content?.trim().slice(0, 600) || '';
    const meta = { title: metaValue('citation_title'), author: metaValue('citation_author'), doi: metaValue('citation_doi') || metaValue('dc.identifier'), journal: metaValue('citation_journal_title'), scholarly: false };
    const visit = (x, depth = 0) => {
      if (!x || typeof x !== 'object' || depth > 6) return;
      if ([].concat(x['@type'] || []).includes('ScholarlyArticle')) meta.scholarly = true;
      for (const value of Object.values(x).slice(0, 40)) { if (Array.isArray(value)) value.slice(0, 20).forEach(v => visit(v, depth + 1)); else if (value && typeof value === 'object') visit(value, depth + 1); }
    };
    for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 5)) { if (script.textContent.length <= 40000) try { visit(JSON.parse(script.textContent)); } catch (_) {} }
    const pageHeading = (document.querySelector('main h1,article h1,h1')?.textContent || '').trim();
    const searchPage = /^(search results?|搜索结果|检索结果)(?:\b|\s|$)/i.test(pageHeading) && !meta.title;
    const blocked = /^(just a moment|access denied|checking your browser|verify you are human|访问被拒绝|安全验证)/i.test(document.title);
    return { sourceUrl: location.href, readable: true, textChars, outline, meta, searchPage, blocked };
  }
  return { classify, extractPageSnapshot };
});
