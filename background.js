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
  'providers/provider-utils.js',
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

const onboardingController = SciLLM.createOnboardingController({
  storageArea: chrome.storage.local
});
let onboardingSnapshot = null;
onboardingController.get().then(state => {
  onboardingSnapshot = state;
}).catch(() => {});

async function configureSidePanelAction() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  // The action handler opens one window-level panel after recording exactly
  // which tab the user activated. Automatic action behavior cannot provide
  // that ordering and caused untouched tabs to be scanned.
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
}

const FLOATING_PANEL_SESSION_KEY = 'sciFloatingPanelPin';
let floatingPanelPinnedTabId = null;
const floatingPanelStateReady = chrome.storage.session.get(FLOATING_PANEL_SESSION_KEY)
  .then(stored => {
    const tabId = Number(stored?.[FLOATING_PANEL_SESSION_KEY]?.tabId);
    floatingPanelPinnedTabId = Number.isInteger(tabId) && tabId >= 0 ? tabId : null;
  })
  .catch(() => {});

async function setFloatingPanelPinState(pinned, tabId = null) {
  await floatingPanelStateReady;
  const normalizedTabId = Number(tabId);
  floatingPanelPinnedTabId = pinned === true && Number.isInteger(normalizedTabId) &&
    normalizedTabId >= 0 ? normalizedTabId : null;
  if (floatingPanelPinnedTabId === null) {
    await chrome.storage.session.remove(FLOATING_PANEL_SESSION_KEY);
  } else {
    await chrome.storage.session.set({
      [FLOATING_PANEL_SESSION_KEY]: {
        tabId: floatingPanelPinnedTabId,
        pinnedAt: Date.now()
      }
    });
  }
  await syncActiveTabSidePanels();
  return floatingPanelPinnedTabId;
}

async function setTabSidePanelAvailability(tabId, enabled) {
  if (!chrome.sidePanel?.setOptions || !Number.isInteger(Number(tabId))) return;
  await floatingPanelStateReady;
  await chrome.sidePanel.setOptions({
    tabId: Number(tabId),
    path: 'popup.html',
    // A pinned Document Picture-in-Picture window must keep its side-panel
    // opener alive while the user moves through other tabs.
    enabled: enabled === true || floatingPanelPinnedTabId !== null
  });
}

const activatedSidePanelTabIds = new Set();
const pendingSidePanelRestoreTabIds = new Set();
const tabSidePanelNavigationGenerations = new Map();

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
  await setTabSidePanelAvailability(tab.id, activated);
  return activated;
}

async function syncActiveTabSidePanels() {
  if (!chrome.tabs?.query) return;
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(syncTabSidePanelAvailability));
}

async function armTabSidePanelRestore(tabId, windowId) {
  let lastError = null;
  for (const delayMs of [0, 40, 120]) {
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    try {
      await SciLLM.sendTabMessageWithRecovery(chrome, tabId, {
        action: 'armSidePanelRestore',
        windowId
      });
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('SIDE_PANEL_RESTORE_ARM_FAILED');
}

function beginToolbarSidePanelOpen(tab) {
  if (!tab?.id || !tab?.windowId) return;
  // Both extension API calls must start before the toolbar listener yields;
  // Edge invalidates the sidePanel.open user gesture after an awaited storage read.
  const enablePromise = setTabSidePanelAvailability(tab.id, true);
  const openPromise = chrome.sidePanel.open({ tabId: tab.id });
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
      await setTabSidePanelAvailability(tab.id, false).catch(() => {});
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
      await armTabSidePanelRestore(tabId, windowId).catch(() => {});
    }
  }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.status) return;
  const generation = (tabSidePanelNavigationGenerations.get(tabId) || 0) + 1;
  tabSidePanelNavigationGenerations.set(tabId, generation);
  SciLLM.isTabActivated(chrome.storage.session, tab).then(async stillActivated => {
    if (tabSidePanelNavigationGenerations.get(tabId) !== generation) return;
    const wasAvailable = activatedSidePanelTabIds.has(tabId);
    if (!stillActivated) {
      activatedSidePanelTabIds.delete(tabId);
      pendingSidePanelRestoreTabIds.delete(tabId);
      await setTabSidePanelAvailability(tabId, false);
      return;
    }
    activatedSidePanelTabIds.add(tabId);
    if (!wasAvailable || changeInfo.status === 'loading') {
      pendingSidePanelRestoreTabIds.add(tabId);
    }
    await setTabSidePanelAvailability(tabId, true);
    const documentReady = changeInfo.status === 'complete' ||
      (Boolean(changeInfo.url) && tab.status === 'complete');
    if (!documentReady || !pendingSidePanelRestoreTabIds.has(tabId)) return;
    await armTabSidePanelRestore(tabId, tab.windowId);
    if (tabSidePanelNavigationGenerations.get(tabId) === generation) {
      pendingSidePanelRestoreTabIds.delete(tabId);
    }
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (Number(tabId) === Number(floatingPanelPinnedTabId)) {
    void setFloatingPanelPinState(false).catch(() => {});
  }
  activatedSidePanelTabIds.delete(tabId);
  pendingSidePanelRestoreTabIds.delete(tabId);
  tabSidePanelNavigationGenerations.delete(tabId);
  SciLLM.clearTabActivation(chrome.storage.session, tabId).catch(() => {});
});

chrome.tabs.onCreated.addListener(tab => {
  if (floatingPanelPinnedTabId !== null && tab?.id) {
    void setTabSidePanelAvailability(tab.id, true).catch(() => {});
  }
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

async function handleRoutedMessage(message, sender, onProgress) {
  const response = await llmRouter.handle(message, { onProgress });
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'LLM_FOUNDATION_STATUS') {
    sendResponse({
      success: true,
      data: {
        version: '2.4.5',
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
        pendingSidePanelRestoreTabIds.delete(tab.id);
        await setTabSidePanelAvailability(tab.id, true);
      }
      sendResponse({ success: true, activated });
    }).catch(error => sendResponse({
      success: false,
      activated: false,
      error: error.message
    }));
    return true;
  }

  if (message?.type === 'FLOATING_SIDE_PANEL_PIN_STATE') {
    setFloatingPanelPinState(message.pinned === true, message.tabId)
      .then(tabId => sendResponse({
        success: true,
        pinned: tabId !== null,
        tabId
      }))
      .catch(error => sendResponse({ success: false, error: error.message }));
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
        await setTabSidePanelAvailability(sourceTab.tabId, true);
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
    // The source tab was enabled by ONBOARDING_PREPARE_FINISH before the
    // Finish button became clickable, so open() cannot race setOptions().
    const openPromise = chrome.sidePanel.open({ tabId });
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
        progress: {
          ...progress,
          workspaceLifecycle: Number.isInteger(message.workspaceLifecycle)
            ? message.workspaceLifecycle : undefined
        }
      }).catch(() => {})
      : undefined;
    SciLLM.keepAliveUntil(
      handleRoutedMessage(message, sender, onProgress),
      chrome
    ).then(sendResponse);
    return true;
  }

  return false;
});
