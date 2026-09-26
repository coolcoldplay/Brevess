const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = fs.readFileSync(path.join(__dirname, 'archive-page-restore-review.test.js'), 'utf8');
const { harness, copy, manualAsset } = new Function('require', '__dirname',
  fixture.slice(0, fixture.indexOf("\ntest(")) +
  '\nreturn { harness, copy, manualAsset };')(require, __dirname);

function setup() {
  const h = harness();
  h.state.publicArticleChatTurn = copy;
  return h;
}
const chat = turns => ({ relativePath: 'chat/index.json', content: { turns } });
const turn = overrides => ({ turnId: 'turn-1', question: 'p = 0.03?',
  status: 'completed', intent: 'ask', answerBlocks: [], ...overrides });

test('empty chat index does not make a fully projected restore look unfinished', async () => {
  const h = setup();
  const result = await h.apply([manualAsset, chat([])]);
  assert.equal(result.manualAnnotationsRestored, true);
  assert.equal(Boolean(result.manualRebuildDeferred), false);
  assert.equal(result.chatTurns, 0);
});

test('ordinary questions restore their answer and are not manual rebuild work', async () => {
  const h = setup();
  const ordinary = turn({ answerBlocks: [{ blockId: 'a', markdown: 'No increase, p = 0.03',
    evidence: [{ quote: 'p = 0.03', verificationStatus: 'verified' }] }] });
  const result = await h.apply([manualAsset, chat([ordinary])]);
  assert.equal(Boolean(result.manualRebuildDeferred), false);
  assert.deepEqual(copy(h.state.articleChatState.turns[0].answerBlocks), ordinary.answerBlocks);
});

test('discarded and interrupted highlight requests do not claim a skipped renderer', async () => {
  const h = setup();
  const result = await h.apply([manualAsset, chat([
    turn({ turnId: 'discarded', question: '', intent: 'highlight' }),
    turn({ turnId: 'pending', status: 'generating', intent: 'highlight' }),
    turn({ turnId: 'failed', status: 'error', intent: 'highlight' })
  ])]);
  assert.equal(Boolean(result.manualRebuildDeferred), false);
  assert.equal(h.state.articleChatState.turns.find(item => item.turnId === 'pending').status,
    'interrupted');
});

test('finished highlight turns with restorable quote evidence remain explicitly pending', async () => {
  for (const status of ['completed', 'truncated', 'incomplete']) {
    const h = setup();
    const result = await h.apply([manualAsset, chat([turn({ intent: 'highlight', status,
      answerBlocks: [{ blockId: 'a', evidence: [{ quote: 'p = 0.03' }] }] })])]);
    assert.equal(result.manualRebuildDeferred, true, status);
  }
});

test('highlight turns without quote evidence do not invent work', async () => {
  const h = setup();
  const result = await h.apply([manualAsset, chat([turn({ intent: 'highlight',
    answerBlocks: [{ blockId: 'a', evidence: [{ quote: '  ' }, {}] }] })])]);
  assert.equal(Boolean(result.manualRebuildDeferred), false);
});

test('actual unresolved manual ranges remain pending even without chat', async () => {
  const h = setup();
  h.state.restoreManualAnnotations = () => ({ unresolved: [{ annotationId: 'manual-restored' }] });
  const result = await h.apply([manualAsset]);
  assert.equal(result.manualRebuildDeferred, true);
  assert.equal(result.manualUnresolvedCount, 1);
});
