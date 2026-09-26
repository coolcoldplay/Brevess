import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/r16-feedback-note007');
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
  scope: 'Real popup DOM/clicks in isolated Edge; synthetic note responses; actual note merge and browser-local persistence',
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
  const target = page.locator('[data-generate-literature-note-field="background"]');
  const background = page.locator('[data-literature-note-field="background"]');
  const question = page.locator('[data-literature-note-field="question"]');
  for (const width of [320, 360, 520]) {
    await page.setViewportSize({ width, height: 844 });
    for (const mode of ['fresh', 'same', 'missing', 'edited', 'cleared', 'save-failure', 'cancelled', 'generation-failure', 'cached']) {
      await page.evaluate(async mode => { noteFeedback.mode = mode; await resetNoteFixture(); noteFeedback.hold = ['edited','cleared'].includes(mode); }, mode);
      assert.match(await target.getAttribute('aria-label'), /重新生成/);
      await target.click();
      if (['edited','cleared'].includes(mode)) {
        await page.waitForFunction(() => typeof noteFeedback.release === 'function');
        assert.equal(await target.isDisabled(), true);
        await background.fill('请求期间手工修改');
        if (mode === 'cleared') await background.fill('');
        await page.evaluate(() => { noteFeedback.release(); });
      }
      await page.waitForFunction(() => !literatureNoteAutofillPromise && noteFeedback.calls.length === 1);
      const request = await page.evaluate(() => noteFeedback.calls[0]);
      assert.equal(request.forceRefresh, true); assert.deepEqual(request.template.fields.map(f => f.id), ['background']);
      assert.equal(await question.inputValue(), '保留科学问题');
      assert.equal(await target.isEnabled(), true);
      const message = await page.locator('#literatureNoteStatus').textContent();
      const expected = {
        fresh: /已更新.*研究背景.*保存/, same: /内容无变化/, missing: /证据不足.*保留/,
        edited: /手工修改.*保留/, cleared: /手工修改.*保留/,
        'save-failure': /草稿保存失败.*仍保留/, cancelled: /已取消/, 'generation-failure': /无法连接模型服务/, cached: /复用本地结果/
      }[mode];
      assert.match(message, expected);
      const value = await background.inputValue();
      if (mode === 'edited') assert.equal(value, '请求期间手工修改');
      else if (mode === 'cleared') assert.equal(value, '');
      else if (['same','missing','cancelled','generation-failure'].includes(mode)) assert.equal(value, '原有研究背景');
      else assert.equal(value, '新生成的研究背景，基于正文证据。');
      if (!['save-failure','cancelled','generation-failure'].includes(mode)) {
        const stored = await page.evaluate(async () => (await chrome.storage.local.get(LITERATURE_NOTE_STORAGE_KEY))[LITERATURE_NOTE_STORAGE_KEY].entries['note-regeneration-fixture']);
        assert.equal(stored.valuesByTemplate.note_feedback.background || '', value);
        assert.equal(stored.valuesByTemplate.note_feedback.question, '保留科学问题');
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false);
      if (['fresh','missing','edited','save-failure'].includes(mode)) {
        const screenshot = path.join(run, `note-${width}-${mode}.png`);
        await page.screenshot({ path: screenshot }); report.screenshots.push(screenshot);
      }
      report.checks.push({ width, mode, message, overflow });
    }
    await page.evaluate(async () => { noteFeedback.mode = 'fresh'; await resetNoteFixture(); });
    await page.locator('#autofillLiteratureNote').click();
    await page.waitForFunction(() => !literatureNoteAutofillPromise && noteFeedback.calls.length === 1);
    assert.equal(await page.evaluate(() => noteFeedback.calls[0].forceRefresh), false);
    assert.equal(await background.inputValue(), '原有研究背景'); assert.equal(await question.inputValue(), '保留科学问题');
    report.checks.push({ width, mode: 'batch-fill', result: 'Batch fill retains existing fields and permits cache reuse' });
  }
  assert.deepEqual(report.errors, []);
  report.status = 'PASS';
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
