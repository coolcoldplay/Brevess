const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../core/article-bibliography.js');
const { buildLocalReadingLibrary, queryLocalReadingLibrary } = require('../core/local-reading-library.js');
const storeSetup = fs.readFileSync(path.join(__dirname, 'article-workspace-atomic-restore.test.js'), 'utf8');
const setupEnd = storeSetup.indexOf("\ntest('capture returns");
assert.ok(setupEnd > 0);
const { fixture, identity, id } = Function('require', '__dirname', storeSetup.slice(0, setupEnd) +
  '\nreturn {fixture, identity, id};')(require, __dirname);
require('../core/analysis-cache');
require('../core/corpus-store');
require('../core/operation-control');
require('../core/document-store');
const { createBackgroundRouter } = require('../core/background-router');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const ASSET = api.ARTICLE_BIBLIOGRAPHY_ASSET_PATH;
function executable(name, deps) {
  let start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const offset = source.slice(start + 1).search(/\n(?:async )?function /u);
  assert.ok(offset > 0);
  return Function(...Object.keys(deps), `return (${source.slice(start, start + 1 + offset)});`)(...Object.values(deps));
}
function doc(metas) {
  return { title: 'Scientific title', head: { querySelectorAll: () => metas.map(([name, content]) => ({
    getAttribute: key => key === 'name' ? name : key === 'content' ? content : null
  })) } };
}
function value(metas, owner = identity()) {
  return { ...api.extractArticleBibliography(doc(metas), owner), workspaceId: owner.workspaceId };
}
function routerFor(store) {
  const values = {};
  return createBackgroundRouter({ articleWorkspaceStore: store,
    storageArea: { get(key, callback) { callback({ [key]: values[key] }); },
      set(input, callback) { Object.assign(values, input); callback?.(); } },
    fetchImpl: async () => { throw new Error('No network in review'); } });
}
async function harness(generation = 1) {
  const f = await fixture();
  const workspace = await f.store.ensureWorkspace(identity({ workspaceGeneration: generation }));
  const router = routerFor(f.store);
  const calls = [];
  const deps = { SciLLM: api, articleWorkspaceLifecycleGeneration: 5,
    ensureCurrentArticleWorkspace: async () => workspace,
    assertCurrentArticleWorkspaceLifecycle: actual => assert.equal(actual, 5),
    chrome: { runtime: { sendMessage: async message => {
      calls.push(structuredClone(message)); return router.handle(message);
    } } },
    persistWorkspaceAssetCheckpoint: async (relativePath, content, options) => {
      const message = { type: 'ARTICLE_WORKSPACE_SAVE_ASSET', relativePath, content,
        workspaceId: options.workspace.workspaceId,
        workspaceGeneration: options.workspace.workspaceGeneration,
        expectedRevision: options.expectedRevision, expectedContentHash: options.expectedContentHash,
        createOnly: options.createOnly };
      calls.push(structuredClone(message));
      const response = await router.handle(message);
      if (!response.success) throw Object.assign(Error(response.error.message), { code: response.error.code });
      return response.data;
    }
  };
  deps.getWorkspaceAssetCheckpoint = executable('getWorkspaceAssetCheckpoint', deps);
  return { ...f, workspace, router, calls,
    save: executable('persistArticleBibliographyCheckpoint', deps) };
}
async function item(f) {
  const workspace = await f.store.getWorkspace(id);
  return queryLocalReadingLibrary(buildLocalReadingLibrary({ workspaces: [workspace],
    assetsByWorkspace: new Map([[id, await f.store.listAssets(id)]]) }), { kind: 'articles' }).items[0];
}

test('current generation 2 metadata remains writable after an actual public GET round trip', async () => {
  const f = await harness(2);
  const original = value([['citation_journal_title', 'Journal β'], ['citation_date', '2020/02']]);
  await f.save(original);
  assert.equal((await item(f)).publicationDate, '2020-02');
  const get = await f.router.handle({ type: 'ARTICLE_WORKSPACE_GET_ASSET', workspaceId: id,
    workspaceGeneration: 2, relativePath: ASSET });
  assert.equal(get.success, true, JSON.stringify(get));
  assert.equal(get.data.workspaceGeneration, 2);
  await f.save(value([['citation_date', '2024/02']]));
  const saved = await f.store.getAsset(id, ASSET);
  assert.equal(saved.workspaceGeneration, 2);
  assert.equal(saved.content.journal.value, 'Journal β');
  assert.equal(saved.content.publicationDate.value, '2024-02');
});

test('repeat partial collection keeps complete raw field evidence through actual GET/CAS/library projection', async () => {
  const f = await harness();
  const original = value([['citation_journal_title', '  Journal µRNA 🧬  '], ['citation_date', '2024/02']]);
  await f.store.putAsset(id, ASSET, original);
  await f.save(value([['citation_date', '2024/02']]));
  const saved = await f.store.getAsset(id, ASSET);
  assert.deepEqual(saved.content.journal, original.journal);
  assert.deepEqual(saved.content.publicationDate, original.publicationDate);
  assert.equal(saved.content.publicationDate.day, null);
  const row = await item(f);
  assert.equal(row.journal, 'Journal µRNA 🧬');
  assert.equal(row.publicationDate, '2024-02');
  assert.equal(row.publicationDatePrecision, 'month');
  assert.ok(f.calls.some(call => call.type === 'ARTICLE_WORKSPACE_SAVE_ASSET' && call.expectedRevision === 1));
});

test('old-generation envelope is rejected by actual GET and cannot be merged into generation 2', async () => {
  const f = await harness();
  const original = value([['citation_journal_title', 'Keep old source'], ['citation_date', '2024']]);
  await f.store.putAsset(id, ASSET, original);
  await f.store.ensureWorkspace(identity({ workspaceGeneration: 2 }));
  const before = await f.store.getAsset(id, ASSET);
  const result = await f.router.handle({ type: 'ARTICLE_WORKSPACE_GET_ASSET', workspaceId: id,
    workspaceGeneration: 2, relativePath: ASSET });
  assert.equal(result.error?.code, 'WORKSPACE_GENERATION_CONFLICT');
  await assert.rejects(f.save(value([['citation_date', '2025']])));
  assert.deepEqual(await f.store.getAsset(id, ASSET), before);
  assert.equal(f.calls.some(call => call.type === 'ARTICLE_WORKSPACE_SAVE_ASSET'), false);
  assert.equal((await item(f)).publicationDate, '');
});

test('current conflicting evidence remains unknown on persistence and is not replaced by prior known date', async () => {
  const f = await harness();
  const original = value([['citation_journal_title', 'Journal A'], ['citation_date', '2024/02']]);
  await f.store.putAsset(id, ASSET, original);
  await f.save(value([['citation_date', '2024'], ['citation_publication_date', '2024/02']]));
  const saved = await f.store.getAsset(id, ASSET);
  assert.deepEqual(saved.content.journal, original.journal);
  assert.equal(saved.content.publicationDate.reason, 'conflict');
  assert.deepEqual(saved.content.publicationDate.evidence.map(entry => entry.raw), ['2024', '2024/02']);
  assert.equal((await item(f)).publicationDate, '');
});

test('legacy missing generation works only for generation 1 and never borrows workspace timestamps', () => {
  const owner = identity();
  const content = value([['citation_journal_title', 'Old journal'], ['citation_date', '2001']]);
  const asset = { relativePath: ASSET, revision: 1, contentHash: 'a'.repeat(64), content };
  for (const generation of [undefined, 1, 2]) {
    const workspace = { ...owner, workspaceGeneration: generation,
      createdAt: '2020-02-01T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z' };
    const row = queryLocalReadingLibrary(buildLocalReadingLibrary({ workspaces: [workspace],
      assetsByWorkspace: new Map([[id, [asset]]]) }), { kind: 'articles' }).items[0];
    assert.equal(row.publicationDate, generation === 2 ? '' : '2001');
    assert.equal(row.publicationDatePrecision, generation === 2 ? '' : 'year');
  }
});
