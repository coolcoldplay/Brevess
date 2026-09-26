// MECH-008 UI-only terminal response test. Fresh extension/profile; no real provider calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-mech008-feedback-'));
const extension = path.join(temporary, 'extension');
const base = path.join(root, 'output/playwright/r16-feedback-mech008-errors');
fs.mkdirSync(base, {recursive:true});
const output = fs.mkdtempSync(path.join(base, 'run-'));
const title = 'MECH-008 synthetic failure notification study';
const url = 'https://example.org/brevess-mech008-errors';
const report = {taskId:'MECH-008',status:'RUNNING',realApiCalls:0,personalDataAccessed:false,
  source:'synthetic paper; only analyzeCrossFigureLogicWithLLM response intercepted in isolated popup',
  checks:[],errors:[],sourceHashes:{},screenshots:[]};
let context,panel,paper;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function check(name,value){assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);}
async function arm(code, success, status='failed') {
  await panel.evaluate(value=>{globalThis.__mechFailure=value;}, {code,success,status});
}
async function outcome(expected) {
  await panel.waitForFunction(pattern => !crossFigureLogicRunning &&
    new RegExp(pattern).test(document.getElementById('sidePanelNotificationLatest')?.textContent||''),expected);
  return panel.evaluate(()=>({message:document.getElementById('sidePanelNotificationLatest').textContent,
    history:sidePanelNotificationHistory.map(i=>({message:i.message,type:i.type})),
    presentation:mechanismGenerationUiController.presentation(), calls:globalThis.__mechRequests.length}));
}
(async()=>{
  fs.mkdirSync(extension);
  for(const dir of ['core','providers','vendor','icons','_locales']) fs.cpSync(path.join(root,dir),path.join(extension,dir),{recursive:true});
  for(const file of fs.readdirSync(root)) if(/\.(js|mjs|html|css)$/.test(file)||file==='manifest.json') fs.copyFileSync(path.join(root,file),path.join(extension,file));
  for(const file of ['popup.js','content.js','core/background-router.js','core/mechanism-operation-coordinator.js']) report.sourceHashes[file]=hash(fs.readFileSync(path.join(root,file)));
  const transport=path.join(extension,'offscreen-network-worker.js');
  fs.writeFileSync(transport,'globalThis.fetch=async()=>{throw Error("MECH008_REAL_NETWORK_DISABLED");};\n'+fs.readFileSync(transport,'utf8'));
  context=await chromium.launchPersistentContext(path.join(temporary,'profile'),{channel:'msedge',headless:true,reducedMotion:'reduce',viewport:{width:1280,height:900},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
  await context.route(/^https?:\/\//,route=>route.request().url()===url
    ? route.fulfill({contentType:'text/html',body:'<html><head><title>'+title+'</title><link rel="canonical" href="'+url+'"></head><body><article><h1>'+title+'</h1><h2>Introduction</h2><p>This synthetic study compares a defined intervention with matched controls. The experiment asks whether changes in the measured signal are associated with changes in a behavioral outcome.</p><h2>Methods</h2><p>Matched control and intervention groups were measured independently using the same assay and timing. The analysis preserves the study conditions and does not infer causality from correlation alone.</p><h2>Results</h2><p>Figure 1 shows lower signal after intervention. Figure 2 shows an associated behavioral change.</p></article></body></html>'})
    : route.abort('blockedbyclient'));
  paper=context.pages()[0]||await context.newPage();await paper.goto(url);
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const tab=await worker.evaluate(async source=>(await chrome.tabs.query({})).find(t=>t.url===source),url);
  await worker.evaluate(async target=>{const activation=await SciLLM.markTabActivated(chrome.storage.session,target);await chrome.runtime.sendMessage({type:'PANEL_TAB_ACTIVATED',activation}).catch(()=>{});},tab);
  panel=await context.newPage();panel.on('pageerror',e=>report.errors.push(e.message));
  await panel.setViewportSize({width:420,height:900});await panel.goto('chrome-extension://'+new URL(worker.url()).host+'/popup.html');await paper.bringToFront();
  await panel.waitForFunction(expected=>document.getElementById('sidePanelPaperTitle')?.textContent===expected,title);
  await panel.evaluate(async()=>{
    for(const message of [
      {type:'LLM_SAVE_PROFILE',profile:{id:'profile_mech008_ui',name:'Local terminal fixture',providerId:'deepseek',config:{apiKey:'fixture-not-a-real-key',model:'deepseek-flash',maxOutputTokens:8192,reasoningEnabled:false}}},
      {type:'LLM_UPDATE_PROFILE_ROUTING',globalProfileId:'profile_mech008_ui',taskRoutes:{}},
      {type:'LLM_UPDATE_PREFERENCES',preferences:{mode:'llm',consentGranted:true}}
    ]) {const response=await chrome.runtime.sendMessage(message);if(!response?.success)throw Error('PROFILE_FIXTURE_SETUP_FAILED');}
    await loadLlmSettings();await refreshArticleWorkspace();switchWorkspaceView('figures');
    const original=sendTabMessage;globalThis.__mechRequests=[];
    sendTabMessage=async function(tabId,message,...rest){
      if(message.action!=='analyzeCrossFigureLogicWithLLM')return original(tabId,message,...rest);
      globalThis.__mechRequests.push({operationId:message.operationId,code:globalThis.__mechFailure.code});
      return {...globalThis.__mechFailure,operationId:message.operationId,operationEpoch:1,evidenceFirstVersions:message.evidenceFirstVersions};
    };
  });
  await arm('MECHANISM_OPERATION_DEADLINE_EXCEEDED',false);
  await panel.locator('.workspace-logic-map-open').click();
  const first=await outcome('运行时限');
  check('real new-mechanism click records runtime limit, not model setting blame',first.calls===1&&!first.message.includes('检查模型设置'));
  check('terminal controller releases busy state and cancel button',!first.presentation.active&&await panel.locator('#cancelMechanismGeneration').isHidden());
  await panel.locator('#backFromMechanismChain').click();
  await arm('MECHANISM_PROVIDER_REQUEST_BUDGET_EXCEEDED',true);
  await panel.locator('.workspace-logic-map-open').click();
  const second=await outcome('调用次数上限');
  check('user can reopen and retry after failure',second.calls===2&&first.presentation.operation.operationId!==second.presentation.operation.operationId);
  check('successful transport with failed generation retains budget cause',!second.message.includes('API 额度')&&!second.message.includes('检查模型设置'));
  await panel.locator('#addMechanismChainNode').click();
  await panel.waitForFunction(()=>mechanismWorkspaceDraft()?.mechanismChain?.nodes?.length>0);
  const before=await panel.evaluate(()=>JSON.stringify(mechanismWorkspaceDraft()?.mechanismChain));
  await arm('MECHANISM_CHECKPOINT_WRITE_FAILED',false);
  await panel.evaluate(()=>runCrossFigureLogic({returnView:'mechanism'}));
  const third=await outcome('保存阶段检查点未获确认');
  check('checkpoint failure does not promise a successful save',!third.message.includes('已保存检查点'));
  check('existing manually added node survives failed generation',before===await panel.evaluate(()=>JSON.stringify(mechanismWorkspaceDraft()?.mechanismChain)));
  await panel.locator('#sidePanelNotificationSummary').click();
  check('all three failure causes remain readable in actual notification history',await panel.locator('#sidePanelNotificationHistory').textContent().then(t=>/运行时限/.test(t)&&/调用次数上限/.test(t)&&/保存阶段检查点未获确认/.test(t)));
  for(const width of [420,360]){
    await panel.setViewportSize({width,height:900});
    check('notification layout has no horizontal overflow at '+width,await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const name='mechanism-errors-'+width+'.png';await panel.screenshot({path:path.join(output,name)});report.screenshots.push(name);
  }
  await panel.reload();await paper.bringToFront();await panel.waitForFunction(expected=>document.getElementById('sidePanelPaperTitle')?.textContent===expected,title);
  await panel.waitForFunction(()=>sidePanelNotificationHistory.some(i=>i.message.includes('保存阶段检查点未获确认')));
  check('failure notification survives panel reload',await panel.evaluate(()=>sidePanelNotificationHistory.some(i=>i.message.includes('运行时限'))));
  check('production source unchanged during run',Object.entries(report.sourceHashes).every(([file,digest])=>hash(fs.readFileSync(path.join(root,file)))===digest));
  check('no page errors',report.errors.length===0);report.status='PASS';
})().catch(async error=>{report.status='FAIL';report.error=error.message;process.exitCode=1;if(panel){report.failureText=await panel.locator('body').textContent().catch(()=> '');await panel.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}})
  .finally(async()=>{await context?.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error,output}));});
