const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_FIXTURE = path.join(
  REPO_ROOT,
  'tmp',
  'public-pdf-acceptance',
  'elife-83176-v2.pdf'
);
const PDF_PATH = process.env.BREVESS_PUBLIC_PDF_FIXTURE || DEFAULT_FIXTURE;
const EXPECTED_SHA256 = '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1';

require('../core/figure-extractor.js');
const { extractNativePdfFigures } = require('../core/pdf-native-figures.js');

function pdfItem(str, x, y, hasEOL = true) {
  return {
    str,
    transform: [1, 0, 0, 10, x, y],
    width: Math.max(5, str.length * 5),
    height: 10,
    hasEOL
  };
}

async function loadPublicPdfPages(pdfPath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const document = await loadingTask.promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      pages.push({ pageNumber, textContent: await page.getTextContent() });
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
  return pages;
}

test('public eLife PDF native Figure inventory keeps true page scope and panels', {
  skip: !fs.existsSync(PDF_PATH) && `public fixture is absent: ${PDF_PATH}`
}, async () => {
  const bytes = fs.readFileSync(PDF_PATH);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256, EXPECTED_SHA256, 'fixture must be the reviewed public PDF revision');

  const pages = await loadPublicPdfPages(PDF_PATH);
  assert.equal(pages.length, 23);

  const figures = extractNativePdfFigures({ pages, documentHash: sha256 });
  const actual = figures.map(figure => ({
    figureId: figure.figureId,
    sourceKind: figure.sourceKind,
    imageEvidence: figure.imageEvidence,
    sourceFingerprint: figure.sourceFingerprint,
    pageNumbers: figure.pageNumbers,
    captionPageNumbers: figure.captionPageNumbers,
    artworkPageNumbers: figure.artworkPageNumbers,
    artworkCoverage: figure.artworkCoverage,
    panelHints: figure.panelHints
  }));
  const expectations = [
    {
      figureId: 'figure-1', sourceKind: 'pdf-page-caption', imageEvidence: 'full-page',
      // The image has panels A-D, but A is bitmap-only and the legend starts without an (a).
      // A caption-only inventory must keep the evidenced B-D lower bound rather than invent A.
      sourceFingerprint: sha256, pageNumbers: [4], captionPageNumbers: [4],
      artworkPageNumbers: [4], artworkCoverage: 'partial', panelHints: ['B', 'C', 'D']
    },
    {
      figureId: 'figure-2', sourceKind: 'pdf-page-caption', imageEvidence: 'full-page',
      sourceFingerprint: sha256,
      pageNumbers: [5], captionPageNumbers: [5], artworkPageNumbers: [5],
      artworkCoverage: 'partial',
      panelHints: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']
    },
    {
      figureId: 'figure-3', sourceKind: 'pdf-page-caption', imageEvidence: 'full-page',
      sourceFingerprint: sha256, pageNumbers: [7], captionPageNumbers: [7],
      artworkPageNumbers: [7], artworkCoverage: 'partial',
      panelHints: ['A', 'B', 'C', 'D', 'E', 'F']
    },
    {
      figureId: 'figure-4', sourceKind: 'pdf-page-caption', imageEvidence: 'full-page',
      sourceFingerprint: sha256,
      pageNumbers: [8, 9],
      captionPageNumbers: [8, 9], artworkPageNumbers: [8], artworkCoverage: 'partial',
      panelHints: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']
    }
  ];
  assert.deepEqual(actual, expectations);

  for (const figure of figures) {
    assert.equal(figure.captionComplete, true, `${figure.figureId} caption must be complete`);
    assert.equal(figure.caption, figure.captionSegments.map(part => part.text).join(' '));
    assert.doesNotMatch(
      figure.caption,
      /\bthe online version\b|\bfigure supplements?\b|\bvideo\b|https?:\/\/|doi\.org|\beLife\s+\d{4}\b/iu,
      `${figure.figureId} caption must stop before online supplements and page footer material`
    );
  }
  assert.match(
    figures.find(figure => figure.figureId === 'figure-4').caption,
    /\bError bars\b/u,
    'Figure 4 must retain the legend continuation at the end of page 9'
  );
});

test('continued caption does not absorb a different PDF column below its marker', () => {
  const [figure] = extractNativePdfFigures([
    {
      pageNumber: 1,
      textContent: { items: [
        pdfItem('Figure 1. Assay measurements across matched conditions', 50, 200),
        pdfItem('Figure 1 (continued on next page)', 50, 180)
      ] }
    },
    {
      pageNumber: 2,
      textContent: { items: [
        pdfItem('Figure 1 (continued)', 50, 720),
        pdfItem('(a) Left-column caption continuation.', 50, 700),
        pdfItem('Unrelated right-column body prose.', 330, 690),
        pdfItem('(b) Error bars show the interval.', 50, 680),
        pdfItem('More unrelated right-column body prose.', 330, 670)
      ] }
    }
  ]);

  assert.deepEqual(figure.pageNumbers, [1, 2]);
  assert.deepEqual(figure.panelHints, ['A', 'B']);
  assert.doesNotMatch(figure.caption, /right-column body prose/u);
});

test('measurement units in parentheses are not promoted to PDF panel labels', () => {
  const [figure] = extractNativePdfFigures([{
    pageNumber: 3,
    text: 'Figure 2. Voltage (V), current (A), distance (m), and power (W) were recorded.\n'
  }]);
  assert.deepEqual(figure.panelHints, []);
});
