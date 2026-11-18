(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(globalThis, function() {
  'use strict';
  const clean = (x, n = 128) => Array.from(String(x || '').normalize('NFKC').replace(/\s+/gu, ' ').trim()).slice(0, n).join('');
  const priorIntent = q => /(?:既往|以往|前期|先前|过往|之前|早期|历年|背景|启发|相关论文|previous|prior|earlier|early research|before|background|inspir|publications)/iu.test(q);
  const authorIntent = q => /(?:作者|通讯|通信|author|corresponding|lead contact)/iu.test(q) && priorIntent(q);
  const cutoff = date => { const match = /^\d{4}(?:[-/]\d{2}){0,2}/u.exec(date || ''); return match ? ' before:' + match[0].replaceAll('/', '-') : ''; };
  function authorQueries(plan, authors = plan.authors) {
    const before = cutoff(plan.date);
    const topic = clean(plan.title.replace(/\b(?:evidence|that|are|is|the|and|of|a|an|for|to|in|with|by|along|modulate|through)\b/giu, ' '), 48);
    const first = authors.map(a => clean('"' + clean(a.name, 48) + '" ' + topic + before));
    const second = authors.map(a => clean('"' + clean(a.name, 48) + '" ' + clean(topic, 35) + ' site:pubmed.ncbi.nlm.nih.gov' + before));
    return [...new Set([...first, ...second])].slice(0, 6);
  }
  function planArticleAuthorResearch(input, context = {}) {
    const question = clean(input.question, 6000);
    if (context.publicationMetadataStatus === 'excluded-by-section-scope' || input.document?.authorMetadataStatus === 'excluded-by-section-scope') return null;
    const metadata = Object.hasOwn(context, 'publicationMetadata') ? context.publicationMetadata : input.document?.authorMetadata;
    const all = Array.isArray(metadata?.authors) ? metadata.authors : [];
    const named = all.filter(a => a.name && question.toLocaleLowerCase().includes(clean(a.name).toLocaleLowerCase()));
    if (!authorIntent(question) && !(named.length && priorIntent(question))) return null;
    const authors = (named.length ? named : all.filter(a => a.corresponding === true)).slice(0, 4)
      .map(a => ({name: clean(a.name, 100), affiliations: (a.affiliations || []).slice(0, 3).map(x => clean(x, 300))}));
    const plan = {kind: 'author-prior-work', question, title: clean(metadata?.title || input.document?.title, 240).replace(/\s*[|]\s*Nature.*$/iu,''),
      url: metadata?.sourceUrl || input.document?.url || '', date: clean(metadata?.publicationDate, 30), authors,
      correspondingOnly: !named.length, omittedAuthors: Math.max(0, (named.length ? named : all.filter(a => a.corresponding === true)).length - authors.length)};
    plan.queries = authors.length ? authorQueries(plan) : [clean('"' + clean(plan.title, 90) + '" corresponding authors')];
    // Use only the context admitted for this turn; excluded sections cannot
    // silently become evidence for a claim of direct citation.
    plan.referenceText = Array.isArray(context.chunks)
      ? context.chunks.filter(c=>/references?|bibliography|参考文献/iu.test(c.sectionKind+' '+c.sectionTitle)).map(c=>c.text||'').join('\n')
      : String(input.document?.references || '');
    return plan;
  }
  function validatedResearchQueries(reply, plan) {
    if (!Array.isArray(reply?.queries)) return plan.queries;
    const names = plan.authors.map(a => a.name.toLocaleLowerCase());
    const accepted = reply.queries.filter(q => typeof q === 'string' && Array.from(q).length <= 120 &&
      !/[\n\r<>]/u.test(q) && !/https?:|[\w.-]+\.(?:com|org|net)\b/iu.test(q) &&
      names.some(name => q.toLocaleLowerCase().includes('"' + name + '"'))).slice(0, 6);
    if (names.some(name => !accepted.some(q => q.toLocaleLowerCase().includes('"' + name + '"')))) return plan.queries;
    const before = cutoff(plan.date);
    const seenAuthors = new Set();
    return [...new Set(accepted.map(q => {
      const name = names.find(name => q.toLocaleLowerCase().includes('"' + name + '"'));
      const primary = seenAuthors.has(name) ? ' site:pubmed.ncbi.nlm.nih.gov' : '';
      seenAuthors.add(name);
      return clean(q, 128 - before.length - primary.length) + primary + before;
    }))];
  }
  function balancedResearchSources(groups, maximum = 12) {
    const sources = [], seen = new Set();
    for (let i = 0; groups.some(g => i < g.length) && sources.length < maximum; i++) {
      for (const group of groups) {
        const item = group[i];
        if (!item || seen.has(item.url) || sources.length >= maximum) continue;
        seen.add(item.url); sources.push(item);
      }
    }
    return sources;
  }
  // Identity discovery is allowed to propose searches, never to manufacture evidence.
  const plainEvidence = value => String(value || '').replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1');
  function verifiedResearchAuthors(reply, sources) {
    if (!Array.isArray(reply?.authors)) return [];
    const result = [];
    for (const a of reply.authors.slice(0, 4)) {
      const source = sources[a.sourceIndex];
      const quote = clean(plainEvidence(a.quote), 1800), name = clean(a.name, 100);
      const evidence = clean(plainEvidence([source?.content, source?.summary, source?.snippet].join(' ')), 50000);
      if (!source || !name || !quote.includes(name) || !evidence.includes(quote) ||
          !/correspond(?:ence|ing)|通讯作者|通信作者/iu.test(quote) || result.some(x => x.name === name)) continue;
      result.push({name, affiliations: [], identitySource: source.url, identityQuote: quote});
    }
    return result;
  }
  function researchExcerpt(content, max = 12000) {
    content = String(content || '').normalize('NFKC');
    if (content.length <= max) return content;
    const pieces = [content.slice(0, 5000)];
    for (const term of [/correspond(?:ing authors?|ence to)/ig, /authors and affiliations/ig, /abstract/ig]) {
      const match = [...content.matchAll(term)].find(m => m.index > 4000);
      if (match) pieces.push(content.slice(Math.max(0, match.index - 80), match.index + 2300));
    }
    return pieces.join('\n[Excerpt boundary]\n').slice(0, max);
  }
  function researchBibliography(content, max = 40000) {
    const text=String(content||'').replace(/\r\n/g,'\n');
    const heading=/(?:^|\n)\s*(?:#{1,6}\s*)?(?:References|Bibliography|参考文献)\s*\n/giu;
    // A publisher may include a table-of-contents link first. Prefer the last
    // actual section heading and stop before unrelated article metadata.
    const matches=[...text.matchAll(heading)];if(!matches.length)return '';
    const start=matches.at(-1).index+matches.at(-1)[0].length;
    const body=text.slice(start),end=/\n\s*(?:#{1,6}\s*)?(?:Acknowledgements|Author information|Contributions|Ethics declarations|Additional information|Supplementary information|Rights and permissions)\s*\n/iu.exec(body);
    return body.slice(0,end?end.index:undefined).trim().slice(0,max);
  }
  function validateAuthorResearchTable(markdown, sources, research) {
    const key = value => String(value || '').normalize('NFKD').replace(/[\p{M}]/gu,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
    const fail = () => { const error=new Error('A prior-work table row disagrees with its retrieved title, date or author byline');error.code='WEB_SEARCH_GROUNDING_MISSING';throw error; };
    const lines=String(markdown).split('\n'); let inTable=false;
    for (let i=0;i<lines.length;i++) {
      const line=lines[i];
      if (/^\s*\|?\s*:?-{3,}:?\s*\|/u.test(line)) { inTable=true;continue; }
      if (!inTable) continue;
      if (!line.trim() || !line.includes('|')) { inTable=false;continue; }
      const cited=[...line.matchAll(/\[S(\d+)\]/gu)].map(m=>sources[Number(m[1])-1]).filter(Boolean);
      if (!cited.length) fail();
      const records=cited.filter(s=>s.bibliographicRecord).map(s=>s.bibliographicRecord);
      const claimsDirect = /直接引用|明确引用|direct(?:ly)? cit(?:ed|ation)/iu.test(line) &&
        !/未.{0,12}(?:直接引用|明确引用)|非直接引用|未获证实|无法确认|不能确认|not directly cited|unconfirmed direct/iu.test(line);
      if (claimsDirect) {
        const titles=[...records.map(r=>r.title),...cited.filter(s=>s.url!==research.url).map(s=>s.title)].filter(Boolean);
        if (!titles.some(title=>key(title).length>20 && key(line).includes(key(title)) && key(research.referenceText).includes(key(title)))) fail();
      }
      if (!records.length) continue;
      const matched=records.filter(r=>key(line).includes(key(r.title)));
      if (!matched.length) fail();
      for (const record of matched) {
        const year=/\b(?:19|20)\d{2}\b/u.exec(record.publicationDate)?.[0];
        if (year && !line.includes(year)) fail();
        if (/Erratum|Retraction/iu.test(record.publicationTypes.join(' '))) fail();
        if (research.authors?.length && !record.authors.some(a=>research.authors.some(target=>key(a.name)===key(target.name)))) fail();
      }
    }
  }
  let pubmedTail = Promise.resolve(), nextPubmedRequest = 0;
  async function enrichAuthorResearchPubmed(sources, {fetchImpl = fetch, signal, onStatus = () => {}} = {}) {
    const ids = [...new Set(sources.map(source => {
      try { const u=new URL(source.url); return u.hostname==='pubmed.ncbi.nlm.nih.gov' && /^\/\d+\/?$/u.test(u.pathname) ? u.pathname.replaceAll('/','') : ''; } catch { return ''; }
    }).filter(Boolean))].slice(0, 16);
    if (!ids.length) return sources;
    const parser = typeof require === 'function' ? require('./literature-radar-pubmed.js') : globalThis.BrevessRadar;
    const request = batch => {
      const run = pubmedTail.then(async () => {
        signal?.throwIfAborted();
        if (Date.now() < nextPubmedRequest) await new Promise(resolve => setTimeout(resolve, nextPubmedRequest-Date.now()));
        signal?.throwIfAborted(); nextPubmedRequest=Date.now()+400;
        const xml = await globalThis.SciLLM.requestText(fetchImpl, 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi', {
          method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({db:'pubmed',id:batch.join(','),retmode:'xml',tool:'brevess_author_research'}).toString(),signal,timeoutMs:20000
        });
        return parser.parseRadarPubMedAbstracts(xml,batch,{includeMetadata:true});
      });
      pubmedTail=run.catch(()=>{});return run;
    };
    try {
      onStatus('正在用 PubMed 原始题录核对标题、作者、日期及勘误类型。');
      const records = await request(ids), byId = new Map(records.map(r=>[r.id,r]));
      const originals = [...new Set(records.flatMap(r=>r.corrections.filter(c=>c.type==='ErratumFor').map(c=>c.pmid)).filter(id=>/^\d+$/u.test(id)&&!byId.has(id)))].slice(0,4);
      if (originals.length) for (const record of await request(originals)) byId.set(record.id,record);
      const result = sources.map(source => {
        const id = new URL(source.url).hostname==='pubmed.ncbi.nlm.nih.gov' ? new URL(source.url).pathname.replaceAll('/','') : '';
        let record = byId.get(id); if (!record) return source;
        const original = record.corrections.find(c=>c.type==='ErratumFor');
        if (original && byId.has(original.pmid)) record = byId.get(original.pmid);
        const url='https://pubmed.ncbi.nlm.nih.gov/'+record.id+'/';
        const normalized=globalThis.SciLLM.normalizeDeepSeekSearchResults({results:[{url,title:record.title}]})[0];
        const {abstractCopyright,abstractError,...bibliography}=record;
        return {...normalized,content:'VERIFIED_PUBMED_RECORD (this record only, not its references): '+JSON.stringify(bibliography),
          retrievedText:true,bibliographicRecord:bibliography};
      });
      onStatus('已核对 '+ids.length+' 个 PMID'+(originals.length?'，并追溯 '+originals.length+' 条勘误对应原文':'')+'。');
      return balancedResearchSources([result]);
    } catch (error) {
      if (signal?.aborted) throw error;
      onStatus('PubMed 题录核验暂不可用；仅保留检索摘录，不能当作已核实的作者论文。');
      return sources.map(s=>s.hostname==='pubmed.ncbi.nlm.nih.gov'?{...s,content:'UNVERIFIED SEARCH EXCERPT: '+s.content}:s);
    }
  }
  return { planArticleAuthorResearch, authorQueries, validatedResearchQueries, balancedResearchSources, verifiedResearchAuthors, researchExcerpt, researchBibliography, enrichAuthorResearchPubmed, validateAuthorResearchTable };
});
