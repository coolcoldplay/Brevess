(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./pdf-workspace.js'):root.SciLLM||{});if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.SciLLM||={},api);})(globalThis,function(pdf){
  'use strict';
  function libraryOnlineUrl(value){
    try{const url=new URL(String(value||''));return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}
  }
  function libraryOriginalReaderUrl(value,{getURL}={}){
    if(typeof getURL!=='function')return libraryOnlineUrl(value);
    try{
      const source=new URL(String(value||''));
      if(source.username||source.password)return '';
      const local=pdf.withLocalPdfWorkspaceSource?.(getURL('pdf-reader.html'),source.href);
      if(local)return local;
      let pathname=source.pathname;try{pathname=decodeURIComponent(pathname);}catch{return '';}
      const ordinaryPdf=source.protocol==='file:'&&!source.host&&!source.search&&!source.hash&&!/[\u0000-\u001f\u007f]/u.test(pathname)&&/\.pdf$/iu.test(pathname);
      if(ordinaryPdf||libraryOnlineUrl(source.href)&&pdf.isLikelyPdfUrl?.(source.href))return pdf.createPdfReaderUrl?.(getURL,source.href)||'';
      return libraryOnlineUrl(source.href);
    }catch{return '';}
  }
  function describeLibrarySource(source={},options={}){
    const imported=source.inventoryOnly===true,kind=source.sourceKind==='pdf'?'pdf':'html';
    const raw=source.url||source.canonicalUrl||source.sourceUrl||'';
    const localPdf=!imported&&kind==='pdf'?libraryOriginalReaderUrl(raw,options):'';
    const offline=!imported&&source.hasOfflineSnapshot===true&&typeof source.workspaceId==='string'&&source.workspaceId&&typeof options.getURL==='function'
      ?options.getURL('offline-reader.html?workspaceId='+encodeURIComponent(source.workspaceId)):'';
    const online=libraryOnlineUrl(raw)||libraryOnlineUrl(source.publisherUrl)||'';
    const links=[];
    if(offline)links.push({kind:'offline-html',label:'本地 HTML',url:offline});
    if(localPdf&&new URL(raw).protocol==='file:')links.push({kind:'local-pdf',label:'本地 PDF',url:localPdf});
    if(online)links.push({kind:'online',label:'在线原文',url:kind==='pdf'?libraryOriginalReaderUrl(online,options):online});
    const state=imported?'inventory-only':offline?(source.offlineSnapshotStatus==='complete'?'complete':source.offlineSnapshotStatus==='partial'?'partial':'unknown'):links.some(link=>link.kind==='local-pdf')?'local-pdf':'missing';
    const status={
      'inventory-only':'来源设备的附件清单，原件未导入本机',complete:'本地 HTML 与阅读图片已保存',partial:'本地 HTML 部分资源未保存',unknown:'本地 HTML 的资源完整度未记录','local-pdf':'本地 PDF 入口；打开时核验原件是否可用',missing:'尚无本机原件，可使用在线原文或添加附件'
    }[state];
    const latestAttempt=state==='complete'&&source.lastSaveAttemptStatus==='partial'?'；最近一次保存未完成，当前打开的是此前完整快照':'';
    return {kind,state,status:status+latestAttempt,links,workspaceId:imported?'':source.workspaceId||'',workspaceGeneration:imported?null:source.workspaceGeneration??null};
  }
  return {libraryOnlineUrl,libraryOriginalReaderUrl,describeLibrarySource};
});
