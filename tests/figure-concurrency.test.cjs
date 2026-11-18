'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFigureDispatchScheduler, runFigureBatchQueue } = require('../extension/core/figure-concurrency.js');

const deepseek = { providerId: 'deepseek' };
const compatible = { providerId: 'openai-compatible', config: { baseUrl: 'https://api.deepseek.com/v1' } };
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

function fakeClock() {
  let time = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimer(callback, delay) {
      const id = Symbol();
      timers.set(id, { callback, at: time + delay });
      return id;
    },
    clearTimer: id => timers.delete(id),
    advance(ms) {
      time += ms;
      for (const [id, timer] of timers) if (timer.at <= time) {
        timers.delete(id);
        timer.callback();
      }
    }
  };
}

async function validatedWave(scheduler, route, width) {
  const slots = await Promise.all(Array.from({ length: width }, () => scheduler.acquire(route)));
  for (const release of slots) release(true)?.();
}

test('one origin shares its limit across profiles and grants one growth credit per validated Figure', async () => {
  const clock = fakeClock();
  const pool = createFigureDispatchScheduler(clock);
  const [first, second] = await Promise.all([pool.acquire(deepseek), pool.acquire(compatible)]);
  let thirdStarted = false;
  const queued = pool.acquire(compatible).then(release => { thirdStarted = true; return release; });
  await nextTurn();
  assert.equal(thirdStarted, false);
  const firstCredit = first(true);
  const third = await queued;
  const secondCredit = second(true);
  assert.equal(pool.limit(deepseek), 2, 'transport completion alone cannot increase capacity');
  firstCredit();
  firstCredit();
  assert.equal(pool.limit(compatible), 2);
  secondCredit();
  assert.equal(pool.limit(compatible), 3);
  third(true)?.();
  assert.equal(pool.limit(deepseek), 3, 'an older width cannot accumulate new growth credits');
  await validatedWave(pool, compatible, 3);
  await validatedWave(pool, deepseek, 4);
  assert.equal(pool.limit(deepseek), 4);
  assert.equal(pool.limit({ providerId: 'openai' }), 2);
  clock.advance(60000);
  assert.equal(pool.limit(compatible), 2, 'a fresh burst after inactivity probes again');
});

test('sequential work, uninvoked requests and discarded validation samples do not grow a lane', async () => {
  const pool = createFigureDispatchScheduler();
  for (let i = 0; i < 5; i++) (await pool.acquire(deepseek))(true)?.();
  const [cancelled, invalid] = await Promise.all([pool.acquire(deepseek), pool.acquire(deepseek)]);
  assert.equal(cancelled(), undefined);
  invalid({ code: 'INVALID_RESPONSE' }); // No Figure passed validation.
  assert.equal(pool.limit(deepseek), 2);
});

test('native agents and loopback endpoints stay within two concurrent requests', async () => {
  const pool = createFigureDispatchScheduler();
  for (const route of [{ providerId: 'codex-local' }, { providerId: 'deepseek-harness' },
    { providerId: 'openai-compatible', config: { baseUrl: 'https://127.0.0.1:8880/v1' } }]) {
    for (let i = 0; i < 4; i++) await validatedWave(pool, route, 2);
    assert.equal(pool.limit(route), 2);
  }
});

test('a late quota error halves the current width once per burst, honours Retry-After and cancels queued work', async () => {
  const clock = fakeClock(), pool = createFigureDispatchScheduler(clock);
  await validatedWave(pool, deepseek, 2);
  const [slow, otherSlow, fast] = await Promise.all([pool.acquire(deepseek), pool.acquire(deepseek), pool.acquire(deepseek)]);
  fast(true)();
  for (let i = 0; i < 2; i++) (await pool.acquire(deepseek))(true)();
  assert.equal(pool.limit(deepseek), 4);
  const oldSuccess = await pool.acquire(deepseek);
  slow({ status: 429, retryAfterMs: 3600 });
  otherSlow({ status: 503, retryAfterMs: 5200 });
  oldSuccess(true)?.();
  assert.equal(pool.limit(compatible), 2);
  const controller = new AbortController();
  const cancelled = pool.acquire(compatible, controller.signal);
  controller.abort();
  await assert.rejects(cancelled, { code: 'CANCELLED' });
  let started = false;
  const next = pool.acquire(compatible).then(release => { started = true; return release; });
  clock.advance(5199);
  await nextTurn();
  assert.equal(started, false);
  clock.advance(1);
  (await next)({ code: 'REQUEST_TIMEOUT' });
  assert.equal(pool.limit(deepseek), 1);
  clock.advance(1500);
  await validatedWave(pool, deepseek, 1);
  await validatedWave(pool, deepseek, 1);
  assert.equal(pool.limit(compatible), 2);
});

test('equal-cost Figure batches ramp to four without duplicating work or exceeding capacity', async () => {
  async function measure(max) {
    const pool = createFigureDispatchScheduler();
    const waiting = new Map(), finished = [];
    let peak = 0, waves = 0, done = false;
    const batch = runFigureBatchQueue(24, max, async index => {
      const release = await pool.acquire(deepseek);
      await new Promise(resolve => waiting.set(index, resolve));
      release(true)?.(); // One complete, validated Figure.
      finished.push(index);
      return pool.limit(deepseek);
    }, 0).then(() => { done = true; });
    await nextTurn();
    while (!done) {
      const wave = [...waiting.values()];
      waiting.clear();
      assert.ok(wave.length > 0 && waves < 24);
      peak = Math.max(peak, wave.length);
      waves++;
      wave.forEach(resolve => resolve());
      await nextTurn();
    }
    await batch;
    assert.deepEqual(finished.toSorted((a, b) => a - b), Array.from({ length: 24 }, (_, i) => i));
    return { peak, waves };
  }
  assert.deepEqual(await measure(2), { peak: 2, waves: 12 });
  assert.deepEqual(await measure(4), { peak: 4, waves: 7 });
  assert.deepEqual(await measure(1), { peak: 1, waves: 24 });
});

test('failure stops admission and joins outstanding Figures before releasing the batch', async () => {
  const started = [], settle = [];
  const batch = runFigureBatchQueue(8, 4, index => {
    started.push(index);
    return new Promise((resolve, reject) => settle.push({ resolve, reject }));
  }, 0);
  let ended = false;
  const rejected = assert.rejects(batch.finally(() => { ended = true; }), /fixture failure/);
  await nextTurn();
  settle[0].reject(new Error('fixture failure'));
  await nextTurn();
  assert.equal(ended, false);
  assert.deepEqual(started, [0, 1]);
  settle[1].resolve(4);
  await rejected;
  assert.deepEqual(started, [0, 1]);
});
