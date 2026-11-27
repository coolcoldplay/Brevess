// Settings owns each native setup port. Closing its dialog stops pending
// authentication and never persists the one-time authorization code.
(function (root) {
  'use strict';
  function request(action, client, {signal, authorize} = {}) {
    const id = crypto.randomUUID(), type = 'agent.settings.' + action;
    return new Promise((resolve,reject) => {
      const port = chrome.runtime.connectNative('com.sci_reader.codex_bridge');
      let settled = false;
      const fail = code => Object.assign(new Error(code), {code});
      const finish = (fn,value) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        try {port.disconnect();} catch {} fn(value);
      };
      const cancel = () => finish(reject, fail('CANCELLED'));
      const timer = setTimeout(() => finish(reject,fail('AGENT_CONNECTION_TIMEOUT')), ['inspect','configure'].includes(action) ? 15000 : 600000);
      port.onDisconnect.addListener(() => {void chrome.runtime.lastError;finish(reject,fail('AGENT_CONNECTION_NATIVE_UNAVAILABLE'));});
      port.onMessage.addListener(response => {
        if (response?.requestId !== id) return;
        if (response.type !== type+'.result' || response.client!==client || response.ok!==true)
          return finish(reject,fail(response.error?.code==='UNKNOWN_MESSAGE_TYPE'?'AGENT_CONNECTION_COMPONENT_UPDATE_REQUIRED':response.error?.code || 'AGENT_CONNECTION_COMPONENT_UPDATE_REQUIRED'));
        if (action === 'login' && response.stage === 'authorization') {
          let url;
          try {url=new URL(response.url);} catch {}
          if (!url || url.origin !== 'https://accounts.google.com' || url.username || url.password) return finish(reject,fail('AGENT_LOGIN_URL_INVALID'));
          Promise.resolve().then(()=>authorize(url.href, code => {
            if(!settled)port.postMessage({type:'agent.settings.code',requestId:id,client,code});
          })).catch(() => finish(reject,fail('AGENT_CLIENT_LOGIN_FAILED')));
          return;
        }
        finish(resolve,response);
      });
      signal?.addEventListener('abort',cancel,{once:true});
      if(signal?.aborted)return cancel();
      try {port.postMessage({type,requestId:id,client});} catch {finish(reject,fail('AGENT_CONNECTION_NATIVE_UNAVAILABLE'));}
    });
  }
  async function testClient(id,signal) {
    const {bridgeRequest} = root.BrevessAgentConnections;
    const catalog = await bridgeRequest('agent.sdk.probe',{source:id},signal);
    if(!catalog?.models?.length || !catalog.model)throw Object.assign(Error(),{code:'AGENT_MODEL_UNAVAILABLE'});
    await root.BrevessRiskGate.requireAcknowledgement();
    const answer=await bridgeRequest('agent.sdk.turn',{source:id,model:catalog.model,reasoningEffort:'auto',
      directOnly:true,systemPrompt:'This is a BREVESS connection check. Respond with the requested short text. Do not use tools.',
      userPrompt:'Reply with BREVESS_OK.',images:[]},signal);
    if (id === 'antigravity' && typeof answer === 'string' &&
        /not eligible for Gemini Code Assist for individuals because it is not currently available in your location/i.test(answer)) {
      throw Object.assign(new Error('Google account region unavailable'), { code: 'AGENT_ACCOUNT_REGION_UNAVAILABLE' });
    }
    if (typeof answer !== 'string' || !answer.includes('BREVESS_OK')) throw Object.assign(Error(), { code: 'AGENT_MODEL_TEST_FAILED' });
    return {name:root.SciLLM.getAgentSetupClients().find(c=>c.id===id).label,model:catalog.model,models:catalog.models};
  }
  async function testDesktop(client, signal, onProgress) {
    if (client !== 'workbuddy') throw Object.assign(new Error(), {code:'AGENT_MODEL_TEST_FAILED'});
    await root.BrevessRiskGate.requireAcknowledgement();
    return new Promise((resolve,reject) => {
      const port = chrome.runtime.connect({name:'brevess-workbuddy-setup-test'});
      let settled = false;
      const finish = (value,code) => {
        if (settled) return;
        settled = true; signal?.removeEventListener('abort',abort); port.disconnect();
        if (code) reject(Object.assign(new Error(code),{code})); else resolve(value);
      };
      const abort = () => finish(null,'CANCELLED');
      port.onDisconnect.addListener(() => {void chrome.runtime.lastError;finish(null,'AGENT_CONNECTOR_UNAVAILABLE');});
      port.onMessage.addListener(msg => {
        if (['pending','working'].includes(msg.stage)) { onProgress?.(msg); return; }
        if (msg.stage === 'passed') finish({name:'WorkBuddy',model:'client-default',desktop:true});
        if (msg.stage === 'error') finish(null,msg.code);
      });
      signal?.addEventListener('abort',abort,{once:true});
      if (signal?.aborted) abort();
    });
  }
  root.BrevessAgentSetup = {request, testClient, testDesktop};
})(globalThis);
