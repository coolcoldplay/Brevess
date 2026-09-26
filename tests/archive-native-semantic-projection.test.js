const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixture = fs.readFileSync(path.join(__dirname, 'archive-page-restore-review.test.js'), 'utf8');
const { harness, copy, functionSource, manualAsset } = new Function('require', '__dirname',
  fixture.slice(0, fixture.indexOf("\ntest(")) +
  '\nreturn { harness, copy, functionSource, manualAsset };')(require, __dirname);
const savedTurn = { turnId: 'saved-search', question: 'find the result', intent: 'highlight',
  status: 'completed', answerBlocks: [{ blockId: 'answer', markdown: 'p = 0.03',
    evidence: [{ paragraphId: 'semantic-p', quote: 'p = 0.03' }] }] };
function setup({ ready = true, hash = 'hash', required = true, unresolved = false } = {}) {
  const h = harness(), writes = [], paints = [];
  const context = { documentHash: hash, documentGeneration: 5 };
  Object.assign(h.state, {
    publicArticleChatTurn: copy,
    currentNativePdfSemanticHighlightState: () => ({ required, ready,
      context: required && ready ? context : null }),
    __brevessNativePdfDocument: { resolveSemanticHighlight() {} },
    resolvePdfSemanticHighlightFocus: evidence => ({ target: { paragraphId: evidence.paragraphId },
      selection: { quote: evidence.quote } }),
    createPdfSemanticHighlightLocator: (target, selection) => ({ ...target,
      normalizedStart: 0, normalizedEnd: selection.quote.length,
      expectedNormalizedQuote: selection.quote }),
    resolvePdfSemanticHighlightLocator: () => unresolved ? { status: 'unresolved' } :
      { status: 'resolved', ranges: [{ pageNumber: 1 }] },
    addPdfSemanticHighlightDiagnostic: diagnostics => { diagnostics.unresolvedCount++; },
    clearNativePdfSemanticChatHighlights: id => h.state.nativePdfSemanticChatHighlightsByTurn.delete(id),
    nativePdfSemanticChatHighlightsByTurn: new Map(),
    paintNativePdfSemanticChatPage: (entry, page) => paints.push({ entry: copy(entry), page }),
    scheduleArticleWorkspaceArtifactsSave: () => writes.push('save'),
    prepareManualDocument: () => { throw Error('restore must not prepare or write manual records'); }
  });
  // Load helpers only after implementation exists; the old apply path still
  // executes on RED and demonstrates the missing projection.
  for (const name of ['renderNativePdfSemanticAnnotationsFromTurn',
    'projectRestoredNativePdfSemanticTurns']) {
    try { vm.runInContext(functionSource(name), h.state); }
    catch (error) { if (!String(error.message).includes(name)) throw error; }
  }
  return { ...h, writes, paints };
}
const assets = () => [manualAsset,
  { relativePath: 'chat/index.json', content: { turns: [copy(savedTurn)] } }];

test('committed ready PDF turns synchronously restore overlays without new persistence', async () => {
  const h = setup(), result = await h.apply(assets());
  assert.equal(h.paints.length, 1);
  assert.equal(result.semanticHighlightsRestored, 1);
  assert.notEqual(result.manualRebuildDeferred, true);
  assert.equal(h.state.articleChatState.turns[0].matchCount, 1);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(copy(h.state.currentManualDocument.record.annotations), manualAsset.content.annotations);
});

test('unready PDF, wrong document and HTML remain deferred without painting or writes', async () => {
  for (const options of [{ ready: false }, { hash: 'other-document' }, { required: false }]) {
    const h = setup(options), result = await h.apply(assets());
    assert.equal(result.manualRebuildDeferred, true);
    assert.equal(h.paints.length, 0);
    assert.deepEqual(h.writes, []);
  }
});

test('unresolved native PDF quote keeps explicit incomplete status after projection attempt', async () => {
  const h = setup({ unresolved: true }), result = await h.apply(assets());
  assert.equal(result.manualRebuildDeferred, true);
  assert.equal(result.semanticHighlightsRestored, 0);
  assert.equal(h.state.articleChatState.turns[0].unresolvedCount, 1);
  assert.deepEqual(h.writes, []);
});

test('turn-file-only restores use the same trusted synchronous projection', async () => {
  const h = setup();
  const result = await h.state.applyArticleWorkspaceAssetsUnsafe({
    assets: [], turns: [copy(savedTurn)], match: 'exact', persistRestored: false,
    deferManualSideEffects: true, committedDocumentRequired: true,
    committedDocumentTarget: { documentId: 'doc-a', documentHash: 'hash' }
  });
  assert.equal(result.semanticHighlightsRestored, 1);
  assert.notEqual(result.manualRebuildDeferred, true);
  assert.deepEqual(h.writes, []);
});

test('explicit committed chat replacement removes overlays for turns no longer present', async () => {
  const h = setup();
  h.state.nativePdfSemanticChatHighlightsByTurn.set('old-turn', { items: [{}] });
  await h.apply(assets());
  assert.equal(h.state.nativePdfSemanticChatHighlightsByTurn.has('old-turn'), false);
  assert.equal(h.state.nativePdfSemanticChatHighlightsByTurn.has(savedTurn.turnId), true);
});

test('explicit empty committed chat clears only PDF chat overlay memory, with no document writes', async () => {
  const h = setup();
  h.state.nativePdfSemanticChatHighlightsByTurn.set('old-turn', { items: [{}] });
  const result = await h.apply([manualAsset,
    { relativePath: 'chat/index.json', content: { turns: [] } }]);
  assert.equal(h.state.nativePdfSemanticChatHighlightsByTurn.size, 0);
  assert.notEqual(result.manualRebuildDeferred, true);
  assert.deepEqual(h.writes, []);
});

test('unconfirmed and changed-content restores never rebuild or clear PDF overlays', () => {
  for (const input of [{ committedDocumentRequired: false },
    { committedDocumentRequired: true, match: 'content-changed' }]) {
    const h = setup();
    h.state.nativePdfSemanticChatHighlightsByTurn.set('old-turn', { items: [{}] });
    const result = h.state.projectRestoredNativePdfSemanticTurns([copy(savedTurn)], {
      committedDocumentTarget: { documentHash: 'hash' }, ...input
    });
    assert.equal(result.deferred, true);
    assert.equal(h.state.nativePdfSemanticChatHighlightsByTurn.has('old-turn'), true);
    assert.equal(h.paints.length, 0);
  }
});
