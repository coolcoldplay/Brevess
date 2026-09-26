// Read-only source-profile diagnosis: only a new isolated copy may be changed.
// No provider request, credential access, answer injection, or production edit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRun = path.resolve(root, process.argv[2] || 'output/qa012-real-source-20260924/live03-v2/run-8wnmk4');
if (!sourceRun.startsWith(path.join(root, 'output') + path.sep)) throw Error('DIAGNOSTIC_RUN_BOUNDARY');
const previous = JSON.parse(fs.readFileSync(path.join(sourceRun, 'report.json'), 'utf8'));
const profile = path.resolve(previous.isolatedProfile);
const tempRoot = fs.realpathSync(os.tmpdir());
if (!profile.startsWith(tempRoot + path.sep) || !/^brevess-qa012-live-[^\\/]+[\\/]profile$/u.test(path.relative(tempRoot, profile))) throw Error('DIAGNOSTIC_PROFILE_BOUNDARY');
if (previous.profileClosed !== true && previous.browserClosed !== true) throw Error('DIAGNOSTIC_PROFILE_NOT_CLOSED');
const article = previous.source;
const outputRoot = path.join(root, 'output/playwright/qa012-resume-diagnosis');
fs.mkdirSync(outputRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(outputRoot, 'run-'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-qa012-resume-diagnosis-'));
const copiedProfile = path.join(temporary, 'profile');
const extension = path.join(temporary, 'extension');
const report = { sourceRun, sourceProfile: profile, copiedProfile, output, apiCalls: 0, events: [], snapshots: [], pageErrors: [], status: 'RUNNING' };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
report.scriptSha256 = hash(fs.readFileSync(fileURLToPath(import.meta.url)));
const persist = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const escapeHtml = value => String(value).replace(/[&<>"']/gu, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x]);
function articleHtml() {
  let previous = '';
  const body = article.paragraphs.map(p => {
    const heading = p.section !== previous ? `<h2>${escapeHtml(p.section)}</h2>` : '';
    previous = p.section;
    return `${heading}<p id="${escapeHtml(p.id)}">${escapeHtml(p.text)}</p>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(article.title)}</title><link rel="canonical" href="${escapeHtml(article.url)}"></head><body><main><article><h1>${escapeHtml(article.title)}</h1>${body}</article></main></body></html>`;
}
let context;
persist();
try {
  fs.cpSync(profile, copiedProfile, { recursive: true, errorOnExist: true, force: false });
  fs.cpSync(path.join(path.dirname(profile), 'extension'), extension, { recursive: true, errorOnExist: true, force: false });
  const networkWorker = path.join(extension, 'offscreen-network-worker.js');
  fs.writeFileSync(networkWorker, `globalThis.fetch=()=>{throw Error('QA012_DIAGNOSTIC_NETWORK_BLOCKED');};\n` + fs.readFileSync(networkWorker, 'utf8'));
  report.networkWorkerSha256 = hash(fs.readFileSync(networkWorker));
  context = await chromium.launchPersistentContext(copiedProfile, { channel: 'msedge', headless: true,
    viewport: { width: 1280, height: 900 }, timeout: 60000,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  context.setDefaultTimeout(30000);
  await context.route(/^https?:\/\//u, route => route.request().url() === article.url
    ? route.fulfill({ contentType: 'text/html', body: articleHtml() }) : route.abort('blockedbyclient'));
  await context.addInitScript(() => {
    if (!location.pathname.endsWith('/popup.html')) return;
    globalThis.qa012DiagnosticEvents = [];
    const record = event => qa012DiagnosticEvents.push({ ...event, at: Date.now() });
    document.addEventListener('DOMContentLoaded', () => {
      for (const name of ['initializeCurrentArticle', 'tryAutoRestoreCurrentArticleWorkspace', 'restoreCurrentArticleWorkspaceFromDirectory', 'sendLlmMessage', 'sendTabMessage']) {
        const original = globalThis[name];
        if (typeof original !== 'function') { record({ name, missing: true }); continue; }
        globalThis[name] = async function (...args) {
          const message = name === 'sendLlmMessage' ? args[0] : name === 'sendTabMessage' ? args[1] : {};
          const action = message?.type || message?.action || '';
          if (action && !/WORKSPACE|ArticleWorkspace|ArticleArchive/iu.test(action)) return original.apply(this, args);
          record({ name, action, phase: 'start' });
          try {
            const result = await original.apply(this, args);
            record({ name, action, phase: 'end', success: result?.success, code: result?.code,
              error: result?.error, permission: result?.permission, found: !!result?.restore,
              match: result?.restore?.match, returnedNull: result === null,
              turns: result?.chatTurns ?? result?.applied?.chatTurns ?? result?.restore?.turns?.length,
              applied: result?.applied ? { success: result.applied.success, code: result.applied.code, error: result.applied.error, committed: result.applied.committed } : undefined });
            return result;
          } catch (error) { record({ name, action, phase: 'throw', code: error?.code, error: String(error?.message || error) }); throw error; }
        };
      }
    }, { once: true });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  report.directory = await worker.evaluate(async () => {
    const handle = await (await navigator.storage.getDirectory()).getDirectoryHandle('qa012-live-source', { create: true });
    await SciLLM.createIndexedDbDirectoryHandleStore(indexedDB).save(handle);
    const state = await directorySync.status();
    return { permission: state.permission, configured: state.configured };
  });
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
  await panel.waitForFunction(title => document.getElementById('sidePanelPaperTitle')?.textContent === title, article.title);
  const capture = async label => {
    const value = await panel.evaluate(() => ({
      events: qa012DiagnosticEvents,
      snapshot: { documentId: currentWorkspaceSnapshot?.documentId,
        documentHash: currentWorkspaceSnapshot?.documentHash,
        turns: (currentWorkspaceSnapshot?.chat?.turns || []).map(t => ({ turnId: t.turnId, status: t.status, blocks: t.answerBlocks?.length })),
        status: document.getElementById('status')?.textContent,
        preparationSequence: articlePreparationSequence }
    }));
    report.events = value.events;
    report.snapshots.push({ label, at: new Date().toISOString(), ...value.snapshot }); persist();
    return value;
  };
  await capture('title-visible');
  try { await panel.waitForFunction(() => qa012DiagnosticEvents.some(x => x.name === 'initializeCurrentArticle' && ['end', 'throw'].includes(x.phase)), null, { timeout: 60000 }); }
  catch { report.initializationDeadline = true; }
  await capture('initialization-settled');
  await panel.evaluate(() => refreshArticleWorkspace());
  const state = await capture('refreshed');
  if (state.snapshot.turns.length !== 2) {
    report.explicitRestore = await panel.evaluate(async () => {
      try { const r = await restoreCurrentArticleWorkspaceFromDirectory({ announce: false, allowMissing: false, requestPermission: false });
        return { success: r?.applied?.success, turns: r?.applied?.chatTurns, error: r?.applied?.error, returnedNull: r === null };
      } catch (error) { return { error: String(error?.message || error), code: error?.code }; }
    });
    await capture('after-explicit-restore');
  }
  report.status = 'DIAGNOSED';
} catch (error) {
  report.status = 'FAIL'; report.error = String(error?.message || error).slice(0, 3000);
} finally {
  await context?.close().catch(() => {}); report.browserClosed = true; persist();
  console.log(JSON.stringify({ output, status: report.status, error: report.error, snapshots: report.snapshots, explicitRestore: report.explicitRestore }));
}
