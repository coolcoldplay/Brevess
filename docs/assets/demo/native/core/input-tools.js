(function (root) {
  'use strict';
  if (root.BrevessInputTools) return;
  const editingSelector = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]';
  function isEditingEvent(event) {
    if (event?.isComposing || event?.keyCode === 229) return true;
    const nodes = [...(event?.composedPath?.() || []), event?.target];
    let active = root.document?.activeElement;
    while (active) { nodes.push(active); active = active.shadowRoot?.activeElement; }
    return nodes.some(node => node?.isContentEditable || node?.closest?.(editingSelector));
  }
  root.BrevessInputTools = { isEditingEvent };
  const doc = root.document;
  if (!doc) return;
  const jobs = new WeakMap();
  let field = null, status = null, count = 0, lastSpace = 0, provider = null;
  function editable(node) {
    if (!node || node.disabled || node.readOnly) return null;
    if (node.tagName === 'TEXTAREA' || (node.tagName === 'INPUT' && ['text','search','url','tel',''].includes(node.type))) return node;
    if (node.isContentEditable) {
      while (node.parentElement?.isContentEditable) node = node.parentElement;
      return node;
    }
    return null;
  }
  const read = node => 'value' in node ? node.value : node.textContent;
  function paint(message = '') {
    if (!status && message) {
      status = doc.createElement('output'); status.dataset.sciPluginUi = 'true';
      status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
      status.style.cssText='position:fixed;bottom:16px;right:16px;z-index:2147483647;padding:8px 12px;background:white;color:#222;border:1px solid #ccc;border-radius:6px;font:13px sans-serif;pointer-events:none';
      doc.documentElement.append(status);
    }
    if(status){status.textContent=message;status.hidden=!message;}
  }
  function focus(event) {
    field = editable(event.composedPath?.()[0] || event.target); count = 0;
  }
  function caretOffset(node) {
    if ('selectionStart' in node) return node.selectionStart === node.selectionEnd ? node.selectionStart : null;
    const selection = doc.getSelection();
    if (!selection?.isCollapsed || !selection.rangeCount || !node.contains(selection.anchorNode)) return null;
    const range = selection.getRangeAt(0).cloneRange(); range.selectNodeContents(node);
    range.setEnd(selection.anchorNode, selection.anchorOffset); return range.toString().length;
  }
  function write(node, value) {
    if ('value' in node) {
      const proto = node.tagName === 'TEXTAREA' ? root.HTMLTextAreaElement.prototype : root.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
      node.setSelectionRange?.(value.length, value.length);
    } else { node.textContent = value; const r = doc.createRange(); r.selectNodeContents(node); r.collapse(false); const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r); }
    node.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }
  async function translate(node, snapshot, source) {
    const controller = new AbortController(); jobs.get(node)?.abort(); jobs.set(node, controller);
    paint('正在翻译…');
    try {
      if (!root.BrevessLocalTranslator) throw Error('翻译引擎未就绪');
      provider ||= root.BrevessLocalTranslator.createProvider({ sourceLanguage: 'zh', targetLanguage: 'en' });
      await provider.initialize({ signal: controller.signal });
      const result = await provider.translate(source, { signal: controller.signal, foreground: true });
      if (!controller.signal.aborted && node.isConnected && read(node) === snapshot && jobs.get(node) === controller) {
        jobs.delete(node); write(node, typeof result === 'string' ? result : result.translatedText);
      }
      if (field === node) paint();
    } catch (error) {
      if (field === node && !controller.signal.aborted) { paint('翻译失败：' + String(error?.message || error) + '；可再按三次空格重试'); }
    } finally { if (jobs.get(node) === controller) jobs.delete(node); }
  }
  doc.addEventListener('focusin', focus, true);
  doc.addEventListener('input', event => { const node = editable(event.composedPath?.()[0] || event.target); if (node) jobs.get(node)?.abort(); }, true);
  doc.addEventListener('keydown', event => {
    const node = editable(event.composedPath?.()[0] || event.target);
    if (!node || event.isComposing || event.keyCode === 229 || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.key !== ' ') { count = 0; return; }
    const now = Date.now(); count = node === field && now - lastSpace < 900 ? count + 1 : 1; lastSpace = now; field = node;
    if (count !== 3) return;
    count = 0; const snapshot = read(node), offset = caretOffset(node);
    if (offset === null || snapshot.slice(offset - 2, offset) !== '  ') return;
    const source = snapshot.slice(0, offset - 2) + snapshot.slice(offset);
    if (!source.trim() || source.length > 12000) return;
    event.preventDefault(); void translate(node, snapshot, source);
  }, true);
  root.addEventListener('pagehide', () => { if (field) jobs.get(field)?.abort(); provider?.destroy(); status?.remove(); status=null; }, { once: true });
})(globalThis);
