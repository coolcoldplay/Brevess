const OFFICIAL_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/responses',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  deepseek: 'https://api.deepseek.com/chat/completions'
};
const COMPATIBLE_PROVIDER_VALUE_PREFIX = 'compatible:';
const MODEL_DISCOVERY_CACHE_MS = 5 * 60 * 1000;

let state = null;
let selectedProfileId = '';
let profileEditorDirty = false;
const profileDirtyFields = new Set();
const discoveredModels = new Map();
let modelDiscoveryTimer = null;
let keyboardShortcutEditorDirty = false;
let analysisModeEditorDirty = false;
let analysisModeEditorModes = [];
let selectedAnalysisModeId = '';
const profileActionInFlight = Object.create(null);
let profileMutationInFlight = false;
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
  resolveDialog: null
};
const ARTICLE_WORKSPACE_PAGE_SIZE = 20;
const articleWorkspaceOverviewUi = {
  items: [],
  details: new Map(),
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
let pendingMigrationBundle = null;
const SETTINGS_PAGE_ORDER = ['categories', 'modes', 'models', 'shortcuts', 'data', 'about'];
const SETTINGS_PAGE_COPY = Object.freeze({
  categories: {
    eyebrow: 'Brevess · 规则工作区',
    title: '让每一种证据都有清楚的判定边界',
    subtitle: '新增、修改或删除类别，并分别维护 AI 提示词和离线正则规则。'
  },
  modes: {
    eyebrow: 'Analysis Modes · 分析组合',
    title: '按阅读任务组织全局类别规则',
    subtitle: '新增、重命名或删除分析模式，并直接勾选每个模式参与分析的类别。'
  },
  models: {
    eyebrow: 'Model Routing · 模型与分析',
    title: '集中管理模型、隐私许可与任务路由',
    subtitle: '把 API Profile、模型能力、全文分析方式和 Figure 任务配置放在同一页。'
  },
  shortcuts: {
    eyebrow: 'Keyboard · 快捷操作',
    title: '用顺手的按键控制论文阅读流程',
    subtitle: '统一设置导航、亮文、摘句、解图和问答等高频动作。'
  },
  data: {
    eyebrow: 'Local First · 本地数据',
    title: '管理论文工作区、备份与迁移',
    subtitle: '查看本地论文数据，配置目录同步，并导入或导出完整配置。'
  },
  about: {
    eyebrow: 'Project · 关于与反馈',
    title: '开源许可与问题反馈',
    subtitle: '查看源代码、第三方许可，并向维护者反馈问题或建议。'
  }
});
let activeSettingsPage = 'categories';
const USER_DATA_ACTION_IDS = [
  'chooseUserDataDirectory', 'reauthorizeUserDataDirectory',
  'syncUserDataNow', 'rebuildUserDataIndex', 'exportUserDataBundle',
  'exportMigrationBundle', 'unlockPortableConfig',
  'rotatePortableConfigPassphrase', 'forgetPortableConfigKey',
  'backupPortableConfigNow'
];

document.addEventListener('DOMContentLoaded', async () => {
  if (location.hash === '#onboarding') enterOnboardingLayout();
  bindEvents();
  activateSettingsPage(settingsPageFromHash(), { updateHash: false, animate: false });
  await refreshSettings();
  await loadCategoryFromHash();
  await refreshCorpusStatus();
  updateDirectoryFeatureSupport();
  await preloadUserDataDirectoryHandle();
  await refreshUserDataStatus();
  await refreshArticleWorkspaceOverview();
  await initializeOnboarding();
});

function bindEvents() {
  document.querySelectorAll('[data-settings-nav]').forEach(button => {
    button.addEventListener('click', () => {
      activateSettingsPage(button.dataset.settingsNav);
    });
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
    .addEventListener('change', event => {
      const modelId = String(event.currentTarget.value || '').trim();
      if (!modelId) return;
      const input = document.getElementById('model');
      input.value = modelId;
      markProfileEditorDirty({ target: { id: 'model' } });
      updateProfileListPreview();
    });
  document.getElementById('profileName').addEventListener('input', updateProfileListPreview);
  document.getElementById('profileName').addEventListener('blur', persistProfileName);
  document.getElementById('profileName').addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.currentTarget.blur();
  });
  document.getElementById('model').addEventListener('input', updateProfileListPreview);
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
  ['tokenModeAuto', 'tokenModeManual'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderTokenPolicyFields);
  });
  ['profileName', 'providerId', 'model', 'apiKey', 'baseUrl', 'authHeader', 'authPrefix',
    'jsonMode', 'supportsVision', 'tokenModeAuto', 'tokenModeManual', 'autoTokenCap',
    'manualMaxTokens', 'contextWindowTokens', 'codexReasoningEffort'].forEach(id => {
      document.getElementById(id).addEventListener('input', markProfileEditorDirty);
      document.getElementById(id).addEventListener('change', markProfileEditorDirty);
    });
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
  document.getElementById('analysisModeList').addEventListener('click', event => {
    const button = event.target.closest('[data-analysis-mode-id]');
    if (!button) return;
    syncAnalysisModeDraftFromEditor();
    selectedAnalysisModeId = button.dataset.analysisModeId;
    renderAnalysisModeEditor();
  });
  ['analysisModeName', 'analysisModeDescription'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      syncAnalysisModeDraftFromEditor();
      analysisModeEditorDirty = true;
      renderAnalysisModeList();
    });
  });
  document.getElementById('analysisModeCategoryList').addEventListener('change', () => {
    syncAnalysisModeDraftFromEditor();
    analysisModeEditorDirty = true;
    updateAnalysisModeCategoryCount();
  });
  document.getElementById('addAnalysisMode').addEventListener('click', addAnalysisMode);
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
    markProfileEditorDirty();
  });
  document.getElementById('addPanelFollowupPreset')
    .addEventListener('click', addPanelFollowupPreset);
  document.getElementById('panelFollowupPresetList').addEventListener('input', () => {
    markProfileEditorDirty();
  });
  document.getElementById('panelFollowupPresetList').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-panel-preset]');
    if (!button) return;
    button.closest('.named-prompt-row')?.remove();
    renderPanelFollowupPresetEmptyState();
    markProfileEditorDirty();
  });
  document.getElementById('addArticleChatQuickPrompt')
    .addEventListener('click', addArticleChatQuickPrompt);
  document.getElementById('resetArticleChatQuickPrompts').addEventListener('click', () => {
    renderArticleChatQuickPrompts(state?.articleChatQuickPromptDefaults || []);
    markProfileEditorDirty();
  });
  document.getElementById('articleChatQuickPromptList').addEventListener('input', () => {
    markProfileEditorDirty();
  });
  document.getElementById('articleChatQuickPromptList').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-quick-prompt]');
    if (!button) return;
    button.closest('.named-prompt-row')?.remove();
    renderArticleChatQuickPromptEmptyState();
    markProfileEditorDirty();
  });
  document.getElementById('testProvider').addEventListener('click', testProvider);
  document.getElementById('codexLogin').addEventListener('click', startCodexLogin);
  document.getElementById('codexRefreshStatus')
    .addEventListener('click', () => refreshCodexAuthStatus());
  document.getElementById('codexLogout').addEventListener('click', logoutCodex);
  ['globalProfileId', 'routeHighlight', 'routeSummary', 'routeFigure', 'routeCrossFigure']
    .forEach(id => document.getElementById(id).addEventListener('change', renderFigureRouteWarning));
  ['analysisMode', 'autoAnalyze', 'autoCacheFigureImages', 'consentGranted',
    'globalProfileId', 'routeHighlight',
    'routeSummary', 'routeFigure', 'routeCrossFigure'].forEach(id => {
      document.getElementById(id).addEventListener('change', markProfileEditorDirty);
    });
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
  document.getElementById('reauthorizeUserDataDirectory').addEventListener('click', reauthorizeUserDataDirectory);
  document.getElementById('syncUserDataNow').addEventListener('click', syncUserDataNow);
  document.getElementById('unlockPortableConfig').addEventListener('click', unlockPortableConfig);
  document.getElementById('rotatePortableConfigPassphrase').addEventListener('click', rotatePortableConfigPassphrase);
  document.getElementById('forgetPortableConfigKey').addEventListener('click', forgetPortableConfigKey);
  document.getElementById('backupPortableConfigNow').addEventListener('click', backupPortableConfigNow);
  document.getElementById('portableConfigForm').addEventListener('submit', submitPortableConfigDialog);
  document.getElementById('cancelPortableConfigDialog').addEventListener('click', cancelPortableConfigDialog);
  document.getElementById('portableConfigDialog').addEventListener('cancel', cancelPortableConfigDialog);
  document.getElementById('portableConfigDialog').addEventListener('close', clearPortableConfigDialogSecrets);
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
  document.getElementById('onboardingBack').addEventListener('click', () => {
    onboardingUi.step = 'storage';
    renderOnboarding();
  });
  document.getElementById('onboardingSkip').addEventListener('click', skipOnboardingStep);
  document.getElementById('onboardingContinue')
    .addEventListener('click', continueOnboarding);
  document.getElementById('onboardingFinish').addEventListener('click', finishOnboarding);
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
  window.addEventListener('beforeunload', stopCodexAuthPolling);
}

function settingsPageFromHash() {
  if (location.hash === '#onboarding') return activeSettingsPage;
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
    openSource: 'about',
    support: 'about'
  };
  return legacyPages[legacy] || 'categories';
}

function settingsPageHash(page) {
  if (page === 'categories' && categoryEditor.categoryId) {
    return categoryHash(categoryEditor.categoryId);
  }
  return `#page=${encodeURIComponent(page)}`;
}

function syncSettingsPageVisibility({ animate = false } = {}) {
  const onboardingSectionId = onboardingUi.step === 'api'
    ? 'providerSettings'
    : 'localData';
  document.querySelectorAll('[data-settings-page]').forEach(section => {
    const active = onboardingUi.active
      ? section.id === onboardingSectionId
      : section.dataset.settingsPage === activeSettingsPage;
    section.hidden = !active;
    section.classList.toggle(
      'is-active-page',
      active && !onboardingUi.active && animate
    );
  });
}

function activateSettingsPage(page, { updateHash = true, animate = true } = {}) {
  const nextPage = SETTINGS_PAGE_ORDER.includes(page) ? page : 'categories';
  const previousIndex = SETTINGS_PAGE_ORDER.indexOf(activeSettingsPage);
  const nextIndex = SETTINGS_PAGE_ORDER.indexOf(nextPage);
  document.body.dataset.settingsDirection =
    nextIndex < previousIndex ? 'backward' : 'forward';
  activeSettingsPage = nextPage;
  syncSettingsPageVisibility({ animate });
  document.querySelectorAll('[data-settings-nav]').forEach(button => {
    const active = button.dataset.settingsNav === nextPage;
    button.setAttribute('aria-selected', String(active));
  });
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
}

async function callBackground(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.success) {
    const error = new Error(response?.error?.message || '操作失败');
    error.code = response?.error?.code;
    error.fields = response?.error?.fields || [];
    error.retryable = response?.error?.retryable === true;
    if (Number.isFinite(response?.error?.status)) error.status = response.error.status;
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
  const guide = document.getElementById('onboardingGuide');
  if (guide) guide.hidden = false;
  syncSettingsPageVisibility();
}

function leaveOnboardingLayout() {
  onboardingUi.active = false;
  document.body.classList.remove('is-onboarding');
  delete document.body.dataset.onboardingStep;
  document.getElementById('onboardingGuide').hidden = true;
  syncSettingsPageVisibility();
}

function hasUsableApiConfiguration() {
  if (state?.settings?.consentGranted !== true) return false;
  return profileEntries().some(([, profile]) =>
    String(profile?.config?.model || '').trim() &&
      (profile?.providerId === 'codex-local' || profile?.config?.hasApiKey === true)
  );
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
  if (status === 'completed') return 'API 配置已保存，LLM 全文问答、图解和高亮可以使用。';
  if (status === 'skipped') return '已暂时跳过；导航、手动高亮和本地阅读功能仍可使用。';
  return '保存至少一个可用 API 配置并同意发送内容，或暂时跳过。';
}

function renderOnboarding() {
  const guide = document.getElementById('onboardingGuide');
  if (!guide) return;
  if (!onboardingUi.active) {
    leaveOnboardingLayout();
    return;
  }
  enterOnboardingLayout();
  const step = onboardingUi.step;
  const steps = onboardingUi.state?.steps || { storage: 'pending', api: 'pending' };
  const status = steps[step] || 'pending';
  document.body.dataset.onboardingStep = step;
  document.getElementById('onboardingStepTitle').textContent = step === 'storage'
    ? '选择本地保存目录' : '配置 LLM API';
  document.getElementById('onboardingStepDescription').textContent = step === 'storage'
    ? '插件会在你选择的位置建立 Brevess 文件夹，并为每篇网页保存独立工作区。跳过后仍使用浏览器 IndexedDB 自动保存。'
    : '沿用下方命名 API Profile 表单，可配置 Provider、模型、密钥、服务地址并测试连接。现有配置不会被重置。';
  document.getElementById('onboardingStepState').textContent =
    onboardingStateText(step, status);
  document.querySelectorAll('[data-onboarding-progress]').forEach(item => {
    const name = item.dataset.onboardingProgress;
    item.dataset.state = name === step ? 'active' : (steps[name] || 'pending');
  });
  const back = document.getElementById('onboardingBack');
  const skip = document.getElementById('onboardingSkip');
  const next = document.getElementById('onboardingContinue');
  const finish = document.getElementById('onboardingFinish');
  const busy = onboardingUi.pending || userDataUi.pendingAction;
  back.hidden = step !== 'api';
  skip.hidden = status !== 'pending';
  next.hidden = step !== 'storage';
  finish.hidden = step !== 'api';
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
    if (location.hash !== '#onboarding') {
      leaveOnboardingLayout();
      return;
    }
    enterOnboardingLayout();
    await reconcileOnboardingConfiguration();
    await prepareOnboardingFinish();
    onboardingUi.step = onboardingUi.state.steps?.storage === 'pending'
      ? 'storage' : 'api';
    renderOnboarding();
  } catch (error) {
    enterOnboardingLayout();
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
    history.replaceState(null, '', `${location.pathname}${location.search}#onboarding`);
    enterOnboardingLayout();
    await reconcileOnboardingConfiguration();
    renderOnboarding();
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
    if (step === 'storage') onboardingUi.step = 'api';
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
      history.replaceState(null, '', `${location.pathname}${location.search}#providerSettings`);
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
  const effectiveState = safeStatus.pending ? 'pending' : safeStatus.state;
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
  stateElement.dataset.state = safeStatus.state;
  document.getElementById('portableConfigRevision').textContent =
    safeStatus.revision === null ? '—' : String(safeStatus.revision);
  document.getElementById('portableConfigUpdatedAt').textContent = safeStatus.updatedAt
    ? new Date(safeStatus.updatedAt).toLocaleString() : '—';
  document.getElementById('portableConfigNotice').textContent = safeStatus.lastError
    ? `${noticeText} 请检查目录状态后重试。` : noticeText;

  const pending = userDataUi.pendingAction || safeStatus.pending;
  const unlock = document.getElementById('unlockPortableConfig');
  const rotate = document.getElementById('rotatePortableConfigPassphrase');
  const forget = document.getElementById('forgetPortableConfigKey');
  const backup = document.getElementById('backupPortableConfigNow');
  unlock.hidden = safeStatus.state !== 'locked' && safeStatus.state !== 'missing';
  unlock.textContent = safeStatus.state === 'missing' ? '创建加密备份' : '解锁配置备份';
  rotate.hidden = safeStatus.state !== 'ready';
  forget.hidden = safeStatus.state !== 'ready';
  backup.hidden = safeStatus.state !== 'ready';
  [unlock, rotate, forget, backup].forEach(button => { button.disabled = pending; });
}
// Portable config status renderer: end.

function clearPortableConfigDialogSecrets() {
  ['portableConfigCurrentPassphrase', 'portableConfigPassphrase',
    'portableConfigPassphraseConfirm'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  const error = document.getElementById('portableConfigDialogError');
  if (error) error.textContent = '';
  portableConfigUi.mode = '';
  portableConfigUi.submitting = false;
  if (portableConfigUi.resolveDialog) {
    const resolve = portableConfigUi.resolveDialog;
    portableConfigUi.resolveDialog = null;
    portableConfigUi.dialogPromise = null;
    resolve({ cancelled: true });
  }
}

function completePortableConfigDialog(result) {
  const resolve = portableConfigUi.resolveDialog;
  portableConfigUi.resolveDialog = null;
  portableConfigUi.dialogPromise = null;
  const dialog = document.getElementById('portableConfigDialog');
  if (dialog.open) dialog.close('confirmed');
  if (resolve) resolve(result);
}

function cancelPortableConfigDialog(event) {
  event?.preventDefault?.();
  if (portableConfigUi.submitting) return;
  const dialog = document.getElementById('portableConfigDialog');
  if (dialog.open) dialog.close('cancelled');
  else clearPortableConfigDialogSecrets();
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
  portableConfigUi.mode = mode;
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
    errorElement.textContent = validationError;
    return;
  }
  portableConfigUi.submitting = true;
  errorElement.textContent = '';
  const dialog = document.getElementById('portableConfigDialog');
  const controls = [...dialog.querySelectorAll('input, button')];
  controls.forEach(control => { control.disabled = true; });
  dialog.setAttribute('aria-busy', 'true');
  try {
    const status = await callBackground(
      portableConfigRequestForMode(mode, currentPassphrase, passphrase)
    );
    renderPortableConfigStatus(status);
    completePortableConfigDialog(status);
  } catch (error) {
    errorElement.textContent = portableConfigErrorText(error);
  } finally {
    currentPassphrase = '';
    passphrase = '';
    confirmation = '';
    portableConfigUi.submitting = false;
    controls.forEach(control => { control.disabled = false; });
    dialog.removeAttribute('aria-busy');
  }
}

function updateUserDataActionButtons() {
  const current = userDataUi.lastStatus || {};
  const configured = Boolean(current.directoryName);
  const permission = current.permission || 'unconfigured';
  const portableState = userDataUi.portableConfigStatus?.state || 'disabled';
  const portableAllowsSync = !['missing', 'locked', 'error', 'unavailable'].includes(
    portableState
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
}

async function refreshUserDataStatus() {
  const requestToken = startUserDataStatusRequest();
  try {
    const status = await callBackground({ type: 'USER_DATA_SYNC_STATUS' });
    if (!isCurrentUserDataStatus(requestToken)) return;
    renderUserDataStatus(status);
    if (status?.lastError) showUserDataStatus(`上次同步未完成：${status.lastError}`, 'error');
  } catch (error) {
    if (!isCurrentUserDataStatus(requestToken)) return;
    showUserDataStatus(`读取本地数据状态失败：${friendlyError(error)}`, 'error');
  }
}

async function preparePortableConfigForDirectory({ call = callBackground,
  openDialog = openPortableConfigDialog, reloadSettings = refreshSettings,
  renderStatus = renderPortableConfigStatus } = {}) {
  let status = await call({ type: 'PORTABLE_CONFIG_PROBE' });
  renderStatus(status);
  if (status?.state === 'missing' || status?.state === 'locked') {
    const mode = status.state === 'missing' ? 'create' : 'unlock';
    const dialogResult = await openDialog(mode);
    if (dialogResult?.cancelled === true) {
      return { ready: false, cancelled: true, status };
    }
    status = dialogResult;
    renderStatus(status);
    if (status?.state !== 'ready') return { ready: false, status };
    if (mode === 'unlock') await reloadSettings();
  }
  if (status?.state !== 'ready') return { ready: false, status };
  await call({ type: 'USER_DATA_SYNC_NOW', drain: true });
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
  try {
    const handle = await window.showDirectoryPicker({
      id: 'sci-highlighter-user-data', mode: 'readwrite', startIn: 'documents'
    });
    await SciLLM.saveDirectoryHandle(indexedDB, handle);
    userDataUi.directoryHandle = handle;
    userDataUi.handleLoaded = true;
    const prepared = await preparePortableConfigForDirectory();
    await refreshUserDataStatus();
    if (!prepared.ready) {
      if (prepared.status?.state === 'missing' || prepared.status?.state === 'locked') {
        const pendingState = prepared.status.state === 'missing' ? '创建' : '解锁';
        showUserDataStatus(`目录已保存，配置备份待${pendingState}；完成前不会同步。`, 'info');
      } else {
        showUserDataStatus('目录已保存，但加密配置状态异常；已安全停止同步。', 'error');
      }
      return;
    }
    if (onboardingUi.active) await setOnboardingStepState('storage', 'completed');
    showUserDataStatus('目录已保存，加密配置已就绪并完成本地数据同步。', 'success');
  } catch (error) {
    if (error?.name === 'AbortError') {
      showUserDataStatus('已取消选择，现有目录设置没有改变。', 'info');
    } else {
      renderPortableConfigStatus({ state: 'error', lastError: error?.code });
      showUserDataStatus(`选择目录失败：${portableConfigErrorText(error)}`, 'error');
    }
  } finally {
    setUserDataActionPending(false);
  }
}

async function unlockPortableConfig() {
  if (userDataUi.pendingAction) return;
  const mode = userDataUi.portableConfigStatus?.state === 'missing' ? 'create' : 'unlock';
  setUserDataActionPending(true);
  try {
    const result = await openPortableConfigDialog(mode);
    if (result?.cancelled) {
      showUserDataStatus(
        mode === 'create' ? '配置备份待创建。' : '配置备份待解锁。',
        'info'
      );
      return;
    }
    if (result?.state !== 'ready') {
      renderPortableConfigStatus(result);
      showUserDataStatus('加密配置尚未就绪，已停止后续操作。', 'error');
      return;
    }
    if (result?.state === 'ready' && mode === 'unlock') await refreshSettings();
    await refreshUserDataStatus();
    showUserDataStatus(
      mode === 'create' ? '加密配置备份已创建。' : '配置备份已解锁并恢复设置。',
      'success'
    );
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
    const status = await callBackground({ type: 'PORTABLE_CONFIG_FORGET_KEY' });
    renderPortableConfigStatus(status);
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
    await refreshUserDataStatus();
    if (prepared.ready) {
      showUserDataStatus('目录权限已恢复，加密配置已就绪并完成同步。', 'success');
    } else if (prepared.status?.state === 'missing' || prepared.status?.state === 'locked') {
      showUserDataStatus('目录权限已恢复，但配置备份仍待创建或解锁。', 'info');
    } else {
      showUserDataStatus('目录权限已恢复，但加密配置状态异常；已停止同步。', 'error');
    }
  } catch (error) {
    showUserDataStatus(`重新授权失败：${friendlyError(error)}`, 'error');
  } finally {
    setUserDataActionPending(false);
  }
}

async function syncUserDataNow() {
  if (userDataUi.pendingAction) return;
  if (['missing', 'locked', 'error', 'unavailable'].includes(
    userDataUi.portableConfigStatus?.state
  )) {
    showUserDataStatus('请先创建或解锁加密配置备份，再同步目录。', 'error');
    return;
  }
  setUserDataActionPending(true);
  showUserDataStatus('正在同步本地数据…', 'info');
  try {
    const result = await callBackground({ type: 'USER_DATA_SYNC_NOW' });
    await refreshUserDataStatus();
    if (result.permission !== 'granted') {
      showUserDataStatus('目录需要重新授权后才能同步。', 'error');
    } else {
      showUserDataStatus(`同步完成：写入 ${result.written || 0} 项。`, 'success');
    }
  } catch (error) {
    showUserDataStatus(`同步失败：${friendlyError(error)}`, 'error');
  } finally {
    setUserDataActionPending(false);
  }
}

function openRebuildUserDataDialog() {
  if (userDataUi.pendingAction) return;
  const dialog = document.getElementById('rebuildUserDataDialog');
  if (!dialog.open) dialog.showModal();
}

async function confirmRebuildUserDataIndex(event) {
  event.preventDefault();
  if (userDataUi.pendingAction) return;
  document.getElementById('rebuildUserDataDialog').close('confirm');
  setUserDataActionPending(true);
  showUserDataStatus('正在核对目录索引并导入较新数据…', 'info');
  try {
    const result = await callBackground({ type: 'USER_DATA_REBUILD_INDEX' });
    await refreshSettings();
    await refreshUserDataStatus();
    showUserDataStatus(
      `重建完成：导入 ${result.imported || 0} 项，跳过 ${result.stale || 0} 项旧版本。`,
      'success'
    );
  } catch (error) {
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
  [
    ['restore', '扫描并恢复'], ['export', '导出'], ['clear', '清除']
  ].forEach(([action, label]) => {
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

async function loadArticleWorkspaceDetail(workspaceId) {
  if (articleWorkspaceOverviewUi.details.has(workspaceId)) {
    return articleWorkspaceOverviewUi.details.get(workspaceId);
  }
  const detail = await callBackground({ type: 'ARTICLE_WORKSPACE_DETAIL', workspaceId });
  articleWorkspaceOverviewUi.details.set(workspaceId, detail);
  return detail;
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
  articleWorkspaceOverviewUi.loading = true;
  updateArticleWorkspaceOverviewControls();
  articleWorkspaceStatus('正在刷新论文工作区总览…', 'info');
  try {
    const result = await callBackground({ type: 'ARTICLE_WORKSPACE_LIST' });
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
    await loadVisibleArticleWorkspaceDetails();
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
  await Promise.all(items.map(item => loadArticleWorkspaceDetail(item.workspaceId)));
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
    for (const item of items) {
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
        if (result.pendingDiskCleanup) pendingDiskCleanup += 1;
      } else {
        pending += 1;
      }
    }
    items.forEach(item => articleWorkspaceOverviewUi.selected.delete(item.workspaceId));
    finalStatus = [
      pending
        ? `已清除 ${deleted} 篇；${pending} 篇等待目录重新授权后完成。`
        : pendingDiskCleanup
          ? `已清除 ${deleted} 篇本机工作区；${pendingDiskCleanup} 篇目录副本因未授权暂未删除，但已永久屏蔽，不会被扫描恢复。`
          : `已清除 ${deleted} 篇论文工作区。`,
      pending || pendingDiskCleanup ? 'info' : 'success'
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
    if (action === 'export') {
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
    await refreshSettings();
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
    'testCategoryRegex', 'exportCategoryModule']
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

async function refreshSettings() {
  try {
    applyState(await callBackground({ type: 'LLM_GET_SETTINGS' }));
  } catch (error) {
    showStatus(`读取设置失败：${error.message}`, 'error');
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
  renderFigureRouteWarning();
}

function markCompatiblePresetCustom() {
  const descriptor = providerSelectionDescriptor();
  if (descriptor.providerId !== 'openai-compatible' ||
      descriptor.selection !== 'openai-compatible') return;
  const select = document.getElementById('compatiblePreset');
  if (compatiblePresetFor('custom')) select.value = 'custom';
  renderCompatiblePresetHint(compatiblePresetFor('custom'));
  renderFigureRouteWarning();
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
    color: document.getElementById('customCategoryColor').value,
    includeWhen: linesFrom('customCategoryInclude'),
    excludeWhen: linesFrom('customCategoryExclude'),
    positiveExamples: linesFrom('customCategoryPositive'),
    negativeExamples: linesFrom('customCategoryNegative'),
    spanPolicy: document.getElementById('customCategorySpanPolicy').value,
    persistence: document.getElementById('customCategoryPersistence').value
  };
  if (!category.name || !category.definition) {
    showStatus('请填写自定义类别的名称和识别定义。', 'error');
    return;
  }
  try {
    applyState(await callBackground({ type: 'LLM_SAVE_CUSTOM_CATEGORY', category }));
    ['customCategoryName', 'customCategoryDefinition', 'customCategoryInclude',
      'customCategoryExclude', 'customCategoryPositive', 'customCategoryNegative']
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
  if (providerId === 'codex-local') return;
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
function applyState(nextState) {
  state = nextState;
  const entries = profileEntries();
  if (!profileById(selectedProfileId)) {
    selectedProfileId = state.settings?.globalProfileId || entries[0]?.[0] || '';
  }
  document.getElementById('analysisMode').value = state.settings?.mode || 'regex';
  const language = state.settings?.language || 'zh-CN';
  document.getElementById('globalLanguage').value = language;
  SciLLM.setInterfaceLanguage(language);
  document.getElementById('autoAnalyze').checked = state.settings?.autoAnalyze === true;
  document.getElementById('autoCacheFigureImages').checked =
    state.settings?.autoCacheFigureImages !== false;
  document.getElementById('consentGranted').checked = state.settings?.consentGranted === true;
  renderPanelFollowupPresets(state.settings?.figurePanelFollowupPresets || []);
  renderArticleChatQuickPrompts(state.settings?.articleChatQuickPrompts || []);
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
    ? `${highlightModeLabel} · LLM 功能可用`
    : `${highlightModeLabel} · LLM 功能未就绪`;
  renderProfileEditor();
  renderRouteOptions();
  renderCustomCategories();
  renderDeletedBuiltInCategories();
  renderCategoryList();
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
  keyboardShortcutStatus('快捷键已修改，尚未保存。', 'info');
}

function handleKeyboardShortcutInput(event) {
  const input = event.target.closest?.('[data-shortcut-action]');
  if (!input) return;
  input.value = SciLLM.normalizeKeyboardShortcutKey(input.value, '');
  keyboardShortcutEditorDirty = true;
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
  try {
    const keyboardShortcuts = collectKeyboardShortcutSettings();
    button.disabled = true;
    const updated = await callBackground({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: { keyboardShortcuts }
    });
    keyboardShortcutEditorDirty = false;
    applyState(updated);
    keyboardShortcutStatus('快捷键已保存，侧栏立即按新设置响应。', 'success');
  } catch (error) {
    keyboardShortcutStatus(`保存失败：${friendlyError(error)}`, 'error');
  } finally {
    button.disabled = false;
  }
}

function resetKeyboardShortcuts() {
  renderKeyboardShortcutSettings(SciLLM.DEFAULT_KEYBOARD_SHORTCUTS);
  keyboardShortcutEditorDirty = true;
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
  markProfileEditorDirty();
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
  markProfileEditorDirty();
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

function currentAnalysisModeDraft() {
  return analysisModeEditorModes.find(mode => mode.id === selectedAnalysisModeId) || null;
}

function showAnalysisModeStatus(message, type = 'info') {
  const target = document.getElementById('analysisModeStatus');
  if (!target) return;
  target.textContent = message;
  target.className = `status ${type}`;
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
    name.textContent = mode.name || '未命名模式';
    const count = document.createElement('small');
    count.textContent = `${mode.categoryIds?.length || 0} 个类别 · ${mode.id}`;
    button.append(name, count);
    list.appendChild(button);
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
  const mode = currentAnalysisModeDraft();
  const name = document.getElementById('analysisModeName');
  const id = document.getElementById('analysisModeId');
  const description = document.getElementById('analysisModeDescription');
  if (!name || !id || !description) return;
  name.value = mode?.name || '';
  id.value = mode?.id || '';
  description.value = mode?.description || '';
  [name, description].forEach(input => { input.disabled = !mode; });
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
    name: '新分析模式',
    description: '',
    categoryIds: []
  });
  selectedAnalysisModeId = id;
  analysisModeEditorDirty = true;
  renderAnalysisModeEditor();
  document.getElementById('analysisModeName')?.select();
  showAnalysisModeStatus('已新增模式草稿，保存后生效。');
}

function deleteAnalysisMode() {
  if (analysisModeEditorModes.length <= 1) {
    showAnalysisModeStatus('至少保留一个分析模式。', 'error');
    return;
  }
  const mode = currentAnalysisModeDraft();
  if (!mode || !confirm(`永久删除分析模式“${mode.name}”？类别规则本身不会被删除。`)) return;
  analysisModeEditorModes = analysisModeEditorModes.filter(item => item.id !== mode.id);
  selectedAnalysisModeId = analysisModeEditorModes[0]?.id || '';
  analysisModeEditorDirty = true;
  renderAnalysisModeEditor();
  showAnalysisModeStatus('模式已从草稿中删除，点击保存后生效。');
}

function resetAnalysisModes() {
  if (!confirm('恢复全部内置分析模式？当前自定义模式和勾选组合将被替换。')) return;
  analysisModeEditorModes = structuredClone(state?.analysisModeDefaults || []);
  selectedAnalysisModeId = analysisModeEditorModes[0]?.id || '';
  analysisModeEditorDirty = true;
  renderAnalysisModeEditor();
  showAnalysisModeStatus('已填入内置模式，点击保存后生效。');
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
    showAnalysisModeStatus('至少需要一个已命名的分析模式。', 'error');
    return;
  }
  if (modes.some(mode => mode.categoryIds.length === 0)) {
    showAnalysisModeStatus('每个分析模式至少勾选一个类别规则。', 'error');
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
        readingViewId,
        viewCategoryOverrides: Object.fromEntries(
          modes.map(mode => [mode.id, { add: [], remove: [] }])
        )
      }
    });
    analysisModeEditorDirty = false;
    applyState(updated);
    showAnalysisModeStatus('分析模式已保存。', 'success');
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
  const definition = state?.providers?.[descriptor.providerId];
  const candidates = Array.isArray(definition?.models) ? [...definition.models] : [];
  if (descriptor.providerId === 'openai-compatible') {
    const preset = compatiblePresetFor(descriptor.presetId);
    if (preset?.defaultModel) candidates.push(preset.defaultModel);
  }
  const cache = discoveredModels.get(modelDiscoveryCacheKey(descriptor));
  (cache?.models || []).forEach(model => candidates.push(model.id));
  if (input?.value) candidates.push(input.value);
  const models = [...new Set(
    candidates.map(value => String(value || '').trim()).filter(Boolean)
  )];
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
      ? `在线模型（${models.length}）`
      : '在线模型';
    select.appendChild(placeholder);
    models.forEach(model => {
      const option = document.createElement('option');
      const detail = cache?.models?.find(item => item.id === model);
      option.value = model;
      option.textContent = detail?.displayName && detail.displayName !== model
        ? `${detail.displayName} · ${model}` : model;
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
  document.getElementById('compatibleFields').hidden = !compatible;
  document.getElementById('codexLocalFields').hidden = !localCodex;
  document.getElementById('apiKeyField').hidden = localCodex;
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
  renderFigureRouteWarning();
  if (localCodex) void refreshCodexAuthStatus({ silent: true });
  else stopCodexAuthPolling();
}

function modelDiscoveryCacheKey(descriptor = providerSelectionDescriptor()) {
  const baseUrl = descriptor.providerId === 'openai-compatible'
    ? String(document.getElementById('baseUrl')?.value || '').trim()
    : '';
  return `${selectedProfileId}|${descriptor.selection}|${baseUrl}`;
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
  return config;
}

function scheduleProviderModelDiscovery() {
  if (modelDiscoveryTimer) clearTimeout(modelDiscoveryTimer);
  modelDiscoveryTimer = setTimeout(() => {
    modelDiscoveryTimer = null;
    void refreshProviderModels({ auto: true });
  }, 180);
}

async function refreshProviderModels({ auto = false } = {}) {
  if (!selectedProfileId || !profileById(selectedProfileId)) return;
  const descriptor = providerSelectionDescriptor();
  const profile = profileById(selectedProfileId);
  const hasCredential = descriptor.providerId === 'codex-local' ||
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
    setModelDiscoveryStatus(`已载入 ${cached.models.length} 个在线模型。`, 'success');
    return;
  }

  const button = document.getElementById('refreshModels');
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  setModelDiscoveryStatus('正在连接服务商并获取可用模型…', 'loading');
  try {
    const result = await callBackground({
      type: 'LLM_LIST_MODELS',
      profileId: selectedProfileId,
      providerId: descriptor.providerId,
      config: modelDiscoveryConfig(descriptor)
    });
    const models = (Array.isArray(result.models) ? result.models : [])
      .filter(item => item && typeof item.id === 'string')
      .slice(0, 500);
    if (!models.length) throw new Error('服务商没有返回可用模型');
    discoveredModels.set(cacheKey, {
      cachedAt: Date.now(),
      fetchedAt: result.fetchedAt,
      models
    });
    const input = document.getElementById('model');
    if (input && !input.value.trim()) {
      input.value = models[0].id;
      markProfileEditorDirty({ target: { id: 'model' } });
      updateProfileListPreview();
    }
    renderModelSuggestions(descriptor.selection);
    setModelDiscoveryStatus(
      `已从服务商获取 ${models.length} 个当前可用模型，可在输入框候选中选择。`,
      'success'
    );
  } catch (error) {
    const prefix = auto ? '自动获取失败' : '获取模型失败';
    setModelDiscoveryStatus(
      `${prefix}：${friendlyError(error)}。仍可手动输入模型 ID。`,
      'error'
    );
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
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
  const profile = profileById(selectedProfileId);
  if (!input || !profile) return;
  const name = input.value.trim();
  if (!name) {
    input.value = profile.name || '';
    profileDirtyFields.delete('profileName');
    profileEditorDirty = profileDirtyFields.size > 0;
    showStatus('配置名称不能为空。', 'error');
    return;
  }
  if (name === profile.name) {
    profileDirtyFields.delete('profileName');
    profileEditorDirty = profileDirtyFields.size > 0;
    return;
  }
  if (!beginProfileAction('rename')) return;
  try {
    const result = await callBackground({
      type: 'LLM_SAVE_PROFILE',
      profile: { id: selectedProfileId, name }
    });
    if (state?.settings?.profiles?.[selectedProfileId]) {
      state.settings.profiles[selectedProfileId].name =
        result.profile?.name || name;
    }
    profileDirtyFields.delete('profileName');
    profileEditorDirty = profileDirtyFields.size > 0;
    renderProfileList();
    showStatus('配置名称已保存。', 'success');
  } catch (error) {
    showStatus(`保存配置名称失败：${friendlyError(error)}`, 'error');
  } finally {
    endProfileAction('rename');
  }
}

function friendlyError(error) {
  const messages = {
    AUTH_INVALID: 'API Key 无效或无权限',
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
    PROVIDER_UNAVAILABLE: 'Codex 服务暂时不可用，请稍后重试',
    CONTEXT_BUDGET_EXCEEDED: '当前 Codex 上下文不足以容纳这次请求',
    INVALID_SETTINGS: `内容不完整或规则不安全：${(error.fields || []).join('、')}`,
    USER_DATA_DATABASE_UNAVAILABLE: '本地数据库模块不可用，请重新加载扩展后重试',
    INDEXEDDB_UNAVAILABLE: '浏览器本地数据库不可用，请检查隐私设置后重试',
    INDEXEDDB_OPEN_FAILED: '无法打开浏览器本地数据库，请重新加载扩展后重试',
    INDEXEDDB_UPGRADE_BLOCKED: '本地数据库正在被旧页面占用，请关闭其他插件设置页后重试'
  };
  return messages[error.code] || error.message;
}

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status show ${type}`;
}

// Named API Profiles editor. All current UI actions use the profile contract.
function providerVisionCapability(providerId, config = {}) {
  const definition = state?.providers?.[providerId];
  if (!definition) return false;
  return providerId === 'openai-compatible'
    ? config.supportsVision === true
    : definition.supportsVision === true;
}

// Compatible editor render contract: document.getElementById('supportsVision').checked = config.supportsVision === true

function markProfileEditorDirty(event) {
  const fieldId = String(event?.target?.id || '*');
  profileDirtyFields.add(fieldId);
  profileEditorDirty = true;
}

function clearProfileEditorDirty() {
  profileDirtyFields.clear();
  profileEditorDirty = false;
}

function canLeaveProfileEditor(action = 'switch') {
  if (!profileEditorDirty) return true;
  const message = '当前 Profile 有未保存修改，是否放弃并继续？';
  const canConfirm = typeof window !== 'undefined' && typeof window.confirm === 'function';
  if (canConfirm && window.confirm(message)) {
    clearProfileEditorDirty();
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
  ['addApiProfile', 'duplicateApiProfile', 'deleteApiProfile', 'saveSettings', 'testProvider']
    .forEach(id => {
    const element = document.getElementById(id);
    if (element) element.disabled = pending;
  });
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
  return `${profile?.name || '未命名'} · ${providerLabel || profile?.providerId || '未选服务商'} · ` +
    `${model || '未填写模型'} · ${vision ? '视觉' : '仅文本'}`;
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
  document.getElementById('compatibleFields').hidden = !compatible;
  document.getElementById('codexLocalFields').hidden = !localCodex;
  document.getElementById('apiKeyField').hidden = localCodex;
  if (localCodex) {
    document.getElementById('credentialState').textContent = '使用本机 Codex 登录';
    document.getElementById('codexReasoningEffort').value =
      config.reasoningEffort || 'auto';
  }
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
  const tokenPolicy = profile?.tokenPolicy || {};
  document.getElementById('tokenModeAuto').checked = tokenPolicy.mode !== 'manual';
  document.getElementById('tokenModeManual').checked = tokenPolicy.mode === 'manual';
  document.getElementById('autoTokenCap').value = tokenPolicy.autoCap ?? '';
  document.getElementById('manualMaxTokens').value = tokenPolicy.manualMax || 4096;
  document.getElementById('contextWindowTokens').value =
    profile?.contextWindowTokens ?? '';
  renderTokenPolicyFields();
  renderProfileList();
  renderFigureRouteWarning();
  scheduleProviderModelDiscovery();
  if (localCodex) void refreshCodexAuthStatus({ silent: true });
  else stopCodexAuthPolling();
}

function renderTokenPolicyFields() {
  const manual = document.getElementById('tokenModeManual')?.checked === true;
  const autoField = document.getElementById('autoTokenCapField');
  const manualField = document.getElementById('manualMaxTokensField');
  if (autoField) autoField.hidden = manual;
  if (manualField) manualField.hidden = !manual;
}

function renderRouteOptions() {
  const entries = profileEntries();
  const selects = ['globalProfileId', 'routeHighlight', 'routeSummary', 'routeFigure', 'routeCrossFigure'];
  selects.forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    select.replaceChildren();
    if (id !== 'globalProfileId') {
      const global = document.createElement('option');
      global.value = '';
      global.textContent = '使用全局默认';
      select.appendChild(global);
    }
    entries.forEach(([profileId, profile]) => {
      const option = document.createElement('option');
      option.value = profileId;
      option.textContent = profileOptionLabel(profile);
      select.appendChild(option);
    });
    if (id === 'globalProfileId') {
      select.value = state?.settings?.globalProfileId || entries[0]?.[0] || '';
    } else {
      const route = state?.settings?.taskRoutes?.[id.replace(/^route/, '').replace(/^./, c => c.toLowerCase())];
      select.value = route?.mode === 'profile' ? route.profileId : '';
    }
  });
  renderFigureRouteWarning();
}

function renderFigureRouteWarning() {
  const warning = document.getElementById('routeFigureWarning');
  const routeSelect = document.getElementById('routeFigure');
  if (!warning || !routeSelect) return;
  const targetId = routeSelect.value || document.getElementById('globalProfileId')?.value;
  const profile = profileById(targetId);
  let vision = providerVisionCapability(profile?.providerId, profile?.config || {});
  if (targetId && targetId === selectedProfileId) {
    const providerId = providerSelectionDescriptor(
      document.getElementById('providerId')?.value || profile?.providerId
    ).providerId;
    const editorConfig = { ...(profile?.config || {}) };
    if (providerId === 'openai-compatible') {
      editorConfig.supportsVision = document.getElementById('supportsVision')?.checked === true;
    }
    vision = providerVisionCapability(providerId, editorConfig);
  }
  warning.hidden = !targetId || vision;
  warning.textContent = vision ? '' : '图注任务最好选择支持视觉输入的模型；将只依据图注和正文解读。';
}

function collectProfile() {
  const current = profileById(selectedProfileId) || {};
  const descriptor = providerSelectionDescriptor();
  const providerId = descriptor.providerId;
  const config = { ...(current.config || {}) };
  delete config.apiKey;
  delete config.hasApiKey;
  delete config.apiKeyMask;
  delete config.customHeaderNames;
  config.model = document.getElementById('model').value.trim();
  const enteredKey = document.getElementById('apiKey').value.trim();
  if (enteredKey) config.apiKey = enteredKey;
  if (providerId === 'openai-compatible') {
    config.presetId = descriptor.presetId ||
      document.getElementById('compatiblePreset').value || 'custom';
    config.baseUrl = document.getElementById('baseUrl').value.trim();
    config.authHeader = document.getElementById('authHeader').value.trim() || 'Authorization';
    config.authPrefix = document.getElementById('authPrefix').value.trim();
    config.jsonMode = document.getElementById('jsonMode').checked;
    config.supportsVision = document.getElementById('supportsVision').checked;
  } else if (providerId === 'codex-local') {
    config.reasoningEffort =
      document.getElementById('codexReasoningEffort').value || 'auto';
    delete config.apiKey;
    delete config.baseUrl;
    delete config.supportsVision;
  } else {
    delete config.reasoningEffort;
    delete config.supportsVision;
  }
  const manual = document.getElementById('tokenModeManual').checked;
  const autoCapValue = document.getElementById('autoTokenCap').value;
  const manualValue = Number(document.getElementById('manualMaxTokens').value) || 4096;
  const contextWindowValue = document.getElementById('contextWindowTokens').value;
  return {
    id: selectedProfileId,
    name: document.getElementById('profileName').value.trim(),
    providerId,
    config,
    capabilities: { vision: providerVisionCapability(providerId, config) },
    contextWindowTokens: contextWindowValue ? Number(contextWindowValue) : null,
    tokenPolicy: manual
      ? { mode: 'manual', manualMax: manualValue, autoCap: null }
      : { mode: 'auto', autoCap: autoCapValue ? Number(autoCapValue) : null, manualMax: null }
  };
}

function collectTaskRoutes() {
  const taskRoutes = {};
  [['highlight', 'routeHighlight'], ['summary', 'routeSummary'],
    ['figure', 'routeFigure'], ['crossFigure', 'routeCrossFigure']]
    .forEach(([taskId, elementId]) => {
      const profileId = document.getElementById(elementId).value;
      taskRoutes[taskId] = profileId
        ? { mode: 'profile', profileId }
        : { mode: 'global', profileId: null };
    });
  return taskRoutes;
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
    clearProfileEditorDirty();
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
    clearProfileEditorDirty();
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
    applyState(result);
    clearProfileEditorDirty();
    showStatus('API Profile 已删除。', 'success');
  } catch (error) {
    showStatus(`删除 Profile 失败：${friendlyError(error)}`, 'error');
  } finally {
    endProfileMutation();
    setProfileMutationPending(false);
  }
}

async function persistForm(silent) {
  if (!beginProfileAction('save')) return null;
  const buttons = [...document.querySelectorAll('.button')];
  const previousDisabledStates = new Map(
    buttons.map(button => [button, button.disabled === true])
  );
  buttons.forEach(button => { button.disabled = true; });
  try {
    const profile = collectProfile();
    const previous = profileById(profile.id);
    const firstConfiguration = profile.providerId === 'codex-local'
      ? previous?.providerId !== 'codex-local'
      : !previous?.config?.hasApiKey && Boolean(profile.config.apiKey);
    const consentGranted = document.getElementById('consentGranted').checked;
    const preferredMode = firstConfiguration && consentGranted
      ? 'llm' : document.getElementById('analysisMode').value;
    const globalProfileId = document.getElementById('globalProfileId').value;
    const taskRoutes = collectTaskRoutes();
    const figurePanelFollowupPresets = collectPanelFollowupPresets();
    const figurePanelFollowupPrompts =
      panelFollowupPromptMap(figurePanelFollowupPresets);
    const articleChatQuickPrompts = collectArticleChatQuickPrompts();
    // Freeze every user-edited value before the first asynchronous save.
    // applyState() re-renders the form after saving the Profile and must not
    // replace a preference changed in the same click with its previous value.
    const preferences = {
      mode: preferredMode,
      autoAnalyze: document.getElementById('autoAnalyze').checked,
      autoCacheFigureImages: document.getElementById('autoCacheFigureImages').checked,
      consentGranted,
      figurePanelFollowupPrompts,
      figurePanelFollowupPresets,
      articleChatQuickPrompts
    };
    await requestEndpointPermission(profile.providerId, profile.config);
    const saved = await callBackground({ type: 'LLM_SAVE_PROFILE', profile });
    selectedProfileId = saved.profile?.id || profile.id;
    applyState(saved);
    const routed = await callBackground({
      type: 'LLM_UPDATE_PROFILE_ROUTING',
      globalProfileId,
      taskRoutes
    });
    applyState(routed);
    const updated = await callBackground({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences
    });
    applyState(updated);
    clearProfileEditorDirty();
    if (onboardingUi.active && hasUsableApiConfiguration()) {
      await setOnboardingStepState('api', 'completed');
    }
    if (!silent) showStatus('模型与路由设置已保存。', 'success');
    return { profileId: selectedProfileId };
  } catch (error) {
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
  if (!beginProfileAction('test')) return;
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
  showStatus('正在使用合成文本测试连接。', 'info');
  try {
    const saved = await persistForm(true);
    if (!saved) return;
    const { profileId } = saved;
    const result = await callBackground({ type: 'LLM_TEST_PROFILE', profileId });
    const account = result.accountType
      ? ` · ${result.accountType}${result.planType ? `/${result.planType}` : ''}` : '';
    showStatus(`连接成功：${result.providerId} / ${result.model}${account}`, 'success');
  } catch (error) {
    showStatus(`连接失败：${friendlyError(error)}`, 'error');
  } finally {
    controls.forEach(control => {
      control.disabled = previousDisabledStates.get(control) === true;
    });
    section?.removeAttribute('aria-busy');
    testButton?.removeAttribute('aria-busy');
    endProfileAction('test');
    renderOnboarding();
  }
}
