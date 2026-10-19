const MISSING_RECEIVER =
  'Could not establish connection. Receiving end does not exist.';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function hashlessUrl(value) {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    return url.href;
  } catch {
    return String(value || '').replace(/#.*/, '');
  }
}

function createTabMessengerNavigationHarness({ tabId = 1, url, revision, receiver = true } = {}) {
  const calls = [];
  let nextDocumentIdentity = 1;
  let current = {
    url: hashlessUrl(url || 'https://publisher.example/article'),
    status: 'complete',
    revision: revision || '',
    receiver,
    navigationIdentity: hashlessUrl(url || 'https://publisher.example/article'),
    documentIdentity: `document-${nextDocumentIdentity}`,
    dataset: {}
  };
  let beforeCss = null;
  let beforeFiles = null;
  let afterFiles = null;
  let beforeBusinessMessage = null;
  let businessMessage = null;
  let afterReload = null;

  function withCurrentPage(callback) {
    const previousDocument = global.document;
    const previousLocation = global.location;
    global.document = { documentElement: { dataset: current.dataset } };
    global.location = { href: current.url };
    try {
      return callback();
    } finally {
      if (previousDocument === undefined) delete global.document;
      else global.document = previousDocument;
      if (previousLocation === undefined) delete global.location;
      else global.location = previousLocation;
    }
  }

  const chromeApi = {
    tabs: {
      async get(requestedTabId) {
        if (requestedTabId !== tabId || current.removed) {
          throw new Error('No tab with id');
        }
        return { id: tabId, url: current.url, status: current.status };
      },
      async sendMessage(requestedTabId, message) {
        calls.push({ type: 'sendMessage', message });
        if (requestedTabId !== tabId || current.removed || !current.receiver) {
          throw new Error(MISSING_RECEIVER);
        }
        if (message.action === 'getContentScriptRevision') {
          return {
            contentRevision: current.revision,
            navigationIdentity: current.navigationIdentity,
            documentIdentity: current.documentIdentity
          };
        }
        if (typeof beforeBusinessMessage === 'function') {
          await beforeBusinessMessage(message);
        }
        if (message.expectedNavigationIdentity &&
            message.expectedNavigationIdentity !== current.navigationIdentity) {
          return {
            success: false,
            error: { code: 'TAB_MESSAGE_NAVIGATION_STALE' }
          };
        }
        if (message.expectedDocumentIdentity &&
            message.expectedDocumentIdentity !== current.documentIdentity) {
          return {
            success: false,
            error: { code: 'TAB_MESSAGE_NAVIGATION_STALE' }
          };
        }
        if (typeof businessMessage === 'function') await businessMessage(message);
        return { success: true, action: message.action };
      },
      async reload(requestedTabId) {
        calls.push({ type: 'reload', tabId: requestedTabId });
        if (requestedTabId !== tabId || current.removed) throw new Error('No tab with id');
        current.status = 'loading';
        if (typeof afterReload === 'function') await afterReload();
        current.status = 'complete';
      }
    },
    scripting: {
      async insertCSS(details) {
        calls.push({ type: 'insertCSS', details });
        if (typeof beforeCss === 'function') await beforeCss();
      },
      async executeScript(details) {
        if (details.files) {
          calls.push({ type: 'files', details });
          if (typeof beforeFiles === 'function') await beforeFiles();
          if (current.removed) throw new Error('No tab with id');
          current.receiver = true;
          current.revision = revision || '';
          current.navigationIdentity = hashlessUrl(current.url);
          if (typeof afterFiles === 'function') await afterFiles();
          return [];
        }
        calls.push({ type: 'pageFunction', details });
        return [{ result: withCurrentPage(() => details.func(...(details.args || []))) }];
      }
    }
  };

  return {
    chromeApi,
    calls,
    current: () => current,
    onBeforeCss(callback) { beforeCss = callback; },
    onBeforeFiles(callback) { beforeFiles = callback; },
    onAfterFiles(callback) { afterFiles = callback; },
    onBeforeBusinessMessage(callback) { beforeBusinessMessage = callback; },
    onBusinessMessage(callback) { businessMessage = callback; },
    onAfterReload(callback) { afterReload = callback; },
    navigate(nextUrl, options = {}) {
      nextDocumentIdentity += 1;
      current = {
        url: hashlessUrl(nextUrl),
        status: options.status || 'complete',
        revision: options.revision === undefined ? current.revision : options.revision,
        receiver: options.receiver === undefined ? current.receiver : options.receiver,
        navigationIdentity: Object.prototype.hasOwnProperty.call(
          options, 'navigationIdentity'
        ) ? options.navigationIdentity : hashlessUrl(nextUrl),
        documentIdentity: Object.prototype.hasOwnProperty.call(
          options, 'documentIdentity'
        ) ? options.documentIdentity : `document-${nextDocumentIdentity}`,
        dataset: options.dataset || {}
      };
    },
    remove() {
      current.removed = true;
    },
    reuse(nextUrl, options = {}) {
      this.navigate(nextUrl, { ...options, receiver: options.receiver === true });
    }
  };
}

function listenerRegistry() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    emit(...args) { return Promise.all(listeners.map(listener => listener(...args))); }
  };
}

function createBackgroundNavigationHarness({
  isTabActivated = async () => true,
  sendTabMessageWithRecovery = async () => undefined,
  ensureContentScriptForActivation = async () => undefined,
  markTabActivated = async tab => ({ tabId: tab?.id }),
  tabs = []
} = {}) {
  const events = {
    updated: listenerRegistry(),
    removed: listenerRegistry(),
    activated: listenerRegistry(),
    installed: listenerRegistry(),
    startup: listenerRegistry(),
    runtimeMessage: listenerRegistry(),
    storageChanged: listenerRegistry(),
    panelOpened: listenerRegistry(),
    panelClosed: listenerRegistry()
  };
  const calls = [];
  const tabsById = new Map(tabs.map(tab => [tab.id, { ...tab }]));
  const storageArea = {
    async get() { return {}; },
    async set() {},
    async remove() {}
  };
  const inertFactory = () => new Proxy({}, {
    get(_target, property) {
      if (property === Symbol.toStringTag) return 'InertFactory';
      return () => Promise.resolve({});
    }
  });
  const SciLLM = new Proxy({
    createOnboardingController: () => ({ get: async () => ({}) }),
    createSemanticFindLauncher: require('../../core/semantic-find-launcher.js').createSemanticFindLauncher,
    createSemanticFindService: () => ({
      handles: () => false,
      commitTrustedDocument: async () => ({}),
      retireTrustedTab: async () => ({})
    }),
    isTabActivated,
    sendTabMessageWithRecovery: async (...args) => {
      calls.push({ type: 'recoveryMessage', args });
      return sendTabMessageWithRecovery(...args);
    },
    forgetContentScriptState(tabId) {
      calls.push({ type: 'forget', tabId });
    },
    clearTabActivation: async tabId => {
      calls.push({ type: 'clearActivation', tabId });
    },
    ensureContentScriptForActivation: async (...args) => {
      calls.push({ type: 'activationEnsure', args });
      return ensureContentScriptForActivation(...args);
    },
    markTabActivated: async (...args) => {
      calls.push({ type: 'markActivation', args });
      return markTabActivated(...args);
    },
    isLikelyPdfUrl: () => false,
    isPdfReaderUrl: () => false,
    normalizeTabDocumentUrl: hashlessUrl,
    LLM_TASK_IDS: []
  }, {
    get(target, property) {
      if (property in target) return target[property];
      if (String(property).startsWith('create')) return inertFactory;
      return () => Promise.resolve({});
    }
  });
  const chrome = {
    storage: {
      local: storageArea,
      session: storageArea,
      onChanged: events.storageChanged
    },
    tabs: {
      onUpdated: events.updated,
      onRemoved: events.removed,
      onActivated: events.activated,
      async query() { return []; },
      async get(tabId) {
        return tabsById.get(tabId) || { id: tabId, windowId: 1, url: '' };
      },
      async sendMessage(...args) {
        calls.push({ type: 'tabMessage', args });
        return {};
      },
      async create() { return {}; },
      async update() { return {}; }
    },
    sidePanel: {
      onOpened: events.panelOpened,
      onClosed: events.panelClosed,
      async setOptions(...args) { calls.push({ type: 'sidePanelOptions', args }); },
      async setPanelBehavior() {},
      async getOptions() { return {}; },
      async open(...args) { calls.push({ type: 'sidePanelOpen', args }); }
    },
    runtime: {
      id: 'brevess-test',
      onInstalled: events.installed,
      onStartup: events.startup,
      onMessage: events.runtimeMessage,
      getURL: value => `chrome-extension://brevess-test/${value || ''}`,
      getManifest: () => ({ version: '1.0.1' }),
      async sendMessage(...args) {
        calls.push({ type: 'runtimeMessage', args });
        return {};
      }
    },
    scripting: { async executeScript() { return []; } },
    windows: { async update() {} }
  };
  const context = {
    chrome,
    SciLLM,
    // Alarm scheduling is outside this navigation/identity harness; its own
    // real-module tests cover registration. Do not start a radar database here.
    BrevessRadar: { installRadarBackground() {} },
    // Sharing transport is exercised separately in the feature bridge suite.
    BrevessSharingBackground: { install() {} },
    URL,
    console: { log() {}, warn() {}, error() {} },
    importScripts() {},
    setTimeout,
    clearTimeout,
    Promise,
    Map,
    Set,
    Date,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    crypto: webcrypto,
    indexedDB: {}
  };
  context.globalThis = context;
  vm.createContext(context);
  const backgroundPath = path.join(__dirname, '..', '..', 'background.js');
  vm.runInContext(fs.readFileSync(backgroundPath, 'utf8'), context, {
    filename: backgroundPath
  });

  return {
    calls,
    emitUpdated: (...args) => events.updated.emit(...args),
    emitRemoved: (...args) => events.removed.emit(...args),
    async emitRuntimeMessage(message, sender = {}) {
      let response;
      await events.runtimeMessage.emit(message, sender, value => { response = value; });
      for (let index = 0; index < 8 && response === undefined; index += 1) {
        await new Promise(resolve => setImmediate(resolve));
      }
      return response;
    },
    flush: () => new Promise(resolve => setImmediate(resolve))
  };
}

module.exports = {
  createBackgroundNavigationHarness,
  createTabMessengerNavigationHarness,
  hashlessUrl
};
