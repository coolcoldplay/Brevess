const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// Reuse only the released setup, not its tests. Every operation below calls
// the actual store API. The fixture is an IDB substitute, not a native-IDB test.
const source = readFileSync(join(__dirname, 'article-workspace-atomic-restore.test.js'), 'utf8');
const boundary = source.indexOf("\ntest('capture returns");
assert.ok(boundary > 0);
const { fixture, identity, id, A, B, request, snapshot } = Function('require', '__dirname',
  source.slice(0, boundary) + '\nreturn { fixture, identity, id, A, B, request, snapshot };'
)(require, __dirname);

test('ordinary save queued before restore wins and invalidates the old snapshot', async () => {
  const { store } = await fixture();
  const baseline = await store.captureRestoreBaseline(id);
  const newer = { notes: [{ note: '扫描后人工输入，p = 0.04' }] };
  const [save, restore] = await Promise.allSettled([
    store.putAsset(id, A, newer),
    store.commitRestoreIfUnchanged(request(baseline))
  ]);
  assert.equal(save.status, 'fulfilled');
  assert.equal(restore.status, 'rejected');
  assert.equal(restore.reason.code, 'WORKSPACE_RESTORE_CONFLICT');
  assert.deepEqual((await store.getAsset(id, A)).content, newer);
  assert.equal((await store.pageTurns(id)).items.some(turn => turn.turnId === 't-new'), false);
});

test('ordinary save queued after restore preserves the newer value and increments from the committed row', async () => {
  const { store } = await fixture();
  const baseline = await store.captureRestoreBaseline(id);
  const newer = { notes: [{ note: '恢复之后的新人工值' }] };
  const [restore, save] = await Promise.all([
    store.commitRestoreIfUnchanged(request(baseline)),
    store.putAsset(id, A, newer)
  ]);
  assert.equal(restore.assets[0].revision, 2);
  assert.equal(save.revision, 3);
  assert.deepEqual((await store.getAsset(id, A)).content, newer);
  assert.deepEqual(restore.assets[0].content, { notes: [] });
});

test('transaction abort after successful requests still rejects and rolls back every row', async () => {
  const { fake, store } = await fixture();
  const baseline = await store.captureRestoreBaseline(id);
  const before = snapshot(fake);
  const original = fake.database.transaction.bind(fake.database);
  let sawAllWrites = false;
  fake.database.transaction = (names, mode) => {
    const tx = original(names, mode);
    if (mode === 'readwrite') {
      tx.schedule = function scheduleCommitAbort() {
        if (!this.active || this.completionScheduled || this.aborted) return;
        this.completionScheduled = true;
        setImmediate(() => {
          this.completionScheduled = false;
          if (this.aborted || this.pending !== 0) return;
          sawAllWrites = fake.stores.get('workspaceAssets').get(id + '\u0000' + A).revision === 2 &&
            fake.stores.get('workspaceTurns').has(id + '\u0000t-new') &&
            fake.stores.get('workspaces').get(id).nextTurnSequence === 3;
          this.error = new Error('review simulated commit-time abort');
          this.abort();
        });
      };
    }
    return tx;
  };
  await assert.rejects(() => store.commitRestoreIfUnchanged(request(baseline)), /commit-time abort/);
  assert.equal(sawAllWrites, true);
  assert.deepEqual(snapshot(fake), before);
});

test('candidate and baseline mutation after invocation cannot replace the already captured write', async () => {
  const { store } = await fixture();
  const baseline = await store.captureRestoreBaseline(id);
  const input = request(baseline, {
    assets: [{ relativePath: A, content: { notes: [{ note: '确认的内容' }] } }],
    turns: [{ turnId: 't-1', answer: '确认的回答' }]
  });
  const pending = store.commitRestoreIfUnchanged(input);
  input.assets[0].content.notes[0].note = '调用之后篡改';
  input.assets[0].relativePath = B;
  input.turns[0].answer = '调用之后篡改';
  input.identity.title = '调用之后篡改';
  input.expectedLocal.assets.length = 0;
  const saved = await pending;
  assert.deepEqual(saved.assets[0].content, { notes: [{ note: '确认的内容' }] });
  assert.equal(saved.assets[0].relativePath, A);
  assert.equal(saved.turns[0].answer, '确认的回答');
  saved.assets[0].content.notes[0].note = '返回值篡改';
  assert.deepEqual((await store.getAsset(id, A)).content, { notes: [{ note: '确认的内容' }] });
});

test('an old-generation tombstone allows the same turn ID in a genuinely new generation', async () => {
  const { store } = await fixture();
  await store.deleteTurn(id, 't-1');
  const deletion = await store.beginWorkspaceDeletion(id);
  await store.finalizeWorkspaceDeletion(id, deletion.tombstoneId);
  const baseline = await store.captureRestoreBaseline(id);
  const result = await store.commitRestoreIfUnchanged(request(baseline, {
    identity: identity({ workspaceGeneration: 2 }), assets: [],
    turns: [{ turnId: 't-1', question: '新代次的同名问题' }]
  }));
  assert.equal(result.turns[0].workspaceGeneration, 2);
  assert.equal(result.turns[0].revision, 1);
  assert.equal(result.turns[0].sequence, 1);
  assert.deepEqual((await store.captureRestoreBaseline(id)).tombstones, baseline.tombstones);
});

test('a newer-generation asset tombstone blocks restoration even when it predates capture', async () => {
  const { fake, store } = await fixture();
  const tombstone = { tombstoneKey: id + '\u0000future-delete', tombstoneId: 'future-delete',
    workspaceId: id, workspaceGeneration: 2, entityType: 'asset', entityId: A,
    deletedAt: '2026-09-23T03:00:00.000Z' };
  fake.stores.get('workspaceTombstones').set(tombstone.tombstoneKey, tombstone);
  const baseline = await store.captureRestoreBaseline(id);
  const before = snapshot(fake);
  await assert.rejects(() => store.commitRestoreIfUnchanged(request(baseline)),
    /WORKSPACE_RESTORE_TOMBSTONE_CONFLICT/);
  assert.deepEqual(snapshot(fake), before);
});
