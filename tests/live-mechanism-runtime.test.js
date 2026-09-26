const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = import('../scripts/verify-live-mechanism-extension.mjs');

test('CLI accepts an explicit mechanism model and a bounded total runtime', async () => {
  const { parseArguments, resolveRuntimeOptions } = await runtime;
  const args = parseArguments(['--model', 'deepseek-flash', '--deadline-ms', '120000']);
  assert.deepEqual(resolveRuntimeOptions(args, [{ requestBody: { model: 'deepseek-v4-flash' } }]), {
    model: 'deepseek-flash', figureReplayModel: 'deepseek-v4-flash', deadlineMs: 120000
  });
});

test('invalid models and non-bounded deadlines fail before browser or credentials', async () => {
  const { resolveRuntimeOptions } = await runtime;
  for (const model of ['', 'https://example.test', 'DS · deepseek-flash', 'sk-secret', 'a\nb']) {
    assert.throws(() => resolveRuntimeOptions({ model }), error => error.code === 'LIVE_MECHANISM_MODEL_INVALID');
  }
  for (const deadlineMs of ['0', '-1', 'Infinity', 'NaN', '1000.5', '3600001']) {
    assert.throws(() => resolveRuntimeOptions({ deadlineMs }), error => error.code === 'LIVE_MECHANISM_DEADLINE_INVALID');
  }
});

test('saved Figure model is separate and mechanism replay cannot silently change model', async () => {
  const { resolveRuntimeOptions } = await runtime;
  assert.throws(() => resolveRuntimeOptions({}, [
    { requestBody: { model: 'deepseek-flash' } }, { requestBody: { model: 'different' } }
  ]), error => error.code === 'LIVE_MECHANISM_FIGURE_MODELS_MISMATCH');
  assert.throws(() => resolveRuntimeOptions({ model: 'deepseek-flash' }, [], [
    { requestBody: { model: 'deepseek-v4-flash' } }
  ]), error => error.code === 'LIVE_MECHANISM_REPLAY_MODEL_MISMATCH');
  assert.equal(resolveRuntimeOptions({}).model, 'deepseek-v4-flash');
});

test('deadline rejects stalled work, aborts its signal and prevents subsequent work', async () => {
  const { createRunDeadline } = await runtime;
  const budget = createRunDeadline(25);
  let aborted = false;
  budget.signal.addEventListener('abort', () => { aborted = true; }, { once: true });
  try {
    await assert.rejects(budget.run(() => new Promise(() => {})), error =>
      error.code === 'LIVE_MECHANISM_DEADLINE_EXCEEDED');
    assert.equal(aborted, true);
    assert.equal(budget.remainingMs(), 0);
    let invoked = false;
    await assert.rejects(budget.run(() => { invoked = true; }), error =>
      error.code === 'LIVE_MECHANISM_DEADLINE_EXCEEDED');
    assert.equal(invoked, false);
  } finally { budget.dispose(); }
});

test('finished work clears its deadline without a late abort or shared mutable model', async () => {
  const { createRunDeadline, deepSeekFixtureEnvelope } = await runtime;
  const budget = createRunDeadline(20);
  assert.equal(await budget.run(() => 42), 42);
  budget.dispose();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(budget.signal.aborted, false);
  assert.equal(JSON.parse(deepSeekFixtureEnvelope({}, 1, 'deepseek-flash')).model, 'deepseek-flash');
  assert.equal(JSON.parse(deepSeekFixtureEnvelope({}, 2)).model, 'deepseek-v4-flash');
});

test('Windows temporary-file cleanup failure preserves the original timeout outcome', async () => {
  const { finalizeRunCleanup } = await runtime;
  const report = { errorCode: 'LIVE_MECHANISM_DEADLINE_EXCEEDED', outcome: { status: 'FAIL' } };
  assert.doesNotThrow(() => finalizeRunCleanup(report, true, 'temporary-profile', 'temporary-extension',
    () => { throw Object.assign(new Error('locked file'), { code: 'EPERM' }); }));
  assert.equal(report.errorCode, 'LIVE_MECHANISM_DEADLINE_EXCEEDED');
  assert.equal(report.cleanupStatus, 'closed-temporary-files-retained');
  assert.equal(report.cleanupErrorCode, 'EPERM');
  assert.deepEqual(report.retainedTemporaryPaths, {
    profile: 'temporary-profile', extension: 'temporary-extension'
  });
});
