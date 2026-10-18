const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/article-structure.js');
require('../core/article-extractor.js');

const {
  FIGURE_SELECTOR,
  parseFigureLabel,
  extractFigureTitle,
  extractPanelHints,
  splitFigureCaptionByPanelGroups,
  extractElementPanelHints,
  figureInventoryNeedsRefresh,
  extractArticleFigures,
  extractArticleFiguresFromRecords
} = require('../core/figure-extractor.js');

test('Figure extraction keeps large MinerU Panel image groups intact', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'core', 'figure-extractor.js'),
    'utf8'
  );
  assert.match(source, /return images\.slice\(0, 40\)/);
  assert.doesNotMatch(source, /return images\.slice\(0, 8\)/);
});

test('extracts the translated Figure title before controls and Panel legend text', () => {
  const caption = [
    'Figure 1 Aging-related Nefh is predominantly expressed in Vglut2+ skin-innervating neurons',
    '图 1 与衰老相关的 Nefh 主要在 Vglut2+ 皮肤侵润神经元中表达',
    'Show full caption 显示完整图注',
    '(A) Single-cell analysis of aged skin.'
  ].join(' ');

  assert.deepEqual(extractFigureTitle(caption, 'Figure 1'), {
    title: 'Aging-related Nefh is predominantly expressed in Vglut2+ skin-innervating neurons',
    translatedTitle: '与衰老相关的 Nefh 主要在 Vglut2+ 皮肤侵润神经元中表达'
  });
});

test('falls back to the original Figure title when no translation is present', () => {
  assert.deepEqual(
    extractFigureTitle(
      'Figure 2 Nefh loss accelerates dermal aging (A) Experimental design.',
      'Figure 2'
    ),
    {
      title: 'Nefh loss accelerates dermal aging',
      translatedTitle: ''
    }
  );
});

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

test('builds Figure context from supplied body records without resolving images', () => {
  const candidate = figure({
    caption: 'Figure 6. (A) Overview. (B) Quantification.',
    images: [image('https://journal.example/f6.jpg')]
  });
  let fetchCalls = 0;
  let imageConstructorCalls = 0;
  const previousFetch = globalThis.fetch;
  const previousImage = globalThis.Image;
  globalThis.fetch = () => { fetchCalls += 1; throw new Error('inventory must not fetch'); };
  globalThis.Image = class ImageProbe {
    constructor() { imageConstructorCalls += 1; }
  };
  try {
    const [result] = extractArticleFiguresFromRecords(documentWith([candidate]), [
      { recordType: 'body', paragraphId: 'body-1', text: 'Figure 6 demonstrates the main effect.' },
      { recordType: 'figure-caption', paragraphId: 'caption-1', text: 'Figure 6 must not enter context.' },
      { paragraphId: 'legacy-1', text: 'Fig. 6 confirms the legacy context projection.' }
    ]);

    assert.deepEqual(result.panelHints, ['A', 'B']);
    assert.deepEqual(result.contextParagraphs.map(item => item.paragraphId), ['body-1', 'legacy-1']);
    assert.strictEqual(result.element, candidate);
    assert.strictEqual(result.captionElement, candidate.captionElement);
    assert.strictEqual(result.imageElements[0], candidate.querySelectorAll('img')[0]);
    assert.equal(fetchCalls, 0);
    assert.equal(imageConstructorCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.Image = previousImage;
  }
});

test('legacy Figure wrapper extracts only when its paragraph argument is absent', () => {
  const candidate = figure({ caption: 'Figure 7. Inventory fixture.' });
  const previousExtractor = globalThis.SciLLM.extractArticle;
  let extractionCalls = 0;
  globalThis.SciLLM.extractArticle = () => {
    extractionCalls += 1;
    return [{ recordType: 'body', paragraphId: 'body-7', text: 'Figure 7 is cited here.' }];
  };
  try {
    assert.equal(extractArticleFigures(documentWith([candidate]), []).length, 1);
    assert.equal(extractionCalls, 0);
    assert.deepEqual(
      extractArticleFigures(documentWith([candidate]))[0].contextParagraphs.map(item => item.paragraphId),
      ['body-7']
    );
    assert.equal(extractionCalls, 1);
  } finally {
    globalThis.SciLLM.extractArticle = previousExtractor;
  }
});

test('parses English and Chinese main Figure labels but excludes supplementary labels', () => {
  assert.deepEqual(parseFigureLabel('Figure 12. Study workflow'), {
    figureNumber: 12,
    figureCode: '12',
    figureSeries: 'main',
    isSupplemental: false,
    figureId: 'figure-12',
    figureLabel: 'Figure 12'
  });
  assert.equal(parseFigureLabel('图 3｜治疗结果').figureId, 'figure-3');
  assert.deepEqual(parseFigureLabel('Supplementary Figure 2'), {
    figureNumber: 2,
    figureCode: 'S2',
    figureSeries: 'supplemental',
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

test('filters icon-sized images and leaves full matching paragraphs for the prompt budget', () => {
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
  assert.equal(result.contextParagraphs.length, 9);
  assert.deepEqual(result.contextParagraphs.map(item => item.text), paragraphs.map(item => item.text));
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

test('keeps Extended Data Figures in a collision-safe supplemental series', () => {
  assert.deepEqual(parseFigureLabel('Extended Data Figure 4. Validation cohort.'), {
    figureNumber: 4,
    figureCode: 'ED4',
    figureSeries: 'extended-data',
    isSupplemental: true,
    figureId: 'figure-ed4',
    figureLabel: 'Extended Data Figure 4'
  });

  const main = figure({
    caption: 'Figure 4. Main causal experiment.',
    images: [image('https://journal.example/f4.jpg')]
  });
  const extended = figure({
    caption: 'Extended Data Figure 4. Orthogonal validation. (A-C) Replication panels.',
    images: [image('https://journal.example/ed4.jpg')]
  });
  const results = extractArticleFigures(documentWith([main, extended]), [
    { paragraphId: 'main-ref', text: 'Figure 4 establishes the causal effect.' },
    { paragraphId: 'ed-ref', text: 'Extended Data Figure 4B confirms the result.' }
  ]);

  assert.deepEqual(results.map(item => item.figureId), ['figure-4', 'figure-ed4']);
  assert.deepEqual(results[0].contextParagraphs.map(item => item.paragraphId), ['main-ref']);
  assert.deepEqual(results[1].contextParagraphs.map(item => item.paragraphId), ['ed-ref']);
  assert.deepEqual(results[1].panelHints, ['A', 'B', 'C']);
});

test('recognizes publisher legends that use bold-style bare letters after sentence boundaries', () => {
  assert.deepEqual(
    extractPanelHints(
      'Fig. 6 | Systemic signaling. A Healthy-normalized CD69 intensity. ' +
      'B Representative histograms. C Splenic T-cell counts. ' +
      'D S1P1-positive cells. E Bone-marrow flow cytometry. F Cervical-node counts.'
    ),
    ['A', 'B', 'C', 'D', 'E', 'F']
  );
  assert.deepEqual(
    extractPanelHints('Figure 1. A total of 20 animals were analyzed. A significant effect was observed.'),
    []
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

test('does not turn units, injection abbreviations, orientation keys, or prose after panels into Panels', () => {
  assert.deepEqual(extractPanelHints(
    'Figure S12. (A) Sequence of i.p. injection. (B-F) Images and quantification. ' +
    'Scale bars are shown in the right panels. Values are mean ± s.d. and reported ' +
    'in a.u., arbitrary units; V, ventral. P values used a Mann-Whitney U test.'
  ), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.deepEqual(extractPanelHints(
    'Figure S14. (A) Workflow with (i) staining and (ii) outflow measurement. ' +
    '(B-E) Adult results. (F) Aged workflow. (G-I) Aged results.'
  ), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
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

test('discovers a caption-only Extended Data Figure inside an accordion', () => {
  const captionElement = {
    textContent: 'Extended Data Figure 7',
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getAttribute() { return ''; },
    closest(selector) {
      return /details|accordion/i.test(selector) ? accordion : null;
    }
  };
  const expandedLegend = {
    textContent: 'Extended Data Figure 7. (A) Cohort design. (B-D) Replication results.',
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getAttribute() { return ''; }
  };
  const accordion = {
    textContent: `${captionElement.textContent} ${expandedLegend.textContent}`,
    querySelector(selector) {
      return /figcaption|caption|description/i.test(selector) ? expandedLegend : null;
    },
    querySelectorAll(selector) {
      if (/figcaption|caption|description/i.test(selector)) return [expandedLegend];
      return [];
    },
    getAttribute() { return ''; },
    closest() { return null; }
  };
  const documentLike = {
    querySelectorAll(selector) {
      if (selector === FIGURE_SELECTOR) return [];
      return /figcaption|caption|description|summary/i.test(selector)
        ? [captionElement] : [];
    }
  };

  const [result] = extractArticleFigures(documentLike, [{
    paragraphId: 'ed-7-ref',
    sectionTitle: 'Validation',
    text: 'Extended Data Figure 7C provides the independent replication.'
  }]);

  assert.equal(result.figureId, 'figure-ed7');
  assert.equal(result.figureSeries, 'extended-data');
  assert.equal(result.isSupplemental, true);
  assert.equal(result.element, accordion);
  assert.equal(result.caption, expandedLegend.textContent);
  assert.deepEqual(result.imageElements, []);
  assert.deepEqual(result.panelHints, ['A', 'B', 'C', 'D']);
  assert.deepEqual(result.contextParagraphs.map(item => item.paragraphId), ['ed-7-ref']);
});

test('discovers Nature title-plus-content Extended Data sections with dotted Fig labels', () => {
  const title = { textContent: 'Extended Data Fig. 1.' };
  const content = {
    textContent: 'a, Quality control data. b–d, Independent validation assays. e, Rescue result.',
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getAttribute() { return ''; }
  };
  const section = {
    textContent: `${title.textContent} ${content.textContent}`,
    querySelector(selector) {
      if (/__title|section-title|h2|h3|h4/.test(selector)) return title;
      if (/__content|section-content/.test(selector)) return content;
      return null;
    },
    querySelectorAll(selector) {
      if (/img|panel/.test(selector)) return [];
      return [];
    },
    getAttribute() { return ''; },
    closest() { return null; }
  };
  const documentLike = {
    querySelectorAll(selector) {
      if (selector === FIGURE_SELECTOR) return [];
      if (selector === '.c-article-section') return [section];
      return [];
    }
  };

  const [result] = extractArticleFigures(documentLike, [{
    paragraphId: 'ed-1-ref',
    sectionTitle: 'Results',
    text: 'Extended Data Fig. 1c confirms the result.'
  }]);

  assert.equal(result.figureId, 'figure-ed1');
  assert.equal(result.figureLabel, 'Extended Data Figure 1');
  assert.equal(result.caption, `${title.textContent} ${content.textContent}`);
  assert.equal(result.captionElement, content);
  assert.deepEqual(result.panelHints, ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(result.contextParagraphs.map(item => item.paragraphId), ['ed-1-ref']);
});

test('discovers every nested Nature supplementary item and its data-supp-info image', () => {
  const outerTitle = { textContent: 'Extended data figures and tables' };
  const nestedItem = number => {
    const title = {
      textContent: `Extended Data Fig. ${number} Supporting validation.`,
      getAttribute(name) {
        if (name === 'data-supp-info-image') {
          return `//media.springernature.com/full/s41586-026-10907-8_Fig${number + 5}_ESM.jpg`;
        }
        return '';
      }
    };
    const description = {
      textContent: 'a, Cohort design. b, Independent validation mice c, Rescue result.',
      querySelector() { return null; },
      querySelectorAll(selector) {
        return selector === 'b,strong'
          ? ['a', 'b', 'c'].map(textContent => ({ textContent })) : [];
      },
      getAttribute() { return ''; }
    };
    const item = {
      textContent: `${title.textContent} ${description.textContent}`,
      querySelector(selector) {
        if (/supplementary__title|supp-info-link|__title|section-title|h2|h3|h4/.test(selector)) {
          return title;
        }
        if (/supplementary__description|__content|section-content/.test(selector)) {
          return description;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (/data-supp-info-image/.test(selector)) return [title];
        if (/supplementary__description/.test(selector)) return [description];
        return [];
      },
      getAttribute() { return ''; },
      closest() { return null; }
    };
    return item;
  };
  const items = [nestedItem(1), nestedItem(2)];
  const outerSection = {
    querySelector(selector) {
      return /__title|section-title|h2|h3|h4/.test(selector) ? outerTitle : null;
    },
    querySelectorAll(selector) {
      return /supplementary__item/.test(selector) ? items : [];
    }
  };
  const documentLike = {
    querySelectorAll(selector) {
      if (selector === FIGURE_SELECTOR) return [];
      if (selector === '.c-article-section') return [outerSection];
      return [];
    }
  };

  const results = extractArticleFigures(documentLike, []);

  assert.deepEqual(results.map(item => item.figureId), ['figure-ed1', 'figure-ed2']);
  assert.deepEqual(results[0].panelHints, ['A', 'B', 'C']);
  assert.equal(results[0].imageElements.length, 1);
  assert.match(
    results[0].imageElements[0].getAttribute('data-supp-info-image'),
    /_Fig6_ESM\.jpg$/
  );
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
    { paragraphId: 'supplement', text: 'Supplementary Figure 5F shows the supporting control.' }
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

test('detects ScienceDirect plural captions beside concatenated download controls', () => {
  const captionElement = {
    textContent: 'Figure 1. Overview of lactate metabolism and L-lactylation.',
    querySelector() { return null; },
    getAttribute() { return ''; }
  };
  const figureImage = image(
    'https://ars.els-cdn.com/content/image/1-s2.0-S2352304225004246-gr1.jpg',
    713,
    480
  );
  const candidate = {
    textContent:
      'Download: Download high-res imageDownload: Download full-size imageFigure 1. ' +
      'Overview of lactate metabolism and L-lactylation.',
    querySelector(selector) {
      return selector.split(',').some(part => part.trim() === '.captions')
        ? captionElement : null;
    },
    querySelectorAll(selector) {
      if (/img/i.test(selector)) return [figureImage];
      if (selector.split(',').some(part => part.trim() === '.captions')) {
        return [captionElement];
      }
      return [];
    },
    getAttribute() { return ''; },
    closest() { return null; }
  };

  const [result] = extractArticleFigures(documentWith([candidate]), []);

  assert.equal(result.figureId, 'figure-1');
  assert.equal(result.captionElement, captionElement);
  assert.match(result.caption, /^Figure 1\./);
  assert.equal(result.imageElements[0], figureImage);
});

test('repairs a lost DOM text boundary before a Figure label', () => {
  assert.equal(
    parseFigureLabel('Download full-size imageFigure 3. Therapeutic opportunities.')?.figureId,
    'figure-3'
  );
});

test('ignores Cell Figure360 branding and keeps Figures 1–3 in the inventory', () => {
  assert.equal(
    parseFigureLabel(
      'For a Figure360 author presentation of Figure 1, see https://doi.org/example'
    )?.figureId,
    'figure-1'
  );

  const candidates = [1, 2, 3].map(number => {
    const mainCaption = {
      textContent: `Figure ${number}. Main experimental result.`,
      querySelector() { return null; }
    };
    const figure360Caption = {
      textContent:
        `For a Figure360 author presentation of Figure ${number}, ` +
        'see https://doi.org/example',
      querySelector() { return null; }
    };
    return figure({
      captionCandidates: [mainCaption, figure360Caption],
      elementText: `${mainCaption.textContent} ${figure360Caption.textContent}`,
      images: [image(`https://journal.example/figure-${number}.jpg`)]
    });
  });

  assert.deepEqual(
    extractArticleFigures(documentWith(candidates), []).map(item => item.figureId),
    ['figure-1', 'figure-2', 'figure-3']
  );
});

test('splits Nature-style captions while preserving merged Panel groups', () => {
  assert.deepEqual(
    splitFigureCaptionByPanelGroups(
      'Figure 2. Tumour response. a–c, Imaging and quantification. ' +
      'd, Rescue assay. e,f, Orthogonal validation.'
    ),
    [
      {
        kind: 'overview',
        panels: [],
        text: 'Figure 2. Tumour response.'
      },
      {
        kind: 'panels',
        panels: ['A', 'B', 'C'],
        text: 'a–c, Imaging and quantification.'
      },
      {
        kind: 'panels',
        panels: ['D'],
        text: 'd, Rescue assay.'
      },
      {
        kind: 'panels',
        panels: ['E', 'F'],
        text: 'e,f, Orthogonal validation.'
      }
    ]
  );
});

test('keeps parenthesized combined Panels in one caption block', () => {
  const blocks = splitFigureCaptionByPanelGroups(
    'Figure 4. Study design. (A and B) Discovery cohorts. ' +
    '(C–E) Validation cohorts.'
  );
  assert.deepEqual(blocks[1].panels, ['A', 'B']);
  assert.match(blocks[1].text, /^\(A and B\)/);
  assert.deepEqual(blocks[2].panels, ['C', 'D', 'E']);
  assert.equal(blocks.length, 3);
});

test('keeps an inseparable caption as one honest whole-Figure block', () => {
  assert.deepEqual(
    splitFigureCaptionByPanelGroups(
      'Figure 6. Integrated model without explicit Panel legend markers.'
    ),
    [{
      kind: 'overview',
      panels: [],
      text: 'Figure 6. Integrated model without explicit Panel legend markers.'
    }]
  );
});
