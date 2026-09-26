// A small deterministic DOM double for ownership/offset contracts. Actual CSS,
// composed trees and visibility are exercised in verify-search024-dom.mjs.
function domFixture() {
  const records = [];
  const rect = { width: 100, height: 20, left: 0, right: 100, top: 0, bottom: 20 };
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {} };
  const element = (tag, attributes = {}, children = []) => {
    const node = { nodeType: 1, tagName: tag.toUpperCase(), childNodes: [], attributes,
      isConnected: true, hidden: false, style: {}, dataset: {},
      hasAttribute: key => Object.hasOwn(attributes, key), getAttribute: key => attributes[key],
      getRootNode: () => document, getBoundingClientRect: () => rect,
      matches(selector) { return selector.split(',').some(raw => {
        const value = raw.trim();
        if (value === '[data-sci-plugin-ui]') return Boolean(attributes.ui);
        if (value === '.sci-manual-note-marker') return attributes.note === true;
        return value.toUpperCase() === this.tagName;
      }); },
      closest(selector) { for (let item = this; item; item = item.parentElement) if (item.matches(selector)) return item; return null; },
      contains(child) { for (let item = child; item; item = item.parentElement) if (item === this) return true; return false; }
    };
    for (const child of children) {
      child.parentElement = node; child.parentNode = node; node.childNodes.push(child);
    }
    Object.defineProperty(node, 'children', { get: () => node.childNodes.filter(child => child.nodeType === 1) });
    return node;
  };
  const text = value => ({ nodeType: 3, nodeValue: value, isConnected: true, getRootNode: () => document });
  document.body = element('body'); document.head = element('head'); document.documentElement = element('html', {}, [document.head, document.body]);
  document.createRange = () => ({ selectNodeContents() {}, getClientRects: () => [rect],
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; } });
  document.defaultView = { addEventListener() {}, removeEventListener() {},
    getComputedStyle: node => ({ display: ['SPAN', 'MARK', 'SUP', 'A'].includes(node.tagName) ? 'inline' : 'block',
      opacity: '1', visibility: 'visible', overflowX: 'visible', overflowY: 'visible', ...node.style }),
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return records.splice(0); } }
  };
  const append = (...nodes) => { for (const node of nodes) { node.parentElement = document.body; node.parentNode = document.body; document.body.childNodes.push(node); } };
  return { document, element, text, append, records };
}
module.exports = { domFixture };
