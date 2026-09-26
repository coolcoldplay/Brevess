const test = require('node:test');
const assert = require('node:assert/strict');

const ocr = require('../core/pdf-ocr-text-layer.js');

function span(content, bbox, extra = {}) {
  return { type: 'text', content, bbox, score: 0.98, ...extra };
}

test('extracts final MinerU para-block line spans recursively without page furniture or duplicates', () => {
  const duplicate = span('Ａnalysis', [20, 10, 80, 30]);
  const pages = ocr.extractMineruLayoutTextPages({
    pdf_info: [{
      page_idx: 0,
      page_size: [200, 100],
      preproc_blocks: [{ lines: [{ bbox: [0, 0, 100, 10], spans: [
        span('preprocessor duplicate', [0, 0, 100, 10])
      ] }] }],
      discarded_blocks: [{ lines: [{ bbox: [0, 90, 100, 100], spans: [
        span('discarded footer', [0, 90, 100, 100])
      ] }] }],
      para_blocks: [{
        lines: [{ bbox: [20, 10, 80, 30], spans: [duplicate] }],
        blocks: [{ lines: [{ bbox: [20, 10, 80, 30], spans: [
          duplicate,
          span('x+y', [82, 10, 105, 30], { type: 'inline_equation' })
        ] }] }]
      }]
    }]
  });

  assert.equal(pages.length, 1);
  assert.equal(pages[0].source, 'mineru-layout');
  assert.equal(pages[0].pageNumber, 1);
  assert.deepEqual([pages[0].width, pages[0].height], [200, 100]);
  assert.deepEqual(pages[0].items.map(item => item.str), ['Analysis', 'x+y']);
  assert.deepEqual(pages[0].items.map(item => item.lineIndex), [0, 0]);
  assert.deepEqual(pages[0].items[0].lineBBox, [20, 10, 80, 30]);
  assert.equal(pages[0].items[0].geometryAccuracy, 'bbox-only');
  assert.equal(pages[0].diagnostics.droppedDuplicateItems, 1);
  assert.ok(pages[0].warnings.includes(ocr.MINERU_OCR_BASELINE_WARNING));
});

test('drops invalid line and span bounds, empty content, and duplicate page records', () => {
  const pages = ocr.extractMineruLayoutTextPages({ pdf_info: [
    {
      page_idx: 2, page_size: [200, 100],
      para_blocks: [{ lines: [
        { bbox: [0, 0, 200, 20], spans: [
          span('valid', [5, 2, 30, 18]),
          span('outside', [190, 2, 210, 18]),
          span('', [40, 2, 60, 18])
        ] },
        { bbox: [-1, 20, 100, 40], spans: [span('bad line', [0, 20, 50, 40])] }
      ] }]
    },
    { page_idx: 2, page_size: [200, 100], para_blocks: [] },
    { page_idx: -1, page_size: [200, 100], para_blocks: [] }
  ] });

  assert.deepEqual(pages.map(page => page.pageNumber), [3]);
  assert.deepEqual(pages[0].items.map(item => item.str), ['valid']);
  assert.equal(pages[0].diagnostics.droppedInvalidItems, 3);
});

test('converts top-left MinerU boxes into unrotated PDF user-space text items', () => {
  const [page] = ocr.extractMineruLayoutTextPages({ pdf_info: [{
    page_idx: 0, page_size: [200, 100], para_blocks: [{ lines: [{
      bbox: [20, 10, 105, 30],
      spans: [span('First', [20, 10, 80, 30]), span('Second', [82, 10, 105, 30])]
    }] }]
  }] });
  const content = ocr.mineruPageToPdfTextContent(page, { view: [10, 20, 410, 220] });

  assert.deepEqual(content.items[0], {
    str: 'First', dir: 'ltr', width: 120, height: 40,
    transform: [40, 0, 0, 40, 50, 160],
    fontName: 'mineru-ocr-sans', hasEOL: false
  });
  assert.equal(content.items[1].hasEOL, true);
  assert.equal(content.styles['mineru-ocr-sans'].fontFamily, 'sans-serif');
  assert.equal(content.geometryAccuracy, 'bbox-only-baseline-approximate');
  assert.deepEqual(content.warnings, [
    ocr.MINERU_OCR_BASELINE_WARNING,
    ocr.MINERU_OCR_FONT_WARNING
  ]);
});

test('maps rotated pages through the PDF viewBox before PDF.js applies its viewport transform', () => {
  const page = {
    source: 'mineru-layout', pageNumber: 1, width: 200, height: 100,
    items: [{ str: 'Rotated', bbox: [20, 10, 80, 30], lineIndex: 0 }]
  };
  const view = [10, 20, 410, 220];
  const transforms = [90, 180, 270].map(rotation =>
    ocr.mineruPageToPdfTextContent(page, { view, rotation }).items[0].transform
  );
  assert.deepEqual(transforms, [
    [0, 80, -80, 0, 130, 40],
    [-40, 0, 0, -40, 370, 80],
    [0, -80, 80, 0, 290, 200]
  ]);
});

test('rejects malformed page views and never fabricates text from layout-only blocks', () => {
  const [page] = ocr.extractMineruLayoutTextPages({ pdf_info: [{
    page_idx: 0, page_size: [200, 100],
    para_blocks: [{ bbox: [0, 0, 100, 50], type: 'text' }]
  }] });
  assert.deepEqual(page.items, []);
  assert.throws(() => ocr.mineruPageToPdfTextContent(page, { view: [0, 0, 0, 100] }),
    /INVALID_PDF_PAGE_VIEW/);
  assert.throws(() => ocr.mineruPageToPdfTextContent(page, {
    view: [0, 0, 200, 100], rotation: 45
  }), /INVALID_PDF_PAGE_ROTATION/);
});
