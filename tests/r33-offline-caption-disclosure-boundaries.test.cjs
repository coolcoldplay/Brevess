'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const helper=process.env.R33_CAPTION_HELPER||path.resolve(__dirname,'../core/faithful-page-snapshot.js');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const helperSha=sha(fs.readFileSync(helper));
test.before(()=>console.log('Caption disclosure boundary helper SHA256: '+helperSha));
test.after(()=>assert.equal(sha(fs.readFileSync(helper)),helperSha,'Helper bytes changed during the boundary run'));

// Exact structural source relationship; all contents below are synthetic, not
// publisher material. Real Image/DOM/CSS/CSP work in an isolated offline Edge.
async function fixture({controls='',shellStyle='display:none',extra='',captionClass='',expanded='false',extraControls='',omitControl=false,captionExtra='',beforeCaption='',css=''}={}){
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--proxy-server=http://127.0.0.1:9']});
 try{
  const context=await browser.newContext();await context.route('**/*',r=>r.abort());const source=await context.newPage();
  const control=omitControl?'':`<div><button class="accordion__control" aria-expanded="${expanded}" ${controls}>Show full caption</button></div>`;
  await source.setContent(`<style>${css}</style><article id="paper"><figure class="graphic" id="fig1"><figcaption class="figure__caption__body"><div class="accordion">${control}${extraControls}<div class="accordion__content" id="fig1-content" style="${shellStyle}">${beforeCaption}<div id="caption" class="figure__caption__text__content ${captionClass}">EXACT_CAPTION</div>${captionExtra}${extra}</div><div id="other-content" hidden>OTHER_TARGET</div></div></figcaption></figure></article>`);
  await source.addScriptTag({path:helper});
  const result=await source.evaluate(async()=>{const before=document.documentElement.outerHTML,style=getComputedStyle(document.querySelector('#caption')),sourceCaptionStyle={display:style.display,visibility:style.visibility};const saved=await SciLLM.exportFaithfulPageSnapshot({document,articleRoot:document.querySelector('#paper'),documentUrl:'https://review-caption.qa.test/paper'});return{...saved,sourceCaptionStyle,unchanged:before===document.documentElement.outerHTML};});
  const cold=await context.newPage();await cold.setContent(result.html);
  const visible=async id=>await cold.locator('#'+id).count()?cold.locator('#'+id).isVisible():false;
  return{report:result.report,html:result.html,unchanged:result.unchanged,sourceCaptionStyle:result.sourceCaptionStyle,captionVisible:await visible('caption'),secondCaptionVisible:await visible('caption2'),extraVisible:await visible('extra'),visibleText:await cold.locator('#paper').innerText()};
 }finally{await browser.close();}
}
test('real-shaped scientific caption expands without source mutation or executable content',async()=>{
 const r=await fixture();assert.equal(r.captionVisible,true);assert.equal(r.unchanged,true);assert.equal(r.report.expandedFigureCaptions,1);assert.doesNotMatch(r.html,/<script|<button|onclick=/);assert.match(r.html,/script-src 'none'/);
});
test('an explicitly different control target cannot authorize this hidden caption',async()=>{
 const r=await fixture({controls:'aria-controls="other-content"'});assert.equal(r.captionVisible,false);assert.equal(r.report.expandedFigureCaptions||0,0);
});
test('expanding a caption does not reveal an unrelated sibling in the hidden shell',async()=>{
 const r=await fixture({extra:'<p id="extra">UNRELATED_HIDDEN_TEXT</p>'});assert.equal(r.captionVisible,true);assert.equal(r.extraVisible,false);
});
test('matched caption can reveal inherited disclosure visibility',async()=>{
 const r=await fixture({shellStyle:'display:none;visibility:hidden'});assert.equal(r.captionVisible,true);
});
test('a private caption child cannot qualify the shell for expansion',async()=>{
 const r=await fixture({captionClass:'account-panel',extra:'<p id="extra">UNRELATED_HIDDEN_TEXT</p>'});assert.doesNotMatch(r.html,/EXACT_CAPTION/);assert.equal(r.extraVisible,false);assert.equal(r.report.expandedFigureCaptions||0,0);
});
test('free text outside the scientific caption retains its inherited hidden state',async()=>{
 const r=await fixture({extra:'EXTRA_FREE_TEXT'});assert.doesNotMatch(r.visibleText,/EXTRA_FREE_TEXT/);
 // Unknown mixed text may conservatively keep the whole disclosure closed.
 if(r.report.expandedFigureCaptions)assert.equal(r.captionVisible,true);
});
test('a unique explicit correct target accepts surrounding whitespace',async()=>{
 const r=await fixture({controls:'aria-controls="  fig1-content  "'});assert.equal(r.captionVisible,true);assert.equal(r.report.expandedFigureCaptions,1);
});
test('multiple owning controls are ambiguous and cannot expand a caption',async()=>{
 const r=await fixture({extraControls:'<button class="accordion__control" aria-expanded="false">Another control</button>'});assert.equal(r.captionVisible,false);assert.equal(r.report.expandedFigureCaptions||0,0);
});
test('a nested accordion control cannot impersonate its parent disclosure',async()=>{
 const r=await fixture({omitControl:true,extraControls:'<div class="accordion"><button class="accordion__control" aria-expanded="false">Nested control</button></div>'});assert.equal(r.captionVisible,false);assert.equal(r.report.expandedFigureCaptions||0,0);
});
test('an already-open caption preserves originally visible sibling content',async()=>{
 const r=await fixture({expanded:'true',shellStyle:'',extra:'<p id="extra">ORIGINAL_VISIBLE_CONTENT</p>'});assert.equal(r.captionVisible,true);assert.equal(r.extraVisible,true);
});
test('collapsed ARIA alone never hides sibling content from an actually visible shell',async()=>{
 const r=await fixture({expanded:'false',shellStyle:'',extra:'<p id="extra">ORIGINAL_VISIBLE_CONTENT</p>'});assert.equal(r.captionVisible,true);assert.equal(r.extraVisible,true);assert.equal(r.report.expandedFigureCaptions||0,0);
});
test('multiple scientific caption branches are not arbitrarily reduced to the first',async()=>{
 const r=await fixture({captionExtra:'<div class="figure__caption__text__content" id="caption2">SECOND_CAPTION</div>'});assert.equal(r.captionVisible,false);assert.equal(r.secondCaptionVisible,false);assert.equal(r.report.expandedFigureCaptions||0,0);
});
test('whitespace does not introduce an element before a first-child caption',async()=>{
 const r=await fixture({beforeCaption:'\n    ',css:'.figure__caption__text__content:not(:first-child){visibility:hidden}'});assert.notEqual(r.sourceCaptionStyle.display,'none');assert.notEqual(r.sourceCaptionStyle.visibility,'hidden');assert.equal(r.captionVisible,true);assert.equal(r.report.expandedFigureCaptions,1);
});
test('hiding a non-caption element preserves its adjacent selector relationship',async()=>{
 const r=await fixture({beforeCaption:'<span class="lead">OTHER_HIDDEN_TEXT</span>',css:'.figure__caption__text__content{display:none}.lead + .figure__caption__text__content{display:block}'});assert.notEqual(r.sourceCaptionStyle.display,'none');assert.equal(r.captionVisible,true);assert.doesNotMatch(r.visibleText,/OTHER_HIDDEN_TEXT/);assert.equal(r.report.expandedFigureCaptions,1);
});
