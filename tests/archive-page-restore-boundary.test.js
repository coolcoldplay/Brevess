const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
function executable(name, dependencies = {}) {
  let start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Production ${name} exists`);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const next = source.slice(start + 1).search(/\n(?:async )?function /u);
  const text = source.slice(start, next < 0 ? source.length : start + 1 + next).trim();
  return Function(...Object.keys(dependencies), `return (${text});`)(...Object.values(dependencies));
}
const failure = code => Object.assign(new Error(code || 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH'), { code: code || 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH' });
const own = (value, key) => value?.[key];
function baselineHarness() {
  const state = { fields: { notes: [['p1', { note: '人工值' }]], abbreviations: { entries: [] } }, pending: false, mutationTail: {} };
  const capture = executable('captureArticleWorkspaceRestoreManualBaseline', {
    readArticleWorkspaceRestoreManualState: () => state
  });
  const check = executable('assertArticleWorkspaceRestoreManualBaseline', {
    captureArticleWorkspaceRestoreManualBaseline: capture, articleWorkspaceRestoreError: failure
  });
  return { state, capture, check };
}
test('authorization holds the pre-scan manual snapshot privately', () => {
  const baseline = { fingerprint: 'private', mutationTail: {} };
  const start = source.indexOf('function createArticleWorkspaceRestoreAuthorization(');
  const end = source.indexOf('\nfunction consumeArticleWorkspaceRestoreAuthorization(', start);
  const make = Function('normalizedArticleWorkspaceRestoreIdentity', 'articleWorkspaceRestoreError',
    'captureArticleWorkspaceRestoreManualBaseline', `let articleWorkspaceRestoreAuthorization;
    ${source.slice(start, end)}; return [createArticleWorkspaceRestoreAuthorization, () => articleWorkspaceRestoreAuthorization];`)(v => v, failure, () => baseline);
  const publicValue = make[0]({ workspaceId: 'workspace:a', workspaceGeneration: 1, canonicalUrl: 'https://a.test/paper', contentHash: 'hash' }, { now: 10, tokenFactory: () => 'restore-token-1234' });
  assert.equal(make[1]().manualBaseline, baseline);
  assert.equal(Object.hasOwn(publicValue, 'manualBaseline'), false);
});
for (const change of ['notes', 'empty', 'abbreviations', 'tail']) {
  test(`pre-scan baseline refuses ${change} drift without changing the draft`, () => {
    const h = baselineHarness(); const before = h.capture();
    if (change === 'notes') h.state.fields.notes[0][1].note = '扫描后的人工输入';
    if (change === 'empty') h.state.fields.notes = [];
    if (change === 'abbreviations') h.state.fields.abbreviations.entries.push({ short: 'CD4', full: '' });
    if (change === 'tail') h.state.mutationTail = {};
    const value = JSON.stringify(h.state.fields);
    assert.throws(() => h.check(before), e => e.code === 'ARTICLE_WORKSPACE_RESTORE_MANUAL_CHANGED');
    assert.equal(JSON.stringify(h.state.fields), value);
  });
}
test('already pending or subsequently opened manual editing is refused, without truncation', () => {
  const h = baselineHarness(); h.state.pending = true; const before = h.capture(); h.state.pending = false;
  assert.throws(() => h.check(before), e => e.code === 'ARTICLE_WORKSPACE_RESTORE_DRAFT_PENDING');
  const clear = h.capture(); h.state.pending = true;
  assert.throws(() => h.check(clear), e => e.code === 'ARTICLE_WORKSPACE_RESTORE_DRAFT_PENDING');
  h.state.pending = false; h.state.fields.notes = 'x'.repeat(4_000_001);
  assert.throws(() => h.check(h.capture()), e => e.code === 'ARTICLE_WORKSPACE_RESTORE_DRAFT_PENDING');
});
test('runAuthorized checks the private snapshot before invalidating and passes it to prepare', async () => {
  const order = []; const authorization = { identity: { workspaceId: 'paper' }, manualBaseline: { fingerprint: 'a' } };
  const run = executable('runAuthorizedArticleWorkspaceRestore', { ownArticleWorkspaceRestoreValue: own,
    sameArticleWorkspaceRestoreIdentity: () => true, articleWorkspaceRestoreError: failure });
  const deps = { consume: () => authorization, assertManual: value => { assert.equal(value, authorization.manualBaseline); order.push('manual'); },
    invalidate: () => { order.push('invalidate'); return 2; }, freeze() {}, unfreeze() {}, capture: async () => authorization.identity,
    validate: () => ({ current: authorization.identity }), prepare: (_v, _t, auth) => { assert.equal(auth, authorization); return {}; },
    commit: () => ({ success: true }), getLifecycle: () => 2 };
  await run({}, deps); assert.equal(order[0], 'manual');
  order.length = 0; deps.assertManual = () => { throw failure('ARTICLE_WORKSPACE_RESTORE_DRAFT_PENDING'); };
  await assert.rejects(() => run({}, deps), /DRAFT_PENDING/); assert.deepEqual(order, []);
});
function transactionHarness(options = {}) {
  const calls = []; let lifecycle = 2; let edited = false;
  const prepared = { restore: { restorePlanId: 'restore-plan-a', assets: [{ relativePath: 'untrusted', content: 'incoming' }] }, operationNonce: 'restore-token-1234', manualBaseline: {} };
  const target = { current: { workspaceId: 'workspace:a' }, documentId: 'doc:a', manifest: { workspaceId: 'workspace:a' }, match: 'exact' };
  const authoritative = { assets: [{ relativePath: 'actual', revision: 4, content: 'backend' }], turns: [{ turnId: 'turn-1', revision: 3 }] };
  const deps = {
    assertTarget: async () => { calls.push('preflight'); if (options.preflightEdit) edited = true; },
    assertCurrentSync: () => { calls.push('sync'); if (lifecycle !== 2) throw failure(); if (edited) throw failure('ARTICLE_WORKSPACE_RESTORE_MANUAL_CHANGED'); },
    commitPrepared: async (planId, binding) => { calls.push('persist'); assert.equal(planId, 'restore-plan-a'); assert.equal(binding.operationNonce, prepared.operationNonce);
      if (options.refuse) throw failure('WORKSPACE_RESTORE_CONFLICT');
      if (options.edit) edited = true; if (options.navigate) lifecycle = 3;
      return { committed: true, persistenceCommitted: true, restore: authoritative, assetCount: 1, syncStatus: { pendingCount: 1 } }; },
    apply: restore => { calls.push('apply'); assert.deepEqual(restore.assets, authoritative.assets); assert.equal(restore.persistRestored, false); assert.equal(restore.deferManualSideEffects, true); if (options.applyFail) throw Error('apply'); return { success: true, uiState: { tab: 'figures' } }; },
    registerReceipt: async () => { calls.push('receipt'); return 'old-receipt'; }
  };
  const commit = executable('commitArticleWorkspaceRestoreTransaction', { articleWorkspaceRestoreError: failure });
  return { calls, prepared, target, deps, run: () => commit(prepared, target, 2, deps) };
}
test('prepared persistence runs before synchronous apply, using actual stored checkpoints and no applied receipt', async () => {
  const h = transactionHarness(); const result = await h.run();
  assert.deepEqual(h.calls, ['preflight', 'sync', 'persist', 'sync', 'apply']);
  assert.equal(result.persistenceCommitted, true); assert.equal(result.workspaceApplied, true); assert.equal(result.success, true);
});
for (const problem of ['refuse', 'preflightEdit']) {
  test(`${problem} gives zero page applies and no receipts`, async () => {
    const h = transactionHarness({ [problem]: true }); await assert.rejects(h.run);
    assert.equal(h.calls.includes('apply'), false); assert.equal(h.calls.includes('receipt'), false);
    if (problem === 'preflightEdit') assert.equal(h.calls.includes('persist'), false);
  });
}
for (const problem of ['edit', 'navigate', 'applyFail']) {
  test(`${problem} after durable commit reports the partial fact without retrying`, async () => {
    const h = transactionHarness({ [problem]: true }); const result = await h.run();
    assert.equal(result.success, false); assert.equal(result.persistenceCommitted, true); assert.equal(result.committed, true);
    assert.equal(result.retryable, false); assert.equal(result.workspaceApplied, false); assert.equal(h.calls.includes('receipt'), false);
    assert.equal(h.calls.filter(v => v === 'persist').length, 1);
    if (problem !== 'applyFail') assert.equal(h.calls.includes('apply'), false);
  });
}
test('directory restore without a plan cannot fall back to page-first application', async () => {
  const h = transactionHarness(); delete h.prepared.restore.restorePlanId;
  await assert.rejects(h.run, e => e.code === 'ARTICLE_WORKSPACE_RESTORE_PLAN_REQUIRED');
  assert.equal(h.calls.includes('apply'), false);
});
test('explicit browser-local authorized load retains receipt flow with final synchronous guards', async () => {
  const h = transactionHarness(); delete h.prepared.restore.restorePlanId; h.prepared.restore.restoreSource = 'browser-local';
  h.deps.apply = () => { h.calls.push('apply'); return { success: true }; };
  const result = await h.run(); assert.equal(result.success, true); assert.equal(result.receiptRegistered, true);
  assert.equal(h.calls.includes('persist'), false); assert.ok(h.calls.indexOf('sync') < h.calls.indexOf('apply'));
});

function readerHarness() {
  const abbreviations = { schemaVersion: 1, manualEntries: [], excludedKeys: [], translations: [] };
  const deps = {
    figureWorkspaceDraftController: null, figureWorkspaceDraftControllerPromise: null,
    figureWorkspaceDraftDirty: false, figureWorkspaceDraft: { figures: [] },
    figureWorkspaceDraftCheckpoint: { revision: 0, contentHash: '' },
    articleParagraphNotes: new Map(), articleAbbreviationState: abbreviations,
    SciLLM: { normalizeArticleAbbreviationState: value => structuredClone(value) },
    articleNavigatorState: { activeTab: 'outline', depth: 'major', summariesVisible: false,
      expandedSectionIds: new Set(), analysisSectionSelection: new Map() },
    articleWorkspaceSidePanelUiState: null, articleWorkspaceAssetFingerprints: new Map(),
    document: { querySelector: () => null }, getCanonicalArticleSnapshot: () => ({ paragraphs: [{ text: 'p = 0.001; no increase' }] }),
    articleWorkspaceMutationTail: Promise.resolve(), manualPreparePromise: null,
    sendManualMessage: {}, mutateFigureWorkspaceDraft: {}, articleWorkspaceEnsurePromise: null,
    articleWorkspaceExplicitSaveState: { active: null }, crossFigureLogicRuntime: null,
    crossFigureLogicAdmissions: new Map(), currentManualDocument: { documentId: 'doc', record: { annotations: [] } },
    articleChatState: { turns: [] }, articleLogicMapIndex: {}, crossFigureLogicState: {},
    captureCurrentArticleArchiveRestoreIdentity: () => ({ documentId: 'doc', canonicalUrl: 'https://example.org/paper' }),
    effectiveArticlePageUrl: () => 'https://example.org/paper'
  };
  return { deps, read: () => executable('readArticleWorkspaceRestoreManualState', deps)() };
}
test('real reader is stable for saved/empty states and keeps scientific text verbatim', () => {
  const h = readerHarness(); const before = h.read(); assert.equal(before.pending, false);
  assert.equal(before.fields.document.paragraphs[0], 'p = 0.001; no increase');
  h.deps.articleParagraphNotes.set('p1', { paragraphId: 'p1', note: '已有保存值' });
  h.deps.articleWorkspaceAssetFingerprints.set('annotations/paragraph-notes.json', JSON.stringify({ schemaVersion: 1, notes: [...h.deps.articleParagraphNotes.values()] }));
  assert.equal(h.read().pending, false);
  h.deps.articleParagraphNotes.clear(); assert.equal(h.read().pending, true, 'unpersisted deletion is not an empty-state exemption');
});
for (const field of ['manualEntries', 'excludedKeys', 'translations']) {
  test(`real reader rejects uncheckpointed abbreviation ${field}`, () => {
    const h = readerHarness(); h.deps.articleAbbreviationState[field].push(field === 'excludedKeys' ? 'cd4' : { abbreviation: 'CD4' });
    assert.equal(h.read().pending, true);
  });
}
for (const pending of ['editor', 'manualPrepare', 'manualIpc', 'figureIntent', 'workspaceIpc', 'figureCreation', 'figureDirty', 'controllerQueue', 'untrackedController', 'mechanism']) {
  test(`real reader refuses ${pending} before any lifecycle reset`, () => {
    const h = readerHarness();
    if (pending === 'editor') h.deps.document.querySelector = selector => { assert.match(selector, /sci-highlight-context-popover textarea/); return { value: '' }; };
    if (pending === 'manualPrepare') h.deps.manualPreparePromise = Promise.resolve();
    if (pending === 'manualIpc') h.deps.sendManualMessage.restorePendingOperations = 1;
    if (pending === 'figureIntent') h.deps.mutateFigureWorkspaceDraft.restorePendingOperations = 1;
    if (pending === 'workspaceIpc') h.deps.articleWorkspaceMutationTail.restorePending = true;
    if (pending === 'figureCreation') h.deps.figureWorkspaceDraftControllerPromise = Promise.resolve();
    if (pending === 'figureDirty') h.deps.figureWorkspaceDraftDirty = true;
    if (pending === 'mechanism') h.deps.crossFigureLogicAdmissions.set('pending', {});
    if (['controllerQueue', 'untrackedController'].includes(pending)) h.deps.figureWorkspaceDraftController = {
      ...(pending === 'controllerQueue' ? { restorePendingOperations: 1 } : {}),
      isDirty: () => false, getDraft: () => ({}), getCheckpoint: () => ({})
    };
    assert.equal(h.read().pending, true);
  });
}
test('controller tracker observes an enqueued mutation before the controller changes dirty/draft', async () => {
  const track = executable('trackArticleWorkspaceRestoreController');
  let resolve; const draft = { value: 'old' }; const controller = { isDirty: () => false,
    mutate: () => new Promise(done => { resolve = done; }), getDraft: () => draft };
  assert.equal(track(controller), controller); const pending = controller.mutate({ value: 'new' });
  assert.equal(controller.restorePendingOperations, 1); assert.equal(controller.isDirty(), false); assert.equal(controller.getDraft().value, 'old');
  resolve({ success: true }); await pending; assert.equal(controller.restorePendingOperations, 0);
});
test('controller tracker releases rejected/synchronous errors and does not double wrap', async () => {
  const track = executable('trackArticleWorkspaceRestoreController');
  const controller = track({ mutate: () => Promise.reject(Error('IO')), flush: () => { throw Error('sync'); } });
  const method = controller.mutate; track(controller); assert.equal(controller.mutate, method);
  await assert.rejects(controller.mutate(), /IO/); assert.equal(controller.restorePendingOperations, 0);
  assert.throws(() => controller.flush(), /sync/); assert.equal(controller.restorePendingOperations, 0);
});
test('prepared transport uses exact message and propagates typed conflicts/unknown response', async () => {
  let message; const binding = { operationNonce: 'auth', documentId: 'doc' };
  const send = handler => executable('commitPreparedArticleWorkspaceRestore', {
    chrome: { runtime: { sendMessage: async value => { message = value; return handler(); } } }, articleWorkspaceRestoreError: failure
  });
  const data = { committed: true, persistenceCommitted: true, restore: { assets: [] } };
  assert.equal(await send(() => ({ success: true, data }))('plan', binding), data);
  assert.deepEqual(message, { type: 'ARTICLE_WORKSPACE_COMMIT_PREPARED_RESTORE', planId: 'plan', binding });
  await assert.rejects(() => send(() => ({ success: false, error: { code: 'WORKSPACE_RESTORE_CONFLICT' } }))('plan', binding), /WORKSPACE_RESTORE_CONFLICT/);
  await assert.rejects(() => send(() => { throw Error('disconnected'); })('plan', binding), /ARTICLE_WORKSPACE_RESTORE_COMMIT_UNKNOWN/);
});

test('prepared asset apply preserves a missing UI asset but honors an explicit empty one', () => {
  const start = source.indexOf("    const savedUi = byPath.get('ui/state.json');", source.indexOf('async function applyArticleWorkspaceAssetsUnsafe'));
  const end = source.indexOf("    if (match === 'content-changed')", start);
  const body = source.slice(start, end);
  const existing = { tab: 'figure', manual: 'keep me' };
  const apply = assets => Function('SciLLM', 'byPath', 'existing', `let articleParagraphNotes = new Map(); let articleAbbreviationState = {}; let articleLogicMapIndex = {}; let articleWorkspaceSidePanelUiState = existing; ${body}; return articleWorkspaceSidePanelUiState;`)(
    { normalizeResearchLogicMapIndex: v => v }, new Map(assets), existing);
  assert.equal(apply([]), existing);
  assert.equal(apply([['ui/state.json', {}]]), null);
});
test('prepared inventory-only apply keeps manual Figure draft; dedicated checkpoint and original bootstrap remain supported', () => {
  const start = source.indexOf('    const savedFigureWorkspaceDraftAsset = assets.find(', source.indexOf('async function applyArticleWorkspaceAssetsUnsafe'));
  const end = source.indexOf("    const savedChat = byPath.get('chat/index.json')", start);
  const body = source.slice(start, end); const calls = [];
  const run = (assets, defer) => Function('assets', 'byPath', 'input', 'restoreFigureWorkspaceDraft', `const FIGURE_WORKSPACE_DRAFT_ASSET_PATH = 'figures/workspace-draft.json'; const savedFigures = { figures: [] }; const archiveResult = null; ${body}`)(assets, new Map(assets.map(a => [a.relativePath, a.content])), { deferManualSideEffects: defer }, (...args) => calls.push(args));
  run([], true); assert.equal(calls.length, 0);
  run([{ relativePath: 'figures/workspace-draft.json', content: { figures: ['saved'] }, revision: 5, contentHash: 'actual' }], true);
  assert.deepEqual(calls[0], [{ figures: ['saved'] }, [], { revision: 5, contentHash: 'actual' }]);
  run([], false); assert.equal(calls.length, 2);
});
test('prepared apply pauses unbound annotation tails while independent legacy path defaults are retained', () => {
  const start = source.indexOf('async function applyArticleWorkspaceAssetsUnsafe(');
  const end = source.indexOf('async function commitArticleWorkspaceRestoreTransaction(', start);
  const body = source.slice(start, end);
  assert.match(body, /deferManualPrepare: input\.deferManualSideEffects === true/);
  assert.match(body, /preserveMissingFigureDraft: input\.deferManualSideEffects === true/);
  assert.match(body, /if \(input\.deferManualSideEffects !== true && refreshActivePdfSemanticNavigationContext\(\)\)/);
  const archiveStart = source.indexOf('function applyArticleArchiveSnapshotUnsafe(');
  const archiveEnd = source.indexOf('async function commitArticleArchiveRestoreTransaction(', archiveStart);
  const archive = source.slice(archiveStart, archiveEnd);
  assert.match(archive, /preserveMissingFigureDraft = false/);
  assert.match(archive, /if \(!deferManualPrepare\) void prepareManualDocument\(\)/);
  assert.match(archive, /if \(!preserveMissingFigureDraft \|\| resolveArchivedFigureWorkspaceDraft\(workspace\)\)/);
});

test('the production wrapper carries the original private baseline through all async stages', async () => {
  const baseline = { fingerprint: 'pre-scan', mutationTail: {} }; const calls = [];
  const target = { current: { workspaceId: 'paper', canonicalUrl: 'https://example.org/paper' }, documentId: 'doc', match: 'exact' };
  const prepared = { restorePlanId: 'plan', restoreTarget: { authorizationToken: 'nonce' } };
  let callbacks;
  const wrapper = executable('applyArticleWorkspaceAssets', {
    ownArticleWorkspaceRestoreValue: own,
    assertArticleWorkspaceRestoreManualBaseline: value => { assert.equal(value, baseline); calls.push('manual'); }
  });
  const result = await wrapper(prepared, {
    runAuthorized: async (input, selected) => {
      callbacks = selected; selected.assertManual(baseline);
      return selected.commit(selected.prepare(input, target, { manualBaseline: baseline }), target, 3);
    },
    commitTransaction: async (transaction, frozen, generation, deps) => {
      assert.equal(transaction.manualBaseline, baseline); assert.equal(transaction.restore, prepared);
      assert.equal(transaction.operationNonce, 'nonce'); assert.equal(generation, 3); assert.equal(frozen, target);
      assert.equal(typeof deps.assertCurrentSync, 'function'); assert.equal(typeof deps.commitPrepared, 'function');
      return { success: true, persistenceCommitted: true };
    }
  });
  assert.equal(result.persistenceCommitted, true); assert.deepEqual(calls, ['manual']);
  assert.match(String(callbacks.invalidate), /preserveRestoreManualState: true/);
});
test('a microtask that edits just after the awaited preflight still prevents persistence', async () => {
  const h = transactionHarness(); let changed = false;
  h.deps.assertTarget = async () => { queueMicrotask(() => { changed = true; }); };
  h.deps.assertCurrentSync = () => { if (changed) throw failure('ARTICLE_WORKSPACE_RESTORE_MANUAL_CHANGED'); };
  await assert.rejects(h.run, /MANUAL_CHANGED/); assert.equal(h.calls.includes('persist'), false); assert.equal(h.calls.includes('apply'), false);
});
test('a microtask at the prepared response boundary prevents page apply and retains durable fact', async () => {
  const h = transactionHarness(); let changed = false;
  h.deps.assertCurrentSync = () => { if (changed) throw failure('ARTICLE_WORKSPACE_RESTORE_MANUAL_CHANGED'); };
  h.deps.commitPrepared = async () => { queueMicrotask(() => { changed = true; }); return { committed: true, persistenceCommitted: true, restore: { assets: [] } }; };
  const result = await h.run(); assert.equal(result.persistenceCommitted, true); assert.equal(result.workspaceApplied, false); assert.equal(h.calls.includes('apply'), false);
});
test('completed manual IPC still changes the baseline before the awaiting caller applies its record', async () => {
  let release;
  const send = executable('sendManualMessage', { chrome: { runtime: { sendMessage: () => new Promise(resolve => { release = resolve; }) } } });
  const h = readerHarness(); h.deps.sendManualMessage = send;
  const before = JSON.stringify(h.read().fields); const pending = send({ type: 'ANNOTATION_UPSERT' });
  assert.equal(h.read().pending, true); release({ success: true, data: { record: { annotations: ['new'] } } });
  await pending; assert.equal(h.read().pending, false);
  assert.notEqual(JSON.stringify(h.read().fields), before);
  assert.deepEqual(h.deps.currentManualDocument.record.annotations, [], 'the caller has not yet projected the response');
});
