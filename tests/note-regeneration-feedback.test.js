const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const start = source.indexOf('// DOM-independent popup UI helpers: start');
const end = source.indexOf('// DOM-independent popup UI helpers: end');
const context = {};
vm.runInNewContext(source.slice(start, end) + '\nglobalThis.helpers = PopupUiHelpers;', context);
const summarize = context.helpers.createLiteratureNoteAutofillSummary;

test('NOTE-007 single-field request forces generation while batch fill retains caching', () => {
  const body = source.slice(source.indexOf('async function autofillLiteratureNoteWithLLM('), source.indexOf('async function autofillLiteratureNoteFieldWithLLM('));
  assert.match(body, /action: 'autofillLiteratureNoteWithLLM',[\s\S]*?forceRefresh: Boolean\(targetField\)/u);
});

for (const item of [
  { counts: { filled: 1 }, options: {}, match: /已更新.*研究背景/, label: /已保存/, success: true },
  { counts: { filled: 1 }, options: { unchanged: true }, match: /内容无变化/, label: /无变化/, success: false },
  { counts: { preserved: 1 }, options: { preservedReason: 'edited' }, match: /请求期间.*修改.*保留/, label: /手工修改/, success: false },
  { counts: { preserved: 1 }, options: { preservedReason: 'missing' }, match: /证据不足.*保留/, label: /已有内容/, success: false },
  { counts: { missing: 1 }, options: {}, match: /未提供.*可用证据/, label: /证据不足/, success: false },
  { counts: { invalid: 1 }, options: {}, match: /无效.*未替换/, label: /无效/, success: false }
]) {
  test(`NOTE-007 single-field feedback distinguishes ${JSON.stringify(item.options)} ${JSON.stringify(item.counts)}`, () => {
    const summary = summarize(item.counts, false, { fieldLabel: '研究背景', ...item.options });
    assert.match(summary.message, item.match); assert.match(summary.buttonLabel, item.label);
    assert.equal(summary.success, item.success);
    if (!item.success) assert.notEqual(summary.tone, 'success');
    assert.doesNotMatch(summary.message, /已填写 0 个空白字段/);
  });
}

test('NOTE-007 cache feedback remains explicit when an older caller returns a cached result', () => {
  assert.match(summarize({ filled: 1 }, true, { fieldLabel: '研究背景' }).message, /复用本地结果/);
});
