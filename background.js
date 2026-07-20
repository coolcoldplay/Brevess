importScripts(
  'core/tab-activation.js',
  'core/category-store.js',
  'core/adaptive-catalog.js',
  'core/study-profile.js',
  'core/confidence-policy.js',
  'core/publisher-adapters.js',
  'core/article-structure.js',
  'providers/provider-utils.js',
  'core/prompt-compiler.js',
  'core/chunker.js',
  'core/result-validator.js',
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
  'core/cache-planner.js',
  'core/article-archive.js',
  'core/migration-bundle.js',
  'core/settings-store.js',
  'core/service-worker-keepalive.js',
  'core/offscreen-fetch.js',
  'providers/openai.js',
  'providers/anthropic.js',
  'providers/gemini.js',
  'providers/deepseek.js',
  'providers/openai-compatible.js',
  'providers/provider-registry.js',
  'core/task-profile-router.js',
  'core/token-budget.js',
  'core/operation-control.js',
  'core/analysis-pipeline.js',
  'core/analysis-cache.js',
  'core/review-outline-pipeline.js',
  'core/corpus-store.js',
  'core/manual-annotations.js',
  'core/user-data-database.js',
  'core/article-workspace.js',
  'core/article-workspace-store.js',
  'core/document-store.js',
  'core/directory-sync.js',
  'core/background-router.js'
);

async function configureSidePanelAction() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  // The action handler opens one window-level panel after recording exactly
  // which tab the user activated. Automatic action behavior cannot provide
  // that ordering and caused untouched tabs to be scanned.
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
}

async function setTabSidePanelAvailability(tabId, enabled) {
  if (!chrome.sidePanel?.setOptions || !Number.isInteger(Number(tabId))) return;
  await chrome.sidePanel.setOptions({
    tabId: Number(tabId),
    path: 'popup.html',
    enabled: enabled === true
  });
}

const activatedSidePanelTabIds = new Set();

async function syncTabSidePanelAvailability(tab) {
  if (!tab?.id) return false;
  const activated = await SciLLM.isTabActivated(chrome.storage.session, tab);
  if (activated) activatedSidePanelTabIds.add(tab.id);
  else activatedSidePanelTabIds.delete(tab.id);
  await setTabSidePanelAvailability(tab.id, activated);
  return activated;
}

async function syncActiveTabSidePanels() {
  if (!chrome.tabs?.query) return;
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(syncTabSidePanelAvailability));
}

async function activateTabAndOpenSidePanel(tab) {
  if (!tab?.id || !tab?.windowId) return;
  // Invoke open synchronously inside the toolbar click's user gesture. The
  // activation marker can settle in parallel; the panel receives a follow-up
  // message before it is allowed to inject into the tab.
  // Queue the per-tab enable call before open while both calls still occur in
  // the toolbar gesture. Chromium processes extension API calls in order.
  activatedSidePanelTabIds.add(tab.id);
  const enablePromise = setTabSidePanelAvailability(tab.id, true);
  const openPromise = chrome.sidePanel.open({ tabId: tab.id });
  const activationPromise = SciLLM.markTabActivated(chrome.storage.session, tab);
  const [, , activation] = await Promise.all([
    enablePromise, openPromise, activationPromise
  ]);
  chrome.runtime.sendMessage({
    type: 'PANEL_TAB_ACTIVATED',
    activation
  }).catch(() => {});
  chrome.tabs.sendMessage(tab.id, { action: 'disarmSidePanelRestore' }).catch(() => {});
}

chrome.action.onClicked.addListener(tab => {
  activateTabAndOpenSidePanel(tab).catch(error =>
    console.warn('SCI 论文逻辑助手：无法激活当前标签页', error)
  );
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  chrome.tabs.get(tabId).then(async tab => {
    const activated = await syncTabSidePanelAvailability(tab);
    if (activated) {
      // Edge currently does not automatically re-show a previously open
      // site-specific panel, and sidePanel.open() cannot run from onActivated
      // because the API requires a user gesture. Arm a lightweight page-level
      // restore action so the first real pointer/key gesture reopens this tab's
      // panel without changing the user's click target.
      await chrome.tabs.sendMessage(tabId, {
        action: 'armSidePanelRestore',
        windowId
      }).catch(() => {});
    }
  }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  SciLLM.isTabActivated(chrome.storage.session, tab).then(stillActivated => {
    if (stillActivated) {
      activatedSidePanelTabIds.add(tabId);
      return setTabSidePanelAvailability(tabId, true);
    }
    activatedSidePanelTabIds.delete(tabId);
    return Promise.all([
      SciLLM.clearTabActivation(chrome.storage.session, tabId),
      setTabSidePanelAvailability(tabId, false)
    ]);
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(tabId => {
  activatedSidePanelTabIds.delete(tabId);
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

chrome.runtime.onInstalled.addListener(() => {
  Promise.all([configureSidePanelAction(), syncActiveTabSidePanels()]).catch(error =>
    console.warn('SCI 论文逻辑助手：无法启用侧栏点击行为', error)
  );
});
chrome.runtime.onStartup.addListener(() => {
  Promise.all([configureSidePanelAction(), syncActiveTabSidePanels()]).catch(error =>
    console.warn('SCI 论文逻辑助手：无法恢复侧栏点击行为', error)
  );
});
configureSidePanelAction().catch(error =>
  console.warn('SCI 论文逻辑助手：侧栏初始化失败', error)
);
syncActiveTabSidePanels().catch(() => {});

const analysisCache = SciLLM.createIndexedDbAnalysisCache(indexedDB);
const corpusStore = SciLLM.createIndexedDbCorpusStore(indexedDB);
const documentStore = SciLLM.createIndexedDbDocumentStore(indexedDB);
const articleWorkspaceStore = SciLLM.createIndexedDbArticleWorkspaceStore(indexedDB);
const directorySync = SciLLM.createDirectorySync({
  handleStore: SciLLM.createIndexedDbDirectoryHandleStore(indexedDB),
  queueStore: SciLLM.createIndexedDbSyncQueue(indexedDB),
  sourceId: 'extension'
});
const providerFetch = SciLLM.createOffscreenFetch(chrome);
const llmRouter = SciLLM.createBackgroundRouter({
  storageArea: chrome.storage.local,
  sessionStorageArea: chrome.storage.session,
  fetchImpl: providerFetch,
  cacheStore: analysisCache,
  corpusStore,
  documentStore,
  articleWorkspaceStore,
  directorySync
});

const ROUTED_MESSAGE_TYPES = new Set([
  'LLM_GET_SETTINGS',
  'LLM_SAVE_PROFILE',
  'LLM_DUPLICATE_PROFILE',
  'LLM_DELETE_PROFILE',
  'LLM_UPDATE_PROFILE_ROUTING',
  'LLM_TEST_PROFILE',
  'LLM_SAVE_PROVIDER',
  'LLM_UPDATE_PREFERENCES',
  'CATEGORY_GET',
  'CATEGORY_SAVE_OVERRIDE',
  'CATEGORY_RESET_OVERRIDE',
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
  'LLM_EXPORT_CORPUS',
  'LLM_DISTILL_RULES',
  'USER_DATA_SYNC_STATUS',
  'USER_DATA_SYNC_NOW',
  'USER_DATA_REBUILD_INDEX',
  'USER_DATA_EXPORT_BUNDLE'
]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'LLM_FOUNDATION_STATUS') {
    sendResponse({
      success: true,
      data: {
        version: '2.3.0',
        categoryIds: Object.keys(SciLLM.createAdaptiveCategoryCatalog()),
        providerReady: true,
        adaptiveReadingReady: true
      }
    });
    return false;
  }

  if (message?.type === 'SIDE_PANEL_RESTORE_FROM_USER_GESTURE' && sender.tab?.id) {
    const tabId = sender.tab.id;
    Promise.all([
      setTabSidePanelAvailability(tabId, true),
      chrome.sidePanel.open({ tabId })
    ]).then(() => {
      activatedSidePanelTabIds.add(tabId);
      chrome.tabs.sendMessage(tabId, { action: 'disarmSidePanelRestore' }).catch(() => {});
      sendResponse({ success: true });
    }).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (ROUTED_MESSAGE_TYPES.has(message?.type)) {
    const onProgress = sender.tab?.id
      ? progress => chrome.tabs.sendMessage(sender.tab.id, {
          action: 'llmAnalysisProgress',
          progress
        }).catch(() => {})
      : undefined;
    SciLLM.keepAliveUntil(
      llmRouter.handle(message, { onProgress }),
      chrome
    ).then(sendResponse);
    return true;
  }

  return false;
});
