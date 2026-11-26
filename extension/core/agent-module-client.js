// A real workbench registers its existing host. This page never owns pairing UI.
(function(){'use strict';if(!globalThis.chrome?.runtime?.id)return;let port,closed=false,loadPromise=null,generation=0,stopRequested=false;
 const sanitized=()=>{const value=globalThis.BrevessMcpBridge?.status();return{state:value?.state||'unpaired',activeRequests:value?.activeRequests||[]};};
 function send(message){try{port?.postMessage(message);}catch{}}
 function firstConnection(bridge){return new Promise(resolve=>{let timer;const finish=()=>{const state=bridge.status().state;if(['unpaired','connecting'].includes(state))return;clearTimeout(timer);window.removeEventListener('brevess:mcp-status',finish);resolve();};window.addEventListener('brevess:mcp-status',finish);timer=setTimeout(()=>{window.removeEventListener('brevess:mcp-status',finish);resolve();},40000);finish();});}
 function loadBridge(){
  if(loadPromise)return loadPromise;
  if(globalThis.BrevessMcpBridge)return Promise.resolve(globalThis.BrevessMcpBridge);
  const pending=Promise.resolve().then(()=>globalThis.ensureBrevessMcpBridge());loadPromise=pending;
  pending.then(()=>{if(loadPromise===pending)loadPromise=null;},()=>{if(loadPromise===pending)loadPromise=null;});return pending;
 }
 async function stopTransport(){
  // The core script auto-connects when evaluated. Its pending load must settle
  // before disconnect can invalidate that core connection attempt and reply.
  const pending=loadPromise;if(pending)try{await pending;}catch{}
  const bridge=globalThis.BrevessMcpBridge;await bridge?.disconnect();
  const state=bridge?.status();if(state?.connected===true||['connecting','connected'].includes(state?.state)||state?.activeRequests?.length)throw Error('AGENT_DISCONNECT_UNCONFIRMED');
  try{await globalThis.BrevessWorkbenchMCP?.revokeWriteScope({});}catch(error){
   // A newly opened paused page has no task runtime or target scope yet.
   // Existing runtimes and every other revocation failure still reject stop.
   if(error?.code!=='WORKBENCH_HOST_NOT_READY'||globalThis.__workbenchRuntime)throw error;
  }
 }
 function register(){if(closed)return;try{port=chrome.runtime.connect({name:'brevess-agent-module-v1'});}catch{return;}
  port.onMessage.addListener(async message=>{if(message?.type!=='command'||!['connect','check','disconnect'].includes(message.action))return;const current=++generation;stopRequested=message.action==='disconnect';try{
   if(stopRequested)await stopTransport();
   else{const existing=globalThis.BrevessMcpBridge,bridge=await loadBridge();if(current!==generation||stopRequested||closed)throw Error('CANCELLED');if(message.action==='check')await bridge.probe();else if(existing&&bridge.status().state==='connected'){}else if(existing)await bridge.connect();else await firstConnection(bridge);}
   if(current!==generation||closed)throw Error('CANCELLED');
   send({type:'receipt',id:message.id,ok:true,status:sanitized()});
  }catch{send({type:'receipt',id:message.id,ok:false,status:sanitized()});}});
  port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;++generation;stopRequested=true;void stopTransport().catch(()=>{}).finally(()=>{if(!closed)setTimeout(register,300);});});send({type:'status',status:sanitized()});
 }
 window.addEventListener('brevess:mcp-status',()=>send({type:'status',status:sanitized()}));window.addEventListener('pagehide',()=>{closed=true;port?.disconnect();},{once:true});register();
})();
