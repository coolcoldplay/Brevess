const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
function functionSource(name, text = source) {
  let start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  if (text.slice(start - 6, start) === 'async ') start -= 6;
  const next = text.slice(start + 1).search(/\n(?:async )?function /u);
  return text.slice(start, next < 0 ? text.length : start + 1 + next).trim();
}
const copy = value => JSON.parse(JSON.stringify(value));
const error = code => Object.assign(new Error(code || 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH'),
  { code: code || 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH' });
function harness({ supplemental = [] } = {}) {
  const saved = [];
  const state = {
    Map, Set, Date, Promise, console, structuredClone,
    SciLLM: { normalizeArticleAbbreviationState: copy, publicFigureWorkspaceDraft: copy,
      supplementalFigureAssetPath: id => `figures/supplemental/${id}.json` },
    MECHANISM_CLEANUP_INTENTS_ASSET_PATH: 'mechanism/cleanup-intents.json',
    FIGURE_WORKSPACE_DRAFT_ASSET_PATH: 'figures/workspace-draft.json',
    supplementalFigureAssets: copy(supplemental), articleParagraphNotes: new Map(),
    articleChatState: { turns: [] }, articleWorkspaceSidePanelUiState: null,
    articleWorkspaceAssetFingerprints: new Map(), articleWorkspaceAssetFingerprint: JSON.stringify,
    articleAbbreviationState: { schemaVersion: 1, manualEntries: [], excludedKeys: [], translations: [] },
    articleNavigatorState: { activeTab: 'outline', depth: 'major', summariesVisible: false,
      expandedSectionIds: new Set(), analysisSectionSelection: new Map() },
    currentManualDocument: { documentId: 'doc-a', record: { annotations: [] } },
    manualPrepareSequence: 0, manualDocumentEpochState: {}, currentManualBlocks: [],
    articleStructureChangeSequence: 1, manualPreparedHref: '', manualPreparedContentSequence: 0,
    nextManualDocumentEpochState: () => ({ epoch: 2 }),
    getManualDocumentInputAndBlocks: () => ({ blocks: [] }),
    effectiveArticlePageUrl: () => 'https://example.org/paper',
    manualUiLifecycle: { beginDocument() {} }, scheduleManualSelectionInspection() {},
    restoreManualAnnotations: annotations => { state.rendered = copy(annotations); return { unresolved: [] }; },
    figureWorkspaceDraft: { figures: [] }, lastRegexHighlightRequest: null,
    lastPreparedStudy: null, lastLlmAnalysis: null, lastLlmDiagnostics: null, lastReviewOutline: null,
    document: { querySelector: () => null, querySelectorAll: () => [] }, activeNativePdfStructure: () => null,
    restorePendingNativePdfRegexHighlights() {},
    serializeCrossFigureMechanismCleanupIntents: () => [],
    articleWorkspaceSaveFrozen: false, articleWorkspaceLifecycleGeneration: 1,
    ensureCurrentArticleWorkspace: async () => ({ workspaceId: 'paper' }),
    assertCurrentArticleWorkspaceLifecycle() {},
    persistWorkspaceAssetCheckpoint: async (relativePath, content) => {
      saved.push({ relativePath, content: copy(content) }); return { saved: true };
    }, supplementalPdfBinding: null, articleWorkspaceRestoreError: error
  };
  state.buildArticleWorkspaceSnapshot = () => ({ documentId: 'doc-a', documentHash: 'hash',
    paragraphs: [{ text: 'p = 0.03; no increase' }], figures: { supplemental: {} },
    chat: state.articleChatState, highlightDistribution: { totalHighlights: 0 } });
  vm.createContext(state);
  for (const name of ['retainCommittedArticleWorkspaceDocument', 'prepareCommittedArticleWorkspaceDocument',
    'projectCommittedArticleWorkspaceDocument', 'inspectRestoredHtmlSemanticTurns',
    'restoredHtmlSemanticChatModeId', 'clearRestoredHtmlSemanticChatHighlights',
    'planRestoredHtmlSemanticTurn', 'projectRestoredHtmlSemanticTurns', 'projectRestoredNativePdfSemanticTurns',
    'renderNativePdfSemanticAnnotationsFromTurn', 'applyArticleWorkspaceAssetsUnsafe', 'buildArticleWorkspaceAssets',
    'captureArticleWorkspaceAssets', 'persistArticleWorkspaceArtifacts',
    'commitArticleWorkspaceRestoreTransaction', 'commitPreparedArticleWorkspaceRestore']) {
    vm.runInContext(functionSource(name), state);
  }
  return { state, saved, apply: assets => state.applyArticleWorkspaceAssetsUnsafe({
    assets, match: 'exact', persistRestored: false, deferManualSideEffects: true,
    committedDocumentRequired: true, committedDocument: committedRecord,
    committedDocumentTarget: documentTarget
  }) };
}
const manualAsset = { relativePath: 'annotations/highlights.json', revision: 4, contentHash: 'actual',
  content: { activeEngine: '', lastRegexRequest: null,
    annotations: [{ annotationId: 'manual-restored', quote: 'p = 0.03', note: '人工批注' }],
    highlightDistribution: { totalHighlights: 1 } } };
const documentTarget = { documentId: 'doc-a', documentHash: 'hash', canonicalUrl: 'https://example.org/paper' };
const committedRecord = { ...documentTarget, revision: 7, annotations: manualAsset.content.annotations };

test('prepared partial candidate keeps supplemental materials whose paths are absent', async () => {
  const original = [{ materialId: 'manual-a', figures: [{ figureId: 's1', manual: '人工图注' }] }];
  const h = harness({ supplemental: original });
  await h.apply([{ relativePath: 'ui/state.json', content: {} }]);
  assert.deepEqual(copy(h.state.supplementalFigureAssets), original);
});

test('prepared partial supplemental replacement keeps the other material and its next-save checkpoint', async () => {
  const original = [{ materialId: 'a', figures: [{ figureId: 's1', manual: 'A' }] },
    { materialId: 'b', figures: [{ figureId: 's2', manual: 'B' }] }];
  const replacement = { materialId: 'a', figures: [{ figureId: 's1', manual: '恢复 A' }] };
  const h = harness({ supplemental: original });
  await h.apply([{ relativePath: 'figures/supplemental/a.json', content: replacement }]);
  const captured = h.state.captureArticleWorkspaceAssets();
  assert.deepEqual(copy(captured.get('figures/supplemental/a.json')), replacement);
  assert.ok(captured.has('figures/supplemental/b.json'), 'KEEP material must remain part of subsequent save');
  assert.deepEqual(copy(captured.get('figures/supplemental/b.json')), original[1]);
});

test('paused manual annotation restoration cannot be reported as fully complete', async () => {
  const h = harness();
  const result = await h.state.commitArticleWorkspaceRestoreTransaction({
    restore: { restorePlanId: 'plan-1' }, manualBaseline: {}, operationNonce: 'nonce'
  }, { current: {}, manifest: {}, documentId: 'doc-a' }, 1, {
    assertTarget: async () => {}, assertCurrentSync: () => {},
    commitPrepared: async () => ({ committed: true, persistenceCommitted: true,
      restore: { assets: [manualAsset] }, assetCount: 1 }),
    apply: restore => h.state.applyArticleWorkspaceAssetsUnsafe(restore)
  });
  assert.equal(result.persistenceCommitted, true);
  const restored = JSON.stringify(h.state.currentManualDocument.record.annotations) ===
    JSON.stringify(manualAsset.content.annotations);
  assert.ok(restored || result.postCommitStatus !== 'complete',
    'manual display/data preparation was skipped, so full completion must remain pending');
});

test('later normal artifact saving cannot replace restored manual annotations with the old empty record', async () => {
  const h = harness();
  await h.apply([manualAsset]);
  assert.deepEqual(copy(h.state.rendered), manualAsset.content.annotations);
  assert.equal(h.state.currentManualDocument.record.revision, 7);
  const captured = h.state.captureArticleWorkspaceAssets();
  await h.state.persistArticleWorkspaceArtifacts({ assets: new Map([
    ['annotations/highlights.json', captured.get('annotations/highlights.json')]
  ]) });
  const overwrite = h.saved.find(item => item.relativePath === 'annotations/highlights.json');
  assert.ok(!overwrite || JSON.stringify(overwrite.content.annotations) ===
    JSON.stringify(manualAsset.content.annotations), 'a paused manual projection must not become an empty save');
});

test('prepared manual projection adopts only the committed document before subsequent capture', async () => {
  const h = harness();
  const result = await h.state.commitArticleWorkspaceRestoreTransaction({
    restore: { restorePlanId: 'plan-1' }, manualBaseline: {}, operationNonce: 'nonce'
  }, { current: { canonicalUrl: documentTarget.canonicalUrl }, manifest: {},
    documentId: documentTarget.documentId, documentHash: documentTarget.documentHash }, 1, {
    assertTarget: async () => {}, assertCurrentSync: () => {},
    commitPrepared: async () => ({ committed: true, persistenceCommitted: true,
      restore: { assets: [manualAsset] }, document: committedRecord, assetCount: 1 }),
    apply: restore => h.state.applyArticleWorkspaceAssetsUnsafe(restore)
  });
  assert.equal(result.manualAnnotationsRestored, true);
  assert.equal(result.postCommitStatus, 'complete');
  assert.deepEqual(copy(h.state.currentManualDocument.record), committedRecord);
  assert.deepEqual(copy(h.state.captureArticleWorkspaceAssets().get('annotations/highlights.json').annotations),
    manualAsset.content.annotations);
});

test('wrong document identity is rejected before any manual or partial asset projection', async () => {
  for (const field of ['documentId', 'documentHash', 'canonicalUrl']) {
    const h = harness(); const before = copy(h.state.currentManualDocument);
    await assert.rejects(h.state.applyArticleWorkspaceAssetsUnsafe({
      assets: [manualAsset], committedDocumentRequired: true,
      committedDocument: { ...committedRecord, [field]: 'wrong' }, committedDocumentTarget: documentTarget
    }), /DOCUMENT_UNCONFIRMED/);
    assert.deepEqual(copy(h.state.currentManualDocument), before);
    assert.equal(h.state.rendered, undefined);
    assert.equal(h.state.articleWorkspaceAssetFingerprints.size, 0);
  }
});

function realWriter(h) {
  h.state.currentArticleWorkspace = { workspaceId: 'paper', workspaceGeneration: 1 };
  h.state.articleWorkspaceMutationTail = Promise.resolve();
  h.state.chrome = { runtime: { sendMessage: async message => {
    h.saved.push(copy(message)); return { success: true, data: { saved: true } };
  } } };
  h.state.ensureCurrentArticleWorkspace = async () => h.state.currentArticleWorkspace;
  vm.runInContext(functionSource('persistWorkspaceAssetCheckpoint'), h.state);
  vm.runInContext(functionSource('buildCurrentArticleArchive'), h.state);
}

test('durable restore rejected by a new draft prevents forced empty saves and old archive snapshots until readback', async () => {
  const h = harness(); realWriter(h); let checked = 0;
  const result = await h.state.commitArticleWorkspaceRestoreTransaction({
    restore: { restorePlanId: 'plan-1' }, manualBaseline: {}
  }, { current: h.state.currentArticleWorkspace, ...documentTarget }, 1, {
    assertTarget: async () => {}, assertCurrentSync: () => { if (++checked > 1) throw error('DRAFT_PENDING'); },
    retainCommittedDocument: h.state.retainCommittedArticleWorkspaceDocument,
    commitPrepared: async () => ({ committed: true, persistenceCommitted: true,
      restore: { assets: [manualAsset] }, document: committedRecord }),
    apply: () => assert.fail('new draft must be preserved')
  });
  assert.equal(result.persistenceCommitted, true); assert.equal(result.workspaceApplied, false);
  await assert.rejects(h.state.persistWorkspaceAssetCheckpoint('annotations/highlights.json',
    { annotations: [] }, { force: true }), /DOCUMENT_PENDING/);
  assert.throws(() => h.state.buildCurrentArticleArchive(), /DOCUMENT_PENDING/);
  assert.equal(h.saved.length, 0);
  h.state.currentManualDocument.record = copy(committedRecord); // Actual prepare/readback is covered by browser test.
  await h.state.persistWorkspaceAssetCheckpoint('annotations/highlights.json', manualAsset.content, { force: true });
  assert.equal(h.saved.length, 1);
  assert.deepEqual(h.saved[0].content.annotations, manualAsset.content.annotations);
});

test('manual guard rechecks after awaited workspace preparation and accepts a later genuine edit including clear', async () => {
  const h = harness(); realWriter(h);
  h.state.currentManualDocument.record = copy(committedRecord);
  h.state.retainCommittedArticleWorkspaceDocument(committedRecord, { current: h.state.currentArticleWorkspace });
  h.state.ensureCurrentArticleWorkspace = async () => {
    h.state.currentManualDocument.record = { ...copy(committedRecord), revision: 8, annotations: [] };
    return h.state.currentArticleWorkspace;
  };
  await assert.rejects(h.state.persistWorkspaceAssetCheckpoint('annotations/highlights.json',
    manualAsset.content, { force: true }), /DOCUMENT_PENDING/);
  assert.equal(h.saved.length, 0);
  await h.state.persistWorkspaceAssetCheckpoint('annotations/highlights.json', { annotations: [] }, { force: true });
  assert.equal(h.saved.length, 1); assert.deepEqual(h.saved[0].content.annotations, []);
});

test('prepared unknown and unconfirmed replies never run apply or register a receipt', async () => {
  for (const mode of ['unknown', 'unconfirmed']) {
    const h = harness(); const calls = [];
    h.state.chrome = { runtime: { sendMessage: async () => {
      if (mode === 'unknown') throw Error('transport disconnected');
      return { success: true, data: {} };
    } } };
    await assert.rejects(() => h.state.commitArticleWorkspaceRestoreTransaction({
      restore: { restorePlanId: 'plan-1' }, operationNonce: 'nonce', manualBaseline: {}
    }, { current: {}, manifest: {}, documentId: 'doc-a' }, 1, {
      assertTarget: async () => {}, assertCurrentSync: () => {},
      commitPrepared: h.state.commitPreparedArticleWorkspaceRestore,
      apply: () => calls.push('apply'), registerReceipt: () => calls.push('receipt')
    }), new RegExp(mode === 'unknown' ? 'COMMIT_UNKNOWN' : 'COMMIT_UNCONFIRMED'));
    assert.deepEqual(calls, []);
  }
});

test('an asynchronous supposed final guard is rejected before persistence or apply', async () => {
  const h = harness(); const calls = [];
  await assert.rejects(() => h.state.commitArticleWorkspaceRestoreTransaction({
    restore: { restorePlanId: 'plan-1' }, manualBaseline: {}
  }, { current: {}, manifest: {} }, 1, {
    assertTarget: async () => {}, assertCurrentSync: async () => true,
    commitPrepared: () => calls.push('persist'), apply: () => calls.push('apply')
  }));
  assert.deepEqual(calls, []);
});
