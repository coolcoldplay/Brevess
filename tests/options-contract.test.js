const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('registers an LLM settings page with private credential controls', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const html = read('options.html');
  assert.equal(manifest.options_ui.page, 'options.html');
  assert.match(html, /id="providerId"/);
  assert.match(html, /id="apiKey"[^>]*type="password"|type="password"[^>]*id="apiKey"/);
  assert.match(html, /id="model"/);
  assert.match(html, /id="consentGranted"/);
  assert.match(html, /id="testProvider"/);
});

test('settings header uses the Brevess logo and brand line', () => {
  const html = read('options.html');
  const styles = read('options.css');
  assert.match(html, /class="brand-mark" src="icons\/icon128\.png"/);
  assert.match(html, /<strong>Brevess<\/strong>/);
  assert.match(html, /Brevity · Evidence · Essence/);
  assert.match(styles, /\.brand-mark\s*\{[^}]*object-fit:\s*contain/s);
  assert.doesNotMatch(html, /class="brand-mark"[^>]*>SL</);
});

test('exposes named API profiles, token policy, and task routing controls', () => {
  const html = read('options.html');
  const script = read('options.js');
  [
    'apiProfileList', 'addApiProfile', 'duplicateApiProfile', 'deleteApiProfile',
    'profileName', 'globalProfileId', 'routeHighlight', 'routeSummary',
    'routeFigure', 'routeCrossFigure', 'tokenModeAuto', 'tokenModeManual',
    'autoTokenCap', 'manualMaxTokens', 'contextWindowTokens'
  ].forEach(id => assert.match(html, new RegExp(`id="${id}"`)));
  assert.doesNotMatch(html, /id="maxOutputTokens"/);
  const editorStart = html.indexOf('class="api-profile-editor"');
  const editorEnd = html.indexOf('task-routing-section');
  assert.ok(editorStart >= 0 && editorEnd > editorStart);
  const editor = html.slice(editorStart, editorEnd);
  ['providerId', 'model', 'apiKey', 'compatibleFields', 'compatiblePreset']
    .forEach(id => assert.match(editor, new RegExp(`id="${id}"`)));
  ['LLM_SAVE_PROFILE', 'LLM_UPDATE_PROFILE_ROUTING', 'LLM_DUPLICATE_PROFILE',
    'LLM_DELETE_PROFILE'].forEach(type => assert.match(script, new RegExp(type)));
  assert.match(script, /将只依据图注和正文解读/);
  assert.match(html, /根据任务路由.*第三方模型服务/);
  assert.match(html, /上下文窗口.*高级/);
  assert.match(script, /contextWindowTokens/);
});

test('settings load the unified IndexedDB schema before directory persistence', () => {
  const html = read('options.html');
  const database = html.indexOf('core/user-data-database.js');
  const directory = html.indexOf('core/directory-sync.js');
  const application = html.indexOf('options.js');
  assert.ok(database >= 0, 'settings must load the shared user-data database module');
  assert.ok(database < directory, 'database schema must load before directory sync');
  assert.ok(directory < application, 'directory sync must load before settings behavior');
});

test('settings expose full CRUD for named Panel follow-up presets', () => {
  const html = read('options.html');
  const script = read('options.js');
  [
    'panelFollowupPresetList', 'addPanelFollowupPreset', 'resetPanelFollowupPrompts'
  ].forEach(id => assert.match(html, new RegExp(`id="${id}"`)));
  assert.match(script, /function collectPanelFollowupPresets\(/);
  assert.match(script, /function renderPanelFollowupPresets\(/);
  assert.match(script, /dataDeletePanelPreset|deletePanelPreset|deletePanelPreset/i);
  assert.match(script, /figurePanelFollowupPresets/);
  assert.match(script, /figurePanelFollowupPrompts/);
});

test('settings manage custom analysis modes, chat prompts, module transfer, and language', () => {
  const html = read('options.html');
  const script = read('options.js');
  [
    'analysisModeSettings', 'analysisModeList', 'analysisModeCategoryList',
    'addAnalysisMode', 'deleteAnalysisMode', 'saveAnalysisModes',
    'articleChatQuickPromptList', 'addArticleChatQuickPrompt',
    'exportCategoryModule', 'importCategoryModule', 'globalLanguage'
  ].forEach(id => assert.match(html, new RegExp(`id="${id}"`)));
  assert.match(html, /data-settings-nav="modes"/);
  assert.match(html, /core\/i18n\.js/);
  assert.match(script, /function saveAnalysisModes\(/);
  assert.match(script, /function collectArticleChatQuickPrompts\(/);
  assert.match(script, /function exportCategoryModule\(/);
  assert.match(script, /function importCategoryModule\(/);
  assert.match(script, /schema:\s*'sci-category-module'/);
  assert.match(script, /preferences:\s*\{\s*language\s*\}/);
});

test('Panel follow-up history is rendered in reachable expanded prior rounds', () => {
  const popup = read('popup.js');
  const css = read('popup.css');
  const helperStart = popup.indexOf('function appendPanelFollowupHistory(');
  const controlStart = popup.indexOf('function createPanelFollowupControl(', helperStart);
  const editableStart = popup.indexOf('function isEditableKeyboardTarget(', controlStart);
  const helper = popup.slice(helperStart, controlStart);
  const control = popup.slice(controlStart, editableStart);
  const editableEnd = popup.indexOf('\nfunction ', editableStart + 1);
  const editable = popup.slice(editableStart, editableEnd);
  assert.ok(helperStart >= 0 && controlStart > helperStart);
  assert.match(helper, /panelFollowupHistories/);
  assert.match(helper, /document\.createElement\('details'\)/);
  assert.match(helper, /details\.open = true/);
  assert.match(helper, /历史追问/);
  assert.match(helper, /priorHistory/);
  assert.match(helper, /workspace-panel-followup-history-round/);
  assert.match(control, /appendPanelFollowupHistory\(root, figure, panelId, answer\)/);
  assert.doesNotMatch(editable, /panelFollowupHistories|priorHistory/);
  assert.match(css, /\.workspace-panel-followup-history/);
  assert.match(css, /\.workspace-panel-followup-history-round/);
});

test('route renderer trusts normalized state routes and does not restore stale UI selections', () => {
  const script = read('options.js');
  const start = script.indexOf('function renderRouteOptions(');
  const end = script.indexOf('\nfunction renderFigureRouteWarning', start);
  const renderer = script.slice(start, end);
  assert.doesNotMatch(renderer, /if\s*\(!select\.value\s*&&\s*current[\s\S]*select\.value\s*=\s*current/);
});

test('profile editor guards unsaved navigation and exposes a reusable in-flight action guard', () => {
  const script = read('options.js');
  assert.match(script, /let profileEditorDirty\s*=\s*false/);
  assert.match(script, /function canLeaveProfileEditor\(/);
  assert.match(script, /canLeaveProfileEditor\(/);
  assert.match(script, /profileActionInFlight/);
  assert.match(script, /function beginProfileAction\(/);
  assert.match(script, /function endProfileAction\(/);
  assert.match(script, /profileMutationInFlight/);
  assert.match(script, /function beginProfileMutation\(/);
  assert.match(script, /function endProfileMutation\(/);
  assert.match(script, /globalProfileId[\s\S]*markProfileEditorDirty/);
  assert.match(script, /routeHighlight[\s\S]*markProfileEditorDirty/);
  assert.match(script, /canLeaveProfileEditor\(['"]切换/);
});

test('profile save snapshots auto-analysis before async state re-rendering', () => {
  const script = read('options.js');
  const start = script.indexOf('async function persistForm(');
  const end = script.indexOf('\nasync function testProvider', start);
  const persist = script.slice(start, end);
  const snapshotIndex = persist.indexOf(
    "autoAnalyze: document.getElementById('autoAnalyze').checked"
  );
  const firstAwaitIndex = persist.indexOf('await requestEndpointPermission');
  const updateIndex = persist.indexOf("type: 'LLM_UPDATE_PREFERENCES'");
  assert.ok(start >= 0 && end > start);
  assert.ok(snapshotIndex >= 0);
  assert.ok(firstAwaitIndex > snapshotIndex);
  assert.ok(updateIndex > firstAwaitIndex);
  assert.match(persist, /type: 'LLM_UPDATE_PREFERENCES',[\s\S]*preferences\s*\n/);
  assert.equal((persist.match(/document\.getElementById\('autoAnalyze'\)\.checked/g) || []).length, 1);
});

test('settings expose and persist default-on Figure original caching', () => {
  const html = read('options.html');
  const script = read('options.js');
  assert.match(html, /id="autoCacheFigureImages"[^>]*checked/);
  assert.match(
    script,
    /autoCacheFigureImages:\s*document\.getElementById\('autoCacheFigureImages'\)\.checked/
  );
  assert.match(
    script,
    /state\.settings\?\.autoCacheFigureImages !== false/
  );
});

test('settings expose a validated customizable keyboard shortcut workspace', () => {
  const html = read('options.html');
  const script = read('options.js');
  const css = read('options.css');
  assert.match(html, /href="#keyboardShortcuts"/);
  assert.match(html, /id="keyboardShortcuts"/);
  assert.match(html, /id="keyboardShortcutGrid"/);
  assert.match(html, /id="saveKeyboardShortcuts"/);
  assert.match(html, /id="resetKeyboardShortcuts"/);
  assert.match(html, /core\/keyboard-shortcuts\.js/);
  assert.match(script, /function renderKeyboardShortcutSettings/);
  assert.match(script, /function collectKeyboardShortcutSettings/);
  assert.match(script, /findKeyboardShortcutConflicts/);
  assert.match(script, /preferences:\s*\{\s*keyboardShortcuts\s*\}/);
  assert.match(css, /\.keyboard-shortcut-grid/);
  assert.match(css, /\.keyboard-shortcut-row/);
});

test('settings are split into top-level pages and expose full custom-category CRUD', () => {
  const html = read('options.html');
  const script = read('options.js');
  const css = read('options.css');
  for (const page of ['categories', 'models', 'shortcuts', 'data', 'about']) {
    assert.match(html, new RegExp(`data-settings-nav="${page}"`));
    assert.match(html, new RegExp(`data-settings-page="${page}"`));
  }
  assert.match(script, /function activateSettingsPage/);
  assert.match(html, /id="addCustomCategory"/);
  assert.match(html, /id="deleteSelectedCategory"/);
  assert.match(script, /function deleteCategory/);
  assert.match(script, /CATEGORY_DELETE/);
  assert.match(script, /CATEGORY_RESTORE_BUILT_IN/);
  assert.match(html, /id="deletedBuiltInCategoriesList"/);
  assert.match(script, /function renderDeletedBuiltInCategories/);
  assert.match(css, /\.category-title-delete/);
  assert.match(css, /\.page-nav button\[aria-selected="true"\]/);
});

test('settings UI uses background messages and never sync storage', () => {
  const script = read('options.js');
  assert.match(script, /LLM_GET_SETTINGS/);
  assert.match(script, /LLM_SAVE_PROVIDER/);
  assert.match(script, /LLM_TEST_PROVIDER/);
  assert.match(script, /chrome\.permissions\.request/);
  assert.doesNotMatch(script, /storage\.sync/);
});

test('settings UI can inspect and export the local feedback corpus', () => {
  const html = read('options.html');
  const script = read('options.js');
  assert.match(html, /id="corpusStats"/);
  assert.match(html, /id="exportCorpusJsonl"/);
  assert.match(html, /id="exportCorpusCsv"/);
  assert.match(html, /id="distillRules"/);
  assert.match(script, /LLM_CORPUS_STATUS/);
  assert.match(script, /LLM_EXPORT_CORPUS/);
  assert.match(script, /LLM_DISTILL_RULES/);
  assert.match(script, /URL\.createObjectURL/);
});

test('feedback email lives in settings instead of the analysis workspace', () => {
  const options = read('options.html');
  const popup = read('popup.html');
  assert.match(options, /id="support"/);
  assert.match(options, /mailto:brevess0729@163\.com/);
  assert.doesNotMatch(popup, /mailto:|contact-email/);
});

test('settings expose the AGPL license, public source, and third-party notices', () => {
  const options = read('options.html');
  assert.match(options, /id="openSource"/);
  assert.match(options, /AGPL-3\.0-or-later/);
  assert.match(options, /https:\/\/github\.com\/coolcoldplay\/Brevess/);
  assert.match(options, /href="LICENSE"/);
  assert.match(options, /href="THIRD_PARTY_NOTICES\.md"/);
  assert.match(options, /不提供任何明示或默示担保/);
});

test('settings UI manages saved and one-off custom LLM categories', () => {
  const html = read('options.html');
  const script = read('options.js');
  assert.match(html, /id="customCategoryName"/);
  assert.match(html, /id="customCategoryDefinition"/);
  assert.match(html, /id="customCategoryPersistence"/);
  assert.match(html, /id="customCategoriesList"/);
  assert.match(script, /LLM_SAVE_CUSTOM_CATEGORY/);
  assert.match(script, /LLM_DELETE_CUSTOM_CATEGORY/);
});

test('first successful credential setup prefers automatic LLM mode', () => {
  const script = read('options.js');
  assert.match(script, /firstConfiguration/);
  assert.match(script, /firstConfiguration[^\n]*consent|consent[^\n]*firstConfiguration/);
});

test('compatible provider exposes an explicit vision capability opt-in', () => {
  const html = read('options.html');
  const script = read('options.js');
  assert.match(html, /id="supportsVision"[^>]*type="checkbox"|type="checkbox"[^>]*id="supportsVision"/);
  assert.match(script, /config\.supportsVision\s*=\s*document\.getElementById\('supportsVision'\)\.checked/);
  assert.match(script, /document\.getElementById\('supportsVision'\)\.checked\s*=\s*config\.supportsVision\s*===\s*true/);
});

test('category workspace uses a compact rail and one inspector with deep-navy visual tokens', () => {
  const html = read('options.html');
  const css = read('options.css');
  assert.match(html, /id="categoryWorkspace"/);
  assert.match(html, /id="categorySearch"/);
  assert.match(html, /id="categoryList"/);
  assert.match(html, /id="categoryInspector"/);
  assert.match(html, /id="categoryInspectorTitle"/);
  assert.match(css, /--navy:\s*#0B4778/i);
  assert.match(css, /\.category-workspace\s*\{[^}]*grid-template-columns:/s);
  assert.match(css, /@media\s*\(max-width:[^)]+\)[\s\S]*\.category-workspace\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test('profile editor actions remain usable on narrow screens', () => {
  const css = read('options.css');
  assert.match(css, /@media\s*\(max-width:620px\)[\s\S]*\.profile-editor-heading/);
  assert.match(css, /\.profile-editor-actions\s*\{[^}]*flex-wrap:\s*wrap/);
});

test('category inspector exposes accessible prompt and regex tabs and every editable field', () => {
  const html = read('options.html');
  ['categoryPromptTab', 'categoryRegexTab', 'categoryPromptPanel', 'categoryRegexPanel',
    'categoryName', 'categoryColor', 'categoryEngineLlm', 'categoryEngineRegex',
    'categoryDefinition', 'categoryDecisionQuestion', 'categoryIncludeWhen',
    'categoryExcludeWhen', 'categoryPositiveExamples', 'categoryNegativeExamples',
    'categoryRequiredSlots', 'categoryAllowedQuoteRoles', 'categorySpanPolicy',
    'categoryMinimumConfidence', 'categoryPromptPreview', 'categoryRegexPhrases',
    'categoryRegexExcludePhrases', 'categoryRegexExpressions',
    'categoryRegexCaseSensitive', 'categoryRegexWholeWord',
    'categoryRegexTestText', 'testCategoryRegex', 'categoryRegexResults',
    'saveCategoryOverride', 'resetCategoryOverride', 'categoryEditorStatus']
    .forEach(id => assert.match(html, new RegExp(`id="${id}"`)));
  assert.match(html, /id="categoryPromptTab"[^>]*aria-controls="categoryPromptPanel"/);
  assert.match(html, /id="categoryRegexTab"[^>]*aria-controls="categoryRegexPanel"/);
  assert.match(html, /id="categoryPromptTab"[^>]*aria-selected="true"/);
  assert.match(html, /id="categoryEditorStatus"[^>]*aria-live="polite"/);
  assert.match(html, /id="categoryPromptPreview"[^>]*readonly/);
});

test('category editor helpers precede the collector and map every unified category section', () => {
  const script = read('options.js');
  const helperNames = [
    'function valueOf(', 'function checked(', 'function checkedEngineValues(',
    'function linesFrom(', 'function collectCategoryOverride('
  ];
  const positions = helperNames.map(name => script.indexOf(name));
  positions.forEach(position => assert.ok(position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(script, /enabledEngines:\s*checkedEngineValues\(/);
  assert.match(script, /prompt:\s*\{/);
  assert.match(script, /regex:\s*\{/);
  assert.match(script, /excludePhrases:\s*linesFrom\('categoryRegexExcludePhrases'\)/);
  assert.match(script, /minimumConfidence:\s*Number\(/);
});

test('category editor loads from hash, persists overrides, resets, and tests draft regex', () => {
  const script = read('options.js');
  assert.match(script, /CATEGORY_GET/);
  assert.match(script, /CATEGORY_SAVE_OVERRIDE/);
  assert.match(script, /CATEGORY_RESET_OVERRIDE/);
  assert.match(script, /CATEGORY_TEST_REGEX/);
  assert.match(script, /addEventListener\('hashchange'/);
  assert.match(script, /location\.hash/);
  assert.match(script, /candidateRegex:\s*collectCategoryOverride\(\)\.regex/);
  assert.match(script, /function renderRegexMatches\(/);
  const renderer = script.slice(
    script.indexOf('function renderRegexMatches('),
    script.indexOf('\n}', script.indexOf('function renderRegexMatches(')) + 2
  );
  assert.match(renderer, /textContent/);
  assert.doesNotMatch(renderer, /innerHTML/);
});

test('loading a category refreshes its rail metadata before rerendering search results', () => {
  const script = read('options.js');
  const loaderStart = script.indexOf('async function loadCategory(categoryId)');
  const loaderEnd = script.indexOf('\nfunction populateCategoryEditor', loaderStart);
  const loader = script.slice(loaderStart, loaderEnd);
  const updatePosition = loader.indexOf('updateAvailableCategory(detail.category)');
  const renderPosition = loader.indexOf('renderCategoryList()');
  assert.ok(updatePosition >= 0);
  assert.ok(renderPosition > updatePosition);
});

test('category rail includes custom categories and hides built-in reset for them', () => {
  const script = read('options.js');
  assert.doesNotMatch(script, /\.filter\(category\s*=>\s*category\?\.builtIn\s*!==\s*false/);
  assert.match(script, /resetCategoryOverride/);
  assert.match(script, /metadata\.builtIn/);
  assert.match(script, /\.hidden\s*=\s*!metadata\.builtIn/);
  assert.match(script, /\.disabled\s*=\s*pending\s*\|\|\s*[^;]*builtIn/);
});

test('category editor has explicit unsaved, working, failed, and saved states', () => {
  const script = read('options.js');
  ['unsaved', 'working', 'failed', 'saved']
    .forEach(state => assert.match(script, new RegExp(`['"]${state}['"]`)));
  assert.match(script, /saveCategoryOverride/);
  assert.match(script, /resetCategoryOverride/);
  assert.match(script, /\.disabled\s*=/);
});

test('category navigation protects drafts, queues the latest target, and ignores stale replies', () => {
  const html = read('options.html');
  const css = read('options.css');
  const script = read('options.js');
  ['unsavedCategoryDialog', 'cancelCategoryNavigation', 'discardCategoryChanges']
    .forEach(id => assert.match(html, new RegExp(`id=["']${id}["']`)));
  assert.match(html, /aria-labelledby=["']unsavedCategoryDialogTitle["']/);
  assert.match(css, /\.category-list-item:disabled/);
  assert.match(script, /function requestCategoryNavigation\(/);
  assert.match(script, /function queueLatestCategory\(/);
  assert.match(script, /function processQueuedCategory\(/);
  assert.match(script, /function isCurrentCategoryRequest\(/);
  assert.match(script, /pendingNavigationId/);
  assert.match(script, /requestSequence/);
  assert.match(script, /activeRequestToken/);
  assert.match(script, /history\.replaceState/);
  assert.match(script, /\.focus\(\{ preventScroll: true \}\)/);
  const loader = script.slice(
    script.indexOf('async function loadCategory(categoryId)'),
    script.indexOf('\nfunction populateCategoryEditor')
  );
  assert.match(loader, /isCurrentCategoryRequest\(requestToken, categoryId\)/);
  ['saveCategoryOverride', 'resetCategoryOverride', 'testCategoryRegex']
    .forEach(name => {
      const start = script.indexOf(`async function ${name}(`);
      const end = script.indexOf('\n}', start) + 2;
      assert.match(script.slice(start, end), /isCurrentCategoryRequest\(requestToken, categoryId\)/);
  });
});

test('local data controls form one accessible section and load the shared directory adapter first', () => {
  const html = read('options.html');
  const css = read('options.css');
  const directoryScript = html.indexOf('core/directory-sync.js');
  const optionsScript = html.indexOf('options.js');
  assert.ok(directoryScript >= 0 && directoryScript < optionsScript);
  [
    'userDataDirectory', 'userDataPermission', 'userDataPendingCount',
    'userDataConflictCount', 'userDataLastSync', 'chooseUserDataDirectory',
    'reauthorizeUserDataDirectory', 'syncUserDataNow', 'rebuildUserDataIndex',
    'exportUserDataBundle', 'userDataStatus', 'rebuildUserDataDialog',
    'confirmRebuildUserDataIndex'
  ].forEach(id => assert.match(html, new RegExp(`id=["']${id}["']`)));
  assert.match(html, /id=["']userDataStatus["'][^>]*role=["']status["'][^>]*aria-live=["']polite["']/);
  assert.match(html, /id=["']rebuildUserDataDialog["'][^>]*aria-labelledby=["']rebuildUserDataDialogTitle["'][^>]*aria-describedby=["']rebuildUserDataDialogDescription["']/);
  assert.match(html, /导入[^<]*较新|较新[^<]*索引/);
  assert.match(html, /冲突[^<]*备份|备份[^<]*冲突/);
  assert.match(css, /--navy:\s*#0B4778/i);
  assert.match(css, /\.local-data-layout\s*\{/);
  assert.doesNotMatch(html, /<svg|😀|📁|💾/u);
});

test('portable encrypted settings expose an accessible safe passphrase workflow', () => {
  const html = read('options.html');
  const script = read('options.js');
  const css = read('options.css');
  [
    'portableConfigState', 'portableConfigRevision', 'portableConfigUpdatedAt',
    'unlockPortableConfig', 'rotatePortableConfigPassphrase',
    'forgetPortableConfigKey', 'backupPortableConfigNow',
    'portableConfigDialog', 'portableConfigDialogTitle',
    'portableConfigDialogDescription', 'portableConfigCurrentPassphrase',
    'portableConfigPassphrase', 'portableConfigPassphraseConfirm',
    'portableConfigDialogError', 'cancelPortableConfigDialog',
    'confirmPortableConfigDialog'
  ].forEach(id => assert.match(html, new RegExp(`id=["']${id}["']`)));
  assert.match(html, /id=["']portableConfigDialog["'][^>]*aria-labelledby=["']portableConfigDialogTitle["'][^>]*aria-describedby=["']portableConfigDialogDescription["']/);
  assert.match(html, /id=["']portableConfigDialogError["'][^>]*aria-live=["']polite["']/);
  ['portableConfigCurrentPassphrase', 'portableConfigPassphrase',
    'portableConfigPassphraseConfirm'].forEach(id => {
    assert.match(html, new RegExp(`id=["']${id}["'][^>]*type=["']password["']|type=["']password["'][^>]*id=["']${id}["']`));
  });
  assert.match(html, /autocomplete=["']current-password["']/);
  assert.match(html, /autocomplete=["']new-password["']/);
  assert.match(html, /API Key、模型设置和全局缩略词表以加密形式存放在所选目录/);
  assert.match(html, /遗忘口令无法恢复密文凭据/);
  assert.match(script, /function openPortableConfigDialog\(mode\)/);
  assert.match(css, /\.portable-config-card\s*\{/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('portable directory preparation probes before any drained sync and gates every non-ready path', async () => {
  const script = read('options.js');
  const chooseStart = script.indexOf('async function chooseUserDataDirectory(');
  const chooseEnd = script.indexOf('\n}', chooseStart) + 2;
  const chooseSource = script.slice(chooseStart, chooseEnd);
  const pickerIndex = chooseSource.indexOf('window.showDirectoryPicker');
  const saveIndex = chooseSource.indexOf('SciLLM.saveDirectoryHandle');
  const prepareIndex = chooseSource.indexOf('preparePortableConfigForDirectory');
  assert.ok(pickerIndex >= 0 && pickerIndex < saveIndex && saveIndex < prepareIndex);
  assert.doesNotMatch(chooseSource.slice(0, prepareIndex), /USER_DATA_SYNC_NOW/);
  const start = script.indexOf('async function preparePortableConfigForDirectory(');
  const end = script.indexOf('\n}', start) + 2;
  const activationStart = script.indexOf('// Portable config activation: start.');
  const activationEnd = script.indexOf('// Portable config activation: end.');
  assert.ok(start >= 0 && end > start);
  assert.ok(activationStart >= 0 && activationEnd > activationStart);
  const source = `${script.slice(activationStart, activationEnd)}\n${script.slice(start, end)}`;

  async function run(probeState, dialogResult) {
    const events = [];
    const context = { Error };
    vm.runInNewContext(`${source}\nglobalThis.prepare = preparePortableConfigForDirectory;`, context);
    const result = await context.prepare({
      call: async message => {
        events.push(['call', message.type, message.drain]);
        if (message.type === 'PORTABLE_CONFIG_PROBE') return { state: probeState };
        return { permission: 'granted' };
      },
      openDialog: async mode => {
        events.push(['dialog', mode]);
        return dialogResult;
      },
      reloadSettings: async () => { events.push(['reload', 'reload']); },
      refreshStatus: async () => { events.push(['refresh', 'status']); },
      isOnboardingActive: () => true,
      markStorageCompleted: async () => { events.push(['onboarding', 'completed']); },
      renderStatus: status => { events.push(['render', status?.state]); }
    });
    return { events, result };
  }

  const cached = await run('ready');
  assert.deepEqual(cached.events.map(event => event[1]), [
    'PORTABLE_CONFIG_PROBE', 'ready', 'USER_DATA_SYNC_NOW', 'status',
    'completed'
  ]);
  assert.equal(cached.events.find(event => event[1] === 'USER_DATA_SYNC_NOW')[2], true);

  const created = await run('missing', { state: 'ready' });
  assert.deepEqual(created.events.map(event => event[1]), [
    'PORTABLE_CONFIG_PROBE', 'missing', 'create', 'ready',
    'USER_DATA_SYNC_NOW', 'status', 'completed'
  ]);

  const unlocked = await run('locked', { state: 'ready' });
  assert.deepEqual(unlocked.events.map(event => event[1]), [
    'PORTABLE_CONFIG_PROBE', 'locked', 'unlock', 'ready', 'reload',
    'USER_DATA_SYNC_NOW', 'status', 'completed'
  ]);

  for (const [state, dialogResult] of [
    ['locked', { cancelled: true }], ['locked', { state: 'locked' }],
    ['missing', { state: 'error' }], ['error', undefined],
    ['unavailable', undefined]
  ]) {
    const blocked = await run(state, dialogResult);
    assert.equal(
      blocked.events.some(event => event[1] === 'USER_DATA_SYNC_NOW'), false,
      `${state} must never sync until portable settings are ready`
    );
    assert.equal(blocked.result.ready, false);
  }
});

test('deferred portable activation finishes create and unlock safely before onboarding completion', async () => {
  const script = read('options.js');
  const start = script.indexOf('// Portable config activation: start.');
  const end = script.indexOf('// Portable config activation: end.');
  assert.ok(start >= 0 && end > start);
  const portableFlow = script.slice(start, script.indexOf('async function syncUserDataNow('));
  assert.doesNotMatch(portableFlow, /friendlyError\(|error\.message/);
  const context = { Error };
  vm.runInNewContext(`${script.slice(start, end)}\n` +
    'globalThis.activate = activatePortableConfigFromStatusCard;', context);

  async function run(currentState, dialogResult, { failSync = false } = {}) {
    const events = [];
    const notices = [];
    const secret = 'secret-must-not-be-rendered';
    const result = await context.activate({
      currentState,
      openDialog: async mode => {
        events.push(['dialog', mode]);
        return dialogResult;
      },
      call: async message => {
        events.push(['call', message.type, message.drain]);
        if (failSync) throw Object.assign(new Error(secret), { code: 'UNKNOWN_FAILURE' });
        return { permission: 'granted' };
      },
      reloadSettings: async () => { events.push(['reload']); },
      refreshStatus: async () => { events.push(['refresh']); },
      isOnboardingActive: () => true,
      markStorageCompleted: async () => { events.push(['onboarding', 'completed']); },
      renderStatus: status => { events.push(['render', status?.state]); },
      showStatus: (message, type) => notices.push([message, type]),
      errorText: () => '无法完成加密配置操作，请稍后重试。'
    });
    return { events, notices, result, secret };
  }

  const created = await run('missing', { state: 'ready' });
  assert.deepEqual(created.events, [
    ['dialog', 'create'], ['render', 'ready'],
    ['call', 'USER_DATA_SYNC_NOW', true], ['refresh'],
    ['onboarding', 'completed']
  ]);
  assert.equal(created.result.completed, true);

  const unlocked = await run('locked', { state: 'ready' });
  assert.deepEqual(unlocked.events, [
    ['dialog', 'unlock'], ['render', 'ready'], ['reload'],
    ['call', 'USER_DATA_SYNC_NOW', true], ['refresh'],
    ['onboarding', 'completed']
  ]);
  assert.equal(unlocked.result.completed, true);

  const cancelled = await run('locked', { cancelled: true });
  assert.deepEqual(cancelled.events, [['dialog', 'unlock']]);
  assert.equal(cancelled.result.cancelled, true);

  const failed = await run('missing', { state: 'ready' }, { failSync: true });
  assert.equal(failed.events.some(event => event[0] === 'onboarding'), false);
  assert.equal(failed.events.some(event => event[0] === 'refresh'), false);
  assert.equal(failed.result.completed, false);
  assert.equal(failed.notices.at(-1)[0], '无法完成加密配置操作，请稍后重试。');
  assert.doesNotMatch(failed.notices.flat().join(' '), new RegExp(failed.secret));
});

test('portable passphrase mode helpers validate and map only the intended background fields', () => {
  const script = read('options.js');
  const start = script.indexOf('// Portable config dialog helpers: start.');
  const end = script.indexOf('// Portable config dialog helpers: end.');
  assert.ok(start >= 0 && end > start);
  const source = script.slice(start, end);
  const context = { Error };
  vm.runInNewContext(`${source}\n` +
    'globalThis.validate = validatePortableConfigPassphrases;' +
    'globalThis.request = portableConfigRequestForMode;' +
    'globalThis.errorText = portableConfigErrorText;', context);

  assert.equal(context.validate('create', '', 'short', 'short'), '口令至少需要 10 个字符。');
  assert.equal(context.validate('create', '', '1234567890', '1234567891'), '两次输入的口令不一致。');
  assert.equal(context.validate('rotate', 'short', '1234567890', '1234567890'), '当前口令至少需要 10 个字符。');
  assert.equal(context.validate('unlock', '', '1234567890', ''), '');
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.request('create', '', 'new-secret-1'))),
    { type: 'PORTABLE_CONFIG_CREATE', passphrase: 'new-secret-1' }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.request('unlock', '', 'old-secret-1'))),
    { type: 'PORTABLE_CONFIG_UNLOCK', passphrase: 'old-secret-1' }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.request('rotate', 'old-secret-1', 'new-secret-1'))),
    {
      type: 'PORTABLE_CONFIG_ROTATE_PASSPHRASE',
      currentPassphrase: 'old-secret-1', newPassphrase: 'new-secret-1'
    }
  );
  assert.equal(context.errorText({ code: 'PORTABLE_CONFIG_UNLOCK_FAILED', message: 'old-secret-1' }), '口令不正确或备份无法解密。');
  assert.doesNotMatch(context.errorText({ code: 'UNKNOWN', message: 'new-secret-1' }), /new-secret-1/);
});

test('portable public status renderer ignores hostile private fields and rejects unsafe metadata', () => {
  const script = read('options.js');
  const start = script.indexOf('// Portable config status renderer: start.');
  const end = script.indexOf('// Portable config status renderer: end.');
  assert.ok(start >= 0 && end > start);
  const source = script.slice(start, end);
  const elements = Object.fromEntries([
    'portableConfigState', 'portableConfigRevision', 'portableConfigUpdatedAt',
    'portableConfigNotice', 'unlockPortableConfig',
    'rotatePortableConfigPassphrase', 'forgetPortableConfigKey',
    'backupPortableConfigNow'
  ].map(id => [id, { textContent: '', hidden: false, disabled: false, dataset: {} }]));
  const context = {
    document: { getElementById: id => elements[id] },
    userDataUi: { pendingAction: false, portableConfigStatus: null },
    Date, Number, String, Set, Object
  };
  vm.runInNewContext(`${source}\nglobalThis.render = renderPortableConfigStatus;`, context);
  const accessed = [];
  const hostile = new Proxy({
    state: 'ready', revision: Number.MAX_SAFE_INTEGER + 1,
    updatedAt: 'not-a-date', pending: false, lastError: '',
    backupId: 'private-backup', salt: 'private-salt', iv: 'private-iv',
    ciphertext: 'private-ciphertext', passphrase: 'private-passphrase',
    key: 'private-key', apiKey: 'private-api-key', profile: { secret: true }
  }, { get(target, property) { accessed.push(String(property)); return target[property]; } });
  context.render(hostile);
  assert.equal(elements.portableConfigState.textContent, '已加密');
  assert.equal(elements.portableConfigRevision.textContent, '—');
  assert.equal(elements.portableConfigUpdatedAt.textContent, '—');
  ['backupId', 'salt', 'iv', 'ciphertext', 'passphrase', 'key', 'apiKey', 'profile']
    .forEach(field => assert.equal(accessed.includes(field), false));
  assert.doesNotMatch(Object.values(elements).map(item => item.textContent).join(' '), /private-/);
});

test('portable dialog controller maps modes, deduplicates submits, and clears every secret path', async () => {
  const script = read('options.js');
  const helpersStart = script.indexOf('// Portable config dialog helpers: start.');
  const helpersEnd = script.indexOf('// Portable config dialog helpers: end.');
  const controllerStart = script.indexOf('// Portable config dialog controller: start.');
  const controllerEnd = script.indexOf('// Portable config dialog controller: end.');
  assert.ok(helpersStart >= 0 && helpersEnd > helpersStart);
  assert.ok(controllerStart >= 0 && controllerEnd > controllerStart);

  function createHarness() {
    const calls = [];
    const rendered = [];
    const storageWrites = [];
    const consoleWrites = [];
    let settleBackground = null;
    const controls = [];
    const makeElement = value => ({
      value, textContent: '', hidden: false, disabled: false,
      autocomplete: '', focus() {}
    });
    const elements = {
      portableConfigCurrentPassphrase: makeElement(''),
      portableConfigPassphrase: makeElement(''),
      portableConfigPassphraseConfirm: makeElement(''),
      portableConfigDialogError: makeElement(''),
      portableConfigDialogTitle: makeElement(''),
      portableConfigDialogDescription: makeElement(''),
      portableConfigPassphraseLabel: makeElement(''),
      confirmPortableConfigDialog: makeElement(''),
      portableConfigCurrentPassphraseField: makeElement(''),
      portableConfigPassphraseConfirmField: makeElement('')
    };
    controls.push(
      elements.portableConfigCurrentPassphrase,
      elements.portableConfigPassphrase,
      elements.portableConfigPassphraseConfirm,
      elements.confirmPortableConfigDialog,
      makeElement('')
    );
    const attributes = new Map();
    const dialog = {
      open: false,
      showModal() { this.open = true; },
      close() {
        this.open = false;
        context.clearSecrets();
      },
      querySelectorAll() { return controls; },
      setAttribute(name, value) { attributes.set(name, value); },
      removeAttribute(name) { attributes.delete(name); }
    };
    elements.portableConfigDialog = dialog;
    const context = {
      document: { getElementById: id => elements[id] },
      portableConfigUi: {
        mode: '', submitting: false, dialogPromise: null, resolveDialog: null
      },
      callBackground(message) {
        calls.push(structuredClone(message));
        return new Promise((resolve, reject) => { settleBackground = { resolve, reject }; });
      },
      normalizePortableConfigStatus(status) {
        return {
          state: status?.state === 'ready' ? 'ready' : 'unknown',
          revision: Number.isSafeInteger(status?.revision) ? status.revision : null,
          updatedAt: '', pending: false, lastError: ''
        };
      },
      renderPortableConfigStatus(status) { rendered.push(structuredClone(status)); },
      localStorage: {
        setItem(...args) { storageWrites.push(['local', ...args]); }
      },
      sessionStorage: {
        setItem(...args) { storageWrites.push(['session', ...args]); }
      },
      console: Object.fromEntries(['log', 'info', 'warn', 'error'].map(method => [
        method, (...args) => consoleWrites.push([method, ...args])
      ])),
      Error, Promise, Set, Object, Number, String
    };
    const source = `${script.slice(helpersStart, helpersEnd)}\n` +
      `${script.slice(controllerStart, controllerEnd)}\n` +
      'globalThis.openDialog = openPortableConfigDialog;' +
      'globalThis.submitDialog = submitPortableConfigDialog;' +
      'globalThis.cancelDialog = cancelPortableConfigDialog;' +
      'globalThis.clearSecrets = clearPortableConfigDialogSecrets;';
    vm.runInNewContext(source, context);
    return {
      context, elements, controls, attributes, calls, rendered,
      storageWrites, consoleWrites,
      settle(status) { settleBackground.resolve(status); },
      fail(error) { settleBackground.reject(error); }
    };
  }

  const modes = [
    ['create', '', 'new-secret-1', 'new-secret-1', {
      type: 'PORTABLE_CONFIG_CREATE', passphrase: 'new-secret-1'
    }],
    ['unlock', '', 'old-secret-1', '', {
      type: 'PORTABLE_CONFIG_UNLOCK', passphrase: 'old-secret-1'
    }],
    ['rotate', 'old-secret-1', 'new-secret-1', 'new-secret-1', {
      type: 'PORTABLE_CONFIG_ROTATE_PASSPHRASE',
      currentPassphrase: 'old-secret-1', newPassphrase: 'new-secret-1'
    }]
  ];
  for (const [mode, current, passphrase, confirmation, expected] of modes) {
    const harness = createHarness();
    const firstOpen = harness.context.openDialog(mode);
    const secondOpen = harness.context.openDialog(mode);
    assert.equal(firstOpen, secondOpen);
    harness.elements.portableConfigCurrentPassphrase.value = current;
    harness.elements.portableConfigPassphrase.value = passphrase;
    harness.elements.portableConfigPassphraseConfirm.value = confirmation;
    const firstSubmit = harness.context.submitDialog({ preventDefault() {} });
    const secondSubmit = harness.context.submitDialog({ preventDefault() {} });
    await Promise.resolve();
    assert.equal(harness.calls.length, 1);
    assert.deepEqual(harness.calls[0], expected);
    assert.equal(harness.attributes.get('aria-busy'), 'true');
    assert.equal(harness.controls.every(control => control.disabled), true);
    harness.settle({ state: 'ready', revision: 7, secret: 'must-not-echo' });
    await Promise.all([firstSubmit, secondSubmit]);
    const publicStatus = await firstOpen;
    assert.deepEqual(publicStatus, {
      state: 'ready', revision: 7, updatedAt: '', pending: false, lastError: ''
    });
    assert.equal('secret' in publicStatus, false);
    assert.equal(harness.rendered.some(status => 'secret' in status), false);
    assert.equal(harness.elements.portableConfigDialog.open, false);
    assert.equal(harness.attributes.has('aria-busy'), false);
    assert.equal(harness.controls.every(control => !control.disabled), true);
    ['portableConfigCurrentPassphrase', 'portableConfigPassphrase',
      'portableConfigPassphraseConfirm', 'portableConfigDialogError']
      .forEach(id => assert.equal(harness.elements[id].value ||
        harness.elements[id].textContent, ''));
    assert.equal(harness.storageWrites.length, 0);
    assert.equal(harness.consoleWrites.length, 0);
  }

  for (const eventKind of ['cancel-event', 'close-button']) {
    const harness = createHarness();
    const opened = harness.context.openDialog('unlock');
    harness.elements.portableConfigCurrentPassphrase.value = `${eventKind}-current`;
    harness.elements.portableConfigPassphrase.value = `${eventKind}-secret`;
    harness.elements.portableConfigPassphraseConfirm.value = `${eventKind}-confirm`;
    harness.elements.portableConfigDialogError.textContent = 'temporary';
    harness.context.cancelDialog({ preventDefault() {} });
    assert.deepEqual(JSON.parse(JSON.stringify(await opened)), { cancelled: true });
    ['portableConfigCurrentPassphrase', 'portableConfigPassphrase',
      'portableConfigPassphraseConfirm'].forEach(id => {
      assert.equal(harness.elements[id].value, '');
    });
    assert.equal(harness.elements.portableConfigDialogError.textContent, '');
    assert.equal(harness.attributes.has('aria-busy'), false);
    assert.equal(harness.controls.every(control => !control.disabled), true);
  }

  const failed = createHarness();
  const failedOpen = failed.context.openDialog('unlock');
  failed.elements.portableConfigCurrentPassphrase.value = 'current-secret-1';
  failed.elements.portableConfigPassphrase.value = 'old-secret-1';
  failed.elements.portableConfigPassphraseConfirm.value = 'confirm-secret-1';
  const failedSubmit = failed.context.submitDialog({ preventDefault() {} });
  await Promise.resolve();
  failed.fail(Object.assign(new Error('old-secret-1'), { code: 'UNKNOWN' }));
  await failedSubmit;
  assert.doesNotMatch(failed.elements.portableConfigDialogError.textContent, /old-secret-1/);
  assert.equal(failed.attributes.has('aria-busy'), false);
  failed.context.cancelDialog({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(await failedOpen)), { cancelled: true });
  ['portableConfigCurrentPassphrase', 'portableConfigPassphrase',
    'portableConfigPassphraseConfirm'].forEach(id => {
    assert.equal(failed.elements[id].value, '');
  });
  assert.equal(failed.elements.portableConfigDialogError.textContent, '');

  assert.match(script, /if\s*\(portableConfigUi\.submitting\)\s*return/);
  assert.match(script, /function clearPortableConfigDialogSecrets\(/);
  assert.match(script, /addEventListener\(['"]close['"],\s*clearPortableConfigDialogSecrets\)/);
  assert.match(script, /addEventListener\(['"]cancel['"]/);
  assert.match(script, /passphrase\s*=\s*['"]["']/);
  assert.doesNotMatch(script, /(?:localStorage|sessionStorage)[\s\S]{0,160}passphrase|passphrase[\s\S]{0,160}(?:localStorage|sessionStorage)/i);
  assert.doesNotMatch(script, /console\.(?:log|info|warn|error)\([^\n]*(?:passphrase|portableConfigPassphrase)/i);
  assert.doesNotMatch(script, /dataset\.[A-Za-z]*passphrase|data-passphrase/i);
});

test('directory picker and permission prompts exist only in direct click handlers', () => {
  const script = read('options.js');
  assert.match(
    script,
    /chooseUserDataDirectory['"]\)\.addEventListener\(['"]click['"],\s*chooseUserDataDirectory\)/
  );
  assert.match(
    script,
    /reauthorizeUserDataDirectory['"]\)\.addEventListener\(['"]click['"],\s*reauthorizeUserDataDirectory\)/
  );
  assert.equal((script.match(/showDirectoryPicker\s*\(/g) || []).length, 1);
  assert.equal((script.match(/\.requestPermission\s*\(/g) || []).length, 1);
  const choose = script.slice(
    script.indexOf('async function chooseUserDataDirectory('),
    script.indexOf('\n}', script.indexOf('async function chooseUserDataDirectory(')) + 2
  );
  const reauthorize = script.slice(
    script.indexOf('async function reauthorizeUserDataDirectory('),
    script.indexOf('\n}', script.indexOf('async function reauthorizeUserDataDirectory(')) + 2
  );
  assert.match(choose, /window\.showDirectoryPicker\s*\(/);
  assert.match(reauthorize, /handle\.requestPermission\s*\(\{\s*mode:\s*['"]readwrite['"]\s*\}\)/);
  assert.doesNotMatch(
    reauthorize.slice(0, reauthorize.indexOf('handle.requestPermission')),
    /await\s/,
    'requestPermission must be invoked before user activation can expire'
  );
  assert.match(script, /SciLLM\.loadDirectoryHandle\(indexedDB\)/);
  assert.doesNotMatch(read('background.js'), /requestPermission\s*\(/);
});

test('reauthorization invokes cached handle permission synchronously before yielding', async () => {
  const script = read('options.js');
  const start = script.indexOf('async function reauthorizeUserDataDirectory(');
  const source = script.slice(start, script.indexOf('\n}', start) + 2);
  const events = [];
  let resolvePermission;
  const context = {
    userDataUi: {
      pendingAction: false,
      directoryHandle: {
        requestPermission(options) {
          events.push(['requestPermission', options]);
          return new Promise(resolve => { resolvePermission = resolve; });
        }
      }
    },
    setUserDataActionPending(value) {
      context.userDataUi.pendingAction = value;
      events.push(['pending', value]);
    },
    showUserDataStatus() {},
    callBackground: async () => ({ permission: 'granted' }),
    preparePortableConfigForDirectory: async () => ({ ready: true }),
    refreshUserDataStatus: async () => {},
    portableConfigErrorText: () => '安全错误',
    Error
  };
  vm.runInNewContext(`${source}\nglobalThis.runReauthorize = reauthorizeUserDataDirectory;`, context);
  const pending = context.runReauthorize();
  assert.equal(events.some(([name]) => name === 'requestPermission'), true);
  resolvePermission('granted');
  await pending;
  assert.equal(context.userDataUi.pendingAction, false);
});

test('local data actions guard duplicates, ignore stale status, and recover from cancellation and errors', () => {
  const script = read('options.js');
  assert.match(script, /const userDataUi\s*=\s*\{/);
  assert.match(script, /pendingAction/);
  assert.match(script, /if\s*\(userDataUi\.pendingAction\)\s*return/);
  assert.match(script, /statusRequestSequence/);
  assert.match(script, /function isCurrentUserDataStatus\(/);
  assert.match(script, /if\s*\(!isCurrentUserDataStatus\(requestToken\)\)\s*return/);
  assert.match(script, /AbortError/);
  assert.match(script, /未选择目录|已取消选择/);
  assert.match(script, /不支持目录选择[^'"`]*JSON/);
  assert.match(script, /finally\s*\{[\s\S]*setUserDataActionPending\(false\)/);
  assert.match(script, /USER_DATA_SYNC_STATUS/);
  assert.match(script, /USER_DATA_SYNC_NOW/);
  assert.match(script, /USER_DATA_REBUILD_INDEX/);
});

test('local data export uses a dated safe download and never renders an operating-system path', () => {
  const html = read('options.html');
  const script = read('options.js');
  assert.match(script, /USER_DATA_EXPORT_BUNDLE/);
  assert.match(script, /downloadTextFile\(/);
  assert.match(script, /sci-highlighter-user-data-\$\{date\}\.json/);
  assert.match(script, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(script, /setTimeout\(\(\) => URL\.revokeObjectURL\(objectUrl\), 1000\)/);
  assert.match(script, /directoryName/);
  assert.doesNotMatch(script, /webkitRelativePath|fullPath|directoryPath|handle\.path/);
  assert.doesNotMatch(html, /data-(?:full-)?path=|[A-Z]:\\Users|\/Users\//);
});

test('local data exposes a searchable paged workspace overview with exact management actions', () => {
  const html = read('options.html');
  const script = read('options.js');
  const css = read('options.css');
  const overviewScript = script.slice(
    script.indexOf('// Article workspace overview:'),
    script.indexOf('// Article workspace overview: end.')
  );
  [
    'articleWorkspaceOverview', 'articleWorkspaceSearch', 'articleWorkspaceSort',
    'articleWorkspaceTotals', 'articleWorkspaceList', 'articleWorkspaceSelectAll',
    'clearSelectedArticleWorkspaces', 'refreshArticleWorkspaceOverview',
    'articleWorkspacePreviousPage', 'articleWorkspaceNextPage', 'articleWorkspacePageStatus',
    'articleWorkspaceOverviewStatus'
  ].forEach(id => assert.match(html, new RegExp(`id=["']${id}["']`)));
  assert.match(script, /const ARTICLE_WORKSPACE_PAGE_SIZE\s*=\s*20/);
  assert.match(script, /function refreshArticleWorkspaceOverview/);
  assert.match(script, /function renderArticleWorkspaceOverview/);
  assert.match(script, /function workspaceDeleteConfirmation/);
  assert.match(script, /ARTICLE_WORKSPACE_LIST/);
  assert.match(script, /ARTICLE_WORKSPACE_DETAIL/);
  assert.match(script, /ARTICLE_WORKSPACE_SCAN_RESTORE/);
  assert.match(script, /ARTICLE_WORKSPACE_EXPORT/);
  assert.match(script, /ARTICLE_WORKSPACE_BEGIN_DELETE/);
  assert.match(script, /ARTICLE_WORKSPACE_FINALIZE_DELETE/);
  assert.match(script, /title.*doi|doi.*title/is);
  assert.match(script, /updated_desc|size_desc/);
  assert.match(script, /confirm\(workspaceDeleteConfirmation/);
  assert.match(css, /\.article-workspace-overview\s*\{/);
  assert.match(css, /\.article-workspace-list\s*\{/);
  assert.doesNotMatch(overviewScript, /fullPath|directoryPath|handle\.path|apiKey|authorization/i);
});

test('workspace restore and clear results remain visible after overview refreshes', () => {
  const script = read('options.js');
  const clearSource = script.slice(
    script.indexOf('async function clearArticleWorkspaces('),
    script.indexOf('function safeArticleWorkspaceFilename(')
  );
  const actionSource = script.slice(
    script.indexOf('async function handleArticleWorkspaceAction('),
    script.indexOf('// Article workspace overview: end.')
  );

  assert.match(clearSource, /let finalStatus\s*=\s*null/);
  assert.match(
    clearSource,
    /await refreshArticleWorkspaceOverview\(\);\s*if \(finalStatus\) articleWorkspaceStatus\(\.\.\.finalStatus\)/s
  );
  assert.match(actionSource, /let finalStatus\s*=\s*null/);
  assert.match(
    actionSource,
    /if \(refreshAfterAction\) await refreshArticleWorkspaceOverview\(\);\s*else renderArticleWorkspaceOverview\(\);\s*if \(finalStatus\) articleWorkspaceStatus\(\.\.\.finalStatus\)/s
  );
  assert.equal((clearSource.match(/coordinateOpenTabs:\s*true/g) || []).length, 2);
  assert.match(clearSource, /result\.pendingDiskCleanup/);
  assert.match(clearSource, /不会被扫描恢复/);
});

test('workspace overview exposes per-article token usage by feature and model', () => {
  const script = read('options.js');
  const css = read('options.css');
  assert.match(script, /function createWorkspaceTokenBreakdown\(tokenUsage\)/);
  assert.match(script, /tokenUsage\?\.features/);
  assert.match(script, /feature\.inputTokens/);
  assert.match(script, /feature\.outputTokens/);
  assert.match(script, /feature\.models/);
  assert.match(script, /estimatedRequests/);
  assert.match(script, /workspaceMetric\(\s*['"]Token['"]/);
  assert.match(css, /\.article-workspace-token-usage\s*\{/);
  assert.match(css, /\.article-workspace-token-feature\s*\{/);
});

test('settings reuse directory and API controls in a skippable two-step onboarding view', () => {
  const html = read('options.html');
  const script = read('options.js');
  const css = read('options.css');
  [
    'onboardingGuide', 'onboardingProgress', 'onboardingStepTitle',
    'onboardingBack', 'onboardingSkip', 'onboardingContinue', 'onboardingFinish',
    'reopenOnboarding', 'directorySyncSettings', 'providerSettings'
  ].forEach(id => assert.match(html, new RegExp(`id=["']${id}["']`)));
  assert.match(script, /location\.hash\s*===\s*['"]#onboarding['"]/);
  assert.match(script, /ONBOARDING_GET/);
  assert.match(script, /ONBOARDING_SET_STEP/);
  assert.match(script, /ONBOARDING_RESTART/);
  assert.match(script, /ONBOARDING_PREPARE_FINISH/);
  assert.match(script, /ONBOARDING_FINISH/);
  assert.match(script, /finish\.disabled\s*=\s*busy[\s\S]*onboardingUi\.finishPrepared !== true/);
  assert.match(script, /chrome\.tabs\.getCurrent/);
  assert.match(script, /if \(result\.opened\)[\s\S]*chrome\.tabs\.remove\(settingsTabId\)/);
  assert.match(script, /chrome\.tabs\.remove\(settingsTabId\)\.catch\(\(\) => window\.close\(\)\)/);
  assert.match(script, /chooseUserDataDirectory/);
  assert.match(script, /addEventListener\(['"]click['"],\s*continueOnboarding\)/);
  assert.match(script, /persistForm/);
  assert.match(script, /function syncSettingsPageVisibility/);
  assert.match(script, /section\.id === onboardingSectionId/);
  assert.match(script, /onboardingUi\.step === ['"]api['"][\s\S]*providerSettings[\s\S]*localData/);
  assert.match(script, /enterOnboardingLayout\(\)[\s\S]*syncSettingsPageVisibility\(\)/);
  assert.match(script, /leaveOnboardingLayout\(\)[\s\S]*syncSettingsPageVisibility\(\)/);
  assert.match(css, /body\.is-onboarding/);
  assert.match(css, /data-onboarding-step/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
  assert.match(css, /\.button:disabled\s*\{[^}]*cursor:\s*not-allowed/);
  assert.match(css, /\.button\[aria-busy=["']true["']\]:disabled\s*\{[^}]*cursor:\s*wait/);
});

test('onboarding reveals the real storage and API forms instead of only the guide card', () => {
  const script = read('options.js');
  const start = script.indexOf('function syncSettingsPageVisibility(');
  const end = script.indexOf('\nfunction activateSettingsPage(', start);
  const source = script.slice(start, end);
  const sections = [
    { id: 'categoryWorkspace', dataset: { settingsPage: 'categories' } },
    { id: 'customCategoryCard', dataset: { settingsPage: 'categories' } },
    { id: 'providerSettings', dataset: { settingsPage: 'models' } },
    { id: 'localData', dataset: { settingsPage: 'data' } }
  ].map(section => ({
    ...section,
    hidden: false,
    classList: { toggle() {} }
  }));
  const context = {
    onboardingUi: { active: true, step: 'storage' },
    activeSettingsPage: 'categories',
    document: {
      querySelectorAll(selector) {
        assert.equal(selector, '[data-settings-page]');
        return sections;
      }
    }
  };
  vm.runInNewContext(
    `${source}\nglobalThis.syncVisibility = syncSettingsPageVisibility;`,
    context
  );

  context.syncVisibility();
  assert.equal(sections.find(section => section.id === 'localData').hidden, false);
  assert.equal(sections.find(section => section.id === 'providerSettings').hidden, true);

  context.onboardingUi.step = 'api';
  context.syncVisibility();
  assert.equal(sections.find(section => section.id === 'localData').hidden, true);
  assert.equal(sections.find(section => section.id === 'providerSettings').hidden, false);

  context.onboardingUi.active = false;
  context.syncVisibility();
  assert.equal(sections.find(section => section.id === 'categoryWorkspace').hidden, false);
  assert.equal(sections.find(section => section.id === 'customCategoryCard').hidden, false);
  assert.equal(sections.find(section => section.id === 'providerSettings').hidden, true);
});

test('continuing to API implicitly skips an unfinished storage step and never stays busy', async () => {
  const script = read('options.js');
  const start = script.indexOf('async function continueOnboarding(');
  const source = script.slice(start, script.indexOf('\n}', start) + 2);
  const events = [];
  const context = {
    onboardingUi: {
      active: true, step: 'storage', pending: false,
      state: { steps: { storage: 'pending', api: 'pending' } }
    },
    userDataUi: { pendingAction: false },
    async setOnboardingStepState(step, status) {
      events.push([step, status]);
      context.onboardingUi.state.steps[step] = status;
    },
    renderOnboarding() { events.push(['render', context.onboardingUi.step]); },
    document: { getElementById() { return { textContent: '' }; } },
    friendlyError: error => error.message,
    Error
  };
  vm.runInNewContext(`${source}\nglobalThis.runContinue = continueOnboarding;`, context);
  await context.runContinue();

  assert.deepEqual(events[0], ['storage', 'skipped']);
  assert.equal(context.onboardingUi.step, 'api');
  assert.equal(context.onboardingUi.pending, false);
});
