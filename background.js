importScripts(
  'core/onboarding.js',
  'core/tab-activation.js',
  'core/tab-messenger.js',
  'core/category-store.js',
  'core/adaptive-catalog.js',
  'core/study-profile.js',
  'core/confidence-policy.js',
  'core/publisher-adapters.js',
  'core/article-structure.js',
  'core/abbreviation-extractor.js',
  'providers/provider-utils.js',
  'core/codex-native-client.js',
  'core/prompt-compiler.js',
  'core/chunker.js',
  'core/result-validator.js',
  'core/highlight-stream.js',
  'core/evidence-ledger.js',
  'core/figure-panel-planner.js',
  'core/figure-analysis.js',
  'core/article-chat-tokenizer.js',
  'core/article-chat-index.js',
  'core/article-chat-retrieval.js',
  'core/article-chat-memory.js',
  'core/article-chat-context-planner.js',
  'core/article-chat-citations.js',
  'core/article-chat-stream.js',
  'core/article-chat.js',
  'core/cross-figure-logic.js',
  'core/review-outline.js',
  'core/zotero-connector.js',
  'core/cache-planner.js',
  'core/article-archive.js',
  'core/migration-bundle.js',
  'core/keyboard-shortcuts.js',
  'core/settings-store.js',
  'core/service-worker-keepalive.js',
  'core/offscreen-fetch.js',
  'providers/openai.js',
  'providers/anthropic.js',
  'providers/gemini.js',
  'providers/deepseek.js',
  'providers/codex-local.js',
  'providers/openai-compatible.js',
  'providers/provider-registry.js',
  'core/provider-model-discovery.js',
  'core/task-profile-router.js',
  'core/token-budget.js',
  'core/operation-control.js',
  'core/analysis-pipeline.js',
  'core/analysis-cache.js',
  'core/review-outline-pipeline.js',
  'core/corpus-store.js',
  'core/manual-annotations.js',
  'core/user-data-database.js',
  'core/figure-image-cache.js',
  'core/figure-viewer.js',
  'core/article-workspace.js',
  'core/article-workspace-store.js',
  'core/token-usage-store.js',
  'core/document-store.js',
  'core/portable-config.js',
  'core/portable-config-manager.js',
  'core/directory-sync.js',
  'core/background-router.js'
);

const onboardingController = SciLLM.createOnboardingController({
  storageArea: chrome.storage.local
});
let onboardingSnapshot = null;
onboardingController.get().then(state => {
  onboardingSnapshot = state;
}).catch(() => {});

async function configureSidePanelAction() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  // Keep the custom action flow so onboarding and activation are recorded
  // before the panel reads the current tab.
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  await setGlobalSidePanelAvailability(true);
}

async function setGlobalSidePanelAvailability(enabled) {
  if (!chrome.sidePanel?.setOptions) return;
  await chrome.sidePanel.setOptions({
    path: 'popup.html',
    enabled: enabled === true
  });
}

async function ensureGlobalSidePanelAvailability() {
  const current = chrome.sidePanel?.getOptions
    ? await chrome.sidePanel.getOptions({}).catch(() => null)
    : null;
  if (current && current.enabled === true && current.path === 'popup.html') {
    return;
  }
  await setGlobalSidePanelAvailability(true);
}

async function repairLegacyTabSidePanelOptions(tabOrId) {
  const tabId = Number(typeof tabOrId === 'object' ? tabOrId?.id : tabOrId);
  if (!Number.isInteger(tabId) || tabId < 0 || !chrome.sidePanel?.setOptions) {
    return false;
  }
  const current = chrome.sidePanel?.getOptions
    ? await chrome.sidePanel.getOptions({ tabId }).catch(() => null)
    : null;
  if (current?.enabled === true && current?.path === 'popup.html') return false;
  // Builds before 2.4.10 wrote disabled tab-specific options. Those overrides
  // survive an unpacked-extension update and take precedence over the new
  // window-level default, which makes the panel vanish after a tab switch.
  await chrome.sidePanel.setOptions({
    tabId,
    path: 'popup.html',
    enabled: true
  });
  return true;
}

async function repairAllLegacyTabSidePanelOptions() {
  if (!chrome.tabs?.query) return { checked: 0, repaired: 0 };
  const tabs = await chrome.tabs.query({});
  const repaired = await Promise.all(tabs.map(tab =>
    repairLegacyTabSidePanelOptions(tab).catch(() => false)
  ));
  return {
    checked: tabs.length,
    repaired: repaired.filter(Boolean).length
  };
}

const activatedSidePanelTabIds = new Set();
const tabSidePanelNavigationGenerations = new Map();

async function disableSidePanelShortcutScope(info = {}) {
  const directTabId = Number(info?.tabId);
  if (Number.isInteger(directTabId)) {
    await chrome.tabs.sendMessage(directTabId, {
      action: 'setSidePanelShortcutScope',
      enabled: false,
      shortcuts: {}
    }).catch(() => {});
    return;
  }
  const windowId = Number(info?.windowId);
  if (!Number.isInteger(windowId)) return;
  const tabs = await chrome.tabs.query({ active: true, windowId });
  await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, {
    action: 'setSidePanelShortcutScope',
    enabled: false,
    shortcuts: {}
  }).catch(() => {})));
}

async function resolveOnboardingSourceTab(source = {}, preferredWindowId = null) {
  const suppliedTabId = Number(source?.tabId);
  if (Number.isInteger(suppliedTabId) && suppliedTabId >= 0) {
    const supplied = await chrome.tabs.get(suppliedTabId).catch(() => null);
    if (supplied) {
      return {
        tabId: supplied.id,
        windowId: supplied.windowId,
        url: supplied.url || source.url || ''
      };
    }
  }
  const tabs = await chrome.tabs.query({});
  const activationStates = await Promise.all(tabs.map(async tab => ({
    tab,
    activated: Boolean(tab?.id) &&
      !String(tab.url || '').startsWith(chrome.runtime.getURL('')) &&
      (activatedSidePanelTabIds.has(tab.id) ||
        await SciLLM.isTabActivated(chrome.storage.session, tab).catch(() => false))
  })));
  const candidates = activationStates.filter(item => item.activated).map(item => item.tab);
  candidates.sort((left, right) => {
    const leftPreferred = Number(left.windowId) === Number(preferredWindowId) ? 1 : 0;
    const rightPreferred = Number(right.windowId) === Number(preferredWindowId) ? 1 : 0;
    return rightPreferred - leftPreferred ||
      (Number(right.lastAccessed) || 0) - (Number(left.lastAccessed) || 0);
  });
  const candidate = candidates[0];
  if (candidate) {
    return {
      tabId: candidate.id,
      windowId: candidate.windowId,
      url: candidate.url || ''
    };
  }
  const remembered = onboardingSnapshot?.sourceTab || {};
  const rememberedTabId = Number(remembered.tabId);
  if (Number.isInteger(rememberedTabId) && rememberedTabId >= 0) {
    const tab = await chrome.tabs.get(rememberedTabId).catch(() => null);
    if (tab) {
      return { tabId: tab.id, windowId: tab.windowId, url: tab.url || remembered.url || '' };
    }
  }
  return {};
}

async function syncTabSidePanelAvailability(tab) {
  if (!tab?.id) return false;
  const activated = await SciLLM.isTabActivated(chrome.storage.session, tab);
  if (activated) activatedSidePanelTabIds.add(tab.id);
  else activatedSidePanelTabIds.delete(tab.id);
  // Microsoft Edge currently has a documented defect where a tab-specific
  // panel is not shown again after switching away and back. Keep one global
  // window-level panel instead; popup.html still follows the active tab and
  // shows an inactive state on pages that have not been activated.
  await ensureGlobalSidePanelAvailability();
  await repairLegacyTabSidePanelOptions(tab);
  return activated;
}

async function syncActiveTabSidePanels() {
  if (!chrome.tabs?.query) return;
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(syncTabSidePanelAvailability));
}

function beginToolbarSidePanelOpen(tab) {
  if (!tab?.id || !tab?.windowId) return;
  // Both extension API calls must start before the toolbar listener yields;
  // Edge invalidates the sidePanel.open user gesture after an awaited storage read.
  const enablePromise = setGlobalSidePanelAvailability(true);
  const openPromise = chrome.sidePanel.open({ windowId: tab.windowId });
  // Attach rejection observers immediately. The activation flow below still
  // receives the original promises and reports either failure.
  enablePromise.catch(() => {});
  openPromise.catch(() => {});
  return { enablePromise, openPromise };
}

async function activateTabAndOpenSidePanel(tab, panelOpen) {
  if (!tab?.id || !tab?.windowId) return;
  const attempt = panelOpen || beginToolbarSidePanelOpen(tab);
  if (!attempt) return;
  activatedSidePanelTabIds.add(tab.id);
  const activationPromise = SciLLM.markTabActivated(chrome.storage.session, tab);
  const [, , activation] = await Promise.all([
    attempt.enablePromise, attempt.openPromise, activationPromise
  ]);
  chrome.runtime.sendMessage({
    type: 'PANEL_TAB_ACTIVATED',
    activation
  }).catch(() => {});
  chrome.tabs.sendMessage(tab.id, { action: 'disarmSidePanelRestore' }).catch(() => {});
}

async function openOnboardingForTab(tab) {
  if (!tab?.id || !tab?.windowId) return;
  onboardingSnapshot = await onboardingController.begin({
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url || ''
  });
  await chrome.tabs.create({
    url: chrome.runtime.getURL('options.html#onboarding'),
    active: true,
    windowId: tab.windowId
  });
}

async function handleToolbarAction(tab, panelOpen, knownOnboarding = null) {
  const onboarding = knownOnboarding || await onboardingController.get();
  onboardingSnapshot = onboarding;
  if (SciLLM.shouldStartOnboarding(onboarding)) {
    if (panelOpen) {
      await Promise.allSettled([panelOpen.enablePromise, panelOpen.openPromise]);
    }
    await openOnboardingForTab(tab);
    return;
  }
  await activateTabAndOpenSidePanel(tab, panelOpen);
}

chrome.action.onClicked.addListener(tab => {
  const knownOnboarding = onboardingSnapshot;
  const panelOpen = knownOnboarding && SciLLM.shouldStartOnboarding(knownOnboarding)
    ? null : beginToolbarSidePanelOpen(tab);
  handleToolbarAction(tab, panelOpen, knownOnboarding).catch(error =>
    console.warn('Brevess：无法激活当前标签页', error)
  );
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  // The global panel stays open across tab changes. Only update which article
  // is active; popup.html will refresh against the newly selected tab.
  chrome.tabs.get(tabId).then(syncTabSidePanelAvailability).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.status) return;
  const generation = (tabSidePanelNavigationGenerations.get(tabId) || 0) + 1;
  tabSidePanelNavigationGenerations.set(tabId, generation);
  SciLLM.isTabActivated(chrome.storage.session, tab).then(async stillActivated => {
    if (tabSidePanelNavigationGenerations.get(tabId) !== generation) return;
    if (!stillActivated) {
      activatedSidePanelTabIds.delete(tabId);
      return;
    }
    activatedSidePanelTabIds.add(tabId);
    await ensureGlobalSidePanelAvailability();
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(tabId => {
  activatedSidePanelTabIds.delete(tabId);
  tabSidePanelNavigationGenerations.delete(tabId);
  SciLLM.clearTabActivation(chrome.storage.session, tabId).catch(() => {});
});

if (chrome.sidePanel?.onOpened?.addListener) {
  chrome.sidePanel.onOpened.addListener(info => {
    const directTabId = Number(info?.tabId);
    if (Number.isInteger(directTabId)) {
      chrome.tabs.sendMessage(directTabId, { action: 'disarmSidePanelRestore' }).catch(() => {});
      return;
    }
    if (Number.isInteger(Number(info?.windowId))) {
      chrome.tabs.query({ active: true, windowId: Number(info.windowId) }).then(tabs => {
        const tabId = tabs[0]?.id;
        if (tabId) chrome.tabs.sendMessage(
          tabId, { action: 'disarmSidePanelRestore' }
        ).catch(() => {});
      }).catch(() => {});
    }
  });
}
if (chrome.sidePanel?.onClosed?.addListener) {
  chrome.sidePanel.onClosed.addListener(info => {
    disableSidePanelShortcutScope(info).catch(() => {});
  });
}

chrome.runtime.onInstalled.addListener(() => {
  Promise.all([
    configureSidePanelAction(),
    syncActiveTabSidePanels(),
    repairAllLegacyTabSidePanelOptions()
  ]).catch(error =>
    console.warn('Brevess：无法启用侧栏点击行为', error)
  );
});
chrome.runtime.onStartup.addListener(() => {
  Promise.all([
    configureSidePanelAction(),
    syncActiveTabSidePanels(),
    repairAllLegacyTabSidePanelOptions()
  ]).catch(error =>
    console.warn('Brevess：无法恢复侧栏点击行为', error)
  );
});
configureSidePanelAction().catch(error =>
  console.warn('Brevess：侧栏初始化失败', error)
);
Promise.all([
  syncActiveTabSidePanels(),
  repairAllLegacyTabSidePanelOptions()
]).catch(() => {});

const analysisCache = SciLLM.createIndexedDbAnalysisCache(indexedDB);
const corpusStore = SciLLM.createIndexedDbCorpusStore(indexedDB);
const documentStore = SciLLM.createIndexedDbDocumentStore(indexedDB);
const articleWorkspaceStore = SciLLM.createIndexedDbArticleWorkspaceStore(indexedDB);
const figureImageCache = SciLLM.createIndexedDbFigureImageCache(indexedDB);
const tokenUsageStore = SciLLM.createTokenUsageStore(chrome.storage.local);
const directorySync = SciLLM.createDirectorySync({
  handleStore: SciLLM.createIndexedDbDirectoryHandleStore(indexedDB),
  queueStore: SciLLM.createIndexedDbSyncQueue(indexedDB),
  sourceId: 'extension'
});
const portableSettingsStorage = {
  get(keys) {
    return chrome.storage.local.get(keys);
  }
};
const portableConfigManager = SciLLM.createPortableConfigManager({
  directorySync,
  storageArea: chrome.storage.local,
  settingsKey: 'sciLlmSettingsV2',
  abbreviationKey: SciLLM.GLOBAL_ABBREVIATION_MEMORY_KEY,
  derivePortableConfigKey: SciLLM.derivePortableConfigKey,
  encryptPortableConfig: SciLLM.encryptPortableConfig,
  decryptPortableConfig: SciLLM.decryptPortableConfig,
  validatePortablePayload: SciLLM.validatePortablePayload,
  validatePortableEnvelope: SciLLM.validatePortableEnvelope,
  toBase64: SciLLM.toBase64,
  fromBase64: SciLLM.fromBase64,
  normalizeSettings: SciLLM.mergeSettings,
  normalizeAbbreviations: SciLLM.normalizeGlobalAbbreviationMemory,
  loadSettings: () => SciLLM.loadSettings(portableSettingsStorage),
  loadGlobalAbbreviations: async storageArea => {
    const key = SciLLM.GLOBAL_ABBREVIATION_MEMORY_KEY;
    const stored = await storageArea.get(key);
    return SciLLM.normalizeGlobalAbbreviationMemory(stored?.[key]);
  },
  extensionVersion: chrome.runtime.getManifest().version,
  now: () => new Date().toISOString(),
  randomId: () => crypto.randomUUID(),
  cryptoRef: crypto,
  iterations: SciLLM.PORTABLE_CONFIG_KDF_ITERATIONS,
  path: SciLLM.PORTABLE_CONFIG_PATH,
  payloadKind: SciLLM.PORTABLE_CONFIG_PAYLOAD_KIND
});
if ([
  'probe', 'create', 'unlock', 'rotatePassphrase', 'forgetKey', 'backupNow',
  'scheduleBackup', 'runWhenReady', 'publicStatus'
].some(method => typeof portableConfigManager?.[method] !== 'function')) {
  throw new Error('Portable configuration manager is unavailable');
}
portableConfigManager.probe().catch(() => {});
const providerFetch = SciLLM.createOffscreenFetch(chrome);
const codexNativeClient = SciLLM.createCodexNativeClient(chrome.runtime);
const llmRouter = SciLLM.createBackgroundRouter({
  storageArea: chrome.storage.local,
  sessionStorageArea: chrome.storage.session,
  fetchImpl: providerFetch,
  nativeClient: codexNativeClient,
  cacheStore: analysisCache,
  corpusStore,
  documentStore,
  articleWorkspaceStore,
  tokenUsageStore,
  directorySync,
  portableConfigManager
});
const portableConfigStorageChangeListener = SciLLM.createPortableConfigStorageChangeListener(
  portableConfigManager
);
chrome.storage.onChanged.addListener(portableConfigStorageChangeListener);

const CODEX_REVERSE_CHANNEL_TASKS = new Map([
  ['LLM_ANALYZE_FIGURES', 'figure'],
  ['LLM_ANALYZE_FIGURE_PANEL', 'panel'],
  ['LLM_ASK_FIGURE_PANEL', 'panel'],
  ['LLM_ANALYZE_CROSS_FIGURE_LOGIC', 'cross_figure']
]);

function codexReverseProviderId(value = {}) {
  return String(
    value?.providerId ||
    value?.route?.providerId ||
    value?.data?.route?.providerId ||
    ''
  );
}

function codexReverseFigureMetadata(message = {}) {
  const figures = Array.isArray(message.figures)
    ? message.figures
    : (message.figure && typeof message.figure === 'object' ? [message.figure] : []);
  return figures
    .slice(0, 50)
    .map(figure => ({
      figureId: String(figure?.figureId || ''),
      figureLabel: String(figure?.figureLabel || ''),
      panelHints: Array.isArray(figure?.panelHints) ? figure.panelHints.slice(0, 30) : [],
      imageCount: (
        (Array.isArray(figure?.images) ? figure.images.length : 0) +
        (Array.isArray(figure?.imageVariants) ? figure.imageVariants.length : 0)
      )
    }));
}

async function publishCodexReverseEvent(stage, message, sender, payload, state = {}) {
  const eventScope = CODEX_REVERSE_CHANNEL_TASKS.get(message?.type);
  if (!eventScope) return null;
  const providerId = codexReverseProviderId(payload);
  if (providerId === 'codex-local') state.localCodex = true;
  if (providerId && providerId !== 'codex-local') return null;
  if (!providerId && state.localCodex !== true) return null;
  const progress = stage === 'progress' ? payload : null;
  const response = stage === 'result' || stage === 'error' ? payload : null;
  const eventType = `reader.${eventScope}.${stage}`;
  return codexNativeClient.publishReaderEvent({
    eventType,
    streamKey: [
      Number(sender?.tab?.id) || 0,
      String(message?.operationId || ''),
      String(progress?.figureId || message?.figure?.figureId || ''),
      eventScope
    ].join(':'),
    operationId: String(message?.operationId || ''),
    source: {
      tabId: Number(sender?.tab?.id) || 0,
      url: String(sender?.tab?.url || ''),
      title: String(message?.document?.title || sender?.tab?.title || ''),
      workspaceLifecycle: Number.isInteger(message?.workspaceLifecycle)
        ? message.workspaceLifecycle : null
    },
    request: {
      messageType: String(message?.type || ''),
      analysisDepth: String(message?.analysisDepth || ''),
      figures: codexReverseFigureMetadata(message),
      figureId: String(message?.figure?.figureId || ''),
      panelId: String(message?.panelId || message?.panel?.panelId || '')
    },
    ...(progress ? { progress } : {}),
    ...(response?.success === true ? { result: response.data || {} } : {}),
    ...(response?.success === false ? { error: response.error || {} } : {})
  }, { timeoutMs: 3000 }).catch(error => {
    console.warn('Brevess: unable to publish local Codex reverse event', error);
    return null;
  });
}

const ROUTED_MESSAGE_TYPES = new Set([
  'LLM_GET_SETTINGS',
  'LLM_SAVE_PROFILE',
  'LLM_DUPLICATE_PROFILE',
  'LLM_DELETE_PROFILE',
  'LLM_UPDATE_PROFILE_ROUTING',
  'LLM_TEST_PROFILE',
  'LLM_LIST_MODELS',
  'CODEX_LOCAL_STATUS',
  'CODEX_LOCAL_LOGIN_START',
  'CODEX_LOCAL_LOGOUT',
  'LLM_SAVE_PROVIDER',
  'LLM_UPDATE_PREFERENCES',
  'CATEGORY_GET',
  'CATEGORY_SAVE_OVERRIDE',
  'CATEGORY_APPEND_FIXED_PHRASE',
  'CATEGORY_RESET_OVERRIDE',
  'CATEGORY_DELETE',
  'CATEGORY_RESTORE_BUILT_IN',
  'CATEGORY_TEST_REGEX',
  'LLM_SAVE_CUSTOM_CATEGORY',
  'LLM_DELETE_CUSTOM_CATEGORY',
  'LLM_TEST_PROVIDER',
  'LLM_PREPARE_DOCUMENT',
  'LLM_SET_STUDY_TYPE',
  'DOCUMENT_PREPARE',
  'DOCUMENT_GET',
  'ANNOTATION_UPSERT',
  'ANNOTATION_DELETE',
  'ANNOTATION_CLEAR_DOCUMENT',
  'ARTICLE_ARCHIVE_PROBE',
  'ARTICLE_ARCHIVE_SAVE',
  'ARTICLE_ARCHIVE_LOAD',
  'ARTICLE_WORKSPACE_ENSURE',
  'ARTICLE_WORKSPACE_SAVE_ASSET',
  'ARTICLE_WORKSPACE_SAVE_TURN',
  'ARTICLE_WORKSPACE_UPDATE_TURN',
  'ARTICLE_WORKSPACE_DELETE_TURN',
  'ARTICLE_WORKSPACE_PROBE',
  'ARTICLE_WORKSPACE_SCAN_RESTORE',
  'ARTICLE_WORKSPACE_LIST',
  'ARTICLE_WORKSPACE_DETAIL',
  'ARTICLE_WORKSPACE_STATS',
  'ARTICLE_WORKSPACE_EXPORT',
  'ARTICLE_WORKSPACE_BEGIN_DELETE',
  'ARTICLE_WORKSPACE_FINALIZE_DELETE',
  'ARTICLE_WORKSPACE_REBUILD_INDEX',
  'MIGRATION_EXPORT',
  'MIGRATION_IMPORT',
  'LLM_ANALYZE_DOCUMENT',
  'LLM_ANALYZE_FIGURES',
  'LLM_ANALYZE_FIGURE_PANEL',
  'LLM_CONTROL_OPERATION',
  'LLM_ASK_FIGURE_PANEL',
  'LLM_ASK_ARTICLE',
  'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
  'LLM_ANALYZE_REVIEW_OUTLINE',
  'LLM_RECORD_FEEDBACK',
  'LLM_CORPUS_STATUS',
  'LLM_TOKEN_USAGE_LIST',
  'LLM_TOKEN_USAGE_CLEAR',
  'LLM_EXPORT_CORPUS',
  'LLM_DISTILL_RULES',
  'PORTABLE_CONFIG_PROBE',
  'PORTABLE_CONFIG_CREATE',
  'PORTABLE_CONFIG_UNLOCK',
  'PORTABLE_CONFIG_ROTATE_PASSPHRASE',
  'PORTABLE_CONFIG_FORGET_KEY',
  'PORTABLE_CONFIG_BACKUP_NOW',
  'PORTABLE_CONFIG_STATUS',
  'USER_DATA_SYNC_STATUS',
  'USER_DATA_SYNC_NOW',
  'USER_DATA_REBUILD_INDEX',
  'USER_DATA_EXPORT_BUNDLE'
]);

const TOKEN_USAGE_FEATURES = new Map([
  ['LLM_ANALYZE_DOCUMENT', ['highlight', '文段高亮（高亮匹配）']],
  ['LLM_ANALYZE_REVIEW_OUTLINE', ['paragraph_summary', '段落概述']],
  ['LLM_ANALYZE_FIGURES', ['figure_walkthrough', '逐图解读']],
  ['LLM_ANALYZE_FIGURE_PANEL', ['figure_panel', 'Panel 解读']],
  ['LLM_ASK_FIGURE_PANEL', ['panel_followup', 'Panel 追问']],
  ['LLM_ANALYZE_CROSS_FIGURE_LOGIC', ['cross_figure', '跨图串解']],
  ['LLM_ASK_ARTICLE', ['article_chat', '全文问答']]
]);

function recordTokenUsageProgress(message, sender, progress, reverseState) {
  if (progress?.phase !== 'provider_telemetry') return null;
  const feature = TOKEN_USAGE_FEATURES.get(message?.type);
  if (!feature) return null;
  const document = message?.document || {};
  const promise = tokenUsageStore.record({
    canonicalUrl: document.canonicalUrl || document.url ||
      message.documentUrl || sender?.tab?.url,
    documentKey: document.documentId || '',
    title: document.title || sender?.tab?.title || '',
    featureId: feature[0],
    featureLabel: feature[1],
    providerId: progress.providerId || progress.route?.providerId,
    model: progress.model || progress.route?.model,
    inputTokens: progress.inputTokens,
    outputTokens: progress.outputTokens,
    reasoningTokens: progress.reasoningTokens,
    cacheHitTokens: progress.cacheHitTokens,
    cacheMissTokens: progress.cacheMissTokens,
    estimated: progress.estimated === true
  }).catch(error => {
    console.warn('Brevess: unable to record token usage', error);
    return null;
  });
  if (!Array.isArray(reverseState.tokenUsageWrites)) reverseState.tokenUsageWrites = [];
  reverseState.tokenUsageWrites.push(promise);
  return promise;
}

async function coordinateOpenArticleWorkspaceTabs(action, workspaceId, workspaceGeneration = 1) {
  const normalizedWorkspaceId = String(workspaceId || '');
  if (!normalizedWorkspaceId) return { checked: 0, matched: 0, failed: 0 };
  const tabs = await chrome.tabs.query({});
  const candidates = tabs.filter(tab => Number.isInteger(tab.id));
  const responses = await Promise.all(candidates.map(async tab => {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action,
        workspaceId: normalizedWorkspaceId,
        workspaceGeneration: Math.max(1, Number(workspaceGeneration) || 1)
      });
      return { matched: response?.matched === true, failed: false };
    } catch (_) {
      return { matched: false, failed: false };
    }
  }));
  return {
    checked: candidates.length,
    matched: responses.filter(item => item.matched).length,
    failed: responses.filter(item => item.failed).length
  };
}

async function handleRoutedMessage(message, sender, onProgress, reverseState = {}) {
  const response = await llmRouter.handle(message, { onProgress });
  if (Array.isArray(reverseState.tokenUsageWrites) &&
      reverseState.tokenUsageWrites.length) {
    await Promise.allSettled(reverseState.tokenUsageWrites);
  }
  await publishCodexReverseEvent(
    response?.success ? 'result' : 'error',
    message,
    sender,
    response,
    reverseState
  );
  if (!response?.success || message?.coordinateOpenTabs !== true) return response;
  if (message.type === 'ARTICLE_WORKSPACE_BEGIN_DELETE') {
    response.data.openTabs = await coordinateOpenArticleWorkspaceTabs(
      'prepareExternalArticleWorkspaceDeletion',
      message.workspaceId,
      Number(response.data.workspaceGeneration) || 1
    );
  } else if (message.type === 'ARTICLE_WORKSPACE_FINALIZE_DELETE' && response.data.deleted) {
    response.data.openTabs = await coordinateOpenArticleWorkspaceTabs(
      'finalizeExternalArticleWorkspaceDeletion',
      message.workspaceId,
      response.data.workspaceGeneration
    );
  }
  return response;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(
      offset, Math.min(bytes.length, offset + chunkSize)
    ));
  }
  return btoa(binary);
}

function parseRemoteFigureUrl(value, errorCode = 'FIGURE_INVALID_RESOURCE_URL') {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch (_) {
    throw Object.assign(new Error('Figure 资源地址无效'), { code: errorCode });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error('只允许读取 HTTP(S) Figure 资源'), {
      code: errorCode
    });
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  return url;
}

function figureFetchReferrer(message, resourceUrl) {
  try {
    const pageUrl = new URL(String(message?.documentUrl || ''));
    return ['http:', 'https:'].includes(pageUrl.protocol) &&
      pageUrl.origin === resourceUrl.origin ? `${pageUrl.origin}/` : '';
  } catch (_) {
    return '';
  }
}

async function readFigureHtmlResponse(response, maximumBytes = 4 * 1024 * 1024) {
  const declaredLength = Number(response.headers.get('content-length')) || 0;
  if (declaredLength > maximumBytes) {
    throw Object.assign(new Error('Figure 大图页面超过解析上限'), {
      code: 'FIGURE_VIEWER_HTML_TOO_LARGE'
    });
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) {
      throw Object.assign(new Error('Figure 大图页面超过解析上限'), {
        code: 'FIGURE_VIEWER_HTML_TOO_LARGE'
      });
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw Object.assign(new Error('Figure 大图页面超过解析上限'), {
        code: 'FIGURE_VIEWER_HTML_TOO_LARGE'
      });
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

const figureViewerResolutionCache = new Map();

async function resolveFigureImageCandidates(message = {}) {
  const url = parseRemoteFigureUrl(message.url);
  const cached = figureViewerResolutionCache.get(url.href);
  if (cached && Date.now() - cached.capturedAt < 30 * 60 * 1000) {
    return { ...cached.data, cacheHit: true };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url.href, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'include',
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=.9,text/html;q=.8'
      },
      referrer: figureFetchReferrer(message, url) || undefined,
      referrerPolicy: 'strict-origin-when-cross-origin',
      signal: controller.signal
    });
    if (!response.ok) {
      throw Object.assign(new Error(`Figure 大图资源读取失败（HTTP ${response.status}）`), {
        code: 'FIGURE_VIEWER_FETCH_FAILED'
      });
    }
    const contentType = String(response.headers.get('content-type') || '')
      .split(';', 1)[0].trim().toLowerCase();
    let candidates = [];
    if (/^image\//.test(contentType)) {
      await response.body?.cancel?.().catch(() => {});
      candidates = [response.url || url.href];
    } else if (/^(?:text\/html|application\/xhtml\+xml|text\/plain)$/.test(contentType)) {
      const html = await readFigureHtmlResponse(response);
      if (/(?:cf-chl-|captcha|making sure you(?:'|&#39;)re not a bot|security verification|verify you are human|access denied)/i
        .test(html.slice(0, 500000))) {
        throw Object.assign(new Error('出版社的大图页面返回了安全验证，改用页面内原图候选'), {
          code: 'FIGURE_VIEWER_SECURITY_CHALLENGE'
        });
      }
      candidates = SciLLM.extractFigureImageCandidatesFromHtml(
        html,
        response.url || url.href
      );
    } else {
      throw Object.assign(new Error('链接既不是图片，也不是可解析的大图页面'), {
        code: 'FIGURE_VIEWER_UNSUPPORTED_RESOURCE'
      });
    }
    const data = {
      candidates: candidates.slice(0, 80),
      sourceUrl: response.url || url.href,
      contentType
    };
    figureViewerResolutionCache.set(url.href, { capturedAt: Date.now(), data });
    if (figureViewerResolutionCache.size > 100) {
      figureViewerResolutionCache.delete(figureViewerResolutionCache.keys().next().value);
    }
    return { ...data, cacheHit: false };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw Object.assign(new Error('Figure 大图页面解析超时'), {
        code: 'FIGURE_VIEWER_FETCH_TIMEOUT'
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchExportImageResourceUncached(message = {}) {
  const rawUrl = String(message.url || '').trim();
  let url;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    throw Object.assign(new Error('图片地址无效'), { code: 'EXPORT_INVALID_IMAGE_URL' });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error('只允许导出 HTTP(S) Figure 图片'), {
      code: 'EXPORT_INVALID_IMAGE_URL'
    });
  }
  let referrer = '';
  try {
    const pageUrl = new URL(String(message.documentUrl || ''));
    if (['http:', 'https:'].includes(pageUrl.protocol) &&
        pageUrl.origin === url.origin) {
      referrer = `${pageUrl.origin}/`;
    }
  } catch (_) {}
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(url.href, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'include',
      referrer: referrer || undefined,
      referrerPolicy: 'strict-origin-when-cross-origin',
      signal: controller.signal
    });
    if (!response.ok) {
      throw Object.assign(new Error(`高清图下载失败（HTTP ${response.status}）`), {
        code: 'EXPORT_IMAGE_FETCH_FAILED'
      });
    }
    const contentType = String(response.headers.get('content-type') || '')
      .split(';', 1)[0].trim().toLowerCase();
    if (!/^image\/(?:avif|png|jpe?g|webp|gif|tiff?|bmp|svg\+xml)$/.test(contentType)) {
      throw Object.assign(new Error('高清图地址没有返回图片'), {
        code: 'EXPORT_IMAGE_NOT_IMAGE'
      });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 40 * 1024 * 1024) {
      throw Object.assign(new Error('单张高清图为空或超过 40 MB'), {
        code: 'EXPORT_IMAGE_TOO_LARGE'
      });
    }
    return {
      dataUrl: `data:${contentType};base64,${bytesToBase64(bytes)}`,
      contentType,
      byteLength: bytes.length,
      sourceUrl: response.url || url.href
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw Object.assign(new Error('高清图下载超时'), {
        code: 'EXPORT_IMAGE_FETCH_TIMEOUT'
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchExportImageResource(message = {}) {
  const url = parseRemoteFigureUrl(message.url, 'EXPORT_INVALID_IMAGE_URL');
  const cacheMode = ['read-only', 'read-write'].includes(message.cacheMode)
    ? message.cacheMode : 'none';
  if (cacheMode !== 'none') {
    try {
      const cached = await figureImageCache.get(url.href);
      const bytes = cached?.bytes instanceof Uint8Array
        ? cached.bytes : new Uint8Array(cached?.bytes || []);
      if (bytes.length) {
        return {
          dataUrl: `data:${cached.contentType};base64,${bytesToBase64(bytes)}`,
          contentType: cached.contentType,
          byteLength: bytes.length,
          sourceUrl: cached.sourceUrl || url.href,
          cacheHit: true
        };
      }
    } catch (_) {
      // Cache availability must never block the network fallback.
    }
  }
  const data = await fetchExportImageResourceUncached({
    ...message,
    url: url.href
  });
  if (cacheMode === 'read-write' && data?.dataUrl) {
    const encoded = String(data.dataUrl).split(',', 2)[1] || '';
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    await figureImageCache.put({
      requestedSourceUrl: url.href,
      sourceUrl: data.sourceUrl || url.href,
      contentType: data.contentType,
      bytes
    }).catch(() => null);
  }
  return { ...data, cacheHit: false };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'LLM_FOUNDATION_STATUS') {
    sendResponse({
      success: true,
      data: {
        version: '1.0.0',
        categoryIds: Object.keys(SciLLM.createAdaptiveCategoryCatalog()),
        providerReady: true,
        adaptiveReadingReady: true
      }
    });
    return false;
  }

  if (message?.type === 'ONBOARDING_GET') {
    onboardingController.get()
      .then(data => {
        onboardingSnapshot = data;
        sendResponse({ success: true, data });
      })
      .catch(error => sendResponse({ success: false, error: { message: error.message } }));
    return true;
  }

  if (message?.type === 'SIDE_PANEL_DOCUMENT_READY' && sender.tab?.id) {
    const tab = {
      ...sender.tab,
      // Treat the browser-owned sender URL as authoritative. The payload is
      // only a fallback for older Chromium builds that omit it during pageshow.
      url: String(sender.tab.url || message.url || '')
    };
    SciLLM.isTabActivated(chrome.storage.session, tab).then(async activated => {
      if (activated) {
        activatedSidePanelTabIds.add(tab.id);
        await ensureGlobalSidePanelAvailability();
      }
      sendResponse({ success: true, activated, shouldArmRestore: false });
    }).catch(error => sendResponse({
      success: false,
      activated: false,
      error: error.message
    }));
    return true;
  }

  if (message?.type === 'ONBOARDING_SET_STEP') {
    onboardingController.setStep(message.step, message.status)
      .then(data => {
        onboardingSnapshot = data;
        sendResponse({ success: true, data });
      })
      .catch(error => sendResponse({ success: false, error: { message: error.message } }));
    return true;
  }

  if (message?.type === 'ONBOARDING_PREPARE_FINISH') {
    resolveOnboardingSourceTab(message.sourceTab || {}, sender.tab?.windowId)
      .then(async sourceTab => {
        if (!Number.isInteger(sourceTab?.tabId)) {
          return { prepared: false, reason: 'source-tab-missing' };
        }
        await ensureGlobalSidePanelAvailability();
        return { prepared: true, tabId: sourceTab.tabId };
      })
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: { message: error.message } }));
    return true;
  }

  if (message?.type === 'ONBOARDING_RESTART') {
    resolveOnboardingSourceTab(message.sourceTab || {}, sender.tab?.windowId)
      .then(sourceTab => onboardingController.restart(sourceTab))
      .then(data => {
        onboardingSnapshot = data;
        sendResponse({ success: true, data });
      })
      .catch(error => sendResponse({ success: false, error: { message: error.message } }));
    return true;
  }

  if (message?.type === 'ONBOARDING_FINISH') {
    const sourceTab = message.sourceTab || {};
    const tabId = Number(sourceTab.tabId);
    const windowId = Number(sourceTab.windowId);
    if (!Number.isInteger(tabId)) {
      sendResponse({ success: true, data: { opened: false, reason: 'source-tab-missing' } });
      return false;
    }
    // Keep sidePanel.open in the completion click's user gesture. State is
    // already terminal before options.js enables this button.
    activatedSidePanelTabIds.add(tabId);
    // The global panel was enabled by ONBOARDING_PREPARE_FINISH before the
    // Finish button became clickable, so open() cannot race setOptions().
    const openPromise = chrome.sidePanel.open({ windowId });
    // Persist activation before focusing the source tab. Focusing fires
    // tabs.onActivated synchronously enough that the listener could otherwise
    // observe a stale inactive state and disable the panel we just opened.
    const activationPromise = chrome.tabs.get(tabId).then(currentTab =>
      SciLLM.markTabActivated(chrome.storage.session, currentTab)
    );
    const focusPromise = activationPromise.then(() =>
      chrome.tabs.update(tabId, { active: true })
    );
    const windowPromise = Number.isInteger(windowId) && chrome.windows?.update
      ? chrome.windows.update(windowId, { focused: true }) : Promise.resolve();
    Promise.all([openPromise, activationPromise, focusPromise, windowPromise])
      .then(([, activation]) => {
        chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
        chrome.tabs.sendMessage(tabId, { action: 'disarmSidePanelRestore' }).catch(() => {});
        // Let options.js close its own tab after this response arrives. Closing
        // the sender here can destroy the message channel before completion.
        sendResponse({
          success: true,
          data: { opened: true, tabId, settingsTabId: sender.tab?.id || null }
        });
      })
      .catch(error => sendResponse({ success: false, error: { message: error.message } }));
    return true;
  }

  if (message?.type === 'SIDE_PANEL_RESTORE_FROM_USER_GESTURE' && sender.tab?.id) {
    const tabId = sender.tab.id;
    Promise.all([
      ensureGlobalSidePanelAvailability(),
      chrome.sidePanel.open({ windowId: sender.tab.windowId })
    ]).then(() => {
      activatedSidePanelTabIds.add(tabId);
      chrome.tabs.sendMessage(tabId, { action: 'disarmSidePanelRestore' }).catch(() => {});
      sendResponse({ success: true });
    }).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.type === 'EXPORT_FETCH_IMAGE_RESOURCE') {
    SciLLM.keepAliveUntil(fetchExportImageResource(message), chrome)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({
        success: false,
        error: {
          code: String(error?.code || 'EXPORT_IMAGE_FETCH_FAILED'),
          message: String(error?.message || '高清 Figure 图片下载失败')
        }
      }));
    return true;
  }

  if (message?.type === 'FIGURE_RESOLVE_IMAGE_CANDIDATES') {
    SciLLM.keepAliveUntil(resolveFigureImageCandidates(message), chrome)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({
        success: false,
        error: {
          code: String(error?.code || 'FIGURE_VIEWER_FETCH_FAILED'),
          message: String(error?.message || '无法解析 Figure 大图链接')
        }
      }));
    return true;
  }

  if (message?.type === 'ZOTERO_IMPORT_ENHANCED_SNAPSHOT') {
    SciLLM.keepAliveUntil(
      SciLLM.saveEnhancedSnapshotToZotero(message.payload || {}),
      chrome
    ).then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({
        success: false,
        error: {
          code: String(error?.code || 'ZOTERO_IMPORT_FAILED'),
          message: String(error?.message || '无法保存到 Zotero')
        }
      }));
    return true;
  }

  if (ROUTED_MESSAGE_TYPES.has(message?.type)) {
    const reverseState = { localCodex: false, tokenUsageWrites: [] };
    const onProgress = progress => Promise.allSettled([
        recordTokenUsageProgress(message, sender, progress, reverseState),
        sender.tab?.id
          ? chrome.tabs.sendMessage(sender.tab.id, {
            action: 'llmAnalysisProgress',
            progress: {
              ...progress,
              workspaceLifecycle: Number.isInteger(message.workspaceLifecycle)
                ? message.workspaceLifecycle : undefined
            }
          }).catch(() => {})
          : Promise.resolve(),
        publishCodexReverseEvent(
          'progress',
          message,
          sender,
          progress,
          reverseState
        )
      ]);
    SciLLM.keepAliveUntil(
      handleRoutedMessage(message, sender, onProgress, reverseState),
      chrome
    ).then(sendResponse);
    return true;
  }

  return false;
});
