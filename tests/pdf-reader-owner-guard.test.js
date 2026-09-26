const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const messenger = require('../core/tab-messenger.js');
const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const routeStart = background.indexOf('async function handleRoutedMessage');
const routeEnd = background.indexOf('function bytesToBase64', routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart,
  'production handleRoutedMessage must be extractable');
const routedMessageSource = background.slice(routeStart, routeEnd);

const runtimeId = 'brevess-owner-guard-test';
const documentA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const documentB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ownPdfUrl = `chrome-extension://${runtimeId}/pdf-reader.html?source=` +
  'file%3A%2F%2F%2Fbrevess-local-pdf%2Ffixture.pdf';

function normalized(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableReceiverReceipt(overrides = {}) {
  return {
    success: false,
    contentRevision: messenger.CONTENT_SCRIPT_REVISION,
    navigationIdentity: ownPdfUrl,
    documentIdentity: documentA,
    ...overrides
  };
}

function createHarness({
  sender = {}, frameResults = [], receiverResults = [], afterFirstGuard = null
} = {}) {
  const frameQueue = [...frameResults];
  const receiverQueue = [...receiverResults];
  const proofCalls = [];
  const commits = [];
  const events = [];
  let providerCalls = 0;
  const chrome = {
    runtime: {
      id: runtimeId,
      getURL: value => `chrome-extension://${runtimeId}/${value}`
    },
    webNavigation: {
      async getFrame(details) {
        events.push({ type: 'getFrame', details });
        const result = frameQueue.length ? frameQueue.shift() : null;
        if (result instanceof Error) throw result;
        return result;
      }
    },
    tabs: {
      async sendMessage(tabId, message, options) {
        proofCalls.push({ tabId, message, options });
        events.push({ type: 'receiverProof', tabId, options });
        const result = receiverQueue.length
          ? receiverQueue.shift() : stableReceiverReceipt();
        if (result instanceof Error) throw result;
        return result;
      }
    }
  };
  const llmRouter = {
    async commitTrustedDocument(binding) {
      commits.push(binding);
      events.push({ type: 'commit', binding });
    },
    async handle(_message, ownerContext) {
      try {
        await ownerContext.assertTrustedOwnerCurrent();
        if (afterFirstGuard) await afterFirstGuard({ chrome, events });
        providerCalls += 1;
        events.push({ type: 'provider' });
        await ownerContext.assertTrustedOwnerCurrent();
        return { success: true, data: { completed: true } };
      } catch (error) {
        return { success: false, error: { code: String(error?.code || error?.message || '') } };
      }
    }
  };
  const context = {
    Promise,
    chrome,
    SciLLM: messenger,
    llmRouter,
    aggregateNotificationTokenUsage() { return null; },
    async publishCodexReverseEvent() {},
    async coordinateOpenArticleWorkspaceTabs() { return []; }
  };
  vm.runInNewContext(
    `${routedMessageSource}; globalThis.route = handleRoutedMessage;`,
    context,
    { filename: 'background-pdf-reader-owner-guard.vm.js' }
  );
  const resolvedSender = {
    id: runtimeId,
    tab: { id: 73, status: 'complete' },
    frameId: 0,
    documentId: documentA,
    url: ownPdfUrl,
    ...sender
  };
  return {
    chrome,
    resolvedSender,
    proofCalls,
    commits,
    events,
    providerCalls: () => providerCalls,
    route: () => context.route(
      { type: 'LLM_ANALYZE_FIGURES' }, resolvedSender, () => undefined
    )
  };
}

test('own PDF reader proves the exact browser document twice per owner guard and passes after-guard', async () => {
  const harness = createHarness();

  const response = await harness.route();

  assert.equal(response.success, true);
  assert.equal(harness.providerCalls(), 1);
  assert.equal(harness.proofCalls.length, 4,
    'entry and after-provider guards must each prove before and after durable commit');
  for (const proof of harness.proofCalls) {
    assert.equal(proof.tabId, 73);
    assert.deepEqual(proof.message, { action: 'getContentScriptRevision' });
    assert.deepEqual(proof.options, { documentId: documentA });
  }
  assert.deepEqual(normalized(harness.commits), [0, 1].map(() => ({
    senderExtensionId: runtimeId,
    senderTabId: 73,
    senderFrameId: 0,
    senderDocumentId: documentA
  })));
  assert.deepEqual(harness.events.map(event => event.type), [
    'getFrame', 'receiverProof', 'commit', 'getFrame', 'receiverProof',
    'provider',
    'getFrame', 'receiverProof', 'commit', 'getFrame', 'receiverProof'
  ]);
});

test('web, foreign-extension, options, and missing-document senders are rejected without provider work', async () => {
  const invalidSenders = [
    { label: 'web HTML', url: 'https://example.test/article' },
    { label: 'foreign extension', url: 'chrome-extension://foreign/pdf-reader.html' },
    { label: 'own options page', url: `chrome-extension://${runtimeId}/options.html` },
    { label: 'missing document ID', url: ownPdfUrl, documentId: '' }
  ];
  for (const { label, ...sender } of invalidSenders) {
    const harness = createHarness({ sender });
    const response = await harness.route();
    assert.equal(response.success, false, `${label} must fail`);
    assert.equal(response.error.code, 'CANCELLED', `${label} must fail closed`);
    assert.equal(harness.providerCalls(), 0, `${label} reached provider work`);
    assert.equal(harness.commits.length, 0, `${label} committed an owner`);
    assert.equal(harness.proofCalls.length, 0,
      `${label} must not address an untrusted receiver`);
  }
});

test('an explicit different webNavigation document is authoritative and never falls back', async () => {
  const harness = createHarness({ frameResults: [{ documentId: documentB }] });

  const response = await harness.route();

  assert.equal(response.success, false);
  assert.equal(response.error.code, 'CANCELLED');
  assert.equal(harness.providerCalls(), 0);
  assert.equal(harness.proofCalls.length, 0,
    'a browser-authoritative different document must not use the PDF receiver fallback');
  assert.deepEqual(normalized(harness.commits), [{
    senderExtensionId: runtimeId,
    senderTabId: 73,
    senderFrameId: 0,
    senderDocumentId: documentB
  }]);
});

test('receiver disappearance or identity change after durable commit rejects before provider', async () => {
  const variants = [
    new Error('Could not establish connection. Receiving end does not exist.'),
    stableReceiverReceipt({ navigationIdentity: `chrome-extension://${runtimeId}/options.html` })
  ];
  for (const secondProof of variants) {
    const harness = createHarness({
      receiverResults: [stableReceiverReceipt(), secondProof]
    });
    const response = await harness.route();
    assert.equal(response.success, false);
    assert.equal(response.error.code, 'CANCELLED');
    assert.equal(harness.providerCalls(), 0);
    assert.equal(harness.commits.length, 1,
      'the first exact proof must be durably committed before the second proof fails');
    assert.equal(harness.proofCalls.length, 2);
  }
});

test('receiver loss in the after-provider guard prevents a successful response', async () => {
  const harness = createHarness({
    receiverResults: [
      stableReceiverReceipt(), stableReceiverReceipt(),
      new Error('Could not establish connection. Receiving end does not exist.')
    ]
  });

  const response = await harness.route();

  assert.equal(harness.providerCalls(), 1);
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'CANCELLED');
  assert.equal(harness.commits.length, 1);
  assert.equal(harness.proofCalls.length, 3);
});
