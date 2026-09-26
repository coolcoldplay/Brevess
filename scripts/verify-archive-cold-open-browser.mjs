// ARCH-009 one cold-open scenario: actual popup preparation, then real visible restore control.
// Uses an isolated profile and synthetic article; production handlers/storage are not replaced.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const outputRoot = path.join(root, 'output/playwright/arch009-cold-open');
fs.mkdirSync(outputRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(outputRoot, 'run-'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-arch009-cold-open-'));
const extension = path.join(temporary, 'extension');
const url = 'https://example.org/arch009-cold-open';
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceFiles = ['manifest.json', 'background.js', 'content.js', 'popup.js', 'popup.html',
  'core/article-extractor.js', 'core/article-workspace.js', 'core/article-workspace-store.js',
  'core/article-workspace-save.js', 'core/background-router.js', 'core/document-store.js',
  'core/manual-annotations.js', 'core/directory-sync.js', 'core/tab-messenger.js',
  'core/tab-activation.js', 'core/user-data-database.js', 'core/highlight-presentation.js'];
const report = { status: 'FAIL', startedAt: new Date().toISOString(), stages: [], checks: [],
  sourceHashes: {}, endSourceHashes: {}, screenshots: [], pageErrors: [], remoteRequestsBlocked: 0,
  realApiCalls: 0, personalDataAccessed: false,
  boundary: 'One synthetic HTML article in an isolated Edge profile with native IndexedDB and extension-origin OPFS. Fixture first uses real directory restore and normal save; after reload only real popup initialize/activate runs until observation, then a visible restore control is clicked. No result-gate, load handler, storage query or receipt replacement. Runtime listener is passive.' };
let context, worker, driver, page, panel, tabId, identity, fixture;
const stage = name => { report.stages.push({ name, at: new Date().toISOString() }); console.log(name); };
const check = (name, details = null) => { report.checks.push({ name, pass: true, details }); console.log(`PASS ${name}`); };
const rpc = message => driver.evaluate(message => chrome.runtime.sendMessage(message), message);
const message = payload => driver.evaluate(({ tabId, payload }) => chrome.tabs.sendMessage(tabId, payload), { tabId, payload });
async function inspectPage() {
  return worker.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId }, func: () => ({
    documentId: currentManualDocument?.documentId,
    documentHash: currentManualDocument?.record?.documentHash,
    canonicalUrl: currentManualDocument?.record?.canonicalUrl,
    workspace: currentArticleWorkspace,
    turns: getPublicArticleChatState().turns,
    annotations: currentManualDocument?.record?.annotations || [],
    temporaryMarks: [...document.querySelectorAll('.sci-llm-highlight[data-restored-chat-turn-id]')]
      .map(mark => ({ turnId: mark.dataset.restoredChatTurnId, text: mark.textContent })),
    manualMarks: [...document.querySelectorAll('.sci-manual-highlight')]
      .map(mark => ({ annotationId: mark.dataset.annotationId, text: mark.textContent })),
    noteMarkers: document.querySelectorAll('.sci-manual-note-marker').length,
    baseline: captureArticleWorkspaceRestoreManualBaseline()
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
    workspace: await articleWorkspaceStore.getWorkspace(identity.workspaceId),
    chat: await articleWorkspaceStore.getAsset(identity.workspaceId, 'chat/index.json'),
    directory: { status: await directorySync.status(),
      manifests: await directorySync.listWorkspaceManifests(identity),
      chat: await directorySync.readWorkspaceAsset(identity, 'chat/index.json'),
      highlights: await directorySync.readWorkspaceAsset(identity, 'annotations/highlights.json') }
  }), identity);
}
async function bindActualPanel(extensionId) {
  panel = await context.newPage();
  await panel.setViewportSize({ width: 520, height: 960 });
  await panel.goto(`chrome-extension://${extensionId}/popup.html`);
  await worker.evaluate(id => chrome.tabs.update(id, { active: true }), tabId);
  await page.bringToFront();
  await panel.waitForFunction(() => typeof panelUiReady !== 'undefined' && panelUiReady,
    null, { timeout: 30_000 });
  // Same real initialization binding used by NOTE-007. No snapshots or gates are replaced.
  await panel.evaluate(async () => {
    await synchronizeActiveTabContext({ force: true });
    if (!activePanelTabContext.activated) {
      await activateCurrentTabFromSidePanel();
      await synchronizeActiveTabContext({ force: true });
    }
    await refreshArticleWorkspace({ announce: false, throwOnError: true });
  });
  assert.equal(await panel.evaluate(id => activePanelTabContext.tabId === id &&
    activePanelTabContext.activated === true && Boolean(currentWorkspaceSnapshot?.paragraphs?.length), tabId), true);
}
async function panelEvidence() {
  return panel.evaluate(() => ({
    boundTabId: activePanelTabContext.tabId, activated: activePanelTabContext.activated,
    snapshotDocumentId: currentWorkspaceSnapshot?.documentId,
    totalTurns: currentWorkspaceSnapshot?.chat?.totalTurns || 0,
    visibleChatTurns: [...document.querySelectorAll('#articleChatMessages > article[data-turn-id]')]
      .map(node => ({ turnId: node.dataset.turnId, text: node.textContent,
        visible: node.getClientRects().length > 0 })),
    manualCount: manualAnnotationState?.annotationCount || 0,
    highlights: currentWorkspaceSnapshot?.highlightDistribution?.totalHighlights || 0,
    resultGate: workspaceAlreadyHasArticleResults(currentWorkspaceSnapshot),
    archivePromptHidden: document.getElementById('articleArchivePrompt').hidden,
    archiveProbe: currentArticleArchiveProbe,
    scanControlExists: Boolean(document.getElementById('scanArticleWorkspace')),
    status: document.getElementById('status')?.textContent || '',
    notification: document.getElementById('sidePanelDocumentStatusText')?.textContent || ''
  }));
}
try {
  stage('copy-and-launch');
  fs.mkdirSync(extension);
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales'])
    fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
  for (const file of fs.readdirSync(root)) if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json')
    fs.copyFileSync(path.join(root, file), path.join(extension, file));
  for (const file of sourceFiles) report.sourceHashes[file] = sha(fs.readFileSync(path.join(extension, file)));
  assert.equal(report.sourceHashes['content.js'], '4f336c6f8c668a5f7193f18bcb8ce6fc0fa2e4e7ffc374a33597f95fd8cb36a1');
  assert.equal(report.sourceHashes['core/article-extractor.js'], '585ddefd32b095c943f60f85b9eda952930711a2c368793c276956fc969940cf');
  fs.writeFileSync(path.join(extension, 'arch009-cold-open-driver.html'), '<!doctype html><title>ARCH009 isolated driver</title>');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, viewport: { width: 1160, height: 900 }, reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking']
  });
  context.on('page', target => target.on('pageerror', error => report.pageErrors.push(error.message)));
  await context.route(/^https?:\/\//u, route => {
    if (route.request().url() !== url) { report.remoteRequestsBlocked++; return route.abort('blockedbyclient'); }
    const paragraphs = Array.from({ length: 8 }, (_, index) => `<p>Experiment ${index + 1} tested the response of cortical neurons to a controlled stimulus. The measured response showed no significant increase in the treated condition (p = 0.12), while the positive control increased 2.4-fold. We retained independent observations and compared prespecified intervals with the matched baseline. These synthetic findings verify cold-open recovery without model calls or real user data.</p>`).join('');
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="canonical" href="${url}"><title>ARCH009 synthetic cold-open study</title><style>body{font:18px/1.6 sans-serif;max-width:850px;margin:30px auto}</style></head><body><main><article><h1>ARCH009 synthetic cold-open study</h1><h2>Results</h2>${paragraphs}</article></main></body></html>` });
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    globalThis.fetch = async () => { throw Error('ARCH009_COLD_OPEN_NO_EXTERNAL_API'); };
    globalThis.__arch009ColdPhase = 'fixture'; globalThis.__arch009ColdRpc = [];
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (typeof message?.type === 'string') __arch009ColdRpc.push({
        phase: __arch009ColdPhase, type: message.type, at: Date.now(),
        senderTabId: sender.tab?.id || null, senderFrameId: sender.frameId,
        workspaceId: message.identity?.workspaceId || message.workspaceId || '',
        documentId: message.identity?.documentId || message.documentId || '' });
      return false;
    });
  });
  const extensionId = new URL(worker.url()).host;
  driver = await context.newPage(); await driver.goto(`chrome-extension://${extensionId}/arch009-cold-open-driver.html`);
  report.directorySetup = await worker.evaluate(async () => {
    const handle = await (await navigator.storage.getDirectory()).getDirectoryHandle('arch009-cold-open-fixture', { create: true });
    await SciLLM.createIndexedDbDirectoryHandleStore(indexedDB).save(handle);
    return { kind: handle.kind, name: handle.name, status: await directorySync.status() };
  });
  assert.equal(report.directorySetup.status.permission, 'granted');
  stage('seed-one-real-directory-fixture');
  page = await context.newPage(); await page.goto(url);
  tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, url);
  assert.ok(Number.isSafeInteger(tabId));
  await worker.evaluate(id => SciLLM.ensureContentScriptForActivation(chrome, id), tabId);
  assert.equal((await message({ action: 'getArticleWorkspaceSnapshot' })).success, true);
  const initial = await message({ action: 'ensureArticleWorkspace' }); assert.equal(initial.success, true);
  identity = { ...initial.workspace, ...initial.archiveIdentity };
  assert.equal((await message({ action: 'saveArticleWorkspaceBaseline' })).saved, true);
  fixture = await worker.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId }, func: () => {
    const blocks = currentManualBlocks.filter(block => manualReadableText(block.element).includes('The measured response'));
    const quote = 'The measured response showed no significant increase in the treated condition (p = 0.12)';
    const start = manualReadableText(blocks[1].element).indexOf(quote);
    const annotation = buildAutomaticAnnotation(blocks[1], start, start + quote.length, { categoryId: 'result', sourceType: 'manual' });
    annotation.note = 'Independent manual note retained across a cold open.';
    const turn = publicArticleChatTurn({ turnId: 'arch009-cold-turn', question: 'find the result',
      intent: 'highlight', status: 'completed', answerBlocks: [{ blockId: 'source', markdown: quote,
        evidence: [{ paragraphId: blocks[0].blockId, quote, verificationStatus: 'verified' }] }] });
    return { annotation, turn, chat: { ...getPublicArticleChatState(), turns: [turn], totalTurns: 1, returnedTurns: 1 } };
  } }))[0].result, tabId);
  await drain();
  await worker.evaluate(async ({ identity, fixture }) => {
    const workspace = await articleWorkspaceStore.getWorkspace(identity.workspaceId);
    await directorySync.enqueueWorkspaceAsset(workspace, 'annotations/highlights.json', {
      annotations: [SciLLM.normalizeManualAnnotation(fixture.annotation)] });
    await directorySync.enqueueWorkspaceAsset(workspace, 'chat/index.json', fixture.chat);
  }, { identity, fixture });
  await drain();
  const ensured = await message({ action: 'ensureArticleWorkspace', forceRefresh: true });
  identity = { ...ensured.workspace, ...ensured.archiveIdentity };
  const scanned = await rpc({ type: 'ARTICLE_WORKSPACE_SCAN_RESTORE', identity,
    operationNonce: ensured.restoreAuthorization.token, requestPermission: false,
    ...(ensured.documentCreationToken ? { documentCreationToken: ensured.documentCreationToken } : {}) });
  assert.equal(scanned.success, true); assert.equal(scanned.data.restore.match, 'exact');
  const restoreTarget = { authorizationToken: ensured.restoreAuthorization.token,
    current: ensured.restoreAuthorization.identity, documentId: identity.documentId,
    manifest: scanned.data.restore.manifest, allowContentChanged: false };
  report.initialApply = await message({ action: 'applyArticleWorkspaceAssets',
    restore: { ...scanned.data.restore, restoreTarget } });
  assert.equal(report.initialApply.semanticHighlightsRestored, 1);
  assert.equal(report.initialApply.manualRebuildDeferred, undefined);
  const save = await message({ action: 'saveArticleWorkspaceNow', operationId: 'arch009-cold-open-fixture' });
  assert.equal(save.saveStatus, 'complete', JSON.stringify(save)); await drain();
  report.beforeReload = await inspectPage(); report.durableBefore = await durableEvidence();
  assert.equal(report.beforeReload.turns.length, 1); assert.equal(report.beforeReload.temporaryMarks.length, 1);
  assert.equal(report.beforeReload.manualMarks.length, 1); assert.equal(report.beforeReload.noteMarkers, 1);
  assert.equal(report.durableBefore.directory.chat.value.data.turns.length, 1);
  check('real exact directory restore and ordinary save retain turn-only history and an independent manual note');

  stage('cold-open-through-actual-popup');
  await worker.evaluate(() => { __arch009ColdPhase = 'cold-open'; });
  await page.reload();
  await worker.evaluate(id => SciLLM.ensureContentScriptForActivation(chrome, id), tabId);
  await bindActualPanel(extensionId);
  report.coldPage = await inspectPage(); report.coldPanel = await panelEvidence();
  report.coldDurable = await durableEvidence();
  assert.equal(report.coldPanel.boundTabId, tabId);
  assert.equal(report.coldPage.documentId, identity.documentId);
  assert.equal(report.coldPage.documentHash, identity.documentHash);
  assert.deepEqual(report.coldPage.annotations, report.beforeReload.annotations);
  assert.equal(report.coldPage.manualMarks.length, 1); assert.equal(report.coldPage.noteMarkers, 1);
  assert.equal(report.coldDurable.directory.chat.value.data.turns.length, 1);
  report.coldRpc = await worker.evaluate(() => __arch009ColdRpc.filter(item => item.phase === 'cold-open'));
  check('ordinary cold preparation is bound to the saved document and preserves manual data and saved directory history');
  await panel.screenshot({ path: path.join(output, 'cold-panel.png') }); report.screenshots.push('cold-panel.png');
  await page.screenshot({ path: path.join(output, 'cold-article.png') }); report.screenshots.push('cold-article.png');

  stage('load-via-reachable-ui-control');
  await worker.evaluate(() => { __arch009ColdPhase = 'user-load'; });
  if (await panel.locator('#loadArticleArchive').isVisible()) {
    report.restoreEntry = 'history-card'; await panel.locator('#loadArticleArchive').click();
  } else {
    await panel.locator('#sidePanelMoreToolsSummary').click();
    assert.equal(await panel.locator('#scanArticleWorkspace').isVisible(), true, 'NO_REACHABLE_HISTORY_RESTORE_CONTROL');
    report.restoreEntry = 'more-tools-scan';
    await panel.screenshot({ path: path.join(output, 'reachable-restore-menu.png') });
    report.screenshots.push('reachable-restore-menu.png');
    await panel.locator('#scanArticleWorkspace').click();
  }
  await panel.waitForFunction(() => currentWorkspaceSnapshot?.chat?.turns?.some(turn => turn.turnId === 'arch009-cold-turn'),
    null, { timeout: 20_000 });
  await panel.locator('#workspace-tab-chat').click();
  assert.equal(await panel.locator('#articleChatMessages > article[data-turn-id="arch009-cold-turn"]').isVisible(), true);
  report.afterUserLoad = await inspectPage(); report.loadedPanel = await panelEvidence();
  report.durableAfter = await durableEvidence();
  assert.equal(report.loadedPanel.totalTurns, 1);
  assert.ok(report.loadedPanel.visibleChatTurns.some(turn => turn.turnId === 'arch009-cold-turn' && turn.visible));
  assert.equal(report.afterUserLoad.temporaryMarks.length, 1);
  assert.equal(report.afterUserLoad.temporaryMarks[0].text, fixture.turn.answerBlocks[0].evidence[0].quote);
  assert.deepEqual(report.afterUserLoad.annotations, report.beforeReload.annotations);
  assert.equal(report.afterUserLoad.manualMarks.length, 1); assert.equal(report.afterUserLoad.noteMarkers, 1);
  report.userLoadRpc = await worker.evaluate(() => __arch009ColdRpc.filter(item => item.phase === 'user-load'));
  assert.ok(report.userLoadRpc.some(item => item.type === 'ARTICLE_WORKSPACE_SCAN_RESTORE'));
  assert.ok(report.userLoadRpc.some(item => item.type === 'ARTICLE_WORKSPACE_COMMIT_PREPARED_RESTORE'));
  check('a real reachable restore control loads saved chat and turn-only display without replacing the manual note', { entry: report.restoreEntry });
  await panel.screenshot({ path: path.join(output, 'loaded-panel.png') }); report.screenshots.push('loaded-panel.png');
  await page.screenshot({ path: path.join(output, 'loaded-article.png') }); report.screenshots.push('loaded-article.png');
  assert.deepEqual(report.pageErrors, []); check('no page errors'); report.status = 'PASS';
} catch (error) {
  report.failure = String(error.stack || error); console.error(report.failure);
  if (panel) report.failedPanel = await panelEvidence().catch(() => null);
  if (worker && tabId) report.failedPage = await inspectPage().catch(() => null);
} finally {
  if (worker) report.runtime = await worker.evaluate(() => __arch009ColdRpc || []).catch(() => []);
  for (const file of sourceFiles) report.endSourceHashes[file] = sha(fs.readFileSync(path.join(root, file)));
  if (JSON.stringify(report.sourceHashes) !== JSON.stringify(report.endSourceHashes)) {
    report.status = 'FAIL'; report.sourceChanged = true;
  }
  await context?.close(); report.completedAt = new Date().toISOString(); report.runDirectory = output;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (path.dirname(path.resolve(temporary)) === path.resolve(os.tmpdir()) &&
      /^brevess-arch009-cold-open-/u.test(path.basename(temporary))) fs.rmSync(temporary, { recursive: true, force: true });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, report: path.join(output, 'report.json'), failure: report.failure || null }));
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}
