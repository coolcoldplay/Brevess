const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.join(__dirname, '..', 'core', 'service-worker-keepalive.js');

test('keeps a service worker alive only until the long operation settles', async () => {
  assert.equal(fs.existsSync(modulePath), true, 'service worker keepalive module must exist');
  const { keepAliveUntil } = require(modulePath);
  let heartbeat;
  let clearedId;
  let platformCalls = 0;
  let resolveOperation;
  const operation = new Promise(resolve => { resolveOperation = resolve; });
  const chromeApi = {
    runtime: {
      async getPlatformInfo() {
        platformCalls += 1;
      }
    }
  };

  const wrapped = keepAliveUntil(operation, chromeApi, {
    intervalMs: 25000,
    setIntervalImpl(callback, intervalMs) {
      assert.equal(intervalMs, 25000);
      heartbeat = callback;
      return 17;
    },
    clearIntervalImpl(intervalId) {
      clearedId = intervalId;
    }
  });

  await heartbeat();
  await heartbeat();
  assert.equal(platformCalls, 2);
  resolveOperation('done');
  assert.equal(await wrapped, 'done');
  assert.equal(clearedId, 17);
});

test('clears the heartbeat and preserves a long operation failure', async () => {
  assert.equal(fs.existsSync(modulePath), true, 'service worker keepalive module must exist');
  const { keepAliveUntil } = require(modulePath);
  let cleared = false;
  const expected = new Error('provider failed');

  await assert.rejects(
    keepAliveUntil(Promise.reject(expected), { runtime: { getPlatformInfo() {} } }, {
      setIntervalImpl() { return 23; },
      clearIntervalImpl(intervalId) {
        assert.equal(intervalId, 23);
        cleared = true;
      }
    }),
    error => error === expected
  );
  assert.equal(cleared, true);
});
