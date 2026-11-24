
;/* native/core/mechanism-drawing-bridge.js */
(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';
  const MIME = 'application/x-brevess-evidence-block';
  const clone = value => JSON.parse(JSON.stringify(value));
  function fail(code) { const error = new Error(code); error.code = code; throw error; }
  function mechanismDrawingContextKey(context = {}) {
    return JSON.stringify(['tabId', 'contextKey', 'documentKey', 'documentId',
      'workspaceId', 'workspaceGeneration', 'workspaceLifecycle',
      'workspaceCanonicalUrl', 'workspaceContentHash'].map(key => context[key] ?? null));
  }
  function parseMechanismEvidenceDrag(value, contextKey) {
    if (typeof value !== 'string' || value.length > 8192) return null;
    try {
      const payload = JSON.parse(value);
      if (payload?.version !== 1 || payload.contextKey !== contextKey ||
          typeof payload.figureId !== 'string' || !payload.figureId || payload.figureId.length > 160 ||
          typeof payload.blockId !== 'string' || !payload.blockId || payload.blockId.length > 160) return null;
      return { figureId: payload.figureId, blockId: payload.blockId };
    } catch (_) { return null; }
  }
  function drawingCommandLabel(command, view) {
    const edge = view.edges?.find(item => item.id === command.edgeId);
    const node = view.nodes?.find(item => item.id === command.nodeId);
    const names = { add_node: '添加节点', update_node: '修改节点', remove_node: '删除节点',
      move_nodes: '移动节点', add_edge: '建立联系', update_edge: '修改联系',
      remove_nodes: '删除节点', remove_edge: '删除联系', bind_block: '添加证据', set_binding_types: '修改证据类型',
      remove_binding: '移除证据', replace_binding: '替换证据', set_story: '修改论证步骤' };
    return `${names[command.type] || '编辑机制图'}${node?.label || edge?.label ? `：${node?.label || edge?.label}` : ''}`;
  }
  // History belongs to this live paper session. External revisions invalidate it;
  // undo must never overwrite another editor's changes or another paper's draft.
  function createMechanismDrawingSession(options) {
    let closed = false, saving = false;
    let tail = Promise.resolve();
    let revision = options.getView().revision;
    let undo = [], redo = [];
    let status = '';
    function check() {
      if (closed || options.isCurrent?.() === false) fail('MECHANISM_DRAWING_CONTEXT_CHANGED');
    }
    function view() {
      check();
      const current = options.getView();
      if (current.revision !== revision && !saving) {
        undo = []; redo = []; revision = current.revision;
      }
      return { ...current, canUndo: undo.length > 0, canRedo: redo.length > 0,
        undoLabel: undo.at(-1)?.label || '', redoLabel: redo.at(-1)?.label || '', status };
    }
    function run(command, expectedRevision) {
      const operation = tail.catch(() => null).then(async () => {
        check();
        const before = view();
        if (expectedRevision !== undefined && expectedRevision !== before.revision) {
          fail('MECHANISM_DRAWING_REVISION_CHANGED');
        }
        const direction = command.type === 'undo' ? undo : command.type === 'redo' ? redo : null;
        const history = direction?.at(-1);
        if (direction && !history) return before;
        const requested = history ? { type: 'restore_snapshot', snapshot: clone(history.snapshot) } : command;
        saving = true;
        let result;
        try { result = await options.applyCommand(requested, { expectedRevision: before.revision }); }
        catch (error) { saving = false; throw error; }
        try { check(); } catch (error) { saving = false; throw error; }
        if (result?.success === false || result?.stale === true) {
          saving = false;
          if (result?.stale) { undo = []; redo = []; }
          fail(result.code || 'MECHANISM_DRAWING_SAVE_FAILED');
        }
        const after = options.getView();
        const committedRevision = result?.draft?.revision ?? result?.revision;
        if (committedRevision !== undefined && committedRevision !== after.revision) {
          saving = false; undo = []; redo = []; revision = after.revision;
          fail('MECHANISM_DRAWING_REVISION_CHANGED');
        }
        if (after.revision !== before.revision) {
          const record = { snapshot: clone(before.snapshot), label: history?.label || drawingCommandLabel(command, before) };
          if (direction) {
            direction.pop();
            (command.type === 'undo' ? redo : undo).push(record);
            status = `${command.type === 'undo' ? '已撤销' : '已重做'}：${record.label}`;
          } else if (command.type !== 'set_view') {
            undo.push(record); if (undo.length > 80) undo.shift(); redo = [];
            status = `已保存：${record.label}`;
          }
        }
        revision = after.revision;
        saving = false;
        return view();
      });
      tail = operation.catch(() => null);
      return operation;
    }
    return Object.freeze({ run, view, isBusy: () => saving,
      close() { closed = true; undo = []; redo = []; } });
  }
  function createMechanismDrawingHost(options) {
    let ui = null, host = null, session = null, snapshot = null, pendingSessionId = '';
    let generation = 0;
    function clearMount() {
      ui?.destroy(); host?.remove(); ui = null; host = null; session = null; snapshot = null;
    }
    function destroy() { generation += 1; pendingSessionId = ''; clearMount(); }
    async function send(kind, payload = {}) {
      if (!session) fail('MECHANISM_DRAWING_CLOSED');
      const owner = session, token = generation;
      const expectedRevision = snapshot?.revision;
      await options.validate(owner.workspaceTarget);
      if (token !== generation) fail('MECHANISM_DRAWING_CONTEXT_CHANGED');
      const response = await options.send({ type: 'BREVESS_MECHANISM_DRAWING',
        sessionId: owner.sessionId, contextKey: owner.contextKey,
        expectedRevision, kind, ...payload });
      if (token !== generation) fail('MECHANISM_DRAWING_CONTEXT_CHANGED');
      if (!response?.success) fail(response?.code || 'MECHANISM_DRAWING_PANEL_UNAVAILABLE');
      if (response.snapshot) {
        if (response.snapshot.contextKey && response.snapshot.contextKey !== owner.contextKey) fail('MECHANISM_DRAWING_CONTEXT_CHANGED');
        if (Number(response.snapshot.revision) >= Number(snapshot?.revision)) snapshot = response.snapshot;
        return snapshot;
      }
      return response;
    }
    async function open(request) {
      const token = ++generation;
      pendingSessionId = request.sessionId;
      await options.validate(request.workspaceTarget);
      if (token !== generation || pendingSessionId !== request.sessionId) fail('MECHANISM_DRAWING_CONTEXT_CHANGED');
      if (session?.sessionId !== request.sessionId) clearMount();
      pendingSessionId = '';
      session = { sessionId: request.sessionId, contextKey: request.contextKey,
        workspaceTarget: request.workspaceTarget };
      snapshot = request.snapshot;
      if (!ui) {
        const document = options.document;
        host = document.createElement('div');
        host.id = 'brevess-mechanism-drawing-host';
        const shadow = host.attachShadow({ mode: 'closed' });
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet'; stylesheet.href = options.stylesheetUrl;
        const mount = document.createElement('div');
        shadow.append(stylesheet, mount);
        (document.body || document.documentElement).appendChild(host);
        ui = options.createUi({ mount,
          onCommand: command => send('command', { command }),
          onLocateEvidence: source => send('locateEvidence', { source }),
          onLocateFigure: figureId => send('locateFigure', { figureId }),
          onSelectEdge: edgeId => send('selectEdge', { edgeId }),
          onClose() {
            const owner = session;
            if (owner) void Promise.resolve(options.send({ type: 'BREVESS_MECHANISM_DRAWING',
              sessionId: owner.sessionId, contextKey: owner.contextKey, kind: 'close' })).catch(() => null);
            destroy();
          } });
      }
      ui.open(snapshot);
      return { success: true };
    }
    async function update(request) {
      if (!session || session.sessionId !== request.sessionId) return { success: false, code: 'MECHANISM_DRAWING_CLOSED' };
      const owner = session;
      await options.validate(owner.workspaceTarget);
      if (session !== owner || request.contextKey !== session.contextKey) fail('MECHANISM_DRAWING_CONTEXT_CHANGED');
      if (Number(request.snapshot?.revision) < Number(snapshot?.revision)) return { success: true };
      snapshot = request.snapshot; ui.update(snapshot);
      return { success: true };
    }
    return Object.freeze({ open, update, destroy, close(request) {
      if (session?.sessionId === request?.sessionId || pendingSessionId === request?.sessionId) destroy();
      return { success: true };
    } });
  }
  return { MECHANISM_EVIDENCE_DRAG_MIME: MIME, mechanismDrawingContextKey,
    parseMechanismEvidenceDrag, createMechanismDrawingSession, createMechanismDrawingHost };
});


;/* native/core/mechanism-drawing-panel.js */
(function attach(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(root) {
  'use strict';
  function createMechanismDrawingPanel(options) {
    const shared = options.shared || root.SciLLM;
    let owner = null, history = null, generation = 0, lastFingerprint = '';
    function current() {
      return owner && owner.contextKey === shared.mechanismDrawingContextKey(options.getContext());
    }
    function getView() {
      return { ...shared.createMechanismCanvasView(options.getDraft(), { figures: options.getFigures() }),
        contextKey: owner?.contextKey || '', sessionId: owner?.sessionId || '' };
    }
    function send(action, snapshot) {
      if (!owner) return Promise.resolve(null);
      return options.send(owner.context.tabId, { action, sessionId: owner.sessionId,
        contextKey: owner.contextKey, workspaceTarget: owner.target, ...(snapshot ? { snapshot } : {}) });
    }
    function close() {
      generation += 1;
      if (owner) void send('closeMechanismDrawing').catch(() => null);
      history?.close(); history = null; owner = null; lastFingerprint = '';
    }
    async function open() {
      const intentContextKey = shared.mechanismDrawingContextKey(options.getContext());
      const intentGeneration = generation;
      await options.flushEdits();
      if (intentGeneration !== generation || intentContextKey !== shared.mechanismDrawingContextKey(options.getContext())) {
        throw new Error('MECHANISM_DRAWING_CONTEXT_CHANGED');
      }
      const context = options.getContext();
      const target = options.getTarget(context);
      const contextKey = shared.mechanismDrawingContextKey(context);
      if (owner?.contextKey !== contextKey) {
        close();
        owner = { context, contextKey, target, sessionId: options.makeId() };
        history = shared.createMechanismDrawingSession({ getView, isCurrent: current,
          async applyCommand(command, { expectedRevision }) {
            const requestedOwner = owner;
            await options.flushEdits();
            if (owner !== requestedOwner || !current()) throw new Error('MECHANISM_DRAWING_CONTEXT_CHANGED');
            if (options.getDraft()?.revision !== expectedRevision) throw new Error('MECHANISM_DRAWING_REVISION_CHANGED');
            return options.persist({ type: 'apply_mechanism_canvas_command', command }, options.getContext());
          } });
      }
      const token = generation;
      const snapshot = history.view();
      const response = await send('openMechanismDrawing', snapshot);
      if (token !== generation) return;
      if (!response?.success) {
        close(); throw new Error(response?.code || 'MECHANISM_DRAWING_OPEN_FAILED');
      }
      lastFingerprint = JSON.stringify(snapshot);
    }
    function sync() {
      if (!owner) return;
      if (!current()) { close(); return; }
      if (history.isBusy()) return;
      const snapshot = history.view();
      const fingerprint = JSON.stringify(snapshot);
      if (fingerprint === lastFingerprint) return;
      lastFingerprint = fingerprint;
      void send('updateMechanismDrawing', snapshot).catch(() => { lastFingerprint = ''; });
    }
    async function handle(message, sender) {
      const requestedOwner = owner, requestedHistory = history, token = generation;
      const stillCurrent = () => requestedOwner === owner && requestedHistory === history && token === generation && current();
      if (!owner || message?.sessionId !== owner.sessionId ||
          message.contextKey !== owner.contextKey ||
          Number(sender?.tab?.id) !== Number(owner.context.tabId) || !current()) {
        return { success: false, code: 'MECHANISM_DRAWING_CONTEXT_CHANGED' };
      }
      if (message.kind === 'close') { close(); return { success: true }; }
      if (message.kind === 'selectEdge') return { success: true };
      if (message.kind === 'locateEvidence') {
        const source = message.source;
        const exists = getView().sources?.some(item => item.figureId === source?.figureId &&
          item.blockId === source?.blockId);
        // Legacy Panel references remain locatable without inventing a block.
        const legacy = !source?.blockId && typeof source?.figureId === 'string' &&
          Array.isArray(source?.panelIds) && source.panelIds.length > 0;
        if (!exists && !legacy) return { success: false, code: 'MECHANISM_EVIDENCE_SOURCE_MISSING' };
        return { success: await options.locateEvidence(source, requestedOwner.context) };
      }
      if (message.kind === 'locateFigure') {
        const figureId = typeof message.figureId === 'string' ? message.figureId : message.figureId?.figureId;
        return { success: await options.locateEvidence({ figureId }, requestedOwner.context) };
      }
      if (message.kind !== 'command' || !message.command || typeof message.command.type !== 'string') {
        return { success: false, code: 'MECHANISM_DRAWING_COMMAND_INVALID' };
      }
      try {
        await options.flushEdits();
        if (!stillCurrent()) throw new Error('MECHANISM_DRAWING_CONTEXT_CHANGED');
        const snapshot = await requestedHistory.run(message.command, message.expectedRevision);
        if (!stillCurrent()) throw new Error('MECHANISM_DRAWING_CONTEXT_CHANGED');
        lastFingerprint = JSON.stringify(snapshot);
        return { success: true, snapshot };
      } catch (error) {
        return { success: false, code: error.code || error.message || 'MECHANISM_DRAWING_SAVE_FAILED' };
      }
    }
    function accepts(message, sender) {
      return Boolean(owner && message?.type === 'BREVESS_MECHANISM_DRAWING' &&
        message.sessionId === owner.sessionId &&
        Number(sender?.tab?.id) === Number(owner.context.tabId));
    }
    function bindEvidenceBlock(element, figureId, blockId) {
      element.draggable = true;
      element.addEventListener('dragstart', event => {
        if (!owner || !current() || !getView().sources?.some(item =>
          item.figureId === figureId && item.blockId === blockId)) {
          event.preventDefault();
          options.status(!owner ? '请先打开手动绘制，再把证据块拖到联系线上。'
            : '此证据块尚未同步到当前文献，请等待保存完成后重试。');
          return;
        }
        if (!event.dataTransfer) return;
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(shared.MECHANISM_EVIDENCE_DRAG_MIME,
          JSON.stringify({ version: 1, contextKey: owner.contextKey, figureId, blockId }));
        event.dataTransfer.setData('text/plain', element.querySelector('.workspace-evidence-block-panels')?.textContent || '证据块');
      });
    }
    return Object.freeze({ open, close, sync, handle, accepts, bindEvidenceBlock });
  }
  return { createMechanismDrawingPanel };
});


;/* native/core/document-agent-host.js */
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


;/* native/core/codex-native-client.js */
(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  // Native Messaging host IDs are persistent protocol identifiers, not display branding.
  const CODEX_NATIVE_HOST = 'com.sci_reader.codex_bridge';
  const DEFAULT_TIMEOUT_MS = 300000;
  // This observes cancellation receipts; it never extends model execution.
  const TERMINATION_RECEIPT_RETENTION_MS = 60000;
  const MAX_TERMINATION_RECEIPTS = 128;

  function bridgeError(code, message, retryable = false, status = 0) {
    const error = new Error(String(message || code || 'Codex bridge failed'));
    error.code = String(code || 'CODEX_BRIDGE_UNAVAILABLE');
    error.retryable = retryable === true;
    if (Number.isFinite(status) && status > 0) error.status = status;
    return error;
  }

  function createEventChannel() {
    const values = [];
    const waiters = [];
    let terminal = false;

    function push(value) {
      if (terminal) return;
      const waiter = waiters.shift();
      if (waiter) waiter.resolve({ value, done: false });
      else values.push(value);
    }

    function close() {
      if (terminal) return;
      terminal = true;
      while (waiters.length) waiters.shift().resolve({ value: undefined, done: true });
    }

    return {
      push,
      close,
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (values.length) return Promise.resolve({ value: values.shift(), done: false });
            if (terminal) return Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
          },
          return() {
            close();
            return Promise.resolve({ value: undefined, done: true });
          }
        };
      }
    };
  }

  function createCodexNativeClient(runtime, options = {}) {
    if (!runtime || typeof runtime.connectNative !== 'function') {
      throw bridgeError('CODEX_BRIDGE_UNAVAILABLE', 'Native Messaging is unavailable');
    }
    const hostName = String(options.hostName || CODEX_NATIVE_HOST);
    const streams = new Map();
    const controls = new Map();
    const terminationReceipts = new Map();
    let port = null;
    let portSessionId = 0;
    let sequence = 0;
    let jsonCapabilities = null;
    let terminationCapabilities = null;
    let jsonCapabilityPort = null;
    let jsonCapabilityCheck = null;

    function nextRequestId(prefix = 'request') {
      sequence += 1;
      return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
    }

    function clearControl(requestId, error, value) {
      const pending = controls.get(requestId);
      if (!pending) return;
      controls.delete(requestId);
      clearTimeout(pending.timer);
      if (error) pending.reject(error);
      else pending.resolve(value);
    }

    function closeStream(requestId, terminalEvent) {
      const pending = streams.get(requestId);
      if (!pending) return;
      if (terminalEvent) pending.channel.push(terminalEvent);
      pending.channel.close();
      pending.cleanup?.();
      streams.delete(requestId);
    }

    function nativeDiagnostic(pending, stage = pending.stage) {
      return Object.freeze({ stage, enteredAt: pending.enteredAt,
        dispatchedAt: pending.dispatchedAt, startedAt: pending.startedAt,
        lastActivityAt: pending.lastActivityAt, cancelRequestedAt: pending.cancelRequestedAt,
        terminalAt: pending.terminalAt });
    }

    function reportNativeState(pending, stage) {
      pending.stage = stage;
      try { pending.onNativeRequestState?.(Object.freeze({ requestId: pending.requestId,
        portSessionId: pending.portSessionId || 0, ...nativeDiagnostic(pending) })); }
      catch (_) { /* Diagnostics cannot alter execution or cancellation. */ }
    }

    function finishTerminationReceipt(requestId, details) {
      const receipt = terminationReceipts.get(requestId);
      if (!receipt) return;
      terminationReceipts.delete(requestId);
      clearTimeout(receipt.timer);
      const pending = receipt.pending;
      if (details.state === 'terminal_confirmed') pending.terminalAt = Date.now();
      reportNativeState(pending, details.state === 'terminal_confirmed' ? 'terminal_confirmed' : 'outcome_unknown');
      try { receipt.callback(Object.freeze({ requestId, portSessionId: receipt.portSessionId,
        cancelReason: receipt.cancelReason, ...details, nativeRequestDiagnostic: nativeDiagnostic(pending) })); }
      catch (_) { /* Observation cannot change the original request outcome. */ }
    }

    function retainTerminationReceipt(requestId, pending) {
      if (!pending.started || typeof pending.onTerminationReceipt !== 'function' || terminationReceipts.has(requestId)) return;
      while (terminationReceipts.size >= MAX_TERMINATION_RECEIPTS) {
        finishTerminationReceipt(terminationReceipts.keys().next().value,
          { state: 'unknown', reason: 'receipt_capacity', upstreamStatus: 'unknown' });
      }
      const receipt = { callback: pending.onTerminationReceipt, pending,
        cancelReason: pending.cancelReason, connection: pending.connection,
        portSessionId: pending.portSessionId, protocol: pending.terminationProtocol, timer: null };
      terminationReceipts.set(requestId, receipt);
      receipt.timer = setTimeout(() => finishTerminationReceipt(requestId,
        { state: 'unknown', reason: 'receipt_expired', upstreamStatus: 'unknown' }), TERMINATION_RECEIPT_RETENTION_MS);
      receipt.timer?.unref?.();
    }

    function observeTerminationReceipt(message, requestId) {
      const receipt = terminationReceipts.get(requestId);
      if (!receipt || receipt.connection !== port || !['turn.cancelled', 'turn.completed', 'turn.error'].includes(message.type)) return;
      if (!receipt.protocol) {
        finishTerminationReceipt(requestId, { state: 'unknown', reason: 'terminal_unverified', upstreamStatus: 'unknown' });
        return;
      }
      const identity = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,200}$/u.test(value);
      const statuses = message.type === 'turn.cancelled' ? ['interrupted', 'completed']
        : message.type === 'turn.completed' ? ['completed'] : ['completed', 'failed'];
      if (message.terminationReceiptProtocol !== 1 || !statuses.includes(message.upstreamStatus) ||
          !identity(message.threadId) || !identity(message.turnId) ||
          (receipt.pending.threadId && receipt.pending.threadId !== message.threadId) ||
          (receipt.pending.turnId && receipt.pending.turnId !== message.turnId)) return;
      finishTerminationReceipt(requestId, { state: 'terminal_confirmed',
        terminalType: message.type, upstreamStatus: message.upstreamStatus });
    }

    function cancelledEvent(pending) {
      if (pending?.cancelReason === 'timeout') {
        return {
          type: 'error',
          error: {
            code: 'REQUEST_TIMEOUT',
            message: 'Local Codex request timed out',
            retryable: true,
            diagnosticStage: `native_${pending.cancelStage || pending.stage}`,
            diagnosticType: 'absolute_deadline',
            nativeRequestDiagnostic: nativeDiagnostic(pending, pending.cancelStage || pending.stage)
          }
        };
      }
      return { type: 'cancelled', diagnosticStage: `native_${pending.cancelStage || pending.stage}`,
        diagnosticType: 'explicit_abort', nativeRequestDiagnostic: nativeDiagnostic(pending, pending.cancelStage || pending.stage) };
    }

    function handleMessage(message = {}) {
      const requestId = String(message.requestId || '');
      observeTerminationReceipt(message, requestId);
      if (message.type === 'health.result' || message.type === 'models.result' || message.type === 'reader.event.ack') {
        if (message.type === 'health.result' && controls.get(requestId)?.connection === port) {
          const value = message.jsonResponseCapabilities;
          jsonCapabilities = value && typeof value === 'object' ? {
            version: value.version, completedFinal: value.completedFinal,
            outputSchemaForwarding: value.outputSchemaForwarding
          } : null;
          jsonCapabilityPort = port;
          terminationCapabilities = message.terminationReceiptCapabilities?.version === 1 &&
            message.terminationReceiptCapabilities.upstreamTerminal === true;
        }
        clearControl(requestId, null, message);
        return;
      }
      if (message.type === 'auth.login.started') {
        clearControl(requestId, null, {
          loginId: String(message.loginId || ''),
          authUrl: String(message.authUrl || '')
        });
        return;
      }
      if (message.type === 'auth.logout.result') {
        clearControl(requestId, null, { success: message.success === true });
        return;
      }
      if (message.type === 'host.error' && controls.has(requestId)) {
        clearControl(requestId, bridgeError(
          message.error?.code,
          message.error?.message,
          message.error?.retryable,
          message.error?.status
        ));
        return;
      }
      const pending = streams.get(requestId);
      if (!pending) return;
      if (pending.responseMode === 'json' && pending.cancelReason) {
        closeStream(requestId, cancelledEvent(pending));
        return;
      }
      if (message.type === 'turn.started') {
        if (!pending.turnId && typeof message.threadId === 'string' && message.threadId &&
            typeof message.turnId === 'string' && message.turnId) {
          pending.threadId = message.threadId;
          pending.turnId = message.turnId;
          pending.startedAt = pending.lastActivityAt = Date.now();
          reportNativeState(pending, 'running');
        }
        pending.channel.push({
          type: 'metadata',
          threadId: String(message.threadId || ''),
          turnId: String(message.turnId || '')
        });
      } else if (message.type === 'turn.readerInput') {
        const job=globalThis.SciLLM?.articlePresentation?.receipt(message.job);
        if(pending.readerDocument && job?.agent==='codex' && job.documentHash===pending.readerDocument && job.interaction){
          pending.lastActivityAt=Date.now();reportNativeState(pending,'running');
          pending.channel.push({type:'reader_input',job});
        }
      } else if (message.type === 'turn.readerStatus') {
        if (pending.readerDocument && typeof message.text==='string' && message.text.trim()) {
          pending.lastActivityAt=Date.now();
          reportNativeState(pending,'running');
          pending.channel.push({type:'public_summary',visibility:'public',text:message.text.slice(0,2000)});
        }
      } else if (message.type === 'turn.delta') {
        if (pending.responseMode === 'json') {
          if (typeof message.text !== 'string' || typeof message.itemId !== 'string' || !message.itemId ||
              message.phase !== 'final' || message.itemCompleted !== true || message.jsonResponseProtocol !== 1 ||
              typeof message.schemaForwarded !== 'boolean' || (pending.hasOutputSchema && message.schemaForwarded !== true) ||
              pending.jsonFinalCount !== 0) {
            closeStream(requestId, { type: 'error', error: { code: 'CODEX_JSON_PROTOCOL_INVALID',
              message: 'Expected exactly one completed final JSON item from the native bridge', retryable: false } });
            return;
          }
          pending.jsonFinalCount++;
          pending.channel.push({ type: 'json_final', text: message.text, itemId: message.itemId,
            phase: message.phase, itemCompleted: message.itemCompleted, jsonResponseProtocol: message.jsonResponseProtocol,
            schemaForwarded: message.schemaForwarded });
        } else if (message.text) pending.channel.push({
          type: 'text_delta',
          text: String(message.text)
        });
      } else if (message.type === 'turn.item.diagnostic') {
        if (typeof message.itemId === 'string' && message.itemId.length > 0 && message.itemId.length <= 200 &&
            ['started', 'delta', 'completed'].includes(message.eventType) &&
            ['commentary', 'final', 'unknown'].includes(message.phase) &&
            Number.isSafeInteger(message.textLength) && message.textLength >= 0 &&
            typeof message.textHash === 'string' && /^[a-f0-9]{64}$/u.test(message.textHash)) {
          const signature = `${message.eventType}:${message.phase}:${message.textLength}:${message.textHash}`;
          if (pending.activityItems.get(message.itemId) !== signature &&
              (pending.activityItems.has(message.itemId) || pending.activityItems.size < 128)) {
            pending.activityItems.set(message.itemId, signature);
            pending.lastActivityAt = Date.now();
            if (pending.responseMode === 'text' && !pending.cancelReason) reportNativeState(pending, 'running');
          }
        }
        pending.channel.push({ type: 'metadata', itemId: message.itemId, phase: message.phase,
          eventType: message.eventType, textLength: message.textLength, textHash: message.textHash });
      } else if (message.type === 'turn.usage') {
        pending.channel.push({ type: 'usage', usage: message.usage || {} });
      } else if (message.type === 'turn.completed') {
        if (pending.responseMode === 'json' && pending.jsonFinalCount !== 1) {
          closeStream(requestId, { type: 'error', error: { code: 'CODEX_JSON_PROTOCOL_INVALID',
            message: 'Native JSON completion requires exactly one final item', retryable: false } });
          return;
        }
        pending.terminalAt = Date.now();
        reportNativeState(pending, 'completed');
        closeStream(requestId, {
          type: 'completed',
          finishReason: String(message.finishReason || 'stop'),
          usage: message.usage || null
        });
      } else if (message.type === 'turn.cancelled') {
        closeStream(requestId, cancelledEvent(pending));
      } else if (message.type === 'turn.error' || message.type === 'host.error') {
        closeStream(requestId, {
          type: 'error',
          error: {
            code: String(message.error?.code || 'CODEX_BRIDGE_UNAVAILABLE'),
            message: String(message.error?.message || 'Codex bridge failed'),
            retryable: message.error?.retryable === true,
            status: Number(message.error?.status) || 0
          }
        });
      }
    }

    function handleDisconnect() {
      const runtimeError = runtime.lastError;
      const error = bridgeError(
        'CODEX_BRIDGE_UNAVAILABLE',
        runtimeError?.message || 'The local Codex bridge disconnected',
        true
      );
      port = null;
      jsonCapabilities = null;
      terminationCapabilities = null;
      jsonCapabilityPort = null;
      jsonCapabilityCheck = null;
      for (const requestId of [...controls.keys()]) clearControl(requestId, error);
      for (const requestId of [...streams.keys()]) {
        const pending = streams.get(requestId);
        const diagnosticStage = `native_${pending.cancelStage || pending.stage}`;
        const diagnostic = nativeDiagnostic(pending, pending.cancelStage || pending.stage);
        reportNativeState(pending, 'outcome_unknown');
        closeStream(requestId, {
          type: 'error',
          error: { code: error.code, message: error.message, retryable: true,
            diagnosticStage, diagnosticType: 'bridge_disconnected', nativeRequestDiagnostic: diagnostic }
        });
      }
      for (const requestId of [...terminationReceipts.keys()]) {
        finishTerminationReceipt(requestId,
          { state: 'unknown', reason: 'bridge_disconnected', upstreamStatus: 'unknown' });
      }
    }

    function ensurePort() {
      if (port) return port;
      try {
        const connectedPort = runtime.connectNative(hostName);
        port = connectedPort;
        portSessionId += 1;
        connectedPort.onMessage.addListener(message => { if (port === connectedPort) handleMessage(message); });
        connectedPort.onDisconnect.addListener(() => { if (port === connectedPort) handleDisconnect(); });
        return port;
      } catch (error) {
        port = null;
        throw bridgeError(
          'CODEX_BRIDGE_UNAVAILABLE',
          error?.message || 'Unable to start the local Codex bridge'
        );
      }
    }

    function post(message) {
      try {
        ensurePort().postMessage(message);
      } catch (error) {
        throw bridgeError(
          'CODEX_BRIDGE_UNAVAILABLE',
          error?.message || 'Unable to contact the local Codex bridge',
          true
        );
      }
    }

    function health(options = {}) {
      const requestId = nextRequestId('health');
      const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 20000);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          clearControl(requestId, bridgeError(
            'REQUEST_TIMEOUT',
            'Timed out while checking the local Codex installation',
            true
          ));
        }, timeoutMs);
        controls.set(requestId, { resolve, reject, timer });
        try {
          controls.get(requestId).connection = ensurePort();
          post({ type: 'health.check', requestId });
        } catch (error) {
          clearControl(requestId, error);
        }
      });
    }

    function controlRequest(type, payload = {}, options = {}) {
      const requestId = nextRequestId(type.replace(/\./g, '-'));
      const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30000);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          clearControl(requestId, bridgeError(
            'REQUEST_TIMEOUT',
            `Timed out while handling ${type}`,
            true
          ));
        }, timeoutMs);
        controls.set(requestId, { resolve, reject, timer });
        try {
          post({ type, requestId, ...payload });
        } catch (error) {
          clearControl(requestId, error);
        }
      });
    }

    function startLogin(options = {}) {
      return controlRequest(
        'auth.login.start',
        { force: options.force === true },
        options
      );
    }

    function logout(options = {}) {
      return controlRequest('auth.logout', {}, options);
    }

    function publishReaderEvent(event, options = {}) {
      return controlRequest('reader.event.publish', { event }, {
        ...options,
        timeoutMs: options.timeoutMs || 15000
      });
    }

    function streamTurn(input = {}) {
      const requestId = nextRequestId('turn');
      const channel = createEventChannel();
      const signal = input.signal;
      const timeoutMs = Math.max(1000, Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS);
      const jsonMode = input.responseMode === 'json';
      const hasOutputSchema = jsonMode && input.outputSchema !== undefined;
      let timeout = null;
      let abortHandler = null;

      const cancel = reason => {
        const pending = streams.get(requestId);
        if (!pending) return;
        pending.cancelReason = String(reason || 'cancelled');
        pending.cancelStage = pending.stage;
        pending.cancelRequestedAt = Date.now();
        reportNativeState(pending, 'cancel_requested');
        if (jsonMode) {
          retainTerminationReceipt(requestId, pending);
          if (pending.started) {
            try { post({ type: 'turn.cancel', requestId, reason: pending.cancelReason }); } catch (_) {}
          }
          closeStream(requestId, cancelledEvent(pending));
          return;
        }
        try {
          post({ type: 'turn.cancel', requestId, reason: String(reason || 'cancelled') });
          setTimeout(() => {
            const current = streams.get(requestId);
            if (current) closeStream(requestId, cancelledEvent(current));
          }, 15000);
        } catch (_) {
          closeStream(requestId, cancelledEvent(pending));
        }
      };

      abortHandler = () => cancel('aborted');
      if (signal?.aborted) {
        channel.push({ type: 'cancelled' });
        channel.close();
        return channel;
      }
      signal?.addEventListener?.('abort', abortHandler, { once: true });
      timeout = setTimeout(() => cancel('timeout'), timeoutMs);
      const pending = {
        channel,
        cancelReason: '',
        responseMode: jsonMode ? 'json' : 'text',
        hasOutputSchema,
        jsonFinalCount: 0,
        requestId, stage: 'handshake', enteredAt: Date.now(), dispatchedAt: null,
        startedAt: null, lastActivityAt: null, cancelRequestedAt: null, terminalAt: null,
        threadId: '', turnId: '', activityItems: new Map(),
        readerDocument:input.readerInput===true && !jsonMode ? input.conversationKey : '',
        onNativeRequestState: input.onNativeRequestState,
        onTerminationReceipt: input.onTerminationReceipt,
        connection: null,
        started: false,
        cleanup() {
          clearTimeout(timeout);
          signal?.removeEventListener?.('abort', abortHandler);
        }
      };
      streams.set(requestId, pending);
      reportNativeState(pending, 'handshake');
      let payload;
      try {
        payload = {
          type: 'turn.start',
          requestId,
          conversationKey: String(input.conversationKey || ''),
          conversationLabel: String(input.conversationLabel || ''),
          ...(pending.readerDocument?{readerInput:true}:{}),
          profileId: String(input.profileId || ''),
          model: String(input.model || 'auto'),
          reasoningEffort: String(input.reasoningEffort || 'auto'),
          systemPrompt: String(input.systemPrompt || ''),
          userPrompt: String(input.userPrompt || ''),
          images: (Array.isArray(input.images) ? input.images : [])
            .slice(0, 8)
            .map(image => ({
              mediaType: String(image?.mediaType || ''),
              dataUrl: String(image?.dataUrl || ''),
              detail: String(image?.detail || 'high')
            }))
            .filter(image => /^data:image\/(?:jpeg|png|webp);base64,/i.test(image.dataUrl)),
          maxOutputTokens: Math.max(0, Number(input.maxOutputTokens) || 0),
          ephemeral: input.ephemeral === true,
          ...(jsonMode ? { responseMode: 'json', ...(hasOutputSchema ? { outputSchema: input.outputSchema } : {}) } : {})
        };
      } catch (error) {
        closeStream(requestId, { type: 'error',
          error: { code: error.code, message: error.message, retryable: error.retryable } });
        return channel;
      }
      const dispatch = () => {
        if (streams.get(requestId) !== pending) return;
        if (signal?.aborted || pending.cancelReason) { cancel('aborted'); return; }
        pending.connection = ensurePort();
        pending.portSessionId = portSessionId;
        pending.terminationProtocol = terminationCapabilities === true;
        pending.started = true;
        pending.dispatchedAt = Date.now();
        pending.stage = 'submitted';
        post(payload);
        // A local observer may synchronously abort. Notify only after posting,
        // and never overwrite a synchronously received running/terminal state.
        if (streams.get(requestId) === pending && pending.stage === 'submitted') reportNativeState(pending, 'submitted');
      };
      const fail = error => {
        if (streams.get(requestId) !== pending) return;
        closeStream(requestId, { type: 'error',
          error: { code: error.code, message: error.message, retryable: error.retryable,
            diagnosticStage: `native_${pending.stage}`, diagnosticType: 'bridge_failure',
            nativeRequestDiagnostic: nativeDiagnostic(pending) } });
      };
      if (!jsonMode) {
        try { dispatch(); } catch (error) { fail(error); }
      } else {
        (async () => {
          const connection = ensurePort();
          if (jsonCapabilityPort !== connection) {
            if (!jsonCapabilityCheck || jsonCapabilityCheck.connection !== connection) {
              const check = { connection, promise: health({ timeoutMs: Math.min(timeoutMs, 20000) }) };
              jsonCapabilityCheck = check;
              check.promise.finally(() => { if (jsonCapabilityCheck === check) jsonCapabilityCheck = null; }).catch(() => {});
            }
            await jsonCapabilityCheck.promise;
          }
          if (streams.get(requestId) !== pending) return;
          if (signal?.aborted || pending.cancelReason) { cancel('aborted'); return; }
          if (port !== connection || jsonCapabilityPort !== connection || jsonCapabilities?.version !== 1 ||
              jsonCapabilities.completedFinal !== true || (hasOutputSchema && jsonCapabilities.outputSchemaForwarding !== true))
            throw bridgeError('CODEX_JSON_PROTOCOL_UNAVAILABLE', 'The native bridge lacks the completed-final JSON response protocol');
          dispatch();
        })().catch(fail);
      }
      return channel;
    }

    function disconnect() {
      const connectedPort = port;
      try {
        port?.disconnect();
      } catch (_) {
        // The browser already closed the native port.
      }
      if (port === connectedPort && port) handleDisconnect();
      port = null;
      jsonCapabilities = null;
      jsonCapabilityPort = null;
      jsonCapabilityCheck = null;
    }

    return {
      health,
      listModels: options => controlRequest('models.list', {}, options),
      startLogin,
      logout,
      publishReaderEvent,
      streamTurn,
      disconnect,
      hostName
    };
  }

  return {
    CODEX_NATIVE_HOST,
    createCodexNativeClient,
    createCodexNativeEventChannel: createEventChannel
  };
});


;/* native/core/harness-native-client.js */
(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const HARNESS_NATIVE_HOST = 'com.sci_reader.codex_bridge';
  const failure = (code, message) => Object.assign(new Error(message || code), { code, retryable: false });

  function createHarnessNativeClient(runtime) {
    if (!runtime || typeof runtime.connectNative !== 'function') throw failure('HARNESS_START_FAILED', 'Native Messaging is unavailable');
    const streams = new Map(), controls = new Map();
    let port, sequence = 0, closed = false;
    const nextId = () => 'harness-' + Date.now().toString(36) + '-' + (++sequence).toString(36);

    function finish(id, event) {
      const pending = streams.get(id); if (!pending) return;
      streams.delete(id); clearTimeout(pending.timer);
      pending.signal?.removeEventListener('abort', pending.abort);
      if (event) pending.push(event); pending.end();
    }
    function cancel(id, reason = 'cancelled') {
      if (!streams.has(id)) return;
      try { port?.postMessage({ type: 'harness.turn.cancel', requestId: id }); } catch {}
      finish(id, reason === 'timeout' ? { type: 'error', error: { code: 'REQUEST_TIMEOUT', message: 'Harness request timed out', retryable: true } } : { type: 'cancelled' });
    }
    function cancelControl(id, reason = 'cancelled') {
      const pending = controls.get(id); if (!pending) return;
      controls.delete(id); clearTimeout(pending.timer);
      pending.signal?.removeEventListener('abort', pending.abort);
      try { port?.postMessage({ type: 'harness.control.cancel', requestId: id }); } catch {}
      pending.reject(failure(reason === 'timeout' ? 'REQUEST_TIMEOUT' : 'CANCELLED',
        reason === 'timeout' ? 'Harness control request timed out' : 'Harness control request cancelled'));
    }
    function disconnect() {
      port = null;
      for (const [id, pending] of controls) { clearTimeout(pending.timer); pending.signal?.removeEventListener('abort', pending.abort); pending.reject(failure('HARNESS_PROCESS_EXITED', 'Harness bridge disconnected')); controls.delete(id); }
      for (const id of [...streams.keys()]) finish(id, { type: 'error', error: { code: 'HARNESS_PROCESS_EXITED', message: 'Harness bridge disconnected', retryable: true } });
      // Chrome lastError must be observed, but its potentially identifying text is not exposed.
      void runtime.lastError;
    }
    function receive(message = {}) {
      const id = String(message.requestId || ''), type = String(message.type || '');
      // Pre-Harness companions reject these requests at their outer dispatch.
      // Preserve Harness payload validation errors from newer companions.
      const error = type === 'host.error' && message.error?.code === 'INVALID_SETTINGS'
        ? { code: 'HARNESS_BRIDGE_OUTDATED', retryable: false,
          message: 'The registered local bridge does not support Harness. Update the Windows companion and reload the extension.' }
        : message.error;
      const control = controls.get(id);
      if (control && (type === control.responseType || type === 'harness.error' || type === 'host.error')) {
        controls.delete(id); clearTimeout(control.timer);
        control.signal?.removeEventListener('abort', control.abort);
        if (error) {
          const details = { ...error };
          control.reject(Object.assign(failure(details.code, details.message), details));
        }
        else control.resolve(message); return;
      }
      const pending = streams.get(id); if (!pending) return;
      if (type === 'host.error' || type === 'harness.error') { finish(id, { type: 'error', error }); return; }
      if (!type.startsWith('harness.turn.')) return;
      const suffix = type.slice('harness.turn.'.length);
      if (suffix === 'delta') pending.push({ type: 'text_delta', text: String(message.text || '') });
      else if (suffix === 'started') pending.push({ type: 'metadata', model: message.model, sessionId: message.sessionId });
      else if (suffix === 'usage') pending.push({ type: 'usage', usage: message.usage });
      else if (['completed', 'error', 'cancelled'].includes(suffix)) finish(id, {
        type: suffix, model: message.model, usage: message.usage, elapsedMs: message.elapsedMs,
        finishReason: message.finishReason, ...(message.error ? { error: message.error } : {}),
        ...(suffix === 'completed' && message.webSearch ? { webSearch: message.webSearch } : {})
      });
    }
    function connect() {
      if (closed) throw failure('HARNESS_START_FAILED', 'Harness client is closed');
      if (!port) {
        port = runtime.connectNative(HARNESS_NATIVE_HOST);
        port.onMessage.addListener(receive); port.onDisconnect.addListener(disconnect);
      }
      return port;
    }
    function control(type, responseType, options = {}) {
      const id = nextId();
      return new Promise((resolve, reject) => {
        if (options.signal?.aborted) { reject(failure('CANCELLED', 'Harness control request cancelled')); return; }
        const timer = setTimeout(() => cancelControl(id, 'timeout'), Math.max(1000, Math.min(60000, Number(options.timeoutMs) || 20000)));
        const pending = { resolve, reject, timer, responseType, signal: options.signal, abort: () => cancelControl(id) };
        controls.set(id, pending);
        options.signal?.addEventListener('abort', pending.abort, { once: true });
        try { connect().postMessage({ type, requestId: id }); }
        catch (error) { controls.delete(id); clearTimeout(timer); options.signal?.removeEventListener('abort', pending.abort); reject(error); }
      });
    }
    function streamTurn(input = {}) {
      const id = nextId(), queue = [], waiters = [];
      let ended = false;
      const push = value => { const resolve = waiters.shift(); if (resolve) resolve({ value, done: false }); else queue.push(value); };
      const end = () => { ended = true; while (waiters.length) waiters.shift()({ done: true }); };
      const timeoutMs = Math.max(1000, Math.min(900000, Number(input.timeoutMs) || 300000));
      const pending = { push, end, signal: input.signal, abort: () => cancel(id) };
      streams.set(id, pending);
      pending.timer = setTimeout(() => cancel(id, 'timeout'), timeoutMs + 500);
      if (input.signal?.aborted) finish(id, { type: 'cancelled' });
      else {
        input.signal?.addEventListener('abort', pending.abort, { once: true });
        try { connect().postMessage({ type: 'harness.turn.start', requestId: id,
          model: input.model, reasoningEffort: input.reasoningEffort,
          systemPrompt: input.systemPrompt, userPrompt: input.userPrompt,
          images: input.images, maxOutputTokens: input.maxOutputTokens, timeoutMs,
          ...(input.webSearch === true ? { webSearch: true } : {}) }); }
        catch (error) { finish(id, { type: 'error', error: { code: error.code || 'HARNESS_START_FAILED', message: 'Harness bridge unavailable' } }); }
      }
      const iterator = {
        next() { if (queue.length) return Promise.resolve({ value: queue.shift(), done: false }); if (ended) return Promise.resolve({ done: true }); return new Promise(resolve => waiters.push(resolve)); },
        return() { cancel(id); queue.length = 0; end(); return Promise.resolve({ done: true }); },
        [Symbol.asyncIterator]() { return this; }
      };
      return iterator;
    }
    return { health: options => control('harness.health.check', 'harness.health.result', options),
      listModels: options => control('harness.models.list', 'harness.models.result', options), streamTurn,
      close() { if (closed) return; for (const id of [...streams.keys()]) cancel(id); for (const id of [...controls.keys()]) cancelControl(id); closed = true; port?.disconnect(); disconnect(); } };
  }
  return { HARNESS_NATIVE_HOST, createHarnessNativeClient };
});


;/* native/core/document-agent-bridge.js */
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


;/* native/core/agent-connection-ui.js */
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
      body dialog.brevess-agent-connection {box-sizing:border-box;width:min(500px,calc(100vw - 32px));max-height:calc(100dvh - 40px);overflow:auto;padding:28px;border:1px solid var(--bv-line, #e7e7e9);border-radius:20px;background:var(--bv-surface, #fff);color:var(--bv-text, #222);box-shadow:0 24px 90px #0002;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
      .brevess-agent-connection::backdrop {background:#17171750;backdrop-filter:blur(3px)}
      .brevess-agent-connection [hidden] {display:none!important}
      .brevess-agent-connection .agent-head {display:flex;align-items:center;justify-content:space-between;margin:0 0 8px}
      .brevess-agent-connection h2 {font-size:22px;line-height:1.3;letter-spacing:-.5px;margin:0;font-weight:650}
      .brevess-agent-connection p {margin:0;overflow-wrap:anywhere}
      .brevess-agent-connection .agent-subtitle {color:var(--bv-muted, #787b80);font-size:13px;margin-bottom:24px}
      .brevess-agent-connection .agent-label {display:block;font-size:12px;font-weight:600;color:var(--bv-muted, #64686d);margin-bottom:8px}
      dialog.brevess-agent-connection :is(select,input) {box-sizing:border-box;display:block;width:100%;height:44px;padding:9px 12px;border:1px solid var(--bv-line, #dddfe2);border-radius:10px;background:var(--bv-surface, #fff);color:var(--bv-text, #222);font:inherit}
      .brevess-agent-connection .agent-capability {font-size:12px;color:var(--bv-muted, #777b81);margin-top:8px;min-height:18px}
      .brevess-agent-connection .agent-primary-actions {display:flex;gap:10px;margin-top:22px}
      dialog.brevess-agent-connection button {box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:auto;height:auto;min-height:38px;margin:0;padding:9px 14px;gap:6px;border:1px solid var(--bv-line, #e2e3e5);border-radius:10px;background:var(--bv-surface, #fff);color:var(--bv-text, #25272b);font-family:inherit;font-size:13px;font-weight:500;line-height:1.4;cursor:pointer;box-shadow:none}
      dialog.brevess-agent-connection .agent-primary-actions button {flex:1;min-height:42px;white-space:nowrap}
      dialog.brevess-agent-connection .agent-primary {background:var(--bv-selected, #222);color:var(--bv-on-selected, #fff);border-color:var(--bv-line-strong, #222)}
      dialog.brevess-agent-connection button:hover:not(:disabled) {background:var(--bv-hover, #f4f4f5)}
      dialog.brevess-agent-connection .agent-primary:hover:not(:disabled) {background:var(--bv-selected-hover, #3a3a3a)}
      dialog.brevess-agent-connection button:disabled {opacity:.5;cursor:default}
      dialog.brevess-agent-connection .agent-close {flex:none;padding:5px;min-height:28px;width:28px;height:28px;border:0;background:transparent;color:var(--bv-muted, #777);font-size:24px;font-weight:300;line-height:1}
      .brevess-agent-connection :is(button,select,input,summary):focus-visible {outline:2px solid var(--bv-focus, #3866ba);outline-offset:3px}
      .brevess-agent-connection .agent-result {display:flex;align-items:flex-start;gap:11px;margin:22px 0 18px;padding:15px 16px;border-radius:12px;background:var(--bv-raised, #f6f6f7)}
      .brevess-agent-connection .agent-result-icon {width:18px;height:18px;flex:none;margin-top:2px;color:var(--bv-subtle, #92969c)}
      .brevess-agent-connection .agent-result-icon svg {width:18px;height:18px;display:block}
      .brevess-agent-connection .agent-result[data-state="success"] .agent-result-icon {color:var(--bv-teal, #24815b)}
      .brevess-agent-connection .agent-result[data-state="warning"] .agent-result-icon,.brevess-agent-connection .agent-result[data-state="error"] .agent-result-icon {color:var(--bv-amber, #a46b17)}
      .brevess-agent-connection .agent-result[data-state="busy"] .agent-result-icon {animation:agent-connect-spin 1.2s linear infinite}
      .brevess-agent-connection .agent-result-title {font-size:13px;font-weight:600;line-height:1.5}
      .brevess-agent-connection .agent-result-detail {color:var(--bv-muted, #72767c);font-size:12px;line-height:1.6;margin-top:4px}
      dialog.brevess-agent-connection .agent-text-action {padding:0;min-height:24px;border:0;background:none;color:var(--bv-text, #30343a);font-size:12px;text-decoration:underline;text-underline-offset:3px;margin-top:8px}
      .brevess-agent-connection details {border-top:1px solid var(--bv-line, #ededee);padding-top:14px;margin-top:18px}
      .brevess-agent-connection summary {font-size:12px;color:var(--bv-muted, #7a7e83);cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between}
      .brevess-agent-connection summary::-webkit-details-marker {display:none}
      .brevess-agent-connection summary::after {content:'⌄';font-size:16px}
      .brevess-agent-connection details[open]>summary::after {content:'⌃'}
      .brevess-agent-connection .agent-advanced-body {padding-top:16px}
      .brevess-agent-connection .agent-advanced-actions {display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .brevess-agent-connection .agent-advanced-body p {font-size:12px;color:var(--bv-muted, #777b81);margin:10px 0}
      .brevess-agent-connection .agent-diagnostic {font-size:11px;color:var(--bv-muted, #85898e);white-space:pre-wrap;overflow-wrap:anywhere}
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
      capability.textContent = client?.modelAdapter ? '连接测试通过后，自动加入问答模型列表。' : '连接后可在工作台侧栏选择该 Agent。可选模型和推理强度取决于本机客户端。';
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


;/* native/core/manual-evidence-block-editor.js */
(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';
  const t = input => globalThis.SciLLM?.translateInterfaceText?.(input) || input;
  function authored(node) { node.setAttribute?.('data-i18n-ignore', ''); return node; }
  function labeledContent(doc, label, content) {
    if (!doc.createTextNode) {
      const line = doc.createElement('p'); line.textContent = `${t(label)}：${content}`; return authored(line);
    }
    const line = doc.createElement('p'), name = doc.createElement('span'), value = doc.createElement('span');
    name.textContent = label; value.textContent = content;
    line.append(name, doc.createTextNode(': '), authored(value));
    return line;
  }
  const fields = [['title', '标题'], ['upstreamContext', '承上'], ['groupConclusion', '模块小结'], ['evidenceLevel', '证据类型']];
  function value(raw) {
    if (Array.isArray(raw)) return raw.slice(0, 64).map(item => typeof item === 'string' ? item : String(item?.value || '')).filter(Boolean).join('；');
    return typeof raw === 'string' ? raw : String(raw?.value || '');
  }
  function manualEvidenceEditorValues(block, panels = []) {
    if (!block) return Object.fromEntries(fields.map(([field]) => [field, '']));
    const state = block.fieldStates?.groupConclusion || (typeof block.groupConclusion === 'object' ? block.groupConclusion : null);
    const summary = state?.humanReviewed === true ? value(state) : value(block.groupConclusion) || value(block.conclusion) || value(block.established);
    return { title: value(block.title) || value(block.groupGoal), upstreamContext: value(block.upstreamContext),
      groupConclusion: summary, evidenceLevel: value(block.evidenceLevel) };
  }
  function createManualEvidenceArchiveDetails(doc, entries, options = {}) {
    if (!Array.isArray(entries) || !entries.length) return null;
    const element = (tag, text, className = '') => {
      const node = doc.createElement(tag); node.textContent = text; node.className = className; return node;
    };
    const label = panelIds => options.panelLabel?.(panelIds) || (panelIds || []).join('、');
    const history = element('details', '', 'manual-evidence-archive');
    history.setAttribute?.('data-brevess-interface', '');
    history.append(element('summary', `证据块合并历史（${entries.length}）`));
    history.append(element('p', '合并前的来源记录，只读保留。历史说明不会自动成为当前结论，原联系仍需复核。', 'manual-evidence-note'));
    for (const entry of entries) {
      const block = entry.block || {};
      const target = (options.blocks || []).find(item => item.id === entry.mergedIntoBlockId);
      const item = element('details', '', 'manual-evidence-detail');
      item.append(authored(element('summary', `${label(block.panelIds) || t('原证据块')} → ${target ? label(target.panelIds) : t('已变更的证据块')}`)));
      const values = manualEvidenceEditorValues(block, entry.panels || []);
      for (const [field, name] of fields) item.append(labeledContent(doc, name, values[field] || t('未填写')));
      if (block.originalSource) {
        const prior = element('details', '', 'manual-evidence-detail');
        prior.append(element('summary', '接管前的来源记录'));
        prior.append(labeledContent(doc, '原 Panel', label(block.originalPanelIds)));
        for (const [field, name] of [['groupGoal', '原共同目标'], ['groupConclusion', '原组小结'], ['established', '原推断']]) {
          const text = value(block.originalSource[field]);
          if (text) prior.append(labeledContent(doc, name, text));
        }
        item.append(prior);
      }
      history.append(item);
    }
    return history;
  }
  function manualEvidencePanelIds(selected, extra) {
    const tokens = [...(selected || []), ...String(extra || '').split(/[\s,，、;；]+/u)].filter(Boolean);
    const ids = [];
    for (const raw of tokens) {
      const id = String(raw).trim().toUpperCase();
      if (!/^[A-Z]{1,3}[0-9]{0,2}$/u.test(id)) throw new Error('请分别填写原图中的 Panel 编号，例如 A、C、D；不要输入范围或 Figure 编号。');
      if (!ids.includes(id)) ids.push(id);
    }
    if (!ids.length) throw new Error('请至少选择或填写一个真实 Panel。');
    if (ids.length > 32) throw new Error('一个证据块最多包含 32 个 Panel。');
    return ids;
  }
  function createManualEvidenceBlockMutation({ figureId, blockId, id, selected, extra, values = {} }) {
    if (!figureId || !(blockId || id)) throw new Error('当前 Figure 或证据块标识缺失，请重新打开。');
    const block = { panelIds: manualEvidencePanelIds(selected, extra) };
    for (const [field] of fields) {
      block[field] = value(values[field]).trim();
      if (block[field].length > 4000) throw new Error('每项说明最多 4000 字，请缩短后保存。');
    }
    return blockId
      ? { type: 'update_manual_evidence_block', figureId, blockId, block, createMissingPanels: true }
      : { type: 'add_manual_evidence_block', figureId, block: { id, ...block }, createMissingPanels: true };
  }
  function createManualEvidenceRegroupMutation({ operation, figureId, source, newBlockId, selected, extra, mergeBlockId, values }) {
    if (!source?.id || !figureId) throw new Error('当前证据块不存在，请重新打开。');
    const block = createManualEvidenceBlockMutation({ figureId, blockId: source.id, selected: source.panelIds, values }).block;
    delete block.panelIds;
    if (operation === 'split') {
      const panelIds = manualEvidencePanelIds(selected, '');
      if (!newBlockId || panelIds.length >= source.panelIds.length || panelIds.some(id => !source.panelIds.includes(id))) {
        throw new Error('拆分时请选择原块的一部分 Panel；原块和新块都至少保留一个。');
      }
      return { type: 'split_manual_evidence_block', figureId, blockId: source.id, newBlockId, panelIds, block };
    }
    if (String(extra || '').trim() || (selected && (selected.length !== source.panelIds.length || selected.some(id => !source.panelIds.includes(id))))) {
      throw new Error('上方 Panel 成员尚有修改，请先保存成员变化，再进行合并。');
    }
    if (operation !== 'merge' || !mergeBlockId || mergeBlockId === source.id) throw new Error('请选择另一个需要合并的证据块。');
    return { type: 'merge_manual_evidence_blocks', figureId, blockId: source.id, sourceBlockIds: [mergeBlockId], block };
  }
  function createManualEvidenceBlockEditor(options) {
    const doc = options.document;
    let current = null;
    function close() {
      const prior = current; current = null;
      if (!prior) return;
      prior.dialog.close?.(); prior.dialog.remove();
      if (prior.focus?.isConnected) prior.focus.focus();
    }
    function open({ figure, panels = [], block = null, blocks = [] }) {
      close();
      const context = options.getContext();
      const dialog = doc.createElement('dialog');
      dialog.className = 'manual-evidence-dialog';
      dialog.setAttribute('data-brevess-interface', '');
      const editTitle = block ? '调整分组与说明' : '手动组合 Panel';
      dialog.setAttribute('aria-label', editTitle);
      const state = { dialog, context, focus: doc.activeElement, busy: false };
      current = state;
      const element = (tag, text, className = '') => {
        const node = doc.createElement(tag); node.textContent = text; node.className = className; return node;
      };
      const heading = element('h3', '');
      heading.append(authored(element('span', figure.figureLabel || 'Figure')), doc.createTextNode(' · '), element('span', editTitle));
      const note = element('p', '选择原图中共同支持一项结论的 Panel。说明可留空，保存后可直接拖到机制图联系上。', 'manual-evidence-note');
      const form = doc.createElement('form');
      const choices = element('fieldset', ''); choices.append(element('legend', '选择 Panel（可多选）'));
      const known = [...new Set([...panels.map(panel => String(panel.panelId || panel.panel || '').toUpperCase()), ...(block?.panelIds || [])])].filter(Boolean);
      const selected = new Set(block?.panelIds || []);
      const occupied = new Set(blocks.filter(other => other.id !== block?.id && other.kind !== 'transition' && other.sourceType !== 'bridge').flatMap(other => other.panelIds || []));
      for (const panelId of known) {
        const label = element('label', '', 'manual-evidence-choice');
        const checkbox = doc.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = panelId; checkbox.checked = selected.has(panelId);
        checkbox.dataset.occupied = String(occupied.has(panelId) && !selected.has(panelId));
        checkbox.disabled = checkbox.dataset.occupied === 'true';
        if (checkbox.disabled) { label.classList.add('is-occupied'); label.title = '已被其他证据块选用'; }
        label.append(checkbox, element('span', checkbox.disabled ? `${panelId} · 已选用` : panelId)); choices.append(label);
      }
      if (!known.length) choices.append(element('p', '尚无 Panel 目录，请对照原图填写下方编号。', 'manual-evidence-note'));
      const extraLabel = element('label', '补充原图中的 Panel 编号', 'manual-evidence-field');
      const extra = doc.createElement('input'); extra.type = 'text'; extra.placeholder = '例如 A、C、D'; extra.maxLength = 240;
      extraLabel.append(extra, element('small', '逐个填写图中已有编号；会保存为人工定义的 Panel，不推测图像或实验内容。'));
      form.append(choices, extraLabel);
      const inputs = {};
      const initialValues = manualEvidenceEditorValues(block, panels);
      for (const [field, labelText] of fields) {
        const label = element('label', labelText, 'manual-evidence-field');
        const input = doc.createElement('textarea'); input.rows = field === 'title' ? 2 : 3; input.maxLength = 4000; input.value = initialValues[field];
        input.name = field; inputs[field] = input; label.append(input); form.append(label);
      }
      form.append(element('p', '充分、必要、相关在绑定到具体联系后定义。人工证据块会在后续 AI 更新中保留。', 'manual-evidence-note'));
      const status = element('p', '', 'manual-evidence-status'); status.setAttribute('role', 'status');
      const actions = element('div', '', 'manual-evidence-actions');
      const cancel = element('button', '取消', 'btn btn-secondary'); cancel.type = 'button'; cancel.addEventListener('click', close);
      const save = element('button', '保存证据块', 'btn btn-primary'); save.type = 'submit';
      actions.append(cancel, save); form.append(status, actions); dialog.append(heading, note, form);
      const controls = () => Array.from(form.querySelectorAll('input, textarea, button, select'));
      async function persist(mutation) {
        if (state.busy || current !== state) return;
        state.busy = true; controls().forEach(control => { control.disabled = true; });
        status.textContent = '正在保存…';
        try {
          if (!options.isCurrent(context)) throw new Error('文献或草稿已有变化。本次输入仍保留，请复制后重新打开编辑器。');
          if (['add_manual_evidence_block', 'update_manual_evidence_block'].includes(mutation.type)) {
            const conflict = (mutation.block.panelIds || []).find(id => occupied.has(id) && !selected.has(id));
            if (conflict) throw new Error(`Panel ${conflict} 已被其他证据块选用，请先从原块释放。`);
          }
          const result = await options.persist(mutation, context);
          if (current !== state) return;
          if (!options.isCurrent(context) && !options.isAcknowledged?.(result, context)) throw new Error('文献或草稿已有变化，本次保存结果未应用到当前界面。');
          if (!result?.success || !result.draft) throw new Error(result?.error || '证据块未保存。输入已保留，请重试。');
          options.onSaved?.(result, context, { figureId: figure.figureId, blockId: mutation.newBlockId || block?.id || mutation.block?.id });
          close();
        } catch (error) {
          if (current === state) status.textContent = /[\u3400-\u9fff]/u.test(error.message) ? error.message : '证据块未保存。请核对 Panel 编号后重试；输入已保留。';
        } finally {
          state.busy = false; if (current === state) controls().forEach(control => { control.disabled = control.dataset.occupied === 'true'; });
        }
      }
      form.addEventListener('submit', event => {
        event.preventDefault();
        try {
          const mutation = createManualEvidenceBlockMutation({ figureId: figure.figureId, blockId: block?.id,
            id: block?.id || options.makeId(), selected: Array.from(choices.querySelectorAll('input:checked')).map(input => input.value),
            extra: extra.value, values: Object.fromEntries(fields.map(([field]) => [field, inputs[field].value])) });
          void persist(mutation);
        } catch (error) { status.textContent = error.message; }
      });
      if (block) {
        const regroup = element('details', '', 'manual-evidence-regroup');
        regroup.append(element('summary', '拆分或合并分组'));
        regroup.append(element('p', '拆分会把上方勾选的原有 Panel 移到新块，新块使用当前填写的说明；合并将选定块成员加入当前块，使用当前填写的说明，被并入块的说明保留在合并历史。旧联系引用保留并提示复核，证据类型不会自动转移。', 'manual-evidence-note'));
        const split = element('button', '将勾选 Panel 拆为新块', 'btn btn-secondary'); split.type = 'button';
        const values = () => Object.fromEntries(fields.map(([field]) => [field, inputs[field].value]));
        split.addEventListener('click', () => {
          try {
            if (extra.value.trim()) throw new Error('拆分仅移动原块已有成员；请先清空补充编号。');
            void persist(createManualEvidenceRegroupMutation({ operation: 'split', figureId: figure.figureId, source: block,
              newBlockId: options.makeId(), selected: Array.from(choices.querySelectorAll('input:checked')).map(input => input.value), values: values() }));
          } catch (error) { status.textContent = error.message; }
        });
        regroup.append(split);
        const mergeLabel = element('label', '合并另一个证据块', 'manual-evidence-field');
        const mergeSource = doc.createElement('select'); mergeSource.setAttribute('aria-label', '合并另一个证据块');
        const empty = element('option', '选择当前 Figure 的其他块'); empty.value = ''; mergeSource.append(empty);
        for (const other of blocks.filter(item => item.id !== block.id && item.kind !== 'transition' && item.sourceType !== 'bridge' && item.panelIds?.length)) {
          const option = authored(element('option', `${other.panelIds.join('、')} · ${manualEvidenceEditorValues(other).title || t('未填写标题')}`));
          option.value = other.id; mergeSource.append(option);
        }
        mergeLabel.append(mergeSource); regroup.append(mergeLabel);
        const merge = element('button', '合并所选块到当前块', 'btn btn-secondary'); merge.type = 'button';
        merge.addEventListener('click', () => {
          try { void persist(createManualEvidenceRegroupMutation({ operation: 'merge', figureId: figure.figureId, source: block, mergeBlockId: mergeSource.value,
            selected: Array.from(choices.querySelectorAll('input:checked')).map(input => input.value), extra: extra.value, values: values() })); }
          catch (error) { status.textContent = error.message; }
        });
        regroup.append(merge); form.insertBefore(regroup, status);
        const remove = element('button', '移除此证据块', 'btn btn-secondary'); remove.type = 'button';
        remove.addEventListener('click', () => void persist({ type: 'remove_evidence_block', figureId: figure.figureId, blockId: block.id }));
        actions.prepend(remove);
        form.insertBefore(element('p', '改变 Panel 成员或移除证据块后，已绑定的联系会保留来源记录并提示复核。', 'manual-evidence-note'), status);
      }
      dialog.addEventListener('cancel', event => { event.preventDefault(); if (!state.busy) close(); });
      doc.body.append(dialog); dialog.showModal();
      (choices.querySelector('input') || extra).focus();
      return dialog;
    }
    return Object.freeze({ open, close });
  }
  return { manualEvidencePanelIds, manualEvidenceEditorValues, createManualEvidenceBlockMutation, createManualEvidenceRegroupMutation, createManualEvidenceArchiveDetails, createManualEvidenceBlockEditor };
});


;/* native/core/mechanism-network.js */
(function attach(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(host) {
  'use strict';

  const MAX_NODES = 64;
  const MAX_EDGES = 64;
  const MECHANISM_NETWORK_EXPORT_SCHEMA = 'brevess.mechanism-network';
  const MECHANISM_NETWORK_EXPORT_VERSION = 2;
  const MECHANISM_NETWORK_LEGACY_VERSION = 1;
  const MAX_MECHANISM_GENERATION_LENGTH = 750000;
  const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

  function ownDataProperty(value, key) {
    if (!value || typeof value !== 'object') {
      return { readable: false, present: false, value: undefined };
    }
    try {
      if (Array.isArray(value)) {
        return { readable: false, present: false, value: undefined };
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        return { readable: false, present: false, value: undefined };
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) return { readable: true, present: false, value: undefined };
      if (!Object.hasOwn(descriptor, 'value')) {
        return { readable: false, present: true, value: undefined };
      }
      return { readable: true, present: true, value: descriptor.value };
    } catch (_) {
      return { readable: false, present: false, value: undefined };
    }
  }

  function ownDataValue(value, key) {
    const property = ownDataProperty(value, key);
    return property.readable && property.present ? property.value : undefined;
  }

  function cappedDataArrayRead(value, maximum) {
    let length;
    try {
      if (!Array.isArray(value)) return { values: [], complete: false };
      const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
      length = descriptor && Object.hasOwn(descriptor, 'value')
        ? descriptor.value : -1;
    } catch (_) {
      return { values: [], complete: false };
    }
    if (!Number.isSafeInteger(length) || length < 0) {
      return { values: [], complete: false };
    }
    const values = [];
    let complete = length <= maximum;
    const limit = Math.min(length, maximum);
    for (let index = 0; index < limit; index += 1) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, String(index)); }
      catch (_) {
        complete = false;
        continue;
      }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        complete = false;
        continue;
      }
      values.push(descriptor.value);
    }
    return { values, complete };
  }

  function cappedDataArray(value, maximum) {
    return cappedDataArrayRead(value, maximum).values;
  }

  function ownCappedDataArray(owner, key, maximum) {
    const property = ownDataProperty(owner, key);
    if (!property.readable) return { values: [], complete: false };
    if (!property.present) return { values: [], complete: true };
    return cappedDataArrayRead(property.value, maximum);
  }

  function graphParts(chain) {
    const nodeRead = ownCappedDataArray(chain, 'nodes', MAX_NODES);
    const rawNodes = nodeRead.values;
    const nodes = [];
    const allowed = new Set();
    let locatorAuthority = nodeRead.complete;
    for (const node of rawNodes) {
      const idProperty = ownDataProperty(node, 'id');
      const id = idProperty.readable && idProperty.present ? idProperty.value : undefined;
      if (typeof id !== 'string' || !id) {
        locatorAuthority = false;
        continue;
      }
      if (allowed.has(id)) continue;
      allowed.add(id);
      nodes.push({ id, source: node });
    }
    const edgeRead = ownCappedDataArray(chain, 'edges', MAX_EDGES);
    const rawEdges = edgeRead.values;
    locatorAuthority = locatorAuthority && edgeRead.complete;
    const edges = [];
    for (const edge of rawEdges) {
      const idProperty = ownDataProperty(edge, 'id');
      const fromProperty = ownDataProperty(edge, 'from');
      const toProperty = ownDataProperty(edge, 'to');
      const id = idProperty.readable && idProperty.present ? idProperty.value : undefined;
      const from = fromProperty.readable && fromProperty.present ? fromProperty.value : undefined;
      const to = toProperty.readable && toProperty.present ? toProperty.value : undefined;
      if (typeof id !== 'string' || !id || typeof from !== 'string' ||
          typeof to !== 'string' || !allowed.has(from) || !allowed.has(to)) {
        locatorAuthority = false;
        continue;
      }
      edges.push({
        id,
        from,
        to,
        polarity: ownDataValue(edge, 'polarity') === 'positive' ||
          ownDataValue(edge, 'polarity') === 'negative'
          ? ownDataValue(edge, 'polarity') : 'neutral',
        source: edge
      });
    }
    return { nodes, nodeIds: nodes.map(node => node.id), edges, locatorAuthority };
  }

  function boundedDisplayText(value, maximum = 180) {
    return typeof value === 'string'
      ? value.normalize('NFC')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ').trim().slice(0, maximum)
      : '';
  }

  function mechanismNodeLabel(node, fallback) {
    const label = ownDataValue(node, 'label');
    return boundedDisplayText(ownDataValue(label, 'value'), 180) || fallback;
  }

  function createMechanismMermaidDefinition(chain, options = {}) {
    const graph = graphParts(chain);
    const isEnglish = String(options.language || '').toLowerCase().startsWith('en');
    const aliases = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));
    const direction = String(options.direction || '').toUpperCase() === 'TD' ? 'TD' : 'LR';
    const lines = [`flowchart ${direction}`];
    graph.nodes.forEach((node, index) => {
      const fallback = isEnglish ? `Mechanism node ${index + 1}` : `机制节点 ${index + 1}`;
      const label = safeGraphLabel(mechanismNodeLabel(node.source, fallback), fallback)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/[\[\]{}]/g, character => `&#${character.codePointAt(0)};`);
      lines.push(`  ${aliases.get(node.id)}["${label}"]`);
    });
    graph.edges.forEach(edge => {
      const from = aliases.get(edge.from);
      const to = aliases.get(edge.to);
      if (!from || !to) return;
      lines.push(`  ${from} ${edge.polarity === 'negative' ? '-.->' : '-->'} ${to}`);
    });
    return lines.join('\n');
  }

  function panelAliasValue(chain, panelKey) {
    if (!panelKey) return '';
    const aliases = ownDataValue(chain, 'panelAliases');
    const alias = ownDataValue(aliases, panelKey);
    return boundedDisplayText(ownDataValue(alias, 'value'), 80);
  }

  function normalizeMatrixEvidence(chain, edgeSource, ownerEdgeId) {
    const evidence = cappedDataArray(ownDataValue(edgeSource, 'panelEvidence'), 64);
    const result = [];
    const seen = new Set();
    for (let evidenceIndex = 0; evidenceIndex < evidence.length; evidenceIndex += 1) {
      const item = evidence[evidenceIndex];
      const figureId = boundedDisplayText(ownDataValue(item, 'figureId'), 160);
      const panelId = boundedDisplayText(ownDataValue(item, 'panelId'), 80);
      const panelKey = figureId && panelId ? `${figureId}:${panelId}` : '';
      const originalDisplayId = boundedDisplayText(ownDataValue(item, 'value'), 80);
      const displayName = panelAliasValue(chain, panelKey) || originalDisplayId;
      const identity = panelKey || `display:${originalDisplayId}`;
      if (!displayName || seen.has(identity)) continue;
      seen.add(identity);
      const rawClass = ownDataValue(item, 'evidenceClass');
      result.push({
        panelKey,
        figureId,
        panelId,
        originalDisplayId,
        displayName,
        evidenceClass: rawClass === 'sufficiency' || rawClass === 'necessity'
          ? rawClass : 'other',
        ownerEdgeId: boundedDisplayText(ownerEdgeId, 160),
        edgeId: boundedDisplayText(ownerEdgeId, 160),
        evidenceIndex
      });
    }
    return result;
  }

  function chainMatrixRelationDescriptor(edge, ordinal) {
    const relationKind = ownDataValue(edge.source, 'relationKind') === 'correlative'
      ? 'correlative' : 'causal';
    const rawLabel = ownDataValue(edge.source, 'label');
    const label = boundedDisplayText(ownDataValue(rawLabel, 'value'), 180);
    return {
      id: edge.id,
      ordinal,
      polarity: edge.polarity,
      relationKind,
      contested: ownDataValue(edge.source, 'contested') === true,
      label,
      labelSource: label && ownDataValue(rawLabel, 'humanReviewed') !== false
        ? 'source' : 'generated'
    };
  }

  function createMechanismEvidenceMatrix(chain) {
    const graph = graphParts(chain);
    const nodes = graph.nodes.map((node, index) => ({
      id: node.id,
      label: mechanismNodeLabel(node.source, `Node ${index + 1}`)
    }));
    const byPair = new Map();
    const edgeIdsByPair = new Map();
    const relationDescriptorsByPair = new Map();
    graph.edges.forEach(edge => {
      const key = `${edge.from}\u0000${edge.to}`;
      const current = byPair.get(key) || [];
      const edgeIds = edgeIdsByPair.get(key) || [];
      const relationDescriptors = relationDescriptorsByPair.get(key) || [];
      if (!edgeIds.includes(edge.id)) {
        edgeIds.push(edge.id);
        relationDescriptors.push(chainMatrixRelationDescriptor(
          edge, relationDescriptors.length + 1
        ));
      }
      normalizeMatrixEvidence(chain, edge.source, edge.id)
        .forEach(item => current.push(item));
      byPair.set(key, current);
      edgeIdsByPair.set(key, edgeIds);
      relationDescriptorsByPair.set(key, relationDescriptors);
    });
    const cells = [];
    nodes.forEach(row => nodes.forEach(column => {
      cells.push({
        from: row.id,
        to: column.id,
        edgeIds: edgeIdsByPair.get(`${row.id}\u0000${column.id}`) || [],
        relationDescriptors:
          relationDescriptorsByPair.get(`${row.id}\u0000${column.id}`) || [],
        evidence: byPair.get(`${row.id}\u0000${column.id}`) || []
      });
    }));
    return { nodes, cells };
  }

  const EVIDENCE_CODE_ORDER = Object.freeze(['S', 'N', 'R', 'E', 'I', 'A', 'O', '0', 'C', '?']);
  const EVIDENCE_CODES = new Set(EVIDENCE_CODE_ORDER);

  function normalizeMechanismEvidenceCode(value) {
    if (typeof value !== 'string') return '?';
    const token = value.trim().toLowerCase();
    return ({
      s: 'S', red: 'S', sufficiency: 'S',
      n: 'N', blue: 'N', necessity: 'N',
      r: 'R', rescue: 'R',
      e: 'E', epistasis: 'E',
      i: 'I', directional_intervention: 'I',
      a: 'A', associational: 'A', association: 'A', correlation: 'A',
      o: 'O', localization: 'O', node_observation: 'O', descriptive: 'O',
      '0': '0', null_result: '0', no_change: '0',
      c: 'C', counterevidence: 'C', counterclaim: 'C', refutes: 'C',
      '?': '?', black: '?', intervention: '?', other: '?', inconclusive: '?', mixed: '?'
    })[token] || '?';
  }

  function safeGraphLabel(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    let text = value.normalize('NFKC')
      .replace(/<[\s\S]*?>/gu, ' ')
      .replace(/(?:javascript|vbscript|data)\s*:/giu, ' ')
      .replace(/%%/gu, ' ')
      .replace(/\b(?:click|classDef|linkStyle|subgraph|flowchart|graph)\b/giu, ' ')
      .replace(/\b(?:Figure|Fig\.?|Panel)\s*(?:S?\d+[A-Z]?|[A-Z]\d*)\b/giu, ' ')
      .replace(/[\u0000-\u001F\u007F]/gu, ' ')
      .replace(/["'`\[\]{}<>|;]/gu, ' ')
      .replace(/\s+/gu, ' ').trim();
    text = Array.from(text).slice(0, 120).join('').trim();
    return text || fallback;
  }

  function readAuditPresentation(value) {
    if (ownDataValue(value, 'version') !== 'mechanism-audit-view-v1' ||
        ownDataValue(value, 'status') !== 'complete') return null;
    const rawNodes = cappedDataArray(ownDataValue(value, 'nodes'), MAX_NODES);
    const nodes = [];
    const nodeIds = new Set();
    for (let index = 0; index < rawNodes.length; index += 1) {
      const raw = rawNodes[index];
      const id = boundedDisplayText(ownDataValue(raw, 'id'), 160);
      const label = boundedDisplayText(ownDataValue(raw, 'label'), 240);
      const nodeType = boundedDisplayText(ownDataValue(raw, 'nodeType'), 40);
      if (!id || !label || nodeIds.has(id)) return null;
      nodeIds.add(id);
      nodes.push({ id, label, nodeType });
    }
    if (!nodes.length) return null;
    const rawRelations = cappedDataArray(ownDataValue(value, 'relations'), MAX_EDGES);
    const relations = [];
    const relationIds = new Set();
    for (const raw of rawRelations) {
      const id = boundedDisplayText(ownDataValue(raw, 'id'), 160);
      const from = boundedDisplayText(ownDataValue(raw, 'from'), 160);
      const to = boundedDisplayText(ownDataValue(raw, 'to'), 160);
      const relationKind = ownDataValue(raw, 'relationKind') === 'correlative'
        ? 'correlative' : 'causal';
      const renderable = ownDataValue(raw, 'renderable') === true;
      const lineStyle = relationKind === 'correlative' ? 'dashed' : 'solid';
      const polarity = ['increases', 'decreases', 'no_change', 'mixed', 'unknown']
        .includes(ownDataValue(raw, 'polarity')) ? ownDataValue(raw, 'polarity') : 'unknown';
      if (!id || !from || !to || from === to || !nodeIds.has(from) ||
          !nodeIds.has(to) || relationIds.has(id)) return null;
      relationIds.add(id);
      const evidence = cappedDataArray(ownDataValue(raw, 'evidence'), 1024).map(item => ({
        claimId: boundedDisplayText(ownDataValue(item, 'claimId'), 160),
        panelKey: boundedDisplayText(ownDataValue(item, 'panelKey'), 100),
        code: normalizeMechanismEvidenceCode(ownDataValue(item, 'code')),
        role: ownDataValue(item, 'role') === 'counterclaim' ? 'counterclaim' : 'supporting'
      })).filter(item => item.claimId && item.panelKey);
      relations.push({
        id, from, to, relationKind, renderable, lineStyle,
        contested: ownDataValue(raw, 'contested') === true,
        polarity, evidence
      });
    }
    const rawPlacements = cappedDataArray(ownDataValue(value, 'placements'), 1024);
    const placements = [];
    const placedClaims = new Set();
    for (const raw of rawPlacements) {
      const claimId = boundedDisplayText(ownDataValue(raw, 'claimId'), 160);
      const panelKey = boundedDisplayText(ownDataValue(raw, 'panelKey'), 100);
      const from = boundedDisplayText(ownDataValue(raw, 'from'), 160);
      const to = boundedDisplayText(ownDataValue(raw, 'to'), 160);
      const code = normalizeMechanismEvidenceCode(ownDataValue(raw, 'code'));
      const roleValue = ownDataValue(raw, 'role');
      const role = roleValue === 'counterclaim' ? 'counterclaim'
        : roleValue === 'supporting' ? 'supporting' : 'audit';
      const placementRelationIds = cappedDataArray(
        ownDataValue(raw, 'relationIds'), MAX_EDGES
      ).map(id => boundedDisplayText(id, 160))
        .filter(id => relationIds.has(id));
      if (!claimId || !panelKey || !nodeIds.has(from) || !nodeIds.has(to) ||
          placedClaims.has(claimId) || !EVIDENCE_CODES.has(code)) return null;
      placedClaims.add(claimId);
      placements.push({
        claimId, panelKey, from, to, code, role,
        relationIds: [...new Set(placementRelationIds)]
      });
    }
    const disconnectedEvidence = cappedDataArray(
      ownDataValue(value, 'disconnectedEvidence'), MAX_NODES
    ).map(raw => {
      const nodeId = boundedDisplayText(ownDataValue(raw, 'nodeId'), 160);
      const label = boundedDisplayText(ownDataValue(raw, 'label'), 240);
      const codes = [...new Set(cappedDataArray(ownDataValue(raw, 'codes'), 10)
        .map(normalizeMechanismEvidenceCode))];
      const claimCount = ownDataValue(raw, 'claimCount');
      return nodeIds.has(nodeId) && label && Number.isSafeInteger(claimCount) && claimCount >= 0
        ? { nodeId, label, codes, claimCount } : null;
    }).filter(Boolean);
    const exclusions = cappedDataArray(ownDataValue(value, 'exclusions'), 512)
      .map(raw => ({
        panelKey: boundedDisplayText(ownDataValue(raw, 'panelKey'), 100),
        reason: ownDataValue(raw, 'reason') === 'source_backed_schematic'
          ? 'source_backed_schematic' : ''
      })).filter(item => item.panelKey && item.reason);
    return { nodes, relations, placements, disconnectedEvidence, exclusions };
  }

  function createMechanismAuditEvidenceMatrix(value) {
    const audit = readAuditPresentation(value);
    if (!audit) return { nodes: [], cells: [] };
    const nodes = audit.nodes.map(node => ({ id: node.id, label: node.label }));
    const relationsByPair = new Map();
    for (const relation of audit.relations) {
      const key = `${relation.from}\u0000${relation.to}`;
      if (!relationsByPair.has(key)) relationsByPair.set(key, []);
      relationsByPair.get(key).push(relation);
    }
    const evidenceByPair = new Map();
    for (const placement of audit.placements) {
      const key = `${placement.from}\u0000${placement.to}`;
      if (!evidenceByPair.has(key)) evidenceByPair.set(key, []);
      evidenceByPair.get(key).push({ ...placement });
    }
    const cells = [];
    nodes.forEach(row => nodes.forEach(column => {
      const key = `${row.id}\u0000${column.id}`;
      const relations = relationsByPair.get(key) || [];
      const positive = relations.filter(relation => relation.renderable);
      const causal = positive.some(relation => relation.relationKind === 'causal');
      const correlative = positive.some(relation => relation.relationKind === 'correlative');
      const cellEvidence = evidenceByPair.get(key) || [];
      const counterevidence = cellEvidence.some(item =>
        item.role === 'counterclaim' || item.code === 'C');
      cells.push({
        from: row.id,
        to: column.id,
        relationIds: relations.map(relation => relation.id),
        edgeIds: relations.map(relation => relation.id),
        relationDescriptors: relations.map((relation, index) => ({
          id: relation.id,
          ordinal: index + 1,
          polarity: relation.polarity,
          relationKind: relation.relationKind,
          contested: relation.contested,
          label: relationWording(relation),
          labelSource: 'generated'
        })),
        evidence: cellEvidence,
        lineStyle: causal ? 'solid' : correlative ? 'dashed' : 'none',
        contested: positive.length > 0 && (
          relations.some(relation => relation.contested) || counterevidence
        ),
        positiveEdge: positive.length > 0
      });
    }));
    return { nodes, cells };
  }

  function mechanismEvidenceClass(value, claimCode = '?') {
    if (value === 'sufficiency' || value === 'necessity' || value === 'other') {
      return value;
    }
    return claimCode === 'S' ? 'sufficiency'
      : claimCode === 'N' ? 'necessity' : 'other';
  }

  function splitAuditPanelKey(value) {
    const panelKey = boundedDisplayText(value, 260);
    const separator = panelKey.lastIndexOf(':');
    if (separator < 1 || separator === panelKey.length - 1) {
      return { panelKey, figureId: '', panelId: '' };
    }
    return {
      panelKey,
      figureId: boundedDisplayText(panelKey.slice(0, separator), 160),
      panelId: boundedDisplayText(panelKey.slice(separator + 1), 80)
    };
  }

  function auditedPanelCatalog(rawOptions) {
    const catalog = new Map();
    for (const raw of cappedDataArray(rawOptions, 512)) {
      const explicitKey = boundedDisplayText(ownDataValue(raw, 'panelKey'), 260);
      const figureId = boundedDisplayText(ownDataValue(raw, 'figureId'), 160);
      const panelId = boundedDisplayText(ownDataValue(raw, 'panelId'), 80);
      const panelKey = explicitKey || (figureId && panelId ? `${figureId}:${panelId}` : '');
      const originalDisplayId = boundedDisplayText(
        ownDataValue(raw, 'originalDisplayId') || ownDataValue(raw, 'displayId'), 80
      );
      if (!panelKey || !originalDisplayId || catalog.has(panelKey)) continue;
      catalog.set(panelKey, {
        originalDisplayId,
        evidenceClass: mechanismEvidenceClass(ownDataValue(raw, 'evidenceClass'))
      });
    }
    return catalog;
  }

  function auditedChainEvidenceRecords(chain, relevantRelationIds) {
    const graph = graphParts(chain);
    let locatorAuthority = graph.locatorAuthority;
    const edgeIdCounts = new Map();
    for (const edge of graph.edges) {
      edgeIdCounts.set(edge.id, (edgeIdCounts.get(edge.id) || 0) + 1);
    }
    const records = [];
    for (const edge of graph.edges) {
      const related = relevantRelationIds.has(edge.id);
      const evidenceRead = ownCappedDataArray(edge.source, 'panelEvidence', 64);
      if (related && !evidenceRead.complete) locatorAuthority = false;
      const evidence = evidenceRead.values;
      for (let evidenceIndex = 0; evidenceIndex < evidence.length; evidenceIndex += 1) {
        const item = evidence[evidenceIndex];
        const figureProperty = ownDataProperty(item, 'figureId');
        const panelProperty = ownDataProperty(item, 'panelId');
        const figureId = boundedDisplayText(
          figureProperty.readable && figureProperty.present ? figureProperty.value : undefined,
          160
        );
        const panelId = boundedDisplayText(
          panelProperty.readable && panelProperty.present ? panelProperty.value : undefined,
          80
        );
        if (!figureId || !panelId) {
          if (related) locatorAuthority = false;
          continue;
        }
        records.push({
          ownerEdgeId: edge.id,
          ownerEdgeIdUnique: edgeIdCounts.get(edge.id) === 1,
          from: edge.from,
          to: edge.to,
          evidenceIndex,
          panelKey: `${figureId}:${panelId}`,
          figureId,
          panelId,
          originalDisplayId: boundedDisplayText(ownDataValue(item, 'value'), 80),
          evidenceClass: mechanismEvidenceClass(ownDataValue(item, 'evidenceClass'))
        });
      }
    }
    return { records, locatorAuthority };
  }

  function auditedEvidenceLocatorBucket(index, edgeId, panelKey, from, to, create = false) {
    const parts = [edgeId, panelKey, from, to];
    let level = index;
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const finalPart = partIndex === parts.length - 1;
      let next = level.get(parts[partIndex]);
      if (!next && create) {
        next = finalPart ? [] : new Map();
        level.set(parts[partIndex], next);
      }
      if (!next) return null;
      if (finalPart) return next;
      level = next;
    }
    return null;
  }

  // Reconcile the immutable audit placement with the editable chain without
  // manufacturing ownership. Only an exact (relationIds, panelKey) singleton
  // receives an edit locator; node-only and ambiguous placements remain views.
  function createMechanismAuditEvidenceView(chain, value, panelOptions = []) {
    const audit = readAuditPresentation(value);
    const matrix = createMechanismAuditEvidenceMatrix(value);
    if (!audit) {
      return { version: 'mechanism-audit-evidence-view-v1', nodes: [], cells: [] };
    }
    const panelCatalog = auditedPanelCatalog(panelOptions);
    const relevantRelationIds = new Set();
    matrix.cells.forEach(cell => cell.evidence.forEach(placement => {
      placement.relationIds.forEach(relationId => relevantRelationIds.add(relationId));
    }));
    const evidenceRead = auditedChainEvidenceRecords(chain, relevantRelationIds);
    const records = evidenceRead.records;
    const recordsByPanel = new Map();
    const recordsByLocator = new Map();
    const recordOrder = new Map();
    records.forEach((record, index) => {
      recordOrder.set(record, index);
      if (!recordsByPanel.has(record.panelKey)) recordsByPanel.set(record.panelKey, []);
      recordsByPanel.get(record.panelKey).push(record);
      auditedEvidenceLocatorBucket(
        recordsByLocator,
        record.ownerEdgeId, record.panelKey, record.from, record.to,
        true
      ).push(record);
    });
    const cells = matrix.cells.map(cell => ({
      ...cell,
      evidence: cell.evidence.map(placement => {
        const panelIdentity = splitAuditPanelKey(placement.panelKey);
        const relationIds = new Set(placement.relationIds);
        const placementKind = relationIds.size === 0 && cell.from === cell.to
          ? 'node_only' : 'relation';
        const matches = [];
        if (placementKind !== 'node_only') {
          relationIds.forEach(relationId => {
            const candidates = auditedEvidenceLocatorBucket(
              recordsByLocator,
              relationId, panelIdentity.panelKey, cell.from, cell.to
            );
            if (candidates) matches.push(...candidates);
          });
          if (relationIds.size > 1 && matches.length > 1) {
            matches.sort((left, right) => recordOrder.get(left) - recordOrder.get(right));
          }
        }
        const catalogEntry = panelCatalog.get(panelIdentity.panelKey);
        const displayRecord = matches[0] || recordsByPanel.get(panelIdentity.panelKey)?.[0];
        const originalDisplayId = catalogEntry?.originalDisplayId ||
          displayRecord?.originalDisplayId || panelIdentity.panelKey;
        const candidateClasses = [...new Set(matches.map(item => item.evidenceClass))];
        const evidenceClass = mechanismEvidenceClass(
          matches.length === 1 ? matches[0].evidenceClass
            : candidateClasses.length === 1 ? candidateClasses[0]
              : catalogEntry?.evidenceClass,
          placement.code
        );
        const uniquelyMapped = evidenceRead.locatorAuthority && relationIds.size === 1 &&
          matches.length === 1 && matches[0].ownerEdgeIdUnique;
        const mappingStatus = placementKind === 'node_only' ? 'node_only'
          : uniquelyMapped ? 'unique'
            : matches.length > 0 ? 'ambiguous' : 'unmapped';
        return {
          ...placement,
          figureId: panelIdentity.figureId,
          panelId: panelIdentity.panelId,
          originalDisplayId,
          displayName: panelAliasValue(chain, panelIdentity.panelKey) || originalDisplayId,
          evidenceClass,
          claimCode: placement.code,
          placementKind,
          mappingStatus,
          ...(uniquelyMapped ? {
            ownerEdgeId: matches[0].ownerEdgeId,
            edgeId: matches[0].ownerEdgeId,
            evidenceIndex: matches[0].evidenceIndex
          } : {})
        };
      })
    }));
    return {
      version: 'mechanism-audit-evidence-view-v1',
      nodes: matrix.nodes,
      cells
    };
  }

  function graphComponents(nodes, edges) {
    const order = new Map(nodes.map((node, index) => [node.id, index]));
    const byNode = new Map(nodes.map(node => [node.id, []]));
    edges.forEach(edge => {
      byNode.get(edge.from)?.push(edge);
      byNode.get(edge.to)?.push(edge);
    });
    const visited = new Set();
    const components = [];
    for (const node of nodes) {
      if (visited.has(node.id) || !(byNode.get(node.id) || []).length) continue;
      const queue = [node.id];
      const nodeIds = [];
      const edgeIds = new Set();
      while (queue.length) {
        const id = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        nodeIds.push(id);
        for (const edge of byNode.get(id) || []) {
          edgeIds.add(edge.id);
          const next = edge.from === id ? edge.to : edge.from;
          if (!visited.has(next)) queue.push(next);
        }
      }
      nodeIds.sort((left, right) => order.get(left) - order.get(right));
      components.push({
        componentId: `component-${components.length + 1}`,
        nodeIds,
        edgeIds: [...edgeIds]
      });
    }
    return components;
  }

  function relationWording(relation) {
    if (relation.relationKind === 'correlative') return 'associated with';
    return relation.polarity === 'decreases' ? 'decreases' :
      relation.polarity === 'increases' ? 'increases' : 'affects';
  }

  function createMechanismGraphExportDto(value) {
    const audit = readAuditPresentation(value);
    if (audit) {
      const nodeOrder = new Map(audit.nodes.map((node, index) => [node.id, index]));
      const byPair = new Map();
      audit.relations.filter(relation => relation.renderable).forEach(relation => {
        const key = `${relation.from}\u0000${relation.to}`;
        if (!byPair.has(key)) byPair.set(key, []);
        byPair.get(key).push(relation);
      });
      const edges = [...byPair.values()].map((relations, index) => {
        const causal = relations.some(relation => relation.relationKind === 'causal');
        const basis = causal
          ? relations.find(relation => relation.relationKind === 'causal') : relations[0];
        const codes = [];
        relations.forEach(relation => relation.evidence.forEach(item => {
          if (!codes.includes(item.code)) codes.push(item.code);
        }));
        const pairCounterevidence = audit.placements.some(item =>
          item.from === basis.from && item.to === basis.to &&
          (item.role === 'counterclaim' || item.code === 'C'));
        if (pairCounterevidence && !codes.includes('C')) codes.push('C');
        codes.sort((left, right) =>
          EVIDENCE_CODE_ORDER.indexOf(left) - EVIDENCE_CODE_ORDER.indexOf(right));
        return {
          id: `graph-edge-${index + 1}`,
          from: basis.from,
          to: basis.to,
          label: relationWording(basis),
          lineStyle: causal ? 'solid' : 'dashed',
          contested: relations.some(relation => relation.contested) || pairCounterevidence,
          codes,
          polarity: basis.polarity === 'decreases' ? 'negative'
            : basis.polarity === 'increases' ? 'positive' : 'neutral'
        };
      });
      const connected = new Set(edges.flatMap(edge => [edge.from, edge.to]));
      const nodes = audit.nodes.filter(node => connected.has(node.id)).map((node, index) => ({
        id: node.id,
        label: safeGraphLabel(node.label, `Mechanism node ${index + 1}`)
      }));
      edges.sort((left, right) => {
        const byFrom = nodeOrder.get(left.from) - nodeOrder.get(right.from);
        return byFrom || nodeOrder.get(left.to) - nodeOrder.get(right.to);
      });
      const components = graphComponents(nodes, edges);
      return {
        schema: 'brevess.mechanism-graph', schemaVersion: 1,
        nodes, edges, components,
        disconnectedEvidence: audit.disconnectedEvidence.map((item, index) => ({
          nodeId: item.nodeId,
          label: safeGraphLabel(item.label, `Evidence-only node ${index + 1}`),
          codes: item.codes.filter(code => EVIDENCE_CODES.has(code)),
          claimCount: item.claimCount
        })),
        exclusions: audit.exclusions.length
          ? [{ reason: 'source_backed_schematic', count: audit.exclusions.length }] : []
      };
    }
    const graph = graphParts(value);
    const nodes = graph.nodes.map((node, index) => ({
      id: node.id,
      label: safeGraphLabel(mechanismNodeLabel(
        node.source, `Mechanism node ${index + 1}`
      ), `Mechanism node ${index + 1}`)
    }));
    const edges = graph.edges.filter(edge => edge.from !== edge.to).map((edge, index) => ({
      id: `graph-edge-${index + 1}`,
      from: edge.from,
      to: edge.to,
      label: edge.polarity === 'negative' ? 'decreases'
        : edge.polarity === 'positive' ? 'increases' : 'affects',
      lineStyle: ownDataValue(edge.source, 'relationKind') === 'correlative'
        ? 'dashed' : 'solid',
      contested: ownDataValue(edge.source, 'contested') === true,
      codes: [],
      polarity: edge.polarity
    }));
    return {
      schema: 'brevess.mechanism-graph', schemaVersion: 1,
      nodes, edges, components: graphComponents(nodes, edges),
      disconnectedEvidence: [], exclusions: []
    };
  }

  function readGraphExportDto(value) {
    if (ownDataValue(value, 'schema') !== 'brevess.mechanism-graph' ||
        ownDataValue(value, 'schemaVersion') !== 1) return null;
    const nodes = cappedDataArray(ownDataValue(value, 'nodes'), MAX_NODES).map((raw, index) => ({
      id: boundedDisplayText(ownDataValue(raw, 'id'), 160),
      label: safeGraphLabel(ownDataValue(raw, 'label'), `Mechanism node ${index + 1}`)
    }));
    const ids = new Set(nodes.map(node => node.id));
    if (!nodes.length || ids.size !== nodes.length || nodes.some(node => !node.id)) return null;
    const edges = cappedDataArray(ownDataValue(value, 'edges'), MAX_EDGES).map(raw => ({
      id: boundedDisplayText(ownDataValue(raw, 'id'), 160),
      from: boundedDisplayText(ownDataValue(raw, 'from'), 160),
      to: boundedDisplayText(ownDataValue(raw, 'to'), 160),
      label: safeGraphLabel(ownDataValue(raw, 'label'), 'affects'),
      lineStyle: ownDataValue(raw, 'lineStyle') === 'dashed' ? 'dashed' : 'solid',
      contested: ownDataValue(raw, 'contested') === true,
      codes: [...new Set(cappedDataArray(ownDataValue(raw, 'codes'), 10)
        .map(normalizeMechanismEvidenceCode))],
      polarity: ['positive', 'negative'].includes(ownDataValue(raw, 'polarity'))
        ? ownDataValue(raw, 'polarity') : 'neutral'
    }));
    if (edges.some(edge => !edge.id || !ids.has(edge.from) || !ids.has(edge.to) ||
        edge.from === edge.to)) return null;
    return { nodes, edges };
  }

  function mechanismAuditRelationDisplayLabel(edge, language, generatedRelationLabels = false) {
    const english = String(language || '').toLowerCase().startsWith('en');
    const raw = boundedDisplayText(ownDataValue(edge, 'label'), 120);
    const generated = new Set(['associated with', 'decreases', 'increases', 'affects']);
    if (raw && (!generatedRelationLabels || !generated.has(raw.toLowerCase()))) return raw;
    if (ownDataValue(edge, 'lineStyle') === 'dashed' || raw.toLowerCase() === 'associated with') {
      return english ? 'associated with' : '相关';
    }
    const polarity = ownDataValue(edge, 'polarity');
    if (polarity === 'negative' || raw.toLowerCase() === 'decreases') {
      return english ? 'decreases' : '抑制';
    }
    if (polarity === 'positive' || raw.toLowerCase() === 'increases') {
      return english ? 'increases' : '促进';
    }
    return english ? 'affects' : '影响';
  }

  function createMechanismAuditMermaidDefinition(value, options = {}) {
    const graph = readGraphExportDto(value);
    if (!graph) return '';
    const direction = String(options.direction || '').toUpperCase() === 'TD' ? 'TD' : 'LR';
    const language = String(options.language || '').toLowerCase().startsWith('zh')
      ? 'zh-CN' : 'en';
    const generatedRelationLabels = options.generatedRelationLabels === true;
    const aliases = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));
    const lines = [`flowchart ${direction}`];
    graph.nodes.forEach(node => {
      lines.push(`  ${aliases.get(node.id)}["${node.label.replace(/&/gu, '&amp;')}"]`);
    });
    graph.edges.forEach((edge, index) => {
      const relationLabel = mechanismAuditRelationDisplayLabel(
        edge, language, generatedRelationLabels
      );
      const label = edge.contested
        ? (language === 'en' ? `contested: ${relationLabel}` : `有争议：${relationLabel}`)
        : relationLabel;
      lines.push(edge.lineStyle === 'dashed'
        ? `  ${aliases.get(edge.from)} -. ${label} .-> ${aliases.get(edge.to)}`
        : `  ${aliases.get(edge.from)} -->|${label}| ${aliases.get(edge.to)}`);
      const styles = edge.lineStyle === 'dashed'
        ? ['stroke:#111', 'stroke-dasharray:7 5'] : ['stroke:#354f5e'];
      if (edge.contested) styles.push('stroke:#8b5c20', 'stroke-width:3px');
      lines.push(`  linkStyle ${index} ${styles.join(',')}`);
    });
    return lines.join('\n');
  }

  function findMechanismStrongComponents(chain) {
    const { nodeIds, edges } = graphParts(chain);
    const order = new Map(nodeIds.map((id, index) => [id, index]));
    const outgoing = new Map(nodeIds.map(id => [id, []]));
    edges.forEach(edge => outgoing.get(edge.from).push(edge.to));
    outgoing.forEach(values => values.sort((left, right) =>
      order.get(left) - order.get(right)));

    let nextIndex = 0;
    const indexById = new Map();
    const lowById = new Map();
    const stack = [];
    const onStack = new Set();
    const components = [];

    function visit(id) {
      indexById.set(id, nextIndex);
      lowById.set(id, nextIndex);
      nextIndex += 1;
      stack.push(id);
      onStack.add(id);
      outgoing.get(id).forEach(target => {
        if (!indexById.has(target)) {
          visit(target);
          lowById.set(id, Math.min(lowById.get(id), lowById.get(target)));
        } else if (onStack.has(target)) {
          lowById.set(id, Math.min(lowById.get(id), indexById.get(target)));
        }
      });
      if (lowById.get(id) !== indexById.get(id)) return;
      const component = [];
      while (stack.length) {
        const member = stack.pop();
        onStack.delete(member);
        component.push(member);
        if (member === id) break;
      }
      component.sort((left, right) => order.get(left) - order.get(right));
      components.push(component);
    }

    nodeIds.forEach(id => {
      if (!indexById.has(id)) visit(id);
    });
    return components.sort((left, right) =>
      order.get(left[0]) - order.get(right[0]));
  }

  function mechanismNetworkFocusSet(chain, selection = {}) {
    const { nodeIds, edges } = graphParts(chain);
    const selectedEdge = edges.find(edge => edge.id === selection?.edgeId);
    const seeds = selectedEdge
      ? [selectedEdge.from, selectedEdge.to]
      : nodeIds.includes(selection?.nodeId) ? [selection.nodeId] : nodeIds;
    const forward = new Map(nodeIds.map(id => [id, []]));
    const reverse = new Map(nodeIds.map(id => [id, []]));
    edges.forEach(edge => {
      forward.get(edge.from).push(edge.to);
      reverse.get(edge.to).push(edge.from);
    });

    function traverse(table) {
      const visited = new Set(seeds);
      const queue = seeds.slice();
      while (queue.length) {
        const id = queue.shift();
        table.get(id).forEach(next => {
          if (visited.has(next)) return;
          visited.add(next);
          queue.push(next);
        });
      }
      return visited;
    }

    const nodeIdsInFocus = new Set([...traverse(forward), ...traverse(reverse)]);
    const edgeIdsInFocus = new Set(edges.filter(edge =>
      nodeIdsInFocus.has(edge.from) && nodeIdsInFocus.has(edge.to)
    ).map(edge => edge.id));
    return { nodeIds: nodeIdsInFocus, edgeIds: edgeIdsInFocus };
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function componentGraph(chain) {
    const graph = graphParts(chain);
    const components = findMechanismStrongComponents(chain);
    const componentByNode = new Map();
    components.forEach((nodeIds, index) => nodeIds.forEach(id => {
      componentByNode.set(id, index);
    }));
    const outgoing = new Map(components.map((_, index) => [index, new Set()]));
    const incoming = new Map(components.map((_, index) => [index, new Set()]));
    graph.edges.forEach(edge => {
      const from = componentByNode.get(edge.from);
      const to = componentByNode.get(edge.to);
      if (from === to || outgoing.get(from).has(to)) return;
      outgoing.get(from).add(to);
      incoming.get(to).add(from);
    });
    return { ...graph, components, componentByNode, outgoing, incoming };
  }

  function acyclicNodeRanks(graph, pinnedRanks) {
    const outgoing = new Map(graph.nodeIds.map(id => [id, new Set()]));
    const incoming = new Map(graph.nodeIds.map(id => [id, new Set()]));
    const backboneEdgeIds = new Set();

    function hasPath(from, target) {
      const seen = new Set([from]);
      const queue = [from];
      while (queue.length) {
        const id = queue.shift();
        if (id === target) return true;
        outgoing.get(id).forEach(next => {
          if (!seen.has(next)) { seen.add(next); queue.push(next); }
        });
      }
      return false;
    }

    graph.edges.forEach(edge => {
      if (edge.from === edge.to || hasPath(edge.to, edge.from)) return;
      outgoing.get(edge.from).add(edge.to);
      incoming.get(edge.to).add(edge.from);
      backboneEdgeIds.add(edge.id);
    });
    const indegree = new Map([...incoming.entries()].map(([id, values]) =>
      [id, values.size]));
    const rankByNode = new Map(graph.nodeIds.map(id => [id, 0]));
    const sourceOrder = new Map(graph.nodeIds.map((id, index) => [id, index]));
    const queue = graph.nodeIds.filter(id => indegree.get(id) === 0);
    while (queue.length) {
      const current = queue.shift();
      [...outgoing.get(current)].sort((left, right) =>
        sourceOrder.get(left) - sourceOrder.get(right)).forEach(next => {
        rankByNode.set(next, Math.max(rankByNode.get(next), rankByNode.get(current) + 1));
        indegree.set(next, indegree.get(next) - 1);
        if (indegree.get(next) === 0) queue.push(next);
      });
    }
    pinnedRanks.forEach((rank, id) => rankByNode.set(id, rank));
    return { rankByNode, backboneEdgeIds };
  }

  function layoutPreferenceMaps(options, allowed) {
    const source = options?.layoutPreferences;
    const pinnedRanks = new Map();
    const siblingOrder = new Map();
    for (const [key, target] of [
      ['pinnedRanks', pinnedRanks], ['siblingOrder', siblingOrder]
    ]) {
      const raw = ownDataValue(source, key);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      let descriptors;
      try { descriptors = Object.getOwnPropertyDescriptors(raw); }
      catch (_) { continue; }
      Object.keys(descriptors).sort().slice(0, MAX_NODES).forEach(id => {
        const descriptor = descriptors[id];
        const value = descriptor && Object.hasOwn(descriptor, 'value')
          ? descriptor.value : NaN;
        if (allowed.has(id) && Number.isSafeInteger(value) && value >= 0 && value < 64) {
          target.set(id, value);
        }
      });
    }
    return { pinnedRanks, siblingOrder };
  }

  function orderedRankRows(graph, rankByNode, siblingOrder) {
    const sourceOrder = new Map(graph.nodeIds.map((id, index) => [id, index]));
    const rows = new Map();
    graph.nodeIds.forEach(id => {
      const rank = rankByNode.get(id);
      if (!rows.has(rank)) rows.set(rank, []);
      rows.get(rank).push(id);
    });
    rows.forEach(ids => ids.sort((left, right) => {
      const leftOrder = siblingOrder.has(left) ? siblingOrder.get(left) : sourceOrder.get(left);
      const rightOrder = siblingOrder.has(right) ? siblingOrder.get(right) : sourceOrder.get(right);
      return leftOrder - rightOrder || sourceOrder.get(left) - sourceOrder.get(right);
    }));
    const incoming = new Map(graph.nodeIds.map(id => [id, []]));
    const outgoing = new Map(graph.nodeIds.map(id => [id, []]));
    graph.edges.forEach(edge => {
      outgoing.get(edge.from).push(edge.to);
      incoming.get(edge.to).push(edge.from);
    });
    const ranks = [...rows.keys()].sort((left, right) => left - right);
    for (let sweep = 0; sweep < 4; sweep += 1) {
      const forward = sweep % 2 === 0;
      const visitRanks = forward ? ranks : ranks.slice().reverse();
      const neighborTable = forward ? incoming : outgoing;
      const position = new Map();
      rows.forEach(ids => ids.forEach((id, index) => position.set(id, index)));
      visitRanks.forEach(row => {
        rows.get(row).sort((left, right) => {
          function barycenter(id) {
            const values = neighborTable.get(id).map(neighbor => position.get(neighbor))
              .filter(Number.isFinite);
            return values.length
              ? values.reduce((sum, value) => sum + value, 0) / values.length
              : position.get(id);
          }
          return barycenter(left) - barycenter(right) ||
            (siblingOrder.get(left) ?? sourceOrder.get(left)) -
              (siblingOrder.get(right) ?? sourceOrder.get(right)) ||
            sourceOrder.get(left) - sourceOrder.get(right);
        });
        rows.get(row).forEach((id, index) => position.set(id, index));
      });
    }
    return rows;
  }

  function positionMechanismNodes(graph, rows, rankByNode, options) {
    const nodeSizes = options?.nodeSizes instanceof Map ? options.nodeSizes : new Map();
    const defaultWidth = Math.max(148, Math.min(220,
      finiteNumber(options?.nodeWidth, 184)));
    const gapX = 24;
    const gapY = 82;
    const margin = 24;
    const rowData = [];
    let y = 32;
    [...rows.entries()].sort((left, right) => left[0] - right[0])
      .forEach(([rank, ids]) => {
        const sizes = ids.map(id => ({
          id,
          width: Math.max(120, Math.min(260,
            finiteNumber(nodeSizes.get(id)?.width, defaultWidth))),
          height: Math.max(52, Math.min(180,
            finiteNumber(nodeSizes.get(id)?.height, 68)))
        }));
        const totalWidth = sizes.reduce((sum, item) => sum + item.width, 0) +
          gapX * Math.max(0, sizes.length - 1);
        const rowHeight = Math.max(52, ...sizes.map(item => item.height));
        rowData.push({ rank, sizes, totalWidth, rowHeight, y });
        y += rowHeight + gapY;
      });
    const naturalWidth = Math.max(0, ...rowData.map(row => row.totalWidth)) + margin * 2;
    const baseWidth = Math.max(320, finiteNumber(options?.viewportWidth, 680), naturalWidth);
    const nodes = [];
    rowData.forEach(row => {
      let x = Math.max(margin, (baseWidth - row.totalWidth) / 2);
      row.sizes.forEach(size => {
        const componentIndex = graph.componentByNode.get(size.id);
        nodes.push({
          id: size.id,
          x,
          y: row.y + (row.rowHeight - size.height) / 2,
          width: size.width,
          height: size.height,
          rank: rankByNode.get(size.id),
          componentId: `scc-${componentIndex}`
        });
        x += size.width + gapX;
      });
    });
    return {
      nodes,
      baseWidth,
      baseHeight: Math.max(160, y - gapY + 32)
    };
  }

  function normalEdgePath(from, to, lane, polarity) {
    const startX = from.x + from.width / 2 + lane * 5;
    const startY = from.y + from.height;
    const endX = to.x + to.width / 2 + lane * 5;
    const endY = to.y;
    const middleY = startY + (endY - startY) / 2;
    return {
      path: `M ${startX} ${startY} C ${startX} ${middleY}, ${endX} ${middleY}, ${endX} ${endY}`,
      hitPath: '',
      labelX: (startX + endX) / 2,
      labelY: middleY,
      endX,
      endY,
      feedback: false,
      selfLoop: false,
      polarity
    };
  }

  function feedbackEdgePath(from, to, trackX, polarity) {
    const startX = from.x + from.width;
    const startY = from.y + from.height / 2;
    const endX = to.x + to.width;
    const endY = to.y + to.height / 2;
    return {
      path: `M ${startX} ${startY} C ${trackX} ${startY}, ${trackX} ${endY}, ${endX} ${endY}`,
      hitPath: '',
      labelX: trackX - 6,
      labelY: Math.max(16, (startY + endY) / 2),
      endX,
      endY,
      feedback: true,
      selfLoop: false,
      polarity
    };
  }

  function selfLoopEdgePath(node, trackX, polarity) {
    const startX = node.x + node.width;
    const startY = node.y + node.height * 0.32;
    const endX = node.x + node.width;
    const endY = node.y + node.height * 0.68;
    const bendX = Math.max(trackX, startX + 34);
    return {
      path: `M ${startX} ${startY} C ${bendX} ${startY - 24}, ${bendX} ${endY + 24}, ${endX} ${endY}`,
      hitPath: '',
      labelX: bendX - 4,
      labelY: node.y + node.height / 2,
      endX,
      endY,
      feedback: true,
      selfLoop: true,
      polarity
    };
  }

  function routeMechanismEdges(graph, positioned, backboneEdgeIds) {
    const nodeById = new Map(positioned.nodes.map(node => [node.id, node]));
    const right = Math.max(positioned.baseWidth,
      ...positioned.nodes.map(node => node.x + node.width));
    let feedbackLane = 0;
    const parallelCount = new Map();
    const edges = graph.edges.map(edge => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      const key = `${edge.from}\u0000${edge.to}`;
      const lane = parallelCount.get(key) || 0;
      parallelCount.set(key, lane + 1);
      const selfLoop = from.id === to.id;
      const isFeedback = selfLoop || !backboneEdgeIds.has(edge.id) ||
        to.rank <= from.rank;
      let routed;
      if (selfLoop) {
        routed = selfLoopEdgePath(from, right + 42 + feedbackLane * 22, edge.polarity);
        feedbackLane += 1;
      } else if (isFeedback) {
        routed = feedbackEdgePath(from, to, right + 42 + feedbackLane * 22,
          edge.polarity);
        feedbackLane += 1;
      } else {
        routed = normalEdgePath(from, to, lane, edge.polarity);
      }
      routed.hitPath = routed.path;
      return { id: edge.id, from: edge.from, to: edge.to, ...routed };
    });
    const width = Math.max(positioned.baseWidth,
      right + (feedbackLane ? 70 + (feedbackLane - 1) * 22 : 24));
    return { edges, width, height: positioned.baseHeight };
  }

  function createMechanismNetworkLayout(chain, options = {}) {
    const graph = componentGraph(chain);
    const preferences = layoutPreferenceMaps(options, new Set(graph.nodeIds));
    const { rankByNode, backboneEdgeIds } = acyclicNodeRanks(
      graph, preferences.pinnedRanks
    );
    const rows = orderedRankRows(graph, rankByNode, preferences.siblingOrder);
    const positioned = positionMechanismNodes(graph, rows, rankByNode, options);
    const routed = routeMechanismEdges(graph, positioned, backboneEdgeIds);
    return {
      width: routed.width,
      height: routed.height,
      nodes: positioned.nodes,
      edges: routed.edges,
      components: graph.components.map((nodeIds, index) => ({
        id: `scc-${index}`,
        nodeIds: nodeIds.slice(),
        rank: Math.min(...nodeIds.map(id => rankByNode.get(id)))
      }))
    };
  }

  function mechanismLayoutFingerprint(input = {}) {
    const chain = ownDataValue(input, 'chain');
    const graph = graphParts(chain);
    const options = ownDataValue(input, 'options');
    const revision = ownDataValue(input, 'revision');
    const viewportWidth = ownDataValue(options, 'viewportWidth') ??
      ownDataValue(input, 'width');
    const nodeSizes = ownDataValue(options, 'nodeSizes');
    const sizeValues = graph.nodeIds.map(id => {
      let value;
      try { value = nodeSizes instanceof Map ? nodeSizes.get(id) : undefined; }
      catch (_) { value = undefined; }
      return [
        id,
        Math.round(finiteNumber(ownDataValue(value, 'width'), 0)),
        Math.round(finiteNumber(ownDataValue(value, 'height'), 0))
      ];
    });
    const preferences = ownDataValue(options, 'layoutPreferences');
    const preferenceValues = ['pinnedRanks', 'siblingOrder'].map(key => {
      const value = ownDataValue(preferences, key);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [key, []];
      let descriptors;
      try { descriptors = Object.getOwnPropertyDescriptors(value); }
      catch (_) { return [key, []]; }
      return [key, Object.keys(descriptors).sort().slice(0, MAX_NODES).map(id => {
        const descriptor = descriptors[id];
        return [id, descriptor && Object.hasOwn(descriptor, 'value') &&
          Number.isSafeInteger(descriptor.value) ? descriptor.value : null];
      })];
    });
    return JSON.stringify({
      revision: Number.isSafeInteger(revision) ? revision : 0,
      viewportWidth: Math.round(finiteNumber(viewportWidth, 680)),
      nodes: graph.nodeIds,
      edges: graph.edges.map(edge => [
        edge.id, edge.from, edge.to, edge.polarity
      ]),
      sizeValues,
      preferenceValues
    });
  }

  function createMechanismLayoutCache(build, maximum = 12) {
    if (typeof build !== 'function') {
      throw new TypeError('MECHANISM_NETWORK_LAYOUT_BUILD_REQUIRED');
    }
    const limit = Number.isSafeInteger(maximum)
      ? Math.max(1, Math.min(32, maximum)) : 12;
    const entries = new Map();
    return Object.freeze({
      get(input) {
        const key = mechanismLayoutFingerprint(input);
        if (entries.has(key)) {
          const cached = entries.get(key);
          entries.delete(key);
          entries.set(key, cached);
          return cached;
        }
        const value = build(input);
        entries.set(key, value);
        while (entries.size > limit) entries.delete(entries.keys().next().value);
        return value;
      },
      clear() { entries.clear(); },
      size() { return entries.size; }
    });
  }

  function mechanismEdgeAccessibleName(value = {}, options = {}) {
    const bounded = input => typeof input === 'string'
      ? Array.from(input.normalize('NFKC').replace(/\s+/gu, ' ').trim())
          .slice(0, 120).join('')
      : '';
    const fromLabel = bounded(ownDataValue(value, 'fromLabel')) || '未命名节点';
    const toLabel = bounded(ownDataValue(value, 'toLabel')) || '未命名节点';
    const polarity = ownDataValue(value, 'polarity');
    const kind = polarity === 'negative' ? '负反馈'
      : polarity === 'positive' ? '正反馈' : '联系';
    const rawCount = ownDataValue(value, 'evidenceCount');
    const evidenceCount = Number.isSafeInteger(rawCount)
      ? Math.max(0, Math.min(32, rawCount)) : 0;
    const english = String(ownDataValue(options, 'language') || '')
      .toLowerCase().startsWith('en');
    if (english) {
      const relation = polarity === 'negative' ? 'negative relation'
        : polarity === 'positive' ? 'positive relation' : 'neutral relation';
      const contested = ownDataValue(value, 'contested') === true ? 'Contested ' : '';
      return `${contested}${relation} from “${fromLabel}” to “${toLabel}”, ` +
        `${evidenceCount} Panel evidence item${evidenceCount === 1 ? '' : 's'}`;
    }
    const contested = ownDataValue(value, 'contested') === true ? '有争议：' : '';
    return `${contested}从“${fromLabel}”到“${toLabel}”的${kind}，${evidenceCount} 项 Panel 证据`;
  }

  function createMechanismFrameScheduler(schedule) {
    if (typeof schedule !== 'function') {
      throw new TypeError('MECHANISM_NETWORK_FRAME_SCHEDULER_REQUIRED');
    }
    let pending = false;
    let latest = null;
    return Object.freeze({
      request(callback) {
        if (typeof callback !== 'function') return false;
        latest = callback;
        if (pending) return false;
        pending = true;
        schedule(() => {
          pending = false;
          const work = latest;
          latest = null;
          if (work) work();
        });
        return true;
      },
      clear() { latest = null; },
      pending() { return pending; }
    });
  }

  function mechanismNetworkError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function invalidImport() {
    throw mechanismNetworkError('MECHANISM_NETWORK_IMPORT_INVALID');
  }

  function descriptorRecord(value, allowedKeys, requiredKeys = []) {
    if (!value || typeof value !== 'object') invalidImport();
    let isArray;
    let prototype;
    let names;
    let symbols;
    try {
      isArray = Array.isArray(value);
      prototype = Object.getPrototypeOf(value);
      names = Object.getOwnPropertyNames(value);
      symbols = Object.getOwnPropertySymbols(value);
    } catch (_) {
      invalidImport();
    }
    if (isArray || (prototype !== Object.prototype && prototype !== null) || symbols.length) {
      invalidImport();
    }
    const allowed = new Set(allowedKeys);
    if (names.some(key => BLOCKED_KEYS.has(key) || !allowed.has(key)) ||
        requiredKeys.some(key => !names.includes(key))) invalidImport();
    const result = {};
    for (const key of names) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
      catch (_) { invalidImport(); }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalidImport();
      result[key] = descriptor.value;
    }
    return result;
  }

  function descriptorArray(value, maximum) {
    let isArray;
    let lengthDescriptor;
    let names;
    let symbols;
    try {
      isArray = Array.isArray(value);
      lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      names = Object.getOwnPropertyNames(value);
      symbols = Object.getOwnPropertySymbols(value);
    } catch (_) {
      invalidImport();
    }
    if (!isArray) invalidImport();
    const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value')
      ? lengthDescriptor.value : -1;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum || symbols.length ||
        names.some(name => name !== 'length' && !/^(?:0|[1-9]\d*)$/u.test(name))) {
      invalidImport();
    }
    const result = [];
    for (let index = 0; index < length; index += 1) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, String(index)); }
      catch (_) { invalidImport(); }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalidImport();
      result.push(descriptor.value);
    }
    return result;
  }

  function safeExportText(value, maximum, strictCanonical = false, researchText = false) {
    if (typeof value !== 'string' || value.length > maximum * 2) invalidImport();
    const normalized = value.normalize(researchText ? 'NFC' : 'NFKC')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
      .replace(/\s+/gu, ' ').trim();
    if ((strictCanonical && normalized !== value) ||
        Array.from(normalized).length > maximum ||
        (!strictCanonical && (
          /(?:https?|file|data|blob|javascript):|(?:^|\s)\/\//iu.test(normalized.normalize('NFKC')) ||
          /(?:authorization|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|password)\b/iu.test(normalized.normalize('NFKC'))
        ))) {
      invalidImport();
    }
    return normalized;
  }

  function figureWorkspaceContractMethod(name) {
    let api;
    try { api = host && host.SciLLM; } catch (_) { api = null; }
    if (typeof api?.[name] === 'function') return api[name];
    if (typeof require === 'function') {
      try { api = require('./figure-workspace.js'); } catch (_) { api = null; }
    }
    if (typeof api?.[name] !== 'function') invalidImport();
    return api[name];
  }

  function safeMechanismText(value, maximum, strictCanonical = false) {
    const text = safeExportText(value, maximum, strictCanonical, true);
    if (strictCanonical) {
      let accepted = false;
      try {
        accepted = figureWorkspaceContractMethod(
          'isCanonicalMechanismWorkspaceText'
        )(text, maximum) === true;
      } catch (_) {}
      if (!accepted) invalidImport();
    }
    return text;
  }

  function safeExportId(value, maximum = 200, strictCanonical = false) {
    const id = safeExportText(value, maximum, strictCanonical);
    if (!id || BLOCKED_KEYS.has(id.toLowerCase()) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id)) invalidImport();
    return id;
  }

  function safeMechanismId(value, maximum, strictCanonical = false) {
    const id = safeExportId(value, maximum, strictCanonical);
    if (strictCanonical) safeMechanismText(id, maximum, true);
    return id;
  }

  function safeMechanismNodeText(value, maximum, strictCanonical) {
    if (typeof value !== 'string' || value.length > maximum * 2) invalidImport();
    if (!value.includes('\n')) return safeMechanismText(value, maximum, strictCanonical);
    // Keep the existing whole-text security checks, then admit only canonical
    // node line breaks. IDs, edge labels and evidence still use single-line text.
    safeMechanismText(value.replace(/\s+/gu, ' ').trim(), maximum, strictCanonical);
    let accepted = false;
    try { accepted = figureWorkspaceContractMethod('isCanonicalMechanismWorkspaceNodeLabel')(value, maximum) === true; } catch (_) {}
    if (accepted) return value;
    if (strictCanonical) invalidImport();
    return safeMechanismText(value, maximum, false);
  }

  function safeEditable(value, maximum, strictCanonical = false, nodeLabel = false) {
    if (strictCanonical && typeof value === 'string') invalidImport();
    const source = typeof value === 'string'
      ? { value } : descriptorRecord(value, ['value', 'humanReviewed', 'editedAt'],
        strictCanonical ? ['value', 'humanReviewed', 'editedAt'] : ['value']);
    const humanReviewed = Object.hasOwn(source, 'humanReviewed')
      ? source.humanReviewed : false;
    const editedAt = Object.hasOwn(source, 'editedAt') ? source.editedAt : 0;
    if (typeof humanReviewed !== 'boolean' || !Number.isSafeInteger(editedAt) || editedAt < 0) {
      invalidImport();
    }
    safeReviewTimestamp(editedAt);
    return {
      value: nodeLabel ? safeMechanismNodeText(source.value, maximum, strictCanonical) : safeMechanismText(source.value, maximum, strictCanonical),
      humanReviewed,
      editedAt
    };
  }

  function safePanelEvidence(value, strictCanonical = false) {
    const source = descriptorRecord(value, [
      'figureId', 'panelId', 'value', 'unresolved', 'evidenceClass',
      'evidenceClassSource', 'humanReviewed', 'editedAt'
    ], strictCanonical
      ? ['figureId', 'panelId', 'value', 'unresolved', 'humanReviewed', 'editedAt']
      : ['figureId', 'panelId', 'value']);
    const unresolved = source.unresolved === true;
    const figureId = unresolved && source.figureId === ''
      ? '' : safeMechanismId(source.figureId, 160, strictCanonical);
    const panelId = unresolved && source.panelId === ''
      ? '' : safeMechanismId(source.panelId, 32, strictCanonical);
    if (unresolved !== (figureId === '' && panelId === '') ||
        (figureId === '') !== (panelId === '') ||
        (panelId && !/^[A-Z][A-Z0-9_-]*$/u.test(panelId))) invalidImport();
    const result = {
      figureId,
      panelId,
      value: safeMechanismText(source.value, 4000, strictCanonical),
      unresolved,
      humanReviewed: source.humanReviewed === true,
      editedAt: Number.isSafeInteger(source.editedAt) && source.editedAt >= 0
        ? source.editedAt : 0
    };
    if (Object.hasOwn(source, 'unresolved') && typeof source.unresolved !== 'boolean') {
      invalidImport();
    }
    if (Object.hasOwn(source, 'humanReviewed') &&
        typeof source.humanReviewed !== 'boolean') invalidImport();
    if (Object.hasOwn(source, 'editedAt') &&
        (!Number.isSafeInteger(source.editedAt) || source.editedAt < 0)) invalidImport();
    safeReviewTimestamp(result.editedAt);
    if (Object.hasOwn(source, 'evidenceClass')) {
      if (!['sufficiency', 'necessity', 'other'].includes(source.evidenceClass)) {
        invalidImport();
      }
      result.evidenceClass = source.evidenceClass;
    }
    if (Object.hasOwn(source, 'evidenceClassSource')) {
      if (!['inferred', 'manual'].includes(source.evidenceClassSource)) invalidImport();
      if (!Object.hasOwn(result, 'evidenceClass')) invalidImport();
      result.evidenceClassSource = source.evidenceClassSource;
    }
    return result;
  }

  function safeLayoutPreferences(value, nodeIds, strictCanonical = false) {
    if (typeof value === 'undefined') return undefined;
    const source = descriptorRecord(value, [
      'pinnedRanks', 'siblingOrder', 'collapsedGroups'
    ], strictCanonical ? ['pinnedRanks', 'siblingOrder', 'collapsedGroups'] : []);
    const result = {};
    for (const key of ['pinnedRanks', 'siblingOrder']) {
      if (!Object.hasOwn(source, key)) continue;
      const values = descriptorRecord(source[key], [...nodeIds]);
      const normalized = {};
      Object.entries(values).forEach(([id, position]) => {
        if (!nodeIds.has(id) || !Number.isSafeInteger(position) ||
            position < 0 || position > 63) invalidImport();
        normalized[id] = position;
      });
      if (Object.keys(normalized).length || strictCanonical) result[key] = normalized;
    }
    if (Object.hasOwn(source, 'collapsedGroups')) {
      const seen = new Set();
      const collapsedGroups = descriptorArray(source.collapsedGroups, 16)
        .map(id => safeMechanismId(id, 80, strictCanonical));
      if (collapsedGroups.some(id => seen.has(id) || !seen.add(id))) invalidImport();
      if (collapsedGroups.length || strictCanonical) result.collapsedGroups = collapsedGroups;
    }
    if (strictCanonical &&
        !Object.keys(result.pinnedRanks || {}).length &&
        !Object.keys(result.siblingOrder || {}).length &&
        !(result.collapsedGroups || []).length) invalidImport();
    return Object.keys(result).length ? result : undefined;
  }

  function safeReviewTimestamp(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 4102444800000) {
      invalidImport();
    }
    return value;
  }

  function safeMechanismReviewTombstones(value, strictCanonical = false) {
    const source = descriptorRecord(value, ['nodes', 'edges', 'evidence'],
      strictCanonical ? ['nodes', 'edges', 'evidence'] : []);
    const unique = (items, keyOf) => {
      const seen = new Set();
      items.forEach(item => {
        const key = keyOf(item);
        if (seen.has(key)) invalidImport();
        seen.add(key);
      });
      return items;
    };
    const nodes = unique(descriptorArray(source.nodes, 64).map(raw => {
      const item = descriptorRecord(raw, ['id', 'editedAt'], ['id', 'editedAt']);
      return {
        id: safeMechanismId(item.id, 80, strictCanonical),
        editedAt: safeReviewTimestamp(item.editedAt)
      };
    }), item => item.id);
    const edges = unique(descriptorArray(source.edges, 64).map(raw => {
      const item = descriptorRecord(raw, ['id', 'from', 'to', 'editedAt'], [
        'id', 'from', 'to', 'editedAt'
      ]);
      return {
        id: safeMechanismId(item.id, 80, strictCanonical),
        from: safeMechanismId(item.from, 80, strictCanonical),
        to: safeMechanismId(item.to, 80, strictCanonical),
        editedAt: safeReviewTimestamp(item.editedAt)
      };
    }), item => `${item.id}\u0000${item.from}\u0000${item.to}`);
    const evidence = unique(descriptorArray(source.evidence, 512).map(raw => {
      const item = descriptorRecord(raw, [
        'edgeId', 'from', 'to', 'figureId', 'panelId', 'editedAt'
      ], ['edgeId', 'from', 'to', 'figureId', 'panelId', 'editedAt']);
      return {
        edgeId: safeMechanismId(item.edgeId, 80, strictCanonical),
        from: safeMechanismId(item.from, 80, strictCanonical),
        to: safeMechanismId(item.to, 80, strictCanonical),
        figureId: safeMechanismId(item.figureId, 160, strictCanonical),
        panelId: safeMechanismId(item.panelId, 32, strictCanonical),
        editedAt: safeReviewTimestamp(item.editedAt)
      };
    }), item => `${item.edgeId}\u0000${item.from}\u0000${item.to}` +
      `\u0000${item.figureId}\u0000${item.panelId}`);
    if (strictCanonical && evidence.some(item =>
      !/^[A-Z][A-Z0-9_-]*$/u.test(item.panelId))) invalidImport();
    return { nodes, edges, evidence };
  }

  function readSafeMechanismChain(value, options = {}) {
    const strictCanonical = options.strictCanonical === true;
    const source = descriptorRecord(value, [
      'initialized', 'nodes', 'edges', 'panelAliases', 'reviewTombstones',
      'layoutPreferences', 'generationIssues', 'drawing'
    ], strictCanonical
      ? ['nodes', 'edges', 'panelAliases', 'reviewTombstones']
      : ['nodes', 'edges']);
    const nodes = descriptorArray(source.nodes, MAX_NODES).map(item => {
      const node = descriptorRecord(item, ['id', 'label'], ['id', 'label']);
      return {
        id: safeMechanismId(node.id, 80, strictCanonical),
        label: safeEditable(node.label, 4000, strictCanonical, true)
      };
    });
    const nodeIds = new Set(nodes.map(node => node.id));
    if (nodeIds.size !== nodes.length) invalidImport();
    const edgeIds = new Set();
    const signatures = new Set();
    let drawing;
    if (Object.hasOwn(source, 'drawing')) {
      try {
        const contracts = typeof host.SciLLM?.readMechanismDrawing === 'function'
          ? host.SciLLM : (typeof require === 'function' ? require('./mechanism-canvas-model.js') : null);
        drawing = contracts.readMechanismDrawing(source.drawing, { chain: source });
      } catch (_) { invalidImport(); }
    }
    const edges = descriptorArray(source.edges, MAX_EDGES).map(item => {
      const edge = descriptorRecord(item, [
        'id', 'from', 'to', 'label', 'polarity', 'panelEvidence',
        'humanReviewed', 'editedAt'
      ], strictCanonical
        ? ['id', 'from', 'to', 'label', 'polarity', 'panelEvidence',
          'humanReviewed', 'editedAt']
        : ['id', 'from', 'to', 'label']);
      const id = safeMechanismId(edge.id, 80, strictCanonical);
      const from = safeMechanismId(edge.from, 80, strictCanonical);
      const to = safeMechanismId(edge.to, 80, strictCanonical);
      const polarity = Object.hasOwn(edge, 'polarity') ? edge.polarity : 'neutral';
      if (!nodeIds.has(from) || !nodeIds.has(to) ||
          !['neutral', 'positive', 'negative'].includes(polarity) ||
          (from === to && polarity === 'neutral') || edgeIds.has(id)) invalidImport();
      edgeIds.add(id);
      const label = safeEditable(edge.label, 4000, strictCanonical);
      const signature = JSON.stringify([from, to, polarity, label.value,
        drawing?.edgeContexts[id] || {}]);
      if (signatures.has(signature) && options.allowParallelEdges !== true) invalidImport();
      signatures.add(signature);
      const result = {
        id, from, to, label, polarity,
        panelEvidence: Object.hasOwn(edge, 'panelEvidence')
          ? descriptorArray(edge.panelEvidence, 32)
            .map(item => safePanelEvidence(item, strictCanonical)) : [],
        humanReviewed: Object.hasOwn(edge, 'humanReviewed')
          ? edge.humanReviewed : false,
        editedAt: Object.hasOwn(edge, 'editedAt') ? edge.editedAt : 0
      };
      if (Object.hasOwn(edge, 'humanReviewed')) {
        if (typeof edge.humanReviewed !== 'boolean') invalidImport();
      }
      if (Object.hasOwn(edge, 'editedAt')) {
        safeReviewTimestamp(edge.editedAt);
      }
      return result;
    });
    const result = { nodes, edges };
    if (Object.hasOwn(source, 'panelAliases')) {
      const aliases = source.panelAliases;
      if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) invalidImport();
      let prototype;
      let names;
      let symbols;
      try {
        prototype = Object.getPrototypeOf(aliases);
        names = Object.getOwnPropertyNames(aliases);
        symbols = Object.getOwnPropertySymbols(aliases);
      } catch (_) {
        invalidImport();
      }
      if ((prototype !== Object.prototype && prototype !== null) ||
          symbols.length || names.length > 512 ||
          names.some(key => BLOCKED_KEYS.has(key))) invalidImport();
      const panelAliases = {};
      names.forEach(key => {
        let descriptor;
        try { descriptor = Object.getOwnPropertyDescriptor(aliases, key); }
        catch (_) { invalidImport(); }
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalidImport();
        const safeKey = safeMechanismText(key, 260, strictCanonical);
        if (!safeKey || safeKey !== key || !safeKey.includes(':')) invalidImport();
        const separator = safeKey.lastIndexOf(':');
        if (strictCanonical && (safeMechanismId(
          safeKey.slice(0, separator), 160, true
        ) !== safeKey.slice(0, separator) ||
          !/^[A-Z][A-Z0-9_-]*$/u.test(safeKey.slice(separator + 1)))) invalidImport();
        panelAliases[safeKey] = safeEditable(
          descriptor.value, 4000, strictCanonical
        );
      });
      result.panelAliases = panelAliases;
    }
    if (Object.hasOwn(source, 'reviewTombstones')) {
      result.reviewTombstones = safeMechanismReviewTombstones(
        source.reviewTombstones, strictCanonical
      );
    }
    if (!Object.hasOwn(source, 'panelAliases')) result.panelAliases = {};
    if (!Object.hasOwn(source, 'reviewTombstones')) {
      result.reviewTombstones = { nodes: [], edges: [], evidence: [] };
    }
    if (Object.hasOwn(source, 'initialized')) {
      if (typeof source.initialized !== 'boolean' ||
          (strictCanonical && source.initialized !== true)) invalidImport();
      result.initialized = source.initialized;
    } else if (strictCanonical && (nodes.length || edges.length)) {
      invalidImport();
    } else if (!strictCanonical && (nodes.length || edges.length)) {
      result.initialized = true;
    }
    const layoutPreferences = safeLayoutPreferences(
      source.layoutPreferences, nodeIds, strictCanonical
    );
    if (layoutPreferences) result.layoutPreferences = layoutPreferences;
    if (Object.hasOwn(source, 'generationIssues')) {
      const generationIssues = descriptorArray(source.generationIssues, 16).map(item => {
        const issue = descriptorRecord(item, [
          'code', 'message', 'edgeIndex', 'edgeId', 'displayId'
        ], ['code', 'message', 'edgeId', 'displayId']);
        if (!Number.isSafeInteger(issue.edgeIndex) || issue.edgeIndex < -1 ||
            issue.edgeIndex >= MAX_EDGES) invalidImport();
        const code = safeMechanismText(issue.code, 80, strictCanonical);
        const message = safeMechanismText(issue.message, 240, strictCanonical);
        const edgeId = safeMechanismId(issue.edgeId, 80, strictCanonical);
        const displayId = safeMechanismText(issue.displayId, 193, strictCanonical);
        if (!code || !message || !edgeId || !displayId) invalidImport();
        if (strictCanonical) {
          let canonicalDisplay = false;
          try {
            canonicalDisplay = figureWorkspaceContractMethod(
              'isCanonicalMechanismWorkspacePanelReference'
            )(displayId) === true;
          } catch (_) {}
          if (!canonicalDisplay) invalidImport();
        }
        return {
          code,
          message,
          edgeIndex: issue.edgeIndex,
          edgeId,
          displayId
        };
      });
      if (strictCanonical && !generationIssues.length) invalidImport();
      if (strictCanonical && result.initialized !== true) invalidImport();
      result.generationIssues = generationIssues;
    }
    if (drawing) result.drawing = drawing;
    return result;
  }

  function safeCanonicalUrl(value) {
    const text = typeof value === 'string' && value.length <= 4096 ? value : '';
    let parsed;
    try { parsed = new URL(text); }
    catch (_) { invalidImport(); }
    if (!['http:', 'https:', 'file:'].includes(parsed.protocol) ||
        parsed.username || parsed.password) invalidImport();
    parsed.hash = '';
    return parsed.toString();
  }

  function readSafePaperIdentityV1(value) {
    const source = descriptorRecord(value, [
      'workspaceId', 'workspaceGeneration', 'canonicalUrl', 'contentHash',
      'documentId', 'title'
    ], ['workspaceId', 'workspaceGeneration', 'canonicalUrl', 'contentHash']);
    const workspaceId = safeExportId(source.workspaceId);
    const contentHash = typeof source.contentHash === 'string'
      ? source.contentHash.toLowerCase() : '';
    if (!/^workspace:[a-f0-9]{64}$/u.test(workspaceId.toLowerCase()) ||
        !Number.isSafeInteger(source.workspaceGeneration) ||
        source.workspaceGeneration < 1 || !/^[a-f0-9]{64}$/u.test(contentHash)) {
      invalidImport();
    }
    const result = {
      workspaceId,
      workspaceGeneration: source.workspaceGeneration,
      canonicalUrl: safeCanonicalUrl(source.canonicalUrl),
      contentHash
    };
    if (Object.hasOwn(source, 'documentId')) {
      result.documentId = safeExportId(source.documentId);
    }
    if (Object.hasOwn(source, 'title')) result.title = safeExportText(source.title, 500);
    return result;
  }

  function readSafePaperIdentityV2(value, options = {}) {
    const strictCanonical = options.strictCanonical !== false;
    const source = descriptorRecord(value, [
      'workspaceId', 'workspaceGeneration', 'contentHash', 'documentId', 'title',
      ...(options.allowCanonicalUrl === true ? ['canonicalUrl'] : [])
    ], ['workspaceId', 'workspaceGeneration', 'contentHash']);
    const workspaceId = safeExportId(source.workspaceId, 200, strictCanonical);
    const contentHash = typeof source.contentHash === 'string'
      ? source.contentHash : '';
    if (!/^workspace:[a-f0-9]{64}$/u.test(workspaceId.toLowerCase()) ||
        !Number.isSafeInteger(source.workspaceGeneration) ||
        source.workspaceGeneration < 1 || !/^[a-f0-9]{64}$/u.test(contentHash)) {
      invalidImport();
    }
    const result = {
      workspaceId,
      workspaceGeneration: source.workspaceGeneration,
      contentHash
    };
    if (Object.hasOwn(source, 'documentId')) {
      result.documentId = safeExportId(source.documentId, 200, strictCanonical);
    }
    if (Object.hasOwn(source, 'title')) {
      const title = safeExportText(source.title, 500, strictCanonical);
      if (!title) invalidImport();
      result.title = title;
    }
    return result;
  }

  function readExpectedPaperIdentity(value) {
    const property = key => {
      const descriptor = ownDataProperty(value, key);
      if (!descriptor.readable || !descriptor.present) invalidImport();
      return descriptor.value;
    };
    const workspaceId = safeExportId(property('workspaceId'));
    const workspaceGeneration = property('workspaceGeneration');
    const contentHashValue = property('contentHash');
    const contentHash = typeof contentHashValue === 'string'
      ? contentHashValue.toLowerCase() : '';
    if (!/^workspace:[a-f0-9]{64}$/u.test(workspaceId.toLowerCase()) ||
        !Number.isSafeInteger(workspaceGeneration) || workspaceGeneration < 1 ||
        !/^[a-f0-9]{64}$/u.test(contentHash)) invalidImport();
    const document = ownDataProperty(value, 'documentId');
    if (!document.readable) invalidImport();
    const canonical = ownDataProperty(value, 'canonicalUrl');
    if (!canonical.readable) invalidImport();
    return {
      workspaceId, workspaceGeneration, contentHash,
      ...(document.present ? { documentId: safeExportId(document.value) } : {}),
      ...(canonical.present ? { canonicalUrl: safeCanonicalUrl(canonical.value) } : {})
    };
  }

  function isCanonicalGenerationDigest(value) {
    const prefix = 'mechanism-envelope-v1-';
    if (typeof value !== 'string' || !value.startsWith(prefix)) return false;
    const encoded = value.slice(prefix.length);
    if (encoded.length < 64 || encoded.length > 72) return false;
    const lane8 = token => /^[0-7][a-f0-9]{7}$/u.test(token) ||
      /^0{0,6}-[1-9a-f][a-f0-9]{0,6}$/u.test(token);
    const lane9 = token => /^-(?:[1-7][a-f0-9]{7}|80000000)$/u.test(token);
    const visit = (lane, offset) => {
      if (lane === 8) return offset === encoded.length;
      const eight = encoded.slice(offset, offset + 8);
      if (eight.length === 8 && lane8(eight) && visit(lane + 1, offset + 8)) {
        return true;
      }
      const nine = encoded.slice(offset, offset + 9);
      return nine.length === 9 && lane9(nine) && visit(lane + 1, offset + 9);
    };
    return visit(0, 0);
  }

  function safeCanonicalDurableGeneration(value) {
    if (value === null) return null;
    if (typeof value !== 'string' || !value ||
        value.length > MAX_MECHANISM_GENERATION_LENGTH) invalidImport();
    let parsed;
    try { parsed = JSON.parse(value); } catch (_) { invalidImport(); }
    const source = descriptorRecord(parsed, [
      'schemaVersion', 'envelopeKind', 'status', 'evidenceFirstVersions',
      'identity', 'committedWorkspaceRevision', 'preview', 'updatedAt',
      'projectionDigest', 'chainProjectionDigest'
    ], [
      'schemaVersion', 'envelopeKind', 'status', 'evidenceFirstVersions',
      'identity', 'committedWorkspaceRevision', 'preview', 'updatedAt',
      'projectionDigest', 'chainProjectionDigest'
    ]);
    if (source.schemaVersion !== 1 || source.envelopeKind !== 'durable' ||
        source.status !== 'complete' || !source.evidenceFirstVersions ||
        typeof source.evidenceFirstVersions !== 'object' || !source.identity ||
        typeof source.identity !== 'object' || !source.preview ||
        typeof source.preview !== 'object' ||
        !Number.isSafeInteger(source.committedWorkspaceRevision) ||
        source.committedWorkspaceRevision < 1 ||
        !Number.isSafeInteger(source.updatedAt) || source.updatedAt < 0 ||
        !isCanonicalGenerationDigest(source.projectionDigest) ||
        !isCanonicalGenerationDigest(source.chainProjectionDigest) ||
        JSON.stringify(parsed) !== value) invalidImport();
    descriptorRecord(source.identity, [
      'operationId', 'operationEpoch', 'documentId', 'workspaceId',
      'workspaceGeneration', 'workspaceLifecycle', 'baseWorkspaceRevision',
      'mechanismChainFingerprint'
    ], [
      'operationId', 'operationEpoch', 'documentId', 'workspaceId',
      'workspaceGeneration', 'workspaceLifecycle', 'baseWorkspaceRevision',
      'mechanismChainFingerprint'
    ]);
    descriptorRecord(source.preview, [
      'status', 'canonicalDigest', 'nodes', 'relations', 'claims',
      'claimUsages', 'nodeEvidence', 'nonGraphEvidence', 'unresolvedClaims',
      'panelDispositions'
    ], ['status', 'canonicalDigest', 'nodes', 'relations', 'claims']);
    let authoritative;
    try {
      authoritative = figureWorkspaceContractMethod(
        'readMechanismGenerationEnvelope'
      )(value);
    } catch (_) {
      authoritative = null;
    }
    if (!authoritative || authoritative.envelopeKind !== 'durable' ||
        JSON.stringify(authoritative) !== value) invalidImport();
    return value;
  }

  function createMechanismNetworkJson(options) {
    const source = descriptorRecord(options, [
      'chain', 'paper', 'exportedAt', 'mechanismGeneration'
    ], [
      'chain', 'paper'
    ]);
    const rawDate = Object.hasOwn(source, 'exportedAt') ? source.exportedAt : Date.now();
    if (typeof rawDate !== 'string' && typeof rawDate !== 'number') invalidImport();
    const date = new Date(rawDate);
    if (!Number.isFinite(date.getTime())) invalidImport();
    const mechanismGeneration = Object.hasOwn(source, 'mechanismGeneration')
      ? safeCanonicalDurableGeneration(source.mechanismGeneration) : null;
    return {
      schema: MECHANISM_NETWORK_EXPORT_SCHEMA,
      schemaVersion: MECHANISM_NETWORK_EXPORT_VERSION,
      exportedAt: date.toISOString(),
      paper: readSafePaperIdentityV2(source.paper, { allowCanonicalUrl: true }),
      mechanismChain: readSafeMechanismChain(source.chain, {
        allowParallelEdges: mechanismGeneration !== null,
        strictCanonical: true
      }),
      mechanismGeneration
    };
  }

  function parseMechanismNetworkJson(input, expectedPaper) {
    let parsed = input;
    if (typeof input === 'string') {
      if (input.length > 2_000_000) invalidImport();
      try { parsed = JSON.parse(input); }
      catch (_) { invalidImport(); }
    }
    const identity = descriptorRecord(parsed, [
      'schema', 'schemaVersion', 'exportedAt', 'paper', 'mechanismChain',
      'mechanismGeneration'
    ], ['schema', 'schemaVersion']);
    if (identity.schema !== MECHANISM_NETWORK_EXPORT_SCHEMA) invalidImport();
    const expected = readExpectedPaperIdentity(expectedPaper);
    let root;
    let paper;
    let mechanismGeneration = null;
    if (identity.schemaVersion === MECHANISM_NETWORK_EXPORT_VERSION) {
      root = descriptorRecord(parsed, [
        'schema', 'schemaVersion', 'exportedAt', 'paper', 'mechanismChain',
        'mechanismGeneration'
      ], [
        'schema', 'schemaVersion', 'exportedAt', 'paper', 'mechanismChain',
        'mechanismGeneration'
      ]);
      paper = readSafePaperIdentityV2(root.paper);
      mechanismGeneration = safeCanonicalDurableGeneration(root.mechanismGeneration);
    } else if (identity.schemaVersion === MECHANISM_NETWORK_LEGACY_VERSION) {
      root = descriptorRecord(parsed, [
        'schema', 'schemaVersion', 'exportedAt', 'paper', 'mechanismChain'
      ], ['schema', 'schemaVersion', 'exportedAt', 'paper', 'mechanismChain']);
      paper = readSafePaperIdentityV1(root.paper);
    } else {
      invalidImport();
    }
    if (typeof root.exportedAt !== 'string' ||
        !Number.isFinite(new Date(root.exportedAt).getTime())) invalidImport();
    const keys = ['workspaceId', 'workspaceGeneration', 'contentHash'];
    if (keys.some(key => paper[key] !== expected[key]) ||
        (root.schemaVersion === MECHANISM_NETWORK_LEGACY_VERSION &&
          (!expected.canonicalUrl || paper.canonicalUrl !== expected.canonicalUrl)) ||
        (paper.documentId && paper.documentId !== expected.documentId)) {
      throw mechanismNetworkError('MECHANISM_NETWORK_IMPORT_PAPER_MISMATCH');
    }
    return {
      schemaVersion: root.schemaVersion,
      paper,
      mechanismChain: readSafeMechanismChain(root.mechanismChain, {
        allowParallelEdges: mechanismGeneration !== null,
        strictCanonical: root.schemaVersion === MECHANISM_NETWORK_EXPORT_VERSION
      }),
      mechanismGeneration
    };
  }

  function classifyMechanismNetworkJson(input) {
    let parsed = input;
    if (typeof input === 'string') {
      if (input.length > 2_000_000) invalidImport();
      try { parsed = JSON.parse(input); } catch (_) { invalidImport(); }
    }
    const schema = ownDataProperty(parsed, 'schema');
    const version = ownDataProperty(parsed, 'schemaVersion');
    if (!schema.readable || !schema.present || !version.readable || !version.present) {
      invalidImport();
    }
    if (schema.value === MECHANISM_NETWORK_EXPORT_SCHEMA &&
        [MECHANISM_NETWORK_LEGACY_VERSION, MECHANISM_NETWORK_EXPORT_VERSION]
          .includes(version.value)) {
      const paper = ownDataProperty(parsed, 'paper');
      if (!paper.readable || !paper.present) invalidImport();
      parseMechanismNetworkJson(parsed, paper.value);
      return { kind: 'workspace', schemaVersion: version.value };
    }
    if (schema.value === 'brevess.mechanism-graph' && version.value === 1) {
      return { kind: 'legacy_graph', schemaVersion: 1 };
    }
    invalidImport();
  }

  function escapeXml(value) {
    return String(value).replace(/[&<>"']/gu, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    }[character]));
  }

  function safeLayoutNumber(value, maximum = 20000) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
        value > maximum) invalidImport();
    return Math.round(value * 100) / 100;
  }

  function safeSvgPath(value) {
    if (typeof value !== 'string' || value.length > 4000 ||
        !/^[MmLlHhVvCcSsQqTtAaZz0-9.,+\-\s]+$/u.test(value)) invalidImport();
    return value;
  }

  function serializeMechanismNetworkSvg(options) {
    const source = descriptorRecord(options, ['chain', 'layout', 'title'], [
      'chain', 'layout'
    ]);
    const chain = readSafeMechanismChain(source.chain);
    const title = Object.hasOwn(source, 'title') ? safeExportText(source.title, 500) : '';
    const layoutSource = descriptorRecord(source.layout, [
      'width', 'height', 'nodes', 'edges', 'components'
    ], ['width', 'height', 'nodes', 'edges']);
    const width = safeLayoutNumber(layoutSource.width);
    const graphHeight = safeLayoutNumber(layoutSource.height);
    const titleOffset = title ? 48 : 20;
    const height = graphHeight + titleOffset + 24;
    const nodeLayout = new Map(descriptorArray(layoutSource.nodes, MAX_NODES).map(item => {
      const node = descriptorRecord(item, [
        'id', 'x', 'y', 'width', 'height', 'rank', 'componentId'
      ], ['id', 'x', 'y', 'width', 'height']);
      const id = safeExportId(node.id);
      return [id, {
        id,
        x: safeLayoutNumber(node.x), y: safeLayoutNumber(node.y),
        width: safeLayoutNumber(node.width), height: safeLayoutNumber(node.height)
      }];
    }));
    const edgeLayout = new Map(descriptorArray(layoutSource.edges, MAX_EDGES).map(item => {
      const edge = descriptorRecord(item, [
        'id', 'from', 'to', 'path', 'hitPath', 'labelX', 'labelY', 'endX',
        'endY', 'feedback', 'selfLoop', 'polarity'
      ], ['id', 'from', 'to', 'path', 'labelX', 'labelY']);
      return [safeExportId(edge.id), {
        path: safeSvgPath(edge.path),
        labelX: safeLayoutNumber(edge.labelX),
        labelY: safeLayoutNumber(edge.labelY),
        feedback: edge.feedback === true,
        selfLoop: edge.selfLoop === true
      }];
    }));
    const colors = { neutral: '#52778b', positive: '#b4413d', negative: '#2866a5' };
    const body = [];
    if (title) body.push(`<text x="24" y="28" class="title">${escapeXml(title)}</text>`);
    const offset = titleOffset;
    chain.edges.forEach(edge => {
      const routed = edgeLayout.get(edge.id);
      if (!routed) invalidImport();
      const dash = edge.polarity === 'neutral' ? ' stroke-dasharray="7 5"' : '';
      const marker = edge.polarity === 'neutral' ? '' : ` marker-end="url(#mechanism-arrow-${edge.polarity})"`;
      body.push(`<path d="${escapeXml(routed.path)}" transform="translate(0 ${offset})" ` +
        `stroke="${colors[edge.polarity]}"${dash}${marker} ` +
        `aria-label="${escapeXml(`${edge.polarity} ${edge.from} to ${edge.to}`)}"/>`);
      const label = edge.label.value || (edge.polarity === 'positive' ? '正向' :
        edge.polarity === 'negative' ? '负向' : '联系');
      body.push(`<text x="${routed.labelX}" y="${routed.labelY + offset}" ` +
        `class="edge-label">${escapeXml(label)}</text>`);
      if (routed.feedback && edge.polarity !== 'neutral') {
        body.push(`<text x="${routed.labelX}" y="${routed.labelY + offset + 14}" ` +
          `class="polarity-label">${edge.polarity === 'negative' ? '负反馈' : '正反馈'}</text>`);
      }
    });
    chain.nodes.forEach(node => {
      const placed = nodeLayout.get(node.id);
      if (!placed) invalidImport();
      body.push(`<rect x="${placed.x}" y="${placed.y + offset}" width="${placed.width}" ` +
        `height="${placed.height}" rx="12" class="node"/>`);
      body.push(`<text x="${placed.x + placed.width / 2}" ` +
        `y="${placed.y + offset + placed.height / 2 + 4}" class="node-label">` +
        `${escapeXml(node.label.value || '未填写节点')}</text>`);
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}" role="img">` +
      `<style>text{font-family:Arial,"Noto Sans SC",sans-serif}.title{font-size:18px;font-weight:700;fill:#173c52}.node{fill:#fff;stroke:#c6d9e4;stroke-width:1}.node-label{font-size:12px;font-weight:700;fill:#173c52;text-anchor:middle}.edge-label{font-size:10px;font-weight:700;fill:#365d72;text-anchor:middle}.polarity-label{font-size:9px;fill:#526b79;text-anchor:middle}path{fill:none;stroke-width:1.5;stroke-linecap:round}</style>` +
      `<defs>` + Object.entries(colors).filter(([polarity]) => polarity !== 'neutral').map(([polarity, color]) =>
        `<marker id="mechanism-arrow-${polarity}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="${polarity === 'negative' ? 'M8 0V10' : 'M0 0L9 5L0 10'}" style="fill:none;stroke:${color};stroke-width:1.6"/></marker>`
      ).join('') +
      `</defs>${body.join('')}</svg>`;
  }

  function serializeMechanismAuditSvg(options) {
    const source = descriptorRecord(options, ['graph', 'layout'], ['graph', 'layout']);
    const graph = readGraphExportDto(source.graph);
    if (!graph) invalidImport();
    const layoutSource = descriptorRecord(source.layout, [
      'width', 'height', 'nodes', 'edges', 'components'
    ], ['width', 'height', 'nodes', 'edges']);
    const width = safeLayoutNumber(layoutSource.width);
    const height = safeLayoutNumber(layoutSource.height) + 44;
    const nodeLayout = new Map(descriptorArray(layoutSource.nodes, MAX_NODES).map(raw => {
      const node = descriptorRecord(raw, [
        'id', 'x', 'y', 'width', 'height', 'rank', 'componentId'
      ], ['id', 'x', 'y', 'width', 'height']);
      const id = safeExportId(node.id);
      return [id, {
        x: safeLayoutNumber(node.x), y: safeLayoutNumber(node.y),
        width: safeLayoutNumber(node.width), height: safeLayoutNumber(node.height)
      }];
    }));
    const edgeLayout = new Map(descriptorArray(layoutSource.edges, MAX_EDGES).map(raw => {
      const edge = descriptorRecord(raw, [
        'id', 'from', 'to', 'path', 'hitPath', 'labelX', 'labelY', 'endX',
        'endY', 'feedback', 'selfLoop', 'polarity'
      ], ['id', 'from', 'to', 'path', 'labelX', 'labelY']);
      return [safeExportId(edge.id), {
        path: safeSvgPath(edge.path),
        labelX: safeLayoutNumber(edge.labelX),
        labelY: safeLayoutNumber(edge.labelY)
      }];
    }));
    const body = [];
    for (const edge of graph.edges) {
      const routed = edgeLayout.get(edge.id);
      if (!routed) invalidImport();
      const dash = edge.lineStyle === 'dashed' ? ' stroke-dasharray="7 5"' : '';
      const correlation = edge.lineStyle === 'dashed' ? ' correlation-only' : '';
      const contested = edge.contested ? ' contested' : '';
      const marker = edge.lineStyle === 'dashed'
        ? 'audit-arrow-correlation' : 'audit-arrow';
      body.push(`<path d="${escapeXml(routed.path)}" transform="translate(0 20)" ` +
        `class="mechanism-edge${correlation}${contested}" ` +
        `data-line-style="${edge.lineStyle}" data-contested="${edge.contested}"${dash} ` +
        `marker-end="url(#${marker})"/>`);
      body.push(`<text x="${routed.labelX}" y="${routed.labelY + 16}" ` +
        `class="edge-label${contested}">${escapeXml(
          edge.contested ? `contested: ${edge.label}` : edge.label
        )}</text>`);
    }
    for (const node of graph.nodes) {
      const placed = nodeLayout.get(node.id);
      if (!placed) invalidImport();
      body.push(`<rect x="${placed.x}" y="${placed.y + 20}" width="${placed.width}" ` +
        `height="${placed.height}" rx="12" class="node"/>`);
      body.push(`<text x="${placed.x + placed.width / 2}" ` +
        `y="${placed.y + placed.height / 2 + 24}" class="node-label">` +
        `${escapeXml(node.label)}</text>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}" role="img">` +
      `<style>text{font-family:Arial,"Noto Sans SC",sans-serif}.node{fill:#fff;stroke:#c6d9e4}.node-label{font-size:12px;font-weight:700;fill:#173c52;text-anchor:middle}.edge-label{font-size:10px;font-weight:700;fill:#354f5e;text-anchor:middle}.edge-label.contested{fill:#7a4d00}.mechanism-edge{fill:none;stroke:#354f5e;stroke-width:1.7}.mechanism-edge.correlation-only{stroke:#111}.mechanism-edge.contested{stroke:#8b5c20;stroke-width:3}</style>` +
      `<defs><marker id="audit-arrow" viewBox="0 0 10 10" refX="9" refY="5" ` +
      `markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" ` +
      `fill="#354f5e"/></marker><marker id="audit-arrow-correlation" ` +
      `viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" ` +
      `orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#111"/></marker>` +
      `</defs>${body.join('')}</svg>`;
  }

  function createMechanismNetworkPngPlan(layout, options = {}) {
    const rawScale = ownDataValue(options, 'scale');
    const scale = typeof rawScale === 'number' && Number.isFinite(rawScale)
      ? Math.max(1, Math.min(3, rawScale)) : 2;
    const rawWidth = ownDataValue(layout, 'width');
    const rawHeight = ownDataValue(layout, 'height');
    const width = typeof rawWidth === 'number' ? Math.ceil(rawWidth * scale) : 0;
    const height = typeof rawHeight === 'number' ? Math.ceil(rawHeight * scale) : 0;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width < 1 || height < 1 || width > 16384 || height > 16384 ||
        width * height > 32_000_000) {
      throw mechanismNetworkError('MECHANISM_NETWORK_PNG_TOO_LARGE');
    }
    return { scale, width, height, pixels: width * height };
  }

  return {
    findMechanismStrongComponents,
    mechanismNetworkFocusSet,
    createMechanismNetworkLayout,
    createMechanismLayoutCache,
    mechanismEdgeAccessibleName,
    createMechanismFrameScheduler,
    createMechanismNetworkJson,
    parseMechanismNetworkJson,
    classifyMechanismNetworkJson,
    serializeMechanismNetworkSvg,
    createMechanismNetworkPngPlan,
    createMechanismMermaidDefinition,
    createMechanismEvidenceMatrix,
    normalizeMechanismEvidenceCode,
    createMechanismAuditEvidenceMatrix,
    createMechanismAuditEvidenceView,
    createMechanismGraphExportDto,
    createMechanismAuditMermaidDefinition,
    serializeMechanismAuditSvg,
    MECHANISM_NETWORK_EXPORT_SCHEMA,
    MECHANISM_NETWORK_EXPORT_VERSION
  };
});

