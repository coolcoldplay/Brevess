(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  Object.assign(root.BrevessRadar ||= {}, api);
})(globalThis, function() {
  'use strict';
  const DAY = 86400000;
  const RADAR_DATABASE = 'brevess-literature-radar-v1';
  const radarError = (code, message = code) => Object.assign(new Error(message), { code });
  const clone = value => structuredClone(value);
  const day = at => new Date(at).toISOString().slice(0, 10);
  const RADAR_SOURCES = Object.freeze({
    asta:{name:'Asta',example:'glioblastoma immunotherapy',date:'Asta publicationDate',help:'https://allenai.org/asta/resources/mcp'},
    pubmed:{name:'PubMed',example:'glioblastoma[tiab] AND immunotherapy[tiab]',date:'PubMed CRDT',help:'https://pubmed.ncbi.nlm.nih.gov/help/'},
    biorxiv:{name:'bioRxiv',example:'glioma AND synapse',date:'Europe PMC FIRST_IDATE',preprint:true,help:'https://europepmc.org/searchsyntax'},
    medrxiv:{name:'medRxiv',example:'glioma AND survival',date:'Europe PMC FIRST_IDATE',preprint:true,help:'https://europepmc.org/searchsyntax'},
    arxiv:{name:'arXiv',example:'all:protein AND all:structure',date:'arXiv submittedDate',preprint:true,help:'https://info.arxiv.org/help/api/user-manual.html'},
    europepmc:{name:'Europe PMC',example:'TITLE_ABS:glioma AND OPEN_ACCESS:Y',date:'Europe PMC FIRST_IDATE',help:'https://europepmc.org/searchsyntax'},
    crossref:{name:'Crossref',example:'glioblastoma immunotherapy',date:'Crossref indexed',help:'https://www.crossref.org/documentation/retrieve-metadata/rest-api/'},
    wos:{name:'Web of Science',example:'TS=(glioma AND immunotherapy)',date:'Web of Science modifiedTimeSpan',credential:true,help:'https://developer.clarivate.com/apis/wos-starter'},
    scopus:{name:'Scopus',example:'TITLE-ABS-KEY(glioma AND immunotherapy)',date:'Scopus LOAD-DATE',credential:true,help:'https://dev.elsevier.com/'}
  });
  function isRadarPreprint(paper, source) {
    return paper?.preprint === true || RADAR_SOURCES[source]?.preprint === true ||
      (paper?.publicationTypes || []).some(type => /^preprint$/i.test(type)) ||
      /^(?:bioRxiv|medRxiv|arXiv)(?:$|[ .:–—-])/i.test(String(paper?.journal || '').trim());
  }
  function validRadarPaperId(source,id){
    if(typeof id!=='string'||id.length>600)return false;
    if(source==='asta')return /^asta:[a-f0-9]{40}$/.test(id);
    const patterns={pubmed:/^\d+$/,biorxiv:/^biorxiv:PPR\d+$/,medrxiv:/^medrxiv:PPR\d+$/,europepmc:/^epmc:[A-Z0-9]+:[\w.-]+$/,arxiv:/^arxiv:(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/,crossref:/^crossref:10\.\d{4,9}\/[^\s<>]+$/,wos:/^wos:WOS:[A-Za-z0-9]+$/,scopus:/^scopus:2-s2\.0-\d+$/};
    return !!patterns[source]?.test(id);
  }
  function radarPaperUrl(source,paper){
    if(!validRadarPaperId(source,paper?.id))return null;
    if(source==='asta')return 'https://www.semanticscholar.org/paper/'+paper.id.slice(5);
    if(source==='pubmed')return `https://pubmed.ncbi.nlm.nih.gov/${paper.id}/`;
    const hosts={biorxiv:['doi.org','www.biorxiv.org','europepmc.org'],medrxiv:['doi.org','www.medrxiv.org','europepmc.org'],arxiv:['arxiv.org'],europepmc:['europepmc.org','doi.org'],crossref:['doi.org'],wos:['www.webofscience.com'],scopus:['www.scopus.com']};
    try{const u=new URL(paper.url);return u.protocol==='https:'&&!u.username&&!u.password&&hosts[source]?.includes(u.hostname)?u.href:null;}catch{return null;}
  }
  function radarSourceQueries(value) { return value.sourceQueries || [{source:value.source,query:value.query}]; }
  function validateRadarSourceQueries(values) {
    if(!Array.isArray(values)||!values.length||values.length>Object.keys(RADAR_SOURCES).length)throw radarError('RADAR_CONFIG');
    const seen=new Set();return values.map(row=>{if(!row||!Object.hasOwn(RADAR_SOURCES,row.source)||seen.has(row.source)||typeof row.query!=='string'||!row.query.trim()||row.query.length>4000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(row.query))throw radarError('RADAR_CONFIG');seen.add(row.source);return {source:row.source,query:row.query.trim()};});
  }
  const radarDoi=value=>{const s=String(value||'').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu,'').replace(/^doi:\s*/iu,'').toLowerCase();return /^10\.\d{4,9}\/[^\s<>]+$/u.test(s)?s:'';};
  const radarPmid=paper=>{const raw=paper.source==='pubmed'?paper.id:paper.pmid||(/^epmc:MED:(\d+)$/u.exec(paper.id||'')||[])[1];return /^\d+$/u.test(String(raw||''))?String(raw):'';};
  function radarIdentityKeys(paper) { return ['source:'+paper.source+':'+paper.id,...(radarDoi(paper.doi)?['doi:'+radarDoi(paper.doi)]:[]),...(radarPmid(paper)?['pmid:'+radarPmid(paper)]:[])]; }
  function mergeRadarArticles(articles, incoming, {source,defaultSource=source,baseline,at}) {
    const index=new Map(),records=p=>p.sourceRecords?.length?p.sourceRecords:[{...p,source:p.source||defaultSource}];
    const addIndex=p=>{for(const record of records(p))for(const key of radarIdentityKeys(record)){const matches=index.get(key)||new Set();matches.add(p);index.set(key,matches);}};
    for(const paper of articles)addIndex(paper);
    let added=0,newCount=0,merged=0;
    for(const raw of incoming){
      const row={...clone(raw),source},url=radarPaperUrl(source,row);if(!url||typeof row.title!=='string')throw radarError('RADAR_RESULT_INVALID');row.url=url;
      delete row.sourceRecords;delete row.isBaseline;delete row.read;delete row.firstSeenAt;
      const candidates=new Set(radarIdentityKeys(row).flatMap(key=>[...(index.get(key)||[])])),pmid=radarPmid(row),doi=radarDoi(row.doi);
      const compatible=[...candidates].filter(p=>{
        if(records(p).some(r=>r.source===row.source&&r.id===row.id))return true;
        const pmids=new Set(records(p).map(radarPmid).filter(Boolean)),dois=new Set(records(p).map(r=>radarDoi(r.doi)).filter(Boolean));
        return !(pmid&&pmids.size&&!pmids.has(pmid))&&!(doi&&dois.size&&!dois.has(doi));
      });
      // Ambiguous strong identifiers stay separate; titles never merge records.
      let paper=compatible.length===1?compatible[0]:null;
      if(!paper){paper={...row,firstSeenAt:at,isBaseline:baseline,read:false,sourceRecords:[row]};articles.push(paper);added++;if(!baseline)newCount++;}
      else {
        if(!paper.sourceRecords)paper.sourceRecords=[{...clone(paper),source:paper.source||defaultSource}];
        const key=r=>[r.source,r.id,r.version||''].join('|'),n=paper.sourceRecords.findIndex(r=>key(r)===key(row));
        if(n<0){if(paper.sourceRecords.length>=100)throw radarError('RADAR_RESULT_INVALID');paper.sourceRecords.push(row);}else paper.sourceRecords[n]={...paper.sourceRecords[n],...row};
        if(paper.abstractStatus!=='ready'&&row.abstractStatus==='ready')for(const k of ['abstractSections','abstractStatus','abstractCopyright','abstractSource','abstractError','abstractFetchedAt'])if(row[k]!==undefined)paper[k]=clone(row[k]);
        merged++;
      }
      addIndex(paper);
    }
    return {added,newCount,merged};
  }

  async function radarCountYears(count,signal,endYear=new Date().getUTCFullYear()){
    const result=[];
    async function visit(first,last){
      signal?.throwIfAborted();
      const n=await count(String(first).padStart(4,'0'),String(last).padStart(4,'0'));
      if(!Number.isSafeInteger(n)||n<0)throw radarError('RADAR_RESULT_INVALID','来源返回的年度篇数无效。');
      if(!n)return;
      if(first===last){result.push([first,n]);return;}
      const mid=Math.floor((first+last)/2);
      // Query both branches independently: publication years may overlap (e.g. print and online).
      await visit(first,mid);await visit(mid+1,last);
    }
    await visit(1,endYear);
    return result;
  }
  function validBaseline(value) {
    if (Object.hasOwn(value,'baselineStartDay')) {
      const d=value.baselineStartDay;
      return d==='' || (typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d>='0001-01-01' && Number.isFinite(Date.parse(d)) && day(Date.parse(d))===d);
    }
    return Number.isSafeInteger(value.baselineDays) && value.baselineDays>0;
  }
  function radarBaseline(value) {
    return Object.hasOwn(value,'baselineStartDay') ? {baselineStartDay:value.baselineStartDay} : {baselineDays:value.baselineDays};
  }
  function validateRadarConfig(value) {
    const fail = () => { throw radarError('RADAR_CONFIG', '请填写名称与所选来源的检索式，并选择有效的回溯范围和频率。'); };
    if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 ||
        typeof value.query !== 'string' || !value.query.trim() || value.query.length > 4000 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value.query) ||
        !Object.hasOwn(RADAR_SOURCES,value.source) || !Number.isInteger(value.intervalHours) || value.intervalHours < 0 || value.intervalHours > 720 ||
        !validBaseline(value) || typeof value.enabled !== 'boolean') fail();
    return { ...(value.sourceQueries?{sourceQueries:validateRadarSourceQueries(value.sourceQueries)}:{}), name: value.name.trim(), query: value.query.trim(), source: value.source,
      intervalHours: value.intervalHours, ...radarBaseline(value), enabled: value.enabled };
  }
  function radarScanWindow(revision, at) {
    const endDay = day(at);
    const startDay = revision.lastSuccessAt
      ? day(revision.lastSuccessAt - 7 * DAY)
      : Object.hasOwn(revision,'baselineStartDay') ? revision.baselineStartDay || '0001-01-01'
      : day(Math.max(Date.parse('0001-01-01'),at - (revision.baselineDays - 1) * DAY));
    return { startDay: revision.windowStart && startDay < revision.windowStart ? revision.windowStart : startDay, endDay };
  }
  function radarRevision(radar) { return radar.revisions[radar.revisions.length - 1]; }
  function radarUnreadCount(radar) { return radarRevision(radar).articles.filter(p=>!p.isBaseline&&!p.read).length; }
  function radarPaperTime(paper) { return paper.createdDay ? Date.parse(paper.createdDay) : paper.firstSeenAt; }
  function validateRadarState(value) {
    const fail = () => { throw radarError('RADAR_STATE_INVALID', '文献雷达本地数据版本或结构异常；原数据已保留，未覆盖。'); };
    if (!value || value.schema !== 1 || !Array.isArray(value.radars) || value.radars.length > 50) fail();
    const ids = new Set();
    for (const radar of value.radars) {
      if (!radar || typeof radar.id !== 'string' || !/^radar-[a-zA-Z0-9-]+$/.test(radar.id) || ids.has(radar.id) ||
          !Number.isSafeInteger(radar.editVersion) || radar.editVersion < 1 || !Array.isArray(radar.revisions) || !radar.revisions.length) fail();
      ids.add(radar.id);
      try { validateRadarConfig(radar); } catch { fail(); }
      radar.revisions.forEach((revision, i) => {
        if(revision.sourceQueries)try{validateRadarSourceQueries(revision.sourceQueries);}catch{fail();}
        if (revision.number !== i + 1 || typeof revision.query !== 'string' || !Array.isArray(revision.articles) ||
            !validBaseline(revision) || !Array.isArray(revision.warnings)) fail();
        if(revision.baselineHistory!=null&&(!Array.isArray(revision.baselineHistory)||revision.baselineHistory.length>100||revision.baselineHistory.some(h=>!h||!/^\d{4}-\d{2}-\d{2}$/.test(h.startDay)||!/^\d{4}-\d{2}-\d{2}$/.test(h.endDay)||h.startDay>h.endDay||!Number.isFinite(h.checkedAt)||!Number.isSafeInteger(h.matched)||h.matched<0||!Number.isSafeInteger(h.added)||h.added<0||h.added>h.matched)))fail();
        const papers = new Set();
        for (const paper of revision.articles) {
          if (!paper || !validRadarPaperId(paper.source||radar.source,paper.id) || ((paper.source||radar.source)!=='pubmed'&&!radarPaperUrl(paper.source||radar.source,paper)) || papers.has(paper.id) || typeof paper.title !== 'string' ||
              typeof paper.isBaseline !== 'boolean' || typeof paper.read !== 'boolean') fail();
          for(const record of [paper,...(paper.sourceRecords||[])])if(record.relatedPublications&&(!Array.isArray(record.relatedPublications)||record.relatedPublications.length>100||record.relatedPublications.some(r=>!radarPaperUrl(r.source,r)||typeof r.relation!=='string'||r.relation.length>100)))fail();
          if(paper.sourceRecords&&(!Array.isArray(paper.sourceRecords)||paper.sourceRecords.length>100||paper.sourceRecords.some(r=>!radarPaperUrl(r.source,r)||typeof r.title!=='string')))fail();
          papers.add(paper.id);
        }
      });
    }
    if (value.active != null && (typeof value.active.owner !== 'string' || !Number.isFinite(value.active.expiresAt))) fail();
    return value;
  }
  function emptyRadarState() { return { schema: 1, radars: [], active: null }; }
  return { isRadarPreprint, radarSourceQueries, validateRadarSourceQueries, radarDoi, radarPmid, radarIdentityKeys, mergeRadarArticles, DAY, RADAR_DATABASE, RADAR_SOURCES, validRadarPaperId, radarPaperUrl, radarError, radarClone: clone, radarDay: day, validateRadarConfig,
    radarCountYears, radarBaseline, radarScanWindow, radarRevision, radarUnreadCount, radarPaperTime, validateRadarState, emptyRadarState };
});
