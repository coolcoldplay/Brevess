const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const messenger = require('../core/tab-messenger.js');
const {
  createTabMessengerNavigationHarness
} = require('./helpers/tab-messenger-navigation-harness.js');

// Execute the current production sender and its actual recovery implementation.
// Only the browser API boundary is simulated. These are expected-behavior
// regressions, so an obsolete enable reaching the receiver makes the test fail.
const popupSource = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');

function productionFunction(name) {
  let start = popupSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing production function ${name}`);
  if (popupSource.slice(start - 6, start) === 'async ') start -= 6;
  const end = popupSource.indexOf('\n}', start);
  assert.ok(end > start, `missing production function end ${name}`);
  return popupSource.slice(start, end + 2);
}

const senderSource = [
  popupSource.slice(popupSource.indexOf('const sidePanelShortcutPublications = new Map();'),
    popupSource.indexOf('\nfunction capturePanelContext(')),
  productionFunction('sendTabMessage'),
].join('\n\n');
const senderSha256 = createHash('sha256').update(senderSource).digest('hex');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function scopeHarness(tabs) {
  const deliveries = [];
  const scopes = new Map();
  const scopePorts = new Map();
  const browserTabs = new Map(tabs.map(({ id, receiver = true }) => {
    const harness = createTabMessengerNavigationHarness({
      tabId: id,
      url: `https://www.cell.com/cell/fulltext/test-${id}`,
      revision: messenger.CONTENT_SCRIPT_REVISION,
      receiver
    });
    harness.onAfterFiles(() => {
      harness.current().dataset.sciLlmContentRevision = messenger.CONTENT_SCRIPT_REVISION;
    });
    harness.onBusinessMessage(message => {
      if (message.action !== 'setSidePanelShortcutScope') return;
      const enabled = message.enabled === true;
      if (!enabled && message.portScoped === true && scopePorts.has(id)) return;
      scopes.set(id, enabled);
      deliveries.push({ tabId: id, enabled });
    });
    return [id, harness];
  }));
  const tab = id => {
    const harness = browserTabs.get(id);
    assert.ok(harness, `unexpected tab ${id}`);
    return harness;
  };
  const chrome = {
    tabs: {
      get: id => tab(id).chromeApi.tabs.get(id),
      async sendMessage(id, message, ...args) {
        const response = await tab(id).chromeApi.tabs.sendMessage(id, message, ...args);
        return message.action === 'prepareSidePanelShortcutScope' && response?.success
          ? { ...response, documentIdentity: tab(id).current().documentIdentity,
            navigationIdentity: tab(id).current().navigationIdentity } : response;
      },
      connect(id, options) {
        assert.equal(options.name, 'brevess-side-panel-scope-v1');
        assert.equal(options.frameId, 0);
        const messages = new Set(), disconnects = new Set();
        const port = {
          onMessage: { addListener: fn => messages.add(fn), removeListener: fn => messages.delete(fn) },
          onDisconnect: { addListener: fn => disconnects.add(fn), removeListener: fn => disconnects.delete(fn) },
          postMessage(message) {
            const current = tab(id).current();
            const valid = current.receiver && message.expectedDocumentIdentity === current.documentIdentity &&
              message.expectedNavigationIdentity === current.navigationIdentity && message.expectedUrl === current.url;
            if (valid) {
              scopePorts.set(id, port); scopes.set(id, true); deliveries.push({ tabId: id, enabled: true });
            }
            queueMicrotask(() => [...messages].forEach(fn => fn({ success: valid, enabled: valid })));
          },
          disconnect() {
            if (scopePorts.get(id) === port) { scopePorts.delete(id); scopes.set(id, false); }
            [...disconnects].forEach(fn => fn());
          }
        };
        return port;
      },
      reload: id => tab(id).chromeApi.tabs.reload(id)
    },
    scripting: {
      executeScript: details => tab(details.target.tabId)
        .chromeApi.scripting.executeScript(details),
      insertCSS: details => tab(details.target.tabId)
        .chromeApi.scripting.insertCSS(details)
    }
  };
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    chrome,
    SciLLM: messenger,
    currentKeyboardShortcuts: () => ({ figures: 'F' }),
    activePanelTabContext: { tabId: tabs[0].id, activated: true,
      url: `https://www.cell.com/cell/fulltext/test-${tabs[0].id}`, key: `scope-${tabs[0].id}` }
  });
  vm.runInContext(senderSource, context, { filename: 'popup.js:scope-order-production' });
  return {
    deliveries,
    scopes,
    publish: (id, enabled) => context.publishSidePanelShortcutScope(id, enabled),
    activate(id) {
      context.activePanelTabContext = { tabId: id, activated: true,
        url: `https://www.cell.com/cell/fulltext/test-${id}`, key: `scope-${id}` };
    },
    navigate(id, url) {
      tab(id).navigate(url, { receiver: false });
    },
    pauseInjection(id) {
      const entered = deferred();
      const gate = deferred();
      tab(id).onBeforeFiles(async () => {
        entered.resolve();
        await gate.promise;
      });
      return { entered: entered.promise, release: gate.resolve };
    },
    evidence() {
      return { senderSha256, deliveries, finalScopes: Object.fromEntries(scopes) };
    },
    dispose() {
      for (const id of browserTabs.keys()) messenger.forgetContentScriptState(id);
    }
  };
}

test('Cell scope follows normal open, close and reopen when its receiver already exists', async t => {
  const tabId = 87901;
  const harness = scopeHarness([{ id: tabId }]);
  t.after(() => harness.dispose());
  assert.equal(await harness.publish(tabId, true), true);
  assert.equal(harness.scopes.get(tabId), true);
  assert.equal(await harness.publish(tabId, false), true);
  assert.equal(harness.scopes.get(tabId), false);
  assert.equal(await harness.publish(tabId, true), true);
  assert.equal(harness.scopes.get(tabId), true);
});

test('Cell scope remains disabled after close while an earlier enable waits for injection', { timeout: 5000 }, async t => {
  const tabId = 87902;
  const harness = scopeHarness([{ id: tabId, receiver: false }]);
  t.after(() => harness.dispose());
  const injection = harness.pauseInjection(tabId);
  const opening = harness.publish(tabId, true);
  await injection.entered;
  // Matches popup pagehide: closing publishes false without deleting the
  // remembered activation or mutating activePanelTabContext.
  const closeReceipt = await harness.publish(tabId, false);
  injection.release();
  const openReceipt = await opening;
  t.diagnostic(JSON.stringify({ scenario: 'close-during-injection',
    closeReceipt, openReceipt, ...harness.evidence() }));
  assert.notEqual(harness.scopes.get(tabId), true,
    'an obsolete enable must not turn Cell reading layout back on after close');
});

test('Cell A to B to A leaves B disabled when its old enable finishes injection late', { timeout: 5000 }, async t => {
  const a = 87903;
  const b = 87904;
  const harness = scopeHarness([{ id: a }, { id: b, receiver: false }]);
  t.after(() => harness.dispose());
  assert.equal(await harness.publish(a, true), true);

  // These publications use the same order as synchronizeActiveTabContext:
  // replace the active context, disable the old tab, then enable the new one.
  harness.activate(b);
  await harness.publish(a, false);
  const injection = harness.pauseInjection(b);
  const enablingB = harness.publish(b, true);
  await injection.entered;

  harness.activate(a);
  const disablingB = harness.publish(b, false);
  const enablingA = harness.publish(a, true);
  await Promise.all([disablingB, enablingA]);
  injection.release();
  await enablingB;

  t.diagnostic(JSON.stringify({ scenario: 'A-B-A-with-slow-B', ...harness.evidence() }));
  assert.equal(harness.scopes.get(a), true, 'current tab A retains its scope');
  assert.notEqual(harness.scopes.get(b), true,
    'tab B must not regain reading layout after the sidebar has returned to A');
});

test('Cell closing and reopening during the same injection still enables the latest request', { timeout: 5000 }, async t => {
  const tabId = 87905;
  const harness = scopeHarness([{ id: tabId, receiver: false }]);
  t.after(() => harness.dispose());
  const injection = harness.pauseInjection(tabId);
  const oldOpening = harness.publish(tabId, true);
  await injection.entered;
  await harness.publish(tabId, false);
  const newOpening = harness.publish(tabId, true);
  await new Promise(setImmediate);
  injection.release();
  assert.equal(await oldOpening, false);
  assert.equal(await newOpening, true, 'a cancelled shared recovery must not cancel the new enable');
  assert.equal(harness.scopes.get(tabId), true);
});

test('Cell repeated enable publications during injection deliver only the latest request', { timeout: 5000 }, async t => {
  const tabId = 87906;
  const harness = scopeHarness([{ id: tabId, receiver: false }]);
  t.after(() => harness.dispose());
  const injection = harness.pauseInjection(tabId);
  const oldOpening = harness.publish(tabId, true);
  await injection.entered;
  // synchronizeActiveTabContext also republishes for an unchanged tab, so
  // this has no intervening false and retains the same context object.
  const latestOpening = harness.publish(tabId, true);
  await new Promise(setImmediate);
  injection.release();
  assert.equal(await oldOpening, false);
  assert.equal(await latestOpening, true);
  assert.deepEqual(harness.deliveries, [{ tabId, enabled: true }]);
  t.diagnostic(JSON.stringify({ scenario: 'duplicate-enable-during-injection',
    ...harness.evidence() }));
});

test('Cell pending enable cannot activate a different document after navigation during injection', { timeout: 5000 }, async t => {
  const tabId = 87907;
  const harness = scopeHarness([{ id: tabId, receiver: false }]);
  t.after(() => harness.dispose());
  const injection = harness.pauseInjection(tabId);
  const opening = harness.publish(tabId, true);
  await injection.entered;
  // Leave the sidebar's old context unchanged deliberately: the captured URL
  // must reject the new live document before the sidebar catches up.
  harness.navigate(tabId, 'https://www.cell.com/cell/fulltext/another-paper');
  injection.release();
  assert.equal(await opening, false);
  assert.deepEqual(harness.deliveries, []);
  t.diagnostic(JSON.stringify({ scenario: 'navigation-during-injection',
    ...harness.evidence() }));
});
