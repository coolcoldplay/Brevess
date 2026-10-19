'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
const feature=path.resolve(__dirname,'../..'),source=process.env.SHARING_QA_SOURCE||feature;
const runRoot=path.join(feature,'output','r37-browser-qa');fs.mkdirSync(runRoot,{recursive:true});const run=fs.mkdtempSync(path.join(runRoot,'ui-'));
const checks=[],errors=[];let context;
(async()=>{try{
 context=await chromium.launchPersistentContext(path.join(run,'profile'),{channel:'msedge',headless:false,viewport:{width:1440,height:1000},args:['--disable-extensions-except='+source,'--load-extension='+source]});
 await context.route('https://**',route=>route.abort());
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const ext='chrome-extension://'+new URL(worker.url()).host;
 await page.goto(ext+'/options.html#page=models');
 await page.locator('[data-task-policy-model="article_chat"]').waitFor();
 // Only the model-directory response is synthetic; connection/routing writes,
 // normalization, reload and service-worker route resolution remain production.
 await page.evaluate(()=>{const original=callBackground;callBackground=async message=>message.type==='LLM_LIST_MODELS'
  ? {models:[{id:'deepseek-flash'},{id:'deepseek-v4-pro'}],fetchedAt:Date.now()}:original(message);});
 await page.locator('#addApiProfile').click();
 await page.locator('#providerId').selectOption('deepseek');
 await page.locator('#apiKey').fill('synthetic-ui-key');
 assert.equal(await page.locator('#model').isVisible(),false);
 assert.equal(await page.locator('#reasoningEffort').isVisible(),false);
 assert.equal(await page.locator('#profileName').isVisible(),false);
 await page.locator('#saveSettings').click();
 await page.waitForFunction(()=>!document.getElementById('saveSettings').disabled && state.settings.profiles[selectedProfileId]?.config.hasApiKey===true);
 const connection=await page.evaluate(()=>({id:selectedProfileId,model:state.settings.profiles[selectedProfileId].config.model}));
 assert.equal(connection.model,'deepseek-v4-flash');
 assert.equal(await page.evaluate(()=>state.settings.globalProfileId),connection.id);
 checks.push('New connection saves with provider and key only; model initialized automatically; advanced controls remain folded.');
 await page.locator('#globalProfileId').selectOption(connection.id);
 const model=page.locator('[data-task-policy-model="article_chat"]');
 await model.fill('deepseek-flash');
 // A late model-directory response rerenders the table while an edit may
 // still have focus. It must not discard a model before the blur event.
 await page.evaluate(()=>renderTaskPolicyTable());
 assert.equal(await model.inputValue(),'deepseek-flash','unblurred model survives async table refresh');
 await model.press('Tab');
 assert.equal(await model.inputValue(),'deepseek-flash','task model after blur');
 await page.locator('[data-task-policy-reasoning="article_chat"]').check();
 assert.equal(await model.inputValue(),'deepseek-flash','task model after thinking toggle');
 await page.locator('[data-task-policy-effort="article_chat"]').selectOption('high');
 assert.equal(await model.inputValue(),'deepseek-flash','task model after effort selection');
 await page.locator('[data-task-policy-web="article_chat"]').check();
 assert.equal(await page.locator('[data-task-policy-web="figure_walkthrough"]').isDisabled(),true);
 const manual=page.locator('[data-task-policy-model="paragraph_summary"]');
 await manual.fill('manual-new-model-v9');await manual.press('Tab');
 await page.locator('#saveTaskRouting').click();
 await page.waitForFunction(()=>document.getElementById('taskRoutingStatus').textContent.includes('已保存'));
 await page.reload();await page.locator('[data-task-policy-model="article_chat"]').waitFor();
 assert.equal(await page.locator('[data-task-policy-model="article_chat"]').inputValue(),'deepseek-flash');
 assert.equal(await page.locator('[data-task-policy-model="paragraph_summary"]').inputValue(),'manual-new-model-v9');
 assert.equal(await page.locator('[data-task-policy-web="article_chat"]').isChecked(),true);
 assert.equal(await page.locator('[data-task-policy-reasoning="article_chat"]').isChecked(),true);
 assert.equal(await page.locator('[data-task-policy-effort="article_chat"]').inputValue(),'high');
 const routes=await worker.evaluate(async()=>{const s=await SciLLM.loadSettings(chrome.storage.local);return ['article_chat','paragraph_summary','figure_walkthrough'].map(id=>{const r=SciLLM.resolveTaskProfile(s,id);return {id,model:r.model,reasoning:r.effectiveReasoning,profile:r.effectiveProfileId};});});
 assert.equal(routes[0].model,'deepseek-flash');assert.equal(routes[1].model,'manual-new-model-v9');assert.equal(routes[2].model,'deepseek-v4-flash');
 checks.push('Per-feature model, thinking, effort and web choices survive real save/reload; worker resolves distinct models while inherited tasks retain default.');
 // Switch to another connection and verify foreign model IDs are not reused.
 const other=await page.locator('#globalProfileId option').first().getAttribute('value');
 await page.locator('#globalProfileId').selectOption(other);
 assert.equal(await page.locator('[data-task-policy-model="article_chat"]').inputValue(),'');
 await page.locator('#globalProfileId').selectOption(connection.id);
 assert.equal(await page.locator('[data-task-policy-model="article_chat"]').inputValue(),'deepseek-flash');
 checks.push('Changing the default connection cannot leak an old provider model; returning restores the saved task model.');
 await page.locator('#saveTaskRouting').click();await page.waitForFunction(()=>!document.getElementById('saveTaskRouting').disabled);
 const sidebar=await context.newPage();sidebar.on('pageerror',e=>errors.push(e.message));
 await sidebar.goto(ext+'/popup.html');
 await sidebar.waitForFunction(()=>typeof llmSettingsState!=='undefined' && llmSettingsState?.settings?.taskPolicies?.article_chat?.webSearchEnabled===true);
 await sidebar.evaluate(()=>{renderArticleChatProfileOptions();syncArticleChatWebSearchToggle();});
 assert.equal(await sidebar.locator('#articleChatProfile').inputValue(),connection.id);
 assert.equal(await sidebar.locator('#articleChatWebSearch').getAttribute('data-search-mode'),'on');
 assert.equal(await sidebar.locator('#articleChatWebSearch').isDisabled(),false);
 assert.match(await sidebar.locator('#articleChatProfile option:checked').innerText(),/deepseek-flash/);
 await sidebar.close();checks.push('Real sidebar initializes the configured task connection, effective model and web-search default.');
 for(const lang of ['zh-CN','en']){
  await page.locator('#globalLanguage').selectOption(lang);
  for(const width of [1440,360]){
   await page.setViewportSize({width,height:1000});await page.locator('#apiProfilesSettings').scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(run,`connection-${lang}-${width}.png`)});
   await page.locator('#taskPolicyModules').scrollIntoViewIfNeeded();
   const layout=await page.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}));assert.ok(layout.s<=layout.w+1,JSON.stringify(layout));
   if(width===1440){const boxes=await page.locator('[data-settings-nav="models"]').evaluate(el=>({title:el.querySelector('.settings-nav-title').getBoundingClientRect().bottom,state:el.querySelector('small').getBoundingClientRect().top}));assert.ok(boxes.title<=boxes.state+1,JSON.stringify(boxes));}
   if(lang==='en') assert.doesNotMatch(await page.locator('#taskPolicyModules').innerText(),/[\u4e00-\u9fff]/u);
   await page.screenshot({path:path.join(run,`features-${lang}-${width}.png`)});
  }
 }
 checks.push('Chinese/English desktop and 360px layouts checked; feature table has no untranslated Chinese or page overflow.');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(run,'report.json'),JSON.stringify({checks,errors,routes,limitations:['Model-directory response is synthetic; no real model/API billing call.']},null,2));console.log(JSON.stringify({run,checks:checks.length,errors}));
}catch(e){fs.writeFileSync(path.join(run,'report.json'),JSON.stringify({checks,errors,failure:e.stack},null,2));console.error(e.stack);process.exitCode=1;}finally{await context?.close();}})();
