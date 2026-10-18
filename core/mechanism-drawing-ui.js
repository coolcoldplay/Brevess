(function attach(root, factory) {
  const interaction = typeof module === 'object' && module.exports ? require('./research-workbench-canvas-interaction.js') : root.SciLLM;
  const api = factory(root, interaction);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(host, interaction) {
  'use strict';

  const EVIDENCE_MIME = 'application/x-brevess-evidence-block';
  const NODE_WIDTH = 168;
  const NODE_HEIGHT = 68;
  const TYPE_NAMES = { sufficient: '充分', necessary: '必要', related: '相关' };
  const list = value => Array.isArray(value) ? value : [];
  const text = value => typeof value === 'string' ? value : String(value == null ? '' : value);
  const esc = value => text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const sourceKey = (figureId, blockId) => `${figureId}::${blockId}`;
  const nodeLabel = node => text(node && (typeof node.label === 'object' ? node.label.value : node.label));
  const uid = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  // Prefer the nearest free space in the visible world rectangle. A full view
  // falls back to the nearest free edge; the caller reveals only the new node.
  function mechanismDrawingFindNodePosition(positions, bounds) {
    const boxes = Object.values(positions || {}).filter(box => box && Number.isFinite(box.x) && Number.isFinite(box.y))
      .map(box => ({ ...box, width: finite(box.width, NODE_WIDTH), height: finite(box.height, NODE_HEIGHT) }));
    const gap = 16, center = { x: bounds.x + (bounds.width - NODE_WIDTH) / 2, y: bounds.y + (bounds.height - NODE_HEIGHT) / 2 };
    const xs = [center.x, bounds.x, bounds.x + bounds.width - NODE_WIDTH];
    const ys = [center.y, bounds.y, bounds.y + bounds.height - NODE_HEIGHT];
    boxes.forEach(box => { xs.push(box.x - NODE_WIDTH - gap, box.x + box.width + gap); ys.push(box.y - NODE_HEIGHT - gap, box.y + box.height + gap); });
    const candidates = Array.from(new Set(xs)).flatMap(x => Array.from(new Set(ys)).map(y => ({ x, y })));
    const visible = point => point.x >= bounds.x && point.y >= bounds.y && point.x + NODE_WIDTH <= bounds.x + bounds.width && point.y + NODE_HEIGHT <= bounds.y + bounds.height;
    const distance = point => Math.abs(point.x - center.x) + Math.abs(point.y - center.y);
    candidates.sort((a, b) => Number(visible(b)) - Number(visible(a)) || distance(a) - distance(b) || a.y - b.y || a.x - b.x);
    return candidates.find(point => !boxes.some(box => point.x < box.x + box.width + gap && point.x + NODE_WIDTH + gap > box.x && point.y < box.y + box.height + gap && point.y + NODE_HEIGHT + gap > box.y)) || center;
  }
  function mechanismDrawingErrorMessage(error) {
    const code = text(error && (error.code || error.message) || error);
    if (/CONTEXT_CHANGED|CONTEXT_STALE|BINDING_MISMATCH/.test(code)) return '文献或解图内容已变化。请关闭绘图面板，再从当前文献重新打开。';
    if (/REVISION_CHANGED|REVISION_CONFLICT/.test(code)) return '图表已有较新的修改。请重新打开面板后再试，原数据已保留。';
    if (/SOURCE_MISSING|TARGET_NOT_FOUND/.test(code)) return '找不到原节点、联系或证据块。请重新选择当前文献中的项目。';
    if (/DUPLICATE_ID|DUPLICATE/.test(code)) return '该项目已存在，请选中已有联系或证据进行编辑。';
    if (/CANVAS_INVALID|COMMAND_INVALID/.test(code)) return '本次修改未保存。请检查节点、联系与证据选择后重试。';
    if (/PANEL_UNAVAILABLE|CLOSED|OPEN_FAILED/.test(code)) return '绘图与解图面板的连接已关闭，请重新打开图表梳理。';
    if (/SAVE_FAILED/.test(code)) return '保存未成功，原数据已保留。请稍后重试。';
    return code || '保存未成功，请重试。';
  }

  function mechanismDrawingEvidenceClass(types) {
    const values = new Set(list(types));
    return [values.has('sufficient') ? 'md-sufficient' : '', values.has('necessary') ? 'md-necessary' : ''].filter(Boolean).join(' ');
  }

  function resolveMechanismDrawingEvidenceSource(snapshot, binding) {
    if (!binding || binding.legacy) return null;
    const panels = Array.from(new Set(list(binding.panelIds))).sort();
    if (!panels.length) return null;
    const matches = source => {
      if (source.figureId !== binding.figureId || source.blockId !== binding.blockId) return false;
      const sourcePanels = Array.from(new Set(list(source.panelIds))).sort();
      return sourcePanels.length === panels.length && sourcePanels.every((id, index) => id === panels[index]) &&
        (!binding.sourceFingerprint || source.sourceFingerprint === binding.sourceFingerprint);
    };
    // A reused block ID must never lend its new Panel descriptions to an old binding.
    if (!binding.unresolved) {
      const active = list(snapshot && snapshot.sources).filter(matches);
      if (active.length === 1) return { source: active[0], kind: 'active', contentMatched: !!binding.contentFingerprint && binding.contentFingerprint === active[0].contentFingerprint };
    }
    const historical = list(snapshot && snapshot.evidenceArchive).filter(matches);
    const exact = binding.contentFingerprint ? historical.filter(source => source.contentFingerprint === binding.contentFingerprint) : [];
    // Ambiguous histories stay undescribed; recency does not prove binding identity.
    const candidates = exact.length ? exact : historical;
    if (candidates.length !== 1) return null;
    return { source: candidates[0], kind: 'archive', contentMatched: exact.length === 1 };
  }

  function parseMechanismEvidenceDrop(raw, snapshot) {
    if (typeof raw !== 'string' || raw.length > 8192) throw new Error('证据块格式无效，请从解图模块重新拖入。');
    let value;
    try { value = JSON.parse(raw); } catch (_) { throw new Error('无法读取证据块，请从解图模块重新拖入。'); }
    if (!value || value.version !== 1 || typeof value.figureId !== 'string' || typeof value.blockId !== 'string' || !value.figureId || !value.blockId || value.figureId.length > 160 || value.blockId.length > 160) {
      throw new Error('证据块格式无效，请从解图模块重新拖入。');
    }
    if (!snapshot || !snapshot.contextKey || value.contextKey !== snapshot.contextKey) throw new Error('这份证据来自另一篇文献，请使用当前文献的解图证据。');
    const source = list(snapshot.sources).find(item => item.figureId === value.figureId && item.blockId === value.blockId);
    if (!source) throw new Error('当前解图中已找不到该证据块，请刷新解图后重试。');
    return { version: 1, contextKey: value.contextKey, figureId: source.figureId, blockId: source.blockId };
  }

  function mechanismDrawingBindingCommand(binding, action, types) {
    if (!binding) throw new TypeError('An evidence binding is required.');
    if (binding.legacy) return { type: action === 'remove' ? 'remove_legacy_evidence' : 'set_legacy_evidence_types', edgeId: binding.edgeId, index: binding.index, figureId: binding.figureId, panelId: list(binding.panelIds)[0], ...(action === 'remove' ? {} : { types }) };
    return { type: action === 'remove' ? 'remove_binding' : 'set_binding_types', bindingId: binding.id, ...(action === 'remove' ? {} : { types }) };
  }

  function selectMechanismDrawingScene(snapshot, view) {
    const nodes = list(snapshot && snapshot.nodes);
    const edges = list(snapshot && snapshot.edges);
    const drawing = snapshot && snapshot.drawing || {};
    const story = snapshot && snapshot.story || drawing.story || {};
    const stages = list(story.stages);
    const mode = view && view.mode || drawing.mode || 'main';
    const stageId = view && view.activeStageId || drawing.activeStageId;
    const stage = stages.find(item => item.id === stageId) || stages[stages.length - 1];
    if (mode === 'all' || !stage) return { nodes, edges, stage, stages };
    // Explicit baseline IDs distinguish never-staged original controls from new manual additions.
    const knownNodes = new Set(list(story.baselineNodeIds).concat(...stages.map(item => list(item.nodeIds))));
    const knownEdges = new Set(list(story.baselineEdgeIds).concat(...stages.map(item => list(item.edgeIds))));
    const knownBindings = new Set(list(story.baselineBindingIds).concat(...stages.map(item => list(item.bindingIds))));
    const allowedNodes = new Set(list(stage.nodeIds));
    const allowedEdges = new Set(list(stage.edgeIds));
    const allowedBindings = new Set(list(stage.bindingIds));
    const visibleEdges = edges.filter(edge => allowedEdges.has(edge.id) || !knownEdges.has(edge.id)).map(edge => {
      allowedNodes.add(edge.from); allowedNodes.add(edge.to);
      return { ...edge, evidence: list(edge.evidence).filter(binding => allowedBindings.has(binding.id) || !knownBindings.has(binding.id)) };
    });
    return { nodes: nodes.filter(node => allowedNodes.has(node.id) || !knownNodes.has(node.id)), edges: visibleEdges, stage, stages };
  }

  function mechanismDrawingWorldPoint(point, bounds, view) {
    return interaction.canvasWorldPoint(point, bounds, view);
  }

  function mechanismDrawingRouteDistance(points, point) {
    return interaction.canvasRouteDistance(list(points), point);
  }

  function mechanismDrawingRouteTarget(routes, edges, point, zoom, explicitId) {
    const visible = new Set(list(edges).map(edge => edge.id));
    const adapted = list(routes).filter(route => visible.has(route.edgeId || route.id)).map(route => ({ id: route.edgeId || route.id, points: route.points, blocked: route.blocked }));
    // An explicit visible label is an existing domain target even if routing is
    // blocked or absent. Geometric targets still exclude every blocked route.
    if (explicitId && visible.has(explicitId)) {
      const route = adapted.find(item => item.id === explicitId);
      if (route) route.blocked = false; else adapted.push({ id: explicitId, points: [], blocked: false });
    }
    return interaction.canvasRouteTarget(adapted, point, zoom, { explicitId });
  }

  function mechanismDrawingGestureMode(options) {
    const mode = interaction.canvasGestureMode(options);
    // Node-click connection mode keeps its domain click handler; it must not
    // start an object drag or default blank pan while choosing endpoints.
    return options.connectMode && (mode === 'move' || mode === 'marquee' || mode === 'pan' && !options.pan && !options.middle && !options.presentation) ? 'connect-click' : mode;
  }

  function mechanismDrawingLabelSize(edge) {
    const width = 194, available = 184;
    const measuredWidth = (value, wide, narrow) => Array.from(text(value)).reduce((sum, character) => sum + (character.charCodeAt(0) > 255 ? wide : narrow), 0);
    const titleHeight = Math.min(2, Math.max(1, Math.ceil(measuredWidth(edge.label, 11, 6) / available))) * 16;
    let occupied = 0, rowHeight = 0, evidenceHeight = 0;
    list(edge.evidence).forEach(binding => {
      const rawWidth = measuredWidth(binding.panelLabel, 13, 7.5) + 18;
      const chipWidth = Math.min(available, Math.max(36, rawWidth));
      const chipHeight = Math.max(1, Math.ceil((rawWidth - 18) / (available - 18))) * 19 + 6;
      if (occupied && occupied + 4 + chipWidth > available) { evidenceHeight += rowHeight + 4; occupied = 0; rowHeight = 0; }
      occupied += (occupied ? 4 : 0) + chipWidth; rowHeight = Math.max(rowHeight, chipHeight);
    });
    return { width, height: 10 + titleHeight + evidenceHeight + rowHeight };
  }

  function mechanismDrawingNodeAtPoint(nodes, positions, point) {
    // Ports extend six world pixels outside the node, including their border.
    // Prefer the closest rectangle when expanded port regions meet.
    const candidates = list(nodes).map(node => {
      const position = positions[node.id]; if (!position) return null;
      const width = finite(position.width, NODE_WIDTH), height = finite(position.height, NODE_HEIGHT);
      const dx = Math.max(position.x - point.x, 0, point.x - position.x - width);
      const dy = Math.max(position.y - point.y, 0, point.y - position.y - height);
      return dx <= 7 && dy <= 7 ? { node, distance: Math.hypot(dx, dy) } : null;
    }).filter(Boolean).sort((a, b) => a.distance - b.distance);
    return candidates.length ? candidates[0].node : undefined;
  }

  function createMechanismDrawingUi(options) {
    const opts = options || {};
    const mount = opts.mount;
    if (!mount || !mount.ownerDocument || typeof mount.appendChild !== 'function') throw new TypeError('A DOM mount is required.');
    const doc = mount.ownerDocument;
    const win = doc.defaultView || host;
    const shell = doc.createElement('section');
    shell.className = 'md-shell';
    shell.hidden = true;
    shell.setAttribute('aria-label', '手动绘制图表梳理');
    shell.innerHTML = `<header class="md-header"><div><strong>图表梳理</strong><span class="md-subtitle">手动绘制</span></div><div class="md-header-actions"><button type="button" data-action="expand" aria-pressed="false">展开</button><button type="button" data-action="close" aria-label="关闭图表梳理">关闭</button></div></header>
      <div class="md-toolbar" role="toolbar" aria-label="绘图工具"><button type="button" data-action="add-node">＋ 节点</button><button type="button" data-action="select" aria-pressed="true">选择</button><button type="button" data-action="connect" aria-pressed="false">连线</button><button type="button" data-action="pan" aria-pressed="false">平移</button><span class="md-divider"></span><button type="button" data-action="undo" title="撤销 Ctrl+Z">撤销</button><button type="button" data-action="redo" title="重做 Ctrl+Shift+Z">重做</button><span class="md-divider"></span><button type="button" data-action="zoom-out" aria-label="缩小">−</button><output class="md-zoom">100%</output><button type="button" data-action="zoom-in" aria-label="放大">＋</button><button type="button" data-action="fit">适应画布</button><span class="md-toolbar-spacer"></span><button type="button" data-action="story">论证步骤</button><button type="button" data-action="main" aria-pressed="true">当前进度</button><button type="button" data-action="all" aria-pressed="false">全部联系</button><button type="button" data-action="matrix" aria-pressed="true">证据矩阵</button></div>
      <div class="md-story" hidden></div><div class="md-workspace"><div class="md-canvas" tabindex="0" role="application" aria-label="机制图画布：拖动节点；从端口拉线；空白拖动平移；Shift 框选；滚轮缩放"><div class="md-world"><svg class="md-svg" aria-hidden="true"><defs><marker id="md-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L8 4.5 L1 8" fill="none" stroke="context-stroke" stroke-width="1.7"/></marker><marker id="md-stop" markerWidth="8" markerHeight="14" refX="3" refY="7" orient="auto" markerUnits="userSpaceOnUse"><path d="M3 1 L3 13" fill="none" stroke="context-stroke" stroke-width="2.5"/></marker></defs><g class="md-routes"></g><path class="md-connection-preview"/></svg><div class="md-node-layer"></div><div class="md-label-layer"></div><div class="md-selection-box" hidden></div></div><div class="md-empty" hidden>添加节点，拉线连接，再从右侧解图拖入证据块。</div><div class="md-canvas-hint">拖动节点 · 从端口拉线 · 空白拖动平移；Shift 框选</div><div class="md-drop-hint" hidden></div></div><aside class="md-inspector" aria-label="选择项编辑" hidden></aside></div>
      <div class="md-matrix-resizer" role="separator" tabindex="0" aria-label="调整证据矩阵高度" aria-orientation="horizontal" aria-valuemin="96" aria-valuemax="500" aria-valuenow="210"></div><section class="md-matrix"><div class="md-matrix-heading"><strong>证据矩阵</strong><span>列为起点 · 行为终点</span><span class="md-legend" title="可多选；红蓝双色表示同时为充分与必要。相关或未分类为中性颜色。"><i class="md-key-sufficient"></i>充分 <i class="md-key-necessary"></i>必要 <i class="md-key-related"></i>相关</span></div><div class="md-matrix-scroll" tabindex="0" aria-label="节点乘节点证据矩阵"></div></section>
      <footer class="md-footer"><span class="md-status" role="status" aria-live="polite">图表中的证据名称可点击定位，右键可更改。</span><span class="md-count"></span></footer><div class="md-tooltip" role="tooltip" hidden></div><div class="md-menu" role="menu" aria-label="证据块操作" hidden></div>`;
    mount.appendChild(shell);
    const $ = selector => shell.querySelector(selector);
    const canvas = $('.md-canvas'), world = $('.md-world'), inspector = $('.md-inspector');
    const matrixScroll = $('.md-matrix-scroll'), tooltip = $('.md-tooltip'), menu = $('.md-menu');
    const listeners = [];
    function listen(target, type, fn, config) { target.addEventListener(type, fn, config); listeners.push(() => target.removeEventListener(type, fn, config)); }
    let snapshot = { nodes: [], edges: [], sources: [], drawing: {} };
    let viewport = { x: 36, y: 30, zoom: 1 };
    let view = { mode: 'main', activeStageId: '' };
    let scene = { nodes: [], edges: [], stages: [] };
    let selectedNodes = new Set(), selectedEdgeId = '', selectedBindingId = '';
    let routes = [], positions = {}, activePointer = null, connectingFrom = '', connectMode = false, panMode = false, spaceDown = false;
    let destroyed = false, shown = false, pending = 0, queue = Promise.resolve(), status = '', errorStatus = false;
    let matrixVisible = true, matrixHeight = 210, expanded = false, dropEdgeId = '', pendingViewTimer = null, menuBindingId = '';
    let editorNodeId = '', editorValue = '', sceneSignature = '', previousContext = '', previousSession = '', storyMarkupKey = '', viewVersion = 0, pendingViewVersion = 0;
    let editorVersion = 0, editorPending = null;
    let storyDraft = null, storyEditorIndex = 0;
    let initialFitDone = false, initialFitScheduled = false, fitObserver = null;
    let layoutCacheKey = '', layoutCache = {};
    const apiHost = () => host.SciLLM || {};
    const edgeById = id => list(snapshot.edges).find(edge => edge.id === id);
    const nodeById = id => list(snapshot.nodes).find(node => node.id === id);
    const bindingById = id => list(snapshot.edges).flatMap(edge => list(edge.evidence)).find(binding => binding.id === id);
    const sourceFor = binding => { const match = resolveMechanismDrawingEvidenceSource(snapshot, binding); return match && match.kind === 'active' ? match.source : undefined; };
    const edgeName = edge => `${nodeLabel(nodeById(edge.from))} → ${nodeLabel(nodeById(edge.to))}`;
    const contextOf = value => text(value && value.contextKey);
    function notify(message, failed) { status = message; errorStatus = !!failed; $('.md-status').textContent = message; $('.md-status').classList.toggle('md-error', errorStatus); }

    function dispatch(command, after) {
      if (destroyed) return Promise.resolve(null);
      const context = previousContext, session = previousSession;
      pending += 1; shell.setAttribute('aria-busy', 'true');
      const task = queue.then(async () => {
        if (destroyed || context !== previousContext || session !== previousSession) return null;
        if (typeof opts.onCommand !== 'function') throw new Error('编辑通道尚未就绪。');
        const submitted = typeof command === 'function' ? command() : command;
        const acknowledged = await opts.onCommand({ ...submitted, contextKey: context });
        if (destroyed || context !== previousContext || session !== previousSession) return null;
        if (!acknowledged || !Array.isArray(acknowledged.nodes) || !Array.isArray(acknowledged.edges)) throw new Error('尚未收到保存确认；图表保留原状态，请重试。');
        update(acknowledged);
        if (typeof after === 'function') after(acknowledged);
        return acknowledged;
      }).catch(error => { if (!destroyed && context === previousContext && session === previousSession) notify(mechanismDrawingErrorMessage(error), true); return null; }).finally(() => {
        pending -= 1; if (!destroyed) { shell.setAttribute('aria-busy', pending ? 'true' : 'false'); updateToolbar(); }
      });
      queue = task;
      return task;
    }

    function saveView(extra) {
      if (pendingViewTimer) win.clearTimeout(pendingViewTimer);
      pendingViewTimer = null;
      const version = ++viewVersion; pendingViewVersion = version;
      return dispatch({ type: 'set_view', viewport: { ...viewport }, matrixHeight, mode: view.mode, activeStageId: view.activeStageId, ...extra }).then(result => { if (pendingViewVersion === version) pendingViewVersion = 0; return result; });
    }
    function deferView() { if (pendingViewTimer) win.clearTimeout(pendingViewTimer); pendingViewTimer = win.setTimeout(() => { pendingViewTimer = null; saveView(); }, 300); }
    function transform() { world.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`; $('.md-zoom').textContent = `${Math.round(viewport.zoom * 100)}%`; }
    function worldPoint(clientX, clientY) { return mechanismDrawingWorldPoint({ x: clientX, y: clientY }, canvas.getBoundingClientRect(), viewport); }
    function zoomAt(next, clientX, clientY) {
      const rect = canvas.getBoundingClientRect(), point = worldPoint(clientX == null ? rect.left + rect.width / 2 : clientX, clientY == null ? rect.top + rect.height / 2 : clientY);
      const screen = { x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y };
      viewport.zoom = clamp(next, .3, 2.5); viewport.x = screen.x - point.x * viewport.zoom; viewport.y = screen.y - point.y * viewport.zoom;
      transform(); deferView();
    }
    function fit() {
      const boxes = scene.nodes.map(node => ({ x: positions[node.id].x, y: positions[node.id].y, width: NODE_WIDTH, height: NODE_HEIGHT }));
      routes.forEach(route => { if (route.labelBox) boxes.push(route.labelBox); list(route.points).forEach(point => boxes.push({ ...point, width: 1, height: 1 })); });
      if (!boxes.length) { viewport = { x: 36, y: 30, zoom: 1 }; transform(); deferView(); return; }
      const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y));
      const right = Math.max(...boxes.map(box => box.x + box.width)), bottom = Math.max(...boxes.map(box => box.y + box.height));
      const rect = canvas.getBoundingClientRect();
      viewport.zoom = clamp(Math.min((rect.width - 64) / Math.max(1, right - left), (rect.height - 48) / Math.max(1, bottom - top), 1.25), .3, 2.5);
      viewport.x = (rect.width - (right - left) * viewport.zoom) / 2 - left * viewport.zoom;
      viewport.y = (rect.height - (bottom - top) * viewport.zoom) / 2 - top * viewport.zoom;
      transform(); deferView();
    }

    function chip(binding) {
      const types = list(binding.types).map(type => TYPE_NAMES[type]).filter(Boolean).join('、') || '未分类';
      const review = binding.unresolved ? '，原证据暂不可用' : binding.needsReview ? '，待复核' : '';
      return `<button type="button" class="md-evidence ${mechanismDrawingEvidenceClass(binding.types)}${binding.unresolved ? ' md-unresolved' : ''}" data-binding="${esc(binding.id)}" data-focus-key="binding:${esc(binding.id)}" aria-label="${esc(binding.panelLabel || '未命名证据')}，${esc(types + review)}。点击定位；右键或 Shift+F10 更改">${esc(binding.panelLabel || '未命名证据')}</button>`;
    }
    function focusedState() {
      const active = shell.getRootNode().activeElement || doc.activeElement;
      if (!active || !shell.contains(active)) return null;
      const key = active.getAttribute('data-focus-key');
      const scope = active.closest('.md-matrix-scroll') ? 'matrix' : active.closest('.md-inspector') ? 'inspector' : 'graph';
      return key ? { key, scope, value: 'value' in active ? active.value : null, start: active.selectionStart, end: active.selectionEnd } : null;
    }
    function restoreFocus(saved) {
      if (!saved) return;
      const target = Array.from((saved.scope === 'matrix' ? matrixScroll : saved.scope === 'inspector' ? inspector : shell).querySelectorAll('[data-focus-key]')).find(element => element.getAttribute('data-focus-key') === saved.key);
      if (!target) return;
      if (saved.value != null && /^(INPUT|TEXTAREA)$/.test(target.tagName) && !['checkbox', 'range'].includes(target.type)) target.value = saved.value;
      target.focus({ preventScroll: true });
      if (saved.start != null && typeof target.setSelectionRange === 'function' && target.type !== 'range') { try { target.setSelectionRange(saved.start, saved.end); } catch (_) {} }
    }
    function updateToolbar() {
      $('[data-action="undo"]').disabled = !snapshot.canUndo || pending > 0;
      $('[data-action="redo"]').disabled = !snapshot.canRedo || pending > 0;
      ['select', 'connect', 'pan', 'main', 'all', 'matrix', 'expand'].forEach(action => {
        const value = action === 'select' ? !connectMode && !panMode : action === 'connect' ? connectMode : action === 'pan' ? panMode : action === 'main' ? view.mode === 'main' : action === 'all' ? view.mode === 'all' : action === 'matrix' ? matrixVisible : expanded;
        $(`[data-action="${action}"]`).setAttribute('aria-pressed', String(value));
      });
      shell.classList.toggle('md-expanded', expanded);
      shell.classList.toggle('md-pan-mode', panMode || spaceDown);
      shell.classList.toggle('md-connect-mode', connectMode || !!connectingFrom);
      $('.md-canvas-hint').textContent = panMode || spaceDown ? '平移画布 · 点击“选择”可拖动节点' : connectMode ? '依次点击两个节点连线 · 点击“选择”可拖动节点' : '拖动节点 · 双击编辑 · 从端口拉线 · 空白拖动平移；Shift 框选';
      $('.md-matrix').hidden = !matrixVisible; $('.md-matrix-resizer').hidden = !matrixVisible;
      $('.md-matrix-resizer').setAttribute('aria-valuenow', String(Math.round(matrixHeight)));
      shell.style.setProperty('--md-matrix-height', `${matrixHeight}px`);
      $('.md-count').textContent = `${list(snapshot.nodes).length} 节点 · ${list(snapshot.edges).length} 联系 · ${list(snapshot.edges).reduce((sum, edge) => sum + list(edge.evidence).length, 0)} 证据`;
    }
    function renderStory() {
      const panel = $('.md-story'), stages = scene.stages;
      panel.hidden = !stages.length;
      if (!stages.length) return;
      const index = Math.max(0, stages.findIndex(stage => stage.id === scene.stage.id));
      const markupKey = JSON.stringify(stages.map(stage => [stage.id, stage.figureLabel, stage.title]));
      if (storyMarkupKey === markupKey && panel.querySelector('.md-story-range')) {
        panel.querySelector('.md-story-heading strong').textContent = `${scene.stage.figureLabel || `${index + 1}/${stages.length}`} · ${scene.stage.title || ''}`;
        panel.querySelector('.md-story-heading > span').textContent = view.mode === 'all' ? '全部联系' : `${index + 1} / ${stages.length}`;
        const slider = panel.querySelector('.md-story-range'); slider.value = String(index); slider.setAttribute('aria-valuetext', `${scene.stage.figureLabel || ''} ${scene.stage.title || ''}`);
        panel.querySelectorAll('[data-stage-index]').forEach(button => { const current = Number(button.dataset.stageIndex) === index; button.classList.toggle('md-current', current); if (current) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current'); });
        panel.querySelector('p').textContent = scene.stage.summary || '';
        return;
      }
      storyMarkupKey = markupKey;
      panel.innerHTML = `<div class="md-story-heading"><strong>${esc(scene.stage.figureLabel || `${index + 1}/${stages.length}`)} · ${esc(scene.stage.title)}</strong><span>${view.mode === 'all' ? '全部联系' : `${index + 1} / ${stages.length}`}</span></div><input type="range" class="md-story-range" data-focus-key="story-range" min="0" max="${stages.length - 1}" value="${index}" step="1" aria-label="阅读进度" aria-valuetext="${esc((scene.stage.figureLabel || '') + ' ' + scene.stage.title)}"><div class="md-story-ticks" style="--md-stage-count:${stages.length}">${stages.map((stage, i) => `<button type="button" data-stage-index="${i}" class="${i === index ? 'md-current' : ''}" aria-label="跳转到 ${esc(stage.figureLabel || i + 1)}：${esc(stage.title)}"${i === index ? ' aria-current="step"' : ''}>${esc(stage.figureLabel || `${i + 1}`)}</button>`).join('')}</div><p>${esc(scene.stage.summary || '')}</p>`;
    }
    function setStage(index, locate, persist) {
      const stage = scene.stages[clamp(index, 0, Math.max(0, scene.stages.length - 1))];
      if (!stage) return;
      view = { mode: 'main', activeStageId: stage.id }; render();
      if (persist) saveView();
      if (locate && typeof opts.onLocateFigure === 'function') list(stage.figureIds).forEach(figureId => safeCallback(opts.onLocateFigure, { figureId, contextKey: snapshot.contextKey }));
    }
    function layoutGraph() {
      const persisted = snapshot.drawing && snapshot.drawing.positions || {};
      const layoutKey = JSON.stringify([previousContext, list(snapshot.nodes).map(node => node.id), list(snapshot.edges).map(edge => [edge.from, edge.to]), persisted]);
      if (layoutCacheKey !== layoutKey) {
        const compute = apiHost().computeMechanismDrawingLayout;
        layoutCache = typeof compute === 'function' ? compute({ nodes: list(snapshot.nodes), edges: list(snapshot.edges), positions: persisted }) : {};
        layoutCacheKey = layoutKey;
      }
      const incoming = Object.assign({}, layoutCache);
      list(snapshot.nodes).forEach((node, index) => { const saved = persisted[node.id] || incoming[node.id] || {}; incoming[node.id] = { ...saved, x: finite(saved.x, finite(node.x, (index % 4) * 230)), y: finite(saved.y, finite(node.y, Math.floor(index / 4) * 170)), width: NODE_WIDTH, height: NODE_HEIGHT }; });
      positions = incoming;
      if (activePointer && activePointer.kind === 'nodes') Object.assign(positions, activePointer.preview);
      const router = apiHost().routeMechanismDrawingEdges;
      const edges = scene.edges.map(edge => { const size = mechanismDrawingLabelSize(edge); return { ...edge, labelWidth: size.width, labelHeight: size.height }; });
      routes = typeof router === 'function' ? router({ nodes: scene.nodes, edges, positions }) : [];
      if (!Array.isArray(routes)) routes = [];
    }
    function renderGraph() {
      layoutGraph();
      const routeMap = new Map(routes.map(route => [route.edgeId, route]));
      $('.md-routes').innerHTML = scene.edges.map(edge => {
        const route = routeMap.get(edge.id);
        if (!route || route.blocked || !route.path) return '';
        const active = edge.id === selectedEdgeId || edge.id === dropEdgeId;
        const terminal = edge.polarity === 'negative' ? 'md-stop' : edge.polarity === 'positive' ? 'md-arrow' : '';
        const leader = route.labelAnchor && route.label ? `<path class="md-label-leader" d="M${route.labelAnchor.x} ${route.labelAnchor.y} L${route.label.x} ${route.label.y}"/>` : '';
        return `${leader}<path class="md-edge-hit" data-edge="${esc(edge.id)}" d="${esc(route.path)}"/><path class="md-edge${active ? ' md-active' : ''}${edge.polarity === 'neutral' ? ' md-neutral' : ''}${edge.id === dropEdgeId ? ' md-drop-target' : ''}" data-edge="${esc(edge.id)}" d="${esc(route.path)}"${terminal ? ` marker-end="url(#${terminal})"` : ''}/>`;
      }).join('');
      // Keep each node's DOM identity through pointerdown/up so the browser can
      // finish clicks and native double clicks even when selection is redrawn.
      const nodeLayer = $('.md-node-layer');
      const existingNodes = new Map(Array.from(nodeLayer.querySelectorAll('[data-node]')).map(element => [element.dataset.node, element]));
      const visibleNodes = new Set(scene.nodes.map(node => node.id));
      existingNodes.forEach((element, id) => { if (!visibleNodes.has(id)) element.remove(); });
      scene.nodes.forEach(node => {
        const point = positions[node.id], targetEdge = edgeById(dropEdgeId);
        const target = targetEdge && (targetEdge.from === node.id || targetEdge.to === node.id);
        let element = existingNodes.get(node.id);
        if (!element) {
          element = doc.createElement('div');
          element.setAttribute('data-node', node.id); element.setAttribute('data-focus-key', `node:${node.id}`);
          element.setAttribute('role', 'button'); element.setAttribute('tabindex', '0');
          element.innerHTML = `<span class="md-node-label"></span>${['top', 'right', 'bottom', 'left'].map(side => `<button type="button" class="md-port md-port-${side}" data-port="${esc(node.id)}" tabindex="-1"></button>`).join('')}`;
          nodeLayer.appendChild(element);
        }
        element.className = `md-node${selectedNodes.has(node.id) ? ' md-selected' : ''}${target ? ' md-drop-target' : ''}${connectingFrom === node.id ? ' md-connecting' : ''}`;
        element.setAttribute('style', `left:${point.x}px;top:${point.y}px`);
        element.setAttribute('aria-label', `节点 ${nodeLabel(node)}，双击编辑文字`);
        element.querySelector('.md-node-label').textContent = nodeLabel(node);
        element.querySelectorAll('[data-port]').forEach(port => port.setAttribute('aria-label', `从 ${nodeLabel(node)} 拉线`));
      });
      $('.md-label-layer').innerHTML = scene.edges.map(edge => {
        const route = routeMap.get(edge.id);
        const from = positions[edge.from], to = positions[edge.to];
        if (!from || !to) return '';
        const label = route && route.label || { x: (from.x + to.x + NODE_WIDTH) / 2, y: (from.y + to.y + NODE_HEIGHT) / 2, width: 194 };
        return `<div class="md-edge-label${edge.id === selectedEdgeId ? ' md-selected' : ''}${edge.id === dropEdgeId ? ' md-drop-target' : ''}${route && route.blocked ? ' md-route-blocked' : ''}" data-edge="${esc(edge.id)}" style="left:${label.x}px;top:${label.y}px;width:${finite(label.width, 194)}px"><button type="button" class="md-edge-title" title="${esc(edge.label || '联系')}" data-edge-select="${esc(edge.id)}" data-focus-key="edge:${esc(edge.id)}" aria-label="编辑联系 ${esc(edgeName(edge))}">${esc(edge.label || '联系')}</button><div class="md-edge-evidence">${list(edge.evidence).map(chip).join('')}</div>${route && route.blocked ? '<span class="md-route-note">移动重叠节点以显示连线</span>' : ''}</div>`;
      }).join('');
      $('.md-empty').hidden = !!scene.nodes.length;
      renderNodeEditor();
      transform();
    }
    function renderMatrix() {
      const nodes = list(snapshot.nodes), selected = edgeById(selectedEdgeId);
      const pairs = new Map();
      list(snapshot.edges).forEach(edge => { const key = `${edge.from}\u0000${edge.to}`; if (!pairs.has(key)) pairs.set(key, []); pairs.get(key).push(edge); });
      if (!nodes.length) { matrixScroll.innerHTML = '<p class="md-matrix-empty">添加节点后，此处自动显示节点 × 节点矩阵。</p>'; return; }
      matrixScroll.innerHTML = `<table><thead><tr><th class="md-corner">终点 ↓ / 起点 →</th>${nodes.map(node => `<th scope="col" class="${selected && selected.from === node.id ? 'md-matrix-axis' : ''}">${esc(nodeLabel(node))}</th>`).join('')}</tr></thead><tbody>${nodes.map(to => `<tr><th scope="row" class="${selected && selected.to === to.id ? 'md-matrix-axis' : ''}">${esc(nodeLabel(to))}</th>${nodes.map(from => {
        const edges = pairs.get(`${from.id}\u0000${to.id}`) || [];
        const active = selected && selected.from === from.id && selected.to === to.id;
        return `<td class="${active ? 'md-matrix-selected' : ''}${from.id === to.id ? ' md-matrix-diagonal' : ''}" data-matrix-from="${esc(from.id)}" data-matrix-to="${esc(to.id)}" tabindex="${from.id === to.id ? -1 : 0}" aria-label="${esc(nodeLabel(from))} 到 ${esc(nodeLabel(to))}，${edges.length ? `${edges.length} 条联系` : '暂无联系'}">${edges.flatMap(edge => list(edge.evidence)).map(chip).join('')}${edges.length && !edges.some(edge => list(edge.evidence).length) ? '<span class="md-cell-empty">待添加证据</span>' : ''}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
    }
    function renderInspector() {
      if (storyDraft) { renderStoryEditor(); return; }
      const edge = edgeById(selectedEdgeId), node = selectedNodes.size === 1 ? nodeById(Array.from(selectedNodes)[0]) : null;
      inspector.hidden = !edge && !selectedNodes.size;
      if (inspector.hidden) { inspector.innerHTML = ''; return; }
      if (!edge) {
        inspector.innerHTML = `<div class="md-inspector-heading"><strong>${node ? '节点' : `已选 ${selectedNodes.size} 个节点`}</strong><button type="button" data-action="deselect" aria-label="关闭编辑面板">×</button></div>${node ? `<label>节点文字<textarea data-field="node-label" data-node-id="${esc(node.id)}" data-focus-key="node-label:${esc(node.id)}" rows="3">${esc(nodeLabel(node))}</textarea></label><p class="md-help">拖动节点调整位置。按住 Shift 点击可多选。</p>` : '<p class="md-help">拖动其中一个节点可移动整组选区。</p>'}<button type="button" class="md-danger" data-action="delete-nodes">删除${selectedNodes.size > 1 ? '所选节点' : '节点'}</button>`;
        return;
      }
      const binding = list(edge.evidence).find(item => item.id === selectedBindingId);
      const selectOptions = current => list(snapshot.nodes).map(item => `<option value="${esc(item.id)}"${item.id === current ? ' selected' : ''}>${esc(nodeLabel(item))}</option>`).join('');
      inspector.innerHTML = `<div class="md-inspector-heading"><strong>联系</strong><button type="button" data-action="deselect" aria-label="关闭编辑面板">×</button></div><label>联系文字<textarea data-field="edge-label" data-focus-key="edge-label:${esc(edge.id)}" rows="2">${esc(edge.label || '')}</textarea></label><div class="md-endpoints"><label>起点<select data-field="edge-from" data-focus-key="edge-from">${selectOptions(edge.from)}</select></label><label>终点<select data-field="edge-to" data-focus-key="edge-to">${selectOptions(edge.to)}</select></label></div><div class="md-inspector-row"><select data-field="edge-polarity" data-focus-key="edge-polarity" aria-label="联系方向含义"><option value="positive"${edge.polarity === 'positive' ? ' selected' : ''}>促进 →</option><option value="negative"${edge.polarity === 'negative' ? ' selected' : ''}>抑制 ⊣</option><option value="neutral"${edge.polarity === 'neutral' ? ' selected' : ''}>关联 ···</option></select><button type="button" data-action="reverse">反向</button></div><div class="md-section-label">已绑定证据</div><div class="md-inspector-chips">${list(edge.evidence).map(chip).join('') || '<span class="md-help">拖入证据块，或从下方选择。</span>'}</div><p class="md-help">证据名称：点击定位；右键更改类型、替换或移除。</p>${binding ? `<section class="md-binding-editor"><strong>${esc(binding.panelLabel || '证据')}</strong><fieldset><legend>证据类型（可多选）</legend>${Object.entries(TYPE_NAMES).map(([value, label]) => `<label class="md-type-option"><input type="checkbox" data-binding-type="${value}" data-binding-id="${esc(binding.id)}" data-focus-key="type:${esc(binding.id)}:${value}"${list(binding.types).includes(value) ? ' checked' : ''}><span class="${mechanismDrawingEvidenceClass([value])}">${label}</span></label>`).join('')}</fieldset><div class="md-inspector-row"><button type="button" data-action="replace-binding">替换证据</button><button type="button" class="md-danger" data-action="remove-binding">移除</button></div></section>` : ''}<label class="md-source-picker-label">从解图添加证据<select class="md-source-picker" data-focus-key="source-picker"><option value="">选择 Figure 证据块</option>${list(snapshot.sources).map(source => `<option value="${esc(sourceKey(source.figureId, source.blockId))}">${esc(source.panelLabel || source.title || source.blockId)}${source.title ? ` · ${esc(source.title).slice(0, 160)}` : ''}</option>`).join('')}</select></label><button type="button" data-action="bind-source"${list(snapshot.sources).length ? '' : ' disabled'}>添加到此联系</button><div class="md-inspector-bottom"><button type="button" class="md-danger" data-action="delete-edge">删除联系</button></div>`;
    }
    function addRelationContextFields() {
      const edge = edgeById(selectedEdgeId); if (!edge || storyDraft || inspector.hidden) return;
      const section = doc.createElement('div'); section.className = 'md-relation-context';
      const peers = list(snapshot.edges).filter(item => item.from === edge.from && item.to === edge.to);
      section.innerHTML = `${peers.length > 1 ? `<label>同节点间的联系<select data-field="edge-choice" data-focus-key="edge-choice">${peers.map(item => `<option value="${esc(item.id)}"${item.id === edge.id ? ' selected' : ''}>${esc(item.label || '联系')}${item.context && item.context.summary ? ` · ${esc(item.context.summary)}` : ''}</option>`).join('')}</select></label>` : ''}<label>条件或阶段<textarea data-field="edge-context" data-focus-key="edge-context:${esc(edge.id)}" rows="2" placeholder="例如：小鼠毛囊，处理后 24 小时">${esc(edge.context && edge.context.summary || '')}</textarea></label><button type="button" data-action="parallel-edge">同节点间另建联系</button>`;
      const reference = inspector.querySelector('.md-section-label'); if (reference) inspector.insertBefore(section, reference); else inspector.appendChild(section);
    }
    function render() {
      if (destroyed || !shown) return;
      const focus = focusedState(), matrixOffset = { x: matrixScroll.scrollLeft, y: matrixScroll.scrollTop }, inspectorOffset = inspector.scrollTop;
      scene = selectMechanismDrawingScene(snapshot, view);
      renderStory(); renderGraph(); renderMatrix(); renderInspector(); addRelationContextFields(); updateToolbar();
      matrixScroll.scrollLeft = matrixOffset.x; matrixScroll.scrollTop = matrixOffset.y; inspector.scrollTop = inspectorOffset;
      restoreFocus(focus);
    }
    function update(next) {
      if (destroyed || !next || !Array.isArray(next.nodes) || !Array.isArray(next.edges)) return;
      const newContext = contextOf(next), newSession = text(next.sessionId);
      const changedDocument = (previousContext && newContext !== previousContext) || (previousSession && newSession !== previousSession);
      if (!changedDocument && contextOf(snapshot) === newContext && Number.isFinite(snapshot.revision) && Number.isFinite(next.revision) && next.revision < snapshot.revision) return;
      if (changedDocument) { selectedNodes.clear(); selectedEdgeId = ''; selectedBindingId = ''; clearNodeEditor(); connectingFrom = ''; activePointer = null; sceneSignature = ''; storyDraft = null; initialFitDone = false; initialFitScheduled = false; if (fitObserver) fitObserver.disconnect(); pendingViewVersion = 0; if (pendingViewTimer) win.clearTimeout(pendingViewTimer); pendingViewTimer = null; }
      previousContext = newContext; previousSession = newSession; snapshot = next;
      const drawing = next.drawing || {};
      if (!activePointer && !pendingViewTimer && !pendingViewVersion) {
        const saved = drawing.viewport;
        if (saved) viewport = { x: finite(saved.x, 36), y: finite(saved.y, 30), zoom: clamp(finite(saved.zoom, finite(saved.scale, 1)), .3, 2.5) };
        view = { mode: drawing.mode === 'all' ? 'all' : 'main', activeStageId: text(drawing.activeStageId) };
        matrixHeight = clamp(finite(drawing.matrixHeight, 210), 96, 500);
      }
      selectedNodes = new Set(Array.from(selectedNodes).filter(id => nodeById(id)));
      if (!edgeById(selectedEdgeId)) { selectedEdgeId = ''; selectedBindingId = ''; }
      if (!bindingById(selectedBindingId)) selectedBindingId = '';
      render();
      if (next.status) notify(typeof next.status === 'string' ? next.status : next.status.message || status, next.status && next.status.error);
    }
    function selectEdge(id, bindingId) {
      const edge = edgeById(id); if (!edge) return;
      selectedEdgeId = id; selectedBindingId = bindingId || ''; selectedNodes.clear(); storyDraft = null;
      if (!scene.edges.some(item => item.id === id)) { view.mode = 'all'; deferView(); }
      render();
      if (typeof opts.onSelectEdge === 'function') safeCallback(opts.onSelectEdge, id);
    }
    function safeCallback(fn, argument) { try { Promise.resolve(fn(argument)).catch(error => notify(mechanismDrawingErrorMessage(error), true)); } catch (error) { notify(mechanismDrawingErrorMessage(error), true); } }
    function locateBinding(id) {
      const binding = bindingById(id); if (!binding) return;
      if (binding.unresolved || (!binding.legacy && !sourceFor(binding))) { notify('原证据块暂不可用；可以右键替换或移除这项绑定。', true); return; }
      if (typeof opts.onLocateEvidence === 'function') safeCallback(opts.onLocateEvidence, { contextKey: snapshot.contextKey, figureId: binding.figureId, blockId: binding.blockId, panelIds: list(binding.panelIds), bindingId: binding.id, edgeId: binding.edgeId });
    }
    function showTooltip(id, element) {
      const binding = bindingById(id); if (!binding) return;
      const match = resolveMechanismDrawingEvidenceSource(snapshot, binding), source = match && match.source || {};
      const archived = match && match.kind === 'archive';
      const unavailable = binding.unresolved || (!binding.legacy && (!match || archived));
      const archiveNote = archived ? `<p class="md-help">合并前的来源记录（只读）${match.contentMatched ? '' : '；这是合并前最后保存的历史来源，当前绑定仍需复核。'}</p>` : '';
      tooltip.innerHTML = `<strong>${esc(binding.panelLabel || source.panelLabel || '证据')}</strong>${archiveNote}${source.title ? `<p>${esc(source.title)}</p>` : ''}${[['方法', source.method], ['观察', source.observation], ['结论', source.conclusion]].filter(([, value]) => value).map(([label, value]) => `<p><b>${label}</b> ${esc(value)}</p>`).join('')}<p>此联系的证据类型：${esc(list(binding.types).map(type => TYPE_NAMES[type]).filter(Boolean).join('、') || '未分类')}</p>${unavailable ? '<p>原证据块暂不可用；请复核、替换或移除绑定。</p>' : '<p class="md-help">点击在解图中定位 · 右键更改</p>'}`;
      tooltip.hidden = false;
      const owner = edgeById(binding.edgeId);
      if (owner) { const relationship = doc.createElement('p'); relationship.textContent = `${edgeName(owner)} · ${owner.label || '联系'}${owner.context && owner.context.summary ? ` · ${owner.context.summary}` : ''}`; tooltip.insertBefore(relationship, tooltip.children[1] || null); }
      if (binding.needsReview) { const review = doc.createElement('p'); review.className = 'md-error'; review.textContent = '联系或原证据已变化，请复核此处证据类型。'; tooltip.appendChild(review); }
      if (binding.legacy) { const legacy = doc.createElement('p'); legacy.className = 'md-help'; legacy.textContent = '既有单 Panel 引用'; tooltip.appendChild(legacy); }
      const rect = element.getBoundingClientRect(), base = shell.getBoundingClientRect();
      tooltip.style.left = `${clamp(rect.left - base.left, 8, Math.max(8, base.width - 330))}px`;
      tooltip.style.top = `${clamp(rect.bottom - base.top + 6, 8, Math.max(8, base.height - tooltip.offsetHeight - 8))}px`;
    }
    function openMenu(id, x, y) {
      const binding = bindingById(id); if (!binding) return;
      const edge = list(snapshot.edges).find(item => list(item.evidence).some(evidence => evidence.id === id));
      if (edge) selectEdge(edge.id, id);
      menuBindingId = id; tooltip.hidden = true;
      menu.innerHTML = `<div class="md-menu-label">${esc(binding.panelLabel || '证据')}</div><button type="button" role="menuitem" data-menu-action="locate">在解图中定位</button>${Object.entries(TYPE_NAMES).map(([type, label]) => `<button type="button" role="menuitemcheckbox" aria-checked="${list(binding.types).includes(type)}" data-menu-type="${type}">${list(binding.types).includes(type) ? '✓ ' : ''}${label}</button>`).join('')}<button type="button" role="menuitem" data-menu-action="replace">替换证据</button><button type="button" role="menuitem" class="md-danger" data-menu-action="remove">移除此证据</button>`;
      menu.hidden = false;
      const base = shell.getBoundingClientRect();
      menu.style.left = `${clamp(x - base.left, 8, Math.max(8, base.width - 186))}px`;
      menu.style.top = `${clamp(y - base.top, 8, Math.max(8, base.height - menu.offsetHeight - 8))}px`;
      menu.querySelector('button').focus();
    }
    function closeMenu() { menu.hidden = true; menuBindingId = ''; }
    function bindSource(source, edgeId) {
      const edge = edgeById(edgeId); if (!source || !edge) return;
      if (list(edge.evidence).some(binding => binding.figureId === source.figureId && binding.blockId === source.blockId)) { notify(`${source.panelLabel || '该证据'}已在 ${edgeName(edge)} 上。`); return; }
      const name = edgeName(edge), panel = source.panelLabel || source.blockId;
      dispatch({ type: 'bind_block', binding: { id: uid('binding'), edgeId, figureId: source.figureId, blockId: source.blockId, types: [] } }, () => { selectEdge(edgeId); notify(`已将 ${panel} 绑定到 ${name}。右键证据名称可定义类型。`); });
    }
    function addEdge(from, to, allowParallel) {
      if (!from || !to || from === to) { notify('请选择两个不同节点建立联系。'); return; }
      const existing = list(snapshot.edges).find(edge => edge.from === from && edge.to === to);
      if (existing && !allowParallel) { selectEdge(existing.id); notify('已选中现有联系；不同条件下的关系可用“另建联系”。'); return; }
      const id = uid('edge');
      dispatch({ type: 'add_edge', edge: { id, from, to, label: '联系', polarity: 'neutral' } }, () => { selectEdge(id); const input = $('[data-field="edge-label"]'); if (input) { input.focus(); input.select(); } });
    }
    async function addNode() {
      const context = previousContext, session = previousSession;
      if (!await commitNodeEditor() || destroyed || !shown || context !== previousContext || session !== previousSession) return;
      const id = uid('node');
      dispatch(() => {
        // Resolve after preceding additions are acknowledged, including rapid clicks.
        layoutGraph();
        const rect = canvas.getBoundingClientRect(), origin = worldPoint(rect.left + 12, rect.top + 12);
        const position = mechanismDrawingFindNodePosition(positions, { ...origin, width: Math.max(0, rect.width - 24) / viewport.zoom, height: Math.max(0, rect.height - 24) / viewport.zoom });
        return { type: 'add_node', node: { id, label: '新节点' }, position };
      }, () => {
        clearNodeEditor(); selectedNodes = new Set([id]); selectedEdgeId = ''; selectedBindingId = ''; storyDraft = null;
        panMode = false; connectMode = false; spaceDown = false; connectingFrom = ''; render();
        revealNode(id); startNodeEdit(id);
      });
    }
    function revealNode(id) {
      const point = positions[id]; if (!point) return;
      const rect = canvas.getBoundingClientRect(), before = { ...viewport }, padding = 12;
      for (const [axis, size, extent] of [['x', NODE_WIDTH, rect.width], ['y', NODE_HEIGHT, rect.height]]) {
        const start = point[axis] * viewport.zoom + viewport[axis], length = size * viewport.zoom;
        if (length + padding * 2 > extent) viewport[axis] = (extent - length) / 2 - point[axis] * viewport.zoom;
        else if (start < padding) viewport[axis] += padding - start;
        else if (start + length > extent - padding) viewport[axis] -= start + length - extent + padding;
      }
      if (before.x !== viewport.x || before.y !== viewport.y) { transform(); deferView(); }
    }
    async function startNodeEdit(id) {
      const context = previousContext, session = previousSession;
      if (editorNodeId && editorNodeId !== id && !await commitNodeEditor()) return;
      if (destroyed || !shown || context !== previousContext || session !== previousSession) return;
      const node = nodeById(id); if (!node) return;
      if (editorNodeId === id) { const editor = $('.md-node-editor'); if (editor) editor.focus(); return; }
      editorVersion += 1; editorNodeId = id; editorValue = nodeLabel(node);
      panMode = false; connectMode = false; connectingFrom = ''; updateToolbar(); renderNodeEditor();
      const editor = $('.md-node-editor'); if (editor) { editor.focus(); editor.select(); }
    }
    function clearNodeEditor() {
      editorVersion += 1; editorNodeId = ''; editorValue = ''; editorPending = null;
      const old = $('.md-node-editor'); if (old) old.remove();
      shell.querySelectorAll('.md-node').forEach(node => { node.hidden = false; });
    }
    function sizeNodeEditor(editor) {
      editor.style.height = 'auto';
      const natural = Math.max(36, editor.scrollHeight + 4), maximum = Math.max(36, canvas.clientHeight / viewport.zoom - 24);
      editor.style.height = `${Math.min(natural, maximum)}px`;
      editor.style.overflowY = natural > maximum ? 'auto' : 'hidden';
    }
    function renderNodeEditor() {
      let editor = $('.md-node-editor');
      const position = positions[editorNodeId];
      if (!editorNodeId || !position || !nodeById(editorNodeId)) { if (editor) clearNodeEditor(); return; }
      // The editor replaces the node visually; its shorter single-line height
      // must not leave the original node's empty lower border underneath.
      shell.querySelectorAll('.md-node').forEach(node => { node.hidden = node.dataset.node === editorNodeId; });
      if (!editor || editor.dataset.focusKey !== `inline:${editorNodeId}`) {
        if (editor) editor.remove();
        editor = doc.createElement('textarea'); editor.className = 'md-node-editor'; editor.value = editorValue; editor.rows = 1;
        editor.setAttribute('aria-label', '编辑节点文字，Enter 保存，Shift+Enter 换行，Escape 取消'); editor.setAttribute('data-focus-key', `inline:${editorNodeId}`);
        world.appendChild(editor);
      }
      editor.style.left = `${position.x}px`; editor.style.top = `${position.y}px`;
      sizeNodeEditor(editor);
    }
    function commitNodeEditor() {
      const editor = $('.md-node-editor'); if (!editorNodeId || !editor) return Promise.resolve(true);
      if (editorPending) return editorPending;
      const id = editorNodeId, label = editor.value.trim();
      if (!label) { notify('节点文字不能为空。可按 Escape 取消修改。', true); return Promise.resolve(false); }
      editorValue = label;
      if (label === nodeLabel(nodeById(id))) { clearNodeEditor(); render(); return Promise.resolve(true); }
      const version = editorVersion, context = previousContext, session = previousSession;
      editor.readOnly = true; editor.setAttribute('aria-busy', 'true');
      const saving = dispatch({ type: 'update_node', nodeId: id, label }).then(result => {
        if (version === editorVersion && editorNodeId === id && previousContext === context && previousSession === session) {
          if (result) { const focused = (shell.getRootNode().activeElement || doc.activeElement) === editor; clearNodeEditor(); render(); if (focused) canvas.focus({ preventScroll: true }); }
          else { editor.readOnly = false; editor.removeAttribute('aria-busy'); }
        }
        if (editorPending === saving) editorPending = null;
        return !!result;
      });
      editorPending = saving;
      return saving;
    }
    function removeSelection() {
      if (selectedEdgeId) dispatch({ type: 'remove_edge', edgeId: selectedEdgeId });
      else if (selectedNodes.size) dispatch({ type: 'remove_nodes', nodeIds: Array.from(selectedNodes) });
    }
    function sourceSelection() { const picker = $('.md-source-picker'); return picker && list(snapshot.sources).find(source => sourceKey(source.figureId, source.blockId) === picker.value); }
    function replaceBinding() {
      if (!selectedBindingId) return;
      const source = sourceSelection();
      if (!source) { notify('在下方选择新的 Figure 证据块，再点击“替换证据”。'); const picker = $('.md-source-picker'); if (picker) picker.focus(); return; }
      const binding = bindingById(selectedBindingId);
      if (binding && binding.legacy) {
        const owner = edgeById(binding.edgeId);
        const removeOld = () => dispatch(mechanismDrawingBindingCommand(binding, 'remove'), () => notify('已将既有 Panel 引用替换为所选完整证据块，请定义证据类型。'));
        if (owner && list(owner.evidence).some(item => item.figureId === source.figureId && item.blockId === source.blockId)) removeOld();
        else dispatch({ type: 'bind_block', binding: { id: uid('binding'), edgeId: binding.edgeId, figureId: source.figureId, blockId: source.blockId, types: [] } }, removeOld);
      } else dispatch({ type: 'replace_binding', bindingId: selectedBindingId, figureId: source.figureId, blockId: source.blockId }, () => notify('已替换证据块，请复核此联系的证据类型。'));
    }
    function openStoryEditor() {
      storyDraft = JSON.parse(JSON.stringify(snapshot.story || snapshot.drawing && snapshot.drawing.story || { stages: [] }));
      storyDraft.stages = list(storyDraft.stages);
      storyEditorIndex = Math.max(0, storyDraft.stages.findIndex(stage => stage.id === (scene.stage && scene.stage.id)));
      selectedEdgeId = ''; selectedBindingId = ''; selectedNodes.clear(); renderInspector();
    }
    function renderStoryEditor() {
      inspector.hidden = false;
      const stages = storyDraft.stages, stage = stages[storyEditorIndex];
      const figures = Array.from(new Map((list(snapshot.figures).length ? snapshot.figures : list(snapshot.sources)).map(source => [source.figureId, { id: source.figureId, label: source.figureLabel || source.figureId }])).values());
      inspector.innerHTML = `<div class="md-inspector-heading"><strong>论证步骤</strong><button type="button" data-story-action="cancel" aria-label="关闭步骤编辑">×</button></div><p class="md-help">保存每一步显示的节点、联系与证据。画布坐标保持固定；完整矩阵始终保留。</p><div class="md-story-editor-nav"><select data-story-field="selected" data-focus-key="story-selected" aria-label="编辑哪一步">${stages.map((item, index) => `<option value="${index}"${index === storyEditorIndex ? ' selected' : ''}>${index + 1}. ${esc(item.figureLabel || '')} ${esc(item.title || '未命名步骤')}</option>`).join('') || '<option>尚无步骤</option>'}</select><button type="button" data-story-action="add">添加步骤</button></div>${stage ? `<div class="md-inspector-row"><button type="button" data-story-action="up"${storyEditorIndex ? '' : ' disabled'}>上移</button><button type="button" data-story-action="down"${storyEditorIndex < stages.length - 1 ? '' : ' disabled'}>下移</button><button type="button" data-story-action="remove" class="md-danger">删除</button></div><label>步骤标题<input type="text" maxlength="240" data-story-field="title" data-focus-key="story-title" value="${esc(stage.title)}"></label><label>简短说明<textarea data-story-field="summary" data-focus-key="story-summary" rows="3">${esc(stage.summary || '')}</textarea></label><fieldset class="md-story-members"><legend>对应 Figure（用于刻度与解图定位）</legend>${figures.map(figure => `<label><input type="checkbox" data-story-member="figureIds" value="${esc(figure.id)}"${list(stage.figureIds).includes(figure.id) ? ' checked' : ''}>${esc(figure.label)}</label>`).join('') || '<p class="md-help">解图后可选择实际 Figure。</p>'}</fieldset><details class="md-story-members" open><summary>此步节点 · ${list(stage.nodeIds).length}</summary>${list(snapshot.nodes).map(node => `<label><input type="checkbox" data-story-member="nodeIds" value="${esc(node.id)}"${list(stage.nodeIds).includes(node.id) ? ' checked' : ''}>${esc(nodeLabel(node))}</label>`).join('')}</details><details class="md-story-members" open><summary>此步联系 · ${list(stage.edgeIds).length}</summary>${list(snapshot.edges).map(edge => `<label><input type="checkbox" data-story-member="edgeIds" value="${esc(edge.id)}"${list(stage.edgeIds).includes(edge.id) ? ' checked' : ''}><span>${esc(edgeName(edge))}<small>${esc(edge.label || '联系')}</small></span></label>`).join('')}</details><details class="md-story-members" open><summary>此步证据 · ${list(stage.bindingIds).length}</summary>${list(snapshot.edges).filter(edge => list(stage.edgeIds).includes(edge.id)).map(edge => `<div class="md-story-evidence-group"><p>${esc(edgeName(edge))}</p>${list(edge.evidence).map(binding => `<label><input type="checkbox" data-story-member="bindingIds" value="${esc(binding.id)}"${list(stage.bindingIds).includes(binding.id) ? ' checked' : ''}><span>${esc(binding.panelLabel || '证据')}</span></label>`).join('') || '<span class="md-help">此联系尚无证据</span>'}</div>`).join('') || '<p class="md-help">先选择此步显示的联系。</p>'}</details>` : '<p class="md-help">添加步骤会记录当前画布可见内容，再按需要勾选。</p>'}<div class="md-story-editor-save"><button type="button" data-story-action="save">保存步骤</button><button type="button" data-story-action="cancel">取消</button></div>`;
    }
    function editStoryField(target) {
      if (!storyDraft) return;
      if (target.dataset.storyField === 'selected') { storyEditorIndex = Number(target.value); renderStoryEditor(); return; }
      const stage = storyDraft.stages[storyEditorIndex]; if (!stage) return;
      const field = target.dataset.storyField;
      if (field === 'title' || field === 'summary') { stage[field] = target.value; return; }
      const member = target.dataset.storyMember;
      if (!['figureIds', 'nodeIds', 'edgeIds', 'bindingIds'].includes(member)) return;
      const values = new Set(list(stage[member])); if (target.checked) values.add(target.value); else values.delete(target.value); stage[member] = Array.from(values);
      if (member === 'edgeIds' && target.checked) { const edge = edgeById(target.value); if (edge) stage.nodeIds = Array.from(new Set(list(stage.nodeIds).concat(edge.from, edge.to))); }
      if (member === 'nodeIds' && !target.checked) stage.edgeIds = list(stage.edgeIds).filter(id => { const edge = edgeById(id); return edge && edge.from !== target.value && edge.to !== target.value; });
      if (member === 'nodeIds' || member === 'edgeIds') stage.bindingIds = list(stage.bindingIds).filter(id => { const binding = bindingById(id); return binding && list(stage.edgeIds).includes(binding.edgeId); });
      if (member === 'figureIds') delete stage.figureLabel; // The model derives canonical F / FS labels.
      renderStoryEditor();
    }
    function onStoryAction(action) {
      if (!storyDraft) return;
      if (action === 'cancel') { storyDraft = null; renderInspector(); return; }
      if (action === 'add') {
        if (storyDraft.stages.length >= 64) { notify('最多可设置 64 个论证步骤。', true); return; }
        storyDraft.stages.push({ id: uid('step'), title: `步骤 ${storyDraft.stages.length + 1}`, summary: '', figureIds: [], nodeIds: scene.nodes.map(node => node.id), edgeIds: scene.edges.map(edge => edge.id), bindingIds: scene.edges.flatMap(edge => list(edge.evidence).map(binding => binding.id)) });
        storyEditorIndex = storyDraft.stages.length - 1; renderStoryEditor(); const input = $('[data-story-field="title"]'); if (input) { input.focus(); input.select(); } return;
      }
      if (action === 'remove') { storyDraft.stages.splice(storyEditorIndex, 1); storyEditorIndex = Math.max(0, Math.min(storyEditorIndex, storyDraft.stages.length - 1)); renderStoryEditor(); return; }
      if (action === 'up' || action === 'down') {
        const next = storyEditorIndex + (action === 'up' ? -1 : 1); if (next < 0 || next >= storyDraft.stages.length) return;
        [storyDraft.stages[next], storyDraft.stages[storyEditorIndex]] = [storyDraft.stages[storyEditorIndex], storyDraft.stages[next]]; storyEditorIndex = next; renderStoryEditor(); return;
      }
      if (action === 'save') {
        const title = $('[data-story-field="title"]'), summary = $('[data-story-field="summary"]'), selected = storyDraft.stages[storyEditorIndex];
        if (selected) { if (title) selected.title = title.value; if (summary) selected.summary = summary.value; }
        if (storyDraft.stages.some(stage => !text(stage.title).trim())) { notify('请为每个步骤填写标题。', true); return; }
        const submitted = JSON.parse(JSON.stringify(storyDraft)), submittedKey = JSON.stringify(submitted), activeStageId = selected && selected.id || '';
        dispatch({ type: 'set_story', story: submitted }, () => { const newerEdits = storyDraft && JSON.stringify(storyDraft) !== submittedKey; if (!newerEdits) storyDraft = null; view = { mode: 'main', activeStageId }; render(); saveView(); notify(newerEdits ? '已保存上次提交的步骤；编辑面板中的新修改仍待保存。' : '已保存论证步骤。拖动进度条逐步查看，节点位置保持不变。'); });
      }
    }
    function onAction(action) {
      if (action === 'close') { const context = previousContext, session = previousSession; commitNodeEditor().then(saved => { if (saved && !destroyed && context === previousContext && session === previousSession) { if (typeof opts.onClose === 'function') opts.onClose(); close(); } }); }
      else if (action === 'expand') { expanded = !expanded; updateToolbar(); }
      else if (action === 'add-node') addNode();
      else if (action === 'select') { panMode = false; connectMode = false; spaceDown = false; connectingFrom = ''; updateToolbar(); }
      else if (action === 'connect') { connectMode = !connectMode; panMode = false; connectingFrom = ''; updateToolbar(); notify(connectMode ? '依次点击起点和终点，或从节点端口拉线。' : '连线工具已关闭。'); }
      else if (action === 'pan') { panMode = !panMode; connectMode = false; updateToolbar(); }
      else if (action === 'undo' || action === 'redo') dispatch({ type: action });
      else if (action === 'zoom-in' || action === 'zoom-out') zoomAt(viewport.zoom * (action === 'zoom-in' ? 1.15 : 1 / 1.15));
      else if (action === 'fit') fit();
      else if (action === 'matrix') { matrixVisible = !matrixVisible; updateToolbar(); }
      else if (action === 'story') { openStoryEditor(); }
      else if (action === 'main' || action === 'all') { view.mode = action; render(); saveView(); }
      else if (action === 'deselect') { selectedNodes.clear(); selectedEdgeId = ''; selectedBindingId = ''; storyDraft = null; render(); }
      else if (action === 'delete-edge' || action === 'delete-nodes') removeSelection();
      else if (action === 'reverse') { const edge = edgeById(selectedEdgeId); if (edge) dispatch({ type: 'update_edge', edgeId: edge.id, from: edge.to, to: edge.from }); }
      else if (action === 'parallel-edge') { const edge = edgeById(selectedEdgeId); if (edge) addEdge(edge.from, edge.to, true); }
      else if (action === 'remove-binding' && selectedBindingId) dispatch(mechanismDrawingBindingCommand(bindingById(selectedBindingId), 'remove'));
      else if (action === 'replace-binding') replaceBinding();
      else if (action === 'bind-source') { const source = sourceSelection(); if (source) bindSource(source, selectedEdgeId); else notify('请先选择一个解图证据块。'); }
    }

    listen(shell, 'click', event => {
      const target = event.target.closest ? event.target : event.target.parentElement;
      const storyAction = target.closest('[data-story-action]'); if (storyAction) { onStoryAction(storyAction.dataset.storyAction); return; }
      const menuType = target.closest('[data-menu-type]');
      if (menuType) { const binding = bindingById(menuBindingId); if (binding) { const values = new Set(list(binding.types)), type = menuType.dataset.menuType; if (values.has(type)) values.delete(type); else values.add(type); dispatch(mechanismDrawingBindingCommand(binding, 'types', Array.from(values))); } closeMenu(); return; }
      const menuAction = target.closest('[data-menu-action]');
      if (menuAction) { const id = menuBindingId, action = menuAction.dataset.menuAction; closeMenu(); if (action === 'locate') locateBinding(id); else if (action === 'remove') dispatch(mechanismDrawingBindingCommand(bindingById(id), 'remove')); else { selectedBindingId = id; renderInspector(); notify('在“从解图添加证据”中选择新证据，再点击“替换证据”。'); const picker = $('.md-source-picker'); if (picker) picker.focus(); } return; }
      if (!target.closest('.md-menu')) closeMenu();
      const binding = target.closest('[data-binding]'); if (binding) { locateBinding(binding.dataset.binding); return; }
      const action = target.closest('[data-action]'); if (action) { onAction(action.dataset.action); return; }
      const tick = target.closest('[data-stage-index]'); if (tick) { setStage(Number(tick.dataset.stageIndex), true, true); return; }
      const edge = target.closest('[data-edge-select]') || target.closest('[data-edge]'); if (edge) { selectEdge(edge.dataset.edgeSelect || edge.dataset.edge); return; }
      const cell = target.closest('[data-matrix-from]'); if (cell) { const found = list(snapshot.edges).find(item => item.from === cell.dataset.matrixFrom && item.to === cell.dataset.matrixTo); if (found) selectEdge(found.id); return; }
      const node = target.closest('[data-node]');
      if (node && connectMode) { if (connectingFrom) { const from = connectingFrom; connectingFrom = ''; addEdge(from, node.dataset.node); } else { connectingFrom = node.dataset.node; renderGraph(); notify(`已选择起点 ${nodeLabel(nodeById(connectingFrom))}，请选择终点。`); } }
    });
    listen(shell, 'dblclick', event => {
      const node = event.target.closest('[data-node]'); if (node && !event.target.closest('[data-port]')) { startNodeEdit(node.dataset.node); return; }
      const cell = event.target.closest('[data-matrix-from]'); if (cell && !event.target.closest('[data-binding]')) addEdge(cell.dataset.matrixFrom, cell.dataset.matrixTo);
    });
    listen(shell, 'change', event => {
      const target = event.target;
      if (target.dataset.storyField || target.dataset.storyMember) { editStoryField(target); return; }
      if (target.classList.contains('md-story-range')) { setStage(Number(target.value), true, true); return; }
      if (target.dataset.bindingType) {
        const types = Array.from(inspector.querySelectorAll('[data-binding-type]:checked')).map(input => input.dataset.bindingType);
        dispatch(mechanismDrawingBindingCommand(bindingById(target.dataset.bindingId), 'types', types)); return;
      }
      const field = target.dataset.field;
      if (field === 'edge-choice') { selectEdge(target.value); return; }
      if (field === 'edge-context') { const edge = edgeById(selectedEdgeId); if (edge) dispatch({ type: 'update_edge', edgeId: edge.id, context: { ...edge.context, summary: target.value.trim() } }); return; }
      if (field === 'node-label') { if (target.value.trim()) dispatch({ type: 'update_node', nodeId: target.dataset.nodeId, label: target.value.trim() }); else notify('节点文字不能为空。', true); }
      else if (field && selectedEdgeId) {
        const edge = edgeById(selectedEdgeId); if (!edge) return;
        const property = { 'edge-label': 'label', 'edge-from': 'from', 'edge-to': 'to', 'edge-polarity': 'polarity' }[field];
        if (property) { if ((property === 'from' && target.value === edge.to) || (property === 'to' && target.value === edge.from)) { notify('起点和终点需要是不同节点。', true); target.value = edge[property]; } else dispatch({ type: 'update_edge', edgeId: edge.id, [property]: target.value.trim() }); }
      }
    });
    listen(shell, 'input', event => { if (event.target.classList.contains('md-story-range')) setStage(Number(event.target.value), false, false); else if (event.target.classList.contains('md-node-editor')) { editorValue = event.target.value; sizeNodeEditor(event.target); } else if (storyDraft && ['title', 'summary'].includes(event.target.dataset.storyField)) { const stage = storyDraft.stages[storyEditorIndex]; if (stage) stage[event.target.dataset.storyField] = event.target.value; } });
    listen(shell, 'contextmenu', event => { const binding = event.target.closest('[data-binding]'); if (binding) { event.preventDefault(); openMenu(binding.dataset.binding, event.clientX, event.clientY); } });
    listen(shell, 'mouseover', event => { const binding = event.target.closest('[data-binding]'); if (binding) showTooltip(binding.dataset.binding, binding); });
    listen(shell, 'mouseout', event => { if (event.target.closest('[data-binding]')) tooltip.hidden = true; });
    listen(shell, 'focusin', event => { const binding = event.target.closest('[data-binding]'); if (binding) showTooltip(binding.dataset.binding, binding); });
    listen(shell, 'focusout', event => { tooltip.hidden = true; if (event.target.classList.contains('md-node-editor') && editorNodeId) commitNodeEditor(); });

    function hitNode(clientX, clientY) {
      const surface = shell.getRootNode();
      const element = typeof surface.elementFromPoint === 'function' ? surface.elementFromPoint(clientX, clientY) : null;
      const port = element && typeof element.closest === 'function' && element.closest('[data-port]');
      if (port) { const node = scene.nodes.find(item => item.id === port.dataset.port); if (node) return node; }
      const point = worldPoint(clientX, clientY);
      return mechanismDrawingNodeAtPoint(scene.nodes, positions, point);
    }
    function previewConnection(point) {
      const from = positions[connectingFrom]; if (!from) return;
      $('.md-connection-preview').setAttribute('d', `M${from.x + NODE_WIDTH / 2} ${from.y + NODE_HEIGHT / 2} L${point.x} ${point.y}`);
    }
    listen(canvas, 'pointerdown', event => {
      if (event.button !== 0 && event.button !== 1 || event.target.closest('.md-node-editor,[data-binding]')) return;
      tooltip.hidden = true; closeMenu();
      const target = event.target.closest('[data-node]'), port = event.target.closest('[data-port]');
      const mode = mechanismDrawingGestureMode({ pan: panMode || spaceDown, middle: event.button === 1, port: !!port, object: !!target, edge: !!event.target.closest('.md-edge-label,[data-edge]'), shift: !!event.shiftKey, connectMode });
      if (mode === 'connect') { event.preventDefault(); connectingFrom = port.dataset.port; activePointer = { kind: 'connect', id: event.pointerId }; canvas.setPointerCapture(event.pointerId); previewConnection(worldPoint(event.clientX, event.clientY)); return; }
      if (mode === 'edge' || mode === 'connect-click') return;
      const point = worldPoint(event.clientX, event.clientY);
      if (mode === 'pan') activePointer = { kind: 'pan', id: event.pointerId, x: event.clientX, y: event.clientY, viewport: { ...viewport } };
      else if (mode === 'move') {
        const id = target.dataset.node;
        if (event.shiftKey || event.ctrlKey || event.metaKey || !selectedNodes.has(id)) selectedNodes = new Set(interaction.canvasToggleSelection(Array.from(selectedNodes), id, !!(event.shiftKey || event.ctrlKey || event.metaKey)));
        selectedEdgeId = ''; selectedBindingId = '';
        const originals = {}; selectedNodes.forEach(nodeId => { originals[nodeId] = { ...positions[nodeId] }; });
        activePointer = { kind: 'nodes', id: event.pointerId, start: point, originals, preview: { ...originals }, moved: false };
        render();
      } else if (mode === 'marquee') { selectedEdgeId = ''; selectedBindingId = ''; activePointer = { kind: 'select', id: event.pointerId, start: point, additive: new Set(selectedNodes) }; render(); }
      if (activePointer) {
        event.preventDefault(); canvas.focus({ preventScroll: true });
        activePointer.captureTarget = activePointer.kind === 'nodes' ? target : canvas;
        activePointer.captureTarget.setPointerCapture(event.pointerId);
      }
    });
    listen(canvas, 'pointermove', event => {
      if (!activePointer || activePointer.id !== event.pointerId) return;
      const point = worldPoint(event.clientX, event.clientY), active = activePointer;
      if (active.kind === 'pan') { viewport = interaction.canvasPan(active.viewport, { x: active.x, y: active.y }, { x: event.clientX, y: event.clientY }); transform(); }
      else if (active.kind === 'nodes') {
        const dx = point.x - active.start.x, dy = point.y - active.start.y; active.moved = active.moved || Math.abs(dx) + Math.abs(dy) > 3;
        Object.entries(active.originals).forEach(([id, original]) => { active.preview[id] = { ...original, x: original.x + dx, y: original.y + dy }; }); renderGraph();
      } else if (active.kind === 'connect') previewConnection(point);
      else if (active.kind === 'select') {
        const box = { x: Math.min(active.start.x, point.x), y: Math.min(active.start.y, point.y), width: Math.abs(point.x - active.start.x), height: Math.abs(point.y - active.start.y) };
        const element = $('.md-selection-box'); element.hidden = false; Object.entries(box).forEach(([key, value]) => { element.style[key === 'x' ? 'left' : key === 'y' ? 'top' : key] = `${value}px`; });
        selectedNodes = new Set(active.additive); scene.nodes.forEach(node => { const position = positions[node.id]; if (position.x + NODE_WIDTH >= box.x && position.x <= box.x + box.width && position.y + NODE_HEIGHT >= box.y && position.y <= box.y + box.height) selectedNodes.add(node.id); });
        shell.querySelectorAll('.md-node').forEach(element => element.classList.toggle('md-selected', selectedNodes.has(element.dataset.node)));
      }
    });
    function endPointer(event, cancelled) {
      if (!activePointer || activePointer.id !== event.pointerId) return;
      const active = activePointer; activePointer = null;
      if (active.captureTarget && active.captureTarget.hasPointerCapture(event.pointerId)) active.captureTarget.releasePointerCapture(event.pointerId);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      $('.md-selection-box').hidden = true; $('.md-connection-preview').setAttribute('d', '');
      if (active.kind === 'nodes' && active.moved && !cancelled) {
        const persisted = snapshot.drawing && snapshot.drawing.positions || {};
        const frozen = Object.entries(positions).filter(([id]) => Object.hasOwn(active.preview, id) || !persisted[id]).map(([nodeId, point]) => ({ nodeId, x: point.x, y: point.y, ...(Object.hasOwn(active.preview, nodeId) ? { pinned: true } : {}) }));
        dispatch({ type: 'move_nodes', positions: frozen });
      }
      else if (active.kind === 'connect') { const from = connectingFrom, to = hitNode(event.clientX, event.clientY); connectingFrom = ''; if (!cancelled && to) addEdge(from, to.id); }
      else if (active.kind === 'pan' && !cancelled) saveView();
      render();
    }
    listen(canvas, 'pointerup', event => endPointer(event, false));
    listen(canvas, 'pointercancel', event => endPointer(event, true));
    listen(canvas, 'wheel', event => { if (event.target.closest('.md-node-editor,.md-node-label')) return; event.preventDefault(); zoomAt(viewport.zoom * Math.exp(-event.deltaY * .0015), event.clientX, event.clientY); }, { passive: false });

    function dropTarget(event) {
      const element = event.target.closest && event.target.closest('.md-edge-label[data-edge]');
      return mechanismDrawingRouteTarget(routes, scene.edges, worldPoint(event.clientX, event.clientY), viewport.zoom, element && element.dataset.edge).id || '';
    }
    function showDrop(id) {
      if (dropEdgeId !== id) { dropEdgeId = id; updateDropHighlight(); }
      const hint = $('.md-drop-hint'), edge = edgeById(id); hint.hidden = false;
      hint.textContent = edge ? `松开绑定：${edgeName(edge)}` : '请拖到一条联系线上；靠近交叉处时，请移向该联系的独立线段。';
    }
    function updateDropHighlight() {
      const edge = edgeById(dropEdgeId);
      shell.querySelectorAll('.md-node[data-node]').forEach(element => element.classList.toggle('md-drop-target', !!edge && (element.dataset.node === edge.from || element.dataset.node === edge.to)));
      shell.querySelectorAll('.md-edge[data-edge],.md-edge-label[data-edge]').forEach(element => { const target = element.dataset.edge === dropEdgeId; element.classList.toggle('md-drop-target', target); if (element.classList.contains('md-edge')) element.classList.toggle('md-active', target || element.dataset.edge === selectedEdgeId); });
    }
    function clearDrop() { if (dropEdgeId) { dropEdgeId = ''; updateDropHighlight(); } $('.md-drop-hint').hidden = true; }
    function acceptEvidenceDrag(event) {
      if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes(EVIDENCE_MIME)) return;
      event.preventDefault(); const id = dropTarget(event); event.dataTransfer.dropEffect = 'copy'; showDrop(id);
    }
    listen(canvas, 'dragenter', acceptEvidenceDrag);
    listen(canvas, 'dragover', acceptEvidenceDrag);
    listen(canvas, 'dragleave', event => { const bounds = canvas.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) clearDrop(); });
    listen(canvas, 'drop', event => {
      if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes(EVIDENCE_MIME)) return;
      event.preventDefault(); const id = dropTarget(event); clearDrop();
      if (!id) { notify('未找到明确的目标联系。请拖到该联系的独立线段，或在编辑面板中添加证据。', true); return; }
      try { const payload = parseMechanismEvidenceDrop(event.dataTransfer.getData(EVIDENCE_MIME), snapshot); bindSource(list(snapshot.sources).find(source => source.figureId === payload.figureId && source.blockId === payload.blockId), id); }
      catch (error) { notify(error.message, true); }
    });

    const resizer = $('.md-matrix-resizer');
    let resizing = null;
    listen(resizer, 'pointerdown', event => { if (event.button !== 0) return; resizing = { y: event.clientY, height: matrixHeight, id: event.pointerId }; resizer.setPointerCapture(event.pointerId); event.preventDefault(); });
    listen(resizer, 'pointermove', event => { if (!resizing || resizing.id !== event.pointerId) return; matrixHeight = clamp(resizing.height + resizing.y - event.clientY, 96, Math.min(500, shell.clientHeight * .6)); resizer.setAttribute('aria-valuenow', String(Math.round(matrixHeight))); updateToolbar(); });
    listen(resizer, 'pointerup', event => { if (!resizing) return; resizing = null; resizer.releasePointerCapture(event.pointerId); saveView(); });
    listen(resizer, 'keydown', event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); matrixHeight = clamp(matrixHeight + (event.key === 'ArrowUp' ? 24 : -24), 96, 500); updateToolbar(); saveView(); } });
    listen(shell, 'keydown', event => {
      const target = event.target, editing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;
      if (target.classList.contains('md-node-editor')) { if (event.isComposing) return; if (event.key === 'Escape') { event.preventDefault(); if (!editorPending) { clearNodeEditor(); render(); canvas.focus({ preventScroll: true }); } } else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); commitNodeEditor(); } return; }
      if (!menu.hidden && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const items = Array.from(menu.querySelectorAll('button')), index = items.indexOf(target); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); return; }
      const binding = target.closest('[data-binding]');
      if (binding && ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu')) { event.preventDefault(); const rect = binding.getBoundingClientRect(); openMenu(binding.dataset.binding, rect.left, rect.bottom); return; }
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(); tooltip.hidden = true; connectingFrom = ''; connectMode = false; panMode = false; spaceDown = false; selectedEdgeId = ''; selectedBindingId = ''; selectedNodes.clear(); storyDraft = null; render(); return; }
      if (editing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey ? snapshot.canRedo : snapshot.canUndo) dispatch({ type: event.shiftKey ? 'redo' : 'undo' }); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); if (snapshot.canRedo) dispatch({ type: 'redo' }); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelection(); }
      else if (event.key === ' ' && !target.closest('button,[data-matrix-from]')) { event.preventDefault(); spaceDown = true; updateToolbar(); }
      else if ((event.key === 'Enter' || event.key === 'F2') && target.dataset.node) { event.preventDefault(); startNodeEdit(target.dataset.node); }
      else if (event.key === 'Enter' && target.dataset.matrixFrom) { event.preventDefault(); const edge = list(snapshot.edges).find(item => item.from === target.dataset.matrixFrom && item.to === target.dataset.matrixTo); if (edge) selectEdge(edge.id); else addEdge(target.dataset.matrixFrom, target.dataset.matrixTo); }
      else if (event.key === 'Enter' && target.dataset.edgeSelect) selectEdge(target.dataset.edgeSelect);
    });
    listen(shell, 'keyup', event => { if (event.key === ' ') { spaceDown = false; updateToolbar(); } });
    listen(win, 'blur', () => { spaceDown = false; if (!destroyed) updateToolbar(); });

    function scheduleInitialFit() {
      const hasSavedViewport = typeof snapshot.hasSavedViewport === 'boolean' ? snapshot.hasSavedViewport : !!(snapshot.snapshot && snapshot.snapshot.drawing && snapshot.snapshot.drawing.viewport);
      if (initialFitDone || initialFitScheduled || !list(snapshot.nodes).length || hasSavedViewport) return;
      initialFitScheduled = true;
      const context = previousContext;
      const run = () => {
        if (destroyed || !shown || previousContext !== context || initialFitDone) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 160 || rect.height < 100) {
          if (!fitObserver && typeof win.ResizeObserver === 'function') { fitObserver = new win.ResizeObserver(run); fitObserver.observe(canvas); }
          return;
        }
        if (fitObserver) { fitObserver.disconnect(); fitObserver = null; }
        initialFitDone = true; initialFitScheduled = false; renderGraph(); fit();
      };
      const afterLayout = () => win.requestAnimationFrame(() => win.requestAnimationFrame(run));
      const stylesheet = shell.getRootNode().querySelector('link[rel="stylesheet"]');
      if (stylesheet && !stylesheet.sheet) stylesheet.addEventListener('load', afterLayout, { once: true }); else afterLayout();
    }
    function open(next) { if (destroyed) return; shown = true; shell.hidden = false; if (next) update(next); else render(); scheduleInitialFit(); }
    function close() { shown = false; clearNodeEditor(); shell.hidden = true; tooltip.hidden = true; closeMenu(); activePointer = null; connectingFrom = ''; spaceDown = false; }
    function destroy() { if (destroyed) return; destroyed = true; shown = false; if (fitObserver) fitObserver.disconnect(); if (pendingViewTimer) win.clearTimeout(pendingViewTimer); listeners.splice(0).forEach(remove => remove()); shell.remove(); }
    function getState() { return { open: shown, contextKey: snapshot.contextKey, sessionId: snapshot.sessionId, revision: snapshot.revision, pending, selectedNodeIds: Array.from(selectedNodes), selectedEdgeId, selectedBindingId, viewport: { ...viewport }, mode: view.mode, activeStageId: scene.stage && scene.stage.id || view.activeStageId, matrixHeight, visibleNodeIds: scene.nodes.map(node => node.id), visibleEdgeIds: scene.edges.map(edge => edge.id), status, error: errorStatus }; }
    return { open, update, close, destroy, getState };
  }

  return { MECHANISM_DRAWING_EVIDENCE_MIME: EVIDENCE_MIME, createMechanismDrawingUi, mechanismDrawingEvidenceClass, resolveMechanismDrawingEvidenceSource, mechanismDrawingBindingCommand, mechanismDrawingErrorMessage, mechanismDrawingLabelSize, mechanismDrawingNodeAtPoint, mechanismDrawingFindNodePosition, parseMechanismEvidenceDrop, selectMechanismDrawingScene, mechanismDrawingWorldPoint, mechanismDrawingRouteDistance, mechanismDrawingRouteTarget, mechanismDrawingGestureMode };
});
