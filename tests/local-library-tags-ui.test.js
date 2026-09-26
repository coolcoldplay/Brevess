const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../options-local-library.js'), 'utf8');
const SciLLM = require('../core/local-library-tags');
const workspaceId = 'workspace:' + 'a'.repeat(64);
const content = tags => ({ schemaVersion: 1, workspaceId, tags });
function api(reply) {
  const start = source.indexOf('  async function readTagBase(');
  const end = source.indexOf('  function tagEditorDirty(');
  assert.ok(start >= 0 && end > start, 'UI must validate tag assets and construct CAS saves');
  const calls = [];
  const chrome = { runtime: { sendMessage: async message => { calls.push(message); return reply(message); } } };
  return { calls, ...new Function('SciLLM', 'chrome', source.slice(start, end) +
    '; return {readTagBase, saveTagDraft};')(SciLLM, chrome) };
}
test('missing tags use generation-bound create-only save, preserving exact Unicode', async () => {
  const ui = api(message => message.type === 'ARTICLE_WORKSPACE_GET_ASSET'
    ? { success: true, data: { found: false, workspaceGeneration: 3, asset: null } }
    : { success: true, data: { saved: true, queued: true, directoryPersisted: false,
      asset: { revision: 1, contentHash: 'new-hash' } } });
  const base = await ui.readTagBase(workspaceId, 3);
  await ui.saveTagDraft(workspaceId, base, [' e\u0301 ', 'é', 'μM', 'µM', 'Tag', 'tag']);
  assert.deepEqual(ui.calls[1], { type: 'ARTICLE_WORKSPACE_SAVE_ASSET', workspaceId,
    workspaceGeneration: 3, relativePath: SciLLM.LOCAL_LIBRARY_TAGS_ASSET_PATH,
    content: content(['é', 'μM', 'µM', 'Tag', 'tag']), expectedRevision: 0,
    expectedContentHash: '', createOnly: true });
});
test('existing asset carries both revision and hash; conflict is never retried', async () => {
  const ui = api(message => message.type === 'ARTICLE_WORKSPACE_GET_ASSET'
    ? { success: true, data: { found: true, workspaceGeneration: 1, asset: {
      relativePath: SciLLM.LOCAL_LIBRARY_TAGS_ASSET_PATH, revision: 7, contentHash: 'old', content: content(['old']) } } }
    : { success: false, error: { code: 'ASSET_REVISION_CONFLICT', message: 'changed' } });
  const base = await ui.readTagBase(workspaceId, 1), draft = ['manual'];
  await assert.rejects(ui.saveTagDraft(workspaceId, base, draft), { code: 'ASSET_REVISION_CONFLICT' });
  assert.equal(ui.calls.length, 2);
  assert.equal(ui.calls[1].expectedRevision, 7);
  assert.equal(ui.calls[1].expectedContentHash, 'old');
  assert.equal(ui.calls[1].createOnly, false);
  assert.deepEqual(draft, ['manual']);
});
test('invalid assets, wrong generation and malformed CAS metadata cannot become a save base', async () => {
  for (const changes of [{ workspaceGeneration: 2 }, { asset: null },
    { asset: { revision: 0, contentHash: '', content: content([]) } },
    { asset: { relativePath: SciLLM.LOCAL_LIBRARY_TAGS_ASSET_PATH, revision: 1, contentHash: 'h', content: { ...content([]), extra: 1 } } }]) {
    const ui = api(() => ({ success: true, data: { found: true, workspaceGeneration: 1,
      asset: { relativePath: SciLLM.LOCAL_LIBRARY_TAGS_ASSET_PATH, revision: 1, contentHash: 'h', content: content([]) }, ...changes } }));
    await assert.rejects(ui.readTagBase(workspaceId, 1));
    assert.equal(ui.calls.length, 1);
  }
});
test('empty edited array remains an intentional empty asset; failure is not success', async () => {
  const ui = api(() => ({ success: true, data: { saved: false } }));
  await assert.rejects(ui.saveTagDraft(workspaceId, { generation: 1, revision: 2, contentHash: 'old', tags: ['old'] }, []));
  assert.deepEqual(ui.calls[0].content.tags, []);
});
