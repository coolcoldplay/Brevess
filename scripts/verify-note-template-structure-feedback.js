// NOTE-011: isolated real extension request/renderer/storage, local synthetic responses only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-note011-'));
const extension = path.join(temporary, 'extension');
const base = path.join(root, 'output/playwright/r16-feedback-note011');
fs.mkdirSync(base, { recursive: true });
const output = fs.mkdtempSync(path.join(base, 'run-'));
const title = 'NOTE-011 synthetic study: matched intervention and outcome';
const articleUrl = 'https://example.org/brevess-note011';
const background = '**关键概念**\n- 神经信号：用于传递信息的测量信号。\n\n**现状与已知**\n- 既往观察提示信号与行为相关。\n- 因而研究者比较匹配对照与干预。\n\n**未知与矛盾**\n- 信号变化是否必需仍未明确。';
const findings = '- **Figure 1：干预改变测量信号。**\n  - Panel A：与匹配对照相比，测量信号降低。\n- **Figure 2：干预组行为改变。**\n  - Panel B：行为降低，但不能仅据相关性推出因果。\n- **Figure S1：独立检测支持测量稳定性。**';
const report = { taskId: 'NOTE-011', status: 'RUNNING', realApiCalls: 0,
  personalDataAccessed: false, source: 'synthetic article and local deterministic provider',
  checks: [], requests: [], screenshots: [], sourceHashes: {}, errors: [] };
let context, panel, server, serverUrl;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const check = (name, condition) => { assert.ok(condition, name); report.checks.push(name); console.log('PASS '+name); };
function article() {
  const paragraphs = [
    ['Introduction', 'A neural signal is a measurement used to transmit information. Prior observations linked this signal with behavior. Whether a change in this signal is necessary remains unknown.'],
    ['Methods', 'The study compared matched control and intervention groups with independent measurements and a separate behavior assay.'],
    ['Results', 'Figure 1. Panel A shows that intervention reduces the measured signal compared with matched controls.'],
    ['Results', 'Figure 2. Panel B shows reduced behavior in the intervention group. Correlation alone does not establish causation.'],
    ['Results', 'Figure S1. An independent assay supports the stability of measurement.']
  ];
  return '<html><head><title>'+title+'</title><link rel="canonical" href="'+articleUrl+'"></head><body><article><h1>'+title+'</h1>'+
    paragraphs.map(([heading,text],i)=>'<h2>'+heading+'</h2><p id="p'+i+'">'+text+'</p>').join('')+'</article></body></html>';
}
function prepare() {
  fs.mkdirSync(extension);
  for (const dir of ['core','providers','vendor','icons','_locales']) fs.cpSync(path.join(root,dir),path.join(extension,dir),{recursive:true});
  for (const file of fs.readdirSync(root)) if (/\.(js|mjs|html|css)$/.test(file)||file==='manifest.json') fs.copyFileSync(path.join(root,file),path.join(extension,file));
  for (const file of ['core/reading-tools.js','core/background-router.js','popup.js','content.js','core/literature-note-renderer.js'])
    report.sourceHashes[file] = hash(fs.readFileSync(path.join(root,file)));
  const worker = path.join(extension,'offscreen-network-worker.js');
  fs.writeFileSync(worker,'const noteFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=(url,options)=>{'+
    'const u=new URL(String(url));if(u.origin!=="https://api.deepseek.com"||u.pathname!=="/chat/completions")throw Error("NOTE_REMOTE_BLOCKED");'+
    'return noteFetch('+JSON.stringify(serverUrl)+'+u.pathname,options);};\n'+fs.readFileSync(worker,'utf8'));
}
async function setup() {
  await panel.evaluate(async () => {
    for (const message of [
      {type:'LLM_SAVE_PROFILE',profile:{id:'profile_note011',name:'Local note fixture',providerId:'deepseek',config:{apiKey:'fixture-not-a-real-key',model:'deepseek-flash',maxOutputTokens:8192,reasoningEnabled:false}}},
      {type:'LLM_UPDATE_PROFILE_ROUTING',globalProfileId:'profile_note011',taskRoutes:{}},
      {type:'LLM_UPDATE_PREFERENCES',preferences:{mode:'llm',consentGranted:true}}
    ]) { const result=await chrome.runtime.sendMessage(message); if(!result?.success) throw Error('PROFILE_SETUP_FAILED'); }
    await loadLlmSettings(); await refreshArticleWorkspace(); switchWorkspaceView('notes');
  });
}
const field = id => panel.locator('.literature-note-field').filter({has:panel.locator('[data-literature-note-field="'+id+'"]')});
const input = id => panel.locator('[data-literature-note-field="'+id+'"]');
const noteValues = async () => {
  await panel.waitForFunction(() => literatureNoteDocumentState?.valuesByTemplate &&
    document.getElementById('literatureNoteTemplateSelect')?.value === literatureNoteDocumentState.templateId);
  return panel.evaluate(() => structuredClone(literatureNoteDocumentState.valuesByTemplate));
};
async function persisted() { await panel.waitForFunction(()=>!literatureNoteAutofillPromise&&!literatureNoteSaveTimer&&literatureNoteDirtyRevisions.size===0,null,{timeout:30000}); }
async function generate(id) {
  const count=report.requests.length;
  await panel.locator(id?'[data-generate-literature-note-field="'+id+'"]':'#autofillLiteratureNote').click();
  await panel.waitForFunction(()=>!literatureNoteAutofillPromise,null,{timeout:30000});
  await persisted(); check('provider requested '+(id||'blank fields'),report.requests.length===count+1);
}
async function preview(id) {
  const block=field(id); const box=block.locator('.literature-note-editor-preview');
  if(!await box.isVisible()) await block.locator('.literature-note-editor-toggle').click();
  await box.waitFor({state:'visible'}); return box;
}
(async()=>{
  server=http.createServer(async(req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    try {
      let raw=''; for await(const part of req){raw+=part;if(raw.length>2*1024*1024)throw Error('REQUEST_TOO_LARGE');}
      const body=JSON.parse(raw), text=body.messages.find(m=>m.role==='user').content;
      const payload=JSON.parse(text.split('\nLITERATURE_NOTE_REQUEST:\n')[1]);
      const records=text.split('\n').flatMap(line=>{try{const v=JSON.parse(line);return v.paragraphId?[v]:[];}catch{return [];}});
      assert.ok(records.length>0,'canonical sources supplied');
      report.requests.push({template:payload.template.id,fields:payload.template.fields.map(f=>({id:f.id,prompt:f.prompt}))});
      const values={},statuses={},sources={};
      for(const f of payload.template.fields){
        const value=f.id==='research_background'?background:f.id==='main_findings'?findings:
          f.id==='population'?'- 匹配对照与干预组。':f.id==='primary_endpoint'?'- 主要终点：测量信号变化。':'';
        values[f.id]=value;statuses[f.id]=value?'supported':'missing';sources[f.id]=value?records.map(r=>r.paragraphId).slice(0,12):[];
      }
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({values,statuses,sources})}}]}));
    }catch(error){report.serverError=error.message;res.writeHead(500);res.end('local fixture error');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));serverUrl='http://127.0.0.1:'+server.address().port;prepare();
  context=await chromium.launchPersistentContext(path.join(temporary,'profile'),{channel:'msedge',headless:true,reducedMotion:'reduce',viewport:{width:1280,height:900},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
  await context.route(/^https?:\/\//,route=>{const url=route.request().url();if(url===articleUrl)return route.fulfill({contentType:'text/html',body:article()});if(url.startsWith(serverUrl+'/'))return route.continue();return route.abort('blockedbyclient');});
  const paper=context.pages()[0]||await context.newPage();await paper.goto(articleUrl);
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const tab=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url),articleUrl);
  await worker.evaluate(async tab=>{const activation=await SciLLM.markTabActivated(chrome.storage.session,tab);await chrome.runtime.sendMessage({type:'PANEL_TAB_ACTIVATED',activation}).catch(()=>{});},tab);
  panel=await context.newPage();panel.on('pageerror',error=>report.errors.push(error.message));await panel.setViewportSize({width:620,height:960});
  await panel.goto('chrome-extension://'+new URL(worker.url()).host+'/popup.html');await paper.bringToFront();
  await panel.waitForFunction(expected=>document.getElementById('sidePanelPaperTitle')?.textContent===expected,title);await setup();
  await input('innovations').fill('人工记录：保留这个观点。');await persisted();
  await generate();
  check('actual background request carries three ordered headings',/关键概念[\s\S]*现状与已知[\s\S]*未知与矛盾/.test(report.requests[0].fields.find(f=>f.id==='research_background').prompt));
  check('actual findings request asks for Figure conclusions and Panel provenance',/each actual Figure/.test(report.requests[0].fields.find(f=>f.id==='main_findings').prompt));
  check('generated fields preserve manual sibling',await input('innovations').inputValue()==='人工记录：保留这个观点。');
  const firstValues = (await noteValues()).basic_research;
  const bg=await preview('research_background');check('background renders three distinct bold headings',await bg.locator('strong').count()===3&&await bg.locator('ul').count()===3);
  const fg=await preview('main_findings');check('findings render separate Figure and supplementary conclusions',await fg.locator('strong').count()===3&&await fg.locator('li').count()===5);
  for(const width of [620,360]){
    await panel.setViewportSize({width,height:960});await field('research_background').scrollIntoViewIfNeeded();
    check('note has no page overflow at '+width,await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const name='note-structure-'+width+'.png';await panel.screenshot({path:path.join(output,name)});report.screenshots.push(name);
  }
  await panel.setViewportSize({width:620,height:960});
  await generate('research_background');
  check('single-field regeneration keeps structure and other generated findings',report.requests[1].fields.length===1&&report.requests[1].fields[0].prompt.includes('关键概念')&&(await noteValues()).basic_research.main_findings===firstValues.main_findings);
  await panel.locator('#literatureNoteTemplateSelect').selectOption('clinical_study');await persisted();await generate();
  check('clinical request distinguishes primary and secondary outcomes',report.requests[2].fields.every(f=>f.prompt.includes('primary from secondary')));
  check('clinical generated field displays expected bullets',(await input('primary_endpoint').inputValue()).includes('- 主要终点：测量信号变化。'));
  await panel.locator('#literatureNoteTemplateSelect').selectOption('basic_research');await persisted();
  await panel.reload();await paper.bringToFront();await panel.waitForFunction(expected=>document.getElementById('sidePanelPaperTitle')?.textContent===expected,title);await setup();
  const reloadedValues = (await noteValues()).basic_research;
  check('reload retains headings, Figure structure and manual note',reloadedValues.research_background===firstValues.research_background&&reloadedValues.main_findings===firstValues.main_findings&&await input('innovations').inputValue()==='人工记录：保留这个观点。');
  check('legacy empty template configuration was not migrated',await panel.evaluate(()=>literatureNoteTemplates().every(t=>t.fields.every(f=>f.prompt===''))));
  check('generation survives reload without extra provider calls',report.requests.length===3);
  check('production bytes unchanged during run',Object.entries(report.sourceHashes).every(([file,digest])=>hash(fs.readFileSync(path.join(root,file)))===digest));
  check('no page errors',report.errors.length===0);report.status='PASS';
})().catch(async error=>{report.status='FAIL';report.error=error.message;process.exitCode=1;if(panel){report.failureText=await panel.locator('body').textContent().catch(()=> '');await panel.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}})
  .finally(async()=>{await context?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error,output}));});
