const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HIGHLIGHT_DISTRIBUTION_VERSION,
  buildHighlightDistribution
} = require('../core/highlight-distribution.js');

const structure = {
  nodes: [{
    sectionId: 'sec-intro',
    title: 'Introduction',
    level: 2,
    order: 0,
    children: [{
      sectionId: 'sec-gap',
      title: 'Knowledge gap',
      level: 3,
      order: 1,
      children: [],
      paragraphIds: ['p-gap']
    }],
    paragraphIds: ['p-intro']
  }, {
    sectionId: 'sec-results',
    title: 'Results',
    level: 2,
    order: 2,
    children: [],
    paragraphIds: ['p-results']
  }],
  paragraphs: [
    { paragraphId: 'p-intro', sectionId: 'sec-intro', order: 0 },
    { paragraphId: 'p-gap', sectionId: 'sec-gap', order: 1 },
    { paragraphId: 'p-results', sectionId: 'sec-results', order: 2 }
  ]
};

test('highlight distribution groups automatic and manual marks by leaf section and category', () => {
  const result = buildHighlightDistribution(structure, [
    {
      highlightId: 'h-1',
      paragraphId: 'p-intro',
      categoryId: 'background',
      categoryName: '背景',
      color: '#A9D8FF',
      source: 'llm'
    },
    {
      highlightId: 'h-2',
      paragraphId: 'p-gap',
      categoryId: 'limitation',
      categoryName: '局限性',
      color: '#FFD2A8',
      source: 'manual'
    },
    {
      highlightId: 'h-3',
      sectionId: 'sec-results',
      categoryId: 'result',
      categoryName: '结果',
      color: '#BCE6C2',
      source: 'regex'
    }
  ]);

  assert.equal(result.totalHighlights, 3);
  assert.equal(HIGHLIGHT_DISTRIBUTION_VERSION, '3');
  assert.deepEqual(result.sourceCounts, {
    manual: 1, llm: 1, regex: 1, other: 0
  });
  assert.deepEqual(result.categories.map(item => item.categoryId), [
    'background', 'limitation', 'result'
  ]);
  assert.equal(
    result.rows.find(row => row.sectionId === 'sec-gap')
      .cells.limitation.count,
    1
  );
  assert.equal(
    result.rows.find(row => row.sectionId === 'sec-gap')
      .cells.limitation.sources.manual.count,
    1
  );
  assert.equal(
    result.rows.find(row => row.sectionId === 'sec-results')
      .cells.result.items[0].source,
    'regex'
  );
});

test('highlight distribution keeps unresolved marks visible without inventing a section', () => {
  const result = buildHighlightDistribution(structure, [{
    highlightId: 'h-unresolved',
    categoryId: 'other',
    categoryName: '其他',
    color: '#D9D6CE',
    source: 'manual'
  }]);
  assert.equal(result.unresolved.length, 1);
  assert.equal(result.totalHighlights, 1);
  assert.equal(result.rows.some(row => row.sectionId === ''), false);
});

test('highlight distribution deduplicates the same automatic mark preserved across analysis modes', () => {
  const duplicate = {
    paragraphId: 'p-results',
    sectionId: 'sec-results',
    categoryId: 'result',
    categoryName: '结果陈述',
    color: '#BCE6C2',
    source: 'regex',
    quote: 'Treatment increased survival.',
    sourceStart: 14,
    sourceEnd: 43
  };
  const result = buildHighlightDistribution(structure, [
    { ...duplicate, highlightId: 'quick-story-result' },
    { ...duplicate, highlightId: 'mechanism-result' },
    {
      ...duplicate,
      highlightId: 'second-real-occurrence',
      sourceStart: 72,
      sourceEnd: 101
    },
    {
      ...duplicate,
      highlightId: 'manual-copy',
      source: 'manual'
    }
  ]);

  assert.equal(result.totalHighlights, 3);
  assert.equal(result.deduplicatedHighlights, 1);
  assert.equal(result.sourceCounts.regex, 2);
  assert.equal(result.sourceCounts.manual, 1);
  assert.equal(result.rows[0].cells.result.count, 3);
});
