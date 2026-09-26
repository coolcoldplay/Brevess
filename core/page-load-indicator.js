(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const PAGE_LOAD_ICON_PATHS = Object.freeze({ 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' });
  const MESSAGE_TYPE = 'PAGE_LOAD_INDICATOR_STATE';

  async function renderPageLoadBusyIcon(chromeApi) {
    const images = {};
    await Promise.all(Object.entries(PAGE_LOAD_ICON_PATHS).map(async ([sizeText, path]) => {
      const size = Number(sizeText);
      const response = await fetch(chromeApi.runtime.getURL(path));
      if (!response.ok) throw new Error('PAGE_LOAD_ICON_UNAVAILABLE');
      const bitmap = await createImageBitmap(await response.blob());
      try {
        const canvas = new OffscreenCanvas(size, size);
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0, size, size);
        // Keep the original BREVESS artwork; only overlay a small corner dot.
        const radius = size * 0.17;
        const center = size - radius - Math.max(1, size * 0.025);
        context.beginPath(); context.arc(center, center, radius, 0, Math.PI * 2);
        context.fillStyle = '#e53935'; context.fill();
        context.lineWidth = Math.max(1, size / 32);
        context.strokeStyle = '#ffffff'; context.stroke();
        images[size] = context.getImageData(0, 0, size, size);
      } finally { bitmap.close(); }
    }));
    return images;
  }

  function createPageLoadIndicator({ chromeApi, isTabActivated, renderBusyIcon = () => renderPageLoadBusyIcon(chromeApi) }) {
    const states = new Map();
    let busyImages = null;
    let started = false;
    const validId = id => Number.isSafeInteger(id) && id >= 0;
    const urlKey = value => { try { const url = new URL(value); url.hash = ''; return url.href; } catch { return ''; } };
    function stateFor(tabId) {
      if (!states.has(tabId)) states.set(tabId, { tabId, active: false, browserLoading: false, domBusy: false, documentId: '', sequence: 0, epoch: 0, refresh: 0, awaitingCommit: false, desired: false, applied: null, writing: false });
      return states.get(tabId);
    }
    function live(state, epoch = state.epoch) { return states.get(state.tabId) === state && state.epoch === epoch; }
    function paint(state) {
      state.desired = state.active && (state.browserLoading || state.domBusy);
      if (state.writing || state.applied === state.desired || !chromeApi.action?.setIcon) return;
      state.writing = true;
      (async () => {
        while (live(state) && state.applied !== state.desired) {
          const desired = state.desired;
          const imageData = desired ? await (busyImages ||= Promise.resolve().then(renderBusyIcon)) : null;
          if (!live(state)) return;
          if (desired !== state.desired) continue;
          await chromeApi.action.setIcon({ tabId: state.tabId, ...(desired ? { imageData } : { path: PAGE_LOAD_ICON_PATHS }) });
          state.applied = desired;
        }
      })().catch(() => { busyImages = null; }).finally(() => { state.writing = false; });
    }
    async function notifyContent(state) {
      if (!chromeApi.tabs?.sendMessage || !state.documentId || state.awaitingCommit) return;
      try {
        const snapshot = await chromeApi.tabs.sendMessage(state.tabId, { action: 'setPageLoadIndicatorEnabled', enabled: state.active }, { frameId: 0, documentId: state.documentId });
        // The content script publishes its own snapshot with browser-owned sender identity.
        return snapshot;
      } catch { /* Restricted pages and documents without an injected receiver are expected. */ }
    }
    async function reconcile(tabId) {
      if (!validId(tabId)) return false;
      const state = stateFor(tabId), epoch = state.epoch, refresh = ++state.refresh;
      const tab = await chromeApi.tabs.get(tabId).catch(() => null);
      if (!live(state, epoch) || refresh !== state.refresh) return false;
      if (!tab) { states.delete(tabId); return false; }
      const active = await isTabActivated(tab).catch(() => false);
      if (!live(state, epoch) || refresh !== state.refresh) return false;
      state.active = active;
      state.browserLoading = tab.status === 'loading';
      if (!active) { state.domBusy = false; state.sequence = 0; }
      paint(state);
      const frame = await chromeApi.webNavigation?.getFrame?.({ tabId, frameId: 0 }).catch(() => null);
      if (!live(state, epoch) || refresh !== state.refresh) return false;
      if (!state.awaitingCommit && frame?.documentId) {
        if (state.documentId !== frame.documentId) { state.domBusy = false; state.sequence = 0; }
        state.documentId = frame.documentId;
      }
      paint(state);
      await notifyContent(state);
      return active;
    }
    async function handle(message, sender) {
      const denied = { success: true, active: false };
      const tabId = sender?.tab?.id;
      if (message?.type !== MESSAGE_TYPE || sender?.id !== chromeApi.runtime.id || sender?.frameId !== 0 || !validId(tabId) ||
          typeof sender.documentId !== 'string' || !sender.documentId || sender.documentId.length > 256 ||
          !Number.isSafeInteger(message.sequence) || message.sequence < 1 || typeof message.busy !== 'boolean') return denied;
      const state = stateFor(tabId), epoch = state.epoch;
      const tab = await chromeApi.tabs.get(tabId).catch(() => null);
      if (!tab || !urlKey(sender.url) || urlKey(sender.url) !== urlKey(tab.url) || !await isTabActivated(tab).catch(() => false)) return denied;
      const frame = await chromeApi.webNavigation?.getFrame?.({ tabId, frameId: 0 }).catch(() => null);
      if (!live(state, epoch) || state.awaitingCommit || !frame || frame.documentId !== sender.documentId ||
          urlKey(frame.url) !== urlKey(tab.url)) return denied;
      if (state.documentId !== frame.documentId) { state.documentId = frame.documentId; state.sequence = 0; state.domBusy = false; }
      if (message.sequence <= state.sequence) return { success: true, active: true };
      state.sequence = message.sequence;
      state.active = true;
      state.browserLoading = tab.status === 'loading';
      state.domBusy = message.busy;
      paint(state);
      return { success: true, active: true };
    }
    async function start() {
      if (started) return;
      started = true;
      chromeApi.runtime.onMessage.addListener((message, sender, respond) => {
        if (message?.type !== MESSAGE_TYPE) return;
        handle(message, sender).then(respond).catch(() => respond({ success: false, active: false }));
        return true;
      });
      chromeApi.tabs.onUpdated.addListener((tabId, change) => {
        if (!change.status && !change.url) return;
        const state = stateFor(tabId);
        state.epoch++;
        if (change.status === 'loading') {
          state.awaitingCommit = true; state.documentId = ''; state.sequence = 0; state.domBusy = false;
        }
        if (change.status === 'complete') state.awaitingCommit = false;
        reconcile(tabId).catch(() => {});
      });
      chromeApi.webNavigation?.onCommitted?.addListener(details => {
        if (details.frameId !== 0 || !validId(details.tabId)) return;
        const state = stateFor(details.tabId);
        state.epoch++; state.awaitingCommit = false; state.documentId = details.documentId || ''; state.sequence = 0; state.domBusy = false;
        reconcile(details.tabId).catch(() => {});
      });
      chromeApi.tabs.onRemoved.addListener(tabId => states.delete(tabId));
      chromeApi.storage.onChanged.addListener((changes, area) => {
        if (area !== 'session') return;
        for (const key of Object.keys(changes)) {
          if (!key.startsWith('sciPanelTabActivation:')) continue;
          const tabId = Number(key.slice('sciPanelTabActivation:'.length));
          if (!validId(tabId)) continue;
          const state = stateFor(tabId); state.epoch++;
          reconcile(tabId).catch(() => {});
        }
      });
      const tabs = await chromeApi.tabs.query({}).catch(() => []);
      await Promise.all(tabs.map(tab => reconcile(tab.id)));
    }
    return { start, handle, reconcile };
  }
  return { createPageLoadIndicator, renderPageLoadBusyIcon, PAGE_LOAD_ICON_PATHS };
});
