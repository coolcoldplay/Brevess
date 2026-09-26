const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createBackgroundNavigationHarness
} = require('./helpers/tab-messenger-navigation-harness.js');

let activation = {};
try {
  activation = require('../core/tab-activation.js');
} catch {
  // The first red run intentionally exercises the missing activation module.
}

function createSessionStorage() {
  const values = {};
  return {
    values,
    async get(key) {
      return { [key]: values[key] };
    },
    async set(update) {
      Object.assign(values, update);
    },
    async remove(key) {
      delete values[key];
    }
  };
}

test('tab activation remembers a bounded set of document URLs within one tab', async () => {
  assert.equal(typeof activation.markTabActivated, 'function');
  const storage = createSessionStorage();
  const tab = {
    id: 42,
    url: 'https://publisher.example/article/one?via=oa#results',
    title: 'Paper one'
  };

  const marked = await activation.markTabActivated(storage, tab);
  assert.equal(marked.tabId, 42);
  assert.equal(marked.url, 'https://publisher.example/article/one?via=oa');
  assert.equal(await activation.isTabActivated(storage, tab), true);
  assert.equal(await activation.isTabActivated(storage, {
    ...tab,
    url: 'https://publisher.example/article/two'
  }), false);
  assert.equal(await activation.isTabActivated(storage, {
    ...tab,
    id: 43
  }), false);

  const second = {
    ...tab,
    url: 'https://publisher.example/article/two#methods',
    title: 'Paper two'
  };
  const secondMarked = await activation.markTabActivated(storage, second);
  assert.equal(secondMarked.documents.length, 2);
  assert.equal(await activation.isTabActivated(storage, tab), true);
  assert.equal(await activation.isTabActivated(storage, second), true);
  assert.equal(await activation.isTabActivated(storage, {
    ...tab,
    url: 'https://publisher.example/not-an-activated-paper'
  }), false);
});

test('closing a tab explicitly clears every remembered document activation', async () => {
  const storage = createSessionStorage();
  const tab = { id: 7, url: 'https://example.org/paper' };
  await activation.markTabActivated(storage, tab);
  assert.equal(await activation.isTabActivated(storage, tab), true);
  await activation.clearTabActivation(storage, tab.id);
  assert.equal(await activation.isTabActivated(storage, tab), false);
});

test('tab activation evicts the oldest paper after the per-tab history limit', async () => {
  const storage = createSessionStorage();
  const tabId = 88;
  const total = activation.MAX_ACTIVATED_DOCUMENTS_PER_TAB + 3;
  for (let index = 0; index < total; index += 1) {
    await activation.markTabActivated(storage, {
      id: tabId,
      url: `https://publisher.example/article/${index}`,
      title: `Paper ${index}`
    });
  }

  const record = await activation.readTabActivation(storage, tabId);
  assert.equal(record.documents.length, activation.MAX_ACTIVATED_DOCUMENTS_PER_TAB);
  assert.equal(record.documents[0].url, `https://publisher.example/article/${total - 1}`);
  assert.equal(await activation.isTabActivated(storage, {
    id: tabId,
    url: 'https://publisher.example/article/0'
  }), false);
  assert.equal(await activation.isTabActivated(storage, {
    id: tabId,
    url: `https://publisher.example/article/${total - 1}`
  }), true);
});

test('legacy single-paper activation records remain readable', async () => {
  const storage = createSessionStorage();
  const tabId = 17;
  await storage.set({
    [activation.tabActivationStorageKey(tabId)]: {
      tabId,
      url: 'https://publisher.example/legacy-paper#figure-2',
      title: 'Legacy paper',
      activatedAt: 123
    }
  });

  assert.equal(await activation.isTabActivated(storage, {
    id: tabId,
    url: 'https://publisher.example/legacy-paper'
  }), true);
  const updated = await activation.markTabActivated(storage, {
    id: tabId,
    url: 'https://publisher.example/new-paper'
  });
  assert.deepEqual(updated.documents.map(item => item.url), [
    'https://publisher.example/new-paper',
    'https://publisher.example/legacy-paper'
  ]);
});

test('the actual background activation listener binds injection to the active tab generation', async () => {
  const tab = {
    id: 21,
    windowId: 7,
    url: 'https://example.org/article#methods',
    status: 'complete'
  };
  const harness = createBackgroundNavigationHarness({ tabs: [tab] });

  const response = await harness.emitRuntimeMessage({
    type: 'SIDE_PANEL_ACTIVATE_CURRENT_TAB',
    tabId: tab.id,
    url: 'https://example.org/article'
  });

  assert.equal(response?.success, true);
  const activationCall = harness.calls.find(call => call.type === 'activationEnsure');
  assert.ok(activationCall);
  assert.equal(activationCall.args[1], tab.id);
  assert.equal(
    activationCall.args[2].expectedUrl,
    'https://example.org/article'
  );
  assert.equal(typeof activationCall.args[2].contextKey, 'string');
  assert.equal(activationCall.args[2].isCurrent(), true);
  assert.equal(harness.calls.some(call => call.type === 'sidePanelOptions'), true);
});

test('the actual background update listener warms only a completed current document', async () => {
  const tab = {
    id: 22,
    windowId: 7,
    url: 'https://example.org/article?view=full#figure-1',
    status: 'complete'
  };
  const harness = createBackgroundNavigationHarness({
    isTabActivated: async () => true
  });

  await harness.emitUpdated(tab.id, { status: 'loading' }, {
    ...tab,
    status: 'loading'
  });
  await harness.flush();
  assert.equal(harness.calls.some(call => call.type === 'recoveryMessage'), false);

  await harness.emitUpdated(tab.id, { status: 'complete' }, tab);
  await harness.flush();
  const warm = harness.calls.find(call => call.type === 'recoveryMessage');
  assert.ok(warm);
  assert.equal(warm.args[1], tab.id);
  assert.equal(warm.args[2].action, 'warmArticleIndex');
  assert.equal(warm.args[2].expectedUrl, 'https://example.org/article?view=full');
  assert.equal(warm.args[3].expectedUrl, 'https://example.org/article?view=full');
  assert.equal(typeof warm.args[3].contextKey, 'string');
  assert.equal(warm.args[3].isCurrent(), true);
});

