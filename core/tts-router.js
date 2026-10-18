(function attach(root, factory) {
  const shared = typeof module === 'object' && module.exports
    ? require('./tts-service.js') : root.SciLLM;
  const api = factory(shared);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const types = new Set(['TTS_GET_PUBLIC_SETTINGS', 'TTS_GET_SETTINGS', 'TTS_SAVE_SETTINGS',
    'TTS_LIST_VOICES', 'TTS_SYNTHESIZE', 'TTS_CANCEL']);
  const publicCodes = new Set(['TTS_FORBIDDEN', 'TTS_INVALID_REQUEST', 'TTS_AUTOPLAY_DISABLED',
    'TTS_CANCELLED', 'TTS_STALE_DOCUMENT', 'TTS_BUSY', 'TTS_NOT_CONFIGURED', 'TTS_INVALID_ENDPOINT',
    'TTS_INVALID_TEXT', 'TTS_INVALID_VOICE', 'TTS_INVALID_CONFIG', 'TTS_TIMEOUT', 'TTS_NETWORK',
    'TTS_HTTP', 'TTS_REDIRECT', 'TTS_RESPONSE_TYPE', 'TTS_RESPONSE_SIZE', 'TTS_VOICES', 'TTS_COMPATIBILITY', 'TTS_BROWSER_ONLY']);
  const error = code => Object.assign(new Error(code), { code });
  function createTtsRouter({ runtimeExtensionId, loadSettings, saveSettings,
    service = shared.createTtsService() }) {
    const active = new Map();
    const documents = new Map();
    const retiredTabs = new Set();
    let saving = Promise.resolve();
    function owner(sender) {
      if (!runtimeExtensionId || sender?.id !== runtimeExtensionId) throw error('TTS_FORBIDDEN');
      let url;
      try { url = new URL(sender.url); } catch { throw error('TTS_FORBIDDEN'); }
      const ownExtension = url.protocol === 'chrome-extension:' && url.hostname === runtimeExtensionId;
      const options = ownExtension && url.pathname === '/options.html';
      if (typeof sender.documentId !== 'string' || !sender.documentId || sender.documentId.length > 256) {
        throw error('TTS_FORBIDDEN');
      }
      if (options) {
        const tabId = Number.isSafeInteger(sender.tab?.id) && sender.tab.id >= 0 ? sender.tab.id : undefined;
        return { options: true, key: `options:${sender.documentId}`, documentId: sender.documentId, tabId,
          navigationKey: tabId !== undefined && sender.frameId === 0 ? `${tabId}:0` : null };
      }
      if ((!['http:', 'https:', 'file:'].includes(url.protocol) &&
          !(ownExtension && url.pathname === '/pdf-reader.html')) ||
          !Number.isSafeInteger(sender.tab?.id) || sender.tab.id < 0 || sender.frameId !== 0) {
        throw error('TTS_FORBIDDEN');
      }
      const key = `${sender.tab.id}:${sender.frameId}`;
      return { options: false, key, tabId: sender.tab.id, documentId: sender.documentId };
    }
    function assertCurrent(origin) {
      const current = documents.get(origin.navigationKey || origin.key);
      if (retiredTabs.has(origin.tabId) || (current && current !== origin.documentId)) throw error('TTS_STALE_DOCUMENT');
    }
    function stop(entry) {
      entry.controller.abort();
      if (active.get(entry.origin.key) === entry) active.delete(entry.origin.key);
    }
    function check(entry) {
      if (entry.controller.signal.aborted || active.get(entry.origin.key) !== entry) throw error('TTS_CANCELLED');
      assertCurrent(entry.origin);
    }
    function reserve(origin, requestId) {
      assertCurrent(origin);
      const previous = active.get(origin.key);
      if (previous) stop(previous);
      if (active.size >= 8) throw error('TTS_BUSY');
      const entry = { origin, requestId, controller: new AbortController() };
      active.set(origin.key, entry);
      return entry;
    }
    async function dispatch(message, sender) {
      if (!types.has(message?.type)) throw error('TTS_INVALID_REQUEST');
      const origin = owner(sender);
      if (message.type === 'TTS_CANCEL') {
        const entry = active.get(origin.key);
        const cancelled = Boolean(entry && entry.origin.documentId === origin.documentId &&
          entry.requestId === message.requestId);
        if (cancelled) stop(entry);
        return { cancelled };
      }
      assertCurrent(origin);
      if (message.type === 'TTS_GET_PUBLIC_SETTINGS') {
        const settings = await loadSettings();
        assertCurrent(origin);
        return shared.getTtsPublicSettings(settings.tts);
      }
      if (['TTS_GET_SETTINGS', 'TTS_SAVE_SETTINGS', 'TTS_LIST_VOICES'].includes(message.type) && !origin.options) {
        throw error('TTS_FORBIDDEN');
      }
      if (message.type === 'TTS_GET_SETTINGS') return shared.toPublicTtsSettings((await loadSettings()).tts);
      if (message.type === 'TTS_SAVE_SETTINGS') {
        if (!message.settings || typeof message.settings !== 'object' || Array.isArray(message.settings)) {
          throw error('TTS_INVALID_REQUEST');
        }
        const save = saving.catch(() => {}).then(async () => {
          const settings = await loadSettings();
          const tts = shared.mergeTtsSettings(settings.tts, message.settings);
          if (tts.mode === 'browser') {
            // Switching back to free browser speech must not be blocked by an
            // unused old service configuration. Preserve it for later editing.
            shared.validateBrowserTtsSettings(tts);
          } else {
            // Keep the existing address checks when opting into a service.
            for (const mode of ['local', 'online']) {
              if (tts[mode].endpoint) shared.validateTtsEndpoint(tts[mode].endpoint, mode);
            }
          }
          await saveSettings({ ...settings, tts });
          for (const entry of active.values()) stop(entry);
          return shared.toPublicTtsSettings(tts);
        });
        saving = save;
        return save;
      }
      if (message.type === 'TTS_SYNTHESIZE') {
        if (typeof message.requestId !== 'string' || !/^[\w:-]{1,160}$/u.test(message.requestId) ||
            typeof message.text !== 'string' || !message.text.trim() || Array.from(message.text).length > shared.TTS_MAX_TEXT_CHARACTERS ||
            message.userGesture !== true || (message.language != null && !['en', 'zh'].includes(message.language))) {
          throw error('TTS_INVALID_REQUEST');
        }
      }
      const entry = reserve(origin, message.type === 'TTS_LIST_VOICES' ? 'voices' : message.requestId);
      try {
        const settings = shared.normalizeTtsSettings((await loadSettings()).tts);
        check(entry);
        if (settings.mode === 'browser') throw error('TTS_BROWSER_ONLY');
        if (message.type === 'TTS_SYNTHESIZE' && message.automatic === true && !settings.autoPlay) {
          throw error('TTS_AUTOPLAY_DISABLED');
        }
        const result = message.type === 'TTS_LIST_VOICES'
          ? await service.listVoices({ settings, signal: entry.controller.signal })
          : await service.synthesize({ text: message.text, language: message.language },
            { settings, signal: entry.controller.signal });
        check(entry);
        return result;
      } finally {
        if (active.get(origin.key) === entry) active.delete(origin.key);
      }
    }
    return {
      handles: type => types.has(type),
      async handle(message, sender) {
        try { return { success: true, data: await dispatch(message, sender) }; }
        catch (caught) {
          const code = publicCodes.has(caught?.code) ? caught.code : 'TTS_NETWORK';
          // Never return a provider body, URL, or exception message to a reading page.
          const details = {};
          const phases = new Set(['settings', 'discovery', 'synthesis', 'receiving', 'decode-pcm', 'decode-audio', 'playback']);
          if (phases.has(caught?.ttsDetails?.phase)) details.phase = caught.ttsDetails.phase;
          for (const field of ['elapsedMs', 'audioBytes', 'httpStatus']) {
            const value = caught?.ttsDetails?.[field];
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
                (field !== 'httpStatus' || (value >= 100 && value <= 599))) details[field] = value;
          }
          return { success: false, error: { code, message: code, ...(Object.keys(details).length ? { details } : {}) } };
        }
      },
      commitDocument({ tabId, frameId, documentId }) {
        if (!Number.isSafeInteger(tabId) || frameId !== 0 || !documentId) return;
        const key = `${tabId}:${frameId}`;
        retiredTabs.delete(tabId);
        documents.set(key, documentId);
        for (const entry of active.values()) {
          if (entry.origin.tabId === tabId && entry.origin.documentId !== documentId) stop(entry);
        }
      },
      retireTab(tabId) {
        if (!Number.isSafeInteger(tabId) || tabId < 0) return;
        const key = `${tabId}:0`;
        retiredTabs.add(tabId);
        for (const entry of active.values()) if (entry.origin.tabId === tabId) stop(entry);
        documents.delete(key);
      }
    };
  }
  return { createTtsRouter };
});
