(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  // The textarea contains a readable projection. Only canonicalValue is persisted.
  // Register before the format editor so invalid token changes never reach storage.
  function attachLiteratureNoteSourceEditor({ textarea, sourceNumberRegistry, onError = () => {}, onChange = () => {} } = {}) {
    if (!textarea?.addEventListener) throw new TypeError('A textarea is required');
    const api = () => globalThis.SciLLM || shared;
    let projection;
    let pending = null;
    let destroyed = false;
    let acceptedHistory = [];
    function rememberProjection(value) {
      if (!value?.ok || acceptedHistory.some(item => item.displayText === value.displayText &&
          item.canonicalText === value.canonicalText)) return;
      acceptedHistory.push(value);
      if (acceptedHistory.length > 128) acceptedHistory.shift();
    }
    const inside = offset => projection?.tokenRanges?.some(range => offset > range.start && offset < range.end);
    const warn = () => onError('来源标记不能拆开修改；请选中完整标记后替换或删除。当前内容已保留。');
    function refresh(canonical = textarea.value) {
      if (destroyed) return;
      pending = null;
      projection = api().projectLiteratureNoteSources(String(canonical), { sourceNumberRegistry });
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
      const wholeToken = start === end && projection.tokenRanges.find(range =>
        (event.inputType === 'deleteContentBackward' && start === range.end) ||
        (event.inputType === 'deleteContentForward' && start === range.start));
      if (wholeToken) {
        // Virtual keyboards may send beforeinput without a preceding keydown.
        event.preventDefault();
        replaceRange('', wholeToken.start, wholeToken.end);
        return;
      }
      if (inside(start) || inside(end)) {
        event.preventDefault(); warn(); return;
      }
      pending = { value: textarea.value, start, end, event };
    }
    function input(event) {
      if (destroyed) return;
      if (!projection?.ok) { refresh(textarea.value); return; }
      const edited = textarea.value;
      let result = api().restoreLiteratureNoteSources(projection, edited);
      if (/^(historyUndo|historyRedo)$/.test(event.inputType || '')) {
        // Only accept a complete string actually observed in this edit session.
        // Numbering may have changed since observation. Never decode an old
        // display token using today's IDs, even when the token looks identical.
        const canonicalValues = new Set(acceptedHistory.filter(item => item.displayText === edited)
          .map(item => item.canonicalText));
        const nextProjection = canonicalValues.size === 1
          ? api().projectLiteratureNoteSources([...canonicalValues][0], { sourceNumberRegistry }) : null;
        result = nextProjection?.ok ? { ok: true, nextProjection } : { ok: false };
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
      if (textarea.value !== projection.displayText) textarea.value = projection.displayText;
      rememberProjection(projection);
      onError(''); onChange(projection);
    }
    const canonicalOffset = offset => {
      let delta = 0;
      for (const ref of projection?.references || []) {
        if (offset <= ref.start) break;
        if (offset < ref.end) return ref.canonicalStart;
        delta += (ref.canonicalEnd - ref.canonicalStart) - (ref.end - ref.start);
      }
      return offset + delta;
    };
    const displayOffset = offset => {
      let delta = 0;
      for (const ref of projection.references || []) {
        if (offset <= ref.canonicalStart) break;
        if (offset < ref.canonicalEnd) return ref.start;
        delta += (ref.end - ref.start) - (ref.canonicalEnd - ref.canonicalStart);
      }
      return Math.min(textarea.value.length, offset + delta);
    };
    function replaceRange(value, start = textarea.selectionStart, end = textarea.selectionEnd) {
      if (destroyed || textarea.disabled || textarea.readOnly || !projection?.ok ||
          textarea.value !== projection.displayText || !Number.isInteger(start) || !Number.isInteger(end) ||
          start < 0 || start > end || end > textarea.value.length) return false;
      if (inside(start) || inside(end)) { warn(); return false; }
      const left = canonicalOffset(start), right = canonicalOffset(end);
      const next = projection.canonicalText.slice(0, left) + value + projection.canonicalText.slice(right);
      const projected = api().projectLiteratureNoteSources(next, { sourceNumberRegistry });
      if (!projected.ok) { onError('笔记字段过长或来源格式无效。'); return false; }
      pending = null;
      projection = projected;
      rememberProjection(projected);
      textarea.value = projected.displayText;
      const caret = displayOffset(left + value.length);
      textarea.setSelectionRange(caret, caret);
      const EventType = textarea.ownerDocument?.defaultView?.Event || Event;
      textarea.dispatchEvent(new EventType('input', { bubbles: true }));
      return true;
    }
    function selectTokenForDeletion(event) {
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey ||
          textarea.readOnly || textarea.disabled || textarea.selectionStart !== textarea.selectionEnd) return;
      const caret = textarea.selectionStart;
      const token = projection?.tokenRanges?.find(range =>
        event.key === 'Backspace' && caret === range.end || event.key === 'Delete' && caret === range.start);
      // Selecting before the native editing command preserves ordinary keyboard undo.
      if (token) textarea.setSelectionRange(token.start, token.end);
    }
    textarea.addEventListener('keydown', selectTokenForDeletion);
    textarea.addEventListener('beforeinput', beforeInput, true);
    textarea.addEventListener('input', input, true);
    refresh();
    return {
      get projection() { return projection; },
      canonicalValue() { return projection?.ok ? projection.canonicalText : textarea.value; },
      replaceRange,
      setSourceNumberRegistry(registry) {
        if (JSON.stringify(sourceNumberRegistry) === JSON.stringify(registry)) return false;
        const start = canonicalOffset(textarea.selectionStart);
        const end = canonicalOffset(textarea.selectionEnd);
        sourceNumberRegistry = registry;
        const canonical = projection?.ok ? projection.canonicalText : textarea.value;
        projection = api().projectLiteratureNoteSources(canonical, { sourceNumberRegistry });
        textarea.value = projection.displayText;
        rememberProjection(projection);
        if (Number.isInteger(start) && Number.isInteger(end)) textarea.setSelectionRange?.(displayOffset(start), displayOffset(end));
        onError(projection.ok ? '' : '来源显示暂不可用，已保留原文；请检查后再复制或导出。');
        onChange(projection);
        return true;
      },
      refresh,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        textarea.removeEventListener('keydown', selectTokenForDeletion);
        textarea.removeEventListener('beforeinput', beforeInput, true);
        textarea.removeEventListener('input', input, true);
        pending = null;
      }
    };
  }
  return { attachLiteratureNoteSourceEditor };
});
