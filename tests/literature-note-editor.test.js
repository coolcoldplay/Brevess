const test = require('node:test');
const assert = require('node:assert/strict');
require('../core/literature-note-format.js');
require('../core/literature-note-renderer.js');
const { attachLiteratureNoteEditor } = require('../core/literature-note-editor.js');

class FakeInputEvent extends Event {
  constructor(type, options = {}) { super(type, options); this.data = options.data; this.inputType = options.inputType; this.isComposing = !!options.isComposing; }
}
class Element extends EventTarget {
  constructor(doc, tag) {
    super(); this.ownerDocument = doc; this.tagName = tag.toUpperCase(); this.children = [];
    this.style = {}; this.dataset = {}; this.attributes = {}; this.hidden = false; this.disabled = false;
    this.readOnly = false; this.selectionStart = 0; this.selectionEnd = 0; this.selectionDirection = 'none'; this.value = '';
  }
  appendChild(node) {
    if (node.tagName === '#FRAGMENT') { for (const child of [...node.children]) this.appendChild(child); return node; }
    this.children.push(node); node.parentNode = this; return node;
  }
  replaceChildren(...nodes) { this.children = []; this._text = ''; for (const node of nodes) this.appendChild(node); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(node => node.textContent).join(''); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  focus() { this.ownerDocument.activeElement = this; this.dispatchEvent(new Event('focus')); }
  setSelectionRange(start, end, direction = 'none') { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
  setRangeText(replacement, start, end) { this.value = this.value.slice(0, start) + replacement + this.value.slice(end); this.setSelectionRange(start + replacement.length, start + replacement.length); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}
const descendants = node => [node, ...node.children.flatMap(descendants)];
function fixture(value = '前文 未见变化 后文', mode = 'native') {
  const doc = { defaultView: { Event, InputEvent: FakeInputEvent },
    createElement(tag) { return new Element(this, tag); },
    createElementNS(_namespace, tag) { return new Element(this, tag); },
    createTextNode(text) { const node = new Element(this, '#text'); node.textContent = text; return node; },
    createDocumentFragment() { return new Element(this, '#fragment'); } };
  const textarea = doc.createElement('textarea'); textarea.value = value;
  const host = doc.createElement('div'); host.appendChild(textarea);
  const events = [];
  textarea.addEventListener('input', event => events.push({ value: textarea.value, data: event.data, type: event.inputType }));
  let nativeCalls = 0;
  doc.execCommand = (command, _ui, replacement) => {
    nativeCalls += 1; assert.equal(command, 'insertText');
    if (mode === 'throw') throw Error('unsupported');
    if (mode === 'fallback') return false;
    const before = new FakeInputEvent('beforeinput', { cancelable: true, bubbles: true, data: replacement });
    if (!textarea.dispatchEvent(before)) return false;
    textarea.setRangeText(replacement, textarea.selectionStart, textarea.selectionEnd);
    textarea.dispatchEvent(new FakeInputEvent('input', { bubbles: true, data: replacement, inputType: 'insertText' }));
    return true;
  };
  const editor = attachLiteratureNoteEditor({ textarea }); host.appendChild(editor.element);
  const find = predicate => descendants(editor.element).find(predicate);
  const action = name => find(node => node.dataset.noteFormatAction === name);
  const color = find(node => node.tagName === 'SELECT');
  const toggle = find(node => node.className === 'literature-note-editor-toggle');
  const preview = find(node => node.className === 'literature-note-editor-preview');
  const status = find(node => node.className === 'literature-note-editor-status');
  const select = (start, end) => { textarea.setSelectionRange(start, end); textarea.dispatchEvent(new Event('select')); };
  return { doc, textarea, host, editor, action, color, toggle, preview, status, select, events, nativeCalls: () => nativeCalls };
}

test('NOTE-007 editor uses ownerDocument and leaves the existing textarea in place by default', () => {
  const f = fixture();
  assert.equal(f.host.children[0], f.textarea);
  assert.equal(f.textarea.hidden, false);
  assert.equal(f.preview.hidden, true);
  assert.equal(f.editor.element.ownerDocument, f.doc);
  assert.equal(f.editor.element.style.gridColumn, '1 / -1');
  assert.equal(f.status.getAttribute('aria-live'), 'polite');
  assert.equal(f.color.getAttribute('aria-label'), '设置选中文字颜色');
  assert.deepEqual(f.color.children.slice(1).map(node => node.value), ['black', 'red', 'orange', 'green', 'blue', 'purple']);
});

test('NOTE-007 editor translates labels and rejects a non-textarea attachment', () => {
  const f = fixture(); f.editor.destroy();
  const editor = attachLiteratureNoteEditor({ textarea: f.textarea, translate: text => '译：' + text });
  const bold = descendants(editor.element).find(node => node.dataset.noteFormatAction === 'bold');
  assert.equal(bold.textContent, 'B');
  assert.equal(bold.getAttribute('aria-label'), '译：加粗选中文字');
  assert.equal(bold.getAttribute('title'), '译：加粗选中文字');
  assert.throws(() => attachLiteratureNoteEditor({ textarea: f.host }), /textarea/);
  editor.destroy();
});

for (const mode of ['native', 'fallback', 'throw']) {
  test(`NOTE-007 ${mode} insertion sends one input and preserves the selected words`, () => {
    const f = fixture(undefined, mode); f.select(3, 7);
    const down = new Event('mousedown', { cancelable: true }); f.action('bold').dispatchEvent(down);
    assert.equal(down.defaultPrevented, true);
    f.action('bold').click();
    assert.equal(f.textarea.value, '前文 **未见变化** 后文');
    assert.equal(f.textarea.value.slice(f.textarea.selectionStart, f.textarea.selectionEnd), '未见变化');
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0].value, f.textarea.value);
    assert.equal(f.nativeCalls(), 1);
    assert.match(f.status.textContent, /已应用/);
  });
}

test('NOTE-007 color selection preserves the earlier textarea range after control focus', () => {
  const f = fixture(); f.select(3, 7); f.color.focus(); f.color.value = 'red'; f.color.dispatchEvent(new Event('change'));
  assert.equal(f.textarea.value, '前文 <span data-brevess-color="red">未见变化</span> 后文');
  assert.equal(f.events.length, 1);
  assert.equal(f.color.value, '');
});

test('NOTE-007 composition prevents mutations and preview switching until compositionend', () => {
  const f = fixture(); f.select(3, 7); f.textarea.dispatchEvent(new Event('compositionstart'));
  assert.equal(f.action('bold').disabled, true); assert.equal(f.color.disabled, true); assert.equal(f.toggle.disabled, true);
  f.action('bold').dispatchEvent(new Event('click')); f.toggle.dispatchEvent(new Event('click'));
  assert.equal(f.textarea.value, '前文 未见变化 后文'); assert.equal(f.textarea.hidden, false); assert.equal(f.events.length, 0);
  assert.match(f.status.textContent, /组合输入/);
  f.textarea.dispatchEvent(new Event('compositionend')); assert.equal(f.action('bold').disabled, false);
  f.action('bold').click(); assert.equal(f.events.length, 1);
});

for (const property of ['disabled', 'readOnly']) {
  test(`NOTE-007 ${property} is checked at action time even before refresh`, () => {
    const f = fixture(); f.select(3, 7); f.textarea[property] = true;
    f.action('bold').dispatchEvent(new Event('click'));
    assert.equal(f.textarea.value, '前文 未见变化 后文'); assert.equal(f.events.length, 0);
    assert.equal(f.action('bold').disabled, true); assert.equal(f.color.disabled, true);
    f.textarea[property] = false; f.editor.refresh(); assert.equal(f.action('bold').disabled, false);
  });
}

test('NOTE-007 length and grapheme failures preserve value, selection and parent input count', () => {
  for (const [source, start, end, message] of [['科'.repeat(12000), 0, 1, /12000/], ['甲🧬乙', 2, 3, /边界/]]) {
    const f = fixture(source); f.select(start, end); f.action('bold').click();
    assert.equal(f.textarea.value, source); assert.equal(f.textarea.selectionStart, start); assert.equal(f.textarea.selectionEnd, end);
    assert.equal(f.events.length, 0); assert.match(f.status.textContent, message);
  }
});

test('NOTE-007 preview opens and refreshes from the current value using inert rendering', () => {
  const f = fixture('<img src=x onerror=alert(1)> **科学内容**');
  f.toggle.click(); assert.equal(f.preview.hidden, false); assert.equal(f.textarea.hidden, true);
  assert.equal(descendants(f.preview).some(node => node.tagName === 'IMG'), false);
  assert.equal(descendants(f.preview).some(node => node.tagName === 'STRONG'), true);
  f.textarea.value = '**当前新值**'; f.editor.refresh(); assert.equal(f.preview.textContent, '当前新值');
  f.toggle.click(); assert.equal(f.textarea.hidden, false);
  f.textarea.value = '第三版'; f.toggle.click(); assert.equal(f.preview.textContent, '第三版');
  assert.equal(f.events.length, 0, 'preview must never trigger a save');
});

test('NOTE-007 preview failure is an unchanged source fallback with a live explanation', () => {
  const f = fixture('<raw>科学</raw>'); const render = globalThis.SciLLM.renderLiteratureNoteMarkdown;
  try {
    globalThis.SciLLM.renderLiteratureNoteMarkdown = () => { throw Error('failure'); };
    f.toggle.click(); assert.equal(f.preview.textContent, '<raw>科学</raw>'); assert.match(f.status.textContent, /已显示原文/);
  } finally { globalThis.SciLLM.renderLiteratureNoteMarkdown = render; }
});

for (const mode of ['native', 'fallback']) {
  test(`NOTE-007 ${mode} beforeinput cancellation is not bypassed`, () => {
    const f = fixture(undefined, mode); f.select(3, 7);
    f.textarea.addEventListener('beforeinput', event => event.preventDefault());
    f.action('bold').click();
    assert.equal(f.textarea.value, '前文 未见变化 后文'); assert.equal(f.events.length, 0);
    assert.match(f.status.textContent, /取消/);
  });
}

test('NOTE-007 a parent input handler changing the value is not overwritten by fallback', () => {
  const f = fixture(); f.select(3, 7);
  f.textarea.addEventListener('input', () => { f.textarea.value = '父级最新值'; });
  f.action('bold').click();
  assert.equal(f.textarea.value, '父级最新值'); assert.equal(f.events.length, 1);
  assert.match(f.status.textContent, /保留当前/);
});

test('NOTE-007 fallback rechecks a parent state change during beforeinput', () => {
  const f = fixture(undefined, 'fallback'); f.select(3, 7);
  f.textarea.addEventListener('beforeinput', () => { f.textarea.disabled = true; });
  f.action('bold').click();
  assert.equal(f.textarea.value, '前文 未见变化 后文'); assert.equal(f.events.length, 0);
});

test('NOTE-007 destroy detaches component listeners, restores edit visibility and leaves parent listeners', () => {
  const f = fixture(); f.select(3, 7); f.toggle.click();
  const staleButton = f.action('bold'); f.editor.destroy(); f.editor.destroy();
  assert.equal(f.textarea.hidden, false); assert.equal(f.host.children.includes(f.editor.element), false);
  staleButton.dispatchEvent(new Event('click')); assert.equal(f.textarea.value, '前文 未见变化 后文');
  f.textarea.value = '父级仍可输入'; f.textarea.dispatchEvent(new FakeInputEvent('input'));
  assert.equal(f.events.length, 1); f.editor.refresh();
});

test('NOTE-007 parent may destroy the component during the native input event', () => {
  const f = fixture(); f.select(3, 7); f.textarea.addEventListener('input', () => f.editor.destroy());
  assert.doesNotThrow(() => f.action('bold').click());
  assert.equal(f.textarea.value, '前文 **未见变化** 后文'); assert.equal(f.events.length, 1);
});

test('NOTE-007 new manual or programmatic input clears a stale formatting failure', () => {
  const f = fixture(); f.select(0, 0); f.action('bold').click(); assert.match(f.status.textContent, /先选中/);
  f.textarea.value = '用户新输入'; f.textarea.dispatchEvent(new FakeInputEvent('input'));
  assert.equal(f.status.textContent, '');
  f.select(0, 0); f.action('bold').click(); assert.match(f.status.textContent, /先选中/);
  f.textarea.value = '父级新值'; f.editor.refresh(); assert.equal(f.status.textContent, '');
});
