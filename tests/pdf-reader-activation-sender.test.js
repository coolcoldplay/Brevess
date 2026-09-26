const test = require('node:test');
const assert = require('node:assert/strict');
const messenger = require('../core/tab-messenger.js');

function harness() {
  const calls = [];
  const initial = 'chrome-extension://owned/pdf-reader.html';
  const current = `${initial}?source=file%3A%2F%2F%2Fbrevess-local-pdf%2F${'a'.repeat(64)}%2Farticle.pdf`;
  const sender = { id: 'owned', url: initial, documentId: 'browser-document-1', tab: { id: 71, windowId: 1 } };
  const receipt = { contentRevision: messenger.CONTENT_SCRIPT_REVISION,
    navigationIdentity: current, documentIdentity: 'receiver-document-1' };
  const chrome = { runtime: { id: 'owned', getURL: path => `chrome-extension://owned/${path}` },
    tabs: { async sendMessage(...args) { calls.push(args); return receipt; } } };
  return { calls, initial, current, sender, receipt, chrome };
}

test('own PDF activation follows replaceState through the exact sending document', async () => {
  const h = harness();
  const tab = await messenger.resolveOwnPdfReaderSenderTab(h.chrome, h.sender);
  assert.equal(tab.url, h.current);
  assert.equal(tab.id, 71);
  assert.deepEqual(h.calls, [[71, { action: 'getContentScriptRevision' }, { documentId: 'browser-document-1' }]]);
});

test('other senders and unbound documents cannot use the PDF activation route', async () => {
  for (const change of [{ id: 'other' }, { url: 'https://example.org/pdf-reader.html' },
    { url: 'chrome-extension://other/pdf-reader.html' }, { documentId: '' }]) {
    const h = harness();
    await assert.rejects(messenger.resolveOwnPdfReaderSenderTab(h.chrome, { ...h.sender, ...change }), /NAVIGATION_STALE/);
    assert.equal(h.calls.length, 0);
  }
});

test('a replaced receiver, different path or invalid revision cannot activate', async () => {
  for (const change of [{ navigationIdentity: 'https://example.org/article' },
    { navigationIdentity: 'chrome-extension://owned/options.html' },
    { contentRevision: 'old' }, { documentIdentity: '' }]) {
    const h = harness(); Object.assign(h.receipt, change);
    await assert.rejects(messenger.resolveOwnPdfReaderSenderTab(h.chrome, h.sender), /NAVIGATION_STALE/);
  }
  const h = harness();
  h.chrome.tabs.sendMessage = async () => { throw new Error('Receiving end does not exist.'); };
  await assert.rejects(messenger.resolveOwnPdfReaderSenderTab(h.chrome, h.sender), /Receiving end/);
});
