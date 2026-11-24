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
  let field = null, status = null, sequence = null, provider = null;
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
    const next = editable(event.composedPath?.()[0] || event.target);
    if (field !== next) { if (field) jobs.get(field)?.abort(); paint(); sequence = null; }
    field = next;
  }
  function caretOffset(node) {
    if ('selectionStart' in node) return node.selectionStart === node.selectionEnd ? node.selectionStart : null;
    const selection = doc.getSelection();
    if (!selection?.isCollapsed || !selection.rangeCount || !node.contains(selection.anchorNode)) return null;
    const range = selection.getRangeAt(0).cloneRange(); range.selectNodeContents(node);
    range.setEnd(selection.anchorNode, selection.anchorOffset); return range.toString().length;
  }
  function write(node, value) {
    if (node.isContentEditable) {
      const selection = doc.getSelection(), range = doc.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges(); selection.addRange(range);
      if (doc.execCommand('insertText', false, value)) return;
      range.deleteContents();
      const text = doc.createTextNode(value);
      range.insertNode(text); range.setStartAfter(text); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
    } else {
      const proto = node.tagName === 'TEXTAREA' ? root.HTMLTextAreaElement.prototype : root.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
      node.setSelectionRange?.(value.length, value.length);
    }
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
      if (!controller.signal.aborted && field === node && node.isConnected && read(node) === snapshot && jobs.get(node) === controller) {
        jobs.delete(node); write(node, typeof result === 'string' ? result : result.translatedText);
      }
      if (field === node) paint();
    } catch (error) {
      if (field === node && !controller.signal.aborted) { paint('翻译失败：' + String(error?.message || error) + '；可再按三次空格重试'); }
    } finally { if (jobs.get(node) === controller) jobs.delete(node); }
  }
  doc.addEventListener('focusin', focus, true);
  doc.addEventListener('input', event => { const node = editable(event.composedPath?.()[0] || event.target); if (node) jobs.get(node)?.abort(); }, true);
  doc.addEventListener('focusout', event => {
    const current = editable(event.composedPath?.()[0] || event.target);
    if (current && current === field && !current.contains(event.relatedTarget)) {
      jobs.get(current)?.abort(); sequence = null; field = null; paint();
    }
  }, true);
  doc.addEventListener('compositionstart', () => { sequence = null; }, true);
  doc.addEventListener('keydown', event => {
    const node = editable(event.composedPath?.()[0] || event.target);
    if (!node || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat ||
        event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.key !== ' ') { sequence = null; return; }
    const now = Date.now(), current = read(node), caret = caretOffset(node);
    if (caret == null || !/\p{Script=Han}/u.test(current) || current.length > 12002) { sequence = null; return; }
    field = node;
    // Save the original before the browser inserts the first space. On macOS
    // the second may become a period, and contenteditable often inserts NBSP.
    const suffix = current.slice(caret);
    const added = sequence ? current.slice(sequence.prefix.length, caret) : '';
    if (!sequence || sequence.node !== node || now - sequence.time > 900 ||
        !current.startsWith(sequence.prefix) || suffix !== sequence.suffix ||
        !/^(?:[ \u00a0\u3000]{1,2}|[.。][ \u00a0\u3000]?)$/.test(added)) {
      sequence = {node, time: now, count: 1, prefix: current.slice(0,caret), suffix,
        source: node.isContentEditable ? node.innerText : current};
      return;
    }
    sequence.time = now;
    if (++sequence.count < 3) return;
    const source = sequence.source; sequence = null;
    event.preventDefault();
    void translate(node, current, source);
  }, true);
  root.addEventListener('pagehide', () => { if (field) jobs.get(field)?.abort(); provider?.destroy(); status?.remove(); status=null; }, { once: true });
})(globalThis);
