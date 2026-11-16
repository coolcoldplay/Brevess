(() => {
 'use strict';
 let owner='',signature='',binding='',boundNonce='',busy=false,reading=false,box=null,requested=false;const drafts=new Map();
 const context=()=>({tabId:activePanelTabContext?.tabId,url:activePanelTabContext?.url||'',nonce:manualAnnotationState?.contentWorldNonce||'',key:(activePanelTabContext?.key||'')+'|'+(manualAnnotationState?.contentWorldNonce||'')});
 const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
 function clear(){box?.remove();box=null;signature='';binding='';boundNonce='';drafts.clear();}
 async function send(c,extra){const r=await chrome.tabs.sendMessage(c.tabId,{type:'BREVESS_SAME_PAPER_SIDEBAR',url:c.url,...extra},{frameId:0});if(!r?.success)throw Error(r?.error||'批注暂不可用');return r.data;}
 async function refresh(){
  if(typeof activePanelTabContext==='undefined'||typeof manualAnnotationState==='undefined')return;
  const c=context();if(c.key!==owner){owner=c.key;clear();}
  if(busy||reading||!c.url||!Number.isInteger(c.tabId))return;
  const parent=document.getElementById('workspace-highlights');if(!parent)return;
  reading=true;
  try{const data=await send(c,{command:'READ'});if(context().key!==c.key||busy)return;
   if(binding&&binding!==data.binding)clear();binding=data.binding;boundNonce=data.contentWorldNonce;
   const next=JSON.stringify(data);if(next===signature)return;signature=next;
   if(!data.rows.length){clear();return;}
   const open=box?.open??true;box?.remove();box=node('details','');box.dataset.samePaperNotes='true';box.className='side-panel-result-card';box.open=open;
   box.append(node('summary','同篇文献批注 · '+data.rows.length));parent.append(box);
   for(const row of data.rows){
    const item=node('div','');item.className='workspace-highlight-entry';item.style.cssText='padding:10px 0;border-top:1px solid #ddd';
    item.append(node('small',row.local?'自动关联的本机批注':'关联的共享备注'),node('p',row.quote),node('p',row.text||'（空备注）'));
    const status=node('small',row.located?'已定位原文':row.reason||'当前页面未找到唯一位置');item.append(status);
    const action=(label,kind,value,token=row.token)=>{const button=node('button',label);button.type='button';button.className='btn btn-secondary';
     button.addEventListener('click',async event=>{if(!event.isTrusted||busy)return;busy=true;button.disabled=true;try{if(context().key!==c.key)throw Error('文献已变化');await send(c,{command:'ACTION',binding:data.binding,contentWorldNonce:data.contentWorldNonce,key:row.key,token,action:kind,...(value?{value:value()}: {})});if(kind==='edit')drafts.delete(row.key);status.textContent=kind==='edit'?'已保存原批注':'已完成';signature='';}catch(e){status.textContent=e.message;}finally{button.disabled=false;busy=false;void refresh();}});return button;};
    const locate=action('定位','locate');locate.disabled=!row.located;item.append(locate);
    if(row.local&&row.association==='active'){
     const editor=node('details',''),area=node('textarea','');editor.append(node('summary','编辑原批注'));area.setAttribute('aria-label','同篇文献原批注');area.style.cssText='width:100%;min-height:80px;font:inherit';
     const draft=drafts.get(row.key);area.value=draft?.value??row.text;area.addEventListener('input',()=>drafts.set(row.key,{value:area.value,token:draft?.token||row.token}));editor.open=!!draft;
     editor.append(area,action('保存原批注','edit',()=>area.value,draft?.token||row.token));item.append(editor);
    }else if(!row.local)item.append(action('评论','thread'));
    if(row.association)item.append(action(row.association==='active'?'停止跨原件显示':'恢复跨原件显示','association'));
    box.append(item);
   }
   if(requested){requested=false;box.open=true;box.scrollIntoView({block:'nearest'});}
  }catch(_){if(context().key!==c.key)clear();}finally{reading=false;}
 }
 chrome.runtime.onMessage.addListener((m,s)=>{
  if(m?.type!=='BREVESS_SAME_PAPER_REVEAL'||s?.id!==chrome.runtime.id)return false;
  const c=context();if(s.tab?.id!==c.tabId||m.contentWorldNonce!==boundNonce)return false;
  switchWorkspaceView('highlights');requested=true;signature='';void refresh();return false;
 });
 setInterval(refresh,1000);void refresh();
})();
