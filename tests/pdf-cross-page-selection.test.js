const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pdfAnnotations = require('../core/pdf-annotations.js');
const manualAnnotations = require('../core/manual-annotations.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function layer(pageNumber, bounds) {
  return {
    dataset: { pdfPageNumber: String(pageNumber) },
    childNodes: [{}, {}],
    getBoundingClientRect: () => bounds,
    ownerDocument: null
  };
}

function crossPageRange(first, second) {
  const firstNode = { layer: first };
  const secondNode = { layer: second };
  const rects = new Map([
    [first, [{ left: 20, top: 700, right: 180, bottom: 714 }]],
    [second, [
      { left: 20, top: 830, right: 190, bottom: 844 },
      { left: 20, top: 846, right: 100, bottom: 860 }
    ]]
  ]);
  const ownerDocument = { querySelectorAll: () => [first, second] };
  first.ownerDocument = ownerDocument;
  second.ownerDocument = ownerDocument;
  return {
    startContainer: firstNode,
    endContainer: secondNode,
    intersectsNode: candidate => candidate === first || candidate === second,
    getClientRects: () => [...rects.get(first), ...rects.get(second)],
    cloneRange() {
      let startLayer = first;
      let endLayer = second;
      return {
        startContainer: firstNode,
        startOffset: 3,
        endContainer: secondNode,
        endOffset: 9,
        setStart(candidate, offset) {
          startLayer = candidate;
          this.startContainer = candidate;
          this.startOffset = offset;
        },
        setEnd(candidate, offset) {
          endLayer = candidate;
          this.endContainer = candidate;
          this.endOffset = offset;
        },
        getClientRects() {
          if (startLayer === endLayer) return rects.get(startLayer);
          return [...rects.get(first), ...rects.get(second)];
        }
      };
    }
  };
}

function furnitureAwareCrossPageRange(first, second) {
  const makeNode = (owner, index, text, bounds) => ({
    layer: owner,
    index,
    textContent: text,
    parentElement: { getBoundingClientRect: () => bounds }
  });
  first.textNodes = [
    makeNode(first, 0, 'selected final body sentence',
      { left: 20, top: 650, right: 180, bottom: 664 }),
    makeNode(first, 1, 'Journal footer 1 of 20',
      { left: 20, top: 760, right: 120, bottom: 772 })
  ];
  second.textNodes = [
    makeNode(second, 0, 'Research article',
      { left: 20, top: 838, right: 90, bottom: 850 }),
    makeNode(second, 1, 'Neuroscience',
      { left: 150, top: 838, right: 195, bottom: 850 }),
    makeNode(second, 2, 'selected opening body sentence',
      { left: 20, top: 930, right: 190, bottom: 944 })
  ];
  first.childNodes = first.textNodes;
  second.childNodes = second.textNodes;
  const ownerDocument = {
    defaultView: { NodeFilter: { SHOW_TEXT: 4 } },
    querySelectorAll: () => [first, second],
    createTreeWalker(root) {
      let index = 0;
      return { nextNode: () => root.textNodes[index++] || null };
    }
  };
  first.ownerDocument = ownerDocument;
  second.ownerDocument = ownerDocument;
  const makeRange = (start = first.textNodes[0], end = second.textNodes[2]) => ({
    startContainer: start,
    startOffset: 0,
    endContainer: end,
    endOffset: end.textContent?.length || 0,
    cloneRange: () => makeRange(start, end),
    intersectsNode(node) {
      if (node === first || node === second) return true;
      if (node.layer === first) return start.layer === first && node.index >= start.index ||
        start.layer !== first;
      if (node.layer === second) return end.layer === second && node.index <= end.index ||
        end.layer !== second;
      return false;
    },
    setStart(node, offset) {
      start = node === first || node === second ? node.textNodes[0] : node;
      this.startContainer = start;
      this.startOffset = offset;
    },
    setEnd(node, offset) {
      end = node === first || node === second ? node.textNodes.at(-1) : node;
      this.endContainer = end;
      this.endOffset = node === first || node === second
        ? end.textContent.length : offset;
    },
    getClientRects() {
      const nodes = [];
      for (const owner of [first, second]) {
        for (const node of owner.textNodes) {
          const afterStart = owner !== start.layer || node.index >= start.index;
          const beforeEnd = owner !== end.layer || node.index <= end.index;
          if (afterStart && beforeEnd) nodes.push(node);
        }
      }
      return nodes.map(node => node.parentElement.getBoundingClientRect());
    }
  });
  return makeRange();
}

test('a real-style cross-page Range is split into ordered page-local geometry', () => {
  const first = layer(1, { left: 0, top: 100, right: 200, bottom: 800 });
  const second = layer(2, { left: 0, top: 810, right: 200, bottom: 1510 });
  const range = crossPageRange(first, second);

  const segments = pdfAnnotations.readPdfTextLayerRanges(range, node => node.layer || node);
  assert.deepEqual(segments.map(item => item.pageNumber), [1, 2]);
  assert.deepEqual(segments.map(item => item.clientRects.length), [1, 2]);
  assert.equal(segments[0].range.startContainer, range.startContainer);
  assert.equal(segments[0].range.endContainer, first);
  assert.equal(segments[1].range.startContainer, second);
  assert.equal(segments[1].range.endContainer, range.endContainer);
  assert.equal(pdfAnnotations.readPdfTextLayerRange(range, node => node.layer || node), null,
    'the legacy single-page API must not silently collapse a cross-page selection');
});

test('clips the B5 page-edge overflow before converting an owned selection to PDF quads', () => {
  // Dimensions and overflow from the real run-13 diagnostic; no article text is retained.
  const bounds = { left: 333, top: -120, right: 333 + 654.828125, bottom: -120 + 847.4375 };
  const page = layer(1, bounds);
  const node = { layer: page };
  const range = {
    startContainer: node, endContainer: node,
    getClientRects: () => [{
      left: bounds.left + 480, top: bounds.top + 760,
      right: bounds.left + 666.564453125, bottom: bounds.top + 777.03125
    }]
  };
  const [segment] = pdfAnnotations.readPdfTextLayerRanges(range, item => item.layer);
  const anchor = pdfAnnotations.createPdfSelectionAnchor({
    pageNumber: 1, documentHash: 'a'.repeat(64), contextHash: 'b5-page-edge-regression',
    quote: 'selected body text', clientRects: segment.clientRects, pageRect: bounds,
    viewport: { width: 654.84, height: 847.44,
      convertToPdfPoint: (x, y) => [x / 1.07, 792 - y / 1.07] }
  });
  assert.equal(segment.clientRects[0].right, bounds.right);
  assert.equal(anchor.quadPoints.length, 8);
  assert.ok(Math.max(anchor.quadPoints[0], anchor.quadPoints[2],
    anchor.quadPoints[4], anchor.quadPoints[6]) <= 612);
});

test('clipping all four page edges preserves PDF coordinates across zoom and scrolling', () => {
  const pdfQuads = [];
  for (const scale of [0.5, 1.07, 2.5]) {
    const origin = { left: 311.25, top: -250.5 * scale };
    const bounds = { ...origin, right: origin.left + 600 * scale,
      bottom: origin.top + 800 * scale };
    const page = layer(1, bounds);
    const node = { layer: page };
    const localRects = [
      { left: -12, top: -10, right: 40, bottom: 15 },
      { left: 570, top: 780, right: 614, bottom: 812 }
    ];
    const range = {
      startContainer: node, endContainer: node,
      getClientRects: () => localRects.map(rect => ({
        left: origin.left + rect.left * scale, top: origin.top + rect.top * scale,
        right: origin.left + rect.right * scale, bottom: origin.top + rect.bottom * scale
      }))
    };
    const [segment] = pdfAnnotations.readPdfTextLayerRanges(range, item => item.layer);
    const anchor = pdfAnnotations.createPdfSelectionAnchor({
      pageNumber: 1, documentHash: 'a'.repeat(64), contextHash: 'zoom-clipping',
      quote: 'selected edge text', clientRects: segment.clientRects, pageRect: bounds,
      viewport: { width: 600 * scale, height: 800 * scale,
        convertToPdfPoint: (x, y) => [x / scale, 800 - y / scale] }
    });
    pdfQuads.push(anchor.quadPoints);
  }
  const expected = [0, 800, 40, 800, 0, 785, 40, 785,
    570, 20, 600, 20, 570, 0, 600, 0];
  for (const quad of pdfQuads) {
    quad.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-8));
  }
});

test('page clipping drops only duplicate geometry and keeps page furniture excluded', () => {
  const page = layer(1, { left: 0, top: 0, right: 200, bottom: 800 });
  page.querySelectorAll = () => [{ getBoundingClientRect: () =>
    ({ left: 10, top: 770, right: 190, bottom: 790 }) }];
  const node = { layer: page };
  const range = {
    startContainer: node, endContainer: node,
    getClientRects: () => [
      { left: 180, top: 700, right: 215, bottom: 712 },
      { left: 180, top: 700, right: 225, bottom: 712 },
      { left: 185, top: 705, right: 230, bottom: 716 },
      { left: 10, top: 770, right: 210, bottom: 790 }
    ]
  };
  const [segment] = pdfAnnotations.readPdfTextLayerRanges(range, item => item.layer);
  assert.deepEqual(segment.clientRects, [
    { left: 180, top: 700, right: 200, bottom: 712 },
    { left: 185, top: 705, right: 200, bottom: 716 }
  ]);
});

test('page clipping rejects absent or invalid bounds, detached ownership, and invisible geometry', () => {
  const bounds = { left: 0, top: 0, right: 200, bottom: 800 };
  const page = layer(1, bounds);
  const node = { layer: page };
  const makeRange = rects => ({ startContainer: node, endContainer: node,
    getClientRects: () => rects });
  const visible = { left: 10, top: 700, right: 190, bottom: 712 };
  const invalidRects = [
    { left: 201, top: 700, right: 220, bottom: 712 },
    { left: 200, top: 700, right: 220, bottom: 712 },
    { left: 10, top: 801, right: 190, bottom: 813 },
    { left: 10, top: 700, right: NaN, bottom: 712 },
    { left: -Infinity, top: 700, right: 190, bottom: 712 },
    { left: 10, top: 700, right: 10, bottom: 712 },
    { left: 190, top: 700, right: 10, bottom: 712 }
  ];
  for (const rect of invalidRects) {
    assert.deepEqual(pdfAnnotations.readPdfTextLayerRanges(makeRange([rect]),
      item => item.layer), []);
  }
  assert.deepEqual(pdfAnnotations.readPdfTextLayerRanges({
    ...makeRange([visible]), endContainer: {}
  }, item => item.layer), []);
  for (const invalidBounds of [null, { ...bounds, right: NaN },
    { ...bounds, right: 0 }, { ...bounds, bottom: Infinity }]) {
    page.getBoundingClientRect = () => invalidBounds;
    assert.deepEqual(pdfAnnotations.readPdfTextLayerRanges(makeRange([visible]),
      item => item.layer), []);
  }
});

test('cross-page implicit layer bounds exclude isolated running headers and footers', () => {
  const first = layer(1, { left: 0, top: 100, right: 200, bottom: 800 });
  const second = layer(2, { left: 0, top: 810, right: 200, bottom: 1510 });
  const segments = pdfAnnotations.readPdfTextLayerRanges(
    furnitureAwareCrossPageRange(first, second), node => node.layer || node
  );

  assert.deepEqual(segments.map(item => item.clientRects.length), [1, 1]);
  assert.equal(segments[0].range.endContainer.textContent, 'selected final body sentence');
  assert.equal(segments[1].range.startContainer.textContent, 'selected opening body sentence');
});

test('cross-page geometry excludes explicitly marked furniture interleaved in PDF DOM order', () => {
  const first = layer(1, { left: 0, top: 100, right: 200, bottom: 800 });
  const second = layer(2, { left: 0, top: 810, right: 200, bottom: 1510 });
  const makeNode = (owner, index, text, bounds, furniture = '') => {
    const parentElement = {
      dataset: furniture ? { pdfPageFurniture: furniture } : {},
      getBoundingClientRect: () => bounds
    };
    return { layer: owner, index, textContent: text, parentElement };
  };
  first.textNodes = [makeNode(first, 0, 'last body line',
    { left: 20, top: 700, right: 180, bottom: 714 })];
  second.textNodes = [
    makeNode(second, 0, 'first body line',
      { left: 20, top: 930, right: 180, bottom: 944 }),
    makeNode(second, 1, 'Research article',
      { left: 20, top: 838, right: 90, bottom: 850 }, 'running-header'),
    makeNode(second, 2, 'second body line',
      { left: 20, top: 948, right: 180, bottom: 962 })
  ];
  first.childNodes = first.textNodes;
  second.childNodes = second.textNodes;
  second.querySelectorAll = selector => selector === '[data-pdf-page-furniture]'
    ? [second.textNodes[1].parentElement] : [];
  first.querySelectorAll = () => [];
  const ownerDocument = {
    defaultView: { NodeFilter: { SHOW_TEXT: 4 } },
    querySelectorAll: () => [first, second],
    createTreeWalker(root) {
      let index = 0;
      return { nextNode: () => root.textNodes[index++] || null };
    }
  };
  first.ownerDocument = ownerDocument;
  second.ownerDocument = ownerDocument;
  const makeRange = (start = first.textNodes[0], end = second.textNodes[2]) => ({
    startContainer: start, startOffset: 0,
    endContainer: end, endOffset: end.textContent.length,
    cloneRange: () => makeRange(start, end),
    intersectsNode: () => true,
    setStart(node, offset) {
      start = node === second ? second.textNodes[0] : node;
      this.startContainer = start;
      this.startOffset = offset;
    },
    setEnd(node, offset) {
      end = node === first ? first.textNodes.at(-1) : node;
      this.endContainer = end;
      this.endOffset = offset;
    },
    getClientRects() {
      if (start.layer === first && end.layer === first) {
        return first.textNodes.map(node => node.parentElement.getBoundingClientRect());
      }
      if (start.layer === second) {
        return second.textNodes
          .filter(node => node.index >= start.index && node.index <= end.index)
          .map(node => node.parentElement.getBoundingClientRect());
      }
      return [...first.textNodes, ...second.textNodes]
        .map(node => node.parentElement.getBoundingClientRect());
    }
  });

  const segments = pdfAnnotations.readPdfTextLayerRanges(
    makeRange(), node => node.layer || node
  );
  assert.deepEqual(segments.map(item => item.clientRects.length), [1, 2]);
  assert.equal(segments[1].clientRects.some(rect => rect.top === 838), false);
});

test('a page selection over 64 lines is losslessly split instead of dropping quads', () => {
  const textNodes = Array.from({ length: 130 }, (_, index) => ({
    index, textContent: 'x', layer: null
  }));
  const page = layer(7, { left: 0, top: 0, right: 200, bottom: 400 });
  textNodes.forEach(node => { node.layer = page; });
  page.ownerDocument = {
    defaultView: { NodeFilter: { SHOW_TEXT: 4 } },
    createTreeWalker() {
      let index = 0;
      return { nextNode: () => textNodes[index++] || null };
    }
  };
  const makeRange = (first = 0, last = 129) => ({
    startContainer: textNodes[first], startOffset: 0,
    endContainer: textNodes[last], endOffset: 1,
    intersectsNode: node => node.index >= first && node.index <= last,
    setStart(node, offset) { first = node.index; this.startContainer = node; this.startOffset = offset; },
    setEnd(node, offset) { last = node.index; this.endContainer = node; this.endOffset = offset; },
    cloneRange: () => makeRange(first, last),
    getClientRects: () => Array.from({ length: last - first + 1 }, (_, offset) => ({
      left: 10, top: (first + offset) * 2, right: 100, bottom: (first + offset) * 2 + 1
    }))
  });

  const chunks = pdfAnnotations.readPdfTextLayerRanges(
    makeRange(), node => node.layer || page
  );
  assert.deepEqual(chunks.map(item => item.clientRects.length), [64, 64, 2]);
  assert.equal(chunks.every(item => item.truncated === false), true);
  assert.equal(chunks.reduce((sum, item) => sum + item.clientRects.length, 0), 130);
});

test('cross-page annotation members retain group identity and existing single-page PDF anchors', () => {
  const hash = 'a'.repeat(64);
  const base = {
    categoryId: 'result',
    categorySnapshot: { name: 'Result', color: '#2F80ED' },
    prefix: '', suffix: '', sectionTitle: '', note: '', status: 'located',
    createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z'
  };
  const members = [1, 2].map((pageNumber, index) =>
    manualAnnotations.normalizeManualAnnotation({
      ...base,
      annotationId: `member-${pageNumber}`,
      selectionGroupId: 'pdf-selection-group-1',
      selectionGroupIndex: index,
      selectionGroupSize: 2,
      quote: `page ${pageNumber}`,
      blockFingerprint: `pdf-page-${pageNumber}`,
      startOffset: 0,
      endOffset: 6,
      pdfAnchor: {
        schemaVersion: 1,
        anchorKind: 'pdf_quad',
        pageNumber,
        documentHash: hash,
        contextHash: `context-${pageNumber}`,
        quote: `page ${pageNumber}`,
        prefix: '', suffix: '',
        quadPoints: [10, 20, 40, 20, 10, 10, 40, 10]
      }
    }));

  assert.deepEqual(members.map(item => item.selectionGroupId),
    ['pdf-selection-group-1', 'pdf-selection-group-1']);
  assert.deepEqual(members.map(item => item.selectionGroupIndex), [0, 1]);
  assert.deepEqual(members.map(item => item.pdfAnchor.pageNumber), [1, 2]);
  assert.deepEqual(pdfAnnotations.preparePdfAnnotationPublication(members)
    .map(item => item.pdfAnchor.pageNumber), [1, 2],
  'existing overlay/export publication remains one standard anchor per page');
});

function loadManualUiHelpers() {
  const source = read('content.js');
  const startMarker = '// DOM-independent manual annotation UI helpers: start';
  const endMarker = '// DOM-independent manual annotation UI helpers: end';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  const context = {};
  vm.runInNewContext(
    `${source.slice(start + startMarker.length, end)}\n` +
      'globalThis.manualUiHelpers = ManualAnnotationUiHelpers;', context
  );
  return context.manualUiHelpers;
}

test('manual validation allows a PDF-declared cross-block selection while retaining web safety', () => {
  const { validateManualSelectionDescriptor } = loadManualUiHelpers();
  const crossBlock = {
    text: 'cross page', collapsed: false,
    startBlockId: 'pdf-page-1', endBlockId: 'pdf-page-2'
  };
  assert.equal(validateManualSelectionDescriptor(crossBlock).code, 'CROSS_BLOCK');
  assert.deepEqual(
    JSON.parse(JSON.stringify(validateManualSelectionDescriptor({
      ...crossBlock, allowCrossBlock: true
    }))),
    { valid: true }
  );
});

test('content creates one associated annotation member per page segment with rollback', () => {
  const content = read('content.js');
  const start = content.indexOf('async function createManualAnnotation');
  const end = content.indexOf('async function reanchorManualAnnotation', start);
  const section = content.slice(start, end);
  assert.match(section, /descriptor\.anchorSegments/);
  assert.match(section, /selectionGroupId/);
  assert.match(section, /selectionGroupIndex:\s*index/);
  assert.match(section, /selectionGroupSize:\s*segments\.length/);
  assert.match(section, /for \(let index = 0; index < annotations\.length; index \+= 1\)/);
  assert.match(section, /ANNOTATION_DELETE/);
});

test('real verifier requires clean furniture-free persistence, remount, DPR, and export checks', () => {
  const verifier = read('scripts/verify-pdf-cross-page-selection.mjs');
  const helper = read('scripts/pdf-selection-evidence-helper.mjs');
  assert.match(verifier, /--same-page-only/);
  assert.match(verifier, /--device-scale-factor/);
  assert.match(verifier, /CROSS_PAGE_BROWSER_SELECTION_CONTAINS_PAGE_FURNITURE/);
  assert.match(verifier, /knownFurnitureKinds/);
  assert.match(verifier, /CROSS_PAGE_PERSISTED_QUOTE_CONTAINS_PAGE_FURNITURE/);
  assert.match(verifier, /CROSS_PAGE_BROWSER_BODY_AND_EVIDENCE_TEXT_DIFFER/);
  assert.match(verifier, /SAME_PAGE_ADJACENT_TEXT_OVERLAY_PRESENT/);
  assert.match(verifier, /pageTwoUnmounted/);
  assert.match(verifier, /virtualized-remount-verified/);
  assert.match(verifier, /CROSS_PAGE_REMOUNT_PAGE_/);
  assert.match(verifier, /exportAnnotatedPdf/);
  assert.match(verifier, /verifyAnnotatedPdf/);
  assert.match(verifier, /SAME_PAGE_RELOADED_ANCHORS_CHANGED/);
  const readerReady = helper.slice(
    helper.indexOf('export async function waitForNativePdfReaderReady'),
    helper.indexOf('export async function waitForNativePdfManualReady')
  );
  const manualReady = helper.slice(
    helper.indexOf('export async function waitForNativePdfManualReady'),
    helper.indexOf('async function waitForNativePage')
  );
  assert.match(readerReady, /\.pdf-native-page\.is-rendered \.pdf-native-text-layer span/);
  assert.doesNotMatch(readerReady, /data-pdf-page-number="1"/);
  assert.doesNotMatch(manualReady, /coverage\.terminal|pendingPages/);
  const navigation = helper.slice(
    helper.indexOf('async function navigateNativePage'),
    helper.indexOf('async function mountedNativePages')
  );
  assert.match(navigation, /pageInput\.fill\(String\(pageNumber\)\)/);
  assert.doesNotMatch(navigation, /!focused &&/);
  const crossPageRun = verifier.slice(
    verifier.indexOf('const baselineIds ='),
    verifier.indexOf("checkpoint('mouse-selection-complete'")
  );
  assert.match(crossPageRun, /dragSelectAcrossNativePdfPages/);
  assert.doesNotMatch(crossPageRun, /performRealCrossPageSelection/);
});
