(function(root){
 'use strict';
 const CONFIG='brevess-mcp-bridge-v1',PAUSED='brevess-mcp-paused-v1',TYPE='BREVESS_AGENT_MANAGER',PORT='brevess-agent-module-v1';
 const states=new Set(['connected','connecting','offline','unauthorized','incompatible','unpaired']);
 const failure=code=>Object.assign(new Error(code),{code});
 function createAgentConnectionManager(api,{timeoutMs=45000}={}){
  const modules=new Map();let busy=false,sequence=0,epoch=0,lastError='';
  const local=api.storage.local;
  function path(sender){try{const u=new URL(sender?.url||''),own=new URL(api.runtime.getURL(''));return sender.id===api.runtime.id&&u.protocol===own.protocol&&u.host===own.host?u.pathname:null;}catch{return null;}}
  const clean=value=>({state:states.has(value?.state)?value.state:'unknown',activeRequests:Array.isArray(value?.activeRequests)?value.activeRequests.length:0});
  async function stored(){return local.get([CONFIG,PAUSED]);}
  async function status(){const data=await stored(),rows=[...modules.values()].map(m=>m.status),configured=!!data[CONFIG],stopping=[...modules.values()].some(m=>[...m.pending.values()].some(p=>p.action==='disconnect')),live=rows.some(r=>['connected','connecting'].includes(r.state)||r.activeRequests>0),error=lastError||(data[PAUSED]===true&&live&&!stopping?'AGENT_DISCONNECT_UNCONFIRMED':null);let state=stopping?'disconnecting':!configured?'unpaired':data[PAUSED]===true?'paused':!rows.length?'waiting':rows.length>1?'multiple':rows[0].state;
   if(error)state='error';return{state,configured,paused:data[PAUSED]===true,modules:rows.length,activeRequests:rows.reduce((n,r)=>n+r.activeRequests,0),error};}
  function command(module,action){return new Promise((resolve,reject)=>{const id='manager-'+(++sequence),timer=setTimeout(()=>{module.pending.delete(id);reject(failure('AGENT_MANAGER_TIMEOUT'));},timeoutMs);module.pending.set(id,{action,resolve:message=>{clearTimeout(timer);resolve(message);},reject:error=>{clearTimeout(timer);reject(error);}});try{module.port.postMessage({type:'command',id,action});}catch{module.pending.get(id).reject(failure('AGENT_MODULE_CLOSED'));module.pending.delete(id);}});}
  async function allDisconnect(){const results=await Promise.allSettled([...modules.values()].map(m=>command(m,'disconnect')));if(results.some(r=>r.status==='rejected'))throw failure('AGENT_DISCONNECT_UNCONFIRMED');}
  async function connectOne(){if(modules.size!==1)return;const module=[...modules.values()][0];await command(module,'connect');}
  function normalize(config){let url;try{url=new URL(config?.server);}catch{throw failure('MCP_BRIDGE_CONFIG_INVALID');}if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||typeof config.token!=='string'||!config.token||config.token.length>512||/[\s\u0000-\u001f]/u.test(config.token))throw failure('MCP_BRIDGE_CONFIG_INVALID');return{server:url.origin,token:config.token};}
  async function handle(message,sender){
   if(message?.type!==TYPE)return undefined;
   if(!path(sender))throw failure('AGENT_MANAGER_FORBIDDEN');
   const action=message.action;if(action==='status')return status();
   if(path(sender)!=='/options.html')throw failure('AGENT_MANAGER_FORBIDDEN');
   if(!['pair','check','resume','disconnect','forget'].includes(action))throw failure('AGENT_MANAGER_ACTION_INVALID');
   if(busy)throw failure('AGENT_CONNECTION_BUSY');busy=true;epoch++;lastError='';
   try{
    if(action==='pair'){const config=normalize(message.config);await allDisconnect();await local.set({[CONFIG]:config,[PAUSED]:false});await connectOne();}
    else if(action==='disconnect'||action==='forget'){await local.set({[PAUSED]:true});await allDisconnect();if(action==='forget')await local.remove(CONFIG);}
    else if(action==='resume'){await local.set({[PAUSED]:false});await connectOne();}
    else if(action==='check'){const data=await stored();if(data[CONFIG]&&data[PAUSED]!==true&&modules.size===1){const module=[...modules.values()][0];if(module.status.state!=='connecting')await command(module,module.status.state==='connected'?'check':'connect');}}
    return status();
   }catch(error){lastError=['AGENT_MANAGER_TIMEOUT','AGENT_MODULE_CLOSED','AGENT_DISCONNECT_UNCONFIRMED','MCP_BRIDGE_CONFIG_INVALID'].includes(error?.code)?error.code:'AGENT_CONNECTION_FAILED';throw failure(lastError);}finally{busy=false;}
  }
  function onConnect(port){if(port?.name!==PORT)return false;if(path(port.sender)!=='/workbench/index.html'){port.disconnect();return true;}
   const module={port,status:{state:'unknown',activeRequests:0},pending:new Map()};modules.set(port,module);
   port.onMessage.addListener(message=>{if(message?.type==='status')module.status=clean(message.status);else if(message?.type==='receipt'){const pending=module.pending.get(message.id);if(!pending)return;module.pending.delete(message.id);module.status=clean(message.status);if(pending.action==='disconnect'&&(['connected','connecting','unknown'].includes(module.status.state)||module.status.activeRequests>0))pending.reject(failure('AGENT_DISCONNECT_UNCONFIRMED'));else if(message.ok===true)pending.resolve(module.status);else pending.reject(failure('AGENT_CONNECTION_FAILED'));}});
   port.onDisconnect.addListener(()=>{modules.delete(port);for(const pending of module.pending.values())pending.reject(failure('AGENT_MODULE_CLOSED'));module.pending.clear();});
   const observedEpoch=epoch;void stored().then(async data=>{if(busy||observedEpoch!==epoch)return;if(data[PAUSED]===true||modules.size!==1){await command(module,'disconnect');return;}if(data[CONFIG])await command(module,'connect');}).catch(()=>{if(observedEpoch===epoch)lastError='AGENT_CONNECTION_FAILED';});return true;
  }
  function onMessage(message,sender,respond){if(message?.type!==TYPE)return false;void handle(message,sender).then(data=>respond({success:true,data}),error=>respond({success:false,error:{code:error.code||'AGENT_CONNECTION_FAILED'}}));return true;}
  return{handle,status,onConnect,onMessage};
 }
 const exported={createAgentConnectionManager,AGENT_MANAGER_MESSAGE_TYPE:TYPE};Object.assign(root.SciLLM ||= {},exported);if(typeof module==='object'&&module.exports)module.exports=exported;
})(globalThis);
