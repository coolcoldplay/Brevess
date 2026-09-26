const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const reading = require('../core/reading-tools.js');
const format = require('../core/literature-note-format.js');
const sources = require('../core/literature-note-sources.js');
const storage = require('../core/literature-note-source-storage.js');
const sourceEditor = require('../core/literature-note-source-editor.js');
const exporter = require('../core/literature-note-export.js');
const shared = { ...reading, ...format, ...sources, ...storage, ...sourceEditor, ...exporter };
globalThis.SciLLM = { ...globalThis.SciLLM, ...shared };
const source = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
const context = { SciLLM: shared };
vm.runInNewContext(source.slice(source.indexOf('// DOM-independent popup UI helpers: start'),
  source.indexOf('// DOM-independent popup UI helpers: end')) + '\nglobalThis.helpers=PopupUiHelpers;', context);
const A = 'p-0123456789abcdef';
const B = 'p-fedcba9876543210';
const template = { id: 't', name: '实验笔记', fields: [{ id: 'f', label: '步骤与证据' }] };

test('NOTE-007 integration review: plain copy retains explicit step numbers used by scientific cross-references', () => {
  const value = '7. 给药\n11. 取样\n\n按步骤 11 分析，不重复步骤 7。';
  const result = exporter.createLiteratureNoteExport({ template, values: { f: value }, format: 'text' });
  assert.equal(result.ok, true);
  assert.match(result.text, /^7\. 给药$/m);
  assert.match(result.text, /^11\. 取样$/m);
  assert.match(result.text, /按步骤 11 分析，不重复步骤 7。/);
});

test('NOTE-007 integration review: plain copy retains an explicit scientific source link destination', () => {
  const url = 'https://example.test/paper?cohort=treated#figure-7';
  const value = `阴性结果见[Figure 7](${url})，不支持充分性。`;
  const result = exporter.createLiteratureNoteExport({ template, values: { f: value }, format: 'text' });
  assert.equal(result.ok, true);
  assert.ok(result.text.includes(url), 'The link label alone loses the referenced paper/cohort/figure.');
  assert.match(result.text, /不支持充分性/);
});

function fixture(value) {
  const textarea = new EventTarget();
  Object.assign(textarea, { value, selectionStart: 0, selectionEnd: 0,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } });
  const binding = sourceEditor.attachLiteratureNoteSourceEditor({ textarea });
  const state = { schemaVersion: 3, templateId: 't', valuesByTemplate: { t: { f: value } } };
  let saved = 0;
  textarea.addEventListener('input', () => {
    context.helpers.applyLiteratureNoteManualInput({ state, templateId: 't', fieldId: 'f', value: binding.canonicalValue() });
    saved += 1;
  });
  function replace(start, end, text, type = 'insertText') {
    textarea.setSelectionRange(start, end);
    const before = new Event('beforeinput', { cancelable: true });
    Object.assign(before, { inputType: type, data: text });
    if (!textarea.dispatchEvent(before)) return false;
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
    const input = new Event('input'); Object.assign(input, { inputType: type }); textarea.dispatchEvent(input);
    return true;
  }
  function history(value, type) {
    textarea.value = value;
    const input = new Event('input'); Object.assign(input, { inputType: type }); textarea.dispatchEvent(input);
  }
  return { textarea, binding, state, replace, history, saves: () => saved };
}

test('NOTE-007 integration review: source capture persists canonical text through replacement undo/redo', () => {
  const original = `结果（${A}），不支持充分性。`;
  const f = fixture(original);
  const display = f.textarea.value;
  f.replace(0, display.length, '人工改写结果');
  assert.equal(f.state.valuesByTemplate.t.f, '人工改写结果');
  f.history(display, 'historyUndo');
  assert.equal(f.state.valuesByTemplate.t.f, original);
  f.history('人工改写结果', 'historyRedo');
  assert.equal(f.state.valuesByTemplate.t.f, '人工改写结果');
  assert.equal(f.saves(), 3);
});

test('NOTE-007 integration review: token damage never reaches the canonical save helper', () => {
  const original = `结果（${A}）`;
  const f = fixture(original);
  const before = f.textarea.value;
  const token = f.binding.projection.references[0];
  assert.equal(f.replace(token.start + 1, token.start + 2, '坏'), false);
  f.textarea.value = before.slice(0, -1);
  f.textarea.dispatchEvent(new Event('input'));
  assert.equal(f.saves(), 0);
  assert.equal(f.state.valuesByTemplate.t.f, original);
  assert.equal(f.textarea.value, before);
});

test('NOTE-007 integration review: AI refresh binds subsequent manual input to only the replacement source', () => {
  const f = fixture(`旧结果（${A}）`);
  f.textarea.value = `新结果（${B}）`;
  f.binding.refresh(f.textarea.value);
  f.replace(0, 0, '补充：');
  assert.equal(f.state.valuesByTemplate.t.f, `补充：新结果（${B}）`);
  assert.doesNotMatch(f.state.valuesByTemplate.t.f, new RegExp(A));
});

for (const receipt of [undefined, { documentHash: 'other', records: [{ paragraphId: A }] }]) {
  test(`NOTE-007 integration review: ${receipt ? 'foreign' : 'missing'} HTML receipt preserves body and reports unsaved sources`, () => {
    const state = { schemaVersion: 3, templateId: 't', valuesByTemplate: { t: {} } };
    const result = context.helpers.applyLiteratureNoteAutofillResult({ template, state, result: {
      values: { f: '阴性结果，不支持充分性。' }, fieldStatus: { f: 'supported' }, sources: { f: [A] },
      documentHash: 'current', evidenceReceipt: receipt
    } });
    assert.equal(state.valuesByTemplate.t.f, '阴性结果，不支持充分性。');
    assert.equal(result.sourceWarnings.length, 1);
    assert.equal(result.counts.filled, 1);
    assert.equal(state.fieldEvidenceByTemplate?.t?.f, undefined);
  });
}

test('NOTE-007 integration review: an old source button refuses focus after the note document changes', async () => {
  let generation = 1;
  const buttons = [];
  const calls = [];
  const list = { replaceChildren() { buttons.length = 0; }, appendChild(button) { buttons.push(button); } };
  const ctx = {
    currentWorkspaceSnapshot: { revision: 1, paragraphs: [{ paragraphId: A, sourceKey: 's', sectionTitle: '结果' }] },
    literatureNoteDocumentState: { templateId: 't' },
    captureLiteratureNoteContext: () => generation,
    isCurrentLiteratureNoteContext: token => token === generation,
    capturePanelContext: () => generation,
    isCurrentPanelContext: token => token === generation,
    focusWorkspaceSourceDetailed: async target => { calls.push(target); return { success: true, focused: true }; },
    showStatus() {},
    document: { createElement() { return { isConnected: true, addEventListener(_type, callback) { this.click = callback; } }; } }
  };
  vm.runInNewContext(source.slice(source.indexOf('function renderLiteratureNoteSourceList('),
    source.indexOf('function currentLiteratureNoteExport(')), ctx);
  ctx.renderLiteratureNoteSourceList({ dataset: { literatureNoteField: 'f' }, closest: () => ({ querySelector: () => list }) },
    sources.projectLiteratureNoteSources(`结果（${A}）`));
  assert.equal(buttons.length, 1);
  generation += 1;
  await buttons[0].click();
  assert.equal(calls.length, 0);
  assert.equal(buttons[0].disabled, true);
});
