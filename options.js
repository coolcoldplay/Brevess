const OFFICIAL_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/responses',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  deepseek: 'https://api.deepseek.com/chat/completions',
  typesafe: 'https://api.typesafe.ai/v1/systemone'
};
const COMPATIBLE_PROVIDER_VALUE_PREFIX = 'compatible:';
const MODEL_DISCOVERY_CACHE_MS = 5 * 60 * 1000;
const MISSING_PROFILE_DRAFT_MESSAGE =
  '当前配置已被其他窗口删除；未保存草稿已保留。请选择其他配置或放弃草稿后继续。';
const TASK_REASONING_EFFORTS = Object.freeze([
  'auto', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'
]);
const TASK_REASONING_LABELS = Object.freeze({
  auto: '自动', minimal: '最小', low: '低', medium: '中', high: '高',
  xhigh: '极高', max: '最高'
});
const TRANSLATION_TASK_POLICY_IDS = new Set(['full_text_translation', 'navigation_title_translation']);
const TASK_POLICY_MODULES = Object.freeze([
  { id: 'general', label: '全局与通用', tasks: ['full_text_translation', 'abbreviation_translation'] },
  { id: 'navigation', label: '导航', tasks: ['navigation_title_translation', 'article_outline_summary'] },
  { id: 'reading', label: '摘句与高亮', tasks: ['document_highlight', 'semantic_find', 'paragraph_summary', 'evidence_ledger_review'] },
  { id: 'figure', label: '图表', tasks: ['figure_walkthrough', 'figure_panel_interpretation', 'figure_panel_followup', 'cross_figure_mechanism'] },
  { id: 'chat', label: '问答', tasks: ['article_chat', 'selection_chat'] },
  { id: 'paper_review', label: '笔记', tasks: ['literature_note_autofill', 'paper_research_logic', 'paper_innovations', 'paper_limitations'] }
]);
const COMMON_TASK_POLICY_IDS = new Set([
  'article_chat', 'selection_chat', 'figure_walkthrough',
  'figure_panel_interpretation', 'literature_note_autofill', 'semantic_find'
]);
const TOKEN_RULE_FIELD_SPECS = Object.freeze({
  safetyRatio: Object.freeze({ section: 'input', minimum: 0.5, maximum: 1 }),
  reservedTokens: Object.freeze({ section: 'input', minimum: 0, maximum: 2000000, integer: true }),
  sourceCapTokens: Object.freeze({ section: 'input', minimum: 1, maximum: 2000000, integer: true, optional: true }),
  maxUnits: Object.freeze({ section: 'input', minimum: 1, maximum: 1000000, integer: true }),
  base: Object.freeze({ section: 'output', minimum: 0, maximum: 2000000 }),
  perUnit: Object.freeze({ section: 'output', minimum: 0, maximum: 2000000 }),
  floor: Object.freeze({ section: 'output', minimum: 512, maximum: 2000000, integer: true }),
  ceiling: Object.freeze({ section: 'output', minimum: 512, maximum: 2000000, integer: true }),
  truncationRetries: Object.freeze({ section: 'output', minimum: 0, maximum: 10, integer: true }),
  retryMultiplier: Object.freeze({ section: 'output', minimum: 1.01, maximum: 4 })
});

let state = null;
let selectedProfileId = '';
let profileEditorDirty = false;
const profileDirtyFields = new Set();
const settingsDraftRevisions = new Map();
let settingsDraftRevision = 0;
const discoveredModels = new Map();
// Revisions bind account/endpoint edits without retaining credentials in cache keys.
const modelDiscoveryRevisions = new Map();
const providerVerificationResults = new Map();
const modelDiscoveryRequests = new Map();
let modelDiscoveryTimer = null;
let modelDiscoveryGeneration = 0;
let activeModelDiscovery = null;
let keyboardShortcutEditorDirty = false;
let keyboardShortcutEditorRevision = 0;
let ttsEditorDirty = false;
let ttsEditorRevision = 0;
let literatureUrlDirty = false;
let literatureUrlRevision = 0;
let ttsDraft = null;
let ttsPlayback = null;
const ttsVoiceDiscovery = { key: '', loaded: false, pending: null, generation: 0, voices: [], open: true };
let analysisModeEditorDirty = false;
let analysisModeEditorModes = [];
let selectedAnalysisModeId = '';
const profileActionInFlight = Object.create(null);
const pendingProfileRenames = new Map();
let activeProfileRename = null;
let profileRenameTask = null;
let profileMutationInFlight = false;
let profileMutationDisabledStates = null;
let profileMutationOwnerId = '';
const taskPolicyDrafts = new Map();
let activeTaskTokenRuleId = '';
let pdfMineruSettingsState = SciLLM.normalizeMineruPdfSettings();
const categoryEditor = {
  categoryId: '',
  detail: null,
  dirty: false,
  pending: false,
  search: '',
  queuedCategoryId: '',
  pendingNavigationId: '',
  navigationTrigger: null,
  requestSequence: 0,
  activeRequestToken: 0,
  activeRequestCategoryId: '',
  acceptedHash: ''
};
const userDataUi = {
  pendingAction: false,
  statusRequestSequence: 0,
  activeStatusToken: 0,
  lastStatus: null,
  portableConfigStatus: null,
  directoryHandle: null,
  handleLoaded: false
};
const portableConfigUi = {
  mode: '',
  submitting: false,
  dialogPromise: null,
  resolveDialog: null,
  pendingResult: null
};
const ARTICLE_WORKSPACE_PAGE_SIZE = 20;
const ARTICLE_WORKSPACE_READ_TIMEOUT_MS = 15000;
const articleWorkspaceOverviewUi = {
  items: [],
  details: new Map(),
  detailRequests: new Map(),
  selected: new Set(),
  query: '',
  sort: 'updated_desc',
  page: 1,
  loading: false,
  requestSequence: 0,
  totals: null,
  sync: null
};
const onboardingUi = {
  active: false,
  step: 'storage',
  pending: false,
  finishPrepared: false,
  state: null
};
const codexAuthUi = {
  pending: false,
  pollTimer: null,
  pollDeadline: 0
};
const harnessAuthUi = { pending: false, generation: 0, binding: '' };
let pendingMigrationBundle = null;
const SETTINGS_PAGE_ORDER = [
  'overview', 'storage', 'models', 'workbench', 'modes',
  'categories', 'reading', 'shortcuts', 'data', 'about'
];
const SETTINGS_PAGE_COPY = Object.freeze({
  workbench: {
    eyebrow: 'Brevess · 课题工作台',
    title: '假说梳理与组图规划',
    subtitle: '课题独立保存在本机；授权目录后可同步项目与素材。'
  },
  overview: {
    eyebrow: 'Brevess · 设置中心',
    title: '先确认关键能力，再按需要细调',
    subtitle: '基础阅读无需 AI；模型、本地保存和正文发送许可都可以独立配置。'
  },
  categories: {
    eyebrow: 'Brevess · 规则工作区',
    title: '让每一种证据都有清楚的判定边界',
    subtitle: '新增、修改或删除类别，并分别维护 AI 提示词和离线正则规则。'
  },
  modes: {
    eyebrow: 'Reading scenarios · 阅读场景',
    title: '按阅读目的组织全局类别规则',
    subtitle: '新增、复制、重命名或删除场景，并自由勾选每个场景参与分析的类别。'
  },
  models: {
    eyebrow: 'Model Routing · 模型与连接',
    title: '先连接模型，再按任务设置',
    subtitle: '配置服务商、验证实际连接，并为常用任务选择模型。'
  },
  storage: {
    eyebrow: 'Local storage · 本地保存',
    title: '选择可选的本地镜像目录',
    subtitle: '用于离线阅读与手动备份；不配置目录也会继续保存在浏览器本地。'
  },
  reading: {
    eyebrow: 'Reading tools · 阅读体验',
    title: '管理 PDF、提示词与文献笔记',
    subtitle: '把阅读过程中常用的解析、问答、选区动作和离线正文设置集中到一页。'
  },
  shortcuts: {
    eyebrow: 'Keyboard · 快捷操作',
    title: '用顺手的按键控制论文阅读流程',
    subtitle: '统一设置导航、亮文、摘句、解图和问答等高频动作。'
  },
  data: {
    eyebrow: 'Local First · 本地数据',
    title: '阅读资料与本地数据',
    subtitle: '先检索本地文献与缩略词，需要时再展开维护、同步与迁移。'
  },
  about: {
    eyebrow: 'Project · 关于与反馈',
    title: '开源许可与问题反馈',
    subtitle: '查看源代码、第三方许可，并向维护者反馈问题或建议。'
  }
});
let activeSettingsPage = 'overview';
const USER_DATA_ACTION_IDS = [
  'chooseUserDataDirectory', 'reauthorizeUserDataDirectory',
  'syncUserDataNow', 'rebuildUserDataIndex', 'exportUserDataBundle',
  'exportMigrationBundle', 'unlockPortableConfig',
  'rotatePortableConfigPassphrase', 'forgetPortableConfigKey',
  'backupPortableConfigNow'
];

document.addEventListener('DOMContentLoaded', async () => {
  initializeTtsSettings();
  initializeLiteratureUrlSettings();
  organizeSettingsContent();
  if (location.hash === '#onboarding') enterOnboardingLayout();
  bindEvents();
  activateSettingsPage(settingsPageFromHash(), { updateHash: false, animate: false });
  await refreshSettings({ replaceTaskPolicyDrafts: true });
  focusTaskPolicyFromHash({ behavior: 'auto' });
  await loadPdfMineruSettings();
  await loadCategoryFromHash();
  await refreshCorpusStatus();
  updateDirectoryFeatureSupport();
  await preloadUserDataDirectoryHandle();
  await refreshUserDataStatus();
  await refreshArticleWorkspaceOverview();
  await initializeOnboarding();
  configurePdfReaderReturn();
  if (location.hash === '#pdf-mineru') {
    document.getElementById('pdfMineruSettings')
      ?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }
});

function bindEvents() {
  document.querySelectorAll('[data-settings-nav]').forEach(button => {
    button.addEventListener('click', () => {
      activateSettingsPage(button.dataset.settingsNav);
    });
  });
  document.getElementById('settingsMobilePage').addEventListener('change', event => {
    activateSettingsPage(event.currentTarget.value);
  });
  document.getElementById('overviewConfigureStorage')
    .addEventListener('click', () => openOnboardingStep('storage'));
  document.getElementById('overviewConfigureApi')
    .addEventListener('click', () => openOnboardingStep('api'));
  document.getElementById('overviewSkipStorage').addEventListener('click', () => {
    skipOnboardingStepByName('storage');
  });
  document.getElementById('overviewSkipApi').addEventListener('click', () => {
    skipOnboardingStepByName('api');
  });
  document.getElementById('globalLanguage').addEventListener('change', async event => {
    const language = event.currentTarget.value;
    SciLLM.setInterfaceLanguage(language);
    try {
      const updated = await callBackground({
        type: 'LLM_UPDATE_PREFERENCES',
        preferences: { language }
      });
      applyState(updated);
    } catch (error) {
      showStatus(`语言设置保存失败：${friendlyError(error)}`, 'error');
    }
  });
  document.getElementById('providerId').addEventListener('change', handleProviderChange);
  document.getElementById('refreshModels')
    .addEventListener('click', () => refreshProviderModels({ auto: false }));
  document.getElementById('modelSuggestionsSelect')
    .addEventListener('change', handleModelSuggestionSelection);
  document.getElementById('modelDirectorySearch')?.addEventListener('input', () => renderModelSuggestions());
  document.getElementById('copySupportEmail')?.addEventListener('click', copySupportEmail);
  document.getElementById('profileName').addEventListener('input', updateProfileListPreview);
  document.getElementById('profileName').addEventListener('blur', persistProfileName);
  document.getElementById('profileName').addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.currentTarget.blur();
  });
  document.getElementById('model').addEventListener('input', updateProfileListPreview);
  document.getElementById('model').addEventListener('input', syncModelSuggestionSelection);
  document.getElementById('apiKey').addEventListener('blur', scheduleProviderModelDiscovery);
  document.getElementById('apiProfileList').addEventListener('click', event => {
    const button = event.target.closest('[data-profile-id]');
    if (!button) return;
    if (profileMutationInFlight) return;
    if (!canLeaveProfileEditor('切换')) return;
    selectedProfileId = button.dataset.profileId || '';
    renderProfileEditor();
  });
  document.getElementById('addApiProfile').addEventListener('click', addApiProfile);
  document.getElementById('duplicateApiProfile').addEventListener('click', duplicateApiProfile);
  document.getElementById('deleteApiProfile').addEventListener('click', deleteApiProfile);
  ['profileName', 'providerId', 'model', 'apiKey', 'baseUrl', 'authHeader', 'authPrefix',
    'jsonMode', 'supportsVision', 'contextWindowTokens', 'reasoningEffort'].forEach(id => {
      document.getElementById(id).addEventListener('input', markProfileEditorDirty);
      document.getElementById(id).addEventListener('change', markProfileEditorDirty);
    });
  document.getElementById('model').addEventListener('input', renderReasoningEffort);
  document.getElementById('model').addEventListener('input', renderTaskPolicyTable);
  document.getElementById('supportsVision').addEventListener('change', renderTaskPolicyTable);
  document.getElementById('compatiblePreset').addEventListener('change', () => {
    applyCompatiblePreset();
    scheduleProviderModelDiscovery();
  });
  document.getElementById('compatiblePreset').addEventListener('change', markProfileEditorDirty);
  ['baseUrl', 'authHeader', 'authPrefix'].forEach(id => {
    document.getElementById(id).addEventListener('input', markCompatiblePresetCustom);
  });
  ['jsonMode', 'supportsVision'].forEach(id => {
    document.getElementById(id).addEventListener('change', markCompatiblePresetCustom);
  });
  document.getElementById('saveSettings').addEventListener('click', () => persistForm(false));
  document.getElementById('typesafeTaskRoutingLink')
    ?.addEventListener('click', revealTypesafeTaskRouting);
  (document.getElementById('taskPolicyModules') ? ['taskPolicyModules'] :
    ['llmTaskPolicyTableBody', 'llmAdvancedTaskPolicyTableBody']).forEach(id => {
    document.getElementById(id)?.addEventListener('change', handleTaskPolicyTableChange);
    document.getElementById(id)?.addEventListener('click', handleTaskPolicyTableClick);
  });
  document.getElementById('taskTokenRuleForm')
    .addEventListener('input', handleTaskTokenRuleInput);
  document.getElementById('taskTokenRuleForm')
    .addEventListener('submit', applyTaskTokenRule);
  document.getElementById('closeTaskTokenRuleDialog')
    .addEventListener('click', closeTaskTokenRuleDialog);
  document.getElementById('taskTokenRuleDialog')
    .addEventListener('cancel', clearActiveTaskTokenRuleId);
  document.getElementById('taskTokenRuleDialog')
    .addEventListener('close', clearActiveTaskTokenRuleId);
  document.getElementById('resetTaskTokenRule')
    .addEventListener('click', resetTaskTokenRule);
  document.getElementById('copyTaskTokenRule')
    .addEventListener('click', copyTaskTokenRuleToSelectedTasks);
  document.getElementById('savePdfMineruSettings')
    .addEventListener('click', () => savePdfMineruSettings());
  document.getElementById('openPdfReader')
    .addEventListener('click', () => chrome.tabs.create({
      url: chrome.runtime.getURL('pdf-reader.html')
    }));
  document.getElementById('clearPdfMineruToken')
    .addEventListener('click', () => savePdfMineruSettings({ clearToken: true }));
  document.getElementById('returnToPdfReader')
    .addEventListener('click', () => returnToPdfReader());
  document.getElementById('pdfMineruMode')
    .addEventListener('change', renderPdfMineruSettings);
  document.getElementById('analysisModeList').addEventListener('click', event => {
    const button = event.target.closest('[data-analysis-mode-id]');
    if (!button) return;
    syncAnalysisModeDraftFromEditor();
    selectedAnalysisModeId = button.dataset.analysisModeId;
    renderAnalysisModeEditor();
  });
  document.getElementById('analysisModeList')
    .addEventListener('keydown', handleAnalysisModeListKeydown);
  ['analysisModeName', 'analysisModeDescription'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      syncAnalysisModeDraftFromEditor();
      analysisModeEditorDirty = true;
      renderAnalysisModeList();
      showAnalysisModeStatus('有尚未保存的场景修改。');
    });
  });
  document.getElementById('analysisModeCategoryList').addEventListener('change', () => {
    syncAnalysisModeDraftFromEditor();
    analysisModeEditorDirty = true;
    updateAnalysisModeCategoryCount();
    renderAnalysisModeList();
    showAnalysisModeStatus('有尚未保存的场景修改。');
  });
  document.getElementById('addAnalysisMode').addEventListener('click', addAnalysisMode);
  document.getElementById('duplicateAnalysisMode')
    .addEventListener('click', duplicateAnalysisMode);
  document.getElementById('restoreAnalysisMode')
    .addEventListener('click', restoreCurrentAnalysisMode);
  document.getElementById('deleteAnalysisMode').addEventListener('click', deleteAnalysisMode);
  document.getElementById('resetAnalysisModes').addEventListener('click', resetAnalysisModes);
  document.getElementById('saveAnalysisModes').addEventListener('click', saveAnalysisModes);
  document.getElementById('keyboardShortcutGrid')
    .addEventListener('keydown', handleKeyboardShortcutInputKeydown);
  document.getElementById('keyboardShortcutGrid')
    .addEventListener('input', handleKeyboardShortcutInput);
  document.getElementById('saveKeyboardShortcuts')
    .addEventListener('click', saveKeyboardShortcuts);
  document.getElementById('resetKeyboardShortcuts')
    .addEventListener('click', resetKeyboardShortcuts);
  document.getElementById('resetPanelFollowupPrompts').addEventListener('click', () => {
    renderPanelFollowupPresets(state?.panelFollowupPresetDefaults || []);
    markProfileEditorDirty('panelFollowupPresetList');
  });
  document.getElementById('addPanelFollowupPreset')
    .addEventListener('click', addPanelFollowupPreset);
  document.getElementById('panelFollowupPresetList').addEventListener('input', () => {
    markProfileEditorDirty('panelFollowupPresetList');
  });
  document.getElementById('panelFollowupPresetList').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-panel-preset]');
    if (!button) return;
    button.closest('.named-prompt-row')?.remove();
    renderPanelFollowupPresetEmptyState();
    markProfileEditorDirty('panelFollowupPresetList');
  });
  document.getElementById('addArticleChatQuickPrompt')
    .addEventListener('click', addArticleChatQuickPrompt);
  document.getElementById('resetArticleChatQuickPrompts').addEventListener('click', () => {
    renderArticleChatQuickPrompts(state?.articleChatQuickPromptDefaults || []);
    markProfileEditorDirty('articleChatQuickPromptList');
  });
  document.getElementById('articleChatQuickPromptList').addEventListener('input', () => {
    markProfileEditorDirty('articleChatQuickPromptList');
  });
  document.getElementById('articleChatQuickPromptList').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-quick-prompt]');
    if (!button) return;
    button.closest('.named-prompt-row')?.remove();
    renderArticleChatQuickPromptEmptyState();
    markProfileEditorDirty('articleChatQuickPromptList');
  });
  document.getElementById('addLiteratureNoteTemplate')
    .addEventListener('click', addLiteratureNoteTemplate);
  document.getElementById('resetLiteratureNoteTemplates').addEventListener('click', () => {
    renderLiteratureNoteTemplates(state?.literatureNoteTemplateDefaults || []);
    markProfileEditorDirty('literatureNoteTemplateList');
    setLiteratureNoteTemplateEditState('有未保存修改', 'unsaved');
  });
  document.getElementById('literatureNoteTemplateList').addEventListener('input', event => {
    markProfileEditorDirty(event);
    setLiteratureNoteTemplateEditState('有未保存修改', 'unsaved');
    if (event.target.matches('[data-literature-template-name]')) {
      const row = event.target.closest('.literature-note-template-row');
      syncLiteratureNoteTemplateNavigation(row?.dataset.literatureTemplateId || '');
    }
  });
  document.getElementById('literatureNoteTemplateList').addEventListener('click', event => {
    const addField = event.target.closest('[data-add-literature-field]');
    if (addField) {
      addLiteratureNoteField(addField.closest('.literature-note-template-row'));
      return;
    }
    const deleteField = event.target.closest('[data-delete-literature-field]');
    if (deleteField) {
      const templateRow = deleteField.closest('.literature-note-template-row');
      if (templateRow?.querySelectorAll('[data-literature-note-field-row]').length <= 1) return;
      deleteField.closest('[data-literature-note-field-row]')?.remove();
      updateLiteratureNoteDeleteStates();
      setLiteratureNoteTemplateEditState('有未保存修改', 'unsaved');
      markProfileEditorDirty('literatureNoteTemplateList');
      return;
    }
    const deleteTemplate = event.target.closest('[data-delete-literature-template]');
    if (!deleteTemplate) return;
    if (document.querySelectorAll(
      '#literatureNoteTemplateList .literature-note-template-row'
    ).length <= 1) return;
    deleteTemplate.closest('.literature-note-template-row')?.remove();
    renderLiteratureNoteTemplateEmptyState();
    updateLiteratureNoteDeleteStates();
    syncLiteratureNoteTemplateNavigation();
    setLiteratureNoteTemplateEditState('有未保存修改', 'unsaved');
    markProfileEditorDirty('literatureNoteTemplateList');
  });
  document.getElementById('literatureNoteTemplateNav').addEventListener('click', event => {
    const button = event.target.closest('[data-literature-template-target]');
    if (button) activateLiteratureNoteTemplate(button.dataset.literatureTemplateTarget, {
      focus: true
    });
  });
  document.getElementById('literatureNoteTemplateSelector').addEventListener('change', event => {
    activateLiteratureNoteTemplate(event.target.value, { focus: true });
  });
  document.querySelector('.reading-settings-nav')?.addEventListener('click', event => {
    const button = event.target.closest('[data-reading-settings-target]');
    const target = button && document.getElementById(button.dataset.readingSettingsTarget);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });
  document.getElementById('addSelectionLlmAction')
    .addEventListener('click', addSelectionLlmAction);
  document.getElementById('resetSelectionLlmActions').addEventListener('click', () => {
    renderSelectionLlmActions(state?.selectionLlmActionDefaults || []);
    markProfileEditorDirty('selectionLlmActionList');
  });
  document.getElementById('selectionLlmActionList').addEventListener('input', markProfileEditorDirty);
  document.getElementById('selectionLlmActionList').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-selection-action]');
    if (!button) return;
    button.closest('.named-prompt-row')?.remove();
    renderSelectionLlmActionEmptyState();
    markProfileEditorDirty('selectionLlmActionList');
  });
  document.getElementById('testProvider').addEventListener('click', testProvider);
  document.getElementById('codexLogin').addEventListener('click', startCodexLogin);
  document.getElementById('codexRefreshStatus')
    .addEventListener('click', () => refreshCodexAuthStatus());
  document.getElementById('codexLogout').addEventListener('click', logoutCodex);
  document.getElementById('harnessRefreshStatus')
    .addEventListener('click', () => refreshHarnessAuthStatus());
  ['analysisMode', 'autoAnalyze', 'autoCacheFigureImages', 'saveArticleWebSnapshot', 'consentGranted',
    'globalProfileId'].forEach(id => {
      document.getElementById(id).addEventListener('change', markProfileEditorDirty);
    });
  document.getElementById('globalProfileId').addEventListener('change', renderTaskPolicyTable);
  document.getElementById('exportCorpusJsonl').addEventListener('click', () => exportCorpus('jsonl'));
  document.getElementById('exportCorpusCsv').addEventListener('click', () => exportCorpus('csv'));
  document.getElementById('distillRules').addEventListener('click', distillRules);
  document.getElementById('saveCustomCategory').addEventListener('click', saveCustomCategory);
  document.getElementById('addCustomCategory').addEventListener('click', () => {
    activateSettingsPage('categories');
    const card = document.getElementById('customCategoryCard');
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => document.getElementById('customCategoryName')?.focus(), 220);
  });
  document.getElementById('chooseUserDataDirectory').addEventListener('click', chooseUserDataDirectory);
  document.getElementById('bindNativeDirectory').addEventListener('click', bindNativeDirectory);
  document.getElementById('checkNativeDirectory').addEventListener('click', refreshNativeDirectoryStatus);
  document.getElementById('reauthorizeUserDataDirectory').addEventListener('click', reauthorizeUserDataDirectory);
  document.getElementById('syncUserDataNow').addEventListener('click', syncUserDataNow);
  document.getElementById('unlockPortableConfig').addEventListener('click', unlockPortableConfig);
  document.getElementById('rotatePortableConfigPassphrase').addEventListener('click', rotatePortableConfigPassphrase);
  document.getElementById('forgetPortableConfigKey').addEventListener('click', forgetPortableConfigKey);
  document.getElementById('backupPortableConfigNow').addEventListener('click', backupPortableConfigNow);
  document.getElementById('portableConfigForm').addEventListener('submit', submitPortableConfigDialog);
  document.getElementById('cancelPortableConfigDialog').addEventListener('click', cancelPortableConfigDialog);
  document.getElementById('portableConfigDialog').addEventListener('cancel', cancelPortableConfigDialog);
  document.getElementById('portableConfigDialog').addEventListener('close', settlePortableConfigDialog);
  document.getElementById('rebuildUserDataIndex').addEventListener('click', openRebuildUserDataDialog);
  document.getElementById('exportUserDataBundle').addEventListener('click', exportUserDataBundle);
  document.getElementById('exportMigrationBundle').addEventListener('click', exportMigrationBundle);
  document.getElementById('importMigrationBundle').addEventListener('change', importMigrationBundle);
  document.getElementById('confirmMigrationImport').addEventListener('click', confirmMigrationImport);
  document.getElementById('confirmRebuildUserDataIndex').addEventListener('click', confirmRebuildUserDataIndex);
  document.getElementById('refreshArticleWorkspaceOverview')
    .addEventListener('click', refreshArticleWorkspaceOverview);
  document.getElementById('articleWorkspaceSearch').addEventListener('input', event => {
    articleWorkspaceOverviewUi.query = event.currentTarget.value.trim().toLocaleLowerCase();
    articleWorkspaceOverviewUi.page = 1;
    renderArticleWorkspaceOverview();
    loadVisibleArticleWorkspaceDetails();
  });
  document.getElementById('articleWorkspaceSort').addEventListener('change', event => {
    articleWorkspaceOverviewUi.sort = event.currentTarget.value || 'updated_desc';
    articleWorkspaceOverviewUi.page = 1;
    renderArticleWorkspaceOverview();
    loadVisibleArticleWorkspaceDetails();
  });
  document.getElementById('articleWorkspaceSelectAll').addEventListener('change', event => {
    visibleArticleWorkspacePage().forEach(item => {
      if (event.currentTarget.checked) articleWorkspaceOverviewUi.selected.add(item.workspaceId);
      else articleWorkspaceOverviewUi.selected.delete(item.workspaceId);
    });
    renderArticleWorkspaceOverview();
  });
  document.getElementById('clearSelectedArticleWorkspaces').addEventListener('click', () => {
    clearArticleWorkspaces([...articleWorkspaceOverviewUi.selected]);
  });
  document.getElementById('articleWorkspacePreviousPage').addEventListener('click', () => {
    articleWorkspaceOverviewUi.page = Math.max(1, articleWorkspaceOverviewUi.page - 1);
    renderArticleWorkspaceOverview();
    loadVisibleArticleWorkspaceDetails();
  });
  document.getElementById('articleWorkspaceNextPage').addEventListener('click', () => {
    articleWorkspaceOverviewUi.page += 1;
    renderArticleWorkspaceOverview();
    loadVisibleArticleWorkspaceDetails();
  });
  document.getElementById('articleWorkspaceList').addEventListener('change', event => {
    const input = event.target.closest('[data-workspace-select]');
    if (!input) return;
    if (input.checked) articleWorkspaceOverviewUi.selected.add(input.dataset.workspaceSelect);
    else articleWorkspaceOverviewUi.selected.delete(input.dataset.workspaceSelect);
    updateArticleWorkspaceOverviewControls();
  });
  document.getElementById('articleWorkspaceList').addEventListener('click', event => {
    const button = event.target.closest('[data-workspace-action]');
    if (!button) return;
    handleArticleWorkspaceAction(button.dataset.workspaceAction, button.dataset.workspaceId);
  });
  document.getElementById('reopenOnboarding').addEventListener('click', reopenOnboarding);
  document.getElementById('onboardingBack').addEventListener('click', returnToSettingsOverview);
  document.getElementById('onboardingSkip').addEventListener('click', skipOnboardingStep);
  document.getElementById('onboardingContinue')
    .addEventListener('click', continueOnboarding);
  document.getElementById('onboardingFinish').addEventListener('click', finishOnboarding);
  document.getElementById('saveStoragePreferences').addEventListener('click', () => {
    saveScopedPreferences('storagePreferencesStatus', '本地存储设置已保存。');
  });
  document.getElementById('saveReadingSettings').addEventListener('click', () => {
    saveScopedPreferences('readingSettingsStatus', '阅读工具设置已保存。');
  });
  document.getElementById('categorySearch').addEventListener('input', event => {
    categoryEditor.search = event.target.value.trim().toLocaleLowerCase();
    renderCategoryList();
  });
  document.getElementById('categoryPromptTab').addEventListener('click', () => {
    activateCategoryTab('prompt');
  });
  document.getElementById('categoryRegexTab').addEventListener('click', () => {
    activateCategoryTab('regex');
  });
  ['categoryPromptTab', 'categoryRegexTab'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', handleCategoryTabKeydown);
  });
  document.querySelectorAll('[data-category-field]').forEach(field => {
    field.addEventListener('input', markCategoryUnsaved);
    field.addEventListener('change', markCategoryUnsaved);
  });
  document.getElementById('saveCategoryOverride').addEventListener('click', saveCategoryOverride);
  document.getElementById('exportCategoryModule')
    .addEventListener('click', exportCategoryModule);
  document.getElementById('importCategoryModule')
    .addEventListener('change', importCategoryModule);
  document.getElementById('deleteSelectedCategory')
    .addEventListener('click', () => deleteCategory(categoryEditor.categoryId, {
      requireConfirmation: true
    }));
  document.getElementById('duplicateSelectedCategory')
    .addEventListener('click', duplicateSelectedCategory);
  document.getElementById('testCategoryRegex').addEventListener('click', testCategoryRegex);
  document.getElementById('resetCategoryOverride').addEventListener('click', openResetDialog);
  document.getElementById('confirmResetCategory').addEventListener('click', event => {
    event.preventDefault();
    document.getElementById('resetCategoryDialog').close();
    resetCategoryOverride();
  });
  document.getElementById('cancelCategoryNavigation').addEventListener('click', event => {
    event.preventDefault();
    cancelCategoryNavigation();
  });
  document.getElementById('discardCategoryChanges').addEventListener('click', event => {
    event.preventDefault();
    discardCategoryChanges();
  });
  document.getElementById('unsavedCategoryDialog').addEventListener('cancel', event => {
    event.preventDefault();
    cancelCategoryNavigation();
  });
  window.addEventListener('hashchange', loadCategoryFromHash);
  window.addEventListener('hashchange', () => {
    focusTaskPolicyFromHash({ behavior: 'smooth' });
  });
  window.addEventListener('beforeunload', handleSettingsBeforeUnload);
}

function revealTypesafeTaskRouting(event) {
  event.preventDefault();
  if (onboardingUi.active) leaveOnboardingLayout();
  const routing = document.getElementById('taskRoutingSettings');
  if (!routing) return;
  const row = routing.querySelector('[data-task-policy-id="semantic_find"]');
  (row || routing).scrollIntoView({ behavior: 'smooth', block: 'center' });
  row?.querySelector('[data-task-policy-profile="semantic_find"]')
    ?.focus({ preventScroll: true });
}

function handleSettingsBeforeUnload(event) {
  stopCodexAuthPolling();
  if (!categoryEditor.dirty && !analysisModeEditorDirty &&
      !profileEditorDirty && !keyboardShortcutEditorDirty && !ttsEditorDirty && !literatureUrlDirty) return;
  event.preventDefault();
  event.returnValue = '';
}

function pdfReaderReturnTabId() {
  const rawValue = new URLSearchParams(location.search).get('returnPdfTab');
  if (!rawValue || !/^\d+$/.test(rawValue)) return null;
  const value = Number(rawValue);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function configurePdfReaderReturn() {
  const button = document.getElementById('returnToPdfReader');
  const visible = pdfReaderReturnTabId() !== null;
  if (button) button.hidden = !visible;
  document.body.classList.toggle('has-pdf-reader-return', visible);
}

function organizeSettingsContent() {
  const storageBody = document.getElementById('storageSettingsBody');
  const readingBody = document.getElementById('readingSettingsBody');
  const directorySettings = document.getElementById('directorySyncSettings');
  const figureOriginalSettings = document.getElementById('figureOriginalSettings');
  if (storageBody && directorySettings) storageBody.append(directorySettings);
  if (storageBody && figureOriginalSettings) storageBody.append(figureOriginalSettings);
  [
    'pdfMineruSettings',
    'articleChatPromptSettings',
    'literatureNoteTemplateSettings',
    'selectionLlmActionSettings',
    'panelFollowupSettings'
  ].forEach(id => {
    const section = document.getElementById(id);
    if (readingBody && section) readingBody.append(section);
  });
}

async function saveScopedPreferences(statusId, successMessage) {
  const status = document.getElementById(statusId);
  try {
    if (statusId === 'readingSettingsStatus' && ttsEditorDirty) await saveTtsPreferences();
    if (statusId === 'readingSettingsStatus' && literatureUrlDirty) await saveLiteratureUrlPreferences();
    await persistForm(false);
    status.dataset.state = 'success';
    status.textContent = successMessage;
    if (statusId === 'readingSettingsStatus') {
      setLiteratureNoteTemplateEditState('已保存', 'saved');
    }
    renderSettingsOverview();
  } catch (error) {
    status.dataset.state = 'error';
    status.textContent = `保存失败：${friendlyError(error)}`;
    if (statusId === 'readingSettingsStatus') {
      setLiteratureNoteTemplateEditState('保存失败', 'failed');
    }
  }
}

function setTtsStatus(message, kind = 'info') {
  const element = document.getElementById('ttsStatus');
  if (!element) return;
  element.textContent = message;
  element.className = `status show ${kind}`;
  element.dataset.state = kind;
}

function initializeLiteratureUrlSettings() {
  const input = document.getElementById('literatureUrlWhitelist');
  input?.addEventListener('input', () => { literatureUrlDirty = true; literatureUrlRevision++; });
  document.getElementById('saveLiteratureUrlWhitelist')?.addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try { await saveLiteratureUrlPreferences(); }
    catch (error) { document.getElementById('literatureUrlStatus').textContent = `保存失败：${friendlyError(error)}`; }
    finally { button.disabled = false; }
  });
}

async function saveLiteratureUrlPreferences() {
  const parsed = SciLLM.parseLiteratureUrlWhitelist(document.getElementById('literatureUrlWhitelist').value);
  if (parsed.errors.length) throw new Error(`第 ${parsed.errors.join('、')} 行网址无效。请填写域名或 HTTP/HTTPS 网址。`);
  const revision = literatureUrlRevision;
  const saved = await callBackground({ type: 'LLM_UPDATE_PREFERENCES', preferences: { literatureUrlWhitelist: parsed.rules } });
  if (state?.settings) state.settings.literatureUrlWhitelist = saved.settings.literatureUrlWhitelist;
  if (revision === literatureUrlRevision) {
    literatureUrlDirty = false;
    document.getElementById('literatureUrlWhitelist').value = parsed.rules.join('\n');
  }
  document.getElementById('literatureUrlStatus').textContent = literatureUrlDirty
    ? '已保存提交的规则；新修改尚未保存。' : `已保存 ${parsed.rules.length} 条自定义规则。`;
}

function renderTtsSettings(value) {
  if (ttsEditorDirty || typeof SciLLM.normalizeTtsSettings !== 'function' || !document.getElementById('ttsMode')) return;
  ttsDraft = SciLLM.normalizeTtsSettings(value);
  ttsDraft.online.hasApiKey = value?.online?.hasApiKey === true;
  delete ttsDraft.online.apiKey;
  document.getElementById('ttsMode').value = ttsDraft.mode;
  document.getElementById('ttsSpeed').value = String(ttsDraft.speed);
  document.getElementById('ttsAutoPlay').checked = ttsDraft.autoPlay;
  document.getElementById('ttsClearApiKey').checked = false;
  renderTtsConnection();
  if (ttsPlayback) void refreshTtsVoices();
}

function ttsVoiceConnectionKey() {
  const config = ttsDraft?.[ttsDraft.mode];
  return JSON.stringify([ttsDraft?.mode, config?.endpoint, config?.model, config?.hasApiKey === true]);
}

function selectedTtsVoice(id) {
  const field = document.getElementById(id);
  if (ttsDraft?.mode === 'browser') return field.value;
  return (field.value === '__custom__' ? document.getElementById(`${id}Custom`)?.value || '' : field.value).trim();
}

function ttsVoiceMatchesLanguage(voice, id) {
  if (ttsDraft.mode === 'browser') return (id === 'ttsVoiceEn' ? /^en(?:[-_]|$)/iu : /^zh(?:[-_]|$)/iu).test(voice.lang || '');
  return ttsDraft.mode === 'online' || (id === 'ttsVoiceEn' ? /^[ab]/u : /^z/u).test(voice.id);
}

function renderTtsVoiceChoices(id, value, voices = ttsVoiceDiscovery.voices) {
  const field = document.getElementById(id), custom = document.getElementById(`${id}Custom`);
  if (!field?.replaceChildren || !custom) { if (field) field.value = value; return; }
  const browser = ttsDraft.mode === 'browser';
  const compatible = voices.filter(voice => ttsVoiceMatchesLanguage(voice, id));
  field.replaceChildren();
  const add = (key, name) => { const option = document.createElement('option'); option.value = key; option.textContent = name; field.append(option); };
  if (browser) add('', '自动选择系统音色');
  else if (!value) add('', '请选择音色');
  if (value && !compatible.some(voice => voice.id === value)) add(value, `${value}（当前设置）`);
  for (const voice of compatible) add(voice.id, browser
    ? `${voice.name} · ${voice.lang} · ${voice.localService ? '本机' : '联网'}`
    : voice.name === voice.id ? voice.id : `${voice.name} (${voice.id})`);
  if (!browser) add('__custom__', '手动输入音色 ID');
  field.value = value;
  custom.value = value; custom.hidden = true;
}

async function refreshTtsVoices({ force = false } = {}) {
  if (!ttsDraft || !ttsVoiceDiscovery.open || ttsEditorDirty) {
    if (force && ttsEditorDirty) setTtsStatus('请先保存朗读设置。');
    return;
  }
  const status = document.getElementById('ttsVoicesStatus');
  const button = document.getElementById('ttsRefreshVoices');
  if (!status || !button) return;
  const key = ttsVoiceConnectionKey();
  if (!force && key === ttsVoiceDiscovery.key && (ttsVoiceDiscovery.loaded || ttsVoiceDiscovery.pending)) return ttsVoiceDiscovery.pending;
  const config = ttsDraft[ttsDraft.mode];
  const browser = ttsDraft.mode === 'browser';
  if (!browser && (!config.endpoint || !config.model)) { status.textContent = '保存服务配置后可加载音色；也可手动填写。'; return; }
  const generation = ++ttsVoiceDiscovery.generation;
  if (ttsVoiceDiscovery.key !== key) ttsVoiceDiscovery.voices = [];
  ttsVoiceDiscovery.key = key; ttsVoiceDiscovery.loaded = false;
  button.disabled = true; status.textContent = '正在获取音色…';
  const revision = ttsEditorRevision;
  const current = () => ttsVoiceDiscovery.open && ttsVoiceDiscovery.generation === generation &&
    !ttsEditorDirty && revision === ttsEditorRevision && key === ttsVoiceConnectionKey();
  const pending = (async () => {
    try {
      const result = browser ? await SciLLM.listBrowserTtsVoices() : await callBackground({ type: 'TTS_LIST_VOICES' });
      if (!current()) return;
      ttsVoiceDiscovery.voices = browser ? result : SciLLM.normalizeTtsVoices(result).voices;
      ttsVoiceDiscovery.loaded = true;
      for (const id of ['ttsVoiceEn', 'ttsVoiceZh']) renderTtsVoiceChoices(id, selectedTtsVoice(id));
      const voices = ttsVoiceDiscovery.voices;
      const en = voices.filter(voice => ttsVoiceMatchesLanguage(voice, 'ttsVoiceEn')).length;
      const zh = voices.filter(voice => ttsVoiceMatchesLanguage(voice, 'ttsVoiceZh')).length;
      status.textContent = browser && !voices.length
        ? '未发现浏览器音色。请检查系统语音设置后刷新音色，或选择已配置的朗读服务。'
        : `可选音色：英文 ${en} 个，中文 ${zh} 个。`;
    } catch {
      if (current()) status.textContent = browser
        ? '浏览器音色暂不可用；已保留当前设置，请检查系统语音设置后重试。'
        : '音色获取失败；已保留当前音色，可重试或手动填写。';
    } finally {
      if (generation === ttsVoiceDiscovery.generation) { ttsVoiceDiscovery.pending = null; button.disabled = false; }
    }
  })();
  ttsVoiceDiscovery.pending = pending;
  return pending;
}

function renderTtsConnection() {
  const config = ttsDraft[ttsDraft.mode];
  const browser = ttsDraft.mode === 'browser';
  const online = ttsDraft.mode === 'online';
  for (const id of ['ttsEndpointField', 'ttsModelField']) {
    const field = document.getElementById(id); if (field) field.hidden = browser;
  }
  const browserHint = document.getElementById('ttsBrowserHint'); if (browserHint) browserHint.hidden = !browser;
  for (const [field, key] of [['ttsEndpoint', 'endpoint'], ['ttsModel', 'model']]) document.getElementById(field).value = config[key] || '';
  const voices = ttsVoiceDiscovery.key === ttsVoiceConnectionKey() ? ttsVoiceDiscovery.voices : [];
  renderTtsVoiceChoices('ttsVoiceEn', config.voiceEn || '', voices);
  renderTtsVoiceChoices('ttsVoiceZh', config.voiceZh || '', voices);
  const transport = document.getElementById('ttsTransport');
  if (transport) { transport.value = ttsDraft.local.transport; document.getElementById('ttsTransportField').hidden = ttsDraft.mode !== 'local'; }
  if (ttsVoiceDiscovery.key !== ttsVoiceConnectionKey() && document.getElementById('ttsVoicesStatus')) {
    document.getElementById('ttsVoicesStatus').textContent = browser ? '保存设置后可刷新浏览器音色。' : '保存服务配置后可加载音色列表。';
  }
  document.getElementById('ttsApiKeyField').hidden = !online;
  document.getElementById('ttsApiKey').disabled = !online;
  document.getElementById('ttsApiKey').value = online ? config.apiKey || '' : '';
  document.getElementById('ttsKeyState').textContent = config.hasApiKey
    ? '已保存 Key；留空则保留，填写新 Key 可替换。' : '密钥只保存在本机，保存后不回显。';
  document.getElementById('ttsEndpointHint').textContent = online
    ? '只向你保存的 HTTPS 语音接口发送所选文字；在线服务可能收费。'
    : '本地模式只连接本机回环地址；请先启动 Kokoro。';
}

function captureTtsConnection() {
  if (!ttsDraft) ttsDraft = SciLLM.normalizeTtsSettings();
  const config = ttsDraft[ttsDraft.mode];
  if (ttsDraft.mode !== 'browser') {
    for (const [field, key] of [['ttsEndpoint', 'endpoint'], ['ttsModel', 'model']]) config[key] = document.getElementById(field).value.trim();
  }
  config.voiceEn = selectedTtsVoice('ttsVoiceEn'); config.voiceZh = selectedTtsVoice('ttsVoiceZh');
  if (ttsDraft.mode === 'local' && document.getElementById('ttsTransport')) config.transport = document.getElementById('ttsTransport').value;
  if (ttsDraft.mode === 'online') {
    const key = document.getElementById('ttsApiKey').value.trim();
    if (document.getElementById('ttsClearApiKey').checked) config.apiKey = '';
    else if (key) config.apiKey = key;
    else delete config.apiKey;
  }
  ttsDraft.speed = Number(document.getElementById('ttsSpeed').value);
  ttsDraft.autoPlay = document.getElementById('ttsAutoPlay').checked;
}

async function saveTtsPreferences() {
  captureTtsConnection();
  const revision = ttsEditorRevision;
  const patch = structuredClone(ttsDraft);
  delete patch.online.hasApiKey;
  const config = patch[patch.mode];
  if (!Number.isFinite(patch.speed) || patch.speed < 0.25 || patch.speed > 4) {
    throw new Error('请填写 0.25–4 范围的语速。');
  }
  if (patch.mode === 'browser') SciLLM.validateBrowserTtsSettings(patch);
  else {
    SciLLM.validateTtsEndpoint(config.endpoint, patch.mode);
    if (!config.model || !/^[a-zA-Z0-9][a-zA-Z0-9_.+-]{0,79}$/u.test(config.voiceEn) ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_.+-]{0,79}$/u.test(config.voiceZh)) {
      throw new Error('请填写模型、中英文音色及 0.25–4 范围的语速。');
    }
  }
  ttsPlayback?.stop();
  if (patch.mode !== 'browser') await requestEndpointPermission('openai-compatible', { baseUrl: config.endpoint });
  const saved = await callBackground({ type: 'TTS_SAVE_SETTINGS', settings: patch });
  const publicSettings = saved?.tts || saved?.settings?.tts || saved;
  if (state?.settings) state.settings.tts = publicSettings;
  if (revision === ttsEditorRevision) {
    ttsEditorDirty = false;
    ttsVoiceDiscovery.loaded = false; ttsVoiceDiscovery.key = ''; ttsVoiceDiscovery.voices = [];
    renderTtsSettings(publicSettings);
    setTtsStatus('朗读设置已保存。', 'success');
  } else setTtsStatus('已保存提交时的设置；新修改尚未保存。');
}

function initializeTtsSettings() {
  const section = document.getElementById('ttsSettings');
  if (!section || typeof SciLLM.createSelectionTtsController !== 'function') return;
  const lease = `options-tts-${crypto.randomUUID()}`;
  let open = true;
  ttsPlayback = SciLLM.createSelectionTtsController({
    sendMessage: message => chrome.runtime.sendMessage(message),
    getLease: () => lease,
    isCurrentLease: candidate => open && candidate === lease,
    onState: next => {
      const messages = { idle: '朗读已停止。', loading: '正在合成语音…', playing: '正在朗读…',
        awaiting_play: '浏览器需要再次点击才能播放。', error: '朗读失败，请确认服务已启动并检查设置。' };
      const specific = { TTS_INVALID_TEXT: '请选择 1–20000 个字符后朗读；超出时请分段选择。',
        TTS_TIMEOUT: '朗读服务超时，请缩短文字或检查服务。',
        TTS_RESPONSE_TYPE: '服务未返回有效音频，请检查语音接口地址。' };
      const message = next.errorMessage || specific[next.errorCode] || messages[next.status] || '';
      setTtsStatus([message, next.noticeMessage].filter(Boolean).join(' '), next.status === 'error' ? 'error' : 'info');
      document.getElementById('ttsResume').hidden = next.status !== 'awaiting_play';
      document.getElementById('ttsStop').disabled = !['loading', 'playing', 'awaiting_play'].includes(next.status);
    }
  });
  window.addEventListener('pagehide', () => { open = false; ttsVoiceDiscovery.open = false; ttsVoiceDiscovery.generation++; ttsPlayback.destroy(); }, { once: true });
  const dirty = () => {
    ttsEditorDirty = true; ttsEditorRevision += 1; ttsPlayback.stop();
    setTtsStatus('朗读设置已修改，保存后可刷新音色或试听。');
  };
  section.addEventListener('input', event => { if (event.target.matches('input, select')) dirty(); });
  for (const id of ['ttsVoiceEn', 'ttsVoiceZh']) document.getElementById(id).addEventListener('change', () => {
    const custom = document.getElementById(`${id}Custom`);
    if (custom) { custom.hidden = document.getElementById(id).value !== '__custom__'; if (!custom.hidden) custom.focus(); }
    dirty();
  });
  document.getElementById('ttsMode').addEventListener('change', () => {
    captureTtsConnection();
    const mode = document.getElementById('ttsMode').value;
    ttsDraft.mode = ['local', 'online'].includes(mode) ? mode : 'browser';
    document.getElementById('ttsClearApiKey').checked = false;
    renderTtsConnection(); dirty();
  });
  document.getElementById('saveTtsSettings').addEventListener('click', async event => {
    if (!event.isTrusted) return;
    const button = event.currentTarget; button.disabled = true;
    try { await saveTtsPreferences(); }
    catch (error) { setTtsStatus(`保存失败：${friendlyError(error)}`, 'error'); }
    finally { button.disabled = false; }
  });
  document.getElementById('ttsRefreshVoices').addEventListener('click', async event => {
    if (!event.isTrusted) return;
    await refreshTtsVoices({ force: true });
  });
  for (const [id, language, text] of [
    ['ttsPreviewEnglish', 'en', 'Hello. This is a short reading test.'],
    ['ttsPreviewChinese', 'zh', '你好，这是选区朗读的简短试听。']
  ]) document.getElementById(id).addEventListener('click', event => {
    if (ttsEditorDirty) { setTtsStatus('请先保存朗读设置。'); return; }
    void ttsPlayback.speak({ text, language, event });
  });
  document.getElementById('ttsStop').addEventListener('click', () => ttsPlayback.stop());
  document.getElementById('ttsResume').addEventListener('click', event => { void ttsPlayback.resume({ event }); });
}

async function returnToPdfReader() {
  const tabId = pdfReaderReturnTabId();
  if (tabId === null) return;
  const button = document.getElementById('returnToPdfReader');
  if (button) button.disabled = true;
  try {
    const target = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (Number.isInteger(target?.windowId) && chrome.windows?.update) {
      await chrome.windows.update(target.windowId, { focused: true });
    }
    const current = await chrome.tabs.getCurrent().catch(() => null);
    if (Number.isInteger(current?.id) && current.id !== tabId) {
      await chrome.tabs.remove(current.id);
    }
  } catch (error) {
    if (button) button.disabled = false;
    const status = document.getElementById('pdfMineruStatus');
    if (status) {
      status.dataset.state = 'error';
      status.textContent = `无法返回 PDF 解析结果：${friendlyError(error)}`;
    }
  }
}

function settingsPageFromHash() {
  if (location.hash === '#onboarding') return 'overview';
  const parameters = new URLSearchParams(location.hash.replace(/^#/, ''));
  const requested = parameters.get('page');
  if (SETTINGS_PAGE_ORDER.includes(requested)) return requested;
  const legacy = location.hash.replace(/^#/, '');
  const legacyPages = {
    categoryWorkspace: 'categories',
    analysisModeSettings: 'modes',
    providerSettings: 'models',
    keyboardShortcuts: 'shortcuts',
    localData: 'data',
    localStorageSettings: 'storage',
    readingSettings: 'reading',
    openSource: 'about',
    support: 'about',
    'pdf-mineru': 'reading'
  };
  return legacyPages[legacy] || 'overview';
}

function settingsPageHash(page) {
  if (page === 'categories' && categoryEditor.categoryId) {
    return categoryHash(categoryEditor.categoryId);
  }
  return `#page=${encodeURIComponent(page)}`;
}

function syncSettingsPageVisibility({ animate = false } = {}) {
  document.querySelectorAll('[data-settings-page]').forEach(section => {
    const active = section.dataset.settingsPage === activeSettingsPage;
    section.hidden = !active;
    section.classList.toggle(
      'is-active-page',
      active && animate
    );
  });
}

function activateSettingsPage(page, { updateHash = true, animate = true } = {}) {
  const nextPage = SETTINGS_PAGE_ORDER.includes(page) ? page : 'overview';
  const previousIndex = SETTINGS_PAGE_ORDER.indexOf(activeSettingsPage);
  const nextIndex = SETTINGS_PAGE_ORDER.indexOf(nextPage);
  document.body.dataset.settingsDirection =
    nextIndex < previousIndex ? 'backward' : 'forward';
  activeSettingsPage = nextPage;
  if (nextPage === 'workbench') globalThis.SciLLM?.mountResearchWorkbenchSettings?.();
  syncSettingsPageVisibility({ animate });
  document.querySelectorAll('[data-settings-nav]').forEach(button => {
    const active = button.dataset.settingsNav === nextPage;
    button.setAttribute('aria-selected', String(active));
  });
  const mobilePage = document.getElementById('settingsMobilePage');
  if (mobilePage) mobilePage.value = nextPage;
  const mobileNumber = document.getElementById('settingsMobileNumber');
  if (mobileNumber) mobileNumber.textContent = String(nextIndex + 1).padStart(2, '0');
  document.body.dataset.activeSettingsPage = nextPage;
  const copy = SETTINGS_PAGE_COPY[nextPage];
  if (copy) {
    document.getElementById('settingsPageEyebrow').textContent = copy.eyebrow;
    document.getElementById('settingsPageTitle').textContent = copy.title;
    document.getElementById('settingsPageSubtitle').textContent = copy.subtitle;
  }
  if (updateHash && location.hash !== settingsPageHash(nextPage)) {
    replaceHash(settingsPageHash(nextPage));
  }
  globalThis.scrollTo?.({ top: 0, behavior: animate ? 'smooth' : 'auto' });
  renderOnboarding();
}

async function callBackground(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.success) {
    const error = new Error(response?.error?.message || '操作失败');
    error.code = response?.error?.code;
    error.fields = response?.error?.fields || [];
    error.retryable = response?.error?.retryable === true;
    ['probeId', 'diagnosticStage', 'diagnosticType'].forEach(key => {
      if (response?.error?.[key]) error[key] = response.error[key];
    });
    ['status', 'requestBytes', 'elapsedMs'].forEach(key => {
      if (Number.isFinite(response?.error?.[key])) error[key] = response.error[key];
    });
    throw error;
  }
  return response.data;
}

function renderCodexAuthStatus(message, stateName = '') {
  const status = document.getElementById('codexAuthStatus');
  const card = status?.closest('.codex-auth-card');
  if (status) status.textContent = message;
  if (card) {
    if (stateName) card.dataset.state = stateName;
    else delete card.dataset.state;
  }
}

function renderCodexReverseChannelStatus(status = null) {
  const target = document.getElementById('codexReverseChannelStatus');
  if (!target) return;
  const latestPath = String(status?.latestEventPath || '');
  const logPath = String(status?.eventLogPath || '');
  target.textContent = latestPath
    ? `反向通道已连接。最新状态：${latestPath}；完整事件流：${logPath}`
    : '反向通道尚未连接。连接后，解图进度与结果会实时写入本机事件账本。';
}

function setCodexAuthPending(pending) {
  codexAuthUi.pending = pending === true;
  ['codexLogin', 'codexRefreshStatus', 'codexLogout'].forEach(id => {
    const button = document.getElementById(id);
    if (button) button.disabled = codexAuthUi.pending;
  });
}

function stopCodexAuthPolling() {
  if (codexAuthUi.pollTimer) clearTimeout(codexAuthUi.pollTimer);
  codexAuthUi.pollTimer = null;
  codexAuthUi.pollDeadline = 0;
}

function scheduleCodexAuthPoll() {
  if (!codexAuthUi.pollDeadline || Date.now() >= codexAuthUi.pollDeadline) {
    stopCodexAuthPolling();
    renderCodexAuthStatus(
      '尚未检测到授权完成。若网页已经显示成功，请点击“刷新状态”；否则重新登录。',
      'error'
    );
    return;
  }
  if (codexAuthUi.pollTimer) clearTimeout(codexAuthUi.pollTimer);
  codexAuthUi.pollTimer = setTimeout(async () => {
    codexAuthUi.pollTimer = null;
    const connected = await refreshCodexAuthStatus({ silent: true, polling: true });
    if (!connected) scheduleCodexAuthPoll();
  }, 1800);
}

async function refreshCodexAuthStatus({ silent = false, polling = false } = {}) {
  if (codexAuthUi.pending) return false;
  if (!silent) {
    setCodexAuthPending(true);
    renderCodexAuthStatus('正在检查插件专用 Codex 会话…', 'pending');
  }
  try {
    const status = await callBackground({ type: 'CODEX_LOCAL_STATUS' });
    stopCodexAuthPolling();
    const account = [status.accountType, status.planType].filter(Boolean).join(' / ');
    renderCodexAuthStatus(
      `已登录${account ? ` · ${account}` : ''}；本机桥 ${status.hostVersion || '已连接'}`,
      'connected'
    );
    renderCodexReverseChannelStatus(status);
    return true;
  } catch (error) {
    if (polling && error.code === 'CODEX_NOT_AUTHENTICATED') {
      renderCodexAuthStatus('已打开登录页，正在等待网页授权完成…', 'pending');
      return false;
    }
    renderCodexAuthStatus(`状态检查失败：${friendlyError(error)}`, 'error');
    renderCodexReverseChannelStatus(null);
    return false;
  } finally {
    if (!silent) setCodexAuthPending(false);
  }
}

function renderHarnessAuthStatus(message, stateName = '') {
  const status = document.getElementById('harnessAuthStatus');
  const card = status?.closest('.codex-auth-card');
  if (status) status.textContent = message;
  if (card) {
    if (stateName) card.dataset.state = stateName;
    else delete card.dataset.state;
  }
}

function invalidateHarnessAuthStatus() {
  harnessAuthUi.generation += 1;
  harnessAuthUi.pending = false;
  harnessAuthUi.binding = '';
  const button = document.getElementById('harnessRefreshStatus');
  if (button) button.disabled = profileMutationInFlight || Object.values(profileActionInFlight).some(Boolean);
}

async function refreshHarnessAuthStatus() {
  if (providerSelectionDescriptor().providerId !== 'deepseek-harness' || !selectedProfileId || !profileById(selectedProfileId)) return false;
  const profileId = selectedProfileId;
  const binding = `${profileId}|deepseek-harness`;
  if (harnessAuthUi.pending && harnessAuthUi.binding === binding) return false;
  const generation = ++harnessAuthUi.generation;
  harnessAuthUi.pending = true;
  harnessAuthUi.binding = binding;
  const button = document.getElementById('harnessRefreshStatus');
  if (button) button.disabled = true;
  const current = () => generation === harnessAuthUi.generation && selectedProfileId === profileId &&
    Boolean(profileById(profileId)) && providerSelectionDescriptor().providerId === 'deepseek-harness';
  renderHarnessAuthStatus('正在检查官方 Harness 安装与保存登录…', 'pending');
  try {
    const status = await callBackground({ type: 'HARNESS_LOCAL_STATUS' });
    if (!current()) return false;
    const versions = [status.installVersion && `Harness ${String(status.installVersion).slice(0, 80)}`,
      status.hostVersion && `本机桥 ${String(status.hostVersion).slice(0, 80)}`].filter(Boolean).join(' · ');
    if (status.connected !== true) {
      renderHarnessAuthStatus('未检测到官方 Harness 安装；安装并在官方桌面登录后刷新状态。', 'error');
      return false;
    }
    if (status.toolsEnabled !== false || status.providerId !== 'deepseek-account') {
      renderHarnessAuthStatus('本机桥返回的 Provider 或工具状态不符合要求，请检查安装后重试。', 'error');
      return false;
    }
    const stored = status.credentialStored === true && status.accountStatus === 'credential-stored';
    renderHarnessAuthStatus((stored
      ? '检测到官方桌面的保存登录；请使用“测试连接”验证当前模型。'
      : '已检测到官方 Harness；尚未检测到保存登录，请在官方桌面登录后刷新状态。') +
      (versions ? ` · ${versions}` : ''), stored ? 'detected' : 'error');
    return stored;
  } catch (error) {
    if (current()) renderHarnessAuthStatus(`状态检查失败：${friendlyError(error)}`, 'error');
    return false;
  } finally {
    if (generation === harnessAuthUi.generation) {
      harnessAuthUi.pending = false;
      if (button) button.disabled = profileMutationInFlight || Object.values(profileActionInFlight).some(Boolean);
    }
  }
}

async function startCodexLogin() {
  if (codexAuthUi.pending) return;
  stopCodexAuthPolling();
  setCodexAuthPending(true);
  renderCodexAuthStatus('正在创建插件专用登录会话…', 'pending');
  try {
    const login = await callBackground({
      type: 'CODEX_LOCAL_LOGIN_START',
      force: true
    });
    const authUrl = new URL(String(login.authUrl || ''));
    if (authUrl.protocol !== 'https:' ||
        !['auth.openai.com', 'chatgpt.com'].includes(authUrl.hostname.toLowerCase())) {
      const error = new Error('Codex 返回了无效的登录地址');
      error.code = 'CODEX_PROVIDER_REJECTED';
      throw error;
    }
    await chrome.tabs.create({ url: authUrl.href });
    renderCodexAuthStatus(
      '登录页已打开。请在网页完成授权，本页会自动检测结果。',
      'pending'
    );
    codexAuthUi.pollDeadline = Date.now() + 3 * 60 * 1000;
    scheduleCodexAuthPoll();
  } catch (error) {
    renderCodexAuthStatus(`无法开始登录：${friendlyError(error)}`, 'error');
  } finally {
    setCodexAuthPending(false);
  }
}

async function logoutCodex() {
  if (codexAuthUi.pending) return;
  stopCodexAuthPolling();
  setCodexAuthPending(true);
  renderCodexAuthStatus('正在退出插件专用 Codex 会话…', 'pending');
  try {
    await callBackground({ type: 'CODEX_LOCAL_LOGOUT' });
    renderCodexAuthStatus('已退出。桌面 Codex 和命令行登录不受影响。');
  } catch (error) {
    renderCodexAuthStatus(`退出失败：${friendlyError(error)}`, 'error');
  } finally {
    setCodexAuthPending(false);
  }
}

function enterOnboardingLayout() {
  onboardingUi.active = true;
  document.body.classList.add('is-onboarding');
  document.body.dataset.onboardingStep = onboardingUi.step;
  renderOnboarding();
}

function leaveOnboardingLayout() {
  onboardingUi.active = false;
  document.body.classList.remove('is-onboarding');
  delete document.body.dataset.onboardingStep;
  renderOnboarding();
}

function hasConfiguredApiProfile() {
  return profileEntries().some(([, profile]) =>
    String(profile?.config?.model || '').trim() &&
      (['codex-local', 'deepseek-harness'].includes(profile?.providerId) || profile?.config?.hasApiKey === true)
  );
}

function hasUsableApiConfiguration() {
  return state?.settings?.consentGranted === true && hasConfiguredApiProfile();
}

function hasVerifiedApiProfile() {
  return [...providerVerificationResults].some(([id, record]) =>
    providerVerificationIsCurrent(id, record) && record.result?.connectivity === true);
}

function setOverviewCardState(cardId, ready) {
  const card = document.getElementById(cardId);
  if (!card) return;
  card.classList.toggle('is-ready', ready);
  card.classList.toggle('is-pending', !ready);
}

function setSetupRowState(rowId, stateName) {
  const row = document.getElementById(rowId);
  if (!row) return;
  row.dataset.state = stateName;
  row.classList.toggle('is-complete', stateName === 'completed');
  row.classList.toggle('is-skipped', stateName === 'skipped');
}

function renderSettingsOverview() {
  const apiConfigured = hasConfiguredApiProfile();
  const consentGranted = state?.settings?.consentGranted === true;
  const directoryConfigured = Boolean(userDataUi.lastStatus?.directoryName);
  const onboardingSteps = onboardingUi.state?.steps || {};
  const apiState = apiConfigured ? 'completed' : (onboardingSteps.api || 'pending');
  const storageState = directoryConfigured
    ? 'completed'
    : (onboardingSteps.storage || 'pending');

  document.getElementById('overviewModelState').textContent = apiConfigured
    ? '已配置' : '仅本地功能';
  document.getElementById('overviewStorageState').textContent = directoryConfigured
    ? '已连接' : '浏览器本地';
  document.getElementById('overviewConsentState').textContent = consentGranted
    ? '已同意' : '未启用 LLM';
  document.getElementById('setupApiState').textContent = apiConfigured
    ? '已配置' : (apiState === 'skipped' ? '已跳过' : '待配置');
  document.getElementById('setupStorageState').textContent = directoryConfigured
    ? '已选择' : (storageState === 'skipped' ? '已跳过' : '可选');
  document.getElementById('setupConsentState').textContent = consentGranted
    ? '已确认' : (apiConfigured ? '待确认' : '启用 AI 时确认');
  document.getElementById('onboardingProgress').textContent = apiConfigured && consentGranted
    ? (hasVerifiedApiProfile() ? '基础连接已验证' : '连接已配置，待验证') : '可直接阅读';
  document.getElementById('settingsNavModelState').textContent = apiConfigured
    ? '已配置' : '待配置';
  document.getElementById('settingsNavStorageState').textContent = directoryConfigured
    ? '已连接' : '可选';
  document.getElementById('overviewDirectoryState').textContent = directoryConfigured
    ? userDataUi.lastStatus.directoryName : '仅浏览器本地';
  document.getElementById('overviewSnapshotState').textContent =
    document.getElementById('saveArticleWebSnapshot')?.checked ? '自动保存' : '未启用';
  document.getElementById('overviewHighlightMode').textContent =
    document.getElementById('analysisMode')?.value === 'llm' ? 'LLM 精确模式' : '规则模式';

  const currentProfile = profileEntries().find(([profileId]) =>
    profileId === (selectedProfileId || state?.settings?.globalProfileId)
  )?.[1];
  document.getElementById('overviewCurrentModel').textContent = currentProfile
    ? `${apiConfigured ? '已配置' : '已选择（未连接）'} · ${currentProfile.name || currentProfile.providerId} · ${currentProfile.config?.model || '未选模型'}`
    : '仅本地功能';

  setOverviewCardState('overviewModelCard', apiConfigured);
  setOverviewCardState('overviewStorageCard', directoryConfigured);
  setOverviewCardState('overviewConsentCard', consentGranted);
  setSetupRowState('setupApiRow', apiState);
  setSetupRowState('setupStorageRow', storageState);
  setSetupRowState('setupConsentRow', consentGranted ? 'completed' : 'pending');

  document.getElementById('overviewSkipApi').hidden = apiState !== 'pending';
  document.getElementById('overviewSkipStorage').hidden = storageState !== 'pending';
  document.getElementById('overviewConfigureApi').textContent = apiConfigured ? '查看配置' : '去配置';
  document.getElementById('overviewConfigureStorage').textContent = directoryConfigured
    ? '查看目录' : '选择目录';
}

function openOnboardingStep(step) {
  onboardingUi.active = true;
  onboardingUi.step = step === 'storage' ? 'storage' : 'api';
  document.body.classList.add('is-onboarding');
  document.body.dataset.onboardingStep = onboardingUi.step;
  activateSettingsPage(step === 'storage' ? 'storage' : 'models');
}

function returnToSettingsOverview() {
  activateSettingsPage('overview');
}

async function setOnboardingStepState(step, status) {
  onboardingUi.pending = true;
  renderOnboarding();
  try {
    onboardingUi.state = await callBackground({
      type: 'ONBOARDING_SET_STEP', step, status
    });
    await prepareOnboardingFinish();
    return onboardingUi.state;
  } finally {
    onboardingUi.pending = false;
    renderOnboarding();
  }
}

async function prepareOnboardingFinish() {
  if (onboardingUi.state?.acknowledged !== true) {
    onboardingUi.finishPrepared = false;
    return false;
  }
  const result = await callBackground({
    type: 'ONBOARDING_PREPARE_FINISH', sourceTab: onboardingUi.state.sourceTab
  });
  // A missing source tab is a valid fallback: Finish keeps this settings page
  // open and exits the onboarding layout instead of trying to open a panel.
  onboardingUi.finishPrepared = result.prepared === true ||
    result.reason === 'source-tab-missing';
  return onboardingUi.finishPrepared;
}

async function reconcileOnboardingConfiguration() {
  if (!onboardingUi.active || !onboardingUi.state) return;
  if (onboardingUi.state.steps?.storage !== 'completed' &&
      Boolean(userDataUi.lastStatus?.directoryName)) {
    await setOnboardingStepState('storage', 'completed');
  }
  if (onboardingUi.state.steps?.api !== 'completed' && hasUsableApiConfiguration()) {
    await setOnboardingStepState('api', 'completed');
  }
}

function onboardingStateText(step, status) {
  if (step === 'storage') {
    if (status === 'completed') return '本地保存目录已配置；浏览器授权失效时可稍后重新授权。';
    if (status === 'skipped') return '已暂时跳过；插件仍会使用 IndexedDB 保存本机工作副本。';
    return '请选择目录，或暂时跳过后继续。目录选择只会由你的点击触发。';
  }
  if (status === 'completed') return 'API 配置已保存；请在模型与连接页分别测试连接和所需能力。';
  if (status === 'skipped') return '已暂时跳过；导航、手动高亮和本地阅读功能仍可使用。';
  return '保存至少一个 API 配置并同意发送内容，或暂时跳过。';
}

function renderOnboarding() {
  const guide = document.getElementById('onboardingGuide');
  if (!guide) return;
  renderSettingsOverview();
  const step = onboardingUi.step;
  const steps = onboardingUi.state?.steps || { storage: 'pending', api: 'pending' };
  const status = steps[step] || 'pending';
  const focusBar = document.getElementById('setupFocusBar');
  const focusVisible = onboardingUi.active && activeSettingsPage ===
    (step === 'storage' ? 'storage' : 'models');
  focusBar.hidden = !focusVisible;
  const finish = document.getElementById('onboardingFinish');
  if (!onboardingUi.active) {
    finish.hidden = true;
    return;
  }
  document.body.dataset.onboardingStep = step;
  document.getElementById('onboardingStepTitle').textContent = step === 'storage'
    ? '选择本地保存目录' : '配置 LLM API';
  document.getElementById('onboardingStepDescription').textContent = step === 'storage'
    ? '本地文件夹是可选项。暂时跳过后仍使用浏览器 IndexedDB 保存本机工作副本，也可正常使用导航、阅读与手动标注。'
    : 'API 是问答、图解和智能高亮所需的可选项。暂时不配置也能直接使用导航、摘句、手动高亮与本地阅读，之后可随时回来设置。';
  document.getElementById('onboardingStepState').textContent =
    onboardingStateText(step, status);
  const back = document.getElementById('onboardingBack');
  const skip = document.getElementById('onboardingSkip');
  const next = document.getElementById('onboardingContinue');
  const busy = onboardingUi.pending || userDataUi.pendingAction;
  skip.textContent = step === 'storage' ? '暂不选择，继续' : '暂不配置，直接使用';
  back.hidden = false;
  skip.hidden = status !== 'pending';
  next.hidden = step !== 'storage';
  finish.hidden = activeSettingsPage !== 'overview';
  [back, skip, next, finish].forEach(button => {
    button.setAttribute('aria-busy', String(busy));
  });
  back.disabled = busy;
  skip.disabled = busy;
  next.disabled = busy;
  finish.disabled = busy || onboardingUi.state?.acknowledged !== true ||
    onboardingUi.finishPrepared !== true;
}

async function initializeOnboarding() {
  try {
    onboardingUi.state = await callBackground({ type: 'ONBOARDING_GET' });
    onboardingUi.active = location.hash === '#onboarding';
    document.body.classList.toggle('is-onboarding', onboardingUi.active);
    if (onboardingUi.active) {
      await reconcileOnboardingConfiguration();
      await prepareOnboardingFinish();
      onboardingUi.step = onboardingUi.state.steps?.storage === 'pending'
        ? 'storage' : 'api';
      activateSettingsPage('overview', { updateHash: false, animate: false });
    }
    renderOnboarding();
  } catch (error) {
    onboardingUi.active = location.hash === '#onboarding';
    renderOnboarding();
    document.getElementById('onboardingStepState').textContent =
      `无法读取引导状态：${friendlyError(error)}`;
  }
}

async function reopenOnboarding() {
  if (onboardingUi.pending) return;
  onboardingUi.pending = true;
  onboardingUi.finishPrepared = false;
  try {
    onboardingUi.state = await callBackground({ type: 'ONBOARDING_RESTART' });
    onboardingUi.step = 'storage';
    enterOnboardingLayout();
    await reconcileOnboardingConfiguration();
    renderOnboarding();
    activateSettingsPage('overview');
    document.getElementById('onboardingGuide').scrollIntoView({ block: 'start' });
  } catch (error) {
    showStatus(`无法重新打开新手引导：${friendlyError(error)}`, 'error');
  } finally {
    onboardingUi.pending = false;
    renderOnboarding();
  }
}

async function skipOnboardingStep() {
  if (onboardingUi.pending) return;
  const step = onboardingUi.step;
  try {
    await setOnboardingStepState(step, 'skipped');
    if (step === 'storage') {
      openOnboardingStep('api');
    } else {
      await prepareOnboardingFinish();
      returnToSettingsOverview();
      return;
    }
    renderOnboarding();
  } catch (error) {
    document.getElementById('onboardingStepState').textContent =
      `无法保存跳过状态：${friendlyError(error)}`;
  }
}

async function continueOnboarding() {
  if (onboardingUi.pending || userDataUi.pendingAction) return;
  const status = onboardingUi.state?.steps?.storage || 'pending';
  try {
    if (!['completed', 'skipped'].includes(status)) {
      await setOnboardingStepState('storage', 'skipped');
    }
    onboardingUi.step = 'api';
    openOnboardingStep('api');
  } catch (error) {
    document.getElementById('onboardingStepState').textContent =
      `无法继续 API 配置：${friendlyError(error)}`;
  } finally {
    renderOnboarding();
  }
}

async function finishOnboarding() {
  if (onboardingUi.pending || onboardingUi.state?.acknowledged !== true ||
      onboardingUi.finishPrepared !== true) return;
  onboardingUi.pending = true;
  renderOnboarding();
  try {
    // Capture this extension tab before the background focuses the source
    // article. chrome.tabs.getCurrent() identifies the tab that owns this
    // document even when it is no longer the active tab.
    const settingsTab = await chrome.tabs.getCurrent?.().catch(() => null);
    const result = await callBackground({
      type: 'ONBOARDING_FINISH', sourceTab: onboardingUi.state.sourceTab
    });
    if (result.opened) {
      const settingsTabId = Number(settingsTab?.id ?? result.settingsTabId);
      if (Number.isInteger(settingsTabId) && settingsTabId !== Number(result.tabId)) {
        // Close only after the background has opened the source side panel and
        // replied. This avoids racing tab removal against the response channel.
        chrome.tabs.remove(settingsTabId).catch(() => window.close());
      } else {
        window.close();
      }
      return;
    } else {
      leaveOnboardingLayout();
      activateSettingsPage('overview');
      showStatus('原论文标签页已关闭；引导已完成，可从任意论文页再次点击插件图标。', 'info');
    }
  } catch (error) {
    document.getElementById('onboardingStepState').textContent =
      `无法返回原论文页面：${friendlyError(error)}`;
  } finally {
    onboardingUi.pending = false;
    renderOnboarding();
  }
}

function updateDirectoryFeatureSupport() {
  const supported = typeof window.showDirectoryPicker === 'function';
  renderDirectorySupportMessage();
  updateUserDataActionButtons();
  return supported;
}

function renderDirectorySupportMessage() {
  const message = document.getElementById('userDataSupportMessage');
  if (typeof window.showDirectoryPicker !== 'function') {
    message.hidden = false;
    message.textContent = '当前浏览器不支持目录选择，请使用“导出 JSON 备份”保存本地数据。';
    return;
  }
  if (userDataUi.handleLoaded && userDataUi.lastStatus?.directoryName &&
      !userDataUi.directoryHandle) {
    message.hidden = false;
    message.textContent = '无法读取已保存的目录授权，请重新选择目录。JSON 备份仍可使用。';
    return;
  }
  message.hidden = true;
  message.textContent = '';
}

// Native directory binding UI: start.
const nativeDirectoryUi = { pending: false };

function openNativeDirectorySettings() {
  activateSettingsPage('storage', { animate: false });
  const section = document.getElementById('nativeDirectorySettings');
  section?.scrollIntoView({ behavior: 'auto', block: 'center' });
  document.getElementById('nativeDirectoryPath')?.focus({ preventScroll: true });
}

function setNativeDirectoryPending(pending) {
  nativeDirectoryUi.pending = pending;
  ['nativeDirectoryPath', 'bindNativeDirectory', 'checkNativeDirectory'].forEach(id => {
    const control = document.getElementById(id);
    control.disabled = pending;
    control.setAttribute('aria-busy', String(pending));
  });
  setUserDataActionPending(pending);
}

async function performNativeDirectoryAction(bind) {
  if (nativeDirectoryUi.pending) return;
  const status = document.getElementById('nativeDirectoryStatus');
  const input = document.getElementById('nativeDirectoryPath');
  if (userDataUi.pendingAction) {
    status.dataset.state = 'info'; status.textContent = '其他目录操作正在进行，请完成后再试。'; return;
  }
  const absolutePath = input.value;
  if (bind && !absolutePath.trim()) {
    status.dataset.state = 'error'; status.textContent = '请填写实际数据根的完整绝对路径。目录名不能代替本机路径。'; input.focus(); return;
  }
  setNativeDirectoryPending(true);
  status.dataset.state = 'pending'; status.textContent = bind ? '正在核验并绑定本机目录…' : '正在检查本机助手与目录绑定…';
  try {
    const data = await callBackground(bind
      ? { type: 'USER_DATA_DIRECTORY_NATIVE_BIND', absolutePath }
      : { type: 'USER_DATA_DIRECTORY_NATIVE_STATUS' });
    if (bind) {
      if (data?.bound !== true) throw new Error('未收到有效的绑定确认，请先检查状态。');
      status.dataset.state = 'success';
      status.textContent = `绑定成功：${data.rootName || '当前数据根'}。仅打开已同步且通过身份校验的文献目录；绑定不代表文献已同步。`;
    } else {
      if (typeof data?.available !== 'boolean' || typeof data?.bound !== 'boolean') throw new Error('未收到有效的助手状态，请确认本机助手版本。');
      status.dataset.state = data.available && data.bound ? 'success' : 'info';
      const fallback = data.available
        ? data.bound ? `本机助手可用，最近核验已绑定目录：${data.rootName || '当前数据根'}。` : '本机助手可用，当前数据根尚未绑定。请填写绝对路径后点击绑定。'
        : '本机助手不可用，请确认已安装支持目录打开功能的版本；旧版需更新。';
      status.textContent = `${data.message || fallback}${data.code ? `（${data.code}）` : ''}`;
    }
  } catch (error) {
    status.dataset.state = 'error';
    status.textContent = `${error.message || '未能确认操作结果，请检查本机助手与目录设置。'}${error.code ? `（${error.code}）` : ''}`;
  } finally { setNativeDirectoryPending(false); }
}

async function bindNativeDirectory() { return performNativeDirectoryAction(true); }
async function refreshNativeDirectoryStatus() { return performNativeDirectoryAction(false); }
// Native directory binding UI: end.

async function preloadUserDataDirectoryHandle() {
  try {
    userDataUi.directoryHandle = await SciLLM.loadDirectoryHandle(indexedDB);
  } catch (_) {
    userDataUi.directoryHandle = null;
  } finally {
    userDataUi.handleLoaded = true;
    renderDirectorySupportMessage();
    updateUserDataActionButtons();
  }
}

function showUserDataStatus(message, type = 'info') {
  const status = document.getElementById('userDataStatus');
  status.textContent = String(message || '');
  status.className = message
    ? `status local-data-status show ${type}`
    : 'status local-data-status';
}

function permissionLabel(permission) {
  return {
    granted: '已授权',
    prompt: '需要授权',
    denied: '权限被拒绝',
    unknown: '权限未知',
    unconfigured: '未选择'
  }[permission] || '权限未知';
}

function formatLastSync(value) {
  if (!value) return '尚未同步';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : '尚未同步';
}

async function skipOnboardingStepByName(step) {
  if (onboardingUi.pending) return;
  onboardingUi.active = true;
  onboardingUi.step = step === 'storage' ? 'storage' : 'api';
  document.body.classList.add('is-onboarding');
  try {
    await setOnboardingStepState(onboardingUi.step, 'skipped');
    if (onboardingUi.step === 'storage') openOnboardingStep('api');
    else {
      await prepareOnboardingFinish();
      returnToSettingsOverview();
    }
  } catch (error) {
    document.getElementById('onboardingStepState').textContent =
      `无法保存跳过状态：${friendlyError(error)}`;
  }
}

// Portable config dialog helpers: start.
function validatePortableConfigPassphrases(
  mode, currentPassphrase, passphrase, confirmation
) {
  if (mode === 'rotate' && currentPassphrase.length < 10) {
    return '当前口令至少需要 10 个字符。';
  }
  if (passphrase.length < 10) return '口令至少需要 10 个字符。';
  if ((mode === 'create' || mode === 'rotate') && passphrase !== confirmation) {
    return '两次输入的口令不一致。';
  }
  return '';
}

function portableConfigRequestForMode(mode, currentPassphrase, passphrase) {
  if (mode === 'create') {
    return { type: 'PORTABLE_CONFIG_CREATE', passphrase };
  }
  if (mode === 'unlock') {
    return { type: 'PORTABLE_CONFIG_UNLOCK', passphrase };
  }
  if (mode === 'rotate') {
    return {
      type: 'PORTABLE_CONFIG_ROTATE_PASSPHRASE',
      currentPassphrase,
      newPassphrase: passphrase
    };
  }
  throw new Error('Unsupported portable config dialog mode');
}

function portableConfigErrorText(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'PORTABLE_CONFIG_NOT_READY') {
    return '加密配置尚未就绪，请先创建或解锁配置备份。';
  }
  if (code === 'PORTABLE_CONFIG_PASSPHRASE_TOO_SHORT') {
    return '口令至少需要 10 个字符。';
  }
  if (new Set([
    'PORTABLE_CONFIG_UNLOCK_FAILED', 'PORTABLE_CONFIG_DECRYPT_FAILED',
    'PORTABLE_CONFIG_BACKUP_AUTH_FAILED', 'PORTABLE_CONFIG_CACHED_KEY_INVALID',
    'PORTABLE_CONFIG_CACHED_KEY_REJECTED'
  ]).has(code)) {
    return '口令不正确或备份无法解密。';
  }
  if (code === 'PORTABLE_CONFIG_ALREADY_EXISTS' ||
      code === 'PORTABLE_CONFIG_DIRECTORY_CONFLICT') {
    return '所选目录已有配置备份，请改为解锁后再继续。';
  }
  if (code === 'PORTABLE_CONFIG_DIRECTORY_UNAVAILABLE' ||
      code === 'DIRECTORY_SYNC_UNAVAILABLE') {
    return '当前目录不可用，请恢复目录授权后重试。';
  }
  if (code === 'PORTABLE_CONFIG_CRYPTO_UNAVAILABLE') {
    return '当前浏览器无法使用安全加密功能。';
  }
  if (code.includes('ENVELOPE') || code.includes('PAYLOAD') ||
      code === 'PORTABLE_CONFIG_INVALID_BASE64' ||
      code === 'PORTABLE_CONFIG_INVALID_BINARY') {
    return '配置备份已损坏或版本不兼容，已停止同步。';
  }
  return '无法完成加密配置操作，请稍后重试。';
}
// Portable config dialog helpers: end.

// Portable config status renderer: start.
const PORTABLE_CONFIG_PUBLIC_STATES = new Set([
  'unknown', 'missing', 'locked', 'ready', 'error', 'unavailable', 'disabled'
]);

function normalizePortableConfigStatus(status) {
  if (!status || typeof status !== 'object') {
    return { state: 'disabled', revision: null, updatedAt: '', pending: false, lastError: '' };
  }
  const stateValue = status.state;
  const revisionValue = status.revision;
  const updatedAtValue = status.updatedAt;
  const pendingValue = status.pending;
  const lastErrorValue = status.lastError;
  const state = typeof stateValue === 'string' && PORTABLE_CONFIG_PUBLIC_STATES.has(stateValue)
    ? stateValue : 'unknown';
  const revision = Number.isSafeInteger(revisionValue) && revisionValue >= 0
    ? revisionValue : null;
  const timestamp = typeof updatedAtValue === 'string' && updatedAtValue.length <= 80
    ? Date.parse(updatedAtValue) : NaN;
  const updatedAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
  const lastError = typeof lastErrorValue === 'string' &&
    /^PORTABLE_CONFIG_[A-Z0-9_]+$/.test(lastErrorValue)
    ? lastErrorValue : '';
  return {
    state, revision, updatedAt,
    pending: pendingValue === true,
    lastError
  };
}

function renderPortableConfigStatus(status) {
  const safeStatus = normalizePortableConfigStatus(status);
  userDataUi.portableConfigStatus = safeStatus;
  // A never-selected optional mirror is not a lost-directory error.
  // Keep the actual safety state unchanged for persistence/action guards.
  const noDirectory = userDataUi.lastStatus && !userDataUi.lastStatus.directoryName &&
    safeStatus.state === 'unavailable' && !safeStatus.pending;
  const effectiveState = noDirectory ? 'disabled' : (safeStatus.pending ? 'pending' : safeStatus.state);
  const stateText = {
    ready: '已加密',
    missing: '待创建',
    locked: '待解锁',
    pending: '正在同步',
    unavailable: '目录不可用',
    error: '同步失败',
    unknown: '未启用',
    disabled: '未启用'
  }[effectiveState] || '未启用';
  const noticeText = {
    ready: '配置凭据已加密保存，可在受信任设备上用口令恢复。',
    missing: '配置备份待创建；创建完成前不会同步当前默认配置。',
    locked: '配置备份待解锁；解锁完成前不会同步当前默认配置。',
    pending: '正在安全处理加密配置，请稍候。',
    unavailable: '目录不可用，已停止配置同步。',
    error: '配置备份同步失败，已安全停止。',
    unknown: '暂时无法确认加密配置状态。',
    disabled: '加密配置备份未启用。'
  }[effectiveState] || '加密配置备份未启用。';
  const stateElement = document.getElementById('portableConfigState');
  stateElement.textContent = stateText;
  stateElement.dataset.state = effectiveState;
  document.getElementById('portableConfigRevision').textContent =
    safeStatus.revision === null ? '—' : String(safeStatus.revision);
  document.getElementById('portableConfigUpdatedAt').textContent = safeStatus.updatedAt
    ? new Date(safeStatus.updatedAt).toLocaleString() : '—';
  document.getElementById('portableConfigNotice').textContent = noDirectory
    ? '选择目录后可启用加密备份；当前数据仍保存在浏览器本地。'
    : (safeStatus.lastError ? `${noticeText} 请检查目录状态后重试。` : noticeText);

  const actionPending = userDataUi.pendingAction;
  const readyActionPending = actionPending || safeStatus.pending;
  const unlock = document.getElementById('unlockPortableConfig');
  const rotate = document.getElementById('rotatePortableConfigPassphrase');
  const forget = document.getElementById('forgetPortableConfigKey');
  const backup = document.getElementById('backupPortableConfigNow');
  unlock.hidden = safeStatus.state !== 'locked' && safeStatus.state !== 'missing';
  unlock.textContent = safeStatus.state === 'missing' ? '创建加密备份' : '解锁配置备份';
  rotate.hidden = safeStatus.state !== 'ready';
  forget.hidden = safeStatus.state !== 'ready';
  backup.hidden = safeStatus.state !== 'ready';
  unlock.disabled = actionPending;
  [rotate, forget, backup].forEach(button => { button.disabled = readyActionPending; });
}
// Portable config status renderer: end.

// Portable config dialog controller: start.
function clearPortableConfigDialogInputErrors() {
  ['portableConfigCurrentPassphrase', 'portableConfigPassphrase',
    'portableConfigPassphraseConfirm'].forEach(id => {
    const input = document.getElementById(id);
    input?.removeAttribute('aria-invalid');
    input?.removeAttribute('aria-describedby');
  });
}

function showPortableConfigDialogError(message, inputId) {
  const error = document.getElementById('portableConfigDialogError');
  if (error) error.textContent = message;
  clearPortableConfigDialogInputErrors();
  const input = document.getElementById(inputId);
  if (!input) return;
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', 'portableConfigDialogError');
  input.focus({ preventScroll: true });
}

function portableConfigValidationInputId(mode, currentPassphrase, passphrase, confirmation) {
  if (mode === 'rotate' && currentPassphrase.length < 10) {
    return 'portableConfigCurrentPassphrase';
  }
  if (passphrase.length < 10) return 'portableConfigPassphrase';
  if (mode !== 'unlock' && passphrase !== confirmation) {
    return 'portableConfigPassphraseConfirm';
  }
  return 'portableConfigPassphrase';
}

function clearPortableConfigDialogSecrets() {
  ['portableConfigCurrentPassphrase', 'portableConfigPassphrase',
    'portableConfigPassphraseConfirm'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  const error = document.getElementById('portableConfigDialogError');
  if (error) error.textContent = '';
  clearPortableConfigDialogInputErrors();
  const dialog = document.getElementById('portableConfigDialog');
  dialog?.querySelectorAll('input, button').forEach(control => {
    control.disabled = false;
  });
  dialog?.removeAttribute('aria-busy');
}

function settlePortableConfigDialog() {
  const result = portableConfigUi.pendingResult || { cancelled: true };
  const resolve = portableConfigUi.resolveDialog;
  clearPortableConfigDialogSecrets();
  portableConfigUi.mode = '';
  portableConfigUi.submitting = false;
  portableConfigUi.pendingResult = null;
  portableConfigUi.resolveDialog = null;
  portableConfigUi.dialogPromise = null;
  if (resolve) resolve(result);
}

function completePortableConfigDialog(result) {
  portableConfigUi.pendingResult = result;
  const dialog = document.getElementById('portableConfigDialog');
  if (dialog.open) dialog.close('confirmed');
}

function cancelPortableConfigDialog(event) {
  event?.preventDefault?.();
  if (portableConfigUi.submitting) return;
  portableConfigUi.pendingResult = { cancelled: true };
  const dialog = document.getElementById('portableConfigDialog');
  if (dialog.open) dialog.close('cancelled');
}

function openPortableConfigDialog(mode) {
  if (portableConfigUi.dialogPromise) return portableConfigUi.dialogPromise;
  if (!['create', 'unlock', 'rotate'].includes(mode)) {
    return Promise.resolve({ cancelled: true });
  }
  const copy = {
    create: {
      title: '创建加密配置备份',
      description: '设置一个至少 10 个字符的口令。遗忘口令后无法恢复密文凭据。',
      label: '新口令', confirm: '创建并继续'
    },
    unlock: {
      title: '解锁配置备份',
      description: '输入该目录的口令。解锁成功后会先恢复设置，再继续目录同步。',
      label: '口令', confirm: '解锁并恢复'
    },
    rotate: {
      title: '更换配置备份口令',
      description: '输入当前口令与新口令。新口令至少需要 10 个字符。',
      label: '新口令', confirm: '更换口令'
    }
  }[mode];
  clearPortableConfigDialogSecrets();
  portableConfigUi.mode = mode;
  portableConfigUi.pendingResult = null;
  document.getElementById('portableConfigDialogTitle').textContent = copy.title;
  document.getElementById('portableConfigDialogDescription').textContent = copy.description;
  document.getElementById('portableConfigPassphraseLabel').textContent = copy.label;
  document.getElementById('confirmPortableConfigDialog').textContent = copy.confirm;
  document.getElementById('portableConfigCurrentPassphraseField').hidden = mode !== 'rotate';
  document.getElementById('portableConfigPassphraseConfirmField').hidden = mode === 'unlock';
  const passphraseInput = document.getElementById('portableConfigPassphrase');
  passphraseInput.autocomplete = mode === 'unlock' ? 'current-password' : 'new-password';
  portableConfigUi.dialogPromise = new Promise(resolve => {
    portableConfigUi.resolveDialog = resolve;
  });
  const dialog = document.getElementById('portableConfigDialog');
  dialog.showModal();
  passphraseInput.focus({ preventScroll: true });
  return portableConfigUi.dialogPromise;
}

async function submitPortableConfigDialog(event) {
  event.preventDefault();
  if (portableConfigUi.submitting) return;
  const mode = portableConfigUi.mode;
  let currentPassphrase = document.getElementById('portableConfigCurrentPassphrase').value;
  let passphrase = document.getElementById('portableConfigPassphrase').value;
  let confirmation = document.getElementById('portableConfigPassphraseConfirm').value;
  const errorElement = document.getElementById('portableConfigDialogError');
  const validationError = validatePortableConfigPassphrases(
    mode, currentPassphrase, passphrase, confirmation
  );
  if (validationError) {
    showPortableConfigDialogError(
      validationError,
      portableConfigValidationInputId(mode, currentPassphrase, passphrase, confirmation)
    );
    return;
  }
  portableConfigUi.submitting = true;
  errorElement.textContent = '';
  clearPortableConfigDialogInputErrors();
  const dialog = document.getElementById('portableConfigDialog');
  const controls = [...dialog.querySelectorAll('input, button')];
  controls.forEach(control => { control.disabled = true; });
  dialog.setAttribute('aria-busy', 'true');
  let completed = false;
  let failure = null;
  try {
    const status = normalizePortableConfigStatus(
      await callBackground(portableConfigRequestForMode(
        mode, currentPassphrase, passphrase
      ))
    );
    renderPortableConfigStatus(status);
    completePortableConfigDialog(status);
    completed = true;
  } catch (error) {
    failure = {
      message: portableConfigErrorText(error),
      inputId: mode === 'rotate'
        ? 'portableConfigCurrentPassphrase'
        : 'portableConfigPassphrase'
    };
  } finally {
    currentPassphrase = '';
    passphrase = '';
    confirmation = '';
    if (!completed) {
      portableConfigUi.submitting = false;
      controls.forEach(control => { control.disabled = false; });
      dialog.removeAttribute('aria-busy');
      if (failure) showPortableConfigDialogError(failure.message, failure.inputId);
    }
  }
}
// Portable config dialog controller: end.

function portableConfigAllowsManualDirectoryAction(status) {
  return status?.state === 'ready' && status.pending !== true;
}

function rejectBlockedManualDirectoryAction() {
  if (portableConfigAllowsManualDirectoryAction(userDataUi.portableConfigStatus)) {
    return false;
  }
  showUserDataStatus('请先完成加密配置备份，再同步或重建目录。', 'error');
  return true;
}

function portableConfigNotReadyError(value) {
  const candidate = value?.error && typeof value.error === 'object'
    ? value.error : value;
  return candidate?.code === 'PORTABLE_CONFIG_NOT_READY' ? candidate : null;
}

async function refreshAfterPortableConfigNotReady(value, actionLabel) {
  const error = portableConfigNotReadyError(value);
  if (!error) return false;
  renderPortableConfigStatus({
    state: 'unknown', pending: true, lastError: 'PORTABLE_CONFIG_NOT_READY'
  });
  await refreshUserDataStatus();
  showUserDataStatus(`${actionLabel}：${portableConfigErrorText(error)}`, 'error');
  return true;
}

function updateUserDataActionButtons() {
  const current = userDataUi.lastStatus || {};
  const configured = Boolean(current.directoryName);
  const permission = current.permission || 'unconfigured';
  const portableAllowsSync = portableConfigAllowsManualDirectoryAction(
    userDataUi.portableConfigStatus
  );
  const pickerSupported = typeof window.showDirectoryPicker === 'function';
  const pending = userDataUi.pendingAction;
  document.getElementById('chooseUserDataDirectory').disabled = pending || !pickerSupported;
  document.getElementById('reauthorizeUserDataDirectory').disabled =
    pending || !configured || !userDataUi.directoryHandle || permission === 'granted';
  document.getElementById('syncUserDataNow').disabled =
    pending || !configured || permission !== 'granted' || !portableAllowsSync;
  document.getElementById('rebuildUserDataIndex').disabled =
    pending || !configured || permission !== 'granted' || !portableAllowsSync;
  document.getElementById('exportUserDataBundle').disabled = pending;
  renderPortableConfigStatus(userDataUi.portableConfigStatus);
}

function setUserDataActionPending(pending) {
  userDataUi.pendingAction = Boolean(pending);
  USER_DATA_ACTION_IDS.forEach(id => {
    document.getElementById(id).setAttribute('aria-busy', String(userDataUi.pendingAction));
  });
  updateUserDataActionButtons();
  renderOnboarding();
}

function startUserDataStatusRequest() {
  const requestToken = ++userDataUi.statusRequestSequence;
  userDataUi.activeStatusToken = requestToken;
  return requestToken;
}

function isCurrentUserDataStatus(requestToken) {
  return userDataUi.activeStatusToken === requestToken;
}

function renderUserDataStatus(status) {
  const safeStatus = status && typeof status === 'object' ? status : {};
  userDataUi.lastStatus = safeStatus;
  const directoryName = String(safeStatus.directoryName || '').trim();
  const permission = String(safeStatus.permission || 'unconfigured');
  document.getElementById('userDataDirectory').textContent =
    directoryName || '尚未选择目录';
  const permissionBadge = document.getElementById('userDataPermission');
  permissionBadge.dataset.permission = permission;
  permissionBadge.textContent = permissionLabel(permission);
  document.getElementById('userDataPendingCount').textContent =
    String(Math.max(0, Number(safeStatus.pendingCount) || 0));
  document.getElementById('userDataConflictCount').textContent =
    String(Math.max(0, Number(safeStatus.conflictCount) || 0));
  document.getElementById('userDataLastSync').textContent =
    formatLastSync(safeStatus.lastSyncAt);
  renderPortableConfigStatus(safeStatus.portableConfig);
  renderDirectorySupportMessage();
  updateUserDataActionButtons();
  renderSettingsOverview();
}

async function refreshUserDataStatus({ rethrow = false } = {}) {
  const requestToken = startUserDataStatusRequest();
  try {
    const status = await callBackground({ type: 'USER_DATA_SYNC_STATUS' });
    if (!isCurrentUserDataStatus(requestToken)) return false;
    renderUserDataStatus(status);
    if (status?.lastError) showUserDataStatus(`上次同步未完成：${status.lastError}`, 'error');
    return true;
  } catch (error) {
    if (!isCurrentUserDataStatus(requestToken)) return false;
    showUserDataStatus('读取本地数据状态失败，请稍后重试。', 'error');
    if (rethrow) throw error;
    return false;
  }
}

async function refreshPortableSettings({ replaceTaskPolicyDrafts = false } = {}) {
  const settings = await callBackground({ type: 'LLM_GET_SETTINGS' });
  applyState(settings, { replaceTaskPolicyDrafts, replaceDrafts: replaceTaskPolicyDrafts });
}

// Portable config activation: start.
async function completePortableConfigActivation({ settingsRestored = false,
  call = callBackground, reloadSettings = refreshPortableSettings,
  refreshStatus = () => refreshUserDataStatus({ rethrow: true }),
  isOnboardingActive = () => onboardingUi.active,
  markStorageCompleted = () => setOnboardingStepState('storage', 'completed')
} = {}) {
  if (settingsRestored) {
    await reloadSettings({ replaceTaskPolicyDrafts: true });
  }
  await call({ type: 'USER_DATA_SYNC_NOW', drain: true });
  const refreshed = await refreshStatus();
  if (refreshed === false) {
    const error = new Error('Portable configuration status refresh failed');
    error.code = 'PORTABLE_CONFIG_FAILED';
    throw error;
  }
  if (isOnboardingActive()) await markStorageCompleted();
}

async function activatePortableConfigFromStatusCard({
  currentState = userDataUi.portableConfigStatus?.state,
  openDialog = openPortableConfigDialog,
  finishActivation = completePortableConfigActivation,
  call = callBackground,
  reloadSettings = refreshPortableSettings,
  refreshStatus = () => refreshUserDataStatus({ rethrow: true }),
  isOnboardingActive = () => onboardingUi.active,
  markStorageCompleted = () => setOnboardingStepState('storage', 'completed'),
  renderStatus = renderPortableConfigStatus,
  showStatus = showUserDataStatus,
  errorText = portableConfigErrorText
} = {}) {
  const mode = currentState === 'missing' ? 'create' : 'unlock';
  try {
    const result = await openDialog(mode);
    if (result?.cancelled) {
      showStatus(mode === 'create' ? '配置备份待创建。' : '配置备份待解锁。', 'info');
      return { completed: false, cancelled: true, mode };
    }
    renderStatus(result);
    if (result?.state !== 'ready') {
      showStatus('加密配置尚未就绪，已停止后续操作。', 'error');
      return { completed: false, mode };
    }
    await finishActivation({
      settingsRestored: mode === 'unlock', call, reloadSettings, refreshStatus,
      isOnboardingActive, markStorageCompleted
    });
    showStatus(
      mode === 'create'
        ? '加密配置备份已创建并完成目录同步。'
        : '配置备份已解锁、恢复设置并完成目录同步。',
      'success'
    );
    return { completed: true, mode };
  } catch (error) {
    showStatus(errorText(error), 'error');
    return { completed: false, failed: true, mode };
  }
}
// Portable config activation: end.

async function preparePortableConfigForDirectory({ call = callBackground,
  openDialog = openPortableConfigDialog, reloadSettings = refreshPortableSettings,
  refreshStatus = () => refreshUserDataStatus({ rethrow: true }),
  isOnboardingActive = () => onboardingUi.active,
  markStorageCompleted = () => setOnboardingStepState('storage', 'completed'),
  finishActivation = completePortableConfigActivation,
  renderStatus = renderPortableConfigStatus } = {}) {
  let status = await call({ type: 'PORTABLE_CONFIG_PROBE' });
  renderStatus(status);
  let mode = '';
  if (status?.state === 'missing' || status?.state === 'locked') {
    mode = status.state === 'missing' ? 'create' : 'unlock';
    const dialogResult = await openDialog(mode);
    if (dialogResult?.cancelled === true) {
      return { ready: false, cancelled: true, status };
    }
    status = dialogResult;
    renderStatus(status);
    if (status?.state !== 'ready') return { ready: false, status };
  }
  if (status?.state !== 'ready') return { ready: false, status };
  await finishActivation({
    settingsRestored: mode === 'unlock', call, reloadSettings, refreshStatus,
    isOnboardingActive, markStorageCompleted
  });
  return { ready: true, status };
}

async function chooseUserDataDirectory() {
  if (userDataUi.pendingAction) return;
  if (typeof window.showDirectoryPicker !== 'function') {
    showUserDataStatus('当前浏览器不支持目录选择，请使用 JSON 备份下载。', 'error');
    return;
  }
  setUserDataActionPending(true);
  showUserDataStatus('正在等待你选择本地目录…', 'info');
  let handleSaved = false;
  try {
    const handle = await window.showDirectoryPicker({
      id: 'sci-highlighter-user-data', mode: 'readwrite', startIn: 'documents'
    });
    await SciLLM.saveDirectoryHandle(indexedDB, handle);
    handleSaved = true;
    userDataUi.directoryHandle = handle;
    userDataUi.handleLoaded = true;
    const prepared = await preparePortableConfigForDirectory();
    if (!prepared.ready) {
      await refreshUserDataStatus();
      if (prepared.status?.state === 'missing' || prepared.status?.state === 'locked') {
        const pendingState = prepared.status.state === 'missing' ? '创建' : '解锁';
        showUserDataStatus(`目录已保存，配置备份待${pendingState}；完成前不会同步。`, 'info');
      } else {
        showUserDataStatus('目录已保存，但加密配置状态异常；已安全停止同步。', 'error');
      }
      return;
    }
    showUserDataStatus('目录已保存，加密配置已就绪并完成本地数据同步。', 'success');
  } catch (error) {
    if (handleSaved) await refreshUserDataStatus();
    if (error?.name === 'AbortError' && !handleSaved) {
      showUserDataStatus('已取消选择，现有目录设置没有改变。', 'info');
    } else {
      showUserDataStatus(`选择目录失败：${portableConfigErrorText(error)}`, 'error');
    }
  } finally {
    setUserDataActionPending(false);
  }
}

async function unlockPortableConfig() {
  if (userDataUi.pendingAction) return;
  setUserDataActionPending(true);
  try {
    await activatePortableConfigFromStatusCard();
  } finally {
    setUserDataActionPending(false);
  }
}

async function rotatePortableConfigPassphrase() {
  if (userDataUi.pendingAction || userDataUi.portableConfigStatus?.state !== 'ready') return;
  setUserDataActionPending(true);
  try {
    const result = await openPortableConfigDialog('rotate');
    if (result?.cancelled) return;
    if (result?.state !== 'ready') {
      renderPortableConfigStatus(result);
      showUserDataStatus('口令未更换；加密配置尚未就绪。', 'error');
      return;
    }
    await refreshUserDataStatus();
    showUserDataStatus('加密配置备份口令已更换。', 'success');
  } finally {
    setUserDataActionPending(false);
  }
}

async function forgetPortableConfigKey() {
  if (userDataUi.pendingAction || userDataUi.portableConfigStatus?.state !== 'ready') return;
  const confirmed = window.confirm(
    '确定遗忘本机保存的配置密钥吗？密文备份会保留，但下次使用必须重新输入口令。'
  );
  if (!confirmed) return;
  setUserDataActionPending(true);
  try {
    await callBackground({ type: 'PORTABLE_CONFIG_FORGET_KEY' });
    let status;
    try {
      status = await callBackground({ type: 'PORTABLE_CONFIG_PROBE' });
    } catch (error) {
      renderPortableConfigStatus({
        state: 'unavailable', pending: false,
        lastError: 'PORTABLE_CONFIG_PROBE_FAILED'
      });
      showUserDataStatus(
        '本机密钥已遗忘，但无法确认配置备份状态。请恢复目录授权后重试。',
        'error'
      );
      return;
    }
    renderPortableConfigStatus(status);
    if (status?.state !== 'locked' || status?.pending === true) {
      showUserDataStatus(
        '本机密钥已遗忘，但配置备份状态尚未确认。请检查目录后重试。',
        'error'
      );
      return;
    }
    showUserDataStatus('本机密钥已遗忘；配置备份现在处于待解锁状态。', 'info');
  } catch (error) {
    showUserDataStatus(portableConfigErrorText(error), 'error');
  } finally {
    setUserDataActionPending(false);
  }
}

async function backupPortableConfigNow() {
  if (userDataUi.pendingAction || userDataUi.portableConfigStatus?.state !== 'ready') return;
  setUserDataActionPending(true);
  try {
    const status = await callBackground({ type: 'PORTABLE_CONFIG_BACKUP_NOW' });
    renderPortableConfigStatus(status);
    await refreshUserDataStatus();
    showUserDataStatus('加密配置备份已更新。', 'success');
  } catch (error) {
    showUserDataStatus(portableConfigErrorText(error), 'error');
  } finally {
    setUserDataActionPending(false);
  }
}

async function reauthorizeUserDataDirectory() {
  if (userDataUi.pendingAction) return;
  const handle = userDataUi.directoryHandle;
  if (!handle) {
    showUserDataStatus('无法读取已保存的目录授权，请重新选择目录。', 'error');
    return;
  }
  setUserDataActionPending(true);
  showUserDataStatus('正在请求目录读写权限…', 'info');
  try {
    const permissionRequest = handle.requestPermission({ mode: 'readwrite' });
    const permission = await permissionRequest;
    if (permission !== 'granted') {
      showUserDataStatus('目录授权未通过，你仍可以导出 JSON 备份。', 'error');
      await refreshUserDataStatus();
      return;
    }
    const prepared = await preparePortableConfigForDirectory();
    if (prepared.ready) {
      showUserDataStatus('目录权限已恢复，加密配置已就绪并完成同步。', 'success');
    } else if (prepared.status?.state === 'missing' || prepared.status?.state === 'locked') {
      await refreshUserDataStatus();
      showUserDataStatus('目录权限已恢复，但配置备份仍待创建或解锁。', 'info');
    } else {
      await refreshUserDataStatus();
      showUserDataStatus('目录权限已恢复，但加密配置状态异常；已停止同步。', 'error');
    }
  } catch (error) {
    await refreshUserDataStatus();
    showUserDataStatus(`重新授权失败：${portableConfigErrorText(error)}`, 'error');
  } finally {
    setUserDataActionPending(false);
  }
}

async function syncUserDataNow() {
  if (userDataUi.pendingAction) return;
  if (rejectBlockedManualDirectoryAction()) return;
  setUserDataActionPending(true);
  showUserDataStatus('正在同步本地数据…', 'info');
  try {
    const result = await callBackground({ type: 'USER_DATA_SYNC_NOW' });
    if (await refreshAfterPortableConfigNotReady(result, '同步已停止')) return;
    await refreshUserDataStatus();
    if (result.permission !== 'granted') {
      showUserDataStatus('目录需要重新授权后才能同步。', 'error');
    } else {
      showUserDataStatus(`同步完成：写入 ${result.written || 0} 项。`, 'success');
    }
  } catch (error) {
    if (await refreshAfterPortableConfigNotReady(error, '同步已停止')) return;
    showUserDataStatus(`同步失败：${friendlyError(error)}`, 'error');
  } finally {
    setUserDataActionPending(false);
  }
}

function openRebuildUserDataDialog() {
  if (userDataUi.pendingAction) return;
  if (rejectBlockedManualDirectoryAction()) return;
  const dialog = document.getElementById('rebuildUserDataDialog');
  if (!dialog.open) dialog.showModal();
}

async function confirmRebuildUserDataIndex(event) {
  event.preventDefault();
  if (userDataUi.pendingAction) return;
  if (rejectBlockedManualDirectoryAction()) return;
  document.getElementById('rebuildUserDataDialog').close('confirm');
  setUserDataActionPending(true);
  showUserDataStatus('正在核对目录索引并导入较新数据…', 'info');
  try {
    const result = await callBackground({ type: 'USER_DATA_REBUILD_INDEX' });
    if (await refreshAfterPortableConfigNotReady(result, '重建已停止')) return;
    await refreshSettings();
    await refreshUserDataStatus();
    showUserDataStatus(
      `重建完成：导入 ${result.imported || 0} 项，跳过 ${result.stale || 0} 项旧版本。`,
      'success'
    );
  } catch (error) {
    if (await refreshAfterPortableConfigNotReady(error, '重建已停止')) return;
    showUserDataStatus(`重建失败：${friendlyError(error)}`, 'error');
  } finally {
    setUserDataActionPending(false);
  }
}

async function exportUserDataBundle() {
  if (userDataUi.pendingAction) return;
  setUserDataActionPending(true);
  showUserDataStatus('正在整理 JSON 备份…', 'info');
  try {
    const bundle = await callBackground({ type: 'USER_DATA_EXPORT_BUNDLE' });
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      JSON.stringify(bundle || {}, null, 2),
      'application/json;charset=utf-8',
      `sci-highlighter-user-data-${date}.json`
    );
    showUserDataStatus('JSON 备份已导出。', 'success');
  } catch (error) {
    showUserDataStatus(`导出备份失败：${friendlyError(error)}`, 'error');
  } finally {
    setUserDataActionPending(false);
  }
}

// Article workspace overview: lightweight list first, details only for the visible page.
function articleWorkspaceStatus(message, type = 'info') {
  const status = document.getElementById('articleWorkspaceOverviewStatus');
  status.textContent = String(message || '');
  status.className = message
    ? `status local-data-status show ${type}`
    : 'status local-data-status';
}

function formatWorkspaceBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatWorkspaceTime(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : '暂无记录';
}

function articleWorkspaceIdentity(item) {
  if (item.doi) return `DOI ${item.doi}`;
  if (item.site) return item.site;
  return '本地论文';
}

function filteredArticleWorkspaces() {
  const query = articleWorkspaceOverviewUi.query;
  const items = articleWorkspaceOverviewUi.items.filter(item => {
    if (!query) return true;
    return `${item.title || ''} ${item.doi || ''}`.toLocaleLowerCase().includes(query);
  });
  const sort = articleWorkspaceOverviewUi.sort;
  const text = item => String(item.title || '').toLocaleLowerCase();
  const time = (item, field) => Date.parse(item[field]) || 0;
  return items.sort((left, right) => {
    if (sort === 'size_desc') return (right.estimatedBytes || 0) - (left.estimatedBytes || 0);
    if (sort === 'size_asc') return (left.estimatedBytes || 0) - (right.estimatedBytes || 0);
    if (sort === 'title_asc') return text(left).localeCompare(text(right), 'zh-CN');
    if (sort === 'accessed_desc') return time(right, 'lastAccessedAt') - time(left, 'lastAccessedAt');
    if (sort === 'created_desc') return time(right, 'createdAt') - time(left, 'createdAt');
    return time(right, 'updatedAt') - time(left, 'updatedAt');
  });
}

function articleWorkspacePageModel() {
  const filtered = filteredArticleWorkspaces();
  const pageCount = Math.max(1, Math.ceil(filtered.length / ARTICLE_WORKSPACE_PAGE_SIZE));
  articleWorkspaceOverviewUi.page = Math.min(Math.max(1, articleWorkspaceOverviewUi.page), pageCount);
  const start = (articleWorkspaceOverviewUi.page - 1) * ARTICLE_WORKSPACE_PAGE_SIZE;
  return {
    filtered,
    pageCount,
    items: filtered.slice(start, start + ARTICLE_WORKSPACE_PAGE_SIZE)
  };
}

function visibleArticleWorkspacePage() {
  return articleWorkspacePageModel().items;
}

function workspaceCountDetail(item) {
  return articleWorkspaceOverviewUi.details.get(item.workspaceId) || item;
}

function workspaceSyncLabel(state) {
  return {
    synced: '已同步', pending: '待同步', conflict: '有冲突',
    'content-changed': '正文已变化', deleting: '待清除', 'local-only': '仅本机'
  }[state] || '仅本机';
}

function workspaceMetric(label, value) {
  const metric = document.createElement('span');
  metric.textContent = `${label} ${Math.max(0, Number(value) || 0)}`;
  return metric;
}

function formatTokenCount(value) {
  const count = Math.max(0, Number(value) || 0);
  return new Intl.NumberFormat('zh-CN', {
    notation: count >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1
  }).format(count);
}

function createWorkspaceTokenBreakdown(tokenUsage) {
  const disclosure = document.createElement('details');
  disclosure.className = 'article-workspace-token-usage';
  const summary = document.createElement('summary');
  summary.textContent = '查看各功能与模型 Token';
  disclosure.appendChild(summary);
  const features = Object.values(tokenUsage?.features || {})
    .sort((left, right) => String(left.label).localeCompare(String(right.label), 'zh-CN'));
  if (!features.length) {
    const empty = document.createElement('p');
    empty.textContent = '这篇论文还没有已记录的 LLM Token 消耗。';
    disclosure.appendChild(empty);
    return disclosure;
  }
  features.forEach(feature => {
    const row = document.createElement('div');
    row.className = 'article-workspace-token-feature';
    const heading = document.createElement('strong');
    heading.textContent = feature.label || feature.featureId;
    const numbers = document.createElement('span');
    numbers.textContent =
      `输入 ${formatTokenCount(feature.inputTokens)} · ` +
      `输出 ${formatTokenCount(feature.outputTokens)} · ` +
      `${formatTokenCount(feature.requests)} 次`;
    row.append(heading, numbers);
    const models = Object.values(feature.models || {});
    if (models.length) {
      const modelLine = document.createElement('small');
      modelLine.textContent = models.map(model =>
        `${model.providerId} · ${model.model}（${formatTokenCount(model.inputTokens)} / ` +
        `${formatTokenCount(model.outputTokens)}）`
      ).join('；');
      row.appendChild(modelLine);
    }
    if (Number(feature.estimatedRequests) > 0) {
      const note = document.createElement('em');
      note.textContent = `含 ${feature.estimatedRequests} 次估算`;
      row.appendChild(note);
    }
    disclosure.appendChild(row);
  });
  return disclosure;
}

function createArticleWorkspaceCard(item) {
  const detail = workspaceCountDetail(item);
  const card = document.createElement('article');
  card.className = 'article-workspace-card';

  const checkbox = document.createElement('input');
  checkbox.className = 'article-workspace-select';
  checkbox.type = 'checkbox';
  checkbox.dataset.workspaceSelect = item.workspaceId;
  checkbox.checked = articleWorkspaceOverviewUi.selected.has(item.workspaceId);
  checkbox.setAttribute('aria-label', `选择 ${item.title || '未命名论文'}`);

  const body = document.createElement('div');
  body.className = 'article-workspace-body';
  const titleRow = document.createElement('div');
  titleRow.className = 'article-workspace-title-row';
  const title = document.createElement('strong');
  title.className = 'article-workspace-title';
  title.textContent = item.title || '未命名论文';
  const state = document.createElement('span');
  state.className = 'article-workspace-state';
  state.dataset.state = item.syncState || 'local-only';
  state.textContent = workspaceSyncLabel(item.syncState);
  titleRow.append(title, state);

  const identity = document.createElement('p');
  identity.className = 'article-workspace-identity';
  identity.textContent = [item.site, item.doi ? `DOI ${item.doi}` : ''].filter(Boolean).join(' · ') ||
    articleWorkspaceIdentity(item);

  const metrics = document.createElement('div');
  metrics.className = 'article-workspace-metrics';
  metrics.append(
    workspaceMetric('问答', detail.chatTurnCount),
    workspaceMetric('Figure', detail.figureCount),
    workspaceMetric('Panel', detail.panelCount),
    workspaceMetric('高亮', detail.highlightCount),
    workspaceMetric(
      'Token',
      (Number(detail.tokenUsage?.totals?.inputTokens) || 0) +
        (Number(detail.tokenUsage?.totals?.outputTokens) || 0)
    )
  );
  const size = document.createElement('span');
  size.textContent = `占用 ${formatWorkspaceBytes(detail.estimatedBytes)}`;
  metrics.appendChild(size);

  const times = document.createElement('div');
  times.className = 'article-workspace-times';
  [
    ['创建', item.createdAt], ['访问', item.lastAccessedAt], ['修改', item.updatedAt]
  ].forEach(([label, value]) => {
    const entry = document.createElement('span');
    entry.textContent = `${label}：${formatWorkspaceTime(value)}`;
    times.appendChild(entry);
  });

  const actions = document.createElement('div');
  actions.className = 'article-workspace-actions';
  const workspaceActions = [];
  if (detail.hasOfflineSnapshot) workspaceActions.push(['offline', '离线阅读']);
  workspaceActions.push(
    ['restore', '扫描并恢复'], ['export', '导出'], ['clear', '清除']
  );
  workspaceActions.forEach(([action, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `button ${action === 'clear' ? 'quiet' : 'secondary'}`;
    button.dataset.workspaceAction = action;
    button.dataset.workspaceId = item.workspaceId;
    button.disabled = articleWorkspaceOverviewUi.loading;
    button.textContent = label;
    actions.appendChild(button);
  });

  body.append(
    titleRow,
    identity,
    metrics,
    createWorkspaceTokenBreakdown(detail.tokenUsage),
    times,
    actions
  );
  card.append(checkbox, body);
  return card;
}

function updateArticleWorkspaceOverviewControls() {
  const model = articleWorkspacePageModel();
  const visibleIds = model.items.map(item => item.workspaceId);
  const selectedVisible = visibleIds.filter(id => articleWorkspaceOverviewUi.selected.has(id));
  const selectAll = document.getElementById('articleWorkspaceSelectAll');
  selectAll.disabled = articleWorkspaceOverviewUi.loading || !visibleIds.length;
  selectAll.checked = Boolean(visibleIds.length && selectedVisible.length === visibleIds.length);
  selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
  document.getElementById('clearSelectedArticleWorkspaces').disabled =
    articleWorkspaceOverviewUi.loading || !articleWorkspaceOverviewUi.selected.size;
  document.getElementById('refreshArticleWorkspaceOverview').disabled =
    articleWorkspaceOverviewUi.loading;
  document.getElementById('articleWorkspacePreviousPage').disabled =
    articleWorkspaceOverviewUi.loading || articleWorkspaceOverviewUi.page <= 1;
  document.getElementById('articleWorkspaceNextPage').disabled =
    articleWorkspaceOverviewUi.loading || articleWorkspaceOverviewUi.page >= model.pageCount;
  document.getElementById('articleWorkspacePageStatus').textContent =
    `第 ${articleWorkspaceOverviewUi.page} / ${model.pageCount} 页`;
}

function renderArticleWorkspaceOverview() {
  const list = document.getElementById('articleWorkspaceList');
  const model = articleWorkspacePageModel();
  list.replaceChildren();
  if (!model.items.length) {
    const empty = document.createElement('div');
    empty.className = 'article-workspace-empty';
    empty.textContent = articleWorkspaceOverviewUi.query
      ? '没有匹配标题或 DOI 的论文工作区。'
      : '还没有本地论文工作区。打开论文并激活插件后会自动建立。';
    list.appendChild(empty);
  } else {
    model.items.forEach(item => list.appendChild(createArticleWorkspaceCard(item)));
  }
  const totals = articleWorkspaceOverviewUi.totals || {};
  const sync = articleWorkspaceOverviewUi.sync || {};
  document.getElementById('articleWorkspaceTotals').textContent =
    `${Math.max(0, Number(totals.workspaceCount) || 0)} 篇论文 · ` +
    `${Math.max(0, Number(totals.chatTurnCount) || 0)} 轮问答 · ` +
    `${Math.max(0, Number(totals.figureCount) || 0)} 个 Figure · ` +
    `Token ${formatTokenCount(
      (Number(totals.inputTokens) || 0) + (Number(totals.outputTokens) || 0)
    )}（${Math.max(0, Number(totals.tokenRequests) || 0)} 次） · ` +
    `${formatWorkspaceBytes(totals.estimatedBytes)} · ` +
    `待同步 ${Math.max(0, Number(sync.pendingCount) || 0)} · ` +
    `冲突 ${Math.max(0, Number(sync.conflictCount) || 0)} · ` +
    `损坏 ${Math.max(0, Number(sync.corruptCount) || 0)}`;
  updateArticleWorkspaceOverviewControls();
}

async function readArticleWorkspace(message) {
  let timer;
  try {
    return await Promise.race([
      callBackground(message),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('读取工作区超时，请刷新后重试。');
          error.code = 'WORKSPACE_READ_TIMEOUT';
          reject(error);
        }, ARTICLE_WORKSPACE_READ_TIMEOUT_MS);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function loadArticleWorkspaceDetail(workspaceId) {
  if (articleWorkspaceOverviewUi.details.has(workspaceId)) {
    return articleWorkspaceOverviewUi.details.get(workspaceId);
  }
  const requestSequence = articleWorkspaceOverviewUi.requestSequence;
  const requests = articleWorkspaceOverviewUi.detailRequests;
  const pending = requests.get(workspaceId);
  if (pending?.sequence === requestSequence) return pending.promise;
  const entry = { sequence: requestSequence, promise: null };
  entry.promise = (async () => {
    try {
      const detail = await readArticleWorkspace({ type: 'ARTICLE_WORKSPACE_DETAIL', workspaceId });
      if (requestSequence !== articleWorkspaceOverviewUi.requestSequence ||
          requests.get(workspaceId) !== entry) return null;
      articleWorkspaceOverviewUi.details.set(workspaceId, detail);
      return detail;
    } finally {
      if (requests.get(workspaceId) === entry) requests.delete(workspaceId);
    }
  })();
  requests.set(workspaceId, entry);
  return entry.promise;
}

async function loadVisibleArticleWorkspaceDetails() {
  const requestSequence = articleWorkspaceOverviewUi.requestSequence;
  const missing = visibleArticleWorkspacePage()
    .filter(item => !articleWorkspaceOverviewUi.details.has(item.workspaceId));
  if (!missing.length) return;
  await Promise.all(missing.map(item => loadArticleWorkspaceDetail(item.workspaceId).catch(() => null)));
  if (requestSequence === articleWorkspaceOverviewUi.requestSequence) {
    renderArticleWorkspaceOverview();
  }
}

async function refreshArticleWorkspaceOverview() {
  const requestSequence = ++articleWorkspaceOverviewUi.requestSequence;
  articleWorkspaceOverviewUi.details.clear();
  articleWorkspaceOverviewUi.detailRequests.clear();
  articleWorkspaceOverviewUi.loading = true;
  updateArticleWorkspaceOverviewControls();
  articleWorkspaceStatus('正在刷新论文工作区总览…', 'info');
  try {
    const result = await readArticleWorkspace({ type: 'ARTICLE_WORKSPACE_LIST' });
    if (requestSequence !== articleWorkspaceOverviewUi.requestSequence) return;
    articleWorkspaceOverviewUi.items = Array.isArray(result.workspaces) ? result.workspaces : [];
    articleWorkspaceOverviewUi.totals = result.totals || null;
    articleWorkspaceOverviewUi.sync = result.sync || null;
    articleWorkspaceOverviewUi.details.clear();
    const knownIds = new Set(articleWorkspaceOverviewUi.items.map(item => item.workspaceId));
    articleWorkspaceOverviewUi.selected.forEach(id => {
      if (!knownIds.has(id)) articleWorkspaceOverviewUi.selected.delete(id);
    });
    articleWorkspaceStatus('', 'info');
    renderArticleWorkspaceOverview();
    // Slow optional detail reads must not disable every action in the list.
    void loadVisibleArticleWorkspaceDetails();
  } catch (error) {
    if (requestSequence !== articleWorkspaceOverviewUi.requestSequence) return;
    articleWorkspaceStatus(`读取论文工作区失败：${friendlyError(error)}`, 'error');
  } finally {
    if (requestSequence === articleWorkspaceOverviewUi.requestSequence) {
      articleWorkspaceOverviewUi.loading = false;
      renderArticleWorkspaceOverview();
    }
  }
}

function workspaceDeleteConfirmation(items) {
  const totals = items.reduce((result, item) => {
    const detail = workspaceCountDetail(item);
    result.chat += Math.max(0, Number(detail.chatTurnCount) || 0);
    result.figures += Math.max(0, Number(detail.figureCount) || 0);
    result.panels += Math.max(0, Number(detail.panelCount) || 0);
    result.bytes += Math.max(0, Number(detail.estimatedBytes) || 0);
    return result;
  }, { chat: 0, figures: 0, panels: 0, bytes: 0 });
  const names = items.length <= 3
    ? `\n\n${items.map(item => `“${item.title || '未命名论文'}”`).join('\n')}` : '';
  return `确认清除 ${items.length} 篇论文的本地工作区吗？${names}\n\n` +
    `将删除 ${totals.chat} 轮问答、${totals.figures} 个 Figure、` +
    `${totals.panels} 个 Panel，共约 ${formatWorkspaceBytes(totals.bytes)}。此操作不可撤销。`;
}

async function ensureArticleWorkspaceDetails(items) {
  const requestSequence = articleWorkspaceOverviewUi.requestSequence;
  const details = await Promise.all(items.map(item => loadArticleWorkspaceDetail(item.workspaceId)));
  if (requestSequence !== articleWorkspaceOverviewUi.requestSequence || details.some(item => !item)) {
    throw new Error('工作区列表已更新，请重试。');
  }
}

async function clearArticleWorkspaces(workspaceIds) {
  if (articleWorkspaceOverviewUi.loading) return;
  const ids = new Set(workspaceIds.filter(Boolean));
  const items = articleWorkspaceOverviewUi.items.filter(item => ids.has(item.workspaceId));
  if (!items.length) return;
  articleWorkspaceOverviewUi.loading = true;
  renderArticleWorkspaceOverview();
  let finalStatus = null;
  try {
    await ensureArticleWorkspaceDetails(items);
    if (!confirm(workspaceDeleteConfirmation(items))) return;
    let deleted = 0;
    let pending = 0;
    let pendingDiskCleanup = 0;
    const failed = [];
    for (const item of items) {
      try {
        const started = await callBackground({
          type: 'ARTICLE_WORKSPACE_BEGIN_DELETE',
          workspaceId: item.workspaceId,
          coordinateOpenTabs: true
        });
        const result = await callBackground({
          type: 'ARTICLE_WORKSPACE_FINALIZE_DELETE',
          workspaceId: item.workspaceId,
          tombstoneId: started.tombstoneId,
          coordinateOpenTabs: true
        });
        if (result.deleted) {
          deleted += 1;
          articleWorkspaceOverviewUi.selected.delete(item.workspaceId);
          if (result.pendingDiskCleanup) pendingDiskCleanup += 1;
        } else {
          pending += 1;
        }
      } catch (error) {
        failed.push(`${item.title || '未命名论文'}：${friendlyError(error)}`);
      }
    }
    finalStatus = [
      failed.length
        ? `已清除 ${deleted} 篇；${failed.length} 篇清除失败，${pending} 篇待清除。${failed.join('；')}`
        : pending
        ? `已清除 ${deleted} 篇；${pending} 篇等待目录重新授权后完成。`
        : pendingDiskCleanup
          ? `已清除 ${deleted} 篇本机工作区；${pendingDiskCleanup} 篇目录副本因未授权暂未删除，但已永久屏蔽，不会被扫描恢复。`
          : `已清除 ${deleted} 篇论文工作区。`,
      failed.length ? 'error' : pending || pendingDiskCleanup ? 'info' : 'success'
    ];
  } catch (error) {
    finalStatus = [`清除失败：${friendlyError(error)}`, 'error'];
  } finally {
    articleWorkspaceOverviewUi.loading = false;
    await refreshArticleWorkspaceOverview();
    if (finalStatus) articleWorkspaceStatus(...finalStatus);
  }
}

function safeArticleWorkspaceFilename(item) {
  const base = String(item.title || item.doi || 'article-workspace')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return `${base || 'article-workspace'}.json`;
}

async function handleArticleWorkspaceAction(action, workspaceId) {
  if (articleWorkspaceOverviewUi.loading) return;
  const item = articleWorkspaceOverviewUi.items.find(entry => entry.workspaceId === workspaceId);
  if (!item) return;
  if (action === 'clear') {
    await clearArticleWorkspaces([workspaceId]);
    return;
  }
  articleWorkspaceOverviewUi.loading = true;
  renderArticleWorkspaceOverview();
  let refreshAfterAction = false;
  let finalStatus = null;
  try {
    if (action === 'offline') {
      const detail = workspaceCountDetail(item);
      if (!detail.hasOfflineSnapshot) {
        throw new Error('该论文没有可用的离线正文快照');
      }
      const url = chrome.runtime.getURL(
        `offline-reader.html?workspaceId=${encodeURIComponent(workspaceId)}`
      );
      await chrome.tabs.create({ url });
      finalStatus = [`已打开离线阅读：“${item.title || '未命名论文'}”。`, 'success'];
    } else if (action === 'export') {
      const bundle = await callBackground({ type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId });
      downloadTextFile(
        `${JSON.stringify(bundle, null, 2)}\n`,
        'application/json;charset=utf-8',
        safeArticleWorkspaceFilename(item)
      );
      finalStatus = [`已导出“${item.title || '未命名论文'}”。`, 'success'];
    } else if (action === 'restore') {
      const result = await callBackground({
        type: 'ARTICLE_WORKSPACE_SCAN_RESTORE',
        requestPermission: true,
        identity: {
          canonicalUrl: item.canonicalUrl,
          doi: item.doi,
          title: item.title,
          contentHash: item.contentHash
        }
      });
      if (result.restore) {
        refreshAfterAction = true;
        finalStatus = [
          `已从本地文件恢复“${item.title || '未命名论文'}”，读取 ` +
          `${Array.isArray(result.restore.assets) ? result.restore.assets.length : 0} 个内容文件。`,
          'success'
        ];
      } else if (result.permission !== 'granted') {
        finalStatus = ['需要重新授权本地保存目录后才能扫描恢复。', 'error'];
      } else {
        finalStatus = ['本地保存目录中没有找到匹配的论文工作区。', 'info'];
      }
    }
  } catch (error) {
    finalStatus = [`操作失败：${friendlyError(error)}`, 'error'];
  } finally {
    articleWorkspaceOverviewUi.loading = false;
    if (refreshAfterAction) await refreshArticleWorkspaceOverview();
    else renderArticleWorkspaceOverview();
    if (finalStatus) articleWorkspaceStatus(...finalStatus);
  }
}
// Article workspace overview: end.

function showMigrationStatus(message, type = 'info') {
  const status = document.getElementById('migrationStatus');
  status.textContent = String(message || '');
  status.className = message
    ? `status local-data-status show ${type}`
    : 'status local-data-status';
}

async function exportMigrationBundle() {
  if (userDataUi.pendingAction) return;
  setUserDataActionPending(true);
  showMigrationStatus('正在整理完整迁移文件…', 'info');
  try {
    const bundle = await callBackground({
      type: 'MIGRATION_EXPORT',
      extensionVersion: chrome.runtime.getManifest().version
    });
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      `${JSON.stringify(bundle, null, 2)}\n`,
      'application/json;charset=utf-8',
      `sci-highlighter-complete-migration-${date}.json`
    );
    showMigrationStatus('完整迁移文件已导出。文件含 API Key，请妥善保管。', 'success');
  } catch (error) {
    showMigrationStatus(`导出迁移文件失败：${friendlyError(error)}`, 'error');
  } finally {
    setUserDataActionPending(false);
  }
}

async function importMigrationBundle(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    if (file.size > SciLLM.MAX_MIGRATION_BUNDLE_BYTES) {
      throw new Error('迁移文件超过允许大小');
    }
    pendingMigrationBundle = SciLLM.validateMigrationBundle(
      JSON.parse(await file.text())
    );
    const documentCount = pendingMigrationBundle.documents.documents.length;
    const feedbackCount = pendingMigrationBundle.feedbackSamples.length;
    document.getElementById('migrationImportDialogDescription').textContent =
      `将恢复完整模型与分类配置、${documentCount} 篇文献记录和 ${feedbackCount} 条反馈语料。` +
      '迁移文件中的 API Key 会写入本机扩展存储；迁移文件不包含目录授权，' +
      '当前浏览器已有的目录授权不会改变。';
    document.getElementById('migrationImportDialog').showModal();
  } catch (error) {
    pendingMigrationBundle = null;
    showMigrationStatus(`无法读取迁移文件：${friendlyError(error)}`, 'error');
  }
}

async function confirmMigrationImport(event) {
  event.preventDefault();
  if (!pendingMigrationBundle || userDataUi.pendingAction) return;
  const bundle = pendingMigrationBundle;
  pendingMigrationBundle = null;
  document.getElementById('migrationImportDialog').close('confirm');
  setUserDataActionPending(true);
  showMigrationStatus('正在恢复完整配置与本地记录…', 'info');
  try {
    const result = await callBackground({ type: 'MIGRATION_IMPORT', bundle });
    await refreshSettings({ replaceTaskPolicyDrafts: true });
    await refreshCorpusStatus();
    await refreshUserDataStatus();
    const directoryName = String(userDataUi.lastStatus?.directoryName || '').trim();
    const directoryPermission = String(
      userDataUi.lastStatus?.permission || 'unconfigured'
    );
    const directoryNotice = directoryName
      ? (directoryPermission === 'granted'
        ? '当前本地目录授权保持不变。'
        : '当前本地目录记录已保留；如浏览器要求，请重新授权。')
      : '迁移文件不包含目录授权，请选择本地保存目录。';
    showMigrationStatus(
      `迁移完成：恢复 ${result.importedDocuments || 0} 篇文献记录和 ` +
      `${result.importedFeedback || 0} 条反馈。${directoryNotice}`,
      'success'
    );
  } catch (error) {
    showMigrationStatus(`导入迁移文件失败：${friendlyError(error)}`, 'error');
  } finally {
    setUserDataActionPending(false);
  }
}

function unifiedCategoryEntries() {
  return (Array.isArray(state?.availableCategories) ? state.availableCategories : [])
    .filter(category => category?.categoryId);
}

function renderCategoryList() {
  const list = document.getElementById('categoryList');
  list.replaceChildren();
  const allCategories = unifiedCategoryEntries();
  const categories = allCategories.filter(category => {
    if (!categoryEditor.search) return true;
    return `${category.name} ${category.categoryId}`.toLocaleLowerCase()
      .includes(categoryEditor.search);
  });
  document.getElementById('categoryCount').textContent = String(categories.length);
  if (!categories.length) {
    const empty = document.createElement('p');
    empty.className = 'category-list-empty';
    empty.textContent = '没有找到匹配的类别。可尝试类别名称或英文 ID。';
    list.appendChild(empty);
    return;
  }
  categories.forEach(category => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'category-list-item';
    button.dataset.categoryId = category.categoryId;
    button.setAttribute('role', 'option');
    const active = category.categoryId === categoryEditor.categoryId;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
    button.disabled = categoryEditor.pending;

    const marker = document.createElement('span');
    marker.className = 'category-marker';
    marker.style.setProperty('--category-color', category.color || '#0B4778');
    marker.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'category-list-copy';
    const name = document.createElement('strong');
    name.textContent = category.name;
    const id = document.createElement('small');
    id.textContent = category.categoryId;
    copy.append(name, id);
    const engine = document.createElement('span');
    engine.className = 'category-engine-tag';
    engine.textContent = '规则';
    button.append(marker, copy, engine);
    button.addEventListener('click', event => {
      selectCategory(category.categoryId, event.currentTarget);
    });
    list.appendChild(button);
  });
}

function selectCategory(categoryId, trigger = null) {
  requestCategoryNavigation(categoryId, trigger);
}

function categoryIdFromHash() {
  const parameters = new URLSearchParams(location.hash.replace(/^#/, ''));
  return parameters.get('category');
}

async function loadCategoryFromHash() {
  if (location.hash === '#onboarding') return;
  activateSettingsPage(settingsPageFromHash(), { updateHash: false });
  const categoryId = categoryIdFromHash();
  if (categoryId) {
    if (categoryId === categoryEditor.categoryId) {
      commitCategoryHash(categoryId);
      return;
    }
    restoreAcceptedCategoryHash();
    await requestCategoryNavigation(categoryId);
    return;
  }
  if (!categoryEditor.categoryId) {
    const first = unifiedCategoryEntries()[0];
    if (first) await loadCategory(first.categoryId);
  }
}

function categoryHash(categoryId) {
  return `#page=categories&category=${encodeURIComponent(categoryId)}`;
}

function replaceHash(hash) {
  const nextUrl = `${location.pathname}${location.search}${hash || ''}`;
  history.replaceState(null, '', nextUrl);
}

function commitCategoryHash(categoryId) {
  categoryEditor.acceptedHash = categoryHash(categoryId);
  if (activeSettingsPage === 'categories' &&
      location.hash !== categoryEditor.acceptedHash) {
    replaceHash(categoryEditor.acceptedHash);
  }
}

function restoreAcceptedCategoryHash() {
  if (categoryEditor.acceptedHash && location.hash !== categoryEditor.acceptedHash) {
    replaceHash(categoryEditor.acceptedHash);
  }
}

function queueLatestCategory(categoryId) {
  categoryEditor.queuedCategoryId = String(categoryId || '');
}

function processQueuedCategory() {
  if (categoryEditor.pending || !categoryEditor.queuedCategoryId) return;
  const categoryId = categoryEditor.queuedCategoryId;
  categoryEditor.queuedCategoryId = '';
  requestCategoryNavigation(categoryId);
}

async function requestCategoryNavigation(categoryId, trigger = null) {
  if (!categoryId || categoryId === categoryEditor.categoryId) {
    restoreAcceptedCategoryHash();
    return;
  }
  if (categoryEditor.pending) {
    queueLatestCategory(categoryId);
    restoreAcceptedCategoryHash();
    return;
  }
  if (categoryEditor.dirty) {
    categoryEditor.pendingNavigationId = categoryId;
    categoryEditor.navigationTrigger = trigger;
    restoreAcceptedCategoryHash();
    const dialog = document.getElementById('unsavedCategoryDialog');
    if (!dialog.open) dialog.showModal();
    document.getElementById('cancelCategoryNavigation').focus({ preventScroll: true });
    return;
  }
  await loadCategory(categoryId);
}

function cancelCategoryNavigation() {
  const dialog = document.getElementById('unsavedCategoryDialog');
  if (dialog.open) dialog.close('cancel');
  const trigger = categoryEditor.navigationTrigger;
  categoryEditor.pendingNavigationId = '';
  categoryEditor.navigationTrigger = null;
  restoreAcceptedCategoryHash();
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
}

function discardCategoryChanges() {
  const dialog = document.getElementById('unsavedCategoryDialog');
  const categoryId = categoryEditor.pendingNavigationId;
  if (dialog.open) dialog.close('discard');
  categoryEditor.pendingNavigationId = '';
  categoryEditor.navigationTrigger = null;
  categoryEditor.dirty = false;
  if (categoryId) loadCategory(categoryId);
}

function startCategoryRequest(categoryId) {
  const requestToken = ++categoryEditor.requestSequence;
  categoryEditor.activeRequestToken = requestToken;
  categoryEditor.activeRequestCategoryId = categoryId;
  setCategoryPending(true);
  return requestToken;
}

function isCurrentCategoryRequest(requestToken, categoryId) {
  return categoryEditor.activeRequestToken === requestToken &&
    categoryEditor.activeRequestCategoryId === categoryId;
}

function finishCategoryRequest(requestToken, categoryId) {
  if (!isCurrentCategoryRequest(requestToken, categoryId)) return;
  categoryEditor.activeRequestToken = 0;
  categoryEditor.activeRequestCategoryId = '';
  setCategoryPending(false);
  processQueuedCategory();
}

async function loadCategory(categoryId) {
  if (!categoryId) return;
  if (categoryEditor.pending) {
    queueLatestCategory(categoryId);
    return;
  }
  const requestToken = startCategoryRequest(categoryId);
  setCategoryStatus('working', '正在读取类别规则…');
  try {
    const detail = await callBackground({ type: 'CATEGORY_GET', categoryId });
    if (!isCurrentCategoryRequest(requestToken, categoryId)) return;
    categoryEditor.categoryId = detail.category.categoryId;
    categoryEditor.detail = detail;
    updateAvailableCategory(detail.category);
    populateCategoryEditor(detail);
    renderCategoryList();
    commitCategoryHash(categoryId);
    setCategoryStatus('saved', detail.metadata.overridden ? '已加载本地修改' : '当前使用内置规则');
    document.getElementById('categoryInspectorTitle').focus({ preventScroll: true });
  } catch (error) {
    if (!isCurrentCategoryRequest(requestToken, categoryId)) return;
    setCategoryStatus('failed', `读取失败：${friendlyError(error)}`);
  } finally {
    finishCategoryRequest(requestToken, categoryId);
  }
}

function populateCategoryEditor(detail) {
  const { category, metadata, promptPreview } = detail;
  document.getElementById('categoryInspectorTitle').textContent = category.name;
  document.getElementById('categoryInspectorId').textContent = category.categoryId;
  document.getElementById('categoryInspectorSwatch').style.backgroundColor = category.color;
  const badge = document.getElementById('categoryOverrideBadge');
  badge.textContent = metadata.builtIn
    ? (metadata.overridden ? '已本地修改' : '内置规则')
    : '自定义类别';
  badge.classList.toggle('is-overridden', metadata.overridden || !metadata.builtIn);
  document.getElementById('resetCategoryOverride').hidden = !metadata.builtIn;
  const deleteButton = document.getElementById('deleteSelectedCategory');
  deleteButton.disabled = false;
  document.getElementById('exportCategoryModule').disabled = false;
  document.getElementById('duplicateSelectedCategory').disabled = false;
  deleteButton.title = metadata.builtIn
    ? '永久删除这个内置类别'
    : '永久删除这个自定义类别';
  document.querySelectorAll('[data-category-field]')
    .forEach(field => { field.disabled = false; });
  document.getElementById('categoryName').value = category.name;
  document.getElementById('categoryColor').value = category.color;
  document.getElementById('categoryEngineLlm').checked = category.enabledEngines.includes('llm');
  document.getElementById('categoryEngineRegex').checked = category.enabledEngines.includes('regex');
  document.getElementById('categoryDefinition').value = category.prompt.definition;
  document.getElementById('categoryDecisionQuestion').value = category.prompt.decisionQuestion;
  document.getElementById('categoryIncludeWhen').value = category.prompt.includeWhen.join('\n');
  document.getElementById('categoryExcludeWhen').value = category.prompt.excludeWhen.join('\n');
  document.getElementById('categoryPositiveExamples').value = category.prompt.positiveExamples.join('\n');
  document.getElementById('categoryNegativeExamples').value = category.prompt.negativeExamples.join('\n');
  document.getElementById('categoryRequiredSlots').value = category.prompt.requiredSlots.join('\n');
  document.getElementById('categoryAllowedQuoteRoles').value = category.prompt.allowedQuoteRoles.join('\n');
  document.getElementById('categoryClaimMode').value =
    ['explicit', 'inferred', 'either'].includes(category.claimMode)
      ? category.claimMode : 'explicit';
  document.getElementById('categoryRelationRequired').checked =
    category.relationRequired === true;
  document.getElementById('categorySpanPolicy').value = category.prompt.spanPolicy;
  document.getElementById('categoryMinimumConfidence').value = category.prompt.minimumConfidence;
  document.getElementById('categoryPromptPreview').value = promptPreview;
  document.getElementById('categoryRegexPhrases').value = category.regex.phrases.join('\n');
  document.getElementById('categoryRegexExcludePhrases').value =
    (category.regex.excludePhrases || []).join('\n');
  document.getElementById('categoryRegexExpressions').value = category.regex.expressions.join('\n');
  document.getElementById('categoryRegexCaseSensitive').checked = category.regex.caseSensitive;
  document.getElementById('categoryRegexWholeWord').checked = category.regex.wholeWord;
  document.getElementById('categoryRegexResults').replaceChildren();
  categoryEditor.dirty = false;
}

function activateCategoryTab(name, focus = true) {
  const promptSelected = name !== 'regex';
  const promptTab = document.getElementById('categoryPromptTab');
  const regexTab = document.getElementById('categoryRegexTab');
  promptTab.classList.toggle('is-active', promptSelected);
  regexTab.classList.toggle('is-active', !promptSelected);
  promptTab.setAttribute('aria-selected', String(promptSelected));
  regexTab.setAttribute('aria-selected', String(!promptSelected));
  promptTab.tabIndex = promptSelected ? 0 : -1;
  regexTab.tabIndex = promptSelected ? -1 : 0;
  document.getElementById('categoryPromptPanel').hidden = !promptSelected;
  document.getElementById('categoryRegexPanel').hidden = promptSelected;
  if (focus) (promptSelected ? promptTab : regexTab).focus();
}

function handleCategoryTabKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const prompt = event.key === 'ArrowLeft' || event.key === 'Home';
  activateCategoryTab(prompt ? 'prompt' : 'regex');
}

function markCategoryUnsaved() {
  if (!categoryEditor.detail || categoryEditor.pending) return;
  categoryEditor.dirty = true;
  setCategoryStatus('unsaved', '有尚未保存的修改');
}

function valueOf(id) {
  return document.getElementById(id).value.trim();
}

function checked(id) {
  return document.getElementById(id).checked;
}

function checkedEngineValues() {
  return [
    ['categoryEngineLlm', 'llm'],
    ['categoryEngineRegex', 'regex']
  ].filter(([id]) => checked(id)).map(([, engine]) => engine);
}

function linesFrom(id) {
  return document.getElementById(id).value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function collectCategoryOverride() {
  return {
    name: valueOf('categoryName'),
    color: valueOf('categoryColor'),
    enabledEngines: checkedEngineValues(),
    prompt: {
      definition: valueOf('categoryDefinition'),
      decisionQuestion: valueOf('categoryDecisionQuestion'),
      includeWhen: linesFrom('categoryIncludeWhen'),
      excludeWhen: linesFrom('categoryExcludeWhen'),
      positiveExamples: linesFrom('categoryPositiveExamples'),
      negativeExamples: linesFrom('categoryNegativeExamples'),
      requiredSlots: linesFrom('categoryRequiredSlots'),
      allowedQuoteRoles: linesFrom('categoryAllowedQuoteRoles'),
      spanPolicy: valueOf('categorySpanPolicy'),
      minimumConfidence: Number(valueOf('categoryMinimumConfidence'))
    },
    claimMode: valueOf('categoryClaimMode'),
    relationRequired: checked('categoryRelationRequired'),
    regex: {
      phrases: linesFrom('categoryRegexPhrases'),
      excludePhrases: linesFrom('categoryRegexExcludePhrases'),
      expressions: linesFrom('categoryRegexExpressions'),
      caseSensitive: checked('categoryRegexCaseSensitive'),
      wholeWord: checked('categoryRegexWholeWord')
    }
  };
}

function exportCategoryModule() {
  if (!categoryEditor.categoryId || !categoryEditor.detail) return;
  const bundle = {
    schema: 'sci-category-module',
    version: 1,
    exportedAt: new Date().toISOString(),
    sourceCategoryId: categoryEditor.categoryId,
    module: collectCategoryOverride()
  };
  const safeId = categoryEditor.categoryId.replace(/[^a-z0-9_-]+/gi, '_');
  downloadTextFile(
    JSON.stringify(bundle, null, 2),
    'application/json',
    `SCI-category-${safeId}.json`
  );
  setCategoryStatus('saved', '已导出本类别的 AI 提示词与正则模块');
}

async function importCategoryModule(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !categoryEditor.categoryId || !categoryEditor.detail) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed?.schema !== 'sci-category-module' || parsed?.version !== 1 ||
        !parsed.module || typeof parsed.module !== 'object') {
      throw new Error('不是有效的类别模块文件');
    }
    const current = categoryEditor.detail.category;
    const module = parsed.module;
    const imported = {
      ...current,
      name: String(module.name || current.name),
      color: /^#[0-9a-f]{6}$/i.test(String(module.color || ''))
        ? module.color : current.color,
      enabledEngines: Array.isArray(module.enabledEngines)
        ? module.enabledEngines.filter(engine => ['llm', 'regex'].includes(engine))
        : current.enabledEngines,
      claimMode: ['explicit', 'inferred', 'either'].includes(module.claimMode)
        ? module.claimMode : current.claimMode,
      relationRequired: typeof module.relationRequired === 'boolean'
        ? module.relationRequired : current.relationRequired,
      prompt: {
        ...current.prompt,
        ...(module.prompt && typeof module.prompt === 'object' ? module.prompt : {})
      },
      regex: {
        ...current.regex,
        ...(module.regex && typeof module.regex === 'object' ? module.regex : {})
      }
    };
    populateCategoryEditor({
      ...categoryEditor.detail,
      category: imported,
      promptPreview: '已导入草稿；保存类别规则后会重新生成提示词预览。'
    });
    categoryEditor.dirty = true;
    setCategoryStatus('unsaved', '已导入模块草稿，请检查后点击“保存类别规则”');
  } catch (error) {
    setCategoryStatus('failed', `导入失败：${friendlyError(error)}`);
  }
}

function setCategoryPending(pending) {
  categoryEditor.pending = pending;
  document.querySelectorAll('.category-list-item')
    .forEach(button => { button.disabled = pending; });
  ['saveCategoryOverride', 'resetCategoryOverride', 'deleteSelectedCategory',
    'duplicateSelectedCategory', 'testCategoryRegex', 'exportCategoryModule']
    .forEach(id => {
      const button = document.getElementById(id);
      button.disabled = pending || (id === 'resetCategoryOverride' &&
        categoryEditor.detail?.metadata?.builtIn === false) ||
        (id === 'deleteSelectedCategory' && !categoryEditor.categoryId);
    });
}

function setCategoryStatus(status, message) {
  const element = document.getElementById('categoryEditorStatus');
  element.dataset.state = status;
  element.textContent = message;
}

function updateAvailableCategory(category) {
  const entry = state?.availableCategories?.find(item => item.categoryId === category.categoryId);
  if (!entry) return;
  entry.name = category.name;
  entry.color = category.color;
}

async function saveCategoryOverride() {
  if (!categoryEditor.categoryId || categoryEditor.pending) return;
  const categoryId = categoryEditor.categoryId;
  const requestToken = startCategoryRequest(categoryId);
  setCategoryStatus('working', '正在校验并保存…');
  try {
    const detail = await callBackground({
      type: 'CATEGORY_SAVE_OVERRIDE',
      categoryId,
      override: collectCategoryOverride()
    });
    if (!isCurrentCategoryRequest(requestToken, categoryId)) return;
    categoryEditor.detail = detail;
    updateAvailableCategory(detail.category);
    populateCategoryEditor(detail);
    renderCategoryList();
    setCategoryStatus('saved', '类别规则已保存在本机');
  } catch (error) {
    if (!isCurrentCategoryRequest(requestToken, categoryId)) return;
    setCategoryStatus('failed', `保存失败：${friendlyError(error)}`);
  } finally {
    finishCategoryRequest(requestToken, categoryId);
  }
}

function openResetDialog() {
  if (!categoryEditor.categoryId || categoryEditor.pending ||
      categoryEditor.detail?.metadata?.builtIn === false) return;
  const dialog = document.getElementById('resetCategoryDialog');
  if (!dialog.open) dialog.showModal();
}

async function resetCategoryOverride() {
  if (!categoryEditor.categoryId || categoryEditor.pending) return;
  const categoryId = categoryEditor.categoryId;
  const requestToken = startCategoryRequest(categoryId);
  setCategoryStatus('working', '正在恢复内置规则…');
  try {
    const detail = await callBackground({
      type: 'CATEGORY_RESET_OVERRIDE', categoryId
    });
    if (!isCurrentCategoryRequest(requestToken, categoryId)) return;
    categoryEditor.detail = detail;
    updateAvailableCategory(detail.category);
    populateCategoryEditor(detail);
    renderCategoryList();
    setCategoryStatus('saved', '已恢复内置规则');
  } catch (error) {
    if (!isCurrentCategoryRequest(requestToken, categoryId)) return;
    setCategoryStatus('failed', `恢复失败：${friendlyError(error)}`);
  } finally {
    finishCategoryRequest(requestToken, categoryId);
  }
}

async function testCategoryRegex() {
  if (!categoryEditor.categoryId || categoryEditor.pending) return;
  const categoryId = categoryEditor.categoryId;
  const requestToken = startCategoryRequest(categoryId);
  setCategoryStatus('working', '正在安全试跑当前正则…');
  try {
    const result = await callBackground({
      type: 'CATEGORY_TEST_REGEX',
      categoryId,
      candidateRegex: collectCategoryOverride().regex,
      testText: document.getElementById('categoryRegexTestText').value
    });
    if (!isCurrentCategoryRequest(requestToken, categoryId)) return;
    renderRegexMatches(result.matches, result.truncated);
    setCategoryStatus(
      categoryEditor.dirty ? 'unsaved' : 'saved',
      `${result.matches.length} 条匹配${result.truncated ? '（仅显示前 100 条）' : ''}；测试未保存规则`
    );
  } catch (error) {
    if (!isCurrentCategoryRequest(requestToken, categoryId)) return;
    renderRegexMatches([], false);
    setCategoryStatus('failed', `测试失败：${friendlyError(error)}`);
  } finally {
    finishCategoryRequest(requestToken, categoryId);
  }
}

function renderRegexMatches(matches, truncated) {
  const list = document.getElementById('categoryRegexResults');
  list.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement('li');
    empty.className = 'regex-empty';
    empty.textContent = '没有匹配到内容。';
    list.appendChild(empty);
    return;
  }
  matches.forEach(match => {
    const item = document.createElement('li');
    const source = document.createElement('span');
    source.className = 'regex-result-source';
    source.textContent = match.expressionRow;
    const offset = document.createElement('span');
    offset.className = 'regex-result-offset';
    offset.textContent = `${match.start}–${match.end}`;
    const text = document.createElement('span');
    text.className = 'regex-result-text';
    text.textContent = match.text;
    item.append(source, offset, text);
    list.appendChild(item);
  });
  if (truncated) list.setAttribute('aria-label', '仅显示前 100 条匹配');
  else list.removeAttribute('aria-label');
}

async function refreshSettings({ replaceTaskPolicyDrafts = false } = {}) {
  try {
    applyState(await callBackground({ type: 'LLM_GET_SETTINGS' }), {
      replaceTaskPolicyDrafts, replaceDrafts: replaceTaskPolicyDrafts
    });
  } catch (error) {
    showStatus(`读取设置失败：${error.message}`, 'error');
  }
}

function renderPdfMineruSettings() {
  const mode = document.getElementById('pdfMineruMode')?.value || 'agent';
  const tokenField = document.getElementById('pdfMineruTokenField');
  const credential = document.getElementById('pdfMineruCredentialState');
  const clear = document.getElementById('clearPdfMineruToken');
  if (tokenField) tokenField.hidden = mode !== 'precise';
  const configured = Boolean(pdfMineruSettingsState.token);
  if (credential) {
    credential.dataset.configured = String(configured);
    credential.textContent = configured
      ? 'MinerU Token 已保存在本机'
      : mode === 'precise' ? '精准解析需要 Token' : '轻量解析无需 Token';
  }
  if (clear) clear.disabled = !configured;
}

async function loadPdfMineruSettings() {
  const stored = await chrome.storage.local.get(SciLLM.PDF_MINERU_SETTINGS_KEY);
  pdfMineruSettingsState = SciLLM.normalizeMineruPdfSettings(
    stored?.[SciLLM.PDF_MINERU_SETTINGS_KEY]
  );
  document.getElementById('pdfMineruMode').value = pdfMineruSettingsState.mode;
  document.getElementById('pdfMineruLanguage').value =
    pdfMineruSettingsState.language;
  document.getElementById('pdfMineruOcr').checked =
    pdfMineruSettingsState.isOcr;
  document.getElementById('pdfMineruToken').value = '';
  renderPdfMineruSettings();
}

async function savePdfMineruSettings({ clearToken = false } = {}) {
  const save = document.getElementById('savePdfMineruSettings');
  const clear = document.getElementById('clearPdfMineruToken');
  const status = document.getElementById('pdfMineruStatus');
  const tokenInput = document.getElementById('pdfMineruToken');
  const next = SciLLM.normalizeMineruPdfSettings({
    mode: document.getElementById('pdfMineruMode').value,
    token: clearToken
      ? ''
      : tokenInput.value.trim() || pdfMineruSettingsState.token,
    quotaUserId: pdfMineruSettingsState.quotaUserId,
    language: document.getElementById('pdfMineruLanguage').value,
    isOcr: document.getElementById('pdfMineruOcr').checked,
    enableTable: true,
    enableFormula: true
  });
  save.disabled = true;
  clear.disabled = true;
  if (status) {
    status.dataset.state = '';
    status.textContent = clearToken
      ? '正在清除 MinerU Token…'
      : '正在保存 PDF 解析设置…';
  }
  try {
    await chrome.storage.local.set({
      [SciLLM.PDF_MINERU_SETTINGS_KEY]: next
    });
    pdfMineruSettingsState = next;
    tokenInput.value = '';
    renderPdfMineruSettings();
    if (status) {
      status.dataset.state = 'success';
      status.textContent = clearToken
        ? 'MinerU Token 已清除；PDF 仍可使用轻量解析。'
        : 'PDF 解析设置已保存；下次激活 PDF 标签页会自动使用。';
    }
  } catch (error) {
    if (status) {
      status.dataset.state = 'error';
      status.textContent = `PDF 解析设置保存失败：${friendlyError(error)}`;
    }
  } finally {
    save.disabled = false;
    renderPdfMineruSettings();
  }
}

async function refreshCorpusStatus() {
  try {
    const result = await callBackground({ type: 'LLM_CORPUS_STATUS' });
    const stats = result.stats;
    document.getElementById('corpusStats').textContent =
      `${stats.documents} 篇文档 · ${stats.total} 条反馈`;
  } catch (error) {
    document.getElementById('corpusStats').textContent = '读取失败';
  }
}

function downloadTextFile(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function exportCorpus(format) {
  try {
    const result = await callBackground({ type: 'LLM_EXPORT_CORPUS', format });
    if (!result.content) {
      showStatus('本地语料库还是空的，请先在论文页反馈一些 LLM 高亮。', 'info');
      return;
    }
    downloadTextFile(result.content, result.mimeType, result.filename);
    showStatus(`已导出 ${format.toUpperCase()} 语料。`, 'success');
  } catch (error) {
    showStatus(`导出失败：${friendlyError(error)}`, 'error');
  }
}

async function distillRules() {
  try {
    const result = await callBackground({ type: 'LLM_DISTILL_RULES' });
    const count = Object.keys(result.rules || {}).length;
    if (!count) {
      showStatus('暂时没有达到阈值的离线规则；同一短语需在至少 3 篇不同文档中获得正向确认。', 'info');
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      JSON.stringify(result.rules, null, 2),
      'application/json;charset=utf-8',
      `sci-distilled-rules-${date}.json`
    );
    showStatus(`已生成 ${count} 类离线规则，可在插件弹窗中导入。`, 'success');
  } catch (error) {
    showStatus(`生成规则失败：${friendlyError(error)}`, 'error');
  }
}

function compatiblePresets() {
  return Array.isArray(state?.compatibleProviderPresets)
    ? state.compatibleProviderPresets : [];
}

function compatiblePresetFor(id) {
  return compatiblePresets().find(preset => preset.id === id) || null;
}

function providerSelectionDescriptor(value = document.getElementById('providerId')?.value) {
  const selection = String(value || '');
  if (selection.startsWith(COMPATIBLE_PROVIDER_VALUE_PREFIX)) {
    return {
      providerId: 'openai-compatible',
      presetId: selection.slice(COMPATIBLE_PROVIDER_VALUE_PREFIX.length) || 'custom',
      selection
    };
  }
  return {
    providerId: selection,
    presetId: selection === 'openai-compatible'
      ? (document.getElementById('compatiblePreset')?.value || 'custom')
      : '',
    selection
  };
}

function providerSelectionValue(profile = profileById(selectedProfileId)) {
  if (profile?.providerId !== 'openai-compatible') return profile?.providerId || '';
  const presetId = String(profile?.config?.presetId || 'custom');
  return presetId !== 'custom' && compatiblePresetFor(presetId)
    ? `${COMPATIBLE_PROVIDER_VALUE_PREFIX}${presetId}`
    : 'openai-compatible';
}

function renderCompatiblePresetHint(preset) {
  const hint = document.getElementById('compatiblePresetHint');
  hint.textContent = preset?.description ||
    '选择后自动填入服务地址与默认模型；API Key 不会被修改。';
}

function applyCompatiblePreset(presetId = document.getElementById('compatiblePreset').value) {
  const preset = compatiblePresetFor(presetId);
  if (!preset) return;
  document.getElementById('compatiblePreset').value = preset.id;
  document.getElementById('model').value = preset.defaultModel || '';
  document.getElementById('baseUrl').value = preset.baseUrl || '';
  document.getElementById('authHeader').value = preset.authHeader || 'Authorization';
  document.getElementById('authPrefix').value = preset.authPrefix ?? 'Bearer';
  document.getElementById('jsonMode').checked = preset.jsonMode !== false;
  document.getElementById('supportsVision').checked = preset.supportsVision === true;
  markProfileEditorDirty({ target: { id: 'compatiblePreset' } });
  renderCompatiblePresetHint(preset);
  renderModelSuggestions('openai-compatible');
  updateProfileListPreview();
  renderTaskPolicyTable();
}

function markCompatiblePresetCustom() {
  const descriptor = providerSelectionDescriptor();
  if (descriptor.providerId !== 'openai-compatible' ||
      descriptor.selection !== 'openai-compatible') return;
  const select = document.getElementById('compatiblePreset');
  if (compatiblePresetFor('custom')) select.value = 'custom';
  renderCompatiblePresetHint(compatiblePresetFor('custom'));
  renderTaskPolicyTable();
}

function renderCustomCategories() {
  const container = document.getElementById('customCategoriesList');
  container.replaceChildren();
  const categories = Array.isArray(state?.customCategories) ? state.customCategories : [];
  if (!categories.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-categories';
    empty.textContent = '还没有自定义类别。';
    container.appendChild(empty);
    return;
  }
  categories.forEach(category => {
    const row = document.createElement('div');
    row.className = 'custom-category-row';
    const swatch = document.createElement('span');
    swatch.className = 'category-swatch';
    swatch.style.backgroundColor = category.color;
    const text = document.createElement('div');
    text.className = 'category-summary';
    const name = document.createElement('strong');
    name.textContent = category.name;
    const detail = document.createElement('span');
    detail.textContent = category.persistence === 'one-off' ? '仅本次会话' : '长期保存';
    text.append(name, detail);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'category-delete';
    remove.textContent = '删除';
    remove.addEventListener('click', () => deleteCategory(category.categoryId, {
      requireConfirmation: true
    }));
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'category-edit';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => {
      document.getElementById('categoryWorkspace')?.scrollIntoView({
        behavior: 'smooth', block: 'start'
      });
      selectCategory(category.categoryId, edit);
    });
    row.append(swatch, text, edit, remove);
    container.appendChild(row);
  });
}

function renderDeletedBuiltInCategories() {
  const section = document.getElementById('deletedBuiltInCategorySection');
  const container = document.getElementById('deletedBuiltInCategoriesList');
  const categories = Array.isArray(state?.deletedBuiltInCategories)
    ? state.deletedBuiltInCategories
    : [];
  section.hidden = categories.length === 0;
  container.replaceChildren();
  categories.forEach(category => {
    const row = document.createElement('div');
    row.className = 'deleted-built-in-row';
    const copy = document.createElement('span');
    copy.className = 'deleted-built-in-copy';
    const name = document.createElement('strong');
    name.textContent = category.name || category.categoryId;
    const id = document.createElement('span');
    id.textContent = category.categoryId;
    copy.append(name, id);
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'category-restore';
    restore.textContent = '恢复';
    restore.addEventListener('click', () =>
      restoreBuiltInCategory(category.categoryId)
    );
    row.append(copy, restore);
    container.appendChild(row);
  });
}

async function saveCustomCategory() {
  const category = {
    name: document.getElementById('customCategoryName').value.trim(),
    definition: document.getElementById('customCategoryDefinition').value.trim(),
    decisionQuestion: document.getElementById('customCategoryDecisionQuestion').value.trim(),
    color: document.getElementById('customCategoryColor').value,
    includeWhen: linesFrom('customCategoryInclude'),
    excludeWhen: linesFrom('customCategoryExclude'),
    positiveExamples: linesFrom('customCategoryPositive'),
    negativeExamples: linesFrom('customCategoryNegative'),
    requiredSlots: linesFrom('customCategoryRequiredSlots'),
    allowedQuoteRoles: linesFrom('customCategoryAllowedQuoteRoles'),
    spanPolicy: document.getElementById('customCategorySpanPolicy').value,
    minimumConfidence: Number(
      document.getElementById('customCategoryMinimumConfidence').value
    ),
    claimMode: document.getElementById('customCategoryClaimMode').value,
    relationRequired: document.getElementById('customCategoryRelationRequired').checked,
    persistence: document.getElementById('customCategoryPersistence').value
  };
  if (!category.name || !category.definition) {
    showStatus('请填写自定义类别的名称和识别定义。', 'error');
    return;
  }
  try {
    applyState(await callBackground({ type: 'LLM_SAVE_CUSTOM_CATEGORY', category }));
    ['customCategoryName', 'customCategoryDefinition', 'customCategoryDecisionQuestion',
      'customCategoryInclude', 'customCategoryExclude', 'customCategoryPositive',
      'customCategoryNegative',
      'customCategoryRequiredSlots', 'customCategoryAllowedQuoteRoles']
      .forEach(id => { document.getElementById(id).value = ''; });
    showStatus('自定义识别类别已添加，并已默认勾选。', 'success');
  } catch (error) {
    showStatus(`添加类别失败：${friendlyError(error)}`, 'error');
  }
}

async function deleteCategory(categoryId, { requireConfirmation = false } = {}) {
  if (!categoryId || categoryEditor.pending) return;
  const category = unifiedCategoryEntries()
    .find(item => item.categoryId === categoryId);
  if (!category) return;
  const builtIn = category.builtIn !== false;
  if (requireConfirmation &&
      !confirm(
        `确认永久删除${builtIn ? '内置' : '自定义'}类别“` +
        `${category.name || categoryId}”吗？\n\n` +
        '删除后将不再参与正则、LLM 或手动标注；已有标注会保留类别快照。'
      )) {
    return;
  }
  setCategoryPending(true);
  setCategoryStatus('working', '正在永久删除类别…');
  try {
    applyState(await callBackground({
      type: builtIn ? 'CATEGORY_DELETE' : 'LLM_DELETE_CUSTOM_CATEGORY',
      categoryId
    }));
    if (categoryEditor.categoryId === categoryId) {
      categoryEditor.categoryId = '';
      categoryEditor.detail = null;
      categoryEditor.dirty = false;
      const next = unifiedCategoryEntries()[0];
      setCategoryPending(false);
      if (next) await loadCategory(next.categoryId);
      else clearCategoryEditor();
    }
    showStatus(`${builtIn ? '内置' : '自定义'}识别类别已永久删除。`, 'success');
  } catch (error) {
    showStatus(`删除类别失败：${friendlyError(error)}`, 'error');
    setCategoryStatus('failed', `删除失败：${friendlyError(error)}`);
  } finally {
    setCategoryPending(false);
  }
}

function clearCategoryEditor() {
  categoryEditor.categoryId = '';
  categoryEditor.detail = null;
  categoryEditor.dirty = false;
  document.getElementById('categoryInspectorTitle').textContent = '尚无可用类别';
  document.getElementById('categoryInspectorId').textContent = '—';
  document.getElementById('categoryOverrideBadge').textContent = '可新建或恢复';
  document.getElementById('categoryInspectorSwatch').style.backgroundColor = '#DDE1E5';
  document.getElementById('resetCategoryOverride').hidden = true;
  document.getElementById('deleteSelectedCategory').disabled = true;
  document.getElementById('duplicateSelectedCategory').disabled = true;
  document.querySelectorAll('[data-category-field]')
    .forEach(field => { field.disabled = true; });
  setCategoryStatus('saved', '请新建类别，或在页面下方恢复已删除的内置类别');
}

async function restoreBuiltInCategory(categoryId) {
  if (!categoryId || categoryEditor.pending) return;
  setCategoryPending(true);
  try {
    applyState(await callBackground({
      type: 'CATEGORY_RESTORE_BUILT_IN', categoryId
    }));
    setCategoryPending(false);
    await loadCategory(categoryId);
    showStatus('内置识别类别已恢复。', 'success');
  } catch (error) {
    showStatus(`恢复类别失败：${friendlyError(error)}`, 'error');
  } finally {
    setCategoryPending(false);
  }
}

function endpointFor(providerId, config) {
  return providerId === 'openai-compatible' ? config.baseUrl : OFFICIAL_ENDPOINTS[providerId];
}

async function requestEndpointPermission(providerId, config) {
  if (['codex-local', 'deepseek-harness'].includes(providerId)) return;
  const endpoint = endpointFor(providerId, config);
  if (!endpoint) throw new Error('请填写 Base URL');
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Base URL 格式不正确');
  }
  const originPattern = `${url.origin}/*`;
  const granted = await chrome.permissions.request({ origins: [originPattern] });
  if (!granted) throw new Error('未授予服务商域名访问权限');
}

// Legacy message names remain documented for migration compatibility:
// LLM_SAVE_PROVIDER and LLM_TEST_PROVIDER.
function applyState(nextState, { replaceTaskPolicyDrafts = false, replaceDrafts = false } = {}) {
  if (typeof updateProviderBindingsForState === 'function') updateProviderBindingsForState(nextState);
  if (replaceDrafts) {
    clearProfileEditorDirty();
    keyboardShortcutEditorDirty = false;
    keyboardShortcutEditorRevision += 1;
    analysisModeEditorDirty = false;
  }
  const hasTaskPolicyDrafts = taskPolicyDrafts.size > 0;
  state = nextState;
  const entries = profileEntries();
  if (!profileById(selectedProfileId)) {
    if (selectedProfileId && settingsDraftIsDirty('profile')) {
      showStatus(MISSING_PROFILE_DRAFT_MESSAGE, 'error');
    } else {
      selectedProfileId = state.settings?.globalProfileId || entries[0]?.[0] || '';
    }
  }
  if (!settingsDraftIsDirty('reading')) {
    document.getElementById('analysisMode').value = state.settings?.mode || 'regex';
    document.getElementById('autoAnalyze').checked = state.settings?.autoAnalyze === true;
    document.getElementById('consentGranted').checked = state.settings?.consentGranted === true;
  }
  const language = state.settings?.language || 'zh-CN';
  if (typeof renderTtsSettings === 'function') renderTtsSettings(state.settings?.tts);
  if (!literatureUrlDirty && document.getElementById('literatureUrlWhitelist')) {
    document.getElementById('literatureUrlWhitelist').value = (state.settings?.literatureUrlWhitelist || []).join('\n');
  }
  document.getElementById('globalLanguage').value = language;
  SciLLM.setInterfaceLanguage(language);
  if (!settingsDraftIsDirty('storage')) {
    document.getElementById('autoCacheFigureImages').checked =
      state.settings?.autoCacheFigureImages !== false;
    document.getElementById('saveArticleWebSnapshot').checked =
      state.settings?.saveArticleWebSnapshot !== false;
  }
  if (!settingsDraftIsDirty('panelFollowupPresetList')) {
    renderPanelFollowupPresets(state.settings?.figurePanelFollowupPresets || []);
  }
  if (!settingsDraftIsDirty('articleChatQuickPromptList')) {
    renderArticleChatQuickPrompts(state.settings?.articleChatQuickPrompts || []);
  }
  if (!settingsDraftIsDirty('literatureNoteTemplateList')) {
    renderLiteratureNoteTemplates(state.settings?.literatureNoteTemplates || []);
  }
  if (!settingsDraftIsDirty('selectionLlmActionList')) {
    renderSelectionLlmActions(state.settings?.selectionLlmActions || []);
  }
  if (!analysisModeEditorDirty) {
    analysisModeEditorModes = structuredClone(state.settings?.analysisModes || []);
    selectedAnalysisModeId = analysisModeEditorModes.some(
      mode => mode.id === selectedAnalysisModeId
    ) ? selectedAnalysisModeId : (
      state.settings?.readingViewId || analysisModeEditorModes[0]?.id || ''
    );
  }
  renderAnalysisModeEditor();
  if (!keyboardShortcutEditorDirty) {
    renderKeyboardShortcutSettings(state.settings?.keyboardShortcuts);
  }
  const highlightModeLabel = state.effectiveMode === 'llm'
    ? '高亮：LLM' : '高亮：正则';
  document.getElementById('effectiveMode').textContent = state.llmReady === true
    ? `${highlightModeLabel} · LLM 已配置`
    : `${highlightModeLabel} · LLM 功能未就绪`;
  if (replaceTaskPolicyDrafts || !hasTaskPolicyDrafts) syncTaskPolicyDraftsFromState();
  if (!settingsDraftIsDirty('routing') || replaceTaskPolicyDrafts) {
    document.getElementById('globalProfileId').value = state.settings?.globalProfileId || '';
  }
  if (!settingsDraftIsDirty('profile')) renderProfileEditor();
  else {
    renderProfileList();
    updateProfileListPreview();
  }
  renderTaskPolicyTable();
  renderCustomCategories();
  renderDeletedBuiltInCategories();
  renderCategoryList();
  renderSettingsOverview();
  if (typeof renderProviderWorkflow === 'function') renderProviderWorkflow();
}

function renderKeyboardShortcutSettings(shortcuts) {
  const container = document.getElementById('keyboardShortcutGrid');
  if (!container || !globalThis.SciLLM?.KEYBOARD_SHORTCUT_DEFINITIONS) return;
  const normalized = SciLLM.normalizeKeyboardShortcuts(shortcuts);
  container.replaceChildren();
  let currentGroup = '';
  SciLLM.KEYBOARD_SHORTCUT_DEFINITIONS.forEach(definition => {
    if (definition.group !== currentGroup) {
      currentGroup = definition.group;
      const heading = document.createElement('h3');
      heading.className = 'keyboard-shortcut-group-heading';
      heading.textContent = currentGroup;
      container.appendChild(heading);
    }
    const row = document.createElement('label');
    row.className = 'keyboard-shortcut-row';
    const copy = document.createElement('span');
    copy.className = 'keyboard-shortcut-label';
    copy.textContent = definition.label;
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'none';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = 1;
    input.dataset.shortcutAction = definition.actionId;
    input.setAttribute('aria-label', `${definition.label}快捷键`);
    input.value = normalized[definition.actionId] || '';
    input.placeholder = '停用';
    row.append(copy, input);
    container.appendChild(row);
  });
}

function keyboardShortcutStatus(message, type = 'info') {
  const status = document.getElementById('keyboardShortcutStatus');
  if (!status) return;
  status.textContent = message;
  status.className = `status show ${type}`;
}

function handleKeyboardShortcutInputKeydown(event) {
  const input = event.target.closest?.('[data-shortcut-action]');
  if (!input) return;
  if (event.isComposing || event.key === 'Process') return;
  if (event.key === 'Tab') return;
  if (event.key === 'Escape') {
    event.preventDefault();
    input.blur();
    return;
  }
  event.preventDefault();
  if (event.key === 'Backspace' || event.key === 'Delete') {
    input.value = '';
  } else {
    const key = SciLLM.normalizeKeyboardShortcutKey(event.key, '');
    if (!key) {
      keyboardShortcutStatus('只支持单个英文字母或数字。', 'error');
      return;
    }
    input.value = key;
  }
  keyboardShortcutEditorDirty = true;
  keyboardShortcutEditorRevision += 1;
  keyboardShortcutStatus('快捷键已修改，尚未保存。', 'info');
}

function handleKeyboardShortcutInput(event) {
  const input = event.target.closest?.('[data-shortcut-action]');
  if (!input) return;
  input.value = SciLLM.normalizeKeyboardShortcutKey(input.value, '');
  keyboardShortcutEditorDirty = true;
  keyboardShortcutEditorRevision += 1;
  keyboardShortcutStatus('快捷键已修改，尚未保存。', 'info');
}

function collectKeyboardShortcutSettings() {
  const shortcuts = {};
  document.querySelectorAll('[data-shortcut-action]').forEach(input => {
    shortcuts[input.dataset.shortcutAction] =
      SciLLM.normalizeKeyboardShortcutKey(input.value, '');
  });
  const conflicts = SciLLM.findKeyboardShortcutConflicts(shortcuts);
  if (conflicts.length) {
    const labels = Object.fromEntries(
      SciLLM.KEYBOARD_SHORTCUT_DEFINITIONS.map(item => [item.actionId, item.label])
    );
    const conflict = conflicts[0];
    throw new Error(
      `快捷键 ${conflict.key} 同时分配给：` +
      conflict.actionIds.map(actionId => labels[actionId] || actionId).join('、')
    );
  }
  return shortcuts;
}

async function saveKeyboardShortcuts() {
  const button = document.getElementById('saveKeyboardShortcuts');
  const revision = keyboardShortcutEditorRevision;
  try {
    const keyboardShortcuts = collectKeyboardShortcutSettings();
    button.disabled = true;
    const updated = await callBackground({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: { keyboardShortcuts }
    });
    if (revision === keyboardShortcutEditorRevision) keyboardShortcutEditorDirty = false;
    applyState(updated);
    keyboardShortcutStatus(keyboardShortcutEditorDirty
      ? '已保存提交的快捷键；当前仍有未保存修改。'
      : '快捷键已保存，侧栏立即按新设置响应。',
    keyboardShortcutEditorDirty ? 'info' : 'success');
  } catch (error) {
    keyboardShortcutStatus(`保存失败：${friendlyError(error)}`, 'error');
  } finally {
    button.disabled = false;
  }
}

function resetKeyboardShortcuts() {
  renderKeyboardShortcutSettings(SciLLM.DEFAULT_KEYBOARD_SHORTCUTS);
  keyboardShortcutEditorDirty = true;
  keyboardShortcutEditorRevision += 1;
  keyboardShortcutStatus('已填入默认快捷键，点击“保存快捷键”后生效。', 'info');
}

function createPanelFollowupPresetRow(preset = {}) {
  const row = document.createElement('div');
  row.className = 'named-prompt-row';
  row.dataset.panelPresetId = String(preset.id || `panel_prompt_${Date.now().toString(36)}`);
  row.dataset.panelPresetTopic = String(preset.topic || '');

  const nameField = document.createElement('label');
  nameField.className = 'field';
  const nameLabel = document.createElement('span');
  nameLabel.textContent = '名称';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 80;
  nameInput.dataset.panelPresetName = '';
  nameInput.placeholder = '例如：统计方法';
  nameInput.value = String(preset.name || '');
  nameField.append(nameLabel, nameInput);

  const promptField = document.createElement('label');
  promptField.className = 'field';
  const promptLabel = document.createElement('span');
  promptLabel.textContent = '提示词';
  const textarea = document.createElement('textarea');
  textarea.rows = 3;
  textarea.maxLength = 4000;
  textarea.dataset.panelPresetPrompt = '';
  textarea.placeholder = '说明模型需要围绕这个 Panel 回答什么';
  textarea.value = String(preset.prompt || '');
  promptField.append(promptLabel, textarea);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'button danger quiet compact-button named-prompt-delete';
  remove.dataset.deletePanelPreset = '';
  remove.textContent = '删除';
  row.append(nameField, promptField, remove);
  return row;
}

function renderPanelFollowupPresetEmptyState() {
  const list = document.getElementById('panelFollowupPresetList');
  if (!list || list.querySelector('.named-prompt-row')) return;
  const empty = document.createElement('p');
  empty.className = 'named-prompt-empty';
  empty.textContent = '尚未设置 Panel 追问；可新增任意名称和提示词。';
  list.replaceChildren(empty);
}

function renderPanelFollowupPresets(presets) {
  const list = document.getElementById('panelFollowupPresetList');
  if (!list) return;
  list.replaceChildren();
  (Array.isArray(presets) ? presets : []).forEach(preset => {
    list.appendChild(createPanelFollowupPresetRow(preset));
  });
  renderPanelFollowupPresetEmptyState();
}

function addPanelFollowupPreset() {
  const list = document.getElementById('panelFollowupPresetList');
  if (!list) return;
  list.querySelector('.named-prompt-empty')?.remove();
  const row = createPanelFollowupPresetRow({
    id: `panel_prompt_${Date.now().toString(36)}`,
    name: '',
    prompt: ''
  });
  list.appendChild(row);
  row.querySelector('[data-panel-preset-name]')?.focus();
  markProfileEditorDirty('panelFollowupPresetList');
}

function collectPanelFollowupPresets() {
  return [...document.querySelectorAll('#panelFollowupPresetList .named-prompt-row')]
    .map((row, index) => ({
      id: String(row.dataset.panelPresetId || `panel_prompt_${index + 1}`),
      topic: String(row.dataset.panelPresetTopic || ''),
      name: row.querySelector('[data-panel-preset-name]')?.value.trim() || '',
      prompt: row.querySelector('[data-panel-preset-prompt]')?.value.trim() || ''
    }))
    .filter(item => item.name && item.prompt);
}

function panelFollowupPromptMap(presets) {
  const prompts = { ...(state?.panelFollowupDefaults || {}) };
  presets.forEach(preset => {
    if (preset.topic && Object.prototype.hasOwnProperty.call(prompts, preset.topic)) {
      prompts[preset.topic] = preset.prompt;
    }
  });
  return prompts;
}

function createArticleChatQuickPromptRow(prompt = {}) {
  const row = document.createElement('div');
  row.className = 'named-prompt-row';
  row.dataset.quickPromptId = String(prompt.id || `prompt_${Date.now().toString(36)}`);

  const nameField = document.createElement('label');
  nameField.className = 'field';
  const nameLabel = document.createElement('span');
  nameLabel.textContent = '名称';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 80;
  nameInput.dataset.quickPromptName = '';
  nameInput.placeholder = '例如：核心结论';
  nameInput.value = String(prompt.name || '');
  nameField.append(nameLabel, nameInput);

  const promptField = document.createElement('label');
  promptField.className = 'field';
  const promptLabel = document.createElement('span');
  promptLabel.textContent = '提示词';
  const textarea = document.createElement('textarea');
  textarea.rows = 3;
  textarea.maxLength = 4000;
  textarea.dataset.quickPromptText = '';
  textarea.placeholder = '插入输入框后仍可继续编辑';
  textarea.value = String(prompt.prompt || '');
  promptField.append(promptLabel, textarea);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'button danger quiet compact-button named-prompt-delete';
  remove.dataset.deleteQuickPrompt = '';
  remove.textContent = '删除';
  remove.setAttribute('aria-label', `删除快捷提示词${prompt.name ? `：${prompt.name}` : ''}`);

  row.append(nameField, promptField, remove);
  return row;
}

function renderArticleChatQuickPromptEmptyState() {
  const list = document.getElementById('articleChatQuickPromptList');
  if (!list || list.querySelector('.named-prompt-row')) return;
  const empty = document.createElement('p');
  empty.className = 'named-prompt-empty';
  empty.textContent = '尚未设置快捷提示词；可点击“新增提示词”创建。';
  list.replaceChildren(empty);
}

function renderArticleChatQuickPrompts(prompts) {
  const list = document.getElementById('articleChatQuickPromptList');
  if (!list) return;
  list.replaceChildren();
  (Array.isArray(prompts) ? prompts : []).forEach(prompt => {
    list.appendChild(createArticleChatQuickPromptRow(prompt));
  });
  renderArticleChatQuickPromptEmptyState();
}

function addArticleChatQuickPrompt() {
  const list = document.getElementById('articleChatQuickPromptList');
  if (!list) return;
  list.querySelector('.named-prompt-empty')?.remove();
  const row = createArticleChatQuickPromptRow({
    id: `prompt_${Date.now().toString(36)}`,
    name: '',
    prompt: ''
  });
  list.appendChild(row);
  row.querySelector('[data-quick-prompt-name]')?.focus();
  markProfileEditorDirty('articleChatQuickPromptList');
}

function collectArticleChatQuickPrompts() {
  return [...document.querySelectorAll('#articleChatQuickPromptList .named-prompt-row')]
    .map((row, index) => ({
      id: String(row.dataset.quickPromptId || `prompt_${index + 1}`),
      name: row.querySelector('[data-quick-prompt-name]')?.value.trim() || '',
      prompt: row.querySelector('[data-quick-prompt-text]')?.value.trim() || ''
    }))
    .filter(item => item.name && item.prompt);
}

function nextLiteratureNoteFieldId(templateRow, requested = '') {
  const used = new Set([...templateRow.querySelectorAll('[data-literature-note-field-row]')]
    .map(row => String(row.dataset.literatureFieldId || '')));
  const preferred = String(requested || '').trim();
  if (preferred && !used.has(preferred)) return preferred;
  const base = `field_${Date.now().toString(36)}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}_${suffix++}`;
  return candidate;
}

function taskPolicyIdFromHash() {
  const parameters = new URLSearchParams(location.hash.replace(/^#/, ''));
  const taskId = String(parameters.get('task') || '');
  return globalThis.SciLLM?.LLM_TASK_IDS?.includes(taskId) ? taskId : '';
}

function focusTaskPolicyFromHash({ behavior = 'auto' } = {}) {
  const taskId = taskPolicyIdFromHash();
  if (!taskId) return false;
  activateSettingsPage('models', { updateHash: false, animate: false });
  const row = document.querySelector(`[data-task-policy-id="${taskId}"]`);
  if (!row) return false;
  let disclosure = row.parentNode;
  while (disclosure) {
    if (disclosure.tagName === 'DETAILS') disclosure.open = true;
    disclosure = disclosure.parentNode;
  }
  const advanced = row.closest('#advancedTaskRouting');
  if (advanced) advanced.open = true;
  row.scrollIntoView({ behavior, block: 'center' });
  row.querySelector(`[data-task-policy-profile="${taskId}"]`)
    ?.focus({ preventScroll: true });
  return true;
}

function duplicateCategoryPayload(categoryId, category, draft) {
  const existingIds = new Set(unifiedCategoryEntries().map(item => item.categoryId));
  const baseId = `custom_copy_${Date.now().toString(36)}`;
  let duplicateId = baseId;
  let suffix = 2;
  while (existingIds.has(duplicateId)) duplicateId = `${baseId}_${suffix++}`;
  return {
    categoryId: duplicateId,
    name: `${draft.name || category.name || categoryId} 副本`,
    color: draft.color || category.color,
    enabledEngines: [...(draft.enabledEngines || category.enabledEngines || [])],
    definition: draft.prompt.definition,
    decisionQuestion: draft.prompt.decisionQuestion,
    includeWhen: [...draft.prompt.includeWhen],
    excludeWhen: [...draft.prompt.excludeWhen],
    positiveExamples: [...draft.prompt.positiveExamples],
    negativeExamples: [...draft.prompt.negativeExamples],
    requiredSlots: [...draft.prompt.requiredSlots],
    allowedQuoteRoles: [...draft.prompt.allowedQuoteRoles],
    spanPolicy: draft.prompt.spanPolicy,
    minimumConfidence: draft.prompt.minimumConfidence,
    claimMode: draft.claimMode,
    relationRequired: draft.relationRequired,
    regex: structuredClone(draft.regex),
    persistence: 'saved',
    version: 1
  };
}

async function duplicateSelectedCategory() {
  if (!categoryEditor.categoryId || !categoryEditor.detail || categoryEditor.pending) return;
  const sourceId = categoryEditor.categoryId;
  const payload = duplicateCategoryPayload(
    sourceId,
    categoryEditor.detail.category,
    collectCategoryOverride()
  );
  setCategoryPending(true);
  setCategoryStatus('working', '正在复制完整类别规则…');
  try {
    applyState(await callBackground({
      type: 'LLM_SAVE_CUSTOM_CATEGORY',
      category: payload
    }));
    categoryEditor.dirty = false;
    setCategoryPending(false);
    await loadCategory(payload.categoryId);
    showStatus('已复制为自定义类别；提示词、语义约束与正则规则均已保留。', 'success');
  } catch (error) {
    setCategoryStatus('failed', `复制失败：${friendlyError(error)}`);
    showStatus(`复制类别失败：${friendlyError(error)}`, 'error');
  } finally {
    setCategoryPending(false);
  }
}

function createLiteratureNoteFieldRow(field = {}, templateRow) {
  const row = document.createElement('div');
  row.className = 'literature-note-field-row';
  row.dataset.literatureNoteFieldRow = '';
  row.dataset.literatureFieldId = nextLiteratureNoteFieldId(templateRow, field.id);

  const main = document.createElement('div');
  main.className = 'literature-note-field-main';
  const nameField = document.createElement('label');
  nameField.className = 'field';
  const nameLabel = document.createElement('span');
  nameLabel.textContent = '字段名称';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 100;
  nameInput.dataset.literatureFieldLabel = '';
  nameInput.value = String(field.label || '');
  nameField.append(nameLabel, nameInput);

  const promptField = document.createElement('label');
  promptField.className = 'field literature-note-field-prompt';
  const promptLabel = document.createElement('span');
  promptLabel.textContent = 'AI 提示词';
  const promptInput = document.createElement('textarea');
  promptInput.rows = 3;
  promptInput.maxLength = 4000;
  promptInput.dataset.literatureFieldPrompt = '';
  promptInput.placeholder = '说明 AI 应从文章中提取什么、如何组织；没有证据时留空。';
  promptInput.value = String(field.prompt || '');
  promptField.append(promptLabel, promptInput);
  main.append(nameField, promptField);

  const advanced = document.createElement('details');
  advanced.className = 'literature-note-field-advanced';
  const summary = document.createElement('summary');
  summary.textContent = '显示与输入选项';
  const advancedGrid = document.createElement('div');
  advancedGrid.className = 'literature-note-field-advanced-grid';
  const placeholderField = document.createElement('label');
  placeholderField.className = 'field';
  const placeholderLabel = document.createElement('span');
  placeholderLabel.textContent = '占位提示';
  const placeholderInput = document.createElement('input');
  placeholderInput.type = 'text';
  placeholderInput.maxLength = 240;
  placeholderInput.dataset.literatureFieldPlaceholder = '';
  placeholderInput.value = String(field.placeholder || '');
  placeholderField.append(placeholderLabel, placeholderInput);

  const flags = document.createElement('div');
  flags.className = 'literature-note-field-flags';
  const multilineLabel = document.createElement('label');
  const multilineInput = document.createElement('input');
  multilineInput.type = 'checkbox';
  multilineInput.dataset.literatureFieldMultiline = '';
  multilineInput.checked = field.multiline !== false;
  multilineLabel.append(multilineInput, document.createTextNode(' 多行输入'));
  const requiredLabel = document.createElement('label');
  const requiredInput = document.createElement('input');
  requiredInput.type = 'checkbox';
  requiredInput.dataset.literatureFieldRequired = '';
  requiredInput.checked = field.required === true;
  requiredLabel.append(requiredInput, document.createTextNode(' 必填字段'));
  flags.append(multilineLabel, requiredLabel);
  advancedGrid.append(placeholderField, flags);
  advanced.append(summary, advancedGrid);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'button danger quiet compact-button literature-note-field-delete';
  remove.dataset.deleteLiteratureField = '';
  remove.textContent = '删除字段';
  row.append(main, advanced, remove);
  return row;
}

function createLiteratureNoteTemplateRow(template = {}) {
  const row = document.createElement('div');
  row.className = 'named-prompt-row literature-note-template-row';
  row.dataset.literatureTemplateId = String(
    template.id || `template_${Date.now().toString(36)}`
  );
  row.dataset.literatureStudyFamily = String(template.studyFamily || 'custom');

  const header = document.createElement('div');
  header.className = 'literature-note-template-header';
  const nameField = document.createElement('label');
  nameField.className = 'field';
  const nameLabel = document.createElement('span');
  nameLabel.textContent = '模板名称';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 100;
  nameInput.dataset.literatureTemplateName = '';
  nameInput.value = String(template.name || '');
  nameField.append(nameLabel, nameInput);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'button danger quiet compact-button named-prompt-delete';
  remove.dataset.deleteLiteratureTemplate = '';
  remove.textContent = '删除模板';
  header.append(nameField, remove);

  const editor = document.createElement('div');
  editor.className = 'literature-note-fields-editor';
  const editorHeading = document.createElement('div');
  editorHeading.className = 'literature-note-fields-heading';
  const editorCopy = document.createElement('div');
  const editorTitle = document.createElement('strong');
  editorTitle.textContent = '模板字段';
  const editorHint = document.createElement('p');
  editorHint.textContent = '字段名称用于笔记展示；AI 提示词说明仅应从文章证据中提取哪些内容。';
  editorCopy.append(editorTitle, editorHint);
  const addField = document.createElement('button');
  addField.type = 'button';
  addField.className = 'button secondary compact-button';
  addField.dataset.addLiteratureField = '';
  addField.textContent = '新增字段';
  editorHeading.append(editorCopy, addField);
  const fieldList = document.createElement('div');
  fieldList.className = 'literature-note-field-list';
  const fields = Array.isArray(template.fields) && template.fields.length
    ? template.fields : [{ label: '新字段', prompt: '' }];
  fields.forEach(field => fieldList.appendChild(createLiteratureNoteFieldRow(field, row)));
  editor.append(editorHeading, fieldList);
  row.append(header, editor);
  return row;
}

function updateLiteratureNoteDeleteStates() {
  const templates = [...document.querySelectorAll(
    '#literatureNoteTemplateList .literature-note-template-row'
  )];
  templates.forEach(templateRow => {
    const templateDelete = templateRow.querySelector('[data-delete-literature-template]');
    if (templateDelete) {
      templateDelete.disabled = templates.length <= 1;
      templateDelete.title = templateDelete.disabled ? '至少保留一个文献笔记模板' : '';
    }
    const fields = [...templateRow.querySelectorAll('[data-literature-note-field-row]')];
    fields.forEach(fieldRow => {
      const fieldDelete = fieldRow.querySelector('[data-delete-literature-field]');
      if (!fieldDelete) return;
      fieldDelete.disabled = fields.length <= 1;
      fieldDelete.title = fieldDelete.disabled ? '每个模板至少保留一个字段' : '';
    });
  });
}

function setLiteratureNoteTemplateEditState(message, stateName) {
  const target = document.getElementById('literatureNoteTemplateEditState');
  if (!target) return;
  target.textContent = interfaceText(message);
  target.dataset.state = stateName;
}

function activateLiteratureNoteTemplate(templateId, { focus = false } = {}) {
  const list = document.getElementById('literatureNoteTemplateList');
  const rows = [...(list?.querySelectorAll('.literature-note-template-row') || [])];
  const target = rows.find(row => row.dataset.literatureTemplateId === templateId) || rows[0];
  const selectedId = target?.dataset.literatureTemplateId || '';
  rows.forEach(row => {
    const active = row === target;
    row.hidden = !active;
    row.setAttribute('aria-hidden', String(!active));
  });
  document.querySelectorAll('[data-literature-template-target]').forEach(button => {
    button.setAttribute('aria-selected', String(
      button.dataset.literatureTemplateTarget === selectedId
    ));
  });
  const selector = document.getElementById('literatureNoteTemplateSelector');
  if (selector) selector.value = selectedId;
  if (focus && target) {
    target.querySelector('[data-literature-template-name]')?.focus();
  }
  return selectedId;
}

function syncLiteratureNoteTemplateNavigation(preferredId = '') {
  const list = document.getElementById('literatureNoteTemplateList');
  const nav = document.getElementById('literatureNoteTemplateNav');
  const selector = document.getElementById('literatureNoteTemplateSelector');
  if (!list || !nav || !selector) return '';
  const previousId = preferredId || selector.value;
  const rows = [...list.querySelectorAll('.literature-note-template-row')];
  nav.replaceChildren();
  selector.replaceChildren();
  rows.forEach(row => {
    const id = row.dataset.literatureTemplateId;
    const name = row.querySelector('[data-literature-template-name]')?.value.trim() || '未命名模板';
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.literatureTemplateTarget = id;
    button.textContent = name;
    nav.appendChild(button);
    const option = document.createElement('option');
    option.value = id;
    option.textContent = name;
    selector.appendChild(option);
  });
  return activateLiteratureNoteTemplate(previousId || rows[0]?.dataset.literatureTemplateId || '');
}

function renderLiteratureNoteTemplateEmptyState() {
  const list = document.getElementById('literatureNoteTemplateList');
  if (!list || list.querySelector('.named-prompt-row')) return;
  const empty = document.createElement('p');
  empty.className = 'named-prompt-empty';
  empty.textContent = '尚未设置文献笔记模板；可新增自定义模板。';
  list.replaceChildren(empty);
}

function renderLiteratureNoteTemplates(templates) {
  const list = document.getElementById('literatureNoteTemplateList');
  if (!list) return;
  const description = document.getElementById('literatureNoteTemplateDescription');
  if (description) {
    description.textContent = interfaceText(
      '为基础研究、临床研究、综述、病例、方法学和指南配置不同模板。每个字段都可设置名称和 AI 提示词，无需填写内部 ID。'
    );
  }
  list.replaceChildren();
  (Array.isArray(templates) ? templates : []).forEach(template => {
    list.appendChild(createLiteratureNoteTemplateRow(template));
  });
  renderLiteratureNoteTemplateEmptyState();
  updateLiteratureNoteDeleteStates();
  syncLiteratureNoteTemplateNavigation();
}

function addLiteratureNoteTemplate() {
  const list = document.getElementById('literatureNoteTemplateList');
  if (!list) return;
  list.querySelector('.named-prompt-empty')?.remove();
  const row = createLiteratureNoteTemplateRow({
    id: `template_${Date.now().toString(36)}`,
    name: '自定义文献', studyFamily: 'custom',
    fields: [{ id: 'key_point', label: '关键内容' }]
  });
  list.appendChild(row);
  syncLiteratureNoteTemplateNavigation(row.dataset.literatureTemplateId);
  row.querySelector('[data-literature-template-name]')?.focus();
  updateLiteratureNoteDeleteStates();
  setLiteratureNoteTemplateEditState('有未保存修改', 'unsaved');
  markProfileEditorDirty('literatureNoteTemplateList');
}

function addLiteratureNoteField(templateRow) {
  const list = templateRow?.querySelector('.literature-note-field-list');
  if (!list) return;
  const row = createLiteratureNoteFieldRow({ label: '新字段', prompt: '' }, templateRow);
  list.appendChild(row);
  row.querySelector('[data-literature-field-label]')?.focus();
  updateLiteratureNoteDeleteStates();
  setLiteratureNoteTemplateEditState('有未保存修改', 'unsaved');
  markProfileEditorDirty('literatureNoteTemplateList');
}

function collectLiteratureNoteTemplates() {
  return [...document.querySelectorAll(
    '#literatureNoteTemplateList .literature-note-template-row'
  )]
    .map((row, index) => {
      const fields = [...row.querySelectorAll('[data-literature-note-field-row]')]
        .map((fieldRow, fieldIndex) => ({
          id: String(fieldRow.dataset.literatureFieldId || `field_${fieldIndex + 1}`),
          label: fieldRow.querySelector('[data-literature-field-label]')?.value.trim() || '',
          prompt: fieldRow.querySelector('[data-literature-field-prompt]')?.value.trim() || '',
          placeholder: fieldRow.querySelector(
            '[data-literature-field-placeholder]'
          )?.value.trim() || '',
          multiline: fieldRow.querySelector(
            '[data-literature-field-multiline]'
          )?.checked !== false,
          required: fieldRow.querySelector('[data-literature-field-required]')?.checked === true
        })).filter(field => field.label);
      return {
        id: String(row.dataset.literatureTemplateId || `template_${index + 1}`),
        name: row.querySelector('[data-literature-template-name]')?.value.trim() || '',
        studyFamily: String(row.dataset.literatureStudyFamily || 'custom'),
        fields
      };
    }).filter(item => item.name && item.fields.length);
}

function createSelectionLlmActionRow(action = {}) {
  const row = document.createElement('div');
  row.className = 'named-prompt-row';
  row.dataset.selectionActionId = String(
    action.id || `action_${Date.now().toString(36)}`
  );
  const nameField = document.createElement('label');
  nameField.className = 'field';
  const nameLabel = document.createElement('span');
  nameLabel.textContent = '按钮名称';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 60;
  nameInput.dataset.selectionActionName = '';
  nameInput.value = String(action.name || '');
  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'check-field compact';
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.dataset.selectionActionEnabled = '';
  enabled.checked = action.enabled !== false;
  const enabledText = document.createElement('span');
  enabledText.textContent = '在选区工具条显示';
  enabledLabel.append(enabled, enabledText);
  nameField.append(nameLabel, nameInput, enabledLabel);
  const promptField = document.createElement('label');
  promptField.className = 'field';
  const promptLabel = document.createElement('span');
  promptLabel.textContent = '发送到全文问答的提示词';
  const promptInput = document.createElement('textarea');
  promptInput.rows = 3;
  promptInput.maxLength = 3000;
  promptInput.dataset.selectionActionPrompt = '';
  promptInput.value = String(action.prompt || '');
  promptField.append(promptLabel, promptInput);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'button danger quiet compact-button named-prompt-delete';
  remove.dataset.deleteSelectionAction = '';
  remove.textContent = '删除';
  row.append(nameField, promptField, remove);
  return row;
}

function renderSelectionLlmActionEmptyState() {
  const list = document.getElementById('selectionLlmActionList');
  if (!list || list.querySelector('.named-prompt-row')) return;
  const empty = document.createElement('p');
  empty.className = 'named-prompt-empty';
  empty.textContent = '尚未设置选中文段后的分析动作。';
  list.replaceChildren(empty);
}

function renderSelectionLlmActions(actions) {
  const list = document.getElementById('selectionLlmActionList');
  if (!list) return;
  list.replaceChildren();
  (Array.isArray(actions) ? actions : []).forEach(action => {
    list.appendChild(createSelectionLlmActionRow(action));
  });
  renderSelectionLlmActionEmptyState();
}

function addSelectionLlmAction() {
  const list = document.getElementById('selectionLlmActionList');
  if (!list) return;
  list.querySelector('.named-prompt-empty')?.remove();
  const row = createSelectionLlmActionRow({
    id: `action_${Date.now().toString(36)}`,
    name: '分析', prompt: '请分析所选文段，并说明结论边界。', enabled: true
  });
  list.appendChild(row);
  row.querySelector('[data-selection-action-name]')?.focus();
  markProfileEditorDirty('selectionLlmActionList');
}

function collectSelectionLlmActions() {
  return [...document.querySelectorAll('#selectionLlmActionList .named-prompt-row')]
    .map((row, index) => ({
      id: String(row.dataset.selectionActionId || `action_${index + 1}`),
      name: row.querySelector('[data-selection-action-name]')?.value.trim() || '',
      prompt: row.querySelector('[data-selection-action-prompt]')?.value.trim() || '',
      enabled: row.querySelector('[data-selection-action-enabled]')?.checked !== false
    })).filter(item => item.name && item.prompt);
}

function currentAnalysisModeDraft() {
  return analysisModeEditorModes.find(mode => mode.id === selectedAnalysisModeId) || null;
}

function analysisModeDefaults() {
  return Array.isArray(state?.analysisModeDefaults) ? state.analysisModeDefaults : [];
}

function defaultAnalysisMode(modeId) {
  return analysisModeDefaults().find(mode => mode.id === modeId) || null;
}

function isBuiltInAnalysisMode(modeId) {
  return Boolean(defaultAnalysisMode(modeId));
}

function showAnalysisModeStatus(message, type = 'info') {
  const target = document.getElementById('analysisModeStatus');
  if (!target) return;
  target.textContent = message;
  target.className = `status show ${type}`;
}

function syncAnalysisModeDraftFromEditor() {
  const mode = currentAnalysisModeDraft();
  if (!mode) return;
  mode.name = document.getElementById('analysisModeName')?.value.trim() || mode.name;
  mode.description =
    document.getElementById('analysisModeDescription')?.value.trim() || '';
  mode.categoryIds = [...document.querySelectorAll(
    '#analysisModeCategoryList input[type="checkbox"]:checked'
  )].map(input => input.value);
}

function renderAnalysisModeList() {
  const list = document.getElementById('analysisModeList');
  if (!list) return;
  list.replaceChildren();
  analysisModeEditorModes.forEach(mode => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'analysis-mode-list-item';
    button.dataset.analysisModeId = mode.id;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(mode.id === selectedAnalysisModeId));
    const name = document.createElement('strong');
    name.textContent = mode.name || '未命名场景';
    const count = document.createElement('small');
    count.textContent = `${isBuiltInAnalysisMode(mode.id) ? '内置' : '自定义'} · ` +
      `${mode.categoryIds?.length || 0} 个类别 · ${mode.id}`;
    button.append(name, count);
    list.appendChild(button);
  });
}

function handleAnalysisModeListKeydown(event) {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const buttons = [...event.currentTarget.querySelectorAll('[data-analysis-mode-id]')];
  if (!buttons.length) return;
  event.preventDefault();
  const currentIndex = Math.max(0, buttons.indexOf(document.activeElement));
  const nextIndex = event.key === 'Home' ? 0
    : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowUp'
        ? (currentIndex - 1 + buttons.length) % buttons.length
        : (currentIndex + 1) % buttons.length;
  buttons[nextIndex].focus();
  buttons[nextIndex].click();
}

function renderDeletedBuiltInAnalysisModes() {
  const section = document.getElementById('deletedBuiltInAnalysisModeSection');
  const list = document.getElementById('deletedBuiltInAnalysisModeList');
  if (!section || !list) return;
  const activeIds = new Set(analysisModeEditorModes.map(mode => mode.id));
  const deleted = analysisModeDefaults().filter(mode => !activeIds.has(mode.id));
  section.hidden = deleted.length === 0;
  list.replaceChildren();
  deleted.forEach(mode => {
    const row = document.createElement('div');
    row.className = 'deleted-built-in-row';
    const copy = document.createElement('span');
    copy.className = 'deleted-built-in-copy';
    const name = document.createElement('strong');
    name.textContent = mode.name || mode.id;
    const id = document.createElement('span');
    id.textContent = mode.id;
    copy.append(name, id);
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'category-restore';
    restore.textContent = '恢复';
    restore.addEventListener('click', () => restoreAnalysisModeById(mode.id));
    row.append(copy, restore);
    list.appendChild(row);
  });
}

function updateAnalysisModeCategoryCount() {
  const target = document.getElementById('analysisModeCategoryCount');
  if (!target) return;
  target.textContent = String(document.querySelectorAll(
    '#analysisModeCategoryList input[type="checkbox"]:checked'
  ).length);
}

function renderAnalysisModeCategoryList(mode) {
  const list = document.getElementById('analysisModeCategoryList');
  if (!list) return;
  const selected = new Set(Array.isArray(mode?.categoryIds) ? mode.categoryIds : []);
  list.replaceChildren();
  (state?.availableCategories || [])
    .filter(category => category?.categoryId && category.retired !== true)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'))
    .forEach(category => {
      const label = document.createElement('label');
      label.className = 'analysis-mode-category-option';
      label.title = `${category.name || category.categoryId} · ${category.categoryId}`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = category.categoryId;
      checkbox.checked = selected.has(category.categoryId);
      const marker = document.createElement('span');
      marker.className = 'category-marker';
      marker.style.setProperty('--category-color', category.color || '#0B4778');
      const name = document.createElement('span');
      name.textContent = category.name || category.categoryId;
      label.append(checkbox, marker, name);
      list.appendChild(label);
    });
  updateAnalysisModeCategoryCount();
}

function renderAnalysisModeEditor() {
  renderAnalysisModeList();
  renderDeletedBuiltInAnalysisModes();
  const mode = currentAnalysisModeDraft();
  const name = document.getElementById('analysisModeName');
  const id = document.getElementById('analysisModeId');
  const description = document.getElementById('analysisModeDescription');
  if (!name || !id || !description) return;
  name.value = mode?.name || '';
  id.value = mode?.id || '';
  description.value = mode?.description || '';
  [name, description].forEach(input => { input.disabled = !mode; });
  const builtIn = Boolean(mode && isBuiltInAnalysisMode(mode.id));
  const badge = document.getElementById('analysisModeKindBadge');
  badge.textContent = builtIn ? '内置场景 · 可编辑' : '自定义场景';
  badge.classList.toggle('is-overridden', builtIn);
  document.getElementById('duplicateAnalysisMode').disabled = !mode;
  const restore = document.getElementById('restoreAnalysisMode');
  restore.hidden = !builtIn;
  restore.disabled = !mode;
  document.getElementById('deleteAnalysisMode').disabled =
    !mode || analysisModeEditorModes.length <= 1;
  document.getElementById('saveAnalysisModes').disabled = !mode;
  renderAnalysisModeCategoryList(mode);
}

function addAnalysisMode() {
  syncAnalysisModeDraftFromEditor();
  let id = `mode_${Date.now().toString(36)}`;
  let suffix = 2;
  const base = id;
  while (analysisModeEditorModes.some(mode => mode.id === id)) id = `${base}_${suffix++}`;
  analysisModeEditorModes.push({
    id,
    name: '新阅读场景',
    description: '',
    categoryIds: []
  });
  selectedAnalysisModeId = id;
  analysisModeEditorDirty = true;
  renderAnalysisModeEditor();
  document.getElementById('analysisModeName')?.select();
  showAnalysisModeStatus('已新增场景草稿，保存后生效。');
}

function duplicateAnalysisMode() {
  syncAnalysisModeDraftFromEditor();
  const source = currentAnalysisModeDraft();
  if (!source) return;
  let id = `mode_${Date.now().toString(36)}`;
  let suffix = 2;
  const baseId = id;
  while (analysisModeEditorModes.some(mode => mode.id === id)) {
    id = `${baseId}_${suffix++}`;
  }
  analysisModeEditorModes.push({
    id,
    name: `${source.name || '阅读场景'} 副本`,
    description: source.description || '',
    categoryIds: [...new Set(source.categoryIds || [])]
  });
  selectedAnalysisModeId = id;
  analysisModeEditorDirty = true;
  renderAnalysisModeEditor();
  document.getElementById('analysisModeName')?.select();
  showAnalysisModeStatus('已复制完整类别组合；修改名称后保存即可。');
}

function restoreAnalysisModeById(modeId) {
  const fallback = defaultAnalysisMode(modeId);
  if (!fallback) return;
  const clone = structuredClone(fallback);
  const index = analysisModeEditorModes.findIndex(mode => mode.id === modeId);
  if (index >= 0) analysisModeEditorModes.splice(index, 1, clone);
  else analysisModeEditorModes.push(clone);
  selectedAnalysisModeId = modeId;
  analysisModeEditorDirty = true;
  renderAnalysisModeEditor();
  showAnalysisModeStatus('已恢复这个内置场景的名称、说明与默认类别组合；保存后生效。');
}

function restoreCurrentAnalysisMode() {
  const mode = currentAnalysisModeDraft();
  if (!mode || !isBuiltInAnalysisMode(mode.id)) return;
  if (!confirm(`恢复内置场景“${mode.name}”的默认名称、说明和类别组合？`)) return;
  restoreAnalysisModeById(mode.id);
}

function deleteAnalysisMode() {
  if (analysisModeEditorModes.length <= 1) {
    showAnalysisModeStatus('至少保留一个阅读场景。', 'error');
    return;
  }
  const mode = currentAnalysisModeDraft();
  if (!mode || !confirm(
    `删除阅读场景“${mode.name}”？类别规则与历史高亮不会被删除。` +
    (isBuiltInAnalysisMode(mode.id) ? '\n\n内置场景可在本页恢复。' : '')
  )) return;
  analysisModeEditorModes = analysisModeEditorModes.filter(item => item.id !== mode.id);
  selectedAnalysisModeId = analysisModeEditorModes[0]?.id || '';
  analysisModeEditorDirty = true;
  renderAnalysisModeEditor();
  showAnalysisModeStatus('场景已从草稿中删除，点击保存后生效。');
}

function resetAnalysisModes() {
  if (!confirm('恢复全部内置阅读场景的默认名称、说明和类别组合？自定义场景会保留。')) return;
  const builtInIds = new Set(analysisModeDefaults().map(mode => mode.id));
  const customModes = analysisModeEditorModes
    .filter(mode => !builtInIds.has(mode.id));
  analysisModeEditorModes = [
    ...structuredClone(analysisModeDefaults()),
    ...customModes
  ];
  selectedAnalysisModeId = analysisModeEditorModes[0]?.id || '';
  analysisModeEditorDirty = true;
  renderAnalysisModeEditor();
  showAnalysisModeStatus('已恢复全部内置场景；自定义场景已保留，点击保存后生效。');
}

async function saveAnalysisModes() {
  syncAnalysisModeDraftFromEditor();
  const modes = analysisModeEditorModes
    .map(mode => ({
      id: mode.id,
      name: String(mode.name || '').trim(),
      description: String(mode.description || '').trim(),
      categoryIds: [...new Set(mode.categoryIds || [])]
    }))
    .filter(mode => mode.name);
  if (!modes.length) {
    showAnalysisModeStatus('至少需要一个已命名的阅读场景。', 'error');
    return;
  }
  if (modes.some(mode => mode.categoryIds.length === 0)) {
    showAnalysisModeStatus('每个阅读场景至少勾选一个类别规则。', 'error');
    return;
  }
  const button = document.getElementById('saveAnalysisModes');
  button.disabled = true;
  try {
    const currentId = state.settings?.readingViewId;
    const readingViewId = modes.some(mode => mode.id === currentId)
      ? currentId : modes[0].id;
    const updated = await callBackground({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: {
        analysisModes: modes,
        readingViewId
      }
    });
    analysisModeEditorDirty = false;
    applyState(updated);
    showAnalysisModeStatus('阅读场景已保存；切换场景不会调用模型。', 'success');
  } catch (error) {
    showAnalysisModeStatus(`保存失败：${friendlyError(error)}`, 'error');
  } finally {
    button.disabled = false;
  }
}

function renderCompatiblePresetOptions() {
  const select = document.getElementById('compatiblePreset');
  if (!select) return;
  const config = profileById(selectedProfileId)?.config || {};
  const descriptor = providerSelectionDescriptor();
  const presets = compatiblePresets();
  select.replaceChildren();
  presets.forEach(preset => {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    select.appendChild(option);
  });
  const requestedPresetId = descriptor.providerId === 'openai-compatible'
    ? descriptor.presetId : config.presetId;
  const selectedId = compatiblePresetFor(requestedPresetId)
    ? requestedPresetId : 'custom';
  select.value = selectedId;
  if (!select.value && select.options.length) select.selectedIndex = 0;
}

function renderModelSuggestions(providerId = document.getElementById('providerId')?.value) {
  const list = document.getElementById('modelSuggestions');
  const select = document.getElementById('modelSuggestionsSelect');
  const input = document.getElementById('model');
  if (!list) return;
  const descriptor = providerSelectionDescriptor(providerId);
  const localHarness = descriptor.providerId === 'deepseek-harness';
  const localProvider = localHarness || descriptor.providerId === 'codex-local';
  const actionLabel = document.getElementById('modelDiscoveryActionLabel');
  if (actionLabel) actionLabel.textContent = localProvider ? '读取模型' : '联网获取';
  if (select) {
    select.setAttribute('aria-label', localHarness ? '选择官方本机模型' : '选择联网获取的模型');
    select.title = localHarness ? '选择官方本机模型' : '选择联网获取的模型';
  }
  const definition = state?.providers?.[descriptor.providerId];
  const candidates = Array.isArray(definition?.models) ? [...definition.models] : [];
  if (descriptor.providerId === 'openai-compatible') {
    const preset = compatiblePresetFor(descriptor.presetId);
    if (preset?.defaultModel) candidates.push(preset.defaultModel);
  }
  const builtInModels = new Set(candidates);
  const cache = discoveredModels.get(modelDiscoveryCacheKey(descriptor));
  (cache?.models || []).forEach(model => candidates.push(model.id));
  if (input?.value) candidates.push(input.value);
  const allModels = [...new Set(
    candidates.map(value => String(value || '').trim()).filter(Boolean)
  )];
  const query = String(document.getElementById('modelDirectorySearch')?.value || '').trim().toLowerCase();
  const models = allModels.filter(model => !query ||
    `${model} ${cache?.models?.find(item => item.id === model)?.displayName || ''}`.toLowerCase().includes(query));
  const sourceLabel = model => cache?.models?.some(item => item.id === model)
    ? (localProvider ? '本机目录' : '获取目录')
    : builtInModels.has(model)
      ? '内置候选' : '手填 ID';
  list.replaceChildren();
  models.forEach(model => {
      const option = document.createElement('option');
      option.value = model;
      const detail = cache?.models?.find(item => item.id === model);
      if (detail?.displayName && detail.displayName !== model) {
        option.label = detail.displayName;
      }
      list.appendChild(option);
    });
  if (select) {
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = models.length
      ? `候选模型（${models.length}${query ? ` / ${allModels.length}` : ''}）`
      : (query ? '无匹配候选，手填 ID 保持不变' : '暂无候选，可手填 ID');
    select.appendChild(placeholder);
    models.forEach(model => {
      const option = document.createElement('option');
      const detail = cache?.models?.find(item => item.id === model);
      option.value = model;
      option.textContent = detail?.displayName && detail.displayName !== model
        ? `${sourceLabel(model)} · ${detail.displayName} · ${model}` : `${sourceLabel(model)} · ${model}`;
      select.appendChild(option);
    });
    select.value = models.includes(String(input?.value || '').trim())
      ? String(input.value).trim() : '';
    select.disabled = models.length === 0;
  }
}

function handleProviderChange() {
  const descriptor = providerSelectionDescriptor();
  const model = document.getElementById('model');
  if (model.dataset.providerId && model.dataset.providerId !== descriptor.selection) {
    const preset = descriptor.providerId === 'openai-compatible'
      ? compatiblePresetFor(descriptor.presetId) : null;
    model.value = preset?.defaultModel ||
      state?.providers?.[descriptor.providerId]?.defaultModel || '';
  }
  model.dataset.providerId = descriptor.selection;
  if (descriptor.providerId === 'openai-compatible' &&
      descriptor.presetId !== 'custom') {
    applyCompatiblePreset(descriptor.presetId);
  }
  renderProvider();
  updateProfileListPreview();
  scheduleProviderModelDiscovery();
}

function renderProvider() {
  const descriptor = providerSelectionDescriptor();
  const providerId = descriptor.providerId;
  const compatible = providerId === 'openai-compatible';
  const localCodex = providerId === 'codex-local';
  const localHarness = providerId === 'deepseek-harness';
  const typesafe = providerId === 'typesafe';
  document.getElementById('compatibleFields').hidden = !compatible;
  document.getElementById('codexLocalFields').hidden = !localCodex;
  document.getElementById('harnessLocalFields').hidden = !localHarness;
  document.getElementById('apiKeyField').hidden = localCodex || localHarness;
  if (localHarness) document.getElementById('credentialState').textContent = '使用官方 Harness 桌面登录';
  else if (localCodex) document.getElementById('credentialState').textContent = '使用本机 Codex 登录';
  else document.getElementById('credentialState').textContent = profileById(selectedProfileId)?.config?.hasApiKey
    ? 'Key 已保存' : '尚未配置';
  const typesafeHint = document.getElementById('typesafeScopeHint');
  if (typesafeHint) typesafeHint.hidden = !typesafe;
  document.getElementById('compatiblePresetField').hidden =
    compatible && descriptor.selection !== 'openai-compatible';
  if (compatible) {
    const profile = profileById(selectedProfileId);
    const config = { ...(profile?.config || {}) };
    config.supportsVision = providerVisionCapability(providerId, config);
    document.getElementById('supportsVision').checked = config.supportsVision === true;
    renderCompatiblePresetOptions();
    renderCompatiblePresetHint(compatiblePresetFor(document.getElementById('compatiblePreset').value));
  }
  renderModelSuggestions(descriptor.selection);
  renderReasoningEffort();
  renderTaskPolicyTable();
  if (localCodex) void refreshCodexAuthStatus({ silent: true });
  else stopCodexAuthPolling();
  if (localHarness) void refreshHarnessAuthStatus();
  else invalidateHarnessAuthStatus();
  if (typeof renderProviderWorkflow === 'function') renderProviderWorkflow();
}

function renderReasoningEffort(configOverride = null) {
  const field = document.getElementById('reasoningEffortField');
  const select = document.getElementById('reasoningEffort');
  const probeField = document.getElementById('reasoningStructuredProbeField');
  const probeCheckbox = document.getElementById('testReasoningStructured');
  if (!field || !select || typeof SciLLM.getProviderReasoningCapabilities !== 'function') {
    if (field) field.hidden = true;
    if (probeField) probeField.hidden = true;
    if (probeCheckbox) {
      probeCheckbox.checked = false;
      probeCheckbox.disabled = true;
    }
    return;
  }
  const descriptor = providerSelectionDescriptor();
  const profile = profileById(selectedProfileId);
  const config = {
    ...(profile?.config || {}),
    ...(configOverride || {}),
    model: document.getElementById('model')?.value.trim() || ''
  };
  const capability = SciLLM.getProviderReasoningCapabilities(
    descriptor.providerId,
    config
  );
  field.hidden = capability?.supported !== true;
  const automaticVisionProbe = typeof providerVisionCapability === 'function'
    ? providerVisionCapability(descriptor.providerId, config)
    : config.supportsVision === true;
  if (probeField) probeField.hidden = field.hidden || automaticVisionProbe;
  if (probeCheckbox) {
    probeCheckbox.disabled = field.hidden || automaticVisionProbe;
    if (probeCheckbox.disabled) probeCheckbox.checked = false;
  }
  if (field.hidden) {
    select.replaceChildren();
    return;
  }
  const labels = {
    auto: '自动', minimal: '最小', low: '低', medium: '中', high: '高',
    xhigh: '极高', max: '最高', enabled: '开启推理', disabled: '关闭推理'
  };
  const legacyDeepSeekReasoning = descriptor.providerId === 'deepseek' &&
    typeof config.thinking === 'boolean'
    ? (config.thinking === true ? 'enabled' : 'disabled') : '';
  const current = String(config.reasoningEffort || legacyDeepSeekReasoning ||
    capability.defaultLevel || 'auto');
  select.replaceChildren();
  capability.levels.forEach(level => {
    const option = document.createElement('option');
    option.value = level;
    option.textContent = labels[level] || level;
    select.appendChild(option);
  });
  select.value = capability.levels.includes(current)
    ? current : capability.defaultLevel;
  document.getElementById('reasoningEffortHint').textContent =
    capability.mode === 'toggle'
      ? '当前服务商以开启/关闭方式控制推理；“自动”沿用服务商默认。'
      : '推理越强通常更慢；插件只向明确支持的模型发送该参数。';
}

function providerProbeIds(includeReasoning, supportsVision = false, selected = {}) {
  const probeIds = ['connectivity'];
  if (selected.plainJson === true) probeIds.push('plain_json');
  if (selected.structuredSchema === true) probeIds.push('structured_schema');
  if (supportsVision) {
    probeIds.push('vision_input', 'json_output', 'reasoning_structured');
  } else if (includeReasoning) {
    probeIds.push('reasoning_structured');
  }
  return probeIds;
}

function formatProviderProbeSummary(result, language = 'zh-CN') {
  const english = String(language || '').toLowerCase().startsWith('en');
  const probeResults = Array.isArray(result?.probes) ? result.probes : [];
  if (!probeResults.length) return '';
  const passedProbes = probeResults.filter(item => item.status === 'passed').length;
  const skippedProbes = probeResults.filter(item => item.status === 'skipped').length;
  const unsupportedProbes = probeResults.filter(item => item.status === 'unsupported').length;
  const blockedProbes = probeResults.filter(item => item.status === 'blocked').length;
  const reasoningProbe = probeResults.find(item => item.id === 'reasoning_structured');
  const connectionVerified = result?.connectivity === true ||
    (!Object.hasOwn(result || {}, 'connectivity') &&
      probeResults.some(item => item.id === 'connectivity' && item.status === 'passed'));
  const warningCount = Array.isArray(result?.warnings) ? result.warnings.length : 0;
  const otherWarningCount = warningCount - (reasoningProbe?.status === 'failed' ? 1 : 0);
  const tokenValue = result.measuredInputTokens == null
    ? Number(result.estimatedInputTokens) || 0
    : Number(result.measuredInputTokens) || 0;
  const tokenLabel = result.measuredInputTokens == null
    ? (english ? 'Estimated input' : '估算输入')
    : (english ? 'Measured input' : '实测输入');
  let reasoningSummary = '';
  if (reasoningProbe?.status === 'passed') {
    reasoningSummary = english
      ? ' · Structured reasoning passed' : ' · 结构化推理通过';
  }
  else if (reasoningProbe?.status === 'failed') {
    reasoningSummary = connectionVerified
      ? (english ? ' · Structured reasoning failed (connection is working)' : ' · 结构化推理失败（连接正常）')
      : (english ? ' · Structured reasoning failed' : ' · 结构化推理失败');
  } else if (reasoningProbe?.status === 'skipped') {
    reasoningSummary = english
      ? ' · Structured reasoning skipped (unsupported by this profile)'
      : ' · 结构化推理已跳过（当前配置不支持）';
  } else if (reasoningProbe?.status === 'unsupported') {
    reasoningSummary = english
      ? ' · Structured reasoning unsupported by this profile'
      : ' · 当前配置不支持结构化推理';
  } else if (reasoningProbe?.status === 'blocked') {
    reasoningSummary = english
      ? ' · Structured reasoning blocked by the current capability settings'
      : ' · 当前能力设置已阻止结构化推理';
  }
  const inactiveProbes = probeResults.filter(item => !['passed', 'failed'].includes(item.status)).length;
  const probeSummary = english
    ? ` · Probes ${passedProbes}/${probeResults.length - inactiveProbes} passed` +
      (skippedProbes ? `, ${skippedProbes} skipped` : '') +
      (unsupportedProbes ? `, ${unsupportedProbes} unsupported` : '') +
      (blockedProbes ? `, ${blockedProbes} blocked` : '')
    : ` · 探针 ${passedProbes}/${probeResults.length - inactiveProbes} 通过` +
      (skippedProbes ? `，${skippedProbes} 跳过` : '') +
      (unsupportedProbes ? `，${unsupportedProbes} 项不支持` : '') +
      (blockedProbes ? `，${blockedProbes} 项已阻止` : '');
  const warningSummary = otherWarningCount > 0
    ? english
      ? ` · ${otherWarningCount} compatibility warning(s)` + (connectionVerified ? ' (basic connection remains available)' : '')
      : ` · ${otherWarningCount} 项兼容性警告` + (connectionVerified ? '（基础连接仍可用）' : '')
    : '';
  const stageLabels = english ? {
    connectivity: 'Connectivity', plain_json: 'Text JSON (prompt)', structured_schema: 'Text JSON Schema (sample)', vision_input: 'Image input',
    json_output: 'Image and JSON Schema', reasoning_structured: 'Structured reasoning'
  } : {
    connectivity: '基础文本', plain_json: '文本 JSON（普通提示）', structured_schema: '文本 JSON Schema（样例校验）', vision_input: '图片输入',
    json_output: '图片与 JSON Schema', reasoning_structured: '结构化推理'
  };
  const statusLabels = english ? {
    passed: 'passed', failed: 'failed', skipped: 'skipped',
    unsupported: 'unsupported', blocked: 'blocked', unknown: 'not tested', pending: 'pending'
  } : {
    passed: '通过', failed: '失败', skipped: '跳过',
    unsupported: '不支持', blocked: '已阻止', unknown: '未测试', pending: '等待结果'
  };
  const stageSummary = probeResults
    .filter(item => Object.hasOwn(stageLabels, item.id))
    .map(item => `${stageLabels[item.id]}：${statusLabels[item.status] || statusLabels.unknown}`)
    .join(english ? ' · ' : ' · ')
    .replaceAll('：', english ? ': ' : '：');
  return probeSummary + ` · ${tokenLabel} ${tokenValue} Token` +
    reasoningSummary + warningSummary + (stageSummary ? ` · ${stageSummary}` : '');
}

function formatProviderConnectionStatus(result, account = '', language = 'zh-CN') {
  const english = String(language || '').toLowerCase().startsWith('en');
  const providerId = typeof result?.providerId === 'string' ? result.providerId : '';
  const model = typeof result?.model === 'string' ? result.model : '';
  const safeAccount = typeof account === 'string' ? account : '';
  const accountSummary = safeAccount ? ` · ${safeAccount}` : '';
  const prefix = english ? 'Connection successful: ' : '连接成功：';
  return `${prefix}${providerId} / ${model}${accountSummary}` +
    formatProviderProbeSummary(result, language);
}

function providerProbeReadiness(result) {
  const probes = Array.isArray(result?.probes) ? result.probes : [];
  const connectivityProbe = probes.find(item => item?.id === 'connectivity');
  const capabilityProbes = probes.filter(item => item?.id !== 'connectivity');
  const reportedConnectivity = result && Object.hasOwn(result, 'connectivity')
    ? result.connectivity : undefined;
  const reportedCapabilities = result && Object.hasOwn(result, 'capabilitiesReady')
    ? result.capabilitiesReady : undefined;
  const connectivity = typeof reportedConnectivity === 'boolean' ||
      reportedConnectivity === null
    ? reportedConnectivity
    : connectivityProbe
      ? connectivityProbe.status === 'passed'
      : null;
  const capabilitiesReady = typeof reportedCapabilities === 'boolean' ||
      reportedCapabilities === null
    ? reportedCapabilities
    : capabilityProbes.length
      ? capabilityProbes.every(item => item?.status === 'passed')
      : null;
  return {
    connectivity,
    capabilitiesReady,
    visionWorkflow: capabilityProbes.some(item =>
      (item?.id === 'vision_input' || item?.id === 'json_output') && item.status === 'failed')
  };
}

function providerConnectionPresentation(result, account = '', language = 'zh-CN') {
  const english = String(language || '').toLowerCase().startsWith('en');
  const readiness = providerProbeReadiness(result);
  if (readiness.connectivity === true && readiness.capabilitiesReady !== false) {
    return {
      state: 'success',
      message: formatProviderConnectionStatus(result, account, language)
    };
  }
  const providerId = typeof result?.providerId === 'string' ? result.providerId : '';
  const model = typeof result?.model === 'string' ? result.model : '';
  const safeAccount = typeof account === 'string' ? account : '';
  const accountSummary = safeAccount ? ` · ${safeAccount}` : '';
  let prefix;
  if (readiness.connectivity === true) {
    prefix = readiness.visionWorkflow
      ? (english
          ? 'Basic connection succeeded, but vision workflow compatibility failed: '
          : '基础连接成功，但视觉工作流兼容性检查未通过：')
      : (english
          ? 'Basic connection succeeded, but workflow compatibility failed: '
          : '基础连接成功，但工作流兼容性检查未通过：');
  } else {
    prefix = english
      ? 'Basic connectivity was not verified: '
      : '基础连接尚未验证：';
  }
  return {
    state: 'error',
    message: `${prefix}${providerId} / ${model}${accountSummary}` +
      formatProviderProbeSummary(result, language)
  };
}

function modelDiscoveryCacheKey(descriptor = providerSelectionDescriptor()) {
  const revision = typeof modelDiscoveryRevisions === 'undefined'
    ? 0 : modelDiscoveryRevisions.get(selectedProfileId) || 0;
  // The URL can contain private query parameters. Endpoint edits are revisions,
  // so neither endpoint text nor authentication values enter the cache key.
  return `${selectedProfileId}|${descriptor.selection}|${revision ? `revision:${revision}` : ''}`;
}

function retireProviderModelDiscovery(profiles) {
  const request = activeModelDiscovery;
  if (!request || !profiles.has(request.profileId)) return;
  activeModelDiscovery = null;
  modelDiscoveryGeneration += 1;
  if (typeof modelDiscoveryRequests !== 'undefined') modelDiscoveryRequests.delete(request.cacheKey);
  const button = document.getElementById('refreshModels');
  if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
}

function setModelDiscoveryStatus(message, stateName = '') {
  const status = document.getElementById('modelDiscoveryStatus');
  if (!status) return;
  status.textContent = message;
  if (stateName) status.dataset.state = stateName;
  else delete status.dataset.state;
}

function modelDiscoveryConfig(descriptor = providerSelectionDescriptor()) {
  const saved = profileById(selectedProfileId)?.config || {};
  const config = { ...saved };
  const enteredKey = document.getElementById('apiKey')?.value.trim();
  if (enteredKey) config.apiKey = enteredKey;
  config.model = document.getElementById('model')?.value.trim() || config.model || '';
  if (descriptor.providerId === 'openai-compatible') {
    config.presetId = descriptor.presetId || 'custom';
    config.baseUrl = document.getElementById('baseUrl')?.value.trim() || '';
    config.authHeader = document.getElementById('authHeader')?.value.trim() ||
      'Authorization';
    config.authPrefix = document.getElementById('authPrefix')?.value.trim();
  }
  if (['codex-local', 'deepseek-harness'].includes(descriptor.providerId)) {
    ['apiKey', 'hasApiKey', 'apiKeyMask', 'baseUrl', 'presetId', 'authHeader', 'authPrefix',
      'jsonMode', 'customHeaders', 'customHeaderNames', 'supportsVision', 'reasoningMode']
      .forEach(key => { delete config[key]; });
  }
  return config;
}

function scheduleProviderModelDiscovery() {
  if (modelDiscoveryTimer) clearTimeout(modelDiscoveryTimer);
  if (activeModelDiscovery && !isCurrentModelDiscovery(activeModelDiscovery)) {
    activeModelDiscovery = null;
    modelDiscoveryGeneration += 1;
    const button = document.getElementById('refreshModels');
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
    setModelDiscoveryStatus('');
  }
  modelDiscoveryTimer = setTimeout(() => {
    modelDiscoveryTimer = null;
    void refreshProviderModels({ auto: true });
  }, 180);
}

function isCurrentModelDiscovery(request) {
  return !profileMutationInFlight && request.generation === modelDiscoveryGeneration &&
    request.profileId === selectedProfileId &&
    request.cacheKey === modelDiscoveryCacheKey() &&
    request.descriptorKey === JSON.stringify(providerSelectionDescriptor());
}

function applyModelSelection(modelId) {
  const normalized = String(modelId || '').trim();
  const input = document.getElementById('model');
  if (!normalized || !input) return false;
  input.value = normalized;
  markProfileEditorDirty({ target: { id: 'model' } });
  updateProfileListPreview();
  renderReasoningEffort();
  renderTaskPolicyTable();
  return true;
}

function handleModelSuggestionSelection(event) {
  return applyModelSelection(event.currentTarget?.value);
}

function syncModelSuggestionSelection() {
  const input = document.getElementById('model');
  const select = document.getElementById('modelSuggestionsSelect');
  if (!input || !select) return;
  const model = input.value.trim();
  input.title = model;
  const known = [...select.options].some(option => option.value === model && model);
  select.value = known ? model : '';
  const placeholder = [...select.options].find(option => option.value === '');
  if (placeholder) placeholder.textContent = interfaceText(
    model && !known ? '使用手填模型 ID' : '选择候选模型（可选）'
  );
}

function autoSelectFirstDiscoveredModel(models) {
  const input = document.getElementById('model');
  if (!input || input.value.trim()) return false;
  return applyModelSelection(models?.[0]?.id);
}

async function refreshProviderModels({ auto = false } = {}) {
  if (profileMutationInFlight) return;
  if (!selectedProfileId || !profileById(selectedProfileId)) return;
  const profileId = selectedProfileId;
  const descriptor = providerSelectionDescriptor();
  const profile = profileById(profileId);
  const hasCredential = ['codex-local', 'deepseek-harness'].includes(descriptor.providerId) ||
    Boolean(document.getElementById('apiKey')?.value.trim()) ||
    profile?.config?.hasApiKey === true;
  if (!hasCredential) {
    setModelDiscoveryStatus(
      '填写 API Key 后可联网获取当前账号可用模型；模型 ID 仍可手动输入。',
      auto ? '' : 'error'
    );
    return;
  }

  const cacheKey = modelDiscoveryCacheKey(descriptor);
  const cached = discoveredModels.get(cacheKey);
  if (auto && cached && Date.now() - cached.cachedAt < MODEL_DISCOVERY_CACHE_MS) {
    renderModelSuggestions(descriptor.selection);
    setModelDiscoveryStatus(`已载入 ${cached.models.length} 个缓存目录模型；目录不代表能力验证。`, 'success');
    return;
  }

  const button = document.getElementById('refreshModels');
  if (activeModelDiscovery && isCurrentModelDiscovery(activeModelDiscovery)) return;
  if (button?.disabled && !activeModelDiscovery) return;
  const request = {
    generation: ++modelDiscoveryGeneration, profileId, cacheKey,
    descriptorKey: JSON.stringify(descriptor)
  };
  activeModelDiscovery = request;
  modelDiscoveryRequests.set(cacheKey, request.generation);
  const config = modelDiscoveryConfig(descriptor);
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  setModelDiscoveryStatus(descriptor.providerId === 'deepseek-harness'
    ? '正在读取官方 Harness 的已安装模型目录…'
    : '正在连接服务商并获取可用模型…', 'loading');
  try {
    const result = await callBackground({
      type: 'LLM_LIST_MODELS',
      profileId,
      providerId: descriptor.providerId,
      config
    });
    const models = (Array.isArray(result.models) ? result.models : [])
      .filter(item => item && typeof item.id === 'string')
      .slice(0, 500);
    if (!models.length) throw new Error('服务商没有返回可用模型');
    if (modelDiscoveryRequests.get(cacheKey) === request.generation) {
      discoveredModels.set(cacheKey, {
        cachedAt: Date.now(),
        fetchedAt: result.fetchedAt,
        models
      });
    }
    if (!isCurrentModelDiscovery(request)) return;
    autoSelectFirstDiscoveredModel(models);
    renderModelSuggestions(descriptor.selection);
    setModelDiscoveryStatus(
      descriptor.providerId === 'deepseek-harness'
        ? `已读取 ${models.length} 个官方本机模型；当前登录可用性请使用“测试连接”验证。`
        : `已从服务商获取 ${models.length} 个目录模型；调用与能力请单独测试。`,
      'success'
    );
  } catch (error) {
    const prefix = auto ? '自动获取失败' : '获取模型失败';
    if (!isCurrentModelDiscovery(request)) return;
    setModelDiscoveryStatus(
      `${prefix}：${friendlyError(error)}。仍可手动输入模型 ID。`,
      'error'
    );
  } finally {
    if (activeModelDiscovery === request) {
      activeModelDiscovery = null;
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    }
    if (typeof renderProviderWorkflow === 'function') renderProviderWorkflow();
  }
}

function updateProfileListPreview() {
  if (!selectedProfileId) return;
  const profile = profileById(selectedProfileId);
  const item = document.querySelector(
    `[data-profile-id="${CSS.escape(selectedProfileId)}"]`
  );
  if (!profile || !item) return;
  const descriptor = providerSelectionDescriptor();
  const config = {
    ...(profile.config || {}),
    model: document.getElementById('model')?.value.trim() || ''
  };
  if (descriptor.providerId === 'openai-compatible') {
    config.supportsVision = document.getElementById('supportsVision')?.checked === true;
  }
  item.textContent = profileOptionLabel({
    ...profile,
    name: document.getElementById('profileName')?.value.trim() || '未命名',
    providerId: descriptor.providerId,
    config
  });
}

async function persistProfileName() {
  const input = document.getElementById('profileName');
  const profileId = selectedProfileId;
  const profile = profileById(profileId);
  if (!input || !profile) return;
  const name = input.value.trim();
  if (!name) {
    input.value = profile.name || '';
    profileDirtyFields.delete('profileName');
    profileEditorDirty = profileDirtyFields.size > 0;
    showStatus('配置名称不能为空。', 'error');
    return;
  }
  if (name === profile.name && activeProfileRename?.profileId !== profileId &&
      !pendingProfileRenames.has(profileId)) {
    profileDirtyFields.delete('profileName');
    profileEditorDirty = profileDirtyFields.size > 0;
    return;
  }
  const revision = settingsDraftRevisions.get('profileName');
  // Queue only explicit blur/Enter intents, keeping the latest per profile.
  // New text typed without another blur remains an unsaved local draft.
  pendingProfileRenames.set(profileId, { profileId, name, revision });
  if (profileRenameTask) return profileRenameTask;
  if (!beginProfileAction('rename')) return;
  profileRenameTask = (async () => {
    try {
      while (pendingProfileRenames.size) {
        const intent = pendingProfileRenames.values().next().value;
        pendingProfileRenames.delete(intent.profileId);
        if (!profileById(intent.profileId)) continue;
        activeProfileRename = intent;
        try {
          const result = await callBackground({
            type: 'LLM_SAVE_PROFILE',
            profile: { id: intent.profileId, name: intent.name }
          });
          if (state?.settings?.profiles?.[intent.profileId]) {
            state.settings.profiles[intent.profileId].name = result.profile?.name || intent.name;
          }
          const ownsDraft = selectedProfileId === intent.profileId &&
            settingsDraftRevisions.get('profileName') === intent.revision &&
            input.value.trim() === intent.name;
          if (ownsDraft) profileDirtyFields.delete('profileName');
          profileEditorDirty = profileDirtyFields.size > 0;
          renderProfileList();
          updateProfileListPreview();
          renderTaskPolicyTable();
          if (ownsDraft) showStatus('配置名称已保存。', 'success');
        } catch (error) {
          if (selectedProfileId === intent.profileId) {
            showStatus(`保存配置名称失败：${friendlyError(error)}`, 'error');
          }
        }
      }
    } finally {
      activeProfileRename = null;
      profileRenameTask = null;
      endProfileAction('rename');
    }
  })();
  return profileRenameTask;
}

function friendlyError(error) {
  if (error.code === 'INVALID_SETTINGS' && Array.isArray(error.fields) &&
      error.fields.length === 1 && error.fields[0] === 'apiKey') {
    return interfaceText('当前配置没有可用的 API Key。请在本配置中填写并保存密钥；手填模型 ID 不受候选列表限制。');
  }
  const messages = {
    AUTH_INVALID: document.getElementById('providerId')?.value === 'deepseek-harness'
      ? '官方 Harness 登录已失效或无权限，请在官方桌面重新登录后测试'
      : 'API Key 无效或无权限',
    RATE_LIMITED: '请求过于频繁，请稍后重试',
    QUOTA_EXHAUSTED: 'API 额度不足',
    PROVIDER_REJECTED: '服务商拒绝了模型列表请求',
    REQUEST_TIMEOUT: '连接测试等待超时，请稍后重试',
    CANCELLED: '请求已取消',
    NETWORK_ERROR: '无法访问服务商，请检查域名权限和网络',
    INVALID_RESPONSE: '服务商返回了无法识别的格式',
    CODEX_NOT_INSTALLED: '未找到本机 Codex，请先安装 Codex',
    CODEX_NOT_AUTHENTICATED: '插件专用 Codex 会话未登录或已过期，请点击本页“登录 / 重新登录”',
    CODEX_BRIDGE_UNAVAILABLE: '本机 Codex 桥未安装、未注册或已断开',
    CODEX_PROVIDER_REJECTED: '本机 Codex 拒绝了这次请求；请查看登录状态后重新测试',
    HARNESS_NOT_INSTALLED: '未找到官方 Harness，请先安装并在官方桌面登录',
    HARNESS_NOT_AUTHENTICATED: '官方 Harness 尚未保存登录或登录已失效，请在官方桌面登录后重试',
    HARNESS_START_FAILED: '本机 Harness 桥不可用，请检查安装和注册状态',
    HARNESS_MODEL_UNAVAILABLE: '当前 Harness 登录未提供所选模型，请刷新模型目录后重试',
    HARNESS_VERSION_UNSUPPORTED: '当前官方 Harness 版本与本机桥不兼容，请更新 Brevess 配套组件',
    HARNESS_BRIDGE_OUTDATED: '浏览器连接的 Windows 配套组件版本过旧，不支持 Harness。请安装 R26 或更新版本的 Windows 配套组件，重新加载扩展后刷新状态。',
    HARNESS_PROTOCOL_ERROR: '本机 Harness 返回格式异常，请重新测试连接',
    HARNESS_MODEL_REQUIRED: '请选择官方 Harness 提供的模型',
    HARNESS_IMAGE_UNSUPPORTED: '所选 Harness 模型不支持图片，请选择支持图片的模型',
    HARNESS_TOOL_DISABLED: '当前 Harness 请求触发了未启用的工具，请重新测试连接',
    HARNESS_MAX_TOKENS: 'Harness 输出达到长度上限，请缩小任务范围后重试',
    HARNESS_TURN_FAILED: 'Harness 模型请求失败，请测试连接后重试',
    HARNESS_PROCESS_EXITED: 'Harness 在请求完成前退出，请重新测试连接',
    PROVIDER_UNAVAILABLE: '当前模型服务暂时不可用，请稍后重试。',
    CONTEXT_BUDGET_EXCEEDED: '当前 Codex 上下文不足以容纳这次请求',
    INVALID_SETTINGS: `内容不完整或规则不安全：${(error.fields || []).join('、')}`,
    USER_DATA_DATABASE_UNAVAILABLE: '本地数据库模块不可用，请重新加载扩展后重试',
    INDEXEDDB_UNAVAILABLE: '浏览器本地数据库不可用，请检查隐私设置后重试',
    INDEXEDDB_OPEN_FAILED: '无法打开浏览器本地数据库，请重新加载扩展后重试',
    INDEXEDDB_UPGRADE_BLOCKED: '本地数据库正在被旧页面占用，请关闭其他插件设置页后重试'
  };
  if (error.code === 'INVALID_RESPONSE' && error.diagnosticType === 'HtmlResponse') {
    return '连接到了网页而不是 API；请检查校园网认证、代理/VPN、杀毒软件拦截或 Base URL';
  }
  if (error.code === 'INVALID_RESPONSE' && ['connectivity', 'plain_json', 'structured_schema', 'vision_input', 'json_output', 'reasoning_structured'].includes(error.probeId)) {
    const reason = error.diagnosticType === 'JSON_PARSE_FAILED' ? 'JSON 解析失败' :
      error.diagnosticType === 'JSON_CONTRACT_MISMATCH' ? 'JSON 内容不符合探针约定' : '响应未通过该探针校验';
    return `${error.probeId} · ${interfaceText(reason)}`;
  }
  return messages[error.code] || error.message;
}

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status show ${type}`;
}

function providerVerificationIsCurrent(profileId, record) {
  const profile = profileById(profileId);
  return Boolean(record && !record.expired && profile &&
    record.providerId === profile.providerId && record.model === String(profile.config?.model || ''));
}

function renderProviderWorkflow() {
  const host = document.getElementById('providerProbeResults');
  if (!host || typeof providerVerificationResults === 'undefined') return;
  const profile = profileById(selectedProfileId);
  const record = providerVerificationResults.get(selectedProfileId);
  const current = providerVerificationIsCurrent(selectedProfileId, record);
  const cache = discoveredModels.get(modelDiscoveryCacheKey());
  const setStep = (id, message, status = '') => {
    const element = document.getElementById(id);
    if (element) { element.textContent = message; element.dataset.state = status; }
  };
  const dirty = settingsDraftIsDirty('profile');
  setStep('providerConfigurationStep', dirty ? '有未保存修改' : (profile ? '配置已保存' : '待配置'), dirty ? 'pending' : 'saved');
  setStep('providerDirectoryStep', activeModelDiscovery?.profileId === selectedProfileId ? '目录读取中' :
    cache ? `目录已获取 · ${cache.models.length} 项` : '可读取目录，也可手填 ID', cache ? 'passed' : 'unknown');
  const model = String(document.getElementById('model')?.value || '').trim();
  setStep('providerModelStep', model ? `已选择 · ${model}` : '请选择或填写模型 ID', model ? 'selected' : 'unknown');
  let message = '尚未验证；保存与读取目录不代表模型可用';
  let status = 'unknown';
  if (record?.expired || (record && !current)) { message = '配置已修改，之前的结果已过期'; status = 'expired'; }
  else if (record?.pending) { message = '测试中，等待各项结果'; status = 'pending'; }
  else if (current && record.result?.connectivity === true) {
    message = record.result.capabilitiesReady === false ? '基础连接通过，部分能力未通过' : '基础连接已验证';
    status = record.result.capabilitiesReady === false ? 'partial' : 'passed';
  } else if (current && record.errorCode) { message = '测试未通过，请查看错误并重试'; status = 'failed'; }
  setStep('providerTestStep', message, status);
  const labels = { connectivity: '基础文本', plain_json: '文本 JSON（普通提示）', structured_schema: '文本 JSON Schema（样例校验）',
    vision_input: '图片输入', json_output: '图片与 JSON Schema', reasoning_structured: '结构化推理', web_search: '联网搜索' };
  const states = { passed: '通过', failed: '失败', skipped: '已跳过', unsupported: '不支持', blocked: '已阻止', unknown: '未测试', pending: '等待结果' };
  host.replaceChildren();
  Object.entries(labels).forEach(([id, label]) => {
    const probe = current ? record?.result?.probes?.find(item => item.id === id) : null;
    const pending = current && record?.pending && record.probeIds?.includes(id);
    const row = document.createElement('li');
    row.dataset.probeId = id;
    row.dataset.state = probe?.status || (pending ? 'pending' : 'unknown');
    const title = document.createElement('strong'); title.textContent = label;
    const result = document.createElement('span');
    result.textContent = probe ? states[probe.status] || '未验证' : pending ? '等待结果' : '未测试';
    if (probe?.status === 'failed' && /^[A-Z_]{2,64}$/.test(String(probe.code || ''))) result.textContent += ` · ${probe.code}`;
    if (id === 'web_search' && !probe) result.textContent = '未测试；须按接入路径验证';
    row.append(title, result);
    if (probe?.status === 'failed' && ['JSON_PARSE_FAILED', 'JSON_CONTRACT_MISMATCH', 'AbortError', 'HtmlResponse', 'JsonSyntaxError', 'SyntaxError', 'TimeoutError', 'TypeError'].includes(probe.diagnosticType)) result.textContent += ` · ${probe.diagnosticType}`;
    if (id !== 'web_search') {
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button quiet compact-button';
      retry.textContent = interfaceText('单项复测'); retry.disabled = record?.pending === true;
      retry.setAttribute('aria-label', `${label} · ${interfaceText('单项复测')}`);
      retry.addEventListener('click', () => testProvider(id)); row.appendChild(retry);
    }
    host.appendChild(row);
  });
}

async function copySupportEmail() {
  const status = document.getElementById('supportCopyStatus');
  const button = document.getElementById('copySupportEmail');
  if (!status || !button) return;
  button.disabled = true;
  try {
    if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText('brevess0729@163.com');
    status.textContent = '邮箱已复制。'; status.dataset.state = 'success';
  } catch (_) {
    status.textContent = '复制未完成；可选中邮箱后手动复制。'; status.dataset.state = 'error';
  } finally { button.disabled = false; }
}

// Named API Profiles editor. All current UI actions use the profile contract.
function providerVisionCapability(providerId, config = {}) {
  if (typeof globalThis.SciLLM?.getProviderCapabilities === 'function') {
    return globalThis.SciLLM.getProviderCapabilities(providerId, config)
      .supportsVision === true;
  }
  const definition = state?.providers?.[providerId];
  if (!definition) return false;
  return providerId === 'openai-compatible'
    ? config.supportsVision === true
    : definition.supportsVision === true;
}

// Compatible editor render contract: document.getElementById('supportsVision').checked = config.supportsVision === true

function markProfileEditorDirty(event) {
  const fieldId = typeof event === 'string' ? event
    : String(event?.currentTarget?.id || event?.target?.id || '*');
  profileDirtyFields.add(fieldId);
  settingsDraftRevisions.set(fieldId, ++settingsDraftRevision);
  profileEditorDirty = true;
  invalidateProviderConfiguration(fieldId);
}

function invalidateProviderConfiguration(fieldId) {
  if (typeof modelDiscoveryRevisions === 'undefined' || typeof providerVerificationResults === 'undefined') return;
  const directoryFields = ['providerId', 'compatiblePreset', 'apiKey', 'baseUrl', 'authHeader', 'authPrefix', 'customHeaders'];
  const capabilityFields = [...directoryFields, 'model', 'jsonMode', 'supportsVision', 'reasoningEffort', 'contextWindowTokens'];
  if (!capabilityFields.includes(fieldId)) return;
  const record = providerVerificationResults.get(selectedProfileId);
  if (record) record.expired = true;
  if (directoryFields.includes(fieldId)) {
    modelDiscoveryRevisions.set(selectedProfileId, (modelDiscoveryRevisions.get(selectedProfileId) || 0) + 1);
    retireProviderModelDiscovery(new Set([selectedProfileId]));
    setModelDiscoveryStatus('接入配置已修改，请重新读取目录；仍可使用手填模型 ID。');
    renderModelSuggestions();
  }
  if (typeof renderProviderWorkflow === 'function') renderProviderWorkflow();
  if (typeof renderSettingsOverview === 'function') renderSettingsOverview();
}

function updateProviderBindingsForState(nextState) {
  if (!state?.settings?.profiles || typeof modelDiscoveryRevisions === 'undefined') return;
  const profiles = new Set([...Object.keys(state.settings.profiles), ...Object.keys(nextState?.settings?.profiles || {})]);
  // Public masks and header names cannot prove that credentials stayed the
  // same. Every new settings snapshot conservatively retires these bindings.
  profiles.forEach(id => {
    modelDiscoveryRevisions.set(id, (modelDiscoveryRevisions.get(id) || 0) + 1);
    const verification = providerVerificationResults.get(id);
    if (verification) verification.expired = true;
  });
  retireProviderModelDiscovery(profiles);
}

function settingsDraftScope(fieldId) {
  if (['analysisMode', 'autoAnalyze', 'consentGranted'].includes(fieldId)) return 'reading';
  if (['autoCacheFigureImages', 'saveArticleWebSnapshot'].includes(fieldId)) return 'storage';
  if (['panelFollowupPresetList', 'articleChatQuickPromptList',
    'literatureNoteTemplateList', 'selectionLlmActionList'].includes(fieldId)) return fieldId;
  if (['globalProfileId', 'llmTaskPolicyTableBody', 'llmAdvancedTaskPolicyTableBody',
    'copyTaskTokenRule', 'taskTokenRuleDialog'].includes(fieldId)) return 'routing';
  return 'profile';
}

function settingsDraftIsDirty(scope) {
  return [...profileDirtyFields].some(field => settingsDraftScope(field) === scope);
}

function snapshotSettingsDrafts() {
  return {
    profileId: selectedProfileId,
    revisions: new Map(settingsDraftRevisions),
    fields: new Set(profileDirtyFields)
  };
}

function settingsDraftScopeUnchanged(snapshot, scope) {
  return [...settingsDraftRevisions].every(([field, revision]) =>
    settingsDraftScope(field) !== scope || revision === snapshot.revisions.get(field));
}

function acknowledgeSettingsDrafts(snapshot) {
  snapshot.fields.forEach(field => {
    if (settingsDraftScope(field) === 'profile' && snapshot.profileId !== selectedProfileId) return;
    if (settingsDraftRevisions.get(field) === snapshot.revisions.get(field)) {
      profileDirtyFields.delete(field);
    }
  });
  profileEditorDirty = profileDirtyFields.size > 0;
}

function clearProfileEditorDirty(scopes = null) {
  [...profileDirtyFields].forEach(field => {
    if (scopes && !scopes.includes(settingsDraftScope(field))) return;
    profileDirtyFields.delete(field);
    // Invalidates acknowledgements for a draft explicitly discarded by navigation.
    settingsDraftRevisions.set(field, ++settingsDraftRevision);
  });
  profileEditorDirty = profileDirtyFields.size > 0;
}

function canLeaveProfileEditor(action = 'switch') {
  if (!settingsDraftIsDirty('profile') && !settingsDraftIsDirty('routing')) return true;
  const message = '当前 Profile 有未保存修改，是否放弃并继续？';
  const canConfirm = typeof window !== 'undefined' && typeof window.confirm === 'function';
  if (canConfirm && window.confirm(message)) {
    clearProfileEditorDirty(['profile', 'routing']);
    const globalSelect = document.getElementById('globalProfileId');
    if (globalSelect) globalSelect.value = state?.settings?.globalProfileId || '';
    syncTaskPolicyDraftsFromState();
    renderTaskPolicyTable();
    return true;
  }
  showStatus(`${message}（请先保存或取消${action}）`, 'info');
  return false;
}

function beginProfileAction(action) {
  if (profileActionInFlight[action]) return false;
  profileActionInFlight[action] = true;
  return true;
}

function endProfileAction(action) {
  delete profileActionInFlight[action];
}

function beginProfileMutation() {
  if (profileMutationInFlight) return false;
  profileMutationInFlight = true;
  return true;
}

function endProfileMutation() {
  profileMutationInFlight = false;
}

function setProfileMutationPending(pending) {
  if (pending) {
    if (!profileMutationDisabledStates) {
      profileMutationOwnerId = selectedProfileId;
      // A discovery started on the old editor may cache its result, but cannot
      // create a new draft while a structural operation is switching its owner.
      modelDiscoveryGeneration += 1;
      if (activeModelDiscovery) {
        activeModelDiscovery = null;
        const refresh = document.getElementById('refreshModels');
        if (refresh) {
          refresh.disabled = false;
          refresh.removeAttribute('aria-busy');
        }
        setModelDiscoveryStatus('');
      }
      profileMutationDisabledStates = new Map();
    }
    const controls = ['addApiProfile', 'duplicateApiProfile', 'deleteApiProfile', 'saveSettings', 'testProvider']
      .map(id => document.getElementById(id));
    ['apiProfilesSettings', 'taskRoutingSettings', 'taskTokenRuleForm'].forEach(id => {
      const container = document.getElementById(id);
      controls.push(...(container?.querySelectorAll('input, select, textarea, button') || []));
    });
    controls.filter(Boolean).forEach(element => {
      if (!profileMutationDisabledStates.has(element)) {
        profileMutationDisabledStates.set(element, element.disabled === true);
      }
      element.disabled = true;
    });
  } else {
    profileMutationDisabledStates?.forEach((disabled, element) => {
      element.disabled = disabled;
    });
    profileMutationDisabledStates = null;
    if (selectedProfileId !== profileMutationOwnerId) {
      // These controls reuse DOM nodes but derive availability from the new
      // owner's models/provider, rather than the previous owner's disabled state.
      renderModelSuggestions();
      renderReasoningEffort();
    }
    profileMutationOwnerId = '';
    scheduleProviderModelDiscovery();
  }
  const list = document.getElementById('apiProfileList');
  if (list) list.setAttribute('aria-busy', String(Boolean(pending)));
}

function profileEntries() {
  const profiles = state?.settings?.profiles;
  const order = Array.isArray(state?.settings?.profileOrder)
    ? state.settings.profileOrder : Object.keys(profiles || {});
  return order.filter(id => profiles && profiles[id]).map(id => [id, profiles[id]]);
}

function profileOptionLabel(profile) {
  const model = profile?.config?.model || profile?.model;
  const vision = providerVisionCapability(profile?.providerId, profile?.config || {});
  const providerLabel = profile?.providerId === 'openai-compatible'
    ? (compatiblePresetFor(profile?.config?.presetId)?.label ||
      state?.providers?.[profile?.providerId]?.label)
    : state?.providers?.[profile?.providerId]?.label;
  const name = profile?.name || interfaceText('未命名');
  const provider = providerLabel ? interfaceText(providerLabel)
    : (profile?.providerId || interfaceText('未选服务商'));
  return [name, ...(name === provider ? [] : [provider]),
    model || interfaceText('未填写模型'), interfaceText(vision ? '视觉' : '仅文本')].join(' · ');
}

function renderProfileList() {
  const list = document.getElementById('apiProfileList');
  if (!list) return;
  list.replaceChildren();
  profileEntries().forEach(([id, profile]) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'api-profile-list-item';
    item.dataset.profileId = id;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(id === selectedProfileId));
    item.textContent = profileOptionLabel(profile);
    list.appendChild(item);
  });
  if (!profileEntries().length) {
    const empty = document.createElement('p');
    empty.className = 'empty-categories';
    empty.textContent = '尚未创建 API Profile';
    list.appendChild(empty);
  }
}

function profileById(id) {
  return state?.settings?.profiles?.[id] || null;
}

function renderProviderOptions() {
  const select = document.getElementById('providerId');
  if (!select || !state?.providers) return;
  const current = select.value;
  select.replaceChildren();
  const directGroup = document.createElement('optgroup');
  directGroup.label = '常用服务商';
  Object.entries(state.providers)
    .filter(([providerId]) => providerId !== 'openai-compatible')
    .forEach(([providerId, definition]) => {
      const option = document.createElement('option');
      option.value = providerId;
      option.textContent = definition.label;
      directGroup.appendChild(option);
    });
  select.appendChild(directGroup);

  const domesticGroup = document.createElement('optgroup');
  domesticGroup.label = '国内模型服务商';
  compatiblePresets().filter(preset => preset.id !== 'custom').forEach(preset => {
    const option = document.createElement('option');
    option.value = `${COMPATIBLE_PROVIDER_VALUE_PREFIX}${preset.id}`;
    option.textContent = preset.label;
    domesticGroup.appendChild(option);
  });
  select.appendChild(domesticGroup);

  const customGroup = document.createElement('optgroup');
  customGroup.label = '其他接口';
  const custom = document.createElement('option');
  custom.value = 'openai-compatible';
  custom.textContent = state.providers['openai-compatible']?.label ||
    '自定义 OpenAI 兼容接口';
  customGroup.appendChild(custom);
  select.appendChild(customGroup);

  if (current && [...select.options].some(option => option.value === current)) {
    select.value = current;
  }
}

function renderProfileEditor() {
  if (selectedProfileId && !profileById(selectedProfileId) && settingsDraftIsDirty('profile')) {
    renderProfileList();
    showStatus(MISSING_PROFILE_DRAFT_MESSAGE, 'error');
    return;
  }
  const entries = profileEntries();
  if (!entries.length) {
    selectedProfileId = '';
    renderProfileList();
    return;
  }
  if (!profileById(selectedProfileId)) {
    selectedProfileId = state.settings.globalProfileId || entries[0][0];
    if (!profileById(selectedProfileId)) selectedProfileId = entries[0][0];
  }
  const profile = profileById(selectedProfileId);
  const config = profile?.config || {};
  renderProviderOptions();
  document.getElementById('profileName').value = profile?.name || '';
  const selectionValue = providerSelectionValue(profile) ||
    providerSelectionValue(entries[0][1]);
  document.getElementById('providerId').value = selectionValue;
  const model = document.getElementById('model');
  model.value = config.model ||
    state.providers?.[profile?.providerId]?.defaultModel || '';
  model.dataset.providerId = selectionValue;
  const apiKey = document.getElementById('apiKey');
  apiKey.value = '';
  apiKey.placeholder = config.hasApiKey
    ? `已保存 ${config.apiKeyMask}；留空保持不变` : '粘贴 API Key';
  document.getElementById('credentialState').textContent = config.hasApiKey
    ? 'Key 已保存' : '尚未配置';
  const compatible = profile?.providerId === 'openai-compatible';
  const localCodex = profile?.providerId === 'codex-local';
  const localHarness = profile?.providerId === 'deepseek-harness';
  document.getElementById('compatibleFields').hidden = !compatible;
  document.getElementById('codexLocalFields').hidden = !localCodex;
  document.getElementById('harnessLocalFields').hidden = !localHarness;
  document.getElementById('apiKeyField').hidden = localCodex || localHarness;
  if (localCodex) {
    document.getElementById('credentialState').textContent = '使用本机 Codex 登录';
  }
  if (localHarness) document.getElementById('credentialState').textContent = '使用官方 Harness 桌面登录';
  if (compatible) {
    document.getElementById('baseUrl').value = config.baseUrl || '';
    document.getElementById('authHeader').value = config.authHeader || 'Authorization';
    document.getElementById('authPrefix').value = config.authPrefix ?? 'Bearer';
    document.getElementById('jsonMode').checked = config.jsonMode !== false;
    config.supportsVision = providerVisionCapability(profile?.providerId, config);
    document.getElementById('supportsVision').checked = config.supportsVision === true;
    renderCompatiblePresetOptions();
    renderCompatiblePresetHint(compatiblePresetFor(config.presetId) || compatiblePresetFor('custom'));
  }
  document.getElementById('compatiblePresetField').hidden =
    compatible && selectionValue !== 'openai-compatible';
  renderModelSuggestions(selectionValue);
  document.getElementById('contextWindowTokens').value =
    profile?.contextWindowTokens ?? '';
  renderReasoningEffort(config);
  renderProfileList();
  renderTaskPolicyTable();
  scheduleProviderModelDiscovery();
  if (localCodex) void refreshCodexAuthStatus({ silent: true });
  else stopCodexAuthPolling();
  if (localHarness) void refreshHarnessAuthStatus();
  else invalidateHarnessAuthStatus();
}

function cloneTaskTokenRule(rule) {
  if (rule === 'auto') return 'auto';
  return {
    input: { ...(rule?.input || {}) },
    output: { ...(rule?.output || {}) }
  };
}

function interfaceText(value) {
  return typeof SciLLM.translateInterfaceText === 'function'
    ? SciLLM.translateInterfaceText(value) : String(value || '');
}

function syncTaskPolicyDraftsFromState() {
  taskPolicyDrafts.clear();
  SciLLM.LLM_TASK_IDS.forEach(taskId => {
    const saved = state?.settings?.taskPolicies?.[taskId] || {};
    const translation = TRANSLATION_TASK_POLICY_IDS.has(taskId);
    const validProfile = saved.mode === 'profile' && (translation || profileById(saved.profileId));
    taskPolicyDrafts.set(taskId, {
      mode: validProfile ? 'profile' : translation && saved.mode !== 'global' ? 'local' : 'global',
      profileId: validProfile ? saved.profileId : null,
      reasoningEnabled: saved.reasoningEnabled === true,
      reasoningEffort: TASK_REASONING_EFFORTS.includes(saved.reasoningEffort)
        ? saved.reasoningEffort : 'auto',
      tokenRule: cloneTaskTokenRule(
        SciLLM.normalizeTaskTokenRule(taskId, saved.tokenRule)
      ),
      allowTextFallback: saved.allowTextFallback === true
    });
  });
}

function taskPolicyDraft(taskId) {
  if (!taskPolicyDrafts.has(taskId)) {
    taskPolicyDrafts.set(taskId, {
      mode: TRANSLATION_TASK_POLICY_IDS.has(taskId) ? 'local' : 'global', profileId: null, reasoningEnabled: false,
      reasoningEffort: 'auto', tokenRule: 'auto', allowTextFallback: false
    });
  }
  return taskPolicyDrafts.get(taskId);
}

function taskPolicyUiText(definition) {
  const translate = value => typeof SciLLM.translateInterfaceText === 'function'
    ? SciLLM.translateInterfaceText(value) : String(value || '');
  const label = translate(definition.labelZh);
  const unitLabel = translate(definition.unitLabelZh);
  return {
    label,
    unitLabel,
    visionRequirement: translate(definition.requirements?.captionContext === true
      ? '支持原图或正文与图注解读' : '需要多模态模型'),
    modelAria: `${label} · ${translate('模型选择')}`,
    reasoningAria: `${label} · ${translate('启用推理')}`,
    effortAria: `${label} · ${translate('推理强度')}`,
    tokenAria: `${translate('编辑')} ${label} ${translate('Token 规则')}`,
    dialogPreview: `${label} · ${translate('按')} 1 ${unitLabel} ${translate('预览')}`
  };
}

function profileForTaskPolicy(profileId) {
  const profile = profileById(profileId);
  if (!profile || profileId !== selectedProfileId) return profile;
  const selection = document.getElementById('providerId')?.value;
  if (!selection) return profile;
  const descriptor = providerSelectionDescriptor(selection);
  const config = {
    ...(profile.config || {}),
    model: document.getElementById('model')?.value.trim() || ''
  };
  if (descriptor.providerId === 'openai-compatible') {
    config.supportsVision = document.getElementById('supportsVision')?.checked === true;
  }
  return { ...profile, providerId: descriptor.providerId, config };
}

function effectiveTaskProfile(policy) {
  if (policy.mode === 'local') return { profileId: null, profile: null };
  const globalId = document.getElementById('globalProfileId')?.value ||
    state?.settings?.globalProfileId || '';
  const profileId = policy.mode === 'profile' ? policy.profileId : globalId;
  return { profileId, profile: profileForTaskPolicy(profileId) };
}

function profileSupportsTaskDefinition(profile, definition) {
  if (!profile || !definition) return false;
  if (typeof globalThis.SciLLM?.providerSupportsTask === 'function' &&
      !globalThis.SciLLM.providerSupportsTask(profile.providerId, definition.id)) {
    return false;
  }
  if (definition.requirements?.typedDecisions !== true) return true;
  const capabilities = typeof globalThis.SciLLM?.getProviderCapabilities === 'function'
    ? globalThis.SciLLM.getProviderCapabilities(profile.providerId, profile.config || {})
    : {};
  if (capabilities.typedDecisions !== true) return false;
  const decisionType = String(definition.requirements?.decisionType || '');
  return !decisionType || (
    Array.isArray(capabilities.decisionTypes) &&
    capabilities.decisionTypes.includes(decisionType)
  );
}

function taskPolicyStatus(definition, policy) {
  if (policy.mode === 'local') return { key: 'local', label: interfaceText('浏览器本地翻译（可用性在使用时检查）') };
  const { profile } = effectiveTaskProfile(policy);
  if (!profile || !String(profile.config?.model || profile.model || '').trim()) {
    return { key: 'missing', label: interfaceText('缺少模型') };
  }
  if (!profileSupportsTaskDefinition(profile, definition)) {
    return { key: 'mismatch', label: interfaceText('能力不匹配') };
  }
  if (definition.requirements?.vision === true &&
      definition.requirements?.captionContext !== true &&
      !providerVisionCapability(profile.providerId, profile.config || {})) {
    return { key: 'mismatch', label: interfaceText('能力不匹配') };
  }
  return { key: 'available', label: interfaceText('支持此输入') };
}

function appendTaskProfileOption(select, definition, profileId, profile, label) {
  const option = document.createElement('option');
  const visionRequired = definition.requirements?.vision === true &&
    definition.requirements?.captionContext !== true;
  const profileSupportsVision = providerVisionCapability(
    profile?.providerId,
    profile?.config || {}
  );
  const supportsTask = profileSupportsTaskDefinition(profile, definition);
  option.value = profileId;
  option.textContent = label || profileOptionLabel(profile);
  option.disabled = !supportsTask || (visionRequired && !profileSupportsVision);
  if (!supportsTask) {
    option.textContent += ` · ${interfaceText('不支持此类文本判定')}`;
  }
  else if (option.disabled) option.textContent += ` · ${interfaceText('不支持图片')}`;
  else if (definition.requirements?.captionContext === true && !profileSupportsVision) {
    option.textContent += ` · ${interfaceText('正文与图注解读')}`;
  }
  select.appendChild(option);
}

function createTaskReasoningControls(definition, policy, profile) {
  const copy = taskPolicyUiText(definition);
  const capability = profile && typeof SciLLM.getProviderReasoningCapabilities === 'function'
    ? SciLLM.getProviderReasoningCapabilities(profile.providerId, profile.config || {})
    : { supported: false, mode: 'none', levels: [] };
  const normalized = profile && typeof SciLLM.normalizeReasoningForProvider === 'function'
    ? SciLLM.normalizeReasoningForProvider(profile.providerId, profile.config || {}, {
      enabled: true, effort: policy.reasoningEffort
    })
    : { enabled: false, effort: 'auto' };
  const supportedEfforts = new Set(['auto', ...(capability.levels || [])]
    .filter(effort => TASK_REASONING_EFFORTS.includes(effort)));
  const reasoningToggle = document.createElement('input');
  reasoningToggle.type = 'checkbox';
  reasoningToggle.dataset.taskPolicyReasoning = definition.id;
  reasoningToggle.setAttribute('aria-label', copy.reasoningAria);
  reasoningToggle.checked = capability.supported === true && policy.reasoningEnabled === true;
  reasoningToggle.disabled = capability.supported !== true;

  const effortSelect = document.createElement('select');
  effortSelect.dataset.taskPolicyEffort = definition.id;
  effortSelect.setAttribute('aria-label', copy.effortAria);
  TASK_REASONING_EFFORTS.forEach(effort => {
    const option = document.createElement('option');
    option.value = effort;
    option.textContent = interfaceText(TASK_REASONING_LABELS[effort]);
    option.disabled = !supportedEfforts.has(effort);
    effortSelect.appendChild(option);
  });
  const normalizedEffort = TASK_REASONING_EFFORTS.includes(normalized.effort)
    ? normalized.effort : 'auto';
  effortSelect.value = supportedEfforts.has(normalizedEffort)
    ? normalizedEffort : 'auto';
  effortSelect.disabled = !reasoningToggle.checked || capability.supported !== true ||
    capability.mode === 'toggle';
  effortSelect.title = capability.supported === true
    ? (capability.mode === 'toggle'
      ? interfaceText('当前模型仅支持推理开关，不支持强度分级。')
      : interfaceText('不可选强度会由服务商规则归一到最接近的级别。'))
    : interfaceText('当前模型不支持可配置推理。');
  return { reasoningToggle, effortSelect };
}

function tokenRuleButtonLabel(rule) {
  return interfaceText(rule === 'auto' ? '自动' : '自定义');
}

function renderTaskPolicyTable() {
  const body = document.getElementById('llmTaskPolicyTableBody');
  const advancedBody = document.getElementById('llmAdvancedTaskPolicyTableBody');
  const globalSelect = document.getElementById('globalProfileId');
  if (!body || !globalSelect || !state?.settings) return;
  const entries = profileEntries();
  const currentGlobal = globalSelect.value || state.settings.globalProfileId || entries[0]?.[0] || '';
  globalSelect.replaceChildren();
  entries.forEach(([profileId, profile]) => {
    const effectiveProfile = profileForTaskPolicy(profileId) || profile;
    const option = document.createElement('option');
    option.value = profileId;
    option.textContent = profileOptionLabel(effectiveProfile);
    option.disabled = typeof SciLLM.providerSupportsTask === 'function' &&
      !SciLLM.providerSupportsTask(effectiveProfile?.providerId, 'article_chat');
    if (option.disabled) {
      option.textContent += ` · ${interfaceText('仅支持文献高亮与语义查找')}`;
    }
    globalSelect.appendChild(option);
  });
  globalSelect.value = entries.some(([profileId]) => profileId === currentGlobal)
    ? currentGlobal : entries[0]?.[0] || '';

  body.replaceChildren();
  advancedBody?.replaceChildren();
  const moduleHost = document.getElementById('taskPolicyModules');
  const moduleBodies = new Map();
  if (moduleHost) {
    const closed = new Set([...moduleHost.querySelectorAll('details')].filter(item => !item.open).map(item => item.dataset.taskModule));
    moduleHost.replaceChildren();
    TASK_POLICY_MODULES.forEach(module => {
      const section = document.createElement('details');
      section.className = 'settings-disclosure task-policy-module';
      section.dataset.taskModule = module.id;
      section.open = !closed.has(module.id);
      const heading = document.createElement('summary');
      heading.textContent = interfaceText(module.label);
      const wrap = document.createElement('div');
      wrap.className = 'task-policy-table-wrap'; wrap.tabIndex = 0;
      wrap.setAttribute('aria-label', interfaceText(module.label));
      const table = document.createElement('table'); table.className = 'task-policy-table';
      const head = document.createElement('thead'); const headerRow = document.createElement('tr');
      ['功能', '模型选择', '推理', '推理强度', 'Token 规则', '编辑预览'].forEach(label => {
        const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = interfaceText(label); headerRow.appendChild(cell);
      });
      head.appendChild(headerRow);
      const moduleBody = document.createElement('tbody');
      module.tasks.forEach(id => moduleBodies.set(id, moduleBody));
      table.append(head, moduleBody); wrap.appendChild(table); section.append(heading, wrap); moduleHost.appendChild(section);
    });
  }
  SciLLM.TASK_DEFINITIONS.forEach(definition => {
    const copy = taskPolicyUiText(definition);
    const policy = taskPolicyDraft(definition.id);
    const row = document.createElement('tr');
    row.dataset.taskPolicyId = definition.id;

    const featureCell = document.createElement('th');
    featureCell.scope = 'row';
    const featureName = document.createElement('strong');
    featureName.textContent = copy.label;
    featureCell.appendChild(featureName);
    if (definition.requirements?.vision === true) {
      const requirement = document.createElement('small');
      requirement.textContent = copy.visionRequirement;
      featureCell.appendChild(requirement);
    }

    const modelCell = document.createElement('td');
    const profileSelect = document.createElement('select');
    profileSelect.dataset.taskPolicyProfile = definition.id;
    profileSelect.setAttribute('aria-label', copy.modelAria);
    const translation = TRANSLATION_TASK_POLICY_IDS.has(definition.id);
    if (translation) {
      const localOption = document.createElement('option');
      localOption.value = '__local_translation__';
      localOption.textContent = interfaceText('浏览器本地翻译');
      profileSelect.appendChild(localOption);
    }
    const globalProfile = profileForTaskPolicy(globalSelect.value);
    appendTaskProfileOption(
      profileSelect, definition, '', globalProfile,
      `${interfaceText('使用全局默认')} · ${globalProfile ? profileOptionLabel(globalProfile) : interfaceText('未配置')}`
    );
    entries.forEach(([profileId, profile]) => appendTaskProfileOption(
      profileSelect, definition, profileId,
      profileForTaskPolicy(profileId) || profile
    ));
    if (translation && policy.mode === 'profile' && !profileById(policy.profileId)) {
      const missing = document.createElement('option'); missing.value = policy.profileId || '__missing_translation_profile__';
      missing.textContent = interfaceText('专用配置已失效；请选择配置'); profileSelect.appendChild(missing);
    }
    profileSelect.value = policy.mode === 'local' ? '__local_translation__' : policy.mode === 'profile' ? policy.profileId || '__missing_translation_profile__' : '';
    modelCell.appendChild(profileSelect);

    const { profile } = effectiveTaskProfile(policy);
    const { reasoningToggle, effortSelect } = createTaskReasoningControls(
      definition, policy, profile
    );
    const reasoningCell = document.createElement('td');
    const reasoningLabel = document.createElement('label');
    reasoningLabel.className = 'task-policy-toggle';
    const reasoningText = document.createElement('span');
    reasoningText.textContent = interfaceText(reasoningToggle.checked ? '开启' : '关闭');
    reasoningLabel.append(reasoningToggle, reasoningText);
    reasoningCell.appendChild(reasoningLabel);
    const effortCell = document.createElement('td');
    effortCell.appendChild(effortSelect);

    const tokenCell = document.createElement('td');
    const tokenButton = document.createElement('button');
    tokenButton.type = 'button';
    tokenButton.className = 'button quiet compact-button task-token-rule-button';
    tokenButton.dataset.editTaskTokenRule = definition.id;
    tokenButton.textContent = tokenRuleButtonLabel(policy.tokenRule);
    tokenButton.setAttribute('aria-label', copy.tokenAria);
    tokenCell.appendChild(tokenButton);

    const statusCell = document.createElement('td');
    const status = taskPolicyStatus(definition, policy);
    const statusLabel = document.createElement('span');
    statusLabel.className = `task-policy-status is-${status.key}`;
    statusLabel.dataset.taskPolicyStatus = definition.id;
    statusLabel.textContent = status.label;
    statusCell.appendChild(statusLabel);

    row.append(featureCell, modelCell, reasoningCell, effortCell, tokenCell, statusCell);
    if (moduleBodies.has(definition.id)) {
      moduleBodies.get(definition.id).appendChild(row);
    } else if (advancedBody && !COMMON_TASK_POLICY_IDS.has(definition.id)) {
      advancedBody.appendChild(row);
    } else {
      body.appendChild(row);
    }
  });
  if (profileMutationInFlight) setProfileMutationPending(true);
}

function handleTaskPolicyTableChange(event) {
  const target = event.target;
  const taskId = target.dataset.taskPolicyProfile ||
    target.dataset.taskPolicyReasoning || target.dataset.taskPolicyEffort;
  if (!taskId || !SciLLM.LLM_TASK_IDS.includes(taskId)) return;
  const policy = taskPolicyDraft(taskId);
  if (target.dataset.taskPolicyProfile) {
    policy.mode = TRANSLATION_TASK_POLICY_IDS.has(taskId) && target.value === '__local_translation__' ? 'local' : target.value ? 'profile' : 'global';
    policy.profileId = policy.mode === 'profile' ? target.value : null;
  } else if (target.dataset.taskPolicyReasoning) {
    policy.reasoningEnabled = target.checked === true;
    const rowEffort = target.closest('tr')?.querySelector('[data-task-policy-effort]');
    if (rowEffort?.value) policy.reasoningEffort = rowEffort.value;
  } else if (target.dataset.taskPolicyEffort) {
    policy.reasoningEffort = TASK_REASONING_EFFORTS.includes(target.value)
      ? target.value : 'auto';
  }
  markProfileEditorDirty(event);
  renderTaskPolicyTable();
}

function handleTaskPolicyTableClick(event) {
  const button = event.target.closest('[data-edit-task-token-rule]');
  if (!button) return;
  openTaskTokenRuleDialog(button.dataset.editTaskTokenRule);
}

function defaultTaskTokenRule(taskId) {
  return SciLLM.normalizeTaskTokenRule(taskId, { input: {}, output: {} });
}

function setTaskTokenRuleDialogValues(rule) {
  const normalized = rule === 'auto' ? defaultTaskTokenRule(activeTaskTokenRuleId) : rule;
  document.querySelectorAll('[data-token-rule-field]').forEach(input => {
    const field = input.dataset.tokenRuleField;
    const spec = TOKEN_RULE_FIELD_SPECS[field];
    const value = normalized?.[spec.section]?.[field];
    input.value = value === null || value === undefined ? '' : String(value);
  });
}

function renderTaskTokenCopyTargets() {
  const container = document.getElementById('taskTokenCopyTargets');
  container.replaceChildren();
  SciLLM.TASK_DEFINITIONS.filter(definition => definition.id !== activeTaskTokenRuleId)
    .forEach(definition => {
      const copy = taskPolicyUiText(definition);
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = definition.id;
      checkbox.dataset.taskTokenCopyTarget = definition.id;
      label.append(checkbox, document.createTextNode(copy.label));
      container.appendChild(label);
    });
}

function openTaskTokenRuleDialog(taskId) {
  if (!SciLLM.LLM_TASK_IDS.includes(taskId)) return;
  activeTaskTokenRuleId = taskId;
  const definition = SciLLM.getLlmTaskDefinition(taskId);
  const copy = taskPolicyUiText(definition);
  const policy = taskPolicyDraft(taskId);
  const dialog = document.getElementById('taskTokenRuleDialog');
  dialog.dataset.ruleMode = policy.tokenRule === 'auto' ? 'auto' : 'task';
  document.getElementById('taskTokenRuleDialogTask').textContent = copy.dialogPreview;
  document.getElementById('taskTokenRuleError').hidden = true;
  setTaskTokenRuleDialogValues(policy.tokenRule);
  renderTaskTokenCopyTargets();
  updateTaskTokenRulePreview();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function validateTaskTokenRuleDraft() {
  const rule = { input: {}, output: {} };
  for (const input of document.querySelectorAll('[data-token-rule-field]')) {
    const field = input.dataset.tokenRuleField;
    const spec = TOKEN_RULE_FIELD_SPECS[field];
    const raw = String(input.value || '').trim();
    if (!raw && spec.optional) {
      rule[spec.section][field] = null;
      continue;
    }
    if (!raw) {
      return {
        valid: false,
        error: `${input.closest('label')?.querySelector('span')?.textContent || field}` +
          interfaceText('不能为空。')
      };
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < spec.minimum || value > spec.maximum ||
        (spec.integer && !Number.isInteger(value))) {
      return {
        valid: false,
        error: `${input.closest('label')?.querySelector('span')?.textContent || field}` +
          interfaceText('超出允许范围。')
      };
    }
    rule[spec.section][field] = value;
  }
  const floor = rule.output.floor;
  const ceiling = rule.output.ceiling;
  if (floor > ceiling) {
    return { valid: false, error: interfaceText('最低 Token 不能高于最高 Token。') };
  }
  return { valid: true, rule: SciLLM.normalizeTaskTokenRule(activeTaskTokenRuleId, rule) };
}

function taskTokenPreviewCapacity(taskId) {
  const policy = taskPolicyDraft(taskId);
  const { profile } = effectiveTaskProfile(policy);
  if (!profile) return { contextWindowTokens: 32768, maxOutputTokens: 32768 };
  return {
    contextWindowTokens: SciLLM.getProviderContextWindowTokens(
      profile.providerId, profile.config || {}, profile.contextWindowTokens
    ),
    maxOutputTokens: SciLLM.getProviderMaxOutputTokens(
      profile.providerId, profile.config || {}
    )
  };
}

function updateTaskTokenRulePreview() {
  if (!activeTaskTokenRuleId) return;
  const dialog = document.getElementById('taskTokenRuleDialog');
  const validation = validateTaskTokenRuleDraft();
  const error = document.getElementById('taskTokenRuleError');
  if (!validation.valid) {
    error.hidden = false;
    error.textContent = validation.error;
    document.getElementById('taskTokenInputPreview').textContent = '—';
    document.getElementById('taskTokenOutputPreview').textContent = '—';
    return;
  }
  error.hidden = true;
  error.textContent = '';
  const taskRule = dialog.dataset.ruleMode === 'auto' ? null : validation.rule;
  const capacity = taskTokenPreviewCapacity(activeTaskTokenRuleId);
  const output = SciLLM.computeOutputTokenBudget(activeTaskTokenRuleId, {
    taskRule, units: 1, adapterCap: capacity.maxOutputTokens
  });
  const input = SciLLM.computeInputTokenBudget({
    contextWindowTokens: capacity.contextWindowTokens,
    outputTokens: output.initial,
    taskRule
  });
  document.getElementById('taskTokenInputPreview').textContent =
    `${input.available.toLocaleString()} Token`;
  document.getElementById('taskTokenOutputPreview').textContent =
    output.initial === output.ceiling
      ? `${output.initial.toLocaleString()} Token`
      : `${output.initial.toLocaleString()}–${output.ceiling.toLocaleString()} Token`;
}

function handleTaskTokenRuleInput(event) {
  if (!event.target.matches('[data-token-rule-field]')) return;
  document.getElementById('taskTokenRuleDialog').dataset.ruleMode = 'task';
  updateTaskTokenRulePreview();
}

function resetTaskTokenRule() {
  if (!activeTaskTokenRuleId) return;
  document.getElementById('taskTokenRuleDialog').dataset.ruleMode = 'auto';
  setTaskTokenRuleDialogValues('auto');
  updateTaskTokenRulePreview();
}

function currentDialogTaskTokenRule() {
  const validation = validateTaskTokenRuleDraft();
  if (!validation.valid) return validation;
  return {
    valid: true,
    rule: document.getElementById('taskTokenRuleDialog').dataset.ruleMode === 'auto'
      ? 'auto' : validation.rule
  };
}

function copyTaskTokenRuleToSelectedTasks() {
  const current = currentDialogTaskTokenRule();
  if (!current.valid) {
    updateTaskTokenRulePreview();
    return;
  }
  const targets = [...document.querySelectorAll('[data-task-token-copy-target]:checked')]
    .map(input => input.value)
    .filter(taskId => SciLLM.LLM_TASK_IDS.includes(taskId));
  targets.forEach(taskId => {
    taskPolicyDraft(taskId).tokenRule = current.rule === 'auto'
      ? 'auto'
      : cloneTaskTokenRule(SciLLM.normalizeTaskTokenRule(taskId, current.rule));
  });
  if (targets.length) {
    markProfileEditorDirty({ target: { id: 'copyTaskTokenRule' } });
    renderTaskPolicyTable();
    showStatus(interfaceText('Token 规则已复制到 {count} 项功能，保存设置后生效。')
      .replace('{count}', String(targets.length)), 'info');
  }
}

function applyTaskTokenRule(event) {
  event.preventDefault();
  const current = currentDialogTaskTokenRule();
  if (!current.valid) {
    updateTaskTokenRulePreview();
    return;
  }
  taskPolicyDraft(activeTaskTokenRuleId).tokenRule = cloneTaskTokenRule(current.rule);
  markProfileEditorDirty({ target: { id: 'taskTokenRuleDialog' } });
  closeTaskTokenRuleDialog();
  renderTaskPolicyTable();
}

function closeTaskTokenRuleDialog() {
  const dialog = document.getElementById('taskTokenRuleDialog');
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
  clearActiveTaskTokenRuleId();
}

function clearActiveTaskTokenRuleId() {
  activeTaskTokenRuleId = '';
}

function snapshotTaskPolicyDrafts() {
  return new Map([...taskPolicyDrafts].map(([taskId, policy]) => [taskId, {
    ...policy,
    tokenRule: cloneTaskTokenRule(policy.tokenRule)
  }]));
}

function restoreTaskPolicyDrafts(snapshot) {
  if (!(snapshot instanceof Map)) return;
  taskPolicyDrafts.clear();
  snapshot.forEach((policy, taskId) => {
    taskPolicyDrafts.set(taskId, {
      ...policy,
      tokenRule: cloneTaskTokenRule(policy.tokenRule)
    });
  });
}

function collectProfile() {
  const current = profileById(selectedProfileId);
  if (!current) throw new Error(MISSING_PROFILE_DRAFT_MESSAGE);
  const descriptor = providerSelectionDescriptor();
  const providerId = descriptor.providerId;
  const config = { ...(current.config || {}) };
  delete config.apiKey;
  delete config.hasApiKey;
  delete config.apiKeyMask;
  delete config.customHeaderNames;
  config.model = document.getElementById('model').value.trim();
  const enteredKey = document.getElementById('apiKey').value
    .replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (enteredKey) config.apiKey = enteredKey;
  if (providerId === 'openai-compatible') {
    config.presetId = descriptor.presetId ||
      document.getElementById('compatiblePreset').value || 'custom';
    config.baseUrl = document.getElementById('baseUrl').value.trim();
    config.authHeader = document.getElementById('authHeader').value.trim() || 'Authorization';
    config.authPrefix = document.getElementById('authPrefix').value.trim();
    config.jsonMode = document.getElementById('jsonMode').checked;
    config.supportsVision = document.getElementById('supportsVision').checked;
  } else if (['codex-local', 'deepseek-harness'].includes(providerId)) {
    delete config.apiKey;
    delete config.baseUrl;
    delete config.supportsVision;
  } else {
    delete config.supportsVision;
  }
  if (providerId !== 'openai-compatible') {
    ['baseUrl', 'presetId', 'authHeader', 'authPrefix', 'jsonMode',
      'customHeaders', 'customHeaderNames', 'reasoningMode']
      .forEach(key => { delete config[key]; });
  }
  if (providerId !== 'deepseek') delete config.thinking;
  const reasoningCapability = typeof SciLLM.getProviderReasoningCapabilities === 'function'
    ? SciLLM.getProviderReasoningCapabilities(providerId, config) : { supported: false };
  if (reasoningCapability.supported) {
    config.reasoningEffort = document.getElementById('reasoningEffort').value ||
      reasoningCapability.defaultLevel || 'auto';
    if (providerId === 'deepseek') {
      if (config.reasoningEffort === 'auto') delete config.thinking;
      else config.thinking = config.reasoningEffort === 'enabled';
    }
  } else {
    delete config.reasoningEffort;
  }
  const contextWindowValue = document.getElementById('contextWindowTokens').value;
  return {
    id: selectedProfileId,
    name: document.getElementById('profileName').value.trim(),
    providerId,
    config,
    capabilities: { vision: providerVisionCapability(providerId, config) },
    contextWindowTokens: contextWindowValue ? Number(contextWindowValue) : null,
    tokenPolicy: { mode: 'auto', autoCap: null, manualMax: null }
  };
}

function collectTaskPolicies() {
  return Object.fromEntries(SciLLM.LLM_TASK_IDS.map(taskId => {
    const policy = taskPolicyDraft(taskId);
    const { profile } = effectiveTaskProfile(policy);
    const capability = profile && typeof SciLLM.getProviderReasoningCapabilities === 'function'
      ? SciLLM.getProviderReasoningCapabilities(profile.providerId, profile.config || {})
      : { supported: false };
    const normalizedReasoning = profile &&
      typeof SciLLM.normalizeReasoningForProvider === 'function'
      ? SciLLM.normalizeReasoningForProvider(profile.providerId, profile.config || {}, {
        enabled: capability.supported === true && policy.reasoningEnabled === true,
        effort: policy.reasoningEffort
      })
      : { enabled: false, effort: 'auto' };
    return [taskId, {
      mode: TRANSLATION_TASK_POLICY_IDS.has(taskId) && policy.mode === 'local' ? 'local' : policy.mode === 'profile' ? 'profile' : 'global',
      profileId: policy.mode === 'profile' ? policy.profileId : null,
      reasoningEnabled: normalizedReasoning.enabled === true,
      reasoningEffort: TASK_REASONING_EFFORTS.includes(normalizedReasoning.effort)
        ? normalizedReasoning.effort : 'auto',
      tokenRule: cloneTaskTokenRule(policy.tokenRule),
      allowTextFallback: SciLLM.getLlmTaskDefinition(taskId).requirements?.vision === true &&
        policy.allowTextFallback === true
    }];
  }));
}

async function addApiProfile() {
  if (!canLeaveProfileEditor('新增')) return;
  if (!beginProfileMutation()) return;
  setProfileMutationPending(true);
  const providerId = Object.keys(state?.providers || {})[0] || 'openai';
  const baseId = `profile_new_${Date.now().toString(36)}`;
  const vision = providerVisionCapability(providerId, {});
  try {
    const result = await callBackground({
      type: 'LLM_SAVE_PROFILE',
      profile: { id: baseId, name: '新 Profile', providerId,
        config: { model: state.providers?.[providerId]?.defaultModel || '' },
        capabilities: { vision },
        tokenPolicy: { mode: 'auto', autoCap: null, manualMax: null } }
    });
    selectedProfileId = result.profile?.id || baseId;
    applyState(result);
    clearProfileEditorDirty(['profile', 'routing']);
    showStatus('API Profile 已新增。', 'success');
  } catch (error) {
    showStatus(`新增 Profile 失败：${friendlyError(error)}`, 'error');
  } finally {
    endProfileMutation();
    setProfileMutationPending(false);
  }
}

async function duplicateApiProfile() {
  if (!selectedProfileId) return;
  if (!canLeaveProfileEditor('复制')) return;
  if (!beginProfileMutation()) return;
  setProfileMutationPending(true);
  try {
    const result = await callBackground({ type: 'LLM_DUPLICATE_PROFILE', profileId: selectedProfileId });
    selectedProfileId = result.profile?.id || selectedProfileId;
    applyState(result);
    clearProfileEditorDirty(['profile', 'routing']);
    showStatus('API Profile 已复制。', 'success');
  } catch (error) {
    showStatus(`复制 Profile 失败：${friendlyError(error)}`, 'error');
  } finally {
    endProfileMutation();
    setProfileMutationPending(false);
  }
}

async function deleteApiProfile() {
  if (!selectedProfileId) return;
  if (!canLeaveProfileEditor('删除')) return;
  if (!beginProfileMutation()) return;
  setProfileMutationPending(true);
  try {
    const result = await callBackground({ type: 'LLM_DELETE_PROFILE', profileId: selectedProfileId });
    selectedProfileId = result.settings?.globalProfileId || '';
    applyState(result, { replaceTaskPolicyDrafts: true });
    clearProfileEditorDirty(['profile', 'routing']);
    showStatus('API Profile 已删除。', 'success');
  } catch (error) {
    showStatus(`删除 Profile 失败：${friendlyError(error)}`, 'error');
  } finally {
    endProfileMutation();
    setProfileMutationPending(false);
  }
}

async function persistForm(silent) {
  if (selectedProfileId && !profileById(selectedProfileId)) {
    showStatus(MISSING_PROFILE_DRAFT_MESSAGE, 'error');
    return null;
  }
  if (!beginProfileAction('save')) return null;
  if (typeof retireProviderModelDiscovery === 'function') retireProviderModelDiscovery(new Set([selectedProfileId]));
  const draftSnapshot = snapshotSettingsDrafts();
  const taskPolicyDraftSnapshot = snapshotTaskPolicyDrafts();
  let globalProfileIdSnapshot = '';
  const buttons = [...document.querySelectorAll('.button')];
  const previousDisabledStates = new Map(
    buttons.map(button => [button, button.disabled === true])
  );
  buttons.forEach(button => { button.disabled = true; });
  try {
    const profile = collectProfile();
    const previous = profileById(profile.id);
    const firstConfiguration = ['codex-local', 'deepseek-harness'].includes(profile.providerId)
      ? previous?.providerId !== profile.providerId
      : !previous?.config?.hasApiKey && Boolean(profile.config.apiKey);
    const consentGranted = document.getElementById('consentGranted').checked;
    const preferredMode = firstConfiguration && consentGranted
      ? 'llm' : document.getElementById('analysisMode').value;
    const globalProfileId = document.getElementById('globalProfileId').value;
    globalProfileIdSnapshot = globalProfileId;
    const taskPolicies = collectTaskPolicies();
    const figurePanelFollowupPresets = collectPanelFollowupPresets();
    const figurePanelFollowupPrompts =
      panelFollowupPromptMap(figurePanelFollowupPresets);
    const articleChatQuickPrompts = collectArticleChatQuickPrompts();
    const literatureNoteTemplates = collectLiteratureNoteTemplates();
    const selectionLlmActions = collectSelectionLlmActions();
    // Freeze every user-edited value before the first asynchronous save.
    // applyState() re-renders the form after saving the Profile and must not
    // replace a preference changed in the same click with its previous value.
    const preferences = {
      mode: preferredMode,
      autoAnalyze: document.getElementById('autoAnalyze').checked,
      autoCacheFigureImages: document.getElementById('autoCacheFigureImages').checked,
      saveArticleWebSnapshot: document.getElementById('saveArticleWebSnapshot').checked,
      consentGranted,
      figurePanelFollowupPrompts,
      figurePanelFollowupPresets,
      articleChatQuickPrompts,
      literatureNoteTemplates,
      selectionLlmActions
    };
    await requestEndpointPermission(profile.providerId, profile.config);
    if (!profileById(profile.id)) {
      showStatus(MISSING_PROFILE_DRAFT_MESSAGE, 'error');
      return null;
    }
    const saved = await callBackground({ type: 'LLM_SAVE_PROFILE', profile });
    if (selectedProfileId === profile.id) selectedProfileId = saved.profile?.id || profile.id;
    applyState(saved);
    const routed = await callBackground({
      type: 'LLM_UPDATE_PROFILE_ROUTING',
      globalProfileId,
      taskPolicies
    });
    applyState(routed);
    const updated = await callBackground({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences
    });
    const routingUnchanged = settingsDraftScopeUnchanged(draftSnapshot, 'routing');
    acknowledgeSettingsDrafts(draftSnapshot);
    applyState(updated, { replaceTaskPolicyDrafts: routingUnchanged });
    if (typeof renderProviderWorkflow === 'function') renderProviderWorkflow();
    if (onboardingUi.active && hasUsableApiConfiguration()) {
      await setOnboardingStepState('api', 'completed');
    }
    if (!silent) showStatus(profileEditorDirty
      ? '已保存提交的设置；当前仍有未保存修改。'
      : (hasUsableApiConfiguration()
        ? '模型与路由设置已保存。'
        : '配置已保存；请确认正文发送许可和模型连接状态。'),
    !profileEditorDirty && hasUsableApiConfiguration() ? 'success' : 'info');
    return { profileId: saved.profile?.id || profile.id };
  } catch (error) {
    if (settingsDraftScopeUnchanged(draftSnapshot, 'routing')) {
      restoreTaskPolicyDrafts(taskPolicyDraftSnapshot);
      const globalSelect = document.getElementById('globalProfileId');
      if (globalSelect && globalProfileIdSnapshot) globalSelect.value = globalProfileIdSnapshot;
    }
    markProfileEditorDirty('llmTaskPolicyTableBody');
    renderTaskPolicyTable();
    showStatus(`保存失败：${friendlyError(error)}`, 'error');
    throw error;
  } finally {
    endProfileAction('save');
    buttons.forEach(button => {
      button.disabled = previousDisabledStates.get(button) === true;
    });
    updateUserDataActionButtons();
    renderOnboarding();
  }
}

async function testProvider() {
  let singleProbeId = arguments[0] || '';
  if (typeof singleProbeId !== 'string') singleProbeId = '';
  if (singleProbeId && !['connectivity', 'plain_json', 'structured_schema', 'vision_input', 'json_output', 'reasoning_structured'].includes(singleProbeId)) return;
  if (!beginProfileAction('test')) return;
  if (typeof retireProviderModelDiscovery === 'function') retireProviderModelDiscovery(new Set([selectedProfileId]));
  let testedProfileId = '';
  let verification = null;
  let progressFeedback = null;
  let progressObserver = null;
  let progressInterrupted = false;
  const ownsProgressFeedback = () => {
    if (!progressFeedback) return true; // Non-DOM callers have no shared status to own.
    if (progressObserver?.takeRecords().length) progressInterrupted = true;
    return !progressInterrupted && selectedProfileId === testedProfileId &&
      (typeof providerVerificationResults === 'undefined' ||
        providerVerificationResults.get(testedProfileId) === verification) &&
      progressFeedback.element.__brevessProbeFeedback === progressFeedback &&
      progressFeedback.element.textContent === progressFeedback.text &&
      progressFeedback.element.className === progressFeedback.className;
  };
  const controls = [...document.querySelectorAll(
    '#providerSettings input, #providerSettings select, ' +
    '#providerSettings textarea, #providerSettings button'
  )];
  const previousDisabledStates = new Map(
    controls.map(control => [control, control.disabled === true])
  );
  const section = document.getElementById('providerSettings');
  const testButton = document.getElementById('testProvider');
  controls.forEach(control => { control.disabled = true; });
  section?.setAttribute('aria-busy', 'true');
  testButton?.setAttribute('aria-busy', 'true');
  try {
    const priorVerification = singleProbeId ? providerVerificationResults.get(selectedProfileId) : null;
    const priorResult = priorVerification && providerVerificationIsCurrent(selectedProfileId, priorVerification) ? priorVerification.result : null;
    // A clean single-item retest targets the already saved configuration.
    // Saving again would retire its receipt even when public masks look equal.
    const cleanSingleRetest = singleProbeId && priorResult &&
      typeof profileEditorDirty === 'boolean' && profileEditorDirty === false;
    const saved = cleanSingleRetest ? { profileId: selectedProfileId } : await persistForm(true);
    if (!saved) return;
    const { profileId } = saved;
    testedProfileId = profileId;
    const savedProfile = profileById(profileId);
    const supportsVision = providerVisionCapability(
      savedProfile?.providerId,
      savedProfile?.config || {}
    );
    const probeIds = singleProbeId ? [singleProbeId] : providerProbeIds(
      document.getElementById('testReasoningStructured')?.checked === true,
      supportsVision,
      { plainJson: document.getElementById('testPlainJson')?.checked === true,
        structuredSchema: document.getElementById('testStructuredSchema')?.checked === true }
    );
    const previousResult = singleProbeId && priorVerification &&
      providerVerificationResults.get(profileId) === priorVerification &&
      providerVerificationIsCurrent(profileId, priorVerification) && priorVerification?.providerId === savedProfile?.providerId && priorVerification?.model === String(savedProfile?.config?.model || '') ? priorResult : null;
    verification = { previousResult, providerId: savedProfile?.providerId, model: String(savedProfile?.config?.model || ''),
      pending: true, expired: false, probeIds };
    if (previousResult) verification.result = { ...previousResult, probes: previousResult.probes.filter(item => !probeIds.includes(item.id)) };
    if (typeof providerVerificationResults !== 'undefined') providerVerificationResults.set(profileId, verification);
    if (typeof renderProviderWorkflow === 'function') renderProviderWorkflow();
    const progressText = probeIds.includes('vision_input')
      ? '正在使用内置合成文本、微型 PNG 和 JSON Schema 测试；不会发送当前论文内容。'
      : probeIds.includes('reasoning_structured')
        ? '正在使用内置合成文本和 JSON Schema 测试；不会发送当前论文内容。'
        : probeIds.includes('plain_json') || probeIds.includes('structured_schema')
          ? '正在使用内置合成文本测试 JSON 与 Schema 能力；不会发送当前论文内容。'
        : '正在仅用内置合成文本测试连接；不会发送当前论文内容。';
    showStatus(interfaceText(progressText), 'info');
    const statusElement = document.getElementById('status');
    if (statusElement) {
      progressFeedback = { element: statusElement, text: statusElement.textContent,
        className: statusElement.className };
      statusElement.__brevessProbeFeedback = progressFeedback;
      if (typeof MutationObserver === 'function') {
        progressObserver = new MutationObserver(() => { progressInterrupted = true; });
        progressObserver.observe(statusElement, { childList: true, characterData: true,
          subtree: true, attributes: true, attributeFilter: ['class'] });
      }
    }
    const result = await callBackground({
      type: 'LLM_TEST_PROFILE', profileId, probeIds
    });
    const current = typeof providerVerificationIsCurrent !== 'function' || providerVerificationIsCurrent(profileId, verification);
    verification.pending = false;
    if (current) {
      const probes = (Array.isArray(result.probes) ? result.probes : []).map(item => ({ id: item.id, status: item.status, code: item.code, diagnosticType: item.diagnosticType, diagnosticStage: item.diagnosticStage }));
      const merged = [...(verification.previousResult?.probes || []).filter(item => !probeIds.includes(item.id)), ...probes];
      verification.result = { connectivity: merged.find(item => item.id === 'connectivity')?.status === 'passed' ? true : merged.some(item => item.id === 'connectivity') ? false : null,
        capabilitiesReady: merged.filter(item => item.id !== 'connectivity').length ? merged.filter(item => item.id !== 'connectivity').every(item => item.status === 'passed') : null,
        probes: merged };
    }
    const account = result.accountType
      ? `${result.accountType}${result.planType ? `/${result.planType}` : ''}` : '';
    const language = document.getElementById('globalLanguage')?.value || 'zh-CN';
    const presentationResult = singleProbeId && verification.result ? { ...result, ...verification.result, warnings: verification.result.probes.filter(item => item.id !== 'connectivity' && item.status === 'failed').map(item => ({ probeId: item.id })) } : result;
    const presentation = providerConnectionPresentation(presentationResult, account, language);
    if (current && ownsProgressFeedback() && (typeof providerVerificationResults === 'undefined' || selectedProfileId === testedProfileId)) showStatus(presentation.message, presentation.state);
  } catch (error) {
    const current = !verification || typeof providerVerificationIsCurrent !== 'function' || providerVerificationIsCurrent(testedProfileId, verification);
    if (verification) {
      verification.pending = false;
      if (current) {
        const code = /^[A-Z_]{2,64}$/.test(String(error.code || '')) ? error.code : 'CONNECTION_FAILED';
        verification.errorCode = code;
        if (verification.probeIds.includes(error.probeId)) {
          const probes = [...(verification.previousResult?.probes || []).filter(item => item.id !== error.probeId), { id: error.probeId, status: 'failed', code, diagnosticType: ['JSON_PARSE_FAILED', 'JSON_CONTRACT_MISMATCH', 'AbortError', 'HtmlResponse', 'JsonSyntaxError', 'SyntaxError', 'TimeoutError', 'TypeError'].includes(error.diagnosticType) ? error.diagnosticType : undefined }];
          verification.result = { connectivity: probes.find(item => item.id === 'connectivity')?.status === 'passed' ? true : null, capabilitiesReady: false, probes };
        }
      }
    }
    if (current && ownsProgressFeedback() && (!testedProfileId || typeof providerVerificationResults === 'undefined' || selectedProfileId === testedProfileId)) showStatus(`连接失败：${friendlyError(error)}`, 'error');
  } finally {
    try {
      const invalidated = verification && (verification.expired === true ||
        (typeof providerVerificationIsCurrent === 'function' &&
          !providerVerificationIsCurrent(testedProfileId, verification)));
      if (invalidated && progressFeedback && ownsProgressFeedback()) {
        const english = String(document.getElementById('globalLanguage')?.value || 'zh-CN')
          .toLowerCase().startsWith('en');
        showStatus(english
          ? 'Test finished; its result was not applied because the configuration changed. Retest the current configuration.'
          : '测试已结束；配置已变更，本次结果未应用。请对当前配置重新测试。', 'info');
      }
    } finally {
      progressObserver?.disconnect();
      if (progressFeedback?.element.__brevessProbeFeedback === progressFeedback) {
        delete progressFeedback.element.__brevessProbeFeedback;
      }
    }
    controls.forEach(control => {
      control.disabled = previousDisabledStates.get(control) === true;
    });
    section?.removeAttribute('aria-busy');
    testButton?.removeAttribute('aria-busy');
    endProfileAction('test');
    if (typeof renderProviderWorkflow === 'function') renderProviderWorkflow();
    renderOnboarding();
  }
}
