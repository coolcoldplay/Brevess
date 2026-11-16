(function(){'use strict';
 const labels={connected:'已连接到活动工作台',connecting:'正在连接活动工作台',disconnecting:'正在等待活动工作台断开',waiting:'已保存配对 · 等待打开工作台',multiple:'已打开多个工作台 · 请保留一个后连接',paused:'已断开 · 配对已保留',unpaired:'尚未配对',offline:'服务未连接',unauthorized:'配对已失效',incompatible:'协议版本不匹配',unknown:'等待模块回执',error:'操作未确认，请重试'};
 async function call(action,config){const result=await chrome.runtime.sendMessage({type:'BREVESS_AGENT_MANAGER',action,...(config?{config}:{})});if(result?.success!==true)throw Object.assign(new Error('连接操作未确认，请重试。'),{code:result?.error?.code||'AGENT_CONNECTION_STATUS_FAILED'});return result.data;}
 const statusNode=document.getElementById('externalAgentState');
 async function status(){const value=await call('status');statusNode.textContent=labels[value.state]||labels.unknown;return{module:'外部 MCP',target:value.modules?value.modules+' 个活动工作台':'等待活动工作台',bridge:{state:value.state},permission:'由各任务目标分别确认',capabilities:value.state==='connected'?['活动模块已登记']:[]};}
 document.getElementById('externalAgentManage').onclick=()=>SciLLM.showAgentConnectionCenter({document,settingsOwner:true,readmeUrl:chrome.runtime.getURL('mcp/README.md'),status,pair:config=>call('pair',config),check:()=>call('check'),reconnect:()=>call('resume'),disconnect:()=>call('disconnect'),forget:()=>call('forget')});
 document.getElementById('externalAgentRefresh').onclick=()=>void status().catch(()=>{statusNode.textContent='状态读取失败，请重试';});
 void status().catch(()=>{statusNode.textContent='状态读取失败，请重试';});
})();
