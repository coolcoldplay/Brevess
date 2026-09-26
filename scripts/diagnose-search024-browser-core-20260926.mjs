// Child-agent diagnostic: derived from the root's read-only performance fixture.
// Only the fresh extension copy receives timing wrappers; the input is unchanged.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import assert from 'node:assert/strict'; import {chromium} from 'playwright';
const root=path.resolve(import.meta.dirname,'..'),source=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]),count=Number(process.argv[4]||200);
assert.ok(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});const extension=path.join(out,'extension');fs.mkdirSync(extension);
for(const e of fs.readdirSync(source,{withFileTypes:true}))if((e.isDirectory()&&['core','providers','vendor','icons','_locales'].includes(e.name))||(e.isFile()&&(/\.(js|mjs|html|css)$/.test(e.name)||e.name==='manifest.json')))fs.cpSync(path.join(source,e.name),path.join(extension,e.name),{recursive:true});
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const domCopy=path.join(extension,'core/semantic-find-dom.js');
let domText=fs.readFileSync(domCopy,'utf8');
const coreOverride=process.argv[6] ? path.resolve(process.argv[6]) : null;
if(coreOverride) domText=fs.readFileSync(coreOverride,'utf8');
const adapterOverride=process.argv[7] ? path.resolve(process.argv[7]) : null;
if(adapterOverride) fs.copyFileSync(adapterOverride,path.join(extension,'semantic-find-content.js'));
const testedCoreHash=crypto.createHash('sha256').update(domText).digest('hex');
const experiment=process.argv[5]||'timing-only';
assert.ok(['timing-only','snapshot-css-values','snapshot-css-ancestry'].includes(experiment));
if(experiment!=='timing-only'){
 const old='if (!styles.has(element)) styles.set(element, view.getComputedStyle(element));';
 assert.ok(domText.includes(old));
 domText=domText.replace(old,`if (!styles.has(element)) {
   const css = view.getComputedStyle(element);
   styles.set(element, Object.fromEntries(['display','visibility','opacity','contentVisibility',
     'clip','clipPath','overflowX','overflowY','webkitTextFillColor','color','textShadow',
     'webkitTextStrokeWidth'].map(key => [key, css[key]])));
 }`);
}
if(experiment==='snapshot-css-ancestry'){
 const start=domText.indexOf('function collect(scope) {'),end=domText.indexOf('    const initial = collect(root);');
 assert.ok(start>0&&end>start);
 let segment=domText.slice(start,end).replaceAll('parentElement(', 'cachedParent(')
   .replaceAll('omitted(', 'cachedOmitted(').replaceAll('summaryFor(', 'cachedSummary(');
 segment=segment.replace('function collect(scope) {',`function collect(scope) {
 const parentMemo=new WeakMap(), omitMemo=new WeakMap(), summaryMemo=new WeakMap();
 function cachedParent(node) {
   if(!node)return null;
   if(!parentMemo.has(node))parentMemo.set(node,parentElement(node));
   return parentMemo.get(node);
 }
 function cachedOmitted(element) {
   const trail=[];let result=false;
   for(let current=element;current;current=cachedParent(current)) {
     if(omitMemo.has(current)){result=omitMemo.get(current);break;}
     trail.push(current);
     if(current.matches?.(OMIT)||current.isContentEditable||
       (current.hasAttribute?.('contenteditable')&&current.getAttribute('contenteditable')!=='false')){result=true;break;}
   }
   for(const current of trail)omitMemo.set(current,result);
   return result;
 }
 function cachedSummary(node) {
   const trail=[];let result=null;
   for(let current=cachedParent(node);current;current=cachedParent(current)) {
     if(summarySources.has(current)){result=current;break;}
     if(summaryMemo.has(current)){result=summaryMemo.get(current);break;}
     trail.push(current);
   }
   for(const current of trail)summaryMemo.set(current,result);
   return result;
 }
 `);
 domText=domText.slice(0,start)+segment+domText.slice(end);
}
const diagnosticPrelude=`
const __coreTrace = globalThis.__search024CoreTrace ||= { totals: {}, spans: [], batches: [] };
function __coreDescribe(node) {
  const e = node?.nodeType === 1 ? node : node?.parentElement;
  return e ? { tag:e.tagName,id:e.id,cls:typeof e.className==='string'?e.className:'',ui:!!e.closest?.('[data-sci-plugin-ui]') } : null;
}
function __coreTimed(name,meta,fn) {
  const start=performance.now();
  try{return fn();}finally{
    const ms=performance.now()-start,row=__coreTrace.totals[name]||={count:0,ms:0,maxMs:0};
    row.count++;row.ms+=ms;row.maxMs=Math.max(row.maxMs,ms);
    if(ms>5 && !['sourceStructure'].includes(name)) __coreTrace.spans.push({name,start,ms,meta,stack:new Error().stack});
  }
}
`;
domText=domText.replace('const MAX_CLIP_RANGE_PROBES = 4096;', 'const MAX_CLIP_RANGE_PROBES = 4096;'+diagnosticPrelude);
for(const [name,args,meta] of [
 ['collect','scope','__coreDescribe(scope)'],['refreshScope','scope','__coreDescribe(scope)'],
 ['sourceStructure',domText.match(/function sourceStructure\(([^)]*)\)/)[1],'null'],['indexBindings','','null'],['retireOwner','element','__coreDescribe(element)']
]){
 const declaration=`function ${name}(${args}) {`;
 assert.ok(domText.includes(declaration),declaration);
 domText=domText.replace(declaration,`function ${name}(${args}) { return __coreTimed('${name}', ${meta}, () => __coreOriginal_${name}(${args})); }\n    function __coreOriginal_${name}(${args}) {`);
}
domText=domText.replace('function process(records) {', `function process(records) {
  if(records.length) __coreTrace.batches.push({start:performance.now(),records:records.map(r=>({type:r.type,attribute:r.attributeName,target:__coreDescribe(r.target),added:r.addedNodes?.length,removed:r.removedNodes?.length}))});
  return __coreTimed('process',{size:records.length},()=>__coreOriginal_process(records));
}\n    function __coreOriginal_process(records) {`);
domText=domText.replace('const checkLayout = event => {', `const checkLayout = event => __coreTimed('checkLayout',{type:event?.type,target:__coreDescribe(event?.target)},()=>__coreOriginalCheckLayout(event));\n    const __coreOriginalCheckLayout = event => {`);
fs.writeFileSync(domCopy,domText);
const report={startedAt:new Date().toISOString(),source,count,realModelCalls:0,status:'RUNNING',boundary:'Saved official PubMed HTML/CSS with cloned cards; only score transport replaced. No user profile or live PubMed scripts.',hashes:Object.fromEntries(['core/semantic-find-dom.js','semantic-find-content.js','semantic-find-controller.js'].map(f=>[f,hash(path.join(source,f))])),steps:[],errors:[]};
report.diagnostic={experiment,modifiedExtensionCopyOnly:true,domInstrumentedHash:hash(domCopy),profileSamplingIntervalUs:1000};
report.diagnostic.coreOverride=coreOverride;
report.diagnostic.adapterOverride=adapterOverride;
report.hashes['core/semantic-find-dom.js']=testedCoreHash;
if(adapterOverride) report.hashes['semantic-find-content.js']=hash(adapterOverride);
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
save();let context,cdp;
try{
 context=await chromium.launchPersistentContext(path.join(out,'profile'),{channel:'msedge',headless:true,viewport:{width:1500,height:950},args:['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND', '--disable-extensions-except='+extension,'--load-extension='+extension]});
 const replay=fs.readFileSync(path.join(root,'output/search024-pubmed-source-02/pubmed-replay.html'),'utf8');
 await context.route(/^https?:\/\//,r=>r.request().isNavigationRequest()&&new URL(r.request().url()).hostname==='pubmed.ncbi.nlm.nih.gov'?r.fulfill({status:200,contentType:'text/html',body:replay}):r.abort());
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 await worker.evaluate(()=>{globalThis.fetch=async()=>{throw Error('NO_REAL_API_NAV_PERF');};});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));cdp=await context.newCDPSession(page);
 const worlds=[];cdp.on('Runtime.executionContextCreated',({context:w})=>worlds.push(w));await cdp.send('Runtime.enable');
 await page.goto('https://pubmed.ncbi.nlm.nih.gov/?term=FUS+AND+glioma&navigation_performance='+count,{waitUntil:'domcontentloaded'});
 await page.evaluate(n=>{
  const cards=[...document.querySelectorAll('article.full-docsum')];
  for(let i=cards.length;i<n;i++){const copy=cards[i%cards.length].cloneNode(true);copy.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));cards[0].parentElement.append(copy);}
  [...document.querySelectorAll('article.full-docsum')].forEach((c,i)=>{c.dataset.perfIndex=String(i);const bar=document.createElement('div');bar.textContent='Q1  IF: 5.6  Cited by: NA  PDF(Full Text)  Citation  Collect';bar.className='third-party-fixture';bar.style.cssText='background:#f4f8d4;padding:10px';c.append(bar);});
  const style=document.createElement('style');style.textContent='.back-to-top{display:block!important}';document.head.append(style);
  addEventListener('scroll',()=>document.querySelector('.back-to-top')?.classList.toggle('visible',scrollY>300));
 },count);
 let world;for(let i=0;i<100;i++){world=worlds.find(w=>w.name===id||w.origin==='chrome-extension://'+id);if(world){const r=await cdp.send('Runtime.evaluate',{contextId:world.id,expression:'globalThis.__brevessSemanticFindShortcut?.shortcutKey==="J"',returnByValue:true});if(r.result.value)break;}await page.waitForTimeout(80);}
 assert.ok(world);
 const isolated=async expression=>{const r=await cdp.send('Runtime.evaluate',{contextId:world.id,expression,awaitPromise:true,returnByValue:true,timeout:20000});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 await page.locator('body').click({position:{x:5,y:5}});await page.keyboard.press('j');
 await page.locator('[data-semantic-find-role="query"]').waitFor({timeout:15000});
 await isolated('('+(()=>{
  const state=globalThis.navPerf={requests:[],calls:{},snapshots:[],longTasks:[],clicks:[]};
  new PerformanceObserver(l=>state.longTasks.push(...l.getEntries().map(e=>({start:e.startTime,ms:e.duration})))).observe({entryTypes:['longtask']});
  const oldCreate=document.createRange.bind(document);document.createRange=(...a)=>{state.rangeCount=(state.rangeCount||0)+1;return oldCreate(...a);};
  const factory=SciLLM.createSemanticFindDomSnapshot;
  SciLLM.createSemanticFindDomSnapshot=function(...args){const snap=factory.apply(this,args);state.snapshots.push(snap);for(const key of ['isCurrent','isHitCurrent','ranges','isVisible','reveal','drainAdditionalParagraphs']){const original=snap[key];if(typeof original!=='function')continue;snap[key]=function(...a){const row=state.calls[key]||={count:0,ms:0};row.count++;const start=performance.now();try{return original.apply(this,a);}finally{row.ms+=performance.now()-start;}};}return snap;};
  const send=chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage=async(...args)=>{const m=args[0];if(m.type==='LLM_SEMANTIC_FIND_CANCEL')return {success:true};if(m.type!=='LLM_SEMANTIC_FIND')return send(...args);
   const sentences=SciLLM.createSemanticFindSentences(m.paragraphs);const snap=state.snapshots.at(-1);
   const summaries=sentences.filter(s=>snap.bindings.get(s.paragraphId)?.element.closest('.full-view-snippet,.short-view-snippet'));const title=sentences.find(s=>snap.bindings.get(s.paragraphId)?.element.closest('.docsum-title'));
   const chosen=[title,...Array.from({length:29},(_,i)=>summaries[Math.floor(i*summaries.length/29)])].filter(Boolean);const scores=sentences.map(s=>({id:s.id,score:chosen.findIndex(c=>c.id===s.id)>=0?.99-chosen.findIndex(c=>c.id===s.id)*.009:.1}));
   state.requests.push({sentences:sentences.length,paragraphs:m.paragraphs.length,matched:scores.filter(s=>s.score>=.7).length,summaryCandidates:summaries.length});
   return {success:true,data:{operationId:m.operationId,sourceKey:m.sourceKey,total:sentences.length,processed:sentences.length,skipped:0,complete:true,scores}};};
  document.addEventListener('click',e=>{if(!e.target.closest('[data-semantic-find-role="next"],[data-semantic-find-role="previous"]'))return;const started=performance.now();queueMicrotask(()=>state.clicks.push({ms:performance.now()-started,role:e.target.dataset.semanticFindRole}));},true);
 }).toString()+')()');
 await page.locator('[data-semantic-find-role="threshold-number"]').count().catch(()=>0);
 await isolated('document.querySelector(\'[data-semantic-find-role="thresholdNumber"]\')?.value'); // no mutation
 await page.locator('[data-semantic-find-role="query"]').fill('超声促进基因载体递送');
 await page.locator('[data-semantic-find-role="query"]').press('Enter');
 await page.waitForFunction(()=>/找到/.test(document.querySelector('[data-semantic-find-role="status"]')?.textContent||''),undefined,{timeout:45000});
 const stats=()=>isolated('({requests:navPerf.requests,calls:navPerf.calls,rangeCount:navPerf.rangeCount,counters:navPerf.snapshots.map(s=>({...s.counters})),longTasks:navPerf.longTasks,clicks:navPerf.clicks,core:__search024CoreTrace,position:document.querySelector(\'[data-semantic-find-role="position"]\')?.textContent})');
 report.initial=await stats();save();
 await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});
 for(let i=0;i<6;i++){
  await isolated('navPerf.calls={};navPerf.rangeCount=0;navPerf.longTasks=[];navPerf.clicks=[];__search024CoreTrace.totals={};__search024CoreTrace.spans=[];__search024CoreTrace.batches=[]');
  await cdp.send('Profiler.start');
  const start=Date.now();await page.locator('[data-semantic-find-role="next"]').click({timeout:20000});
  await page.waitForTimeout(50);const step={click:i+1,wallMs:Date.now()-start,...await stats()};
  const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(path.join(out,`click-${i+1}.cpuprofile`),JSON.stringify(profile));
  const self=new Map();for(let s=0;s<(profile.samples||[]).length;s++) self.set(profile.samples[s],(self.get(profile.samples[s])||0)+(profile.timeDeltas[s]||0));
  step.cpuTop=profile.nodes.filter(n=>self.has(n.id)).map(n=>({id:n.id,ms:self.get(n.id)/1000,...n.callFrame})).sort((a,b)=>b.ms-a.ms).slice(0,25);
  report.steps.push(step);save();
 }
 if(coreOverride){
  await cdp.send('Profiler.start');
  report.slicedSafety=await isolated('('+ (async()=>{
   const snap=navPerf.snapshots.at(-1),cases=[];
   const check=(name,value)=>{cases.push({name,pass:!!value});if(!value)throw Error(name);};
   const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
   const settle=async()=>{snap.isCurrent();const started=performance.now();while(snap.pendingVisibilityScan){if(performance.now()-started>15000)throw Error('visibility scan did not settle');await sleep(20);snap.isCurrent();}};
   await settle(); check('navigation visibility scan completes after rapid next clicks',!snap.pendingVisibilityScan);
   const titles=snap.paragraphs.filter(p=>snap.bindings.get(p.paragraphId)?.element.closest('.docsum-title'));
   const old={...titles[0],start:0,end:titles[0].text.length};
   const stable={...titles[1],start:0,end:titles[1].text.length};
   const style=document.createElement('style');style.textContent='.slice-test-target{display:none}.slice-test-switch[aria-expanded="true"] + .slice-test-target{display:block}';document.head.append(style);
   const holder=document.createElement('section'),toggle=document.createElement('button'),target=document.createElement('p');
   toggle.className='slice-test-switch';toggle.textContent='Slice test switch';target.className='slice-test-target';target.textContent='Slice sibling disclosure source.';
   holder.append(toggle,target);document.body.append(holder);await settle();
   check('CSS-hidden sibling excluded before remote attribute update',![...snap.bindings.values()].some(b=>b.text==='Slice sibling disclosure source.'));
   toggle.setAttribute('aria-expanded','true');snap.isCurrent();check('global CSS attribute schedules sliced work',snap.pendingVisibilityScan);
   await settle();check('sibling selector source is eventually admitted',[...snap.bindings.values()].some(b=>b.text==='Slice sibling disclosure source.'));
   toggle.setAttribute('data-scan','new-generation');snap.isCurrent();
   const oldOwner=snap.bindings.get(old.paragraphId).element;oldOwner.textContent='Changed title during a sliced scan.';
   check('old edited hit rejects while scan pending',!snap.isHitCurrent(old)&&snap.ranges(old).length===0);
   check('unrelated hit survives pending edit',snap.isHitCurrent(stable));await settle();
   check('new title version admitted without restoring old id',[...snap.bindings.values()].some(b=>b.text==='Changed title during a sliced scan.')&&!snap.bindings.has(old.paragraphId));
   const host=document.createElement('div'),shadow=host.attachShadow({mode:'open'}),p=document.createElement('p');
   p.textContent='Shadow pre-cancellation source.';shadow.append(p);document.body.append(host);snap.isCurrent();
   const started=performance.now();while(!snap.roots.has(shadow)){if(performance.now()-started>15000)throw Error('new shadow root not observed');await sleep(10);}
   check('new shadow root observed before sliced commit',snap.pendingVisibilityScan);
   p.firstChild.nodeValue='Shadow current-generation source.';snap.isCurrent();await settle();
   check('new shadow edit never commits superseded source',![...snap.bindings.values()].some(b=>b.text==='Shadow pre-cancellation source.')&&[...snap.bindings.values()].some(b=>b.text==='Shadow current-generation source.'));
   toggle.setAttribute('data-scan','disconnect');snap.isCurrent();const scans=snap.counters.scannedTextNodes;
   snap.disconnect();await sleep(40);check('disconnect cancels pending scan',!snap.pendingVisibilityScan&&snap.counters.scannedTextNodes===scans);
   return {cases,counters:{...snap.counters}};
  }).toString()+')()');
  const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(path.join(out,'sliced-safety.cpuprofile'),JSON.stringify(profile));save();
 }
 await page.screenshot({path:path.join(out,'after-next.png')});report.status='MEASURED';
}catch(e){report.status='FAILED';report.failure=String(e.stack||e);process.exitCode=1;save();try{await cdp?.send('Runtime.terminateExecution');}catch{}}
finally{await context?.close();save();}
console.log(JSON.stringify({status:report.status,initial:report.initial?.requests,steps:report.steps.map(s=>({click:s.click,wallMs:s.wallMs,scans:s.counters?.[0]?.scans,longTasks:s.longTasks,clicks:s.clicks})),failure:report.failure,output:out}));
