const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  literatureNoteSemanticSignature: semantic,
  plainLiteratureNoteText: plain
} = require('../core/literature-note-format.js');

function signature(text) {
  const result = semantic(text);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(typeof result.signature, 'string');
  return result.signature;
}

test('characterization: plain export intentionally omits link targets and is not evidence equality', () => {
  assert.equal(plain('[原文](https://example.org/a)'), plain('[原文](https://example.org/b)'));
  assert.equal(plain('[原文](https://example.org/a)'), plain('原文'));
  assert.equal(plain('[原文](https://example.org/a) 原文'), plain('原文 [原文](https://example.org/a)'));
});

test('semantic signature exports through CommonJS and SciLLM without altering old plain API', () => {
  assert.equal(typeof semantic, 'function');
  const source = fs.readFileSync(path.join(__dirname, '../core/literature-note-format.js'), 'utf8');
  const context = { URL, Intl, SciLLM: { existing: true } };
  vm.runInNewContext(source, context);
  assert.equal(context.SciLLM.existing, true);
  assert.equal(context.SciLLM.literatureNoteSemanticSignature('**中文**').signature, signature('中文'));
  assert.equal(context.SciLLM.plainLiteratureNoteText('[中文](https://example.org)'), '中文');
});

for (const [name, left, right] of [
  ['changed target', '[原文](https://example.org/a)', '[原文](https://example.org/b)'],
  ['added link', '原文', '[原文](https://example.org/a)'],
  ['removed link', '[原文](https://example.org/a)', '原文'],
  ['link moved to second identical label', '[原文](https://example.org/a) 原文', '原文 [原文](https://example.org/a)'],
  ['same URL moved across identical paragraphs', '[原文](https://example.org/a)\n\n原文', '原文\n\n[原文](https://example.org/a)'],
  ['swapped URL-label association', '[甲](https://example.org/a) [乙](https://example.org/b)',
    '[甲](https://example.org/b) [乙](https://example.org/a)'],
  ['same URL differently bounded label', '[甲乙](https://example.org/a)', '[甲](https://example.org/a)乙'],
  ['link query', '[证据](https://example.org/?id=1)', '[证据](https://example.org/?id=2)'],
  ['link fragment', '[证据](https://example.org/#a)', '[证据](https://example.org/#b)'],
  ['visible label', '[甲](https://example.org/a)', '[乙](https://example.org/a)'],
  ['empty-label link presence', '甲乙', '甲[](https://example.org/a)乙'],
  ['empty-label link position', '[](https://example.org/a)甲乙', '甲[](https://example.org/a)乙'],
  ['code position', '`p-AKT` p-AKT', 'p-AKT `p-AKT`'],
  ['code role', '`p-AKT`', 'p-AKT'],
  ['code content', '`p=0.03`', '`p=0.04`'],
  ['negation', '未增加', '增加'],
  ['scientific number', 'n = 12, p = 0.03', 'n = 21, p = 0.03'],
  ['scientific symbol', 'Nefh−/−, 1.25 μM', 'Nefh+/+, 1.25 μM'],
  ['order', '- 先甲\n- 后乙', '- 后乙\n- 先甲'],
  ['unsafe target stays literal', '[原文](javascript:alert(1))', '[原文](javascript:alert(2))'],
  ['unknown HTML stays literal', '<span style="color:red">原文</span>', '原文']
]) {
  test('semantic change is detected: ' + name, () => {
    assert.notEqual(signature(left), signature(right));
  });
}

const original = '未见 p-AKT 增加，[证据](https://example.org/a?id=1#fig2)，`n = 12`。\n第二项：1.25 μM。';
for (const [name, formatted] of [
  ['bold', '**未见 p-AKT 增加**，[证据](https://example.org/a?id=1#fig2)，`n = 12`。\n第二项：1.25 μM。'],
  ['emphasis', '*未见 p-AKT 增加*，[证据](https://example.org/a?id=1#fig2)，`n = 12`。\n第二项：1.25 μM。'],
  ['color', '<span data-brevess-color="red">未见 p-AKT 增加，[证据](https://example.org/a?id=1#fig2)</span>，`n = 12`。\n第二项：1.25 μM。'],
  ['link label formatting', '未见 p-AKT 增加，[**证据**](https://example.org/a?id=1#fig2)，`n = 12`。\n第二项：1.25 μM。'],
  ['bullet list', '- 未见 p-AKT 增加，[证据](https://example.org/a?id=1#fig2)，`n = 12`。\n- 第二项：1.25 μM。'],
  ['ordered list', '3. 未见 p-AKT 增加，[证据](https://example.org/a?id=1#fig2)，`n = 12`。\n5. 第二项：1.25 μM。'],
  ['nested list indentation', '- 未见 p-AKT 增加，[证据](https://example.org/a?id=1#fig2)，`n = 12`。\n  - 第二项：1.25 μM。'],
  ['code wrapper formatting', '未见 p-AKT 增加，[证据](https://example.org/a?id=1#fig2)，**``n = 12``**。\n第二项：1.25 μM。']
]) {
  test('pure format is equivalent: ' + name, () => {
    assert.equal(signature(original), signature(formatted));
  });
}

test('nested inline wrappers and UTF-16 labels retain link location', () => {
  const base = '🧬 [中e\u0301文](https://例子.测试/论文) 中e\u0301文';
  const formatted = '<span data-brevess-color="blue">🧬 [**中e\u0301文**](https://例子.测试/论文)</span> 中e\u0301文';
  assert.equal(signature(base), signature(formatted));
  assert.notEqual(signature(base), signature('🧬 中e\u0301文 [中e\u0301文](https://例子.测试/论文)'));
});

test('link signature follows the existing parser normalized URL contract', () => {
  assert.equal(signature('[原文](HTTPS://EXAMPLE.ORG:443/a)'), signature('[原文](https://example.org/a)'));
});

test('inline code preserves Markdown-looking bytes and cannot manufacture a link', () => {
  const code = '`[原文](https://example.org/a) **p-AKT**`';
  assert.notEqual(signature(code), signature('[原文](https://example.org/a) **p-AKT**'));
  assert.equal(signature(code), signature('**' + code + '**'));
});

test('empty valid note and exact 12000-character note have usable signatures without truncation', () => {
  assert.equal(signature(''), signature(''));
  const source = '科'.repeat(12000);
  assert.ok(signature(source).includes(source));
  assert.notEqual(signature(source), signature(source.slice(0, -1) + '学'));
});

for (const [name, source] of [
  ['invalid undefined', undefined],
  ['invalid null', null],
  ['invalid object', { text: 'science' }],
  ['invalid number', 123],
  ['length', '科'.repeat(12001)],
  ['depth', '<span data-brevess-color="red">'.repeat(20) + '未变' + '</span>'.repeat(20)],
  ['nodes', '*x* '.repeat(2500)],
  ['work', '['.repeat(12000)]
]) {
  test('failed parse returns no reusable signature: ' + name, () => {
    const result = semantic(source);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
    assert.equal(Object.hasOwn(result, 'signature'), false);
  });
}

