const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseFigureSrcset,
  springerNatureFullImageSource,
  wikimediaOriginalImageSource,
  iiifOriginalImageSource,
  wordpressOriginalImageSource,
  cellPressLargeImageSource,
  unscaledQueryImageSource,
  collectFigureImageCandidates,
  extractFigureImageCandidatesFromHtml,
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

test('promotes Springer Nature preview images to their full-resolution resource', () => {
  const preview = [
    'https://media.springernature.com/m685/springer-static/image/',
    'art%3A10.1038%2Fs41593-020-00789-y/MediaObjects/',
    '41593_2020_789_Fig1_HTML.png'
  ].join('');
  const full = preview.replace('/m685/', '/full/');
  const figurePage = 'https://www.nature.com/articles/s41593-020-00789-y/figures/1';
  const image = fakeImage({ src: preview }, preview, figurePage);

  assert.equal(springerNatureFullImageSource(preview), full);
  assert.deepEqual(
    collectFigureImageCandidates(image, 'https://www.nature.com/articles/test')
      .slice(0, 3),
    [full, figurePage, preview]
  );
});

test('promotes Springer Nature Extended Data ESM previews to full resolution', () => {
  const preview = [
    'https://media.springernature.com/lw685/springer-static/esm/',
    'art%3A10.1038%2Fs41586-026-10907-8/MediaObjects/',
    '41586_2026_10907_Fig6_ESM.jpg'
  ].join('');
  const full = preview.replace('/lw685/', '/full/');
  const figurePage = 'https://www.nature.com/articles/s41586-026-10907-8/figures/6';
  const image = fakeImage({ 'data-supp-info-image': preview }, '', figurePage);

  assert.equal(springerNatureFullImageSource(preview), full);
  assert.deepEqual(
    collectFigureImageCandidates(image, 'https://www.nature.com/articles/test')
      .slice(0, 3),
    [full, preview, figurePage]
  );
});

test('derives reliable unscaled variants used by common publisher CDNs', () => {
  assert.equal(
    wikimediaOriginalImageSource(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Figure.png/800px-Figure.png'
    ),
    'https://upload.wikimedia.org/wikipedia/commons/a/a1/Figure.png'
  );
  assert.equal(
    wordpressOriginalImageSource('https://journal.example/wp-content/Figure-768x512.png'),
    'https://journal.example/wp-content/Figure.png'
  );
  assert.equal(
    iiifOriginalImageSource('https://images.example/iiif/2/item/full/600,/0/default.jpg'),
    'https://images.example/iiif/2/item/full/full/0/default.jpg'
  );
  assert.equal(
    unscaledQueryImageSource('https://cdn.example/figure.png?width=600&token=signed'),
    'https://cdn.example/figure.png?token=signed'
  );
});

test('binds Cell CMS Figure numbers to the canonical article PII and prefers official large images', () => {
  const article = 'https://www.cell.com/cell/fulltext/S0092-8674(26)00103-0';
  const figure1 = [
    'https://www.cell.com/cms/10.1016/j.cell.2026.01.016/asset/',
    'c66fef4f-fb95-4262-b275-ee1d9c623728/main.assets/gr1.jpg'
  ].join('');
  const figure2 = [
    'https://www.cell.com/cms/10.1016/j.cell.2026.01.016/asset/',
    '255eb2de-7616-4e0a-92e0-737b64134d6a/main.assets/gr2.jpg'
  ].join('');

  assert.equal(cellPressLargeImageSource(figure1, article),
    'https://ars.els-cdn.com/content/image/1-s2.0-S0092867426001030-gr1_lrg.jpg');
  assert.equal(cellPressLargeImageSource(figure2, article),
    'https://ars.els-cdn.com/content/image/1-s2.0-S0092867426001030-gr2_lrg.jpg');
  assert.deepEqual(collectFigureImageCandidates(
    fakeImage({ src: figure1 }, figure1), article
  ).slice(0, 2), [
    'https://ars.els-cdn.com/content/image/1-s2.0-S0092867426001030-gr1_lrg.jpg',
    figure1
  ]);
});

test('promotes the actual Elsevier dash-gr CDN suffix and never invents Cell PII without a binding', () => {
  const direct = 'https://ars.els-cdn.com/content/image/1-s2.0-S0092867426001030-gr1.jpg';
  assert.equal(cellPressLargeImageSource(direct),
    'https://ars.els-cdn.com/content/image/1-s2.0-S0092867426001030-gr1_lrg.jpg');

  const cms = [
    'https://www.cell.com/cms/10.1016/j.cell.2026.01.016/asset/',
    'c66fef4f-fb95-4262-b275-ee1d9c623728/main.assets/gr1.jpg'
  ].join('');
  assert.equal(cellPressLargeImageSource(cms, 'https://www.cell.com/cell/fulltext/not-a-pii'), '');
  assert.equal(cellPressLargeImageSource(cms,
    'https://www.cell.com/cell/abstract/S0092-8674(26)00103-0'), '');
  assert.equal(cellPressLargeImageSource(cms,
    'https://www.cell.com/neuron/fulltext/S0092-8674(26)00103-0'), '');
  assert.equal(cellPressLargeImageSource(
    cms.replace('www.cell.com', 'cell.com.example'),
    'https://www.cell.com/cell/fulltext/S0092-8674(26)00103-0'
  ), '');
});

test('extracts original-image metadata and relative srcsets from HTML viewer pages', () => {
  const html = `
    <meta property="og:image" content="/media/figure-og.jpg?width=700">
    <meta name="description" content="not an image">
    <picture>
      <source srcset="/media/figure-1600.webp 1600w, /media/figure-600.webp 600w">
      <img data-original="/media/figure-original.png" src="/media/preview.png">
    </picture>
  `;
  const candidates = extractFigureImageCandidatesFromHtml(
    html,
    'https://publisher.example/article/figures/1'
  );
  assert.equal(candidates[0], 'https://publisher.example/media/figure-original.png');
  assert.ok(candidates.includes('https://publisher.example/media/figure-1600.webp'));
  assert.ok(candidates.includes('https://publisher.example/media/figure-og.jpg'));
  assert.ok(!candidates.some(candidate => candidate.endsWith('/not%20an%20image')));
});

test('selects the first safe source across Figure images', () => {
  const figure = { imageElements: [fakeImage({}, '', ''), fakeImage({
    'data-hires': '/figures/figure-s2.webp'
  })] };
  assert.equal(selectFigureImageSource(figure, 'https://paper.example/article'),
    'https://paper.example/figures/figure-s2.webp');
});

test('uses the native Nature supplementary image attribute as a Figure source', () => {
  const figure = { imageElements: [fakeImage({
    'data-supp-info-image': '//media.springernature.com/full/Fig6_ESM.jpg'
  })] };

  assert.equal(
    selectFigureImageSource(figure, 'https://www.nature.com/articles/test'),
    'https://media.springernature.com/full/Fig6_ESM.jpg'
  );
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
