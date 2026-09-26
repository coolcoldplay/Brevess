// MECH-008: isolated real content -> popup state refresh and reload; no provider calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-mech008-empty-'));
const extension = path.join(temporary, 'extension');
const base = path.join(root, 'output/playwright/mech008-empty-state');
fs.mkdirSync(base, {recursive:true});
const output = fs.mkdtempSync(path.join(base, 'run-'));
const title = 'MECH-008 empty mechanism state fixture';
const url = 'https://example.org/brevess-mech008-empty-state';
const report = {taskId:'MECH-008',status:'RUNNING',realApiCalls:0,personalDataAccessed:false,
  scope:'Synthetic article; actual content invalidation called in isolated content world, actual popup refresh/reload. Not a real Figure model run.',
  checks:[],errors:[],sourceHashes:{}};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const check = (name,value) => {assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
let context, panel, paper;
(async()=>{
  fs.mkdirSync(extension);
  for(const dir of ['core','providers','vendor','icons','_locales']) fs.cpSync(path.join(root,dir),path.join(extension,dir),{recursive:true});
  for(const file of fs.readdirSync(root)) if(/\.(js|mjs|html|css)$/.test(file)||file==='manifest.json') fs.copyFileSync(path.join(root,file),path.join(extension,file));
  for(const file of ['content.js','popup.js','core/background-router.js']) report.sourceHashes[file]=hash(fs.readFileSync(path.join(root,file)));
  const transport=path.join(extension,'offscreen-network-worker.js');
  fs.writeFileSync(transport,'globalThis.fetch=async()=>{throw Error("MECH008_REAL_NETWORK_DISABLED");};\n'+fs.readFileSync(transport,'utf8'));
  context=await chromium.launchPersistentContext(path.join(temporary,'profile'),{channel:'msedge',headless:true,reducedMotion:'reduce',viewport:{width:1280,height:900},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
  await context.route(/^https?:\/\//,route=>route.request().url()===url
    ? route.fulfill({contentType:'text/html',body:`<html><head><title>${title}</title><link rel="canonical" href="${url}"></head><body><article><h1>${title}</h1><h2>Introduction</h2><p>This synthetic study compares a defined intervention with matched controls. The experiment asks whether changes in a measured signal are associated with a behavioral outcome.</p><h2>Methods</h2><p>Matched control and intervention groups were measured independently using the same assay and timing. Scientific observations are retained without inferring causality from association alone.</p><h2>Results</h2><p>Figure 1 compares control and intervention signals; this fixture has no generated mechanism network.</p></article></body></html>`})
    : route.abort('blockedbyclient'));
  paper=context.pages()[0]||await context.newPage(); await paper.goto(url);
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const tab=await worker.evaluate(async source=>(await chrome.tabs.query({})).find(t=>t.url===source),url);
  await worker.evaluate(async target=>{const activation=await SciLLM.markTabActivated(chrome.storage.session,target);await chrome.runtime.sendMessage({type:'PANEL_TAB_ACTIVATED',activation}).catch(()=>{});},tab);
  panel=await context.newPage(); panel.on('pageerror',e=>report.errors.push(e.message));
  await panel.setViewportSize({width:420,height:900});
  await panel.goto('chrome-extension://'+new URL(worker.url()).host+'/popup.html'); await paper.bringToFront();
  await panel.waitForFunction(expected=>document.getElementById('sidePanelPaperTitle')?.textContent===expected,title);
  await panel.evaluate(async()=>{await refreshArticleWorkspace();switchWorkspaceView('figures');});
  const result=await worker.evaluate(async tabId=>{
    const [entry]=await chrome.scripting.executeScript({target:{tabId},func:()=>{
      const before=JSON.parse(JSON.stringify(crossFigureLogicState));
      invalidateCrossFigureLogic('fixture ordinary Figure result update');
      const after=JSON.parse(JSON.stringify(crossFigureLogicState));
      return {before,after};
    }});
    return entry.result;
  },tab.id);
  report.contentState=result;
  check('fresh real content starts with empty idle mechanism',result.before.status==='idle'&&!result.before.result&&!result.before.operation);
  check('ordinary invalidation does not manufacture a revision conflict',result.after.status==='idle'&&!result.after.audit?.code&&!result.after.result);
  const snapshotResponse = await worker.evaluate(async tabId => chrome.tabs.sendMessage(tabId,
    {action:'getFigureWorkspaceSnapshot'}), tab.id);
  report.snapshotResponse = {success:snapshotResponse.success,
    crossFigureLogic:snapshotResponse.snapshot?.crossFigureLogic,
    logicRefreshRequired:snapshotResponse.snapshot?.supplemental?.logicRefreshRequired};
  check('real snapshot message retains idle without supplemental conflict',
    snapshotResponse.success===true && snapshotResponse.snapshot?.crossFigureLogic?.status==='idle' &&
    !snapshotResponse.snapshot?.supplemental?.logicRefreshRequired);
  await panel.evaluate(async()=>{await refreshArticleWorkspace();switchWorkspaceView('mechanism');});
  check('actual mechanism status banner remains hidden',await panel.locator('#mechanismGenerationStatus').isHidden());
  check('actual mechanism controller remains idle',await panel.evaluate(()=>mechanismGenerationUiController.presentation().status==='idle'));
  check('notification history contains no false workspace conflict',await panel.evaluate(()=>!sidePanelNotificationHistory.some(x=>/机制链工作区版本冲突/.test(x.message))));
  await panel.setViewportSize({width:360,height:900});
  check('mechanism layout has no horizontal overflow at 360px',await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await panel.screenshot({path:path.join(output,'empty-mechanism-360.png')});
  await panel.reload(); await paper.bringToFront();
  await panel.waitForFunction(expected=>document.getElementById('sidePanelPaperTitle')?.textContent===expected,title);
  await panel.evaluate(async()=>{await refreshArticleWorkspace();switchWorkspaceView('mechanism');});
  check('panel reload still shows idle without false conflict',await panel.locator('#mechanismGenerationStatus').isHidden()&&await panel.evaluate(()=>mechanismGenerationUiController.presentation().status==='idle'));
  check('production bytes unchanged throughout the browser run',Object.entries(report.sourceHashes).every(([file,digest])=>hash(fs.readFileSync(path.join(root,file)))===digest));
  check('no popup page errors',report.errors.length===0);
  report.status='PASS';
})().catch(async error=>{report.status='FAIL';report.error=error.message;process.exitCode=1;if(panel)await panel.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});})
  .finally(async()=>{await context?.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error,output}));});
