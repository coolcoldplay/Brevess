(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  let nextManagerId = 0;

  // The caller validates source identity and resolves the final source glyph.
  // Rectangles are viewport CSS pixels; this module never interprets PDF data.
  function createParagraphNoteMarkerManager(options = {}) {
    const doc = options.document || globalThis.document;
    if (!doc?.createElement || typeof options.resolveAnchor !== 'function') {
      throw new TypeError('A document and synchronous resolveAnchor are required');
    }
    const view = doc.defaultView || globalThis;
    const host = options.container || doc.documentElement || doc.body;
    const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : () => true;
    const onActivate = typeof options.onActivate === 'function' ? options.onActivate : () => {};
    const onMove = typeof options.onMove === 'function' ? options.onMove : () => {};
    const report = error => { try { options.onError?.(error); } catch (_) {} };
    const layer = doc.createElement('div');
    layer.className = 'brevess-paragraph-note-marker-layer';
    layer.setAttribute('data-brevess-ui', 'paragraph-note-markers');
    layer.setAttribute('data-sci-plugin-ui', 'paragraph-note-markers');
    Object.assign(layer.style, { position: 'fixed', left: '0px', top: '0px', width: '0px',
      height: '0px', overflow: 'visible', pointerEvents: 'none', zIndex: '2147483000' });
    const tooltip = doc.createElement('div');
    tooltip.className = 'brevess-paragraph-note-tooltip';
    tooltip.setAttribute('id', `brevess-paragraph-note-tooltip-${++nextManagerId}`);
    tooltip.setAttribute('role', 'tooltip');
    Object.assign(tooltip.style, { position: 'absolute', boxSizing: 'border-box', width: 'max-content',
      maxWidth: 'min(320px, calc(100vw - 16px))', maxHeight: '240px', overflow: 'auto',
      padding: '8px 10px', border: '1px solid #c7ad62', borderRadius: '3px',
      background: '#fff8cc', color: '#2f2b1d', font: '13px/1.45 Arial, sans-serif',
      whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', pointerEvents: 'auto',
      boxShadow: '0 2px 8px #0002' });
    tooltip.hidden = true;
    tooltip.style.display = 'none';
    layer.appendChild(tooltip);
    host.appendChild(layer);
    const records = new Map();
    const listeners = [];
    let active = null;
    let drag = null;
    let disposed = false;
    let frame = null;
    let hideTimer = null;
    let hideSequence = 0;
    let tooltipHovered = false;
    const setTimer = typeof view.setTimeout === 'function' ? view.setTimeout.bind(view) : setTimeout;
    const clearTimer = typeof view.clearTimeout === 'function' ? view.clearTimeout.bind(view) : clearTimeout;
    const listen = (element, type, listener, settings) => {
      element.addEventListener(type, listener, settings);
      listeners.push(() => element.removeEventListener(type, listener, settings));
    };
    const isolate = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    const viewport = () => ({ width: Number(view.innerWidth) || doc.documentElement.clientWidth || 1024,
      height: Number(view.innerHeight) || doc.documentElement.clientHeight || 768 });
    function cancelHide() {
      hideSequence += 1;
      if (hideTimer !== null) clearTimer(hideTimer);
      hideTimer = null;
    }
    function hide() {
      cancelHide();
      tooltip.hidden = true;
      tooltip.style.display = 'none';
      tooltip.textContent = '';
      active = null;
      tooltipHovered = false;
    }
    function current(entry) {
      try { return isCurrent(entry) === true; } catch (error) { report(error); return false; }
    }
    function markerOffset(value) {
      if (!value || typeof value !== 'object') return { dx: 0, dy: 0 };
      const dx = Number(value.dx), dy = Number(value.dy);
      if (!Number.isFinite(dx) || !Number.isFinite(dy) ||
          Math.abs(dx) > 4000 || Math.abs(dy) > 4000) return { dx: 0, dy: 0 };
      return { dx: Math.round(dx), dy: Math.round(dy) };
    }
    function position(record) {
      if (drag?.record === record) return true;
      let rect;
      try {
        if (records.get(record.entry.paragraphId) === record && record.button.isConnected && current(record.entry)) {
          rect = options.resolveAnchor(record.entry)?.rect;
        }
      }
      catch (error) { report(error); }
      const { width, height } = viewport();
      const valid = rect && ['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(rect[key])) &&
        rect.right >= rect.left && rect.bottom >= rect.top && rect.right >= 0 &&
        rect.right <= width && rect.bottom >= 0 && rect.top <= height;
      record.button.hidden = !valid;
      record.button.style.display = valid ? 'grid' : 'none';
      if (!valid) { if (active === record) hide(); return false; }
      const offset = markerOffset(record.entry?.markerOffset);
      let left = rect.right + 3 + offset.dx;
      let top = Math.max(0, rect.bottom - 18) + offset.dy;
      if (left + 18 > width) { left = Math.max(0, width - 20); top = rect.bottom + 2 + offset.dy; }
      top = Math.min(Math.max(0, height - 18), top);
      left = Math.min(Math.max(0, width - 18), left);
      record.left = left;
      record.top = top;
      record.button.style.left = `${left}px`;
      record.button.style.top = `${top}px`;
      return true;
    }
    function positionTooltip(record) {
      const { width, height } = viewport();
      const size = tooltip.getBoundingClientRect();
      tooltip.style.left = `${Math.max(8, Math.min(record.left, width - size.width - 8))}px`;
      const below = record.top + 22;
      tooltip.style.top = `${Math.max(8, below + size.height <= height
        ? below : record.top - size.height - 4)}px`;
    }
    function show(record) {
      if (disposed || !position(record)) return;
      cancelHide();
      active = record;
      if (tooltip.textContent !== record.entry.note) tooltip.textContent = record.entry.note;
      tooltip.hidden = false;
      tooltip.style.display = 'block';
      positionTooltip(record);
    }
    function scheduleHide(record) {
      if (active !== record) return;
      cancelHide();
      const pendingSequence = hideSequence;
      hideTimer = setTimer(() => {
        if (pendingSequence !== hideSequence || disposed || active !== record) return;
        hideTimer = null;
        if (!current(record.entry) || (!record.hovered && !tooltipHovered && doc.activeElement !== record.button)) hide();
      }, 150);
    }
    function makeRecord(entry) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'brevess-paragraph-note-marker';
      button.setAttribute('aria-label', '便签笔记');
      button.setAttribute('aria-describedby', tooltip.id);
      button.setAttribute('data-paragraph-note-marker', entry.paragraphId);
      Object.assign(button.style, { position: 'absolute', boxSizing: 'border-box', width: '18px',
        height: '18px', minWidth: '18px', margin: '0px', padding: '1px', display: 'grid',
        placeItems: 'center', border: '1px solid #c5aa5d', borderRadius: '2px',
        background: '#fff7c2', color: '#7a6217', cursor: 'grab', pointerEvents: 'auto',
        touchAction: 'none', userSelect: 'none',
        lineHeight: '1', font: '12px Arial, sans-serif' });
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [key, value] of Object.entries({ viewBox: '0 0 16 16', width: '12', height: '12',
        fill: 'none', stroke: 'currentColor', 'stroke-width': '1.2', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, value);
      const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M2 2h12v8l-4 4H2V2Zm8 12v-4h4M4 5h7M4 8h5');
      svg.appendChild(path); button.appendChild(svg); layer.appendChild(button);
      const record = { entry, button, hovered: false, suppressClickUntil: 0 };
      for (const type of ['mousedown', 'dblclick']) button.addEventListener(type, isolate, true);
      button.addEventListener('pointerdown', event => {
        isolate(event);
        if (disposed || event.button !== 0 || event.isPrimary === false ||
            !position(record)) return;
        record.suppressClickUntil = 0;
        drag = { record, pointerId: event.pointerId, startX: event.clientX,
          startY: event.clientY, startLeft: record.left, startTop: record.top,
          startOffset: markerOffset(record.entry?.markerOffset), moved: false };
        button.style.cursor = 'grabbing';
        cancelHide();
        try { button.setPointerCapture?.(event.pointerId); } catch (_) {}
      }, true);
      const movePointer = event => {
        if (!drag || drag.record !== record || event.pointerId !== drag.pointerId) return;
        const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < 3) return;
        drag.moved = true;
        event.preventDefault();
        event.stopImmediatePropagation();
        const { width, height } = viewport();
        record.left = Math.min(Math.max(0, drag.startLeft + dx), Math.max(0, width - 18));
        record.top = Math.min(Math.max(0, drag.startTop + dy), Math.max(0, height - 18));
        record.dragOffset = {
          dx: Math.round(drag.startOffset.dx + record.left - drag.startLeft),
          dy: Math.round(drag.startOffset.dy + record.top - drag.startTop)
        };
        button.style.left = `${record.left}px`;
        button.style.top = `${record.top}px`;
        if (active === record) positionTooltip(record);
      };
      const finishPointer = (event, cancelled = false) => {
        if (!drag || drag.record !== record || event.pointerId !== drag.pointerId) return;
        const finished = drag;
        drag = null;
        button.style.cursor = 'grab';
        try { button.releasePointerCapture?.(event.pointerId); } catch (_) {}
        if (cancelled || !finished.moved) {
          record.left = finished.startLeft;
          record.top = finished.startTop;
          button.style.left = `${record.left}px`;
          button.style.top = `${record.top}px`;
          return;
        }
        const offset = record.dragOffset || finished.startOffset;
        delete record.dragOffset;
        record.entry = { ...record.entry, markerOffset: offset };
        record.suppressClickUntil = Date.now() + 500;
        try { Promise.resolve(onMove(record.entry, offset)).catch(report); } catch (error) { report(error); }
      };
      button.addEventListener('pointermove', movePointer, true);
      button.addEventListener('pointerup', event => {
        if (!drag || drag.record !== record) return;
        if (drag.moved) isolate(event);
        finishPointer(event);
      }, true);
      button.addEventListener('pointercancel', event => { isolate(event); finishPointer(event, true); }, true);
      button.addEventListener('lostpointercapture', event => {
        if (drag?.record === record && event.pointerId === drag.pointerId) finishPointer(event, true);
      });
      button.addEventListener('click', event => {
        isolate(event);
        if (event.detail > 1 || disposed || Date.now() < record.suppressClickUntil ||
            !position(record)) return;
        record.suppressClickUntil = 0;
        try { Promise.resolve(onActivate(record.entry, event)).catch(report); } catch (error) { report(error); }
      }, true);
      button.addEventListener('mouseenter', () => { record.hovered = true; cancelHide(); show(record); });
      button.addEventListener('focus', () => show(record));
      button.addEventListener('mouseleave', event => {
        record.hovered = false;
        if (tooltip.contains(event.relatedTarget)) { cancelHide(); return; }
        if (active === record && doc.activeElement !== button) scheduleHide(record);
      });
      button.addEventListener('blur', () => {
        if (active === record && !record.hovered && !tooltipHovered) scheduleHide(record);
      });
      button.addEventListener('keydown', event => {
        event.stopImmediatePropagation();
        if (event.key === 'Escape') { event.preventDefault(); hide(); }
      }, true);
      button.addEventListener('keyup', event => event.stopImmediatePropagation(), true);
      return record;
    }
    tooltip.addEventListener('mouseenter', () => { tooltipHovered = true; cancelHide(); });
    tooltip.addEventListener('mouseleave', event => {
      tooltipHovered = false;
      if (active?.button.contains(event.relatedTarget)) { cancelHide(); return; }
      if (active && !active.hovered && doc.activeElement !== active.button) scheduleHide(active);
    });
    function refresh() {
      if (disposed) return;
      for (const record of records.values()) position(record);
      if (active) {
        if (tooltip.textContent !== active.entry.note) tooltip.textContent = active.entry.note;
        positionTooltip(active);
      }
    }
    function scheduleRefresh() {
      if (disposed || frame !== null) return;
      if (typeof view.requestAnimationFrame !== 'function') { refresh(); return; }
      frame = view.requestAnimationFrame(() => { frame = null; refresh(); });
    }
    function clear() {
      hide();
      drag = null;
      for (const record of records.values()) record.button.remove();
      records.clear();
    }
    listen(doc, 'scroll', scheduleRefresh, { capture: true, passive: true });
    listen(view, 'resize', scheduleRefresh, { passive: true });
    return {
      element: layer,
      update(entries) {
        if (disposed) return;
        const next = new Map();
        for (const entry of Array.isArray(entries) ? entries : []) {
          if (typeof entry?.paragraphId === 'string' && entry.paragraphId.trim()) next.set(entry.paragraphId, entry);
        }
        for (const [id, record] of records) {
          const entry = next.get(id);
          if (typeof entry?.note !== 'string' || !entry.note.trim()) {
            if (active === record) hide(); record.button.remove(); records.delete(id);
          }
        }
        for (const [id, entry] of next) {
          if (typeof entry.note !== 'string' || !entry.note.trim()) continue;
          const record = records.get(id);
          if (record) record.entry = entry;
          else records.set(id, makeRecord(entry));
        }
        refresh();
      },
      refresh,
      clear,
      dispose() {
        if (disposed) return;
        clear(); disposed = true;
        for (const remove of listeners) remove();
        if (frame !== null && typeof view.cancelAnimationFrame === 'function') view.cancelAnimationFrame(frame);
        frame = null; layer.remove();
      }
    };
  }
  return { createParagraphNoteMarkerManager };
});
