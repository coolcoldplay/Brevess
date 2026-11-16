(function(root,factory){
  const common=typeof module==='object'&&module.exports;
  const api=factory(common?{...require('./literature-radar-model.js'),...require('./literature-radar-pubmed.js'),...require('./literature-radar-asta.js')}:root.BrevessRadar);
  if(common)module.exports=api;Object.assign(root.BrevessRadar||={},api);
})(globalThis,function(m){
  'use strict';
  const connectionKey=source=>'brevessRadarConnection:'+source;
  async function loadRadarConnection(source,storage=globalThis.chrome?.storage?.local){
    if(!['asta','wos','scopus'].includes(source)||!storage)return {};
    return (await storage.get(connectionKey(source)))[connectionKey(source)]||{};
  }
  async function saveRadarConnection(source,config,storage=globalThis.chrome?.storage?.local){
    if(!['asta','wos','scopus'].includes(source)||!storage)throw m.radarError('RADAR_CONNECTION_INVALID');
    const clean={};for(const key of source==='scopus'?['apiKey','instToken']:['apiKey']){
      const value=String(config?.[key]||'').trim();if(value.length>2000||/[\s\u0000-\u001f]/u.test(value))throw m.radarError('RADAR_CONNECTION_INVALID');if(value)clean[key]=value;
    }
    if(!clean.apiKey)throw m.radarError('RADAR_KEY_REQUIRED','请填写该来源的 API Key。');
    await storage.set({[connectionKey(source)]:clean});return {configured:true};
  }
  async function removeRadarConnection(source,storage=globalThis.chrome?.storage?.local){
    if(!['asta','wos','scopus'].includes(source)||!storage)throw m.radarError('RADAR_CONNECTION_INVALID');
    await storage.remove(connectionKey(source));
  }
  const decode=text=>String(text||'').replace(/&#(?:x([\da-f]+)|(\d+));|&(amp|lt|gt|quot|apos|nbsp);/gi,(_,hex,num,named)=>{
    if(named)return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[named.toLowerCase()];
    const n=parseInt(hex||num,hex?16:10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';
  });
  const plain=value=>decode(String(value||'').replace(/<[^>]*>/g,' ')).replace(/\s+/gu,' ').trim();
  const day=value=>{const v=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().startsWith(v)?v:null;};
  const abstracts=(text,source)=>({abstractSections:text?[{label:'',text:plain(text)}]:[],abstractStatus:text?'ready':'missing',abstractSource:source,abstractError:null});
  const bad=()=>{throw m.radarError('RADAR_RESULT_INVALID','来源返回的数据不完整，未推进检查进度。');};
  const broad=()=>{throw m.radarError('RADAR_QUERY_TOO_BROAD','本次超过 5,000 篇处理上限。请缩小检索式或回溯范围；未截断结果或推进进度。');};
  function parseRadarArxiv(xml){
    if(typeof xml!=='string'||xml.length>12000000||/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<\/feed>\s*$/.test(xml))bad();
    const tag=(s,n)=>{const match=new RegExp('<'+n+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+n+'>').exec(s);return match?plain(match[1]):'';};
    const total=Number(tag(xml,'opensearch:totalResults'));if(!Number.isSafeInteger(total)||total<0||!/<opensearch:totalResults\b/.test(xml))bad();
    const entries=[...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)];
    if(entries.length!==(xml.match(/<entry(?:\s|>)/g)||[]).length)bad();
    return {total,articles:entries.map(([,entry])=>{
      const raw=tag(entry,'id').replace(/^https?:\/\/arxiv.org\/abs\//,'').replace(/v\d+$/,''),id='arxiv:'+raw;
      const title=tag(entry,'title');if(!m.validRadarPaperId('arxiv',id)||!title)bad();
      return {id,title,url:'https://arxiv.org/abs/'+raw,doi:tag(entry,'arxiv:doi'),journal:tag(entry,'arxiv:journal_ref')||'arXiv',
        authors:[...entry.matchAll(/<author>([\s\S]*?)<\/author>/g)].map(([,a])=>tag(a,'name')),createdDay:day(tag(entry,'published')),publicationDate:tag(entry,'published'),preprint:true,source:'arxiv',...abstracts(tag(entry,'summary'),'arxiv-api')};
    })};
  }
  function createAdditionalRadarAdapter(source,{fetch=globalThis.fetch,getConnection=loadRadarConnection,sleep=(ms,signal)=>new Promise((resolve,reject)=>{
    signal?.throwIfAborted();const cancel=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);signal?.addEventListener('abort',cancel,{once:true});
  }),now=Date.now,requestTimeoutMs=25000}={}){
    if(!m.RADAR_SOURCES[source]||source==='pubmed')throw m.radarError('RADAR_SOURCE_UNAVAILABLE');
    let nextAt=0;
    async function request(base,params,signal,xml=false){
      signal?.throwIfAborted();if(nextAt>now())await sleep(nextAt-now(),signal);signal?.throwIfAborted();
      nextAt=now()+(source==='arxiv'?3100:source==='wos'?1100:350);
      const connection=await getConnection(source);const headers={Accept:xml?'application/atom+xml':'application/json'};
      if(m.RADAR_SOURCES[source].credential){
        if(!connection.apiKey)throw m.radarError('RADAR_KEY_REQUIRED','此来源需要 API Key，请先打开“来源连接”配置。');
        headers[source==='wos'?'X-ApiKey':'X-ELS-APIKey']=connection.apiKey;
        if(source==='scopus'&&connection.instToken)headers['X-ELS-Insttoken']=connection.instToken;
      }
      const url=new URL(base);for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
      const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();const timer=setTimeout(()=>controller.abort(),requestTimeoutMs);
      try{
        const response=await fetch(url.href,{headers,signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',redirect:'error'});
        if(!response.ok){const code=[401,403].includes(response.status)?'RADAR_ACCESS_DENIED':response.status===429?'RADAR_RATE_LIMITED':'RADAR_SOURCE_HTTP';
          throw m.radarError(code,code==='RADAR_ACCESS_DENIED'?'来源授权未通过，请检查 API Key、机构权限和网络。':code==='RADAR_RATE_LIMITED'?'来源限流或额度不足，请稍后重试。':'来源检索失败（HTTP '+response.status+'），原进度已保留。');}
        return xml?await response.text():await response.json();
      }catch(error){if(signal?.aborted)throw signal.reason;if(typeof error.code==='string'&&error.code.startsWith('RADAR_'))throw error;throw m.radarError(controller.signal.aborted?'RADAR_TIMEOUT':'RADAR_SOURCE_NETWORK','来源网络请求失败或超时，原进度已保留。');}
      finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
    }
    async function discover({query,startDay,endDay,signal}){
      if(!query?.trim()||!day(startDay)||!day(endDay)||startDay>endDay)throw m.radarError('RADAR_ARGUMENT');
      const articles=[],ids=new Set();let cursor='*',offset=0,page=1,total=null,expectedTotal=null;
      const append=rows=>{for(const row of rows){if(!m.radarPaperUrl(source,row)||!row.title)bad();if(!ids.has(row.id)){ids.add(row.id);articles.push(row);}}if(articles.length>5000)broad();};
      while(true){
        signal?.throwIfAborted();let rows,next;
        if(['europepmc','biorxiv','medrxiv'].includes(source)){
          const publisher=source==='europepmc'?'':` AND SRC:PPR AND PUBLISHER:"${source==='biorxiv'?'bioRxiv':'medRxiv'}"`;
          const data=await request('https://www.ebi.ac.uk/europepmc/webservices/rest/search',{query:`(${query})${publisher} AND FIRST_IDATE:[${startDay} TO ${endDay}]`,format:'json',resultType:'core',pageSize:100,cursorMark:cursor},signal);
          if(!data||data.errCode!=null||data.errMsg||data.error||!['number','string'].includes(typeof data.hitCount)||!/^\d+$/.test(String(data.hitCount))||!Array.isArray(data.resultList?.result))bad();
          total=Number(data.hitCount);if(expectedTotal!==null&&total!==expectedTotal)bad();expectedTotal=total;next=data.nextCursorMark;
          if(source!=='europepmc'&&data.resultList.result.some(r=>!r||r.source!=='PPR'||(r.bookOrReportDetails?.publisher&&String(r.bookOrReportDetails.publisher).toLowerCase()!==source)))bad();
          rows=data.resultList.result.map(r=>({id:source==='europepmc'?`epmc:${r.source}:${r.id}`:`${source}:${r.id}`,title:plain(r.title),doi:r.doi||'',url:r.doi?'https://doi.org/'+r.doi:`https://europepmc.org/article/${r.source}/${r.id}`,authors:(r.authorList?.author||[]).map(a=>a.fullName),journal:r.journalInfo?.journal?.title||r.bookOrReportDetails?.publisher||'Europe PMC',createdDay:day(r.firstIndexDate||r.dateOfCreation),publicationDate:r.firstPublicationDate||r.pubYear||'',source,preprint:r.source==='PPR',...(r.versionNumber?{version:String(r.versionNumber).slice(0,40)}:{}),relatedPublications:(r.commentCorrectionList?.commentCorrection||[]).filter(c=>c.source==='MED'&&/^\d+$/.test(String(c.id))&&['Preprint of','Preprint in','Update of','Update in','Erratum in','Retraction in'].includes(c.type)).slice(0,100).map(c=>({source:'pubmed',id:String(c.id),relation:c.type,url:'https://pubmed.ncbi.nlm.nih.gov/'+c.id+'/'})),...abstracts(r.abstractText,'europepmc')}));
        }else if(source==='arxiv'){
          const data=parseRadarArxiv(await request('https://export.arxiv.org/api/query',{search_query:`(${query}) AND submittedDate:[${startDay.replaceAll('-','')}0000 TO ${endDay.replaceAll('-','')}2359]`,start:offset,max_results:100,sortBy:'submittedDate',sortOrder:'descending'},signal,true));
          total=data.total;rows=data.articles;next=String(offset+rows.length);
        }else if(source==='crossref'){
          const data=await request('https://api.crossref.org/works',{query,filter:`from-index-date:${startDay},until-index-date:${endDay}`,rows:100,cursor},signal);const body=data.message;
          total=Number(body?.['total-results']);next=body?.['next-cursor'];if(!Array.isArray(body?.items))bad();
          rows=body.items.map(r=>({id:'crossref:'+String(r.DOI).toLowerCase(),title:plain(r.title?.[0]),doi:r.DOI,url:'https://doi.org/'+r.DOI,authors:(r.author||[]).map(a=>[a.given,a.family].filter(Boolean).join(' ')),journal:r['container-title']?.[0]||'',createdDay:day(r.indexed?.['date-time']),publicationDate:r.published?.['date-parts']?.[0]?.join('-')||'',source,preprint:r.type==='posted-content',...abstracts(r.abstract,'crossref')}));
        }else if(source==='wos'){
          const data=await request('https://api.clarivate.com/apis/wos-starter/v1/documents',{q:query,db:'WOS',limit:50,page,sortField:'LD+D',modifiedTimeSpan:startDay+'+'+endDay},signal);
          total=Number(data.metadata?.total);if(!Array.isArray(data.hits))bad();next=String(page+1);
          rows=data.hits.map(r=>({id:'wos:'+r.uid,title:plain(r.title),url:'https://www.webofscience.com/wos/woscc/full-record/'+r.uid,doi:r.identifiers?.doi||'',authors:(r.names?.authors||[]).map(a=>a.displayName||a.wosStandard),journal:r.source?.sourceTitle||'',createdDay:day(r.modifiedTime||r.loadDate),publicationDate:String(r.source?.publishYear||''),source,...abstracts(r.abstract,'wos-starter')}));
        }else if(source==='scopus'){
          const before=new Date(Date.parse(endDay)+m.DAY).toISOString().slice(0,10).replaceAll('-',''),after=new Date(Date.parse(startDay)-m.DAY).toISOString().slice(0,10).replaceAll('-','');
          const data=await request('https://api.elsevier.com/content/search/scopus',{query:`(${query}) AND LOAD-DATE AFT ${after} AND LOAD-DATE BEF ${before}`,count:25,start:offset,view:'STANDARD'},signal);const body=data['search-results'];
          total=Number(body?.['opensearch:totalResults']);if(!Array.isArray(body?.entry))bad();next=String(offset+25);
          rows=total===0?[]:body.entry.map(r=>({id:'scopus:'+r.eid,title:plain(r['dc:title']),url:'https://www.scopus.com/record/display.uri?eid='+r.eid,doi:r['prism:doi']||'',authors:r['dc:creator']?[r['dc:creator']]:[],journal:r['prism:publicationName']||'',createdDay:day(r['load-date']),publicationDate:r['prism:coverDate']||'',source,...abstracts(r['dc:description'],'scopus')}));
        }
        if(!Number.isSafeInteger(total)||total<0)bad();if(total>5000)broad();if(!rows.length&&offset<total)bad();append(rows);offset+=rows.length;
        if(offset>=total)break;
        if(!next||next===cursor||page>=200)bad();cursor=next;page++;
      }
      if(articles.length!==total)bad();
      return {articles,warnings:[source==='biorxiv'||source==='medrxiv'?'预印本通过 Europe PMC 索引检索，可能晚于网站发布。':source==='arxiv'?'按首次提交日期检索，修订稿不会作为新增论文重复计数。':source==='wos'||source==='scopus'?'结果受当前 API 权限和额度限制；接口未提供摘要或日期时不编造内容。':source==='crossref'?'Crossref 使用相关性关键词检索，摘要由出版方提供，可能缺失。':'包含 Europe PMC 收录的期刊论文和预印本。'],queryTranslation:query};
    }
    return {source,discover};
  }
  function createRadarAdapters(options={}){return Object.fromEntries(Object.keys(m.RADAR_SOURCES).map(source=>[source,source==='pubmed'?m.createPubMedRadarAdapter(options):source==='asta'?m.createAstaRadarAdapter({getConnection:loadRadarConnection,...options}):createAdditionalRadarAdapter(source,options)]));}
  return {createAdditionalRadarAdapter,createRadarAdapters,parseRadarArxiv,loadRadarConnection,saveRadarConnection,removeRadarConnection};
});
