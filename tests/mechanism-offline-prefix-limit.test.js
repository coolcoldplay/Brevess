const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('source-bound offline prefix can preserve 55 captures without increasing live-call budget', async t => {
  const { loadMechanismReplayEntries, mechanismCallCapConsumed } =
    await import('../scripts/verify-live-mechanism-extension.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-prefix-limit-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('brevess-prefix-limit-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const calls = Array.from({ length: 96 }, (_, i) => ({ sequence: i + 1,
    request: { stage: 'panel_evidence_extraction' }, status: 200 }));
  for (const call of calls) {
    const suffix = String(call.sequence).padStart(3, '0');
    fs.writeFileSync(path.join(dir, `mechanism-request-${suffix}-redacted.json`), JSON.stringify({
      model: 'synthetic', stream: false, messages: [{ role: 'user', content: JSON.stringify({
        stage: 'panel_evidence_extraction', untrusted_panel_evidence: [] }) }] }));
    fs.writeFileSync(path.join(dir, `mechanism-response-${suffix}-redacted.json`), '{"synthetic":true}');
  }
  const write = entries => fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ mechanismProviderCalls: entries }));
  write(calls.slice(0, 55));
  assert.throws(() => loadMechanismReplayEntries(dir), /LIVE_MECHANISM_REPLAY_INVALID/);
  assert.equal(loadMechanismReplayEntries(dir, { maxEntries: 96 }).length, 55);
  assert.equal(mechanismCallCapConsumed({ mechanismReplayCalls: 55, mechanismRealApiCalls: 2, mechanismFixtureCalls: 0 }, true), 2);
  write(calls);
  assert.equal(loadMechanismReplayEntries(dir, { maxEntries: 96 }).length, 96);
  write([...calls, { ...calls[0], sequence: 97 }]);
  assert.throws(() => loadMechanismReplayEntries(dir, { maxEntries: 96 }), /LIVE_MECHANISM_REPLAY_INVALID/);
  for (const maxEntries of [0, 97, Infinity, 1.5]) {
    assert.throws(() => loadMechanismReplayEntries(dir, { maxEntries }), /LIVE_MECHANISM_REPLAY_INVALID/);
  }
  write(calls.slice(0, 55));
  fs.unlinkSync(path.join(dir, 'mechanism-response-055-redacted.json'));
  assert.throws(() => loadMechanismReplayEntries(dir, { maxEntries: 96 }), /LIVE_MECHANISM_REPLAY_INVALID/);
});
