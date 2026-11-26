(() => {
 'use strict';
 // A small bridge augments the original workspace, never creates a second one.
 const $=id=>document.getElementById(id);
 let current=null,epoch=0,lastPosition=null,legacy=null,loading=false,outlineRefreshAt=0,temporaryOutline=null,temporaryOwner='',temporarySignature='',preFilterStatus='';
 const styles=document.createElement('style');
 styles.textContent='#articleNavigationTree .workspace-tree-jump[aria-current="location"]{background:var(--bv-selected,#eef5f8);color:var(--bv-on-selected,#215c80);border-radius:4px}.unified-legacy{margin:10px 0}.unified-legacy textarea{width:100%;min-height:100px;font:inherit}.unified-legacy pre{white-space:pre-wrap;overflow-wrap:anywhere}';
 document.head.append(styles);
 function mark(){for(const el of $('articleNavigationTree')?.querySelectorAll('[data-reading-section-id]')||[]){if(el.dataset.readingSectionId===lastPosition)el.setAttribute('aria-current','location');else el.removeAttribute('aria-current');}}
 function clearLegacy(){for(const el of document.querySelectorAll('[data-unified-legacy]'))el.remove();legacy=null;}
 function call(command,extra={}){return chrome.runtime.sendMessage({type:'BREVESS_WEB_READING',command,windowId:current.windowId,...extra}).then(r=>{if(!r?.success)throw Error(r?.error||'网页记录读取失败');return r.data;});}
 function card(parent,title){const box=document.createElement('details');box.className='side-panel-result-card unified-legacy';box.dataset.unifiedLegacy='true';const summary=document.createElement('summary');summary.textContent=title;box.append(summary);parent?.append(box);return box;}
 function documentOwner(){return typeof activePanelTabContext==='undefined'?'':activePanelTabContext.key+'|'+(typeof manualAnnotationState==='object'?manualAnnotationState.contentWorldNonce:'');}
 function outlineSourceDetails(value,truncated=false,title=''){
  if(typeof value!=='string'||!value.trim())return {};
  const compact=text=>String(text||'').normalize('NFKC').replace(/^(?:提问|问题|Question|You)\s*[:：]\s*/i,'').replace(/\s+/g,'');
  if(!truncated&&compact(value)===compact(title))return {};
  return {unifiedOutlineFullText:value.slice(0,24000),unifiedOutlineTextTruncated:truncated===true||value.length>24000};
 }
 function filterOutline(snapshot){
  const value=temporaryOutline;
  if(!snapshot||!value||temporaryOwner!==documentOwner()||value.tabId!==activePanelTabContext?.tabId)return null;
  const frames=Array.isArray(value.frames)?value.frames:[],top=frames.find(f=>f.frameId===0);
  if(!top||String(top.url||'').split('#')[0]!==String(snapshot.url||'').split('#')[0])return null;
  if(!frames.some(f=>Array.isArray(f.groups)&&f.groups.length))return null;
  const nodes=[];let count=0,omitted=0,currentSectionId=null;
  for(const frame of frames){omitted+=Number(frame.omitted)||0;for(const group of frame.groups||[]){const stack=[];for(const item of group.items||[]){
   const level=Math.min(6,Math.max(1,Number(item.level)||1));
   const ref={tabId:value.tabId,frameId:frame.frameId,session:frame.session,version:frame.version,id:item.id};
   const node={sectionId:'filter:'+JSON.stringify([ref.tabId,ref.frameId,ref.session,group.operation,item.id]),title:item.title,searchTitleFontSize:item.searchTitleFontSize,searchPublication:item.searchPublication,...outlineSourceDetails(item.fullText,item.textTruncated===true||String(item.fullText||'').length>=2400,item.title),level,children:[],paragraphs:[],paragraphCount:0,analysisSectionIds:[],unifiedFilterReference:ref};
   if(frame.currentId===item.id)currentSectionId=node.sectionId;
   while(stack.length&&stack.at(-1).level>=level)stack.pop();(stack.length?stack.at(-1).children:nodes).push(node);stack.push(node);count++;
  }}}
  return {nodes,count,omitted,currentSectionId,reading:value.provider==='reading-module'&&!value.temporary};
 }
 function structuredSnapshot(){return legacy?.snapshot?.kind==='conversation'||legacy?.snapshot?.outlineKind==='feed';}
 let live = null;
 const firstDocument = new WeakMap();
 async function sameLoadedDocument(owner) {
  const expected = firstDocument.get(owner);
  if (!expected) return false;
  try {
   const [frame] = await chrome.scripting.executeScript({target:{tabId:owner.tabId,frameIds:[0]},injectImmediately:true,func:()=>true});
   return frame?.documentId === expected;
  } catch (_) { return false; }
 }
 const pageUrl = value => String(value || '').split('#')[0];
 function currentLive() {
  return live?.owner === activePanelTabContext && live;
 }
 function updateOutlineStatus() {
  const state = currentLive(), el = $('articleOutlineLoading');
  if (!el) return;
  const busy = Boolean(state && (state.busy || !state.owner.activated && !state.retryAfter));
  const text = busy ? (state.rows?.length ? '页面正在更新，大纲会自动同步…' : '正在读取大纲…') : '';
  if (el.hidden === busy) el.hidden = !busy;
  const localized = text ? t(text) : '';
  if (el.textContent !== localized) el.textContent = localized;
  $('articleNavigationTree')?.setAttribute('aria-busy', String(busy));
 }
 function updateConversationText(rows, before) {
  if (!before || before.length!==rows.length || filterOutline(currentWorkspaceSnapshot)) return false;
  const edits=[];
  for (let i=0;i<rows.length;i++) {
   const row=rows[i], prior=before[i];
   if (row.id!==prior.id || row.title!==prior.title || row.level!==prior.level || row.parentId!==prior.parentId) return false;
   if (row.text===prior.text && row.textTruncated===prior.textTruncated) continue;
   const jump=$('articleNavigationTree')?.querySelector('[data-reading-section-id="'+CSS.escape('web:'+row.id)+'"]');
   const source=jump?.closest('details')?.querySelector(':scope > .workspace-outline-source');
   const details=outlineSourceDetails(row.text,row.textTruncated,row.title);
   if (!source || !details.unifiedOutlineFullText) return false;
   edits.push({source,details});
  }
  for (const {source,details} of edits) {
   source.querySelector('.workspace-outline-source-text').textContent=details.unifiedOutlineFullText;
   source.querySelector('summary').textContent=t(details.unifiedOutlineTextTruncated?'已提取片段':'已提取原文');
  }
  return true;
 }
 function watch(owner) {
  if (live?.owner === owner && (live.port || !live.retryAfter || Date.now() < live.retryAfter)) return;
  const previous = live; live = null;
  previous?.port?.disconnect();
  if (!owner?.tabId || owner.pdfMode || owner.offlineMode || !/^(https?|file):/.test(owner.url) || /\.pdf(?:[?#]|$)/i.test(owner.url)) {
   updateOutlineStatus(); return;
  }
  const state = live = {owner, busy:true, rows:null, revision:'', dirty:false, port:null};
  updateOutlineStatus();
  function detached() {
   if (live !== state) return;
   state.port = null; state.rows = null; state.busy = false; state.retryAfter = Date.now()+900;
   updateOutlineStatus(); renderArticleNavigationTree(currentWorkspaceSnapshot);
  }
  (async()=>{
   const target = {tabId:owner.tabId,frameIds:[0]};
   const [injection] = await chrome.scripting.executeScript({target,injectImmediately:true,files:['core/web-reading-page.js']});
   if (currentLive() !== state) return;
   if (injection?.documentId && !firstDocument.has(owner)) firstDocument.set(owner,injection.documentId);
   const port = chrome.tabs.connect(owner.tabId,{name:'brevess-live-outline',...(injection?.documentId ? {documentId:injection.documentId} : {frameId:0})});
   state.port=port;
   port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;detached();});
   port.onMessage.addListener(m=>{
    if (currentLive() !== state || pageUrl(m.sourceUrl)!==pageUrl(owner.url)) return;
    if (m.type==='unsupported') { state.busy=false;updateOutlineStatus();return; }
    if (m.type==='position') {
     if (state.kind==='conversation' && !filterOutline(currentWorkspaceSnapshot)) {lastPosition='web:'+m.id;mark();}
     return;
    }
    if (m.type==='located') { if(!m.found)locationError(Error('当前网页未找到原位置')); return; }
    if (m.type!=='outline') return;
    const previous=state.rows;
    if (Array.isArray(m.outline)) {
     state.dirty=Boolean(state.revision) || state.dirty;
     Object.assign(state,{rows:m.outline,revision:m.revision,title:m.title,kind:m.kind,documentToken:m.documentToken});
    }
    state.busy=m.busy; updateOutlineStatus();
    if (m.outline) {
     if (state.kind!=='conversation' || !updateConversationText(state.rows,previous)) renderArticleNavigationTree(currentWorkspaceSnapshot);
     conversationStatus();
    }
    const initialization = typeof articleInitializationState === 'undefined' ? null : articleInitializationState;
    const awaitingBody = owner.activated && !currentWorkspaceSnapshot &&
      initialization && isCurrentPanelContext(initialization.context) && (initialization.reading || initialization.error);
    if (!state.busy && (awaitingBody || state.dirty && state.kind!=='conversation') && state.reconciled!==state.revision) {
     state.reconciled=state.revision;
     ensureArticleStructureRefreshCoordinator().enqueue({type:'ARTICLE_STRUCTURE_CHANGED'},owner.tabId,capturePanelContext());
    }
   });
  })().catch(detached);
 }
 function liveVersion() { const state=currentLive();return state ? {state, revision:state.revision} : null; }
 function acceptVersion(version) { if(version && version.state===currentLive() && version.revision===version.state.revision) version.state.dirty=false; }
 function liveLocate(ref) {
  const state=currentLive();
  if (state?.documentToken!==ref.documentToken || !state?.port) return locationError(Error('原文页面已切换'));
  state.port.postMessage({type:'locate',...ref});
 }
 function projectOutline(snapshot){
  const filtered=filterOutline(snapshot);
  if(filtered){
    if(!filtered.reading)return {...snapshot,nodes:filtered.nodes};
    // Reading-mode nodes have session-scoped scroll targets. Translation and
    // persistence use the original section identities, including after reload.
    const originals=snapshot.readingTranslationSourceNodes || snapshot.nodes || [];
    const normalize=title=>String(title||'').normalize('NFKC').replace(/\s+/g,' ').trim();
    const byTitle=new Map();
    function index(nodes,parent=''){
      for(const node of nodes){
        const title=normalize(node.title), matches=byTitle.get(title)||[];
        matches.push({node,parent}); byTitle.set(title,matches);
        index(node.children||[],title);
      }
    }
    function bind(nodes,parent=''){
      for(const node of nodes){
        const title=normalize(node.title), all=byTitle.get(title)||[];
        const matches=all.length>1 ? all.filter(item=>item.parent===parent) : all;
        if(matches.length===1)node.translationSource=matches[0].node;
        bind(node.children||[],title);
      }
    }
    index(originals); bind(filtered.nodes);
    return {...snapshot,nodes:filtered.nodes,readingTranslationSourceNodes:originals};
  }
  const watching=currentLive();
  // Live article headings have no paragraphs. Keep the last readable sections
  // until a new extraction is ready. Conversations and feeds own their outlines.
  if (snapshot?.paragraphs?.length && snapshot.nodes?.length &&
      (watching?.kind === 'paper' || watching?.kind === 'article') &&
      pageUrl(snapshot.url) === pageUrl(watching.owner.url) &&
      !(structuredSnapshot() && pageUrl(snapshot.url) === legacy.snapshot.sourceUrl)) return snapshot;
  const useLive=Array.isArray(watching?.rows) && (!snapshot || pageUrl(snapshot.url)===pageUrl(watching.owner.url)) &&
    (watching.kind==='conversation' || snapshot?.readingContentType==='web' && watching.rows.length || watching.dirty || !snapshot?.nodes?.length && watching.rows.length);
  if(!useLive&&(!structuredSnapshot()||!snapshot||pageUrl(snapshot.url)!==legacy.snapshot.sourceUrl))return snapshot;
  const s=useLive ? {outline:watching.rows} : legacy.snapshot,items=new Map((s.outline||[]).map(r=>[r.id,{sectionId:'web:'+r.id,title:r.title,...outlineSourceDetails(r.text,r.textTruncated,r.title),level:r.level,children:[],paragraphs:[],paragraphCount:0,analysisSectionIds:[],...(useLive ? {unifiedLiveReference:{id:r.id,sourceUrl:watching.owner.url,documentToken:watching.documentToken}} : {unifiedWebReference:r})}])),nodes=[];
  for(const r of s.outline||[]){const node=items.get(r.id),parent=items.get(r.parentId);(parent?parent.children:nodes).push(node);}
  return {...(snapshot || {url:watching.owner.url,title:watching.title,documentId:watching.documentToken}),nodes};
 }
 function conversationStatus(){const filtered=filterOutline(typeof currentWorkspaceSnapshot==='undefined'?null:currentWorkspaceSnapshot);if(filtered&&$('articleNavigationStatus')){$('articleNavigationStatus').textContent=(filtered.reading?'阅读大纲':'滤镜大纲')+' · '+filtered.count+' 项'+(filtered.omitted?' · 另有 '+filtered.omitted+' 项未显示':'');return;}
  const watching=currentLive();if(watching?.kind==='conversation'&&watching.rows?.length&&$('articleNavigationStatus')){
   const count=watching.rows.filter(r=>r.role==='user'&&r.level===1).length;
   $('articleNavigationStatus').textContent='当前对话 · '+count+' 个提问 · 仅已加载内容';return;
  }
  if(structuredSnapshot()&&typeof currentWorkspaceSnapshot==='object'&&String(currentWorkspaceSnapshot?.url||'').split('#')[0]===legacy.snapshot.sourceUrl&&$('articleNavigationStatus'))$('articleNavigationStatus').textContent=legacy.snapshot.adapterStatus==='unrecognized'?'当前站点消息结构尚未识别':legacy.snapshot.outlineKind==='feed'?'当前动态 · '+legacy.snapshot.outline.filter(r=>r.level===1).length+' 条 · 仅已加载内容':'当前对话 · '+legacy.snapshot.outline.filter(r=>r.role==='user'&&r.level===1).length+' 个提问 · 仅已加载内容';}
 function conversationOutline(){
  if(!structuredSnapshot()||!currentWorkspaceSnapshot)return;
  renderArticleNavigationTree(currentWorkspaceSnapshot);conversationStatus();
  const s=legacy.snapshot;
  if(!filterOutline(currentWorkspaceSnapshot))lastPosition=s.currentId?'web:'+s.currentId:lastPosition;mark();
 }
 function renderLegacy(){
  if(!legacy?.saved)return;
  const value=legacy.saved.content;
  if(value.notes && !$('literatureNoteDrawer')?.querySelector('[data-unified-legacy]')){
   const box=card($('literatureNoteDrawer'),'已有网页笔记'),editor=document.createElement('textarea'),status=document.createElement('small');editor.value=value.notes;editor.setAttribute('aria-label','已有网页笔记');box.append(editor,status);
   const owner=legacy,ownerContext=current;let timer,chain=Promise.resolve(),savedValue=value.notes;
   const flush=()=>{clearTimeout(timer);const notes=editor.value;if(notes===savedValue)return;status.textContent='正在保存…';chain=chain.catch(()=>{}).then(async()=>{const r=await chrome.runtime.sendMessage({type:'BREVESS_WEB_READING',command:'SAVE',windowId:ownerContext.windowId,context:owner.context,notes,expectedNotes:savedValue,expectedRevision:owner.saved.revision});if(!r?.success)throw Error(r?.error||'保存失败');owner.saved=r.data.asset;savedValue=notes;status.textContent=r.data.sync?.state==='saved'?'已写入本地文件夹':'已暂存，待写入本地文件夹';}).catch(e=>{status.textContent=e.message;});};
   editor.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(flush,350);});editor.addEventListener('blur',flush);
  }
  if(value.annotations?.length&&!$('workspace-highlights')?.querySelector('[data-unified-legacy]')){
   const box=card($('workspace-highlights'),'已有网页高亮与备注');
   for(const a of value.annotations){const row=document.createElement('div'),button=document.createElement('button'),note=document.createElement('textarea'),status=document.createElement('small');button.type='button';button.className='btn btn-secondary';button.textContent=a.quote;const owner=legacy,ownerContext=current;button.onclick=()=>call('ANCHOR',{context:owner.context,anchor:a}).catch(e=>{status.textContent=e.message;});note.value=a.note||'';note.setAttribute('aria-label','已有网页原句备注');let timer,chain=Promise.resolve();const flush=()=>{clearTimeout(timer);const text=note.value;chain=chain.catch(()=>{}).then(async()=>{const prior=owner.saved.content.annotations||[],annotations=prior.map(item=>item.id===a.id?{...item,note:text}:item);status.textContent='正在保存…';const r=await chrome.runtime.sendMessage({type:'BREVESS_WEB_READING',command:'ANNOTATIONS',windowId:ownerContext.windowId,context:owner.context,annotations,expectedAnnotations:prior,expectedRevision:owner.saved.revision});if(!r?.success)throw Error(r?.error||'保存失败');owner.saved=r.data.asset;status.textContent=r.data.sync?.state==='saved'?'已写入本地文件夹':'已暂存，待写入本地文件夹';}).catch(e=>{status.textContent=e.message;});};note.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(flush,350);});note.addEventListener('blur',flush);row.append(button,note,status);box.append(row);}
  }
  const turns=(legacy.history?.items||[]).filter(t=>!globalThis.BrevessUnifiedComposer||t.mode!=='multi');
  if(turns.length&&!$('workspace-chat')?.querySelector('[data-unified-legacy]')){
   const box=card($('workspace-chat'),'已有网页问答');$('articleChatForm')?.before(box);
   for(const t of turns){const q=document.createElement('strong'),a=document.createElement('pre');q.textContent=t.question;a.textContent=t.answer||t.text||'回答未完成';box.append(q,a);}
  }
 }
 async function refresh(){
  if(typeof activePanelTabContext==='undefined')return;
  watch(activePanelTabContext);
  if(loading||!activePanelTabContext.activated)return;
  conversationStatus();
  const context=activePanelTabContext,key=context.key,documentKey=key+'|'+(typeof manualAnnotationState==='object'?manualAnnotationState.contentWorldNonce:'');if(current?.documentKey===documentKey){renderLegacy();if(currentLive()?.rows)return;conversationOutline();if(structuredSnapshot()&&Date.now()-outlineRefreshAt>3000){loading=true;outlineRefreshAt=Date.now();try{const r=await call('READ');if(current?.documentKey===documentKey&&!r.paper){legacy.snapshot=r.snapshot;legacy.context=r.context;conversationOutline();}}catch(_){}finally{loading=false;}}return;}
  const ticket=++epoch;loading=true;clearLegacy();lastPosition=null;mark();
  try{const tab=await chrome.tabs.get(context.tabId);if(ticket!==epoch||activePanelTabContext.key!==key)return;current={key,documentKey,tabId:tab.id,windowId:tab.windowId,url:tab.url};const result=await call('READ');if(activePanelTabContext.key!==key){current=null;return;}if(!result.paper){legacy=result;renderLegacy();conversationOutline();}}
  catch(_){current=null;}finally{loading=false;}
 }
 function locationError(e){if($('articleNavigationFocusStatus')){$('articleNavigationFocusStatus').hidden=false;$('articleNavigationFocusStatus').textContent=e.message;}}
 globalThis.BrevessUnifiedReading={watch,sameLoadedDocument,liveVersion,acceptVersion,liveLocate,projectOutline,locate:ref=>call('LOCATE',{context:legacy?.context,ref}).then(r=>{if(!r.found)throw Error(r.reason||'当前网页未找到原位置');}).catch(locationError),locateFilter:async(ref,sectionId)=>{const owner=documentOwner();try{if(!filterOutline(currentWorkspaceSnapshot))throw Error('滤镜大纲已更新，请重新选择');const r=await globalThis.BrevessUnifiedComposer?.locateOutline(ref);if(!r?.located)throw Error('当前网页未找到原位置');if(owner===documentOwner()&&filterOutline(currentWorkspaceSnapshot)){lastPosition=sectionId;mark();}}catch(e){locationError(e);}}};
 document.addEventListener('brevess:temporary-outline',event=>{const value=event.detail;if(value&&value.tabId!==activePanelTabContext?.tabId)return;const owner=documentOwner(),signature=owner+'|'+JSON.stringify(value);if(signature===temporarySignature)return;const snapshot=typeof currentWorkspaceSnapshot==='undefined'?null:currentWorkspaceSnapshot,wasFiltered=filterOutline(snapshot);if(!wasFiltered)preFilterStatus=$('articleNavigationStatus')?.textContent||'';temporarySignature=signature;temporaryOwner=owner;temporaryOutline=value;if(lastPosition?.startsWith('filter:'))lastPosition=null;if(snapshot){const projected=filterOutline(snapshot);if(projected?.reading)lastPosition=projected.currentSectionId;renderArticleNavigationTree(snapshot);if(wasFiltered&&!projected&&/^(滤镜|阅读)大纲/.test($('articleNavigationStatus')?.textContent||''))$('articleNavigationStatus').textContent=preFilterStatus;conversationStatus();mark();}});
 chrome.runtime.onMessage.addListener((m,s)=>{if(filterOutline(typeof currentWorkspaceSnapshot==='undefined'?null:currentWorkspaceSnapshot))return false;if(m?.type==='BREVESS_UNIFIED_READING_POSITION'&&!structuredSnapshot()&&s?.id===chrome.runtime.id&&s.tab?.id===activePanelTabContext?.tabId&&String(s.tab.url||'').split('#')[0]===String(m.url||'').split('#')[0]){lastPosition=m.sectionId;mark();}if(m?.type==='BREVESS_WEB_READING_EVENT'&&m.position&&structuredSnapshot()&&m.tabId===current?.tabId){lastPosition='web:'+m.currentId;legacy.snapshot.currentId=m.currentId;mark();}return false;});
 function init(){const tree=$('articleNavigationTree');if(tree)new MutationObserver(()=>{mark();conversationStatus();}).observe(tree,{childList:true,subtree:true});setInterval(refresh,900);void refresh();}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
