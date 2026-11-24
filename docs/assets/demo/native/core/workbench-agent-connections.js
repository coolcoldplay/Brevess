(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessAgentConnections = api;
})(globalThis, () => {
  'use strict';
  const nativeNames = {'codex-local':'Codex','deepseek-harness':'DeepSeek Harness'};
  const fault = (code, message) => Object.assign(new Error(message || code), {code});
  function modelsFor(id, config, rows) {
    const seen=new Set(), result=[];
    for (const row of Array.isArray(rows)?rows:[]) {
      const key=typeof row==='string'?row:row?.id;
      if (!key || typeof key!=='string' || key.length>256 || seen.has(key)) continue;
      seen.add(key);
      const raw=row.reasoningEfforts ?? row.supportedReasoningEfforts;
      const declared=Array.isArray(raw)?raw.map(v=>typeof v==='string'?v:v?.reasoningEffort||v?.id||v?.effort):
        globalThis.SciLLM?.getProviderReasoningCapabilities?.(id,{...config,model:key})?.levels || [];
      const levels=[...new Set(declared.filter(v=>typeof v==='string' && /^[a-z][a-z0-9_-]{0,63}$/i.test(v) && v!=='auto'))];
      result.push({id:key,name:row.displayName||row.name||key,reasoningEfforts:levels,defaultReasoningEffort:row.defaultReasoningEffort||'auto',isDefault:row.isDefault===true});
    }
    return result;
  }
  function apiRows(profile, providers) {
    const config=profile.config||{}, def=providers[profile.providerId]||{};
    const catalog=[config.modelCapabilityCatalog?.models,config.availableModels,def.models].filter(Array.isArray).flat();
    return modelsFor(profile.providerId, config, [...catalog,config.model].filter(Boolean));
  }
  function checkEffort(entry, requested) {
    const value=requested||'auto';
    if (value!=='auto' && !entry?.reasoningEfforts?.includes(value)) throw fault('WORKBENCH_AGENT_EFFORT_CHANGED','当前模型的推理等级已变动，请重新选择。');
    return value;
  }
  // A port belongs to one invocation. Closing it cancels only that invocation.
  function exchange(port, message, signal, timeoutMs) {
    return new Promise((resolve,reject)=>{
      let done=false;
      const finish=(fn,x)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);port.disconnect();fn(x);};
      const cancel=()=>finish(reject,fault('CANCELLED','已停止'));
      const timer=setTimeout(()=>finish(reject,fault('REQUEST_TIMEOUT','连接器响应超时。')),timeoutMs);
      port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(!done)finish(reject,fault('AGENT_CONNECTOR_UNAVAILABLE','本机连接器未响应或版本较旧。'));});
      port.onMessage.addListener(r=>{if(r.requestId!==message.requestId)return;r.success?finish(resolve,r.data):finish(reject,fault(r.error?.code||'AGENT_CONNECTOR_FAILED',r.error?.message));});
      if(signal?.aborted)return cancel();signal?.addEventListener('abort',cancel,{once:true});port.postMessage(message);
    });
  }
  function bridgeRequest(type,args,signal) {
    const port=type.startsWith('agent.sdk.')?chrome.runtime.connectNative('com.sci_reader.codex_bridge'):chrome.runtime.connect({name:'brevess-workbench-api'});
    return exchange(port,{type,requestId:crypto.randomUUID(),args},signal,type.endsWith('.turn')?300000:18000);
  }
  function transportFor(type, source) {
    return {async *streamTurn(input) {
      const text=await bridgeRequest(type+'.turn',{source,model:input.model,reasoningEffort:input.reasoningEffort,systemPrompt:input.systemPrompt,userPrompt:input.userPrompt,images:input.images||[]},input.signal);
      yield {type:'text_delta',text};yield {type:'completed',success:true};
    }};
  }
  const getState=async()=>{const r=await chrome.runtime.sendMessage({type:'LLM_GET_SETTINGS'});if(!r?.success)throw fault('WORKBENCH_AGENT_SETTINGS_UNAVAILABLE');return r.data;};
  async function externalClients(){
    const r=await chrome.runtime.sendMessage({type:'BREVESS_ARTICLE_PRESENTATION',op:'clients'}).catch(()=>null);
    return r?.success&&Array.isArray(r.data)?r.data:null;
  }
  async function sources() {
    const [state,external]=await Promise.all([getState(),externalClients()]);
    const rows=[],known=new Set(),add=(id,label,kind)=>{if(!known.has(id)){known.add(id);rows.push({id,label,kind});}};
    const profiles=state.settings.profiles||{}, ordered=Object.entries(profiles).sort(([a],[b])=>Number(b===state.settings.globalProfileId)-Number(a===state.settings.globalProfileId));
    for(const [key,p] of ordered) {
      if(nativeNames[p.providerId])add(p.providerId,nativeNames[p.providerId],'agent');
      else if(p.config?.hasApiKey && state.providers?.[p.providerId]?.textGeneration!==false)add('api:'+key,p.name||state.providers?.[p.providerId]?.label||p.providerId,'api');
    }
    const clients=globalThis.SciLLM?.getAgentSetupClients?.()||[];
    for(const id of external||[]) {
      const def=clients.find(c=>c.id===id);if(!def)continue;
      if(def.modelAdapter)add(def.modelAdapter,nativeNames[def.modelAdapter]||def.label,'agent');
      else add('client:'+id,def.label.split(' · ')[0],'external');
    }
    if(!rows.length)add('codex-local','Codex','agent');
    // A configured text API remains the first choice on an API-only installation.
    if(!ordered.some(([,p])=>p.config?.hasApiKey||nativeNames[p.providerId]))rows.sort((a,b)=>Number(a.kind==='external')-Number(b.kind==='external'));
    return {rows,externalKnown:external!==null};
  }
  const native=new Map();
  async function connect(source, requestedModel) {
    const state=await getState(), settings=state.settings;
    const profiles=Object.entries(settings.profiles||{}), profile=profiles.find(([k,p])=>source==='api:'+k || k===settings.globalProfileId&&p.providerId===source)||profiles.find(([,p])=>p.providerId===source);
    const config=profile?.[1]?.config||{};let rows,model,label,transport,perModel=false,delegated=false;
    if(source.startsWith('api:')){
      if(!profile||!config.hasApiKey||state.providers?.[profile[1].providerId]?.textGeneration===false)throw fault('WORKBENCH_AGENT_MODEL_UNAVAILABLE');
      rows=apiRows(profile[1],state.providers||{});label=profile[1].name;model=config.model;transport=transportFor('agent.api',source);
    }else if(source.startsWith('client:')){
      const client=source.slice(7);
      const info=await bridgeRequest('agent.sdk.models',{source:client,model:requestedModel});
      rows=modelsFor('external-client',{},info.models);model=info.model;label=info.label;perModel=!!info.perModel;delegated=!!info.delegated;transport=transportFor('agent.sdk',client);
    }else{
      if(!nativeNames[source])throw fault('WORKBENCH_AGENT_MODEL_UNAVAILABLE');
      if(!native.has(source))native.set(source,source==='codex-local'?SciLLM.createCodexNativeClient(chrome.runtime):SciLLM.createHarnessNativeClient(chrome.runtime));
      transport=native.get(source);const health=await transport.health({timeoutMs:12000});
      if(source==='codex-local' && health.connected!==true)throw fault('CODEX_BRIDGE_UNAVAILABLE','Codex 本机连接未就绪');
      if(source==='deepseek-harness' && (health.accountStatus==='signed-out'||health.credentialStored===false))throw fault('HARNESS_NOT_AUTHENTICATED','请在 DeepSeek Harness 中登录');
      const catalog=await transport.listModels({timeoutMs:15000});rows=modelsFor(source,config,catalog.models);
      if(source==='codex-local'&&rows.length&&!rows.some(v=>v.id==='auto')){
        const def=rows.find(x=>x.isDefault);rows.unshift({id:'auto',name:'跟随 Codex 默认模型',reasoningEfforts:def?.reasoningEfforts||[],defaultReasoningEffort:def?.defaultReasoningEffort||'auto'});
      }
      label=nativeNames[source];model=config.model;
    }
    if(!rows.length)throw fault('WORKBENCH_AGENT_MODEL_UNAVAILABLE','连接器未返回可用模型。');
    return {transport,perModel,delegated,models:rows,model:rows.some(e=>e.id===model)?model:(rows.find(e=>e.isDefault)||rows[0]).id,config,profileId:profile?.[0]||source,label};
  }
  return {sources,connect,modelsFor,apiRows,checkEffort};
});
