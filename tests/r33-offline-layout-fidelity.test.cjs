'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
for (const width of [1280, 760]) test(`offline snapshot preserves sibling-dependent publisher article geometry at ${width}px`,async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--proxy-server=http://127.0.0.1:9']});
 try{
  const context=await browser.newContext({viewport:{width,height:900}});
  await context.route('**/*',route=>route.request().url()==='https://r33-layout.qa.test/paper'?route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}.publisher-grid{display:grid;grid-template-columns:260px 620px;gap:24px}.publisher-grid>aside{grid-column:1}.publisher-grid>article:nth-child(2){grid-column:2}article{font:18px/1.7 sans-serif;padding:12px}</style><div class="publisher-grid"><aside>Publisher contents</aside><article id="paper"><h1>Saved source</h1><p>'+('Source sentence. '.repeat(100))+'</p></article></div>'}):route.abort());
  await context.addInitScript({path:path.resolve(__dirname,'../core/faithful-page-snapshot.js')});
  const source=await context.newPage();await source.goto('https://r33-layout.qa.test/paper');
  const measure=()=>{const n=document.querySelector('#paper'),r=n.getBoundingClientRect();return{x:r.x,width:r.width,text:n.textContent};};
  const before=await source.evaluate(measure);
  const saved=await source.evaluate(()=>SciLLM.exportFaithfulPageSnapshot({document,articleRoot:document.querySelector('#paper'),documentUrl:location.href}));
  assert.equal(saved.report.missingResources.length,0);
  const reopened=await context.newPage();await reopened.setContent(saved.html);const after=await reopened.evaluate(measure);
  assert.equal(after.text,before.text);assert.equal(after.width,before.width,'Removing publisher siblings changes nth-child layout from 620px to 260px.');
  assert.equal(after.x,before.x);
  assert.match(saved.html,/data-brevess-layout-slot/);
  assert.doesNotMatch(saved.html,/Publisher contents/);
  assert.match(saved.report.warnings.join(' '),/intrinsic content/,
   'The export must disclose the limit of empty non-article layout slots.');
 }finally{await browser.close();}
});

test('layout slots exclude private contents, URLs and resource identities without mutating the source',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--proxy-server=http://127.0.0.1:9']});
 try{
  const context=await browser.newContext();
  await context.route('**/*',route=>route.request().url()==='https://r33-layout.qa.test/private'?route.fulfill({contentType:'text/html',body:'<!doctype html><style>.account-secret{background:url(https://publisher.test/private.png)}</style><header class="account-secret" title="PRIVATE_TITLE"><form><input value="PRIVATE_VALUE"></form><p>PRIVATE_TEXT</p><img src="https://publisher.test/private.png"></header><main><article id="paper"><p>Reading source</p></article></main><script>window.PRIVATE_SCRIPT=1</script>'}):route.abort());
  await context.addInitScript({path:path.resolve(__dirname,'../core/faithful-page-snapshot.js')});
  const source=await context.newPage();await source.goto('https://r33-layout.qa.test/private');
  const record=await source.evaluate(async()=>{const before=document.documentElement.outerHTML,calls=[];
   const saved=await SciLLM.exportFaithfulPageSnapshot({document,articleRoot:document.querySelector('#paper'),fetchResource:async input=>{calls.push(input.url);throw Error('Unexpected resource');}});
   return{saved,calls,sourceUnchanged:before===document.documentElement.outerHTML};});
  assert.doesNotMatch(record.saved.html,/PRIVATE_|account-secret|private\.png|<script|<form|<input/);
  assert.match(record.saved.html,/Reading source/);assert.deepEqual(record.calls,[]);assert.equal(record.sourceUnchanged,true);
 }finally{await browser.close();}
});
