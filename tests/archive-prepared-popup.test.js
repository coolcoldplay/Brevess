const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../popup.js'),'utf8');
function extract(name,next){const a=source.indexOf('function '+name+'(');const b=source.indexOf('\n'+next,a);assert.ok(a>=0&&b>a,name);return source.slice(a,b);}
function drafts({inline=null,notes=0,selection=null,dialog=false}={}){
 return Function('figureWorkspaceInlineEditController','literatureNoteDirtyRevisions','literatureNoteTemplateSelection','document',
  extract('hasArticleWorkspaceRestorePanelDrafts','function assertArticleWorkspaceRestorePanelReady')+';return hasArticleWorkspaceRestorePanelDrafts;')(
  {getState:()=>({active:inline})},new Map(Array.from({length:notes},(_,i)=>[i,1])),selection,{getElementById:()=>({open:dialog})});
}
test('restore recognizes pending note and Figure editor drafts without mutating them',()=>{
 assert.equal(drafts()(),false);
 for(const state of [{notes:1},{selection:{}},{inline:{dirty:true}},{inline:{pending:true}},{dialog:true}])assert.equal(drafts(state)(),true);
});
test('prepared persistence result does not send a second background COMMIT',async()=>{
 const a=source.indexOf('async function commitAuthorizedArticleWorkspaceScan('),b=source.indexOf('\nfunction buildArticleArchiveRestoreTarget',a);
 assert.ok(a>=0&&b>a);const calls=[];
 const commit=Function('sendLlmMessage',source.slice(a,b)+';return commitAuthorizedArticleWorkspaceScan;')(async message=>{calls.push(message);return {success:true};});
 const result=await commit({}, {}, {}, '', {persistenceCommitted:true,syncStatus:'queued'});
 assert.equal(result.success,true);assert.equal(calls.length,0);
});
test('draft entered during IPC retains panel instead of applying returned sidebar state',()=>{
 const keep=Function('hasArticleWorkspaceRestorePanelDrafts',extract('preserveArticleWorkspaceRestorePanelDrafts','async function commitAuthorizedArticleWorkspaceScan')+';return preserveArticleWorkspaceRestorePanelDrafts;')(()=>true);
 const result=keep({success:true,committed:true,persistenceCommitted:true,workspaceApplied:true,uiState:{activeWorkspaceView:'figures'}});
 assert.equal(result.success,false);assert.equal(result.preservePanelDrafts,true);assert.equal(result.postCommitStatus,'panel-draft-retained');
});
test('partial database commit presentation does not refresh or reapply the preserved page/panel',async()=>{
 const a=source.indexOf('async function presentCommittedArticleRestoreResult('),b=source.indexOf('\nasync function reinitializeCommittedArticleRestore',a);assert.ok(a>=0&&b>a);
 const writes=[];
 const present=Function('describeCommittedArticleRestore','isCurrentPanelContext','applyRestoredSidePanelUiState','refreshManualAnnotationSummary','refreshArticleWorkspace','setArticleArchivePrompt','showStatus','t',source.slice(a,b)+';return presentCommittedArticleRestoreResult;')(
  ()=>({message:'retained',type:'error'}),()=>true,()=>writes.push('ui'),async()=>writes.push('manual'),async()=>writes.push('refresh'),()=>{},()=>{},x=>x);
 await present({committed:true,persistenceCommitted:true,workspaceApplied:false},{tabId:9,uiState:{activeWorkspaceView:'figures'}});
 assert.deepEqual(writes,[]);
 await present({committed:true,workspaceApplied:true,preservePanelDrafts:true},{tabId:9,uiState:{activeWorkspaceView:'figures'}});
 assert.deepEqual(writes,[]);
});

test('unconfirmed commits and deferred work are described without claiming complete restoration',()=>{
 const errorText=Function(extract('describeArticleWorkspaceRestoreError','function runArticleWorkspaceRestoreAction')+';return describeArticleWorkspaceRestoreError;')();
 for(const code of ['ARTICLE_WORKSPACE_RESTORE_COMMIT_UNKNOWN','ARTICLE_WORKSPACE_RESTORE_COMMIT_UNCONFIRMED'])
  assert.match(errorText({code}),/尚未确认.*不要直接重复恢复/u);
 const describe=Function(extract('describePreparedArticleWorkspaceRestoreStatus','async function commitAuthorizedArticleWorkspaceScan')+';return describePreparedArticleWorkspaceRestoreStatus;')();
 assert.equal(describe({syncStatus:'queued'}),null);
 const pending=describe({syncStatus:'pending',manualRebuildDeferred:true});
 assert.equal(pending.type,'warning');assert.match(pending.message,/文件夹同步尚未完成.*人工标注显示重建尚未完成/u);
});
