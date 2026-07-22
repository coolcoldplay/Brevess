const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FIGURE_SELECTOR,
  parseFigureLabel,
  extractPanelHints,
  extractElementPanelHints,
  figureInventoryNeedsRefresh,
  extractArticleFigures
} = require('../core/figure-extractor.js');

function image(src, width = 900, height = 600) {
  return {
    currentSrc: src,
    src,
    naturalWidth: width,
    naturalHeight: height,
    width,
    height,
    getAttribute(name) {
      if (name === 'src') return src;
      if (name === 'width') return String(width);
      if (name === 'height') return String(height);
      return '';
    }
  };
}

function figure({
  caption = '', captionLabel = '', captionCandidates = [], elementText = '',
  images = [], panelNodes = [], ariaLabel = '', excluded = false
}) {
  const captionElement = caption ? {
    textContent: caption,
    querySelector(selector) {
      return captionLabel && /fig-label|figure-label/i.test(selector)
        ? { textContent: captionLabel }
        : null;
    }
  } : null;
  const allCaptionCandidates = captionCandidates.length
    ? captionCandidates : captionElement ? [captionElement] : [];
  return {
    textContent: elementText || caption,
    className: '',
    querySelector(selector) {
      return /figcaption|caption|description/i.test(selector)
        ? allCaptionCandidates[0] || null : null;
    },
    querySelectorAll(selector) {
      if (/img/i.test(selector)) return images;
      if (/panel/i.test(selector)) return panelNodes;
      if (/figcaption|caption|description/i.test(selector)) return allCaptionCandidates;
      return [];
    },
    getAttribute(name) {
      return name === 'aria-label' ? ariaLabel : '';
    },
    closest() {
      return excluded ? {} : null;
    },
    captionElement
  };
}

function documentWith(candidates) {
  return {
    querySelectorAll() {
      return candidates;
    }
  };
}

test('parses English and Chinese main Figure labels but excludes supplementary labels', () => {
  assert.deepEqual(parseFigureLabel('Figure 12. Study workflow'), {
    figureNumber: 12,
    figureCode: '12',
    isSupplemental: false,
    figureId: 'figure-12',
    figureLabel: 'Figure 12'
  });
  assert.equal(parseFigureLabel('图 3｜治疗结果').figureId, 'figure-3');
  assert.deepEqual(parseFigureLabel('Supplementary Figure 2'), {
    figureNumber: 2,
    figureCode: 'S2',
    isSupplemental: true,
    figureId: 'figure-s2',
    figureLabel: 'Figure S2'
  });
  assert.equal(parseFigureLabel('Figure S9. Full gating strategy.')?.figureId, 'figure-s9');
  assert.equal(parseFigureLabel('Graphical abstract'), null);
  assert.equal(
    parseFigureLabel('Open in a separate window Figure 1. See Supplementary Figure 2 and Table 1.')?.figureId,
    'figure-1'
  );
});

test('extracts, deduplicates and numerically sorts main article Figures', () => {
  const weakFigure1 = figure({
    caption: 'Figure 1. Short.',
    images: [image('https://journal.example/f1-thumb.jpg', 120, 90)]
  });
  const richFigure1 = figure({
    caption: 'Figure 1. Experimental design and quantified treatment response.',
    images: [
      image('https://journal.example/f1.jpg'),
      image('https://journal.example/f1-panel.jpg', 700, 500)
    ]
  });
  const supplementary = figure({
    caption: 'Supplementary Figure 2. Extra analysis.',
    images: [image('https://journal.example/s2.jpg')]
  });
  const figure10 = figure({
    caption: 'Fig. 10. Final validation.',
    images: [image('https://journal.example/f10.jpg')]
  });
  const figure3 = figure({
    caption: 'Figure 3. Rescue experiment.',
    images: [image('https://journal.example/f3.jpg')]
  });

  const results = extractArticleFigures(
    documentWith([weakFigure1, figure10, supplementary, richFigure1, figure3]),
    [
      { paragraphId: 'p1', text: 'As shown in Fig. 1, treatment reduced tumor volume.' },
      { paragraphId: 'p2', text: 'Figure 3 demonstrates restoration after rescue.' }
    ]
  );

  assert.deepEqual(results.map(item => item.figureId), ['figure-10', 'figure-s2', 'figure-1', 'figure-3']);
  assert.equal(results[2].element, richFigure1);
  assert.equal(results[2].imageElements.length, 2);
  assert.deepEqual(results[2].contextParagraphs.map(item => item.paragraphId), ['p1']);
  assert.deepEqual(results[3].contextParagraphs.map(item => item.paragraphId), ['p2']);
});

test('filters icon-sized images and bounds related paragraph context', () => {
  const candidate = figure({
    caption: 'Figure 4. Multi-panel assay.',
    images: [
      image('https://journal.example/icon.png', 24, 24),
      image('https://journal.example/full.jpg', 1200, 800)
    ]
  });
  const paragraphs = Array.from({ length: 9 }, (_, index) => ({
    paragraphId: 'p' + (index + 1),
    text: 'Figure 4 shows result ' + (index + 1) + '. ' + 'x'.repeat(1400)
  }));

  const [result] = extractArticleFigures(documentWith([candidate]), paragraphs);

  assert.equal(result.imageElements.length, 1);
  assert.equal(result.contextParagraphs.length, 6);
  assert.ok(result.contextParagraphs.every(item => item.text.length <= 1200));
});

test('collects individual, paired, and ranged panel hints from a Figure caption', () => {
  const candidate = figure({
    caption: 'Figure S1. (A and B) paired assays. (C–E) quantitative validation. (F) control. (G, I, and J) statistics.',
    images: [image('https://journal.example/fs1.jpg')]
  });
  const [result] = extractArticleFigures(documentWith([candidate]), []);

  assert.equal(result.figureId, 'figure-s1');
  assert.deepEqual(result.panelHints, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'J']);
});

test('recognizes common unparenthesized caption and DOM panel labels without an LLM', () => {
  assert.deepEqual(
    extractPanelHints('Figure 2. Panels A–C show the screen. D: rescue assay. E, validation.'),
    ['A', 'B', 'C', 'D', 'E']
  );
  const panelNode = {
    textContent: 'Panel F',
    getAttribute(name) { return name === 'data-panel' ? 'F' : ''; }
  };
  const candidate = figure({
    caption: 'Figure 2. A: screen. B, quantification.',
    panelNodes: [panelNode],
    images: [image('https://journal.example/f2.jpg')]
  });
  const [result] = extractArticleFigures(documentWith([candidate]), []);
  assert.deepEqual(result.panelHints, ['A', 'B', 'F']);
});

test('recognizes lowercase Nature legend markers and ranges without an LLM', () => {
  assert.deepEqual(
    extractPanelHints('Fig. 1 | Study overview. a, cohort design. b–d, UMAP and quantification. e: validation.'),
    ['A', 'B', 'C', 'D', 'E']
  );
});

test('recognizes the compact no-space Nature caption used by the glioblastoma article', () => {
  assert.deepEqual(extractPanelHints(
    'a,Schematic overview of the 10x chromium setup. Mice were analyzed (n = 3).' +
    'b–d,Top: Harmony-corrected UMAP plots for human tumors (b), recurrent tumors (c)' +
    ' and mouse tumors (d).e,f,Heatmaps representing subset-specific genes.'
  ), ['A', 'B', 'C', 'D', 'E', 'F']);
});

test('does not turn Nature Figure glossary abbreviations into Panels', () => {
  assert.deepEqual(extractPanelHints(
    'a,Schematic overview of the 10x chromium setup. Tumors were resected from seven ND ' +
    'and four recurrent tumor samples. Mouse data contained GL261 tumors microdissected ' +
    'from WT C57BL/6J (n = 3) or Ccr2-KO mice (n = 3). b-d,Top: Harmony-corrected UMAP ' +
    'plots for human ND GBM tumors (b), human recurrent GBM tumors (c) and mouse tumors ' +
    '(d). Bottom: pie charts for each individual human ND tumor (b), recurrent tumor (c) ' +
    'and mouse tumor (d). e,f,Heatmaps representing relevant subset-specific genes. ' +
    'Colors and numbers match that of the clusters shown in b-d. B, B cells; Mast, mast ' +
    'cells; Mo, monocytes; n.c., necrotic core; PI B, plasma B cells; prol. TAM, ' +
    'proliferating TAMs; T, T cells; Treg, regulatory T cells.'
  ), ['A', 'B', 'C', 'D', 'E', 'F']);
});

test('prefers Nature structured bold markers over prose-like statistical initials', () => {
  const structuredCaption = {
    querySelectorAll(selector) {
      return selector === 'b,strong'
        ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(text => ({ textContent: text }))
        : [];
    }
  };
  const element = {
    querySelectorAll(selector) {
      if (/bottom-caption|figure-description/.test(selector)) return [structuredCaption];
      return [];
    }
  };

  assert.deepEqual(extractElementPanelHints(
    element,
    'a, Experiment. b-h, Results. I, interaction term; M, mean; T, T cells.'
  ), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
});

test('recognizes every Panel in the exact grouped Nature legend style from the live article', () => {
  assert.deepEqual(extractPanelHints(
    'Figure 8. CCR2 deficiency changes TAM ontogeny. ' +
    'a-c,Monocytes and macrophages were selected and reclustered. ' +
    'd-f.UMAP plots show selected genes in ND, recurrent and mouse tumors. ' +
    'g,h.Volcano plots compare Mg-TAMs and Mo-TAMs. ' +
    'i,j.Scatter plots and TAM percentages are shown.'
  ), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
});

test('prefers a detailed Nature description when the first caption node is title-only', () => {
  const title = {
    textContent: 'Figure 8. CCR2 deficiency changes TAM ontogeny.',
    querySelector() { return { textContent: 'Figure 8' }; }
  };
  const description = {
    textContent: 'a-c,Selection and reclustering. d-f.Expression plots. g,h.Volcano plots. i,j.Validation.',
    querySelector() { return null; }
  };
  const candidate = figure({
    captionCandidates: [title, description],
    elementText: `${title.textContent} ${description.textContent}`,
    images: [image('https://journal.example/f8.jpg')]
  });

  const [result] = extractArticleFigures(documentWith([candidate]), []);

  assert.equal(result.figureId, 'figure-8');
  assert.deepEqual(result.panelHints, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  assert.equal(result.captionElement, candidate);
});

test('rejects an aggregate wrapper so Figure identity, image, and Panels cannot cross', () => {
  const figure1 = figure({
    caption: 'Figure 1. Study overview. a-c,Workflow and cohorts.',
    captionLabel: 'Figure 1',
    images: [image('https://journal.example/figure-1.jpg')]
  });
  const figure2 = figure({
    caption: 'Figure 2. Dendritic-cell atlas. a-m,UMAP, heatmaps, and validation.',
    captionLabel: 'Figure 2',
    images: [image('https://journal.example/figure-2.jpg')]
  });
  const children = [figure1, figure2];
  const captions = children.map(child => child.captionElement);
  const labels = captions.map(caption => caption.querySelector('.figure-label'));
  const aggregate = {
    textContent: children.map(child => child.textContent).join(' '),
    querySelector(selector) {
      if (/fig-label|figure-label/i.test(selector)) return labels[0];
      if (/figcaption|caption|description/i.test(selector)) return captions[0];
      return null;
    },
    querySelectorAll(selector) {
      if (/img/i.test(selector)) {
        return children.flatMap(child => child.querySelectorAll('img'));
      }
      if (/fig-label|figure-label/i.test(selector)) return labels;
      if (/panel/i.test(selector)) return [];
      if (/figcaption|caption|description/i.test(selector)) return captions;
      return [];
    },
    getAttribute() { return ''; },
    closest() { return null; }
  };

  const results = extractArticleFigures(documentWith([aggregate, figure1, figure2]), []);
  const extractedFigure1 = results.find(item => item.figureId === 'figure-1');
  const extractedFigure2 = results.find(item => item.figureId === 'figure-2');

  assert.equal(extractedFigure1.element, figure1);
  assert.equal(extractedFigure1.imageElements[0].src, 'https://journal.example/figure-1.jpg');
  assert.deepEqual(extractedFigure1.panelHints, ['A', 'B', 'C']);
  assert.equal(extractedFigure2.element, figure2);
  assert.equal(extractedFigure2.imageElements[0].src, 'https://journal.example/figure-2.jpg');
  assert.deepEqual(
    extractedFigure2.panelHints,
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']
  );
});

test('invalidates an early Figure inventory after a dynamic caption finishes rendering', () => {
  const candidate = figure({
    caption: 'Figure 1. Loading figure…',
    images: [image('https://journal.example/f1.jpg')]
  });
  const inventory = extractArticleFigures(documentWith([candidate]), []);
  assert.equal(figureInventoryNeedsRefresh(inventory), false);
  candidate.captionElement.textContent =
    'Figure 1. scRNA-seq overview. a, setup. b–d, UMAP plots. e,f, heatmaps.';
  assert.equal(figureInventoryNeedsRefresh(inventory), true);
});

test('cached Figure freshness checks do not rescan Panel descendants', () => {
  const candidate = figure({
    caption: 'Figure 3. a-c,Screen. d-f.Validation.',
    images: [image('https://journal.example/f3.jpg')]
  });
  const inventory = extractArticleFigures(documentWith([candidate]), []);
  let descendantQueries = 0;
  candidate.querySelectorAll = () => {
    descendantQueries += 1;
    return [];
  };

  for (let index = 0; index < 100; index += 1) {
    assert.equal(figureInventoryNeedsRefresh(inventory), false);
  }

  assert.equal(descendantQueries, 0);
});

test('keeps caption-only Figures so protected or canvas images can use text evidence fallback', () => {
  const candidate = figure({
    caption: 'Figure 6. Caption-only mechanistic summary.',
    images: []
  });
  const [result] = extractArticleFigures(documentWith([candidate]), []);

  assert.equal(result.figureId, 'figure-6');
  assert.deepEqual(result.imageElements, []);
  assert.equal(result.caption, 'Figure 6. Caption-only mechanistic summary.');
});

test('keeps lazy-loaded publisher images from data-src attributes', () => {
  const lazyImage = {
    currentSrc: '',
    src: '',
    naturalWidth: 1100,
    naturalHeight: 700,
    width: 1100,
    height: 700,
    getAttribute(name) {
      return name === 'data-src'
        ? 'https://journal.example/cms/asset/figure-5.jpg'
        : '';
    }
  };
  const candidate = figure({
    caption: 'Figure 5. Publisher lazy image.',
    images: [lazyImage]
  });

  const [result] = extractArticleFigures(documentWith([candidate]), []);

  assert.equal(result.figureId, 'figure-5');
  assert.equal(result.imageElements[0], lazyImage);
});

test('links plural and compound Figure citations to every referenced Figure', () => {
  const figure2 = figure({
    caption: 'Figure 2. First experiment.',
    images: [image('https://journal.example/f2.jpg')]
  });
  const figure3 = figure({
    caption: 'Figure 3. Follow-up experiment.',
    images: [image('https://journal.example/f3.jpg')]
  });
  const paragraph = {
    paragraphId: 'p-results',
    text: 'Figs. 2A, B, and 3 show the sequential validation experiments.'
  };

  const results = extractArticleFigures(
    documentWith([figure2, figure3]),
    [paragraph]
  );

  assert.deepEqual(
    results.map(item => item.contextParagraphs.map(context => context.paragraphId)),
    [['p-results'], ['p-results']]
  );
});

test('registers the Europe PMC full-text Figure container', () => {
  assert.match(FIGURE_SELECTOR, /\.fig-inline-img-set/);
});

test('does not attach Figure S5 citations to main Figure 5', () => {
  const figure5 = figure({
    caption: 'Figure 5. Main-text experiment.',
    images: [image('https://journal.example/f5.jpg')]
  });
  const figureS5 = figure({
    caption: 'Figure S5. Supporting validation.',
    images: [image('https://journal.example/fs5.jpg')]
  });
  const results = extractArticleFigures(documentWith([figure5, figureS5]), [
    { paragraphId: 'main', text: 'Figure 5 shows the causal intervention.' },
    { paragraphId: 'supplement', text: 'Figure S5F shows the supporting control.' }
  ]);

  assert.deepEqual(results[0].contextParagraphs.map(item => item.paragraphId), ['main']);
  assert.deepEqual(results[1].contextParagraphs.map(item => item.paragraphId), ['supplement']);
});

test('uses a publisher Figure label element when accessibility text is concatenated', () => {
  const candidate = figure({
    caption: 'Open in a separate windowFigure 6 Main result. See Supplementary Table 2.',
    captionLabel: 'Figure 6',
    images: [image('https://europepmc.org/api/fulltextRepo?fileName=figure6.jpg')]
  });

  const [result] = extractArticleFigures(documentWith([candidate]), []);

  assert.equal(result.figureId, 'figure-6');
  assert.match(result.caption, /Open in a separate windowFigure 6/);
});
