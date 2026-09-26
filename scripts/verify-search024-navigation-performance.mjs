// Actual isolated Edge, production J/controller/DOM. Public HTML replay and synthetic scores only.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import assert from 'node:assert/strict'; import {chromium} from 'playwright';
const root=path.resolve(import.meta.dirname,'..'),source=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]),count=Number(process.argv[4]||200),clickCount=Number(process.argv[5]||32);
assert.ok(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});const extension=path.join(out,'extension');fs.mkdirSync(extension);
for(const e of fs.readdirSync(source,{withFileTypes:true}))if((e.isDirectory()&&['core','providers','vendor','icons','_locales'].includes(e.name))||(e.isFile()&&(/\.(js|mjs|html|css)$/.test(e.name)||e.name==='manifest.json')))fs.cpSync(path.join(source,e.name),path.join(extension,e.name),{recursive:true});
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const report={startedAt:new Date().toISOString(),source,count,realModelCalls:0,status:'RUNNING',boundary:'Saved official PubMed HTML/CSS with cloned cards; only score transport replaced. No user profile or live PubMed scripts.',hashes:Object.fromEntries(['core/semantic-find-dom.js','semantic-find-content.js','semantic-find-controller.js'].map(f=>[f,hash(path.join(source,f))])),steps:[],errors:[]};
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
 let world, launcherReady=false;for(let i=0;i<100;i++){world=worlds.find(w=>w.name===id||w.origin==='chrome-extension://'+id);if(world){const r=await cdp.send('Runtime.evaluate',{contextId:world.id,expression:'globalThis.__brevessSemanticFindShortcut?.shortcutKey==="J"',returnByValue:true});if(r.result.value){launcherReady=true;break;}}await page.waitForTimeout(80);}
 report.launcherReady=launcherReady;save();assert.ok(world);assert.ok(launcherReady,'production J launcher is ready before keypress');
 const isolated=async expression=>{const r=await cdp.send('Runtime.evaluate',{contextId:world.id,expression,awaitPromise:true,returnByValue:true,timeout:20000});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 await page.locator('body').click({position:{x:5,y:5}});await page.keyboard.press('j');
 await page.locator('[data-semantic-find-role="query"]').waitFor({timeout:15000});
 await isolated('('+(()=>{
  const state=globalThis.navPerf={requests:[],calls:{},snapshots:[],longTasks:[],clicks:[],heartbeatGaps:[]};
  let lastBeat=performance.now();setInterval(()=>{const now=performance.now();state.heartbeatGaps.push(now-lastBeat);lastBeat=now;},16);
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
  // Registered after product listeners: diagnostic tail only, never used as handler latency.
  document.addEventListener('click',e=>{if(!e.target.closest('[data-semantic-find-role="next"],[data-semantic-find-role="previous"]'))return;const started=performance.now();queueMicrotask(()=>state.clicks.push({tailMs:performance.now()-started,role:e.target.dataset.semanticFindRole}));},true);
 }).toString()+')()');
 await page.locator('[data-semantic-find-role="threshold-number"]').fill('0.70');
 await page.locator('[data-semantic-find-role="threshold-number"]').dispatchEvent('input');
 await page.locator('[data-semantic-find-role="query"]').fill('超声促进基因载体递送');
 await page.locator('[data-semantic-find-role="query"]').press('Enter');
 await page.waitForFunction(()=>/找到/.test(document.querySelector('[data-semantic-find-role="status"]')?.textContent||''),undefined,{timeout:45000});
 const stats=()=>isolated('({requests:navPerf.requests,calls:navPerf.calls,rangeCount:navPerf.rangeCount,counters:navPerf.snapshots.map(s=>({...s.counters})),longTasks:navPerf.longTasks,clicks:navPerf.clicks,maxHeartbeatGap:Math.max(0,...navPerf.heartbeatGaps),position:document.querySelector(\'[data-semantic-find-role="position"]\')?.textContent})');
 report.initial=await stats();save();
 for(let i=0;i<clickCount;i++){
  await isolated('navPerf.calls={};navPerf.rangeCount=0;navPerf.longTasks=[];navPerf.clicks=[];navPerf.heartbeatGaps=[]');
  const start=Date.now();await page.locator('[data-semantic-find-role="next"]').click({timeout:20000});
  await page.waitForTimeout(50);report.steps.push({click:i+1,wallMs:Date.now()-start,...await stats()});save();
 }
 await page.screenshot({path:path.join(out,'after-next.png')});report.status='MEASURED';
}catch(e){report.status='FAILED';report.failure=String(e.stack||e);process.exitCode=1;save();try{const page=context?.pages().at(-1);if(page){report.failurePage=await page.evaluate(()=>({url:location.href,active:document.activeElement?.outerHTML?.slice(0,600),query:document.querySelector('[data-semantic-find-role="query"]')?.outerHTML,bodyText:document.body?.innerText.slice(0,500)}));await page.screenshot({path:path.join(out,'failure.png'),timeout:5000});}}catch{}try{await cdp?.send('Runtime.terminateExecution');}catch{}}
finally{await context?.close();save();}
console.log(JSON.stringify({status:report.status,initial:report.initial?.requests,steps:report.steps.map(s=>({click:s.click,wallMs:s.wallMs,scans:s.counters?.[0]?.scans,longTasks:s.longTasks,clicks:s.clicks})),failure:report.failure,output:out}));
