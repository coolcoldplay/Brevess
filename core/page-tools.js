(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const PAGE_TOOLS_STORAGE_KEY = 'sciPageToolsV1';
  const defaults = Object.freeze({ semantic: true, selection: true, pageTranslation: true });
  function normalizePageToolsSettings(value = {}) {
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) =>
      [key, typeof value?.[key] === 'boolean' ? value[key] : fallback]));
  }
  function pageToolsSupportedUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:', 'file:'].includes(url.protocol) &&
        !/\.pdf$/i.test(url.pathname) &&
        !['chromewebstore.google.com', 'microsoftedge.microsoft.com'].includes(url.hostname);
    } catch (_) { return false; }
  }
  const identity = value => { const url = new URL(value); url.hash = ''; return url.href; };
  function createPageToolsService({ chromeApi, getSnapshot, ensureContent, getShortcutKey }) {
    const types = new Set(['PAGE_TOOLS_BOOTSTRAP', 'PAGE_TOOLS_APPLY', 'PAGE_TOOLS_SET', 'PAGE_TOOLS_OPEN_SEARCH', 'PAGE_TOOLS_TRANSLATE']);
    let settingsQueue = Promise.resolve();
    const read = async () => normalizePageToolsSettings((await chromeApi.storage.local.get(PAGE_TOOLS_STORAGE_KEY))[PAGE_TOOLS_STORAGE_KEY]);
    const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
    async function frameFor(tabId, expectedId, expectedUrl) {
      const frame = await chromeApi.webNavigation.getFrame({ tabId, frameId: 0 });
      if (!expectedId || frame?.documentId !== expectedId || frame.documentLifecycle !== 'active' ||
          identity(frame.url) !== identity(expectedUrl)) fail('PAGE_TOOLS_PAGE_CHANGED', '页面已经变化，请重新打开扩展菜单。');
      return frame;
    }
    async function owner(message, sender) {
      if (sender?.id !== chromeApi.runtime.id) fail('PAGE_TOOLS_UNTRUSTED', '无法验证页面工具入口。');
      if (message.type === 'PAGE_TOOLS_BOOTSTRAP') {
        if (sender.frameId !== 0 || !Number.isSafeInteger(sender.tab?.id) || !pageToolsSupportedUrl(sender.url))
          fail('PAGE_TOOLS_UNSUPPORTED', '此页面不支持网页工具。');
        const frame = await frameFor(sender.tab.id, sender.documentId, sender.url);
        return { tabId: sender.tab.id, frame };
      }
      if (String(sender.url || '').split(/[?#]/)[0] !== chromeApi.runtime.getURL('action-popup.html'))
        fail('PAGE_TOOLS_UNTRUSTED', '请从扩展图标菜单操作。');
      const snapshot = getSnapshot(String(message.nonce || ''));
      if (!snapshot || Date.now() - snapshot.createdAt > 60000 || snapshot.tab?.id !== message.tabId)
        fail('PAGE_TOOLS_PAGE_CHANGED', '页面已经变化，请重新打开扩展菜单。');
      const tab = await chromeApi.tabs.get(message.tabId);
      if (!pageToolsSupportedUrl(tab.url) || identity(tab.url) !== identity(snapshot.tab.url))
        fail('PAGE_TOOLS_UNSUPPORTED', '此页面不支持网页工具，请在普通网页中使用。');
      const frame = await frameFor(tab.id, snapshot.documentId, tab.url);
      return { tabId: tab.id, frame };
    }
    async function send(target, message) {
      await frameFor(target.tabId, target.frame.documentId, target.frame.url);
      return chromeApi.tabs.sendMessage(target.tabId, message, { documentId: target.frame.documentId });
    }
    async function ensureReader(target, preferences) {
      await chromeApi.scripting.executeScript({ target: { tabId: target.tabId, documentIds: [target.frame.documentId] },
        func: preferences => { globalThis.__brevessPageToolsPreferences = preferences; }, args: [preferences] });
      await frameFor(target.tabId, target.frame.documentId, target.frame.url);
      await ensureContent(target.tabId, { expectedUrl: target.frame.url, expectedDocumentId: target.frame.documentId,
        deferArticlePreindex: true, contextKey: 'page-tools:' + target.frame.documentId });
      await send(target, { action: 'configurePageTools', preferences });
    }
    async function translationState(target) {
      return send(target, { action: 'BREVESS_TRANSLATION_GET_STATE' }).catch(() => null);
    }
    async function ensureTranslation(target) {
      if ((await translationState(target))?.success) return;
      await chromeApi.scripting.insertCSS({ target: { tabId: target.tabId, documentIds: [target.frame.documentId] }, files: ['bilingual-translation.css'] });
      await chromeApi.scripting.executeScript({ target: { tabId: target.tabId, documentIds: [target.frame.documentId] }, files: [
        'core/translation-source.js', 'core/translation-checkpoint.js', 'core/local-translator.js',
        'core/bilingual-translation-controller.js', 'bilingual-translation-content.js'
      ] });
      await frameFor(target.tabId, target.frame.documentId, target.frame.url);
    }
    async function publicState(tab) {
      const supported = pageToolsSupportedUrl(tab?.url);
      let translation = null;
      if (supported) translation = await chromeApi.tabs.sendMessage(tab.id, { action: 'BREVESS_TRANSLATION_GET_STATE' }).catch(() => null);
      return { supported, preferences: await read(), shortcut: await getShortcutKey(), translation: translation?.state || null };
    }
    async function handle(message, sender) {
      try {
        const target = await owner(message, sender);
        let preferences = await read();
        if (message.type === 'PAGE_TOOLS_SET') {
          if (!Object.hasOwn(defaults, message.tool) || typeof message.enabled !== 'boolean')
            fail('PAGE_TOOLS_INVALID', '无效的页面工具设置。');
          const update = settingsQueue.catch(() => {}).then(async () => {
            await frameFor(target.tabId, target.frame.documentId, target.frame.url);
            const next = { ...await read(), [message.tool]: message.enabled };
            await chromeApi.storage.local.set({ [PAGE_TOOLS_STORAGE_KEY]: next });
            return next;
          });
          settingsQueue = update;
          preferences = await update;
          if (message.tool === 'selection' && message.enabled) await ensureReader(target, preferences);
          else if (message.tool === 'selection' || message.tool === 'semantic')
            await send(target, { action: 'configurePageTools', preferences }).catch(() => {});
          if (message.tool === 'pageTranslation' && !message.enabled)
            await send(target, { action: 'BREVESS_TRANSLATION_SET_ENABLED', enabled: false,
              expectedNavigationIdentity: identity(target.frame.url) }).catch(() => {});
        } else if (message.type === 'PAGE_TOOLS_APPLY') {
          // activeTab also admits ordinary HTTP pages when the user opens the
          // toolbar popup. Restore saved tools without adding broad HTTP hosts.
          await chromeApi.scripting.executeScript({ target: { tabId: target.tabId, documentIds: [target.frame.documentId] },
            files: ['core/page-tools.js', 'semantic-find-launcher.js'] });
          if (preferences.pageTranslation) await ensureTranslation(target);
          if (preferences.selection) await ensureReader(target, preferences);
        } else if (message.type === 'PAGE_TOOLS_BOOTSTRAP') {
          if (preferences.selection) await ensureReader(target, preferences);
        } else if (message.type === 'PAGE_TOOLS_OPEN_SEARCH') {
          if (!preferences.semantic) fail('PAGE_TOOLS_DISABLED', '请先启用语义检索。');
          await ensureReader(target, preferences);
          const response = await send(target, { action: 'openSemanticFind' });
          if (!response?.success) fail('PAGE_TOOLS_OPEN_FAILED', '无法打开语义检索，请刷新后重试。');
        } else if (message.type === 'PAGE_TOOLS_TRANSLATE') {
          if (!preferences.pageTranslation && message.enabled !== false) fail('PAGE_TOOLS_DISABLED', '请先启用整页翻译。');
          await ensureTranslation(target);
          const response = await send(target, { action: 'BREVESS_TRANSLATION_SET_ENABLED', enabled: message.enabled === true,
            wholePage: true, expectedNavigationIdentity: identity(target.frame.url) });
          if (!response?.success) fail('PAGE_TOOLS_TRANSLATION_FAILED', '无法启动翻译，请查看页面提示。');
          return { success: true, data: { preferences, translation: response.state } };
        }
        return { success: true, data: { preferences } };
      } catch (error) {
        return { success: false, error: { code: String(error?.code || 'PAGE_TOOLS_FAILED'), message: String(error?.message || '页面工具暂不可用，请刷新重试。') } };
      }
    }
    return { handles: type => types.has(type), handle, publicState, read };
  }
  return { PAGE_TOOLS_STORAGE_KEY, normalizePageToolsSettings, pageToolsSupportedUrl, createPageToolsService };
});
