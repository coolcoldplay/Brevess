const test = require('node:test');
const assert = require('node:assert/strict');
const sources = require('../core/literature-note-sources.js');
globalThis.SciLLM = { ...globalThis.SciLLM, ...sources };
let editor;
try { editor = require('../core/literature-note-source-editor.js'); } catch (_) {}
const id = 'p-0123456789abcdef';
function fixture(value) {
  assert.equal(typeof editor?.attachLiteratureNoteSourceEditor, 'function');
  const textarea = new EventTarget();
  Object.assign(textarea, {value, selectionStart:0, selectionEnd:0,
    setSelectionRange(start,end) { this.selectionStart=start; this.selectionEnd=end; }});
  const errors=[];
  const binding=editor.attachLiteratureNoteSourceEditor({textarea,onError: value=>errors.push(value)});
  return {textarea,binding,errors};
}
function change(f,start,end,replacement,type='insertText') {
  f.textarea.setSelectionRange(start,end);
  const before=new Event('beforeinput',{cancelable:true}); Object.assign(before,{inputType:type,data:replacement});
  if (!f.textarea.dispatchEvent(before)) return false;
  f.textarea.value=f.textarea.value.slice(0,start)+replacement+f.textarea.value.slice(end);
  const input=new Event('input'); Object.assign(input,{inputType:type}); f.textarea.dispatchEvent(input);
  return true;
}
test('projects initial source while canonical accessor retains exact bytes',()=>{
  const f=fixture(`结果（${id}）`);
  assert.doesNotMatch(f.textarea.value,/p-012/); assert.equal(f.binding.canonicalValue(),`结果（${id}）`);
});
test('ordinary text edits retain stable markers and canonical sources',()=>{
  const f=fixture(`结果（${id}）`); const marker=f.binding.projection.registry[0].marker;
  change(f,0,2,'改写结果'); change(f,0,0,'**');
  assert.equal(f.binding.canonicalValue(),`**改写结果（${id}）`); assert.ok(f.textarea.value.includes(marker));
});
test('blocks partial source editing before input and preserves canonical',()=>{
  const f=fixture(`结果（${id}）`); const r=f.binding.projection.tokenRanges[0];
  assert.equal(change(f,r.start+1,r.start+2,'坏'),false); assert.equal(f.binding.canonicalValue(),`结果（${id}）`); assert.ok(f.errors.length);
});
test('real whole-field replacement can remove references, then undo restores registry',()=>{
  const f=fixture(`结果（${id}）`); const before=f.textarea.value;
  change(f,0,before.length,'人工新值'); assert.equal(f.binding.canonicalValue(),'人工新值');
  f.textarea.value=before; const e=new Event('input'); Object.assign(e,{inputType:'historyUndo'}); f.textarea.dispatchEvent(e);
  assert.equal(f.binding.canonicalValue(),`结果（${id}）`);
  f.textarea.value='人工新值'; const redo=new Event('input'); Object.assign(redo,{inputType:'historyRedo'}); f.textarea.dispatchEvent(redo);
  assert.equal(f.binding.canonicalValue(),'人工新值');
});
test('input without beforeinput rejects broken marker before delegated storage',()=>{
  const f=fixture(`结果（${id}）`); const before=f.textarea.value; let leaked=false;
  f.textarea.addEventListener('input',()=>{leaked=true;});
  f.textarea.value=before.slice(0,-1); f.textarea.dispatchEvent(new Event('input'));
  assert.equal(f.textarea.value,before); assert.equal(leaked,false); assert.equal(f.binding.canonicalValue(),`结果（${id}）`);
});
test('programmatic refresh starts a new projection and clears old mapping',()=>{
  const f=fixture(`结果（${id}）`); f.binding.refresh('AI新结果');
  assert.equal(f.textarea.value,'AI新结果'); assert.equal(f.binding.canonicalValue(),'AI新结果'); assert.equal(f.binding.projection.registry.length,0);
});
test('destroy removes interception and no longer changes input',()=>{
  const f=fixture(`结果（${id}）`); f.binding.destroy(); f.textarea.value='任意'; f.textarea.dispatchEvent(new Event('input')); assert.equal(f.textarea.value,'任意');
});
