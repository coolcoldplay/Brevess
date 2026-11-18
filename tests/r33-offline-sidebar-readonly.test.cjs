'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../extension/popup.js'),'utf8');
const url='chrome-extension://'+'a'.repeat(32)+'/offline-reader.html?workspaceId=workspace%3A'+'a'.repeat(64)+'&generation=2';
function fn(name){const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start);assert.ok(start>=0&&end>start);return source.slice(source.slice(start-6,start)==='async '?start-6:start,end+2);}
test('saved sidebar removes the old read-only notice and leaves editing controls untouched',()=>{
 let removed=false;const status={dataset:{},textContent:''};
 const context={currentWorkspaceSnapshot:{},activePanelTabContext:{offlineMode:true},document:{getElementById:id=>id==='offlineArticleReadOnlyNotice'?{remove(){removed=true;}}:status}};
 vm.createContext(context);vm.runInContext(fn('renderOfflineArticleReadOnlyState'),context);context.renderOfflineArticleReadOnlyState();
 assert.equal(removed,true);assert.equal(status.textContent,'本机原文 · 可继续研读');
});
test('saved tab transport uses the resident normal runtime for reads and writes without recovery injection',async()=>{
 const calls=[];let recovery=0;
 const context={Number,Object,Error,activePanelTabContext:{activated:true,tabId:7,offlineMode:true},
 chrome:{tabs:{sendMessage:async(id,message)=>{calls.push([id,message.action]);return{success:true};}}},SciLLM:{sendTabMessageWithRecovery:()=>{recovery++;}}};
 vm.createContext(context);vm.runInContext(fn('sendTabMessage'),context);
 for(const action of ['getArticleWorkspaceSnapshot','prepareManualAnnotations','askArticleWithLLM','analyzeFiguresWithLLM','updateFigureWorkspaceDraft'])
  assert.equal((await context.sendTabMessage(7,{action})).success,true);
 assert.equal(calls.length,5);assert.equal(recovery,0);
 await assert.rejects(context.sendTabMessage(8,{action:'askArticleWithLLM'}),{code:'PANEL_TAB_NOT_ACTIVATED'});
 context.chrome.tabs.sendMessage=async()=>{throw Error('receiver gone');};
 await assert.rejects(context.sendTabMessage(7,{action:'askArticleWithLLM'}),/receiver gone/);assert.equal(recovery,0);
});
function eventFixture(change={}){
 const workspaceId='workspace:'+'a'.repeat(64),events=[],calls=[];
 const context={URL,Number,String,JSON,articleChatEventDocumentCheck:null,
  activePanelTabContext:{tabId:7,url,tabContextSequence:2,activated:true,offlineMode:true},
  currentWorkspaceSnapshot:{documentId:'saved-doc',documentHash:'hash',localWorkspace:{workspaceId,workspaceGeneration:2}},
  WFGChatTimeline:{acceptNativeContext:()=>true},applyArticleChatStateEvent:event=>events.push(event),
  chrome:{tabs:{sendMessage:async(id,message,options)=>{calls.push({id,message,options});return{success:true,navigationIdentity:url,binding:{workspaceId,workspaceGeneration:2,documentHash:'hash',...change}};}},webNavigation:{getAllFrames(){throw Error('extension pages have no webNavigation frame');}}}};
 vm.createContext(context);vm.runInContext(fn('admitArticleChatStateEvent'),context);
 return{context,events,calls,sender:{tab:{id:7},url,frameId:0,documentId:'browser-doc'}};
}
test('saved chat streams only from its exact live browser document and original workspace',async()=>{
 const f=eventFixture();assert.equal(await f.context.admitArticleChatStateEvent({kind:'turn_updated'},f.sender),true);
 assert.equal(f.events.length,1);assert.equal(f.calls[0].options.documentId,'browser-doc');assert.equal(f.calls[0].options.frameId,0);
 for(const change of [{workspaceId:'different'},{workspaceGeneration:3},{documentHash:'different'}]){
  const invalid=eventFixture(change);assert.equal(await invalid.context.admitArticleChatStateEvent({},invalid.sender),false);assert.equal(invalid.events.length,0);
 }
 const stale=eventFixture();stale.sender.url='https://elsewhere.test/';assert.equal(await stale.context.admitArticleChatStateEvent({},stale.sender),false);assert.equal(stale.calls.length,0);
});
