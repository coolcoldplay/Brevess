const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/article-chat-tokenizer.js');
const {
  buildArticleChatMemory,
  retrieveArticleChatMemory,
  deleteArticleChatTurnAndRebuild
} = require('../core/article-chat-memory.js');

function turn(index, text = '') {
  return {
    turnId: `turn-${index}`,
    question: `Question ${index} ${text}`,
    answer: `Answer ${index} explains ${text || 'the paper'}.`,
    createdAt: index
  };
}

test('builds deterministic local memory without a fixed history count', () => {
  const turns = Array.from({ length: 80 }, (_, index) => turn(index + 1));
  const first = buildArticleChatMemory(turns);
  const second = buildArticleChatMemory(JSON.parse(JSON.stringify(turns)));

  assert.equal(first.entries.length, 80);
  assert.equal(first.memoryId, second.memoryId);
  assert.deepEqual(first.entries.map(item => item.turnId), turns.map(item => item.turnId));
  assert.ok(Object.isFrozen(first));
});

test('retrieves an old turn by scientific terms instead of recency alone', () => {
  const turns = Array.from({ length: 60 }, (_, index) =>
    turn(index + 1, index === 2 ? 'rare-neuroaxis N6-mA signal' : 'common result'));
  const memory = buildArticleChatMemory(turns);
  const matches = retrieveArticleChatMemory(memory, 'What did the rare-neuroaxis N6-mA turn say?', {
    limit: 4
  });

  assert.equal(matches[0].turnId, 'turn-3');
  assert.ok(matches[0].score > 0);
});

test('deleting a question-answer turn deterministically rebuilds memory', () => {
  const memory = buildArticleChatMemory([
    turn(1, 'alpha'), turn(2, 'delete-marker'), turn(3, 'gamma')
  ]);
  const rebuilt = deleteArticleChatTurnAndRebuild(memory, 'turn-2');

  assert.deepEqual(rebuilt.entries.map(item => item.turnId), ['turn-1', 'turn-3']);
  assert.equal(retrieveArticleChatMemory(rebuilt, 'delete-marker').length, 0);
  assert.equal(
    rebuilt.memoryId,
    buildArticleChatMemory([turn(1, 'alpha'), turn(3, 'gamma')]).memoryId
  );
});
