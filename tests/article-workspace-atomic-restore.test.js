const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
require('../core/user-data-database.js');
require('../core/article-workspace.js');
const { createIndexedDbArticleWorkspaceStore } = require('../core/article-workspace-store.js');

const fixtureSource = readFileSync(join(__dirname, 'article-workspace-store.test.js'), 'utf8');
const start = fixtureSource.indexOf('function createFakeIndexedDb(');
const end = fixtureSource.indexOf('\nfunction workspace(', start);
assert.ok(start >= 0 && end > start);
const createFakeIndexedDb = Function(fixtureSource.slice(start, end) + '\nreturn createFakeIndexedDb;')();
const id = 'workspace:' + 'a'.repeat(64);
const A = 'annotations/paragraph-notes.json';
const B = 'unknown/private-manual.json';
const time = '2026-09-23T03:00:00.000Z';
function identity(overrides = {}) {
  return { schemaVersion: 1, workspaceId: id, canonicalUrl: 'https://example.org/atomic',
    title: 'Atomic restore', aliases: [], directoryName: 'Atomic--' + 'a'.repeat(12),
    contentHash: '1'.repeat(64), revision: '1'.repeat(64), workspaceGeneration: 1, ...overrides };
}
async function fixture({ empty = false } = {}) {
  const fake = createFakeIndexedDb();
  // Native IndexedDB does not complete a transaction in the middle of draining
  // the current task's promise microtasks. The reused minimal fixture otherwise
  // releases its writer before a nested await resumes to queue the next write.
  const createTransaction = fake.database.transaction.bind(fake.database);
  fake.database.transaction = (names, mode) => {
    const transaction = createTransaction(names, mode);
    transaction.schedule = function scheduleAfterMicrotasks() {
      if (!this.active || this.completionScheduled || this.aborted) return;
      this.completionScheduled = true;
      setImmediate(() => {
        this.completionScheduled = false;
        if (!this.aborted && this.pending === 0) {
          try { this.oncomplete?.(); } finally { this.release(); }
        }
      });
    };
    return transaction;
  };
  let clock = time;
  const store = createIndexedDbArticleWorkspaceStore(fake.indexedDb, { now: () => clock });
  if (!empty) {
    await store.ensureWorkspace(identity());
    await store.putAsset(id, A, { notes: [{ paragraphId: 'p-1', note: '未增加，p = 0.03' }] });
    await store.putAsset(id, B, { reviewed: true, text: '', unknown: ['keep'] });
    await store.appendTurn(id, { turnId: 't-1', question: '原问题', answer: '原回答' });
    await store.appendTurn(id, { turnId: 't-keep', question: '保留问题', answer: '' });
  }
  return { fake, store, setTime(value) { clock = value; } };
}
function request(expectedLocal, overrides = {}) {
  return { identity: identity(), expectedLocal,
    assets: [{ relativePath: A, content: { notes: [] } }],
    turns: [{ turnId: 't-1', answer: '恢复回答' }, { turnId: 't-new', question: '新恢复问题' }],
    ...overrides };
}
function snapshot(fake) {
  return Object.fromEntries(['workspaces', 'workspaceAssets', 'workspaceTurns', 'workspaceTombstones']
    .map(name => [name, [...(fake.stores.get(name) || [])].map(([key, value]) => [key, structuredClone(value)])]));
}
function recordTransactions(fake) {
  const calls = [];
  const original = fake.database.transaction.bind(fake.database);
  fake.database.transaction = (names, mode) => {
    calls.push({ names: [...names].sort(), mode });
    return original(names, mode);
  };
  return calls;
}
const expectedStores = ['workspaceAssets', 'workspaceTombstones', 'workspaceTurns', 'workspaces'].sort();

test('capture returns one detached, same-transaction full row-set baseline', async () => {
  const { fake, store } = await fixture();
  const calls = recordTransactions(fake);
  const baseline = await store.captureRestoreBaseline(id);
  assert.deepEqual(calls, [{ names: expectedStores, mode: 'readonly' }]);
  assert.equal(baseline.workspaceId, id);
  assert.equal(baseline.assets.length, 2);
  assert.equal(baseline.turns.length, 2);
  assert.equal(baseline.tombstones.length, 0);
  assert.equal(Object.hasOwn(baseline.assets[0], 'content'), false);
  baseline.workspace.title = 'changed outside store';
  assert.equal((await store.getWorkspace(id)).title, 'Atomic restore');
});

test('legal batch matches existing per-item revision, sequence and summary rules; untouched rows survive', async () => {
  const left = await fixture();
  const right = await fixture();
  const beforeUnknown = await left.store.getAsset(id, B);
  const beforeTurn = (await left.store.pageTurns(id)).items.find(turn => turn.turnId === 't-keep');
  const baseline = await left.store.captureRestoreBaseline(id);
  const input = request(JSON.parse(JSON.stringify(baseline)));
  const inputBefore = structuredClone(input);
  const calls = recordTransactions(left.fake);
  const result = await left.store.commitRestoreIfUnchanged(input);
  assert.deepEqual(calls, [{ names: expectedStores, mode: 'readwrite' }]);
  assert.equal(result.committed, true);
  assert.equal(result.assets[0].revision, 2);
  assert.equal(result.turns[0].sequence, 1);
  assert.equal(result.turns[0].revision, 2);
  assert.equal(result.turns[1].sequence, 3);
  assert.equal(result.turns[1].revision, 1);
  assert.deepEqual(input, inputBefore);
  await right.store.putAsset(id, A, input.assets[0].content);
  await right.store.updateTurn(id, 't-1', input.turns[0]);
  await right.store.appendTurn(id, input.turns[1]);
  assert.deepEqual(await left.store.getWorkspace(id), await right.store.getWorkspace(id));
  assert.deepEqual(await left.store.listAssets(id), await right.store.listAssets(id));
  assert.deepEqual(await left.store.pageTurns(id), await right.store.pageTurns(id));
  assert.deepEqual(await left.store.getAsset(id, B), beforeUnknown);
  assert.deepEqual((await left.store.pageTurns(id)).items.find(turn => turn.turnId === 't-keep'), beforeTurn);
});

for (const [name, mutate] of [
  ['asset changed', store => store.putAsset(id, A, { notes: [{ note: '扫描后人工修改' }] })],
  ['asset deleted', store => store.deleteAsset(id, A)],
  ['asset added outside incoming set', store => store.putAsset(id, 'unknown/new.json', { manual: true })],
  ['turn changed', store => store.updateTurn(id, 't-1', { answer: '扫描后改文' })],
  ['turn deleted', store => store.deleteTurn(id, 't-1')],
  ['turn added outside incoming set', store => store.appendTurn(id, { turnId: 'late-turn', answer: '人工内容' })],
  ['workspace deletion started', store => store.beginWorkspaceDeletion(id)]
]) {
  test('snapshot conflict writes nothing after: ' + name, async () => {
    const { fake, store } = await fixture();
    const baseline = await store.captureRestoreBaseline(id);
    await mutate(store);
    const before = snapshot(fake);
    await assert.rejects(() => store.commitRestoreIfUnchanged(request(baseline)), /WORKSPACE_RESTORE_CONFLICT/);
    assert.deepEqual(snapshot(fake), before);
  });
}

test('turn revision detects changes even when owner counter/time/summary are unchanged', async () => {
  const { fake, store } = await fixture();
  const baseline = await store.captureRestoreBaseline(id);
  const beforeOwner = await store.getWorkspace(id);
  await store.updateTurn(id, 't-1', { answer: '改回答' }); // same byte length, fixed clock
  assert.deepEqual(await store.getWorkspace(id), beforeOwner);
  const before = snapshot(fake);
  await assert.rejects(() => store.commitRestoreIfUnchanged(request(baseline)), /WORKSPACE_RESTORE_CONFLICT/);
  assert.deepEqual(snapshot(fake), before);
});

test('a conflict on the second asset cannot partly write the first', async () => {
  const { fake, store } = await fixture();
  const baseline = await store.captureRestoreBaseline(id);
  await store.putAsset(id, B, { text: '第二项人工新值' });
  const before = snapshot(fake);
  await assert.rejects(() => store.commitRestoreIfUnchanged(request(baseline, {
    assets: [{ relativePath: A, content: { notes: [] } }, { relativePath: B, content: { text: '旧值' } }]
  })), /WORKSPACE_RESTORE_CONFLICT/);
  assert.deepEqual(snapshot(fake), before);
});

test('tombstone-only change invalidates the baseline even without a workspace revision change', async () => {
  const { fake, store } = await fixture();
  const baseline = await store.captureRestoreBaseline(id);
  const owner = await store.getWorkspace(id);
  const tombstone = { tombstoneKey: id + '\u0000manual-tombstone', tombstoneId: 'manual-tombstone',
    workspaceId: id, workspaceGeneration: 1, entityType: 'turn', entityId: 'missing-turn', deletedAt: time };
  fake.stores.get('workspaceTombstones').set(tombstone.tombstoneKey, tombstone);
  assert.deepEqual(await store.getWorkspace(id), owner);
  const before = snapshot(fake);
  await assert.rejects(() => store.commitRestoreIfUnchanged(request(baseline)), /WORKSPACE_RESTORE_CONFLICT/);
  assert.deepEqual(snapshot(fake), before);
});

test('a turn already tombstoned at capture cannot be resurrected by a matching baseline', async () => {
  const { fake, store } = await fixture();
  await store.deleteTurn(id, 't-1');
  const baseline = await store.captureRestoreBaseline(id);
  const before = snapshot(fake);
  await assert.rejects(() => store.commitRestoreIfUnchanged(request(baseline)),
    /WORKSPACE_RESTORE_TOMBSTONE_CONFLICT/);
  assert.deepEqual(snapshot(fake), before);
});

test('an asset tombstone also refuses restoration without deleting the tombstone', async () => {
  const { fake, store } = await fixture();
  await store.deleteAsset(id, A);
  const row = { tombstoneKey: id + '\u0000asset-delete', tombstoneId: 'asset-delete', workspaceId: id,
    workspaceGeneration: 1, entityType: 'asset', entityId: A, deletedAt: time };
  fake.stores.get('workspaceTombstones').set(row.tombstoneKey, row);
  const baseline = await store.captureRestoreBaseline(id);
  const before = snapshot(fake);
  await assert.rejects(() => store.commitRestoreIfUnchanged(request(baseline)),
    /WORKSPACE_RESTORE_TOMBSTONE_CONFLICT/);
  assert.deepEqual(snapshot(fake), before);
});

for (const failingStore of ['workspaceAssets', 'workspaceTurns', 'workspaces']) {
  test('IO failure rolls back the entire batch: ' + failingStore, async () => {
    const { fake, store } = await fixture();
    const baseline = await store.captureRestoreBaseline(id);
    const before = snapshot(fake);
    fake.failNextPutFor(failingStore);
    await assert.rejects(() => store.commitRestoreIfUnchanged(request(baseline)),
      new RegExp('simulated ' + failingStore + ' write failure'));
    assert.deepEqual(snapshot(fake), before);
  });
}

test('two concurrent commits from one snapshot cannot both write', async () => {
  const { store } = await fixture();
  const baseline = await store.captureRestoreBaseline(id);
  const results = await Promise.allSettled([
    store.commitRestoreIfUnchanged(request(baseline)),
    store.commitRestoreIfUnchanged(request(baseline))
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' &&
    result.reason.code === 'WORKSPACE_RESTORE_CONFLICT').length, 1);
  assert.equal((await store.getAsset(id, A)).revision, 2);
});

test('missing workspace is created atomically from an absent baseline', async () => {
  const { store } = await fixture({ empty: true });
  const baseline = await store.captureRestoreBaseline(id);
  assert.equal(baseline.workspace, null);
  const result = await store.commitRestoreIfUnchanged(request(baseline));
  assert.equal(result.workspace.workspaceGeneration, 1);
  assert.equal(result.assets[0].revision, 1);
  assert.deepEqual(result.turns.map(turn => turn.sequence), [1, 2]);
});

test('failed creation does not leave an empty workspace or partial asset behind', async () => {
  const { fake, store } = await fixture({ empty: true });
  const baseline = await store.captureRestoreBaseline(id);
  const before = snapshot(fake);
  fake.failNextPutFor('workspaceTurns');
  await assert.rejects(() => store.commitRestoreIfUnchanged(request(baseline)), /simulated/);
  assert.deepEqual(snapshot(fake), before);
});

test('deleted workspace generation cannot be recreated by an absent matching baseline', async () => {
  const { fake, store } = await fixture();
  const deletion = await store.beginWorkspaceDeletion(id);
  await store.finalizeWorkspaceDeletion(id, deletion.tombstoneId);
  const baseline = await store.captureRestoreBaseline(id);
  const before = snapshot(fake);
  await assert.rejects(() => store.commitRestoreIfUnchanged(request(baseline)), /WORKSPACE_GENERATION_CONFLICT/);
  assert.deepEqual(snapshot(fake), before);
});

test('read-only access time refresh does not spuriously invalidate the baseline', async () => {
  const { store, setTime } = await fixture();
  const baseline = await store.captureRestoreBaseline(id);
  setTime('2026-09-23T03:01:00.000Z');
  await store.ensureWorkspace(identity());
  assert.equal((await store.commitRestoreIfUnchanged(request(baseline))).committed, true);
});

for (const [name, overrides, code] of [
  ['missing baseline', { expectedLocal: null }, 'INVALID_WORKSPACE_RESTORE_BASELINE'],
  ['foreign workspace', { identity: identity({ workspaceId: 'workspace:' + 'b'.repeat(64),
    directoryName: 'Other--' + 'b'.repeat(12) }) }, 'WORKSPACE_RESTORE_CONFLICT'],
  ['changed article identity', { identity: identity({ contentHash: '2'.repeat(64) }) }, 'WORKSPACE_RESTORE_CONFLICT'],
  ['changed generation', { identity: identity({ workspaceGeneration: 2 }) }, 'WORKSPACE_GENERATION_CONFLICT'],
  ['duplicate normalized path', { assets: [{ relativePath: A, content: {} },
    { relativePath: 'annotations\\paragraph-notes.json', content: {} }] }, 'DUPLICATE_WORKSPACE_ASSET'],
  ['invalid second path', { assets: [{ relativePath: A, content: {} },
    { relativePath: '../bad', content: {} }] }, 'INVALID_WORKSPACE_PATH'],
  ['duplicate normalized turn ID', { turns: [{ turnId: 't-1' }, { turnId: ' t-1 ' }] }, 'TURN_ALREADY_EXISTS'],
  ['invalid turn ID', { turns: [{ turnId: '' }] }, 'INVALID_TURN_ID'],
  ['credential-containing asset', { assets: [{ relativePath: A, content: { apiKey: 'must-not-store' } }] },
    'WORKSPACE_CONTAINS_CREDENTIALS'],
  ['internal staging import', { assets: [{ relativePath: 'internal/figure-retry-staging/a.json', content: {} }] },
    'INVALID_WORKSPACE_RESTORE_ASSET'],
  ['too many assets', { assets: Array.from({ length: 1001 }, (_, index) =>
    ({ relativePath: 'assets/a-' + index + '.json', content: {} })) }, 'WORKSPACE_RESTORE_TOO_LARGE'],
  ['too many turns', { turns: Array.from({ length: 10001 }, (_, index) =>
    ({ turnId: 't-' + index })) }, 'WORKSPACE_RESTORE_TOO_LARGE']
]) {
  test('invalid complete batch has zero writes: ' + name, async () => {
    const { fake, store } = await fixture();
    const baseline = await store.captureRestoreBaseline(id);
    const before = snapshot(fake);
    await assert.rejects(() => store.commitRestoreIfUnchanged(request(baseline, overrides)),
      new RegExp(code));
    assert.deepEqual(snapshot(fake), before);
  });
}

test('capture rejects too many local assets instead of returning a truncated baseline', async () => {
  const { fake, store } = await fixture();
  const sample = await store.getAsset(id, A);
  for (let index = 0; index < 1000; index += 1) {
    const relativePath = 'assets/extra-' + index + '.json';
    const row = { ...sample, relativePath, assetKey: id + '\u0000' + relativePath };
    fake.stores.get('workspaceAssets').set(row.assetKey, row);
  }
  await assert.rejects(() => store.captureRestoreBaseline(id), /WORKSPACE_RESTORE_TOO_LARGE/);
});

test('snapshot ignores unrelated workspaces and commit preserves their rows', async () => {
  const { fake, store } = await fixture();
  const other = identity({ workspaceId: 'workspace:' + 'b'.repeat(64),
    canonicalUrl: 'https://example.org/other', directoryName: 'Other--' + 'b'.repeat(12) });
  await store.ensureWorkspace(other);
  const baseline = await store.captureRestoreBaseline(id);
  await store.putAsset(other.workspaceId, A, { note: 'another paper' });
  const otherBefore = await store.getWorkspace(other.workspaceId);
  const otherAsset = await store.getAsset(other.workspaceId, A);
  await store.commitRestoreIfUnchanged(request(baseline));
  assert.deepEqual(await store.getWorkspace(other.workspaceId), otherBefore);
  assert.deepEqual(await store.getAsset(other.workspaceId, A), otherAsset);
});

test('empty existing batch is a true no-op', async () => {
  const { fake, store } = await fixture();
  const baseline = await store.captureRestoreBaseline(id);
  const before = snapshot(fake);
  const result = await store.commitRestoreIfUnchanged(request(baseline, { assets: [], turns: [] }));
  assert.equal(result.committed, true);
  assert.deepEqual(snapshot(fake), before);
});

test('the existing native workspaceId indexes receive bounded per-workspace reads', async () => {
  const { fake, store } = await fixture();
  const calls = [];
  const original = fake.database.transaction.bind(fake.database);
  fake.database.transaction = (names, mode) => {
    const tx = original(names, mode);
    const objectStore = tx.objectStore.bind(tx);
    tx.objectStore = name => {
      const target = objectStore(name);
      target.index = indexName => ({
        getAll(query, count) {
          calls.push({ name, indexName, query, count });
          const source = target.getAll();
          const output = {};
          source.onsuccess = () => {
            output.result = source.result.filter(row => row.workspaceId === query).slice(0, count);
            output.onsuccess?.();
          };
          source.onerror = () => { output.error = source.error; output.onerror?.(); };
          return output;
        }
      });
      return target;
    };
    return tx;
  };
  await store.captureRestoreBaseline(id);
  assert.deepEqual(calls.map(call => [call.name, call.indexName, call.query, call.count]), [
    ['workspaceAssets', 'workspaceId', id, 1001],
    ['workspaceTurns', 'workspaceId', id, 10001],
    ['workspaceTombstones', 'workspaceId', id, 10001]
  ]);
});

for (const [field, value] of [['nextTurnSequence', Number.MAX_SAFE_INTEGER], ['storageRevision', NaN]]) {
  test('invalid or overflowing local counter rejects before writing: ' + field, async () => {
    const { fake, store } = await fixture();
    fake.stores.get('workspaces').get(id)[field] = value;
    const baseline = await store.captureRestoreBaseline(id);
    const before = snapshot(fake);
    await assert.rejects(() => store.commitRestoreIfUnchanged(request(baseline)),
      /INVALID_WORKSPACE_RESTORE_STATE/);
    assert.deepEqual(snapshot(fake), before);
  });
}

test('a fresh higher workspace generation may start without reviving records from the deleted generation', async () => {
  const { store } = await fixture();
  await store.deleteTurn(id, 't-1');
  const deletion = await store.beginWorkspaceDeletion(id);
  await store.finalizeWorkspaceDeletion(id, deletion.tombstoneId);
  const baseline = await store.captureRestoreBaseline(id);
  const result = await store.commitRestoreIfUnchanged(request(baseline, {
    identity: identity({ workspaceGeneration: 2 }),
    assets: [{ relativePath: A, content: { notes: [] } }], turns: [{ turnId: 'fresh-turn' }]
  }));
  assert.equal(result.workspace.workspaceGeneration, 2);
  assert.deepEqual(result.turns.map(turn => turn.turnId), ['fresh-turn']);
  assert.equal((await store.pageTurns(id)).items.some(turn => turn.turnId === 't-1'), false);
  assert.equal((await store.captureRestoreBaseline(id)).tombstones.length, 2);
});

test('internal local staging not named for restoration remains byte-for-byte unchanged', async () => {
  const { store } = await fixture();
  const stagePath = 'internal/figure-retry-staging/local.json';
  const stage = await store.putAsset(id, stagePath, { kind: 'figure_retry_candidate',
    status: 'pending_confirmation', target: { relativePath: 'figures/workspace-draft.json' } });
  const baseline = await store.captureRestoreBaseline(id);
  await store.commitRestoreIfUnchanged(request(baseline));
  assert.deepEqual(await store.getAsset(id, stagePath), stage);
});

test('an oversized resulting local set is rejected rather than making the next baseline incomplete', async () => {
  const { fake, store } = await fixture();
  const sample = await store.getAsset(id, A);
  for (let index = 0; index < 998; index += 1) {
    const relativePath = 'assets/existing-' + index + '.json';
    const row = { ...sample, relativePath, assetKey: id + '\u0000' + relativePath };
    fake.stores.get('workspaceAssets').set(row.assetKey, row);
  }
  const baseline = await store.captureRestoreBaseline(id);
  assert.equal(baseline.assets.length, 1000);
  const before = snapshot(fake);
  await assert.rejects(() => store.commitRestoreIfUnchanged(request(baseline, {
    assets: [{ relativePath: 'assets/new.json', content: {} }], turns: []
  })), /WORKSPACE_RESTORE_TOO_LARGE/);
  assert.deepEqual(snapshot(fake), before);
});

test('valid special-property asset paths retain their own summary entry', async () => {
  const { store } = await fixture();
  const baseline = await store.captureRestoreBaseline(id);
  const result = await store.commitRestoreIfUnchanged(request(baseline, {
    assets: [{ relativePath: '__proto__', content: { manual: 'keep exact path' } }], turns: []
  }));
  assert.equal(result.workspace.summary.assetCount, 3);
  assert.equal(Object.hasOwn(result.workspace.assetSummaryByPath, '__proto__'), true);
  assert.deepEqual((await store.getAsset(id, '__proto__')).content, { manual: 'keep exact path' });
});
