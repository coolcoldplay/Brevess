const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/article-chat-citations.js');
const { createArticleChatNdjsonParser } = require('../core/article-chat-stream.js');

const snapshot = {
  revision: 9,
  paragraphs: [
    {
      paragraphId: 'p1', sourceKey: 'results:1', textHash: 'hash-1',
      sectionTitle: 'Results', sectionPath: ['Results'],
      text: 'The first verified observation.'
    },
    {
      paragraphId: 'p2', sourceKey: 'results:2', textHash: 'hash-2',
      sectionTitle: 'Results', sectionPath: ['Results'],
      text: 'The second verified observation.'
    }
  ]
};

test('consumer callbacks cannot rewrite the accepted evidence later inherited by marker', () => {
  let callbackRuns = 0;
  const parser = createArticleChatNdjsonParser({
    snapshot,
    onBlock(block) {
      callbackRuns += 1;
      if (callbackRuns !== 1) return;
      block.evidence[0].paragraphId = 'p2';
      block.evidence[0].sourceKey = 'results:2';
      block.evidence[0].textHash = 'hash-2';
      block.evidence[0].quote = snapshot.paragraphs[1].text;
    }
  });

  parser.push(JSON.stringify({
    type: 'answer_block', block_id: 'first', markdown: 'First claim.[[1]]',
    evidence: [{
      marker: '1', paragraph_id: 'p1', source_key: 'results:1', text_hash: 'hash-1',
      quote: snapshot.paragraphs[0].text, section_path: ['Results']
    }]
  }) + '\n');
  parser.push(JSON.stringify({
    type: 'answer_block', block_id: 'later', markdown: 'Later claim.[[1]]', evidence: []
  }) + '\n');

  const blocks = parser.snapshot().blocks;
  assert.equal(blocks[0].evidence[0].paragraphId, 'p1');
  assert.equal(blocks[1].evidence[0].paragraphId, 'p1');
  assert.equal(blocks[1].evidence[0].verification.status, 'verified');
});

test('a verified paragraph identity with an absent quote is not inherited', () => {
  const parser = createArticleChatNdjsonParser({ snapshot });
  parser.push(JSON.stringify({
    type: 'answer_block', block_id: 'first', markdown: 'First claim.[[1]]',
    evidence: [{
      marker: '1', paragraph_id: 'p1', source_key: 'results:1', text_hash: 'hash-1',
      quote: 'This quotation does not occur in either source paragraph.',
      section_path: ['Results']
    }]
  }) + '\n');

  assert.throws(() => parser.push(JSON.stringify({
    type: 'answer_block', block_id: 'later', markdown: 'Later claim.[[1]]', evidence: []
  }) + '\n'), /markers do not match/);
});

test('snapshot and compatible-payload callbacks expose no mutable prior-evidence reference', () => {
  const parser = createArticleChatNdjsonParser({ snapshot });
  parser.push(JSON.stringify({
    type: 'answer_block', block_id: 'first', markdown: 'First claim.[[1]]',
    evidence: [{
      marker: '1', paragraph_id: 'p1', source_key: 'results:1', text_hash: 'hash-1',
      quote: snapshot.paragraphs[0].text, section_path: ['Results']
    }]
  }) + '\n');
  const exposed = parser.snapshot();
  exposed.blocks[0].evidence[0].paragraphId = 'p2';
  exposed.blocks[0].evidence[0].verification.target.paragraphId = 'p2';
  parser.push(JSON.stringify({
    type: 'answer_block', block_id: 'later', markdown: 'Later claim.[[1]]', evidence: []
  }) + '\n');
  assert.deepEqual(parser.snapshot().blocks.map(block => block.evidence[0].paragraphId),
    ['p1', 'p1']);

  const observed = [];
  const compatible = createArticleChatNdjsonParser({
    snapshot,
    onRecord(record) {
      observed.push(record);
      if (record.type === 'answer_block' && record.evidence[0]) {
        record.evidence[0].paragraphId = 'p2';
        record.evidence[0].verification.target.paragraphId = 'p2';
      }
    }
  });
  const completed = compatible.consumeCompatiblePayload(JSON.stringify([
    {
      type: 'answer_block', block_id: 'compatible-first', markdown: 'First claim.[[1]]',
      evidence: [{
        marker: '1', paragraph_id: 'p1', source_key: 'results:1', text_hash: 'hash-1',
        quote: snapshot.paragraphs[0].text, section_path: ['Results']
      }]
    },
    {
      type: 'answer_block', block_id: 'compatible-later',
      markdown: 'Later claim.[[1]]', evidence: []
    },
    { type: 'final', status: 'completed' }
  ]));
  assert.equal(completed, true);
  assert.deepEqual(compatible.snapshot().blocks.map(block => block.evidence[0].paragraphId),
    ['p1', 'p1']);
  assert.equal(observed.length, 3);
});
