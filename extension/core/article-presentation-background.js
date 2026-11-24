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
