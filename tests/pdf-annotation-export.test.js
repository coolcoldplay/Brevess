const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let pdfExport;
try {
  pdfExport = require('../core/pdf-annotation-export.js');
} catch (_) {
  pdfExport = {};
}

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const pdfAnnotations = require('../core/pdf-annotations.js');

function highlight(overrides = {}) {
  return {
    annotationId: 'ann-1',
    pageNumber: 2,
    quadPoints: [15, 780, 105, 780, 15, 769, 105, 769],
    color: [255, 235, 59],
    opacity: 0.35,
    note: 'Key result',
    ...overrides
  };
}

function minimalPdfBytes() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream'
  ];
  let pdf = '%PDF-1.7\n%\xFF\xFF\xFF\xFF\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

test('serializes a Brevess anchor as the bundled PDF.js Highlight editor record', () => {
  const record = pdfExport.serializePdfHighlight(highlight());

  assert.deepEqual({ ...record, quadPoints: Array.from(record.quadPoints) }, {
    annotationType: 9,
    pageIndex: 1,
    rect: [15, 769, 105, 780],
    rotation: 0,
    color: [255, 235, 59],
    opacity: 0.35,
    thickness: 12,
    quadPoints: [15, 780, 105, 780, 15, 769, 105, 769],
    outlines: [[15, 780, 105, 780, 105, 769, 15, 769]],
    comment: 'Key result',
    user: 'Brevess',
    popup: {
      contents: 'Key result', deleted: false, rect: [15, 769, 105, 780]
    }
  });
  assert.equal(record.quadPoints instanceof Float32Array, true);
});

test('accepts the canonical Task 7 nested PDF anchor and hex category color', () => {
  const record = pdfExport.serializePdfHighlight({
    annotationId: 'nested',
    pdfAnchor: {
      pageNumber: 3,
      quadPoints: [10, 700, 30, 700, 10, 690, 30, 690]
    },
    categorySnapshot: { color: '#2F80ED' },
    note: 'Evidence'
  });

  assert.equal(record.pageIndex, 2);
  assert.deepEqual(record.color, [47, 128, 237]);
  assert.deepEqual(record.rect, [10, 690, 30, 700]);
});

test('canonicalizes rotated corner order to PDF-space TL TR BL BR', () => {
  const expected = [15, 780, 105, 780, 15, 769, 105, 769];
  const rotatedOrders = [
    [105, 780, 105, 769, 15, 780, 15, 769],
    [105, 769, 15, 769, 105, 780, 15, 780],
    [15, 769, 15, 780, 105, 769, 105, 780]
  ];
  for (const quadPoints of rotatedOrders) {
    const record = pdfExport.serializePdfHighlight(highlight({ quadPoints }));
    assert.deepEqual(Array.from(record.quadPoints), expected);
    assert.deepEqual(record.outlines, [[15, 780, 105, 780, 105, 769, 15, 769]]);
  }
});

test('validates PDF highlight page, coordinates, color, opacity, note, and quad limits', () => {
  assert.throws(() => pdfExport.serializePdfHighlight(highlight({ pageNumber: 0 })),
    error => error.code === 'INVALID_PDF_HIGHLIGHT_PAGE');
  assert.throws(() => pdfExport.serializePdfHighlight(highlight({
    quadPoints: [15, 780, Infinity, 780, 15, 769, 105, 769]
  })), error => error.code === 'INVALID_PDF_HIGHLIGHT_QUAD');
  assert.throws(() => pdfExport.serializePdfHighlight(highlight({ color: [0, -1, 0] })),
    error => error.code === 'INVALID_PDF_HIGHLIGHT_COLOR');
  assert.throws(() => pdfExport.serializePdfHighlight(highlight({ opacity: NaN })),
    error => error.code === 'INVALID_PDF_HIGHLIGHT_OPACITY');

  const sixtyFour = Array.from({ length: 64 }, (_, index) => {
    const y = 780 - index * 2;
    return [15, y, 105, y, 15, y - 1, 105, y - 1];
  }).flat();
  assert.equal(pdfExport.serializePdfHighlight(highlight({ quadPoints: sixtyFour }))
    .quadPoints.length, 512);
  assert.throws(() => pdfExport.serializePdfHighlight(highlight({
    quadPoints: [...sixtyFour, 15, 600, 105, 600, 15, 599, 105, 599]
  })), error => error.code === 'PDF_HIGHLIGHT_QUAD_LIMIT');

  assert.equal(pdfExport.serializePdfHighlight(highlight({ opacity: -1 })).opacity, 0);
  assert.equal(pdfExport.serializePdfHighlight(highlight({ opacity: 2 })).opacity, 1);
  assert.equal(pdfExport.serializePdfHighlight(highlight({ note: 'n'.repeat(13000) }))
    .comment.length, 12000);
});

test('writes exact non-deleted records, clears stale Brevess keys, and returns saved bytes', async () => {
  const values = new Map([
    ['foreign-form-field', { value: 'preserve me' }],
    ['pdfjs_internal_editor_brevess:stale', { annotationType: 9 }]
  ]);
  const removed = [];
  const written = [];
  const annotationStorage = {
    get serializable() { return { map: new Map(values), hash: '', transfer: [] }; },
    remove(key) { removed.push(key); values.delete(key); },
    setValue(key, value) { written.push([key, value]); values.set(key, value); }
  };
  const bytes = Uint8Array.of(37, 80, 68, 70);
  let saveCalls = 0;
  const pdfDocument = {
    annotationStorage,
    async saveDocument() { saveCalls += 1; return bytes; }
  };
  const annotations = [
    {
      annotationId: 'alpha/β',
      pdfAnchor: { pageNumber: 2, quadPoints: highlight().quadPoints },
      categorySnapshot: { color: '#FFEB3B' },
      opacity: 0.4,
      note: 'First'
    },
    { ...highlight({ annotationId: 'deleted', deleted: true }) },
    highlight({ annotationId: 'second', pageNumber: 1, note: '' })
  ];

  const result = await pdfExport.savePdfHighlightAnnotations({ pdfDocument, annotations });

  assert.equal(result, bytes);
  assert.equal(saveCalls, 1);
  assert.deepEqual(removed, ['pdfjs_internal_editor_brevess:stale']);
  assert.equal(values.has('foreign-form-field'), true);
  assert.equal(written.length, 2);
  assert.deepEqual(written.map(([key]) => key), annotations.filter(item => !item.deleted)
    .map(item => pdfExport.pdfHighlightStorageKey(item.annotationId)));
  assert.equal(written[0][1].annotationType, 9);
  assert.equal(written[0][1].comment, 'First');
  assert.equal(written[1][1].pageIndex, 0);
});

test('propagates save rejection and a retry replaces rather than duplicates owned records', async () => {
  const values = new Map();
  const annotationStorage = {
    get serializable() { return { map: new Map(values), hash: '', transfer: [] }; },
    remove(key) { values.delete(key); },
    setValue(key, value) { values.set(key, value); }
  };
  let attempts = 0;
  const pdfDocument = {
    annotationStorage,
    async saveDocument() {
      attempts += 1;
      if (attempts === 1) throw new Error('disk unavailable');
      return Uint8Array.of(9, 9);
    }
  };

  await assert.rejects(
    pdfExport.savePdfHighlightAnnotations({ pdfDocument, annotations: [highlight()] }),
    /disk unavailable/
  );
  assert.equal(values.size, 1);
  const result = await pdfExport.savePdfHighlightAnnotations({
    pdfDocument, annotations: [highlight({ note: 'retry' })]
  });
  assert.deepEqual(Array.from(result), [9, 9]);
  assert.equal(values.size, 1);
  assert.equal(values.get(pdfExport.pdfHighlightStorageKey('ann-1')).comment, 'retry');
});

test('PDF.js 5.4.624 saves and reopens a standard Highlight with note and author', async () => {
  const pdfjsPath = path.join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const { getDocument, version } = await import(pathToFileURL(pdfjsPath).href);
  assert.equal(version, '5.4.624');
  const loadingTask = getDocument({ data: minimalPdfBytes() });
  const document = await loadingTask.promise;
  let saved;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => warnings.push(parts.map(String).join(' '));
  const exportedHighlight = highlight({
    pageNumber: 1,
    quadPoints: [15, 780, 105, 780, 15, 769, 105, 769],
    color: [47, 128, 237],
    opacity: 0.62,
    note: 'Reopen note'
  });
  try {
    saved = await pdfExport.savePdfHighlightAnnotations({
      pdfDocument: document,
      annotations: [exportedHighlight]
    });
  } finally {
    console.warn = originalWarn;
    await document.destroy();
  }
  assert.equal(warnings.every(message => /OffscreenCanvas is not supported/.test(message)), true,
    `unexpected PDF.js warning: ${warnings.join(' | ')}`);

  const verified = await pdfExport.verifySavedPdfAnnotations({
    bytes: saved,
    annotations: [exportedHighlight],
    getDocument
  });
  assert.deepEqual(verified, { ok: true, verifiedIds: ['ann-1'], missingIds: [] });

  const reopenedTask = getDocument({ data: saved });
  const reopened = await reopenedTask.promise;
  try {
    const page = await reopened.getPage(1);
    const annotations = await page.getAnnotations({ intent: 'display' });
    const annotation = annotations.find(item => item.annotationType === 9);
    assert.ok(annotation, 'the reopened PDF must contain a standard Highlight annotation');
    assert.deepEqual(annotation.rect, [15, 769, 105, 780]);
    assert.deepEqual(Array.from(annotation.quadPoints),
      [15, 780, 105, 780, 15, 769, 105, 769]);
    assert.deepEqual(Array.from(annotation.color), [47, 128, 237]);
    assert.equal(annotation.opacity, 0.62);
    assert.equal(annotation.contentsObj?.str, 'Reopen note');
    assert.equal(annotation.titleObj?.str, 'Brevess');
    assert.ok(annotation.popupRef, 'the note must be linked through a Popup annotation');
  } finally {
    await reopened.destroy();
  }
});

test('real PDF.js save verifies the new snapshot while preserving an older Brevess highlight', async t => {
  const pdfjsPath = path.join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const { getDocument } = await import(pathToFileURL(pdfjsPath).href);
  const historical = highlight({
    annotationId: 'historical', pageNumber: 1, note: 'Older note',
    quadPoints: [15, 780, 90, 780, 15, 769, 90, 769]
  });
  const current = highlight({
    annotationId: 'current', pageNumber: 1, note: 'Current note',
    quadPoints: [110, 780, 190, 780, 110, 769, 190, 769]
  });
  const firstTask = getDocument({ data: minimalPdfBytes() });
  const first = await firstTask.promise;
  let firstBytes;
  const originalWarn = console.warn;
  t.after(() => { console.warn = originalWarn; });
  console.warn = () => {};
  try {
    firstBytes = await pdfExport.savePdfHighlightAnnotations({
      pdfDocument: first, annotations: [historical]
    });
  } finally {
    await first.destroy();
  }
  const secondTask = getDocument({ data: firstBytes });
  const second = await secondTask.promise;
  let secondBytes;
  try {
    secondBytes = await pdfExport.savePdfHighlightAnnotations({
      pdfDocument: second, annotations: [current]
    });
  } finally {
    await second.destroy();
  }
  assert.deepEqual(await pdfExport.verifySavedPdfAnnotations({
    bytes: secondBytes, annotations: [current], getDocument
  }), { ok: true, verifiedIds: ['current'], missingIds: [] });
  const reopenedTask = getDocument({ data: secondBytes });
  const reopened = await reopenedTask.promise;
  try {
    const page = await reopened.getPage(1);
    const annotations = await page.getAnnotations({ intent: 'display' });
    assert.equal(annotations.filter(item =>
      item.annotationType === 9 && item.titleObj?.str === 'Brevess').length, 2);
  } finally {
    await reopened.destroy();
  }
});

test('reopen verification checks every affected page and reports the original highlight IDs', async () => {
  const requestedPages = [];
  let destroyed = 0;
  const expected = [
    highlight({ annotationId: 'first', pageNumber: 1, note: 'First note' }),
    highlight({ annotationId: 'second', pageNumber: 3, note: '' })
  ];
  const loadingTask = {
    promise: Promise.resolve({
      async getPage(pageNumber) {
        requestedPages.push(pageNumber);
        const source = expected.find(item => item.pageNumber === pageNumber);
        const serialized = pdfExport.serializePdfHighlight(source);
        return { async getAnnotations() { return [{
          annotationType: 9,
          rect: serialized.rect,
          quadPoints: serialized.quadPoints,
          color: serialized.color,
          opacity: serialized.opacity,
          titleObj: { str: 'Brevess' },
          contentsObj: { str: serialized.comment }
        }]; } };
      },
      async destroy() { destroyed += 1; }
    }),
    async destroy() { destroyed += 1; }
  };
  const result = await pdfExport.verifySavedPdfAnnotations({
    bytes: Uint8Array.of(37, 80, 68, 70),
    annotations: expected,
    getDocument: options => {
      assert.deepEqual(Array.from(options.data), [37, 80, 68, 70]);
      return loadingTask;
    }
  });
  assert.deepEqual(requestedPages, [1, 3]);
  assert.deepEqual(result, { ok: true, verifiedIds: ['first', 'second'], missingIds: [] });
  assert.ok(destroyed >= 1);
});

test('reopen verification fails closed when a note or highlight is absent', async () => {
  const result = await pdfExport.verifySavedPdfAnnotations({
    bytes: Uint8Array.of(1),
    annotations: [highlight({ annotationId: 'missing', pageNumber: 1, note: 'Expected' })],
    getDocument: () => ({ promise: Promise.resolve({
      async getPage() { return { async getAnnotations() { return []; } }; },
      async destroy() {}
    }) })
  });
  assert.deepEqual(result, { ok: false, verifiedIds: [], missingIds: ['missing'] });
});

test('reopen verification rejects wrong fields but allows unrelated historical Brevess highlights', async () => {
  const source = highlight({ annotationId: 'protected', pageNumber: 1, note: 'Same note' });
  const record = pdfExport.serializePdfHighlight(source);
  for (const impostor of [
    { titleObj: { str: 'Other' }, color: record.color, opacity: record.opacity },
    { titleObj: { str: 'Brevess' }, color: [0, 0, 0], opacity: record.opacity },
    { titleObj: { str: 'Brevess' }, color: record.color, opacity: 0.9 }
  ]) {
    const result = await pdfExport.verifySavedPdfAnnotations({
      bytes: Uint8Array.of(1), annotations: [source],
      getDocument: () => ({ promise: Promise.resolve({
        async getPage() { return { async getAnnotations() { return [{
          annotationType: 9, rect: record.rect, quadPoints: record.quadPoints,
          contentsObj: { str: record.comment }, ...impostor
        }]; } }; }, async destroy() {}
      }) })
    });
    assert.equal(result.ok, false);
  }

  const duplicate = {
    annotationType: 9, rect: record.rect, quadPoints: record.quadPoints,
    contentsObj: { str: record.comment }, titleObj: { str: 'Brevess' },
    color: record.color, opacity: record.opacity
  };
  const historyResult = await pdfExport.verifySavedPdfAnnotations({
    bytes: Uint8Array.of(1), annotations: [source],
    getDocument: () => ({ promise: Promise.resolve({
      async getPage() { return { async getAnnotations() { return [duplicate, duplicate]; } }; },
      async destroy() {}
    }) })
  });
  assert.deepEqual(historyResult, {
    ok: true, verifiedIds: ['protected'], missingIds: []
  });
});

test('save export contexts are immutable and reject document, generation, or annotation changes', () => {
  const annotations = [highlight({ annotationId: 'atomic' })];
  const context = pdfExport.createPdfSaveExportContext({
    bytes: Uint8Array.of(1, 2), documentHash: 'a'.repeat(64), generation: 7, annotations
  });
  annotations[0].note = 'mutated outside';
  const exportedBytes = context.bytes;
  exportedBytes[0] = 99;
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.annotationsSnapshot), true);
  assert.deepEqual(Array.from(context.bytes), [1, 2]);
  assert.equal(context.annotationsSnapshot[0].note, 'Key result');
  assert.equal(pdfExport.pdfSaveContextMatches(context, {
    documentHash: 'a'.repeat(64), generation: 7,
    annotations: [highlight({ annotationId: 'atomic' })]
  }), true);
  assert.equal(pdfExport.pdfSaveContextMatches(context, {
    documentHash: 'b'.repeat(64), generation: 7, annotations: context.annotationsSnapshot
  }), false);
  assert.equal(pdfExport.pdfSaveContextMatches(context, {
    documentHash: 'a'.repeat(64), generation: 8, annotations: context.annotationsSnapshot
  }), false);
  assert.equal(pdfExport.pdfSaveContextMatches(context, {
    documentHash: 'a'.repeat(64), generation: 7,
    annotations: [highlight({ annotationId: 'atomic', note: 'changed' })]
  }), false);
});

test('loads export serialization before the native module and exposes export without save UI policy', () => {
  const html = read('pdf-reader.html');
  const reader = read('pdf-native-reader.mjs');
  const moduleIndex = html.indexOf('<script src="core/pdf-annotation-export.js"></script>');
  const nativeIndex = html.indexOf('<script type="module" src="pdf-native-reader.mjs"></script>');

  assert.ok(moduleIndex >= 0 && moduleIndex < nativeIndex);
  assert.match(reader, /savePdfHighlightAnnotations\s*\(\s*\{/);
  assert.match(reader, /exportAnnotatedPdf/);
  assert.doesNotMatch(reader, /showSaveFilePicker|createWritable|confirm\(/);
});

test('publishes a bounded native snapshot and exports only live annotation fields end to end', async () => {
  const documentHash = 'a'.repeat(64);
  const pdfAnchor = {
    schemaVersion: 1,
    anchorKind: 'pdf_quad',
    pageNumber: 2,
    documentHash,
    contextHash: 'page-2-context',
    quote: 'selected evidence',
    prefix: 'before ',
    suffix: ' after',
    quadPoints: highlight().quadPoints
  };
  const publication = pdfAnnotations.preparePdfAnnotationPublication([
    {
      annotationId: 'live',
      categoryId: 'methods',
      categorySnapshot: { name: 'Methods', color: '#2F80ED', privatePrompt: 'omit' },
      pdfAnchor,
      note: 'Exported note',
      opacity: 0.62,
      rawText: 'must never enter the native snapshot',
      providerResponse: { secret: true }
    },
    {
      annotationId: 'removed',
      pdfAnchor,
      categorySnapshot: { name: 'Result', color: '#FF0000' },
      note: 'old note',
      opacity: 0.9,
      deleted: true,
      deletedAt: '2026-08-17T12:00:00.000Z',
      rawText: 'deleted private text'
    }
  ]);

  assert.deepEqual(Object.keys(publication[0]).sort(),
    ['annotationId', 'categorySnapshot', 'note', 'opacity', 'pdfAnchor']);
  assert.deepEqual(Object.keys(publication[0].categorySnapshot).sort(), ['color', 'name']);
  assert.equal(publication[0].note, 'Exported note');
  assert.equal(publication[0].opacity, 0.62);
  assert.deepEqual(Object.keys(publication[1]).sort(), [
    'annotationId', 'categorySnapshot', 'deleted', 'deletedAt', 'note', 'opacity', 'pdfAnchor'
  ]);
  assert.doesNotMatch(JSON.stringify(publication), /rawText|providerResponse|privatePrompt|secret/);

  const update = pdfAnnotations.reconcilePdfAnnotationUpdate({
    currentDocumentHash: documentHash,
    currentGeneration: 7,
    eventDocumentHash: documentHash,
    eventGeneration: 7,
    annotations: publication
  });
  assert.equal(update.accepted, true);
  assert.deepEqual(update.annotations, publication,
    'the native snapshot must retain only the normalized publication fields');

  const values = new Map([
    [pdfExport.pdfHighlightStorageKey('removed'), { annotationType: 9, comment: 'stale' }]
  ]);
  const annotationStorage = {
    get serializable() { return { map: new Map(values), hash: '', transfer: [] }; },
    remove(key) { values.delete(key); },
    setValue(key, value) { values.set(key, value); }
  };
  const bytes = Uint8Array.of(1, 2, 3);
  const exported = await pdfExport.savePdfHighlightAnnotations({
    pdfDocument: { annotationStorage, saveDocument: async () => bytes },
    annotations: update.annotations
  });

  assert.equal(exported, bytes);
  assert.equal(values.has(pdfExport.pdfHighlightStorageKey('removed')), false,
    'a published tombstone must remove its old owned PDF.js key');
  const live = values.get(pdfExport.pdfHighlightStorageKey('live'));
  assert.equal(live.opacity, 0.62);
  assert.deepEqual(live.color, [47, 128, 237]);
  assert.equal(live.comment, 'Exported note');
  assert.equal(live.popup.contents, 'Exported note');
  assert.doesNotMatch(JSON.stringify(live), /selected evidence|rawText|providerResponse|privatePrompt/);

  const content = read('content.js');
  const reader = read('pdf-native-reader.mjs');
  assert.match(content,
    /function publishNativePdfAnnotations[\s\S]{0,900}preparePdfAnnotationPublication/);
  assert.match(reader,
    /handlePdfAnnotationsUpdated[\s\S]{0,900}pdfAnnotationSnapshot[\s\S]{0,900}exportAnnotatedPdf/);
});
