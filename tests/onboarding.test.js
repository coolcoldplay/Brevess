const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ONBOARDING_VERSION,
  ONBOARDING_STORAGE_KEY,
  normalizeOnboardingState,
  shouldStartOnboarding,
  startOnboarding,
  setOnboardingStep,
  restartOnboarding,
  createOnboardingController
} = require('../extension/core/onboarding.js');

function memoryStorage(initial = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(key) { return { [key]: structuredClone(values[key]) }; },
    async set(patch) { Object.assign(values, structuredClone(patch)); }
  };
}

test('first use starts once and browser or extension restarts do not acknowledge it', () => {
  const fresh = normalizeOnboardingState();
  assert.equal(fresh.onboardingVersion, ONBOARDING_VERSION);
  assert.equal(fresh.acknowledged, false);
  assert.deepEqual(fresh.steps, { storage: 'pending', api: 'pending' });
  assert.equal(shouldStartOnboarding(fresh), true);

  const started = startOnboarding(fresh, {
    tabId: 42, windowId: 7, url: 'https://example.org/paper'
  }, '2026-07-20T00:00:00.000Z');
  assert.equal(started.sourceTab.tabId, 42);
  assert.equal(started.acknowledged, false);
  assert.equal(shouldStartOnboarding(started), true);
});

test('toolbar setup entry follows real configuration, including first use and removed connections', async () => {
  const fs = require('node:fs'); const vm = require('node:vm');
  const { isConfiguredProfile } = require('../extension/core/settings-store.js');
  const source = fs.readFileSync(require.resolve('../extension/background.js'), 'utf8');
  const start = source.indexOf('async function actionPopupSetupPending()');
  const end = source.indexOf('async function actionPopupPublicState(', start);
  let directory = null, profiles = {};
  const scope = { indexedDB: {}, portableSettingsStorage: {}, SciLLM: {
    async loadDirectoryHandle() { return directory; },
    async loadSettings() { return { profiles }; }, isConfiguredProfile
  } };
  vm.runInNewContext(source.slice(start, end), scope);
  const pending = () => scope.actionPopupSetupPending();
  assert.equal(await pending(), true, 'fresh install is incomplete without opening settings first');
  profiles.api = { providerId: 'openai', config: { model: 'fixture', apiKey: 'fixture-key' } };
  assert.equal(await pending(), true, 'API alone still needs a folder');
  directory = { kind: 'directory', name: 'Research' };
  assert.equal(await pending(), false, 'complete settings hide the entry without a guide flag');
  profiles.api.config.apiKey = '';
  assert.equal(await pending(), true, 'a preset or deleted key is not a connection');
  profiles.agent = { providerId: 'deepseek-harness', config: { model: 'deepseek-flash' } };
  assert.equal(await pending(), false, 'an existing official-account model remains usable');
  delete profiles.agent;
  profiles.api = { providerId: 'openai-compatible', config: { model: 'fixture', apiKey: 'fixture-key' } };
  assert.equal(await pending(), true, 'a custom API without its endpoint is incomplete');
  profiles.api.config.baseUrl = 'https://fixture.example/v1';
  assert.equal(await pending(), false);
  directory = null;
  assert.equal(await pending(), true, 'clearing the saved folder restores the entry');
});

test('storage and API complete or skip independently and acknowledge only at both terminals', () => {
  let state = startOnboarding(null, { tabId: 2, windowId: 1 });
  state = setOnboardingStep(state, 'storage', 'skipped', '2026-07-20T00:01:00.000Z');
  assert.deepEqual(state.steps, { storage: 'skipped', api: 'pending' });
  assert.equal(state.acknowledged, false);
  assert.equal(state.configured.storage, false, 'skipped storage is not configured');

  state = setOnboardingStep(state, 'api', 'completed', '2026-07-20T00:02:00.000Z');
  assert.equal(state.acknowledged, true);
  assert.equal(state.configured.storage, false);
  assert.equal(state.configured.api, true);
  assert.equal(shouldStartOnboarding(state), false);
});

test('reopening onboarding keeps the source identity but resets only guide progress', () => {
  let state = startOnboarding(null, { tabId: 9, windowId: 3, url: 'https://paper.test' });
  state = setOnboardingStep(state, 'storage', 'completed');
  state = setOnboardingStep(state, 'api', 'skipped');
  const restarted = restartOnboarding(state, {}, '2026-07-20T00:03:00.000Z');
  assert.equal(restarted.acknowledged, false);
  assert.deepEqual(restarted.steps, { storage: 'pending', api: 'pending' });
  assert.deepEqual(restarted.sourceTab, state.sourceTab);
});

test('controller serializes concurrent step completion without losing either step', async () => {
  const storage = memoryStorage();
  const controller = createOnboardingController({
    storageArea: storage,
    now: () => '2026-07-20T00:04:00.000Z'
  });
  await controller.begin({ tabId: 5, windowId: 1 });
  const storageStep = controller.setStep('storage', 'completed');
  const apiStep = controller.setStep('api', 'skipped');
  const readQueuedBehindMutations = controller.get();
  await Promise.all([storageStep, apiStep]);
  const saved = await readQueuedBehindMutations;
  assert.deepEqual(saved.steps, { storage: 'completed', api: 'skipped' });
  assert.equal(saved.acknowledged, true);
  assert.deepEqual(storage.values[ONBOARDING_STORAGE_KEY], saved);
});

test('an installation without a source tab never invents tab zero on reread', () => {
  const state = normalizeOnboardingState(startOnboarding(null));
  assert.equal(state.sourceTab.tabId, null);
  assert.equal(state.sourceTab.windowId, null);
});

test('quick setup window deduplicates concurrent opens and survives a worker restart', async () => {
  const { createQuickSetupWindow } = require('../extension/core/onboarding-window.js');
  let tabs = [], created = 0, focused = 0;
  const browser = {
    runtime: { getURL: path => `chrome-extension://test/${path}` },
    tabs: { async query() { return tabs; }, async update() {} },
    windows: {
      async getLastFocused() { return { width: 1000, height: 700, left: 0, top: 20 }; },
      async create(input) {
        created++;
        assert.equal(input.type, 'popup'); assert.equal(input.width, 560); assert.equal(input.height, 700);
        tabs = [{ id: 10, windowId: 7, url: input.url }];
      },
      async update() { focused++; }
    }
  };
  const open = createQuickSetupWindow(browser);
  await Promise.all([open(), open(), open()]);
  assert.equal(created, 1);
  await createQuickSetupWindow(browser)();
  assert.equal(created, 1); assert.equal(focused, 1);
});

test('quick setup and Agent model connections are restricted to the top-level settings page', () => {
  const { assertCredentialMessageOwner } = require('../extension/core/credential-boundary.js');
  const browser = { runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}` } };
  const sender = { id: 'test', frameId: 0, url: 'chrome-extension://test/options.html#quick-setup' };
  for (const type of ['LLM_QUICK_SETUP_SAVE', 'LLM_CONNECT_AGENT']) {
    const message = { type };
    assert.doesNotThrow(() => assertCredentialMessageOwner(message, sender, browser));
    for (const patch of [{ frameId: 1 }, { id: 'other' }, { url: 'https://example.org/options.html' }, { url: 'chrome-extension://test/popup.html' }]) {
      assert.throws(() => assertCredentialMessageOwner(message, { ...sender, ...patch }, browser), /CREDENTIAL_ACCESS_DENIED/);
    }
  }
});

test('quick setup never interrupts install, update or browser upgrade before settings is opened', async () => {
  const fs = require('node:fs'); const vm = require('node:vm'); const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8');
  const start = source.indexOf('chrome.runtime.onInstalled.addListener(');
  const end = source.indexOf('chrome.runtime.onStartup.addListener(', start);
  for (const reason of ['install', 'update', 'chrome_update', undefined]) {
    let listener, openings = 0;
    vm.runInNewContext(source.slice(start, end), {
      chrome: { runtime: { onInstalled: { addListener(fn) { listener = fn; } } }, tabs: { async query() { return [{ id: 10 }]; } } },
      async openOnboardingForTab(tab) { assert.equal(tab.id, 10); openings++; },
      async configureSidePanelAction() {}, async syncActiveTabSidePanels() {}, async repairAllLegacyTabSidePanelOptions() {}, console
    });
    listener({ reason }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(openings, 0, String(reason));
  }
});


test('quick setup prompts once on the first settings visit and remains the first navigation entry', async () => {
  const fs = require('node:fs'); const vm = require('node:vm'); const path = require('node:path');
  for (const state of [{ acknowledged: false, startedAt: '' }, { acknowledged: true, startedAt: '' }, { acknowledged: false, startedAt: '2026-11-17T00:00:00Z' }]) {
    let opens = 0;
    const scope = { location: { hash: '#page=models' }, chrome: { runtime: { async sendMessage(message) {
      if (message.type === 'QUICK_SETUP_OPEN') { opens++; state.startedAt = 'shown'; }
      return { success: true, data: state };
    } } } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/quick-setup.js'), 'utf8'), scope);
    const expected = !state.acknowledged && !state.startedAt ? 1 : 0;
    await scope.BrevessQuickSetup.maybeOpen(); await scope.BrevessQuickSetup.maybeOpen();
    assert.equal(opens, expected);
  }
  const focus = fs.readFileSync(path.join(__dirname, '../extension/settings-focus.js'), 'utf8');
  assert.ok(focus.indexOf("nav.append(quickSetup)") < focus.indexOf('for (const [id, label, name] of navigation)'));
});
