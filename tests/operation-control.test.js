const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createOperationRegistry,
  normalizeOperationId
} = require('../core/operation-control.js');

test('operation registry pauses at cooperative checkpoints and resumes', async () => {
  const registry = createOperationRegistry();
  const operation = registry.getOrCreate('figure:1');
  registry.pause('figure:1');
  let continued = false;
  const waiting = registry.waitIfPaused(operation).then(() => { continued = true; });
  await Promise.resolve();
  assert.equal(continued, false);
  registry.resume('figure:1');
  await waiting;
  assert.equal(continued, true);
});

test('operation registry cancellation aborts requests and paused waiters', async () => {
  const registry = createOperationRegistry();
  const operation = registry.getOrCreate('highlight:1');
  registry.pause('highlight:1');
  const waiting = registry.waitIfPaused(operation);
  registry.cancel('highlight:1');
  await assert.rejects(waiting, error => error.code === 'CANCELLED');
  assert.equal(operation.controller.signal.aborted, true);
  assert.throws(() => registry.throwIfCancelled(operation), error => error.code === 'CANCELLED');
});

test('operation ids are bounded to safe registry keys', () => {
  assert.equal(normalizeOperationId('  figure / unsafe?  '), 'figureunsafe');
  assert.equal(normalizeOperationId('x'.repeat(140)).length, 100);
});

test('begin creates exact epochs and replaces an old normalized-id run', () => {
  const registry = createOperationRegistry();
  const first = registry.begin(' figure / unsafe? ');
  const captured = registry.capture(first);
  const second = registry.begin('figureunsafe');

  assert.equal(first.operationId, 'figureunsafe');
  assert.equal(first.epoch, 1);
  assert.equal(second.epoch, 2);
  assert.notEqual(first.controller, second.controller);
  assert.equal(first.controller.signal.aborted, true);
  assert.equal(registry.isActive(captured), false);
  assert.throws(() => registry.assertActive(captured), error => error.code === 'STALE_OPERATION');
  assert.equal(registry.isActive(registry.capture(second)), true);
});

test('begin can restore a validated durable epoch and advances from it', () => {
  const registry = createOperationRegistry();
  const restored = registry.begin({ operationId: 'paper:durable', epoch: 7 });
  assert.equal(restored.epoch, 7);
  const replacement = registry.begin('paper:durable');
  assert.equal(replacement.epoch, 8);
  assert.equal(restored.controller.signal.aborted, true);
});

test('cancel synchronously advances cancellation generation and aborts before returning', () => {
  const registry = createOperationRegistry();
  const operation = registry.begin('mechanism:cancel-race');
  const captured = registry.capture(operation);
  const before = captured.cancelGeneration;
  const result = registry.cancel(operation.operationId);

  assert.equal(operation.controller.signal.aborted, true);
  assert.equal(result.cancelGeneration, before + 1);
  assert.equal(result.cancelled, true);
  assert.equal(registry.isActive(captured), false);
  assert.throws(() => registry.assertActive(captured), error => error.code === 'CANCELLED');
});

test('capture and snapshots are exact bounded frozen data', () => {
  const registry = createOperationRegistry();
  const operation = registry.begin('mechanism:frozen');
  const capture = registry.capture(operation);
  const state = registry.snapshot(operation);

  assert.deepEqual(Object.keys(capture).sort(), [
    'cancelGeneration', 'epoch', 'operationId'
  ]);
  assert.equal(Object.isFrozen(capture), true);
  assert.equal(Object.isFrozen(state), true);
  assert.equal('controller' in state, false);
});

test('an old capture cannot cancel or release a replacement epoch', () => {
  const registry = createOperationRegistry();
  const oldRun = registry.begin('mechanism:aba');
  const oldCapture = registry.capture(oldRun);
  const replacement = registry.begin('mechanism:aba');

  assert.throws(() => registry.cancel(oldCapture), error => error.code === 'STALE_OPERATION');
  assert.equal(replacement.controller.signal.aborted, false);
  assert.throws(() => registry.release(oldCapture), error => error.code === 'STALE_OPERATION');
  assert.equal(registry.isActive(registry.capture(replacement)), true);
});

test('inactive registry history is bounded without allowing an evicted ABA capture', () => {
  const registry = createOperationRegistry({ maxHistoryEntries: 2 });
  const first = registry.begin('mechanism:history-a');
  const stale = registry.capture(first);
  registry.release(first);
  const high = registry.begin({ operationId: 'mechanism:history-b', epoch: 9 });
  registry.release(high);
  registry.release(registry.begin('mechanism:history-c'));
  registry.release(registry.begin('mechanism:history-d'));

  const replacement = registry.begin('mechanism:history-a');
  assert.equal(replacement.epoch, 10);
  assert.throws(() => registry.assertActive(stale), error => error.code === 'STALE_OPERATION');
  assert.throws(() => registry.cancel(stale), error => error.code === 'STALE_OPERATION');

  const activeRegistry = createOperationRegistry({ maxHistoryEntries: 2 });
  const evictedActive = activeRegistry.begin('mechanism:active-a');
  activeRegistry.begin('mechanism:active-b');
  const newestActive = activeRegistry.begin('mechanism:active-c');
  assert.equal(evictedActive.controller.signal.aborted, true);
  assert.throws(
    () => activeRegistry.assertActive(activeRegistry.capture(evictedActive)),
    error => error.code === 'STALE_OPERATION'
  );
  assert.equal(activeRegistry.isActive(activeRegistry.capture(newestActive)), true);
});

test('an explicit retired epoch cannot revive the exact token after history eviction', () => {
  const registry = createOperationRegistry({ maxHistoryEntries: 2 });
  const first = registry.begin('mechanism:retired-explicit');
  const retiredCapture = registry.capture(first);
  const retained = registry.begin('mechanism:retired-b');
  registry.begin('mechanism:retired-c');

  const revived = registry.begin({
    operationId: retiredCapture.operationId,
    epoch: retiredCapture.epoch,
    cancelGeneration: retiredCapture.cancelGeneration
  });
  assert.equal(revived, null);
  assert.equal(retained.controller.signal.aborted, false);
  assert.equal(registry.isActive(registry.capture(retained)), true);
  assert.equal(registry.isActive(retiredCapture), false);
  assert.throws(() => registry.cancel(retiredCapture), error => error.code === 'STALE_OPERATION');
});

test('a private durable authority restores an unrelated low epoch after global retirement', () => {
  const durableAuthority = Object.freeze({});
  const registry = createOperationRegistry({
    maxHistoryEntries: 2,
    durableRestoreAuthority: durableAuthority
  });
  registry.release(registry.begin({ operationId: 'mechanism:floor', epoch: 9 }));
  registry.release(registry.begin('mechanism:filler-a'));
  registry.release(registry.begin('mechanism:filler-b'));

  assert.equal(registry.begin({
    operationId: 'mechanism:durable-low', epoch: 1, cancelGeneration: 0
  }, Object.freeze({})), null);
  const restored = registry.begin({
    operationId: 'mechanism:durable-low', epoch: 1, cancelGeneration: 0
  }, durableAuthority);
  assert.equal(restored.epoch, 1);
  assert.equal(restored.cancelGeneration, 0);
});

test('durable authority cannot revive an exact token after retire or release', () => {
  for (const terminal of ['retire', 'release']) {
    const durableAuthority = Object.freeze({});
    const registry = createOperationRegistry({ durableRestoreAuthority: durableAuthority });
    const operation = registry.begin({
      operationId: `mechanism:authority-${terminal}`,
      epoch: 7,
      cancelGeneration: 3
    }, durableAuthority);
    const stale = registry.capture(operation);
    registry[terminal](operation);

    const revived = registry.begin({
      operationId: stale.operationId,
      epoch: stale.epoch,
      cancelGeneration: stale.cancelGeneration
    }, durableAuthority);
    assert.equal(revived, null);
    assert.equal(registry.isActive(stale), false);
    assert.throws(() => registry.cancel(stale), error => error.code === 'STALE_OPERATION');
  }
});

test('durable restore authority rejects reconstructable tokens without reflecting hostile objects', () => {
  const seedRetiredFloor = registry => {
    registry.release(registry.begin({ operationId: 'mechanism:authority-floor', epoch: 9 }));
    registry.release(registry.begin('mechanism:authority-filler-a'));
    registry.release(registry.begin('mechanism:authority-filler-b'));
  };
  for (const reconstructable of [
    'public', 7, true, 7n, Symbol.for('mechanism-public-authority')
  ]) {
    const registry = createOperationRegistry({
      maxHistoryEntries: 2,
      durableRestoreAuthority: reconstructable
    });
    seedRetiredFloor(registry);
    assert.equal(registry.begin({
      operationId: 'mechanism:authority-low', epoch: 1, cancelGeneration: 0
    }, reconstructable), null);
  }

  let reflected = 0;
  const hostileAuthority = new Proxy({}, {
    getPrototypeOf() { reflected += 1; throw new Error('SECRET_AUTHORITY'); },
    getOwnPropertyDescriptor() { reflected += 1; throw new Error('SECRET_AUTHORITY'); },
    ownKeys() { reflected += 1; throw new Error('SECRET_AUTHORITY'); }
  });
  const registry = createOperationRegistry({
    maxHistoryEntries: 2,
    durableRestoreAuthority: hostileAuthority
  });
  seedRetiredFloor(registry);
  const restored = registry.begin({
    operationId: 'mechanism:authority-hostile', epoch: 1, cancelGeneration: 0
  }, hostileAuthority);
  assert.equal(restored.epoch, 1);
  assert.equal(reflected, 0);

  const privateSymbol = Symbol('mechanism-private-authority');
  const symbolRegistry = createOperationRegistry({
    maxHistoryEntries: 2,
    durableRestoreAuthority: privateSymbol
  });
  seedRetiredFloor(symbolRegistry);
  assert.equal(symbolRegistry.begin({
    operationId: 'mechanism:authority-symbol', epoch: 1, cancelGeneration: 0
  }, privateSymbol).epoch, 1);
});
