const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {functionSource}=require('./helpers/r28-full07-source');
const source=fs.readFileSync(require.resolve('../extension/content.js'),'utf8');
function load(names, context){ vm.createContext(context); vm.runInContext(names.map(n=>functionSource(source,n)).join('\n'),context); return context; }

test('manual page coverage includes code, navigation, short labels and all messages on any publisher',()=>{
 const leaf=(text,blocked=false)=>{const e={dataset:{},text,blocked,getClientRects:()=>[{}],querySelector:()=>null,closest:()=>null};return{textContent:text,parentElement:e};};
 const nodes=['First response','Later response','Short label','const answer = 42;','Navigation link'].map(t=>leaf(t));
 nodes.push(leaf('Unsent draft',true));let i=0;
 const ctx=load(['collectManualPageReadableBlocks'],{NodeFilter:{SHOW_TEXT:4},document:{body:{},createTreeWalker:()=>{i=0;return{nextNode:()=>nodes[i++]};}},
  SciLLM:{hashNormalizedText:x=>x},MANUAL_UI_SELECTOR:'[data-sci-plugin-ui]',MANUAL_BLOCKED_SELECTOR:'input,textarea,[contenteditable]',
  manualClosest:n=>n.parentElement.blocked,manualReadableText:e=>e.text});
 assert.deepEqual(Array.from(ctx.collectManualPageReadableBlocks(),b=>b.text),nodes.slice(0,5).map(n=>n.textContent));
});

test('saving a newly mounted chat paragraph forces preparation even when an older document exists',async()=>{
 const node={isConnected:true,closest:()=>null};
 const region={};node.closest=sel=>sel==='article,main,[role="main"]'?region:null;
 const range={startContainer:node,endContainer:node,collapsed:false,toString:()=> 'Read this answer',getBoundingClientRect:()=>({}),cloneRange(){return this;}};
 const calls=[];let anchored=false,url='https://chatgpt.com/c/one';
 const ctx=load(['describeReadOnlySelection'],{effectiveArticlePageUrl:()=>url,document:{getSelection:()=>({rangeCount:1,isCollapsed:false,getRangeAt:()=>range})},
  normalizeManualTextRange:r=>r,manualElementForNode:n=>n,manualTranslationSelectionElement:()=>null,isManualForbiddenElement:()=>false,
  MANUAL_BLOCKED_SELECTOR:'input',manualArticleTitleElement:()=>null,findManualBlock:()=>anchored?{}:null,
  currentManualDocument:{documentId:'old'},currentManualCategories:[{}],
  prepareManualDocument:async options=>{calls.push(options);anchored=true;},describeCurrentManualSelection:()=>({validation:{valid:true}})});
 const selection=ctx.describeReadOnlySelection();assert.ok(selection);
 await selection.prepareAnnotation();assert.equal(calls[0].force,true);
 await selection.prepareAnnotation();assert.equal(calls[1].force,false,'still checks the current document lease');
 url='https://chatgpt.com/c/two';assert.equal(await selection.prepareAnnotation(),null,'SPA navigation invalidates old selection');
 node.isConnected=false;assert.equal(await selection.prepareAnnotation(),null);
 assert.equal(calls.length,2,'detached text cannot be saved');
});

test('automatic restore performs a read-only lookup and does not create a record for an unannotated page',async()=>{
 let prepares=0,reads=0;
 const ctx=load(['restoreSavedPageAnnotations'],{effectiveArticlePageUrl:()=> 'https://chatgpt.com/c/one',manualPageRestoreCheckedHref:'',manualPageRestoreHint:null,manualPreparedHref:'',startManualPageRestoreObserver(){},
 sendManualMessage:async()=>{reads++;return{record:null};},prepareManualDocument:async()=>{prepares++;}});
 await ctx.restoreSavedPageAnnotations();await ctx.restoreSavedPageAnnotations();
 assert.equal(reads,1);assert.equal(prepares,0);
});

test('automatic restore discards lookup results when the conversation changes',async()=>{
 let url='https://chatgpt.com/c/one',resolve,prepares=0;
 const ctx=load(['restoreSavedPageAnnotations'],{effectiveArticlePageUrl:()=>url,manualPageRestoreCheckedHref:'',manualPageRestoreHint:null,manualPreparedHref:'',startManualPageRestoreObserver(){},
 sendManualMessage:()=>new Promise(r=>resolve=r),prepareManualDocument:async()=>{prepares++;}});
 const pending=ctx.restoreSavedPageAnnotations();url='https://chatgpt.com/c/two';
 resolve({record:{annotations:[{}]}});await pending;
 assert.equal(prepares,0);assert.equal(ctx.manualPageRestoreHint,null);
});

test('late chat remount restores anchors without new storage writes or model calls',()=>{
 let observerCallback,timer,paints=0,reads=0;
 const block={element:{},text:'Answer',blockId:'answer'};
 const ctx=load(['startManualPageRestoreObserver'],{manualPageRestoreObserver:null,manualPageRestoreTimer:null,manualPageRestoreHint:null,
 document:{body:{},querySelector:()=>null},MutationObserver:class{constructor(cb){observerCallback=cb;}observe(){}takeRecords(){}},
 manualClosest:()=>null,MANUAL_UI_SELECTOR:'ui',MANUAL_BLOCKED_SELECTOR:'input',setTimeout:cb=>{timer=cb;},clearTimeout(){},
 manualPageRestoreCheckedHref:'https://chatgpt.com/c/one',manualPreparedHref:'https://chatgpt.com/c/one',effectiveArticlePageUrl:()=> 'https://chatgpt.com/c/one',
 manualPointerSelecting:false,currentManualSelectionUi:null,currentManualDocument:{record:{annotations:[{annotationId:'a',quote:'Answer'}]}},
 getManualDocumentInputAndBlocks:()=>{reads++;return{blocks:[block]};},currentManualBlocks:[],manualUiLifecycle:{retain(){}},manualCssEscape:x=>x,
 restoreManualAnnotations:()=>{paints++;},manualPreparedContentSequence:2});
 ctx.startManualPageRestoreObserver();observerCallback([{target:{}}]);timer();
 assert.equal(reads,1);assert.equal(paints,1);assert.equal(ctx.manualPreparedContentSequence,-1);
 ctx.document.querySelector=()=>({});ctx.manualReadableText=()=>'Answer';
 observerCallback([{target:{}}]);timer();assert.equal(reads,1,'intact marks avoid a full DOM scan');
 ctx.manualPreparedHref='https://chatgpt.com/c/other';ctx.manualPageRestoreHint=null;
 observerCallback([{target:{}}]);timer();assert.equal(paints,1,'never paint an old conversation into another');
});


test('chat outline omits repeated titles across adapters but keeps additional source text',()=>{
 const ui=fs.readFileSync(require.resolve('../extension/unified-reading-ui.js'),'utf8');
 const ctx={};vm.runInNewContext(functionSource(ui.replace(' function outlineSourceDetails','function outlineSourceDetails'),'outlineSourceDetails'),ctx);
 for(const [title,text] of [['Figure 1: Evidence','Figure 1： Evidence'],['提问：总结实验','总结实验'],['Methods','Methods'],['Question: Summarize','Summarize']])
  assert.deepEqual(Object.keys(ctx.outlineSourceDetails(text,false,title)),[]);
 assert.equal(ctx.outlineSourceDetails('A longer complete question',false,'提问：A longer').unifiedOutlineFullText,'A longer complete question');
 assert.equal(ctx.outlineSourceDetails('Useful answer detail',false,'回答（AI生成）').unifiedOutlineFullText,'Useful answer detail');
});
