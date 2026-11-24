(async function(){
  'use strict';
  const status=document.getElementById('library-html-status'),start=document.getElementById('library-html-start');
  let publication=null;
  const catalogStore=BrevessLibraryCatalog.createLibraryCatalogStore();
  const attachmentStore=BrevessLibraryAttachments.createLibraryAttachmentStore();
  function invalidate(){if(publication)publication.active=false;globalThis.__brevessLibraryHtmlDocument=null;start.disabled=true;}
  window.addEventListener('pagehide',invalidate);
  window.addEventListener('popstate',()=>{invalidate();location.reload();});
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.action!=='validateLibraryHtmlReader')return;
    const current=publication?.active&&sender?.id===chrome.runtime.id&&
      JSON.stringify(SciLLM.parseLibraryHtmlReaderUrl(location.href,chrome.runtime.getURL('')))===JSON.stringify(publication.sourceBinding);
    respond(current?{success:true,binding:publication.binding,navigationIdentity:location.href}:{success:false});return false;
  });
  try{
    const binding=SciLLM.parseLibraryHtmlReaderUrl(location.href,chrome.runtime.getURL(''));
    const source=await SciLLM.readLibraryHtmlSource({catalogStore,attachmentStore,binding});
    const records=SciLLM.extractLibraryHtmlText(await source.blob.text(),{document});
    const paragraphs=records.map(({tag,...record})=>record);
    SciLLM.renderLibraryHtmlText(document.getElementById('library-html-body'),records,{document});
    const {blob,...metadata}=source;
    document.title=(metadata.title||metadata.name)+' · Brevess';
    document.getElementById('library-html-title').textContent=metadata.title;
    if(metadata.doi){const meta=document.createElement('meta');meta.name='citation_doi';meta.content=metadata.doi;document.head.append(meta);}
    if(metadata.canonicalUrl){const canonical=document.createElement('link');canonical.rel='canonical';canonical.href=metadata.canonicalUrl;document.head.append(canonical);}
    publication={active:true,source:metadata,sourceBinding:binding,binding:Object.freeze({...binding,generation:1}),paragraphs};
    globalThis.__brevessLibraryHtmlDocument=publication;
    // Load exactly the same full receiver/dependencies as ordinary article activation.
    const loaded=new Set([...document.scripts].map(s=>s.getAttribute('src')));
    for(const file of SciLLM.CONTENT_SCRIPT_FILES){
      if(loaded.has(file))continue;
      await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=chrome.runtime.getURL(file);
        script.onload=resolve;script.onerror=()=>reject(new Error('READER_MODULE_UNAVAILABLE: '+file));document.body.append(script);});
    }
    if(!publication.active)return;
    const coverage=SciLLM.libraryHtmlProjectionSummary(records);
    const missing=(coverage.unavailableImages||0)+(coverage.unsupportedVectors||0);
    status.textContent='已核验本机原件。可选择正文高亮，或打开侧栏研读。'+
      (missing?' '+missing+' 处图像未能本地显示，详见正文提示。':'');start.disabled=false;
    start.onclick=async()=>{
      start.disabled=true;
      try{const result=await chrome.runtime.sendMessage({type:'LIBRARY_HTML_START_READING'});
        if(!result?.success)throw Error(result?.error?.code||'READER_UNAVAILABLE');
        status.textContent='研读侧栏已打开。';
      }catch(error){status.textContent='研读未连接，请重新打开原件。'+String(error.message||'');}
      finally{if(publication.active)start.disabled=false;}
    };
  }catch(error){invalidate();status.textContent='无法打开本机原件：'+String(error.code||error.message||'未知错误');}
})();
