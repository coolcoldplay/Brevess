(function (root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api;
  root.BrevessTableViewer = api;
})(globalThis, function () {
  'use strict';
  const PREFIX = 'brevess.tableView.';
  const tags = new Set(['strong', 'em', 'code', 'sup', 'sub', 'br', 'a']);
  function safeLink(value) {
    try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
  }
  // Transfer structured inline content, never executable model HTML or event handlers.
  function inline(node) {
    if (node.nodeType === 3) return { text: node.textContent };
    const tag = node.tagName?.toLowerCase();
    if (['script', 'style', 'iframe', 'object', 'img'].includes(tag)) return { text: '' };
    const children = Array.from(node.childNodes || [], inline);
    return { tag: tags.has(tag) ? tag : 'span', href: tag === 'a' ? safeLink(node.href) : '', children };
  }
  function capture(table, title = '') {
    const rows = Array.from(table.rows, row => Array.from(row.cells, cell => ({
      header: cell.tagName === 'TH', align: ['left', 'center', 'right'].includes(cell.style.textAlign) ? cell.style.textAlign : 'left',
      content: inline(cell), text: cell.textContent
    })));
    const value = { title: String(title).slice(0, 500), rows, createdAt: Date.now() };
    if (rows.length > 2000 || rows.some(r => r.length > 100) || JSON.stringify(value).length > 1000000) throw Error('表格过大，请分段查看。');
    return value;
  }
  function render(doc, value) {
    const table = doc.createElement('table'), head = doc.createElement('thead'), body = doc.createElement('tbody');
    function append(parent, part) {
      if (typeof part?.text === 'string') { parent.append(doc.createTextNode(part.text)); return; }
      const tag = tags.has(part?.tag) ? part.tag : 'span', n = doc.createElement(tag);
      if (tag === 'a' && safeLink(part.href)) { n.href = safeLink(part.href); n.target = '_blank'; n.rel = 'noopener noreferrer'; }
      for (const child of part?.children || []) append(n, child);
      parent.append(n);
    }
    for (const [i, row] of value.rows.entries()) {
      const tr = doc.createElement('tr');
      for (const cell of row) { const td = doc.createElement(cell.header ? 'th' : 'td'); if (cell.header) td.scope = 'col'; td.style.textAlign = cell.align; append(td, cell.content); tr.append(td); }
      (i === 0 && row.every(c => c.header) ? head : body).append(tr);
    }
    table.append(head, body); return table;
  }
  async function open(table, { chromeApi = globalThis.chrome, screen = globalThis.screen, title } = {}) {
    const value = capture(table, title || document.querySelector('#sidePanelPaperTitle')?.textContent || '回答中的表格');
    const key = PREFIX + crypto.randomUUID();
    await chromeApi.storage.session.set({ [key]: value });
    try {
      await chromeApi.windows.create({ url: chromeApi.runtime.getURL('table-viewer.html') + '#' + key.slice(PREFIX.length), type: 'popup',
        width: Math.min(1280, screen?.availWidth || 1280), height: Math.min(820, screen?.availHeight || 820), focused: true });
    } catch (error) { await chromeApi.storage.session.remove(key); throw error; }
  }
  return { PREFIX, safeLink, inline, capture, render, open };
});
