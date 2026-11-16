const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const S=require('../web-filters-general/schema.js'),M=require('../web-filters-general/reading-modules.js'),G=require('../web-filters-general/generalization.js');
function harness(){
 const tabs=new Map([1,2,3].map(id=>[id,{id,windowId:id===3?8:7,title:'Paper '+id,url:'https://papers.example/articles/'+id}]));let active=1,documentVersion=1;const events={},rpcCalls=[];
 const event=name=>({addListener:f=>events[name]=f});
 const browser={runtime:{id:'extension',getContexts:async()=>[{documentUrl:'chrome-extension://extension/popup.html',windowId:7}],onMessage:event('message'),sendMessage:async()=>{}},storage:{local:{get:async()=>({}),set:async()=>{}},session:{get:async()=>({}),set:async()=>{}}},webNavigation:{getAllFrames:async({tabId})=>[{frameId:0,documentId:'doc-'+tabId+'-'+documentVersion}]},tabs:{get:async id=>{if(!tabs.has(id))throw Error('Closed');return tabs.get(id);},query:async()=>[tabs.get(active)],update:async id=>{active=id;await events.activated({tabId:id,windowId:7});},onRemoved:event('removed'),onActivated:event('activated'),onUpdated:event('updated')}};
 const context={WFGSchema:S,WFGReadingModules:M,WFGGeneralization:G,crypto,URL,console};vm.runInNewContext(fs.readFileSync(require.resolve('../web-filters-general/ux-background.js'),'utf8'),context);
 const broker={allUndo:async id=>{rpcCalls.push({id,command:'UNDO_ALL'});},overview:async id=>({frames:[{frameId:0,ok:true,data:{session:'s-'+id,version:0}}]}),rpc:async(id,frame,command,data)=>{rpcCalls.push({id,command,data});return {};}};
 const c=context.WFGUX.install({browser,broker,multi:{cancel(){}}}),sender={id:'extension',url:'chrome-extension://extension/popup.html'};
 const call=(command,data={})=>c.handle({command,...data},sender);
 return {c,call,tabs,events,rpcCalls,reload:()=>documentVersion++};
}
test('cross-tab editing preserves targets, preview and conversation; returning restores overlays',async()=>{
 const h=harness();await h.call('STATE');const st=h.c.states.get(1);Object.assign(st,{adjusting:true,targets:[{id:'p1',frameId:0}],plan:{name:'draft'},preview:true,displayConversation:[{question:'22px'}]});
 const result=await h.call('SWITCH_TAB',{tabId:2});assert.equal(result.switchedTabId,2);assert.equal(st.adjusting,true);assert.equal(st.targets.length,1);assert.equal(st.preview,true);assert.equal(st.displayConversation[0].question,'22px');assert.ok(h.rpcCalls.some(c=>c.id===1&&c.command==='UX_CLEAR'));
 await h.call('SWITCH_TAB',{tabId:1});await h.call('STATE');assert.ok(h.rpcCalls.some(c=>c.id===1&&c.command==='UX_TARGETS'&&c.data.targets.length===1));
});
test('switch request cannot activate a different window, restricted page, or stale source',async()=>{
 const h=harness();await h.call('STATE');await assert.rejects(h.call('SWITCH_TAB',{tabId:3}),/SOURCE_NOT_IN_WINDOW/);
 h.tabs.get(2).url='chrome://settings';await assert.rejects(h.call('SWITCH_TAB',{tabId:2}),/SOURCE_NOT_IN_WINDOW/);
 await assert.rejects(h.call('SWITCH_TAB',{tabId:1,expectedContext:{tabId:999,navigationUrl:'wrong',documentKey:'wrong'}}),/PAGE_CHANGED/);
});
test('document reload invalidates selection and preview, even when URL is identical',async()=>{
 const h=harness();await h.call('STATE');h.c.states.get(1).targets=[{id:'old'}];h.reload();const next=await h.call('STATE');assert.equal(next.targets.length,0);assert.equal(next.preview,false);
});
test('switch during model work is refused; manual tab change cancels pending work only',async()=>{
 const h=harness();await h.call('STATE');const st=h.c.states.get(1);st.adjusting=true;st.busy=true;st.targets=[{id:'p'}];st.turns=[{status:'pending'}];await assert.rejects(h.call('SWITCH_TAB',{tabId:2}),/QUESTION_RUNNING/);await h.events.activated({tabId:2,windowId:7});assert.equal(st.busy,false);assert.equal(st.turns[0].status,'cancelled');assert.equal(st.targets.length,1);
});
test('display editing uses local page evidence while preserving the QA network preference',()=>{
 const C=require('../web-filters-general/ux-context.js');
 for(const mode of ['on','auto']) {
  const webSearch={mode};const display=C.route({adjusting:true,webSearch,question:'隐藏所选悬浮栏'});
  assert.equal(display.kind,'display');assert.equal(display.webSearch.mode,'off');assert.equal(webSearch.mode,mode);
  assert.equal(C.route({webSearch,question:'查询作者前期工作'}).webSearch.mode,mode);
  assert.throws(()=>C.route({adjusting:true,webSearch,contextScope:{sectionIds:['methods']}}),/ORIGINAL_CONTEXT_COMBINATION/);
 }
});

test('return to Q&A cancels unsaved effects and clears editing state',async()=>{
 const h=harness();await h.call('STATE');const st=h.c.states.get(1);
 Object.assign(st,{adjusting:true,plan:{name:'draft'},preview:true,saved:false,targets:[{id:'x'}],referenceIds:[2],sourceIds:[1,2],displayConversation:[{question:'hide'}],planTargets:[{}],lastDisplayRequest:'hide',notice:'preview'});
 const result=await h.call('MODE',{active:false});
 assert.equal(result.adjusting,false);assert.equal(st.plan,null);assert.equal(st.preview,false);
 for(const field of ['targets','referenceIds','displayConversation','planTargets'])assert.equal(st[field].length,0);
 assert.deepEqual(Array.from(st.sourceIds),[1]);assert.equal(st.lastDisplayRequest,'');assert.equal(st.notice,'');
 assert.ok(h.rpcCalls.some(x=>x.command==='UX_CLEAR'));assert.ok(h.rpcCalls.some(x=>x.command==='UNDO_ALL'));
});
test('return to Q&A keeps saved filters applied and preserves target proofs for later edits',async()=>{
 const h=harness();await h.call('STATE');const st=h.c.states.get(1);
 Object.assign(st,{adjusting:true,saved:true,plan:{name:'saved'},preview:true,planTargets:[{target:'proof'}]});
 await h.call('MODE',{active:false});assert.equal(st.adjusting,false);assert.equal(st.plan.name,'saved');assert.equal(st.planTargets.length,1);
 assert.ok(!h.rpcCalls.some(x=>x.command==='UNDO_ALL'));
});


test('return to ordinary Q&A also clears the other tabs in the same filter task',async()=>{
 const h=harness();await h.call('STATE');const first=h.c.states.get(1);Object.assign(first,{adjusting:true,plan:{name:'preview A'},preview:true,targets:[{id:'a'}]});
 await h.call('SWITCH_TAB',{tabId:2});const second=h.c.states.get(2);Object.assign(second,{plan:{name:'preview B'},preview:true,targets:[{id:'b'}]});
 await h.call('MODE',{active:false});for(const st of [first,second]){assert.equal(st.adjusting,false);assert.equal(st.plan,null);assert.equal(st.targets.length,0);}
 assert.equal(h.rpcCalls.filter(x=>x.command==='UNDO_ALL').length,2);
});
