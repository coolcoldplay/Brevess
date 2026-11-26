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

  function createCrossFormatHighlightView({ document: doc, name, isCurrent, onOpen, pastelColor, readParts, rewrite = (_, fn) => fn() }) {
    if (!/^brevess-cross-[a-z-]+$/u.test(name || '')) throw Error('INVALID_HIGHLIGHT_NAME');
    const win = doc.defaultView, registry = win?.CSS?.highlights, marks = new Map();
    let entries = new Map(), painted = [], style = null;
    const current = entry => entry && isCurrent() && entry.parts.length && entry.parts.every(({range, quote}) =>
      range.startContainer.isConnected && range.endContainer.isConnected && range.toString() === quote);
    const colorOf = row => {
      const color = row.source?.categorySnapshot?.color || row.source?.color;
      return /^#[a-f0-9]{6}$/iu.test(color || '') ? color.toLowerCase() : '#f2d978';
    };
    function unwrap(key) {
      const marksForRow = marks.get(key) || [];
      rewrite(marksForRow.map(mark => mark.parentElement).filter(Boolean), () => {
        for (const mark of marksForRow) if (mark.isConnected) mark.replaceWith(...mark.childNodes);
      });
      marks.delete(key);
    }
    // Wrap only matched text nodes. Links, emphasis and publisher-owned elements
    // keep their identity, event listeners and order across partial highlights.
    function wrapRange(range, row, first) {
      const root = range.commonAncestorContainer;
      const nodes = [];
      if (root.nodeType === 3) nodes.push(root);
      else {
        const walker = doc.createTreeWalker(root, win.NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) if (range.intersectsNode(node)) nodes.push(node);
      }
      const slices = nodes.map(node => [node, node === range.startContainer ? range.startOffset : 0,
        node === range.endContainer ? range.endOffset : node.length]).filter(([,from,to]) => to > from);
      return rewrite(slices.map(([node]) => node.parentElement), () => slices.map(([node,from,to], i) => {
        if (to < node.length) node.splitText(to);
        const text = from ? node.splitText(from) : node;
        const mark = doc.createElement('mark');
        mark.className = 'sci-paper-highlight';
        mark.dataset.paperAnnotation = row.key;
        mark.tabIndex = first && !i ? 0 : -1;
        mark.setAttribute('role', 'button');
        text.replaceWith(mark); mark.append(text);
        return mark;
      }));
    }
    function clearPaint() {
      registry?.delete(name);
      for (const id of painted) registry?.delete(id);
      painted = [];
    }
    const clear = () => {
      for (const key of marks.keys()) unwrap(key);
      entries.clear(); clearPaint();
    };
    function activate(event) {
      if (!event.isTrusted || !isCurrent()) return;
      const mark = event.target?.closest?.('.sci-paper-highlight');
      let entry = mark && entries.get(mark.dataset.paperAnnotation), rect;
      if (event.type === 'keydown') {
        if (!entry || !['Enter',' '].includes(event.key)) return;
      } else {
        if (event.button !== 0 || !doc.getSelection()?.isCollapsed || event.target?.closest?.('[data-sci-plugin-ui]')) return;
        if (!entry) {
          for (const item of entries.values()) {
            if (marks.has(item.row.key) || !current(item)) continue;
            rect = item.parts.flatMap(part => [...part.range.getClientRects()]).find(box =>
              event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom);
            if (rect) { entry = item; break; }
          }
        }
      }
      if (!entry) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void onOpen(entry.row, entry.location, rect || mark.getBoundingClientRect());
    }
    doc.addEventListener('click', activate, true); doc.addEventListener('keydown', activate, true);
    return {
      clear,
      needsRebind() {
        return [...marks].some(([key,group]) => group.some(mark => !mark.isConnected) ||
          group.map(mark => mark.textContent).join('') !== entries.get(key)?.parts.map(part => part.quote).join(''));
      },
      show(next) {
        if (!isCurrent()) return 0;
        entries = new Map(next.filter(current).map(entry => [entry.row.key, entry]));
        for (const [key, group] of marks) {
          const entry = entries.get(key);
          if (!entry || !group.every(mark => mark.isConnected) ||
              group.map(mark => mark.textContent).join('') !== entry.parts.map(part => part.quote).join('') ||
              !group[0].contains(entry.parts[0].range.startContainer)) unwrap(key);
        }
        clearPaint();
        const colors = new Map();
        for (const [key, entry] of entries) {
          const {row, parts} = entry, color = colorOf(row);
          if (row.local && !parts[0].range.startContainer.parentElement?.closest('.textLayer')) {
            let group = marks.get(key);
            if (!group) {
              // An earlier overlapping mark can split or move these text nodes.
              // Resolve against the current DOM before wrapping this row.
              const fresh = readParts(row);
              group = fresh.flatMap((part,i) => wrapRange(part.range, row, !i));
              if (group.length) marks.set(key, group);
            }
            for (const mark of group) {
              mark.style.setProperty('--sci-manual-color', pastelColor(color));
              const label = row.source.categorySnapshot?.name || row.source.categoryName || row.source.categoryId || '';
              mark.title = row.text || label;
              mark.setAttribute('aria-label', [label,row.text || row.source.quote].filter(Boolean).join(' · '));
            }
          } else if (registry && win.Highlight) {
            if (!colors.has(color)) colors.set(color, []);
            colors.get(color).push(...parts.map(part => part.range));
          }
        }
        if (registry && win.Highlight) {
          // Reconstruct after wrapping. A DOM Range may have moved to its former
          // parent when its text node was wrapped. PDF text layers remain untouched.
          const ranges = [...entries.values()].flatMap(entry => marks.get(entry.row.key)?.map(mark => {
            const range = doc.createRange(); range.selectNodeContents(mark); return range;
          }) || entry.parts.map(part => part.range));
          registry.set(name, new win.Highlight(...ranges));
          if (!style?.isConnected) {
            style = doc.createElement('style'); style.dataset.sciPluginUi = '';
            (doc.head || doc.documentElement).append(style);
          }
          const rules = [];
          for (const [color, ranges] of colors) {
            const id = name + '-' + color.slice(1);
            const highlight = new win.Highlight(...ranges); highlight.priority = 1;
            registry.set(id, highlight); painted.push(id);
            rules.push(`::highlight(${id}){background-color:${color}66;color:inherit}`);
          }
          if (style.textContent !== rules.join('\n')) style.textContent = rules.join('\n');
        }
        return entries.size;
      },
      destroy() { clear(); style?.remove(); doc.removeEventListener('click', activate, true); doc.removeEventListener('keydown', activate, true); }
    };
  }
  return { crossFormatRangeFromNodes, createCrossFormatHighlightView };
});
