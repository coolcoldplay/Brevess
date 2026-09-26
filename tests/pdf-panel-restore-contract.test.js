const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const citationApi = require('../core/article-chat-citations.js');
const { buildPdfSemanticIndex } = require('../core/pdf-semantic-index.js');
const { createPdfSemanticCompatibilityAdapter } = require('../core/pdf-semantic-compat.js');

const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
function extract(name) {
  let start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const body = source.indexOf(') {', start) + 2;
  let depth = 0;
  for (let n = body; n < source.length; n += 1) {
    if (source[n] === '{') depth += 1;
    if (source[n] === '}') depth -= 1;
    if (!depth) return source.slice(start, n + 1);
  }
  assert.fail(`unterminated ${name}`);
}

function harness({ repeated = false, quote = 'Verified panel evidence.' } = {}) {
  const hash = 'a'.repeat(64);
  const rawText = `Context before. ${quote}${repeated ? ` ${quote}` : ''} Context after.`;
  const pages = [{ pageNumber: 1, text: rawText }];
  const semantic = { schemaVersion: 1, documentId: `sha256:${hash}`,
    adapterId: 'pdf-native', documentHash: hash, documentGeneration: 5,
    revision: 6, pageCount: 1,
    index: buildPdfSemanticIndex({ documentHash: hash, revision: 6, pages }) };
  const native = { structure: { adapterId: 'pdf-native', documentId: semantic.documentId,
    documentHash: hash, paragraphs: [], pages }, documentGeneration: 5, pageCount: 1 };
  const compatibility = createPdfSemanticCompatibilityAdapter({
    semanticDocument: semantic, nativeDocument: native
  });
  const focusCalls = [];
  native.getSemanticNavigation = () => compatibility.semanticNavigation;
  native.resolveSemanticHighlight = locator => compatibility.resolvePdfSemanticRange(
    locator.paragraphId, locator.normalizedStart, locator.normalizedEnd,
    locator.expectedNormalizedQuote
  );
  native.focusSemanticTarget = async (target, selection) => {
    focusCalls.push({ target, selection });
    return { focused: true, focusedGranularity: selection ? 'sentence' : 'paragraph',
      precision: 'exact-raw', pageNumber: 1 };
  };
  native.focusPage = () => { throw new Error('page degradation must not occur'); };
  const figure = { figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ['D'] };
  const oldBinding = { figureId: figure.figureId, binding: { documentHash: hash,
    documentGeneration: 2, semanticRevision: 6 },
    semanticContextDigest: 'b'.repeat(64), assetProof: null };
  const paragraphId = semantic.index.paragraphs[0].paragraphId;
  const location = { paragraphId, sentenceId: 'sentence-1',
    expectedNormalizedQuote: quote, locatorStatus: 'resolved', locatorPrecision: 'exact-raw',
    sourceFragments: [{ pageNumber: 1, start: rawText.indexOf(quote),
      end: rawText.indexOf(quote) + quote.length }] };
  const target = { kind: 'figure-followup-paragraph', figureId: figure.figureId,
    panelId: 'D', paragraphId, sentenceId: 'sentence-1', quote,
    locatorKind: 'pdf-semantic', scope: { kind: 'pdf-figure-panel',
      figureId: figure.figureId, panelId: 'D' }, binding: oldBinding, location };
  const sourceRef = { ...target, kind: 'paragraph', ref: paragraphId };
  const followup = { figureId: figure.figureId, panel: 'D', topics: [],
    answer: 'Stored answer.', basis: 'caption_context', claimBoundary: 'Stored boundary.',
    pdfEvidenceBinding: oldBinding, sourceRefs: [sourceRef] };
  const history = [
    { historyId: 'question-1', role: 'user', content: 'Stored question.',
      pdfEvidenceBinding: oldBinding },
    { historyId: 'answer-1', role: 'assistant', content: followup.answer,
      pdfEvidenceBinding: oldBinding, sourceRefs: [sourceRef] }
  ];
  const stored = { figures: [{ ...figure, panelFollowups: { D: followup },
    panelFollowupHistories: { D: history } }] };
  const globals = { __brevessNativePdfDocument: native,
    __brevessPdfSemanticDocument: semantic, __brevessPdfSemanticCompatibility: compatibility,
    __brevessNativePdfFigures: { figures: [figure] } };
  const deps = {
    globalThis: globals, SciLLM: { ...citationApi,
      figurePanelDisplayId: () => '1D', publicFigureWorkspaceDraft: value => value,
      selectFigureImageSource: () => '', mergeSupplementalFigureAssets: () => [] },
    activeNativePdfStructure: () => native.structure,
    pdfFigureProductionEnvelopeRecords: new Map(),
    pdfFigureProductionEnvelopeRecordOwners: new Map(),
    pdfFigureProductionEnvelopes: new Map(), pdfFigureProductionEnvelopeOwners: new Map(),
    hashArticleChatParagraphText: text => String(text),
    document: { baseURI: 'chrome-extension://test/pdf-reader.html' },
    getFigureWorkspaceInventory: () => [figure],
    figureWalkthroughState: new Map(), restoredFigureWorkspaceSnapshot: stored,
    isUsableFigureAnalysisResult: value => Boolean(value),
    cloneUserEditedFigureValue: structuredClone,
    normalizeArticleNavigatorText: value => String(value || ''),
    applyUserFigureResultEdits: value => value,
    supplementalPdfBinding: null, supplementalFigureAssets: [],
    getSupplementalMaterialDiscovery: () => ({ materials: [], references: [] }),
    articleWorkspaceLifecycleGeneration: 1, figureWorkspaceDraft: {},
    getPublicFigureAnalysisStatus: () => ({}), lastFigureAnalysis: null,
    supplementalParentSyncState: {}, crossFigureLogicState: { status: 'idle' },
    serializeCrossFigureMechanismCleanupIntents: () => [],
    findFigureAnalysisTarget: () => { throw new Error('DOM Figure fallback must not occur'); },
    resolveWorkspaceParagraph: () => { throw new Error('DOM paragraph fallback must not occur'); }
  };
  const normalizers = source.slice(source.indexOf('function isSafePanelFollowupDataRecord('),
    source.indexOf('async function askFigurePanelWithLLM('));
  const semanticFunctions = source.slice(source.indexOf('function pdfSemanticNavigationIdentityMatches('),
    source.indexOf('\nfunction resolveWorkspaceParagraph('));
  const names = ['pdfFigureProductionEnvelopeRecordKey', 'getPdfFigureProductionEnvelope',
    'currentPdfFigureProductionBinding', 'samePdfFigureProductionBinding',
    'samePdfFigureProductionAssetProof', 'pdfFigureProductionError',
    'createPdfSemanticHighlightLocator', 'isPdfSemanticHighlightLocator',
    'resolvePdfSemanticHighlightLocator', 'normalizeRestoredFigureWorkspace', 'buildFigureWorkspaceSnapshot',
    'focusFigureFollowupParagraphSource'];
  const api = new Function(...Object.keys(deps), `
    let activePdfSemanticNavigationContext = null, pdfSemanticFocusSequence = 0;
    ${normalizers}\n${semanticFunctions}\n${names.map(extract).join('\n')}
    return { restore: normalizeRestoredFigureWorkspace, snapshot: buildFigureWorkspaceSnapshot,
      normalize: normalizeFigurePanelFollowupCollections, requestMemory: currentFigurePanelRequestMemory,
      focus: focusFigureFollowupParagraphSource };`)(...Object.values(deps));
  return { api, globals, figure, oldBinding, target, followup, history, stored, focusCalls };
}

test('empty process registry preserves PDF Panel history and citations through restore and snapshot', () => {
  const h = harness();
  const before = JSON.stringify(h.stored);
  const expected = h.api.normalize(h.figure, { D: h.followup }, { D: h.history });
  const restored = h.api.restore(h.stored).figures[0];
  const snapshot = h.api.snapshot().figures[0];
  for (const value of [expected, restored, snapshot]) {
    assert.equal(value.panelFollowupHistories.D.length, 2);
    assert.deepEqual(value.panelFollowups.D.pdfEvidenceBinding, h.oldBinding);
    assert.equal(value.panelFollowups.D.sourceRefs.filter(ref => ref.kind === 'paragraph').length, 1);
    assert.equal(JSON.stringify(value.panelFollowupHistories), JSON.stringify(expected.panelFollowupHistories));
    assert.equal(JSON.stringify(value.panelFollowups), JSON.stringify(expected.panelFollowups));
  }
  assert.equal(JSON.stringify(h.stored), before, 'never mutate the stored source or re-stamp its proof');
  const memory = h.api.requestMemory(h.figure, 'D', { panel: 'D',
    directObservation: 'Old model observation.', pdfEvidenceBinding: h.oldBinding },
  restored.panelFollowupHistories.D, { pdfFigureContext: { figure: h.figure,
    ...h.oldBinding } });
  assert.deepEqual(memory, { panel: { panel: 'D' }, history: [] });
});

test('same-PDF historical Panel citation resolves its current unique sentence without provider re-admission', async () => {
  const h = harness();
  const before = JSON.stringify(h.target);
  const result = await h.api.focus(h.target);
  assert.equal(result.focused, true);
  assert.equal(result.focusedGranularity, 'sentence');
  assert.equal(h.focusCalls.length, 1);
  assert.equal(h.focusCalls[0].selection.expectedNormalizedQuote, h.target.quote);
  assert.equal(JSON.stringify(h.target), before);
});

test('restored PDF citation preserves scientific comparisons rather than interpreting them as HTML', async () => {
  const quote = 'For 102 cells, p<0.05 and the fold change was >1.5.';
  const h = harness({ quote });
  const restored = h.api.restore(h.stored).figures[0];
  const sourceRef = restored.panelFollowups.D.sourceRefs.find(item => item.kind === 'paragraph');
  assert.equal(sourceRef.quote, quote);
  assert.equal(sourceRef.location.expectedNormalizedQuote, quote);
  const result = await h.api.focus({ ...h.target, quote: sourceRef.quote, location: sourceRef.location });
  assert.equal(result.focused, true);
  assert.equal(h.focusCalls[0].selection.expectedNormalizedQuote, quote);
});

test('exact PDF Panel citation retains spaced closing reference punctuation in its raw range', async () => {
  const quote = 'Microglia motility was measured by acquiring z- stacks spanning 100 μm in the stratum radiatum (SR) of the dorsal hippocampus ( Figure 1b ).';
  const h = harness({ quote });
  const result = await h.api.focus(h.target);
  assert.equal(result.focused, true);
  assert.equal(h.focusCalls.length, 1);
  assert.equal(h.focusCalls[0].selection.expectedNormalizedQuote, quote);
  assert.equal(h.focusCalls[0].selection.normalizedEnd - h.focusCalls[0].selection.normalizedStart,
    quote.length);
});

test('non-exact whitespace-equivalent PDF citation still uses the bounded canonical fallback', async () => {
  const quote = 'The comparison was significant.';
  const h = harness({ quote });
  h.target.location.expectedNormalizedQuote = 'The comparison   was significant.';
  const result = await h.api.focus(h.target);
  assert.equal(result.focused, true);
  assert.equal(h.focusCalls[0].selection.expectedNormalizedQuote, quote);
});

for (const [label, mutate] of [
  ['another PDF hash', target => { target.binding.binding.documentHash = 'c'.repeat(64); }],
  ['foreign Panel scope', target => { target.scope.panelId = 'A'; }],
  ['foreign Figure scope', target => { target.scope.figureId = 'figure-2'; }],
  ['malformed location paragraph', target => { target.location.paragraphId = 'pdf-paragraph:ffffffffffffffff'; }],
  ['invalid quote control character', target => { target.location.expectedNormalizedQuote += '\u0000'; }],
  ['oversized locator text', target => { target.location.expectedNormalizedQuote = 'x'.repeat(50001); }],
  ['raw fragment contradicting the quote', target => {
    target.location.sourceFragments = [{ pageNumber: 1, start: 0, end: 15 }];
  }]
]) {
  test(`restored PDF Panel citation rejects ${label} before any native focus`, async () => {
    const h = harness();
    const target = structuredClone(h.target);
    mutate(target);
    const result = await h.api.focus(target);
    assert.notEqual(result?.focused, true);
    assert.equal(h.focusCalls.length, 0);
  });
}

test('restored PDF Panel citation rejects an ambiguous quote without paragraph degradation', async () => {
  const h = harness({ repeated: true });
  const result = await h.api.focus(h.target);
  assert.notEqual(result?.focused, true);
  assert.equal(h.focusCalls.length, 0);
});
