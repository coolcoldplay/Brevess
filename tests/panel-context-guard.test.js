const test = require('node:test');
const assert = require('node:assert/strict');

const {
  capturePanelContext,
  isCurrentPanelContext,
  guardPanelMutation
} = require('../core/panel-context-guard.js');

function context(tabId, key, sequence) {
  return { tabId, key, tabContextSequence: sequence, activated: true };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

test('deferred A to B success cannot mutate B panel state', async () => {
  const active = context(1, '1|A', 1);
  const captured = capturePanelContext(active, 4);
  const task = deferred();
  const writes = [];
  const pending = task.promise.then(guardPanelMutation(
    () => isCurrentPanelContext(active, captured, 4),
    value => writes.push(value)
  ));

  Object.assign(active, context(2, '2|B', 2));
  task.resolve('A success');
  await pending;
  assert.deepEqual(writes, []);
});

test('deferred A to B failure cannot render an error for B', async () => {
  const active = context(1, '1|A', 1);
  const captured = capturePanelContext(active, 8);
  const task = deferred();
  const errors = [];
  const pending = task.promise.catch(guardPanelMutation(
    () => isCurrentPanelContext(active, captured, 8),
    error => errors.push(error.message)
  ));

  Object.assign(active, context(2, '2|B', 2));
  task.reject(new Error('A failed'));
  await pending;
  assert.deepEqual(errors, []);
});

test('deferred A to B refresh and archive completions cannot pollute B', async () => {
  const active = context(1, '1|A', 1);
  const captured = capturePanelContext(active, 12);
  const refresh = deferred();
  const archive = deferred();
  const refreshed = [];
  const archived = [];
  const refreshDone = refresh.promise.then(guardPanelMutation(
    () => isCurrentPanelContext(active, captured, 12),
    value => refreshed.push(value)
  ));
  const archiveDone = archive.promise.then(guardPanelMutation(
    () => isCurrentPanelContext(active, captured, 12),
    value => archived.push(value)
  ));

  Object.assign(active, context(2, '2|B', 2));
  refresh.resolve('A refresh');
  archive.resolve('A archive');
  await Promise.all([refreshDone, archiveDone]);
  assert.deepEqual(refreshed, []);
  assert.deepEqual(archived, []);
});
