(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const COLORS = Object.freeze({ black: '#242424', red: '#b42318', orange: '#995700',
    green: '#216e39', blue: '#175cd3', purple: '#6938a8' });

  // Construct nodes from the bounded note AST. Never interpret stored note HTML.
  function renderLiteratureNoteMarkdown(documentRef, text, options = {}) {
    const source = String(text ?? '');
    const parser = options.parse || shared.parseLiteratureNoteMarkdown;
    const fallback = {
      type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', text: source }] }]
    };
    let tree = fallback;
    try { if (typeof parser === 'function') tree = parser(source); } catch (_) {}
    const fragment = documentRef.createDocumentFragment();
    let nodes = 0;
    const render = (node, depth = 0) => {
      if (!node || typeof node !== 'object' || depth > 32 || ++nodes > 20000) {
        throw new Error('NOTE_FORMAT_RENDER_LIMIT');
      }
      if (node.type === 'text') return documentRef.createTextNode(String(node.text ?? ''));
      let element;
      switch (node.type) {
        case 'paragraph':
          element = documentRef.createElement('p');
          element.style.whiteSpace = 'pre-wrap';
          break;
        case 'strong': element = documentRef.createElement('strong'); break;
        case 'emphasis': element = documentRef.createElement('em'); break;
        case 'code':
          element = documentRef.createElement('code');
          element.textContent = String(node.text ?? '');
          return element;
        case 'color':
          element = documentRef.createElement('span');
          if (Object.hasOwn(COLORS, node.color)) {
            element.dataset.brevessColor = node.color;
            element.style.color = COLORS[node.color];
          }
          break;
        case 'link': {
          let url;
          try { url = new URL(String(node.url || '')); } catch (_) {}
          element = documentRef.createElement(url && ['https:', 'http:'].includes(url.protocol) ? 'a' : 'span');
          if (element.tagName.toLowerCase() === 'a') {
            element.href = url.href;
            element.target = '_blank';
            element.rel = 'noopener noreferrer';
          }
          break;
        }
        case 'list':
          element = documentRef.createElement(node.ordered ? 'ol' : 'ul');
          if (node.ordered && Number.isSafeInteger(node.start) && node.start >= 0) element.start = node.start;
          for (const item of Array.isArray(node.items) ? node.items : []) element.appendChild(render(item, depth + 1));
          return element;
        case 'listItem':
          element = documentRef.createElement('li');
          if (Number.isSafeInteger(node.value) && node.value >= 0) element.value = node.value;
          break;
        default: throw new Error('NOTE_FORMAT_NODE_INVALID');
      }
      for (const child of Array.isArray(node.children) ? node.children : []) element.appendChild(render(child, depth + 1));
      return element;
    };
    try {
      if (tree?.type !== 'document' || !Array.isArray(tree.children)) throw new Error('NOTE_FORMAT_ROOT_INVALID');
      for (const block of tree.children) fragment.appendChild(render(block));
    } catch (_) {
      // Keep the original text if a malformed/oversized AST cannot be rendered.
      fragment.replaceChildren(documentRef.createTextNode(source));
    }
    return fragment;
  }
  return { renderLiteratureNoteMarkdown };
});
