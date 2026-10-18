importScripts(
  'core/literature-radar-model.js',
  'core/literature-radar-store.js',
  'core/literature-radar-pubmed.js',
  'core/literature-radar-service.js',
  'core/literature-radar-background.js',
  'core/literature-radar-ai.js',
  'core/i18n.js',
  'core/onboarding.js',
  'core/tab-activation.js',
  'core/page-tools.js',
  'core/literature-url.js',
  'core/page-load-indicator.js',
  'core/pdf-workspace.js',
  'core/pdf-figure-engine.js',
  'core/tab-messenger.js',
  'core/category-store.js',
  'core/adaptive-catalog.js',
  'core/highlight-presentation.js',
  'core/study-profile.js',
  'core/confidence-policy.js',
  'core/publisher-adapters.js',
  'core/article-structure.js',
  'core/abbreviation-extractor.js',
  'providers/provider-utils.js',
  'core/article-chat-web-sources.js',
  'core/codex-native-client.js',
  'core/workspace-directory-native-client.js',
  'core/workspace-directory-controller.js',
  'core/prompt-compiler.js',
  'core/provider-probes.js',
  'core/chunker.js',
  'core/result-validator.js',
  'core/jev-highlight.js',
  'core/semantic-find.js',
  'core/semantic-find-service.js',
  'core/semantic-find-launcher.js',
  'core/highlight-stream.js',
  'core/evidence-ledger.js',
  'core/figure-panel-planner.js',
  'core/figure-panel-recovery.js',
  'core/figure-analysis.js',
  'core/figure-stage-diagnostics.js',
  'core/pdf-figure-request.js',
  'core/pdf-figure-panel-inventory.js',
  'core/supplemental-materials.js',
  'core/research-logic-map.js',
  'core/article-chat-tokenizer.js',
  'core/article-chat-index.js',
  'core/article-chat-retrieval.js',
  'core/article-chat-memory.js',
  'core/article-chat-context-planner.js',
  'core/article-chat-citations.js',
  'core/article-chat-stream.js',
  'core/article-chat-attachments.js',
  'core/article-chat.js',
  'core/research-evidence.js',
  'core/research-logic-pipeline.js',
  'core/panel-ledger.js',
  'core/evidence-first-mechanism.js',
  'core/cross-figure-logic.js',
  'core/review-outline.js',
  'core/zotero-connector.js',
  'core/cache-planner.js',
  'core/privacy-sanitizer.js',
  'core/mechanism-canvas-model.js',
  'core/figure-result-binding.js',
  'core/figure-workspace.js',
  'core/article-archive.js',
  'core/migration-bundle.js',
  'core/keyboard-shortcuts.js',
  'core/literature-note-sources.js',
  'core/literature-note-findings-review.js',
  'core/literature-note-review-execution.js',
  'core/reading-tools.js',
  'core/literature-note-source-storage.js',
  'core/selection-ai.js',
  'core/llm-task-catalog.js',
  'core/task-telemetry.js',
  'core/token-budget.js',
  'core/tts-service.js',
  'core/settings-store.js',
  'core/tts-router.js',
  'core/service-worker-keepalive.js',
  'core/offscreen-fetch.js',
  'core/tiff-decoder.js',
  'core/tiff-client.js',
  'core/tiff-source-cache.js',
  'providers/openai.js',
  'providers/anthropic.js',
  'providers/gemini.js',
  'providers/deepseek.js',
  'providers/typesafe.js',
  'providers/codex-local.js',
  'providers/deepseek-harness.js',
  'core/harness-native-client.js',
  'providers/openai-compatible.js',
  'providers/provider-registry.js',
  'core/provider-model-discovery.js',
  'core/task-profile-router.js',
  'core/translation-checkpoint.js',
  'core/local-translator.js',
  'core/translation-task-service.js',
  'core/operation-control.js',
  'core/analysis-pipeline.js',
  'core/analysis-cache.js',
  'core/mechanism-operation-coordinator.js',
  'core/review-outline-pipeline.js',
  'core/corpus-store.js',
  'core/pdf-annotations.js',
  'core/manual-annotations.js',
  'core/user-data-database.js',
  'core/figure-image-cache.js',
  'core/figure-viewer.js',
  'core/figure-image-tiles.js',
  'core/article-workspace.js',
  'core/article-workspace-save.js',
  'core/article-workspace-store.js',
  'core/offline-article-workspace.js',
  'core/local-library-tags.js',
  'core/article-bibliography.js',
  'core/pdf-bibliography.js',
  'core/pdf-article-metadata.js',
  'core/pdf-metadata-enrichment.js',
  'core/local-reading-library.js',
  'core/token-usage-store.js',
  'core/document-store.js',
  'core/portable-config.js',
  'core/portable-config-manager.js',
  'core/directory-sync.js',
  'core/research-workbench-group-table.js',
  'core/research-workbench-model.js',
  'core/research-workbench-store.js',
  'core/research-workbench-sync.js',
  'core/research-workbench-directories.js',
  'core/research-workbench-prototype-catalog.js',
  'core/research-workbench-import-export.js',
  'core/research-workbench-resources.js',
  'core/runtime-workbench-bridge.js',
  'core/background-router.js'
);

const onboardingController = SciLLM.createOnboardingController({
  storageArea: chrome.storage.local
});
let onboardingSnapshot = null;
onboardingController.get().then(state => {
  onboardingSnapshot = state;
}).catch(() => {});

let abbreviationMemoryMutationTail = Promise.resolve();

async function loadGlobalAbbreviationMemory() {
  const key = SciLLM.GLOBAL_ABBREVIATION_MEMORY_KEY;
  const stored = await chrome.storage.local.get(key);
  return SciLLM.normalizeGlobalAbbreviationMemory(stored?.[key]);
}

function mergeGlobalAbbreviationEntries(entries, options = {}) {
  const operation = abbreviationMemoryMutationTail.then(async () => {
    const current = await loadGlobalAbbreviationMemory();
    const merged = SciLLM.mergeGlobalAbbreviationMemory(current, entries, {
      incrementSupport: options.incrementSupport === true,
      importedAt: options.importedAt
    });
    await chrome.storage.local.set({
      [SciLLM.GLOBAL_ABBREVIATION_MEMORY_KEY]: merged.memory
    });
    chrome.runtime.sendMessage({
      type: 'ABBREVIATION_MEMORY_CHANGED',
      memory: merged.memory
    }).catch(() => {});
    return merged;
  });
  abbreviationMemoryMutationTail = operation.catch(() => undefined);
  return operation;
}

function mutateGlobalAbbreviationEntry(mutation) {
  const operation = abbreviationMemoryMutationTail.then(async () => {
    const current = await loadGlobalAbbreviationMemory();
    const changed = SciLLM.mutateGlobalAbbreviationMemory(current, mutation, {
      now: new Date().toISOString()
    });
    await chrome.storage.local.set({
      [SciLLM.GLOBAL_ABBREVIATION_MEMORY_KEY]: changed.memory
    });
    localReadingLibraryCache = null;
    chrome.runtime.sendMessage({
      type: 'ABBREVIATION_MEMORY_CHANGED',
      memory: changed.memory
    }).catch(() => {});
    return changed;
  });
  abbreviationMemoryMutationTail = operation.catch(() => undefined);
  return operation;
}

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
// Use the persisted document activation, not the optimistic sidebar Set: J also
// injects content scripts and must never activate a page or its loading indicator.
const pageLoadIndicator = SciLLM.createPageLoadIndicator({
  chromeApi: chrome,
  isTabActivated: tab => SciLLM.isTabActivated(chrome.storage.session, tab)
});
pageLoadIndicator.start().catch(() => {});
const tabSidePanelNavigationGenerations = new Map();
let nextTabSidePanelNavigationGeneration = 0;
const actionPopupTabSnapshots = new Map();
const ACTION_POPUP_SNAPSHOT_TTL_MS = 60 * 1000;

function actionPopupReadableTab(tab) {
  if (!Number.isInteger(Number(tab?.id)) || !Number.isInteger(Number(tab?.windowId))) {
    return false;
  }
  const value = String(tab?.url || tab?.pendingUrl || '').trim();
  if (!value) return false;
  if (SciLLM.parseOfflineArticleReaderUrl(value, chrome.runtime.getURL(''))) return true;
  if (SciLLM.isPdfReaderUrl(value) || SciLLM.isLikelyPdfUrl(value, tab?.title)) return true;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'file:'].includes(url.protocol);
  } catch (_error) {
    return false;
  }
}

function rememberActionPopupTab(tab, documentId) {
  const nonce = crypto.randomUUID();
  const now = Date.now();
  for (const [key, snapshot] of actionPopupTabSnapshots.entries()) {
    if (now - snapshot.createdAt > ACTION_POPUP_SNAPSHOT_TTL_MS) {
      actionPopupTabSnapshots.delete(key);
    }
  }
  actionPopupTabSnapshots.set(nonce, {
    nonce,
    createdAt: now,
    documentId,
    tab: {
      id: Number(tab.id),
      windowId: Number(tab.windowId),
      url: String(tab.url || ''),
      pendingUrl: String(tab.pendingUrl || ''),
      title: String(tab.title || '')
    }
  });
  return nonce;
}

async function actionPopupPublicState() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0] || null;
  const readable = actionPopupReadableTab(tab);
  const activatedBefore = readable && (
    activatedSidePanelTabIds.has(tab.id) ||
    await SciLLM.isTabActivated(chrome.storage.session, tab).catch(() => false)
  );
  const frame = readable ? await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 }).catch(() => null) : null;
  return {
    tabId: Number.isInteger(Number(tab?.id)) ? Number(tab.id) : null,
    title: String(tab?.title || '当前页面').trim().slice(0, 120),
    readable,
    activatedBefore,
    primaryLabel: activatedBefore ? '继续研读' : '开始研读',
    historyUrl: 'options.html#page=data',
    settingsUrl: 'options.html#page=overview',
    nonce: readable ? rememberActionPopupTab(tab, frame?.documentId) : '',
    pageDocumentId: frame?.documentId || '',
    pageUrl: String(tab?.url || '').split('#')[0],
    pageTools: await independentPageTools.publicState(tab)
  };
}

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
  if (SciLLM.parseOfflineArticleReaderUrl(tab?.url || tab?.pendingUrl, chrome.runtime.getURL(''))) {
    return activateOfflineArticleReaderAndOpenSidePanel(tab, panelOpen);
  }
  if (!tab?.id || !tab?.windowId) return;
  const attempt = panelOpen || beginToolbarSidePanelOpen(tab);
  if (!attempt) return;
  activatedSidePanelTabIds.add(tab.id);
  const generation = tabSidePanelNavigationGenerations.get(tab.id) ||
    (++nextTabSidePanelNavigationGeneration);
  tabSidePanelNavigationGenerations.set(tab.id, generation);
  const expectedUrl = normalizedWarmUrl(tab);
  const contentPromise = SciLLM.ensureContentScriptForActivation(chrome, tab.id, {
    expectedUrl,
    contextKey: String(generation),
    isCurrent: () => tabSidePanelNavigationGenerations.get(tab.id) === generation
  });
  const activationPromise = SciLLM.markTabActivated(chrome.storage.session, tab);
  // Promise.all observes every branch even when another branch rejects.
  contentPromise.catch(() => {});
  activationPromise.catch(() => {});
  const [, , , activation] = await Promise.all([
    contentPromise, attempt.enablePromise, attempt.openPromise, activationPromise
  ]);
  chrome.runtime.sendMessage({
    type: 'PANEL_TAB_ACTIVATED',
    activation
  }).catch(() => {});
  chrome.tabs.sendMessage(tab.id, { action: 'disarmSidePanelRestore' }).catch(() => {});
  return { activation, pdfReader: false };
}

function normalizedWarmUrl(tab) {
  try {
    const url = new URL(String(tab?.url || tab?.pendingUrl || ''));
    url.hash = '';
    return url.href;
  } catch {
    return String(tab?.url || tab?.pendingUrl || '');
  }
}

async function readOfflineArticleForTab(tab, expectedUrl = '') {
  const readerUrl = normalizedWarmUrl(tab);
  if (expectedUrl && expectedUrl !== readerUrl) throw Object.assign(new Error('离线文献已切换，请重新打开'), { code: 'OFFLINE_READER_CHANGED' });
  const result = await SciLLM.readOfflineArticleWorkspace({ store: articleWorkspaceStore,
    readerUrl, runtimeBaseUrl: chrome.runtime.getURL('') });
  const current = await chrome.tabs.get(tab.id);
  if (current?.windowId !== tab.windowId || normalizedWarmUrl(current) !== readerUrl) {
    throw Object.assign(new Error('离线文献已切换，请重新打开'), { code: 'OFFLINE_READER_CHANGED' });
  }
  return result;
}

async function activateOfflineArticleReaderAndOpenSidePanel(tab, panelOpen) {
  const result = await readOfflineArticleForTab(tab);
  const attempt = panelOpen || beginToolbarSidePanelOpen(tab);
  if (!attempt) throw Object.assign(new Error('请从当前文献重新打开侧栏'), { code: 'OFFLINE_ACTIVATION_REQUIRED' });
  const activation = await SciLLM.markTabActivated(chrome.storage.session, tab);
  await Promise.all([attempt.enablePromise, attempt.openPromise]);
  activatedSidePanelTabIds.add(tab.id);
  chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
  return { activation, offlineReader: true, binding: result.binding };
}

async function syncActivatedTabAfterUpdate(tabId, generation, tab, { warm = false } = {}) {
  const stillActivated = await SciLLM.isTabActivated(chrome.storage.session, tab);
  if (tabSidePanelNavigationGenerations.get(tabId) !== generation) {
    return false;
  }
  if (!stillActivated) {
    activatedSidePanelTabIds.delete(tabId);
    return false;
  }
  activatedSidePanelTabIds.add(tabId);
  await ensureGlobalSidePanelAvailability().catch(() => {});
  if (tabSidePanelNavigationGenerations.get(tabId) !== generation) return false;
  if (!warm) return true;
  // The recovery sender verifies/injects content before warming it. No article
  // content is included in this cross-context handshake.
  const expectedUrl = normalizedWarmUrl(tab);
  await SciLLM.sendTabMessageWithRecovery(chrome, tabId, {
    action: 'warmArticleIndex', expectedUrl
  }, {
    expectedUrl,
    contextKey: String(generation),
    isCurrent: () => tabSidePanelNavigationGenerations.get(tabId) === generation
  });
  return tabSidePanelNavigationGenerations.get(tabId) === generation;
}

function warmActivatedArticleTab(tabId, generation, tab) {
  return syncActivatedTabAfterUpdate(tabId, generation, tab, { warm: true });
}

async function activatePdfReaderAndOpenSidePanel(tab, panelOpen) {
  if (!tab?.id || !tab?.windowId) return;
  const attempt = panelOpen || beginToolbarSidePanelOpen(tab);
  if (!attempt) return;
  const readerUrl = SciLLM.createPdfReaderUrl(
    chrome.runtime.getURL.bind(chrome.runtime),
    tab.url || tab.pendingUrl,
    tab.title
  );
  if (!readerUrl) {
    await activateTabAndOpenSidePanel(tab, attempt);
    return;
  }
  activatedSidePanelTabIds.add(tab.id);
  const activationTab = {
    ...tab,
    url: readerUrl,
    pendingUrl: readerUrl,
    title: String(tab.title || '文献 PDF')
  };
  const navigationPromise = chrome.tabs.update(tab.id, { url: readerUrl });
  const activationPromise = SciLLM.markTabActivated(
    chrome.storage.session,
    activationTab
  );
  const [, , , activation] = await Promise.all([
    attempt.enablePromise,
    attempt.openPromise,
    navigationPromise,
    activationPromise
  ]);
  chrome.runtime.sendMessage({
    type: 'PANEL_TAB_ACTIVATED',
    activation,
    pdfReader: true
  }).catch(() => {});
  return { activation, pdfReader: true, readerUrl };
}

async function activateTabFromOpenSidePanel(tab) {
  const panelOpen = {
    enablePromise: ensureGlobalSidePanelAvailability(),
    openPromise: Promise.resolve()
  };
  return SciLLM.isLikelyPdfUrl(tab?.url || tab?.pendingUrl, tab?.title)
    ? activatePdfReaderAndOpenSidePanel(tab, panelOpen)
    : activateTabAndOpenSidePanel(tab, panelOpen);
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

async function handleToolbarAction(tab, panelOpen) {
  if (SciLLM.isLikelyPdfUrl(tab?.url || tab?.pendingUrl, tab?.title)) {
    await activatePdfReaderAndOpenSidePanel(tab, panelOpen);
    return;
  }
  await activateTabAndOpenSidePanel(tab, panelOpen);
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  // The global panel stays open across tab changes. Only update which article
  // is active; popup.html will refresh against the newly selected tab.
  chrome.tabs.get(tabId).then(syncTabSidePanelAvailability).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.status) return;
  let generation = tabSidePanelNavigationGenerations.get(tabId);
  // A complete notification belongs to the navigation that already started.
  // Retiring recovery here can race a pending injection (or a second complete
  // notification) and execute top-level content declarations twice.
  if (!generation || changeInfo.url || changeInfo.status === 'loading') {
    generation = ++nextTabSidePanelNavigationGeneration;
    tabSidePanelNavigationGenerations.set(tabId, generation);
    SciLLM.forgetContentScriptState?.(tabId);
  }
  syncActivatedTabAfterUpdate(tabId, generation, tab, {
    warm: changeInfo.status === 'complete' ||
      (Boolean(changeInfo.url) && tab?.status === 'complete')
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(tabId => {
  activatedSidePanelTabIds.delete(tabId);
  tabSidePanelNavigationGenerations.delete(tabId);
  SciLLM.forgetContentScriptState?.(tabId);
  for (const [nonce, snapshot] of actionPopupTabSnapshots.entries()) {
    if (snapshot.tab.id === tabId) actionPopupTabSnapshots.delete(nonce);
  }
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
let localReadingLibraryCache = null;

async function loadLocalReadingLibrary() {
  const [workspaces, globalMemory] = await Promise.all([
    articleWorkspaceStore.listWorkspaces(),
    loadGlobalAbbreviationMemory()
  ]);
  const signature = JSON.stringify({
    workspaces: workspaces.map(item => [
      item.workspaceId, item.storageRevision, item.workspaceGeneration,
      item.updatedAt, item.deletionPending
    ]),
    abbreviations: globalMemory.entries.map(item => [
      item.abbreviation, item.fullName, item.meaningZh, item.definitionZh,
      item.updatedAt, item.firstImportedAt, item.entryId, item.hiddenFromReading
    ])
  });
  if (localReadingLibraryCache?.signature === signature) {
    return localReadingLibraryCache.library;
  }
  const assets = await Promise.all(workspaces.map(workspace =>
    articleWorkspaceStore.listAssets(workspace.workspaceId)
  ));
  const assetsByWorkspace = new Map(workspaces.map((workspace, index) => [
    workspace.workspaceId, assets[index]
  ]));
  const library = SciLLM.buildLocalReadingLibrary({
    workspaces, assetsByWorkspace, globalMemory
  });
  localReadingLibraryCache = { signature, library };
  return library;
}
async function sweepExpiredFigureRetryStagingBatches() {
  if (typeof articleWorkspaceStore.sweepExpiredFigureRetryStaging !== 'function') return;
  const deadline = Date.now() + 250;
  for (let pass = 0; pass < 4 && Date.now() <= deadline; pass += 1) {
    const result = await articleWorkspaceStore.sweepExpiredFigureRetryStaging({
      ttlMs: 7 * 24 * 60 * 60 * 1000,
      maxBatch: 50
    });
    if (result?.remainingExpired !== true) break;
  }
}
sweepExpiredFigureRetryStagingBatches().catch(() => {});
const figureImageCache = SciLLM.createIndexedDbFigureImageCache(indexedDB);
const tokenUsageStore = SciLLM.createTokenUsageStore(chrome.storage.local);
const directorySync = SciLLM.createDirectorySync({
  handleStore: SciLLM.createIndexedDbDirectoryHandleStore(indexedDB),
  queueStore: SciLLM.createIndexedDbSyncQueue(indexedDB),
  sourceId: 'extension'
});
// Created before portable startup probe, so restoration cannot race router construction.
const settingsMutationBarrier = SciLLM.createSettingsMutationBarrier();
function createSettingsMutationStorage(storageArea, barrier, getRuntimeLastError = () => globalThis.chrome?.runtime?.lastError) {
  return {
    get(...args) { return storageArea.get(...args); },
    set(value, callback) {
      if (!Object.hasOwn(value || {}, 'sciLlmSettingsV2')) {
        return typeof callback === 'function' ? storageArea.set(value, callback) : storageArea.set(value);
      }
      const finish = barrier.begin();
      if (typeof callback === 'function') {
        try {
          const pending = storageArea.set(value, (...args) => { finish(); callback(...args); });
          return pending && typeof pending.then === 'function' ? pending.finally(finish) : pending;
        } catch (error) { finish(); throw error; }
      }
      return new Promise((resolve, reject) => {
        const done = result => {
          const error = getRuntimeLastError();
          finish();
          if (error) reject(new Error(error.message || 'Storage write failed'));
          else resolve(result);
        };
        try {
          const pending = storageArea.set(value, done);
          if (pending && typeof pending.then === 'function') pending.then(done, error => { finish(); reject(error); });
        } catch (error) { finish(); reject(error); }
      });
    }
  };
}
const portableSettingsStorage = {
  get(keys) {
    return chrome.storage.local.get(keys);
  }
};
const portableConfigManager = SciLLM.createPortableConfigManager({
  directorySync,
  storageArea: createSettingsMutationStorage(chrome.storage.local, settingsMutationBarrier),
  settingsKey: 'sciLlmSettingsV2',
  abbreviationKey: SciLLM.GLOBAL_ABBREVIATION_MEMORY_KEY,
  mineruSettingsKey: SciLLM.PDF_MINERU_SETTINGS_KEY,
  derivePortableConfigKey: SciLLM.derivePortableConfigKey,
  encryptPortableConfig: SciLLM.encryptPortableConfig,
  decryptPortableConfig: SciLLM.decryptPortableConfig,
  validatePortablePayload: SciLLM.validatePortablePayload,
  validatePortableEnvelope: SciLLM.validatePortableEnvelope,
  toBase64: SciLLM.toBase64,
  fromBase64: SciLLM.fromBase64,
  normalizeSettings: SciLLM.mergeSettings,
  normalizeAbbreviations: SciLLM.normalizeGlobalAbbreviationMemory,
  normalizeMineruSettings: SciLLM.normalizeMineruPdfSettings,
  loadSettings: () => SciLLM.loadSettings(portableSettingsStorage),
  loadGlobalAbbreviations: async storageArea => {
    const key = SciLLM.GLOBAL_ABBREVIATION_MEMORY_KEY;
    const stored = await storageArea.get(key);
    return SciLLM.normalizeGlobalAbbreviationMemory(stored?.[key]);
  },
  loadMineruSettings: async storageArea => {
    const key = SciLLM.PDF_MINERU_SETTINGS_KEY;
    const stored = await storageArea.get(key);
    return SciLLM.normalizeMineruPdfSettings(stored?.[key]);
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
const decodeTiffSource = SciLLM.createTiffDecodeClient(chrome, providerFetch.ensureDocument);
const fetchNativeTiffSource = SciLLM.createTiffSourceService({
  fetchOriginal: fetchExportImageResource, cache: figureImageCache, decode: decodeTiffSource
});
const codexNativeClient = SciLLM.createCodexNativeClient(chrome.runtime);
const harnessNativeClient = SciLLM.createHarnessNativeClient(chrome.runtime);
const workspaceDirectoryController = SciLLM.createWorkspaceDirectoryController({
  directorySync,
  nativeClient: SciLLM.createWorkspaceDirectoryNativeClient(chrome.runtime),
  articleWorkspaceStore,
  runtimeExtensionId: chrome.runtime.id
});
const llmRouter = SciLLM.createBackgroundRouter({
  settingsMutationBarrier,
  storageArea: chrome.storage.local,
  sessionStorageArea: chrome.storage.session,
  fetchImpl: providerFetch,
  nativeClient: codexNativeClient,
  harnessClient: harnessNativeClient,
  cacheStore: analysisCache,
  corpusStore,
  documentStore,
  articleWorkspaceStore,
  tokenUsageStore,
  directorySync,
  runtimeExtensionId: chrome.runtime.id,
  getRuntimeLastError: () => chrome.runtime.lastError,
  portableConfigManager
});
const semanticFindService = SciLLM.createSemanticFindService({
  runtimeExtensionId: chrome.runtime.id,
  runRequest: (message, context) => llmRouter.handle(message, context),
  sendProgress: (target, payload) => chrome.tabs.sendMessage(
    target.tabId,
    payload,
    { frameId: target.frameId, documentId: target.documentId }
  )
});

function getRuntimeWorkbenchBridge() {
  if (getRuntimeWorkbenchBridge.instance) return getRuntimeWorkbenchBridge.instance;
  const store = SciLLM.createResearchWorkbenchStore({ indexedDB });
  const getHandle = () => SciLLM.loadDirectoryHandle(indexedDB);
  const adapter = SciLLM.createResearchWorkbenchDirectoryAdapter({ getHandle });
  const dataDirectories = SciLLM.createResearchWorkbenchDataDirectoryService({getHandle,locks:store.locks,
    openDirectory:async target=>{
      const binding=await directorySync.readNativeDirectoryBinding();
      const client=SciLLM.createWorkspaceDirectoryNativeClient(chrome.runtime);
      const receipt=await client.openResearch({rootId:binding.rootId,identity:target.identity,
        mappingId:target.mappingId,mappingRecordId:target.mappingRecordId});
      const current=await directorySync.readNativeDirectoryBinding();
      if(current.rootId!==binding.rootId)throw SciLLM.wbError('WORKBENCH_DATA_DIRECTORY_ROOT_CHANGED');
      return receipt;
    }});
  const resources = SciLLM.createResearchWorkbenchResourceAdapter({
    call: message => llmRouter.handle(message, { trustedExtensionSender: true,
      senderExtensionId: chrome.runtime.id, runtimeBaseUrl: chrome.runtime.getURL('') })
  });
  const sourceUrl = value => {
    try {
      const url = new URL(value);
      if (url.username || url.password) return '';
      const local = SciLLM.withLocalPdfWorkspaceSource?.(chrome.runtime.getURL('pdf-reader.html'), url.href);
      if (local) return local;
      if (url.protocol === 'file:' && !url.host && !url.search && /\.pdf$/iu.test(decodeURIComponent(url.pathname))) {
        return SciLLM.createPdfReaderUrl(chrome.runtime.getURL.bind(chrome.runtime), url.href);
      }
      if (!['https:', 'http:'].includes(url.protocol)) return '';
      return SciLLM.isLikelyPdfUrl?.(url.href)
        ? SciLLM.createPdfReaderUrl(chrome.runtime.getURL.bind(chrome.runtime), url.href) : url.href;
    } catch (_) { return ''; }
  };
  getRuntimeWorkbenchBridge.instance = SciLLM.createRuntimeWorkbenchBridge({
    chromeApi: chrome, store, adapter, resources, getHandle, sourceUrl, dataDirectories,
    sync: SciLLM.syncResearchWorkbenchOutbox,
    getWorkspace: id => articleWorkspaceStore.getWorkspace(id),
    sendToSource: (tabId, message) => SciLLM.sendTabMessageWithRecovery(chrome, tabId, message)
  });
  return getRuntimeWorkbenchBridge.instance;
}
// The queue itself is durable. Resume it whenever the worker starts, and on
// every explicit save/sync request from the workbench; no new permission needed.
Promise.resolve().then(() => getRuntimeWorkbenchBridge().scheduleSync()).catch(() => {});

const ttsRouter = SciLLM.createTtsRouter({
  runtimeExtensionId: chrome.runtime.id,
  loadSettings: () => SciLLM.loadSettings(portableSettingsStorage),
  saveSettings: async settings => {
    const finish = settingsMutationBarrier.begin();
    try { return await SciLLM.saveSettings(chrome.storage.local, settings); }
    finally { finish(); }
  }
});

function commitTrustedNavigationOwner(details) {
  ttsRouter.commitDocument(details || {});
  const tabId = Number(details?.tabId);
  const frameId = Number(details?.frameId);
  const documentId = typeof details?.documentId === 'string'
    ? details.documentId : '';
  if (!Number.isSafeInteger(tabId) || tabId < 0 ||
      !Number.isSafeInteger(frameId) || frameId < 0 || !documentId) {
    return Promise.resolve({ ignored: true });
  }
  const trusted = {
    senderExtensionId: chrome.runtime.id,
    senderTabId: tabId,
    senderFrameId: frameId,
    senderDocumentId: documentId
  };
  return Promise.all([
    llmRouter.commitTrustedDocument(trusted),
    semanticFindService.commitTrustedDocument(trusted)
  ]).then(([router, semanticFind]) => ({ router, semanticFind }));
}

function retireTrustedTabOwner(tabId) {
  ttsRouter.retireTab(Number(tabId));
  if (!Number.isSafeInteger(Number(tabId)) || Number(tabId) < 0) return;
  const trusted = {
    senderExtensionId: chrome.runtime.id,
    senderTabId: Number(tabId)
  };
  return Promise.all([
    llmRouter.retireTrustedTab(trusted),
    semanticFindService.retireTrustedTab(trusted)
  ]).then(([router, semanticFind]) => ({ router, semanticFind }));
}

if (chrome.webNavigation?.onCommitted?.addListener) {
  chrome.webNavigation.onCommitted.addListener(details => {
    // onHistoryStateUpdated is deliberately not observed: same-document
    // history changes retain the current owner and its receipt authority.
    void SciLLM.keepAliveUntil(commitTrustedNavigationOwner(details), chrome)
      .catch(() => {});
  });
}

chrome.tabs.onRemoved.addListener(tabId => {
  const retirement = retireTrustedTabOwner(tabId);
  if (!retirement) return;
  void SciLLM.keepAliveUntil(retirement, chrome).catch(() => {});
});
const portableConfigStorageChangeListener = SciLLM.createPortableConfigStorageChangeListener(
  portableConfigManager
);
chrome.storage.onChanged.addListener(portableConfigStorageChangeListener);
chrome.storage.onChanged.addListener(settingsMutationBarrier.noteStorageChanges);

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
  const progress = stage === 'progress'
    ? sanitizeNativeLlmProgress(message, payload) : null;
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
    ...(response?.success === true ? {
      result: sanitizeCodexReverseResult(message, response)
    } : {}),
    ...(response?.success === false ? { error: response.error || {} } : {})
  }, { timeoutMs: 3000 }).catch(error => {
    console.warn('Brevess: unable to publish local Codex reverse event', error);
    return null;
  });
}

const ROUTED_MESSAGE_TYPES = new Set([
  'RADAR_AI_ROUTE', 'RADAR_AI_QUERY', 'RADAR_AI_SCORE', 'RADAR_AI_CANCEL', 'RADAR_TRANSLATION',
  'PDF_BIBLIOGRAPHY_ENRICH',
  'RESEARCH_WORKBENCH_SYNC',
  'RESEARCH_WORKBENCH_DIRECTORY_STATUS',
  'RESEARCH_WORKBENCH_LOCATE_SOURCE',
  'RESEARCH_WORKBENCH_DATA_DIRECTORY_ENSURE',
  'RESEARCH_WORKBENCH_DATA_DIRECTORY_OPEN',
  'TRANSLATION_TASK_ROUTE_GET',
  'LLM_TRANSLATE_TEXT',
  'TRANSLATION_RECEIPT_GET',
  'TRANSLATION_CHECKPOINT_READ',
  'TRANSLATION_CHECKPOINT_WRITE',
  'LLM_GET_SETTINGS',
  'LLM_PREFLIGHT_TASK_ROUTE',
  'LLM_SAVE_PROFILE',
  'LLM_DUPLICATE_PROFILE',
  'LLM_DELETE_PROFILE',
  'LLM_UPDATE_PROFILE_ROUTING',
  'LLM_TEST_PROFILE',
  'LLM_LIST_MODELS',
  'HARNESS_LOCAL_STATUS',
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
  'ARTICLE_ARCHIVE_COMMIT_RESTORE',
  'ARTICLE_RESTORE_REGISTER_COMMIT',
  'ARTICLE_WORKSPACE_ENSURE',
  'LITERATURE_NOTE_COMMIT_DELTA',
  'RUNTIME_TASK_CONFIRM_SAVE',
  'ARTICLE_WORKSPACE_SAVE_ASSET',
  'ARTICLE_WORKSPACE_FIGURE_SOURCE_WRITE_STATUS',
  'ARTICLE_WORKSPACE_FIGURE_SOURCE_WRITE_FENCE',
  'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET',
  'ARTICLE_WORKSPACE_FIGURE_SAVE_STATUS',
  'ARTICLE_WORKSPACE_FINALIZE_STAGED_ASSET',
  'ARTICLE_WORKSPACE_ABORT_STAGED_ASSET',
  'ARTICLE_WORKSPACE_COMPENSATE_STAGED_ASSET',
  'ARTICLE_WORKSPACE_MIRROR_ALL',
  'ARTICLE_WORKSPACE_SAVE_BINARY_ASSET',
  'ARTICLE_WORKSPACE_GET_BINARY_ASSET',
  'ARTICLE_WORKSPACE_SAVE_SUPPLEMENTAL_DRAFT',
  'ARTICLE_WORKSPACE_GET_ASSET',
  'ARTICLE_WORKSPACE_LIST_ASSETS',
  'ARTICLE_WORKSPACE_SAVE_TURN',
  'ARTICLE_WORKSPACE_UPDATE_TURN',
  'ARTICLE_WORKSPACE_DELETE_TURN',
  'ARTICLE_WORKSPACE_PROBE',
  'ARTICLE_WORKSPACE_SCAN_RESTORE',
  'ARTICLE_WORKSPACE_COMMIT_RESTORE',
  'ARTICLE_WORKSPACE_COMMIT_PREPARED_RESTORE',
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
  'LLM_ADVANCE_FIGURE_WORKSPACE_LIFECYCLE',
  'LLM_ASK_FIGURE_PANEL',
  'LLM_ASK_ARTICLE',
  'LLM_ASK_SELECTION',
  'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
  'LLM_ANALYZE_RESEARCH_LOGIC',
  'LLM_ANALYZE_PAPER_INNOVATION',
  'LLM_ANALYZE_PAPER_LIMITATIONS',
  'LLM_AUTOFILL_LITERATURE_NOTE',
  'LLM_ANALYZE_REVIEW_OUTLINE',
  'LLM_TRANSLATE_ABBREVIATIONS',
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
  ['LLM_ASK_SELECTION', 'default'],
  ['LLM_TRANSLATE_ABBREVIATIONS', 'default'],
  ['LLM_ANALYZE_FIGURES', 'default'],
  ['LLM_ANALYZE_FIGURE_PANEL', 'default'],
  ['LLM_ASK_FIGURE_PANEL', 'default'],
  ['LLM_ANALYZE_CROSS_FIGURE_LOGIC', 'default'],
  ['LLM_ANALYZE_RESEARCH_LOGIC', 'default'],
  ['LLM_ANALYZE_PAPER_INNOVATION', 'default'],
  ['LLM_ANALYZE_PAPER_LIMITATIONS', 'default'],
  ['LLM_AUTOFILL_LITERATURE_NOTE', 'default']
]);

const FIGURE_PUBLIC_PROGRESS_MESSAGE_TYPES = new Set([
  'LLM_ANALYZE_FIGURES',
  'LLM_ANALYZE_FIGURE_PANEL',
  'LLM_ASK_FIGURE_PANEL',
  'LLM_ANALYZE_CROSS_FIGURE_LOGIC'
]);

function sanitizeOriginTabLlmProgress(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return value.slice(0, 32768);
  if (!value || typeof value !== 'object' || depth >= 8 || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 200).map(item =>
      sanitizeOriginTabLlmProgress(item, depth + 1, seen));
  }
  const safe = {};
  for (const [key, item] of Object.entries(value).slice(0, 120)) {
    if (/^(?:api[_-]?key|authorization|password|secret|access[_-]?token|refresh[_-]?token)$/iu
      .test(key)) continue;
    safe[String(key).slice(0, 120)] = sanitizeOriginTabLlmProgress(
      item, depth + 1, seen
    );
  }
  return safe;
}

// This is a bounded decision receipt, not consent. Current source/frame and
// operation checks still run in content and in the router's decision handler.
function sanitizeFigureVisionProgressDecision(source = {}) {
  const own = (object, key) => {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    } catch (_) { return undefined; }
  };
  const decision = own(source, 'visionConfirmation');
  if (own(source, 'phase') !== 'figure_vision_confirmation' || !decision ||
      typeof decision !== 'object' || Array.isArray(decision)) return null;
  const text = (key, limit, optional = false) => {
    const value = own(decision, key);
    return typeof value === 'string' && (optional || value.length > 0) &&
      value.length <= limit && !/[\u0000-\u001f\u007f]/u.test(value) ? value : null;
  };
  const id = text('id', 36), operationId = text('operationId', 100),
    figureId = text('figureId', 80), figureLabel = text('figureLabel', 120),
    documentId = text('documentId', 256), reason = text('reason', 80),
    taskId = text('taskId', 40), analysisDepth = text('analysisDepth', 16),
    sourceSignature = text('sourceSignature', 128), panelId = text('panelId', 16, true),
    tabId = own(decision, 'tabId'), workspaceLifecycle = own(decision, 'workspaceLifecycle'),
    pdfContinuationRequired = own(decision, 'pdfContinuationRequired');
  if (!/^[a-f0-9-]{36}$/u.test(id || '') || !operationId || !figureId || !figureLabel || !documentId ||
      operationId !== own(source, 'operationId') || figureId !== own(source, 'figureId') ||
      !Number.isSafeInteger(tabId) || tabId < 0 || !Number.isSafeInteger(workspaceLifecycle) ||
      workspaceLifecycle < 0 || workspaceLifecycle !== own(source, 'workspaceLifecycle') ||
      !['image_unavailable', 'profile_text_fallback', 'runtime_vision_unsupported',
        'provider_rejected_pixels', 'invalid_visual_response', 'visual_context_capacity',
        'visual_output_budget_rejected', 'visual_output_truncated'].includes(reason) ||
      !['figure_walkthrough', 'figure_panel_interpretation', 'figure_panel_followup'].includes(taskId) ||
      !['standard', 'deep'].includes(analysisDepth) ||
      !/^(?:[a-f0-9]{8,64}|sha256:[a-f0-9]{64})$/u.test(sourceSignature || '') || panelId === null ||
      typeof pdfContinuationRequired !== 'boolean') return null;
  return { id, operationId, figureId, figureLabel, documentId, reason, taskId,
    analysisDepth, sourceSignature, panelId, tabId, workspaceLifecycle, pdfContinuationRequired };
}

function sanitizeFigurePublicLlmProgress(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const text = (key, limit = 120) => String(source[key] || '').slice(0, limit);
  // Progress events are patches: an omitted count must not erase a checkpoint.
  // An explicit zero still clears the field when a new stage reports one.
  const count = key => Object.hasOwn(source, key) ? {
    [key]: Math.max(0, Math.min(10000, Math.floor(Number(source[key]) || 0)))
  } : {};
  const panels = key => [...new Set((Array.isArray(source[key]) ? source[key] : [])
    .map(item => String(item || '').normalize('NFKC').trim().toUpperCase())
    .filter(item => /^[A-Z0-9][A-Z0-9.+-]{0,7}$/.test(item)))]
    .slice(0, 30);
  const providerAttemptLimit = Math.max(0, Math.min(
    96, Math.floor(Number(source.providerAttemptLimit) || 0)
  ));
  const providerAttempt = Math.max(0, Math.min(
    providerAttemptLimit || 96,
    Math.floor(Number(source.providerAttempt) || 0)
  ));
  const safe = {
    phase: text('phase', 64), taskType: text('taskType', 40),
    ...(source.phase === 'figure_stage_diagnostic' && source.figureStageDiagnostic &&
        typeof SciLLM.createFigurePanelStageDiagnostic === 'function'
      ? { figureStageDiagnostic: SciLLM.createFigurePanelStageDiagnostic(source.figureStageDiagnostic) } : {}),
    figureId: text('figureId', 80), figureLabel: text('figureLabel', 120),
    operationId: text('operationId', 100), providerId: text('providerId', 40),
    model: text('model', 160), capabilityMode: text('capabilityMode', 40),
    basis: text('basis', 40), errorCode: text('errorCode', 80),
    expectedPanels: panels('expectedPanels'), missingPanels: panels('missingPanels'),
    unresolvedPanels: panels('unresolvedPanels'), unexpectedPanels: panels('unexpectedPanels'),
    recoveredPanels: panels('recoveredPanels'),
    ...count('expectedPanelCount'),
    ...count('recognizedPanelCount'),
    ...count('batchRecognizedPanelCount'),
    ...count('savedPanelCount'),
    ...count('validatedPanelCount'),
    ...count('completedPanelBatches'),
    ...count('totalPanelBatches'),
    ...count('completedFigures'), ...count('totalFigures'),
    ...count('ignoredUnexpectedPanelCount'),
    ...count('recoveredPanelCount'),
    ...count('unresolvedPanelCount'),
    ...count('recoveryBatchIndex'),
    ...count('recoveryBatchCount'),
    ...count('panelBatchIndex'),
    startedAt: Math.max(0, Math.floor(Number(source.startedAt) || 0)),
    waitMs: Math.max(0, Math.min(300000, Math.floor(Number(source.waitMs) || 0))),
    ...count('attempt'), providerAttempt, providerAttemptLimit,
    cacheHit: source.cacheHit === true,
    visionFallback: source.visionFallback === true,
    unlabeledFigure: source.unlabeledFigure === true
  };
  const visionDecision = sanitizeFigureVisionProgressDecision(source);
  if (visionDecision) safe.visionConfirmation = visionDecision;
  const inputMode = text('inputMode', 40);
  if (['caption_context', 'figure_image', 'panel_crop'].includes(inputMode)) {
    safe.inputMode = inputMode;
  }
  const checkpointStatus = text('checkpointStatus', 40);
  if (['pending_save', 'saved', 'not_requested', 'save_failed'].includes(checkpointStatus)) {
    safe.checkpointStatus = checkpointStatus;
  }
  const route = source.route && typeof source.route === 'object' ? source.route : null;
  if (route) safe.route = {
    taskType: String(route.taskType || '').slice(0, 40),
    effectiveProfileId: String(route.effectiveProfileId || '').slice(0, 80),
    effectiveProfileName: String(route.effectiveProfileName || '').slice(0, 120),
    providerId: String(route.providerId || '').slice(0, 40),
    model: String(route.model || '').slice(0, 160),
    capabilityMode: String(route.capabilityMode || '').slice(0, 40),
    fallbackReason: String(route.fallbackReason || '').slice(0, 80)
  };
  return safe;
}

function sanitizeCrossFigurePublicLlmProgress(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const safe = sanitizeFigurePublicLlmProgress(source);
  const boundedInteger = (key, maximum) => Math.max(0, Math.min(
    maximum, Math.floor(Number(source[key]) || 0)
  ));
  safe.operationEpoch = boundedInteger('operationEpoch', 1000000);
  safe.completedPanels = boundedInteger('completedPanels', 4096);
  safe.totalPanels = boundedInteger('totalPanels', 4096);
  safe.elapsedMs = boundedInteger('elapsedMs', 3600000);
  const status = String(source.status || '').slice(0, 24);
  if (['working', 'retrying'].includes(status)) safe.status = status;
  return safe;
}

function sanitizePublicLlmProgress(message = {}, value) {
  if (arguments.length < 2) {
    return sanitizeFigurePublicLlmProgress(message);
  }
  if (String(message?.type || '') === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC') {
    return sanitizeCrossFigurePublicLlmProgress(value);
  }
  if (FIGURE_PUBLIC_PROGRESS_MESSAGE_TYPES.has(String(message?.type || ''))) {
    return sanitizeFigurePublicLlmProgress(value);
  }
  return sanitizeOriginTabLlmProgress(value) || {};
}

function sanitizeNativeLlmProgress(message = {}, value = {}) {
  if (String(message?.type || '') === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC') {
    return sanitizeCrossFigurePublicLlmProgress(value);
  }
  const safe = sanitizeFigurePublicLlmProgress(value);
  // Decision receipts belong only to the originating content/UI bridge.
  delete safe.visionConfirmation;
  return safe;
}

function trustedOriginProgressTarget(sender, expectedRuntimeId) {
  try {
    const ownDataValue = (object, key) => {
      if (!object || (typeof object !== 'object' && typeof object !== 'function')) {
        return undefined;
      }
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ? descriptor.value : undefined;
    };
    if (typeof expectedRuntimeId !== 'string' || !expectedRuntimeId ||
        ownDataValue(sender, 'id') !== expectedRuntimeId) return null;
    const tab = ownDataValue(sender, 'tab');
    const tabId = ownDataValue(tab, 'id');
    const frameId = ownDataValue(sender, 'frameId');
    const rawDocumentId = ownDataValue(sender, 'documentId');
    if (!Number.isSafeInteger(tabId) || tabId < 0 ||
        !Number.isSafeInteger(frameId) || frameId < 0 ||
        typeof rawDocumentId !== 'string' || !rawDocumentId.length ||
        rawDocumentId.length > 256) return null;
    const documentId = rawDocumentId.normalize('NFKC').trim();
    if (!documentId || documentId.length > 256) return null;
    return { tabId, frameId, documentId };
  } catch (_) {
    return null;
  }
}

function createRoutedLlmProgressTransport(
  message, sender, reverseState = {}, dependencies = {}
) {
  const recordUsage = typeof dependencies.recordTokenUsageProgress === 'function'
    ? dependencies.recordTokenUsageProgress : recordTokenUsageProgress;
  const sendTabProgress = typeof dependencies.sendTabProgress === 'function'
    ? dependencies.sendTabProgress
    : (tabId, payload, options) => chrome.tabs.sendMessage(tabId, payload, options)
      .catch(() => {});
  const publishReverse = typeof dependencies.publishCodexReverseEvent === 'function'
    ? dependencies.publishCodexReverseEvent : publishCodexReverseEvent;
  let expectedRuntimeId = typeof dependencies.expectedRuntimeId === 'string'
    ? dependencies.expectedRuntimeId : '';
  if (!expectedRuntimeId) {
    try {
      expectedRuntimeId = String(chrome.runtime.id || '');
    } catch (_) {
      expectedRuntimeId = '';
    }
  }
  const deliveryTarget = trustedOriginProgressTarget(sender, expectedRuntimeId);
  return progress => {
    const originProgress = sanitizePublicLlmProgress(message, progress);
    const nativeProgress = sanitizeNativeLlmProgress(message, progress);
    return Promise.allSettled([
      Promise.resolve().then(() => recordUsage(
        message, sender, progress, reverseState
      )),
      deliveryTarget
        ? Promise.resolve().then(() => sendTabProgress(deliveryTarget.tabId, {
          action: 'llmAnalysisProgress',
          progress: {
            ...originProgress,
            workspaceLifecycle: Number.isInteger(message.workspaceLifecycle)
              ? message.workspaceLifecycle : undefined
          }
        }, {
          frameId: deliveryTarget.frameId,
          documentId: deliveryTarget.documentId
        }))
        : Promise.resolve(),
      Promise.resolve().then(() => publishReverse(
        'progress', message, sender, nativeProgress, reverseState
      ))
    ]);
  };
}

function sanitizeCodexReverseResult(message = {}, response = {}) {
  const data = response?.data && typeof response.data === 'object' ? response.data : {};
  const results = Array.isArray(data.figureResults) ? data.figureResults : [];
  return {
    success: response?.success === true,
    messageType: String(message?.type || '').slice(0, 80),
    operationId: String(data.operationId || message?.operationId || '').slice(0, 100),
    analysisDepth: String(data.analysisDepth || message?.analysisDepth || '').slice(0, 20),
    totalFigures: Math.max(0, Math.min(50, Math.floor(Number(data.totalFigures) || 0))),
    cacheHits: Math.max(0, Math.min(50, Math.floor(Number(data.cacheHits) || 0))),
    visionFallbacks: Math.max(0, Math.min(50, Math.floor(Number(data.visionFallbacks) || 0))),
    figures: results.slice(0, 50).map(item => ({
      figureId: String(item?.figureId || '').slice(0, 80),
      analysisDepth: String(item?.analysisDepth || '').slice(0, 20),
      inputMode: item?.visionFallback === true || item?.basis === 'caption_context'
        ? 'caption_context' : 'figure_image',
      validatedPanelCount: Math.max(0, Math.min(30,
        Array.isArray(item?.panels) ? item.panels.length : 0)),
      unresolvedPanels: (Array.isArray(item?.unresolvedPanels)
        ? item.unresolvedPanels : []).slice(0, 30).map(value => String(value).slice(0, 8))
    }))
  };
}
const LLM_TASK_ID_SET = new Set(SciLLM.LLM_TASK_IDS);

function allowedTokenUsageTaskIds(message) {
  if (message?.type === 'RADAR_TRANSLATION') return allowedTokenUsageTaskIds(message.request || {});
  if (message?.type === 'RADAR_AI_QUERY') return ['literature_radar_query'];
  if (message?.type === 'RADAR_AI_SCORE') return ['semantic_find'];
  const messageType = String(message?.type || '');
  let branches;
  if (messageType === 'LLM_ANALYZE_DOCUMENT') {
    branches = ['primary', 'evidence_ledger'];
  } else if (messageType === 'LLM_ANALYZE_REVIEW_OUTLINE') {
    branches = [message.paragraphOnly === true ? 'paragraph' : 'outline'];
  } else if (messageType === 'LLM_ASK_ARTICLE') {
    branches = [message.selectionEvidence ? 'selection' : 'article'];
  } else if (messageType === 'LLM_TRANSLATE_TEXT') {
    branches = ['full_text_translation', 'navigation_title_translation'].includes(message.taskId)
      ? [message.taskId] : [];
  } else {
    const branch = TOKEN_USAGE_FEATURES.get(messageType);
    branches = branch ? [branch] : [];
  }
  try {
    return branches.map(branch => SciLLM.resolveLlmTaskId(messageType, branch));
  } catch (_) {
    return [];
  }
}

function resolveTokenUsageFeature(message, progress) {
  const allowedTaskIds = allowedTokenUsageTaskIds(message);
  const reportedTaskId = LLM_TASK_ID_SET.has(progress?.featureId)
    ? progress.featureId : '';
  const taskId = allowedTaskIds.includes(reportedTaskId)
    ? reportedTaskId : (allowedTaskIds[0] || '');
  if (!LLM_TASK_ID_SET.has(taskId)) return null;
  try {
    const definition = SciLLM.getLlmTaskDefinition(taskId);
    return [definition.id, definition.labelZh];
  } catch (_) {
    return null;
  }
}

function recordTokenUsageProgress(message, sender, progress, reverseState) {
  if (progress?.phase !== 'provider_telemetry') return null;
  const feature = resolveTokenUsageFeature(message, progress);
  if (!feature) return null;
  if (!Array.isArray(reverseState.tokenUsageEvents)) reverseState.tokenUsageEvents = [];
  reverseState.tokenUsageEvents.push({
    providerId: String(progress.providerId || progress.route?.providerId || '').slice(0, 60),
    model: String(progress.model || progress.route?.model || '').slice(0, 160),
    elapsedMs: Math.max(0, Number(progress.elapsedMs) || 0),
    usageProvided: progress.usageProvided,
    inputTokensProvided: progress.inputTokensProvided,
    outputTokensProvided: progress.outputTokensProvided,
    inputTokens: Math.max(0, Number(progress.inputTokens) || 0),
    outputTokens: Math.max(0, Number(progress.outputTokens) || 0),
    reasoningTokens: Math.max(0, Number(progress.reasoningTokens) || 0),
    cacheHitTokens: Math.max(0, Number(progress.cacheHitTokens) || 0),
    cacheMissTokens: Math.max(0, Number(progress.cacheMissTokens) || 0),
    estimated: progress.estimated === true
  });
  const document = message?.document || {};
  const promise = tokenUsageStore.record({
    canonicalUrl: reverseState.translationBinding?.pageUrl || document.canonicalUrl || document.url ||
      message.documentUrl || sender?.tab?.url,
    documentKey: reverseState.translationBinding?.documentId || document.documentId || '',
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

function aggregateNotificationTokenUsage(events = []) {
  const rows = Array.isArray(events) ? events : [];
  const usage = rows.reduce((total, item) => ({
    requests: total.requests + 1,
    inputTokens: total.inputTokens + Math.max(0, Number(item?.inputTokens) || 0),
    outputTokens: total.outputTokens + Math.max(0, Number(item?.outputTokens) || 0),
    reasoningTokens: total.reasoningTokens +
      Math.max(0, Number(item?.reasoningTokens) || 0),
    cacheHitTokens: total.cacheHitTokens +
      Math.max(0, Number(item?.cacheHitTokens) || 0),
    cacheMissTokens: total.cacheMissTokens +
      Math.max(0, Number(item?.cacheMissTokens) || 0),
    estimated: total.estimated || item?.estimated === true
  }), {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    estimated: false
  });
  usage.totalTokens = usage.inputTokens + usage.outputTokens;
  return usage.requests > 0 ? usage : null;
}

async function coordinateOpenArticleWorkspaceTabs(action, workspaceId, workspaceGeneration = 1) {
  const normalizedWorkspaceId = String(workspaceId || '');
  if (!normalizedWorkspaceId) return { checked: 0, matched: 0, failed: 0 };
  const tabs = await chrome.tabs.query({});
  const candidates = tabs.filter(tab => Number.isInteger(tab.id));
  const responses = await Promise.all(candidates.map(async tab => {
    let timer;
    try {
      const response = await Promise.race([
        chrome.tabs.sendMessage(tab.id, {
          action,
          workspaceId: normalizedWorkspaceId,
          workspaceGeneration: Math.max(1, Number(workspaceGeneration) || 1)
        }),
        new Promise(resolve => {
          timer = setTimeout(() => resolve({ coordinationTimedOut: true }), 2500);
        })
      ]);
      if (response?.coordinationTimedOut) return { matched: false, failed: true };
      return { matched: response?.matched === true, failed: response?.success === false };
    } catch (_) {
      return { matched: false, failed: false };
    } finally {
      clearTimeout(timer);
    }
  }));
  return {
    checked: candidates.length,
    matched: responses.filter(item => item.matched).length,
    failed: responses.filter(item => item.failed).length
  };
}

function validateOriginFigureCheckpointBinding(
  message, sender, checkpoint, runtimeId
) {
  if (message?.type !== 'LLM_ANALYZE_FIGURES' || sender?.id !== runtimeId ||
      !sender?.tab || !Number.isInteger(Number(sender.tab.id)) ||
      !Number.isSafeInteger(Number(sender.frameId)) || Number(sender.frameId) < 0 ||
      !String(sender.documentId || '')) {
    const error = new Error('FIGURE_CHECKPOINT_TRANSPORT_UNAVAILABLE');
    error.code = 'FIGURE_CHECKPOINT_TRANSPORT_UNAVAILABLE';
    throw error;
  }
  const senderTabId = Number(sender.tab.id);
  const operationId = String(message?.operationId || '');
  const workspaceLifecycle = Number(message?.workspaceLifecycle);
  const figureId = String(checkpoint?.figureId || '');
  const checkpointEnvelope = checkpoint?.checkpointEnvelope;
  const requestedFigures = Array.isArray(message?.figures) ? message.figures : [];
  if (!operationId || String(checkpoint?.operationId || '') !== operationId ||
      !Number.isInteger(workspaceLifecycle) || workspaceLifecycle < 0 ||
      (Number.isInteger(checkpoint?.workspaceLifecycle) &&
        checkpoint.workspaceLifecycle !== workspaceLifecycle) ||
      !figureId || !requestedFigures.some(figure => String(figure?.figureId || '') === figureId) ||
      checkpointEnvelope?.version !== 'figure-checkpoint-envelope-v1' ||
      !checkpointEnvelope.figureResult ||
      typeof checkpointEnvelope.figureResult !== 'object' ||
      String(checkpointEnvelope.figureId || '') !== figureId ||
      !checkpoint?.figureResult || typeof checkpoint.figureResult !== 'object') {
    const error = new Error('FIGURE_CHECKPOINT_BINDING_INVALID');
    error.code = 'FIGURE_CHECKPOINT_BINDING_INVALID';
    throw error;
  }
  return {
    senderTabId,
    senderFrameId: Number.isInteger(Number(sender.frameId))
      ? Number(sender.frameId) : 0,
    senderDocumentId: String(sender.documentId || ''),
    operationId, workspaceLifecycle, figureId
  };
}

async function persistOriginFigureCheckpoint(message, sender, checkpoint) {
  const binding = validateOriginFigureCheckpointBinding(
    message, sender, checkpoint, chrome.runtime.id
  );
  const {
    senderTabId, senderFrameId, senderDocumentId,
    operationId, workspaceLifecycle, figureId
  } = binding;
  const response = await chrome.tabs.sendMessage(senderTabId, {
    action: 'llmFigureCheckpoint',
    checkpoint: {
      figureId,
      operationId,
      workspaceLifecycle,
      analysisDepth: checkpoint.analysisDepth === 'standard' ? 'standard' : 'deep',
      inputMode: String(checkpoint.inputMode || ''),
      missingPanels: Array.isArray(checkpoint.missingPanels)
        ? checkpoint.missingPanels.slice(0, 30) : [],
      unresolvedPanels: Array.isArray(checkpoint.unresolvedPanels)
        ? checkpoint.unresolvedPanels.slice(0, 30) : [],
      validatedPanelCount: Math.max(0, Math.min(30,
        Math.floor(Number(checkpoint.validatedPanelCount) || 0))),
      checkpointEnvelope: checkpoint.checkpointEnvelope
    }
  }, {
    frameId: senderFrameId,
    ...(senderDocumentId ? { documentId: senderDocumentId } : {})
  });
  if (response?.success !== true) {
    const error = new Error('Origin tab rejected the Figure checkpoint');
    error.code = String(response?.code || 'FIGURE_CHECKPOINT_PERSIST_FAILED');
    error.causeCode = response?.causeCode;
    throw error;
  }
  return {
    success: true,
    savedPanelCount: Math.max(0, Math.min(30,
      Math.floor(Number(response.savedPanelCount) || 0)))
  };
}

function validateOriginWorkspaceCommitGuardBinding(
  message, sender, binding, runtimeId
) {
  const commitGuardId = String(message?.commitGuardId || '');
  const allowedType = new Set([
    'ARTICLE_WORKSPACE_SAVE_ASSET',
    'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET',
    'ARTICLE_WORKSPACE_FIGURE_SAVE_STATUS',
    'ARTICLE_WORKSPACE_FINALIZE_STAGED_ASSET',
    'ARTICLE_WORKSPACE_ABORT_STAGED_ASSET',
    'ARTICLE_WORKSPACE_COMPENSATE_STAGED_ASSET'
  ]).has(message?.type);
  const stagingMatches = message?.type === 'ARTICLE_WORKSPACE_SAVE_ASSET' || (
    String(message.stagingPath || '') === String(binding?.stagingPath || '') &&
    /^internal\/figure-retry-staging\/figure-retry-guard-[a-z0-9-]{8,100}\.json$/iu
      .test(String(message.stagingPath || ''))
  );
  if (!allowedType || !stagingMatches ||
      message?.commitGuardKind !== 'figure_retry' || sender?.id !== runtimeId ||
      !sender?.tab || !Number.isInteger(Number(sender.tab.id)) ||
      !Number.isSafeInteger(Number(sender.frameId)) || Number(sender.frameId) < 0 ||
      !String(sender.documentId || '') ||
      !/^figure-retry-guard-[a-z0-9-]{8,100}$/iu.test(commitGuardId) ||
      commitGuardId !== String(binding?.commitGuardId || '') ||
      String(message.workspaceId || '') !== String(binding?.workspaceId || '') ||
      Number(message.workspaceGeneration) !== Number(binding?.workspaceGeneration) ||
      String(message.relativePath || '') !== String(binding?.relativePath || '') ||
      !Number.isInteger(Number(message.workspaceLifecycle))) {
    const error = new Error('FIGURE_COMMIT_GUARD_UNAVAILABLE');
    error.code = 'FIGURE_COMMIT_GUARD_UNAVAILABLE';
    throw error;
  }
  return {
    senderTabId: Number(sender.tab.id),
    senderFrameId: Number(sender.frameId),
    senderDocumentId: String(sender.documentId),
    commitGuardId,
    workspaceLifecycle: Number(message.workspaceLifecycle),
    workspaceId: String(binding.workspaceId),
    workspaceGeneration: Number(binding.workspaceGeneration),
    relativePath: String(binding.relativePath),
    stagingPath: String(binding.stagingPath || '')
  };
}

async function persistOriginWorkspaceCommitGuard(message, sender, binding) {
  const validated = validateOriginWorkspaceCommitGuardBinding(
    message, sender, binding, chrome.runtime.id
  );
  const response = await chrome.tabs.sendMessage(validated.senderTabId, {
    action: 'llmFigureWorkspaceCommitGuard',
    commitGuardKind: 'figure_retry',
    commitGuardId: validated.commitGuardId,
    workspaceLifecycle: validated.workspaceLifecycle,
    workspaceId: validated.workspaceId,
    workspaceGeneration: validated.workspaceGeneration,
    relativePath: validated.relativePath,
    ...(validated.stagingPath ? { stagingPath: validated.stagingPath } : {})
  }, {
    frameId: validated.senderFrameId,
    ...(validated.senderDocumentId
      ? { documentId: validated.senderDocumentId } : {})
  });
  return response?.success === true
    ? { success: true }
    : {
      success: false,
      code: response?.code === 'FIGURE_PANEL_RETRY_SCOPE_STALE'
        ? response.code : 'FIGURE_COMMIT_GUARD_UNAVAILABLE'
    };
}

async function translationContextDigest(value) {
  const canonical = item => {
    if (item === null || ['string', 'boolean', 'number'].includes(typeof item)) return item;
    if (Array.isArray(item)) return item.map(canonical);
    if (!item || typeof item !== 'object') throw new Error('TRANSLATION_CONTEXT_STALE');
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])]));
  };
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value))));
  return 'sha256:' + [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyLiveTranslationContext(message, sender, assertCurrent, chromeApi = chrome) {
  const stale = () => Object.assign(new Error('TRANSLATION_CONTEXT_STALE'), { code: 'TRANSLATION_CONTEXT_STALE' });
  const taskId = message?.taskId || 'full_text_translation';
  if (!['full_text_translation', 'navigation_title_translation'].includes(taskId) ||
      sender?.id !== chromeApi.runtime.id || !Number.isSafeInteger(sender?.tab?.id) || sender.tab.id < 0 ||
      !Number.isSafeInteger(sender?.frameId) || sender.frameId < 0 ||
      typeof sender?.documentId !== 'string' || !sender.documentId || typeof assertCurrent !== 'function') throw stale();
  await assertCurrent();
  let timer, response;
  try {
    response = await Promise.race([
      chromeApi.tabs.sendMessage(sender.tab.id, {
        action: taskId === 'navigation_title_translation' ? 'validateNavigationTranslationContext' : 'validateTranslationContext',
        request: { ...message, taskId }
      }, { frameId: sender.frameId, documentId: sender.documentId }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(stale()), 4000); })
    ]);
  } catch (_) { throw stale(); }
  finally { clearTimeout(timer); }
  await assertCurrent();
  const binding = response?.data?.documentBinding;
  if (response?.success !== true || !binding || !binding.documentIdentity || !binding.navigationIdentity ||
      !binding.pageUrl || !Number.isSafeInteger(binding.workspaceLifecycle) || binding.workspaceLifecycle < 0 ||
      (taskId === 'full_text_translation' && !binding.pageId) ||
      (taskId === 'navigation_title_translation' && (binding.kind !== 'navigation' || !binding.documentHash))) throw stale();
  const documentDigest = await translationContextDigest(binding);
  if (documentDigest !== await translationContextDigest(message.documentBinding)) throw stale();
  const ownerDigest = await translationContextDigest([sender.id, sender.tab.id, sender.frameId, sender.documentId]);
  await assertCurrent();
  return { ownerDigest, documentDigest, documentBinding: binding };
}

async function assertFigureResumeUiOwnerCurrent(sender, previous = null, chromeApi = chrome, initialBinding = null) {
  const cancelled = () => {
    throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED', retryable: false });
  };
  const runtime = chromeApi.runtime;
  let expectedUrl, origin;
  try {
    expectedUrl = runtime.getURL('popup.html');
    const page = new URL(expectedUrl);
    if (!/^(chrome|moz)-extension:$/.test(page.protocol) || page.host !== runtime.id ||
        page.pathname !== '/popup.html' || page.search || page.hash || page.username || page.password) cancelled();
    origin = page.protocol + '//' + page.host;
  } catch (_) { cancelled(); }
  // Edge native side panels can omit all sender document/tab/frame identity.
  // That shape requires a caller pin captured while the original UI was live;
  // a first lookup alone could otherwise adopt a newly opened replacement UI.
  const discoverNativePanel = sender?.documentId === undefined;
  if (typeof runtime.id !== 'string' || !runtime.id.trim() || sender?.id !== runtime.id ||
      sender.url !== expectedUrl ||
      (discoverNativePanel
        ? sender.origin !== origin || sender.tab !== undefined || sender.frameId !== undefined || sender.windowId !== undefined
        : typeof sender.documentId !== 'string' || !sender.documentId.trim()) ||
      sender.origin !== undefined && sender.origin !== origin ||
      sender.documentLifecycle !== undefined && sender.documentLifecycle !== 'active' ||
      typeof runtime.getContexts !== 'function') cancelled();
  const fields = ['contextId', 'contextType', 'documentId', 'documentUrl', 'tabId', 'frameId', 'windowId', 'incognito'];
  const matches = (left, right) => fields.every(key => left[key] === right[key]);
  if (discoverNativePanel && !initialBinding || initialBinding != null &&
      (typeof initialBinding !== 'object' || Array.isArray(initialBinding))) cancelled();
  const initial = initialBinding == null ? null
    : Object.freeze(Object.fromEntries(fields.map(key => [key, initialBinding[key]])));
  if (initial && (typeof initial.contextId !== 'string' || !initial.contextId.trim() ||
      typeof initial.documentId !== 'string' || !initial.documentId.trim() ||
      initial.documentUrl !== expectedUrl || initial.frameId !== 0 ||
      !Number.isSafeInteger(initial.tabId) || initial.tabId < -1 ||
      !Number.isSafeInteger(initial.windowId) || initial.windowId < -1 ||
      typeof initial.incognito !== 'boolean' ||
      !['SIDE_PANEL', 'TAB'].includes(initial.contextType) ||
      discoverNativePanel && initial.contextType !== 'SIDE_PANEL')) cancelled();
  const readContext = async () => {
    let contexts;
    try { contexts = await runtime.getContexts(discoverNativePanel
      ? { documentUrls: [expectedUrl] } : { documentIds: [sender.documentId] }); }
    catch (_) { cancelled(); }
    if (!Array.isArray(contexts)) cancelled();
    // Count every matching UI context before checking its type. A TAB or a
    // second panel at this URL makes a document-less sender ambiguous.
    const owners = contexts.filter(item => discoverNativePanel
      ? item?.documentUrl === expectedUrl : item?.documentId === sender.documentId);
    if (owners.length !== 1) cancelled();
    const owner = owners[0];
    if (discoverNativePanel && owner.contextType !== 'SIDE_PANEL' ||
        !['SIDE_PANEL', 'TAB'].includes(owner.contextType) ||
        typeof owner.contextId !== 'string' || !owner.contextId.trim() ||
        typeof owner.documentId !== 'string' || !owner.documentId.trim() ||
        owner.documentUrl !== expectedUrl || owner.frameId !== 0 ||
        !Number.isSafeInteger(owner.tabId) || owner.tabId < -1 ||
        !Number.isSafeInteger(owner.windowId) || owner.windowId < -1 ||
        owner.contextType === 'TAB' && (owner.tabId < 0 || owner.windowId < 0) ||
        owner.documentOrigin !== undefined && owner.documentOrigin !== origin ||
        owner.documentLifecycle !== undefined && owner.documentLifecycle !== 'active' ||
        sender.frameId !== undefined && sender.frameId !== owner.frameId ||
        sender.windowId !== undefined && sender.windowId !== owner.windowId ||
        sender.tab !== undefined && (!sender.tab || sender.tab.id !== owner.tabId ||
          sender.tab.windowId !== undefined && sender.tab.windowId !== owner.windowId ||
          sender.tab.url !== undefined && sender.tab.url !== expectedUrl ||
          sender.tab.incognito !== undefined && sender.tab.incognito !== owner.incognito)) cancelled();
    if (initial && !matches(initial, owner)) cancelled();
    return Object.freeze(Object.fromEntries(fields.map(key => [key, owner[key]])));
  };
  const owner = await readContext();
  if (previous && !matches(previous, owner)) cancelled();
  // Chromium may omit extension UI documents from webNavigation. A live
  // extension context proves this UI owner, but cannot override a different frame.
  if (owner.tabId >= 0 && typeof chromeApi.webNavigation?.getFrame === 'function') {
    let frame = null;
    try { frame = await chromeApi.webNavigation.getFrame({ tabId: owner.tabId, frameId: owner.frameId }); }
    catch (_) { /* Recheck the browser-owned extension context below. */ }
    if (frame && (frame.documentId !== owner.documentId || frame.url !== expectedUrl ||
        frame.documentLifecycle !== undefined && frame.documentLifecycle !== 'active' ||
        frame.parentFrameId !== undefined && frame.parentFrameId !== -1)) cancelled();
  }
  if (!matches(owner, await readContext())) cancelled();
  return owner;
}

function createFigureSourceTargetAuthority(sender, chromeApi = chrome, initialUiBinding = null) {
  let pinnedUi = null;
  let pinnedTarget = null;
  const fail = () => { throw Object.assign(new Error('FIGURE_SOURCE_OWNER_STALE'),
    { code: 'FIGURE_SOURCE_OWNER_STALE', retryable: false }); };
  const navigation = value => { const url = new URL(value); url.hash = ''; return url.href; };
  const canonical = value => {
    const url = new URL(value);
    if (/^(?:https?|file):$/u.test(url.protocol)) return SciLLM.normalizeWorkspaceCanonicalUrl(url.href);
    const reader = new URL(chromeApi.runtime.getURL('pdf-reader.html'));
    if (url.protocol !== reader.protocol || url.host !== reader.host || url.pathname !== reader.pathname ||
        url.username || url.password || url.searchParams.getAll('source').length !== 1) fail();
    const source = new URL(url.searchParams.get('source'));
    if (!/^(?:https?|file):$/u.test(source.protocol) || source.username || source.password) fail();
    return SciLLM.normalizeWorkspaceCanonicalUrl(source.href);
  };
  return async target => {
    let live = true, timer;
    const current = () => { if (!live) fail(); };
    const work = async () => {
      if (!Number.isSafeInteger(target?.targetArticleTabId) || target.targetArticleTabId < 0) fail();
      const ui = await assertFigureResumeUiOwnerCurrent(sender, pinnedUi, chromeApi, initialUiBinding); current();
      const readFrame = async () => {
        let frame = await chromeApi.webNavigation.getFrame({ tabId: target.targetArticleTabId, frameId: 0 });
        current();
        if (!frame) {
          // A browser-owned extension context supplies the PDF document ID;
          // neither the popup message nor a content-generated UUID may supply it.
          const contexts = await chromeApi.runtime.getContexts({ contextTypes: ['TAB'], tabIds: [target.targetArticleTabId] });
          current();
          const candidates = Array.isArray(contexts) ? contexts.filter(c => c.contextType === 'TAB' &&
            c.tabId === target.targetArticleTabId && c.frameId === 0) : [];
          if (candidates.length !== 1) fail();
          const c = candidates[0], expected = new URL(chromeApi.runtime.getURL('pdf-reader.html'));
          const url = new URL(c.documentUrl);
          if (url.protocol !== expected.protocol || url.host !== expected.host || url.pathname !== expected.pathname ||
              typeof c.documentId !== 'string' || !c.documentId ||
              c.documentLifecycle !== undefined && c.documentLifecycle !== 'active') fail();
          const reader = await SciLLM.resolveOwnPdfReaderSenderTab(chromeApi, {
            id: chromeApi.runtime.id, tab: { id: target.targetArticleTabId }, frameId: 0,
            documentId: c.documentId, url: c.documentUrl
          });
          current(); frame = { documentId: c.documentId, url: reader.url };
        }
        if (typeof frame.documentId !== 'string' || !frame.documentId || typeof frame.url !== 'string' ||
            frame.documentLifecycle !== undefined && frame.documentLifecycle !== 'active' ||
            frame.parentFrameId !== undefined && frame.parentFrameId !== -1) fail();
        const result = { senderTabId: target.targetArticleTabId, senderFrameId: 0,
          senderDocumentId: frame.documentId, canonicalUrl: canonical(frame.url), navigationIdentity: navigation(frame.url) };
        if (result.canonicalUrl !== target.canonicalUrl) fail();
        return result;
      };
      const first = await readFrame(); current();
      const checkReceipt = async () => {
        const receipt = await chromeApi.tabs.sendMessage(first.senderTabId,
          { action: 'validateFigureSourceTarget', target }, { frameId: 0, documentId: first.senderDocumentId });
        current();
        if (receipt?.success !== true || typeof receipt.documentIdentity !== 'string' || !receipt.documentIdentity ||
            !Number.isSafeInteger(receipt.workspaceLifecycle) || receipt.workspaceLifecycle < 0 ||
            navigation(receipt.navigationIdentity) !== first.navigationIdentity ||
            ['workspaceId', 'workspaceGeneration', 'canonicalUrl', 'documentHash', 'targetArticleTabId']
              .some(key => receipt.target?.[key] !== target[key])) fail();
        return { ...first, contentDocumentIdentity: receipt.documentIdentity, workspaceLifecycle: receipt.workspaceLifecycle,
          workspaceId: target.workspaceId, workspaceGeneration: target.workspaceGeneration, documentHash: target.documentHash };
      };
      const captured = await checkReceipt();
      const same = (a, b) => Object.keys(a).every(key => a[key] === b[key]);
      if (pinnedTarget && !same(pinnedTarget, captured)) fail();
      await assertFigureResumeUiOwnerCurrent(sender, ui, chromeApi, initialUiBinding); current();
      if (!same(first, await readFrame()) || !same(captured, await checkReceipt())) fail();
      await assertFigureResumeUiOwnerCurrent(sender, ui, chromeApi, initialUiBinding); current();
      if (!same(first, await readFrame())) fail();
      current(); pinnedUi = ui; pinnedTarget = captured;
      return first;
    };
    try {
      return await Promise.race([work(), new Promise((_, reject) => {
        timer = setTimeout(() => { live = false; reject(Object.assign(new Error('FIGURE_SOURCE_OWNER_TIMEOUT'),
          { code: 'FIGURE_SOURCE_OWNER_TIMEOUT', retryable: false })); }, 4000);
      })]);
    } finally { live = false; clearTimeout(timer); }
  };
}

async function handleRoutedMessage(
  message, sender, onProgress, reverseState = {}, onFigureCheckpoint = null,
  onWorkspaceCommitGuard = null
) {
  if (sender?.id === chrome.runtime.id && SciLLM.isOfflineArticleMutationType(message?.type)) {
    let offlineSource = SciLLM.parseOfflineArticleReaderUrl(sender.url, chrome.runtime.getURL(''));
    if (!offlineSource) {
      let sourceTab = sender.tab?.id ? await chrome.tabs.get(sender.tab.id).catch(() => null) : null;
      if (!sourceTab && String(sender?.url || '').split(/[?#]/)[0] === chrome.runtime.getURL('popup.html')) {
        sourceTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
      }
      offlineSource = SciLLM.parseOfflineArticleReaderUrl(sourceTab?.url || sourceTab?.pendingUrl, chrome.runtime.getURL(''));
    }
    if (offlineSource) {
      return { success: false, error: { code: 'OFFLINE_ARTICLE_READ_ONLY',
        message: '离线记录为只读；需要修改或重新分析时请打开在线原文。' } };
    }
  }
  if (globalThis.SciLLM?.RUNTIME_WORKBENCH_MESSAGE_TYPES?.has(message?.type)) {
    try { return { success: true, data: await getRuntimeWorkbenchBridge().handle(message, sender) }; }
    catch (error) { return { success: false, error: { code: error.code || 'WORKBENCH_RUNTIME_FAILED' } }; }
  }
  const taskStartedAt = Number.isFinite(reverseState.startedAt) ? reverseState.startedAt : Date.now();
  let figureResumeUiOwner = null;
  const assertOwnerCurrent = async (strictCreationOwner = false) => {
    if (!strictCreationOwner && message?.type === 'LLM_CONTROL_OPERATION' &&
        message.operationScope === 'figure' &&
        ['authorize-user-resume', 'figure-vision-decision'].includes(message.command)) {
      figureResumeUiOwner = await assertFigureResumeUiOwnerCurrent(sender, figureResumeUiOwner, chrome, message.figureUiOwnerBinding);
      return true;
    }
    // A creation receipt needs affirmative browser ownership evidence. Keep
    // the older callback's optional capability behavior for its existing uses.
    if (strictCreationOwner && (
      typeof chrome.runtime?.id !== 'string' || !chrome.runtime.id.trim() ||
      sender?.id !== chrome.runtime.id ||
      !Number.isSafeInteger(sender?.tab?.id) || sender.tab.id < 0 ||
      !Number.isSafeInteger(sender?.frameId) || sender.frameId < 0 ||
      typeof sender?.documentId !== 'string' || !sender.documentId.trim() ||
      typeof chrome.webNavigation?.getFrame !== 'function'
    )) {
      const error = new Error('CANCELLED');
      error.code = 'CANCELLED';
      error.retryable = false;
      throw error;
    }
    if (sender?.id !== chrome.runtime.id || !sender?.tab ||
        !Number.isSafeInteger(Number(sender.tab.id)) ||
        !Number.isSafeInteger(Number(sender.frameId)) ||
        typeof chrome.webNavigation?.getFrame !== 'function') return true;
    if (!String(sender.documentId || '')) {
      const error = new Error('CANCELLED');
      error.code = 'CANCELLED';
      error.retryable = false;
      throw error;
    }
    const readCurrentDocument = async () => {
      let frame = null;
      try {
        frame = await chrome.webNavigation.getFrame({
          tabId: Number(sender.tab.id), frameId: Number(sender.frameId)
        });
      } catch (_) {}
      if (frame) return frame;
      // Chromium omits extension-owned PDF pages from webNavigation.getFrame.
      // An exact browser document-ID message proves that our live PDF receiver
      // still exists. Never use this fallback to override a different document
      // returned by the browser, or accept ordinary/foreign extension pages.
      try {
        await SciLLM.resolveOwnPdfReaderSenderTab(chrome, sender);
        return { documentId: String(sender.documentId) };
      } catch (_) { return null; }
    };
    const current = await readCurrentDocument();
    if (!current || String(current.documentId || '') !== String(sender.documentId || '')) {
      if (current && String(current.documentId || '')) {
        await llmRouter.commitTrustedDocument({
          senderExtensionId: chrome.runtime.id,
          senderTabId: Number(sender.tab.id),
          senderFrameId: Number(sender.frameId),
          senderDocumentId: String(current.documentId)
        });
      }
      const error = new Error('CANCELLED');
      error.code = 'CANCELLED';
      error.retryable = false;
      throw error;
    }
    await llmRouter.commitTrustedDocument({
      senderExtensionId: chrome.runtime.id,
      senderTabId: Number(sender.tab.id),
      senderFrameId: Number(sender.frameId),
      senderDocumentId: String(current.documentId)
    });
    const confirmed = await readCurrentDocument();
    if (!confirmed || String(confirmed.documentId || '') !== String(sender.documentId || '')) {
      if (confirmed && String(confirmed.documentId || '')) {
        await llmRouter.commitTrustedDocument({
          senderExtensionId: chrome.runtime.id,
          senderTabId: Number(sender.tab.id),
          senderFrameId: Number(sender.frameId),
          senderDocumentId: String(confirmed.documentId)
        });
      }
      const error = new Error('CANCELLED');
      error.code = 'CANCELLED';
      error.retryable = false;
      throw error;
    }
    return true;
  };
  const readTrustedFrameUrl = async () => {
    // New HTML archive proofs need a live URL as well as a browser document ID:
    // history navigation can change the article without changing documentId.
    await assertOwnerCurrent(true);
    let frame = null;
    try {
      frame = await chrome.webNavigation.getFrame({ tabId: sender.tab.id, frameId: sender.frameId });
    } catch (_) {}
    if (!frame) {
      // Only our exact PDF receiver can prove an omitted extension frame.
      // The helper addresses the browser document ID and reads its live URL.
      const reader = await SciLLM.resolveOwnPdfReaderSenderTab(chrome, sender);
      return reader.url;
    }
    if (!frame || frame.documentId !== sender.documentId || typeof frame.url !== 'string' || !frame.url) {
      const error = new Error('CANCELLED');
      error.code = 'CANCELLED';
      error.retryable = false;
      throw error;
    }
    return frame.url;
  };
  const runtimeOwnerRequired=['LLM_ANALYZE_DOCUMENT','LLM_ANALYZE_REVIEW_OUTLINE','LLM_AUTOFILL_LITERATURE_NOTE','RUNTIME_TASK_CONFIRM_SAVE'].includes(message?.type) || message?.operationScope==='runtime' || message?.runtimeCommit===true;
  const assertTrustedOwnerCurrent = () => assertOwnerCurrent(runtimeOwnerRequired);
  const assertDocumentCreationOwnerCurrent = () => assertOwnerCurrent(true);
  let response = await llmRouter.handle(message, {
    verifyNavigationArchiveContext: async binding => {
      await assertDocumentCreationOwnerCurrent();
      const result = await chrome.tabs.sendMessage(sender.tab.id, {
        action: 'validateNavigationArchiveContext', binding
      }, { frameId: sender.frameId, documentId: sender.documentId });
      await assertDocumentCreationOwnerCurrent();
      return result;
    },
    verifyTranslationContext: async request => {
      const receipt = await verifyLiveTranslationContext(request, sender, assertDocumentCreationOwnerCurrent);
      reverseState.translationBinding = receipt.documentBinding;
      return receipt;
    },
    verifyPdfMetadataContext: async query => {
      await SciLLM.resolveOwnPdfReaderSenderTab(chrome, sender);
      await assertDocumentCreationOwnerCurrent();
      const result = await chrome.tabs.sendMessage(sender.tab.id, {
        action: 'validatePdfMetadataContext', binding: query.binding
      }, {frameId: sender.frameId, documentId: sender.documentId});
      await assertDocumentCreationOwnerCurrent();
      return result;
    },
    verifyPdfFigureContext: async query => {
      let validReader = false;
      try {
        const reader = new URL(sender?.url);
        const runtime = new URL(chrome.runtime.getURL(''));
        validReader = /^(chrome|moz)-extension:$/.test(runtime.protocol) &&
          reader.protocol === runtime.protocol && reader.host === runtime.host &&
          !reader.username && !reader.password && reader.pathname === '/pdf-reader.html';
      } catch (_) { /* A missing or malformed sender is not a PDF owner. */ }
      if (sender?.id !== chrome.runtime.id || !Number.isInteger(sender?.tab?.id) ||
          !Number.isInteger(sender?.frameId) || !sender.documentId ||
          !validReader) {
        const error = new Error('PDF_FIGURE_OWNER_UNAVAILABLE');
        error.code = 'PDF_FIGURE_OWNER_UNAVAILABLE';
        throw error;
      }
      return chrome.tabs.sendMessage(sender.tab.id, {
        action: 'validatePdfFigureProductionContext', ...query
      }, { frameId: sender.frameId, documentId: sender.documentId });
    },
    onProgress,
    onFigureCheckpoint,
    ...createFigureTerminationTransport(sender, assertDocumentCreationOwnerCurrent),
    verifyFigureSourceTargetAuthority: message?.figureSourceWriteId ||
      ['ARTICLE_WORKSPACE_FIGURE_SOURCE_WRITE_STATUS', 'ARTICLE_WORKSPACE_FIGURE_SOURCE_WRITE_FENCE'].includes(message?.type)
      ? createFigureSourceTargetAuthority(sender, chrome, message.figureUiOwnerBinding) : undefined,
    confirmPdfFigureInventory: async request => {
      await assertTrustedOwnerCurrent();
      const result=await chrome.tabs.sendMessage(sender.tab.id,{
        action:'confirmPdfFigureRuntimeInventory',...request
      },{frameId:sender.frameId,documentId:sender.documentId});
      await assertTrustedOwnerCurrent();
      return result;
    },
    onWorkspaceCommitGuard,
    trustedContentScript: ['ARTICLE_RESTORE_REGISTER_COMMIT',
      'ARTICLE_WORKSPACE_COMMIT_PREPARED_RESTORE'].includes(message?.type) &&
      Boolean(sender?.tab?.id) && sender?.id === chrome.runtime.id,
    trustedExtensionSender: sender?.id === chrome.runtime.id,
    senderExtensionId: String(sender?.id || ''),
    senderTabId: Number(sender?.tab?.id),
    senderFrameId: Number(sender?.frameId),
    senderDocumentId: String(sender?.documentId || ''),
    assertTrustedOwnerCurrent,
    assertRadarOwnerCurrent: globalThis.BrevessRadar.createRadarOwnerGuard({ runtime: chrome.runtime, webNavigation: chrome.webNavigation, sender }),
    readTrustedFrameUrl,
    assertDocumentCreationOwnerCurrent,
    senderUrl: String(sender?.url || ''),
    runtimeBaseUrl: chrome.runtime.getURL('')
  }).catch(error => ({ success: false, error: {
    code: /^[A-Z][A-Z0-9_]{2,100}$/u.test(error?.code || '') ? error.code : 'LLM_TASK_FAILED',
    message: error?.code === 'CANCELLED' ? '任务已取消' : '任务未完成，请查看服务设置和诊断'
  } }));
  const taskFinishedAt = Date.now();
  if (Array.isArray(reverseState.tokenUsageWrites) &&
      reverseState.tokenUsageWrites.length) {
    await Promise.allSettled(reverseState.tokenUsageWrites);
  }
  const notificationUsage = aggregateNotificationTokenUsage(
    reverseState.tokenUsageEvents
  );
  if (response?.success && response.data && notificationUsage) {
    response = {
      ...response,
      data: {
        ...response.data,
        notificationUsage
      }
    };
  }
  const taskFeature = resolveTokenUsageFeature(message, {});
  if (taskFeature) {
    const task = SciLLM.createTaskTelemetry({
      taskId: taskFeature[0], label: taskFeature[1],
      operationId: message.operationId || '', startedAt: taskStartedAt, finishedAt: taskFinishedAt,
      status: response?.success ? 'success' : response?.error?.code === 'CANCELLED' ? 'cancelled' : 'failed',
      engine: response?.success && response.data?.cacheHits > 0 && !reverseState.tokenUsageEvents?.length
        ? '缓存（未调用模型）' : '', events: reverseState.tokenUsageEvents
    });
    const generationOnly = response?.success === true &&
      ['LLM_ANALYZE_FIGURES', 'LLM_ANALYZE_FIGURE_PANEL', 'LLM_AUTOFILL_LITERATURE_NOTE',
        'LLM_ANALYZE_DOCUMENT', 'LLM_ANALYZE_REVIEW_OUTLINE'].includes(message.type);
    if (generationOnly) Object.assign(task, {
      phase: 'validating', terminal: false, generationSucceeded: true, commitConfirmed: false
    });
    const formattedTask = SciLLM.formatTaskTelemetry(task);
    const taskUsage = { ...notificationUsage, ...task,
      taskSummaryText: generationOnly
        ? `${task.label}生成完成，正在核验/保存${formattedTask.slice(formattedTask.indexOf(' · '))}`
        : formattedTask };
    response = response?.success
      ? { ...response, data: { ...response.data, notificationTask: task, notificationUsage: taskUsage } }
      : { ...response, error: { ...response?.error, notificationTask: task, notificationUsage: taskUsage } };
    const target = trustedOriginProgressTarget(sender, chrome.runtime.id);
    if (target) {
      await chrome.tabs.sendMessage(target.tabId, {
        action: generationOnly ? 'llmTaskGenerated' : 'llmTaskFinished', task,
        workspaceLifecycle: Number.isInteger(message.workspaceLifecycle) ? message.workspaceLifecycle : undefined
      }, { frameId: target.frameId, documentId: target.documentId }).catch(() => {});
    }
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
  } else if (message.type === 'ARTICLE_WORKSPACE_FINALIZE_DELETE' &&
      response.data.deleted && response.data.alreadyMissing !== true) {
    response.data.openTabs = await coordinateOpenArticleWorkspaceTabs(
      'finalizeExternalArticleWorkspaceDeletion',
      message.workspaceId,
      response.data.workspaceGeneration
    );
  }
  return response;
}

function createFigureTerminationTransport(sender, assertCurrent) {
  const send = async (action, value) => {
    await assertCurrent();
    return chrome.tabs.sendMessage(sender.tab.id, { ...value, action },
      { frameId: sender.frameId, documentId: sender.documentId });
  };
  return {
    captureFigureTerminationOwner: value => send('captureFigureTerminationOwner', value),
    onFigureTerminationReceipt: value => send('applyFigureTerminationReceipt', value)
  };
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

async function resolveFigureImageCandidates(message = {}, options = {}) {
  if (options.signal?.aborted) throw exportAbortError();
  const url = parseRemoteFigureUrl(message.url);
  const tileSource = typeof message.imageSource === 'string' && message.imageSource &&
    typeof SciLLM.parseNcbiFigureTileshopSource === 'function'
    ? SciLLM.parseNcbiFigureTileshopSource(url.href, message.documentUrl, message.imageSource)
    : null;
  if (tileSource) {
    const cacheKey = tileSource.manifestUrl + '|' + tileSource.imageSource;
    const cachedTile = figureViewerResolutionCache.get(cacheKey);
    if (cachedTile && Date.now() - cachedTile.capturedAt < 30 * 60 * 1000) {
      return { ...cachedTile.data, cacheHit: true };
    }
    const deadline = exportResourceDeadline(options.signal, 8000);
    try {
      const response = await fetch(tileSource.manifestUrl, {
        method: 'GET', redirect: 'error', cache: 'no-store', credentials: 'omit',
        referrerPolicy: 'no-referrer', signal: deadline.signal
      });
      if (!response.ok) throw Object.assign(new Error('NCBI Figure zoom source unavailable'), {
        code: 'NCBI_FIGURE_TILE_MANIFEST_INVALID'
      });
      const manifestText = await readFigureHtmlResponse(response, 128 * 1024);
      SciLLM.parseNcbiFigureTileshopManifest(manifestText, tileSource);
      const data = { candidates: [], sourceUrl: tileSource.viewerUrl,
        ncbiTileshopManifestText: manifestText };
      figureViewerResolutionCache.set(cacheKey, { capturedAt: Date.now(), data });
      if (figureViewerResolutionCache.size > 100) {
        figureViewerResolutionCache.delete(figureViewerResolutionCache.keys().next().value);
      }
      return { ...data, cacheHit: false };
    } finally { deadline.close(); }
  }
  const cached = figureViewerResolutionCache.get(url.href);
  if (cached && Date.now() - cached.capturedAt < 30 * 60 * 1000) {
    return { ...cached.data, cacheHit: true };
  }
  const deadline = exportResourceDeadline(options.signal, 30000);
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
      signal: deadline.signal
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
    if (options.signal?.aborted) throw exportAbortError();
    if (error?.name === 'AbortError' || deadline.timedOut) {
      throw Object.assign(new Error('Figure 大图页面解析超时'), {
        code: 'FIGURE_VIEWER_FETCH_TIMEOUT'
      });
    }
    throw error;
  } finally {
    deadline.close();
  }
}

const backgroundExportOperations = new Map();

function exportPublicError(error, fallback = 'CONTENT_EXPORT_FAILED') {
  const result = { code: String(error?.code || fallback), message: String(error?.message || fallback) };
  for (const key of ['stage', 'sessionID', 'itemState', 'snapshotState', 'notesAttached',
    'partial', 'writeOutcomeUnknown', 'retrySafe', 'operationId']) {
    if (error?.[key] !== undefined) result[key] = error[key];
  }
  return result;
}

function exportAbortError() {
  return Object.assign(new Error('导出已取消'), { code: 'CANCELLED', name: 'AbortError' });
}

function scopedBackgroundExport(message, sender, { create = true } = {}) {
  if (!message.operationId) return null;
  if (sender?.id !== chrome.runtime.id || !Number.isInteger(sender?.tab?.id) || sender.tab.id < 0 ||
      !Number.isInteger(Number(sender.frameId || 0)) || Number(sender.frameId || 0) < 0 ||
      !/^[a-zA-Z0-9:._-]{1,160}$/.test(String(message.operationId)) ||
      !String(message.contentDocumentIdentity || '') || !String(message.navigationIdentity || '') ||
      !String(message.documentUrl || '')) {
    throw Object.assign(new Error('导出来源无效'), { code: 'EXPORT_OPERATION_SOURCE_INVALID' });
  }
  const binding = { tabId: sender.tab.id, frameId: Number(sender.frameId || 0),
    chromeDocumentId: String(sender.documentId || ''),
    contentDocumentIdentity: String(message.contentDocumentIdentity),
    navigationIdentity: String(message.navigationIdentity), documentUrl: String(message.documentUrl),
    sourceLifecycle: Number(message.sourceLifecycle) || 0 };
  const key = JSON.stringify([message.operationId, binding.tabId, binding.frameId,
    binding.chromeDocumentId || binding.contentDocumentIdentity]);
  let record = backgroundExportOperations.get(key);
  if (record && JSON.stringify(record.binding) !== JSON.stringify(binding)) {
    throw Object.assign(new Error('导出来源已变化'), { code: 'EXPORT_OPERATION_SOURCE_CHANGED' });
  }
  if (!record && create) {
    for (const [oldKey, old] of backgroundExportOperations) {
      if (!old.active && Date.now() - old.createdAt > 15 * 60 * 1000) backgroundExportOperations.delete(oldKey);
    }
    if (backgroundExportOperations.size >= 256) {
      throw Object.assign(new Error('导出操作过多，请稍后重试'), { code: 'EXPORT_OPERATION_LIMIT' });
    }
    record = { operationId: String(message.operationId), connectorOperationId: 'export-' + Date.now() + '-' + Math.random().toString(36).slice(2), binding, controller: new AbortController(),
      resources: new Map(), cancelledResources: new Set(), createdAt: Date.now(), active: 0 };
    backgroundExportOperations.set(key, record);
  }
  return record;
}

function cancelBackgroundExport(message, sender) {
  const record = scopedBackgroundExport(message, sender);
  if (!record) return { success: false, cancelled: false };
  if (message.type === 'EXPORT_CANCEL_RESOURCE') {
    const resourceId = String(message.resourceId || '');
    if (!resourceId) return { success: false, cancelled: false };
    record.cancelledResources.add(resourceId);
    record.resources.get(resourceId)?.abort();
  } else {
    record.controller.abort();
    for (const controller of record.resources.values()) controller.abort();
  }
  return { success: true, cancelled: true };
}

function exportResourceDeadline(signal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener?.('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  return { signal: controller.signal, get timedOut() { return timedOut; },
    abort() { controller.abort(); },
    close() { clearTimeout(timer); signal?.removeEventListener?.('abort', abort); } };
}

function waitForBackgroundExportSignal(promise, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; signal?.removeEventListener?.('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(exportAbortError());
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener?.('abort', abort, { once: true });
    Promise.resolve(promise).then(value => finish(null, value), error => finish(error));
  });
}

async function waitForExportImageCache(promise, signal) {
  const deadline = exportResourceDeadline(signal, 5000);
  try { return await waitForBackgroundExportSignal(promise, deadline.signal); }
  finally { deadline.close(); }
}

async function runBackgroundExportResource(message, sender) {
  const record = scopedBackgroundExport(message, sender);
  const resourceId = String(message.resourceId || '');
  if (record && (!/^[a-zA-Z0-9:._-]{1,160}$/.test(resourceId) ||
      record.controller.signal.aborted || record.cancelledResources.has(resourceId))) throw exportAbortError();
  const controller = new AbortController();
  const abort = () => controller.abort();
  record?.controller.signal.addEventListener('abort', abort, { once: true });
  if (record) { record.resources.set(resourceId, controller); record.active++; }
  try {
    if (message.type === 'EXPORT_DECODE_TIFF_RESOURCE') {
      const senderSource=new URL(sender.url || ''), boundSource=new URL(message.documentUrl || '');
      senderSource.hash='';boundSource.hash='';
      if(!record || senderSource.href!==boundSource.href || message.tiffBinding?.documentUrl!==message.documentUrl)
        throw Object.assign(new Error('TIFF_SOURCE_BINDING'), {code:'TIFF_SOURCE_BINDING'});
    }
    return await waitForBackgroundExportSignal((message.type === 'EXPORT_DECODE_TIFF_RESOURCE'
      ? fetchNativeTiffSource(message, { signal: controller.signal })
      : message.type === 'EXPORT_RESOLVE_IMAGE_CANDIDATES'
      ? resolveFigureImageCandidates(message, { signal: controller.signal })
      : message.type === 'EXPORT_FETCH_SNAPSHOT_RESOURCE'
      ? fetchExportSnapshotResource(message, { signal: controller.signal })
      : fetchExportImageResource(message, { signal: controller.signal })), controller.signal);
  } finally {
    record?.controller.signal.removeEventListener('abort', abort);
    if (record?.resources.get(resourceId) === controller) record.resources.delete(resourceId);
    if (record) record.active--;
  }
}

async function runBackgroundZoteroExport(message, sender) {
  const record = scopedBackgroundExport(message, sender);
  if (record?.controller.signal.aborted) throw exportAbortError();
  if (record) record.active++;
  try {
    return await SciLLM.saveEnhancedSnapshotToZotero(message.payload || {}, {
      operationId: record?.connectorOperationId,
      signal: record?.controller.signal, requestTimeoutMs: 120000,
      onProgress: progress => {
        if (!record || !chrome.tabs?.sendMessage) return;
        const options = record.binding.chromeDocumentId
          ? { documentId: record.binding.chromeDocumentId } : { frameId: record.binding.frameId };
        Promise.resolve(chrome.tabs.sendMessage(record.binding.tabId, {
          type: 'ARTICLE_CONTENT_EXPORT_BACKGROUND_PROGRESS', operationId: record.operationId,
          ...record.binding, progress
        }, options)).catch(() => undefined);
      }
    });
  } catch (error) { if (record) error.operationId = record.operationId; throw error; }
  finally { if (record) record.active--; }
}

async function fetchExportImageResourceUncached(message = {}, options = {}) {
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
  const deadline = exportResourceDeadline(options.signal, 45000);
  if (options.signal?.aborted) { deadline.close(); throw exportAbortError(); }
  try {
    const response = await fetch(url.href, {
      method: 'GET',
      redirect: message.requireExactSource === true ? 'error' : 'follow',
      cache: 'no-store',
      credentials: 'include',
      referrer: referrer || undefined,
      referrerPolicy: 'strict-origin-when-cross-origin',
      signal: deadline.signal
    });
    if (message.requireExactSource === true && response.url !== url.href) {
      throw Object.assign(new Error('Figure tile source changed'), { code: 'EXPORT_IMAGE_FETCH_FAILED' });
    }
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
    if (message.tiffOnly === true && !['image/tiff', 'image/tif'].includes(contentType)) {
      await response.body?.cancel?.();
      throw Object.assign(new Error('TIFF_MIME'), {code:'TIFF_MIME'});
    }
    const bytes = message.tiffOnly === true || /^image\/tiff?$/.test(contentType)
      ? await SciLLM.readBoundedTiffSourceBody(response, deadline.signal)
      : new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 40 * 1024 * 1024) {
      throw Object.assign(new Error('单张高清图为空或超过 40 MB'), {
        code: 'EXPORT_IMAGE_TOO_LARGE'
      });
    }
    return {
      dataUrl: `data:${contentType};base64,${bytesToBase64(bytes)}`,
      contentType,
      byteLength: bytes.length,
      httpStatus: response.status,
      sourceUrl: response.url || url.href
    };
  } catch (error) {
    deadline.abort();
    if (options.signal?.aborted) throw exportAbortError();
    if (error?.name === 'AbortError' || deadline.timedOut) {
      throw Object.assign(new Error('高清图下载超时'), {
        code: 'EXPORT_IMAGE_FETCH_TIMEOUT'
      });
    }
    throw error;
  } finally {
    deadline.close();
  }
}

async function fetchExportSnapshotResource(message = {}, options = {}) {
  const kind = String(message.kind || 'image');
  if (kind === 'image') return fetchExportImageResource(message, options);
  if (!['stylesheet', 'font'].includes(kind)) {
    throw Object.assign(new Error('Unsupported snapshot resource'), { code: 'EXPORT_RESOURCE_TYPE' });
  }
  const url = parseRemoteFigureUrl(message.url, 'EXPORT_INVALID_RESOURCE_URL');
  const limit = (kind === 'stylesheet' ? 2 : 8) * 1024 * 1024;
  const deadline = exportResourceDeadline(options.signal, 15000);
  if (options.signal?.aborted) { deadline.close(); throw exportAbortError(); }
  try {
    const response = await fetch(url.href, {
      method: 'GET', credentials: 'omit', redirect: 'follow',
      referrerPolicy: 'no-referrer', signal: deadline.signal
    });
    if (!response.ok) throw Object.assign(new Error('Snapshot resource download failed'), {
      code: 'EXPORT_RESOURCE_FETCH_FAILED'
    });
    parseRemoteFigureUrl(response.url || url.href, 'EXPORT_INVALID_RESOURCE_URL');
    const sourceContentType = String(response.headers.get('content-type') || '')
      .split(';', 1)[0].trim().toLowerCase();
    const woff2Alias = kind === 'font' && /^(?:application\/font-woff2|application\/x-font-woff2)$/.test(sourceContentType);
    const contentType = woff2Alias ? 'font/woff2' : sourceContentType;
    const validType = kind === 'stylesheet' ? contentType === 'text/css'
      : /^(?:font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|x-font-woff|x-font-ttf|x-font-opentype|vnd\.ms-fontobject))$/.test(contentType);
    if (!validType) throw Object.assign(new Error('Snapshot resource returned an unexpected type'), {
      code: 'EXPORT_RESOURCE_TYPE'
    });
    if (Number(response.headers.get('content-length')) > limit) {
      throw Object.assign(new Error('Snapshot resource is too large'), { code: 'EXPORT_RESOURCE_TOO_LARGE' });
    }
    const reader = response.body?.getReader?.();
    if (!reader) throw Object.assign(new Error('Snapshot resource stream unavailable'), { code: 'EXPORT_RESOURCE_FETCH_FAILED' });
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw Object.assign(new Error('Snapshot resource is too large'), { code: 'EXPORT_RESOURCE_TOO_LARGE' });
        }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    if (!size) throw Object.assign(new Error('Snapshot resource is empty'), { code: 'EXPORT_RESOURCE_FETCH_FAILED' });
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (woff2Alias && (bytes[0] !== 0x77 || bytes[1] !== 0x4f || bytes[2] !== 0x46 || bytes[3] !== 0x32)) {
      throw Object.assign(new Error('Snapshot font bytes do not match WOFF2 MIME'), { code: 'EXPORT_RESOURCE_TYPE' });
    }
    return {
      ...(kind === 'stylesheet' ? { text: new TextDecoder().decode(bytes) }
        : { dataUrl: `data:${contentType};base64,${bytesToBase64(bytes)}` }),
      contentType, sourceUrl: response.url || url.href, byteLength: size
    };
  } catch (error) {
    deadline.abort();
    if (options.signal?.aborted) throw exportAbortError();
    if (error?.name === 'AbortError' || deadline.timedOut) throw Object.assign(new Error('Snapshot resource download timed out'), {
      code: 'EXPORT_RESOURCE_FETCH_TIMEOUT'
    });
    throw error;
  } finally { deadline.close(); }
}

async function fetchExportImageResource(message = {}, options = {}) {
  if (options.signal?.aborted) throw exportAbortError();
  const url = parseRemoteFigureUrl(message.url, 'EXPORT_INVALID_IMAGE_URL');
  const cacheMode = message.requireExactSource !== true && ['read-only', 'read-write'].includes(message.cacheMode)
    ? message.cacheMode : 'none';
  const cacheOnly = message.cacheMode === 'read-only';
  const cacheReceipt = async record => {
    const bytes = record?.bytes instanceof Uint8Array ? record.bytes : new Uint8Array(record?.bytes || []);
    if (!bytes.length || record.byteLength !== bytes.length || record.cacheKey !== url.href) return null;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return { cacheKey: url.href, sourceUrl: record.sourceUrl || url.href, byteLength: bytes.length,
      sha256: Array.from(digest, value => value.toString(16).padStart(2, '0')).join('') };
  };
  if (cacheMode !== 'none') {
    try {
      const cached = await waitForExportImageCache(figureImageCache.get(url.href), options.signal);
      const bytes = cached?.bytes instanceof Uint8Array
        ? cached.bytes : new Uint8Array(cached?.bytes || []);
      if (options.signal?.aborted) throw exportAbortError();
      const receipt = await cacheReceipt(cached);
      if (receipt) {
        if(message.tiffOnly === true && bytes.length > 20*1024*1024) throw Object.assign(new Error('TIFF_BYTES'),{code:'TIFF_BYTES'});
        return {
          dataUrl: `data:${cached.contentType};base64,${bytesToBase64(bytes)}`,
          contentType: cached.contentType,
          byteLength: bytes.length,
          httpStatus: cached.httpStatus || null,
          sourceUrl: cached.sourceUrl || url.href,
          cacheHit: true, cacheStored: true, cacheReceipt: receipt
        };
      }
    } catch (_) {
      if (options.signal?.aborted) throw exportAbortError();
      // A regular viewer can still fetch; restoration is strictly cache-only.
    }
  }
  if (cacheOnly) throw Object.assign(new Error('已保存原图不在本地缓存中。'), { code: 'FIGURE_IMAGE_CACHE_MISS' });
  const data = await fetchExportImageResourceUncached({
    ...message,
    url: url.href
  }, options);
  if (options.signal?.aborted) throw exportAbortError();
  let receipt = null;
  if (cacheMode === 'read-write' && data?.dataUrl) {
    const encoded = String(data.dataUrl).split(',', 2)[1] || '';
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    try {
      await waitForExportImageCache(figureImageCache.put({ requestedSourceUrl: url.href,
        sourceUrl: data.sourceUrl || url.href, contentType: data.contentType, httpStatus: data.httpStatus, bytes }), options.signal);
      const readback = await waitForExportImageCache(figureImageCache.get(url.href), options.signal);
      const savedBytes = readback?.bytes instanceof Uint8Array ? readback.bytes : new Uint8Array(readback?.bytes || []);
      if (readback?.sourceUrl === (data.sourceUrl || url.href) && readback?.contentType === data.contentType &&
          savedBytes.length === bytes.length && savedBytes.every((value, index) => value === bytes[index]))
        receipt = await cacheReceipt(readback);
    } catch (_) { /* The viewer may still display bytes; no saved receipt is claimed. */ }
    if (options.signal?.aborted) throw exportAbortError();
  }
  return { ...data, cacheHit: false, cacheStored: Boolean(receipt), cacheReceipt: receipt };
}

async function relayPdfFromPublisherTab(message = {}, sender = {}) {
  const senderUrl = String(sender?.url || '');
  if (!SciLLM.isPdfReaderUrl(senderUrl)) {
    throw Object.assign(new Error('PDF_RELAY_UNTRUSTED_SENDER'), {
      code: 'PDF_RELAY_UNTRUSTED_SENDER'
    });
  }
  const sourceTabId = Number(message.sourceTabId);
  if (!Number.isInteger(sourceTabId) || sourceTabId < 0) {
    throw Object.assign(new Error('PDF_RELAY_SOURCE_TAB_REQUIRED'), {
      code: 'PDF_RELAY_SOURCE_TAB_REQUIRED'
    });
  }
  let sourceUrl;
  let uploadUrl;
  try {
    sourceUrl = new URL(String(message.sourceUrl || ''));
    uploadUrl = new URL(String(message.uploadUrl || ''));
  } catch (_) {
    throw Object.assign(new Error('PDF_RELAY_INVALID_URL'), {
      code: 'PDF_RELAY_INVALID_URL'
    });
  }
  if (sourceUrl.protocol !== 'https:' || uploadUrl.protocol !== 'https:') {
    throw Object.assign(new Error('PDF_RELAY_HTTPS_REQUIRED'), {
      code: 'PDF_RELAY_HTTPS_REQUIRED'
    });
  }
  const sourceTab = await chrome.tabs.get(sourceTabId);
  const sourceTabUrl = new URL(String(sourceTab?.url || sourceTab?.pendingUrl || ''));
  if (sourceTabUrl.origin !== sourceUrl.origin) {
    throw Object.assign(new Error('PDF_RELAY_SOURCE_ORIGIN_MISMATCH'), {
      code: 'PDF_RELAY_SOURCE_ORIGIN_MISMATCH'
    });
  }
  const expectedParentUrl = SciLLM.normalizeTabDocumentUrl(message.expectedParentUrl);
  if (expectedParentUrl) {
    let expectedParent;
    try {
      expectedParent = new URL(expectedParentUrl);
    } catch (_) {
      expectedParent = null;
    }
    if (!expectedParent || expectedParent.origin !== sourceTabUrl.origin ||
        expectedParent.pathname !== sourceTabUrl.pathname) {
      throw Object.assign(new Error('PDF_RELAY_SOURCE_TAB_CHANGED'), {
        code: 'PDF_RELAY_SOURCE_TAB_CHANGED'
      });
    }
  }
  const maxBytes = Math.min(
    SciLLM.PDF_MINERU_MAX_FILE_BYTES,
    Math.max(1, Math.floor(Number(message.maxBytes) || SciLLM.PDF_MINERU_MAX_FILE_BYTES))
  );
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: sourceTabId },
    world: 'ISOLATED',
    func: async (publisherPdfUrl, signedUploadUrl, byteLimit) => {
      function fail(code, details = {}) {
        return { success: false, code, ...details };
      }
      try {
        const sourceResponse = await fetch(publisherPdfUrl, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          redirect: 'follow'
        });
        if (!sourceResponse.ok) {
          return fail('PDF_RELAY_SOURCE_HTTP', { status: sourceResponse.status });
        }
        const announcedSize = Number(sourceResponse.headers.get('content-length')) || 0;
        if (announcedSize > byteLimit) {
          return fail('PDF_RELAY_FILE_TOO_LARGE', { size: announcedSize });
        }
        const bytes = await sourceResponse.arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength > byteLimit) {
          return fail(
            bytes.byteLength ? 'PDF_RELAY_FILE_TOO_LARGE' : 'PDF_RELAY_EMPTY_FILE',
            { size: bytes.byteLength }
          );
        }
        const signature = new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength));
        if (signature.length < 5 || signature[0] !== 0x25 || signature[1] !== 0x50 ||
            signature[2] !== 0x44 || signature[3] !== 0x46 || signature[4] !== 0x2d) {
          return fail('PDF_RELAY_NOT_PDF', {
            contentType: String(sourceResponse.headers.get('content-type') || '')
          });
        }
        const uploadResponse = await fetch(signedUploadUrl, {
          method: 'PUT',
          body: bytes
        });
        if (!uploadResponse.ok) {
          return fail('PDF_RELAY_UPLOAD_HTTP', { status: uploadResponse.status });
        }
        return {
          success: true,
          size: bytes.byteLength,
          sourceStatus: sourceResponse.status,
          uploadStatus: uploadResponse.status
        };
      } catch (error) {
        return fail('PDF_RELAY_NETWORK_FAILED', {
          message: String(error?.message || error || 'PDF_RELAY_NETWORK_FAILED')
        });
      }
    },
    args: [sourceUrl.href, uploadUrl.href, maxBytes]
  });
  if (!result?.success) {
    const error = new Error(String(result?.message || result?.code || 'PDF_RELAY_FAILED'));
    error.code = String(result?.code || 'PDF_RELAY_FAILED');
    error.details = result || null;
    throw error;
  }
  return {
    byteLength: Math.max(0, Number(result.size) || 0),
    sourceTabId,
    sourceUrl: sourceUrl.href
  };
}

const independentPageTools = SciLLM.createPageToolsService({
  chromeApi: chrome,
  getSnapshot: nonce => actionPopupTabSnapshots.get(nonce),
  ensureContent: (tabId, options) => SciLLM.ensureContentScriptForActivation(chrome, tabId, options),
  getShortcutKey: async () => SciLLM.normalizeKeyboardShortcuts(
    (await SciLLM.loadSettings(portableSettingsStorage)).keyboardShortcuts
  ).semanticFind
});
const standaloneSemanticFind = SciLLM.createSemanticFindLauncher({
  chromeApi: chrome,
  isEnabled: async () => (await independentPageTools.read()).semantic,
  getShortcutKey: async () => SciLLM.normalizeKeyboardShortcuts(
    (await SciLLM.loadSettings(portableSettingsStorage)).keyboardShortcuts
  ).semanticFind,
  ensureContent: (tabId, options) => SciLLM.ensureContentScriptForActivation(chrome, tabId, options)
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OFFLINE_ARTICLE_GET_SNAPSHOT' || message?.type === 'OFFLINE_READER_START_READING') {
    const ownBase = chrome.runtime.getURL('');
    const readerSender = sender?.id === chrome.runtime.id && sender.frameId === 0 &&
      SciLLM.parseOfflineArticleReaderUrl(sender.url, ownBase);
    const panelSender = sender?.id === chrome.runtime.id &&
      String(sender.url || '').split(/[?#]/)[0] === chrome.runtime.getURL('popup.html');
    const tabId = readerSender ? sender.tab?.id : panelSender ? Number(message.tabId) : null;
    if (!Number.isInteger(tabId) || message.type === 'OFFLINE_READER_START_READING' && !readerSender) {
      sendResponse({ success: false, error: { code: 'OFFLINE_READER_SENDER_FORBIDDEN', message: '无法连接这篇离线文献，请从本机历史重新打开。' } });
      return false;
    }
    const opening = message.type === 'OFFLINE_READER_START_READING' ? beginToolbarSidePanelOpen(sender.tab) : null;
    chrome.tabs.get(tabId).then(async tab => {
      const expectedUrl = readerSender ? normalizedWarmUrl({ url: sender.url }) : String(message.readerUrl || '');
      if (!expectedUrl) throw Object.assign(new Error('离线文献已切换，请重新打开'), { code: 'OFFLINE_READER_CHANGED' });
      const result = await readOfflineArticleForTab(tab, expectedUrl);
      if (message.type === 'OFFLINE_READER_START_READING') return activateOfflineArticleReaderAndOpenSidePanel(tab, opening);
      return result;
    }).then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: { code: /^OFFLINE_[A-Z_]+$/.test(error?.code || '') ? error.code : 'OFFLINE_READER_UNAVAILABLE',
        message: '离线文献的保存记录暂不可用，请从本机历史重新打开。' } }));
    return true;
  }
  if (independentPageTools.handles(message?.type)) {
    SciLLM.keepAliveUntil(independentPageTools.handle(message, sender), chrome).then(sendResponse);
    return true;
  }
  if (ttsRouter.handles(message?.type)) {
    SciLLM.keepAliveUntil(ttsRouter.handle(message, sender), chrome).then(sendResponse);
    return true;
  }
  if (['USER_DATA_DIRECTORY_NATIVE_STATUS', 'USER_DATA_DIRECTORY_NATIVE_BIND',
    'LOCAL_READING_LIBRARY_OPEN_DIRECTORY'].includes(message?.type)) {
    SciLLM.keepAliveUntil(workspaceDirectoryController.handle(message, sender), chrome)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: SciLLM.publicWorkspaceDirectoryError(error) }));
    return true;
  }
  if (standaloneSemanticFind.handles(message?.type)) {
    SciLLM.keepAliveUntil(standaloneSemanticFind.handle(message, sender), chrome).then(sendResponse);
    return true;
  }
  if (message?.type === 'PDF_READER_START_READING' && sender.id === chrome.runtime.id &&
      sender.tab?.id && String(sender.url || '').startsWith(chrome.runtime.getURL('pdf-reader.html')) &&
      SciLLM.isPdfReaderUrl(sender.url)) {
    const readerTab = { ...sender.tab, url: sender.url };
    const opening = beginToolbarSidePanelOpen(readerTab);
    SciLLM.resolveOwnPdfReaderSenderTab(chrome, sender)
      .then(currentTab => activateTabAndOpenSidePanel(currentTab, opening))
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: { message: error.message } }));
    return true;
  }
  if (message?.type === 'BREVESS_MCP_OPEN_LOCAL_PDF') {
    const workbenchPath = chrome.runtime.getURL('workbench/index.html');
    const senderPath = String(sender?.url || '').split(/[?#]/u)[0];
    const trusted = sender?.id === chrome.runtime.id && sender?.frameId === 0 &&
      senderPath === workbenchPath;
    if (!trusted) {
      sendResponse({ success: false, error: {
        code: 'MCP_PDF_SENDER_FORBIDDEN',
        message: 'Only the BREVESS Workbench may open a local PDF through MCP'
      } });
      return false;
    }
    let fileUrl = '';
    try {
      const parsed = new URL(String(message.fileUrl || ''));
      if (parsed.protocol !== 'file:' || !/\.pdf$/iu.test(decodeURIComponent(parsed.pathname))) {
        throw new Error('not a local PDF');
      }
      fileUrl = parsed.href;
    } catch (_) {
      sendResponse({ success: false, error: {
        code: 'MCP_PDF_FILE_URL_INVALID',
        message: 'A file:// PDF URL is required'
      } });
      return false;
    }
    const readerUrl = SciLLM.createPdfReaderUrl(
      chrome.runtime.getURL.bind(chrome.runtime), fileUrl, String(message.title || '')
    );
    if (!readerUrl) {
      sendResponse({ success: false, error: {
        code: 'MCP_PDF_READER_URL_FAILED',
        message: 'Unable to construct the PDF reader URL'
      } });
      return false;
    }
    SciLLM.keepAliveUntil(chrome.tabs.create({ url: readerUrl, active: true }), chrome)
      .then(tab => sendResponse({ success: true, data: {
        opened: true, fileUrl, readerUrl, tabId: Number.isSafeInteger(tab?.id) ? tab.id : null,
        title: String(message.title || '')
      } }))
      .catch(error => sendResponse({ success: false, error: {
        code: 'MCP_PDF_OPEN_FAILED',
        message: String(error?.message || 'Unable to open the local PDF')
      } }));
    return true;
  }
  if (message?.type === 'SEMANTIC_FIND_OPEN_SETTINGS') {
    const owner = trustedOriginProgressTarget(sender, chrome.runtime.id);
    if (!owner) {
      sendResponse({
        success: false,
        error: {
          code: 'SEMANTIC_FIND_OWNER_UNAVAILABLE',
          message: 'Semantic find settings require a trusted document owner'
        }
      });
      return false;
    }
    SciLLM.keepAliveUntil(chrome.tabs.create({
      url: chrome.runtime.getURL('options.html#page=models&task=semantic_find')
    }), chrome).then(tab => sendResponse({
      success: true,
      data: { opened: true, tabId: Number.isSafeInteger(tab?.id) ? tab.id : null }
    })).catch(error => sendResponse({
      success: false,
      error: {
        code: 'SEMANTIC_FIND_SETTINGS_OPEN_FAILED',
        message: String(error?.message || 'Unable to open semantic find settings')
      }
    }));
    return true;
  }
  if (semanticFindService.handles(message?.type)) {
    SciLLM.keepAliveUntil(
      semanticFindService.handle(message, sender),
      chrome
    ).then(sendResponse).catch(error => sendResponse({
      success: false,
      error: {
        code: String(error?.code || 'SEMANTIC_FIND_FAILED'),
        message: String(error?.message || 'Semantic find failed')
      }
    }));
    return true;
  }
  if (message?.type === 'LLM_FOUNDATION_STATUS') {
    sendResponse({
      success: true,
      data: {
        version: '1.0.1',
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

  if (message?.type === 'ACTION_POPUP_GET_STATE') {
    actionPopupPublicState()
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({
        success: false,
        error: { code: 'ACTION_POPUP_STATE_FAILED', message: String(error?.message || error) }
      }));
    return true;
  }

  if (message?.type === 'ACTION_POPUP_START_READING') {
    const nonce = String(message.nonce || '');
    const snapshot = actionPopupTabSnapshots.get(nonce);
    actionPopupTabSnapshots.delete(nonce);
    const tab = snapshot?.tab;
    const fresh = snapshot && Date.now() - snapshot.createdAt <= ACTION_POPUP_SNAPSHOT_TTL_MS;
    if (!fresh || Number(message.tabId) !== tab?.id || !actionPopupReadableTab(tab)) {
      sendResponse({
        success: false,
        error: { code: 'ACTION_POPUP_TAB_CHANGED', message: '当前标签页已经变化，请重新打开菜单。' }
      });
      return false;
    }
    const panelOpen = beginToolbarSidePanelOpen(tab);
    if (!panelOpen) {
      sendResponse({
        success: false,
        error: { code: 'ACTION_POPUP_OPEN_FAILED', message: '无法打开研读侧栏。' }
      });
      return false;
    }
    handleToolbarAction(tab, panelOpen)
      .then(data => sendResponse({ success: true, data: { opened: true, ...data } }))
      .catch(error => sendResponse({
        success: false,
        error: {
          code: String(error?.code || 'ACTION_POPUP_OPEN_FAILED'),
          message: String(error?.message || '无法打开研读侧栏。')
        }
      }));
    return true;
  }

  if (message?.type === 'SIDE_PANEL_ACTIVATE_CURRENT_TAB') {
    const tabId = Number(message.tabId);
    chrome.tabs.get(tabId).then(async tab => {
      let currentUrl = SciLLM.normalizeTabDocumentUrl(tab?.url || tab?.pendingUrl);
      const expectedUrl = SciLLM.normalizeTabDocumentUrl(message.url);
      if (!currentUrl) {
        const state = await chrome.tabs.sendMessage(tabId, {
          action: 'getPdfWorkspaceState'
        }).catch(() => null);
        const readerUrl = SciLLM.normalizeTabDocumentUrl(state?.readerUrl);
        if (state?.pdfMode === true && SciLLM.isPdfReaderUrl(readerUrl)) {
          tab = {
            ...tab,
            url: readerUrl,
            pendingUrl: readerUrl,
            title: String(tab?.title || '文献 PDF')
          };
          currentUrl = readerUrl;
        }
      }
      if (!tab?.id || (expectedUrl && expectedUrl !== currentUrl)) {
        const error = new Error('SIDE_PANEL_TAB_CHANGED');
        error.code = 'SIDE_PANEL_TAB_CHANGED';
        throw error;
      }
      const extensionPage = currentUrl.startsWith(chrome.runtime.getURL(''));
      if (extensionPage && !SciLLM.isPdfReaderUrl(currentUrl) &&
          !SciLLM.parseOfflineArticleReaderUrl(currentUrl, chrome.runtime.getURL(''))) {
        const error = new Error('SIDE_PANEL_UNSUPPORTED_TAB');
        error.code = 'SIDE_PANEL_UNSUPPORTED_TAB';
        throw error;
      }
      const settings = await SciLLM.loadSettings(portableSettingsStorage);
      let freshTab = await chrome.tabs.get(tabId);
      let freshUrl = SciLLM.normalizeTabDocumentUrl(freshTab?.url || freshTab?.pendingUrl);
      if (!freshUrl) {
        const state = await chrome.tabs.sendMessage(tabId, { action: 'getPdfWorkspaceState' }).catch(() => null);
        const readerUrl = SciLLM.normalizeTabDocumentUrl(state?.readerUrl);
        if (state?.pdfMode === true && SciLLM.isPdfReaderUrl(readerUrl)) {
          freshTab = { ...freshTab, url: readerUrl, pendingUrl: readerUrl };
          freshUrl = readerUrl;
        }
      }
      if (freshTab?.id !== tab.id || freshTab?.windowId !== tab.windowId || freshUrl !== currentUrl) {
        const error = new Error('SIDE_PANEL_TAB_CHANGED');
        error.code = 'SIDE_PANEL_TAB_CHANGED';
        throw error;
      }
      tab = freshTab;
      const recognized = Boolean(SciLLM.parseOfflineArticleReaderUrl(currentUrl, chrome.runtime.getURL(''))) || SciLLM.isLikelyPdfUrl(currentUrl, tab.title) ||
        SciLLM.classifyLiteratureUrl(currentUrl, settings.literatureUrlWhitelist).recognized;
      if (!recognized && message.confirmedNonLiterature !== true) {
        const error = new Error('请先确认是否在此网页开启研读侧栏。');
        error.code = 'SIDE_PANEL_CONFIRMATION_REQUIRED';
        throw error;
      }
      return activateTabFromOpenSidePanel(tab);
    }).then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({
        success: false,
        error: {
          code: String(error?.code || 'SIDE_PANEL_ACTIVATION_FAILED'),
          message: String(error?.message || 'SIDE_PANEL_ACTIVATION_FAILED')
        }
      }));
    return true;
  }

  if (message?.type === 'PDF_BROWSER_SESSION_UPLOAD') {
    SciLLM.keepAliveUntil(relayPdfFromPublisherTab(message, sender), chrome)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({
        success: false,
        error: {
          code: String(error?.code || 'PDF_RELAY_FAILED'),
          message: String(error?.message || 'PDF_RELAY_FAILED'),
          details: error?.details || null
        }
      }));
    return true;
  }

  if (message?.type === 'ABBREVIATION_MEMORY_GET') {
    loadGlobalAbbreviationMemory()
      .then(memory => sendResponse({ success: true, data: { memory } }))
      .catch(error => sendResponse({
        success: false,
        error: { code: 'ABBREVIATION_MEMORY_GET_FAILED', message: error.message }
      }));
    return true;
  }

  if (message?.type === 'ABBREVIATION_MEMORY_MERGE') {
    mergeGlobalAbbreviationEntries(message.entries, {
      incrementSupport: message.incrementSupport === true,
      importedAt: new Date().toISOString()
    }).then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({
        success: false,
        error: { code: 'ABBREVIATION_MEMORY_MERGE_FAILED', message: error.message }
      }));
    return true;
  }

  if (message?.type === 'ABBREVIATION_MEMORY_MUTATE') {
    mutateGlobalAbbreviationEntry(message.mutation)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({
        success: false,
        error: {
          code: String(error?.code || 'ABBREVIATION_MEMORY_MUTATION_FAILED'),
          message: String(error?.message || 'ABBREVIATION_MEMORY_MUTATION_FAILED')
        }
      }));
    return true;
  }

  if (message?.type === 'LOCAL_READING_LIBRARY_QUERY') {
    const authorizeLibraryQuery = async () => {
      if (sender?.id !== chrome.runtime.id) throw Object.assign(new Error('LIBRARY_SENDER_INVALID'), {code:'LIBRARY_SENDER_INVALID'});
      const url = new URL(sender.url || '');
      if (url.pathname === '/workbench/index.html') await getRuntimeWorkbenchBridge().authorize(sender);
      else if (!['options.html', 'popup.html', 'action-popup.html'].some(path => {
        const allowed = new URL(chrome.runtime.getURL(path));
        return url.protocol === allowed.protocol && url.host === allowed.host && url.pathname === allowed.pathname;
      })) throw Object.assign(new Error('LIBRARY_SENDER_INVALID'), {code:'LIBRARY_SENDER_INVALID'});
    };
    SciLLM.keepAliveUntil(authorizeLibraryQuery().then(() => loadLocalReadingLibrary()).then(library =>
      SciLLM.queryLocalReadingLibrary(library, {
        kind: message.kind,
        abbreviationId: message.abbreviationId,
        query: message.query,
        scope: message.scope,
        tags: message.tags,
        tagMode: message.tagMode,
        page: message.page,
        pageSize: message.pageSize
      })), chrome)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({
        success: false,
        error: {
          code: String(error?.code || 'LOCAL_READING_LIBRARY_QUERY_FAILED'),
          message: String(error?.message || 'LOCAL_READING_LIBRARY_QUERY_FAILED')
        }
      }));
    return true;
  }

  if (['EXPORT_BEGIN_OPERATION', 'EXPORT_CANCEL_OPERATION', 'EXPORT_CANCEL_RESOURCE'].includes(message?.type)) {
    try {
      if (message.type === 'EXPORT_BEGIN_OPERATION') {
        const record = scopedBackgroundExport(message, sender);
        if (record?.controller.signal.aborted) throw exportAbortError();
        sendResponse({ success: true });
      } else sendResponse(cancelBackgroundExport(message, sender));
    } catch (error) { sendResponse({ success: false, error: exportPublicError(error) }); }
    return false;
  }

  if (['EXPORT_DECODE_TIFF_RESOURCE', 'EXPORT_FETCH_IMAGE_RESOURCE', 'EXPORT_FETCH_SNAPSHOT_RESOURCE', 'EXPORT_RESOLVE_IMAGE_CANDIDATES'].includes(message?.type)) {
    SciLLM.keepAliveUntil(runBackgroundExportResource(message, sender), chrome)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: exportPublicError(error, 'EXPORT_IMAGE_FETCH_FAILED') }));
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
    SciLLM.keepAliveUntil(runBackgroundZoteroExport(message, sender), chrome)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: exportPublicError(error, 'ZOTERO_IMPORT_FAILED') }));
    return true;
  }

  if (ROUTED_MESSAGE_TYPES.has(message?.type)) {
    const reverseState = {
      startedAt: Date.now(),
      localCodex: false,
      tokenUsageWrites: [],
      tokenUsageEvents: []
    };
    const onProgress = createRoutedLlmProgressTransport(
      message, sender, reverseState
    );
    const onFigureCheckpoint = message?.type === 'LLM_ANALYZE_FIGURES'
      ? checkpoint => persistOriginFigureCheckpoint(message, sender, checkpoint)
      : null;
    const onWorkspaceCommitGuard = new Set([
      'ARTICLE_WORKSPACE_SAVE_ASSET',
      'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET',
      'ARTICLE_WORKSPACE_FIGURE_SAVE_STATUS',
      'ARTICLE_WORKSPACE_FINALIZE_STAGED_ASSET',
      'ARTICLE_WORKSPACE_ABORT_STAGED_ASSET',
      'ARTICLE_WORKSPACE_COMPENSATE_STAGED_ASSET'
    ]).has(message?.type) && message?.commitGuardKind === 'figure_retry'
      ? binding => persistOriginWorkspaceCommitGuard(message, sender, binding)
      : null;
    SciLLM.keepAliveUntil(
      handleRoutedMessage(
        message, sender, onProgress, reverseState, onFigureCheckpoint,
        onWorkspaceCommitGuard
      ),
      chrome
    ).then(sendResponse);
    return true;
  }

  return false;
});

// RADAR-001: rebuild alarms on worker activation and resume due literature checks.
BrevessRadar.installRadarBackground({ keepAlive: task => SciLLM.keepAliveUntil(task, chrome) });
