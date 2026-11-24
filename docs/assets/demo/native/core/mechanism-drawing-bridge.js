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
