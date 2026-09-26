const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const messenger = require('../core/tab-messenger.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const start = source.indexOf('async function handleRoutedMessage(');
const end = source.indexOf('function bytesToBase64', start);
assert.ok(start > 0 && end > start);
const runtimeId = 'creation-owner-fixture';
const documentA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const documentB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const pdfUrl = `chrome-extension://${runtimeId}/pdf-reader.html?source=https%3A%2F%2Fexample.org%2Fpaper.pdf`;
const plain = value => JSON.parse(JSON.stringify(value));
function harness({ sender: overrides = {}, frames = [{ documentId: documentA }, { documentId: documentA }],
  receipts = [], capability = true, runtime = runtimeId, mode = 'strict', type = 'DOCUMENT_PREPARE' } = {}) {
  const frameQueue = [...frames], receiptQueue = [...receipts], calls = [], commits = [];
  let exposed;
  const chrome = {
    runtime: { id: runtime, getURL: value => `chrome-extension://${runtimeId}/${value}` },
    webNavigation: capability ? { async getFrame(details) {
      calls.push({ kind: 'frame', details });
      const frame = frameQueue.shift(); if (frame instanceof Error) throw frame; return frame || null;
    } } : {},
    tabs: { async sendMessage(tabId, message, options) {
      calls.push({ kind: 'pdf', tabId, message, options });
      const receipt = receiptQueue.length ? receiptQueue.shift() : {
        contentRevision: messenger.CONTENT_SCRIPT_REVISION, navigationIdentity: pdfUrl, documentIdentity: 'pdf-page-identity' };
      if (receipt instanceof Error) throw receipt; return receipt;
    } }
  };
  const context = { Promise, URL, chrome, SciLLM: messenger,
    llmRouter: {
      async commitTrustedDocument(binding) { commits.push(plain(binding)); },
      async handle(_message, owner) {
        exposed = owner;
        if (mode === 'ignore') return { success: true, data: { record: { documentId: 'ordinary-record' } } };
        try {
          if (mode !== 'legacy') assert.equal(typeof owner.assertDocumentCreationOwnerCurrent, 'function', 'strict callback must be supplied');
          const proof = await (mode === 'legacy' ? owner.assertTrustedOwnerCurrent() : owner.assertDocumentCreationOwnerCurrent());
          return { success: true, data: { proof } };
        } catch (error) { return { success: false, error: { code: error.code || error.message, retryable: error.retryable } }; }
      }
    }, aggregateNotificationTokenUsage() { return null; }, async publishCodexReverseEvent() {},
    async coordinateOpenArticleWorkspaceTabs() { return []; } };
  vm.runInNewContext(`${source.slice(start, end)};globalThis.route=handleRoutedMessage;`, context);
  const sender = { id: runtimeId, tab: { id: 8 }, frameId: 0, documentId: documentA,
    url: 'https://example.org/paper', ...overrides };
  return { calls, commits, chrome, get owner() { return exposed; },
    route: () => context.route({ type }, sender, () => {}) };
}
async function denied(fixture) {
  const result = await fixture.route(); assert.equal(result.success, false);
  assert.equal(result.error.code, 'CANCELLED'); assert.equal(result.error.retryable, false);
  return result;
}

test('normal same-runtime document gets strict current proof without generic restore trust', async () => {
  const f = harness(); const result = await f.route();
  assert.equal(result.success, true, JSON.stringify(result)); assert.equal(result.data.proof, true);
  assert.equal(f.owner.trustedContentScript, false); assert.equal(f.owner.trustedExtensionSender, true);
  assert.deepEqual(f.calls.map(call => call.kind), ['frame', 'frame']);
  assert.deepEqual(f.commits, [{ senderExtensionId: runtimeId, senderTabId: 8,
    senderFrameId: 0, senderDocumentId: documentA }]);
});

test('strict proof rejects missing/foreign runtime identity before any browser proof or commit', async () => {
  for (const options of [{ runtime: '' }, { runtime: null }, { sender: { id: '' } },
    { sender: { id: undefined } }, { sender: { id: 'foreign-extension' } }]) {
    const f = harness(options); await denied(f); assert.equal(f.calls.length, 0); assert.equal(f.commits.length, 0);
  }
});

test('strict proof rejects absent, coerced, negative, fractional and unsafe tab/frame ids', async () => {
  const invalid = [undefined, null, '', '8', -1, 0.5, Number.MAX_SAFE_INTEGER + 1];
  for (const key of ['tab', 'frameId']) for (const value of invalid) {
    const f = harness({ sender: key === 'tab' ? { tab: value === undefined ? undefined : { id: value } } : { frameId: value } });
    await denied(f); assert.equal(f.calls.length, 0); assert.equal(f.commits.length, 0);
  }
});

test('strict document identity must be a nonblank string and webNavigation capability must exist', async () => {
  for (const documentId of [undefined, null, '', '   ', 123]) {
    const f = harness({ sender: { documentId } }); await denied(f); assert.equal(f.calls.length, 0);
  }
  for (const url of ['https://example.org/paper', pdfUrl]) {
    const f = harness({ capability: false, sender: { url } }); await denied(f); assert.equal(f.calls.length, 0);
  }
});

test('zero tab/frame ids are valid strict bindings rather than truthiness failures', async () => {
  const f = harness({ sender: { tab: { id: 0 }, frameId: 0 } });
  assert.equal((await f.route()).success, true); assert.equal(f.commits[0].senderTabId, 0);
});

test('ordinary web document with no returned current frame cannot obtain a creation proof', async () => {
  for (const frames of [[null], [new Error('browser frame unavailable')]]) {
    const f = harness({ frames }); await denied(f); assert.equal(f.commits.length, 0);
    assert.equal(f.calls.filter(call => call.kind === 'pdf').length, 0);
  }
});

test('browser-authoritative different document cancels before or immediately after owner commit', async () => {
  for (const frames of [[{ documentId: documentB }], [{ documentId: documentA }, { documentId: documentB }]]) {
    const f = harness({ frames }); await denied(f);
    assert.deepEqual(f.commits.map(binding => binding.senderDocumentId), frames.map(frame => frame.documentId));
    assert.equal(f.calls.filter(call => call.kind === 'pdf').length, 0);
  }
});

test('own PDF fallback addresses exact browser document and proves twice around commit', async () => {
  const f = harness({ sender: { url: pdfUrl }, frames: [null, null] });
  const result = await f.route(); assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(f.calls.map(call => call.kind), ['frame', 'pdf', 'frame', 'pdf']);
  for (const proof of f.calls.filter(call => call.kind === 'pdf')) {
    assert.deepEqual(proof.options, { documentId: documentA });
    assert.deepEqual(proof.message, { action: 'getContentScriptRevision' }); assert.equal(proof.tabId, 8);
  }
});

test('PDF fallback cannot override any browser-returned frame or accept other extension pages', async () => {
  for (const frame of [{ documentId: documentB }, {}]) {
    const f = harness({ sender: { url: pdfUrl }, frames: [frame] }); await denied(f);
    assert.equal(f.calls.filter(call => call.kind === 'pdf').length, 0);
  }
  for (const url of [`chrome-extension://${runtimeId}/options.html`, 'chrome-extension://foreign/pdf-reader.html',
    `chrome-extension://${runtimeId}/pdf-reader.html/`, 'https://example.org/pdf-reader.html']) {
    const f = harness({ sender: { url }, frames: [null] }); await denied(f);
    assert.equal(f.calls.filter(call => call.kind === 'pdf').length, 0);
  }
});

test('PDF receiver disappearance and invalid revision/navigation deny strict creation proof', async () => {
  const valid = { contentRevision: messenger.CONTENT_SCRIPT_REVISION, navigationIdentity: pdfUrl, documentIdentity: 'pdf-id' };
  for (const receipt of [new Error('receiver closed'), { ...valid, contentRevision: 'wrong' },
    { ...valid, documentIdentity: '' }, { ...valid, navigationIdentity: `chrome-extension://${runtimeId}/options.html` }]) {
    const f = harness({ sender: { url: pdfUrl }, frames: [null, null], receipts: [valid, receipt] });
    await denied(f); assert.equal(f.commits.length, 1);
  }
});

test('legacy owner callback keeps its old missing-capability semantics', async () => {
  const f = harness({ mode: 'legacy', capability: false });
  assert.equal((await f.route()).success, true); assert.equal(f.calls.length, 0);
});

test('ordinary DOCUMENT_PREPARE remains router-owned and no eager creation guard blocks it', async () => {
  const f = harness({ mode: 'ignore', capability: false, sender: { tab: undefined, documentId: '' } });
  const result = await f.route(); assert.equal(result.success, true);
  assert.equal(result.data.record.documentId, 'ordinary-record'); assert.equal(f.calls.length, 0);
  assert.equal(typeof f.owner.assertDocumentCreationOwnerCurrent, 'function');
  assert.equal(f.owner.trustedContentScript, false);
});
