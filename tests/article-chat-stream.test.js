const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMarkdownBlockStreamCoalescer
} = require('../core/article-chat-stream.js');

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
