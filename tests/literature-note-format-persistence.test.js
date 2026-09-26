const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const format = require('../core/literature-note-format.js');
const reading = require('../core/reading-tools.js');
const source = fs.readFileSync(path.join(__dirname,'../popup.js'),'utf8');
const context = { SciLLM: { ...reading, ...format } };
vm.runInNewContext(source.slice(source.indexOf('// DOM-independent popup UI helpers: start'),source.indexOf('// DOM-independent popup UI helpers: end'))+'\nglobalThis.helpers=PopupUiHelpers;',context);
const apply = context.helpers.applyLiteratureNoteManualInput;
function state(value='D4–D8减少；D10恢复，不支持充分性。') {
 return {schemaVersion:3,templateId:'t',valuesByTemplate:{t:{f:value,other:'保留'}},fieldStatusByTemplate:{t:{f:'supported'}},fieldEvidenceByTemplate:{t:{f:{proof:'preserve'},other:{proof:'other'}}},fieldUpdatedAtByTemplate:{t:{f:1}}};
}
for(const action of ['bold','color','bullet','ordered','indent']) test(`NOTE-007 ${action} formatting retains source provenance and marks a newer value`,()=>{
 const s=state(action==='indent' ? '- D4–D8减少；D10恢复，不支持充分性。' : undefined);const before=structuredClone(s.fieldEvidenceByTemplate);
 const result=format.formatLiteratureNoteSelection({text:s.valuesByTemplate.t.f,start:0,end:5,action,color:'red'});
 assert.equal(result.changed,true);
 const mutation=apply({state:s,templateId:'t',fieldId:'f',value:result.text,mutationAt:10});
 assert.deepEqual(s.fieldEvidenceByTemplate,before);
 assert.equal(s.fieldStatusByTemplate.t.f,'supported');
 assert.equal(s.valuesByTemplate.t.f,result.text);
 assert.ok(s.fieldUpdatedAtByTemplate.t.f>1); assert.equal(mutation.preservedEvidence,true);
 assert.equal(s.valuesByTemplate.t.other,'保留');
});
test('NOTE-007 undoing and redoing formatting preserves provenance',()=>{
 const original='无显著差异';const s=state(original);
 for(const value of ['**无显著差异**',original,'**无显著差异**']) {
  apply({state:s,templateId:'t',fieldId:'f',value});assert.equal(s.fieldEvidenceByTemplate.t.f.proof,'preserve');
 }
});
for(const value of ['显著差异','', '**D4–D8增加；D10恢复，不支持充分性。**','<span style="color:red">D4–D8减少；D10恢复，不支持充分性。</span>']) test(`NOTE-007 content change invalidates provenance: ${value}`,()=>{
 const s=state();apply({state:s,templateId:'t',fieldId:'f',value});
 assert.equal(s.fieldEvidenceByTemplate.t.f,undefined);assert.equal(s.fieldEvidenceByTemplate.t.other.proof,'other');
});
test('NOTE-007 formatting preserves missing-evidence status without upgrading it',()=>{
 const s=state('正文未提供');s.fieldStatusByTemplate.t.f='missing';delete s.fieldEvidenceByTemplate.t.f;
 apply({state:s,templateId:'t',fieldId:'f',value:'**正文未提供**'});
 assert.equal(s.fieldStatusByTemplate.t.f,'missing');assert.equal(s.fieldEvidenceByTemplate.t.f,undefined);
});
