(function(){'use strict';
 const labels={connected:'本机服务已连接',connecting:'正在连接本机服务',disconnecting:'正在断开本机连接',waiting:'已保存配对 · 等待连接',multiple:'课题目标待选择',paused:'已断开 · 配对已保留',unpaired:'尚未配对',offline:'服务未连接',unauthorized:'配对已失效',incompatible:'协议版本不匹配',unknown:'等待模块回执',error:'操作未确认，请重试'};
 async function call(action,config){const result=await chrome.runtime.sendMessage({type:'BREVESS_AGENT_MANAGER',action,...(config?{config}:{})});if(result?.success!==true)throw Object.assign(new Error('连接操作未确认，请重试。'),{code:result?.error?.code||'AGENT_CONNECTION_STATUS_FAILED'});return result.data;}
 const statusNode=document.getElementById('externalAgentState');
 async function status(){const value=await call('status');statusNode.textContent=labels[value.state]||labels.unknown;return{module:'外部 MCP',target:value.host==='workbench'?'当前课题':'文献总库',bridge:{state:value.state,configured:value.configured},permission:'由各任务目标分别确认',capabilities:value.state==='connected'?['活动模块已登记']:[]};}
 async function connectModel(clientId,signal,mode,onProgress) {
  if(clientId==='workbuddy' && mode==='desktop')return BrevessAgentSetup.testDesktop(clientId,signal,onProgress);
  const providerId=SciLLM.getAgentSetupClients().find(client=>client.id===clientId)?.modelAdapter;
  if(!providerId)return BrevessAgentSetup.testClient(clientId,signal);
  const result=await callBackground({type:'LLM_CONNECT_AGENT',providerId});
  applyState(result);
  return result.profile;
 }
 function recordTest(client, mode, result) {
  const key = 'brevessAgentLastTest.' + client + '.' + mode;
  return chrome.storage.local.set({[key]: {result, checkedAt: Date.now()}});
 }
 async function loginModel(clientId) {
  if(clientId!=='codex')throw Object.assign(Error('Unsupported Agent login'),{code:'INVALID_SETTINGS'});
  await SciLLM.startCodexAgentLogin({request:callBackground,openTab:options=>chrome.tabs.create(options)});
 }
 document.getElementById('externalAgentManage').onclick=event=>SciLLM.showAgentConnectionCenter({document,settingsOwner:true,client:event.currentTarget.dataset.client,setupClient:BrevessAgentSetup.request,connectModel,loginModel,recordTest,readmeUrl:chrome.runtime.getURL('help/agent-setup.html'),openPrivacy:()=>activateSettingsPage('privacy'),status,pair:config=>call('pair',config),check:()=>call('check'),reconnect:()=>call('resume'),disconnect:()=>call('disconnect'),forget:()=>call('forget')});
 document.getElementById('externalAgentRefresh').onclick=()=>void status().catch(()=>{statusNode.textContent='状态读取失败，请重试';});
 void status().catch(()=>{statusNode.textContent='状态读取失败，请重试';});
})();
