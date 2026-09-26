const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/figure-extractor.js');
const nativeFigures = require('../core/pdf-native-figures.js');

function item(str, x, y, options = {}) {
  return {
    str,
    transform: [1, 0, 0, options.height || 10, x, y],
    width: options.width ?? Math.max(5, str.length * 5),
    height: options.height || 10,
    hasEOL: options.hasEOL === true
  };
}

test('finds conservative Figure captions from PDF.js text items', () => {
  const pages = [{
    pageNumber: 3,
    textContent: { items: [
      item('Results', 50, 740, { hasEOL: true }),
      item('Figure 2.', 50, 180),
      item('Loss of receptor activity changes migration.', 110, 180, { hasEOL: true }),
      item('(A-C) Quantification across three conditions.', 50, 165, { hasEOL: true }),
      item('Values are mean ± s.e.m.', 50, 150, { hasEOL: true }),
      item('', 50, 135, { hasEOL: true })
    ] }
  }];

  const sourceFingerprint = 'a'.repeat(64);
  const figures = nativeFigures.extractNativePdfFigures(pages, { sourceFingerprint });
  assert.equal(figures.length, 1);
  assert.equal(figures[0].figureId, 'figure-2');
  assert.equal(figures[0].figureLabel, 'Figure 2');
  assert.deepEqual(figures[0].panelHints, ['A', 'B', 'C']);
  assert.equal(figures[0].sourceKind, 'pdf-page-caption');
  assert.equal(figures[0].imageEvidence, 'full-page');
  assert.equal(figures[0].pageNumber, 3);
  assert.deepEqual(figures[0].pageNumbers, [3]);
  assert.deepEqual(figures[0].captionPageNumbers, [3]);
  assert.deepEqual(figures[0].artworkPageNumbers, [3]);
  assert.equal(figures[0].artworkPageEvidence, 'caption-anchor-page');
  assert.equal(figures[0].artworkCoverage, 'partial');
  assert.deepEqual(figures[0].imageElements, []);
  assert.deepEqual(figures[0].analysisImages, []);
  assert.equal(figures[0].sourceFingerprint, sourceFingerprint);
  assert.equal(figures[0].captionComplete, true);
});

test('caption stops before larger body text after a geometric gap, preserving wrapped caption lines', () => {
  const lines = [
    item('Figure 1. SEM images at different magnifications:', 50, 620, { height: 9, hasEOL: true }),
    item('(a-g) 250x and (h-n) 15K.', 50, 610, { height: 9, hasEOL: true }),
    item('milling processes led to disruption of internal bonds', 50, 583, { height: 10, hasEOL: true }),
    item('and modified the structure.', 50, 572, { height: 10, hasEOL: true })
  ];
  const [figure] = nativeFigures.extractNativePdfFigures([{ pageNumber: 6, textContent: { items: lines } }]);
  assert.equal(figure.caption, 'Figure 1. SEM images at different magnifications: (a-g) 250x and (h-n) 15K.');
  assert.equal(figure.captionComplete, true);
  assert.equal(figure.caption.includes('milling'), false);
  assert.equal(figure.artworkCoverage, 'partial');
});

test('PDF stream placing page furniture after the caption does not append that furniture', () => {
  const [figure] = nativeFigures.extractNativePdfFigures([{ pageNumber: 6, textContent: { items: [
    item('Figure 1. SEM images show measured particle structures.', 50, 610, { height: 9, hasEOL: true }),
    item('6 Indoor Air', 50, 748, { height: 10, hasEOL: true })
  ] } }]);
  assert.equal(figure.caption, 'Figure 1. SEM images show measured particle structures.');
  assert.equal(figure.captionComplete, true);
});

test('uniform caption typography retains multiple sentences and panel descriptions', () => {
  const [figure] = nativeFigures.extractNativePdfFigures([{ pageNumber: 1, textContent: { items: [
    item('Figure 1. First experimental measurement.', 50, 620, { height: 9, hasEOL: true }),
    item('(B) A second measurement.', 50, 590, { height: 9, hasEOL: true })
  ] } }]);
  assert.match(figure.caption, /second measurement\./u);
  assert.equal(figure.captionComplete, true);
});

test('recognizes supplemental and Extended Data caption identities', () => {
  const figures = nativeFigures.extractNativePdfFigures([
    { pageNumber: 8, text: 'Figure S3 | Perturbation controls.\nPanels A and B show independent replicates.\n' },
    { pageNumber: 9, text: 'Extended Data Figure 4. Validation in a second cohort.\n(A-D) Independent measurements.\n' }
  ]);
  assert.deepEqual(figures.map(figure => ({
    id: figure.figureId,
    series: figure.figureSeries,
    supplemental: figure.isSupplemental
  })), [
    { id: 'figure-s3', series: 'supplemental', supplemental: true },
    { id: 'figure-ed4', series: 'extended-data', supplemental: true }
  ]);
  assert.deepEqual(figures[1].panelHints, ['A', 'B', 'C', 'D']);
});

test('joins an explicitly open caption across consecutive pages and marks review', () => {
  const figures = nativeFigures.extractNativePdfFigures([
    {
      pageNumber: 4,
      text: 'Figure 1. Experimental workflow and sampling across\nthree tissues under matched conditions'
    },
    {
      pageNumber: 5,
      text: 'with longitudinal measurements in each cohort.\nResults\nThe intervention changed the primary endpoint.'
    }
  ]);
  assert.equal(figures.length, 1);
  assert.deepEqual(figures[0].pageNumbers, [4, 5]);
  assert.deepEqual(figures[0].captionPageNumbers, [4, 5]);
  assert.deepEqual(figures[0].artworkPageNumbers, [4],
    'a caption continuation page is not artwork evidence');
  assert.equal(figures[0].artworkPageEvidence, 'caption-anchor-page');
  assert.equal(figures[0].artworkCoverage, 'partial',
    'caption continuation alone cannot prove complete artwork coverage');
  assert.match(figures[0].caption, /longitudinal measurements/);
  assert.equal(figures[0].needsReview, true);
  assert.ok(figures[0].reviewReasons.includes('cross-page-caption'));
  assert.equal(figures[0].captionComplete, true);
});

function continuedCaptionPages() {
  return [
    { pageNumber: 1, text: 'Figure 2. Measurements across the experimental cohorts.\n' +
      '(A) Initial measurements under matched conditions.\nFigure 2 continued on next page' },
    { pageNumber: 2, text: 'Figure 2. Continued\n' +
      '(B) Intermediate measurements in the second cohort.\nFigure 2 continued on next page' },
    { pageNumber: 3, text: 'Fig. 2 (continued)\n' +
      '(C) Final measurements confirm the observed response.\nResults\nUnrelated body text.' }
  ];
}

test('collects all three consecutive caption pages without including continuation markers', () => {
  const [figure] = nativeFigures.extractNativePdfFigures(continuedCaptionPages());
  assert.deepEqual(figure.pageNumbers, [1, 2, 3]);
  assert.deepEqual(figure.captionSegments, [
    { pageNumber: 1, text: 'Figure 2. Measurements across the experimental cohorts. ' +
      '(A) Initial measurements under matched conditions.' },
    { pageNumber: 2, text: '(B) Intermediate measurements in the second cohort.' },
    { pageNumber: 3, text: '(C) Final measurements confirm the observed response.' }
  ]);
  assert.equal(figure.caption, figure.captionSegments.map(part => part.text).join(' '));
  assert.equal(figure.captionComplete, true);
  assert.deepEqual(figure.panelHints, ['A', 'B', 'C']);
  assert.doesNotMatch(figure.caption, /continued|Unrelated body text/iu);
  assert.equal(figure.reviewReasons.includes('missing-caption-continuation'), false);
});

test('an outgoing-only second page cannot become an incoming caption or absorb body text', () => {
  const [figure] = nativeFigures.extractNativePdfFigures([
    { pageNumber: 1, text: 'Figure 2. Initial measurements across all cohorts.\n' +
      'Figure 2 continued on next page' },
    { pageNumber: 2, text: 'Second-page measurements omitted from context.\n' +
      'Figure 2 continued on next page\nUnrelated body text.' },
    { pageNumber: 3, text: 'Figure 2 continued\nThird-page control measurements.\nResults' }
  ]);
  assert.equal(figure.caption, 'Figure 2. Initial measurements across all cohorts.');
  assert.deepEqual(figure.pageNumbers, [1]);
  assert.deepEqual(figure.captionSegments, [{ pageNumber: 1, text: figure.caption }]);
  assert.equal(figure.captionComplete, false);
  assert.ok(figure.reviewReasons.includes('missing-caption-continuation'));
});

test('an incoming marker inside a caption does not request another page', () => {
  const [figure] = nativeFigures.extractNativePdfFigures([
    { pageNumber: 1, text: 'Figure 2. Initial measurements across all cohorts.\n' +
      'Figure 2 continued on next page' },
    { pageNumber: 2, text: 'Figure 2 continued\nFinal matched control measurements.\n' +
      'Figure 2 continued\nUnrelated body text.' },
    { pageNumber: 3, text: 'Figure 2 continued\nUnrelated third-page measurements.\nResults' }
  ]);
  assert.equal(figure.caption, 'Figure 2. Initial measurements across all cohorts. ' +
    'Final matched control measurements.');
  assert.deepEqual(figure.pageNumbers, [1, 2]);
  assert.equal(figure.captionComplete, true);
  assert.doesNotMatch(figure.caption, /Unrelated|continued/iu);
});

for (const marker of ['Figure 2 continued on next page', 'Fig. 2 (continued on the next page)']) {
  test(`rejects a top-of-page outgoing marker as an incoming caption: ${marker}`, () => {
    const [figure] = nativeFigures.extractNativePdfFigures([
      continuedCaptionPages()[0],
      { pageNumber: 2, text: `${marker}\nUnrelated body text after an outgoing marker.` }
    ]);
    assert.deepEqual(figure.pageNumbers, [1]);
    assert.equal(figure.captionComplete, false);
    assert.ok(figure.reviewReasons.includes('missing-caption-continuation'));
    assert.doesNotMatch(figure.caption, /Unrelated|continued/iu);
  });
}

test('uses the top continuation marker when PDF extraction lists the outgoing marker first', () => {
  const pages = [
    { pageNumber: 1, textContent: { items: [
      item('Figure 2. Measurements across matched cohorts.', 50, 200, { hasEOL: true }),
      item('Figure 2 continued on next page', 50, 180, { hasEOL: true })
    ] } },
    { pageNumber: 2, textContent: { items: [
      item('Figure 2 continued on next page', 50, 100, { hasEOL: true }),
      item('(B) Second-page measurements under matched conditions.', 50, 700, { hasEOL: true }),
      item('Unrelated second-column text.', 330, 690, { hasEOL: true }),
      item('Figure 2 continued', 50, 720, { hasEOL: true })
    ] } },
    { pageNumber: 3, textContent: { items: [
      item('Figure 2 continued', 50, 720, { hasEOL: true }),
      item('(C) Final measurements confirm the response.', 50, 700, { hasEOL: true })
    ] } }
  ];
  const [figure] = nativeFigures.extractNativePdfFigures(pages);
  assert.deepEqual(figure.pageNumbers, [1, 2, 3]);
  assert.equal(figure.captionComplete, true);
  assert.equal(figure.captionSegments[1].text, '(B) Second-page measurements under matched conditions.');
  assert.doesNotMatch(figure.caption, /continued|Unrelated/iu);
});

for (const missingPage of [2, 3]) {
  test(`marks a caption incomplete when required continuation page ${missingPage} is absent`, () => {
    const [figure] = nativeFigures.extractNativePdfFigures(
      continuedCaptionPages().filter(page => page.pageNumber !== missingPage));
    assert.deepEqual(figure.pageNumbers, missingPage === 2 ? [1] : [1, 2]);
    assert.equal(figure.captionComplete, false);
    assert.equal(figure.needsReview, true);
    assert.ok(figure.reviewReasons.includes('missing-caption-continuation'));
    assert.doesNotMatch(figure.caption, /continued/iu);
    assert.equal(figure.caption, figure.captionSegments.map(part => part.text).join(' '));
  });
}

for (const nextPageText of [
  'Figure 2 continued\nResults\nUnrelated body text.',
  'Figure 2 continued\n',
  'Figure 20 continued\nUnrelated figure measurements.',
  'Figure S2 continued\nUnrelated supplement measurements.',
  'Supplementary Figure 2 continued\nUnrelated supplement measurements.',
  'Extended Data Figure 2 continued\nUnrelated extended measurements.'
]) {
  test(`rejects an empty or mismatched continuation: ${nextPageText.split('\n')[0]}`, () => {
    const [figure] = nativeFigures.extractNativePdfFigures([
      continuedCaptionPages()[0], { pageNumber: 2, text: nextPageText }
    ]);
    assert.deepEqual(figure.pageNumbers, [1]);
    assert.equal(figure.captionComplete, false);
    assert.ok(figure.reviewReasons.includes('missing-caption-continuation'));
    assert.doesNotMatch(figure.caption, /continued|Unrelated/iu);
  });
}

test('line and character limits explicitly mark incomplete captions and keep segment text aligned', () => {
  const lineLimited = nativeFigures.extractNativePdfFigures([
    { pageNumber: 1, text: ['Figure 2. Measurements across matched cohorts.',
      ...Array.from({ length: 78 }, () => 'Additional measured response.'),
      'Figure 2 continued on next page'].join('\n') },
    { pageNumber: 2, text: 'Figure 2 continued\nFirst remaining response.\nSecond remaining response.' }
  ])[0];
  const characterLimited = nativeFigures.extractNativePdfFigures([
    { pageNumber: 1, text: 'Figure 3. ' + 'Measured response. '.repeat(800) }
  ])[0];
  for (const figure of [lineLimited, characterLimited]) {
    assert.equal(figure.captionComplete, false);
    assert.ok(figure.reviewReasons.includes('caption-truncated'));
    assert.ok(figure.caption.length <= 12000);
    assert.equal(figure.caption, figure.captionSegments.map(part => part.text).join(' '));
  }
});

test('deduplicates a repeated same-Figure caption without concatenating divergent text', () => {
  const figures = nativeFigures.extractNativePdfFigures([
    { pageNumber: 2, text: 'Figure 1. Overview of the experimental workflow.\n' },
    { pageNumber: 12, text: 'Figure 1. Alternate proof copy caption for production review.\n' }
  ]);
  assert.equal(figures.length, 1);
  assert.deepEqual(figures[0].pageNumbers, [12]);
  assert.equal(figures[0].pageNumber, 12);
  assert.equal(figures[0].duplicateCaptionCount, 2);
  assert.ok(figures[0].reviewReasons.includes('divergent-duplicate-caption'));
  assert.equal(figures[0].caption.includes('Overview') &&
    figures[0].caption.includes('Alternate proof'), false);
});

test('PDF lower-case panel i is retained while plural suffixes and time units are excluded', () => {
  const [figure] = nativeFigures.extractNativePdfFigures([{pageNumber: 1, text:
    'Figure 1. Sampling design. (h) Control. (i) Treatment. (j, k) Quantification. Time (s). Error bar(s) show SEM.\n'
  }]);
  assert.deepEqual(figure.panelHints, ['H', 'I', 'J', 'K']);
});

test('rejects inline Figure references, contents entries, and bibliography entries', () => {
  const figures = nativeFigures.extractNativePdfFigures([{
    pageNumber: 1,
    text: [
      'Figure 1 shows the study design used for all cohorts.',
      'Figure 2 ........ 17',
      'Fig. 5 and Extended Data Fig. 2 were analyzed together.',
      '[32] Figure 3 in Smith et al. reported a similar result.',
      'As described in Fig. 4, the endpoint was unchanged.'
    ].join('\n')
  }]);
  assert.deepEqual(figures, []);
});

test('does not invent a Figure or Panels without an explicit caption header', () => {
  const figures = nativeFigures.extractNativePdfFigures([{
    pageNumber: 6,
    text: 'A and B denote the two treatment groups.\nThe image summarizes the assay.\n'
  }]);
  assert.deepEqual(figures, []);
});

test('normalizes precise manifest entries and preserves supplied whole-Figure images', () => {
  const imageElement = { nodeType: 1, src: 'blob:whole-figure' };
  const inventory = nativeFigures.normalizePdfManifestInventory({
    documentFingerprint: 'a'.repeat(64),
    figures: [{
      figureId: 'figure-3',
      figureLabel: 'Figure 3',
      figureNumber: 3,
      pageIndex: 6,
      captionPageNumbers: [7, 8],
      artworkPageNumbers: [7, 8],
      artworkCoverage: 'complete',
      caption: 'Figure 3. Rescue restores the measured phenotype.',
      panelHints: ['A', 'B'],
      image: { workspacePath: 'pdf/figures/main/figure-3.png', sha256: 'b'.repeat(64) }
    }]
  }, new Map([['figure-3', imageElement]]));

  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].sourceKind, 'pdf-figure-manifest');
  assert.equal(inventory[0].imageEvidence, 'whole-figure');
  assert.equal(inventory[0].pageNumber, 7);
  assert.deepEqual(inventory[0].pageNumbers, [7, 8]);
  assert.deepEqual(inventory[0].captionPageNumbers, [7, 8]);
  assert.deepEqual(inventory[0].artworkPageNumbers, [7, 8]);
  assert.equal(inventory[0].artworkPageEvidence, 'manifest');
  assert.equal(inventory[0].artworkCoverage, 'complete');
  assert.deepEqual(inventory[0].imageElements, [imageElement]);
  assert.equal(inventory[0].imageAssetPath, 'pdf/figures/main/figure-3.png');
  assert.equal(inventory[0].sourceFingerprint, 'a'.repeat(64));
  assert.equal(inventory[0].needsReview, false);
});

test('manifest coverage needs both explicit artwork pages and an explicit complete claim', () => {
  for (const scope of [{}, { artworkCoverage: 'complete' }, { artworkPageNumbers: [7] }]) {
    const [figure] = nativeFigures.normalizePdfManifestInventory({
      documentFingerprint: 'a'.repeat(64), figures: [{
        figureId: 'figure-3', figureLabel: 'Figure 3', figureNumber: 3, pageIndex: 6,
        caption: 'Figure 3. Measurements of the experimental response.', ...scope
      }]
    });
    assert.equal(figure.artworkCoverage, 'partial');
  }
});
