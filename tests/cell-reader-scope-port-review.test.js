const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const prefixEnd = source.indexOf('function effectiveArticlePageUrl(');
const scopeStart = source.indexOf('let sidePanelShortcutScope =');
const scopeEnd = source.indexOf('function isPageShortcutEditableTarget(', scopeStart);
assert.ok(prefixEnd > 0 && scopeStart > prefixEnd && scopeEnd > scopeStart);
const production = source.slice(0, prefixEnd) + '\n' + source.slice(scopeStart, scopeEnd);

function event() {
  const listeners = new Set();
  return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
    emit: value => [...listeners].forEach(fn => fn(value)) };
}
function page(hostname = 'www.cell.com') {
  const dataset = { siteOwned: 'preserve' };
  const onConnect = event();
  const context = vm.createContext({
    document: { documentElement: { dataset } },
    location: { hostname, href: `https://${hostname}/paper#results` },
    chrome: { runtime: { id: 'review-own', onConnect,
      getURL: file => `chrome-extension://review-own/${file}` } },
    SciLLM: { selectPublisherAdapter: () => ({ family: 'elsevier' }) }
  });
  vm.runInContext(production, context, { filename: 'content.js:scope-port-review-production' });
  const current = () => JSON.parse(vm.runInContext('JSON.stringify(sidePanelShortcutScope)', context));
  const proof = () => ({ expectedDocumentIdentity: vm.runInContext('contentDocumentIdentity', context),
    expectedNavigationIdentity: vm.runInContext('contentNavigationIdentity()', context),
    expectedUrl: context.location.href });
  function connect(overrides = {}) {
    const port = { name: 'brevess-side-panel-scope-v1',
      sender: { id: 'review-own', url: 'chrome-extension://review-own/popup.html' },
      onMessage: event(), onDisconnect: event(), replies: [],
      postMessage(reply) { this.replies.push(JSON.parse(JSON.stringify(reply))); }, ...overrides };
    onConnect.emit(port);
    return port;
  }
  return { dataset, context, current, proof, connect,
    enable(port, fields = {}) { port.onMessage.emit({ action: 'setSidePanelShortcutScope',
      enabled: true, shortcuts: { figures: 'F' }, ...proof(), ...fields }); },
    count() { return vm.runInContext('sidePanelShortcutScopePorts.size', context); } };
}

test('review: a failed replacement ACK preserves the older live scope and its shortcut preferences', () => {
  const h = page();
  const old = h.connect();
  h.enable(old, { shortcuts: { next: 'n' } });
  const broken = h.connect({ postMessage() { throw Error('channel closed before ACK'); } });
  h.enable(broken, { shortcuts: { previous: 'p' } });
  assert.deepEqual(h.current(), { enabled: true, shortcuts: { next: 'N' } });
  assert.equal(h.count(), 1);
  assert.equal(h.dataset.sciCellReaderActive, 'true');
  broken.onDisconnect.emit();
  assert.deepEqual(h.current(), { enabled: true, shortcuts: { next: 'N' } });
  old.onDisconnect.emit();
  assert.equal(h.current().enabled, false);
});

test('review: invalid late messages and their failed ACK cannot revoke another live port', () => {
  const h = page(), owner = h.connect();
  h.enable(owner);
  const rejected = h.connect({ postMessage() { throw Error('ACK unavailable'); } });
  h.enable(rejected, { expectedDocumentIdentity: 'discarded-probe' });
  assert.equal(h.current().enabled, true);
  assert.equal(h.count(), 1);
  owner.onDisconnect.emit();
  h.enable(rejected);
  assert.equal(h.current().enabled, false);
  assert.equal(h.count(), 0);
});

test('review: port capacity recovers after release without evicting an enabled owner', () => {
  const h = page(), ports = Array.from({ length: 32 }, () => h.connect());
  h.enable(ports[0]);
  const excess = h.connect();
  h.enable(excess, { shortcuts: { previous: 'P' } });
  assert.deepEqual(h.current(), { enabled: true, shortcuts: { figures: 'F' } });
  assert.equal(h.count(), 32);
  assert.equal(excess.replies.length, 0);
  ports[1].onDisconnect.emit();
  const replacement = h.connect();
  h.enable(replacement, { shortcuts: { previous: 'P' } });
  assert.equal(h.count(), 32);
  ports[0].onDisconnect.emit();
  assert.deepEqual(h.current(), { enabled: true, shortcuts: { previous: 'P' } });
  replacement.onDisconnect.emit();
  assert.equal(h.current().enabled, false);
  assert.equal(h.dataset.sciCellReaderActive, undefined);
});

test('review: an actual new content document at the identical URL rejects the old document proof', () => {
  const prior = page();
  const oldProof = prior.proof();
  const current = page(), port = current.connect();
  assert.equal(current.proof().expectedUrl, oldProof.expectedUrl);
  assert.notEqual(current.proof().expectedDocumentIdentity, oldProof.expectedDocumentIdentity);
  current.enable(port, oldProof);
  assert.deepEqual(port.replies.at(-1), { success: false, enabled: false });
  assert.equal(current.dataset.sciCellReaderActive, undefined);
  current.enable(port);
  assert.equal(current.dataset.sciCellReaderActive, 'true');
  port.onDisconnect.emit();
  current.enable(port, oldProof);
  assert.equal(current.current().enabled, false);
});

test('review: non-Cell disconnect changes shortcut scope without removing existing publisher layout', () => {
  for (const host of ['www.sciencedirect.com', 'www.nature.com', 'cell.com.example.test']) {
    const h = page(host), initial = { ...h.dataset }, port = h.connect();
    h.enable(port);
    assert.equal(h.current().enabled, true);
    assert.deepEqual(h.dataset, initial);
    port.onDisconnect.emit();
    assert.equal(h.current().enabled, false);
    assert.deepEqual(h.dataset, initial);
  }
});

test('review: popup filename or origin lookalikes cannot register a scope owner', () => {
  const h = page();
  for (const url of ['chrome-extension://review-own/popup.html.evil',
    'chrome-extension://review-own/other/popup.html', 'chrome-extension://foreign/popup.html',
    'https://review-own/popup.html', 'chrome-extension://review-own/popup%2ehtml']) {
    const port = h.connect({ sender: { id: 'review-own', url } });
    h.enable(port);
    assert.equal(h.count(), 0, url);
    assert.equal(h.current().enabled, false, url);
  }
  assert.equal(h.dataset.siteOwned, 'preserve');
});
