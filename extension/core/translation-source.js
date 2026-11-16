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
    // Keep the original projection and Text-node offsets. The companion is
    // descriptive MathML notation, never a replacement source or anchor.
    const scientificContext = [];
    if (!range && root.nodeType !== 3) {
      const groups = new Map();
      for (const segment of segments) {
        let scientific = null;
        for (let node = segment.node?.parentElement; node; node = node.parentElement) {
          if (/^(math|sup|sub)$/iu.test(node.localName || node.tagName || '')) scientific = node;
          if (node === root) break;
        }
        if (!scientific) continue;
        const group = groups.get(scientific) || { sourceStart: segment.textStart, sourceEnd: segment.textEnd };
        group.sourceEnd = segment.textEnd; groups.set(scientific, group);
      }
      let remaining = 50000;
      function describe(node, depth = 0) {
        if (--remaining < 0 || depth > 200) throw Error('MATH_REPRESENTATION_LIMIT');
        if (node.nodeType === 3) return node.nodeValue || '';
        if (omitted(node)) return '';
        const tag = String(node.localName || node.tagName || '').toLowerCase();
        const children = [...(node.childNodes || [])];
        const parts = children.map(child => describe(child, depth + 1));
        const content = parts.join('');
        const attrs = ['mathvariant','linethickness','notation','accent','accentunder','stretchy','fence','separator',
          'columnspan','rowspan','open','close','separators'].flatMap(name => {
            const value = node.getAttribute?.(name); return value == null ? [] : [`${name}=${value}`];
          });
        if (!attrs.length && ['math','mrow','semantics','mi','mn','mo','mtext','ms'].includes(tag)) return content;
        if (tag === 'mspace' || tag === 'br') return ' ';
        const operands = children.flatMap((child, index) => child.nodeType === 1 && !omitted(child) ? [parts[index]] : []);
        return `${tag}${attrs.length ? '[' + attrs.join(', ') + ']' : ''}(${operands.length ? operands.join('; ') : content})`;
      }
      for (const [node, span] of groups) {
        const raw = text.slice(span.sourceStart, span.sourceEnd);
        // A collapsed leading space can originate inside MathML but belong to
        // surrounding prose. Bind only the mathematical source itself.
        const leading = raw.length - raw.trimStart().length, trailing = raw.length - raw.trimEnd().length;
        span.sourceStart += leading; span.sourceEnd -= trailing;
        const value = text.slice(span.sourceStart, span.sourceEnd);
        let displayText;
        try { displayText = describe(node).replace(/\s+/gu, ' ').trim(); }
        catch { displayText = '[MathML representation unavailable]'; }
        if (value && displayText && displayText !== value) scientificContext.push({ ...span, text: value, displayText });
      }
    }
    return { text, segments, ...(scientificContext.length ? { scientificContext } : {}) };
  }
  function readSourceText(element, options) { return extractSource(element, options).text; }
  function readRangeText(range) { return extractSource(range).text; }
  return { extractSource, readSourceText, readRangeText };
});
