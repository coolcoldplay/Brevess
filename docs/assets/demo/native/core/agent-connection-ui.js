(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.SciLLM ||= {},api);})(globalThis,function(){
  'use strict';
  const SETUP_PROMPT='请帮我配置当前 Agent 与 BREVESS 的连接。先从设置的“连接你的 Agent”选择当前客户端并取得匹配提示词；阅读 docs/AGENT_QUICK_CONNECT.md，保留已有配置、登录和研究资料，先备份再增量配置。完成后点击“连接并测试”，再从客户端真实调用 brevess.status、brevess.capabilities 和 library.query_global_library。分别报告浏览器连接、客户端读取和模型调用的真实状态，不以配置完成代替验收。凭据不要出现在聊天或报告；不要自动修改研究资料。';
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
  async function startCodexAgentLogin({ request, openTab }) {
    const login = await request({ type: 'CODEX_LOCAL_LOGIN_START', force: false });
    let url;
    try { url = new URL(String(login?.authUrl || '')); } catch {}
    if (!url || url.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com'].includes(url.hostname) || url.port || url.username || url.password) {
      throw Object.assign(Error('Invalid official Codex login URL'), { code: 'CODEX_PROVIDER_REJECTED' });
    }
    await openTab({ url: url.href });
  }

  function agentConnectionView(status, tested = false) {
    const state = status?.bridge?.state || 'unknown';
    const views = {
      connected: [tested ? '浏览器连接测试通过' : '浏览器已连接', '在所选 Agent 中执行试读指令，确认客户端也已接通。', 'success'],
      unpaired: ['尚未连接', '先把配置提示词发给 Agent；配置完成后，点击连接并测试。', 'idle'],
      waiting: ['等待打开工作台', '点击连接并测试，将自动打开工作台并检查连接。', 'idle'],
      paused: ['连接已暂停', '点击连接并测试即可恢复，已保存的配对仍然有效。', 'idle'],
      connecting: ['正在连接', '正在等待工作台响应。', 'busy'],
      multiple: ['请保留一个工作台', '关闭多余的 BREVESS 工作台标签页，再重新测试。', 'warning'],
      unauthorized: ['需要重新连接', '配对已失效，点击连接并测试可重新配对。', 'warning'],
      incompatible: ['连接组件需要更新', '重新复制配置提示词给 Agent，完成更新后再试。', 'warning'],
      offline: ['暂时未连接', '点击连接并测试可启动本机服务并重试。', 'warning'],
      disconnecting: ['正在断开', '请等待当前操作完成。', 'busy'],
      error: ['连接尚未确认', '请重新测试；仍未成功时，复制配置提示词让 Agent 修复。', 'warning'],
      unknown: ['正在读取连接状态', '稍候即可查看连接结果。', 'idle']
    };
    const [title, detail, tone] = views[state] || views.unknown;
    return { state, title, detail, tone };
  }

  // One explicit action owns startup, pairing, opening the host and checking it.
  // A successful browser probe is not a claim that the selected external client
  // has discovered its MCP tools or that an official model account is signed in.
  async function connectAndTestAgent(options) {
    const progress = options.progress || (() => {});
    const alive = () => { if (options.signal?.aborted) throw Object.assign(Error('CANCELLED'), { code: 'CANCELLED' }); };
    const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const native = options.native || requestNativeAgentConnection;
    alive(); progress('正在检查连接…');
    let status = await options.status(); alive();
    if (status?.bridge?.state === 'multiple') return status;
    if (!options.manualPairing && !['connected', 'connecting', 'waiting', 'paused'].includes(status?.bridge?.state)) {
      progress('正在启动并配对…');
      const receipt = await native('pair'); alive();
      const config = { server: receipt.serverUrl, token: receipt.pairing.token };
      delete receipt.pairing;
      try { await options.pair(config); } finally { config.token = ''; }
      alive(); status = await options.status();
    } else if (status?.bridge?.state === 'paused') {
      await options.reconnect(); alive(); status = await options.status();
    }
    if (status?.bridge?.state === 'waiting' && options.openWorkbench) {
      progress('正在打开工作台…');
      await options.openWorkbench({ active: false }); alive();
    }
    const waitForHost = async () => {
      for (let i = 0; i < (options.pollAttempts ?? 60); i++) {
        status = await options.status(); alive();
        if (!['waiting', 'connecting'].includes(status?.bridge?.state) && !(status?.bridge?.configured && ['unpaired', 'unknown'].includes(status?.bridge?.state))) break;
        progress('正在等待工作台连接…'); await sleep(500); alive();
      }
    };
    await waitForHost();
    if (status?.bridge?.state === 'offline' && !options.manualPairing) {
      progress('正在恢复本机服务…');
      const receipt = await native('pair'); alive();
      const config = { server: receipt.serverUrl, token: receipt.pairing.token }; delete receipt.pairing;
      try { await options.pair(config); } finally { config.token = ''; }
      alive(); await waitForHost();
    }
    if (status?.bridge?.state === 'connected') {
      progress('正在测试连接…'); await options.check(); alive();
      status = await options.status();
    }
    return status;
  }

  function showAgentConnectionCenter(options) {
    if (!options.settingsOwner) return showAgentModuleStatus(options);
    const doc = options.document;
    const existing = doc.querySelector('.brevess-agent-connection');
    if (existing) { existing.querySelector('select')?.focus(); return { dialog: existing }; }
    const dialog = doc.createElement('dialog');
    dialog.className = 'brevess-agent-connection'; dialog.setAttribute('aria-label', '连接 Agent');
    dialog.setAttribute('data-action-icon', 'none');
    const style = doc.createElement('style');
    style.textContent = `
      body dialog.brevess-agent-connection {box-sizing:border-box;width:min(500px,calc(100vw - 32px));max-height:calc(100dvh - 40px);overflow:auto;padding:28px;border:1px solid #e7e7e9;border-radius:20px;background:#fff;color:#222;box-shadow:0 24px 90px #0002;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
      .brevess-agent-connection::backdrop {background:#17171750;backdrop-filter:blur(3px)}
      .brevess-agent-connection [hidden] {display:none!important}
      .brevess-agent-connection .agent-head {display:flex;align-items:center;justify-content:space-between;margin:0 0 8px}
      .brevess-agent-connection h2 {font-size:22px;line-height:1.3;letter-spacing:-.5px;margin:0;font-weight:650}
      .brevess-agent-connection p {margin:0;overflow-wrap:anywhere}
      .brevess-agent-connection .agent-subtitle {color:#787b80;font-size:13px;margin-bottom:24px}
      .brevess-agent-connection .agent-label {display:block;font-size:12px;font-weight:600;color:#64686d;margin-bottom:8px}
      dialog.brevess-agent-connection :is(select,input) {box-sizing:border-box;display:block;width:100%;height:44px;padding:9px 12px;border:1px solid #dddfe2;border-radius:10px;background:#fff;color:#222;font:inherit}
      .brevess-agent-connection .agent-capability {font-size:12px;color:#777b81;margin-top:8px;min-height:18px}
      .brevess-agent-connection .agent-primary-actions {display:flex;gap:10px;margin-top:22px}
      dialog.brevess-agent-connection button {box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:auto;height:auto;min-height:38px;margin:0;padding:9px 14px;gap:6px;border:1px solid #e2e3e5;border-radius:10px;background:#fff;color:#25272b;font-family:inherit;font-size:13px;font-weight:500;line-height:1.4;cursor:pointer;box-shadow:none}
      dialog.brevess-agent-connection .agent-primary-actions button {flex:1;min-height:42px;white-space:nowrap}
      dialog.brevess-agent-connection .agent-primary {background:#222;color:#fff;border-color:#222}
      dialog.brevess-agent-connection button:hover:not(:disabled) {background:#f4f4f5}
      dialog.brevess-agent-connection .agent-primary:hover:not(:disabled) {background:#3a3a3a}
      dialog.brevess-agent-connection button:disabled {opacity:.5;cursor:default}
      dialog.brevess-agent-connection .agent-close {flex:none;padding:5px;min-height:28px;width:28px;height:28px;border:0;background:transparent;color:#777;font-size:24px;font-weight:300;line-height:1}
      .brevess-agent-connection :is(button,select,input,summary):focus-visible {outline:2px solid #3866ba;outline-offset:3px}
      .brevess-agent-connection .agent-result {display:flex;align-items:flex-start;gap:11px;margin:22px 0 18px;padding:15px 16px;border-radius:12px;background:#f6f6f7}
      .brevess-agent-connection .agent-result-icon {width:18px;height:18px;flex:none;margin-top:2px;color:#92969c}
      .brevess-agent-connection .agent-result-icon svg {width:18px;height:18px;display:block}
      .brevess-agent-connection .agent-result[data-state="success"] .agent-result-icon {color:#24815b}
      .brevess-agent-connection .agent-result[data-state="warning"] .agent-result-icon,.brevess-agent-connection .agent-result[data-state="error"] .agent-result-icon {color:#a46b17}
      .brevess-agent-connection .agent-result[data-state="busy"] .agent-result-icon {animation:agent-connect-spin 1.2s linear infinite}
      .brevess-agent-connection .agent-result-title {font-size:13px;font-weight:600;line-height:1.5}
      .brevess-agent-connection .agent-result-detail {color:#72767c;font-size:12px;line-height:1.6;margin-top:4px}
      dialog.brevess-agent-connection .agent-text-action {padding:0;min-height:24px;border:0;background:none;color:#30343a;font-size:12px;text-decoration:underline;text-underline-offset:3px;margin-top:8px}
      .brevess-agent-connection details {border-top:1px solid #ededee;padding-top:14px;margin-top:18px}
      .brevess-agent-connection summary {font-size:12px;color:#7a7e83;cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between}
      .brevess-agent-connection summary::-webkit-details-marker {display:none}
      .brevess-agent-connection summary::after {content:'⌄';font-size:16px}
      .brevess-agent-connection details[open]>summary::after {content:'⌃'}
      .brevess-agent-connection .agent-advanced-body {padding-top:16px}
      .brevess-agent-connection .agent-advanced-actions {display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .brevess-agent-connection .agent-advanced-body p {font-size:12px;color:#777b81;margin:10px 0}
      .brevess-agent-connection .agent-diagnostic {font-size:11px;color:#85898e;white-space:pre-wrap;overflow-wrap:anywhere}
      .brevess-agent-connection .agent-manual {margin-top:18px}
      .brevess-agent-connection a {color:inherit;font-size:12px;text-underline-offset:3px}
      @keyframes agent-connect-spin {to {transform:rotate(360deg)}}
      @media(max-width:420px) {dialog.brevess-agent-connection {padding:22px;width:calc(100vw - 24px)}.brevess-agent-connection .agent-primary-actions {gap:8px}dialog.brevess-agent-connection .agent-primary-actions button {padding:10px 8px;font-size:12px}}
      @media(prefers-reduced-motion:reduce) {.brevess-agent-connection .agent-result[data-state="busy"] .agent-result-icon {animation:none}}
    `;
    dialog.append(style);
    const add = (tag, text, parent = dialog, cls = '') => { const node = doc.createElement(tag); node.textContent = text || ''; if (cls) node.className = cls; parent.append(node); return node; };
    const head = add('div', '', dialog, 'agent-head'); add('h2', '连接 Agent', head);
    const close = add('button', '×', head, 'agent-close'); close.type = 'button'; close.setAttribute('aria-label', '关闭'); close.onclick = () => dialog.close();
    add('p', '让常用 Agent 直接读取文献、协作课题。', dialog, 'agent-subtitle');
    const label = add('label', '选择你的 Agent', dialog, 'agent-label'); label.htmlFor = 'agentSetupClient';
    const select = add('select'); select.id = 'agentSetupClient';
    const clients = globalThis.SciLLM.getAgentSetupClients();
    for (const [name, predicate] of [['常用', c => !!c.modelAdapter], ['国内 Agent', c => c.region === 'cn' && !c.modelAdapter], ['其他 Agent', c => !c.modelAdapter && c.region !== 'cn']]) {
      const group = add('optgroup', '', select); group.label = name;
      for (const client of clients.filter(predicate)) { const item = add('option', client.label, group); item.value = client.id; }
    }
    let preferred = options.client;
    try { preferred ||= doc.defaultView.sessionStorage?.getItem('brevess-agent-setup-client'); } catch {}
    if (clients.some(c => c.id === preferred)) select.value = preferred;
    const capability = add('p', '', dialog, 'agent-capability');
    const updateClient = () => {
      const client = clients.find(c => c.id === select.value);
      capability.textContent = client?.modelAdapter ? '连接测试通过后，自动加入问答模型列表。' : '支持 Agent 读取与操作；暂不支持在插件内调用该 Agent。';
      try { doc.defaultView.sessionStorage?.setItem('brevess-agent-setup-client', select.value); } catch {}
    };
    select.onchange = updateClient; updateClient();
    const primaryRow = add('div', '', dialog, 'agent-primary-actions');
    const result = add('div', '', dialog, 'agent-result'); result.setAttribute('role', 'status'); result.setAttribute('aria-live', 'polite'); result.setAttribute('aria-atomic', 'true');
    const glyph = add('span', '', result, 'agent-result-icon'); glyph.setAttribute('aria-hidden', 'true');
    const resultCopy = add('div', '', result); const title = add('div', '', resultCopy, 'agent-result-title'); const detail = add('p', '', resultCopy, 'agent-result-detail');
    const advanced = add('details'); add('summary', '高级选项', advanced); const advancedBody = add('div', '', advanced, 'agent-advanced-body');
    const diagnostic = add('p', '', advancedBody, 'agent-diagnostic');
    const controller = new AbortController(); const actions = []; let busy = false, latest = null, tested = false, epoch = 0, loginAction = null;
    const report = (headline, description = '', tone = 'idle') => {
      if (!dialog.isConnected) return;
      title.textContent = headline; detail.textContent = description; result.dataset.state = tone;
      const path = tone === 'success' ? 'M5 12l4 4L19 6' : tone === 'busy' ? 'M20 12a8 8 0 1 1-5-7.4' : 'M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0';
      glyph.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + path + '"/></svg>';
    };
    const knownErrors = {
      AGENT_CONNECTION_NATIVE_UNAVAILABLE: '先复制配置提示词给 Agent，完成配置后再连接。',
      AGENT_NOT_INSTALLED: '先复制配置提示词给 Agent，完成配置后再连接。',
      AGENT_CONNECTION_TIMEOUT: '连接超时，请确认客户端配置已完成后重试。',
      AGENT_CONNECTION_BUSY: '另一项连接操作正在进行，请稍后重试。',
      AGENT_CONNECTION_COMPONENT_UPDATE_REQUIRED: '请重新复制配置提示词，让 Agent 更新连接组件。',
      AGENT_INSTALLATION_MISMATCH: '请重新复制配置提示词，让 Agent 修复安装路径。',
      AGENT_ORIGIN_MISMATCH: '请重新复制配置提示词，匹配当前安装的 BREVESS。',
      SERVICE_RESTART_REQUIRED: '连接组件已更新。请在高级选项断开连接，退出旧客户端连接后重试。',
      MCP_BRIDGE_CONFIG_INVALID: '配对链接无效，请使用本机服务提供的完整链接。',
      CANCELLED: '连接操作已停止，可重新测试。'
    };
    const errorView = error => {
      const code = typeof error?.code === 'string' && /^(?:AGENT|MCP|SERVICE|BRIDGE|DOCUMENT)_[A-Z_]{1,70}$/.test(error.code) ? error.code : 'AGENT_CONNECTION_FAILED';
      diagnostic.textContent = '诊断代码：' + code;
      report('连接未完成', knownErrors[code] || '请重试；仍未成功时，复制配置提示词让 Agent 检查。', 'error');
    };
    const render = status => {
      if (loginAction) loginAction.hidden = true;
      latest = status;
      const view = agentConnectionView(status, tested);
      report(view.title, view.detail, view.tone);
      connectButton.textContent = view.state === 'connected' ? '重新测试' : '连接并测试';
      readButton.hidden = view.state !== 'connected';
      diagnostic.textContent = ['连接：' + view.state, '权限：' + (status?.permission || '由任务单独确认')].join('\n');
      disconnectButton.hidden = ['unpaired', 'paused', 'unknown'].includes(view.state);
      forgetButton.hidden = view.state === 'unpaired';
    };
    select.onchange = () => { updateClient(); tested = false; if (latest) render(latest); };
    const refresh = async () => {
      const version = ++epoch; const status = await options.status();
      if (dialog.isConnected && version === epoch && !busy && (!latest || status?.bridge?.state !== latest?.bridge?.state)) { tested = false; render(status); }
      return status;
    };
    const button = (text, parent, handler, cls = '') => {
      const node = add('button', text, parent, cls); node.type = 'button'; actions.push(node);
      node.onclick = async () => {
        if (busy) return;
        busy = true; epoch++; select.disabled = true; actions.forEach(a => { a.disabled = true; }); node.setAttribute('aria-busy', 'true');
        try { await handler(); } catch (error) { if (dialog.isConnected) errorView(error); }
        finally { busy = false; node.removeAttribute('aria-busy'); select.disabled = false; actions.forEach(a => { a.disabled = false; }); }
      };
      return node;
    };
    const copyButton = button('复制配置提示词', primaryRow, async () => {
      const copied = await globalThis.SciLLM.copyAgentSetupPrompt(select.value, { document: doc });
      const name = clients.find(c => c.id === select.value)?.label || 'Agent';
      report(copied.copied ? '提示词已复制' : '请复制提示词', '粘贴到 ' + name + '，待配置完成后回来点击连接并测试。');
    }); copyButton.id = 'copyAgentSetupPrompt';
    if (options.loginModel) {
      loginAction = button('登录 Codex', resultCopy, async () => {
        try {
          await options.loginModel('codex');
          report('官方登录页已打开', '完成登录后回到这里，点击“重新测试”即可加入问答模型。', 'warning');
        } catch {
          report('登录页未能打开', '请重新点击登录；仍未成功时检查本机 Codex 连接。', 'warning');
        }
      }, 'agent-text-action');
      loginAction.id = 'loginAgentModel'; loginAction.hidden = true;
    }
    const connectModel = async () => {
      if (loginAction) loginAction.hidden = true;
      if (!tested || !dialog.isConnected || !options.connectModel || !clients.find(c => c.id === select.value)?.modelAdapter) return;
      report('正在测试 Agent 问答', '使用一条简短测试消息；通过后自动加入模型列表。', 'busy');
      try {
        const profile = await options.connectModel(select.value);
        if (profile) report('浏览器与问答连接测试通过', `已加入问答模型：${profile.name} · ${profile.model}。可在问答中直接切换。`, 'success');
      } catch (error) {
        const help = {
          CODEX_NOT_AUTHENTICATED: loginAction ? 'Codex 尚未登录。点击下方“登录 Codex”，完成后回来重新测试。' : 'Codex 尚未登录插件专用会话，请到模型连接中完成登录后重试。',
          HARNESS_NOT_AUTHENTICATED: '请先在官方 DeepSeek Harness 中登录，再回来重新测试。',
          HARNESS_MODEL_UNAVAILABLE: '已保存的 Harness 模型当前不可用，请在模型连接中更换后重试。',
          AGENT_PROFILE_CHANGED: '连接配置已在其他窗口变化，请重新测试。',
          AI_PRIVACY_ACK_REQUIRED: '请先在设置中确认 AI 隐私提醒，再重新测试。'
        };
        if (loginAction) loginAction.hidden = error.code !== 'CODEX_NOT_AUTHENTICATED' || select.value !== 'codex';
        report('浏览器已连接，问答尚未就绪', help[error.code] || '模型调用未通过测试；请检查官方账号登录和本机组件后重试。', 'warning');
      }
    };
    const connectButton = button('连接并测试', primaryRow, async () => {
      tested = false;
      const status = await connectAndTestAgent({ ...options, signal: controller.signal, progress: text => report(text, '', 'busy') });
      tested = status?.bridge?.state === 'connected'; render(status);
      await connectModel();
    }, 'agent-primary'); connectButton.id = 'testAgentConnection';
    const readButton = button('复制试读指令', resultCopy, async () => {
      const text = '请使用 BREVESS MCP：先调用 brevess.status 和 brevess.capabilities，再调用 library.query_global_library（pageSize: 3）。只返回连接是否正常、文献总数及最多 3 篇标题。不要创建或修改资料；若工具未加载，请检查当前客户端的 MCP 配置并重新加载。';
      await doc.defaultView.navigator.clipboard.writeText(text);
      report('试读指令已复制', '粘贴到所选 Agent，核对它是否能读到你的文献。', 'success');
    }, 'agent-text-action'); readButton.hidden = true;
    const advancedActions = add('div', '', advancedBody, 'agent-advanced-actions');
    if (options.openWorkbench) button('打开工作台', advancedActions, async () => { await options.openWorkbench({ active: true }); render(await options.status()); });
    const disconnectButton = button('断开连接', advancedActions, async () => { await options.disconnect(); tested = false; render(await options.status()); });
    const forgetButton = button('移除配对', advancedActions, async () => {
      if (!doc.defaultView.confirm('移除本机配对？文献和课题会保留，再次连接时需要重新配对。')) return;
      await options.forget(); tested = false; render(await options.status());
    });
    if (options.revoke) button('撤回写入权限', advancedActions, async () => { await options.revoke(); render(await options.status()); });
    if (options.pair) {
      const manual = add('div', '', advancedBody, 'agent-manual');
      const manualLabel = add('label', '手动配对', manual, 'agent-label'); manualLabel.htmlFor = 'agentPairingLink';
      const input = add('input', '', manual); input.id = 'agentPairingLink'; input.type = 'password'; input.autocomplete = 'off'; input.placeholder = '粘贴本机配对链接';
      const row = add('div', '', manual, 'agent-advanced-actions');
      button('使用此链接连接', row, async () => {
        let config;
        try { config = parseAgentPairingLink(input.value); } catch { throw Object.assign(Error('invalid pairing link'), { code: 'MCP_BRIDGE_CONFIG_INVALID' }); }
        input.value = '';
        try { await options.pair(config); } finally { config.token = ''; }
        const status = await connectAndTestAgent({ ...options, manualPairing: true, signal: controller.signal, progress: text => report(text, '', 'busy') });
        tested = status?.bridge?.state === 'connected'; render(status);
        await connectModel();
      });
    }
    add('p', 'Codex 与 DSH 会同时测试问答调用；其他客户端检查浏览器连接。写入文献或课题时仍需授权。', advancedBody);
    if (options.readmeUrl) { const link = add('a', '接入说明', advancedBody); link.href = options.readmeUrl; link.target = '_blank'; link.rel = 'noopener'; }
    const onStatus = () => { if (!busy) void refresh().catch(errorView); };
    doc.defaultView.addEventListener('brevess:mcp-status', onStatus);
    const timer = setInterval(() => { if (!busy && dialog.open && doc.visibilityState !== 'hidden') void refresh().catch(errorView); }, 5000);
    dialog.addEventListener('close', () => { controller.abort(); epoch++; clearInterval(timer); doc.defaultView.removeEventListener('brevess:mcp-status', onStatus); dialog.remove(); }, { once: true });
    doc.body.append(dialog); dialog.showModal();
    report('正在读取连接状态', '', 'busy'); void refresh().catch(errorView);
    return { dialog, refresh };
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
  return{showAgentConnectionCenter,parseAgentPairingLink,requestNativeAgentConnection,connectAndTestAgent,startCodexAgentLogin,agentConnectionView,AGENT_SETUP_PROMPT:SETUP_PROMPT};
});
