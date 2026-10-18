'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {functionSource}=require('./helpers/r28-full07-source.js');
const shared=require('../core/sidebar-interactions.js'),source=fs.readFileSync(require.resolve('../popup.js'),'utf8');
async function run({receipt=null,uuid='owned-op'}={}){
 const statuses=[],context={tabId:7,key:'owned',url:'https://qa.test/paper'},record={documentId:'paper-a',documentHash:'old-hash',documentGeneration:0,figures:{workspaceLifecycle:1,figures:[{figureId:'figure-1'}]}};
 const h={Number,Object,String,Boolean,Error,Promise,Map,Set,JSON,crypto:{randomUUID:()=> uuid},window:new EventTarget(),
 currentWorkspaceSnapshot:record,preparedDocumentState:null,sidebarBatchIntents:new Map(),sidebarRuntimeTasks:shared.createSidebarTaskStore(),sidebarRuntimeDocumentBinding:{context,documentId:'paper-a',documentHash:'old-hash',documentIdentity:'world-a',workspaceLifecycle:1,documentGeneration:0},figureTaskGeneration:1,
 requireUsableLlm:()=>true,capturePanelContext:()=>context,sidebarBatchKey:()=> 'owned|figures',sidebarTaskDocumentId:()=> 'paper-a',queryPanelTargetTab:async()=>({id:7}),isCurrentFigureTask:()=>true,isCurrentPanelContext:()=>true,isSidebarOperationStopping:()=>false,
 renderSidebarBatchActions(){},startFigureProgressPolling(){},stopFigureProgressPolling(){},pollSidebarRuntimeTasks:async()=>{},refreshFigureAnalysisProgress:async()=>({running:false}),hasRunningFigureProgress:()=>false,renderFigureWorkspaceSnapshot(){},refreshArticleWorkspace:async()=>{},persistCurrentArticleArchive:async()=>{},
 showStatus:(message,tone)=>statuses.push({message,tone}),SciLLM:{...require('../core/figure-source-lease.js'),normalizeTabDocumentUrl:value=>value},
 sendTabMessage:async(_tabId,message)=>{
  const task={operationId:message.operationId,documentId:'world-a',documentHash:'old-hash',module:'figures',epoch:4,workspaceLifecycle:1,documentGeneration:0,eventSequence:1,status:'running',terminal:false,totalUnits:1,completedUnits:0,scopeIds:['figure-1'],inputSignature:'old-input',configSignature:'standard'};
  if(receipt)Object.assign(task,receipt.task,{status:'running',terminal:false,eventSequence:1,documentHash:'old-hash'});
  assert.equal(h.acceptSidebarRuntimeTask(task,context,'figures'),true,'Fixture confirms the same actual initial running-task acceptance as native polling.');
  h.currentWorkspaceSnapshot={...record,documentHash:'new-hash',figures:{...record.figures,workspaceLifecycle:2}};h.sidebarRuntimeDocumentBinding=null;
  return{success:false,code:'CANCELLED',error:'source context changed',cancellationOrigin:receipt?.cancellationOrigin||'article-source-changed',runtimeTask:receipt?.task||{...task,status:'stopped',terminal:true,eventSequence:3,cancelRequested:true},runtimeTaskReceipt:receipt||{receiptOnly:true,contentDocumentIdentity:'world-a',navigationIdentity:context.url,cancellationOrigin:'article-source-changed',task:{...task,status:'stopped',terminal:true,eventSequence:3,cancelRequested:true}}};
 }};
 vm.createContext(h);vm.runInContext(['acceptSidebarRuntimeTask','retireSidebarFigureIntent','runSingleFigureAnalysis'].map(name=>functionSource(source,name)).join('\n'),h);await h.runSingleFigureAnalysis('figure-1');assert.equal(h.currentWorkspaceSnapshot.documentHash,'new-hash',JSON.stringify(statuses));return{h,statuses,context};
}
test('automatic source transition is a warning with accurate origin, not a successful user cancellation',async()=>{
 const f=await run();assert.equal(f.statuses.some(item=>item.tone==='success'&&/已取消/.test(item.message)),false);assert.ok(f.statuses.some(item=>item.tone==='warning'&&/正文|文献|来源/.test(item.message)));
});
test('a verified old terminal receipt retires only its own visible running slot without accepting old source results as new',async()=>{
 const f=await run();const visible=f.h.sidebarRuntimeTasks.get('paper-a','figures');assert.equal(visible?.busy===true,false,'The finished old operation must not leave an indefinite running action.');
 assert.equal(f.h.currentWorkspaceSnapshot.documentHash,'new-hash');assert.equal(f.h.currentWorkspaceSnapshot.figures.workspaceLifecycle,2);
 const old={operationId:'figure-owned-op',documentId:'world-a',documentHash:'old-hash',module:'figures',epoch:4,workspaceLifecycle:1,documentGeneration:0,eventSequence:5,status:'completed',terminal:true,totalUnits:1,completedUnits:1};
 assert.equal(f.h.acceptSidebarRuntimeTask(old,f.context,'figures'),false,'UI retirement must never admit an old result or task into the new scientific source.');
});
test('UI source guards keep rejecting an old successful result after the system source transition',async()=>{
 const f=await run();assert.equal(f.h.currentWorkspaceSnapshot.documentHash,'new-hash');
 const old={operationId:'figure-owned-op',documentId:'world-a',documentHash:'old-hash',module:'figures',epoch:4,workspaceLifecycle:1,documentGeneration:0,eventSequence:5,status:'completed',terminal:true,totalUnits:1,completedUnits:1};
 assert.equal(f.h.acceptSidebarRuntimeTask(old,f.context,'figures'),false);
});
test('a fresh terminal-source recovery read retries its own confirmed context transition once before publishing',async()=>{
 const context={tabId:7,key:'owned',tabContextSequence:1},calls=[],next={documentHash:'new-coherent-hash'};
 const h={workspaceRefreshInFlight:null,JSON,capturePanelContext:()=>context,isCurrentPanelContext:()=>true,awaitArticlePreparationOperation:value=>value,
  performArticleWorkspaceRefresh:async options=>{calls.push(options);if(calls.length===1){options.onError({code:'ARTICLE_PAGE_LOADING',reasonCode:'ARTICLE_SOURCE_CONTEXT_CHANGED'});return null;}return next;}};
 vm.createContext(h);vm.runInContext(functionSource(source,'refreshArticleWorkspace'),h);assert.equal(await h.refreshArticleWorkspace({sourceRecovery:true}),next);assert.equal(calls.length,2);assert.equal(calls[1].sourceRecoveryAttempted,true);
});
test('source recovery is bounded and never retries a physical owner change or an unrelated failure',async()=>{
 for(const reason of ['ARTICLE_SOURCE_CONTEXT_CHANGED','OTHER_FAILURE']){let calls=0;const context={tabId:7,key:'owned',tabContextSequence:1},h={workspaceRefreshInFlight:null,JSON,capturePanelContext:()=>context,isCurrentPanelContext:()=>true,awaitArticlePreparationOperation:value=>value,performArticleWorkspaceRefresh:async options=>{calls++;options.onError({code:'ARTICLE_PAGE_LOADING',reasonCode:reason});return null;}};vm.createContext(h);vm.runInContext(functionSource(source,'refreshArticleWorkspace'),h);assert.equal(await h.refreshArticleWorkspace({sourceRecovery:true}),null);assert.equal(calls,reason==='ARTICLE_SOURCE_CONTEXT_CHANGED'?2:1);}
});
test('a deferred reply arriving after a tab owner switch cannot replace the new owner pending state or text',async()=>{
 let release,current=true;const old={tabId:7,key:'old'},next={key:'new',operationId:'new-operation'},status={textContent:'New owner status'};
 const h={workspaceRefreshSequence:0,articleChatHistoryPageSize:1,articleChatVisibleTurnCount:1,currentWorkspaceSnapshot:{documentHash:'old'},articleSourceRefreshPending:next,SciLLM:{},isCurrentPanelContext:()=>current,capturePanelContext:()=>old,sendTabMessage:()=>new Promise(resolve=>{release=resolve;}),document:{getElementById:()=>status}};
 vm.createContext(h);vm.runInContext(functionSource(source,'performArticleWorkspaceRefresh'),h);const pending=h.performArticleWorkspaceRefresh({panelContext:old});current=false;release({success:false,code:'ARTICLE_SOURCE_REFRESH_DEFERRED',deferred:true,operationId:'old-operation',epoch:1,workspaceLifecycle:1});assert.equal(await pending,null);assert.equal(h.articleSourceRefreshPending,next);assert.equal(status.textContent,'New owner status');
});
for(const scenario of ['canonical URL','DOI','user-stop first','source first'])test(`actual owner gate to terminal receipt to popup status preserves ${scenario}`,async()=>{
 const contentSource=fs.readFileSync(require.resolve('../content.js'),'utf8'),fixtureText=fs.readFileSync(require.resolve('./r33-figure-observer-lifecycle-authority.test.cjs'),'utf8'),leaseApi=require('../core/figure-source-lease.js');
 const factory=new Function('require','api','vm','source','functionSource',functionSource(fixtureText,'fixture')+';return fixture;')(require,leaseApi,vm,contentSource,functionSource),f=factory(),op=f.h.beginFigureOperation('single','figure-1');op.runtimeTask=require('../core/operation-control.js').createRuntimeTaskContract({operationId:op.operationId,epoch:op.generation,module:'figures',documentId:'world-a',documentGeneration:0,workspaceLifecycle:1,scopeIds:['figure-1'],inputSignature:'input',configSignature:'standard'});op.runtimeTask.apply(op.runtimeTask.capture(),{status:'running',eventSequence:1});
 Object.assign(f.h,{figureWorkspaceInventory:[],figureAnalysisStatus:{completedFigures:0},cancelPendingFigureProgress(){},updateFigureAnalysisStatus(){},sendLlmOperationControlWithDeadline:async()=>({success:true,data:{}})});vm.runInContext(['controlLlmOperation','isCurrentFigureOperation','finishFigureOperation','releaseFigureSourceLease'].map(n=>functionSource(contentSource,n)).join('\n'),f.h);
 if(scenario==='user-stop first')await f.h.controlLlmOperation('figure','cancel');f.h.articleWorkspaceMetadata=()=>({canonicalUrl:scenario==='DOI'?'https://qa.test/paper':'https://qa.test/other',doi:scenario==='DOI'?'10.1234/other':''});try{f.h.activeFigureSourceLease();}catch(error){op.primaryError=error;}if(scenario==='source first')await f.h.controlLlmOperation('figure','cancel');
 await f.h.finishFigureOperation(op,{sendMessage:async message=>({success:true,data:{operationId:op.operationId,released:true,cleanupComplete:true,requestedCommand:message.command}})});const receipt=f.h.figureTerminalSourceReceipts.get(op.operationId),origin=scenario==='user-stop first'?'user-stop':'article-source-changed';assert.equal(receipt.cancellationOrigin,origin);const result=await run({receipt,uuid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});assert.ok(result.statuses.some(row=>origin==='user-stop'?row.tone==='success'&&/已取消/.test(row.message):row.tone==='warning'&&/正文已更新/.test(row.message)));assert.equal(result.h.sidebarRuntimeTasks.get('paper-a','figures').busy,false);
});
