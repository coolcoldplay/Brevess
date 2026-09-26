const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const prefix = source.slice(0, source.indexOf('function effectiveArticlePageUrl('));
const scope = source.slice(source.indexOf('let sidePanelShortcutScope ='),
  source.indexOf('function isPageShortcutEditableTarget('));
function emitter() {
  const listeners = [];
  return { addListener(fn) { listeners.push(fn); }, fire(...args) {
    for (const fn of listeners) fn(...args);
  } };
}
function harness() {
  const dataset = {}, onConnect = emitter();
  const state = vm.createContext({ Map, console,
    document: { documentElement: { dataset } },
    location: { hostname: 'www.cell.com', href: 'https://www.cell.com/cell/fulltext/paper#results' },
    chrome: { runtime: { id: 'own', getURL: file => 'chrome-extension://own/' + file, onConnect } },
    SciLLM: { selectPublisherAdapter: () => ({ family: 'elsevier' }),
      normalizeTabDocumentUrl: raw => String(raw || '').replace(/#.*$/, '') }
  });
  vm.runInContext(prefix + '\n' + scope, state);
  return { dataset, state, connect(overrides = {}) {
    const port = { name: 'brevess-side-panel-scope-v1',
      sender: { id: 'own', url: 'chrome-extension://own/popup.html' },
      onMessage: emitter(), onDisconnect: emitter(), replies: [],
      postMessage(message) { this.replies.push(message); }, ...overrides };
    onConnect.fire(port); return port;
  }, enable(port, overrides = {}) {
    port.onMessage.fire({ action: 'setSidePanelShortcutScope', enabled: true,
      expectedUrl: 'https://www.cell.com/cell/fulltext/paper',
      expectedDocumentIdentity: vm.runInContext('contentDocumentIdentity', state),
      expectedNavigationIdentity: vm.runInContext('contentNavigationIdentity()', state),
      shortcuts: { figures: 'f', invalid: 'LONG' }, ...overrides });
  }, disable() { state.setSidePanelShortcutScope({ enabled: false }); } };
}

test('real receiver registration activates only on port message and clears on disconnect', () => {
  const h = harness(), port = h.connect();
  assert.notEqual(h.dataset.sciCellReaderActive, 'true');
  h.enable(port);
  assert.equal(h.dataset.sciCellReaderActive, 'true');
  assert.equal(port.replies.at(-1)?.enabled, true);
  assert.equal(vm.runInContext('sidePanelShortcutScope.shortcuts.figures', h.state), 'F');
  port.onDisconnect.fire();
  assert.equal(h.dataset.sciCellReaderActive, undefined);
  assert.equal(h.dataset.sciReaderSingleColumn, undefined);
});

test('a disconnected old port cannot clear a newer live scope or reenable itself', () => {
  const h = harness(), old = h.connect(), current = h.connect();
  h.enable(old); h.enable(current); old.onDisconnect.fire();
  assert.equal(h.dataset.sciCellReaderActive, 'true');
  current.onDisconnect.fire(); h.enable(old);
  assert.equal(h.dataset.sciCellReaderActive, undefined);
});

test('wrong extension, wrong extension page, or wrong port name has no scope authority', () => {
  for (const overrides of [
    { sender: { id: 'other', url: 'chrome-extension://own/popup.html' } },
    { sender: { id: 'own', url: 'https://www.cell.com/cell/fulltext/paper' } },
    { sender: { id: 'own', url: 'chrome-extension://own/options.html' } },
    { name: 'other' }
  ]) {
    const h = harness(), port = h.connect(overrides); h.enable(port);
    assert.equal(h.dataset.sciCellReaderActive, undefined);
  }
});

test('navigation and absent expected URL cannot enable the receiver', () => {
  for (const expectedUrl of ['', 'https://www.cell.com/cell/fulltext/other']) {
    const h = harness(), port = h.connect(); h.enable(port, { expectedUrl });
    assert.equal(h.dataset.sciCellReaderActive, undefined);
  }
});

test('legacy explicit disable revokes all active scopes so later old disconnect cannot revive one', () => {
  const h = harness(), first = h.connect(), second = h.connect();
  h.enable(first); h.enable(second); h.disable(); first.onDisconnect.fire();
  assert.equal(h.dataset.sciCellReaderActive, undefined);
  h.enable(second);
  assert.equal(h.dataset.sciCellReaderActive, 'true');
  second.onDisconnect.fire();
  assert.equal(h.dataset.sciCellReaderActive, undefined);
});

test('same URL reload identity and changed navigation identity reject stale probe', () => {
  for (const override of [
    { expectedDocumentIdentity: 'old-browser-document' },
    { expectedNavigationIdentity: 'https://www.cell.com/cell/fulltext/old' }
  ]) {
    const h = harness(), port = h.connect(); h.enable(port, override);
    assert.equal(h.dataset.sciCellReaderActive, undefined);
    assert.equal(port.replies.at(-1)?.success, false);
  }
});

test('a lost ACK channel releases scope immediately and capacity is bounded', () => {
  const h = harness(), broken = h.connect({ postMessage() { throw new Error('closed'); } });
  h.enable(broken);
  assert.equal(h.dataset.sciCellReaderActive, undefined);
  for (let i = 0; i < 32; i++) h.connect();
  const excess = h.connect(); h.enable(excess);
  assert.equal(h.dataset.sciCellReaderActive, undefined);
});

test('late port publisher compatibility false preserves new lease; background disable remains explicit', () => {
  const h = harness(), old = h.connect();
  h.enable(old); old.onDisconnect.fire();
  const reopened = h.connect(); h.enable(reopened);
  assert.equal(h.state.applySidePanelShortcutScopeMessage({ enabled: false, portScoped: true }), true);
  assert.equal(h.dataset.sciCellReaderActive, 'true');
  assert.equal(h.state.applySidePanelShortcutScopeMessage({ enabled: false }), false);
  assert.equal(h.dataset.sciCellReaderActive, undefined);
});
