// ARCH-009 first-created document recovery. Run only after production freeze.
// Real content/runtime/native IDB/native extension-origin OPFS; no fabricated receipt.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'output/playwright/r16-feedback-arch009-first-document');
fs.mkdirSync(out, { recursive: true }); const run = fs.mkdtempSync(path.join(out, 'run-'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-first-doc-'));
const extension = path.join(temporary, 'extension');
const sha = value => createHash('sha256').update(value).digest('hex');
const files = ['background.js', 'content.js', 'popup.js', 'core/background-router.js', 'core/document-store.js',
  'core/article-workspace-store.js', 'core/article-workspace-save.js', 'core/manual-annotations.js',
  'core/directory-sync.js', 'core/tab-messenger.js', 'core/tab-activation.js', 'core/user-data-database.js',
  'core/article-workspace.js', 'core/article-extractor.js'];
const report = { status: 'FAIL', startedAt: new Date().toISOString(), stages: [], checks: [], errors: [],
  screenshots: [], sourceHashes: {}, endSourceHashes: {}, realApiCalls: 0, personalDataAccessed: false,
  boundary: 'Real isolated Edge first DOCUMENT_PREPARE -> ensure -> baseline -> SCAN -> creator prepared commit -> DOM -> later save. Native IndexedDB and extension-origin OPFS. Directory-only annotations are built from actual synthetic DOM anchors and validated by production normalizer. No token/revision fabrication, local asset deletion or query/storage replacement. Runtime observation is pass-through only.' };
let context, worker, driver;
const papers = [];
const stage = name => { console.log(name); report.stages.push({ name, at: new Date().toISOString() }); };
const check = (name, details) => { console.log(`PASS ${name}`); report.checks.push({ name, pass: true, ...(details ? { details } : {}) }); };
const raw = message => driver.evaluate(message => chrome.runtime.sendMessage(message), message);
async function rpc(message) { const value = await raw(message); assert.equal(value?.success, true, JSON.stringify(value)); return value.data; }
const tabMessage = (paper, message) => driver.evaluate(({ tabId, message }) => chrome.tabs.sendMessage(tabId, message), { tabId: paper.tabId, message });
async function content(paper, action, payload = null) {
  return worker.evaluate(async ({ tabId, action, payload }) => {
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: async (action, payload) => {
      if (action === 'state') return {
        documentId: currentManualDocument?.documentId, documentHash: currentManualDocument?.documentHash,
        hasCreationToken: Boolean(currentManualDocument?.documentCreationToken),
        record: currentManualDocument?.record, workspace: currentArticleWorkspace,
        baseline: captureArticleWorkspaceRestoreManualBaseline(),
        marks: [...document.querySelectorAll('.sci-manual-highlight')].map(mark => ({
          annotationId: mark.dataset.annotationId, text: mark.textContent }))
      };
      if (action === 'build-directory-annotation') {
        const block = currentManualBlocks.find(block => manualReadableText(block.element).includes('The measured response'));
        if (!block) throw Error('SYNTHETIC_ANNOTATION_BLOCK_MISSING');
        const quote = 'The measured response showed no significant increase in the treated condition (p = 0.12)';
        const text = manualReadableText(block.element), start = text.indexOf(quote);
        if (start < 0) throw Error('SYNTHETIC_ANNOTATION_QUOTE_MISSING');
        const semanticSpan = payload?.semantic === true ? SciLLM.findCanonicalQuoteSourceSpan(text, quote) : null;
        const annotationBlock = payload?.semantic === 'turn-only'
          ? currentManualBlocks.filter(item => manualReadableText(item.element).includes('The measured response'))[1] : block;
        const annotation = buildAutomaticAnnotation(annotationBlock, semanticSpan?.sourceStart ?? start,
          semanticSpan?.sourceEnd ?? start + quote.length, {
          categoryId: 'result', sourceType: payload?.semantic === true ? 'semantic' : 'manual',
          sourceQuery: payload?.semantic ? 'find the result' : '' });
        annotation.note = 'Directory fixture: no increase, p = 0.12; retain after restore and later save.';
        if (payload?.semantic) {
          const turn = publicArticleChatTurn({
          turnId: 'saved-semantic', question: 'find the result', intent: 'highlight', status: 'completed',
          matchCount: payload.semantic === true ? 1 : 0,
          unresolvedCount: payload.semantic === true ? 0 : 1,
          answerBlocks: [{ blockId: 'source', markdown: quote, evidence: [{
            paragraphId: block.blockId, quote, verificationStatus: 'verified' }] }]
          });
          return { annotation, chat: { ...getPublicArticleChatState(), turns: [turn],
            totalTurns: 1, returnedTurns: 1 } };
        }
        return annotation; // No annotation save, local document write or rendered mark.
      }
      if (action === 'runtime') return chrome.runtime.sendMessage(payload);
      if (action === 'automatic-engine') return buildArticleWorkspaceAssets().get('annotations/highlights.json').activeEngine;
      if (action === 'extraction-input') return {
        cached: (currentArticleStructure?.paragraphs || []).slice(0, 3).map(p => ({
          paragraphId:p.paragraphId,sourceKey:p.sourceKey,text:p.text })),
        dom: [...document.querySelectorAll('[data-sci-llm-paragraph-id]')].slice(0, 3).map(element => ({
          sourceKey:element.dataset.sciLlmParagraphId,
          scientific:SciLLM.scientificInlineText(element),manual:manualReadableText(element) }))
      };
      if (action === 'turn-projection') return {
        turns: getPublicArticleChatState().turns,
        plans: articleChatState.turns.map(turn => {
          const plan = planRestoredHtmlSemanticTurn(turn);
          return { turnId: turn.turnId, annotations: plan.annotations.length,
            unresolvedCount: plan.unresolvedCount, authoritativeCount: plan.authoritativeCount,
            presentation: plan.annotations.map(annotation => ({
              planned: annotation.visibleMode,
              resolved: SciLLM.resolveAnnotationPresentation(annotation, {
                viewId: restoredHtmlSemanticChatModeId(turn.turnId),
                density: llmPresentationState.density,
                hiddenFamilyIds: llmPresentationState.hiddenFamilyIds,
                categoryMap: SciLLM.createBuiltInCategories()
              }).visibleMode
            })) };
        }),
        gates: articleChatState.turns.flatMap(turn => turn.answerBlocks.flatMap(block => block.evidence))
          .map(evidence => {
            const elements = [...document.querySelectorAll('[data-sci-llm-paragraph-id]')]
              .filter(element => element.dataset.sciLlmParagraphId === evidence.paragraphId);
            const paragraphs = currentArticleStructure?.paragraphs || [];
            const matches = paragraphs.filter(paragraph => paragraph.paragraphId === evidence.paragraphId);
            const aliases = paragraphs.filter(paragraph =>
              (paragraph.paragraphId === evidence.paragraphId || paragraph.sourceKey === evidence.paragraphId) &&
              String(paragraph.sourceKey || paragraph.paragraphId) === String(evidence.sourceKey || evidence.paragraphId));
            const element = elements[0];
            if (!element) return { paragraphMatches:matches.length,elements:elements.length };
            const nodes = collectManualTextNodes(element), raw = nodes.map(node => node.textContent).join('');
            const index = raw.indexOf(evidence.quote), normalized = SciLLM.normalizeTextWithOffsets(raw);
            return { paragraphMatches:matches.length,sourceKeys:matches.map(p=>p.sourceKey||p.paragraphId),
              structureParagraphs:paragraphs.length,sourceAliasMatches:aliases.map(p=>({
                paragraphId:p.paragraphId,sourceKey:p.sourceKey,textHash:p.textHash })),
              elements:elements.length,connected:element.isConnected,
              rawAgrees:collectLlmTextNodes(element).map(node=>node.textContent).join('')===raw,
              rawIndex:index,rawRepeats:raw.indexOf(evidence.quote,index+1)>=0,
              canonicalMatches:SciLLM.countCanonicalTextMatches(raw,evidence.quote),
              normalizedStart:normalized.rawStarts.indexOf(index),
              normalizedLast:normalized.rawEnds.indexOf(index+evidence.quote.length),
              protectedDescendants:element.querySelectorAll('.sci-manual-highlight,.sci-semantic-annotation,[data-sci-plugin-ui],.sci-llm-highlight').length,
              closestProtected:!!element.closest('.sci-manual-highlight,.sci-semantic-annotation,[data-sci-plugin-ui],.sci-llm-highlight') };
          }),
        marks: [...document.querySelectorAll('.sci-llm-highlight[data-restored-chat-turn-id]')].map(mark => ({
          text: mark.textContent, mode: mark.dataset.analysisModeId })),
        manualMarks: [...document.querySelectorAll('.sci-manual-highlight')].map(mark => ({
          text: mark.textContent, id: mark.dataset.annotationId })),
        annotations: currentManualDocument.record.annotations
      };
      if (action === 'delete-restored-turn') return removeArticleChatTurn('saved-semantic');
      if (action === 'semantic-diagnostic') return {
        semanticState: currentNativePdfSemanticHighlightState(), turns: articleChatState.turns,
        marks: Array.from(document.querySelectorAll('.sci-semantic-annotation')).map(mark => ({
          id: mark.dataset.annotationId, text: mark.textContent })),
        located: ManualAnnotationUiHelpers.planManualAnnotationRestore(
          currentManualDocument.record.annotations, currentManualBlocks, SciLLM.locateAnnotationInBlocks),
        evidence: articleChatState.turns.flatMap(turn => turn.answerBlocks.flatMap(block => block.evidence))
          .map(item => { const element = findManualBlockElement(item.paragraphId);
            const block = element && findManualBlock(element); return { paragraphId: item.paragraphId,
              blockId: block?.blockId, span: block && SciLLM.findCanonicalQuoteSourceSpan(
                manualReadableText(block.element), item.quote) }; })
      };
      throw Error('UNKNOWN_TEST_ACTION');
    }, args: [action, payload] });
    return results[0]?.result;
  }, { tabId: paper.tabId, action, payload });
}
async function settled(paper) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const value = await content(paper, 'state');
    if (!value.baseline.blocked) return value;
    if (attempt === 39) throw Error(`MANUAL_BASELINE_NOT_READY:${JSON.stringify(value.baseline)}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
async function freshPaper(name, { sameUrl = '', expectToken = true } = {}) {
  const url = sameUrl || `https://example.org/arch009-first-document-${name}`;
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).filter(tab => tab.url === url).at(-1)?.id, url);
  assert.ok(Number.isSafeInteger(tabId));
  await worker.evaluate(tabId => SciLLM.ensureContentScriptForActivation(chrome, tabId), tabId);
  const paper = { name, page, url, tabId }; papers.push(paper);
  // This is the actual initialization chain. Do not replace it with an explicit
  // complete save, suppress autosave, or delete an unexpected local asset.
  const extracted = await tabMessage(paper, { action: 'getArticleWorkspaceSnapshot' });
  assert.equal(extracted.success, true, JSON.stringify(extracted)); assert.ok(extracted.snapshot.paragraphs.length >= 8);
  const ensured = await tabMessage(paper, { action: 'ensureArticleWorkspace' });
  assert.equal(ensured.success, true, JSON.stringify(ensured));
  const baseline = await tabMessage(paper, { action: 'saveArticleWorkspaceBaseline' });
  assert.equal(baseline.success, true, JSON.stringify(baseline)); assert.equal(baseline.saved, true);
  paper.ensured = ensured;
  paper.identity = { ...ensured.workspace, documentId: ensured.archiveIdentity.documentId,
    documentHash: ensured.archiveIdentity.documentHash };
  assert.equal(Boolean(ensured.documentCreationToken), expectToken, `${name}: token must reflect real creation owner`);
  if (expectToken) assert.match(ensured.documentCreationToken, /^document-creation-/u);
  const state = await settled(paper); assert.equal(state.record.annotations.length, 0);
  const stored = await durable(paper); assert.equal(stored.record.annotations.length, 0);
  assert.equal(stored.highlights, null, `${name}: real init produced local highlights; keep and report conflict, never delete it`);
  return paper;
}
async function durable(paper) {
  return worker.evaluate(async identity => ({
    baseline: await articleWorkspaceStore.captureRestoreBaseline(identity.workspaceId, { documentId: identity.documentId }),
    record: await documentStore.getDocument(identity.documentId),
    highlights: await articleWorkspaceStore.getAsset(identity.workspaceId, 'annotations/highlights.json')
  }), paper.identity);
}
async function drainDirectory() {
  return worker.evaluate(async () => {
    const results = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      const flushed = await directorySync.flush(); results.push(flushed);
      if (flushed.failed || flushed.permission !== 'granted') throw Error(`DIRECTORY_FIXTURE_FLUSH_FAILED:${JSON.stringify(flushed)}`);
      const status = await directorySync.status();
      if (status.pendingCount === 0) return { results, status };
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('DIRECTORY_FIXTURE_DID_NOT_DRAIN');
  });
}
async function seedDirectory(paper, { semantic = false } = {}) {
  const fixture = await content(paper, 'build-directory-annotation', { semantic });
  const annotation = semantic ? fixture.annotation : fixture;
  const before = await durable(paper);
  await drainDirectory();
  const seeded = await worker.evaluate(async ({ identity, annotation, chat }) => {
    const legal = SciLLM.normalizeManualAnnotation(annotation);
    const workspace = await articleWorkspaceStore.getWorkspace(identity.workspaceId);
    const flushedBaseline = await directorySync.flush();
    await directorySync.enqueueWorkspaceAsset(workspace, 'annotations/highlights.json', { annotations: [legal] });
    if (chat) await directorySync.enqueueWorkspaceAsset(workspace, 'chat/index.json', chat);
    const sync = await directorySync.flush();
    const disk = await directorySync.readWorkspaceAsset(workspace, 'annotations/highlights.json');
    return { annotation: legal, flushedBaseline, sync, disk };
  }, { identity: paper.identity, annotation, chat: semantic ? fixture.chat : null });
  assert.equal(seeded.sync.permission, 'granted'); assert.equal(seeded.disk.found, true);
  assert.deepEqual(seeded.disk.value.data.annotations, [seeded.annotation]);
  const drained = await drainDirectory();
  const directory = await directoryEvidence(paper);
  assert.ok(directory.manifests.matches.some(match => match.manifest.workspaceId === paper.identity.workspaceId),
    `fully drained directory fixture must be indexed: ${JSON.stringify(directory)}`);
  (report.directoryFixtures ||= []).push({ name: paper.name, drained, directory });
  assert.deepEqual(await durable(paper), before, 'directory fixture creation must not alter local documents or workspace assets');
  paper.annotation = seeded.annotation;
}
async function scanRaw(paper, ensured = paper.ensured, { withToken = true } = {}) {
  return raw({ type: 'ARTICLE_WORKSPACE_SCAN_RESTORE', identity: paper.identity,
    operationNonce: ensured.restoreAuthorization.token, requestPermission: false,
    ...(withToken && ensured.documentCreationToken ? { documentCreationToken: ensured.documentCreationToken } : {}) });
}
async function scan(paper) {
  // Like the actual popup, capture the page authorization immediately before
  // SCAN. Initial baseline persistence changes the page mutation tail, so its
  // earlier ensure response is not a current destructive-restore authority.
  const ensured = await tabMessage(paper, { action: 'ensureArticleWorkspace', forceRefresh: true });
  assert.equal(ensured.success, true, JSON.stringify(ensured));
  paper.ensured = ensured;
  paper.identity = { ...ensured.workspace, documentId: ensured.archiveIdentity.documentId,
    documentHash: ensured.archiveIdentity.documentHash };
  const response = await scanRaw(paper); assert.equal(response.success, true, JSON.stringify(response));
  assert.ok(response.data.restore?.restorePlanId, JSON.stringify(response));
  const restore = response.data.restore;
  const restoreTarget = { authorizationToken: paper.ensured.restoreAuthorization.token,
    current: paper.ensured.restoreAuthorization.identity, documentId: paper.identity.documentId,
    manifest: restore.manifest, allowContentChanged: restore.match === 'content-changed' };
  const binding = { kind: 'workspace', operationNonce: restoreTarget.authorizationToken,
    current: restoreTarget.current, documentId: paper.identity.documentId,
    manifest: restore.manifest, match: restore.match, allowContentChanged: restoreTarget.allowContentChanged };
  return { restore, restoreTarget, binding };
}
const preparedMessage = scanned => ({ type: 'ARTICLE_WORKSPACE_COMMIT_PREPARED_RESTORE',
  planId: scanned.restore.restorePlanId, binding: scanned.binding });
const apply = (paper, scanned) => tabMessage(paper, { action: 'applyArticleWorkspaceAssets',
  restore: { ...scanned.restore, restoreTarget: scanned.restoreTarget } });
async function clearThroughRuntime(paper) {
  const response = await content(paper, 'runtime', { type: 'ANNOTATION_CLEAR_DOCUMENT', documentId: paper.identity.documentId });
  assert.equal(response.success, true, JSON.stringify(response)); assert.equal(response.data.record.annotations.length, 0);
  return durable(paper);
}
async function directoryEvidence(paper) {
  return worker.evaluate(async identity => ({
    status: await directorySync.status(),
    manifests: await directorySync.listWorkspaceManifests(identity),
    highlights: await directorySync.readWorkspaceAsset(identity, 'annotations/highlights.json')
  }), paper.identity);
}
try {
  stage('copy-frozen-production-and-launch'); fs.mkdirSync(extension);
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
  for (const file of fs.readdirSync(root)) if (/\.(js|mjs|html|css)$/u.test(file) || file === 'manifest.json') fs.copyFileSync(path.join(root, file), path.join(extension, file));
  for (const file of files) report.sourceHashes[file] = sha(fs.readFileSync(path.join(extension, file)));
  fs.writeFileSync(path.join(extension, 'first-document-driver.html'), '<!doctype html><meta charset="utf-8"><title>Isolated first document verifier</title>ARCH009');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'msedge', headless: true,
    viewport: { width: 1060, height: 850 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking'] });
  await context.route(/^https?:\/\//u, route => {
    const url = route.request().url(), match = /^https:\/\/example\.org\/arch009-first-document-([a-z]+)$/u.exec(url);
    if (!match) return route.abort('blockedbyclient');
    const title = `Synthetic first-document ${match[1]} study`;
    const paragraphs = Array.from({ length: 8 }, (_, index) => `<p>Experiment ${index + 1} tested the response of cortical neurons to a controlled stimulus. The measured response showed no significant increase in the treated condition (p = 0.12), while the positive control increased 2.4-fold. We retained independent observations and compared prespecified intervals with the matched baseline. These synthetic findings verify first-document recovery without model calls or real user data.</p>`).join('');
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="canonical" href="${url}"><meta name="citation_title" content="${title}"><title>${title}</title></head><body><main><article><h1>${title}</h1><h2>Results</h2>${paragraphs}</article></main></body></html>` });
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => { globalThis.fetch = async () => { throw Error('ARCH009_FIRST_DOCUMENT_NO_NETWORK'); }; });
  driver = await context.newPage(); await driver.goto(`chrome-extension://${new URL(worker.url()).host}/first-document-driver.html`);
  report.opfs = await worker.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getDirectoryHandle('arch009-first-document-fixture', { create: true });
    await SciLLM.createIndexedDbDirectoryHandleStore(indexedDB).save(handle);
    return { kind: handle.kind, name: handle.name, status: await directorySync.status() };
  });
  assert.equal(report.opfs.status.permission, 'granted');
  check('native extension-origin OPFS directory is configured in isolated profile');
  await worker.evaluate(() => {
    globalThis.firstDocumentObserved = [];
    const original = llmRouter.handle.bind(llmRouter);
    llmRouter.handle = async (message, context) => {
      const response = await original(message, context);
      if (['DOCUMENT_PREPARE', 'ARTICLE_WORKSPACE_COMMIT_PREPARED_RESTORE'].includes(message.type)) {
        firstDocumentObserved.push({ type: message.type, success: response.success,
          hasCreationToken: Boolean(response.data?.documentCreationToken), documentId: response.data?.documentId,
          senderTabId: context.senderTabId, senderFrameId: context.senderFrameId,
          senderDocumentId: context.senderDocumentId, senderExtensionId: context.senderExtensionId,
          errorCode: response.error?.code, persistenceCommitted: response.data?.persistenceCommitted });
      }
      return response;
    };
  });
  stage('first-owner-and-second-tab');
  const owner = await freshPaper('normal');
  const second = await freshPaper('second', { sameUrl: owner.url, expectToken: false });
  assert.equal(owner.identity.documentId, second.identity.documentId);
  assert.equal(owner.identity.documentHash, second.identity.documentHash);
  await seedDirectory(owner);
  check('real first prepare owns token while second tab of same paper has none; baseline did not save empty highlights');
  const beforeSecondScan = await durable(owner);
  const secondScan = await scanRaw(second);
  assert.equal(secondScan.success, false, 'existing empty record without creation token remains a conflict');
  assert.deepEqual(await durable(owner), beforeSecondScan);
  check('second tab cannot obtain creation exception by scanning without a token', { code: secondScan.error?.code });
  const scanned = await scan(owner);
  const beforeWrongOwner = await durable(owner);
  for (const [label, result] of [
    ['second tab', await content(second, 'runtime', preparedMessage(scanned))],
    ['extension page', await raw(preparedMessage(scanned))]
  ]) { assert.equal(result.success, false, `${label} cannot consume creator plan`); assert.deepEqual(await durable(owner), beforeWrongOwner); }
  check('second-tab and extension-page senders cannot consume the creator plan or write any restore rows');
  const legacyReceipt = await content(owner, 'runtime', { type: 'ARTICLE_RESTORE_REGISTER_COMMIT', binding: scanned.binding });
  assert.equal(legacyReceipt.success, true, JSON.stringify(legacyReceipt));
  const oldCommit = await raw({ type: 'ARTICLE_WORKSPACE_COMMIT_RESTORE', identity: owner.identity,
    restore: scanned.restore, operationNonce: scanned.binding.operationNonce, receipt: legacyReceipt.data.receipt });
  assert.equal(oldCommit.success, false); assert.deepEqual(await durable(owner), beforeWrongOwner);
  check('old extension-page commit forwarding cannot bypass creation-owner binding', { code: oldCommit.error?.code });
  stage('creator-commit-dom-and-later-save');
  const applied = await apply(owner, scanned); report.creatorApply = applied;
  assert.equal(applied.success, true, JSON.stringify(applied)); assert.equal(applied.persistenceCommitted, true);
  assert.equal(applied.workspaceApplied, true);
  const after = await durable(owner), state = await settled(owner);
  assert.deepEqual(after.record.annotations, [owner.annotation]);
  assert.deepEqual(after.highlights.content.annotations, after.record.annotations);
  assert.deepEqual(state.record, after.record);
  assert.equal(state.hasCreationToken, false, 'successful committed projection must discard the consumed creation token');
  assert.ok(state.marks.some(mark => mark.annotationId === owner.annotation.annotationId && mark.text === owner.annotation.quote));
  await owner.page.locator('.sci-manual-highlight').first().screenshot({ path: path.join(run, 'first-restored-manual-mark.png') });
  report.screenshots.push('first-restored-manual-mark.png');
  await owner.page.screenshot({ path: path.join(run, 'first-restored-article.png') }); report.screenshots.push('first-restored-article.png');
  check('first empty document restores nonempty annotations into actual documents/highlights and matching rendered DOM');
  const saved = await tabMessage(owner, { action: 'saveArticleWorkspaceNow', operationId: 'first-document:after-restore' });
  assert.equal(saved.success, true, JSON.stringify(saved)); assert.equal(saved.saveStatus, 'complete', JSON.stringify(saved));
  const afterSave = await durable(owner); assert.deepEqual(afterSave.record.annotations, after.record.annotations);
  assert.deepEqual(afterSave.highlights.content.annotations, after.record.annotations);
  const mirrored = await worker.evaluate(async identity => ({ flush: await directorySync.flush(),
    disk: await directorySync.readWorkspaceAsset(identity, 'annotations/highlights.json') }), owner.identity);
  assert.equal(mirrored.flush.permission, 'granted'); assert.deepEqual(mirrored.disk.value.data.annotations, after.record.annotations);
  check('later real full save and native OPFS flush preserve restored annotations');
  const renewed = await tabMessage(owner, { action: 'ensureArticleWorkspace' });
  assert.equal(renewed.success, true, JSON.stringify(renewed));
  assert.equal(Boolean(renewed.documentCreationToken), false, 'ensure must not export a consumed wrapper token');
  owner.ensured = renewed;
  const ordinaryPlan = await scan(owner);
  const ordinaryApply = await apply(owner, ordinaryPlan);
  assert.equal(ordinaryApply.success, true, JSON.stringify(ordinaryApply));
  assert.equal(ordinaryApply.persistenceCommitted, true);
  assert.notEqual(ordinaryApply.manualRebuildDeferred, true,
    'the real empty chat checkpoint must not report unfinished manual rendering');
  report.ordinaryApply = ordinaryApply;
  assert.deepEqual((await durable(owner)).record.annotations, after.record.annotations);
  assert.equal((await content(owner, 'state')).hasCreationToken, false);
  check('consumed token is absent from page/ensure and a subsequent same-copy ordinary restore still succeeds');
  stage('html-semantic-projection-status');
  const semanticPaper = await freshPaper('semantic'); await seedDirectory(semanticPaper, { semantic: true });
  const semanticApply = await apply(semanticPaper, await scan(semanticPaper));
  report.semanticDiagnostic = await content(semanticPaper, 'semantic-diagnostic');
  assert.equal(semanticApply.success, true, JSON.stringify(semanticApply));
  assert.equal(semanticApply.semanticHighlightsRestored, 1, JSON.stringify(semanticApply));
  assert.notEqual(semanticApply.manualRebuildDeferred, true, JSON.stringify(semanticApply));
  const semanticDurable = await durable(semanticPaper);
  assert.deepEqual(semanticDurable.record.annotations, semanticDurable.highlights.content.annotations);
  assert.equal(await semanticPaper.page.locator('.sci-semantic-annotation').count(), 1);
  await semanticPaper.page.screenshot({ path: path.join(run, 'restored-html-semantic.png') });
  report.screenshots.push('restored-html-semantic.png'); report.semanticApply = semanticApply;
  check('actual committed HTML semantic mark is complete without replacing the persisted annotation');
  const semanticSaved = await tabMessage(semanticPaper, { action: 'saveArticleWorkspaceNow', operationId: 'semantic:after-restore' });
  assert.equal(semanticSaved.saveStatus, 'complete', JSON.stringify(semanticSaved));
  assert.deepEqual((await durable(semanticPaper)).record.annotations, semanticDurable.record.annotations);
  check('later ordinary save preserves restored HTML semantic annotation and note');
  const missingSemantic = await freshPaper('missingsemantic');
  await seedDirectory(missingSemantic, { semantic: 'missing' });
  const missingApply = await apply(missingSemantic, await scan(missingSemantic));
  assert.equal(missingApply.success, true, JSON.stringify(missingApply));
  assert.equal(missingApply.manualRebuildDeferred, true, JSON.stringify(missingApply));
  assert.equal(missingApply.semanticHighlightsRestored, 0);
  assert.equal(await missingSemantic.page.locator('.sci-semantic-annotation').count(), 0);
  check('a manual annotation at the same quote does not falsely satisfy missing semantic display');

  stage('html-turn-only-projection');
  const turnOnly = await freshPaper('turnonly');
  await seedDirectory(turnOnly, { semantic: 'turn-only' });
  const turnOnlyEngineBefore = await content(turnOnly, 'automatic-engine');
  report.turnOnlyExtractionBefore = await content(turnOnly, 'extraction-input');
  const turnOnlyApply = await apply(turnOnly, await scan(turnOnly));
  report.turnOnlyApply = turnOnlyApply;
  report.turnOnlyProjection = await content(turnOnly, 'turn-projection');
  assert.equal(turnOnlyApply.success, true, JSON.stringify(turnOnlyApply));
  assert.equal(turnOnlyApply.semanticHighlightsRestored, 1, JSON.stringify(turnOnlyApply));
  assert.notEqual(turnOnlyApply.manualRebuildDeferred, true, JSON.stringify(turnOnlyApply));
  assert.equal(report.turnOnlyProjection.marks.length, 1);
  assert.equal(report.turnOnlyProjection.marks[0].text, turnOnly.annotation.quote);
  const turnOnlyDurable = await durable(turnOnly);
  assert.deepEqual(turnOnlyDurable.record.annotations, [turnOnly.annotation]);
  assert.equal(await content(turnOnly, 'automatic-engine'), turnOnlyEngineBefore);
  assert.equal(report.turnOnlyProjection.manualMarks.length, 1);
  check('trusted HTML turn without semantic annotations paints exact quote and preserves separate manual annotation');
  const temporaryMark = turnOnly.page.locator('.sci-llm-highlight[data-restored-chat-turn-id]').first();
  await temporaryMark.click();
  assert.equal(await turnOnly.page.locator('#sci-highlight-context-popover .sci-context-ai').count(), 0);
  assert.notEqual(await temporaryMark.getAttribute('role'), 'button');
  check('temporary turn display click does not expose full-analysis AI feedback or a fake edit button');
  await turnOnly.page.screenshot({ path: path.join(run, 'restored-html-turn-only.png') });
  report.screenshots.push('restored-html-turn-only.png');
  report.turnOnlyExtractionAfter = await content(turnOnly, 'extraction-input');
  await drainDirectory();
  const invalidTurnPlan = await scan(turnOnly);
  report.turnOnlyRescan = { match: invalidTurnPlan.restore.match,
    current: invalidTurnPlan.restoreTarget.current, manifest: invalidTurnPlan.restore.manifest };
  assert.equal(invalidTurnPlan.restore.match, 'exact',
    'plugin highlights and note controls must not change article content identity');
  const refusedTurnRestore = await apply(turnOnly, { ...invalidTurnPlan,
    restoreTarget:{...invalidTurnPlan.restoreTarget,current:{...invalidTurnPlan.restoreTarget.current,
      canonicalUrl:'https://example.invalid/wrong-owner'}} });
  assert.equal(refusedTurnRestore.success, false, JSON.stringify(refusedTurnRestore));
  assert.equal((await content(turnOnly, 'turn-projection')).marks.length, 1);
  assert.deepEqual((await durable(turnOnly)).record.annotations, turnOnlyDurable.record.annotations);
  check('rejected restore leaves prior turn display and original manual record intact');
  const repeatTurnOnly = await apply(turnOnly, await scan(turnOnly));
  report.turnOnlyRepeat = repeatTurnOnly;
  report.turnOnlyRepeatProjection = await content(turnOnly, 'turn-projection');
  assert.equal(repeatTurnOnly.success, true, JSON.stringify(repeatTurnOnly));
  assert.equal(repeatTurnOnly.semanticHighlightsRestored, 1, JSON.stringify(repeatTurnOnly));
  assert.notEqual(repeatTurnOnly.manualRebuildDeferred, true, JSON.stringify(repeatTurnOnly));
  assert.equal((await content(turnOnly, 'turn-projection')).marks.length, 1);
  assert.deepEqual((await durable(turnOnly)).record.annotations, turnOnlyDurable.record.annotations);
  check('repeated turn-only restore does not duplicate marks or persist reconstructed annotations');
  const turnOnlySaved = await tabMessage(turnOnly, { action:'saveArticleWorkspaceNow',operationId:'turnonly:after-restore' });
  assert.equal(turnOnlySaved.saveStatus, 'complete', JSON.stringify(turnOnlySaved));
  assert.deepEqual((await durable(turnOnly)).record.annotations, turnOnlyDurable.record.annotations);
  assert.equal((await durable(turnOnly)).highlights.content.activeEngine, turnOnlyEngineBefore,
    'ephemeral chat marks must not select the full-analysis engine');
  check('ordinary save after turn-only projection retains original annotation records');
  await drainDirectory();await turnOnly.page.reload();
  await worker.evaluate(tabId => SciLLM.ensureContentScriptForActivation(chrome, tabId), turnOnly.tabId);
  const reopenedTurnOnly = await tabMessage(turnOnly, { action:'getArticleWorkspaceSnapshot' });
  assert.equal(reopenedTurnOnly.success, true, JSON.stringify(reopenedTurnOnly));
  const afterReloadRestore = await apply(turnOnly, await scan(turnOnly));
  assert.equal(afterReloadRestore.success, true, JSON.stringify(afterReloadRestore));
  assert.equal((await content(turnOnly, 'turn-projection')).marks.length, 1);
  assert.deepEqual((await durable(turnOnly)).record.annotations, turnOnlyDurable.record.annotations);
  check('full page reload then explicitly authorized directory restore recreates turn-only display');
  const deletedTurn = await content(turnOnly, 'delete-restored-turn');
  assert.equal(deletedTurn.success, true, JSON.stringify(deletedTurn));
  const afterDelete = await content(turnOnly, 'turn-projection');
  assert.equal(afterDelete.marks.length, 0);assert.equal(afterDelete.manualMarks.length, 1);
  assert.deepEqual(afterDelete.annotations, turnOnlyDurable.record.annotations);
  check('deleting restored turn removes only its ephemeral marks and keeps manual record/mark');
  stage('directory-changed-after-scan');
  const changedDirectory = await freshPaper('changeddirectory');
  await seedDirectory(changedDirectory, { semantic: true });
  const originalPlan = await scan(changedDirectory);
  const laterDisk = await worker.evaluate(async identity => {
    const previous = await directorySync.readWorkspaceAsset(identity, 'chat/index.json');
    const next = structuredClone(previous.value.data);
    next.turns[0].question = 'New directory edit after SCAN: preserve this question';
    await directorySync.enqueueWorkspaceAsset(identity, 'chat/index.json', next,
      { revision: previous.value.revision + 1 });
    const flush = await directorySync.flush();
    if (flush.failed) throw Error('NEW_DIRECTORY_FIXTURE_FAILED');
    return (await directorySync.readWorkspaceAsset(identity, 'chat/index.json')).value;
  }, changedDirectory.identity);
  const guarded = await apply(changedDirectory, originalPlan);
  assert.equal(guarded.persistenceCommitted, true, JSON.stringify(guarded));
  assert.equal(guarded.syncStatus, 'pending', JSON.stringify(guarded));
  const actualDisk = await worker.evaluate(async identity =>
    (await directorySync.readWorkspaceAsset(identity, 'chat/index.json')).value, changedDirectory.identity);
  assert.deepEqual(actualDisk, laterDisk);
  check('post-scan directory edit is retained and mirror reports pending after local commit');
  stage('clear-empty-record-before-scan');
  const clearBefore = await freshPaper('clearbefore'); await seedDirectory(clearBefore);
  report.clearBeforeDirectory = { beforeClear: await directoryEvidence(clearBefore) };
  const beforeClear = await durable(clearBefore), afterClear = await clearThroughRuntime(clearBefore);
  assert.ok(afterClear.record.revision > beforeClear.record.revision, 'real clear advances revision even when empty');
  // The real clear schedules directory mirroring. Wait for that genuine queue
  // to settle before examining whether the candidate was filtered or rejected.
  report.clearBeforeDirectory.flush = await drainDirectory();
  report.clearBeforeDirectory.afterClear = await directoryEvidence(clearBefore);
  const rejectedScan = await scanRaw(clearBefore);
  report.clearBeforeDirectory.scan = rejectedScan;
  assert.ok(rejectedScan.success === false || !rejectedScan.data?.restore,
    `clear must not produce a restorable candidate: ${JSON.stringify(rejectedScan)}`);
  assert.deepEqual(await durable(clearBefore), afterClear);
  assert.equal((await durable(clearBefore)).record.annotations.length, 0);
  check('real later clear of empty record before scan prevents restore and leaves all restore rows untouched',
    { code: rejectedScan.error?.code || null, restoreAvailable: Boolean(rejectedScan.data?.restore),
      matches: rejectedScan.data?.matches?.length ?? null });
  stage('clear-empty-record-after-scan');
  const clearAfter = await freshPaper('clearafter'); await seedDirectory(clearAfter); const latePlan = await scan(clearAfter);
  const afterLateClear = await clearThroughRuntime(clearAfter);
  const rejectedApply = await apply(clearAfter, latePlan); assert.equal(rejectedApply.success, false, JSON.stringify(rejectedApply));
  assert.deepEqual(await durable(clearAfter), afterLateClear);
  assert.equal((await content(clearAfter, 'state')).marks.length, 0);
  check('real later clear after scan rejects prepared apply and causes zero restore writes/marks', { code: rejectedApply.code });
  stage('same-url-navigation-does-not-inherit-creator-plan');
  const navigation = await freshPaper('navigation'); await seedDirectory(navigation); const navigationPlan = await scan(navigation);
  const oldFrame = await worker.evaluate(tabId => chrome.webNavigation.getFrame({ tabId, frameId: 0 }), navigation.tabId);
  await navigation.page.reload(); await worker.evaluate(tabId => SciLLM.ensureContentScriptForActivation(chrome, tabId), navigation.tabId);
  const newFrame = await worker.evaluate(tabId => chrome.webNavigation.getFrame({ tabId, frameId: 0 }), navigation.tabId);
  assert.notEqual(newFrame.documentId, oldFrame.documentId);
  const beforeReplay = await durable(navigation);
  const replay = await content(navigation, 'runtime', preparedMessage(navigationPlan)); assert.equal(replay.success, false, JSON.stringify(replay));
  assert.deepEqual(await durable(navigation), beforeReplay);
  check('same-tab same-URL replacement browser document cannot consume old creator plan', { oldDocumentId: oldFrame.documentId, newDocumentId: newFrame.documentId, code: replay.error?.code });
  report.observedRuntime = await worker.evaluate(() => firstDocumentObserved);
  assert.ok(report.observedRuntime.some(event => event.type === 'DOCUMENT_PREPARE' && event.senderTabId === owner.tabId && event.hasCreationToken));
  assert.ok(!report.observedRuntime.some(event => event.type === 'DOCUMENT_PREPARE' && event.senderTabId === second.tabId && event.hasCreationToken));
  const ownerFrame = await worker.evaluate(tabId => chrome.webNavigation.getFrame({ tabId, frameId: 0 }), owner.tabId);
  assert.ok(report.observedRuntime.some(event => event.type === 'ARTICLE_WORKSPACE_COMMIT_PREPARED_RESTORE' && event.success && event.senderTabId === owner.tabId && event.senderDocumentId === ownerFrame.documentId && event.persistenceCommitted));
  check('pass-through runtime observations bind actual creation and durable commit to the same browser owner');
  assert.deepEqual(report.errors, []); check('no page errors');
  for (const file of files) report.endSourceHashes[file] = sha(fs.readFileSync(path.join(root, file)));
  assert.deepEqual(report.endSourceHashes, report.sourceHashes, 'production changed during run; repeat after freeze');
  check(`all ${files.length} relevant source hashes match copied production before and after run`); report.status = 'PASS';
} catch (error) { report.failure = String(error.stack || error); console.error(report.failure); }
finally {
  if (worker && report.status !== 'PASS') report.failedChatQueue = await worker.evaluate(async () => {
    const queued = await SciLLM.createIndexedDbSyncQueue(indexedDB).getAll();
    return Promise.all(queued.filter(item => item.relativePath.endsWith('/chat/index.json'))
      .map(async item => ({ path: item.relativePath, queued: JSON.parse(item.content),
        disk: await directorySync.readJson(item.relativePath) })));
  }).catch(error => ({ error: error.message }));
  if (worker) report.observedRuntime = await worker.evaluate(() => globalThis.firstDocumentObserved || []).catch(() => []);
  await context?.close(); report.completedAt = new Date().toISOString(); report.runDirectory = run;
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  fs.writeFileSync(path.join(run, 'report.html'), `<!doctype html><meta charset="utf-8"><h1>${report.status}</h1><p>${escape(report.boundary)}</p>` + report.checks.map(item => `<p>PASS ${escape(item.name)}</p>`).join('') + report.screenshots.map(file => `<h2>${file}</h2><img src="${file}" style="max-width:100%">`).join(''));
  if (path.dirname(path.resolve(temporary)) === path.resolve(os.tmpdir()) && /^brevess-first-doc-/u.test(path.basename(temporary))) fs.rmSync(temporary, { recursive: true, force: true });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, report: path.join(run, 'report.json'), failure: report.failure || null })); process.exitCode = report.status === 'PASS' ? 0 : 1;
}
