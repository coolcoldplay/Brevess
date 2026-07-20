const test = require('node:test');
const assert = require('node:assert/strict');

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

test('tab activation is scoped to one tab and one document URL', async () => {
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
});

test('closing or navigating a tab clears its activation marker', async () => {
  const storage = createSessionStorage();
  const tab = { id: 7, url: 'https://example.org/paper' };
  await activation.markTabActivated(storage, tab);
  assert.equal(await activation.isTabActivated(storage, tab), true);
  await activation.clearTabActivation(storage, tab.id);
  assert.equal(await activation.isTabActivated(storage, tab), false);
});

