(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  // The textarea contains a readable projection. Only canonicalValue is persisted.
  // Register before the format editor so invalid token changes never reach storage.
  function attachLiteratureNoteSourceEditor({ textarea, onError = () => {}, onChange = () => {} } = {}) {
    if (!textarea?.addEventListener) throw new TypeError('A textarea is required');
    const api = () => globalThis.SciLLM || shared;
    let projection;
    let pending = null;
    let destroyed = false;
    let acceptedHistory = [];
    const inside = offset => projection?.tokenRanges?.some(range => offset > range.start && offset < range.end);
    const warn = () => onError('来源标记不能拆开修改；请选中完整标记后替换或删除。当前内容已保留。');
    function refresh(canonical = textarea.value) {
      if (destroyed) return;
      pending = null;
      projection = api().projectLiteratureNoteSources(String(canonical));
      acceptedHistory = projection.ok ? [projection] : [];
      textarea.value = projection.displayText;
      onError(projection.ok ? '' : '来源显示暂不可用，已保留原文；请检查后再复制或导出。');
      onChange(projection);
    }
    function beforeInput(event) {
      pending = null;
      if (!projection?.ok || event.defaultPrevented) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const history = /^(historyUndo|historyRedo)$/.test(event.inputType || '');
      if (history) return;
      const singleDelete = start === end && projection.tokenRanges.some(range =>
        (event.inputType === 'deleteContentBackward' && start === range.end) ||
        (event.inputType === 'deleteContentForward' && start === range.start));
      if (inside(start) || inside(end) || singleDelete) {
        event.preventDefault(); warn(); return;
      }
      pending = { value: textarea.value, start, end, event };
    }
    function input(event) {
      if (destroyed) return;
      if (!projection?.ok) { refresh(textarea.value); return; }
      const edited = textarea.value;
      let result = api().restoreLiteratureNoteSources(projection, edited);
      if (!result.ok && /^(historyUndo|historyRedo)$/.test(event.inputType || '')) {
        // Only accept a complete string actually observed in this edit session.
        // Native undo can restore a whole-field replacement, not just a deletion.
        const prior = acceptedHistory.find(item => item.displayText === edited);
        if (prior) result = { ok: true, nextProjection: prior };
      }
      // Only a real beforeinput selection may justify replacement of complete
      // tokens together with body text. Do not invent an all-field edit on failure.
      if (!result.ok && pending && !pending.event.defaultPrevented && pending.value === projection.displayText) {
        const { value, start, end } = pending;
        const suffix = value.slice(end);
        if (edited.startsWith(value.slice(0, start)) && edited.endsWith(suffix) &&
            edited.length >= start + suffix.length) {
          result = api().restoreLiteratureNoteSources(projection, edited, { edits: [{
            start, end, text: edited.slice(start, edited.length - suffix.length)
          }] });
        }
      }
      pending = null;
      if (!result.ok) {
        const caret = Math.min(textarea.selectionStart, projection.displayText.length);
        textarea.value = projection.displayText;
        textarea.setSelectionRange(caret, caret);
        event.stopImmediatePropagation(); warn(); return;
      }
      projection = result.nextProjection;
      if (!acceptedHistory.some(item => item.displayText === projection.displayText)) {
        acceptedHistory.push(projection);
        if (acceptedHistory.length > 128) acceptedHistory.shift();
      }
      onError(''); onChange(projection);
    }
    textarea.addEventListener('beforeinput', beforeInput, true);
    textarea.addEventListener('input', input, true);
    refresh();
    return {
      get projection() { return projection; },
      canonicalValue() { return projection?.ok ? projection.canonicalText : textarea.value; },
      refresh,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        textarea.removeEventListener('beforeinput', beforeInput, true);
        textarea.removeEventListener('input', input, true);
        pending = null;
      }
    };
  }
  return { attachLiteratureNoteSourceEditor };
});
