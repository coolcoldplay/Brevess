const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseFigureSrcset,
  collectFigureImageCandidates,
  collectFigureImageSources,
  selectFigureImageSource
} = require('../core/figure-viewer.js');

function fakeImage(attributes = {}, currentSrc = '', anchorHref = '') {
  return {
    currentSrc,
    src: attributes.src || '',
    getAttribute(name) { return attributes[name] || ''; },
    closest() {
      return anchorHref ? { getAttribute: () => anchorHref, href: anchorHref } : null;
    }
  };
}

test('orders srcset candidates by declared width', () => {
  assert.deepEqual(parseFigureSrcset('small.jpg 320w, large.jpg 1600w')
    .map(item => item.source), ['large.jpg', 'small.jpg']);
});

test('prefers explicit original source and rejects script URLs', () => {
  const image = fakeImage({
    'data-original': 'https://cdn.example/full.png',
    srcset: 'https://cdn.example/small.png 320w, javascript:alert(1) 2000w',
    src: 'https://cdn.example/fallback.png'
  });
  assert.equal(collectFigureImageCandidates(image, 'https://paper.example/article')[0],
    'https://cdn.example/full.png');
  assert.ok(!collectFigureImageCandidates(image).some(url => url.startsWith('javascript:')));
});

test('selects the first safe source across Figure images', () => {
  const figure = { imageElements: [fakeImage({}, '', ''), fakeImage({
    'data-hires': '/figures/figure-s2.webp'
  })] };
  assert.equal(selectFigureImageSource(figure, 'https://paper.example/article'),
    'https://paper.example/figures/figure-s2.webp');
});

test('keeps every distinct safe Figure candidate for load fallback', () => {
  const figure = {
    imageElements: [
      fakeImage({ 'data-hires': '/figures/full.png', src: '/figures/preview.png' }),
      fakeImage({ srcset: '/figures/full.png 2x, /figures/thumb.png 1x' })
    ]
  };
  assert.deepEqual(collectFigureImageSources(figure, 'https://paper.example/article'), [
    'https://paper.example/figures/full.png',
    'https://paper.example/figures/preview.png',
    'https://paper.example/figures/thumb.png'
  ]);
});
