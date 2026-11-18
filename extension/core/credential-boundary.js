(function(root,factory){
  if(root.SciLLM?.credentialBoundaryVersion===1)return;
  const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;
  root.SciLLM=Object.assign(root.SciLLM||{},api);
})(globalThis,function(root){
  'use strict';
  const fail=()=>{throw Object.assign(new Error('CREDENTIAL_ACCESS_DENIED'),{code:'CREDENTIAL_ACCESS_DENIED'});};
  const sensitive=new Set(['MIGRATION_EXPORT','MIGRATION_IMPORT','LLM_SAVE_PROFILE','LLM_QUICK_SETUP_SAVE','LLM_CONNECT_AGENT','LLM_SAVE_PROVIDER','LLM_DUPLICATE_PROFILE','LLM_DELETE_PROFILE','LLM_TEST_PROFILE','LLM_TEST_PROVIDER','LLM_TEST_CONNECTION','LLM_DISCOVER_MODELS','LLM_LIST_MODELS']);
  function assertCredentialMessageOwner(message,sender,browser){
    if(!sensitive.has(message?.type)&&!String(message?.type||'').startsWith('PORTABLE_CONFIG_'))return;
    let url;try{url=new URL(sender?.url);}catch{fail();}
    if(sender.id!==browser.runtime.id||sender.frameId!==0||url.origin!==new URL(browser.runtime.getURL('')).origin||
      url.protocol!=='chrome-extension:'||url.host!==browser.runtime.id||url.pathname!=='/options.html'||url.username||url.password)fail();
  }
  function restrictCredentialStorage(browser){
    if(typeof browser.storage.local.setAccessLevel!=='function')return Promise.reject(Object.assign(new Error('CREDENTIAL_STORAGE_UNAVAILABLE'),{code:'CREDENTIAL_STORAGE_UNAVAILABLE'}));
    return browser.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  }
  const tools=value=>Object.fromEntries(['semantic','selection','pageTranslation'].map(k=>[k,typeof value?.[k]==='boolean'?value[k]:true]));
  function validPageKey(key,sender,browser,write){
    if(sender?.id!==browser.runtime.id||!Number.isInteger(sender.tab?.id)||sender.frameId!==0)fail();
    let page;try{page=new URL(sender.url);}catch{fail();}
    if(!['https:','http:','file:'].includes(page.protocol))fail();
    if(key==='sciPageToolsV1'){if(write)fail();return 'tools';}
    if(key==='sciFigureMagnifierPreferencesV1')return 'magnifier';
    if(typeof key==='string'&&key.startsWith('sciFigureOriginalDisplayV1:')){
      let target;try{target=new URL(key.slice('sciFigureOriginalDisplayV1:'.length));}catch{fail();}
      if(target.origin!==page.origin||target.pathname!==page.pathname||target.username||target.password)fail();return 'display';
    }
    fail();
  }
  function sanitizePreference(kind,value){
    if(kind==='tools')return tools(value);
    if(kind==='magnifier')return {zoom:Math.max(1.25,Math.min(8,Number(value?.zoom)||2.5)),diameter:Math.max(100,Math.min(500,Number(value?.diameter)||200))};
    if(!Array.isArray(value))return [];
    return value.slice(-128).filter(x=>x&&/^[a-f0-9]{64}$/.test(x.sha256||'')).map(x=>Object.fromEntries(
      ['figureId','imageIndex','sourceIdentity','documentHash','pageUrl','cacheKey','sha256','byteLength','pixelWidth','pixelHeight']
      .filter(k=>['string','number'].includes(typeof x[k])).map(k=>[k,typeof x[k]==='string'?x[k].slice(0,20000):x[k]])));
  }
  async function handlePublicPageStorage(message,sender,browser){
    if(!['get','set'].includes(message.method))fail();
    const kind=validPageKey(message.key,sender,browser,message.method==='set');
    if(message.method==='get'){const stored=await browser.storage.local.get(message.key);return {[message.key]:sanitizePreference(kind,stored[message.key])};}
    const value=sanitizePreference(kind,message.value);
    if(kind==='display'&&value.some(x=>x.pageUrl!==message.key.slice('sciFigureOriginalDisplayV1:'.length)))fail();
    await browser.storage.local.set({[message.key]:value});return {};
  }
  const publicPageStorage={
    async get(key){
      if(root.location?.protocol==='chrome-extension:'||!root.chrome?.runtime?.sendMessage)return root.chrome?.storage?.local?.get(key);
      const r=await root.chrome.runtime.sendMessage({type:'BREVESS_PUBLIC_PAGE_STORAGE',method:'get',key});if(!r?.success)fail();return r.data;
    },
    async set(value){
      if(root.location?.protocol==='chrome-extension:'||!root.chrome?.runtime?.sendMessage)return root.chrome?.storage?.local?.set(value);
      const keys=Object.keys(value);if(keys.length!==1)fail();const key=keys[0];
      const r=await root.chrome.runtime.sendMessage({type:'BREVESS_PUBLIC_PAGE_STORAGE',method:'set',key,value:value[key]});if(!r?.success)fail();
    }
  };
  const listeners=new Set();
  function onPublicPreferencesChanged(fn){
    if(root.location?.protocol==='chrome-extension:'){root.chrome.storage.onChanged.addListener(fn);return ()=>root.chrome.storage.onChanged.removeListener(fn);}
    listeners.add(fn);return ()=>listeners.delete(fn);
  }
  if(root.document&&root.chrome?.runtime?.onMessage)root.chrome.runtime.onMessage.addListener((m,s)=>{
    if(m?.type==='BREVESS_PUBLIC_PREFERENCES_CHANGED'&&s.id===root.chrome.runtime.id)for(const fn of listeners)fn(m.changes,'local');
  });
  function installCredentialBoundary(browser){
    const ready=restrictCredentialStorage(browser);ready.catch(()=>{});
    browser.runtime.onMessage.addListener((m,s,reply)=>{
      if(m?.type!=='BREVESS_PUBLIC_PAGE_STORAGE')return false;
      ready.then(()=>handlePublicPageStorage(m,s,browser)).then(data=>reply({success:true,data}),()=>reply({success:false,error:{code:'CREDENTIAL_ACCESS_DENIED'}}));return true;
    });
    browser.storage.onChanged.addListener((changes,area)=>{
      if(area!=='local')return;const safe={};
      if(changes.sciPageToolsV1)safe.sciPageToolsV1={newValue:tools(changes.sciPageToolsV1.newValue)};
      if(changes.sciLlmSettingsV2)safe.sciLlmSettingsV2={newValue:{language:String(changes.sciLlmSettingsV2.newValue?.language||'zh-CN')}};
      if(!Object.keys(safe).length)return;
      void browser.tabs.query({}).then(tabs=>Promise.allSettled(tabs.filter(t=>Number.isInteger(t.id)&&/^(https?|file):/.test(t.url||'')).map(t=>browser.tabs.sendMessage(t.id,{type:'BREVESS_PUBLIC_PREFERENCES_CHANGED',changes:safe})))).catch(()=>{});
    });
    return ready;
  }
  return {credentialBoundaryVersion:1,assertCredentialMessageOwner,restrictCredentialStorage,handlePublicPageStorage,publicPageStorage,onPublicPreferencesChanged,installCredentialBoundary};
});
