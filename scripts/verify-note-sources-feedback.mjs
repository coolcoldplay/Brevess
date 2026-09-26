import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/r16-feedback-note007-sources');
fs.mkdirSync(output, { recursive: true });
const run = fs.mkdtempSync(path.join(output, 'run-'));
const extension = path.join(run, 'extension');
fs.mkdirSync(extension);
for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) {
  fs.cpSync(path.join(root, dir), path.join(extension, dir), { recursive: true });
}
for (const file of fs.readdirSync(root)) {
  if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
    fs.copyFileSync(path.join(root, file), path.join(extension, file));
  }
}
const report = { status: 'FAIL', startedAt: new Date().toISOString(),
  scope: 'NOTE-007 source projection/edit/copy/download/focus with isolated browser and synthetic source receipt',
  popupSha256: createHash('sha256').update(fs.readFileSync(path.join(extension, 'popup.js'))).digest('hex'),
  realApiCalls: 0, personalDataAccessed: false, checks: [], screenshots: [], errors: [], run };
let context;
try {
  context = await chromium.launchPersistentContext(path.join(run, 'profile'), {
    channel: 'msedge', headless: true, reducedMotion: 'reduce',
    viewport: { width: 360, height: 844 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route(/^https?:\/\//u, route => route.abort('blockedbyclient'));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await page.waitForFunction(() => panelUiReady === true);
  await page.evaluate(() => synchronizeActiveTabContext());

  await page.evaluate(async () => {
    window.noteFeedback = { calls: [], mode: 'fresh', hold: false, release: null, savedStates: [] };
    activePanelTabContext.activated = true;
    document.getElementById('sidePanelApp').classList.remove('is-tab-inactive');
    capturePanelContext = () => ({ tabId: 4 }); isCurrentPanelContext = () => true;
    queryPanelTargetTab = async () => ({ id: 4 });
    literatureNoteWorkspaceTarget = () => null;
    literatureNoteDocumentKey = () => 'note-regeneration-fixture';
    currentWorkspaceSnapshot = { documentHash: 'a'.repeat(64), title: '笔记重新生成验收' };
    requireUsableLlm = () => true;
    renderLiteratureNoteModelStatus = () => {};
    const template = { id: 'note_feedback', name: '笔记验收模板', studyFamily: 'custom', fields: [
      { id: 'background', label: '研究背景' }, { id: 'question', label: '科学问题' }
    ] };
    llmSettingsState = { ...llmSettingsState, settings: { ...llmSettingsState.settings, literatureNoteTemplates: [template] } };
    const persist = persistLiteratureNoteDocumentState;
    persistLiteratureNoteDocumentState = async (...args) => {
      if (noteFeedback.mode === 'save-failure') throw Error('FIXTURE_STORAGE_FAILURE');
      const result = await persist(...args);
      noteFeedback.savedStates.push(structuredClone(literatureNoteDocumentState));
      return result;
    };
    sendTabMessage = async (_id, message) => {
      if (message.action !== 'autofillLiteratureNoteWithLLM') throw Error('Unexpected action '+message.action);
      noteFeedback.calls.push(structuredClone(message));
      const mode = noteFeedback.mode;
      if (noteFeedback.hold) await new Promise(resolve => { noteFeedback.release = resolve; });
      if (mode === 'cancelled' || mode === 'generation-failure') return {
        success: false, code: mode === 'cancelled' ? 'CANCELLED' : 'NETWORK_ERROR', error: 'Fixture generation failure'
      };
      const fields = message.template.fields;
      const missing = mode === 'missing';
      const value = mode === 'same' ? '原有研究背景' : '新生成的研究背景，基于正文证据。';
      const signature = SciLLM.stableHash(literatureNoteTemplateSignaturePayload(message.template));
      return { success: true, result: { templateId: message.template.id, documentHash: 'a'.repeat(64),
        values: Object.fromEntries(fields.map(field => [field.id, missing ? '' : value])),
        fieldStatus: Object.fromEntries(fields.map(field => [field.id, missing ? 'missing' : 'supported'])),
        sources: Object.fromEntries(fields.map(field => [field.id, missing ? [] : ['fixture-paragraph']])),
        cacheHit: mode === 'cached',
        operationReceipt: { cacheIdentity: { templateSignature: signature } },
        evidenceReceipt: { templateSignature: signature }
      } };
    };
    window.resetNoteFixture = async () => {
      clearTimeout(literatureNoteSaveTimer); literatureNoteSaveTimer = null;
      noteFeedback.calls = []; noteFeedback.hold = false; noteFeedback.release = null;
      const state = { schemaVersion: 3, templateId: 'note_feedback',
        valuesByTemplate: { note_feedback: { background: '原有研究背景', question: '保留科学问题' } },
        fieldStatusByTemplate: {}, fieldEvidenceByTemplate: {}, fieldUpdatedAtByTemplate: {}, updatedAt: 10 };
      await chrome.storage.local.set({ [LITERATURE_NOTE_STORAGE_KEY]: { entries: { 'note-regeneration-fixture': state } } });
      literatureNoteDocumentState = null;
      await loadLiteratureNoteDocumentState();
      renderLiteratureNoteDrawer();
      switchWorkspaceView('notes', { persist: false, loadNotes: false });
    };
    await resetNoteFixture();
  });

  const field=page.locator('.literature-note-field').first();
  const textarea=field.locator('textarea');
  const id='p-0123456789abcdef', unknown='p-fedcba9876543210';
  const check=(name,details={})=>report.checks.push({name,...details});
  const canonical=()=>page.evaluate(()=>literatureNoteDocumentState.valuesByTemplate.note_feedback.background);
  const select=async(start,end)=>{await textarea.focus();await textarea.evaluate((el,v)=>{el.setSelectionRange(...v);el.dispatchEvent(new Event('select'));},[start,end]);};
  const seed=async value=>page.evaluate(({value,id})=>{
    clearTimeout(literatureNoteSaveTimer);literatureNoteSaveTimer=null;
    literatureNoteDocumentState.valuesByTemplate.note_feedback.background=value;
    literatureNoteDocumentState.fieldEvidenceByTemplate={};
    literatureNoteDocumentState.fieldStatusByTemplate={note_feedback:{background:'supported'}};
    currentWorkspaceSnapshot.paragraphs=[{paragraphId:id,sourceKey:'source-results',navigationRevision:7,sectionTitle:'结果'}];
    renderLiteratureNoteDrawer();
    window.sourceFocusCalls=[];
    focusWorkspaceSourceDetailed=async(target)=>{sourceFocusCalls.push(structuredClone(target));return {success:true,focused:true};};
  },{value,id});
  const original=`1. **D4下降**；D10恢复（${id}、${unknown}）\n   - 不支持充分性。`;
  await seed(original);
  assert.doesNotMatch(await textarea.inputValue(),/p-[0-9a-f]{16}/u);
  assert.equal(await canonical(),original);
  assert.equal(await field.locator('.literature-note-html-source').count(),2);
  assert.equal(await field.locator('.literature-note-html-source').first().isEnabled(),true);
  assert.equal(await field.locator('.literature-note-html-source').last().isEnabled(),false);
  check('initial edit projection hides recognized internal IDs, preserves canonical and separates known/unknown positions');
  await field.locator('.literature-note-html-source').first().click();
  const targets=await page.evaluate(()=>sourceFocusCalls);assert.equal(targets.length,1);assert.equal(targets[0].paragraphId,id);assert.equal(targets[0].sourceKey,'source-results');
  check('each HTML source action uses exact current paragraph target (focus IPC mocked)');
  await page.evaluate(()=>currentWorkspaceSnapshot.paragraphs.push({...currentWorkspaceSnapshot.paragraphs[0]}));
  await field.locator('.literature-note-html-source').first().click();
  assert.equal((await page.evaluate(()=>sourceFocusCalls)).length,1);
  check('ambiguous current paragraph is rejected, with no first-paragraph fallback');

  await seed(original);
  const before=await textarea.inputValue();const markerStart=before.indexOf('⟦');
  await select(markerStart+1,markerStart+2);await textarea.press('Backspace');
  assert.equal(await textarea.inputValue(),before);assert.equal(await canonical(),original);
  assert.match(await field.locator('.literature-note-source-notice').textContent(),/不能拆开/);
  check('partial reference editing is blocked with visible reason and no canonical mutation');
  await select(0,0);await textarea.press('Home');await textarea.press('ArrowRight');
  await select(0,0);await textarea.pressSequentially('前言：');
  assert.equal(await canonical(),'前言：'+original);
  check('ordinary native typing changes body while retaining original source bytes');
  await textarea.press('Control+a');await textarea.pressSequentially('替换后的人工结果');
  assert.equal(await canonical(),'替换后的人工结果');
  let undoSteps=0;
  while (!(await canonical()).includes(id) && undoSteps<30) { await textarea.press('Control+z'); undoSteps+=1; }
  assert.match(await canonical(),/p-0123456789abcdef/u);
  for (let step=0;step<undoSteps;step+=1) await textarea.press('Control+y');
  assert.equal(await canonical(),'替换后的人工结果');
  check('native full-field replace/undo/redo restores the observed source registry',{undoSteps});

  await seed(original);
  const value=await textarea.inputValue();const start=value.indexOf('⟦'),end=value.indexOf('⟧')+1;
  await select(start,end);await field.locator('[data-note-format-action="bold"]').click();
  assert.match(await canonical(),/\*\*（p-0123456789abcdef、p-fedcba9876543210）\*\*/u);
  check('formatting a whole source token preserves source bytes through production input listener');
  await page.waitForFunction(()=>!literatureNoteSaveTimer&&literatureNoteDirtyRevisions.size===0,null,{timeout:10000});
  const saved=await page.evaluate(async()=>(await chrome.storage.local.get(LITERATURE_NOTE_STORAGE_KEY))[LITERATURE_NOTE_STORAGE_KEY].entries['note-regeneration-fixture'].valuesByTemplate.note_feedback.background);
  assert.match(saved,/p-0123456789abcdef/u);assert.doesNotMatch(saved,/⟦引文/u);
  await page.evaluate(async()=>{literatureNoteDocumentState=null;await loadLiteratureNoteDocumentState();renderLiteratureNoteDrawer();});
  assert.doesNotMatch(await textarea.inputValue(),/p-012345/u);
  check('real browser-local storage/reload keeps canonical anchors but reopens readable display');

  await page.evaluate(()=>{
    window.copiedNote='';
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedNote=text;}}});
  });
  await page.locator('#copyLiteratureNote').click();
  const copied=await page.evaluate(()=>copiedNote);
  assert.match(copied,/来源 1/);assert.match(copied,/待核验/);assert.doesNotMatch(copied,/p-012|\*\*/u);
  check('copy button emits readable plain note and source status (clipboard sink isolated)');
  await seed(`7. **给药**\n11. 取样\n\n步骤 11 的阴性结果见[Figure 7](https://example.test/paper?cohort=treated#figure-7)（${id}）`);
  await page.locator('#copyLiteratureNote').click();
  const steps=await page.evaluate(()=>copiedNote);
  assert.match(steps,/7\. 给药\n11\. 取样/u);assert.match(steps,/https:\/\/example.test\/paper\?cohort=treated#figure-7/u);
  check('copy retains explicit step numbers and scientific link destination after review fix');
  await seed('```js\n\nconst x = "**literal**";\n```\n\n**结论**');
  await page.locator('#copyLiteratureNote').click();
  const codeCopy=await page.evaluate(()=>copiedNote);
  assert.ok(codeCopy.includes('const x = "**literal**";'));
  assert.match(codeCopy,/\n结论\n/u);
  check('copy retains literal stars in fenced code with blank lines while removing body styling');
  await seed(original);
  const downloadPromise=page.waitForEvent('download');await page.locator('#exportLiteratureNoteMarkdown').click();
  const download=await downloadPromise;const downloadFile=path.join(run,'exported-note.md');await download.saveAs(downloadFile);
  const exported=fs.readFileSync(downloadFile,'utf8');assert.match(exported,/# 笔记验收模板/);assert.match(exported,/\*\*D4下降\*\*/);assert.match(exported,/待核验/);assert.doesNotMatch(exported,/p-012/);
  check('real Markdown download retains scientific text and Markdown without recognized internal IDs');
  await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('isolated clipboard denied');};});
  await page.locator('#copyLiteratureNote').click();await page.waitForFunction(()=>document.body.textContent.includes('复制失败：isolated clipboard denied'));
  check('clipboard failure reports failure and keeps note');

  await page.evaluate(({id})=>{
    sendTabMessage=async(_id,message)=>{
      const signature=SciLLM.stableHash(literatureNoteTemplateSignaturePayload(message.template));
      return {success:true,result:{templateId:message.template.id,documentHash:'a'.repeat(64),values:{background:'新生成的可核对结果。'},fieldStatus:{background:'supported'},sources:{background:[id]},fieldEvidence:null,
        operationReceipt:{cacheIdentity:{templateSignature:signature}},evidenceReceipt:{documentHash:'a'.repeat(64),templateSignature:signature,records:[{paragraphId:id,sourceIdentity:'source-results',textHash:'text-proof'}]}}};
    };
  },{id});
  await field.locator('[data-generate-literature-note-field]').click();
  await page.waitForFunction(()=>!literatureNoteAutofillPromise);
  assert.match(await canonical(),/新生成的可核对结果。\n（p-0123456789abcdef）/u);
  assert.doesNotMatch(await textarea.inputValue(),/p-012/);
  check('accepted HTML AI field saves only receipt-bound source IDs and projects immediately (synthetic receipt)');

  for (const width of [320,360,520]) {
    await page.setViewportSize({width,height:844});
    await field.locator('.literature-note-editor-toggle').click();
    assert.doesNotMatch(await field.locator('.literature-note-editor-preview').textContent(),/p-012/);
    const dimensions=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
    assert.ok(dimensions.scroll<=dimensions.client+1,JSON.stringify(dimensions));
    const screenshot=path.join(run,`sources-${width}.png`);await page.screenshot({path:screenshot});report.screenshots.push(screenshot);
    await field.locator('.literature-note-editor-toggle').click();
    check(`actual edit/preview/source controls at ${width}px without page overflow`);
  }
  await page.evaluate(()=>{
    const binding={documentId:'sha256:'+'a'.repeat(64),documentHash:'a'.repeat(64),documentGeneration:2,revision:7,semanticCacheKey:'cache-a',semanticProvenanceKey:'proof-a'};
    window.pdfNoteEvidence={status:'verified',precision:'normalized-exact',degradedReasonCode:'',rebound:false,documentBinding:binding,
      locators:['First PDF quote','Second PDF quote','Third PDF quote'].map((quote,index)=>({locatorKind:'pdf-semantic',...binding,paragraphId:'semantic-'+index,normalizedStart:100,normalizedEnd:100+quote.length,expectedNormalizedQuote:quote})),pageAnchor:null};
    literatureNoteDocumentState.valuesByTemplate.note_feedback.background='PDF实验结论，三个不同来源。';
    literatureNoteDocumentState.fieldEvidenceByTemplate={note_feedback:{background:pdfNoteEvidence}};
    sourceFocusCalls=[];renderLiteratureNoteDrawer();
    navigator.clipboard.writeText=async text=>{window.copiedNote=text;};
  });
  const pdfButtons=field.locator('[data-literature-note-evidence-field]');
  assert.equal(await pdfButtons.count(),3);
  for (let index=0;index<3;index+=1) {
    assert.equal(await pdfButtons.nth(index).textContent(),`正文来源 ${index+1}/3`);
    await pdfButtons.nth(index).click();
  }
  const quotes=await page.evaluate(()=>sourceFocusCalls.map(item=>item.evidence.locator.expectedNormalizedQuote));
  assert.deepEqual(quotes,['First PDF quote','Second PDF quote','Third PDF quote']);
  check('three PDF source buttons send three distinct exact locator targets (focus IPC isolated)');
  await page.locator('#copyLiteratureNote').click();
  const pdfCopied=await page.evaluate(()=>copiedNote);
  for(const quote of quotes) assert.ok(pdfCopied.includes(quote));
  assert.match(pdfCopied,/未重新核验/);assert.doesNotMatch(pdfCopied,/semantic-[012]/u);
  check('PDF copy includes all saved quotes with an explicit current-validation boundary');
  for(const status of ['stale','ambiguous','missing','invalid']) {
    await page.evaluate(status=>{
      literatureNoteDocumentState.fieldEvidenceByTemplate.note_feedback.background={...pdfNoteEvidence,status,precision:'none',locators:[],degradedReasonCode:'SOURCE_NOT_FOUND'};
      renderLiteratureNoteDrawer();
    },status);
    assert.equal(await pdfButtons.count(),1);assert.equal(await pdfButtons.first().isVisible(),true);assert.equal(await pdfButtons.first().isEnabled(),false);
    assert.ok((await pdfButtons.first().textContent()).length>0);
  }
  check('stale, ambiguous, missing and invalid PDF evidence stay visible and cannot trigger source focus');
  await page.setViewportSize({width:320,height:844});
  const pdfScreen=path.join(run,'pdf-invalid-320.png');await page.screenshot({path:pdfScreen});report.screenshots.push(pdfScreen);
  await page.locator('#copyLiteratureNote').click();assert.match(await page.evaluate(()=>copiedNote),/来源记录无效/);
  check('invalid PDF evidence export preserves the failure state rather than an empty source label');
  assert.deepEqual(report.errors,[]);report.status='PASS';
} catch(error) {
  report.failure=String(error.stack||error);process.exitCode=1;
} finally {
  await context?.close();report.completedAt=new Date().toISOString();
  fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(output,'latest-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,report:path.join(run,'report.json'),failure:report.failure||null}));
}

