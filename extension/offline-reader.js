(async function(){
  'use strict';
  let publication=null;
  const invalidate=()=>{if(publication)publication.active=false;globalThis.__brevessSavedArticleDocument=null;};
  window.addEventListener('pagehide',invalidate);
  window.addEventListener('popstate',()=>{invalidate();location.reload();});
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.action!=='validateSavedArticleReader')return;
    const current=publication?.active&&sender.id===chrome.runtime.id&&location.href===publication.binding.readerUrl;
    respond(current?{success:true,binding:publication.binding,navigationIdentity:location.href}:{success:false});return false;
  });
  let status=document.getElementById('offlineArticleStatus');
  try{
    const saved=await chrome.runtime.sendMessage({type:'OFFLINE_ARTICLE_GET_SNAPSHOT',readerUrl:location.href,includeAssets:true});
    if(!saved?.success||!saved.data?.binding||!saved.data?.snapshot?.paragraphs?.length)throw Error('未找到完整正文，请在有原文访问权限时重新保存。');
    const {binding,snapshot,assetReceipt}=saved.data;
    const response=await chrome.runtime.sendMessage({type:'ARTICLE_WORKSPACE_GET_ASSET',workspaceId:binding.workspaceId,relativePath:'article/offline-snapshot.html'});
    if(!response?.success)throw Error(response?.error?.message||response?.error?.code||'本机快照不可用');
    if(response.data?.asset?.revision!==assetReceipt.revision||response.data.asset.contentHash!==assetReceipt.contentHash||
      (Number(response.data.workspaceGeneration)||1)!==binding.workspaceGeneration)throw Error('文献保存版本已变化，请重新打开。');
    const html=String(response.data.asset.content);
    // Restore the publisher's original canvas while the compact toolbar keeps its own palette.
    document.documentElement.removeAttribute('data-brevess-ui');
    document.querySelector('meta[name="color-scheme"]')?.remove();
    SciLLM.mountSavedArticleHtml(document,html);document.title=snapshot.title||'本机文献 · BREVESS';
    const canonical=document.createElement('link');canonical.rel='canonical';canonical.href=snapshot.url;document.head.append(canonical);
    publication={active:true,binding:Object.freeze({...binding}),snapshot,metadata:saved.data.metadata,
      structure:SciLLM.bindSavedArticleDom(document,snapshot),source:{title:snapshot.title,canonicalUrl:snapshot.url,
        documentId:snapshot.documentId,documentHash:snapshot.documentHash,
        doi:(snapshot.localWorkspace?.aliases||[]).find(row=>row.type==='doi')?.value||''}};
    globalThis.__brevessSavedArticleDocument=publication;
    // Keep the compact toolbar isolated from publisher CSS. Reading uses the
    // same content runtime and sidebar as a publisher tab.
    const host=document.createElement('div');host.setAttribute('data-sci-plugin-ui','');
    host.style.cssText='position:sticky!important;top:0!important;display:block!important;z-index:2147483646!important;margin:0!important;';
    const shadow=host.attachShadow({mode:'closed'}),style=document.createElement('style');
    style.textContent=':host{all:initial}header{display:flex;align-items:center;gap:12px;padding:8px 16px;background:var(--bv-surface,#fffefc);border-bottom:1px solid var(--bv-line,#eee);font:13px/1.4 system-ui;color:var(--bv-muted,#555)}strong{font-size:14px;color:var(--bv-text,#161616)}span{flex:1}button,a{font:inherit;color:var(--bv-text,#161616);text-decoration:none;background:none;border:0;padding:5px 10px;border-radius:6px;cursor:pointer}button{background:var(--bv-selected,#181818);color:var(--bv-on-selected,white)}button:disabled{opacity:.4}';
    const bar=document.createElement('header'),brand=document.createElement('strong');brand.textContent='BREVESS';
    status=document.createElement('span');status.setAttribute('role','status');status.textContent='正在恢复阅读成果…';
    const original=document.createElement('a');original.textContent='在线原文';original.href=snapshot.url;original.target='_blank';original.rel='noopener noreferrer';
    const start=document.createElement('button');start.type='button';start.textContent='打开研读侧栏';start.disabled=true;
    bar.append(brand,status,original,start);shadow.append(style,bar);document.body.prepend(host);
    const loaded=new Set([...document.scripts].map(script=>script.getAttribute('src')));
    for(const file of SciLLM.CONTENT_SCRIPT_FILES){
      if(loaded.has(file))continue;
      await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=chrome.runtime.getURL(file);
        script.onload=resolve;script.onerror=()=>reject(Error('研读模块加载失败：'+file));document.body.append(script);});
    }
    publication.structure.typedRecords = [...publication.structure.paragraphs,
      ...SciLLM.restoreSavedCaptionRecords(document, snapshot, SciLLM)];
    await globalThis.initializeSavedArticleWorkspace(saved.data);
    if(!publication.active)return;
    chrome.runtime.sendMessage({type:'SAVED_ARTICLE_READY',binding}).catch(()=>{});
    const updateStatus=()=>{status.textContent=navigator.onLine?'原文已保存在本机 · 可继续研读':'原文已保存在本机 · 断网时仍可阅读和编辑';};
    updateStatus();window.addEventListener('online',updateStatus);window.addEventListener('offline',updateStatus);start.disabled=false;
    start.onclick=async()=>{
      start.disabled=true;
      try{const result=await chrome.runtime.sendMessage({type:'OFFLINE_READER_START_READING'});
        if(!result?.success)throw Error(result?.error?.message||'侧栏暂不可用，请重新打开。');}
      catch(error){status.textContent=error.message;}
      finally{if(publication.active)start.disabled=false;}
    };
  }catch(error){invalidate();if(status)status.textContent='本机文献打开失败：'+error.message;}
})();
