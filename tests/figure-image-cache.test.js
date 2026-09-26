const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeFigureImageCacheKey,
  selectFigureImageCacheEvictions
} = require('../core/figure-image-cache.js');

test('normalizes persistent Figure cache keys without credentials or fragments', () => {
  assert.equal(
    normalizeFigureImageCacheKey('https://user:secret@cdn.example/figure.png?token=1#panel-a'),
    'https://cdn.example/figure.png?token=1'
  );
  assert.equal(normalizeFigureImageCacheKey('blob:https://example.test/id'), '');
});

test('evicts least-recently-used Figure images by both bytes and entry count', () => {
  const records = [
    { cacheKey: 'old', byteLength: 8, lastAccessedAt: 1 },
    { cacheKey: 'middle', byteLength: 7, lastAccessedAt: 2 },
    { cacheKey: 'new', byteLength: 6, lastAccessedAt: 3 }
  ];
  assert.deepEqual(selectFigureImageCacheEvictions(records, 13, 3), ['old']);
  assert.deepEqual(selectFigureImageCacheEvictions(records, 100, 2), ['old']);
});
