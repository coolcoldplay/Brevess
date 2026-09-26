import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
// Select only runtime bytes; the runner, dependencies and evidence stay in this repository.
function resolveExtensionRoot() {
  const allowed = new Set([]);
  if (process.argv.slice(2).some(arg => !allowed.has(arg))) throw Error('VERIFIER_ARGUMENT_INVALID');
  const configured = process.env.SCI_EXTENSION_ROOT;
  if (configured !== undefined && !configured.trim()) throw Error('VERIFIER_EXTENSION_ROOT_INVALID');
  const selected = path.resolve(configured === undefined ? repositoryRoot : configured);
  try {
    if (!fs.statSync(selected).isDirectory()) throw Error('not a directory');
    for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) {
      if (!fs.statSync(path.join(selected, dir)).isDirectory()) throw Error('missing runtime directory');
    }
    for (const file of ['manifest.json', 'background.js', 'content.js', 'popup.js', 'popup.html', 'popup.css', 'ui-swiss.css']) {
      if (!fs.statSync(path.join(selected, file)).isFile()) throw Error('missing runtime file');
    }
    if (JSON.parse(fs.readFileSync(path.join(selected, 'manifest.json'), 'utf8')).manifest_version !== 3) {
      throw Error('invalid extension manifest');
    }
  } catch { throw Error('VERIFIER_EXTENSION_ROOT_INVALID'); }
  return selected;
}
const root = resolveExtensionRoot();
function fingerprintCopiedExtension(directory) {
  const hashes = {};
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) visit(file);
      else {
        const relative = path.relative(directory, file).split(path.sep).join('/');
        const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        assert.equal(digest, createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex'),
          'VERIFIER_EXTENSION_COPY_CHANGED: ' + relative);
        hashes[relative] = digest;
      }
    }
  };
  visit(directory); return hashes;
}
const output = path.join(repositoryRoot, 'output/playwright/ui014-contextual-format');
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
  repositoryRoot, extensionRoot: root, copiedSourceHashes: fingerprintCopiedExtension(extension),
  scope: 'UI-014 actual popup rendering/format handlers with synthetic note state and isolated browser-local persistence; no model calls',
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
      { id: 'background', label: '研究背景' }, { id: 'question', label: '科学问题' }, { id: 'design', label: '实验设计' }, { id: 'methods', label: '重要实验方法' }, { id: 'findings', label: '主要发现' }, { id: 'limitations', label: '局限性' }
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


  const fields = page.locator('.literature-note-field'), first = fields.nth(0), second = fields.nth(1);
  const textarea = first.locator('textarea'), other = second.locator('textarea');
  const bars = page.locator('.literature-note-editor-toolbar');
  const visibleCount = () => bars.evaluateAll(nodes => nodes.filter(n => n.checkVisibility()).length);
  const check = name => report.checks.push({name});
  const shot = async name => { const file=path.join(run,name+'.png'); await page.screenshot({path:file}); report.screenshots.push(file); };
  assert.equal(await fields.count(),6); assert.equal(await visibleCount(),0);
  assert.equal(await textarea.isVisible(),true); await shot('reading-360');
  check('six actual fields start with zero visible toolbar rows');
  const geometry=await page.evaluate(()=>[...document.querySelectorAll('.literature-note-field')].map(n=>({height:n.getBoundingClientRect().height,editorDisplay:getComputedStyle(n.querySelector('.literature-note-editor')).display})));
  assert.ok(geometry.every(x=>x.editorDisplay==='contents')); report.readingGeometry=geometry;
  await textarea.focus(); assert.equal(await visibleCount(),1);
  assert.deepEqual(await first.locator('.literature-note-editor-toolbar button').allTextContents(),['B','','','','','']);
  assert.equal(await first.locator('.literature-note-editor-toolbar svg').count(),5);
  assert.equal(await first.locator('[data-note-format-action="bold"]').getAttribute('title'),'加粗选中文字');
  check('only the active field shows language-neutral glyphs with accessible names');
  for(const width of [360,620]){
    await page.setViewportSize({width,height:844}); await textarea.focus();
    const g=await first.locator('.literature-note-editor-toolbar').evaluate(n=>{const b=n.getBoundingClientRect();return {x:b.x,right:b.right,width:innerWidth,height:b.height,scrollWidth:document.documentElement.scrollWidth};});
    assert.ok(g.x>=0&&g.right<=g.width&&g.height<=32&&g.scrollWidth<=g.width,JSON.stringify(g));
    await shot('editing-'+width);
  }
  check('seven icon controls stay in one compact row at 360 and 620 pixels without horizontal overflow');
  await page.setViewportSize({width:360,height:844});
  const original=await textarea.inputValue();
  await textarea.focus();await textarea.press('Control+Home');await textarea.press('Shift+ArrowRight');await textarea.press('Shift+ArrowRight');
  await first.locator('[data-note-format-action="bold"]').click();
  assert.equal(await textarea.inputValue(),'**'+original.slice(0,2)+'**'+original.slice(2));
  await page.waitForFunction(()=>!literatureNoteSaveTimer&&literatureNoteDirtyRevisions.size===0);
  const formatted=await textarea.inputValue();
  check('real keyboard selection and icon click format only the selected text and save');
  await first.locator('.literature-note-editor-toggle').click();
  report.previewObservation=await first.evaluate(n=>({text:n.querySelector('textarea').value,hidden:n.querySelector('textarea').hidden,preview:n.querySelector('.literature-note-editor-preview').outerHTML,toggle:n.querySelector('.literature-note-editor-toggle').outerHTML,status:n.querySelector('.literature-note-editor-status').textContent,focus:document.activeElement?.outerHTML})); await shot('preview-check');
  assert.equal(await first.locator('.literature-note-editor-preview').textContent(),original);
  await other.focus();assert.equal(await visibleCount(),1);assert.equal(await first.locator('.literature-note-editor-toolbar').isVisible(),false);
  assert.equal(await first.locator('.literature-note-editor-preview').isVisible(),true);
  assert.equal(await other.inputValue(),'保留科学问题');
  check('switching fields hides old controls while keeping its preview and unrelated value');
  await other.press('Shift+Tab');assert.equal(await second.locator('.literature-note-editor-toggle').evaluate(n=>n===document.activeElement),true);
  assert.equal(await visibleCount(),1);check('keyboard navigation into the toolbar retains it');
  await page.locator('#sidePanelPaperTitle').click();assert.equal(await visibleCount(),0);
  assert.equal(await first.locator('.literature-note-editor-preview').isVisible(),true);check('leaving editing removes all toolbar height without hiding preview content');
  await first.locator('.literature-note-editor-preview').click();await first.locator('.literature-note-editor-toggle').click();
  await textarea.press('Control+End');await textarea.press('Shift+ArrowLeft');
  await first.locator('.literature-note-editor-color').selectOption('green');
  assert.match(await textarea.inputValue(),/data-brevess-color="green"/u);
  await page.waitForFunction(()=>!literatureNoteSaveTimer&&literatureNoteDirtyRevisions.size===0);
  const colored=await textarea.inputValue();check('icon color selector preserves range and persists the selected color');
  await page.evaluate(async()=>{await loadLiteratureNoteDocumentState();renderLiteratureNoteDrawer();});
  assert.equal(await textarea.inputValue(),colored);assert.equal(await visibleCount(),0);assert.equal(await other.inputValue(),'保留科学问题');
  check('browser-local readback retains formatted value and manual sibling without activating toolbars');
  await page.evaluate(()=>{SciLLM.setInterfaceLanguage('en');renderLiteratureNoteDrawer();});await textarea.focus();
  assert.equal(await first.locator('[data-note-format-action="bold"]').getAttribute('aria-label'),'Bold selected text');
  assert.equal(await first.locator('.literature-note-editor-toggle').getAttribute('title'),'Preview note');
  assert.equal(await first.locator('.literature-note-editor-color option[value="green"]').textContent(),'Green');
  assert.deepEqual(await first.locator('.literature-note-editor-toolbar button').allTextContents(),['B','','','','','']);
  await shot('editing-english-360');check('English tooltips, accessible labels and color names with unchanged universal icons');
  assert.deepEqual(report.errors,[]);report.status='PASS';
} catch(error) {report.failure=String(error.stack||error);process.exitCode=1;}
finally {await context?.close();report.browserClosed=true;report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,report:path.join(run,'report.json'),failure:report.failure||null}));}
