(function(){'use strict';if(globalThis.__wfgUXEntry)return;globalThis.__wfgUXEntry=true;const b=chrome;let page,reading,readingSession=null,readingSourcesSignature=null;
const engine=WFGEngine.create({document,shadow:el=>b.dom?.openOrClosedShadowRoot?.(el)||el.shadowRoot,closedCapable:typeof b.dom?.openOrClosedShadowRoot==='function',onChange:e=>{if(e.type==='dynamic'||e.type==='failed')void b.runtime.sendMessage({type:'WFG_UX',command:'OUTLINE_CHANGED'}).catch(()=>{});if(e.type==='navigation'){page?.clear();void b.runtime.sendMessage({type:'WFG_UX',command:'PAGE_CHANGED'}).catch(()=>{});}}});
async function send(command,data={}){const r=await b.runtime.sendMessage({type:'WFG_UX',command,...data});if(!r?.ok)throw Error(r?.error||'REQUEST_FAILED');return r.data;}
async function readingCall(command,data={}){const r=await b.runtime.sendMessage({type:'WFG_READING',command,...data});if(!r?.ok)throw Error(r?.error||'READING_FAILED');return r.data;}
// Abstract results update individually; publish one current view per short tick.
let readingNotificationTimer=null,readingNotificationsSuspended=false;
const readingSourceNodes=new WeakMap();let readingSourceNodeSerial=0;
function readingSourceNodeKey(node){if(!node||typeof node!=='object')return 0;if(!readingSourceNodes.has(node))readingSourceNodes.set(node,++readingSourceNodeSerial);return readingSourceNodes.get(node);}
function publishReadingChange(){
 readingNotificationTimer=null;
 if(readingNotificationsSuspended||!reading)return;
 // A same-document navigation is reconciled by the reading-page observer.
 // Do not announce its previous URL while that reconciliation is pending.
 const readingSnapshot=reading.snapshot();if(readingSnapshot.url!==document.location.href)return;
 // Source hashes identify text; a replacement body still needs new local
 // annotation bindings. These node numbers never leave this closure.
 const signature=JSON.stringify([readingSnapshot.session,(reading.blocks()||[]).map(x=>[x.sourceId,x.sourceHash,readingSourceNodeKey(x.element)])]);if(signature!==readingSourcesSignature){readingSourcesSignature=signature;document.dispatchEvent(new Event('brevess:reading-sources-changed'));}void b.runtime.sendMessage({type:'WFG_UX',command:'OUTLINE_CHANGED'}).catch(()=>{});if(reading&&reading.snapshot().session!==readingSession)void reloadReading().catch(()=>{});
}
function scheduleReadingChange(){if(!readingNotificationsSuspended&&readingNotificationTimer===null)readingNotificationTimer=setTimeout(publishReadingChange,40);}
window.addEventListener('pagehide',()=>{readingNotificationsSuspended=true;clearTimeout(readingNotificationTimer);readingNotificationTimer=null;});
window.addEventListener('pageshow',()=>{readingNotificationsSuspended=false;scheduleReadingChange();});
async function reloadReading(){if(!reading)return;const session=reading.snapshot().session;readingSession=session;try{const config=await readingCall('CONFIG',{session});if(reading.snapshot().session===session)reading.setConfig(config);}catch(error){if(reading.snapshot().session===session)reading.configurationError();throw error;}}
if(window===window.top&&globalThis.WFGReadingPage){reading=WFGReadingPage.create({document,loadAbstract:async(pmid,session)=>(await readingCall('ABSTRACT',{pmid,session})).xml,cancelAbstract:session=>void readingCall('CANCEL_ABSTRACTS',{session}).catch(()=>{}),onChange:scheduleReadingChange});globalThis.BrevessReadingSources={listBlocks:()=>reading.blocks(),get:ref=>reading.block({...ref,session:reading.snapshot().session})};void reloadReading().catch(()=>{});}
page=WFGUXPage.create({document,engine,onDirect:data=>send('DIRECT',data)});
b.runtime.onMessage.addListener((m,s,reply)=>{if(m?.type!=='WFG_FRAME'||s.id!==b.runtime.id||s.tab)return false;Promise.resolve().then(()=>{
if(m.command==='READING_OUTLINE_DEFAULT'){if(!reading)throw Error('READING_UNAVAILABLE');return reading.setOutlineDefault(m.active,m.session);}
if(m.command==='READING_VIEW'){if(!reading)throw Error('READING_UNAVAILABLE');return reading.setOriginalView(m.original,m.session);}
if(m.command==='READING_LOCATE_SOURCE')return reading.locateSource(m.ref,m.quote);if(m.command==='READING_SELECTION')return reading?.selection()||null;if(m.command==='READING_VALIDATE_PLAN')return reading.validatePlan(m.plan,{reusable:m.reusable!==false});if(m.command==='READING_VALIDATE_MODULE')return reading.validateModule(m.module);if(m.command==='GENERALIZATION_STATUS')return {session:engine.session(),plan:engine.previewPlan(),verified:engine.status()?.verified===true};if(m.command==='READING_SNAPSHOT')return reading?.snapshot()||{groups:[]};if(m.command==='READING_SOURCE')return reading.source(m.ref);if(m.command==='READING_LOCATE')return reading.locate(m.ref);if(m.command==='READING_RELOAD'){engine.undo();reading?.setPreview(false);page.clear();return send('PAGE_CHANGED').then(()=>reloadReading()).then(()=>send('AUTO'));}
if(m.command==='NORMALIZE_PLAN'){if(m.session!==engine.session())throw Error('DOCUMENT_CHANGED');return engine.normalizePlan(m.plan);}
if(m.command==='UX_OUTLINE')return engine.outlineProjection();if(m.command==='UX_OUTLINE_LOCATE')return engine.locateOutline(m.ref);
if(m.command==='TOOL')return engine.query(m.tool,m.args);
if(m.command==='UX_PICK')return page.pick();if(m.command==='UX_FINISH_PICK')return page.finishPick();
if(m.command==='UX_TARGETS')return page.setTargets(m.targets||[]);
if(m.command==='UX_CLEAR'){page.clear();return true;}
if(m.command==='OPEN')return true;
if(m.command==='LOCATE')return engine.locate(m.target,m.quote,m.evidenceKind);
if(m.command==='UX_LOCATE'){const nodes=engine.resolve(m.target);if(nodes.length!==1)throw Error('TARGET_CHANGED');nodes[0].scrollIntoView({block:'center'});page.setTargets([{target:m.target}]);return true;}
if(m.command==='UNDO'){const result=engine.undo();reading?.setPreview(false);return result;}
if(m.command==='COMMIT')return engine.commit();
if(m.command==='ANALYSE'){if(m.session!==engine.session())throw Error('DOCUMENT_CHANGED');return engine.analyse(m.plan);}
if(m.command==='APPLY'){if(m.plan?.operations.some(op=>op.type==='outline'&&op.extraction)&&reading?.snapshot().reading.outlineDefault)reading.setOutlineDefault(false,reading.snapshot().session);reading?.setPreview(true);try{return engine.apply(m.plan,m.session,m.mode,m.guard);}catch(e){reading?.setPreview(false);throw e;}}
throw Error('FRAME_COMMAND_INVALID');
}).then(data=>reply({ok:true,data}),e=>reply({ok:false,error:e.message}));return true;});
if(window===window.top)setTimeout(()=>send('AUTO').catch(()=>{}),500);
})();
