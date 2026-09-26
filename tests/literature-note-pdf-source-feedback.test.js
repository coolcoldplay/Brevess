const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const reading=require('../core/reading-tools.js');require('../core/literature-note-format.js');require('../core/literature-note-sources.js');
const exporter=require('../core/literature-note-export.js');
const source=fs.readFileSync(require.resolve('../popup.js'),'utf8');const context={SciLLM:{...reading}};
vm.runInNewContext(source.slice(source.indexOf('// DOM-independent popup UI helpers: start'),source.indexOf('// DOM-independent popup UI helpers: end'))+'\nglobalThis.h=PopupUiHelpers;',context);
const binding={documentId:'sha256:'+'a'.repeat(64),documentHash:'a'.repeat(64),documentGeneration:2,revision:7,semanticCacheKey:'cache-a',semanticProvenanceKey:'proof-a'};
const evidence={status:'verified',precision:'normalized-exact',degradedReasonCode:'',rebound:false,documentBinding:binding,locators:['First source','Second source'].map((quote,index)=>({locatorKind:'pdf-semantic',...binding,paragraphId:'semantic-'+index,normalizedStart:100,normalizedEnd:100+quote.length,expectedNormalizedQuote:quote})),pageAnchor:null};
test('PDF source targets independently address exact locator and refuse out-of-range indexes',()=>{
 assert.equal(context.h.createLiteratureNoteEvidenceFocusTarget(evidence,1).evidence.quote,'Second source');
 for(const index of [-1,2,1.5,NaN]) assert.equal(context.h.createLiteratureNoteEvidenceFocusTarget(evidence,index),null);
});
test('PDF source stale/ambiguous/missing/invalid states stay visible and cannot focus',()=>{
 for(const status of ['stale','ambiguous','missing','invalid']) {
  const record={...evidence,status,precision:'none',locators:[],degradedReasonCode:'SOURCE_NOT_FOUND'};
  const desc=context.h.describeLiteratureNoteFieldEvidence(record);
  assert.ok(desc.label.length>0,status);assert.equal(desc.focusable,false);assert.equal(desc.trusted,false);
  assert.equal(context.h.createLiteratureNoteEvidenceFocusTarget(record),null);
 }
});
test('PDF export includes all saved quotes with explicit revalidation boundary',()=>{
 const result=exporter.createLiteratureNoteExport({template:{fields:[{id:'f',label:'结果'}]},values:{f:'结论'},fieldEvidence:{f:evidence},format:'text'});
 assert.equal(result.ok,true);assert.match(result.text,/First source/);assert.match(result.text,/Second source/);assert.match(result.text,/未重新核验/);assert.doesNotMatch(result.text,/semantic-[01]/);
});
test('PDF stale export includes status without laundering old locator as verified',()=>{
 const result=exporter.createLiteratureNoteExport({template:{fields:[{id:'f',label:'结果'}]},values:{f:'结论'},fieldEvidence:{f:{...evidence,status:'stale',precision:'none',locators:[],degradedReasonCode:'SOURCE_NOT_FOUND'}}});
 assert.equal(result.ok,true);assert.match(result.text,/过期/);assert.doesNotMatch(result.text,/First source/);
});
