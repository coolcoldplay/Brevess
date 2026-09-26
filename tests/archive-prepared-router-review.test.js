const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'archive-newer-copy-feedback.test.js'), 'utf8');
const setup = source.slice(source.indexOf("require('../core/user-data-database.js');"),
  source.indexOf("test('control:"));
const fixtureFactory = Function('require', '__dirname', 'assert', 'readFileSync', 'join',
  setup + '\nreturn createCapturedCopyFixture;')(require, __dirname, assert, fs.readFileSync, path.join);
const { createBackgroundRouter } = require('../core/background-router.js');
const NOTE_PATH = 'annotations/paragraph-notes.json';
const NONCE = 'arch009-independent-review-operation';

async function fixture() {
  const base = await fixtureFactory();
  let timestamp = Date.parse('2026-09-23T01:00:00.000Z');
  const assets = new Map([[NOTE_PATH, structuredClone(base.envelope)]]);
  const manifest = structuredClone(base.manifest);
  const queued = [];
  const hooks = {};
  const values = {};
  const router = createBackgroundRouter({
    storageArea: { get(key, cb) { cb({ [key]: values[key] }); },
      set(input, cb) { Object.assign(values, input); cb?.(); } },
    articleWorkspaceStore: base.store,
    nowImpl: () => timestamp,
    directorySync: {
      async listWorkspaceManifests() {
        return { permission: 'granted', manifests: [structuredClone(manifest)],
          matches: [{ match: 'exact', manifest: structuredClone(manifest) }] };
      },
      async readWorkspaceAsset(_manifest, relativePath) {
        await hooks.beforeRead?.(relativePath);
        return { permission: 'granted', found: assets.has(relativePath),
          value: structuredClone(assets.get(relativePath)) };
      },
      async enqueueWorkspaceAsset(workspace, relativePath, content, metadata) {
        await hooks.beforeEnqueue?.(relativePath);
        queued.push(structuredClone({ workspace, relativePath, content, metadata }));
      }
    },
    fetchImpl: async () => { throw new Error('Independent review must remain offline'); }
  });
  const context = { trustedContentScript: true, senderTabId: 9,
    senderUrl: base.identity.canonicalUrl, senderFrameId: 0, senderDocumentId: 'browser-document-1',
    // Explicit browser-liveness test double; the navigation test replaces it.
    assertTrustedOwnerCurrent: async () => {} };
  return { ...base, router, assets, manifest, queued, hooks, context,
    advance(ms) { timestamp += ms; },
    addDirectoryAsset(relativePath, content) {
      manifest.assets.push({ path: relativePath, type: 'json', revision: 1,
        contentHash: 'b'.repeat(64), updatedAt: '2026-09-23T01:00:00.000Z' });
      assets.set(relativePath, { ...structuredClone(base.envelope), relativePath,
        data: structuredClone(content) });
    },
    async scan() {
      return router.handle({ type: 'ARTICLE_WORKSPACE_SCAN_RESTORE', identity: base.identity,
        operationNonce: NONCE });
    },
    message(scan) {
      const restore = scan.data.restore;
      return { type: 'ARTICLE_WORKSPACE_COMMIT_PREPARED_RESTORE',
        planId: restore.restorePlanId, binding: {
          kind: 'workspace', current: base.identity, documentId: base.identity.documentId,
          manifest: restore.manifest, match: restore.match, operationNonce: NONCE
        } };
    },
    commit(scan, currentContext = context) { return router.handle(this.message(scan), currentContext); }
  };
}

test('review: an older directory turn cannot overwrite a human edit already saved before scan', async () => {
  const f = await fixture();
  const original = await f.store.appendTurn(f.identity.workspaceId,
    { turnId: 'human-answer', role: 'assistant', content: 'Original draft answer' });
  f.addDirectoryAsset('chat/turns/human-answer.json', original);
  const revised = await f.store.updateTurn(f.identity.workspaceId, original.turnId,
    { content: 'Human correction: treatment did not improve outcome; n = 12.' });
  const scan = await f.scan();
  if (scan.success) await f.commit(scan);
  const turns = await f.store.pageTurns(f.identity.workspaceId, { limit: 100 });
  assert.deepEqual(turns.items.find(turn => turn.turnId === original.turnId), revised,
    'The private scan baseline must not authorize overwriting an already-newer human turn');
});

test('review: expired plans cannot commit and preserve local data', async () => {
  const f = await fixture();
  const scan = await f.scan();
  assert.equal(scan.success, true, JSON.stringify(scan));
  const before = await f.store.captureRestoreBaseline(f.identity.workspaceId);
  f.advance(120000);
  const result = await f.commit(scan);
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'ARTICLE_WORKSPACE_RESTORE_PLAN_INVALID');
  assert.deepEqual(await f.store.captureRestoreBaseline(f.identity.workspaceId), before);
});

test('review: parallel commits share a durable write and do not enqueue twice', async () => {
  const f = await fixture();
  const scan = await f.scan();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let reached;
  const entered = new Promise(resolve => { reached = resolve; });
  f.hooks.beforeEnqueue = async () => { reached(); await gate; };
  const first = f.commit(scan);
  await entered;
  const second = f.commit(scan);
  release();
  const results = await Promise.all([first, second]);
  assert.equal(results[0].success, true, JSON.stringify(results[0]));
  assert.deepEqual(results[1], results[0]);
  assert.equal((await f.store.getAsset(f.identity.workspaceId, NOTE_PATH)).revision,
    f.savedOld.revision + 1);
  assert.equal(f.queued.length, 1);
});

test('review: directory enqueue failure reports committed persistence and retries do not write again', async () => {
  const f = await fixture();
  const scan = await f.scan();
  f.hooks.beforeEnqueue = async () => { throw new Error('directory permission lost'); };
  const first = await f.commit(scan);
  assert.equal(first.success, true, JSON.stringify(first));
  assert.equal(first.data.persistenceCommitted, true);
  assert.equal(first.data.syncStatus, 'pending');
  const before = await f.store.captureRestoreBaseline(f.identity.workspaceId);
  assert.deepEqual(await f.commit(scan), first);
  assert.deepEqual(await f.store.captureRestoreBaseline(f.identity.workspaceId), before);
});

test('review: a human write during directory enqueue survives the reply and an idempotent retry', async () => {
  const f = await fixture();
  const scan = await f.scan();
  let later;
  f.hooks.beforeEnqueue = async () => {
    later = await f.store.putAsset(f.identity.workspaceId, NOTE_PATH,
      { notes: [{ paragraphId: 'p-1', note: 'Human write after durable prepared commit' }] });
    throw new Error('directory permission lost after local human write');
  };
  const result = await f.commit(scan);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.data.persistenceCommitted, true);
  assert.equal(result.data.syncStatus, 'pending');
  assert.deepEqual(await f.store.getAsset(f.identity.workspaceId, NOTE_PATH), later);
  assert.deepEqual(await f.commit(scan), result);
  assert.deepEqual(await f.store.getAsset(f.identity.workspaceId, NOTE_PATH), later);
});

test('review: unrelated assets and turns absent from the plan remain stored', async () => {
  const f = await fixture();
  const tagAsset = await f.store.putAsset(f.identity.workspaceId, 'annotations/library-tags.json',
    { schemaVersion: 1, workspaceId: f.identity.workspaceId, tags: ['human-tag'] });
  const turn = await f.store.appendTurn(f.identity.workspaceId,
    { turnId: 'local-only-answer', role: 'assistant', content: 'Only stored locally' });
  const scan = await f.scan();
  assert.equal(scan.success, true, JSON.stringify(scan));
  const result = await f.commit(scan);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(await f.store.getAsset(f.identity.workspaceId, tagAsset.relativePath), tagAsset);
  assert.deepEqual((await f.store.pageTurns(f.identity.workspaceId)).items.find(
    item => item.turnId === turn.turnId), turn);
});

test('review: a write during directory reading invalidates the private pre-read baseline', async () => {
  const f = await fixture();
  f.hooks.beforeRead = async () => {
    await f.store.putAsset(f.identity.workspaceId, 'annotations/local-only.json', { value: 'late human value' });
  };
  const scan = await f.scan();
  assert.equal(scan.success, true, JSON.stringify(scan));
  const before = await f.store.captureRestoreBaseline(f.identity.workspaceId);
  const result = await f.commit(scan);
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'WORKSPACE_RESTORE_CONFLICT');
  assert.deepEqual(await f.store.captureRestoreBaseline(f.identity.workspaceId), before);
});

test('review: first committed sender locks the plan against another tab at the same URL', async () => {
  const f = await fixture();
  const scan = await f.scan();
  assert.equal((await f.commit(scan)).success, true);
  const result = await f.commit(scan, { ...f.context, senderTabId: 10 });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'ARTICLE_RESTORE_RECEIPT_INVALID');
});

test('review: scan documentId cannot be replaced while reusing the same URL/hash/nonce', async () => {
  const f = await fixture();
  const scan = await f.scan();
  const before = await f.store.captureRestoreBaseline(f.identity.workspaceId);
  const message = f.message(scan);
  message.binding.documentId = 'document-from-another-page-state';
  const result = await f.router.handle(message, f.context);
  assert.equal(result.success, false, 'Prepared identity must include the documentId captured at scan');
  assert.deepEqual(await f.store.captureRestoreBaseline(f.identity.workspaceId), before);
});

test('review: a sender already known to have navigated cannot durably commit its old plan', async () => {
  const f = await fixture();
  const scan = await f.scan();
  const before = await f.store.captureRestoreBaseline(f.identity.workspaceId);
  let checks = 0;
  const result = await f.commit(scan, { ...f.context,
    async assertTrustedOwnerCurrent() {
      checks += 1;
      throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' });
    }
  });
  assert.equal(result.success, false, 'Static sender.url must not replace the live browser document guard');
  assert.ok(checks > 0);
  assert.deepEqual(await f.store.captureRestoreBaseline(f.identity.workspaceId), before);
});

test('review: committed sender binding rejects another frame or browser document in the same tab', async () => {
  const f = await fixture();
  const scan = await f.scan();
  assert.equal((await f.commit(scan)).success, true);
  const before = await f.store.captureRestoreBaseline(f.identity.workspaceId);
  for (const context of [{ ...f.context, senderFrameId: 1 },
    { ...f.context, senderDocumentId: 'browser-document-after-navigation' }]) {
    const result = await f.commit(scan, context);
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'ARTICLE_RESTORE_RECEIPT_INVALID');
    assert.deepEqual(await f.store.captureRestoreBaseline(f.identity.workspaceId), before);
  }
});
