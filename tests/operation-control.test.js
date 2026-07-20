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
