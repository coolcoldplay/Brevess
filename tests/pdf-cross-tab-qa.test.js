const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const pdf = require('../extension/web-filters-general/pdf-research-source.js');
const own = 'chrome-extension://test-extension/';
function snapshot() { return pdf.snapshot({phase:'text-ready',documentGeneration:3,structure:{documentHash:'hash-a'}}, {documentHash:'hash-a',revision:'semantic-2',paragraphs:[{paragraphId:'p1',text:'A'.repeat(2500)},{paragraphId:'p2',text:'The final page contains the control result.'}]},'Paper'); }
test('only the installed PDF reader is admitted',()=>{
 assert.equal(pdf.isReader(own+'pdf-reader.html?source=file:test',own),true);
 for(const url of ['https://example.com/pdf-reader.html','chrome-extension://other/pdf-reader.html',own+'fake/pdf-reader.html',own+'pdf-reader.html.evil']) assert.equal(pdf.isReader(url,own),false);
});
test('PDF source requires a completed, matching semantic document',()=>{
 assert.throws(()=>pdf.snapshot({phase:'loading'},null),/NOT_READY/);
 assert.throws(()=>pdf.snapshot({phase:'text-ready',structure:{documentHash:'a'}},{documentHash:'b',paragraphs:[{}]}),/DOCUMENT_CHANGED/);
});
test('PDF source pagination retains the full text, including offscreen pages',()=>{
 const s=snapshot(); assert.equal(s.records.length,4);assert.equal(s.version,'semantic-2');
 assert.equal(pdf.read(s,'read',{frameId:0,offset:0,limit:2}).next,2);
 assert.equal(pdf.read(s,'read',{frameId:0,offset:2,limit:2}).next,null);
 assert.equal(s.records.slice(0,3).map(r=>r.text).join(''),'A'.repeat(2500));
 const found=pdf.read(s,'find',{frameId:0,query:'control'});assert.equal(found.items.length,1);
 assert.equal(found.items[0].target.nativePdf.paragraphId,'p2');
 assert.throws(()=>pdf.read(s,'read',{frameId:1}),/FRAME/);
 assert.throws(()=>pdf.read(s,'read',{frameId:0,offset:-1}),/RANGE/);
 assert.throws(()=>pdf.read(s,'inspect',{frameId:0,id:'missing'}),/EVIDENCE_CHANGED/);
});
test('long PDF paragraph locators remain readable through bounded model tool IDs',()=>{
 const paragraphId='page-1-'+ 'long-document-locator-'.repeat(12);
 const s=pdf.snapshot({phase:'text-ready',structure:{documentHash:'a'}},{documentHash:'a',paragraphs:[{paragraphId,text:'Original evidence.'}]},'Paper');
 assert.ok(s.records[0].id.length<=80);
 const result=pdf.read(s,'read',{frameId:0,id:s.records[0].id});
 assert.equal(result.items[0].target.nativePdf.paragraphId,paragraphId);
 assert.equal(result.items[0].text,'Original evidence.');
});
function harness(){
 const native=snapshot(),tabs=new Map([[1,{id:1,title:'PDF',url:own+'pdf-reader.html?source=test'}],[2,{id:2,title:'Web',url:'https://example.org/paper'}]]);
 const s={console,URL,crypto:require('node:crypto').webcrypto,AbortController,setTimeout,clearTimeout};vm.createContext(s);
 vm.runInContext(fs.readFileSync(require.resolve('../extension/web-filters-general/schema.js'),'utf8'),s);
 s.BrevessPdfResearchSource=pdf;s.WFGResearch={};
 vm.runInContext(fs.readFileSync(require.resolve('../extension/web-filters-general/multitab.js'),'utf8'),s);
 const listener={addListener(){}};
 const browser={runtime:{id:'test-extension',getURL:p=>own+p,onMessage:listener},tabs:{get:async id=>{if(!tabs.has(id))throw Error('closed');return tabs.get(id)},sendMessage:async(id,m)=>m.type==='BREVESS_PDF_RESEARCH'?{ok:true,data:structuredClone(native)}:m.command==='READING_SNAPSHOT'?{ok:true,data:{}}:{ok:true,data:{}},onRemoved:listener,onUpdated:listener},webNavigation:{getAllFrames:async()=>[]}};
 const controller=s.WFGMulti.install({browser,broker:{overview:async()=>({frames:[{frameId:0,ok:true,data:{session:'web',version:1}}]})},persistence:{},core:{sha256:async v=>require('node:crypto').createHash('sha256').update(v).digest('hex'),sourceUrl:v=>v}});
 return {controller,tabs,native};
}
test('mixed PDF/web capture preserves numbered sources and a separate comparison owner',async()=>{
 const h=harness(),b=await h.controller.capture([1,2],[1,3]);
 assert.equal(b.sources[1].title,'网页 3 · Web');assert.equal(b.derived,true);assert.match(b.snapshot.sourceUrl,/^https:\/\/brevess.invalid/);
 await h.controller.assertCurrent(b);
 h.tabs.delete(2);await assert.rejects(h.controller.assertCurrent(b),/CLOSED_OR_NAVIGATED/);
});
test('duplicate numbers and changed PDF revisions are rejected',async()=>{
 const h=harness();await assert.rejects(h.controller.capture([1,2],[1,1]),/NUMBER_INVALID/);
 const b=await h.controller.capture([1]);h.native.version='next';await assert.rejects(h.controller.assertCurrent(b),/DOCUMENT_CHANGED/);
});
test('source numbering has distinct history identity so labels never silently swap',async()=>{
 const h=harness();const a=await h.controller.capture([1,2],[1,2]),b=await h.controller.capture([2,1],[1,2]),c=await h.controller.capture([2,1],[2,1]);
 assert.notEqual(a.sourceSetKey,b.sourceSetKey);assert.equal(a.sourceSetKey,c.sourceSetKey);
});
test('fit width preserves exact geometry rather than rounding into side gutters',()=>{
 const {createPdfNativeReaderState}=require('../extension/core/pdf-native-reader-state.js');const state=createPdfNativeReaderState();
 for(const width of [416,973,1417]){assert.ok(Math.abs(state.fitWidth({pageWidth:595.28,containerWidth:width,padding:0})*595.28-width)<0.00001);assert.equal(state.isFitWidth(),true);}
 state.setScale(1.25);assert.equal(state.isFitWidth(),false);
});
test('citation preview keeps verified verbatim context and never accepts invented quotes',()=>{
 const R=require('../extension/web-filters-general/research.js');
 const sources=[{id:'s1',title:'网页 1 · Paper',url:own+'pdf-reader.html',tabId:1}];
 const record={id:'p',frameId:0,text:'Background. The observed result was 42%. Limitations apply.',target:{nativePdf:{pageNumber:3}}};
 const pool={entries:new Map([['s1',{records:[record]}]])};
 const reply={kind:'answer',answer:'Result [1]',citations:[{source:'s1',frameId:0,id:'p',quote:'The observed result was 42%.'}]};
 const c=R.validateAnswer(reply,pool,sources).citations[0];
 assert.equal(c.excerpt,record.text);assert.equal(c.target.nativePdf.pageNumber,3);assert.equal(c.title,sources[0].title);
 reply.citations[0].quote='The observed result was 99%.';assert.throws(()=>R.validateAnswer(reply,pool,sources),/NOT_IN_READ_EVIDENCE/);
});
