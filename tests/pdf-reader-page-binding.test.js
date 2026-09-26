const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const readerSource = fs.readFileSync(path.join(root, 'pdf-reader.js'), 'utf8');
const verifierSource = fs.readFileSync(
  path.join(root, 'scripts', 'verify-pdf-reader-real-papers.mjs'), 'utf8'
);

function loadPageBindingFunctions() {
  const start = readerSource.indexOf('function normalizePdfPageBindingText');
  const end = readerSource.indexOf('\n  async function renderParsedDocument', start);
  assert.ok(start >= 0 && end > start, 'PDF page-binding production helpers must exist');
  return Function(
    `'use strict'; ${readerSource.slice(start, end)}; return {\n` +
    '  bindParsedBlocksToPdfPages, appendPageBoundBlock, pageEvidenceFromMineruEntries,\n' +
    '  createParsedPageBindingSnapshot, applyParsedPageBindingSnapshot,\n' +
    '  persistParsedPageBindingSnapshot, parsedPageBindingIdentity\n' +
    '};'
  )();
}

function element(parent = null) {
  return {
    dataset: {}, parentElement: parent, children: [],
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    closest(selector) {
      if (selector === '[data-pdf-page-number]' && this.dataset.pdfPageNumber !== undefined) {
        return this;
      }
      return this.parentElement?.closest?.(selector) || null;
    }
  };
}

test('source parsed blocks bind headings, paragraphs, lists, and tables to real PDF pages', () => {
  const { bindParsedBlocksToPdfPages } = loadPageBindingFunctions();
  const blocks = [
    { type: 'heading', text: 'Results' },
    { type: 'paragraph', text: 'D1+ neurons increased the response.' },
    { type: 'list', ordered: true, items: [
      { text: 'First reference entry' }, { text: 'Second reference entry' }
    ] },
    { type: 'table', header: ['Group', 'Mean'], rows: [['Control', '1.0']] }
  ];
  const evidence = [
    { pageNumber: 2, text: 'Results D1+ neurons increased the response.' },
    { pageNumber: 7, text: 'First reference entry Second reference entry' },
    { pageNumber: 9, text: 'Group Mean Control 1.0' }
  ];

  const bound = bindParsedBlocksToPdfPages(blocks, evidence, 12);

  assert.deepEqual(bound.map(block => block.pageNumber), [2, 2, 7, 9]);
  assert.deepEqual(bound[2].items.map(item => item.pageNumber), [7, 7]);
});

test('page binding rejects malformed, out-of-range, and ambiguous source evidence', () => {
  const { bindParsedBlocksToPdfPages } = loadPageBindingFunctions();
  const blocks = [{ type: 'paragraph', text: 'Repeated marker' }];
  for (const evidence of [
    [{ pageNumber: 0, text: 'Repeated marker' }],
    [{ pageNumber: 3.5, text: 'Repeated marker' }],
    [{ pageNumber: 13, text: 'Repeated marker' }],
    [{ pageNumber: 2, text: 'Repeated marker' }, { pageNumber: 3, text: 'Repeated marker' }]
  ]) {
    const [bound] = bindParsedBlocksToPdfPages(blocks, evidence, 12);
    assert.equal(bound.pageNumber, undefined);
  }

  const [recomputed] = bindParsedBlocksToPdfPages([{
    type: 'list', pageNumber: 8, items: [{ text: 'Repeated marker', pageNumber: 8 }]
  }], [
    { pageNumber: 2, text: 'Repeated marker' },
    { pageNumber: 3, text: 'Repeated marker' }
  ], 12);
  assert.equal(recomputed.pageNumber, undefined);
  assert.equal(recomputed.items[0].pageNumber, undefined);
});

test('fuzzy page binding cannot join the beginning and end from different source records', () => {
  const { bindParsedBlocksToPdfPages } = loadPageBindingFunctions();
  const marker = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda omega';
  const [bound] = bindParsedBlocksToPdfPages(
    [{ type: 'paragraph', text: marker }],
    [
      { pageNumber: 4, text: 'alpha beta gamma delta epsilon zeta unrelated middle' },
      { pageNumber: 4, text: 'unrelated continuation eta theta iota kappa lambda omega' }
    ],
    10
  );
  assert.equal(bound.pageNumber, undefined);
  const [exactCrossRecord] = bindParsedBlocksToPdfPages(
    [{ type: 'paragraph', text: 'alpha beta gamma delta' }],
    [
      { pageNumber: 4, text: 'alpha beta' },
      { pageNumber: 4, text: 'gamma delta' }
    ],
    10
  );
  assert.equal(exactCrossRecord.pageNumber, undefined);

  const [reversed] = bindParsedBlocksToPdfPages(
    [{ type: 'paragraph', text: marker }],
    [{ pageNumber: 4, text: 'eta theta iota kappa lambda omega middle alpha beta gamma delta epsilon zeta' }],
    10
  );
  assert.equal(reversed.pageNumber, undefined);
});

test('cached page bindings are identity-bound and restore every valid later-page block', () => {
  const {
    createParsedPageBindingSnapshot, applyParsedPageBindingSnapshot
  } = loadPageBindingFunctions();
  const hash = 'a'.repeat(64);
  const nativeDocument = {
    pageCount: 12,
    phase: 'text-ready',
    structure: { documentHash: hash, documentId: `sha256:${hash}` }
  };
  const source = [
    { id: 'pdf-block-1', type: 'heading', text: 'Results', pageNumber: 2 },
    { id: 'pdf-block-2', type: 'paragraph', text: 'Late page', pageNumber: 11 },
    { id: 'pdf-block-3', type: 'list', items: [
      { text: 'Reference A', pageNumber: 12 }
    ], pageNumber: 12 }
  ];
  const snapshot = createParsedPageBindingSnapshot(source, nativeDocument);
  const restored = applyParsedPageBindingSnapshot(
    source.map(block => ({ ...block, pageNumber: undefined,
      ...(block.items ? { items: block.items.map(item => ({ text: item.text })) } : {})
    })),
    snapshot,
    nativeDocument
  );

  assert.deepEqual(restored.map(block => block.pageNumber), [2, 11, 12]);
  assert.equal(restored[2].items[0].pageNumber, 12);
  assert.equal(applyParsedPageBindingSnapshot(source, snapshot, {
    ...nativeDocument, structure: { ...nativeDocument.structure, documentHash: 'c'.repeat(64) }
  }).some(block => block.pageNumber), false);
});

test('page-binding identity requires documentId to encode the exact documentHash', () => {
  const { parsedPageBindingIdentity } = loadPageBindingFunctions();
  const hash = 'a'.repeat(64);
  assert.equal(parsedPageBindingIdentity({
    pageCount: 2, structure: { documentHash: hash, documentId: `sha256:${'b'.repeat(64)}` }
  }), null);
  assert.deepEqual(parsedPageBindingIdentity({
    pageCount: 2, structure: { documentHash: hash, documentId: `sha256:${hash}` }
  }), { documentHash: hash, documentIdentity: hash, pageCount: 2 });
});

test('cached page bindings cannot cross parsed-content versions with the same PDF identity', () => {
  const { createParsedPageBindingSnapshot, applyParsedPageBindingSnapshot } =
    loadPageBindingFunctions();
  const hash = 'a'.repeat(64);
  const nativeDocument = {
    pageCount: 12, phase: 'text-ready',
    structure: { documentHash: hash, documentId: `sha256:${hash}` }
  };
  const snapshot = createParsedPageBindingSnapshot([
    { id: 'pdf-block-1', type: 'paragraph', text: 'old parsed content', pageNumber: 8 }
  ], nativeDocument);
  const [restored] = applyParsedPageBindingSnapshot([
    { id: 'pdf-block-1', type: 'paragraph', text: 'new parsed content' }
  ], snapshot, nativeDocument);
  assert.equal(restored.pageNumber, undefined);
  assert.match(snapshot.contentHash, /^[a-f0-9]{16}$/u);
});

test('only final text-ready snapshots can be created, restored, or persisted', async () => {
  const { createParsedPageBindingSnapshot, persistParsedPageBindingSnapshot } =
    loadPageBindingFunctions();
  const hash = 'a'.repeat(64);
  const native = phase => ({
    pageCount: 12, phase,
    structure: { documentHash: hash, documentId: `sha256:${hash}` }
  });
  const complete = createParsedPageBindingSnapshot([
    { id: 'pdf-block-1', type: 'paragraph', text: 'same content', pageNumber: 2 },
    { id: 'pdf-block-2', type: 'paragraph', text: 'more content', pageNumber: 9 }
  ], native('text-ready'));
  const partialBlocks = [
    { id: 'pdf-block-1', type: 'paragraph', text: 'same content', pageNumber: 2 },
    { id: 'pdf-block-2', type: 'paragraph', text: 'more content' }
  ];
  const partial = createParsedPageBindingSnapshot(partialBlocks, native('partial-index'));
  const values = {};
  global.chrome = { storage: { local: {
    async get(key) { return { [key]: values[key] }; },
    async set(next) { Object.assign(values, next); }
  } } };
  try {
    assert.equal(partial, null);
    assert.equal(await persistParsedPageBindingSnapshot(complete), true);
    assert.equal(await persistParsedPageBindingSnapshot(partial), false);
    assert.deepEqual(values[`sciPdfParsedPageBindingsV1:${hash}`], complete);
    const forgedPartial = { ...complete, textReady: false };
    const [restored] = loadPageBindingFunctions().applyParsedPageBindingSnapshot(
      [{ id: 'pdf-block-1', type: 'paragraph', text: 'same content' },
        { id: 'pdf-block-2', type: 'paragraph', text: 'more content' }],
      forgedPartial, native('partial-index')
    );
    assert.equal(restored.pageNumber, undefined);
  } finally { delete global.chrome; }
});

test('MinerU content-list page_idx is converted to one-based source evidence fail closed', () => {
  const { pageEvidenceFromMineruEntries } = loadPageBindingFunctions();
  const encoder = new TextEncoder();
  const entries = new Map([
    ['paper/full.md', encoder.encode('# Paper')],
    ['paper/paper_content_list.json', encoder.encode(JSON.stringify([
      { type: 'text', text: 'Paper', page_idx: 0 },
      { type: 'text', text: 'Results', page_idx: 3 },
      { type: 'table', table_body: '<table><tr><td>Group</td><td>Mean</td></tr></table>',
        page_idx: 5 },
      { type: 'text', text: 'bad negative', page_idx: -1 },
      { type: 'text', text: 'bad fractional', page_idx: 1.5 },
      { type: 'text', text: 'bad string', page_idx: '2' }
    ]))]
  ]);

  assert.deepEqual(pageEvidenceFromMineruEntries(entries, 'paper/full.md'), [
    { pageNumber: 1, text: 'Paper' },
    { pageNumber: 4, text: 'Results' },
    { pageNumber: 6, text: 'Group Mean' }
  ]);
  entries.set('paper/paper_content_list.json', encoder.encode('{malformed'));
  assert.deepEqual(pageEvidenceFromMineruEntries(entries, 'paper/full.md'), []);
});

test('rendered inline semantics inherit a strictly validated page from their closest block', () => {
  const { appendPageBoundBlock } = loadPageBindingFunctions();
  const article = element();
  const block = element();
  const inline = block.appendChild(element());

  appendPageBoundBlock(article, block, { pageNumber: 8 }, 12);

  assert.equal(block.dataset.pdfPageNumber, '8');
  assert.equal(inline.closest('[data-pdf-page-number]'), block);
  assert.equal(Number(inline.closest('[data-pdf-page-number]').dataset.pdfPageNumber), 8);

  const malformed = element();
  appendPageBoundBlock(article, malformed, { pageNumber: '8' }, 12);
  assert.equal(malformed.dataset.pdfPageNumber, undefined);
});

test('every ordinary parsed renderer branch appends through the page-binding boundary', () => {
  const start = readerSource.indexOf('function renderParsedDocument');
  const end = readerSource.indexOf('\n  async function restoreCachedPdfDocument', start);
  const renderer = readerSource.slice(start, end);
  assert.match(renderer, /bindParsedBlocksToPdfPages/);
  assert.match(renderer, /appendPageBoundBlock\(article, heading, block/);
  assert.match(renderer, /appendPageBoundBlock\(article, pre, block/);
  assert.match(renderer, /appendPageBoundBlock\(article, list, block/);
  assert.match(renderer, /appendPageBoundBlock\(article, quote, block/);
  assert.match(renderer, /appendPageBoundBlock\(article, table, block/);
  assert.match(renderer, /appendPageBoundBlock\(article, paragraph, block/);
  assert.match(renderer, /applyParsedPageBindingSnapshot/);
  assert.match(renderer, /bindingSnapshot && parsed\?\.restored !== true/);
});

test('cached rendering registers a late native-ready identity-bound rebind path', () => {
  assert.match(readerSource, /function restoreCachedPageBindingsAfterNativeReady/);
  assert.match(readerSource, /addEventListener\('brevess:native-pdf-ready'/);
  assert.match(readerSource, /removeEventListener\('brevess:native-pdf-ready'/);
  assert.match(readerSource, /chrome\.storage\.local\.(?:get|set)/);
  assert.match(readerSource, /documentHash/);
  assert.match(readerSource, /documentIdentity/);
});

test('late native-ready event re-renders cached blocks with the matching persisted identity', async () => {
  const helpers = loadPageBindingFunctions();
  const start = readerSource.indexOf('async function restoreCachedPageBindingsAfterNativeReady');
  const end = readerSource.indexOf('\n  async function refreshCachedNativeFigures', start);
  assert.ok(start >= 0 && end > start);
  const listeners = new Map();
  const documentRef = {
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name, handler) {
      if (listeners.get(name) === handler) listeners.delete(name);
    }
  };
  const hash = 'a'.repeat(64);
  const nativeDocument = {
    pageCount: 12, phase: 'text-ready',
    structure: {
      documentHash: hash, documentId: `sha256:${hash}`,
      paragraphs: [{ pageNumber: 11, text: 'Late page' }]
    },
    documentGeneration: 4
  };
  const rawBlocks = [{ id: 'pdf-block-1', type: 'paragraph', text: 'Late page' }];
  const snapshot = helpers.createParsedPageBindingSnapshot(
    [{ ...rawBlocks[0], pageNumber: 11 }], nativeDocument
  );
  const storage = { [`sciPdfParsedPageBindingsV1:${hash}`]: snapshot };
  const renders = [];
  const context = { __brevessNativePdfDocument: undefined };
  const state = { runId: 7, parsedPageBindingCleanup: null };
  const restore = Function(
    'globalThis', 'document', 'chrome', 'SciLLM', 'state',
    'parsedPageBindingIdentity', 'parsedPageBindingStorageKey',
    'applyParsedPageBindingSnapshot', 'bindParsedBlocksToPdfPages',
    'createParsedPageBindingSnapshot', 'persistParsedPageBindingSnapshot',
    'renderParsedDocument',
    `'use strict'; ${readerSource.slice(start, end)}; return restoreCachedPageBindingsAfterNativeReady;`
  )(
    context,
    documentRef,
    { storage: { local: { get: async key => ({ [key]: storage[key] }) } } },
    { markdownToPdfBlocks: () => rawBlocks },
    state,
    native => {
      const value = native?.structure;
      return value && native.pageCount === 12 ? {
        documentHash: value.documentHash,
        documentIdentity: value.documentId.slice(7), pageCount: 12
      } : null;
    },
    value => `sciPdfParsedPageBindingsV1:${value}`,
    helpers.applyParsedPageBindingSnapshot,
    helpers.bindParsedBlocksToPdfPages,
    helpers.createParsedPageBindingSnapshot,
    async () => true,
    parsed => renders.push(parsed)
  );

  assert.equal(await restore({ markdown: 'cached', restored: true }), false);
  assert.equal(renders.length, 0);
  context.__brevessNativePdfDocument = nativeDocument;
  const ready = listeners.get('brevess:native-pdf-ready');
  ready();
  ready();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(renders.length, 1);
  assert.equal(renders[0].pageBindingSnapshot.documentHash, hash);
  assert.equal(listeners.has('brevess:native-pdf-ready'), false);

  context.__brevessNativePdfDocument = undefined;
  assert.equal(await restore({ markdown: 'cached', restored: true }), false);
  const staleReady = listeners.get('brevess:native-pdf-ready');
  state.runId += 1;
  context.__brevessNativePdfDocument = nativeDocument;
  staleReady();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(renders.length, 1, 'an old parse-run closure must never render into a newer run');
  state.parsedPageBindingCleanup?.();
});

test('late page binding is run-bound, coalesces duplicate ready events, and old cleanup cannot render', async () => {
  const start = readerSource.indexOf('async function restoreCachedPageBindingsAfterNativeReady');
  const end = readerSource.indexOf('\n  async function refreshCachedNativeFigures', start);
  const body = readerSource.slice(start, end);
  assert.match(body, /state\.runId/);
  assert.match(body, /documentGeneration/);
  assert.match(body, /inFlight/);
  assert.match(readerSource, /state\.parsedPageBindingCleanup\?\.\(\)/);
});

test('a final native-ready arriving during an in-flight partial attempt is rerun and cleans up', async () => {
  const helpers = loadPageBindingFunctions();
  const start = readerSource.indexOf('async function restoreCachedPageBindingsAfterNativeReady');
  const end = readerSource.indexOf('\n  async function refreshCachedNativeFigures', start);
  const listeners = new Map();
  const documentRef = {
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name, handler) {
      if (listeners.get(name) === handler) listeners.delete(name);
    }
  };
  const hash = 'a'.repeat(64);
  const native = phase => ({
    pageCount: 12, phase, documentGeneration: 4,
    structure: {
      documentHash: hash, documentId: `sha256:${hash}`,
      paragraphs: [{ pageNumber: 11, text: 'Late page' }]
    }
  });
  const rawBlocks = [{ id: 'pdf-block-1', type: 'paragraph', text: 'Late page' }];
  const completeSnapshot = helpers.createParsedPageBindingSnapshot(
    [{ ...rawBlocks[0], pageNumber: 11 }], native('text-ready')
  );
  const context = { __brevessNativePdfDocument: native('partial-index') };
  const state = { runId: 9, parsedPageBindingCleanup: null };
  const renders = [];
  let injectedFinal = false;
  const restore = Function(
    'globalThis', 'document', 'chrome', 'SciLLM', 'state',
    'parsedPageBindingIdentity', 'parsedPageBindingStorageKey',
    'applyParsedPageBindingSnapshot', 'bindParsedBlocksToPdfPages',
    'createParsedPageBindingSnapshot', 'persistParsedPageBindingSnapshot',
    'renderParsedDocument',
    `'use strict'; ${readerSource.slice(start, end)}; return restoreCachedPageBindingsAfterNativeReady;`
  )(
    context, documentRef,
    { storage: { local: { get: async key => ({ [key]: completeSnapshot }) } } },
    { markdownToPdfBlocks: () => rawBlocks }, state,
    helpers.parsedPageBindingIdentity,
    value => `sciPdfParsedPageBindingsV1:${value}`,
    helpers.applyParsedPageBindingSnapshot,
    (...args) => {
      const rebound = helpers.bindParsedBlocksToPdfPages(...args);
      if (!injectedFinal) {
        injectedFinal = true;
        context.__brevessNativePdfDocument = native('text-ready');
        listeners.get('brevess:native-pdf-ready')();
      }
      return rebound;
    },
    helpers.createParsedPageBindingSnapshot,
    async () => true,
    parsed => renders.push(parsed)
  );

  assert.equal(await restore({ markdown: 'cached', restored: true }), true);
  assert.equal(renders.length, 1);
  assert.equal(renders[0].pageBindingSnapshot.textReady, true);
  assert.equal(listeners.has('brevess:native-pdf-ready'), false);
  assert.equal(state.parsedPageBindingCleanup, null);
});

test('real-paper verifier accepts only strict rendered data-pdf-page-number evidence', () => {
  const start = verifierSource.indexOf('async function inspectTargetedLayout');
  const end = verifierSource.indexOf('\nasync function runPaper', start);
  const inspection = verifierSource.slice(start, end);
  assert.match(inspection, /closest\('\[data-pdf-page-number\]'\)/);
  assert.match(inspection, /\^\[1-9\]\\d\*\$/u);
  assert.doesNotMatch(inspection, /data-pdf-page-index/);
  assert.doesNotMatch(inspection, /pdfPageIndex/);
  assert.match(inspection, /await matches\.count\(\)/);
  assert.match(inspection, /matchCount !== 1/);
  assert.doesNotMatch(inspection, /\.first\(\)/);
});
