const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/article-chat-citations.js');
const {
  createMarkdownBlockStreamCoalescer,
  createArticleChatNdjsonParser
} = require('../core/article-chat-stream.js');

const citationSnapshot = {
  revision: 4,
  paragraphs: [{
    paragraphId: 'p1', sourceKey: 'results:1', textHash: 'hash-1',
    sectionTitle: 'Results', sectionPath: ['Results'],
    text: 'Treatment significantly improved survival in the intervention group.'
  }]
};

function createCollector(options = {}) {
  const blocks = [];
  const stream = createMarkdownBlockStreamCoalescer({
    onBlock(block, reason) {
      blocks.push({ block, reason });
    },
    minBoundaryChars: 1,
    targetChars: 8,
    hardCapChars: 20,
    maxWaitMs: 0,
    ...options
  });
  return { blocks, stream };
}

test('stream coalescer does not emit an unfinished paragraph', () => {
  const { blocks, stream } = createCollector();

  stream.pushText('Partial paragraph');
  stream.flushNow('timer');
  assert.deepEqual(blocks, []);

  stream.pushText(' completed.\n\n');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].block, 'Partial paragraph completed.\n\n');
});

test('stream coalescer does not emit unfinished lists, fenced code, or tables', () => {
  const cases = [
    ['- first item', '\n- second item\n\n'],
    ['```js\nconst answer =', ' 42;\n```\n\n'],
    ['| Marker | Result |\n| ---', ' | --- |\n| TP53 | rescue |\n\n']
  ];

  for (const [unfinished, completion] of cases) {
    const { blocks, stream } = createCollector();
    stream.pushText(unfinished);
    stream.flushNow('timer');
    assert.equal(blocks.length, 0, `emitted unfinished Markdown for ${unfinished}`);
    stream.pushText(completion);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].block, unfinished + completion);
  }
});

test('stream coalescer finalizes the last complete response and cancellation discards pending text', () => {
  const first = createCollector();
  first.stream.pushText('Last paragraph without a blank line.');
  first.stream.finish();
  assert.deepEqual(first.blocks, [{
    block: 'Last paragraph without a blank line.',
    reason: 'final'
  }]);

  const second = createCollector();
  second.stream.pushText('Do not render this incomplete');
  second.stream.cancel();
  second.stream.finish();
  assert.deepEqual(second.blocks, []);
});

test('NDJSON parser emits only complete validated answer blocks', () => {
  const blocks = [];
  const records = [];
  const parser = createArticleChatNdjsonParser({
    snapshot: citationSnapshot,
    onBlock: block => blocks.push(block),
    onRecord: record => records.push(record)
  });
  const line = JSON.stringify({
    type: 'answer_block', block_id: 'block-1',
    markdown: '治疗显著改善生存。[[1]]',
    evidence: [{
      marker: '1', paragraph_id: 'p1', source_key: 'results:1', text_hash: 'hash-1',
      quote: 'Treatment significantly improved survival in the intervention group.',
      section_path: ['Results']
    }]
  });

  parser.push(line.slice(0, 30));
  assert.equal(blocks.length, 0);
  parser.push(`${line.slice(30)}\n`);
  parser.push(`${JSON.stringify({ type: 'turn_summary', summary: '治疗改善生存。' })}\n`);
  parser.push(`${JSON.stringify({ type: 'final', status: 'completed' })}\n`);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].evidence[0].verification.status, 'verified');
  assert.deepEqual(records.map(record => record.type), [
    'answer_block', 'turn_summary', 'final'
  ]);
  assert.equal(parser.snapshot().final.status, 'completed');
});

test('NDJSON parser accepts a model wrapping the stream in a Markdown JSON fence', () => {
  const blocks = [];
  const parser = createArticleChatNdjsonParser({
    snapshot: citationSnapshot,
    onBlock: block => blocks.push(block)
  });
  const answer = JSON.stringify({
    type: 'answer_block', block_id: 'block-fenced',
    markdown: '治疗显著改善生存。[[1]]',
    evidence: [{
      marker: '1', paragraph_id: 'p1', source_key: 'results:1', text_hash: 'hash-1',
      quote: 'Treatment significantly improved survival in the intervention group.',
      section_path: ['Results']
    }]
  });

  parser.push(`\`\`\`jsonl\n${answer}\n`);
  parser.push(`${JSON.stringify({ type: 'turn_summary', summary: '治疗改善生存。' })}\n`);
  parser.push(`${JSON.stringify({ type: 'final', status: 'completed' })}\n\`\`\`\n`);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].blockId, 'block-fenced');
  assert.equal(parser.finish(), true);
  assert.equal(parser.snapshot().final.status, 'completed');
});

test('NDJSON parser discards an incomplete block and deduplicates a continuation', () => {
  const blocks = [];
  const parser = createArticleChatNdjsonParser({
    snapshot: citationSnapshot,
    onBlock: block => blocks.push(block)
  });
  const complete = JSON.stringify({
    type: 'answer_block', block_id: 'block-1',
    markdown: '治疗显著改善生存。[[1]]',
    evidence: [{ marker: '1', paragraph_id: 'p1' }]
  });
  parser.push(`${complete}\n{"type":"answer_block","block_id":"unfinished"`);
  assert.ok(parser.discardPending() > 0);
  parser.push(`${complete}\n`);
  parser.push(`${JSON.stringify({
    ...JSON.parse(complete), block_id: 'block-duplicate-content'
  })}\n`);

  assert.deepEqual(blocks.map(block => block.blockId), ['block-1']);
});

test('NDJSON parser rejects unfinished Markdown and leading evidence markers', () => {
  const parser = createArticleChatNdjsonParser({ snapshot: citationSnapshot });
  assert.throws(() => parser.push(`${JSON.stringify({
    type: 'answer_block', block_id: 'open-fence', markdown: '```js\nconst x = 1', evidence: []
  })}\n`), error => error.code === 'INVALID_RESPONSE');
  assert.throws(() => parser.push(`${JSON.stringify({
    type: 'answer_block', block_id: 'bad-marker',
    markdown: '[[1]] 治疗显著改善生存',
    evidence: [{ marker: '1', paragraph_id: 'p1' }]
  })}\n`), error => error.code === 'INVALID_RESPONSE');
});

test('NDJSON parser accepts a citation after an unpunctuated numbered item', () => {
  const parser = createArticleChatNdjsonParser({ snapshot: citationSnapshot });
  parser.push(`${JSON.stringify({
    type: 'answer_block', block_id: 'numbered-item',
    markdown: '1. 利用神经肽-GAL4品系进行功能筛选 [[1]]',
    evidence: [{ marker: '1', paragraph_id: 'p1' }]
  })}\n`);

  assert.equal(parser.snapshot().blocks.length, 1);
});
