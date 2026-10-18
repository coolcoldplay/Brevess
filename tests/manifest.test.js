const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

function captureFirstImportScripts(source) {
  const sentinel = new Error('IMPORT_SCRIPTS_CAPTURED');
  let captured = null;
  try {
    vm.runInNewContext(String(source), {
      importScripts(...files) {
        captured = [...files];
        throw sentinel;
      }
    }, { filename: 'captured-background.js', timeout: 1000 });
  } catch (error) {
    if (error !== sentinel) throw error;
  }
  if (!captured) throw new Error('BACKGROUND_IMPORT_SCRIPTS_NOT_FOUND');
  return captured;
}

test('background import capture ignores comments and quote-style decoys', () => {
  const source = `
    // importScripts('ignored-comment.js');
    const decoy = "core/panel-ledger.js";
    importScripts(
      "core/panel-ledger.js",
      'core/evidence-first-mechanism.js',
      "core/cross-figure-logic.js"
    );
    importScripts('ignored-later.js');
  `;
  assert.deepEqual(captureFirstImportScripts(source), [
    'core/panel-ledger.js',
    'core/evidence-first-mechanism.js',
    'core/cross-figure-logic.js'
  ]);
});

test('manifest opens a deliberate action popup before native side-panel activation', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(manifest.name, '__MSG_extensionName__');
  assert.equal(manifest.description, '__MSG_extensionDescription__');
  assert.equal(manifest.default_locale, 'zh_CN');
  const zhMessages = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '_locales', 'zh_CN', 'messages.json'), 'utf8'
  ));
  const enMessages = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '_locales', 'en', 'messages.json'), 'utf8'
  ));
  assert.equal(zhMessages.extensionName.message, 'Brevess');
  assert.equal(enMessages.extensionName.message, 'Brevess');
  assert.ok(zhMessages.extensionDescription.message.length > 20);
  assert.ok(enMessages.extensionDescription.message.length > 60);
  assert.equal(manifest.version, '1.0.1');
  assert.equal(packageJson.name, 'brevess');
  assert.equal(packageJson.version, '1.0.1');
  assert.equal(packageJson.license, 'AGPL-3.0-or-later');
  const publicKey = Buffer.from(manifest.key, 'base64');
  assert.ok(publicKey.length > 256);
  const stableExtensionId = [...createHash('sha256').update(publicKey).digest().subarray(0, 16)]
    .map(byte => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join('');
  assert.equal(stableExtensionId, 'finhfnjbpidfakpmkghkfjlfcfpoandh');
  assert.equal(
    packageJson.repository.url,
    'git+https://github.com/coolcoldplay/Brevess.git'
  );
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.action.default_popup, 'action-popup.html');
  assert.deepEqual(manifest.side_panel, { default_path: 'popup.html' });
  assert.deepEqual(manifest.content_scripts, [{
    matches: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*', 'file:///*'],
    js: ['core/page-tools.js', 'semantic-find-launcher.js'], run_at: 'document_idle', all_frames: false
  }, {
    matches: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*', 'file:///*'],
    js: ['core/translation-source.js', 'core/translation-checkpoint.js', 'core/local-translator.js', 'core/bilingual-translation-controller.js', 'bilingual-translation-content.js'],
    css: ['bilingual-translation.css'], run_at: 'document_idle', all_frames: false
  }], 'J and Alt entry points are available before sidebar activation; neither starts a model on page load');
  assert.deepEqual(manifest.host_permissions, [
    'https://api.typesafe.ai/*',
    'https://*/*',
    'http://localhost/*',
    'http://127.0.0.1/*',
    'file:///*'
  ]);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.ok(manifest.permissions.includes('offscreen'));
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.ok(manifest.permissions.includes('nativeMessaging'));
  assert.ok(manifest.permissions.includes('webNavigation'),
    'committed document identity is required for durable provider-owner teardown');
  assert.ok(manifest.permissions.includes('unlimitedStorage'),
    'large local literature notes and annotations require quota-independent local storage');
});

test('manifest icon set uses square Brevess PNG assets at every declared size', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  for (const size of [16, 32, 48, 128]) {
    const relativePath = `icons/icon${size}.png`;
    assert.equal(manifest.icons[String(size)], relativePath);
    assert.equal(manifest.action.default_icon[String(size)], relativePath);
    const image = fs.readFileSync(path.join(__dirname, '..', relativePath));
    assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(image.readUInt32BE(16), size);
    assert.equal(image.readUInt32BE(20), size);
  }
});

test('Edge store release strips the local stable-ID key and verifies it cannot leak', () => {
  const buildScript = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'build-edge-store-release.ps1'),
    'utf8'
  );
  const verifyScript = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'verify-edge-store-release.ps1'),
    'utf8'
  );
  assert.match(
    buildScript,
    /\$storeManifest\.PSObject\.Properties\.Remove\('key'\)/
  );
  assert.match(
    buildScript,
    /\$storeManifestPath\s*=\s*Join-Path \$extensionStage 'manifest\.json'/
  );
  assert.match(
    verifyScript,
    /Microsoft Edge store ZIP manifest must not contain the key field/
  );
});

test('Edge permission disclosure explains unlimited local storage without broadening network access', () => {
  const disclosure = fs.readFileSync(path.join(
    __dirname, '..', 'docs', 'edge-store', 'PRIVACY_AND_PERMISSIONS.md'
  ), 'utf8');
  assert.match(disclosure, /`unlimitedStorage`/);
  assert.match(disclosure, /论文笔记.*标注|标注.*论文笔记/);
  assert.match(disclosure, /不(?:会|用于).*后台扫描/);
  assert.match(disclosure, /不(?:会|用于).*自动上传/);
  assert.match(disclosure, /不.*(?:扩大|增加).*host.*network|不.*(?:扩大|增加).*网络权限/i);
  assert.match(disclosure, /用户.*删除|删除.*用户/);
});

test('background worker keeps routed LLM operations alive until completion', () => {
  const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const backgroundScripts = captureFirstImportScripts(background);
  assert.match(
    background,
    /message\?\.type === 'LLM_FOUNDATION_STATUS'[\s\S]*?version:\s*'1\.0\.1'/
  );
  assert.match(background, /core\/service-worker-keepalive\.js/);
  assert.match(background, /SciLLM\.keepAliveUntil\(\s*handleRoutedMessage/);
  assert.match(background, /async function handleRoutedMessage\(/);
  const outlineModule = backgroundScripts.indexOf('core/review-outline.js');
  const pipelineModule = backgroundScripts.indexOf('core/review-outline-pipeline.js');
  const manualAnnotationsModule = backgroundScripts.indexOf('core/manual-annotations.js');
  const documentStoreModule = backgroundScripts.indexOf('core/document-store.js');
  const directorySyncModule = backgroundScripts.indexOf('core/directory-sync.js');
  const panelLedgerModule = backgroundScripts.indexOf('core/panel-ledger.js');
  const evidenceFirstMechanismModule = backgroundScripts.indexOf(
    'core/evidence-first-mechanism.js'
  );
  const crossFigureLogicModule = backgroundScripts.indexOf('core/cross-figure-logic.js');
  const operationControlModule = backgroundScripts.indexOf('core/operation-control.js');
  const analysisCacheModule = backgroundScripts.indexOf('core/analysis-cache.js');
  const mechanismOperationCoordinatorModule = backgroundScripts.indexOf(
    'core/mechanism-operation-coordinator.js'
  );
  const routerModule = backgroundScripts.indexOf('core/background-router.js');
  for (const modulePath of [
    'core/panel-ledger.js',
    'core/evidence-first-mechanism.js',
    'core/cross-figure-logic.js',
    'core/operation-control.js',
    'core/analysis-cache.js',
    'core/mechanism-operation-coordinator.js',
    'core/background-router.js'
  ]) {
    assert.equal(
      backgroundScripts.filter(file => file === modulePath).length,
      1,
      `${modulePath} must load exactly once in the background worker`
    );
  }
  assert.match(background, /core\/task-profile-router\.js/);
  assert.match(background, /core\/token-budget\.js/);
  assert.match(background, /core\/operation-control\.js/);
  assert.match(background, /LLM_CONTROL_OPERATION/);
  assert.ok(outlineModule >= 0 && outlineModule < routerModule);
  assert.ok(pipelineModule >= 0 && pipelineModule < routerModule);
  assert.ok(manualAnnotationsModule >= 0 && manualAnnotationsModule < documentStoreModule);
  assert.ok(documentStoreModule < directorySyncModule && directorySyncModule < routerModule);
  assert.ok(
    panelLedgerModule >= 0 &&
      panelLedgerModule < evidenceFirstMechanismModule &&
      evidenceFirstMechanismModule < crossFigureLogicModule,
    'evidence-first mechanism must load between the panel ledger and cross-figure logic'
  );
  assert.ok(
    operationControlModule >= 0 &&
      operationControlModule < mechanismOperationCoordinatorModule &&
      analysisCacheModule < mechanismOperationCoordinatorModule &&
      mechanismOperationCoordinatorModule < routerModule,
    'mechanism operation coordinator must load after its controls/cache and before the router'
  );
  assert.match(background, /LLM_ANALYZE_REVIEW_OUTLINE/);
  assert.match(background, /setPanelBehavior\(\{\s*openPanelOnActionClick:\s*false\s*\}\)/);
  assert.match(background, /core\/tab-activation\.js/);
  assert.match(background, /core\/tab-messenger\.js/);
  assert.doesNotMatch(background, /chrome\.action\.onClicked\.addListener/);
  assert.match(background, /message\?\.type === 'ACTION_POPUP_GET_STATE'/);
  assert.match(background, /message\?\.type === 'ACTION_POPUP_START_READING'/);
  assert.match(background, /markTabActivated/);
  assert.match(background, /chrome\.sidePanel\.open/);
  const popupStart = background.indexOf("message?.type === 'ACTION_POPUP_START_READING'");
  const popupStartEnd = background.indexOf("message?.type === 'SIDE_PANEL_RESTORE_FROM_USER_GESTURE'", popupStart);
  const popupStartHandler = background.slice(popupStart, popupStartEnd);
  assert.match(popupStartHandler, /beginToolbarSidePanelOpen\(tab\)/);
  assert.match(popupStartHandler, /handleToolbarAction\(tab,\s*panelOpen/);
  assert.ok(
    popupStartHandler.indexOf('beginToolbarSidePanelOpen(tab)') <
      popupStartHandler.indexOf('handleToolbarAction(tab, panelOpen'),
    'the side-panel open attempt must start before the popup message handler yields'
  );
  assert.ok(
    background.indexOf('chrome.sidePanel.open({ windowId: tab.windowId })') <
      background.indexOf('SciLLM.markTabActivated(chrome.storage.session, tab)'),
    'the global sidePanel.open must be invoked synchronously inside the toolbar user gesture'
  );
  assert.match(background, /chrome\.tabs\.onUpdated\.addListener/);
  const tabUpdatedStart = background.indexOf('chrome.tabs.onUpdated.addListener');
  const tabUpdatedEnd = background.indexOf('chrome.tabs.onRemoved.addListener', tabUpdatedStart);
  const tabUpdatedListener = background.slice(tabUpdatedStart, tabUpdatedEnd);
  assert.doesNotMatch(tabUpdatedListener, /sidePanel\.open|armTabSidePanelRestore/);
  assert.doesNotMatch(tabUpdatedListener, /clearTabActivation/);
  assert.match(background, /chrome\.tabs\.onActivated\.addListener/);
  const tabActivatedStart = background.indexOf('chrome.tabs.onActivated.addListener');
  const tabActivatedEnd = background.indexOf(
    'chrome.tabs.onUpdated.addListener', tabActivatedStart
  );
  const tabActivatedListener = background.slice(tabActivatedStart, tabActivatedEnd);
  assert.match(tabActivatedListener, /syncTabSidePanelAvailability/);
  assert.doesNotMatch(tabActivatedListener, /sidePanel\.open|armTabSidePanelRestore/);
  assert.match(background, /async function ensureGlobalSidePanelAvailability/);
  assert.match(background, /current\.enabled === true/);
  assert.match(background, /setGlobalSidePanelAvailability\(true\)/);
  assert.match(background, /async function repairLegacyTabSidePanelOptions/);
  assert.match(
    background,
    /chrome\.sidePanel\.setOptions\(\{\s*tabId,[\s\S]*?path:\s*'popup\.html',[\s\S]*?enabled:\s*true/
  );
  assert.match(
    background,
    /onInstalled\.addListener\([\s\S]*?repairAllLegacyTabSidePanelOptions/
  );
  assert.match(
    background,
    /onStartup\.addListener\([\s\S]*?repairAllLegacyTabSidePanelOptions/
  );
  assert.match(background, /const activatedSidePanelTabIds = new Set\(\)/);
  assert.match(background, /message\?\.type === 'SIDE_PANEL_DOCUMENT_READY'/);
  assert.match(background, /message\?\.type === 'SIDE_PANEL_ACTIVATE_CURRENT_TAB'/);
  assert.match(background, /activateTabFromOpenSidePanel/);
  assert.match(background, /activatePdfReaderAndOpenSidePanel\(tab, panelOpen\)/);
  assert.match(background, /shouldArmRestore: false/);
  assert.match(content, /window\.addEventListener\('pageshow', announceSidePanelDocumentReady, true\)/);
  assert.match(content, /type: 'SIDE_PANEL_DOCUMENT_READY'/);
  assert.match(content, /response\.shouldArmRestore/);
  assert.match(background, /SIDE_PANEL_RESTORE_FROM_USER_GESTURE/);
  assert.match(background, /chrome\.sidePanel\.open\(\{ windowId: sender\.tab\.windowId \}\)/);
  assert.match(background, /activatedSidePanelTabIds\.delete\(tabId\)/);
  assert.match(background, /chrome\.sidePanel\.setOptions\(\{[\s\S]*enabled:/);
  assert.match(background, /isTabActivated\(chrome\.storage\.session, tab\)/);
  assert.match(background, /chrome\.tabs\.onRemoved\.addListener/);
  assert.match(background, /chrome\.runtime\.onInstalled\.addListener/);
  assert.match(background, /chrome\.runtime\.onStartup\.addListener/);
  assert.match(background, /core\/onboarding\.js/);
  assert.match(background, /options\.html#onboarding/);
  assert.doesNotMatch(
    background,
    /ACTION_POPUP_START_READING[\s\S]{0,1200}shouldStartOnboarding/,
    'explicit reading activation must not be redirected into onboarding'
  );
  assert.match(background, /ONBOARDING_PREPARE_FINISH/);
  assert.match(
    background,
    /ONBOARDING_PREPARE_FINISH[\s\S]*ensureGlobalSidePanelAvailability\(\)[\s\S]*prepared: true/
  );
  assert.match(background, /ONBOARDING_FINISH/);
  assert.match(background, /async function resolveOnboardingSourceTab\(/);
  assert.match(background, /activatedSidePanelTabIds\.has\(tab\.id\)/);
  assert.match(background, /rightPreferred - leftPreferred/);
  assert.match(background, /Number\(right\.lastAccessed\)/);
  assert.match(
    background,
    /ONBOARDING_RESTART[\s\S]*resolveOnboardingSourceTab\(message\.sourceTab \|\| \{\}, sender\.tab\?\.windowId\)/
  );
  assert.doesNotMatch(
    background,
    /onInstalled\.addListener\([\s\S]{0,500}options\.html#onboarding|onStartup\.addListener\([\s\S]{0,500}options\.html#onboarding/
  );
});

test('background wires committed-document and tab-removal owner teardown through keepalive', async () => {
  const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  const start = background.indexOf('function commitTrustedNavigationOwner');
  const end = background.indexOf('const portableConfigStorageChangeListener', start);
  assert.ok(start >= 0 && end > start);
  const listeners = {};
  const routerCommits = [];
  const serviceCommits = [];
  const routerRetirements = [];
  const serviceRetirements = [];
  const pending = [];
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  };
  const routerCommitGate = deferred();
  const serviceCommitGate = deferred();
  const routerRetirementGate = deferred();
  const serviceRetirementGate = deferred();
  let completedKeepalives = 0;
  const context = {
    Promise,
    ttsRouter: { commitDocument() {}, retireTab() {} },
    llmRouter: {
      async commitTrustedDocument(value) {
        routerCommits.push(value);
        await routerCommitGate.promise;
        return { cleaned: 0 };
      },
      async retireTrustedTab(value) {
        routerRetirements.push(value);
        await routerRetirementGate.promise;
        return { cleaned: 0 };
      }
    },
    semanticFindService: {
      async commitTrustedDocument(value) {
        serviceCommits.push(value);
        await serviceCommitGate.promise;
        return { cancelled: 0 };
      },
      async retireTrustedTab(value) {
        serviceRetirements.push(value);
        await serviceRetirementGate.promise;
        return { cancelled: 0 };
      }
    },
    SciLLM: {
      keepAliveUntil(promise) {
        const tracked = Promise.resolve(promise).then(value => {
          completedKeepalives += 1;
          return value;
        });
        pending.push(tracked);
        return tracked;
      }
    },
    chrome: {
      runtime: { id: 'runtime-id' },
      webNavigation: {
        onCommitted: { addListener(listener) { listeners.committed = listener; } },
        onHistoryStateUpdated: { addListener() { listeners.history = true; } }
      },
      tabs: { onRemoved: { addListener(listener) { listeners.removed = listener; } } }
    }
  };
  vm.runInNewContext(background.slice(start, end), context, {
    filename: 'background-owner-lifecycle.js'
  });
  assert.equal(typeof listeners.committed, 'function');
  assert.equal(typeof listeners.removed, 'function');
  assert.equal(listeners.history, undefined,
    'history-only navigation must retain the same document owner');
  listeners.committed({
    tabId: 19, frameId: 2,
    documentId: '19191919-1919-4919-8919-191919191919'
  });
  listeners.committed({ tabId: 19, frameId: 2, documentId: '' });
  listeners.removed(19);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(completedKeepalives, 1,
    'the ignored invalid document decision may settle independently');
  routerCommitGate.resolve();
  routerRetirementGate.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(completedKeepalives, 1,
    'keepalive must still await semantic-find owner retirement');
  serviceCommitGate.resolve();
  serviceRetirementGate.resolve();
  await Promise.all(pending);
  const committedOwner = {
    senderExtensionId: 'runtime-id', senderTabId: 19, senderFrameId: 2,
    senderDocumentId: '19191919-1919-4919-8919-191919191919'
  };
  const retiredOwner = {
    senderExtensionId: 'runtime-id', senderTabId: 19
  };
  assert.deepEqual(JSON.parse(JSON.stringify(routerCommits)), [committedOwner]);
  assert.deepEqual(JSON.parse(JSON.stringify(serviceCommits)), [committedOwner]);
  assert.deepEqual(JSON.parse(JSON.stringify(routerRetirements)), [retiredOwner]);
  assert.deepEqual(JSON.parse(JSON.stringify(serviceRetirements)), [retiredOwner]);
  assert.equal(completedKeepalives, 3);
  assert.equal(pending.length, 3,
    'valid mutations and the bounded ignored-event decision stay inside keepalive');
});

test('action popup exposes three privacy-safe reading choices', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'action-popup.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'action-popup.css'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'action-popup.js'), 'utf8');
  const verifier = fs.readFileSync(
    path.join(root, 'scripts', 'verify-action-popup-extension.mjs'), 'utf8'
  );

  for (const id of ['startReading', 'openHistory', 'openSettings']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /开始研读/);
  assert.match(html, /查看历史/);
  assert.match(html, /打开设置/);
  assert.match(script, /ACTION_POPUP_GET_STATE/);
  assert.match(script, /ACTION_POPUP_START_READING/);
  assert.match(script, /bootstrapInterfaceLanguage/);
  assert.match(script, /options\.html#page=data/);
  assert.match(script, /options\.html#page=overview/);
  assert.doesNotMatch(script, /apiKey|articleText|canonicalSnapshot/i);
  assert.match(html, /vendor\/phosphor\/icons\.css/);
  assert.match(html, /core\/i18n\.js/);
  assert.match(html, /ph-compass/);
  assert.match(html, /ph-database/);
  assert.match(html, /ph-gear/);
  assert.doesNotMatch(html, /准备研读入口|点击后才会激活当前页面/);
  assert.match(html, /id="pageStatus"[^>]*hidden/);
  assert.ok(html.indexOf('id="pageStatus"') > html.indexOf('action-popup__actions'));
  assert.match(script, /pageStatus\.hidden\s*=\s*!normalized/);
  assert.match(css, /html,\s*body\s*\{[^}]*width:\s*360px/s);
  assert.match(css, /html,\s*body\s*\{[^}]*min-width:\s*360px/s);
  assert.match(css, /html,\s*body\s*\{[^}]*max-width:\s*360px/s);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /\.action-popup\s*\{[^}]*box-sizing:\s*border-box/s);
  assert.match(css, /\.action-popup\s*\{[^}]*width:\s*360px/s);
  assert.match(css, /\.action-popup\s*\{[^}]*padding:\s*16px/s);
  assert.match(css, /\.action-popup__actions\s*\{[^}]*gap:\s*10px/s);
  assert.match(css, /\.action-popup__button\s*\{[^}]*min-height:\s*64px/s);
  assert.match(css, /\.action-popup__button\s*\{[^}]*padding:\s*12px/s);
  assert.match(css, /\.action-popup__button\s*\{[^}]*column-gap:\s*12px/s);
  assert.match(
    css,
    /\.action-popup__button-copy strong,\s*\.action-popup__button-copy small\s*\{[^}]*min-width:\s*0[^}]*white-space:\s*nowrap[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*overflow-wrap:\s*normal/s
  );
  // Native popup sizing must not depend on its previous viewport dimensions.
  assert.doesNotMatch(css, /@media\s*\(max-width:/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(verifier, /chrome\.action\.openPopup\(\)/);
  assert.match(
    verifier,
    /waitForEvent\('page',[\s\S]*?page\.url\(\)\.includes\('\/action-popup\.html'\)/
  );
  assert.doesNotMatch(verifier, /\.goto\([^)]*action-popup\.html/s);
  assert.doesNotMatch(verifier, /viewport:\s*\{\s*width:\s*420/);
  assert.match(verifier, /process\.env\.HEADLESS\s*===\s*'0'/);
  assert.match(verifier, /normalMetrics/);
  assert.match(verifier, /longLabelMetrics/);
  assert.match(verifier, /titleLines/);
  assert.match(verifier, /subtitleLines/);
  assert.match(verifier, /scrollWidth\s*>\s*\w+\.clientWidth/);
  assert.match(verifier, /normalMetrics\.popupPadding[\s\S]*?>=\s*16/);
  assert.match(verifier, /cardVerticalGaps/);
  assert.match(verifier, /Math\.abs\(gap\s*-\s*10\)\s*<=/);
  assert.match(verifier, /longLabelMetrics\.cards\.every/);
  assert.doesNotMatch(verifier, /longLabelMetrics\.cards\.some/);
  assert.match(verifier, /Target\.setDiscoverTargets/);
  assert.match(verifier, /Target\.targetCreated/);
  assert.match(verifier, /Target\.attachToTarget/);
  assert.match(verifier, /Page\.captureScreenshot/);
  assert.match(verifier, /targetDiagnostics/);
  assert.match(verifier, /Runtime\.evaluate[\s\S]*?userGesture:\s*true/);
  assert.match(verifier, /process\.env\.MANUAL_ACTION\s*===\s*'1'/);
  assert.match(verifier, /MANUAL_ACTION_READY/);
  assert.match(verifier, /manualActionTimeoutMs/);
  assert.match(
    verifier,
    /if\s*\(!manualAction\)[\s\S]*?chrome\.action\.openPopup\(\)/
  );
  assert.match(verifier, /action-popup-toolbar\.png/);
});

test('production workflow contains no classifier or secondary-type UI remnants', () => {
  const root = path.join(__dirname, '..');
  const production = [
    'popup.html', 'popup.js', 'content.js', 'background.js', 'core/background-router.js'
  ].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.doesNotMatch(
    production,
    /正在识别论文类型|已识别论文类型|分类置信度|secondaryStudyType|secondaryTypeName|LLM_SAVE_STUDY_TYPE_OVERRIDE|classifyStudyDocument/
  );
});

test('Chinese user documents cover the current manual, rule, and local-data workflows', () => {
  const root = path.join(__dirname, '..');
  for (const filename of ['README.md', '使用教程.md']) {
    const document = fs.readFileSync(path.join(root, filename), 'utf8');
    for (const pattern of [
      /不再要求先选择论文类型|不要求先选择文献类型/,
      /分析模式.*活动类别/s,
      /查看\/编辑规则.*提示词.*正则/s,
      /同一段落.*荧光笔.*类别.*备注/s,
      /自动.*粗下划线.*手动.*荧光笔/s,
      /清除自动高亮.*清除手动标注/s,
      /待重新定位.*不代表.*删除/s,
      /待同步.*不代表.*删除/s,
      /选择目录.*重新授权.*立即同步.*从目录重建.*导出 JSON 备份/s,
      /API Key.*Provider 鉴权头.*分析缓存.*目录句柄.*不会/s,
      /内存.*当前页面.*持久化.*待同步队列.*合并/s
    ]) assert.match(document, pattern, `${filename} is missing ${pattern}`);
    assert.doesNotMatch(
      document,
      /识别论文类型|主要\/次要|次要类型|自动(?:论文|研究)类型预识别|自动识别.{0,8}(?:论文|研究)类型/
    );
  }
});

test('provider networking runs in an offscreen dedicated worker', () => {
  const root = path.join(__dirname, '..');
  const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  const offscreenHtml = path.join(root, 'offscreen.html');
  const offscreenScript = path.join(root, 'offscreen.js');
  const networkWorker = path.join(root, 'offscreen-network-worker.js');
  assert.match(background, /core\/offscreen-fetch\.js/);
  assert.match(background, /createOffscreenFetch\(chrome\)/);
  assert.match(background, /fetchImpl:\s*providerFetch/);
  assert.equal(fs.existsSync(offscreenHtml), true);
  assert.equal(fs.existsSync(offscreenScript), true);
  assert.equal(fs.existsSync(networkWorker), true);
  if (!fs.existsSync(offscreenScript) || !fs.existsSync(networkWorker)) return;
  assert.match(fs.readFileSync(offscreenScript, 'utf8'), /new Worker\(['"]offscreen-network-worker\.js['"]\)/);
  const workerSource = fs.readFileSync(networkWorker, 'utf8');
  assert.match(workerSource, /await fetch\(/);
  assert.match(workerSource, /await response\.text\(\)/);
});
