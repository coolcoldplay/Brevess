const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pdf = require('../core/pdf-workspace.js');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('PDF detection routes HTTP and local PDF tabs into the extension reader', () => {
  assert.equal(pdf.isLikelyPdfUrl('https://example.org/paper.pdf?download=1'), true);
  assert.equal(pdf.isLikelyPdfUrl('file:///D:/papers/paper.pdf'), true);
  assert.equal(pdf.isLikelyPdfUrl('https://arxiv.org/pdf/2607.12345'), true);
  assert.equal(pdf.isLikelyPdfUrl('https://example.org/download?id=42&format=pdf'), true);
  assert.equal(pdf.isLikelyPdfUrl('https://example.org/article', 'paper.pdf'), true);
  assert.equal(pdf.isLikelyPdfUrl('https://example.org/article.html'), false);
  const reader = pdf.createPdfReaderUrl(
    file => `chrome-extension://test/${file}`,
    'https://example.org/paper.pdf#page=4',
    'Paper title'
  );
  assert.equal(pdf.isPdfReaderUrl(reader), true);
  const parsed = new URL(reader);
  assert.equal(parsed.searchParams.get('source'), 'https://example.org/paper.pdf');
  assert.equal(parsed.searchParams.get('title'), 'Paper title');
});

test('a manually selected local PDF gets a stable privacy-safe workspace URL', () => {
  const hash = 'A'.repeat(64);
  assert.equal(
    pdf.buildLocalPdfWorkspaceUrl('Focused ultrasound / results.pdf', hash),
    `file:///brevess-local-pdf/${hash.toLowerCase()}/Focused%20ultrasound%20results.pdf`
  );
  assert.equal(pdf.buildLocalPdfWorkspaceUrl('paper.pdf', 'not-a-sha256'), '');
  assert.equal(pdf.buildLocalPdfWorkspaceUrl('', hash), '');
});

test('MinerU Markdown is converted into semantic headings, paragraphs, and figures', () => {
  const blocks = pdf.markdownToPdfBlocks([
    '# A mechanism paper',
    '',
    '## Results',
    '',
    'The intervention increased the measured outcome.',
    '',
    '![](images/figure_1.png)',
    '',
    'Figure 1. Intervention and quantitative validation.',
    '',
    '- first evidence',
    '- second evidence'
  ].join('\n'));
  assert.deepEqual(blocks.slice(0, 5), [
    { type: 'heading', level: 1, text: 'A mechanism paper' },
    { type: 'heading', level: 2, text: 'Results' },
    { type: 'paragraph', text: 'The intervention increased the measured outcome.' },
    { type: 'image', alt: '', source: 'images/figure_1.png' },
    { type: 'paragraph', text: 'Figure 1. Intervention and quantitative validation.' }
  ]);
  assert.equal(blocks.at(-1).type, 'list');
  assert.deepEqual(
    blocks.at(-1).items.map(item => item.text),
    ['first evidence', 'second evidence']
  );
});

test('parsed PDF image cache keeps MinerU Figure assets restorable under a byte cap', () => {
  const blocks = [
    { type: 'image', source: 'images/fig1-a.png' },
    { type: 'image', source: 'images/fig1-b.jpg' },
    { type: 'paragraph', text: 'Figure 1. Complete caption.' }
  ];
  const entries = new Map([
    ['paper/images/fig1-a.png', new Uint8Array([1, 2, 3, 4])],
    ['paper/images/fig1-b.jpg', new Uint8Array([5, 6, 7])]
  ]);
  const cached = pdf.buildPersistablePdfImageCache(
    blocks, entries, 'paper/full.md', {}, { maxBytes: 32, maxImages: 10 }
  );
  assert.equal(cached.cachedImageCount, 2);
  assert.equal(cached.omittedImageCount, 0);
  assert.match(cached.images['images/fig1-a.png'], /^data:image\/png;base64,/);
  assert.match(cached.images['images/fig1-b.jpg'], /^data:image\/jpeg;base64,/);
  const capped = pdf.buildPersistablePdfImageCache(
    blocks, entries, 'paper/full.md', {}, { maxBytes: 5, maxImages: 10 }
  );
  assert.equal(capped.cachedImageCount, 1);
  assert.equal(capped.omittedImageCount, 1);
});

test('remote MinerU Figure assets are downloaded into the restorable PDF image cache', async () => {
  const requests = [];
  const cached = await pdf.buildRemotePdfImageCache(
    [
      { type: 'image', source: 'images/figure-1.png' },
      { type: 'image', source: 'images/figure-2.svg' }
    ],
    reference => `https://mineru.example/result/${reference}`,
    async url => {
      requests.push(url);
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {
          'content-type': url.endsWith('.svg') ? 'image/svg+xml' : 'image/png'
        }
      });
    },
    { maxBytes: 64, maxImages: 10 }
  );
  assert.deepEqual(requests, [
    'https://mineru.example/result/images/figure-1.png',
    'https://mineru.example/result/images/figure-2.svg'
  ]);
  assert.equal(cached.cachedImageCount, 2);
  assert.equal(cached.cachedBytes, 8);
  assert.match(cached.images['images/figure-1.png'], /^data:image\/png;base64,/);
  assert.match(cached.images['images/figure-2.svg'], /^data:image\/svg\+xml;base64,/);
});

test('MinerU scientific Markdown is normalized and kept as safe inline tokens', () => {
  assert.equal(
    pdf.normalizeScientificInline('Prox1 $^{+}$ cells; 1 $\\mu$l; $\\beta$-III-tubulin'),
    'Prox1 ⁺ cells; 1 μl; β-III-tubulin'
  );
  assert.deepEqual(
    pdf.markdownInlineTokens('**Strong** *context* `code` [DOI](https://doi.org/10.1/x)'),
    [
      { type: 'strong', text: 'Strong' },
      { type: 'text', text: ' ' },
      { type: 'emphasis', text: 'context' },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'code' },
      { type: 'text', text: ' ' },
      { type: 'link', text: 'DOI', href: 'https://doi.org/10.1/x' }
    ]
  );
});

test('scientific inline rendering restores HTML scripts and common LaTeX formatting', () => {
  assert.equal(
    pdf.normalizeScientificInline('CD4<sup>+</sup>, MgCl<sub>2</sub>, x̄ and $\\mathbf{T}^{\\circ}$'),
    'CD4<sup>+</sup>, MgCl<sub>2</sub>, x̄ and T°'
  );
  assert.deepEqual(
    pdf.markdownInlineTokens('CD4<sup>+</sup> and H<sub>2</sub>O <span>safe</span>'),
    [
      { type: 'text', text: 'CD4' },
      { type: 'superscript', text: '+' },
      { type: 'text', text: ' and H' },
      { type: 'subscript', text: '2' },
      { type: 'text', text: 'O  safe ' }
    ]
  );
});

test('scientific inline rendering repairs OCR-shifted accents and orphan script tags', () => {
  assert.equal(
    pdf.normalizeScientificInline('Page\\` s, Bi\\`eche, trial\\_suppl'),
    'Pagès, Bièche, trial_suppl'
  );
  assert.deepEqual(
    pdf.markdownInlineTokens('score 22</sup> and R<sup>2</sup>'),
    [
      { type: 'text', text: 'score 22 and R' },
      { type: 'superscript', text: '2' }
    ]
  );
});

test('MinerU Markdown tables remain semantic instead of becoming pipe-delimited prose', () => {
  const blocks = pdf.markdownToPdfBlocks([
    '| Group | Mean |',
    '| --- | ---: |',
    '| Control | 1.0 |',
    '| Treatment | 2.4 |'
  ].join('\n'));
  assert.deepEqual(blocks, [{
    type: 'table',
    header: ['Group', 'Mean'],
    rows: [['Control', '1.0'], ['Treatment', '2.4']]
  }]);
});

test('MinerU HTML tables become semantic table blocks instead of visible markup', () => {
  const blocks = pdf.markdownToPdfBlocks([
    'Before the table.',
    '<table><tr><th>Group</th><th>Mean</th></tr><tr><td>Control</td><td>1.0</td></tr></table>',
    'After the table.'
  ].join('\n'));
  assert.deepEqual(blocks, [
    { type: 'paragraph', text: 'Before the table.' },
    { type: 'table', header: ['Group', 'Mean'], rows: [['Control', '1.0']] },
    { type: 'paragraph', text: 'After the table.' }
  ]);
});

test('PDF cleanup removes spaced publisher banners and nests outcome subheadings', () => {
  const normalized = pdf.cleanPdfReflowBlocks(pdf.normalizePdfDocumentBlocks([
    { type: 'heading', level: 1, text: 'A randomized trial' },
    { type: 'paragraph', text: 'O R I G I N A L A R T I C L E' },
    { type: 'heading', level: 2, text: 'Methods' },
    { type: 'heading', level: 2, text: 'Outcomes' },
    { type: 'heading', level: 2, text: 'Primary End Point' },
    { type: 'heading', level: 2, text: 'Statistical Analysis' },
    { type: 'heading', level: 2, text: 'Missing Data' },
    { type: 'heading', level: 2, text: 'REFERENCES AND NOTES' }
  ]));
  assert.equal(normalized.some(block => /O R I G I N A L/.test(block.text || '')), false);
  assert.deepEqual(normalized.filter(block => block.type === 'heading').map(block => [
    block.text, block.level
  ]), [
    ['A randomized trial', 1], ['Methods', 2], ['Outcomes', 3],
    ['Primary End Point', 4], ['Statistical Analysis', 3], ['Missing Data', 4],
    ['REFERENCES AND NOTES', 2]
  ]);
});

test('MinerU Figure captions pair with images before or after multi-column text', () => {
  const blocks = pdf.markdownToPdfBlocks([
    'Fig. 1 | Caption emitted before its image.',
    '',
    'Intervening column text one.',
    '',
    'Intervening column text two.',
    '',
    '![](images/figure_1.png)',
    '',
    '![](images/figure_2.png)',
    '',
    'Intervening column text three.',
    '',
    'Figure 2. Caption emitted after its image.'
  ].join('\n'));
  const pairs = pdf.associatePdfFigureCaptions(blocks);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs.map(pair => pair.caption), [
    'Fig. 1 | Caption emitted before its image.',
    'Figure 2. Caption emitted after its image.'
  ]);
  assert.ok(pairs[0].captionIndex < pairs[0].imageIndex);
  assert.ok(pairs[1].captionIndex > pairs[1].imageIndex);
});

test('all supplemental Figure headings pair with their images', () => {
  const markdown = [];
  for (let number = 1; number <= 14; number += 1) {
    markdown.push(
      `![](images/figure_s${number}.png)`,
      '',
      `## Figure S${number}. Supplemental result ${number}`,
      '',
      `(A) Evidence for supplemental Figure S${number}.`,
      ''
    );
  }
  const blocks = pdf.markdownToPdfBlocks(markdown.join('\n'));
  const pairs = pdf.associatePdfFigureCaptions(blocks);
  assert.equal(pairs.length, 14);
  assert.deepEqual(
    pairs.map(pair => pair.caption.match(/Figure\s+(S\d+)/i)?.[1]),
    Array.from({ length: 14 }, (_, index) => `S${index + 1}`)
  );
  assert.ok(pairs.every(pair => blocks[pair.captionIndex].type === 'heading'));
});

test('supplemental Figure semantic captions include explicit Panel ranges', () => {
  const blocks = pdf.markdownToPdfBlocks([
    '![](images/figure_s1.png)',
    '',
    '## Figure S1. Architectural overview, related to Figure 1',
    '',
    '(A) Experimental sequence.',
    '',
    '(B-D) Drawings and 3-D renderings.',
    '',
    'The next body paragraph must not be absorbed into the Figure legend.'
  ].join('\n'));
  const captions = pdf.buildPdfFigureSemanticCaptions(
    blocks,
    pdf.associatePdfFigureCaptions(blocks)
  );
  assert.equal(captions.length, 1);
  assert.match(captions[0].caption, /\(A\) Experimental sequence/);
  assert.match(captions[0].caption, /\(B-D\) Drawings/);
  assert.doesNotMatch(captions[0].caption, /next body paragraph/);
  const figure = require('../core/figure-extractor.js');
  assert.deepEqual(figure.extractPanelHints(captions[0].caption), ['A', 'B', 'C', 'D']);
});

test('MinerU Panel image fragments are grouped into one semantic Figure', () => {
  const blocks = pdf.markdownToPdfBlocks([
    '## Results',
    '',
    '![](images/figure_1_a.png)',
    '',
    '![](images/figure_1_b.png)',
    '',
    '![](images/figure_1_c.png)',
    '',
    'Figure 1. One complete experiment.',
    '',
    '(A-C) Three complementary readouts.',
    '',
    'Body text between Figures.',
    '',
    '![](images/figure_2_a.png)',
    '',
    '![](images/figure_2_b.png)',
    '',
    'Figure 2. A second complete experiment.'
  ].join('\n'));
  const captions = pdf.buildPdfFigureSemanticCaptions(
    blocks,
    pdf.associatePdfFigureCaptions(blocks)
  );
  const groups = pdf.buildPdfFigureGroups(blocks, captions);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => group.imageIndices.length), [3, 2]);
  assert.match(groups[0].caption, /\(A-C\)/);
  assert.ok(groups.every(group => group.consumedBlockIndices.includes(group.captionIndex)));
});

test('flat MinerU section labels are promoted into a stable heading hierarchy', () => {
  const normalized = pdf.normalizePdfDocumentBlocks(pdf.markdownToPdfBlocks([
    '# A paper title',
    '',
    'Abstract',
    '',
    'Summary text.',
    '',
    'Results',
    '',
    'Study design',
    '',
    'Detailed result text.'
  ].join('\n')));
  assert.deepEqual(
    normalized.filter(block => block.type === 'heading').map(block => [block.text, block.level]),
    [['A paper title', 1], ['Abstract', 2], ['Results', 2], ['Study design', 3]]
  );
});

test('PDF reflow removes fragmented Figure labels and duplicate front matter', () => {
  const blocks = pdf.cleanPdfReflowBlocks(pdf.normalizePdfDocumentBlocks(
    pdf.markdownToPdfBlocks([
      '# A paper title',
      '',
      '## Graphical abstract',
      '',
      '![](images/graphical.jpg)',
      '',
      '## Authors',
      '',
      'First Author, Second Author',
      '',
      '## Correspondence',
      '',
      'author@example.org',
      '',
      '## Highlights',
      '',
      'A useful finding.',
      '',
      '# A paper title',
      '',
      'First Author, Second Author',
      '',
      '¹ Department of Neuroscience',
      '',
      '## SUMMARY',
      '',
      'Summary body.',
      '',
      'B',
      '',
      'C E F',
      '',
      '## STAR鈽匨ETHODS',
      '',
      'Method body.'
    ].join('\n'))
  ));
  const text = blocks.map(block => block.text || '').join('\n');
  assert.doesNotMatch(text, /Graphical abstract|First Author|Department of Neuroscience/);
  assert.doesNotMatch(text, /(?:^|\n)[BCEF](?:\s+[BCEF])*(?:\n|$)/);
  assert.match(text, /Highlights[\s\S]*A useful finding/);
  assert.match(text, /SUMMARY[\s\S]*Summary body/);
  assert.equal(blocks.filter(block => block.type === 'heading' &&
    block.text === 'A paper title').length, 1);
});

test('canonical paper sections remain level two and Results titles become subsections', () => {
  const normalized = pdf.normalizePdfDocumentBlocks(pdf.markdownToPdfBlocks([
    '# Paper title',
    '',
    '## SUMMARY',
    '',
    'Summary body.',
    '',
    '## RESULTS',
    '',
    '## First experiment',
    '',
      'Result body.',
      '',
      '## DISCUSSION',
      '',
      '## STAR☆METHODS'
  ].join('\n')));
  assert.deepEqual(
    normalized.filter(block => block.type === 'heading')
      .map(block => [block.text, block.level]),
    [
      ['Paper title', 1], ['SUMMARY', 2], ['RESULTS', 2],
      ['First experiment', 3], ['DISCUSSION', 2], ['STAR METHODS', 2]
    ]
  );
});

test('STAR Methods outline uses the journal method index to recover nested levels', () => {
  const blocks = pdf.markdownToPdfBlocks([
    '# Paper title',
    '',
    '## STAR METHODS',
    '',
    '- METHOD DETAILS',
    '  - In vivo two-photon (2P) imaging',
    '  - Astrocytic morphology analyses',
    '  - Behavioral tests',
    '',
    '## STAR METHODS',
    '',
    '## METHOD DETAILS',
    '',
    '## In vivo two-photon (2P) imaging',
    '',
    '## Cranial window surgery',
    '',
    'Surgery body.',
    '',
    '## 2P microscope',
    '',
    'Microscope body.',
    '',
    '## Astrocytic morphology analyses',
    '',
    'Morphology body.',
    '',
    '## Behavioral tests',
    '',
    'Sucrose preference test (SPT) The procedure used two bottles.'
  ].join('\n'));
  assert.equal(blocks.find(block => block.type === 'list')?.items?.[1]?.depth, 1);
  const normalized = pdf.normalizePdfDocumentBlocks(blocks);
  assert.deepEqual(
    normalized.filter(block => block.type === 'heading')
      .slice(-8).map(block => [block.text, block.level]),
    [
      ['STAR METHODS', 2], ['METHOD DETAILS', 3],
      ['In vivo two-photon (2P) imaging', 4], ['Cranial window surgery', 5],
      ['2P microscope', 5], ['Astrocytic morphology analyses', 4],
      ['Behavioral tests', 4], ['Sucrose preference test (SPT)', 5]
    ]
  );
  assert.ok(normalized.some(block => block.type === 'paragraph' &&
    block.text === 'The procedure used two bottles.'));
});

test('ordered supplemental figures remain paired across long MinerU page text', () => {
  const longText = Array.from(
    { length: 24 },
    (_, index) => `Panel description ${index + 1}.`
  );
  const blocks = pdf.markdownToPdfBlocks([
    '![](images/figure_s1.png)',
    '',
    ...longText.flatMap(line => [line, '']),
    '## Figure S1. A distant caption',
    '',
    '![](images/figure_s2.png)',
    '',
    '## Figure S2. A nearby caption'
  ].join('\n'));
  const pairs = pdf.associatePdfFigureCaptions(blocks);
  assert.equal(pairs.length, 2);
  assert.match(pairs[0].caption, /^Figure S1/);
  assert.match(pairs[1].caption, /^Figure S2/);
});

test('numbered publisher headings become a stable scientific outline without changing visible text', () => {
  const normalized = pdf.normalizePdfDocumentBlocks(pdf.markdownToPdfBlocks([
    '# Publisher paper title',
    '',
    '## 1. Introduction',
    '',
    'Opening text.',
    '',
    '## 2. Materials and methods',
    '',
    '## 2.1. Animals',
    '',
    'Animal details.',
    '',
    '## 2.2.1 Image acquisition',
    '',
    'Acquisition details.',
    '',
    '## 3. Results and Discussion',
    '',
    '## 3.1 Main finding',
    '',
    'Finding details.',
    '',
    '## 4. Conclusions and outlook',
    '',
    'Conclusion text.',
    '',
    '## References'
  ].join('\n')));
  assert.deepEqual(
    normalized.filter(block => block.type === 'heading')
      .map(block => [block.text, block.level]),
    [
      ['Publisher paper title', 1],
      ['1. Introduction', 2],
      ['2. Materials and methods', 2],
      ['2.1. Animals', 3],
      ['2.2.1 Image acquisition', 4],
      ['3. Results and Discussion', 2],
      ['3.1 Main finding', 3],
      ['4. Conclusions and outlook', 2],
      ['References', 2]
    ]
  );
  assert.equal(pdf.stripPdfHeadingNumbering('3.2.1 Imaging analysis'), 'Imaging analysis');
  assert.equal(pdf.pdfHeadingNumberDepth('3.2.1 Imaging analysis'), 3);
  assert.equal(pdf.isPdfMajorSectionTitle('IV. Discussion and Conclusions'), true);
});

test('review PDFs discard access banners and preserve custom numbered or unnumbered top-level sections', () => {
  const numbered = pdf.normalizePdfDocumentBlocks(pdf.markdownToPdfBlocks([
    '# OPEN ACCESS', '# COPYRIGHT', '# Review title', '# KEYWORDS',
    '## 1 First topic', '## 1.1 First detail', '## 1.1.1 Deep detail',
    '## 2 Second topic', '## 2.1 Second detail', '## 3 Discussion'
  ].join('\n\n')));
  assert.deepEqual(
    numbered.filter(block => block.type === 'heading').map(block => [block.text, block.level]),
    [
      ['Review title', 1], ['1 First topic', 2], ['1.1 First detail', 3],
      ['1.1.1 Deep detail', 4], ['2 Second topic', 2],
      ['2.1 Second detail', 3], ['3 Discussion', 2]
    ]
  );

  const unnumbered = pdf.normalizePdfDocumentBlocks(pdf.markdownToPdfBlocks([
    '# Review title', '## Introduction', 'Introductory text.',
    '## Neural mechanisms', 'Mechanism text.',
    '## Clinical interventions', 'Clinical text.',
    '## Future prospects', 'Future text.', '## References'
  ].join('\n\n')));
  assert.deepEqual(
    unnumbered.filter(block => block.type === 'heading').map(block => [block.text, block.level]),
    [
      ['Review title', 1], ['Introduction', 2], ['Neural mechanisms', 2],
      ['Clinical interventions', 2], ['Future prospects', 2], ['References', 2]
    ]
  );
});

test('duplicate paper titles do not erase an unnumbered review outline', () => {
  const blocks = pdf.cleanPdfReflowBlocks(pdf.normalizePdfDocumentBlocks(
    pdf.markdownToPdfBlocks([
      '# A concise review title',
      '',
      '# A concise review title',
      '',
      '## First biological theme',
      '',
      'Theme body.',
      '',
      '## Second biological theme',
      '',
      'Second body.'
    ].join('\n'))
  ));
  assert.deepEqual(
    blocks.filter(block => block.type === 'heading').map(block => [block.text, block.level]),
    [
      ['A concise review title', 1],
      ['First biological theme', 2],
      ['Second biological theme', 2]
    ]
  );
});

test('journal mastheads and running page headers are excluded from the paper outline', () => {
  const blocks = pdf.cleanPdfReflowBlocks(pdf.normalizePdfDocumentBlocks(
    pdf.markdownToPdfBlocks([
      '# Cell Metabolism',
      '',
      '# Targeted metabolic therapy with a bacterial nanodrug biohybrid',
      '',
      '## Abstract:',
      '',
      'Summary body.',
      '',
      '## Cell Metabolism Article',
      '',
      '## Results:',
      '',
      '## Main experiment',
      '',
      'Result body.',
      '',
      '# Targeted metabolic therapy with a bacterial nanodrug biohybrid',
      '',
      '## Discussion:'
    ].join('\n'))
  ));
  assert.deepEqual(
    blocks.filter(block => block.type === 'heading').map(block => [block.text, block.level]),
    [
      ['Targeted metabolic therapy with a bacterial nanodrug biohybrid', 1],
      ['Abstract:', 2], ['Results:', 2], ['Main experiment', 3], ['Discussion:', 2]
    ]
  );
  assert.equal(pdf.isPdfMajorSectionTitle('Results:'), true);
});

test('a journal H2 before the real H1 cannot replace the paper title', () => {
  const blocks = pdf.cleanPdfReflowBlocks(
    pdf.normalizePdfDocumentBlocks([
      { type: 'heading', level: 2, text: 'Neuron' },
      { type: 'heading', level: 1, text: 'Selective astrocytic signaling controls clearance' },
      { type: 'heading', level: 2, text: 'Highlights' },
      { type: 'paragraph', text: 'A concise highlight.' },
      { type: 'heading', level: 1, text: 'Selective astrocytic signaling controls clearance' },
      { type: 'heading', level: 2, text: 'SUMMARY' }
    ])
  );
  const headings = blocks.filter(block => block.type === 'heading');

  assert.equal(headings[0].level, 1);
  assert.equal(headings[0].text, 'Selective astrocytic signaling controls clearance');
  assert.equal(headings.filter(block => block.level === 1).length, 1);
});

test('Figure captions remain readable paragraphs but never pollute the PDF outline', () => {
  const blocks = pdf.normalizePdfDocumentBlocks([
    { type: 'heading', level: 1, text: 'Paper title' },
    { type: 'heading', level: 2, text: 'RESULTS' },
    { type: 'heading', level: 2, text: 'Figure 1. Complete experimental workflow' },
    { type: 'paragraph', text: 'The result text continues.' }
  ]);
  const caption = blocks.find(block => /^Figure 1\./.test(block.text));

  assert.equal(caption.type, 'paragraph');
  assert.equal(blocks.some(block => block.type === 'heading' && /^Figure 1\./.test(block.text)), false);
});

test('Table captions remain readable paragraphs but never pollute the PDF outline', () => {
  const blocks = pdf.normalizePdfDocumentBlocks([
    { type: 'heading', level: 1, text: 'Paper title' },
    { type: 'heading', level: 2, text: 'RESULTS' },
    { type: 'heading', level: 3, text: 'Table S1. Complete cohort characteristics' }
  ]);
  const caption = blocks.find(block => /^Table S1\./.test(block.text));

  assert.equal(caption.type, 'paragraph');
  assert.equal(pdf.isPdfTableCaptionText(caption.text), true);
});

test('duplicated MinerU heading glyph runs collapse and hierarchy jumps are clamped', () => {
  const blocks = pdf.cleanPdfReflowBlocks(pdf.normalizePdfDocumentBlocks([
    { type: 'heading', level: 1, text: 'Paper title' },
    { type: 'heading', level: 2, text: '2. Materials and Methods 2. Materials and Methods' },
    { type: 'heading', level: 4, text: '2.1.1 Image analysis' }
  ]));
  const headings = blocks.filter(block => block.type === 'heading');

  assert.equal(headings[1].text, '2. Materials and Methods');
  assert.equal(headings[2].level, headings[1].level + 1);
});

test('partially duplicated numbered headings are repaired without losing the complete copy', () => {
  const blocks = pdf.cleanPdfReflowBlocks(pdf.normalizePdfDocumentBlocks([
    { type: 'heading', level: 1, text: 'Paper title' },
    { type: 'heading', level: 2, text: 'RESULTS' },
    { type: 'heading', level: 3, text: '3.3. Oxygen Consumption in Superna-3.3. Oxygen Consumption in Supernatants tants' }
  ]));

  assert.equal(blocks.at(-1).text, '3.3. Oxygen Consumption in Supernatants');
});

test('long paper titles ending in review are not mistaken for page banners', () => {
  const blocks = pdf.cleanPdfReflowBlocks(pdf.normalizePdfDocumentBlocks([
    { type: 'heading', level: 1, text: 'Lactylation modification in cardio-cerebral diseases: A state-of-the-art review' },
    { type: 'heading', level: 2, text: 'A B S T R A C T' },
    { type: 'heading', level: 2, text: '1. Introduction' }
  ]));

  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[0].text, 'Lactylation modification in cardio-cerebral diseases: A state-of-the-art review');
});

test('publisher update overlays are removed from otherwise valid headings', () => {
  const blocks = pdf.cleanPdfReflowBlocks(pdf.normalizePdfDocumentBlocks([
    { type: 'heading', level: 1, text: 'A phase Ib trial Checkfor updates protocol' },
    { type: 'heading', level: 2, text: 'INTRODUCTION' }
  ]));

  assert.equal(blocks[0].text, 'A phase Ib trial protocol');
});

test('URL-only MinerU headings are treated as running page furniture', () => {
  const blocks = pdf.cleanPdfReflowBlocks(pdf.normalizePdfDocumentBlocks([
    { type: 'heading', level: 1, text: 'Paper title' },
    { type: 'heading', level: 2, text: 'https://example.org/journal/article/42' },
    { type: 'heading', level: 2, text: 'RESULTS' }
  ]));

  assert.deepEqual(
    blocks.filter(block => block.type === 'heading').map(block => block.text),
    ['Paper title', 'RESULTS']
  );
});

test('front-matter Lead contact text is not promoted before Resource availability', () => {
  const blocks = pdf.normalizePdfDocumentBlocks([
    { type: 'heading', level: 1, text: 'Paper title' },
    { type: 'paragraph', text: 'Lead contact' },
    { type: 'paragraph', text: 'Corresponding author details.' },
    { type: 'heading', level: 2, text: 'RESOURCE AVAILABILITY' },
    { type: 'paragraph', text: 'Lead contact' },
    { type: 'paragraph', text: 'Requests should be directed to the lead contact.' }
  ]);
  const leadHeadings = blocks.filter(block =>
    block.type === 'heading' && block.text === 'Lead contact');

  assert.equal(leadHeadings.length, 1);
  assert.equal(leadHeadings[0].level, 3);
});

test('repeated page banners are removed and wrapped headings are joined', () => {
  const blocks = pdf.cleanPdfReflowBlocks(pdf.normalizePdfDocumentBlocks(
    pdf.markdownToPdfBlocks([
      '# Paper title about targeted therapy',
      '## ACCEPTED MANUSCRIPT',
      '## Introduction',
      'Opening body.',
      '## ACCEPTED MANUSCRIPT',
      '## Results',
      '## Evaluation of therapeutic effects of',
      '## engineered bacteria in vivo',
      'Result body.',
      '## ACCEPTED MANUSCRIPT',
      '## Discussion'
    ].join('\n\n'))
  ));
  assert.deepEqual(
    blocks.filter(block => block.type === 'heading').map(block => [block.text, block.level]),
    [
      ['Paper title about targeted therapy', 1],
      ['Introduction', 2], ['Results', 2],
      ['Evaluation of therapeutic effects of engineered bacteria in vivo', 3],
      ['Discussion', 2]
    ]
  );
});

test('MinerU usage estimates reset daily, deduplicate tasks, and normalize official quota', () => {
  const day = '2026-07-31';
  const first = pdf.recordMineruUsage({}, { day, taskId: 'task-1', pages: 42 });
  assert.deepEqual(first, { day, pagesUsed: 42, taskIds: ['task-1'] });
  assert.deepEqual(
    pdf.recordMineruUsage(first, { day, taskId: 'task-1', pages: 42 }),
    first
  );
  assert.deepEqual(
    pdf.normalizeMineruUsageLedger(first, '2026-08-01'),
    { day: '2026-08-01', pagesUsed: 0, taskIds: [] }
  );
  assert.deepEqual(
    pdf.normalizeMineruQuotaData({ user_left_quota: 975, total_left_quota: 1800 }),
    { userLeftQuota: 975, totalLeftQuota: 1800 }
  );
  assert.equal(pdf.hasPdfByteSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), true);
  assert.equal(pdf.hasPdfByteSignature(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c])), false);
});

test('PDF activation auto-parses the open tab while MinerU settings live with model APIs', () => {
  const html = read('pdf-reader.html');
  const reader = read('pdf-reader.js');
  const readerCss = read('pdf-reader.css');
  const background = read('background.js');
  const popup = read('popup.js');
  const options = read('options.html');
  const optionsScript = read('options.js');
  const manifest = JSON.parse(read('manifest.json'));
  const build = read('scripts/build-unpacked-extension.ps1');
  assert.doesNotMatch(html, /id="pdfMineruMode"/);
  assert.doesNotMatch(html, /id="pdfMineruToken"/);
  assert.match(options, /id="pdfMineruSettings"/);
  assert.match(options, /id="pdfMineruMode"/);
  assert.match(options, /id="pdfMineruToken"/);
  assert.match(optionsScript, /function savePdfMineruSettings/);
  assert.match(optionsScript, /PDF_MINERU_SETTINGS_KEY/);
  assert.match(html, /core\/article-extractor\.js/);
  assert.match(html, /core\/figure-extractor\.js/);
  assert.match(html, /content\.js/);
  assert.match(reader, /PDF_MINERU_AGENT_BASE/);
  assert.match(reader, /PDF_MINERU_PRECISE_BASE/);
  assert.match(reader, /PDF_WORKSPACE_READY/);
  assert.match(reader, /extractZipEntries/);
  assert.match(reader, /associatePdfFigureCaptions/);
  assert.match(reader, /function loadOpenedLocalPdf/);
  assert.match(reader, /new XMLHttpRequest\(\)/);
  assert.match(reader, /async function uploadLocalFile\(/);
  assert.match(reader, /async function uploadPdfSource\(/);
  assert.match(reader, /PDF_BROWSER_SESSION_UPLOAD/);
  assert.match(reader, /canRelayBrowserSessionSource/);
  assert.match(reader, /updateMineruQuotaStatus/);
  assert.match(reader, /MinerU 高优先级页额度估算/);
  assert.match(reader, /setReaderView/);
  assert.match(reader, /返回解析结果/);
  assert.match(reader, /state\.localFile\.arrayBuffer\(\)/);
  assert.match(reader, /method:\s*'PUT',[\s\S]*body:\s*bytes/);
  assert.doesNotMatch(reader, /method:\s*'PUT',[\s\S]{0,120}body:\s*state\.localFile/);
  assert.match(reader, /void runParse\(\)/);
  assert.match(
    readerCss,
    /\.pdf-reader-button\[hidden\],[\s\S]*\.pdf-reader-link\[hidden\][\s\S]*display:\s*none/
  );
  assert.match(html, /id="pdfReaderViewToggle"/);
  assert.match(html, /id="pdfReaderReparse"/);
  assert.match(html, /id="pdfReaderReturnToArticle"/);
  assert.match(reader, /function returnToParentArticle\(/);
  assert.match(reader, /function syncParsedSupplementalInventory\(/);
  assert.match(reader, /syncParsedSupplementalInventoryToParent/);
  assert.match(reader, /chrome\.tabs\.update\(parentTabId, \{ active: true \}\)/);
  assert.match(reader, /parentCanonicalUrl/);
  assert.match(html, /id="pdfOriginalFrame"/);
  assert.match(html, /id="pdfMineruQuotaStatus"/);
  assert.match(options, /id="returnToPdfReader"/);
  assert.match(optionsScript, /function returnToPdfReader/);
  assert.match(read('content.js'), /function effectiveArticlePageUrl\(/);
  assert.match(read('content.js'), /sourceReaderTabId/);
  assert.match(read('content.js'), /sourceReaderUrl/);
  assert.match(read('content.js'), /function syncParsedSupplementalInventoryToParent\(/);
  assert.match(popup, /runExternalSupplementalFigureAnalysis/);
  assert.match(popup, /请先手动下载补充材料，再选择本地 PDF/);
  assert.match(popup, /下载后选择 PDF/);
  assert.match(popup, /chrome\.tabs\.update\(currentTabId, \{ url: readerUrl, active: true \}\)/);
  assert.match(reader, /请选择已经下载到本机的补充 PDF/);
  assert.match(reader, /Brevess 不再尝试自动下载或代传期刊附件/);
  assert.match(reader, /if \(supplementalPdfBinding\) return;/);
  assert.match(reader, /restoreCachedPdfDocument/);
  assert.match(reader, /getWorkspaceAssetCheckpoint\('pdf\/document\.json'\)/);
  assert.match(reader, /cachedImageByReference/);
  assert.match(reader, /dataset\.panel = panelHints\[imageOrdinal\]/);
  assert.match(read('content.js'), /request\.action === 'getPdfWorkspaceState'/);
  assert.match(read('content.js'), /readerUrl:\s*location\.href/);
  assert.match(background, /activatePdfReaderAndOpenSidePanel/);
  assert.match(background, /SIDE_PANEL_ACTIVATE_CURRENT_TAB/);
  assert.match(background, /PDF_BROWSER_SESSION_UPLOAD/);
  assert.match(background, /world:\s*'ISOLATED'/);
  assert.match(background, /credentials:\s*'include'/);
  assert.match(background, /PDF_RELAY_NOT_PDF/);
  assert.match(background, /state\?\.readerUrl/);
  assert.match(background, /isLikelyPdfUrl/);
  assert.match(popup, /action:\s*'getPdfWorkspaceState'/);
  assert.match(popup, /readTabActivation\(\s*chrome\.storage\.session/);
  assert.match(popup, /pdfWorkspace\.pdfMode !== true/);
  assert.match(popup, /pdfMode:\s*activePanelTabContext\.pdfMode === true/);
  assert.match(popup, /panelContext\.pdfMode !== true/);
  assert.match(
    popup,
    /changeInfo\.status === 'complete'[\s\S]*tabId === activePanelTabContext\.tabId/
  );
  assert.doesNotMatch(popup, /PDF 模式暂不支持高亮/);
  assert.doesNotMatch(popup, /PDF 模式暂不提供原页高亮/);
  assert.match(popup, /全文问答和图解现在可用/);
  assert.ok(manifest.host_permissions.includes('file:///*'));
  assert.match(build, /'pdf-reader\.html', 'pdf-reader\.js', 'pdf-reader\.css'/);
});

test('PDF workspace persists one shared semantic index and a bounded restorable image cache', () => {
  const content = read('content.js');
  assert.match(content, /schemaVersion:\s*2/);
  assert.match(content, /cachedImageByReference/);
  assert.match(content, /persistWorkspaceAssetCheckpoint\('pdf\/document\.json'/);
  assert.match(content, /document\.documentElement\.dataset\.pdfWorkspaceIndexed = 'true'/);
  assert.match(content, /PDF_WORKSPACE_INDEXED/);
});

test('supplemental PDF parsing persists rendered Markdown and restorable Figure inputs', () => {
  const reader = read('pdf-reader.js');
  const content = read('content.js');
  assert.match(reader, /syncParsedSupplementalInventory\(\{/);
  assert.match(reader, /markdown:\s*String\(parsed\.markdown/);
  assert.match(reader, /restoreCachedSupplementalDocument/);
  assert.match(reader, /ARTICLE_WORKSPACE_GET_ASSET/);
  assert.match(reader, /cachedImageByReference/);
  assert.match(content, /preparePersistedFigureImages/);
  assert.match(content, /analysisImages:/);
  assert.match(content, /parsedDocument:\s*nextParsedDocument/);
});
