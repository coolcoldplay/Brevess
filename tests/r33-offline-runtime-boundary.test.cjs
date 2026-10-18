'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../core/offline-article-workspace.js'),publicApi=require('../core/background-router.js');
const source=fs.readFileSync(require.resolve('../background.js'),'utf8'),id='a'.repeat(32),W='workspace:'+'a'.repeat(64),base=`chrome-extension://${id}/`,reader=base+'offline-reader.html?workspaceId='+encodeURIComponent(W)+'&generation=2';
function fn(name){const start=source.indexOf('function '+name+'('),asyncStart=source.lastIndexOf('async ',start);const end=source.indexOf('\n}',start);assert.ok(start>=0&&end>start);return source.slice(asyncStart===start-6?asyncStart:start,end+2);}
function fixture({changedTab=false,readGeneration=2,currentTabUrl=null,tabUnavailable=false}={}){
 let tabReads=0,assetReads=0,mutations=0,routerCalls=0;
 const workspace={workspaceId:W,workspaceGeneration:readGeneration,title:'saved',canonicalUrl:'https://paper.test/a'},tab={id:7,windowId:3,url:reader};
 const assets=[{workspaceId:W,workspaceGeneration:2,relativePath:'article/offline-snapshot.html',content:'<html>legacy source</html>',revision:1,contentHash:'saved'},{workspaceId:W,workspaceGeneration:2,relativePath:'article/structure.json',content:{documentId:'saved-doc',documentHash:'hash'}}];
 const store={getWorkspace:async()=>structuredClone(workspace),readPublicAssetCandidates:async()=>{assetReads++;return structuredClone(assets);},pageTurns:async()=>({items:[],hasMore:false})};
 const box={URL,Promise,Number,String,Error,Object,Set,Date,Math,setTimeout,clearTimeout,
 SciLLM:{...api,...publicApi},articleWorkspaceStore:store,
 chrome:{runtime:{id,getURL:path=>base+path},tabs:{get:async()=>{tabReads++;return tabUnavailable?null:currentTabUrl?{...tab,url:currentTabUrl}:changedTab&&tabReads>1?{...tab,url:'https://other.test/'}:tab;},query:async()=>tabUnavailable?[]:[currentTabUrl?{...tab,url:currentTabUrl}:tab]}},
 createFigureTerminationTransport:()=>({}),BrevessRadar:{createRadarOwnerGuard:()=>()=>{}},
 aggregateNotificationTokenUsage:()=>null,resolveTokenUsageFeature:()=>null,publishCodexReverseEvent:async()=>{},
 llmRouter:{async handle(){routerCalls++;return{success:true,data:{syntheticBoundary:true}};}},beginToolbarSidePanelOpen(){mutations++;throw Error('NO_PANEL_OPEN_EXPECTED');}};
 vm.createContext(box);const start=source.indexOf("  if (message?.type === 'OFFLINE_ARTICLE_GET_SNAPSHOT'");const end=source.indexOf('  if (independentPageTools.handles(',start);
 vm.runInContext(fn('normalizedWarmUrl')+'\n'+fn('readOfflineArticleForTab')+'\nfunction handler(message,sender,sendResponse){'+source.slice(start,end)+'}\n'+fn('handleRoutedMessage'),box);
 return{box,tab,sender:{id,url:reader,frameId:0,tab},stats:()=>({tabReads,assetReads,mutations,routerCalls}),handle:(message,sender)=>new Promise(resolve=>box.handler(message,sender,resolve))};
}
test('actual runtime saved-reader handler accepts only the exact owned top-level reader or popup binding',async()=>{
 const f=fixture(),result=await f.handle({type:'OFFLINE_ARTICLE_GET_SNAPSHOT',readerUrl:reader},f.sender);
 assert.equal(result.success,true);assert.equal(result.data.binding.workspaceId,W);assert.equal(f.stats().routerCalls,0);assert.equal(f.stats().mutations,0);
 const panel=await f.handle({type:'OFFLINE_ARTICLE_GET_SNAPSHOT',tabId:7,readerUrl:reader},{id,url:base+'popup.html'});assert.equal(panel.success,true);
});
test('foreign senders, nested readers and arbitrary extension pages cannot borrow an offline workspace',async()=>{
 for(const sender of [{id:'foreign',url:reader,frameId:0,tab:{id:7}},{id,url:reader,frameId:1,tab:{id:7}},{id,url:base+'options.html',frameId:0,tab:{id:7}},{id,url:reader,frameId:0}]){
  const f=fixture(),result=await f.handle({type:'OFFLINE_ARTICLE_GET_SNAPSHOT',tabId:7,readerUrl:reader},sender);assert.equal(result.success,false);assert.equal(result.error.code,'OFFLINE_READER_SENDER_FORBIDDEN');assert.equal(f.stats().assetReads,0);
 }
});
test('exact reader URL, workspace generation and tab navigation are rechecked before exposing saved records',async()=>{
 for(const options of [{changedTab:true},{readGeneration:3}]){
  const f=fixture(options),result=await f.handle({type:'OFFLINE_ARTICLE_GET_SNAPSHOT'},f.sender);assert.equal(result.success,false);assert.match(result.error.code,/^OFFLINE_/);
 }
 const f=fixture(),result=await f.handle({type:'OFFLINE_ARTICLE_GET_SNAPSHOT',tabId:7,readerUrl:reader.replace('generation=2','generation=3')},{id,url:base+'popup.html'});
 assert.equal(result.success,false);assert.equal(result.error.code,'OFFLINE_READER_CHANGED');assert.equal(f.stats().assetReads,0);
});
test('actual central router rejects offline model and store mutations before provider or writer execution',async()=>{
 for(const type of ['LLM_ANALYZE_FIGURES','LLM_SEMANTIC_FIND','LLM_CONTROL_OPERATION','ARTICLE_WORKSPACE_SAVE_ASSET','LITERATURE_NOTE_COMMIT']){
  const f=fixture(),result=await f.box.handleRoutedMessage({type},f.sender,()=>{});assert.equal(result.success,false);assert.equal(result.error.code,'OFFLINE_ARTICLE_READ_ONLY');assert.equal(f.stats().routerCalls,0);assert.equal(f.stats().mutations,0);
 }
 const f=fixture(),result=await f.box.handleRoutedMessage({type:'LLM_ANALYZE_FIGURES'},{id,url:base+'popup.html'},()=>{});assert.equal(result.error.code,'OFFLINE_ARTICLE_READ_ONLY');assert.equal(f.stats().routerCalls,0);
});

for(const options of [{currentTabUrl:'https://other.test/new-paper'},{tabUnavailable:true}])test(`a message sent by the owned reader stays readonly after its tab ${options.tabUnavailable?'closes':'navigates'}`,async()=>{
 const f=fixture(options),result=await f.box.handleRoutedMessage({type:'LLM_SEMANTIC_FIND'},f.sender,()=>{});
 assert.equal(result.success,false);assert.equal(result.error.code,'OFFLINE_ARTICLE_READ_ONLY');
 assert.equal(f.stats().routerCalls,0);assert.equal(f.stats().mutations,0);
});
