(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./literature-radar-model.js'):root.BrevessRadar);
  if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.BrevessRadar||={},api);
})(globalThis,function(m){
  'use strict';
  // Official Scientific Corpus MCP, separate from the Asta website's agent/credits.
  const ENDPOINT='https://asta-tools.allen.ai/mcp/v1',LIMIT=50,MAX_BYTES=12000000;
  const fail=(code='RADAR_RESULT_INVALID',message='Asta 返回的数据不完整，未推进检查进度。')=>{throw m.radarError(code,message);};
  const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&m.radarDay(Date.parse(value))===value?value:null;
  const pause=(ms,signal)=>new Promise((resolve,reject)=>{
    signal?.throwIfAborted();const cancel=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);signal?.addEventListener('abort',cancel,{once:true});
  });
  function rows(value){
    if(Array.isArray(value))return value;
    if(value&&typeof value==='object'){
      if(typeof value.paperId==='string')return [value];
      for(const key of ['data','papers','result'])if(Array.isArray(value[key])){
        if(value.next!=null||value.hasMore===true||(Number.isFinite(value.total)&&value.total>value[key].length))fail('RADAR_QUERY_TOO_BROAD','Asta 仍有未返回的结果，请缩小检索范围；原进度已保留。');
        return value[key];
      }
    }
    fail();
  }
  function papers(result){
    if(result?.isError)fail('RADAR_SOURCE_TOOL','Asta 检索未成功，请检查检索词与来源授权后重试。');
    if(result?.structuredContent)return rows(result.structuredContent);
    if(!Array.isArray(result?.content))fail();
    const out=[];
    for(const block of result.content){
      if(block.type!=='text'||typeof block.text!=='string')fail();
      let parsed;try{parsed=JSON.parse(block.text);}catch{fail();}out.push(...rows(parsed));
    }
    return out;
  }
  async function rpcBody(response,id){
    const sse=response.headers.get('content-type')?.includes('text/event-stream');
    if(!sse&&!response.headers.get('content-type')?.includes('application/json'))fail();
    const reader=response.body?.getReader();if(!reader)fail();
    const decoder=new TextDecoder();let size=0,buffer='';
    const parse=text=>{let value;try{value=JSON.parse(text);}catch{fail();}return value;};
    const match=value=>{
      if(value?.jsonrpc!=='2.0')fail();
      if(value.id===id){if(value.error)fail('RADAR_SOURCE_TOOL','Asta 接口未接受请求，请检查来源授权或稍后重试。');if(!Object.hasOwn(value,'result'))fail();return value;}
      // Only notifications may precede the response. Never execute server requests.
      if(Object.hasOwn(value,'id'))fail();return null;
    };
    try{
      while(true){
        const chunk=await reader.read();if(chunk.done){buffer+=decoder.decode();break;}
        size+=chunk.value.byteLength;if(size>MAX_BYTES)fail();buffer+=decoder.decode(chunk.value,{stream:true});
        if(sse){let boundary;while((boundary=/\r?\n\r?\n/.exec(buffer))){
          const event=buffer.slice(0,boundary.index);buffer=buffer.slice(boundary.index+boundary[0].length);
          const data=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
          if(data){const value=match(parse(data));if(value)return value.result;}
        }}
      }
      if(!sse){const value=match(parse(buffer));if(value)return value.result;}fail();
    }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  function createAstaRadarAdapter({fetch=globalThis.fetch,getConnection=async()=>({}),sleep=pause,requestTimeoutMs=25000}={}){
    async function discover({query,startDay,endDay,signal}){
      if(typeof query!=='string'||!query.trim()||query.length>4000||!day(startDay)||!day(endDay)||startDay>endDay)fail('RADAR_CONFIG','请填写 Asta 检索词与有效日期。');
      signal?.throwIfAborted();const connection=await getConnection('asta');
      let sequence=0,session='',version='2025-03-26',searches=0;
      async function request(method,params,notification=false){
        signal?.throwIfAborted();const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);
        signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();const timer=setTimeout(()=>controller.abort(),requestTimeoutMs);
        const headers={Accept:'application/json, text/event-stream','Content-Type':'application/json'};
        if(connection.apiKey)headers['x-api-key']=connection.apiKey;
        if(session)headers['Mcp-Session-Id']=session;
        if(method!=='initialize')headers['MCP-Protocol-Version']=version;
        const id=++sequence;
        try{
          const response=await fetch(ENDPOINT,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id}),method,...(params?{params}:{})}),signal:controller.signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
          if(!response.ok){await response.body?.cancel().catch(()=>{});
            if([401,403].includes(response.status))fail('RADAR_ACCESS_DENIED','Asta 访问被拒绝，请检查 API Key、来源授权与网络。');
            if(response.status===429)fail('RADAR_RATE_LIMITED','Asta 限流或额度不足，请稍后重试。');
            fail('RADAR_SOURCE_HTTP','Asta 检索失败（HTTP '+response.status+'），原进度已保留。');
          }
          if(notification){await response.body?.cancel().catch(()=>{});return;}
          const result=await rpcBody(response,id);
          if(method==='initialize'){
            if(!['2025-03-26','2025-06-18','2025-11-25'].includes(result?.protocolVersion)||!result.capabilities?.tools)fail('RADAR_PROTOCOL','Asta 协议版本或检索能力不兼容，请稍后重试。');
            version=result.protocolVersion;session=response.headers.get('Mcp-Session-Id')||'';
            if(session&&!/^[\x21-\x7e]{1,2000}$/.test(session))fail();
          }
          return result;
        }catch(error){
          if(signal?.aborted)throw signal.reason;
          if(typeof error?.code==='string'&&error.code.startsWith('RADAR_'))throw error;
          fail(controller.signal.aborted?'RADAR_TIMEOUT':'RADAR_NETWORK',controller.signal.aborted?'Asta 请求超时，原进度已保留。':'Asta 网络连接失败，原进度已保留。');
        }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
      }
      await request('initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'Brevess-literature-radar',version:'1.0.1'}});
      await request('notifications/initialized',null,true);
      const found=new Map();let missingDate=false;
      async function search(start,end){
        if(++searches>127)fail('RADAR_QUERY_TOO_BROAD','Asta 检索范围过大，请缩小检索词或回溯范围；原进度已保留。');
        if(searches>1)await sleep(1100,signal);
        const result=await request('tools/call',{name:'search_papers_by_relevance',arguments:{keyword:query.trim(),fields:'title,abstract,authors,journal,publicationDate,url,venue,year',limit:LIMIT,publication_date_range:start+':'+end}});
        const records=papers(result);
        // Relevance search has no documented pagination. Split saturated windows,
        // and fail rather than silently commit a capped single-day response.
        if(records.length>=LIMIT){
          if(start===end)fail('RADAR_QUERY_TOO_BROAD','Asta 单日结果达到 50 篇上限，请缩小检索词；原进度已保留。');
          const mid=m.radarDay(Date.parse(start)+Math.floor((Date.parse(end)-Date.parse(start))/m.DAY/2)*m.DAY);
          await search(start,mid);await search(m.radarDay(Date.parse(mid)+m.DAY),end);return;
        }
        for(const p of records){
          const id='asta:'+p?.paperId;if(!m.validRadarPaperId('asta',id)||typeof p.title!=='string'||!p.title.trim())fail();
          if(p.abstract!=null&&typeof p.abstract!=='string')fail();
          const date=day(p.publicationDate);if(!date)missingDate=true;
          found.set(id,{source:'asta',id,title:p.title.trim(),url:m.radarPaperUrl('asta',{id}),doi:'',journal:typeof p.journal?.name==='string'?p.journal.name:typeof p.venue==='string'?p.venue:'',authors:Array.isArray(p.authors)?p.authors.map(a=>a?.name).filter(a=>typeof a==='string'):[],createdDay:date,publicationDate:date||String(p.year||''),abstractSections:p.abstract?[{label:'',text:p.abstract}]:[],abstractStatus:p.abstract?'ready':'missing',abstractSource:'asta-scientific-corpus',abstractError:null});
          if(found.size>5000)fail('RADAR_QUERY_TOO_BROAD','本次超过 5,000 篇处理上限，请缩小检索范围；原进度已保留。');
        }
      }
      await search(startDay,endDay);
      return {articles:[...found.values()],queryTranslation:query,warnings:['Asta 按发表日期进行相关性检索；与网页 Deep search 不同，不保证穷尽收录。晚到索引超过 7 天重叠范围可能漏检。',...(missingDate?['部分文献缺少具体发表日期；来源按年份的 1 月 1 日筛选，列表保留年份，不补造日期。']:[])]};
    }
    return {source:'asta',discover};
  }
  return {createAstaRadarAdapter};
});
