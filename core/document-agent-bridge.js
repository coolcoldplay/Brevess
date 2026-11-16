(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.SciLLM ||= {},api);})(globalThis,function(){
  'use strict';
  const PORT='BREVESS_DOCUMENT_AGENT',MESSAGE='BREVESS_DOCUMENT_AGENT_CALL';
  const allowed=new Set(['ppt.prepare','ppt.status','ppt.get_manifest','ppt.read_chunk','ppt.cancel','mechanism.read_context','mechanism.list_evidence','mechanism.apply_commands','mechanism.read_receipt','brevess.request_document_write_scope','brevess.revoke_document_write_scope']);
  const fault=(code,details)=>Object.assign(new Error(code),{code,...(details?{details}:{})});
  function createDocumentAgentBroker(options){
    const entries=new Set();
    function invalidate(entry){
      try{entry.port.postMessage({kind:'revoke'});}catch(_){}
      entry.drop();try{entry.port.disconnect();}catch(_){}
    }
    async function authorizeEntry(entry){
      try{await options.authorizeUi(entry.port.sender,entry.owner,entry.binding);}
      catch(error){invalidate(entry);throw error;}
    }
    function connect(port){
      if(port.name!==PORT)return;
      const entry={port,owner:null,binding:null,closed:false,requests:new Map(),authority:null,sourceKey:''};entries.add(entry);
      const drop=()=>{entry.closed=true;entries.delete(entry);for(const row of entry.requests.values()){clearTimeout(row.timer);row.reject(fault('DOCUMENT_UI_CLOSED'));}entry.requests.clear();};
      entry.drop=drop;
      port.onDisconnect.addListener(drop);
      port.onMessage.addListener(async message=>{
        if(message?.kind==='register'){
          if(entry.owner)return;
          try{const owner=await options.authorizeUi(port.sender,null,message.binding);if(entry.closed)return;entry.owner=owner;entry.binding=message.binding;port.postMessage({kind:'ready'});}catch(_){drop();try{port.disconnect();}catch(_){}}
        }else if(message?.kind==='result'){
          const row=entry.requests.get(message.id);if(!row)return;entry.requests.delete(message.id);clearTimeout(row.timer);
          if(message.success===true)row.resolve(message.data);else row.reject(Object.assign(fault(message.error?.code||'DOCUMENT_HOST_FAILED'),{details:message.error?.details}));
        }
      });
    }
    function send(entry,name,args,meta){return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{entry.requests.delete(id);reject(fault('DOCUMENT_HOST_TIMEOUT'));},20000);entry.requests.set(id,{resolve,reject,timer});try{entry.port.postMessage({kind:'call',id,name,args,meta});}catch(error){clearTimeout(timer);entry.requests.delete(id);reject(error);}});}
    async function handle(message,sender){
      if(message?.type!==MESSAGE||!allowed.has(message.name))throw fault('DOCUMENT_TOOL_NOT_FOUND');
      await options.authorizeWorkbench(sender);
      const live=[];let rejectedOwner=false;
      for(const entry of entries){if(!entry.owner||entry.closed)continue;try{await authorizeEntry(entry);if(!entry.closed)live.push(entry);}catch(_){rejectedOwner=true;}}
      if(live.length!==1)throw fault(live.length?'DOCUMENT_CONTEXT_AMBIGUOUS':'DOCUMENT_CONTEXT_UNAVAILABLE',
        {stage:'document_routing',reason:live.length?'multiple_registered_ui':rejectedOwner?'ui_owner_invalid':entries.size?'ui_registration_pending':'no_registered_ui'});
      const entry=live[0],inspection=await send(entry,'inspect',{},{}),sourceKey=JSON.stringify([inspection.context.target,inspection.sourceTarget]);
      if(entry.sourceKey!==sourceKey){entry.sourceKey=sourceKey;entry.authority=options.sourceAuthority(entry.port.sender,entry.binding);}
      try{await entry.authority(inspection.sourceTarget);}catch(error){try{entry.port.postMessage({kind:'revoke'});}catch(_){}throw error;}
      await options.authorizeWorkbench(sender);
      let result,failure;
      try{result=await send(entry,message.name,message.args||{},message.meta||{});}catch(error){failure=error;}
      try{await entry.authority(inspection.sourceTarget);await authorizeEntry(entry);await options.authorizeWorkbench(sender);}
      catch(error){try{entry.port.postMessage({kind:'revoke'});}catch(_){}throw error;}
      if(failure)throw failure;
      return result;
    }
    return{connect,handle};
  }
  async function connectDocumentAgentHost(options){
    const binding=await options.captureOwner();
    if(options.signal?.aborted)throw fault('DOCUMENT_UI_CLOSED');
    const port=options.runtime.connect({name:PORT});
    return new Promise((resolve,reject)=>{
      let closed=false,ready=false;
      const fail=error=>{if(closed)return;closed=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);options.host.revoke();options.onConnection?.(false);reject(error);};
      const abort=()=>{fail(fault('DOCUMENT_UI_CLOSED'));try{port.disconnect();}catch(_){}};
      const timer=setTimeout(()=>{fail(fault('DOCUMENT_REGISTRATION_TIMEOUT'));try{port.disconnect();}catch(_){}},options.timeoutMs??5000);
      options.signal?.addEventListener('abort',abort,{once:true});
      port.onMessage.addListener(message=>{
        if(closed)return;
        if(message?.kind==='ready'){if(!ready){ready=true;clearTimeout(timer);options.onConnection?.(true);resolve(port);}return;}
        if(message?.kind==='revoke'){options.host.revoke();return;}
        if(!ready||message?.kind!=='call')return;
        Promise.resolve().then(()=>message.name==='inspect'?{context:options.host.execute('mechanism.read_context'),sourceTarget:options.sourceTarget()}:options.host.execute(message.name,message.args,message.meta)).then(data=>{if(!closed)port.postMessage({kind:'result',id:message.id,success:true,data});},error=>{try{if(!closed)port.postMessage({kind:'result',id:message.id,success:false,error:{code:error.code||'DOCUMENT_HOST_FAILED',details:error.details}});}catch(_){}}).catch(()=>fail(fault('DOCUMENT_UI_CLOSED')));
      });
      port.onDisconnect.addListener(()=>fail(fault('DOCUMENT_UI_CLOSED')));
      try{port.postMessage({kind:'register',binding});}catch(_){fail(fault('DOCUMENT_UI_CLOSED'));try{port.disconnect();}catch(_){}}
    });
  }
  function createDocumentAgentConnection(options){
    let port=null,pending=null,closed=false,generation=0,controller=null;
    const delays=options.retryDelays||[500,1500,4000];
    function connect(){
      if(closed)return Promise.reject(fault('DOCUMENT_UI_CLOSED'));
      if(pending)return pending;
      if(port)return Promise.resolve(port);
      const cycle=++generation;
      controller=new AbortController();
      const signal=controller.signal;
      pending=(async()=>{
        for(let attempt=0;;attempt++){
          if(closed||cycle!==generation)throw fault('DOCUMENT_UI_CLOSED');
          let registered=false;
          try{
            const next=await connectDocumentAgentHost({...options,signal,onConnection:value=>{
              if(closed||cycle!==generation)return;
              registered=value;
              options.onConnection?.(value);
              if(!value&&port){port=null;queueMicrotask(()=>{if(!closed&&!pending&&!port)void connect().catch(()=>{});});}
            }});
            if(closed||cycle!==generation||!registered){next.disconnect();throw fault('DOCUMENT_UI_CLOSED');}
            port=next;return port;
          }catch(error){
            if(closed||cycle!==generation)throw fault('DOCUMENT_UI_CLOSED');
            options.onError?.(error);
            if(attempt>=delays.length)throw error;
            await new Promise(resolve=>setTimeout(resolve,delays[attempt]));
          }
        }
      })().finally(()=>{if(cycle===generation){pending=null;options.onState?.();}});
      return pending;
    }
    function close(){closed=true;generation++;controller?.abort();options.host.revoke();try{port?.disconnect();}catch(_){}port=null;}
    return{connect,close,status:()=>({state:closed?'closed':port?'connected':pending?'connecting':'unavailable'})};
  }
  function showDocumentAgentApproval(document,request,decide){
    const dialog=document.createElement('dialog');dialog.className='workspace-figure-input-dialog';dialog.setAttribute('aria-label',request.kind==='delete'?'确认机制图删除':'授权 Agent 编辑本篇文献');
    Object.assign(dialog.style,{margin:'auto',padding:'20px',width:'min(560px, calc(100vw - 32px))',maxHeight:'calc(100vh - 32px)',overflow:'auto',boxSizing:'border-box',font:'14px/1.6 system-ui'});
    const add=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;dialog.append(el);return el;};
    add('h3',request.kind==='delete'?'确认删除以下对象':'授权 Agent 编辑本篇文献');add('p',request.title);add('p',request.kind==='delete'?'删除会一并移除所列关联联系和绑定。':`有效期 ${Math.round(request.ttlMs/60000)} 分钟；切换文献、关闭界面或撤回后失效。`);
    const labels={edit:'新增/编辑节点、联系和既有证据绑定',layout:'调整布局',delete:'允许提出删除（每次仍需确认）'};
    let deleteOption=null;
    if(request.kind==='delete')for(const object of request.objects)add('p',`${{node:'节点',edge:'联系',binding:'证据绑定'}[object.kind]||'对象'} · ${object.label||object.id}`);
    else for(const permission of request.operations){if(permission==='delete'){const label=add('label',''),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.documentAllowDelete='true';label.append(checkbox,document.createTextNode(labels[permission]));deleteOption=checkbox;}else add('p',labels[permission]);}
    const accept=add('button',request.kind==='delete'?'确认本次删除':'允许本篇文献'),cancel=add('button','取消');for(const button of [accept,cancel])Object.assign(button.style,{padding:'8px 12px',margin:'12px 8px 0 0',border:'1px solid #bdc9cd',borderRadius:'6px',background:'#fff',font:'inherit'});accept.dataset.documentApproval='allow';cancel.dataset.documentApproval='deny';let settled=false;
    const finish=value=>{if(settled)return;settled=true;const result=value&&request.kind==='scope'?{approved:true,operations:request.operations.filter(op=>op!=='delete'||deleteOption?.checked)}:value;dialog.close();dialog.remove();decide(result);};accept.onclick=()=>finish(true);cancel.onclick=()=>finish(false);dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});document.body.append(dialog);dialog.showModal();return()=>finish(false);
  }
  return{createDocumentAgentBroker,connectDocumentAgentHost,createDocumentAgentConnection,showDocumentAgentApproval,DOCUMENT_AGENT_MESSAGE:MESSAGE};
});
