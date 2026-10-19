(async function(){
  'use strict';
  const state=document.getElementById('actionAccountState'),name=document.getElementById('actionAccountName'),open=document.getElementById('actionAccountOpen');
  const client=globalThis.BrevessSharingClient,T=text=>globalThis.SciLLM?.translateInterfaceText?.(text)||text;
  let revision=0;
  function render(label,user,button){state.textContent=T(label);name.textContent=user?.username||'';name.title=name.textContent;name.hidden=!user;open.title=T(button);open.setAttribute('aria-label',T(button));}
  async function refresh(){
    const current=++revision;let session;
    render('正在核验登录状态…',null,'账号管理');
    try{
      session=await client.getSession();if(current!==revision)return;
      if(!session.user){render('未登录',null,'登录 / 注册');return;}
      const me=await client.api('/api/me','GET',undefined,{endpoint:session.endpoint,userId:session.user.id});
      if(current===revision)render('已登录',me.user,'账号管理');
    }catch(error){
      if(current!==revision)return;
      if(error.status===401||error.code==='ACCOUNT_CHANGED')render('请重新登录',null,'登录 / 注册');
      else render('暂时无法核验登录状态',session?.user,'账号管理');
    }
  }
  open.addEventListener('click',event=>{if(event.isTrusted)void chrome.tabs.create({url:chrome.runtime.getURL('options.html#page=account')}).then(()=>window.close());});
  chrome.runtime.onMessage.addListener(message=>{if(message?.type==='BREVESS_SHARING_SESSION_CHANGED')void refresh();});
  globalThis.SciLLM?.onInterfaceLanguageChange?.(()=>void refresh());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  await globalThis.SciLLM?.bootstrapInterfaceLanguage?.();await refresh();
})();
