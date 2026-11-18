(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(globalThis, function () {
  'use strict';
  function createQuickSetupWindow(browser) {
    let opening = null;
    return function open() {
      if (opening) return opening;
      opening = (async () => {
        const url = browser.runtime.getURL('options.html#quick-setup');
        // Query on every open so a restarted service worker also reuses the window.
        const existing = (await browser.tabs.query({})).find(tab => tab.url === url);
        if (existing) {
          await browser.tabs.update(existing.id, { active: true });
          await browser.windows.update(existing.windowId, { focused: true });
          return { opened: true, reused: true };
        }
        const parent = await browser.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
        const width = Math.max(360, Math.min(560, parent?.width || 560));
        const height = Math.max(480, Math.min(790, parent?.height || 790));
        const position = parent && Number.isInteger(parent.left) && Number.isInteger(parent.top)
          ? { left: Math.round(parent.left + ((parent.width || width) - width) / 2), top: Math.round(parent.top + Math.max(0, ((parent.height || height) - height) / 2)) } : {};
        await browser.windows.create({ url, type: 'popup', focused: true, width, height, ...position });
        return { opened: true, reused: false };
      })().finally(() => { opening = null; });
      return opening;
    };
  }
  return { createQuickSetupWindow };
});
