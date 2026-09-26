const test = require('node:test');
const assert = require('node:assert/strict');
const { createPageLoadIndicator } = require('../core/page-load-indicator');

const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
function event() { const listeners = []; return { addListener: fn => listeners.push(fn), emit: (...args) => listeners.forEach(fn => fn(...args)) }; }
function harness(options = {}) {
  const calls = [], tabs = new Map([[1, { id: 1, url: 'https://example.test/a', status: 'complete' }], [2, { id: 2, url: 'https://example.test/b', status: 'complete' }]]);
  const activated = new Set(), documents = new Map([[1, 'doc-1'], [2, 'doc-2']]);
  const chromeApi = {
    runtime: { id: 'extension-id', onMessage: event(), getURL: value => `chrome-extension://extension-id/${value}` },
    action: { setIcon: async value => calls.push(value) },
    tabs: { query: async () => [...tabs.values()], get: async id => tabs.get(id), sendMessage: async () => null, onUpdated: event(), onRemoved: event() },
    storage: { onChanged: event() },
    webNavigation: { getFrame: async ({ tabId }) => ({ documentId: documents.get(tabId), url: tabs.get(tabId)?.url }), onCommitted: event() }
  };
  let draws = 0;
  const controller = createPageLoadIndicator({ chromeApi, isTabActivated: async tab => activated.has(`${tab.id}:${tab.url}`), renderBusyIcon: options.renderBusyIcon || (async () => { draws++; return { 16: 'red-image' }; }) });
  const sender = (id = 1, extra = {}) => ({ id: 'extension-id', frameId: 0, documentId: documents.get(id), url: tabs.get(id)?.url, tab: tabs.get(id), ...extra });
  const report = (sequence, busy, extra = {}, owner = sender()) => controller.handle({ type: 'PAGE_LOAD_INDICATOR_STATE', sequence, busy, ...extra }, owner);
  const activate = async (id = 1) => { activated.add(`${id}:${tabs.get(id).url}`); await controller.reconcile(id); await flush(); };
  return { controller, calls, tabs, documents, activated, chromeApi, sender, report, activate, draws: () => draws };
}

test('inactive / J-only pages cannot display a loading dot', async () => {
  const h = harness(); await h.controller.start(); await flush(); h.calls.length = 0;
  assert.equal((await h.report(1, true)).active, false); await flush();
  assert.equal(h.calls.length, 0);
});
test('active DOM busy settles per tab, caches drawing, and deduplicates same-state calls', async () => {
  const h = harness(); await h.activate(); h.calls.length = 0;
  await h.report(1, true); await h.report(2, true); await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].tabId, 1); assert.ok(h.calls[0].imageData);
  await h.report(3, false); await flush(); assert.ok(h.calls.at(-1).path);
  await h.report(4, true); await flush(); assert.equal(h.draws(), 1);
  assert.ok(h.calls.every(call => call.tabId === 1));
});
test('out-of-order old settle cannot replace a newer busy message', async () => {
  const h = harness(); await h.activate(); await h.report(8, true); await flush(); h.calls.length = 0;
  await h.report(7, false); await flush(); assert.equal(h.calls.length, 0);
});
test('browser loading takes priority over a settled DOM', async () => {
  const h = harness(); await h.controller.start(); await h.activate();
  h.tabs.get(1).status = 'loading'; h.chromeApi.tabs.onUpdated.emit(1, { status: 'loading' }, h.tabs.get(1)); await flush();
  h.documents.set(1, 'doc-new'); h.chromeApi.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0, documentId: 'doc-new' }); await flush();
  await h.report(1, false); await flush(); assert.ok(h.calls.at(-1).imageData);
  h.tabs.get(1).status = 'complete'; h.chromeApi.tabs.onUpdated.emit(1, { status: 'complete' }, h.tabs.get(1)); await flush(); assert.ok(h.calls.at(-1).path);
});
test('untrusted id, frame, document, tab, URL and malformed state are rejected', async () => {
  const h = harness(); await h.activate(); h.calls.length = 0;
  for (const extra of [{ id: 'other' }, { frameId: 1 }, { documentId: 'old' }, { documentId: '' }, { tab: null }, { url: 'https://other.test/' }]) {
    assert.equal((await h.report(1, true, {}, h.sender(1, extra))).active, false);
  }
  for (const extra of [{ sequence: 0 }, { sequence: 1.5 }, { busy: 'yes' }]) assert.equal((await h.report(1, true, extra)).active, false);
  await flush(); assert.equal(h.calls.length, 0);
});
test('same-tab navigation to an unactivated URL clears red and rejects old document', async () => {
  const h = harness(); await h.controller.start(); await h.activate(); const old = h.sender(); await h.report(1, true); await flush();
  h.tabs.set(1, { id: 1, url: 'https://example.test/new', status: 'loading' }); h.documents.set(1, 'new');
  h.chromeApi.tabs.onUpdated.emit(1, { url: h.tabs.get(1).url, status: 'loading' }, h.tabs.get(1)); await flush();
  assert.ok(h.calls.at(-1).path); assert.equal((await h.report(2, true, {}, old)).active, false);
});
test('activation removal and service worker restart restore icons without activating pages', async () => {
  const h = harness(); await h.controller.start(); await h.activate(); await h.report(1, true); await flush();
  h.activated.clear(); h.chromeApi.storage.onChanged.emit({ 'sciPanelTabActivation:1': { newValue: undefined } }, 'session'); await flush(); assert.ok(h.calls.at(-1).path);
  const cold = harness(); await cold.controller.start(); await flush(); assert.equal(cold.calls.filter(item => item.path).length, 2);
});
test('tab close prevents pending draw from setting a stale icon', async () => {
  const h = harness(); await h.controller.start(); await h.activate(); h.calls.length = 0;
  const pending = h.report(1, true); h.chromeApi.tabs.onRemoved.emit(1); h.tabs.delete(1); await pending; await flush();
  assert.equal(h.calls.length, 0);
});
test('a slow icon renderer cannot overwrite a later settled state', async () => {
  let release;
  const h = harness({ renderBusyIcon: () => new Promise(resolve => { release = resolve; }) });
  await h.activate(); h.calls.length = 0;
  await h.report(1, true); await flush();
  await h.report(2, false); release({ 16: 'red-image' }); await flush();
  assert.ok(h.calls.every(call => !call.imageData));
});
test('cold service worker queries native loading for a persisted active document', async () => {
  const h = harness(); h.activated.add('1:https://example.test/a'); h.tabs.get(1).status = 'loading';
  await h.controller.start(); await flush();
  assert.ok(h.calls.find(call => call.tabId === 1 && call.imageData));
  assert.ok(h.calls.find(call => call.tabId === 2 && call.path));
});
test('top frame must still belong to the current tab URL even with a matching document id', async () => {
  const h = harness(); await h.activate(); h.calls.length = 0;
  h.chromeApi.webNavigation.getFrame = async () => ({ documentId: 'doc-1', url: 'https://example.test/old' });
  assert.equal((await h.report(1, true)).active, false); await flush(); assert.equal(h.calls.length, 0);
});
