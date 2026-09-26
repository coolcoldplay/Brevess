import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/r16-feedback-note007-format');
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
  scope: 'NOTE-007 integrated popup editor, selection, preview and browser-local roundtrip; synthetic note responses',
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

  const field = page.locator('.literature-note-field').first();
  const textarea = field.locator('textarea');
  const action = name => field.locator(`[data-note-format-action="${name}"]`);
  const preview = field.locator('.literature-note-editor-preview');
  const toggle = field.locator('.literature-note-editor-toggle');
  const check = (name, details = {}) => report.checks.push({ name, ...details });
  assert.equal(await page.evaluate(() => typeof SciLLM.attachLiteratureNoteEditor), 'function');
  assert.equal(await page.locator('.literature-note-editor').count(), 2);
  check('production loader and both actual fields attached');
  const select = async (start, end) => {
    await textarea.focus();
    await textarea.evaluate((el, {start,end}) => { el.setSelectionRange(start,end); el.dispatchEvent(new Event('select')); }, {start,end});
  };
  const seed = async value => {
    await page.evaluate(value => {
      clearTimeout(literatureNoteSaveTimer); literatureNoteSaveTimer = null;
      literatureNoteDocumentState.valuesByTemplate.note_feedback.background = value;
      literatureNoteDocumentState.fieldStatusByTemplate = {note_feedback:{background:'supported'}};
      const binding={documentId:'sha256:'+'a'.repeat(64), documentHash:'a'.repeat(64), documentGeneration:2,revision:7,semanticCacheKey:'cache-a',semanticProvenanceKey:'proof-a'};
      const evidence={status:'verified',precision:'normalized-exact',degradedReasonCode:'',rebound:false,documentBinding:binding,locators:[{locatorKind:'pdf-semantic',...binding,paragraphId:'semantic-a',normalizedStart:100,normalizedEnd:110,expectedNormalizedQuote:'Evidence a'}],pageAnchor:{paragraphId:'pdf-page-3',pageNumber:3}};
      literatureNoteDocumentState.fieldEvidenceByTemplate = {note_feedback:{background:evidence}};
      renderLiteratureNoteDrawer();
    }, value);
  };
  const stored = () => page.evaluate(async () => (await chrome.storage.local.get(LITERATURE_NOTE_STORAGE_KEY))[LITERATURE_NOTE_STORAGE_KEY].entries['note-regeneration-fixture']);
  const waitStored = async value => {
    await page.waitForFunction(() => !literatureNoteSaveTimer && literatureNoteDirtyRevisions.size === 0, null, {timeout:10000});
    assert.equal((await stored()).valuesByTemplate.note_feedback.background, value);
  };
  await seed('D4减少；D10恢复，不支持充分性。');
  report.seed = await page.evaluate(()=>({state:structuredClone(literatureNoteDocumentState), normalized:SciLLM.normalizeLiteratureNoteEvidenceRecord(literatureNoteDocumentState.fieldEvidenceByTemplate.note_feedback.background)}));
  await select(0,4); await action('bold').click();
  report.afterInput = await page.evaluate(()=>structuredClone(literatureNoteDocumentState));
  const bold = '**D4减少**；D10恢复，不支持充分性。';
  assert.equal(await textarea.inputValue(), bold);
  await waitStored(bold); report.stored=await stored();
  assert.equal((await stored()).fieldEvidenceByTemplate.note_feedback.background.locators[0].expectedNormalizedQuote,'Evidence a');
  check('selected bold stored through real input chain with evidence intact');
  await textarea.press('Control+z');
  assert.equal(await textarea.inputValue(), 'D4减少；D10恢复，不支持充分性。');
  await textarea.press('Control+y'); assert.equal(await textarea.inputValue(),bold);
  check('native undo/redo within actual popup');
  await select(2,6); await field.locator('.literature-note-editor-color').selectOption('red');
  const colored=await textarea.inputValue();
  assert.match(colored, /data-brevess-color="red"/u); await waitStored(colored);
  assert.equal((await stored()).fieldStatusByTemplate.note_feedback.background,'supported');
  await toggle.click(); assert.equal(await textarea.isVisible(),false);
  assert.equal(await preview.locator('strong').textContent(),'D4减少');
  assert.equal(await preview.locator('[data-brevess-color="red"]').textContent(),'D4减少');
  assert.equal(await preview.locator('[data-brevess-color="red"]').evaluate(el=>getComputedStyle(el).color),'rgb(180, 35, 24)');
  assert.equal(await preview.textContent(),'D4减少；D10恢复，不支持充分性。');
  check('selected color + bold rendered; source marker is not previewed');
  await page.evaluate(async () => { literatureNoteDocumentState=null; await loadLiteratureNoteDocumentState(); renderLiteratureNoteDrawer(); });
  assert.equal(await textarea.inputValue(),colored); await toggle.click();
  assert.equal(await preview.locator('[data-brevess-color="red"]').textContent(),'D4减少');
  assert.equal(await page.locator('.literature-note-editor').count(),2);
  check('reload actual browser-local note preserves formatted bytes and clean component count');
  await toggle.click();
  await seed('3. 条件与结论\n   - 无显著差异\n     - 不支持充分性\n5. 下一步');
  await select(3,9); await action('bold').click();
  const nested=await textarea.inputValue(); await waitStored(nested);
  await page.evaluate(async()=>{literatureNoteDocumentState=null;await loadLiteratureNoteDocumentState();renderLiteratureNoteDrawer();});
  assert.equal(await textarea.inputValue(),nested);
  check('nested list spacing and original numbering survive actual persisted reload');
  await toggle.click();
  assert.equal(await preview.locator('ol').getAttribute('start'),'3');
  assert.equal(await preview.locator('ol > li').count(),2);
  assert.equal(await preview.locator('ul ul').count(),1);
  for(const width of [320,360,520]) {
    await page.setViewportSize({width,height:844});
    await preview.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+1),false);
    assert.equal(await preview.evaluate(el => el.scrollWidth > el.clientWidth+1),false);
    const screenshot=path.join(run,`note-format-${width}-preview.png`);await page.screenshot({path:screenshot});report.screenshots.push(screenshot);
    await toggle.click();
    assert.equal(await textarea.evaluate(el=>el.scrollHeight>el.clientHeight+1),false,'returning to edit must show every note line');
    const screenshotEdit=path.join(run,`note-format-${width}-edit.png`);await page.screenshot({path:screenshotEdit});report.screenshots.push(screenshotEdit);
    assert.equal(await field.locator('.literature-note-editor-toolbar').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    await toggle.click(); check('nested semantic list and controls at narrow width',{width});
  }
  await toggle.click();
  await seed('保留证据的背景');
  await page.evaluate(() => {noteFeedback.mode='fresh';noteFeedback.hold=true;});
  await field.locator('[data-generate-literature-note-field]').click();
  await page.waitForFunction(()=>typeof noteFeedback.release==='function');
  await select(0,2); await action('bold').click();
  const during=await textarea.inputValue();
  await page.evaluate(()=>noteFeedback.release());
  await page.waitForFunction(()=>!literatureNoteAutofillPromise);
  assert.equal(await textarea.inputValue(),during);
  assert.match(await page.locator('#literatureNoteStatus').textContent(),/手工修改.*保留/u);
  await waitStored(during);
  check('format during async generation counts as manual edit and survives completion');
  await page.evaluate(()=>{noteFeedback.hold=false; noteFeedback.mode='fresh';});
  await toggle.click();
  await field.locator('[data-generate-literature-note-field]').click();
  await page.waitForFunction(()=>!literatureNoteAutofillPromise);
  assert.equal(await preview.textContent(),'新生成的研究背景，基于正文证据。');
  assert.equal(await textarea.isVisible(),false);
  check('AI refresh updates open preview without destroying control or exposing stale content');
  await toggle.click();
  await textarea.fill('实际语义修改'); await waitStored('实际语义修改');
  assert.equal((await stored()).fieldEvidenceByTemplate.note_feedback?.background,undefined);
  check('real content edits still invalidate old provenance');
  await seed('<img src=x onerror=alert(1)>\n未经处理的旧笔记');
  await toggle.click();assert.equal(await preview.locator('img').count(),0);
  assert.equal(await preview.textContent(),'<img src=x onerror=alert(1)>\n未经处理的旧笔记');
  check('legacy unknown markup remains visible inert text');
  await toggle.click();
  await seed('[来源](https://example.test/paper-a) 与 来源');
  await textarea.fill('[来源](https://example.test/paper-b) 与 来源');
  await waitStored('[来源](https://example.test/paper-b) 与 来源');
  assert.equal((await stored()).fieldEvidenceByTemplate.note_feedback?.background,undefined);
  assert.equal((await stored()).fieldStatusByTemplate.note_feedback?.background,undefined);
  check('changing only a link destination invalidates saved evidence');
  await seed('[来源](https://example.test/paper-a) 与 来源');
  await textarea.fill('来源 与 [来源](https://example.test/paper-a)');
  await waitStored('来源 与 [来源](https://example.test/paper-a)');
  assert.equal((await stored()).fieldEvidenceByTemplate.note_feedback?.background,undefined);
  check('moving same URL between repeated labels invalidates evidence');
  assert.deepEqual(report.errors, []);
  report.status='PASS';
} catch (error) {
  report.failure = String(error.stack || error);
  process.exitCode = 1;
} finally {
  await context?.close();
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(output, 'latest-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length,
    report: path.join(run, 'report.json'), failure: report.failure || null }));
}
