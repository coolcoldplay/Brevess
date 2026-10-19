(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const COLORS = Object.freeze({ black: '黑色', red: '红色', orange: '橙色', green: '绿色', blue: '蓝色', purple: '紫色' });
  const ERRORS = Object.freeze({
    NOTE_TEXT_TOO_LONG: '格式标记会超过 12000 字符，已保留原文。',
    NOTE_SELECTION_INVALID: '选区边界无效，请重新选择完整文字；原文已保留。',
    NOTE_SELECTION_EMPTY: '请先选中需要设置格式的文字。',
    NOTE_SELECTION_IN_CODE: '代码片段内暂不添加文字格式，原文已保留。',
    NOTE_SELECTION_CROSSES_FORMAT: '选区跨过格式或链接标记，请只选择完整文字；原文已保留。',
    NOTE_FORMAT_AMBIGUOUS: '该选区无法安全设置格式，原文已保留。',
    NOTE_FORMAT_LIMIT: '格式内容过于复杂，已保留原文。',
    NOTE_COLOR_INVALID: '请选择列表中的文字颜色；原文已保留。'
  });

  function attachLiteratureNoteEditor({ textarea, translate = value => value, initialPreview = false, showToggle = true } = {}) {
    if (!textarea?.ownerDocument || String(textarea.tagName).toLowerCase() !== 'textarea') {
      throw new TypeError('attachLiteratureNoteEditor requires a textarea with ownerDocument');
    }
    const doc = textarea.ownerDocument;
    const view = doc.defaultView || globalThis;
    const initialHidden = textarea.hidden;
    const listeners = [];
    let destroyed = false;
    let composing = false;
    let previewing = Boolean(initialPreview);
    let applying = false;
    let selection;
    const api = () => (typeof globalThis !== 'undefined' ? globalThis.SciLLM : null) || shared;
    const t = value => {
      try { return String(translate(value) ?? value); } catch (_) { return value; }
    };
    const make = (tag, className, text = '') => {
      const node = doc.createElement(tag); node.className = className;
      if (text) node.textContent = t(text);
      return node;
    };
    const icon = name => {
      if (name === 'bold' || name === 'color') {
        const glyph = make('span', `literature-note-format-glyph is-${name}`);
        glyph.textContent = name === 'bold' ? 'B' : 'A';
        glyph.setAttribute('aria-hidden', 'true');
        return glyph;
      }
      const paths = {
        bullet: 'M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1',
        ordered: 'M10 6h11M10 12h11M10 18h11M3 3h1v5M2 8h4M2 12c0-2 4-2 4 0 0 1-4 3-4 5h4',
        indent: 'M3 4h18M11 9h10M11 15h10M3 20h18M2 12h6M5 9l3 3-3 3',
        outdent: 'M3 4h18M11 9h10M11 15h10M3 20h18M2 12h6M5 9l-3 3 3 3',
        preview: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
        edit: 'M14 5l5 5M3 21l5-1L21 7a2 2 0 0 0-5-5L3 15v6Z'
      };
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18');
      svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      const shape = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      shape.setAttribute('d', paths[name]); shape.setAttribute('fill', 'none');
      shape.setAttribute('stroke', 'currentColor'); shape.setAttribute('stroke-width', name === 'bullet' ? '2.4' : '1.8');
      shape.setAttribute('stroke-linecap', 'round'); shape.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(shape); return svg;
    };
    const on = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      listeners.push(() => target.removeEventListener(type, handler, options));
    };
    const element = make('div', 'literature-note-editor');
    element.setAttribute('data-brevess-interface', '');
    element.dataset.active = 'false';
    Object.assign(element.style, { display: 'grid', gap: '4px', gridColumn: '1 / -1', minWidth: '0', width: '100%', boxSizing: 'border-box' });
    const toolbar = make('div', 'literature-note-editor-toolbar');
    toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', t('笔记格式工具'));
    Object.assign(toolbar.style, { display: 'flex', flexWrap: 'wrap', gap: '4px', minWidth: '0' });
    const status = make('div', 'literature-note-editor-status');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
    const preview = make('div', 'literature-note-editor-preview');
    preview.setAttribute('data-i18n-user-content', '');
    preview.setAttribute('role', 'region'); preview.setAttribute('aria-label', t('笔记预览'));
    preview.tabIndex = 0; preview.hidden = true;
    Object.assign(preview.style, { minWidth: '0', overflowWrap: 'anywhere' });
    element.appendChild(toolbar); element.appendChild(status); element.appendChild(preview);
    // Keep controls mounted through the brief focus gap between a textarea and
    // its button/select. Hiding on blur would cancel the user's pointer click.
    if (typeof doc.addEventListener === 'function') {
      const activateForTarget = event => {
        element.dataset.active = String(event.target === textarea || element.contains(event.target));
      };
      on(doc, 'focusin', activateForTarget);
      on(doc, 'pointerdown', activateForTarget, true);
    }
    const announce = message => { status.textContent = message ? t(message) : ''; };
    const capture = () => {
      if (applying || destroyed) return;
      selection = { start: textarea.selectionStart ?? 0, end: textarea.selectionEnd ?? 0,
        direction: textarea.selectionDirection || 'none', value: textarea.value };
    };
    const restore = target => {
      try { textarea.focus({ preventScroll: true }); } catch (_) { textarea.focus(); }
      textarea.setSelectionRange(target.start, target.end, target.direction || 'none');
    };
    const formatButtons = [];
    for (const [action, name] of [
      ['bold', '加粗选中文字'], ['bullet', '设置无序列表'],
      ['ordered', '设置有序列表'], ['indent', '增加列表缩进'],
      ['outdent', '减少列表缩进']
    ]) {
      const button = make('button', 'literature-note-editor-action');
      button.appendChild(icon(action));
      button.type = 'button'; button.dataset.noteFormatAction = action;
      button.setAttribute('aria-label', t(name)); button.setAttribute('title', t(name));
      on(button, 'mousedown', event => { capture(); event.preventDefault(); });
      on(button, 'click', () => apply(action));
      toolbar.appendChild(button); formatButtons.push(button);
    }
    const colorLabel = make('label', 'literature-note-editor-color-label');
    colorLabel.appendChild(icon('color'));
    colorLabel.setAttribute('title', t('设置选中文字颜色'));
    const color = make('select', 'literature-note-editor-color');
    color.setAttribute('aria-label', t('设置选中文字颜色'));
    color.style.maxWidth = '100%';
    const placeholder = make('option', '', '设置选中文字颜色'); placeholder.value = ''; color.appendChild(placeholder);
    for (const [value, label] of Object.entries(COLORS)) {
      const option = make('option', '', label); option.value = value; color.appendChild(option);
    }
    on(color, 'mousedown', capture);
    on(color, 'focus', () => { if (selection?.value !== textarea.value) capture(); });
    on(color, 'change', () => { const value = color.value; color.value = ''; if (value) apply('color', value); });
    colorLabel.appendChild(color); toolbar.appendChild(colorLabel);
    const toggle = make('button', 'literature-note-editor-toggle');
    toggle.type = 'button'; toggle.setAttribute('aria-label', t('切换笔记编辑或预览')); toggle.setAttribute('aria-pressed', 'false');
    on(toggle, 'mousedown', capture);
    on(toggle, 'click', () => setPreview(!previewing, { focus: true }));
    if (showToggle) toolbar.appendChild(toggle);

    function setPreview(next, { focus = false } = {}) {
      if (destroyed) return false;
      if (composing) { announce('正在组合输入，请完成输入后再切换预览。'); return false; }
      capture();
      previewing = Boolean(next);
      refresh();
      if (focus && previewing) preview.focus();
      else if (focus && !textarea.disabled && !initialHidden) restore(selection);
      return true;
    }

    function refresh() {
      if (destroyed) return;
      if (selection && selection.value !== textarea.value && !applying && !composing) announce('');
      if (!selection || selection.value !== textarea.value) capture();
      textarea.hidden = previewing || initialHidden;
      element.dataset.previewing = String(previewing);
      const disabled = textarea.disabled || textarea.readOnly || composing || previewing || typeof api().formatLiteratureNoteSelection !== 'function';
      for (const button of formatButtons) button.disabled = Boolean(disabled);
      color.disabled = Boolean(disabled);
      toggle.disabled = composing;
      toggle.replaceChildren(icon(previewing ? 'edit' : 'preview'));
      toggle.setAttribute('title', t(previewing ? '编辑笔记' : '预览笔记'));
      toggle.setAttribute('aria-pressed', String(previewing));
      preview.hidden = !previewing;
      if (previewing) {
        const source = textarea.value;
        try {
          const formatter = api();
          if (typeof formatter.renderLiteratureNoteMarkdown !== 'function') throw new Error('renderer unavailable');
          const tree = typeof formatter.parseLiteratureNoteMarkdown === 'function'
            ? formatter.parseLiteratureNoteMarkdown(source) : null;
          const fragment = formatter.renderLiteratureNoteMarkdown(doc, source, tree ? { parse: () => tree } : {});
          preview.replaceChildren(fragment);
          announce(tree?.error ? (ERRORS[tree.error] || '预览无法解析格式，已保留原文。') : '');
        } catch (_) {
          preview.replaceChildren(doc.createTextNode(source));
          announce('预览暂不可用，已显示原文。');
        }
      }
    }

    function inputEvent(type, data, cancelable = false) {
      try { return new view.InputEvent(type, { bubbles: true, cancelable,
        inputType: 'insertText', data, isComposing: false }); }
      catch (_) { return new view.Event(type, { bubbles: true, cancelable }); }
    }

    function apply(action, selectedColor) {
      if (destroyed) return;
      if (composing) { announce('正在组合输入，请完成输入后再设置格式。'); return; }
      if (textarea.disabled || textarea.readOnly || previewing) { announce('当前笔记不可编辑，原文已保留。'); refresh(); return; }
      if (typeof api().formatLiteratureNoteSelection !== 'function') { announce('格式工具暂不可用，请重新打开笔记。'); return; }
      if (!selection || selection.value !== textarea.value) capture();
      const selected = { ...selection };
      const before = textarea.value;
      let result;
      try { result = api().formatLiteratureNoteSelection({ text: before, start: selected.start,
        end: selected.end, action, color: selectedColor }); }
      catch (_) { announce('无法设置选区格式，原文已保留。'); return; }
      if (result?.error || !result || typeof result.text !== 'string') {
        announce(ERRORS[result?.error] || '无法设置选区格式，原文已保留。'); restore(selected); return;
      }
      if (!result.changed) { announce('选区格式未改变。'); restore(selected); return; }
      let first = 0;
      while (first < before.length && first < result.text.length && before[first] === result.text[first]) first += 1;
      let last = before.length;
      let replacementEnd = result.text.length;
      while (last > first && replacementEnd > first && before[last - 1] === result.text[replacementEnd - 1]) { last -= 1; replacementEnd -= 1; }
      const replacement = result.text.slice(first, replacementEnd);
      const scrollTop = textarea.scrollTop;
      const scrollLeft = textarea.scrollLeft;
      let observedInput = false;
      let beforeInput = null;
      const observeInput = () => { observedInput = true; };
      const observeBeforeInput = event => { beforeInput = event; };
      textarea.addEventListener('input', observeInput, true);
      textarea.addEventListener('beforeinput', observeBeforeInput, true);
      applying = true;
      try {
        restore({ start: first, end: last });
        if (destroyed || composing || textarea.disabled || textarea.readOnly || textarea.value !== before) {
          announce('编辑期间内容或状态已更新，已保留当前内容。'); return;
        }
        // Native insertText is one undoable textarea edit in supported browsers.
        // Keep setRangeText as a functional fallback, without claiming native undo.
        try { if (typeof doc.execCommand === 'function') doc.execCommand('insertText', false, replacement); } catch (_) {}
        if (textarea.value !== result.text) {
          if (beforeInput?.defaultPrevented) { announce('编辑已取消，原文已保留。'); restore(selected); return; }
          if (observedInput || textarea.value !== before || destroyed || textarea.disabled || textarea.readOnly) {
            announce('编辑期间内容或状态已更新，已保留当前内容。'); return;
          }
          if (!beforeInput && !textarea.dispatchEvent(inputEvent('beforeinput', replacement, true))) {
            announce('编辑已取消，原文已保留。'); restore(selected); return;
          }
          if (destroyed || composing || textarea.disabled || textarea.readOnly || textarea.value !== before) {
            announce('编辑期间内容或状态已更新，已保留当前内容。'); return;
          }
          textarea.setRangeText(replacement, first, last, 'preserve');
        }
        if (textarea.value !== result.text) { announce('格式写入未完成，已保留当前内容。'); return; }
        textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
        textarea.scrollTop = scrollTop; textarea.scrollLeft = scrollLeft;
        if (!observedInput) textarea.dispatchEvent(inputEvent('input', replacement));
        if (!destroyed) announce('已应用选区格式。');
      } catch (_) {
        if (!destroyed) announce('格式写入未完成，已保留当前内容。');
      } finally {
        applying = false;
        textarea.removeEventListener('input', observeInput, true);
        textarea.removeEventListener('beforeinput', observeBeforeInput, true);
        if (!destroyed) { capture(); refresh(); }
      }
    }

    for (const event of ['select', 'keyup', 'mouseup', 'blur']) on(textarea, event, capture);
    on(textarea, 'input', event => {
      if (event.isComposing) composing = true;
      if (!applying) { if (!composing) announce(''); capture(); refresh(); }
    });
    on(textarea, 'compositionstart', () => {
      composing = true; announce('正在组合输入，请完成输入后再设置格式。'); refresh();
    });
    on(textarea, 'compositionend', () => { composing = false; announce(''); capture(); refresh(); });
    let observer;
    if (typeof view.MutationObserver === 'function') {
      observer = new view.MutationObserver(refresh);
      observer.observe(textarea, { attributes: true, attributeFilter: ['disabled', 'readonly'] });
    }
    capture(); refresh();
    return { element, refresh, setPreview, canSetPreview: () => !destroyed && !composing, destroy() {
      if (destroyed) return;
      destroyed = true; observer?.disconnect();
      for (const remove of listeners) remove();
      if (previewing) textarea.hidden = initialHidden;
      element.remove();
    } };
  }
  return { attachLiteratureNoteEditor };
});
