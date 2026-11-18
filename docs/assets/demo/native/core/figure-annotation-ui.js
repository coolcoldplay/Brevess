(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const TOOL_ICONS = {
    magnifier: ['M17 10a7 7 0 1 1-14 0 7 7 0 1 1 14 0', 'm15 15 6 6', 'M7 10h6M10 7v6'],
    pan: ['M12 3v18M3 12h18', 'm9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3'],
    pen: ['m4 16-1 5 5-1L20 8l-4-4Z', 'm13 7 4 4', 'm4 16 4 4'],
    line: ['M5 19 19 5', 'M3 19h4M5 17v4M17 5h4M19 3v4'],
    arrow: ['M4 20 20 4', 'M10 4h10v10'],
    rectangle: ['M4 5h16v14H4Z'],
    ellipse: ['M21 12a9 7 0 1 1-18 0 9 7 0 1 1 18 0'],
    eraser: ['m4 13 9-9 8 8-8 8H9l-5-5Z', 'm9 8 8 8', 'M13 20h8'],
    text: ['M4 7V4h16v3', 'M12 4v16', 'M8 20h8'],
    undo: ['m9 5-5 5 5 5', 'M4 10h9a6 6 0 0 1 0 12'],
    redo: ['m15 5 5 5-5 5', 'M20 10h-9a6 6 0 0 0 0 12'],
    save: ['M5 3h12l4 4v14H3V3Z', 'M7 3v6h10V3', 'M7 21v-8h10v8']
  };
  function figureAnnotationToolIcon(doc, name) {
    const svg = doc.createElementNS(NS, 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none',
      stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, value);
    for (const d of TOOL_ICONS[name] || []) { const path = doc.createElementNS(NS, 'path'); path.setAttribute('d', d); svg.append(path); }
    return svg;
  }
  function createFigureAnnotationOverlay({ image, parent = image.ownerDocument.documentElement, clipElement,
    getDisplaySource = () => null, isVisible = () => true, binding }) {
    const doc = image.ownerDocument, win = doc.defaultView;
    const svg = doc.createElementNS(NS, 'svg');
    svg.dataset.brevessFigureAnnotations = ''; svg.dataset.sciPluginUi = '';
    svg.style.cssText = 'position:fixed;z-index:2;pointer-events:none;overflow:hidden;touch-action:none;';
    svg.setAttribute('aria-label', '图片标注');
    const height = 1000 * binding.height / binding.width;
    svg.setAttribute('viewBox', `0 0 1000 ${height}`); svg.setAttribute('preserveAspectRatio', 'none');
    parent.append(svg);
    let frame = 0, destroyed = false, area = null;
    function paint() {
      if (frame) win.cancelAnimationFrame(frame);
      frame = 0;
      if (destroyed || !image.isConnected || !isVisible()) { svg.style.display = 'none'; return; }
      const rect = image.getBoundingClientRect(), css = win.getComputedStyle(image);
      const display = shared.figureMagnifierDisplaySource(image, css, getDisplaySource(image));
      const sx = rect.width / (image.offsetWidth || rect.width), sy = rect.height / (image.offsetHeight || rect.height);
      const n = name => parseFloat(css[name]) || 0;
      const left = (n('borderLeftWidth') + n('paddingLeft')) * sx, top = (n('borderTopWidth') + n('paddingTop')) * sy;
      const content = { left: rect.left + left, top: rect.top + top,
        width: rect.width - left - (n('borderRightWidth') + n('paddingRight')) * sx,
        height: rect.height - top - (n('borderBottomWidth') + n('paddingBottom')) * sy };
      area = shared.figureImageGeometry(content, display.width, display.height, display.fit, display.position);
      if (!area || !area.width || !area.height) { svg.style.display = 'none'; return; }
      const clip = clipElement?.getBoundingClientRect() || { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight };
      const x0 = Math.max(0, content.left, clip.left, area.left), y0 = Math.max(0, content.top, clip.top, area.top);
      const x1 = Math.min(win.innerWidth, content.left + content.width, clip.right, area.left + area.width);
      const y1 = Math.min(win.innerHeight, content.top + content.height, clip.bottom, area.top + area.height);
      if (x1 <= x0 || y1 <= y0) { svg.style.display = 'none'; return; }
      Object.assign(svg.style, { display: 'block', left: area.left + 'px', top: area.top + 'px', width: area.width + 'px', height: area.height + 'px',
        clipPath: `inset(${y0 - area.top}px ${area.left + area.width - x1}px ${area.top + area.height - y1}px ${x0 - area.left}px)` });
    }
    function refresh() { if (!destroyed && !frame) frame = win.requestAnimationFrame(paint); }
    function element(tag, attrs, text) {
      const node = doc.createElementNS(NS, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
      if (text !== undefined) node.textContent = text; return node;
    }
    function render(objects, selectedId = '') {
      svg.replaceChildren();
      for (const object of objects) {
        const points = object.points.map(([x, y]) => [x * 1000, y * height]), first = points[0], last = points.at(-1);
        const group = element('g', { 'data-annotation-id': object.id, fill: 'none', stroke: object.color,
          'stroke-width': object.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
        let shape;
        if (object.type === 'text') shape = element('text', { x: first[0], y: first[1], fill: object.color, stroke: 'none',
          'font-size': object.fontSize || 24, 'font-family': 'system-ui, sans-serif', 'dominant-baseline': 'hanging' }, object.text);
        else if (object.type === 'rectangle') shape = element('rect', { x: Math.min(first[0], last[0]), y: Math.min(first[1], last[1]), width: Math.abs(last[0] - first[0]), height: Math.abs(last[1] - first[1]) });
        else if (object.type === 'ellipse') shape = element('ellipse', { cx: (first[0] + last[0]) / 2, cy: (first[1] + last[1]) / 2, rx: Math.abs(last[0] - first[0]) / 2, ry: Math.abs(last[1] - first[1]) / 2 });
        else shape = element('path', { d: points.length === 1 ? `M${first}l0.01,0` : points.map((point, index) => `${index ? 'L' : 'M'}${point}`).join(' ') });
        group.append(shape);
        if (object.id === selectedId && object.type !== 'pen' && object.type !== 'text') {
          for (const [index, point] of [first, last].entries()) group.append(element('circle', {
            cx: point[0], cy: point[1], r: 6, fill: '#fff', stroke: '#286c91', 'stroke-width': 2,
            'data-annotation-handle': index, style: 'cursor:nwse-resize;pointer-events:all'
          }));
        }
        if (object.type === 'arrow') {
          const angle = Math.atan2(last[1] - first[1], last[0] - first[0]), size = Math.max(10, object.width * 4);
          const corners = [last, [last[0] - size * Math.cos(angle - .5), last[1] - size * Math.sin(angle - .5)],
            [last[0] - size * Math.cos(angle + .5), last[1] - size * Math.sin(angle + .5)]];
          group.append(element('polygon', { points: corners.map(p => p.join(',')).join(' '), fill: object.color }));
        }
        svg.append(group);
      }
      refresh();
    }
    // Mutation/resize observers run before paint. Do not defer a transformed
    // image's overlay to the following frame during wheel zoom or layout changes.
    const resize = new win.ResizeObserver(paint); resize.observe(image); if (clipElement) resize.observe(clipElement);
    const mutation = new win.MutationObserver(paint); mutation.observe(image, { attributes: true, attributeFilter: ['style', 'class', 'src'] });
    const listeners = [[doc, 'scroll'], [win, 'resize'], [image, 'load']];
    for (const [node, event] of listeners) node.addEventListener(event, paint, true);
    refresh();
    return { element: svg, render, refresh, point(event) { paint(); if (!area) return null;
      return [Math.max(0, Math.min(1, (event.clientX - area.left) / area.width)), Math.max(0, Math.min(1, (event.clientY - area.top) / area.height))]; },
      destroy() { destroyed = true; if (frame) win.cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect();
        for (const [node, event] of listeners) node.removeEventListener(event, paint, true); svg.remove(); } };
  }
  function createFigureAnnotationEditor({ image, canvas, controls, session, getDisplaySource = () => null, isVisible = () => true }) {
    const doc = image.ownerDocument, win = doc.defaultView, bar = doc.createElement('div');
    bar.className = 'sci-figure-annotation-controls'; bar.dataset.sciPluginUi = '';
    bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', '图片标注工具'); controls.append(bar);
    const magnifier = controls.querySelector('[data-figure-viewer-magnifier]');
    if (magnifier) bar.prepend(magnifier);
    const overlay = createFigureAnnotationOverlay({ image, parent: canvas, clipElement: canvas, binding: session.getState().binding, getDisplaySource, isVisible });
    let tool = 'pan', width = 3, color = '#d23b34', draft = null, space = false, destroyed = false, selectedId = '';
    const selected = () => session.getState().objects.find(object => object.id === selectedId);
    const updateSelected = patch => { if (selectedId) session.commit(session.getState().objects.map(object => object.id === selectedId ? { ...object, ...patch } : object)); };
    const buttons = new Map(), listeners = [], add = (node, name, fn, options) => { node.addEventListener(name, fn, options); listeners.push([node, name, fn, options]); };
    const button = (icon, label, fn) => { const node = doc.createElement('button'); node.type = 'button';
      node.className = 'sci-figure-annotation-icon'; node.dataset.annotationTool = icon; node.title = label;
      node.append(figureAnnotationToolIcon(doc, icon)); node.setAttribute('aria-label', label); add(node, 'click', fn); bar.append(node); return node; };
    const updateTool = () => { overlay.element.style.pointerEvents = tool === 'pan' || space ? 'none' : 'auto'; overlay.element.style.cursor = tool === 'eraser' ? 'crosshair' : 'crosshair';
      buttons.forEach((b, key) => b.setAttribute('aria-pressed', String(key === tool))); textInput.hidden = tool !== 'text'; };
    for (const [key, label] of [['pan','移动'],['pen','画笔'],['line','直线'],['arrow','箭头'],['rectangle','矩形'],['ellipse','椭圆'],['eraser','橡皮擦'],['text','文字']]) {
      buttons.set(key, button(key, key === 'eraser' ? '橡皮擦：删除整条标注' : label, () => { finish(null, true); tool = key; selectedId = ''; repaint(); updateTool(); }));
    }
    const colorInput = doc.createElement('input'); colorInput.type = 'color'; colorInput.value = color; colorInput.setAttribute('aria-label', '标注颜色');
    add(colorInput, 'input', () => { color = colorInput.value; updateSelected({ color }); }); bar.append(colorInput);
    const widthInput = doc.createElement('input'); widthInput.type = 'number'; widthInput.min = '.25'; widthInput.max = '30'; widthInput.step = '.25'; widthInput.value = String(width);
    widthInput.title = '滚轮调整选中标注粗细；未选中时设置下一笔'; widthInput.setAttribute('aria-label', '画笔粗细'); bar.append(widthInput);
    const setWidth = value => { width = Math.max(.25, Math.min(30, Number(value) || 3)); widthInput.value = String(Math.round(width * 100) / 100); updateSelected({ width }); };
    add(widthInput, 'input', () => setWidth(widthInput.value));
    add(widthInput, 'wheel', event => { event.preventDefault(); event.stopPropagation(); setWidth(width * Math.exp(-event.deltaY * .002)); }, { passive: false });
    const textInput = doc.createElement('input'); textInput.type = 'text'; textInput.maxLength = 2000; textInput.placeholder = '输入文字后点击图片放置'; textInput.setAttribute('aria-label', '标注文字'); bar.append(textInput);
    const undo = button('undo', '撤销标注', () => session.undo()), redo = button('redo', '重做标注', () => session.redo());
    const save = button('save', '保存标注', () => { void session.save().catch(() => {}); });
    const status = doc.createElement('output'); status.setAttribute('aria-live', 'polite'); bar.append(status);
    const hint = doc.createElement('span'); hint.className = 'sci-figure-annotation-hint'; hint.textContent = '选中标注后滚轮调粗细 · 拖动端点改形 · 空格移动'; bar.append(hint);
    function repaint() {
      const state = session.getState();
      if (selectedId && !state.objects.some(object => object.id === selectedId) && !draft) selectedId = '';
      const objects = draft ? [...state.objects.filter(object => object.id !== draft.object.id), draft.object] : state.objects;
      overlay.render(objects, selectedId);
    }
    const unsubscribe = session.subscribe(state => { if (destroyed) return; undo.disabled = !state.canUndo; redo.disabled = !state.canRedo; save.disabled = state.saving || !state.dirty;
      save.title = state.error ? '重试保存标注' : '保存标注'; status.textContent = state.saving ? '正在保存…' : state.error ? `未保存：${state.error}` : state.dirty ? '尚未保存' : '已保存'; repaint(); });
    function finish(event, cancel = false) {
      if (!draft || (event?.pointerId !== undefined && event.pointerId !== draft.pointerId)) return;
      const previous = draft; draft = null;
      if (overlay.element.hasPointerCapture?.(previous.pointerId)) overlay.element.releasePointerCapture(previous.pointerId);
      if (!cancel) { selectedId = previous.object.id; session.commit([...session.getState().objects.filter(object => object.id !== previous.object.id), previous.object]); }
      else repaint();
    }
    add(overlay.element, 'pointerdown', event => {
      if (event.button !== 0 || space || tool === 'pan') return;
      event.preventDefault(); event.stopPropagation();
      if (tool === 'eraser') { const id = event.target.closest('[data-annotation-id]')?.dataset.annotationId;
        if (id) session.commit(session.getState().objects.filter(item => item.id !== id)); return; }
      const point = overlay.point(event); if (!point) return;
      const hit = event.target.closest('[data-annotation-id]')?.dataset.annotationId;
      const existing = session.getState().objects.find(object => object.id === hit);
      if (existing) {
        selectedId = hit; color = existing.color; colorInput.value = color; width = existing.width; widthInput.value = String(width);
        const handle = event.target.getAttribute('data-annotation-handle');
        draft = { object: existing, pointerId: event.pointerId, editing: true, origin: point,
          points: existing.points.map(point => point.slice()), handle: handle == null ? null : Number(handle) };
        overlay.element.setPointerCapture(event.pointerId); repaint(); return;
      }
      const object = { id: 'mark-' + win.crypto.randomUUID(), type: tool, color, width, points: tool === 'text' || tool === 'pen' ? [point] : [point, point] };
      if (tool === 'text') { if (!textInput.value.trim()) { textInput.focus(); return; } object.text = textInput.value; object.fontSize = 24;
        selectedId = object.id; session.commit([...session.getState().objects, object]); return; }
      draft = { object, pointerId: event.pointerId }; overlay.element.setPointerCapture(event.pointerId); repaint();
    });
    add(overlay.element, 'pointermove', event => { if (!draft || event.pointerId !== draft.pointerId) return; event.stopPropagation();
      if (!(event.buttons & 1)) { finish(event); return; } const point = overlay.point(event); if (!point) return;
      if (draft.editing) {
        if (draft.handle !== null) draft.object.points[draft.handle] = point;
        else {
          const xs = draft.points.map(p => p[0]), ys = draft.points.map(p => p[1]);
          const dx = Math.max(-Math.min(...xs), Math.min(1 - Math.max(...xs), point[0] - draft.origin[0]));
          const dy = Math.max(-Math.min(...ys), Math.min(1 - Math.max(...ys), point[1] - draft.origin[1]));
          draft.object.points = draft.points.map(p => [p[0] + dx, p[1] + dy]);
        }
      }
      else if (draft.object.type === 'pen') { if (draft.object.points.length < 4096) draft.object.points.push(point); }
      else draft.object.points[1] = point; repaint(); });
    add(overlay.element, 'pointerup', event => { if (draft) { event.stopPropagation(); finish(event); } });
    add(overlay.element, 'pointercancel', event => finish(event, true));
    add(overlay.element, 'lostpointercapture', event => finish(event, true));
    add(canvas, 'wheel', event => {
      if (!selected() || draft || space || tool === 'pan' || !overlay.element.contains(event.target)) return;
      event.preventDefault(); event.stopPropagation(); setWidth(width * Math.exp(-event.deltaY * .002));
    }, { passive: false, capture: true });
    add(win, 'blur', () => { space = false; finish(null, true); updateTool(); });
    add(doc, 'keydown', event => { if (!isVisible() || event.target.closest?.('input,textarea,[contenteditable="true"]')) return;
      if (event.code === 'Space' && !draft) { event.preventDefault(); space = true; updateTool(); }
      if (event.key === 'Escape') { finish(null, true); selectedId = ''; repaint(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? session.redo() : session.undo(); }
    });
    add(doc, 'keyup', event => { if (event.code === 'Space') { space = false; updateTool(); } });
    updateTool();
    return { refresh: overlay.refresh, getPreferences: () => ({ tool, color, width }),
      setPreferences(value) { if (!value) return; if (buttons.has(value.tool)) tool = value.tool;
        if (/^#[a-f0-9]{6}$/iu.test(value.color || '')) colorInput.value = color = value.color;
        width = Math.max(.25, Math.min(30, Number(value.width) || 3)); widthInput.value = String(width); updateTool(); },
      destroy() { destroyed = true; finish(null, true); unsubscribe();
      for (const [node, name, fn, options] of listeners) node.removeEventListener(name, fn, options); overlay.destroy(); bar.remove(); } };
  }
  return { figureAnnotationToolIcon, createFigureAnnotationOverlay, createFigureAnnotationEditor };
});
