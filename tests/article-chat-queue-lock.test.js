const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
function section(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(turns, deleteGate = deferred()) {
  const started = [];
  const clearedHighlights = [];
  const context = vm.createContext({
    articleChatState: { turns, memoryNeedsRebuild: false },
    articleChatPumpPromise: null,
    articleChatGeneration: 0,
    articleWorkspaceLifecycleGeneration: 1,
    articleChatClearInFlight: false,
    articleChatMutationLocks: new Set(),
    runArticleChatTurn: async turn => {
      started.push(turn.turnId);
      turn.status = 'completed';
    },
    deleteArticleChatCheckpoint: () => deleteGate.promise,
    articleChatIndexStateWithoutTurns: () => ({}),
    assertCurrentArticleWorkspaceLifecycle: () => {},
    scheduleCurrentArticleArchiveSave: () => {},
    notifyArticleChatStateChanged: () => {},
    clearNativePdfSemanticChatHighlights: turnId => clearedHighlights.push(turnId)
  });
  vm.runInContext(section('function pumpArticleChatQueue()', 'async function askArticleWithLLM(') +
    section('async function removeArticleChatTurn(', 'async function deleteArticleChatAnswer(') +
    section('async function clearArticleChat()', 'async function seedFigureWorkspaceMetaFromCrossFigure('), context);
  return { context, started, deleteGate, clearedHighlights };
}

test('queue skips a turn whose durable deletion is pending', async () => {
  const h = harness([{ turnId: 'delete-me', status: 'queued' },
    { turnId: 'keep-me', status: 'queued' }]);
  const deletion = h.context.removeArticleChatTurn('delete-me', { queuedOnly: true });
  await h.context.pumpArticleChatQueue();
  const beforeAck = [...h.started];
  assert.deepEqual(h.clearedHighlights, []);
  h.deleteGate.resolve({ turn: { deleted: true } });
  await deletion;
  assert.deepEqual(beforeAck, ['keep-me']);
  assert.deepEqual(h.context.articleChatState.turns.map(turn => turn.turnId), ['keep-me']);
  assert.deepEqual(h.clearedHighlights, ['delete-me']);
});

test('queue becomes idle when every queued turn is locked', async () => {
  const h = harness([{ turnId: 'locked', status: 'queued' }]);
  h.context.articleChatMutationLocks.add('locked');
  await h.context.pumpArticleChatQueue();
  assert.deepEqual(h.started, []);
  assert.equal(h.context.articleChatPumpPromise, null);
});

test('failed durable deletion unlocks and resumes the pending turn', async () => {
  const h = harness([{ turnId: 'retry', status: 'queued' }]);
  const deletion = h.context.removeArticleChatTurn('retry', { queuedOnly: true });
  h.deleteGate.reject(new Error('disk failure'));
  await assert.rejects(deletion, /disk failure/);
  await Promise.resolve();
  assert.deepEqual(h.started, ['retry']);
  assert.equal(h.context.articleChatMutationLocks.size, 0);
});

test('queue waits for cancellation persistence before starting the next turn', async () => {
  const h = harness([{ turnId: 'next', status: 'queued' }]);
  h.context.articleChatState.loading = true;
  await h.context.pumpArticleChatQueue();
  const beforeAck = [...h.started];
  h.context.articleChatState.loading = false;
  await h.context.pumpArticleChatQueue();
  assert.deepEqual(beforeAck, []);
  assert.deepEqual(h.started, ['next']);
});

test('partial clear failure retains only turns that were not durably deleted', async () => {
  const h = harness([{ turnId: 'first', status: 'completed' },
    { turnId: 'second', status: 'completed' }]);
  const notifications = [];
  h.context.notifyArticleChatStateChanged = (...args) => notifications.push(args);
  h.context.deleteWorkspaceTurnCheckpoint = async turnId => {
    if (turnId === 'second') throw new Error('disk failure');
    return { deleted: true };
  };
  await assert.rejects(h.context.clearArticleChat(), /disk failure/);
  assert.deepEqual(Array.from(h.context.articleChatState.turns, turn => turn.turnId), ['second']);
  assert.equal(h.context.articleChatState.memoryNeedsRebuild, true);
  assert.equal(h.context.articleChatClearInFlight, false);
  assert.equal(notifications.some(([kind, , extra]) =>
    kind === 'turn_removed' && extra.turnId === 'first'), true);
});
