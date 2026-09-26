const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPdfSemanticIndex,
  normalizePdfTextWithOffsets,
  pdfSemanticCacheKey,
  rawRangeToNormalized,
  normalizedRangeToRaw
} = require('../core/pdf-semantic-index.js');
const headingApi = require('../core/pdf-heading-extractor.js');

function withoutIntlSegmenter(callback) {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
  Object.defineProperty(Intl, 'Segmenter', { configurable: true, writable: true,
    value: undefined });
  try { return callback(); } finally {
    if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
    else delete Intl.Segmenter;
  }
}

test('normalization preserves original text with bidirectional offsets across NFKC, whitespace, and dehyphenation', () => {
  const raw = '  Efﬁcacy  was inter-\nnally measured.  ';
  const projection = normalizePdfTextWithOffsets(raw);
  assert.equal(projection.rawText, raw);
  assert.equal(projection.normalizedText, 'Efficacy was internally measured.');
  const rawStart = raw.indexOf('Efﬁcacy');
  const rawEnd = raw.indexOf('measured.') + 'measured.'.length;
  const normalized = rawRangeToNormalized(projection, rawStart, rawEnd);
  assert.equal(projection.normalizedText.slice(normalized.start, normalized.end),
    'Efficacy was internally measured.');
  assert.deepEqual(normalizedRangeToRaw(projection, normalized.start, normalized.end),
    { start: rawStart, end: rawEnd });
});

test('collapsed whitespace maps the following raw token to its exact normalized boundary', () => {
  const projection = normalizePdfTextWithOffsets('  A  B  ');
  assert.equal(projection.normalizedText, 'A B');
  assert.deepEqual(rawRangeToNormalized(projection, 5, 6), { start: 2, end: 3 });
  assert.deepEqual(normalizedRangeToRaw(projection, 2, 3), { start: 5, end: 6 });
});

test('NFKC mapping composes grapheme segments and returns enclosing raw ranges', () => {
  const raw = `A\u030A \u1100\u1161 \uFB03 \u{1F9EA} inter-\nnal`;
  const projection = normalizePdfTextWithOffsets(raw);
  assert.equal(projection.normalizedText, 'Å 가 ffi 🧪 internal');
  for (const expected of ['Å', '가', 'ffi', '🧪']) {
    const start = projection.normalizedText.indexOf(expected);
    const rawRange = normalizedRangeToRaw(projection, start, start + expected.length);
    const normalizedRange = rawRangeToNormalized(projection, rawRange.start, rawRange.end);
    assert.equal(projection.normalizedText.slice(normalizedRange.start, normalizedRange.end), expected);
  }
  for (const rawSlice of ['A\u030A', '\u1100\u1161', '\uFB03', '\u{1F9EA}', ' ', 'inter-\nnal']) {
    const start = raw.indexOf(rawSlice);
    const normalized = rawRangeToNormalized(projection, start, start + rawSlice.length);
    const enclosing = normalizedRangeToRaw(projection, normalized.start, normalized.end);
    assert.ok(enclosing.start <= start);
    assert.ok(enclosing.end >= start + rawSlice.length);
  }
});

test('scientific sentence boundaries preserve abbreviations, decimals, units, and Chinese punctuation', () => {
  const text = 'Dr. Li et al. measured 3.14 mg/mL. Fig. 2 confirms it. 结果显著。下一步验证！';
  const index = buildPdfSemanticIndex({ documentHash: '1'.repeat(64), revision: 3,
    pages: [{ pageNumber: 1, text }] });
  assert.deepEqual(index.sentences.map(item => item.normalizedText), [
    'Dr. Li et al. measured 3.14 mg/mL.', 'Fig. 2 confirms it.', '结果显著。', '下一步验证!'
  ]);
});

test('scientific sentence boundaries do not split dotted abbreviations or country initials', () => {
  const text = 'Li et al. reported, e.g. a U.S. cohort and i.e. a U.K. subset. ' +
    'Fig. 2 and Eq. 3 agree with Ref. 4.';
  const index = buildPdfSemanticIndex({ documentHash: 'b'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text }] });
  assert.deepEqual(index.sentences.map(item => item.normalizedText), [
    'Li et al. reported, e.g. a U.S. cohort and i.e. a U.K. subset.',
    'Fig. 2 and Eq. 3 agree with Ref. 4.'
  ]);
});

test('scientific sentence boundaries preserve p values, versions, DOI, and URL tokens', () => {
  const text = 'The value was 3.14, p = 0.003, version v2.4.1, DOI ' +
    '10.1038/s41586-020-2649-2 and https://example.org/data/v1.2. The finding held.';
  const index = buildPdfSemanticIndex({ documentHash: 'c'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text }] });
  assert.deepEqual(index.sentences.map(item => item.normalizedText), [
    'The value was 3.14, p = 0.003, version v2.4.1, DOI 10.1038/s41586-020-2649-2 and https://example.org/data/v1.2.',
    'The finding held.'
  ]);
});

test('scientific sentence boundaries protect No. and Nos. only before numeric designators', () => {
  const text = 'No. 5 increased expression. Nos. 5–7 were excluded. ' +
    'The answer was no. Another sentence followed. No. Control was unchanged.';
  const index = buildPdfSemanticIndex({ documentHash: '7'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text }] });
  assert.deepEqual(index.sentences.map(item => item.normalizedText), [
    'No. 5 increased expression.', 'Nos. 5–7 were excluded.', 'The answer was no.',
    'Another sentence followed.', 'No.', 'Control was unchanged.'
  ]);
});

test('ordinary English and Chinese terminators still split after scientific protections', () => {
  const text = 'First result. Second result? 中文结果。下一步！';
  const index = buildPdfSemanticIndex({ documentHash: 'd'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text }] });
  assert.deepEqual(index.sentences.map(item => item.normalizedText), [
    'First result.', 'Second result?', '中文结果。', '下一步!'
  ]);
});

test('repeated sentences retain distinct stable IDs bound to original positions', () => {
  const input = { documentHash: '2'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text: 'Repeated result. Repeated result.' }] };
  const first = buildPdfSemanticIndex(input);
  const second = buildPdfSemanticIndex(structuredClone(input));
  assert.equal(first.sentences.length, 2);
  assert.notEqual(first.sentences[0].sentenceId, first.sentences[1].sentenceId);
  assert.deepEqual(first.sentences.map(item => item.sentenceId),
    second.sentences.map(item => item.sentenceId));
});

test('a sentence can cross a page without losing either page-local raw range', () => {
  const index = buildPdfSemanticIndex({ documentHash: '3'.repeat(64), revision: 1,
    pages: [
      { pageNumber: 1, text: 'The mechanism depends on' },
      { pageNumber: 2, text: 'continued signaling across cells. A new sentence.' }
    ]
  });
  assert.equal(index.sentences[0].normalizedText,
    'The mechanism depends on continued signaling across cells.');
  assert.deepEqual(index.sentences[0].ranges.map(item => item.pageNumber), [1, 2]);
  assert.equal(index.sentences[0].rawQuoteByPage[0].quote, 'The mechanism depends on');
  assert.equal(index.sentences[0].rawQuoteByPage[1].quote,
    'continued signaling across cells.');
});

test('a cross-page sentence may continue with an uppercase scientific token', () => {
  const index = buildPdfSemanticIndex({ documentHash: 'e'.repeat(64), revision: 1,
    pages: [
      { pageNumber: 1, text: 'Activation depends on' },
      { pageNumber: 2, text: 'NF-κB signaling in macrophages. A new sentence.' }
    ]
  });
  assert.equal(index.sentences[0].normalizedText,
    'Activation depends on NF-κB signaling in macrophages.');
  assert.deepEqual(index.sentences[0].ranges.map(item => item.pageNumber), [1, 2]);
});

test('repeated page furniture is excluded before cross-page continuation', () => {
  const pages = [1, 2].map(pageNumber => {
    const body = pageNumber === 1 ? 'Activation depends on' : 'NF-κB signaling.';
    const text = `Journal Name\n${body}`;
    const bodyStart = text.indexOf(body);
    return { pageNumber, text, pageWidth: 600, pageHeight: 800, spans: [
      { text: 'Journal Name', start: 0, end: 12,
        rect: { left: 200, top: 5, right: 300, bottom: 15 } },
      { text: body, start: bodyStart, end: text.length,
        rect: { left: 50, top: pageNumber === 1 ? 700 : 80,
          right: 300, bottom: pageNumber === 1 ? 714 : 94 } }
    ] };
  });
  const index = buildPdfSemanticIndex({ documentHash: '3'.repeat(63) + '0',
    revision: 1, pages });
  assert.deepEqual(index.sentences.map(item => item.normalizedText), [
    'Activation depends on NF-κB signaling.'
  ]);
});

test('a page-start heading blocks cross-page sentence continuation', () => {
  const secondText = '2 Results\nNew section starts.';
  const index = buildPdfSemanticIndex({ documentHash: '5'.repeat(63) + '0', revision: 1,
    pages: [{ pageNumber: 1, text: 'Prior incomplete statement' },
      { pageNumber: 2, text: secondText, spans: [
        { text: '2 Results', start: 0, end: 9, fontSize: 16, bold: true,
          rect: { left: 40, top: 60, right: 130, bottom: 78 } },
        { text: 'New section starts.', start: 10, end: secondText.length, fontSize: 10,
          rect: { left: 40, top: 100, right: 220, bottom: 114 } }
      ] }]
  });
  assert.deepEqual(index.sentences.map(item => item.normalizedText), [
    'Prior incomplete statement', 'New section starts.'
  ]);
});

test('hyphenated line breaks are normalized across canonical line pieces with exact raw recovery', () => {
  const text = 'The inter-\nnal response remained stable.';
  const index = buildPdfSemanticIndex({ documentHash: '7'.repeat(64), revision: 1,
    pages: [{ pageNumber: 3, text }] });
  assert.equal(index.sentences[0].normalizedText,
    'The internal response remained stable.');
  assert.equal(index.sentences[0].rawQuoteByPage.length, 1);
  assert.equal(index.sentences[0].rawQuoteByPage[0].quote, text);
});

test('sentence spans retain supplied quads and use an explicit fallback when geometry is absent', () => {
  const text = 'Measured response. Missing geometry.';
  const index = buildPdfSemanticIndex({ documentHash: '4'.repeat(64), revision: 1,
    pages: [{ pageNumber: 7, text, spans: [
      { text: 'Measured response.', start: 0, end: 18,
        quadPoints: [10, 20, 100, 20, 10, 10, 100, 10] },
      { text: 'Missing geometry.', start: 19, end: text.length }
    ] }]
  });
  const geometries = index.spans.map(item => item.geometry.kind);
  assert.deepEqual(geometries, ['quad', 'page-paragraph-fallback']);
  assert.equal(index.spans[1].geometry.quadPoints, undefined);
});

test('partial use of a positioned source span is marked as enclosing rather than exact geometry', () => {
  const text = 'First sentence. Second sentence.';
  const index = buildPdfSemanticIndex({ documentHash: '8'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text, spans: [{ text, start: 0, end: text.length,
      quadPoints: [10, 20, 200, 20, 10, 10, 200, 10] }] }]
  });
  assert.equal(index.spans.length, 2);
  assert.ok(index.spans.every(item => item.geometry.kind === 'quad'));
  assert.ok(index.spans.every(item => item.geometry.precision === 'enclosing-source-span'));
});

test('zero-area, reversed, and out-of-page geometry degrades without fabricated quads', () => {
  const text = 'Zero. Reverse. Outside.';
  const index = buildPdfSemanticIndex({ documentHash: 'f'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text, pageWidth: 100, pageHeight: 100, spans: [
      { text: 'Zero.', start: 0, end: 5,
        quadPoints: [0, 0, 0, 0, 0, 0, 0, 0] },
      { text: 'Reverse.', start: 6, end: 14,
        rect: { left: 20, top: 20, right: 10, bottom: 10 } },
      { text: 'Outside.', start: 15, end: 23,
        rect: { left: 0, top: 0, right: 120, bottom: 10 } }
    ] }]
  });
  assert.deepEqual(index.spans.map(item => item.geometry.kind), [
    'page-paragraph-fallback', 'page-paragraph-fallback', 'page-paragraph-fallback'
  ]);
  assert.equal(index.spans.some(item => item.geometry.precision === 'exact-source-span'), false);
});

test('layout gaps, indentation, and column resets form auditable paragraphs', () => {
  const text = 'First line\ncontinues here\nIndented paragraph\nRight column';
  const starts = ['First line', 'continues here', 'Indented paragraph', 'Right column']
    .map(value => text.indexOf(value));
  const index = buildPdfSemanticIndex({ documentHash: '1'.repeat(63) + '0', revision: 1,
    pages: [{ pageNumber: 1, text, pageWidth: 600, pageHeight: 800, spans: [
      { text: 'First line', start: starts[0], end: starts[0] + 10,
        rect: { left: 50, top: 100, right: 200, bottom: 112 } },
      { text: 'continues here', start: starts[1], end: starts[1] + 14,
        rect: { left: 50, top: 116, right: 220, bottom: 128 } },
      { text: 'Indented paragraph', start: starts[2], end: starts[2] + 18,
        rect: { left: 78, top: 155, right: 260, bottom: 167 } },
      { text: 'Right column', start: starts[3], end: starts[3] + 12,
        rect: { left: 330, top: 100, right: 450, bottom: 112 } }
    ] }]
  });
  assert.deepEqual(index.paragraphs.map(item => item.normalizedText), [
    'First line continues here', 'Indented paragraph', 'Right column'
  ]);
});

test('document hierarchy links sections, paragraphs, sentences, and spans with raw ranges', () => {
  const text = '1 Introduction\nFirst finding. Second finding.';
  const index = buildPdfSemanticIndex({ documentHash: '5'.repeat(64), revision: 9,
    pages: [{ pageNumber: 1, text, spans: [
      { text: '1 Introduction', start: 0, end: 14, fontSize: 16, bold: true,
        rect: { left: 50, top: 80, right: 190, bottom: 98 } },
      { text: 'First finding. Second finding.', start: 15, end: text.length,
        fontSize: 10, rect: { left: 50, top: 120, right: 500, bottom: 134 } }
    ] }]
  });
  assert.equal(index.schemaVersion, 3);
  assert.equal(index.document.documentHash, '5'.repeat(64));
  assert.equal(index.sections.length, 1);
  assert.equal(index.paragraphs.length, 1);
  assert.deepEqual(index.paragraphs[0].sentenceIds,
    index.sentences.map(item => item.sentenceId));
  assert.ok(index.sentences.every(item => item.spanIds.length >= 1));
  assert.deepEqual(index.sentences[0].ranges[0],
    { pageNumber: 1, start: 15, end: 29 });
});

test('semantic paragraphs expose immutable compressed source and virtual-space position runs', () => {
  const text = 'Alpha\nbeta.';
  const index = buildPdfSemanticIndex({ documentHash: 'a'.repeat(64), revision: 4,
    pages: [{ pageNumber: 1, text }] });
  const paragraph = index.paragraphs[0];
  assert.equal(index.schemaVersion, 3);
  assert.match(index.cacheKey, /^pdf-semantic-v3:/u);
  assert.equal(paragraph.normalizedText, 'Alpha beta.');
  assert.deepEqual(paragraph.positionRuns, [
    { normalizedStart: 0, normalizedEnd: 5, pageNumber: 1,
      rawStart: 0, rawEnd: 5, kind: 'source' },
    { normalizedStart: 5, normalizedEnd: 6, pageNumber: null,
      rawStart: null, rawEnd: null, kind: 'virtual-space' },
    { normalizedStart: 6, normalizedEnd: 11, pageNumber: 1,
      rawStart: 6, rawEnd: 11, kind: 'source' }
  ]);
  assert.equal(Object.isFrozen(index), true);
  assert.equal(Object.isFrozen(paragraph.positionRuns), true);
  assert.equal(Object.isFrozen(paragraph.positionRuns[0]), true);
  assert.doesNotThrow(() => structuredClone(index));
});

test('NFKC expansion and dehyphenation keep atomic or discontinuous compressed runs', () => {
  const text = '\uFB03 inter-\nnal';
  const index = buildPdfSemanticIndex({ documentHash: 'b'.repeat(64), revision: 1,
    pages: [{ pageNumber: 3, text }] });
  const paragraph = index.paragraphs[0];
  assert.equal(paragraph.normalizedText, 'ffi internal');
  assert.deepEqual(paragraph.positionRuns, [
    { normalizedStart: 0, normalizedEnd: 3, pageNumber: 3,
      rawStart: 0, rawEnd: 1, kind: 'source' },
    { normalizedStart: 3, normalizedEnd: 9, pageNumber: 3,
      rawStart: 1, rawEnd: 7, kind: 'source' },
    { normalizedStart: 9, normalizedEnd: 12, pageNumber: 3,
      rawStart: 9, rawEnd: 12, kind: 'source' }
  ]);
});

test('large semantic paragraphs build a bounded number of position runs deterministically', () => {
  const text = `${'x'.repeat(120000)}.`;
  const input = { documentHash: 'c'.repeat(64), revision: 2,
    pages: [{ pageNumber: 1, text }] };
  const first = buildPdfSemanticIndex(input);
  const second = buildPdfSemanticIndex(input);
  assert.equal(first.paragraphs[0].positionRuns.length, 1);
  assert.deepEqual(first.paragraphs[0].positionRuns, second.paragraphs[0].positionRuns);
  assert.equal(first.cacheKey, second.cacheKey);
  assert.equal(first.provenanceKey, second.provenanceKey);
  assert.match(first.provenanceKey, /^pdf-semantic-provenance-v1:/u);
});

test('section hierarchy retains preamble paragraphs and nests numbered subsections', () => {
  const text = [
    'Preamble statement.', '', '1 Results', 'Main result.', '',
    '1.1 Validation', 'Validation result.'
  ].join('\n');
  const spans = [
    { text: '1 Results', start: text.indexOf('1 Results'),
      end: text.indexOf('1 Results') + 9, fontSize: 16, bold: true },
    { text: '1.1 Validation', start: text.indexOf('1.1 Validation'),
      end: text.indexOf('1.1 Validation') + 14, fontSize: 14, bold: true }
  ];
  const index = buildPdfSemanticIndex({ documentHash: '9'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text, spans }] });
  assert.equal(index.sections.length, 3);
  const preamble = index.sections.find(item => item.source === 'implicit-preamble');
  const results = index.sections.find(item => item.level === 2);
  const validation = index.sections.find(item => item.level === 3);
  assert.equal(preamble.paragraphIds.length, 1);
  assert.equal(validation.parentSectionId, results.sectionId);
  assert.deepEqual(results.childSectionIds, [validation.sectionId]);
  const assigned = index.sections.flatMap(item => item.paragraphIds);
  assert.deepEqual([...new Set(assigned)].sort(),
    index.paragraphs.map(item => item.paragraphId).sort());
  assert.ok(index.sections.every(item => Array.isArray(item.ranges) && item.ranges.length > 0));
  assert.equal(results.ranges[0].start, text.indexOf('1 Results'));
  assert.equal(results.ranges.at(-1).end, text.length);
  assert.equal(validation.ranges[0].start, text.indexOf('1.1 Validation'));
});

test('a heading range embedded in a continuous PDF item stream is excluded from paragraphs', () => {
  const text = 'Preamble statement. 1 Results Main result continues.';
  const headingStart = text.indexOf('1 Results');
  const index = buildPdfSemanticIndex({ documentHash: 'a'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text, spans: [
      { text: 'Preamble statement.', start: 0, end: 19, fontSize: 10 },
      { text: '1 Results', start: headingStart, end: headingStart + 9,
        fontSize: 16, bold: true },
      { text: 'Main result continues.', start: headingStart + 10, end: text.length,
        fontSize: 10 }
    ] }]
  });
  assert.equal(index.headings.length, 1);
  assert.equal(index.paragraphs.some(paragraph => paragraph.rawQuoteByPage.some(item =>
    item.start <= headingStart && item.end >= headingStart + 9)), false);
  assert.deepEqual(index.paragraphs.map(item => item.normalizedText),
    ['Preamble statement.', 'Main result continues.']);
});

test('cache keys include schema, document identity, revision, and canonical page digests', () => {
  const base = { documentHash: '6'.repeat(64), revision: 2,
    pages: [{ pageNumber: 1, text: 'Text.' }] };
  assert.equal(pdfSemanticCacheKey(base), pdfSemanticCacheKey(structuredClone(base)));
  assert.notEqual(pdfSemanticCacheKey(base), pdfSemanticCacheKey({ ...base, revision: 3 }));
  assert.notEqual(pdfSemanticCacheKey(base), pdfSemanticCacheKey({ ...base,
    pages: [{ pageNumber: 1, text: 'Changed.' }] }));
});

test('cache keys change with outline, typography, offsets, rects, and quads', () => {
  const base = { documentHash: '6'.repeat(64), revision: 2,
    pages: [{ pageNumber: 1, text: '1 Result\nText.', spans: [
      { text: '1 Result', start: 0, end: 8, fontSize: 14, fontName: 'Bold', bold: true,
        rect: { left: 10, top: 10, right: 60, bottom: 24 },
        quadPoints: [10, 24, 60, 24, 10, 10, 60, 10] }
    ] }], outline: [{ title: '1 Result', pageNumber: 1, level: 2, targetTop: 10 }] };
  const mutate = change => {
    const value = structuredClone(base);
    change(value);
    return value;
  };
  for (const variant of [
    mutate(value => { value.outline[0].level = 3; }),
    mutate(value => { value.pages[0].spans[0].fontSize = 15; }),
    mutate(value => { value.pages[0].spans[0].start = 1; }),
    mutate(value => { value.pages[0].spans[0].rect.left = 11; }),
    mutate(value => { value.pages[0].spans[0].quadPoints[0] = 11; })
  ]) assert.notEqual(pdfSemanticCacheKey(base), pdfSemanticCacheKey(variant));
  const reordered = structuredClone(base);
  reordered.pages[0].spans[0].rect = { bottom: 24, right: 60, top: 10, left: 10 };
  assert.equal(pdfSemanticCacheKey(base), pdfSemanticCacheKey(reordered));
});

test('build cache keys include normalized outline title, page, depth, and target coordinate', () => {
  const base = { documentHash: '8'.repeat(64), revision: 4,
    pages: [{ pageNumber: 1, text: '1 Results\nBody.', spans: [
      { text: '1 Results', start: 0, end: 9, fontSize: 16, bold: true,
        rect: { left: 20, top: 30, right: 100, bottom: 46 } }
    ] }], outline: [{ title: '1 Results', pageNumber: 1, level: 2, targetTop: 32 }] };
  const baseKey = buildPdfSemanticIndex(base).cacheKey;
  const variants = [
    value => { value.outline[0].title = '1 Findings'; },
    value => { value.outline[0].pageNumber = 2; },
    value => { value.outline[0].level = 3; },
    value => { value.outline[0].targetTop = 33; }
  ];
  for (const mutate of variants) {
    const changed = structuredClone(base);
    mutate(changed);
    assert.notEqual(buildPdfSemanticIndex(changed).cacheKey, baseKey);
  }
  const reordered = structuredClone(base);
  reordered.outline[0] = { targetTop: 32, level: 2, pageNumber: 1, title: '1 Results' };
  assert.equal(buildPdfSemanticIndex(reordered).cacheKey, baseKey);
  const canonicallyEquivalent = structuredClone(base);
  canonicallyEquivalent.outline[0].title = '  1  Results  ';
  assert.equal(buildPdfSemanticIndex(canonicallyEquivalent).cacheKey, baseKey);
});

test('sentence and heading extraction share strict PDF QuadPoints validation', () => {
  assert.equal(typeof headingApi.validatePdfQuadPoints, 'function');
  assert.strictEqual(require('../core/pdf-semantic-index.js').validatePdfQuadPoints,
    headingApi.validatePdfQuadPoints);
  const page = { pageWidth: 100, pageHeight: 100 };
  const valid = [10, 10, 30, 12, 8, 30, 28, 32];
  assert.deepEqual(headingApi.validatePdfQuadPoints(valid, page), valid);
  const invalid = [
    [0, 0, 10, 0, 20, 0, 30, 0],
    [10, 10, 30, 30, 10, 30, 30, 10],
    [10, 10, 30, 10, 10, 10, 30, 30],
    [10, 10, 130, 10, 10, 30, 130, 30],
    [...valid, 0, 0, 10, 0, 20, 0, 30, 0]
  ];
  for (const points of invalid) {
    assert.deepEqual(headingApi.validatePdfQuadPoints(points, page), []);
  }
});

test('invalid multi-group QuadPoints never produce exact sentence or heading geometry', () => {
  const valid = [10, 10, 30, 10, 10, 30, 30, 30];
  const invalidGroup = [0, 0, 10, 0, 20, 0, 30, 0];
  const text = '1 Results\nMeasured response.';
  const index = buildPdfSemanticIndex({ documentHash: '9'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text, pageWidth: 100, pageHeight: 100, spans: [
      { text: '1 Results', start: 0, end: 9, fontSize: 16, bold: true,
        quadPoints: [...valid, ...invalidGroup] },
      { text: 'Measured response.', start: 10, end: text.length,
        quadPoints: [...valid, ...invalidGroup] }
    ] }]
  });
  assert.equal(index.headings[0].geometry.kind, 'page-range-fallback');
  assert.equal(index.spans[0].geometry.kind, 'page-paragraph-fallback');
  assert.notEqual(index.spans[0].geometry.precision, 'exact-source-span');
});

test('Intl.Segmenter fallback preserves UTF-16 offsets and canonical segments', () => {
  withoutIntlSegmenter(() => {
    const raw = '🧪 A\u030A \u1100\u1161 \uFB03';
    const projection = normalizePdfTextWithOffsets(raw);
    assert.equal(projection.normalizedText, '🧪 Å 가 ffi');
    const normalizedStart = projection.normalizedText.indexOf('Å');
    assert.deepEqual(normalizedRangeToRaw(projection, normalizedStart, normalizedStart + 1),
      { start: raw.indexOf('A'), end: raw.indexOf('A') + 2 });
  });
});
