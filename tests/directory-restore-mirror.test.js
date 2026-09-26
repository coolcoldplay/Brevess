const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = fs.readFileSync(path.join(__dirname, 'directory-sync.test.js'), 'utf8');
const { createFakeHandleStore, createMemorySyncQueue, createDirectorySync, workspaceFixture } =
  new Function('require', fixture.slice(0, fixture.indexOf('\ntest(')) +
    fixture.slice(fixture.indexOf('function workspaceFixture('), fixture.indexOf('\nfunction json(')) +
    '\nreturn { createFakeHandleStore, createMemorySyncQueue, createDirectorySync, workspaceFixture };')(require);
async function setup() {
  const handles = createFakeHandleStore(), queue = createMemorySyncQueue();
  const sync = createDirectorySync({ handleStore: handles, queueStore: queue });
  const workspace = workspaceFixture({ workspaceGeneration: 2 }), relativePath = 'chat/index.json';
  const diskPath = 'Brevess/workspaces/' + workspace.directoryName + '/' + relativePath;
  const data = { turns: [{ turnId: 'saved', webGrounding: null }] };
  const envelope = { schemaVersion: 1, kind: 'sci-logic-highlighter-workspace-asset',
    revision: 5000, updatedAt: '2026-09-23T01:00:00Z', contentHash: 'source-hash',
    sourceId: 'extension', workspaceId: workspace.workspaceId, workspaceGeneration: 2,
    relativePath, data };
  handles.writeText(diskPath, JSON.stringify(envelope));
  const expectedDirectoryAsset = { revision: 5000, contentHash: 'source-hash', data };
  const next = { turns: [{ turnId: 'saved' }] };
  const enqueue = () => sync.enqueueWorkspaceAsset(workspace, relativePath, next,
    { revision: 1, advanceFromDirectory: true, expectedDirectoryAsset });
  return { handles, queue, sync, workspace, relativePath, diskPath, envelope, next, enqueue };
}
test('confirmed restore source can mirror normalized content above its existing directory revision', async () => {
  const f = await setup(), result = await f.enqueue();
  assert.equal(result.revision, 5001);
  assert.equal((await f.sync.flush()).failed, 0);
  assert.deepEqual(JSON.parse(f.handles.readText(f.diskPath)).data, f.next);
  assert.equal((await f.sync.status()).pendingCount, 0);
});
test('new disk content, version or identity after scan is preserved with zero queue changes', async () => {
  for (const change of [{ data: { turns: [{ turnId: 'new-user-edit' }] } },
    { revision: 5001 }, { contentHash: 'changed' }, { workspaceGeneration: 3 },
    { workspaceId: 'another-workspace' }]) {
    const f = await setup(), newer = { ...f.envelope, ...change };
    f.handles.writeText(f.diskPath, JSON.stringify(newer));
    await assert.rejects(f.enqueue, error => error.code === 'WORKSPACE_RESTORE_DIRECTORY_CONFLICT');
    assert.deepEqual(await f.queue.getAll(), []);
    assert.deepEqual(JSON.parse(f.handles.readText(f.diskPath)), newer);
  }
});
test('a queued post-scan edit is not overwritten even when disk still matches the source', async () => {
  const f = await setup();
  await f.sync.enqueueWorkspaceAsset(f.workspace, f.relativePath, { turns: [{ turnId: 'new' }] },
    { revision: 5001 });
  const before = await f.queue.getAll();
  await assert.rejects(f.enqueue, error => error.code === 'WORKSPACE_RESTORE_DIRECTORY_CONFLICT');
  assert.deepEqual(await f.queue.getAll(), before);
});
test('expected absence rejects an existing directory asset and allows an actually absent path', async () => {
  const f = await setup(), options = { revision: 1, advanceFromDirectory: true, expectedDirectoryAsset: null };
  await assert.rejects(() => f.sync.enqueueWorkspaceAsset(f.workspace, f.relativePath, f.next, options),
    error => error.code === 'WORKSPACE_RESTORE_DIRECTORY_CONFLICT');
  await f.sync.enqueueWorkspaceAsset(f.workspace, 'chat/recovered.json', f.next, options);
  assert.equal((await f.sync.flush()).failed, 0);
});
test('a later higher disk version between queue and flush remains protected', async () => {
  const f = await setup(); await f.enqueue();
  const newer = { ...f.envelope, revision: 5002, data: { turns: [{ turnId: 'later-user' }] } };
  f.handles.writeText(f.diskPath, JSON.stringify(newer));
  assert.equal((await f.sync.flush()).failed, 1);
  assert.deepEqual(JSON.parse(f.handles.readText(f.diskPath)), newer);
  assert.ok((await f.queue.getAll()).length > 0);
});
