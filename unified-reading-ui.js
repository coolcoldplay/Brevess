(() => {
 'use strict';
 // A small bridge augments the original workspace, never creates a second one.
 const $=id=>document.getElementById(id);
 let current=null,epoch=0,lastPosition=null,legacy=null,loading=false,outlineRefreshAt=0,temporaryOutline=null,temporaryOwner='',temporarySignature='',preFilterStatus='';
 const styles=document.createElement('style');
 styles.textContent='#articleNavigationTree .workspace-tree-jump[aria-current="location"]{background:#eef5f8;color:#215c80;border-radius:4px}.unified-legacy{margin:10px 0}.unified-legacy textarea{width:100%;min-height:100px;font:inherit}.unified-legacy pre{white-space:pre-wrap;overflow-wrap:anywhere}';
 document.head.append(styles);
 function mark(){for(const el of $('articleNavigationTree')?.querySelectorAll('[data-reading-section-id]')||[]){if(el.dataset.readingSectionId===lastPosition)el.setAttribute('aria-current','location');else el.removeAttribute('aria-current');}}
 function clearLegacy(){for(const el of document.querySelectorAll('[data-unified-legacy]'))el.remove();legacy=null;}
 function call(command,extra={}){return chrome.runtime.sendMessage({type:'BREVESS_WEB_READING',command,windowId:current.windowId,...extra}).then(r=>{if(!r?.success)throw Error(r?.error||'网页记录读取失败');return r.data;});}
 function card(parent,title){const box=document.createElement('details');box.className='side-panel-result-card unified-legacy';box.dataset.unifiedLegacy='true';const summary=document.createElement('summary');summary.textContent=title;box.append(summary);parent?.append(box);return box;}
 function documentOwner(){return typeof activePanelTabContext==='undefined'?'':activePanelTabContext.key+'|'+(typeof manualAnnotationState==='object'?manualAnnotationState.contentWorldNonce:'');}
 function outlineSourceDetails(value,truncated=false){
  if(typeof value!=='string'||!value.trim())return {};
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
   const node={sectionId:'filter:'+JSON.stringify([ref.tabId,ref.frameId,ref.session,group.operation,item.id]),title:item.title,searchTitleFontSize:item.searchTitleFontSize,searchPublication:item.searchPublication,...outlineSourceDetails(item.fullText,item.textTruncated===true||String(item.fullText||'').length>=2400),level,children:[],paragraphs:[],paragraphCount:0,analysisSectionIds:[],unifiedFilterReference:ref};
   if(frame.currentId===item.id)currentSectionId=node.sectionId;
   while(stack.length&&stack.at(-1).level>=level)stack.pop();(stack.length?stack.at(-1).children:nodes).push(node);stack.push(node);count++;
  }}}
  return {nodes,count,omitted,currentSectionId,reading:value.provider==='reading-module'&&!value.temporary};
 }
 function structuredSnapshot(){return legacy?.snapshot?.kind==='conversation'||legacy?.snapshot?.outlineKind==='feed';}
 function projectOutline(snapshot){
  const filtered=filterOutline(snapshot);if(filtered)return {...snapshot,nodes:filtered.nodes};
  if(!structuredSnapshot()||!snapshot||String(snapshot.url||'').split('#')[0]!==legacy.snapshot.sourceUrl)return snapshot;
  const s=legacy.snapshot,items=new Map((s.outline||[]).map(r=>[r.id,{sectionId:'web:'+r.id,title:r.title,...outlineSourceDetails(r.text,r.textTruncated),level:r.level,children:[],paragraphs:[],paragraphCount:0,analysisSectionIds:[],unifiedWebReference:r}])),nodes=[];
  for(const r of s.outline||[]){const node=items.get(r.id),parent=items.get(r.parentId);(parent?parent.children:nodes).push(node);}
  return {...snapshot,nodes};
 }
 function conversationStatus(){const filtered=filterOutline(typeof currentWorkspaceSnapshot==='undefined'?null:currentWorkspaceSnapshot);if(filtered&&$('articleNavigationStatus')){$('articleNavigationStatus').textContent=(filtered.reading?'阅读大纲':'滤镜大纲')+' · '+filtered.count+' 项'+(filtered.omitted?' · 另有 '+filtered.omitted+' 项未显示':'');return;}if(structuredSnapshot()&&typeof currentWorkspaceSnapshot==='object'&&String(currentWorkspaceSnapshot?.url||'').split('#')[0]===legacy.snapshot.sourceUrl&&$('articleNavigationStatus'))$('articleNavigationStatus').textContent=legacy.snapshot.adapterStatus==='unrecognized'?'当前站点消息结构尚未识别':legacy.snapshot.outlineKind==='feed'?'当前动态 · '+legacy.snapshot.outline.filter(r=>r.level===1).length+' 条 · 仅已加载内容':'当前对话 · '+legacy.snapshot.outline.filter(r=>r.role==='user'&&r.level===1).length+' 个提问 · 仅已加载内容';}
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
  if(loading||typeof activePanelTabContext==='undefined'||!activePanelTabContext.activated)return;
  conversationStatus();
  const context=activePanelTabContext,key=context.key,documentKey=key+'|'+(typeof manualAnnotationState==='object'?manualAnnotationState.contentWorldNonce:'');if(current?.documentKey===documentKey){renderLegacy();conversationOutline();if(structuredSnapshot()&&Date.now()-outlineRefreshAt>3000){loading=true;outlineRefreshAt=Date.now();try{const r=await call('READ');if(current?.documentKey===documentKey&&!r.paper){legacy.snapshot=r.snapshot;legacy.context=r.context;conversationOutline();}}catch(_){}finally{loading=false;}}return;}
  const ticket=++epoch;loading=true;clearLegacy();lastPosition=null;mark();
  try{const tab=await chrome.tabs.get(context.tabId);if(ticket!==epoch||activePanelTabContext.key!==key)return;current={key,documentKey,tabId:tab.id,windowId:tab.windowId,url:tab.url};const result=await call('READ');if(activePanelTabContext.key!==key){current=null;return;}if(!result.paper){legacy=result;renderLegacy();conversationOutline();}}
  catch(_){current=null;}finally{loading=false;}
 }
 function locationError(e){if($('articleNavigationFocusStatus')){$('articleNavigationFocusStatus').hidden=false;$('articleNavigationFocusStatus').textContent=e.message;}}
 globalThis.BrevessUnifiedReading={projectOutline,locate:ref=>call('LOCATE',{context:legacy?.context,ref}).then(r=>{if(!r.found)throw Error(r.reason||'当前网页未找到原位置');}).catch(locationError),locateFilter:async(ref,sectionId)=>{const owner=documentOwner();try{if(!filterOutline(currentWorkspaceSnapshot))throw Error('滤镜大纲已更新，请重新选择');const r=await globalThis.BrevessUnifiedComposer?.locateOutline(ref);if(!r?.located)throw Error('当前网页未找到原位置');if(owner===documentOwner()&&filterOutline(currentWorkspaceSnapshot)){lastPosition=sectionId;mark();}}catch(e){locationError(e);}}};
 document.addEventListener('brevess:temporary-outline',event=>{const value=event.detail;if(value&&value.tabId!==activePanelTabContext?.tabId)return;const owner=documentOwner(),signature=owner+'|'+JSON.stringify(value);if(signature===temporarySignature)return;const snapshot=typeof currentWorkspaceSnapshot==='undefined'?null:currentWorkspaceSnapshot,wasFiltered=filterOutline(snapshot);if(!wasFiltered)preFilterStatus=$('articleNavigationStatus')?.textContent||'';temporarySignature=signature;temporaryOwner=owner;temporaryOutline=value;if(lastPosition?.startsWith('filter:'))lastPosition=null;if(snapshot){const projected=filterOutline(snapshot);if(projected?.reading)lastPosition=projected.currentSectionId;renderArticleNavigationTree(snapshot);if(wasFiltered&&!projected&&/^(滤镜|阅读)大纲/.test($('articleNavigationStatus')?.textContent||''))$('articleNavigationStatus').textContent=preFilterStatus;conversationStatus();mark();}});
 chrome.runtime.onMessage.addListener((m,s)=>{if(filterOutline(typeof currentWorkspaceSnapshot==='undefined'?null:currentWorkspaceSnapshot))return false;if(m?.type==='BREVESS_UNIFIED_READING_POSITION'&&!structuredSnapshot()&&s?.id===chrome.runtime.id&&s.tab?.id===activePanelTabContext?.tabId&&String(s.tab.url||'').split('#')[0]===String(m.url||'').split('#')[0]){lastPosition=m.sectionId;mark();}if(m?.type==='BREVESS_WEB_READING_EVENT'&&m.position&&structuredSnapshot()&&m.tabId===current?.tabId){lastPosition='web:'+m.currentId;legacy.snapshot.currentId=m.currentId;mark();}return false;});
 function init(){const tree=$('articleNavigationTree');if(tree)new MutationObserver(()=>{mark();conversationStatus();}).observe(tree,{childList:true,subtree:true});setInterval(refresh,900);void refresh();}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
