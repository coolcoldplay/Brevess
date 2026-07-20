const OFFICIAL_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/responses',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  deepseek: 'https://api.deepseek.com/chat/completions'
};

let state = null;
let selectedProfileId = '';
let profileEditorDirty = false;
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
  directoryHandle: null,
  handleLoaded: false
};
let pendingMigrationBundle = null;
const USER_DATA_ACTION_IDS = [
  'chooseUserDataDirectory', 'reauthorizeUserDataDirectory',
  'syncUserDataNow', 'rebuildUserDataIndex', 'exportUserDataBundle',
  'exportMigrationBundle'
];

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  await refreshSettings();
  await loadCategoryFromHash();
  await refreshCorpusStatus();
  updateDirectoryFeatureSupport();
  await preloadUserDataDirectoryHandle();
  await refreshUserDataStatus();
});

function bindEvents() {
  document.getElementById('providerId').addEventListener('change', renderProvider);
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
    'manualMaxTokens'].forEach(id => {
      document.getElementById(id).addEventListener('input', markProfileEditorDirty);
      document.getElementById(id).addEventListener('change', markProfileEditorDirty);
    });
  document.getElementById('compatiblePreset').addEventListener('change', applyCompatiblePreset);
  document.getElementById('compatiblePreset').addEventListener('change', markProfileEditorDirty);
  ['baseUrl', 'authHeader', 'authPrefix'].forEach(id => {
    document.getElementById(id).addEventListener('input', markCompatiblePresetCustom);
  });
  ['jsonMode', 'supportsVision'].forEach(id => {
    document.getElementById(id).addEventListener('change', markCompatiblePresetCustom);
  });
  document.getElementById('saveSettings').addEventListener('click', () => persistForm(false));
  document.getElementById('resetPanelFollowupPrompts').addEventListener('click', () => {
    renderPanelFollowupPrompts(state?.panelFollowupDefaults || {});
    markProfileEditorDirty();
  });
  document.getElementById('testProvider').addEventListener('click', testProvider);
  ['globalProfileId', 'routeHighlight', 'routeSummary', 'routeFigure', 'routeCrossFigure']
    .forEach(id => document.getElementById(id).addEventListener('change', renderFigureRouteWarning));
  ['analysisMode', 'autoAnalyze', 'consentGranted', 'globalProfileId', 'routeHighlight',
    'routeSummary', 'routeFigure', 'routeCrossFigure'].forEach(id => {
      document.getElementById(id).addEventListener('change', markProfileEditorDirty);
    });
  ['panelPromptGrouping', 'panelPromptTechnique', 'panelPromptAxes', 'panelPromptSamples']
    .forEach(id => document.getElementById(id).addEventListener('input', markProfileEditorDirty));
  document.getElementById('exportCorpusJsonl').addEventListener('click', () => exportCorpus('jsonl'));
  document.getElementById('exportCorpusCsv').addEventListener('click', () => exportCorpus('csv'));
  document.getElementById('distillRules').addEventListener('click', distillRules);
  document.getElementById('saveCustomCategory').addEventListener('click', saveCustomCategory);
  document.getElementById('chooseUserDataDirectory').addEventListener('click', chooseUserDataDirectory);
  document.getElementById('reauthorizeUserDataDirectory').addEventListener('click', reauthorizeUserDataDirectory);
  document.getElementById('syncUserDataNow').addEventListener('click', syncUserDataNow);
  document.getElementById('rebuildUserDataIndex').addEventListener('click', openRebuildUserDataDialog);
  document.getElementById('exportUserDataBundle').addEventListener('click', exportUserDataBundle);
  document.getElementById('exportMigrationBundle').addEventListener('click', exportMigrationBundle);
  document.getElementById('importMigrationBundle').addEventListener('change', importMigrationBundle);
  document.getElementById('confirmMigrationImport').addEventListener('click', confirmMigrationImport);
  document.getElementById('confirmRebuildUserDataIndex').addEventListener('click', confirmRebuildUserDataIndex);
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
}

async function callBackground(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.success) {
    const error = new Error(response?.error?.message || '操作失败');
    error.code = response?.error?.code;
    error.fields = response?.error?.fields || [];
    throw error;
  }
  return response.data;
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

function updateUserDataActionButtons() {
  const current = userDataUi.lastStatus || {};
  const configured = Boolean(current.directoryName);
  const permission = current.permission || 'unconfigured';
  const pickerSupported = typeof window.showDirectoryPicker === 'function';
  const pending = userDataUi.pendingAction;
  document.getElementById('chooseUserDataDirectory').disabled = pending || !pickerSupported;
  document.getElementById('reauthorizeUserDataDirectory').disabled =
    pending || !configured || !userDataUi.directoryHandle || permission === 'granted';
  document.getElementById('syncUserDataNow').disabled =
    pending || !configured || permission !== 'granted';
  document.getElementById('rebuildUserDataIndex').disabled =
    pending || !configured || permission !== 'granted';
  document.getElementById('exportUserDataBundle').disabled = pending;
}

function setUserDataActionPending(pending) {
  userDataUi.pendingAction = Boolean(pending);
  USER_DATA_ACTION_IDS.forEach(id => {
    document.getElementById(id).setAttribute('aria-busy', String(userDataUi.pendingAction));
  });
  updateUserDataActionButtons();
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
  renderDirectorySupportMessage();
  updateUserDataActionButtons();
}

async function refreshUserDataStatus() {
  const requestToken = startUserDataStatusRequest();
  try {
    const status = await callBackground({ type: 'USER_DATA_SYNC_STATUS' });
    if (!isCurrentUserDataStatus(requestToken)) return;
    renderUserDataStatus(status);
    if (status.lastError) showUserDataStatus(`上次同步未完成：${status.lastError}`, 'error');
  } catch (error) {
    if (!isCurrentUserDataStatus(requestToken)) return;
    showUserDataStatus(`读取本地数据状态失败：${friendlyError(error)}`, 'error');
  }
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
    await callBackground({ type: 'USER_DATA_SYNC_NOW' });
    await refreshUserDataStatus();
    showUserDataStatus('目录已保存，本地数据同步完成。', 'success');
  } catch (error) {
    if (error?.name === 'AbortError') {
      showUserDataStatus('已取消选择，现有目录设置没有改变。', 'info');
    } else {
      showUserDataStatus(`选择目录失败：${friendlyError(error)}`, 'error');
    }
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
    await callBackground({ type: 'USER_DATA_SYNC_NOW' });
    await refreshUserDataStatus();
    showUserDataStatus('目录权限已恢复并完成同步。', 'success');
  } catch (error) {
    showUserDataStatus(`重新授权失败：${friendlyError(error)}`, 'error');
  } finally {
    setUserDataActionPending(false);
  }
}

async function syncUserDataNow() {
  if (userDataUi.pendingAction) return;
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
      '迁移文件中的 API Key 会写入本机扩展存储；本地目录需稍后重新选择。';
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
    showMigrationStatus(
      `迁移完成：恢复 ${result.importedDocuments || 0} 篇文献记录和 ` +
      `${result.importedFeedback || 0} 条反馈。请重新选择本地保存目录。`,
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
  return `#category=${encodeURIComponent(categoryId)}`;
}

function replaceHash(hash) {
  const nextUrl = `${location.pathname}${location.search}${hash || ''}`;
  history.replaceState(null, '', nextUrl);
}

function commitCategoryHash(categoryId) {
  categoryEditor.acceptedHash = categoryHash(categoryId);
  if (location.hash !== categoryEditor.acceptedHash) {
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
      expressions: linesFrom('categoryRegexExpressions'),
      caseSensitive: checked('categoryRegexCaseSensitive'),
      wholeWord: checked('categoryRegexWholeWord')
    }
  };
}

function setCategoryPending(pending) {
  categoryEditor.pending = pending;
  document.querySelectorAll('.category-list-item')
    .forEach(button => { button.disabled = pending; });
  ['saveCategoryOverride', 'resetCategoryOverride', 'testCategoryRegex']
    .forEach(id => {
      const button = document.getElementById(id);
      button.disabled = pending || (id === 'resetCategoryOverride' &&
        categoryEditor.detail?.metadata?.builtIn === false);
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
  URL.revokeObjectURL(objectUrl);
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

function renderCompatiblePresetHint(preset) {
  const hint = document.getElementById('compatiblePresetHint');
  hint.textContent = preset?.description ||
    '选择后自动填入官方接口与默认模型；API Key 不会被修改。';
}

function applyCompatiblePreset() {
  const preset = compatiblePresetFor(document.getElementById('compatiblePreset').value);
  if (!preset) return;
  document.getElementById('model').value = preset.defaultModel || '';
  document.getElementById('baseUrl').value = preset.baseUrl || '';
  document.getElementById('authHeader').value = preset.authHeader || 'Authorization';
  document.getElementById('authPrefix').value = preset.authPrefix ?? 'Bearer';
  document.getElementById('jsonMode').checked = preset.jsonMode !== false;
  document.getElementById('supportsVision').checked = preset.supportsVision === true;
  markProfileEditorDirty();
  renderCompatiblePresetHint(preset);
  renderFigureRouteWarning();
}

function markCompatiblePresetCustom() {
  if (document.getElementById('providerId').value !== 'openai-compatible') return;
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
    remove.addEventListener('click', () => deleteCustomCategory(category.categoryId));
    row.append(swatch, text, remove);
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

async function deleteCustomCategory(categoryId) {
  try {
    applyState(await callBackground({ type: 'LLM_DELETE_CUSTOM_CATEGORY', categoryId }));
    showStatus('自定义识别类别已删除。', 'success');
  } catch (error) {
    showStatus(`删除类别失败：${friendlyError(error)}`, 'error');
  }
}

function endpointFor(providerId, config) {
  return providerId === 'openai-compatible' ? config.baseUrl : OFFICIAL_ENDPOINTS[providerId];
}

async function requestEndpointPermission(providerId, config) {
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
  document.getElementById('autoAnalyze').checked = state.settings?.autoAnalyze === true;
  document.getElementById('consentGranted').checked = state.settings?.consentGranted === true;
  renderPanelFollowupPrompts(state.settings?.figurePanelFollowupPrompts || {});
  document.getElementById('effectiveMode').textContent =
    state.effectiveMode === 'llm' ? '当前：LLM 模式' : '当前：正则模式';
  renderProfileEditor();
  renderRouteOptions();
  renderCustomCategories();
  renderCategoryList();
}

function renderPanelFollowupPrompts(prompts) {
  const defaults = state?.panelFollowupDefaults || {};
  const entries = [
    ['panelPromptGrouping', 'grouping'],
    ['panelPromptTechnique', 'technique_principle'],
    ['panelPromptAxes', 'axes_reading'],
    ['panelPromptSamples', 'sample_information']
  ];
  entries.forEach(([elementId, topic]) => {
    const element = document.getElementById(elementId);
    if (element) element.value = prompts?.[topic] || defaults[topic] || '';
  });
}

function collectPanelFollowupPrompts() {
  return {
    grouping: document.getElementById('panelPromptGrouping').value.trim(),
    technique_principle: document.getElementById('panelPromptTechnique').value.trim(),
    axes_reading: document.getElementById('panelPromptAxes').value.trim(),
    sample_information: document.getElementById('panelPromptSamples').value.trim()
  };
}

function renderCompatiblePresetOptions() {
  const select = document.getElementById('compatiblePreset');
  if (!select) return;
  const config = profileById(selectedProfileId)?.config || {};
  const presets = compatiblePresets();
  select.replaceChildren();
  presets.forEach(preset => {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    select.appendChild(option);
  });
  const selectedId = compatiblePresetFor(config.presetId) ? config.presetId : 'custom';
  select.value = selectedId;
  if (!select.value && select.options.length) select.selectedIndex = 0;
}

function renderProvider() {
  const providerId = document.getElementById('providerId').value;
  const compatible = providerId === 'openai-compatible';
  document.getElementById('compatibleFields').hidden = !compatible;
  if (compatible) {
    const profile = profileById(selectedProfileId);
    const config = { ...(profile?.config || {}) };
    config.supportsVision = providerVisionCapability(providerId, config);
    document.getElementById('supportsVision').checked = config.supportsVision === true;
    renderCompatiblePresetOptions();
    renderCompatiblePresetHint(compatiblePresetFor(document.getElementById('compatiblePreset').value));
  }
  renderFigureRouteWarning();
}

function friendlyError(error) {
  const messages = {
    AUTH_INVALID: 'API Key 无效或无权限',
    RATE_LIMITED: '请求过于频繁，请稍后重试',
    QUOTA_EXHAUSTED: 'API 额度不足',
    NETWORK_ERROR: '无法访问服务商，请检查域名权限和网络',
    INVALID_RESPONSE: '服务商返回了无法识别的格式',
    INVALID_SETTINGS: `内容不完整或规则不安全：${(error.fields || []).join('、')}`
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

function markProfileEditorDirty() {
  profileEditorDirty = true;
}

function canLeaveProfileEditor(action = 'switch') {
  if (!profileEditorDirty) return true;
  const message = '当前 Profile 有未保存修改，是否放弃并继续？';
  const canConfirm = typeof window !== 'undefined' && typeof window.confirm === 'function';
  if (canConfirm && window.confirm(message)) {
    profileEditorDirty = false;
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
  return `${profile?.name || '未命名'} · ${model || '未填写模型'} · ${vision ? '视觉' : '仅文本'}`;
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
  Object.entries(state.providers).forEach(([providerId, definition]) => {
    const option = document.createElement('option');
    option.value = providerId;
    option.textContent = definition.label;
    select.appendChild(option);
  });
  if (current && state.providers[current]) select.value = current;
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
  document.getElementById('providerId').value = profile?.providerId || entries[0][1]?.providerId || '';
  document.getElementById('model').value = config.model ||
    state.providers?.[profile?.providerId]?.defaultModel || '';
  const apiKey = document.getElementById('apiKey');
  apiKey.value = '';
  apiKey.placeholder = config.hasApiKey
    ? `已保存 ${config.apiKeyMask}；留空保持不变` : '粘贴 API Key';
  document.getElementById('credentialState').textContent = config.hasApiKey
    ? 'Key 已保存' : '尚未配置';
  const compatible = profile?.providerId === 'openai-compatible';
  document.getElementById('compatibleFields').hidden = !compatible;
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
  const tokenPolicy = profile?.tokenPolicy || {};
  document.getElementById('tokenModeAuto').checked = tokenPolicy.mode !== 'manual';
  document.getElementById('tokenModeManual').checked = tokenPolicy.mode === 'manual';
  document.getElementById('autoTokenCap').value = tokenPolicy.autoCap ?? '';
  document.getElementById('manualMaxTokens').value = tokenPolicy.manualMax || 4096;
  renderTokenPolicyFields();
  renderProfileList();
  renderFigureRouteWarning();
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
    const providerId = document.getElementById('providerId')?.value || profile?.providerId;
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
  const providerId = document.getElementById('providerId').value;
  const config = { ...(current.config || {}) };
  delete config.apiKey;
  delete config.hasApiKey;
  delete config.apiKeyMask;
  delete config.customHeaderNames;
  config.model = document.getElementById('model').value.trim();
  const enteredKey = document.getElementById('apiKey').value.trim();
  if (enteredKey) config.apiKey = enteredKey;
  if (providerId === 'openai-compatible') {
    config.presetId = document.getElementById('compatiblePreset').value || 'custom';
    config.baseUrl = document.getElementById('baseUrl').value.trim();
    config.authHeader = document.getElementById('authHeader').value.trim() || 'Authorization';
    config.authPrefix = document.getElementById('authPrefix').value.trim();
    config.jsonMode = document.getElementById('jsonMode').checked;
    config.supportsVision = document.getElementById('supportsVision').checked;
  } else {
    delete config.supportsVision;
  }
  const manual = document.getElementById('tokenModeManual').checked;
  const autoCapValue = document.getElementById('autoTokenCap').value;
  const manualValue = Number(document.getElementById('manualMaxTokens').value) || 4096;
  return {
    id: selectedProfileId,
    name: document.getElementById('profileName').value.trim(),
    providerId,
    config,
    capabilities: { vision: providerVisionCapability(providerId, config) },
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
    profileEditorDirty = false;
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
    profileEditorDirty = false;
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
    profileEditorDirty = false;
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
  buttons.forEach(button => { button.disabled = true; });
  try {
    const profile = collectProfile();
    const previous = profileById(profile.id);
    const firstConfiguration = !previous?.config?.hasApiKey && Boolean(profile.config.apiKey);
    const consentGranted = document.getElementById('consentGranted').checked;
    const preferredMode = firstConfiguration && consentGranted
      ? 'llm' : document.getElementById('analysisMode').value;
    const globalProfileId = document.getElementById('globalProfileId').value;
    const taskRoutes = collectTaskRoutes();
    const figurePanelFollowupPrompts = collectPanelFollowupPrompts();
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
      preferences: {
        mode: preferredMode,
        autoAnalyze: document.getElementById('autoAnalyze').checked,
        consentGranted,
        figurePanelFollowupPrompts
      }
    });
    applyState(updated);
    profileEditorDirty = false;
    if (!silent) showStatus('模型与路由设置已保存。', 'success');
    return { profileId: selectedProfileId };
  } catch (error) {
    showStatus(`保存失败：${friendlyError(error)}`, 'error');
    throw error;
  } finally {
    endProfileAction('save');
    buttons.forEach(button => { button.disabled = false; });
    updateUserDataActionButtons();
  }
}

async function testProvider() {
  if (!beginProfileAction('test')) return;
  showStatus('正在使用合成文本测试连接。', 'info');
  try {
    const saved = await persistForm(true);
    if (!saved) return;
    const { profileId } = saved;
    const result = await callBackground({ type: 'LLM_TEST_PROFILE', profileId });
    showStatus(`连接成功：${result.providerId} / ${result.model}`, 'success');
  } catch (error) {
    showStatus(`连接失败：${friendlyError(error)}`, 'error');
  } finally {
    endProfileAction('test');
  }
}
