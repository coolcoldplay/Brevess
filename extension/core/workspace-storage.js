(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.BrevessWorkspaceStorage=api;})(globalThis,function(){
 'use strict';const fail=code=>{throw Object.assign(new Error(code),{code});};
 function selectedPaths(assets,{page,user}){return assets.map(a=>a.relativePath).filter(p=>page&&(['article/offline-snapshot.html','article/paragraphs.json'].includes(p)||/^figures\/(images|originals)\//.test(p))||user&&(/^(annotations|analysis|chat|notes|literature-notes|mechanism|logic-maps|translations|legacy)\//.test(p)&&p!=='annotations/library-save-events.json'||/^figures\//.test(p)&&!/^figures\/(images|originals)\//.test(p)||/^internal\/figure-/.test(p)));}
 async function deletePaper({browser,store,directory,documentStore,api,coordinate},m,tab){
  const choice={page:m.deletePage===true,user:m.deleteUserData===true};if(!choice.page&&!choice.user)fail('WORKSPACE_DELETE_SELECTION_REQUIRED');if(tab.id!==m.tabId)fail('WEB_CONTEXT_CHANGED');
  const live=await browser.tabs.sendMessage(tab.id,{action:'ensureArticleWorkspace'});if(!live?.success||live.workspace?.workspaceId!==m.workspaceId||live.workspace.workspaceGeneration!==m.workspaceGeneration)fail('WORKSPACE_DELETION_CONFLICT');
  const id=m.workspaceId,owner=await store.getWorkspace(id);if(!owner||owner.deletionPending||owner.workspaceGeneration!==m.workspaceGeneration)fail('WORKSPACE_DELETION_CONFLICT');
  if(api.normalizeWorkspaceCanonicalUrl(owner.canonicalUrl)!==api.normalizeWorkspaceCanonicalUrl(tab.url))fail('WEB_CONTEXT_CHANGED');
  if((await directory.status()).permission!=='granted')fail('DIRECTORY_PERMISSION_REQUIRED');
  const prepared=await coordinate('prepareExternalArticleWorkspaceDeletion',id,owner.workspaceGeneration);if(prepared.failed||!prepared.matched){await coordinate('resumeExternalArticleWorkspaceDeletion',id,owner.workspaceGeneration);fail('WORKSPACE_OPEN_TAB_BUSY');}
  let committed=false;
  try{
   const baseline=await store.getWorkspace(id),assets=await store.listAssets(id),structure=assets.find(a=>a.relativePath==='article/structure.json')?.content;
   const manifest=(await directory.listWorkspaceManifests({workspaceId:id})).manifests.find(w=>w.workspaceId===id);if(manifest&&manifest.workspaceGeneration!==baseline.workspaceGeneration)fail('WORKSPACE_GENERATION_CONFLICT');
   const paths=[...new Set([...selectedPaths(assets,choice),...selectedPaths((manifest?.assets||[]).map(a=>({relativePath:a.path})),choice)])];
   const documentId=structure?.documentId||'',document=documentId?await documentStore.getDocument(documentId):null;
   if(document&&api.normalizeWorkspaceCanonicalUrl(document.canonicalUrl)!==api.normalizeWorkspaceCanonicalUrl(owner.canonicalUrl))fail('WORKSPACE_DOCUMENT_IDENTITY_CONFLICT');
   const turns=[];let cursor=0,batch;do{batch=await store.pageTurns(id,{afterSequence:cursor,limit:1000});turns.push(...batch.items);cursor=batch.nextSequence;}while(batch.hasMore&&batch.items.length);
   const options={paths,deleteUserData:choice.user,workspaceGeneration:baseline.workspaceGeneration,expectedStorageRevision:Number(baseline.storageRevision||0),documentId,documentRevision:Number(document?.revision||0),turnRevisions:turns.map(t=>[t.turnId,t.revision]).sort()};
   const snapshot=assets.find(a=>a.relativePath==='article/offline-snapshot.html');
   if(choice.page&&structure){
    const source=assets.find(a=>a.relativePath==='article/structure.json'),content=BrevessPageStoragePolicy.sourceMetadata(source.content),contentHash=await rootDigest(JSON.stringify(content));
    options.sourceReplacement={content,contentHash,expectedRevision:source.revision};
    const disk=await directory.readWorkspaceAsset(baseline,source.relativePath);
    await directory.enqueueWorkspaceAsset(baseline,source.relativePath,content,{revision:source.revision+1,contentHash,workspaceGeneration:baseline.workspaceGeneration,advanceFromDirectory:true,...(disk.permission==='granted'?{expectedDirectoryAsset:disk.found?disk.value:null}:{})});
   }
   if(choice.user&&!choice.page&&snapshot){
    if(typeof snapshot.content!=='string')fail('WORKSPACE_SNAPSHOT_INVALID');
    await browser.scripting.executeScript({target:{tabId:tab.id},files:['core/web-reading-page.js']});
    const cleaned=await browser.tabs.sendMessage(tab.id,{type:'BREVESS_WEB_READING_PAGE',command:'REDACT_SNAPSHOT',html:snapshot.content});if(!cleaned?.success||typeof cleaned.data!=='string')fail('WORKSPACE_SNAPSHOT_REDACTION_FAILED');
    const digest=await rootDigest(JSON.stringify(cleaned.data));options.replacement={content:cleaned.data,contentHash:digest,expectedRevision:snapshot.revision};
    const disk=await directory.readWorkspaceAsset(baseline,snapshot.relativePath);
    await directory.enqueueWorkspaceAsset(baseline,snapshot.relativePath,cleaned.data,{revision:snapshot.revision+1,contentHash:digest,workspaceGeneration:baseline.workspaceGeneration,advanceFromDirectory:true,...(disk.permission==='granted'?{expectedDirectoryAsset:disk.found?disk.value:null}:{})});
   }
   const externalPaths=choice.user&&documentId?['annotations/'+encodeURIComponent(documentId)+'.json',api.articleArchiveRelativePath({documentId,canonicalUrl:owner.canonicalUrl})]:[];
   const files=await directory.removeSelectedWorkspaceFiles(baseline,{paths,externalPaths,documentId,redactedPaths:[...(options.replacement?['article/offline-snapshot.html']:[]),...(options.sourceReplacement?['article/structure.json']:[])]});
   let result={deletedAssets:0,deletedTurns:0};if(paths.length||choice.user||options.sourceReplacement)result=await store.deleteSelectedData(id,options);committed=true;
   const refreshed=await coordinate(choice.user?'finalizeExternalArticleWorkspaceDeletion':'resumeExternalArticleWorkspaceDeletion',id,owner.workspaceGeneration);
   return{...result,files,deleted:true,choice,needsReload:!!refreshed.failed};
  }finally{if(!committed)await coordinate('resumeExternalArticleWorkspaceDeletion',id,owner.workspaceGeneration);}
 }
 async function rootDigest(text){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
 return{selectedPaths,deletePaper};
});
