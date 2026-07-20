const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createArticleChatQueue
} = require('../core/article-chat-queue.js');

test('queued questions bind an immutable model profile at enqueue time', () => {
  const queue = createArticleChatQueue();
  let selectedProfileId = 'profile_deepseek';
  const entry = queue.enqueue({ question: 'Explain Figure 2A', profileId: selectedProfileId });
  selectedProfileId = 'profile_openai';

  const active = queue.startNext();
  assert.equal(active.id, entry.id);
  assert.equal(active.profileId, 'profile_deepseek');
  assert.ok(Object.isFrozen(active));
  assert.equal(selectedProfileId, 'profile_openai');
});

test('a queued question can be deleted before it is sent', () => {
  const queue = createArticleChatQueue();
  const first = queue.enqueue({ question: 'Keep', profileId: 'profile_a' });
  const second = queue.enqueue({ question: 'Delete', profileId: 'profile_b' });

  assert.equal(queue.remove(second.id), true);
  assert.equal(queue.remove(second.id), false);
  assert.deepEqual(queue.getPending().map(item => item.id), [first.id]);
  assert.equal(queue.startNext().question, 'Keep');
  assert.equal(queue.startNext(), null);
});

test('active-turn cancellation aborts only the active request and preserves pending questions', () => {
  const queue = createArticleChatQueue();
  const activeEntry = queue.enqueue({ question: 'Active', profileId: 'profile_a' });
  const pendingEntry = queue.enqueue({ question: 'Pending', profileId: 'profile_b' });
  const active = queue.startNext();

  assert.equal(active.id, activeEntry.id);
  assert.equal(active.signal.aborted, false);
  assert.equal(queue.cancelActive('user'), true);
  assert.equal(active.signal.aborted, true);
  assert.equal(queue.getActive(), null);
  assert.deepEqual(queue.getPending().map(item => item.id), [pendingEntry.id]);
  assert.equal(queue.cancelActive('user'), false);
});

test('queue rejects empty questions and invalid profile identifiers', () => {
  const queue = createArticleChatQueue();
  assert.throws(() => queue.enqueue({ question: '  ', profileId: 'profile_a' }), /question/i);
  assert.throws(() => queue.enqueue({ question: 'Valid', profileId: '' }), /profile/i);
});
