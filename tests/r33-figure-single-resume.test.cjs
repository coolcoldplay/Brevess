'use strict';
// Real popup -> content listener -> single workflow -> receipt sender -> router.
// Only browser/asset/storage boundaries are synthetic; never uses user storage or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { functionSource } = require('./helpers/r28-full07-source.js');
const H = require('../output/r32-20261014/zero-model/resume/fixture.cjs');
const popup = fs.readFileSync(require.resolve('../popup.js'), 'utf8').replace(/\r\n/g, '\n');
const content = fs.readFileSync(require.resolve('../content.js'), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));
const uiOwner = { contextId: 'synthetic-side-panel', contextType: 'SIDE_PANEL' };
const uiSender = { trustedExtensionSender: true, senderExtensionId: 'extension-id',
  senderUrl: 'chrome-extension://extension-id/popup.html', runtimeBaseUrl: 'chrome-extension://extension-id/' };

// Seed and continuation use the same declared Panel, article, assets and plan.
// Every checkpoint is generated/signed by the real router, never handcrafted.
async function setup(options) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true,
    value: { locks: { request: async (_name, callback) => callback() } } });
  const storageArea = H.createMemoryStorage(), sessionStorageArea = H.createMemoryStorage();
  const calls = [], checkpoints = [], progress = [], seedResponses = [];
  let phase = 'seed', tailResponseLost = false, sealFailureArmed = false, sealWriteFailed = false;
  const saveStorage = storageArea.set;
  storageArea.set = (value, callback) => {
    if (sealFailureArmed && !sealWriteFailed && value.sciFigureLogicalRequestLedgerV1) {
      sealWriteFailed = true;
      throw Error('SYNTHETIC_CHECKPOINT_SEAL_WRITE_FAILURE');
    }
    return saveStorage(value, callback);
  };
  const figureInput = number => ({ ...H.figureInput(number),
    panelHints: options.checkpoint && number === 1 ? [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'] : ['A'] });
  const router = H.createBackgroundRouter({ storageArea, sessionStorageArea,
    runtimeExtensionId: 'extension-id', nowImpl: () => 100000, sleepImpl: async () => {},
    fetchImpl: async (_url, request) => {
      const input = JSON.parse(JSON.parse(request.body).messages[1].content);
      calls.push({ phase, figureId: input.figure_id, pass: input.pass });
      if (phase === 'seed' && options.checkpointSealFailure && input.pass === 'panel_extraction' &&
          input.expected_panel_labels?.join('') === 'YZ' && !tailResponseLost) {
        tailResponseLost = true;
        throw new TypeError('SYNTHETIC_LAST_EXTRACTION_LOST_RESPONSE');
      }
      if (phase === 'seed' && !(input.figure_id === 'figure-1' &&
          (options.responded || options.checkpoint && input.pass === 'panel_extraction'))) {
        throw new TypeError('SYNTHETIC_LOST_RESPONSE');
      }
      const output = H.figurePassOutput(input);
      if (input.pass === 'figure_synthesis') {
        Object.assign(output, { figure_title_zh: '', remaining_question_zh: '' });
        for (const group of output.panel_groups) group.upstream_context_zh = '';
      }
      return H.jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] });
    } });
  assert.equal((await router.handle({ type: 'LLM_SAVE_PROVIDER', providerId: 'deepseek',
    config: { apiKey: 'synthetic-single-resume-only', model: 'deepseek-v4-pro' } })).success, true);
  assert.equal((await router.handle({ type: 'LLM_UPDATE_PREFERENCES', preferences: {
    mode: 'llm', providerId: 'deepseek', consentGranted: true } })).success, true);
  const owner = { ...H.figureCheckpointContext(progress, checkpoints), trustedExtensionSender: true,
    senderExtensionId: 'extension-id', senderTabId: 82, senderFrameId: 0,
    senderDocumentId: '82828282-8282-4282-8282-828282828282', senderUrl: 'https://example.org/single-paper' };
  const saveCheckpoint = owner.onFigureCheckpoint;
  owner.onFigureCheckpoint = async value => {
    if (phase === 'seed' && options.responded && value.figureId === 'figure-1')
      throw new Error('SYNTHETIC_CHECKPOINT_WRITE_FAILED');
    const receipt = await saveCheckpoint(value);
    if (phase === 'seed' && options.checkpointSealFailure && value.figureId === 'figure-1' &&
        value.figureResult?.panels?.length === 26) sealFailureArmed = true;
    return receipt;
  };
  owner.onProgress = value => {
    progress.push(plain(value));
    if (value.visionConfirmation) void router.handle({ type: 'LLM_CONTROL_OPERATION',
      command: 'figure-vision-decision', operationId: value.visionConfirmation.operationId,
      tabId: owner.senderTabId, visionDecisionId: value.visionConfirmation.id,
      choice: 'continue_text' }, uiSender);
  };
  const binding = { tabId: 82, documentIdentity: owner.senderDocumentId,
    navigationIdentity: owner.senderUrl, documentHash: 'single-test-document', workspaceLifecycle: 82,
    figureIds: ['figure-1', 'figure-2'] };
  const plan = binding.figureIds.map((figureId, index) => ({ figureId, panelCount: figureInput(index + 1).panelHints.length }));
  if (!options.noPending) for (const number of [1, 2]) {
    const response = await router.handle(H.figureMessage([figureInput(number)], {
      analysisDepth: 'standard', operationScope: 'figure', workspaceLifecycle: 82,
      operationId: 'single-seed-operation', figureRequestReceipt: `figure-request-single-seed-${number}-12345678`,
      figureOperationPlan: plan, forceRefresh: true }), owner);
    assert.equal(response.success, false, JSON.stringify(response));
    seedResponses.push(response);
  }
  phase = 'resume';
  return { router, owner, binding, plan, figureInput, calls, checkpoints, progress,
    storageArea, sessionStorageArea, seedResponses, get sealWriteFailed() { return sealWriteFailed; } };
}

async function harness(options = {}) {
  const f = await setup(options);
  const figure = f.figureInput(1);
  const state = { figure, figureInputHash: 'r29-evidence-v8:12345678', standardError: 'prior unknown',
    pendingResults: {}, pendingResumeCheckpoints: {}, manualEdits: { standard: { title: '人工名称' } } };
  if (options.completed) { state.standard = { figureId: 'figure-1', analysisDepth: 'standard',
    figureQuestion: '实验问题', coreConclusion: '实验结论', panels: [{ panel: 'A', purpose: '实验目的' }] }; state.standardError = ''; }
  if (options.checkpoint) {
    const checkpoint = f.checkpoints.filter(value => value.checkpointEnvelope?.figureId === 'figure-1').at(-1)?.checkpointEnvelope;
    assert.ok(checkpoint, 'real seed must emit a signed checkpoint: ' + JSON.stringify({ responses: f.seedResponses,
      calls: f.calls, checkpoints: f.checkpoints }));
    state.pendingResumeCheckpoints.standard = plain(checkpoint);
  }
  const events = [], controls = [], messages = [], payloads = [], responses = [], beginOptions = [];
  let stopped = false, current = true, activeOperation;
  const c = vm.createContext({ console, structuredClone, Map, Set, Date, setTimeout, clearTimeout,
    figureTerminalSourceReceipts: new Map(),
    SciLLM: { ...globalThis.SciLLM, ...require('../core/figure-result-binding.js') },
    articleWorkspaceLifecycleGeneration: 82, contentDocumentIdentity: f.binding.documentIdentity,
    contentNavigationIdentity: () => f.binding.navigationIdentity,
    getCanonicalArticleSnapshot: () => ({ documentHash: f.binding.documentHash }),
    reuseActiveFigureAnalysisPromise: () => null,
    preflightFigureTaskRoute: async () => { options.duringPreflight?.(c); return {}; },
    assertCurrentArticleWorkspaceLifecycle: lifecycle => assert.equal(lifecycle, c.articleWorkspaceLifecycleGeneration),
    recoverPendingFigureOperationRelease: async () => {},
    ensureCurrentArticleWorkspace: async () => ({}), refreshSupplementalFigureAssets: async () => {},
    getFigureWorkspaceInventory: () => [figure], ensureFigureWorkspaceInventorySeeded: async () => {},
    synchronizeFigureWorkspaceLifecycle: async () => {}, ensureFigureWalkthroughState: () => state,
    beginFigureOperation: (_kind, _figureId, operationId, options) => {
      beginOptions.push(plain(options));
      return activeOperation = {
        operationId, workspaceLifecycle: 82,
        userAuthorizedResume: options?.userAuthorizedResume === true
      };
    },
    beginSingleFigureProgress() {}, figureDepthAnalysisPromise: null,
    figureDepthAnalysisId: '', figureDepthAnalysisKind: '',
    document: { title: H.figureMessage([]).document.title },
    extractArticleWithTrace: () => H.figureMessage([]).document.paragraphs,
    waitForLocalOperation: async () => { if (stopped) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' }); },
    preparePdfFigureProductionInput: async () => { options.duringPrepare?.(c); return { images: [], envelope: null }; },
    refreshRuntimePdfFigureInventory: async () => {}, buildFigureInputHash: () => state.figureInputHash,
    verifyLiveFigureRetryInput: async () => ({ liveRevision: 'same-revision' }),
    discardFigureResumeCheckpoint: async (_state, depth) => { events.push('discard'); delete state.pendingResumeCheckpoints[depth]; },
    buildFigureOperationProviderPlan: figures => figures.map(item => ({ figureId: item.figureId, panelCount: item.panelHints?.length || 0 })),
    createFigureAnalysisRequestReceipt: () => 'figure-request-' + crypto.randomUUID(),
    currentFigureProviderAttemptsConsumed: () => 0, bindFigureOperationProgress: () => true,
    isCurrentFigureOperation: () => current && !stopped,
    throwStaleFigureOperation: () => { throw Object.assign(new Error('stale'), { code: 'FIGURE_SELECTION_STALE' }); },
    figureResponseError: response => Object.assign(new Error(response.error?.message || response.error || 'failed'), { code: response.error?.code || response.code }),
    mergeCompletedFigureResultIntoWorkspaceDraft: async () => events.push('committed'),
    assertFigureRetryCommitBinding() {},
    persistCompletedFigureCheckpointState: async () => events.push('persisted'),
    invalidateCrossFigureLogic() {}, buildFigureWorkspaceSnapshot: () => ({ figures: [figure] }),
    figureWalkthroughState: new Map([['figure-1', state]]), lastFigureAnalysis: null,
    scheduleCurrentArticleArchiveSave() {}, scheduleArticleWorkspaceArtifactsSave() {},
    captureFigureOperationPrimaryError: (operation, error) => (operation.primaryError = error),
    canApplyFigureFailure: () => true, settleInterruptedFigureRecovery: async () => null,
    formatFigureCoverageFailure: error => error.message, finishSingleFigureProgress() {},
    finishFigureOperation: async () => {},
    chrome: { runtime: { id: 'extension-id', getURL: file => 'chrome-extension://extension-id/' + file,
      sendMessage: async payload => {
        payloads.push(plain(payload));
        const response = options.captureOnly ? { success: false, error: { code: 'CAPTURE_ONLY', message: 'capture' } }
          : await f.router.handle(plain(payload), { ...f.owner, ...(options.ownerPatch || {}) });
        events.push({ routerResponse: response });
        return response;
      } } }
  });
  for (const name of ['analyzeSingleFigureWithLLM', 'selectFigureResumeCheckpoint', 'selectFigureResumeOperationPlan',
    'sendFigureAnalysisRequestWithReceipt', 'isPreDispatchFigureTransportError', 'validateFigureUserResumeMessage',
    'isCompleteFigureAnalysisResult', 'isUsableFigureAnalysisResult', 'invalidCommittedFigureResult', 'normalizeRequestedPanelId']) {
    vm.runInContext(functionSource(content, name), c);
  }
  const branchStart = content.indexOf("} else if (request.action === 'analyzeSingleFigureWithLLM') {");
  const branchEnd = content.indexOf('} else if (request.action', branchStart + 1);
  const dispatch = (request, senderPatch = {}) => new Promise(resolve => {
    Object.assign(c, { request, sender: { id: 'extension-id', url: 'chrome-extension://extension-id/popup.html', ...senderPatch },
      sendResponse: response => { responses.push(plain(response)); resolve(response); } });
    vm.runInContext('(function(){' + content.slice(branchStart + 7, branchEnd) + '}})()', c);
  });
  const context = { tabId: 82, url: f.binding.navigationIdentity };
  const snapshotFigure = { ...figure, standard: state.standard, standardError: state.standardError,
    pendingStandardCheckpointEnvelope: state.pendingResumeCheckpoints.standard, ...(options.snapshotPatch || {}) };
  const p = vm.createContext({ console, crypto: crypto.webcrypto,
    SciLLM: { ...globalThis.SciLLM, normalizeTabDocumentUrl: value => value },
    window: { listeners: new Map(), addEventListener(type, callback) { this.listeners.set(type, callback); },
      removeEventListener(type) { this.listeners.delete(type); } },
    requireUsableLlm: () => true, capturePanelContext: () => context,
    sidebarBatchKey: () => 'figures:82', sidebarBatchIntents: new Map(),
    sidebarRuntimeTasks: { get: () => null }, sidebarTaskDocumentId: () => 'document',
    currentWorkspaceSnapshot: { documentId: 'document', documentHash: f.binding.documentHash, figures: { figures: [snapshotFigure] } },
    preparedDocumentState: null, renderSidebarBatchActions() {}, figureTaskGeneration: 1,
    queryPanelTargetTab: async () => ({ id: 82 }), isCurrentFigureTask: () => current,
    isCurrentPanelContext: () => current, isSidebarOperationStopping: () => stopped,
    captureFigureUiOwnerBinding: async () => uiOwner,
    refreshSidebarRuntimeDocumentBinding: async (_context, bindingOptions) => {
      options.duringBinding?.({ stop: () => { stopped = true; }, change: () => { current = false; } });
      bindingOptions?.assertCurrent?.();
      return { ...f.binding, ...(options.bindingPatch || {}) };
    },
    startFigureProgressPolling() {}, showStatus: message => events.push(message), pollSidebarRuntimeTasks: async () => {},
    sendTabMessage: async (_tabId, request) => { messages.push(plain(request)); return dispatch(request); },
    chrome: { runtime: { getContexts: async () => [], sendMessage: async message => {
      controls.push(plain(message));
      const result = options.denyAuthorization ? { success: false, error: { code: 'DENIED', message: 'denied' } }
        : await f.router.handle(plain(message), uiSender);
      options.mutateAuthorization?.(result);
      options.afterAuthorization?.({ stop: () => { stopped = true; }, change: () => { current = false; },
        hide: () => p.window.listeners.get('pagehide')?.() });
      return result;
    } } },
    acceptSidebarRuntimeTask() {}, refreshFigureAnalysisProgress: async () => ({}),
    hasRunningFigureProgress: () => false, stopFigureProgressPolling() {},
    renderFigureWorkspaceSnapshot() {}, refreshArticleWorkspace: async () => {}, persistCurrentArticleArchive: async () => {}
  });
  vm.runInContext(functionSource(popup, 'runSingleFigureAnalysis'), p);
  return { f, c, p, state, snapshotFigure, events, controls, messages, payloads, responses,
    beginOptions, dispatch,
    run: (trustedUserGesture = true) => p.runSingleFigureAnalysis('figure-1', { trustedUserGesture }) };
}

test('explicit failed single retry reaches router with exact bound grant and resolves old unknown once', async () => {
  const h = await harness();
  const before = structuredClone(h.f.storageArea.values.sciFigureLogicalRequestLedgerV1);
  const calls = h.f.calls.length;
  await h.run();
  assert.equal(h.controls.filter(message => message.command === 'authorize-user-resume').length, 1);
  assert.deepEqual(h.beginOptions, [{ userAuthorizedResume: true }]);
  assert.deepEqual(h.controls[0].figureUserResumeBinding.figureIds, ['figure-1']);
  assert.deepEqual(h.controls[0].figureUiOwnerBinding, uiOwner);
  assert.equal(h.responses[0]?.success, true, JSON.stringify({ responses: h.responses, events: h.events, calls: h.f.calls }));
  assert.equal(h.f.calls.length - calls, 1, 'a single Panel uses the complete one-pass contract');
  assert.equal(h.payloads.length, 1, 'structured outcome is not automatically replayed');
  assert.equal(h.payloads[0].forceRefresh, false);
  assert.equal(h.payloads[0].figureUserResumeIntent, h.messages[0].figureUserResumeIntent);
  const after = h.f.storageArea.values.sciFigureLogicalRequestLedgerV1;
  for (const target of before.targets) {
    const saved = after.targets.find(candidate => candidate.key === target.key);
    assert.deepEqual(saved.attempts.slice(0, target.attempts.length), target.attempts);
  }
  assert.deepEqual(h.state.manualEdits, { standard: { title: '人工名称' } });
});

test('no trusted user gesture cannot authorize or replay an unknown request', async () => {
  const h = await harness(), calls = h.f.calls.length;
  await h.run(false);
  assert.equal(h.controls.length, 0);
  assert.equal(h.f.calls.length, calls);
  assert.ok(!h.responses[0]?.success);
});

for (const [name, options] of [
  ['authorization denied', { denyAuthorization: true }],
  ['stop during binding', { duringBinding: task => task.stop() }],
  ['document changed during binding', { duringBinding: task => task.change() }],
  ['stop during authorization', { afterAuthorization: task => task.stop() }],
  ['document changed during authorization', { afterAuthorization: task => task.change() }],
  ['side panel closes during authorization', { afterAuthorization: task => task.hide() }],
  ['binding belongs to replacement document', { bindingPatch: { documentHash: 'replacement' } }]
]) test(name + ' sends no model request', async () => {
  const h = await harness(options), calls = h.f.calls.length;
  await h.run();
  assert.equal(h.f.calls.length, calls);
  assert.equal(h.payloads.length, 0);
});

test('valid standard checkpoint survives an explicit retry with its original operation plan', async () => {
  const h = await harness({ captureOnly: true });
  const checkpoint = { version: 'figure-checkpoint-envelope-v1', figureId: 'figure-1',
    operationPlan: [{ figureId: 'figure-1', panelCount: 1 }, { figureId: 'figure-2', panelCount: 1 }] };
  h.state.pendingResumeCheckpoints.standard = checkpoint;
  await h.run();
  assert.ok(!h.events.includes('discard'));
  assert.deepEqual(h.payloads[0].figureResumeCheckpoint, checkpoint);
  assert.deepEqual(h.payloads[0].figureOperationPlan, checkpoint.operationPlan);
  assert.deepEqual(h.state.pendingResumeCheckpoints.standard, checkpoint);
});

test('signed extraction checkpoint resumes only synthesis and retains old unknown plus other figure history', async () => {
  const h = await harness({ checkpoint: true });
  const checkpoint = plain(h.state.pendingResumeCheckpoints.standard);
  assert.equal(checkpoint.figureResult.panels.length, 26);
  const before = plain(h.f.storageArea.values.sciFigureLogicalRequestLedgerV1);
  assert.ok(before.targets.some(target => target.attempts.some(attempt => attempt.status === 'unknown')));
  const calls = h.f.calls.length;
  await h.run();
  assert.equal(h.responses[0]?.success, true, JSON.stringify({ responses: h.responses, events: h.events,
    calls: h.f.calls, progress: h.f.progress.slice(-10) }));
  assert.equal(h.payloads.length, 1);
  assert.deepEqual(h.payloads[0].figureResumeCheckpoint, checkpoint);
  assert.deepEqual(h.payloads[0].figureOperationPlan, checkpoint.operationPlan);
  assert.deepEqual(h.f.calls.slice(calls).map(call => call.pass), ['figure_synthesis']);
  assert.ok(!h.events.includes('discard'));
  assert.ok(h.events.includes('committed') && h.events.includes('persisted'));
  assert.equal(h.state.standard.panels.length, 26);
  assert.equal(h.state.manualEdits.standard.title, '人工名称');
  const after = h.f.storageArea.values.sciFigureLogicalRequestLedgerV1;
  for (const target of before.targets) {
    const current = after.targets.find(candidate => candidate.key === target.key);
    const preserved = current.attempts.slice(0, target.attempts.length);
    const changes = preserved.flatMap((attempt, index) =>
      JSON.stringify(attempt) === JSON.stringify(target.attempts[index]) ? [] : [{ before: target.attempts[index], after: attempt }]);
    for (const change of changes) {
      assert.equal(change.before.status, 'responded');
      assert.equal(change.before.proofKind, 'checkpoint');
      assert.deepEqual(change.after, { ...change.before, status: 'sealed' });
    }
    // Only the requested Figure can acquire a new synthesis claim.
    if (target === before.targets[0]) assert.equal(current.attempts.length, target.attempts.length + 1);
    else assert.deepEqual(current, target);
  }
});

test('real checkpoint ACK then seal failure preserves authorization for old unknown and one remaining synthesis', async () => {
  const h = await harness({ checkpoint: true, checkpointSealFailure: true });
  assert.equal(h.f.sealWriteFailed, true, JSON.stringify(h.f.seedResponses));
  const before = plain(h.f.storageArea.values.sciFigureLogicalRequestLedgerV1);
  const requested = before.targets[0];
  assert.ok(requested.attempts.some(attempt => attempt.status === 'unknown'));
  assert.ok(requested.attempts.some(attempt => attempt.status === 'responded' && attempt.proofKind === 'checkpoint'));
  const calls = h.f.calls.length;
  await h.run();
  assert.equal(h.responses[0]?.success, true, JSON.stringify({ responses: h.responses, events: h.events }));
  assert.deepEqual(h.f.calls.slice(calls).map(call => call.pass), ['figure_synthesis']);
  assert.equal(h.payloads.length, 1);
  assert.ok(!h.events.includes('discard'));
  const after = h.f.storageArea.values.sciFigureLogicalRequestLedgerV1;
  assert.deepEqual(after.targets[1], before.targets[1]);
  assert.deepEqual(after.targets[0].attempts.slice(0, requested.attempts.length),
    requested.attempts.map(attempt => attempt.status === 'responded' && attempt.proofKind === 'checkpoint'
      ? { ...attempt, status: 'sealed' } : attempt));
  assert.equal(after.targets[0].attempts.length, requested.attempts.length + 1);
});

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function checkpointLedgerFixture() {
  const storageArea = H.createMemoryStorage();
  const ledger = H.createFigureLogicalRequestLedger({ storageArea,
    lockManager: { request: async (_name, callback) => callback() } });
  const input = { key: digest('target'), scopeKey: digest('source'), figureId: 'figure-1', limit: 8, tokenLimit: 8000 };
  const oldActor = digest('old'), actor = digest('new'), proof = digest('signed checkpoint');
  const extraction = await ledger.reserve([input], oldActor, digest('extraction'), 100, ['A']);
  await ledger.settle(extraction, 'responded', proof, 'checkpoint');
  const synthesis = await ledger.reserve([input], oldActor, digest('synthesis'), 100);
  await ledger.settle(synthesis, 'unknown');
  const targets = await ledger.snapshotPending();
  for (const target of targets) target.priorDigest = digest(target.attempts);
  return { ledger, storageArea, input, actor, proof, intent: { intentDigest: digest('gesture'), targets } };
}

test('verified checkpoint sealing preserves the observed authorization while admitting exactly one synthesis', async () => {
  const f = await checkpointLedgerFixture();
  const before = plain(f.storageArea.values.sciFigureLogicalRequestLedgerV1);
  await f.ledger.recover([f.input], f.actor, f.proof, f.intent);
  assert.equal(f.storageArea.values.sciFigureLogicalRequestLedgerV1.targets[0].attempts[0].status, 'sealed');
  const claims = await f.ledger.reserve([f.input], f.actor, digest('continued synthesis'), 100, [], [], f.intent);
  assert.equal(claims.length, 1);
  const target = f.storageArea.values.sciFigureLogicalRequestLedgerV1.targets[0];
  assert.deepEqual(target.attempts[1], before.targets[0].attempts[1]);
  assert.deepEqual(target.attempts[2].explicitResume.priorNumbers, [2]);
  const admitted = plain(f.storageArea.values.sciFigureLogicalRequestLedgerV1);
  await assert.rejects(f.ledger.reserve([f.input], f.actor, digest('duplicate synthesis'), 100, [], [], f.intent),
    { code: 'FIGURE_REQUEST_REPLAY_AMBIGUOUS' });
  assert.deepEqual(f.storageArea.values.sciFigureLogicalRequestLedgerV1, admitted);
});

for (const kind of ['unverified-seal', 'wrong-proof', 'changed-usage', 'changed-owner', 'extra-attempt', 'failed-seal-write']) {
  test(`checkpoint authorization still refuses ${kind} without new provider claims`, async () => {
    const f = await checkpointLedgerFixture();
    if (kind === 'unverified-seal') f.storageArea.values.sciFigureLogicalRequestLedgerV1.targets[0].attempts[0].status = 'sealed';
    else if (kind === 'wrong-proof') {
      await f.ledger.recover([f.input], f.actor, digest('other checkpoint'), f.intent);
      f.storageArea.values.sciFigureLogicalRequestLedgerV1.targets[0].attempts[0].status = 'sealed';
    }
    else if (kind === 'failed-seal-write') {
      const set = f.storageArea.set;
      f.storageArea.set = () => { throw Error('SYNTHETIC_WRITE_FAILURE'); };
      await assert.rejects(f.ledger.recover([f.input], f.actor, f.proof, f.intent), { code: 'FIGURE_PROVIDER_ATTEMPT_LEDGER_UNAVAILABLE' });
      f.storageArea.set = set;
      // A forged external seal after the failed write cannot gain permission.
      f.storageArea.values.sciFigureLogicalRequestLedgerV1.targets[0].attempts[0].status = 'sealed';
    } else {
      await f.ledger.recover([f.input], f.actor, f.proof, f.intent);
      const target = f.storageArea.values.sciFigureLogicalRequestLedgerV1.targets[0];
      if (kind === 'changed-usage') {
        target.attempts[0].reservedOutputTokens++;
        f.storageArea.values.sciFigureLogicalRequestLedgerV1.scopes[0].reservedOutputTokens++;
      }
      if (kind === 'changed-owner') target.attempts[1].actor = digest('replacement owner');
      if (kind === 'extra-attempt') {
        target.attempts.push({ ...target.attempts[1], physicalDigest: digest('concurrent') });
        f.storageArea.values.sciFigureLogicalRequestLedgerV1.scopes[0].used++;
        f.storageArea.values.sciFigureLogicalRequestLedgerV1.scopes[0].reservedOutputTokens += 100;
      }
    }
    const before = plain(f.storageArea.values.sciFigureLogicalRequestLedgerV1);
    await assert.rejects(f.ledger.reserve([f.input], f.actor, digest('must refuse'), 100, [], [], f.intent),
      { code: 'FIGURE_REQUEST_REPLAY_AMBIGUOUS' });
    assert.deepEqual(f.storageArea.values.sciFigureLogicalRequestLedgerV1, before);
  });
}

test('a responded uncommitted request is explicitly resumed once without erasing prior attempts', async () => {
  const h = await harness({ responded: true });
  const before = plain(h.f.storageArea.values.sciFigureLogicalRequestLedgerV1);
  assert.ok(before.targets.some(target => target.attempts.some(attempt => attempt.status === 'responded')));
  const calls = h.f.calls.length;
  await h.run();
  assert.equal(h.responses[0]?.success, true, JSON.stringify(h.responses));
  assert.equal(h.f.calls.length - calls, 1);
  assert.equal(h.payloads.length, 1);
  const after = h.f.storageArea.values.sciFigureLogicalRequestLedgerV1;
  for (const target of before.targets)
    assert.deepEqual(after.targets.find(candidate => candidate.key === target.key).attempts.slice(0, target.attempts.length), target.attempts);
});

test('a new unfinished figure tolerates an empty authorization token when no ambiguous history exists', async () => {
  const h = await harness({ noPending: true });
  await h.run();
  assert.equal(h.controls.length, 1);
  assert.equal(h.messages[0].figureUserResumeIntent, undefined);
  assert.equal(h.payloads[0].forceRefresh, false);
  assert.equal(h.responses[0]?.success, true, JSON.stringify(h.responses));
});

test('completed single figure re-read preserves force refresh intent and manual labels', async () => {
  const h = await harness({ completed: true, captureOnly: true });
  await h.run();
  assert.equal(h.controls.length, 0, 'a completed re-read is not unresolved recovery');
  assert.equal(h.payloads[0].forceRefresh, true);
  assert.equal(h.payloads[0].figureUserResumeIntent, undefined);
  assert.equal(h.state.manualEdits.standard.title, '人工名称');
});

test('legacy incomplete saved result without an error is continued with explicit authorization', async () => {
  const h = await harness({ snapshotPatch: { standard: { figureId: 'figure-1', panels: [] }, standardError: '' } });
  await h.run();
  assert.equal(h.controls.filter(message => message.command === 'authorize-user-resume').length, 1);
  assert.equal(h.payloads[0]?.forceRefresh, false);
  assert.equal(h.responses[0]?.success, true, JSON.stringify(h.responses));
});

test('a usable saved result missing a declared Panel is continued rather than force refreshed', async () => {
  const h = await harness({ completed: true, snapshotPatch: { panelHints: ['A', 'B'] } });
  await h.run();
  assert.equal(h.controls.length, 1);
  assert.equal(h.payloads[0].forceRefresh, false);
  assert.equal(h.responses[0]?.success, true, JSON.stringify(h.responses));
});

test('a persisted deep checkpoint alone keeps a complete older Figure on explicit continuation', async () => {
  const h = await harness({ completed: true, snapshotPatch: { pendingDeepCheckpointEnvelope: { version: 'figure-checkpoint-envelope-v1' } } });
  await h.run();
  assert.equal(h.controls.length, 1);
  assert.equal(h.payloads[0].forceRefresh, false);
  assert.equal(h.responses[0]?.success, true, JSON.stringify(h.responses));
});

test('an older complete result plus a later failed re-read uses explicit continuation and keeps manual labels', async () => {
  const h = await harness({ completed: true, snapshotPatch: { standardError: 'later unknown re-read' } });
  await h.run();
  assert.equal(h.controls.length, 1);
  assert.equal(h.payloads[0].forceRefresh, false);
  assert.equal(h.responses[0]?.success, true, JSON.stringify(h.responses));
  assert.equal(h.state.manualEdits.standard.title, '人工名称');
});

for (const token of ['not-a-resume-token', '11111111-1111-4111-8111-111111111111']) {
  test(`forged authorization token ${token} adds no provider work`, async () => {
    const h = await harness({ mutateAuthorization: result => { result.data.figureUserResumeIntent = token; } });
    const calls = h.f.calls.length;
    await h.run();
    assert.equal(h.responses[0]?.success, false);
    assert.equal(h.f.calls.length, calls);
  });
}

test('a repeated spent grant cannot add provider work through the real content listener', async () => {
  const h = await harness();
  await h.run();
  assert.equal(h.responses[0]?.success, true);
  const calls = h.f.calls.length;
  await h.dispatch(plain(h.messages[0]));
  assert.equal(h.f.calls.length, calls);
  assert.equal(h.payloads.length, 2, 'the repeated top-level request is stopped or satisfied by the existing outcome');
});

for (const [name, senderPatch] of [['foreign extension', { id: 'foreign-extension' }],
  ['non-UI sender', { url: 'https://example.org/single-paper' }]]) {
  test(`content rejects ${name} resume grant before forwarding`, async () => {
    const h = await harness();
    const authorization = await h.f.router.handle({ type: 'LLM_CONTROL_OPERATION', command: 'authorize-user-resume',
      operationScope: 'figure', operationId: 'single-content-sender',
      figureUserResumeBinding: { ...h.f.binding, figureIds: ['figure-1'] } }, uiSender);
    const calls = h.f.calls.length;
    const result = await h.dispatch({ action: 'analyzeSingleFigureWithLLM', figureId: 'figure-1',
      operationId: 'single-content-sender', figureUserResumeIntent: authorization.data.figureUserResumeIntent,
      figureUserResumeBinding: { ...h.f.binding, figureIds: ['figure-1'] } }, senderPatch);
    assert.equal(result.code, 'FIGURE_SELECTION_STALE');
    assert.equal(h.payloads.length, 0);
    assert.equal(h.f.calls.length, calls);
  });
}

for (const ownerPatch of [{ senderTabId: 83 }, { senderFrameId: 1 },
  { senderDocumentId: '83838383-8383-4383-8383-838383838383' }]) {
  test(`router rejects changed owner ${Object.keys(ownerPatch)[0]} on a real single resume`, async () => {
    const h = await harness({ ownerPatch }), calls = h.f.calls.length;
    await h.run();
    assert.equal(h.responses[0]?.success, false);
    assert.equal(h.f.calls.length, calls);
  });
}

test('content rejects valid grant borrowed for a different figure before dispatch', async () => {
  const h = await harness();
  const calls = h.f.calls.length;
  const grant = await h.f.router.handle({ type: 'LLM_CONTROL_OPERATION', operationScope: 'figure',
    command: 'authorize-user-resume', operationId: 'single-wrong-figure', figureUserResumeBinding: h.f.binding }, uiSender);
  const response = await h.dispatch({ action: 'analyzeSingleFigureWithLLM', figureId: 'figure-1',
    operationId: 'single-wrong-figure', figureUserResumeIntent: grant.data.figureUserResumeIntent,
    figureUserResumeBinding: { ...h.f.binding, figureIds: ['figure-2'] } });
  assert.equal(response.success, false);
  assert.equal(response.code, 'FIGURE_SELECTION_STALE');
  assert.equal(h.payloads.length, 0);
  assert.equal(h.f.calls.length, calls);
});

test('content rechecks document binding after async preparation', async () => {
  const h = await harness({ duringPrepare: c => { c.contentDocumentIdentity = 'replacement-document'; } });
  const calls = h.f.calls.length;
  await h.run();
  assert.equal(h.responses[0]?.code, 'FIGURE_SELECTION_STALE');
  assert.equal(h.payloads.length, 0);
  assert.equal(h.f.calls.length, calls);
});

test('owner navigation replacement cannot spend an otherwise valid single grant', async () => {
  const h = await harness({ ownerPatch: { senderUrl: 'https://example.org/changed-paper' } });
  const calls = h.f.calls.length;
  await h.run();
  assert.equal(h.f.calls.length, calls);
  assert.equal(h.payloads.length, 1);
  assert.equal(h.responses[0]?.success, false);
});

for (const type of ['dblclick', 'keydown']) for (const isTrusted of [true, false]) {
  test(`actual badge callback receives ${type} event trust=${isTrusted}`, async () => {
    const calls = [];
    const start = popup.indexOf('const gestureContext = captureFigureWorkspaceEditContext();');
    const analyzeStart = popup.indexOf('onAnalyze: ', start) + 'onAnalyze: '.length;
    const analyzeEnd = popup.indexOf(',\n            onInspect:', analyzeStart);
    assert.ok(start > 0 && analyzeEnd > analyzeStart);
    const onAnalyze = vm.runInNewContext('(' + popup.slice(analyzeStart, analyzeEnd) + ')', {
      loading: false, figure: { figureId: 'figure-1' },
      runSingleFigureAnalysis: async (...args) => calls.push(args), showStatus() {}
    });
    const target = () => ({ listeners: new Map(), addEventListener(name, callback) { this.listeners.set(name, callback); },
      removeEventListener(name) { this.listeners.delete(name); } });
    const view = { ...target(), setTimeout: () => 1, clearTimeout() {} };
    const doc = { ...target(), defaultView: view };
    const button = { ...target(), ownerDocument: doc, style: { setProperty() {} }, dataset: {} };
    require('../core/sidebar-interactions.js').bindFigureGesture(button, { onAnalyze, isCurrent: () => true });
    button.listeners.get(type)({ isTrusted, key: 'Enter', shiftKey: true, stopPropagation() {}, preventDefault() {} });
    await Promise.resolve();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1]?.trustedUserGesture, isTrusted);
  });
}
