'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {functionSource} = require('./helpers/r28-full07-source.js');
const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const versions = require('../core/evidence-first-mechanism.js').EVIDENCE_FIRST_VERSIONS;
const path = 'mechanism/cleanup-intents.json';
const workspaceId = 'workspace:' + 'a'.repeat(64);

// New VM globals and JSON storage boundary each time. The full production asset
// applicator and cleanup normalization/priority run unchanged. DOM/manual/PDF
// projection and Figure presentation are explicit unrelated boundaries. This is
// a cold-realm mechanism test, not a browser/OPFS cold-start acceptance result.
function cold() {
  const h = {
    SciLLM: {},
    prepareCommittedArticleWorkspaceDocument: () => null,
    projectCommittedArticleWorkspaceDocument: () => null,
    normalizeRestoredFigureWorkspace: value => value,
    restoreFigureAnalysisProgress() {},
    restoreFigureWorkspaceDraft() {},
    restorePendingNativePdfRegexHighlights() {},
    activeNativePdfStructure: () => null
  };
  vm.createContext(h);
  vm.runInContext(`
    const MECHANISM_CLEANUP_INTENTS_ASSET_PATH = '${path}';
    const FIGURE_WORKSPACE_DRAFT_ASSET_PATH = 'figures/workspace-draft.json';
    const crossFigureLogicCleanupIntents = new Map();
    let supplementalFigureAssets = [];
    let articleChatState = {turns: []};
    let articleWorkspaceSidePanelUiState = null;
    let restoredFigureWorkspaceSnapshot = null;
    let crossFigureLogicState = null;
    const articleWorkspaceAssetFingerprints = new Map();
    const articleWorkspaceAssetFingerprint = JSON.stringify;
  `, h);
  for (const name of [
    'crossFigureMechanismOwnData', 'buildCrossFigureMechanismControlMessage',
    'normalizeCrossFigureMechanismCleanupIntent', 'normalizeCrossFigureMechanismCleanupIntents',
    'hydrateCrossFigureMechanismCleanupIntents', 'isSeedableCrossFigureLogicResult',
    'normalizeCrossFigureMechanismPendingPreview', 'createCrossFigureLogicState',
    'restoreCrossFigureMechanismState', 'applyArticleWorkspaceAssetsUnsafe'
  ]) vm.runInContext(functionSource(source, name), h);
  return {
    h,
    async restore(assets) {
      h.storageJson = JSON.stringify(assets);
      await vm.runInContext(`applyArticleWorkspaceAssetsUnsafe({
        assets: JSON.parse(storageJson), match: 'exact',
        persistRestored: false, deferManualSideEffects: true
      })`, h);
      return JSON.parse(vm.runInContext('JSON.stringify([...crossFigureLogicCleanupIntents.values()].map(row => ({operationId: row.operationId, controlMessage: row.controlMessage, binding: row.operation.binding})))', h));
    }
  };
}
function record() {
  const f = cold();
  f.h.operationJson = JSON.stringify({
    operationId: 'mechanism:owned-12345678', evidenceFirstVersions: versions,
    binding: {documentId: 'paper', workspaceId, workspaceGeneration: 1,
      workspaceLifecycle: 1, baseWorkspaceRevision: 3,
      mechanismChainFingerprint: 'mechanism-chain-v1-12345678'}
  });
  return JSON.parse(vm.runInContext(`JSON.stringify({
    version: 'mechanism-cleanup-intent-v1', phase: 'cleanup_ready',
    controlMessage: buildCrossFigureMechanismControlMessage(JSON.parse(operationJson), 'release')
  })`, f.h));
}
const inventory = cleanupIntents => ({relativePath: 'figures/inventory.json',
  content: {figures: [], crossFigureLogic: {cleanupIntents}}});
const dedicated = cleanupIntents => ({relativePath: path,
  content: {schemaVersion: 1, cleanupIntents}});

test('fresh production asset applicator restores dedicated current control over stale empty inventory', async () => {
  const intent = record();
  const rows = await cold().restore([dedicated([intent]), inventory([])]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].operationId, intent.controlMessage.operationId);
  assert.equal(rows[0].binding.workspaceId, workspaceId);
  assert.deepEqual(rows[0].controlMessage, intent.controlMessage);
});

test('fresh production asset applicator treats dedicated empty tombstone as authoritative over stale pending inventory', async () => {
  const rows = await cold().restore([inventory([record()]), dedicated([])]);
  assert.deepEqual(rows, []);
});

test('legacy inventory control remains restorable when the dedicated checkpoint is absent', async () => {
  const rows = await cold().restore([inventory([record()])]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].binding.documentId, 'paper');
});

test('invalid dedicated checkpoint rejects instead of silently falling back to stale inventory', async () => {
  await assert.rejects(cold().restore([
    inventory([record()]),
    {relativePath: path, content: {schemaVersion: 2, cleanupIntents: []}}
  ]), {code: 'MECHANISM_CLEANUP_CHECKPOINT_INVALID'});
});
