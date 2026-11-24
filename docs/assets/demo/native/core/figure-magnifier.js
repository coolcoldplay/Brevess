(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(globalThis, function () {
  'use strict';
  const FIGURE = 'figure,[role="figure"],.figure,.fig,.figure-wrap,.figure-container,.article-figure,.fig-inline-img-set,.c-article-section__figure';
  const railImages = new WeakSet();
  const eligibleFigureBox = (image, box) => box.width >= (railImages.has(image) ? 1 : 100) && box.height >= (railImages.has(image) ? 36 : 60);
  function figureImageAtPoint(doc, x, y, hit = doc.elementFromPoint?.(x, y)) {
    if (hit?.tagName === 'IMG') return hit;
    if (!hit || hit.closest?.('[data-sci-plugin-ui],[data-brevess-magnifier],#sci-logic-panel,#sci-article-navigator')) return null;
    const figure = hit.closest?.(FIGURE);
    if (!figure) return null;
    // Publishers may stretch a full-size link's pseudo-element across a Figure.
    // Resolve only an image actually hit beneath that same Figure's overlay;
    // never search through an unrelated modal or change the page's click target.
    const control = hit.closest?.('button,input,select,textarea,[role="button"],[contenteditable="true"]');
    if (control) return null;
    for (const image of doc.elementsFromPoint?.(x, y) || []) {
      if (image.tagName !== 'IMG' || image.closest(FIGURE) !== figure) continue;
      const box = image.getBoundingClientRect();
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return image;
    }
    return null;
  }
  function figureImageGeometry(box, naturalWidth, naturalHeight, fit = 'fill', position = '50% 50%') {
    if (![box.width, box.height, naturalWidth, naturalHeight].every(n => Number.isFinite(n) && n > 0)) return null;
    let width = box.width, height = box.height;
    if (fit !== 'fill') {
      let scale = fit === 'cover' ? Math.max(width / naturalWidth, height / naturalHeight)
        : fit === 'none' ? 1 : Math.min(width / naturalWidth, height / naturalHeight);
      if (fit === 'scale-down') scale = Math.min(1, scale);
      width = naturalWidth * scale; height = naturalHeight * scale;
    }
    const parts = String(position).trim().split(/\s+/);
    const offset = (value, free) => {
      if (value === 'left' || value === 'top') return 0;
      if (value === 'right' || value === 'bottom') return free;
      if (value === 'center' || !value) return free / 2;
      if (/^-?[\d.]+%$/.test(value)) return free * parseFloat(value) / 100;
      if (/^-?[\d.]+px$/.test(value)) return parseFloat(value);
      return free / 2;
    };
    return { left: box.left + offset(parts[0], box.width - width),
      top: box.top + offset(parts[1], box.height - height), width, height };
  }
  function figureMagnifierDisplaySource(image, css, promoted) {
    const display = promoted?.display;
    if (display?.source && display.width > 0 && display.height > 0) return { ...display };
    return { source: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight,
      fit: css.objectFit, position: css.objectPosition };
  }
  function createFigureMagnifier({ document: doc = globalThis.document, isActive = () => false,
    getDisplaySource = () => null, acceptImage } = {}) {
    const win = doc.defaultView;
    let host, picture, label, frame = 0, pointer, current, dismissed, destroyed = false;
    let zoom = 2.5, diameterPreference = 200, changed = false, cursor = null, saveTimer = 0;
    const preferenceKey = 'sciFigureMagnifierPreferencesV1';
    const clamp = (n, lo, hi, fallback) => Number.isFinite(n) ? Math.max(lo, Math.min(hi,n)) : fallback;
    const storage = globalThis.SciLLM?.publicPageStorage || globalThis.chrome?.storage?.local;
    Promise.resolve(storage?.get(preferenceKey)).then(saved => { if (changed || destroyed) return; const value=saved?.[preferenceKey]; zoom=clamp(value?.zoom,1.25,8,2.5); diameterPreference=clamp(value?.diameter,100,500,200); if(pointer) paint(); }).catch(()=>{});
    function restoreCursor() { if(cursor) { const {image,value,priority}=cursor; if(image.style.getPropertyValue('cursor')==='none' && image.style.getPropertyPriority('cursor')==='important') { if(value) image.style.setProperty('cursor',value,priority); else image.style.removeProperty('cursor'); } cursor=null; } }
    function savePreferences() { win.clearTimeout(saveTimer); saveTimer=win.setTimeout(()=>{saveTimer=0;Promise.resolve(storage?.set({[preferenceKey]:{zoom,diameter:diameterPreference}})).catch(()=>{if(label)label.textContent='设置保存失败';});},60); }
    function wheel(event) {
      if(!active() || !current || !host || host.hidden || (!event.ctrlKey&&!event.shiftKey) || globalThis.BrevessInputTools?.isEditingEvent(event))return;
      if(figureImageAtPoint(doc,event.clientX,event.clientY)!==current)return;
      event.preventDefault(); event.stopPropagation(); changed=true;
      if(event.ctrlKey) zoom=clamp(Math.round((zoom+(event.deltaY<0?.25:-.25))*100)/100,1.25,8,2.5);
      else diameterPreference=clamp(diameterPreference+(event.deltaY<0?20:-20),100,500,200);
      paint();savePreferences();
    }
    doc.addEventListener('wheel',wheel,{capture:true,passive:false});
    const hide = () => { restoreCursor(); if (host) { host.hidden = true; host.style.setProperty('display','none','important'); } if(frame) win.cancelAnimationFrame(frame); frame=0; pointer=null; current = null; };
    const active = () => { try { return !destroyed && isActive(); } catch { return false; } };
    function target(element) {
      if (element?.tagName !== 'IMG' || !element.complete || !element.naturalWidth ||
          element.closest('[data-brevess-magnifier],#sci-logic-panel,#sci-article-navigator')) return null;
      const box = element.getBoundingClientRect();
      if (!eligibleFigureBox(element, box) || !element.currentSrc) return null;
      if (acceptImage ? !acceptImage(element) : !element.closest(FIGURE) && !/^(?:figure|fig\.?|extended data fig|supplementary fig)\s*\d/i.test(element.alt || '')) return null;
      return { image: element, box };
    }
    function ensure() {
      if (host?.isConnected) return;
      host = doc.createElement('div');
      host.dataset.brevessMagnifier = 'true';
      host.setAttribute('aria-hidden', 'true');
      // All visual content is isolated from publisher CSS. The lens never intercepts input.
      host.style.cssText = 'all:initial!important;position:fixed!important;left:0!important;top:0!important;z-index:2147483646!important;pointer-events:none!important;display:none!important;will-change:transform!important;';
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = doc.createElement('style');
      style.textContent = ':host([hidden]){display:none!important}.lens{box-sizing:border-box;width:200px;height:200px;border:2px solid #566775;border-radius:50%;overflow:hidden;position:relative;background:white;box-shadow:0 3px 16px #0005;pointer-events:none}.lens img{position:absolute;left:0;top:0;max-width:none;max-height:none;margin:0;padding:0;border:0;object-fit:fill;pointer-events:none;will-change:transform}.label{position:absolute;bottom:8px;left:0;right:0;text-align:center;font:11px/18px system-ui;color:white;text-shadow:0 1px 3px black;pointer-events:none}';
      const lens = doc.createElement('div'); lens.className = 'lens';
      picture = doc.createElement('img'); picture.alt = ''; picture.draggable = false;
      picture.addEventListener('error', hide);
      label = doc.createElement('span'); label.className = 'label'; label.textContent = '2.5×';
      const cross=doc.createElement('span');cross.style.cssText='position:absolute;left:50%;top:50%;width:9px;height:9px;transform:translate(-50%,-50%);background:linear-gradient(#222,#222) center/1px 9px no-repeat,linear-gradient(#222,#222) center/9px 1px no-repeat;filter:drop-shadow(0 0 1px white)';lens.append(picture,cross,label); shadow.append(style, lens);
      doc.documentElement.append(host);
    }
    function paint() {
      frame = 0;
      if (!pointer || !active() || pointer.buttons || doc.hidden) return hide();
      const hit = target(figureImageAtPoint(doc, pointer.x, pointer.y));
      if (!hit) { dismissed = null; return hide(); }
      const { image, box } = hit;
      if (image === dismissed) return hide();
      if (dismissed !== image) dismissed = null;
      const css = win.getComputedStyle(image);
      const display = figureMagnifierDisplaySource(image, css, getDisplaySource(image));
      const num = name => parseFloat(css[name]) || 0;
      const sx = box.width / (image.offsetWidth || box.width), sy = box.height / (image.offsetHeight || box.height);
      const left = (num('borderLeftWidth') + num('paddingLeft')) * sx;
      const top = (num('borderTopWidth') + num('paddingTop')) * sy;
      const content = { left: box.left + left, top: box.top + top,
        width: box.width - left - (num('borderRightWidth') + num('paddingRight')) * sx,
        height: box.height - top - (num('borderBottomWidth') + num('paddingBottom')) * sy };
      const area = figureImageGeometry(content, display.width, display.height, display.fit, display.position);
      if (!area || pointer.x < Math.max(content.left, area.left) || pointer.y < Math.max(content.top, area.top) ||
          pointer.x > Math.min(content.left + content.width, area.left + area.width) ||
          pointer.y > Math.min(content.top + content.height, area.top + area.height)) return hide();
      ensure();
      const diameter = Math.min(diameterPreference, win.innerWidth - 16, win.innerHeight - 16);
      if (diameter < 80) return hide();
      const radius = diameter / 2;
      label.textContent = `${zoom.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}×`;
      if(cursor?.image!==image){restoreCursor();cursor={image,value:image.style.getPropertyValue("cursor"),priority:image.style.getPropertyPriority("cursor")};image.style.setProperty("cursor","none","important");}
      const cx = Math.max(radius + 8, Math.min(win.innerWidth - radius - 8, pointer.x));
      const cy = Math.max(radius + 8, Math.min(win.innerHeight - radius - 8, pointer.y));
      // Move the lens and its already decoded image on compositor layers.
      // Keep a fresh hit test and one geometry read for dynamic publisher layouts.
      host.style.setProperty('transform', `translate3d(${cx - radius}px,${cy - radius}px,0)`, 'important');
      picture.parentElement.style.width = diameter + 'px'; picture.parentElement.style.height = diameter + 'px';
      if (picture.getAttribute('src') !== display.source) {
        picture.referrerPolicy = image.referrerPolicy || '';
        picture.src = display.source;
      }
      picture.style.width = area.width * zoom + 'px'; picture.style.height = area.height * zoom + 'px';
      picture.style.transform = `translate3d(${radius - 2 - (pointer.x - area.left) * zoom}px,${radius - 2 - (pointer.y - area.top) * zoom}px,0)`;
      host.hidden = false; host.style.setProperty('display','block','important'); current = image;
    }
    function move(event) {
      if (event.pointerType === 'touch' || !active()) return hide();
      pointer = { x: event.clientX, y: event.clientY, buttons: event.buttons };
      if (!frame) frame = win.requestAnimationFrame(paint);
    }
    function leave(event) {
      if (!event.relatedTarget) { dismissed = null; hide(); return; }
      const next = figureImageAtPoint(doc, event.clientX, event.clientY, event.relatedTarget);
      if (!next || (next !== current && next !== dismissed)) { dismissed = null; hide(); }
    }
    function dismiss(event) {
      if (event.type === 'keydown' && (event.key !== 'Escape' || globalThis.BrevessInputTools?.isEditingEvent(event))) return;
      dismissed = current; hide();
    }
    const listeners = [[doc, 'pointermove', move], [doc, 'pointerout', leave],
      [doc, 'pointerdown', dismiss], [doc, 'keydown', dismiss],
      [doc, 'scroll', hide], [doc, 'visibilitychange', hide], [win, 'resize', hide],
      [win, 'blur', hide], [win, 'pagehide', hide]];
    for (const [node, name, fn] of listeners) node.addEventListener(name, fn, { passive: true, capture: true });
    return { hide, getState: () => ({ zoom, diameter:diameterPreference, visible: Boolean(host && !host.hidden), source: picture?.getAttribute('src') || '' }), destroy() {
      destroyed = true; restoreCursor(); doc.removeEventListener('wheel',wheel,true); if(saveTimer){win.clearTimeout(saveTimer);Promise.resolve(storage?.set({[preferenceKey]:{zoom,diameter:diameterPreference}})).catch(()=>{});} if (frame) win.cancelAnimationFrame(frame);
      for (const [node, name, fn] of listeners) node.removeEventListener(name, fn, true);
      host?.remove(); host = null; pointer = null;
    } };
  }
  function createFigureDisplayResize({ document:doc=globalThis.document, onActiveChange=()=>{} }={}) {
    const win=doc.defaultView, handle=doc.createElement('button');
    handle.type='button';handle.dataset.brevessFigureResize='';handle.dataset.sciPluginUi='';handle.setAttribute('aria-label','拖动以等比例调整图片显示大小');handle.textContent='⤡';
    handle.style.cssText='position:fixed;z-index:2147483001;width:24px;height:24px;padding:0;border:1px solid var(--bv-line,#666);border-radius:3px;background:var(--bv-surface,white);color:var(--bv-text,#222);cursor:nwse-resize;touch-action:none;display:none';doc.documentElement.append(handle);
    let target=null,drag=null;const originals=new WeakMap(),properties=['width','height','max-width','max-height','aspect-ratio'];
    function finish(){drag=null;target=null;handle.style.display='none';onActiveChange(false);}
    function position(){if(!target?.isConnected){handle.style.display='none';return;}const b=target.getBoundingClientRect();handle.style.left=(b.right-12)+'px';handle.style.top=(b.bottom-12)+'px';handle.style.display=b.bottom>0&&b.top<win.innerHeight?'block':'none';}
    handle.addEventListener('pointerdown',e=>{if(e.button!==0||!target)return;const b=target.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,width:b.width,height:b.height,target};handle.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();});
    handle.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id||!drag.target.isConnected)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y,scale=Math.max(.1,Math.min(8,1+(dx*drag.width+dy*drag.height)/(drag.width**2+drag.height**2)));const width=Math.max(60,drag.width*scale);target.style.setProperty('width',width+'px','important');target.style.setProperty('height',(width*drag.height/drag.width)+'px','important');target.style.setProperty('max-height','none','important');target.style.setProperty('max-width','none','important');target.style.setProperty('aspect-ratio',drag.width+'/'+drag.height,'important');position();});
    const stop=()=>{if(drag)finish();};for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,stop);
    const escape=e=>{if(e.key==='Escape'&&!globalThis.BrevessInputTools?.isEditingEvent(e)){finish();}};
    doc.addEventListener('scroll',position,true);win.addEventListener('resize',position);doc.addEventListener('keydown',escape,true);
    return {toggle(image){if(!originals.has(image))originals.set(image,properties.map(p=>[p,image.style.getPropertyValue(p),image.style.getPropertyPriority(p)]));target=target===image?null:image;drag=null;position();onActiveChange(!!target);},reset(image){finish();for(const [p,v,priority] of originals.get(image)||[])v?image.style.setProperty(p,v,priority):image.style.removeProperty(p);originals.delete(image);},destroy(){handle.remove();doc.removeEventListener('scroll',position,true);win.removeEventListener('resize',position);doc.removeEventListener('keydown',escape,true);target=null;drag=null;}};
  }
  function createFigureQuickControls({ document: doc = globalThis.document, isActive = () => false,
    onHighResolution, onToggleMagnifier, onToggleAnnotations, onOpenAnnotations, onOpenNotes, acceptImage,
    isHighResolution = () => false, isMagnifierEnabled = () => false, isAnnotationsVisible = () => false } = {}) {
    const win = doc.defaultView, host = doc.createElement('div');
    host.dataset.sciPluginUi = ''; host.dataset.brevessFigureTools = '';
    host.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483000!important;display:none!important;';
    const shadow = host.attachShadow({ mode: 'open' }), style = doc.createElement('style');
    style.textContent = ':host{font:12px system-ui}.tools{box-sizing:border-box;display:flex;flex-direction:column;gap:4px;padding:4px;width:46px;background:var(--bv-surface,#fffffff2);border:1px solid var(--bv-line,#cbd5e1);border-radius:9px;box-shadow:0 2px 8px #0002;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin}button{box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex:0 0 36px;font:700 13px system-ui;width:100%;height:36px;padding:2px;border:0;border-radius:6px;background:var(--bv-raised,#f1f5f9);color:var(--bv-text,#334155);cursor:pointer}button svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}button:focus-visible{outline:2px solid #25634d;outline-offset:-2px}button[aria-pressed="true"]{background:#d7eee5;color:#145a43}button:disabled{opacity:.6}output{position:absolute;right:0;top:100%;box-sizing:border-box;font:12px system-ui;width:210px;max-width:calc(100vw - 16px);padding:6px;background:var(--bv-surface,#fff);color:#644;display:block}output:empty{display:none}';
    style.textContent += 'button{position:relative;overflow:hidden}button[data-holding]::after{content:"";position:absolute;left:3px;right:3px;bottom:2px;height:3px;background:var(--bv-blue,#20558a);transform-origin:left;animation:figure-pen-hold .5s linear forwards}@keyframes figure-pen-hold{from{transform:scaleX(0)}to{transform:scaleX(1)}}';
    // Match the selection-tool preparation ring inside this isolated shadow root.
    style.textContent += 'button[aria-busy="true"]{overflow:visible;opacity:1}button[aria-busy="true"]::after{content:"";position:absolute;inset:-2px;border:2px solid transparent;border-top-color:var(--bv-blue,#326b8c);border-right-color:var(--bv-blue,#326b8c);border-radius:50%;animation:sci-speech-preparing .85s linear infinite;pointer-events:none}@keyframes sci-speech-preparing{0%{transform:rotate(0);opacity:.4}50%{opacity:1}100%{transform:rotate(360deg);opacity:.4}}';
    const bar = doc.createElement('div'); bar.className = 'tools';
    const hr = doc.createElement('button'), lens = doc.createElement('button'), pen = doc.createElement('button'), status = doc.createElement('output');
    hr.type = lens.type = 'button'; hr.textContent = 'HR';
    lens.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9.5" cy="9.5" r="6.5"/><path d="m14.5 14.5 6 6"/></svg>';
    hr.setAttribute('aria-label', '启用正文高清图'); lens.setAttribute('aria-label', '切换此图放大镜');
    hr.title = '启用正文高清图'; lens.title = '切换此图放大镜';
    status.setAttribute('aria-live', 'polite'); bar.append(hr, lens); shadow.append(style, bar, status); doc.documentElement.append(host);
    pen.type = 'button'; pen.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 15l11-11a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L9 20l-6 1zM4 15l5 5"/></svg>'; pen.setAttribute('aria-label', '显示图片标注；长按0.5秒打开查看器');
    pen.title = '单击显示标注 · 长按 0.5 秒打开高清查看器'; if (onToggleAnnotations) bar.append(pen);
    const resizeControl = createFigureDisplayResize({document:doc,onActiveChange:active=>sizeButton.setAttribute('aria-pressed',String(active))});
    const sizeButton=doc.createElement('button');sizeButton.type='button';sizeButton.title='调整图片显示大小；双击还原';sizeButton.setAttribute('aria-label',sizeButton.title);sizeButton.innerHTML='<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 17 17 7M11 7h6v6M7 11v6h6"/></svg>';bar.append(sizeButton);sizeButton.addEventListener('click',()=>{if(image)resizeControl.toggle(image);});sizeButton.setAttribute('aria-pressed','false');sizeButton.addEventListener('dblclick',event=>{event.preventDefault();if(image)resizeControl.reset(image);});
    if(onOpenNotes){const notes=doc.createElement('button');notes.type='button';notes.title='图片笔记';notes.setAttribute('aria-label',notes.title);notes.innerHTML='<svg viewBox="0 0 24 24"><path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5"/></svg>';bar.append(notes);notes.addEventListener('click',()=>{if(image)onOpenNotes(image);});}
    let image = null, busy = false, destroyed = false, hold = null, held = false, frame = 0, hideTimer = 0, hovering = false;
    const reservations = new Map(), rail = 50;
    function releaseSpace() {
      for (const [target, properties] of reservations) {
        railImages.delete(target);
        for (const [key, item] of Object.entries(properties)) {
          if (target.style.getPropertyValue(key) !== item.applied || target.style.getPropertyPriority(key) !== 'important') continue;
          if (item.value) target.style.setProperty(key, item.value, item.priority); else target.style.removeProperty(key);
        }
      }
      reservations.clear();
    }
    function reserveSpace(target, box, right, neighbourBound) {
      if (reservations.has(target)) return;
      const maxWidth = win.getComputedStyle(target).maxWidth;
      const limits = [maxWidth && maxWidth !== 'none' ? maxWidth : null, `calc(100% - ${rail}px)`];
      // Percentages alone refer to the whole Figure, not a sibling image's slot.
      if (neighbourBound) limits.push(Math.max(0, right - box.left - rail) + 'px');
      const properties = {}, values = { 'max-width': `min(${limits.filter(Boolean).join(', ')})`, 'min-width': '0', 'margin-right': rail + 'px', height: 'auto', 'align-self': 'flex-start' };
      // Reserve room only where the page cannot already fit the external rail.
      // Keep the image node and its source identity intact for HR and annotations.
      if (box.right + rail <= right) return;
      for (const [key, value] of Object.entries(values)) {
        properties[key] = { value: target.style.getPropertyValue(key), priority: target.style.getPropertyPriority(key), applied: value };
        target.style.setProperty(key, value, 'important');
        properties[key].applied = target.style.getPropertyValue(key);
      }
      reservations.set(target, properties);
      railImages.add(target);
    }
    function rightBoundary(box, container) {
      const viewportRight = Math.min(win.innerWidth, doc.documentElement.clientWidth || win.innerWidth) - 8;
      const containerRight = container?.getBoundingClientRect().right;
      const outerRight = Math.min(viewportRight, containerRight > box.left ? containerRight : viewportRight);
      let right = outerRight;
      const top = Math.max(8, box.top), bottom = Math.min(box.bottom, win.innerHeight - 8);
      // A Figure may contain several panel images. Its outer edge is not proof
      // that the corridor immediately beside this particular image is empty.
      for (const other of container?.querySelectorAll?.('img') || []) {
        if (other === image || !other.isConnected) continue;
        const peer = other.getBoundingClientRect();
        if (peer.width <= 0 || peer.height <= 0 || peer.bottom <= top || peer.top >= bottom || peer.right <= box.left) continue;
        right = Math.min(right, Math.max(box.left, peer.left));
      }
      return { right, neighbourBound: right < outerRight };
    }
    function scheduleRefresh() { if (!frame && !destroyed) frame = win.requestAnimationFrame(() => { frame = 0; refresh(); }); }
    const resize = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(scheduleRefresh) : null;
    function cancelHold() { pen.removeAttribute('data-holding'); if (hold) win.clearTimeout(hold.timer); hold = null; }
    function visibleFigure(candidate) {
      if (candidate?.tagName !== 'IMG' || !candidate.isConnected || !candidate.complete || !candidate.naturalWidth ||
          candidate.closest('[data-sci-plugin-ui],[data-brevess-magnifier],#sci-logic-panel,#sci-article-navigator') ||
          (acceptImage ? !acceptImage(candidate) : (!candidate.closest(FIGURE) && !/^(?:figure|fig\.?|extended data fig|supplementary fig)\s*\d/i.test(candidate.alt || '')))) return null;
      const r = candidate.getBoundingClientRect();
      return eligibleFigureBox(candidate, r) && r.bottom > 8 && r.top < win.innerHeight - 36 &&
        r.right > 8 && r.left < win.innerWidth - 50 ? r : null;
    }
    function selectImage(candidate) {
      if (image === candidate) return;
      resize?.disconnect(); releaseSpace(); image = candidate; status.textContent = '';
      if (image) { resize?.observe(image); if (image.parentElement) resize?.observe(image.parentElement); }
    }
    function refresh() {
      if (destroyed || !isActive()) { host.style.setProperty('display', 'none', 'important'); releaseSpace(); return; }
      // No automatic nearest-image selection: controls only follow an intentional hover.
      if (!hovering && !busy && !hold && !shadow.activeElement?.matches(':focus-visible')) { host.style.setProperty('display', 'none', 'important'); return; }
      if (!image?.isConnected) { host.style.setProperty('display', 'none', 'important'); return; }
      let r = image.getBoundingClientRect();
      if (r.bottom < 0 || r.top > win.innerHeight || !eligibleFigureBox(image, r)) { host.style.setProperty('display', 'none', 'important'); return; }
      const container = image.closest(FIGURE), boundary = rightBoundary(r, container);
      if (boundary.right - r.left <= rail) { host.style.setProperty('display', 'none', 'important'); return; }
      // Never shrink a paper figure merely to make space for hover controls.
      const { right } = rightBoundary(r, container);
      const top = Math.max(8, r.top), availableHeight = Math.min(r.bottom, win.innerHeight - 8) - top;
      // Never clamp a rail back on top of the image when a publisher fixes its size.
      if (availableHeight < 36) { host.style.setProperty('display', 'none', 'important'); return; }
      bar.style.maxHeight = availableHeight + 'px';
      host.style.setProperty('left', Math.max(8, r.right + rail <= right + 1 ? r.right + 4 : Math.min(r.right, win.innerWidth - 8) - 46) + 'px', 'important');
      host.style.setProperty('top', top + 'px', 'important');
      host.style.setProperty('display', 'block', 'important');
      hr.setAttribute('aria-pressed', String(isHighResolution(image))); lens.setAttribute('aria-pressed', String(isMagnifierEnabled(image)));
      pen.setAttribute('aria-pressed', String(isAnnotationsVisible(image))); hr.disabled = pen.disabled = busy;
    }
    function hideSoon() {
      hovering = false; if (hideTimer) return;
      hideTimer = win.setTimeout(() => { hideTimer = 0; if (!hovering && !busy && !hold && !shadow.activeElement?.matches(':focus-visible')) { host.style.setProperty('display','none','important'); selectImage(null); } }, 220);
    }
    function over(event) {
      if (event.target === host || event.composedPath?.().includes(host)) { hovering = true; win.clearTimeout(hideTimer); hideTimer = 0; refresh(); return; }
      if (!isActive()) return;
      const candidate = figureImageAtPoint(doc, event.clientX, event.clientY, event.target);
      if (!visibleFigure(candidate)) { hideSoon(); return; }
      hovering = true; win.clearTimeout(hideTimer); hideTimer = 0;
      if (image !== candidate && !busy && !hold) selectImage(candidate);
      refresh();
    }
    const out = event => { if (!event.relatedTarget) hideSoon(); };
    const blurred = () => { cancelHold(); hovering = false; host.style.setProperty('display','none','important'); };
    shadow.addEventListener('focusout', hideSoon);
    shadow.addEventListener('focusin', () => { win.clearTimeout(hideTimer); hideTimer = 0; refresh(); });
    hr.addEventListener('click', async () => {
      if (busy || !image) return; const target = image;
      busy = true; hr.setAttribute('aria-busy', 'true'); status.textContent = ''; refresh();
      try { const applied = await onHighResolution?.(target); status.textContent = applied ? '' : '暂未取得可验证的高清图，保留原图。'; }
      catch (_) { status.textContent = '高清图加载失败，可重试。'; }
      finally { busy = false; hr.setAttribute('aria-busy', 'false'); refresh(); }
    });
    lens.addEventListener('click', () => { if (image) onToggleMagnifier?.(image); refresh(); });
    pen.addEventListener('pointerdown', event => {
      if (event.button !== 0 || busy || !image) return;
      held = false; const target = image; pen.dataset.holding = "true";
      hold = { x: event.clientX, y: event.clientY, timer: win.setTimeout(() => {
        hold = null; held = true; pen.removeAttribute("data-holding"); if (!destroyed && target.isConnected) onOpenAnnotations?.(target);
      }, 500) };
    });
    pen.addEventListener('pointermove', event => { if (hold && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 6) cancelHold(); });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) pen.addEventListener(type, cancelHold);
    pen.addEventListener('click', async () => {
      if (held) { held = false; return; }
      if (busy || !image) return; const target = image; busy = true; status.textContent = '正在读取标注…'; refresh();
      try { await onToggleAnnotations?.(target); status.textContent = ''; }
      catch (error) { status.textContent = error?.message || '标注读取失败，可重试。'; }
      finally { busy = false; refresh(); }
    });
    const resized = () => { releaseSpace(); refresh(); };
    const listeners = [[doc, 'pointerover', over], [doc, 'pointermove', over], [doc, 'pointerout', out], [doc, 'scroll', blurred], [win, 'blur', blurred], [win, 'resize', resized], [doc, 'load', scheduleRefresh]];
    for (const [node, type, fn] of listeners) node.addEventListener(type, fn, true);
    // Content callbacks reference state initialized later in the same script.
    Promise.resolve().then(refresh);
    return { refresh, destroy() { destroyed = true; win.clearTimeout(hideTimer); resizeControl.destroy(); cancelHold(); if (frame) win.cancelAnimationFrame(frame); resize?.disconnect(); releaseSpace(); for (const [node, type, fn] of listeners) node.removeEventListener(type, fn, true); host.remove(); } };
  }
  return { figureImageGeometry, figureMagnifierDisplaySource, createFigureDisplayResize, createFigureMagnifier, createFigureQuickControls };
});
