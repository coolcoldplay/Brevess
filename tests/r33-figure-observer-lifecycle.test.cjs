'use strict';
// Proposed source-read lease and read-only retired-receipt contracts, executing
// current production functions. Extraction/storage boundaries are controlled;
// the independent native trace establishes the real observer/prepare chain.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {functionSource}=require('./helpers/r28-full07-source.js');
const source=fs.readFileSync(require.resolve('../content.js'),'utf8');
const operationApi=require('../core/operation-control.js');
const leaseApi=require('../core/figure-source-lease.js');
const url='https://qa.test/owned-paper',W='workspace:'+'a'.repeat(64);
const clone=value=>JSON.parse(JSON.stringify(value));
function readFixture({active=true,cancelled=false,navigationChanged=false,changed=true}={}){
 const oldSnapshot={documentId:'paper-a',documentHash:'old-scientific-hash',url,title:'Owned source',paragraphs:[{paragraphId:'p-old',sourceKey:'source-old',text:'The original Figure 1 evidence.',textHash:'old-text-hash',anchor:{paragraphId:'p-old',text:'The original Figure 1 evidence.'}}],nodes:[{sectionId:'s-old',paragraphIds:['p-old']}],localWorkspace:{workspaceId:W,workspaceGeneration:1,contentHash:'old-workspace-content-hash'},figures:{workspaceLifecycle:1,figures:[]}};
 const oldManual={documentId:'paper-a',record:{documentHash:oldSnapshot.documentHash,canonicalUrl:url}};
 const operation={operationId:'figure-owned-op',generation:4,workspaceLifecycle:1,cancelled,
  sourceReadLease:{operationId:'figure-owned-op',epoch:4,structureSequence:0,contentDocumentIdentity:'world-a',navigationIdentity:url,workspaceLifecycle:1,documentId:oldManual.documentId,documentHash:oldSnapshot.documentHash,sourceOwnerIdentity:JSON.stringify([url,'']),workspaceId:W,workspaceGeneration:1,workspaceContentHash:oldSnapshot.localWorkspace.contentHash,snapshot:clone(oldSnapshot),manualDocument:oldManual,
   canonicalSnapshot:{documentHash:oldSnapshot.documentHash,revision:1,url,paragraphs:clone(oldSnapshot.paragraphs),typedRecords:clone(oldSnapshot.paragraphs),structure:{paragraphs:clone(oldSnapshot.paragraphs),nodes:clone(oldSnapshot.nodes)}}}};
 const calls={prepareFresh:0,extract:0,inventory:0,populate:0,invalidations:0};
 const h={URL,Number,Object,Boolean,String,Promise,Error,Map,Set,JSON,SciLLM:{...require('../core/article-workspace.js'),...leaseApi},articleWorkspaceMetadata:()=>({canonicalUrl:url,doi:''}),document:{},figureSourceLeaseAuthorities:new WeakMap(),articleSourceRefreshDeferred:null,
  currentManualDocument:oldManual,currentManualBlocks:[{element:{isConnected:true}}],manualPreparedHref:url,manualPreparedContentSequence:0,manualDocumentEpochState:{lifecycleGeneration:1},manualPreparePromise:null,
  articleStructureChangeSequence:changed?1:0,articleWorkspaceLifecycleGeneration:1,articleStructureWaiting:false,articleExtractionCache:{old:true},figureWorkspaceInventoryEpoch:1,figureWorkspaceInventorySeedPromise:Promise.resolve(),
  figureOperationState:{active:active?operation:null,last:operation},contentDocumentIdentity:'world-a',currentArticleWorkspace:oldSnapshot.localWorkspace,
  contentNavigationIdentity:()=>navigationChanged?'https://qa.test/another-paper':url,effectiveArticlePageUrl:()=>navigationChanged?'https://qa.test/another-paper':url,currentArticleWorkspaceReadUrl:()=>navigationChanged?'https://qa.test/another-paper':url,canonicalArticlePreindexUrl:(value=url)=>value,
  activeNativePdfStructure:()=>null,scheduleManualSelectionInspection(){},waitForArticleStructureReady:async()=>{},
  prepareManualDocumentFresh:async()=>{calls.prepareFresh++;h.currentManualDocument={documentId:'paper-a',record:{documentHash:changed?'new-live-hash':oldSnapshot.documentHash,canonicalUrl:url}};return h.currentManualDocument;},
  getFigureWorkspaceInventory:()=>{calls.inventory++;return[];},extractCurrentArticleStructure:()=>{calls.extract++;return{paragraphs:[{paragraphId:'p-new',sourceKey:'source-new',text:'Unrelated new paragraph.'}],nodes:[],documentHash:'new-live-hash'};},
  ensureCurrentArticleWorkspace:async()=>h.currentArticleWorkspace,refreshSupplementalFigureAssets:async()=>{},hydrateSavedHtmlHighlightCheckpoint:async()=>{},refreshArticleParagraphNotesFromWorkspace:async()=>{},combinedFigureWorkspaceInventory:()=>[],
  populateFigureWorkspaceDraft:()=>{calls.populate++;if(h.currentManualDocument.record.documentHash!==oldSnapshot.documentHash){calls.invalidations++;h.articleWorkspaceLifecycleGeneration++;}},
  currentFigureWorkspaceRefreshBinding:()=>({documentHash:h.currentManualDocument.record.documentHash}),buildArticleWorkspaceSnapshot:()=>({documentHash:h.currentManualDocument.record.documentHash}),ensureFigureWorkspaceInventorySeeded:async()=>{},
  assertCurrentArticleWorkspaceLifecycle:life=>{if(life!==h.articleWorkspaceLifecycleGeneration)throw Object.assign(new Error('CANCELLED'),{code:'CANCELLED'});},articleWorkspaceLifecycleError:()=>Object.assign(new Error('CANCELLED'),{code:'CANCELLED'}),
  sameFigureWorkspaceRefreshBinding:(left,right)=>left.documentHash===right.documentHash,articlePublicPreviewNotice:()=>null};
 h.figureSourceLeaseAuthorities.set(operation,{lease:operation.sourceReadLease,roots:[]});
 vm.createContext(h);vm.runInContext(['captureFigureSourceOwnerIdentity','activeFigureSourceLease','deferChangedFigureSourceRead','hasPendingFigureSourceRefresh','prepareManualDocument','readArticleWorkspaceSnapshot'].map(name=>functionSource(source,name)).join('\n'),h);
 return{h,calls,operation,oldSnapshot,async read(request){let result,error;try{result=await h.readArticleWorkspaceSnapshot(request);}catch(failure){error=failure;}return{result,error};}};
}
for(const forceRefresh of [false,true])test(`automatic workspace read defers before any canonical preparation when active source changed (force=${forceRefresh})`,async()=>{
 const f=readFixture(),before=JSON.stringify(f.oldSnapshot),read=await f.read({forceRefresh});
 assert.equal(f.calls.prepareFresh,0,'A read during an owned lease must not issue a new DOCUMENT_PREPARE.');
 assert.equal(f.calls.invalidations,0);assert.equal(f.h.articleWorkspaceLifecycleGeneration,1);
 assert.equal(read.result,undefined,'A deferred read must not fabricate an old-hash snapshot with candidate paragraphs.');assert.equal(read.error?.code,'ARTICLE_SOURCE_REFRESH_DEFERRED');
 assert.equal(f.h.currentManualDocument.record.documentHash,f.oldSnapshot.documentHash);assert.equal(f.h.currentArticleWorkspace.contentHash,f.oldSnapshot.localWorkspace.contentHash);
 assert.equal(JSON.stringify(f.oldSnapshot),before);
});
for(const forceRefresh of [false,true])test(`unchanged source still supports ordinary active-operation refresh (force=${forceRefresh})`,async()=>{
 const f=readFixture({changed:false}),read=await f.read({forceRefresh});assert.equal(read.error,undefined);assert.equal(read.result.documentHash,f.oldSnapshot.documentHash);assert.equal(f.calls.invalidations,0);
});
test('archive and artifact canonical reads keep admitted paragraphs, nodes and anchors with their original hash',()=>{
 const f=readFixture(),old=f.oldSnapshot;f.h.canonicalArticleSnapshotCache=null;f.h.currentArticleStructure={revision:2,paragraphs:[{paragraphId:'p-new',text:'New unrelated body'}],nodes:[{sectionId:'new'}]};
 f.operation.sourceReadLease.canonicalSnapshot={documentHash:old.documentHash,revision:1,url,paragraphs:clone(old.paragraphs),typedRecords:clone(old.paragraphs),structure:{revision:1,paragraphs:clone(old.paragraphs),nodes:clone(old.nodes)}};
 vm.runInContext(functionSource(source,'getCanonicalArticleSnapshot'),f.h);
 const result=f.h.getCanonicalArticleSnapshot({forceRefresh:true});assert.equal(result.documentHash,old.documentHash);assert.deepEqual(clone(result.paragraphs),old.paragraphs);assert.deepEqual(clone(result.structure.nodes),old.nodes);
});
test('unproven old module source keys cannot focus a new paragraph that inherited an old index while refresh is deferred',async()=>{
 const f=readFixture(),focused=[];f.h.articleSourceRefreshDeferred={operationId:f.operation.operationId,workspaceLifecycle:1,structureSequence:1};f.h.refreshActivePdfSemanticNavigationContext=()=>null;
 f.h.resolveWorkspaceParagraph=()=>({paragraphId:'p-old',sourceKey:'source-old',text:'New unrelated paragraph.',anchor:{text:'New unrelated paragraph.'}});f.h.focusArticleSource=anchor=>{focused.push(anchor);return true;};
 vm.runInContext(functionSource(source,'focusArticleWorkspaceSource'),f.h);
 assert.equal(await f.h.focusArticleWorkspaceSource({kind:'paragraph',paragraphId:'p-old',sourceKey:'source-old',documentHash:f.oldSnapshot.documentHash}),false);assert.deepEqual(focused,[]);
});
test('normal reads after the active operation is gone still prepare and refresh the new source',async()=>{
 const f=readFixture({active:false});await f.read({forceRefresh:true});assert.equal(f.calls.prepareFresh,1);assert.equal(f.calls.invalidations,1);
});
test('an unrelated popup busy flag never creates content authority or suppresses a normal refresh',async()=>{
 const f=readFixture({active:false});f.h.sidebarBusy=true;await f.read({forceRefresh:true});assert.equal(f.calls.prepareFresh,1);
});
function receiptFixture(){
 const task=operationApi.createRuntimeTaskContract({operationId:'figure-owned-op',epoch:4,module:'figures',documentId:'world-a',documentGeneration:0,workspaceLifecycle:1,scopeIds:['figure-1'],inputSignature:'old-input',configSignature:'standard'});
 task.apply(task.capture(),{status:'running',eventSequence:1});task.requestCancel(task.capture());task.confirmCancel(task.capture(),{success:true,cancelled:true,pending:false});
 const operation={operationId:'figure-owned-op',generation:4,workspaceLifecycle:1,runtimeTask:task,cancellationOrigin:'article-source-changed',sourceReadLease:{contentDocumentIdentity:'world-a',navigationIdentity:url}},writes=[];
 const h={figureOperationState:{active:null,last:operation},articleWorkspaceLifecycleGeneration:2,contentDocumentIdentity:'world-a',contentNavigationIdentity:()=>url,SciLLM:leaseApi,
  figureTerminalSourceReceipts:new Map([[operation.operationId,{receiptOnly:true,task:task.snapshot(),contentDocumentIdentity:'world-a',navigationIdentity:url,cancellationOrigin:'article-source-changed'}]]),
  chrome:{runtime:{sendMessage:async message=>{writes.push(message);throw Error('NO_MUTATION_FROM_RECEIPT_READ');}}}};
 vm.createContext(h);vm.runInContext(functionSource(source,'queryContentRuntimeTask'),h);
 const request={module:'figures',operationId:operation.operationId,epoch:4,workspaceLifecycle:1,expectedDocumentIdentity:'world-a',expectedNavigationIdentity:url,receiptOnly:true};
 return{h,operation,request,writes,read:patch=>h.queryContentRuntimeTask({...request,...patch})};
}
test('exact old operation can expose its confirmed terminal receipt only for UI retirement after a source lifecycle transition',async()=>{
 const f=receiptFixture(),result=await f.read();assert.equal(result.success,true,'A terminal receipt must remain readable by its exact same-world operation after lifecycle advance.');
 assert.equal(result.data.task.terminal,true);assert.equal(result.data.receiptOnly,true);assert.equal(result.data.cancellationOrigin,'article-source-changed');assert.equal(f.writes.length,0);
});
test('old lifecycle receipts never become a live task binding or control capability',async()=>{
 const f=receiptFixture();assert.equal((await f.read({receiptOnly:false})).success,false);
 const before=JSON.stringify(f.operation.runtimeTask.snapshot());const result=await f.h.queryContentRuntimeTask(f.request,true);assert.equal(result.success,false);assert.equal(JSON.stringify(f.operation.runtimeTask.snapshot()),before);assert.equal(f.writes.length,0);
});
test('retired receipt reads reject another operation, epoch, content world, physical navigation or unknown cleanup outcome',async()=>{
 for(const patch of [{operationId:'figure-other'},{epoch:5},{workspaceLifecycle:0},{expectedDocumentIdentity:'new-world'},{expectedNavigationIdentity:'https://qa.test/another-paper'}]){const f=receiptFixture();assert.equal((await f.read(patch)).success,false);assert.equal(f.writes.length,0);}
 const f=receiptFixture();f.operation.runtimeTask=operationApi.createRuntimeTaskContract({operationId:'figure-owned-op',epoch:4,module:'figures',documentId:'world-a',documentGeneration:0,workspaceLifecycle:1,scopeIds:['figure-1'],inputSignature:'old-input',configSignature:'standard'});assert.equal((await f.read()).success,false);
});
