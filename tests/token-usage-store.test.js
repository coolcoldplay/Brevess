const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMemoryTokenUsageStorageArea,
  createTokenUsageStore
} = require('../core/token-usage-store.js');

test('aggregates token usage by article, feature, provider, and model', async () => {
  const store = createTokenUsageStore(createMemoryTokenUsageStorageArea());
  const common = {
    canonicalUrl: 'https://example.org/paper?tracking=1#results',
    title: 'Example paper',
    featureId: 'figure_walkthrough',
    featureLabel: '逐图解读',
    providerId: 'codex-local',
    model: 'auto'
  };
  await Promise.all([
    store.record({
      ...common, inputTokens: 120, outputTokens: 30, reasoningTokens: 10
    }),
    store.record({
      ...common, inputTokens: 80, outputTokens: 20, cacheHitTokens: 40
    })
  ]);
  await store.record({
    ...common,
    featureId: 'article_chat',
    featureLabel: '全文问答',
    providerId: 'openai',
    model: 'gpt-5-mini',
    inputTokens: 50,
    outputTokens: 15,
    estimated: true
  });

  const documents = await store.list();
  assert.equal(documents.length, 1);
  assert.equal(documents[0].canonicalUrl, 'https://example.org/paper');
  assert.deepEqual(documents[0].totals, {
    requests: 3,
    exactRequests: 2,
    estimatedRequests: 1,
    inputTokens: 250,
    outputTokens: 65,
    reasoningTokens: 10,
    cacheHitTokens: 40,
    cacheMissTokens: 0
  });
  assert.equal(documents[0].features.figure_walkthrough.requests, 2);
  assert.equal(
    Object.values(documents[0].features.figure_walkthrough.models)[0].inputTokens,
    200
  );
  assert.equal(documents[0].features.article_chat.estimatedRequests, 1);
});

test('looks up and clears one canonical article without affecting another', async () => {
  const store = createTokenUsageStore(createMemoryTokenUsageStorageArea());
  await store.record({
    canonicalUrl: 'https://example.org/a?x=1',
    featureId: 'highlight',
    providerId: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 10,
    outputTokens: 2
  });
  await store.record({
    canonicalUrl: 'https://example.org/b',
    featureId: 'highlight',
    providerId: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 20,
    outputTokens: 4
  });
  const first = await store.getForDocument({ canonicalUrl: 'https://example.org/a#main' });
  assert.equal(first.totals.inputTokens, 10);
  assert.deepEqual(
    await store.clearDocument({ canonicalUrl: 'https://example.org/a?ignored=1' }),
    { deleted: true }
  );
  assert.deepEqual((await store.list()).map(item => item.canonicalUrl), [
    'https://example.org/b'
  ]);
});
