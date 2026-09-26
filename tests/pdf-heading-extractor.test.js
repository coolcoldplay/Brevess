const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzePdfHeadings, extractPdfHeadings } = require('../core/pdf-heading-extractor.js');

const span = (text, start, options = {}) => ({
  text, start, end: start + text.length,
  fontSize: options.fontSize ?? 10,
  fontName: options.fontName || 'Body',
  bold: options.bold === true,
  rect: options.rect || { left: 60, top: 100, right: 520, bottom: 114 },
  quadPoints: options.quadPoints
});

test('validated native outline targets take precedence over inferred headings', () => {
  const text = '1 Introduction\nBody text explains the study.\n2 Methods\nProcedures follow.';
  const pages = [{ pageNumber: 1, text, spans: [
    span('1 Introduction', 0, { fontSize: 16, bold: true }),
    span('Body text explains the study.', 15, { rect: { left: 60, top: 130, right: 520, bottom: 144 } }),
    span('2 Methods', 45, { fontSize: 15, bold: true, rect: { left: 60, top: 180, right: 180, bottom: 196 } })
  ] }];
  const headings = extractPdfHeadings({ documentHash: 'a'.repeat(64), pages,
    outline: [{ title: '1 Introduction', pageNumber: 1 },
      { title: 'Not present', pageNumber: 1 }] });
  assert.equal(headings.filter(item => item.normalizedText === '1 Introduction').length, 1);
  assert.equal(headings.find(item => item.normalizedText === '1 Introduction').source, 'outline');
  assert.equal(headings.some(item => item.normalizedText === 'Not present'), false);
  assert.equal(headings.some(item => item.normalizedText === '2 Methods'), true);
});

test('outline depth and target coordinate disambiguate duplicate normalized titles', () => {
  const rawTitle = 'A\u030Angström';
  const text = `${rawTitle}\nBody.\n${rawTitle}\nMore body.`;
  const second = text.lastIndexOf(rawTitle);
  const analysis = analyzePdfHeadings({ documentHash: '0'.repeat(64), revision: 7,
    pages: [{ pageNumber: 1, text, pageHeight: 800, spans: [
      span(rawTitle, 0, { fontSize: 16, bold: true,
        rect: { left: 60, top: 80, right: 180, bottom: 96 } }),
      span(rawTitle, second, { fontSize: 16, bold: true,
        rect: { left: 60, top: 420, right: 180, bottom: 436 } })
    ] }], outline: [{ title: 'Ångström', pageNumber: 1, level: 4, targetTop: 422 }] });
  const resolved = analysis.outlineEntries[0];
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.start, second);
  assert.equal(resolved.level, 4);
  const heading = analysis.headings.find(item => item.source === 'outline');
  assert.equal(heading.rawText, rawTitle);
  assert.equal(heading.headingId,
    `pdf-heading:${'0'.repeat(64)}:7:1:${second}:${second + rawTitle.length}`);
});

test('ambiguous same-page outline title without a target is unresolved and not 0.99 confidence', () => {
  const text = 'Results\nBody.\nResults\nMore body.';
  const second = text.lastIndexOf('Results');
  const analysis = analyzePdfHeadings({ documentHash: '1'.repeat(64), revision: 2,
    pages: [{ pageNumber: 1, text, spans: [
      span('Results', 0, { fontSize: 16, bold: true }),
      span('Results', second, { fontSize: 16, bold: true,
        rect: { left: 60, top: 300, right: 140, bottom: 316 } })
    ] }], outline: [{ title: 'Results', pageNumber: 1, level: 2 }] });
  assert.equal(analysis.outlineEntries[0].status, 'unresolved');
  assert.equal(analysis.outlineEntries[0].reason, 'ambiguous-title-without-target');
  assert.equal(analysis.headings.some(item => item.source === 'outline' &&
    item.confidence === 0.99), false);
});

test('null, undefined, and empty outline target coordinates remain absent', () => {
  const text = 'Results\nBody.\nResults\nMore body.';
  const second = text.lastIndexOf('Results');
  for (const targetTop of [null, undefined, '']) {
    const analysis = analyzePdfHeadings({ documentHash: '9'.repeat(64), revision: 2,
      pages: [{ pageNumber: 1, text, spans: [
        span('Results', 0, { fontSize: 16, bold: true,
          rect: { left: 60, top: 80, right: 140, bottom: 96 } }),
        span('Results', second, { fontSize: 16, bold: true,
          rect: { left: 60, top: 300, right: 140, bottom: 316 } })
      ] }], outline: [{ title: 'Results', pageNumber: 1, level: 2, targetTop }] });
    assert.equal(analysis.outlineEntries[0].status, 'unresolved');
    assert.equal(analysis.outlineEntries[0].reason, 'ambiguous-title-without-target');
    assert.equal(analysis.outlineEntries[0].targetTop, null);
  }
});

test('native outline depth overrides numbering-derived inference depth', () => {
  const headings = extractPdfHeadings({ documentHash: '3'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text: '1.1 Nested result', spans: [
      span('1.1 Nested result', 0, { fontSize: 16, bold: true })
    ] }], outline: [{ title: '1.1 Nested result', pageNumber: 1, level: 5 }] });
  assert.equal(headings[0].source, 'outline');
  assert.equal(headings[0].level, 5);
});

test('NFKC outline substring search maps the normalized match back to raw offsets', () => {
  const rawTitle = 'A\u030Angström';
  const text = `Prefix ${rawTitle} suffix`;
  const analysis = analyzePdfHeadings({ documentHash: '4'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text }],
    outline: [{ title: 'Ångström', pageNumber: 1, level: 2 }] });
  const heading = analysis.headings.find(item => item.source === 'outline');
  assert.equal(heading.start, text.indexOf(rawTitle));
  assert.equal(heading.end, text.indexOf(rawTitle) + rawTitle.length);
  assert.equal(heading.rawText, rawTitle);
});

test('outline matching without Intl.Segmenter keeps UTF-16 offsets after supplementary text', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
  Object.defineProperty(Intl, 'Segmenter', { configurable: true, writable: true,
    value: undefined });
  try {
    const rawTitle = 'A\u030Angström';
    const text = `🧪 Prefix ${rawTitle} suffix`;
    const analysis = analyzePdfHeadings({ documentHash: '5'.repeat(64), revision: 1,
      pages: [{ pageNumber: 1, text }],
      outline: [{ title: 'Ångström', pageNumber: 1, level: 2 }] });
    const heading = analysis.headings.find(item => item.source === 'outline');
    assert.equal(heading.start, text.indexOf(rawTitle));
    assert.equal(heading.end, text.indexOf(rawTitle) + rawTitle.length);
  } finally {
    if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
    else delete Intl.Segmenter;
  }
});

test('heading geometry rejects zero-area and reversed coordinates', () => {
  const text = '1 Results\nBody text follows.';
  const headings = extractPdfHeadings({ documentHash: '2'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text, pageWidth: 100, pageHeight: 100, spans: [
      span('1 Results', 0, { fontSize: 16, bold: true,
        rect: { left: 40, top: 20, right: 10, bottom: 10 } }),
      span('Body text follows.', 10)
    ] }]
  });
  assert.equal(headings[0].geometry.kind, 'page-range-fallback');
});

test('inferred headings combine numbering, typography, spacing, and adjacent body evidence', () => {
  const text = '3.2 Signal analysis\nMeasurements were normalized across experiments.';
  const headings = extractPdfHeadings({ documentHash: 'b'.repeat(64), pages: [{
    pageNumber: 4, text, spans: [
      span('3.2 Signal analysis', 0, { fontSize: 15, bold: true,
        rect: { left: 60, top: 220, right: 250, bottom: 238 } }),
      span('Measurements were normalized across experiments.', 20,
        { rect: { left: 60, top: 265, right: 520, bottom: 279 } })
    ]
  }] });
  assert.equal(headings.length, 1);
  assert.equal(headings[0].level, 3);
  assert.ok(headings[0].confidence >= 0.7);
  assert.deepEqual(headings[0].range, { pageNumber: 4, start: 0, end: 19 });
  assert.equal(headings[0].correction.allowed, true);
});

test('repeated top and bottom running furniture is excluded', () => {
  const pages = [1, 2, 3].map(pageNumber => ({
    pageNumber,
    text: `Journal Header\n${pageNumber} Results\nBody text on page ${pageNumber}.\n${pageNumber} of 3`,
    spans: [
      span('Journal Header', 0, { fontSize: 13, bold: true,
        rect: { left: 50, top: 15, right: 190, bottom: 28 } }),
      span(`${pageNumber} Results`, 15, { fontSize: 15, bold: true,
        rect: { left: 50, top: 150, right: 180, bottom: 166 } }),
      span(`${pageNumber} of 3`, 52, { fontSize: 12, bold: true,
        rect: { left: 260, top: 760, right: 330, bottom: 774 } })
    ], pageHeight: 792
  }));
  const headings = extractPdfHeadings({ documentHash: 'c'.repeat(64), pages });
  assert.equal(headings.some(item => /Journal Header|of 3/u.test(item.rawText)), false);
  assert.equal(headings.filter(item => /Results/u.test(item.rawText)).length, 3);
});

test('captions, reference rows, formulas, and table rows are heading negatives', () => {
  const lines = ['Figure 2. Experimental overview', '[12] Smith et al. 2020.',
    'E = mc² + ΔG', 'Control group    12.4 ± 0.8'];
  const text = lines.join('\n');
  let start = 0;
  const spans = lines.map((line, index) => {
    const result = span(line, start, { fontSize: 14, bold: true,
      rect: { left: 60, top: 100 + index * 35, right: 450, bottom: 116 + index * 35 } });
    start += line.length + 1;
    return result;
  });
  assert.deepEqual(extractPdfHeadings({ documentHash: 'd'.repeat(64),
    pages: [{ pageNumber: 2, text, spans }] }), []);
});

test('ordinary bold body prose is not promoted to a heading', () => {
  const body = 'This bold sentence reports the main experimental result and remains ordinary prose.';
  const headings = extractPdfHeadings({ documentHash: 'e'.repeat(64), pages: [{
    pageNumber: 1, text: `${body}\nThe next sentence continues the paragraph.`,
    spans: [span(body, 0, { fontSize: 10, bold: true })]
  }] });
  assert.deepEqual(headings, []);
});

test('lowercase inline section words are not promoted solely by the known-word prior', () => {
  const first = 'results';
  const second = 'showed a reproducible treatment effect in the complete study cohort.';
  const text = `${first}\n${second}`;
  const headings = extractPdfHeadings({ documentHash: 'f'.repeat(64), pages: [{
    pageNumber: 3, text, pageWidth: 500, pageHeight: 700,
    spans: [
      span(first, 0, { fontSize: 10, rect: { left: 60, top: 100, right: 98, bottom: 112 } }),
      span(second, first.length + 1,
        { fontSize: 10, rect: { left: 60, top: 114, right: 430, bottom: 126 } })
    ]
  }] });
  assert.deepEqual(headings, []);
});
