const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixture = fs.readFileSync(path.join(__dirname, 'archive-page-restore-review.test.js'), 'utf8');
const { harness, copy, functionSource } = new Function('require', '__dirname',
  fixture.slice(0, fixture.indexOf('\ntest(')) + '\nreturn { harness, copy, functionSource };')(require, __dirname);
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const target = { documentId: 'doc-a', documentHash: 'hash', canonicalUrl: 'https://example.org/paper' };
function setup() {
  const h = harness(), paints = [], clears = [], marks = [], events = [];
  const element = { isConnected: true, dataset: { sciLlmParagraphId: 'p' },
    protected: [], closest: () => null, querySelectorAll() { return this.protected; } };
  const node = { textContent: 'The result is significant.', parentElement: element };
  const paragraph = { paragraphId: 'p', sourceKey: 'source-p', textHash: 'text-hash', text: node.textContent };
  const record = { ...target, revision: 7, annotations: [{ annotationId: 'manual-other', note: 'keep' }] };
  Object.assign(h.state, {
    currentManualDocument: { documentId: target.documentId, record: copy(record) },
    nativePdfSemanticChatHighlightsByTurn: new Map(),
    currentArticleStructure: { revision: 4, paragraphs: [paragraph] },
    currentManualBlocks: [{ blockId: 'p', element, text: node.textContent }],
    currentNativePdfSemanticHighlightState: () => ({ required: false, ready: false }),
    publicArticleChatTurn: copy,
    manualReadableText: () => node.textContent,
    collectManualTextNodes: () => [node], collectLlmTextNodes: () => [node],
    locateManualDomOffset: (_nodes, offset) => ({ node, offset }),
    findManualBlockElement: id => id === 'p' ? element : null,
    findManualBlock: el => el === element ? h.state.currentManualBlocks[0] : null,
    withArticleStructureInternalRewriteRoots: (_roots, run) => run(),
    clearLlmHighlights: mode => { clears.push(mode); for (let i = marks.length - 1; i >= 0; i--)
      if (marks[i].dataset.analysisModeId === mode) marks.splice(i, 1); },
    applyLlmHighlights: (annotations, meta) => {
      paints.push({ annotations: copy(annotations), meta: copy(meta) }); events.push('paint');
      h.state.clearLlmHighlights(meta.readingViewId);
      annotations.forEach(() => marks.push({ dataset: { analysisModeId: meta.readingViewId },
        isConnected: true, parentElement: element }));
      return { highlightedCount: annotations.length, rejectedCount: 0 };
    },
    document: {
      querySelectorAll(selector) {
        if (selector === '[data-sci-llm-paragraph-id]') return [element];
        if (selector.includes('sci-semantic-annotation')) return [];
        if (selector.includes('data-restored-chat-turn-id')) return marks.filter(m => m.dataset.restoredChatTurnId);
        if (selector.includes('sci-llm-highlight')) return marks;
        return [];
      },
      querySelector: () => null,
      createRange() { let start = 0, end = 0; return {
        setStart(_node, offset) { start = offset; }, setEnd(_node, offset) { end = offset; },
        toString: () => node.textContent.slice(start, end),
        intersectsNode: () => true, get collapsed() { return start === end; }
      }; }
    },
    prepareManualDocument: () => { throw Error('No async prepare'); },
    saveAutomaticAnnotation: () => { throw Error('No annotation write'); },
    scheduleArticleWorkspaceArtifactsSave: () => { throw Error('No persistence'); }
  });
  Object.assign(h.state.SciLLM, require('../core/article-chat-citations.js'),
    { normalizeTextWithOffsets: require('../core/article-extractor.js').normalizeTextWithOffsets });
  for (const name of ['restoredHtmlSemanticChatModeId', 'clearRestoredHtmlSemanticChatHighlights',
    'planRestoredHtmlSemanticTurn', 'projectRestoredHtmlSemanticTurns', 'clearNativePdfSemanticChatHighlights']) {
    if (source.includes(`function ${name}(`)) vm.runInContext(functionSource(name), h.state);
  }
  const turn = { turnId: 'search', question: 'find result', intent: 'highlight', status: 'completed',
    answerBlocks: [{ blockId: 'answer', markdown: 'result', evidence: [{ paragraphId: 'p',
      sourceKey: 'source-p', textHash: 'text-hash', documentHash: 'hash',
      quote: 'The result is significant.', verificationStatus: 'verified' }] }] };
  const apply = (turns = [turn], extra = {}) => h.state.applyArticleWorkspaceAssetsUnsafe({
    assets: [{ relativePath: 'chat/index.json', content: { turns } }], match: 'exact',
    persistRestored: false, deferManualSideEffects: true, committedDocumentRequired: true,
    committedDocumentTarget: target, ...extra
  });
  return { ...h, apply, turn, paragraph, node, element, marks, paints, clears, events, record };
}

test('trusted exact HTML turn-only restoration paints a dedicated mode without record writes', async () => {
  const h = setup(), result = await h.apply();
  assert.equal(result.semanticHighlightsRestored, 1);
  assert.equal(Boolean(result.manualRebuildDeferred), false);
  assert.equal(h.marks[0].dataset.restoredChatTurnId, 'search');
  assert.equal(h.paints[0].meta.readingViewId, 'restored-html-chat:search');
  assert.deepEqual(copy(h.state.currentManualDocument.record), h.record);
  assert.deepEqual(h.saved, []);
});

test('repeated restore replaces its own mode, absent chat keeps it, explicit empty clears it', async () => {
  const h = setup();
  await h.apply(); await h.apply(); assert.equal(h.marks.length, 1);
  await h.apply([], { assets: [] }); assert.equal(h.marks.length, 1);
  await h.apply([]); assert.equal(h.marks.length, 0);
  assert.ok(h.clears.every(mode => mode === 'restored-html-chat:search'));
});

test('untrusted, changed, cross-document and unverified turns never repaint or clear', async () => {
  for (const input of [{ committedDocumentRequired: false }, { match: 'content-changed' },
    { committedDocumentTarget: { ...target, documentHash: 'other' } }]) {
    const h = setup(); await h.apply(); const calls = h.paints.length, clears = h.clears.length;
    const result = await h.apply([h.turn], input);
    assert.equal(result.manualRebuildDeferred, true); assert.equal(h.paints.length, calls);
    assert.equal(h.clears.length, clears);
  }
  const h = setup(); h.turn.answerBlocks[0].evidence[0].verificationStatus = 'unverified';
  const result = await h.apply(); assert.equal(result.manualRebuildDeferred, true);
  assert.equal(h.paints.length, 0);
});

test('wrong source, paragraph, hash or repeated raw quote cannot use citation fallbacks', async () => {
  for (const change of [{ sourceKey: 'wrong' }, { paragraphId: 'wrong' }, { textHash: 'wrong' },
    { documentHash: 'wrong' }, { quote: 'the result is significant.' }]) {
    const h = setup(); Object.assign(h.turn.answerBlocks[0].evidence[0], change);
    const result = await h.apply(); assert.equal(result.manualRebuildDeferred, true);
    assert.equal(h.paints.length, 0);
  }
  const h = setup(); h.node.textContent += ' ' + h.node.textContent;
  const result = await h.apply(); assert.equal(result.manualRebuildDeferred, true);
  assert.equal(h.paints.length, 0);
});

test('manual or authoritative semantic overlap and plugin UI text stay deferred untouched', async () => {
  for (const kind of ['manual', 'semantic', 'note']) {
    const h = setup(); h.element.protected.push({ kind });
    const result = await h.apply(); assert.equal(result.manualRebuildDeferred, true);
    assert.equal(h.paints.length, 0); assert.deepEqual(copy(h.state.currentManualDocument.record), h.record);
  }
  const h = setup(); h.state.collectLlmTextNodes = () => [{ textContent: h.node.textContent + '备注' }];
  assert.equal((await h.apply()).manualRebuildDeferred, true); assert.equal(h.paints.length, 0);
});

test('a partial plan counts only rendered unique evidence and remains deferred', async () => {
  const h = setup(), evidence = h.turn.answerBlocks[0].evidence;
  evidence.push(copy(evidence[0]), { ...copy(evidence[0]), sourceKey: 'wrong' });
  const result = await h.apply();
  assert.equal(result.semanticHighlightsRestored, 1); assert.equal(result.manualRebuildDeferred, true);
  assert.equal(h.paints[0].annotations.length, 1);
  assert.equal(h.state.articleChatState.turns[0].unresolvedCount, 1);
});

test('turn-file-only restores and per-turn cleanup preserve unrelated LLM modes', async () => {
  const h = setup(); h.marks.push({ dataset: { analysisModeId: 'llm-default' }, isConnected: true });
  await h.apply([], { assets: [], turns: [h.turn] });
  assert.equal(h.marks.length, 2);
  h.state.clearNativePdfSemanticChatHighlights('search');
  assert.equal(h.marks.length, 1); assert.equal(h.marks[0].dataset.analysisModeId, 'llm-default');
});

test('trusted replacement with now-invalid evidence removes only its stale temporary display', async () => {
  const h = setup(); await h.apply();
  h.turn.answerBlocks[0].evidence[0].sourceKey = 'wrong';
  const result = await h.apply();
  assert.equal(result.manualRebuildDeferred, true); assert.equal(h.marks.length, 0);
  assert.deepEqual(copy(h.state.currentManualDocument.record), h.record);
});

test('all turn plans finish before paint and overlapping turns are not nested', async () => {
  const h = setup(), other = { ...copy(h.turn), turnId: 'second' };
  const count = h.state.SciLLM.countCanonicalTextMatches;
  h.state.SciLLM.countCanonicalTextMatches = (...args) => { h.events.push('plan'); return count(...args); };
  const result = await h.apply([h.turn, other]);
  assert.deepEqual(h.events, ['plan', 'plan', 'paint']);
  assert.equal(result.semanticHighlightsRestored, 1); assert.equal(result.manualRebuildDeferred, true);
});

test('canonical structure ids map only through the unique source key to real extractor DOM ids', async () => {
  for (const evidenceId of ['canonical-p', 'source-p']) {
    const h = setup(); h.paragraph.paragraphId = 'canonical-p';
    h.element.dataset.sciLlmParagraphId = 'source-p';
    h.state.currentManualBlocks[0].blockId = 'source-p';
    h.turn.answerBlocks[0].evidence[0].paragraphId = evidenceId;
    const result = await h.apply();
    assert.equal(result.semanticHighlightsRestored, 1);
    assert.equal(h.paints[0].annotations[0].paragraphId, 'source-p');
  }
});

test('explicit turn replacement can reuse a range occupied only by the replaced temporary mode', async () => {
  const h = setup(); await h.apply();
  h.element.protected.push(h.marks[0]);
  const replacement = { ...copy(h.turn), turnId: 'replacement' };
  const result = await h.apply([replacement]);
  assert.equal(result.semanticHighlightsRestored, 1);
  assert.equal(Boolean(result.manualRebuildDeferred), false);
  assert.equal(h.marks.length, 1); assert.equal(h.marks[0].dataset.restoredChatTurnId, 'replacement');
});

test('temporary semantic display never changes the persisted automatic engine or analysis', async () => {
  const h = setup();
  h.state.document.querySelector = selector => selector === '.sci-highlight' ? {} :
    selector === '.sci-llm-highlight' ? h.marks[0] || null :
    selector === '.sci-llm-highlight:not([data-restored-chat-turn-id])'
      ? h.marks.find(mark => !mark.dataset.restoredChatTurnId) || null : null;
  Object.assign(h.state, { buildFigureWorkspaceSnapshot: () => ({ figures: [] }),
    currentArticleWorkspace: null,
    createPortableFigureWorkspaceArchiveFields: () => ({}),
    chrome: { runtime: { getManifest: () => ({ version: 'test' }) } } });
  h.state.SciLLM.createArticleArchive = value => value;
  vm.runInContext(functionSource('buildCurrentArticleArchive'), h.state);
  const before = h.state.buildArticleWorkspaceAssets().get('annotations/highlights.json').activeEngine;
  await h.apply();
  assert.equal(h.marks[0].dataset.source, 'semantic');
  assert.equal(h.state.buildArticleWorkspaceAssets().get('annotations/highlights.json').activeEngine, before);
  assert.equal(h.state.buildCurrentArticleArchive().workspace.activeEngine, before);
  assert.equal(h.state.lastLlmAnalysis, null);
});

test('restore freeze preserves display before validation and for absent chat, owner invalidation clears it', async () => {
  const h = setup(); await h.apply();
  Object.assign(h.state, { figureWorkspaceLifecycleTransitions: [], articleChatGeneration: 0,
    cancelWorkspaceOperation() {}, queueFigureOperationLifecycleCleanup() {},
    llmOperationState: { active: null, generation: 0 }, figureOperationState: { active: null },
    invalidateCrossFigureMechanismOperations() {}, paperMetaAnalysisPromises: new Map(),
    ownArticleWorkspaceRestoreValue: (input, key) => input[key] });
  for (const name of ['invalidateArticleWorkspaceLifecycle', 'runAuthorizedArticleWorkspaceRestore'])
    vm.runInContext(functionSource(name), h.state);
  await assert.rejects(h.state.runAuthorizedArticleWorkspaceRestore({}, {
    consume: () => ({}), invalidate: () => h.state.invalidateArticleWorkspaceLifecycle({ preserveRestoreManualState: true }),
    freeze() {}, unfreeze() {}, capture: async () => ({}),
    getLifecycle: () => h.state.articleWorkspaceLifecycleGeneration,
    validate: () => { throw Error('TARGET_MISMATCH'); }, commit: () => assert.fail('must not commit')
  }), /TARGET_MISMATCH/);
  assert.equal(h.marks.length, 1);
  h.state.invalidateArticleWorkspaceLifecycle({ preserveRestoreManualState: true });
  await h.apply([], { assets: [] }); assert.equal(h.marks.length, 1);
  h.state.invalidateArticleWorkspaceLifecycle(); assert.equal(h.marks.length, 0);
});

test('clear chat failure removes only displays whose durable turn deletion already succeeded', async () => {
  const h = setup(); await h.apply();
  h.state.articleChatState.turns.push({ ...copy(h.turn), turnId: 'second' });
  h.marks.push({ dataset: { analysisModeId: 'restored-html-chat:second', restoredChatTurnId: 'second' },
    isConnected: true, parentElement: h.element });
  Object.assign(h.state, { articleChatClearInFlight: false, articleChatMutationLocks: new Set(),
    articleChatIndexStateWithoutTurns: () => ({}),
    deleteWorkspaceTurnCheckpoint: async id => { if (id === 'second') throw Error('disk failure'); return { deleted: true }; },
    scheduleCurrentArticleArchiveSave() {}, notifyArticleChatStateChanged() {} });
  vm.runInContext(functionSource('clearArticleChat'), h.state);
  await assert.rejects(h.state.clearArticleChat(), /disk failure/);
  assert.deepEqual(copy(h.state.articleChatState.turns.map(turn => turn.turnId)), ['second']);
  assert.deepEqual(h.marks.map(mark => mark.dataset.restoredChatTurnId), ['second']);
});

test('temporary turn display has no full-article AI feedback or button contract', async () => {
  const h = setup(); await h.apply();
  let feedback = 0;
  h.state.closeHighlightContextPopover = () => {};
  h.state.appendAiFeedbackEditor = () => { feedback += 1; };
  h.state.document.createElement = () => { throw Error('must not create feedback UI'); };
  const mark = h.marks[0]; mark.matches = selector => selector === '.sci-llm-highlight';
  mark.closest = () => null;
  vm.runInContext(functionSource('showHighlightContextPopover'), h.state);
  h.state.showHighlightContextPopover(mark);
  assert.equal(feedback, 0);
  assert.equal(h.paints[0].meta.restoredChatTurnId, 'search');
});

test('real renderer creates display-only semantic marks while ordinary LLM retains feedback interaction', () => {
  for (const displayOnly of [true, false]) {
    const h = setup(), samples = new WeakMap();
    Object.assign(h.state, { llmFeedbackByMark: samples, llmHighlightInteractions: new WeakSet(),
      llmPresentationState: { density: 'balanced', hiddenFamilyIds: [], language: 'zh' },
      locateRawOffset: (_nodes, offset) => ({ node: h.node, offset }) });
    Object.assign(h.state.SciLLM, require('../core/category-store.js'), require('../core/highlight-presentation.js'));
    h.state.document.createElement = () => ({ dataset: {}, style: {}, attributes: {}, listeners: [],
      classList: { add() {} }, appendChild() {},
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(name) { this.listeners.push(name); } });
    h.state.document.createRange = () => ({ setStart() {}, setEnd() {}, extractContents: () => ({}),
      insertNode: mark => h.marks.push(mark) });
    for (const name of ['rangesOverlap', 'bindLlmHighlightInteraction', 'applyLlmHighlights'])
      vm.runInContext(functionSource(name), h.state);
    const result = h.state.applyLlmHighlights([{ paragraphId: 'p', start: 0,
      end: h.node.textContent.length, quote: h.node.textContent,
      visibleMode: 'inline_highlight',
      categories: [{ categoryId: displayOnly ? 'semantic_match' : 'result', categoryName: '智能检索匹配' }] }],
    displayOnly ? { readingViewId: 'restored-html-chat:search', restoredChatTurnId: 'search' } : {});
    assert.equal(result.highlightedCount, 1);
    const mark = h.marks[0];
    assert.equal(samples.has(mark), !displayOnly);
    assert.equal(mark.dataset.source, displayOnly ? 'semantic' : 'llm');
    assert.equal(mark.attributes.role, displayOnly ? undefined : 'button');
    assert.equal(mark.tabIndex, displayOnly ? undefined : 0);
    assert.equal(mark.attributes['aria-label'].includes('按回车'), !displayOnly);
    assert.deepEqual(mark.listeners, displayOnly ? [] : ['click', 'keydown']);
  }
});
