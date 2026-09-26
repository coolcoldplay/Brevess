const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixture = fs.readFileSync(path.join(__dirname, 'archive-page-restore-review.test.js'), 'utf8');
const { harness, copy, functionSource } = new Function('require', '__dirname',
  fixture.slice(0, fixture.indexOf('\ntest(')) +
  '\nreturn { harness, copy, functionSource };')(require, __dirname);
function setup({ visible = true, wrongLocation = false, sourceType = 'semantic' } = {}) {
  const h = harness();
  const annotation = { annotationId: 'restored-semantic', sourceType, quote: 'p = 0.03' };
  const located = [{ annotation, location: { blockId: wrongLocation ? 'other' : 'block',
    startOffset: 0, endOffset: 8 } }];
  Object.assign(h.state, {
    publicArticleChatTurn: copy,
    currentNativePdfSemanticHighlightState: () => ({ required: false, ready: false }),
    restoreManualAnnotations: () => ({ unresolved: [], located }),
    findManualBlockElement: id => id === 'p' ? {} : null,
    findManualBlock: element => element ? { blockId: 'block', element } : null,
    manualReadableText: () => 'p = 0.03',
    document: { querySelector: () => null, querySelectorAll: () => visible ?
      [{ dataset: { annotationId: annotation.annotationId } }] : [] },
    prepareManualDocument: () => { throw Error('No asynchronous preparation allowed'); },
    saveAutomaticAnnotation: () => { throw Error('Do not create or overwrite persisted annotations'); }
  });
  h.state.SciLLM.findCanonicalQuoteSourceSpan = (text, quote) => text === quote ?
    { sourceStart: 0, sourceEnd: 8 } : null;
  try { vm.runInContext(functionSource('inspectRestoredHtmlSemanticTurns'), h.state); }
  catch (error) { if (!error.message.includes('inspectRestoredHtmlSemanticTurns')) throw error; }
  const turn = { turnId: 'search', question: 'find result', intent: 'highlight', status: 'completed',
    answerBlocks: [{ evidence: [{ paragraphId: 'p', quote: 'p = 0.03', verificationStatus: 'verified' }] }] };
  const target = { documentId: 'doc-a', documentHash: 'hash', canonicalUrl: 'https://example.org/paper' };
  const apply = (turns = [turn], extra = {}) => h.state.applyArticleWorkspaceAssetsUnsafe({
    assets: [{ relativePath: 'annotations/highlights.json', content: { annotations: [annotation] } },
      { relativePath: 'chat/index.json', content: { turns } }],
    match: 'exact', persistRestored: false, deferManualSideEffects: true,
    committedDocumentRequired: true, committedDocumentTarget: target,
    committedDocument: { ...target, revision: 7, annotations: [annotation] }, ...extra
  });
  return { ...h, apply, turn, annotation };
}
test('already rendered authoritative HTML semantic annotation clears false pending without writes', async () => {
  const h = setup(), result = await h.apply();
  assert.equal(Boolean(result.manualRebuildDeferred), false);
  assert.equal(result.semanticHighlightsRestored, 1);
  assert.equal(h.state.articleChatState.turns[0].matchCount, 1);
  assert.deepEqual(copy(h.state.currentManualDocument.record.annotations), [h.annotation]);
  assert.deepEqual(h.saved, []);
});
test('location plan alone, wrong paragraph and manual marks do not prove semantic display', async () => {
  for (const options of [{ visible: false }, { wrongLocation: true }, { sourceType: 'manual' }]) {
    const h = setup(options), result = await h.apply();
    assert.equal(result.manualRebuildDeferred, true);
    assert.equal(result.semanticHighlightsRestored, 0);
    assert.deepEqual(h.saved, []);
  }
});
test('missing or unverified quote stays pending without inventing annotations', async () => {
  for (const item of [{ paragraphId: 'absent' }, { quote: 'another quote' },
    { verificationStatus: 'unverified' }]) {
    const h = setup(); Object.assign(h.turn.answerBlocks[0].evidence[0], item);
    const result = await h.apply();
    assert.equal(result.manualRebuildDeferred, true);
    assert.equal(result.semanticHighlightsRestored, 0);
    assert.deepEqual(h.saved, []);
  }
});
test('duplicate evidence counts one displayed range and partial display remains pending', async () => {
  const h = setup(), evidence = h.turn.answerBlocks[0].evidence;
  evidence.push(copy(evidence[0]), { paragraphId: 'absent', quote: 'p = 0.03', verificationStatus: 'verified' });
  const result = await h.apply();
  assert.equal(result.manualRebuildDeferred, true);
  assert.equal(result.semanticHighlightsRestored, 1);
  assert.equal(h.state.articleChatState.turns[0].unresolvedCount, 1);
});
test('changed-content restore cannot claim confirmed semantic projection', async () => {
  const h = setup(), result = await h.apply([h.turn], { match: 'content-changed' });
  assert.equal(result.manualRebuildDeferred, true);
  assert.equal(result.semanticHighlightsRestored, 0);
});
