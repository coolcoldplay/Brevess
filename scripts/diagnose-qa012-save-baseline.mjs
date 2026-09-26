// Observe real save messages in a new copy of an already closed QA profile.
// No production mutation, credentials, provider calls, response replacement, or data deletion.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reloadRuntime = process.argv.includes('--reload-runtime');
const preparePortable = process.argv.includes('--prepare-portable');
assert.ok(!preparePortable || reloadRuntime, 'portable preparation requires verified reloaded runtime');
const sourceRun = path.join(root, 'output/qa012-real-source-20260924/live07-save-fixed/run-TOvNgp');
const frozen = path.join(root, 'output/qa012-real-source-20260924/frozen-save-fixed-source');
const previous = JSON.parse(fs.readFileSync(path.join(sourceRun, 'report.json'), 'utf8'));
const expected = JSON.parse(fs.readFileSync(path.join(sourceRun, 'failure-state.json'), 'utf8'));
const sourceProfile = path.resolve(previous.isolatedProfile);
const tempRoot = fs.realpathSync(os.tmpdir());
assert.ok(sourceProfile.startsWith(tempRoot + path.sep));
assert.match(path.relative(tempRoot, sourceProfile), /^brevess-qa012-live-[^\\/]+[\\/]profile$/u);
assert.equal(previous.browserClosed, true);
assert.equal(expected.turns.length, 4);
assert.ok(expected.turns.every(turn => turn.status === 'completed'));
const outputRoot = path.join(root, 'output/playwright/arch009-qa012-save-baseline');
fs.mkdirSync(outputRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(outputRoot, 'run-'));
const temporary = fs.mkdtempSync(path.join(tempRoot, 'brevess-qa012-save-diagnosis-'));
const profile = path.join(temporary, 'profile');
const extension = path.join(temporary, 'extension');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const report = { sourceRun, sourceProfile, profile, output, status: 'RUNNING',
  apiCalls: 0, events: [], pageErrors: [], sourceHashes: {}, sourceProfileModified: false, reloadRuntime, preparePortable };
report.scriptSha256 = hash(fs.readFileSync(fileURLToPath(import.meta.url)));
const persist = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const article = previous.source;
const escapeHtml = value => String(value).replace(/[&<>"']/gu,
  x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x]);
let lastSection = '';
const body = article.paragraphs.map(p => {
  const heading = p.section !== lastSection ? `<h2>${escapeHtml(p.section)}</h2>` : '';
  lastSection = p.section;
  return `${heading}<p id="${escapeHtml(p.id)}">${escapeHtml(p.text)}</p>`;
}).join('\n');
const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(article.title)}</title><link rel="canonical" href="${escapeHtml(article.url)}"></head><body><main><article><h1>${escapeHtml(article.title)}</h1>${body}</article></main></body></html>`;
let context;
const deadline = setTimeout(() => { report.deadline = true; context?.close().catch(() => {}); }, 150000);
persist();
try {
  fs.cpSync(sourceProfile, profile, { recursive: true, errorOnExist: true, force: false });
  fs.cpSync(path.join(path.dirname(sourceProfile), 'extension'), extension,
    { recursive: true, errorOnExist: true, force: false });
  for (const name of ['background.js', 'core/background-router.js', 'popup.js', 'content.js']) {
    const expectedHash = hash(fs.readFileSync(path.join(frozen, name)));
    const actualHash = hash(fs.readFileSync(path.join(extension, name)));
    assert.equal(actualHash, expectedHash, `frozen source ${name}`);
    report.sourceHashes[name] = actualHash;
  }
  const networkWorker = path.join(extension, 'offscreen-network-worker.js');
  fs.writeFileSync(networkWorker, `globalThis.fetch=()=>{throw Error('QA012_DIAGNOSTIC_NETWORK_BLOCKED');};\n` + fs.readFileSync(networkWorker, 'utf8'));
  context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true,
    viewport: { width: 1280, height: 1000 }, timeout: 60000,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND'] });
  context.setDefaultTimeout(30000);
  await context.route(/^https?:\/\//u, route => route.request().url() === article.url
    ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort('blockedbyclient'));
  await context.addInitScript(() => {
    if (!location.pathname.endsWith('/popup.html')) return;
    globalThis.qa012SaveEvents = [];
    const record = event => qa012SaveEvents.push({ ...event, at: Date.now() });
    document.addEventListener('DOMContentLoaded', () => {
      for (const name of ['initializeCurrentArticle', 'saveCurrentArticleWorkspace', 'sendLlmMessage', 'sendTabMessage']) {
        const original = globalThis[name];
        if (typeof original !== 'function') { record({ name, missing: true }); continue; }
        globalThis[name] = async function (...args) {
          const message = name === 'sendLlmMessage' ? args[0] : name === 'sendTabMessage' ? args[1] : {};
          const action = message?.type || message?.action || '';
          if (action && !/WORKSPACE|ArticleWorkspace|ArticleArchive|USER_DATA_SYNC/iu.test(action)) return original.apply(this, args);
          const callId = qa012SaveEvents.length;
          record({ name, action, callId, phase: 'start', permissionOnly: message?.permissionOnly,
            requestPermission: message?.requestPermission, identityKeys: Object.keys(message?.identity || {}),
            hasDocumentId: !!message?.identity?.documentId });
          try {
            const result = await original.apply(this, args);
            record({ name, action, callId, phase: 'end', success: result?.success,
              code: result?.code, error: typeof result?.error === 'object' ? result.error?.code : result?.error,
              permission: result?.permission, assetCount: result?.assetCount, turnCount: result?.turnCount,
              workspaceKeys: Object.keys(result?.workspace || {}), returnedNull: result === null });
            return result;
          } catch (error) {
            record({ name, action, callId, phase: 'throw', code: error?.code, error: String(error?.message || error) });
            throw error;
          }
        };
      }
    }, { once: true });
  });
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const inspectRuntime = () => worker.evaluate(async () => ({
    workerUrl: location.href,
    factoryHasPermissionOnlyFix: SciLLM.createBackgroundRouter.toString().includes('message.permissionOnly === true && message.requestPermission !== true'),
    directory: await directorySync.status(),
    portableConfig: (() => {
      const status = portableConfigManager.publicStatus();
      return { state: status.state, pending: status.pending, lastError: status.lastError };
    })()
  }));
  report.runtime = await inspectRuntime();
  if (reloadRuntime) {
    const newWorker = context.waitForEvent('serviceworker', { timeout: 30000 });
    await worker.evaluate(() => chrome.runtime.reload()).catch(error => {
      report.reloadDispatchMessage = String(error?.message || error).slice(0, 300);
    });
    worker = await newWorker;
    report.runtimeAfterReload = await inspectRuntime();
    assert.equal(report.runtimeAfterReload.factoryHasPermissionOnlyFix, true,
      'normal extension reload must execute the frozen fix before testing the save');
  }
  const paper = context.pages().find(p => p.url() === article.url) || await context.newPage();
  await paper.goto(article.url, { waitUntil: 'domcontentloaded' });
  const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url), article.url);
  await worker.evaluate(async tab => {
    const activation = await SciLLM.markTabActivated(chrome.storage.session, tab);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
  }, tab);
  const panel = await context.newPage();
  panel.on('pageerror', error => report.pageErrors.push(String(error.message)));
  await panel.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`, { waitUntil: 'domcontentloaded' });
  await paper.bringToFront();
  await panel.waitForFunction(({ documentId, documentHash, turnIds }) => {
    const state = currentWorkspaceSnapshot; const turns = state?.chat?.turns || [];
    return state?.documentId === documentId && state?.documentHash === documentHash &&
      state.chat.loading !== true && turns.length === turnIds.length &&
      turns.every((turn, i) => turn.turnId === turnIds[i] && turn.status === 'completed');
  }, { documentId: expected.documentId, documentHash: expected.documentHash,
    turnIds: expected.turns.map(turn => turn.turnId) });
  report.restored = { turns: 4, exactDocumentIdentity: true };
  if (preparePortable) {
    report.portableBeforePreparation = await panel.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({ type: 'PORTABLE_CONFIG_PROBE' });
      return { success: response?.success, state: response?.data?.state,
        pending: response?.data?.pending, code: response?.error?.code };
    });
    assert.equal(report.portableBeforePreparation.success, true);
    assert.equal(report.portableBeforePreparation.state, 'missing', 'never replace an existing config');
    // Only the closed QA profile's existing dummy provider settings are exported.
    // Random passphrase exists in memory for this one normal CREATE message only.
    report.portablePreparation = await panel.evaluate(async passphrase => {
      const response = await chrome.runtime.sendMessage({ type: 'PORTABLE_CONFIG_CREATE', passphrase });
      return { success: response?.success, state: response?.data?.state,
        pending: response?.data?.pending, code: response?.error?.code };
    }, crypto.randomBytes(32).toString('hex'));
    assert.equal(report.portablePreparation.success, true);
    assert.equal(report.portablePreparation.state, 'ready');
    assert.equal(report.portablePreparation.pending, false);
  }
  report.beforeSave = await panel.evaluate(() => ({
    status: document.getElementById('statusMessage')?.textContent,
    savePending: articleWorkspaceSaveGuard.isPending(), eventCount: qa012SaveEvents.length
  }));
  await panel.locator('#saveCurrentArticleWorkspace').click();
  await panel.waitForFunction(() => !articleWorkspaceSaveGuard.isPending());
  report.events = await panel.evaluate(() => qa012SaveEvents);
  report.afterSave = await panel.evaluate(() => ({
    status: document.getElementById('statusMessage')?.textContent,
    savePending: articleWorkspaceSaveGuard.isPending(), turns: currentWorkspaceSnapshot.chat.turns.length
  }));
  await panel.screenshot({ path: path.join(output, 'after-save.png'), fullPage: true });
  report.directPermissionQuery = await panel.evaluate(async () => chrome.runtime.sendMessage({
    type: 'ARTICLE_WORKSPACE_SCAN_RESTORE', permissionOnly: true, requestPermission: false
  }));
  report.runtimeAfterSave = await inspectRuntime();
  report.status = 'DIAGNOSED';
} catch (error) {
  report.status = 'FAIL'; report.error = String(error?.message || error).slice(0, 3000);
  const panel = context?.pages().find(page => page.url().endsWith('/popup.html'));
  if (panel) report.events = await panel.evaluate(() => globalThis.qa012SaveEvents || []).catch(() => []);
} finally {
  clearTimeout(deadline);
  await context?.close().catch(() => {}); report.browserClosed = true; persist();
  console.log(JSON.stringify({ output, status: report.status, error: report.error,
    runtime: report.runtime, afterSave: report.afterSave, directPermissionQuery: report.directPermissionQuery }));
}
