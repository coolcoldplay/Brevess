(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const TAB_ACTIVATION_PREFIX = 'sciPanelTabActivation:';
  const MAX_ACTIVATED_DOCUMENTS_PER_TAB = 20;

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
      activatedAt: Date.now(),
      documents: []
    };
  }

  function normalizeActivatedDocuments(record = {}) {
    const legacy = record?.url ? [{
      url: record.url,
      title: record.title,
      activatedAt: record.activatedAt
    }] : [];
    const candidates = Array.isArray(record?.documents) ? record.documents : legacy;
    const seen = new Set();
    return candidates.map(item => ({
      url: normalizeTabDocumentUrl(item?.url),
      title: String(item?.title || '').slice(0, 500),
      activatedAt: Math.max(0, Number(item?.activatedAt) || 0)
    })).filter(item => item.url && !seen.has(item.url) && seen.add(item.url))
      .slice(0, MAX_ACTIVATED_DOCUMENTS_PER_TAB);
  }

  async function markTabActivated(storageArea, tab) {
    const record = createTabActivation(tab);
    const previous = await readTabActivation(storageArea, record.tabId);
    const documents = normalizeActivatedDocuments(previous)
      .filter(item => item.url !== record.url);
    record.documents = [{
      url: record.url,
      title: record.title,
      activatedAt: record.activatedAt
    }, ...documents].slice(0, MAX_ACTIVATED_DOCUMENTS_PER_TAB);
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
      normalizeActivatedDocuments(record).some(item => item.url === expectedUrl));
  }

  async function clearTabActivation(storageArea, tabId) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId) || numericTabId < 0) return false;
    await storageArea.remove(tabActivationStorageKey(numericTabId));
    return true;
  }

  return {
    TAB_ACTIVATION_PREFIX,
    MAX_ACTIVATED_DOCUMENTS_PER_TAB,
    normalizeTabDocumentUrl,
    normalizeActivatedDocuments,
    tabActivationStorageKey,
    createTabActivation,
    markTabActivated,
    readTabActivation,
    isTabActivated,
    clearTabActivation
  };
});
