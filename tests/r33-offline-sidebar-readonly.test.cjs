'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../popup.js'),'utf8');
const url='chrome-extension://'+'a'.repeat(32)+'/offline-reader.html?workspaceId=workspace%3A'+'a'.repeat(64)+'&generation=2';
function fn(name){const start=source.indexOf('async function '+name+'(');const next=source.slice(start+1).search(/\r?\n(?:(?:async )?function |document\.addEventListener)/);assert.ok(start>=0&&next>=0);return source.slice(start,start+1+next);}
function plainFn(name){const start=source.indexOf('function '+name+'(');const next=source.slice(start+1).search(/\r?\n(?:(?:async )?function |document\.addEventListener)/);assert.ok(start>=0&&next>=0);return source.slice(start,start+1+next);}
test('offline note display is selectable, explicitly read-only and leaves no autosave promise',()=>{
 const controls=[{tagName:'TEXTAREA',dataset:{},disabled:false,readOnly:false,title:''},{tagName:'BUTTON',dataset:{},disabled:false,title:''}];
 const nodes=new Map([['offlineArticleReadOnlyNotice',{style:{},setAttribute(){}}],['literatureNoteStatus',{textContent:'自动保存到本机'}]]);
 const context={Object,currentWorkspaceSnapshot:{},activePanelTabContext:{offlineMode:true},manualAnnotationState:{},renderManualAnnotationSummary(){},
  literatureNoteEditors:new Map(),document:{getElementById:id=>nodes.get(id),querySelectorAll:()=>controls}};
 vm.createContext(context);vm.runInContext(plainFn('renderOfflineArticleReadOnlyState'),context);context.renderOfflineArticleReadOnlyState();
 assert.equal(controls[0].readOnly,true);assert.equal(controls[0].disabled,false);assert.equal(controls[1].disabled,true);
 assert.equal(nodes.get('literatureNoteStatus').textContent,'离线记录 · 只读');
 context.activePanelTabContext.offlineMode=false;context.renderOfflineArticleReadOnlyState();
 assert.equal(controls[0].readOnly,false);assert.equal(controls[1].disabled,false);
});
test('offline sidebar workspace refresh reads the exact saved binding without content injection, extraction or live resume',async()=>{
 const calls=[],snapshot={title:'saved fixture',readOnly:true,localWorkspace:{workspaceId:'workspace:'+'a'.repeat(64),workspaceGeneration:2}};
 const context={workspaceRefreshSequence:0,AbortController,Number,Boolean,Object,Error,
  capturePanelContext:()=>({tabId:7,key:'owned',url,offlineMode:true}),isCurrentPanelContext:()=>true,
  chrome:{runtime:{sendMessage:async message=>{calls.push(message);return{success:true,data:{snapshot}};}}},
  SciLLM:{ensureCompatibleContentRevision:()=>{throw Error('must not inject');},refreshFigureExtractorInTab:()=>{throw Error('must not extract');}},
  renderArticleWorkspaceSnapshot:value=>value};
 vm.createContext(context);vm.runInContext(fn('performArticleWorkspaceRefresh'),context);
 const result=await context.performArticleWorkspaceRefresh();assert.deepEqual(result,snapshot);assert.equal(calls.length,1);
 assert.equal(calls[0].type,'OFFLINE_ARTICLE_GET_SNAPSHOT');assert.equal(calls[0].readerUrl,url);
});
test('offline article initialization stops after saved read and does not execute auto-restore, baseline save or model preparation',async()=>{
 const events=[],snapshot={title:'saved'};
 const context={articleInitializationState:null,articlePreparationSequence:0,AbortController,Promise,Boolean,
  capturePanelContext:()=>({tabId:7,key:'owned',url,offlineMode:true}),isCurrentPanelContext:()=>true,
  refreshArticleWorkspace:async()=>{events.push('read');return snapshot;},renderOfflineArticleReadOnlyState:()=>events.push('readonly'),
  tryAutoRestoreCurrentArticleWorkspace:()=>{throw Error('must not restore into a source page');},sendTabMessage:()=>{throw Error('must not save baseline');},
  prepareArticleForAdaptiveAnalysis:()=>{throw Error('must not prepare a model');}};
 vm.createContext(context);vm.runInContext(fn('initializeCurrentArticle'),context);assert.deepEqual(await context.initializeCurrentArticle(),snapshot);
 assert.deepEqual(events,['read','readonly']);assert.equal(context.articleInitializationState.ready,true);
});
test('central offline tab transport exposes saved reads and rejects all mutation commands without recovery injection',async()=>{
 let recovery=0;const snapshot={documentId:'saved-doc',documentHash:'hash',url:'https://paper.test/a',manual:{annotations:[{id:'human'}]},figures:{figures:[]}};
 const context={Number,Object,Error,activePanelTabContext:{activated:true,tabId:7,offlineMode:true},
  capturePanelContext:()=>({url,key:'owned'}),isCurrentPanelContext:()=>true,
  chrome:{runtime:{sendMessage:async()=>({success:true,data:{snapshot}})}},SciLLM:{sendTabMessageWithRecovery:()=>{recovery++;}}};
 vm.createContext(context);vm.runInContext(fn('sendTabMessage'),context);
 assert.deepEqual((await context.sendTabMessage(7,{action:'getArticleWorkspaceSnapshot'})).snapshot,snapshot);
 assert.equal((await context.sendTabMessage(7,{action:'prepareManualAnnotations'})).annotationCount,1);
 await assert.rejects(context.sendTabMessage(7,{action:'analyzeFiguresWithLLM'}),{code:'OFFLINE_ARTICLE_READ_ONLY'});
 await assert.rejects(context.sendTabMessage(7,{action:'updateFigureWorkspaceDraft'}),{code:'OFFLINE_ARTICLE_READ_ONLY'});
 assert.equal(recovery,0);
});
