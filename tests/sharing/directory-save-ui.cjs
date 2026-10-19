'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),http=require('http');
const {chromium}=require('playwright');
const feature=path.resolve(__dirname,'../..'),source=process.env.SHARING_QA_SOURCE||feature;
const runRoot=path.join(feature,'output','r37-browser-qa');fs.mkdirSync(runRoot,{recursive:true});const run=fs.mkdtempSync(path.join(runRoot,'ui-'));
const checks=[],errors=[];let context,server,page,worker,ext;
async function launch(){
 context=await chromium.launchPersistentContext(path.join(run,'profile'),{channel:'msedge',headless:false,viewport:{width:1440,height:1000},args:['--disable-extensions-except='+source,'--load-extension='+source]});
 worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');ext='chrome-extension://'+new URL(worker.url()).host;
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(ext+'/options.html#page=storage');
 await page.waitForFunction(()=>document.getElementById('chooseUserDataDirectory')&&!document.getElementById('chooseUserDataDirectory').disabled);
}
async function files(){return page.evaluate(async()=>{
 const selected=await SciLLM.loadDirectoryHandle(indexedDB),data=await selected.getDirectoryHandle('Brevess'),out={};
 async function walk(dir,prefix=''){for await(const [name,item] of dir.entries()){if(item.kind==='directory')await walk(item,prefix+name+'/');else out[prefix+name]=await(await item.getFile()).text();}}
 await walk(data);return out;
});}
async function saveArticle(){
 const article=await context.newPage();await article.goto('http://127.0.0.1:'+server.address().port+'/article');
 await worker.evaluate(async()=>{const tab=(await chrome.tabs.query({})).find(t=>t.url?.includes('/article')&&t.url.startsWith('http://127.0.0.1:'));await SciLLM.ensureContentScriptForActivation(chrome,tab.id);const activation=await SciLLM.markTabActivated(chrome.storage.session,tab);await chrome.runtime.sendMessage({type:'PANEL_TAB_ACTIVATED',activation}).catch(()=>{});});
 const panel=await context.newPage();panel.on('pageerror',e=>errors.push(e.message));await panel.goto(ext+'/popup.html');await article.bringToFront();
 await panel.waitForFunction(()=>document.getElementById('sidePanelPaperTitle')?.textContent?.includes('Directory saving QA'));
 await panel.locator('#saveCurrentArticleWorkspace').click();
 await panel.waitForFunction(()=>!document.getElementById('saveCurrentArticleWorkspace')?.disabled&&document.getElementById('statusMessage')?.textContent?.startsWith('已保存 '),{},{timeout:60000});
 const status=await panel.locator('#statusMessage').evaluate(el=>({text:el.textContent,success:el.classList.contains('success')}));assert.equal(status.success,true,JSON.stringify(status));
 await panel.screenshot({path:path.join(run,'sidebar-save-'+checks.length+'.png')});await panel.close();await article.close();
}
(async()=>{try{
 server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><html><head><title>Directory saving QA</title><meta name="citation_title" content="Directory saving QA"><meta name="citation_doi" content="10.1234/directory-qa"></head><body><article><h1>Directory saving QA</h1><h2>Introduction</h2><p>This controlled local article tests persistent file saving. Reading notes and manual annotations should survive reopening the extension without a model call or a credential backup.</p><h2>Results</h2><p>The selected directory stores article files, metadata and reading content. A completed save must confirm actual file writes and must preserve any existing configuration backup.</p></article></body></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 await launch();
 // Only the OS picker is substituted: the returned handle and all subsequent
 // IndexedDB/file writes are real browser File System Access operations (OPFS).
 await page.evaluate(()=>{window.__qaPicks=0;window.showDirectoryPicker=async()=>{window.__qaPicks++;return(await navigator.storage.getDirectory()).getDirectoryHandle('selected-folder',{create:true});};});
 await page.locator('#chooseUserDataDirectory').click();await page.waitForFunction(()=>document.getElementById('userDataStatus').textContent.includes('文件夹已就绪'));
 assert.equal(await page.locator('#portableConfigDialog').evaluate(x=>x.open),false);
 assert.equal(await page.locator('#directoryAdvancedSettings').evaluate(x=>x.open),false);
 assert.equal(await page.locator('#nativeDirectoryPath').isVisible(),false);
 assert.equal(await page.locator('#reauthorizeUserDataDirectory').isVisible(),false);
 assert.equal(await page.evaluate(()=>window.__qaPicks),1);
 assert.equal(await page.evaluate(()=>userDataUi.portableConfigStatus.state),'missing');
 for(const language of ['zh-CN','en']){await page.locator('#globalLanguage').selectOption(language);for(const width of [1440,360]){await page.setViewportSize({width,height:1000});await page.locator('#directorySyncHeading').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(run,'storage-'+language+'-'+width+'.png')});}}
 await page.locator('#globalLanguage').selectOption('zh-CN');
 checks.push('One folder choice; no passphrase/native setup; actual persisted browser directory handle; Chinese/English desktop and narrow layout.');
 await worker.evaluate(async()=>{await directorySync.enqueueText('documents/manual-note.md','Manually edited note — preserve me.');});
 await saveArticle();let saved=await files();assert.equal(saved['documents/manual-note.md'],'Manually edited note — preserve me.');assert.ok(Object.keys(saved).some(p=>p.startsWith('workspaces/')));assert.equal(saved['settings/portable-config.enc.json'],undefined);
 fs.writeFileSync(path.join(run,'saved-files.json'),JSON.stringify(Object.keys(saved),null,2));
 checks.push('Real sidebar Save writes article/workspace files and drains queued note bytes without creating any encrypted configuration.');
 await context.close();context=null;await launch();
 await page.waitForFunction(()=>document.getElementById('userDataDirectory').textContent==='selected-folder');
 assert.equal(await page.locator('#portableConfigDialog').evaluate(x=>x.open),false);
 await saveArticle();saved=await files();assert.equal(saved['documents/manual-note.md'],'Manually edited note — preserve me.');
 checks.push('Browser restart reuses the saved handle and writes the article again; existing manual note retained.');
 // User explicitly opts in to backup; later locking it must not block files.
 await page.evaluate(async()=>{await callBackground({type:'PORTABLE_CONFIG_CREATE',passphrase:'Synthetic-QA-Backup-Only-42!'});await callBackground({type:'PORTABLE_CONFIG_FORGET_KEY'});await refreshUserDataStatus();});
 const encrypted=(await files())['settings/portable-config.enc.json'];assert.ok(encrypted);assert.equal(await page.evaluate(()=>userDataUi.portableConfigStatus.state),'locked');
 await saveArticle();assert.equal((await files())['settings/portable-config.enc.json'],encrypted);
 checks.push('Opt-in encrypted backup can remain locked while Save succeeds; encrypted bytes unchanged.');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(run,'report.json'),JSON.stringify({checks,errors,source,picker:'OPFS handle substituted only for native directory picker; native OS dialog and persistent OS permission choice not automated'},null,2));console.log(JSON.stringify({run,checks:checks.length,errors}));
 }catch(e){fs.writeFileSync(path.join(run,'report.json'),JSON.stringify({checks,errors,failure:e.stack},null,2));console.error(e.stack);process.exitCode=1;}
 finally{await context?.close();if(server)await new Promise(r=>server.close(r));}
})();
