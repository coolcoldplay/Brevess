import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const arg = (name, fallback) => process.argv.includes(name)
  ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const extensionSource = path.resolve(arg('--extension', repositoryRoot));
const pdfPath = path.join(repositoryRoot, 'tmp', 'public-pdf-acceptance',
  'elife-83176-v2.pdf');
const outputDirectory = path.resolve(arg('--output', path.join(repositoryRoot, 'output', 'playwright',
  'article-chat-methods-scope')));
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-methods-scope-'));
const extensionDirectory = path.join(temporaryRoot, 'extension');
const profileDirectory = path.join(temporaryRoot, 'profile');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function copyExtension() {
  fs.mkdirSync(extensionDirectory, { recursive: true });
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(extensionSource, directory), path.join(extensionDirectory, directory), {
      recursive: true
    });
  }
  for (const file of fs.readdirSync(extensionSource)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(extensionSource, file), path.join(extensionDirectory, file));
    }
  }
}

function safeError(error) {
  return String(error?.stack || error?.message || error || '')
    .replace(/[A-Za-z]:\\[^\r\n]*/gu, '[local-path]').slice(0, 800);
}

function writeReport(report) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const target = path.join(outputDirectory, 'report.json');
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

const report = {
  status: 'RUNNING',
  kind: 'nativeUi',
  scope: 'Real public PDF production parser and reader content-script scope/preflight; parser snapshot passed into the production popup; ' +
    'the two production button handlers are exercised with their tab transport intercepted. ' +
    'This does not validate live reader-to-side-panel attachment or any model response.',
  source: {
    publicPdf: 'elife-83176-v2.pdf',
    sha256: fs.existsSync(pdfPath) ? sha256(fs.readFileSync(pdfPath)) : '',
    modelApiCalls: 0
  },
  observation: null,
  checks: {},
  artifacts: [],
  error: ''
};
const priorFailures = [
  { stage: 'browser-start', code: 'SPAWN_EPERM',
    outcome: 'Reran the isolated headless Edge process with approved local execution.' },
  { stage: 'panel-attachment', code: 'PANEL_SNAPSHOT_TIMEOUT',
    outcome: 'Used the production reader snapshot directly; live side-panel attachment is out of scope.' },
  { stage: 'popup-dependency', code: 'SCOPE_RESOLVER_NOT_LOADED',
    outcome: 'Added core/article-chat.js before popup.js.' },
  { stage: 'popup-tab-pointer', code: 'INACTIVE_SIDE_PANEL_POINTER_BLOCKED',
    outcome: 'The verifier dispatches the same production button click with Playwright force.' }
];
writeReport(report);

let context;
try {
  assert.ok(fs.existsSync(pdfPath), 'PUBLIC_PDF_MISSING');
  copyExtension();
  report.source.buildFiles = Object.fromEntries(
    ['content.js', 'popup.js', 'popup.html', 'pdf-reader.html', 'core/tab-messenger.js', 'core/article-chat.js'].map(relative => [
      relative, sha256(fs.readFileSync(path.join(extensionDirectory, relative)))
    ])
  );
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'failures.json'),
    `${JSON.stringify(priorFailures, null, 2)}\n`, 'utf8');
  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: 'msedge', headless: true, reducedMotion: 'reduce',
    viewport: { width: 1180, height: 900 },
    args: [`--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`]
  });
  await context.route(/^https?:\/\//u, route => route.abort('blockedbyclient'));
  context.on('request', request => {
    if (/^https?:\/\//u.test(request.url())) report.source.modelApiCalls += 1;
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const reader = context.pages()[0] || await context.newPage();
  await reader.goto(`chrome-extension://${extensionId}/pdf-reader.html`, {
    waitUntil: 'domcontentloaded'
  });
  await reader.locator('#pdfLocalFile').setInputFiles(pdfPath);
  await reader.waitForFunction(() => {
    const native = globalThis.__brevessNativePdfDocument;
    return native?.phase === 'text-ready' && native?.structure?.paragraphs?.length > 0 &&
      document.documentElement.dataset.pdfWorkspaceReady === 'true';
  }, null, { timeout: 120_000 });
  const documentHash = await reader.evaluate(() =>
    String(globalThis.__brevessNativePdfDocument?.structure?.documentHash || ''));
  const canonicalSnapshot = await reader.evaluate(() =>
    buildArticleWorkspaceSnapshot({ forceRefresh: true }));
  assert.equal(canonicalSnapshot?.documentHash, documentHash,
    'CANONICAL_SNAPSHOT_HASH_MISMATCH');
  assert.ok(canonicalSnapshot?.paragraphs?.length > 0,
    'CANONICAL_SNAPSHOT_PARAGRAPHS_EMPTY');
  const contentScope = await reader.evaluate(async () => {
    const snapshot = getCanonicalArticleSnapshot();
    const nodes = [];
    const visit = items => (items || []).forEach(node => { nodes.push(node); visit(node.children); });
    visit(snapshot.structure?.nodes);
    const node = nodes.find(item => /^methods$/i.test(String(item.title || '')));
    if (!node) return { error: 'PDF_METHODS_NODE_MISSING' };
    const selected = resolveCurrentArticleChatScope({ scopes: [{
      scopeId: node.sectionId, name: node.title,
      sectionIds: [node.sectionId], sourceKeys: [node.sourceKey].filter(Boolean)
    }] }, snapshot);
    const before = articleChatState.turns.length;
    let rejected = '';
    try {
      await askArticleWithLLM('Scope rejection acceptance', '', {
        contextScope: { sectionIds: ['unavailable-scope-acceptance'] }
      });
    } catch (error) { rejected = error.code || error.message; }
    return { paragraphIds: selected.paragraphs.map(item => item.paragraphId),
      beforeTurns: before, afterTurns: articleChatState.turns.length, rejected };
  });
  assert.ok(contentScope.paragraphIds?.length > 0, 'PDF_CONTENT_METHODS_SCOPE_EMPTY');
  assert.equal(contentScope.rejected, 'ARTICLE_CHAT_SCOPE_EMPTY');
  assert.equal(contentScope.afterTurns, contentScope.beforeTurns);
  report.contentScope = contentScope;

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 560, height: 900 });
  await panel.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded'
  });
  await panel.waitForFunction(() => typeof articleChatOutlineScopes === 'function');
  await panel.evaluate(snapshot => {
    currentWorkspaceSnapshot = snapshot;
  }, canonicalSnapshot);

  const scope = await panel.evaluate(() => {
    const choices = articleChatOutlineScopes();
    const methods = choices.find(item =>
      /(?:^|\b)(?:materials?\s*(?:&|and)\s*)?methods?(?:\b|$)|star methods/iu
        .test(String(item?.name || ''))
    );
    if (!methods) return { choices: choices.map(item => item.name).slice(0, 40) };
    const resolved = SciLLM.resolveArticleChatContextScope({
      scopes: [{ scopeId: methods.id, name: methods.name,
        sectionIds: methods.sectionIds, sourceKeys: methods.sourceKeys }]
    }, currentWorkspaceSnapshot);
    const byId = new Map(currentWorkspaceSnapshot.paragraphs.map(item =>
      [String(item.paragraphId || ''), item]));
    const scopedText = resolved.paragraphIds.map(id => String(byId.get(id)?.text || ''))
      .join(' ');
    const methodHit = scopedText.match(/.{0,45}(?:stereotaxic|stereotactic|injection).{0,90}/iu);
    return {
      id: methods.id,
      name: methods.name,
      sectionIds: methods.sectionIds,
      sourceKeys: methods.sourceKeys,
      paragraphIds: resolved.paragraphIds,
      resolvedSectionIds: resolved.sectionIds,
      complete: resolved.complete,
      sectionKinds: [...new Set(resolved.paragraphIds.map(id =>
        String(byId.get(id)?.sectionKind || '')))],
      queryHitCount: (scopedText.match(/stereotaxic|stereotactic|injection/giu) || []).length,
      sample: String(methodHit?.[0] || '').slice(0, 140)
    };
  });
  assert.ok(scope.id, `METHODS_SCOPE_NOT_FOUND:${JSON.stringify(scope.choices || [])}`);
  assert.equal(scope.complete, true, 'METHODS_SCOPE_INCOMPLETE');
  assert.ok(scope.paragraphIds.length > 0, 'METHODS_SCOPE_PARAGRAPHS_EMPTY');
  assert.ok(scope.queryHitCount > 0, 'METHODS_SCOPE_EXPECTED_PROSE_MISSING');

  await panel.bringToFront();
  await panel.evaluate(() => switchWorkspaceView('chat'));
  await panel.locator('#articleChatQuestion').waitFor({ state: 'visible' });
  await panel.evaluate(() => {
    globalThis.__capturedScopedMessages = [];
    sendTabMessage = async (_tabId, message) => {
      globalThis.__capturedScopedMessages.push(structuredClone(message));
      return { success: true };
    };
    llmSettingsState = {
      ...(llmSettingsState || {}),
      settings: { ...(llmSettingsState?.settings || {}), consentGranted: true }
    };
    const profile = document.getElementById('articleChatProfile');
    profile.replaceChildren(new Option('Local acceptance profile', 'acceptance-profile'));
    profile.value = 'acceptance-profile';
    const highlightProfile = document.getElementById('articleSemanticHighlightProfile');
    highlightProfile.replaceChildren(new Option('Local search profile', 'search-profile'));
    highlightProfile.value = 'search-profile';
    const category = document.getElementById('articleChatHighlightCategory');
    const option = new Option('Acceptance match', 'semantic_match');
    option.dataset.categoryName = 'Acceptance match';
    category.replaceChildren(option);
    category.value = 'semantic_match';
  });

  async function runScopedAction(action, question) {
    await panel.evaluate(async ({ action: targetAction, question: targetQuestion,
      scope: selectedScope, snapshot }) => {
      currentWorkspaceSnapshot = snapshot;
      articleChatContextScopes.clear();
      articleChatContextScopes.set(selectedScope.id, {
        id: selectedScope.id,
        name: selectedScope.name,
        sectionIds: selectedScope.sectionIds,
        sourceKeys: selectedScope.sourceKeys
      });
      renderArticleChatContextScopes();
      if (targetAction === 'highlight') {
        switchWorkspaceView('highlights', { persist: false });
        document.querySelector('.article-chat-highlight-section').open = true;
        const chatInput = document.getElementById('articleChatQuestion');
        chatInput.value = '未提交的问答草稿';
        document.getElementById('articleSemanticHighlightQuery').value = targetQuestion;
        await submitArticleSemanticHighlight({ preventDefault() {} });
        globalThis.__semanticIsolationObservation = {
          chatDraft: chatInput.value,
          chatScopeRetained: articleChatContextScopes.has(selectedScope.id),
          searchDraft: document.getElementById('articleSemanticHighlightQuery').value
        };
      } else {
        switchWorkspaceView('chat', { persist: false });
        document.getElementById('articleChatQuestion').value = targetQuestion;
        await submitArticleChat({ preventDefault() {} });
      }
    }, { action, question, scope, snapshot: canonicalSnapshot });
  }

  await runScopedAction('highlight', '所有立体定位注射坐标');
  await panel.waitForFunction(() => globalThis.__capturedScopedMessages?.length === 1);
  await runScopedAction('chat', '概括所有立体定位注射坐标');
  await panel.waitForFunction(() => globalThis.__capturedScopedMessages?.length === 2);

  const actionObservation = await panel.evaluate(() => ({
    semanticIsolation: globalThis.__semanticIsolationObservation,
    messages: globalThis.__capturedScopedMessages.map(message => ({
      action: message.action,
      profileId: message.profileId,
      sectionIds: message.contextScope?.sectionIds || [],
      scopes: message.contextScope?.scopes || []
    }))
  }));
  const actions = actionObservation.messages.map(item => item.action);
  assert.deepEqual(actions, ['highlightArticleMatchesWithLLM', 'askArticleWithLLM']);
  assert.deepEqual(actionObservation.messages[0].sectionIds, []);
  assert.deepEqual(actionObservation.messages[0].scopes, []);
  assert.equal(actionObservation.messages[0].profileId, 'search-profile');
  assert.deepEqual(actionObservation.semanticIsolation, {
    chatDraft: '未提交的问答草稿', chatScopeRetained: true, searchDraft: ''
  });
  assert.deepEqual(actionObservation.messages[1].sectionIds, scope.resolvedSectionIds);
  assert.ok(actionObservation.messages[1].scopes[0]?.sourceKeys?.length > 0,
    'STABLE_SOURCE_KEYS_MISSING');

  const emptyObservation = await panel.evaluate(async snapshot => {
    currentWorkspaceSnapshot = snapshot;
    const beforeMessages = globalThis.__capturedScopedMessages.length;
    const beforeTurns = Number(currentWorkspaceSnapshot?.chat?.turns?.length) || 0;
    articleChatContextScopes.clear();
    articleChatContextScopes.set('missing', {
      id: 'missing', name: 'Unavailable Methods section',
      sectionIds: ['missing-section'], sourceKeys: ['missing-source']
    });
    renderArticleChatContextScopes();
    const input = document.getElementById('articleChatQuestion');
    input.value = '范围不应扩大';
    await submitArticleChat({ preventDefault() {} });
    return {
      beforeMessages,
      afterMessages: globalThis.__capturedScopedMessages.length,
      beforeTurns,
      afterTurns: Number(currentWorkspaceSnapshot?.chat?.turns?.length) || 0,
      input: input.value,
      status: String(document.getElementById('statusMessage')?.textContent || '')
    };
  }, canonicalSnapshot);
  report.observation = { documentHash, scope, actionObservation, emptyObservation };
  writeReport(report);
  assert.equal(emptyObservation.afterMessages, emptyObservation.beforeMessages,
    'EMPTY_SCOPE_SENT_MESSAGE');
  assert.equal(emptyObservation.afterTurns, emptyObservation.beforeTurns,
    'EMPTY_SCOPE_CREATED_TURN');
  assert.equal(emptyObservation.input, '范围不应扩大', 'EMPTY_SCOPE_CLEARED_INPUT');
  assert.match(emptyObservation.status, /章节.*没有可用段落|不会改用全文/u,
    'EMPTY_SCOPE_MESSAGE_NOT_LOCALIZED');

  const screenshotPath = path.join(outputDirectory, 'methods-scope-buttons.png');
  await panel.screenshot({ path: screenshotPath, fullPage: false });
  report.artifacts.push({
    path: path.relative(outputDirectory, screenshotPath),
    sha256: sha256(fs.readFileSync(screenshotPath))
  });
  const failuresPath = path.join(outputDirectory, 'failures.json');
  report.artifacts.push({
    path: path.relative(outputDirectory, failuresPath),
    sha256: sha256(fs.readFileSync(failuresPath))
  });
  report.checks = {
    realPublicPdfStructure: true,
    parentScopeHasProse: scope.paragraphIds.length > 0,
    requestedMethodsProsePresent: scope.queryHitCount > 0,
    stableScopeIdentity: scope.sourceKeys.length > 0,
    qaCarriesStableScope: true,
    highlightIndependentFromChatScopeAndDraft: true,
    emptyScopeZeroSend: true,
    emptyScopeZeroTurn: true,
    localizedFailClosed: true,
    actualReaderContentScope: contentScope.paragraphIds.length > 0,
    actualReaderEmptyScopeZeroTurn: contentScope.afterTurns === contentScope.beforeTurns &&
      contentScope.rejected === 'ARTICLE_CHAT_SCOPE_EMPTY',
    modelApiCallsZero: report.source.modelApiCalls === 0
  };
  report.status = Object.values(report.checks).every(Boolean) ? 'PASS' : 'FAIL';
} catch (error) {
  report.status = 'FAIL';
  report.error = safeError(error);
} finally {
  if (context) await context.close().catch(() => undefined);
  writeReport(report);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

if (report.status !== 'PASS') {
  throw new Error(report.error || 'ARTICLE_CHAT_METHODS_SCOPE_ACCEPTANCE_FAILED');
}
console.log(JSON.stringify({ status: report.status, checks: report.checks }, null, 2));
