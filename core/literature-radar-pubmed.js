(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./literature-radar-model.js') : root.BrevessRadar);
  if (typeof module === 'object' && module.exports) module.exports = api;
  Object.assign(root.BrevessRadar ||= {}, api);
})(globalThis, function(m) {
  'use strict';
  const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
  // Small, non-resolving XML reader: works in MV3 workers without DOMParser.
  // No DTD/entity expansion or HTML insertion; unknown entities fail closed.
  function parseRadarPubMedAbstracts(xml, ids) {
    const invalid = () => { throw m.radarError('RADAR_ABSTRACT_XML', 'PubMed 摘要 XML 不完整或格式无效。'); };
    if (typeof xml !== 'string' || xml.length > 12000000 || /<!ENTITY|<!DOCTYPE[^>]*\[/i.test(xml)) invalid();
    const decode = value => value.replace(/&([^;]+);/g, (_, code) => {
      const named = { amp:'&',lt:'<',gt:'>',quot:'"',apos:"'" };
      if (Object.hasOwn(named, code)) return named[code];
      if (!/^#(?:x[\da-f]+|\d+)$/i.test(code)) invalid();
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2),16) : Number(code.slice(1));
      if (!Number.isInteger(n) || n <= 0 || n > 0x10ffff || n >= 0xd800 && n <= 0xdfff) invalid();
      return String.fromCodePoint(n);
    });
    const root = { name:'', children:[] }, stack=[root]; let cursor=0;
    const token = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<[^>]*>|[^<]+/g;
    for (const match of xml.matchAll(token)) {
      if (match.index !== cursor) invalid(); cursor += match[0].length;
      const value=match[0], parent=stack.at(-1);
      if (value.startsWith('<!--') || value.startsWith('<?') || value.startsWith('<!DOCTYPE')) continue;
      if (value.startsWith('<![CDATA[')) { parent.children.push(value.slice(9,-3)); continue; }
      if (value.startsWith('</')) { if (!/^<\/[\w:.-]+\s*>$/.test(value) || stack.length<2 || stack.pop().name !== value.slice(2,-1).trim()) invalid(); continue; }
      if (value.startsWith('<')) {
        const head=/^<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?\s*>$/.exec(value); if (!head) invalid();
        const attrs={}; for (const a of head[2].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]]=decode(a[2]??a[3]);
        const node={name:head[1],attrs,children:[]}; parent.children.push(node); if (!/\/\s*>$/.test(value)) stack.push(node);
      } else parent.children.push(decode(value));
    }
    if (cursor !== xml.length || stack.length !== 1) invalid();
    const children=(node,name)=>node?.children.filter(n=>typeof n==='object' && n.name===name)||[];
    const rawText=node=>typeof node==='string'?node:(node?.children||[]).map(rawText).join('');
    const text=node=>rawText(node).replace(/\s+/g,' ').trim();
    const set=children(root,'PubmedArticleSet')[0]; if (!set) invalid();
    const rows=new Map();
    for (const article of set.children.filter(n=>['PubmedArticle','PubmedBookArticle'].includes(n?.name))) {
      const citation=children(article,article.name==='PubmedArticle'?'MedlineCitation':'BookDocument')[0];
      const id=text(children(citation,'PMID')[0]); if (!/^\d+$/.test(id) || rows.has(id)) invalid();
      const body=article.name==='PubmedArticle'?children(citation,'Article')[0]:citation;
      const abstract=children(body,'Abstract')[0];
      const abstractSections=children(abstract,'AbstractText').map(node=>({label:node.attrs.Label||'',text:text(node)})).filter(s=>s.text);
      rows.set(id,{id,abstractSections,abstractStatus:abstractSections.length?'ready':'missing',
        abstractCopyright:text(children(abstract,'CopyrightInformation')[0]),abstractSource:'pubmed-efetch',abstractError:null});
    }
    if (ids.some(id=>!rows.has(id))) throw m.radarError('RADAR_INCOMPLETE_ABSTRACT','PubMed 未返回部分 PMID 的摘要记录，可稍后补齐。');
    return ids.map(id=>rows.get(id));
  }
  function abortableSleep(ms, signal) {
    return new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const cancel = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }
  function createPubMedRadarAdapter({ fetch = globalThis.fetch, sleep = abortableSleep, now = Date.now, requestTimeoutMs = 20000 } = {}) {
    let tail = Promise.resolve(), nextRequestAt = 0;
    function request(endpoint, params, signal) {
      const task = tail.then(async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          signal?.throwIfAborted();
          if (nextRequestAt > now()) await sleep(nextRequestAt - now(), signal);
          signal?.throwIfAborted(); nextRequestAt = now() + 400; // <= 2.5/s, below NCBI's 3/s no-key limit.
          const controller = new AbortController();
          const cancel = () => controller.abort(signal.reason);
          signal?.addEventListener('abort', cancel, { once: true });
          const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
          let response, body, networkError;
          try {
            response = await fetch(BASE + endpoint + '.fcgi', {
              method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
              headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
              body: new URLSearchParams({ db: 'pubmed', retmode: 'json', tool: 'brevess_literature_radar', ...params }).toString()
            });
            if (response.ok) body = params.retmode === 'xml' ? await response.text() : await response.json();
          } catch (error) { networkError = error; }
          finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
          signal?.throwIfAborted();
          if (networkError) {
            if (attempt < 2) { await sleep(1000 * 2 ** attempt, signal); continue; }
            throw m.radarError('RADAR_NETWORK', '无法连接 PubMed 或响应无效，请检查网络后重试。');
          }
          if (response.ok) {
            if (body?.error || body?.ERROR) throw m.radarError('RADAR_API_ERROR', String(body.error || body.ERROR));
            return body;
          }
          if ((response.status === 429 || response.status >= 500) && attempt < 2) {
            const header = response.headers?.get('Retry-After');
            const retryMs = header ? (/^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now()) : 0;
            // Do not shorten a server-mandated delay; let the caller deadline stop this run if necessary.
            await sleep(Math.max(1000 * 2 ** attempt, Number.isFinite(retryMs) ? retryMs : 0), signal); continue;
          }
          throw m.radarError('RADAR_HTTP_' + response.status, `PubMed 返回 HTTP ${response.status}；本次未推进检查进度。`);
        }
      });
      tail = task.catch(() => {}); return task;
    }
    async function fetchAbstracts(ids, { signal } = {}) {
      if (!Array.isArray(ids) || ids.length > 5000 || ids.some(id=>typeof id!=='string'||!/^\d+$/.test(id)) || new Set(ids).size!==ids.length) throw m.radarError('RADAR_ARGUMENT');
      const rows=[];
      for (let offset=0;offset<ids.length;offset+=100) {
        signal?.throwIfAborted(); const batch=ids.slice(offset,offset+100);
        try {
          const xml=await request('efetch',{id:batch.join(','),retmode:'xml'},signal);
          rows.push(...parseRadarPubMedAbstracts(xml,batch).map(row=>({...row,abstractFetchedAt:now()})));
        } catch (error) {
          signal?.throwIfAborted();
          rows.push(...batch.map(id=>({id,abstractStatus:'error',abstractError:{code:error.code||'RADAR_ABSTRACT_FETCH',message:String(error.message).slice(0,500)},abstractAttemptAt:now()})));
        }
      }
      return rows;
    }
    async function previewQuery(query, { signal } = {}) {
      if (typeof query !== 'string'||!query.trim()||query.length>4000) throw m.radarError('RADAR_ARGUMENT');
      const body=await request('esearch',{term:query,retmax:'0'},signal), result=body?.esearchresult;
      if (!result || !/^\d+$/.test(String(result.count))) throw m.radarError('RADAR_SEARCH_RESPONSE');
      return {count:Number(result.count),queryTranslation:String(result.querytranslation||''),
        warnings:Object.values(result.warninglist||{}).flat().map(String),errors:Object.values(result.errorlist||{}).flat().map(String).concat(result.ERROR?[String(result.ERROR)]:[])};
    }
    async function discover({ query, startDay, endDay, signal }) {
      if (typeof query !== 'string' || !query.trim() || query.length > 4000 ||
          ![startDay, endDay].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && m.radarDay(Date.parse(d)) === d) || startDay > endDay) throw m.radarError('RADAR_ARGUMENT');
      const ids = new Set(), warnings = new Set(); let queries = 0, queryTranslation = '';
      async function searchRange(start, end) {
        signal?.throwIfAborted();
        if (++queries > 64) throw m.radarError('RADAR_QUERY_TOO_BROAD', '检索范围过大，请缩小检索式或首次回溯范围。');
        const term = `(${query}) AND (${start.replaceAll('-', '/')}:${end.replaceAll('-', '/')}[crdt])`;
        // Official ceiling is 10,000; the live 2026-10-13 service clips retmax to 9,999.
        const body = await request('esearch', { term, retmax: '9999', retstart: '0', sort: 'pub_date' }, signal);
        const result = body?.esearchresult;
        if (!result || !/^\d+$/.test(String(result.count)) || !Array.isArray(result.idlist)) throw m.radarError('RADAR_SEARCH_RESPONSE');
        if (result.ERROR || Object.values(result.errorlist || {}).some(v => Array.isArray(v) ? v.length : v)) throw m.radarError('RADAR_QUERY_ERROR', 'PubMed 未接受部分检索条件。请在 PubMed 核对字段、引号和括号。');
        for (const value of Object.values(result.warninglist || {})) for (const warning of Array.isArray(value) ? value : [value]) warnings.add(String(warning));
        if (!queryTranslation) queryTranslation = String(result.querytranslation || '');
        const count = Number(result.count);
        if (!Number.isSafeInteger(count)) throw m.radarError('RADAR_SEARCH_RESPONSE');
        if (count > 9999) {
          if (start === end) throw m.radarError('RADAR_QUERY_TOO_BROAD', '单日结果超过当前 PubMed 单次提取边界（9,999 篇），请缩小检索式。');
          const first = Date.parse(start), last = Date.parse(end), mid = first + Math.floor((last - first) / m.DAY / 2) * m.DAY;
          await searchRange(start, m.radarDay(mid)); await searchRange(m.radarDay(mid + m.DAY), end); return;
        }
        if (result.idlist.length !== count || new Set(result.idlist).size !== count || result.idlist.some(id => typeof id !== 'string' || !/^\d+$/.test(id))) throw m.radarError('RADAR_INCOMPLETE_SEARCH', 'PubMed 返回的 PMID 数量不完整，请重试。');
        for (const id of result.idlist) ids.add(id);
        if (ids.size > 5000) throw m.radarError('RADAR_QUERY_TOO_BROAD', '本次超过 5,000 篇处理上限。未截断、未推进进度；请缩小检索式或回溯范围。');
      }
      await searchRange(startDay, endDay);
      const list = [...ids], articles = [];
      for (let offset = 0; offset < list.length; offset += 100) {
        const batch = list.slice(offset, offset + 100);
        const body = await request('esummary', { id: batch.join(','), version: '2.0' }, signal);
        const result = body?.result;
        if (!result || !Array.isArray(result.uids) || batch.some(id => !result.uids.includes(id) || !result[id] || result[id].error || String(result[id].uid) !== id || typeof result[id].title !== 'string')) throw m.radarError('RADAR_INCOMPLETE_SUMMARY', '部分文献信息缺失，本次进度已保留。请稍后重试。');
        for (const id of batch) {
          const row = result[id];
          const created = String((Array.isArray(row.history) ? row.history : []).find(h => h.pubstatus === 'entrez')?.date || '').slice(0, 10).replaceAll('/', '-');
          const createdDay = /^\d{4}-\d{2}-\d{2}$/.test(created) && Number.isFinite(Date.parse(created)) && m.radarDay(Date.parse(created)) === created ? created : null;
          articles.push({ id, title: row.title.slice(0, 4000), journal: String(row.fulljournalname || row.source || '').slice(0, 500),
            createdDay,
            publicationDate: String(row.pubdate || '').slice(0, 100), authors: (Array.isArray(row.authors) ? row.authors : []).slice(0, 30).map(a => String(a.name || '').slice(0, 200)),
            doi: String((Array.isArray(row.articleids) ? row.articleids : []).find(a => a.idtype === 'doi')?.value || '').slice(0, 500) });
        }
      }
      const abstracts=await fetchAbstracts(list,{signal}), byId=new Map(abstracts.map(p=>[p.id,p]));
      for (const paper of articles) Object.assign(paper,byId.get(paper.id));
      if (abstracts.some(p=>p.abstractStatus==='error')) warnings.add('部分摘要获取失败，文献已保留；可点击“补齐摘要”重试。');
      return { articles, warnings: [...warnings], queryTranslation };
    }
    return { source: 'pubmed', discover, fetchAbstracts, previewQuery };
  }
  return { createPubMedRadarAdapter, parseRadarPubMedAbstracts };
});
