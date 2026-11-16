(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.SciLLM ||= {},api);})(globalThis,function(){
  'use strict';
  const SETUP_PROMPT='请帮我检查 BREVESS MCP 接入。先检查当前客户端已有的 BREVESS 配置，保留其他服务。配套连接组件安装程序可选择配置 Codex、DeepSeek Harness 或两者，默认只读；使用安装程序写入的稳定启动路径，不改成临时解压目录。若尚未安装，告诉我需要打开哪个配套安装程序，不假称配置成功。加载随包 brevess skill，重新发现工具并调用 brevess.status / brevess.capabilities。在设置的模型与连接页自动配对并检测；凭据不得出现在聊天、截图或课题里。然后读取我指定的模块：课题用 workbench.read_context，文献机制图用 mechanism.read_context。报告真实连接状态和可用能力；不要自动写入或调用付费模型。需要写入时先征得我同意启用客户端写能力，再请求对应目标的短期授权或总库写入确认；测试只能在我明确指定的合成目标中进行。';
  function parseAgentPairingLink(value){
    let url;try{url=new URL(String(value||'').trim());}catch(_){throw Error('请粘贴 MCP 服务提供的完整本机配对链接。');}
    const token=url.searchParams.get('token');
    if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/connect'||url.username||url.password||url.hash||!token||token.length>512||url.searchParams.getAll('token').length!==1||[...url.searchParams.keys()].some(k=>k!=='token'))throw Error('配对链接必须来自本机 MCP 服务的 /connect 页面。');
    return{server:url.origin,token};
  }
  function requestNativeAgentConnection(action,{runtime=globalThis.chrome?.runtime,timeoutMs=35000}={}){
    if(!['status','pair'].includes(action)||!runtime?.connectNative)return Promise.reject(Object.assign(Error('本地连接组件不可用'),{code:'AGENT_CONNECTION_NATIVE_UNAVAILABLE'}));
    return new Promise((resolve,reject)=>{
      let port,timer,settled=false;const requestId='agent-'+globalThis.crypto.randomUUID();
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);try{port?.disconnect();}catch{}if(error)reject(error);else resolve(value);};
      const fail=code=>Object.assign(Error(code),{code});
      timer=setTimeout(()=>finish(fail('AGENT_CONNECTION_TIMEOUT')),timeoutMs);
      try{
        port=runtime.connectNative('com.sci_reader.codex_bridge');
        port.onDisconnect.addListener(()=>{void runtime.lastError;finish(fail('AGENT_CONNECTION_NATIVE_UNAVAILABLE'));});
        port.onMessage.addListener(message=>{
          if(message?.requestId!==requestId)return;
          if(['agent.connection.error','host.error','error'].includes(message.type))return finish(fail(message.error?.code||'AGENT_CONNECTION_COMPONENT_UPDATE_REQUIRED'));
          if(message.type!=='agent.connection.'+action+'.result'||message.ok!==true||message.extensionId!==runtime.id)return finish(fail('AGENT_CONNECTION_RECEIPT_INVALID'));
          if(action==='pair'){
            let url;try{url=new URL(message.serverUrl);}catch{return finish(fail('AGENT_CONNECTION_RECEIPT_INVALID'));}
            if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||url.search||url.hash||url.username||url.password||message.pairing?.protocol!=='brevess-mcp-bridge-v1'||typeof message.pairing.token!=='string'||!message.pairing.token||message.pairing.token.length>512||/[\s\u0000-\u001f]/u.test(message.pairing.token))return finish(fail('AGENT_CONNECTION_RECEIPT_INVALID'));
          }else if(message.pairing||!['not-started','ready'].includes(message.service))return finish(fail('AGENT_CONNECTION_RECEIPT_INVALID'));
          finish(null,message);
        });
        port.postMessage({type:'agent.connection.'+action,requestId});
      }catch{finish(fail('AGENT_CONNECTION_NATIVE_UNAVAILABLE'));}
    });
  }
  function showAgentConnectionCenter(options){
    if(!options.settingsOwner)return showAgentModuleStatus(options);
    const doc=options.document,dialog=doc.createElement('dialog');dialog.className='brevess-agent-connection';dialog.setAttribute('aria-label','Agent 连接');
    const style=doc.createElement('style');
    // Match ui-swiss.css; the standalone workbench uses the same neutral fallbacks.
    style.textContent=`
      .brevess-agent-connection {
        box-sizing:border-box;width:min(640px,calc(100vw - 28px));max-height:calc(100vh - 32px);
        overflow:auto;padding:20px;border:1px solid var(--swiss-line,#d5d5d5);border-radius:0;
        box-shadow:none;background:#fff;color:var(--swiss-ink,#202020);
        font:13px/1.6 Inter,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
      }
      .brevess-agent-connection::backdrop{background:#0004}
      .brevess-agent-connection h2{font-size:18px;margin:0 0 14px}
      .brevess-agent-connection h3{font-size:14px;margin:20px 0 8px;padding-top:12px;border-top:1px solid var(--swiss-line,#d5d5d5)}
      .brevess-agent-connection p{margin:6px 0;overflow-wrap:anywhere}
      .brevess-agent-connection input,.brevess-agent-connection textarea {
        box-sizing:border-box;width:100%;padding:8px;border:1px solid var(--swiss-line,#d5d5d5);
        border-radius:0;background:#fff;color:inherit;font:inherit;
      }
      .brevess-agent-connection textarea{height:112px;resize:vertical}
      .brevess-agent-connection button {
        box-sizing:border-box;height:32px;padding:6px 10px;margin:0;vertical-align:middle;border:1px solid var(--swiss-line,#d5d5d5);
        border-radius:0;box-shadow:none;background:#fff;color:var(--swiss-ink,#202020);
        font:inherit;line-height:18px;cursor:pointer;transition:background-color .12s,border-color .12s,color .12s;
      }
      .brevess-agent-connection button:hover:not(:disabled){background:#ededed;border-color:var(--swiss-ink,#202020)}
      .brevess-agent-connection button:active:not(:disabled){background:var(--swiss-ink,#202020);color:#fff}
      .brevess-agent-connection :is(button,input,textarea):focus-visible{outline:2px solid var(--swiss-ink,#202020);outline-offset:3px}
      .brevess-agent-connection button:disabled{opacity:.45;cursor:default}
      .brevess-agent-connection button[aria-busy="true"]{opacity:1;cursor:progress;background:var(--swiss-soft,#f4f4f4);border-color:var(--swiss-ink,#202020)}
      .brevess-agent-connection .agent-message {
        position:sticky;top:0;z-index:1;min-height:24px;padding:8px 10px;
        border:1px solid var(--swiss-line,#d5d5d5);border-left:3px solid var(--swiss-ink,#202020);
        border-radius:0;background:var(--swiss-soft,#f4f4f4);color:var(--swiss-ink,#202020);
      }
      .brevess-agent-connection .agent-message:empty{display:none}
      .brevess-agent-connection .agent-message[data-state="error"]{color:var(--color-danger,#b42318);border-left-color:var(--color-danger,#b42318)}
      .brevess-agent-connection .agent-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:8px 0}
      .brevess-agent-connection .agent-close{float:right;margin-top:0}
      .brevess-agent-connection dl{display:grid;grid-template-columns:78px minmax(0,1fr);gap:5px 12px;margin:12px 0}
      .brevess-agent-connection dt{color:var(--swiss-muted,#646464)}
      .brevess-agent-connection dd{margin:0;overflow-wrap:anywhere}
      @media(max-width:480px){.brevess-agent-connection{padding:14px}}
      @media(prefers-reduced-motion:reduce){.brevess-agent-connection button{transition:none}}
    `;dialog.append(style);
    const add=(tag,text,parent=dialog)=>{const node=doc.createElement(tag);node.textContent=text||'';parent.append(node);return node;};
    const close=add('button','关闭');close.type='button';close.className='agent-close';close.onclick=()=>dialog.close();add('h2','Agent 连接');
    const message=add('p');message.className='agent-message';message.setAttribute('role','status');message.setAttribute('aria-live','polite');message.setAttribute('aria-atomic','true');
    const report=(text,state='info')=>{if(dialog.isConnected){message.textContent=text;message.dataset.state=state;}};
    const errorText=error=>{
      const codes={AGENT_CONNECTION_STATUS_FAILED:'读取状态失败；保留当前数据，可重试。',AGENT_CONNECTION_NATIVE_UNAVAILABLE:'尚未检测到连接组件，请先打开配套安装程序。',AGENT_CONNECTION_TIMEOUT:'组件响应超时，请稍后重试检测。',INVALID_SETTINGS:'当前组件版本较旧，请更新配套连接组件。',AGENT_CONNECTION_COMPONENT_UPDATE_REQUIRED:'当前组件版本不支持此操作，请更新配套连接组件。',AGENT_CONNECTION_RECEIPT_INVALID:'组件回执与当前扩展不匹配，请核对扩展与组件版本。',
        AGENT_ACTION_INVALID:'连接组件不支持当前操作，请核对组件版本。',AGENT_ORIGIN_MISMATCH:'当前扩展与已安装的连接组件身份不一致，请核对加载版本。',AGENT_NOT_INSTALLED:'尚未安装 Agent 连接组件，请打开配套安装程序。',AGENT_INSTALLATION_MISMATCH:'连接组件安装不完整或路径已变化，请核对安装状态。',AGENT_CONNECTION_CLOSED:'组件在检查完成前断开，请重新检测连接。',AGENT_CONNECTION_BUSY:'组件正在处理另一项连接检查，请等待完成。',SERVICE_IDENTITY_MISMATCH:'本地端口对应另一服务，请核对连接服务。',SERVICE_RESTART_REQUIRED:'当前运行服务与已安装组件版本不同，需先协调退出旧服务再重连。',SERVICE_LOCK_STALE:'连接服务启动锁异常，请通过配套安装程序检查。',AGENT_CONNECTION_FAILED:'本地组件检查失败，请核对组件诊断信息。',
        MCP_BRIDGE_SERVER_INVALID:'本机服务地址格式不正确，请重新自动配对。',MCP_BRIDGE_CONFIG_INVALID:'配对配置无效，请重新自动配对。',MCP_BRIDGE_TOKEN_INVALID:'配对信息无效，请重新自动配对。',BRIDGE_UNAUTHORIZED:'配对已失效，请重新自动配对。',BRIDGE_VERSION_MISMATCH:'工作台与本地服务协议版本不一致，请核对版本。',MCP_WORKBENCH_HOST_UNAVAILABLE:'工作台操作模块尚未就绪，请等待工作台加载完成。'};
      const stages={'native-status':'本地组件检查','native-pair':'本地组件配对','bridge-pair':'扩展配对','bridge-check':'连接自检','connection-status':'连接状态读取'};
      Object.assign(codes,{CANCELLED:'连接已停止，请重新配对。',MCP_BRIDGE_RECEIPT_INVALID:'扩展登记回执不匹配，请核对连接服务。',DOCUMENT_REGISTRATION_TIMEOUT:'文献登记超时，请保持侧栏打开后重试。',DOCUMENT_UI_CLOSED:'文献连接已关闭，请重新打开侧栏。',FIGURE_RUNTIME_BINDING_FAILED:'文献界面归属尚未确认，请重新打开侧栏后重试。'});
      const prefix=Object.hasOwn(stages,error?.agentConnectionStage)?stages[error.agentConnectionStage]+'：':'';
      if(Object.hasOwn(codes,error?.code))return prefix+codes[error.code]+' ['+error.code+']';
      // Only locally worded guidance is displayable; provider URLs/tokens may be secrets.
      const text=String(error?.message||'');
      if(text.length<=180&&/[\u4e00-\u9fff]/u.test(text)&&!/(?:https?:|token|secret|bearer|凭据|密钥)/iu.test(text))return prefix+text;
      return prefix+'未完成，请保留此提示以核查连接诊断。';
    };
    // Stage names come from this UI, and only allowlisted codes reach the screen.
    // Never forward native/provider message objects, URLs or pairing material.
    const step=async(stage,fn)=>{try{return await fn();}catch(error){throw Object.assign(new Error(error?.message||''),{code:error?.code,agentConnectionStage:stage});}};
    let busy=false,refreshVersion=0,connectionNotice='',nativePairSummary=null;
    const actions=[];
    const button=(label,pending,fn)=>{
      const previous=dialog.lastElementChild;
      const row=previous?.className==='agent-actions'?previous:add('div');row.className='agent-actions';
      const node=add('button',label,row);node.type='button';actions.push(node);
      node.onclick=async()=>{
        if(busy)return;busy=true;connectionNotice='';for(const action of actions)action.disabled=true;
        node.setAttribute('aria-busy','true');node.textContent=pending;node.dataset.state='busy';report(pending);
        try{const result=await fn();connectionNotice=result?.connectionNotice||'';node.dataset.state=result?.state||'success';report(result?.message||'操作已完成。',result?.state||'success');}
        catch(error){node.dataset.state='error';report(errorText(error),'error');}
        finally{busy=false;node.removeAttribute('aria-busy');node.textContent=label;for(const action of actions)action.disabled=false;}
      };return node;
    };
    const details=add('dl'),fields={},fieldLabels={};for(const [key,label]of [['module','当前模块'],['target','当前目标'],['bridge','MCP 连接'],['document','文献接入'],['permission','写入权限'],['capabilities','可用能力']]){fieldLabels[key]=add('dt',label,details);fields[key]=add('dd','检查中…',details);if(key==='document')fieldLabels[key].hidden=fields[key].hidden=true;}
    const states={connected:'已连接',connecting:'连接中',unpaired:'待配对',offline:'未检测到服务',unauthorized:'配对已失效',incompatible:'版本不匹配',unknown:'尚未取得连接状态',disconnecting:'正在等待模块断开',waiting:'已保存配对 · 等待打开工作台',multiple:'多个工作台 · 请保留一个后连接',paused:'已断开 · 配对已保留',error:'操作未确认'};
    async function refresh(){
      const version=++refreshVersion;
      try{const s=await options.status();if(!dialog.isConnected||version!==refreshVersion)return s;
        fields.module.textContent=s.module||'BREVESS';fields.target.textContent=s.target||'尚未选择目标';fields.bridge.textContent=states[s.bridge?.state]||states.unknown;
        if(s.bridge?.message)fields.bridge.textContent+='；'+errorText({message:s.bridge.message});
        fieldLabels.document.hidden=fields.document.hidden=!s.document;
        if(s.document)fields.document.textContent=({connected:'已接入',connecting:'正在登记',unavailable:'尚未接入'}[s.document.state]||'尚未接入')+(s.document.message?'；'+errorText({message:s.document.message}):'');
        if(nativePairSummary!==null)nativeStatus.textContent=s.bridge?.state==='connected'?`扩展已配对；本地服务发现 ${nativePairSummary} 个工具。请在客户端调用 brevess.status 完成客户端核验。`:'本地组件已就绪；'+(states[s.bridge?.state]||states.unknown)+'。';
        fields.permission.textContent=s.permission||'只读';fields.capabilities.textContent=(s.capabilities||[]).join('、')||'未取得模块能力';return s;
      }catch(_){if(!dialog.isConnected||version!==refreshVersion)return null;for(const field of Object.values(fields))if(field.textContent==='检查中…')field.textContent='未取得';fields.bridge.textContent=states.unknown;throw Object.assign(Error('读取状态失败'),{code:'AGENT_CONNECTION_STATUS_FAILED'});}
    }
    const connectionResult=(s,prefix)=>({message:prefix+'；'+(states[s?.bridge?.state]||states.unknown)+(s?.document?(s.document.state==='connected'?'；文献已接入':'；文献尚未接入'):'')+(s?.bridge?.message?'。'+errorText({message:s.bridge.message}):'。'),state:s?.bridge?.state==='connected'&&(!s.document||s.document.state==='connected')?'success':'warning',connectionNotice:prefix});
    button('刷新状态','正在刷新…',async()=>connectionResult(await refresh(),'状态已刷新'));
    if(options.check)button('检测连接','正在检测连接…',async()=>{await options.check();return connectionResult(await refresh(),'检测已完成');});
    if(options.reconnect)button('重连 MCP','正在重连…',async()=>{await options.reconnect();return connectionResult(await refresh(),'重连请求已完成');});
    if(options.disconnect)button('断开连接','正在断开…',async()=>{await options.disconnect();return connectionResult(await refresh(),'已断开，配对已保留');});
    if(options.forget)button('移除配对','正在移除…',async()=>{if(!doc.defaultView.confirm('移除本机 MCP 配对？再次连接需重新配对；不会删除文献或课题。'))return{message:'已取消，配对保留。'};await options.forget();return connectionResult(await refresh(),'已移除配对');});
    if(options.revoke)button('撤回写权限','正在撤回权限…',async()=>{await options.revoke();try{await refresh();return{message:'已撤回当前目标的写权限。'};}catch(_){return{message:'已撤回写权限；状态读取失败，可刷新重试。',state:'warning'};}});
    add('h3','快捷连接');add('p','先打开配套连接组件的安装程序，选择 Codex、DeepSeek Harness 或两者，并确认系统提示。完成后在这里自动配对。');
    const nativeStatus=add('p','尚未检查本地连接组件。');
    button('检测连接组件','正在检测组件…',async()=>{try{const result=await step('native-status',()=>requestNativeAgentConnection('status'));nativeStatus.textContent=result.service==='ready'?'本地服务已就绪；客户端实际读取状态仍需在客户端核验。':'组件已安装，可自动启动并配对。';return{message:nativeStatus.textContent};}catch(error){nativeStatus.textContent=errorText(error);throw error;}});
    if(options.pair)button('自动配对并自检','正在配对并自检…',async()=>{
      nativeStatus.textContent='正在连接本地组件…';
      nativePairSummary=null;
      try{
        const result=await step('native-pair',()=>requestNativeAgentConnection('pair'));
        const config={server:result.serverUrl,token:result.pairing.token};
        delete result.pairing;
        try{await step('bridge-pair',()=>options.pair(config));}finally{config.token='';}
        nativePairSummary=Number.isSafeInteger(result.toolCount)?result.toolCount:'若干';
        if(options.check)await step('bridge-check',()=>options.check());const status=await step('connection-status',refresh);
        nativeStatus.textContent=status?.bridge?.state==='connected'?`扩展已配对；本地服务发现 ${Number.isSafeInteger(result.toolCount)?result.toolCount:'若干'} 个工具。请在客户端调用 brevess.status 完成客户端核验。`:'组件已就绪，扩展连接尚未确认，请刷新状态。';
        return{...connectionResult(status,'配对检查'),message:nativeStatus.textContent};
      }catch(error){nativeStatus.textContent=errorText(error);throw error;}
    });
    else if(options.openWorkbench)button('前往工作台快捷连接','正在打开工作台…',async()=>{await options.openWorkbench();return{message:'已打开工作台连接入口。'};});
    add('h3','手动接入');add('p','也可使用已启动的 MCP 服务配对链接。连接 MCP 不要求另接收费模型。');
    if(options.pair){add('p','MCP 服务启动后，将它给出的本机配对链接粘贴到此处。');const input=add('input');input.type='password';input.autocomplete='off';input.placeholder='本机配对链接（仅保存在本机）';input.setAttribute('aria-label','本机配对链接');button('配对并检查','正在配对并检查…',async()=>{const config=parseAgentPairingLink(input.value);input.value='';try{await step('bridge-pair',()=>options.pair(config));}finally{config.token='';}if(options.check)await step('bridge-check',()=>options.check());return connectionResult(await step('connection-status',refresh),'配对请求已完成');});}
    else if(options.openWorkbench)button('前往工作台配对','正在打开工作台…',async()=>{await options.openWorkbench();return{message:'已打开工作台配对入口。'};});
    add('p','MCP 服务通过源码中的 mcp/server.js 单独启动。Windows 模型调用桥需另外安装本机配套组件；浏览器扩展包不包含本机二进制。');
    if(options.readmeUrl){const link=add('a','随包安装与客户端配置说明');link.href=options.readmeUrl;link.target='_blank';link.rel='noopener';}
    add('h3','让 Agent 帮你配置');const prompt=add('textarea',SETUP_PROMPT);prompt.readOnly=true;prompt.setAttribute('aria-label','Agent 接入提示词');button('复制配置提示词','正在复制…',async()=>{try{await doc.defaultView.navigator.clipboard.writeText(SETUP_PROMPT);return{message:'配置提示词已复制。'};}catch(_){prompt.focus();prompt.select();return{message:'自动复制未完成；请复制已选中的提示词。',state:'warning'};}});
    add('p','配对后先读取当前模块。文献与课题分别授权；未确认前不会向真实画布写入测试对象。');
    const onStatus=()=>{if(!busy)void refresh().then(status=>{if(connectionNotice&&status){const result=connectionResult(status,connectionNotice);report(result.message,result.state);}}).catch(error=>report(errorText(error),'error'));};doc.defaultView.addEventListener('brevess:mcp-status',onStatus);dialog.addEventListener('close',()=>{refreshVersion++;doc.defaultView.removeEventListener('brevess:mcp-status',onStatus);dialog.remove();},{once:true});doc.body.append(dialog);dialog.showModal();void refresh().catch(error=>{if(!busy)report(errorText(error),'error');});return{dialog,refresh};
  }
  function showAgentModuleStatus(options){
    const doc=options.document,dialog=doc.createElement('dialog');dialog.className='brevess-agent-module-status';dialog.setAttribute('aria-label','当前任务 Agent');
    const title=doc.createElement('h2');title.textContent='当前任务 Agent';
    const status=doc.createElement('p');status.setAttribute('role','status');status.textContent='正在读取当前目标权限…';
    const settings=doc.createElement('a');settings.textContent='前往设置管理连接 ↗';settings.href=chrome.runtime.getURL('options.html')+'#page=models';settings.target='_blank';settings.rel='noopener';
    const close=doc.createElement('button');close.textContent='关闭';close.onclick=()=>dialog.close();dialog.append(title,status,settings);
    if(options.revoke){const revoke=doc.createElement('button');revoke.textContent='撤回当前目标写权限';revoke.onclick=async()=>{revoke.disabled=true;try{await options.revoke();status.textContent='已撤回当前目标写权限';}catch{status.textContent='撤回未确认，请重试';}finally{revoke.disabled=false;}};dialog.append(revoke);}
    dialog.append(close);dialog.addEventListener('close',()=>dialog.remove(),{once:true});doc.body.append(dialog);dialog.showModal();
    Promise.resolve().then(()=>options.status()).then(value=>{if(!dialog.isConnected)return;const states={connected:'已连接',connecting:'连接中',unpaired:'未配对',offline:'未连接',unauthorized:'配对失效',incompatible:'版本不匹配',unknown:'状态未确认'};status.textContent=[value.module,value.target,value.permission,'MCP：'+(states[value.bridge?.state]||'状态未确认'),value.document?'文献：'+(value.document.state==='connected'?'已登记':'尚未登记'):''].filter(Boolean).join(' · ');}).catch(()=>{status.textContent='当前目标状态读取失败';});return{dialog};
  }
  return{showAgentConnectionCenter,parseAgentPairingLink,requestNativeAgentConnection,AGENT_SETUP_PROMPT:SETUP_PROMPT};
});
