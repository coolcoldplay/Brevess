(function(g,f){const api=f();if(typeof module==='object')module.exports=api;g.WFGReadingPubmed=api;})(globalThis,function(){
'use strict';
function url(pmid){if(!/^[1-9]\d{0,8}$/.test(pmid))throw Error('INVALID_PMID');return 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id='+pmid+'&retmode=xml';}
function parse(xml,pmid,Parser=DOMParser){
 url(pmid);if(typeof xml!=='string'||xml.length>2000000||/<!ENTITY/i.test(xml))throw Error('ABSTRACT_PAYLOAD_INVALID');
 const doc=new Parser().parseFromString(xml,'text/xml');if(doc.querySelector('parsererror')||!doc.querySelector('PubmedArticleSet'))throw Error('ABSTRACT_NOT_PUBMED_XML');
 const records=[...doc.querySelectorAll('PubmedArticleSet > PubmedArticle')].filter(n=>n.querySelector('MedlineCitation > PMID')?.textContent.trim()===pmid);
 if(records.length!==1)throw Error('ABSTRACT_PMID_MISMATCH');const article=records[0].querySelector('MedlineCitation > Article');if(!article)throw Error('ABSTRACT_ARTICLE_MISSING');
 const sections=[...article.querySelectorAll(':scope > Abstract > AbstractText')].map(n=>({label:n.getAttribute('Label')||'',text:n.textContent.trim()}));
 return {pmid,status:sections.some(s=>s.text)?'available':'unavailable',complete:true,sections,text:sections.map(s=>(s.label?s.label+'\n':'')+s.text).join('\n\n'),sourceUrl:url(pmid),copyright:article.querySelector('Abstract > CopyrightInformation')?.textContent||''};
}
async function fetchXML(pmid,{fetcher=fetch,signal}={}){
 const response=await fetcher(url(pmid),{credentials:'omit',redirect:'error',signal,referrerPolicy:'no-referrer'});
 if(!response.ok){const error=Error('ABSTRACT_HTTP_'+response.status),raw=response.headers?.get?.('retry-after'),seconds=Number(raw);error.retryAfterMs=raw?(Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(raw)-Date.now())||0):0;throw error;}if(response.url&&new URL(response.url).origin!=='https://eutils.ncbi.nlm.nih.gov')throw Error('ABSTRACT_REDIRECT_DENIED');
 const reader=response.body?.getReader();if(!reader){const text=await response.text();if(text.length>2000000)throw Error('ABSTRACT_TOO_LARGE');return text;}
 let bytes=0,text='';const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2000000){await reader.cancel();throw Error('ABSTRACT_TOO_LARGE');}text+=decoder.decode(value,{stream:true});}return text+decoder.decode();
}
// One paced queue for all tabs; a cancelled subscriber cannot keep an orphan fetch alive.
function queue({fetcher=fetch,spacing=400,timeout=20000,retryBase=1000,maxRetries=2,now=()=>Date.now()}={}){
 const jobs=new Map(),cache=new Map();let active=0,last=0,timer=null,cacheBytes=0,cooldown=0;
 const retryable=e=>/^(ABSTRACT_HTTP_(429|5\d\d)|ABSTRACT_TIMEOUT|ABSTRACT_NETWORK)$/.test(e.message)&&!(e.retryAfterMs>30000);
 function pump(){
  clearTimeout(timer);timer=null;if(active>=2)return;
  const waiting=[...jobs.values()].filter(j=>!j.started&&j.clients.size).sort((a,b)=>a.readyAt-b.readyAt),job=waiting[0];if(!job)return;
  const delay=Math.max(0,last+spacing-now(),job.readyAt-now(),cooldown-now());if(delay){timer=setTimeout(pump,delay);return;}
  job.started=true;job.attempts++;active++;last=now();job.controller=new AbortController();let timedOut=false;
  const deadline=setTimeout(()=>{timedOut=true;job.controller.abort();},timeout);
  fetchXML(job.pmid,{fetcher,signal:job.controller.signal}).then(xml=>{
   if(job.clients.size){if(cache.has(job.pmid))cacheBytes-=cache.get(job.pmid).xml.length;cache.set(job.pmid,{xml,at:now()});cacheBytes+=xml.length;while(cache.size>100||cacheBytes>8000000){const id=cache.keys().next().value;cacheBytes-=cache.get(id).xml.length;cache.delete(id);}}
   for(const c of job.clients.values())c.resolve(xml);job.done=true;
  },reason=>{
   const error=timedOut?Error('ABSTRACT_TIMEOUT'):reason instanceof TypeError?Error('ABSTRACT_NETWORK'):reason;
   if(job.clients.size&&jobs.get(job.pmid)===job&&job.attempts<=maxRetries&&retryable(error)){
    const delay=Math.max(retryBase*2**(job.attempts-1),error.retryAfterMs||0);job.readyAt=now()+delay;job.retry=true;
    if(error.message==='ABSTRACT_HTTP_429')cooldown=Math.max(cooldown,job.readyAt);
   }else{for(const c of job.clients.values())c.reject(error);job.done=true;}
  }).finally(()=>{clearTimeout(deadline);active--;if(job.retry&&!job.done&&job.clients.size&&jobs.get(job.pmid)===job){job.retry=false;job.started=false;}else if(jobs.get(job.pmid)===job)jobs.delete(job.pmid);pump();});pump();
 }
 function load(pmid,owner){url(pmid);const hit=cache.get(pmid);if(hit&&now()-hit.at<3600000)return Promise.resolve(hit.xml);if(hit){cacheBytes-=hit.xml.length;cache.delete(pmid);}let job=jobs.get(pmid);if(!job){job={pmid,clients:new Map(),started:false,readyAt:0,attempts:0};jobs.set(pmid,job);}const key=owner+':'+crypto.randomUUID();return new Promise((resolve,reject)=>{job.clients.set(key,{owner,resolve,reject});pump();});}
 function cancel(owner){for(const job of jobs.values()){for(const [id,c]of job.clients)if(c.owner===owner){c.reject(Error('ABSTRACT_CANCELLED'));job.clients.delete(id);}if(!job.clients.size){job.controller?.abort();if(jobs.get(job.pmid)===job)jobs.delete(job.pmid);}}pump();}
 return {load,cancel,stats:()=>({active,queued:jobs.size,cached:cache.size,cacheBytes})};
}
return {url,parse,fetchXML,queue};
});
