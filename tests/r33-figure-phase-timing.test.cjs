'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./helpers/r28-full07-source.js');
const source = fs.readFileSync(path.resolve(__dirname, '../content.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const phases = ['fetch', 'cache', 'decode', 'encode', 'prepare', 'guard', 'provider', 'save', 'readback'];

function harness({ helper = true } = {}) {
  let clock = 0;
  const context = vm.createContext({ Date, Map, Set, WeakMap, performance: { now: () => clock } });
  for (const name of ['recordContentRuntimeDiagnostic', 'readContentRuntimeDiagnostics']) {
    vm.runInContext(functionSource(source, name), context);
  }
  if (helper) vm.runInContext(functionSource(source, 'observeFigureRuntimePhase'), context);
  return { c: context, advance: ms => { clock += ms; },
    rows: () => plain(context.readContentRuntimeDiagnostics()),
    observe: (phase, task, identity) => context.observeFigureRuntimePhase(phase, task, identity) };
}

for (const phase of phases) {
  test(`R33 timing diagnostics retain bounded ${phase} duration with explicit inclusive scope`, () => {
    const h = harness({ helper: false });
    h.c.recordContentRuntimeDiagnostic('figure.phase', {
      identity: { operationId: 'op-r33', figureId: 'figure-1' },
      timing: { phase, elapsedMs: 12.5, spanId: 2, parentSpanId: 1, outcome: 'success', scope: 'inclusive',
        url: 'https://private.test/token=SECRET', caption: 'PRIVATE_CAPTION', body: 'PRIVATE_BODY', apiKey: 'SECRET' }
    });
    assert.deepEqual(h.rows()[0].timing,
      { phase, elapsedMs: 12.5, spanId: 2, parentSpanId: 1, outcome: 'success', scope: 'inclusive' });
    assert.doesNotMatch(JSON.stringify(h.rows()), /private|PRIVATE|SECRET|apiKey|caption|body|url/);
  });
}

test('R33 timing projection omits invalid durations, phases and free-form outcome strings', () => {
  const h = harness({ helper: false });
  for (const timing of [
    { phase: 'fetch', elapsedMs: NaN }, { phase: 'fetch', elapsedMs: Infinity },
    { phase: 'fetch', elapsedMs: -1 }, { phase: 'fetch', elapsedMs: 86400001 },
    { phase: 'https://private.test/SECRET', elapsedMs: 1 },
    { phase: 'provider', elapsedMs: 1, outcome: 'PRIVATE_SECRET' }
  ]) {
    h.c.recordContentRuntimeDiagnostic('figure.phase', { timing });
    assert.equal(h.rows().at(-1).timing, undefined);
  }
});

test('R33 timing events reuse the existing 256-entry ring and detached snapshot contract', () => {
  const h = harness({ helper: false });
  for (let n = 1; n <= 300; n++) h.c.recordContentRuntimeDiagnostic('figure.phase', {
    timing: { phase: 'fetch', elapsedMs: n, spanId: n, parentSpanId: 0, outcome: 'success', scope: 'inclusive' }
  });
  const rows = h.rows();
  assert.equal(rows.length, 256);
  assert.equal(rows.at(-1).timing.elapsedMs, 300);
  rows[0].timing.elapsedMs = 999;
  assert.equal(h.rows()[0].timing.elapsedMs, 45);
});

test('R33 phase observation returns the original successful value and invokes work exactly once', async () => {
  const h = harness(), value = { object: 'same-reference', body: 'PRIVATE_BODY', apiKey: 'SECRET' };
  let calls = 0;
  const actual = await h.observe('prepare', async () => { calls++; h.advance(17); return value; },
    { operationId: 'op-r33', figureId: 'figure-1', url: 'https://private.test/SECRET' });
  assert.equal(actual, value);
  assert.equal(calls, 1);
  assert.equal(h.rows()[0].timing.elapsedMs, 17);
  assert.equal(h.rows()[0].timing.outcome, 'success');
  assert.doesNotMatch(JSON.stringify(h.rows()), /PRIVATE|SECRET|apiKey|body|private/);
});

for (const cancelled of [false, true]) {
  test(`R33 phase observation records ${cancelled ? 'cancellation' : 'failure'} and rethrows the original error`, async () => {
    const h = harness(), error = Object.assign(new Error('PRIVATE_BODY SECRET'), { code: cancelled ? 'CANCELLED' : 'PROVIDER_ERROR' });
    await assert.rejects(h.observe('provider', async () => { h.advance(23); throw error; }), actual => actual === error);
    assert.equal(h.rows()[0].timing.elapsedMs, 23);
    assert.equal(h.rows()[0].timing.outcome, cancelled ? 'cancelled' : 'error');
    assert.doesNotMatch(JSON.stringify(h.rows()), /PRIVATE|SECRET|PROVIDER_ERROR/);
  });
}

test('R33 diagnostic failure cannot replace either a successful value or the original task error', async () => {
  const h = harness(), value = {}, original = new Error('original');
  h.c.recordContentRuntimeDiagnostic = () => { throw new Error('logging failed'); };
  assert.equal(await h.observe('save', () => value), value);
  assert.throws(() => h.observe('save', () => { throw original; }), error => error === original);
});

test('R33 hostile error metadata cannot replace the original task exception', async () => {
  const h = harness(), original = new Error('original');
  Object.defineProperty(original, 'code', { get() { throw new Error('metadata getter'); } });
  assert.throws(() => h.observe('guard', () => { h.advance(3); throw original; }), error => error === original);
  assert.equal(h.rows()[0].timing.outcome, 'error');
});

test('R33 a broken observation clock cannot prevent work or replace its exception', async () => {
  const h = harness(), value = {}, original = new Error('original');
  h.c.performance.now = () => { throw new Error('clock failed'); };
  assert.equal(await h.observe('fetch', () => value), value);
  assert.throws(() => h.observe('guard', () => { throw original; }), error => error === original);
});

test('R33 asynchronous observation preserves the original Promise identity', async () => {
  const h = harness(), value = {}, promise = Promise.resolve(value);
  assert.equal(h.observe('provider', () => promise), promise);
  assert.equal(await promise, value);
  assert.equal(h.rows()[0].timing.outcome, 'success');
});

test('R33 explicit parent spans distinguish nested inclusive work without adding elapsed durations', async () => {
  const h = harness();
  await h.observe('guard', async outer => {
    h.advance(2);
    await h.observe('prepare', async inner => {
      h.advance(3);
      await h.observe('fetch', () => { h.advance(5); }, { parentSpanId: inner.spanId });
    }, { parentSpanId: outer.spanId });
    h.advance(7);
  });
  const rows = h.rows(), byPhase = Object.fromEntries(rows.map(row => [row.timing.phase, row.timing]));
  assert.equal(byPhase.guard.elapsedMs, 17);
  assert.equal(byPhase.prepare.elapsedMs, 8);
  assert.equal(byPhase.fetch.elapsedMs, 5);
  assert.equal(byPhase.prepare.parentSpanId, byPhase.guard.spanId);
  assert.equal(byPhase.fetch.parentSpanId, byPhase.prepare.spanId);
  assert.ok(rows.every(row => row.timing.scope === 'inclusive'));
});

test('R33 concurrent sibling work cannot inherit another pending span as its parent', async () => {
  const h = harness();
  let finish;
  const first = h.observe('fetch', () => new Promise(resolve => { finish = resolve; }));
  await h.observe('provider', () => { h.advance(4); });
  finish(); await first;
  const rows = h.rows();
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.timing.parentSpanId === 0));
  assert.notEqual(rows[0].timing.spanId, rows[1].timing.spanId);
});

test('R33 getRuntimeDiagnostics keeps its sender gate and existing event surface', () => {
  const branch = source.slice(source.indexOf("request.action === 'getRuntimeDiagnostics'"),
    source.indexOf("request.action === 'confirmPdfFigureRuntimeInventory'"));
  assert.match(branch, /sender\?\.id === chrome\.runtime\.id/);
  assert.match(branch, /events: readContentRuntimeDiagnostics\(\)/);
  assert.match(branch, /figureStages:/);
  assert.match(branch, /RUNTIME_DIAGNOSTIC_SENDER_INVALID/);
});
