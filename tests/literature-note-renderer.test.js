const test = require('node:test');
const assert = require('node:assert/strict');
const { renderLiteratureNoteMarkdown } = require('../core/literature-note-renderer.js');
class Node {
  constructor(tag, text = '') { this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.dataset = {}; this.textContent = text; }
  appendChild(node) { this.children.push(node); }
  replaceChildren(...nodes) { this.children = nodes; }
}
const documentRef = { createElement: tag => new Node(tag), createTextNode: text => new Node('#text', text), createDocumentFragment: () => new Node('#fragment') };
const render = (children, text = 'original') => renderLiteratureNoteMarkdown(documentRef, text, { parse: () => ({ type: 'document', children }) });
const text = value => ({ type: 'text', text: value });

test('NOTE-007 renderer uses inert text nodes for HTML and code', () => {
  const result = render([{ type: 'paragraph', children: [text('<img src=x onerror=alert(1)>'), { type: 'code', text: '<script>bad()</script>' }] }]);
  assert.equal(result.children[0].children[0].tagName, '#TEXT');
  assert.equal(result.children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(result.children[0].children[1].tagName, 'CODE');
});

test('NOTE-007 renderer preserves nested list structure and explicit sequence numbers', () => {
  const result = render([{ type: 'list', ordered: true, start: 3, items: [
    { type: 'listItem', value: 3, children: [{ type: 'paragraph', children: [text('D4–D8, p < 0.05')] },
      { type: 'list', ordered: false, items: [{ type: 'listItem', children: [{ type: 'paragraph', children: [text('not causal')] }] }] }] },
    { type: 'listItem', value: 5, children: [{ type: 'paragraph', children: [text('D10')] }] }
  ] }]);
  const list = result.children[0]; assert.equal(list.tagName, 'OL'); assert.equal(list.start, 3);
  assert.equal(list.children[1].value, 5); assert.equal(list.children[0].children[1].tagName, 'UL');
});

test('NOTE-007 renderer permits only HTTP(S) links and fixed color values', () => {
  const result = render([{ type: 'paragraph', children: [
    { type: 'link', url: 'javascript:alert(1)', children: [text('danger')] },
    { type: 'link', url: 'https://example.test/paper?q=1', children: [text('source')] },
    { type: 'color', color: 'red', children: [text('selected only')] },
    { type: 'color', color: 'url(javascript:bad)', children: [text('inert')] }
  ] }]).children[0].children;
  assert.equal(result[0].tagName, 'SPAN'); assert.equal(result[0].href, undefined);
  assert.equal(result[1].rel, 'noopener noreferrer'); assert.equal(result[1].href, 'https://example.test/paper?q=1');
  assert.equal(result[2].style.color, '#b42318'); assert.equal(result[3].style.color, undefined);
});

test('NOTE-007 renderer falls back to unchanged source for an invalid AST', () => {
  const original = '科学原文 **text**'; const result = render([{ type: 'script', children: [] }], original);
  assert.equal(result.children[0].textContent, original);
});

test('NOTE-007 renderer retains all source if parsing fails', () => {
  const source = 'D4–D8 **原文** <span>literal</span>';
  const result = renderLiteratureNoteMarkdown(documentRef, source, { parse() { throw new Error('parse failed'); } });
  assert.equal(result.children[0].children[0].textContent, source);
});

test('NOTE-007 renderer never silently erases source for an invalid root', () => {
  for (const tree of [null, {}, { type: 'paragraph', children: [] }, { type: 'document', children: null }]) {
    const result = renderLiteratureNoteMarkdown(documentRef, '保留原文', { parse: () => tree });
    assert.equal(result.children[0]?.textContent, '保留原文');
  }
});
