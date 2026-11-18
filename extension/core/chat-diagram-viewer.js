(function (root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api;
  root.BrevessDiagramViewer = api;
})(globalThis, function () {
  'use strict';
  const PREFIX = 'brevess.diagramView.';
  function validateSource(source) {
    if (typeof source !== 'string' || !source.trim() || source.length > 20000 || /%%\s*\{|^\s*---/m.test(source)) {
      throw Error('示意图内容无效，请从问答中重新打开。');
    }
    return source;
  }
  function capture(source, title = '') {
    return { source: validateSource(source), title: String(title).slice(0, 500), createdAt: Date.now() };
  }
  async function open(source, { chromeApi = globalThis.chrome, screen = globalThis.screen, title = '回答中的示意图' } = {}) {
    const key = PREFIX + crypto.randomUUID();
    await chromeApi.storage.session.set({ [key]: capture(source, title) });
    try {
      // Explicit bounds also work on macOS, where maximized popup creation can yield a zero-width window.
      await chromeApi.windows.create({ url: chromeApi.runtime.getURL('diagram-viewer.html') + '#' + key.slice(PREFIX.length), type: 'popup',
        width: Math.min(1440, screen?.availWidth || 1440), height: Math.min(940, screen?.availHeight || 940), focused: true });
    } catch (error) { await chromeApi.storage.session.remove(key); throw error; }
  }
  async function consume(id, { storage = globalThis.chrome.storage.session, now = Date.now() } = {}) {
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(id)) throw Error('请从问答示意图旁的「展开查看」重新打开。');
    const key = PREFIX + id, value = (await storage.get(key))[key];
    await storage.remove(key);
    if (!value || !Number.isFinite(value.createdAt) || now - value.createdAt > 10 * 60 * 1000 || value.createdAt > now + 1000) throw Error('此示意图快照已过期，请从问答中重新打开。');
    return { source: validateSource(value.source), title: String(value.title || '回答中的示意图').slice(0, 500) };
  }
  function pngDimensions(width, height) {
    if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw Error('示意图尚未就绪。');
    const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16000000 / (width * height)));
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
  }
  async function renderPng(svg) {
    const box = svg?.viewBox?.baseVal;
    const size = pngDimensions(box?.width, box?.height);
    const doc = svg.ownerDocument, win = doc.defaultView;
    await doc.fonts?.ready;
    // Export the complete SVG, excluding the viewport's zoom and pan transform.
    const copy = svg.cloneNode(true);
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', String(size.width)); copy.setAttribute('height', String(size.height));
    copy.style.width = size.width + 'px'; copy.style.height = size.height + 'px'; copy.style.maxWidth = 'none';
    // Mermaid can include SVG foreignObject labels. A self-contained data image
    // keeps those labels exportable in Chromium; a blob URL taints the canvas.
    const image = new win.Image();
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new win.XMLSerializer().serializeToString(copy));
    await image.decode();
    const canvas = doc.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw Error('无法创建图片。');
    context.fillStyle = '#fff'; context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('图片生成失败。')), 'image/png'));
  }
  async function copyPng(svg, { clipboard = globalThis.navigator?.clipboard, ClipboardItem = globalThis.ClipboardItem, toPng = renderPng } = {}) {
    if (!clipboard?.write || !ClipboardItem) throw Error('当前浏览器不支持复制图片。');
    const png = toPng(svg);
    // Start clipboard.write during the click gesture, before asynchronous SVG decoding.
    png.catch(() => {});
    await clipboard.write([new ClipboardItem({ 'image/png': png })]);
  }
function create(source, options = {}) {
    const doc = options.document || globalThis.document;
    const createWorkspaceElement = options.createElement || ((tag, cls = '', text = '') => {
        const node = doc.createElement(tag); node.className = cls; node.textContent = text; return node;
    });
    const render = options.render || ((node) => globalThis.SciLLM?.renderMechanismDiagramInMeasurableHost(node, { mermaid: globalThis.mermaid }));
    const wrapper = createWorkspaceElement('section', 'article-chat-mermaid-block');
    const toolbar = createWorkspaceElement('div', 'article-chat-mermaid-toolbar');
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '示意图视野');
    const viewport = createWorkspaceElement('div', 'article-chat-mermaid-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', '回答中的示意图；滚轮缩放，拖动平移，方向键移动，加减键缩放，Home适应视野');
    viewport.title = '滚轮缩放 · 拖动平移 · Home 适应视野';
    const diagram = createWorkspaceElement('div', 'article-chat-mermaid');
    diagram.textContent = source;
    const disclosure = createWorkspaceElement('details', 'article-chat-mermaid-source');
    const pre = createWorkspaceElement('pre');
    const code = createWorkspaceElement('code');
    code.textContent = source;
    pre.appendChild(code);
    disclosure.append(createWorkspaceElement('summary', '', '图形源码'), pre);
    const zoomLabel = createWorkspaceElement('output', 'article-chat-mermaid-zoom', '100%');
    zoomLabel.setAttribute('aria-label', '缩放比例');
    let svg = null, naturalWidth = 1, naturalHeight = 1, scale = 1, x = 0, y = 0, frame = 0, drag = null;
    function paint() {
        frame = 0;
        if (!svg) return;
        diagram.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')';
        zoomLabel.value = Math.round(scale * 100) + '%';
        zoomLabel.textContent = zoomLabel.value;
    }
    function schedulePaint() { if (!frame) frame = requestAnimationFrame(paint); }
    function zoom(next, atX = viewport.clientWidth / 2, atY = viewport.clientHeight / 2) {
        if (!svg) return;
        next = Math.max(.02, Math.min(6, next));
        x = atX - (atX - x) * next / scale;
        y = atY - (atY - y) * next / scale;
        scale = next;
        schedulePaint();
    }
    function reset(fit) {
        if (!svg) return;
        const width = Math.max(32, viewport.clientWidth - 24), height = Math.max(32, viewport.clientHeight - 24);
        scale = fit ? Math.max(.02, Math.min(1, width / naturalWidth, height / naturalHeight)) : 1;
        x = naturalWidth * scale <= width ? (viewport.clientWidth - naturalWidth * scale) / 2 : 12;
        y = naturalHeight * scale <= height ? (viewport.clientHeight - naturalHeight * scale) / 2 : 12;
        schedulePaint();
    }
    function button(text, label, action) {
        const control = createWorkspaceElement('button', '', text);
        control.type = 'button'; control.title = label; control.setAttribute('aria-label', label);
        control.disabled = true; control.addEventListener('click', action); return control;
    }
    toolbar.append(button('−', '缩小示意图', () => zoom(scale / 1.25)), zoomLabel,
        button('+', '放大示意图', () => zoom(scale * 1.25)),
        button('适应', '适应视野', () => reset(true)),
        button('1:1', '原始大小', () => reset(false)));
    const copyImage = button('复制图片', '复制示意图为图片', async () => {
        copyImage.disabled = true;
        status.textContent = '正在复制图片…';
        try { await copyPng(svg); status.textContent = '已复制图片，可直接粘贴。'; }
        catch (error) {
            console.warn('[BREVESS] Diagram image copy failed:', error);
            status.textContent = '复制图片失败，请在当前窗口中重试。';
        }
        finally { copyImage.disabled = false; }
    });
    copyImage.className = 'article-chat-mermaid-copy';
    copyImage.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4H4v16h13v-3"/><rect x="8" y="3" width="13" height="14" rx="2"/><circle cx="12" cy="7" r="1"/><path d="m9 14 4-4 3 3 2-2 3 3"/></svg>';
    toolbar.append(copyImage);
    if (options.expand !== false) {
        const expand = button('展开', '展开查看示意图', async () => {
            expand.disabled = true;
            try { await (options.open || open)(source, { title: doc.querySelector('#sidePanelPaperTitle')?.textContent || '回答中的示意图' }); }
            catch { status.textContent = '暂时无法打开大窗，请重试。'; }
            finally { expand.disabled = false; }
        });
        expand.className = 'article-chat-mermaid-expand';
        expand.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M9 9L3 3m12 6l6-6M9 15l-6 6m12-6l6 6"/></svg>';
        toolbar.append(expand);
    }
    const status = createWorkspaceElement('p', 'article-chat-mermaid-status');
    status.setAttribute('role', 'status');
    viewport.appendChild(diagram); wrapper.append(toolbar, viewport, status, disclosure);
    viewport.addEventListener('wheel', event => {
        if (!svg) return;
        event.preventDefault(); event.stopPropagation();
        const rect = viewport.getBoundingClientRect();
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
        zoom(scale * Math.exp(-Math.max(-500, Math.min(500, delta)) * .002), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    viewport.addEventListener('pointerdown', event => {
        if (!svg || event.button !== 0 || event.isPrimary === false) return;
        event.preventDefault(); viewport.focus({ preventScroll: true });
        drag = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, x, y };
        viewport.setPointerCapture(event.pointerId); viewport.classList.add('is-dragging');
    });
    viewport.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.id) return;
        x = drag.x + event.clientX - drag.clientX; y = drag.y + event.clientY - drag.clientY; schedulePaint();
    });
    function endDrag(event) {
        if (!drag || event.pointerId !== drag.id) return;
        drag = null; viewport.classList.remove('is-dragging');
        if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    }
    viewport.addEventListener('pointerup', endDrag); viewport.addEventListener('pointercancel', endDrag);
    viewport.addEventListener('lostpointercapture', endDrag);
    viewport.addEventListener('keydown', event => {
        if (!svg || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === '+' || event.key === '=') zoom(scale * 1.25);
        else if (event.key === '-') zoom(scale / 1.25);
        else if (event.key === 'Home') reset(true);
        else if (event.key === '0') reset(false);
        else if (event.key === 'ArrowLeft') { x += 40; schedulePaint(); }
        else if (event.key === 'ArrowRight') { x -= 40; schedulePaint(); }
        else if (event.key === 'ArrowUp') { y += 40; schedulePaint(); }
        else if (event.key === 'ArrowDown') { y -= 40; schedulePaint(); }
        else return;
        event.preventDefault(); event.stopPropagation();
    });
    // Keep the bundled strict renderer and unmodified source; never apply model configuration.
    wrapper.ready = Promise.resolve().then(async () => {
        validateSource(source);
        const rendered = await render(diagram);
        if (!rendered || diagram.querySelector('.error-icon, .error-text')) throw new Error('INVALID_DIAGRAM');
        if (!diagram.isConnected) return;
        diagram.querySelectorAll('a').forEach(link => {
            link.removeAttribute('href'); link.removeAttribute('xlink:href');
        });
        svg = diagram.querySelector('svg');
        const box = svg?.viewBox?.baseVal;
        if (!box || !(box.width > 0 && box.height > 0)) throw new Error('INVALID_DIAGRAM');
        naturalWidth = box.width; naturalHeight = box.height;
        svg.style.width = naturalWidth + 'px'; svg.style.height = naturalHeight + 'px'; svg.style.maxWidth = 'none';
        diagram.style.width = naturalWidth + 'px'; diagram.style.height = naturalHeight + 'px';
        toolbar.querySelectorAll('button').forEach(control => { control.disabled = false; });
        reset(options.fit === true);
        return true;
    }).catch(() => {
        if (frame) cancelAnimationFrame(frame);
        toolbar.remove(); viewport.remove();
        disclosure.open = true;
        wrapper.prepend(createWorkspaceElement('p', 'article-chat-mermaid-error', '示意图暂无法渲染，已保留原始代码。'));
        return false;
    });
    wrapper.fit = () => reset(true);
    return wrapper;
}

  return { PREFIX, validateSource, capture, open, consume, pngDimensions, renderPng, copyPng, create };
});
