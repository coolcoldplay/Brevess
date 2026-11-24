(function(){
 'use strict';const notice=document.getElementById('r20-agent-status'),retry=document.createElement('button');retry.textContent='重新连接';retry.className='agent-reconnect';notice.after(retry);let container=null,permissionUnsub=null,port=null,binding=null,seq=0,panel=null,retries=0,closed=false,bindTimer=null,sidebarWindowId=null,reconnectTimer=null;const pending=new Map();
 const reasons={WORKBENCH_AGENT_HOST_UNAVAILABLE:'请保持课题工作台标签页打开。工作台加载完成后即可连接。',WORKBENCH_AGENT_DOCUMENT_EXPIRED:'工作台已重新加载，正在重新绑定。',WORKBENCH_AGENT_BINDING_EXPIRED:'当前工作台已变化，请重新连接。',WORKBENCH_AGENT_PROJECT_CHANGED:'已切换课题，请在新课题中继续。',WORKBENCH_AGENT_SOURCE_CLOSED:'工作台已关闭，请重新打开课题工作台。',WORKBENCH_AGENT_DISCONNECTED:'与工作台的连接已断开。',WORKBENCH_AGENT_STATUS_UNCONFIRMED:'工作台暂时没有响应，请重新连接。',WORKBENCH_AGENT_ALREADY_OPEN:'这个工作台已在另一个 Agent 侧栏中打开。',WORKBENCH_AGENT_SIDEBAR_INVALID:'侧栏身份未能确认，请关闭侧栏后从工作台重新打开。'};
 const failure=code=>Object.assign(new Error(reasons[code]||'连接未完成，请检查服务设置后重试。'),{code});
 function scheduleRetry(callback){
   clearTimeout(reconnectTimer);
   if(closed||document.hidden)return;
   reconnectTimer=setTimeout(callback,Math.min(250*2**Math.min(retries++,5),8000));
 }
 function scheduleBind(current){
   if(!binding&&port===current)scheduleRetry(()=>{if(!binding&&port===current)bind()});
 }
 function reset(error=failure('WORKBENCH_AGENT_BINDING_EXPIRED')){
   clearTimeout(bindTimer);binding=null;
   for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();
   if(container){container.inert=true;container.hidden=true;}
   notice.hidden=false;retry.hidden=false;notice.textContent=error.message;
 }
 function lost(current){
   if(port!==current||closed)return;
   port=null;reset(failure('WORKBENCH_AGENT_DISCONNECTED'));
   notice.textContent='正在重新连接课题工作台…';
   scheduleRetry(connect);
 }
 function bind(){
   if(!port||closed)return;
   clearTimeout(bindTimer);const current=port;
   bindTimer=setTimeout(()=>{if(port===current&&!binding){reset(failure('WORKBENCH_AGENT_STATUS_UNCONFIRMED'));scheduleBind(current);}},15000);
   try{current.postMessage({type:'bind'});}catch{lost(current);}
 }
 function request(method,args={}){
   if(!binding)return Promise.reject(failure('WORKBENCH_AGENT_BINDING_EXPIRED'));
   const current=++seq;
   return new Promise((resolve,reject)=>{
     const entry={resolve,reject,method,task:method==='start'?args.task:null};
     entry.renew=()=>{clearTimeout(entry.timer);entry.timer=setTimeout(()=>{
       if(!pending.delete(current))return;
       if(method==='start')void request('cancel').catch(()=>{});
       reject(failure('WORKBENCH_AGENT_STATUS_UNCONFIRMED'));
     },method==='start'?330000:25000);};
     pending.set(current,entry);entry.renew();
     try{port.postMessage({type:'request',bindingId:binding.bindingId,projectId:binding.projectId,seq:current,method,args});}
     catch{clearTimeout(entry.timer);pending.delete(current);reject(failure('WORKBENCH_AGENT_DISCONNECTED'));}
   });
 }
 function mount(message){clearTimeout(bindTimer);clearTimeout(reconnectTimer);if(binding?.bindingId===message.bindingId&&!container?.hidden)return;const draft=container?.dataset.project===String(message.projectId)?container.querySelector('[data-agent-task]')?.value||'':'',provider=container?.querySelector('[data-agent-provider]')?.value;panel?.destroy?.();sidebarWindowId=message.windowId;binding=message;retries=0;seq=message.lastSeq||0;permissionUnsub?.();container?.remove();container=document.createElement('section');container.id='agent-panel';container.dataset.project=String(message.projectId);container.className='agent-panel';document.body.append(container);panel=Workbench.createAgentPanel({container,docked:true,surface:message.projectId==='settings:assistant'?'settings':'workbench',connect:(providerId,model)=>request('connect',{providerId,model}),conversations:args=>request('conversations',args),start:args=>request('start',{task:args.task,providerId:args.providerId,model:args.model,reasoningEffort:args.reasoningEffort,threadId:args.threadId}),cancel:()=>void request('cancel').catch(()=>{}),onStatus:text=>{notice.textContent=text}});container.querySelector('[data-agent-context]').textContent=message.label||'课题工作台';if(provider)container.querySelector('[data-agent-provider]').value=provider;container.querySelector('[data-agent-task]').value=draft;
  const permissions=Workbench.agentPermissions,bar=document.createElement('div');bar.className='r20-agent-permissions';const status=document.createElement('p');status.className='r20-agent-permission-status';status.setAttribute('role','status');const render=()=>{for(const b of bar.children)b.setAttribute('aria-pressed',String(permissions.snapshot()[b.dataset.permission]));};
  for(const [key,label]of [['read','读取'],['modify','修改'],['delete','删除']]){const b=document.createElement('button');b.type='button';b.dataset.permission=key;b.textContent=label;b.onclick=async event=>{if(!event.isTrusted)return;const wanted=!permissions.snapshot()[key];for(const button of bar.children)button.disabled=true;try{await permissions.set(key,wanted,true);status.textContent='权限已在本机保存，可随时取消。';}catch{status.textContent='权限保存失败；未开放操作权限。';}finally{for(const button of bar.children)button.disabled=false;render();}};bar.append(b);}
  permissionUnsub=permissions.subscribe(render);void permissions.refresh().then(render).catch(()=>{status.textContent='权限读取失败，当前权限关闭。'});container.querySelector('[data-agent-permissions]').append(bar,status);
  for(const task of message.history||[])panel.replay(task);
  container.querySelector('[data-agent-close]').onclick=()=>window.close();notice.hidden=true;retry.hidden=true;panel.open();container.hidden=false;
 }
 function connect(){if(closed)return;clearTimeout(reconnectTimer);const previous=port;port=null;previous?.disconnect();notice.textContent='正在连接课题工作台…';retry.hidden=true;let current;try{current=port=chrome.runtime.connect({name:'r20-agent-sidebar'});}catch{reset(failure('WORKBENCH_AGENT_DISCONNECTED'));scheduleRetry(connect);return;}current.onMessage.addListener(message=>{if(port!==current||closed)return;if(message.type==='host_ready'){if(!binding)bind();}else if(message.type==='bound')mount(message);else if(message.type==='event'&&message.bindingId===binding?.bindingId&&pending.get(message.seq)?.method==='start'){pending.get(message.seq).renew();panel?.event(message.event);}else if(message.type==='response'){if(message.bindingId!==binding?.bindingId)return;const p=pending.get(message.seq);if(!p)return;pending.delete(message.seq);clearTimeout(p.timer);if(message.error){
    const issue=failure(message.error.code);p.reject(issue);
    if(['WORKBENCH_AGENT_BINDING_EXPIRED','WORKBENCH_AGENT_DOCUMENT_EXPIRED'].includes(message.error.code)){
      const input=container?.querySelector('[data-agent-task]');if(p.task&&input&&!input.value)input.value=p.task;
      reset(issue);scheduleBind(current);
    }
  }else p.resolve(message.result);}else if(message.type==='binding_lost'){reset(failure(message.error?.code));scheduleBind(current);}else if(message.type==='error'){reset(failure(message.error?.code));if(['WORKBENCH_AGENT_HOST_UNAVAILABLE','WORKBENCH_AGENT_DOCUMENT_EXPIRED'].includes(message.error?.code))scheduleBind(current);}});current.onDisconnect.addListener(()=>{void chrome.runtime.lastError;lost(current);});bind();}
 const resume=()=>{if(closed||document.hidden)return;retries=0;if(!port)connect();else if(!binding)bind();};
 document.addEventListener('visibilitychange',resume);
 window.addEventListener('online',resume);
 const heartbeat=setInterval(()=>{if(!document.hidden&&port&&binding){try{port.postMessage({type:'keepalive'});}catch{lost(port);}}},20000);
 retry.onclick=()=>{retries=0;connect()};chrome.tabs.onActivated.addListener(info=>{if(!closed&&Number.isInteger(sidebarWindowId)&&info.windowId===sidebarWindowId&&info.tabId!==binding?.tabId){retries=0;reset();bind()}});chrome.tabs.onUpdated.addListener((id,change,tab)=>{if(closed||tab?.windowId!==sidebarWindowId)return;
   if(change.status==='loading'&&binding?.tabId===id)reset(failure('WORKBENCH_AGENT_DOCUMENT_EXPIRED'));
   if(change.status==='complete'&&tab.active&&!binding)bind();});window.addEventListener('pagehide',()=>{closed=true;clearInterval(heartbeat);clearTimeout(reconnectTimer);reset();permissionUnsub?.();panel?.destroy?.();port?.disconnect()},{once:true});connect();
})();
