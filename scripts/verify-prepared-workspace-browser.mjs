// ARCH-009: real isolated extension content -> background router -> IndexedDB.
// No user profile, provider, or selected filesystem directory is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'output/playwright/r16-feedback-arch009-prepared');
fs.mkdirSync(out, { recursive: true });
const run = fs.mkdtempSync(path.join(out, 'run-'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-prepared-'));
const extension = path.join(temporary, 'extension'); fs.mkdirSync(extension);
for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
for (const file of fs.readdirSync(root)) if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') fs.copyFileSync(path.join(root, file), path.join(extension, file));
fs.writeFileSync(path.join(extension, 'prepared-driver.html'), '<!doctype html><html><meta charset="utf-8"><title>Isolated restore verifier</title><body>ARCH-009 isolated restore verifier</body></html>');
const hashes = ['content.js', 'background.js', 'core/background-router.js', 'core/article-workspace-store.js', 'core/document-store.js', 'core/manual-annotations.js', 'core/directory-sync.js'];
const report = { status: 'FAIL', startedAt: new Date().toISOString(), checks: [], stages: [], errors: [],
  sourceHashes: Object.fromEntries(hashes.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(extension, file))).digest('hex')])),
  personalDataAccessed: false, realModelCalls: 0, directoryAdapter: 'none',
  scope: 'Real isolated production content and chrome sender, background router, native IndexedDB; synthetic paper and extension-origin OPFS only; no user FSA picker or model quality claim' };
let context, worker, driver;
const stage = name => { report.stages.push({ name, at: new Date().toISOString() }); console.log(name); };
const check = (name, data = {}) => { report.checks.push({ name, ...data }); };
async function tabMessage(tabId, message) { return driver.evaluate(({ tabId, message }) => chrome.tabs.sendMessage(tabId, message), { tabId, message }); }
async function runtimeMessage(message) { return driver.evaluate(value => chrome.runtime.sendMessage(value), message); }
async function content(tabId, action, payload = null) {
  return worker.evaluate(async ({ tabId, action, payload }) => {
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: async (action, payload) => {
      if (action === 'initialize') {
        await prepareManualDocument({ force: true, throwOnError: true });
        await ensureCurrentArticleWorkspace({ forceRefresh: true });
        const p = getCanonicalArticleSnapshot({ forceRefresh: true }).paragraphs[0];
        if (!p) throw Error('SYNTHETIC_PARAGRAPH_MISSING');
        await updateArticleParagraphNote({ paragraphId: p.paragraphId, sourceKey: p.sourceKey, note: '扫描前已保存人工备注' });
        await saveCurrentArticleWorkspaceNow();
        globalThis.preparedBrowserPage = { applies: 0, paragraphId: p.paragraphId };
        const original = applyArticleWorkspaceAssetsUnsafe;
        applyArticleWorkspaceAssetsUnsafe = function (...args) {
          preparedBrowserPage.applies += 1;
          return original(...args);
        };
        return { documentId: currentManualDocument?.documentId, paragraphId: p.paragraphId };
      }
      if (action === 'state') return { baseline: captureArticleWorkspaceRestoreManualBaseline(),
        pending: readArticleWorkspaceRestoreManualState().pending,
        figureDirty: figureWorkspaceDraftDirty,
        controllerPending: figureWorkspaceDraftController?.restorePendingOperations,
        notes: [...articleParagraphNotes.values()], applies: preparedBrowserPage.applies,
        documentId: currentManualDocument?.documentId, workspace: currentArticleWorkspace,
        manualRecord: currentManualDocument?.record,
        marks: [...document.querySelectorAll('.sci-manual-highlight')].map(mark => ({
          annotationId: mark.dataset.annotationId, text: mark.textContent, label: mark.getAttribute('aria-label')
        })) };
      if (action === 'seed-annotation') {
        const block = currentManualBlocks.find(block => manualReadableText(block.element).includes('The measured response'));
        if (!block) throw Error('SYNTHETIC_ANNOTATION_BLOCK_MISSING');
        const text = manualReadableText(block.element);
        const quote = 'The measured response showed no significant increase in the treated condition (p = 0.12)';
        const start = text.indexOf(quote);
        if (start < 0) throw Error('SYNTHETIC_ANNOTATION_QUOTE_MISSING');
        const annotation = buildAutomaticAnnotation(block, start, start + quote.length, {
          categoryId: 'result', sourceType: 'manual'
        });
        annotation.note = '原始人工注释：p = 0.12，未增加；保存后不得清空';
        const saved = await saveManualAnnotation(annotation);
        await saveCurrentArticleWorkspaceNow();
        if (!saved?.annotationId) throw Error('SYNTHETIC_ANNOTATION_NOT_SAVED');
        // Only remove the rendered marks through the production DOM helper.
        // Records and persisted assets remain untouched, so apply must render
        // the newly committed document instead of merely retaining an old mark.
        clearManualHighlightMarks();
        return saved;
      }
      if (action === 'save-real-workspace') return saveCurrentArticleWorkspaceNow();
      if (action === 'force-highlights-checkpoint') {
        try {
          const saved = await persistWorkspaceAssetCheckpoint('annotations/highlights.json', {
            activeEngine: '', lastRegexRequest: lastRegexHighlightRequest,
            annotations: structuredClone(currentManualDocument?.record?.annotations || []),
            highlightDistribution: []
          }, { force: true });
          return { success: true, saved };
        } catch (error) { return { success: false, code: error.code, error: error.message }; }
      }
      if (action === 'build-legacy-archive') {
        try { return { success: true, archive: buildCurrentArticleArchive() }; }
        catch (error) { return { success: false, code: error.code, error: error.message }; }
      }
      if (action === 'discard-synthetic-draft-and-reprepare') {
        const editor = document.getElementById('sci-highlight-context-popover');
        if (editor?.dataset.preparedBrowserFixture !== 'true') throw Error('NOT_A_SYNTHETIC_DRAFT');
        // This is an explicit test-only discard. Never remove arbitrary editors
        // or use it as a production recovery/auto-save step.
        editor.remove();
        await prepareManualDocument({ force: true, throwOnError: true });
        return structuredClone(currentManualDocument?.record);
      }
      if (action === 'edit-dom') {
        const box = document.createElement('section'); box.id = 'sci-highlight-context-popover';
        box.dataset.preparedBrowserFixture = 'true';
        const textarea = document.createElement('textarea'); textarea.value = payload; textarea.rows = 4; textarea.cols = 70;
        box.appendChild(textarea); document.body.appendChild(box); textarea.focus();
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: payload }));
        return textarea.value;
      }
      if (action === 'read-dom') return document.querySelector('#sci-highlight-context-popover textarea')?.value || '';
      if (action === 'prepared-direct') return chrome.runtime.sendMessage(payload);
      throw Error(`Unknown content operation: ${action}`);
    }, args: [action, payload] });
    return results[0]?.result;
  }, { tabId, action, payload });
}
async function freshPaper(name) {
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  const url = `https://example.org/arch009-prepared-${name}`;
  await page.goto(url);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, url);
  assert.ok(Number.isInteger(tabId), 'real browser tab id');
  await worker.evaluate(async tabId => SciLLM.ensureContentScriptForActivation(chrome, tabId), tabId);
  const init = await content(tabId, 'initialize');
  const state = await readyPage(tabId);
  return { page, tabId, init, state, url };
}
async function readyPage(tabId) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = await content(tabId, 'state');
    if (!state.baseline.blocked) return state;
    if (attempt === 39) throw Error(`MANUAL_BASELINE_NOT_READY:${JSON.stringify(state)}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
async function durableDocument(identity) {
  return worker.evaluate(async identity => ({
    baseline: await articleWorkspaceStore.captureRestoreBaseline(identity.workspaceId, { documentId: identity.documentId }),
    record: await documentStore.getDocument(identity.documentId),
    highlights: await articleWorkspaceStore.getAsset(identity.workspaceId, 'annotations/highlights.json')
  }), identity);
}
async function scan(paper) {
  const flushed = await worker.evaluate(() => directorySync.flush());
  assert.equal(flushed.permission, 'granted', JSON.stringify(flushed));
  const ensured = await tabMessage(paper.tabId, { action: 'ensureArticleWorkspace', forceRefresh: true });
  assert.equal(ensured.success, true, JSON.stringify(ensured));
  const identity = { ...ensured.workspace, documentId: ensured.archiveIdentity.documentId };
  const response = await runtimeMessage({ type: 'ARTICLE_WORKSPACE_SCAN_RESTORE', identity,
    operationNonce: ensured.restoreAuthorization.token, requestPermission: false });
  assert.equal(response.success, true, JSON.stringify(response));
  assert.ok(response.data.restore?.restorePlanId, JSON.stringify(response));
  const restore = response.data.restore;
  const restoreTarget = { authorizationToken: ensured.restoreAuthorization.token,
    current: ensured.restoreAuthorization.identity, documentId: identity.documentId,
    manifest: restore.manifest, allowContentChanged: restore.match === 'content-changed' };
  return { ensured, identity, restore, restoreTarget };
}
async function apply(paper, scanned) {
  return tabMessage(paper.tabId, { action: 'applyArticleWorkspaceAssets', restore: { ...scanned.restore, restoreTarget: scanned.restoreTarget } });
}
try {
  stage('launch-isolated-edge');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'msedge', headless: true,
    viewport: { width: 920, height: 780 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  await context.route(/^https?:\/\//u, route => {
    const url = route.request().url();
    if (!/^https:\/\/example\.org\/arch009-prepared-[a-z]+$/u.test(url)) return route.abort('blockedbyclient');
    const paragraphs = Array.from({ length: 8 }, (_, i) => `<p>Experiment ${i + 1} tested the response of cortical neurons to a controlled stimulus. The measured response showed no significant increase in the treated condition (p = 0.12), while the positive control increased 2.4-fold. We retained all independent observations and compared the prespecified intervals with the matched baseline. These synthetic findings are included only to verify article recovery and annotation behavior in an isolated browser.</p>`).join('');
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="canonical" href="${url}"><meta name="citation_title" content="Synthetic cortical response study"><title>Synthetic cortical response study</title></head><body><main><article><h1>Synthetic cortical response study</h1><h2>Results</h2>${paragraphs}</article></main></body></html>` });
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  driver = await context.newPage(); await driver.goto(`chrome-extension://${new URL(worker.url()).host}/prepared-driver.html`);
  stage('configure-real-opfs-handle');
  report.opfs = await worker.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    const handle = await opfs.getDirectoryHandle('arch009-prepared-fixture', { create: true });
    await SciLLM.createIndexedDbDirectoryHandleStore(indexedDB).save(handle);
    const reloaded = await SciLLM.createIndexedDbDirectoryHandleStore(indexedDB).load();
    return { kind: reloaded.kind, name: reloaded.name, queryPermission: typeof reloaded.queryPermission,
      permission: typeof reloaded.queryPermission === 'function' ? await reloaded.queryPermission({ mode: 'readwrite' }) : null,
      status: await directorySync.status() };
  });
  assert.equal(report.opfs.status.permission, 'granted', JSON.stringify(report.opfs));
  report.directoryAdapter = 'native-extension-origin-OPFS';
  await worker.evaluate(() => {
    globalThis.preparedBrowserTransport = { calls: [], hold: false, reached: false, release: null };
    const original = llmRouter.handle.bind(llmRouter);
    llmRouter.handle = async (message, context) => {
      const response = await original(message, context);
      if (message.type === 'ARTICLE_WORKSPACE_COMMIT_PREPARED_RESTORE') {
        preparedBrowserTransport.calls.push({ messageType: message.type, success: response.success,
          code: response.error?.code, senderTabId: context.senderTabId, senderFrameId: context.senderFrameId,
          senderDocumentId: context.senderDocumentId, senderUrl: context.senderUrl,
          trustedContentScript: context.trustedContentScript, persistenceCommitted: response.data?.persistenceCommitted,
          committedDocument: response.data?.document ? {
            documentId: response.data.document.documentId, revision: response.data.document.revision,
            annotations: response.data.document.annotations
          } : null });
        if (preparedBrowserTransport.hold) { preparedBrowserTransport.reached = true;
          await new Promise(resolve => { preparedBrowserTransport.release = resolve; }); }
      }
      return response;
    };
  });
  stage('normal-same-copy');
  const normal = await freshPaper('normal'); const normalScan = await scan(normal);
  const normalResult = await apply(normal, normalScan); report.normalResult = normalResult;
  assert.equal(normalResult.success, true, JSON.stringify(normalResult)); assert.equal(normalResult.persistenceCommitted, true);
  const normalState = await content(normal.tabId, 'state'); assert.equal(normalState.applies, 1);
  assert.equal(normalState.notes[0].note, '扫描前已保存人工备注');
  check('normal same-copy restore uses real sender, native directory scan and atomic IDB commit before one page apply');
  const actualFrame = await worker.evaluate(tabId => chrome.webNavigation.getFrame({ tabId, frameId: 0 }), normal.tabId);
  const calls = await worker.evaluate(() => preparedBrowserTransport.calls); const trusted = calls.at(-1);
  assert.equal(trusted.trustedContentScript, true); assert.equal(trusted.senderTabId, normal.tabId);
  assert.equal(trusted.senderDocumentId, actualFrame.documentId); assert.equal(trusted.senderUrl, normal.url);
  check('trusted prepared sender uses the actual browser tab/frame/document id', { sender: trusted, browserDocumentId: actualFrame.documentId });
  stage('after-scan-asset-write');
  const late = await freshPaper('late'); const lateScan = await scan(late);
  const afterLate = await worker.evaluate(async identity => {
    await articleWorkspaceStore.putAsset(identity.workspaceId, 'annotations/paragraph-notes.json', { schemaVersion: 1, notes: [{ paragraphId: 'late', note: '后台扫描后人工新值' }] });
    return articleWorkspaceStore.captureRestoreBaseline(identity.workspaceId);
  }, lateScan.identity);
  const lateResult = await apply(late, lateScan); report.lateResult = lateResult;
  assert.equal(lateResult.success, false); assert.equal(lateResult.code, 'WORKSPACE_RESTORE_CONFLICT', JSON.stringify(lateResult));
  assert.equal((await content(late.tabId, 'state')).applies, 0);
  assert.deepEqual(await worker.evaluate(id => articleWorkspaceStore.captureRestoreBaseline(id), lateScan.identity.workspaceId), afterLate);
  check('asset written after real scan rejects before page apply and performs zero restore writes');
  stage('manual-dom-edit-while-commit-response-held');
  const editing = await freshPaper('editing'); const editingScan = await scan(editing);
  await worker.evaluate(() => { preparedBrowserTransport.hold = true; preparedBrowserTransport.reached = false; });
  const pendingApply = apply(editing, editingScan);
  for (let i = 0; i < 100 && !(await worker.evaluate(() => preparedBrowserTransport.reached)); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await worker.evaluate(() => preparedBrowserTransport.reached), true, 'actual durable response reached the delay hook');
  await content(editing.tabId, 'edit-dom', '');
  await editing.page.locator('#sci-highlight-context-popover textarea').fill('数据库提交等待期间的未保存科学备注：p = 0.001，不升高');
  await worker.evaluate(() => { preparedBrowserTransport.hold = false; preparedBrowserTransport.release(); });
  const editingResult = await pendingApply; report.editingResult = editingResult;
  assert.equal(editingResult.success, false); assert.equal(editingResult.persistenceCommitted, true); assert.equal(editingResult.workspaceApplied, false);
  assert.equal((await content(editing.tabId, 'state')).applies, 0);
  assert.equal(await content(editing.tabId, 'read-dom'), '数据库提交等待期间的未保存科学备注：p = 0.001，不升高');
  await editing.page.locator('#sci-highlight-context-popover textarea').scrollIntoViewIfNeeded();
  await editing.page.screenshot({ path: path.join(run, 'manual-draft-preserved.png'), fullPage: false });
  check('native durable commit followed by a real textarea edit preserves the DOM draft and reports page rejection');
  stage('rejected-page-cannot-force-save-old-manual-record');
  const protectedBefore = await durableDocument(editingScan.identity);
  const blockedHighlights = await content(editing.tabId, 'force-highlights-checkpoint');
  report.blockedHighlights = blockedHighlights;
  assert.equal(blockedHighlights.success, false);
  assert.equal(blockedHighlights.code, 'ARTICLE_WORKSPACE_RESTORE_DOCUMENT_PENDING', JSON.stringify(blockedHighlights));
  const blockedLegacy = await content(editing.tabId, 'build-legacy-archive');
  assert.equal(blockedLegacy.success, false);
  assert.equal(blockedLegacy.code, 'ARTICLE_WORKSPACE_RESTORE_DOCUMENT_PENDING', JSON.stringify(blockedLegacy));
  assert.deepEqual(await durableDocument(editingScan.identity), protectedBefore,
    'force-save and legacy-build rejections preserve the real durable record and every captured asset');
  assert.equal(await content(editing.tabId, 'read-dom'), '数据库提交等待期间的未保存科学备注：p = 0.001，不升高');
  check('page rejection retains a guard that blocks subsequent forced highlights and legacy archive saves without destroying the draft');
  stage('explicit-test-draft-discard-then-authoritative-reprepare');
  const reloadedRecord = await content(editing.tabId, 'discard-synthetic-draft-and-reprepare');
  assert.equal(reloadedRecord.documentId, protectedBefore.record.documentId);
  assert.ok(reloadedRecord.revision >= protectedBefore.record.revision);
  assert.deepEqual(reloadedRecord.annotations, protectedBefore.record.annotations);
  const resumedSave = await content(editing.tabId, 'force-highlights-checkpoint');
  assert.equal(resumedSave.success, true, JSON.stringify(resumedSave));
  assert.equal(resumedSave.saved?.saved, true, JSON.stringify(resumedSave));
  await content(editing.tabId, 'save-real-workspace');
  const resumedDurable = await durableDocument(editingScan.identity);
  assert.deepEqual(resumedDurable.record.annotations, protectedBefore.record.annotations);
  assert.deepEqual(resumedDurable.highlights.content.annotations, protectedBefore.record.annotations);
  check('explicitly discarding only the synthetic draft and rereading the real document restores normal force/full-workspace saving');
  stage('reject-untrusted-and-reloaded-document-replay');
  const priorBinding = { kind: 'workspace', operationNonce: normalScan.restoreTarget.authorizationToken,
    current: normalScan.restoreTarget.current, documentId: normalScan.identity.documentId,
    manifest: normalScan.restore.manifest, match: normalScan.restore.match,
    allowContentChanged: normalScan.restoreTarget.allowContentChanged };
  const replay = { type: 'ARTICLE_WORKSPACE_COMMIT_PREPARED_RESTORE', planId: normalScan.restore.restorePlanId, binding: priorBinding };
  const beforeUntrusted = await worker.evaluate(id => articleWorkspaceStore.captureRestoreBaseline(id), normalScan.identity.workspaceId);
  const untrusted = await runtimeMessage(replay);
  assert.equal(untrusted.success, false, JSON.stringify(untrusted));
  assert.deepEqual(await worker.evaluate(id => articleWorkspaceStore.captureRestoreBaseline(id), normalScan.identity.workspaceId), beforeUntrusted);
  check('extension-page sender cannot replay a content-only prepared capability', { code: untrusted.error?.code });
  await normal.page.reload();
  await worker.evaluate(async tabId => SciLLM.ensureContentScriptForActivation(chrome, tabId), normal.tabId);
  const newFrame = await worker.evaluate(tabId => chrome.webNavigation.getFrame({ tabId, frameId: 0 }), normal.tabId);
  assert.notEqual(newFrame.documentId, actualFrame.documentId, 'same URL reload gets a new browser document');
  const beforeReplay = await worker.evaluate(id => articleWorkspaceStore.captureRestoreBaseline(id), normalScan.identity.workspaceId);
  const reloaded = await content(normal.tabId, 'prepared-direct', replay);
  assert.equal(reloaded.success, false, JSON.stringify(reloaded));
  assert.deepEqual(await worker.evaluate(id => articleWorkspaceStore.captureRestoreBaseline(id), normalScan.identity.workspaceId), beforeReplay);
  check('same-tab same-URL new browser document cannot replay the old committed plan', {
    oldDocumentId: actualFrame.documentId, newDocumentId: newFrame.documentId, code: reloaded.error?.code });
  stage('nonempty-document-annotation-restore-and-next-real-save');
  const annotated = await freshPaper('annotated');
  const annotation = await content(annotated.tabId, 'seed-annotation');
  const annotationBefore = await readyPage(annotated.tabId);
  assert.equal(annotationBefore.marks.length, 0, 'production clear helper removed only old rendered marks');
  const annotatedScan = await scan(annotated);
  const durableBefore = await durableDocument(annotatedScan.identity);
  assert.equal(durableBefore.record.annotations.length, 1);
  assert.deepEqual(durableBefore.record.annotations, durableBefore.highlights.content.annotations,
    'the actual documents row and actual highlights checkpoint must agree before scanning');
  const annotatedResult = await apply(annotated, annotatedScan); report.annotatedResult = annotatedResult;
  assert.equal(annotatedResult.success, true, JSON.stringify(annotatedResult));
  assert.equal(annotatedResult.persistenceCommitted, true); assert.equal(annotatedResult.workspaceApplied, true);
  const durableAfter = await durableDocument(annotatedScan.identity);
  const annotatedPage = await content(annotated.tabId, 'state');
  assert.ok(durableAfter.record.revision > durableBefore.record.revision, 'real document record was part of the atomic restore');
  assert.deepEqual(durableAfter.record.annotations, durableAfter.highlights.content.annotations);
  assert.deepEqual(annotatedPage.manualRecord, durableAfter.record, 'page adopts the actual committed document checkpoint');
  assert.equal(annotatedPage.applies, 1);
  const restoredMark = annotatedPage.marks.find(mark => mark.annotationId === annotation.annotationId);
  assert.ok(restoredMark, 'nonempty saved annotation is rendered after apply');
  assert.equal(restoredMark.text, annotation.quote);
  assert.equal(await annotated.page.locator('.sci-manual-highlight').count(), 1);
  check('nonempty legal annotations commit with workspace assets and synchronously render the actual committed document', {
    documentId: annotatedScan.identity.documentId, oldRevision: durableBefore.record.revision,
    newRevision: durableAfter.record.revision, annotationId: annotation.annotationId, restoredText: restoredMark.text
  });
  await content(annotated.tabId, 'save-real-workspace');
  await readyPage(annotated.tabId);
  const afterRealSave = await durableDocument(annotatedScan.identity);
  assert.deepEqual(afterRealSave.record.annotations, durableAfter.record.annotations);
  assert.deepEqual(afterRealSave.highlights.content.annotations, durableAfter.record.annotations,
    'later production save must not replace restored highlights with an empty record');
  const mirrored = await worker.evaluate(async identity => {
    const sync = await directorySync.flush();
    return { sync, disk: await directorySync.readWorkspaceAsset(identity, 'annotations/highlights.json') };
  }, annotatedScan.identity);
  assert.equal(mirrored.sync.permission, 'granted');
  assert.equal(mirrored.disk.found, true, JSON.stringify(mirrored.disk));
  const diskAnnotations = mirrored.disk.value?.data?.annotations;
  assert.deepEqual(diskAnnotations, durableAfter.record.annotations, JSON.stringify(mirrored.disk));
  await annotated.page.locator('.sci-manual-highlight').screenshot({ path: path.join(run, 'restored-manual-mark.png') });
  check('a later real workspace save and native OPFS flush retain every restored manual annotation');
  stage('document-only-manual-write-after-scan');
  const documentLate = await freshPaper('documentlate');
  const lateAnnotation = await content(documentLate.tabId, 'seed-annotation');
  await readyPage(documentLate.tabId);
  const documentScan = await scan(documentLate);
  const preEditLegacy = await content(documentLate.tabId, 'build-legacy-archive');
  assert.equal(preEditLegacy.success, true, JSON.stringify(preEditLegacy));
  const documentWritten = await worker.evaluate(async ({ identity, annotation }) => {
    const before = await articleWorkspaceStore.captureRestoreBaseline(identity.workspaceId, { documentId: identity.documentId });
    await documentStore.upsertAnnotation(identity.documentId, { ...annotation, note: '扫描后仅document人工修改:不能被目录旧值覆盖' });
    const after = await articleWorkspaceStore.captureRestoreBaseline(identity.workspaceId, { documentId: identity.documentId });
    return { before, after };
  }, { identity: documentScan.identity, annotation: lateAnnotation });
  assert.deepEqual(documentWritten.after.assets, documentWritten.before.assets, 'race changes documents only');
  assert.deepEqual(documentWritten.after.turns, documentWritten.before.turns);
  assert.notDeepEqual(documentWritten.after.document, documentWritten.before.document);
  const documentLateResult = await apply(documentLate, documentScan); report.documentLateResult = documentLateResult;
  assert.equal(documentLateResult.success, false); assert.equal(documentLateResult.code, 'WORKSPACE_RESTORE_CONFLICT', JSON.stringify(documentLateResult));
  assert.equal((await content(documentLate.tabId, 'state')).applies, 0);
  const afterDocumentRejection = await durableDocument(documentScan.identity);
  assert.deepEqual(afterDocumentRejection.baseline, documentWritten.after, 'failed restore writes neither document nor any workspace asset/turn');
  assert.equal(afterDocumentRejection.record.annotations[0].note, '扫描后仅document人工修改:不能被目录旧值覆盖');
  check('a documents-only manual edit after scan atomically rejects all restore writes before any page apply');
  stage('background-rejects-pre-captured-stale-legacy-snapshot');
  const legacyDiskBefore = await worker.evaluate(async archive => {
    await directorySync.flush();
    return directorySync.readJson(SciLLM.articleArchiveRelativePath(archive));
  }, preEditLegacy.archive);
  const rejectedLegacy = await runtimeMessage({ type: 'ARTICLE_ARCHIVE_SAVE', archive: preEditLegacy.archive });
  report.rejectedLegacy = rejectedLegacy;
  assert.equal(rejectedLegacy.success, false, JSON.stringify(rejectedLegacy));
  assert.equal(rejectedLegacy.error?.code, 'ARTICLE_ARCHIVE_DOCUMENT_CONFLICT');
  const legacyDiskAfter = await worker.evaluate(async archive => {
    await directorySync.flush();
    return directorySync.readJson(SciLLM.articleArchiveRelativePath(archive));
  }, preEditLegacy.archive);
  assert.deepEqual(legacyDiskAfter, legacyDiskBefore, 'the rejected stale legacy snapshot is never enqueued or written to native OPFS');
  assert.deepEqual((await durableDocument(documentScan.identity)).baseline, documentWritten.after);
  check('actual extension-origin ARTICLE_ARCHIVE_SAVE rejects an earlier snapshot whose annotations conflict with the current document');
  report.status = 'PASS';
} catch (error) { report.failure = String(error.stack || error); process.exitCode = 1; }
finally {
  await context?.close(); report.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, 'latest-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, report: path.join(run, 'report.json'), failure: report.failure || null }));
}
