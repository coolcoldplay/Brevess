const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/article-chat-tokenizer.js');
const { buildArticleChatIndex } = require('../core/article-chat-index.js');

function paragraph(index, text, overrides = {}) {
  return {
    paragraphId: `p-${index}`,
    sourceKey: `source-${index}`,
    sourceIdentity: `stable-${index}`,
    textHash: `hash-${index}`,
    recordType: 'body',
    sectionId: 'sec-results',
    sectionTitle: 'Results',
    sectionKind: 'results',
    headingPath: [{ level: 2, sectionId: 'sec-results', title: 'Results' }],
    text,
    ...overrides
  };
}

test('builds immutable boundary-aware chunks with stable source metadata', () => {
  const paragraphs = Array.from({ length: 10 }, (_, index) =>
    paragraph(index + 1, `Sentence ${index + 1}. ${'x'.repeat(385)}`));
  const snapshot = {
    key: 'doc-hash:3', documentHash: 'doc-hash', revision: 3,
    paragraphs, typedRecords: paragraphs
  };
  const before = JSON.stringify(snapshot);
  const index = buildArticleChatIndex(snapshot);

  assert.equal(JSON.stringify(snapshot), before);
  assert.ok(Object.isFrozen(index));
  assert.ok(Object.isFrozen(index.chunks));
  assert.ok(index.chunks.length >= 2);
  for (const chunk of index.chunks.slice(0, -1)) {
    assert.ok(chunk.text.length >= 1500, chunk.text.length);
    assert.ok(chunk.text.length <= 2500, chunk.text.length);
  }
  assert.deepEqual(index.chunks[0].sourceSpans[0], {
    paragraphId: 'p-1', sourceKey: 'source-1', sourceIdentity: 'stable-1',
    textHash: 'hash-1', sourceStart: 0, sourceEnd: paragraphs[0].text.length
  });
  assert.equal(index.diagnostics.sourceRecordCount, paragraphs.length);
});

test('splits one oversized paragraph at readable sentence boundaries without losing source offsets', () => {
  const sentence = `A complete scientific sentence reports the measured response ${'z'.repeat(180)}.`;
  const text = Array.from({ length: 24 }, () => sentence).join(' ');
  const index = buildArticleChatIndex({
    key: 'long:1', documentHash: 'long', revision: 1,
    paragraphs: [paragraph(1, text)], typedRecords: [paragraph(1, text)]
  });

  assert.ok(index.chunks.length >= 2);
  assert.ok(index.chunks.every(chunk => chunk.text.length <= 2500));
  assert.equal(index.chunks.flatMap(chunk => chunk.sourceSpans)
    .every(span => text.slice(span.sourceStart, span.sourceEnd).trim().length > 0), true);
  assert.equal(index.chunks.at(-1).sourceSpans.at(-1).sourceEnd, text.length);
});

test('keeps typed source records and produces the same index identity for the same snapshot', () => {
  const records = [
    paragraph(1, 'The intervention improved survival.'),
    paragraph(2, 'Figure 1. Kaplan-Meier survival curves.', { recordType: 'figure-caption' }),
    paragraph(3, 'Smith et al. 2020.', {
      recordType: 'reference', sectionId: 'sec-references',
      sectionTitle: 'References', sectionKind: 'reference'
    })
  ];
  const snapshot = {
    key: 'paper:2', documentHash: 'paper', revision: 2,
    paragraphs: records.filter(item => item.recordType === 'body'),
    typedRecords: records
  };
  const first = buildArticleChatIndex(snapshot);
  const second = buildArticleChatIndex(JSON.parse(JSON.stringify(snapshot)));

  assert.equal(first.indexId, second.indexId);
  assert.deepEqual(new Set(first.chunks.map(chunk => chunk.recordType)),
    new Set(['body', 'figure-caption', 'reference']));
  assert.equal(first.documentHash, 'paper');
  assert.equal(first.revision, 2);
});
