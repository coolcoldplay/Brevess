(() => {
  const base=chrome.runtime.getURL('');
  chrome.runtime.onConnect.addListener(port=>{
    if(port.name!=='brevess-workbench-api')return;
    const page=port.sender?.url?.split(/[?#]/)[0];
    if(port.sender?.id!==chrome.runtime.id || !['options.html','workbench/index.html','popup.html','workbench/agent-sidebar.html'].some(p=>base+p===page) || (port.sender.frameId??0)!==0){port.disconnect();return;}
    const controller=new AbortController();let used=false;
    port.onDisconnect.addListener(()=>controller.abort());
    port.onMessage.addListener(async msg=>{
      if(used)return;used=true;
      try{
        if(msg.type!=='agent.api.turn')throw Error('INVALID_REQUEST');
        const a=msg.args||{}, settings=await SciLLM.loadSettings(chrome.storage.local);
        if(!settings.consentGranted)throw Error('CONSENT_REQUIRED');
        const key=String(a.source||'').slice(4);
        const profile=Object.hasOwn(settings.profiles||{},key)&&settings.profiles[key];
        const providers=SciLLM.getProviderDefinitions();
        if(!String(a.source).startsWith('api:')||!profile?.config?.apiKey||providers[profile.providerId]?.textGeneration===false||providers[profile.providerId]?.localOnly)throw Error('PROFILE_UNAVAILABLE');
        const entry=BrevessAgentConnections.apiRows(profile,providers).find(row=>row.id===a.model);
        if(!entry||typeof a.userPrompt!=='string'||a.userPrompt.length>1048576||typeof a.systemPrompt!=='string'||a.systemPrompt.length>524288||!Array.isArray(a.images)||a.images.length>8)throw Error('INVALID_REQUEST');
        const reasoningEffort=BrevessAgentConnections.checkEffort(entry,a.reasoningEffort);
        const reasoning=reasoningEffort==='auto'?{}:{reasoningEffort,reasoningEnabled:!['none','off','disabled'].includes(reasoningEffort)};
        const config={...profile.config,model:entry.id,...reasoning};
        const adapter=SciLLM.createProviderAdapter({providerId:profile.providerId,config,fetchImpl:fetch});
        let text='',complete=false;
        for await(const e of adapter.generateTextStream({systemPrompt:a.systemPrompt,userPrompt:a.userPrompt,model:entry.id,...reasoning,jsonObject:true,images:a.images,timeoutMs:280000,maxOutputTokens:8192,signal:controller.signal})){
          if(e.type==='text_delta'){text+=e.text||'';if(text.length>262144)throw Error('OUTPUT_TOO_LARGE');}
          if(e.type==='error')throw Error(e.error?.code||'PROVIDER_ERROR');
          if(e.type==='completed'){if(e.success===false||['length','max_tokens'].includes(e.finishReason))throw Error('OUTPUT_TRUNCATED');complete=true;}
        }
        if(!complete||!text.trim())throw Error('EMPTY_RESPONSE');
        port.postMessage({requestId:msg.requestId,success:true,data:text});
      }catch(e){if(!controller.signal.aborted)port.postMessage({requestId:msg.requestId,success:false,error:{code:/^[A-Z_]{3,80}$/.test(e.message)?e.message:'PROVIDER_ERROR'}});}
    });
  });
})();
