(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const CONTENT_SCRIPT_FILES = [
    'core/category-store.js',
    'core/confidence-policy.js',
    'core/sentence-boundary.js',
    'core/publisher-adapters.js',
    'core/article-structure.js',
    'core/article-extractor.js',
    'core/article-chat-citations.js',
    'core/publisher-diagnostics.js',
    'core/highlight-distribution.js',
    'core/figure-extractor.js',
    'core/figure-viewer.js',
    'core/figure-analysis.js',
    'core/manual-annotations.js',
    'core/cache-planner.js',
    'core/review-outline.js',
    'core/article-workspace.js',
    'core/article-archive.js',
    'content.js'
  ];
  const CONTENT_STYLE_FILES = ['content.css'];
  const recoveryByTab = new Map();

  function isMissingReceiverError(error) {
    const message = String(error?.message || error || '');
    return /Could not establish connection|Receiving end does not exist/i.test(message);
  }

  function ensureContentScript(chromeApi, tabId) {
    const existing = recoveryByTab.get(tabId);
    if (existing) return existing;
    const target = { tabId };
    const recovery = (async () => {
      await chromeApi.scripting.insertCSS({ target, files: CONTENT_STYLE_FILES });
      await chromeApi.scripting.executeScript({ target, files: CONTENT_SCRIPT_FILES });
    })();
    recoveryByTab.set(tabId, recovery);
    recovery.finally(() => {
      if (recoveryByTab.get(tabId) === recovery) recoveryByTab.delete(tabId);
    }).catch(() => undefined);
    return recovery;
  }

  async function sendTabMessageWithRecovery(chromeApi, tabId, message) {
    try {
      return await chromeApi.tabs.sendMessage(tabId, message);
    } catch (error) {
      if (!isMissingReceiverError(error)) throw error;
      await ensureContentScript(chromeApi, tabId);
      return chromeApi.tabs.sendMessage(tabId, message);
    }
  }

  return {
    CONTENT_SCRIPT_FILES,
    CONTENT_STYLE_FILES,
    isMissingReceiverError,
    ensureContentScript,
    sendTabMessageWithRecovery
  };
});
