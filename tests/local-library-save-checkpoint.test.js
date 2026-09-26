const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../core/privacy-sanitizer');
require('../core/article-workspace');
const api = require('../core/article-workspace-save');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
function executable(name, deps = {}) {
  let start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const offset = source.slice(start + 1).search(/\n(?:async )?function /u);
  assert.ok(offset > 0, name);
  return Function(...Object.keys(deps), `return (${source.slice(start, start + 1 + offset)});`)(...Object.values(deps));
}
const identity = { workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 2,
  canonicalUrl: 'https://example.org/paper' };
const event = { ...identity, operationId: 'save:first', scope: 'browser-local',
  status: 'complete', completedAt: '2026-09-23T01:00:00.000Z' };
function harness(previous = null) {
  const state = { previous, writes: [], reads: 0, stale: false, conflicts: 0, receipt: { saved: true } };
  const deps = { SciLLM: api, articleWorkspaceLifecycleGeneration: 9,
    assertCurrentArticleWorkspaceLifecycle: lifecycle => {
      assert.equal(lifecycle, 9); if (state.stale) throw Error('LIFECYCLE_CHANGED');
    },
    getWorkspaceAssetCheckpoint: async (relativePath, options) => {
      assert.equal(relativePath, api.LOCAL_LIBRARY_SAVE_EVENTS_ASSET_PATH);
      assert.equal(options.workspace, identity); assert.equal(options.includeWorkspaceGeneration, true);
      state.reads++; return state.previous;
    },
    persistWorkspaceAssetCheckpoint: async (relativePath, value, options) => {
      if (state.conflicts-- > 0) throw Object.assign(Error('ASSET_REVISION_CONFLICT'), { code: 'ASSET_REVISION_CONFLICT' });
      state.writes.push({ relativePath, value, options }); return state.receipt;
    }
  };
  return { state, save: executable('persistLocalLibrarySaveEvent', deps) };
}
test('explicit receipt uses the fixed identity, actual generation and compare-and-swap checkpoint', async () => {
  const h = harness();
  const result = await h.save(event, { workspace: identity, expectedLifecycle: 9 });
  assert.equal(result.recorded, true); assert.equal(result.asset.lastSavedAt, event.completedAt);
  assert.deepEqual(h.state.writes[0].options, { force: true, expectedRevision: 0,
    expectedContentHash: undefined, createOnly: true, workspace: identity, expectedLifecycle: 9 });
});
test('one bounded conflict reread retains frozen event time and no-op does not write', async () => {
  const h = harness(); h.state.conflicts = 1;
  const result = await h.save(event, { workspace: identity, expectedLifecycle: 9 });
  assert.equal(h.state.reads, 2); assert.equal(result.asset.lastSavedAt, event.completedAt);
  h.state.previous = { content: result.asset, workspaceGeneration: 2, revision: 3, contentHash: 'hash' };
  const repeated = await h.save({ ...event, completedAt: '2026-09-24T01:00:00.000Z' },
    { workspace: identity, expectedLifecycle: 9 });
  assert.equal(repeated.recorded, false); assert.equal(h.state.writes.length, 1);
  h.state.conflicts = 2;
  await assert.rejects(h.save({ ...event, operationId: 'save:new', completedAt: '2026-09-25T01:00:00.000Z' },
    { workspace: identity, expectedLifecycle: 9 }), /ASSET_REVISION_CONFLICT/);
});
test('invalid previous/owner/generation and stale lifecycle refuse event writes', async () => {
  for (const previous of [{ workspaceGeneration: 1, content: {} }, { workspaceGeneration: 2, content: {} },
    { workspaceGeneration: 2, content: null }, { workspaceGeneration: 2, content: false }]) {
    const h = harness(previous);
    await assert.rejects(h.save(event, { workspace: identity, expectedLifecycle: 9 }), /SAVE_EVENTS_ASSET_INVALID/);
    assert.equal(h.state.writes.length, 0);
  }
  const h = harness();
  await assert.rejects(h.save({ ...event, workspaceId: `workspace:${'b'.repeat(64)}` },
    { workspace: identity, expectedLifecycle: 9 }), /SAVE_EVENT_INVALID/);
  h.state.stale = true;
  await assert.rejects(h.save(event, { workspace: identity, expectedLifecycle: 9 }), /LIFECYCLE_CHANGED/);
  assert.equal(h.state.writes.length, 0);
});

function explicitHarness() {
  const state = { events: [], stages: [], stale: false, offlineFailure: false, eventFailure: false,
    contentResults: [{ saved: true }], autosaves: 0 };
  const workspace = { ...identity };
  const deps = { SciLLM: api, articleWorkspaceExplicitSaveState: {},
    articleWorkspaceLifecycleGeneration: 9, articleWorkspaceSaveTimer: null,
    articleWorkspaceMutationTail: Promise.resolve(), currentArticleWorkspace: workspace,
    ensureCurrentArticleWorkspace: async () => workspace, supplementalFigureAssets: [],
    refreshSupplementalFigureAssets: async () => [],
    assertCurrentArticleWorkspaceLifecycle: () => { if (state.stale) throw Error('LIFECYCLE_CHANGED'); },
    captureArticleWorkspaceAssets: () => new Map([['article/structure.json', {}]]),
    articleChatState: { turns: [] }, publicArticleChatTurn: value => value,
    buildArticleWorkspaceSnapshot: () => ({ revision: 1 }), currentManualDocument: null,
    collectCompleteExportFigures: () => [], reportArticleWorkspaceSaveProgress: () => {},
    persistWorkspaceTurnCheckpoint: async () => ({ saved: true }),
    persistArticleWorkspaceArtifacts: async ({ assets }) => {
      state.stages.push('assets');
      return { saved: true, results: assets.size ? state.contentResults : [], warnings: [] };
    },
    persistOfflineArticleSnapshot: async () => {
      state.stages.push('offline'); if (state.offlineFailure) throw Error('offline failed');
      return { saved: true, asset: { saved: true } };
    },
    persistLocalLibrarySaveEvent: async (event, options) => {
      assert.deepEqual(state.stages, ['assets', 'assets', 'offline']);
      assert.equal(options.workspace, workspace); assert.equal(options.expectedLifecycle, 9);
      state.events.push(event); if (state.eventFailure) throw Error('event unavailable');
      return { recorded: true, asset: api.recordLocalLibrarySaveEvent(null, event).asset };
    },
    scheduleArticleWorkspaceArtifactsSave: () => state.autosaves++
  };
  deps.isArticleWorkspaceLocalSaveComplete = executable('isArticleWorkspaceLocalSaveComplete');
  return { state, deps, save: executable('saveCurrentArticleWorkspaceNow', deps) };
}
test('actual explicit-save function records once after all stages and releases paused autosaves', async () => {
  const h = explicitHarness();
  const first = h.save('save:actual');
  const duplicate = h.save('save:ignored-while-active');
  h.deps.articleWorkspaceExplicitSaveState.pendingAutosave = true;
  const [a, b] = await Promise.all([first, duplicate]);
  assert.equal(a, b); assert.equal(a.saveStatus, 'complete');
  assert.equal(h.state.events.length, 1); assert.equal(h.state.events[0].operationId, 'save:actual');
  assert.equal(h.state.events[0].scope, 'browser-local');
  assert.equal(h.state.autosaves, 1); assert.equal(h.deps.articleWorkspaceExplicitSaveState.paused, false);
});
test('offline error or non-durable artifact records partial; event write failure remains visible', async () => {
  for (const variant of ['offline', 'artifact', 'event']) {
    const h = explicitHarness();
    if (variant === 'offline') h.state.offlineFailure = true;
    if (variant === 'artifact') h.state.contentResults = [{ saved: false, frozen: true }];
    if (variant === 'event') h.state.eventFailure = true;
    const result = await h.save(`save:${variant}`);
    if (variant === 'event') {
      assert.equal(result.saveEvent.recorded, false);
      assert.equal(result.warnings.at(-1).code, 'LOCAL_LIBRARY_SAVE_EVENT_PERSIST_FAILED');
    } else {
      assert.equal(h.state.events[0].status, 'partial');
      assert.equal(result.saveEvent.asset.lastSavedAt, '');
    }
  }
});
test('lifecycle change prevents event recording and never reports successful current save', async () => {
  const h = explicitHarness(); h.state.stale = true;
  await assert.rejects(h.save('save:stale'), /LIFECYCLE_CHANGED/);
  assert.equal(h.state.events.length, 0); assert.equal(h.deps.articleWorkspaceExplicitSaveState.paused, false);
});
test('non-durable frozen or stale receipts cannot claim the event was recorded', async () => {
  for (const receipt of [{ saved: false, frozen: true }, { saved: false, stale: true }, null]) {
    const h = harness(); h.state.receipt = receipt;
    await assert.rejects(h.save(event, { workspace: identity, expectedLifecycle: 9 }), /SAVE_EVENT_PERSIST_FAILED/);
  }
});
test('complete local save requires positive receipts including nested offline and parent results', () => {
  const complete = executable('isArticleWorkspaceLocalSaveComplete');
  const base = { turnResults: [{ saved: true }], warnings: [],
    contentArtifacts: { saved: true, results: [{ saved: false, unchanged: true }] },
    figureArtifacts: { saved: true, results: [{ success: true }] }, offlineSnapshot: { disabled: true } };
  assert.equal(complete(base), true);
  assert.equal(complete({ ...base, offlineSnapshot: { saved: true, asset: { saved: true, directoryPersisted: false } } }), true);
  for (const altered of [
    { warnings: [{ warning: true }] }, { turnResults: [{ stale: true }] },
    { contentArtifacts: { frozen: true } }, { contentArtifacts: { saved: true, results: [{ frozen: true }] } },
    { figureArtifacts: { saved: true, results: [{ success: false }] } },
    { figureArtifacts: { saved: true, results: [], supplementalParentSync: { error: 'FAILED' } } },
    { offlineSnapshot: { saved: true, asset: { saved: false, frozen: true } } },
    { offlineSnapshot: { error: 'FAILED' } }, { offlineSnapshot: null }
  ]) assert.equal(complete({ ...base, ...altered }), false, JSON.stringify(altered));
});
test('library projects only the explicit complete save event, never workspace update time', () => {
  const { buildLocalReadingLibrary, queryLocalReadingLibrary } = require('../core/local-reading-library');
  const content = api.recordLocalLibrarySaveEvent(null, event).asset;
  const asset = { relativePath: api.LOCAL_LIBRARY_SAVE_EVENTS_ASSET_PATH, workspaceId: identity.workspaceId,
    workspaceGeneration: 2, content };
  const item = assets => queryLocalReadingLibrary(buildLocalReadingLibrary({
    workspaces: [{ ...identity, title: 'Scientific title', updatedAt: '2099-01-01T00:00:00.000Z' }],
    assetsByWorkspace: new Map([[identity.workspaceId, assets]]) }), { kind: 'articles' }).items[0];
  assert.equal(item([asset]).savedAt, event.completedAt);
  const partial = api.recordLocalLibrarySaveEvent(content, { ...event, operationId: 'save:partial',
    completedAt: '2026-09-24T01:00:00.000Z', status: 'partial' }).asset;
  assert.equal(item([{ ...asset, content: partial }]).savedAt, event.completedAt);
  assert.equal(item([]).savedAt, '');
  for (const changed of [{ workspaceGeneration: 1 }, { workspaceId: `workspace:${'b'.repeat(64)}` },
    { content: { ...content, canonicalUrl: 'https://example.org/other' } },
    { content: { ...content, schemaVersion: 9 } }]) assert.equal(item([{ ...asset, ...changed }]).savedAt, '');
});
