const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../content.js'), 'utf8');
const classSource = source.slice(source.indexOf('class SciPaperHighlighter'),
  source.indexOf('// DOM-independent manual annotation UI helpers: start'));

function create() {
  const structure = { documentHash: 'pdf-hash', paragraphs: [
    { paragraphId: 'pdf-page-1', pageNumber: 1, text: 'The result was clear. No effect here. Another result.' },
    { paragraphId: 'pdf-page-2', pageNumber: 2, text: 'This result is on the next page.' }
  ] };
  const events = new Map();
  const document = { addEventListener: (name, handler) => events.set(name, handler),
    getElementById: () => null, querySelectorAll: () => [],
    createTreeWalker: () => { throw new Error('PDF text DOM must never be walked or wrapped'); } };
  const native = { __brevessNativePdfDocument: { structure, documentGeneration: 1 } };
  const Class = new Function('document', 'globalThis', 'activeNativePdfStructure', 'SciLLM',
    'console', classSource + '\nreturn SciPaperHighlighter;')(document, native,
    () => structure, { findScientificSentenceBounds: (text, start, end) => ({
      start: text.lastIndexOf('.', start) + 1, end: text.indexOf('.', end) + 1
    }) }, { log() {} });
  return { instance: new Class(), events };
}
const rules = { result: { isRegex: true, patterns: ['result'], color: '#ff0', name: '结果' },
  empty: { isRegex: true, patterns: ['(?=r)'], name: '空匹配' } };

test('PDF regex indexes unmounted pages, respects paragraph filters, and ignores zero-width matches', () => {
  const { instance } = create();
  assert.deepEqual(instance.applyHighlight(rules, 'word', { analysisModeId: 'quick' }),
    { result: 3, empty: 0 });
  const matches = instance.nativePdfModes.get('quick').matches;
  assert.equal(matches.length, 3);
  assert.deepEqual(matches.map(item => item.pageNumber), [1, 1, 2]);
  assert.ok(matches.every(item => item.quote === 'result'));
  assert.deepEqual(instance.applyHighlight(rules, 'sentence', {
    analysisModeId: 'critical', allowedParagraphIds: new Set(['pdf-page-1'])
  }), { result: 2, empty: 0 });
  assert.equal(instance.nativePdfModes.get('critical').matches[0].quote, 'The result was clear.');
  instance.clearHighlight('critical');
  assert.ok(instance.nativePdfModes.has('quick'));
  assert.equal(instance.nativePdfModes.has('critical'), false);
  assert.deepEqual(instance.getMatchCounts(rules), { result: 2, empty: 0 });
  instance.clearHighlight();
  assert.equal(instance.nativePdfModes.size, 0);
});

test('PDF regex page remount repaints stored modes rather than recounting or editing text', () => {
  const { instance, events } = create();
  const painted = [];
  instance.paintNativePage = (entry, page) => painted.push([entry.modeId, page]);
  instance.applyHighlight(rules, 'word', { analysisModeId: 'quick' });
  painted.length = 0;
  events.get('brevess:pdf-page-rendered')({ detail: { pageNumber: 2 } });
  assert.deepEqual(painted, [['quick', 2]]);
  assert.equal(instance.matchCounts.result, 3);
});

test('native PDF regex restore waits for the exact indexed document and page projection', () => {
  const start = source.indexOf('function nativePdfRegexRestoreReadiness(');
  const end = source.indexOf('\nfunction currentNativePdfRegexProjection', start);
  assert.ok(start >= 0 && end > start);
  const readiness = new Function(`${source.slice(start, end)}\n` +
    'return nativePdfRegexRestoreReadiness;')();
  const request = { categories: { result: {} } };
  const pending = {
    request, expectedDocumentHash: 'pdf-hash', workspaceLifecycle: 7
  };
  const native = {
    phase: 'text-ready', documentGeneration: 4,
    structure: { documentHash: 'pdf-hash' }
  };
  const exact = {
    workspaceLifecycle: 7, workspaceReady: true, workspaceIndexed: true,
    projection: { documentHash: 'pdf-hash', documentGeneration: 4 }
  };
  assert.equal(readiness(pending, native, exact), 'ready');
  assert.equal(readiness(pending, native, { ...exact, workspaceIndexed: false }), 'waiting');
  assert.equal(readiness(pending, native, { ...exact, projection: null }), 'waiting');
  assert.equal(readiness(pending, {
    ...native, structure: { documentHash: 'other-pdf' }
  }, exact), 'stale');
  assert.equal(readiness(pending, native, { ...exact, workspaceLifecycle: 8 }), 'stale');

  const semanticNative = { ...native, resolveSemanticHighlight() {} };
  assert.equal(readiness(pending, semanticNative, exact), 'waiting',
    'an owned resolver must not consume restore state before semantic navigation is ready');
  const semanticContext = {
    documentHash: 'pdf-hash', documentGeneration: 4, revision: 7,
    semanticCacheKey: 'cache-7', semanticProvenanceKey: 'provenance-7'
  };
  assert.equal(readiness(pending, semanticNative, { ...exact, semanticContext }), 'ready');
  assert.equal(readiness(pending, semanticNative, {
    ...exact, semanticContext: { ...semanticContext, documentGeneration: 3 }
  }), 'waiting');
});

test('workspace highlight restore stages exact native requests and clears stale pending state', () => {
  assert.match(source, /byPath\.get\('annotations\/highlights\.json'\)/);
  assert.match(source, /match === 'exact'[\s\S]{0,180}savedHighlights\.lastRegexRequest/);
  assert.match(source, /stageNativePdfRegexRestore\(lastRegexHighlightRequest, nativeHash\)/);
  assert.match(source, /if \(lastRegexHighlightRequest === pending\.request\) lastRegexHighlightRequest = null/);
  assert.match(source, /pendingNativePdfRegexRestore = null;[\s\S]{0,180}standaloneReviewParagraphSummaries\.clear/);
  assert.match(source, /loadNativePdfRegexRestoreFromWorkspace\(workspace, structure, native\)/);
  assert.match(source, /ARTICLE_WORKSPACE_GET_ASSET[\s\S]{0,300}annotations\/highlights\.json/);
  assert.match(source, /currentArticleWorkspace\?\.workspaceId !== workspace\.workspaceId/);
  assert.match(source, /currentNative\?\.structure\?\.documentHash[\s\S]{0,100}expectedDocumentHash/);
  assert.match(source, /currentNative\?\.documentGeneration[\s\S]{0,80}expectedGeneration/);
});

test('regex restore retains pending state until semantic ownership is ready and consumes once', () => {
  const readinessStart = source.indexOf('function nativePdfRegexRestoreReadiness(');
  const readinessEnd = source.indexOf('\nasync function loadNativePdfWorkspaceCheckpoint', readinessStart);
  const restoreStart = source.indexOf('function restorePendingNativePdfRegexHighlights(');
  const restoreEnd = source.indexOf('\nfunction stageNativePdfRegexRestore(', restoreStart);
  let semanticReady = false;
  let applyCalls = 0;
  const context = {
    pendingNativePdfRegexRestore: {
      request: { categories: { result: {} }, mode: 'word', analysisModeId: 'regex' },
      expectedDocumentHash: 'pdf-hash', workspaceLifecycle: 5
    },
    lastRegexHighlightRequest: null,
    articleWorkspaceLifecycleGeneration: 5,
    globalThis: { __brevessNativePdfDocument: {
      phase: 'text-ready', documentGeneration: 4,
      structure: { documentHash: 'pdf-hash' }, resolveSemanticHighlight() {}
    } },
    document: { documentElement: { dataset: {
      pdfWorkspaceReady: 'true', pdfWorkspaceIndexed: 'true'
    } } },
    currentNativePdfRegexProjection: () => ({
      documentHash: 'pdf-hash', documentGeneration: 4
    }),
    readPdfSemanticNavigationContext: () => semanticReady ? ({
      documentHash: 'pdf-hash', documentGeneration: 4, revision: 7,
      semanticCacheKey: 'cache-7', semanticProvenanceKey: 'provenance-7'
    }) : null,
    highlighter: { lastNativePdfHighlightDiagnostics: {}, applyHighlight() {
      applyCalls += 1; return { result: 2 };
    } },
    selectedArticleAnalysisParagraphIds: () => new Set()
  };
  Object.assign(context, new Function(...Object.keys(context),
    `${source.slice(readinessStart, readinessEnd)}\n${source.slice(restoreStart, restoreEnd)}\n` +
    'return { nativePdfRegexRestoreReadiness, restorePendingNativePdfRegexHighlights, ' +
    'pendingState: () => pendingNativePdfRegexRestore };')(
    ...Object.values(context)));
  assert.equal(context.restorePendingNativePdfRegexHighlights().status, 'waiting');
  assert.notEqual(context.pendingState(), null);
  assert.equal(applyCalls, 0);
  semanticReady = true;
  assert.equal(context.restorePendingNativePdfRegexHighlights().status, 'applied');
  assert.equal(applyCalls, 1);
  assert.equal(context.pendingState(), null);
  assert.equal(context.restorePendingNativePdfRegexHighlights().status, 'missing');
  assert.equal(applyCalls, 1);
});
