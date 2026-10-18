(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.SciLLM ||= {},api);if(root.document)api.installRuntimeWorkbenchOwnerReceiver(root.window||root);})(globalThis,function(){
  'use strict';
  const TYPES = new Set(['RESEARCH_WORKBENCH_SYNC','RESEARCH_WORKBENCH_DIRECTORY_STATUS','RESEARCH_WORKBENCH_LOCATE_SOURCE','RESEARCH_WORKBENCH_DATA_DIRECTORY_ENSURE','RESEARCH_WORKBENCH_DATA_DIRECTORY_OPEN']);
  const OWNER_CHALLENGE = 'RESEARCH_WORKBENCH_OWNER_CHALLENGE';
  const fault = code => Object.assign(new Error(code),{code});
  function validMcpBridgeQuery(url) {
    const allowed = new Set(['mcpServer', 'mcpToken', 'mcpBridge']);
    const entries = [...url.searchParams.entries()];
    if (!entries.length || entries.some(([key]) => !allowed.has(key)) ||
        [...new Set(entries.map(([key]) => key))].length !== entries.length) return false;
    const bridge = url.searchParams.get('mcpBridge');
    if (bridge !== null && !['1', 'on', 'true'].includes(bridge)) return false;
    const token = url.searchParams.get('mcpToken');
    if (token !== null && (!token || token.length > 512 || /[\u0000-\u001f\u007f]/u.test(token))) return false;
    const server = url.searchParams.get('mcpServer');
    if (server !== null) {
      try {
        const target = new URL(server);
        if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname) ||
            target.username || target.password || target.search || target.hash) return false;
      } catch (_) {
        return false;
      }
    }
    return bridge !== null || server !== null || token !== null;
  }
  function sameDocumentPage(left, right) {
    if (left === right) return true;
    try {
      const a = new URL(left), b = new URL(right);
      if (a.protocol !== b.protocol || a.host !== b.host || a.pathname !== b.pathname || a.hash !== b.hash) return false;
      if (a.pathname !== '/workbench/index.html') return false;
      return validMcpBridgeQuery(a) && validMcpBridgeQuery(b);
    } catch (_) {
      return false;
    }
  }
  function installRuntimeWorkbenchOwnerReceiver(view) {
    const runtime=view.chrome?.runtime;
    if(!runtime?.onMessage?.addListener)return;
    let ownWorkbench=false;
    try {
      const href=new URL(view.location?.href||''), expected=new URL(runtime.getURL('workbench/index.html'));
      ownWorkbench=href.protocol===expected.protocol&&href.host===expected.host&&href.pathname===expected.pathname&&
        (!href.search||validMcpBridgeQuery(href))&&!href.hash;
    } catch (_) {}
    if(!ownWorkbench)return;
    runtime.onMessage.addListener((message,sender,respond)=>{
      if(message?.type!==OWNER_CHALLENGE||sender?.id!==runtime.id||typeof message.nonce!=='string'||!message.nonce||message.nonce.length>100)return false;
      const isTop=view===view.top,isDirectChild=!isTop&&view.parent===view.top;
      let parentHref='',designatedFrame=false;
      try {
        parentHref=view.parent.location.href;
        designatedFrame=isDirectChild&&view.parent.document.getElementById('researchWorkbenchFrame')?.contentWindow===view;
      } catch (_) {}
      respond({nonce:message.nonce,href:view.location.href,isTop,isDirectChild,parentHref,designatedFrame});
      return false;
    });
  }
  function createRuntimeWorkbenchBridge({chromeApi,store,adapter,resources,sync,getHandle,getWorkspace,sourceUrl,sendToSource,dataDirectories,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
    let syncing = null;
    const exactPage = (value,path) => {
      try {
        const url=new URL(value), expected=new URL(chromeApi.runtime.getURL(path));
        const mcpQuery=path==='workbench/index.html'&&validMcpBridgeQuery(url);
        return url.protocol===expected.protocol && url.host===expected.host && url.pathname===expected.pathname && (!url.search||mcpQuery) &&
          (!url.hash || (path==='options.html' && url.hash==='#page=workbench'));
      } catch { return false; }
    };
    async function authorize(sender) {
      const invalid=()=>{throw fault('WORKBENCH_SENDER_INVALID');};
      const ownUrl=new URL(chromeApi.runtime.getURL(''));
      const ownOrigin=ownUrl.protocol+'//'+ownUrl.host;
      if(sender?.id!==chromeApi.runtime.id||!exactPage(sender.url,'workbench/index.html')||!sender.documentId||
        sender.origin!==undefined&&sender.origin!==ownOrigin||sender.documentLifecycle!==undefined&&sender.documentLifecycle!=='active')invalid();
      // MessageSender may omit tab/frame. getContexts supplies browser-owned
      // identity for extension documents; it does not prove their parentage.
      const validContext=item=>item?.contextType==='TAB'&&typeof item.contextId==='string'&&item.contextId&&
        Number.isSafeInteger(item.tabId)&&item.tabId>=0&&Number.isSafeInteger(item.frameId)&&item.frameId>=0&&
        (item.documentOrigin===undefined||item.documentOrigin===ownOrigin);
      let child=null;
      if(typeof chromeApi.runtime.getContexts==='function') {
        const contexts=await chromeApi.runtime.getContexts({documentIds:[sender.documentId]});
        const matches=contexts.filter(item=>item.documentId===sender.documentId);
        if(matches.length!==1||!validContext(matches[0])||!sameDocumentPage(matches[0].documentUrl,sender.url))invalid();
        child={...matches[0]};
        if(sender.tab!==undefined&&sender.tab?.id!==child.tabId||sender.frameId!==undefined&&sender.frameId!==child.frameId)invalid();
        sender={...sender,tab:{id:child.tabId},frameId:child.frameId};
      }
      if(
        !Number.isSafeInteger(sender.tab?.id)||sender.tab.id<0||!Number.isSafeInteger(sender.frameId)||sender.frameId<0||!sender.documentId)throw fault('WORKBENCH_SENDER_INVALID');
      const readFrame=async frameId=>{try{return await chromeApi.webNavigation?.getFrame({tabId:sender.tab.id,frameId});}catch{return null;}};
      const [tab,frame]=await Promise.all([chromeApi.tabs.get(sender.tab.id),readFrame(sender.frameId)]);
      const ownerPage=sender.frameId===0?'workbench/index.html':'options.html';
      if(!tab||tab.id!==sender.tab.id||tab.url!==undefined&&!exactPage(tab.url,ownerPage))invalid();
      // Positive, contradictory navigation evidence must never be overridden.
      if(frame&&(frame.documentId!==sender.documentId||!exactPage(frame.url,'workbench/index.html')||
        frame.documentLifecycle!==undefined&&frame.documentLifecycle!=='active'||sender.frameId!==0&&frame.parentFrameId!==0))invalid();
      const topFrame=sender.frameId===0?frame:await readFrame(0);
      if(topFrame&&!exactPage(topFrame.url,ownerPage))invalid();
      if(frame&&topFrame&&tab.url!==undefined)return;
      // Chromium normally excludes chrome-extension URLs from webNavigation.
      // Require exact live contexts AND an exact-document DOM owner challenge.
      if(!child||typeof chromeApi.tabs.sendMessage!=='function')invalid();
      const contexts=await chromeApi.runtime.getContexts({tabIds:[child.tabId]});
      const owners=contexts.filter(item=>item.frameId===0&&item.tabId===child.tabId);
      if(owners.length!==1||!validContext(owners[0])||!exactPage(owners[0].documentUrl,ownerPage))invalid();
      const owner={...owners[0]};
      if(topFrame&&topFrame.documentId!==owner.documentId||sender.frameId===0&&owner.documentId!==child.documentId)invalid();
      const nonce=globalThis.crypto.randomUUID();let receipt;
      try {receipt=await chromeApi.tabs.sendMessage(child.tabId,{type:OWNER_CHALLENGE,nonce},{frameId:child.frameId,documentId:child.documentId});}
      catch (_) {invalid();}
      if(receipt?.nonce!==nonce||!sameDocumentPage(receipt.href,child.documentUrl)||receipt.isTop!==(child.frameId===0)||
        child.frameId!==0&&(receipt.isDirectChild!==true||receipt.designatedFrame!==true||receipt.parentHref!==owner.documentUrl))invalid();
      const current=await chromeApi.runtime.getContexts({tabIds:[child.tabId]});
      for(const expected of [child,owner]) {
        const found=current.filter(item=>item.frameId===expected.frameId&&item.tabId===expected.tabId);
        if(found.length!==1||!validContext(found[0])||['contextId','documentId'].some(key=>found[0][key]!==expected[key])||
          !sameDocumentPage(found[0].documentUrl,expected.documentUrl))invalid();
      }
    }
    async function project(id) {
      if(typeof id!=='string'||!id)throw fault('WORKBENCH_PROJECT_NOT_FOUND');
      const row=await store.getProject(id);if(!row||row.deleted)throw fault('WORKBENCH_PROJECT_NOT_FOUND');return row;
    }
    function scheduleSync() {
      if(!syncing) syncing=Promise.resolve().then(()=>sync({store,adapter})).finally(()=>{syncing=null;});
      return syncing;
    }
    async function directoryStatus() {
      const handle=await getHandle();const permission=handle?await handle.queryPermission({mode:'readwrite'}):'unavailable';
      const outbox=await store.listOutbox();
      return {permission,granted:permission==='granted',pending:outbox.filter(x=>x.state==='pending').length,failed:outbox.filter(x=>x.state==='failed').length};
    }
    async function locate(message,sender) {
      await project(message.projectId);
      await resources.validateReference(message.source);
      const workspace=await getWorkspace(message.source.workspaceId);
      if(!workspace||workspace.deletionPending||Number(workspace.workspaceGeneration||1)!==message.source.workspaceGeneration)throw fault('WORKBENCH_SOURCE_VERSION_CHANGED');
      // URL comes only from the stored workspace, never resourceId or caller text.
      const url=sourceUrl(workspace.canonicalUrl);
      if(!url)throw fault('WORKBENCH_SOURCE_URL_UNAVAILABLE');
      const tabs=await chromeApi.tabs.query({});
      let tab=tabs.find(item=>item.url===url);
      if(!tab)tab=await chromeApi.tabs.create({url,active:true});
      else await chromeApi.tabs.update(tab.id,{active:true});
      let ready;
      for(let attempt=0;attempt<16;attempt++) {
        await authorize(sender);
        try {ready=await sendToSource(tab.id,{action:'prepareWorkbenchSource',source:message.source});}catch {ready=null;}
        if(ready?.success&&ready.ready===true)break;
        if(attempt<15)await sleep(250);
      }
      if(!ready?.success||ready.ready!==true)throw fault('WORKBENCH_SOURCE_NOT_READY');
      await resources.validateReference(message.source);await project(message.projectId);await authorize(sender);
      if(message.prepareOnly===true)return {...ready,tabId:tab.id};
      if(JSON.stringify(ready.navigationIdentity)!==JSON.stringify(message.expectedNavigationIdentity)||
        JSON.stringify(ready.documentIdentity)!==JSON.stringify(message.expectedDocumentIdentity))throw fault('WORKBENCH_SOURCE_IDENTITY_CHANGED');
      const receipt=await sendToSource(tab.id,{action:'focusWorkbenchSource',source:message.source,target:message.target,
        expectedNavigationIdentity:message.expectedNavigationIdentity,expectedDocumentIdentity:message.expectedDocumentIdentity});
      await authorize(sender);await resources.validateReference(message.source);await project(message.projectId);
      if(receipt?.success===false && new Set([
        'WORKBENCH_SOURCE_VERSION_CHANGED','WORKBENCH_SOURCE_IDENTITY_CHANGED',
        'WORKBENCH_SOURCE_REFERENCE_REQUIRED','WORKBENCH_TARGET_UNSUPPORTED','WORKBENCH_SENDER_INVALID',
        'PDF_FIGURE_CONTEXT_STALE','PDF_FIGURE_ARTWORK_PAGES_INVALID','PDF_FIGURE_PAGE_UNVERIFIED',
        'PDF_FIGURE_PAGE_UNAVAILABLE','FIGURE_NOT_FOUND'
      ]).has(receipt.code))throw fault(receipt.code);
      if(receipt?.success!==true||receipt.ready!==true||receipt.focused!==true||
        JSON.stringify(receipt.target)!==JSON.stringify(message.target)||
        JSON.stringify(receipt.documentIdentity)!==JSON.stringify(ready.documentIdentity)||
        JSON.stringify(receipt.navigationIdentity)!==JSON.stringify(ready.navigationIdentity)||
        !['figure','page','paragraph'].includes(receipt.precision))throw fault('WORKBENCH_LOCATE_RECEIPT_MISMATCH');
      return receipt;
    }
    async function handle(message,sender) {
      if(!TYPES.has(message?.type))throw fault('UNKNOWN_MESSAGE');
      await authorize(sender);
      if(message.type==='RESEARCH_WORKBENCH_DIRECTORY_STATUS')return directoryStatus();
      if(['RESEARCH_WORKBENCH_DATA_DIRECTORY_ENSURE','RESEARCH_WORKBENCH_DATA_DIRECTORY_OPEN'].includes(message.type)) {
        if(!dataDirectories)throw fault('WORKBENCH_DATA_DIRECTORY_SERVICE_UNAVAILABLE');
        if(Object.keys(message).some(key=>!['type','projectId','target'].includes(key)))throw fault('WORKBENCH_DATA_DIRECTORY_INVALID_TARGET');
        const row=await project(message.projectId);
        const precondition=async()=>{await authorize(sender);const current=await project(message.projectId);
          if(current.revision!==row.revision)throw fault('WORKBENCH_REVISION_CONFLICT');};
        const action=message.type==='RESEARCH_WORKBENCH_DATA_DIRECTORY_ENSURE'?'ensure':'open';
        const receipt=await dataDirectories[action](row.project,message.target,{precondition});
        await precondition();return receipt;
      }
      if(message.type==='RESEARCH_WORKBENCH_SYNC') {
        if(message.projectId)await project(message.projectId);
        const results=await scheduleSync();await authorize(sender);
        return {results:message.projectId?results.filter(x=>x.projectId===message.projectId):results,...await directoryStatus()};
      }
      return locate(message,sender);
    }
    return {handle,scheduleSync,authorize};
  }
  return {createRuntimeWorkbenchBridge,installRuntimeWorkbenchOwnerReceiver,RUNTIME_WORKBENCH_MESSAGE_TYPES:TYPES};
});
