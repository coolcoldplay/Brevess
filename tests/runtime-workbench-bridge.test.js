const test=require('node:test');
const assert=require('node:assert/strict');
const {createRuntimeWorkbenchBridge,installRuntimeWorkbenchOwnerReceiver}=require('../extension/core/runtime-workbench-bridge.js');
function setup({embedded=false,otherFirst=false,changeContext=false,fragment='',contextFragment=fragment}={}){
 const id='test-extension', origin='chrome-extension://'+id, url=origin+'/workbench/index.html'+fragment;
 const sender={id,url,origin,documentId:'child',documentLifecycle:'active'};
 const child={contextType:'TAB',contextId:'context-child',documentId:'child',tabId:12,frameId:embedded?2:0,documentUrl:origin+'/workbench/index.html'+contextFragment,documentOrigin:origin};
 const owner=embedded?{...child,contextId:'context-owner',documentId:'owner',frameId:0,documentUrl:origin+'/options.html#page=workbench'}:child;
 const background=new Set(),documents=new Set();let challenged=false;
 const event=set=>({addListener:fn=>set.add(fn),removeListener:fn=>set.delete(fn)});
 const chromeApi={runtime:{id,getURL:path=>origin+'/'+path,onMessage:event(background),getContexts:async filter=>{
  const rows=embedded?[child,owner]:[child];return rows.filter(r=>!filter.documentIds||filter.documentIds.includes(r.documentId)).map(r=>({...r,...(changeContext&&challenged?{contextId:'replaced'}:{})}));
 },sendMessage:async message=>{challenged=true;for(const fn of documents)fn(message,{id},()=>{});}},
 tabs:{get:async()=>({id:12}),sendMessage:async()=>{throw Error('Could not establish connection. Receiving end does not exist.');}},webNavigation:{getFrame:async()=>null}};
 const view={location:{href:url},chrome:{runtime:{id,getURL:chromeApi.runtime.getURL,onMessage:event(documents),sendMessage:async message=>{
  if(otherFirst)for(const fn of background)fn(message,{...sender,documentId:'other'},()=>{});
  for(const fn of background)fn(message,sender,()=>{});
 }}}};
 view.top=embedded?{location:{href:owner.documentUrl},document:{getElementById:()=>({contentWindow:view})}}:view;
 view.parent=view.top;
 installRuntimeWorkbenchOwnerReceiver(view);
 return {bridge:createRuntimeWorkbenchBridge({chromeApi}),sender,background,view,child};
}
test('top-level extension document authorizes via runtime messages when tabs.sendMessage has no content script',async()=>{
 const f=setup();await f.bridge.authorize(f.sender);assert.equal(f.background.size,0);
});
test('designated options iframe authorizes and unrelated document proofs are ignored',async()=>{
 const f=setup({embedded:true,otherFirst:true});await f.bridge.authorize(f.sender);assert.equal(f.background.size,0);
});
test('actual library entry URL authorizes in both full-page and embedded workbenches',async()=>{
 const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'../extension/options.html'),'utf8');
 const path=html.match(/data-workbench-src="([^"]+)"/)[1];
 assert.equal(path,'workbench/index.html#library');
 for(const embedded of [false,true]){
  const f=setup({embedded,fragment:new URL(path,'https://fixture/').hash});
  await f.bridge.authorize(f.sender);assert.equal(f.background.size,0);
 }
});
test('same-document library fragment navigation keeps the browser document identity valid',async()=>{
 const f=setup({fragment:'#library',contextFragment:''});
 await f.bridge.authorize(f.sender);assert.equal(f.background.size,0);
});
test('unrecognized workbench fragments remain rejected',async()=>{
 const f=setup({fragment:'#unexpected'});
 await assert.rejects(f.bridge.authorize(f.sender),{code:'WORKBENCH_SENDER_INVALID'});
});
test('non-designated iframe is rejected',async()=>{
 const f=setup({embedded:true});f.view.parent.document.getElementById=()=>null;
 await assert.rejects(f.bridge.authorize(f.sender),{code:'WORKBENCH_SENDER_INVALID'});assert.equal(f.background.size,0);
});
test('changed live context is rejected after challenge',async()=>{
 const f=setup({changeContext:true});await assert.rejects(f.bridge.authorize(f.sender),{code:'WORKBENCH_SENDER_INVALID'});assert.equal(f.background.size,0);
});
test('foreign sender, stale lifecycle and contradictory origin are rejected',async()=>{
 for(const patch of [{id:'foreign'},{origin:'https://example.org'},{documentLifecycle:'cached'},{url:'chrome-extension://test-extension/options.html'}]){
 const f=setup();await assert.rejects(f.bridge.authorize({...f.sender,...patch}),{code:'WORKBENCH_SENDER_INVALID'});
 }
});
