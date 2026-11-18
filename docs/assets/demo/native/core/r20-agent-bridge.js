(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BrevessR20AgentBridge=api;})(globalThis,()=>{
 'use strict';
 const methods=new Set(['connect','start','cancel']),error=code=>({code,message:'Agent 工作台连接已变化，请在当前工作台重新打开侧栏。'});
 function createBroker({base,verifyHost,verifySidebar,activeTab,frame,id=()=>crypto.randomUUID()}){
  const hosts=new Map(),sides=new Set();const send=(port,message)=>{try{port.postMessage(message)}catch{}};
  function drop(side,reason='WORKBENCH_AGENT_BINDING_EXPIRED'){side.generation++;const b=side.binding;if(b){send(b.host.port,{type:'release',bindingId:b.id});if(b.host.side===side)b.host.side=null;}side.binding=null;send(side.port,{type:'binding_lost',error:error(reason)});}
  async function bind(side){if(!side.alive)return;if(side.binding)drop(side);const generation=++side.generation,live=()=>side.alive&&side.generation===generation;const tab=await activeTab(side.windowId);if(!live())return;const host=hosts.get(tab?.id);if(!host?.ready||tab.url?.split(/[?#]/)[0]!==base+'workbench/index.html'||tab.windowId!==side.windowId)throw error('WORKBENCH_AGENT_HOST_UNAVAILABLE');const sourceSession=host.sourceSession,current=await frame(tab.id);if(!live())return;if(hosts.get(tab.id)!==host||host.sourceSession!==sourceSession)throw error('WORKBENCH_AGENT_HOST_UNAVAILABLE');if(current?.documentId!==host.documentId)throw error('WORKBENCH_AGENT_DOCUMENT_EXPIRED');if(host.side&&host.side!==side)throw error('WORKBENCH_AGENT_ALREADY_OPEN');const binding={id:id(),host,lastSeq:0};side.binding=binding;host.side=side;send(host.port,{type:'bind',bindingId:binding.id,sourceSession});send(side.port,{type:'bound',bindingId:binding.id,sourceSession,windowId:side.windowId,projectId:host.projectId,label:host.label||'课题工作台',history:host.history||[]});}
  async function attach(port){
   if(!['r20-agent-host','r20-agent-sidebar'].includes(port.name))return;
   let dispatch=null,disconnected=false;const queue=[];port.onDisconnect.addListener(()=>disconnected=true);port.onMessage.addListener(message=>{if(dispatch)dispatch(message);else if(queue.length<16)queue.push(message);else port.disconnect();});const listen=fn=>{dispatch=fn;for(const message of queue.splice(0))fn(message);};
   if(port.name==='r20-agent-host'){
    if(!await verifyHost(port.sender)||disconnected){send(port,{type:'error',error:error('WORKBENCH_AGENT_HOST_INVALID')});port.disconnect();return;}
    const tab=port.sender.tab,previous=hosts.get(tab.id);if(previous?.side)drop(previous.side);const host={port,documentId:port.sender.documentId,tabId:tab.id,ready:false,side:null};hosts.set(tab.id,host);
    listen(message=>{if(hosts.get(tab.id)!==host)return;if(message.type==='ready'){host.ready=true;host.sourceSession=message.sourceSession;host.projectId=message.projectId;host.label=message.label;host.history=message.history||[];send(host.port,{type:'registered',sourceSession:host.sourceSession});}
     else if(message.type==='context'){host.projectId=message.projectId;host.label=message.label;host.history=message.history||[];if(host.side)drop(host.side,'WORKBENCH_AGENT_PROJECT_CHANGED');}
     else if(message.type==='history'&&message.projectId===host.projectId)host.history=message.history||[];
     else if(['response','event'].includes(message.type)){const side=host.side;if(side?.binding?.id===message.bindingId)send(side.port,message);}
    });
    port.onDisconnect.addListener(()=>{if(hosts.get(tab.id)===host)hosts.delete(tab.id);if(host.side)drop(host.side,'WORKBENCH_AGENT_SOURCE_CLOSED');});return;
   }
   if(port.name!=='r20-agent-sidebar')return;
   const verified=await verifySidebar(port.sender);if(!verified||disconnected){send(port,{type:'error',error:error('WORKBENCH_AGENT_SIDEBAR_INVALID')});port.disconnect();return;}
   const side={port,windowId:verified.windowId,binding:null,alive:true,generation:0};sides.add(side);
   listen(message=>{void(async()=>{try{
    if(message.type==='bind')return await bind(side);if(message.type!=='request')throw error('WORKBENCH_AGENT_REQUEST_INVALID');const b=side.binding;
    if(!b||b.id!==message.bindingId||!methods.has(message.method)||!Number.isSafeInteger(message.seq)||message.seq<1)throw error('WORKBENCH_AGENT_BINDING_EXPIRED');
    if(message.seq<=b.lastSeq)return;b.lastSeq=message.seq;
    if(JSON.stringify(message.args||{}).length>40000)throw error('WORKBENCH_AGENT_REQUEST_INVALID');const tab=await activeTab(side.windowId),current=await frame(b.host.tabId);
    if(side.binding!==b||tab?.id!==b.host.tabId||current?.documentId!==b.host.documentId||message.projectId!==b.host.projectId)throw error('WORKBENCH_AGENT_BINDING_EXPIRED');
    send(b.host.port,{...message,sourceSession:b.host.sourceSession});
   }catch(e){send(port,{type:message.type==='bind'?'error':'response',seq:message.seq,bindingId:message.bindingId,error:error(e.code||'WORKBENCH_AGENT_BRIDGE_FAILED')});}})();});
   port.onDisconnect.addListener(()=>{side.alive=false;drop(side,'WORKBENCH_AGENT_SIDEBAR_CLOSED');sides.delete(side)});
  }
  return {attach};
 }
 function connectSource({connect,host,id=()=>crypto.randomUUID(),onDisconnect=()=>{}}){
  const sourceSession=id(),port=connect(),send=m=>{try{port.postMessage(m)}catch{}},history=[];let bindingId=null,closed=false,lastSeq=0;
  const context=()=>({projectId:host.projectId,label:host.label||'课题工作台',history:host.allowHistory===false?[]:history});
  send({type:'ready',sourceSession,...context()});
  port.onMessage.addListener(message=>{void(async()=>{if(closed)return;
   if(message.type==='bind'&&message.sourceSession===sourceSession){if(bindingId)host.release(bindingId);bindingId=message.bindingId;lastSeq=0;host.claim(bindingId);return;}
   if(message.type==='release'&&message.bindingId===bindingId){host.release(bindingId);bindingId=null;return;}
   if(message.type!=='request')return;const current=message.bindingId;
   try{if(!bindingId||current!==bindingId||message.sourceSession!==sourceSession||(message.method!=='cancel'&&message.projectId!==host.projectId)||!methods.has(message.method)||message.seq<=lastSeq)throw error('WORKBENCH_AGENT_BINDING_EXPIRED');lastSeq=message.seq;
    const beforeProject=host.projectId;let result;if(message.method==='connect')result=await host.connect(message.args);else if(message.method==='cancel')result=await host.cancel();else{const task={task:message.args.task,events:[]};history.push(task);if(history.length>100)history.shift();try{result=await host.start(message.args,event=>{task.events.push(event);if(task.events.length>300)task.events.shift();if(bindingId===current)send({type:'event',bindingId:current,seq:message.seq,event});});}finally{send({type:'history',projectId:host.projectId,history:host.allowHistory===false?[]:history});}}
    if(bindingId!==current||closed)throw error('WORKBENCH_AGENT_BINDING_EXPIRED');send({type:'response',bindingId:current,seq:message.seq,result});if(host.projectId!==beforeProject){send({type:'context',...context()});}
   }catch(e){send({type:'response',bindingId:current,seq:message.seq,error:{code:e.code||'WORKBENCH_AGENT_FAILED',message:e.message||'Agent 未完成操作。'}});}
  })();});
  port.onDisconnect.addListener(()=>{closed=true;if(bindingId)host.release(bindingId);bindingId=null;onDisconnect()});
  return{contextChanged(){if(closed)return;if(bindingId)host.release(bindingId);bindingId=null;history.length=0;send({type:'context',...context()})},close(){if(bindingId)host.release(bindingId);closed=true;port.disconnect();}};
 }
 return {createBroker,connectSource};
});
