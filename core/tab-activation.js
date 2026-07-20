(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const TAB_ACTIVATION_PREFIX = 'sciPanelTabActivation:';

  function normalizeTabDocumentUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      url.hash = '';
      return url.href;
    } catch {
      return raw.replace(/#.*$/, '');
    }
  }

  function tabActivationStorageKey(tabId) {
    return `${TAB_ACTIVATION_PREFIX}${Number(tabId)}`;
  }

  function createTabActivation(tab = {}) {
    const tabId = Number(tab.id);
    const url = normalizeTabDocumentUrl(tab.url || tab.pendingUrl);
    if (!Number.isInteger(tabId) || tabId < 0 || !url) {
      throw new Error('VALID_TAB_DOCUMENT_REQUIRED');
    }
    return {
      tabId,
      url,
      title: String(tab.title || '').slice(0, 500),
      activatedAt: Date.now()
    };
  }

  async function markTabActivated(storageArea, tab) {
    const record = createTabActivation(tab);
    await storageArea.set({ [tabActivationStorageKey(record.tabId)]: record });
    return record;
  }

  async function readTabActivation(storageArea, tabId) {
    const key = tabActivationStorageKey(tabId);
    const stored = await storageArea.get(key);
    return stored?.[key] || null;
  }

  async function isTabActivated(storageArea, tab) {
    const tabId = Number(tab?.id);
    if (!Number.isInteger(tabId) || tabId < 0) return false;
    const expectedUrl = normalizeTabDocumentUrl(tab?.url || tab?.pendingUrl);
    if (!expectedUrl) return false;
    const record = await readTabActivation(storageArea, tabId);
    return Boolean(record && Number(record.tabId) === tabId &&
      normalizeTabDocumentUrl(record.url) === expectedUrl);
  }

  async function clearTabActivation(storageArea, tabId) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId) || numericTabId < 0) return false;
    await storageArea.remove(tabActivationStorageKey(numericTabId));
    return true;
  }

  return {
    TAB_ACTIVATION_PREFIX,
    normalizeTabDocumentUrl,
    tabActivationStorageKey,
    createTabActivation,
    markTabActivated,
    readTabActivation,
    isTabActivated,
    clearTabActivation
  };
});
