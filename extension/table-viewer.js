(async function () {
  'use strict';
  const $ = id => document.getElementById(id), id = location.hash.slice(1);
  $('close').onclick = () => window.close();
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
  try {
    if (!/^[\da-f-]{36}$/.test(id)) throw Error('请从问答表格旁的「放大查看」重新打开。');
    const key = BrevessTableViewer.PREFIX + id, value = (await chrome.storage.session.get(key))[key];
    await chrome.storage.session.remove(key);
    if (!value?.rows || Date.now() - value.createdAt > 10 * 60 * 1000) throw Error('此表格快照已过期，请从问答中重新打开。');
    $('title').textContent = value.title;
    $('table').append(BrevessTableViewer.render(document, value));
    $('status').textContent = `${Math.max(0, value.rows.length - 1)} 行 · ${value.rows[0]?.length || 0} 列 · 表头固定，关闭后继续原对话`;
    let size = 14;
    const resize = delta => { size = Math.max(12, Math.min(24, size + delta)); document.body.style.setProperty('--table-font', size + 'px'); };
    $('smaller').onclick = () => resize(-1); $('larger').onclick = () => resize(1);
    $('wrap').onclick = () => { const nowrap = document.body.classList.toggle('no-wrap'); $('wrap').setAttribute('aria-pressed', String(!nowrap)); };
    $('copy').onclick = async () => { try { await navigator.clipboard.writeText(value.rows.map(row => row.map(c => c.text.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n')); $('status').textContent = '已复制，可粘贴到 Excel 或笔记。'; } catch { $('status').textContent = '复制失败，可直接选择表格文字复制。'; } };
    $('table').focus();
  } catch (e) { $('title').textContent = '暂时无法打开表格'; $('status').textContent = e.message; for (const b of document.querySelectorAll('button:not(#close)')) b.disabled = true; }
})();
