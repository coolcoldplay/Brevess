(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.BrevessWebReading=Object.assign(root.BrevessWebReading||{},api);})(globalThis,function(){
 'use strict';
 function createWebController({browser,core,focus,persistence,createTask,deletePaper}){
  const operations=new Map(),bindings=new Map(),knownContexts=new Map();const fail=c=>{throw Error(c);};
  const trusted=s=>s?.id===browser.runtime.id&&!s.tab&&s.url?.split(/[?#]/)[0]===browser.runtime.getURL('popup.html');
  const active=async windowId=>(await browser.tabs.query({active:true,windowId:Number(windowId)}))[0];
  const publish=async data=>{try{await browser.runtime.sendMessage({type:'BREVESS_WEB_READING_EVENT',...data});}catch(_){};};
  async function page(tab,command,extra={}){const response=await browser.tabs.sendMessage(tab.id,{type:'BREVESS_WEB_READING_PAGE',command,...extra});if(!response?.success)fail(response?.error||'WEB_PAGE_UNAVAILABLE');return response.data;}
  async function current(windowId,expected,{readOnlyLocate=false}={}){
   const tab=await active(windowId);if(!tab||!/^https?:|^file:/.test(tab.url||''))fail('WEB_PAGE_UNAVAILABLE');
   if(expected&&(tab.id!==expected.tabId||core.sourceUrl(tab.url)!==expected.sourceUrl))fail('WEB_CONTEXT_CHANGED');
   const site=core.siteInfo?.(tab.url);const preview=site?.conversation||site?.feed?{type:'nonpaper'}:await focus.preview(tab);if(preview.type==='paper'||/\.pdf(?:[?#]|$)|\/pdf(?:\/|[?#]|$)/i.test(tab.url))return{paper:true,tab};
   await browser.scripting.executeScript({target:{tabId:tab.id},files:['core/web-reading-page.js']});
   const snapshot=await page(tab,'READ'),again=await active(windowId);
   if(again?.id!==tab.id||again?.url!==tab.url||snapshot.sourceUrl!==core.sourceUrl(tab.url))fail('WEB_CONTEXT_CHANGED');
   if(snapshot.kind==='paper')return{paper:true,tab};
   if(expected&&(snapshot.documentToken!==expected.documentToken||!readOnlyLocate&&snapshot.revision!==expected.revision))fail('WEB_CONTEXT_CHANGED');
   const binding={tabId:tab.id,sourceUrl:snapshot.sourceUrl,documentToken:snapshot.documentToken,revision:snapshot.revision};
   const old=bindings.get(Number(windowId));if(old&&old.tabId!==tab.id)browser.tabs.sendMessage(old.tabId,{type:'BREVESS_WEB_READING_PAGE',command:'STOP'}).catch(()=>{});
   bindings.set(Number(windowId),binding);const result={tab,snapshot,context:binding};knownContexts.set(windowId+':'+snapshot.documentToken+':'+snapshot.revision,result);while(knownContexts.size>100)knownContexts.delete(knownContexts.keys().next().value);return result;
  }
  async function handle(m,sender){
   if(!trusted(sender))fail('WEB_CALLER_DENIED');const windowId=Number(m.windowId);if(!Number.isInteger(windowId))fail('WEB_WINDOW_REQUIRED');
   if(m.command==='CANCEL'){const op=operations.get(m.operationId);if(op&&op.windowId===windowId){op.controller.abort();return{cancelled:true};}return{cancelled:false};}
   if(m.command==='PAPER_DELETE'){
    const tab=await active(windowId);if(!tab||typeof deletePaper!=='function')fail('PAPER_PATH_REQUIRED');
    const legacyContext=await current(windowId),legacy=legacyContext.paper?null:await persistence.read(legacyContext.snapshot);
    if([...operations.values()].some(o=>o.context.sourceUrl===legacyContext.snapshot?.sourceUrl))fail('WEB_OPERATION_ACTIVE');
    const result=await deletePaper(m,tab);
    if(legacy?.asset){try{
      await current(windowId,legacyContext.context);
      const saved=await persistence.save(legacyContext.snapshot,{deletePage:m.deletePage===true,deleteUserData:m.deleteUserData===true},legacy.asset.revision);
      await page(tab,'RESTORE',{annotations:saved.asset.content.annotations||[]});result.legacyDeleted=true;
    }catch(error){throw Error('原模块所选资料已删除，旧网页记录尚未删除，请重试：'+error.message);}}
    return result;
   }
   if(!['READ','SAVE','ASK','LOCATE','CAPTURE','ANNOTATIONS','DELETE','SYNC','ANCHOR'].includes(m.command))fail('WEB_COMMAND_INVALID');
   const retained=['SAVE','ANNOTATIONS'].includes(m.command)&&m.savePage!==true?knownContexts.get(windowId+':'+m.context?.documentToken+':'+m.context?.revision):null;
   const c=retained&&retained.context.sourceUrl===m.context?.sourceUrl&&retained.tab.id===m.context?.tabId?retained:await current(windowId,m.command==='READ'?null:m.context,{readOnlyLocate:m.command==='LOCATE'});if(c.paper){if(m.command==='READ')return{paper:true,tabId:c.tab.id};fail('PAPER_PATH_REQUIRED');}
   if(m.command==='READ'){
    let stored=null,history={items:[],hasMore:false},storageError='';try{stored=await persistence.read(c.snapshot);history=await persistence.turns(c.snapshot);}catch(e){storageError=e.message;}
    const restored=await page(c.tab,'RESTORE',{annotations:stored?.asset?.content?.annotations||[]});
    return{snapshot:c.snapshot,context:c.context,saved:stored?.asset||null,history,storageError,sync:stored?.sync,restored};
   }
   if(!m.context)fail('WEB_CONTEXT_REQUIRED');
   if(m.command==='LOCATE')return page(c.tab,'LOCATE',{ref:m.ref});
   if(m.command==='ANCHOR')return page(c.tab,'ANCHOR',{anchor:m.anchor});
   if(m.command==='SYNC')return persistence.sync(c.snapshot);
   if(m.command==='DELETE'){
    if(!m.deletePage&&!m.deleteUserData)fail('WEB_DELETE_SELECTION_REQUIRED');
    if([...operations.values()].some(o=>o.context.sourceUrl===c.snapshot.sourceUrl))fail('WEB_OPERATION_ACTIVE');
    const saved=await persistence.save(c.snapshot,{deletePage:m.deletePage===true,deleteUserData:m.deleteUserData===true},Number(m.expectedRevision)||0);
    await page(c.tab,'RESTORE',{annotations:saved.asset.content.annotations||[]});return saved;
   }
   if(m.command==='CAPTURE'||m.command==='ANNOTATIONS'){
    const prior=await persistence.read(c.snapshot);
    const annotations=m.command==='CAPTURE'?[...(prior.asset?.content?.annotations||[]),...await page(c.tab,'CAPTURE')]:m.annotations;
    const saved=await persistence.save(c.snapshot,{annotations,...(m.command==='CAPTURE'?{expectedAnnotations:prior.asset?.content?.annotations||[]}:(Object.hasOwn(m,'expectedAnnotations')?{expectedAnnotations:m.expectedAnnotations}:{}))},Number(m.expectedRevision)||0);
    // A delayed edit belongs to its captured source, even after tab navigation.
    const live=browser.tabs.get?await browser.tabs.get(c.tab.id).catch(()=>null):await active(windowId);
    if(live?.id===c.tab.id&&core.sourceUrl(live.url)===c.context.sourceUrl)await page(c.tab,'RESTORE',{annotations});return saved;
   }
   if(m.command==='SAVE')return persistence.save(c.snapshot,{...(Object.hasOwn(m,'notes')?{notes:m.notes}:{}),...(Object.hasOwn(m,'expectedNotes')?{expectedNotes:m.expectedNotes}:{}),savePage:m.savePage===true},Number(m.expectedRevision)||0);
   if(typeof m.operationId!=='string'||m.operationId.length>100||operations.has(m.operationId)||[...operations.values()].some(o=>o.windowId===windowId))fail('WEB_OPERATION_ACTIVE');
   const controller=new AbortController(),op={controller,windowId,context:c.context};operations.set(m.operationId,op);let questionSaved=false;
   try{
    const pending={turnId:m.operationId,question:String(m.question||'').trim(),answer:'',status:'pending',scope:m.scope,sourceUrl:c.snapshot.sourceUrl,sourceRevision:c.snapshot.revision,sources:[]};
    if(!pending.question||pending.question.length>8000)fail('WEB_QUESTION_REQUIRED');
    core.selectScope(c.snapshot,{scope:m.scope,sectionId:m.sectionId,turnId:m.turnId,selection:m.selection});
    const initial=await persistence.save(c.snapshot,{},Number(m.expectedRevision)||0);await persistence.append(c.snapshot,pending);questionSaved=true;
    const task=await createTask();if(typeof task.adapter?.generateTextStream!=='function')fail('WEB_STREAM_UNAVAILABLE');
    if(controller.signal.aborted)fail('WEB_CANCELLED');
    const history=await persistence.turns(c.snapshot);
    const request={question:m.question,scope:m.scope,sectionId:m.sectionId,turnId:m.turnId,selection:m.selection,history:history.items||[],maxCharacters:task.maxCharacters,maxOutputTokens:task.maxOutputTokens};
    core.prepareRequest(c.snapshot,request);await current(windowId,c.context);
    const saved=initial;
    const result=await core.runAnswer({adapter:task.adapter,snapshot:c.snapshot,request,signal:controller.signal,
     onPrepared:p=>publish({windowId,operationId:m.operationId,context:c.context,coverage:p.coverage}),
     onDelta:delta=>publish({windowId,operationId:m.operationId,context:c.context,delta})});
    await current(windowId,c.context);if(controller.signal.aborted)fail('WEB_CANCELLED');
    const cited=new Set([...result.text.matchAll(/\[(\d+)\]/g)].map(m=>Number(m[1])));
    const turn={turnId:m.operationId,question:String(m.question).trim(),answer:result.text,status:'complete',scope:m.scope,sectionId:m.sectionId||null,turnIdSource:m.turnId||null,sourceUrl:c.snapshot.sourceUrl,sourceRevision:c.snapshot.revision,sources:result.sources.filter(ref=>cited.has(ref.citation)),coverage:result.coverage,usage:result.usage};
    try{const committed=await persistence.append(c.snapshot,turn);return{turn,saved:committed?.asset||saved.asset,sync:committed?.sync};}catch(e){return{turn,saved:saved.asset,saveError:e.message};}
   }catch(e){
    if(questionSaved)try{await persistence.append(c.snapshot,{turnId:m.operationId,question:String(m.question||'').trim(),answer:'',status:controller.signal.aborted?'cancelled':'failed',error:e.code||e.message,scope:m.scope,sourceUrl:c.snapshot.sourceUrl,sourceRevision:c.snapshot.revision,sources:[]});}catch(_){}
    throw e;
   }finally{operations.delete(m.operationId);}
  }
  function register(){
   browser.runtime.onMessage.addListener((m,s,reply)=>{
    if(m?.type==='BREVESS_WEB_READING_CHANGED'){
     if(s?.id!==browser.runtime.id||!s.tab||s.frameId&&s.frameId!==0)return false;
     for(const [windowId,b]of bindings)if(b.tabId===s.tab.id&&b.documentToken===m.documentToken){publish(m.position?{windowId,position:true,currentId:m.currentId,tabId:s.tab.id}:{windowId,changed:true,tabId:s.tab.id});}
     return false;
    }
    if(m?.type!=='BREVESS_WEB_READING')return false;
    handle(m,s).then(data=>reply({success:true,data}),e=>reply({success:false,error:e.code||e.message}));return true;
   });
   const invalidate=(tabId,windowId)=>{for(const op of operations.values())if(op.context.tabId===tabId||op.windowId===windowId)op.controller.abort();};
   browser.tabs.onActivated.addListener(info=>{invalidate(null,info.windowId);publish({windowId:info.windowId,changed:true});});
   browser.tabs.onUpdated.addListener((tabId,change,tab)=>{
    if(change.url||change.status==='loading'){invalidate(tabId);publish({windowId:tab.windowId,changed:true});}
    if(change.status==='complete'&&/^https?:|^file:/.test(tab.url||''))void(async()=>{
      const url=core.sourceUrl(tab.url),s={kind:core.siteInfo?.(url).conversation?'conversation':'article',sourceUrl:url,title:tab.title||'',blocks:[]};
      const stored=await persistence.read(s),annotations=stored.asset?.content?.annotations;if(!annotations?.length)return;
      const latest=await browser.tabs.get(tabId);if(core.sourceUrl(latest.url)!==url)return;
      await browser.scripting.executeScript({target:{tabId},files:['core/web-reading-page.js']});await page(latest,'RESTORE',{annotations});
    })().catch(()=>{});
   });
   browser.tabs.onRemoved.addListener(tabId=>invalidate(tabId));
  }
  return{handle,register};
 }
 return{createWebController};
});
