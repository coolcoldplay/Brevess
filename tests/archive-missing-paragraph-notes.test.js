const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
const start=source.indexOf("    const savedUi = byPath.get('ui/state.json');",source.indexOf('async function applyArticleWorkspaceAssetsUnsafe'));
const end=source.indexOf('    const savedLogicMaps = byPath.get(',start);
assert.ok(start>=0&&end>start);
function apply(assets,notes){
 const context={byPath:new Map(assets),articleParagraphNotes:notes,normalizeArticleNavigatorText:value=>String(value||'')};
 vm.runInNewContext(source.slice(start,end),context);
}
for(const assets of [[],[['ui/state.json',{}]],[['annotations/abbreviations.json',{}]]])test('ARCH-009 absent paragraph-notes asset preserves existing local note and metadata',()=>{
 const item={paragraphId:'p-1',note:'人工修订：无显著变化',updatedAt:'2026-09-23T01:01:00Z'};
 const notes=new Map([['p-1',item]]);apply(assets,notes);assert.strictEqual(notes.get('p-1'),item);
});
test('ARCH-009 explicit empty paragraph-note array remains an intentional clear',()=>{
 const notes=new Map([['p-1',{note:'old'}]]);apply([['annotations/paragraph-notes.json',{notes:[]}]],notes);assert.equal(notes.size,0);
});
test('ARCH-009 valid saved paragraph-note array still restores its provided values',()=>{
 const notes=new Map([['old',{note:'old'}]]);apply([['annotations/paragraph-notes.json',{notes:[{paragraphId:'p-2',note:'恢复来源明确的值',sourceKey:'s-2',updatedAt:'2026-09-23'}]}]],notes);
 assert.equal(notes.size,1);assert.equal(notes.get('p-2').note,'恢复来源明确的值');assert.equal(notes.get('p-2').sourceKey,'s-2');
});
