const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const sourceRoot = process.env.SHARING_QA_SOURCE ? path.resolve(process.env.SHARING_QA_SOURCE) : path.resolve(__dirname, '../..');
const content = fs.readFileSync(path.join(sourceRoot, 'content.js'), 'utf8');
const manual = require(path.join(sourceRoot, 'core/manual-annotations.js'));
function fn(name) { const match = new RegExp('(?:async )?function '+name+'\\(').exec(content); assert.ok(match,name); const tail=content.slice(match.index),next=/\n(?:async )?function /u.exec(tail.slice(1));return tail.slice(0,next?next.index+1:undefined); }
const base = { annotationId:'unicode-note',categoryId:'result',categorySnapshot:{name:'结果',color:'#112233'},quote:'Source quote',prefix:'before',suffix:'after',blockFingerprint:'block-A',startOffset:0,endOffset:12,note:'' };

test('saved Unicode notes open sharing immediately while real unsaved edits remain blocked', async () => {
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<textarea id="note"></textarea><section id="sharing"></section><p id="status"></p>');
  await page.evaluate(()=>{
   window.currentManualDocument={documentId:'doc-demo',documentHash:'a'.repeat(64),record:{documentId:'doc-demo',title:'Synthetic source',canonicalUrl:'https://example.org/demo',annotations:[]}};
   window.manualAnnotationById=id=>currentManualDocument.record.annotations.find(a=>a.annotationId===id);
   window.calls=[];window.BrevessSharing={getLocalState:async()=>({visibility:'private'}),open:async input=>{calls.push(structuredClone(input));return{status:'cancelled'};}};
   window.surface={annotations:[],validSource:()=>true};window.announce=text=>document.querySelector('#status').textContent=text;
  });
  await page.addScriptTag({content:['manualAnnotationSourceIdentity','buildManualNoteSharingRequest','appendManualNoteSharingControls'].map(fn).join('\n')});
  const cases=['中文标点，括号（原文）；\n第二行：保留判断。','ＡＢＣ １２３ ① ﬁ\nＣＤ','Cafe\u0301 与 café','  spaces stay  \n\nnext line\t','',null];
  for(const input of cases){
   const saved=manual.normalizeManualAnnotation({...base,note:input});
   await page.evaluate(({saved,input})=>{currentManualDocument.record.annotations=[saved];surface.annotations=[structuredClone(saved)];calls.length=0;document.querySelector('#note').value=input??'';appendManualNoteSharingControls(document.querySelector('#sharing'),surface,document.querySelector('#note'),announce);},{saved,input});
   const before=await page.evaluate(()=>JSON.stringify(currentManualDocument.record));
   await page.locator('.sci-selection-note-sharing').click();
   assert.equal(await page.evaluate(()=>calls.length),1,`saved form must be shareable: ${JSON.stringify(input)}`);
   assert.equal(await page.evaluate(()=>calls[0].text),saved.note);
   assert.equal(await page.locator('#note').inputValue(),input??'','sharing must not overwrite the editor');
   assert.equal(await page.evaluate(()=>JSON.stringify(currentManualDocument.record)),before,'sharing is read-only for local notes');
   for(const suffix of ['改动',' ','\n']){
    await page.locator('#note').fill((input??'')+suffix);
    await page.locator('.sci-selection-note-sharing').click();
    assert.equal(await page.evaluate(()=>calls.length),1,'unsaved content, spaces and newlines stay protected');
    assert.match(await page.locator('#status').textContent(),/先保存/);
   }
  }
  // Old unnormalized data can be read without migrating or rewriting its bytes.
  const legacy={...base,note:'历史（全角）\n第二行'};
  await page.evaluate(saved=>{currentManualDocument.record.annotations=[saved];surface.annotations=[structuredClone(saved)];calls.length=0;document.querySelector('#note').value=saved.note.normalize('NFKC');appendManualNoteSharingControls(document.querySelector('#sharing'),surface,document.querySelector('#note'),announce);},legacy);
  await page.locator('.sci-selection-note-sharing').click();
  assert.equal(await page.evaluate(()=>calls.length),1);
  assert.equal(await page.evaluate(()=>calls[0].text),legacy.note);
  assert.equal(await page.evaluate(()=>currentManualDocument.record.annotations[0].note),legacy.note);
 } finally {await browser.close();}
});
