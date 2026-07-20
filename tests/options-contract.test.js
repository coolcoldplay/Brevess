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

test('settings expose four editable Panel follow-up prompts and restore defaults', () => {
  const html = read('options.html');
  const script = read('options.js');
  [
    'panelPromptGrouping', 'panelPromptTechnique', 'panelPromptAxes',
    'panelPromptSamples', 'resetPanelFollowupPrompts'
  ].forEach(id => assert.match(html, new RegExp(`id="${id}"`)));
  assert.match(script, /function collectPanelFollowupPrompts\(/);
  assert.match(script, /function renderPanelFollowupPrompts\(/);
  assert.match(script, /figurePanelFollowupPrompts/);
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
  assert.match(options, /mailto:1356496415@qq\.com/);
  assert.doesNotMatch(popup, /mailto:|contact-email/);
});

test('settings expose the AGPL license, public source, and third-party notices', () => {
  const options = read('options.html');
  assert.match(options, /id="openSource"/);
  assert.match(options, /AGPL-3\.0-or-later/);
  assert.match(options, /https:\/\/github\.com\/coolcoldplay\/sci-logic-highlighter/);
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
    'categoryRegexExpressions', 'categoryRegexCaseSensitive', 'categoryRegexWholeWord',
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
    refreshUserDataStatus: async () => {},
    friendlyError: error => error.message,
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
  assert.match(script, /ONBOARDING_FINISH/);
  assert.match(script, /chooseUserDataDirectory/);
  assert.match(script, /addEventListener\(['"]click['"],\s*continueOnboarding\)/);
  assert.match(script, /persistForm/);
  assert.match(css, /body\.is-onboarding/);
  assert.match(css, /data-onboarding-step/);
  assert.match(css, /\.button:disabled\s*\{[^}]*cursor:\s*not-allowed/);
  assert.match(css, /\.button\[aria-busy=["']true["']\]:disabled\s*\{[^}]*cursor:\s*wait/);
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
