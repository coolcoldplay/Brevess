(() => {
  const name='BREVESS_ARTICLE_PRESENTATION', operations=new Set(['open','image','publish','status','read','cancel']);
  // A port exists only for a short local receipt or one bounded chunk; the desktop task
  // is durable and never depends on this worker or on a long-lived runtime message.
  function native(op,args){
    return new Promise((resolve,reject)=>{
      const port=chrome.runtime.connectNative('com.sci_reader.codex_bridge'),requestId=crypto.randomUUID();
      let done=false;const finish=(fn,x)=>{if(done)return;done=true;clearTimeout(timer);try{port.disconnect();}catch{}fn(x);};
      const timer=setTimeout(()=>finish(reject,Error('本机 Agent 组件未响应，请在 Agent 连接中检查配置。')),25000);
      port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;finish(reject,Error('请在设置的 Agent 连接中安装或更新本机组件。'));});
      port.onMessage.addListener(m=>{if(m.requestId===requestId&&m.type==='presentation.'+op+'.result')finish(resolve,m);});
      port.postMessage({type:'presentation.'+op,requestId,args});
    });
  }
  // A settings window owns one synthetic WorkBuddy test. Generate its task ID
  // here so the desktop can claim exactly this task even when others are waiting.
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'brevess-workbuddy-setup-test') return;
    const sender = port.sender;
    if (sender?.id !== chrome.runtime.id || sender.frameId !== 0 ||
        sender.url?.split(/[?#]/)[0] !== chrome.runtime.getURL('options.html')) {
      port.disconnect(); return;
    }
    let stopped = false;
    port.onDisconnect.addListener(() => { stopped = true; });
    const id = crypto.randomUUID(), marker = 'BREVESS_' + crypto.randomUUID();
    const fail = code => Object.assign(new Error(code), {code});
    const send = value => { if (!stopped) port.postMessage(value); };
    const command = async (op, args = {}) => {
      const reply = await native(op, {id, ...args});
      if (!reply?.success) throw fail('AGENT_CONNECTOR_UNAVAILABLE');
      return reply.data;
    };
    void (async () => {
      let opened = false, finished = false;
      try {
        const riskKey = 'brevessAiPrivacyAcknowledgementV1';
        const risk = (await chrome.storage.local.get(riskKey))[riskKey];
        if (risk?.version !== 1 || risk.acknowledged !== true || !(risk.updatedAt > 0)) throw fail('AI_PRIVACY_ACK_REQUIRED');
        if (stopped) return;
        await command('open', {agent:'workbuddy', kind:'chat', documentHash:'setup:' + id,
          instructions:'Read paper.json and return the requested echo using brevess_complete_task.',
          materials:{systemPrompt:'BREVESS connection test. Return a JSON object with the requested marker as message and an empty calls array.', task:'Return this marker exactly: '+marker}});
        opened = true;
        if (stopped) return;
        await command('publish');
        send({stage:'pending',id});
        const until = Date.now() + 180000;
        let lastState = 'pending';
        while (!stopped && Date.now() < until) {
          const task = await command('status');
          if (task.id !== id || task.agent !== 'workbuddy' || task.kind !== 'chat') throw fail('AGENT_MODEL_TEST_FAILED');
          if (task.state === 'ready') {
            let message = task.answer;
            try { message = JSON.parse(message).message; } catch { /* Accept a plain text echo as well. */ }
            if (typeof message !== 'string' || message.trim() !== marker) throw fail('AGENT_MODEL_TEST_FAILED');
            finished = true; send({stage:'passed'}); return;
          }
          if (!['pending','working'].includes(task.state)) throw fail('AGENT_CLIENT_TURN_FAILED');
          if (task.state !== lastState) { lastState = task.state; send({stage:lastState,id}); }
          await new Promise(resolve => setTimeout(resolve, 850));
        }
        if (!stopped) throw fail('REQUEST_TIMEOUT');
      } catch (error) {
        send({stage:'error',code:error.code || 'AGENT_CONNECTOR_UNAVAILABLE'});
      } finally {
        if (opened && !finished) await command('cancel').catch(() => {});
      }
    })();
  });
  chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
    if(msg?.type!==name)return;
    const popup=sender.url?.split(/[?#]/)[0]===chrome.runtime.getURL('popup.html');
    const owned=sender.url?.split(/[?#]/)[0];
    const discovery=msg.op==='clients'&&['options.html','workbench/index.html','workbench/agent-sidebar.html'].some(path=>owned===chrome.runtime.getURL(path));
    const allowed=discovery || (popup ? ['setup','clients','respond'].includes(msg.op) : sender.tab&&sender.frameId===0&&operations.has(msg.op));
    if(sender.id!==chrome.runtime.id||!allowed){
      respond({success:false,error:'PPT_SENDER_INVALID'});return;
    }
    native(msg.op,msg.args||{}).then(respond,e=>respond({success:false,error:e.message}));
    return true;
  });
})();
