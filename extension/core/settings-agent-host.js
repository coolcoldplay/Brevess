(() => {
  'use strict';
  const M=globalThis.Workbench,connections=globalThis.BrevessAgentConnections;
  const permissions=M.agentPermissions,archive=M.createAgentConversations(),scope='settings:assistant';
  const pages={models:'模型与连接',privacy:'隐私与权限',modes:'阅读情境',reading:'阅读与高亮',voice:'语音朗读',notes:'问答与笔记','reading-preferences':'网页滤镜',data:'数据与备份',shortcuts:'通用',about:'关于 BREVESS'};
  let bridge,closed=false,retry,delay=300,runner,lease,active=false;
  async function context(){
    await permissions.refresh();if(!permissions.snapshot().read)return permissions.redactContext({});
    const state=await chrome.runtime.sendMessage({type:'LLM_GET_SETTINGS'});
    return {surface:'settings',page:new URLSearchParams(location.hash.slice(1)).get('page')||'models',pages,connections:Object.values(state?.data?.settings?.profiles||{}).map(p=>({name:p.name,provider:p.providerId,model:p.config?.model}))};
  }
  const host={projectId:scope,label:'BREVESS 设置',get allowHistory(){return permissions.snapshot().read;},
    claim(id){lease=id;},release(id){if(lease===id){lease=null;runner?.cancel();}},
    async connect({providerId,model}){const info=await connections.connect(providerId,model);return {label:info.label,models:info.models,model:info.model,perModel:info.perModel,delegated:info.delegated};},
    async conversations({action,id}){await permissions.refresh();if(!permissions.snapshot().read)return {denied:true};
      if(action==='new'||action==='select'){if(active)throw Error('Agent 正在回答');await archive.select(scope,action==='new'?null:id);}
      const list=await archive.list(scope);return {...list,turns:await archive.read(scope,list.current)};},
    async start(args,emit){
      if(active||!lease)throw Error('Agent 正忙或连接已变化');active=true;const owner=lease,events=[];let turn;
      const assertOwner=()=>{if(lease!==owner)throw Object.assign(new Error('设置侧栏已切换'),{code:'WORKBENCH_AGENT_BINDING_EXPIRED'});};
      try{
        const info=await connections.connect(args.providerId,args.model),entry=info.models.find(m=>m.id===args.model);
        assertOwner();if(!entry)throw Object.assign(new Error('模型已变化'),{code:'WORKBENCH_AGENT_MODEL_UNAVAILABLE'});
        await permissions.refresh();const remember=permissions.snapshot().read;
        const previous=remember&&args.threadId?M.agentConversationContext(await archive.read(scope,args.threadId)):[];
        assertOwner();if(remember)turn=await archive.begin(scope,args.threadId,args.task,args.providerId,args.model);
        assertOwner();
        runner=M.createAgentRunner({tools:{context,definitions:[],execute:()=>{throw Error('此处只提供设置说明');},redactReceipts:r=>permissions.redactReceipts(r)},transport:info.transport,
          systemInstructions:'You are the BREVESS settings assistant. Explain the selected settings and guide the user to the appropriate named page. Settings are changed in the UI by the user. Do not request keys. Return JSON {"message":"answer in the user language","calls":[]}.',
          onEvent:e=>{events.push(e);emit(e);}});
        const r=await runner.run(args.task,{providerId:args.providerId,model:args.model,reasoningEffort:connections.checkEffort(entry,args.reasoningEffort),previous});return {status:r.status,threadId:turn?.thread};
      }finally{try{if(turn)await archive.finish(turn,events,events.at(-1)?.type||'interrupted');}finally{runner=null;active=false;}}
    },cancel(){runner?.cancel();return {cancelled:true};}
  };
  const stopOnPermissionChange=permissions.subscribe(()=>runner?.cancel());
  function lost(){if(!closed){clearTimeout(retry);retry=setTimeout(attach,delay);delay=Math.min(delay*2,8000);}}
  async function attach(){try{const tab=await chrome.tabs.getCurrent();if(closed||!Number.isInteger(tab?.id))return;
    bridge=BrevessR20AgentBridge.connectSource({host,connect:()=>chrome.runtime.connect({name:'r20-agent-host:'+tab.id}),onDisconnect:lost,onRegistered:()=>{delay=300;}});
  }catch{lost();}}
  void attach();window.addEventListener('pagehide',()=>{closed=true;clearTimeout(retry);stopOnPermissionChange();runner?.cancel();bridge?.close();},{once:true});
})();
