const test = require('node:test');
const assert = require('node:assert/strict');

const pdf = require('../core/pdf-workspace.js');
const engine = require('../core/pdf-figure-engine.js');

test('legacy whole-Figure manifests are marked for native-only cache upgrade', () => {
  assert.equal(engine.PDF_FIGURE_SCHEMA_VERSION, 3);
  assert.equal(engine.PDF_FIGURE_PIPELINE_VERSION, '0.2.0-cross-page');
  assert.equal(engine.pdfFigureManifestNeedsRefresh(null), true);
  assert.equal(engine.pdfFigureManifestNeedsRefresh({
    schemaVersion: 2,
    extractorVersion: '0.1.0'
  }), true);
  assert.equal(engine.pdfFigureManifestNeedsRefresh({
    schemaVersion: 3,
    extractorVersion: '0.2.0-cross-page'
  }), false);
});

test('normalizes native PDFFigures2 Figure JSON without splitting subfigures', () => {
  const figure = engine.normalizePdffigures2Figure({
    figType: 'Figure',
    name: '2',
    page: 4,
    caption: 'Figure 2. Whole multi-panel experiment.',
    regionBoundary: { x1: 72, y1: 140, x2: 540, y2: 462 },
    captionBoundary: { x1: 72, y1: 470, x2: 540, y2: 526 },
    imageFile: 'paper-Figure2-1.png'
  }, {
    documentFingerprint: 'a'.repeat(64),
    image: {
      mimeType: 'image/png',
      width: 1950,
      height: 1342,
      sha256: 'b'.repeat(64),
      workspacePath: 'pdf/figures/main/figure-2.png'
    }
  });

  assert.equal(figure.figureLabel, 'Figure 2');
  assert.equal(figure.figureNumber, '2');
  assert.equal(figure.pageIndex, 4);
  assert.deepEqual(figure.figureBox, {
    x: 72, y: 140, width: 468, height: 322
  });
  assert.deepEqual(figure.captionBox, {
    x: 72, y: 470, width: 468, height: 56
  });
  assert.equal(figure.image.width, 1950);
  assert.match(figure.figureId, /^pdf-main-figure-2-/);
  assert.equal(figure.source, 'pdffigures2');
});

test('rejects PDFFigures2 tables from the Figure inventory', () => {
  assert.equal(engine.normalizePdffigures2Figure({
    figType: 'Table',
    name: '1',
    page: 0,
    caption: 'Table 1. Cohort details.',
    regionBoundary: { x1: 1, y1: 2, x2: 100, y2: 80 }
  }), null);
});

test('supplemental PDF labels preserve S numbers and assign missing labels in page order', () => {
  const figures = engine.normalizePdffigures2Figures([
    {
      figType: 'Figure', name: '', page: 3,
      caption: 'Additional validation in the second experiment.',
      regionBoundary: { x1: 40, y1: 350, x2: 500, y2: 650 }
    },
    {
      figType: 'Figure', name: 'S4', page: 1,
      caption: 'Figure S4. Direct validation.',
      regionBoundary: { x1: 40, y1: 100, x2: 500, y2: 300 }
    },
    {
      figType: 'Figure', name: '', page: 2,
      caption: 'Additional validation in the first experiment.',
      regionBoundary: { x1: 40, y1: 90, x2: 500, y2: 300 }
    }
  ], {
    kind: 'supplemental',
    documentFingerprint: 'c'.repeat(64)
  });

  assert.deepEqual(
    figures.map(figure => figure.figureLabel),
    ['Figure S4', 'Figure S5', 'Figure S6']
  );
  assert.deepEqual(figures.map(figure => figure.pageIndex), [1, 2, 3]);
});

test('OCR-spaced Figure captions are recognized and matched to native whole figures', () => {
  const blocks = [
    { type: 'heading', level: 2, text: 'Results' },
    { type: 'paragraph', text: 'The circuit response was quantified.' },
    { type: 'paragraph', text: 'Fi g 3. FUSIN outcome and validation across panels A–H.' },
    { type: 'paragraph', text: 'The next result followed.' }
  ];
  const figures = engine.normalizePdffigures2Figures([{
    figType: 'Figure', name: '3', page: 5,
    caption: 'Figure 3. FUSIN outcome and validation across panels A–H.',
    regionBoundary: { x1: 72, y1: 120, x2: 540, y2: 500 }
  }], { documentFingerprint: 'd'.repeat(64) });
  const plan = engine.buildPdfFigureArticlePlan(blocks, figures);

  assert.equal(plan.figures[0].anchorIndex, 2);
  assert.equal(plan.figures[0].placement, 'caption');
  assert.deepEqual([...plan.consumedCaptionIndices], [2]);
});

test('PDFFigures2 captions replace MinerU caption headings and adjacent Panel legend blocks', () => {
  const blocks = [
    { type: 'heading', level: 2, text: 'Results' },
    { type: 'heading', level: 4, text: 'Figure 1. MinerU caption title.' },
    { type: 'paragraph', text: '(A) Experimental workflow. (B-D) Quantification.' },
    { type: 'list', items: [
      { text: '(E) Replication cohort.' },
      { text: '(F-G) Safety controls.' }
    ] },
    { type: 'paragraph', text: 'The body result remains visible.' }
  ];
  const figures = engine.normalizePdffigures2Figures([{
    figType: 'Figure', name: '1', page: 0,
    caption: 'Figure 1. Complete caption from PDFFigures2.',
    regionBoundary: { x1: 72, y1: 120, x2: 540, y2: 500 }
  }], { documentFingerprint: '9'.repeat(64) });
  const plan = engine.buildPdfFigureArticlePlan(blocks, figures);

  assert.deepEqual([...plan.consumedCaptionIndices], [1, 2, 3]);
  assert.equal(plan.consumedCaptionIndices.has(4), false);
});

test('native Figure article plan consumes adjacent statistical tails through the shared classifier', () => {
  const blocks = pdf.markdownToPdfBlocks([
    'Figure 7. OFC D1+ and D2+ neurons drive distinct effects.', '',
    '(A) Design. (B-D) Behavior.', '',
    '\\*p < 0.01; ANOVA for (G-I).', '',
    'VTA-nucleus accumbens circuits remain ordinary body text.'
  ].join('\n'));
  const figures = engine.normalizePdffigures2Figures([{
    figType: 'Figure', name: '7', page: 11,
    caption: 'Figure 7. OFC D1+ and D2+ neurons drive distinct effects.',
    regionBoundary: { x1: 10, y1: 20, x2: 300, y2: 400 }
  }]);
  const plan = engine.buildPdfFigureArticlePlan(blocks, figures, {
    isCaptionContinuationText: pdf.isPdfCaptionContinuationText
  });
  const statisticalIndex = plan.blocks.findIndex(block => /ANOVA/.test(block.text || ''));
  const bodyIndex = plan.blocks.findIndex(block => /^VTA-nucleus/.test(block.text || ''));

  assert.match(plan.figures[0].caption, /ANOVA/);
  assert.equal(plan.consumedCaptionIndices.has(statisticalIndex), true);
  assert.equal(plan.consumedCaptionIndices.has(bodyIndex), false);
});

test('author affiliation superscripts are never mistaken for Figure caption anchors', () => {
  const blocks = [
    { type: 'heading', level: 1, text: 'A paper title' },
    { type: 'paragraph', text: '¹ Department of Neuroscience' },
    { type: 'paragraph', text: '⁴ Modern Research Center' },
    { type: 'heading', level: 2, text: 'Results' },
    { type: 'paragraph', text: 'Figure 1. Real first caption.' },
    { type: 'paragraph', text: 'Figure 4. Real fourth caption.' }
  ];
  const figures = engine.normalizePdffigures2Figures([
    {
      figType: 'Figure', name: '1', page: 2,
      caption: 'Figure 1. Real first caption.',
      regionBoundary: { x1: 10, y1: 20, x2: 300, y2: 400 }
    },
    {
      figType: 'Figure', name: '4', page: 8,
      caption: 'Figure 4. Real fourth caption.',
      regionBoundary: { x1: 10, y1: 20, x2: 300, y2: 400 }
    }
  ]);
  const plan = engine.buildPdfFigureArticlePlan(blocks, figures);
  assert.deepEqual(plan.figures.map(item => item.anchorIndex), [4, 5]);
});

test('the richer cross-page caption is retained so all Panel hints remain available', () => {
  const blocks = [
    { type: 'paragraph', text: 'Figure 2. Experiment overview.' },
    { type: 'paragraph', text: '(A-C) Setup and validation.' },
    { type: 'paragraph', text: '(D-O) Behavioral and mechanistic readouts.' }
  ];
  const figures = engine.normalizePdffigures2Figures([{
    figType: 'Figure', name: '2', page: 4,
    caption: 'Figure 2. Experiment overview.',
    regionBoundary: { x1: 10, y1: 20, x2: 300, y2: 400 }
  }]);
  const plan = engine.buildPdfFigureArticlePlan(blocks, figures);
  assert.match(plan.figures[0].caption, /\(D-O\)/);
  assert.deepEqual([...plan.consumedCaptionIndices], [0, 1, 2]);
});

test('MinerU split-column legends recover a leading-label caption and later Panel continuation', () => {
  const blocks = [
    { type: 'paragraph', text: 'H Fig. 6 | Systemic signaling. A First readout. B Second readout. C Third readout. D Fourth readout.' },
    { type: 'paragraph', text: 'Interleaved article body from the other PDF column.' },
    { type: 'paragraph', text: 'comparisons versus controls. E Fifth readout. F Sixth readout. G Seventh readout. H Eighth readout.' },
    { type: 'paragraph', text: 'The next body paragraph remains visible.' }
  ];
  const figures = engine.normalizePdffigures2Figures([{
    figType: 'Figure', name: '6', page: 7, caption: 'Figure 6',
    recoveredBy: 'pdfbox-cross-page',
    regionBoundary: { x1: 10, y1: 20, x2: 300, y2: 400 }
  }]);
  const plan = engine.buildPdfFigureArticlePlan(blocks, figures);

  assert.equal(plan.figures[0].placement, 'caption');
  assert.match(plan.figures[0].caption, /^Fig\. 6 \| Systemic signaling/);
  assert.match(plan.figures[0].caption, /E Fifth readout/);
  assert.match(plan.figures[0].caption, /H Eighth readout/);
  assert.deepEqual([...plan.consumedCaptionIndices], [0, 2]);
  assert.equal(plan.blocks.some(block => /Interleaved article body/.test(block.text)), true);
});

test('a recovered Figure without a MinerU caption stays between neighboring Figures', () => {
  const blocks = [
    { type: 'paragraph', text: 'Figure 1. First result.' },
    { type: 'paragraph', text: 'Body text.' },
    { type: 'paragraph', text: 'Figure 3. Third result.' }
  ];
  const figures = engine.normalizePdffigures2Figures([1, 2, 3].map(number => ({
    figType: 'Figure', name: String(number), page: number * 2,
    caption: `Figure ${number}. Result ${number}.`,
    regionBoundary: { x1: 10, y1: 20, x2: 300, y2: 400 }
  })));
  const plan = engine.buildPdfFigureArticlePlan(blocks, figures);
  assert.deepEqual(plan.figures.map(item => item.figureLabel), [
    'Figure 1', 'Figure 2', 'Figure 3'
  ]);
  assert.deepEqual(plan.figures.map(item => item.anchorIndex), [0, 2, 2]);
  assert.equal(plan.figures[1].placement, 'sequence-before-next');
});

test('MinerU image fragments are removed while text, captions, and tables remain', () => {
  const blocks = [
    { type: 'heading', level: 1, text: 'Paper' },
    { type: 'image', source: 'images/panel-a.png' },
    { type: 'image', source: 'images/panel-b.png' },
    { type: 'paragraph', text: 'Figure 1. Complete caption.' },
    { type: 'table', header: ['Group'], rows: [['A']] },
    { type: 'paragraph', text: 'Body text.' }
  ];
  const cleaned = engine.removeMineruFigureImages(blocks);

  assert.equal(cleaned.blocks.some(block => block.type === 'image'), false);
  assert.equal(cleaned.removedImageCount, 2);
  assert.deepEqual(cleaned.blocks.map(block => block.type), [
    'heading', 'paragraph', 'table', 'paragraph'
  ]);
  assert.deepEqual(cleaned.blocks.map(block => block.sourceIndex), [0, 3, 4, 5]);
});

test('duplicate native records collapse by Figure label, page, and region', () => {
  const raw = {
    figType: 'Figure', name: '1', page: 2,
    caption: 'Figure 1. Complete experiment.',
    regionBoundary: { x1: 72, y1: 120, x2: 540, y2: 500 }
  };
  const figures = engine.normalizePdffigures2Figures([
    raw,
    { ...raw, imageFile: 'duplicate.png' }
  ], { documentFingerprint: 'e'.repeat(64) });
  assert.equal(figures.length, 1);
});

test('whole Figures on the same PDF page follow their explicit numeric order', () => {
  const figures = engine.normalizePdffigures2Figures([
    {
      figType: 'Figure', name: '4', page: 5,
      caption: 'Figure 4. Later Figure.',
      regionBoundary: { x1: 40, y1: 80, x2: 550, y2: 300 }
    },
    {
      figType: 'Figure', name: '3', page: 5,
      caption: 'Figure 3. Earlier Figure.',
      regionBoundary: { x1: 40, y1: 330, x2: 550, y2: 620 }
    }
  ]);

  assert.deepEqual(figures.map(figure => figure.figureLabel), [
    'Figure 3', 'Figure 4'
  ]);
});

test('main-PDF panel references and duplicate rendered images cannot become whole Figures', () => {
  const sharedHash = 'a'.repeat(64);
  const figures = engine.normalizePdffigures2Figures([
    {
      figType: 'Figure', name: '1D', page: 2,
      caption: 'Fig. 1D shows the measured response in the body text.',
      regionBoundary: { x1: 40, y1: 80, x2: 550, y2: 700 },
      sha256: 'b'.repeat(64), mimeType: 'image/png'
    },
    {
      figType: 'Figure', name: '1', page: 2,
      caption: 'Figure 1. Complete experiment. (A) Setup. (B) Result.',
      regionBoundary: { x1: 40, y1: 80, x2: 550, y2: 500 },
      sha256: sharedHash, mimeType: 'image/png'
    },
    {
      figType: 'Figure', name: '2', page: 3,
      caption: 'Figure 2. Incorrect duplicate crop.',
      regionBoundary: { x1: 40, y1: 80, x2: 550, y2: 500 },
      sha256: sharedHash, mimeType: 'image/png'
    }
  ]);
  assert.deepEqual(figures.map(figure => figure.figureLabel), ['Figure 1']);
});

test('supplemental whole-Figure labels keep S numbering while rejecting panel suffixes', () => {
  const figures = engine.normalizePdffigures2Figures([
    {
      figType: 'Figure', name: 'S1', page: 0,
      caption: 'Figure S1. Complete supplemental Figure.',
      regionBoundary: { x1: 20, y1: 40, x2: 500, y2: 600 }
    },
    {
      figType: 'Figure', name: 'S1A', page: 0,
      caption: 'Figure S1A panel reference.',
      regionBoundary: { x1: 20, y1: 40, x2: 500, y2: 600 }
    }
  ], { kind: 'supplemental' });
  assert.deepEqual(figures.map(figure => figure.figureLabel), ['Figure S1']);
});

test('unmatched figures use page-aware fallback before stable document tail fallback', () => {
  const blocks = [
    { type: 'paragraph', text: 'Page one.', pageIndex: 0 },
    { type: 'paragraph', text: 'Page two start.', pageIndex: 1 },
    { type: 'paragraph', text: 'Page two end.', pageIndex: 1 },
    { type: 'paragraph', text: 'Page three.', pageIndex: 2 }
  ];
  const figures = engine.normalizePdffigures2Figures([
    {
      figType: 'Figure', name: '7', page: 1, caption: 'Unmatched caption.',
      regionBoundary: { x1: 72, y1: 120, x2: 540, y2: 500 }
    },
    {
      figType: 'Figure', name: '8', page: 8, caption: 'Outside parsed pages.',
      regionBoundary: { x1: 72, y1: 120, x2: 540, y2: 500 }
    }
  ], { documentFingerprint: 'f'.repeat(64) });
  const plan = engine.buildPdfFigureArticlePlan(blocks, figures);

  assert.deepEqual(plan.figures.map(item => item.anchorIndex), [3, 4]);
  assert.deepEqual(plan.figures.map(item => item.placement), [
    'page-end', 'sequence-after-previous'
  ]);
  assert.equal(plan.figures[1].estimatedPosition, true);
});

test('persisted manifest and analysis inventory retain durable image paths and captions', () => {
  const figures = engine.normalizePdffigures2Figures([{
    figType: 'Figure', name: '1', page: 0,
    caption: 'Figure 1. Durable whole Figure.',
    regionBoundary: { x1: 72, y1: 100, x2: 540, y2: 400 }
  }], {
    documentFingerprint: '1'.repeat(64),
    imageByIndex: [{
      mimeType: 'image/png', width: 1200, height: 800,
      sha256: '2'.repeat(64),
      workspacePath: 'pdf/figures/main/figure-1.png'
    }]
  });
  const manifest = engine.createPdfFigureManifest(figures, {
    documentFingerprint: '1'.repeat(64),
    extractorVersion: '0.1.0-test'
  });
  const inventory = engine.createPdfFigureInventory(manifest);

  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.figures[0].image.workspacePath,
    'pdf/figures/main/figure-1.png');
  assert.equal(inventory[0].figureLabel, 'Figure 1');
  assert.equal(inventory[0].caption, 'Figure 1. Durable whole Figure.');
  assert.equal(inventory[0].imageAssetPath, 'pdf/figures/main/figure-1.png');
  assert.equal(inventory[0].analysisStatus, 'pending');
  assert.equal(inventory[0].sourceMode, 'pdf-pdffigures2');
});
