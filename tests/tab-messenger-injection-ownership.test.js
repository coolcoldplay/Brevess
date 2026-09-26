const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTabMessengerNavigationHarness
} = require('./helpers/tab-messenger-navigation-harness.js');

const MODULE_PATH = require.resolve('../core/tab-messenger.js');
const REVISION = '1.0.1-r16-figure-workspace-v1';

function loadIndependentMessenger() {
  const cached = require.cache[MODULE_PATH];
  delete require.cache[MODULE_PATH];
  const instance = require(MODULE_PATH);
  if (cached) require.cache[MODULE_PATH] = cached;
  else delete require.cache[MODULE_PATH];
  return instance;
}

test('a second context does not take over a healthy injection after the old wait limit', async () => {
  const firstMessenger = loadIndependentMessenger();
  const secondMessenger = loadIndependentMessenger();
  const tabId = 9961;
  const expectedUrl = 'https://example.test/slow-content-injection';
  const harness = createTabMessengerNavigationHarness({
    tabId,
    url: expectedUrl,
    revision: REVISION,
    receiver: false
  });
  let releaseFirst;
  let announceFirst;
  let fileStarts = 0;
  const firstStarted = new Promise(resolve => { announceFirst = resolve; });
  const firstBlocked = new Promise(resolve => { releaseFirst = resolve; });
  harness.onBeforeFiles(async () => {
    fileStarts += 1;
    if (fileStarts !== 1) return;
    announceFirst();
    await firstBlocked;
  });
  harness.onAfterFiles(() => {
    harness.current().dataset.sciLlmContentRevision = REVISION;
  });

  const first = firstMessenger.ensureContentScript(harness.chromeApi, tabId, {
    expectedUrl,
    contextKey: 'worker-navigation-8'
  });
  await firstStarted;
  const second = secondMessenger.ensureContentScript(harness.chromeApi, tabId, {
    expectedUrl,
    contextKey: 'sidebar-context-3'
  });
  const releaseTimer = setTimeout(releaseFirst, 2000);
  try {
    await Promise.all([first, second]);
  } finally {
    clearTimeout(releaseTimer);
    releaseFirst();
  }

  assert.equal(fileStarts, 1,
    'an active document claim must remain exclusive beyond the former 1.585 s wait window');
});

test('a failed stale owner cannot clear the replacement owner document claim', async () => {
  const messenger = loadIndependentMessenger();
  const tabId = 9962;
  const expectedUrl = 'https://example.test/replaced-injection-owner';
  const harness = createTabMessengerNavigationHarness({
    tabId,
    url: expectedUrl,
    revision: REVISION,
    receiver: false
  });
  harness.onBeforeFiles(async () => {
    const dataset = harness.current().dataset;
    dataset.sciLlmContentInjectionClaim = REVISION;
    dataset.sciLlmContentInjectionBinding = 'replacement-binding';
    dataset.sciLlmContentInjectionOwner = 'replacement-owner';
    throw new Error('FIRST_OWNER_INJECTION_FAILED');
  });

  await assert.rejects(messenger.ensureContentScript(harness.chromeApi, tabId, {
    expectedUrl,
    contextKey: 'original-owner'
  }), /FIRST_OWNER_INJECTION_FAILED/);

  assert.equal(harness.current().dataset.sciLlmContentInjectionClaim, REVISION);
  assert.equal(harness.current().dataset.sciLlmContentInjectionBinding, 'replacement-binding');
  assert.equal(harness.current().dataset.sciLlmContentInjectionOwner, 'replacement-owner');
});

test('claim inspection pins CSS, scripts, and final state to one browser document ID', async () => {
  const messenger = loadIndependentMessenger();
  const tabId = 9963;
  const expectedUrl = 'https://example.test/document-id-pin';
  const harness = createTabMessengerNavigationHarness({
    tabId,
    url: expectedUrl,
    revision: REVISION,
    receiver: false
  });
  const observed = [];
  let claimed = false;
  const originalExecuteScript = harness.chromeApi.scripting.executeScript;
  const originalInsertCss = harness.chromeApi.scripting.insertCSS;
  harness.chromeApi.scripting.executeScript = async details => {
    let kind = 'page-function';
    if (details.files) kind = 'files';
    else if (details.args?.[0] === true && !claimed) {
      kind = 'claim';
      claimed = true;
    }
    observed.push({
      kind,
      target: { ...details.target,
        documentIds: details.target.documentIds && [...details.target.documentIds] }
    });
    const results = await originalExecuteScript(details);
    return details.func
      ? results.map(result => ({ ...result, documentId: 'browser-document-17' }))
      : results;
  };
  harness.chromeApi.scripting.insertCSS = async details => {
    observed.push({ kind: 'css', target: { ...details.target,
      documentIds: details.target.documentIds && [...details.target.documentIds] } });
    return originalInsertCss(details);
  };
  harness.onAfterFiles(() => {
    harness.current().dataset.sciLlmContentRevision = REVISION;
  });

  await messenger.ensureContentScript(harness.chromeApi, tabId, {
    expectedUrl,
    contextKey: 'document-pin'
  });

  const claimIndex = observed.findIndex(entry => entry.kind === 'claim');
  assert.ok(claimIndex >= 0, 'the document claim must be inspected');
  const ownedWork = observed.slice(claimIndex + 1)
    .filter(entry => ['css', 'files', 'page-function'].includes(entry.kind));
  assert.ok(ownedWork.some(entry => entry.kind === 'css'));
  assert.ok(ownedWork.some(entry => entry.kind === 'files'));
  assert.ok(ownedWork.some(entry => entry.kind === 'page-function'));
  for (const entry of ownedWork) {
    assert.deepEqual(entry.target.documentIds, ['browser-document-17'],
      `${entry.kind} escaped the document that granted the claim`);
  }
});
