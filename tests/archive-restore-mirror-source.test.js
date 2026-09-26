const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'archive-prepared-document.test.js'), 'utf8');
const { fixture } = new Function('require', '__dirname',
  source.slice(0, source.indexOf('\ntest(')) + '\nreturn { fixture };')(require, __dirname);
test('prepared mirror is bound to original scanned chat before public normalization', async () => {
  const original = { turns: [{ turnId: 't', question: 'q', status: 'completed', webGrounding: null,
    answerBlocks: [{ blockId: 'b', markdown: 'answer', evidence: [] }] }] };
  const f = await fixture({ assets: [{ path: 'chat/index.json', content: original }] });
  const scan = await f.scan();
  assert.equal(scan.success, true);
  assert.equal(scan.data.restore.directorySources, undefined, 'source baselines stay private');
  const result = await f.commit(scan);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.data.syncStatus, 'queued');
  assert.equal(f.queued.length, 1);
  assert.equal(f.queued[0].metadata.advanceFromDirectory, true);
  assert.deepEqual(f.queued[0].metadata.expectedDirectoryAsset,
    { revision: 40, contentHash: '3'.repeat(64), data: original });
  assert.equal(Object.hasOwn(f.queued[0].content.turns[0], 'webGrounding'), false);
});
