(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  // Loads the existing reader only after a deliberate shortcut; never activates
  // a reading workspace or opens the side panel.
  function createSemanticFindLauncher({ chromeApi, getShortcutKey, ensureContent }) {
    const types = new Set(['SEMANTIC_FIND_GET_SHORTCUT', 'SEMANTIC_FIND_OPEN']);
    async function handle(message, sender) {
      try {
        if (!types.has(message?.type) || sender?.id !== chromeApi.runtime.id ||
            sender.frameId !== 0 || !Number.isSafeInteger(sender.tab?.id) ||
            !sender.documentId || !/^(https?:|file:)\/\//i.test(sender.url || '')) {
          throw new Error('SEMANTIC_FIND_OWNER_UNAVAILABLE');
        }
        if (message.type === 'SEMANTIC_FIND_GET_SHORTCUT') {
          return { success: true, key: await getShortcutKey() };
        }
        const tabId = sender.tab.id;
        const assertDocument = async () => {
          const frame = await chromeApi.webNavigation.getFrame({ tabId, frameId: 0 });
          if (!frame || frame.documentId !== sender.documentId ||
              frame.documentLifecycle !== 'active') {
            throw new Error('TAB_MESSAGE_NAVIGATION_STALE');
          }
          return frame;
        };
        const frame = await assertDocument();
        await ensureContent(tabId, { expectedUrl: frame.url, deferArticlePreindex: true,
          contextKey: 'semantic-find:' + sender.documentId });
        await assertDocument();
        const response = await chromeApi.tabs.sendMessage(tabId,
          { action: 'openSemanticFind' }, { documentId: sender.documentId });
        if (response?.success !== true) throw new Error('SEMANTIC_FIND_OPEN_FAILED');
        return { success: true };
      } catch (error) {
        return { success: false, error: { code: String(error?.code || error?.message || 'SEMANTIC_FIND_OPEN_FAILED') } };
      }
    }
    return { handles: type => types.has(type), handle };
  }
  return { createSemanticFindLauncher };
});
