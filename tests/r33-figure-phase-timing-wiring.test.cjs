'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { functionSource } = require('./helpers/r28-full07-source.js');
const { harness: bindingHarness } = require('./helpers/r29-figure-binding-harness.js');
const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const load = (name, context) => vm.runInContext(functionSource(source, name), context);
const timings = context => Array.from(context.readContentRuntimeDiagnostics()).filter(row => row.timing);
const wire = () => { const h = bindingHarness(); load('observeFigureRuntimePhase', h.c); return h; };

test('R33 inner acquisition deadline aborts the live request even before the outer abort timer fires', async () => {
  let clock = 1000, requestSignal;
  const timers = [];
  class Clock extends Date { static now() { return clock; } }
  const c = vm.createContext({ Date: Clock, URL, AbortController, Promise,
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 1000, FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    document: { baseURI: 'https://fixture.invalid/article', location: { href: 'https://fixture.invalid/article' } },
    setTimeout: (callback, delay) => { timers.push({ callback, delay, cleared: false }); return timers.length; },
    clearTimeout: id => { timers[id - 1].cleared = true; },
    fetch: (_url, options) => { requestSignal = options.signal; return new Promise(() => {}); }
  });
  for (const name of ['figureImageError', 'figureImageTimeoutError', 'fetchFigureImage']) load(name, c);
  const pending = c.fetchFigureImage('https://fixture.invalid/image.jpg', 90);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(timers.length, 2, 'outer abort timer and inner deadline race are pending');
  assert.equal(requestSignal.aborted, false);
  clock = 1090;
  timers[1].callback(); // Deterministically settle the inner race first.
  await assert.rejects(pending, { code: 'FIGURE_IMAGE_TIMEOUT' });
  assert.equal(timers[0].cleared, true, 'finally clears the outer timer before it can fire');
  assert.equal(requestSignal.aborted, true, 'deadline rejection must still cancel the in-flight request');
});

test('R33 actual preparation, guard, provider roundtrip and inventory save expose phase observations', async () => {
  const h = wire();
  await h.start();
  const reply = { success: true, data: { marker: 'same-reply' } };
  assert.equal(await h.c.sendFigureAnalysisRequestWithReceipt({ type: 'LLM_ANALYZE_FIGURES',
    figureRequestReceipt: 'figure-request-r33-timing0001', analysisDepth: 'deep', figures: [h.state.figure] },
  h.operation, { sendMessage: async () => reply }), reply);
  assert.equal((await h.checkpoint()).success, true);
  const phases = timings(h.c).map(row => row.timing.phase);
  for (const phase of ['prepare', 'guard', 'provider', 'save']) assert.ok(phases.includes(phase), phase);
  assert.ok(timings(h.c).every(row => row.identity.operationId === h.operation.operationId));
});

for (const cancelled of [false, true]) {
  test(`R33 actual provider observer preserves the original ${cancelled ? 'cancel' : 'failure'} exception`, async () => {
    const h = wire(), original = Object.assign(new Error('PRIVATE_PROVIDER_BODY'), { code: cancelled ? 'CANCELLED' : 'PROVIDER_FAILED' });
    await assert.rejects(h.c.sendFigureAnalysisRequestWithReceipt({ type: 'LLM_ANALYZE_FIGURES',
      figureRequestReceipt: 'figure-request-r33-timing0002', analysisDepth: 'deep', figures: [h.state.figure] },
    h.operation, { sendMessage: async () => { throw original; } }), error => error === original);
    const row = timings(h.c).find(item => item.timing.phase === 'provider');
    assert.equal(row.timing.outcome, cancelled ? 'cancelled' : 'error');
    assert.doesNotMatch(JSON.stringify(row), /PRIVATE_PROVIDER_BODY/);
  });
}

test('R33 actual observed guard still rejects changed source pixels', async () => {
  const h = wire(); await h.start(); h.changePixels();
  await assert.rejects(h.c.verifyLiveFigureRetryInput(h.state, h.state.figureInputHash, h.admission, 'figure_walkthrough'),
    { code: 'FIGURE_PANEL_RETRY_SCOPE_STALE' });
  assert.equal(timings(h.c).filter(row => row.timing.phase === 'guard').at(-1).timing.outcome, 'error');
});

test('R33 actual guarded save records durable readback timing without retaining saved content', async () => {
  let sequence = 0;
  const c = vm.createContext({ Date, Map, Set, WeakMap, Promise,
    articleWorkspaceLifecycleGeneration: 2, currentArticleWorkspace: { workspaceId: 'workspace-a', workspaceGeneration: 1 },
    figureOperationState: { active: { operationId: 'op-r33-readback', figureId: 'figure-1', generation: 3 } },
    articleWorkspaceSaveFrozen: false, articleWorkspaceRestorePersistenceGate: { allows: () => false, consume: () => false },
    articleWorkspaceAssetFingerprint: () => 'fingerprint', articleWorkspaceAssetFingerprints: new Map(), articleWorkspaceMutationTail: Promise.resolve(),
    ensureCurrentArticleWorkspace: async () => ({ workspaceId: 'workspace-a', workspaceGeneration: 1 }), assertCurrentArticleWorkspaceLifecycle() {},
    issueFigureWorkspaceCommitGuard: () => `figure-retry-guard-r33${++sequence}abcd`, revokeFigureWorkspaceCommitGuard() {},
    chrome: { runtime: { sendMessage: async message => {
      if (message.type === 'ARTICLE_WORKSPACE_SAVE_ASSET') return { success: true, data: { staged: true,
        stagingPath: 'internal/figure-retry-staging/figure-retry-guard-r331abcd.json', stagingRevision: 1, stagingContentHash: 'a'.repeat(64) } };
      if (message.type === 'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET') return { success: true, data: { promoted: true, asset: { revision: 2, contentHash: 'b'.repeat(64) } } };
      if (message.type === 'ARTICLE_WORKSPACE_FINALIZE_STAGED_ASSET') return { success: true, data: { saved: true, confirmed: true, asset: { revision: 2, contentHash: 'b'.repeat(64) } } };
      if (message.type === 'ARTICLE_WORKSPACE_GET_ASSET') return { success: true, data: { found: true, workspaceGeneration: 1,
        asset: { revision: 2, contentHash: 'b'.repeat(64), content: { privateNote: 'PRIVATE_BODY' } } } };
      throw new Error('unexpected message');
    } } }
  });
  for (const name of ['recordContentRuntimeDiagnostic', 'readContentRuntimeDiagnostics',
    'observeFigureRuntimePhase', 'persistWorkspaceAssetCheckpoint']) load(name, c);
  const result = await c.persistWorkspaceAssetCheckpoint('figures/workspace-draft.json', { privateNote: 'PRIVATE_BODY' },
    { force: true, commitGuard: () => true });
  assert.equal(result.saved, true);
  assert.equal(result.readbackConfirmed, true);
  const row = timings(c).find(item => item.timing.phase === 'readback');
  assert.equal(row.timing.outcome, 'success');
  assert.equal(row.identity.operationId, 'op-r33-readback');
  assert.doesNotMatch(JSON.stringify(c.readContentRuntimeDiagnostics()), /PRIVATE_BODY|privateNote/);
});
