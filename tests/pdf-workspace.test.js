const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pdf = require('../core/pdf-workspace.js');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('PDF reader exposes safe annotated-copy UI and keeps overwrite capability handle-only', () => {
  const html = read('pdf-reader.html');
  const script = read('pdf-reader.js');
  const native = read('pdf-native-reader.mjs');
  assert.match(html, /id="pdfReaderSaveAnnotated"[^>]*>\s*\u4fdd\u5b58\u5e26\u6279\u6ce8\u526f\u672c/);
  assert.match(html, /id="pdfReaderOverwriteAnnotated"/);
  assert.match(html, /id="pdfReaderSaveStatus"[^>]*role="status"/);
  assert.match(html, /core\/pdf-save-policy\.js/);
  assert.match(script, /showOpenFilePicker/);
  assert.match(script, /localFileHandle/);
  assert.match(script, /saveAnnotatedPdfCopy/);
  assert.match(script, /overwriteAnnotatedPdf/);
  assert.match(script, /saving|verified|source_changed|failed/);
  assert.match(native, /verifySavedPdfAnnotations/);
  assert.match(native, /createPdfSaveExportContext/);
  assert.match(native, /pdfSaveContextMatches/);
  assert.match(native, /sourceHash:\s*loadedSourceHash/);
  assert.match(native, /adoptSavedSourceHash/);
  const verifyStart = native.indexOf('async function verifyAnnotatedPdf');
  assert.ok(verifyStart >= 0, 'verifyAnnotatedPdf function must exist');
  const nextFunction = /\r?\n\r?\nfunction /.exec(native.slice(verifyStart + 1));
  assert.ok(nextFunction, 'verifyAnnotatedPdf function must have a following function boundary');
  const verifyEnd = verifyStart + 1 + nextFunction.index;
  const verifyBody = native.slice(verifyStart, verifyEnd);
  assert.match(verifyBody, /pdfSaveContextMatches/);
  assert.doesNotMatch(verifyBody, /isSaveContextCurrent/,
    'post-commit verification must use only the immutable click-time snapshot');
  assert.match(script, /acquireAnnotatedPdfSaveHandle/);
  assert.match(script,
    /function startPdfCopySave[\s\S]{0,1400}await SciLLM\.acquireAnnotatedPdfSaveHandle[\s\S]{0,1400}performPdfSave/);
  assert.match(script,
    /function performPdfSave[\s\S]{0,1000}await capture\.reader\.exportAnnotatedPdf/);
  assert.match(script, /export_verified_download_started/);
  assert.match(script, /verified_snapshot_saved_context_changed/);
  assert.match(script, /assertDistinctPdfCopyTarget/);
  assert.match(script, /copy_target_is_source/);
  const committedBranch = script.indexOf("else if (error?.committed)");
  const sourceChangedBranch = script.indexOf("else if (code === 'source_changed')");
  assert.ok(committedBranch >= 0 && committedBranch < sourceChangedBranch,
    'post-commit failures must be reported before pre-commit source-change failures');
  assert.match(script, /adoptSavedSourceHash\(exported, result\.actualHash\)/);
  assert.match(script, /state\.openedPdfHash\s*=\s*result\.actualHash/);
  assert.doesNotMatch(script, /console\.(?:log|info|debug)\([^)]*(?:pdfBytes|localFile|sourceUrl)/);
});

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

test('original PDF text enhancement preserves settings for a complete native text layer', () => {
  const settings = { mode: 'agent', isOcr: false, language: 'en', enableTable: false };
  const before = structuredClone(settings);
  const plan = pdf.planOriginalPdfTextEnhancement(settings, {
    phase: 'text-ready',
    pageCount: 2,
    structure: {
      pages: [
        { pageNumber: 1, charCount: 840 },
        { pageNumber: 2, charCount: 1260 }
      ],
      paragraphs: [{ text: 'page one' }, { text: 'page two' }]
    }
  });
  assert.deepEqual(settings, before, 'planning must not mutate saved settings');
  assert.equal(plan.requiresCoordinateOcr, false);
  assert.equal(plan.effectiveSettings.mode, 'agent');
  assert.equal(plan.effectiveSettings.isOcr, false);
  assert.equal(plan.blockCode, '');
  assert.equal(plan.preserveOriginalPdf, true);
});

test('original PDF text enhancement routes an all-scan terminal index to precise OCR', () => {
  const plan = pdf.planOriginalPdfTextEnhancement({
    mode: 'agent', isOcr: false, token: 'local-test-token'
  }, {
    phase: 'partial-index',
    pageCount: 4,
    structure: {
      pages: [1, 2, 3, 4].map(pageNumber => ({ pageNumber, charCount: 0 })),
      paragraphs: []
    }
  });
  assert.equal(plan.nativeIndexComplete, true);
  assert.equal(plan.requiresCoordinateOcr, true);
  assert.deepEqual(plan.lowTextPageNumbers, [1, 2, 3, 4]);
  assert.equal(plan.effectiveSettings.mode, 'precise');
  assert.equal(plan.effectiveSettings.isOcr, true);
  assert.equal(plan.blocked, false);
  assert.equal(plan.reason, 'low-text-pages');

  const withoutMetadata = pdf.planOriginalPdfTextEnhancement({
    token: 'local-test-token'
  }, { phase: 'partial-index', pageCount: 4, structure: { paragraphs: [] } });
  assert.equal(withoutMetadata.requiresCoordinateOcr, true);
  assert.equal(withoutMetadata.reason, 'empty-native-index');
});

test('original PDF text enhancement routes a mixed terminal document when one page is sparse', () => {
  const plan = pdf.planOriginalPdfTextEnhancement({
    mode: 'agent', isOcr: false, token: 'local-test-token'
  }, {
    phase: 'text-ready',
    pageCount: 3,
    structure: {
      pages: [
        { pageNumber: 1, charCount: 920 },
        { pageNumber: 2, charCount: 12 },
        { pageNumber: 3, charCount: 740 }
      ],
      paragraphs: [{ text: 'native content is available' }]
    }
  });
  assert.equal(plan.requiresCoordinateOcr, true);
  assert.deepEqual(plan.lowTextPageNumbers, [2]);
  assert.equal(plan.effectiveSettings.mode, 'precise');
  assert.equal(plan.effectiveSettings.isOcr, true);
});

test('original PDF text enhancement ignores a checked blank page but keeps a scan eligible', () => {
  const settings = { mode: 'agent', isOcr: false };
  const blank = pdf.planOriginalPdfTextEnhancement(settings, {
    phase: 'text-ready', pageCount: 2,
    structure: {
      pages: [
        { pageNumber: 1, charCount: 800, textStatus: 'full', ocrCandidate: false },
        { pageNumber: 2, charCount: 0, textStatus: 'empty', ocrCandidate: false }
      ],
      paragraphs: [{ text: 'native content' }]
    }
  });
  assert.equal(blank.requiresCoordinateOcr, false);
  assert.deepEqual(blank.lowTextPageNumbers, []);
  assert.equal(blank.reason, 'native-text-sufficient');

  const scan = pdf.planOriginalPdfTextEnhancement({ ...settings, token: 'test-token' }, {
    phase: 'text-ready', pageCount: 1,
    structure: {
      pages: [
        { pageNumber: 1, charCount: 0, textStatus: 'empty', ocrCandidate: true }
      ],
      paragraphs: []
    }
  });
  assert.equal(scan.requiresCoordinateOcr, true);
  assert.deepEqual(scan.lowTextPageNumbers, [1]);
});

test('original PDF text enhancement does not route before native indexing is terminal', () => {
  const plan = pdf.planOriginalPdfTextEnhancement({ mode: 'agent', isOcr: false }, {
    phase: 'indexing',
    pageCount: 3,
    structure: {
      pages: [{ pageNumber: 1, charCount: 0 }],
      paragraphs: []
    }
  });
  assert.equal(plan.nativeIndexComplete, false);
  assert.equal(plan.requiresCoordinateOcr, false);
  assert.equal(plan.effectiveSettings.mode, 'agent');
  assert.equal(plan.effectiveSettings.isOcr, false);
  assert.equal(plan.blocked, false);
  assert.equal(plan.reason, 'native-index-incomplete');

  const unknown = pdf.planOriginalPdfTextEnhancement({ mode: 'agent', isOcr: false }, {
    phase: 'partial-index', pageCount: 3
  });
  assert.equal(unknown.requiresCoordinateOcr, false,
    'missing page and paragraph metadata must not be guessed to mean scanned');
});

test('native enhancement completion follows coverage metadata before legacy phase names', () => {
  const incomplete = pdf.planOriginalPdfTextEnhancement({ token: 'local-test-token' }, {
    phase: 'partial-index', pageCount: 3,
    structure: {
      pages: [{ pageNumber: 1, charCount: 0, textStatus: 'empty', ocrCandidate: true }],
      paragraphs: [],
      diagnostics: { textCoverage: {
        totalPages: 3, checkedPages: 1, pendingPages: 2,
        checkedComplete: false, terminal: false
      } }
    }
  });
  assert.equal(incomplete.nativeIndexComplete, false);
  assert.equal(incomplete.requiresCoordinateOcr, false);
  assert.equal(incomplete.reason, 'native-index-incomplete');

  const terminal = pdf.planOriginalPdfTextEnhancement({ token: 'local-test-token' }, {
    phase: 'partial-index', pageCount: 1,
    structure: {
      pages: [{ pageNumber: 1, charCount: 0, textStatus: 'empty', ocrCandidate: true }],
      paragraphs: [],
      diagnostics: { textCoverage: {
        totalPages: 1, checkedPages: 1, pendingPages: 0,
        checkedComplete: true, terminal: true
      } }
    }
  });
  assert.equal(terminal.nativeIndexComplete, true);
  assert.equal(terminal.requiresCoordinateOcr, true);
});

test('original PDF text enhancement blocks a scan when precise OCR has no token', () => {
  const plan = pdf.planOriginalPdfTextEnhancement({ mode: 'agent', isOcr: false }, {
    phase: 'partial-index',
    pageCount: 2,
    structure: { paragraphs: [], diagnostics: { paragraphCount: 0 } }
  });
  assert.equal(plan.requiresCoordinateOcr, true);
  assert.equal(plan.effectiveSettings.mode, 'precise');
  assert.equal(plan.effectiveSettings.isOcr, true);
  assert.equal(plan.blocked, true);
  assert.equal(plan.blockCode, 'PDF_OCR_PRECISE_TOKEN_REQUIRED');
});

test('a manually selected local PDF gets a stable privacy-safe workspace URL', () => {
  const hash = 'A'.repeat(64);
  assert.equal(
    pdf.buildLocalPdfWorkspaceUrl('Focused ultrasound / results.pdf', hash),
    `file:///brevess-local-pdf/${hash.toLowerCase()}/results.pdf`
  );
  assert.equal(pdf.buildLocalPdfWorkspaceUrl('paper.pdf', 'not-a-sha256'), '');
  assert.equal(pdf.buildLocalPdfWorkspaceUrl('', hash), '');
  const initial = 'chrome-extension://test/pdf-reader.html?title=Local&source=stale&source=duplicate';
  const safeSource = pdf.buildLocalPdfWorkspaceUrl('C:\\private\\patient / result.pdf', hash);
  const updated = pdf.withLocalPdfWorkspaceSource(initial, safeSource);
  const parsed = new URL(updated);
  assert.deepEqual(parsed.searchParams.getAll('source'), [safeSource]);
  assert.equal(parsed.searchParams.get('title'), 'Local');
  assert.doesNotMatch(updated, /C%3A|private|patient%20%2F/iu);
  assert.equal(pdf.withLocalPdfWorkspaceSource(initial, 'file:///C:/private/patient.pdf'), '');
  assert.equal(pdf.withLocalPdfWorkspaceSource('chrome-extension://test/options.html', safeSource), '');
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
    { type: 'heading', level: 1, text: 'A mechanism paper', id: 'pdf-block-1' },
    { type: 'heading', level: 2, text: 'Results', id: 'pdf-block-2' },
    {
      type: 'paragraph',
      text: 'The intervention increased the measured outcome.',
      id: 'pdf-block-3'
    },
    { type: 'image', alt: '', source: 'images/figure_1.png', id: 'pdf-block-4' },
    {
      type: 'paragraph',
      text: 'Figure 1. Intervention and quantitative validation.',
      id: 'pdf-block-5'
    }
  ]);
  assert.equal(blocks.at(-1).type, 'list');
  assert.deepEqual(
    blocks.at(-1).items.map(item => item.text),
    ['first evidence', 'second evidence']
  );
});

test('preserves explicit reference ordinals across separately flushed ordered lists', () => {
  const blocks = pdf.markdownToPdfBlocks([
    '## REFERENCES', '', '1. First paper.', '',
    '2. Second paper.', '', '3. Third paper.'
  ].join('\n'));
  assert.deepEqual(
    blocks.filter(block => block.type === 'list')
      .flatMap(block => block.items.map(item => item.ordinal)),
    [1, 2, 3]
  );
});

test('parsed PDF list renderer preserves independent ordinals and ordinary list behavior', () => {
  class FixtureElement {
    constructor(tagName) {
      this.tagName = String(tagName).toUpperCase();
      this.children = [];
      this.attributes = new Map();
      this.textContent = '';
    }
    appendChild(child) { this.children.push(child); return child; }
    set value(value) { this.attributes.set('value', String(value)); }
    get value() { return Number(this.attributes.get('value') || 0); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
  }
  const documentFixture = { createElement: tagName => new FixtureElement(tagName) };
  const appendInline = (element, value) => { element.textContent = String(value || ''); };
  const independent = [1, 2, 3].map(ordinal => pdf.renderPdfListBlock(
    documentFixture,
    { type: 'list', ordered: true, items: [{ text: `Paper ${ordinal}`, ordinal }] },
    appendInline
  ));
  assert.deepEqual(independent.map(list => list.children[0].value), [1, 2, 3]);
  assert.deepEqual(
    independent.map(list => list.children[0].getAttribute('value')),
    ['1', '2', '3']
  );

  const continuous = pdf.renderPdfListBlock(documentFixture, {
    type: 'list', ordered: true,
    items: [{ text: 'First', ordinal: 1 }, { text: 'Second', ordinal: 2 }]
  }, appendInline);
  assert.deepEqual(continuous.children.map(item => item.value), [1, 2]);

  const unordered = pdf.renderPdfListBlock(documentFixture, {
    type: 'list', ordered: false,
    items: [{ text: 'First', ordinal: 4 }, { text: 'Second' }]
  }, appendInline);
  assert.equal(unordered.tagName, 'UL');
  assert.deepEqual(unordered.children.map(item => item.getAttribute('value')), [null, null]);
});

test('ordered-list parser drops zero and overlong ordinals', () => {
  const blocks = pdf.markdownToPdfBlocks([
    '000000. Zero is not a valid HTML list ordinal.', '',
    '1234567. More than six digits is outside the parsing bound.'
  ].join('\n'));
  assert.deepEqual(
    blocks.filter(block => block.type === 'list')
      .flatMap(block => block.items.map(item => item.ordinal)),
    [undefined, undefined]
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
      { type: 'em', text: 'context' },
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
      { type: 'sup', text: '+' },
      { type: 'text', text: ' and H' },
      { type: 'sub', text: '2' },
      { type: 'text', text: 'O  safe ' }
    ]
  );
});

test('real MinerU spaced TeX exposes chemical subscripts and nested legacy overbars', () => {
  const chemical = pdf.markdownInlineTokens('$2 . 5 \\mathsf { C a C l } _ { 2 }$');
  assert.equal(chemical.some(token => token.type === 'sub' && token.text === '2'), true);
  const circuit = pdf.markdownInlineTokens(
    '$\\mathsf { \\bar { V } T A - O F C } ^ { \\mathsf { D } 1 }$'
  );
  assert.equal(circuit.some(token => token.type === 'overline' && token.text === 'V'), true);

  const fixture = String(process.env.PDF_DOPAMINE_MINERU_FIXTURE || '');
  if (fixture && fs.existsSync(fixture)) {
    const markdown = fs.readFileSync(fixture, 'utf8');
    const source = pdf.markdownToPdfBlocks(markdown)
      .map(block => block.markdown || block.text || '').join('\n');
    const tokens = pdf.markdownInlineTokens(source);
    assert.ok(tokens.some(token => token.type === 'sub'));
    assert.ok(tokens.some(token => token.type === 'overline'));
  }
});

test('real MinerU spaced TeX reaches sub and overline DOM nodes', () => {
  const reader = read('pdf-reader.js');
  const start = reader.indexOf('function appendMarkdownInline');
  const end = reader.indexOf('\n  function normalizePdfPageBindingText', start);
  const documentRef = {
    createElement(tagName) {
      return {
        tagName: String(tagName).toUpperCase(), className: '', textContent: '',
        children: [], appendChild(child) { this.children.push(child); return child; }
      };
    },
    createTextNode(textContent) { return { tagName: '#TEXT', textContent }; }
  };
  const appendInline = Function(
    'SciLLM', 'document',
    `'use strict'; ${reader.slice(start, end)}; return appendMarkdownInline;`
  )(pdf, documentRef);
  const target = { children: [], appendChild(child) { this.children.push(child); } };
  appendInline(target, [
    '$2 . 5 \\mathsf { C a C l } _ { 2 }$',
    '$\\mathsf { \\bar { V } T A - O F C } ^ { \\mathsf { D } 1 }$'
  ].join(' '));
  assert.ok(target.children.some(node => node.tagName === 'SUB' && node.textContent === '2'));
  assert.ok(target.children.some(node =>
    node.tagName === 'SPAN' && node.className === 'pdf-inline-overline' && node.textContent === 'V'
  ));
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
      { type: 'sup', text: '2' }
    ]
  );
});

test('renders bounded legacy TeX and emphasis as safe semantic runs', () => {
  const tokens = pdf.markdownInlineTokens(
    '*p* < 0.05; \\bar{VTA-OFC}; {\\tt OFC}^{\\tt D1}; H_{2}O; D2^{+}'
  );
  assert.deepEqual(tokens.map(token => token.type), [
    'em', 'text', 'overline', 'text', 'sup', 'text', 'sub', 'text', 'sup'
  ]);
  assert.deepEqual(tokens.filter(token => token.type === 'overline'), [
    { type: 'overline', text: 'VTA-OFC' }
  ]);
  assert.doesNotMatch(tokens.map(token => token.text).join(''), /\\tt|\\bar|\$|<\/sup>/);
});

test('repairs supplied malformed summary notation without leaking markup', () => {
  const tokens = pdf.markdownInlineTokens(
    'Activation of \\tt O F C \\ttD1 neurons; score 22</sup>; $D2^{+}$.'
  );
  assert.deepEqual(
    tokens.filter(token => token.type === 'sup').map(token => token.text),
    ['+']
  );
  assert.doesNotMatch(
    tokens.map(token => token.text).join(''),
    /\\tt|<\/?sup>|\$/
  );
});

test('scientific tokenizer preserves safe Markdown links and rejects active schemes', () => {
  assert.deepEqual(
    pdf.markdownInlineTokens('*context* [DOI](https://doi.org/10.1/x)'),
    [
      { type: 'em', text: 'context' },
      { type: 'text', text: ' ' },
      { type: 'link', text: 'DOI', href: 'https://doi.org/10.1/x' }
    ]
  );
  const unsafe = pdf.markdownInlineTokens('[open](javascript:alert(1))');
  assert.equal(unsafe.some(token => token.type === 'link'), false);
  assert.equal(unsafe.map(token => token.text).join(''), 'open)');
});

test('scientific tokenizer preserves currency and unmatched dollar signs', () => {
  assert.deepEqual(pdf.markdownInlineTokens('Price is $5 million.'), [
    { type: 'text', text: 'Price is $5 million.' }
  ]);
  assert.deepEqual(pdf.markdownInlineTokens('Unmatched $ stays literal.'), [
    { type: 'text', text: 'Unmatched $ stays literal.' }
  ]);
  assert.deepEqual(pdf.markdownInlineTokens('Price moved from $5 to $10 million.'), [
    { type: 'text', text: 'Price moved from $5 to $10 million.' }
  ]);
  assert.deepEqual(pdf.markdownInlineTokens('$D2^{+}$ cells'), [
    { type: 'text', text: 'D2' },
    { type: 'sup', text: '+' },
    { type: 'text', text: ' cells' }
  ]);
});

test('paired identifier math drops delimiters without treating numeric currency as math', () => {
  assert.deepEqual(pdf.markdownInlineTokens('$D2$ and $x$'), [
    { type: 'text', text: 'D2 and x' }
  ]);
  const formatted = pdf.markdownInlineTokens('$\\mathbf{T}^{\\circ}$');
  assert.equal(formatted.map(token => token.text).join(''), 'T°');
  assert.doesNotMatch(formatted.map(token => token.text).join(''), /\\[A-Za-z]+/);
  ['$5$', '$5 million', '$5 to $10 million', 'unmatched $'].forEach(value => {
    assert.equal(pdf.markdownInlineTokens(value).map(token => token.text).join(''), value);
  });
});

test('paired scientific identifiers accept pure alphanumerics containing a letter', () => {
  assert.deepEqual(pdf.markdownInlineTokens('$OFC$, $NaCl$, $TN$'), [
    { type: 'text', text: 'OFC, NaCl, TN' }
  ]);
  ['$5$', '$5 to $10 million', 'Price is $5 million.'].forEach(value => {
    assert.equal(pdf.markdownInlineTokens(value).map(token => token.text).join(''), value);
  });
});

test('tokenizer entry handles bounded TeX commands and OCR accents without leakage', () => {
  const tokens = pdf.markdownInlineTokens(
    'x = \\frac{1}{2}; \\mathbf{T}^{\\circ}; \\hat{x}; Page\\` s, Bi\\`eche'
  );
  const text = tokens.map(token => token.text).join('');
  assert.equal(text, 'x = 1/2; T°; x̂; Pagès, Bièche');
  assert.doesNotMatch(text, /\\(?:frac|mathbf|circ|hat)/);
  assert.equal(tokens.every(token => [
    'text', 'em', 'strong', 'sup', 'sub', 'overline', 'code', 'link'
  ].includes(token.type)), true);
});

test('oversized and unclosed allowlisted commands degrade to complete readable text', () => {
  const longPayload = 'A'.repeat(121);
  const tokens = pdf.markdownInlineTokens([
    `\\mathbf{${longPayload}}`,
    '\\mathbf{T',
    '\\frac{1}{two',
    '\\mathbf{U; following body remains'
  ].join('; '));
  const text = tokens.map(token => token.text).join('');
  assert.match(text, new RegExp(longPayload));
  assert.match(text, /; T; 1\/two; U; following body remains$/);
  assert.doesNotMatch(text, /\\(?:mathbf|frac)|\{[AUT1]/);
  assert.equal(tokens.every(token => token.type === 'text'), true);
});

test('scientific tokenizer consumes Markdown escapes before formatting delimiters', () => {
  assert.deepEqual(
    pdf.markdownInlineTokens('\\*literal\\* \\_literal\\_ \\`code\\` \\\\path'),
    [{ type: 'text', text: '*literal* _literal_ `code` \\path' }]
  );
});

test('nested emphasis degrades to readable outer semantic text without delimiter leakage', () => {
  assert.deepEqual(pdf.markdownInlineTokens('**outer *inner* tail**'), [
    { type: 'strong', text: 'outer inner tail' }
  ]);
  assert.deepEqual(pdf.markdownInlineTokens('*outer **inner** tail*'), [
    { type: 'em', text: 'outer inner tail' }
  ]);
});

test('oversized and unclosed legacy TeX stays bounded and preserves its payload', () => {
  const longBar = 'V'.repeat(121);
  const longTt = 'T'.repeat(121);
  const longScript = 'S'.repeat(41);
  const tokens = pdf.markdownInlineTokens([
    `\\bar{${longBar}}`,
    `{\\tt ${longTt}}`,
    `D2^{${longScript}}`,
    '\\bar{VTA-OFC',
    '\\bar VTA',
    'H_{two',
    '$D2^{+}'
  ].join('; '));
  const text = tokens.map(token => token.text).join('');
  assert.match(text, new RegExp(longBar));
  assert.match(text, new RegExp(longTt));
  assert.match(text, new RegExp(longScript));
  assert.match(text, /VTA-OFC/);
  assert.match(text, /Htwo/);
  assert.match(text, /\$D2\+/);
  assert.doesNotMatch(text, /\\(?:bar|tt)|<\/?sup>/);
  assert.equal(tokens.some(token => token.type === 'overline' && token.text === longBar), false);
  assert.equal(tokens.some(token => token.type === 'sup' && token.text === longScript), false);
  assert.equal(tokens.some(token => token.type === 'sub' && token.text === 'two'), false);
});

test('PDF reader renders scientific tokens only through textContent DOM nodes', () => {
  const reader = read('pdf-reader.js');
  const css = read('pdf-reader.css');
  const start = reader.indexOf('function appendMarkdownInline');
  const end = reader.indexOf('\n  async function renderParsedDocument', start);
  const renderer = reader.slice(start, end);
  assert.match(renderer, /token\.type === 'em'/);
  assert.match(renderer, /token\.type === 'sup'/);
  assert.match(renderer, /token\.type === 'sub'/);
  assert.match(renderer, /token\.type === 'overline'/);
  assert.match(renderer, /className = 'pdf-inline-overline'/);
  assert.match(renderer, /node\.textContent = token\.text/);
  assert.doesNotMatch(renderer, /innerHTML/);
  assert.match(css, /\.pdf-inline-overline\s*\{[^}]*text-decoration:\s*overline/s);
  assert.match(css, /\.pdf-reader-article\s+(?:em,\s*)?[^}]*sup[^}]*sub[^}]*font-family:\s*inherit/s);
});

test('PDF inline DOM renderer cannot turn hostile markup into an element', () => {
  const reader = read('pdf-reader.js');
  const start = reader.indexOf('function appendMarkdownInline');
  const end = reader.indexOf('\n  async function renderParsedDocument', start);
  const rendererSource = reader.slice(start, end);
  const documentRef = {
    createElement(tagName) {
      return {
        nodeType: 1,
        tagName: String(tagName).toUpperCase(),
        textContent: '',
        appendChild(child) { (this.children ||= []).push(child); }
      };
    },
    createTextNode(textContent) {
      return { nodeType: 3, textContent };
    }
  };
  const appendInline = Function(
    'SciLLM', 'document',
    `'use strict'; ${rendererSource}; return appendMarkdownInline;`
  )(pdf, documentRef);
  const target = { children: [], appendChild(child) { this.children.push(child); } };

  appendInline(target, '<img src=x onerror=alert(1)>safe');

  assert.deepEqual(target.children, [{ nodeType: 3, textContent: ' safe' }]);
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
    rows: [['Control', '1.0'], ['Treatment', '2.4']],
    id: 'pdf-block-1'
  }]);
});

test('MinerU HTML tables become semantic table blocks instead of visible markup', () => {
  const blocks = pdf.markdownToPdfBlocks([
    'Before the table.',
    '<table><tr><th>Group</th><th>Mean</th></tr><tr><td>Control</td><td>1.0</td></tr></table>',
    'After the table.'
  ].join('\n'));
  assert.deepEqual(blocks, [
    { type: 'paragraph', text: 'Before the table.', id: 'pdf-block-1' },
    {
      type: 'table', header: ['Group', 'Mean'],
      rows: [['Control', '1.0']], id: 'pdf-block-2'
    },
    { type: 'paragraph', text: 'After the table.', id: 'pdf-block-3' }
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

test('consumes Figure 7 legend statistical tails without swallowing following body text', () => {
  const blocks = pdf.markdownToPdfBlocks([
    '![Figure 7](images/fig7.png)',
    '',
    'Figure 7. OFC D1+ and D2+ neurons drive distinct effects.',
    '',
    '(A) Design. (B-D) Behavior.',
    '',
    '*p < 0.05, **p < 0.01; t test for (B-D); ANOVA for (G-I). Sample sizes are shown in bars.',
    '',
    'VTA-nucleus accumbens circuits are established in reward processing.',
    '',
    'Brief body conclusion.'
  ].join('\n'));
  const captions = pdf.buildPdfFigureSemanticCaptions(
    blocks,
    pdf.associatePdfFigureCaptions(blocks)
  );

  assert.equal(captions.length, 1);
  assert.match(captions[0].caption, /\(A\) Design/);
  assert.match(captions[0].caption, /ANOVA/);
  assert.ok(captions[0].consumedBlockIds.length >= 2);
  assert.equal(pdf.isPdfCaptionContinuationText('Scale bars, 200 μm.'), true);
  assert.equal(pdf.isPdfCaptionContinuationText('Data are mean ± SEM.'), true);
  assert.equal(pdf.isPdfCaptionContinuationText('Brief body conclusion.'), false);

  const groups = pdf.buildPdfFigureGroups(blocks, captions);
  const statisticalIndex = blocks.findIndex(block => /ANOVA/.test(block.text || ''));
  assert.equal(groups[0].consumedBlockIndices.includes(statisticalIndex), true);

  const normalized = pdf.normalizePdfDocumentBlocks(blocks, captions);
  assert.equal(normalized.some(block => /ANOVA/.test(block.text || '')), false);
  assert.equal(normalized.some(block => block.text?.startsWith('VTA-nucleus')), true);
  assert.equal(normalized.some(block => block.text === 'Brief body conclusion.'), true);
});

test('caption continuation classification accepts escaped statistics but rejects ordinary data prose', () => {
  [
    '\\p < 0.05; ANOVA with Sidak correction.',
    '\\*p < 0.01; two-sided t test.',
    '*p < 0.05.',
    'Values are mean ± SEM.',
    'Error bars show SEM.',
    'P values were adjusted for multiple comparisons.',
    'Data are presented as mean ± SD.',
    'Data were expressed as median and interquartile range.'
  ].forEach(value => assert.equal(
    pdf.isPdfCaptionContinuationText(value), true, value
  ));
  [
    'Data are increasingly available through public repositories.',
    'Data were collected during the follow-up visit.',
    'Values changed after treatment.',
    'Error bars prevented access to the dataset.'
  ].forEach(value => assert.equal(
    pdf.isPdfCaptionContinuationText(value), false, value
  ));
});

test('parsed block ids remain unique through cloning and caption consumption', () => {
  const blocks = pdf.markdownToPdfBlocks([
    '![Figure 7](images/fig7.png)', '',
    'Figure 7. Complete experiment.', '',
    '(A) Design.', '',
    '\\p < 0.05; ANOVA.', '',
    'VTA body prose.'
  ].join('\n'));
  assert.equal(new Set(blocks.map(block => block.id)).size, blocks.length);
  assert.equal(blocks.every(block => /^pdf-block-/.test(block.id)), true);

  const cloned = blocks.map(block => ({ ...block }));
  const captions = pdf.buildPdfFigureSemanticCaptions(
    cloned,
    pdf.associatePdfFigureCaptions(cloned)
  );
  const normalized = pdf.normalizePdfDocumentBlocks(
    blocks.map(block => ({ ...block })),
    captions
  );
  assert.equal(normalized.some(block => /ANOVA/.test(block.text || '')), false);
  assert.equal(normalized.some(block => block.text === 'VTA body prose.'), true);
});

test('duplicate external block ids cannot consume unrelated prose', () => {
  const blocks = [
    { id: 'image', type: 'image', source: 'fig7.png' },
    { id: 'caption', type: 'paragraph', text: 'Figure 7. Experiment.' },
    { id: 'duplicate', type: 'paragraph', text: '(A) Design.' },
    { id: 'duplicate', type: 'paragraph', text: 'VTA body prose remains.' }
  ];
  const captions = pdf.buildPdfFigureSemanticCaptions(
    blocks,
    pdf.associatePdfFigureCaptions(blocks)
  );
  const normalized = pdf.normalizePdfDocumentBlocks(
    blocks.map(block => ({ ...block })), captions
  );
  assert.equal(normalized.some(block => block.text === 'VTA body prose remains.'), true);
});

test('one consumed record removes only one identical external block', () => {
  const repeated = { id: 'duplicate', type: 'paragraph', text: '(A) Design.' };
  const probeBlocks = [repeated];
  const captions = pdf.buildPdfFigureSemanticCaptions(
    [
      { id: 'image', type: 'image', source: 'fig7.png' },
      { id: 'caption', type: 'paragraph', text: 'Figure 7. Experiment.' },
      repeated,
      { id: 'body-stop', type: 'paragraph', text: 'Body stop.' }
    ],
    [{ imageIndex: 0, captionIndex: 1, caption: 'Figure 7. Experiment.' }]
  );
  const normalized = pdf.normalizePdfDocumentBlocks(
    [...probeBlocks, { ...repeated }], captions
  );
  assert.equal(normalized.filter(block => block.text === '(A) Design.').length, 1);
});

test('unique parsed ids consume the intended continuation after true reordering', () => {
  const blocks = pdf.markdownToPdfBlocks([
    '![Figure 7](images/fig7.png)', '',
    'Figure 7. Experiment.', '',
    '(A) Design.', '',
    '\\p < 0.05; ANOVA.', '',
    'VTA body prose.'
  ].join('\n'));
  const captions = pdf.buildPdfFigureSemanticCaptions(
    blocks,
    pdf.associatePdfFigureCaptions(blocks)
  );
  const reordered = [blocks.at(-1), ...blocks.slice(0, -1)].map(block => ({ ...block }));
  const normalized = pdf.normalizePdfDocumentBlocks(reordered, captions);
  assert.equal(normalized.some(block => /ANOVA/.test(block.text || '')), false);
  assert.equal(normalized.some(block => block.text === 'VTA body prose.'), true);
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

test('wrapped headings from different valid PDF pages lose page provenance when merged', () => {
  const cleaned = pdf.cleanPdfReflowBlocks([
    { id: 'a', type: 'heading', level: 3, text: 'Circuit mechanisms of', pageNumber: 4 },
    { id: 'b', type: 'heading', level: 3, text: 'chronic pain', pageNumber: 5 }
  ]);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].text, 'Circuit mechanisms of chronic pain');
  assert.equal(cleaned[0].pageNumber, undefined);
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

test('PDF activation opens the original document and waits for explicit MinerU parsing', async () => {
  const html = read('pdf-reader.html');
  const reader = read('pdf-reader.js');
  const readerCss = read('pdf-reader.css');
  const background = read('background.js');
  const popup = read('popup.js');
  const options = read('options.html');
  const optionsScript = read('options.js');
  const manifest = JSON.parse(read('manifest.json'));
  const build = read('scripts/build-unpacked-extension.ps1');
  const { releaseInventory } = await import('../scripts/release-inventory.mjs');
  const releaseFiles = releaseInventory(path.join(__dirname, '..'), 'browser').map(file => file.path);
  assert.match(build, /Copy-BrevessReleaseFiles/);
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
  assert.match(read('core/pdf-native-reader-state.js'), /返回解析结果/);
  assert.match(reader, /state\.localFile\.arrayBuffer\(\)/);
  assert.match(reader, /method:\s*'PUT',[\s\S]*body:\s*bytes/);
  assert.doesNotMatch(reader, /method:\s*'PUT',[\s\S]{0,120}body:\s*state\.localFile/);
  assert.match(reader, /view:\s*'original'/);
  assert.match(html, /id="pdfReaderStartParse"/);
  assert.match(html, />\s*增强文本识别\s*</);
  assert.match(reader, /const next = 'original'/);
  const initializeStart = reader.indexOf('async function initialize()');
  const initializeEnd = reader.indexOf("document.addEventListener('DOMContentLoaded'", initializeStart);
  const initializeSource = reader.slice(initializeStart, initializeEnd);
  const mainPdfStart = initializeSource.lastIndexOf(
    'if (await restoreCachedPdfDocument()) return;'
  );
  const mainPdfSource = initializeSource.slice(mainPdfStart);
  assert.match(initializeSource, /pdfReaderStartParse[\s\S]*runParse\(\)/);
  assert.match(mainPdfSource, /restoreCachedPdfDocument\(\)/);
  assert.doesNotMatch(mainPdfSource, /void runParse\(\)/);
  assert.match(mainPdfSource, /showUnparsedPdfPrompt\(\)/);
  assert.match(readerCss, /\.pdf-reader-control\[data-state="idle"\]\s*\{[^}]*display:\s*none/s);
  assert.match(read('core/pdf-native-reader-state.js'),
    /control\.hidden\s*=\s*next === 'original' &&[\s\S]*control\.dataset\?\.state === 'idle'/);
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
  assert.match(reader, /if \(supplementalPdfBinding\) \{[\s\S]*headlessSupplementalImport[\s\S]*return;/);
  assert.match(reader, /restoreCachedPdfDocument/);
  assert.match(reader, /getWorkspaceAssetCheckpoint\('pdf\/document\.json'\)/);
  assert.match(reader, /cachedImageByReference/);
  assert.match(reader, /dataset\.panel = panelHints\[imageOrdinal\]/);
  assert.match(read('content.js'), /request\.action === 'getPdfWorkspaceState'/);
  assert.match(read('content.js'), /nativeReadable:/);
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
  assert.match(popup, /function renderNativePdfReadingBaseline\(/);
  assert.match(popup, /pdfWorkspace\?\.nativeReadable/);
  assert.match(popup, /pdfNativeMode:\s*true/);
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
  for (const filename of [
    'pdf-reader.html',
    'pdf-reader.js',
    'pdf-reader-ui.js',
    'pdf-reader-notices.js',
    'pdf-reader.css',
    'pdf-native-reader.mjs'
  ]) {
    assert.ok(releaseFiles.includes(filename), filename);
  }
});

test('PDF view switching is reversible while the native reader boots', () => {
  const reader = read('pdf-reader.js');
  const nativeReader = read('pdf-native-reader.mjs');
  const setViewStart = reader.indexOf("function setReaderView(view = 'original')");
  const setViewEnd = reader.indexOf('function focusOriginalPdfPage', setViewStart);
  const setViewSource = reader.slice(setViewStart, setViewEnd);

  assert.ok(setViewStart >= 0);
  assert.match(setViewSource, /SciLLM\.setPdfReaderViewSurface\(\{/);
  assert.match(setViewSource, /nativeReader:\s*state\.nativeReader/);
  assert.doesNotMatch(setViewSource, /__brevessPdfNativeBooting/);
  assert.doesNotMatch(setViewSource, /frame\.src\s*=/,
    'the fallback iframe must not fetch in parallel with a booting native reader');
  assert.match(nativeReader,
    /catch \(error\)[\s\S]*fallbackTarget[\s\S]*fallbackFrame\.src\s*=\s*fallbackTarget/);
  assert.match(reader,
    /onReady\(api\)[\s\S]*state\.view === 'original'[\s\S]*activate[\s\S]*else[\s\S]*deactivate/,
    'a native reader that finishes booting behind the parsed view must immediately deactivate');
});

test('native zoom clicks accumulate while the PDF module is still booting', () => {
  const reader = read('pdf-reader.js');
  const zoomStart = reader.indexOf('function setReaderZoom(value');
  const zoomEnd = reader.indexOf('function flashJumpTarget', zoomStart);
  const zoomSource = reader.slice(zoomStart, zoomEnd);

  assert.match(zoomSource, /nativeReaderCommand\('zoomBy',\s*delta\)/);
  assert.match(zoomSource, /createPdfNativeBridgeController\(/);
  assert.doesNotMatch(zoomSource, /nativeScale\s*\+\s*delta/);
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
