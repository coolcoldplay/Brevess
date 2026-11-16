(function(g){
  'use strict';const S=g.WFGSchema,M=g.WFGModel;
  function install({browser:b,createTask}){
    const repo=S.repository({readRaw:async()=>(await b.storage.local.get(S.KEY))[S.KEY],writeRaw:value=>b.storage.local.set({[S.KEY]:value})}),runs=new Map(),locks=new Map();
    const files=['schema.js','engine.js','ui.js','entry.js'].map(f=>'web-filters-general/'+f);
    async function rpc(tabId,frameId,command,data={}){const result=await b.tabs.sendMessage(tabId,{type:'WFG_FRAME',command,...data},{frameId});if(!result?.ok)throw Error(result?.error||'FRAME_UNAVAILABLE');return result.data;}
    async function frameList(tabId){return (await b.webNavigation.getAllFrames({tabId}))||[];}
    async function overview(tabId){const fs=await frameList(tabId);const frames=await Promise.all(fs.map(async f=>{try{return {frameId:f.frameId,parentFrameId:f.parentFrameId,url:S.safeURL(f.url),ok:true,data:await rpc(tabId,f.frameId,'TOOL',{tool:'overview',args:{}})};}catch{return {frameId:f.frameId,parentFrameId:f.parentFrameId,url:S.safeURL(f.url),ok:false,error:'NO_ACCESS_OR_NOT_READY'};}}));const unresolvedEmbeds=frames.flatMap(f=>(f.data?.coverage.frames||[]).filter(e=>!frames.some(child=>child.parentFrameId===f.frameId&&child.url===e.url)).map(e=>({ownerFrameId:f.frameId,id:e.id,url:e.url,reason:'not in browser frame inventory; blocked, unloaded, redirected or pending'})));return {frames,coverage:{accessible:frames.filter(x=>x.ok).length,totalKnown:frames.length,unresolvedEmbeds,truncated:frames.some(x=>x.data?.truncated),note:'Known frames only; access errors are explicit. Unloaded content and canvas internals unavailable.'}};}
    async function guard(tabId,url){if((await b.tabs.get(tabId)).url!==url)throw Error('PAGE_CHANGED');}
    async function toolkit(tabId,url,name,args){await guard(tabId,url);if(name==='overview')return overview(tabId);if(!['read','find','inspect'].includes(name)||!args||Object.keys(args).some(k=>!['frameId','session','offset','limit','query','id'].includes(k))||!Number.isInteger(args.frameId))throw Error('TOOL_INVALID');const {frameId,...rest}=args;const out=await rpc(tabId,frameId,'TOOL',{tool:name,args:rest});await guard(tabId,url);return out;}
    async function allUndo(tabId){const fs=await frameList(tabId);return Promise.all(fs.map(async f=>{try{return {frameId:f.frameId,...await rpc(tabId,f.frameId,'UNDO')};}catch{return {frameId:f.frameId,unavailable:true};}}));}
    async function action(tabId,url,plan,sessions,mode,guards=null){S.validate(plan);if(!await S.matches(plan.scope,url))throw Error('SCOPE_MISMATCH');await guard(tabId,url);const o=await overview(tabId), groups=[];const wanted=[...new Set(plan.operations.map(op=>op.target.frame))];
      for(const frame of wanted){const matching=o.frames.filter(f=>f.ok&&f.data.frame===frame);if(matching.length!==1)throw Error('FRAME_MISSING_OR_AMBIGUOUS:'+frame);const f=matching[0];if(sessions?.[f.frameId]!==f.data.session)throw Error('DOCUMENT_CHANGED');const part={...plan,operations:plan.operations.filter(op=>op.target.frame===frame)};const summary=await rpc(tabId,f.frameId,'ANALYSE',{plan:part,session:f.data.session});if(summary.some(x=>x.error))throw Error(summary.find(x=>x.error).error);groups.push({f,part,summary});}
      if(mode==='analyse')return groups.map(x=>({frameId:x.f.frameId,operations:x.summary}));
      if(!guards)await allUndo(tabId);else for(const f of o.frames.filter(f=>f.ok&&!groups.some(g=>g.f.frameId===f.frameId)))await rpc(tabId,f.frameId,'UNDO');const result=[];try{for(const {f,part}of groups){await guard(tabId,url);result.push({frameId:f.frameId,...await rpc(tabId,f.frameId,'APPLY',{plan:part,session:f.data.session,mode,...(guards?{guard:guards[f.frameId]}:{})})});}await guard(tabId,url);return result;}catch(e){await allUndo(tabId);throw e;}
    }
    async function handle(m,sender){
      if(sender.id!==b.runtime.id)throw Error('CALLER_DENIED');
      if(m.command==='OPEN'){
        let panelURL=false;try{const supplied=new URL(sender.url),expected=new URL(b.runtime.getURL('popup.html'));panelURL=supplied.origin===expected.origin&&supplied.pathname===expected.pathname;}catch{}
        const contexts=b.runtime.getContexts?await b.runtime.getContexts({contextTypes:['SIDE_PANEL']}):[];
        if(sender.tab||!panelURL||!contexts.some(c=>c.documentUrl===sender.url&&(!sender.documentId||c.documentId===sender.documentId)))throw Error('PANEL_REQUIRED');const [tab]=await b.tabs.query({active:true,currentWindow:true});if(!tab||!S.permitted(tab.url))throw Error('PAGE_NOT_PERMITTED');
        try{await rpc(tab.id,0,'OPEN',{question:m.question||''});}catch(e){await b.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},files});await rpc(tab.id,0,'OPEN',{question:m.question||''});}
        // Existing HTTPS/local/file grants or activeTab decide which frames can execute. Per-frame errors remain in overview.
        for(const f of await frameList(tab.id)){if(f.frameId!==0)try{await b.scripting.executeScript({target:{tabId:tab.id,frameIds:[f.frameId]},files});}catch{}}
        return {opened:true};
      }
      if(!sender.tab||sender.frameId!==0||!S.permitted(sender.url))throw Error('TOP_PAGE_REQUIRED');const tabId=sender.tab.id,url=sender.url;await guard(tabId,url);
      if(m.command==='READ_STORE')return repo.read();
      if(m.command==='SAVE'){const p=S.validate(m.plan);if(!await S.matches(p.scope,url))throw Error('SCOPE_MISMATCH');return repo.save(p,m.generation,m.flags);}
      if(m.command==='IMPORT')return repo.import(m.raw,m.generation);
      if(m.command==='DISABLE') { await allUndo(tabId);return repo.disable(m.id,m.generation); }
      if(m.command==='TOOL')return toolkit(tabId,url,m.tool,m.args);
      if(m.command==='PICK'){if(!Number.isInteger(m.frameId))throw Error('FRAME_INVALID');const data=await rpc(tabId,m.frameId,'PICK',{session:m.session});await guard(tabId,url);return {frameId:m.frameId,...data};}
      if(m.command==='UNDO'){runs.get(tabId)?.abort();return allUndo(tabId);}
      if(m.command==='COMMIT'){await guard(tabId,url);const fs=await frameList(tabId);return Promise.all(fs.map(async f=>{try{return await rpc(tabId,f.frameId,'COMMIT');}catch{return null;}}));}
      if(m.command==='PREVIEW'||m.command==='APPLY'||m.command==='ANALYSE'){
        if(locks.has(tabId))throw Error('OPERATION_BUSY');locks.set(tabId,true);try{return await action(tabId,url,m.plan,m.sessions,m.command==='ANALYSE'?'analyse':m.command==='PREVIEW'?'preview':'applied');}finally{locks.delete(tabId);}
      }
      if(m.command==='GENERATE'){
        if(runs.has(tabId))throw Error('MODEL_BUSY');const controller=new AbortController();runs.set(tabId,controller);const timeout=setTimeout(()=>controller.abort(),180000);try{
          const scope=await S.scope(url),tool=(n,a)=>toolkit(tabId,url,n,a);let selected=null;if(m.selected){if(Object.keys(m.selected).some(k=>!['frameId','session','id'].includes(k)))throw Error('SELECTION_INVALID');selected=await tool('inspect',m.selected);}const args={scope,previous:m.previous?S.validate(m.previous):null,tool};let result;
          if(m.mode==='simulation')result=await M.example(args);else if(m.mode==='configured')result=await M.run({...args,selected,createTask,question:m.question,feedback:m.feedback,signal:controller.signal});else throw Error('MODEL_MODE_INVALID');
          if(controller.signal.aborted)throw Error('MODEL_CANCELLED');await guard(tabId,url);return result;
        }finally{clearTimeout(timeout);runs.delete(tabId);}
      }
      throw Error('COMMAND_INVALID');
    }
    b.runtime.onMessage.addListener((m,s,reply)=>{if(m?.type!=='WFG_GENERAL')return false;handle(m,s).then(data=>reply({ok:true,data}),e=>reply({ok:false,error:e.message}));return true;});
    return {handle,overview,toolkit,action,allUndo,rpc};
  }
  g.WFGBackground={install};
})(globalThis);
