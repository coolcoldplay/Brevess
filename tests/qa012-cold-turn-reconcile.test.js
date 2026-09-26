const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'archive-prepared-document.test.js'), 'utf8');
const { fixture } = new Function('require', '__dirname',
  source.slice(0, source.indexOf('\ntest(')) + '\nreturn { fixture };')(require, __dirname);
const clone = value => structuredClone(value);

async function savedCopies({ staleStandaloneAnswer = false, mutateStandalone, emptyIndexOperation = false } = {}) {
  const turn = { turnId: 'qa012-completed', question: 'What is supported?', status: 'completed',
    operationId: '', createdAt: 1790264637489, updatedAt: 1790264867798,
    answerBlocks: [{ blockId: 'b', markdown: 'Saved scientific answer [P1].',
      evidence: [{ marker: '[P1]', paragraphId: 'p1', quote: 'Exact original text.' }] }] };
  const oldIndexTurn = { ...clone(turn), operationId: 'chat-1-1790264637489', updatedAt: 1790264654228 };
  if (emptyIndexOperation) oldIndexTurn.operationId = '';
  const index = { turns: [oldIndexTurn], totalTurns: 1, returnedTurns: 1, windowStart: 0, hasEarlier: false };
  if (staleStandaloneAnswer) turn.answerBlocks[0].markdown = 'Older standalone answer must not replace this saved aggregate.';
  mutateStandalone?.(turn);
  const f = await fixture({ assets: [{ path: 'chat/index.json', content: index },
    { path: `chat/turns/${turn.turnId}.json`, content: turn }] });
  await f.store.putAsset(f.identity.workspaceId, 'chat/index.json', clone(index));
  await f.store.appendTurn(f.identity.workspaceId, clone(turn));
  return { ...f, turn, index };
}

test('QA012 identical saved index and independent terminal turn copies restore despite aggregate lifecycle lag', async () => {
  const f = await savedCopies();
  const before = await f.store.getAsset(f.identity.workspaceId, 'chat/index.json');
  const scanned = await f.scan();
  assert.equal(scanned.success, true, JSON.stringify(scanned));
  assert.deepEqual(await f.store.getAsset(f.identity.workspaceId, 'chat/index.json'), before, 'scan remains read-only');
  const restored = scanned.data.restore.assets.find(a => a.relativePath === 'chat/index.json').content;
  assert.equal(restored.turns[0].operationId, '');
  assert.deepEqual(restored.turns[0].answerBlocks, f.turn.answerBlocks);
  assert.equal((await f.commit(scanned)).success, true);
  assert.deepEqual((await f.store.getAsset(f.identity.workspaceId, 'chat/index.json')).content, restored);
});

test('QA012 divergent answer between saved aggregate and independent turn is not terminal lifecycle cleanup', async () => {
  const f = await savedCopies({ staleStandaloneAnswer: true });
  const before = await f.store.getAsset(f.identity.workspaceId, 'chat/index.json');
  const scanned = await f.scan();
  assert.equal(scanned.success, false);
  assert.equal(scanned.error.code, 'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
  assert.deepEqual(await f.store.getAsset(f.identity.workspaceId, 'chat/index.json'), before);
});

test('QA012 repeated final saves may only advance the completed checkpoint time', async () => {
  const f = await savedCopies({ emptyIndexOperation: true });
  assert.equal((await f.scan()).success, true);
});

for (const [name, mutateStandalone] of [
  ['citation text', t => { t.answerBlocks[0].evidence[0].quote = 'Changed scientific quote.'; }],
  ['createdAt', t => { t.createdAt += 1; }],
  ['question', t => { t.question = 'A different question'; }],
  ['status', t => { t.status = 'streaming'; }],
  ['extra metadata', t => { t.extra = 'unmatched'; }]
]) test(`QA012 standalone ${name} drift is not a permitted lifecycle difference`, async () => {
  const f = await savedCopies({ mutateStandalone });
  const scan = await f.scan();
  assert.equal(scan.success, false);
  assert.equal(scan.error.code, 'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
});

for (const [name, mutate] of [
  ['newer answer in local aggregate', async f => { const edited = clone(f.index); edited.turns[0].answerBlocks[0].markdown = 'Newer user answer'; await f.store.putAsset(f.identity.workspaceId, 'chat/index.json', edited); }],
  ['newer answer in local independent turn', async f => { const edited = clone(f.turn); edited.answerBlocks[0].markdown = 'Newer user answer'; await f.store.updateTurn(f.identity.workspaceId, f.turn.turnId, edited); }],
  ['active operation only in local independent turn', async f => { await f.store.updateTurn(f.identity.workspaceId, f.turn.turnId, { ...f.turn, operationId: 'chat-active-new', status: 'streaming' }); }],
  ['operation identity difference in local terminal turn', async f => { await f.store.updateTurn(f.identity.workspaceId, f.turn.turnId, { ...f.turn, operationId: 'chat-new-terminal' }); }],
  ['explicit cleared aggregate', async f => { await f.store.putAsset(f.identity.workspaceId, 'chat/index.json', { ...f.index, turns: [], totalTurns: 0, returnedTurns: 0 }); }]
]) test(`QA012 retains conflict protection for ${name}`, async () => {
  const f = await savedCopies(); await mutate(f);
  const beforeAssets = await f.store.listAssets(f.identity.workspaceId);
  const beforeTurns = await f.store.pageTurns(f.identity.workspaceId, { limit: 100 });
  const scanned = await f.scan();
  assert.equal(scanned.success, false);
  assert.equal(scanned.error.code, 'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT');
  assert.deepEqual(await f.store.listAssets(f.identity.workspaceId), beforeAssets);
  assert.deepEqual(await f.store.pageTurns(f.identity.workspaceId, { limit: 100 }), beforeTurns);
  assert.equal(f.queued.length, 0);
});

test('QA012 edits after a successful scan still invalidate the atomic restore baseline', async () => {
  const f = await savedCopies(); const scan = await f.scan();
  assert.equal(scan.success, true, JSON.stringify(scan));
  const edited = await f.store.updateTurn(f.identity.workspaceId, f.turn.turnId, { ...f.turn, question: 'New local question' });
  const result = await f.commit(scan);
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'WORKSPACE_RESTORE_CONFLICT');
  assert.deepEqual((await f.store.pageTurns(f.identity.workspaceId, { limit: 100 })).items.find(t => t.turnId === f.turn.turnId), edited);
});
