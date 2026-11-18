(function(root){
  'use strict';
  root.BrevessReadingAgent.installReadingAgentBackground=function({browser,authorize,router,directory,ensureContent,keepAlive}){
    const fail=(code,message=code)=>Object.assign(Error(message),{code});
    const route=async message=>{
      const response=await router.handle(message,{trustedExtensionSender:true});
      if(response?.success!==true)throw fail(response?.error?.code||'READING_STORAGE_FAILED',response?.error?.message||'保存服务未完成操作。');
      return response.data;
    };
    async function flush(){const result=await route({type:'USER_DATA_SYNC_NOW',drain:true});if(result?.permission!=='granted'||result.failed||result.pendingCount||result.conflicts)throw fail('READING_DIRECTORY_SYNC_INCOMPLETE','浏览器中已有结果，但本地目录尚未完整同步；请检查保存状态。');return result;}
    async function save(binding,operationId){
      const state=await directory.status();if(state.permission!=='granted')throw fail('READING_DIRECTORY_PERMISSION_REQUIRED','请在快速配置中选择并授权保存文件夹。');
      const result=await browser.tabs.sendMessage(binding.tabId,{action:'saveArticleWorkspaceNow',includePage:true,operationId,expectedDocumentIdentity:binding.documentIdentity,expectedNavigationIdentity:binding.navigationIdentity},{frameId:0});
      if(result?.success!==true)throw fail(result?.code||'READING_SAVE_FAILED',result?.error||'保存未完成。');
      const mirrored=await route({type:'ARTICLE_WORKSPACE_MIRROR_ALL',workspaceId:result.workspace.workspaceId,workspaceGeneration:result.workspace.workspaceGeneration,transaction:result.transaction});
      if(mirrored?.permission!=='granted')throw fail('READING_DIRECTORY_PERMISSION_REQUIRED');
      const synced=await flush();
      return{workspaceId:result.workspace.workspaceId,workspaceGeneration:result.workspace.workspaceGeneration,directoryName:state.directoryName,relativePath:'workspaces/'+result.workspace.directoryName,assetCount:result.assetCount,turnCount:result.turnCount,complete:result.offlineSnapshot?.complete===true&&result.warnings?.length===0,offline:result.offlineSnapshot,mirrored:mirrored.queued,synced};
    }
    async function bundle(args){
      const state=await directory.status();if(state.permission!=='granted')throw fail('READING_DIRECTORY_PERMISSION_REQUIRED','请先授权本地保存文件夹。');
      const exported=await route({type:'ARTICLE_WORKSPACE_EXPORT',workspaceId:args.workspaceId});
      if(exported.workspace.workspaceGeneration!==args.workspaceGeneration)throw fail('READING_WORKSPACE_CHANGED');
      const renderer=await(await fetch(browser.runtime.getURL('core/chat-message-ui.js'))).text();
      const pack=root.BrevessReadingAgent.buildReadingPackEntries(exported,{rendererScript:renderer});
      const blob=await root.SciLLM.createZipBlob(pack.entries),bytes=new Uint8Array(await blob.arrayBuffer());
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
      const file='exports/reading-pack.zip';
      await directory.enqueueWorkspaceBinary(exported.workspace,file,bytes,{contentHash:hash});await flush();
      return{saved:true,directoryName:state.directoryName,relativePath:'workspaces/'+exported.workspace.directoryName+'/'+file,bytes:bytes.length,sha256:hash,complete:pack.complete,assetCount:pack.assetCount,turnCount:pack.turnCount};
    }
    const controller=root.BrevessReadingAgent.createReadingJobController({browser,ensureContent,save,bundle,keepAlive});
    browser.runtime.onMessage.addListener((message,sender,sendResponse)=>{
      if(message?.type!=='BREVESS_READING_AGENT')return false;
      keepAlive((async()=>{
        await authorize(sender);
        const spec=root.BrevessReadingAgent.readingAgentDefinitions.find(d=>d.name===message.name);if(!spec)throw fail('READING_TOOL_UNKNOWN');
        root.BrevessReadingAgent.validateReadingAgentArguments(message.args||{},spec.inputSchema);
        if(message.name==='reading_start'&&(message.args.task==='save'||message.args.saveAfter!==false)&&(await directory.status()).permission!=='granted')throw fail('READING_DIRECTORY_PERMISSION_REQUIRED','请先在快速配置中授权本地文件夹，再执行解图并保存。');
        return controller.handle(message.name,message.args||{});
      })()).then(data=>sendResponse({success:true,data}),error=>sendResponse({success:false,error:{code:error.code||'READING_TOOL_FAILED',message:String(error.message||error).slice(0,600)}}));
      return true;
    });
    return controller;
  };
})(globalThis);
