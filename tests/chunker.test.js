const test = require('node:test');
const assert = require('node:assert/strict');
const { chunkParagraphs } = require('../core/chunker.js');

test('covers every paragraph without candidate filtering', () => {
  const paragraphs = [
    { paragraphId: 'p1', sectionTitle: 'A', text: 'A'.repeat(60) },
    { paragraphId: 'p2', sectionTitle: 'A', text: 'B'.repeat(60) },
    { paragraphId: 'p3', sectionTitle: 'B', text: 'C'.repeat(60) }
  ];
  const chunks = chunkParagraphs(paragraphs, { maxChars: 130, overlapParagraphs: 1 });
  const ids = new Set(chunks.flatMap(chunk => chunk.paragraphs.map(item => item.paragraphId)));
  assert.deepEqual([...ids].sort(), ['p1', 'p2', 'p3']);
  assert.equal(chunks[0].paragraphs.at(-1).paragraphId, chunks[1].paragraphs[0].paragraphId);
});

test('does not mutate source paragraphs', () => {
  const paragraphs = [{ paragraphId: 'p1', sectionTitle: 'A', text: 'text' }];
  const before = JSON.stringify(paragraphs);
  chunkParagraphs(paragraphs, { maxChars: 100 });
  assert.equal(JSON.stringify(paragraphs), before);
});

test('preserves the inherited major section kind on chunks', () => {
  const chunks = chunkParagraphs([{
    paragraphId: 'p-results', sectionTitle: 'Model performance',
    sectionKind: 'results', text: 'The model did not improve specificity.'
  }], { maxChars: 100 });
  assert.equal(chunks[0].sectionTitle, 'Model performance');
  assert.equal(chunks[0].sectionKind, 'results');
});

test('does not mix different major section kinds in one analysis chunk', () => {
  const chunks = chunkParagraphs([
    { paragraphId: 'p-intro', sectionTitle: 'Introduction', sectionKind: 'introduction', text: 'Background.' },
    { paragraphId: 'p-result', sectionTitle: 'Model performance', sectionKind: 'results', text: 'No improvement was observed.' }
  ], { maxChars: 1000, overlapParagraphs: 1 });
  assert.deepEqual(chunks.map(chunk => chunk.sectionKind), ['introduction', 'results']);
  assert.deepEqual(chunks.map(chunk => chunk.paragraphs.map(item => item.paragraphId)), [
    ['p-intro'], ['p-result']
  ]);
});

test('starts a fresh chunk for every distinct Results subsection', () => {
  const chunks = chunkParagraphs([
    {
      paragraphId: 'p-result-a', sectionId: 'sec-results-neural',
      sectionTitle: 'Neural pathway mediates heat stress', sectionKind: 'results',
      text: 'Neural inhibition prevented the endocrine response.'
    },
    {
      paragraphId: 'p-result-b', sectionId: 'sec-results-vitamin-a',
      sectionTitle: 'Vitamin A rescues metabolic dysfunction', sectionKind: 'results',
      text: 'Vitamin A supplementation restored glucose tolerance.'
    }
  ], { maxChars: 1000, overlapParagraphs: 1 });
  assert.deepEqual(chunks.map(chunk => chunk.paragraphs.map(item => item.paragraphId)), [
    ['p-result-a'], ['p-result-b']
  ]);
});
