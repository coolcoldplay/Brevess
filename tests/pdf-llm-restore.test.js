const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');

function section(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}
function harness() {
  const calls = [];
  let semanticReady = true;
  let semanticRevision = 7;
  const semanticContext = () => {
    const quote = 'Measured evidence.';
    const target = { kind: 'paragraph', documentId: 'sha256:pdf-hash',
      documentHash: 'pdf-hash', documentGeneration: 4,
      revision: semanticRevision, semanticCacheKey: `cache-${semanticRevision}`,
      semanticProvenanceKey: `provenance-${semanticRevision}`,
      paragraphId: `semantic-p${semanticRevision}`, pageNumber: 1,
      normalizedStart: 0, normalizedEnd: quote.length,
      expectedNormalizedQuote: quote };
    return { documentHash: 'pdf-hash', documentGeneration: 4,
      revision: semanticRevision, semanticCacheKey: `cache-${semanticRevision}`,
      semanticProvenanceKey: `provenance-${semanticRevision}`,
      navigation: { sections: [{ paragraphTargets: [target], children: [] }] }, target };
  };
  const state = { phase: 'text-ready', documentGeneration: 4,
    structure: { documentHash: 'pdf-hash', paragraphs: [
      { paragraphId: 'pdf-page-1', text: 'Measured evidence.' }
    ] }, resolveSemanticHighlight() { return { status: 'resolved', ranges: [] }; } };
  const context = vm.createContext({
    pendingNativePdfLlmRestore: null, articleWorkspaceLifecycleGeneration: 7,
    __brevessNativePdfDocument: state,
    document: { documentElement: { dataset: {
      pdfWorkspaceReady: 'true', pdfWorkspaceIndexed: 'false'
    } } },
    currentNativePdfRegexProjection: () => ({ documentHash: 'pdf-hash', documentGeneration: 4 }),
    readPdfSemanticNavigationContext: () => semanticReady ? semanticContext() : null,
    renderLlmAnalysis: (...args) => { calls.push(args); return { highlightedCount: 3 }; }
    ,resolvePdfSemanticHighlightLocator: locator => ({
      status: locator?.revision === semanticRevision ? 'resolved' : 'stale'
    }),
    resolvePdfSemanticHighlightFocus: (annotation, context) => {
      const target = context?.target;
      const quote = String(annotation?.quote || annotation?.expectedNormalizedQuote || '');
      const start = target?.expectedNormalizedQuote.indexOf(quote) ?? -1;
      return start >= 0 && target.expectedNormalizedQuote.indexOf(quote, start + 1) < 0
        ? { target, selection: { normalizedStart: start,
          normalizedEnd: start + quote.length, expectedNormalizedQuote: quote },
          reasonCode: '' }
        : { target: null, selection: null, reasonCode: 'PDF_FOCUS_QUOTE_AMBIGUOUS' };
    },
    createPdfSemanticHighlightLocator: (target, selection) => ({
      locatorKind: 'pdf-semantic', ...target, ...selection
    })
  });
  vm.runInContext(section('function nativePdfRegexRestoreReadiness(',
    'function currentNativePdfRegexProjection(') + section('function stageNativePdfLlmRestore(',
    'async function loadNativePdfRegexRestoreFromWorkspace('), context);
  const saved = { rawAnalysis: { annotations: [{ quote: 'Measured evidence.' }] },
    paragraphs: [{ ...state.structure.paragraphs[0] }], confidenceThreshold: 0.9 };
  context.stageNativePdfLlmRestore(saved, 'pdf-hash');
  return { context, calls, state, saved,
    setSemanticReady(value) { semanticReady = value; },
    setSemanticRevision(value) { semanticRevision = value; } };
}

test('saved native AI highlights wait for indexing then render exactly once with original settings', () => {
  const h = harness();
  assert.equal(h.context.restorePendingNativePdfLlmHighlights().status, 'waiting');
  assert.equal(h.calls.length, 0);
  h.context.document.documentElement.dataset.pdfWorkspaceIndexed = 'true';
  assert.equal(h.context.restorePendingNativePdfLlmHighlights().count, 3);
  assert.equal(h.calls[0][0].annotations[0].quote, 'Measured evidence.');
  assert.equal(h.calls[0][2], 0.9);
  assert.equal(h.context.restorePendingNativePdfLlmHighlights().status, 'missing');
  assert.equal(h.calls.length, 1);
});

test('saved native AI pending state survives until matching semantic ownership is ready', () => {
  const h = harness();
  h.context.document.documentElement.dataset.pdfWorkspaceIndexed = 'true';
  h.setSemanticReady(false);
  assert.equal(h.context.restorePendingNativePdfLlmHighlights().status, 'waiting');
  assert.notEqual(h.context.pendingNativePdfLlmRestore, null);
  assert.equal(h.calls.length, 0);
  h.setSemanticReady(true);
  assert.equal(h.context.restorePendingNativePdfLlmHighlights().status, 'applied');
  assert.equal(h.calls.length, 1);
  assert.equal(h.context.restorePendingNativePdfLlmHighlights().status, 'missing');
});

test('semantic saved AI highlights are not discarded as text-changed before ready', () => {
  const h = harness();
  h.saved.rawAnalysis.annotations = [{
    locatorKind: 'pdf-semantic', paragraphId: 'semantic-p1',
    documentHash: 'pdf-hash', documentGeneration: 4, revision: 7,
    semanticCacheKey: 'cache-7', semanticProvenanceKey: 'provenance-7',
    normalizedStart: 0, normalizedEnd: 8, expectedNormalizedQuote: 'Measured'
  }];
  h.saved.paragraphs = [{ paragraphId: 'semantic-p1', text: 'Measured evidence.' }];
  h.context.stageNativePdfLlmRestore(h.saved, 'pdf-hash');
  h.context.document.documentElement.dataset.pdfWorkspaceIndexed = 'true';
  h.setSemanticReady(false);
  assert.equal(h.context.restorePendingNativePdfLlmHighlights().status, 'waiting');
  assert.notEqual(h.context.pendingNativePdfLlmRestore, null);
  h.setSemanticReady(true);
  assert.equal(h.context.restorePendingNativePdfLlmHighlights().status, 'applied');
  assert.equal(h.calls.length, 1);
});

test('semantic saved AI highlights rebind from revision 7 to revision 8 before render', () => {
  const h = harness();
  h.saved.rawAnalysis.annotations = [{
    locatorKind: 'pdf-semantic', paragraphId: 'semantic-p7',
    documentHash: 'pdf-hash', documentGeneration: 4, revision: 7,
    semanticCacheKey: 'cache-7', semanticProvenanceKey: 'provenance-7',
    normalizedStart: 0, normalizedEnd: 8, expectedNormalizedQuote: 'Measured',
    quote: 'Measured'
  }];
  h.saved.paragraphs = [{ paragraphId: 'semantic-p7', text: 'Measured evidence.' }];
  h.context.stageNativePdfLlmRestore(h.saved, 'pdf-hash');
  h.context.document.documentElement.dataset.pdfWorkspaceIndexed = 'true';
  h.setSemanticRevision(8);
  assert.equal(h.context.restorePendingNativePdfLlmHighlights().status, 'applied');
  assert.equal(h.calls.length, 1);
  const rebound = h.calls[0][0].annotations[0];
  assert.equal(rebound.paragraphId, 'semantic-p8');
  assert.equal(rebound.revision, 8);
  assert.equal(rebound.semanticCacheKey, 'cache-8');
  assert.equal(h.context.restorePendingNativePdfLlmHighlights().status, 'missing');
});

test('saved native AI ranges cannot cross documents, lifecycle resets, or changed OCR text', () => {
  for (const mutation of ['document', 'lifecycle', 'text']) {
    const h = harness();
    h.context.document.documentElement.dataset.pdfWorkspaceIndexed = 'true';
    if (mutation === 'document') h.state.structure.documentHash = 'other-pdf';
    if (mutation === 'lifecycle') h.context.articleWorkspaceLifecycleGeneration++;
    if (mutation === 'text') {
      delete h.state.resolveSemanticHighlight;
      h.state.structure.paragraphs[0].text = 'Different OCR text.';
    }
    assert.equal(h.context.restorePendingNativePdfLlmHighlights().status,
      mutation === 'text' ? 'text-changed' : 'stale');
    assert.equal(h.calls.length, 0);
    assert.equal(h.context.pendingNativePdfLlmRestore, null);
  }
});

test('changed native text rejects the saved LLM before it becomes active workspace state', () => {
  const h = harness();
  const savedAnalysis = {
    preparedStudy: { documentId: 'old-analysis' },
    diagnostics: { highlightedCount: 1 },
    reviewOutline: { sections: ['old'] },
    paragraphSummaries: [{ paragraphId: 'pdf-page-1', summary: 'old' }],
    task: { phase: 'completed' },
    llm: h.saved
  };
  h.state.structure.paragraphs[0].text = 'Refined OCR text.';
  const restored = h.context.resolveSavedArticleLlmCheckpoint(
    savedAnalysis, 'exact', h.state.structure
  );
  assert.equal(restored.nativeTextChanged, true);
  assert.equal(restored.analysis, null);
  assert.equal(restored.preparedStudy, null);
  assert.equal(restored.diagnostics, null);
  assert.equal(restored.reviewOutline, null);
  assert.deepEqual(Array.from(restored.paragraphSummaries), []);
  assert.equal(restored.task, null);
  assert.equal(restored.restorableNativePdfLlm, null);
});
