const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const setupSource = fs.readFileSync(path.join(__dirname, 'article-workspace-atomic-restore.test.js'), 'utf8');
const setupEnd = setupSource.indexOf("\ntest('capture returns");
assert.ok(setupEnd > 0);
const { fixture, identity, id } = Function('require', '__dirname',
  setupSource.slice(0, setupEnd) + '\nreturn {fixture, identity, id};')(require, __dirname);
const SciLLM = require('../core/local-library-tags');
const { buildLocalReadingLibrary, queryLocalReadingLibrary } = require('../core/local-reading-library');
require('../core/analysis-cache');
require('../core/corpus-store');
require('../core/operation-control');
require('../core/document-store');
const { createBackgroundRouter } = require('../core/background-router');
const source = fs.readFileSync(path.join(__dirname, '../options-local-library.js'), 'utf8');
const begin = source.indexOf('  async function readTagBase(');
const end = source.indexOf('  function tagEditorDirty(');
assert.ok(begin >= 0 && end > begin);
const tagPath = SciLLM.LOCAL_LIBRARY_TAGS_ASSET_PATH;
const content = (workspaceId, tags) => ({ schemaVersion: 1, workspaceId, tags });

function editorApi(router) {
  const calls = [];
  const chrome = { runtime: { sendMessage: async message => {
    calls.push(structuredClone(message));
    return router.handle(message);
  } } };
  return { calls, ...Function('SciLLM', 'chrome', source.slice(begin, end) +
    ';return {readTagBase,saveTagDraft};')(SciLLM, chrome) };
}

function routerFor(store) {
  const values = {};
  return createBackgroundRouter({
    storageArea: { get(key, callback) { callback({ [key]: values[key] }); },
      set(input, callback) { Object.assign(values, input); callback?.(); } },
    articleWorkspaceStore: store,
    fetchImpl: async () => { throw new Error('review must not call a provider'); }
  });
}

async function libraryArticle(store, workspaceId) {
  const workspace = await store.getWorkspace(workspaceId);
  return queryLocalReadingLibrary(buildLocalReadingLibrary({ workspaces: [workspace],
    assetsByWorkspace: new Map([[workspaceId, await store.listAssets(workspaceId)]]),
    globalMemory: { entries: [] } }), { kind: 'articles' }).items[0];
}

test('an old-generation tag asset rejected by the list cannot become an editable save base', async () => {
  const { store } = await fixture();
  await store.putAsset(id, tagPath, content(id, ['旧代次人工标签']));
  // These are actual public store operations, not manually corrupted IDB rows.
  await store.ensureWorkspace(identity({ workspaceGeneration: 2 }));
  const article = await libraryArticle(store, id);
  assert.equal(article.tagState, 'invalid');
  assert.equal(article.workspaceGeneration, 2);
  const before = await store.getAsset(id, tagPath);
  assert.equal(before.workspaceGeneration, 1);
  const ui = editorApi(routerFor(store));
  await assert.rejects(() => ui.readTagBase(id, article.workspaceGeneration),
    undefined, 'an invalid prior-generation row must not unlock the tag editor');
  assert.deepEqual(await store.getAsset(id, tagPath), before);
});

test('current-generation tag asset keeps a real generation-bound CAS round trip', async () => {
  const { store } = await fixture();
  await store.putAsset(id, tagPath, content(id, ['当前']));
  const ui = editorApi(routerFor(store));
  const base = await ui.readTagBase(id, 1);
  const saved = await ui.saveTagDraft(id, base, ['当前', '补充']);
  assert.equal(saved.saved, true);
  assert.equal(saved.asset.revision, 2);
  assert.deepEqual((await store.getAsset(id, tagPath)).content.tags, ['当前', '补充']);
  assert.equal(ui.calls[1].workspaceGeneration, 1);
  assert.equal(ui.calls[1].expectedRevision, 1);
});

test('invalid prior-generation tags cannot be overwritten through the actual UI helpers and SAVE route', async () => {
  const { store } = await fixture();
  await store.putAsset(id, tagPath, content(id, ['必须保留的旧代次标签']));
  await store.ensureWorkspace(identity({ workspaceGeneration: 2 }));
  const before = await store.getAsset(id, tagPath);
  assert.equal((await libraryArticle(store, id)).tagState, 'invalid');
  const ui = editorApi(routerFor(store));
  let base;
  try { base = await ui.readTagBase(id, 2); } catch (_) { /* required rejection */ }
  if (base) await ui.saveTagDraft(id, base, ['替换后的标签']);
  assert.deepEqual(await store.getAsset(id, tagPath), before,
    'invalid tag data must remain intact instead of being silently rebound to the current generation');
  assert.equal(ui.calls.some(call => call.type === 'ARTICLE_WORKSPACE_SAVE_ASSET'), false);
});

test('same-title papers route tag edits by distinct workspace identities', async () => {
  const { store } = await fixture();
  const second = identity({ workspaceId: 'workspace:' + 'b'.repeat(64),
    canonicalUrl: 'https://example.org/second', directoryName: 'Second--' + 'b'.repeat(12) });
  await store.ensureWorkspace(second);
  assert.equal(second.title, identity().title);
  await store.putAsset(id, tagPath, content(id, ['甲']));
  await store.putAsset(second.workspaceId, tagPath, content(second.workspaceId, ['乙']));
  const ui = editorApi(routerFor(store));
  const a = await ui.readTagBase(id, 1);
  const b = await ui.readTagBase(second.workspaceId, 1);
  await ui.saveTagDraft(second.workspaceId, b, []);
  assert.deepEqual((await store.getAsset(id, tagPath)).content.tags, a.tags);
  assert.deepEqual((await store.getAsset(second.workspaceId, tagPath)).content.tags, []);
  assert.equal(ui.calls[2].workspaceId, second.workspaceId);
});

test('foreign content owner remains blocked through the actual GET route', async () => {
  const { store } = await fixture();
  await store.putAsset(id, tagPath, content('workspace:' + 'b'.repeat(64), ['不能采用']));
  const ui = editorApi(routerFor(store));
  await assert.rejects(() => ui.readTagBase(id, 1));
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0].type, 'ARTICLE_WORKSPACE_GET_ASSET');
});
