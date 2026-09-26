const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPdfTextProjection,
  classifyPdfPageFurnitureSegments,
  orderPdfTextContentForReading,
  orderPdfTextSegmentsByGeometry,
  mergePdfSelectionRects,
  pdfProjectionRange,
  pdfProjectionRects,
  readPdfTextProjection
} = require('../core/pdf-text-projection.js');
const { localPdfSourceHash } = require('../core/pdf-source-store.js');

test('PDF offset projection follows item whitespace and NFKC ligatures without editing nodes', () => {
  const first = { textContent: 'The efﬁcacy' }, second = { textContent: '  increased.' };
  const result = createPdfTextProjection([{ node: first, text: first.textContent }, { node: second, text: second.textContent }]);
  assert.equal(result.text, 'The efficacy increased.');
  assert.equal('mode' in result, false, 'default projection shape remains backward compatible');
  assert.deepEqual(result.starts[6], { node: first, offset: 6 });
  assert.deepEqual(result.ends[7], { node: first, offset: 7 });
  assert.equal(first.textContent, 'The efﬁcacy');
  const calls = [];
  const range = pdfProjectionRange(result, { start: 4, end: 22, quote: 'efficacy increased' }, {
    createRange: () => ({ setStart: (...args) => calls.push(args), setEnd: (...args) => calls.push(args) })
  });
  assert.ok(range);
  assert.deepEqual(calls, [[first, 4], [second, 11]]);
});

test('PDF projection selects the requested repeated occurrence and rejects mismatched evidence', () => {
  const node = {};
  const projection = createPdfTextProjection([{ node, text: 'Result. Result.' }]);
  const calls = [];
  const doc = { createRange: () => ({ setStart: (...args) => calls.push(args), setEnd: (...args) => calls.push(args) }) };
  assert.ok(pdfProjectionRange(projection, { start: 8, end: 15, quote: 'Result.' }, doc));
  assert.deepEqual(calls, [[node, 8], [node, 15]]);
  for (const annotation of [{ start: 0, end: 7, quote: 'Changed' }, { start: -1, end: 7, quote: 'Result.' },
    { start: 0, end: 70, quote: 'Result.' }, { start: 0.5, end: 7, quote: 'Result.' }]) {
    assert.equal(pdfProjectionRange(projection, annotation, doc), null);
  }
});

test('PDF projection preserves UTF-16 offset identity for supplementary characters', () => {
  const node = {};
  const projection = createPdfTextProjection([{ node, text: 'A𝛂 B' }]);
  assert.equal(projection.text, 'Aα B');
  assert.equal(projection.ends[1].offset, 3);
});

test('PDF DOM projection excludes spans already classified as page furniture', () => {
  const textNode = textContent => ({ textContent });
  const spans = [
    { dataset: { pdfPageFurniture: 'running-header' }, child: textNode('Research article') },
    { dataset: {}, child: textNode('Selected body sentence.') },
    { dataset: { pdfPageFurniture: 'running-footer' }, child: textNode('1 of 23') }
  ];
  for (const span of spans) {
    span.textContent = span.child.textContent;
    span.querySelector = () => null;
  }
  const documentObject = {
    createTreeWalker(span) {
      let emitted = false;
      return { nextNode: () => emitted ? null : (emitted = true, span.child) };
    }
  };
  const layer = { ownerDocument: documentObject, querySelectorAll: () => spans };
  assert.equal(readPdfTextProjection(layer).text, 'Selected body sentence.');
});

test('explicit raw-offset DOM projection includes furniture without shifting semantic offsets', () => {
  const textNode = textContent => ({ textContent });
  const spans = [
    { dataset: { pdfPageFurniture: 'running-header' }, child: textNode('Journal header') },
    { dataset: {}, child: textNode('Selected body sentence.') },
    { dataset: { pdfPageFurniture: 'running-footer' }, child: textNode('1 of 23') }
  ];
  for (const span of spans) {
    span.textContent = span.child.textContent;
    span.querySelector = () => null;
  }
  const calls = [];
  const documentObject = {
    createTreeWalker(span) {
      let emitted = false;
      return { nextNode: () => emitted ? null : (emitted = true, span.child) };
    },
    createRange: () => ({
      setStart: (...args) => calls.push(args),
      setEnd: (...args) => calls.push(args)
    })
  };
  const layer = { ownerDocument: documentObject, querySelectorAll: () => spans };
  const projection = readPdfTextProjection(layer, { mode: 'raw-offset' });
  const semanticRawText = 'Journal header Selected body sentence. 1 of 23';
  assert.equal(projection.mode, 'raw-offset');
  assert.equal(projection.text, semanticRawText);
  const start = semanticRawText.indexOf('Selected');
  const end = start + 'Selected body sentence.'.length;
  assert.ok(pdfProjectionRange(projection,
    { start, end, quote: 'Selected body sentence.' }, documentObject));
  assert.deepEqual(calls, [[spans[1].child, 0],
    [spans[1].child, 'Selected body sentence.'.length]]);
  assert.equal(readPdfTextProjection(layer).text, 'Selected body sentence.');
});

test('raw-offset projection composes combining text with exact normalized-to-DOM boundaries', () => {
  const node = {};
  const raw = 'e\u0301x';
  const projection = createPdfTextProjection([{ node, text: raw }], { mode: 'raw-offset' });
  assert.equal(projection.text, 'éx');
  assert.deepEqual(projection.starts, [
    { node, offset: 0 },
    { node, offset: 2 }
  ]);
  assert.deepEqual(projection.ends, [
    { node, offset: 2 },
    { node, offset: 3 }
  ]);
  const calls = [];
  assert.ok(pdfProjectionRange(projection, { start: 0, end: 1, quote: 'é' }, {
    createRange: () => ({
      setStart: (...args) => calls.push(args),
      setEnd: (...args) => calls.push(args)
    })
  }));
  assert.deepEqual(calls, [[node, 0], [node, 2]]);
  assert.equal(createPdfTextProjection([{ node, text: raw }]).text, raw,
    'default selection normalization remains unchanged');
});

test('raw-offset projection deletes embedded controls without shifting following DOM boundaries', () => {
  const node = {};
  const raw = 'ab\u0000cd';
  const projection = createPdfTextProjection([{ node, text: raw }], { mode: 'raw-offset' });
  assert.equal(projection.text, 'abcd');
  assert.deepEqual(projection.starts[2], { node, offset: 3 });
  assert.deepEqual(projection.ends[3], { node, offset: 5 });
  const calls = [];
  assert.ok(pdfProjectionRange(projection, { start: 2, end: 4, quote: 'cd' }, {
    createRange: () => ({
      setStart: (...args) => calls.push(args),
      setEnd: (...args) => calls.push(args)
    })
  }));
  assert.deepEqual(calls, [[node, 3], [node, 5]]);
  assert.equal(createPdfTextProjection([{ node, text: raw }]).text, 'ab cd',
    'default selection control handling remains unchanged');
});

test('raw-offset ranges fail closed when a normalized selection cuts an atomic NFKC expansion', () => {
  const node = {};
  const projection = createPdfTextProjection([{ node, text: 'ﬁx' }], { mode: 'raw-offset' });
  assert.equal(projection.text, 'fix');
  let created = 0;
  const documentObject = { createRange() { created += 1; return {
    setStart() {}, setEnd() {}
  }; } };
  assert.equal(pdfProjectionRange(projection,
    { start: 0, end: 1, quote: 'f' }, documentObject), null);
  assert.equal(created, 0);
  assert.ok(pdfProjectionRange(projection,
    { start: 0, end: 2, quote: 'fi' }, documentObject));
});

test('a projection range never fabricates a DOM range for virtual whitespace alone', () => {
  const first = {}, second = {};
  const projection = createPdfTextProjection([
    { node: first, text: 'Alpha' },
    { node: second, text: 'beta' }
  ]);
  let created = 0;
  const documentObject = { createRange() { created += 1; return {
    setStart() {}, setEnd() {}
  }; } };
  assert.equal(pdfProjectionRange(projection,
    { start: 5, end: 6, quote: ' ' }, documentObject), null);
  assert.equal(created, 0);
});

test('PDF highlight rectangles are clipped and duplicate span/text rectangles are removed', () => {
  const rect = { left: 9, top: 18, right: 26, bottom: 31 };
  assert.deepEqual(pdfProjectionRects({ getClientRects: () => [rect, rect, { left: 0, top: 0, right: 4, bottom: 4 }] },
    { left: 10, top: 20, right: 100, bottom: 100 }), [{ left: 0, top: 0, width: 16, height: 11 }]);
});

test('PDF text geometry orders an interleaved two-column layer down each column', () => {
  const segment = (text, left, top, right, bottom) => ({
    node: { textContent: text }, text, rect: { left, top, right, bottom }
  });
  const heading = segment('Results', 70, 20, 530, 40);
  const leftOne = segment('Left one.', 50, 80, 255, 94);
  const rightOne = segment('Right one.', 345, 80, 550, 94);
  const leftTwo = segment('Left two.', 50, 102, 255, 116);
  const rightTwo = segment('Right two.', 345, 102, 550, 116);

  const ordered = orderPdfTextSegmentsByGeometry(
    [heading, leftOne, rightOne, leftTwo, rightTwo],
    { left: 0, top: 0, right: 600, bottom: 800 }
  );

  assert.deepEqual(ordered.map(item => item.text), [
    'Results', 'Left one.', 'Left two.', 'Right one.', 'Right two.'
  ]);
  assert.equal(createPdfTextProjection(ordered).text,
    'Results Left one. Left two. Right one. Right two.');
});

test('PDF text content uses the same stable column order as its rendered layer', () => {
  const item = (str, x, y, width = 180, height = 12) => ({
    str, width, height, transform: [1, 0, 0, 1, x, y]
  });
  const textContent = { items: [
    item('Left one.', 50, 700), item('Right one.', 350, 700),
    item('Left two.', 50, 675), item('Right two.', 350, 675)
  ], styles: {} };
  const ordered = orderPdfTextContentForReading(textContent,
    { view: [0, 0, 600, 800], rotate: 0 });
  assert.deepEqual(ordered.items.map(entry => entry.str), [
    'Left one.', 'Left two.', 'Right one.', 'Right two.'
  ]);
  assert.deepEqual(textContent.items.map(entry => entry.str), [
    'Left one.', 'Right one.', 'Left two.', 'Right two.'
  ], 'source PDF.js items must not be mutated');
});

test('narrow asymmetric paper gutter keeps whole columns and inline spaces in reading order', () => {
  const item = (str, x, y, width, height = 8.47) => ({
    str, width, height, transform: [height || 8.47, 0, 0, height || 8.47, x, y]
  });
  const items = [item('Full-width abstract.', 53, 280, 490),
    item('Introduction', 53, 233, 67),
    item('Left opening line.', 53, 211, 239),
    item('Right opening line.', 304, 233, 239),
    item('Left before citation', 53, 190, 213),
    item('1–3', 266.5, 193.74, 10.19, 5.64),
    item(' ', 276.7, 193.74, 0.56, 0),
    item('the', 280.29, 190, 11.9),
    item('Right second line.', 304, 211, 239),
    item('Left final line.', 53, 179, 239),
    item('Right final line.', 304, 190, 239),
    item('Copyright and license.', 106, 13, 414)];
  const result = orderPdfTextContentForReading({items}, {view:[0,0,602.986,782.986]});
  assert.deepEqual(result.items.map(entry=>entry.str), [
    'Full-width abstract.', 'Introduction', 'Left opening line.', 'Left before citation',
    '1–3', ' ', 'the', 'Left final line.', 'Right opening line.',
    'Right second line.', 'Right final line.', 'Copyright and license.'
  ]);
  assert.equal(result.items.length, items.length);
  assert.ok(result.items.every(entry=>items.includes(entry)), 'retain exact original PDF items');
});

test('superscripts stay after their same-line text instead of moving before the line', () => {
  const part = (text,left,top,right,bottom) => ({text,rect:{left,top,right,bottom}});
  const result = orderPdfTextSegmentsByGeometry([
    part('Left first',53,590,266,598.47), part('1–3',266.5,589.08,276.69,594.72),
    part('the',280.29,590,292.19,598.47), part('Left next.',53,601,292,609.47),
    part('Right first.',304,590,543,598.47), part('Right next.',304,601,543,609.47)
  ],{left:0,top:0,right:602.986,bottom:782.986});
  assert.deepEqual(result.map(item=>item.text), ['Left first','1–3','the','Left next.','Right first.','Right next.']);
});

test('near-gutter author superscripts stay attached to their full-width source line', () => {
  const data = [
    ['Author A',53.12,607.58,89.73,8.97], ['1,2,9',142.92,610.3,14.92,5.98],
    ['Author B',160.38,607.58,59.27,8.97], ['1,2,9',219.69,610.3,14.92,5.98],
    ['Author C',237.15,607.58,81.67,8.97], ['1,3,9',318.78,610.3,14.92,5.98],
    ['Author D',336.25,607.58,65.42,8.97], ['1,2',401.73,610.3,9.31,5.98],
    ['Author E',413.57,607.58,53.65,8.97], ['1,2',467.21,610.3,9.31,5.98],
    ['Author F',479.06,607.58,51.34,8.97], ['1,2',530.42,610.3,9.31,5.98]
  ];
  const segments=data.map(([text,x,y,w,h],id)=>({text,id,rect:{left:x,right:x+w,top:782.986-y-h,bottom:782.986-y}}));
  const result=orderPdfTextSegmentsByGeometry(segments,{left:0,top:0,right:602.986,bottom:782.986});
  assert.deepEqual(result.map(item=>item.id),segments.map(item=>item.id));
});

test('full-width caption inline labels stay in visual order beside real columns', () => {
  const part = (text, left, top, right) => ({ text,
    rect: { left, top, right, bottom: top + 8 } });
  const source = [part('Left one.', 40, 30, 250), part('Right one.', 350, 30, 560),
    part('Left two.', 40, 48, 250), part('Right two.', 350, 48, 560),
    part('Figure 2.', 36, 100, 70), part('The full-width caption (', 72, 100, 368),
    part('a, e', 369, 100, 383), part(') continues here.', 383, 100, 570)];
  const ordered = orderPdfTextSegmentsByGeometry(source,
    { left: 0, top: 0, right: 600, bottom: 800 });
  assert.deepEqual(ordered.map(item => item.text), ['Left one.', 'Left two.',
    'Right one.', 'Right two.', 'Figure 2.', 'The full-width caption (',
    'a, e', ') continues here.']);
  assert.equal(new Set(ordered.map(item => item.text)).size, source.length);
});

test('PDF page furniture classifier excludes separated running headers and footers without hiding body text', () => {
  const segment = (text, left, top, right, bottom) => ({
    text, rect: { left, top, right, bottom }
  });
  const segments = [
    segment('eLife', 45, 28, 95, 44),
    segment('Research article', 100, 30, 210, 44),
    segment('Neuroscience', 500, 30, 575, 44),
    segment('2017; Tremblay et al. During the discovery of microglial motility,', 170, 94, 560, 108),
    segment('the body continues near the lower margin and remains selectable.', 170, 690, 560, 704),
    segment('Nebeling et al. eLife 2023;12:e83176. DOI: https://doi.org/10.7554/eLife.83176', 45, 756, 520, 770),
    segment('1 of 23', 535, 756, 580, 770)
  ];
  const result = classifyPdfPageFurnitureSegments(segments,
    { left: 0, top: 0, right: 600, bottom: 792 }, { pageNumber: 2, pageCount: 23 });
  assert.deepEqual(result.map(item => item.furniture), [true, true, true, false, false, true, true]);
  assert.deepEqual(result.filter(item => item.furniture).map(item => item.kind),
    ['running-header', 'running-header', 'running-header', 'running-footer', 'running-footer']);
});

test('PDF page furniture classifier keeps first-page title and unseparated edge body selectable', () => {
  const segments = [
    { text: 'A full scientific article title', rect: { left: 60, top: 35, right: 540, bottom: 55 } },
    { text: 'Abstract body begins immediately below the title.', rect: { left: 60, top: 63, right: 540, bottom: 78 } },
    { text: 'A final body sentence reaches the normal printable margin.', rect: { left: 60, top: 735, right: 540, bottom: 750 } }
  ];
  const result = classifyPdfPageFurnitureSegments(segments,
    { left: 0, top: 0, right: 600, bottom: 792 }, { pageNumber: 1, pageCount: 10 });
  assert.ok(result.every(item => item.furniture === false));
});

test('PDF text geometry does not invent columns for a single wide text flow', () => {
  const segments = [
    { text: 'First line', rect: { left: 80, top: 50, right: 520, bottom: 65 } },
    { text: 'Second line', rect: { left: 80, top: 75, right: 520, bottom: 90 } },
    { text: 'Third line', rect: { left: 80, top: 100, right: 520, bottom: 115 } }
  ];
  assert.deepEqual(orderPdfTextSegmentsByGeometry(segments,
    { left: 0, top: 0, right: 600, bottom: 800 }), segments);
});

test('PDF text geometry keeps inline fragments in one wide column', () => {
  const segments = [
    { text: 'Line one left', rect: { left: 80, top: 50, right: 279, bottom: 65 } },
    { text: 'line one right', rect: { left: 285, top: 50, right: 520, bottom: 65 } },
    { text: 'Line two left', rect: { left: 80, top: 75, right: 282, bottom: 90 } },
    { text: 'line two right', rect: { left: 288, top: 75, right: 520, bottom: 90 } }
  ];
  assert.deepEqual(orderPdfTextSegmentsByGeometry(segments,
    { left: 0, top: 0, right: 600, bottom: 800 }), segments);
});

test('PDF text geometry vetoes row continuations, formulas, tables, and hanging references', () => {
  const row = (leftText, rightText, top, leftRight = 180, rightLeft = 410) => [
    { text: leftText, rect: { left: 50, top, right: leftRight, bottom: top + 14 } },
    { text: rightText, rect: { left: rightLeft, top, right: 550, bottom: top + 14 } }
  ];
  const cases = [
    [...row('A long clause continues', 'after a deliberately large inline gap', 50),
      ...row('and the next clause continues', 'on the same visual baseline', 75)],
    [...row('E =', 'mc² + ΔG', 50), ...row('p =', '0.004', 75)],
    [...row('Control group', '12.4 ± 0.8', 50), ...row('Treatment group', '8.1 ± 0.5', 75)],
    [...row('[1]', 'Smith et al. Reference title.', 50, 90, 135),
      ...row('[2]', 'Jones et al. Another title.', 75, 90, 135)],
    [...row('(a)', 'Indented continuation text', 50, 90, 145),
      ...row('(b)', 'Second continuation text', 75, 90, 145)]
  ];
  for (const segments of cases) {
    assert.deepEqual(orderPdfTextSegmentsByGeometry(segments,
      { left: 0, top: 0, right: 600, bottom: 800 }), segments);
  }
});

test('local PDF cache routing accepts only the exact local file identity namespace', () => {
  const hash = 'a'.repeat(64);
  assert.equal(localPdfSourceHash(`file:///brevess-local-pdf/${hash}/paper.pdf`), hash);
  assert.equal(localPdfSourceHash(`https://example.org/brevess-local-pdf/${hash}/paper.pdf`), '');
  assert.equal(localPdfSourceHash(`file://server/brevess-local-pdf/${hash}/paper.pdf`), '');
  assert.equal(localPdfSourceHash('file:///private/paper.pdf'), '');
});

test('native selection joins justified words and superscripts only within their visual line', () => {
  const rect=(left,top,right,bottom)=>({left,top,right,bottom});
  const input=[rect(50,100,180,118),rect(186,100,240,118),rect(240,96,250,108),
    rect(253,100,290,118),rect(302,100,540,118),rect(50,122,290,140)];
  const result=mergePdfSelectionRects(input);
  assert.deepEqual(result,[rect(50,96,290,118),rect(302,100,540,118),rect(50,122,290,140)]);
  assert.equal(input.length,6,'selection geometry must not alter source text or input ranges');
});

test('explicit PDF line breaks allow justified spaces while retaining a narrower column gutter',()=>{
  const rect=(left,right,lineId)=>({left,top:100,right,bottom:118,lineId});
  assert.deepEqual(mergePdfSelectionRects([rect(50,100,1),rect(115,190,1),rect(202,300,2)]),[
    {left:50,top:100,right:190,bottom:118},{left:202,top:100,right:300,bottom:118}
  ]);
});
