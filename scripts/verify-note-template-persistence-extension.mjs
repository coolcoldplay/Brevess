import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

// Short, offline integration fixture. The supplied extension root may be an
// extracted release ZIP. Only document identity and one transport delay are
// synthetic: the dropdown, save coordinator, background router and storage run.
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const root = path.resolve(process.env.SCI_EXTENSION_ROOT || repositoryRoot);
const output = path.resolve(process.env.SCI_QA_OUTPUT_DIR ||
  path.join(repositoryRoot, 'output/playwright/note-template-persistence'));
let temporary;
let extension;
const key = 'qa-note-template-paper';
const storageKey = 'sciLiteratureNotesV1';
const beforeTime = 10;
const articleUrl = 'https://example.org/qa-note-template-paper';
const articleHtml = `<!doctype html><html><head><title>Note persistence fixture</title>
  <link rel="canonical" href="${articleUrl}"></head><body><article>
  <h1>Note persistence fixture</h1><h2>Results</h2>
  <p>These synthetic observations describe matched experimental conditions and bounded evidence.
  They provide an active article target for note persistence checks without requesting a model.</p>
  <h2>Discussion</h2><p>The synthetic document supplies only local reading context.
  Saved notes and template choices remain the subject of this offline acceptance.</p>
  </article></body></html>`;
const expectedValues = {
  qa_template_a: { finding: 'Synthetic original note A.' },
  qa_template_b: { finding: 'Synthetic original note B.' }
};
const report = { status: 'FAIL', checks: [], screenshots: [], pageErrors: [],
  externalRequests: 0, modelRequests: 0, sourceHashes: {},
  networkMode: 'Offline from launch; request counters cover HTTP(S) attempts after route registration.',
  scope: 'Isolated Edge; synthetic document identity; real popup/background/local storage; not native side-panel lifecycle.' };

let context;
let page;
let articlePage;
async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  const filename = path.join(output, name + '.png');
  await page.screenshot({ path: filename });
  report.screenshots.push(filename);
}
async function waitForStoredNote(page, documentKey, predicate) {
  const deadline = Date.now() + 10000;
  let note;
  do {
    note = await page.evaluate(async ({ documentKey, storageKey }) =>
      (await chrome.storage.local.get(storageKey))[storageKey]?.entries?.[documentKey],
    { documentKey, storageKey });
    if (predicate(note)) return note;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for the expected local note record');
}
async function prepareDocument(page, documentKey = key) {
  await articlePage.bringToFront();
  await page.waitForFunction(() => panelUiReady === true);
  await page.waitForFunction(() => activePanelTabContext.activated === true);
  await page.evaluate(async documentKey => {
    // popup.html is opened as an extension tab in this bounded fixture, not a
    // native side panel bound to a publisher. No publisher/AI response is faked.
    literatureNoteWorkspaceTarget = () => null;
    literatureNoteDocumentKey = () => documentKey;
    preparedDocumentState = null;
    currentWorkspaceSnapshot = null;
    literatureNoteDocumentState = null;
    await loadLlmSettings();
    switchWorkspaceView('navigation', { persist: false });
    globalThis.noteQa = { pending: false, release: null, holdNext: false,
      messages: [], statuses: [] };
    const status = document.getElementById('literatureNoteStatus');
    new MutationObserver(() => noteQa.statuses.push(status.textContent))
      .observe(status, { childList: true, characterData: true, subtree: true });
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (...args) => {
      if (args[0]?.type === 'LITERATURE_NOTE_COMMIT_DELTA') {
        noteQa.messages.push({ type: args[0].type,
          fields: args[0].delta?.fields?.length,
          templateId: args[0].delta?.templateId,
          selection: args[0].delta?.templateSelection?.mode || 'legacy' });
        if (noteQa.holdNext) {
          noteQa.holdNext = false;
          noteQa.pending = true;
          await new Promise(resolve => { noteQa.release = resolve; });
          noteQa.pending = false;
        }
      }
      return original(...args);
    };
  }, documentKey);
}

try {
  fs.mkdirSync(output, { recursive: true });
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-note-persistence-'));
  extension = path.join(temporary, 'extension');
  fs.mkdirSync(extension);
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
  }
  for (const file of fs.readdirSync(root)) {
    if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(root, file), path.join(extension, file));
    }
  }
  for (const file of ['popup.js', 'popup.html', 'core/background-router.js',
    'core/reading-tools.js', 'core/i18n.js', 'options.js']) {
    report.sourceHashes[file] = crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(extension, file))).digest('hex');
  }
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, reducedMotion: 'reduce', offline: true,
    viewport: { width: 360, height: 844 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  context.setDefaultTimeout(10000);
  await context.route(/^https?:\/\//u, route => {
    if (route.request().url() === articleUrl) {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: articleHtml });
    }
    report.externalRequests += 1;
    if (/\/chat\/completions|\/responses|\/messages/u.test(route.request().url())) {
      report.modelRequests += 1;
    }
    return route.abort('blockedbyclient');
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${new URL(worker.url()).host}`;
  articlePage = context.pages()[0] || await context.newPage();
  await articlePage.goto(articleUrl);
  await worker.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(item => item.url === url);
    const activation = await SciLLM.markTabActivated(chrome.storage.session, tab);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
  }, articleUrl);
  page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.goto(base + '/popup.html');
  await page.waitForFunction(() => panelUiReady === true);
  await page.evaluate(async ({ key, storageKey, expectedValues, beforeTime }) => {
    const templates = ['a', 'b'].map(suffix => ({ id: `qa_template_${suffix}`,
      name: `验收模板 ${suffix.toUpperCase()}`, fields: [{ id: 'finding',
        label: '测试笔记', prompt: '仅用于离线验收，不调用模型。',
        placeholder: '', multiline: true, required: false }] }));
    const response = await chrome.runtime.sendMessage({ type: 'LLM_UPDATE_PREFERENCES',
      preferences: { literatureNoteTemplates: templates, language: 'zh-CN' } });
    if (!response?.success) throw new Error(response?.error?.code || 'FIXTURE_SETUP_FAILED');
    await chrome.storage.local.set({ [storageKey]: { schemaVersion: 2, entries: {
      [key]: { schemaVersion: 2, templateId: 'qa_template_a',
        valuesByTemplate: expectedValues, fieldStatusByTemplate: {}, updatedAt: beforeTime }
    } } });
  }, { key, storageKey, expectedValues, beforeTime });
  await prepareDocument(page);
  await page.locator('[data-workspace-target="notes"]').click();
  await page.waitForFunction(() => document.getElementById('literatureNoteTemplateSelect').value === 'qa_template_a');
  assert.equal(await page.locator('[data-literature-note-field="finding"]').inputValue(), expectedValues.qa_template_a.finding);
  assert.equal(await page.evaluate(() => literatureNoteDirtyRevisions.size), 0);
  await capture(page, '01-notes-before');
  report.checks.push('real bottom notes module loads a legacy local note and its body');

  await page.evaluate(() => { noteQa.holdNext = true; });
  await page.locator('#literatureNoteTemplateSelect').selectOption('qa_template_b');
  await page.waitForFunction(() => noteQa.pending === true, null, { timeout: 4000 });
  assert.match(await page.locator('#literatureNoteStatus').innerText(), /正在保存/u);
  assert.equal(await page.evaluate(() => literatureNoteDirtyRevisions.size), 0);
  const messages = await page.evaluate(() => noteQa.messages);
  report.templateOnlyMessages = messages;
  assert.ok(messages.some(message => message.selection === 'set' && message.fields === 0));
  await capture(page, '02-template-save-pending');
  report.checks.push('template-only change reserves immediately with zero fabricated body fields');
  await page.evaluate(() => noteQa.release());
  const saved = await waitForStoredNote(page, key, note => note?.templateId === 'qa_template_b');
  await page.waitForFunction(() =>
    document.getElementById('literatureNoteStatus').textContent === '已自动保存到本机');
  await page.evaluate(() => literatureNotePersistenceCoordinator.whenDrained());
  const settled = await page.evaluate(() => ({
    selection: literatureNoteTemplateSelection,
    dirtyFields: literatureNoteDirtyRevisions.size,
    retries: literatureNotePersistenceCoordinator.getQueueStats().retryContexts
  }));
  assert.deepEqual(settled, { selection: null, dirtyFields: 0, retries: 0 });
  assert.deepEqual(saved.valuesByTemplate, expectedValues);
  assert.ok(saved.updatedAt > beforeTime);
  assert.equal(saved.fieldUpdatedAtByTemplate.qa_template_a.finding, beforeTime);
  assert.equal(saved.fieldUpdatedAtByTemplate.qa_template_b.finding, beforeTime);
  report.saveStatusTransitions = await page.evaluate(() => noteQa.statuses);
  report.checks.push('actual background commit saves selection while retaining legacy body clocks and values');

  await page.locator('[data-workspace-target="highlights"]').click();
  await page.locator('[data-workspace-target="notes"]').click();
  assert.equal(await page.locator('#literatureNoteTemplateSelect').inputValue(), 'qa_template_b');
  await page.reload();
  await prepareDocument(page);
  await page.locator('[data-workspace-target="notes"]').click();
  await page.waitForFunction(() => document.getElementById('literatureNoteTemplateSelect').value === 'qa_template_b');
  assert.equal(await page.locator('[data-literature-note-field="finding"]').inputValue(), expectedValues.qa_template_b.finding);
  assert.match(await page.locator('#literatureNoteStatus').innerText(), /^(?:已)?自动保存到本机$/u);
  await capture(page, '03-notes-reloaded');
  report.checks.push('switching modules and reloading preserves the selected template and body without a stuck saving state');

  const legacy = await page.evaluate(async ({ key, storageKey }) => {
    const before = await chrome.storage.local.get(storageKey);
    const response = await chrome.runtime.sendMessage({ type: 'LITERATURE_NOTE_COMMIT_DELTA',
      documentKey: key, delta: { templateId: 'qa_template_a', fields: [] } });
    const after = await chrome.storage.local.get(storageKey);
    return { before, after, response };
  }, { key, storageKey });
  assert.equal(legacy.response.success, true);
  assert.deepEqual(legacy.after, legacy.before);
  assert.deepEqual(Object.keys(legacy.response.data).sort(), ['saved', 'state']);
  report.checks.push('legacy fields=[] remains read-only with its original ACK shape');

  // Compatibility guard: before this change, a first body edit also persisted
  // its visible template. A new document must not later inherit another paper's
  // global last-template preference and appear to lose that body.
  const freshKey = key + '-first-edit';
  await page.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'LLM_UPDATE_PREFERENCES',
      preferences: { lastLiteratureNoteTemplateId: 'qa_template_b' } });
    if (!response?.success) throw new Error('FIXTURE_DEFAULT_FAILED');
  });
  await page.reload();
  await prepareDocument(page, freshKey);
  await page.locator('[data-workspace-target="notes"]').click();
  await page.waitForFunction(() => document.getElementById('literatureNoteTemplateSelect').value === 'qa_template_b');
  await page.locator('[data-literature-note-field="finding"]').fill('Synthetic first body edit.');
  const firstEdit = await waitForStoredNote(page, freshKey, note =>
    note?.valuesByTemplate?.qa_template_b?.finding === 'Synthetic first body edit.');
  assert.equal(firstEdit.templateId, 'qa_template_b',
    'first body edit must persist its visible template on a previously unselected document');
  report.checks.push('first direct body edit establishes its visible template without a dropdown change');
  await page.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'LLM_UPDATE_PREFERENCES',
      preferences: { lastLiteratureNoteTemplateId: 'qa_template_a' } });
    if (!response?.success) throw new Error('FIXTURE_OTHER_DOCUMENT_DEFAULT_FAILED');
  });
  await page.reload();
  await prepareDocument(page, freshKey);
  await page.locator('[data-workspace-target="notes"]').click();
  await page.waitForFunction(() => document.getElementById('literatureNoteTemplateSelect').value === 'qa_template_b');
  assert.equal(await page.locator('[data-literature-note-field="finding"]').inputValue(), 'Synthetic first body edit.');
  await capture(page, '04-first-body-reloaded');
  report.checks.push('new note keeps its template after another document changes the global template default');
  report.statuses = await page.evaluate(() => noteQa.statuses);
  assert.deepEqual(report.pageErrors, []);
  assert.equal(report.externalRequests, 0);
  assert.equal(report.modelRequests, 0);
  report.status = 'PASS';
} catch (error) {
  report.error = error.stack || error.message;
  if (page && !page.isClosed()) {
    try {
      report.failureState = await page.evaluate(() => ({
        selectedTemplate: document.getElementById('literatureNoteTemplateSelect')?.value,
        saveStatus: document.getElementById('literatureNoteStatus')?.textContent,
        messages: globalThis.noteQa?.messages,
        pageReady: typeof panelUiReady === 'undefined' ? false : panelUiReady
      }));
      await capture(page, 'failure');
    } catch (_) {}
  }
  process.exitCode = 1;
} finally {
  const cleanupError = error => {
    report.status = 'FAIL';
    (report.cleanupErrors ||= []).push(error.message);
    process.exitCode = 1;
  };
  try { await context?.close(); } catch (error) { cleanupError(error); }
  try {
    if (temporary) {
      const resolved = path.resolve(temporary);
      if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
          path.basename(resolved).startsWith('brevess-note-persistence-')) {
        fs.rmSync(resolved, { recursive: true, force: true });
      } else throw new Error('Refused cleanup outside this verifier temporary directory');
    }
  } catch (error) { cleanupError(error); }
  try {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  } catch (error) {
    cleanupError(error);
    report.error ||= 'Unable to write this run report';
  }
}
console.log(JSON.stringify({ status: report.status, checks: report.checks.length,
  externalRequests: report.externalRequests, modelRequests: report.modelRequests,
  output, error: report.error }));
