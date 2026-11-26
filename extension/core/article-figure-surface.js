/* These surfaces live in the article's viewport, beside the native side panel. */
(() => {
  if (globalThis.BrevessArticleFigures) return;
  let preview, gallery, closeTimer;
  const page = () => location.href.split('#')[0];
  function surface(tag, css, html) {
    const host = document.createElement('div');
    host.dataset.sciPluginUi = 'true';
    host.setAttribute('data-brevess-figure-surface', tag);
    const shadow = host.attachShadow({ mode: 'closed' }),
      sheet = new CSSStyleSheet();
    sheet.replaceSync(
      ':host{all:initial}*{box-sizing:border-box}[hidden]{display:none!important}button,select,input{font:inherit;color:inherit}button,select{cursor:pointer}button{background:transparent;border:0;border-radius:5px;padding:6px 9px}button:hover{background:var(--bv-hover,#ededed)}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--bv-focus,#286aa1)}button:disabled{opacity:.4}' +
        css + ' [data-close]{color:var(--bv-text,#202020);background:transparent;border:0;font:18px/1 system-ui;padding:4px;width:26px;height:26px} [data-close]:hover{color:var(--bv-red,#bd2927);background:transparent} footer form button[type="submit"]{order:1;margin-left:auto}'
    );
    shadow.adoptedStyleSheets = [sheet];
    const template = document.createElement('template');
    template.innerHTML = html;
    shadow.append(template.content.cloneNode(true));
    document.documentElement.append(host);
    return { host, root: shadow, el: (selector) => shadow.querySelector(selector) };
  }
  const base = 'color-scheme:light dark;font:14px/1.45 system-ui,sans-serif;color:var(--bv-text,#202124);background:var(--bv-surface,white);';
  function hidePreview(token, soft = false) {
    if (!preview || (token && preview.token !== token)) return;
    clearTimeout(closeTimer);
    if (soft && (preview.hovered || preview.focused || preview.dragging)) return;
    const old = preview;
    if (soft) {
      closeTimer = setTimeout(() => hidePreview(old.token), 300);
      return;
    }
    preview = null;
    old.dispose?.();
    old.host.remove();
  }
  async function showPreview({ token, figureId, label, anchor = 0.5, size }, reader, onAction, canReview) {
    hidePreview();
    const v = surface(
      'preview',
      `aside{${base}position:fixed;inset:auto 8px auto auto;margin:0;padding:10px;max-width:calc(100vw - 16px);width:min(440px,53vw);max-height:90vh;overflow:auto;border:1px solid var(--bv-line,#d5d7d9);border-radius:10px;box-shadow:0 6px 22px #0002}strong{font-size:14px}p{margin:6px 0;font-size:12px;max-height:6em;overflow:auto}section{display:grid;gap:4px}img{display:block;width:100%;max-height:53vh;object-fit:contain}aside:popover-open{display:flex;flex-direction:column}
        aside[data-sized] section{flex:1;min-height:0;grid-auto-rows:minmax(0,1fr)}
        aside[data-sized] img{height:100%;max-height:none;min-height:0}
        strong,p,footer{flex:none}footer{display:flex;align-items:center;justify-content:flex-end}
        [data-resize]{margin-right:auto;width:24px;height:24px;padding:4px;touch-action:none;user-select:none;cursor:nesw-resize;color:var(--bv-muted,#555);flex:none}
        [data-resize] svg{display:block;pointer-events:none}`,
      '<aside popover="manual" aria-label="图像预览"><strong></strong><section></section><p role="status">正在读取原图…</p><footer><button type="button" data-resize aria-label="调整预览大小" title="拖动调整预览大小"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m3 7 6 6M3 11l2 2M4 3l9 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button><button data-ask>带图提问</button><button data-review>核对原图</button></footer></aside>'
    );
    Object.assign(v, { token, owner: page() });
    preview = v;
    const card = v.el('aside'),
      caption = v.el('p'),
      ask = v.el('[data-ask]'),
      review = v.el('[data-review]');
    const grip = v.el('[data-resize]');
    let preferred = size && Number.isFinite(size.width) && Number.isFinite(size.height) ? size : null;
    let drag = null;
    const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
    const fit = (width, height) => ({
      width: Math.round(clamp(width, 190, Math.max(1, innerWidth - 16))),
      height: Math.round(clamp(height, 150, Math.max(1, innerHeight - 12)))
    });
    function place() {
      if (preview !== v) return;
      if (preferred) {
        const fitted = fit(preferred.width, preferred.height);
        card.dataset.sized = '';
        card.style.width = fitted.width + 'px';
        card.style.height = fitted.height + 'px';
        card.style.maxHeight = 'calc(100vh - 12px)';
      } else {
        delete card.dataset.sized;
        card.style.width = card.style.height = card.style.maxHeight = '';
      }
      const top = drag ? drag.top : anchor * innerHeight - card.offsetHeight / 2;
      card.style.top = clamp(top, 6, innerHeight - card.offsetHeight - 6) + 'px';
    }
    function commit() {
      if (preferred) onAction('resize', preferred);
    }
    grip.onpointerdown = e => {
      if (e.button !== 0 || !e.isPrimary || drag) return;
      e.preventDefault();
      clearTimeout(closeTimer);
      const rect = card.getBoundingClientRect();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, top: rect.top,
        width: rect.width, height: rect.height, previous: preferred, moved: false };
      v.dragging = true;
      grip.setPointerCapture(e.pointerId);
    };
    grip.onpointermove = e => {
      if (drag?.id !== e.pointerId) return;
      const dx = drag.x - e.clientX, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      drag.moved = true;
      preferred = fit(drag.width + dx, drag.height + dy);
      place();
    };
    function endDrag(e) {
      if (drag?.id !== e.pointerId) return;
      if (e.type !== 'pointerup') preferred = drag.previous;
      else if (drag.moved) commit();
      drag = null;
      v.dragging = false;
      if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
      place();
      if (!card.matches(':hover') && !v.focused) hidePreview(token, true);
    }
    grip.onpointerup = grip.onpointercancel = grip.onlostpointercapture = endDrag;
    grip.onkeydown = e => {
      const delta = { ArrowLeft: [16,0], ArrowRight: [-16,0], ArrowDown: [0,16], ArrowUp: [0,-16] }[e.key];
      if (!delta) return;
      e.preventDefault();
      preferred = fit(card.offsetWidth + delta[0], card.offsetHeight + delta[1]);
      place();
      commit();
    };
    addEventListener('resize', place);
    v.dispose = () => removeEventListener('resize', place);
    card.showPopover();
    v.el('strong').textContent = [figureId, label].filter(Boolean).join(' · ');
    place();
    card.onpointerenter = () => {
      v.hovered = true;
      clearTimeout(closeTimer);
    };
    card.onpointerleave = () => {
      v.hovered = false;
      hidePreview(token, true);
    };
    card.onfocusin = () => {
      v.focused = true;
      clearTimeout(closeTimer);
    };
    card.onfocusout = (e) => {
      v.focused = card.contains(e.relatedTarget);
      if (!v.focused) hidePreview(token, true);
    };
    card.onkeydown = (e) => {
      if (e.key === 'Escape') hidePreview(token);
    };
    ask.hidden = !label;
    ask.disabled = true;
    review.hidden = !canReview;
    review.onclick = () => {
      onAction('review');
      hidePreview(token);
    };
    ask.onclick = () => {
      onAction('ask');
      hidePreview(token);
    };
    try {
      const data = label ? await reader.picture(figureId, label, 780) : await reader.preview(figureId, 920);
      if (preview !== v || v.owner !== page()) return;
      v.el('strong').textContent = [data.name, label, data.page && '第 ' + data.page + ' 页']
        .filter(Boolean)
        .join(' · ');
      caption.textContent = [data.caption || data.legend, data.needsReview && '建议核对边界']
        .filter(Boolean)
        .join(' · ');
      const images = label ? [data] : data.images;
      v.el('section').style.gridTemplateColumns =
        'repeat(' + Math.ceil(Math.sqrt(images.length)) + ',minmax(0,1fr))';
      for (const item of images) {
        const img = document.createElement('img');
        img.decoding = 'async';
        img.alt = [data.name, item.label].filter(Boolean).join(' ');
        const current = () => preview === v && v.owner === page() && img.isConnected;
        img.onload = place;
        img.onerror = async () => {
          if (!current()) return;
          img.onerror = null;
          const original = !label && !item.original && images.length === 1 &&
            await reader.fallbackPreviewOriginal?.(figureId).catch(() => null);
          if (!current()) return;
          if (original) img.src = original.dataUrl;
          else { img.remove(); caption.textContent = '预览图片未能加载'; }
        };
        img.src = item.dataUrl;
        v.el('section').append(img);
        if (!label && !item.original && images.length === 1) {
          reader.restorePreviewOriginal?.(figureId).then(async original => {
            if (!original || !current() || img.src === original.dataUrl) return;
            const decoded = new Image();
            decoded.src = original.dataUrl;
            await decoded.decode();
            if (current()) img.src = original.dataUrl;
          }).catch(() => {});
        }
      }
      ask.disabled = false;
      place();
    } catch (e) {
      if (preview === v) {
        caption.textContent = e.message;
        place();
      }
    }
  }
  async function openGallery({ figureId, label }, reader, onAsk) {
    hidePreview();
    gallery?.close();
    const v = surface(
      'gallery',
      `
      dialog{${base}inset:0;position:fixed;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;padding:0;border:0;display:flex;flex-direction:column}
      header,footer,nav{display:flex;align-items:center;gap:6px;padding:8px 12px;flex-wrap:wrap}
      header{border-bottom:1px solid var(--bv-line,#ddd)}header strong{white-space:nowrap}header select{max-width:min(34vw,200px);margin-left:auto}
      main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) clamp(140px,22%,260px)}
      [data-stage]{position:relative;overflow:hidden;background:var(--bv-canvas,#eff0f1);touch-action:none;cursor:grab}
      [data-stage].drawing{cursor:crosshair}[data-surface]{position:absolute;top:0;left:0;aspect-ratio:1;transform-origin:0 0}
      [data-original]{display:block;width:100%;height:100%;user-select:none;pointer-events:none}
      [data-region]{position:absolute;border:2px solid #2470a8;box-shadow:0 0 0 1px #fff7;pointer-events:none}
      [data-region] i{position:absolute;background:repeating-linear-gradient(135deg,#bb34444a 0 2px,#fff8 2px 6px);outline:1px solid #a83747}
      [data-gesture]{position:absolute;pointer-events:none;border:2px dashed #17649f;background:#2277a922}
      [data-gesture].cut{border-color:#a83747;background:#bb344432}
      aside{overflow:auto;padding:8px;border-left:1px solid var(--bv-line,#ddd)}aside button{width:100%;display:grid;gap:3px;text-align:left;margin-bottom:6px;border:1px solid var(--bv-line,#ddd)}
      aside button[aria-pressed=true]{outline:2px solid var(--bv-focus,#303235);outline-offset:-2px}aside img{width:100%;height:76px;object-fit:contain}
      footer{border-top:1px solid var(--bv-line,#ddd)}footer p{margin:0;flex:1;min-width:9em;font-size:12px}nav{padding:0;gap:2px;flex-wrap:nowrap}header{gap:clamp(3px,1vw,14px)}@media(max-width:420px){header{padding:5px;gap:3px}header button{padding-inline:3px}header select{max-width:24vw}}nav output{min-width:3em;text-align:center}
      @media(max-width:520px){main{grid-template-columns:minmax(0,1fr) 83px}aside img{height:44px}}
    `,
      '<dialog aria-label="核对 Figure 与 Panel 图像"><header><strong>核对图像</strong><nav aria-label="图像缩放"><button data-zoom="fit">适应</button><button data-zoom="actual">1:1</button><button data-zoom="out" aria-label="缩小">−</button><output></output><button data-zoom="in" aria-label="放大">＋</button></nav><select aria-label="选择 Figure 原图"></select><button data-close aria-label="关闭">✕</button></header><main><div data-stage><div data-surface><canvas data-original role="img" aria-label="Figure 原图"></canvas><span data-region hidden></span><span data-gesture hidden></span></div><i class="eraser-ring" hidden></i></div><aside aria-label="Panel 裁片"></aside></main><footer><p role="status"></p><div data-actions><button data-draw>校正边界</button><button data-add>补选 Panel</button><button data-download>下载裁片</button><button data-ask>带图提问</button></div><form hidden><label>Panel <input size="2" maxlength="1" pattern="[A-Za-z]" required></label><button type="button" data-undo>撤回框选</button><button type="submit">保存</button><button type="button" data-cancel>取消</button></form></footer></dialog>'
    );
    const dialog = v.el('dialog'),
      stage = v.el('[data-stage]'),
      region = v.el('[data-region]'),
      image = v.el('[data-original]'),
      figures = v.el('select'),
      tiles = v.el('aside'),
      status = v.el('p'),
      form = v.el('form');
    const owner = page();
    let serial = 0,
      items = [],
      model,
      selected,
      drawing = false,
      drag,
      draft, firstInclude, preserveMask, history = [], wheelFrame = 0, wheelDelta = 0, wheelPointer;
    const gesture = v.el('[data-gesture]'), undo = v.el('[data-undo]');
    const geometry = SciLLM.PdfPanelEvidence;
    const active = (n) => dialog.open && owner === page() && n === serial;
    gallery = dialog;
    dialog.showModal();
    if (!onAsk) v.el('[data-ask]').hidden=true;
    const controls = v.el('nav');
    controls.style.visibility = 'hidden';
    const viewport = panelViewport(stage, v.el('[data-surface]'), v.el('output'));
    function placeRect(element, rect) {
      element.hidden = !rect;
      if (rect) Object.assign(element.style,{left:rect.x*100+'%',top:rect.y*100+'%',width:rect.width*100+'%',height:rect.height*100+'%'});
    }
    function outline(rect, cuts = []) {
      placeRect(region,rect);
      region.replaceChildren();
      for (const cut of cuts) {
        const hatch=document.createElement('i');
        placeRect(hatch,cut); region.append(hatch);
      }
    }
    function redraw() {
      outline(draft?.rect,draft?.cuts);
      undo.disabled = !history.length;
      v.el('[type=submit]').disabled = !draft;
      gesture.hidden = true;
    }
    undo.onclick = () => {
      if (history.length) ({draft,firstInclude,preserveMask}=history.pop());
      redraw();
    };
    function select(name) {
      selected = model?.panels.find((p) => p.label === name);
      outline(selected?.rect,selected?.cuts);
      for (const b of tiles.children) b.setAttribute('aria-pressed', String(b.dataset.label === name));
      for (const b of v.root.querySelectorAll('[data-draw],[data-download],[data-ask]'))
        b.disabled = !selected;
      v.el('[data-add]').disabled = !model;
      status.textContent = selected
        ? [selected.label, selected.caption, selected.needsReview ? '建议核对边界' : '']
            .filter(Boolean)
            .join(' · ')
        : model
          ? '可在原图上补选 Panel'
          : '';
    }
    function edit(mode) {
      drawing = !!mode;
      form.hidden = !drawing;
      v.el('[data-actions]').hidden = drawing;
      stage.classList.toggle('drawing', drawing);
      drag = null;
      draft = null;
      history = []; firstInclude = true; preserveMask = false; gesture.hidden = true;
      if (!mode) {
        select(selected?.label);
        return;
      }
      const field = form.querySelector('input');
      field.value =
        mode === 'add'
          ? model.expected.find((l) => !model.panels.some((p) => p.label === l)) || ''
          : selected.label;
      field.readOnly = mode !== 'add';
      if (mode === 'draw' && selected) {
        draft = {rect:selected.rect,cuts:selected.cuts || []}; preserveMask = true;
      }
      redraw();
      status.textContent = '拖动框选 Panel，可继续框选纳入。按住 Ctrl 或 Option 拖动剪除。';
      if (!field.readOnly) field.focus();
    }
    function render(data, preferred, reset) {
      model = data;
      tiles.replaceChildren();
      if (reset) viewport.layout([0, 0, data.width, data.height], 'fit');
      controls.style.visibility = 'visible';
      for (const p of data.panels) {
        const button = document.createElement('button'),
          thumb = document.createElement('img');
        button.dataset.label = p.label;
        thumb.src = p.thumb;
        thumb.alt = '';
        button.append(thumb, 'Panel ' + p.label);
        button.onclick = () => {
          edit(false);
          select(p.label);
        };
        tiles.append(button);
      }
      edit(false);
      select(preferred || data.panels[0]?.label);
    }
    async function load(preferred) {
      const n = ++serial,
        item = items[Number(figures.value)];
      model = null;
      controls.style.visibility = 'hidden';
      edit(false);
      tiles.replaceChildren();
      image.width = image.height = 1;
      status.textContent = '正在读取并识别原图…';
      try {
        const data = await reader.inspect(item.figureId, item.index);
        if (active(n)) {
          render(data, preferred, true);
          await reader.drawOriginal(item.figureId, item.index, image, () => active(n));
        }
      } catch (e) {
        if (active(n)) status.textContent = e.message;
      }
    }
    figures.onchange = () => load();
    v.el('[data-close]').onclick = () => dialog.close();
    v.el('[data-draw]').onclick = () => edit('draw');
    v.el('[data-add]').onclick = () => edit('add');
    v.el('[data-cancel]').onclick = () => edit(false);
    for (const b of v.root.querySelectorAll('[data-zoom]'))
      b.onclick = () => viewport.zoom({ in: 1.25, out: 0.8 }[b.dataset.zoom] || b.dataset.zoom);
    stage.onwheel = (e) => {
      e.preventDefault();
      if (!model || !e.deltaY) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientHeight : 1;
      wheelDelta = Math.max(-90,Math.min(90,wheelDelta + e.deltaY*unit));
      wheelPointer = {clientX:e.clientX,clientY:e.clientY};
      if (!wheelFrame) wheelFrame = requestAnimationFrame(() => {
        wheelFrame = 0;
        viewport.zoom(Math.exp(-wheelDelta*.0011),wheelPointer);
        wheelDelta = 0;
      });
    };
    function point(e) {
      const [x, y] = viewport.point(e);
      const clamp = (n) => Math.max(0, Math.min(1, n));
      return { x: clamp(x / model.width), y: clamp(y / model.height) };
    }
    stage.onpointerdown = (e) => {
      if (e.button !== 0 || !model || (drawing && !viewport.hit(e))) return;
      stage.setPointerCapture(e.pointerId);
      drag = {point:point(e), x:e.clientX, y:e.clientY, id:e.pointerId, cut:e.ctrlKey || e.altKey};
      gesture.classList.toggle('cut',drag.cut);
    };
    stage.onpointermove = (e) => {
      if (!drag || e.pointerId!==drag.id) return;
      if (!drawing) {
        viewport.pan(e.clientX - drag.x, e.clientY - drag.y);
        drag.x = e.clientX;
        drag.y = e.clientY;
        return;
      }
      const a = drag.point,
        b = point(e);
      drag.rect = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x),
        height: Math.abs(a.y - b.y)
      };
      placeRect(gesture,drag.rect);
    };
    stage.onpointerup = (e) => {
      if (!drag || e.pointerId!==drag.id) return;
      stage.onpointermove(e);
      if (drawing && drag.rect && drag.rect.width*model.width>=2 && drag.rect.height*model.height>=2) {
        try {
          const next = geometry.editRegion(!drag.cut && firstInclude ? null : draft, drag.rect, drag.cut);
          if (next && next!==draft) {
            history.push({draft,firstInclude,preserveMask});
            if (!drag.cut) preserveMask=false;
            firstInclude=false; draft=next;
          } else if (!draft) status.textContent='请先框选需要保留的 Panel。';
        } catch (err) { status.textContent=err.message; }
        redraw();
      }
      gesture.hidden=true;
      drag = null;
    };
    stage.onpointercancel = () => {
      gesture.hidden=true; drag = null;
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const n = serial,
        l = form.querySelector('input').value.toUpperCase(),
        save = form.querySelector('[type="submit"]');
      if (!model || !draft || draft.rect.width * model.width < 4 || draft.rect.height * model.height < 4) {
        status.textContent = '请先框选 Panel。';
        return;
      }
      save.disabled = true;
      try {
        const data = await reader.inspect(model.figureId, model.index, {
          label: l,
          rect:draft.rect, cuts:draft.cuts, preserveMask,
          fingerprint: model.fingerprint
        });
        if (active(n)) render(data, l, false);
      } catch (err) {
        if (active(n)) status.textContent = err.message;
      } finally {
        save.disabled = false;
      }
    };
    v.el('[data-ask]').onclick = () => {
      if (selected) {
        onAsk(model.figureId, selected.label, model.index);
        dialog.close();
      }
    };
    v.el('[data-download]').onclick = async () => {
      const n = serial,
        l = selected?.label;
      if (!l) return;
      try {
        const p = await reader.picture(model.figureId, l, 2400, model.index);
        if (!active(n) || selected?.label !== l) return;
        const a = document.createElement('a');
        a.download = model.figureId + '-' + l + (/jpeg/.test(p.mediaType) ? '.jpg' : '.png');
        a.href = p.dataUrl;
        a.click();
      } catch (e) {
        if (active(n)) status.textContent = e.message;
      }
    };
    dialog.addEventListener(
      'close',
      () => {
        serial++;
        cancelAnimationFrame(wheelFrame);
        viewport.dispose();
        image.width = image.height = 1;
        v.host.remove();
        if (gallery === dialog) gallery = null;
      },
      { once: true }
    );
    status.textContent = '正在读取原图目录…';
    try { items = await reader.list(figureId); }
    catch (error) { if (active(0)) status.textContent=error.message; return; }
    if (!active(0)) return;
    if (!items.length) {
      status.textContent = '没有可核对的原图。';
      return;
    }
    for (const [i, item] of items.entries()) figures.add(new Option(item.name, String(i)));
    figures.value = String(
      Math.max(
        0,
        items.findIndex((i) => i.figureId === figureId && (!i.direct || i.direct === label))
      )
    );
    void load(label);
  }
  addEventListener('pagehide', () => {
    hidePreview();
    gallery?.close();
  });
  globalThis.BrevessArticleFigures = { showPreview, hidePreview, openGallery };
})();
