const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  LITERATURE_NOTE_FORMAT_LIMITS: limits,
  LITERATURE_NOTE_COLORS: colors,
  parseLiteratureNoteMarkdown: parse,
  formatLiteratureNoteSelection: format,
  plainLiteratureNoteText: plain
} = require('../core/literature-note-format.js');
const { normalizeLiteratureNoteDocumentState: normalize } = require('../core/reading-tools.js');

function walk(node) {
  return [node, ...(node.children || node.items || []).flatMap(walk)];
}
const select = (text, selected, action, color) => format({ text, start: text.indexOf(selected),
  end: text.indexOf(selected) + selected.length, action, color });

test('NOTE-007 exports the same pure API through SciLLM and CommonJS', () => {
  const source = fs.readFileSync(path.join(__dirname, '../core/literature-note-format.js'), 'utf8');
  const context = { URL, Intl, SciLLM: { existing: true } };
  vm.runInNewContext(source, context);
  assert.equal(context.SciLLM.existing, true);
  assert.equal(typeof context.SciLLM.parseLiteratureNoteMarkdown, 'function');
  assert.equal(context.SciLLM.plainLiteratureNoteText('**中文**'), '中文');
  assert.doesNotMatch(source, /innerHTML|createElement|document\.|fetch\(/);
});

test('NOTE-007 parses paragraphs, nested inline formatting, code and safe links without changing source', () => {
  const source = '未见 **p-AKT *增加***，`p-03e11` 不是改写目标。\n仍为 1.25 μM。\n\n[论文](https://example.org/paper?q=1#fig2)';
  const ast = parse(source);
  assert.equal(ast.source, source);
  assert.equal(ast.type, 'document');
  assert.equal(ast.children.length, 2);
  assert.deepEqual(walk(ast).filter(node => ['strong', 'emphasis', 'code', 'link'].includes(node.type)).map(node => node.type),
    ['strong', 'emphasis', 'code', 'link']);
  assert.equal(plain(source), '未见 p-AKT 增加，p-03e11 不是改写目标。\n仍为 1.25 μM。\n\n论文');
});

test('NOTE-007 ordered list item values and mixed nested outlines preserve explicit order', () => {
  const source = '3. 未显著增加，p = 0.05\n  - Nefh−/−\n    7) 验证 1.25 μM\n  - 对照\n5. 仍无变化\n\n后续段落';
  const ast = parse(source);
  assert.equal(ast.source, source);
  assert.equal(ast.children[0].ordered, true);
  assert.equal(ast.children[0].start, 3);
  assert.deepEqual(ast.children[0].items.map(item => item.value), [3, 5]);
  assert.equal(ast.children[0].items[0].children[1].ordered, false);
  assert.equal(ast.children[0].items[0].children[1].items[0].children[1].items[0].value, 7);
  assert.equal(plain(source), '未显著增加，p = 0.05\nNefh−/−\n验证 1.25 μM\n对照\n仍无变化\n\n后续段落');
});

for (const source of [
  'p-AKT and p-ERK, p-03e11aa7449a007, 1.25 μM, 2*3*4, A_B_C',
  '1.25 ± 0.05\n-0.25 不等于 0\n未改变 β-catenin / Ca2+',
  '<img src=x onerror="alert(1)"><script>alert(1)</script>',
  '<span data-brevess-color="red" onclick="alert(1)">内容</span>',
  '<span style="color:red">内容</span>',
  '<span data-brevess-color="RED">内容</span>',
  '<span data-brevess-color=red>内容</span>',
  '<span data-brevess-color="pink">内容</span>',
  '<SPAN data-brevess-color="red">内容</SPAN>',
  '不闭合 **强调 与 `代码 与 <span data-brevess-color="red">颜色',
  '&lt;script&gt;alert(1)&lt;/script&gt;'
]) {
  test(`NOTE-007 keeps unsupported or scientific text literal: ${source.slice(0, 60)}`, () => {
    assert.equal(plain(source), source);
    assert.equal(parse(source).source, source);
    assert.deepEqual(walk(parse(source)).filter(node => ['color', 'link'].includes(node.type)), []);
  });
}

for (const url of [
  'javascript:alert(1)', 'data:text/html,evil', 'vbscript:evil', '//example.org',
  'file:///C:/note', 'https://user:pass@example.org/', 'https:\\example.org',
  'https://example.org/\u0000evil', 'https://example.org/<script>', 'http://',
  'java&#x73;cript:alert(1)', 'https://example.org/ space', 'https://example.org/"onclick="x'
]) {
  test(`NOTE-007 unsafe URL stays literal: ${JSON.stringify(url)}`, () => {
    const source = `[原文](${url})`;
    assert.equal(plain(source), source);
    assert.equal(walk(parse(source)).some(node => node.type === 'link'), false);
  });
}

for (const url of ['https://example.org/a_(b)?x=1&y=2#z', 'http://example.org/paper', 'https://例子.测试/论文']) {
  test(`NOTE-007 accepts safe HTTP(S) link: ${url}`, () => {
    const ast = parse(`[**原文**](${url})`);
    assert.equal(walk(ast).find(node => node.type === 'link').url, new URL(url).href);
    assert.equal(plain(ast.source), '原文');
  });
}

for (const color of colors) {
  test(`NOTE-007 exact ${color} span supports inline Markdown and round-trips schema 3`, () => {
    const source = `前文 <span data-brevess-color="${color}">**未增加** 1.25 μM</span> 后文`;
    const ast = parse(source);
    assert.equal(walk(ast).find(node => node.type === 'color').color, color);
    assert.equal(plain(source), '前文 未增加 1.25 μM 后文');
    const state = normalize({ schemaVersion: 3, templateId: 'test',
      valuesByTemplate: { test: { background: source } } });
    assert.equal(state.valuesByTemplate.test.background, source);
    assert.equal(normalize(JSON.parse(JSON.stringify(state))).valuesByTemplate.test.background, source);
  });
}

test('NOTE-007 nested colors retain exact scope and unknown nested span tags remain literal', () => {
  const source = '<span data-brevess-color="red">外<span data-brevess-color="blue">内</span><span style="color:green">未知</span>外</span>';
  assert.deepEqual(walk(parse(source)).filter(node => node.type === 'color').map(node => node.color), ['red', 'blue']);
  assert.equal(plain(source), '外内<span style="color:green">未知</span>外');
});

test('NOTE-007 code contents stay literal and escaped Markdown does not become formatting', () => {
  const source = '`**p-AKT** <span data-brevess-color="red">未变</span>` \\*原文\\* ``a`b``';
  assert.equal(plain(source), '**p-AKT** <span data-brevess-color="red">未变</span> *原文* a`b');
  assert.equal(walk(parse(source)).some(node => node.type === 'color' || node.type === 'strong'), false);
});

for (const [name, source] of [
  ['length', '科'.repeat(12001)],
  ['depth', '<span data-brevess-color="red">'.repeat(20) + '未变' + '</span>'.repeat(20)],
  ['nodes', '*x* '.repeat(2500)],
  ['work', '['.repeat(12000)]
]) {
  test(`NOTE-007 ${name} limit returns complete original text, never a truncated scientific claim`, () => {
    const ast = parse(source);
    assert.ok(ast.error);
    assert.equal(ast.source, source);
    assert.deepEqual(ast.children, [{ type: 'paragraph', children: [{ type: 'text', text: source }] }]);
    assert.equal(plain(source), source);
    assert.ok(walk(ast).length <= limits.maxNodes);
  });
}

test('NOTE-007 exactly 12000 characters and blank strings remain intact', () => {
  for (const source of ['', '\n\n', '科'.repeat(12000)]) {
    assert.equal(parse(source).error, undefined);
    assert.equal(parse(source).source, source);
    assert.equal(plain(source), source);
  }
});

test('NOTE-007 bold toggles only the selected words and tracks their UTF-16 selection', () => {
  const source = '前文 未见变化 后文';
  const result = select(source, '未见变化', 'bold');
  assert.deepEqual(result, { text: '前文 **未见变化** 后文', selectionStart: 5, selectionEnd: 9, changed: true });
  const reset = format({ text: result.text, start: result.selectionStart, end: result.selectionEnd, action: 'bold' });
  assert.equal(reset.text, source);
  assert.equal(reset.selectionStart, 3);
  assert.equal(reset.selectionEnd, 7);
});

test('NOTE-007 bold with outer whitespace preserves whitespace and formats just visible selection', () => {
  const result = select('前文  未增加  后文', ' 未增加 ', 'bold');
  assert.equal(result.error, undefined);
  assert.equal(result.text, '前文  **未增加**  后文');
});

test('NOTE-007 selected color never applies to an entire field and can be changed or nested', () => {
  const source = '对照 不增加 1.25 μM；后文不变';
  const result = select(source, '不增加 1.25 μM', 'color', 'red');
  assert.equal(result.text, '对照 <span data-brevess-color="red">不增加 1.25 μM</span>；后文不变');
  assert.equal(result.text.slice(result.selectionStart, result.selectionEnd), '不增加 1.25 μM');
  const recolored = format({ text: result.text, start: result.selectionStart, end: result.selectionEnd, action: 'color', color: 'blue' });
  assert.equal(walk(parse(recolored.text)).filter(node => node.type === 'color').length, 1);
  assert.equal(walk(parse(recolored.text)).find(node => node.type === 'color').color, 'blue');
  const nested = select(result.text, '1.25 μM', 'color', 'green');
  assert.deepEqual(walk(parse(nested.text)).filter(node => node.type === 'color').map(node => node.color), ['red', 'green']);
  assert.equal(plain(nested.text), source);
});

test('NOTE-007 multiline selected color uses balanced spans per line and keeps CRLF and blank lines', () => {
  const source = '甲\r\n\r\n乙\r\n丙';
  const result = format({ text: source, start: 0, end: source.length, action: 'color', color: 'purple' });
  assert.equal(result.error, undefined);
  assert.equal(walk(parse(result.text)).filter(node => node.type === 'color').length, 3);
  assert.equal(plain(result.text), source);
  assert.equal((result.text.match(/\r\n/g) || []).length, 3);
});

test('NOTE-007 bold across list items preserves outline markers and scientific content', () => {
  const source = '- 甲 1.25\n- 乙未增加';
  const result = format({ text: source, start: 0, end: source.length, action: 'bold' });
  assert.equal(result.error, undefined);
  assert.equal(result.text, '- **甲 1.25**\n- **乙未增加**');
  assert.equal(plain(result.text), plain(source));
});

test('NOTE-007 list actions affect touched lines only and exclude the next line at an exact end boundary', () => {
  const source = '前文\n甲 1.25\n乙未增加\n后文';
  const start = source.indexOf('甲');
  const end = source.indexOf('后文');
  const result = format({ text: source, start, end, action: 'bullet' });
  assert.equal(result.text, '前文\n- 甲 1.25\n- 乙未增加\n后文');
  assert.equal(result.text.slice(0, start), source.slice(0, start));
  assert.equal(result.text.slice(result.selectionEnd), source.slice(end));
  assert.equal(plain(result.text), source);
});

test('NOTE-007 ordered conversion preserves existing explicit numbering and body decimals', () => {
  const source = '3. 1.25 μM\n5. 未改变\n- Nefh−/−';
  const result = format({ text: source, start: 0, end: source.length, action: 'ordered' });
  assert.equal(result.text, '3. 1.25 μM\n5. 未改变\n6. Nefh−/−');
  assert.deepEqual(parse(result.text).children[0].items.map(item => item.value), [3, 5, 6]);
});

test('NOTE-007 list indent and outdent preserve all non-prefix bytes', () => {
  const source = '- 甲\n- 乙\n后文';
  const result = select(source, '- 乙', 'indent');
  assert.equal(result.text, '- 甲\n  - 乙\n后文');
  const reset = format({ text: result.text, start: result.selectionStart, end: result.selectionEnd, action: 'outdent' });
  assert.equal(reset.text, source);
  assert.equal(select('\t- 未改变', '- 未改变', 'outdent').text, '- 未改变');
});

test('NOTE-007 collapsed line formatting keeps a collapsed caret after the inserted prefix', () => {
  for (const text of ['', '科学内容']) {
    const result = format({ text, start: 0, end: 0, action: 'bullet' });
    assert.equal(result.text, '- ' + text);
    assert.equal(result.selectionStart, 2);
    assert.equal(result.selectionEnd, 2);
  }
});

for (const options of [
  { start: -1, end: 1, action: 'bold' },
  { start: 2, end: 1, action: 'bold' },
  { start: 0, end: 100, action: 'bold' },
  { start: 0.5, end: 1, action: 'bold' },
  { start: 0, end: 0, action: 'bold' },
  { start: 0, end: 1, action: 'unknown' },
  { start: 0, end: 1, action: 'color', color: 'url(javascript:evil)' },
  { start: 0, end: 1, action: 'color', color: 'Red' }
]) {
  test(`NOTE-007 invalid selection/action is an unchanged result: ${JSON.stringify(options)}`, () => {
    const text = '科学内容';
    const result = format({ text, ...options });
    assert.equal(result.text, text);
    assert.equal(result.changed, false);
    assert.equal(result.selectionStart, options.start);
    assert.equal(result.selectionEnd, options.end);
    assert.ok(result.error);
  });
}

for (const [text, start, end] of [['甲🧬乙', 2, 3], ['e\u0301', 0, 1], ['👩‍🔬', 0, 2], ['甲\r\n乙', 0, 2]]) {
  test(`NOTE-007 rejects a split grapheme or CRLF selection: ${JSON.stringify(text)}`, () => {
    const result = format({ text, start, end, action: 'bold' });
    assert.equal(result.changed, false);
    assert.equal(result.text, text);
    assert.equal(result.error, 'NOTE_SELECTION_INVALID');
  });
}

test('NOTE-007 complete Chinese/emoji selections remain unchanged semantically', () => {
  const result = select('甲🧬未变乙', '🧬未变', 'bold');
  assert.equal(result.text, '甲**🧬未变**乙');
  assert.equal(plain(result.text), '甲🧬未变乙');
});

for (const [source, selected] of [
  ['**前文 后文** 尾文', '后文** 尾文'],
  ['**前文**', '*前文'],
  ['`科学内容`', '科学'],
  ['[来源](https://example.org)', 'example'],
  ['<span data-brevess-color="red">前文</span>后文', '前文</span>后文']
]) {
  test(`NOTE-007 unsafe markup-crossing selection remains original: ${selected}`, () => {
    const result = select(source, selected, 'color', 'blue');
    assert.equal(result.changed, false);
    assert.equal(result.text, source);
    assert.ok(result.error);
  });
}

test('NOTE-007 malformed span content cannot escape newly selected color scope', () => {
  const source = '前文 </span> 后文';
  const result = format({ text: source, start: 0, end: source.length, action: 'color', color: 'red' });
  assert.equal(result.changed, false);
  assert.equal(result.text, source);
  assert.ok(result.error);
});

test('NOTE-007 wrapper overhead respects 12000 without truncating source or adjacent content', () => {
  const source = '科'.repeat(12000);
  for (const action of ['bold', 'color', 'bullet', 'ordered', 'indent']) {
    const result = format({ text: source, start: 1, end: 2, action, color: 'red' });
    assert.equal(result.text, source);
    assert.equal(result.changed, false);
    assert.equal(result.error, 'NOTE_TEXT_TOO_LONG');
  }
  const exact = '科'.repeat(11996);
  assert.equal(format({ text: exact, start: 0, end: exact.length, action: 'bold' }).text.length, 12000);
});

test('NOTE-007 formatter is deterministic, never mutates its argument, and preserves explicit empty text', () => {
  const input = Object.freeze({ text: '未变', start: 0, end: 2, action: 'bold' });
  assert.deepEqual(format(input), format(input));
  assert.equal(input.text, '未变');
  assert.equal(format({ text: '', start: 0, end: 0, action: 'outdent' }).changed, false);
  assert.equal(plain(''), '');
});

test('NOTE-007 recoloring a whole selected span returns the content selection for another edit', () => {
  const source = '<span data-brevess-color="red">未增加</span>';
  const blue = format({ text: source, start: 0, end: source.length, action: 'color', color: 'blue' });
  assert.equal(blue.text.slice(blue.selectionStart, blue.selectionEnd), '未增加');
  const green = format({ text: blue.text, start: blue.selectionStart, end: blue.selectionEnd, action: 'color', color: 'green' });
  assert.equal(green.error, undefined);
  assert.equal(green.text, '<span data-brevess-color="green">未增加</span>');
  const same = format({ text: source, start: 0, end: source.length, action: 'color', color: 'red' });
  assert.deepEqual(same, { text: source, selectionStart: 0, selectionEnd: source.length, changed: false });
});

test('NOTE-007 collapsed caret on the last empty line only inserts that line prefix', () => {
  const source = '已有内容\r\n';
  const result = format({ text: source, start: source.length, end: source.length, action: 'ordered' });
  assert.equal(result.text, source + '1. ');
  assert.equal(result.selectionStart, result.text.length);
  assert.equal(result.selectionEnd, result.text.length);
});

test('NOTE-007 invalid parser input produces a safe empty AST with an explicit error', () => {
  for (const source of [null, undefined, 42, {}]) {
    const ast = parse(source);
    assert.equal(ast.error, 'NOTE_TEXT_INVALID');
    assert.equal(ast.source, '');
    assert.equal(walk(ast).some(node => typeof node.text === 'object'), false);
  }
});
