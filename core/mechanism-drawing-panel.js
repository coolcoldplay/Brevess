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
