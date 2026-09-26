const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../options-local-library.js'), 'utf8');
const pdf = require('../core/pdf-workspace.js');
class Node {
  constructor(tag, className = '', textContent = '') { Object.assign(this, { tag, className, textContent, children: [], attrs: {}, dataset: {} }); }
  append(...children) { this.children.push(...children); }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener() {}
}
const descendants = node => [node, ...node.children.flatMap(descendants)];
const text = node => [node.textContent, ...node.children.map(text)].join('');
function render(items, query = '') {
  const create = (tag, className, content) => new Node(tag, className, content);
  const body = source.slice(source.indexOf('  function coverageText('), source.indexOf('  function renderAbbreviations('));
  const linkSource = source.slice(source.indexOf('  function button('), source.indexOf('  function createShell('));
  const root = new Node('div');
  new Function('element', 'document', 'state', 'SCOPE_LABELS', 'SciLLM', 'chrome',
    `${linkSource}\n${body};return renderArticles;`)(create, { createTextNode: value => new Node('#text', '', value) },
      { query }, { notes: '笔记', fulltext: '全文', abstract: '摘要', method: '方法', caption: '图注' }, pdf,
      { runtime: { getURL: value => `chrome-extension://fixture/${value}` } })(root, items);
  return root;
}
const sample = { workspaceId: 'one', title: 'Same title', url: 'https://example.test/a',
  publicationDate: '2023-07', journal: 'Journal A', savedAt: '2026-09-22T09:17:23Z', coverage: { notes: true } };
test('articles use semantic four-column headings in the exact requested order', () => {
  const nodes = descendants(render([sample]));
  assert.equal(nodes.filter(node => node.tag === 'table').length, 1);
  assert.deepEqual(nodes.filter(node => node.tag === 'th').map(node => node.textContent),
    ['论文标题', '发表日期', '杂志名称', '保存时间']);
  assert.ok(nodes.filter(node => node.tag === 'th').every(node => node.attrs.scope === 'col'));
  assert.equal(nodes.filter(node => node.tag === 'td').length, 4);
});
test('publication precision is preserved and save metadata never borrows updated/created timestamps', () => {
  for (const publicationDate of ['2023', '2023-07', '2023-07-21']) {
    const cells = descendants(render([{ ...sample, publicationDate }])).filter(node => node.tag === 'td');
    assert.equal(text(cells[1]), publicationDate);
    assert.equal(text(cells[3]), sample.savedAt);
  }
  const cells = descendants(render([{ ...sample, publicationDate: undefined, journal: undefined, savedAt: undefined,
    createdAt: '2025-01-01', updatedAt: '2026-09-22' }])).filter(node => node.tag === 'td');
  assert.deepEqual(cells.slice(1).map(text), ['未记录', '未记录', '未记录']);
});
test('same-title articles stay distinct and untrusted metadata/tags/snippets remain literal text', () => {
  const malicious = '<img src=x onerror=alert(1)>';
  const root = render([{ ...sample, journal: malicious, tags: ['RTX', malicious],
    snippets: [{ scope: 'notes', label: malicious, text: malicious }], hitScopes: ['notes'] },
    { ...sample, workspaceId: 'two', url: 'https://example.test/b' }], 'RTX');
  const nodes = descendants(root);
  const rows = nodes.filter(node => node.className === 'local-library__article');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.dataset.workspaceId), ['one', 'two']);
  assert.ok(text(root).includes(malicious));
  assert.equal(nodes.some(node => node.tag === 'img' || node.tag === 'script'), false);
  assert.equal(nodes.filter(node => node.tag === 'details')[0].open, true);
  assert.ok(text(root).includes('已保存：笔记'));
});
test('HTTP and local/remote PDF links retain safe readers; arbitrary protocols are inert', () => {
  const local = pdf.buildLocalPdfWorkspaceUrl('paper.pdf', 'a'.repeat(64));
  for (const url of [sample.url, 'https://example.test/paper.pdf', local]) {
    const links = descendants(render([{ ...sample, url }])).filter(node => node.tag === 'a');
    assert.equal(links.length, 2);
    assert.equal(links[0].rel, 'noopener noreferrer');
    if (url !== sample.url) assert.equal(new URL(links[0].href).pathname, '/pdf-reader.html');
  }
  for (const url of ['javascript:alert(1)', 'file:///C:/private.txt', 'data:text/html,x']) {
    assert.equal(descendants(render([{ ...sample, url }])).some(node => node.tag === 'a'), false);
  }
});
test('empty and no-match states still differ and article rendering cannot mutate inputs', () => {
  assert.match(text(render([])), /尚未保存文献/);
  assert.match(text(render([], 'missing')), /没有匹配/);
  const items = [{ ...sample, tags: ['a', 'b'] }], before = JSON.stringify(items);
  render(items);
  assert.equal(JSON.stringify(items), before);
});
