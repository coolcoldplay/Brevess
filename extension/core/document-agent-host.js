(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.SciLLM ||= {},api);})(globalThis,function(){
  'use strict';
  const TARGET_FIELDS=['tabId','contextKey','documentKey','documentId','workspaceId','workspaceGeneration','workspaceLifecycle'];
  const COMMANDS={
    add_node:['edit','node','position'],update_node:['edit','nodeId','label'],add_edge:['edit','edge'],
    update_edge:['edit','edgeId','from','to','label','polarity','context'],
    bind_block:['edit','binding','evidence'],replace_binding:['edit','bindingId','figureId','blockId','panelIds','evidence'],
    set_binding_types:['edit','bindingId','types','evidence'],
    move_nodes:['layout','positions'],set_view:['layout','viewport','matrixHeight','mode','activeStageId'],
    remove_nodes:['delete','nodeIds'],remove_edge:['delete','edgeId'],remove_binding:['delete','bindingId']
  };
  const clone=value=>JSON.parse(JSON.stringify(value)),same=(a,b)=>canonical(a)===canonical(b);
  const fault=(code,details)=>Object.assign(new Error(code),{code,...(details?{details}:{})});
  function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
  function documentAgentTarget(context){
    const value=Object.fromEntries(TARGET_FIELDS.map(key=>[key,context?.[key]]));
    for(const key of ['contextKey','documentKey','documentId','workspaceId'])if(typeof value[key]!=='string'||!value[key]||value[key].length>4096)throw fault('DOCUMENT_CONTEXT_UNAVAILABLE',{stage:'document_context',field:key});
    for(const key of ['tabId','workspaceGeneration','workspaceLifecycle'])if(!Number.isSafeInteger(value[key])||value[key]<(key==='workspaceGeneration'?1:0))throw fault('DOCUMENT_CONTEXT_UNAVAILABLE',{stage:'document_context',field:key});
    return value;
  }
  function validateDocumentAgentCommands(commands){
    if(!Array.isArray(commands)||!commands.length||commands.length>32)throw fault('DOCUMENT_COMMAND_LIMIT');
    return commands.map(raw=>{
      if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Object.hasOwn(COMMANDS,raw.type))throw fault('DOCUMENT_COMMAND_DENIED');
      const spec=COMMANDS[raw.type],allowed=new Set(['type',...spec.slice(1)]);
      if(Object.keys(raw).some(k=>!allowed.has(k)))throw fault('DOCUMENT_COMMAND_INVALID');
      for(const name of ['node','edge','binding','evidence','position','viewport','context'])if(raw[name]!==undefined&&(!raw[name]||typeof raw[name]!=='object'||Array.isArray(raw[name])))throw fault('DOCUMENT_COMMAND_INVALID');
      return {command:clone(raw),permission:spec[0]};
    });
  }
  function createDocumentAgentHost(options){
    const api=options.shared,now=options.now||Date.now,records=new Map();let scope=null,pending=null,deletion=null,busy=false,closed=false,recordBytes=0,ownerKey='';
    const target=()=>{if(closed)throw fault('DOCUMENT_CONTEXT_UNAVAILABLE',{stage:'document_context',reason:'host_closed'});const t=documentAgentTarget(options.getContext()),key=canonical(t);if(ownerKey&&ownerKey!==key){scope=null;pending=null;deletion=null;}ownerKey=key;return t;};
    const check=expected=>{const live=target();if(!same(live,expected))throw fault('DOCUMENT_CONTEXT_CHANGED');return live;};
    function currentScope(){if(scope&&(scope.expiresAt<=now()||closed||!same(scope.target,target())))scope=null;return scope;}
    function publicScope(){if(pending&&pending.expiresAt<=now())pending=null;const s=currentScope();return s?{scopeId:s.scopeId,target:clone(s.target),operations:s.operations.slice(),expiresAt:s.expiresAt}:null;}
    const makeId=()=>globalThis.crypto.randomUUID();
    function read(){const t=target(),view=api.createMechanismCanvasView(options.getDraft());return{target:t,title:String(options.getTitle?.()||'当前文献'),revision:view.revision,nodes:view.nodes,edges:view.edges,scope:publicScope(),pending:pending?{approvalId:pending.id,kind:pending.kind}:null,capabilities:{commands:Object.keys(COMMANDS),maxCommands:32,maxBytes:131072,requiresExplicitDocumentScope:true}};}
    function request(args){
      const t=check(args.target),ops=args.operations;
      if(!Array.isArray(ops)||!ops.length||ops.length>3||ops.some(o=>!['edit','layout','delete'].includes(o))||new Set(ops).size!==ops.length)throw fault('DOCUMENT_SCOPE_INVALID');
      const ttl=args.ttlMs??900000;if(!Number.isSafeInteger(ttl)||ttl<60000||ttl>3600000)throw fault('DOCUMENT_SCOPE_INVALID');
      if(pending&&pending.expiresAt<=now())pending=null;
      const s=currentScope();if(s&&same(s.target,t)&&ops.every(op=>s.operations.includes(op)))return{status:'GRANTED',...publicScope(),scopeToken:s.token};
      if(pending&&same(pending.target,t)&&same(pending.operations,ops))return{status:'PENDING_HUMAN_ACTION',approvalId:pending.id};
      if(pending)throw fault('DOCUMENT_APPROVAL_PENDING');
      const intent={id:makeId(),kind:'scope',target:t,operations:ops.slice(),expiresAt:now()+ttl};pending=intent;
      options.approval({kind:'scope',approvalId:intent.id,title:read().title,target:t,operations:ops.slice(),ttlMs:ttl},decision=>{
        if(pending!==intent)return;pending=null;
        const approved=decision===true||decision?.approved===true,selected=decision===true?ops:decision?.operations;
        try{check(t);if(!approved||!Array.isArray(selected)||!selected.length||selected.some(op=>!ops.includes(op))||now()>=intent.expiresAt)return;scope={scopeId:makeId(),token:makeId(),target:clone(t),operations:[...new Set(selected)],expiresAt:now()+ttl};options.onState?.();}catch(_){/* A late approval must never grant another document. */}
      });
      return{status:'PENDING_HUMAN_ACTION',approvalId:intent.id};
    }
    function requireScope(t,token,permissions){const s=currentScope();if(!s||token!==s.token||!same(s.target,t)||permissions.some(p=>!s.operations.includes(p)))throw fault('DOCUMENT_SCOPE_REQUIRED');return s;}
    function verifyEvidence(command,chain,figures){
      if(!['bind_block','replace_binding','set_binding_types'].includes(command.type))return;
      const b=command.type==='bind_block'?command.binding:command.type==='replace_binding'?command:(chain.drawing?.bindings||[]).find(b=>b.id===command.bindingId);
      const source=api.mechanismCanvasSources(figures).find(s=>s.figureId===b?.figureId&&s.blockId===b?.blockId),proof=command.evidence;
      if(!source||!proof||proof.sourceFingerprint!==source.sourceFingerprint||proof.contentFingerprint!==source.contentFingerprint||!Array.isArray(b.panelIds)||!same([...b.panelIds].sort(),[...source.panelIds].sort())||b.unresolved)throw fault('DOCUMENT_EVIDENCE_STALE');
      if(command.type==='set_binding_types'&&b.sourceFingerprint!==source.sourceFingerprint)throw fault('DOCUMENT_EVIDENCE_STALE');
    }
    function keyOf(args){if(typeof args.idempotencyKey!=='string'||args.idempotencyKey.length<8||args.idempotencyKey.length>160)throw fault('IDEMPOTENCY_KEY_REQUIRED');return canonical([args.target,args.idempotencyKey]);}
    async function apply(args,meta){
      if(new TextEncoder().encode(JSON.stringify(args)).length>131072)throw fault('DOCUMENT_COMMAND_LIMIT');
      const t=check(args.target),key=keyOf(args),payload=canonical(args),items=validateDocumentAgentCommands(args.commands),permissions=[...new Set(items.map(i=>i.permission))];
      const granted=requireScope(t,meta?.scopeToken,permissions),record=records.get(key);
      if(record){if(record.payload!==payload)throw fault('DOCUMENT_IDEMPOTENCY_CONFLICT');if(record.receipt)return clone(record.receipt);throw fault('DOCUMENT_WRITE_OUTCOME_UNKNOWN');}
      if(busy)throw fault('DOCUMENT_WRITE_BUSY');if(records.size>=128||recordBytes+payload.length*2>8*1024*1024)throw fault('DOCUMENT_RECEIPT_CAPACITY');busy=true;
      try{
        meta?.assertCurrent?.();await options.flush();check(t);requireScope(t,meta?.scopeToken,permissions);meta?.assertCurrent?.();
        const draft=options.getDraft(),revision=draft?.revision;
        if(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision!==revision)throw fault('DOCUMENT_REVISION_CONFLICT');
        let next=clone(draft.mechanismChain);const commands=items.map(({command})=>{verifyEvidence(command,next,draft.figures);const clean=clone(command);delete clean.evidence;next=api.applyMechanismCanvasCommand(next,clean,{figures:draft.figures,now:now()});return clean;});
        if(permissions.includes('delete')){
          if(deletion?.payload===payload&&deletion.denied)throw fault('DOCUMENT_DELETE_DECLINED');
          if(!deletion||deletion.payload!==payload||!deletion.approved||deletion.expiresAt<=now()){
            if(!deletion||deletion.payload!==payload||deletion.expiresAt<=now()){
              const before=api.createMechanismCanvasView(draft),after=api.createMechanismCanvasView({...draft,mechanismChain:next}),objects=[...before.nodes.filter(n=>!after.nodes.some(x=>x.id===n.id)).map(n=>({kind:'node',id:n.id,label:n.label})),...before.edges.filter(e=>!after.edges.some(x=>x.id===e.id)).map(e=>({kind:'edge',id:e.id,label:e.label})),...(draft.mechanismChain.drawing?.bindings||[]).filter(b=>!next.drawing.bindings.some(x=>x.id===b.id)).map(b=>({kind:'binding',id:b.id,label:b.figureId+' / '+b.blockId}))];
              const intent={payload,approved:false,expiresAt:now()+120000};deletion=intent;
              options.approval({kind:'delete',title:read().title,target:t,objects},approved=>{try{check(t);if(deletion===intent&&currentScope()===granted&&options.getDraft().revision===revision&&now()<intent.expiresAt){intent.approved=approved===true;intent.denied=approved!==true;}}catch(_){deletion=null;}});
            }
            throw fault('PENDING_HUMAN_ACTION',{kind:'delete'});
          }
          deletion=null;
        }
        check(t);requireScope(t,meta?.scopeToken,permissions);
        if(options.getDraft().revision!==revision)throw fault('DOCUMENT_REVISION_CONFLICT');
        records.set(key,{payload});recordBytes+=payload.length*2;
        let result;
        try{result=await options.persist({type:'apply_mechanism_canvas_command',expectedRevision:revision,command:{type:'batch',commands}},options.getContext(), {assertCurrent:()=>{check(t);requireScope(t,meta?.scopeToken,permissions);meta?.assertCurrent?.();}});}
        catch(error){if(same(options.getDraft(),draft)){records.delete(key);recordBytes-=payload.length*2;}throw error;}
        check(t);
        const saved=options.getDraft();if(result?.success!==true||saved?.revision!==revision+1||!result.draft||!same(result.draft,saved))throw fault('DOCUMENT_WRITE_OUTCOME_UNKNOWN');
        const receipt={status:'COMMITTED',target:clone(t),idempotencyKey:args.idempotencyKey,previousRevision:revision,revision:saved.revision,commandCount:commands.length,nodeIds:saved.mechanismChain.nodes.map(n=>n.id),edgeIds:saved.mechanismChain.edges.map(e=>e.id)};
        records.get(key).receipt=receipt;options.onState?.();return clone(receipt);
      }finally{busy=false;}
    }
    function execute(name,args={},meta={}){
      if(name==='mechanism.read_context')return read();
      if(name==='brevess.request_document_write_scope')return request(args);
      if(name==='brevess.revoke_document_write_scope'){check(args.target);scope=null;pending=null;deletion=null;options.onState?.();return{revoked:true};}
      if(name==='mechanism.list_evidence'){check(args.target);return{target:target(),revision:options.getDraft().revision,sources:api.mechanismCanvasSources(options.getDraft().figures)};}
      if(name==='mechanism.read_receipt'){check(args.target);const r=records.get(keyOf(args));return r?.receipt?clone(r.receipt):{status:'UNKNOWN_REQUIRES_READ',target:target(),idempotencyKey:args.idempotencyKey};}
      if(name==='mechanism.apply_commands')return apply(args,meta);
      throw fault('DOCUMENT_TOOL_NOT_FOUND');
    }
    function revoke(){scope=null;pending=null;deletion=null;options.onState?.();}
    return{execute,revoke,close(){revoke();closed=true;}};
  }
  return{createDocumentAgentHost,documentAgentTarget,validateDocumentAgentCommands};
});
