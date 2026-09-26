// Real public publisher DOM, fresh provider responses, real Chromium local storage.
// No fixture article, saved model response, or daily browser profile is used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { readSecretFromTty } from './probe-deepseek-figure-recovery.mjs';

const root = path.resolve(import.meta.dirname, '..');
const resumeMechanism = process.argv.includes('--resume-mechanism');
const verifySaved = process.argv.includes('--verify-saved-result');
const output = path.join(root, 'output/playwright',
  verifySaved ? 'live-workspace-mechanism-restored' : resumeMechanism ? 'live-workspace-mechanism-continuation' :
    process.argv.includes('--single-only') ? 'live-workspace-first-figure' : 'live-workspace-reset');
fs.mkdirSync(output, { recursive: true });
if (fs.existsSync(path.join(output, 'report.json'))) {
  fs.copyFileSync(path.join(output, 'report.json'), path.join(output, `report-${Date.now()}.json`));
}
const liveApi = process.argv.includes('--live-api');
const model = 'deepseek-v4-flash';
const url = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11446153/';
const dummy = 'live-figure-proxy-dummy-not-a-real-key';
const report = { status: 'RUNNING', url, liveArticle: true, replay: false, model,
  realApiCalls: 0, providerRequests: [], checks: [], pageErrors: [], sourceHashes: {},
  storage: 'Chromium origin-private directory, in an isolated profile',
  boundary: 'temporary offscreen fetch transport forwards unmodified bodies to DeepSeek; no response replay' };
const persist = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const checkpoint = (name, data = {}) => { report.checks.push({ name, ...data }); persist(); console.log(JSON.stringify({ name, realApiCalls: report.realApiCalls })); };
const requireTrue = (condition, message) => { if (!condition) throw new Error(message); };
async function verifyMechanismContinuation(panel, paper) {
  if (!verifySaved) await panel.evaluate(() => runCrossFigureLogic({ returnView: 'mechanism' }));
  else {
    const acquired = JSON.parse(fs.readFileSync(path.join(root,
      'output/playwright/live-workspace-mechanism-continuation/report.json'), 'utf8'));
    const mechanism = acquired.checks.findLast(check => check.mechanism)?.mechanism;
    const expected = (mechanism?.result || mechanism?.pendingResult)?.evidenceFirstMechanism?.canonicalDigest;
    requireTrue(expected && acquired.realApiCalls > 0 && acquired.replay === false, 'FRESH_MECHANISM_EVIDENCE_MISSING');
    report.priorFreshMechanismReport = 'output/playwright/live-workspace-mechanism-continuation/report.json';
    await panel.waitForFunction(digest => {
      const state = currentWorkspaceSnapshot?.figures?.crossFigureLogic;
      return (state?.result || state?.pendingResult)?.evidenceFirstMechanism?.canonicalDigest === digest;
    }, expected, { timeout: 60000 });
  }
  await panel.evaluate(() => refreshArticleWorkspace());
  await panel.evaluate(() => switchWorkspaceView('mechanism'));
  checkpoint('fresh-mechanism-result', await panel.evaluate(() => ({
    mechanism: currentWorkspaceSnapshot.figures.crossFigureLogic,
    draft: currentWorkspaceSnapshot.figures.draft
  })));
  const mechanism = report.checks.at(-1).mechanism;
  requireTrue(['complete', 'needs_review'].includes(mechanism.status), 'MECHANISM_FAILED');
  const generated = mechanism.result || mechanism.pendingResult;
  requireTrue(generated?.nodes?.length > 1 && generated.evidenceFirstMechanism?.relations?.length > 0,
    'MECHANISM_OR_EVIDENCE_EMPTY');
  await panel.screenshot({ path: path.join(output, 'fresh-mechanism.png') });
  await panel.locator('[data-mechanism-region="pending-evidence"]:visible, [data-mechanism-region="saved-evidence"]:visible').first().click();
  await panel.screenshot({ path: path.join(output, 'fresh-evidence.png') });
  const digest = generated.evidenceFirstMechanism.canonicalDigest;
  await panel.reload(); await paper.bringToFront();
  await panel.waitForFunction(digest => {
    const mechanism = currentWorkspaceSnapshot?.figures?.crossFigureLogic;
    return (mechanism?.result || mechanism?.pendingResult)?.evidenceFirstMechanism?.canonicalDigest === digest;
  }, digest, { timeout: 60000 });
  checkpoint('reload-preserves-real-mechanism-and-evidence', { canonicalDigest: digest });
  report.status = 'PASS_WITH_EVIDENCE_REVIEW';
}
let secret = '', server, context, priorFigureDraft;
try {
  if (liveApi) secret = await readSecretFromTty({ prompt: 'Authorized DeepSeek key (masked, memory only): ' });
  server = http.createServer(async (request, reply) => {
    reply.setHeader('Access-Control-Allow-Origin', '*');
    reply.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
    if (request.method === 'OPTIONS') { reply.writeHead(204); reply.end(); return; }
    try {
      requireTrue(liveApi && secret && request.method === 'POST' &&
        ['/responses', '/chat/completions'].includes(request.url) &&
        request.headers.authorization === `Bearer ${dummy}`, 'PROXY_REQUEST_REJECTED');
      requireTrue(report.realApiCalls < 60, 'LIVE_API_CALL_LIMIT');
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; requireTrue(size < 15000000, 'INPUT_TOO_LARGE'); chunks.push(chunk); }
      const body = Buffer.concat(chunks), start = Date.now();
      const entry = { call: ++report.realApiCalls, path: request.url, inputBytes: size,
        inputHash: createHash('sha256').update(body).digest('hex') };
      report.providerRequests.push(entry); persist();
      const remote = await fetch(`https://api.deepseek.com${request.url}`, {
        method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body, signal: AbortSignal.timeout(200000)
      });
      const bytes = Buffer.from(await remote.arrayBuffer());
      entry.status = remote.status; entry.elapsedMs = Date.now() - start;
      entry.outputHash = createHash('sha256').update(bytes).digest('hex');
      try { entry.usage = JSON.parse(bytes).usage; } catch {}
      persist(); console.log(JSON.stringify({ providerCall: entry.call, status: entry.status, elapsedMs: entry.elapsedMs }));
      reply.writeHead(remote.status, { 'Content-Type': remote.headers.get('content-type') || 'application/json' }); reply.end(bytes);
    } catch (error) {
      const code = error.name === 'TimeoutError' ? 'LIVE_PROXY_TIMEOUT' : 'LIVE_PROXY_FAILED';
      report.proxyError = code; persist(); reply.writeHead(502, { 'content-type': 'application/json' }); reply.end(JSON.stringify({ error: { code } }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const proxy = `http://127.0.0.1:${server.address().port}`;
  const extension = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-live-reset-extension-'));
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    if (fs.existsSync(path.join(root, directory))) fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
  }
  for (const file of fs.readdirSync(root)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(root, file), path.join(extension, file));
    }
  }
  for (const file of ['content.js', 'popup.js', 'background.js', 'core/background-router.js', 'core/figure-workspace.js']) {
    report.sourceHashes[file] = createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  }
  const networkFile = path.join(extension, 'offscreen-network-worker.js');
  const boundary = `const liveResetFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (url, options = {}) => {
  const parsed = new URL(String(url));
  if (parsed.origin !== 'https://api.deepseek.com' || !['/responses','/chat/completions'].includes(parsed.pathname)) throw new Error('LIVE_RESET_FETCH_REJECTED');
  return liveResetFetch(${JSON.stringify(proxy)} + parsed.pathname, options);
};\n`;
  fs.writeFileSync(networkFile, boundary + fs.readFileSync(networkFile, 'utf8'));
  // Temporary diagnostics preserve the underlying failure code; they do not
  // change admission, inputs, response parsing, or checkpoint behavior.
  const contentFile = path.join(extension, 'content.js');
  let content = fs.readFileSync(contentFile, 'utf8');
  const casStart = content.indexOf('async function persistFigureInventoryWithCas(');
  const throwAt = content.indexOf('        throw error;', casStart);
  content = content.slice(0, throwAt) +
    "        console.warn('LIVE_RESET_DIAG ' + JSON.stringify({ source: 'inventory-cas', code, stack: error.stack }));\n" + content.slice(throwAt);
  fs.writeFileSync(contentFile, content);
  const routerFile = path.join(extension, 'core/background-router.js');
  let router = fs.readFileSync(routerFile, 'utf8');
  router = router.replace("error.causeCode = String(cause?.code || 'CHECKPOINT_TRANSPORT_FAILED');",
    "error.causeCode = String(cause?.code || 'CHECKPOINT_TRANSPORT_FAILED'); console.warn('LIVE_RESET_DIAG ' + JSON.stringify({ source: 'checkpoint-transport', causeCode: error.causeCode, stack: cause?.stack }));");
  router = router.replace("error.causeCode = String(receipt?.code || 'CHECKPOINT_REJECTED');",
    "error.causeCode = String(receipt?.code || 'CHECKPOINT_REJECTED'); console.warn('LIVE_RESET_DIAG ' + JSON.stringify({ source: 'checkpoint-receipt', causeCode: error.causeCode }));");
  fs.writeFileSync(routerFile, router);
  let profile;
  if (resumeMechanism) {
    const priorPath = path.join(root, 'output/playwright/live-workspace-reset/report.json');
    const prior = JSON.parse(fs.readFileSync(priorPath, 'utf8'));
    const batch = prior.checks.find(check => check.name === 'fresh-batch-after-clear');
    requireTrue(prior.url === url && prior.replay === false && prior.realApiCalls > 0 &&
      batch?.figures?.length === 5 && batch.figures.every(f => f.standard?.panels?.length === f.panelHints.length && !f.standardError),
      'LIVE_PRIOR_BATCH_NOT_VALID');
    profile = fs.realpathSync(prior.profile);
    requireTrue(path.dirname(profile) === fs.realpathSync(os.tmpdir()) &&
      path.basename(profile).startsWith('brevess-live-reset-profile-'), 'ISOLATED_PROFILE_SCOPE_INVALID');
    for (const [file, digest] of Object.entries(prior.sourceHashes)) {
      requireTrue(digest === report.sourceHashes[file], 'SOURCE_CHANGED_SINCE_LIVE_BATCH');
    }
    report.priorLiveBatchReport = priorPath;
    priorFigureDraft = prior.checks.findLast(check => check.draft)?.draft?.figures;
    requireTrue(priorFigureDraft, 'PRIOR_LIVE_DRAFT_MISSING');
  } else profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-live-reset-profile-'));
  report.extension = extension; report.profile = profile; persist();
  context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: false,
    viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const traceConsole = message => {
    const text = message.text();
    if (!text.startsWith('LIVE_RESET_DIAG ')) return;
    report.checkpointDiagnostics ||= [];
    try { report.checkpointDiagnostics.push(JSON.parse(text.slice('LIVE_RESET_DIAG '.length))); } catch {}
    persist();
  };
  worker.on('console', traceConsole);
  const extensionId = new URL(worker.url()).host;
  const paper = context.pages()[0];
  paper.on('console', traceConsole);
  const response = await paper.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await paper.locator('figure, .fig').nth(1).waitFor({ state: 'attached', timeout: 30000 });
  requireTrue(await paper.locator('figure, .fig').count() >= 2, 'LIVE_PUBLISHER_FULLTEXT_UNAVAILABLE');
  checkpoint('live-public-fulltext', { httpStatus: response.status(), title: await paper.title(),
    characters: (await paper.locator('body').innerText()).length, figures: await paper.locator('figure, .fig').count() });
  await paper.screenshot({ path: path.join(output, 'live-paper.png') });
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  await settings.evaluate(async ({ model, dummy }) => {
    const handle = await navigator.storage.getDirectory();
    await SciLLM.saveDirectoryHandle(indexedDB, handle);
    for (const message of [
      { type: 'LLM_SAVE_PROFILE', profile: { id: 'profile_live_reset', name: 'Real API reset acceptance', providerId: 'deepseek', config: { apiKey: dummy, model, maxOutputTokens: 16384, reasoningEnabled: false } } },
      { type: 'LLM_UPDATE_PROFILE_ROUTING', globalProfileId: 'profile_live_reset', taskRoutes: {} },
      { type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'llm', consentGranted: true } }
    ]) { const result = await chrome.runtime.sendMessage(message); if (!result.success) throw new Error(`SETUP_FAILED:${message.type}:${result.error?.code}`); }
  }, { model, dummy });
  await settings.close();
  const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url), url);
  requireTrue(tab?.id, 'LIVE_TAB_MISSING');
  await worker.evaluate(async tab => {
    const activation = await SciLLM.markTabActivated(chrome.storage.session, tab);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
  }, tab);
  const panel = await context.newPage();
  await panel.addInitScript(() => {
    globalThis.liveReadinessTrace = [];
    document.addEventListener('DOMContentLoaded', () => {
      for (const name of ['initializeCurrentArticle', 'tryAutoRestoreCurrentArticleWorkspace',
        'prepareArticleForAdaptiveAnalysis', 'refreshArticleWorkspace', 'sendTabMessage']) {
        const original = globalThis[name];
        if (typeof original !== 'function') continue;
        globalThis[name] = async function (...args) {
          const trace = { name, action: name === 'sendTabMessage' ? args[1]?.action : '', started: Date.now() };
          liveReadinessTrace.push(trace);
          try { const value = await original.apply(this, args); trace.completed = Date.now(); return value; }
          catch (error) { trace.error = String(error?.code || error?.message || '').slice(0, 160); throw error; }
        };
      }
    }, { once: true });
  });
  panel.on('pageerror', error => { report.pageErrors.push(error.message); persist(); });
  panel.on('dialog', dialog => dialog.accept()); // only this isolated test workspace
  await panel.setViewportSize({ width: 560, height: 1000 });
  await panel.goto(`chrome-extension://${extensionId}/popup.html`);
  await paper.bringToFront();
  try {
    await panel.waitForFunction(() => preparedDocumentState?.documentHash && currentWorkspaceSnapshot?.documentId &&
      !document.getElementById('applyHighlight').disabled, null, { timeout: 60000 });
  } catch (error) {
    report.readinessDiagnostic = await panel.evaluate(() => ({ trace: liveReadinessTrace,
      sequence: articlePreparationSequence, state: prepareState,
      documentId: currentWorkspaceSnapshot?.documentId, body: document.body.innerText.slice(0, 3500) }));
    throw error;
  }
  checkpoint('activation-prepares-without-view-switch', await panel.evaluate(() => ({
    paragraphs: currentWorkspaceSnapshot.diagnostics.paragraphCount,
    documentId: currentWorkspaceSnapshot.documentId, applyText: document.getElementById('applyHighlight').textContent,
    binding: currentWorkspaceSnapshot.figures.draft.binding
  })));
  await panel.screenshot({ path: path.join(output, 'ready-analysis.png') });
  await panel.evaluate(() => switchWorkspaceView('figures'));
  const figures = await panel.evaluate(() => currentWorkspaceSnapshot.figures.figures.map(f => ({ id: f.figureId, label: f.figureLabel })));
  checkpoint('real-figure-catalog', { figures });
  if (!liveApi && !verifySaved) { report.status = 'LOCAL_READINESS_ONLY'; }
  else if (resumeMechanism) {
    report.restoreSnapshot = await panel.evaluate(() => currentWorkspaceSnapshot.figures);
    report.restoreTrace = await panel.evaluate(() => liveReadinessTrace);
    persist();
    await panel.waitForFunction(expected => JSON.stringify(currentWorkspaceSnapshot?.figures?.draft?.figures) === expected,
      JSON.stringify(priorFigureDraft), { timeout: 30000 });
    // The durable draft is authoritative after reload; transient provider
    // response replicas need not remain in the content script's memory.
    checkpoint('previous-live-batch-restored', { figures: Object.keys(priorFigureDraft).length,
      panels: Object.values(priorFigureDraft).reduce((sum, f) => sum + Object.keys(f.panels).length, 0),
      canonicalDraftFiguresEqual: true });
    await verifyMechanismContinuation(panel, paper);
  }
  else {
    // Invoke the production sidebar handler; input is taken from the live page.
    await panel.evaluate(id => runSingleFigureAnalysis(id), figures[0].id);
    await panel.evaluate(() => refreshArticleWorkspace());
    checkpoint('fresh-single-figure', await panel.evaluate(() => ({ figures: currentWorkspaceSnapshot.figures.figures,
      lifecycle: currentWorkspaceSnapshot.figures.workspaceLifecycle })));
    const first = report.checks.at(-1).figures.find(f => f.figureId === figures[0].id);
    requireTrue(first?.standard && !first.standardError &&
      first.standard.panels?.length >= first.panelHints.length, 'FIRST_FIGURE_NOT_COMPLETE');
    report.readinessTrace = await panel.evaluate(() => liveReadinessTrace);
    requireTrue(report.realApiCalls > 0, 'NO_FRESH_API_CALL');
    if (process.argv.includes('--single-only')) {
      report.status = 'FIRST_FIGURE_DIAGNOSTIC';
      await panel.screenshot({ path: path.join(output, 'fresh-single.png') });
    } else {
    await panel.evaluate(() => clearCurrentArticleWorkspace());
    checkpoint('clear-through-production-sidebar', await panel.evaluate(() => ({
      generation: currentWorkspaceSnapshot.localWorkspace.workspaceGeneration,
      lifecycle: currentWorkspaceSnapshot.figures.workspaceLifecycle,
      binding: currentWorkspaceSnapshot.figures.draft.binding
    })));
    requireTrue(report.checks.at(-1).generation > 1, 'WORKSPACE_WAS_NOT_CLEARED');
    await panel.evaluate(() => switchWorkspaceView('figures'));
    await panel.evaluate(id => runSingleFigureAnalysis(id), figures[0].id);
    await panel.evaluate(() => refreshArticleWorkspace());
    checkpoint('regenerate-after-clear', await panel.evaluate(() => ({ figures: currentWorkspaceSnapshot.figures.figures,
      lifecycle: currentWorkspaceSnapshot.figures.workspaceLifecycle })));
    const regenerated = report.checks.at(-1).figures.find(f => f.figureId === figures[0].id);
    requireTrue(regenerated?.standard && !regenerated.standardError &&
      regenerated.standard.panels?.length >= regenerated.panelHints.length, 'REGENERATION_NOT_COMPLETE');
    await panel.evaluate(() => runFigureAnalysis());
    await panel.evaluate(() => refreshArticleWorkspace());
    checkpoint('fresh-batch-after-clear', await panel.evaluate(() => ({
      figures: currentWorkspaceSnapshot.figures.figures, status: currentWorkspaceSnapshot.figures.status
    })));
    requireTrue(report.checks.at(-1).figures.every(f => (f.deep || f.standard) && !f.standardError && !f.deepError),
      'BATCH_NOT_COMPLETE');
    await panel.evaluate(() => runCrossFigureLogic());
    await panel.evaluate(() => refreshArticleWorkspace());
    checkpoint('fresh-mechanism-result', await panel.evaluate(() => ({
      mechanism: currentWorkspaceSnapshot.figures.crossFigureLogic,
      draft: currentWorkspaceSnapshot.figures.draft
    })));
    const mechanism = report.checks.at(-1).mechanism;
    requireTrue(['complete', 'needs_review'].includes(mechanism.status), 'MECHANISM_FAILED');
    const generated = mechanism.result || mechanism.pendingResult;
    requireTrue(generated?.nodes?.length > 1 && generated.evidenceFirstMechanism?.relations?.length > 0,
      'MECHANISM_OR_EVIDENCE_EMPTY');
    await panel.screenshot({ path: path.join(output, 'fresh-mechanism.png') });
    await panel.locator('[data-mechanism-region="pending-evidence"], [data-mechanism-region="saved-evidence"]').first().scrollIntoViewIfNeeded();
    await panel.screenshot({ path: path.join(output, 'fresh-evidence.png') });
    const digest = generated.evidenceFirstMechanism.canonicalDigest;
    await panel.reload(); await paper.bringToFront();
    await panel.waitForFunction(digest => {
      const mechanism = currentWorkspaceSnapshot?.figures?.crossFigureLogic;
      return (mechanism?.result || mechanism?.pendingResult)?.evidenceFirstMechanism?.canonicalDigest === digest;
    }, digest, { timeout: 60000 });
    checkpoint('reload-preserves-real-mechanism-and-evidence', { canonicalDigest: digest });
    report.status = 'PASS_WITH_EVIDENCE_REVIEW';
    }
  }
} catch (error) {
  report.status = 'FAILED'; report.error = String(error.message).slice(0, 1600); process.exitCode = 1;
  console.log(JSON.stringify({ status: report.status, error: report.error }));
} finally {
  secret = ''; persist(); await context?.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
