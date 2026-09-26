// ARCH-009: one real archive save -> reopen -> automatic preparation/history-card scenario.
// Reuses the cold-open verifier's isolated Edge/OPFS and real popup initialization pattern.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
// Select only runtime bytes; the runner, dependencies and evidence stay in this repository.
function resolveExtensionRoot() {
  const allowed = new Set(['--old-auto-decision', '--diagnose-commit']);
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
const outputRoot = path.join(repositoryRoot, 'output/playwright/arch009-history-card');
fs.mkdirSync(outputRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(outputRoot, 'run-'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-arch009-history-card-'));
const extension = path.join(temporary, 'extension');
const url = 'https://example.org/arch009-history-card';
const turnId = 'arch009-history-card-saved-turn';
const oldAutoDecision = process.argv.includes('--old-auto-decision');
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceFiles = ['manifest.json', 'background.js', 'content.js', 'popup.js', 'popup.html',
  'core/article-extractor.js', 'core/article-workspace.js', 'core/article-workspace-store.js',
  'core/article-workspace-save.js', 'core/article-archive.js', 'core/background-router.js',
  'core/document-store.js', 'core/manual-annotations.js', 'core/directory-sync.js',
  'core/tab-messenger.js', 'core/tab-activation.js', 'core/user-data-database.js'];
const report = { status: 'FAIL', startedAt: new Date().toISOString(), stages: [], checks: [],
  repositoryRoot, extensionRoot: root, copiedSourceHashes: {},
  sourceHashes: {}, endSourceHashes: {}, screenshots: [], pageErrors: [], remoteRequestsBlocked: 0,
  realApiCalls: 0, personalDataAccessed: false, historyCardClicked: false,
  scenario: oldAutoDecision ? 'prior-empty-workspace-auto-restored-decision' : 'no-prior-decision',
  boundary: 'One synthetic archive saved through the real content legacy archive writer, retaining any modern assets automatically produced by page preparation, then reloaded and prepared by the real popup. Native IndexedDB/extension-origin OPFS, isolated Edge profile, no API or personal data. No gate, handler, business response, or receipt replacement. If automatic restoration makes the card invisible, record that boundary without forcing it visible or substituting the tools menu.' };
report.verifierHash = sha(fs.readFileSync(import.meta.filename));
fs.copyFileSync(import.meta.filename, path.join(output, 'verifier.mjs'));
let context, worker, driver, page, panel, tabId, identity;
const stage = name => { report.stages.push({ name, at: new Date().toISOString() }); console.log(name); };
const check = name => { report.checks.push({ name, pass: true }); console.log(`PASS ${name}`); };
const message = payload => driver.evaluate(({ tabId, payload }) => chrome.tabs.sendMessage(tabId, payload), { tabId, payload });
async function inspectPage() {
  return worker.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId }, func: () => ({
    documentId: currentManualDocument?.documentId, documentHash: currentManualDocument?.record?.documentHash,
    canonicalUrl: currentManualDocument?.record?.canonicalUrl,
    workspace: currentArticleWorkspace, turns: getPublicArticleChatState().turns,
    observedRestoreRequests: globalThis.__arch009HistoryTabActions || [],
    annotations: currentManualDocument?.record?.annotations || [],
    manualMarks: document.querySelectorAll('.sci-manual-highlight').length,
    temporaryMarks: document.querySelectorAll('.sci-llm-highlight[data-restored-chat-turn-id]').length
  }) }))[0].result, tabId);
}
async function drain() {
  return worker.evaluate(async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const flushed = await directorySync.flush();
      if (flushed.failed || flushed.permission !== 'granted') throw Error('DIRECTORY_FLUSH_FAILED');
      const status = await directorySync.status();
      if (!status.pendingCount) return status;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('DIRECTORY_NOT_DRAINED');
  });
}
async function durableEvidence() {
  return worker.evaluate(async identity => ({
    record: await documentStore.getDocument(identity.documentId),
    localWorkspace: await articleWorkspaceStore.getWorkspace(identity.workspaceId),
    localAssets: await articleWorkspaceStore.listAssets(identity.workspaceId),
    directory: { status: await directorySync.status(),
      manifests: await directorySync.listWorkspaceManifests(identity),
      chat: await directorySync.readWorkspaceAsset(identity, 'chat/index.json'),
      archive: await directorySync.readJson(SciLLM.articleArchiveRelativePath(identity)) }
  }), identity);
}
async function panelEvidence() {
  return panel.evaluate(async () => ({
    boundTabId: activePanelTabContext.tabId, activated: activePanelTabContext.activated,
    snapshotDocumentId: currentWorkspaceSnapshot?.documentId,
    totalTurns: currentWorkspaceSnapshot?.chat?.totalTurns || 0,
    visibleChatTurns: [...document.querySelectorAll('#articleChatMessages > article[data-turn-id]')]
      .map(node => ({ turnId: node.dataset.turnId, text: node.textContent, visible: node.getClientRects().length > 0 })),
    resultGate: workspaceAlreadyHasArticleResults(currentWorkspaceSnapshot),
    manualCount: manualAnnotationState?.annotationCount || 0,
    archivePromptHidden: document.getElementById('articleArchivePrompt').hidden,
    archivePromptSummary: document.getElementById('articleArchivePromptSummary').textContent,
    archiveProbe: currentArticleArchiveProbe,
    archivePromptDecision: await readArticleArchivePromptDecision(),
    status: document.getElementById('statusMessage')?.textContent || '',
    notifications: sidePanelNotificationHistory.map(item => ({ ...item })),
    notification: document.getElementById('sidePanelDocumentStatusText')?.textContent || ''
  }));
}
async function waitForPreparationToSettle() {
  let last = -1, stable = 0;
  for (let attempt = 0; attempt < 160; attempt++) {
    const state = await worker.evaluate(() => ({ count: __arch009HistoryRpc.length,
      lastAt: __arch009HistoryRpc.at(-1)?.at || 0 }));
    if (state.count === last && Date.now() - state.lastAt > 800) stable++;
    else stable = 0;
    if (stable >= 4) return;
    last = state.count;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw Error('POPUP_PREPARATION_DID_NOT_SETTLE');
}
async function bindActualPanel(extensionId) {
  panel = await context.newPage(); await panel.setViewportSize({ width: 520, height: 960 });
  await panel.goto(`chrome-extension://${extensionId}/popup.html`);
  await worker.evaluate(id => chrome.tabs.update(id, { active: true }), tabId);
  await page.bringToFront();
  await panel.waitForFunction(() => typeof panelUiReady !== 'undefined' && panelUiReady,
    null, { timeout: 30_000 });
  await panel.evaluate(async () => {
    await synchronizeActiveTabContext({ force: true });
    if (!activePanelTabContext.activated) {
      await activateCurrentTabFromSidePanel();
      await synchronizeActiveTabContext({ force: true });
    }
    await refreshArticleWorkspace({ announce: false, throwOnError: true });
  });
  await waitForPreparationToSettle();
  assert.equal(await panel.evaluate(id => activePanelTabContext.tabId === id &&
    activePanelTabContext.activated === true && Boolean(currentWorkspaceSnapshot?.paragraphs?.length), tabId), true);
}

async function observeCommittedFailure(extensionId) {
  if (!process.argv.includes('--diagnose-commit')) return;
  const source = fs.readFileSync(path.join(extension, 'content.js'), 'utf8');
  const transaction = source.indexOf('async function commitArticleArchiveRestoreTransaction(');
  const failure = source.indexOf('const committedFailure = postCommitStatus => ({', transaction);
  assert.ok(transaction >= 0 && failure > transaction);
  const lineNumber = source.slice(0, failure).split('\n').length;
  const debuggerSession = await context.newCDPSession(page);
  report.committedFailureObservations = [];
  debuggerSession.on('Debugger.paused', async event => {
    try {
      const frame = event.callFrames[0];
      const result = await debuggerSession.send('Debugger.evaluateOnCallFrame', {
        callFrameId: frame.callFrameId,
        expression: '({postCommitStatus,durableFigureWorkspace,receiptRegistered,result})',
        returnByValue: true, silent: true
      });
      const observation = { reason: event.reason, functionName: frame.functionName,
        location: frame.location, value: result.result.value,
        exception: result.exceptionDetails?.exception?.description || result.exceptionDetails?.text || null,
        stack: event.callFrames.map(item => item.functionName) };
      const caller = event.callFrames.find(item => item.functionName === 'commitArticleArchiveRestoreTransaction');
      if (caller) {
        const details = await debuggerSession.send('Debugger.evaluateOnCallFrame', {
          callFrameId: caller.callFrameId,
          expression: '(() => { const read = fn => { try { return fn(); } catch (error) { return { unavailable: error.message }; } }; return { error:read(() => ({name:_.name,code:_.code,message:_.message})),controllerBinding:read(() => controller?.getBinding?.()),frozenTarget:read(() => frozenTarget),manualProofBefore:read(() => prepared.manualProofBefore),manualProofAfter:read(() => currentManualDocumentExecutionState()),manualDocumentEpochState:read(() => manualDocumentEpochState),articleWorkspaceLifecycleGeneration,articleWorkspaceSaveFrozen,figureWorkspaceDraftDirty,figureWorkspaceDraftCheckpointLoaded}; })()',
          returnByValue: true, silent: true
        });
        observation.caller = details.result.value;
        observation.callerException = details.exceptionDetails?.exception?.description || details.exceptionDetails?.text || null;
      }
      report.committedFailureObservations.push(observation);
    } catch (error) { report.committedFailureDiagnosticError = String(error); }
    finally { await debuggerSession.send('Debugger.resume').catch(() => null); }
  });
  await debuggerSession.send('Debugger.enable');
  report.committedFailureBreakpoint = await debuggerSession.send('Debugger.setBreakpointByUrl', {
    url: `chrome-extension://${extensionId}/content.js`, lineNumber
  });
}

try {
  stage('copy-and-launch'); fs.mkdirSync(extension);
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales'])
    fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
  for (const file of fs.readdirSync(root)) if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json')
    fs.copyFileSync(path.join(root, file), path.join(extension, file));
  for (const file of sourceFiles) report.sourceHashes[file] = sha(fs.readFileSync(path.join(extension, file)));
  report.copiedSourceHashes = fingerprintCopiedExtension(extension);
  fs.writeFileSync(path.join(extension, 'arch009-history-driver.html'), '<!doctype html><title>Isolated archive history verifier</title>');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, viewport: { width: 1160, height: 900 }, reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking']
  });
  context.on('page', target => target.on('pageerror', error => report.pageErrors.push(error.message)));
  await context.route(/^https?:\/\//u, route => {
    if (route.request().url() !== url) { report.remoteRequestsBlocked++; return route.abort('blockedbyclient'); }
    const paragraphs = Array.from({ length: 8 }, (_, index) => `<p>Experiment ${index + 1} tested the response of cortical neurons to a controlled stimulus. The measured response showed no significant increase in the treated condition (p = 0.12), while the positive control increased 2.4-fold. We retained independent observations and compared prespecified intervals with the matched baseline. These synthetic findings verify saved history recovery without model calls or real user data.</p>`).join('');
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="canonical" href="${url}"><title>ARCH009 synthetic history-card study</title><style>body{font:18px/1.6 sans-serif;max-width:850px;margin:30px auto}</style></head><body><main><article><h1>ARCH009 synthetic history-card study</h1><h2>Results</h2>${paragraphs}</article></main></body></html>` });
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    globalThis.fetch = async () => { throw Error('ARCH009_HISTORY_NO_EXTERNAL_API'); };
    globalThis.__arch009HistoryPhase = 'fixture'; globalThis.__arch009HistoryRpc = [];
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (typeof message?.type === 'string') __arch009HistoryRpc.push({
        phase: __arch009HistoryPhase, type: message.type, at: Date.now(),
        senderTabId: sender.tab?.id || null, senderFrameId: sender.frameId,
        workspaceId: message.identity?.workspaceId || message.workspaceId || '',
        documentId: message.identity?.documentId || message.documentId || '' });
      return false;
    });
  });
  const extensionId = new URL(worker.url()).host;
  driver = await context.newPage(); await driver.goto(`chrome-extension://${extensionId}/arch009-history-driver.html`);
  report.directorySetup = await worker.evaluate(async () => {
    const handle = await (await navigator.storage.getDirectory()).getDirectoryHandle('arch009-history-card-fixture', { create: true });
    await SciLLM.createIndexedDbDirectoryHandleStore(indexedDB).save(handle);
    return { kind: handle.kind, name: handle.name, status: await directorySync.status() };
  });
  assert.equal(report.directorySetup.status.permission, 'granted');
  stage('save-one-legacy-result-through-production-writer');
  page = await context.newPage(); await page.goto(url);
  tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, url);
  assert.ok(Number.isSafeInteger(tabId));
  await worker.evaluate(id => SciLLM.ensureContentScriptForActivation(chrome, id), tabId);
  assert.equal((await message({ action: 'getArticleWorkspaceSnapshot' })).success, true);
  const initial = await message({ action: 'ensureArticleWorkspace' }); assert.equal(initial.success, true);
  identity = { ...initial.workspace, ...initial.archiveIdentity };
  report.saved = await worker.evaluate(async ({ tabId, turnId }) => (await chrome.scripting.executeScript({ target: { tabId },
    args: [turnId], func: async turnId => {
      // Synthetic completed result only. The real production archive builder and writer are unchanged.
      const turn = publicArticleChatTurn({ turnId, question: 'What was the saved result?', intent: 'qa', status: 'completed',
        answerBlocks: [{ blockId: 'answer', markdown: 'Saved synthetic result: the treatment did not significantly increase the response (p = 0.12).', evidence: [] }] });
      articleChatState = { ...articleChatState, turns: [turn], loading: false, error: '', operationId: '', activeTurnId: '' };
      const archive = buildCurrentArticleArchive();
      const saved = await persistCurrentArticleArchive();
      return { saved, archive };
    } }))[0].result, { tabId, turnId });
  assert.equal(report.saved.saved.saved, true); await drain();
  report.beforeReload = await inspectPage(); report.durableBefore = await durableEvidence();
  assert.equal(report.beforeReload.turns.length, 1); assert.deepEqual(report.beforeReload.annotations, []);
  assert.equal(report.durableBefore.directory.archive.value.workspace.chat.turns[0].turnId, turnId);
  report.automaticWorkspaceAssets = report.durableBefore.directory.manifests.manifests.flatMap(manifest =>
    manifest.assets.map(asset => asset.path));
  assert.equal(report.automaticWorkspaceAssets.includes('chat/index.json'), false);
  assert.equal(report.automaticWorkspaceAssets.includes('legacy/archive.json'), false);
  check('production archive writer saved one result; automatically created workspace assets remain untouched');

  report.initialPromptDecision = await worker.evaluate(async ({ identity, oldAutoDecision }) => {
    const key = `sciArticleArchivePromptDecision:${identity.documentId}`;
    const prior = (await chrome.storage.session.get(key))[key] || null;
    if (oldAutoDecision) {
      // Explicitly authorized compatibility fixture: a known decision emitted by the old empty auto-restore.
      await chrome.storage.session.set({ [key]: { decision: 'workspace-auto-restored',
        documentId: identity.documentId, canonicalUrl: identity.canonicalUrl, decidedAt: Date.now() - 60000 } });
    }
    return { prior, configured: (await chrome.storage.session.get(key))[key] || null };
  }, { identity, oldAutoDecision });
  assert.equal(report.initialPromptDecision.prior, null);
  assert.equal(report.initialPromptDecision.configured?.decision || null,
    oldAutoDecision ? 'workspace-auto-restored' : null);

  stage('reopen-and-observe-real-popup-preparation');
  await worker.evaluate(() => { __arch009HistoryPhase = 'cold-open'; });
  await page.reload();
  await worker.evaluate(id => SciLLM.ensureContentScriptForActivation(chrome, id), tabId);
  await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
    globalThis.__arch009HistoryTabActions = [];
    // Passive observer of actual popup-to-content restore requests; does not return a response.
    chrome.runtime.onMessage.addListener(message => {
      if (message?.action === 'applyArticleWorkspaceAssets') __arch009HistoryTabActions.push({
        action: message.action, match: message.restore?.match, manifest: message.restore?.manifest,
        assets: (message.restore?.assets || []).map(asset => ({ path: asset.relativePath,
          revision: asset.revision, contentHash: asset.contentHash,
          contentRevision: asset.content?.revision,
          turnCount: asset.content?.turns?.length }))
      });
      if (message?.action === 'applyArticleArchiveSnapshot') __arch009HistoryTabActions.push({
        action: message.action, documentId: message.archive?.documentId,
        documentHash: message.archive?.documentHash, turnCount: message.archive?.workspace?.chat?.turns?.length
      });
      return false;
    });
  } }), tabId);
  await observeCommittedFailure(extensionId);
  await bindActualPanel(extensionId);
  report.coldPage = await inspectPage(); report.coldPanel = await panelEvidence();
  report.coldRpc = await worker.evaluate(() => __arch009HistoryRpc.filter(item => item.phase === 'cold-open'));
  assert.equal(report.coldPage.documentId, identity.documentId);
  assert.equal(report.coldPage.documentHash, identity.documentHash);
  await panel.screenshot({ path: path.join(output, 'cold-history-panel.png') }); report.screenshots.push('cold-history-panel.png');
  report.historyCardVisible = await panel.locator('#loadArticleArchive').isVisible();
  if (report.historyCardVisible) {
    stage('click-the-visible-history-card');
    await worker.evaluate(() => { __arch009HistoryPhase = 'card-click'; });
    await panel.locator('#loadArticleArchive').click(); report.historyCardClicked = true;
    await waitForPreparationToSettle();
    report.cardClickRpc = await worker.evaluate(() => __arch009HistoryRpc.filter(item => item.phase === 'card-click'));
    check('real history-card load button was visible and clicked');
  } else {
    report.uncovered = 'History-card button was not visible; neither the prompt guard nor its probe/load behavior was replaced. No menu fallback was used.';
  }
  report.afterPreparation = await inspectPage(); report.finalPanel = await panelEvidence();
  report.durableAfter = await durableEvidence();
  assert.ok(report.afterPreparation.turns.some(turn => turn.turnId === turnId), 'SAVED_RESULT_NOT_RESTORED');
  assert.deepEqual(report.afterPreparation.turns.find(turn => turn.turnId === turnId).answerBlocks.map(block => block.markdown),
    report.saved.archive.workspace.chat.turns[0].answerBlocks.map(block => block.markdown));
  assert.deepEqual(report.afterPreparation.annotations, []);
  assert.equal(report.afterPreparation.documentHash, identity.documentHash);
  await panel.locator('#workspace-tab-chat').click();
  assert.equal(await panel.locator(`#articleChatMessages > article[data-turn-id="${turnId}"]`).isVisible(), true);
  report.finalPanel = await panelEvidence(); report.durableAfter = await durableEvidence();
  assert.equal(report.durableAfter.directory.archive.value.workspace.chat.turns[0].turnId, turnId);
  if (report.historyCardClicked) {
    assert.ok(report.cardClickRpc.some(item => item.type === 'ARTICLE_ARCHIVE_COMMIT_RESTORE'),
      `ARCHIVE_BACKGROUND_COMMIT_NOT_OBSERVED: ${JSON.stringify(report.finalPanel.notifications)}`);
    assert.equal(report.finalPanel.archivePromptDecision?.decision, 'loaded', 'ARCHIVE_LOAD_NOT_COMPLETED');
    assert.equal(report.finalPanel.notifications.some(item => item.type === 'error'), false, 'ARCHIVE_LOAD_REPORTED_ERROR');
  }
  check(report.historyCardClicked ? 'history-card click restored the saved result with correct document identity'
    : 'real automatic preparation restored the legacy saved result while the history card remained hidden');
  await panel.screenshot({ path: path.join(output, 'restored-history-chat.png') }); report.screenshots.push('restored-history-chat.png');

  stage('ordinary-save-and-second-reopen');
  await worker.evaluate(() => { __arch009HistoryPhase = 'ordinary-save'; });
  await panel.locator('#saveCurrentArticleWorkspace').click();
  await waitForPreparationToSettle(); await drain();
  report.ordinarySavePanel = await panelEvidence(); report.ordinarySaveDurable = await durableEvidence();
  assert.equal(report.ordinarySavePanel.notifications.some(item => item.type === 'error'), false);
  assert.equal(report.ordinarySaveDurable.directory.chat.value.data.turns[0].turnId, turnId);
  assert.deepEqual(report.ordinarySaveDurable.directory.chat.value.data.turns[0].answerBlocks.map(block => block.markdown),
    report.saved.archive.workspace.chat.turns[0].answerBlocks.map(block => block.markdown));
  check('real ordinary save persists the restored answer to the modern directory chat asset');
  await panel.close(); panel = null;
  await worker.evaluate(() => { __arch009HistoryPhase = 'saved-reopen'; });
  await page.reload();
  await worker.evaluate(id => SciLLM.ensureContentScriptForActivation(chrome, id), tabId);
  await bindActualPanel(extensionId);
  await panel.locator('#workspace-tab-chat').click();
  assert.equal(await panel.locator(`#articleChatMessages > article[data-turn-id="${turnId}"]`).isVisible(), true);
  report.savedReopenPage = await inspectPage(); report.savedReopenPanel = await panelEvidence();
  report.savedReopenDurable = await durableEvidence();
  assert.equal(report.savedReopenPage.documentId, identity.documentId);
  assert.equal(report.savedReopenPage.documentHash, identity.documentHash);
  assert.deepEqual(report.savedReopenPage.turns.find(turn => turn.turnId === turnId).answerBlocks.map(block => block.markdown),
    report.saved.archive.workspace.chat.turns[0].answerBlocks.map(block => block.markdown));
  assert.equal(report.savedReopenPanel.notifications.some(item => item.type === 'error'), false);
  report.savedReopenRpc = await worker.evaluate(() => __arch009HistoryRpc.filter(item => item.phase === 'saved-reopen'));
  check('after ordinary save, a second real reopen displays the same answer and identity');
  await panel.screenshot({ path: path.join(output, 'saved-reopened-chat.png') }); report.screenshots.push('saved-reopened-chat.png');
  assert.deepEqual(report.pageErrors, []); check('no page errors or API calls');
  report.status = report.historyCardClicked ? 'PASS_CARD_CLICK' : 'OBSERVED_AUTO_RESTORE_CARD_UNEXERCISED';
} catch (error) {
  report.failure = String(error.stack || error); console.error(report.failure);
  if (panel) {
    report.failedPanel = await panelEvidence().catch(() => null);
    await panel.screenshot({ path: path.join(output, 'failed-panel.png') }).catch(() => null);
    report.screenshots.push('failed-panel.png');
  }
  if (worker && tabId) report.failedPage = await inspectPage().catch(() => null);
} finally {
  if (worker) report.runtime = await worker.evaluate(() => __arch009HistoryRpc || []).catch(() => []);
  for (const file of sourceFiles) report.endSourceHashes[file] = sha(fs.readFileSync(path.join(root, file)));
  if (JSON.stringify(report.sourceHashes) !== JSON.stringify(report.endSourceHashes)) {
    report.status = 'FAIL'; report.sourceChanged = true;
  }
  await context?.close(); report.completedAt = new Date().toISOString(); report.runDirectory = output;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (path.dirname(path.resolve(temporary)) === path.resolve(os.tmpdir()) &&
      /^brevess-arch009-history-card-/u.test(path.basename(temporary))) fs.rmSync(temporary, { recursive: true, force: true });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length,
    historyCardClicked: report.historyCardClicked, report: path.join(output, 'report.json'), failure: report.failure || null }));
  process.exitCode = report.status === 'FAIL' ? 1 : 0;
}
