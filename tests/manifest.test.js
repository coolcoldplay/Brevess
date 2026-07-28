const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

test('manifest opens an action-activated native side panel and injects extraction on demand', () => {
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
  assert.equal(manifest.version, '1.0.0');
  assert.equal(packageJson.name, 'brevess');
  assert.equal(packageJson.version, '1.0.0');
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
  assert.equal(manifest.action.default_popup, undefined);
  assert.deepEqual(manifest.side_panel, { default_path: 'popup.html' });
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.host_permissions, [
    'https://*/*',
    'http://localhost/*',
    'http://127.0.0.1/*'
  ]);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.ok(manifest.permissions.includes('offscreen'));
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.ok(manifest.permissions.includes('nativeMessaging'));
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

test('background worker keeps routed LLM operations alive until completion', () => {
  const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  assert.match(
    background,
    /message\?\.type === 'LLM_FOUNDATION_STATUS'[\s\S]*?version:\s*'1\.0\.0'/
  );
  assert.match(background, /core\/service-worker-keepalive\.js/);
  assert.match(background, /SciLLM\.keepAliveUntil\(\s*handleRoutedMessage/);
  assert.match(background, /async function handleRoutedMessage\(/);
  const outlineModule = background.indexOf("'core/review-outline.js'");
  const pipelineModule = background.indexOf("'core/review-outline-pipeline.js'");
  const manualAnnotationsModule = background.indexOf("'core/manual-annotations.js'");
  const documentStoreModule = background.indexOf("'core/document-store.js'");
  const directorySyncModule = background.indexOf("'core/directory-sync.js'");
  const routerModule = background.indexOf("'core/background-router.js'");
  assert.match(background, /core\/task-profile-router\.js/);
  assert.match(background, /core\/token-budget\.js/);
  assert.match(background, /core\/operation-control\.js/);
  assert.match(background, /LLM_CONTROL_OPERATION/);
  assert.ok(outlineModule >= 0 && outlineModule < routerModule);
  assert.ok(pipelineModule >= 0 && pipelineModule < routerModule);
  assert.ok(manualAnnotationsModule >= 0 && manualAnnotationsModule < documentStoreModule);
  assert.ok(documentStoreModule < directorySyncModule && directorySyncModule < routerModule);
  assert.match(background, /LLM_ANALYZE_REVIEW_OUTLINE/);
  assert.match(background, /setPanelBehavior\(\{\s*openPanelOnActionClick:\s*false\s*\}\)/);
  assert.match(background, /core\/tab-activation\.js/);
  assert.match(background, /core\/tab-messenger\.js/);
  assert.match(background, /chrome\.action\.onClicked\.addListener/);
  assert.match(background, /markTabActivated/);
  assert.match(background, /chrome\.sidePanel\.open/);
  const actionListenerStart = background.indexOf('chrome.action.onClicked.addListener(tab => {');
  const actionListenerEnd = background.indexOf('\n});', actionListenerStart);
  const actionListener = background.slice(actionListenerStart, actionListenerEnd);
  assert.match(actionListener, /beginToolbarSidePanelOpen\(tab\)/);
  assert.match(actionListener, /handleToolbarAction\(tab,\s*panelOpen/);
  assert.ok(
    actionListener.indexOf('beginToolbarSidePanelOpen(tab)') <
      actionListener.indexOf('handleToolbarAction(tab, panelOpen'),
    'the side-panel open attempt must start before any asynchronous onboarding lookup'
  );
  assert.doesNotMatch(actionListener, /\bawait\b/);
  assert.ok(
    background.indexOf('chrome.sidePanel.open({ windowId: tab.windowId })') <
      background.indexOf('SciLLM.markTabActivated(chrome.storage.session, tab)'),
    'the global sidePanel.open must be invoked synchronously inside the toolbar user gesture'
  );
  assert.match(background, /chrome\.tabs\.onUpdated\.addListener/);
  const tabUpdatedStart = background.indexOf('chrome.tabs.onUpdated.addListener');
  const tabUpdatedEnd = background.indexOf('chrome.tabs.onRemoved.addListener', tabUpdatedStart);
  const tabUpdatedListener = background.slice(tabUpdatedStart, tabUpdatedEnd);
  assert.match(tabUpdatedListener, /ensureGlobalSidePanelAvailability/);
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
  assert.match(background, /shouldStartOnboarding/);
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
