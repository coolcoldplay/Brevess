globalThis.document?.getElementById('sci-cross-format-notes')?.remove();
(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';
  function crossFormatRangeFromNodes(documentObject, nodes, fragment) {
    const text = nodes.map(node => node.textContent || '').join('');
    const start = fragment?.startOffset, end = fragment?.endOffset;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start ||
        end > text.length || text.slice(start, end) !== fragment.quote) return null;
    const point = (offset, beginning) => {
      let total = 0;
      for (const node of nodes) {
        const next = total + node.textContent.length;
        if (next > total && (beginning ? offset < next : offset <= next)) return { node, offset: offset - total };
        total = next;
      }
      return null;
    };
    const from = point(start, true), to = point(end, false);
    if (!from || !to) return null;
    try {
      const range = documentObject.createRange();
      range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset);
      return range.toString() === fragment.quote ? range : null;
    } catch (_) { return null; }
  }

  function createCrossFormatHighlightView({ document: doc, name, isCurrent, onOpen }) {
    if (!/^brevess-cross-[a-z-]+$/u.test(name || '')) throw Error('INVALID_HIGHLIGHT_NAME');
    const win = doc.defaultView, registry = win?.CSS?.highlights;
    let entries = [], style = null;
    const clear = () => { entries = []; registry?.delete(name); };
    const current = entry => isCurrent() && entry.parts.every(({ range, quote }) =>
      range.startContainer.isConnected && range.endContainer.isConnected && range.toString() === quote);
    const click = event => {
      if (!event.isTrusted || event.button !== 0 || !doc.getSelection()?.isCollapsed) return;
      const hit = entries.find(entry => current(entry) && entry.parts.some(({ range }) =>
        [...range.getClientRects()].some(rect => event.clientX >= rect.left && event.clientX <= rect.right &&
          event.clientY >= rect.top && event.clientY <= rect.bottom)));
      if (!hit) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void Promise.resolve(onOpen(hit.row, hit.location)).catch(() => clear());
    };
    doc.addEventListener('click', click, true);
    return {
      available: Boolean(registry && win.Highlight),
      clear,
      show(next) {
        clear();
        if (!registry || !win.Highlight || !isCurrent()) return 0;
        if (!style?.isConnected) {
          style = doc.createElement('style');
          style.textContent = `::highlight(${name}) { background-color: rgba(246, 211, 91, .36); color: inherit; text-decoration: underline; }`;
          (doc.head || doc.documentElement).append(style);
        }
        entries = next.filter(entry => entry.parts.length && current(entry));
        registry.set(name, new win.Highlight(...entries.flatMap(entry => entry.parts.map(part => part.range))));
        return entries.length;
      },
      destroy() { clear(); style?.remove(); doc.removeEventListener('click', click, true); }
    };
  }
  function createCrossFormatNotesPanel({ document: doc, onReveal }) {
    doc.getElementById('sci-cross-format-notes')?.remove();
    return { show() {}, clear() {}, reveal() { return onReveal?.(); },
      destroy() { doc.getElementById('sci-cross-format-notes')?.remove(); } };
  }
  return { crossFormatRangeFromNodes, createCrossFormatHighlightView, createCrossFormatNotesPanel };
});
