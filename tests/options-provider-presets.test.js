const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'options.html'), 'utf8');
const script = readFileSync(join(root, 'options.js'), 'utf8');
const draftTrackingSource = `const settingsDraftRevisions = new Map(); let settingsDraftRevision = 0;\n` +
  script.slice(script.indexOf('function markProfileEditorDirty('), script.indexOf('function canLeaveProfileEditor('));
const { getProviderReasoningCapabilities } = require('../providers/provider-registry.js');
const i18n = require('../core/i18n.js');
const taskCatalog = require('../core/llm-task-catalog.js');

test('DeepSeek V4 presets expose low, high, and max reasoning strengths', () => {
  for (const model of [
    'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'
  ]) {
    assert.deepEqual(getProviderReasoningCapabilities('deepseek', { model }), {
      supported: true,
      mode: 'effort',
      levels: ['low', 'high', 'max'],
      defaultLevel: 'high'
    }, model);
  }
});

test('renders a compatible provider preset selector that persists the selected preset', () => {
  assert.match(html, /id="compatiblePreset"/);
  assert.match(script, /function renderCompatiblePresetOptions\(\)/);
  assert.match(script, /function applyCompatiblePreset\(/);
  assert.match(script, /state\.compatibleProviderPresets/);
  assert.match(script, /config\.presetId/);
});

test('provider selection offers model suggestions while preserving free text input', () => {
  assert.match(html, /<input[^>]*id="model"[^>]*list="modelSuggestions"/);
  assert.match(html, /<datalist[^>]*id="modelSuggestions"/);
  assert.match(html, /<select[^>]*id="modelSuggestionsSelect"/);
  assert.match(script, /function renderModelSuggestions\(/);
  assert.match(script, /definition\?\.models/);
  assert.match(script, /cache\?\.models/);
  assert.match(script, /select\.appendChild\(option\)/);
  assert.match(script, /modelSuggestionsSelect'\)\s*\.addEventListener\('change'/);
  assert.match(script, /function handleProviderChange\(/);
  assert.match(script, /defaultModel/);
  assert.match(html, /id="refreshModels"/);
  assert.match(html, /id="modelDiscoveryStatus"/);
  assert.match(script, /LLM_LIST_MODELS/);
  assert.match(script, /function refreshProviderModels\(/);
});

test('choosing an online model immediately refreshes per-task capability rows without resetting drafts', () => {
  const applyStart = script.indexOf('function applyModelSelection(');
  const handlerStart = script.indexOf('function handleModelSuggestionSelection(');
  const autoStart = script.indexOf('function autoSelectFirstDiscoveredModel(');
  assert.ok(applyStart >= 0 && handlerStart > applyStart && autoStart > handlerStart);
  const source = script.slice(applyStart, autoStart);
  const model = { value: '' };
  const draftMarker = { tokenRule: { output: { floor: 2048 } } };
  const taskPolicyDrafts = new Map([['figure_walkthrough', draftMarker]]);
  const calls = [];
  const context = {
    taskPolicyDrafts,
    document: { getElementById(id) { return id === 'model' ? model : null; } },
    markProfileEditorDirty(event) { calls.push(['dirty', event.target.id]); },
    updateProfileListPreview() { calls.push(['profile']); },
    renderReasoningEffort() { calls.push(['reasoning']); },
    renderTaskPolicyTable() { calls.push(['table']); }
  };
  vm.runInNewContext(
    `${source}\nglobalThis.choose = handleModelSuggestionSelection;`,
    context
  );
  context.choose({ currentTarget: { value: 'deepseek-v4-flash-vision-exp' } });
  assert.equal(model.value, 'deepseek-v4-flash-vision-exp');
  assert.deepEqual(calls, [
    ['dirty', 'model'], ['profile'], ['reasoning'], ['table']
  ]);
  assert.equal(context.taskPolicyDrafts.get('figure_walkthrough'), draftMarker);
});

test('auto-selecting the first discovered model refreshes task rows and preserves token drafts', () => {
  const applyStart = script.indexOf('function applyModelSelection(');
  const autoStart = script.indexOf('function autoSelectFirstDiscoveredModel(');
  const end = script.indexOf('\nasync function refreshProviderModels(', autoStart);
  assert.ok(applyStart >= 0 && autoStart > applyStart && end > autoStart);
  const model = { value: '' };
  const draftMarker = { tokenRule: 'auto' };
  const calls = [];
  const context = {
    taskPolicyDrafts: new Map([['article_chat', draftMarker]]),
    document: { getElementById(id) { return id === 'model' ? model : null; } },
    markProfileEditorDirty() { calls.push('dirty'); },
    updateProfileListPreview() { calls.push('profile'); },
    renderReasoningEffort() { calls.push('reasoning'); },
    renderTaskPolicyTable() { calls.push('table'); }
  };
  vm.runInNewContext(
    `${script.slice(applyStart, end)}\nglobalThis.autoPick = autoSelectFirstDiscoveredModel;`,
    context
  );
  assert.equal(context.autoPick([{ id: 'gpt-5.6' }]), true);
  assert.equal(model.value, 'gpt-5.6');
  assert.deepEqual(calls, ['dirty', 'profile', 'reasoning', 'table']);
  assert.equal(context.taskPolicyDrafts.get('article_chat'), draftMarker);
  assert.equal(context.autoPick([{ id: 'other' }]), false);
  assert.equal(model.value, 'gpt-5.6');
});

test('domestic compatible providers are expanded into named top-level choices', () => {
  assert.match(script, /COMPATIBLE_PROVIDER_VALUE_PREFIX/);
  assert.match(script, /国内模型服务商/);
  assert.match(script, /compatiblePresets\(\)\.filter\(preset => preset\.id !== 'custom'\)/);
  assert.match(script, /providerSelectionDescriptor/);
  assert.match(script, /providerSelectionValue/);
  assert.match(html, /国内服务商已独立列出/);
});

test('profile names save independently on blur or Enter and update the list preview', () => {
  assert.match(html, /按 Enter 或移开焦点即可单独保存名称/);
  assert.match(script, /profileName'\)\.addEventListener\('blur', persistProfileName\)/);
  assert.match(script, /event\.key !== 'Enter'/);
  assert.match(script, /function persistProfileName\(/);
  assert.match(script, /type: 'LLM_SAVE_PROFILE'/);
  assert.match(script, /function updateProfileListPreview\(/);
});

test('a successful profile rename refreshes every per-feature model selector without resetting drafts', async () => {
  const start = script.indexOf('async function persistProfileName(');
  const end = script.indexOf('\nfunction friendlyError(', start);
  const source = script.slice(start, end);
  const input = { value: '视觉模型' };
  const profile = { id: 'profile_a', name: '旧名称' };
  const draftMarker = { reasoningEffort: 'high', tokenRule: 'auto' };
  const calls = [];
  const context = {
    selectedProfileId: 'profile_a',
    state: { settings: { profiles: { profile_a: profile } } },
    taskPolicyDrafts: new Map([['figure_walkthrough', draftMarker]]),
    profileDirtyFields: new Set(['profileName', 'llmTaskPolicyTable']),
    profileEditorDirty: true,
    pendingProfileRenames: new Map(), activeProfileRename: null, profileRenameTask: null,
    document: { getElementById(id) { return id === 'profileName' ? input : null; } },
    profileById() { return profile; },
    beginProfileAction() { return true; },
    async callBackground() { return { profile: { name: '视觉模型' } }; },
    renderProfileList() { calls.push('profiles'); },
    updateProfileListPreview() {},
    renderTaskPolicyTable() { calls.push('table'); },
    showStatus() {},
    friendlyError(error) { return error.message; },
    endProfileAction() { calls.push('end'); }
  };
  vm.runInNewContext(`${draftTrackingSource}\n${source}\nglobalThis.rename = persistProfileName;`, context);
  await context.rename();
  assert.equal(profile.name, '视觉模型');
  assert.deepEqual(calls, ['profiles', 'table', 'end']);
  assert.equal(context.taskPolicyDrafts.get('figure_walkthrough'), draftMarker);
  assert.equal(context.profileDirtyFields.has('llmTaskPolicyTable'), true);
});

test('unrelated settings state refreshes preserve unsaved per-task policy drafts', () => {
  const start = script.indexOf('function applyState(');
  const end = script.indexOf('\nfunction renderKeyboardShortcutSettings', start);
  const source = script.slice(start, end);
  const marker = { reasoningEffort: 'xhigh', tokenRule: { output: { floor: 4096 } } };
  const taskPolicyDrafts = new Map([['article_chat', marker]]);
  const elements = new Proxy({}, {
    get(target, id) {
      if (!target[id]) target[id] = { value: '', checked: false, textContent: '' };
      return target[id];
    }
  });
  let syncCount = 0;
  const context = {
    state: null,
    selectedProfileId: 'profile_a',
    taskPolicyDrafts,
    profileDirtyFields: new Set(),
    analysisModeEditorDirty: true,
    keyboardShortcutEditorDirty: true,
    literatureUrlDirty: false,
    document: { getElementById(id) { return elements[id]; } },
    SciLLM: { setInterfaceLanguage() {} },
    profileEntries() { return [['profile_a', { id: 'profile_a' }]]; },
    profileById() { return { id: 'profile_a' }; },
    syncTaskPolicyDraftsFromState() { syncCount += 1; taskPolicyDrafts.clear(); },
    renderPanelFollowupPresets() {}, renderArticleChatQuickPrompts() {},
    renderLiteratureNoteTemplates() {}, renderSelectionLlmActions() {},
    renderAnalysisModeEditor() {}, renderKeyboardShortcutSettings() {},
    renderProfileEditor() {}, renderTaskPolicyTable() {}, renderCustomCategories() {},
    renderDeletedBuiltInCategories() {}, renderCategoryList() {}, renderSettingsOverview() {}
  };
  vm.runInNewContext(`${draftTrackingSource}\n${source}\nglobalThis.apply = applyState;`, context);
  context.apply({ settings: { profiles: { profile_a: {} }, language: 'en' }, llmReady: true });
  assert.equal(syncCount, 0);
  assert.equal(taskPolicyDrafts.get('article_chat'), marker);
  context.apply(
    { settings: { profiles: { profile_a: {} }, language: 'zh-CN' }, llmReady: true },
    { replaceTaskPolicyDrafts: true }
  );
  assert.equal(syncCount, 1);
});

test('deleting a profile explicitly resyncs task drafts that may reference it', () => {
  const start = script.indexOf('async function deleteApiProfile(');
  const end = script.indexOf('\nasync function persistForm(', start);
  const source = script.slice(start, end);
  assert.match(source, /applyState\(result,\s*\{\s*replaceTaskPolicyDrafts:\s*true\s*\}\)/);
});

test('directory index rebuild preserves dirty per-task policy and token drafts', async () => {
  const start = script.indexOf('async function confirmRebuildUserDataIndex(');
  const end = script.indexOf('\nasync function exportUserDataBundle(', start);
  const marker = { tokenRule: { output: { floor: 6144 } }, reasoningEffort: 'high' };
  const taskPolicyDrafts = new Map([['article_chat', marker]]);
  const refreshArguments = [];
  const context = {
    userDataUi: { pendingAction: false },
    document: { getElementById() { return { close() {} }; } },
    rejectBlockedManualDirectoryAction() { return false; },
    setUserDataActionPending() {}, showUserDataStatus() {},
    async callBackground() { return { imported: 1, stale: 0 }; },
    async refreshAfterPortableConfigNotReady() { return false; },
    async refreshSettings(options) {
      refreshArguments.push(options);
      if (options?.replaceTaskPolicyDrafts) taskPolicyDrafts.clear();
    },
    async refreshUserDataStatus() {}, friendlyError(error) { return error.message; }
  };
  vm.runInNewContext(
    `${script.slice(start, end)}\nglobalThis.rebuild = confirmRebuildUserDataIndex;`,
    context
  );
  await context.rebuild({ preventDefault() {} });
  assert.equal(taskPolicyDrafts.get('article_chat'), marker);
  assert.deepEqual(refreshArguments, [undefined]);
});

test('portable backup creation preserves dirty drafts while unlock replaces restored settings', async () => {
  const start = script.indexOf('// Portable config activation: start.');
  const end = script.indexOf('// Portable config activation: end.');
  const marker = { tokenRule: { output: { floor: 7168 } }, reasoningEffort: 'xhigh' };
  const taskPolicyDrafts = new Map([['figure_walkthrough', marker]]);
  const reloadArguments = [];
  const context = { Error };
  vm.runInNewContext(
    `${script.slice(start, end)}\nglobalThis.activate = activatePortableConfigFromStatusCard;`,
    context
  );
  const dependencies = {
    openDialog: async () => ({ state: 'ready' }),
    call: async () => ({}),
    reloadSettings: async options => {
      reloadArguments.push(options);
      if (options?.replaceTaskPolicyDrafts) taskPolicyDrafts.clear();
    },
    refreshStatus: async () => true,
    isOnboardingActive: () => false,
    markStorageCompleted: async () => {},
    renderStatus() {}, showStatus() {}, errorText: error => error.message
  };
  const created = await context.activate({ currentState: 'missing', ...dependencies });
  assert.equal(created.completed, true);
  assert.equal(taskPolicyDrafts.get('figure_walkthrough'), marker);
  assert.deepEqual(reloadArguments, []);

  const unlocked = await context.activate({ currentState: 'locked', ...dependencies });
  assert.equal(unlocked.completed, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(reloadArguments)),
    [{ replaceTaskPolicyDrafts: true }]
  );
  assert.equal(taskPolicyDrafts.size, 0);
});

test('profile-save success followed by routing-save failure restores routing and token drafts for retry', async () => {
  const snapshotStart = script.indexOf('function snapshotTaskPolicyDrafts(');
  const persistStart = script.indexOf('async function persistForm(');
  const persistEnd = script.indexOf('\nasync function testProvider', persistStart);
  assert.ok(snapshotStart >= 0 && persistStart > snapshotStart && persistEnd > persistStart);
  const helperSource = script.slice(snapshotStart, script.indexOf('\nfunction collectProfile(', snapshotStart));
  const persistSource = script.slice(persistStart, persistEnd);
  const originalDraft = {
    mode: 'profile', profileId: 'vision', reasoningEnabled: true,
    reasoningEffort: 'high', tokenRule: { input: { reservedTokens: 2048 }, output: { floor: 4096 } },
    allowTextFallback: false
  };
  const taskPolicyDrafts = new Map([['figure_walkthrough', originalDraft]]);
  const globalSelect = { value: 'vision' };
  const elements = new Proxy({}, {
    get(target, id) {
      if (!target[id]) target[id] = id === 'globalProfileId'
        ? globalSelect : { value: id === 'analysisMode' ? 'llm' : '', checked: true };
      return target[id];
    }
  });
  const calls = [];
  const context = {
    taskPolicyDrafts,
    selectedProfileId: 'profile_a',
    profileDirtyFields: new Set(),
    profileEditorDirty: true,
    cloneTaskTokenRule(rule) {
      return rule === 'auto' ? 'auto' : {
        input: { ...(rule?.input || {}) }, output: { ...(rule?.output || {}) }
      };
    },
    onboardingUi: { active: false },
    activeModelDiscovery: null,
    document: {
      getElementById(id) { return elements[id]; },
      querySelectorAll() { return []; }
    },
    collectProfile() { return { id: 'profile_a', providerId: 'openai', config: {} }; },
    profileById() { return { id: 'profile_a', providerId: 'openai', config: { hasApiKey: true } }; },
    collectTaskPolicies() { return { figure_walkthrough: { ...originalDraft } }; },
    collectPanelFollowupPresets() { return []; }, panelFollowupPromptMap() { return {}; },
    collectArticleChatQuickPrompts() { return []; }, collectLiteratureNoteTemplates() { return []; },
    collectSelectionLlmActions() { return []; }, requestEndpointPermission() {},
    beginProfileAction() { return true; }, endProfileAction() {},
    async callBackground(message) {
      calls.push(message.type);
      if (message.type === 'LLM_SAVE_PROFILE') return { profile: { id: 'profile_a' }, settings: {} };
      throw new Error('routing rejected');
    },
    applyState() { taskPolicyDrafts.clear(); globalSelect.value = ''; },
    showStatus(message, type) { calls.push([type, message]); },
    friendlyError(error) { return error.message; }, clearProfileEditorDirty() { calls.push('clean'); },
    setOnboardingStepState() {}, hasUsableApiConfiguration() { return false; },
    updateUserDataActionButtons() {}, renderOnboarding() {}, renderTaskPolicyTable() { calls.push('table'); }
  };
  vm.runInNewContext(`${draftTrackingSource}\n${helperSource}\n${persistSource}\nglobalThis.save = persistForm;`, context);
  await assert.rejects(context.save(false), /routing rejected/);
  assert.deepEqual(calls.slice(0, 2), ['LLM_SAVE_PROFILE', 'LLM_UPDATE_PROFILE_ROUTING']);
  assert.equal(taskPolicyDrafts.get('figure_walkthrough').reasoningEffort, 'high');
  assert.equal(taskPolicyDrafts.get('figure_walkthrough').tokenRule.output.floor, 4096);
  assert.equal(globalSelect.value, 'vision');
  assert.equal(calls.includes('clean'), false);
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'error'));
});

test('English task-policy renderer copy covers every catalog task without dynamic Chinese', () => {
  const start = script.indexOf('function taskPolicyUiText(');
  const end = script.indexOf('\nfunction profileForTaskPolicy(', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    SciLLM: { translateInterfaceText(value) { return i18n.translateInterfaceText(value, 'en'); } }
  };
  vm.runInNewContext(`${script.slice(start, end)}\nglobalThis.copy = taskPolicyUiText;`, context);
  taskCatalog.TASK_DEFINITIONS.forEach(definition => {
    const copy = context.copy(definition);
    assert.equal(Object.values(copy).some(value => /[\u3400-\u9fff]/u.test(String(value))), false,
      `${definition.id}: ${JSON.stringify(copy)}`);
  });
  const renderer = script.slice(
    script.indexOf('function renderTaskPolicyTable('),
    script.indexOf('\nfunction handleTaskPolicyTableChange', script.indexOf('function renderTaskPolicyTable('))
  );
  assert.match(renderer, /taskPolicyUiText\(definition\)/);
  assert.doesNotMatch(renderer, /definition\.labelZh/);
});

test('native token-rule dialog cancellation clears the active task id', () => {
  const start = script.indexOf('function clearActiveTaskTokenRuleId(');
  const end = script.indexOf('\nfunction collectProfile(', start);
  assert.ok(start >= 0 && end > start);
  const context = { activeTaskTokenRuleId: 'figure_walkthrough' };
  vm.runInNewContext(
    `${script.slice(start, end)}\nglobalThis.cancel = clearActiveTaskTokenRuleId;`,
    context
  );
  context.cancel();
  assert.equal(context.activeTaskTokenRuleId, '');
});

test('blank required token-rule numbers are rejected instead of coercing to zero', () => {
  const validateStart = script.indexOf('function validateTaskTokenRuleDraft(');
  const validateEnd = script.indexOf('\nfunction taskTokenPreviewCapacity', validateStart);
  const values = {
    safetyRatio: '0.8', reservedTokens: '', sourceCapTokens: '', maxUnits: '10',
    base: '0', perUnit: '10', floor: '512', ceiling: '4096',
    truncationRetries: '0', retryMultiplier: '1.5'
  };
  const inputs = Object.entries(values).map(([field, value]) => ({
    value,
    dataset: { tokenRuleField: field },
    closest() { return { querySelector() { return { textContent: field }; } }; }
  }));
  const context = {
    activeTaskTokenRuleId: 'article_chat',
    TOKEN_RULE_FIELD_SPECS: {
      safetyRatio: { section: 'input', minimum: 0.5, maximum: 1 },
      reservedTokens: { section: 'input', minimum: 0, maximum: 2000000, integer: true },
      sourceCapTokens: { section: 'input', minimum: 1, maximum: 2000000, integer: true, optional: true },
      maxUnits: { section: 'input', minimum: 1, maximum: 1000000, integer: true },
      base: { section: 'output', minimum: 0, maximum: 2000000 },
      perUnit: { section: 'output', minimum: 0, maximum: 2000000 },
      floor: { section: 'output', minimum: 512, maximum: 2000000, integer: true },
      ceiling: { section: 'output', minimum: 512, maximum: 2000000, integer: true },
      truncationRetries: { section: 'output', minimum: 0, maximum: 10, integer: true },
      retryMultiplier: { section: 'output', minimum: 1.01, maximum: 4 }
    },
    document: { querySelectorAll() { return inputs; } },
    interfaceText(value) { return value; },
    SciLLM: { normalizeTaskTokenRule(taskId, rule) { return rule; } }
  };
  vm.runInNewContext(
    `${script.slice(validateStart, validateEnd)}` +
      '\nglobalThis.validate = validateTaskTokenRuleDraft;',
    context
  );
  const result = context.validate();
  assert.equal(result.valid, false);
  assert.match(result.error, /reservedTokens.*不能为空/);
});

test('English task-policy statuses, reasoning tooltips, and global-profile copy are centralized', () => {
  for (const sourceText of [
    '使用全局默认', '未配置', '不支持图片', '缺少模型', '能力不匹配', '可用',
    '当前模型仅支持推理开关，不支持强度分级。',
    '不可选强度会由服务商规则归一到最接近的级别。',
    '当前模型不支持可配置推理。'
  ]) {
    const translated = i18n.translateInterfaceText(sourceText, 'en');
    assert.equal(/[\u3400-\u9fff]/u.test(translated), false, `${sourceText}: ${translated}`);
  }
});

test('local Codex settings own login, status, and logout controls', () => {
  for (const id of [
    'codexLocalFields', 'codexAuthStatus', 'codexReverseChannelStatus', 'codexLogin',
    'codexRefreshStatus', 'codexLogout'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /function startCodexLogin\(/);
  assert.match(script, /function refreshCodexAuthStatus\(/);
  assert.match(script, /function renderCodexReverseChannelStatus\(/);
  assert.match(script, /function logoutCodex\(/);
  assert.match(script, /CODEX_LOCAL_LOGIN_START/);
  assert.match(script, /CODEX_LOCAL_STATUS/);
  assert.match(script, /CODEX_LOCAL_LOGOUT/);
  assert.match(script, /chrome\.tabs\.create/);
});

test('compatible preset editing is scoped to the selected profile and preserves masked keys', () => {
  assert.match(script, /selectedProfileId/);
  assert.match(script, /function collectProfile\(/);
  assert.match(script, /function renderProfileEditor\(/);
  assert.match(script, /apiKey.*value\.trim\(\)/);
  assert.match(script, /delete config\.apiKey|apiKey\.value\.trim/);
  assert.match(script, /supportsVision/);
});

test('provider switching recomputes vision capability instead of inheriting the previous profile', () => {
  assert.match(script, /function providerVisionCapability\(/);
  assert.match(script, /providerVisionCapability\(providerId, config\)/);
  const start = script.indexOf('function providerVisionCapability(');
  const end = script.indexOf('\n}', start) + 2;
  const source = script.slice(start, end);
  const context = {
    state: {
      providers: {
        openai: { supportsVision: true },
        deepseek: { supportsVision: false },
        'openai-compatible': { supportsVision: false }
      }
    },
    SciLLM: {
      getProviderCapabilities(providerId, config) {
        return {
          supportsVision: providerId === 'openai' ||
            (providerId === 'deepseek' && config.model === 'deepseek-v4-flash-vision-exp') ||
            (providerId === 'openai-compatible' && config.supportsVision === true)
        };
      }
    }
  };
  vm.runInNewContext(`${source}\nglobalThis.result = [
    providerVisionCapability('openai', {}),
    providerVisionCapability('deepseek', {}),
    providerVisionCapability('deepseek', { model: 'deepseek-v4-flash-vision-exp' }),
    providerVisionCapability('openai-compatible', {}),
    providerVisionCapability('openai-compatible', { supportsVision: true })
  ];`, context);
  assert.deepEqual([...context.result], [true, false, true, false, true]);
  assert.match(script, /renderTaskPolicyTable[\s\S]*providerVisionCapability/);
});

test('new profiles default to registry vision capability and unknown providers are text-only', () => {
  const addStart = script.indexOf('async function addApiProfile(');
  const addEnd = script.indexOf('\n}', addStart) + 2;
  const addSource = script.slice(addStart, addEnd);
  assert.match(addSource, /providerVisionCapability\(providerId/);
  assert.doesNotMatch(addSource, /providerId !== ['"]openai-compatible['"]/);
});

test('Figure settings allow text profiles and show caption/body capability while strict visual tasks stay guarded', () => {
  const context = {
    document: { createElement: () => ({}) },
    providerVisionCapability: (_provider, config) => config.supportsVision === true,
    profileOptionLabel: profile => profile.name,
    interfaceText: value => value,
    effectiveTaskProfile: () => ({ profile: { providerId: 'deepseek', config: { model: 'deepseek-v4-flash' } } })
  };
  {
    const start = script.indexOf('function profileSupportsTaskDefinition(');
    const end = script.indexOf('\n}', start) + 2;
    vm.runInNewContext(script.slice(start, end), context);
  }
  for (const name of ['appendTaskProfileOption', 'taskPolicyStatus']) {
    const start = script.indexOf(`function ${name}(`);
    const end = script.indexOf('\n}', start) + 2;
    vm.runInNewContext(script.slice(start, end), context);
  }
  for (const taskId of ['figure_walkthrough', 'figure_panel_interpretation', 'figure_panel_followup']) {
    const task = taskCatalog.getLlmTaskDefinition(taskId);
    const options = [];
    context.appendTaskProfileOption({appendChild: option => options.push(option)}, task, 'text-profile', { name: 'Text model', config: {} });
    assert.equal(options[0].disabled, false, taskId);
    assert.match(options[0].textContent, /正文.*图注|图注.*正文/);
    assert.equal(context.taskPolicyStatus(task, {}).key, 'available');
  }
  const strict = { requirements: { vision: true } };
  const options = [];
  context.appendTaskProfileOption({appendChild: option => options.push(option)}, strict, 'text-profile', { name: 'Text model', config: {} });
  assert.equal(options[0].disabled, true);
  assert.equal(context.taskPolicyStatus(strict, {}).key, 'mismatch');
  assert.match(script, /definition\.requirements\?\.vision\s*===\s*true/);
  assert.match(script, /能力不匹配/);
  assert.match(script, /缺少模型/);
  assert.match(script, /可用/);
  assert.match(script, /dataset\.taskPolicyStatus/);
  assert.doesNotMatch(html, /带“多模态模型”标记的功能必须选择/);
});

test('per-task reasoning controls use the fixed effort vocabulary and provider normalization', () => {
  assert.match(script, /TASK_REASONING_EFFORTS\s*=\s*Object\.freeze\(\[\s*'auto',\s*'minimal',\s*'low',\s*'medium',\s*'high',\s*'xhigh',\s*'max'/s);
  assert.match(script, /SciLLM\.getProviderReasoningCapabilities/);
  assert.match(script, /SciLLM\.normalizeReasoningForProvider/);
  assert.match(script, /effortSelect\.disabled\s*=\s*!reasoningToggle\.checked/);
  assert.match(script, /option\.disabled\s*=\s*!supportedEfforts\.has\(effort\)/);
});

test('unsaved profile navigation is blocked without confirm and duplicate actions are rejected', () => {
  const guardStart = script.indexOf('function canLeaveProfileEditor(');
  const guardEnd = script.indexOf('\n}', guardStart) + 2;
  const beginStart = script.indexOf('function beginProfileAction(');
  const beginEnd = script.indexOf('\n}', beginStart) + 2;
  const endStart = script.indexOf('function endProfileAction(');
  const endEnd = script.indexOf('\n}', endStart) + 2;
  const context = {
    profileEditorDirty: true,
    profileDirtyFields: new Set(['model']),
    profileActionInFlight: {},
    window: {},
    showStatus() {}
  };
  vm.runInNewContext(`${draftTrackingSource}\n${script.slice(guardStart, guardEnd)}\n${script.slice(beginStart, beginEnd)}\n${script.slice(endStart, endEnd)}\nglobalThis.results = [canLeaveProfileEditor('switch'), beginProfileAction('duplicate'), beginProfileAction('duplicate')];`, context);
  assert.deepEqual([...context.results], [false, true, false]);
  vm.runInNewContext('endProfileAction(\'duplicate\'); globalThis.after = beginProfileAction(\'duplicate\');', context);
  assert.equal(context.after, true);
});

test('save guard always releases and test action handles a guarded save result', () => {
  const persistStart = script.indexOf('async function persistForm(');
  const persistEnd = script.indexOf('\nasync function testProvider', persistStart);
  const persistSource = script.slice(persistStart, persistEnd);
  assert.match(persistSource, /finally\s*\{[\s\S]*endProfileAction\(['"]save['"]\)/);
  assert.match(persistSource, /previousDisabledStates\s*=\s*new Map/);
  assert.match(persistSource, /previousDisabledStates\.get\(button\)/);
  const testStart = script.indexOf('async function testProvider(');
  const testEnd = script.indexOf('\nfunction friendlyError', testStart);
  const testSource = script.slice(testStart, testEnd);
  assert.match(testSource, /persistForm\(true\)/);
  assert.match(testSource, /if\s*\(!saved\)/);
  assert.match(testSource, /#providerSettings input/);
  assert.match(testSource, /previousDisabledStates\s*=\s*new Map/);
  assert.match(testSource, /testButton\?\.setAttribute\(['"]aria-busy['"], ['"]true['"]\)/);
  assert.match(testSource, /testButton\?\.removeAttribute\(['"]aria-busy['"]\)/);
  assert.match(testSource, /controls\.forEach\(control\s*=>\s*\{[\s\S]*previousDisabledStates\.get\(control\)/);
  const beginStart = script.indexOf('function beginProfileAction(');
  const beginEnd = script.indexOf('\n}', beginStart) + 2;
  const endStart = script.indexOf('function endProfileAction(');
  const endEnd = script.indexOf('\n}', endStart) + 2;
  const context = { profileActionInFlight: {} };
  vm.runInNewContext(`${script.slice(beginStart, beginEnd)}\n${script.slice(endStart, endEnd)}\nglobalThis.first = beginProfileAction('test'); globalThis.second = beginProfileAction('test'); endProfileAction('test'); globalThis.third = beginProfileAction('test');`, context);
  assert.deepEqual([context.first, context.second, context.third], [true, false, true]);
});

test('compatible preset changes participate in profile dirty tracking', () => {
  const bindStart = script.indexOf('function bindEvents(');
  const bindEnd = script.indexOf('\nasync function callBackground', bindStart);
  const bindSource = script.slice(bindStart, bindEnd);
  const presetStart = script.indexOf('function applyCompatiblePreset(');
  const presetEnd = script.indexOf('\nfunction markCompatiblePresetCustom', presetStart);
  const presetSource = script.slice(presetStart, presetEnd);
  assert.match(bindSource, /compatiblePreset/);
  assert.match(bindSource, /markProfileEditorDirty/);
  assert.match(presetSource, /markProfileEditorDirty\(/);
});

test('vision profile testing requests and labels every multimodal diagnostic stage', () => {
  const idsStart = script.indexOf('function providerProbeIds(');
  const idsEnd = script.indexOf('\nfunction formatProviderProbeSummary(', idsStart);
  const summaryEnd = script.indexOf('\nfunction formatProviderConnectionStatus(', idsEnd);
  const presentationEnd = script.indexOf('\nfunction modelDiscoveryCacheKey(', summaryEnd);
  assert.ok(idsStart >= 0 && idsEnd > idsStart && summaryEnd > idsEnd &&
    presentationEnd > summaryEnd);
  const context = {};
  vm.runInNewContext(
    `${script.slice(idsStart, presentationEnd)}` +
      '\nglobalThis.ids = providerProbeIds; globalThis.summary = formatProviderProbeSummary;' +
      'globalThis.presentation = providerConnectionPresentation;',
    context
  );

  assert.deepEqual([...context.ids(true, true)], [
    'connectivity', 'vision_input', 'json_output', 'reasoning_structured'
  ]);
  assert.deepEqual([...context.ids(false, true)], [
    'connectivity', 'vision_input', 'json_output', 'reasoning_structured'
  ]);
  assert.deepEqual([...context.ids(true, false)], [
    'connectivity', 'reasoning_structured'
  ]);

  const result = {
    connected: true,
    connectivity: true,
    capabilitiesReady: false,
    providerId: 'deepseek',
    model: 'deepseek-v4-flash-vision-exp',
    probes: [
      { id: 'connectivity', status: 'passed' },
      { id: 'vision_input', status: 'failed' },
      { id: 'json_output', status: 'blocked' },
      { id: 'reasoning_structured', status: 'unsupported' }
    ],
    warnings: [{ probeId: 'vision_input' }],
    estimatedInputTokens: 42,
    measuredInputTokens: null
  };
  const chinese = context.summary(result, 'zh-CN');
  assert.match(chinese, /基础文本：通过/);
  assert.match(chinese, /图片输入：失败/);
  assert.match(chinese, /图片与 JSON Schema：已阻止/);
  assert.match(chinese, /结构化推理：不支持/);
  assert.match(chinese, /1 项不支持/);
  assert.match(chinese, /1 项已阻止/);
  const english = context.summary(result, 'en');
  assert.match(english, /Connectivity: passed/);
  assert.match(english, /Image input: failed/);
  assert.match(english, /Image and JSON Schema: blocked/);
  assert.match(english, /Structured reasoning: unsupported/);
  assert.match(english, /1 unsupported/);
  assert.match(english, /1 blocked/);

  const incompatible = context.presentation(result, '', 'zh-CN');
  assert.equal(incompatible.state, 'error');
  assert.match(incompatible.message, /基础连接成功/);
  assert.match(incompatible.message, /视觉工作流兼容性检查未通过/);
  assert.doesNotMatch(incompatible.message, /^连接成功：/);
  const compatible = context.presentation({
    ...result,
    capabilitiesReady: true,
    probes: result.probes.map(item => ({ ...item, status: 'passed' })),
    warnings: []
  }, '', 'zh-CN');
  assert.equal(compatible.state, 'success');
  assert.match(compatible.message, /^连接成功：/);

  const privateStatus = 'PRIVATEALPHANUMERICKEY987654321';
  const failClosed = context.summary({
    probes: [{ id: 'connectivity', status: privateStatus }],
    warnings: [], estimatedInputTokens: 1, measuredInputTokens: null
  }, 'en');
  assert.match(failClosed, /Connectivity: not tested/);
  assert.doesNotMatch(failClosed, /unknown|PRIVATEALPHANUMERIC/i);

  assert.match(html, /合成文本、微型 PNG 和 JSON Schema/);
  assert.match(html, /绝不发送当前论文内容/);
  assert.match(html, /仅文本配置：额外测试结构化推理/);
  assert.doesNotMatch(html, /同时测试结构化推理（可选）/);
});

test('provider test derives vision capability before selecting diagnostic probes', () => {
  const start = script.indexOf('async function testProvider(');
  const end = script.indexOf('\nfunction friendlyError', start);
  const source = script.slice(start, end);
  assert.match(source, /providerVisionCapability\(/);
  assert.match(source, /providerProbeIds\([\s\S]*supportsVision/);
});

test('provider test localizes progress from all three actual probe selections', async () => {
  const idsStart = script.indexOf('function providerProbeIds(');
  const idsEnd = script.indexOf('\nfunction formatProviderProbeSummary(', idsStart);
  const start = script.indexOf('async function testProvider(');
  const end = script.indexOf('\nfunction friendlyError', start);
  const source = script.slice(start, end);

  async function runProgress({ supportsVision, includeReasoning }) {
    const statuses = [];
    let requestedProbeIds = null;
    const section = { setAttribute() {}, removeAttribute() {} };
    const testButton = { setAttribute() {}, removeAttribute() {} };
    const elements = {
      providerSettings: section,
      testProvider: testButton,
      testReasoningStructured: { checked: includeReasoning },
      globalLanguage: { value: 'en' }
    };
    const context = {
      beginProfileAction: () => true,
      endProfileAction() {},
      renderOnboarding() {},
      document: {
        querySelectorAll: () => [],
        getElementById: id => elements[id] || null
      },
      showStatus(message, state) { statuses.push({ message, state }); },
      persistForm: async () => ({ profileId: 'profile' }),
      profileById: () => ({ providerId: 'deepseek', config: {} }),
      providerVisionCapability: () => supportsVision,
      callBackground: async request => {
        requestedProbeIds = request.probeIds;
        return { probes: [] };
      },
      providerConnectionPresentation: () => ({ message: 'done', state: 'success' }),
      friendlyError: () => 'safe failure',
      interfaceText: value => i18n.translateInterfaceText(value, 'en')
    };
    vm.runInNewContext(
      `${script.slice(idsStart, idsEnd)}\n${source}` +
        '\nglobalThis.runProviderTest = testProvider;',
      context
    );
    await context.runProviderTest();
    return { statuses, requestedProbeIds: [...requestedProbeIds] };
  }

  const connectivity = await runProgress({
    supportsVision: false, includeReasoning: false
  });
  assert.deepEqual(connectivity.requestedProbeIds, ['connectivity']);
  assert.deepEqual(connectivity.statuses[0], {
    message: 'Testing connectivity with extension-bundled synthetic text only; ' +
      'no content from the current paper is sent.',
    state: 'info'
  });

  const textReasoning = await runProgress({
    supportsVision: false, includeReasoning: true
  });
  assert.deepEqual(textReasoning.requestedProbeIds, [
    'connectivity', 'reasoning_structured'
  ]);
  assert.deepEqual(textReasoning.statuses[0], {
    message: 'Testing with extension-bundled synthetic text and a JSON Schema; ' +
      'no content from the current paper is sent.',
    state: 'info'
  });

  const vision = await runProgress({
    supportsVision: true, includeReasoning: false
  });
  assert.deepEqual(vision.requestedProbeIds, [
    'connectivity', 'vision_input', 'json_output', 'reasoning_structured'
  ]);
  assert.deepEqual(vision.statuses[0], {
    message: 'Testing with extension-bundled synthetic text, a tiny PNG, and a JSON Schema; ' +
      'no content from the current paper is sent.',
    state: 'info'
  });
});
