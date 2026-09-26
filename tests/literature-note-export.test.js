const test=require('node:test');
const assert=require('node:assert/strict');
require('../core/literature-note-format.js');
require('../core/literature-note-sources.js');
const {createLiteratureNoteExport:build}=require('../core/literature-note-export.js');
const template={name:'文献笔记',fields:[{id:'a',label:'结果'},{id:'b',label:'局限'}]};
const id='p-0123456789abcdef';
test('Markdown export preserves lists, order, controlled colors and readable unverified source',()=>{
  const result=build({template,values:{a:`1. **结果**\n   - <span data-brevess-color="red">不充分</span>（${id}）`,b:'未知'}});
  assert.equal(result.ok,true);assert.doesNotMatch(result.text,/p-012/);assert.match(result.text,/1\. \*\*结果\*\*/);assert.match(result.text,/data-brevess-color="red"/);assert.match(result.text,/待核验/);assert.ok(result.text.indexOf('## 结果')<result.text.indexOf('## 局限'));
});
test('plain copy strips supported Markdown and colors without changing scientific values',()=>{
  const result=build({template,format:'text',values:{a:`**p-AKT降低**（${id}）\n<span data-brevess-color="red">10² != 102</span>`}});
  assert.equal(result.ok,true);assert.match(result.text,/p-AKT降低/);assert.match(result.text,/10² != 102/);assert.doesNotMatch(result.text,/\*\*|data-brevess-color|p-012/);
});
test('export rejects unsafe projection instead of dropping or truncating source',()=>{
  const value='长'.repeat(12001);const input={template,values:{a:value}};
  assert.equal(build(input).ok,false);assert.equal(input.values.a,value);
});
test('export does not mutate the note or invent source for empty fields',()=>{
  const values={a:'人工笔记',b:''};const before=JSON.stringify(values);
  assert.equal(build({template,values}).ok,true);assert.equal(JSON.stringify(values),before);
});
test('plain copy keeps literal formatting characters in fenced code across blank lines',()=>{
  const value='```js\n\nconst x = "**literal**";\n```\n\n**结论**';
  const result=build({template,values:{a:value},format:'text'});
  assert.equal(result.ok,true);assert.ok(result.text.includes('const x = "**literal**";'));
  assert.match(result.text,/\n结论\n/);assert.doesNotMatch(result.text,/\*\*结论\*\*/);
});
test('plain copy keeps indented code literals while formatting surrounding body',()=>{
  const value='**结论**\n\n    const x = "**literal**";';
  const result=build({template,values:{a:value},format:'text'});
  assert.equal(result.ok,true);assert.ok(result.text.includes('    const x = "**literal**";'));
  assert.doesNotMatch(result.text,/\*\*结论\*\*/);
});
