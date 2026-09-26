const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../core/user-data-database');
require('../core/article-workspace');
require('../core/analysis-cache');
require('../core/corpus-store');
require('../core/document-store');
const saveApi = require('../core/article-workspace-save');
const { createIndexedDbArticleWorkspaceStore } = require('../core/article-workspace-store');
const { createBackgroundRouter } = require('../core/background-router');
const { buildLocalReadingLibrary, queryLocalReadingLibrary } = require('../core/local-reading-library');

const fixtureSource = fs.readFileSync(path.join(__dirname, 'article-workspace-store.test.js'), 'utf8');
const fixtureStart = fixtureSource.indexOf('function createFakeIndexedDb(');
const fixtureEnd = fixtureSource.indexOf('\nfunction workspace(', fixtureStart);
assert.ok(fixtureStart >= 0 && fixtureEnd > fixtureStart);
const fakeIndexedDb = Function(fixtureSource.slice(fixtureStart, fixtureEnd) + '\nreturn createFakeIndexedDb;')();
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
function functionSource(name) {
  let start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const length = source.slice(start + 1).search(/\n(?:async )?function /u);
  assert.ok(length > 0, name);
  return source.slice(start, start + 1 + length);
}
const ASSET = saveApi.LOCAL_LIBRARY_SAVE_EVENTS_ASSET_PATH;
const T1 = '2026-09-23T00:01:00.000Z';
const T2 = '2026-09-23T00:02:00.000Z';
const T3 = '2026-09-23T00:03:00.000Z';

async function setup() {
  const fake = fakeIndexedDb();
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb, { now: () => T1 });
  const identity = { schemaVersion: 1, workspaceId: `workspace:${'a'.repeat(64)}`, workspaceGeneration: 2,
    canonicalUrl: 'https://example.org/lib010-save-review', title: 'Scientific paper', aliases: [],
    directoryName: 'LIB010-save-review--aaaaaaaaaaaa', contentHash: 'b'.repeat(64), revision: 'b'.repeat(64) };
  await store.ensureWorkspace(identity);
  const storage = {};
  const router = createBackgroundRouter({ articleWorkspaceStore: store,
    storageArea: { get(key, callback) { callback({ [key]: storage[key] }); },
      set(value, callback) { Object.assign(storage, value); callback?.(); } },
    fetchImpl: async () => { throw Error('OFFLINE_ONLY'); } });
  const state = { requests: [], beforeSend: null };
  const env = {
    SciLLM: globalThis.SciLLM, currentArticleWorkspace: identity,
    articleWorkspaceLifecycleGeneration: 7, articleWorkspaceMutationTail: Promise.resolve(),
    articleWorkspaceSaveFrozen: false, articleWorkspaceAssetFingerprints: new Map(),
    articleWorkspaceRestorePersistenceGate: { allows: () => false },
    articleWorkspaceAssetFingerprint: value => JSON.stringify(value),
    ensureCurrentArticleWorkspace: async () => identity,
    assertCurrentArticleWorkspaceLifecycle(value) { assert.equal(value, 7); },
    chrome: { runtime: { async sendMessage(message) {
      state.requests.push(structuredClone(message));
      if (state.beforeSend) await state.beforeSend(message);
      return router.handle(message);
    } } }
  };
  vm.createContext(env);
  vm.runInContext(['getWorkspaceAssetCheckpoint', 'persistWorkspaceAssetCheckpoint',
    'persistLocalLibrarySaveEvent', 'isArticleWorkspaceLocalSaveComplete']
    .map(functionSource).join('\n'), env);
  const event = (operationId = 'save:first', completedAt = T1, status = 'complete', extra = {}) => ({
    workspaceId: identity.workspaceId, canonicalUrl: identity.canonicalUrl,
    workspaceGeneration: identity.workspaceGeneration, operationId, completedAt, status, scope: 'browser-local', ...extra
  });
  const save = next => env.persistLocalLibrarySaveEvent(next, { workspace: identity, expectedLifecycle: 7 });
  const stored = () => store.getAsset(identity.workspaceId, ASSET);
  const projection = async () => queryLocalReadingLibrary(buildLocalReadingLibrary({
    workspaces: [await store.getWorkspace(identity.workspaceId)],
    assetsByWorkspace: new Map([[identity.workspaceId, await store.listAssets(identity.workspaceId)]])
  }), { kind: 'articles' }).items[0];
  return { fake, store, router, identity, state, env, event, save, stored, projection };
}

test('review: real content GET/SAVE router/store CAS records first and duplicate/partial without fake history', async () => {
  const h = await setup();
  assert.equal((await h.projection()).savedAt, '');
  assert.equal((await h.save(h.event())).recorded, true);
  const first = await h.stored();
  assert.equal(first.revision, 1);
  assert.equal(first.workspaceGeneration, 2);
  assert.equal((await h.projection()).savedAt, T1);
  assert.equal((await h.save(h.event('save:first', T3))).recorded, false);
  assert.deepEqual(await h.stored(), first);
  await h.save(h.event('save:partial', T2, 'partial'));
  assert.equal((await h.stored()).content.lastAttempt.status, 'partial');
  assert.equal((await h.projection()).savedAt, T1);
  await h.store.putAsset(h.identity.workspaceId, 'article/structure.json', { title: 'Later extraction' });
  assert.equal((await h.projection()).savedAt, T1);
});

test('review: an actually newer concurrent event wins and original completion time remains frozen on CAS retry', async () => {
  const h = await setup();
  await h.save(h.event());
  let injected = false;
  h.state.beforeSend = async message => {
    if (message.type !== 'ARTICLE_WORKSPACE_SAVE_ASSET' || injected) return;
    injected = true;
    const current = await h.stored();
    const newer = saveApi.recordLocalLibrarySaveEvent(current.content, h.event('save:other-tab', T3)).asset;
    await h.store.putAsset(h.identity.workspaceId, ASSET, newer,
      { expectedRevision: current.revision, expectedContentHash: current.contentHash });
  };
  const result = await h.save(h.event('save:delayed', T2));
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'out-of-order');
  assert.equal((await h.stored()).revision, 2);
  assert.equal((await h.stored()).content.operationId, 'save:other-tab');
  assert.equal((await h.projection()).savedAt, T3);
});

test('review: definite CAS conflict rereads an earlier concurrent event and preserves its first completion', async () => {
  const h = await setup();
  let injected = false;
  h.state.beforeSend = async message => {
    if (message.type !== 'ARTICLE_WORKSPACE_SAVE_ASSET' || injected) return;
    injected = true;
    await h.store.putAsset(h.identity.workspaceId, ASSET,
      saveApi.recordLocalLibrarySaveEvent(null, h.event('save:earlier', T1)).asset, { createOnly: true });
  };
  assert.equal((await h.save(h.event('save:later', T2))).recorded, true);
  const value = await h.stored();
  assert.equal(value.revision, 2);
  assert.equal(value.content.firstRecordedAt, T1);
  assert.equal(value.content.lastSavedAt, T2);
  const attempts = h.state.requests.filter(message => message.type === 'ARTICLE_WORKSPACE_SAVE_ASSET');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].content.lastSavedAt, T2);
  assert.equal(attempts[1].content.lastSavedAt, T2);
});

test('review: old-generation envelopes are rejected by actual GET and never projected as a current save', async () => {
  const h = await setup();
  await h.save(h.event());
  const old = await h.stored();
  await h.store.ensureWorkspace({ ...h.identity, workspaceGeneration: 3 });
  const response = await h.router.handle({ type: 'ARTICLE_WORKSPACE_GET_ASSET',
    workspaceId: h.identity.workspaceId, workspaceGeneration: 3, relativePath: ASSET });
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'WORKSPACE_GENERATION_CONFLICT');
  assert.equal((await h.projection()).savedAt, '');
  await assert.rejects(h.save(h.event('save:old-context', T2)));
  assert.deepEqual(await h.stored(), old);
});

test('review: generation changing after router validation must reject before a real asset transaction writes', async () => {
  const h = await setup();
  await h.save(h.event());
  const before = await h.stored();
  const put = h.store.putAsset;
  let upgraded = false;
  h.store.putAsset = async (...args) => {
    if (!upgraded) {
      upgraded = true;
      await h.store.ensureWorkspace({ ...h.identity, workspaceGeneration: 3 });
    }
    return put(...args);
  };
  let rejected = false;
  try { await h.save(h.event('save:old-generation-in-flight', T2)); } catch (_) { rejected = true; }
  const after = await h.stored();
  assert.ok(rejected, `old request unexpectedly committed ${JSON.stringify({ generation: after.workspaceGeneration,
    eventGeneration: after.content.workspaceGeneration, lastSavedAt: after.content.lastSavedAt })}`);
  assert.deepEqual(after, before, 'old event must not overwrite even the retained old-generation row');
});

for (const raw of [null, false, 0, '']) {
  test(`review: existing ${JSON.stringify(raw)} event content is invalid history, not absence`, async () => {
    const h = await setup();
    await h.store.putAsset(h.identity.workspaceId, ASSET, raw);
    const before = await h.stored();
    await assert.rejects(h.save(h.event()), /LOCAL_LIBRARY_SAVE_EVENTS_ASSET_INVALID/);
    assert.deepEqual(await h.stored(), before);
    assert.equal((await h.projection()).savedAt, '');
  });
}

test('review: failed content/turn/offline receipts never yield complete, queued directory status does not mean local failure', async () => {
  const h = await setup();
  const complete = h.env.isArticleWorkspaceLocalSaveComplete;
  const healthy = { warnings: [], turnResults: [{ saved: true, queued: false }],
    contentArtifacts: { saved: true, results: [{ saved: false, unchanged: true }] },
    figureArtifacts: { saved: true, results: [{ success: true, unchanged: true }] },
    offlineSnapshot: { saved: true, asset: { saved: true, directoryPersisted: false } } };
  assert.equal(complete(healthy), true);
  for (const changed of [
    { contentArtifacts: { saved: true, results: [{ saved: false, warning: true, code: 'ASSET_REVISION_CONFLICT' }] } },
    { figureArtifacts: { saved: true, results: [{ success: false, warning: true }] } },
    { turnResults: [{ saved: false, frozen: true }] },
    { offlineSnapshot: { saved: true, asset: { saved: false, stale: true } } },
    { offlineSnapshot: { saved: false, error: 'FAILED' } },
    { warnings: [{ warning: true, unsafeSkipped: true }] }
  ]) {
    const status = complete({ ...healthy, ...changed }) ? 'complete' : 'partial';
    assert.equal(status, 'partial');
    const fixture = await setup();
    await fixture.save(fixture.event());
    await fixture.save(fixture.event('save:partial', T2, status));
    assert.equal((await fixture.projection()).savedAt, T1);
  }
});

test('review: the actual explicit-save ending writes partial on offline failure and advances success only after complete receipts', async () => {
  for (const shouldComplete of [false, true]) {
    const h = await setup();
    await h.save(h.event());
    Object.assign(h.env, {
      clearTimeout, crypto: globalThis.crypto,
      Date: class extends Date {
        constructor(...args) { super(...(args.length ? args : [T3])); }
        static now() { return Date.parse(T3); }
      },
      articleWorkspaceSaveTimer: null,
      articleWorkspaceExplicitSaveState: { active: null, paused: false, lifecycle: -1, pendingAutosave: false },
      supplementalFigureAssets: [], refreshSupplementalFigureAssets: async () => [],
      captureArticleWorkspaceAssets: () => new Map(), articleChatState: { turns: [] },
      buildArticleWorkspaceSnapshot: () => ({ revision: 1 }), currentManualDocument: { record: { annotations: [] } },
      collectCompleteExportFigures: () => [], reportArticleWorkspaceSaveProgress() {},
      persistArticleWorkspaceArtifacts: async () => ({ saved: true, results: [], warnings: [] }),
      persistOfflineArticleSnapshot: async () => shouldComplete
        ? { saved: true, asset: { saved: true, directoryPersisted: false } }
        : { saved: false, error: 'OFFLINE_FAILED' }
    });
    // This runs the actual explicit-save control flow. Artifact construction is
    // represented by receipts; event GET/SAVE + router + store/CAS remain real.
    const explicitSave = Function('deps', `with (deps) { return (${functionSource('saveCurrentArticleWorkspaceNow')}); }`)(h.env);
    const result = await explicitSave(`save:explicit-${shouldComplete}`);
    assert.equal(result.saveStatus, shouldComplete ? 'complete' : 'partial');
    assert.equal(result.saveEvent.recorded, true);
    assert.equal((await h.projection()).savedAt, shouldComplete ? T3 : T1);
    assert.equal((await h.stored()).content.lastAttempt.status, shouldComplete ? 'complete' : 'partial');
  }
});

test('review: optional store generation guard preserves existing omitted/undefined behavior and accepts a matching generation', async () => {
  const h = await setup();
  const assetPath = 'article/review-generation.json';
  const first = await h.store.putAsset(h.identity.workspaceId, assetPath, { step: 1 });
  assert.equal(first.workspaceGeneration, 2);
  const second = await h.store.putAsset(h.identity.workspaceId, assetPath, { step: 2 }, {
    expectedWorkspaceGeneration: undefined, expectedRevision: first.revision, expectedContentHash: first.contentHash
  });
  assert.equal(second.revision, first.revision + 1);
  const third = await h.store.putAsset(h.identity.workspaceId, assetPath, { step: 3 }, {
    expectedWorkspaceGeneration: 2, expectedRevision: second.revision, expectedContentHash: second.contentHash
  });
  assert.equal(third.revision, second.revision + 1);
  assert.deepEqual(third.content, { step: 3 });
});

test('review: invalid or mismatched optional generation causes zero workspace/asset writes', async () => {
  const h = await setup();
  const assetPath = 'article/review-generation.json';
  const existing = await h.store.putAsset(h.identity.workspaceId, assetPath, { retained: 'scientific value: p = 0.12' });
  const beforeBaseline = await h.store.captureRestoreBaseline(h.identity.workspaceId);
  const beforeAssets = await h.store.listAssets(h.identity.workspaceId);
  for (const expectedWorkspaceGeneration of [null, 0, -1, 1.5, '2', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1, 3]) {
    await assert.rejects(h.store.putAsset(h.identity.workspaceId, assetPath, { erased: true }, {
      expectedWorkspaceGeneration, expectedRevision: existing.revision, expectedContentHash: existing.contentHash
    }), { code: 'WORKSPACE_GENERATION_CONFLICT' });
    assert.deepEqual(await h.store.captureRestoreBaseline(h.identity.workspaceId), beforeBaseline);
    assert.deepEqual(await h.store.listAssets(h.identity.workspaceId), beforeAssets);
  }
});
