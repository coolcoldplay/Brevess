(function(){
 'use strict';
 function init(){
  const button=document.getElementById('openBrevessAccount');if(!button)return;
  const t=value=>globalThis.SciLLM?.translateInterfaceText?.(value)||value;
  let revision=0;
  async function refresh(){const current=++revision;try{const session=await globalThis.BrevessSharingClient.getSession();if(current!==revision)return;button.dataset.signedIn=String(!!session.user);button.title=t('账号与课题组')+(session.user?' · '+session.user.username:' · '+t('注册 / 登录'));button.setAttribute('aria-label',t('账号与课题组'));}catch{button.title=t('账号与课题组');}}
  button.addEventListener('click',event=>{if(event.isTrusted)void chrome.tabs.create({url:chrome.runtime.getURL('options.html#page=account')});});
  chrome.runtime.onMessage.addListener(message=>{if(message?.type==='BREVESS_SHARING_SESSION_CHANGED')void refresh();});
  globalThis.SciLLM?.onInterfaceLanguageChange?.(()=>void refresh());void refresh();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
