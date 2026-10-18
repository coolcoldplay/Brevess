// Translation-only DOM projection. Never rewrite the source or annotation anchors.
(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessTranslationSource = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';
  const OMIT = 'script,style,template,noscript,input,textarea,select,button,iframe,object,embed,' +
    'annotation,annotation-xml,[data-sci-plugin-ui],[data-sci-translation],[data-pdf-page-furniture],' +
    '.immersive-translate-target-wrapper,[data-immersive-translate-translation-element-mark="1"]';

  function extractSource(target, { allowHiddenRoot = false } = {}) {
    const range = target?.startContainer && target?.endContainer ? target : null;
    const root = range ? range.commonAncestorContainer : target;
    if (!root || range?.collapsed) return { text: '', segments: [] };
    const view = (root.ownerDocument || (root.nodeType === 9 ? root : null))?.defaultView;
    const styles = new Map();
    function styleFor(node) {
      if (!styles.has(node)) {
        let style;
        try { style = view?.getComputedStyle?.(node) || node.style || {}; }
        catch { style = node.style || {}; }
        styles.set(node, style);
      }
      return styles.get(node);
    }
    function omitted(node, skipVisibility = false) {
      if (node.nodeType !== 1) return false;
      if (node.matches?.(OMIT)) return true;
      const role = String(node.getAttribute?.('role') || '').toLowerCase();
      // An open citation preview is still auxiliary content, not paragraph text.
      if (role === 'tooltip' || role === 'dialog' || node.hasAttribute?.('popover')) return true;
      if (skipVisibility) return false;
      if (node.hidden || node.hasAttribute?.('hidden') || node.getAttribute?.('aria-hidden') === 'true') return true;
      const style = styleFor(node);
      return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
        style.contentVisibility === 'hidden' || String(style.opacity) === '0';
    }
    // A Range can start inside an auxiliary/hidden node. Its ancestor must not
    // become an escape from the same paragraph-source rules.
    let inlineAncestor = false;
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
      if (omitted(parent)) return { text: '', segments: [] };
      if (/^(SUP|SUB|MATH)$/i.test(parent.tagName || '')) inlineAncestor = true;
    }
    const pieces = [], stack = [{ node: root, inlineContext: inlineAncestor }];
    const blockDisplays = new Set(['block', 'flow-root', 'list-item', 'flex', 'grid',
      'table', 'table-row', 'table-cell', 'table-caption']);
    function blockBoundary(node, boundary) {
      // This space is a layout boundary, never a range inside a Text node.
      pieces.push({ node, startOffset: null, endOffset: null, value: ' ',
        kind: 'block-boundary', boundary });
    }
    while (stack.length) {
      const frame = stack.pop(), node = frame.node;
      if (frame.boundary) {
        blockBoundary(node, 'after');
        continue;
      }
      if (node.nodeType === 3) {
        if (range && !range.intersectsNode(node)) continue;
        const value = node.nodeValue || '';
        const startOffset = range?.startContainer === node ? range.startOffset : 0;
        const endOffset = range?.endContainer === node ? range.endOffset : value.length;
        if (endOffset > startOffset) pieces.push({ node, startOffset, endOffset, value: value.slice(startOffset, endOffset), kind: 'text' });
        continue;
      }
      if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) continue;
      // A selection may have the entire article (or PDF viewer) as its common
      // ancestor. Prune unrelated branches before any computed-style lookup.
      if (range && node !== root && node.nodeType === 1 && !range.intersectsNode(node)) continue;
      if (omitted(node, !range && node === root && allowHiddenRoot)) continue;
      if (node.tagName === 'BR') {
        if (!range || range.intersectsNode(node)) pieces.push({ node, startOffset: 0, endOffset: 0, value: ' ', kind: 'break' });
        continue;
      }
      // Keep scientific inline expressions together even if their renderer uses
      // block descendants. Absolutely positioned PDF spans are not block breaks.
      const inlineContext = frame.inlineContext || /^(SUP|SUB|MATH)$/i.test(node.tagName || '');
      const style = node.nodeType === 1 && node !== root && !inlineContext ? styleFor(node) : {};
      const isBlock = node !== root && !inlineContext &&
        style.position !== 'absolute' && style.position !== 'fixed' &&
        (blockDisplays.has(style.display) || /^block\s/u.test(style.display || ''));
      if (isBlock) {
        blockBoundary(node, 'before');
        stack.push({ node, boundary: true });
      }
      const children = node.childNodes || [];
      for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], inlineContext });
    }
    let text = '', pendingSpace = null;
    const segments = [];
    function append(value, origin) {
      const textStart = text.length;
      text += value;
      segments.push({ node: origin.node, startOffset: origin.startOffset, endOffset: origin.endOffset,
        textStart, textEnd: text.length, kind: origin.kind,
        ...(origin.kind === 'block-boundary' ? { boundary: origin.boundary } : {}) });
    }
    for (const piece of pieces) {
      for (const match of piece.value.matchAll(/\s+|\S+/gu)) {
        const value = match[0];
        const origin = piece.kind === 'block-boundary'
          ? { node: piece.node, startOffset: null, endOffset: null, kind: piece.kind, boundary: piece.boundary }
          : { node: piece.node, startOffset: piece.startOffset + match.index,
            endOffset: piece.kind === 'break' ? 0 : piece.startOffset + match.index + value.length, kind: piece.kind };
        if (/^\s/u.test(value)) {
          if (!pendingSpace) pendingSpace = { ...origin,
            kind: ['break', 'block-boundary'].includes(piece.kind) ? piece.kind : 'space' };
        } else {
          if (pendingSpace && text) append(' ', pendingSpace);
          pendingSpace = null;
          append(value, origin);
        }
      }
    }
    return { text, segments };
  }
  function readSourceText(element, options) { return extractSource(element, options).text; }
  function readRangeText(range) { return extractSource(range).text; }
  return { extractSource, readSourceText, readRangeText };
});
